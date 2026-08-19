// lib/collectScope.ts — which clients does THIS invocation of the collect cron own?
//
// The pass used to be one function over the whole portfolio and was killed at
// Vercel's 300s ceiling — twice on 2026-08-18, and again on 2026-08-19 at
// 10:00 UTC *after* the concurrency fix (#57) was live, which is what settled
// that concurrency alone does not clear it. Fixing collectors is what made the
// pass slow: a collector failing on a 401 returns in milliseconds and one that
// succeeds goes and does the work.
//
// So the portfolio is split across several cron invocations instead. This module
// is the split, kept pure and separate from the route so it can be tested — the
// property that matters (every active client is collected exactly once per day)
// is not observable from a 300s function's return value.
//
// Two scopes on top of the default full pass:
//   ?shard=N&of=M   — this invocation owns clients where index % M === N
//   ?client=<uuid>  — one client, for targeted re-collection after a fix
//
// A truncated pass is invisible in the data: nothing records "I was killed", so
// clients at the tail keep yesterday's rows and look untouched. That is why the
// partition is asserted in tests rather than trusted.

export interface ScopedClient {
  id: string;
}

export type CollectScope =
  | { kind: "full" }
  | { kind: "shard"; shard: number; of: number }
  | { kind: "client"; id: string };

export interface CollectPlan<T extends ScopedClient> {
  scope: CollectScope;
  /** Clients this invocation collects. */
  selected: T[];
  /**
   * Does this invocation run the portfolio-wide tail — token-expiry sweep,
   * change measurement, staleness check, SLA, heartbeat?
   *
   * Only the LAST shard does. The heartbeat especially: it is a dead-man's
   * switch meaning "the pass got all the way here", so a ping from shard 0
   * while shard 3 is dying would report health the portfolio does not have.
   * A single-client re-collect never runs the tail — it is a repair, not a pass.
   */
  isFinalPass: boolean;
}

export class CollectScopeError extends Error {}

/** Parse ?shard/?of/?client into a scope. Throws CollectScopeError on nonsense. */
export function parseScope(params: URLSearchParams): CollectScope {
  const client = params.get("client");
  const shardRaw = params.get("shard");
  const ofRaw = params.get("of");

  if (client && (shardRaw || ofRaw)) {
    throw new CollectScopeError("Pass ?client or ?shard, not both");
  }
  if (client) {
    return { kind: "client", id: client };
  }
  if (!shardRaw && !ofRaw) return { kind: "full" };
  if (!shardRaw || !ofRaw) {
    throw new CollectScopeError("?shard and ?of must be given together");
  }

  const shard = Number(shardRaw);
  const of = Number(ofRaw);
  if (!Number.isInteger(of) || of < 1) {
    throw new CollectScopeError(`?of must be a positive integer, got "${ofRaw}"`);
  }
  if (!Number.isInteger(shard) || shard < 0 || shard >= of) {
    throw new CollectScopeError(`?shard must be 0..${of - 1}, got "${shardRaw}"`);
  }
  return { kind: "shard", shard, of };
}

/**
 * Apply a scope to the active-client list.
 *
 * Shards partition by POSITION in the list, not by a hash of the id. The list
 * comes back ordered, so position is stable between the shards of one day's
 * run, which is all the partition needs — and unlike a hash it cannot deal one
 * shard nine clients and another two. Onboarding a client reshuffles which
 * shard collects which client; nothing depends on that being stable across days.
 */
export function planCollection<T extends ScopedClient>(clients: T[], scope: CollectScope): CollectPlan<T> {
  if (scope.kind === "client") {
    const selected = clients.filter((c) => c.id === scope.id);
    if (selected.length === 0) {
      throw new CollectScopeError(`No active client with id ${scope.id}`);
    }
    return { scope, selected, isFinalPass: false };
  }
  if (scope.kind === "shard") {
    const selected = clients.filter((_, i) => i % scope.of === scope.shard);
    return { scope, selected, isFinalPass: scope.shard === scope.of - 1 };
  }
  return { scope, selected: clients, isFinalPass: true };
}

/** One-line description of the scope, for the run's JSON and the logs. */
export function describeScope(scope: CollectScope): string {
  if (scope.kind === "client") return `client ${scope.id}`;
  if (scope.kind === "shard") return `shard ${scope.shard + 1}/${scope.of}`;
  return "full portfolio";
}
