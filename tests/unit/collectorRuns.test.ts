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

  it("tracked records an error row and returns null instead of throwing", async () => {
    const db = createFakeDb() as any;
    const val = await tracked(db, "ai", "c1", async () => { throw new Error("api down"); });
    expect(val).toBeNull();
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("error");
    expect(run.error).toBe("api down");
  });
});
