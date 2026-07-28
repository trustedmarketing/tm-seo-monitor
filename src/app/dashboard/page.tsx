// app/dashboard/page.tsx — PORTFOLIO roll-up (WO-002 reorg).
// Revenue-first: an attention rail (the morning exception feed) over one
// scorecard per client, led by MER · Revenue · Spend. Routes into each client's
// Overview. Absorbs the old /command surface (which now redirects here).
import Link from "next/link";
import { userClient } from "@/lib/supabaseServer";
import { getProfile } from "@/lib/supabaseServer";
import "@/styles/tm-tokens.css";
import { fmtDateFull } from "@/lib/time";
import { PageHeader, AttentionRail } from "@/components/PageHeader";

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

/**
 * A metric cell: serif numeral over a small delta or qualifier.
 *
 * The numeral is Instrument Serif at 28px, which is the design's device for
 * making a table scannable without colour-coding every cell.
 */
function Cell({ value, sub, accent, muted }: {
  value: string; sub?: React.ReactNode; accent?: boolean; muted?: boolean;
}) {
  return (
    <td style={{ padding: "var(--space-4) var(--space-5)", verticalAlign: "middle", whiteSpace: "nowrap" }}>
      <div style={{
        fontFamily: "var(--font-display)", fontSize: 28, lineHeight: 1.1, letterSpacing: "-0.01em",
        color: muted || value === "–" ? "var(--fg3)" : accent ? "var(--tm-green-deep)" : "var(--fg1)",
      }}>{value}</div>
      {sub && <div style={{ marginTop: 2 }}>{sub}</div>}
    </td>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className="eyebrow" style={{
      textAlign: align, padding: "var(--space-3) var(--space-5)",
      color: "var(--fg3)", fontWeight: 700, borderBottom: "1px solid var(--border)",
    }}>{children}</th>
  );
}

/**
 * Tier pill.
 *
 * Scale is the dark chip with green text — the design reserves the inverted
 * treatment for the top tier so it reads as the exception in a column of pills.
 */
function TierPill({ tier }: { tier: string }) {
  const t = tier.toLowerCase();
  const style =
    t === "scale"  ? { background: "var(--tm-deep-charcoal)", color: "var(--tm-performance-green)" } :
    t === "growth" ? { background: "var(--tm-green-soft)", color: "var(--tm-green-deep)" } :
                     { background: "var(--tm-stone-200)", color: "var(--fg2)" };
  return (
    <span style={{
      ...style, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
      padding: "3px 8px", borderRadius: "var(--radius-pill)", flexShrink: 0,
    }}>{tier}</span>
  );
}

