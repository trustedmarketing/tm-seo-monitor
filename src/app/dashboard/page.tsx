// app/dashboard/page.tsx — PORTFOLIO roll-up (WO-002 reorg).
// Revenue-first: an attention rail (the morning exception feed) over one
// scorecard per client, led by MER · Revenue · Spend. Routes into each client's
// Overview. Absorbs the old /command surface (which now redirects here).
import Link from "next/link";
import { dbClient } from "@/lib/db";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/authToken";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

type Client = { id: string; name: string; domain: string; tier: string | null; ga4_property_id: string | null };
type Snap = { client_id: string; captured_at: string; visibility: number | null; ai_visibility: number | null; site_health: number | null; organic_traffic: number | null };
type Conv = { client_id: string; source: string; revenue: number | null; conversions: number | null };
type Ad = { client_id: string; spend: number | null; revenue: number | null };
type Run = { client_id: string | null; module: string; status: string; detail: string | null; started_at: string };
type Change = { client_id: string; title: string; verdict: string | null; measured_at: string | null };

const HRS = 36 * 3600 * 1000;

function pct(n: number | null): string { return n == null ? "–" : `${Math.round(n * 10) / 10}%`; }
function money(n: number): string {
  if (n >= 1000) return "$" + (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return "$" + Math.round(n);
}
function delta(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null) return null;
  return Math.round((cur - prev) * 10) / 10;
}
function ago(ts: string | null): { label: string; stale: boolean } {
  if (!ts) return { label: "no data", stale: true };
  const ms = Date.now() - new Date(ts).getTime();
  const h = Math.floor(ms / 3600000);
  const label = h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
  return { label, stale: ms > HRS };
}

function Delta({ value, unit = "" }: { value: number | null; unit?: string }) {
  if (value == null || value === 0) return <span style={{ fontSize: 12, color: "var(--fg3)" }}>—</span>;
  const up = value > 0;
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color: up ? "var(--success)" : "var(--danger)" }}>
      {up ? "▲ " : "▼ "}{up ? "+" : ""}{value}{unit}
    </span>
  );
}

function Channel({ label, value, sub, accent }: { label: string; value: string; sub: React.ReactNode; accent?: boolean }) {
  return (
    <div style={{ flex: 1, minWidth: 116, padding: "0 20px", borderLeft: "1px solid var(--border)" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg3)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 40, lineHeight: 1.05, letterSpacing: "-0.02em", margin: "4px 0 3px", color: value === "–" ? "var(--fg3)" : accent ? "var(--tm-green-deep)" : "var(--fg1)" }}>{value}</div>
      <div>{sub}</div>
    </div>
  );
}

