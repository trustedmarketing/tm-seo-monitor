import { getProfile, userClient } from "@/lib/supabaseServer";
import { redirect } from "next/navigation";
import "@/styles/tm-tokens.css";

// WO-003 Stream A — placeholder.
//
// Middleware routes client users here, so this route has to exist before any
// client account is created or their first login is a 404. The portal proper is
// Wave 4 (Stream J). Until then this is a deliberately honest holding page: it
// confirms the account works and says plainly that there is nothing to show yet.
//
// It does NOT show metrics. Per the accuracy gate, no client-facing number
// appears until its module has run two full collection cycles parallel-checked
// against the platform's own UI. A placeholder that leaked a half-checked figure
// would be worse than one that shows nothing.

export const dynamic = "force-dynamic";

export default async function Portal() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  // Reads through RLS: a client user sees only their linked clients. If this
  // ever returned another client's row, the policy would be broken.
  const { data: clients } = await userClient().from("clients").select("name").order("name");
  const names = (clients ?? []).map((c) => c.name);

  return (
    <main style={{ fontFamily: "var(--font-body)", background: "var(--bg)", minHeight: "100vh", color: "var(--fg1)", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-sm)", padding: 36, maxWidth: 520 }}>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--fg2)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--tm-performance-green)" }} />
          Trusted Marketing
        </div>

        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 38, lineHeight: 1.1, margin: "10px 0 14px" }}>
          Your dashboard is <em style={{ color: "var(--tm-green-deep)" }}>being built</em>
        </h1>

        <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--fg2)", margin: "0 0 18px" }}>
          You are signed in{profile.full_name ? `, ${profile.full_name}` : ""}. There is nothing to
          show here yet — we are still checking every number against the platforms it comes from, and
          we would rather show you nothing than show you something we have not verified.
        </p>

        {names.length > 0 && (
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--fg2)", margin: "0 0 18px" }}>
            This login is set up for <strong style={{ color: "var(--fg1)" }}>{names.join(", ")}</strong>.
          </p>
        )}

        <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--fg2)", margin: 0 }}>
          Your account manager will walk you through it when it opens.
        </p>

        <form action="/api/auth" method="post" style={{ marginTop: 26 }}>
          <button type="submit" style={{
            fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 13,
            padding: "9px 14px", borderRadius: 8, border: "1px solid var(--border-strong)",
            background: "transparent", color: "var(--fg2)", cursor: "pointer",
          }}>Sign out</button>
        </form>
      </div>
    </main>
  );
}
