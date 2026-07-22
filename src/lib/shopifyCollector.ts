// lib/shopifyCollector.ts — Shopify revenue collector → conversions_daily(source='shopify').
// Standalone collector, not wired into the cron route (left to the CTO). Shopify
// is the revenue GROUND TRUTH (docs/CLAUDE-monitor-draft.md): ad platforms
// over-attribute (each claims the same orders), so this collector writes real
// store revenue into conversions_daily so the platform can compute honest
// blended MER (revenue ÷ ad spend) instead of trusting platform ROAS. Reuses
// conversions_daily (migration 005) with source='shopify' — no new revenue
// table. Takes `db` as a param so it's unit-testable against
// tests/helpers/fakeDb.ts.
//
// Upsert-by-hand (select existing → update, else insert) rather than a native
// `.upsert()` call: mirrors lib/conversionsCollector.ts and
// lib/metaAdsCollector.ts, and keeps this collector testable against the
// in-memory fake, which doesn't implement PostgREST's upsert.
//
// "Secrets never surface" (docs/CLAUDE-monitor-draft.md, autonomy #5): the
// vaulted client secret and the token minted from it are only ever passed to
// mintToken()/fetchDailySales(); neither is logged or included in a
// detail/error string recorded to collector_runs.
import type { SupabaseClient } from "@supabase/supabase-js";
import { mintToken, fetchDailySales } from "@/lib/shopify";
import { readSecret } from "@/lib/vault";
import { tracked } from "@/lib/collectorRuns";

const MODULE = "shopify";
const SOURCE = "shopify";

export interface ShopifyClient {
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

// Collects the last `days` days of Shopify order revenue for `client` and
// upserts it into conversions_daily by (client_id, date, source='shopify').
// Never throws — no client_stores row, no api_client_id, no vault secret, or
// an API/db error all get recorded as a collector_runs row (via `tracked`)
// and return 0 rather than propagating.
export async function collectShopify(
  db: SupabaseClient,
  client: ShopifyClient,
  days = 28
): Promise<number> {
  const result = await tracked(db, MODULE, client.id, async () => {
    const { data: store } = await db
      .from("client_stores")
      .select("id, client_id, platform, domain, api_client_id, auth_ref, status")
      .eq("client_id", client.id)
      .eq("platform", "shopify")
      .maybeSingle();

    if (!store) {
      return { value: 0, rows: 0, detail: `no shopify client_stores row for ${client.domain}` };
    }

    const row = store as ClientStoreRow;

    if (!row.api_client_id) {
      return {
        value: 0,
        rows: 0,
        detail: `no api_client_id configured for ${client.domain}'s shopify store`,
      };
    }

    if (!row.auth_ref) {
      return {
        value: 0,
        rows: 0,
        detail: `no auth_ref configured for ${client.domain}'s shopify store`,
      };
    }

    const clientSecret = await readSecret(db, row.auth_ref);
    if (!clientSecret) {
      return {
        value: 0,
        rows: 0,
        detail: `no vault secret found for ${client.domain}'s shopify auth_ref`,
      };
    }

    const token = await mintToken(row.domain, row.api_client_id, clientSecret);
    const sales = await fetchDailySales(row.domain, token, days);

    let written = 0;
    for (const s of sales) {
      const { data: existing } = await db
        .from("conversions_daily")
        .select("id")
        .eq("client_id", client.id)
        .eq("date", s.date)
        .eq("source", SOURCE)
        .maybeSingle();

      const payload = {
        client_id: client.id,
        date: s.date,
        source: SOURCE,
        conversions: s.orders,
        revenue: s.revenue,
      };

      if (existing) {
        await db
          .from("conversions_daily")
          .update(payload)
          .eq("id", (existing as { id: string }).id);
      } else {
        await db.from("conversions_daily").insert(payload);
      }
      written++;
    }

    return { value: written, rows: written, detail: `wrote ${written} row(s) for ${client.domain}` };
  });

  return result ?? 0;
}
