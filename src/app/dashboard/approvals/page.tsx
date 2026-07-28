// app/dashboard/approvals/page.tsx — the decision queue.
//
// WO-003 Stream F (first pass). Spec: "Everything here is finished work. Your
// job is yes or no."
//
// Reads through userClient() so RLS applies — an agency user sees their org's
// clients and nothing else, enforced by Postgres rather than by this query.
import Link from "next/link";
import { userClient, getProfile } from "@/lib/supabaseServer";
import { ApprovalCard, type ApprovalRow } from "@/components/ApprovalCard";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

function Chip({ href, on, label, warn }: { href: string; on: boolean; label: string; warn?: boolean }) {
  return (
    <Link href={href} style={{
      fontSize: 13, fontWeight: 600, padding: "6px 12px", borderRadius: 999, textDecoration: "none",
      background: on ? "var(--tm-deep-charcoal)" : "#fff",
      color: on ? "var(--tm-performance-green)" : warn ? "#8C6500" : "var(--fg2)",
      border: `1px solid ${on ? "var(--tm-deep-charcoal)" : warn ? "#EAD9A6" : "var(--border)"}`,
    }}>{label}</Link>
  );
}

const MESSAGES: Record<string, string> = {
  published: "Published. The change is live and now being measured.",
  declined: "Declined. How long it stays suppressed depends on the reason you gave.",
  failed: "Publish failed. The card stayed in the queue with the error.",
  "already-in-progress": "Someone else is already working that card.",
  "needs-higher-role": "That card needs a higher role. Approval requested.",
  "reason-required": "Decline needs a reason.",
  "note-required": "Declining as Other needs a note — it is the one decline we cannot learn from otherwise.",
  "approval-requested": "Approval requested.",
  undone: "Undone. It was not live long enough to measure, so no verdict is pending.",
  reverted: "Reverted. Both the change and the reversal stay in the record.",
  "revert-failed": "Revert failed. The change is still live — check the error and try again.",
  "not-published": "That card is not in a published state.",
  "bulk-done": "Approved and published every low-risk card for that client.",
  "bulk-partial": "Some cards published, some failed. The failures stayed in the queue with their errors.",
  "bulk-nothing-eligible": "Nothing eligible — bulk approve covers low-risk cards you have the role to decide.",
  "bulk-needs-client": "Bulk approve has to name a client. It never spans clients.",
};

