import { describe, it, expect } from "vitest";
import { parseWindow, datesInWindow } from "@/lib/campaignDates";

// WO-004. A post advertising a sale three days before it opens sends people to a
// page that is not live yet. These are the phrasings people actually type.

const AUG = new Date(Date.UTC(2026, 7, 1));   // August 2026, 31 days

describe("parseWindow", () => {
  it("reads a range", () => {
    expect(parseWindow("Student sale from the 8th to the 15th, 20% off"))
      .toMatchObject({ from: 8, to: 15 });
  });

  it("reads a hyphenated range", () => {
    expect(parseWindow("Summer clearance 8-15")).toMatchObject({ from: 8, to: 15 });
  });

  it("prefers the RANGE over the single date inside it", () => {
    // "from the 8th to the 15th" contains "the 8th". Matching that first would
    // turn a nine-day sale into a one-day post.
    const w = parseWindow("from the 8th to the 15th");
    expect(w.to).toBe(15);
  });

  it("reads an open-ended start", () => {
    expect(parseWindow("New colourway from the 12th")).toMatchObject({ from: 12, to: null });
  });

  it("reads a single date as a single day", () => {
    expect(parseWindow("Tenth anniversary on the 14th")).toMatchObject({ from: 14, to: 14 });
  });

  it("returns nothing when no date is given", () => {
    expect(parseWindow("Pushing the new colourway")).toMatchObject({ from: null, to: null });
  });

  it("ignores a nonsense day", () => {
    expect(parseWindow("sale on the 47th")).toMatchObject({ from: null });
  });

  it("labels what it understood, so a misread is visible", () => {
    expect(parseWindow("sale from the 8th to the 15th").label).toBe("8th to 15th");
    expect(parseWindow("anniversary on the 14th").label).toBe("on the 14th");
  });
});

describe("datesInWindow", () => {
  it("keeps every date inside the window", () => {
    const out = datesInWindow(AUG, { from: 8, to: 15, label: null }, 4);
    expect(out).toHaveLength(4);
    for (const d of out) {
      const day = Number(d.slice(-2));
      expect(day).toBeGreaterThanOrEqual(8);
      expect(day).toBeLessThanOrEqual(15);
    }
  });

  it("spreads across the window rather than stacking at the start", () => {
    // A sale needs reminding about while it runs, not only when it opens.
    const out = datesInWindow(AUG, { from: 8, to: 15, label: null }, 3);
    expect(new Set(out).size).toBeGreaterThan(1);
    expect(out[0] < out[out.length - 1]).toBe(true);
  });

  it("lands the LAST post on the day for a single-date campaign", () => {
    const out = datesInWindow(AUG, { from: 14, to: 14, label: null }, 3);
    expect(out[out.length - 1]).toBe("2026-08-14");
    // and the run-up comes before it
    expect(out[0] < out[out.length - 1]).toBe(true);
  });

  it("runs to month end when there is no end date", () => {
    const out = datesInWindow(AUG, { from: 28, to: null, label: null }, 2);
    for (const d of out) expect(Number(d.slice(-2))).toBeGreaterThanOrEqual(28);
    expect(out.every((d) => d <= "2026-08-31")).toBe(true);
  });

  it("never runs past the end of a short month", () => {
    const feb = new Date(Date.UTC(2026, 1, 1));  // 28 days
    const out = datesInWindow(feb, { from: 25, to: 31, label: null }, 3);
    for (const d of out) expect(d <= "2026-02-28").toBe(true);
  });
});
