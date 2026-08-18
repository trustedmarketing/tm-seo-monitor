// lib/googleAdsAdapter.ts — Google Ads execution adapter (WO-006 stream D).
// Same shape and scope as lib/metaAdsAdapter.ts — see that file's header for
// the full rationale (dry-run-first, low-risk-only in v1, undo/revert not
// wired yet). Credentials are the same GoogleAdsAuth bundle
// lib/googleAdsCollector.ts already resolves (vaulted OAuth + developer
// token, or a per-account override).
import { mockApis } from "@/lib/apiMock";
import { API_VERSION, type GoogleAdsAuth } from "@/lib/googleAds";

const API_BASE = "https://googleads.googleapis.com";

export type CampaignStatus = "active" | "paused" | "removed";

export type PublishResult = {
  ok: boolean;
  dryRun: boolean;
  before: string;
  after: string;
  detail?: string;
};

interface MutateErrorBody {
  error?: { message?: string };
}

async function mutateCampaign(
  auth: GoogleAdsAuth,
  customerId: string,
  campaignId: string,
  fields: Record<string, unknown>,
  updateMask: string
): Promise<void> {
  if (mockApis()) return;

  const res = await fetch(`${API_BASE}/${API_VERSION}/customers/${customerId}/campaigns:mutate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "developer-token": auth.developerToken,
      "login-customer-id": auth.loginCustomerId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      operations: [
        {
          updateMask,
          update: { resourceName: `customers/${customerId}/campaigns/${campaignId}`, ...fields },
        },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Google Ads campaign mutate failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as MutateErrorBody;
  if (body.error) throw new Error(`Google Ads campaign mutate refused: ${body.error.message ?? "unknown error"}`);
}

async function setStatus(
  auth: GoogleAdsAuth,
  customerId: string,
  campaignId: string,
  current: CampaignStatus,
  target: "active" | "paused",
  opts: { dryRun?: boolean } = {}
): Promise<PublishResult> {
  const dryRun = opts.dryRun ?? true;
  if (dryRun) {
    return { ok: true, dryRun: true, before: current, after: target, detail: `dry run — nothing written to Google Ads (campaign ${campaignId})` };
  }
  await mutateCampaign(auth, customerId, campaignId, { status: target === "active" ? "ENABLED" : "PAUSED" }, "status");
  return { ok: true, dryRun: false, before: current, after: target };
}

export async function pause(
  auth: GoogleAdsAuth,
  customerId: string,
  campaignId: string,
  current: CampaignStatus,
  opts: { dryRun?: boolean } = {}
): Promise<PublishResult> {
  return setStatus(auth, customerId, campaignId, current, "paused", opts);
}

export async function resume(
  auth: GoogleAdsAuth,
  customerId: string,
  campaignId: string,
  current: CampaignStatus,
  opts: { dryRun?: boolean } = {}
): Promise<PublishResult> {
  return setStatus(auth, customerId, campaignId, current, "active", opts);
}

/**
 * Budget is a separate resource in Google Ads (CampaignBudget), not a field
 * on the campaign itself — this mutates the campaign_budget resource the
 * campaign already references, at `amount_micros` (see the micros
 * conversion note in lib/googleAds.ts's fetchCampaigns). Verify the
 * campaign_budget resource name lookup against one staging account before
 * trusting this in a live budget-pacing action (accuracy gate).
 */
export async function updateBudget(
  auth: GoogleAdsAuth,
  customerId: string,
  campaignBudgetResourceName: string,
  currentDailyBudget: number,
  proposedDailyBudget: number,
  opts: { dryRun?: boolean } = {}
): Promise<PublishResult> {
  const dryRun = opts.dryRun ?? true;
  const before = currentDailyBudget.toFixed(2);
  const after = proposedDailyBudget.toFixed(2);
  if (dryRun) {
    return { ok: true, dryRun: true, before, after, detail: `dry run — nothing written to Google Ads (${campaignBudgetResourceName})` };
  }

  if (mockApis()) return { ok: true, dryRun: false, before, after };

  const res = await fetch(`${API_BASE}/${API_VERSION}/${campaignBudgetResourceName}:mutate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "developer-token": auth.developerToken,
      "login-customer-id": auth.loginCustomerId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      operation: { updateMask: "amount_micros", update: { amountMicros: String(Math.round(proposedDailyBudget * 1_000_000)) } },
    }),
  });
  if (!res.ok) throw new Error(`Google Ads budget mutate failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as MutateErrorBody;
  if (body.error) throw new Error(`Google Ads budget mutate refused: ${body.error.message ?? "unknown error"}`);
  return { ok: true, dryRun: false, before, after };
}

export interface NewCampaignSpec {
  name: string;
  advertisingChannelType: string;
  dailyBudget: number;
}

export async function createCampaign(
  auth: GoogleAdsAuth,
  customerId: string,
  spec: NewCampaignSpec,
  opts: { dryRun?: boolean } = {}
): Promise<PublishResult & { campaignId: string | null }> {
  const dryRun = opts.dryRun ?? true;
  const after = `"${spec.name}" — paused, $${spec.dailyBudget.toFixed(2)}/day`;
  if (dryRun) {
    return { ok: true, dryRun: true, before: "(new campaign)", after, detail: "dry run — nothing created on Google Ads", campaignId: null };
  }

  if (mockApis()) return { ok: true, dryRun: false, before: "(new campaign)", after, campaignId: "mock-google-campaign-id" };

  // Real Google Ads campaign creation is a two-step mutate (create the
  // CampaignBudget resource, then the Campaign referencing it) inside one
  // atomic request — sketched here at the shape this repo's other adapters
  // use; verify the exact operation sequence against a staging account
  // before enabling this path for real, per the autonomy ladder.
  const res = await fetch(`${API_BASE}/${API_VERSION}/customers/${customerId}/campaigns:mutate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "developer-token": auth.developerToken,
      "login-customer-id": auth.loginCustomerId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      operations: [
        {
          create: {
            name: spec.name,
            advertisingChannelType: spec.advertisingChannelType,
            status: "PAUSED", // ALWAYS created paused — confirmed default, no exceptions
            campaignBudget: { amountMicros: String(Math.round(spec.dailyBudget * 1_000_000)) },
          },
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Google Ads campaign create failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { results?: { resourceName?: string }[] } & MutateErrorBody;
  if (body.error) throw new Error(`Google Ads campaign create refused: ${body.error.message ?? "unknown error"}`);

  const resourceName = body.results?.[0]?.resourceName ?? null;
  const campaignId = resourceName?.split("/").pop() ?? null;
  return { ok: true, dryRun: false, before: "(new campaign)", after, campaignId };
}
