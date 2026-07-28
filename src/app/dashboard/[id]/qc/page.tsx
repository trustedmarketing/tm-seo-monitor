// app/dashboard/[id]/qc/page.tsx — site quality.
//
// WO-003. The spec calls this "the artifact that justifies the retainer during
// renewal conversations", and that only works if it shows what to FIX rather
// than a score that moved.
//
// So issues lead, ranked by severity, with the count of affected pages and a
// plain sentence on why each one matters. The score is context, not the point.
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabaseServer";
import { ClientHeader } from "@/components/ClientHeader";
import { workspaceTabs, type ClientType } from "@/lib/workspaceTabs";
import { classifyChecks, issueCounts, grade, type Severity } from "@/lib/qc";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

type Scan = {
  id: number; scanned_at: string; score: number | null;
  pages_crawled: number; checks: Record<string, number>;
};

const SEV: Record<Severity, { fg: string; bg: string; edge: string; label: string }> = {
  critical: { fg: "var(--danger)", bg: "#FBE7E4", edge: "#EBC9C4", label: "Critical" },
  high:     { fg: "#8C6500", bg: "#FFF9EC", edge: "#EAD9A6", label: "High" },
  medium:   { fg: "var(--fg2)", bg: "var(--bg)", edge: "var(--border)", label: "Medium" },
  low:      { fg: "var(--fg3)", bg: "transparent", edge: "var(--border)", label: "Low" },
};

export default async function Qc({ params }: { params: { id: string } }) {
  const db = userClient();
  const { data: client } = await db
    .from("clients").select("id, name, domain, tier, client_type, last_crawl_at").eq("id", params.id).single();
  if (!client) redirect("/dashboard");

  const type = ((client as { client_type?: string }).client_type ?? null) as ClientType;
  if (!workspaceTabs(type).some((t) => t.key === "qc")) redirect(`/dashboard/${params.id}`);

  const [{ data: scanRows }, { count: pending }] = await Promise.all([
    db.from("qc_scans").select("id, scanned_at, score, pages_crawled, checks")
      .eq("client_id", params.id).order("scanned_at", { ascending: false }).limit(12),
    db.from("approvals").select("id", { count: "exact", head: true })
      .eq("client_id", params.id).in("status", ["staged", "failed"]),
  ]);

  const scans = (scanRows ?? []) as Scan[];
  const latest = scans[0];
  const issues = latest ? classifyChecks(latest.checks) : [];
  const counts = issueCounts(issues);
  const prev = scans[1];

  return (
    <main style={{ padding: "40px 32px 64px" }}>
      <div style={{ maxWidth: 1180 }}>
        <ClientHeader
          id={params.id} name={client.name} domain={client.domain} tier={client.tier}
          clientType={type} active="qc" pending={pending ?? 0}
          sub={latest
            ? `Last crawl ${new Date(latest.scanned_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ${latest.pages_crawled} pages`
            : "No crawl recorded yet"}
        />

        {!latest ? (
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "32px 28px", maxWidth: 700 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 26, marginBottom: 8 }}>No crawl yet</div>
            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--fg2)", margin: 0 }}>
              Crawls run on the cadence set for this client&#39;s tier. The first one will appear here
              once it completes, usually within a day of being queued.
            </p>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginBottom: 8 }}>
              <Stat label="Site score" value={latest.score != null ? String(Math.round(Number(latest.score))) : "—"}
                    sub={grade(latest.score != null ? Number(latest.score) : null)}
                    delta={prev?.score != null && latest.score != null ? Number(latest.score) - Number(prev.score) : null} />
              <Stat label="Critical" value={String(counts.critical)} sub="fix today" danger={counts.critical > 0} />
              <Stat label="High" value={String(counts.high)} sub="real ranking damage" />
              <Stat label="Medium + low" value={String(counts.medium + counts.low)} sub="worth fixing" />
            </div>

            {counts.critical > 0 && (
              <div style={{
                background: "#FBE7E4", border: "1px solid #EBC9C4", borderRadius: 10,
                padding: "14px 16px", margin: "18px 0 26px", fontSize: 13.5, color: "var(--danger)", maxWidth: 860,
              }}>
                <strong>Critical issues do not wait for the approval queue.</strong> These fired a Slack
                alert when the crawl finished — a site that is down or set to noindex needs fixing now,
                not after a 24&#8209;hour decision window.
              </div>
            )}

            <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginTop: 22 }}>
              {issues.length === 0 ? (
                <div style={{ padding: "28px 22px", fontSize: 14.5, color: "var(--fg2)" }}>
                  No issues flagged in the last crawl. That is a genuine clean sheet, not a missing check.
                </div>
              ) : issues.map((iss, i) => {
                const sv = SEV[iss.severity];
                return (
                  <div key={iss.check} style={{
                    display: "flex", alignItems: "flex-start", gap: 16, padding: "15px 20px",
                    borderTop: i === 0 ? "none" : "1px solid var(--border)", flexWrap: "wrap",
                  }}>
                    <div style={{
                      fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                      padding: "4px 9px", borderRadius: 999, background: sv.bg, color: sv.fg,
                      border: `1px solid ${sv.edge}`, whiteSpace: "nowrap", minWidth: 74, textAlign: "center",
                    }}>{sv.label}</div>

                    <div style={{ flex: 1, minWidth: 280 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--fg1)" }}>{iss.label}</div>
                      <div style={{ fontSize: 13, color: "var(--fg2)", marginTop: 3 }}>{iss.why}</div>
                    </div>

                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg1)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                      {iss.count} page{iss.count === 1 ? "" : "s"}
                    </div>
                  </div>
                );
              })}
            </div>

            {scans.length > 1 && (
              <section style={{ marginTop: 34 }}>
                <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 24, margin: "0 0 12px" }}>
                  Scan history
                </h2>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {scans.map((s) => (
                    <div key={s.id} style={{
                      background: "#fff", border: "1px solid var(--border)", borderRadius: 10,
                      padding: "10px 14px", minWidth: 116,
                    }}>
                      <div style={{ fontSize: 11.5, color: "var(--fg3)" }}>
                        {new Date(s.scanned_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </div>
                      <div style={{ fontFamily: "var(--font-display)", fontSize: 24, lineHeight: 1.2 }}>
                        {s.score != null ? Math.round(Number(s.score)) : "—"}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--fg3)" }}>{s.pages_crawled} pages</div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value, sub, delta, danger }: {
  label: string; value: string; sub: string; delta?: number | null; danger?: boolean;
}) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg3)" }}>{label}</div>
      <div style={{
        fontFamily: "var(--font-display)", fontSize: 40, lineHeight: 1.05, margin: "4px 0 2px",
        color: danger ? "var(--danger)" : "var(--fg1)",
      }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--fg3)" }}>
        {sub}
        {delta != null && delta !== 0 && (
          <span style={{ marginLeft: 7, fontWeight: 600, color: delta > 0 ? "var(--success)" : "var(--danger)" }}>
            {delta > 0 ? "▲ +" : "▼ "}{Math.round(delta)}
          </span>
        )}
      </div>
    </div>
  );
}
