// lib/qc.ts — site quality checks, ranked by what actually matters.
//
// WO-003. DataForSEO returns ~90 named checks with a count each. Rendering that
// raw is useless: "canonical_to_redirect: 2" next to "is_5xx_code: 40" implies
// they are comparable problems, and they are not.
//
// So checks are classified into four bands, and the top one is the point:
//
//   critical — the site is broken or actively invisible to search. Spec §6:
//              these BYPASS the approval queue and fire an immediate alert.
//              "Unexpected noindex on money pages" is the classic disaster.
//   high     — real ranking damage, but nothing is on fire
//   medium   — worth fixing, no urgency
//   low      — hygiene
//
// Anything DataForSEO reports that is not in this map defaults to `low` rather
// than being hidden. An unknown check is still a finding; silently dropping it
// is how a new failure mode goes unnoticed.

export type Severity = "critical" | "high" | "medium" | "low";

export type QcIssue = {
  check: string;
  label: string;
  count: number;
  severity: Severity;
  why: string;
};

type Def = { label: string; severity: Severity; why: string };

const CHECKS: Record<string, Def> = {
  // ── critical: broken, or telling search engines to go away ────────────────
  is_5xx_code:            { label: "Server errors", severity: "critical", why: "Pages returning 5xx are down for users and for search engines." },
  is_broken:              { label: "Broken pages", severity: "critical", why: "The page does not load. Any link or ranking pointing at it is wasted." },
  is_redirect_loop:       { label: "Redirect loops", severity: "critical", why: "The page can never resolve, so nobody reaches it." },
  meta_noindex:           { label: "Pages set to noindex", severity: "critical", why: "Explicitly telling search engines not to index the page. On a money page this is invisible catastrophe." },
  canonical_to_broken:    { label: "Canonical points at a broken page", severity: "critical", why: "Ranking signals are being pointed at a page that does not exist." },
  is_link_relation_conflict: { label: "Conflicting link relations", severity: "critical", why: "Contradictory canonical or hreflang signals leave indexing to chance." },

  // ── high: real ranking damage ─────────────────────────────────────────────
  is_4xx_code:            { label: "Not-found pages", severity: "high", why: "Dead pages users and crawlers still reach." },
  no_title:               { label: "Missing page titles", severity: "high", why: "The title is the single strongest on-page ranking element and the headline in results." },
  duplicate_title:        { label: "Duplicate titles", severity: "high", why: "Search engines cannot tell which page to rank for the term." },
  duplicate_content:      { label: "Duplicate content", severity: "high", why: "Pages compete with each other rather than ranking as one." },
  broken_links:           { label: "Broken internal links", severity: "high", why: "Wastes crawl budget and dead-ends users mid-journey." },
  no_h1_tag:              { label: "Missing H1", severity: "high", why: "No clear statement of what the page is about." },
  canonical_to_redirect:  { label: "Canonical points at a redirect", severity: "high", why: "Ranking signals take an unnecessary hop and can be dropped." },
  https_to_http_links:    { label: "Secure pages linking to insecure ones", severity: "high", why: "Mixed content warnings and lost trust signals." },

  // ── medium ────────────────────────────────────────────────────────────────
  no_description:         { label: "Missing meta descriptions", severity: "medium", why: "Search engines invent a snippet instead of you controlling it." },
  duplicate_description:  { label: "Duplicate meta descriptions", severity: "medium", why: "The same snippet across pages tells a searcher nothing about which to pick." },
  title_too_long:         { label: "Titles too long", severity: "medium", why: "Cut off in results, so the end of the message is lost." },
  title_too_short:        { label: "Titles too short", severity: "medium", why: "Leaving ranking and click-through opportunity unused." },
  low_content_rate:       { label: "Thin content", severity: "medium", why: "Not enough substance to rank for anything competitive." },
  no_image_alt:           { label: "Images missing alt text", severity: "medium", why: "Invisible to screen readers and to image search." },
  large_page_size:        { label: "Oversized pages", severity: "medium", why: "Slow loads cost both rankings and conversions." },
  high_loading_time:      { label: "Slow pages", severity: "medium", why: "Core Web Vitals affect ranking and every conversion rate on the page." },

  // ── low ───────────────────────────────────────────────────────────────────
  no_favicon:             { label: "No favicon", severity: "low", why: "Minor trust and recognition signal." },
  no_image_title:         { label: "Images missing title", severity: "low", why: "Small accessibility and context gain." },
  seo_friendly_url:       { label: "URLs not SEO-friendly", severity: "low", why: "Readable URLs help users and marginally help search." },
  is_https:               { label: "Not served over HTTPS", severity: "critical", why: "Insecure pages are penalised and browsers warn users away." },
};

