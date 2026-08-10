import { describe, it, expect, vi, afterEach } from "vitest";
import { createFakeDb } from "../helpers/fakeDb";
import { collectMicrosoftAds } from "@/lib/microsoftAdsCollector";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete process.env.MICROSOFT_ADS_CREDS;
});

const CLIENT_ID = "55555555-5555-5555-5555-555555555555";

const CREDS_JSON = JSON.stringify({
  developerToken: "dev-token-should-not-be-logged",
  accessToken: "access-token-should-not-be-logged",
  customerId: "cust-1",
});

function seedDb(accountOverrides: Record<string, any> = {}) {
  return createFakeDb({
    clients: [{ id: CLIENT_ID, domain: "example.com" }],
    ad_platform_accounts: [
      {
        id: "acct-ms-1",
        client_id: CLIENT_ID,
        platform: "microsoft",
        external_id: "act_ms_123456",
        status: "active",
        auth_ref: null,
        ...accountOverrides,
      },
    ],
  }) as any;
}

// Stand in for the vault_read_secret RPC — readSecret calls this rather than
// reading the private vault schema directly (Supabase doesn't expose it).
function withVaultSecret(db: any, secret: string | null) {
  db.rpc = async (fn: string, _params: { p_name?: string }) => {
    if (fn === "vault_read_secret") return { data: secret, error: null };
    return { data: null, error: null };
  };
  return db;
}

