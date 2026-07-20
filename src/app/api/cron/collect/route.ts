// app/api/cron/collect/route.ts
// Runs daily via Vercel cron. Collects only what's due, per client,
// based on each client's frequency settings in Supabase.

import { createClient } from "@supabase/supabase-js";
import {
  domainRankOverview,
  backlinksSummary,
  serpPosition,
  onPageTaskPost,
  onPageScore,
  visibilityScore,
  aiVisibility,
} from "@/lib/dataforseo";

export const maxDuration = 300; // needs Vercel Pro; hobby caps at 60s

const FREQ_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 28,
};

function isDue(freq: string, lastRun: string | null): boolean {
  if (freq === "paused") return false;
  if (!lastRun) return true;
  const days = FREQ_DAYS[freq] ?? 7;
  return Date.now() - new Date(lastRun).getTime() >= days * 86_400_000 - 3_600_000; // 1h grace
}

export async function GET(req: Request) {
  // Vercel cron sends this header; reject anything else.
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const db = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY! // server-only, never NEXT_PUBLIC
  );

  const { data: clients, error } = await db.from("clients").select("*").eq("active", true);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const report: Record<string, string[]> = {};

  for (const c of clients ?? []) {
    const done: string[] = [];
    const snapshot: Record<string, unknown> = { client_id: c.id };
    let hasData = false;

    // ── Core: traffic, keywords, backlinks ────────────────────────
    if (isDue(c.core_frequency, c.last_core_at)) {
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

    // ── SERP tracking → visibility % ─────────────────────────────
    if (isDue(c.serp_frequency, c.last_serp_at)) {
      try {
        const { data: kws } = await db
          .from("tracked_keywords")
          .select("id, keyword")
          .eq("client_id", c.id)
          .eq("active", true);

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
        await db.from("clients").update({ last_serp_at: new Date().toISOString() }).eq("id", c.id);
        done.push(`serp (${kws?.length ?? 0} kw)`);
      } catch (e) {
        done.push(`serp FAILED: ${(e as Error).message}`);
      }
    }

    // ── On-page crawl: two-step (post task now, score next run) ──
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
      } else if (isDue(c.crawl_frequency, c.last_crawl_at)) {
        const taskId = await onPageTaskPost(c.domain);
        await db.from("clients").update({ onpage_task_id: taskId }).eq("id", c.id);
        done.push("crawl queued");
      }
    } catch (e) {
      done.push(`crawl FAILED: ${(e as Error).message}`);
    }

    // ── AI visibility (phase 2 stub) ──────────────────────────────
    const ai = await aiVisibility(c.domain);
    if (ai.aiVisibility !== null) {
      snapshot.ai_visibility = ai.aiVisibility;
      snapshot.ai_mentions = ai.aiMentions;
      hasData = true;
    }

    if (hasData) await db.from("metric_snapshots").insert(snapshot);
    report[c.domain] = done;
  }

  return Response.json({ ran_at: new Date().toISOString(), report });
}
