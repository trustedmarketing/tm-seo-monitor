// components/ApprovalCard.tsx — the atomic unit.
//
// WO-003 Stream D, ported from docs/design/ApprovalCard.dc.html.
// Spec §2: "Everything in this product reduces to one repeated component. If the
// team has to learn more than this, the design failed."
//
// Non-negotiables carried over from the design and the punch list:
//   · The work is already DONE before a human sees it. Approve = publish.
//   · Before/after is shown, not described. For content changes that is a text
//     diff rather than a screenshot — see lib/textDiff.ts for why.
//   · Decline requires a reason, which feeds suppression and the learning layer.
//   · #2 a `failed` state exists and keeps the card in the queue with the error.
//   · #5 a card above your role renders LOCKED and explained, never hidden.
//   · #7 every card carries its own freshness line.
import { diffWords, serpWarning, type DiffOp } from "@/lib/textDiff";
import { canDecide, withinUndoWindow } from "@/lib/audit";

export type ApprovalRow = {
  id: string;
  client_id: string;
  variant: "site" | "ad" | "creative" | "content";
  status: "staged" | "approved" | "declined" | "publishing" | "published" | "failed" | "reverted";
  severity: string;
  title: string;
  why: string | null;
  staged_by: string | null;
  qc_passed: number | null;
  qc_total: number | null;
  requires_role: string;
  sla_due_at: string | null;
  decline_reason: string | null;
  error_detail: string | null;
  created_at: string;
  published_at?: string | null;
  /** Content change payload — before/after text for the diff. */
  before?: string;
  after?: string;
  target_label?: string;
  /** Which SERP limit applies, if any. */
  serp_kind?: "title" | "description";
};

const C = {
  ink: "var(--fg1)", mid: "var(--fg2)", faint: "var(--fg3)",
  edge: "var(--border)", strong: "var(--border-strong)",
  green: "var(--tm-performance-green)", deep: "var(--tm-green-deep)",
  danger: "var(--danger)", warn: "#8C6500", warnBg: "#FFF9EC", warnEdge: "#EAD9A6",
  addBg: "#E5FFB8", removeBg: "#FBE7E4",
};