describe("collectMicrosoftAds", () => {
  it("writes rows to ad_metrics_daily(platform='microsoft') and records a collector_runs success row", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = withVaultSecret(seedDb({ auth_ref: "microsoft:" + CLIENT_ID }), CREDS_JSON);

    const written = await collectMicrosoftAds(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(5); // matches tests/fixtures/microsoft/ad_metrics.json row count
    const rows = db._rows("ad_metrics_daily");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      client_id: CLIENT_ID,
      platform: "microsoft",
      date: "2026-06-22",
      ad_id: "300210000111",
      conversions: 9,
      revenue: 810.00,
    });

    const run = db._rows("collector_runs")[0];
    expect(run).toMatchObject({ module: "microsoft_ads", client_id: CLIENT_ID, status: "success", rows_written: 5 });
  });

  it("updates existing rows instead of duplicating on a second run", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = withVaultSecret(seedDb({ auth_ref: "microsoft:" + CLIENT_ID }), CREDS_JSON);

    await collectMicrosoftAds(db, { id: CLIENT_ID, domain: "example.com" });
    await collectMicrosoftAds(db, { id: CLIENT_ID, domain: "example.com" });

    const rows = db._rows("ad_metrics_daily");
    expect(rows).toHaveLength(5); // still 5 — second run updated, not appended
  });

  it("records a run and does not throw when the client has no ad_platform_accounts row (platform='microsoft')", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = createFakeDb({
      clients: [{ id: CLIENT_ID, domain: "example.com" }],
    }) as any;

    const written = await collectMicrosoftAds(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(0);
    expect(db._rows("ad_metrics_daily")).toHaveLength(0);
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("success");
    expect(run.rows_written).toBe(0);
    expect(run.detail).toContain("no microsoft ad_platform_accounts row");
  });

  it("does not pick up a meta or google_ads ad_platform_accounts row for the same client", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = createFakeDb({
      clients: [{ id: CLIENT_ID, domain: "example.com" }],
      ad_platform_accounts: [
        { id: "acct-meta-1", client_id: CLIENT_ID, platform: "meta", external_id: "act_meta_1", status: "active", auth_ref: null },
      ],
    }) as any;

    const written = await collectMicrosoftAds(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(0);
    const run = db._rows("collector_runs")[0];
    expect(run.detail).toContain("no microsoft ad_platform_accounts row");
  });

  it("records a skipped-equivalent run (no throw) when there is no auth_ref/vault secret and MICROSOFT_ADS_CREDS is unset (MOCK_APIS off)", async () => {
    vi.stubEnv("MOCK_APIS", "0");
    delete process.env.MICROSOFT_ADS_CREDS;
    const db = seedDb({ auth_ref: null });

    const written = await collectMicrosoftAds(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(0);
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("success");
    expect(run.detail).toContain("no Microsoft Ads credentials");
    // credentials never appear in the recorded detail/error
    expect(run.detail).not.toContain("MICROSOFT_ADS_CREDS=");
  });

  it("falls back to process.env.MICROSOFT_ADS_CREDS when the account has no auth_ref", async () => {
    vi.stubEnv("MOCK_APIS", "1"); // fixture path, but exercises the credential-resolution branch
    vi.stubEnv("MICROSOFT_ADS_CREDS", CREDS_JSON);
    const db = seedDb({ auth_ref: null });

    const written = await collectMicrosoftAds(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(5);
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("success");
    expect(JSON.stringify(run)).not.toContain("access-token-should-not-be-logged");
    expect(JSON.stringify(run)).not.toContain("dev-token-should-not-be-logged");
  });

  it("resolves the credential bundle via readSecret (vault_read_secret RPC) when auth_ref is set", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = seedDb({ auth_ref: "microsoft:" + CLIENT_ID });

    (db as any).rpc = async (fn: string, params: { p_name?: string }) => {
      if (fn === "vault_read_secret" && params?.p_name === "microsoft:" + CLIENT_ID) {
        return { data: CREDS_JSON, error: null };
      }
      return { data: null, error: null };
    };

    const written = await collectMicrosoftAds(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(5);
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("success");
    expect(JSON.stringify(run)).not.toContain("access-token-should-not-be-logged");
    expect(JSON.stringify(run)).not.toContain("dev-token-should-not-be-logged");
  });

  it("never surfaces the credential bundle in the recorded collector_runs row", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = withVaultSecret(seedDb({ auth_ref: "microsoft:" + CLIENT_ID }), CREDS_JSON);

    await collectMicrosoftAds(db, { id: CLIENT_ID, domain: "example.com" });

    const run = db._rows("collector_runs")[0];
    expect(JSON.stringify(run)).not.toContain("access-token-should-not-be-logged");
    expect(JSON.stringify(run)).not.toContain("dev-token-should-not-be-logged");
  });

  it("records a collector_runs error row instead of throwing when the reporting API call fails", async () => {
    vi.stubEnv("MOCK_APIS", "0");
    const db = withVaultSecret(seedDb({ auth_ref: "microsoft:" + CLIENT_ID }), CREDS_JSON);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 500, statusText: "Server Error" }));

    const written = await collectMicrosoftAds(db, { id: CLIENT_ID, domain: "example.com" });

    expect(written).toBe(0);
    expect(db._rows("ad_metrics_daily")).toHaveLength(0);
    const run = db._rows("collector_runs")[0];
    expect(run).toMatchObject({ module: "microsoft_ads", client_id: CLIENT_ID, status: "error" });
  });

  it("syncs campaign status/budget/objective into the campaigns registry (WO-006 stream A)", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = withVaultSecret(seedDb({ auth_ref: "microsoft:" + CLIENT_ID }), CREDS_JSON);

    await collectMicrosoftAds(db, { id: CLIENT_ID, domain: "example.com" });

    const campaigns = db._rows("campaigns");
    expect(campaigns).toHaveLength(2); // matches tests/fixtures/microsoft/campaigns.json
    expect(campaigns).toContainEqual(
      expect.objectContaining({
        client_id: CLIENT_ID,
        platform: "microsoft",
        campaign_id: "300210000002",
        campaign_name: "PMax - Retail",
        status: "paused",
        objective: "PerformanceMax",
        daily_budget: 25,
      })
    );
  });

  it("updates campaign rows instead of duplicating on a second run", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = withVaultSecret(seedDb({ auth_ref: "microsoft:" + CLIENT_ID }), CREDS_JSON);

    await collectMicrosoftAds(db, { id: CLIENT_ID, domain: "example.com" });
    await collectMicrosoftAds(db, { id: CLIENT_ID, domain: "example.com" });

    expect(db._rows("campaigns")).toHaveLength(2); // still 2 — second run updated, not appended
  });
});
