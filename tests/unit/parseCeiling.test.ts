import { describe, it, expect } from "vitest";
import { parseCeiling } from "@/lib/adSpendGuard";

// The guardrail is only as good as what gets stored. A ceiling that silently
// parsed to NaN would disable enforcement while the UI showed it as configured —
// worse than having no ceiling, because it looks safe.

describe("parseCeiling", () => {
  it("treats blank as no ceiling, not as an error", () => {
    // Deliberate choice, not a validation failure: checkSpendGuard() reads a
    // null ceiling as unenforced.
    expect(parseCeiling("")).toEqual({ ok: true, value: null });
    expect(parseCeiling("   ")).toEqual({ ok: true, value: null });
    expect(parseCeiling(null)).toEqual({ ok: true, value: null });
    expect(parseCeiling(undefined)).toEqual({ ok: true, value: null });
  });

  it("accepts zero as a hard stop rather than treating it as blank", () => {
    // 0 must survive: "no spend permitted" is a real setting, and collapsing it
    // to null would turn the strictest ceiling into no ceiling at all.
    expect(parseCeiling("0")).toEqual({ ok: true, value: 0 });
  });

  it("parses plain and decimal numbers", () => {
    expect(parseCeiling("250")).toEqual({ ok: true, value: 250 });
    expect(parseCeiling("99.5")).toEqual({ ok: true, value: 99.5 });
  });

  it("tolerates a currency symbol and thousands separators", () => {
    expect(parseCeiling("$1,500")).toEqual({ ok: true, value: 1500 });
    expect(parseCeiling("12,000.50")).toEqual({ ok: true, value: 12000.5 });
  });

  it("rejects non-numeric input instead of storing NaN", () => {
    const r = parseCeiling("lots");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("not a number");
  });

  it("rejects a negative ceiling", () => {
    const r = parseCeiling("-100");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("negative");
  });

  it("rejects Infinity, which Number() would otherwise accept", () => {
    expect(parseCeiling("Infinity").ok).toBe(false);
  });
});
