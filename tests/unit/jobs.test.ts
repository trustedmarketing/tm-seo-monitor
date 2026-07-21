import { describe, it, expect } from "vitest";
import { createFakeDb } from "../helpers/fakeDb";
import { enqueue, claimDue, succeed, fail, type Job } from "@/lib/jobs";

const opts = { unique: { jobs: ["idempotency_key"] } };

describe("jobs queue", () => {
  it("enqueues a job and returns its id", async () => {
    const db = createFakeDb({}, opts) as any;
    const id = await enqueue(db, { jobType: "collect_core", clientId: "c1" });
    expect(id).toBe(1);
    expect(db._rows("jobs")).toHaveLength(1);
    expect(db._rows("jobs")[0].status).toBeUndefined(); // default applied by DB, not fake
  });

  it("is idempotent on idempotencyKey (repeat = no-op, returns null)", async () => {
    const db = createFakeDb({}, opts) as any;
    const first = await enqueue(db, { jobType: "collect_core", idempotencyKey: "core:c1:2026-07-21" });
    const second = await enqueue(db, { jobType: "collect_core", idempotencyKey: "core:c1:2026-07-21" });
    expect(first).toBe(1);
    expect(second).toBeNull();
    expect(db._rows("jobs")).toHaveLength(1);
  });

  it("claims due jobs and marks them running with attempts incremented", async () => {
    const db = createFakeDb(
      { jobs: [
        { id: 1, job_type: "a", status: "queued", priority: 100, attempts: 0, max_attempts: 3, run_after: past() },
        { id: 2, job_type: "b", status: "queued", priority: 50, attempts: 0, max_attempts: 3, run_after: past() },
        { id: 3, job_type: "c", status: "queued", priority: 100, attempts: 0, max_attempts: 3, run_after: future() },
      ] },
      opts
    ) as any;
    // seq must continue past seeded ids for correctness of other tests, not needed here
    const claimed = await claimDue(db, "worker-1", 10);
    const ids = claimed.map((j: Job) => j.id).sort();
    expect(ids).toEqual([1, 2]); // job 3 not due (run_after in future)
    expect(claimed.every((j: Job) => j.status === "running")).toBe(true);
    expect(claimed.every((j: Job) => j.attempts === 1)).toBe(true);
    expect(claimed.every((j: Job) => j.locked_by === "worker-1")).toBe(true);
  });

  it("succeed marks the job succeeded and clears the lock", async () => {
    const db = createFakeDb(
      { jobs: [{ id: 7, job_type: "a", status: "running", locked_by: "w", attempts: 1, max_attempts: 3 }] },
      opts
    ) as any;
    await succeed(db, 7);
    const row = db._rows("jobs")[0];
    expect(row.status).toBe("succeeded");
    expect(row.locked_by).toBeNull();
  });

  it("fail retries with backoff until max_attempts, then parks as dead", async () => {
    const db2 = createFakeDb(
      { jobs: [base({ id: 1, attempts: 1, max_attempts: 3 })] }, opts
    ) as any;
    await fail(db2, base({ id: 1, attempts: 1, max_attempts: 3 }), "boom");
    expect(db2._rows("jobs")[0].status).toBe("failed");
    expect(db2._rows("jobs")[0].last_error).toBe("boom");

    const db3 = createFakeDb(
      { jobs: [base({ id: 1, attempts: 3, max_attempts: 3 })] }, opts
    ) as any;
    await fail(db3, base({ id: 1, attempts: 3, max_attempts: 3 }), "boom");
    expect(db3._rows("jobs")[0].status).toBe("dead");
  });
});

function past() { return new Date(Date.now() - 60_000).toISOString(); }
function future() { return new Date(Date.now() + 3_600_000).toISOString(); }
function base(o: Partial<Job>): Job {
  return {
    id: 1, job_type: "a", client_id: null, payload: {}, idempotency_key: null,
    status: "queued", priority: 100, attempts: 0, max_attempts: 3,
    run_after: past(), locked_at: null, locked_by: null, last_error: null, ...o,
  };
}
