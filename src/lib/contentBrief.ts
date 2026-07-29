// lib/contentBrief.ts — turn an accepted recommendation into something writable.
//
// WO-005. "Add to pipeline" used to produce a queued row and nothing else. The
// hard part — what do we actually say — was handed straight back to a person.
//
// ── What makes this different from asking a chatbot for an outline ───────────
// The model is given the client's REAL query cluster from Search Console: every
// search this page already appears for, with its position and impressions. So
// the brief is grounded in demand this specific site is already being shown for,
// not in what an LLM assumes people search.
//
// ── The honesty rule, same as everywhere else ────────────────────────────────
// The model is told what it does NOT know: it has not read the live page, it has
// no conversion data, and it must not invent product claims. Anything it is
// unsure of belongs in `openQuestions` for a human, not asserted in the outline.
// A brief that confidently states a wrong fact about a client's product is worse
// than no brief, because it gets published.

import type { SupabaseClient } from "@supabase/supabase-js";
import { generate } from "@/lib/ai";

export type BriefSection = {
  heading: string;
  /** What this section has to cover, in a sentence or two. */
  covers: string;
  /** Queries this section is meant to answer. Drawn from the real cluster. */
  answers: string[];
};

export type ContentBrief = {
  /** Under 60 characters — the constraint is enforced in the prompt AND checked. */
  metaTitle: string;
  metaDescription: string;
  h1: string;
  /** Who this is for and what they are trying to do. */
  audience: string;
  /** The single job of the page, in one sentence. */
  goal: string;
  sections: BriefSection[];
  /** Queries the page should cover, from the client's own Search Console data. */
  targetQueries: string[];
  wordCount: number;
  /** For a rework: what the current page is likely missing. */
  gaps: string[];
  /** Things the writer must check with the client. Never guessed at. */
  openQuestions: string[];
};

const SCHEMA = {
  type: "object",
  required: ["metaTitle", "metaDescription", "h1", "audience", "goal",
             "sections", "targetQueries", "wordCount", "gaps", "openQuestions"],
  additionalProperties: false,
  properties: {
    metaTitle: { type: "string", maxLength: 60 },
    metaDescription: { type: "string", maxLength: 160 },
    h1: { type: "string" },
    audience: { type: "string" },
    goal: { type: "string" },
    // NO minItems. The structured-output validator rejects any value above 1:
    //   "For 'array' type, 'minItems' values other than 0 or 1 are not supported"
    // It is a 400 at request time, so the whole call fails rather than degrading.
    // The floor is enforced after the fact instead — see checkShape below.
    sections: {
      type: "array", maxItems: 9,
      items: {
        type: "object",
        required: ["heading", "covers", "answers"],
        additionalProperties: false,
        properties: {
          heading: { type: "string" },
          covers: { type: "string" },
          answers: { type: "array", items: { type: "string" } },
        },
      },
    },
    targetQueries: { type: "array", items: { type: "string" } },
    wordCount: { type: "integer", minimum: 300, maximum: 4000 },
    gaps: { type: "array", items: { type: "string" } },
    openQuestions: { type: "array", items: { type: "string" } },
  },
} as const;

export type ClusterQuery = { query: string; position: number; impressions: number; clicks: number };

/**
 * Queries related to a target, from the client's own data.
 *
 * Matched on shared significant words rather than an embedding: it is
 * inspectable, it costs nothing, and at this scale it is accurate enough. The
 * point is to ground the brief in real demand, not to cluster perfectly.
 */
export function clusterFor(
  target: string,
  rows: { query: string; page: string | null; position: number; impressions: number; clicks: number }[],
  page: string | null,
  limit = 25
): ClusterQuery[] {
  const stop = new Set(["the", "a", "an", "for", "and", "or", "of", "in", "on", "to", "vs", "my", "is"]);
  const words = (q: string) => new Set(q.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !stop.has(w)));
  const targetWords = words(target);

  const scored = rows
    .filter((r) => r.page === null)
    .map((r) => {
      const w = words(r.query);
      const shared = [...w].filter((x) => targetWords.has(x)).length;
      // A query already ranking on the page we are reworking belongs in the
      // cluster whether or not it shares wording — it is the same page's job.
      const samePage = page ? rows.some((p) => p.page === page && p.query === r.query) : false;
      return { r, shared, samePage };
    })
    .filter((x) => x.shared > 0 || x.samePage)
    .sort((a, b) => (b.shared - a.shared) || (b.r.impressions - a.r.impressions))
    .slice(0, limit);

  return scored.map(({ r }) => ({
    query: r.query,
    position: Math.round(r.position * 10) / 10,
    impressions: r.impressions,
    clicks: r.clicks,
  }));
}

