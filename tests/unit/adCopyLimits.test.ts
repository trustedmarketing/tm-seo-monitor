import { describe, it, expect } from "vitest";
import { flagOverLimit, flagAndCapList, limitsFor, AD_COPY_LIMITS } from "@/lib/adCopyLimits";

describe("flagOverLimit", () => {
  it("does not flag text at exactly the limit", () => {
    const text = "a".repeat(30);
    expect(flagOverLimit(text, 30)).toEqual({ text, chars: 30, overLimit: false });
  });

  it("flags text one character over the limit, without truncating it", () => {
    const text = "a".repeat(31);
    const result = flagOverLimit(text, 30);
    expect(result.overLimit).toBe(true);
    expect(result.text).toBe(text); // never mutated
    expect(result.chars).toBe(31);
  });

  it("trims whitespace before counting", () => {
    expect(flagOverLimit("  hello  ", 30)).toEqual({ text: "hello", chars: 5, overLimit: false });
  });
});

describe("flagAndCapList", () => {
  const field = { min: 2, max: 4, chars: 10 };

  it("caps the array length to field.max without dropping based on character length", () => {
    const texts = ["one", "two", "three-long", "four", "five-extra"];
    const result = flagAndCapList(texts, field);
    expect(result).toHaveLength(4); // capped, not 5
    expect(result.map((r) => r.text)).toEqual(["one", "two", "three-long", "four"]);
    expect(result[2].overLimit).toBe(false); // "three-long" is exactly 10 chars, at the limit
  });

  it("flags individual over-limit entries within an otherwise-kept list", () => {
    const result = flagAndCapList(["short", "this one is definitely too long"], field);
    expect(result[0].overLimit).toBe(false);
    expect(result[1].overLimit).toBe(true);
    expect(result[1].text).toBe("this one is definitely too long"); // kept whole, not cut
  });

  it("drops blank/whitespace-only entries", () => {
    const result = flagAndCapList(["real", "", "   ", "also real"], field);
    expect(result.map((r) => r.text)).toEqual(["real", "also real"]);
  });
});

describe("limitsFor", () => {
  it("returns Google RSA limits matching verified platform specs", () => {
    expect(limitsFor("google_ads", "rsa")).toEqual({
      headlines: { min: 3, max: 15, chars: 30 },
      descriptions: { min: 2, max: 4, chars: 90 },
    });
  });

  it("returns Google PMax limits including long headlines and business name", () => {
    const l = limitsFor("google_ads", "pmax");
    expect(l.longHeadlines).toEqual({ min: 1, max: 5, chars: 90 });
    expect(l.businessNameChars).toBe(25);
  });

  it("returns Meta feed limits with primary texts", () => {
    const l = limitsFor("meta", "meta_feed");
    expect(l.primaryTexts).toEqual({ min: 1, max: 5, chars: 125 });
    expect(l.headlines).toEqual({ min: 1, max: 5, chars: 40 });
  });

  it("throws for an unsupported platform/format combination", () => {
    expect(() => limitsFor("meta", "rsa")).toThrow(/no ad copy limits/);
  });

  it("Microsoft RSA matches Google RSA (near-identical per verified specs)", () => {
    expect(AD_COPY_LIMITS.microsoft.rsa).toEqual(AD_COPY_LIMITS.google_ads.rsa);
  });
});
