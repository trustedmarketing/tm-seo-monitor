// components/PageHeader.tsx — the header every screen shares.
//
// Ported from `Growth OS.dc.html`: an all-caps eyebrow, a display-serif title,
// then one sentence of subtitle. `header()` in the export holds this copy for
// every screen, which is the giveaway that it is one component rather than a
// pattern each page reimplements.
//
// It sits in the stone content area on a slightly lighter band, with a divider
// under it — not in a card. The band is what separates "where you are" from
// "what you are looking at".
import "@/styles/tm-tokens.css";

export function PageHeader({
  eyebrow, title, subtitle, actions,
}: {
  /** e.g. "Agency · Morning page". Rendered uppercase; write it in sentence case. */
  eyebrow: string;
  title: string;
  /** One sentence. The export uses it to say what the screen is FOR, not what it contains. */
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header style={{
      padding: "var(--space-8) var(--space-8) var(--space-6)",
      borderBottom: "1px solid var(--divider)",
      display: "flex", alignItems: "flex-end", gap: "var(--space-6)", flexWrap: "wrap",
    }}>
      <div style={{ flex: 1, minWidth: 280 }}>
        <div className="eyebrow" style={{ color: "var(--fg3)" }}>{eyebrow}</div>

        {/* display-sm — 40px Instrument Serif. The one place the serif carries a
            whole screen, which is why it is not an <h1> in Inter. */}
        <h1 className="display-sm" style={{ margin: "var(--space-2) 0 0" }}>{title}</h1>

        {subtitle && (
          <p className="body-lg" style={{ color: "var(--fg2)", margin: "var(--space-3) 0 0", maxWidth: "62ch" }}>
            {subtitle}
          </p>
        )}
      </div>

      {actions && <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>{actions}</div>}
    </header>
  );
}

/**
 * The attention rail — the morning exception feed.
 *
 * A single white card divided into columns, each an eyebrow label over a large
 * serif numeral. The numeral is coloured by severity and the label underneath
 * says what it means, so the number is never on its own.
 */
export function AttentionRail({
  items,
}: {
  items: { label: string; value: number | string; meaning: string; tone?: "danger" | "warning" | "normal"; href?: string }[];
}) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)", display: "flex", overflowX: "auto",
      boxShadow: "var(--shadow-xs)",
    }}>
      {items.map((it, i) => {
        const colour =
          it.tone === "danger" ? "var(--danger)" :
          it.tone === "warning" ? "var(--warning)" : "var(--fg1)";

        const body = (
          <>
            <div className="eyebrow">{it.label}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", marginTop: "var(--space-2)" }}>
              <span className="display-sm" style={{ color: colour, lineHeight: 1 }}>{it.value}</span>
              <span className="body-sm" style={{ color: "var(--fg2)" }}>{it.meaning}</span>
            </div>
          </>
        );

        return (
          <div key={it.label} style={{
            flex: "1 1 0", minWidth: 240,
            padding: "var(--space-5) var(--space-6)",
            borderLeft: i === 0 ? "none" : "1px solid var(--divider)",
          }}>
            {it.href ? (
              <a href={it.href} style={{ textDecoration: "none", display: "block" }}>{body}</a>
            ) : body}
          </div>
        );
      })}
    </div>
  );
}
