import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  domainRankOverview, backlinksSummary, serpPosition, aiPromptCheck,
} from "@/lib/dataforseo";

// MOCK_APIS=1 must make every dataforseo client fn read from tests/fixtures/
// instead of hitting the network. Fail loudly if a real fetch is attempted.
beforeAll(() => {
  vi.stubEnv("MOCK_APIS", "1");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network called under MOCK_APIS"); }));
});
afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("dataforseo under MOCK_APIS", () => {
  it("domainRankOverview reads the fixture", async () => {
    const r = await domainRankOverview("sharkey-air.example", 2840, "en");
    expect(r).toEqual({ organicTraffic: 1234, organicKeywords: 278 });
  });

  it("backlinksSummary reads the fixture", async () => {
    const r = await backlinksSummary("sharkey-air.example");
    expect(r).toEqual({ backlinks: 152, referringDomains: 58 });
  });

  it("serpPosition matches the domain in the fixture", async () => {
    const r = await serpPosition("ac repair stuart fl", "sharkey-air.example", 2840, "en");
    expect(r.position).toBe(4);
    expect(r.url).toContain("sharkey-air.example");
  });

  it("aiPromptCheck detects a brand/domain mention", async () => {
    const r = await aiPromptCheck("best ac repair in stuart", "sharkey-air.example", "Sharkey Air");
    expect(r.mentioned).toBe(true);
    expect(r.cited).toBe(true);
  });
});

// The AEO check was rewritten after 121 live checks returned 0% — a true answer
// to the wrong question, because web_search defaulted to false and the model was
// gpt-4o-mini. These cover the parts that were actually wrong.
describe("aiPromptCheck detection", () => {
  it("reads citations from annotations, not from a JSON substring", async () => {
    const r = await aiPromptCheck("best ac repair in stuart", "sharkey-air.example", "Sharkey Air");
    expect(r.cited).toBe(true);
    expect(r.sources.map((s) => s.url)).toContain("https://sharkey-air.example/ac-repair");
  });

  it("returns competitor sources too, not only ours", async () => {
    // Who else the answer cites is the useful half: it names who to displace.
    const r = await aiPromptCheck("best ac repair in stuart", "sharkey-air.example", "Sharkey Air");
    expect(r.sources.some((s) => s.url.includes("competitor.example"))).toBe(true);
  });

  it("keeps the answer text so a zero can be read rather than argued about", async () => {
    const r = await aiPromptCheck("best ac repair in stuart", "sharkey-air.example", "Sharkey Air");
    expect(r.answer).toContain("sharkey-air.example");
  });

  it("does not count a brand that appears only in the PROMPT", async () => {
    // The old version searched the serialised request+response together, so
    // asking "is Sharkey Air any good" scored as a mention of itself.
    const r = await aiPromptCheck("is Definitely-Not-Present any good", "absent.example", "Definitely Not Present");
    expect(r.mentioned).toBe(false);
    expect(r.cited).toBe(false);
  });
});
