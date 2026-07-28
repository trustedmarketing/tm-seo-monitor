// api/content-plan/item — build one post, then send it.
//
// WO-004. The month builds as a whole because format mix and spacing only make
// sense as a whole, but nobody approves twelve briefs as a single yes. Each slot
// carries its own decision.
//
// ── Why drafting no longer pushes straight to PostFlow ───────────────────────
// It used to. That was wrong: once a post is in PostFlow, changing it needs an
// update endpoint, and the real workflow is "good image, wrong copy" or "good
// copy, wrong image" — two independent things to fix before anything leaves.
//
// So a slot is now finished HERE and sent as a separate act:
//
//   draft      write the caption (and later the image)
//   regenerate rewrite it, optionally with a steer
//   caption    accept a human rewrite verbatim
//   image      attach a URL, ours or Bloom's
//   send       create the PostFlow draft, once
//
// Sending last also means we never pay to correct something in a vendor's
// system that was easier to fix in ours.
import { NextResponse } from "next/server";
import { getProfile, isAgency } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { readSecret } from "@/lib/vault";
import { listSocialAccounts, createDraft, uploadMediaFromUrl } from "@/lib/postflow";
import { draftPost } from "@/lib/caption";
import { startImage, checkImage, imagePromptFor } from "@/lib/bloom";

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
    .select("id, plan_id, slot, brief, platform, format, scheduled_for, source_post_id, postflow_id, status, caption, hashtags, image_url, bloom_image_id, image_status")
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

  // ── human rewrite ──────────────────────────────────────────────────────────
  // Accepted verbatim. If someone has taken the trouble to rewrite a caption,
  // the last thing they want is it tidied.
  if (action === "caption") {
    const caption = String(form.get("caption") ?? "").trim();
    if (!caption) return back(req, clientId, "empty-caption");
    await db.from("content_plan_items")
      .update({ caption, status: item.status === "planned" ? "drafted" : item.status })
      .eq("id", itemId);
    return back(req, clientId, "caption-saved");
  }

  // ── generate artwork ───────────────────────────────────────────────────────
  // Bloom holds the brand's visual identity, so the prompt describes the SUBJECT
  // and leaves styling to them. A steer is additive, the same as on copy.
  if (action === "generate-image") {
    try {
      const { data: client } = await db
        .from("clients").select("bloom_brand_id, name").eq("id", clientId).single();
      if (!client?.bloom_brand_id) throw new Error("no Bloom brand id set for this client — add it in Settings");

      const key = await readSecret(db, "bloom");
      if (!key) throw new Error("no Bloom key stored — add it under Agency credentials");

      const steerImg = String(form.get("steer") ?? "").trim();
      const prompt = imagePromptFor({
        brief: String(item.brief),
        caption: item.caption ? String(item.caption) : null,
        format: item.format ? String(item.format) : null,
        steer: steerImg || null,
      });

      const imageId = await startImage(key, client.bloom_brand_id, prompt);

      // Record the job and return. Holding the request open for the whole
      // generation blocked the browser and would hit the function timeout.
      await db.from("content_plan_items").update({
        bloom_image_id: imageId,
        image_status: "generating",
        image_requested_at: new Date().toISOString(),
      }).eq("id", itemId);

      return back(req, clientId, "image-started");
    } catch (e) {
      return back(req, clientId, `item-failed:${(e as Error).message.slice(0, 90)}`);
    }
  }

  // ── collect a finished generation ──────────────────────────────────────────
  if (action === "check-image") {
    if (!item.bloom_image_id) return back(req, clientId, "nothing-generating");
    try {
      const key = await readSecret(db, "bloom");
      if (!key) throw new Error("no Bloom key stored");

      const state = await checkImage(key, String(item.bloom_image_id));

      if (state.status === "completed") {
        // Stored, not uploaded. Upload happens at send, so a rejected image
        // never becomes something to clean up in PostFlow.
        await db.from("content_plan_items").update({
          image_url: state.imageUrl, image_status: "completed",
          bloom_image_id: null, media_id: null,
        }).eq("id", itemId);
        return back(req, clientId, "image-ready");
      }

      if (state.status === "failed") {
        await db.from("content_plan_items")
          .update({ image_status: "failed", bloom_image_id: null }).eq("id", itemId);
        return back(req, clientId, `item-failed:${state.reason}`);
      }

      return back(req, clientId, "image-still-generating");
    } catch (e) {
      return back(req, clientId, `item-failed:${(e as Error).message.slice(0, 90)}`);
    }
  }

  // ── attach an image ────────────────────────────────────────────────────────
  if (action === "image") {
    const url = String(form.get("image_url") ?? "").trim();
    if (!url) return back(req, clientId, "empty-image");
    if (!/^https:\/\//i.test(url)) return back(req, clientId, "image-not-https");
    // media_id is cleared: a new image means the old upload no longer applies.
    await db.from("content_plan_items")
      .update({ image_url: url, media_id: null }).eq("id", itemId);
    return back(req, clientId, "image-saved");
  }

  // ── send to PostFlow ───────────────────────────────────────────────────────
  if (action === "send") {
    if (item.postflow_id) return back(req, clientId, "already-sent");
    if (!item.caption) return back(req, clientId, "nothing-to-send");
    try {
      const sent = await sendToPostFlow(db, clientId, item);
      return back(req, clientId, sent ? "sent" : "send-failed");
    } catch (e) {
      return back(req, clientId, `item-failed:${(e as Error).message.slice(0, 70)}`);
    }
  }

  if (action !== "draft" && action !== "regenerate") return back(req, clientId, "unknown-action");
  if (item.postflow_id) return back(req, clientId, "already-sent");

  // ── write (or rewrite) the caption ─────────────────────────────────────────
  // A steer is optional and additive: "shorter", "lead with the anode point",
  // "less salesy". Cheaper than a human rewrite and keeps the voice rules.
  const steer = String(form.get("steer") ?? "").trim();

  try {
    const { data: client } = await db
      .from("clients").select("id, name, domain, client_type, postflow_group_id")
      .eq("id", clientId).single();
    if (!client?.postflow_group_id) throw new Error("client has no PostFlow group");

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
      brief: [
        `${item.brief} Platform: ${item.platform}. Format: ${item.format}.`,
        steer ? `Revision requested: ${steer}` : "",
      ].filter(Boolean).join(" "),
      week: item.slot,
      sourcePost: sourceContent,
      network: item.platform,
      coreHashtags: (client as { hashtag_core?: string[] | null }).hashtag_core ?? [],
    });

    // Stored, not sent. Sending is a separate decision, made once the post is
    // actually finished — copy and artwork both.
    await db.from("content_plan_items").update({
      caption: drafted.caption, hashtags: drafted.hashtags, status: "drafted",
    }).eq("id", itemId);

    return back(req, clientId, steer ? "regenerated" : "item-drafted");
  } catch (e) {
    await db.from("content_plan_items").update({ status: "failed" }).eq("id", itemId);
    return back(req, clientId, `item-failed:${(e as Error).message.slice(0, 70)}`);
  }
}

