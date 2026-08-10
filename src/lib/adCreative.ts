// lib/adCreative.ts — WO-006 stream F: Bloom ad creative generation.
//
// Thin wrapper over lib/bloom.ts's startImage/checkImage — same async job
// pattern the social planner already uses (WO-004) — with a new prompt
// builder aimed at campaign + persona context (WO-006 stream E) instead of
// a social post brief.
//
// ── The fan-out gate (explicit instruction, not a default) ──────────────────
// Generation ALWAYS starts at 4:5 only. The 1:1 and 9:16 siblings are not
// generated until a human approves the 4:5 concept. fanOutSizes() below IS
// that gate: a pure function, no I/O, so the rule is testable without
// touching Bloom or the database, and a caller cannot accidentally skip it
// by forgetting to check a status flag somewhere.
import { startImage, checkImage, type ImageState } from "@/lib/bloom";

export const PRIMARY_ASPECT_RATIO = "4:5";
export const FAN_OUT_ASPECT_RATIOS = ["1:1", "9:16"] as const;

export interface AdCreativeBrief {
  campaignName: string;
  personaName?: string | null;
  messagingAngle?: string | null;
  offer?: string | null;
}

/**
 * Mechanical prompt from campaign + persona context — no model call, same
 * reasoning as lib/bloom.ts's imagePromptFor for social: describe the
 * subject and leave styling to Bloom, which already holds the brand's
 * visual identity from its brand session.
 */
export function adCreativePromptFor(brief: AdCreativeBrief, aspectRatio: string): string {
  const parts = [
    `Ad creative for the campaign "${brief.campaignName}".`,
    brief.personaName ? `Speaks to: ${brief.personaName}.` : null,
    brief.messagingAngle ? `Angle: ${brief.messagingAngle}.` : null,
    brief.offer ? `Offer: ${brief.offer}.` : null,
    `Aspect ratio ${aspectRatio}.`,
  ].filter(Boolean);
  return parts.join(" ");
}

export async function generateCreative(
  key: string,
  brandId: string,
  brief: AdCreativeBrief,
  aspectRatio: string
): Promise<{ bloomImageId: string | null; prompt: string }> {
  const prompt = adCreativePromptFor(brief, aspectRatio);
  const bloomImageId = await startImage(key, brandId, prompt, aspectRatio);
  return { bloomImageId, prompt };
}

export async function pollCreative(key: string, bloomImageId: string): Promise<ImageState> {
  return checkImage(key, bloomImageId);
}

/**
 * THE FAN-OUT GATE. Returns the additional sizes to generate, or an empty
 * list. Only ever non-empty when the row being fanned out FROM is genuinely
 * the 4:5 primary AND has genuinely been approved — never on generation,
 * never on a guess about what "should" happen next.
 */
export function fanOutSizes(primaryAspectRatio: string, primaryApproved: boolean): readonly string[] {
  if (primaryAspectRatio !== PRIMARY_ASPECT_RATIO) return [];
  if (!primaryApproved) return [];
  return FAN_OUT_ASPECT_RATIOS;
}
