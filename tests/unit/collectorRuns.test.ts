import { describe, it, expect } from "vitest";
import { createFakeDb } from "../helpers/fakeDb";
import { recordRun, tracked } from "@/lib/collectorRuns";

describe("collectorRuns", () => {
  it("recordRun writes a collector_runs row", async () => {
    const db = createFakeDb() as any;
    await recordRun(db, "core", "c1", { status: "success", detail: "ok", rows_written: 1, duration_ms: 42 });
    const rows = db._rows("collector_runs");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ module: "core", client_id: "c1", status: "success", rows_written: 1, duration_ms: 42 });
  });

  it("tracked returns the value and records success", async () => {
    const db = createFakeDb() as any;
    const val = await tracked(db, "serp", "c1", async () => ({ value: 99, rows: 3, detail: "vis=99" }));
    expect(val).toBe(99);
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("success");
    expect(run.rows_written).toBe(3);
  });

  // The third outcome. Without it a collector using tracked() could only say
  // "success" or "error", so "this client is not configured" was reported as a
  // success — a positive claim that collection worked, on a client that has
  // nothing connected. Meta's collector recorded `skipped` for the identical
  // condition, so the two contradicted each other in the same run.
  it("tracked records a skipped row when fn reports nothing to do", async () => {
    const db = createFakeDb() as any;
    const val = await tracked(db, "google_ads", "c1", async () => ({
      value: 0, rows: 0, skipped: true, detail: "no google_ads ad_platform_accounts row for example.com",
    }));
    expect(val).toBe(0); // still returns the value — skipped is not a failure
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("skipped");
    expect(run.detail).toContain("no google_ads ad_platform_accounts row");
    // Not 0 — "wrote no rows" and "did not run" are different claims, and a
    // zero here reads as the first one.
    expect(run.rows_written ?? null).toBeNull();
  });

  it("tracked still records success when fn does not set skipped", async () => {
    const db = createFakeDb() as any;
    await tracked(db, "serp", "c1", async () => ({ value: 1, rows: 1, skipped: false }));
    expect(db._rows("collector_runs")[0].status).toBe("success");
  });

  it("tracked records an error row and returns null instead of throwing", async () => {
    const db = createFakeDb() as any;
    const val = await tracked(db, "ai", "c1", async () => { throw new Error("api down"); });
    expect(val).toBeNull();
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("error");
    expect(run.error).toBe("api down");
  });
});
