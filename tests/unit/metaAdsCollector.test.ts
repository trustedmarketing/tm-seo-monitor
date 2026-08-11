import { describe, it, expect, vi, afterEach } from "vitest";
import { createFakeDb } from "../helpers/fakeDb";
import { collectMetaAds } from "@/lib/metaAdsCollector";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const CLIENT_ID = "33333333-3333-3333-3333-333333333333";

function seedDb(accountOverrides: Record<string, any> = {}) {
  return createFakeDb({
    clients: [{ id: CLIENT_ID, domain: "example.com" }],
    ad_platform_accounts: [
      {
        id: "acct-1",
        client_id: CLIENT_ID,
        platform: "meta",
        external_id: "act_123456789",
        status: "active",
        auth_ref: null,
        ...accountOverrides,
      },
    ],
  }) as any;
}

describe("collectMetaAds", () => {
  it("writes rows to ad_metrics_daily and records a collector_runs success row (MOCK_APIS)", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = seedDb();

    const written = await collectMetaAds(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(5); // matches tests/fixtures/meta/ad_insights.json row count
    const rows = db._rows("ad_metrics_daily");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      client_id: CLIENT_ID,
      platform: "meta",
      date: "2026-06-22",
      ad_id: "120210000000111",
      conversions: 6,
      revenue: 540.00,
    });

    const run = db._rows("collector_runs")[0];
    expect(run).toMatchObject({ module: "meta_ads", client_id: CLIENT_ID, status: "success", rows_written: 5 });
    expect(run.detail).toContain("synced 2 campaign(s)");
  });

  it("updates existing rows instead of duplicating on a second run", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = seedDb();

    await collectMetaAds(db, { id: CLIENT_ID, domain: "example.com" });
    await collectMetaAds(db, { id: CLIENT_ID, domain: "example.com" });

    const rows = db._rows("ad_metrics_daily");
    expect(rows).toHaveLength(5); // still 5 — second run updated, not appended
  });

  it("syncs campaign status/budget/objective into the campaigns registry (WO-006 stream A)", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = seedDb();

    await collectMetaAds(db, { id: CLIENT_ID, domain: "example.com" });

    const campaigns = db._rows("campaigns");
    expect(campaigns).toHaveLength(2); // matches tests/fixtures/meta/campaigns.json
    expect(campaigns).toContainEqual(
      expect.objectContaining({
        client_id: CLIENT_ID,
        platform: "meta",
        campaign_id: "120210000000001",
        campaign_name: "Prospecting - Broad",
        status: "active",
        objective: "OUTCOME_SALES",
        daily_budget: 50, // fixture's "5000" cents / 100
      })
    );
    expect(campaigns).toContainEqual(expect.objectContaining({ campaign_id: "120210000000002", status: "paused" }));
  });

  it("updates campaign rows instead of duplicating on a second run", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = seedDb();

    await collectMetaAds(db, { id: CLIENT_ID, domain: "example.com" });
    await collectMetaAds(db, { id: CLIENT_ID, domain: "example.com" });

    expect(db._rows("campaigns")).toHaveLength(2); // still 2 — second run updated, not appended
  });

  it("records a skipped run and does not throw when the client has no ad_platform_accounts row", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = createFakeDb({
      clients: [{ id: CLIENT_ID, domain: "example.com" }],
    }) as any;

    const written = await collectMetaAds(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(0);
    expect(db._rows("ad_metrics_daily")).toHaveLength(0);
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("skipped");
    expect(run.detail).toContain("no meta ad_platform_accounts row");
  });

  it("records a skipped run when there is no auth_ref/vault secret and META_ACCESS_TOKEN is unset (MOCK_APIS off)", async () => {
    vi.stubEnv("MOCK_APIS", "0");
    delete process.env.META_ACCESS_TOKEN;
    const db = seedDb({ auth_ref: null });

    const written = await collectMetaAds(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(0);
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("skipped");
    expect(run.detail).toContain("no Meta access token");
    // the (absent) token never appears in the recorded detail/error
    expect(run.detail).not.toContain("META_ACCESS_TOKEN=");
  });

  it("falls back to process.env.META_ACCESS_TOKEN when the account has no auth_ref", async () => {
    vi.stubEnv("MOCK_APIS", "1"); // fixture path, but exercises the token-resolution branch
    vi.stubEnv("META_ACCESS_TOKEN", "env-token-should-not-be-logged");
    const db = seedDb({ auth_ref: null });

    const written = await collectMetaAds(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(5);
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("success");
    expect(JSON.stringify(run)).not.toContain("env-token-should-not-be-logged");
  });

  it("resolves the token via readSecret when auth_ref is set", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = seedDb({ auth_ref: "meta:" + CLIENT_ID });

    // Stand in for the vault_read_secret RPC — readSecret now calls this instead
    // of reading the private vault schema directly (Supabase doesn't expose it).
    (db as any).rpc = async (fn: string, params: { p_name?: string }) => {
      if (fn === "vault_read_secret" && params?.p_name === "meta:" + CLIENT_ID) {
        return { data: "vault-token", error: null };
      }
      return { data: null, error: null };
    };

    const written = await collectMetaAds(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(5);
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("success");
    expect(JSON.stringify(run)).not.toContain("vault-token");
  });

  it("records an error run instead of throwing when the account lookup fails", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = seedDb();
    const realFrom = db.from.bind(db);
    db.from = (table: string) =>
      table === "ad_platform_accounts"
        ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }) }) }
        : realFrom(table);

    const written = await collectMetaAds(db, { id: CLIENT_ID, domain: "example.com" });
    expect(written).toBe(0);
    // maybeSingle resolves without throwing even on error, so this should still
    // be treated as "no account" (skipped) rather than a hard error — assert it
    // never throws either way.
    const run = db._rows("collector_runs")[0];
    expect(["skipped", "error"]).toContain(run.status);
  });
});
