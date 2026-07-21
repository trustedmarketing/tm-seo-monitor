// lib/jobs.ts — durable work queue (Phase A.5, WO-001 stream 1).
// Splits collection into idempotent, retryable units so we never depend on one
// 300s cron request fanning across 13 clients × N modules. Backfills enqueue as
// chunks; a failed unit retries with backoff, then parks as 'dead'.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Job {
  id: number;
  job_type: string;
  client_id: string | null;
  payload: Record<string, unknown>;
  idempotency_key: string | null;
  status: "queued" | "running" | "succeeded" | "failed" | "dead";
  priority: number;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
}

export interface EnqueueInput {
  jobType: string;
  clientId?: string | null;
  payload?: Record<string, unknown>;
  idempotencyKey?: string; // dedupe: a repeat key is a no-op
  priority?: number; // lower = sooner (default 100)
  runAfter?: Date;
  maxAttempts?: number;
}

// Enqueue a job. Idempotent on idempotencyKey. Returns the new job id, or null if
// a job with that key already exists (dedupe) — never throws on that race.
export async function enqueue(db: SupabaseClient, input: EnqueueInput): Promise<number | null> {
  const row = {
    job_type: input.jobType,
    client_id: input.clientId ?? null,
    payload: input.payload ?? {},
    idempotency_key: input.idempotencyKey ?? null,
    priority: input.priority ?? 100,
    run_after: (input.runAfter ?? new Date()).toISOString(),
    max_attempts: input.maxAttempts ?? 3,
  };
  const { data, error } = await db.from("jobs").insert(row).select("id").maybeSingle();
  if (error) {
    if ((error as { code?: string }).code === "23505") return null; // unique_violation → already queued
    throw error;
  }
  return (data as { id: number } | null)?.id ?? null;
}

// Claim up to `limit` due jobs, marking them running+locked. The status guard on
// UPDATE makes the claim safe against a second worker taking the same row.
export async function claimDue(db: SupabaseClient, worker: string, limit = 10): Promise<Job[]> {
  const nowIso = new Date().toISOString();
  const { data: due } = await db
    .from("jobs")
    .select("*")
    .in("status", ["queued", "failed"])
    .lte("run_after", nowIso)
    .order("priority", { ascending: true })
    .order("run_after", { ascending: true })
    .limit(limit);

  const claimed: Job[] = [];
  for (const j of (due ?? []) as Job[]) {
    const { data: upd } = await db
      .from("jobs")
      .update({
        status: "running",
        locked_at: nowIso,
        locked_by: worker,
        attempts: j.attempts + 1,
        updated_at: nowIso,
      })
      .eq("id", j.id)
      .in("status", ["queued", "failed"]) // lost the race → skip
      .select("*")
      .maybeSingle();
    if (upd) claimed.push(upd as Job);
  }
  return claimed;
}

export async function succeed(db: SupabaseClient, id: number): Promise<void> {
  await db
    .from("jobs")
    .update({ status: "succeeded", locked_at: null, locked_by: null, updated_at: new Date().toISOString() })
    .eq("id", id);
}

// Fail a job: retry with exponential backoff until max_attempts, then park 'dead'.
export async function fail(db: SupabaseClient, job: Job, error: string): Promise<void> {
  const dead = job.attempts >= job.max_attempts;
  const backoffMs = Math.min(2 ** job.attempts * 60_000, 3_600_000); // 1m,2m,4m… cap 1h
  await db
    .from("jobs")
    .update({
      status: dead ? "dead" : "failed",
      last_error: error,
      run_after: new Date(Date.now() + backoffMs).toISOString(),
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
}
