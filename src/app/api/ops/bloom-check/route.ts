// api/ops/bloom-check — is the key good, and which brands are usable?
//
// WO-004 Stream N. Bloom refuses generation for a brand that is not `ready`
// (409 BRAND_NOT_READY), so "the key works" and "this client can generate" are
// different questions. Both get answered here rather than at the point of use.
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { readSecret } from "@/lib/vault";
import { listBrands } from "@/lib/bloom";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function GET() {
  const profile = await getProfile();
  if (profile?.role !== "owner") {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }

  const db = dbClient();
  const key = await readSecret(db, "bloom");

  const out: Record<string, unknown> = { key_present: !!key, key_length: key?.length ?? 0 };
  if (!key) {
    return NextResponse.json({
      ok: false, failed_at: "no_key",
      hint: "Add the Bloom developer key under /dashboard/secrets.", ...out,
    });
  }

  try {
    const brands = await listBrands(key);
    out.brands = brands.map((b) => ({ id: b.id, name: b.name, status: b.status }));
    out.ready_brands = brands.filter((b) => b.status === "ready").length;

    // Which clients are wired to which brand, and whether that brand can be used.
    const { data: clients } = await db
      .from("clients").select("name, bloom_brand_id").eq("active", true);

    out.clients = (clients ?? []).map((c: { name: string; bloom_brand_id: string | null }) => {
      const brand = brands.find((b) => b.id === c.bloom_brand_id);
      return {
        client: c.name,
        brand_id: c.bloom_brand_id,
        brand_name: brand?.name ?? null,
        brand_status: brand?.status ?? null,
        // Three states, three fixes: no brand set, brand set but unknown to this
        // key, brand known but not finished setting up in Bloom.
        can_generate: !!brand && brand.status === "ready",
        note: !c.bloom_brand_id
          ? "no brand id set — add it in the client's Settings"
          : !brand
          ? "brand id is not visible to this key — wrong id, or a different Bloom account"
          : brand.status !== "ready"
          ? `brand status is "${brand.status}" — finish its setup in Bloom`
          : null,
      };
    });

    return NextResponse.json({ ok: true, key_accepted: true, ...out });
  } catch (e) {
    return NextResponse.json({
      ok: false, failed_at: "api_error",
      error: (e as Error).message.slice(0, 300), ...out,
    }, { status: 500 });
  }
}
