// lib/gsc.ts — Google Search Console via a service account.
// Setup (once): create a GCP service account, enable the Search Console API,
// download its JSON key → env GOOGLE_SERVICE_ACCOUNT_JSON (the whole JSON,
// single line). Then add the service account's email as a Full user on each
// client's Search Console property. No OAuth flow needed.

import { JWT } from "google-auth-library";
import { mockApis, readFixture } from "@/lib/apiMock";

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
  if (mockApis()) return readFixture<{ date: string; clicks: number; impressions: number; ctr: number; position: number }[]>("gsc/daily_history.json");
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
  if (mockApis()) return readFixture<{ keyword: string; impressions: number; clicks: number; position: number }[]>("gsc/top_queries.json");
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

// ── Query × page performance over a window ───────────────────────
//
// WO-005. The one thing `dailyHistory` cannot tell you: WHICH searches produced
// the clicks. Without it, "9,420 organic sessions" is a number you can report
// and cannot act on, and no content recommendation can justify itself.
//
// Two dimension sets per window:
//   ["query"]          — the query rollup, for the keyword table
//   ["query", "page"]  — which URL answers which search, for attributing a
//                        published article to the searches it actually won
//
// GSC's own reporting lags about two days and back-fills for roughly three, so
// a window ending yesterday would be measurably wrong. `endOffsetDays` keeps the
// window behind the lag rather than reporting numbers that quietly change.

export type QueryWindowRow = {
  query: string;
  /** null on the query rollup row; set on query×page rows. */
  page: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type QueryWindow = {
  /** Last day included, ISO date. Also the natural key for the snapshot. */
  windowEnd: string;
  windowDays: number;
  rows: QueryWindowRow[];
};

/**
 * One window of query performance.
 *
 * `limit` caps each dimension set. GSC's long tail is mostly single-impression
 * noise; the top few hundred by impressions carries everything that could change
 * a decision. The cap is surfaced in the UI so the table is not mistaken for the
 * complete picture.
 */
export async function queryWindow(
  property: string,
  { windowDays = 28, endOffsetDays = 2, limit = 250, backBy = 0 } = {}
): Promise<QueryWindow> {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - endOffsetDays - backBy * windowDays);
  const start = new Date(end);
  // Inclusive of both ends: a 28-day window spans end-27 .. end.
  start.setUTCDate(start.getUTCDate() - (windowDays - 1));

  const windowEnd = iso(end);

  if (mockApis()) {
    const rows = readFixture<QueryWindowRow[]>("gsc/query_window.json");
    return { windowEnd, windowDays, rows };
  }

  const body = { startDate: iso(start), endDate: iso(end), rowLimit: limit };

  // Sequential, not parallel: the two calls hit the same per-property quota and
  // a 429 here loses the whole window rather than one dimension set.
  const queryRows = await query(property, { ...body, dimensions: ["query"] });
  const pageRows = await query(property, { ...body, dimensions: ["query", "page"] });

  const rows: QueryWindowRow[] = [
    ...queryRows.map((r) => ({
      query: r.keys[0], page: null,
      clicks: r.clicks, impressions: r.impressions,
      ctr: round(r.ctr, 4), position: round(r.position, 1),
    })),
    ...pageRows.map((r) => ({
      query: r.keys[0], page: r.keys[1] ?? null,
      clicks: r.clicks, impressions: r.impressions,
      ctr: round(r.ctr, 4), position: round(r.position, 1),
    })),
  ];

  return { windowEnd, windowDays, rows };
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
