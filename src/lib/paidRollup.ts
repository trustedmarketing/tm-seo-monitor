// lib/paidRollup.ts — WO-006 stream B: campaign-level ROAS rollups for the
// /paid dashboard. Pure in-memory aggregation over already-fetched
// `campaigns` + `ad_metrics_daily` rows, matching the existing /paid page's
// pattern (plain JS loops, no new SQL aggregation layer) — campaign counts
// per client are small enough that this doesn't need a materialized view.
//
// The anchor date is the LATEST date present in the metrics rows, not
// `new Date()` — collectors run with a lag and "today" may have no rows yet.
// Anchoring on the data itself, rather than an assumed real-time clock,
// matches this repo's accuracy-gate habit of verifying rather than assuming
// (see the GA4 property-id incident in STATUS.md).

export interface CampaignRollupInput {
  id: string;
  platform: string;
  campaign_id: string;
  campaign_name: string | null;
  status: "active" | "paused" | "removed";
  daily_budget: number | null;
}

export interface MetricRow {
  campaign_id: string | null;
  platform: string;
  date: string; // YYYY-MM-DD
  spend: number | null;
  revenue: number | null;
}

export interface CampaignRollup {
  id: string;
  platform: string;
  campaignId: string;
  campaignName: string | null;
  status: "active" | "paused" | "removed";
  dailyBudget: number | null;
  dayPriorRoas: number | null;
  dayPriorSpend: number;
  sevenDayRoas: number | null;
  sevenDaySpend: number;
  thirtyDayRoas: number | null;
  thirtyDaySpend: number;
  thirtyDayRevenue: number;
}

// ROAS ≠ revenue/spend when spend is 0 — that's "no spend," not a 0× or
// infinite return, so callers get `null` and render a dash rather than a
// misleading number.
function roas(spend: number, revenue: number): number | null {
  return spend > 0 ? revenue / spend : null;
}

export function latestDate(rows: { date: string }[]): string | null {
  let max: string | null = null;
  for (const r of rows) if (r.date && (!max || r.date > max)) max = r.date;
  return max;
}

function daysBefore(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function emptyRollup(c: CampaignRollupInput): CampaignRollup {
  return {
    id: c.id,
    platform: c.platform,
    campaignId: c.campaign_id,
    campaignName: c.campaign_name,
    status: c.status,
    dailyBudget: c.daily_budget,
    dayPriorRoas: null,
    dayPriorSpend: 0,
    sevenDayRoas: null,
    sevenDaySpend: 0,
    thirtyDayRoas: null,
    thirtyDaySpend: 0,
    thirtyDayRevenue: 0,
  };
}

// Builds one rollup per campaign: day-prior, 7-day, and 30-day trailing ROAS
// (all windows end on `asOf`, or the latest date in `metrics` if omitted).
export function buildCampaignRollups(
  campaigns: CampaignRollupInput[],
  metrics: MetricRow[],
  asOf?: string | null
): CampaignRollup[] {
  const anchor = asOf ?? latestDate(metrics);

  return campaigns.map((c) => {
    if (!anchor) return emptyRollup(c);

    const sevenStart = daysBefore(anchor, 6);
    const thirtyStart = daysBefore(anchor, 29);

    let dayPriorSpend = 0, dayPriorRev = 0;
    let sevenSpend = 0, sevenRev = 0;
    let thirtySpend = 0, thirtyRev = 0;

    for (const m of metrics) {
      if (m.platform !== c.platform || m.campaign_id !== c.campaign_id) continue;
      const spend = m.spend ?? 0;
      const revenue = m.revenue ?? 0;
      if (m.date === anchor) {
        dayPriorSpend += spend;
        dayPriorRev += revenue;
      }
      if (m.date >= sevenStart && m.date <= anchor) {
        sevenSpend += spend;
        sevenRev += revenue;
      }
      if (m.date >= thirtyStart && m.date <= anchor) {
        thirtySpend += spend;
        thirtyRev += revenue;
      }
    }

    return {
      id: c.id,
      platform: c.platform,
      campaignId: c.campaign_id,
      campaignName: c.campaign_name,
      status: c.status,
      dailyBudget: c.daily_budget,
      dayPriorRoas: roas(dayPriorSpend, dayPriorRev),
      dayPriorSpend,
      sevenDayRoas: roas(sevenSpend, sevenRev),
      sevenDaySpend: sevenSpend,
      thirtyDayRoas: roas(thirtySpend, thirtyRev),
      thirtyDaySpend: thirtySpend,
      thirtyDayRevenue: thirtyRev,
    };
  });
}

// Reference-line ROAS benchmarks by platform (docs/tm-growth-os-plan.md
// Module C) — display context only, not a threshold the UI enforces.
export const ROAS_BENCHMARKS: Record<string, { low: number; high: number; label: string }> = {
  google_ads: { low: 3.5, high: 4.5, label: "Search ~3.5–4.5×" },
  meta: { low: 2, high: 3, label: "Meta prospecting ~2–3×" },
  microsoft: { low: 3.5, high: 4.5, label: "Bing search ~3.5–4.5×" },
};
