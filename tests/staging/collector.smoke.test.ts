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
