// api/ops/dataforseo-check — what DataForSEO actually costs us.
//
// WO-003 Stream N. Added after a fair challenge: the QC panel warned that
// "crawls cost money" and nobody could see the number, including me. A cost
// warning that cannot be verified is just anxiety attached to a button.
//
// Reports account balance and spend so the claim is a figure rather than an
// assertion. Owner-only — this is commercial account data, not client data.
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { accountStatus } from "@/lib/dataforseo";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const profile = await getProfile();
  if (profile?.role !== "owner") {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }

  try {
    const acct = await accountStatus();

    // Crawl volume from our own records, so cost can be reasoned about against
    // real usage rather than a guess at page counts.
    const db = dbClient();
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data: scans } = await db
      .from("qc_scans").select("pages_crawled, scanned_at").gte("scanned_at", since);

    const rows = (scans ?? []) as { pages_crawled: number }[];
    const pages = rows.reduce((a, r) => a + (r.pages_crawled ?? 0), 0);

    return NextResponse.json({
      ok: true,
      balance: acct.balance,
      currency: acct.currency,
      spent_this_period: acct.spentThisMonth,
      crawls_last_30d: rows.length,
      pages_crawled_last_30d: pages,
      note:
        "Balance and spend come from DataForSEO; crawl counts are ours. " +
        "Each manual crawl is capped at 300 pages.",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message.slice(0, 300) }, { status: 500 });
  }
}
