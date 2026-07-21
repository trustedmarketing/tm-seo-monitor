// lib/apiMock.ts — MOCK_APIS=1 makes collectors read fixtures instead of live APIs.
// Used by staging (so we don't burn DataForSEO/GSC credits proving plumbing) and
// by tests. Fixtures live in tests/fixtures/ and hold the already-unwrapped
// `result` array each dataforseo client fn expects (see lib/dataforseo.ts post()).
import fs from "node:fs";
import path from "node:path";

export function mockApis(): boolean {
  return process.env.MOCK_APIS === "1";
}

const FIXTURE_ROOT = path.join(process.cwd(), "tests", "fixtures");

// DataForSEO endpoint path → fixture file (under tests/fixtures/dataforseo/).
const DFS_FIXTURES: Record<string, string> = {
  "/dataforseo_labs/google/domain_rank_overview/live": "domain_rank_overview.json",
  "/backlinks/summary/live": "backlinks_summary.json",
  "/serp/google/organic/live/advanced": "serp_organic.json",
  "/ai_optimization/chat_gpt/llm_responses/live": "ai_llm_responses.json",
  "/dataforseo_labs/google/ranked_keywords/live": "ranked_keywords.json",
  "/dataforseo_labs/google/competitors_domain/live": "competitors_domain.json",
  "/dataforseo_labs/google/keyword_suggestions/live": "keyword_suggestions.json",
};

export function mockDataForSeo<T>(apiPath: string): T[] {
  const file = apiPath.startsWith("/on_page/summary/")
    ? "on_page_summary.json"
    : DFS_FIXTURES[apiPath];
  if (!file) throw new Error(`MOCK_APIS: no fixture mapped for ${apiPath}`);
  return readFixture<T[]>(path.join("dataforseo", file));
}

export function readFixture<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, rel), "utf8")) as T;
}
