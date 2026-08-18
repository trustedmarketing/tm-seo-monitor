// lib/googleAds.ts — Google Ads API client (GAQL searchStream). Ad-level
// metrics for the last `days` days. Read-only. Never logs a credential — the
// access token / developer token / login-customer-id are only ever used as
// outgoing request headers, matching the "secrets never surface" rule
// (docs/CLAUDE-monitor-draft.md, autonomy #5).
import { mockApis, readFixture } from "@/lib/apiMock";

// The Google Ads API sunsets versions on a rolling schedule — roughly one a
// quarter, each supported about a year. A sunset version does not degrade or
// warn: the path stops existing and googleapis.com answers an HTML 404, which
// every caller here wraps as "request failed: 404 Not Found" and reads like a
// bad customer id. v18 died that way and took the collector, the execution
// adapter and the ops check with it, silently, for months.
//
// Verified live 2026-08-18 by probing unauthenticated: a live version answers
// JSON UNAUTHENTICATED, a dead one answers an HTML 404. v22–v26 were live;
// v14–v21 were gone. Re-run that probe when this needs bumping — it needs no
// credentials.
//
// Exported because it was previously copied into three files, so bumping it
// meant finding all three. api/ops/google-ads-check names this failure mode
// explicitly rather than surfacing the HTML.
export const API_VERSION = "v26";

// Candidate versions for api/ops/google-ads-check's sweep, newest first.
//
// Why a sweep and not a probe: an *unauthenticated* request cannot tell you
// which versions actually serve. googleapis.com answers a known method name
// with 401 before dispatching, and an unknown one with an HTML 404 — so the
// method name is checked globally while the version is not. v18 read as "dead"
// and v26 as "live" from outside; authenticated, v26 answered "Method not
// found." Only a credentialed call settles it, so the check makes one per
// candidate and reports what each said.
export const CANDIDATE_API_VERSIONS = ["v26", "v25", "v24", "v23", "v22", "v21", "v20", "v19"] as const;
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

// Raw shape of one GAQL result row for the campaign-list query below.
export interface GoogleCampaignRawRow {
  campaign?: { id?: string | number; name?: string; status?: string; advertising_channel_type?: string };
  campaign_budget?: { amount_micros?: string | number };
}

// Mapped, DB-ready shape — one row per campaign, for the `campaigns` registry
// (WO-006 stream A), not ad_metrics_daily.
export interface CampaignRow {
  campaign_id: string;
  campaign_name: string | null;
  status: "active" | "paused" | "removed";
  objective: string | null;
  daily_budget: number | null;
}

// Google Ads campaign.status: UNSPECIFIED | UNKNOWN | ENABLED | PAUSED | REMOVED.
function mapCampaignStatus(raw: string | undefined): "active" | "paused" | "removed" {
  if (raw === "ENABLED") return "active";
  if (raw === "PAUSED") return "paused";
  return "removed";
}

function mapCampaignRow(raw: GoogleCampaignRawRow): CampaignRow {
  const campaign = raw.campaign ?? {};
  return {
    campaign_id: campaign.id != null ? String(campaign.id) : "",
    campaign_name: campaign.name ?? null,
    status: mapCampaignStatus(campaign.status),
    objective: campaign.advertising_channel_type ?? null,
    daily_budget:
      raw.campaign_budget?.amount_micros != null
        ? toNumber(raw.campaign_budget.amount_micros) / MICROS_PER_UNIT
        : null,
  };
}

function buildCampaignQuery(): string {
  return `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign_budget.amount_micros
    FROM campaign
  `.trim();
}

// POST /{API_VERSION}/customers/{customerId}/googleAds:searchStream, campaign-level
// status/budget/objective for the `campaigns` registry (not insights).
// Under MOCK_APIS=1, reads from a fixture.
export async function fetchCampaigns(auth: GoogleAdsAuth, customerId: string): Promise<CampaignRow[]> {
  if (mockApis()) {
    const raw = readFixture<GoogleCampaignRawRow[]>("google/campaigns.json");
    return raw.map(mapCampaignRow);
  }

  const url = `${API_BASE}/${API_VERSION}/customers/${customerId}/googleAds:searchStream`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "developer-token": auth.developerToken,
      "login-customer-id": auth.loginCustomerId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: buildCampaignQuery() }),
  });

  if (!res.ok) {
    throw new Error(`Google Ads campaign searchStream request failed: ${res.status} ${res.statusText}`);
  }

  const batches = (await res.json()) as SearchStreamBatch[];
  const rows: CampaignRow[] = [];
  for (const batch of batches ?? []) {
    for (const raw of (batch.results as unknown as GoogleCampaignRawRow[] | undefined) ?? []) {
      rows.push(mapCampaignRow(raw));
    }
  }
  return rows;
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

// POST /{API_VERSION}/customers/{customerId}/googleAds:searchStream, GAQL selecting
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
