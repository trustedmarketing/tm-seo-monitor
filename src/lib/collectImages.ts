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

  const { data: pending } = await db
    .from("content_plan_items")
    .select("id, bloom_image_id, image_requested_at, image_prompt, content_plans!inner(client_id)")
    .eq("content_plans.client_id", clientId)
    .eq("image_status", "generating")
    .limit(12);

  const rows = (pending ?? []) as unknown as Row[];
  if (rows.length === 0) return 0;

  const key = await readSecret(db, "bloom");
  if (!key) return 0;

  let collected = 0;

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
          key, brandId, new Date(requested || Date.now()), row.image_prompt ?? ""
        );
        if (!found) continue;          // still starting; try again next refresh
        imageId = found.id;
        await db.from("content_plan_items").update({ bloom_image_id: imageId }).eq("id", row.id);
      }

      const state = await checkImage(key, imageId);

      if (state.status === "completed") {
        await db.from("content_plan_items").update({
          image_url: state.imageUrl, image_status: "completed",
          bloom_image_id: null, media_id: null,
        }).eq("id", row.id);
        collected++;
      } else if (state.status === "failed") {
        await db.from("content_plan_items")
          .update({ image_status: "failed", bloom_image_id: null }).eq("id", row.id);
      }
    } catch {
      // A hiccup on one slot must not stop the others being collected, and the
      // next refresh will try again anyway.
    }
  }

  return collected;
}
