// lib/apiShape.ts — read a list out of a response without guessing the envelope.
//
// Written after making the same mistake in three files in one day. PostFlow's
// /groups, PostFlow's /social-accounts and Bloom's /brands each wrap their list
// differently, and each time the fix was a slightly different hand-rolled
// fallback chain.
//
// ── The specific bug worth remembering ───────────────────────────────────────
// The Bloom version used `??`:
//
//     const arr = body?.data ?? body?.brands ?? (Array.isArray(body) ? body : []);
//
// `??` falls through on null and undefined ONLY. When `data` was an object
// rather than an array it was taken anyway, and `.filter is not a function` came
// back from a line that looked like it had a fallback. Checking for null when
// you mean "check for an array" is the whole bug.
//
// findArray checks the thing it actually needs: is this an array.

/** Keys vendors commonly wrap a list in, in rough order of likelihood. */
const KEYS = [
  "data", "items", "results", "records", "rows",
  "brands", "accounts", "socialAccounts", "social_accounts", "groups", "posts",
] as const;

/**
 * The first genuine array in a response, whatever it was wrapped in.
 *
 * Looks at the top level, then one level down, then a shallow scan of any nested
 * object. Returns undefined when there is no array anywhere — which callers
 * should report along with the raw payload rather than treating as "empty",
 * because an unrecognised envelope and a genuinely empty list are different
 * problems with different fixes.
 */
export function findArray(body: unknown): unknown[] | undefined {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return undefined;

  const obj = body as Record<string, unknown>;

  for (const k of KEYS) {
    if (Array.isArray(obj[k])) return obj[k] as unknown[];
  }

  // One level of nesting: { data: { items: [...] } }
  for (const k of KEYS) {
    const nested = obj[k];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const inner = nested as Record<string, unknown>;
      for (const k2 of KEYS) {
        if (Array.isArray(inner[k2])) return inner[k2] as unknown[];
      }
    }
  }

  // Last resort: any array-valued property at the top level. Deliberately last,
  // because a response can carry an unrelated array (errors, warnings, links)
  // and matching a known key is always the better answer.
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) return v as unknown[];
  }

  return undefined;
}

/**
 * A short, safe rendering of a payload for an error message.
 *
 * Shapes are not secrets and showing one turns "it returned nothing" into a
 * fixable observation. Truncated because an error message is not a log.
 */
export function describeShape(body: unknown, max = 300): string {
  try {
    return JSON.stringify(body).slice(0, max);
  } catch {
    return String(body).slice(0, max);
  }
}
