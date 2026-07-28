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
import { draftPost, slidesFromCaption } from "@/lib/caption";
import { startImage, checkImage, findStartedImage, imagePromptFor, normaliseImageUrl } from "@/lib/bloom";
import { aspectFor, normaliseNetwork, requiresMedia } from "@/lib/platformPlaybook";

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
    .select("id, plan_id, slot, brief, platform, format, scheduled_for, source_post_id, postflow_id, status, caption, hashtags, headline, image_url, bloom_image_id, image_status, image_requested_at, image_prompt")
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
      // The same ratio the card shows, so the promise and the request match.
      const ratio = aspectFor(
        item.platform ? String(item.platform) : null,
        item.format ? String(item.format) : null
      );

      const prompt = imagePromptFor({
        brief: String(item.brief),
        caption: item.caption ? String(item.caption) : null,
        format: item.format ? String(item.format) : null,
        headline: item.headline ? String(item.headline) : null,
        aspectRatio: ratio,
        steer: steerImg || null,
      });

      // Record the attempt BEFORE the call. If Bloom errors, the slot still shows
      // that something was tried and why it stopped, rather than looking as
      // though the button did nothing — which is exactly how this failed twice.
      await db.from("content_plan_items").update({
        image_status: "generating",
        image_prompt: prompt,
        image_requested_at: new Date().toISOString(),
      }).eq("id", itemId);

      let imageId: string | null = null;
      try {
        imageId = await startImage(key, client.bloom_brand_id, prompt, ratio);
      } catch (e) {
        await db.from("content_plan_items")
          .update({ image_status: "failed" }).eq("id", itemId);
        throw e;
      }

      if (imageId) {
        await db.from("content_plan_items").update({ bloom_image_id: imageId }).eq("id", itemId);
      }

      return back(req, clientId, "image-started");
    } catch (e) {
      return back(req, clientId, `item-failed:${(e as Error).message.slice(0, 90)}`);
    }
  }

  // ── build slides from copy that already exists ─────────────────────────────
  // Deliberately not a rewrite. A carousel drafted before slides existed has
  // good copy and no slides, and forcing a redraft to get them would discard
  // whatever a human had edited.
  if (action === "make-slides") {
    if (!item.caption) return back(req, clientId, "nothing-to-send");
    try {
      const slides = await slidesFromCaption({
        db, clientId,
        caption: String(item.caption),
        headline: item.headline ? String(item.headline) : null,
      });

      if (slides.length === 0) throw new Error("no slides could be derived from this copy");

      await db.from("content_plan_slides").delete().eq("item_id", itemId);
      await db.from("content_plan_slides").insert(
        slides.map((sl, idx) => ({
          item_id: itemId, position: idx,
          headline: sl.headline, body: sl.body || null, shot: sl.shot || null,
        }))
      );

      return back(req, clientId, "slides-made");
    } catch (e) {
      await db.from("content_plan_items")
        .update({ send_error: (e as Error).message.slice(0, 500) }).eq("id", itemId);
      return back(req, clientId, "send-problem");
    }
  }

  // ── generate one slide's artwork ───────────────────────────────────────────
  // Separate from the post-level generate because a carousel slide has its own
  // headline and its own subject: "slide 4 is wrong" must be fixable without
  // regenerating five images that were fine.
  if (action === "generate-slide") {
    const slideId = Number(form.get("slide_id"));
    if (!slideId) return back(req, clientId, "unknown-action");

    try {
      const { data: slide } = await db
        .from("content_plan_slides").select("id, position, headline, body, shot").eq("id", slideId).maybeSingle();
      if (!slide) return back(req, clientId, "item-not-found");

      const { data: client } = await db
        .from("clients").select("bloom_brand_id").eq("id", clientId).single();
      if (!client?.bloom_brand_id) throw new Error("no Bloom brand id set for this client");

      const key = await readSecret(db, "bloom");
      if (!key) throw new Error("no Bloom key stored");

      const ratio = aspectFor(
        item.platform ? String(item.platform) : null,
        item.format ? String(item.format) : null
      );

      const prompt = imagePromptFor({
        brief: `${slide.body || slide.headline}`,
        caption: null,
        format: "carousel",
        headline: slide.headline,
        aspectRatio: ratio,
        shot: slide.shot,
        // Only the cover gets the hero framing. Applying it to every slide is
        // what produced six photographs of the same shoes on the same box.
        isCover: slide.position === 0,
        steer: String(form.get("steer") ?? "").trim() || null,
      });

      await db.from("content_plan_slides").update({
        image_status: "generating", image_prompt: prompt,
        image_requested_at: new Date().toISOString(), image_error: null,
      }).eq("id", slideId);

      const imageId = await startImage(key, client.bloom_brand_id, prompt, ratio);
      if (imageId) {
        await db.from("content_plan_slides").update({ bloom_image_id: imageId }).eq("id", slideId);
      }

      return back(req, clientId, "image-started");
    } catch (e) {
      await db.from("content_plan_slides")
        .update({ image_status: "failed", image_error: (e as Error).message.slice(0, 300) })
        .eq("id", slideId);
      return back(req, clientId, "send-problem");
    }
  }

  // ── attach a slide image by URL ────────────────────────────────────────────
  if (action === "slide-image") {
    const slideId = Number(form.get("slide_id"));
    const url = normaliseImageUrl(String(form.get("image_url") ?? ""));
    if (!slideId || !url) return back(req, clientId, "empty-image");
    if (!/^https:\/\//i.test(url)) return back(req, clientId, "image-not-https");

    await db.from("content_plan_slides").update({
      image_url: url, image_status: "completed",
      bloom_image_id: null, media_id: null, image_error: null,
    }).eq("id", slideId);
    return back(req, clientId, "image-saved");
  }

  // ── collect a finished generation ──────────────────────────────────────────
  if (action === "check-image") {
    if (item.image_status !== "generating") return back(req, clientId, "nothing-generating");
    try {
      const key = await readSecret(db, "bloom");
      if (!key) throw new Error("no Bloom key stored");

      // Without an id, find the generation by brand, time and prompt. Two slots
      // generating at once cannot collect each other's artwork this way.
      let imageId = item.bloom_image_id ? String(item.bloom_image_id) : null;
      if (!imageId) {
        const { data: c } = await db
          .from("clients").select("bloom_brand_id").eq("id", clientId).single();
        const found = c?.bloom_brand_id
          ? await findStartedImage(
              key, c.bloom_brand_id,
              new Date(String(item.image_requested_at ?? Date.now())),
              String(item.image_prompt ?? "")
            )
          : null;

        if (!found) return back(req, clientId, "image-still-generating");
        imageId = found.id;
        await db.from("content_plan_items").update({ bloom_image_id: imageId }).eq("id", itemId);
      }

      const state = await checkImage(key, imageId);

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

  // ── edit the artwork headline ──────────────────────────────────────────────
  if (action === "headline") {
    const headline = String(form.get("headline") ?? "").trim().split(/\s+/).slice(0, 4).join(" ");
    if (!headline) return back(req, clientId, "empty-headline");
    await db.from("content_plan_items").update({ headline }).eq("id", itemId);
    return back(req, clientId, "headline-saved");
  }

  // ── attach an image ────────────────────────────────────────────────────────
  if (action === "image") {
    // Bloom's share link (/i/{id}) is a viewer page, not an image. It is what
    // their UI gives you to copy, so converting it here is the fix — the
    // alternative is a slot that renders nothing and explains nothing.
    const url = normaliseImageUrl(String(form.get("image_url") ?? ""));
    if (!url) return back(req, clientId, "empty-image");
    if (!/^https:\/\//i.test(url)) return back(req, clientId, "image-not-https");
    // Also ends any generation in flight. Someone pasting their own image has
    // decided; leaving the slot "generating" alongside it would let a late
    // arrival overwrite the choice they just made.
    await db.from("content_plan_items").update({
      image_url: url, media_id: null,
      image_status: "completed", bloom_image_id: null, image_error: null,
    }).eq("id", itemId);
    return back(req, clientId, "image-saved");
  }

  // ── send to PostFlow ───────────────────────────────────────────────────────
  if (action === "send") {
    if (item.postflow_id) return back(req, clientId, "already-sent");
    if (!item.caption) return back(req, clientId, "nothing-to-send");

    // Instagram will not accept a post without media, and TikTok needs video.
    // Sending anyway produces a draft nobody can publish, which is worse than
    // not sending: it looks done in our queue and is broken in theirs.
    // For a carousel the slides are the media, so the post-level image is not
    // what decides whether it can ship.
    const isCarousel = String(item.format ?? "").toLowerCase() === "carousel";
    if (!isCarousel && !item.image_url && requiresMedia(item.platform ? String(item.platform) : null)) {
      return back(req, clientId, "needs-image");
    }
    try {
      await sendToPostFlow(db, clientId, item);
      await db.from("content_plan_items").update({ send_error: null }).eq("id", itemId);
      return back(req, clientId, "sent");
    } catch (e) {
      // Stored in full rather than squeezed through a URL parameter. The
      // 70-character slice here turned "PostFlow media upload failed 500: {…}"
      // into a message that named the failure and none of its cause.
      await db.from("content_plan_items")
        .update({ send_error: (e as Error).message.slice(0, 1000) }).eq("id", itemId);
      return back(req, clientId, "send-problem");
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
      caption: drafted.caption, hashtags: drafted.hashtags,
      headline: drafted.headline, status: "drafted",
    }).eq("id", itemId);

    // Slides are replaced wholesale on a redraft. Keeping old ones would leave
    // artwork attached to points the new copy no longer makes.
    if (drafted.slides.length > 0) {
      await db.from("content_plan_slides").delete().eq("item_id", itemId);
      await db.from("content_plan_slides").insert(
        drafted.slides.map((sl, idx) => ({
          item_id: itemId,
          position: idx,
          headline: sl.headline,
          body: sl.body || null,
          shot: sl.shot || null,
        }))
      );
    }

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

  const all = await listSocialAccounts(token, client.postflow_group_id);
  if (all.length === 0) throw new Error("PostFlow group has no connected accounts");

  // Target ONLY the network this slot was planned for. Sending to every account
  // in the group put an Instagram carousel in front of TikTok, which then
  // demanded a video the post was never going to have. The plan already decided
  // the platform; the send has to honour it.
  const want = item.platform ? normaliseNetwork(String(item.platform)) : null;
  const accounts = want
    ? all.filter((a) => a.network && normaliseNetwork(a.network) === want)
    : all;

  if (accounts.length === 0) {
    throw new Error(
      `No ${want} account is connected to this PostFlow group. ` +
      `Connected: ${all.map((a) => a.network).filter(Boolean).join(", ") || "none"}.`
    );
  }

  // A carousel's slides ARE its media, in order. Everything else has one image.
  const { data: slideRows } = await db
    .from("content_plan_slides")
    .select("id, position, image_url, media_id")
    .eq("item_id", item.id as number)
    .order("position");

  const slides = (slideRows ?? []) as { id: number; position: number; image_url: string | null; media_id: string | null }[];

  let mediaIds: string[] = [];
  let mediaNote = "";

  const sources = slides.length
    ? slides.map((sl) => ({ url: sl.image_url, slideId: sl.id, position: sl.position }))
    : [{ url: (item.image_url as string) ?? null, slideId: null as number | null, position: 0 }];

  // A carousel missing a slide in the MIDDLE would publish in the wrong order,
  // so a gap stops the upload rather than silently shifting everything up.
  const missing = sources.filter((s) => !s.url).map((s) => s.position + 1);
  if (slides.length && missing.length) {
    throw new Error(`Slides ${missing.join(", ")} have no artwork yet. A carousel cannot ship with gaps.`);
  }

  for (const src of sources) {
    if (!src.url) continue;
    try {
      const media = await uploadMediaFromUrl(token, src.url);
      if (media.id) {
        mediaIds.push(media.id);
        if (src.slideId) {
          await db.from("content_plan_slides").update({ media_id: media.id }).eq("id", src.slideId);
        } else {
          await db.from("content_plan_items").update({ media_id: media.id }).eq("id", item.id as number);
        }
      }
    } catch (e) {
      mediaNote = `slide ${src.position + 1}: ${(e as Error).message.slice(0, 200)}`;
      break;   // stop rather than send a partial carousel
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

  // The post landed, so the slot is correctly marked sent — but a post that
  // shipped without its artwork is not a success, and saying nothing is how
  // twelve of them reach PostFlow bare before anyone notices.
  if (mediaNote) throw new Error(`Sent, but WITHOUT the image: ${mediaNote}`);
  return true;
}