export default async function Approvals({
  searchParams,
}: {
  searchParams: { msg?: string; client?: string; severity?: string; age?: string };
}) {
  const profile = await getProfile();
  const db = userClient();

  // Recently published work stays visible so undo/revert is reachable without
  // hunting through a change log. 24h is enough to cover the undo window plus
  // the "I've just realised" gap after it.
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();

  // Spec: "Approvals → the queue. Filterable by client / type / severity / age."
  // One work surface, narrowed — not thirteen queues. Filtering happens in the
  // query rather than in the page so a large queue does not ship rows the user
  // will never see.
  let q = db.from("approvals")
    .select("*")
    .in("status", ["staged", "publishing", "failed"])
    .order("created_at", { ascending: true });

  if (searchParams.client) q = q.eq("client_id", searchParams.client);
  if (searchParams.severity) q = q.eq("severity", searchParams.severity);
  if (searchParams.age === "stale") {
    // Past its own SLA — the cards that have a consequence attached (#9).
    q = q.lt("sla_due_at", new Date().toISOString());
  }

  const [{ data: rows }, { data: recent }, { data: clients }] = await Promise.all([
    q,
    db.from("approvals")
      .select("*")
      .eq("status", "published")
      .gte("published_at", since)
      .order("published_at", { ascending: false }),
    db.from("clients").select("id, name"),
  ]);

  const nameOf = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const queue = (rows ?? []) as (ApprovalRow & { payload?: Record<string, string> })[];
  const published = (recent ?? []) as (ApprovalRow & { payload?: Record<string, string> })[];
  const msg = searchParams.msg ? MESSAGES[searchParams.msg] : null;

  // Counts come from the unfiltered set, so a filter never hides how much work
  // is actually waiting — a filtered view that also hides the total is how a
  // queue quietly grows.
  const { data: allOpen } = await db.from("approvals")
    .select("client_id, severity, sla_due_at")
    .in("status", ["staged", "publishing", "failed"]);
  const open = (allOpen ?? []) as { client_id: string; severity: string; sla_due_at: string | null }[];

  const filterHref = (patch: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { client: searchParams.client, severity: searchParams.severity, age: searchParams.age, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    const qs = sp.toString();
    return qs ? `?${qs}` : "/dashboard/approvals";
  };

  const staleCount = open.filter((r) => r.sla_due_at && new Date(r.sla_due_at) < new Date()).length;
  const anyFilter = !!(searchParams.client || searchParams.severity || searchParams.age);

  return (
    <main style={{ padding: "40px 32px 64px" }}>
      <div style={{ maxWidth: 1180 }}>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--fg2)", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--tm-performance-green)" }} />
          Agency · decision queue
        </div>

        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 48, letterSpacing: "-0.01em", margin: "10px 0 6px" }}>
          Approvals
        </h1>
        <p style={{ fontSize: 15, color: "var(--fg2)", margin: "0 0 28px" }}>
          Everything here is finished work. Your job is yes or no.
        </p>

        {open.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 22, alignItems: "center" }}>
            <Chip href={filterHref({ client: undefined, severity: undefined, age: undefined })}
                  on={!anyFilter} label={`All ${open.length}`} />
            {staleCount > 0 && (
              <Chip href={filterHref({ age: searchParams.age === "stale" ? undefined : "stale" })}
                    on={searchParams.age === "stale"} label={`Past SLA ${staleCount}`} warn />
            )}
            {["High", "Medium", "Low"].map((sev) => {
              const n = open.filter((r) => r.severity === sev).length;
              if (!n) return null;
              return (
                <Chip key={sev}
                      href={filterHref({ severity: searchParams.severity === sev ? undefined : sev })}
                      on={searchParams.severity === sev} label={`${sev} ${n}`} />
              );
            })}
            <span style={{ width: 1, height: 22, background: "var(--border)", margin: "0 4px" }} />
            {Object.entries(
              open.reduce<Record<string, number>>((acc, r) => {
                acc[r.client_id] = (acc[r.client_id] ?? 0) + 1; return acc;
              }, {})
            ).map(([cid, n]) => (
              <Chip key={cid}
                    href={filterHref({ client: searchParams.client === cid ? undefined : cid })}
                    on={searchParams.client === cid} label={`${nameOf.get(cid) ?? "unknown"} ${n}`} />
            ))}
          </div>
        )}

        {msg && (
          <div style={{ padding: "12px 16px", borderRadius: 8, background: "#fff", border: "1px solid var(--border)", fontSize: 14, marginBottom: 22 }}>
            {msg}
          </div>
        )}

        {queue.length === 0 && anyFilter ? (
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "28px 26px", maxWidth: 700 }}>
            <div style={{ fontSize: 15, color: "var(--fg2)" }}>
              Nothing matches that filter, though {open.length} card{open.length === 1 ? "" : "s"} are
              still waiting overall.{" "}
              <Link href="/dashboard/approvals" style={{ fontWeight: 600, color: "var(--fg1)" }}>Clear filters</Link>
            </div>
          </div>
        ) : queue.length === 0 ? (
          // The design's "earned" empty state — not a shrug, a result.
          <div style={{ background: "var(--tm-deep-charcoal)", borderRadius: 12, padding: "34px 30px", color: "var(--tm-stone-100)", maxWidth: 760 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 30, marginBottom: 8 }}>
              Queue clear
            </div>
            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "#9AA0A6", margin: 0 }}>
              Nothing is waiting on a decision. New recommendations arrive staged, screenshotted
              where possible, and QC&#8209;checked, so when they appear the work is already done.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/*
              Punch list #8: bulk approve is scoped to ONE client and to
              low-risk cards. The button is rendered per client group precisely
              so there is no "approve everything" affordance that could span
              clients — the constraint is in the interaction, not just the
              server check that also enforces it.
            */}
            {Object.entries(
              queue.reduce<Record<string, number>>((acc, r) => {
                if (r.severity !== "High") acc[r.client_id] = (acc[r.client_id] ?? 0) + 1;
                return acc;
              }, {})
            ).filter(([, n]) => n > 1).map(([cid, n]) => (
              <form key={cid} action="/api/approvals" method="post"
                    style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <input type="hidden" name="action" value="approve_all" />
                <input type="hidden" name="client_id" value={cid} />
                <button type="submit" style={{
                  fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 13,
                  padding: "9px 14px", borderRadius: 8, cursor: "pointer",
                  border: "1px solid var(--border-strong)", background: "#fff", color: "var(--fg1)",
                }}>
                  Approve all {n} low-risk · {nameOf.get(cid)}
                </button>
                <span style={{ fontSize: 12.5, color: "var(--fg3)" }}>
                  This client only. High-severity cards are never included.
                </span>
              </form>
            ))}

            {queue.map((row) => {
              const p = row.payload ?? {};
              return (
                <ApprovalCard
                  key={row.id}
                  row={{
                    ...row,
                    before: p.before,
                    after: p.after,
                    target_label: p.targetLabel,
                    serp_kind: p.serpKind as "title" | "description" | undefined,
                  }}
                  actorRole={profile?.role}
                  clientName={nameOf.get(row.client_id)}
                  freshness={row.variant === "site" ? "Live value read at stage time" : undefined}
                />
              );
            })}
          </div>
        )}

        {published.length > 0 && (
          <section style={{ marginTop: 44 }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 28, margin: "0 0 6px" }}>
              Published today
            </h2>
            <p style={{ fontSize: 14, color: "var(--fg2)", margin: "0 0 18px" }}>
              Live and being measured. Undo reverses cleanly inside the first hour; after that a
              revert is recorded alongside the original rather than replacing it.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {published.map((row) => {
                const p = row.payload ?? {};
                return (
                  <ApprovalCard
                    key={row.id}
                    row={{ ...row, before: p.before, after: p.after, target_label: p.targetLabel,
                           serp_kind: p.serpKind as "title" | "description" | undefined }}
                    actorRole={profile?.role}
                    clientName={nameOf.get(row.client_id)}
                  />
                );
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
