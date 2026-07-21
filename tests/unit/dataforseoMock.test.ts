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
