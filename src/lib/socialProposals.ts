// lib/socialProposals.ts — find what worked, propose more of it.
//
// WO-003 / Module E. The design's Social recommendation: "Turn the rooftop-unit
// before/after into a four-week series — that one post did 3.1x your median
// engagement and sent 6 people to the call button. The format works; once is not
// a strategy."
//
// ── Why outperformers rather than a content calendar ─────────────────────────
// The plan's §6 playbook is explicit: recurring series beat one-offs, and
// engagement VELOCITY is what platforms distribute on. So the only proposal
// worth making automatically is "this specific thing worked for THIS account,
// do it again" — which is a claim the data supports.
//
// Generating a content calendar from nothing would be inventing a strategy and
// attributing it to evidence. That is a human's job, or at minimum a job for a
// model with a brief, not a rules engine with a median.

export type SocialPost = {
  id: number;
  title: string | null;
  content: string | null;
  postType: string | null;
  permalink: string | null;
  postedAt: string | null;
  engagements: number;
  saves: number;
  shares: number;
  linkClicks: number;
  reach: number;
};

export type SocialProposal = {
  ruleKey: string;
  sourcePostId: number;
  title: string;
  why: string;
  severity: "High" | "Medium" | "Low";
  multiple: number;
  /** The series the agent would draft, one line per instalment. */
  outline: string[];
};

/** How far above median a post has to be before "do it again" is evidence. */
const OUTPERFORM_X = 1.8;
/** Below this, a "multiple" is noise from a tiny denominator. */
const MIN_ENGAGEMENTS = 25;
/** Fewer posts than this and there is no median worth comparing against. */
const MIN_POSTS = 6;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Intent-weighted score.
 *
 * Saves and shares count far more than likes because they are the behaviours
 * that precede buying — the plan's "distance to revenue" rule applied to a
 * single post. A post with 400 likes and no saves is popular, not effective.
 */
function score(p: SocialPost): number {
  return p.engagements + p.saves * 4 + p.shares * 3 + p.linkClicks * 5;
}

function shortLabel(p: SocialPost): string {
  const raw = (p.title || p.content || "").replace(/\s+/g, " ").trim();
  if (!raw) return "that post";
  return raw.length > 60 ? `${raw.slice(0, 57)}…` : raw;
}

/**
 * A four-week series built from what actually worked.
 *
 * The outline is deliberately structural rather than written: "what the
 * technician actually checks" is a brief, not a caption. Writing the words is
 * the drafting step, and pretending a rules engine wrote copy would put
 * unreviewed text in front of a client.
 */
function outlineFor(p: SocialPost): string[] {
  const subject = shortLabel(p);
  const type = (p.postType ?? "post").toLowerCase();
  return [
    `Week 1 — repeat the format that worked: ${subject}`,
    type.includes("video") || type.includes("short")
      ? "Week 2 — the same subject as a carousel, for saves rather than reach"
      : "Week 2 — the same subject as a short video, for reach rather than saves",
    "Week 3 — the cost of not doing it, as one number",
    "Week 4 — a customer story using the same format",
  ];
}

export function proposeSeries(posts: SocialPost[]): SocialProposal[] {
  // Not enough history to have a median worth comparing against. Proposing off
  // three posts would be dressing up a coin flip as evidence.
  if (posts.length < MIN_POSTS) return [];

  const scores = posts.map(score);
  const med = median(scores.filter((s) => s > 0));
  if (med <= 0) return [];

  const out: SocialProposal[] = [];

  for (const p of posts) {
    const s = score(p);
    if (p.engagements < MIN_ENGAGEMENTS) continue;      // denominator too small to trust
    const multiple = s / med;
    if (multiple < OUTPERFORM_X) continue;

    const clickNote = p.linkClicks > 0
      ? ` and sent ${p.linkClicks} ${p.linkClicks === 1 ? "person" : "people"} to your link`
      : "";

    out.push({
      ruleKey: "proven_post_worth_a_series",
      sourcePostId: p.id,
      title: `Turn "${shortLabel(p)}" into a four-week series`,
      why:
        `This post did ${multiple.toFixed(1)}× your median engagement${clickNote}. ` +
        `The format works for this account — once is not a strategy.`,
      // High only when it is genuinely exceptional; everything is "medium"
      // otherwise, because a queue where everything is urgent has no signal.
      severity: multiple >= 3 ? "High" : "Medium",
      multiple: Math.round(multiple * 10) / 10,
      outline: outlineFor(p),
    });
  }

  // Best first, and cap it: four "do more of this" cards in one morning is not
  // four times as useful as one.
  return out.sort((a, b) => b.multiple - a.multiple).slice(0, 2);
}
