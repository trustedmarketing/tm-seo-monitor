import { describe, it, expect } from "vitest";
import { buildPaidRecommendations } from "@/lib/paidRecommendations";
import type { CampaignRollup } from "@/lib/paidRollup";

function rollup(overrides: Partial<CampaignRollup> = {}): CampaignRollup {
  return {
    id: "camp-1",
    platform: "meta",
    campaignId: "120210000000001",
    campaignName: "Prospecting - Broad",
    status: "active",
    dailyBudget: null,
    dayPriorRoas: null,
    dayPriorSpend: 0,
    sevenDayRoas: null,
    sevenDaySpend: 0,
    thirtyDayRoas: null,
    thirtyDaySpend: 0,
    thirtyDayRevenue: 0,
    ...overrides,
  };
}

describe("buildPaidRecommendations", () => {
  it("flags 30-day ROAS below the tier benchmark, severity high when well under target", () => {
    // meta benchmark low = 2 (docs/tm-growth-os-plan.md Module C); 0.5x is under 60% of that.
    const recs = buildPaidRecommendations([rollup({ thirtyDaySpend: 1000, thirtyDayRoas: 0.5 })]);

    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ category: "Paid", severity: "high" });
    expect(recs[0].title).toContain("30-day ROAS");
  });

  it("flags 30-day ROAS below target as medium severity when only moderately under", () => {
    const recs = buildPaidRecommendations([rollup({ thirtyDaySpend: 1000, thirtyDayRoas: 1.5 })]); // < 2 but >= 1.2

    expect(recs[0]).toMatchObject({ severity: "medium" });
  });

  it("flags a 7-day dip as an early warning when the 30-day trailing figure is still healthy", () => {
    const recs = buildPaidRecommendations([
      rollup({ thirtyDaySpend: 1000, thirtyDayRoas: 3, sevenDaySpend: 200, sevenDayRoas: 1.2 }),
    ]);

    expect(recs.some((r) => r.key.startsWith("paid_roas_7d_"))).toBe(true);
    expect(recs.some((r) => r.key.startsWith("paid_roas_30d_"))).toBe(false);
  });

  it("does not double-flag both 30-day and 7-day rules for the same underperforming campaign", () => {
    const recs = buildPaidRecommendations([
      rollup({ thirtyDaySpend: 1000, thirtyDayRoas: 1, sevenDaySpend: 200, sevenDayRoas: 0.8 }),
    ]);

    const roasRecs = recs.filter((r) => r.key.includes("paid_roas_"));
    expect(roasRecs).toHaveLength(1);
    expect(roasRecs[0].key).toContain("30d");
  });

  it("flags a sharp day-prior vs 7-day divergence", () => {
    const recs = buildPaidRecommendations([
      rollup({ dayPriorSpend: 50, dayPriorRoas: 0.5, sevenDaySpend: 300, sevenDayRoas: 3 }),
    ]);

    expect(recs.some((r) => r.key.startsWith("paid_day_drop_"))).toBe(true);
  });

  it("flags budget pacing when yesterday's spend runs well over the daily budget", () => {
    const recs = buildPaidRecommendations([rollup({ dailyBudget: 50, dayPriorSpend: 80 })]); // 160%

    const pacingRec = recs.find((r) => r.key.startsWith("paid_pacing_over_"));
    expect(pacingRec).toBeDefined();
    expect(pacingRec!.title).toContain("160%");
  });

  it("does not flag budget pacing within the normal band", () => {
    const recs = buildPaidRecommendations([rollup({ dailyBudget: 50, dayPriorSpend: 55 })]); // 110%

    expect(recs.some((r) => r.key.startsWith("paid_pacing_over_"))).toBe(false);
  });

  it("flags an active campaign with zero spend across 30 days", () => {
    const recs = buildPaidRecommendations([rollup({ status: "active", thirtyDaySpend: 0 })]);

    expect(recs.some((r) => r.key.startsWith("paid_zero_spend_"))).toBe(true);
  });

  it("never flags a removed campaign for anything", () => {
    const recs = buildPaidRecommendations([
      rollup({ status: "removed", thirtyDaySpend: 0, dailyBudget: 50, dayPriorSpend: 500 }),
    ]);

    expect(recs).toHaveLength(0);
  });

  it("caps output at 8 recommendations, highest severity first", () => {
    const many: CampaignRollup[] = Array.from({ length: 20 }, (_, i) =>
      rollup({ id: `camp-${i}`, thirtyDaySpend: 1000, thirtyDayRoas: 0.1 }) // all high severity
    );

    const recs = buildPaidRecommendations(many);
    expect(recs).toHaveLength(8);
    expect(recs.every((r) => r.severity === "high")).toBe(true);
  });
});
