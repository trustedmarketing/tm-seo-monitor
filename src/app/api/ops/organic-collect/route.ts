// api/ops/organic-collect — pull GSC query windows for one client, now.
//
// WO-005. The Organic tab reads `gsc_query_windows`, which the daily cron fills.
// Waiting a day to see whether a new collector works is a bad loop, and the same
// button is what you want after connecting a new property or fixing a permission.
//
// Agency-only. Writes a `collector_runs` row either way, so a manual pull is as
// visible in the run history as a scheduled one — a collection nobody can see is
// how "when did this last work?" becomes unanswerable.
import { getProfile, isAgency } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { collectOrganicQueries } from "@/lib/organicCollector";
import { recordRun } from "@/lib/collectorRuns";

export const dynamic = "force-dynamic";
// Two GSC calls per window, two windows. Comfortably inside 60s, but the default
// would be tight if a property is slow.
export const maxDuration = 120;

export async function POST(req: Request) {
  const profile = await getProfile();
  if (!isAgency(profile)) {
    return Response.json({ error: "Agency access required" }, { status: 403 });
  }

  const clientId = new URL(req.url).searchParams.get("client");
  if (!clientId) return Response.json({ error: "client required" }, { status: 400 });

  const db = dbClient();

  const { data: client, error } = await db
    .from("clients")
    .select("id, name, gsc_property")
    .eq("id", clientId)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!client) return Response.json({ error: "client not found" }, { status: 404 });

  // Named plainly: "no data" on the Organic tab and "this client has no Search
  // Console property connected" are different problems, and only one of them is
  // something the reader can fix.
  if (!client.gsc_property) {
    return Response.json(
      { ok: false, reason: "no_gsc_property", hint: `${client.name} has no Search Console property set in Settings.` },
      { status: 400 }
    );
  }

  const t0 = Date.now();
  try {
    const result = await collectOrganicQueries(db, client.id, client.gsc_property);

    await recordRun(db, "organic_queries", client.id, {
      status: "success",
      detail: `window=${result.windowEnd} prior=${result.priorWindowEnd} rows=${result.rowsWritten}`,
      rows_written: result.rowsWritten,
      duration_ms: Date.now() - t0,
    });

    return Response.json({ ok: true, ...result });
  } catch (e) {
    const message = (e as Error).message;
    await recordRun(db, "organic_queries", client.id, {
      status: "error",
      error: message,
      duration_ms: Date.now() - t0,
    });
    // Full message, not a slice. Truncating vendor errors cost most of a day on
    // the PostFlow media upload; the fix was in the part that got cut off.
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
