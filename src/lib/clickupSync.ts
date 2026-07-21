// lib/clickupSync.ts — Stream 5: approved recommendations → ClickUp tasks → shipped.
// Standalone (db passed as a param, unit-testable with tests/helpers/fakeDb.ts).
// Not wired into the cron route or admin route yet — the CTO wires that up once
// migration 007 is applied and CLICKUP_TOKEN / per-client clickup_list_id exist.
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordRun } from "@/lib/collectorRuns";
import { createTaskFromRec, type RecSeverity } from "@/lib/clickup";

const MODULE = "clickup_sync";

export interface ClickupSyncClient {
  id: string;
  clickup_list_id: string | null;
}

// For each `approved` rec on this client with no ClickUp task yet, create one
// and stamp clickup_task_id/clickup_task_url/clickup_synced_at on the rec.
// Records a collector_runs row for the run (success/error/skipped) — never throws.
export async function syncApprovedRecs(
  db: SupabaseClient,
  client: ClickupSyncClient
): Promise<number> {
  const started = Date.now();

  if (!client.clickup_list_id) {
    await recordRun(db, MODULE, client.id, {
      status: "skipped",
      detail: "no clickup_list_id configured for this client",
      duration_ms: Date.now() - started,
    });
    return 0;
  }

  try {
    const { data: recs, error } = await db
      .from("recommendations")
      .select("id, title, detail, severity")
      .eq("client_id", client.id)
      .eq("status", "approved")
      .is("clickup_task_id", null);
    if (error) throw new Error(error.message ?? String(error));

    let synced = 0;
    for (const rec of (recs ?? []) as {
      id: string; title: string; detail: string; severity: RecSeverity;
    }[]) {
      const task = await createTaskFromRec(client.clickup_list_id, {
        title: rec.title,
        detail: rec.detail,
        severity: rec.severity,
      });
      if (!task) continue; // resilient: ClickUp down/unconfigured just skips this rec

      await db.from("recommendations").update({
        clickup_task_id: task.id,
        clickup_task_url: task.url,
        clickup_synced_at: new Date().toISOString(),
      }).eq("id", rec.id);
      synced++;
    }

    await recordRun(db, MODULE, client.id, {
      status: "success",
      detail: `synced ${synced} of ${(recs ?? []).length} approved rec(s)`,
      rows_written: synced,
      duration_ms: Date.now() - started,
    });
    return synced;
  } catch (e) {
    await recordRun(db, MODULE, client.id, {
      status: "error",
      error: (e as Error).message,
      duration_ms: Date.now() - started,
    });
    return 0;
  }
}

// Completion path: a ClickUp task tied to a recommendation was marked done.
// Mirrors the manual "mark shipped" flow in src/app/api/track/route.ts
// (log_change action) — flips the rec to 'measuring' (starts the 28-day
// before/after measurement in lib/recSync.ts) and inserts a changes ledger row,
// tagged source='clickup' so its provenance is visible in the ledger.
export async function markShippedFromClickup(
  db: SupabaseClient,
  recId: string,
  changeTitle: string
): Promise<boolean> {
  try {
    const { data: rec, error: findError } = await db
      .from("recommendations")
      .select("id, client_id")
      .eq("id", recId)
      .maybeSingle();
    if (findError) throw new Error(findError.message ?? String(findError));
    if (!rec) return false;

    const changedAt = new Date().toISOString().slice(0, 10);
    const { error: insertError } = await db.from("changes").insert({
      client_id: rec.client_id,
      recommendation_id: recId,
      title: changeTitle,
      changed_at: changedAt,
      source: "clickup",
    });
    if (insertError) throw new Error(insertError.message ?? String(insertError));

    const { error: updateError } = await db.from("recommendations").update({
      status: "measuring",
      shipped_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", recId);
    if (updateError) throw new Error(updateError.message ?? String(updateError));

    return true;
  } catch (e) {
    console.error("[clickup_sync] markShippedFromClickup failed:", (e as Error).message);
    return false;
  }
}
