"use client";

// components/Sidebar.tsx — the agency shell nav.
//
// WO-003 Stream M, ported from docs/design/Growth OS.dc.html (sidebar at the top
// of the export). 248px, white, sticky full-height.
//
// Two deliberate departures from the design, both because the export is one
// file demonstrating a whole product and some of its chrome only makes sense in
// that context:
//
//  1. The Agency/Portal pill toggle. That is how one HTML file shows both sides.
//     In production the side you see is decided by your role and enforced by
//     RLS, so the toggle would either do nothing or imply an agency user can
//     browse the client view — which is not what a client actually sees.
//     Replaced by the view caption underneath, which states the same fact
//     ("Specialist view · 3 clients") without offering a control that lies.
//
//  2. "Approval Card lab" and "Component inventory" nav items. Those are the
//     design file's own component gallery — pages that exist to show the
//     components off, not product surfaces. Adding them would put two entries in
//     the nav that lead nowhere.
//
// Everything else here follows the export.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isAgency, type Profile } from "@/lib/roles";

type Item = {
  label: string;
  href: string;
  /** Live count shown as a pill. Hidden at zero — a badge reading 0 is noise. */
  count?: number;
  /** false = visible but not yet built; links to a holding page. */
  built?: boolean;
};

export type SidebarCounts = {
  approvals?: number;
  qc?: number;
  clients?: number;
};

export function Sidebar({
  profile, counts = {},
}: { profile: Profile | null; counts?: SidebarCounts }) {
  const agency = isAgency(profile);
  const pathname = usePathname() ?? "";

  const items: Item[] = agency
    ? [
        { label: "Portfolio", href: "/dashboard", built: true },
        { label: "Approvals queue", href: "/dashboard/approvals", built: true, count: counts.approvals },
        { label: "QC panel", href: "/dashboard/qc", built: false, count: counts.qc },
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

        {/* Stands in for the export's Agency/Portal toggle: says which side you
            are on and how much you can see, without implying you can switch. */}
        <div className="caption" style={{ color: "var(--fg3)", marginTop: "var(--space-3)" }}>
          {agency
            ? `${roleLabel(profile)} view · ${counts.clients ?? 0} client${counts.clients === 1 ? "" : "s"}`
            : "Client view"}
        </div>
      </div>

      <div style={{ padding: "12px 12px", display: "flex", flexDirection: "column", gap: 2, flex: 1, overflowY: "auto" }}>
        {items.map((n) => {
          const isActive =
            n.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname === n.href || pathname.startsWith(n.href + "/");
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
              {n.count ? (
                <span style={{
                  marginLeft: "auto", fontSize: 11, fontWeight: 600,
                  padding: "1px 7px", borderRadius: 999,
                  background: "var(--bg)", color: "var(--fg2)",
                }}>
                  {n.count}
                </span>
              ) : null}
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

/** "Specialist" / "Owner" — what the export's caption calls the viewer. */
function roleLabel(profile: Profile | null): string {
  const r = profile?.role ?? "";
  if (r === "owner") return "Owner";
  if (r === "pod_lead") return "Pod lead";
  return "Specialist";
}
