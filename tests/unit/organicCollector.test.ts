import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.MOCK_APIS = "1";

import { collectOrganicQueries, readWindows } from "@/lib/organicCollector";

/**
 * The bug this file exists to catch.
 *
 * `page` is nullable in TypeScript ("this is the query rollup") and NOT NULL
 * with an '' sentinel in Postgres (so the unique constraint works, because NULL
 * never equals NULL). The conversion happens in exactly two places. Getting
 * either wrong makes every rollup row look like a real page, which silently
 * breaks cannibalisation detection — no error, no empty screen, just wrong
 * recommendations. That is the worst kind of failure and the reason for these
 * tests.
 */

type Row = Record<string, unknown>;

function fakeDb(existing: Row[] = []) {
  const upserted: Row[] = [];

  const db = {
    upserted,
    from(table: string) {
      if (table !== "gsc_query_windows") throw new Error(`unexpected table ${table}`);

      const api: Record<string, unknown> = {
        upsert(rows: Row[]) {
          upserted.push(...rows);
          return Promise.resolve({ error: null });
        },
        select() { return api; },
        eq() { return api; },
        in() { return api; },
        order() { return api; },
        limit() { return Promise.resolve({ data: existing, error: null }); },
        then(resolve: (v: unknown) => void) { return resolve({ data: existing, error: null }); },
      };
      return api;
    },
  };
  return db as never;
}

describe("collectOrganicQueries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes both the current and the prior window", async () => {
    const db = fakeDb();
    const result = await collectOrganicQueries(db, "client-1", "https://getsaltydog.com/");

    expect(result.rowsWritten).toBeGreaterThan(0);
    expect(result.windowEnd).not.toBe(result.priorWindowEnd);

    const ends = new Set((db as never as { upserted: Row[] }).upserted.map((r) => r.window_end));
    expect(ends.size).toBe(2);
  });

  it("converts the rollup's null page to the '' sentinel, never null", async () => {
    const db = fakeDb();
    await collectOrganicQueries(db, "client-1", "https://getsaltydog.com/");

    const rows = (db as never as { upserted: Row[] }).upserted;
    // NOT NULL in Postgres — a null here is an insert failure at runtime.
    expect(rows.every((r) => r.page !== null && r.page !== undefined)).toBe(true);
    expect(rows.some((r) => r.page === "")).toBe(true);
    expect(rows.some((r) => r.page !== "")).toBe(true);
  });

  it("stamps every row with the client it belongs to", async () => {
    const db = fakeDb();
    await collectOrganicQueries(db, "client-42", "https://getsaltydog.com/");
    const rows = (db as never as { upserted: Row[] }).upserted;
    expect(rows.every((r) => r.client_id === "client-42")).toBe(true);
  });

  it("surfaces an upsert failure rather than reporting success", async () => {
    const db = {
      from: () => ({ upsert: () => Promise.resolve({ error: { message: "permission denied" } }) }),
    } as never;
    await expect(collectOrganicQueries(db, "c", "https://x.com/")).rejects.toThrow(/permission denied/);
  });
});

describe("readWindows", () => {
  it("turns the '' sentinel back into null so rollups are not mistaken for pages", async () => {
    const existing: Row[] = [
      { window_end: "2026-07-27", query: "a", page: "", clicks: 10, impressions: 100, ctr: 0.1, position: 5 },
      { window_end: "2026-07-27", query: "a", page: "https://x.com/p", clicks: 8, impressions: 90, ctr: 0.09, position: 5 },
    ];
    const { current } = await readWindows(fakeDb(existing), "c");

    const rollup = current.find((r) => r.query === "a" && r.page === null);
    // `?? null` would leave this as "" and the rollup would be counted as a page.
    expect(rollup).toBeDefined();
    expect(current.filter((r) => r.page !== null)).toHaveLength(1);
  });

  it("reports no window rather than inventing one when nothing is stored", async () => {
    const { current, prior, windowEnd } = await readWindows(fakeDb([]), "c");
    expect(current).toEqual([]);
    expect(prior).toEqual([]);
    expect(windowEnd).toBeNull();
  });

  it("leaves prior empty on a first collection instead of comparing against zero", async () => {
    const existing: Row[] = [
      { window_end: "2026-07-27", query: "a", page: "", clicks: 10, impressions: 100, ctr: 0.1, position: 5 },
    ];
    const { current, prior } = await readWindows(fakeDb(existing), "c");
    expect(current).toHaveLength(1);
    expect(prior).toEqual([]);
  });
});
