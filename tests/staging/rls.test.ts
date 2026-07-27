import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

// WO-003 Stream A. Live RLS assertions against tm-growth-staging.
//
// Two kinds of check, deliberately:
//   1. COVERAGE  — via rls_coverage(), guards the failure mode RLS actually has:
//                  not a wrong policy but a MISSING one. A new client-scoped
//                  table with no policy is invisible in code review and readable
//                  by every signed-in user. This turns that into a red build.
//   2. BEHAVIOR  — an anonymous PostgREST client must read nothing. Introspection
//                  can pass while the door is still open; this proves it is shut.
//
// Run via `npm run test:staging`. Skipped automatically without env.
const hasService = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;

const d = hasService ? describe : describe.skip;

const CLIENT_SCOPED = [
  "ad_metrics_daily", "ad_platform_accounts", "changes", "client_stores",
  "collector_runs", "conversions_daily", "gsc_history", "jobs",
  "keyword_rankings", "metric_snapshots", "prompt_results", "recommendations",
  "tracked_keywords", "tracked_prompts",
];

type Coverage = {
  table_name: string;
  rls_enabled: boolean;
  policy_count: number;
  client_scoped: boolean;
};

function service() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function coverage(): Promise<Coverage[]> {
  const { data, error } = await service().rpc("rls_coverage");
  if (error) throw error;
  return data as Coverage[];
}

d("RLS · coverage (migration 012)", () => {
  it("every table in public has RLS enabled", async () => {
    const offenders = (await coverage()).filter((t) => !t.rls_enabled).map((t) => t.table_name);
    expect(offenders, "tables with RLS disabled").toEqual([]);
  });

  it("every client-scoped table has a policy — including ones added later", async () => {
    // The regression guard. Not a hard-coded list: anything with a client_id
    // column and no policy fails, whether or not we remembered to list it.
    const offenders = (await coverage())
      .filter((t) => t.client_scoped && t.policy_count === 0 && t.table_name !== "platform_secrets")
      .map((t) => t.table_name);
    expect(offenders, "client-scoped tables with NO RLS policy — readable by every signed-in user").toEqual([]);
  });

  it("the known client-scoped tables are all still present and covered", async () => {
    // Catches the opposite mistake: a table quietly losing its client_id column
    // and dropping out of the check above.
    const byName = Object.fromEntries((await coverage()).map((t) => [t.table_name, t]));
    for (const t of CLIENT_SCOPED) {
      expect(byName[t], `${t} is missing from public`).toBeTruthy();
      expect(byName[t].client_scoped, `${t} lost its client_id column`).toBe(true);
      expect(byName[t].policy_count, `${t} has no policy`).toBeGreaterThan(0);
    }
  });

  it("platform_secrets is deny-all: RLS on, zero policies", async () => {
    // Tokens unreachable by ANY signed-in user, agency or client. Service role
    // reaches them only through the SECURITY DEFINER vault RPCs from 011.
    const row = (await coverage()).find((t) => t.table_name === "platform_secrets");
    expect(row?.rls_enabled).toBe(true);
    expect(row?.policy_count, "platform_secrets must have NO policy").toBe(0);
  });
});

const b = hasService && anonKey ? describe : describe.skip;

b("RLS · behavior with no session", () => {
  it("an anonymous client reads nothing from any client-scoped table", async () => {
    const anon = createClient(process.env.SUPABASE_URL!, anonKey!);

    for (const table of [...CLIENT_SCOPED, "clients", "platform_secrets", "user_profiles"]) {
      const { data, error } = await anon.from(table).select("*").limit(5);
      // Either denied outright or returns an empty set. Both are acceptable;
      // rows coming back is not.
      expect(error ? [] : data, `${table} leaked rows to an anonymous caller`).toEqual([]);
    }
  });

  it("the service role is unaffected, so collectors keep working", async () => {
    const { data, error } = await service().from("clients").select("id").limit(5);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});
