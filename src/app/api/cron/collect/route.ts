// app/api/cron/collect/route.ts
// Runs daily via Vercel cron. Collects only what's due, per client.
// Every module records a collector_runs row (Phase A.5 observability); failures
// are recorded (not thrown) and pushed to Slack at the end.

import { createClient } from "@supabase/supabase-js";
import {
  domainRankOverview,
  backlinksSummary,
  serpPosition,
  onPageTaskPost,
  onPageScore,
  onPageSummary,
  visibilityScore,
  aiPromptCheck,
  AEO_MODEL,
} from "@/lib/dataforseo";
import { syncRecommendations, measureChanges } from "@/lib/recSync";
import { recordRun } from "@/lib/collectorRuns";
import { alertOnFailures, slackAlert, type CollectorFailure } from "@/lib/slack";
import { classifyChecks, criticalIssues, isCrawlStale, STALE_CRAWL_HOURS } from "@/lib/qc";
import { collectConversions } from "@/lib/conversionsCollector";
import { collectMetaAds } from "@/lib/metaAdsCollector";
import { collectGoogleAds } from "@/lib/googleAdsCollector";
import { collectMicrosoftAds } from "@/lib/microsoftAdsCollector";
import { collectShopify } from "@/lib/shopifyCollector";
import { collectSocial } from "@/lib/socialCollector";
import { syncApprovedRecs } from "@/lib/clickupSync";
import { checkTokenExpiry } from "@/lib/tokenExpiry";
import { findBreaches, reportBreaches } from "@/lib/slaEscalation";
import { collectOrganicQueries } from "@/lib/organicCollector";

export const maxDuration = 300;

const FREQ_DAYS: Record<string, number> = { daily: 1, weekly: 7, biweekly: 14, monthly: 28 };

function isDue(freq: string, lastRun: string | null): boolean {
  if (freq === "paused") return false;
  if (!lastRun) return true;
  const days = FREQ_DAYS[freq] ?? 7;
  return Date.now() - new Date(lastRun).getTime() >= days * 86_400_000 - 3_600_000;
}

