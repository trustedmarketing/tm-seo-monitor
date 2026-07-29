// lib/contentIdeas.ts — what to write next, and why.
//
// WO-005. Turns GSC query performance into ranked content recommendations, each
// carrying the numbers that justified it.
//
// ── The rule this file is built around ───────────────────────────────────────
// Every recommendation must be defensible from measured data. A content plan
// that says "write about commercial HVAC maintenance" is worthless; one that
// says "1,400 people search this a month, you sit at #11, and the page still
// says 'Our Services'" is a decision someone can make in ten seconds.
//
// So: no recommendation without its evidence, and no impact number without a
// stated basis. Where a figure is modelled rather than measured, the output says
// so and carries a confidence, because a modelled number presented as a measured
// one is the fastest way to lose an account manager's trust in the whole screen.
//
// ── What this file deliberately will NOT do ──────────────────────────────────
// Invent demand. If a query has no impressions and no search volume, we have no
// evidence anyone wants it, and the honest output is a recommendation with NO
// impact estimate rather than a plausible-looking guess. `expectedClicks` is
// null in that case, and the UI shows "not enough data to estimate" rather than
// a number nobody should act on.

export type WindowRow = {
  query: string;
  page: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type IdeaKind =
  | "ctr_gap"             // ranks on page one but the title is not earning clicks
  | "striking_distance"   // ranks 8-20: a page exists and is close
  | "content_gap"         // demand exists, nothing of ours answers it
  | "question"            // phrased as a question — blog format specifically
  | "rising"              // demand growing window over window
  | "cannibalisation";    // several of our pages compete for one query

export type ContentIdea = {
  kind: IdeaKind;
  query: string;
  /** A working title. Rule-derived; the AI brief step rewrites it properly. */
  title: string;
  /** One sentence, with the numbers. This is what a human reads. */
  rationale: string;
  /** Extra clicks a month if it works. Null when we cannot honestly estimate. */
  expectedClicks: number | null;
  /** How the estimate was produced. Null when expectedClicks is null. */
  basis: string | null;
  confidence: "low" | "medium" | "high";
  /** Whether this needs a NEW article or a change to an existing page. */
  action: "new_article" | "improve_page";
  /** The page to improve, when action is improve_page. */
  page: string | null;
  /** Sort key. Higher first. */
  score: number;
  impressions: number;
  position: number | null;
};

// ── Positional click-through ────────────────────────────────────────────────
// An industry-average curve, not this client's. Real CTR varies enormously with
// SERP features, brand strength and intent, so every number derived from this is
// labelled "modelled" and never presented as measured.
//
// Used only for DIFFERENCES between positions, which is far more stable across
// datasets than the absolute values.
const CTR_CURVE: Record<number, number> = {
  1: 0.281, 2: 0.152, 3: 0.099, 4: 0.070, 5: 0.052,
  6: 0.040, 7: 0.032, 8: 0.026, 9: 0.022, 10: 0.019,
};

export function ctrAt(position: number): number {
  const p = Math.max(1, Math.round(position));
  if (p <= 10) return CTR_CURVE[p];
  // Beyond page one, decay towards nothing. Page two gets a fraction of page
  // one's tail and page three is effectively invisible.
  if (p <= 20) return 0.019 * Math.pow(0.85, p - 10);
  return 0.002;
}

/**
 * Realistic target position for a page currently at `position`.
 *
 * Deliberately modest. Promising #1 from #14 is how an agency ends up explaining
 * a miss; promising a move to the bottom of page one is achievable and still
 * worth doing. Nothing here claims a jump of more than about six places.
 */
function realisticTarget(position: number): number {
  if (position <= 5) return Math.max(1, position - 2);
  if (position <= 10) return Math.max(3, position - 4);
  if (position <= 20) return Math.max(6, position - 6);
  return 12;
}

const QUESTION_STARTS = [
  "how", "what", "why", "when", "where", "which", "who",
  "can", "do", "does", "is", "are", "should", "will",
];

export function isQuestion(query: string): boolean {
  const q = query.toLowerCase().trim();
  const first = q.split(/\s+/)[0];
  // "vs" and "versus" are comparison intent, which wants the same article shape
  // as a question even though it is not phrased as one.
  return QUESTION_STARTS.includes(first) || /\b(vs\.?|versus)\b/.test(q);
}

/** Title Case for a working title, leaving small words alone. */
function workingTitle(query: string, kind: IdeaKind): string {
  const small = new Set(["a", "an", "the", "for", "and", "or", "of", "in", "on", "to", "vs"]);
  const titled = query
    .split(/\s+/)
    .map((w, i) => (i > 0 && small.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
  if (kind === "question") return titled.endsWith("?") ? titled : `${titled}?`;
  return titled;
}

function money(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Build ranked content ideas from two query windows.
 *
 * @param current  the most recent window
 * @param prior    the window before it, for trend. Empty array is fine.
 * @param exclude  queries already covered by a live or declined content item,
 *                 lower-cased. Without this the recommender re-proposes the same
 *                 article every run and the pipeline fills with duplicates.
 */
export function buildIdeas(
  current: WindowRow[],
  prior: WindowRow[] = [],
  exclude: Set<string> = new Set(),
  /**
   * Brand words for this client, lower-cased. A brand term ranking #1 does not
   * need its title rewritten — people searching your name have already decided,
   * and a below-curve CTR there usually means sitelinks or a knowledge panel
   * absorbed the click rather than anything being wrong.
   */
  brandWords: string[] = []
): ContentIdea[] {
  // The query rollup rows are the demand signal. Page rows are used separately
  // for cannibalisation and for naming the page to improve.
  const rollup = current.filter((r) => r.page === null);
  const pages = current.filter((r) => r.page !== null);

  const priorByQuery = new Map(prior.filter((r) => r.page === null).map((r) => [r.query.toLowerCase(), r]));

  // query -> the pages that rank for it, best position first
  const pagesFor = new Map<string, WindowRow[]>();
  for (const r of pages) {
    const k = r.query.toLowerCase();
    const l = pagesFor.get(k) ?? [];
    l.push(r);
    pagesFor.set(k, l);
  }
  for (const l of pagesFor.values()) l.sort((a, b) => a.position - b.position);

  const ideas: ContentIdea[] = [];

  for (const row of rollup) {
    const key = row.query.toLowerCase();
    if (exclude.has(key)) continue;
    // A single impression is not demand. This floor keeps the long tail of
    // one-off searches out of a list someone is meant to act on.
    if (row.impressions < 10) continue;

    const isBrand = brandWords.some((w) => w.length >= 3 && key.includes(w));
    const rankingPages = pagesFor.get(key) ?? [];
    const best = rankingPages[0] ?? null;
    const priorRow = priorByQuery.get(key);

    // ── cannibalisation ─────────────────────────────────────────────────────
    // Two or more of our own pages on page one for the same query. Writing a
    // third makes it worse, so this is the one idea whose action is a merge.
    const onPageOne = rankingPages.filter((p) => p.position <= 10);
    if (onPageOne.length >= 2) {
      ideas.push({
        kind: "cannibalisation",
        query: row.query,
        title: workingTitle(row.query, "cannibalisation"),
        rationale:
          `${onPageOne.length} of your pages compete for "${row.query}" ` +
          `(${money(row.impressions)} impressions). Consolidate into one rather than adding another.`,
        expectedClicks: null,
        basis: null,
        confidence: "medium",
        action: "improve_page",
        page: best?.page ?? null,
        // Ranked above ordinary improvements: it is cheap to fix and it stops
        // effort being wasted writing something that would compete with itself.
        score: row.impressions * 1.2,
        impressions: row.impressions,
        position: best?.position ?? null,
      });
      continue;
    }

    // ── click-through gap ───────────────────────────────────────────────────
    // Ranks on page one and still is not clicked. This is the cheapest win
    // available anywhere on this screen: the ranking is already won, and the
    // fix is a title and meta description rather than an article.
    //
    // Added 2026-07-29 after the first real pull. "best salt remover for boats"
    // sat at #5.1 with 136 impressions and 5 clicks — a third of the clicks that
    // position should earn — and the rules produced NOTHING for it, because
    // positions 1-6 fell between striking distance and the gap rules.
    if (!isBrand && row.position <= 10 && row.impressions >= 50) {
      const expected = ctrAt(row.position);
      const actual = row.impressions > 0 ? row.clicks / row.impressions : 0;
      const gain = Math.round(row.impressions * (expected - actual));

      // TWO conditions, not one. The ratio says the shortfall is real; the
      // absolute floor says it is worth doing something about.
      //
      // Learned from the first real pull: on Salty Dog's volume a 29% CTR
      // shortfall is worth two clicks a month. A rule that fired on the ratio
      // alone would have filled the queue with true observations that are not
      // worth anyone's twenty minutes, which is how a recommendation queue stops
      // being read at all.
      //
      // 75% of the curve catches genuine title problems without tripping on
      // ordinary SERP variation; 5 clicks a month is the floor for "act on this".
      if (actual < expected * 0.75 && gain >= 5) {
        ideas.push({
          kind: "ctr_gap",
          query: row.query,
          title: workingTitle(row.query, "ctr_gap"),
          rationale:
            `Position ${row.position.toFixed(1)} with ${money(row.impressions)} impressions, but only ` +
            `${money(row.clicks)} click${row.clicks === 1 ? "" : "s"} — ` +
            `${(actual * 100).toFixed(1)}% where this position usually earns ${(expected * 100).toFixed(1)}%. ` +
            `The ranking is already won; the title is not earning the click.`,
          expectedClicks: gain > 0 ? gain : null,
          basis: gain > 0 ? `Measured shortfall against the CTR curve at #${row.position.toFixed(0)}` : null,
          // The strongest evidence in this file: measured clicks against a
          // measured position, no assumption about a page that does not exist.
          confidence: row.impressions >= 100 ? "high" : "medium",
          action: "improve_page",
          page: best?.page ?? null,
          // Ranked top: cheapest fix, fastest payback, already-earned ranking.
          score: gain * 25 + row.impressions,
          impressions: row.impressions,
          position: row.position,
        });
        continue;
      }
    }

    // ── striking distance ───────────────────────────────────────────────────
    // We rank, but below the fold. The page exists; the work is on the page.
    if (row.position >= 6 && row.position <= 20) {
      const target = realisticTarget(row.position);
      const gain = Math.round(row.impressions * (ctrAt(target) - ctrAt(row.position)));
      ideas.push({
        kind: "striking_distance",
        query: row.query,
        title: workingTitle(row.query, "striking_distance"),
        rationale:
          `${money(row.impressions)} impressions a month at position ${row.position.toFixed(1)}. ` +
          `Already ranking, just not high enough to be clicked.`,
        expectedClicks: gain > 0 ? gain : null,
        basis: gain > 0 ? `Modelled from the CTR curve, #${row.position.toFixed(0)} → #${target}` : null,
        // Measured impressions at a measured position is the strongest evidence
        // this file ever has.
        confidence: gain >= 20 ? "high" : "medium",
        action: "improve_page",
        page: best?.page ?? null,
        score: gain * 10 + row.impressions,
        impressions: row.impressions,
        position: row.position,
      });
      continue;
    }

    // ── rising demand ───────────────────────────────────────────────────────
    // Growing impressions means the market is moving. Worth writing while it
    // climbs rather than after it peaks.
    if (priorRow && priorRow.impressions >= 10) {
      const growth = (row.impressions - priorRow.impressions) / priorRow.impressions;
      if (growth >= 0.5 && row.impressions >= 30) {
        ideas.push({
          kind: "rising",
          query: row.query,
          title: workingTitle(row.query, isQuestion(row.query) ? "question" : "rising"),
          rationale:
            `Impressions up ${Math.round(growth * 100)}% on the previous 28 days ` +
            `(${money(priorRow.impressions)} → ${money(row.impressions)}). Demand is climbing now.`,
          expectedClicks: null,
          basis: null,
          confidence: "medium",
          action: row.position > 20 || !best ? "new_article" : "improve_page",
          page: best?.page ?? null,
          score: row.impressions * (1 + growth),
          impressions: row.impressions,
          position: row.position,
        });
        continue;
      }
    }

    // ── questions and gaps ──────────────────────────────────────────────────
    // Ranking beyond page two with real impressions means the demand is proven
    // and nothing of ours answers it properly.
    if (row.position > 20) {
      const question = isQuestion(row.query);
      const target = 12;
      // Impressions at position 40 badly understate demand, because we are barely
      // being shown. This is a floor, not an estimate, and says so.
      const gain = Math.round(row.impressions * ctrAt(target));
      ideas.push({
        kind: question ? "question" : "content_gap",
        query: row.query,
        title: workingTitle(row.query, question ? "question" : "content_gap"),
        rationale: question
          ? `A question people are asking (${money(row.impressions)} impressions) that nothing of yours answers ` +
            `— you sit at position ${row.position.toFixed(0)}.`
          : `${money(row.impressions)} impressions and you rank ${row.position.toFixed(0)}. ` +
            `The demand is proven; the page to meet it does not exist.`,
        expectedClicks: gain >= 3 ? gain : null,
        basis: gain >= 3
          ? `Floor estimate: impressions are suppressed at #${row.position.toFixed(0)}, so real demand is higher`
          : null,
        // Low: impressions at a poor position understate demand by an unknown
        // amount, so the number is directionally useful and precisely wrong.
        confidence: "low",
        action: "new_article",
        page: null,
        score: row.impressions * (question ? 1.15 : 1),
        impressions: row.impressions,
        position: row.position,
      });
    }
  }

  return ideas.sort((a, b) => b.score - a.score);
}

/**
 * Ideas grouped for display, capped per group.
 *
 * The cap is a display decision, not a data one: forty recommendations is a
 * backlog nobody reads. The caller shows how many were held back so the list
 * does not silently look complete.
 */
export function topIdeas(ideas: ContentIdea[], perKind = 3): { shown: ContentIdea[]; heldBack: number } {
  const seen = new Map<IdeaKind, number>();
  const shown: ContentIdea[] = [];
  for (const idea of ideas) {
    const n = seen.get(idea.kind) ?? 0;
    if (n >= perKind) continue;
    seen.set(idea.kind, n + 1);
    shown.push(idea);
  }
  return { shown, heldBack: ideas.length - shown.length };
}
