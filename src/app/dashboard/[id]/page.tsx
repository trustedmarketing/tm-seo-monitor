// app/dashboard/[id]/page.tsx — client OVERVIEW (WO-002 reorg).
// Revenue-first hero: MER (blended, over-attribution-proof) over Shopify actual
// revenue and total ad spend, with an inline reconciliation of platform-claimed
// vs actual. Below, one summary tile per channel that links into its tab.
// Absorbs the old /command per-client scorecard logic; SEO detail moved to /organic.
import Link from "next/link";
import { userClient } from "@/lib/supabaseServer";
import { ChannelNav } from "@/components/ChannelNav";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

type Snap = {
  captured_at: string; visibility: number | null; ai_visibility: number | null;
  site_health: number | null; organic_traffic: number | null;
};
type Conv = { source: string; revenue: number | null; conversions: number | null };
type Ad = { spend: number | null; revenue: number | null; platform: string };

function money(n: number): string {
  if (n >= 1000) return "$" + (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return "$" + Math.round(n);
}
function moneyFull(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}
function pct(n: number | null): string { return n == null ? "–" : `${Math.round(n * 10) / 10}%`; }
function dateShort(s: string): string {
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const card: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)",
};
const eyebrow: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg3)",
};

const PLATFORM_LABEL: Record<string, string> = {
  meta: "Meta", google_ads: "Google", microsoft: "Microsoft",
};

