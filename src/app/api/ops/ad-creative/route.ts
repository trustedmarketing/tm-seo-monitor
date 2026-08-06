// api/ops/ad-creative — generate, check, and approve paid-ads creative.
//
// WO-006 stream F. Same "owner-only, manual for now" convention as
// api/ops/stage-change and api/ops/stage-ad-action — this is the seam a
// future "generate creative" button on /paid would call automatically.
//
// Three actions:
//   generate  — starts a 4:5 Bloom job ONLY (see lib/adCreative.ts's
//               fan-out gate). Inserts one `creatives` row, generating.
//   check     — polls the Bloom job for one row and writes back its status
//               (mirrors api/content-plan/item's poll pattern).
//   approve   — marks a completed 4:5 row approved, then calls
//               fanOutSizes() and starts a 1:1 and 9:16 job for each size it
//               returns, under the SAME concept_group_id.
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { readSecret } from "@/lib/vault";
import { generateCreative, pollCreative, fanOutSizes, PRIMARY_ASPECT_RATIO } from "@/lib/adCreative";
import { startImage } from "@/lib/bloom";
import { resolvePersonaFields } from "@/lib/personaContext";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const profile = await getProfile();
  if (profile?.role !== "owner") {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }

  const p = new URL(req.url).searchParams;
  const action = p.get("action");
  const db = dbClient();

  try {
    if (action === "generate") {
      const clientId = p.get("client");
      const campaignName = p.get("campaign_name");
      if (!clientId || !campaignName) {
        return NextResponse.json({ error: "need ?action=generate&client=<id>&campaign_name=<name>", optional: "&campaign_id=<campaigns.id>&persona_id=<client_personas.id>&persona_name=&angle=&offer=" }, { status: 400 });
      }

      const { data: client } = await db.from("clients").select("bloom_brand_id").eq("id", clientId).single();
      if (!client?.bloom_brand_id) return NextResponse.json({ error: "no Bloom brand id set for this client — add it in Settings" }, { status: 400 });

      const key = await readSecret(db, "bloom");
      if (!key) return NextResponse.json({ error: "no Bloom API key in vault" }, { status: 400 });

      const { personaName, angle } = await resolvePersonaFields(db, p.get("persona_id"), {
        personaName: p.get("persona_name"), angle: p.get("angle"),
      });
      const brief = { campaignName, personaName, messagingAngle: angle, offer: p.get("offer") };

      const { bloomImageId, prompt } = await generateCreative(key, client.bloom_brand_id, brief, PRIMARY_ASPECT_RATIO);

      const { data: row, error } = await db.from("creatives").insert({
        client_id: clientId,
        campaign_id: p.get("campaign_id") || null,
        persona_id: p.get("persona_id") || null,
        // The primary row's own id doubles as its concept_group_id — set in
        // a second write below once the id exists (insert doesn't know its
        // own generated id ahead of time).
        concept_group_id: "00000000-0000-0000-0000-000000000000",
        aspect_ratio: PRIMARY_ASPECT_RATIO,
        bloom_image_id: bloomImageId,
        status: bloomImageId ? "generating" : "failed",
        prompt,
      }).select("id").single();

      if (error || !row) return NextResponse.json({ ok: false, error: error?.message ?? "insert failed" }, { status: 500 });

      await db.from("creatives").update({ concept_group_id: row.id }).eq("id", row.id);

      return NextResponse.json({ ok: true, id: row.id, aspectRatio: PRIMARY_ASPECT_RATIO, status: bloomImageId ? "generating" : "failed" });
    }

    if (action === "check") {
      const id = p.get("id");
      if (!id) return NextResponse.json({ error: "need ?action=check&id=<creatives.id>" }, { status: 400 });

      const { data: row } = await db.from("creatives").select("id, bloom_image_id, status").eq("id", id).maybeSingle();
      if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
      if (row.status !== "generating" || !row.bloom_image_id) return NextResponse.json({ ok: true, status: row.status });

      const key = await readSecret(db, "bloom");
      if (!key) return NextResponse.json({ error: "no Bloom API key in vault" }, { status: 400 });

      const state = await pollCreative(key, row.bloom_image_id);
      if (state.status === "completed") {
        await db.from("creatives").update({ status: "completed", image_url: state.imageUrl }).eq("id", id);
      } else if (state.status === "failed") {
        await db.from("creatives").update({ status: "failed" }).eq("id", id);
      }
      return NextResponse.json({ ok: true, status: state.status });
    }

    if (action === "approve") {
      const id = p.get("id");
      if (!id) return NextResponse.json({ error: "need ?action=approve&id=<creatives.id>" }, { status: 400 });

      const { data: row } = await db.from("creatives")
        .select("id, client_id, campaign_id, persona_id, concept_group_id, aspect_ratio, status, prompt")
        .eq("id", id).maybeSingle();
      if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
      if (row.status !== "completed") return NextResponse.json({ ok: false, reason: "not_completed", detail: `status is ${row.status}, not completed` });

      const now = new Date().toISOString();
      await db.from("creatives").update({ status: "approved", approved_at: now }).eq("id", id);

      // THE FAN-OUT GATE — only ever non-empty for an approved 4:5 primary.
      const sizes = fanOutSizes(row.aspect_ratio, true);
      if (sizes.length === 0) return NextResponse.json({ ok: true, fannedOut: [] });

      const { data: client } = await db.from("clients").select("bloom_brand_id").eq("id", row.client_id).single();
      if (!client?.bloom_brand_id) return NextResponse.json({ ok: true, fannedOut: [], warning: "approved, but no Bloom brand id to fan out with" });

      const key = await readSecret(db, "bloom");
      if (!key) return NextResponse.json({ ok: true, fannedOut: [], warning: "approved, but no Bloom API key to fan out with" });

      // Reuse the EXACT prompt approved on the 4:5, only swapping the ratio
      // sentence lib/adCreative.ts's adCreativePromptFor appends at the end —
      // same subject/persona/angle/offer that was actually approved, not a
      // fresh brief reconstructed from scratch.
      const created: { aspectRatio: string; id: string }[] = [];
      for (const aspectRatio of sizes) {
        const prompt = (row.prompt ?? "").replace(
          `Aspect ratio ${row.aspect_ratio}.`,
          `Aspect ratio ${aspectRatio}.`
        );
        const bloomImageId = await startImage(key, client.bloom_brand_id, prompt, aspectRatio);
        const { data: sibling } = await db.from("creatives").insert({
          client_id: row.client_id,
          campaign_id: row.campaign_id,
          persona_id: row.persona_id,
          concept_group_id: row.concept_group_id,
          aspect_ratio: aspectRatio,
          bloom_image_id: bloomImageId,
          status: bloomImageId ? "generating" : "failed",
          prompt,
        }).select("id").single();
        if (sibling) created.push({ aspectRatio, id: sibling.id });
      }

      return NextResponse.json({ ok: true, fannedOut: created });
    }

    return NextResponse.json({ error: "action must be generate|check|approve" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message.slice(0, 300) }, { status: 500 });
  }
}