/**
 * Push a finished slot to PostFlow, once.
 *
 * An image is uploaded via /upload-url-sync when present. That endpoint takes a
 * remote URL, which is exactly the shape Bloom returns — no binary handling on
 * our side. A failed image upload does NOT block the post: text landing without
 * artwork is recoverable, a post that never lands is not.
 */
async function sendToPostFlow(
  db: ReturnType<typeof dbClient>,
  clientId: string,
  item: Record<string, unknown>
): Promise<boolean> {
  const { data: client } = await db
    .from("clients").select("postflow_group_id").eq("id", clientId).single();
  if (!client?.postflow_group_id) throw new Error("client has no PostFlow group");

  const token = await readSecret(db, "postflow");
  if (!token) throw new Error("no PostFlow token in vault");

  const accounts = await listSocialAccounts(token, client.postflow_group_id);
  if (accounts.length === 0) throw new Error("PostFlow group has no connected accounts");

  let mediaIds: string[] = [];
  let mediaNote = "";
  if (item.image_url) {
    try {
      const media = await uploadMediaFromUrl(token, String(item.image_url));
      if (media.id) {
        mediaIds = [media.id];
        await db.from("content_plan_items").update({ media_id: media.id }).eq("id", item.id as number);
      }
    } catch (e) {
      mediaNote = ` (image failed: ${(e as Error).message.slice(0, 80)})`;
    }
  }

  const hashtags = Array.isArray(item.hashtags) ? (item.hashtags as string[]) : [];
  const body = [String(item.caption ?? ""), hashtags.join(" ")].filter(Boolean).join("\n\n");

  const res = await createDraft(token, {
    content: body,
    accountIds: accounts.map((a) => a.id),
    name: `slot ${item.slot} · ${item.scheduled_for}`.slice(0, 100),
    mediaIds: mediaIds.length ? mediaIds : undefined,
  });

  await db.from("content_plan_items").update({
    postflow_id: res.id, status: "sent",
  }).eq("id", item.id as number);

  if (mediaNote) throw new Error(`Post sent without its image${mediaNote}`);
  return true;
}
