import { describe, it, expect, beforeEach } from "vitest";
import { pause, resume, updateBudget, createCampaign } from "@/lib/googleAdsAdapter";
import type { GoogleAdsAuth } from "@/lib/googleAds";

beforeEach(() => { process.env.MOCK_APIS = "1"; });

const AUTH: GoogleAdsAuth = { accessToken: "t", developerToken: "d", loginCustomerId: "1234567890" };

describe("googleAdsAdapter · pause/resume", () => {
  it("DEFAULTS to dry run — writing to a live ad account must be deliberate", async () => {
    const res = await pause(AUTH, "1234567890", "17300000001", "active");
    expect(res.dryRun).toBe(true);
    expect(res.before).toBe("active");
    expect(res.after).toBe("paused");
  });

  it("executes when dryRun is explicitly false", async () => {
    const res = await resume(AUTH, "1234567890", "17300000001", "paused", { dryRun: false });
    expect(res.dryRun).toBe(false);
    expect(res.after).toBe("active");
  });
});

describe("googleAdsAdapter · updateBudget", () => {
  it("defaults to dry run and reports before/after in whole currency units", async () => {
    const res = await updateBudget(AUTH, "1234567890", "customers/1234567890/campaignBudgets/1", 30, 45);
    expect(res.dryRun).toBe(true);
    expect(res.before).toBe("30.00");
    expect(res.after).toBe("45.00");
  });

  it("executes when dryRun is explicitly false", async () => {
    const res = await updateBudget(AUTH, "1234567890", "customers/1234567890/campaignBudgets/1", 30, 45, { dryRun: false });
    expect(res.ok).toBe(true);
    expect(res.dryRun).toBe(false);
  });
});

describe("googleAdsAdapter · createCampaign", () => {
  it("defaults to dry run and creates nothing", async () => {
    const res = await createCampaign(AUTH, "1234567890", { name: "Test", advertisingChannelType: "SEARCH", dailyBudget: 20 });
    expect(res.dryRun).toBe(true);
    expect(res.campaignId).toBeNull();
  });

  it("returns a campaign id when executed", async () => {
    const res = await createCampaign(
      AUTH, "1234567890",
      { name: "Test", advertisingChannelType: "SEARCH", dailyBudget: 20 },
      { dryRun: false }
    );
    expect(res.dryRun).toBe(false);
    expect(res.campaignId).toBeTruthy();
  });
});
