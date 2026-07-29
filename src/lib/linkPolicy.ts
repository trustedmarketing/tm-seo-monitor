// lib/linkPolicy.ts — which links may ship, decided in code.
//
// WO-005. Two failure modes make link handling the part of AI content generation
// that must not be left to the prompt.
//
// ── 1. Invented URLs ─────────────────────────────────────────────────────────
// A model asked for authoritative sources will produce URLs that look exactly
// right and 404. It is not lying so much as pattern-matching the shape of a URL
// on that domain. A published article full of dead citations is worse than one
// with none: it looks researched and damages the client on inspection. So every
// external link is FETCHED before it can ship, and dropped if it does not
// resolve.
//
// ── 2. Linking to the competition ────────────────────────────────────────────
// "Do not link to competitors" in a prompt is a request. The model does not know
// who this client competes with, and the best-written page on any commercial
// topic very often belongs to a direct rival. Sending a client's readers — and
// link equity — to a competitor is the single most expensive mistake this
// pipeline could make, so it is enforced against a stored list rather than
// asked for.
//
// Both checks run on the OUTPUT. Nothing here trusts the model to have complied.

export type Link = { url: string; anchor: string };

export type LinkVerdict = {
  link: Link;
  ok: boolean;
  /** Why it was rejected, for showing on the draft rather than silently dropping. */
  reason?: "competitor" | "own_domain" | "unreachable" | "malformed" | "not_on_site";
  status?: number;
};

/**
 * The registrable domain, lower-cased, with www stripped.
 *
 * Deliberately naive about multi-part public suffixes (.co.uk, .com.au): it
 * keeps the last two labels, which is right for the common case and wrong for
 * "bbc.co.uk" → "co.uk". That matters only for matching, and matching too
 * broadly on a suffix would block an entire country's domains — so
 * `sameRegistrableDomain` compares full hostnames with a suffix check instead,
 * and this is used only for display.
 */
export function hostOf(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Does `host` belong to `domain`?
 *
 * True for an exact match and for any subdomain. "shop.salt-away.com" belongs to
 * "salt-away.com"; "notsalt-away.com" does not. The dot in the suffix test is
 * what stops the second case matching, and it is the whole reason this is a
 * function rather than an `includes`.
 */
export function belongsTo(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  const d = domain.toLowerCase().replace(/^www\./, "").trim();
  if (!d) return false;
  return h === d || h.endsWith("." + d);
}

/**
 * Classify a link against the policy, without touching the network.
 *
 * Separated from verification so the rules are testable on their own and so a
 * competitor link is rejected without us fetching it first.
 */
export function classify(
  link: Link,
  { ownDomain, competitors, knownPages }: {
    ownDomain: string;
    competitors: string[];
    /** Pages known to exist on the client's site, for internal links. */
    knownPages?: Set<string>;
  }
): LinkVerdict {
  const host = hostOf(link.url);
  if (!host) return { link, ok: false, reason: "malformed" };

  if (competitors.some((c) => belongsTo(host, c))) {
    return { link, ok: false, reason: "competitor" };
  }

  if (belongsTo(host, ownDomain)) {
    // An internal link is fine, but only to a page we know exists. The model
    // guesses tidy-looking URLs on the client's own domain more readily than on
    // anyone else's, because it has seen the domain in the prompt.
    if (knownPages && !knownPages.has(normalisePath(link.url))) {
      return { link, ok: false, reason: "not_on_site" };
    }
    return { link, ok: true, reason: undefined };
  }

  return { link, ok: true };
}

/** Path-only, trailing slash removed, for comparing against known pages. */
export function normalisePath(url: string): string {
  try {
    const u = new URL(url.trim());
    const p = u.pathname.replace(/\/+$/, "");
    return p === "" ? "/" : p;
  } catch {
    return url;
  }
}

/**
 * Confirm an external link actually resolves.
 *
 * GET rather than HEAD: a meaningful number of sites answer HEAD with 405 or
 * 403 while serving GET perfectly well, and treating those as dead would strip
 * good citations. The body is abandoned as soon as the status is known.
 *
 * A timeout counts as unreachable. A slow server is not evidence the page is
 * good, and a writer would rather lose a borderline citation than publish one
 * that hangs.
 */
export async function reachable(
  url: string,
  { timeoutMs = 6000, fetchImpl = fetch }: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<{ ok: boolean; status?: number }> {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: control.signal,
      headers: {
        // Some publishers serve a 403 to an unidentified client. Being honest
        // about who we are gets a truthful status more often than being silent.
        "user-agent": "Mozilla/5.0 (compatible; TrustedMarketingBot/1.0; +https://trustedmarketing.com/bot)",
      },
    });
    return { ok: res.status >= 200 && res.status < 400, status: res.status };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Apply the whole policy to a set of links.
 *
 * Returns kept and rejected separately, because the rejected ones are worth
 * showing: "three sources were dropped as unreachable" tells an editor something
 * useful, whereas silently shipping four links where the model produced seven
 * looks like the model simply wrote four.
 */
export async function applyPolicy(
  links: Link[],
  opts: {
    ownDomain: string;
    competitors: string[];
    knownPages?: Set<string>;
    /** Skip the network check. Used by tests and by MOCK_APIS runs. */
    verify?: boolean;
    fetchImpl?: typeof fetch;
  }
): Promise<{ kept: Link[]; rejected: LinkVerdict[] }> {
  const kept: Link[] = [];
  const rejected: LinkVerdict[] = [];
  const seen = new Set<string>();

  for (const link of links) {
    // The same source cited twice is not two sources.
    const key = link.url.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const verdict = classify(link, opts);
    if (!verdict.ok) {
      rejected.push(verdict);
      continue;
    }

    const host = hostOf(link.url)!;
    const internal = belongsTo(host, opts.ownDomain);

    // Internal links are already checked against known pages; fetching our own
    // site adds latency and tells us nothing new.
    if (internal || opts.verify === false) {
      kept.push(link);
      continue;
    }

    const check = await reachable(link.url, { fetchImpl: opts.fetchImpl });
    if (check.ok) kept.push(link);
    else rejected.push({ link, ok: false, reason: "unreachable", status: check.status });
  }

  return { kept, rejected };
}
