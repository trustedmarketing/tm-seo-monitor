// api/ops/locations — find a DataForSEO location_code without leaving the product.
//
// `clients.location_code` defaults to 2840, the whole United States. For a local
// business competing in one metro that is wrong, and it fails in the worst
// possible way: the rankings still look entirely plausible. A Stuart pilates
// studio "ranking 14th nationally" reads like a real number.
//
// The README has said "look it up with DataForSEO's serp_locations endpoint"
// since day one, and nobody ever has — because it means leaving the product,
// authenticating by hand, and grepping a list with tens of thousands of rows.
// Guidance that is harder to follow than to ignore does not get followed.
//
// Agency-wide rather than owner-only: this is a read against a public reference
// list, not commercial account data.
import { NextResponse } from "next/server";
import { getProfile, isAgency } from "@/lib/supabaseServer";
import { searchLocations } from "@/lib/dataforseo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const profile = await getProfile();
  if (!isAgency(profile)) {
    return NextResponse.json({ error: "Agency access required" }, { status: 403 });
  }

  const q = new URL(req.url).searchParams.get("q");
  if (!q) {
    return NextResponse.json({
      ok: false,
      hint: "Add ?q=<place> — e.g. ?q=stuart, ?q=palm beach, ?q=port st. lucie",
    });
  }

  try {
    const matches = await searchLocations(q);
    return NextResponse.json({
      ok: true,
      query: q,
      matches,
      note:
        "DMA entries are listed first: a service business usually competes across a metro, " +
        "not inside one city boundary. Set the closest single match as the client's " +
        "location_code in /admin, and use service_areas for additional areas.",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message.slice(0, 300) }, { status: 500 });
  }
}
