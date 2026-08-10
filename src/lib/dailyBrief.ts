// lib/dailyBrief.ts — module/daily-brief.
//
// Reads what the daily collector already writes (metric_snapshots,
// ad_metrics_daily, changes, recommendations) and turns it into a per-client
// wins/losses/opportunities summary. No new collection happens here — this is
// a read-and-summarize layer on top of what /organic and /paid already show,
// so the numbers can never disagree with the dashboard.
import type { SupabaseClient } from "@supabase/supabase-js";

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const PAID_PLATFORMS = ["meta", "google_ads", "microsoft"] as const;
type PaidPlatform = (typeof PAID_PLATFORMS)[number];

interface MetricRow {
  platform: string;
  date: string; // YYYY-MM-DD
  spend: number | null;
  revenue: number | null;
}

// Anchored on the latest date actually present in the metrics, not `new
// Date()` — collectors run with a lag and "today" may have no rows yet.
// Duplicated in spirit from lib/paidRollup.ts (module/paid-dashboard, not yet
// on main) rather than imported, so this module doesn't depend on an
// unmerged branch.
function latestDate(rows: { date: string }[]): string | null {
  let max: string | null = null;
  for (const r of rows) if (r.date && (!max || r.date > max)) max = r.date;
  return max;
}

export interface ClientBriefInput {
  id: string;
  name: string;
  domain: string;
  slack_webhook_url?: string | null;
}

export interface SeoSection {
  organicTraffic: number | null;
  organicTrafficDelta: number | null;
  organicKeywords: number | null;
  organicKeywordsDelta: number | null;
  backlinks: number | null;
  backlinksDelta: number | null;
  visibility: number | null;
  visibilityDelta: number | null;
}

export interface AeoSection {
  aiVisibility: number | null;
  aiVisibilityDelta: number | null;
  aiMentions: number | null;
  aiMentionsDelta: number | null;
}

export interface PaidPlatformSection {
  platform: PaidPlatform;
  connected: boolean;
  sevenDaySpend: number;
  sevenDayRoas: number | null;
  trend: "up" | "down" | "flat" | null;
}

export interface Opportunity {
  title: string;
  severity: string;
  category: string;
}

export interface ClientBrief {
  clientId: string;
  name: string;
  domain: string;
  slackWebhookUrl: string | null;
  seo: SeoSection | null;
  aeo: AeoSection | null;
  paid: PaidPlatformSection[];
  wins: string[];
  losses: string[];
  opportunities: Opportunity[];
  openRecommendationCount: number;
}

function delta(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from == null || to == null) return null;
  return to - from;
}

// Trend needs a real move, not day-to-day API noise — 5% either side of the
// 7-day baseline reads as flat.
function trendFrom(dayRoas: number | null, sevenRoas: number | null): "up" | "down" | "flat" | null {
  if (dayRoas == null || sevenRoas == null) return null;
  if (dayRoas > sevenRoas * 1.05) return "up";
  if (dayRoas < sevenRoas * 0.95) return "down";
  return "flat";
}

function buildPaidSections(ads: MetricRow[]): PaidPlatformSection[] {
  const anchor = latestDate(ads);
  return PAID_PLATFORMS.map((platform) => {
    const rows = ads.filter((r) => r.platform === platform);
    if (!anchor || rows.length === 0) {
      return { platform, connected: false, sevenDaySpend: 0, sevenDayRoas: null, trend: null };
    }
    const sevenStart = new Date(anchor + "T00:00:00Z");
    sevenStart.setUTCDate(sevenStart.getUTCDate() - 6);
    const sevenStartStr = sevenStart.toISOString().slice(0, 10);

    let daySpend = 0, dayRev = 0, sevenSpend = 0, sevenRev = 0;
    for (const r of rows) {
      const spend = r.spend ?? 0;
      const revenue = r.revenue ?? 0;
      if (r.date === anchor) { daySpend += spend; dayRev += revenue; }
      if (r.date >= sevenStartStr && r.date <= anchor) { sevenSpend += spend; sevenRev += revenue; }
    }
    const dayRoas = daySpend > 0 ? dayRev / daySpend : null;
    const sevenRoas = sevenSpend > 0 ? sevenRev / sevenSpend : null;
    return {
      platform,
      connected: sevenSpend > 0,
      sevenDaySpend: sevenSpend,
      sevenDayRoas: sevenRoas,
      trend: trendFrom(dayRoas, sevenRoas),
    };
  });
}

