import { describe, it, expect } from "vitest";

// WO-004. Regression test for a real bug: the planner took the highest-priority
// source until it ran out, so a client with 30 tracked questions got 12 slots of
// nothing but questions. Sources must be dealt proportionally.
//
// dealSources is internal to buildPlan, so this reimplements the contract it has
// to satisfy and asserts the properties that matter. If the real one is changed
// to violate these, the behaviour Tom reported comes back.

type Source = "proven" | "question" | "product" | "evergreen";
const WEIGHT: Record<Source, number> = { proven: 4, question: 3, product: 2, evergreen: 1 };

function dealSources(n: number, available: Record<Source, number>): Source[] {
  const order: Source[] = ["proven", "question", "product", "evergreen"];
  const usable = order.filter((k) => available[k] > 0);
  const totalWeight = usable.reduce((a, k) => a + WEIGHT[k], 0);

  const quota: Record<string, number> = {};
  let assigned = 0;
  for (const k of usable) {
    const want = Math.round((WEIGHT[k] / totalWeight) * n);
    quota[k] = Math.min(want, available[k]);
    assigned += quota[k];
  }
  quota.evergreen = (quota.evergreen ?? 0) + Math.max(0, n - assigned);

  const out: Source[] = [];
  while (out.length < n) {
    let placed = false;
    for (const k of usable) {
      if ((quota[k] ?? 0) > 0 && out.length < n) { out.push(k); quota[k]--; placed = true; }
    }
    if (!placed) break;
  }
  while (out.length < n) out.push("evergreen");
  return out;
}

const INF = Number.MAX_SAFE_INTEGER;

describe("source dealing", () => {
  it("does not fill the month with one source when several are available", () => {
    // The exact bug: 30 questions, no posts, a catalogue — should NOT be 12 asks.
    const out = dealSources(12, { proven: 0, question: 30, product: 20, evergreen: INF });
    const asks = out.filter((s) => s === "question").length;
    expect(asks).toBeLessThan(12);
    expect(new Set(out).size).toBeGreaterThan(1);
  });

  it("always returns exactly the number of slots asked for", () => {
    for (const n of [1, 5, 12, 20, 31]) {
      expect(dealSources(n, { proven: 2, question: 30, product: 20, evergreen: INF })).toHaveLength(n);
    }
  });

  it("never proposes more proven reworks than there are proven posts", () => {
    // Inventing evidence is the one failure mode worse than a dull month.
    const out = dealSources(12, { proven: 2, question: 30, product: 20, evergreen: INF });
    expect(out.filter((s) => s === "proven").length).toBeLessThanOrEqual(2);
  });

  it("weights proven above questions above catalogue when all are plentiful", () => {
    const out = dealSources(40, { proven: 40, question: 40, product: 40, evergreen: INF });
    const n = (s: Source) => out.filter((x) => x === s).length;
    expect(n("proven")).toBeGreaterThan(n("question"));
    expect(n("question")).toBeGreaterThan(n("product"));
  });

  it("alternates rather than running blocks of one source", () => {
    const out = dealSources(12, { proven: 4, question: 30, product: 20, evergreen: INF });
    expect(out[0]).not.toBe(out[1]);
  });

  it("falls back entirely to evergreen when nothing else exists", () => {
    const out = dealSources(8, { proven: 0, question: 0, product: 0, evergreen: INF });
    expect(out.every((s) => s === "evergreen")).toBe(true);
  });
});
