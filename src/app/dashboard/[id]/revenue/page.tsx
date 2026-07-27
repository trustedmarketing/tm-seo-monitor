// app/dashboard/[id]/revenue/page.tsx — REVENUE channel (WO-002 reorg).
// Shopify is the ground truth every channel is measured against. Orders, AOV,
// and revenue by source (Shopify actual vs GA4 modeled).
import Link from "next/link";
import { userClient } from "@/lib/supabaseServer";
import { ClientHeader } from "@/components/ClientHeader";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

type Conv = { source: string; revenue: number | null; conversions: number | null };

function money(n: number): string {
  if (n >= 1000) return "$" + (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return "$" + Math.round(n);
}
function moneyFull(n: number): string { return "$" + Math.round(n).toLocaleString("en-US"); }
const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)" };
const eyebrow: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg3)" };

const SOURCE_LABEL: Record<string, string> = { shopify: "Shopify", ga4: "GA4" };

export default async function Revenue({ params }: { params: { id: string } }) {
  const db = userClient();
  const [{ data: client }, { data: convs }] = await Promise.all([
    db.from("clients").select("id, name, domain, tier, ga4_property_id").eq("id", params.id).single(),
    db.from("conversions_daily").select("source, revenue, conversions").eq("client_id", params.id),
  ]);
  if (!client) return <main style={{ padding: 48 }}>Client not found. <Link href="/dashboard">Back</Link></main>;

  const bySrc: Record<string, { rev: number; orders: number }> = {};
  for (const c of (convs ?? []) as Conv[]) {
    const s = bySrc[c.source] ?? { rev: 0, orders: 0 };
    s.rev += c.revenue ?? 0; s.orders += c.conversions ?? 0; bySrc[c.source] = s;
  }
  const shop = bySrc["shopify"]; const ga4 = bySrc["ga4"];
  const primary = (shop?.rev ?? 0) > 0 ? { src: "shopify", ...shop! } : (ga4?.rev ?? 0) > 0 ? { src: "ga4", ...ga4! } : null;
  const aov = primary && primary.orders > 0 ? primary.rev / primary.orders : null;

  return (
    <main style={{ fontFamily: "var(--font-body)", background: "var(--bg)", minHeight: "100vh", padding: "48px 24px", color: "var(--fg1)" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <ClientHeader id={params.id} name={client.name} domain={client.domain} tier={client.tier} active="revenue"
          sub="Revenue — Shopify is the ground truth every channel is measured against" />

        {primary ? (
          <>
            <section style={{ ...card, padding: "24px 28px", marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 180px" }}>
                  <div style={eyebrow}>Revenue · {SOURCE_LABEL[primary.src]}{primary.src === "shopify" ? " · actual" : " · modeled"}</div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 56, lineHeight: 1, letterSpacing: "-0.02em", margin: "6px 0 2px" }}>{money(primary.rev)}</div>
                </div>
                <div style={{ flex: "1 1 140px", borderLeft: "1px solid var(--border)", paddingLeft: 24 }}>
                  <div style={eyebrow}>Orders</div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 56, lineHeight: 1, margin: "6px 0 2px" }}>{primary.orders.toLocaleString("en-US")}</div>
                </div>
                <div style={{ flex: "1 1 140px", borderLeft: "1px solid var(--border)", paddingLeft: 24 }}>
                  <div style={eyebrow}>Avg order value</div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 56, lineHeight: 1, margin: "6px 0 2px" }}>{aov != null ? moneyFull(aov) : "–"}</div>
                </div>
              </div>
            </section>

            <section style={{ ...card, padding: "20px 24px 24px" }}>
              <div style={{ ...eyebrow, marginBottom: 14 }}>Revenue by source</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {Object.entries(bySrc).sort((a, b) => b[1].rev - a[1].rev).map(([src, v]) => (
                  <div key={src} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, width: 90 }}>{SOURCE_LABEL[src] ?? src}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: src === "shopify" ? "var(--tm-deep-charcoal)" : "var(--tm-stone-200)", color: src === "shopify" ? "var(--tm-performance-green)" : "var(--fg2)" }}>
                      {src === "shopify" ? "ground truth" : "modeled"}
                    </span>
                    <span style={{ marginLeft: "auto", fontFamily: "var(--font-display)", fontSize: 22 }}>{moneyFull(v.rev)}</span>
                    <span style={{ fontSize: 13, color: "var(--fg3)", width: 90, textAlign: "right" }}>{v.orders} orders</span>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : (
          <section style={{ ...card, padding: "28px", fontSize: 14, color: "var(--fg3)", lineHeight: 1.6 }}>
            No revenue collected yet. {client.ga4_property_id ? "GA4 is connected — revenue will appear after the next collection." : "Connect Shopify (or GA4) to track revenue as the ground truth for MER."}
          </section>
        )}
      </div>
    </main>
  );
}
