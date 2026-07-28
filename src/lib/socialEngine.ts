// lib/socialEngine.ts — stage social series proposals as approval cards.
//
// WO-003 / Module E. Separate from proposalEngine.ts on purpose: that one scans
// a client's SITE through a store adapter, this one reads collected social
// performance. Same output shape, different evidence, and forcing them through
// one function would mean a store-less client could never get a social card.
//
// ── What gets staged is a BRIEF, not copy ────────────────────────────────────
// The card carries the outline and the reasoning; the captions are written when
// someone approves it. That ordering matters: a caption drafted at 6am on Monday
// and approved on Thursday would be reviewed against numbers that have since
// moved, and would have cost money nobody ever chose to spend.
import { dbClient } from "@/lib/db";
import { proposeSeries, type SocialPost } from "@/lib/socialProposals";

const SLA_HOURS = 24;

export type SocialEngineResult = {
  client: string;
  posts: number;
  proposed: number;
  duplicate: number;
  error?: string;
};

type PostRow = {
  id: number; title: string | null; content: string | null; post_type: string | null;
  permalink: string | null; posted_at: string | null;
};

type MetricRow = {
  post_id: number; engagements: number | null; saves: number | null;
  shares: number | null; link_clicks: number | null; reach: number | null;
};

export async function runSocialForClient(clientId: string): Promise<SocialEngineResult> {
  const db = dbClient();

  const { data: client } = await db
    .from("clients").select("id, name, postflow_group_id").eq("id", clientId).maybeSingle();
  if (!client) return { client: clientId, posts: 0, proposed: 0, duplicate: 0, error: "client not found" };

  // No group means no collection, which means no evidence. Skipping quietly is
  // right: this is an unconfigured client, not a failure.
  if (!client.postflow_group_id) {
    return { client: client.name, posts: 0, proposed: 0, duplicate: 0 };
  }

  const { data: postRows } = await db
    .from("social_posts")
    .select("id, title, content, post_type, permalink, posted_at")
    .eq("client_id", clientId)
    .order("posted_at", { ascending: false })
    .limit(60);

  const posts = (postRows ?? []) as PostRow[];
  if (posts.length === 0) return { client: client.name, posts: 0, proposed: 0, duplicate: 0 };

  const { data: metricRows } = await db
    .from("social_metrics_daily")
    .select("post_id, engagements, saves, shares, link_clicks, reach")
    .in("post_id", posts.map((p) => p.id))
    .order("date", { ascending: false });

  // Latest metric row per post — social numbers keep moving, and the most
  // recent reading is the one to judge on.
  const latest = new Map<number, MetricRow>();
  for (const m of (metricRows ?? []) as MetricRow[]) if (!latest.has(m.post_id)) latest.set(m.post_id, m);

  const shaped: SocialPost[] = posts.map((p) => {
    const m = latest.get(p.id);
    return {
      id: p.id,
      title: p.title,
      content: p.content,
      postType: p.post_type,
      permalink: p.permalink,
      postedAt: p.posted_at,
      engagements: m?.engagements ?? 0,
      saves: m?.saves ?? 0,
      shares: m?.shares ?? 0,
      linkClicks: m?.link_clicks ?? 0,
      reach: m?.reach ?? 0,
    };
  });

  const proposals = proposeSeries(shaped);
  let proposed = 0;
  let duplicate = 0;

  for (const p of proposals) {
    // Keyed on the SOURCE POST, so the same winner cannot be re-proposed every
    // morning for as long as it stays above median. One card per proven post.
    const key = `social:${clientId}:${p.ruleKey}:${p.sourcePostId}`;

    const sla = new Date();
    sla.setHours(sla.getHours() + SLA_HOURS);

    const source = posts.find((x) => x.id === p.sourcePostId);

    const { error } = await db.from("approvals").insert({
      client_id: clientId,
      variant: "social",
      status: "staged",
      severity: p.severity,
      title: p.title,
      why: p.why,
      staged_by: "Growth OS · social agent",
      qc_passed: 1, qc_total: 1,
      // A specialist can approve a draft that lands unscheduled. Nothing here
      // publishes to an audience without a second human step in PostFlow.
      requires_role: "specialist",
      sla_due_at: sla.toISOString(),
      idempotency_key: key,
      payload: {
        adapter: "postflow",
        changeType: "social_series",
        targetGid: String(p.sourcePostId),
        targetLabel: source?.title ?? "social series",
        before: "",
        after: `${p.outline.length}-post series`,
        outline: p.outline,
        sourceContent: source?.content ?? source?.title ?? null,
      },
    });

    // A unique-violation on the idempotency key means we already proposed this.
    if (error) duplicate++;
    else proposed++;
  }

  return { client: client.name, posts: posts.length, proposed, duplicate };
}

export async function runSocialAll(): Promise<SocialEngineResult[]> {
  const db = dbClient();
  const { data: clients } = await db.from("clients").select("id").eq("active", true);
  const out: SocialEngineResult[] = [];
  for (const c of (clients ?? []) as { id: string }[]) {
    out.push(await runSocialForClient(c.id));
  }
  return out;
}
