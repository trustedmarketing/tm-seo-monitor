// components/SearchAdPreview.tsx — WO-006 stream H.
//
// Google and Microsoft's RSA-style search ads share the same layout
// convention (Ad badge, domain breadcrumb, pipe-joined headlines, one
// description line below) closely enough that one component covers both —
// `brand` only changes the badge label and accent color. Not a pixel-exact
// clone of either platform's real SERP — there's no live preview API to
// match against — this renders the documented layout convention so a
// reviewer can sanity-check headline/description combinations before
// approving, not audit exact platform rendering.
const BRAND = {
  google: { label: "Ad", accent: "#1a73e8", name: "Google Search" },
  microsoft: { label: "Ad", accent: "#00832d", name: "Bing Search" },
} as const;

export function SearchAdPreview({
  brand,
  domain,
  headlines,
  descriptions,
}: {
  brand: "google" | "microsoft";
  domain: string;
  /** Full headline list — only the first 3 render, matching what these platforms actually show at once. */
  headlines: string[];
  /** Full description list — only the first 2 render. */
  descriptions: string[];
}) {
  const b = BRAND[brand];
  const shown = headlines.slice(0, 3);
  const desc = descriptions.slice(0, 2);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px", background: "#fff", maxWidth: 480 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: b.accent, border: `1px solid ${b.accent}`,
          borderRadius: 3, padding: "0 4px", lineHeight: "16px",
        }}>{b.label}</span>
        <span style={{ fontSize: 12.5, color: "#202124" }}>{domain}</span>
      </div>
      <div style={{ fontSize: 18, color: b.accent, lineHeight: 1.3, fontFamily: "arial, sans-serif" }}>
        {shown.length > 0 ? shown.join(" | ") : <span style={{ color: "var(--fg3)" }}>(no headlines yet)</span>}
      </div>
      <div style={{ fontSize: 13.5, color: "#4d5156", lineHeight: 1.4, marginTop: 3 }}>
        {desc.length > 0 ? desc.join(" ") : <span style={{ color: "var(--fg3)" }}>(no descriptions yet)</span>}
      </div>
      <div style={{ fontSize: 10.5, color: "var(--fg3)", marginTop: 8, fontStyle: "italic" }}>
        Preview — {b.name}, approximate layout only
      </div>
    </div>
  );
}
