import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { dailyConversions } from "@/lib/ga4";

// MOCK_APIS=1 must make ga4 client fns read from tests/fixtures/ instead of
// hitting the network. Fail loudly if a real request is attempted.
beforeAll(() => {
  vi.stubEnv("MOCK_APIS", "1");
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "");
});
afterAll(() => { vi.unstubAllEnvs(); });

describe("ga4 under MOCK_APIS", () => {
  it("dailyConversions reads the fixture", async () => {
    const rows = await dailyConversions("properties/123456789", 28);
    expect(rows.length).toBe(5);
    expect(rows[0]).toEqual({
      date: "2026-06-22", source: "Organic Search", sessions: 412, conversions: 9, revenue: 1180.50,
    });
  });

  it("returns rows across multiple sources and dates from the fixture", async () => {
    const rows = await dailyConversions("properties/123456789");
    const sources = new Set(rows.map((r) => r.source));
    expect(sources.has("Organic Search")).toBe(true);
    expect(sources.has("Paid Search")).toBe(true);
    expect(sources.has("Direct")).toBe(true);
  });
});
