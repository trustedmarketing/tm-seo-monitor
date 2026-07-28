// lib/caption.ts — turn an approved series brief into drafted posts.
//
// WO-003 / Module E. The rules engine produces a BRIEF ("Week 3 — the cost of
// not doing it, as one number"). This turns each line of that brief into a post
// someone could actually publish.
//
// ── Why the brand block is assembled from stored facts ───────────────────────
// Everything in the system prompt below comes from the client record and their
// own best-performing posts. Nothing is invented about the business. A caption
// that confidently states a fact nobody gave us is how a client finds out we
// are guessing on their behalf — and Never Grown's "Earmarked" line is the
// example already in this codebase's history.
import type { SupabaseClient } from "@supabase/supabase-js";
import { generate } from "@/lib/ai";
import { playbookFor } from "@/lib/platformPlaybook";

export type DraftedPost = {
  week: number;
  brief: string;
  caption: string;
  hashtags: string[];
  /** Two to four words for the artwork. Written here so the image has a real
   *  hook rather than the image model reaching for the post's first sentence. */
  headline: string;
  /** Carousel slides, cover first. Empty for any other format. */
  slides: { headline: string; body: string; shot: string }[];
};

const SCHEMA = {
  type: "object",
  properties: {
    caption: {
      type: "string",
      description: "The post caption, ready to publish. No surrounding quotes.",
    },
    hashtags: {
      type: "array",
      items: { type: "string" },
      description: "3 to 6 hashtags, each including the leading #.",
    },
    headline: {
      type: "string",
      description:
        "Two to four words for the image overlay. A claim or a contrast, not a question. " +
        "Examples of the right shape: 'DISSOLVES THE SALT', 'BUILT FOR SALT', 'DULL VS GLEAMING'.",
    },
    slides: {
      type: "array",
      description:
        "Carousel slides only. The first is the cover and repeats the headline. Each later " +
        "slide is one point. Empty array for any format that is not a carousel.",
      items: {
        type: "object",
        properties: {
          headline: { type: "string", description: "Two to five words, set large on the slide." },
          body: { type: "string", description: "One short sentence. Optional, may be empty." },
          shot: {
            type: "string",
            description:
              "What the PHOTOGRAPH shows for this slide, in one line. Must differ from every " +
              "other slide. Describe the subject and the framing, e.g. 'close crop on the " +
              "reinforced panel above the little toe' or 'hands measuring a foot on a " +
              "measuring device'. Do not describe text or layout.",
          },
        },
        required: ["headline", "body", "shot"],
        additionalProperties: false,
      },
    },
  },
  required: ["caption", "hashtags", "headline", "slides"],
  additionalProperties: false,
} as const;

/**
 * Voice guidance derived from what already worked for THIS account.
 *
 * Handing the model the client's own top posts is better than any adjective we
 * could write: it shows the register rather than describing it, and it keeps the
 * drafts anchored to a voice the audience has already responded to.
 */
