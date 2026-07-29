// lib/keywordMovement.ts — which searches moved, and which matter.
//
// WO-005. The design calls this table "Conversion keywords" and footnotes it
// "only keywords with recorded conversions in the last 90 days".
//
// ── Why this is NOT called conversion keywords ───────────────────────────────
// We cannot honestly make that claim. Conversions are recorded per SOURCE in
// `conversions_daily` (shopify, ga4), not per keyword, and Search Console does
// not attribute conversions at all. The closest available statement is "keywords
// whose landing page recorded conversions", which is a materially weaker claim —
// a page usually ranks for dozens of queries, so crediting one of them with the
// conversion is a guess wearing a fact's clothing.
//
// So the table reports what it can actually measure: movement, weighted by the
// traffic at stake. When per-keyword conversion data exists this file is where
// the filter goes, and the heading can change then.

export type MovementRow = {
  query: string;
  /** Position in the previous window. Null when the query is newly visible. */
  was: number | null;
  now: number;
  /** Positive means improved — positions count DOWN, so was - now. */
  delta: number | null;
  trend: "rising" | "holding" | "slipped" | "new";
  clicks: number;
  impressions: number;
  /** Monthly search volume, when DataForSEO has filled it in. */
  volume: number | null;
  /** What is at stake, used for ordering. */
  score: number;
};

type Row = { query: string; page: string | null; clicks: number; impressions: number; position: number };

/**
 * Movement between two windows.
 *
 * Rollup rows only. A query×page row is the same query counted again, and
 * including them would list popular queries several times with different
 * positions — which reads as a data bug and is really a misuse of the table.
 */
export function keywordMovement(
  current: Row[],
  prior: Row[] = [],
  volumes: Map<string, number> = new Map()
): MovementRow[] {
  const priorByQuery = new Map(
    prior.filter((r) => r.page === null).map((r) => [r.query.toLowerCase(), r.position])
  );

  const rows: MovementRow[] = [];

  for (const r of current) {
    if (r.page !== null) continue;
    // Below this there is nothing to say: a query with three impressions moving
    // from #60 to #48 is noise, and putting it in a table someone reads every
    // morning trains them to skim.
    if (r.impressions < 10) continue;

    const was = priorByQuery.get(r.query.toLowerCase()) ?? null;
    const delta = was == null ? null : Math.round((was - r.position) * 10) / 10;

    // A tenth of a position is averaging noise, not movement. Half a position is
    // the smallest change worth putting an arrow next to.
    const trend: MovementRow["trend"] =
      was == null ? "new"
      : delta! >= 0.5 ? "rising"
      : delta! <= -0.5 ? "slipped"
      : "holding";

    rows.push({
      query: r.query,
      was: was == null ? null : Math.round(was * 10) / 10,
      now: Math.round(r.position * 10) / 10,
      delta,
      trend,
      clicks: r.clicks,
      impressions: r.impressions,
      volume: volumes.get(r.query.toLowerCase()) ?? null,
      // Ordered by what is at stake, not by how far something moved. A ten-place
      // gain on a query nobody searches is not the top line of this table.
      score: r.impressions,
    });
  }

  return rows.sort((a, b) => b.score - a.score);
}

/** How many of a client's visible queries sit in the top ten. */
export function topTenCount(rows: MovementRow[]): number {
  return rows.filter((r) => r.now <= 10).length;
}

/**
 * Change in top-ten count between windows.
 *
 * Counted over the queries present in BOTH windows. Comparing raw totals would
 * report a gain whenever Search Console simply surfaced more queries, which is
 * a change in visibility of the data, not of the rankings.
 */
export function topTenDelta(rows: MovementRow[]): number | null {
  const comparable = rows.filter((r) => r.was != null);
  if (comparable.length === 0) return null;
  const nowTop = comparable.filter((r) => r.now <= 10).length;
  const wasTop = comparable.filter((r) => r.was! <= 10).length;
  return nowTop - wasTop;
}
