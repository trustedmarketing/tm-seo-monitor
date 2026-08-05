import { describe, it, expect } from "vitest";
import { createFakeDb } from "../helpers/fakeDb";
import { syncRecommendations } from "@/lib/recSync";

const CLIENT_ID = "66666666-6666-6666-6666-666666666666";

describe("syncRecommendations — paid recs (WO-006 stream C)", () => {
  it("persists a Paid-category recommendation built from campaigns + ad_metrics_daily", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const db = createFakeDb({
      clients: [{ id: CLIENT_ID }],
      campaigns: [
        {
          id: "camp-1",
          client_id: CLIENT_ID,
          platform: "meta",
          campaign_id: "120210000000001",
          campaign_name: "Prospecting - Broad",
          status: "active",
          daily_budget: null,
        },
      ],
      ad_metrics_daily: [
        // 0.5x ROAS, well under the meta benchmark (~2-3x) — triggers the 30-day rule.
        { client_id: CLIENT_ID, campaign_id: "120210000000001", platform: "meta", date: today, spend: 1000, revenue: 500 },
      ],
    }) as any;

    await syncRecommendations(db, CLIENT_ID);

    const recs = db._rows("recommendations");
    const paidRecs = recs.filter((r: any) => r.category === "Paid");
    expect(paidRecs.length).toBeGreaterThan(0);
    expect(paidRecs[0]).toMatchObject({ client_id: CLIENT_ID, status: "open" });
    expect(paidRecs[0].rule_key).toContain("paid_roas_30d_");
  });

  it("auto-resolves a Paid recommendation once its campaign stops firing the rule", async () => {
    const db = createFakeDb({
      clients: [{ id: CLIENT_ID }],
      campaigns: [],
      ad_metrics_daily: [],
      recommendations: [
        {
          id: "rec-1",
          client_id: CLIENT_ID,
          rule_key: "paid_roas_30d_camp-1",
          category: "Paid",
          severity: "high",
          title: "stale",
          detail: "stale",
          status: "open",
        },
      ],
    }) as any;

    await syncRecommendations(db, CLIENT_ID);

    const rec = db._rows("recommendations").find((r: any) => r.id === "rec-1");
    expect(rec.status).toBe("resolved"); // no campaigns left -> rule no longer fires
  });
});
