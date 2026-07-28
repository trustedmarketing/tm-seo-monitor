// lib/postflow.ts — PostFlow API client.
//
// WO-003 / Module E. Field names below are taken from PostFlow's published API
// reference rather than guessed — `postMetric.views`, `post_link`,
// `social_network` and the rest are their names, not ours. Guessing at a
// vendor's schema cost a day on Shopify this week; the docs took five minutes.
//
// Auth is a bearer token, vaulted org-wide as `postflow` (not per client) — one
// PostFlow account covers the whole agency. What varies per client is the
// GROUP: analytics require a groupId, so `clients.postflow_group_id` is the
// per-client key.
//
// Rate limit is 60 requests/minute per token, shared across every client, so the
// collector paginates conservatively rather than fanning out.
import { mockApis, readFixture } from "@/lib/apiMock";

const BASE = process.env.POSTFLOW_API_URL ?? "https://api.postflow.app/v1";

export type PostFlowPost = {
  externalId: string;
  platform: string | null;
  postType: string | null;
  title: string | null;
  content: string | null;
  permalink: string | null;
  postedAt: string | null;
  metrics: {
    views: number | null;
    reach: number | null;
    likes: number | null;
    shares: number | null;
    saves: number | null;
    replies: number | null;
    engagements: number | null;
    videoViews: number | null;
    linkClicks: number | null;
    score: number | null;
  };
};

type MetricRaw = {
  id?: string; score?: number | null; views?: number | null; reach?: number | null;
  likes?: number | null; shares?: number | null; saves?: number | null; replies?: number | null;
  engagements?: number | null; video_views?: number | null; post_link_clicks?: number | null;
  published_at?: string | null;
};

type AnalyticsRow = {
  postTitle?: string | null;
  content?: string | null;
  postLink?: string | null;
  postType?: string | null;
  postMetric?: MetricRaw | null;
};

type AnalyticsResponse = {
  data?: AnalyticsRow[];
  meta?: { current_page?: number; last_page?: number; total?: number };
};

async function get<T>(path: string, token: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}${path}?${qs}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });

  if (res.status === 429) {
    // 60/min per token, shared across all clients. Saying so in the error means
    // the next person does not go looking for a broken credential.
    throw new Error("PostFlow rate limit hit (60 req/min per token, shared across clients)");
  }
  if (!res.ok) {
    throw new Error(`PostFlow ${path} failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Posts with their performance for a date window.
 *
 * Uses the analytics endpoint rather than /posts because it returns the metrics
 * alongside the post in one call. /posts would need a second request per post to
 * get numbers, which at 60 req/min would burn the whole budget on one client.
 */
export async function fetchPostsWithMetrics(
  token: string,
  groupId: string,
  days = 30,
  maxPages = 5
): Promise<PostFlowPost[]> {
  if (mockApis()) {
    // readFixture is synchronous here, so a missing fixture throws rather than
    // rejecting — guard it explicitly so tests do not depend on a file existing.
    try { return readFixture<PostFlowPost[]>("postflow/posts.json"); }
    catch { return MOCK_POSTS; }
  }

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const out: PostFlowPost[] = [];
  let page = 1;

  while (page <= maxPages) {
    const body = await get<AnalyticsResponse>("/analytics/content/posts", token, {
      start: start.toISOString(),
      end: end.toISOString(),
      groupId,
      page: String(page),
    });

    for (const row of body.data ?? []) {
      const m = row.postMetric ?? {};
      // PostFlow's own metric id is the only stable per-post key it exposes here.
      // Without one there is nothing to key a row on, so the post is skipped
      // rather than inserted under a fabricated id.
      if (!m.id) continue;

      out.push({
        externalId: String(m.id),
        platform: null,               // analytics rows do not carry the network; see note below
        postType: row.postType ?? null,
        title: row.postTitle ?? null,
        content: row.content ?? null,
        permalink: row.postLink ?? null,
        postedAt: m.published_at ?? null,
        metrics: {
          views: m.views ?? null,
          reach: m.reach ?? null,
          likes: m.likes ?? null,
          shares: m.shares ?? null,
          saves: m.saves ?? null,
          replies: m.replies ?? null,
          engagements: m.engagements ?? null,
          videoViews: m.video_views ?? null,
          linkClicks: m.post_link_clicks ?? null,
          score: m.score ?? null,
        },
      });
    }

    const last = body.meta?.last_page ?? 1;
    if (page >= last) break;
    page++;
  }

  return out;
}

export type PostFlowGroup = { id: string; name: string | null };

/**
 * Every group this token can see.
 *
 * Exists so nobody has to hunt for a group id in the PostFlow UI. Finding an
 * opaque identifier by hand is exactly the class of task that produced a wrong
 * GA4 property id and six days of silent failure.
 */
export async function listGroups(token: string): Promise<PostFlowGroup[]> {
  if (mockApis()) return [{ id: "mock-group", name: "Mock Group" }];

  const body = await get<{ data?: { id?: string | number; name?: string | null }[] }>(
    "/groups", token, {}
  );
  return (body.data ?? [])
    .filter((g) => g.id != null)
    .map((g) => ({ id: String(g.id), name: g.name ?? null }));
}

/** Confirm the token works and the group exists, without pulling a full window. */
export async function ping(token: string, groupId: string): Promise<{ ok: boolean; posts: number }> {
  if (mockApis()) return { ok: true, posts: MOCK_POSTS.length };

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 7);

  const body = await get<AnalyticsResponse>("/analytics/content/posts", token, {
    start: start.toISOString(), end: end.toISOString(), groupId,
  });
  return { ok: true, posts: body.meta?.total ?? (body.data?.length ?? 0) };
}

const MOCK_POSTS: PostFlowPost[] = [
  {
    externalId: "mock-1", platform: "instagram", postType: "image",
    title: "Spring planting", content: "Beds prepped for the season.",
    permalink: "https://example.test/p/1", postedAt: new Date().toISOString(),
    metrics: { views: 1200, reach: 900, likes: 84, shares: 6, saves: 11, replies: 3,
               engagements: 104, videoViews: null, linkClicks: 7, score: 72 },
  },
];
