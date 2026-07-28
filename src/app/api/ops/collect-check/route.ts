// api/ops/collect-check — why did collection not pick that image up?
//
// WO-004 Stream N. Built after guessing at this three times. Collection has
// several steps that can each quietly produce nothing, and from outside they all
// look identical: a slot that stays on "Generating…".
//
// This runs the same steps and reports what each one SAW, rather than whether it
// succeeded. Owner-only.
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { readSecret } from "@/lib/vault";
import { listImages } from "@/lib/bloom";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function GET(req: Request) {
  const profile = await getProfile();
  if (profile?.role !== "owner") {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }

  const clientId = new URL(req.url).searchParams.get("client");
  if (!clientId) return NextResponse.json({ error: "client required" }, { status: 400 });

  const db = dbClient();
  const out: Record<string, unknown> = {};

  const { data: client } = await db
    .from("clients").select("name, bloom_brand_id").eq("id", clientId).maybeSingle();
  out.client = client?.name ?? null;
  out.brand_id = client?.bloom_brand_id ?? null;
  if (!client?.bloom_brand_id) return NextResponse.json({ ok: false, failed_at: "no_brand", ...out });

  // Step 1 — can we even see the pending rows?
  const { data: plans, error: planErr } = await db
    .from("content_plans").select("id").eq("client_id", clientId);
  out.plans_found = plans?.length ?? 0;
  out.plans_error = planErr?.message ?? null;

  const planIds = (plans ?? []).map((p: { id: number }) => p.id);
  const { data: pending, error: itemErr } = planIds.length
    ? await db.from("content_plan_items")
        .select("id, slot, image_requested_at, image_prompt")
        .in("plan_id", planIds).eq("image_status", "generating")
    : { data: [], error: null };

  out.pending_error = itemErr?.message ?? null;
  out.pending = (pending ?? []).map((p: Record<string, unknown>) => ({
    slot: p.slot,
    requested_at: p.image_requested_at,
    prompt_head: String(p.image_prompt ?? "").slice(0, 80),
  }));

  // Step 2 — what does Bloom actually return, and does anything match?
  const key = await readSecret(db, "bloom");
  if (!key) return NextResponse.json({ ok: false, failed_at: "no_key", ...out });

  try {
    const images = await listImages(key, client.bloom_brand_id, 10);
    out.images_seen = images.length;
    out.images = images.slice(0, 5).map((i) => ({
      id: i.id, status: i.status, created_at: i.createdAt,
      brand_matches: i.brandId === client.bloom_brand_id,
      prompt_head: (i.prompt ?? "").slice(0, 80),
    }));

    // Step 3 — the comparison itself, spelled out per pending row.
    out.match_attempts = (pending ?? []).map((p: Record<string, unknown>) => {
      const since = new Date(String(p.image_requested_at ?? 0)).getTime() - 60_000;
      const head = String(p.image_prompt ?? "").slice(0, 80);
      const candidates = images.map((i) => ({
        id: i.id,
        new_enough: (i.createdAt ? new Date(i.createdAt).getTime() : 0) >= since,
        prompt_matches: !i.prompt || i.prompt.slice(0, 80) === head,
      }));
      return {
        slot: p.slot,
        matched: candidates.find((c) => c.new_enough && c.prompt_matches)?.id ?? null,
        candidates,
      };
    });

    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return NextResponse.json({
      ok: false, failed_at: "list_images", error: (e as Error).message.slice(0, 400), ...out,
    }, { status: 500 });
  }
}
