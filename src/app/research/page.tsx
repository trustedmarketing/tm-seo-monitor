"use client";
// /research — internal tools: site audit, competitor lookup, keyword research.
// Admin-only (middleware enforces; the API double-checks).
import { useState } from "react";
import "@/styles/tm-tokens.css";

type Tab = "audit" | "competitors" | "keywords";

const S = {
  input: {
    fontFamily: "var(--font-body)", fontSize: 14, padding: "10px 12px",
    border: "1px solid var(--border-strong)", borderRadius: 8,
    background: "#fff", color: "var(--fg1)", outline: "none", flex: 1,
  } as React.CSSProperties,
  btn: {
    fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 14,
    padding: "11px 18px", borderRadius: 8, border: "none", cursor: "pointer",
    background: "var(--tm-performance-green)", color: "#080808",
  } as React.CSSProperties,
  card: {
    background: "#fff", border: "1px solid var(--border)", borderRadius: 12,
    boxShadow: "var(--shadow-sm)", padding: 24,
  } as React.CSSProperties,
  th: {
    textAlign: "left", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em",
    textTransform: "uppercase", color: "var(--fg2)", padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
  } as React.CSSProperties,
  td: {
    fontSize: 14, padding: "10px 12px", borderBottom: "1px solid var(--border)",
  } as React.CSSProperties,
  eyebrow: {
    fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase",
    color: "var(--fg2)", marginBottom: 12,
  } as React.CSSProperties,
};

function fmt(n: number | null | undefined): string {
  if (n == null) return "–";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg2)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 40, lineHeight: 1.1, margin: "6px 0 0" }}>{value}</div>
    </div>
  );
}

