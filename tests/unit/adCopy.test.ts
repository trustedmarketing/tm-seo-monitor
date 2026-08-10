import { describe, it, expect, beforeEach } from "vitest";
import { generateAdCopy, promptFor, schemaFor } from "@/lib/adCopy";
import type { AdCreativeBrief } from "@/lib/adCreative";

beforeEach(() => { process.env.MOCK_APIS = "1"; });

const BRIEF: AdCreativeBrief = {
  campaignName: "Prospecting - Broad",
  personaName: "Weekend boat owner",
  messagingAngle: "Save a Saturday",
  offer: "20% off",
};

describe("promptFor", () => {
  it("states Google RSA's real count/character limits", () => {
    const prompt = promptFor("google_ads", "rsa", BRIEF);
    expect(prompt).toContain("3-15 headlines");
    expect(prompt).toContain("30 characters");
    expect(prompt).toContain("2-4 descriptions");
    expect(prompt).toContain("90 characters");
  });

  it("states Google PMax's real limits, including long headlines and business name", () => {
    const prompt = promptFor("google_ads", "pmax", BRIEF);
    expect(prompt).toContain("1-5 long headlines");
    expect(prompt).toContain("business name");
    expect(prompt).toContain("25 characters");
  });

  it("states Meta feed's real limits, including primary text", () => {
    const prompt = promptFor("meta", "meta_feed", BRIEF);
    expect(prompt).toContain("primary text");
    expect(prompt).toContain("125 characters");
    expect(prompt).toContain("1-5 headlines");
    expect(prompt).toContain("40 characters");
  });

  it("includes the brief's persona/angle/offer when present", () => {
    const prompt = promptFor("google_ads", "rsa", BRIEF);
    expect(prompt).toContain("Prospecting - Broad");
    expect(prompt).toContain("Weekend boat owner");
    expect(prompt).toContain("Save a Saturday");
    expect(prompt).toContain("20% off");
  });

  it("omits optional brief fields cleanly when absent", () => {
    const prompt = promptFor("google_ads", "rsa", { campaignName: "Bare Campaign" });
    expect(prompt).toContain("Bare Campaign");
    expect(prompt).not.toContain("null");
    expect(prompt).not.toContain("undefined");
  });
});

describe("schemaFor", () => {
  it("RSA schema has only headlines and descriptions", () => {
    const s = schemaFor("rsa") as any;
    expect(Object.keys(s.properties)).toEqual(["headlines", "descriptions"]);
  });

  it("PMax schema adds longHeadlines and businessName", () => {
    const s = schemaFor("pmax") as any;
    expect(Object.keys(s.properties)).toEqual(["headlines", "longHeadlines", "descriptions", "businessName"]);
  });

  it("meta_feed schema has primaryTexts, headlines, descriptions", () => {
    const s = schemaFor("meta_feed") as any;
    expect(Object.keys(s.properties)).toEqual(["primaryTexts", "headlines", "descriptions"]);
  });

  it("never carries a length/count keyword the structured-output API rejects", () => {
    const json = JSON.stringify(schemaFor("pmax"));
    for (const kw of ["minLength", "maxLength", "minItems", "maxItems"]) {
      expect(json).not.toContain(kw);
    }
  });
});

describe("generateAdCopy — mock path (own fixture, not generate()'s generic one)", () => {
  it("returns a correctly-shaped RSA fixture", async () => {
    const result = await generateAdCopy({} as any, "client-1", BRIEF, "google_ads", "rsa");
    expect(result.headlines.length).toBeGreaterThan(0);
    expect(result.descriptions.length).toBeGreaterThan(0);
    expect(result.longHeadlines).toBeUndefined();
    expect(result.businessName).toBeUndefined();
    expect(result.headlines.every((h) => !h.overLimit)).toBe(true);
  });

  it("returns a correctly-shaped PMax fixture with long headlines and business name", async () => {
    const result = await generateAdCopy({} as any, "client-1", BRIEF, "google_ads", "pmax");
    expect(result.longHeadlines?.length).toBeGreaterThan(0);
    expect(result.businessName).toBeDefined();
    expect(result.businessName!.overLimit).toBe(false);
  });

  it("returns a correctly-shaped Meta feed fixture with primary texts", async () => {
    const result = await generateAdCopy({} as any, "client-1", BRIEF, "meta", "meta_feed");
    expect(result.primaryTexts?.length).toBeGreaterThan(0);
    expect(result.longHeadlines).toBeUndefined();
    expect(result.businessName).toBeUndefined();
  });

  it("returns a correctly-shaped Microsoft RSA fixture", async () => {
    const result = await generateAdCopy({} as any, "client-1", BRIEF, "microsoft", "rsa");
    expect(result.headlines.length).toBeGreaterThan(0);
    expect(result.descriptions.length).toBeGreaterThan(0);
  });
});
