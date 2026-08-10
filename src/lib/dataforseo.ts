// lib/dataforseo.ts — thin client over the DataForSEO v3 endpoints we use.
// Auth: Basic auth from env. Every function returns already-unwrapped data.

import { mockApis, mockDataForSeo } from "@/lib/apiMock";
import { AEO_PROVIDERS, endpointFor, modelFor, type ProviderSpec } from "@/lib/aeoProviders";

const BASE = "https://api.dataforseo.com/v3";

function authHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error("DataForSEO credentials missing");
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}

async function post<T>(path: string, payload: unknown[]): Promise<T[]> {
  if (mockApis()) return mockDataForSeo<T>(path);
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

// GET counterpart for the task-retrieval endpoints. DataForSEO's docs are
// explicit that /on_page/summary/$id is a GET, and POSTing it does NOT error —
// it answers 200 with an empty `result`, which read exactly like "the crawl is
// still running". Every crawl therefore stalled at in_progress forever: polled,
// found unfinished, abandoned at 48h, requeued, repeat. A month of dead
// site-health data across every client, and not one exception to show for it.
//
// The lesson worth keeping: our own error path was fine. It was the SUCCESS
// path that lied. A silent wrong answer beats a loud failure at hiding.
async function get<T>(path: string): Promise<T[]> {
  if (mockApis()) return mockDataForSeo<T>(path);
  const res = await fetch(`${BASE}${path}`, {
    method: "GET",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
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
export type SerpResult = {
  position: number | null;
  url: string | null;
  /** Whether Google showed an AI Overview for this keyword at all. */
  aiOverview: boolean;
  /** Whether the client's domain appears among the AI Overview's cited sources. */
  aiOverviewCited: boolean;
};

/** Item shapes we read out of the SERP response. */
type SerpItem = {
  type: string;
  rank_absolute?: number;
  domain?: string;
  url?: string;
  /** ai_overview only — the sources Google built the answer from. */
  references?: { domain?: string; url?: string }[];
  items?: SerpItem[];
};

/** Hostname out of either a bare domain or a full URL, lowercased, no `www.`. */
function hostOf(candidate: string | undefined | null): string {
  const raw = String(candidate ?? "").trim().toLowerCase();
  if (!raw) return "";
  const withScheme = /^[a-z]+:\/\//.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^www\./, "").split("/")[0];
  }
}

/**
 * Is this reference our client's site?
 *
 * Matches on a label boundary — exactly the domain, or a subdomain of it. A
 * plain endsWith() counts `notgetsaltydog.com` as `getsaltydog.com`, which
 * would credit a competitor's citation to the client. Bare `includes()` is
 * looser still: it matches our own domain appearing anywhere in the URL,
 * including in a query string pointing somewhere else entirely.
 */
export function matchesDomain(candidate: string | undefined | null, domain: string): boolean {
  const host = hostOf(candidate);
  const bare = hostOf(domain);
  if (!host || !bare) return false;
  return host === bare || host.endsWith(`.${bare}`);
}

/**
 * Google AI Overview presence and citation for one SERP.
 *
 * Google's AI Overview is the AI answer with by far the widest reach, and it
 * costs nothing extra to measure: it arrives as an `ai_overview` item in the
 * SERP response we already buy for every tracked keyword. We were discarding it.
 *
 * Nested because references can hang off the ai_overview item itself or off its
 * child elements depending on the layout Google served — reading only the top
 * level would report "not cited" for a brand that was.
 */
export function extractAiOverview(items: SerpItem[], domain: string): { present: boolean; cited: boolean } {
  let present = false;
  let cited = false;

  const walk = (list: SerpItem[] | undefined, depth = 0): void => {
    if (!list || depth > 4) return;
    for (const it of list) {
      if (typeof it?.type === "string" && it.type.startsWith("ai_overview")) present = true;
      for (const ref of it?.references ?? []) {
        if (matchesDomain(ref.domain, domain) || matchesDomain(ref.url, domain)) cited = true;
      }
      walk(it?.items, depth + 1);
    }
  };

  walk(items);
  // A citation only counts if an overview was actually shown — references can
  // belong to other SERP features, and crediting those would inflate the metric.
  return { present, cited: present && cited };
}

export async function serpPosition(
  keyword: string,
  domain: string,
  locationCode: number,
  languageCode: string
): Promise<SerpResult> {
  const result = await post<{ items?: SerpItem[] }>("/serp/google/organic/live/advanced", [
    { keyword, location_code: locationCode, language_code: languageCode, depth: 100 },
  ]);
  const items = result?.[0]?.items ?? [];
  const hit = items.find((i) => i.type === "organic" && matchesDomain(i.domain, domain));
  const ai = extractAiOverview(items, domain);

  return {
    position: hit?.rank_absolute ?? null,
    url: hit?.url ?? null,
    aiOverview: ai.present,
    aiOverviewCited: ai.cited,
  };
}

// ── Account: balance and spend ────────────────────────────────────
//
// Added because "crawls cost money" was asserted in the UI without anyone
// being able to see the number. A cost warning nobody can verify is just
// anxiety; this makes it a figure.
export type AccountStatus = {
  balance: number | null;
  currency: string;
  /** Money spent in the current billing period, where the API reports it. */
  spentThisMonth: number | null;
  rates: Record<string, unknown> | null;
};

export async function accountStatus(): Promise<AccountStatus> {
  if (mockApis()) {
    return { balance: 123.45, currency: "USD", spentThisMonth: 41.2, rates: null };
  }

  // GET, not POST — this endpoint does not take a payload.
  const res = await fetch(`${BASE}/appendix/user_data`, {
    headers: { Authorization: authHeader() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`DataForSEO user_data failed: ${res.status}`);

  const json = await res.json();
  const r = json?.tasks?.[0]?.result?.[0] ?? {};

  return {
    balance: typeof r.money?.balance === "number" ? r.money.balance : null,
    currency: r.money?.currency ?? "USD",
    spentThisMonth: typeof r.money?.spent === "number" ? r.money.spent : null,
    rates: r.price ?? null,
  };
}

// ── On-page crawl: post task, fetch score later ───────────────────
export async function onPageTaskPost(domain: string, maxPages = 300): Promise<string> {
  if (mockApis()) return "mock-task-000";

  // Raw fetch rather than post(): the task id lives on the task object, and
  // post() returns task.result, which task_post leaves empty.
  //
  // This must stay ONE call. An earlier version called post() first, discarded
  // the result, then made this call for the id — which queued two crawls and
  // billed for both on every click, and orphaned the first. The second call
  // also dropped the load_resources/enable_javascript flags, so the crawl we
  // kept was the expensive one. That defeated the point of the six-hour rate
  // limit on /api/qc/scan.
  const res = await fetch(`${BASE}/on_page/task_post`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify([
      { target: domain, max_crawl_pages: maxPages, load_resources: false, enable_javascript: false },
    ]),
  });
  if (!res.ok) throw new Error(`DataForSEO /on_page/task_post → HTTP ${res.status}`);

  const json = await res.json();
  const task = json?.tasks?.[0];
  if (task?.status_code >= 40000) {
    throw new Error(`DataForSEO /on_page/task_post → ${task.status_code} ${task.status_message}`);
  }
  const id = task?.id;
  if (!id) throw new Error("on_page task_post returned no id");
  return id as string;
}

/**
 * Raw crawl state for one task — a diagnostic, not part of collection.
 *
 * Exists because the POST-vs-GET bug was invisible from our side: the summary
 * call returned an empty result, our code read that as "still crawling", and no
 * error was ever recorded. Being able to ask DataForSEO directly what it thinks
 * a task's state is turns that class of question from a day-long guess into one
 * request. Returns everything needed to tell "still running" from "finished"
 * from "we are asking wrong".
 */
export type OnPageCrawlStatus = {
  crawlProgress: string | null;
  pagesCrawled: number | null;
  pagesInQueue: number | null;
  maxCrawlPages: number | null;
  crawlStopReason: string | null;
  onpageScore: number | null;
  /** Rows DataForSEO returned. Zero here is the signature of the old POST bug. */
  resultRows: number;
};

export async function onPageCrawlStatus(taskId: string): Promise<OnPageCrawlStatus> {
  type Row = {
    crawl_progress?: string;
    crawl_stop_reason?: string;
    crawl_status?: { pages_crawled?: number; pages_in_queue?: number; max_crawl_pages?: number };
    items?: { onpage_score?: number }[];
  };
  const result = await get<Row>("/on_page/summary/" + taskId);
  const row = result?.[0];
  return {
    crawlProgress: row?.crawl_progress ?? null,
    pagesCrawled: row?.crawl_status?.pages_crawled ?? null,
    pagesInQueue: row?.crawl_status?.pages_in_queue ?? null,
    maxCrawlPages: row?.crawl_status?.max_crawl_pages ?? null,
    crawlStopReason: row?.crawl_stop_reason ?? null,
    onpageScore: row?.items?.[0]?.onpage_score ?? null,
    resultRows: result?.length ?? 0,
  };
}

export async function onPageScore(taskId: string): Promise<number | null> {
  type Row = { crawl_progress?: string; items?: { onpage_score?: number }[] };
  const result = await get<Row>("/on_page/summary/" + taskId);
  const row = result?.[0];
  if (row?.crawl_progress !== "finished") return null; // still crawling — try next run
  return row?.items?.[0]?.onpage_score ?? null;
}

export type OnPageSummary = {
  score: number | null;
  crawledPages: number;
  /** DataForSEO's check name → how many pages fail it. */
  checks: Record<string, number>;
};

/**
 * The full crawl summary, not just the headline score.
 *
 * A score alone tells a pod lead the site got worse without saying what to fix.
 * The `checks` map is the actionable half — DataForSEO returns a count per named
 * problem (broken links, missing titles, pages with no h1, and so on).
 */
export async function onPageSummary(taskId: string): Promise<OnPageSummary | null> {
  if (mockApis()) {
    return {
      score: 88.4, crawledPages: 42,
      checks: { no_description: 6, duplicate_title: 2, broken_links: 1, no_h1: 3 },
    };
  }

  type Row = {
    crawl_progress?: string;
    crawl_status?: { pages_crawled?: number };
    items?: { onpage_score?: number; page_metrics?: { checks?: Record<string, number> } }[];
  };

  const result = await get<Row>("/on_page/summary/" + taskId);
  const row = result?.[0];
  if (row?.crawl_progress !== "finished") return null;

  const item = row.items?.[0];
  const raw = item?.page_metrics?.checks ?? {};

  // Drop the zero counts. A check that nothing fails is not an issue, and
  // carrying ~90 zeroes makes the stored row unreadable.
  const checks: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "number" && v > 0) checks[k] = v;

  return {
    score: item?.onpage_score ?? null,
    crawledPages: row.crawl_status?.pages_crawled ?? 0,
    checks,
  };
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

// ── AI answer visibility — one prompt through an LLM, check presence ─
//
// DataForSEO's AI Optimization LLM Responses endpoint (ChatGPT).
//
// ── Why the first version measured nothing ───────────────────────────────────
// It asked gpt-4o-mini with `web_search` left at its default of FALSE, then
// searched the whole JSON blob for the brand name. Three faults compounding:
//
//   · A small model answering from training data alone will never name a
//     boat-care brand. 121 checks returned 0% and that was a true answer to the
//     wrong question — nobody asks ChatGPT for a recommendation and gets an
//     ungrounded answer from a mini model.
//   · Citations were inferred by substring. The endpoint returns an `annotations`
//     array with real URLs; matching a domain against serialised JSON also
//     matches the domain appearing in our own request.
//   · The blob included the PROMPT. A prompt naming the brand — "is Salty Dog
//     any good" — would have scored as a mention of itself.
//
// Now: a real model, web search forced on, citations read from annotations, and
// the brand matched only against the ANSWER text.
export const AEO_MODEL = process.env.AEO_MODEL ?? "gpt-4o";

export type AiCheck = {
  mentioned: boolean;
  cited: boolean;
  /** The answer, so a human can see what the model actually said. */
  answer: string | null;
  /** Every source the answer cited, ours or not — competitor visibility. */
  sources: { title: string | null; url: string }[];
};

/**
 * Ask one AI assistant a prompt and judge whether the brand shows up.
 *
 * `provider` defaults to ChatGPT so every existing caller keeps its behaviour —
 * this was ChatGPT-only, and the section called itself "AEO" while measuring
 * one assistant. Every provider uses the same request shape; only the path and
 * model name differ (lib/aeoProviders.ts).
 */
export async function aiPromptCheck(
  prompt: string,
  domain: string,
  brand: string,
  countryIso = "US",
  provider: ProviderSpec = AEO_PROVIDERS[0]
): Promise<AiCheck> {
  const result = await post<unknown>(endpointFor(provider), [{
    user_prompt: prompt.slice(0, 500),
    model_name: modelFor(provider),
    max_output_tokens: 2048,
    // The whole point. Without this the model cannot see the web, and "is this
    // brand visible in AI answers" becomes "was this brand in the training set".
    web_search: true,
    force_web_search: true,
    web_search_country_iso_code: countryIso,
  }]);

  const { text, annotations } = extractAnswer(result);

  const bare = domain.replace(/^www\./, "").toLowerCase();
  const brandLc = brand.trim().toLowerCase();
  const answerLc = (text ?? "").toLowerCase();

  const sources = annotations
    .filter((a) => a.url)
    .map((a) => ({ title: a.title ?? null, url: a.url as string }));

  // Cited means a source LINK to the domain — the thing that earns the click.
  //
  // matchesDomain(), not includes(): a substring test counts competitor.com/?ref=
  // getsaltydog.com as a citation of getsaltydog.com, and counts
  // notgetsaltydog.com as it too. Both credit someone else's citation to the
  // client, which is the one direction an AEO number must never be wrong in.
  const cited =
    sources.some((sr) => matchesDomain(sr.url, domain)) || answerLc.includes(bare);

  // Mentioned means named in the answer, cited or not.
  const mentioned = cited || (brandLc.length > 2 && answerLc.includes(brandLc));

  return { mentioned, cited, answer: text, sources };
}

/**
 * Pull the answer text and its citations out of the response.
 *
 * Shapes are read defensively rather than assumed — the annotations live inside
 * response sections, and reporting "no mention" when we simply failed to find
 * the text would repeat exactly the failure this function was rewritten to fix.
 */
function extractAnswer(result: unknown): {
  text: string | null;
  annotations: { title?: string | null; url?: string }[];
} {
  const parts: string[] = [];
  const annotations: { title?: string | null; url?: string }[] = [];

  const walk = (node: unknown, depth = 0): void => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    if (typeof node !== "object") return;

    const o = node as Record<string, unknown>;
    // `text`, `message` and `content` all appear in their responses depending on
    // the section. Reading only one of them is how an answer that was there
    // scored as "not mentioned".
    for (const k of ["text", "message", "content"]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) parts.push(v);
    }
    if (Array.isArray(o.annotations)) {
      for (const a of o.annotations) {
        const an = a as Record<string, unknown>;
        if (typeof an.url === "string") {
          annotations.push({ title: (an.title as string) ?? null, url: an.url });
        }
      }
    }
    for (const v of Object.values(o)) walk(v, depth + 1);
  };

  walk(result);
  return { text: parts.length ? parts.join("\n\n") : null, annotations };
}

// ── Ranked keywords — suggestion source for tracked_keywords ─────
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

// ── Competitors — domains sharing ranked keywords with the target ─
export async function competitorsDomain(
  domain: string, locationCode: number, languageCode: string, limit = 15
) {
  type Item = {
    domain?: string; avg_position?: number; intersections?: number;
    full_domain_metrics?: { organic?: { etv?: number; count?: number } };
  };
  const result = await post<{ items?: Item[] }>(
    "/dataforseo_labs/google/competitors_domain/live",
    [{ target: domain, location_code: locationCode, language_code: languageCode, limit, exclude_top_domains: true }]
  );
  const bare = domain.replace(/^www\./, "");
  return (result?.[0]?.items ?? [])
    .map((i) => ({
      domain: i.domain ?? "",
      sharedKeywords: i.intersections ?? 0,
      avgPosition: i.avg_position != null ? Math.round(i.avg_position * 10) / 10 : null,
      traffic: Math.round(i.full_domain_metrics?.organic?.etv ?? 0),
      keywords: i.full_domain_metrics?.organic?.count ?? 0,
    }))
    .filter((c) => c.domain && c.domain.replace(/^www\./, "") !== bare);
}

// ── Keyword research — suggestions with volume, CPC, difficulty ──
export async function keywordSuggestions(
  seed: string, locationCode: number, languageCode: string, limit = 30
) {
  type Item = {
    keyword?: string;
    keyword_info?: { search_volume?: number; cpc?: number; competition_level?: string };
    keyword_properties?: { keyword_difficulty?: number };
    search_intent_info?: { main_intent?: string };
  };
  const result = await post<{ items?: Item[] }>(
    "/dataforseo_labs/google/keyword_suggestions/live",
    [{ keyword: seed, location_code: locationCode, language_code: languageCode, limit, include_seed_keyword: true }]
  );
  return (result?.[0]?.items ?? [])
    .map((i) => ({
      keyword: i.keyword ?? "",
      volume: i.keyword_info?.search_volume ?? 0,
      cpc: i.keyword_info?.cpc != null ? Math.round(i.keyword_info.cpc * 100) / 100 : null,
      competition: i.keyword_info?.competition_level ?? null,
      difficulty: i.keyword_properties?.keyword_difficulty ?? null,
      intent: i.search_intent_info?.main_intent ?? null,
    }))
    .filter((k) => k.keyword)
    .sort((a, b) => b.volume - a.volume);
}
