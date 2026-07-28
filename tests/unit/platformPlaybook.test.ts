import { describe, it, expect } from "vitest";
import { formatSequence, defaultCadence, playbookFor } from "@/lib/platformPlaybook";

// WO-004. These rules decide what a client's month looks like, so the mechanics
// get tested even though the judgements inside them are arguable by design.

describe("formatSequence", () => {
  it("returns exactly the number of slots asked for", () => {
    for (const n of [1, 4, 7, 12, 20, 31]) {
      expect(formatSequence("instagram", n)).toHaveLength(n);
    }
  });

  it("mixes formats rather than repeating one", () => {
    const out = formatSequence("instagram", 12);
    expect(new Set(out).size).toBeGreaterThan(1);
  });

  it("does not open the month with a run of the same format", () => {
    // The interleave exists so a client does not see four carousels back to back.
    const out = formatSequence("instagram", 12);
    expect(out[0]).not.toBe(out[1]);
  });

  it("falls back to something usable for an unknown network", () => {
    const out = formatSequence("myspace", 5);
    expect(out).toHaveLength(5);
  });
});

describe("defaultCadence", () => {
  it("uses the LOW end of each range", () => {
    // Committing an agency to a volume it never agreed to is worse than
    // under-planning and saying so.
    const ig = playbookFor("instagram")!;
    expect(defaultCadence(["instagram"])).toBe(ig.cadence.min);
  });

  it("adds up across networks", () => {
    const both = defaultCadence(["instagram", "linkedin"]);
    expect(both).toBe(playbookFor("instagram")!.cadence.min + playbookFor("linkedin")!.cadence.min);
  });

  it("returns a sane number when nothing is recognised", () => {
    expect(defaultCadence([])).toBe(12);
    expect(defaultCadence(["myspace"])).toBe(12);
  });
});

describe("playbookFor", () => {
  it("is case insensitive, since platforms name themselves inconsistently", () => {
    expect(playbookFor("Instagram")?.network).toBe("instagram");
    expect(playbookFor("INSTAGRAM")?.network).toBe("instagram");
  });

  it("returns null rather than a wrong default for an unknown network", () => {
    expect(playbookFor("myspace")).toBeNull();
    expect(playbookFor(null)).toBeNull();
  });
});

describe("vendor network names", () => {
  it("maps PostFlow's linkedin_page to the LinkedIn playbook", () => {
    // Without this, every LinkedIn slot fell back to a plain image on default
    // days, losing the format mix and the no-links-in-body rule.
    expect(playbookFor("linkedin_page")?.network).toBe("linkedin");
  });

  it("knows Google Business Profile", () => {
    const gbp = playbookFor("google_business_profile");
    expect(gbp).not.toBeNull();
    expect(gbp!.cadence.min).toBeLessThan(gbp!.cadence.max);
  });

  it("still returns null for something genuinely unknown", () => {
    expect(playbookFor("bebo")).toBeNull();
  });
});
