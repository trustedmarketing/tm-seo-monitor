import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { METRIC_INFO } from "@/lib/metricInfo";
import { Info, InfoStyles } from "@/components/Info";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

type Snap = {
  captured_at: string;
  organic_traffic: number | null; organic_keywords: number | null;
  backlinks: number | null; site_health: number | null;
  visibility: number | null; ai_visibility: number | null;
};
type Ranking = { keyword_id: string; position: number | null; url: string | null; checked_at: string };
type Kw = { id: string; keyword: string };

function fmt(n: number | null): string {
  if (n == null) return "–";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}
function d(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null) return null;
  return Math.round((cur - prev) * 100) / 100;
}
function dateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function Delta({ value, suffix = "", invert = false }: { value: number | null; suffix?: string; invert?: boolean }) {
  if (value == null || value === 0) return <span style={{ fontSize: 12, color: "var(--fg3)" }}>–</span>;
  const good = invert ? value < 0 : value > 0;
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color: good ? "var(--success)" : "var(--danger)" }}>
      {value > 0 ? "+" : ""}{Number.isInteger(value) ? value : value.toFixed(2)}{suffix}
    </span>
  );
}

function Metric({ label, value, delta }: { label: string; value: string; delta: number | null }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg2)", display: "flex", alignItems: "center" }}>
        {label}
        <Info text={METRIC_INFO[label] ?? ""} />
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 44, lineHeight: 1.1, letterSpacing: "-0.02em", margin: "6px 0 2px" }}>{value}</div>
      <Delta value={delta} />
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em",
  textTransform: "uppercase", color: "var(--fg2)", padding: "10px 12px",
  borderBottom: "1px solid var(--border)",
};
const td: React.CSSProperties = {
  fontSize: 14, padding: "10px 12px", borderBottom: "1px solid var(--border)",
};

