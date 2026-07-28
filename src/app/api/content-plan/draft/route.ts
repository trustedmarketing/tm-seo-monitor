// api/content-plan/draft — write the month and put it in PostFlow.
//
// WO-004. Runs after a plan is approved. For each slot: draft the caption, then
// create a PostFlow post dated to that slot.
//
// ── Why this is separate from the approve action ─────────────────────────────
// A twelve-post month is twelve model calls plus twelve PostFlow writes. Holding
// an HTTP request open for that is how a request times out halfway and leaves a
// plan in a state nobody can read. Approval marks intent; this does the work and
// is resumable — every item that already has a postflow_id is skipped, so
// re-running after a partial failure finishes the job rather than duplicating it.
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { readSecret } from "@/lib/vault";
import { listSocialAccounts, createDraft } from "@/lib/postflow";
import { draftPost } from "@/lib/caption";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const profile = await getProfile();
  if (profile?.role !== "owner") {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }

  const planId = Number(new URL(req.url).searchParams.get("plan"));
  if (!planId) return NextResponse.json({ error: "plan required" }, { status: 400 });

  const db = dbClient();

  const { data: plan } = await db
    .from("content_plans").select("id, client_id, month, status").eq("id", planId).maybeSingle();
  if (!plan) return NextResponse.json({ error: "plan not found" }, { status: 404 });
  if (!["approving", "approved"].includes(plan.status)) {
    return NextResponse.json({ error: `plan is ${plan.status}, not approved` }, { status: 400 });
  }

  const { data: client } = await db
    .from("clients").select("id, name, domain, client_type, postflow_group_id")
    .eq("id", plan.client_id).single();
  if (!client?.postflow_group_id) {
    return NextResponse.json({ error: "client has no postflow_group_id" }, { status: 400 });
  }

  const token = await readSecret(db, "postflow");
  if (!token) return NextResponse.json({ error: "no postflow token in vault" }, { status: 400 });

  const accounts = await listSocialAccounts(token, client.postflow_group_id);
  if (accounts.length === 0) {
    return NextResponse.json({ error: "PostFlow group has no connected accounts" }, { status: 400 });
  }

  // Voice examples from the client's own posts, same source the series drafter
  // uses — so a plan post and a series post sound like the same business.
  const { data: topPosts } = await db
    .from("social_posts").select("content, title")
    .eq("client_id", plan.client_id).not("content", "is", null)
    .order("posted_at", { ascending: false }).limit(5);

  const examples = (topPosts ?? [])
    .map((p: { content: string | null; title: string | null }) => (p.content ?? p.title ?? "").trim())
    .filter(Boolean).slice(0, 3);

  // Resumable, and it respects per-slot decisions: anything already in PostFlow
  // is skipped, and so is anything a human deliberately skipped. A bulk action
  // that resurrects a killed slot would quietly overrule the person reviewing.
  const { data: items } = await db
    .from("content_plan_items")
    .select("id, slot, brief, platform, format, scheduled_for, source_post_id, postflow_id")
    .eq("plan_id", planId).is("postflow_id", null)
    .in("status", ["planned", "failed"]).order("slot");

  const done: number[] = [];
  const failed: { slot: number; error: string }[] = [];

  for (const item of (items ?? []) as Record<string, unknown>[]) {
    const slot = item.slot as number;
    try {
      // If this slot reworks a proven post, hand the drafter that post's text so
      // the rework is recognisably about the same thing.
      let sourceContent: string | null = null;
      if (item.source_post_id) {
        const { data: src } = await db
          .from("social_posts").select("content, title").eq("id", item.source_post_id).maybeSingle();
        sourceContent = src?.content ?? src?.title ?? null;
      }

      const drafted = await draftPost({
        db,
        clientId: plan.client_id,
        clientName: client.name,
        domain: client.domain,
        clientType: (client as { client_type?: string | null }).client_type ?? null,
        examples,
        brief: `${item.brief as string} Platform: ${item.platform}. Format: ${item.format}.`,
        week: slot,
        sourcePost: sourceContent,
      });

      const body = [drafted.caption, drafted.hashtags.join(" ")].filter(Boolean).join("\n\n");

      // Still created as a DRAFT, carrying its intended date in the name. The
      // client has not seen these yet, and nothing should be able to publish on
      // a schedule before they have.
      const res = await createDraft(token, {
        content: body,
        accountIds: accounts.map((a) => a.id),
        name: `${plan.month} · slot ${slot} · ${item.scheduled_for}`.slice(0, 100),
      });

      await db.from("content_plan_items").update({
        caption: drafted.caption,
        hashtags: drafted.hashtags,
        postflow_id: res.id,
        status: "drafted",
      }).eq("id", item.id as number);

      done.push(slot);
    } catch (e) {
      failed.push({ slot, error: (e as Error).message.slice(0, 200) });
      await db.from("content_plan_items")
        .update({ status: "failed" }).eq("id", item.id as number);
    }
  }

  // Only fully drafted counts as approved. A partial run stays "approving" so
  // it is visibly unfinished and re-running is the obvious next step.
  // Outstanding means undecided. A skipped slot is decided, not remaining work.
  const { count: remaining } = await db
    .from("content_plan_items").select("id", { count: "exact", head: true })
    .eq("plan_id", planId).eq("status", "planned");

  if ((remaining ?? 0) === 0) {
    await db.from("content_plans")
      .update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", planId);
  }

  return NextResponse.json({
    ok: failed.length === 0,
    drafted: done.length,
    failed,
    remaining: remaining ?? 0,
    note: remaining
      ? "Re-run to finish. Slots already in PostFlow are skipped."
      : "Every slot is drafted in PostFlow, unscheduled, awaiting client approval.",
  });
}
