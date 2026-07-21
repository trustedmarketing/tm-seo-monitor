import Link from "next/link";
import { METRIC_INFO } from "@/lib/metricInfo";
import { dbClient } from "@/lib/db";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/authToken";
import { Info, InfoStyles } from "@/components/Info";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

type Snap = {
  client_id: string; captured_at: string;
  organic_traffic: number | null; organic_keywords: number | null;
  backlinks: number | null; site_health: number | null;
  visibility: number | null; ai_visibility: number | null; ai_mentions: number | null;
};
type Client = { id: string; name: string; domain: string; tier: string | null };

function fmt(n: number | null): string {
  if (n == null) return "–";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}
function d(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null) return null;
  return Math.round((cur - prev) * 100) / 100;
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
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg2)", display: "flex", alignItems: "center" }}>
        {label}
        <Info text={METRIC_INFO[label] ?? ""} />
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 44, lineHeight: 1.1, letterSpacing: "-0.02em", margin: "6px 0 2px" }}>{value}</div>
      <Delta value={delta} suffix={suffix} />
    </div>
  );
}

export default async function Dashboard() {
  const role = await verifyToken(cookies().get("tm_auth")?.value, process.env.CRON_SECRET!);
  const db = dbClient();

  const [{ data: clients, error: cErr }, { data: snaps, error: sErr }] = await Promise.all([
    db.from("clients").select("id, name, domain, tier").eq("active", true).order("name"),
    db.from("metric_snapshots").select("*").order("captured_at", { ascending: false }).limit(500),
  ]);
  const error = cErr ?? sErr;

  const byClient = new Map<string, Snap[]>();
  for (const s of (snaps ?? []) as Snap[]) {
    const list = byClient.get(s.client_id) ?? [];
    if (list.length < 2) { list.push(s); byClient.set(s.client_id, list); }
  }

  return (
    <main style={{ fontFamily: "var(--font-body)", background: "var(--bg)", minHeight: "100vh", padding: "48px 24px", color: "var(--fg1)" }}>
      <InfoStyles />
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--fg2)", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--tm-performance-green)" }} />
          Client performance
          {role === "admin" && (
            <span style={{ marginLeft: "auto", display: "flex", gap: 18, textTransform: "none", letterSpacing: 0 }}>
              <Link href="/research" style={{ fontSize: 13, fontWeight: 600, color: "var(--fg2)", textDecoration: "none" }}>Research</Link>
              <Link href="/admin" style={{ fontSize: 13, fontWeight: 600, color: "var(--fg2)", textDecoration: "none" }}>Admin</Link>
            </span>
          )}
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 56, letterSpacing: "-0.01em", margin: "10px 0 40px" }}>
          Portfolio <em style={{ color: "var(--tm-green-deep)" }}>this week</em>
        </h1>

        {error && (
          <div style={{ padding: 16, borderRadius: 8, background: "#FBE7E4", color: "var(--danger)", fontSize: 14, marginBottom: 24 }}>
            Dashboard query failed: {error.message}
          </div>
        )}
        {!error && (clients ?? []).length === 0 && (
          <div style={{ fontSize: 14, color: "var(--fg3)" }}>No active clients yet.</div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {((clients ?? []) as Client[]).map((c) => {
            const [cur, prev] = byClient.get(c.id) ?? [];
            return (
              <section key={c.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)", overflow: "hidden" }}>
                <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 24px", borderBottom: "1px solid var(--border)" }}>
                  <Link href={`/dashboard/${c.id}`} style={{ fontSize: 17, fontWeight: 600, color: "var(--fg1)", textDecoration: "none", borderBottom: "2px solid var(--tm-performance-green)" }}>
                    {c.name}
                  </Link>
                  <a href={`https://${c.domain}`} style={{ fontSize: 13, color: "var(--fg3)", textDecoration: "none" }}>{c.domain}</a>
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                    {c.tier && (
                      <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: "var(--radius-pill)", background: "var(--tm-deep-charcoal)", color: "var(--tm-performance-green)" }}>{c.tier}</span>
                    )}
                    <Link href={`/dashboard/${c.id}`} style={{ fontSize: 13, fontWeight: 600, color: "var(--fg2)", textDecoration: "none" }}>
                      Details →
                    </Link>
                  </div>
                </header>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 24, padding: "20px 24px 24px" }}>
                  <Metric label="Site health" value={cur?.site_health != null ? `${Math.round(cur.site_health)}%` : "–"} delta={d(cur?.site_health ?? null, prev?.site_health ?? null)} />
                  <Metric label="Visibility" value={cur?.visibility != null ? `${cur.visibility}%` : "–"} delta={d(cur?.visibility ?? null, prev?.visibility ?? null)} />
                  <Metric label="Organic traffic" value={fmt(cur?.organic_traffic ?? null)} delta={d(cur?.organic_traffic ?? null, prev?.organic_traffic ?? null)} />
                  <Metric label="Organic keywords" value={fmt(cur?.organic_keywords ?? null)} delta={d(cur?.organic_keywords ?? null, prev?.organic_keywords ?? null)} />
                  <Metric label="Backlinks" value={fmt(cur?.backlinks ?? null)} delta={d(cur?.backlinks ?? null, prev?.backlinks ?? null)} />
                  <Metric label="AI visibility" value={cur?.ai_visibility != null ? `${cur.ai_visibility}%` : "–"} delta={null} />
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
