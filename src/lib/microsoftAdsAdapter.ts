// lib/microsoftAdsAdapter.ts — Microsoft/Bing Ads execution adapter
// (WO-006 stream D). Same shape and scope as lib/metaAdsAdapter.ts — see
// that file's header for the full rationale (dry-run-first, low-risk-only in
// v1, undo/revert not wired yet). Credentials are the same MicrosoftAdsAuth
// bundle lib/microsoftAdsCollector.ts already resolves and parses from the
// vaulted JSON bundle. Modeled as a single authenticated REST request, same
// synchronous simplification lib/microsoftAds.ts uses for the real
// SOAP/bulk campaign-management surface.
import { mockApis } from "@/lib/apiMock";
import type { MicrosoftAdsAuth } from "@/lib/microsoftAds";

const CAMPAIGN_BASE = "https://campaign.api.bingads.microsoft.com/CampaignManagement/v13";

export type CampaignStatus = "active" | "paused" | "removed";

export type PublishResult = {
  ok: boolean;
  dryRun: boolean;
  before: string;
  after: string;
  detail?: string;
};

interface CampaignUpdateErrorBody {
  Errors?: { Message?: string }[];
}

async function updateCampaign(
  auth: MicrosoftAdsAuth,
  accountId: string,
  campaignId: string,
  fields: Record<string, unknown>
): Promise<void> {
  if (mockApis()) return;

  const res = await fetch(`${CAMPAIGN_BASE}/Campaigns`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.accessToken}`,
      DeveloperToken: auth.developerToken,
      CustomerId: auth.customerId,
      CustomerAccountId: accountId,
    },
    body: JSON.stringify({ AccountId: accountId, Campaigns: [{ Id: campaignId, ...fields }] }),
  });

  if (!res.ok) throw new Error(`Microsoft Ads campaign update failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as CampaignUpdateErrorBody;
  if (body.Errors?.length) {
    throw new Error(`Microsoft Ads campaign update refused: ${body.Errors.map((e) => e.Message).join("; ")}`);
  }
}

async function setStatus(
  auth: MicrosoftAdsAuth,
  accountId: string,
  campaignId: string,
  current: CampaignStatus,
  target: "active" | "paused",
  opts: { dryRun?: boolean } = {}
): Promise<PublishResult> {
  const dryRun = opts.dryRun ?? true;
  if (dryRun) {
    return { ok: true, dryRun: true, before: current, after: target, detail: `dry run — nothing written to Microsoft Ads (campaign ${campaignId})` };
  }
  await updateCampaign(auth, accountId, campaignId, { Status: target === "active" ? "Active" : "Paused" });
  return { ok: true, dryRun: false, before: current, after: target };
}

export async function pause(
  auth: MicrosoftAdsAuth,
  accountId: string,
  campaignId: string,
  current: CampaignStatus,
  opts: { dryRun?: boolean } = {}
): Promise<PublishResult> {
  return setStatus(auth, accountId, campaignId, current, "paused", opts);
}

export async function resume(
  auth: MicrosoftAdsAuth,
  accountId: string,
  campaignId: string,
  current: CampaignStatus,
  opts: { dryRun?: boolean } = {}
): Promise<PublishResult> {
  return setStatus(auth, accountId, campaignId, current, "active", opts);
}

// Microsoft's DailyBudget is already in account currency (no micros
// conversion, unlike Google Ads) — see lib/microsoftAds.ts's fetchCampaigns.
export async function updateBudget(
  auth: MicrosoftAdsAuth,
  accountId: string,
  campaignId: string,
  currentDailyBudget: number,
  proposedDailyBudget: number,
  opts: { dryRun?: boolean } = {}
): Promise<PublishResult> {
  const dryRun = opts.dryRun ?? true;
  const before = currentDailyBudget.toFixed(2);
  const after = proposedDailyBudget.toFixed(2);
  if (dryRun) {
    return { ok: true, dryRun: true, before, after, detail: `dry run — nothing written to Microsoft Ads (campaign ${campaignId})` };
  }
  await updateCampaign(auth, accountId, campaignId, { DailyBudget: proposedDailyBudget.toFixed(2) });
  return { ok: true, dryRun: false, before, after };
}

export interface NewCampaignSpec {
  name: string;
  campaignType: string;
  dailyBudget: number;
}

export async function createCampaign(
  auth: MicrosoftAdsAuth,
  accountId: string,
  spec: NewCampaignSpec,
  opts: { dryRun?: boolean } = {}
): Promise<PublishResult & { campaignId: string | null }> {
  const dryRun = opts.dryRun ?? true;
  const after = `"${spec.name}" — paused, $${spec.dailyBudget.toFixed(2)}/day`;
  if (dryRun) {
    return { ok: true, dryRun: true, before: "(new campaign)", after, detail: "dry run — nothing created on Microsoft Ads", campaignId: null };
  }
  if (mockApis()) return { ok: true, dryRun: false, before: "(new campaign)", after, campaignId: "mock-microsoft-campaign-id" };

  const res = await fetch(`${CAMPAIGN_BASE}/Campaigns`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.accessToken}`,
      DeveloperToken: auth.developerToken,
      CustomerId: auth.customerId,
      CustomerAccountId: accountId,
    },
    body: JSON.stringify({
      AccountId: accountId,
      Campaigns: [
        {
          Name: spec.name,
          CampaignType: spec.campaignType,
          Status: "Paused", // ALWAYS created paused — confirmed default, no exceptions
          DailyBudget: spec.dailyBudget.toFixed(2),
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Microsoft Ads campaign create failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { CampaignIds?: (string | number)[] } & CampaignUpdateErrorBody;
  if (body.Errors?.length) {
    throw new Error(`Microsoft Ads campaign create refused: ${body.Errors.map((e) => e.Message).join("; ")}`);
  }

  const campaignId = body.CampaignIds?.[0] != null ? String(body.CampaignIds[0]) : null;
  return { ok: true, dryRun: false, before: "(new campaign)", after, campaignId };
}
