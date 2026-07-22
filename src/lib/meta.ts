// lib/meta.ts — Meta Marketing API client (Graph API v21+).
// Ad-level insights for the last `days` days. Read-only. Never logs the access
// token — it's only ever used as a query param on the outgoing request, matching
// the "secrets never surface" rule (docs/CLAUDE-monitor-draft.md, autonomy #5).
import { mockApis, readFixture } from "@/lib/apiMock";

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface MetaAction {
  action_type: string;
  value: string;
}

// Raw shape of one row of Meta's /insights response (level=ad, time_increment=1).
export interface MetaInsightRawRow {
  date_start: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  ad_id?: string;
  creative_id?: string;
  impressions?: string | number;
  clicks?: string | number;
  spend?: string | number;
  actions?: MetaAction[];
  action_values?: MetaAction[];
}

// Mapped, DB-ready shape — one row per ad per day.
export interface MetaInsightRow {
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

interface GraphInsightsResponse {
  data: MetaInsightRawRow[];
  paging?: { next?: string };
}

// Meta reports the SAME purchase under several overlapping action types
// (purchase, omni_purchase, offsite_conversion.fb_pixel_purchase,
// onsite_web_purchase, web_in_store_purchase, ...). Summing every substring
// match multiplies the true value — ~6x on a typical ecom account — which
// inflates ROAS. Take the single canonical cross-surface type instead:
// omni_purchase (the deduplicated "Purchases" Ads Manager reports), falling back
// to "purchase". Leads likewise resolve to one canonical type, not a sum.
// Priority order: the first type present on a row wins. omni_purchase is Meta's
// cross-surface umbrella and is present whenever purchases exist, so it's picked
// over its duplicates; the rest are fallbacks for rows that only report one.
const PURCHASE_ACTION_TYPES = [
  "omni_purchase",
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
  "onsite_web_purchase",
];
const LEAD_ACTION_TYPES = ["onsite_conversion.lead_grouped", "lead"];

function toNumber(v: string | number | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// First matching canonical type wins — never sum overlapping duplicates.
function pickCanonical(actions: MetaAction[] | undefined, types: string[]): number {
  if (!actions) return 0;
  for (const type of types) {
    const hit = actions.find((a) => a.action_type === type);
    if (hit) return toNumber(hit.value);
  }
  return 0;
}

function mapRow(raw: MetaInsightRawRow): MetaInsightRow {
  return {
    date: raw.date_start,
    campaign_id: raw.campaign_id ?? null,
    campaign_name: raw.campaign_name ?? null,
    adset_id: raw.adset_id ?? null,
    ad_id: raw.ad_id ?? null,
    creative_id: raw.creative_id ?? null,
    impressions: toNumber(raw.impressions),
    clicks: toNumber(raw.clicks),
    spend: toNumber(raw.spend),
    conversions: pickCanonical(raw.actions, PURCHASE_ACTION_TYPES) + pickCanonical(raw.actions, LEAD_ACTION_TYPES),
    revenue: pickCanonical(raw.action_values, PURCHASE_ACTION_TYPES),
  };
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// GET /{adAccountId}/insights, level=ad, time_increment=1 (one row per ad per
// day), paginated via `paging.next` until exhausted. Under MOCK_APIS=1, reads
// raw insight rows from the fixture and runs them through the same mapping —
// so the conversions/revenue derivation is exercised even in tests.
export async function fetchAdInsights(
  accessToken: string,
  adAccountId: string,
  days = 28
): Promise<MetaInsightRow[]> {
  if (mockApis()) {
    const raw = readFixture<MetaInsightRawRow[]>("meta/ad_insights.json");
    return raw.map(mapRow);
  }

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const fields = [
    "campaign_id",
    "campaign_name",
    "adset_id",
    "ad_id",
    "impressions",
    "clicks",
    "spend",
    "actions",
    "action_values",
  ].join(",");

  const params = new URLSearchParams({
    level: "ad",
    time_increment: "1",
    fields,
    time_range: JSON.stringify({ since: iso(start), until: iso(end) }),
    access_token: accessToken,
    limit: "500",
  });

  let url: string | null = `${GRAPH_BASE}/${adAccountId}/insights?${params.toString()}`;
  const rows: MetaInsightRow[] = [];

  while (url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Meta insights request failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as GraphInsightsResponse;
    for (const raw of body.data ?? []) rows.push(mapRow(raw));
    url = body.paging?.next ?? null;
  }

  return rows;
}
