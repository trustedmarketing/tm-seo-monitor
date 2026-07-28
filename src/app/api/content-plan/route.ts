// api/content-plan — build a month, then approve it.
//
// WO-004. Two actions, deliberately separate:
//
//   build   — generate the plan. Costs nothing, writes only to our own tables,
//             and can be re-run until the plan looks right.
//   approve — draft every caption and push the month to PostFlow as scheduled
//             posts. This is the step that spends money and creates real work,
//             so it is the step behind a decision.
//
// Building being free and re-runnable is the point: a pod lead should be able to
// regenerate a month they do not like without it costing anything or leaving
// half a plan behind.
import { NextResponse } from "next/server";
import { getProfile, isAgency } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { buildPlan } from "@/lib/contentPlanner";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function back(req: Request, clientId: string, msg: string) {
  const url = new URL(`/dashboard/${clientId}/social`, req.url);
  url.searchParams.set("msg", msg);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(req: Request) {
  const profile = await getProfile();
  if (!isAgency(profile)) return NextResponse.json({ error: "Agency access required" }, { status: 403 });

  const form = await req.formData();
  const clientId = String(form.get("client_id") ?? "");
  const action = String(form.get("action") ?? "build");
  if (!clientId) return NextResponse.json({ error: "client_id required" }, { status: 400 });

  const db = dbClient();

  // ── build ──────────────────────────────────────────────────────────────────
  if (action === "build") {
    // Next month, not this one. A plan you are already three weeks into is a
    // report; the point of planning is the month that has not started.
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    let plan;
    try {
      plan = await buildPlan(db, clientId, monthStart);
    } catch (e) {
      return back(req, clientId, `build-failed:${(e as Error).message.slice(0, 80)}`);
    }

    // Replace rather than append. Re-running is expected, and two overlapping
    // plans for one month is worse than no plan at all.
    const { data: existing } = await db
      .from("content_plans").select("id, status")
      .eq("client_id", clientId).eq("month", plan.month).maybeSingle();

    if (existing?.status === "approved") return back(req, clientId, "already-approved");
    if (existing) await db.from("content_plans").delete().eq("id", existing.id);

    const { data: created, error } = await db.from("content_plans").insert({
      client_id: clientId, month: plan.month, status: "draft",
      target_posts: plan.targetPosts, rationale: plan.rationale,
      created_by: profile?.id ?? null,
    }).select("id").single();

    if (error || !created) return back(req, clientId, "build-failed");

    const rows = plan.items.map((i) => ({
      plan_id: created.id, slot: i.slot, scheduled_for: i.scheduledFor,
      platform: i.platform, format: i.format, theme: i.theme,
      brief: i.brief, why: i.why, source_post_id: i.sourcePostId, status: "planned",
    }));
    await db.from("content_plan_items").insert(rows);

    return back(req, clientId, `built:${plan.items.length}`);
  }

  // ── approve ────────────────────────────────────────────────────────────────
  if (action === "approve") {
    const planId = Number(form.get("plan_id"));
    if (!planId) return back(req, clientId, "no-plan");

    const { data: plan } = await db
      .from("content_plans").select("id, status, month").eq("id", planId).maybeSingle();
    if (!plan) return back(req, clientId, "no-plan");
    if (plan.status === "approved") return back(req, clientId, "already-approved");

    // Mark approved first, atomically, so a slow drafting run cannot be
    // approved twice by an impatient second click.
    const { data: claimed } = await db
      .from("content_plans")
      .update({ status: "approving", approved_by: profile?.id ?? null })
      .eq("id", planId).eq("status", "draft").select("id").maybeSingle();

    if (!claimed) return back(req, clientId, "already-approved");

    await writeAudit(
      { action: "publish", targetType: "client", targetId: clientId, clientId,
        detail: `content plan approved for ${plan.month}` },
      profile
    );

    // Drafting happens in the background job rather than inline: a 12-post month
    // is 12 model calls, and holding an HTTP request open for that is how a
    // request times out halfway and leaves a plan in an unclear state.
    return back(req, clientId, "approved");
  }

  return back(req, clientId, "unknown-action");
}
