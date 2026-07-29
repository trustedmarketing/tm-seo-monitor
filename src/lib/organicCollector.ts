// lib/organicCollector.ts — persist GSC query windows.
//
// WO-005. Fetches the current 28-day window and the one before it, and upserts
// both. Two windows because every figure on the Organic screen is a comparison:
// a position with no "was" is a fact nobody can act on.
//
// The prior window is re-fetched on every run rather than trusted from storage.
// GSC back-fills for about three days, so a window captured the day it closed is
// measurably different from the same window read a week later. Re-fetching costs
// one API call and removes a whole class of "the numbers changed" questions.

import type { SupabaseClient } from "@supabase/supabase-js";
import { queryWindow, type QueryWindowRow } from "@/lib/gsc";

export type OrganicCollectResult = {
  windowEnd: string;
  priorWindowEnd: string;
  rowsWritten: number;
};

/**
 * Collect and store both windows for one client.
 *
 * Throws on failure so the caller records a `collector_runs` error row. A
 * collector that swallows its own failure is how a dashboard shows stale data
 * confidently for a week.
 */
export async function collectOrganicQueries(
  db: SupabaseClient,
  clientId: string,
  property: string,
  { windowDays = 28, limit = 250 } = {}
): Promise<OrganicCollectResult> {
  const [current, prior] = await Promise.all([
    queryWindow(property, { windowDays, limit, backBy: 0 }),
    queryWindow(property, { windowDays, limit, backBy: 1 }),
  ]);

  let rowsWritten = 0;
  for (const w of [current, prior]) {
    if (w.rows.length === 0) continue;

    const payload = w.rows.map((r: QueryWindowRow) => ({
      client_id: clientId,
      window_end: w.windowEnd,
      window_days: w.windowDays,
      query: r.query,
      // TypeScript uses null for "this is the query rollup"; the table uses ''
      // so the unique constraint works (NULL never equals NULL). This line and
      // its counterpart in shape() are the only two places the two conventions
      // meet — keep the conversion here rather than leaking '' into the logic.
      page: r.page ?? "",
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    }));

    // Chunked: a 500-row upsert is fine, but the top-N cap can be raised later
    // and a single oversized statement is a bad way to discover a limit.
    for (let i = 0; i < payload.length; i += 500) {
      const chunk = payload.slice(i, i + 500);
      const { error } = await db
        .from("gsc_query_windows")
        .upsert(chunk, { onConflict: "client_id,window_end,query,page", ignoreDuplicates: false });

      // Checked, not assumed. A silent upsert failure here would leave the
      // Organic tab rendering an empty state that looks like "no demand".
      if (error) throw new Error(`gsc_query_windows upsert failed: ${error.message}`);
      rowsWritten += chunk.length;
    }
  }

  return { windowEnd: current.windowEnd, priorWindowEnd: prior.windowEnd, rowsWritten };
}

/**
 * The two most recent distinct windows we hold for a client.
 *
 * Returns current first. Either may be empty — a client collected for the first
 * time today has no prior window, and the UI has to say "no comparison yet"
 * rather than render a delta against zero.
 */
export async function readWindows(
  db: SupabaseClient,
  clientId: string
): Promise<{ current: QueryWindowRow[]; prior: QueryWindowRow[]; windowEnd: string | null }> {
  const { data: ends, error: endErr } = await db
    .from("gsc_query_windows")
    .select("window_end")
    .eq("client_id", clientId)
    .order("window_end", { ascending: false })
    .limit(600);

  if (endErr) throw new Error(`gsc_query_windows read failed: ${endErr.message}`);

  const distinct = [...new Set((ends ?? []).map((r) => r.window_end as string))];
  if (distinct.length === 0) return { current: [], prior: [], windowEnd: null };

  const [currentEnd, priorEnd] = distinct;

  const { data, error } = await db
    .from("gsc_query_windows")
    .select("window_end, query, page, clicks, impressions, ctr, position")
    .eq("client_id", clientId)
    .in("window_end", [currentEnd, priorEnd].filter(Boolean));

  if (error) throw new Error(`gsc_query_windows read failed: ${error.message}`);

  const shape = (r: Record<string, unknown>): QueryWindowRow => ({
    query: r.query as string,
    // '' is the rollup sentinel, not a page. `?? null` would NOT catch it —
    // empty string is not nullish — and every rollup row would have been
    // treated as a page, breaking cannibalisation detection silently.
    page: (r.page as string) || null,
    clicks: Number(r.clicks ?? 0),
    impressions: Number(r.impressions ?? 0),
    ctr: Number(r.ctr ?? 0),
    position: Number(r.position ?? 0),
  });

  return {
    current: (data ?? []).filter((r) => r.window_end === currentEnd).map(shape),
    prior: priorEnd ? (data ?? []).filter((r) => r.window_end === priorEnd).map(shape) : [],
    windowEnd: currentEnd,
  };
}
