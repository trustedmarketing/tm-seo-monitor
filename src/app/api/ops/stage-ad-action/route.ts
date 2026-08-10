// api/ops/stage-ad-action — turn a paid-ads action into an approval card.
//
// WO-006 stream D. Same seam as api/ops/stage-change (Shopify's manual
// staging entry point): owner-only, writes NOTHING to the ad platform — it
// reads the current campaign row and stages the proposal in our database.
// The platform is only touched when a human approves the resulting card
// through the normal /api/approvals path (dry-run there defaults true;
// dryRun:false only happens after approval, same as every other adapter).
//
// Manual for now, same caveat as stage-change: this is the seam the paid
// recommendations engine (WO-006 stream C) or a future "Pause"/"Resume"
// button on /paid would call automatically. Neither exists yet — flagged as
// a follow-up, not silently skipped.
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { readSecret } from "@/lib/vault";
import { generateCreative } from "@/lib/adCreative";
import { generateAdCopy } from "@/lib/adCopy";
import type { AdFormat, AdPlatform } from "@/lib/adCopyLimits";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ADAPTER_OF: Record<string, "meta_ads" | "google_ads" | "microsoft_ads"> = {
  meta: "meta_ads",
  google_ads: "google_ads",
  microsoft: "microsoft_ads",
};

