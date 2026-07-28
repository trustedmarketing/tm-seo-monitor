// api/ops/social-collect — pull social performance on demand.
//
// WO-003 Stream N. The scheduled collector runs at 6am; this exists so a client
// can be brought up to date the moment their PostFlow group is set, rather than
// waiting a day to find out whether the connection works.
//
// Unlike the QC crawl this has no cooldown: PostFlow's analytics endpoint is a
// read against data they already hold, so a repeat call costs nothing but a
// slice of the shared 60 req/min budget.
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { collectSocial } from "@/lib/socialCollector";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const profile = await getProfile();
  if (profile?.role !== "owner") {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }

  const p = new URL(req.url).searchParams;
  const clientId = p.get("client");
  const days = Math.min(Number(p.get("days") ?? 90), 365);

  const db = dbClient();
  const q = db.from("clients").select("id, domain, name, postflow_group_id").eq("active", true);
  const { data: clients } = clientId ? await q.eq("id", clientId) : await q;

  const results = [];
  for (const c of (clients ?? []) as { id: string; domain: string; name: string; postflow_group_id: string | null }[]) {
    try {
      const r = await collectSocial(db, c, days);
      results.push({ client: c.name, ok: r.rows > 0, rows: r.rows, detail: r.detail });
    } catch (e) {
      results.push({ client: c.name, ok: false, error: (e as Error).message.slice(0, 250) });
    }
  }

  return NextResponse.json({
    ok: results.some((r) => r.ok),
    window_days: days,
    results,
    // Named explicitly because collecting and proposing are separate steps, and
    // it is not obvious that data landing does not by itself create a card.
    next: "/api/ops/propose?client=<id> to stage cards from what was collected",
  });
}
