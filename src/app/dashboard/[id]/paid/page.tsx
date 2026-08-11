// app/dashboard/[id]/paid/page.tsx — PAID channel (WO-002 reorg).
// Total spend + per-platform ROAS, reconciled against actual revenue. Paid-social
// (Meta/IG ads) is a slice of Meta here — never relocated, so MER never double-counts.
import Link from "next/link";
import { userClient } from "@/lib/supabaseServer";
import { ClientHeader } from "@/components/ClientHeader";
import { PaidNav } from "@/components/PaidNav";
import { buildCampaignRollups, ROAS_BENCHMARKS, type CampaignRollupInput, type MetricRow } from "@/lib/paidRollup";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

type Ad = { spend: number | null; revenue: number | null; platform: string; conversions: number | null };
type Conv = { source: string; revenue: number | null };

const STATUS_LABEL: Record<string, string> = { active: "Running", paused: "Paused", removed: "Removed" };
const STATUS_COLOR: Record<string, string> = { active: "var(--tm-green-deep)", paused: "var(--fg3)", removed: "var(--fg3)" };
const SEVERITY_COLOR: Record<string, string> = { high: "#B8433D", medium: "#B8860B", low: "var(--fg3)" };
type PaidRec = { id: string; severity: "high" | "medium" | "low"; title: string; detail: string };
type PersonaOption = { id: string; name: string };

const L: React.CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--fg3)", marginBottom: 4 };
const I: React.CSSProperties = {
  fontFamily: "var(--font-body)", fontSize: 13, padding: "8px 10px", width: "100%", boxSizing: "border-box",
  border: "1px solid var(--border-strong)", borderRadius: 7, background: "#fff", color: "var(--fg1)",
};
const BTN: React.CSSProperties = {
  fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 13, padding: "9px 16px",
  borderRadius: 8, border: "none", cursor: "pointer", background: "var(--tm-performance-green)", color: "#080808",
};
const smallBtn: React.CSSProperties = {
  fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 11.5, padding: "5px 10px",
  borderRadius: 6, border: "1px solid var(--border-strong)", cursor: "pointer", background: "transparent", color: "var(--fg2)",
};

function roasCell(v: number | null): string {
  return v != null ? v.toFixed(2) + "×" : "–";
}

function money(n: number): string {
  if (n >= 1000) return "$" + (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return "$" + Math.round(n);
}
const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)" };
const eyebrow: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg3)" };

const PLATFORMS = [
  { key: "meta", label: "Meta", note: "incl. paid social (IG/FB ads)" },
  { key: "google_ads", label: "Google", note: "search · shopping · PMax" },
  { key: "microsoft", label: "Microsoft", note: "Bing search" },
];