export default async function Portfolio() {
  const profile = await getProfile();
  const db = userClient();
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
  // Dedup by client+module. The cron fires per client, so a single broken
  // collector produced one attention row per invocation and "NEEDS ATTENTION · 2"
  // for one problem. A count that overstates erodes trust in the count.
  const seenFail = new Set<string>();
  for (const r of runs) {
    if (r.status !== "error") continue;
    const key = `${r.client_id ?? "portfolio"}:${r.module}`;
    if (seenFail.has(key)) continue;
    seenFail.add(key);
    attention.push({ kind: "fail", text: `Collection failed · ${nameOf.get(r.client_id ?? "") ?? "portfolio"} · ${r.module}` });
  }
  for (const c of clients) { const f = ago(freshest.get(c.id) ?? null); if (f.stale) attention.push({ kind: "stale", text: `Stale data · ${c.name} (${f.label})` }); }
  for (const ch of (chRes.data ?? []) as Change[]) if (ch.verdict === "declined") attention.push({ kind: "declined", text: `Change declined · ${nameOf.get(ch.client_id) ?? ""}: ${ch.title}` });

  const collectionsToday = runs.filter((r) => r.status === "success" && Date.now() - new Date(r.started_at).getTime() < 24 * 3600000).length;
  const markColor: Record<string, string> = { fail: "var(--danger)", declined: "var(--danger)", stale: "#B8860B" };
  const today = fmtDateFull(new Date());

  // The rail counts by kind. Each number links somewhere it can be acted on;
  // a count with no destination is a dead end dressed as a signal.
  const byKind = (k: string) => attention.filter((a) => a.kind === k).length;

  return (
    <main>
      <PageHeader
        eyebrow={`Agency · Morning page · ${today}`}
        title="Portfolio"
        subtitle={
          clients.length === 0
            ? "No active clients yet."
            : `Every client on one screen. ${clients.length} active, ${collectionsToday} collections in the last 24 hours.`
        }
      />

      <div style={{ padding: "var(--space-6) var(--space-8) var(--space-10)", maxWidth: 1280 }}>
        {error && (
          <div style={{
            padding: "var(--space-4)", borderRadius: "var(--radius-md)",
            background: "#FBE7E4", color: "var(--danger)", marginBottom: "var(--space-6)",
          }} className="body-sm">Query failed: {error.message}</div>
        )}

        {/* ── attention rail ──────────────────────────────────────────────── */}
        <div style={{ marginBottom: "var(--space-6)" }}>
          <AttentionRail
            items={[
              {
                label: "Collections failing",
                value: byKind("fail"),
                meaning: byKind("fail") === 0 ? "all collectors green" : "need a look today",
                tone: byKind("fail") > 0 ? "danger" : "normal",
              },
              {
                label: "Data going stale",
                value: byKind("stale"),
                meaning: byKind("stale") === 0 ? "everything fresh" : "over 36 hours old",
                tone: byKind("stale") > 0 ? "warning" : "normal",
              },
              {
                label: "Changes declined",
                value: byKind("declined"),
                meaning: byKind("declined") === 0 ? "no negative verdicts" : "shipped and went backwards",
                tone: byKind("declined") > 0 ? "danger" : "normal",
              },
            ]}
          />

          {/* The design stops at the numerals. Kept the detail underneath because
              a count you cannot expand tells you a problem exists and nothing
              about which client has it. */}
          {attention.length > 0 && (
            <ul style={{
              listStyle: "none", margin: "var(--space-3) 0 0", padding: 0,
              display: "flex", flexDirection: "column", gap: "var(--space-2)",
            }}>
              {attention.map((a, i) => (
                <li key={i} className="body-sm" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", color: "var(--fg2)" }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: markColor[a.kind], flexShrink: 0 }} />
                  {a.text}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── client table ────────────────────────────────────────────────── */}
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-xs)", overflowX: "auto",
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr>
                <Th>Client</Th>
                <Th>Revenue</Th>
                <Th>MER</Th>
                <Th>Ad spend</Th>
                <Th>Organic</Th>
                <Th>AI answers</Th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c, i) => {
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
                // Paid claiming most of total revenue means the platforms are
                // almost certainly double-counting. Flagged, not silently shown.
                const over = actualRev > 0 && claimed > 0 && claimed / actualRev > 0.85;
                const f = ago(freshest.get(c.id) ?? null);

                return (
                  <tr key={c.id} style={{
                    borderTop: "1px solid var(--divider)",
                    background: i % 2 ? "var(--tm-stone-100)" : "transparent",
                  }}>
                    <td style={{ padding: "var(--space-4) var(--space-5)", minWidth: 250 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                        <span
                          title={f.stale ? `Data is stale (${f.label})` : `Fresh, ${f.label}`}
                          style={{
                            width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                            background: f.stale ? "var(--warning)" : "var(--tm-performance-green)",
                          }}
                        />
                        <Link href={`/dashboard/${c.id}`} style={{
                          fontSize: 15, fontWeight: 600, color: "var(--fg1)", textDecoration: "none",
                        }}>{c.name}</Link>
                        {c.tier && <TierPill tier={c.tier} />}
                      </div>
                      <div className="caption" style={{ color: "var(--fg3)", marginTop: 3, marginLeft: 15 }}>
                        {c.domain} · {f.label}
                      </div>
                    </td>

                    <Cell
                      value={revSrc ? money(actualRev) : "–"}
                      sub={<span className="caption" style={{ color: "var(--fg3)" }}>
                        {revSrc ? `${revSrc} · ${orders} orders` : c.ga4_property_id ? "collecting" : "not linked"}
                      </span>}
                    />
                    <Cell
                      value={mer != null ? mer.toFixed(2) + "×" : "–"}
                      accent={mer != null}
                      sub={over
                        ? <span className="caption" style={{ color: "var(--warning)", fontWeight: 600 }}>⚑ paid over-claiming</span>
                        : <span className="caption" style={{ color: "var(--fg3)" }}>{spend > 0 ? "blended" : "no ad spend"}</span>}
                    />
                    <Cell
                      value={spend > 0 ? money(spend) : "–"}
                      sub={<span className="caption" style={{ color: "var(--fg3)" }}>{spend > 0 ? "period total" : "no paid"}</span>}
                    />
                    <Cell
                      value={pct(cur?.visibility ?? null)}
                      sub={<Delta value={delta(cur?.visibility ?? null, prev?.visibility ?? null)} unit="pt" />}
                    />
                    <Cell
                      value={pct(cur?.ai_visibility ?? null)}
                      sub={<Delta value={delta(cur?.ai_visibility ?? null, prev?.ai_visibility ?? null)} unit="pt" />}
                    />
                  </tr>
                );
              })}
            </tbody>
          </table>

          {clients.length === 0 && !error && (
            <div className="body-sm" style={{ padding: "var(--space-8)", color: "var(--fg3)", textAlign: "center" }}>
              No active clients yet.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
