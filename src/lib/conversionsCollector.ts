// lib/conversionsCollector.ts — WO-001 stream 3: GA4 → conversions_daily.
// Standalone collector, not wired into the cron route (left to the CTO — see
// docs/wo-001-parallel-build-enabling-layer.md). Takes `db` as a param so it's
// unit-testable against tests/helpers/fakeDb.ts.
//
// Upsert-by-hand (select existing → update, else insert) rather than a native
// `.upsert()` call: mirrors the pattern already used in lib/recSync.ts, and
// keeps this collector testable against the in-memory fake, which doesn't
// implement PostgREST's upsert.

import type { SupabaseClient } from "@supabase/supabase-js";
import { dailyConversions } from "@/lib/ga4";
import { tracked } from "@/lib/collectorRuns";

export interface ConversionsClient {
  id: string;
  domain: string;
  ga4_property_id?: string | null;
}

export async function collectConversions(
  db: SupabaseClient,
  client: ConversionsClient,
  days = 28
): Promise<number> {
  const result = await tracked(db, "conversions", client.id, async () => {
    if (!client.ga4_property_id) {
      throw new Error(`client ${client.domain} has no ga4_property_id configured`);
    }

    const rows = await dailyConversions(client.ga4_property_id, days);
    let written = 0;

    for (const r of rows) {
      const source = r.source || "ga4";
      const { data: existing } = await db
        .from("conversions_daily")
        .select("id")
        .eq("client_id", client.id)
        .eq("date", r.date)
        .eq("source", source)
        .maybeSingle();

      if (existing) {
        await db
          .from("conversions_daily")
          .update({ sessions: r.sessions, conversions: r.conversions, revenue: r.revenue })
          .eq("id", existing.id);
      } else {
        await db.from("conversions_daily").insert({
          client_id: client.id,
          date: r.date,
          source,
          sessions: r.sessions,
          conversions: r.conversions,
          revenue: r.revenue,
        });
      }
      written++;
    }

    return { value: written, rows: written, detail: `wrote ${written} rows` };
  });

  return result ?? 0;
}
