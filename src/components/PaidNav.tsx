// components/PaidNav.tsx — second-level nav inside the Paid workspace.
//
// /paid, /paid/personas and /paid/creative all sit under a single "Paid" tab in
// ChannelNav, so nothing in the chrome revealed that the other two existed. The
// only route to the creative page was a link buried in body copy inside a form
// description, and personas had no link at all — Tom went looking for the
// creative page and could not find it.
//
// Deliberately a separate strip rather than new ChannelNav entries: these are
// sub-views of one channel, not channels. Promoting them to top-level tabs would
// imply Personas sits alongside Organic and Social, which it does not.
import Link from "next/link";

export type PaidSection = "campaigns" | "personas" | "creative" | "guardrails";

const SECTIONS: { key: PaidSection; label: string; href: string; note: string }[] = [
  { key: "campaigns", label: "Campaigns", href: "", note: "Spend, ROAS and campaign actions" },
  { key: "personas", label: "Personas", href: "/personas", note: "Audience context used when writing copy and creative" },
  { key: "creative", label: "Creative & copy", href: "/creative", note: "Generated ad creative, copy sets and live ad performance" },
  { key: "guardrails", label: "Guardrails", href: "/guardrails", note: "Hard spend ceilings that block a budget change before it executes" },
];

export function PaidNav({ clientId, active }: { clientId: string; active: PaidSection }) {
  return (
    <nav
      aria-label="Paid sections"
      style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 24px" }}
    >
      {SECTIONS.map((s) => {
        const on = active === s.key;
        return (
          <Link
            key={s.key}
            href={`/dashboard/${clientId}/paid${s.href}`}
            title={s.note}
            aria-current={on ? "page" : undefined}
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              padding: "7px 14px",
              borderRadius: "var(--radius-pill)",
              textDecoration: "none",
              border: "1px solid var(--border)",
              background: on ? "var(--tm-deep-charcoal)" : "var(--surface)",
              color: on ? "var(--tm-performance-green)" : "var(--fg2)",
            }}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
