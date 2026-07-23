import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchAdMetrics } from "@/lib/microsoftAds";

const AUTH = { developerToken: "dev-token", accessToken: "access-token", customerId: "cust-1" };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("microsoftAds.fetchAdMetrics under MOCK_APIS", () => {
  it("reads the fixture and maps report rows into DB-ready rows", async () => {
    vi.stubEnv("MOCK_APIS", "1");

    const rows = await fetchAdMetrics(AUTH, "act_ms_123", 28);
    expect(rows).toHaveLength(5); // matches tests/fixtures/microsoft/ad_metrics.json row count

    expect(rows[0]).toMatchObject({
      date: "2026-06-22",
      campaign_id: "300210000001",
      campaign_name: "Search - Brand",
      adset_id: "300210000011",
      ad_id: "300210000111",
      impressions: 6420,
      clicks: 212,
      spend: 115.60,
      conversions: 9,
      revenue: 810.00,
    });

    expect(rows[3]).toMatchObject({
      date: "2026-06-23",
      campaign_id: "300210000002",
      campaign_name: "PMax - Retail",
      adset_id: "300210000021",
      ad_id: "300210000211",
      conversions: 2,
      revenue: 150.00,
    });
  });

  it("never attempts a network call while MOCK_APIS=1", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await fetchAdMetrics(AUTH, "act_ms_123", 28);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("microsoftAds.fetchAdMetrics live path (fetch mocked)", () => {
  it("posts the auth bundle as headers and maps the response rows", async () => {
    vi.stubEnv("MOCK_APIS", "0");

    const responseBody = {
      rows: [
        {
          TimePeriod: "2026-07-01",
          CampaignId: "c1",
          CampaignName: "Campaign One",
          AdGroupId: "ag1",
          AdId: "ad1",
          Impressions: "1000",
          Clicks: "50",
          Spend: "25.00",
          Conversions: "3",
          Revenue: "150.00",
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => responseBody });
    vi.stubGlobal("fetch", fetchMock);

    const rows = await fetchAdMetrics(AUTH, "act_ms_123", 28);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ad_id: "ad1", campaign_id: "c1", adset_id: "ag1", conversions: 3, revenue: 150.00 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("AdPerformanceReport");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer access-token");
    expect(headers.DeveloperToken).toBe("dev-token");
    expect(headers.CustomerId).toBe("cust-1");
    expect(headers.CustomerAccountId).toBe("act_ms_123");
  });

  it("throws (does not swallow) when the Reporting API responds with a non-OK status", async () => {
    vi.stubEnv("MOCK_APIS", "0");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 401, statusText: "Unauthorized" }));

    await expect(fetchAdMetrics(AUTH, "act_ms_123", 28)).rejects.toThrow(/401/);
  });
});
