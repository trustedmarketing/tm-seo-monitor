// lib/googleAdsCollector.ts — Google Ads collector → ad_metrics_daily
// (platform='google_ads'). Reuses the existing ad_platform_accounts /
// ad_metrics_daily tables from supabase/009_meta_ads.sql — no new migration.
// Standalone collector, not wired into the cron route (left to the CTO — see
// docs/wo-001-parallel-build-enabling-layer.md). Takes `db` as a param so
// it's unit-testable against tests/helpers/fakeDb.ts.
//
// Upsert-by-hand (select existing → update, else insert) rather than a native
// `.upsert()` call: mirrors lib/metaAdsCollector.ts and lib/shopifyCollector.ts,
// and keeps this collector testable against the in-memory fake, which doesn't
// implement PostgREST's upsert.
//
// "Secrets never surface" (docs/CLAUDE-monitor-draft.md, autonomy #5): the
// creds bundle (accessToken/developerToken/loginCustomerId) is only ever
// passed to fetchAdMetrics(); it's never logged or included in a
// detail/error string recorded to collector_runs.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAdMetrics, type GoogleAdsAuth } from "@/lib/googleAds";
import { readSecret } from "@/lib/vault";
import { tracked } from "@/lib/collectorRuns";
import { mockApis } from "@/lib/apiMock";

const MODULE = "google_ads";
const PLATFORM = "google_ads";

export interface GoogleAdsClient {
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

// Parses the JSON creds bundle string (from Vault or env). Returns null (not
// throw) on missing/invalid JSON or missing fields, so the caller can record
// a `skipped` run instead of an `error` for a plain config gap.
function parseAuth(raw: string | null): GoogleAdsAuth | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GoogleAdsAuth>;
    if (!parsed.accessToken || !parsed.developerToken || !parsed.loginCustomerId) return null;
    return parsed as GoogleAdsAuth;
  } catch {
    return null;
  }
}

// Collects the last `days` days of Google Ads ad-level metrics for `client`
// and upserts them into ad_metrics_daily by (client_id, platform, date, ad_id)
// with platform='google_ads'. Never throws — every path (no account, no
// creds, API/db error) records a collector_runs row and returns 0 instead.
export async function collectGoogleAds(
  db: SupabaseClient,
  client: GoogleAdsClient,
  days = 28
): Promise<number> {
  const result = await tracked(db, MODULE, client.id, async () => {
    const { data: account } = await db
      .from("ad_platform_accounts")
      .select("id, client_id, platform, external_id, status, auth_ref")
      .eq("client_id", client.id)
      .eq("platform", PLATFORM)
      .maybeSingle();

    if (!account) {
      return { value: 0, rows: 0, detail: `no google_ads ad_platform_accounts row for ${client.domain}` };
    }

    const row = account as AdPlatformAccountRow;

    let raw: string | null = null;
    if (row.auth_ref) {
      raw = await readSecret(db, row.auth_ref);
    } else if (process.env.GOOGLE_ADS_CREDS) {
      raw = process.env.GOOGLE_ADS_CREDS;
    }

    const auth = parseAuth(raw);

    if (!auth && !mockApis()) {
      return {
        value: 0,
        rows: 0,
        detail: `no Google Ads creds bundle available for ${client.domain} (no auth_ref/vault secret and GOOGLE_ADS_CREDS unset, or invalid JSON)`,
      };
    }

    const fallbackAuth: GoogleAdsAuth = { accessToken: "", developerToken: "", loginCustomerId: "" };
    const metrics = await fetchAdMetrics(auth ?? fallbackAuth, row.external_id, days);

    let written = 0;
    for (const m of metrics) {
      const { data: existing } = await db
        .from("ad_metrics_daily")
        .select("id")
        .eq("client_id", client.id)
        .eq("platform", PLATFORM)
        .eq("date", m.date)
        .eq("ad_id", m.ad_id)
        .maybeSingle();

      const payload = {
        client_id: client.id,
        platform: PLATFORM,
        date: m.date,
        campaign_id: m.campaign_id,
        campaign_name: m.campaign_name,
        adset_id: m.adset_id,
        ad_id: m.ad_id,
        creative_id: m.creative_id,
        impressions: m.impressions,
        clicks: m.clicks,
        spend: m.spend,
        conversions: m.conversions,
        revenue: m.revenue,
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

    return { value: written, rows: written, detail: `wrote ${written} row(s) for ${client.domain}` };
  });

  return result ?? 0;
}
