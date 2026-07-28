import { describe, it, expect } from "vitest";
import {
  classifyChecks, criticalIssues, issueCounts, grade,
  isCrawlStale, crawlAgeHours, STALE_CRAWL_HOURS,
} from "@/lib/qc";

// WO-003. DataForSEO returns ~90 named checks with a count each. Rendering that
// raw implies "canonical_to_redirect: 2" and "is_5xx_code: 40" are comparable
// problems. They are not.

describe("classifyChecks", () => {
  it("ranks critical before high before medium", () => {
    const out = classifyChecks({ no_description: 10, is_5xx_code: 1, no_title: 3 });
    expect(out.map((i) => i.check)).toEqual(["is_5xx_code", "no_title", "no_description"]);
  });

  it("drops checks with a zero count — a check nothing fails is not an issue", () => {
    expect(classifyChecks({ no_title: 0, broken_links: 2 }).map((i) => i.check)).toEqual(["broken_links"]);
  });

  it("keeps an UNKNOWN check rather than hiding it", () => {
    // A new crawler rule we have not classified is still a finding. Silently
    // dropping it is how a new failure mode goes unnoticed.
    const out = classifyChecks({ some_new_check_they_added: 4 });
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("low");
    expect(out[0].label).toBe("Some new check they added");
    expect(out[0].why).toMatch(/no guidance recorded/i);
  });

  it("treats noindex as critical — the classic invisible disaster", () => {
    expect(classifyChecks({ meta_noindex: 1 })[0].severity).toBe("critical");
  });

  it("sorts by count within the same severity", () => {
    const out = classifyChecks({ no_title: 2, duplicate_title: 9 });
    expect(out[0].check).toBe("duplicate_title");
  });
});

describe("criticalIssues", () => {
  it("returns only what should bypass the approval queue", () => {
    const out = criticalIssues(classifyChecks({ is_5xx_code: 1, no_description: 20, meta_noindex: 2 }));
    expect(out.map((i) => i.check).sort()).toEqual(["is_5xx_code", "meta_noindex"]);
  });

  it("is empty on a healthy site rather than inventing urgency", () => {
    expect(criticalIssues(classifyChecks({ no_favicon: 1 }))).toEqual([]);
  });
});

describe("issueCounts", () => {
  it("counts affected PAGES, not check types", () => {
    // Three checks, but forty pages of pain. The page count is the real scale.
    const counts = issueCounts(classifyChecks({ is_5xx_code: 40, no_title: 3, no_favicon: 1 }));
    expect(counts.critical).toBe(40);
    expect(counts.high).toBe(3);
    expect(counts.low).toBe(1);
  });
});

describe("grade", () => {
  it("is deliberately coarse — a 0.4 move is noise", () => {
    expect(grade(91.2)).toBe("Good");
    expect(grade(90.8)).toBe("Good");
  });

  it("names the bands", () => {
    expect(grade(80)).toBe("Fair");
    expect(grade(60)).toBe("Poor");
    expect(grade(20)).toBe("Critical");
    expect(grade(null)).toBe("—");
  });
});

// ── crawl staleness ─────────────────────────────────────────────────────────
// A task id that never finishes used to pin a client forever: the cron's
// collect branch polled it every run and the queue branch never got a turn.
// DAPS.FIT sat on a leftover `mock-task-000` for five days that way.
describe("isCrawlStale", () => {
  const NOW = new Date("2026-07-28T12:00:00Z").getTime();
  const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

  it("leaves a crawl queued by the previous cron run alone", () => {
    // The cron queues on one run and collects on the next, so a healthy crawl
    // is already ~24h old the first time it is checked. A cutoff below that
    // would abandon every crawl before it was ever collected.
    expect(isCrawlStale(hoursAgo(25), NOW)).toBe(false);
  });

  it("abandons a crawl that has missed two full cron cycles", () => {
    expect(isCrawlStale(hoursAgo(49), NOW)).toBe(true);
  });

  it("does not abandon exactly at the cutoff", () => {
    expect(isCrawlStale(hoursAgo(STALE_CRAWL_HOURS), NOW)).toBe(false);
  });

  it("treats a missing timestamp as stale so old rows heal themselves", () => {
    // The cron path did not always write onpage_task_started_at. A task without
    // one predates that fix and, given a daily cron, is at least a day old.
    expect(isCrawlStale(null, NOW)).toBe(true);
    expect(isCrawlStale(undefined, NOW)).toBe(true);
  });

  it("treats an unparseable timestamp as stale rather than never expiring", () => {
    expect(isCrawlStale("not a date", NOW)).toBe(true);
  });

  it("reports age in hours", () => {
    expect(crawlAgeHours(hoursAgo(6), NOW)).toBe(6);
  });
});
