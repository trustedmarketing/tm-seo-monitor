import { describe, it, expect } from "vitest";
import { checkSpendGuard } from "@/lib/adSpendGuard";

describe("checkSpendGuard", () => {
  it("does not block when no guard is configured for the client/platform", () => {
    const result = checkSpendGuard(null, { projectedDailyBudget: 10_000, otherCampaignsMonthlyBudget: 0 });
    expect(result.blocked).toBe(false);
  });

  it("blocks when the projected daily budget exceeds the daily ceiling", () => {
    const result = checkSpendGuard(
      { daily_ceiling: 100, monthly_ceiling: null },
      { projectedDailyBudget: 150, otherCampaignsMonthlyBudget: 0 }
    );
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.reason).toContain("daily ceiling");
  });

  it("does not block at or under the daily ceiling", () => {
    const result = checkSpendGuard(
      { daily_ceiling: 100, monthly_ceiling: null },
      { projectedDailyBudget: 100, otherCampaignsMonthlyBudget: 0 }
    );
    expect(result.blocked).toBe(false);
  });

  it("blocks when projected monthly spend (this campaign + others) exceeds the monthly ceiling", () => {
    const result = checkSpendGuard(
      { daily_ceiling: null, monthly_ceiling: 3000 },
      { projectedDailyBudget: 50, otherCampaignsMonthlyBudget: 2000 } // 2000 + 50*30 = 3500
    );
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.reason).toContain("monthly ceiling");
  });

  it("accounts for other campaigns' committed monthly spend, not just this one", () => {
    const result = checkSpendGuard(
      { daily_ceiling: null, monthly_ceiling: 3000 },
      { projectedDailyBudget: 10, otherCampaignsMonthlyBudget: 2900 } // 2900 + 300 = 3200
    );
    expect(result.blocked).toBe(true);
  });

  it("does not block when comfortably under both ceilings", () => {
    const result = checkSpendGuard(
      { daily_ceiling: 200, monthly_ceiling: 5000 },
      { projectedDailyBudget: 50, otherCampaignsMonthlyBudget: 1000 }
    );
    expect(result.blocked).toBe(false);
  });
});
