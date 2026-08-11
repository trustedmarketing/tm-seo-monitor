// app/dashboard/[id]/paid/guardrails/page.tsx — WO-006 stream J.
//
// The spend guardrail has been enforced since stream D: checkSpendGuard() runs
// in approvals/route.ts before any ad adapter is dispatched, and blocks a budget
// change that would breach a ceiling. But the ceilings could only be set by
// running SQL by hand — so the control existed and nobody could operate it.
//
// Shows each platform's current committed daily budget next to the ceiling
// being set, because a ceiling typed without knowing current spend is a guess.
// The most common way a guardrail fails is being set so high it never fires.
import Link from "next/link";
import { userClient, getProfile } from "@/lib/supabaseServer";
import { ClientHeader } from "@/components/ClientHeader";
import { PaidNav } from "@/components/PaidNav";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

type Guard = { platform: string; daily_ceiling: number | null; monthly_ceiling: number | null; updated_at: string | null };
type Campaign = { platform: string; status: string; daily_budget: number | null };

const PLATFORMS = [
  { key: "meta", label: "Meta", note: "incl. paid social (IG/FB ads)" },
  { key: "google_ads", label: "Google", note: "search · shopping · PMax" },
  { key: "microsoft", label: "Microsoft", note: "Bing search" },
];

const MSG: Record<string, string> = {
  "guard-saved": "Ceilings saved. They apply to the next approval, not to campaigns already running.",
  "guard-removed": "Ceilings removed — no spend ceiling is enforced for that platform now.",
  "guard-bad-daily": "The daily ceiling must be a number, or blank for no ceiling.",
  "guard-bad-monthly": "The monthly ceiling must be a number, or blank for no ceiling.",
  "guard-bad-platform": "Unknown platform.",
};

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)" };
const eyebrow: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg3)" };
const L: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg3)", marginBottom: 5 };
const I: React.CSSProperties = {
  fontFamily: "var(--font-body)", fontSize: 14, padding: "9px 11px",
  border: "1px solid var(--border-strong)", borderRadius: 8, width: "100%",
  boxSizing: "border-box", background: "#fff", color: "var(--fg1)",
};
const BTN: React.CSSProperties = {
  fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 13.5,
  padding: "9px 16px", borderRadius: 8, border: "none", cursor: "pointer",
  background: "var(--tm-performance-green)", color: "#080808",
};

