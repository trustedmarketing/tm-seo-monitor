import { describe, it, expect, beforeEach } from "vitest";
import { stage, publish, revert, preflight, WP_CHANGE_LABEL } from "@/lib/wordpressAdapter";

// WO-003 Stream E-W. Exercised through MOCK_APIS, matching every other adapter,
// so the pipeline is testable before WP Engine credentials exist.

beforeEach(() => { process.env.MOCK_APIS = "1"; });

const TARGET = { siteUrl: "https://example.test", postType: "pages" as const, id: 42 };
const CHANGE = { type: "post_title" as const, target: TARGET, proposed: "Commercial HVAC Maintenance" };

describe("wordpressAdapter · safety", () => {
  it("publish DEFAULTS to dry run", async () => {
    const staged = await stage("https://example.test", "u", "p", CHANGE);
    const res = await publish("https://example.test", "u", "p", staged);
    expect(res.dryRun).toBe(true);
    expect(res.detail).toMatch(/nothing written/i);
  });

  it("revert DEFAULTS to dry run", async () => {
    const r = { target: TARGET, type: CHANGE.type, value: "old" };
    expect((await revert("https://example.test", "u", "p", r)).dryRun).toBe(true);
  });

  it("carries the ORIGINAL value for reversal, not the new one", async () => {
    const staged = await stage("https://example.test", "u", "p", CHANGE);
    const res = await publish("https://example.test", "u", "p", staged, { dryRun: false });
    expect(res.revert.value).toBe(staged.current);
    expect(res.revert.value).not.toBe(CHANGE.proposed);
  });
});

describe("wordpressAdapter · preflight", () => {
  it("reports write capability and the SEO plugin separately", async () => {
    const p = await preflight("https://example.test", "u", "p");
    // 'plugin installed' and 'we can write its fields' are different claims.
    expect(p.canWrite).toBe(true);
    expect(p.seoPlugin).toBe("rankmath");
    expect(p.seoWritable).toBe(true);
  });
});

describe("wordpressAdapter · labels", () => {
  it("distinguishes the page heading from the search listing title", () => {
    // The Shopify lesson: a card that changes one field and reads like another
    // is a trap. Same two fields exist in WordPress.
    expect(WP_CHANGE_LABEL.post_title).toMatch(/heading on the page/i);
    expect(WP_CHANGE_LABEL.post_seo_title).toMatch(/search results only/i);
  });
});