// Run an async fn over items with bounded concurrency, preserving order.
// Turns the SERP/AI per-item API latency from sequential into parallel batches,
// keeping the whole run under Vercel's function limit (WO-002 v1.5).
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // ?force=1 on a manual trigger ignores frequency schedules and collects everything now.
  const force = new URL(req.url).searchParams.get("force") === "1";

  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: clients, error } = await db.from("clients").select("*").eq("active", true);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const report: Record<string, string[]> = {};
  const failures: CollectorFailure[] = [];

  for (const c of clients ?? []) {
    const done: string[] = [];
    const snapshot: Record<string, unknown> = { client_id: c.id };
    let hasData = false;

    // ── Core: traffic, keywords, backlinks ────────────────────────
    if (force || isDue(c.core_frequency, c.last_core_at)) {
      const t0 = Date.now();
      try {
        const [rank, links] = await Promise.all([
          domainRankOverview(c.domain, c.location_code, c.language_code),
          backlinksSummary(c.domain),
        ]);
        snapshot.organic_traffic = rank.organicTraffic;
        snapshot.organic_keywords = rank.organicKeywords;
        snapshot.backlinks = links.backlinks;
        snapshot.referring_domains = links.referringDomains;
        hasData = true;
        await db.from("clients").update({ last_core_at: new Date().toISOString() }).eq("id", c.id);
        done.push("core");
        await recordRun(db, "core", c.id, {
          status: "success",
          detail: `traffic=${rank.organicTraffic} kw=${rank.organicKeywords} backlinks=${links.backlinks}`,
          rows_written: 1,
          duration_ms: Date.now() - t0,
        });
      } catch (e) {
        const msg = (e as Error).message;
        done.push(`core FAILED: ${msg}`);
        failures.push({ module: "core", client: c.domain, error: msg });
        await recordRun(db, "core", c.id, { status: "error", error: msg, duration_ms: Date.now() - t0 });
      }
    }

    // ── Organic query windows (GSC query × page) ──────────────────
    // No frequency gate: four GSC calls per client against a 30k/day quota is
    // nothing, and the Organic tab is only as good as its freshest window.
    // Skipped silently only when there is no property to ask — that is a
    // configuration fact, not a failure, and recording it as an error every
    // morning would train everyone to ignore the failure list.
    if (c.gsc_property) {
      const t0 = Date.now();
      try {
        const r = await collectOrganicQueries(db, c.id, c.gsc_property);
        done.push("organic_queries");
        await recordRun(db, "organic_queries", c.id, {
          status: "success",
          detail: `window=${r.windowEnd} prior=${r.priorWindowEnd} rows=${r.rowsWritten}`,
          rows_written: r.rowsWritten,
          duration_ms: Date.now() - t0,
        });
      } catch (e) {
        const msg = (e as Error).message;
        done.push(`organic_queries FAILED: ${msg}`);
        failures.push({ module: "organic_queries", client: c.domain, error: msg });
        await recordRun(db, "organic_queries", c.id, { status: "error", error: msg, duration_ms: Date.now() - t0 });
      }
    }

    // ── SERP rankings + AI prompt checks (shared cadence) ─────────
    if (force || isDue(c.serp_frequency, c.last_serp_at)) {
      // Keyword rankings → visibility %
      const tSerp = Date.now();
      try {
        const { data: kws } = await db
          .from("tracked_keywords").select("id, keyword")
          .eq("client_id", c.id).eq("active", true);

        let wrote = 0;
        if (kws && kws.length > 0) {
          // Parallel (cap 8), resilient per keyword — one transient SERP error
          // (e.g. DataForSEO 40101) skips that keyword instead of failing the run.
          const rows = await mapLimit(kws, 8, async (kw) => {
            try {
              const { position, url } = await serpPosition(kw.keyword, c.domain, c.location_code, c.language_code);
              return { keyword_id: kw.id, position, url };
            } catch { return null; }
          });
          const ok = rows.filter((r): r is { keyword_id: string; position: number | null; url: string | null } => r !== null);
          if (ok.length > 0) {
            await db.from("keyword_rankings").insert(ok.map((r) => ({ client_id: c.id, ...r })));
          }
          snapshot.visibility = visibilityScore(ok.map((r) => r.position));
          wrote = ok.length;
          hasData = true;
        }
        done.push(`serp (${kws?.length ?? 0} kw)`);
        await recordRun(db, "serp", c.id, {
          status: "success", detail: `visibility=${snapshot.visibility ?? "n/a"}`,
          rows_written: wrote, duration_ms: Date.now() - tSerp,
        });
      } catch (e) {
        const msg = (e as Error).message;
        done.push(`serp FAILED: ${msg}`);
        failures.push({ module: "serp", client: c.domain, error: msg });
        await recordRun(db, "serp", c.id, { status: "error", error: msg, duration_ms: Date.now() - tSerp });
      }

      // AI prompts → ai_visibility %
      const tAi = Date.now();
      try {
        const { data: prompts } = await db
          .from("tracked_prompts").select("id, prompt")
          .eq("client_id", c.id).eq("active", true);

        if (prompts && prompts.length > 0) {
          // Parallel (cap 6); one prompt failing shouldn't sink the batch.
          const rows = await mapLimit(prompts, 6, async (p) => {
            try {
              const r = await aiPromptCheck(p.prompt, c.domain, c.name);
              return {
                prompt_id: p.id, mentioned: r.mentioned, cited: r.cited,
                // The answer and its sources are stored so a 0% can be READ
                // rather than argued about. Without them, "not mentioned" is a
                // claim with no evidence behind it — which is how 121 checks
                // went unquestioned for a week.
                answer: r.answer, sources: r.sources,
                model: AEO_MODEL, web_search: true,
              };
            } catch { return null; }
          });
          const ok = rows.filter((r): r is NonNullable<typeof r> => r !== null);
          const mentionedCount = ok.filter((r) => r.mentioned).length;
          const wrote = ok.length;
          if (ok.length > 0) {
            await db.from("prompt_results").insert(ok.map((r) => ({ client_id: c.id, ...r })));
          }
          snapshot.ai_visibility = Math.round((mentionedCount / prompts.length) * 10000) / 100;
          snapshot.ai_mentions = mentionedCount;
          hasData = true;
          done.push(`ai (${prompts.length} prompts, ${mentionedCount} mentioned)`);
          await recordRun(db, "ai", c.id, {
            status: "success", detail: `ai_visibility=${snapshot.ai_visibility} mentions=${mentionedCount}`,
            rows_written: wrote, duration_ms: Date.now() - tAi,
          });
        }
      } catch (e) {
        const msg = (e as Error).message;
        done.push(`ai FAILED: ${msg}`);
        failures.push({ module: "ai", client: c.domain, error: msg });
        await recordRun(db, "ai", c.id, { status: "error", error: msg, duration_ms: Date.now() - tAi });
      }

      await db.from("clients").update({ last_serp_at: new Date().toISOString() }).eq("id", c.id);
    }

    // ── On-page crawl: post task now, score next run ──────────────
    const tCrawl = Date.now();
    try {
      // Held open across both branches: a crawl we abandon as stale falls
      // through and requeues in the same run rather than waiting another day.
      let pendingTask: string | null = c.onpage_task_id ?? null;
      let collectedThisRun = false;

      if (pendingTask) {
        // The full summary, not just the score. A score says the site got worse;
        // the checks say what to fix, which is the only actionable half.
        const summary = await onPageSummary(pendingTask);
        const score = summary?.score ?? null;
        if (summary !== null) {
          snapshot.site_health = score;
          hasData = true;

          await db.from("qc_scans").insert({
            client_id: c.id,
            score,
            pages_crawled: summary.crawledPages,
            checks: summary.checks,
            task_id: pendingTask,
          });

          // Spec §6: critical issues BYPASS the approval queue and alert
          // immediately. Waiting 24 hours for a decision on a site that is down,
          // or noindexed, is not a workflow — it is an outage with paperwork.
          const critical = criticalIssues(classifyChecks(summary.checks));
          if (critical.length) {
            const lines = critical.slice(0, 6).map((i) => `• ${i.label}: ${i.count} page(s)`);
            await slackAlert(
              `:rotating_light: *Critical site issues — ${c.name}*\n${lines.join("\n")}` +
              (critical.length > 6 ? `\n…and ${critical.length - 6} more` : "")
            );
          }

          await db.from("clients")
            .update({
              onpage_task_id: null, onpage_task_started_at: null,
              last_crawl_at: new Date().toISOString(),
            })
            .eq("id", c.id);
          pendingTask = null;
          collectedThisRun = true;
          done.push("crawl scored");
          await recordRun(db, "crawl", c.id, {
            status: "success",
            detail: `site_health=${score} · ${Object.keys(summary.checks).length} check types flagged`,
            duration_ms: Date.now() - tCrawl,
          });
        } else if (isCrawlStale(c.onpage_task_started_at)) {
          // Give up on it. Left alone this task blocks every future crawl for
          // the client, and silence is the worst failure mode here — the QC
          // panel just keeps showing an ageing scan with nothing to explain it.
          await db.from("clients")
            .update({ onpage_task_id: null, onpage_task_started_at: null })
            .eq("id", c.id);
          pendingTask = null;
          done.push("crawl abandoned (stale)");
          await recordRun(db, "crawl", c.id, {
            status: "error",
            error: `task ${c.onpage_task_id} never finished after ${STALE_CRAWL_HOURS}h — abandoned, requeueing`,
            duration_ms: Date.now() - tCrawl,
          });
        } else {
          done.push("crawl still running");
          await recordRun(db, "crawl", c.id, {
            status: "skipped", detail: "crawl still running", duration_ms: Date.now() - tCrawl,
          });
        }
      }

      // `collectedThisRun` guards against an immediate requeue: c.last_crawl_at
      // is the value read at the top of the loop, so isDue() would still say
      // yes for a crawl we scored moments ago and we would pay for it twice.
      if (!pendingTask && !collectedThisRun && (force || isDue(c.crawl_frequency, c.last_crawl_at))) {
        const taskId = await onPageTaskPost(c.domain);
        await db.from("clients").update({
          onpage_task_id: taskId,
          onpage_task_started_at: new Date().toISOString(),
        }).eq("id", c.id);
        done.push("crawl queued");
        await recordRun(db, "crawl", c.id, {
          status: "success", detail: `queued task ${taskId}`, duration_ms: Date.now() - tCrawl,
        });
      }
    } catch (e) {
      const msg = (e as Error).message;
      done.push(`crawl FAILED: ${msg}`);
      failures.push({ module: "crawl", client: c.domain, error: msg });
      await recordRun(db, "crawl", c.id, { status: "error", error: msg, duration_ms: Date.now() - tCrawl });
    }

    if (hasData) await db.from("metric_snapshots").insert(snapshot);

    // persist/refresh recommendations from the newly collected data
    const tRecs = Date.now();
    try {
      await syncRecommendations(db, c.id);
      done.push("recs synced");
      await recordRun(db, "recs", c.id, { status: "success", duration_ms: Date.now() - tRecs });
    } catch (e) {
      const msg = (e as Error).message;
      done.push(`recs FAILED: ${msg}`);
      failures.push({ module: "recs", client: c.domain, error: msg });
      await recordRun(db, "recs", c.id, { status: "error", error: msg, duration_ms: Date.now() - tRecs });
    }

    // ── Conversions (GA4 → conversions_daily) — only if configured ─
    // Each collector below self-records its own collector_runs row and never
    // throws (tracked()/try-catch inside), so they can't sink the batch.
    if (c.ga4_property_id) {
      const n = await collectConversions(db, c);
      done.push(`conversions (${n})`);
    }

    // ── Meta ads → ad_metrics_daily (skips if no connected account) ─
    const metaN = await collectMetaAds(db, c);
    done.push(`meta ads (${metaN})`);

    // ── Google + Microsoft ads → ad_metrics_daily (skip if no account) ─
    const gN = await collectGoogleAds(db, c);
    done.push(`google ads (${gN})`);
    const msN = await collectMicrosoftAds(db, c);
    done.push(`microsoft ads (${msN})`);

    // ── Shopify revenue (ground truth) → conversions_daily(source='shopify') ─
    const shopN = await collectShopify(db, c);
    done.push(`shopify (${shopN})`);

    // ── Organic social via PostFlow → social_posts + social_metrics_daily ──
    // Wrapped rather than left to throw: a social failure must not take down the
    // collection that revenue reporting depends on.
    const tSocial = Date.now();
    try {
      const soc = await collectSocial(db, c as { id: string; domain: string; postflow_group_id?: string | null });
      done.push(`social (${soc.rows})`);
      await recordRun(db, "social", c.id, {
        status: soc.rows > 0 ? "success" : "skipped",
        detail: soc.detail, rows_written: soc.rows, duration_ms: Date.now() - tSocial,
      });
    } catch (e) {
      const msg = (e as Error).message;
      done.push(`social failed`);
      failures.push({ client: c.domain, module: "social", error: msg });
      await recordRun(db, "social", c.id, {
        status: "error", error: msg, duration_ms: Date.now() - tSocial,
      });
    }

    // ── ClickUp sync: approved recs → tasks (skips if no list_id) ──
    const synced = await syncApprovedRecs(db, c);
    done.push(`clickup (${synced} synced)`);

    report[c.domain] = done;
  }

  // ── Client approvals: did anyone decline a scheduled post? ──
  // PostFlow has no webhooks, so this is the poll. Wrapped, because a decline
  // check failing must not take down revenue collection.
  try {
    const { checkApprovals } = await import("@/lib/postflowApproval");
    const { notify } = await import("@/lib/notify");
    for (const c of (clients ?? []) as { id: string; name: string; postflow_group_id: string | null }[]) {
      const r = await checkApprovals(db, c);
      if (r.newlyDeclined.length) {
        await notify({
          subject: `${c.name}: ${r.newlyDeclined.length} post(s) declined`,
          body: r.newlyDeclined
            .map((d) => `• Slot ${d.slot}${d.by ? ` (${d.by})` : ""}: ${d.reason ?? "no reason given"}`)
            .join("\n") + `\n\n/dashboard/${c.id}/social`,
        });
      }
    }
  } catch (e) {
    failures.push({ client: "portfolio", module: "approvals", error: (e as Error).message });
  }

  // ── Portfolio-wide: proactive token-expiry sweep (self-records) ──
  await checkTokenExpiry(db);

  // measure any changes whose 28-day post window has completed
  let measured = 0;
  try { measured = await measureChanges(db); } catch { /* non-fatal */ }

  const ranAt = new Date().toISOString();
  // surface any module failures to the ops Slack channel (no-op if none)
  await alertOnFailures(ranAt, failures);

  // Punch list #9: the SLA gets a consequence rather than a colour. Never fatal —
  // a queue-health check must not be able to fail the collection it rides on.
  let slaBreaches = 0;
  try {
    const breaches = await findBreaches();
    slaBreaches = breaches.length;
    await reportBreaches(breaches);
  } catch (e) {
    console.error("[sla] check failed:", (e as Error).message);
  }

  return Response.json({
    ran_at: ranAt,
    measured_changes: measured,
    failures: failures.length,
    sla_breaches: slaBreaches,
    report,
  });
}
