import { describe, it, expect } from "vitest";
import { createFakeDb } from "../helpers/fakeDb";
import { buildClientBrief, formatBriefEmail, formatBriefSlack } from "@/lib/dailyBrief";

const client = { id: "c1", name: "Salty Dog", domain: "getsaltydog.com", slack_webhook_url: "https://hooks.slack.com/services/x" };

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

describe("buildClientBrief", () => {
  it("computes SEO/AEO deltas from the two most recent snapshots", async () => {
    const db = createFakeDb({
      metric_snapshots: [
        { id: 1, client_id: "c1", captured_at: isoDaysAgo(2), organic_traffic: 7000, organic_keywords: 200, backlinks: 900, visibility: 40, ai_visibility: 30, ai_mentions: 6 },
        { id: 2, client_id: "c1", captured_at: isoDaysAgo(0), organic_traffic: 7696, organic_keywords: 229, backlinks: 976, visibility: 44, ai_visibility: 35, ai_mentions: 8 },
      ],
    }) as any;

    const brief = await buildClientBrief(db, client);

    expect(brief.seo).toMatchObject({ organicTraffic: 7696, organicTrafficDelta: 696, organicKeywords: 229, organicKeywordsDelta: 29 });
    expect(brief.aeo).toMatchObject({ aiVisibility: 35, aiVisibilityDelta: 5, aiMentions: 8, aiMentionsDelta: 2 });
    expect(brief.wins).toContain("Organic traffic up 696 vs prior check");
    expect(brief.wins).toContain("AI visibility up 5.0pt");
    expect(brief.losses).toHaveLength(0);
  });

  it("flags declines as losses, not wins", async () => {
    const db = createFakeDb({
      metric_snapshots: [
        { id: 1, client_id: "c1", captured_at: isoDaysAgo(2), organic_traffic: 8000, organic_keywords: 250, backlinks: 900, visibility: 40, ai_visibility: 40, ai_mentions: 10 },
        { id: 2, client_id: "c1", captured_at: isoDaysAgo(0), organic_traffic: 7500, organic_keywords: 240, backlinks: 900, visibility: 38, ai_visibility: 32, ai_mentions: 7 },
      ],
    }) as any;

    const brief = await buildClientBrief(db, client);

    expect(brief.losses).toContain("Organic traffic down 500 vs prior check");
    expect(brief.losses).toContain("AI visibility down 8.0pt");
    expect(brief.wins.some((w) => w.includes("Organic traffic up"))).toBe(false);
  });

  it("handles a client with only one snapshot (no prior to diff against)", async () => {
    const db = createFakeDb({
      metric_snapshots: [
        { id: 1, client_id: "c1", captured_at: isoDaysAgo(0), organic_traffic: 100, organic_keywords: 10, backlinks: 5, visibility: 20, ai_visibility: null, ai_mentions: null },
      ],
    }) as any;

    const brief = await buildClientBrief(db, client);

    expect(brief.seo).toMatchObject({ organicTraffic: 100, organicTrafficDelta: null });
    expect(brief.aeo).toBeNull();
  });

  it("returns null seo/aeo for a client with no snapshots yet", async () => {
    const db = createFakeDb({}) as any;
    const brief = await buildClientBrief(db, client);
    expect(brief.seo).toBeNull();
    expect(brief.aeo).toBeNull();
    expect(brief.paid.every((p) => !p.connected)).toBe(true);
  });

  it("computes per-platform paid trend from day-prior vs 7-day-trailing ROAS", async () => {
    // Relative to today, not a fixed date. buildClientBrief anchors its ANALYSIS
    // on the latest date present in the rows, but its QUERY still filters
    // `date >= eightDaysAgo` from Date.now() — so a hard-coded anchor silently
    // ages out of the window and the test starts asserting on zero rows. This
    // was pinned to 2026-08-09 and began failing on 2026-08-18, testing nothing
    // in between except that the fixture was still recent enough.
    const anchor = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const rows = [];
    // six flat days at 2x ROAS ($100 spend / $200 revenue), then a strong anchor day at 4x
    for (let i = 6; i >= 1; i--) {
      const d = new Date(anchor + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - i);
      rows.push({ id: rows.length + 1, client_id: "c1", platform: "meta", date: d.toISOString().slice(0, 10), spend: 100, revenue: 200 });
    }
    rows.push({ id: rows.length + 1, client_id: "c1", platform: "meta", date: anchor, spend: 100, revenue: 400 });

    const db = createFakeDb({ ad_metrics_daily: rows }) as any;
    const brief = await buildClientBrief(db, client);

    const meta = brief.paid.find((p) => p.platform === "meta")!;
    expect(meta.connected).toBe(true);
    expect(meta.trend).toBe("up");
    expect(brief.wins.some((w) => w.startsWith("meta: ROAS trending up"))).toBe(true);

    const google = brief.paid.find((p) => p.platform === "google_ads")!;
    expect(google.connected).toBe(false);
    expect(google.trend).toBeNull();
  });

  it("surfaces measured changes as wins/losses by verdict", async () => {
    const db = createFakeDb({
      changes: [
        { id: 1, client_id: "c1", title: "Rewrote H1 on /pages/collars", verdict: "improved", measured_at: isoDaysAgo(1) },
        { id: 2, client_id: "c1", title: "Added schema to product pages", verdict: "declined", measured_at: isoDaysAgo(1) },
        { id: 3, client_id: "c1", title: "Too old to count", verdict: "improved", measured_at: isoDaysAgo(10) },
      ],
    }) as any;

    const brief = await buildClientBrief(db, client);

    expect(brief.wins).toContain("Rewrote H1 on /pages/collars — measured improvement");
    expect(brief.losses).toContain("Added schema to product pages — measured decline");
    expect(brief.wins.some((w) => w.includes("Too old to count"))).toBe(false);
  });

  it("sorts open recommendations by severity and caps opportunities at 5", async () => {
    const recs = ["low", "high", "medium", "high", "low", "medium", "high"].map((severity, i) => ({
      id: i + 1, client_id: "c1", title: `Rec ${i}`, severity, category: "SEO", status: "open",
    }));
    const db = createFakeDb({ recommendations: recs }) as any;

    const brief = await buildClientBrief(db, client);

    expect(brief.openRecommendationCount).toBe(7);
    expect(brief.opportunities).toHaveLength(5);
    // 3 high + 2 medium fill the top 5; low-severity items fall outside the cap.
    expect(brief.opportunities.filter((o) => o.severity === "high")).toHaveLength(3);
    expect(brief.opportunities.filter((o) => o.severity === "medium")).toHaveLength(2);
    expect(brief.opportunities.some((o) => o.severity === "low")).toBe(false);
  });

  it("carries the client's slack webhook through unchanged", async () => {
    const db = createFakeDb({}) as any;
    const brief = await buildClientBrief(db, client);
    expect(brief.slackWebhookUrl).toBe("https://hooks.slack.com/services/x");

    const brief2 = await buildClientBrief(db, { ...client, slack_webhook_url: null });
    expect(brief2.slackWebhookUrl).toBeNull();
  });
});

