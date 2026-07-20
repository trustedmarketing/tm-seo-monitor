import { createClient } from "@supabase/supabase-js";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

type Row = {
  id: string; name: string; domain: string; tier: string | null;
  captured_at: string | null;
  organic_traffic: number | null;  d_traffic: number | null;
  organic_keywords: number | null; d_keywords: number | null;
  backlinks: number | null;        d_backlinks: number | null;
  site_health: number | null;      d_health: number | null;
  visibility: number | null;       d_visibility: number | null;
  ai_visibility: number | null;    ai_mentions: number | null;
};

function fmt(n: number | null): string {
  if (n == null) return "–";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function Delta({ value, suffix = "" }: { value: number | null; suffix?: string }) {
  if (value == null || value === 0) return null;
  const up = value > 0;
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color: up ? "var(--success)" : "var(--danger)" }}>
      {up ? "+" : ""}{Number.isInteger(value) ? value : value.toFixed(2)}{suffix}
    </span>
  );
}

function Metric({ label, value, delta, suffix = "" }: {
  label: string; value: string; delta: number | null; suffix?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg2)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 44, lineHeight: 1.1, letterSpacing: "-0.02em", margin: "6px 0 2px" }}>{value}</div>
      <Delta value={delta} suffix={suffix} />
    </div>
  );
}

export default async function Dashboard() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await db.from("client_dashboard").select("*").order("name");
  const rows = (data ?? []) as Row[];

  return (
    <main style={{ fontFamily: "var(--font-body)", background: "var(--bg)", minHeight: "100vh", padding: "48px 24px", color: "var(--fg1)" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--fg2)", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--tm-performance-green)" }} />
          Client performance
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 56, letterSpacing: "-0.01em", margin: "10px 0 40px" }}>
          Portfolio <em style={{ color: "var(--tm-green-deep)" }}>this week</em>
        </h1>

        {error && (
          <div style={{ padding: 16, borderRadius: 8, background: "#FBE7E4", color: "var(--danger)", fontSize: 14, marginBottom: 24 }}>
            Dashboard query failed: {error.message} (code: {error.code ?? "none"})
          </div>
        )}
        {!error && rows.length === 0 && (
          <div style={{ fontSize: 14, color: "var(--fg3)" }}>
            Query succeeded but returned no rows.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {rows.map((r) => (
            <section key={r.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)", overflow: "hidden" }}>
              <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 24px", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: 17, fontWeight: 600 }}>{r.name}</span>
                <a href={`https://${r.domain}`} style={{ fontSize: 13, color: "var(--fg3)", textDecoration: "none" }}>{r.domain}</a>
                {r.tier && (
                  <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: "var(--radius-pill)", background: "var(--tm-deep-charcoal)", color: "var(--tm-performance-green)" }}>{r.tier}</span>
                )}
              </header>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 24, padding: "20px 24px 24px" }}>
                <Metric label="Site health" value={r.site_health != null ? `${Math.round(r.site_health)}%` : "–"} delta={r.d_health} />
                <Metric label="Visibility" value={r.visibility != null ? `${r.visibility}%` : "–"} delta={r.d_visibility} />
                <Metric label="Organic traffic" value={fmt(r.organic_traffic)} delta={r.d_traffic} />
                <Metric label="Organic keywords" value={fmt(r.organic_keywords)} delta={r.d_keywords} />
                <Metric label="Backlinks" value={fmt(r.backlinks)} delta={r.d_backlinks} />
                <Metric label="AI visibility" value={r.ai_visibility != null ? `${r.ai_visibility}%` : "–"} delta={null} />
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}