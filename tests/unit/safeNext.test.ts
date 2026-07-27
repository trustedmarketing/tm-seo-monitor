import { describe, it, expect } from "vitest";
import { safeNext } from "@/lib/safeNext";

// Regression guard for the open redirect caught by push review on the first
// deploy of WO-003 Stream A. The original check only asked whether `next`
// pointed at /portal, never whether it pointed at this site at all, so
// /login?next=https://evil.com would sign a user in and then hand them to an
// attacker — convincing precisely because the sign-in itself is genuine.

describe("safeNext · open-redirect guard", () => {
  const offsite = [
    "https://evil.com",
    "http://evil.com/x",
    "//evil.com",                 // protocol-relative: browsers treat as absolute
    "/\\evil.com",                // some browsers normalize to //
    "\\\\evil.com",
    "javascript:alert(1)",
    "https://seo.trustedmarketing.com.evil.com/dashboard", // lookalike host
  ];

  for (const bad of offsite) {
    it(`rejects ${JSON.stringify(bad)} for an agency user`, () => {
      expect(safeNext(bad, true)).toBeNull();
    });
    it(`rejects ${JSON.stringify(bad)} for a client user`, () => {
      expect(safeNext(bad, false)).toBeNull();
    });
  }

  it("allows a same-site agency path", () => {
    expect(safeNext("/dashboard/65f0506d/paid", true)).toBe("/dashboard/65f0506d/paid");
  });

  it("allows a same-site portal path for a client user", () => {
    expect(safeNext("/portal", false)).toBe("/portal");
  });

  it("keeps an agency user out of the portal routes", () => {
    expect(safeNext("/portal", true)).toBeNull();
  });

  it("keeps a client user out of agency routes", () => {
    expect(safeNext("/dashboard", false)).toBeNull();
    expect(safeNext("/admin", false)).toBeNull();
  });

  it("falls back when next is absent", () => {
    expect(safeNext(null, true)).toBeNull();
    expect(safeNext("", false)).toBeNull();
  });
});
