import { describe, it, expect } from "vitest";
import { keywordMovement, topTenCount, topTenDelta } from "@/lib/keywordMovement";

type Row = { query: string; page: string | null; clicks: number; impressions: number; position: number };
const r = (q: string, position: number, impressions = 100, page: string | null = null): Row =>
  ({ query: q, page, clicks: 0, impressions, position });

describe("keywordMovement", () => {
  it("reads an improvement as a positive delta, because positions count down", () => {
    const [row] = keywordMovement([r("hvac", 11)], [r("hvac", 18)]);
    expect(row.was).toBe(18);
    expect(row.now).toBe(11);
    expect(row.delta).toBe(7);
    expect(row.trend).toBe("rising");
  });

  it("reads a drop as negative and calls it slipped", () => {
    const [row] = keywordMovement([r("ac repair", 4)], [r("ac repair", 3)]);
    expect(row.delta).toBe(-1);
    expect(row.trend).toBe("slipped");
  });

  it("treats sub-half-position drift as holding, not movement", () => {
    const [row] = keywordMovement([r("x", 6.2)], [r("x", 6.0)]);
    expect(row.trend).toBe("holding");
  });

  it("marks a query absent from the prior window as new rather than improved", () => {
    const [row] = keywordMovement([r("brand new", 14)], []);
    expect(row.was).toBeNull();
    expect(row.delta).toBeNull();
    expect(row.trend).toBe("new");
  });

  // The bug this guard exists for: query×page rows are the same query again.
  it("counts each query once, ignoring the page rows", () => {
    const rows = keywordMovement([
      r("hvac", 11, 500),
      r("hvac", 11, 300, "https://x.com/a"),
      r("hvac", 14, 200, "https://x.com/b"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].impressions).toBe(500);
  });

  it("matches the prior window case-insensitively", () => {
    const [row] = keywordMovement([r("HVAC Repair", 9)], [r("hvac repair", 15)]);
    expect(row.delta).toBe(6);
  });

  it("drops single-impression noise", () => {
    expect(keywordMovement([r("noise", 40, 4)])).toHaveLength(0);
  });

  it("orders by traffic at stake, not by how far something moved", () => {
    const rows = keywordMovement(
      [r("big", 12, 5000), r("small", 12, 40)],
      [r("big", 13, 5000), r("small", 30, 40)]
    );
    // "small" gained 18 places; "big" gained one. Big still leads.
    expect(rows[0].query).toBe("big");
  });

  it("attaches volume when known and leaves it null when not", () => {
    const rows = keywordMovement([r("a", 5), r("b", 5)], [], new Map([["a", 1400]]));
    expect(rows.find((x) => x.query === "a")!.volume).toBe(1400);
    expect(rows.find((x) => x.query === "b")!.volume).toBeNull();
  });
});

describe("topTenCount / topTenDelta", () => {
  it("counts page-one queries", () => {
    const rows = keywordMovement([r("a", 3), r("b", 9), r("c", 22)]);
    expect(topTenCount(rows)).toBe(2);
  });

  it("compares only queries present in both windows", () => {
    // "c" is new and in the top ten. Counting it would report a gain caused by
    // Search Console surfacing more queries, not by anything ranking better.
    const rows = keywordMovement(
      [r("a", 8), r("b", 12), r("c", 4)],
      [r("a", 14), r("b", 9)]
    );
    // a: 14 -> 8 (entered), b: 9 -> 12 (left). Net zero.
    expect(topTenDelta(rows)).toBe(0);
  });

  it("returns null rather than zero when there is nothing to compare", () => {
    expect(topTenDelta(keywordMovement([r("a", 3)]))).toBeNull();
  });
});
