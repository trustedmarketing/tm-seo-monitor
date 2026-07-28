// api/ops/propose — run the proposal engine on demand.
//
// WO-003. Manual trigger while the engine earns trust. The COO review asked for
// exactly this discipline: "new rule types start in a shadow state visible only
// to the pod lead until they demonstrate a decent approval rate, then graduate."
//
// Running it by hand first means we see what it proposes, on real content,
// before it starts filling the queue every morning unattended. Wiring it into
// the daily cron is a deliberate later step, not a default.
//
// Writes nothing to any client property — it reads live values and stages cards
// in our own database.
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/supabaseServer";
import { runForClient, runAll } from "@/lib/proposalEngine";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const profile = await getProfile();
  if (profile?.role !== "owner") {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }

  const p = new URL(req.url).searchParams;
  const clientId = p.get("client");
  const limit = Math.min(Number(p.get("limit") ?? 25), 100);

  const results = clientId ? [await runForClient(clientId, limit)] : await runAll(limit);

  const totals = results.reduce(
    (a, r) => ({
      scanned: a.scanned + r.scanned,
      proposed: a.proposed + r.proposed,
      suppressed: a.suppressed + r.suppressed,
      duplicate: a.duplicate + r.duplicate,
    }),
    { scanned: 0, proposed: 0, suppressed: 0, duplicate: 0 }
  );

  return NextResponse.json({
    ok: true,
    totals,
    results,
    next: totals.proposed > 0 ? "/dashboard/approvals" : undefined,
    note: "Nothing was written to any client site. Cards are staged; approval publishes.",
  });
}
