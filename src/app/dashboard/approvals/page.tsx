// app/dashboard/approvals/page.tsx — the decision queue.
//
// WO-003 Stream F (first pass). Spec: "Everything here is finished work. Your
// job is yes or no."
//
// Reads through userClient() so RLS applies — an agency user sees their org's
// clients and nothing else, enforced by Postgres rather than by this query.
import { userClient, getProfile } from "@/lib/supabaseServer";
import { ApprovalCard, type ApprovalRow } from "@/components/ApprovalCard";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  published: "Published. The change is live and now being measured.",
  declined: "Declined. That rule is suppressed for this target for 60 days.",
  failed: "Publish failed. The card stayed in the queue with the error.",
  "already-in-progress": "Someone else is already working that card.",
  "needs-higher-role": "That card needs a higher role. Approval requested.",
  "reason-required": "Decline needs a reason.",
  "approval-requested": "Approval requested.",
  undone: "Undone. It was not live long enough to measure, so no verdict is pending.",
  reverted: "Reverted. Both the change and the reversal stay in the record.",
  "revert-failed": "Revert failed. The change is still live — check the error and try again.",
  "not-published": "That card is not in a published state.",
};

export default async function Approvals({
  searchParams,
}: {
  searchParams: { msg?: string };
}) {
  const profile = await getProfile();
  const db = userClient();

  // Recently published work stays visible so undo/revert is reachable without
  // hunting through a change log. 24h is enough to cover the undo window plus
  // the "I've just realised" gap after it.
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();

  const [{ data: rows }, { data: recent }, { data: clients }] = await Promise.all([
    db.from("approvals")
      .select("*")
      .in("status", ["staged", "publishing", "failed"])
      .order("created_at", { ascending: true }),
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

        {msg && (
          <div style={{ padding: "12px 16px", borderRadius: 8, background: "#fff", border: "1px solid var(--border)", fontSize: 14, marginBottom: 22 }}>
            {msg}
          </div>
        )}

        {queue.length === 0 ? (
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
