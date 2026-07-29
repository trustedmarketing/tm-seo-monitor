import { describe, it, expect } from "vitest";
import { buildIdeas, topIdeas, ctrAt, isQuestion, type WindowRow } from "@/lib/contentIdeas";

function row(p: Partial<WindowRow> & { query: string }): WindowRow {
  return { page: null, clicks: 0, impressions: 100, ctr: 0, position: 15, ...p };
}

describe("ctrAt", () => {
  it("falls monotonically across page one", () => {
    for (let p = 1; p < 10; p++) expect(ctrAt(p)).toBeGreaterThan(ctrAt(p + 1));
  });

  it("keeps page two worth far less than page one", () => {
    expect(ctrAt(11)).toBeLessThan(ctrAt(10));
    expect(ctrAt(20)).toBeLessThan(ctrAt(11));
  });

  it("does not return zero or negative anywhere", () => {
    for (const p of [1, 5, 10, 15, 25, 100]) expect(ctrAt(p)).toBeGreaterThan(0);
  });
});

describe("isQuestion", () => {
  it("catches question words", () => {
    expect(isQuestion("how often should you service a rooftop unit")).toBe(true);
    expect(isQuestion("What is a chiller")).toBe(true);
  });

  it("catches comparisons, which want the same article shape", () => {
    expect(isQuestion("insulated vs down jacket")).toBe(true);
    expect(isQuestion("gas versus electric heating")).toBe(true);
  });

  it("does not treat a plain service phrase as a question", () => {
    expect(isQuestion("commercial hvac maintenance austin")).toBe(false);
    // "does" appears but not as the first word — must not match.
    expect(isQuestion("maintenance that does the job")).toBe(false);
  });
});