export default function Research() {
  const [tab, setTab] = useState<Tab>("audit");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [audit, setAudit] = useState<any>(null);
  const [comp, setComp] = useState<any>(null);
  const [kw, setKw] = useState<any>(null);

  async function runTool() {
    if (!input.trim()) return;
    setBusy(true); setErr("");
    const body =
      tab === "keywords"
        ? { action: "keywords", seed: input }
        : { action: tab, domain: input };
    const res = await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setBusy(false);
    if (json.error) { setErr(json.error); return; }
    if (tab === "audit") setAudit(json);
    if (tab === "competitors") setComp(json);
    if (tab === "keywords") setKw(json);
  }

  const tabs: { key: Tab; label: string; placeholder: string }[] = [
    { key: "audit", label: "Site audit", placeholder: "domain.com — any site, client or not" },
    { key: "competitors", label: "Competitors", placeholder: "domain.com — find who shares its keywords" },
    { key: "keywords", label: "Keyword research", placeholder: "seed keyword, e.g. boat salt remover" },
  ];

  return (
    <main style={{ fontFamily: "var(--font-body)", background: "var(--bg)", minHeight: "100vh", padding: "48px 24px", color: "var(--fg1)" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <a href="/dashboard" style={{ fontSize: 13, fontWeight: 600, color: "var(--fg2)", textDecoration: "none" }}>← Portfolio</a>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 48, letterSpacing: "-0.01em", margin: "14px 0 28px" }}>
          Research <em style={{ color: "var(--tm-green-deep)" }}>tools</em>
        </h1>

        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {tabs.map((t) => (
            <button key={t.key} onClick={() => { setTab(t.key); setErr(""); }} style={{
              fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 600,
              padding: "8px 16px", borderRadius: 999, cursor: "pointer",
              background: tab === t.key ? "var(--tm-deep-charcoal)" : "transparent",
              color: tab === t.key ? "var(--tm-performance-green)" : "var(--fg1)",
              border: tab === t.key ? "1px solid transparent" : "1px solid var(--border-strong)",
            }}>{t.label}</button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
          <input style={S.input} value={input}
            placeholder={tabs.find((t) => t.key === tab)!.placeholder}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runTool()} />
          <button style={S.btn} onClick={runTool} disabled={busy}>
            {busy ? "Running…" : "Run"}
          </button>
        </div>
        {err && <div style={{ padding: 14, borderRadius: 8, background: "#FBE7E4", color: "var(--danger)", fontSize: 14, marginBottom: 20 }}>{err}</div>}

        {/* ── Audit results ── */}
        {tab === "audit" && audit && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={S.card}>
              <div style={S.eyebrow}>Overview — {audit.domain}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 24 }}>
                <Stat label="Est. traffic /mo" value={fmt(audit.overview?.organicTraffic)} />
                <Stat label="Ranking keywords" value={fmt(audit.overview?.organicKeywords)} />
                <Stat label="Backlinks" value={fmt(audit.links?.backlinks)} />
                <Stat label="Referring domains" value={fmt(audit.links?.referringDomains)} />
              </div>
            </div>
            <div style={{ ...S.card, paddingBottom: 8 }}>
              <div style={S.eyebrow}>Top ranking keywords</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={S.th}>Keyword</th><th style={S.th}>Position</th><th style={S.th}>Volume /mo</th>
                </tr></thead>
                <tbody>
                  {(audit.topKeywords ?? []).map((k: any) => (
                    <tr key={k.keyword}>
                      <td style={{ ...S.td, fontWeight: 600 }}>{k.keyword}</td>
                      <td style={{ ...S.td, fontFamily: "var(--font-display)", fontSize: 20 }}>{k.position ?? "–"}</td>
                      <td style={S.td}>{fmt(k.volume)}</td>
                    </tr>
                  ))}
                  {(audit.topKeywords ?? []).length === 0 && (
                    <tr><td style={S.td} colSpan={3}>No top-30 rankings found for this domain.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Competitor results ── */}
        {tab === "competitors" && comp && (
          <div style={{ ...S.card, paddingBottom: 8 }}>
            <div style={S.eyebrow}>Organic competitors of {comp.domain}</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={S.th}>Domain</th><th style={S.th}>Shared keywords</th>
                <th style={S.th}>Est. traffic /mo</th><th style={S.th}>Total keywords</th><th style={S.th}>Avg position</th>
              </tr></thead>
              <tbody>
                {(comp.competitors ?? []).map((c: any) => (
                  <tr key={c.domain}>
                    <td style={{ ...S.td, fontWeight: 600 }}>
                      <a href={`https://${c.domain}`} target="_blank" rel="noreferrer" style={{ color: "var(--fg1)" }}>{c.domain}</a>
                    </td>
                    <td style={{ ...S.td, fontFamily: "var(--font-display)", fontSize: 20 }}>{fmt(c.sharedKeywords)}</td>
                    <td style={S.td}>{fmt(c.traffic)}</td>
                    <td style={S.td}>{fmt(c.keywords)}</td>
                    <td style={S.td}>{c.avgPosition ?? "–"}</td>
                  </tr>
                ))}
                {(comp.competitors ?? []).length === 0 && (
                  <tr><td style={S.td} colSpan={5}>No overlapping competitors found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Keyword results ── */}
        {tab === "keywords" && kw && (
          <div style={{ ...S.card, paddingBottom: 8 }}>
            <div style={S.eyebrow}>Keyword ideas for "{kw.seed}"</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={S.th}>Keyword</th><th style={S.th}>Volume /mo</th>
                <th style={S.th}>Difficulty</th><th style={S.th}>CPC</th><th style={S.th}>Intent</th>
              </tr></thead>
              <tbody>
                {(kw.keywords ?? []).map((k: any) => (
                  <tr key={k.keyword}>
                    <td style={{ ...S.td, fontWeight: 600 }}>{k.keyword}</td>
                    <td style={{ ...S.td, fontFamily: "var(--font-display)", fontSize: 20 }}>{fmt(k.volume)}</td>
                    <td style={S.td}>
                      {k.difficulty == null ? "–" : (
                        <span style={{
                          fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                          background: k.difficulty >= 70 ? "#FBE7E4" : k.difficulty >= 40 ? "#FFF6DB" : "#E5F4EA",
                          color: k.difficulty >= 70 ? "#A33023" : k.difficulty >= 40 ? "#8C6500" : "#2F8F4E",
                        }}>{k.difficulty}</span>
                      )}
                    </td>
                    <td style={S.td}>{k.cpc != null ? `$${k.cpc}` : "–"}</td>
                    <td style={{ ...S.td, textTransform: "capitalize", color: "var(--fg2)" }}>{k.intent ?? "–"}</td>
                  </tr>
                ))}
                {(kw.keywords ?? []).length === 0 && (
                  <tr><td style={S.td} colSpan={5}>No suggestions returned for that seed.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
