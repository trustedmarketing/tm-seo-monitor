import { describe, it, expect } from "vitest";
import { policyFor, suppressUntil, DECLINE_POLICY } from "@/lib/declinePolicy";

// WO-003. Spec §2 says decline reasons feed the learning layer. The first build
// stored the reason and ignored it, suppressing everything for 60 days — which
// throws the entire signal away.

describe("decline reasons mean different things", () => {
  it("bad timing comes back soon — the proposal was right", () => {
    expect(policyFor("bad timing").suppressDays).toBe(14);
    expect(policyFor("bad timing").redraft).toBe(false);
  });

  it("wrong direction earns exactly one re-draft", () => {
    const p = policyFor("wrong direction");
    expect(p.redraft).toBe(true);
    expect(p.suppressDays).toBe(30);
  });

  it("client said no is a client decision, not a quality signal", () => {
    // Re-asking on a schedule is how an agency becomes annoying.
    expect(policyFor("client said no").suppressDays).toBe(365);
    expect(policyFor("client said no").redraft).toBe(false);
  });

  it("other requires a note — it is the one decline we cannot learn from", () => {
    expect(policyFor("other").requiresNote).toBe(true);
  });

  it("only wrong direction triggers a re-draft", () => {
    const redrafting = Object.entries(DECLINE_POLICY).filter(([, p]) => p.redraft).map(([k]) => k);
    expect(redrafting).toEqual(["wrong direction"]);
  });

  it("an unknown reason falls back to the cautious default rather than never suppressing", () => {
    expect(policyFor("something we never defined").suppressDays).toBe(60);
  });
});

describe("suppressUntil", () => {
  it("computes the date from the reason", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    expect(suppressUntil("bad timing", from)).toBe("2026-01-15");
    expect(suppressUntil("client said no", from)).toBe("2027-01-01");
  });

  it("a shorter reason always returns sooner than a longer one", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    expect(suppressUntil("bad timing", from) < suppressUntil("wrong direction", from)).toBe(true);
    expect(suppressUntil("wrong direction", from) < suppressUntil("client said no", from)).toBe(true);
  });
});
