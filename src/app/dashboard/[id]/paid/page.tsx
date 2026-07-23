// app/dashboard/[id]/paid/page.tsx — PAID channel (WO-002 reorg).
// Total spend + per-platform ROAS, reconciled against actual revenue. Paid-social
// (Meta/IG ads) is a slice of Meta here — never relocated, so MER never double-counts.
import Link from "next/link";
import { dbClient } from "@/lib/db";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/authToken";
import { ClientHeader } from "@/components/ClientHeader";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

type Ad = { spend: number | null; revenue: number | null; platform: string; conversions: number | null };
type Conv = { source: string; revenue: number | null };

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
  await verifyToken(cookies().get("tm_auth")?.value, process.env.CRON_SECRET!);
  const db = dbClient();
  const [{ data: client }, { data: ads }, { data: convs }] = await Promise.all([
    db.from("clients").select("id, name, domain, tier").eq("id", params.id).single(),
    db.from("ad_metrics_daily").select("spend, revenue, platform, conversions").eq("client_id", params.id),
    db.from("conversions_daily").select("source, revenue").eq("client_id", params.id),
  ]);
  if (!client) return <main style={{ padding: 48 }}>Client not found. <Link href="/dashboard">Back</Link></main>;

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
    <main style={{ fontFamily: "var(--font-body)", background: "var(--bg)", minHeight: "100vh", padding: "48px 24px", color: "var(--fg1)" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <ClientHeader id={params.id} name={client.name} domain={client.domain} tier={client.tier} active="paid"
          sub="Paid media — spend, platform ROAS, and how it reconciles to actual revenue" />

        <section style={{ ...card, padding: "24px 28px", marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 180px" }}>
              <div style={eyebrow}>Total ad spend</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 52, lineHeight: 1, letterSpacing: "-0.02em", margin: "6px 0 2px" }}>{spend > 0 ? money(spend) : "–"}</div>
            </div>
            <div style={{ flex: "1 1 180px", borderLeft: "1px solid var(--border)", paddingLeft: 24 }}>
              <div style={eyebrow}>Blended ROAS · actual</div>
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
      </div>
    </main>
  );
}