function age(iso: string): string {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  return h < 1 ? "just now" : h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** Past its SLA. Punch list #9 — this drives escalation, not just styling. */
function isStale(row: ApprovalRow): boolean {
  return !!row.sla_due_at && new Date(row.sla_due_at).getTime() < Date.now() && row.status === "staged";
}

function Diff({ ops }: { ops: DiffOp[] }) {
  return (
    <div style={{
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13.5, lineHeight: 1.7, padding: "12px 14px",
      background: "var(--bg)", border: `1px solid ${C.edge}`, borderRadius: 8,
      whiteSpace: "pre-wrap", wordBreak: "break-word",
    }}>
      {ops.map((op, i) => (
        <span key={i} style={
          op.kind === "add" ? { background: C.addBg, color: C.ink }
          : op.kind === "remove" ? { background: C.removeBg, color: C.danger, textDecoration: "line-through" }
          : { color: C.mid }
        }>{op.text}</span>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint, marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

export function ApprovalCard({
  row,
  actorRole,
  clientName,
  freshness,
}: {
  row: ApprovalRow;
  actorRole: string | undefined;
  clientName?: string;
  /** Punch list #7 — where this data comes from and how far behind it is. */
  freshness?: string;
}) {
  const locked = !canDecide(actorRole, row.requires_role);
  const stale = isStale(row);
  const failed = row.status === "failed";
  const decided = ["published", "declined", "reverted"].includes(row.status);
  const busy = row.status === "publishing";
  // The window, not the button, decides what happens — a stale page must not
  // let someone skip the ledger entry an hour later.
  const undoable = withinUndoWindow(row.published_at);

  const ops = row.before !== undefined && row.after !== undefined
    ? diffWords(row.before, row.after)
    : null;

  const warn = row.serp_kind && row.after ? serpWarning(row.serp_kind, row.after) : null;

  const railColor = failed ? C.danger : stale ? C.warn : "transparent";

  return (
    <article style={{
      background: stale ? "#FDFBF4" : "#FFFFFF",
      border: `1px solid ${failed ? "#EBC9C4" : stale ? C.warnEdge : C.edge}`,
      borderLeft: railColor === "transparent" ? `1px solid ${C.edge}` : `3px solid ${railColor}`,
      borderRadius: 12, padding: "20px 22px", maxWidth: 760,
    }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{
          fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
          padding: "3px 8px", borderRadius: 999,
          background: row.severity === "High" ? C.removeBg : "var(--bg)",
          color: row.severity === "High" ? C.danger : C.mid,
        }}>{row.severity}</span>

        <span style={{ fontSize: 12.5, color: C.mid }}>{row.variant === "site" ? "Site · SEO" : row.variant}</span>

        {clientName && <span style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>{clientName}</span>}

        <span style={{ marginLeft: "auto", fontSize: 12, color: stale ? C.warn : C.faint, fontVariantNumeric: "tabular-nums" }}>
          {age(row.created_at)}{stale ? " · past SLA" : ""}
        </span>
      </div>

      <h3 style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.35, margin: "12px 0 0" }}>{row.title}</h3>

      {row.why && (
        <p style={{ fontSize: 14, lineHeight: 1.55, color: C.mid, margin: "8px 0 0" }}>{row.why}</p>
      )}

      {row.target_label && (
        <div style={{ fontSize: 12.5, color: C.faint, marginTop: 8 }}>
          Target: <span style={{ color: C.mid }}>{row.target_label}</span>
        </div>
      )}

      {/* the evidence */}
      {ops && (
        <Field label="Before → after">
          <Diff ops={ops} />
        </Field>
      )}

      {warn && (
        <div style={{
          marginTop: 10, padding: "9px 12px", borderRadius: 8,
          background: C.warnBg, border: `1px solid ${C.warnEdge}`, color: C.warn, fontSize: 13,
        }}>{warn}</div>
      )}

      {/* failure — punch list #2. Stays in the queue, shows the real error. */}
      {failed && (
        <div style={{
          marginTop: 14, padding: "12px 14px", borderRadius: 8,
          background: C.removeBg, border: "1px solid #EBC9C4",
        }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.danger, marginBottom: 4 }}>Publish failed</div>
          <div style={{ fontSize: 13, color: C.ink, fontFamily: "ui-monospace, monospace", wordBreak: "break-word" }}>
            {row.error_detail ?? "No detail recorded."}
          </div>
        </div>
      )}

      {row.status === "declined" && row.decline_reason && (
        <div style={{ marginTop: 14, fontSize: 13.5, color: C.mid }}>
          Declined — <strong style={{ color: C.ink }}>{row.decline_reason}</strong>
        </div>
      )}

      {/* footer */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 18, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: C.faint }}>
          {row.staged_by ? `Staged by ${row.staged_by}` : "Staged"}
          {row.qc_total ? ` · QC ${row.qc_passed ?? 0}/${row.qc_total}` : ""}
        </span>
        {freshness && <span style={{ fontSize: 12, color: C.faint }}>· {freshness}</span>}
      </div>

      {/* published: undo inside the window, revert after it (punch list #1) */}
      {row.status === "published" && !locked && (
        <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
          <form action="/api/approvals" method="post">
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="action" value={undoable ? "undo" : "revert"} />
            <button type="submit" style={btn("ghost")}>{undoable ? "Undo" : "Revert"}</button>
          </form>
          <span style={{ fontSize: 12.5, color: C.faint }}>
            {undoable
              ? "Undo reverses this cleanly — it has not been live long enough to measure."
              : "This has been live long enough to count. Reverting keeps both entries in the record."}
          </span>
        </div>
      )}

      {/* actions */}
      {!decided && (
        <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
          {locked ? (
            // Punch list #5: visible and explained, never hidden.
            <>
              <span style={{
                fontSize: 13, padding: "10px 14px", borderRadius: 8,
                background: "var(--bg)", border: `1px solid ${C.edge}`, color: C.faint,
              }}>
                {row.requires_role.replace("_", " ")} approval required
              </span>
              <form action="/api/approvals" method="post">
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="action" value="request_approval" />
                <button type="submit" style={btn("ghost")}>Request approval</button>
              </form>
            </>
          ) : (
            <>
              <form action="/api/approvals" method="post">
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="action" value={failed ? "retry" : "approve"} />
                <button type="submit" disabled={busy} style={btn("primary", busy)}>
                  {busy ? "Publishing…" : failed ? "Retry" : "Approve & publish"}
                </button>
              </form>

              <form action="/api/approvals" method="post" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="action" value="decline" />
                {/* Decline requires a reason — it feeds suppression and learning. */}
                <select name="reason" required defaultValue="" style={{
                  fontFamily: "var(--font-body)", fontSize: 13, padding: "9px 10px",
                  borderRadius: 8, border: `1px solid ${C.strong}`, background: "#fff", color: C.ink,
                }}>
                  <option value="" disabled>Decline reason…</option>
                  <option value="wrong direction">Wrong direction</option>
                  <option value="bad timing">Bad timing</option>
                  <option value="client said no">Client said no</option>
                  <option value="other">Other</option>
                </select>
                <button type="submit" style={btn("ghost")}>Decline</button>
              </form>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function btn(kind: "primary" | "ghost", disabled = false): React.CSSProperties {
  return {
    fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 13.5,
    padding: "10px 16px", borderRadius: 8, cursor: disabled ? "default" : "pointer",
    border: kind === "primary" ? "none" : `1px solid ${C.strong}`,
    background: kind === "primary" ? (disabled ? "var(--bg)" : C.green) : "transparent",
    color: kind === "primary" ? (disabled ? C.faint : "#080808") : C.mid,
  };
}