export default async function Overview({ params }: { params: { id: string } }) {
  const db = userClient();

  const [{ data: client }, { data: snaps }, { data: convs }, { data: ads }] = await Promise.all([
    db.from("clients").select("*").eq("id", params.id).single(),
    db.from("metric_snapshots").select("captured_at, visibility, ai_visibility, site_health, organic_traffic")
      .eq("client_id", params.id).order("captured_at", { ascending: false }).limit(1),
    db.from("conversions_daily").select("source, revenue, conversions").eq("client_id", params.id),
    db.from("ad_metrics_daily").select("spend, revenue, platform").eq("client_id", params.id),
  ]);

  if (!client) {
    return (
      <main style={{ fontFamily: "var(--font-body)", background: "var(--bg)", minHeight: "100vh", padding: 48 }}>
        Client not found. <Link href="/dashboard">Back to portfolio</Link>
      </main>
    );
  }

  const [cur] = (snaps ?? []) as Snap[];

  // Revenue by source — Shopify (ground truth) preferred over GA4.
  const rev: Record<string, { rev: number; orders: number }> = {};
  for (const c of (convs ?? []) as Conv[]) {
    const s = rev[c.source] ?? { rev: 0, orders: 0 };
    s.rev += c.revenue ?? 0; s.orders += c.conversions ?? 0; rev[c.source] = s;
  }
  const shop = rev["shopify"]; const ga4 = rev["ga4"];
  const actualRev = (shop?.rev ?? 0) > 0 ? shop!.rev : (ga4?.rev ?? 0);
  const revSrc = (shop?.rev ?? 0) > 0 ? "Shopify" : (ga4?.rev ?? 0) > 0 ? "GA4" : null;
  const orders = (shop?.rev ?? 0) > 0 ? shop!.orders : (ga4?.orders ?? 0);

  // Paid: total spend + platform-claimed revenue (the over-attribution source).
  let spend = 0, claimed = 0;
  const spendByPlatform: Record<string, number> = {};
  for (const a of (ads ?? []) as Ad[]) {
    spend += a.spend ?? 0; claimed += a.revenue ?? 0;
    spendByPlatform[a.platform] = (spendByPlatform[a.platform] ?? 0) + (a.spend ?? 0);
  }
  const platforms = Object.entries(spendByPlatform).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);

  const mer = spend > 0 && actualRev > 0 ? actualRev / spend : null;
  const claimedPct = actualRev > 0 && claimed > 0 ? claimed / actualRev : null;
  const over = claimedPct != null && claimedPct > 0.85;

  const heroNum: React.CSSProperties = {
    fontFamily: "var(--font-display)", fontSize: 64, lineHeight: 1, letterSpacing: "-0.02em", margin: "6px 0 4px",
  };

  return (
    <main style={{ fontFamily: "var(--font-body)", background: "var(--bg)", minHeight: "100vh", padding: "48px 24px", color: "var(--fg1)" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <Link href="/dashboard" style={{ fontSize: 13, fontWeight: 600, color: "var(--fg2)", textDecoration: "none" }}>← Portfolio</Link>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, margin: "14px 0 4px", flexWrap: "wrap" }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 48, letterSpacing: "-0.01em", margin: 0 }}>{client.name}</h1>
          <a href={`https://${client.domain}`} style={{ fontSize: 14, color: "var(--fg3)", textDecoration: "none" }}>{client.domain}</a>
          {client.tier && <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: "var(--radius-pill)", background: "var(--tm-deep-charcoal)", color: "var(--tm-performance-green)" }}>{client.tier}</span>}
        </div>
        <div style={{ fontSize: 13, color: "var(--fg3)", marginBottom: 24 }}>
          {cur ? `Last collected ${dateShort(cur.captured_at)}` : "No data collected yet"}
        </div>

        <ChannelNav clientId={params.id} active="overview" />

        {/* ── Revenue-first hero ─────────────────────────────────────── */}
        <section style={{ ...card, padding: "28px 28px 24px", marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px", minWidth: 180 }}>
              <div style={eyebrow}>MER · blended</div>
              <div style={{ ...heroNum, color: mer != null ? "var(--tm-green-deep)" : "var(--fg3)" }}>
                {mer != null ? mer.toFixed(2) + "×" : "–"}
              </div>
              <div style={{ fontSize: 13, color: "var(--fg3)" }}>revenue ÷ ad spend</div>
            </div>
            <div style={{ flex: "1 1 200px", minWidth: 180, borderLeft: "1px solid var(--border)", paddingLeft: 24 }}>
              <div style={eyebrow}>Revenue{revSrc ? ` · ${revSrc}` : ""}</div>
              <div style={{ ...heroNum, color: actualRev > 0 ? "var(--fg1)" : "var(--fg3)" }}>{actualRev > 0 ? money(actualRev) : "–"}</div>
              <div style={{ fontSize: 13, color: "var(--fg3)" }}>{revSrc ? `${orders} orders · actual` : client.ga4_property_id ? "collecting" : "not connected"}</div>
            </div>
            <div style={{ flex: "1 1 200px", minWidth: 180, borderLeft: "1px solid var(--border)", paddingLeft: 24 }}>
              <div style={eyebrow}>Ad spend · total</div>
              <div style={{ ...heroNum, color: spend > 0 ? "var(--fg1)" : "var(--fg3)" }}>{spend > 0 ? money(spend) : "–"}</div>
              <div style={{ fontSize: 13, color: "var(--fg3)" }}>{platforms.length ? platforms.map(([p]) => PLATFORM_LABEL[p] ?? p).join(" · ") : "no paid connected"}</div>
            </div>
          </div>

          {/* reconciliation — the trust line, always visible when we have both sides */}
          {actualRev > 0 && claimed > 0 && (
            <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--border)", fontSize: 13.5, lineHeight: 1.6, color: "var(--fg2)" }}>
              <span style={{ fontWeight: 600 }}>Attribution check:</span>{" "}
              {revSrc ?? "Actual"} recorded <strong>{moneyFull(actualRev)}</strong> (ground truth);
              ad platforms together claim <strong>{moneyFull(claimed)}</strong>
              {" "}({Math.round((claimedPct as number) * 100)}% of actual).
              {over
                ? <span style={{ color: "#B8860B", fontWeight: 600 }}> ⚑ Platforms are over-claiming — trust MER, not platform ROAS.</span>
                : <span style={{ color: "var(--fg3)" }}> Within a normal range.</span>}
            </div>
          )}
        </section>

        {/* ── Per-channel summary tiles → drill into each tab ────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          <ChannelTile href={`/dashboard/${params.id}/organic`} label="Organic"
            value={cur?.organic_traffic != null ? money(cur.organic_traffic).replace("$", "") : "–"}
            unit="est. monthly visits"
            foot={`${pct(cur?.visibility ?? null)} visibility · ${pct(cur?.ai_visibility ?? null)} AI answers`} />
          <ChannelTile href={`/dashboard/${params.id}/paid`} label="Paid"
            value={spend > 0 ? money(spend) : "–"} unit="ad spend"
            foot={platforms.length ? platforms.map(([p, s]) => `${PLATFORM_LABEL[p] ?? p} ${money(s)}`).join(" · ") : "not connected"} />
          <ChannelTile href={`/dashboard/${params.id}/revenue`} label="Revenue"
            value={actualRev > 0 ? money(actualRev) : "–"} unit={revSrc ? `${revSrc} · ${orders} orders` : "revenue"}
            foot={actualRev > 0 && orders > 0 ? `${moneyFull(actualRev / orders)} avg order` : revSrc ? "" : "not connected"} />
          <ChannelTile href={`/dashboard/${params.id}/organic`} label="Site health"
            value={cur?.site_health != null ? `${Math.round(cur.site_health)}%` : "–"} unit="technical"
            foot="crawl · Core Web Vitals" />
        </div>
      </div>
    </main>
  );
}

function ChannelTile({ href, label, value, unit, foot }: {
  href: string; label: string; value: string; unit: string; foot: React.ReactNode;
}) {
  return (
    <Link href={href} style={{ ...card, padding: "18px 20px", textDecoration: "none", color: "inherit", display: "block" }}>
      <div style={eyebrow}>{label}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 34, lineHeight: 1.1, letterSpacing: "-0.02em", margin: "4px 0 2px", color: value === "–" ? "var(--fg3)" : "var(--fg1)" }}>{value}</div>
      <div style={{ fontSize: 12.5, color: "var(--fg3)" }}>{unit}</div>
      {foot && <div style={{ fontSize: 12.5, color: "var(--fg2)", marginTop: 8 }}>{foot}</div>}
    </Link>
  );
}
