import { describe, it, expect } from "vitest";
import { createFakeDb } from "../helpers/fakeDb";
import { findStaleData, hoursSince, STALE_AFTER_DAYS } from "@/lib/dataFreshness";

const CLIENT_ID = "44444444-4444-4444-4444-444444444444";
const CLIENTS = [{ id: CLIENT_ID, domain: "saltydog.example" }];
const NOW = new Date("2026-08-10T10:00:00Z");

function daysBefore(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

describe("hoursSince", () => {
  it("measures from the row's date at UTC midnight", () => {
    expect(hoursSince("2026-08-09", new Date("2026-08-10T00:00:00Z"))).toBe(24);
  });

  it("never returns a negative age for a same-day or future-dated row", () => {
    expect(hoursSince("2026-08-11", NOW)).toBe(0);
  });
});

describe("findStaleData", () => {
  it("flags nothing when both sources reported today", async () => {
    const db = createFakeDb({
      conversions_daily: [{ client_id: CLIENT_ID, source: "shopify", date: daysBefore(0), revenue: 100 }],
      ad_metrics_daily: [{ client_id: CLIENT_ID, date: daysBefore(0), spend: 50 }],
    }) as any;

    expect(await findStaleData(db, CLIENTS, NOW)).toEqual([]);
  });

  it("tolerates normal reporting lag inside the threshold", async () => {
    const db = createFakeDb({
      conversions_daily: [{ client_id: CLIENT_ID, source: "shopify", date: daysBefore(2), revenue: 100 }],
      ad_metrics_daily: [{ client_id: CLIENT_ID, date: daysBefore(2), spend: 50 }],
    }) as any;

    expect(await findStaleData(db, CLIENTS, NOW)).toEqual([]);
  });

  it("flags a source whose freshest row is past the threshold", async () => {
    const db = createFakeDb({
      conversions_daily: [{ client_id: CLIENT_ID, source: "shopify", date: daysBefore(9), revenue: 100 }],
      ad_metrics_daily: [{ client_id: CLIENT_ID, date: daysBefore(0), spend: 50 }],
    }) as any;

    const stale = await findStaleData(db, CLIENTS, NOW);
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ client: "saltydog.example", module: "shopify revenue" });
    expect(stale[0].hoursOld).toBeGreaterThan(STALE_AFTER_DAYS * 24);
  });

  it("uses the FRESHEST row, not just any row — old history alongside new data is not stale", async () => {
    const db = createFakeDb({
      conversions_daily: [
        { client_id: CLIENT_ID, source: "shopify", date: daysBefore(90), revenue: 10 },
        { client_id: CLIENT_ID, source: "shopify", date: daysBefore(1), revenue: 100 },
      ],
    }) as any;

    expect(await findStaleData(db, CLIENTS, NOW)).toEqual([]);
  });

  it("does not flag a source that has never reported — that's unconfigured, not stale", async () => {
    // No conversions_daily or ad_metrics_daily rows at all. Alerting daily on a
    // client who simply has no Shopify store is how a failure list gets ignored.
    const db = createFakeDb({}) as any;

    expect(await findStaleData(db, CLIENTS, NOW)).toEqual([]);
  });

  it("ignores another source's fresh rows when judging Shopify's staleness", async () => {
    const db = createFakeDb({
      conversions_daily: [
        { client_id: CLIENT_ID, source: "ga4", date: daysBefore(0), revenue: 500 },
        { client_id: CLIENT_ID, source: "shopify", date: daysBefore(9), revenue: 100 },
      ],
    }) as any;

    const stale = await findStaleData(db, CLIENTS, NOW);
    expect(stale.map((s) => s.module)).toEqual(["shopify revenue"]);
  });

  it("does not attribute one client's fresh data to another client", async () => {
    const OTHER = "55555555-5555-5555-5555-555555555555";
    const db = createFakeDb({
      conversions_daily: [
        { client_id: OTHER, source: "shopify", date: daysBefore(0), revenue: 900 },
        { client_id: CLIENT_ID, source: "shopify", date: daysBefore(9), revenue: 100 },
      ],
    }) as any;

    const stale = await findStaleData(db, CLIENTS, NOW);
    expect(stale).toHaveLength(1);
    expect(stale[0].client).toBe("saltydog.example");
  });
});
