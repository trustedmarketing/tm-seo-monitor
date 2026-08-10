import { describe, it, expect, beforeEach } from "vitest";
import { pause, resume, updateBudget, createCampaign } from "@/lib/microsoftAdsAdapter";
import type { MicrosoftAdsAuth } from "@/lib/microsoftAds";

beforeEach(() => { process.env.MOCK_APIS = "1"; });

const AUTH: MicrosoftAdsAuth = { developerToken: "d", accessToken: "t", customerId: "cust-1" };

describe("microsoftAdsAdapter · pause/resume", () => {
  it("DEFAULTS to dry run — writing to a live ad account must be deliberate", async () => {
    const res = await pause(AUTH, "act_ms_1", "300210000001", "active");
    expect(res.dryRun).toBe(true);
    expect(res.before).toBe("active");
    expect(res.after).toBe("paused");
  });

  it("executes when dryRun is explicitly false", async () => {
    const res = await resume(AUTH, "act_ms_1", "300210000001", "paused", { dryRun: false });
    expect(res.dryRun).toBe(false);
    expect(res.after).toBe("active");
  });
});

describe("microsoftAdsAdapter · updateBudget", () => {
  it("defaults to dry run and reports before/after with no micros conversion", async () => {
    const res = await updateBudget(AUTH, "act_ms_1", "300210000001", 40, 55);
    expect(res.dryRun).toBe(true);
    expect(res.before).toBe("40.00");
    expect(res.after).toBe("55.00");
  });
});

describe("microsoftAdsAdapter · createCampaign", () => {
  it("defaults to dry run and creates nothing", async () => {
    const res = await createCampaign(AUTH, "act_ms_1", { name: "Test", campaignType: "Search", dailyBudget: 15 });
    expect(res.dryRun).toBe(true);
    expect(res.campaignId).toBeNull();
  });

  it("returns a campaign id when executed", async () => {
    const res = await createCampaign(
      AUTH, "act_ms_1",
      { name: "Test", campaignType: "Search", dailyBudget: 15 },
      { dryRun: false }
    );
    expect(res.dryRun).toBe(false);
    expect(res.campaignId).toBeTruthy();
  });
});
