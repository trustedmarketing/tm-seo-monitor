// lib/dataforseo.ts — thin client over the DataForSEO v3 endpoints we use.
// Auth: Basic auth from env. Every function returns already-unwrapped data.

const BASE = "https://api.dataforseo.com/v3";

function authHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error("DataForSEO credentials missing");
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}

async function post<T>(path: string, payload: unknown[]): Promise<T[]> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`DataForSEO ${path} → HTTP ${res.status}`);
  const json = await res.json();
  const task = json?.tasks?.[0];
  if (task?.status_code >= 40000) {
    throw new Error(`DataForSEO ${path} → ${task.status_code} ${task.status_message}`);
  }
  return (task?.result ?? []) as T[];
}

// ── Organic traffic + keyword count (1 call, both numbers) ───────
export async function domainRankOverview(domain: string, locationCode: number, languageCode: string) {
  type Row = { metrics?: { organic?: { etv?: number; count?: number } } };
  const result = await post<{ items?: Row[] }>(
    "/dataforseo_labs/google/domain_rank_overview/live",
    [{ target: domain, location_code: locationCode, language_code: languageCode }]
  );
  const organic = result?.[0]?.items?.[0]?.metrics?.organic;
  return {
    organicTraffic: Math.round(organic?.etv ?? 0),
    organicKeywords: organic?.count ?? 0,
  };
}

// ── Backlinks summary ─────────────────────────────────────────────
export async function backlinksSummary(domain: string) {
  type Row = { backlinks?: number; referring_domains?: number };
  const result = await post<Row>("/backlinks/summary/live", [
    { target: domain, include_subdomains: true },
  ]);
  return {
    backlinks: result?.[0]?.backlinks ?? 0,
    referringDomains: result?.[0]?.referring_domains ?? 0,
  };
}

// ── SERP position for one keyword ────────────────────────────────
// Returns the best organic position for the domain, or null if not top 100.
export async function serpPosition(
  keyword: string,
  domain: string,
  locationCode: number,
  languageCode: string
): Promise<{ position: number | null; url: string | null }> {
  type Item = { type: string; rank_absolute?: number; domain?: string; url?: string };
  const result = await post<{ items?: Item[] }>("/serp/google/organic/live/advanced", [
    { keyword, location_code: locationCode, language_code: languageCode, depth: 100 },
  ]);
  const items = result?.[0]?.items ?? [];
  const bare = domain.replace(/^www\./, "");
  const hit = items.find(
    (i) => i.type === "organic" && (i.domain ?? "").replace(/^www\./, "").endsWith(bare)
  );
  return { position: hit?.rank_absolute ?? null, url: hit?.url ?? null };
}

// ── On-page crawl: post task, fetch score later ───────────────────
export async function onPageTaskPost(domain: string, maxPages = 300): Promise<string> {
  const result = await post<never>("/on_page/task_post", [
    { target: domain, max_crawl_pages: maxPages, load_resources: false, enable_javascript: false },
  ]);
  // task_post returns the id on the task object, not in result — refetch shape:
  // simpler: DataForSEO echoes the id; grab from a direct call instead.
  void result;
  // The post() helper strips task metadata, so make one raw call here:
  const res = await fetch(`${BASE}/on_page/task_post`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify([{ target: domain, max_crawl_pages: maxPages }]),
  });
  const json = await res.json();
  const id = json?.tasks?.[0]?.id;
  if (!id) throw new Error("on_page task_post returned no id");
  return id as string;
}

export async function onPageScore(taskId: string): Promise<number | null> {
  type Row = { crawl_progress?: string; items?: { onpage_score?: number }[] };
  const result = await post<Row>("/on_page/summary/" + taskId, []);
  const row = result?.[0];
  if (row?.crawl_progress !== "finished") return null; // still crawling — try next run
  return row?.items?.[0]?.onpage_score ?? null;
}

// ── Visibility % — CTR-weighted, comparable to Semrush's ─────────
// Sum of estimated CTR at each keyword's position, normalized to the
// score a domain would get if it ranked #1 for every tracked keyword.
const CTR: Record<number, number> = {
  1: 0.32, 2: 0.16, 3: 0.10, 4: 0.07, 5: 0.05,
  6: 0.04, 7: 0.03, 8: 0.025, 9: 0.02, 10: 0.018,
};
function ctrAt(position: number | null): number {
  if (position == null || position > 100) return 0;
  if (position <= 10) return CTR[position];
  if (position <= 20) return 0.01;
  return 0.002;
}
export function visibilityScore(positions: (number | null)[]): number {
  if (positions.length === 0) return 0;
  const earned = positions.reduce((s: number, p) => s + ctrAt(p), 0);
  const max = positions.length * CTR[1];
  return Math.round((earned / max) * 10000) / 100; // 2 decimals
}

// ── AI visibility (phase 2) ───────────────────────────────────────
// DataForSEO's AI Optimization API (LLM mentions endpoints) covers
// this. Stubbed so the schema and dashboard are ready when you wire it.
export async function aiVisibility(_domain: string) {
  return { aiVisibility: null as number | null, aiMentions: null as number | null };
}

// ── Ranked keywords — suggestion source for tracked_keywords ─────
// Returns keywords the domain already ranks top-30 for, best first.
export async function rankedKeywords(
  domain: string, locationCode: number, languageCode: string, limit = 50
) {
  type Item = {
    keyword_data?: { keyword?: string; keyword_info?: { search_volume?: number } };
    ranked_serp_element?: { serp_item?: { rank_absolute?: number } };
  };
  const result = await post<{ items?: Item[] }>(
    "/dataforseo_labs/google/ranked_keywords/live",
    [{
      target: domain, location_code: locationCode, language_code: languageCode,
      limit,
      order_by: ["keyword_data.keyword_info.search_volume,desc"],
      filters: [["ranked_serp_element.serp_item.rank_absolute", "<=", 30]],
    }]
  );
  return (result?.[0]?.items ?? []).map((i) => ({
    keyword: i.keyword_data?.keyword ?? "",
    volume: i.keyword_data?.keyword_info?.search_volume ?? 0,
    position: i.ranked_serp_element?.serp_item?.rank_absolute ?? null,
  })).filter((k) => k.keyword);
}
