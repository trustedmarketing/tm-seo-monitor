// lib/creativeRollup.ts — ad/creative-level performance rollups for
// /paid/creative. Same pattern as lib/paidRollup.ts's buildCampaignRollups()
// (pure in-memory aggregation, anchored on the latest date present in the
// metrics rather than the wall clock), grouped by (platform, ad_id)
// instead of campaign_id.
//
// Grouped by ad_id, not creative_id — Meta's Ads Insights API has no flat
// `creative_id` field to request (verified via web search: creative data
// there is exposed only through breakdowns like image_asset/video_asset,
// not as a plain identifier field on the ad-level insights row). `ad_id` is
// what's actually populated for every platform today — it's the very field
// each collector's upsert key relies on (client_id, platform, date, ad_id),
// so it's guaranteed non-null. In the common case one ad runs one creative,
// so this answers "how is this creative doing" close enough to be useful;
// it isn't exact for Dynamic Creative ads that test several creative
// variants inside one ad — resolving that needs a second call to each
// platform's ad-creative endpoint, a real future enhancement, not something
// to fake here.
export interface AdMetricRow {
  ad_id: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  platform: string;
  date: string; // YYYY-MM-DD
  spend: number | null;
  revenue: number | null;
  impressions: number | null;
  clicks: number | null;
}

export interface AdRollup {
  id: string; // `${platform}:${adId}`
  platform: string;
  adId: string;
  /** An ad can run under more than one campaign over its lifetime; every name it's been seen under. */
  campaignNames: string[];
  dayPriorSpend: number;
  dayPriorRoas: number | null;
  dayPriorCtr: number | null;
  sevenDaySpend: number;
  sevenDayRoas: number | null;
  sevenDayCtr: number | null;
  thirtyDaySpend: number;
  thirtyDayRevenue: number;
  thirtyDayRoas: number | null;
  thirtyDayImpressions: number;
  thirtyDayClicks: number;
  thirtyDayCtr: number | null;
}

function roas(spend: number, revenue: number): number | null {
  return spend > 0 ? revenue / spend : null;
}

// CTR as a percentage (e.g. 2.35 for 2.35%), matching how ad platforms display it.
function ctr(clicks: number, impressions: number): number | null {
  return impressions > 0 ? (clicks / impressions) * 100 : null;
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

export function buildAdRollups(metrics: AdMetricRow[], asOf?: string | null): AdRollup[] {
  const withAd = metrics.filter((m) => m.ad_id);
  const anchor = asOf ?? latestDate(withAd);
  if (!anchor) return [];

  const sevenStart = daysBefore(anchor, 6);
  const thirtyStart = daysBefore(anchor, 29);

  const groups = new Map<string, AdMetricRow[]>();
  for (const m of withAd) {
    const key = `${m.platform}:${m.ad_id}`;
    const g = groups.get(key) ?? [];
    g.push(m);
    groups.set(key, g);
  }

  const rollups: AdRollup[] = [];
  for (const [key, rows] of groups) {
    const [platform, adId] = [rows[0].platform, rows[0].ad_id as string];

    let dayPriorSpend = 0, dayPriorRev = 0, dayPriorImp = 0, dayPriorClk = 0;
    let sevenSpend = 0, sevenRev = 0, sevenImp = 0, sevenClk = 0;
    let thirtySpend = 0, thirtyRev = 0, thirtyImp = 0, thirtyClk = 0;
    const campaignNames = new Set<string>();

    for (const r of rows) {
      const spend = r.spend ?? 0;
      const revenue = r.revenue ?? 0;
      const impressions = r.impressions ?? 0;
      const clicks = r.clicks ?? 0;
      if (r.campaign_name) campaignNames.add(r.campaign_name);

      if (r.date === anchor) {
        dayPriorSpend += spend; dayPriorRev += revenue; dayPriorImp += impressions; dayPriorClk += clicks;
      }
      if (r.date >= sevenStart && r.date <= anchor) {
        sevenSpend += spend; sevenRev += revenue; sevenImp += impressions; sevenClk += clicks;
      }
      if (r.date >= thirtyStart && r.date <= anchor) {
        thirtySpend += spend; thirtyRev += revenue; thirtyImp += impressions; thirtyClk += clicks;
      }
    }

    rollups.push({
      id: key,
      platform,
      adId,
      campaignNames: [...campaignNames],
      dayPriorSpend,
      dayPriorRoas: roas(dayPriorSpend, dayPriorRev),
      dayPriorCtr: ctr(dayPriorClk, dayPriorImp),
      sevenDaySpend: sevenSpend,
      sevenDayRoas: roas(sevenSpend, sevenRev),
      sevenDayCtr: ctr(sevenClk, sevenImp),
      thirtyDaySpend: thirtySpend,
      thirtyDayRevenue: thirtyRev,
      thirtyDayRoas: roas(thirtySpend, thirtyRev),
      thirtyDayImpressions: thirtyImp,
      thirtyDayClicks: thirtyClk,
      thirtyDayCtr: ctr(thirtyClk, thirtyImp),
    });
  }

  return rollups;
}
