// lib/contentPlanner.ts — build a month of content in one action.
//
// WO-004. Produces a dated plan: N slots across the client's connected networks,
// each with a platform, format, theme and brief, spread using the playbook's
// format mix and timing.
//
// ── Where the ideas come from, in priority order ─────────────────────────────
//   1. THIS client's proven posts. A format that beat their own median is the
//      strongest evidence available and it outranks everything else.
//   2. The questions their customers actually ask (tracked_prompts). These were
//      written as customer-voice questions for AI visibility, and a question a
//      buyer asks is a post worth writing whether or not anyone has posted before.
//   3. What they actually sell, read live from their store.
//   4. Evergreen angles for the client type. Used only to FILL, and labelled as
//      such, so nobody mistakes a filler slot for an evidence-backed one.
//
// The order matters more than the contents. A planner that treats a generic
// "customer story" idea as equal to a post that did 3x median is producing a
// content calendar with a data-shaped veneer.
//
// A brand with NO social history is the normal case, not the edge case: it is
// exactly when someone reaches for a planner. Levels 2 and 3 exist so that case
// produces something specific to the business rather than a page of filler.
import type { SupabaseClient } from "@supabase/supabase-js";
import { playbookFor, formatSequence, defaultCadence, type Format } from "@/lib/platformPlaybook";
import { readSecret } from "@/lib/vault";
import { connect as shopifyConnect, listContent as shopifyList } from "@/lib/shopifyAdapter";

export type PlanItem = {
  slot: number;
  scheduledFor: string;   // yyyy-mm-dd
  platform: string;
  format: Format;
  theme: string;
  brief: string;
  why: string;
  sourcePostId: number | null;
};

export type Plan = {
  month: string;          // yyyy-mm-01
  targetPosts: number;
  rationale: string;
  items: PlanItem[];
};

type ProvenPost = {
  id: number; title: string | null; content: string | null;
  postType: string | null; score: number; multiple: number;
};

/** Evergreen angles by client type. Filler, and labelled as filler. */
const EVERGREEN: Record<string, string[]> = {
  local_service: [
    "A job from this month, before and after",
    "What we check that most people do not know to ask about",
    "The cost of leaving it, as one number",
    "A customer in their own words",
    "The team member who did the work",
    "A seasonal reminder tied to this month",
    "One myth about this trade, corrected",
  ],
  national_ecom: [
    "The product in the situation it was made for",
    "A customer photo or review, credited",
    "What goes into making it, in one step",
    "A comparison against the obvious alternative",
    "Answer the question the support inbox gets most",
    "A use nobody expects",
    "Behind the shipment or the workshop",
  ],
  hybrid: [
    "The problem, then the fix",
    "A customer in their own words",
    "One thing people get wrong about this",
    "Behind the scenes of a normal week",
    "A seasonal angle tied to this month",
  ],
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Deal slots across the month onto the network's better days.
 *
 * Even spacing rather than clustering: five posts on a Tuesday and nothing for
 * ten days performs worse than five spread out, on every network in the playbook.
 */
function scheduleDates(month: Date, slots: number, bestDays: number[]): string[] {
  const year = month.getUTCFullYear();
  const mon = month.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, mon + 1, 0)).getUTCDate();

  const candidates: Date[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(Date.UTC(year, mon, day));
    if (bestDays.includes(d.getUTCDay())) candidates.push(d);
  }

  // Fewer good days than slots: fall back to every weekday rather than
  // double-booking, since two posts a day reads as a backlog being dumped.
  if (candidates.length < slots) {
    candidates.length = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(Date.UTC(year, mon, day));
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) candidates.push(d);
    }
  }

  const step = Math.max(1, Math.floor(candidates.length / Math.max(slots, 1)));
  const out: string[] = [];
  for (let i = 0; i < slots; i++) {
    const pick = candidates[Math.min(i * step, candidates.length - 1)];
    out.push(ymd(pick ?? new Date(Date.UTC(year, mon, Math.min(i + 1, daysInMonth)))));
  }
  return out;
}

function shortLabel(p: ProvenPost): string {
  const raw = (p.title || p.content || "").replace(/\s+/g, " ").trim();
  return raw.length > 70 ? `${raw.slice(0, 67)}…` : raw || "a previous post";
}