const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Turn a raw check map into a ranked, human-readable issue list. */
export function classifyChecks(checks: Record<string, number>): QcIssue[] {
  return Object.entries(checks)
    .filter(([, n]) => n > 0)
    .map(([check, count]) => {
      const def = CHECKS[check];
      return {
        check,
        count,
        label: def?.label ?? humanise(check),
        severity: def?.severity ?? "low",
        // An unrecognised check is still a finding. Saying we do not have a
        // description for it is honest; hiding it is not.
        why: def?.why ?? "Reported by the crawler. No guidance recorded for this check yet.",
      };
    })
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.count - a.count);
}

function humanise(check: string): string {
  return check.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/**
 * Issues serious enough to skip the queue entirely.
 *
 * Spec §6: "Critical issues (site down, noindex on money pages, forms broken)
 * bypass the queue and fire an immediate Slack alert." Waiting 24 hours for an
 * approval on a site that is down is not a workflow, it is an outage.
 */
export function criticalIssues(issues: QcIssue[]): QcIssue[] {
  return issues.filter((i) => i.severity === "critical");
}

export function issueCounts(issues: QcIssue[]): Record<Severity, number> {
  const out: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const i of issues) out[i.severity] += i.count;
  return out;
}

/**
 * A letter grade for the crawl score.
 *
 * Deliberately coarse. A score moving 91.2 → 90.8 is noise, and a per-decimal
 * number invites a conversation about the number rather than about the site.
 */
export function grade(score: number | null): string {
  if (score == null) return "—";
  if (score >= 90) return "Good";
  if (score >= 75) return "Fair";
  if (score >= 50) return "Poor";
  return "Critical";
}

/**
 * How long the scheduled collector waits on a crawl before giving up on it.
 *
 * A task id that never finishes used to pin a client forever: the collect
 * branch polled it every run and the queue branch never got a turn, so the
 * client silently stopped being crawled. DAPS.FIT sat on a leftover
 * `mock-task-000` for five days that way, logging "crawl still running" daily.
 *
 * 48 hours, not the 12 the manual route uses. The cron queues a crawl on one
 * run and collects it on the next, so a perfectly healthy crawl is already ~24
 * hours old the first time it is checked. A cutoff below that would abandon
 * every crawl before it was ever collected. The manual route can use 12 because
 * a human is standing there watching it.
 */
export const STALE_CRAWL_HOURS = 48;

/**
 * Hours since a crawl was queued, for the staleness cutoff.
 *
 * A missing timestamp reads as infinitely old on purpose. The cron path did not
 * always write `onpage_task_started_at`, so a task without one was queued by
 * the older code — which, given a daily cron, means at least a day ago. Calling
 * those stale is what lets the fleet heal itself on the next run.
 */
export function crawlAgeHours(startedAt: string | null | undefined, now: number = Date.now()): number {
  if (!startedAt) return Infinity;
  const t = new Date(startedAt).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (now - t) / 3_600_000;
}

/** True when a queued crawl has gone quiet long enough to abandon and requeue. */
export function isCrawlStale(startedAt: string | null | undefined, now: number = Date.now()): boolean {
  return crawlAgeHours(startedAt, now) > STALE_CRAWL_HOURS;
}
