// api/ops/ad-copy — generate ad copy for an EXISTING campaign.
//
// WO-006 stream I. Same "owner-only, manual for now" convention as
// api/ops/ad-creative and api/ops/stage-ad-action. The create_campaign
// bundle in stage-ad-action generates copy automatically for a NEW
// campaign; this route is the on-demand path for a campaign that already
// exists — a copy refresh, or generating copy for a campaign that predates
// this feature.
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { generateAdCopy } from "@/lib/adCopy";
import type { AdFormat, AdPlatform } from "@/lib/adCopyLimits";
import { resolvePersonaFields } from "@/lib/personaContext";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function formatFor(platform: string, objective: string): AdFormat {
  if (platform === "meta") return "meta_feed";
  if (platform === "google_ads" && /performance.?max|pmax/i.test(objective)) return "pmax";
  return "rsa";
}

export async function GET(req: Request) {
  const profile = await getProfile();
  if (profile?.role !== "owner") {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }

  const p = new URL(req.url).searchParams;
  const clientId = p.get("client");
  // Two ways to name the campaign: the internal `campaigns.id` (what a form's
  // <select> submits — one field names both the campaign and its platform),
  // or platform+the platform's own campaign id (for typed/scripted calls,
  // matching stage-ad-action's convention).
  const campaignRef = p.get("campaign_ref");
  const platformParam = p.get("platform");
  const campaignIdParam = p.get("campaign");

  if (!clientId || (!campaignRef && (!platformParam || !campaignIdParam))) {
    return NextResponse.json({
      error: "need ?client=<id> and either &campaign_ref=<campaigns.id> or &platform=meta|google_ads|microsoft&campaign=<platform campaign id>",
      optional: "&persona_id=<client_personas.id> (or &persona_name=&angle=)&offer=&format=rsa|pmax|meta_feed (overrides the platform/objective default)",
    }, { status: 400 });
  }

  const db = dbClient();

  try {
    const query = db.from("campaigns").select("id, platform, campaign_id, campaign_name, objective").eq("client_id", clientId);
    const { data: campaign } = campaignRef
      ? await query.eq("id", campaignRef).maybeSingle()
      : await query.eq("platform", platformParam!).eq("campaign_id", campaignIdParam!).maybeSingle();

    if (!campaign) return NextResponse.json({ error: `campaign not found in the campaigns registry` }, { status: 404 });

    const platform = campaign.platform;
    const format = (p.get("format") as AdFormat | null) ?? formatFor(platform, campaign.objective ?? "");
    const { personaName, angle } = await resolvePersonaFields(db, p.get("persona_id"), {
      personaName: p.get("persona_name"), angle: p.get("angle"),
    });
    const brief = { campaignName: campaign.campaign_name ?? campaign.campaign_id, personaName, messagingAngle: angle, offer: p.get("offer") };

    const copy = await generateAdCopy(db, clientId, brief, platform as AdPlatform, format);

    const { data: row, error } = await db.from("ad_copy_sets").insert({
      client_id: clientId, campaign_id: campaign.id, platform, format,
      headlines: copy.headlines, long_headlines: copy.longHeadlines ?? null,
      descriptions: copy.descriptions, primary_texts: copy.primaryTexts ?? null,
      business_name: copy.businessName?.text ?? null,
    }).select("id").single();

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, id: row?.id, format, next: `/dashboard/${clientId}/paid/creative` });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message.slice(0, 300) }, { status: 500 });
  }
}