export default async function Paid({ params }: { params: { id: string } }) {
  const db = userClient();
  const windowStart = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [{ data: client }, { data: ads }, { data: convs }, { data: campaignRows }, { data: campaignMetrics }, { data: paidRecRows }, { data: personaOptions }] = await Promise.all([
    db.from("clients").select("id, name, domain, tier, client_type").eq("id", params.id).single(),
    // Windowed to 30 days to match the campaign rollups below and the Overview
    // page — these two drove the headline spend/revenue/MER strip and had no
    // date filter, so the headline was an all-time total sitting directly above
    // a 30-day campaign table. Same bug class as #28 and the portfolio page.
    db.from("ad_metrics_daily").select("spend, revenue, platform, conversions").eq("client_id", params.id).gte("date", windowStart),
    db.from("conversions_daily").select("source, revenue").eq("client_id", params.id).gte("date", windowStart),
    db.from("campaigns").select("id, platform, campaign_id, campaign_name, status, daily_budget").eq("client_id", params.id),
    // 30 days is the widest rollup window (see paidRollup.ts); no point pulling more.
    db
      .from("ad_metrics_daily")
      .select("campaign_id, platform, date, spend, revenue")
      .eq("client_id", params.id)
      .gte("date", windowStart),
    // Paid-category recommendations (WO-006 stream C) — same recommendations
    // table/lifecycle as SEO, filtered to this channel and to what's still
    // actionable (not dismissed/resolved/already shipped).
    db
      .from("recommendations")
      .select("id, severity, title, detail")
      .eq("client_id", params.id)
      .eq("category", "Paid")
      .in("status", ["open", "approved"]),
    db.from("client_personas").select("id, name").eq("client_id", params.id),
  ]);
  if (!client) return <main style={{ padding: 48 }}>Client not found. <Link href="/dashboard">Back</Link></main>;

  const personaChoices = (personaOptions ?? []) as PersonaOption[];

  const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const paidRecs = ((paidRecRows ?? []) as PaidRec[]).sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );

  const campaignRollups = buildCampaignRollups(
    (campaignRows ?? []) as CampaignRollupInput[],
    (campaignMetrics ?? []) as MetricRow[]
  ).sort((a, b) => (b.thirtyDaySpend ?? 0) - (a.thirtyDaySpend ?? 0));

  const agg: Record<string, { spend: number; claimed: number; conv: number }> = {};
  let spend = 0, claimed = 0;
  for (const a of (ads ?? []) as Ad[]) {
    const g = agg[a.platform] ?? { spend: 0, claimed: 0, conv: 0 };
    g.spend += a.spend ?? 0; g.claimed += a.revenue ?? 0; g.conv += a.conversions ?? 0;
    agg[a.platform] = g; spend += a.spend ?? 0; claimed += a.revenue ?? 0;
  }
  const rev: Record<string, number> = {};
  for (const c of (convs ?? []) as Conv[]) rev[c.source] = (rev[c.source] ?? 0) + (c.revenue ?? 0);
  const actualRev = (rev["shopify"] ?? 0) > 0 ? rev["shopify"] : (rev["ga4"] ?? 0);
  const claimedPct = actualRev > 0 && claimed > 0 ? claimed / actualRev : null;
  const over = claimedPct != null && claimedPct > 0.85;
  const blendedRoas = spend > 0 && actualRev > 0 ? actualRev / spend : null;

  return (
    <main style={{ padding: "40px 32px 64px" }}>
      <div style={{ maxWidth: 1180 }}>
        <ClientHeader id={params.id} name={client.name} domain={client.domain} tier={client.tier} clientType={(client as any).client_type ?? null} active="paid"
          sub="Paid media — spend, platform ROAS, and how it reconciles to actual revenue" />
        <PaidNav clientId={params.id} active="campaigns" />

        <section style={{ ...card, padding: "24px 28px", marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 180px" }}>
              <div style={eyebrow}>Ad spend · 30d</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 52, lineHeight: 1, letterSpacing: "-0.02em", margin: "6px 0 2px" }}>{spend > 0 ? money(spend) : "–"}</div>
            </div>
            <div style={{ flex: "1 1 180px", borderLeft: "1px solid var(--border)", paddingLeft: 24 }}>
              <div style={eyebrow}>Blended ROAS · actual · 30d</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 52, lineHeight: 1, letterSpacing: "-0.02em", margin: "6px 0 2px", color: blendedRoas != null ? "var(--tm-green-deep)" : "var(--fg3)" }}>{blendedRoas != null ? blendedRoas.toFixed(2) + "×" : "–"}</div>
              <div style={{ fontSize: 13, color: "var(--fg3)" }}>actual revenue ÷ spend</div>
            </div>
          </div>
          {actualRev > 0 && claimed > 0 && (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)", fontSize: 13.5, lineHeight: 1.6, color: "var(--fg2)" }}>
              Platforms claim <strong>{money(claimed)}</strong> in revenue — {Math.round((claimedPct as number) * 100)}% of the {money(actualRev)} actually recorded.
              {over
                ? <span style={{ color: "#B8860B", fontWeight: 600 }}> ⚑ Over-claiming: the same orders are counted by multiple platforms. Steer on blended ROAS above, not per-platform ROAS.</span>
                : <span style={{ color: "var(--fg3)" }}> Within a normal range.</span>}
            </div>
          )}
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
          {PLATFORMS.map((p) => {
            const g = agg[p.key];
            const connected = g && g.spend > 0;
            const roas = connected && g.claimed > 0 ? g.claimed / g.spend : null;
            return (
              <section key={p.key} style={{ ...card, padding: "18px 20px", opacity: connected ? 1 : 0.6 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                  <div style={eyebrow}>{p.label}</div>
                  {!connected && <span style={{ fontSize: 11, color: "var(--fg3)" }}>not connected</span>}
                </div>
                {connected ? (
                  <>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 34, lineHeight: 1.1, margin: "4px 0 2px" }}>{money(g.spend)}</div>
                    <div style={{ fontSize: 12.5, color: "var(--fg2)", marginTop: 6 }}>
                      {roas != null ? <>Platform ROAS {roas.toFixed(2)}× <span style={{ color: "var(--fg3)" }}>(claimed)</span> · </> : null}
                      {Math.round(g.conv)} conv
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--fg3)", marginTop: 4 }}>{p.note}</div>
                  </>
                ) : (
                  <div style={{ fontSize: 13, color: "var(--fg3)", marginTop: 8, lineHeight: 1.5 }}>
                    {p.note}. Connect the account to pull spend and results here.
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <section style={{ ...card, padding: "20px 24px", marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={eyebrow}>Campaigns</div>
            <div style={{ fontSize: 11.5, color: "var(--fg3)" }}>
              {Object.values(ROAS_BENCHMARKS).map((b) => b.label).join(" · ")}
            </div>
          </div>
          {campaignRollups.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--fg3)", padding: "8px 0" }}>
              No campaigns synced yet. They appear here once a platform account is connected and the daily collector has run.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                    {["Campaign", "Platform", "Status", "Day-prior ROAS", "7-day ROAS", "30-day ROAS", "30-day spend", "Actions"].map((h) => (
                      <th key={h} style={{ ...eyebrow, fontWeight: 700, padding: "6px 10px 8px", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {campaignRollups.map((r) => (
                    <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 600 }}>{r.campaignName ?? r.campaignId}</td>
                      <td style={{ padding: "8px 10px", color: "var(--fg2)" }}>{PLATFORMS.find((p) => p.key === r.platform)?.label ?? r.platform}</td>
                      <td style={{ padding: "8px 10px", color: STATUS_COLOR[r.status] ?? "var(--fg2)", fontWeight: 600 }}>{STATUS_LABEL[r.status] ?? r.status}</td>
                      <td style={{ padding: "8px 10px" }}>{roasCell(r.dayPriorRoas)}</td>
                      <td style={{ padding: "8px 10px" }}>{roasCell(r.sevenDayRoas)}</td>
                      <td style={{ padding: "8px 10px" }}>{roasCell(r.thirtyDayRoas)}</td>
                      <td style={{ padding: "8px 10px", color: "var(--fg2)" }}>{money(r.thirtyDaySpend)}</td>
                      <td style={{ padding: "8px 10px" }}>
                        {r.status !== "removed" && (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            <form action="/api/ops/stage-ad-action" method="get">
                              <input type="hidden" name="client" value={params.id} />
                              <input type="hidden" name="platform" value={r.platform} />
                              <input type="hidden" name="campaign" value={r.campaignId} />
                              <input type="hidden" name="action" value={r.status === "active" ? "pause" : "resume"} />
                              <button type="submit" style={smallBtn}>{r.status === "active" ? "Pause" : "Resume"}</button>
                            </form>
                            <form action="/api/ops/stage-ad-action" method="get" style={{ display: "flex", gap: 4, alignItems: "center" }}>
                              <input type="hidden" name="client" value={params.id} />
                              <input type="hidden" name="platform" value={r.platform} />
                              <input type="hidden" name="campaign" value={r.campaignId} />
                              <input type="hidden" name="action" value="update_budget" />
                              <input
                                type="number" name="budget" step="0.01" min="1" defaultValue={r.dailyBudget ?? undefined}
                                style={{ width: 64, fontSize: 11.5, padding: "4px 6px", borderRadius: 6, border: "1px solid var(--border-strong)" }}
                              />
                              <button type="submit" style={smallBtn}>Set budget</button>
                            </form>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {paidRecs.length > 0 && (
          <section style={{ ...card, padding: "20px 24px", marginTop: 16 }}>
            <div style={eyebrow}>Recommendations</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              {paidRecs.map((r) => (
                <div key={r.id} style={{ padding: "10px 12px", borderLeft: `3px solid ${SEVERITY_COLOR[r.severity] ?? "var(--fg3)"}`, background: "var(--bg)", borderRadius: 6 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.title}</div>
                  <div style={{ fontSize: 12.5, color: "var(--fg2)", marginTop: 3, lineHeight: 1.5 }}>{r.detail}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section style={{ ...card, padding: "20px 24px", marginTop: 16 }}>
          <div style={{ ...eyebrow, marginBottom: 10 }}>New test campaign</div>
          <div style={{ fontSize: 12, color: "var(--fg3)", marginBottom: 12 }}>
            Always created paused — creative and ad copy generate together, tagged to this approval card until you approve it (see <Link href={`/dashboard/${params.id}/paid/creative`} style={{ color: "var(--fg2)" }}>creative &amp; copy</Link> and <Link href="/dashboard/approvals" style={{ color: "var(--fg2)" }}>the approvals queue</Link>).
          </div>
          <form action="/api/ops/stage-ad-action" method="get">
            <input type="hidden" name="client" value={params.id} />
            <input type="hidden" name="action" value="create_campaign" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={L}>Platform</label>
                <select style={I} name="platform" defaultValue="meta">
                  {PLATFORMS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label style={L}>Campaign name</label>
                <input style={I} name="name" required placeholder="e.g. Prospecting - Broad" />
              </div>
              <div>
                <label style={L}>Objective</label>
                <input style={I} name="objective" required placeholder="e.g. SEARCH, PERFORMANCE_MAX, OUTCOME_SALES" />
              </div>
              <div>
                <label style={L}>Daily budget ($)</label>
                <input style={I} name="budget" type="number" step="0.01" min="1" required placeholder="50" />
              </div>
              <div>
                <label style={L}>Persona (optional)</label>
                <select style={I} name="persona_id" defaultValue="">
                  <option value="">(none)</option>
                  {personaChoices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label style={L}>Offer (optional)</label>
                <input style={I} name="offer" placeholder="e.g. 20% off this week" />
              </div>
            </div>
            <button type="submit" style={BTN}>Stage new campaign</button>
          </form>
        </section>
      </div>
    </main>
  );
}