export async function buildPlan(
  db: SupabaseClient,
  clientId: string,
  monthStart: Date
): Promise<Plan> {
  const { data: client } = await db
    .from("clients")
    .select("id, name, client_type, social_posts_per_month, postflow_group_id")
    .eq("id", clientId).single();

  if (!client) throw new Error("client not found");

  // Which networks this client actually publishes to, taken from what has been
  // collected rather than assumed. Planning for TikTok when they have never
  // posted there is a plan nobody can execute.
  const { data: posted } = await db
    .from("social_posts").select("platform").eq("client_id", clientId).not("platform", "is", null);

  const networks = Array.from(
    new Set((posted ?? []).map((p: { platform: string | null }) => p.platform).filter(Boolean) as string[])
  );
  const usable = networks.length ? networks : ["instagram"];

  const target = client.social_posts_per_month ?? defaultCadence(usable);

  // Proven posts, scored the same way the series proposer scores them so the two
  // never disagree about what "worked" means for this client.
  const { data: postRows } = await db
    .from("social_posts")
    .select("id, title, content, post_type, platform")
    .eq("client_id", clientId).order("posted_at", { ascending: false }).limit(60);

  const ids = (postRows ?? []).map((p: { id: number }) => p.id);
  const { data: metricRows } = ids.length
    ? await db.from("social_metrics_daily")
        .select("post_id, engagements, saves, shares, link_clicks")
        .in("post_id", ids).order("date", { ascending: false })
    : { data: [] };

  const latest = new Map<number, { engagements: number; saves: number; shares: number; clicks: number }>();
  for (const m of (metricRows ?? []) as Record<string, number>[]) {
    if (!latest.has(m.post_id)) {
      latest.set(m.post_id, {
        engagements: m.engagements ?? 0, saves: m.saves ?? 0,
        shares: m.shares ?? 0, clicks: m.link_clicks ?? 0,
      });
    }
  }

  const scored: ProvenPost[] = (postRows ?? []).map((p: Record<string, unknown>) => {
    const m = latest.get(p.id as number);
    const score = (m?.engagements ?? 0) + (m?.saves ?? 0) * 4 + (m?.shares ?? 0) * 3 + (m?.clicks ?? 0) * 5;
    return {
      id: p.id as number, title: (p.title as string) ?? null, content: (p.content as string) ?? null,
      postType: (p.post_type as string) ?? null, score, multiple: 0,
    };
  });

  const nonZero = scored.map((s) => s.score).filter((s) => s > 0).sort((a, b) => a - b);
  const median = nonZero.length
    ? nonZero.length % 2
      ? nonZero[(nonZero.length - 1) / 2]
      : (nonZero[nonZero.length / 2 - 1] + nonZero[nonZero.length / 2]) / 2
    : 0;

  const proven = median > 0
    ? scored.map((s) => ({ ...s, multiple: s.score / median }))
        .filter((s) => s.multiple >= 1.5)
        .sort((a, b) => b.multiple - a.multiple)
    : [];

  // ── customer questions ─────────────────────────────────────────────────────
  // Written for AEO, useful here for the same reason: they are the things buyers
  // ask in their own words, which is the shortest route to a post that lands.
  const { data: promptRows } = await db
    .from("tracked_prompts").select("prompt").eq("client_id", clientId).eq("active", true).limit(30);
  const questions = (promptRows ?? [])
    .map((p: { prompt: string }) => p.prompt?.trim())
    .filter(Boolean) as string[];

  // ── what they sell ─────────────────────────────────────────────────────────
  // Read live rather than from a table because we do not store a catalogue, and
  // a failure here must degrade to the other sources rather than kill the plan.
  let products: string[] = [];
  try {
    const { data: store } = await db
      .from("client_stores").select("platform, domain, api_client_id, auth_ref")
      .eq("client_id", clientId).eq("status", "active").maybeSingle();

    if (store?.platform === "shopify" && store.auth_ref && store.api_client_id) {
      const secret = await readSecret(db, store.auth_ref);
      if (secret) {
        const token = await shopifyConnect(store.domain, store.api_client_id, secret);
        const content = await shopifyList(store.domain, token, 30);
        products = content.map((c) => c.title).filter(Boolean).slice(0, 20);
      }
    }
  } catch {
    // Catalogue is a bonus source. Losing it is not a reason to fail the plan.
  }

  // ── deal the slots ─────────────────────────────────────────────────────────
  const perNetwork = Math.max(1, Math.floor(target / usable.length));
  const items: PlanItem[] = [];
  let slot = 0;
  let provenCursor = 0;
  let evergreenCursor = 0;
  let questionCursor = 0;
  let productCursor = 0;

  const evergreen = EVERGREEN[(client.client_type as string) ?? "hybrid"] ?? EVERGREEN.hybrid;

  for (const network of usable) {
    const book = playbookFor(network);
    const count = network === usable[usable.length - 1]
      ? target - items.length          // last network absorbs the remainder
      : perNetwork;
    if (count <= 0) continue;

    const formats = formatSequence(network, count);
    const dates = scheduleDates(monthStart, count, book?.bestDays ?? [2, 3, 4]);

    for (let i = 0; i < count; i++) {
      slot++;
      const p = proven[provenCursor];

      // Roughly every other slot repeats something proven, while any remains.
      // All-proven would be a month of one idea; none would ignore the evidence.
      const useProven = p && i % 2 === 0;

      // Then the client-specific sources, before falling back to generic angles.
      const question = !useProven ? questions[questionCursor] : undefined;
      const product = !useProven && !question ? products[productCursor] : undefined;

      if (useProven) {
        provenCursor++;
        items.push({
          slot,
          scheduledFor: dates[i],
          platform: network,
          format: formats[i],
          theme: "Repeat what worked",
          brief: `Rework "${shortLabel(p)}" as a ${formats[i]} for ${book?.label ?? network}.`,
          why: `That post did ${p.multiple.toFixed(1)}× this account's median. The subject works; the format is being varied to reach a different part of the audience.`,
          sourcePostId: p.id,
        });
      } else if (question) {
        questionCursor++;
        items.push({
          slot,
          scheduledFor: dates[i],
          platform: network,
          format: formats[i],
          theme: "Answer a customer question",
          brief: `Answer "${question}" as a ${formats[i]} for ${book?.label ?? network}.`,
          why: `This is a question this client's buyers actually ask — it is one of the prompts tracked for AI visibility. Answering it publicly serves the same search intent on a second surface.`,
          sourcePostId: null,
        });
      } else if (product) {
        productCursor++;
        items.push({
          slot,
          scheduledFor: dates[i],
          platform: network,
          format: formats[i],
          theme: "Show the product working",
          brief: `Feature "${product}" in the situation it was made for. As a ${formats[i]} for ${book?.label ?? network}.`,
          why: `Drawn from the live catalogue, so the post is about something they actually sell rather than a generic angle.`,
          sourcePostId: null,
        });
      } else {
        const angle = evergreen[evergreenCursor % evergreen.length];
        evergreenCursor++;
        items.push({
          slot,
          scheduledFor: dates[i],
          platform: network,
          format: formats[i],
          theme: "Evergreen angle",
          brief: `${angle}. As a ${formats[i]} for ${book?.label ?? network}.`,
          // Labelled honestly. A filler slot dressed up as a finding is how a
          // content calendar gets mistaken for a strategy.
          why: `Fills the cadence and keeps the format mix balanced. Not drawn from this account's performance data — worth a human steer on the specifics.`,
          sourcePostId: null,
        });
      }
    }
  }

  const counts = {
    proven: items.filter((i) => i.theme === "Repeat what worked").length,
    question: items.filter((i) => i.theme === "Answer a customer question").length,
    product: items.filter((i) => i.theme === "Show the product working").length,
    evergreen: items.filter((i) => i.theme === "Evergreen angle").length,
  };

  // Say where the month came from, source by source. A plan that reports only a
  // total invites the reader to assume it is all evidence-backed.
  const parts: string[] = [];
  if (counts.proven) parts.push(`${counts.proven} rework a post that beat this account's median`);
  if (counts.question) parts.push(`${counts.question} answer questions this client's buyers actually ask`);
  if (counts.product) parts.push(`${counts.product} feature something from the live catalogue`);
  if (counts.evergreen) parts.push(`${counts.evergreen} are evergreen angles filling the cadence`);

  const rationale = [
    `${items.length} posts across ${usable.length} network${usable.length === 1 ? "" : "s"}.`,
    parts.length ? `${parts.join("; ")}.` : "",
    counts.proven === 0
      ? `Nothing in this account's own posting history was strong enough to build on, so the plan is drawn from what their customers ask and what they sell rather than from social performance.`
      : "",
    client.social_posts_per_month
      ? `Target of ${target} comes from this client's stated cadence.`
      : `No cadence is set for this client, so the target is the playbook minimum for their networks. Set one in Settings to plan against the real commitment.`,
  ].join(" ");

  return { month: ymd(monthStart).slice(0, 8) + "01", targetPosts: target, rationale, items };
}
