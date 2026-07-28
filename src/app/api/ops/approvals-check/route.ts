// api/ops/approvals-check — has a client declined anything?
//
// WO-004. PostFlow has no webhooks, so this is the poll. Runs on the daily cron
// and can be triggered by hand while the loop is new.
//
// It notifies only on a NEWLY declined post. A decline from last week must not
// re-alert every morning — an alert that repeats is one people learn to ignore.
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { checkApprovals } from "@/lib/postflowApproval";
import { notify } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const isCron = !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET;

  if (!isCron) {
    const profile = await getProfile();
    if (profile?.role !== "owner") {
      return NextResponse.json({ error: "Owner access required" }, { status: 403 });
    }
  }

  const db = dbClient();
  const clientId = url.searchParams.get("client");

  const q = db.from("clients").select("id, name, postflow_group_id").eq("active", true);
  const { data: clients } = clientId ? await q.eq("id", clientId) : await q;

  const results = [];
  for (const c of (clients ?? []) as { id: string; name: string; postflow_group_id: string | null }[]) {
    try {
      const r = await checkApprovals(db, c);
      results.push(r);

      if (r.newlyDeclined.length) {
        const lines = r.newlyDeclined.map((d) =>
          `• Slot ${d.slot}${d.by ? ` — declined by ${d.by}` : ""}` +
          (d.reason ? `\n  "${d.reason}"` : "\n  No reason given.")
        );

        await notify({
          subject: `${c.name}: ${r.newlyDeclined.length} post${r.newlyDeclined.length === 1 ? "" : "s"} declined`,
          body: [
            `${c.name} declined ${r.newlyDeclined.length} scheduled post${r.newlyDeclined.length === 1 ? "" : "s"} in PostFlow.`,
            "",
            ...lines,
            "",
            // The reason is the useful half, and it is why this alert exists at
            // all rather than a status column someone might check.
            `Fix them on the client's Social tab: /dashboard/${c.id}/social`,
          ].join("\n"),
        });

        await db.from("content_plan_items")
          .update({ decline_notified_at: new Date().toISOString() })
          .in("slot", r.newlyDeclined.map((d) => d.slot));
      }
    } catch (e) {
      results.push({ client: c.name, error: (e as Error).message.slice(0, 250) });
    }
  }

  return NextResponse.json({ ok: true, results });
}
