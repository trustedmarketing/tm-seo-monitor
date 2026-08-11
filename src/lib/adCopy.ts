// lib/adCopy.ts — WO-006 streams G/H: ad copy generation for the turnkey
// campaign flow. Same generate<T>() call lib/caption.ts's draftPost() uses
// for social captions (lib/ai.ts, Claude, metered, structured output) —
// see lib/adCopyLimits.ts's header for the two gotchas this works around:
// the schema can't carry length/count constraints (they live in the prompt
// and in flagAndCapList()'s post-processing instead), and generate()'s own
// mockApis() branch returns a caption-shaped mock regardless of feature, so
// this file checks mockApis() itself before ever calling generate().
import type { SupabaseClient } from "@supabase/supabase-js";
import { mockApis } from "@/lib/apiMock";
import { generate } from "@/lib/ai";
import type { AdCreativeBrief } from "@/lib/adCreative";
import {
  limitsFor, flagAndCapList, flagOverLimit,
  type AdPlatform, type AdFormat, type FlaggedText,
} from "@/lib/adCopyLimits";

export interface AdCopyResult {
  headlines: FlaggedText[];
  longHeadlines?: FlaggedText[];
  descriptions: FlaggedText[];
  primaryTexts?: FlaggedText[];
  businessName?: FlaggedText;
}

function briefLine(brief: AdCreativeBrief): string {
  return [
    `Campaign: "${brief.campaignName}".`,
    brief.personaName ? `Speaks to: ${brief.personaName}.` : null,
    brief.messagingAngle ? `Angle: ${brief.messagingAngle}.` : null,
    brief.offer ? `Offer: ${brief.offer}.` : null,
  ].filter(Boolean).join(" ");
}

// Schema shape per format — plain string arrays, no length/count keywords
// (lib/ai.ts's generate() strips those before the request). Counts and
// character limits are stated in the prompt text below instead.
export function schemaFor(format: AdFormat): Record<string, unknown> {
  const str = (description: string) => ({ type: "string", description });
  const arr = (description: string) => ({ type: "array", items: { type: "string" }, description });

  if (format === "rsa") {
    return {
      type: "object",
      properties: {
        headlines: arr("Search ad headlines, each a short standalone phrase (not a sentence fragment that needs the others to make sense)."),
        descriptions: arr("Search ad description lines, each a complete sentence or two."),
      },
    };
  }
  if (format === "pmax") {
    return {
      type: "object",
      properties: {
        headlines: arr("Short headlines, each a standalone phrase."),
        longHeadlines: arr("Longer headlines — a full sentence-length claim or offer."),
        descriptions: arr("Description lines, each a complete sentence or two."),
        businessName: str("The business/brand name as it should appear on the ad."),
      },
    };
  }
  // meta_feed
  return {
    type: "object",
    properties: {
      primaryTexts: arr("The main feed copy above the image — the words that actually sell the click."),
      headlines: arr("Short headline shown below the image."),
      descriptions: arr("Optional link description shown below the headline, only reliably visible in a few placements — keep it short and skippable."),
    },
  };
}

export function promptFor(platform: AdPlatform, format: AdFormat, brief: AdCreativeBrief): string {
  const limits = limitsFor(platform, format);
  const asks: string[] = [briefLine(brief), "", "Write ad copy for this campaign. Requirements:"];

  if (limits.headlines) {
    asks.push(`- ${limits.headlines.min}-${limits.headlines.max} headlines, each ${limits.headlines.chars} characters or fewer.`);
  }
  if (limits.longHeadlines) {
    asks.push(`- ${limits.longHeadlines.min}-${limits.longHeadlines.max} long headlines, each ${limits.longHeadlines.chars} characters or fewer.`);
  }
  if (limits.descriptions) {
    asks.push(`- ${limits.descriptions.min}-${limits.descriptions.max} descriptions, each ${limits.descriptions.chars} characters or fewer.`);
  }
  if (limits.primaryTexts) {
    asks.push(`- ${limits.primaryTexts.min}-${limits.primaryTexts.max} primary text variants, each ${limits.primaryTexts.chars} characters or fewer.`);
  }
  if (limits.businessNameChars) {
    asks.push(`- A business name, ${limits.businessNameChars} characters or fewer.`);
  }
  asks.push(
    "Vary the headlines by angle (benefit, urgency, social proof, offer) rather than " +
    "rephrasing the same claim — Google/Microsoft/Meta all reward genuine variation, not near-duplicates."
  );
  return asks.join("\n");
}

const SYSTEM_PROMPT =
  "You write direct-response ad copy for a marketing agency's clients. Plain, concrete, " +
  "specific claims — no filler adjectives, no exclamation-mark stacking, no invented facts " +
  "beyond what the brief states. Every character counts against a hard platform limit, so " +
  "write tight the first time rather than relying on truncation.";

function mockResult(platform: AdPlatform, format: AdFormat): AdCopyResult {
  const limits = limitsFor(platform, format);
  const headlines = ["Get It Done Faster", "Trusted By Thousands", "Free Shipping Today"];
  const descriptions = ["Backed by our satisfaction guarantee. Order now and see the difference for yourself."];

  const result: AdCopyResult = {
    headlines: limits.headlines ? flagAndCapList(headlines, limits.headlines) : [],
    descriptions: limits.descriptions ? flagAndCapList(descriptions, limits.descriptions) : [],
  };
  if (limits.longHeadlines) {
    result.longHeadlines = flagAndCapList(["Everything you need, delivered to your door this week"], limits.longHeadlines);
  }
  if (limits.primaryTexts) {
    result.primaryTexts = flagAndCapList(["Stop settling for less. See why thousands of customers switched — and stayed."], limits.primaryTexts);
  }
  if (limits.businessNameChars) {
    result.businessName = flagOverLimit("Mock Brand", limits.businessNameChars);
  }
  return result;
}

export async function generateAdCopy(
  db: SupabaseClient,
  clientId: string,
  brief: AdCreativeBrief,
  platform: AdPlatform,
  format: AdFormat
): Promise<AdCopyResult> {
  const limits = limitsFor(platform, format);

  // Own mock, checked before generate() — generate()'s mockApis() branch
  // returns a caption-shaped fixture regardless of feature.
  if (mockApis()) return mockResult(platform, format);

  const { value } = await generate<{
    headlines?: string[]; longHeadlines?: string[]; descriptions?: string[];
    primaryTexts?: string[]; businessName?: string;
  }>({
    db,
    feature: "ad_copy",
    clientId,
    system: SYSTEM_PROMPT,
    prompt: promptFor(platform, format, brief),
    schema: schemaFor(format),
    maxTokens: 2000,
  });

  const result: AdCopyResult = {
    headlines: limits.headlines ? flagAndCapList(value.headlines ?? [], limits.headlines) : [],
    descriptions: limits.descriptions ? flagAndCapList(value.descriptions ?? [], limits.descriptions) : [],
  };
  if (limits.longHeadlines) result.longHeadlines = flagAndCapList(value.longHeadlines ?? [], limits.longHeadlines);
  if (limits.primaryTexts) result.primaryTexts = flagAndCapList(value.primaryTexts ?? [], limits.primaryTexts);
  if (limits.businessNameChars && value.businessName) {
    result.businessName = flagOverLimit(value.businessName, limits.businessNameChars);
  }
  return result;
}