describe("formatBriefEmail / formatBriefSlack", () => {
  it("renders a consolidated email across multiple clients with no crashes on missing data", async () => {
    const db = createFakeDb({
      metric_snapshots: [
        { id: 1, client_id: "c1", captured_at: isoDaysAgo(1), organic_traffic: 100, organic_keywords: 10, backlinks: 5, visibility: 20, ai_visibility: 10, ai_mentions: 1 },
        { id: 2, client_id: "c1", captured_at: isoDaysAgo(0), organic_traffic: 120, organic_keywords: 12, backlinks: 6, visibility: 22, ai_visibility: 15, ai_mentions: 2 },
      ],
    }) as any;
    const brief1 = await buildClientBrief(db, client);
    const brief2 = await buildClientBrief(db, { id: "c2", name: "No Data Yet Co", domain: "nodata.example", slack_webhook_url: null });

    const { subject, text } = formatBriefEmail([brief1, brief2], "2026-08-10");

    expect(subject).toBe("Growth OS daily brief — 2026-08-10");
    expect(text).toContain("Salty Dog (getsaltydog.com)");
    expect(text).toContain("No Data Yet Co (nodata.example)");
    expect(text).toContain("SEO: no data yet");
    expect(text).toContain("/dashboard/c1");
  });

  it("renders a per-client Slack message with wins/losses/opportunities sections", async () => {
    const db = createFakeDb({
      changes: [{ id: 1, client_id: "c1", title: "Fixed noindex on collection page", verdict: "improved", measured_at: isoDaysAgo(1) }],
    }) as any;
    const brief = await buildClientBrief(db, client);

    const text = formatBriefSlack(brief);

    expect(text).toContain("*Salty Dog — daily brief*");
    expect(text).toContain("Fixed noindex on collection page — measured improvement");
    expect(text).toContain("none today"); // losses section, none recorded
    expect(text).toContain("none open"); // opportunities section, none recorded
  });
});