function money(n: number): string {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export default async function Guardrails({
  params, searchParams,
}: {
  params: { id: string };
  searchParams: { msg?: string };
}) {
  const db = userClient();
  const [profile, { data: client }, { data: guards }, { data: campaigns }] = await Promise.all([
    getProfile(),
    db.from("clients").select("id, name, domain, tier, client_type").eq("id", params.id).single(),
    db.from("ad_spend_guards").select("platform, daily_ceiling, monthly_ceiling, updated_at").eq("client_id", params.id),
    db.from("campaigns").select("platform, status, daily_budget").eq("client_id", params.id),
  ]);
  if (!client) return <main style={{ padding: 48 }}>Client not found. <Link href="/dashboard">Back</Link></main>;

  const isOwner = profile?.role === "owner";
  const byPlatform = new Map<string, Guard>();
  for (const g of (guards ?? []) as Guard[]) byPlatform.set(g.platform, g);

  // Committed daily budget = active campaigns only. A paused campaign's budget
  // is not being spent, and counting it would push someone into setting a
  // ceiling higher than the account actually needs.
  const committed = new Map<string, number>();
  for (const c of (campaigns ?? []) as Campaign[]) {
    if (c.status !== "active") continue;
    committed.set(c.platform, (committed.get(c.platform) ?? 0) + (c.daily_budget ?? 0));
  }

  return (
    <main style={{ padding: "40px 32px 64px" }}>
      <div style={{ maxWidth: 900 }}>
        <ClientHeader id={params.id} name={client.name} domain={client.domain} tier={client.tier} clientType={(client as any).client_type ?? null} active="paid"
          sub="Spend guardrails — hard ceilings that block a budget change before it executes" />
        <PaidNav clientId={params.id} active="guardrails" />

        {searchParams.msg && MSG[searchParams.msg] && (
          <div style={{ ...card, padding: "12px 16px", marginBottom: 16, fontSize: 13.5, color: "var(--fg2)" }}>
            {MSG[searchParams.msg]}
          </div>
        )}

        <section style={{ ...card, padding: "18px 22px", marginBottom: 20, fontSize: 13.5, lineHeight: 1.65, color: "var(--fg2)" }}>
          These are enforced, not advisory. Any approval that would push a platform&apos;s projected
          spend past a ceiling is <strong>blocked and escalated</strong> rather than approved through —
          the check runs before the ad platform is ever called. Monthly projection assumes 30 days
          at the new daily budget, plus what this client&apos;s other campaigns on that platform are
          already committed to.
          <div style={{ marginTop: 10, color: "var(--fg3)" }}>
            Blank means no ceiling. <strong>0</strong> means a hard stop — no spend permitted at all.
            Changing a ceiling never touches a campaign that is already running; it only governs the
            next approval.
          </div>
        </section>

        {!isOwner && (
          <section style={{ ...card, padding: "14px 18px", marginBottom: 16, fontSize: 13, color: "var(--fg2)" }}>
            Read-only — changing a spend ceiling is owner-only. A limit that the person who wants a
            budget through can raise themselves is not a limit.
          </section>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {PLATFORMS.map((p) => {
            const g = byPlatform.get(p.key);
            const live = committed.get(p.key) ?? 0;
            const dailySet = g?.daily_ceiling ?? null;
            // The failure mode worth naming: a ceiling set below what is already
            // running blocks every future change on that platform until someone
            // works out why.
            const tooLow = dailySet != null && live > dailySet;

            return (
              <section key={p.key} style={{ ...card, padding: "20px 24px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 15.5, fontWeight: 600 }}>{p.label}</div>
                    <div style={{ fontSize: 12.5, color: "var(--fg3)", marginTop: 2 }}>{p.note}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={eyebrow}>Active campaigns · daily</div>
                    <div style={{ fontSize: 20, fontFamily: "var(--font-display)" }}>{live > 0 ? money(live) : "–"}</div>
                  </div>
                </div>

                {g ? (
                  <div style={{ fontSize: 12.5, color: "var(--fg2)", marginTop: 12 }}>
                    Enforced now: daily {g.daily_ceiling != null ? money(g.daily_ceiling) : "none"} ·
                    monthly {g.monthly_ceiling != null ? money(g.monthly_ceiling) : "none"}
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, color: "#B8860B", marginTop: 12 }}>
                    ⚑ No ceiling enforced — a budget change of any size on this platform would pass the guard.
                  </div>
                )}

                {tooLow && (
                  <div style={{ fontSize: 12.5, color: "#B8433D", marginTop: 6 }}>
                    ⚑ The daily ceiling ({money(dailySet as number)}) is below what active campaigns already
                    commit ({money(live)}). Every budget change on this platform will be blocked until one moves.
                  </div>
                )}

                <form action="/api/clients/spend-guards" method="post" style={{ marginTop: 14 }}>
                  <input type="hidden" name="client_id" value={params.id} />
                  <input type="hidden" name="platform" value={p.key} />
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                    <div>
                      <label style={L}>Daily ceiling ($)</label>
                      <input style={I} name="daily_ceiling" inputMode="decimal"
                        defaultValue={g?.daily_ceiling ?? ""} placeholder="blank = no ceiling"
                        disabled={!isOwner} />
                    </div>
                    <div>
                      <label style={L}>Monthly ceiling ($)</label>
                      <input style={I} name="monthly_ceiling" inputMode="decimal"
                        defaultValue={g?.monthly_ceiling ?? ""} placeholder="blank = no ceiling"
                        disabled={!isOwner} />
                    </div>
                  </div>
                  {isOwner && <button type="submit" style={{ ...BTN, marginTop: 14 }}>Save {p.label} ceilings</button>}
                </form>
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
