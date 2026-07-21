// lib/tokenExpiry.ts — proactive re-auth alerting (Stream 2, WO-001).
// Standalone, schedulable check: find platform tokens expiring soon (or already
// expired per the registry), alert Slack, and record the run in collector_runs
// so a silent gap here is as visible as any other collection module's.
import type { SupabaseClient } from "@supabase/supabase-js";
import { listExpiring } from "@/lib/vault";
import { slackAlert } from "@/lib/slack";
import { recordRun } from "@/lib/collectorRuns";

const MODULE = "token_expiry";
const DEFAULT_WINDOW_DAYS = 14;

export interface TokenExpiryResult {
  expiring: number;
}

// Never throws — mirrors the tracked()/recordRun() contract: a failure here
// records an error row instead of sinking whatever schedule calls it.
export async function checkTokenExpiry(
  db: SupabaseClient,
  withinDays: number = DEFAULT_WINDOW_DAYS
): Promise<TokenExpiryResult> {
  const started = Date.now();
  try {
    const expiring = await listExpiring(db, withinDays);

    if (expiring.length > 0) {
      const lines = expiring
        .map((s) => `• client ${s.client_id} / ${s.platform}: expires ${s.expires_at} (auth_ref ${s.auth_ref})`)
        .join("\n");
      await slackAlert(
        `:key: *Growth OS token expiry* — ${expiring.length} platform token(s) expiring within ${withinDays}d\n${lines}`
      );
    }

    await recordRun(db, MODULE, null, {
      status: "success",
      detail: `${expiring.length} expiring within ${withinDays}d`,
      rows_written: expiring.length,
      duration_ms: Date.now() - started,
    });

    return { expiring: expiring.length };
  } catch (e) {
    await recordRun(db, MODULE, null, {
      status: "error",
      error: (e as Error).message,
      duration_ms: Date.now() - started,
    });
    return { expiring: 0 };
  }
}
