import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { onPageSummary, onPageScore, onPageCrawlStatus } from "@/lib/dataforseo";

// /on_page/summary/$id is a GET endpoint. We sent POST for a month.
//
// It does not error on POST — it answers 200 with an empty `result`, which our
// code read as "crawl_progress is not finished, still crawling". So every crawl
// stalled: polled, found unfinished, abandoned at 48h, requeued, forever. Four
// clients, zero completed crawls in 30 days, and not one exception recorded —
// because the failure was in the SUCCESS path, not the error path.
//
// These tests assert on the HTTP METHOD, not just the parsed output, because
// the parsed output was indistinguishable from a legitimately unfinished crawl.
// That indistinguishability is the whole bug.

function summaryResponse(row: Record<string, unknown> | null) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      tasks: [{ status_code: 20000, status_message: "Ok.", result: row ? [row] : [] }],
    }),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("MOCK_APIS", "0");
  vi.stubEnv("DATAFORSEO_LOGIN", "login@example.com");
  vi.stubEnv("DATAFORSEO_PASSWORD", "password");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function stub(row: Record<string, unknown> | null) {
  fetchMock = vi.fn(async () => summaryResponse(row));
  vi.stubGlobal("fetch", fetchMock);
}

const FINISHED = {
  crawl_progress: "finished",
  crawl_status: { pages_crawled: 42, pages_in_queue: 0, max_crawl_pages: 300 },
  crawl_stop_reason: "empty_queue",
  items: [{ onpage_score: 88.4, page_metrics: { checks: { no_description: 6, broken_links: 0 } } }],
};

describe("onPageSummary", () => {
  it("uses GET, not POST — the bug that stalled every crawl for a month", async () => {
    stub(FINISHED);
    await onPageSummary("08101416-9445-0216-0000-0ed2a09d683e");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.dataforseo.com/v3/on_page/summary/08101416-9445-0216-0000-0ed2a09d683e");
    expect(init.method).toBe("GET");
  });

  it("sends no request body — a GET with a payload is what started this", async () => {
    stub(FINISHED);
    await onPageSummary("task-1");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
  });

  it("returns the score, page count and non-zero checks when the crawl finished", async () => {
    stub(FINISHED);
    const s = await onPageSummary("task-1");
    expect(s).toEqual({
      score: 88.4,
      crawledPages: 42,
      checks: { no_description: 6 }, // broken_links: 0 dropped
    });
  });

  it("returns null while a crawl is genuinely still running", async () => {
    stub({ crawl_progress: "in_progress", crawl_status: { pages_crawled: 12, pages_in_queue: 288 } });
    expect(await onPageSummary("task-1")).toBeNull();
  });

  it("returns null on an empty result — the old bug's signature, now only reachable for real", async () => {
    stub(null);
    expect(await onPageSummary("task-1")).toBeNull();
  });
});

describe("onPageScore", () => {
  it("also uses GET", async () => {
    stub(FINISHED);
    await onPageScore("task-1");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("GET");
  });

  it("returns the score once finished", async () => {
    stub(FINISHED);
    expect(await onPageScore("task-1")).toBe(88.4);
  });
});

describe("onPageCrawlStatus", () => {
  it("reports resultRows: 0 when DataForSEO returns nothing — the tell for querying it wrong", async () => {
    stub(null);
    const s = await onPageCrawlStatus("task-1");
    expect(s.resultRows).toBe(0);
    expect(s.crawlProgress).toBeNull();
  });

  it("surfaces the live crawl state so 'still running' can be told from 'stuck'", async () => {
    stub({ crawl_progress: "in_progress", crawl_status: { pages_crawled: 12, pages_in_queue: 288, max_crawl_pages: 300 } });
    const s = await onPageCrawlStatus("task-1");
    expect(s).toMatchObject({
      crawlProgress: "in_progress",
      pagesCrawled: 12,
      pagesInQueue: 288,
      maxCrawlPages: 300,
      resultRows: 1,
    });
  });

  it("reports the stop reason on a finished crawl", async () => {
    stub(FINISHED);
    const s = await onPageCrawlStatus("task-1");
    expect(s).toMatchObject({ crawlProgress: "finished", crawlStopReason: "empty_queue", onpageScore: 88.4 });
  });
});
