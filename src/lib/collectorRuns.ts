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
export async function tracked<T>(
  db: SupabaseClient,
  module: string,
  clientId: string | null,
  fn: () => Promise<{ value: T; rows?: number; detail?: string }>
): Promise<T | null> {
  const started = Date.now();
  try {
    const { value, rows, detail } = await fn();
    await recordRun(db, module, clientId, {
      status: "success", detail, rows_written: rows, duration_ms: Date.now() - started,
    });
    return value;
  } catch (e) {
    await recordRun(db, module, clientId, {
      status: "error", error: (e as Error).message, duration_ms: Date.now() - started,
    });
    return null;
  }
}
