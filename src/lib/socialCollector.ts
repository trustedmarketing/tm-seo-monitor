// lib/socialCollector.ts — pull organic social into the spine.
//
// WO-003 / Module E. Same shape as every other collector: self-skips when a
// client is not configured, records to collector_runs, and never throws — a
// social failure must not take down the daily collection that revenue reporting
// depends on.
import type { SupabaseClient } from "@supabase/supabase-js";
import { readSecret } from "@/lib/vault";
import { fetchPostsWithMetrics } from "@/lib/postflow";

export type SocialResult = { value: number; rows: number; detail: string };

export async function collectSocial(
  db: SupabaseClient,
  client: { id: string; domain: string; postflow_group_id?: string | null },
  days = 30
): Promise<SocialResult> {
  if (!client.postflow_group_id) {
    return { value: 0, rows: 0, detail: `no postflow_group_id for ${client.domain}` };
  }

  // One agency-wide PostFlow account, so the token is org-level rather than
  // per client. Only the group differs.
  const token = await readSecret(db, "postflow");
  if (!token) return { value: 0, rows: 0, detail: "no postflow token in vault" };

  const posts = await fetchPostsWithMetrics(token, client.postflow_group_id, days);
  if (posts.length === 0) return { value: 0, rows: 0, detail: "no posts in window" };

  // Metrics are dated by the day we COLLECTED them, not by publication. Social
  // numbers keep moving after a post goes out, so "reach on day 7" and "reach on
  // day 1" are different facts and both are worth keeping.
  const today = new Date().toISOString().slice(0, 10);
  let rows = 0;
  let engagements = 0;

  for (const p of posts) {
    const { data: postRow, error: postErr } = await db
      .from("social_posts")
      .upsert(
        {
          client_id: client.id,
          external_id: p.externalId,
          platform: p.platform,
          post_type: p.postType,
          title: p.title,
          content: p.content?.slice(0, 2000) ?? null,
          permalink: p.permalink,
          posted_at: p.postedAt,
        },
        { onConflict: "client_id,external_id" }
      )
      .select("id")
      .maybeSingle();

    if (postErr || !postRow) continue;

    const { error: metricErr } = await db.from("social_metrics_daily").upsert(
      {
        post_id: postRow.id,
        date: today,
        views: p.metrics.views,
        reach: p.metrics.reach,
        likes: p.metrics.likes,
        shares: p.metrics.shares,
        saves: p.metrics.saves,
        replies: p.metrics.replies,
        engagements: p.metrics.engagements,
        video_views: p.metrics.videoViews,
        link_clicks: p.metrics.linkClicks,
        score: p.metrics.score,
      },
      { onConflict: "post_id,date" }
    );

    if (!metricErr) {
      rows++;
      engagements += p.metrics.engagements ?? 0;
    }
  }

  return { value: engagements, rows, detail: `${rows} posts · ${engagements} engagements (${days}d)` };
}
