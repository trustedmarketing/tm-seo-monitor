import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { GET } from "@/app/api/cron/collect/route";

// Live integration against tm-growth-staging. Run via `npm run test:staging`,
// which loads .env.staging.local (staging Supabase + MOCK_APIS=1 so no real
// DataForSEO/GSC credits are spent). Skipped automatically if env is absent.
const hasEnv = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.CRON_SECRET);
const d = hasEnv ? describe : describe.skip;

d("collector · green against staging", () => {
  let json: any;
  const runStart = new Date().toISOString();

  beforeAll(async () => {
    const req = new Request("http://localhost/api/cron/collect?force=1", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    json = await res.json();
  });

  it("MOCK_APIS is on so no live credits are spent", () => {
    expect(process.env.MOCK_APIS).toBe("1");
  });

  it("reports zero module failures", () => {
    expect(json.failures).toBe(0);
    const allLines = Object.values(json.report as Record<string, string[]>).flat();
    expect(allLines.some((l) => l.includes("FAILED"))).toBe(false);
  });

  it("processed both seeded clients with core/serp/ai/recs steps", () => {
    const domains = Object.keys(json.report);
    expect(domains).toContain("sharkey-air.example");
    expect(domains).toContain("salty-dog.example");
    const sharkey = (json.report as any)["sharkey-air.example"] as string[];
    expect(sharkey.some((l) => l.startsWith("core"))).toBe(true);
    expect(sharkey.some((l) => l.startsWith("serp"))).toBe(true);
    expect(sharkey.some((l) => l.startsWith("ai"))).toBe(true);
    expect(sharkey).toContain("recs synced");
  });

  it("collected Google + Microsoft ads for the seeded Salty Dog account", async () => {
    const salty = (json.report as any)["salty-dog.example"] as string[];
    const g = salty.find((l) => l.startsWith("google ads ("));
    const ms = salty.find((l) => l.startsWith("microsoft ads ("));
    expect(g).toBeTruthy();
    expect(ms).toBeTruthy();
    // mock fixtures return >0 rows for a seeded account
    expect(Number(g!.match(/\((\d+)\)/)?.[1])).toBeGreaterThan(0);
    expect(Number(ms!.match(/\((\d+)\)/)?.[1])).toBeGreaterThan(0);

    // Confirm the rows persist in ad_metrics_daily. The collector upserts
    // idempotently (no updated_at column), so a re-run updates rather than
    // inserts — the report-line counts above are what prove *this* run
    // collected; here we just assert both platforms landed for this client.
    const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data } = await db
      .from("ad_metrics_daily")
      .select("platform")
      .eq("client_id", "22222222-2222-2222-2222-222222222222")
      .in("platform", ["google_ads", "microsoft"]);
    const platforms = new Set((data ?? []).map((r) => r.platform));
    expect(platforms.has("google_ads")).toBe(true);
    expect(platforms.has("microsoft")).toBe(true);
  });

  it("wrote success rows to collector_runs for this run", async () => {
    const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data, error } = await db
      .from("collector_runs")
      .select("module, status")
      .gte("started_at", runStart);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
    // every run recorded this pass should be success or skipped — never error
    expect((data ?? []).every((r) => r.status === "success" || r.status === "skipped")).toBe(true);
    const modules = new Set((data ?? []).map((r) => r.module));
    expect(modules.has("core")).toBe(true);
    expect(modules.has("serp")).toBe(true);
  });
});
