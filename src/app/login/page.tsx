"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { browserClient } from "@/lib/supabaseBrowser";
import "@/styles/tm-tokens.css";

// WO-003 Stream A. Per-user email + password via Supabase Auth, replacing the
// two shared passwords. Landing target depends on who signs in: agency users go
// to the dashboard, client users to their portal.

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(params.get("reason") === "no_access"
    ? "That account does not have access to this workspace."
    : "");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email || !pw) { setErr("Enter your email and password"); return; }
    setBusy(true); setErr("");

    const supabase = browserClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pw });

    if (error || !data.user) {
      setBusy(false);
      // Deliberately not distinguishing unknown-email from wrong-password: that
      // difference tells an attacker which addresses are real.
      setErr("Email or password is incorrect");
      return;
    }

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("role, is_active")
      .eq("id", data.user.id)
      .maybeSingle();

    if (!profile || !profile.is_active) {
      await supabase.auth.signOut();
      setBusy(false);
      setErr("That account does not have access to this workspace.");
      return;
    }

    const isAgency = ["owner", "pod_lead", "specialist"].includes(profile.role);
    const next = params.get("next");
    const fallback = isAgency ? "/dashboard" : "/portal";
    // Never honor a `next` that points at the other side of the product.
    const target = next && (isAgency ? !next.startsWith("/portal") : next.startsWith("/portal"))
      ? next
      : fallback;

    window.location.href = target;
  }

  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-sm)", padding: 32, width: 360 }}>
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--fg2)", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--tm-performance-green)" }} />
        Trusted Marketing
      </div>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 34, margin: "8px 0 20px" }}>
        Client <em style={{ color: "var(--tm-green-deep)" }}>performance</em>
      </h1>

      <input type="email" placeholder="Email" value={email} autoComplete="username"
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        style={inputStyle} />

      <input type="password" placeholder="Password" value={pw} autoComplete="current-password"
        onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        style={{ ...inputStyle, marginTop: 8 }} />

      <button onClick={submit} disabled={busy} style={{
        fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 14, marginTop: 12,
        padding: "11px 16px", borderRadius: 8, border: "none",
        cursor: busy ? "default" : "pointer",
        background: "var(--tm-performance-green)", color: "#080808", width: "100%",
      }}>{busy ? "Signing in…" : "Sign in"}</button>

      {err && <div style={{ fontSize: 13, color: "var(--danger)", marginTop: 10 }}>{err}</div>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontFamily: "var(--font-body)", fontSize: 14, padding: "10px 12px",
  border: "1px solid var(--border-strong)", borderRadius: 8, width: "100%",
  outline: "none", boxSizing: "border-box",
};

export default function Login() {
  return (
    <main style={{ fontFamily: "var(--font-body)", background: "var(--bg)", minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--fg1)" }}>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
