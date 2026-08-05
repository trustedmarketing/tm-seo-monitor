import { describe, it, expect, beforeEach } from "vitest";
import { pause, resume, updateBudget, createCampaign } from "@/lib/metaAdsAdapter";

beforeEach(() => { process.env.MOCK_APIS = "1"; });

describe("metaAdsAdapter · pause/resume", () => {
  it("DEFAULTS to dry run — writing to a live ad account must be deliberate", async () => {
    const res = await pause("token", "120210000000001", "active"); // no opts
    expect(res.dryRun).toBe(true);
    expect(res.detail).toMatch(/nothing written/i);
    expect(res.before).toBe("active");
    expect(res.after).toBe("paused");
  });

  it("resume reports the inverse before/after", async () => {
    const res = await resume("token", "120210000000001", "paused", { dryRun: false });
    expect(res.dryRun).toBe(false);
    expect(res.before).toBe("paused");
    expect(res.after).toBe("active");
  });
});

describe("metaAdsAdapter · updateBudget", () => {
  it("defaults to dry run and reports before/after in whole currency units", async () => {
    const res = await updateBudget("token", "120210000000001", 50, 65);
    expect(res.dryRun).toBe(true);
    expect(res.before).toBe("50.00");
    expect(res.after).toBe("65.00");
  });

  it("executes when dryRun is explicitly false", async () => {
    const res = await updateBudget("token", "120210000000001", 50, 65, { dryRun: false });
    expect(res.ok).toBe(true);
    expect(res.dryRun).toBe(false);
  });
});

describe("metaAdsAdapter · createCampaign", () => {
  it("defaults to dry run and creates nothing", async () => {
    const res = await createCampaign("token", "act_123", { name: "Test campaign", objective: "OUTCOME_SALES", dailyBudget: 25 });
    expect(res.dryRun).toBe(true);
    expect(res.campaignId).toBeNull();
    expect(res.after).toContain("paused");
  });

  it("returns a campaign id when executed", async () => {
    const res = await createCampaign(
      "token", "act_123",
      { name: "Test campaign", objective: "OUTCOME_SALES", dailyBudget: 25 },
      { dryRun: false }
    );
    expect(res.dryRun).toBe(false);
    expect(res.campaignId).toBeTruthy();
  });
});