const SYSTEM = `You write content briefs for an SEO agency. A brief is what a writer works from: it says what the page must cover and why, not the prose itself.

Rules, in order of importance:

1. You have NOT read the client's live page. You are working from Search Console query data only. Never state what the current page says. If knowing would change the brief, put it in openQuestions.
2. Never invent a product claim, a specification, a price, a guarantee or a statistic about the client. If the brief needs one, it goes in openQuestions for a human to supply.
3. Ground every section in the supplied queries. Those are real searches this site already appears for. Do not add sections for topics with no query behind them.
4. metaTitle must be under 60 characters and metaDescription under 160. These are hard limits, not targets.
5. Write plainly. No marketing throat-clearing, no "in today's world", no em-dashes.
6. wordCount should match the intent: a comparison or how-to needs depth, a product or service page usually does not.

Return only the structured brief.`;

/**
 * Generate a brief for one content item.
 *
 * Metered through lib/ai.ts, so it refuses before spending once the monthly
 * ceiling is reached rather than reporting the overspend afterwards.
 */
export async function draftBrief(
  db: SupabaseClient,
  {
    clientId, clientName, title, targetQuery, action, page, rationale, cluster,
  }: {
    clientId: string;
    clientName: string;
    title: string;
    targetQuery: string | null;
    action: "new_article" | "improve_page";
    page: string | null;
    rationale: string | null;
    cluster: ClusterQuery[];
  }
): Promise<{ brief: ContentBrief; costUsd: number }> {
  const clusterLines = cluster.length
    ? cluster
        .map((q) => `- "${q.query}" — position ${q.position}, ${q.impressions} impressions, ${q.clicks} clicks`)
        .join("\n")
    : "(no related queries found in Search Console)";

  const prompt = [
    `Client: ${clientName}`,
    `Working title: ${title}`,
    targetQuery ? `Primary search: "${targetQuery}"` : null,
    action === "improve_page"
      ? `This is a REWORK of an existing page${page ? ` (${page})` : ""}. The page already ranks; it is not earning what the position should. Focus the brief on what the page must cover to deserve a better result, and put anything that depends on the current copy into openQuestions.`
      : `This is a NEW article. Nothing of the client's currently answers this well.`,
    rationale ? `Why it was picked: ${rationale}` : null,
    "",
    "Searches this site already appears for, related to this topic:",
    clusterLines,
    "",
    "Write the brief.",
  ].filter(Boolean).join("\n");

  const { value, usage } = await generate<ContentBrief>({
    db,
    feature: "content_brief",
    clientId,
    system: SYSTEM,
    prompt,
    schema: SCHEMA,
    maxTokens: 3000,
  });

  // Belt and braces on the two limits that have a real cost when exceeded: a
  // truncated title in the SERP loses the click the whole brief exists to win.
  // The schema constrains these, but a silently over-long title is exactly the
  // kind of thing worth checking twice rather than trusting.
  const brief: ContentBrief = {
    ...value,
    metaTitle: value.metaTitle.slice(0, 60),
    metaDescription: value.metaDescription.slice(0, 160),
  };

  // The floor the schema cannot express. A one-section "outline" is not a brief,
  // and saving it would leave someone looking at a paid-for empty page wondering
  // whether the button worked.
  if (brief.sections.length < 2) {
    throw new Error(
      `The brief came back with ${brief.sections.length} section(s), which is not usable. ` +
      `Try again, or add more tracked keywords so there is a richer query cluster to work from.`
    );
  }

  return { brief, costUsd: usage.costUsd };
}
