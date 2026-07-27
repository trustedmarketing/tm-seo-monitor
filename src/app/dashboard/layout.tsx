// app/dashboard/layout.tsx — the agency shell.
//
// WO-003 Stream M. Wraps every agency surface in the design's sidebar so the
// whole product reads as one system rather than a set of pages. Route access is
// already gated by middleware and data access by RLS; this layer is chrome.
import { getProfile } from "@/lib/supabaseServer";
import { Sidebar } from "@/components/Sidebar";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();

  return (
    <div style={{
      display: "flex", alignItems: "stretch", minHeight: "100vh",
      background: "var(--bg)", fontFamily: "var(--font-body)", color: "var(--fg1)",
    }}>
      <Sidebar profile={profile} active="/dashboard" />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
