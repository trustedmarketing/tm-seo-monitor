// The collect cron was killed at Vercel's 300s ceiling with the whole portfolio
// in one function. It is now split across several invocations, and the property
// that matters — every active client collected exactly once per day — is not
// observable from a function that dies partway. So it is asserted here.
import { describe, expect, it } from "vitest";
import {
  CollectScopeError,
  describeScope,
  parseScope,
  planCollection,
} from "@/lib/collectScope";

const clients = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}` }));

describe("parseScope", () => {
  it("defaults to a full pass when no params are given", () => {
    expect(parseScope(new URLSearchParams())).toEqual({ kind: "full" });
  });

  it("reads ?shard and ?of", () => {
    expect(parseScope(new URLSearchParams("shard=2&of=4"))).toEqual({ kind: "shard", shard: 2, of: 4 });
  });

  it("reads ?client", () => {
    expect(parseScope(new URLSearchParams("client=abc"))).toEqual({ kind: "client", id: "abc" });
  });

  // A half-given shard is the dangerous typo: ?shard=1 with no ?of would
  // silently collect the whole portfolio from a cron meant to collect a quarter
  // of it, and four of those is four full passes.
  it.each(["shard=1", "of=4"])("rejects a half-given shard (%s)", (qs) => {
    expect(() => parseScope(new URLSearchParams(qs))).toThrow(CollectScopeError);
  });

  it.each(["shard=4&of=4", "shard=-1&of=4", "shard=0&of=0", "shard=x&of=4", "shard=1.5&of=4"])(
    "rejects an out-of-range shard (%s)",
    (qs) => {
      expect(() => parseScope(new URLSearchParams(qs))).toThrow(CollectScopeError);
    },
  );

  it("rejects ?client together with ?shard", () => {
    expect(() => parseScope(new URLSearchParams("client=abc&shard=0&of=2"))).toThrow(CollectScopeError);
  });
});

describe("planCollection — the partition", () => {
  // The whole point. Complete and disjoint: no client is skipped (silently
  // keeping yesterday's rows) and none is collected twice (burning API credits
  // and double-writing).
  it.each([
    [19, 4],
    [19, 1],
    [3, 4], // more shards than clients — the empty shards must not break it
    [0, 4], // an empty portfolio
    [100, 7],
  ])("covers %i clients across %i shards exactly once", (n, of) => {
    const all = clients(n);
    const seen: string[] = [];
    for (let shard = 0; shard < of; shard++) {
      seen.push(...planCollection(all, { kind: "shard", shard, of }).selected.map((c) => c.id));
    }
    expect(seen.sort()).toEqual(all.map((c) => c.id).sort());
    expect(new Set(seen).size).toBe(n);
  });

  it("spreads clients evenly rather than dealing one shard the lot", () => {
    const sizes = [0, 1, 2, 3].map(
      (shard) => planCollection(clients(19), { kind: "shard", shard, of: 4 }).selected.length,
    );
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it("is stable — the same shard asked twice owns the same clients", () => {
    const all = clients(19);
    const a = planCollection(all, { kind: "shard", shard: 1, of: 4 }).selected;
    const b = planCollection(all, { kind: "shard", shard: 1, of: 4 }).selected;
    expect(a).toEqual(b);
  });
});

describe("planCollection — the portfolio-wide tail", () => {
  // The heartbeat is a dead-man's switch meaning "the pass got all the way
  // here". If every shard pinged it, shard 0 finishing would report health
  // while shard 3 was being killed — exactly the failure it exists to catch.
  it("runs the tail only on the last shard", () => {
    const all = clients(19);
    expect([0, 1, 2, 3].map((shard) => planCollection(all, { kind: "shard", shard, of: 4 }).isFinalPass)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it("runs the tail on an unsharded full pass", () => {
    expect(planCollection(clients(19), { kind: "full" }).isFinalPass).toBe(true);
  });

  // A single-client re-collect is a repair, not a pass. It must not ping the
  // heartbeat, and it must not fire staleness alerts for the 18 clients it
  // never looked at.
  it("never runs the tail for a single-client re-collect", () => {
    const plan = planCollection(clients(19), { kind: "client", id: "c7" });
    expect(plan.isFinalPass).toBe(false);
    expect(plan.selected.map((c) => c.id)).toEqual(["c7"]);
  });

  it("refuses an unknown client rather than collecting nothing and reporting success", () => {
    expect(() => planCollection(clients(19), { kind: "client", id: "nope" })).toThrow(CollectScopeError);
  });
});

describe("describeScope", () => {
  it("counts shards from 1 for humans", () => {
    expect(describeScope({ kind: "shard", shard: 0, of: 4 })).toBe("shard 1/4");
    expect(describeScope({ kind: "full" })).toBe("full portfolio");
    expect(describeScope({ kind: "client", id: "abc" })).toBe("client abc");
  });
});
