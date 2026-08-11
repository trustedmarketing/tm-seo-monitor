// lib/dataFreshness.ts — "has the data stopped updating?" check.
//
// The revenue reconciliation in lib/revenueReconciliation.ts answers "is the
// number WRONG". This answers the quieter failure: the number is still right
// for the last day it was collected, and nothing has been collected since. A
// frozen dashboard looks identical to a calm one — no error, no red, just a
// figure that stopped moving — which is exactly why it needs its own alarm
// rather than relying on someone noticing.
//
// Only flags a source that has reported before. A client with no Shopify
// store or no Meta account has no rows at all, and calling that "stale" every
// single morning is how a failure list gets ignored.
import type { SupabaseClient } from "@supabase/supabase-js";

// Ad platforms and Shopify both settle a day or two late, and the cron runs
// once daily — so anything inside ~3 days is normal lag, not a fault.
export const STALE_AFTER_DAYS = 3;

export interface StaleSource {
  client: string;
  module: string;
  hoursOld: number;
}

interface FreshnessClient {
  id: string;
  domain: string;
}

export function hoursSince(latestDate: string, now = new Date()): number {
  // Rows are date-only (YYYY-MM-DD); treat them as that day's UTC midnight.
  const then = new Date(latestDate + "T00:00:00Z").getTime();
  return Math.max(0, Math.round((now.getTime() - then) / 3_600_000));
}

async function latestDateIn(
  db: SupabaseClient,
  table: string,
  clientId: string,
  filter?: { col: string; val: string }
): Promise<string | null> {
  let q = db.from(table).select("date").eq("client_id", clientId);
  if (filter) q = q.eq(filter.col, filter.val);
  const { data } = await q.order("date", { ascending: false }).limit(1);
  const rows = (data ?? []) as { date: string }[];
  return rows.length ? rows[0].date : null;
}

/**
 * Per client, checks the tables the dashboard's headline numbers are built
 * from and returns the ones whose freshest row is older than
 * `STALE_AFTER_DAYS`. Never throws — a monitoring check that can fail the
 * collection it rides on is worse than no check.
 */
export async function findStaleData(
  db: SupabaseClient,
  clients: FreshnessClient[],
  now = new Date()
): Promise<StaleSource[]> {
  const cutoffHours = STALE_AFTER_DAYS * 24;
  const stale: StaleSource[] = [];

  for (const c of clients) {
    const checks: { module: string; latest: string | null }[] = [
      { module: "shopify revenue", latest: await latestDateIn(db, "conversions_daily", c.id, { col: "source", val: "shopify" }) },
      { module: "ad spend", latest: await latestDateIn(db, "ad_metrics_daily", c.id) },
    ];

    for (const { module, latest } of checks) {
      if (!latest) continue; // never reported → not configured, not stale
      const hoursOld = hoursSince(latest, now);
      if (hoursOld > cutoffHours) stale.push({ client: c.domain, module, hoursOld });
    }
  }

  return stale;
}
