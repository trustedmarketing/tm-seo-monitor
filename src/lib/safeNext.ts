// lib/safeNext.ts — open-redirect guard for the post-login `next` parameter.
//
// `next` is attacker-controllable via the query string, so it is only honored
// when it is unambiguously a path on this site.
//
// Rejected: absolute URLs ("https://evil.com"), protocol-relative ("//evil.com",
// which browsers treat as absolute), and backslashes (some browsers normalize
// "/\evil.com" into a protocol-relative URL).
//
// Without this, /login?next=https://evil.com signs a user in legitimately and
// then hands them to an attacker page — a credible re-auth phishing flow,
// precisely because everything up to the redirect is genuine. Caught by push
// review on the first deploy of WO-003 Stream A.
export function safeNext(next: string | null, isAgency: boolean): string | null {
  if (!next) return null;
  if (!next.startsWith("/")) return null;      // absolute, or relative-to-current
  if (next.startsWith("//")) return null;      // protocol-relative
  if (next.includes("\\")) return null;        // normalized to // by some browsers

  // Also keep each side of the product out of the other's routes.
  const wantsPortal = next.startsWith("/portal");
  if (isAgency && wantsPortal) return null;
  if (!isAgency && !wantsPortal) return null;

  return next;
}
