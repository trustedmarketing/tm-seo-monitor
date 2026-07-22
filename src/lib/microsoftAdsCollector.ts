// lib/microsoftAdsCollector.ts — WO-001 stream 6: Microsoft/Bing ads collector
// → ad_metrics_daily. Standalone collector, not wired into the cron route
// (left to the CTO — see docs/CLAUDE-monitor-draft.md). Takes `db` as a param
// so it's unit-testable against tests/helpers/fakeDb.ts.
//
// Reuses the EXISTING ad_metrics_daily table (platform='microsoft') and the
// EXISTING ad_platform_accounts registry (platform='microsoft', external_id =
// Microsoft Advertising account id, auth_ref -> vault) — no new migration.
//
// Upsert-by-hand (select existing → update, else insert) rather than a native
// `.upsert()` call: mirrors lib/metaAdsCollector.ts and lib/shopifyCollector.ts,
// and keeps this collector testable against the in-memory fake, which doesn't
// implement PostgREST's upsert.
//
// Microsoft Advertising auth is a three-part bundle (developer token + OAuth
// access token + customer id) rather than a single token, so it's vaulted as
// one JSON string under the account's auth_ref and parsed back out here.
// "Secrets never surface" (docs/CLAUDE-monitor-draft.md, autonomy #5): the
// parsed bundle is only ever passed to fetchAdMetrics(); it's never logged or
// included in a detail/error string recorded to collector_runs.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAdMetrics, type MicrosoftAdsAuth } from "@/lib/microsoftAds";
import { readSecret } from "@/lib/vault";
import { tracked } from "@/lib/collectorRuns";
import { mockApis } from "@/lib/apiMock";

const MODULE = "microsoft_ads";
const PLATFORM = "microsoft";

export interface MicrosoftAdsClient {
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

// The vaulted/env credential value is a JSON string:
// { "developerToken": "...", "accessToken": "...", "customerId": "..." }
// Returns null (never throws) if it's missing a required field or isn't valid
// JSON — the caller treats that the same as "no credentials available".
function parseAuthBundle(raw: string): MicrosoftAdsAuth | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed.developerToken || !parsed.accessToken || !parsed.customerId) return null;
    return {
      developerToken: String(parsed.developerToken),
      accessToken: String(parsed.accessToken),
      customerId: String(parsed.customerId),
    };
  } catch {
    return null;
  }
}

// Collects the last `days` days of Microsoft/Bing ad-level performance for
// `client` and upserts them into ad_metrics_daily by (client_id, platform,
// date, ad_id) with platform='microsoft'. Never throws — every path (no
// account, no credentials, API/db error) records a collector_runs row and
// returns 0 instead of propagating.
export async function collectMicrosoftAds(
  db: SupabaseClient,
  client: MicrosoftAdsClient,
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
      return { value: 0, rows: 0, detail: `no microsoft ad_platform_accounts row for ${client.domain}` };
    }

    const row = account as AdPlatformAccountRow;

    let auth: MicrosoftAdsAuth | null = null;
    if (row.auth_ref) {
      const secret = await readSecret(db, row.auth_ref);
      if (secret) auth = parseAuthBundle(secret);
    } else if (process.env.MICROSOFT_ADS_CREDS) {
      auth = parseAuthBundle(process.env.MICROSOFT_ADS_CREDS);
    }

    if (!auth && !mockApis()) {
      return {
        value: 0,
        rows: 0,
        detail: `no Microsoft Ads credentials available for ${client.domain} (no auth_ref/vault secret and MICROSOFT_ADS_CREDS unset)`,
      };
    }

    const metrics = await fetchAdMetrics(
      auth ?? { developerToken: "", accessToken: "", customerId: "" },
      row.external_id,
      days
    );

    let written = 0;
    for (const r of metrics) {
      const { data: existing } = await db
        .from("ad_metrics_daily")
        .select("id")
        .eq("client_id", client.id)
        .eq("platform", PLATFORM)
        .eq("date", r.date)
        .eq("ad_id", r.ad_id)
        .maybeSingle();

      const payload = {
        client_id: client.id,
        platform: PLATFORM,
        date: r.date,
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name,
        adset_id: r.adset_id,
        ad_id: r.ad_id,
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

    return { value: written, rows: written, detail: `wrote ${written} row(s) for ${client.domain}` };
  });

  return result ?? 0;
}