export default async function ClientDetail({ params }: { params: { id: string } }) {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const [{ data: client }, { data: snaps }, { data: kws }, { data: ranks }] = await Promise.all([
    db.from("clients").select("*").eq("id", params.id).single(),
    db.from("metric_snapshots").select("*").eq("client_id", params.id)
      .order("captured_at", { ascending: false }).limit(30),
    db.from("tracked_keywords").select("id, keyword").eq("client_id", params.id).eq("active", true).order("keyword"),
    db.from("keyword_rankings").select("keyword_id, position, url, checked_at").eq("client_id", params.id)
      .order("checked_at", { ascending: false }).limit(400),
  ]);

  if (!client) {
    return (
      <main style={{ fontFamily: "var(--font-body)", background: "var(--bg)", minHeight: "100vh", padding: 48 }}>
        Client not found. <Link href="/dashboard">Back to portfolio</Link>
      </main>
    );
  }

  const snapshots = (snaps ?? []) as Snap[];
  const [cur, prev] = snapshots;

  // latest + previous ranking per keyword
  const byKw = new Map<string, Ranking[]>();
  for (const r of (ranks ?? []) as Ranking[]) {
    const list = byKw.get(r.keyword_id) ?? [];
    if (list.length < 2) { list.push(r); byKw.set(r.keyword_id, list); }
  }
  const kwRows = ((kws ?? []) as Kw[]).map((k) => {
    const [rCur, rPrev] = byKw.get(k.id) ?? [];
    const posDelta =
      rCur?.position != null && rPrev?.position != null ? rPrev.position - rCur.position : null; // positive = moved up
    return { ...k, position: rCur?.position ?? null, url: rCur?.url ?? null, posDelta };
  }).sort((a, b) => (a.position ?? 999) - (b.position ?? 999));

  return (
    <main style={{ fontFamily: "var(--font-body)", background: "var(--bg)", minHeight: "100vh", padding: "48px 24px", color: "var(--fg1)" }}>
      <InfoStyles />
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <Link href="/dashboard" style={{ fontSize: 13, fontWeight: 600, color: "var(--fg2)", textDecoration: "none" }}>
          ← Portfolio
        </Link>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, margin: "14px 0 4px", flexWrap: "wrap" }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 48, letterSpacing: "-0.01em", margin: 0 }}>
            {client.name}
          </h1>
          <a href={`https://${client.domain}`} style={{ fontSize: 14, color: "var(--fg3)", textDecoration: "none" }}>{client.domain}</a>
          {client.tier && (
            <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: "var(--radius-pill)", background: "var(--tm-deep-charcoal)", color: "var(--tm-performance-green)" }}>{client.tier}</span>
          )}
        </div>
        <div style={{ fontSize: 13, color: "var(--fg3)", marginBottom: 32 }}>
          {cur ? `Last updated ${dateShort(cur.captured_at)}` : "No data collected yet"}
        </div>

        {/* Latest metrics */}
        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)", padding: "20px 24px 24px", marginBottom: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 24 }}>
            <Metric label="Site health" value={cur?.site_health != null ? `${Math.round(cur.site_health)}%` : "–"} delta={d(cur?.site_health ?? null, prev?.site_health ?? null)} />
            <Metric label="Visibility" value={cur?.visibility != null ? `${cur.visibility}%` : "–"} delta={d(cur?.visibility ?? null, prev?.visibility ?? null)} />
            <Metric label="Organic traffic" value={fmt(cur?.organic_traffic ?? null)} delta={d(cur?.organic_traffic ?? null, prev?.organic_traffic ?? null)} />
            <Metric label="Organic keywords" value={fmt(cur?.organic_keywords ?? null)} delta={d(cur?.organic_keywords ?? null, prev?.organic_keywords ?? null)} />
            <Metric label="Backlinks" value={fmt(cur?.backlinks ?? null)} delta={d(cur?.backlinks ?? null, prev?.backlinks ?? null)} />
            <Metric label="AI visibility" value={cur?.ai_visibility != null ? `${cur.ai_visibility}%` : "–"} delta={null} />
          </div>
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 24 }}>
          {/* Keyword rankings */}
          <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)", padding: "20px 24px 8px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg2)", display: "flex", alignItems: "center", marginBottom: 8 }}>
              Tracked keywords ({kwRows.length})
              <Info text="This client's tracked search terms and where they currently rank in Google. Position 1 is the top result; '–' means not in the top 100 yet. Change compares to the previous check." />
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Keyword</th>
                  <th style={th}>Position</th>
                  <th style={th}>Change</th>
                  <th style={th}>Ranking page</th>
                </tr>
              </thead>
              <tbody>
                {kwRows.map((k) => (
                  <tr key={k.id}>
                    <td style={{ ...td, fontWeight: 600 }}>{k.keyword}</td>
                    <td style={{ ...td, fontFamily: "var(--font-display)", fontSize: 20 }}>
                      {k.position ?? "–"}
                    </td>
                    <td style={td}><Delta value={k.posDelta} /></td>
                    <td style={{ ...td, fontSize: 13, color: "var(--fg3)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {k.url ? k.url.replace(/^https?:\/\/[^/]+/, "") || "/" : "–"}
                    </td>
                  </tr>
                ))}
                {kwRows.length === 0 && (
                  <tr><td style={td} colSpan={4}>No keywords tracked yet — add them in the admin.</td></tr>
                )}
              </tbody>
            </table>
          </section>

          {/* History */}
          <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)", padding: "20px 24px 8px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg2)", display: "flex", alignItems: "center", marginBottom: 8 }}>
              Collection history
              <Info text="Every data collection for this client, newest first. Site health and visibility only appear on runs where those checks were due, per this client's tracking frequencies." />
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Date</th>
                  <th style={th}>Visibility</th>
                  <th style={th}>Traffic</th>
                  <th style={th}>Keywords</th>
                  <th style={th}>Backlinks</th>
                  <th style={th}>Site health</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s) => (
                  <tr key={s.captured_at}>
                    <td style={{ ...td, fontWeight: 600 }}>{dateShort(s.captured_at)}</td>
                    <td style={td}>{s.visibility != null ? `${s.visibility}%` : "–"}</td>
                    <td style={td}>{fmt(s.organic_traffic)}</td>
                    <td style={td}>{fmt(s.organic_keywords)}</td>
                    <td style={td}>{fmt(s.backlinks)}</td>
                    <td style={td}>{s.site_health != null ? `${Math.round(s.site_health)}%` : "–"}</td>
                  </tr>
                ))}
                {snapshots.length === 0 && (
                  <tr><td style={td} colSpan={6}>No collections yet.</td></tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </main>
  );
}
