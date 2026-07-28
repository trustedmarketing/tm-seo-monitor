import { describe, it, expect } from "vitest";
import { costOf } from "@/lib/ai";

// WO-003. The ledger's whole job is to be right about money, so the arithmetic
// gets a test rather than a comment claiming it is correct.

describe("costOf", () => {
  it("prices Opus 5 at the published rate", () => {
    // 1M input at $5 + 1M output at $25
    expect(costOf({ inputTokens: 1_000_000, outputTokens: 1_000_000,
                    cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(30, 6);
  });

  it("prices a realistic caption at a fraction of a cent", () => {
    // The actual shape of this workload: ~800 in, ~150 out.
    const c = costOf({ inputTokens: 800, outputTokens: 150, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThan(0.01);
  });

  it("charges cache reads at a tenth of input", () => {
    const cached = costOf({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 });
    const fresh = costOf({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(cached).toBeCloseTo(fresh / 10, 6);
  });

  it("charges cache writes above plain input", () => {
    const write = costOf({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1_000_000 });
    const fresh = costOf({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(write).toBeGreaterThan(fresh);
  });

  it("is zero for a call that produced nothing", () => {
    expect(costOf({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(0);
  });
});
