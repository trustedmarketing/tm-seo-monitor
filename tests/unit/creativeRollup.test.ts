import { describe, it, expect } from "vitest";
import { buildCreativeRollups, latestDate, type CreativeMetricRow } from "@/lib/creativeRollup";

function row(overrides: Partial<CreativeMetricRow> = {}): CreativeMetricRow {
  return {
    creative_id: "cr-1",
    campaign_id: "camp-1",
    campaign_name: "Prospecting - Broad",
    platform: "meta",
    date: "2026-06-22",
    spend: 100,
    revenue: 300,
    impressions: 1000,
    clicks: 20,
    ...overrides,
  };
}

describe("latestDate", () => {
  it("returns the max date, or null when empty", () => {
    expect(latestDate([{ date: "2026-06-20" }, { date: "2026-06-22" }])).toBe("2026-06-22");
    expect(latestDate([])).toBeNull();
  });
});

describe("buildCreativeRollups", () => {
  it("excludes rows with no creative_id (Google Ads / Microsoft today)", () => {
    const rollups = buildCreativeRollups([
      row({ creative_id: null, platform: "google_ads" }),
      row({ creative_id: null, platform: "microsoft" }),
    ]);
    expect(rollups).toHaveLength(0);
  });

  it("groups by platform + creative_id separately, even if the same creative_id string appears on two platforms", () => {
    const rollups = buildCreativeRollups([
      row({ platform: "meta", creative_id: "cr-1" }),
      row({ platform: "google_ads", creative_id: "cr-1" }), // hypothetical collision — different platform, different creative
    ]);
    expect(rollups).toHaveLength(2);
    expect(rollups.map((r) => r.id).sort()).toEqual(["google_ads:cr-1", "meta:cr-1"]);
  });

  it("computes day-prior, 7-day, and 30-day windows anchored on the latest date present", () => {
    const rows = [
      row({ date: "2026-06-22", spend: 100, revenue: 400, impressions: 1000, clicks: 20 }), // anchor day
      row({ date: "2026-06-21", spend: 100, revenue: 200, impressions: 1000, clicks: 10 }),
      row({ date: "2026-05-25", spend: 100, revenue: 100, impressions: 1000, clicks: 5 }), // within 30d only
    ];
    const [r] = buildCreativeRollups(rows);

    expect(r.dayPriorSpend).toBe(100);
    expect(r.dayPriorRoas).toBeCloseTo(4);
    expect(r.dayPriorCtr).toBeCloseTo(2); // 20/1000 * 100

    expect(r.sevenDaySpend).toBe(200);
    expect(r.sevenDayRoas).toBeCloseTo(3); // 600/200
    expect(r.sevenDayCtr).toBeCloseTo(1.5); // 30/2000 * 100

    expect(r.thirtyDaySpend).toBe(300);
    expect(r.thirtyDayRevenue).toBe(700);
    expect(r.thirtyDayRoas).toBeCloseTo(700 / 300);
    expect(r.thirtyDayImpressions).toBe(3000);
    expect(r.thirtyDayClicks).toBe(35);
    expect(r.thirtyDayCtr).toBeCloseTo(35 / 3000 * 100);
  });

  it("returns null ROAS/CTR (not 0 or Infinity) for a window with zero spend/impressions", () => {
    const [r] = buildCreativeRollups([row({ date: "2026-06-01", spend: 0, revenue: 0, impressions: 0, clicks: 0 })], "2026-06-22");
    expect(r.dayPriorRoas).toBeNull();
    expect(r.dayPriorCtr).toBeNull();
  });

  it("collects every distinct campaign name a creative has run under", () => {
    const [r] = buildCreativeRollups([
      row({ date: "2026-06-22", campaign_name: "Prospecting - Broad" }),
      row({ date: "2026-06-21", campaign_name: "Retargeting - Warm" }),
    ]);
    expect(r.campaignNames.sort()).toEqual(["Prospecting - Broad", "Retargeting - Warm"]);
  });

  it("respects an explicit asOf anchor instead of the metrics' own latest date", () => {
    const rows = [row({ date: "2026-06-22", spend: 100 }), row({ date: "2026-06-15", spend: 50 })];
    const [r] = buildCreativeRollups(rows, "2026-06-15");
    expect(r.dayPriorSpend).toBe(50);
  });
});
