import { describe, it, expect } from "vitest";
import { buildCampaignRollups, latestDate, type CampaignRollupInput, type MetricRow } from "@/lib/paidRollup";

const CAMPAIGN: CampaignRollupInput = {
  id: "camp-1",
  platform: "meta",
  campaign_id: "120210000000001",
  campaign_name: "Prospecting - Broad",
  status: "active",
  daily_budget: 50,
};

function metric(date: string, spend: number, revenue: number): MetricRow {
  return { campaign_id: "120210000000001", platform: "meta", date, spend, revenue };
}

describe("latestDate", () => {
  it("returns the max date across rows, or null when empty", () => {
    expect(latestDate([{ date: "2026-06-20" }, { date: "2026-06-22" }, { date: "2026-06-21" }])).toBe("2026-06-22");
    expect(latestDate([])).toBeNull();
  });
});

describe("buildCampaignRollups", () => {
  it("computes day-prior, 7-day, and 30-day trailing ROAS anchored on the latest metrics date", () => {
    const metrics: MetricRow[] = [
      metric("2026-06-22", 100, 400), // anchor day: 4x
      metric("2026-06-21", 100, 200), // within 7d and 30d: 2x
      metric("2026-05-25", 100, 100), // within 30d only (28 days before anchor): 1x
      metric("2026-04-01", 999, 999), // outside every window
    ];

    const [rollup] = buildCampaignRollups([CAMPAIGN], metrics);

    expect(rollup.dayPriorSpend).toBe(100);
    expect(rollup.dayPriorRoas).toBeCloseTo(4);

    expect(rollup.sevenDaySpend).toBe(200); // anchor + 06-21 only
    expect(rollup.sevenDayRoas).toBeCloseTo(3); // 600 / 200

    expect(rollup.thirtyDaySpend).toBe(300); // anchor + 06-21 + 05-25
    expect(rollup.thirtyDayRoas).toBeCloseTo(700 / 300);
  });

  it("returns null ROAS (not 0 or Infinity) for a window with zero spend", () => {
    const [rollup] = buildCampaignRollups([CAMPAIGN], []);

    expect(rollup.dayPriorRoas).toBeNull();
    expect(rollup.sevenDayRoas).toBeNull();
    expect(rollup.thirtyDayRoas).toBeNull();
    expect(rollup.dayPriorSpend).toBe(0);
  });

  it("only aggregates metrics matching both platform and campaign_id", () => {
    const metrics: MetricRow[] = [
      metric("2026-06-22", 100, 400),
      { campaign_id: "120210000000001", platform: "google_ads", date: "2026-06-22", spend: 999, revenue: 999 }, // different platform, same campaign_id
      { campaign_id: "other-campaign", platform: "meta", date: "2026-06-22", spend: 999, revenue: 999 }, // different campaign
    ];

    const [rollup] = buildCampaignRollups([CAMPAIGN], metrics);

    expect(rollup.dayPriorSpend).toBe(100);
  });

  it("respects an explicit asOf anchor instead of the metrics' own latest date", () => {
    const metrics: MetricRow[] = [metric("2026-06-22", 100, 400), metric("2026-06-15", 50, 100)];

    const [rollup] = buildCampaignRollups([CAMPAIGN], metrics, "2026-06-15");

    expect(rollup.dayPriorSpend).toBe(50); // anchored on 06-15, not the later 06-22 row
  });
});
