// lib/revenueReconciliation.ts — accuracy gate: does what the app displays
// match what Shopify actually reports for the same window, right now?
//
// Reuses the exact API client the collector uses (lib/shopify.ts's
// fetchDailySales) rather than inventing a new Shopify surface, but calls
// it independently of collectShopify()'s own write path. That's
// deliberate: comparing a freshly-fetched sum against the sum of what was
// just written from that SAME fetch would only ever catch a write failure.
// This instead compares a fresh fetch against what's currently STORED —
// exercising collector write AND every downstream read/aggregation
// together, which is the only way to catch a bug like the Overview page's
// unbounded-date-window bug (a read-side bug the collector's own
// write-time checks could never have surfaced).
import type { SupabaseClient } from "@supabase/supabase-js";
import { mintToken, fetchDailySales } from "@/lib/shopify";
import { readSecret } from "@/lib/vault";
import { tracked } from "@/lib/collectorRuns";

const MODULE = "shopify_reconciliation";

export interface ReconciliationClient {
  id: string;
  domain: string;
}

interface ClientStoreRow {
  id: string;
  client_id: string;
  platform: string;
  domain: string;
  api_client_id: string | null;
  auth_ref: string | null;
  status: string;
}

export interface ReconciliationResult {
  storedRevenue: number;
  freshRevenue: number;
  diffAbs: number;
  diffPct: number | null;
  mismatched: boolean;
  /** The date range actually compared — taken from Shopify's own returned rows. */
  windowStart: string;
  windowEnd: string;
}

// A day of edge drift (timezone rounding, an order landing right at the
// boundary) is normal. Past this is a real discrepancy worth paging
// someone about, not noise — same两-part threshold shape as
// lib/slaEscalation.ts's notify/escalate levels: percentage alone is noisy
// on small accounts, so an absolute floor backs it up.
export const TOLERANCE_PCT = 0.02; // 2%
export const TOLERANCE_ABS = 25; // dollars

export function reconcile(
  storedRevenue: number,
  freshRevenue: number,
  windowStart = "",
  windowEnd = ""
): ReconciliationResult {
  const diffAbs = Math.abs(freshRevenue - storedRevenue);
  const diffPct = freshRevenue > 0 ? diffAbs / freshRevenue : null;
  const mismatched = diffAbs > TOLERANCE_ABS && (diffPct == null || diffPct > TOLERANCE_PCT);
  return { storedRevenue, freshRevenue, diffAbs, diffPct, mismatched, windowStart, windowEnd };
}

/**
 * Compares stored conversions_daily(source='shopify') revenue for the last
 * `days` days against a fresh, independent fetch from Shopify for the same
 * window. Never throws — recorded via tracked() like every other collector;
 * a check that crashes the cron would be worse than the thing it checks.
 * Returns null when there's nothing to check (no Shopify store configured).
 */
export async function checkShopifyReconciliation(
  db: SupabaseClient,
  client: ReconciliationClient,
  days = 30
): Promise<ReconciliationResult | null> {
  const result = await tracked(db, MODULE, client.id, async () => {
    const { data: store } = await db
      .from("client_stores")
      .select("id, client_id, platform, domain, api_client_id, auth_ref, status")
      .eq("client_id", client.id)
      .eq("platform", "shopify")
      .maybeSingle();

    if (!store) {
      return { value: null, rows: 0, detail: `no shopify client_stores row for ${client.domain}` };
    }
    const row = store as ClientStoreRow;

    if (!row.api_client_id || !row.auth_ref) {
      return { value: null, rows: 0, detail: `shopify store not fully configured for ${client.domain}` };
    }

    const clientSecret = await readSecret(db, row.auth_ref);
    if (!clientSecret) {
      return { value: null, rows: 0, detail: `no vault secret for ${client.domain}'s shopify auth_ref` };
    }

    const token = await mintToken(row.domain, row.api_client_id, clientSecret);
    const fresh = await fetchDailySales(row.domain, token, days);
    if (fresh.length === 0) {
      return { value: null, rows: 0, detail: `shopify returned no days for ${client.domain} — nothing to compare` };
    }
    const freshRevenue = fresh.reduce((s, r) => s + r.revenue, 0);

    // Compare exactly the dates Shopify itself returned, rather than a
    // separately-computed wall-clock window. If the two sides disagree about
    // which days are in scope — even by one — the difference shows up as a
    // revenue gap and pages someone about a discrepancy that isn't real.
    const dates = fresh.map((r) => r.date).sort();
    const windowStart = dates[0];
    const windowEnd = dates[dates.length - 1];

    const { data: stored } = await db
      .from("conversions_daily")
      .select("revenue")
      .eq("client_id", client.id)
      .eq("source", "shopify")
      .gte("date", windowStart)
      .lte("date", windowEnd);
    const storedRevenue = ((stored ?? []) as { revenue: number | null }[]).reduce((s, r) => s + (r.revenue ?? 0), 0);

    const value = reconcile(storedRevenue, freshRevenue, windowStart, windowEnd);
    const summary =
      `stored $${storedRevenue.toFixed(2)} vs fresh $${freshRevenue.toFixed(2)} (${windowStart}..${windowEnd})`;

    return {
      value,
      rows: 0,
      detail: value.mismatched
        ? `MISMATCH for ${client.domain}: ${summary}` +
          (value.diffPct != null ? ` — ${(value.diffPct * 100).toFixed(1)}% off` : "")
        : `reconciled for ${client.domain}: ${summary}`,
    };
  });

  return result ?? null;
}