/** Google's PMax and Search RSA need different copy shapes; Microsoft and
 * Meta each have exactly one format in v1 scope. */
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
  const action = p.get("action"); // pause | resume | update_budget | create_campaign
  const platform = p.get("platform"); // meta | google_ads | microsoft

  if (!clientId || !action || !platform || !ADAPTER_OF[platform]) {
    return NextResponse.json({
      error: "need ?client=<id>&platform=meta|google_ads|microsoft&action=pause|resume|update_budget|create_campaign",
      optional_for_update_budget: "&campaign=<platform campaign id>&budget=<new daily budget>",
      optional_for_pause_resume: "&campaign=<platform campaign id>",
      optional_for_create_campaign: "&name=<name>&objective=<objective>&budget=<daily budget>",
    }, { status: 400 });
  }

  const adapter = ADAPTER_OF[platform];
  const db = dbClient();

  try {
    if (action === "create_campaign") {
      const name = p.get("name");
      const objective = p.get("objective");
      const budget = Number(p.get("budget"));
      if (!name || !objective || !Number.isFinite(budget) || budget <= 0) {
        return NextResponse.json({ error: "create_campaign needs &name=&objective=&budget=" }, { status: 400 });
      }

      const sla = new Date();
      sla.setHours(sla.getHours() + 24);

      const { data: row, error } = await db.from("approvals").insert({
        client_id: clientId,
        variant: "ad",
        status: "staged",
        severity: "High", // new campaign launch — higher-risk tier (spec §7)
        title: `New campaign: "${name}" (${platform}, paused, $${budget.toFixed(2)}/day)`,
        why: "test campaign — always created paused; a human activates it separately",
        staged_by: `Manual · ${profile.email}`,
        qc_passed: 1, qc_total: 1,
        requires_role: "pod_lead", // higher-risk tier (spec §7)
        sla_due_at: sla.toISOString(),
        idempotency_key: `stage-ad:${clientId}:${platform}:create:${name}`.slice(0, 200),
        payload: {
          adapter, changeType: "create_campaign", targetGid: "", before: "(new campaign)",
          after: `paused, $${budget.toFixed(2)}/day`,
          campaignSpec: { name, objective, dailyBudget: budget },
        },
      }).select("id").maybeSingle();

      if (error) {
        return NextResponse.json({ ok: false, error: error.message, hint: "a card for this exact campaign may already exist" }, { status: 409 });
      }

      // ── turnkey bundle: creative + copy, tagged with this approval ──────────
      // Best-effort. The campaign card itself is already staged above — a
      // missing Bloom brand id or persona shouldn't block staging a budget
      // decision on an unrelated asset-generation failure.
      const approvalId = row?.id ?? null;
      const bundle: { creative?: string; copy?: string; warning?: string } = {};

      if (approvalId) {
        const brief = {
          campaignName: name,
          personaName: p.get("persona_name"),
          messagingAngle: p.get("angle"),
          offer: p.get("offer"),
        };

        try {
          const { data: client } = await db.from("clients").select("bloom_brand_id").eq("id", clientId).single();
          const bloomKey = client?.bloom_brand_id ? await readSecret(db, "bloom") : null;
          if (client?.bloom_brand_id && bloomKey) {
            const { bloomImageId, prompt } = await generateCreative(bloomKey, client.bloom_brand_id, brief, "4:5");
            const { data: creativeRow } = await db.from("creatives").insert({
              client_id: clientId, approval_id: approvalId, concept_group_id: "00000000-0000-0000-0000-000000000000",
              aspect_ratio: "4:5", bloom_image_id: bloomImageId, status: bloomImageId ? "generating" : "failed", prompt,
            }).select("id").single();
            if (creativeRow) {
              await db.from("creatives").update({ concept_group_id: creativeRow.id }).eq("id", creativeRow.id);
              bundle.creative = creativeRow.id;
            }
          } else {
            bundle.warning = "no Bloom brand id / API key — creative skipped, campaign card still staged";
          }
        } catch (e) {
          bundle.warning = `creative generation failed: ${(e as Error).message.slice(0, 200)}`;
        }

        try {
          const format = formatFor(platform, objective);
          const copy = await generateAdCopy(db, clientId, brief, platform as AdPlatform, format);
          const { data: copyRow } = await db.from("ad_copy_sets").insert({
            client_id: clientId, approval_id: approvalId, platform, format,
            headlines: copy.headlines, long_headlines: copy.longHeadlines ?? null,
            descriptions: copy.descriptions, primary_texts: copy.primaryTexts ?? null,
            business_name: copy.businessName?.text ?? null,
          }).select("id").single();
          if (copyRow) bundle.copy = copyRow.id;
        } catch (e) {
          bundle.warning = [bundle.warning, `copy generation failed: ${(e as Error).message.slice(0, 200)}`].filter(Boolean).join("; ");
        }
      }

      return NextResponse.json({ ok: true, approval_id: approvalId, bundle, next: "/dashboard/approvals" });
    }

    const campaignId = p.get("campaign");
    if (!campaignId) return NextResponse.json({ error: "need &campaign=<platform campaign id>" }, { status: 400 });

    const { data: campaign } = await db
      .from("campaigns")
      .select("id, campaign_name, status, daily_budget")
      .eq("client_id", clientId)
      .eq("platform", platform)
      .eq("campaign_id", campaignId)
      .maybeSingle();

    if (!campaign) return NextResponse.json({ error: `campaign ${campaignId} not found in the campaigns registry` }, { status: 404 });

    if (action === "pause" || action === "resume") {
      if (action === "pause" && campaign.status !== "active") {
        return NextResponse.json({ ok: false, reason: "no_change", detail: `campaign is already ${campaign.status}` });
      }
      if (action === "resume" && campaign.status === "active") {
        return NextResponse.json({ ok: false, reason: "no_change", detail: "campaign is already active" });
      }

      const sla = new Date();
      sla.setHours(sla.getHours() + 24);
      const after = action === "pause" ? "paused" : "active";

      const { data: row, error } = await db.from("approvals").insert({
        client_id: clientId,
        variant: "ad",
        status: "staged",
        severity: "Low", // pause/resume — low-risk, single-approval tier (spec §7)
        title: `${action === "pause" ? "Pause" : "Resume"} "${campaign.campaign_name ?? campaignId}"`,
        staged_by: `Manual · ${profile.email}`,
        qc_passed: 1, qc_total: 1,
        requires_role: "specialist", // low-risk tier (spec §7)
        sla_due_at: sla.toISOString(),
        idempotency_key: `stage-ad:${clientId}:${platform}:${action}:${campaignId}`.slice(0, 200),
        payload: {
          adapter, changeType: action, targetGid: campaignId,
          targetLabel: campaign.campaign_name ?? campaignId,
          before: campaign.status, after,
        },
      }).select("id").maybeSingle();

      if (error) {
        return NextResponse.json({ ok: false, error: error.message, hint: "a card for this exact action may already exist" }, { status: 409 });
      }
      return NextResponse.json({ ok: true, approval_id: row?.id, next: "/dashboard/approvals" });
    }

    if (action === "update_budget") {
      const budget = Number(p.get("budget"));
      if (!Number.isFinite(budget) || budget <= 0) return NextResponse.json({ error: "update_budget needs &budget=<new daily budget>" }, { status: 400 });

      const current = campaign.daily_budget ?? 0;
      if (current > 0 && budget === current) {
        return NextResponse.json({ ok: false, reason: "no_change", detail: "proposed budget equals the current budget" });
      }

      // ±25% is the low-risk band (spec §7); beyond it needs pod_lead + the
      // spend-exposure confirmation modal (ApprovalCard.tsx).
      const band = current > 0 ? Math.abs(budget - current) / current : 1;
      const higherRisk = band > 0.25;

      const sla = new Date();
      sla.setHours(sla.getHours() + 24);

      const { data: row, error } = await db.from("approvals").insert({
        client_id: clientId,
        variant: "ad",
        status: "staged",
        severity: higherRisk ? "High" : "Low",
        title: `Change budget for "${campaign.campaign_name ?? campaignId}": $${current.toFixed(2)} → $${budget.toFixed(2)}/day`,
        staged_by: `Manual · ${profile.email}`,
        qc_passed: 1, qc_total: 1,
        requires_role: higherRisk ? "pod_lead" : "specialist",
        sla_due_at: sla.toISOString(),
        idempotency_key: `stage-ad:${clientId}:${platform}:update_budget:${campaignId}:${budget}`.slice(0, 200),
        payload: {
          adapter, changeType: "update_budget", targetGid: campaignId,
          targetLabel: campaign.campaign_name ?? campaignId,
          before: current.toFixed(2), after: budget.toFixed(2),
        },
      }).select("id").maybeSingle();

      if (error) {
        return NextResponse.json({ ok: false, error: error.message, hint: "a card for this exact change may already exist" }, { status: 409 });
      }
      return NextResponse.json({ ok: true, approval_id: row?.id, higherRisk, next: "/dashboard/approvals" });
    }

    return NextResponse.json({ error: "action must be pause|resume|update_budget|create_campaign" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message.slice(0, 300) }, { status: 500 });
  }
}
