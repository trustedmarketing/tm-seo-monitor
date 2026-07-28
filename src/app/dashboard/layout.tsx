// app/dashboard/layout.tsx — the agency shell.
//
// WO-003 Stream M. Wraps every agency surface in the design's sidebar so the
// whole product reads as one system rather than a set of pages. Route access is
// already gated by middleware and data access by RLS; this layer is chrome.
import { getProfile, userClient } from "@/lib/supabaseServer";
import { Sidebar } from "@/components/Sidebar";
import { classifyChecks, criticalIssues } from "@/lib/qc";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();

  // Counts for the nav badges. Head-only counts, so this costs three cheap
  // queries rather than pulling the rows. RLS already scopes them to what this
  // user can see, which is what makes the number honest rather than global.
  const db = userClient();
  const [approvals, clients, scans] = await Promise.all([
    db.from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    db.from("clients").select("id", { count: "exact", head: true }).eq("active", true),
    // qc_scans has no status column — the verdict lives in `checks`, so the
    // badge has to be computed rather than counted. Latest scan per client only:
    // an old failing scan that has since been fixed is not an open problem.
    db.from("qc_scans").select("client_id, checks, scanned_at").order("scanned_at", { ascending: false }).limit(200),
  ]);

  const latestPerClient = new Map<string, Record<string, number>>();
  for (const row of scans.data ?? []) {
    if (!latestPerClient.has(row.client_id)) {
      latestPerClient.set(row.client_id, (row.checks ?? {}) as Record<string, number>);
    }
  }
  const qcFailing = [...latestPerClient.values()]
    .filter((checks) => criticalIssues(classifyChecks(checks)).length > 0).length;

  return (
    <div style={{
      display: "flex", alignItems: "stretch", minHeight: "100vh",
      background: "var(--bg)", fontFamily: "var(--font-body)", color: "var(--fg1)",
    }}>
      <Sidebar
        profile={profile}
        counts={{
          approvals: approvals.count ?? 0,
          qc: qcFailing,
          clients: clients.count ?? 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
