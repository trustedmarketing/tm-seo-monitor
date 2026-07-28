import { describe, it, expect } from "vitest";
import { classifyChecks, criticalIssues, issueCounts, grade } from "@/lib/qc";

// WO-003. DataForSEO returns ~90 named checks with a count each. Rendering that
// raw implies "canonical_to_redirect: 2" and "is_5xx_code: 40" are comparable
// problems. They are not.

describe("classifyChecks", () => {
  it("ranks critical before high before medium", () => {
    const out = classifyChecks({ no_description: 10, is_5xx_code: 1, no_title: 3 });
    expect(out.map((i) => i.check)).toEqual(["is_5xx_code", "no_title", "no_description"]);
  });

  it("drops checks with a zero count — a check nothing fails is not an issue", () => {
    expect(classifyChecks({ no_title: 0, broken_links: 2 }).map((i) => i.check)).toEqual(["broken_links"]);
  });

  it("keeps an UNKNOWN check rather than hiding it", () => {
    // A new crawler rule we have not classified is still a finding. Silently
    // dropping it is how a new failure mode goes unnoticed.
    const out = classifyChecks({ some_new_check_they_added: 4 });
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("low");
    expect(out[0].label).toBe("Some new check they added");
    expect(out[0].why).toMatch(/no guidance recorded/i);
  });

  it("treats noindex as critical — the classic invisible disaster", () => {
    expect(classifyChecks({ meta_noindex: 1 })[0].severity).toBe("critical");
  });

  it("sorts by count within the same severity", () => {
    const out = classifyChecks({ no_title: 2, duplicate_title: 9 });
    expect(out[0].check).toBe("duplicate_title");
  });
});

describe("criticalIssues", () => {
  it("returns only what should bypass the approval queue", () => {
    const out = criticalIssues(classifyChecks({ is_5xx_code: 1, no_description: 20, meta_noindex: 2 }));
    expect(out.map((i) => i.check).sort()).toEqual(["is_5xx_code", "meta_noindex"]);
  });

  it("is empty on a healthy site rather than inventing urgency", () => {
    expect(criticalIssues(classifyChecks({ no_favicon: 1 }))).toEqual([]);
  });
});

describe("issueCounts", () => {
  it("counts affected PAGES, not check types", () => {
    // Three checks, but forty pages of pain. The page count is the real scale.
    const counts = issueCounts(classifyChecks({ is_5xx_code: 40, no_title: 3, no_favicon: 1 }));
    expect(counts.critical).toBe(40);
    expect(counts.high).toBe(3);
    expect(counts.low).toBe(1);
  });
});

describe("grade", () => {
  it("is deliberately coarse — a 0.4 move is noise", () => {
    expect(grade(91.2)).toBe("Good");
    expect(grade(90.8)).toBe("Good");
  });

  it("names the bands", () => {
    expect(grade(80)).toBe("Fair");
    expect(grade(60)).toBe("Poor");
    expect(grade(20)).toBe("Critical");
    expect(grade(null)).toBe("—");
  });
});
