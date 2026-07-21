// app/api/cron/collect/route.ts
// Runs daily via Vercel cron. Collects only what's due, per client.

import { createClient } from "@supabase/supabase-js";
import {
  domainRankOverview,
  backlinksSummary,
  serpPosition,
  onPageTaskPost,
  onPageScore,
  visibilityScore,
  aiPromptCheck,
} from "@/lib/dataforseo";
import { syncRecommendations, measureChanges } from "@/lib/recSync";

export const maxDuration = 300;

const FREQ_DAYS: Record<string, number> = { daily: 1, weekly: 7, biweekly: 14, monthly: 28 };

function isDue(freq: string, lastRun: string | null): boolean {
  if (freq === "paused") return false;
  if (!lastRun) return true;
  const days = FREQ_DAYS[freq] ?? 7;
  return Date.now() - new Date(lastRun).getTime() >= days * 86_400_000 - 3_600_000;
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

  for (const c of clients ?? []) {
    const done: string[] = [];
    const snapshot: Record<string, unknown> = { client_id: c.id };
    let hasData = false;

    // ── Core: traffic, keywords, backlinks ────────────────────────
    if (force || isDue(c.core_frequency, c.last_core_at)) {
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
      } catch (e) {
        done.push(`core FAILED: ${(e as Error).message}`);
      }
    }

    // ── SERP rankings + AI prompt checks (shared cadence) ─────────
    if (force || isDue(c.serp_frequency, c.last_serp_at)) {
      // Keyword rankings → visibility %
      try {
        const { data: kws } = await db
          .from("tracked_keywords").select("id, keyword")
          .eq("client_id", c.id).eq("active", true);

        if (kws && kws.length > 0) {
          const positions: (number | null)[] = [];
          for (const kw of kws) {
            const { position, url } = await serpPosition(
              kw.keyword, c.domain, c.location_code, c.language_code
            );
            positions.push(position);
            await db.from("keyword_rankings").insert({
              client_id: c.id, keyword_id: kw.id, position, url,
            });
          }
          snapshot.visibility = visibilityScore(positions);
          hasData = true;
        }
        done.push(`serp (${kws?.length ?? 0} kw)`);
      } catch (e) {
        done.push(`serp FAILED: ${(e as Error).message}`);
      }

      // AI prompts → ai_visibility %
      try {
        const { data: prompts } = await db
          .from("tracked_prompts").select("id, prompt")
          .eq("client_id", c.id).eq("active", true);

        if (prompts && prompts.length > 0) {
          let mentionedCount = 0;
          for (const p of prompts) {
            try {
              const r = await aiPromptCheck(p.prompt, c.domain, c.name);
              if (r.mentioned) mentionedCount++;
              await db.from("prompt_results").insert({
                client_id: c.id, prompt_id: p.id,
                mentioned: r.mentioned, cited: r.cited,
              });
            } catch {
              // one prompt failing shouldn't sink the batch
            }
          }
          snapshot.ai_visibility = Math.round((mentionedCount / prompts.length) * 10000) / 100;
          snapshot.ai_mentions = mentionedCount;
          hasData = true;
          done.push(`ai (${prompts.length} prompts, ${mentionedCount} mentioned)`);
        }
      } catch (e) {
        done.push(`ai FAILED: ${(e as Error).message}`);
      }

      await db.from("clients").update({ last_serp_at: new Date().toISOString() }).eq("id", c.id);
    }

    // ── On-page crawl: post task now, score next run ──────────────
    try {
      if (c.onpage_task_id) {
        const score = await onPageScore(c.onpage_task_id);
        if (score !== null) {
          snapshot.site_health = score;
          hasData = true;
          await db.from("clients")
            .update({ onpage_task_id: null, last_crawl_at: new Date().toISOString() })
            .eq("id", c.id);
          done.push("crawl scored");
        } else {
          done.push("crawl still running");
        }
      } else if (force || isDue(c.crawl_frequency, c.last_crawl_at)) {
        const taskId = await onPageTaskPost(c.domain);
        await db.from("clients").update({ onpage_task_id: taskId }).eq("id", c.id);
        done.push("crawl queued");
      }
    } catch (e) {
      done.push(`crawl FAILED: ${(e as Error).message}`);
    }

    if (hasData) await db.from("metric_snapshots").insert(snapshot);

    // persist/refresh recommendations from the newly collected data
    try {
      await syncRecommendations(db, c.id);
      done.push("recs synced");
    } catch (e) {
      done.push(`recs FAILED: ${(e as Error).message}`);
    }

    report[c.domain] = done;
  }

  // measure any changes whose 28-day post window has completed
  let measured = 0;
  try { measured = await measureChanges(db); } catch { /* non-fatal */ }

  return Response.json({ ran_at: new Date().toISOString(), measured_changes: measured, report });
}
