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
import { accountStatus, onPageCrawlStatus } from "@/lib/dataforseo";
import { AEO_PROVIDERS, enabledProviders, modelFor } from "@/lib/aeoProviders";
import { projectClient, type ClientProjection } from "@/lib/aeoCost";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
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

    // ?task=<id> asks DataForSEO directly what state a crawl is in. Added after
    // a month of crawls silently never finishing: the bug was in the SUCCESS
    // path (an empty result read as "still crawling"), so nothing errored and
    // there was no way to see it from our side. `pending_tasks` lists what to
    // pass — otherwise finding a task id means going to SQL.
    const taskId = new URL(req.url).searchParams.get("task");
    let crawl: unknown = null;
    if (taskId) {
      crawl = await onPageCrawlStatus(taskId);
    }

    const { data: pending } = await db
      .from("clients")
      .select("name, onpage_task_id, onpage_task_started_at, last_crawl_at")
      .not("onpage_task_id", "is", null);

    // ── Projected AEO spend ────────────────────────────────────────────────
    // Each AI provider is a billed call per prompt per run, and the model
    // choice swings that by ~100×. Enabling a second provider blind is how a
    // shared balance disappears — so the projection sits next to the balance
    // it would be spent from.
    const { data: aeoClients } = await db
      .from("clients")
      .select("id, name, serp_frequency, aeo_providers")
      .eq("active", true);

    const projections: ClientProjection[] = [];
    for (const c of (aeoClients ?? []) as { id: string; name: string; serp_frequency: string | null; aeo_providers: unknown }[]) {
      const { count } = await db
        .from("tracked_prompts")
        .select("id", { count: "exact", head: true })
        .eq("client_id", c.id)
        .eq("active", true);

      const providers = enabledProviders(c.aeo_providers).map((p) => ({ key: p.key, model: modelFor(p) }));
      projections.push(
        projectClient({ client: c.name, prompts: count ?? 0, frequency: c.serp_frequency, providers })
      );
    }

    const aeoMonthly = Math.round(projections.reduce((a, p) => a + p.monthlyUsd, 0) * 100) / 100;

    // What it WOULD cost with every provider on, so the decision is visible
    // before it is made rather than discovered on the balance afterwards.
    const ifAllEnabled = projections.map((p) => {
      const all = AEO_PROVIDERS.map((pr) => ({ key: pr.key, model: modelFor(pr) }));
      return projectClient({ client: p.client, prompts: p.prompts, frequency: p.frequency, providers: all });
    });
    const aeoMonthlyIfAll = Math.round(ifAllEnabled.reduce((a, p) => a + p.monthlyUsd, 0) * 100) / 100;

    return NextResponse.json({
      ok: true,
      balance: acct.balance,
      currency: acct.currency,
      spent_this_period: acct.spentThisMonth,
      crawls_last_30d: rows.length,
      pages_crawled_last_30d: pages,
      pending_tasks: pending ?? [],
      crawl,
      aeo: {
        monthly_usd_current: aeoMonthly,
        monthly_usd_if_all_providers_enabled: aeoMonthlyIfAll,
        months_of_balance_at_current_rate:
          acct.balance != null && aeoMonthly > 0
            ? Math.round((acct.balance / aeoMonthly) * 10) / 10
            : null,
        by_client: projections,
        note:
          "Estimates, not a bill. DataForSEO charges $0.0006/task plus the model's own token cost, " +
          "so the MODEL is nearly all of it — Opus is ~100x Gemini Flash per check. " +
          "Any provider with modelPriceKnown: false is priced pessimistically because its model " +
          "is not in lib/aeoCost.ts's table. Override a model per provider with its env var.",
      },
      note:
        "Balance and spend come from DataForSEO; crawl counts are ours. " +
        "Each manual crawl is capped at 300 pages. " +
        "Add ?task=<onpage_task_id> to read one crawl's live state — resultRows: 0 means we are querying it wrong.",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message.slice(0, 300) }, { status: 500 });
  }
}
