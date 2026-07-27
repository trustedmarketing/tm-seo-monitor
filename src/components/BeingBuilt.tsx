// components/BeingBuilt.tsx — the honest holding state.
//
// WO-003 Stream M. The design review praised "honest states designed, not bolted
// on"; the feasibility review demanded that unavailable integrations render as
// "connection pending" rather than populated. This is that, applied to our own
// unfinished surfaces.
//
// The rule it encodes: a tab that has no data says why, in a sentence. It never
// renders a zero, because a zero is a claim — it says "we measured, and the
// answer is none", which is a different and usually false statement.
import Link from "next/link";

export function BeingBuilt({
  title,
  reason,
  waitingOn,
  backHref,
}: {
  title: string;
  reason: string;
  /** What has to happen first. Omit when it is simply build time. */
  waitingOn?: string;
  backHref?: string;
}) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)", padding: "40px 36px", maxWidth: 620,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: "0.14em",
        textTransform: "uppercase", color: "var(--fg3)",
      }}>
        Not built yet
      </div>

      <h2 style={{
        fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 32,
        letterSpacing: "-0.01em", margin: "8px 0 14px",
      }}>
        {title}
      </h2>

      <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--fg2)", margin: 0 }}>
        {reason}
      </p>

      {waitingOn && (
        <div style={{
          marginTop: 18, padding: "12px 14px", borderRadius: 8,
          background: "var(--bg)", border: "1px solid var(--border)",
          fontSize: 13.5, color: "var(--fg2)",
        }}>
          <strong style={{ color: "var(--fg1)" }}>Waiting on:</strong> {waitingOn}
        </div>
      )}

      {backHref && (
        <div style={{ marginTop: 22 }}>
          <Link href={backHref} style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg2)" }}>
            ← Back to Overview
          </Link>
        </div>
      )}
    </div>
  );
}
