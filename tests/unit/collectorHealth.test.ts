import { describe, it, expect } from "vitest";
import { failingModules, latestRunPerModule, shortError, type CollectorRunRow } from "@/lib/collectorHealth";

function run(o: Partial<CollectorRunRow> = {}): CollectorRunRow {
  return {
    client_id: "client-1",
    module: "crawl",
    status: "error",
    error: "DataForSEO credentials missing",
    started_at: "2026-08-10T10:00:00Z",
    ...o,
  };
}

describe("latestRunPerModule", () => {
  it("keeps the newest run per client+module regardless of input order", () => {
    const latest = latestRunPerModule([
      run({ started_at: "2026-08-10T08:00:00Z", status: "error" }),
      run({ started_at: "2026-08-10T12:00:00Z", status: "success" }),
      run({ started_at: "2026-08-10T10:00:00Z", status: "error" }),
    ]);
    expect(latest.size).toBe(1);
    expect(latest.get("client-1:crawl")).toMatchObject({ status: "success", started_at: "2026-08-10T12:00:00Z" });
  });

  it("treats the same module on different clients as separate", () => {
    const latest = latestRunPerModule([
      run({ client_id: "a" }),
      run({ client_id: "b" }),
    ]);
    expect(latest.size).toBe(2);
  });

  it("treats a portfolio-wide run (null client) as its own key", () => {
    const latest = latestRunPerModule([run({ client_id: null, module: "approvals" })]);
    expect([...latest.keys()]).toEqual(["portfolio:approvals"]);
  });
});

describe("failingModules", () => {
  it("does NOT flag a module that errored and then recovered", () => {
    // This is the crawl case: the cron records an error for an abandoned stale
    // task, then requeues successfully in the same run. Flagging it left a
    // permanent red on a crawl that was working.
    expect(
      failingModules([
        run({ started_at: "2026-08-10T10:00:00Z", status: "error", error: "task X never finished after 48h — abandoned, requeueing" }),
        run({ started_at: "2026-08-10T10:00:05Z", status: "success", error: null }),
      ])
    ).toEqual([]);
  });

  it("flags a module whose latest run errored, even if it succeeded earlier", () => {
    const failing = failingModules([
      run({ started_at: "2026-08-10T08:00:00Z", status: "success", error: null }),
      run({ started_at: "2026-08-10T12:00:00Z", status: "error", error: "HTTP 402" }),
    ]);
    expect(failing).toHaveLength(1);
    expect(failing[0]).toMatchObject({ module: "crawl", error: "HTTP 402" });
  });

  it("carries the error text through — the whole point is knowing what to fix", () => {
    const [f] = failingModules([run({ error: "GA4 property properties/123: caller does not have permission" })]);
    expect(f.error).toContain("does not have permission");
  });

  it("reports one entry per client+module, not one per failed run", () => {
    const failing = failingModules([
      run({ started_at: "2026-08-10T09:00:00Z" }),
      run({ started_at: "2026-08-10T10:00:00Z" }),
      run({ started_at: "2026-08-10T11:00:00Z" }),
    ]);
    expect(failing).toHaveLength(1);
  });

  it("ignores a 'skipped' latest run — skipped is a configuration fact, not a failure", () => {
    expect(failingModules([run({ status: "skipped", error: null })])).toEqual([]);
  });
});

describe("shortError", () => {
  it("returns an empty string for a null error rather than the word null", () => {
    expect(shortError(null)).toBe("");
  });

  it("leaves a short error untouched", () => {
    expect(shortError("HTTP 402")).toBe("HTTP 402");
  });

  it("marks a truncated error with an ellipsis so it's clear it was cut", () => {
    const long = "x".repeat(300);
    const out = shortError(long, 50);
    expect(out).toHaveLength(50);
    expect(out.endsWith("…")).toBe(true);
  });
});
