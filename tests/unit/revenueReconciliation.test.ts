import { describe, it, expect, vi, afterEach } from "vitest";
import { createFakeDb } from "../helpers/fakeDb";
import { collectShopify } from "@/lib/shopifyCollector";
import { checkShopifyReconciliation, reconcile, TOLERANCE_ABS, TOLERANCE_PCT } from "@/lib/revenueReconciliation";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const CLIENT_ID = "44444444-4444-4444-4444-444444444444";
const FIXTURE_TOTAL = 2380.5 + 1450.0 + 3620.75 + 1890.25 + 2955.0; // 12296.50, tests/fixtures/shopify/daily_sales.json

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

function withVaultSecret(db: any, secret: string | null) {
  db.rpc = async (fn: string, _params: { p_name?: string }) => {
    if (fn === "vault_read_secret") return { data: secret, error: null };
    return { data: null, error: null };
  };
  return db;
}

describe("reconcile", () => {
  it("is not mismatched when stored and fresh agree exactly", () => {
    expect(reconcile(1000, 1000).mismatched).toBe(false);
  });

  it("tolerates drift under both the absolute and percentage thresholds", () => {
    const r = reconcile(1000, 1010); // $10 off, 1% off — under both thresholds
    expect(r.mismatched).toBe(false);
  });

  it("flags drift once both thresholds are cleared", () => {
    const r = reconcile(1000, 1200); // $200 off (> TOLERANCE_ABS), 16.7% off (> TOLERANCE_PCT)
    expect(r.mismatched).toBe(true);
    expect(r.diffAbs).toBeCloseTo(200);
    expect(r.diffPct).toBeCloseTo(200 / 1200);
  });

  it("does not flag a large dollar gap on a tiny account if it's still under the percentage bound", () => {
    // Guards the case TOLERANCE_ABS alone would miss: a $2000 stored vs $2020
    // fresh is $20 off (under TOLERANCE_ABS) regardless of account size.
    const r = reconcile(2000, 2020);
    expect(r.diffAbs).toBeLessThanOrEqual(TOLERANCE_ABS);
    expect(r.mismatched).toBe(false);
  });

  it("does not flag a tiny percentage gap on a huge account if the dollar gap alone exceeds tolerance", () => {
    // $100k stored vs $100,010 fresh is 0.01% off (well under TOLERANCE_PCT)
    // but $10 off in absolute terms — still under TOLERANCE_ABS, so this
    // should NOT mismatch; both gates must agree something's wrong.
    const r = reconcile(100_000, 100_010);
    expect(r.diffPct!).toBeLessThan(TOLERANCE_PCT);
    expect(r.mismatched).toBe(false);
  });

  it("returns a null diffPct (not Infinity/NaN) when fresh revenue is zero", () => {
    const r = reconcile(50, 0);
    expect(r.diffPct).toBeNull();
    expect(r.mismatched).toBe(true); // $50 off with nothing to divide by is still a real mismatch
  });
});

describe("checkShopifyReconciliation", () => {
  it("reports no mismatch when stored conversions_daily agrees with a fresh Shopify pull", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = withVaultSecret(seedDb(), "shpss_fake_secret");
    await collectShopify(db, { id: CLIENT_ID, domain: "example.com" }); // writes the exact fixture totals

    const result = await checkShopifyReconciliation(db, { id: CLIENT_ID, domain: "example.com" });

    expect(result).not.toBeNull();
    expect(result!.storedRevenue).toBeCloseTo(FIXTURE_TOTAL);
    expect(result!.freshRevenue).toBeCloseTo(FIXTURE_TOTAL);
    expect(result!.mismatched).toBe(false);

    const run = db._rows("collector_runs").find((r: any) => r.module === "shopify_reconciliation");
    expect(run).toMatchObject({ client_id: CLIENT_ID, status: "success" });
  });

  it("flags a mismatch when stored revenue has drifted from what Shopify reports now", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = withVaultSecret(seedDb(), "shpss_fake_secret");
    // Simulate the exact bug this was built to catch: a stale/incorrect stored
    // sum (e.g. from an unbounded date window) that no longer matches Shopify.
    await db.from("conversions_daily").insert({
      client_id: CLIENT_ID,
      date: "2026-06-22",
      source: "shopify",
      conversions: 999,
      revenue: FIXTURE_TOTAL + 5000,
    });

    const result = await checkShopifyReconciliation(db, { id: CLIENT_ID, domain: "example.com" });

    expect(result).not.toBeNull();
    expect(result!.mismatched).toBe(true);
    expect(result!.diffAbs).toBeCloseTo(5000);
  });

  it("compares only the dates Shopify itself returned, ignoring stored rows outside that window", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = withVaultSecret(seedDb(), "shpss_fake_secret");
    await collectShopify(db, { id: CLIENT_ID, domain: "example.com" });
    // An older stored row, outside the window Shopify just reported on. Summing
    // it in would invent a mismatch that isn't real — the two sides would be
    // answering different questions. This is the bug class the whole check exists
    // to catch, so the check itself must not commit it.
    await db.from("conversions_daily").insert({
      client_id: CLIENT_ID,
      date: "2026-01-15",
      source: "shopify",
      conversions: 40,
      revenue: 9999,
    });

    const result = await checkShopifyReconciliation(db, { id: CLIENT_ID, domain: "example.com" });

    expect(result!.windowStart).toBe("2026-06-22");
    expect(result!.windowEnd).toBe("2026-06-26");
    expect(result!.storedRevenue).toBeCloseTo(FIXTURE_TOTAL); // the 2026-01-15 row is excluded
    expect(result!.mismatched).toBe(false);
  });

  it("returns null and does not throw when the client has no shopify store configured", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = createFakeDb({ clients: [{ id: CLIENT_ID, domain: "example.com" }] }) as any;

    const result = await checkShopifyReconciliation(db, { id: CLIENT_ID, domain: "example.com" });

    expect(result).toBeNull();
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("success");
    expect(run.detail).toContain("no shopify client_stores row");
  });

  it("returns null and does not throw when the store has no auth_ref", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = seedDb({ auth_ref: null });

    const result = await checkShopifyReconciliation(db, { id: CLIENT_ID, domain: "example.com" });

    expect(result).toBeNull();
  });

  it("returns null and does not throw when the vault has no secret for the auth_ref", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = withVaultSecret(seedDb(), null);

    const result = await checkShopifyReconciliation(db, { id: CLIENT_ID, domain: "example.com" });

    expect(result).toBeNull();
  });

  it("records a collector_runs error row instead of throwing when the fresh Shopify API call fails", async () => {
    vi.stubEnv("MOCK_APIS", "0");
    const db = withVaultSecret(seedDb(), "shpss_fake_secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 500, statusText: "Server Error" }));

    const result = await checkShopifyReconciliation(db, { id: CLIENT_ID, domain: "example.com" });

    expect(result).toBeNull();
    const run = db._rows("collector_runs").find((r: any) => r.module === "shopify_reconciliation");
    expect(run.status).toBe("error");
  });

  it("never surfaces the client secret in the recorded collector_runs row", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = withVaultSecret(seedDb(), "shpss_should_never_be_logged");

    await checkShopifyReconciliation(db, { id: CLIENT_ID, domain: "example.com" });

    const run = db._rows("collector_runs").find((r: any) => r.module === "shopify_reconciliation");
    expect(JSON.stringify(run)).not.toContain("shpss_should_never_be_logged");
  });
});