export async function buildClientBrief(db: SupabaseClient, client: ClientBriefInput): Promise<ClientBrief> {
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000).toISOString().slice(0, 10);

  const [{ data: snaps }, { data: ads }, { data: changes }, { data: recs }] = await Promise.all([
    db.from("metric_snapshots").select("*").eq("client_id", client.id).order("captured_at", { ascending: false }).limit(2),
    db.from("ad_metrics_daily").select("platform, date, spend, revenue").eq("client_id", client.id).gte("date", eightDaysAgo),
    db.from("changes").select("title, verdict, measured_at").eq("client_id", client.id).gte("measured_at", twoDaysAgo),
    db.from("recommendations").select("title, severity, category").eq("client_id", client.id).eq("status", "open"),
  ]);

  const [latest, prior] = (snaps ?? []) as Record<string, any>[];

  const seo: SeoSection | null = latest ? {
    organicTraffic: latest.organic_traffic ?? null,
    organicTrafficDelta: delta(prior?.organic_traffic, latest.organic_traffic),
    organicKeywords: latest.organic_keywords ?? null,
    organicKeywordsDelta: delta(prior?.organic_keywords, latest.organic_keywords),
    backlinks: latest.backlinks ?? null,
    backlinksDelta: delta(prior?.backlinks, latest.backlinks),
    visibility: latest.visibility ?? null,
    visibilityDelta: delta(prior?.visibility, latest.visibility),
  } : null;

  // AI visibility only populates on days the SERP/AI cadence runs, so it can
  // be null on `latest` even when SEO fields are present — treated separately
  // rather than folded into `seo`.
  const aeo: AeoSection | null = latest && latest.ai_visibility != null ? {
    aiVisibility: latest.ai_visibility,
    aiVisibilityDelta: delta(prior?.ai_visibility, latest.ai_visibility),
    aiMentions: latest.ai_mentions ?? null,
    aiMentionsDelta: delta(prior?.ai_mentions, latest.ai_mentions),
  } : null;

  const paid = buildPaidSections((ads ?? []) as MetricRow[]);

  const wins: string[] = [];
  const losses: string[] = [];

  for (const ch of (changes ?? []) as { title: string; verdict: string | null }[]) {
    if (ch.verdict === "improved") wins.push(`${ch.title} — measured improvement`);
    if (ch.verdict === "declined") losses.push(`${ch.title} — measured decline`);
  }
  if (seo?.organicTrafficDelta != null && seo.organicTrafficDelta > 0) {
    wins.push(`Organic traffic up ${Math.round(seo.organicTrafficDelta)} vs prior check`);
  } else if (seo?.organicTrafficDelta != null && seo.organicTrafficDelta < 0) {
    losses.push(`Organic traffic down ${Math.abs(Math.round(seo.organicTrafficDelta))} vs prior check`);
  }
  if (aeo?.aiVisibilityDelta != null && aeo.aiVisibilityDelta > 0) {
    wins.push(`AI visibility up ${aeo.aiVisibilityDelta.toFixed(1)}pt`);
  } else if (aeo?.aiVisibilityDelta != null && aeo.aiVisibilityDelta < 0) {
    losses.push(`AI visibility down ${Math.abs(aeo.aiVisibilityDelta).toFixed(1)}pt`);
  }
  for (const p of paid) {
    if (!p.connected) continue;
    const roasLabel = p.sevenDayRoas != null ? `${p.sevenDayRoas.toFixed(2)}× 7d` : "no revenue yet";
    if (p.trend === "up") wins.push(`${p.platform}: ROAS trending up (${roasLabel})`);
    if (p.trend === "down") losses.push(`${p.platform}: ROAS trending down (${roasLabel})`);
  }

  const opportunities = ((recs ?? []) as Opportunity[])
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3));

  return {
    clientId: client.id,
    name: client.name,
    domain: client.domain,
    slackWebhookUrl: client.slack_webhook_url ?? null,
    seo,
    aeo,
    paid,
    wins,
    losses,
    opportunities: opportunities.slice(0, 5),
    openRecommendationCount: opportunities.length,
  };
}

