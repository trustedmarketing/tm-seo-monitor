// lib/ga4.ts — GA4 Data API via a service account (same auth model as lib/gsc.ts).
// Setup (once): reuse the same GCP service account as Search Console, enable the
// Google Analytics Data API, then add the service account's email as a Viewer
// on each client's GA4 property (Admin → Property access management). No OAuth
// flow needed — env GOOGLE_SERVICE_ACCOUNT_JSON (the whole JSON key, single line).

import { JWT } from "google-auth-library";
import { mockApis, readFixture } from "@/lib/apiMock";

export interface DailyConversionRow {
  date: string;
  source: string;
  sessions: number;
  conversions: number;
  revenue: number;
}

function client(): JWT {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON missing");
  const creds = JSON.parse(raw);
  return new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
}

type GA4Row = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };
type GA4RunReportResponse = { rows?: GA4Row[] };

async function runReport(
  propertyId: string,
  body: Record<string, unknown>
): Promise<GA4Row[]> {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`;
  const res = await client().request<GA4RunReportResponse>({ url, method: "POST", data: body });
  return res.data.rows ?? [];
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// GA4's "date" dimension comes back as YYYYMMDD — normalize to YYYY-MM-DD.
function normalizeDate(raw: string): string {
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return raw;
}

function toNumber(v: string | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ── Daily sessions/conversions/revenue by channel, last `days` days ──────
export async function dailyConversions(propertyId: string, days = 28): Promise<DailyConversionRow[]> {
  if (mockApis()) return readFixture<DailyConversionRow[]>("ga4/daily_conversions.json");

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const rows = await runReport(propertyId, {
    dateRanges: [{ startDate: iso(start), endDate: iso(end) }],
    dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }, { name: "conversions" }, { name: "totalRevenue" }],
  });

  return rows.map((r) => ({
    date: normalizeDate(r.dimensionValues?.[0]?.value ?? ""),
    source: r.dimensionValues?.[1]?.value ?? "(not set)",
    sessions: toNumber(r.metricValues?.[0]?.value),
    conversions: toNumber(r.metricValues?.[1]?.value),
    revenue: toNumber(r.metricValues?.[2]?.value),
  })).filter((r) => r.date);
}
