import { describe, it, expect, beforeEach } from "vitest";
import { adCreativePromptFor, generateCreative, pollCreative, fanOutSizes, PRIMARY_ASPECT_RATIO, FAN_OUT_ASPECT_RATIOS } from "@/lib/adCreative";

beforeEach(() => { process.env.MOCK_APIS = "1"; });

describe("adCreativePromptFor", () => {
  it("describes the subject without restating brand styling", () => {
    const prompt = adCreativePromptFor(
      { campaignName: "Prospecting - Broad", personaName: "Weekend boat owner", messagingAngle: "Save a Saturday", offer: "20% off" },
      "4:5"
    );
    expect(prompt).toContain("Prospecting - Broad");
    expect(prompt).toContain("Weekend boat owner");
    expect(prompt).toContain("Save a Saturday");
    expect(prompt).toContain("20% off");
    expect(prompt).toContain("4:5");
  });

  it("omits optional fields cleanly when absent", () => {
    const prompt = adCreativePromptFor({ campaignName: "Test" }, "1:1");
    expect(prompt).toContain("Test");
    expect(prompt).not.toContain("null");
    expect(prompt).not.toContain("undefined");
  });
});

describe("generateCreative / pollCreative", () => {
  it("starts a Bloom job and returns the prompt used", async () => {
    const res = await generateCreative("key", "brand-1", { campaignName: "Test" }, "4:5");
    expect(res.bloomImageId).toBeTruthy();
    expect(res.prompt).toContain("4:5");
  });

  it("polls the job status", async () => {
    const state = await pollCreative("key", "mock-image");
    expect(state.status).toBe("completed");
  });
});

describe("fanOutSizes — the fan-out gate", () => {
  it("returns nothing for an unapproved 4:5 concept", () => {
    expect(fanOutSizes(PRIMARY_ASPECT_RATIO, false)).toHaveLength(0);
  });

  it("returns 1:1 and 9:16 once the 4:5 concept is approved", () => {
    expect(fanOutSizes(PRIMARY_ASPECT_RATIO, true)).toEqual(FAN_OUT_ASPECT_RATIOS);
  });

  it("never fans out from a non-primary aspect ratio, approved or not", () => {
    expect(fanOutSizes("1:1", true)).toHaveLength(0);
    expect(fanOutSizes("9:16", true)).toHaveLength(0);
  });
});
