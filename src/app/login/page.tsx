"use client";
import { useState } from "react";
import "@/styles/tm-tokens.css";

export default function Login() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setErr("");
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    setBusy(false);
    if (!res.ok) { setErr("Wrong password"); return; }
    const next = new URLSearchParams(window.location.search).get("next") ?? "/dashboard";
    window.location.href = next;
  }

  return (
    <main style={{ fontFamily: "var(--font-body)", background: "var(--bg)", minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--fg1)" }}>
      <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-sm)", padding: 32, width: 360 }}>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--fg2)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--tm-performance-green)" }} />
          Trusted Marketing
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 34, margin: "8px 0 20px" }}>
          Client <em style={{ color: "var(--tm-green-deep)" }}>performance</em>
        </h1>
        <input type="password" placeholder="Password" value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          style={{ fontFamily: "var(--font-body)", fontSize: 14, padding: "10px 12px", border: "1px solid var(--border-strong)", borderRadius: 8, width: "100%", outline: "none" }} />
        <button onClick={submit} disabled={busy} style={{
          fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 14, marginTop: 12,
          padding: "11px 16px", borderRadius: 8, border: "none", cursor: "pointer",
          background: "var(--tm-performance-green)", color: "#080808", width: "100%",
        }}>{busy ? "Signing in…" : "Sign in"}</button>
        {err && <div style={{ fontSize: 13, color: "var(--danger)", marginTop: 10 }}>{err}</div>}
      </div>
    </main>
  );
}
