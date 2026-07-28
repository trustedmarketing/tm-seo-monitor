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

export type DraftedPost = {
  week: number;
  brief: string;
  caption: string;
  hashtags: string[];
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
  },
  required: ["caption", "hashtags"],
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
}): string {
  const { clientName, domain, clientType, examples } = args;

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
}): Promise<DraftedPost> {
  const { db, clientId, brief, week, sourcePost } = args;

  const prompt = [
    `Write the post for this brief:`,
    brief,
    sourcePost ? `\nThe original post this series is built on said:\n${sourcePost}` : "",
    `\nReturn the caption and hashtags.`,
  ]
    .filter(Boolean)
    .join("\n");

  const { value } = await generate<{ caption: string; hashtags: string[] }>({
    db,
    feature: "social_caption",
    clientId,
    system: systemPrompt(args),
    prompt,
    schema: SCHEMA as unknown as Record<string, unknown>,
    // Thinking counts toward this, so it sits well above the caption's length.
    maxTokens: 2000,
  });

  return {
    week,
    brief,
    caption: value.caption.trim(),
    hashtags: (value.hashtags ?? []).filter((h) => typeof h === "string").slice(0, 6),
  };
}
