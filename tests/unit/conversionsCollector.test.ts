import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import { createFakeDb } from "../helpers/fakeDb";
import { collectConversions } from "@/lib/conversionsCollector";

beforeAll(() => { vi.stubEnv("MOCK_APIS", "1"); });
afterEach(() => { vi.stubEnv("MOCK_APIS", "1"); }); // restore after tests that flip it off
afterAll(() => { vi.unstubAllEnvs(); });

describe("collectConversions", () => {
  it("writes rows to conversions_daily and records a collector_runs success row", async () => {
    const db = createFakeDb() as any;
    const client = { id: "c1", domain: "example.com", ga4_property_id: "properties/123456789" };

    const written = await collectConversions(db, client);

    expect(written).toBe(5); // matches tests/fixtures/ga4/daily_conversions.json row count
    const rows = db._rows("conversions_daily");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      client_id: "c1", date: "2026-06-22", source: "Organic Search", sessions: 412, conversions: 9, revenue: 1180.50,
    });

    const run = db._rows("collector_runs")[0];
    expect(run).toMatchObject({ module: "conversions", client_id: "c1", status: "success", rows_written: 5 });
  });

  it("updates an existing row instead of duplicating it on a second run", async () => {
    const db = createFakeDb() as any;
    const client = { id: "c1", domain: "example.com", ga4_property_id: "properties/123456789" };

    await collectConversions(db, client);
    await collectConversions(db, client);

    const rows = db._rows("conversions_daily");
    expect(rows).toHaveLength(5); // still 5 — second run updated, not appended
  });

  it("records a collector_runs error row instead of throwing when the API call fails", async () => {
    const db = createFakeDb() as any;
    const client = { id: "c2", domain: "broken.example", ga4_property_id: "properties/999" };

    // Force the real (non-fixture) path, which throws on missing service-account
    // creds before ever attempting a network call — a stand-in for "the API call
    // failed" without needing a live GA4 credential.
    vi.stubEnv("MOCK_APIS", "0");
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    const written = await collectConversions(db, client);

    expect(written).toBe(0);
    expect(db._rows("conversions_daily")).toHaveLength(0);
    const run = db._rows("collector_runs")[0];
    expect(run).toMatchObject({ module: "conversions", client_id: "c2", status: "error" });
    expect(run.error).toContain("GOOGLE_SERVICE_ACCOUNT_JSON");
  });

  it("records a collector_runs error row (not a throw) when ga4_property_id is missing", async () => {
    const db = createFakeDb() as any;
    const client = { id: "c3", domain: "no-property.example" };

    const written = await collectConversions(db, client);

    expect(written).toBe(0);
    const run = db._rows("collector_runs")[0];
    expect(run.status).toBe("error");
    expect(run.error).toContain("ga4_property_id");
  });
});
