import { describe, it, expect, vi, afterEach } from "vitest";
import { createFakeDb } from "../helpers/fakeDb";
import { collectShopify } from "@/lib/shopifyCollector";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const CLIENT_ID = "44444444-4444-4444-4444-444444444444";

function seedDb(storeOverrides: Record<string, any> = {}) {
  return createFakeDb({
    clients: [{ id: CLIENT_ID, domain: "example.com" }],
    client_stores: [
      {
        id: "store-1",
        client_id: CLIENT_ID,
        platform: "shopify",
        domain: "example-shop.myshopify.com",
        api_client_id: "shopify-client-id-123",
        auth_ref: "shopify:" + CLIENT_ID,
        status: "active",
        ...storeOverrides,
      },
    ],
  }) as any;
}

// Stand in for Supabase Vault's `vault.decrypted_secrets` table, which fakeDb
// (a plain PostgREST-subset stand-in) doesn't model.
function withVaultSecret(db: any, secret: string | null) {
  db.schema = (schemaName: string) => {
    if (schemaName !== "vault") throw new Error(`unexpected schema ${schemaName}`);
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: secret ? { decrypted_secret: secret } : null, error: null }),
          }),
        }),
      }),
    };
  };
  return db;
}

describe("collectShopify", () => {
  it("writes rows to conversions_daily(source='shopify') and records a collector_runs success row", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = withVaultSecret(seedDb(), "shpss_fake_secret");

    const written = await collectShopify(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(5); // matches tests/fixtures/shopify/daily_sales.json row count
    const rows = db._rows("conversions_daily");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      client_id: CLIENT_ID,
      date: "2026-06-22",
      source: "shopify",
      conversions: 14,
      revenue: 2380.50,
    });

    const run = db._rows("collector_runs")[0];
    expect(run).toMatchObject({ module: "shopify", client_id: CLIENT_ID, status: "success", rows_written: 5 });
  });

  it("updates existing rows instead of duplicating on a second run", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = withVaultSecret(seedDb(), "shpss_fake_secret");

    await collectShopify(db, { id: CLIENT_ID, domain: "example.com" });
    await collectShopify(db, { id: CLIENT_ID, domain: "example.com" });

    const rows = db._rows("conversions_daily");
    expect(rows).toHaveLength(5); // still 5 — second run updated, not appended
  });

  it("does not clobber other sources' conversions_daily rows for the same client/date", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = withVaultSecret(seedDb(), "shpss_fake_secret");
    await db.from("conversions_daily").insert({
      client_id: CLIENT_ID,
      date: "2026-06-22",
      source: "ga4",
      sessions: 100,
      conversions: 3,
      revenue: 250,
    });

    await collectShopify(db, { id: CLIENT_ID, domain: "example.com" });

    const rows = db._rows("conversions_daily");
    const ga4Row = rows.find((r: any) => r.source === "ga4");
    const shopifyRow = rows.find((r: any) => r.source === "shopify" && r.date === "2026-06-22");
    expect(ga4Row).toMatchObject({ conversions: 3, revenue: 250 });
    expect(shopifyRow).toMatchObject({ conversions: 14, revenue: 2380.50 });
  });

  it("records a run and does not throw when the client has no client_stores row (no store configured)", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = createFakeDb({
      clients: [{ id: CLIENT_ID, domain: "example.com" }],
    }) as any;

    const written = await collectShopify(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(0);
    expect(db._rows("conversions_daily")).toHaveLength(0);
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("success");
    expect(run.rows_written).toBe(0);
    expect(run.detail).toContain("no shopify client_stores row");
  });

  it("records a run and does not throw when the store has no api_client_id", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = seedDb({ api_client_id: null });

    const written = await collectShopify(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(0);
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("success");
    expect(run.detail).toContain("no api_client_id");
  });

  it("records a run and does not throw when the store has no auth_ref", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = seedDb({ auth_ref: null });

    const written = await collectShopify(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(0);
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("success");
    expect(run.detail).toContain("no auth_ref");
  });

  it("records a run and does not throw when the vault has no secret for the auth_ref", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = withVaultSecret(seedDb(), null);

    const written = await collectShopify(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(0);
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("success");
    expect(run.detail).toContain("no vault secret found");
  });

  it("never surfaces the client secret in the recorded collector_runs row", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = withVaultSecret(seedDb(), "shpss_should_never_be_logged");

    await collectShopify(db, { id: CLIENT_ID, domain: "example.com" });

    const run = db._rows("collector_runs")[0];
    expect(JSON.stringify(run)).not.toContain("shpss_should_never_be_logged");
  });

  it("records a collector_runs error row instead of throwing when the API call fails", async () => {
    vi.stubEnv("MOCK_APIS", "0");
    const db = withVaultSecret(seedDb(), "shpss_fake_secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 500, statusText: "Server Error" }));

    const written = await collectShopify(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(0);
    expect(db._rows("conversions_daily")).toHaveLength(0);
    const run = db._rows("collector_runs")[0];
    expect(run).toMatchObject({ module: "shopify", client_id: CLIENT_ID, status: "error" });
  });
});
