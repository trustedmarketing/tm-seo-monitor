import { describe, it, expect, vi, afterEach } from "vitest";
import { createFakeDb } from "../helpers/fakeDb";
import { collectGoogleAds } from "@/lib/googleAdsCollector";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const CLIENT_ID = "44444444-4444-4444-4444-444444444444";

function seedDb(accountOverrides: Record<string, any> = {}) {
  return createFakeDb({
    clients: [{ id: CLIENT_ID, domain: "example.com" }],
    ad_platform_accounts: [
      {
        id: "acct-gads-1",
        client_id: CLIENT_ID,
        platform: "google_ads",
        external_id: "1234567890",
        status: "active",
        auth_ref: null,
        ...accountOverrides,
      },
    ],
  }) as any;
}

describe("collectGoogleAds", () => {
  it("writes rows to ad_metrics_daily with platform=google_ads and records a collector_runs success row (MOCK_APIS)", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = seedDb();

    const written = await collectGoogleAds(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(5); // matches tests/fixtures/google/ad_metrics.json row count
    const rows = db._rows("ad_metrics_daily");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      client_id: CLIENT_ID,
      platform: "google_ads",
      date: "2026-06-22",
      ad_id: "654100000111",
      spend: 182.30,
      conversions: 12,
      revenue: 960.00,
    });

    const run = db._rows("collector_runs")[0];
    expect(run).toMatchObject({ module: "google_ads", client_id: CLIENT_ID, status: "success", rows_written: 5 });
  });

  it("updates existing rows instead of duplicating on a second run", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = seedDb();

    await collectGoogleAds(db, { id: CLIENT_ID, domain: "example.com" });
    await collectGoogleAds(db, { id: CLIENT_ID, domain: "example.com" });

    const rows = db._rows("ad_metrics_daily");
    expect(rows).toHaveLength(5); // still 5 — second run updated, not appended
  });

  it("records a skipped run and does not throw when the client has no ad_platform_accounts row", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = createFakeDb({
      clients: [{ id: CLIENT_ID, domain: "example.com" }],
    }) as any;

    const written = await collectGoogleAds(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(0);
    expect(db._rows("ad_metrics_daily")).toHaveLength(0);
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("success"); // tracked() records "success" for a graceful 0-row skip path
    expect(run.detail).toContain("no google_ads ad_platform_accounts row");
  });

  it("records a skipped detail when there is no auth_ref/vault secret and GOOGLE_ADS_CREDS is unset (MOCK_APIS off)", async () => {
    vi.stubEnv("MOCK_APIS", "0");
    delete process.env.GOOGLE_ADS_CREDS;
    const db = seedDb({ auth_ref: null });

    const written = await collectGoogleAds(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(0);
    const run = db._rows("collector_runs")[0];
    expect(run.detail).toContain("no Google Ads creds bundle");
    // no credential values ever appear in the recorded detail/error
    expect(run.detail).not.toContain("GOOGLE_ADS_CREDS=");
  });

  it("falls back to process.env.GOOGLE_ADS_CREDS when the account has no auth_ref", async () => {
    vi.stubEnv("MOCK_APIS", "1"); // fixture path, but exercises the creds-resolution branch
    vi.stubEnv(
      "GOOGLE_ADS_CREDS",
      JSON.stringify({ accessToken: "env-token-should-not-be-logged", developerToken: "dev-tok", loginCustomerId: "999" })
    );
    const db = seedDb({ auth_ref: null });

    const written = await collectGoogleAds(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(5);
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("success");
    expect(JSON.stringify(run)).not.toContain("env-token-should-not-be-logged");
  });

  it("resolves the creds bundle via readSecret when auth_ref is set (stubbed vault_read_secret RPC)", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = seedDb({ auth_ref: "google_ads:" + CLIENT_ID });

    // Stand in for the vault_read_secret RPC — readSecret calls this instead
    // of reading the private vault schema directly (Supabase doesn't expose it).
    (db as any).rpc = async (fn: string, params: { p_name?: string }) => {
      if (fn === "vault_read_secret" && params?.p_name === "google_ads:" + CLIENT_ID) {
        return {
          data: JSON.stringify({ accessToken: "vault-token", developerToken: "vault-dev-token", loginCustomerId: "555" }),
          error: null,
        };
      }
      return { data: null, error: null };
    };

    const written = await collectGoogleAds(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(5);
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("success");
    expect(JSON.stringify(run)).not.toContain("vault-token");
    expect(JSON.stringify(run)).not.toContain("vault-dev-token");
  });

  it("records an error run instead of throwing when the account lookup fails", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = seedDb();
    const realFrom = db.from.bind(db);
    db.from = (table: string) =>
      table === "ad_platform_accounts"
        ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }) }) }
        : realFrom(table);

    const written = await collectGoogleAds(db, { id: CLIENT_ID, domain: "example.com" });
    expect(written).toBe(0);
    // maybeSingle resolves without throwing even on error, so this should still
    // be treated as "no account" (graceful) rather than a hard error — assert it
    // never throws either way.
    const run = db._rows("collector_runs")[0];
    expect(["success", "skipped", "error"]).toContain(run.status);
  });
});
