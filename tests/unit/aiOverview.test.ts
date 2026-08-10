import { describe, it, expect } from "vitest";
import { extractAiOverview } from "@/lib/dataforseo";

// Google's AI Overview is the AI answer with the widest reach, and it costs
// nothing extra to measure: it already arrives in the serp/google/organic
// response we buy for every tracked keyword. We were discarding it.

describe("extractAiOverview", () => {
  it("reports absent when the SERP has no AI Overview", () => {
    expect(extractAiOverview([{ type: "organic", domain: "example.com" }], "getsaltydog.com"))
      .toEqual({ present: false, cited: false });
  });

  it("detects the overview and a citation of our domain", () => {
    const items = [
      { type: "organic", domain: "other.com" },
      {
        type: "ai_overview",
        references: [
          { domain: "wikipedia.org", url: "https://wikipedia.org/x" },
          { domain: "getsaltydog.com", url: "https://getsaltydog.com/products" },
        ],
      },
    ];
    expect(extractAiOverview(items, "getsaltydog.com")).toEqual({ present: true, cited: true });
  });

  it("reports present-but-not-cited — the actionable case", () => {
    // Google answered the question with AI and used somebody else's site. That
    // is a different problem from "no AI Overview appeared", and collapsing the
    // two would hide the one worth acting on.
    const items = [{ type: "ai_overview", references: [{ domain: "competitor.com" }] }];
    expect(extractAiOverview(items, "getsaltydog.com")).toEqual({ present: true, cited: false });
  });

  it("finds references nested inside child elements, not just the top-level item", () => {
    // Layout varies: references can hang off ai_overview_element children.
    // Reading only the top level would report "not cited" for a brand that was.
    const items = [
      {
        type: "ai_overview",
        items: [
          { type: "ai_overview_element", references: [{ url: "https://www.getsaltydog.com/guide" }] },
        ],
      },
    ];
    expect(extractAiOverview(items, "getsaltydog.com")).toEqual({ present: true, cited: true });
  });

  it("ignores www. and case when matching the domain", () => {
    const items = [{ type: "ai_overview", references: [{ domain: "WWW.GetSaltyDog.com" }] }];
    expect(extractAiOverview(items, "getsaltydog.com").cited).toBe(true);
  });

  it("does not match a domain that merely contains ours as a substring", () => {
    // notgetsaltydog.com must not count as getsaltydog.com.
    const items = [{ type: "ai_overview", references: [{ domain: "notgetsaltydog.com" }] }];
    expect(extractAiOverview(items, "saltydog.com").cited).toBe(false);
  });

  it("handles an empty item list without throwing", () => {
    expect(extractAiOverview([], "example.com")).toEqual({ present: false, cited: false });
  });
});
