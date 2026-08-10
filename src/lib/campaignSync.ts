// lib/campaignSync.ts — WO-006 stream A: shared upsert for the `campaigns`
// registry, called from each ad-platform collector after it syncs
// ad_metrics_daily. Upsert-by-hand (select existing -> update, else insert),
// matching the existing collector convention, so this stays testable against
// tests/helpers/fakeDb.ts, which doesn't implement PostgREST's upsert.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface CampaignSyncRow {
  campaign_id: string;
  campaign_name: string | null;
  status: "active" | "paused" | "removed";
  objective: string | null;
  daily_budget: number | null;
}

// Upserts `rows` into `campaigns` keyed on (client_id, platform, campaign_id).
// Never throws — a failure here should not sink the metrics collection that
// already succeeded; callers wrap this in their own tracked()/recordRun().
export async function upsertCampaigns(
  db: SupabaseClient,
  clientId: string,
  platform: string,
  rows: CampaignSyncRow[]
): Promise<number> {
  const now = new Date().toISOString();
  let written = 0;

  for (const r of rows) {
    if (!r.campaign_id) continue;

    const { data: existing } = await db
      .from("campaigns")
      .select("id")
      .eq("client_id", clientId)
      .eq("platform", platform)
      .eq("campaign_id", r.campaign_id)
      .maybeSingle();

    const payload = {
      client_id: clientId,
      platform,
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name,
      status: r.status,
      objective: r.objective,
      daily_budget: r.daily_budget,
      last_synced_at: now,
      updated_at: now,
    };

    if (existing) {
      await db.from("campaigns").update(payload).eq("id", (existing as { id: string }).id);
    } else {
      await db.from("campaigns").insert(payload);
    }
    written++;
  }

  return written;
}
