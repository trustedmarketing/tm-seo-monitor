// lib/recommendations.ts — rules engine reading collected data,
// emitting prioritized SEO / AEO / Technical / Authority recommendations.

export type Rec = {
  severity: "high" | "medium" | "low";
  category: "SEO" | "AEO" | "Technical" | "Authority";
  title: string;
  detail: string;
};

type KwRow = { keyword: string; position: number | null; posDelta: number | null; url: string | null };
type PromptRow = { prompt: string; mentioned: boolean | null; cited: boolean | null };
type SnapLite = {
  site_health: number | null; visibility: number | null;
  backlinks: number | null; organic_keywords: number | null;
};

const ORDER: Record<Rec["severity"], number> = { high: 0, medium: 1, low: 2 };

export function buildRecommendations(
  cur: SnapLite | undefined,
  prev: SnapLite | undefined,
  kws: KwRow[],
  prompts: PromptRow[]
): Rec[] {
  const recs: Rec[] = [];

  // ── SEO: striking distance (positions 4–15) ────────────────────
  const striking = kws.filter((k) => k.position != null && k.position >= 4 && k.position <= 15);
  if (striking.length > 0) {
    const list = striking.slice(0, 3).map((k) => `"${k.keyword}" (#${k.position})`).join(", ");
    recs.push({
      severity: "high", category: "SEO",
      title: `${striking.length} keyword${striking.length > 1 ? "s" : ""} within striking distance of page-one top spots`,
      detail: `${list}${striking.length > 3 ? ` and ${striking.length - 3} more` : ""} rank just below the top 3. On-page optimization of the ranking pages (title tags, internal links, content depth) typically moves these fastest — small position gains here produce the largest visibility jumps.`,
    });
  }

  // ── SEO: tracked keywords not ranking at all ───────────────────
  const missing = kws.filter((k) => k.position == null);
  if (missing.length > 0) {
    const list = missing.slice(0, 3).map((k) => `"${k.keyword}"`).join(", ");
    recs.push({
      severity: missing.length >= kws.length / 2 ? "high" : "medium", category: "SEO",
      title: `${missing.length} tracked keyword${missing.length > 1 ? "s" : ""} not in Google's top 100`,
      detail: `No ranking page exists yet for ${list}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""}. These are content gaps: each needs a dedicated page targeting the query (product page, comparison, or guide) before rankings can follow.`,
    });
  }

  // ── SEO: rankings that dropped since last check ────────────────
  const dropped = kws.filter((k) => k.posDelta != null && k.posDelta <= -3);
  if (dropped.length > 0) {
    const list = dropped.slice(0, 3).map((k) => `"${k.keyword}" (${k.posDelta})`).join(", ");
    recs.push({
      severity: "medium", category: "SEO",
      title: `${dropped.length} keyword${dropped.length > 1 ? "s" : ""} lost 3+ positions`,
      detail: `${list} moved down since the last check. Review the ranking pages for freshness and check whether competitors published new content targeting these terms.`,
    });
  }

  // ── SEO: defend top spots ──────────────────────────────────────
  const top3 = kws.filter((k) => k.position != null && k.position <= 3);
  if (top3.length > 0) {
    recs.push({
      severity: "low", category: "SEO",
      title: `${top3.length} keyword${top3.length > 1 ? "s" : ""} holding top-3 positions`,
      detail: `Keep the ranking pages fresh (update dates, add FAQs, maintain internal links) — top positions attract competitor attention and are cheaper to defend than to recover.`,
    });
  }

  // ── AEO: prompts where the brand is invisible ──────────────────
  const checked = prompts.filter((p) => p.mentioned != null);
  const invisible = checked.filter((p) => !p.mentioned);
  if (invisible.length > 0) {
    const list = invisible.slice(0, 2).map((p) => `"${p.prompt}"`).join(", ");
    recs.push({
      severity: "high", category: "AEO",
      title: `Invisible in AI answers for ${invisible.length} of ${checked.length} tracked prompts`,
      detail: `When customers ask ${list}${invisible.length > 2 ? ` and ${invisible.length - 2} more` : ""}, AI assistants don't surface this brand. Playbook: publish citable comparison and how-to content answering these exact questions, add FAQ schema markup, and add an llms.txt file so AI crawlers index the site cleanly.`,
    });
  }

  // ── AEO: mentioned but never cited as a source ─────────────────
  const mentionedNotCited = checked.filter((p) => p.mentioned && !p.cited);
  if (mentionedNotCited.length > 0) {
    recs.push({
      severity: "medium", category: "AEO",
      title: `Mentioned but not cited in ${mentionedNotCited.length} AI answer${mentionedNotCited.length > 1 ? "s" : ""}`,
      detail: `The brand comes up but the site isn't linked as the source, so the AI answer captures the click. Strengthen the pages answering these questions with original data, clear authorship, and structured markup to become the cited source.`,
    });
  }

  // ── AEO: no prompts tracked yet ────────────────────────────────
  if (prompts.length === 0) {
    recs.push({
      severity: "low", category: "AEO",
      title: "No AI prompts tracked yet",
      detail: `Add the questions customers ask AI assistants (in the admin) to start measuring AI answer visibility — the fastest-growing discovery channel to be absent from.`,
    });
  }

  // ── Technical: site health ─────────────────────────────────────
  if (cur?.site_health != null) {
    if (cur.site_health < 70) {
      recs.push({
        severity: "high", category: "Technical",
        title: `Site health at ${Math.round(cur.site_health)}% — technical issues are suppressing rankings`,
        detail: `The crawl found significant on-page problems. Prioritize a technical audit pass: broken links, slow pages, missing meta tags, and duplicate content all directly cap how well content can rank.`,
      });
    } else if (cur.site_health < 85) {
      recs.push({
        severity: "medium", category: "Technical",
        title: `Site health at ${Math.round(cur.site_health)}% — room to clean up`,
        detail: `Above the danger zone but below best practice (90%+). A cleanup sprint on the crawl findings protects rankings before they're affected.`,
      });
    }
  }

  // ── Authority: link profile flat or thin ───────────────────────
  if (cur?.backlinks != null) {
    const growth = prev?.backlinks != null ? cur.backlinks - prev.backlinks : null;
    if (cur.backlinks < 100 && (growth == null || growth <= 0)) {
      recs.push({
        severity: "medium", category: "Authority",
        title: `Thin link profile (${cur.backlinks} backlinks) with no recent growth`,
        detail: `Domain authority is the ceiling on every ranking above. Steady link acquisition — supplier/partner links, local citations, PR-worthy content — raises that ceiling for all tracked keywords at once.`,
      });
    }
  }

  return recs.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]).slice(0, 8);
}
