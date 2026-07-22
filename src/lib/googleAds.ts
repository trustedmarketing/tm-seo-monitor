// lib/googleAds.ts — Google Ads API client (v18, GAQL searchStream). Ad-level
// metrics for the last `days` days. Read-only. Never logs a credential — the
// access token / developer token / login-customer-id are only ever used as
// outgoing request headers, matching the "secrets never surface" rule
// (docs/CLAUDE-monitor-draft.md, autonomy #5).
import { mockApis, readFixture } from "@/lib/apiMock";

const API_VERSION = "v18";
const API_BASE = "https://googleads.googleapis.com";

// Auth bundle fetchAdMetrics needs: a minted OAuth accessToken plus the
// manager-account developerToken/loginCustomerId. lib/googleAdsCollector.ts
// resolves this either from a ready-made vault/env bundle, or by minting the
// accessToken from a durable refresh token (mintAccessToken below).
export interface GoogleAdsAuth {
  accessToken: string;
  developerToken: string;
  loginCustomerId: string;
}

// Durable OAuth credentials (portfolio-level, vaulted as `google_ads_oauth`).
// The refresh token does not expire (the OAuth app is "Internal"); it's
// exchanged for a short-lived access token on every collection run.
export interface GoogleAdsOAuth {
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

// Exchange a refresh token for a short-lived access token. Never logs a
// credential. Under MOCK_APIS=1 it returns a placeholder without a network
// call — fetchAdMetrics reads fixtures in that mode, so the token is unused.
export async function mintAccessToken(oauth: GoogleAdsOAuth): Promise<string> {
  if (mockApis()) return "mock-access-token";
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: oauth.client_id,
      client_secret: oauth.client_secret,
      refresh_token: oauth.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google OAuth token refresh failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Google OAuth token refresh returned no access_token");
  return json.access_token;
}

// Raw shape of one GAQL result row, keyed by the resource/field paths
// selected in the query below (segments.date, campaign.id, campaign.name,
// ad_group.id, ad_group_ad.ad.id, metrics.*).
export interface GoogleAdsRawRow {
  segments?: { date?: string };
  campaign?: { id?: string | number; name?: string };
  ad_group?: { id?: string | number };
  ad_group_ad?: { ad?: { id?: string | number } };
  metrics?: {
    impressions?: string | number;
    clicks?: string | number;
    cost_micros?: string | number;
    conversions?: string | number;
    conversions_value?: string | number;
  };
}

// One batch of the searchStream response — the live endpoint streams an
// array of these; each carries a slice of `results`.
interface SearchStreamBatch {
  results?: GoogleAdsRawRow[];
}

// Mapped, DB-ready shape — one row per ad per day, matching ad_metrics_daily.
export interface AdMetricRow {
  date: string;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  ad_id: string | null;
  creative_id: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue: number;
}

function toNumber(v: string | number | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// cost_micros is the account currency's smallest unit x 1,000,000 — Google
// Ads reports everything in micros. Divide by 1_000_000 to get spend in the
// account's currency, matching what the Ads UI shows.
const MICROS_PER_UNIT = 1_000_000;

function mapRow(raw: GoogleAdsRawRow): AdMetricRow {
  const metrics = raw.metrics ?? {};
  return {
    date: raw.segments?.date ?? "",
    campaign_id: raw.campaign?.id != null ? String(raw.campaign.id) : null,
    campaign_name: raw.campaign?.name ?? null,
    adset_id: raw.ad_group?.id != null ? String(raw.ad_group.id) : null,
    ad_id: raw.ad_group_ad?.ad?.id != null ? String(raw.ad_group_ad.ad.id) : null,
    creative_id: null, // not exposed by the ad_group_ad.ad fields selected below
    impressions: toNumber(metrics.impressions),
    clicks: toNumber(metrics.clicks),
    spend: toNumber(metrics.cost_micros) / MICROS_PER_UNIT,
    conversions: toNumber(metrics.conversions),
    revenue: toNumber(metrics.conversions_value),
  };
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildQuery(startDate: string, endDate: string): string {
  return `
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group_ad.ad.id,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM ad_group_ad
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  `.trim();
}

// POST /v18/customers/{customerId}/googleAds:searchStream, GAQL selecting
// segments.date, campaign.id/name, ad_group.id, ad_group_ad.ad.id, and the
// core metrics over the last `days` days. Under MOCK_APIS=1, reads raw GAQL
// rows from the fixture and runs them through the same mapping — so the
// cost_micros -> spend conversion is exercised in tests too.
export async function fetchAdMetrics(
  auth: GoogleAdsAuth,
  customerId: string,
  days = 28
): Promise<AdMetricRow[]> {
  if (mockApis()) {
    const raw = readFixture<GoogleAdsRawRow[]>("google/ad_metrics.json");
    return raw.map(mapRow);
  }

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const url = `${API_BASE}/${API_VERSION}/customers/${customerId}/googleAds:searchStream`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "developer-token": auth.developerToken,
      "login-customer-id": auth.loginCustomerId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: buildQuery(iso(start), iso(end)) }),
  });

  if (!res.ok) {
    throw new Error(`Google Ads searchStream request failed: ${res.status} ${res.statusText}`);
  }

  const batches = (await res.json()) as SearchStreamBatch[];
  const rows: AdMetricRow[] = [];
  for (const batch of batches ?? []) {
    for (const raw of batch.results ?? []) rows.push(mapRow(raw));
  }
  return rows;
}
