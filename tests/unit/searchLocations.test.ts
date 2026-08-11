import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { searchLocations } from "@/lib/dataforseo";

// location_code defaults to 2840 (all of the United States). For a local
// business that is wrong and fails silently — the rankings still look
// plausible. These tests pin the ordering, because "which of these 30 matches
// do I pick" is the actual question someone onboarding a client has.

const ROWS = [
  { location_code: 1015116, location_name: "Stuart, Florida, United States", location_type: "City" },
  { location_code: 200548, location_name: "West Palm Beach-Ft. Pierce FL, United States", location_type: "DMA Region" },
  { location_code: 9011845, location_name: "Stuart County, Florida, United States", location_type: "County" },
  { location_code: 1234567, location_name: "Port St. Lucie, Florida, United States", location_type: "City" },
  { location_code: 7777777, location_name: "Somewhere Else, Texas, United States", location_type: "City" },
];

function stubRows(rows: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ tasks: [{ status_code: 20000, result: rows }] }),
  })));
}

beforeEach(() => {
  vi.stubEnv("MOCK_APIS", "0");
  vi.stubEnv("DATAFORSEO_LOGIN", "login@example.com");
  vi.stubEnv("DATAFORSEO_PASSWORD", "password");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("searchLocations", () => {
  it("matches on substring, case-insensitively", async () => {
    stubRows(ROWS);
    const r = await searchLocations("STUART");
    expect(r.map((m) => m.code).sort()).toEqual([1015116, 9011845].sort());
  });

  it("puts the DMA first — a service business competes across a metro, not one city", async () => {
    stubRows(ROWS);
    const r = await searchLocations("palm beach");
    expect(r[0].code).toBe(200548);
    expect(r[0].type).toBe("DMA Region");
  });

  it("orders DMA before city before county", async () => {
    stubRows([
      { location_code: 3, location_name: "Testville County, FL", location_type: "County" },
      { location_code: 2, location_name: "Testville, FL", location_type: "City" },
      { location_code: 1, location_name: "Testville DMA, FL", location_type: "DMA Region" },
    ]);
    expect((await searchLocations("testville")).map((m) => m.code)).toEqual([1, 2, 3]);
  });

  it("excludes places that do not match", async () => {
    stubRows(ROWS);
    const names = (await searchLocations("stuart")).map((m) => m.name);
    expect(names.some((n) => n.includes("Texas"))).toBe(false);
  });

  it("returns nothing for an empty query rather than the whole list", async () => {
    stubRows(ROWS);
    expect(await searchLocations("   ")).toEqual([]);
  });

  it("respects the limit", async () => {
    stubRows(ROWS);
    expect(await searchLocations("united states", 2)).toHaveLength(2);
  });

  it("skips rows with no location_code instead of emitting NaN", async () => {
    stubRows([{ location_name: "Broken, FL", location_type: "City" }, ROWS[0]]);
    const r = await searchLocations("fl");
    expect(r.every((m) => Number.isInteger(m.code))).toBe(true);
  });
});
