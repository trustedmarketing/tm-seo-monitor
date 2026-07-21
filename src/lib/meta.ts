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

// Action types counted toward conversions/revenue. Meta reports purchase and
// lead completions under several action_type strings depending on on/off-site
// and pixel vs. Conversions API attribution — matching by substring catches
// the family (purchase, omni_purchase, offsite_conversion.fb_pixel_purchase,
// lead, onsite_conversion.lead_grouped, ...) without an exhaustive allowlist.
function isConversionAction(actionType: string): boolean {
  return actionType.includes("purchase") || actionType.includes("lead");
}

function toNumber(v: string | number | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function sumConversionActions(actions: MetaAction[] | undefined): number {
  if (!actions) return 0;
  return actions
    .filter((a) => isConversionAction(a.action_type))
    .reduce((sum, a) => sum + toNumber(a.value), 0);
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
    conversions: sumConversionActions(raw.actions),
    revenue: sumConversionActions(raw.action_values),
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
