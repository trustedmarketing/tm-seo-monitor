// lib/gsc.ts — Google Search Console via a service account.
// Setup (once): create a GCP service account, enable the Search Console API,
// download its JSON key → env GOOGLE_SERVICE_ACCOUNT_JSON (the whole JSON,
// single line). Then add the service account's email as a Full user on each
// client's Search Console property. No OAuth flow needed.

import { JWT } from "google-auth-library";

function client(): JWT {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON missing");
  const creds = JSON.parse(raw);
  return new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
}

type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };

async function query(property: string, body: Record<string, unknown>): Promise<GscRow[]> {
  const url =
    `https://www.googleapis.com/webmasters/v3/sites/` +
    `${encodeURIComponent(property)}/searchAnalytics/query`;
  const res = await client().request<{ rows?: GscRow[] }>({ url, method: "POST", data: body });
  return res.data.rows ?? [];
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Daily totals, up to 16 months back (GSC's hard limit) ────────
export async function dailyHistory(property: string, months = 16) {
  const end = new Date();
  end.setDate(end.getDate() - 2); // GSC data lags ~2 days
  const start = new Date(end);
  start.setMonth(start.getMonth() - months);

  const rows = await query(property, {
    startDate: iso(start),
    endDate: iso(end),
    dimensions: ["date"],
    rowLimit: 5000,
  });

  return rows.map((r) => ({
    date: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: Math.round(r.position * 100) / 100,
  }));
}

// ── Top queries by impressions (keyword suggestion source) ───────
export async function topQueries(property: string, limit = 50, days = 90) {
  const end = new Date();
  end.setDate(end.getDate() - 2);
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const rows = await query(property, {
    startDate: iso(start),
    endDate: iso(end),
    dimensions: ["query"],
    rowLimit: limit,
  });

  return rows.map((r) => ({
    keyword: r.keys[0],
    impressions: r.impressions,
    clicks: r.clicks,
    position: Math.round(r.position * 10) / 10,
  }));
}
