// lib/collectImages.ts — pick up finished Bloom generations.
//
// WO-004. Bloom takes about 90 seconds. Making someone press "Check" after that
// is asking them to do the polling, and Tom's expectation was the right one: an
// image that has finished should simply appear.
//
// So the Social page calls this while rendering whenever a slot is mid-flight,
// and refreshes itself until nothing is. Writing during a render is not
// something to do casually — it is safe here because every update is idempotent
// (a completed image writes the same URL however many times it runs) and because
// the alternative is a button that exists only to work around our own plumbing.
import type { SupabaseClient } from "@supabase/supabase-js";
import { readSecret } from "@/lib/vault";
import { checkImage, findStartedImage } from "@/lib/bloom";

type Row = {
  id: number; bloom_image_id: string | null; image_requested_at: string | null;
  image_prompt: string | null;
};

/** How long a generation may run before we stop waiting on it. */
const STALE_MS = 10 * 60_000;

export async function collectPendingImages(
  db: SupabaseClient,
  clientId: string,
  brandId: string | null
): Promise<number> {
  if (!brandId) return 0;

  // Two plain queries rather than one embedded-filter query.
  //
  // The previous version used PostgREST's `content_plans!inner(client_id)` with
  // `.eq("content_plans.client_id", …)`. Whatever it was doing, it returned
  // nothing — and because the error was never checked, collection reported
  // "0 pending" while a finished image sat waiting. A query that silently finds
  // nothing is indistinguishable from a queue that is genuinely empty, which is
  // the whole reason this took four attempts to find.
  const { data: plans, error: planErr } = await db
    .from("content_plans").select("id").eq("client_id", clientId);

  if (planErr) throw new Error(`could not read plans: ${planErr.message}`);
  const planIds = (plans ?? []).map((p: { id: number }) => p.id);
  if (planIds.length === 0) return 0;

  const { data: pending, error: itemErr } = await db
    .from("content_plan_items")
    .select("id, bloom_image_id, image_requested_at, image_prompt")
    .in("plan_id", planIds)
    .eq("image_status", "generating")
    .limit(12);

  if (itemErr) throw new Error(`could not read pending images: ${itemErr.message}`);

  const rows = (pending ?? []) as Row[];

  const key = await readSecret(db, "bloom");
  if (!key) return 0;

  // Ids already stored on other rows. Without this, a slide collected on an
  // earlier refresh could be claimed again by a different slide on a later one.
  const { data: usedSlides } = await db
    .from("content_plan_slides").select("bloom_image_id").not("bloom_image_id", "is", null);
  const alreadyUsed = new Set(
    (usedSlides ?? []).map((r: { bloom_image_id: string }) => r.bloom_image_id)
  );

  let collected = 0;
  // Ids already assigned in this pass, so two rows cannot claim one generation.
  const taken = new Set<string>(alreadyUsed);

  // NOTE: no early return when `rows` is empty. An earlier version returned here,
  // which meant carousel slides were only ever collected when a post-level image
  // happened to be generating at the same time — so a carousel on its own sat on
  // "Generating…" forever while its artwork sat finished in Bloom.

  for (const row of rows) {
    const requested = row.image_requested_at ? new Date(row.image_requested_at).getTime() : 0;

    // Give up rather than checking forever. A generation that has not landed in
    // ten minutes is not going to, and leaving the slot spinning hides that.
    if (requested && Date.now() - requested > STALE_MS) {
      await db.from("content_plan_items")
        .update({ image_status: "failed", bloom_image_id: null }).eq("id", row.id);
      continue;
    }

    try {
      let imageId = row.bloom_image_id;

      if (!imageId) {
        const found = await findStartedImage(
          key, brandId, new Date(requested || Date.now()), row.image_prompt ?? "", taken
        );
        if (!found) continue;          // still starting; try again next refresh
        imageId = found.id;
        taken.add(found.id);
        await db.from("content_plan_items").update({ bloom_image_id: imageId }).eq("id", row.id);
      }

      const state = await checkImage(key, imageId);

      if (state.status === "completed") {
        // Clear any error from an earlier attempt, so a slot that recovered does
        // not keep showing why it once failed.
        await db.from("content_plan_items").update({
          image_url: state.imageUrl, image_status: "completed",
          bloom_image_id: null, media_id: null, image_error: null,
        }).eq("id", row.id);
        collected++;
      } else if (state.status === "failed") {
        await db.from("content_plan_items")
          .update({ image_status: "failed", bloom_image_id: null }).eq("id", row.id);
      }
    } catch (e) {
      // A hiccup on one slot must not stop the others, but it must not vanish
      // either. Swallowing this is exactly how a finished image sat uncollected
      // with nothing anywhere explaining it.
      await db.from("content_plan_items")
        .update({ image_error: (e as Error).message.slice(0, 300) })
        .eq("id", row.id);
    }
  }

  collected += await collectPendingSlides(db, planIds, key, brandId, taken);
  return collected;
}

/**
 * The same collection, for carousel slides.
 *
 * Separate table, identical problem: a generation that finished has to reach the
 * slide without anyone pressing anything. Kept as its own pass rather than
 * generalised, because the two rows differ in enough columns that a shared
 * version would be mostly branching.
 */
async function collectPendingSlides(
  db: SupabaseClient,
  planIds: number[],
  key: string,
  brandId: string,
  taken: Set<string>
): Promise<number> {
  const { data: items } = await db
    .from("content_plan_items").select("id").in("plan_id", planIds);
  const itemIds = (items ?? []).map((i: { id: number }) => i.id);
  if (itemIds.length === 0) return 0;

  const { data: pending, error } = await db
    .from("content_plan_slides")
    .select("id, bloom_image_id, image_requested_at, image_prompt")
    .in("item_id", itemIds)
    .eq("image_status", "generating")
    .limit(24);

  if (error) throw new Error(`could not read pending slides: ${error.message}`);

  let collected = 0;

  for (const raw of (pending ?? []) as Row[]) {
    const requested = raw.image_requested_at ? new Date(raw.image_requested_at).getTime() : 0;

    if (requested && Date.now() - requested > STALE_MS) {
      await db.from("content_plan_slides")
        .update({ image_status: "failed", bloom_image_id: null }).eq("id", raw.id);
      continue;
    }

    try {
      let imageId = raw.bloom_image_id;
      if (!imageId) {
        const found = await findStartedImage(
          key, brandId, new Date(requested || Date.now()), raw.image_prompt ?? "", taken
        );
        if (!found) continue;
        imageId = found.id;
        taken.add(found.id);
        await db.from("content_plan_slides").update({ bloom_image_id: imageId }).eq("id", raw.id);
      }

      const state = await checkImage(key, imageId);

      if (state.status === "completed") {
        await db.from("content_plan_slides").update({
          image_url: state.imageUrl, image_status: "completed",
          bloom_image_id: null, media_id: null, image_error: null,
        }).eq("id", raw.id);
        collected++;
      } else if (state.status === "failed") {
        await db.from("content_plan_slides")
          .update({ image_status: "failed", bloom_image_id: null }).eq("id", raw.id);
      }
    } catch (e) {
      await db.from("content_plan_slides")
        .update({ image_error: (e as Error).message.slice(0, 300) }).eq("id", raw.id);
    }
  }

  return collected;
}
