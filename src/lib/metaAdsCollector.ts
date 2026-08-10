// lib/metaAdsCollector.ts — WO-001 stream 4: Meta ads collector → ad_metrics_daily.
// Standalone collector, not wired into the cron route (left to the CTO — see
// docs/wo-001-parallel-build-enabling-layer.md). Takes `db` as a param so it's
// unit-testable against tests/helpers/fakeDb.ts.
//
// Upsert-by-hand (select existing → update, else insert) rather than a native
// `.upsert()` call: mirrors lib/conversionsCollector.ts, and keeps this
// collector testable against the in-memory fake, which doesn't implement
// PostgREST's upsert.
//
// "Secrets never surface" (docs/CLAUDE-monitor-draft.md, autonomy #5): the
// access token is only ever passed to fetchAdInsights(); it's never logged or
// included in a `detail`/`error` string recorded to collector_runs.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAdInsights, fetchCampaigns } from "@/lib/meta";
import { readSecret } from "@/lib/vault";
import { recordRun } from "@/lib/collectorRuns";
import { mockApis } from "@/lib/apiMock";
import { upsertCampaigns } from "@/lib/campaignSync";

const MODULE = "meta_ads";

export interface MetaAdsClient {
  id: string;
  domain: string;
}

interface AdPlatformAccountRow {
  id: string;
  client_id: string;
  platform: string;
  external_id: string;
  status: string;
  auth_ref: string | null;
}

// Collects the last `days` days of Meta ad-level insights for `client` and
// upserts them into ad_metrics_daily by (client_id, platform, date, ad_id).
// Never throws — every path (no account, no token, API/db error) records a
// collector_runs row and returns 0 instead.
export async function collectMetaAds(
  db: SupabaseClient,
  client: MetaAdsClient,
  days = 28
): Promise<number> {
  const started = Date.now();

  try {
    const { data: account } = await db
      .from("ad_platform_accounts")
      .select("id, client_id, platform, external_id, status, auth_ref")
      .eq("client_id", client.id)
      .eq("platform", "meta")
      .maybeSingle();

    if (!account) {
      await recordRun(db, MODULE, client.id, {
        status: "skipped",
        detail: `no meta ad_platform_accounts row for ${client.domain}`,
        duration_ms: Date.now() - started,
      });
      return 0;
    }

    const row = account as AdPlatformAccountRow;

    let token: string | null = null;
    if (row.auth_ref) {
      token = await readSecret(db, row.auth_ref);
    } else if (process.env.META_ACCESS_TOKEN) {
      token = process.env.META_ACCESS_TOKEN;
    }

    if (!token && !mockApis()) {
      await recordRun(db, MODULE, client.id, {
        status: "skipped",
        detail: `no Meta access token available for ${client.domain} (no auth_ref/vault secret and META_ACCESS_TOKEN unset)`,
        duration_ms: Date.now() - started,
      });
      return 0;
    }

    const insights = await fetchAdInsights(token ?? "", row.external_id, days);

    // Campaign entity sync (WO-006 stream A) — status/budget/objective, into
    // the `campaigns` registry. Separate endpoint from insights above; a
    // failure here is folded into the same catch block as the rest of the run.
    const campaigns = await fetchCampaigns(token ?? "", row.external_id);
    const campaignsSynced = await upsertCampaigns(db, client.id, "meta", campaigns);

    let written = 0;

    for (const r of insights) {
      const { data: existing } = await db
        .from("ad_metrics_daily")
        .select("id")
        .eq("client_id", client.id)
        .eq("platform", "meta")
        .eq("date", r.date)
        .eq("ad_id", r.ad_id)
        .maybeSingle();

      const payload = {
        client_id: client.id,
        platform: "meta",
        date: r.date,
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name,
        adset_id: r.adset_id,
        ad_id: r.ad_id,
        creative_id: r.creative_id,
        impressions: r.impressions,
        clicks: r.clicks,
        spend: r.spend,
        conversions: r.conversions,
        revenue: r.revenue,
      };

      if (existing) {
        await db
          .from("ad_metrics_daily")
          .update(payload)
          .eq("id", (existing as { id: string }).id);
      } else {
        await db.from("ad_metrics_daily").insert(payload);
      }
      written++;
    }

    await recordRun(db, MODULE, client.id, {
      status: "success",
      detail: `wrote ${written} row(s), synced ${campaignsSynced} campaign(s) for ${client.domain}`,
      rows_written: written,
      duration_ms: Date.now() - started,
    });
    return written;
  } catch (e) {
    await recordRun(db, MODULE, client.id, {
      status: "error",
      error: (e as Error).message,
      duration_ms: Date.now() - started,
    });
    return 0;
  }
}
