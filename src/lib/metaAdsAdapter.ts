// lib/metaAdsAdapter.ts — Meta Ads execution adapter (WO-006 stream D).
//
// Same dry-run-first shape as lib/shopifyAdapter.ts / lib/wordpressAdapter.ts
// (autonomy ladder #1/#2: human-approved in v1, dry-run defaults true).
// Acts on the platform's own campaign id (the `campaign_id` column on the
// `campaigns` registry, WO-006 stream A) via an ad-account access token
// resolved from `ad_platform_accounts.auth_ref`, the same vault path
// metaAdsCollector.ts already uses.
//
// Scope, deliberately narrow to start (spec §7 low-risk tier):
//   pause / resume     — single approval
//   updateBudget       — caller enforces the ±25% band and routes anything
//                        beyond it through the higher-risk approval path;
//                        this adapter just executes what it's told
//   createCampaign     — ALWAYS created paused; never activates (confirmed
//                        default — no agent-initiated live spend, ever)
//
// NOT implemented here: targeting/bid-strategy changes, ad-level actions,
// undo/revert wiring (pause/resume/budget changes are self-reversing via a
// second approval card in v1, so a dedicated revert path isn't wired yet —
// flagged, not silently dropped).
import { mockApis } from "@/lib/apiMock";

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type CampaignStatus = "active" | "paused" | "removed";

export type PublishResult = {
  ok: boolean;
  dryRun: boolean;
  before: string;
  after: string;
  detail?: string;
};

interface GraphErrorBody {
  error?: { message?: string };
}

async function graphPost(path: string, accessToken: string, params: Record<string, string>): Promise<{ id?: string }> {
  if (mockApis()) return { id: "mock-meta-campaign-id" };

  const res = await fetch(`${GRAPH_BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, access_token: accessToken }),
  });
  if (!res.ok) throw new Error(`Meta campaign write failed: ${res.status} ${res.statusText}`);

  const body = (await res.json()) as { id?: string } & GraphErrorBody;
  if (body.error) throw new Error(`Meta campaign write refused: ${body.error.message ?? "unknown error"}`);
  return body;
}

async function setStatus(
  accessToken: string,
  campaignId: string,
  current: CampaignStatus,
  target: "active" | "paused",
  opts: { dryRun?: boolean } = {}
): Promise<PublishResult> {
  const dryRun = opts.dryRun ?? true;
  if (dryRun) {
    return { ok: true, dryRun: true, before: current, after: target, detail: `dry run — nothing written to Meta (campaign ${campaignId})` };
  }
  await graphPost(campaignId, accessToken, { status: target === "active" ? "ACTIVE" : "PAUSED" });
  return { ok: true, dryRun: false, before: current, after: target };
}

export async function pause(
  accessToken: string,
  campaignId: string,
  current: CampaignStatus,
  opts: { dryRun?: boolean } = {}
): Promise<PublishResult> {
  return setStatus(accessToken, campaignId, current, "paused", opts);
}

export async function resume(
  accessToken: string,
  campaignId: string,
  current: CampaignStatus,
  opts: { dryRun?: boolean } = {}
): Promise<PublishResult> {
  return setStatus(accessToken, campaignId, current, "active", opts);
}

/**
 * `currentDailyBudget`/`proposedDailyBudget` are in whole account-currency
 * units (matching the `campaigns.daily_budget` column — see the /100
 * conversion note in lib/meta.ts's fetchCampaigns). Meta's write API wants
 * the minor-unit (cents) value, so the conversion happens here, once, on the
 * way out — verify against one staging account before trusting this in a
 * live budget-pacing action (accuracy gate).
 */
export async function updateBudget(
  accessToken: string,
  campaignId: string,
  currentDailyBudget: number,
  proposedDailyBudget: number,
  opts: { dryRun?: boolean } = {}
): Promise<PublishResult> {
  const dryRun = opts.dryRun ?? true;
  const before = currentDailyBudget.toFixed(2);
  const after = proposedDailyBudget.toFixed(2);
  if (dryRun) {
    return { ok: true, dryRun: true, before, after, detail: `dry run — nothing written to Meta (campaign ${campaignId})` };
  }
  await graphPost(campaignId, accessToken, { daily_budget: String(Math.round(proposedDailyBudget * 100)) });
  return { ok: true, dryRun: false, before, after };
}

export interface NewCampaignSpec {
  name: string;
  objective: string;
  dailyBudget: number;
}

export async function createCampaign(
  accessToken: string,
  adAccountExternalId: string,
  spec: NewCampaignSpec,
  opts: { dryRun?: boolean } = {}
): Promise<PublishResult & { campaignId: string | null }> {
  const dryRun = opts.dryRun ?? true;
  const after = `"${spec.name}" — paused, $${spec.dailyBudget.toFixed(2)}/day`;
  if (dryRun) {
    return { ok: true, dryRun: true, before: "(new campaign)", after, detail: "dry run — nothing created on Meta", campaignId: null };
  }

  // ALWAYS created paused — no agent-initiated live spend, ever (confirmed default).
  const created = await graphPost(`${adAccountExternalId}/campaigns`, accessToken, {
    name: spec.name,
    objective: spec.objective,
    status: "PAUSED",
    daily_budget: String(Math.round(spec.dailyBudget * 100)),
    special_ad_categories: "[]",
  });

  return { ok: true, dryRun: false, before: "(new campaign)", after, campaignId: created.id ?? null };
}
