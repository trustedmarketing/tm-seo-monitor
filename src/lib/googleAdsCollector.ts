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
import { fetchAdMetrics, mintAccessToken, type GoogleAdsAuth, type GoogleAdsOAuth } from "@/lib/googleAds";
import { readSecret } from "@/lib/vault";
import { tracked } from "@/lib/collectorRuns";
import { mockApis } from "@/lib/apiMock";

const MODULE = "google_ads";
const PLATFORM = "google_ads";

// Portfolio-level vault secret names (one Google account/MCC covers every
// client account linked under it). The refresh-token bundle + developer token
// are vaulted once; the per-client customer id is the ad_platform_accounts
// external_id, and the manager-account id comes from the environment.
const OAUTH_SECRET = "google_ads_oauth";
const DEV_TOKEN_SECRET = "google_ads_developer_token";

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

// Parses the vaulted OAuth bundle (google_ads_oauth). Null on missing/invalid.
function parseOAuth(raw: string | null): GoogleAdsOAuth | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GoogleAdsOAuth>;
    if (!parsed.client_id || !parsed.client_secret || !parsed.refresh_token) return null;
    return parsed as GoogleAdsOAuth;
  } catch {
    return null;
  }
}

// Resolves a fetch-ready GoogleAdsAuth for `row`, in priority order:
//   1. An explicit ready-made bundle — per-account auth_ref secret, else the
//      GOOGLE_ADS_CREDS env override — carrying {accessToken, developerToken,
//      loginCustomerId}. (One-off overrides + the unit/staging test path.)
//   2. The production portfolio path: the vaulted refresh-token bundle
//      (google_ads_oauth) + vaulted developer token (google_ads_developer_token)
//      + manager-account id (GOOGLE_ADS_LOGIN_CUSTOMER_ID), minting a
//      short-lived access token per run.
// Returns null (→ graceful skip) when neither source is configured. A genuine
// refresh failure in path 2 throws, so it surfaces as an error run, not a skip.
async function resolveAuth(db: SupabaseClient, row: AdPlatformAccountRow): Promise<GoogleAdsAuth | null> {
  let rawBundle: string | null = null;
  if (row.auth_ref) rawBundle = await readSecret(db, row.auth_ref);
  else if (process.env.GOOGLE_ADS_CREDS) rawBundle = process.env.GOOGLE_ADS_CREDS;
  const bundle = parseAuth(rawBundle);
  if (bundle) return bundle;

  // Portfolio OAuth path. Read failures (e.g. no vault RPC in unit fakeDb) fall
  // through to a skip; a refresh failure below intentionally propagates.
  let oauthRaw: string | null = null;
  let devToken: string | null = null;
  try {
    [oauthRaw, devToken] = await Promise.all([
      readSecret(db, OAUTH_SECRET),
      readSecret(db, DEV_TOKEN_SECRET),
    ]);
  } catch {
    return null;
  }
  const oauth = parseOAuth(oauthRaw);
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  if (oauth && devToken && loginCustomerId) {
    const accessToken = await mintAccessToken(oauth);
    return { accessToken, developerToken: devToken, loginCustomerId: loginCustomerId.replace(/-/g, "") };
  }
  return null;
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

    const auth = await resolveAuth(db, row);

    if (!auth && !mockApis()) {
      return {
        value: 0,
        rows: 0,
        detail: `no Google Ads creds bundle available for ${client.domain} (no auth_ref/GOOGLE_ADS_CREDS override and no vaulted OAuth + developer token + GOOGLE_ADS_LOGIN_CUSTOMER_ID)`,
      };
    }

    const fallbackAuth: GoogleAdsAuth = { accessToken: "", developerToken: "", loginCustomerId: "" };
    // customer id in the request path is digits-only (strip any dashes).
    const metrics = await fetchAdMetrics(auth ?? fallbackAuth, row.external_id.replace(/-/g, ""), days);

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
