// components/Sidebar.tsx — the agency shell nav.
//
// WO-003 Stream M, ported from docs/design/Growth OS.dc.html (sidebar at the top
// of the export). 248px, white, sticky full-height.
//
// Deliberate departure from the design: the export has an Agency/Portal pill
// toggle. That is a presentation device so one file can demo both sides. In
// production the side you see is decided by your role and enforced by RLS, so a
// toggle would either do nothing or imply an agency user can browse the client
// view — which is not what a client sees, and would be misleading.
import Link from "next/link";
import type { Profile } from "@/lib/supabaseServer";
import { isAgency } from "@/lib/supabaseServer";

type Item = {
  label: string;
  href: string;
  badge?: string;
  /** false = visible but not yet built; links to a holding page. */
  built?: boolean;
};

export function Sidebar({ profile, active }: { profile: Profile | null; active: string }) {
  const agency = isAgency(profile);

  const items: Item[] = agency
    ? [
        { label: "Portfolio", href: "/dashboard", built: true },
        { label: "Approvals queue", href: "/dashboard/approvals", built: false },
        { label: "QC panel", href: "/dashboard/qc", built: false },
        { label: "Paid controls", href: "/dashboard/paid-controls", built: false },
        { label: "Research", href: "/research", built: true },
        ...(profile?.role === "owner" ? [{ label: "Admin", href: "/admin", built: true }] : []),
      ]
    : [{ label: "Home", href: "/portal", built: true }];

  return (
    <nav style={{
      width: 248, flex: "none", background: "#FFFFFF",
      borderRight: "1px solid var(--border)", display: "flex",
      flexDirection: "column", position: "sticky", top: 0, height: "100vh",
      boxSizing: "border-box",
    }}>
      <div style={{ padding: "22px 20px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 26, lineHeight: 1, color: "var(--fg1)" }}>
          Growth<span style={{ color: "var(--tm-green-deep)" }}> OS</span>
        </div>
        <div style={{
          fontSize: 11, fontWeight: 600, textTransform: "uppercase",
          letterSpacing: "0.14em", color: "var(--fg3)", marginTop: 7,
        }}>
          Trusted Marketing
        </div>
      </div>

      <div style={{ padding: "12px 12px", display: "flex", flexDirection: "column", gap: 2, flex: 1, overflowY: "auto" }}>
        {items.map((n) => {
          const isActive = active === n.href;
          return (
            <Link key={n.href} href={n.href} style={{
              display: "flex", alignItems: "center", gap: 9,
              padding: "9px 10px", borderRadius: 8, textDecoration: "none",
              background: isActive ? "var(--bg)" : "transparent",
              color: n.built === false ? "var(--fg3)" : isActive ? "var(--fg1)" : "var(--fg2)",
              fontSize: 13.5, fontWeight: isActive ? 600 : 500,
            }}>
              <span style={{
                width: 5, height: 5, borderRadius: "50%",
                background: isActive ? "var(--tm-performance-green)" : "transparent",
                flexShrink: 0,
              }} />
              {n.label}
              {n.built === false && (
                <span style={{
                  marginLeft: "auto", fontSize: 10, fontWeight: 600,
                  letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg3)",
                }}>
                  soon
                </span>
              )}
              {n.badge && (
                <span style={{
                  marginLeft: "auto", fontSize: 11, fontWeight: 600,
                  padding: "1px 7px", borderRadius: 999,
                  background: "var(--bg)", color: "var(--fg2)",
                }}>
                  {n.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div style={{ padding: "14px 16px", borderTop: "1px solid var(--border)" }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg1)", overflow: "hidden", textOverflow: "ellipsis" }}>
          {profile?.full_name ?? profile?.email ?? "Signed out"}
        </div>
        <div style={{ fontSize: 11, color: "var(--fg3)", textTransform: "capitalize", marginTop: 2 }}>
          {profile?.role?.replace("_", " ") ?? ""}
        </div>
        <form action="/api/auth" method="post" style={{ marginTop: 10 }}>
          <button type="submit" style={{
            fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 600,
            padding: "6px 10px", borderRadius: 7, cursor: "pointer",
            border: "1px solid var(--border-strong)", background: "transparent",
            color: "var(--fg2)", width: "100%",
          }}>Sign out</button>
        </form>
      </div>
    </nav>
  );
}
