// api/content-plan/item — decide one slot at a time.
//
// WO-004. The month builds as a whole because the format mix and spacing only
// make sense as a whole, but nobody approves twelve briefs as a single yes.
// Reviewing a plan means keeping most of it, killing a couple and rewording one,
// so each slot carries its own decision.
//
// Drafting one slot is a single model call, so it runs inline here rather than
// through the batch job. The batch job still exists for "draft everything left".
import { NextResponse } from "next/server";
import { getProfile, isAgency } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { readSecret } from "@/lib/vault";
import { listSocialAccounts, createDraft } from "@/lib/postflow";
import { draftPost } from "@/lib/caption";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  const itemId = Number(form.get("item_id"));
  const action = String(form.get("action") ?? "");
  if (!clientId || !itemId) return NextResponse.json({ error: "client_id and item_id required" }, { status: 400 });

  const db = dbClient();

  const { data: item } = await db
    .from("content_plan_items")
    .select("id, plan_id, slot, brief, platform, format, scheduled_for, source_post_id, postflow_id, status")
    .eq("id", itemId).maybeSingle();
  if (!item) return back(req, clientId, "item-not-found");

  // ── skip / restore ─────────────────────────────────────────────────────────
  // Skipping is reversible and leaves the row in place. Deleting the slot would
  // lose the brief and the reasoning behind it, which is most of what makes the
  // plan reviewable a second time.
  if (action === "skip" || action === "unskip") {
    await db.from("content_plan_items")
      .update({ status: action === "skip" ? "skipped" : "planned" })
      .eq("id", itemId);
    return back(req, clientId, action === "skip" ? "item-skipped" : "item-restored");
  }

  if (action !== "draft") return back(req, clientId, "unknown-action");
  if (item.postflow_id) return back(req, clientId, "already-drafted");

  // ── draft this one ─────────────────────────────────────────────────────────
  try {
    const { data: client } = await db
      .from("clients").select("id, name, domain, client_type, postflow_group_id")
      .eq("id", clientId).single();
    if (!client?.postflow_group_id) throw new Error("client has no PostFlow group");

    const token = await readSecret(db, "postflow");
    if (!token) throw new Error("no PostFlow token in vault");

    const accounts = await listSocialAccounts(token, client.postflow_group_id);
    if (accounts.length === 0) throw new Error("PostFlow group has no connected accounts");

    // Voice examples, same source as everywhere else so a plan post and a series
    // post sound like the same business.
    const { data: topPosts } = await db
      .from("social_posts").select("content, title")
      .eq("client_id", clientId).not("content", "is", null)
      .order("posted_at", { ascending: false }).limit(5);

    const examples = (topPosts ?? [])
      .map((p: { content: string | null; title: string | null }) => (p.content ?? p.title ?? "").trim())
      .filter(Boolean).slice(0, 3);

    let sourceContent: string | null = null;
    if (item.source_post_id) {
      const { data: src } = await db
        .from("social_posts").select("content, title").eq("id", item.source_post_id).maybeSingle();
      sourceContent = src?.content ?? src?.title ?? null;
    }

    const drafted = await draftPost({
      db,
      clientId,
      clientName: client.name,
      domain: client.domain,
      clientType: (client as { client_type?: string | null }).client_type ?? null,
      examples,
      brief: `${item.brief} Platform: ${item.platform}. Format: ${item.format}.`,
      week: item.slot,
      sourcePost: sourceContent,
    });

    const body = [drafted.caption, drafted.hashtags.join(" ")].filter(Boolean).join("\n\n");

    const res = await createDraft(token, {
      content: body,
      accountIds: accounts.map((a) => a.id),
      name: `slot ${item.slot} · ${item.scheduled_for}`.slice(0, 100),
    });

    await db.from("content_plan_items").update({
      caption: drafted.caption, hashtags: drafted.hashtags,
      postflow_id: res.id, status: "drafted",
    }).eq("id", itemId);

    // The plan is done when nothing is left undecided. Skipped counts as decided:
    // a slot someone deliberately killed is not outstanding work.
    const { count: outstanding } = await db
      .from("content_plan_items").select("id", { count: "exact", head: true })
      .eq("plan_id", item.plan_id).eq("status", "planned");

    if ((outstanding ?? 0) === 0) {
      await db.from("content_plans")
        .update({ status: "approved", approved_at: new Date().toISOString(), approved_by: profile?.id ?? null })
        .eq("id", item.plan_id);
    }

    return back(req, clientId, "item-drafted");
  } catch (e) {
    await db.from("content_plan_items").update({ status: "failed" }).eq("id", itemId);
    return back(req, clientId, `item-failed:${(e as Error).message.slice(0, 70)}`);
  }
}
