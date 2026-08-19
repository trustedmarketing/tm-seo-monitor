// lib/collectorHealth.ts — "what is actually broken right now?"
//
// Extracted from the portfolio rail because the answer is not obvious and the
// first version got it wrong: it flagged any error inside the 48h window and
// ignored a later success, so a module that failed and then recovered stayed
// red until the window rolled off.
//
// That was worst for `crawl`. The cron's isCrawlStale branch records an error
// row for an abandoned task and then requeues in the same run, writing a
// success immediately after — a self-healing sequence that rendered as a
// permanent failure. A red that never clears trains everyone to ignore reds,
// which costs more than showing nothing.
export interface CollectorRunRow {
  client_id: string | null;
  module: string;
  status: string;
  error: string | null;
  started_at: string;
}

export interface FailingModule {
  clientId: string | null;
  module: string;
  error: string | null;
  startedAt: string;
}

function key(r: { client_id: string | null; module: string }): string {
  return `${r.client_id ?? "portfolio"}:${r.module}`;
}

/**
 * The most recent run per client+module. Does not assume input ordering —
 * the caller's `.order()` is a query detail, and relying on it silently is how
 * a re-ordered query becomes a wrong dashboard.
 */
export function latestRunPerModule(runs: CollectorRunRow[]): Map<string, CollectorRunRow> {
  const latest = new Map<string, CollectorRunRow>();
  for (const r of runs) {
    const k = key(r);
    const seen = latest.get(k);
    if (!seen || r.started_at > seen.started_at) latest.set(k, r);
  }
  return latest;
}

/**
 * Client+module pairs whose LATEST run errored — i.e. what is broken now,
 * rather than what has ever broken in the window.
 */
export function failingModules(runs: CollectorRunRow[]): FailingModule[] {
  const out: FailingModule[] = [];
  for (const r of latestRunPerModule(runs).values()) {
    if (r.status !== "error") continue;
    out.push({ clientId: r.client_id, module: r.module, error: r.error, startedAt: r.started_at });
  }
  return out;
}

/**
 * Trims a collector error for a one-line rail without hiding that it was cut.
 * `max` is the total output length including the ellipsis — which is one
 * character (U+2026), not three.
 */
export function shortError(error: string | null, max = 160): string {
  if (!error) return "";
  return error.length > max ? `${error.slice(0, max - 1)}…` : error;
}

/**
 * Which shards of today's collection never recorded a completed pass?
 *
 * The failure this exists for: a shard killed at Vercel's 300s ceiling writes
 * NOTHING. No error row, no partial marker — the clients it owned simply keep
 * yesterday's rows and look untouched. That is how a 504 stayed invisible in
 * the data for two days while the dashboard and the daily brief both reported
 * a normal morning on a portfolio that had only partly been collected.
 *
 * So completion is recorded positively and absence is the signal. Each shard
 * writes one `collect_pass` row when it reaches the end; the last shard counts
 * them and says which numbers are missing. A shard that died, and a shard whose
 * cron never fired at all, are indistinguishable here and deliberately so —
 * both mean the same thing to the person reading it, and Vercel's own cron log
 * separates them if anyone needs to know which.
 *
 * Shard numbers in and out are 1-based, matching what `describeScope` prints.
 */
export function missingShards(details: (string | null)[], of: number): number[] {
  const seen = new Set<number>();
  for (const d of details) {
    const m = /^shard (\d+)\/(\d+)/.exec(d ?? "");
    // A row from a different shard count is a different day's schedule — it
    // says nothing about whether today is complete, so it is not evidence.
    if (m && Number(m[2]) === of) seen.add(Number(m[1]));
  }
  return Array.from({ length: of }, (_, i) => i + 1).filter((n) => !seen.has(n));
}
