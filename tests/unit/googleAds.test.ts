import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchAdMetrics, mintAccessToken, type GoogleAdsAuth, type GoogleAdsOAuth } from "@/lib/googleAds";

const OAUTH: GoogleAdsOAuth = {
  client_id: "cid.apps.googleusercontent.com",
  client_secret: "GOCSPX-secret",
  refresh_token: "refresh-token-value",
};

const AUTH: GoogleAdsAuth = {
  accessToken: "fake-access-token",
  developerToken: "fake-dev-token",
  loginCustomerId: "1112223333",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("googleAds.fetchAdMetrics under MOCK_APIS", () => {
  it("reads the fixture and maps GAQL rows into AdMetricRow, including cost_micros -> spend", async () => {
    vi.stubEnv("MOCK_APIS", "1");

    const rows = await fetchAdMetrics(AUTH, "1234567890", 28);
    expect(rows).toHaveLength(5);

    // 182300000 micros / 1_000_000 = 182.30
    expect(rows[0]).toMatchObject({
      date: "2026-06-22",
      campaign_id: "17300000001",
      campaign_name: "Search - Brand",
      adset_id: "138500000011",
      ad_id: "654100000111",
      impressions: 9120,
      clicks: 410,
      spend: 182.30,
      conversions: 12,
      revenue: 960.00,
    });

    // 419750000 micros / 1_000_000 = 419.75
    expect(rows[1]).toMatchObject({ ad_id: "654100000211", spend: 419.75, conversions: 9, revenue: 705.50 });
  });

  it("never attempts a network call while MOCK_APIS=1", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await fetchAdMetrics(AUTH, "1234567890", 28);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never logs or otherwise surfaces the developer token / access token", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const rows = await fetchAdMetrics(AUTH, "1234567890", 28);
    expect(JSON.stringify(rows)).not.toContain(AUTH.accessToken);
    expect(JSON.stringify(rows)).not.toContain(AUTH.developerToken);
  });
});

describe("googleAds.fetchAdMetrics live path (fetch mocked)", () => {
  it("POSTs to the v18 searchStream endpoint with the expected headers and flattens batched results", async () => {
    vi.stubEnv("MOCK_APIS", "0");

    const streamBody = [
      {
        results: [
          {
            segments: { date: "2026-07-01" },
            campaign: { id: "c1", name: "Campaign One" },
            ad_group: { id: "ag1" },
            ad_group_ad: { ad: { id: "ad1" } },
            metrics: {
              impressions: "1000",
              clicks: "50",
              cost_micros: "25000000",
              conversions: 3,
              conversions_value: 150.00,
            },
          },
        ],
      },
      {
        results: [
          {
            segments: { date: "2026-07-02" },
            campaign: { id: "c1", name: "Campaign One" },
            ad_group: { id: "ag1" },
            ad_group_ad: { ad: { id: "ad2" } },
            metrics: {
              impressions: "2000",
              clicks: "80",
              cost_micros: "40000000",
              conversions: 1,
              conversions_value: 0,
            },
          },
        ],
      },
    ];

    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => streamBody });
    vi.stubGlobal("fetch", fetchMock);

    const rows = await fetchAdMetrics(AUTH, "1234567890", 28);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ad_id: "ad1", spend: 25.00, conversions: 3, revenue: 150.00 });
    expect(rows[1]).toMatchObject({ ad_id: "ad2", spend: 40.00, conversions: 1, revenue: 0 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://googleads.googleapis.com/v18/customers/1234567890/googleAds:searchStream");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${AUTH.accessToken}`);
    expect(headers["developer-token"]).toBe(AUTH.developerToken);
    expect(headers["login-customer-id"]).toBe(AUTH.loginCustomerId);
    expect(String(init.body)).toContain("ad_group_ad.ad.id");
  });

  it("throws (does not swallow) when the API responds with a non-OK status", async () => {
    vi.stubEnv("MOCK_APIS", "0");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 401, statusText: "Unauthorized" }));

    await expect(fetchAdMetrics(AUTH, "1234567890", 28)).rejects.toThrow(/401/);
  });
});

describe("googleAds.mintAccessToken", () => {
  it("returns a placeholder without a network call under MOCK_APIS=1", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const token = await mintAccessToken(OAUTH);
    expect(token).toBe("mock-access-token");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("exchanges the refresh token for an access token (live path)", async () => {
    vi.stubEnv("MOCK_APIS", "0");
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "ya29.minted" }) });
    vi.stubGlobal("fetch", fetchMock);

    const token = await mintAccessToken(OAUTH);
    expect(token).toBe("ya29.minted");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const body = String(init.body);
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=refresh-token-value");
  });

  it("throws when the refresh response is non-OK", async () => {
    vi.stubEnv("MOCK_APIS", "0");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 400, statusText: "Bad Request" }));
    await expect(mintAccessToken(OAUTH)).rejects.toThrow(/400/);
  });

  it("throws when the refresh response omits access_token", async () => {
    vi.stubEnv("MOCK_APIS", "0");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({}) }));
    await expect(mintAccessToken(OAUTH)).rejects.toThrow(/no access_token/);
  });
});
