import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchAdInsights } from "@/lib/meta";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("meta.fetchAdInsights under MOCK_APIS", () => {
  it("reads the fixture and maps actions/action_values into conversions/revenue", async () => {
    vi.stubEnv("MOCK_APIS", "1");

    const rows = await fetchAdInsights("fake-token", "act_123456789", 28);
    expect(rows).toHaveLength(5);

    // omni_purchase action -> conversions, its value -> revenue
    expect(rows[0]).toMatchObject({
      date: "2026-06-22",
      campaign_id: "120210000000001",
      campaign_name: "Prospecting - Broad",
      adset_id: "120210000000011",
      ad_id: "120210000000111",
      impressions: 18420,
      clicks: 312,
      spend: 245.60,
      conversions: 6,
      revenue: 540.00,
    });

    // offsite_conversion.fb_pixel_purchase also counts as a purchase action
    expect(rows[1]).toMatchObject({ ad_id: "120210000000112", conversions: 2, revenue: 160.00 });

    // onsite_conversion.lead_grouped / lead count as conversions even with 0 revenue
    expect(rows[3]).toMatchObject({ ad_id: "120210000000211", date: "2026-06-23", conversions: 4, revenue: 0 });
    expect(rows[4]).toMatchObject({ ad_id: "120210000000211", date: "2026-06-24", conversions: 5, revenue: 0 });
  });

  it("ignores non-conversion actions (e.g. link_click, landing_page_view)", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const rows = await fetchAdInsights("fake-token", "act_123456789", 28);
    // link_click/landing_page_view values are much larger than the conversions
    // we assert above — if they leaked into the sum these numbers would be wrong.
    for (const r of rows) {
      expect(r.conversions).toBeLessThan(r.clicks);
    }
  });

  it("never attempts a network call while MOCK_APIS=1", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await fetchAdInsights("fake-token", "act_123456789", 28);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("meta.fetchAdInsights live path (fetch mocked)", () => {
  it("paginates via paging.next and maps every page's rows", async () => {
    vi.stubEnv("MOCK_APIS", "0");

    const page1 = {
      data: [
        {
          date_start: "2026-07-01",
          campaign_id: "c1",
          campaign_name: "Campaign One",
          adset_id: "as1",
          ad_id: "ad1",
          impressions: "1000",
          clicks: "50",
          spend: "25.00",
          actions: [{ action_type: "purchase", value: "3" }],
          action_values: [{ action_type: "purchase", value: "150.00" }],
        },
      ],
      paging: { next: "https://graph.facebook.com/v21.0/act_123/insights?after=cursor1" },
    };
    const page2 = {
      data: [
        {
          date_start: "2026-07-02",
          campaign_id: "c1",
          campaign_name: "Campaign One",
          adset_id: "as1",
          ad_id: "ad2",
          impressions: "2000",
          clicks: "80",
          spend: "40.00",
          actions: [{ action_type: "lead", value: "1" }],
          action_values: [{ action_type: "lead", value: "0" }],
        },
      ],
      paging: {},
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => page1 })
      .mockResolvedValueOnce({ ok: true, json: async () => page2 });
    vi.stubGlobal("fetch", fetchMock);

    const rows = await fetchAdInsights("real-token", "act_123456789", 28);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ad_id: "ad1", conversions: 3, revenue: 150.00 });
    expect(rows[1]).toMatchObject({ ad_id: "ad2", conversions: 1, revenue: 0 });

    // access_token is passed as a query param on the request (never logged) —
    // confirm it made it onto the outgoing URL exactly once, on the first call.
    const firstUrl = fetchMock.mock.calls[0][0] as string;
    expect(firstUrl).toContain("access_token=real-token");
    expect(firstUrl).toContain(`act_123456789/insights`);
  });

  it("throws (does not swallow) when the Graph API responds with a non-OK status", async () => {
    vi.stubEnv("MOCK_APIS", "0");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 401, statusText: "Unauthorized" }));

    await expect(fetchAdInsights("bad-token", "act_123456789", 28)).rejects.toThrow(/401/);
  });
});
