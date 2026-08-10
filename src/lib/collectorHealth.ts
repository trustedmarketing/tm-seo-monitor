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
