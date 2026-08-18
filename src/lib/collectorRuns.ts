// lib/collectorRuns.ts — observability spine (Phase A.5, WO-001 stream 1).
// Wrap any unit of collection so every run lands in collector_runs with
// status/duration/error. The failure path RECORDS instead of throwing, so one
// module failing never sinks the batch or hides itself behind a 200.
import type { SupabaseClient } from "@supabase/supabase-js";

export type RunStatus = "success" | "error" | "skipped";

export interface RunResult {
  status: RunStatus;
  detail?: string;
  error?: string;
  rows_written?: number;
  duration_ms: number;
}

// Record a completed run. Never throws — observability must not break collection.
export async function recordRun(
  db: SupabaseClient,
  module: string,
  clientId: string | null,
  result: RunResult
): Promise<void> {
  try {
    await db.from("collector_runs").insert({
      module,
      client_id: clientId,
      status: result.status,
      detail: result.detail ?? null,
      error: result.error ?? null,
      rows_written: result.rows_written ?? null,
      started_at: new Date(Date.now() - result.duration_ms).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: result.duration_ms,
    });
  } catch (e) {
    console.error("[collector_runs] insert failed:", (e as Error).message);
  }
}

// Run `fn`, time it, record the outcome. Returns fn's value on success, or null on
// failure (after recording the error) — the caller decides how to proceed.
//
// `fn` may return `skipped: true` for "there was nothing to do", which records a
// `skipped` run rather than a `success` one.
//
// That flag exists because it was missing. `tracked()` had exactly two outcomes,
// so a collector using it could not say "this client is not configured" — it
// returned success. Meta's collector calls recordRun directly and correctly
// recorded `skipped` for the same condition, so the two disagreed: an arX Display
// collection recorded `google_ads: success` and `meta_ads: skipped` in the same
// second, for the same missing `ad_platform_accounts` row.
//
// `skipped` being invisible in the UI is a known gap. `success` is worse, and a
// different kind of wrong: it is a positive claim. It counts toward the day's
// collection total, it satisfies the freshness check, and it tells anyone reading
// that Google Ads collection worked for a client that has no Google Ads account
// connected. The detail string carried the truth and nothing renders details.
export async function tracked<T>(
  db: SupabaseClient,
  module: string,
  clientId: string | null,
  fn: () => Promise<{ value: T; rows?: number; detail?: string; skipped?: boolean }>
): Promise<T | null> {
  const started = Date.now();
  try {
    const { value, rows, detail, skipped } = await fn();
    await recordRun(db, module, clientId, {
      status: skipped ? "skipped" : "success",
      detail,
      // A skipped run wrote nothing. Reporting `rows_written: 0` is accurate but
      // invites reading it as "collected, found nothing", which is a different
      // claim from "did not run".
      rows_written: skipped ? undefined : rows,
      duration_ms: Date.now() - started,
    });
    return value;
  } catch (e) {
    await recordRun(db, module, clientId, {
      status: "error", error: (e as Error).message, duration_ms: Date.now() - started,
    });
    return null;
  }
}