export default async function Portfolio() {
  const role = await verifyToken(cookies().get("tm_auth")?.value, process.env.CRON_SECRET!);
  const db = dbClient();
  const since48 = new Date(Date.now() - 48 * 3600000).toISOString();

  const [cRes, sRes, convRes, runRes, chRes, adRes] = await Promise.all([
    db.from("clients").select("id, name, domain, tier, ga4_property_id").eq("active", true).order("name"),
    db.from("metric_snapshots").select("client_id, captured_at, visibility, ai_visibility, site_health, organic_traffic").order("captured_at", { ascending: false }).limit(500),
    db.from("conversions_daily").select("client_id, source, revenue, conversions"),
    db.from("collector_runs").select("client_id, module, status, detail, started_at").gte("started_at", since48).order("started_at", { ascending: false }),
    db.from("changes").select("client_id, title, verdict, measured_at").not("verdict", "is", null),
    db.from("ad_metrics_daily").select("client_id, spend, revenue"),
  ]);
  const error = cRes.error ?? sRes.error ?? convRes.error;
  const clients = (cRes.data ?? []) as Client[];

  const snaps = new Map<string, Snap[]>();
  for (const s of (sRes.data ?? []) as Snap[]) {
    const l = snaps.get(s.client_id) ?? []; if (l.length < 2) { l.push(s); snaps.set(s.client_id, l); }
  }
  const revBySrc = new Map<string, Record<string, { rev: number; orders: number }>>();
  for (const c of (convRes.data ?? []) as Conv[]) {
    const m = revBySrc.get(c.client_id) ?? {};
    const s = m[c.source] ?? { rev: 0, orders: 0 };
    s.rev += c.revenue ?? 0; s.orders += c.conversions ?? 0;
    m[c.source] = s; revBySrc.set(c.client_id, m);
  }
  const paid = new Map<string, { spend: number; revenue: number }>();
  for (const a of (adRes.data ?? []) as Ad[]) {
    const p = paid.get(a.client_id) ?? { spend: 0, revenue: 0 };
    p.spend += a.spend ?? 0; p.revenue += a.revenue ?? 0; paid.set(a.client_id, p);
  }
  const runs = (runRes.data ?? []) as Run[];
  const freshest = new Map<string, string>();
  for (const r of runs) { if (r.client_id && !freshest.has(r.client_id)) freshest.set(r.client_id, r.started_at); }
  const nameOf = new Map(clients.map((c) => [c.id, c.name]));

  // attention rail — the morning exception feed
  type Att = { kind: "fail" | "stale" | "declined"; text: string };
  const attention: Att[] = [];
  for (const r of runs) if (r.status === "error") attention.push({ kind: "fail", text: `Collection failed — ${nameOf.get(r.client_id ?? "") ?? "portfolio"} · ${r.module}` });
  for (const c of clients) { const f = ago(freshest.get(c.id) ?? null); if (f.stale) attention.push({ kind: "stale", text: `Stale data — ${c.name} (${f.label})` }); }
  for (const ch of (chRes.data ?? []) as Change[]) if (ch.verdict === "declined") attention.push({ kind: "declined", text: `Change declined — ${nameOf.get(ch.client_id) ?? ""}: ${ch.title}` });

  const collectionsToday = runs.filter((r) => r.status === "success" && Date.now() - new Date(r.started_at).getTime() < 24 * 3600000).length;
  const markColor: Record<string, string> = { fail: "var(--danger)", declined: "var(--danger)", stale: "#B8860B" };
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  return (
    <main style={{ fontFamily: "var(--font-body)", background: "var(--bg)", minHeight: "100vh", padding: "48px 24px", color: "var(--fg1)" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--fg2)", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--tm-performance-green)" }} />
          Portfolio · {today}
          <span style={{ marginLeft: "auto", display: "flex", gap: 18, textTransform: "none", letterSpacing: 0 }}>
            {role === "admin" && <Link href="/research" style={{ fontSize: 13, fontWeight: 600, color: "var(--fg2)", textDecoration: "none" }}>Research</Link>}
            {role === "admin" && <Link href="/admin" style={{ fontSize: 13, fontWeight: 600, color: "var(--fg2)", textDecoration: "none" }}>Admin</Link>}
          </span>
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 56, letterSpacing: "-0.01em", margin: "10px 0 32px" }}>
          Every client, <em style={{ color: "var(--tm-green-deep)" }}>one screen</em>
        </h1>

        {error && <div style={{ padding: 16, borderRadius: 8, background: "#FBE7E4", color: "var(--danger)", fontSize: 14, marginBottom: 24 }}>Query failed: {error.message}</div>}

        {/* attention rail */}
        <section style={{ background: attention.length ? "#FFF9EC" : "var(--tm-deep-charcoal)", border: `1px solid ${attention.length ? "#EAD9A6" : "var(--tm-deep-charcoal)"}`, borderRadius: "var(--radius-lg)", padding: "18px 22px", marginBottom: 28 }}>
          {attention.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 14, color: "var(--tm-stone-100)" }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--tm-performance-green)", flexShrink: 0 }} />
              <div style={{ fontSize: 15, fontWeight: 600 }}>All clear — every client healthy and fresh.</div>
              <div style={{ marginLeft: "auto", fontSize: 12.5, color: "#9AA0A6" }}>{clients.length} clients · {collectionsToday} collections today · 0 failures</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#8A6D1F", marginBottom: 10 }}>Needs attention · {attention.length}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {attention.map((a, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: markColor[a.kind], flexShrink: 0 }} />
                    {a.text}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* per-client scorecards — revenue-first */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {clients.map((c) => {
            const [cur, prev] = snaps.get(c.id) ?? [];
            const src = revBySrc.get(c.id) ?? {};
            const shop = src["shopify"]; const ga4rev = src["ga4"];
            const actualRev = (shop?.rev ?? 0) > 0 ? shop!.rev : (ga4rev?.rev ?? 0);
            const revSrc = (shop?.rev ?? 0) > 0 ? "Shopify" : (ga4rev?.rev ?? 0) > 0 ? "GA4" : null;
            const orders = (shop?.rev ?? 0) > 0 ? shop!.orders : (ga4rev?.orders ?? 0);
            const pd = paid.get(c.id);
            const spend = pd?.spend ?? 0;
            const claimed = pd?.revenue ?? 0;
            const mer = spend > 0 && actualRev > 0 ? actualRev / spend : null;
            const over = actualRev > 0 && claimed > 0 && claimed / actualRev > 0.85;
            const f = ago(freshest.get(c.id) ?? null);
            return (
              <section key={c.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)", overflow: "hidden" }}>
                <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 22px", borderBottom: "1px solid var(--border)" }}>
                  <span title={f.stale ? "Data is stale" : "Data is fresh"} style={{ width: 8, height: 8, borderRadius: "50%", background: f.stale ? "#B8860B" : "var(--tm-performance-green)", flexShrink: 0 }} />
                  <Link href={`/dashboard/${c.id}`} style={{ fontSize: 17, fontWeight: 600, color: "var(--fg1)", textDecoration: "none" }}>{c.name}</Link>
                  <span style={{ fontSize: 13, color: "var(--fg3)" }}>{c.domain}</span>
                  {c.tier && <span style={{ fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: "var(--radius-pill)", background: "var(--tm-deep-charcoal)", color: "var(--tm-performance-green)" }}>{c.tier}</span>}
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
                    <span style={{ fontSize: 12, color: "var(--fg3)" }}>{f.label}</span>
                    <Link href={`/dashboard/${c.id}`} style={{ fontSize: 13, fontWeight: 600, color: "var(--fg2)", textDecoration: "none" }}>Overview →</Link>
                  </div>
                </header>
                <div style={{ display: "flex", padding: "18px 4px 20px", flexWrap: "wrap", rowGap: 16 }}>
                  <Channel label="MER · blended" value={mer != null ? mer.toFixed(2) + "×" : "–"} accent={mer != null}
                    sub={mer != null
                      ? <span style={{ fontSize: 12, color: "var(--fg3)" }}>{money(spend)} spend{over && <span style={{ color: "#B8860B", fontWeight: 600 }}> · ⚑</span>}</span>
                      : <span style={{ fontSize: 12, color: "var(--fg3)" }}>{spend > 0 ? "no revenue" : "no ad spend"}</span>} />
                  <Channel label="Revenue" value={revSrc ? money(actualRev) : "–"}
                    sub={revSrc ? <span style={{ fontSize: 12, color: "var(--fg3)" }}>{revSrc} · {orders} orders</span> : <span style={{ fontSize: 12, color: "var(--fg3)" }}>{c.ga4_property_id ? "collecting" : "not linked"}</span>} />
                  <Channel label="Ad spend" value={spend > 0 ? money(spend) : "–"} sub={<span style={{ fontSize: 12, color: "var(--fg3)" }}>{spend > 0 ? "total · period" : "no paid"}</span>} />
                  <Channel label="Organic" value={pct(cur?.visibility ?? null)} sub={<Delta value={delta(cur?.visibility ?? null, prev?.visibility ?? null)} unit="pt" />} />
                  <Channel label="AI answers" value={pct(cur?.ai_visibility ?? null)} sub={<Delta value={delta(cur?.ai_visibility ?? null, prev?.ai_visibility ?? null)} unit="pt" />} />
                </div>
              </section>
            );
          })}
          {clients.length === 0 && !error && <div style={{ fontSize: 14, color: "var(--fg3)" }}>No active clients yet.</div>}
        </div>
      </div>
    </main>
  );
}