function fmtNum(n: number | null): string {
  return n != null ? n.toLocaleString("en-US") : "–";
}

function fmtDelta(n: number | null): string {
  if (n == null) return "n/a";
  const rounded = Math.round(n);
  return rounded === 0 ? "flat" : rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function fmtPct(n: number | null): string {
  return n != null ? `${n}%` : "–";
}

export function formatBriefEmail(briefs: ClientBrief[], dateLabel: string): { subject: string; text: string } {
  const lines: string[] = [`Growth OS daily brief — ${dateLabel}`, ""];

  for (const b of briefs) {
    lines.push(`── ${b.name} (${b.domain}) ──`);
    lines.push(
      b.seo
        ? `SEO: traffic ${fmtNum(b.seo.organicTraffic)} (${fmtDelta(b.seo.organicTrafficDelta)}) · ` +
          `keywords ${fmtNum(b.seo.organicKeywords)} (${fmtDelta(b.seo.organicKeywordsDelta)}) · ` +
          `backlinks ${fmtNum(b.seo.backlinks)} (${fmtDelta(b.seo.backlinksDelta)}) · ` +
          `visibility ${fmtPct(b.seo.visibility)}`
        : "SEO: no data yet"
    );
    if (b.aeo) {
      lines.push(
        `AEO: AI visibility ${fmtPct(b.aeo.aiVisibility)} (${fmtDelta(b.aeo.aiVisibilityDelta)}) · ` +
        `mentions ${fmtNum(b.aeo.aiMentions)}`
      );
    }
    const connectedPaid = b.paid.filter((p) => p.connected);
    lines.push(
      connectedPaid.length
        ? "Paid: " + connectedPaid.map((p) =>
            `${p.platform} ${p.sevenDayRoas != null ? p.sevenDayRoas.toFixed(2) + "×" : "–"} (${p.trend ?? "n/a"})`
          ).join(" · ")
        : "Paid: no connected platform"
    );
    lines.push(`Wins: ${b.wins.length ? b.wins.join("; ") : "none today"}`);
    lines.push(`Losses: ${b.losses.length ? b.losses.join("; ") : "none today"}`);
    lines.push(
      `Opportunities: ${b.openRecommendationCount} open` +
      (b.opportunities.length ? " — " + b.opportunities.map((o) => o.title).join("; ") : "")
    );
    lines.push(`/dashboard/${b.clientId}`, "");
  }

  return { subject: `Growth OS daily brief — ${dateLabel}`, text: lines.join("\n") };
}

export function formatBriefSlack(b: ClientBrief): string {
  const wins = b.wins.length ? b.wins.map((w) => `• ${w}`).join("\n") : "• none today";
  const losses = b.losses.length ? b.losses.map((w) => `• ${w}`).join("\n") : "• none today";
  const opportunities = b.opportunities.length
    ? b.opportunities.map((o) => `• ${o.title}`).join("\n")
    : "• none open";

  return [
    `*${b.name} — daily brief*`,
    `:white_check_mark: *Wins*\n${wins}`,
    `:warning: *Losses*\n${losses}`,
    `:bulb: *Opportunities* (${b.openRecommendationCount} open)\n${opportunities}`,
  ].join("\n\n");
}
