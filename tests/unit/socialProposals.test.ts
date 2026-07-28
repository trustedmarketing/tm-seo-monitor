import { describe, it, expect } from "vitest";
import { proposeSeries, type SocialPost } from "@/lib/socialProposals";

// WO-003 / Module E. These become client-facing content plans, so the bar is
// "does the data actually support this claim", not "did it produce output".

const post = (id: number, over: Partial<SocialPost> = {}): SocialPost => ({
  id, title: `Post ${id}`, content: null, postType: "image", permalink: null,
  postedAt: new Date().toISOString(),
  engagements: 100, saves: 0, shares: 0, linkClicks: 0, reach: 1000, ...over,
});

const baseline = () => [1, 2, 3, 4, 5, 6].map((i) => post(i));

describe("proposeSeries", () => {
  it("proposes nothing without enough history to have a median", () => {
    // Three posts is a coin flip, not evidence.
    expect(proposeSeries([post(1), post(2, { engagements: 900 }), post(3)])).toEqual([]);
  });

  it("proposes nothing when everything performs the same", () => {
    expect(proposeSeries(baseline())).toEqual([]);
  });

  it("spots a genuine outperformer", () => {
    const posts = [...baseline(), post(9, { engagements: 400, saves: 20, linkClicks: 6 })];
    const out = proposeSeries(posts);
    expect(out).toHaveLength(1);
    expect(out[0].sourcePostId).toBe(9);
    expect(out[0].multiple).toBeGreaterThan(1.8);
  });

  it("ignores a high multiple built on a tiny denominator", () => {
    // 5 engagements against a median of 2 is 2.5x and means nothing.
    const tiny = [1, 2, 3, 4, 5, 6].map((i) => post(i, { engagements: 2 }));
    expect(proposeSeries([...tiny, post(9, { engagements: 5 })])).toEqual([]);
  });

  it("weights saves and clicks above raw engagement", () => {
    const posts = [
      ...baseline(),
      post(8, { engagements: 180 }),                          // popular
      post(9, { engagements: 120, saves: 30, linkClicks: 12 }), // effective
    ];
    const out = proposeSeries(posts);
    // The one that moved people should outrank the one that got attention.
    expect(out[0].sourcePostId).toBe(9);
  });

  it("reserves High for the genuinely exceptional", () => {
    const posts = [...baseline(), post(9, { engagements: 250 })];
    expect(proposeSeries(posts)[0].severity).toBe("Medium");

    const huge = [...baseline(), post(9, { engagements: 900, saves: 40 })];
    expect(proposeSeries(huge)[0].severity).toBe("High");
  });

  it("caps at two — four 'do more of this' cards is not four times as useful", () => {
    const posts = [
      ...baseline(),
      post(7, { engagements: 400 }), post(8, { engagements: 420 }),
      post(9, { engagements: 440 }), post(10, { engagements: 460 }),
    ];
    expect(proposeSeries(posts).length).toBeLessThanOrEqual(2);
  });

  it("states the multiple in the reasoning, not just a claim that it worked", () => {
    const out = proposeSeries([...baseline(), post(9, { engagements: 400, linkClicks: 6 })]);
    expect(out[0].why).toMatch(/\d\.\d× your median/);
    expect(out[0].why).toContain("6 people");
  });

  it("produces a four-week outline that is a brief, not written copy", () => {
    const out = proposeSeries([...baseline(), post(9, { engagements: 400 })]);
    expect(out[0].outline).toHaveLength(4);
    expect(out[0].outline[0]).toMatch(/^Week 1/);
  });
});