function systemPrompt(args: {
  clientName: string;
  domain: string;
  clientType: string | null;
  examples: string[];
  network?: string | null;
  coreHashtags?: string[];
  monthContext?: string | null;
  format?: string | null;
}): string {
  const { clientName, domain, clientType, examples, network, coreHashtags, monthContext, format } = args;
  const book = playbookFor(network);
  const isCarousel = (format ?? "").toLowerCase() === "carousel";

  return [
    `You write organic social captions for ${clientName} (${domain}).`,
    clientType === "local_service"
      ? "They are a local service business. Their audience is nearby customers deciding who to call."
      : clientType === "national_ecom"
      ? "They sell products online nationally. Their audience is people deciding whether to buy."
      : "",
    "",
    "Rules:",
    "- Write in the voice of the business, first person plural.",
    "- Never state a fact about the business that is not in this prompt. If a",
    "  specific number, credential, offer or location would strengthen the post",
    "  and you have not been given one, write around it rather than inventing it.",
    "- No em dashes. They read as machine-written.",
    "- No emoji unless the examples below use them.",
    "- Open with the substance. No 'Did you know' or 'In today's world'.",
    "- One clear idea per post. Length to suit the platform, not to fill space.",
    "",
    // A carousel is a different deliverable, not a longer caption. Saying so
    // here is what stops the copy promising slides that do not exist.
    isCarousel
      ? [
          "This is a CAROUSEL. Return `slides`:",
          "- The first slide is the cover and carries the same headline as the artwork.",
          "- Then one slide per point. As many as the content genuinely has, four to",
          "  ten including the cover. Do not pad to reach a number, and do not",
          "  compress two points into one slide to stay under it.",
          "- Each slide headline is two to five words. The body is one short sentence or empty.",
          "- First decide the TREATMENT for the whole carousel, from what it is:",
          "    · A checklist, a how-to, a comparison or anything explanatory is",
          "      INFORMATIONAL. Its slides are clean and graphic — a single large",
          "      point, a simple diagram, a labelled detail, a side-by-side. Product",
          "      photography is wrong for these: six product shots with different",
          "      words on them is a slideshow of one image pretending to be six.",
          "    · A launch, a range, a customer story or anything showing the thing",
          "      itself is PHOTOGRAPHIC. Its slides are real photographs.",
          "- Then each slide needs a SHOT: what it actually shows, in that treatment.",
          "  Every shot must be different from the others.",
          "  The COVER is always the hero image regardless of treatment.",
          "- The caption should complement the slides, not repeat them. It can say",
          "  'swipe through' because the slides genuinely exist.",
          "",
        ].join("\n")
      : [
          "This is NOT a carousel. Return `slides` as an empty array, and do not",
          "invite anyone to swipe or refer to slides in the caption — there is only",
          "one image.",
          "",
        ].join("\n"),

    "Also give a HEADLINE for the artwork:",
    "- Two to four words. It gets set large across the image, so length is the constraint.",
    "- A claim or a contrast, never a question. A question set in type reads as an ad asking",
    "  permission; a claim reads as the brand knowing something.",
    "- Plain words. It will be set in uppercase, so no punctuation beyond a full stop.",
    "",

    // The playbook rules were written down and then never handed to the writer.
    // The first live caption put a URL in a Facebook post body, which is the one
    // thing that playbook entry says suppresses reach.
    book
      ? [
          `Writing for ${book.label}. What it rewards: ${book.rewards}`,
          `Caption style: ${book.captionHint}`,
          "Avoid on this network:",
          ...book.avoid.map((a) => `- ${a}`),
        ].join("\n")
      : "",
    "",

    monthContext
      ? [
          "What the business has on this month:",
          monthContext,
          "Only mention it if this post is genuinely about it. Do not bolt a sale onto",
          "an unrelated post — knowing the context is so you avoid writing something",
          "that reads as though nothing is happening, not so you advertise in every post.",
          "",
        ].join("\n")
      : "",

    coreHashtags?.length
      ? [
          "Hashtags:",
          `- These are this client's standing tags and must appear on every post: ${coreHashtags.join(" ")}`,
          "- Add 1 to 3 more that are specific to THIS post's subject.",
          "- Return the standing tags plus your additions, standing tags first.",
        ].join("\n")
      : "Hashtags: 3 to 6, specific to this post's subject.",
    "",
    examples.length
      ? [
          "Their best-performing posts, for voice and register:",
          ...examples.map((e, i) => `${i + 1}. ${e}`),
        ].join("\n")
      : "No prior posts are available, so keep the voice plain and concrete.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Draft one post from one line of the series brief.
 *
 * Drafted one at a time rather than as a batch: a single failure then costs one
 * post instead of the whole series, and each caption is metered separately in
 * the ledger so cost is attributable.
 */
export async function draftPost(args: {
  db: SupabaseClient;
  clientId: string;
  clientName: string;
  domain: string;
  clientType: string | null;
  examples: string[];
  brief: string;
  week: number;
  sourcePost?: string | null;
  /** Network this post is for, so the drafter gets that platform's rules. */
  network?: string | null;
  /** What the business has on this month, for awareness rather than promotion. */
  monthContext?: string | null;
  /** Post format, so a carousel is written as slides rather than a long caption. */
  format?: string | null;
  /** The client's standing tags. Consistency is the point of a hashtag set. */
  coreHashtags?: string[];
}): Promise<DraftedPost> {
  const { db, clientId, brief, week, sourcePost, coreHashtags } = args;

  const prompt = [
    `Write the post for this brief:`,
    brief,
    sourcePost ? `\nThe original post this series is built on said:\n${sourcePost}` : "",
    `\nReturn the caption and hashtags.`,
  ]
    .filter(Boolean)
    .join("\n");

  const { value } = await generate<{
    caption: string; hashtags: string[]; headline: string;
    slides?: { headline: string; body: string; shot: string }[];
  }>({
    db,
    feature: "social_caption",
    clientId,
    system: systemPrompt(args),
    prompt,
    schema: SCHEMA as unknown as Record<string, unknown>,
    // Thinking counts toward this, so it sits well above the caption's length.
    maxTokens: 2000,
  });

  // Enforce the standing set rather than trusting the model to have included
  // it. A "consistent" hashtag strategy that depends on the model remembering is
  // not consistent, it is usually consistent.
  const returned = (value.hashtags ?? [])
    .filter((h) => typeof h === "string" && h.trim())
    .map((h) => (h.trim().startsWith("#") ? h.trim() : `#${h.trim()}`));

  const core = (coreHashtags ?? []).map((h) => (h.startsWith("#") ? h : `#${h}`));
  const seen = new Set(core.map((h) => h.toLowerCase()));
  const extras = returned.filter((h) => !seen.has(h.toLowerCase()));

  // Four words is the practical ceiling before type has to shrink to fit, which
  // is the thing that made the first attempt look weak.
  const headline = (value.headline ?? "")
    .trim()
    .replace(/[?!]+$/, "")
    .split(/\s+/)
    .slice(0, 4)
    .join(" ");

  const isCarousel = (args.format ?? "").toLowerCase() === "carousel";
  const slides = isCarousel
    ? (value.slides ?? [])
        .filter((s) => s?.headline?.trim())
        // Ten, not six. The old cap was arbitrary and silently truncated a
        // longer checklist. Instagram allows twenty; ten is where a carousel
        // stops being read rather than where the platform stops accepting.
        .slice(0, 10)
        .map((s) => ({
          headline: s.headline.trim(),
          body: (s.body ?? "").trim(),
          shot: (s.shot ?? "").trim(),
        }))
    : [];

  return {
    week,
    brief,
    headline,
    slides,
    caption: value.caption.trim(),
    // Standing tags first, then this post's own, capped so the block stays readable.
    hashtags: [...core, ...extras].slice(0, 8),
  };
}


const SLIDES_SCHEMA = {
  type: "object",
  properties: {
    slides: {
      type: "array",
      items: {
        type: "object",
        properties: {
          headline: { type: "string", description: "Two to five words, set large on the slide." },
          body: { type: "string", description: "One short sentence. May be empty." },
          shot: {
            type: "string",
            description:
              "What the PHOTOGRAPH shows for this slide, in one line, different from every " +
              "other slide. Subject and framing only, never text or layout.",
          },
        },
        required: ["headline", "body", "shot"],
        additionalProperties: false,
      },
    },
  },
  required: ["slides"],
  additionalProperties: false,
} as const;

/**
 * Break existing copy into carousel slides, without rewriting it.
 *
 * Exists because a post drafted before slides were a thing has good copy and no
 * slides, and the only route to slides was a full rewrite — which throws away
 * whatever a human had already edited. Splitting what is there is the cheaper
 * and less destructive operation.
 */
export async function slidesFromCaption(args: {
  db: SupabaseClient;
  clientId: string;
  caption: string;
  headline?: string | null;
}): Promise<{ headline: string; body: string; shot: string }[]> {
  const { db, clientId, caption, headline } = args;

  const { value } = await generate<{ slides: { headline: string; body: string; shot: string }[] }>({
    db,
    feature: "carousel_slides",
    clientId,
    system: [
      "You turn an existing social post into carousel slides.",
      "",
      "Rules:",
      "- Do NOT rewrite the post. Use the points it already makes, in the same order.",
      "- The first slide is the cover" + (headline ? `, carrying the headline "${headline}".` : "."),
      "- Then one slide per point the post makes, four to ten in total. As many as",
      "  the copy genuinely has — do not pad, and do not merge points to fit.",
      "- Each slide headline is two to five words, no punctuation beyond a full stop.",
      "- The body is one short sentence taken from that point, or empty if the",
      "  headline already says it.",
      "- First decide the TREATMENT from what this post is. A checklist, how-to or",
      "  comparison is INFORMATIONAL: clean graphic slides, a single large point, a",
      "  simple diagram, a labelled detail. Product photography is wrong for those —",
      "  six product shots with different words on them is one image pretending to",
      "  be six. A launch, range or customer story is PHOTOGRAPHIC.",
      "- Then each slide needs a SHOT: what it shows, in that treatment, in one line.",
      "  Every shot must be different. The cover is always the hero image.",
      "- No em dashes.",
    ].join("\n"),
    prompt: `Break this post into slides:\n\n${caption}`,
    schema: SLIDES_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 2000,
  });

  return (value.slides ?? [])
    .filter((s) => s?.headline?.trim())
    .slice(0, 10)
    .map((s) => ({
      headline: s.headline.trim(),
      body: (s.body ?? "").trim(),
      shot: (s.shot ?? "").trim(),
    }));
}
