// lib/adCopyLimits.ts — WO-006 streams G/H: verified per-platform/per-format
// ad copy limits, plus the pure flag-don't-mutate helper.
//
// Verified via web search 2026-08-06, not memory — these change, and getting
// them wrong ships a broken turnkey tool:
//   Google RSA:   3-15 headlines (<=30 chars), 2-4 descriptions (<=90 chars)
//   Google PMax:  3-15 headlines (<=30 chars), 1-5 long headlines (<=90
//                 chars), 2-5 descriptions (<=90 chars, >=1 should be <=60),
//                 business name (<=25 chars)
//   Microsoft RSA: 3-15 headlines (<=30 chars), 2-4 descriptions (<=90 chars)
//                 — near-identical to Google RSA
//   Meta feed:    up to 5 primary texts (<=125 chars), 5 headlines
//                 (<=40 chars), 5 descriptions (<=30 chars)
//
// These limits live here, not in the generation schema — lib/ai.ts's
// generate() strips minLength/maxLength/minItems/maxItems from any schema
// before sending it (the API rejects those keywords outright). Counts and
// character limits are enforced in the prompt text and by lib/adCopy.ts's
// post-processing instead.

export type AdPlatform = "meta" | "google_ads" | "microsoft";
export type AdFormat = "rsa" | "pmax" | "meta_feed";

export interface FieldLimit {
  min: number;
  max: number;
  chars: number;
}

export interface FormatLimits {
  headlines?: FieldLimit;
  longHeadlines?: FieldLimit;
  descriptions?: FieldLimit;
  primaryTexts?: FieldLimit;
  businessNameChars?: number;
}

export const AD_COPY_LIMITS: Record<AdPlatform, Partial<Record<AdFormat, FormatLimits>>> = {
  google_ads: {
    rsa: {
      headlines: { min: 3, max: 15, chars: 30 },
      descriptions: { min: 2, max: 4, chars: 90 },
    },
    pmax: {
      headlines: { min: 3, max: 15, chars: 30 },
      longHeadlines: { min: 1, max: 5, chars: 90 },
      descriptions: { min: 2, max: 5, chars: 90 },
      businessNameChars: 25,
    },
  },
  microsoft: {
    rsa: {
      headlines: { min: 3, max: 15, chars: 30 },
      descriptions: { min: 2, max: 4, chars: 90 },
    },
  },
  meta: {
    meta_feed: {
      primaryTexts: { min: 1, max: 5, chars: 125 },
      headlines: { min: 1, max: 5, chars: 40 },
      descriptions: { min: 1, max: 5, chars: 30 },
    },
  },
};

export function limitsFor(platform: AdPlatform, format: AdFormat): FormatLimits {
  const limits = AD_COPY_LIMITS[platform]?.[format];
  if (!limits) throw new Error(`no ad copy limits defined for ${platform}/${format}`);
  return limits;
}

export interface FlaggedText {
  text: string;
  chars: number;
  overLimit: boolean;
}

/**
 * Flags text over `maxChars` — never truncates it. Truncating a
 * freshly-generated headline changes what it says; the existing convention
 * for this (lib/textDiff.ts's serpWarning) is to warn, not mutate.
 */
export function flagOverLimit(text: string, maxChars: number): FlaggedText {
  const trimmed = text.trim();
  return { text: trimmed, chars: trimmed.length, overLimit: trimmed.length > maxChars };
}

/** Flags every string in `texts`, then caps the ARRAY LENGTH to `field.max`
 * (count only — never drops based on character length). */
export function flagAndCapList(texts: string[], field: FieldLimit): FlaggedText[] {
  return texts
    .filter((t) => typeof t === "string" && t.trim())
    .slice(0, field.max)
    .map((t) => flagOverLimit(t, field.chars));
}