describe("buildIdeas", () => {
  it("calls a position 6-20 query striking distance and wants the page improved", () => {
    const ideas = buildIdeas([row({ query: "commercial hvac maintenance", impressions: 1400, position: 11 })]);
    expect(ideas).toHaveLength(1);
    expect(ideas[0].kind).toBe("striking_distance");
    expect(ideas[0].action).toBe("improve_page");
    expect(ideas[0].expectedClicks).toBeGreaterThan(0);
    expect(ideas[0].basis).toMatch(/CTR curve/);
  });

  it("calls a position >20 query a gap and wants a new article", () => {
    const ideas = buildIdeas([row({ query: "walk in cooler repair", impressions: 170, position: 33 })]);
    expect(ideas[0].kind).toBe("content_gap");
    expect(ideas[0].action).toBe("new_article");
  });

  it("labels a deep-ranking question as a question idea", () => {
    const ideas = buildIdeas([row({ query: "how often should a chiller be serviced", impressions: 220, position: 40 })]);
    expect(ideas[0].kind).toBe("question");
    expect(ideas[0].title.endsWith("?")).toBe(true);
  });

  // The honesty rule this file exists to enforce.
  it("never estimates impact for a gap it cannot measure", () => {
    const ideas = buildIdeas([row({ query: "obscure thing", impressions: 12, position: 60 })]);
    expect(ideas[0].expectedClicks).toBeNull();
    expect(ideas[0].basis).toBeNull();
  });

  it("marks gap estimates low confidence, because impressions understate suppressed demand", () => {
    const ideas = buildIdeas([row({ query: "walk in cooler repair", impressions: 900, position: 30 })]);
    expect(ideas[0].confidence).toBe("low");
  });

  it("ignores single-impression noise", () => {
    const ideas = buildIdeas([
      row({ query: "a", impressions: 3, position: 50 }),
      row({ query: "b", impressions: 9, position: 50 }),
    ]);
    expect(ideas).toHaveLength(0);
  });

  it("does not re-propose a query already in the pipeline", () => {
    const rows = [row({ query: "Commercial HVAC Maintenance", impressions: 1400, position: 11 })];
    // Case-insensitive: the pipeline stores whatever the writer typed.
    expect(buildIdeas(rows, [], new Set(["commercial hvac maintenance"]))).toHaveLength(0);
  });

  it("flags cannibalisation instead of recommending another article", () => {
    const ideas = buildIdeas([
      row({ query: "ac repair", impressions: 800, position: 4 }),
      row({ query: "ac repair", page: "/services/ac", position: 4, impressions: 500 }),
      row({ query: "ac repair", page: "/blog/ac-repair", position: 8, impressions: 300 }),
    ]);
    expect(ideas[0].kind).toBe("cannibalisation");
    expect(ideas[0].action).toBe("improve_page");
    expect(ideas[0].rationale).toMatch(/Consolidate/);
  });

  it("does not flag cannibalisation when only one page is on page one", () => {
    const ideas = buildIdeas([
      // Healthy CTR for #7, so this reaches the striking-distance rule.
      row({ query: "ac repair", impressions: 800, clicks: 26, position: 7 }),
      row({ query: "ac repair", page: "/services/ac", position: 7, impressions: 500 }),
      row({ query: "ac repair", page: "/blog/ac", position: 34, impressions: 300 }),
    ]);
    expect(ideas[0].kind).toBe("striking_distance");
  });

  it("spots rising demand against the prior window", () => {
    const ideas = buildIdeas(
      [row({ query: "heat pump rebate", impressions: 400, position: 25 })],
      [row({ query: "heat pump rebate", impressions: 100, position: 28 })]
    );
    expect(ideas[0].kind).toBe("rising");
    expect(ideas[0].rationale).toMatch(/up 300%/);
  });

  it("does not call flat demand rising", () => {
    const ideas = buildIdeas(
      [row({ query: "heat pump rebate", impressions: 110, position: 25 })],
      [row({ query: "heat pump rebate", impressions: 100, position: 28 })]
    );
    expect(ideas[0].kind).not.toBe("rising");
  });

  it("promises a realistic move, not the top spot", () => {
    const ideas = buildIdeas([row({ query: "x", impressions: 1000, position: 18 })]);
    // From #18 the claim must not be a jump to the top three.
    expect(ideas[0].basis).toMatch(/#18 → #12/);
  });

  it("ranks by opportunity, not alphabetically", () => {
    const ideas = buildIdeas([
      row({ query: "small", impressions: 40, position: 12 }),
      row({ query: "big", impressions: 3000, position: 12 }),
    ]);
    expect(ideas[0].query).toBe("big");
  });

  it("carries the evidence in every rationale", () => {
    const ideas = buildIdeas([
      row({ query: "commercial hvac maintenance", impressions: 1400, position: 11 }),
      row({ query: "walk in cooler repair", impressions: 170, position: 33 }),
    ]);
    // Every rationale must contain a number. A recommendation with no evidence
    // is the thing this module exists to prevent.
    for (const i of ideas) expect(i.rationale).toMatch(/\d/);
  });
});

describe("ctr_gap — the rule the first real data pull exposed", () => {
  // Salty Dog, window ending 2026-07-27. This query ranked #5.1 with 136
  // impressions and 5 clicks and produced NO recommendation at all, because
  // positions 1-6 fell between the striking-distance and gap rules.
  it("flags a page-one ranking that is not earning its clicks", () => {
    const ideas = buildIdeas([
      row({ query: "commercial hvac maintenance", impressions: 1400, clicks: 14, position: 5 }),
    ]);
    expect(ideas[0].kind).toBe("ctr_gap");
    expect(ideas[0].action).toBe("improve_page");
    expect(ideas[0].expectedClicks).toBeGreaterThanOrEqual(5);
    expect(ideas[0].basis).toMatch(/Measured shortfall/);
  });

  // The calibration lesson from the first real pull, pinned so it cannot regress.
  it("stays quiet when a real shortfall is worth almost nothing", () => {
    // Salty Dog: #5.1, 136 impressions, 5 clicks. 3.7% against a 5.2% curve is a
    // genuine shortfall worth ~2 clicks a month. True, and not worth a card.
    const ideas = buildIdeas([
      row({ query: "best salt remover for boats", impressions: 136, clicks: 5, position: 5.1 }),
    ]);
    expect(ideas.find((i) => i.kind === "ctr_gap")).toBeUndefined();
  });

  it("leaves a healthy click rate alone", () => {
    // #3 earning 9.5% against a 9.9% curve — normal variation.
    const ideas = buildIdeas([row({ query: "x", impressions: 2000, clicks: 190, position: 3 })]);
    expect(ideas.find((i) => i.kind === "ctr_gap")).toBeUndefined();
  });

  it("does not rewrite titles for brand terms", () => {
    // "salty dog pods" — #1.4, below-curve CTR, but people searching the brand
    // have already decided. Sitelinks absorb these clicks.
    const ideas = buildIdeas(
      [row({ query: "salty dog pods", impressions: 3000, clicks: 200, position: 1.4 })],
      [], new Set(), ["salty", "dog", "getsaltydog"]
    );
    expect(ideas.find((i) => i.kind === "ctr_gap")).toBeUndefined();
  });

  it("needs enough impressions before calling a click rate low", () => {
    // 12 impressions and 0 clicks is not evidence of anything.
    const ideas = buildIdeas([row({ query: "best boat salt remover", impressions: 12, clicks: 0, position: 2.5 })]);
    expect(ideas.find((i) => i.kind === "ctr_gap")).toBeUndefined();
  });

  it("ranks a click gap above a striking-distance move", () => {
    // The ranking is already won, so it is the cheaper fix and should lead.
    const ideas = buildIdeas([
      row({ query: "cheap win", impressions: 1400, clicks: 14, position: 5 }),
      row({ query: "harder win", impressions: 500, clicks: 2, position: 14 }),
    ]);
    expect(ideas[0].kind).toBe("ctr_gap");
  });

  it("catches a zero-click page-one query once the volume justifies it", () => {
    const ideas = buildIdeas([row({ query: "salty cleaner", impressions: 600, clicks: 0, position: 9.0 })]);
    expect(ideas[0].kind).toBe("ctr_gap");
    expect(ideas[0].confidence).toBe("high");
  });
});

describe("topIdeas", () => {
  it("caps each kind and reports what it held back", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ query: `q${i}`, impressions: 500 - i, position: 12 })
    );
    const { shown, heldBack } = topIdeas(buildIdeas(rows), 3);
    expect(shown).toHaveLength(3);
    expect(heldBack).toBe(7);
  });

  it("keeps the strongest of each kind rather than the first seen", () => {
    const { shown } = topIdeas(
      buildIdeas([
        row({ query: "weak", impressions: 50, position: 12 }),
        row({ query: "strong", impressions: 5000, position: 12 }),
      ]),
      1
    );
    expect(shown[0].query).toBe("strong");
  });
});
