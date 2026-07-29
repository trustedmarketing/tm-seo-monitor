// lib/contentDraft.ts — the whole post, written to the brief.
//
// WO-005. Moving an item to drafting produces the article: body copy, internal
// and external links, and the structured data that answer engines read.
//
// ── SEO and AEO are different jobs and both are done here ────────────────────
// Search optimisation is about the page being found: title, headings that match
// real queries, internal links, depth.
//
// Answer-engine optimisation is about a passage being QUOTABLE. An assistant
// answering "how do I get salt off a boat" lifts one or two paragraphs. That
// paragraph has to make sense with everything around it removed — no "as we
// mentioned above", no "this product", no pronoun whose antecedent is three
// sections up. Most content fails AEO not on facts but on cohesion: it is
// written to be read top to bottom, and quoted out of order it is meaningless.
//
// So the prompt asks for self-contained passages and a direct answer up front,
// and the output carries FAQ pairs and JSON-LD.
//
// ── What is enforced rather than requested ───────────────────────────────────
// Links. Every URL the model produces goes through lib/linkPolicy.ts: competitor
// domains blocked against a stored list, internal links checked against pages we
// know exist, and every external link actually fetched. The model is asked
// nicely as well, but nothing here depends on it having complied.

import type { SupabaseClient } from "@supabase/supabase-js";
import { generate } from "@/lib/ai";
import { applyPolicy, type Link, type LinkVerdict } from "@/lib/linkPolicy";
import type { ContentBrief } from "@/lib/contentBrief";

export type DraftSection = {
  heading: string;
  /** Markdown body for this section. */
  body: string;
};

export type FaqPair = { question: string; answer: string };

export type ContentDraft = {
  title: string;
  metaTitle: string;
  metaDescription: string;
  slug: string;
  /**
   * The answer-first paragraph. Two or three sentences directly under the H1
   * that answer the query outright, before any preamble.
   */
  answer: string;
  sections: DraftSection[];
  faqs: FaqPair[];
  internalLinks: Link[];
  externalLinks: Link[];
  /** Links the policy removed, kept so an editor can see what happened. */
  rejectedLinks?: LinkVerdict[];
  /** JSON-LD, built in code from the fields above rather than by the model. */
  jsonLd?: Record<string, unknown>;
  wordCount: number;
};

const SCHEMA = {
  type: "object",
  required: ["title", "metaTitle", "metaDescription", "slug", "answer",
             "sections", "faqs", "internalLinks", "externalLinks"],
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    metaTitle: { type: "string" },
    metaDescription: { type: "string" },
    slug: { type: "string" },
    answer: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        required: ["heading", "body"],
        additionalProperties: false,
        properties: { heading: { type: "string" }, body: { type: "string" } },
      },
    },
    faqs: {
      type: "array",
      items: {
        type: "object",
        required: ["question", "answer"],
        additionalProperties: false,
        properties: { question: { type: "string" }, answer: { type: "string" } },
      },
    },
    internalLinks: {
      type: "array",
      items: {
        type: "object",
        required: ["url", "anchor"],
        additionalProperties: false,
        properties: { url: { type: "string" }, anchor: { type: "string" } },
      },
    },
    externalLinks: {
      type: "array",
      items: {
        type: "object",
        required: ["url", "anchor"],
        additionalProperties: false,
        properties: { url: { type: "string" }, anchor: { type: "string" } },
      },
    },
  },
} as const;

const SYSTEM = `You write publish-ready articles for an SEO agency's clients. You are writing the finished post, not an outline.

STRUCTURE

1. Open with a direct answer. Two or three sentences immediately under the title that answer the search outright. No throat-clearing, no "in this article we will".
2. Every section must stand alone. An AI assistant will quote ONE paragraph with everything around it removed, so never write "as mentioned above", "this product", "the method described earlier", or any pronoun whose subject is in another section. Name the thing every time. This is the single most important rule after accuracy.
3. Headings should match how people actually search, taken from the supplied queries.
4. Finish with FAQs — real questions from the query data, each answered completely in two to four sentences.

ACCURACY

5. Never invent a specification, price, ingredient, guarantee, certification or statistic about the client's product. If the article needs one, write the sentence around it and leave a marker in the form [CHECK: what is needed]. A confident wrong claim about a client's product is the worst thing you can produce.
6. Do not invent statistics or study findings for anything else either. Cite only sources you are confident exist at the exact URL given.

LINKS

7. Internal links: only to URLs from the supplied list of the client's real pages. Do not construct a URL that looks plausible. If nothing fits, return none.
8. External links: reputable, independent, and genuinely useful — a standards body, a manufacturer's technical documentation, a government or research source, an established trade publication. NEVER link to a competitor of the client, and never to a retailer selling a rival product.
9. Every external URL must be one you are confident resolves. Every link is fetched and checked before publication, so a guessed URL is simply removed.

VOICE

10. Plain and direct. No marketing throat-clearing, no "in today's world", no "unlock", no em-dashes.
11. Short paragraphs, two to four sentences.
12. British or American spelling: match the client's own domain and market.`;

