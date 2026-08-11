// lib/microsoftAds.ts — Microsoft Advertising (Bing Ads) Reporting API client.
// Ad-level performance for the last `days` days. Read-only. Never logs the
// developer token or OAuth access token — matches the "secrets never
// surface" rule (docs/CLAUDE-monitor-draft.md, autonomy #5).
//
// Microsoft Advertising auth is a three-part bundle: a developer token
// (account-level, provisioned once with Microsoft), an OAuth2 access token
// (per-user/per-client, refreshed on expiry), and the target customer id.
// Because that's a bundle rather than a single token, callers pass a single
// `auth` object rather than a bare string (unlike lib/meta.ts's accessToken).
//
// Microsoft's real Reporting API is an async submit → poll → download-CSV
// flow (ReportingService, SOAP or the newer bulk REST surface). We model it
// here as a single authenticated request against Microsoft's REST reporting
// endpoint, matching the synchronous single-call shape lib/meta.ts uses —
// sufficient for this collector's fixture-driven, unit-tested scope.
import { mockApis, readFixture } from "@/lib/apiMock";

const REPORTING_BASE = "https://reporting.api.bingads.microsoft.com/Reporting/v13";
const CAMPAIGN_BASE = "https://campaign.api.bingads.microsoft.com/CampaignManagement/v13";

export interface MicrosoftAdsAuth {
  developerToken: string;
  accessToken: string;
  customerId: string;
}

// Raw shape of one row of Microsoft's AdPerformanceReport (Aggregation=Daily).
export interface MicrosoftAdMetricRawRow {
  TimePeriod: string;
  CampaignId?: string | number;
  CampaignName?: string;
  AdGroupId?: string | number;
  AdId?: string | number;
  Impressions?: string | number;
  Clicks?: string | number;
  Spend?: string | number;
  Conversions?: string | number;
  Revenue?: string | number;
}

// Mapped, DB-ready shape — one row per ad per day, shaped for ad_metrics_daily.
// Microsoft's "ad group" is the closest analog to Meta's adset, so AdGroupId
// maps onto the shared adset_id column.
export interface AdMetricRow {
  date: string;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  ad_id: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue: number;
}

function toNumber(v: string | number | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function toStr(v: string | number | undefined | null): string | null {
  return v === undefined || v === null ? null : String(v);
}

function mapRow(raw: MicrosoftAdMetricRawRow): AdMetricRow {
  return {
    date: raw.TimePeriod,
    campaign_id: toStr(raw.CampaignId),
    campaign_name: raw.CampaignName ?? null,
    adset_id: toStr(raw.AdGroupId),
    ad_id: toStr(raw.AdId),
    impressions: toNumber(raw.Impressions),
    clicks: toNumber(raw.Clicks),
    spend: toNumber(raw.Spend),
    conversions: toNumber(raw.Conversions),
    revenue: toNumber(raw.Revenue),
  };
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Fetch the last `days` days of ad-level performance for `accountId` under
// MicrosoftAdsAuth `auth`. Under MOCK_APIS=1, reads raw report rows from the
// fixture and runs them through the same mapping — so the field derivation is
// exercised even in tests.
export async function fetchAdMetrics(
  auth: MicrosoftAdsAuth,
  accountId: string,
  days = 28
): Promise<AdMetricRow[]> {
  if (mockApis()) {
    const raw = readFixture<MicrosoftAdMetricRawRow[]>("microsoft/ad_metrics.json");
    return raw.map(mapRow);
  }

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const res = await fetch(`${REPORTING_BASE}/AdPerformanceReport`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.accessToken}`,
      DeveloperToken: auth.developerToken,
      CustomerId: auth.customerId,
      CustomerAccountId: accountId,
    },
    body: JSON.stringify({
      ReportTimePeriod: "Custom",
      Time: { CustomDateRangeStart: iso(start), CustomDateRangeEnd: iso(end) },
      Aggregation: "Daily",
      Scope: { AccountIds: [accountId] },
      Columns: [
        "TimePeriod",
        "CampaignId",
        "CampaignName",
        "AdGroupId",
        "AdId",
        "Impressions",
        "Clicks",
        "Spend",
        "Conversions",
        "Revenue",
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Microsoft Ads reporting request failed: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as { rows?: MicrosoftAdMetricRawRow[] };
  return (body.rows ?? []).map(mapRow);
}

// Raw shape of one campaign from Microsoft's Campaign Management surface.
export interface MicrosoftCampaignRawRow {
  Id: string | number;
  Name?: string;
  Status?: string; // Active | Paused | Deleted | Expired | Submitted | ...
  CampaignType?: string;
  DailyBudget?: string | number;
}

// Mapped, DB-ready shape — one row per campaign, for the `campaigns` registry
// (WO-006 stream A), not the ad-performance metrics above.
export interface CampaignRow {
  campaign_id: string;
  campaign_name: string | null;
  status: "active" | "paused" | "removed";
  objective: string | null;
  daily_budget: number | null;
}

function mapCampaignStatus(raw: string | undefined): "active" | "paused" | "removed" {
  if (raw === "Active") return "active";
  if (raw === "Paused") return "paused";
  return "removed"; // Deleted, Expired, Submitted, or unrecognized
}

function mapCampaignRow(raw: MicrosoftCampaignRawRow): CampaignRow {
  return {
    campaign_id: String(raw.Id),
    campaign_name: raw.Name ?? null,
    status: mapCampaignStatus(raw.Status),
    objective: raw.CampaignType ?? null,
    // Microsoft's DailyBudget is already in account currency (no micros
    // conversion, unlike Google Ads above).
    daily_budget: raw.DailyBudget != null ? toNumber(raw.DailyBudget) : null,
  };
}

// Campaign-level status/budget/objective for `accountId`, for the
// `campaigns` registry (not performance metrics). Modeled here as a single
// authenticated request against Microsoft's REST campaign-management
// surface, matching the same synchronous simplification fetchAdMetrics above
// uses for the real SOAP/bulk reporting flow. Under MOCK_APIS=1, reads from
// a fixture.
export async function fetchCampaigns(auth: MicrosoftAdsAuth, accountId: string): Promise<CampaignRow[]> {
  if (mockApis()) {
    const raw = readFixture<MicrosoftCampaignRawRow[]>("microsoft/campaigns.json");
    return raw.map(mapCampaignRow);
  }

  const res = await fetch(`${CAMPAIGN_BASE}/Campaigns/query`, {
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
      Columns: ["Id", "Name", "Status", "CampaignType", "DailyBudget"],
    }),
  });

  if (!res.ok) {
    throw new Error(`Microsoft Ads campaign request failed: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as { Campaigns?: MicrosoftCampaignRawRow[] };
  return (body.Campaigns ?? []).map(mapCampaignRow);
}
