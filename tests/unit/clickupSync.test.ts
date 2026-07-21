import { describe, it, expect, vi, afterEach } from "vitest";
import { createFakeDb } from "../helpers/fakeDb";
import { syncApprovedRecs, markShippedFromClickup } from "@/lib/clickupSync";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const REC_ID = "22222222-2222-2222-2222-222222222222";

function seedDb() {
  return createFakeDb({
    clients: [{ id: CLIENT_ID, clickup_list_id: "901234" }],
    recommendations: [
      {
        id: REC_ID,
        client_id: CLIENT_ID,
        rule_key: "striking_distance",
        severity: "high",
        category: "SEO",
        title: "Push /pages/salt-wash into the top 3",
        detail: "Currently position 6, up from 9.",
        status: "approved",
        clickup_task_id: null,
      },
    ],
  }) as any;
}

describe("clickupSync.syncApprovedRecs", () => {
  it("creates a ClickUp task for an approved rec and stores task id/url/synced_at (MOCK_APIS)", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = seedDb();

    const synced = await syncApprovedRecs(db, { id: CLIENT_ID, clickup_list_id: "901234" });
    expect(synced).toBe(1);

    const rec = db._rows("recommendations")[0];
    expect(rec.clickup_task_id).toBeTruthy();
    expect(rec.clickup_task_url).toMatch(/^https:\/\/app\.clickup\.com\/t\//);
    expect(rec.clickup_synced_at).toBeTruthy();

    const run = db._rows("collector_runs")[0];
    expect(run).toMatchObject({ module: "clickup_sync", client_id: CLIENT_ID, status: "success", rows_written: 1 });
  });

  it("does not touch recs that are not status='approved'", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = createFakeDb({
      clients: [{ id: CLIENT_ID, clickup_list_id: "901234" }],
      recommendations: [
        { id: REC_ID, client_id: CLIENT_ID, title: "t", detail: "d", severity: "low", status: "open", clickup_task_id: null },
      ],
    }) as any;

    const synced = await syncApprovedRecs(db, { id: CLIENT_ID, clickup_list_id: "901234" });
    expect(synced).toBe(0);
    expect(db._rows("recommendations")[0].clickup_task_id).toBeNull();
  });

  it("skips recs that already have a clickup_task_id", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = createFakeDb({
      clients: [{ id: CLIENT_ID, clickup_list_id: "901234" }],
      recommendations: [
        { id: REC_ID, client_id: CLIENT_ID, title: "t", detail: "d", severity: "low", status: "approved", clickup_task_id: "already-synced" },
      ],
    }) as any;

    const synced = await syncApprovedRecs(db, { id: CLIENT_ID, clickup_list_id: "901234" });
    expect(synced).toBe(0);
  });

  it("records a skipped run and does not throw when the client has no clickup_list_id", async () => {
    const db = seedDb();
    const synced = await syncApprovedRecs(db, { id: CLIENT_ID, clickup_list_id: null });
    expect(synced).toBe(0);
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("skipped");
  });

  it("does not throw and skips the rec when CLICKUP_TOKEN is unset and MOCK_APIS is off", async () => {
    vi.stubEnv("MOCK_APIS", "");
    vi.stubEnv("CLICKUP_TOKEN", "");
    const db = seedDb();

    const synced = await syncApprovedRecs(db, { id: CLIENT_ID, clickup_list_id: "901234" });
    expect(synced).toBe(0);
    expect(db._rows("recommendations")[0].clickup_task_id).toBeNull();
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("success"); // ran fine, just synced 0 because ClickUp no-op'd
  });

  it("records an error run instead of throwing when the recommendations query fails", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const db = seedDb();
    const realFrom = db.from.bind(db);
    // Mock only the initial "fetch approved recs" chain in clickupSync.ts:
    // select(...).eq(...).eq(...).is(...) — everything else (updates, collector_runs
    // inserts) still goes through the real fakeDb.
    db.from = (table: string) =>
      table === "recommendations"
        ? { select: () => ({ eq: () => ({ eq: () => ({ is: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }) }) }
        : realFrom(table);

    const synced = await syncApprovedRecs(db, { id: CLIENT_ID, clickup_list_id: "901234" });
    expect(synced).toBe(0);
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("error");
    expect(run.error).toContain("boom");
  });
});

describe("clickupSync.markShippedFromClickup", () => {
  it("flips the rec to 'measuring' and inserts a changes ledger row with source='clickup'", async () => {
    const db = createFakeDb({
      recommendations: [
        { id: REC_ID, client_id: CLIENT_ID, title: "t", detail: "d", severity: "low", status: "approved" },
      ],
    }) as any;

    const ok = await markShippedFromClickup(db, REC_ID, "Shipped via ClickUp: rewrote title tag");
    expect(ok).toBe(true);

    const rec = db._rows("recommendations")[0];
    expect(rec.status).toBe("measuring");
    expect(rec.shipped_at).toBeTruthy();

    const changes = db._rows("changes");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      client_id: CLIENT_ID,
      recommendation_id: REC_ID,
      source: "clickup",
      title: "Shipped via ClickUp: rewrote title tag",
    });
  });

  it("returns false and does not throw when the recommendation does not exist", async () => {
    const db = createFakeDb({ recommendations: [] }) as any;
    const ok = await markShippedFromClickup(db, "does-not-exist", "whatever");
    expect(ok).toBe(false);
    expect(db._rows("changes")).toHaveLength(0);
  });
});