/** A slug that will not surprise anyone. */
function slugify(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/^-|-$/g, "");
}

function countWords(draft: Pick<ContentDraft, "answer" | "sections" | "faqs">): number {
  const text = [
    draft.answer,
    ...draft.sections.map((s) => `${s.heading} ${s.body}`),
    ...draft.faqs.map((f) => `${f.question} ${f.answer}`),
  ].join(" ");
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Article + FAQPage JSON-LD.
 *
 * Built in code, not by the model. Structured data that disagrees with the page
 * is a manual action risk, and the only way to guarantee it agrees is to derive
 * it from the same fields the page renders.
 */
export function buildJsonLd(
  draft: Omit<ContentDraft, "jsonLd">,
  { clientName, domain }: { clientName: string; domain: string }
): Record<string, unknown> {
  const graph: Record<string, unknown>[] = [
    {
      "@type": "Article",
      headline: draft.title,
      description: draft.metaDescription,
      author: { "@type": "Organization", name: clientName },
      publisher: { "@type": "Organization", name: clientName },
      mainEntityOfPage: `https://${domain}/${draft.slug}`,
    },
  ];

  // Only when there are FAQs. An empty FAQPage is an invalid one.
  if (draft.faqs.length > 0) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: draft.faqs.map((f) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.answer },
      })),
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}

/**
 * Write the article for one content item.
 *
 * `knownPages` is what makes internal linking safe: URLs the client's site
 * genuinely serves, drawn from Search Console's page dimension and the store
 * catalogue. Without it the model writes tidy-looking internal links to pages
 * that have never existed.
 */
export async function draftArticle(
  db: SupabaseClient,
  {
    clientId, clientName, domain, brief, targetQuery, cluster,
    knownPages, competitors, verifyLinks = true,
  }: {
    clientId: string;
    clientName: string;
    domain: string;
    brief: ContentBrief;
    targetQuery: string | null;
    cluster: { query: string; position: number; impressions: number }[];
    knownPages: string[];
    competitors: string[];
    verifyLinks?: boolean;
  }
): Promise<{ draft: ContentDraft; costUsd: number }> {
  const prompt = [
    `Client: ${clientName} (${domain})`,
    targetQuery ? `Primary search: "${targetQuery}"` : null,
    "",
    "THE BRIEF",
    `Goal: ${brief.goal}`,
    `Audience: ${brief.audience}`,
    `Target length: about ${brief.wordCount} words`,
    "",
    "Outline to follow:",
    ...brief.sections.map((s, i) =>
      `${i + 1}. ${s.heading} — ${s.covers}${s.answers.length ? ` (answers: ${s.answers.join(", ")})` : ""}`
    ),
    "",
    brief.openQuestions.length
      ? `Unanswered by the client, so use a [CHECK: ...] marker rather than guessing:\n${brief.openQuestions.map((q) => `- ${q}`).join("\n")}`
      : null,
    "",
    "REAL SEARCHES this site appears for, to shape headings and FAQs:",
    ...cluster.slice(0, 25).map((q) => `- "${q.query}" (position ${q.position}, ${q.impressions} impressions)`),
    "",
    knownPages.length
      ? `THE CLIENT'S REAL PAGES — internal links may ONLY use these:\n${knownPages.slice(0, 60).map((p) => `- https://${domain}${p}`).join("\n")}`
      : "The client's page list is unavailable, so return NO internal links.",
    "",
    competitors.length
      ? `COMPETITORS — never link to these or their subdomains:\n${competitors.map((c) => `- ${c}`).join("\n")}`
      : null,
    "",
    "Write the article.",
  ].filter((l) => l !== null).join("\n");

  const { value, usage } = await generate<ContentDraft>({
    db,
    feature: "content_draft",
    clientId,
    system: SYSTEM,
    prompt,
    schema: SCHEMA,
    // A 1,500-word article with FAQs needs the room. Too low and the post is
    // silently truncated mid-section, which reads as a model failure and is
    // actually a configuration one.
    maxTokens: 16000,
  });

  // ── the enforcement pass ──────────────────────────────────────────────────
  const known = new Set(knownPages);
  const policy = { ownDomain: domain, competitors, knownPages: known, verify: verifyLinks };

  const [internal, external] = await Promise.all([
    applyPolicy(value.internalLinks ?? [], policy),
    applyPolicy(value.externalLinks ?? [], policy),
  ]);

  const draft: Omit<ContentDraft, "jsonLd"> = {
    ...value,
    slug: slugify(value.slug || value.title),
    internalLinks: internal.kept,
    externalLinks: external.kept,
    rejectedLinks: [...internal.rejected, ...external.rejected],
    wordCount: countWords(value),
  };

  return {
    draft: { ...draft, jsonLd: buildJsonLd(draft, { clientName, domain }) },
    costUsd: usage.costUsd,
  };
}
