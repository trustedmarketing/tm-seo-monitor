// lib/proposals.ts — turn findings into staged, executable changes.
//
// WO-003. The existing recommendations engine (lib/recommendations.ts) emits
// PROSE: "N keywords are within striking distance". Useful, but a human still
// has to decide what to actually do. This layer is the missing half — it emits a
// concrete before/after that a human can approve in one click.
//
// ── The rule these rules follow ──────────────────────────────────────────────
// A card only gets staged when we can propose a SPECIFIC value we are prepared
// to defend. The design's premise is "the work is already done before the human
// sees it"; a card saying "this title is too long, please rewrite it" is not
// finished work, it is a to-do list wearing a card's clothing.
//
// That is why there is no "title too long" rule here despite it being easy to
// detect. Truncating a title at 60 characters is mechanically simple and
// editorially wrong — it cuts meaning to satisfy a limit. Detection without a
// defensible fix belongs in the advisory engine, not this one.
//
// Everything proposed here is a change from NOTHING to SOMETHING: a page with no
// SEO title falls back to whatever the CMS uses, and a page with no meta
// description lets the search engine invent one. Filling those in is an
// improvement we can argue for on any page, which is what makes it safe to
// propose automatically.

export type ProposalKind = "seo_title" | "meta_description";

export type ContentLike = {
  title: string;
  seoTitle: string;
  metaDescription: string;
  bodyText: string;
};

export type Proposal = {
  kind: ProposalKind;
  /** Stable across runs so re-proposing the same fix collides rather than duplicating. */
  ruleKey: string;
  before: string;
  after: string;
  why: string;
  severity: "High" | "Medium" | "Low";
};

/** Google truncates around here. Titles are display-width, so this is approximate. */
const TITLE_MAX = 60;
const DESC_MAX = 155;
const DESC_MIN = 70;

/** Trim to a limit at a word boundary, never mid-word. */
export function trimToWord(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : clean.slice(0, max)).replace(/[\s,.;:–-]+$/, "");
}

/**
 * Propose an SEO title for a page that has none.
 *
 * Pattern is `Page title | Brand`, which is the convention almost every site
 * already follows and the one a client will recognise. The brand suffix is
 * dropped rather than truncated if it would push past the limit — a cut-off
 * brand name looks like a bug on a search result.
 */
export function proposeSeoTitle(item: ContentLike, brand: string, variant = 0): Proposal | null {
  if (item.seoTitle.trim()) return null;               // already set — leave it alone
  const base = item.title.trim();
  if (!base) return null;

  const b = brand.trim();
  // variant 1 is the RE-DRAFT: used only after a human declined the first
  // suggestion as "wrong direction". Brand-first reads better for some pages,
  // and offering a genuinely different shape is the point — re-proposing the
  // same string with a new id would be pretending to listen.
  const withBrand =
    variant === 0 ? (b ? `${base} | ${b}` : base)
                  : (b ? `${b} — ${base}` : base);

  const after = withBrand.length <= TITLE_MAX ? withBrand : trimToWord(base, TITLE_MAX);

  if (!after || after === item.seoTitle) return null;

  return {
    kind: "seo_title",
    ruleKey: variant === 0 ? "missing_seo_title" : "missing_seo_title_v2",
    before: item.seoTitle,
    after,
    why:
      "This page has no search engine title set, so search engines fall back to whatever the " +
      "page heading happens to be. Setting one explicitly controls how the page appears in results.",
    severity: "Medium",
  };
}

/**
 * Propose a meta description for a page that has none.
 *
 * Built from the page's own opening copy rather than generated: the words are
 * already the client's, already approved, and already describe the page. An
 * invented description is a claim we would be putting on a client's search
 * result without anyone having written it.
 *
 * Returns null when the page has too little copy to describe itself — a
 * 40-character description is worse than letting the search engine choose.
 */
export function proposeMetaDescription(item: ContentLike, variant = 0): Proposal | null {
  if (item.metaDescription.trim()) return null;

  const body = item.bodyText.replace(/\s+/g, " ").trim();
  if (body.length < DESC_MIN) return null;             // not enough to work with

  // Prefer whole sentences, so the result reads as prose rather than a fragment.
  const sentences = body.match(/[^.!?]+[.!?]+/g) ?? [];
  // The re-draft skips the opening sentence. A first line is often a greeting or
  // a heading fragment, and "wrong direction" on a description usually means it
  // opened badly rather than that the page cannot be described.
  const pool = variant === 0 ? sentences : sentences.slice(1);
  let out = "";
  for (const s of pool) {
    if ((out + s).trim().length > DESC_MAX) break;
    out += s;
  }
  out = out.trim();

  // No sentence fitted — fall back to a clean word-boundary trim.
  if (out.length < DESC_MIN) out = trimToWord(body, DESC_MAX);
  if (out.length < DESC_MIN) return null;

  return {
    kind: "meta_description",
    ruleKey: variant === 0 ? "missing_meta_description" : "missing_meta_description_v2",
    before: item.metaDescription,
    after: out,
    why:
      "This page has no meta description, so search engines pick their own snippet from the page. " +
      "This one is taken from the page's own opening copy, so it reads as intended rather than as an " +
      "arbitrary extract.",
    severity: "Medium",
  };
}

/**
 * Run every rule against one content item.
 *
 * `variant` is the re-draft pass: 0 is the first suggestion, 1 is the different
 * angle offered after a human declined as "wrong direction". There is no
 * variant 2 — a rule that keeps generating alternatives after two refusals is
 * not learning, it is nagging.
 */
export function proposalsFor(item: ContentLike, brand: string, variant = 0): Proposal[] {
  return [
    proposeSeoTitle(item, brand, variant),
    proposeMetaDescription(item, variant),
  ].filter(Boolean) as Proposal[];
}
