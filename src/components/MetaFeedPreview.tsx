// components/MetaFeedPreview.tsx — WO-006 stream H.
//
// Approximates Meta's feed-ad layout (brand header, primary text, image,
// headline/description card, CTA) closely enough to sanity-check copy and
// creative together before approving — not a pixel-exact clone of the real
// Feed/Reels/Stories surfaces, which each vary this layout further. Same
// "approximate layout only" caveat as SearchAdPreview.
export function MetaFeedPreview({
  businessName,
  primaryText,
  headline,
  description,
  imageUrl,
}: {
  businessName: string;
  primaryText: string | null;
  headline: string | null;
  description?: string | null;
  imageUrl?: string | null;
}) {
  const initial = businessName.trim().charAt(0).toUpperCase() || "?";

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "#fff", maxWidth: 320 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px" }}>
        <div style={{
          width: 28, height: 28, borderRadius: "50%", background: "var(--tm-green-deep)", color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0,
        }}>{initial}</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#050505" }}>{businessName}</div>
          <div style={{ fontSize: 11, color: "#65676b" }}>Sponsored</div>
        </div>
      </div>

      <div style={{ padding: "0 12px 10px", fontSize: 13, color: "#050505", lineHeight: 1.4 }}>
        {primaryText || <span style={{ color: "var(--fg3)" }}>(no primary text yet)</span>}
      </div>

      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="Ad creative" style={{ width: "100%", aspectRatio: "4/5", objectFit: "cover", display: "block" }} />
      ) : (
        <div style={{ width: "100%", aspectRatio: "4/5", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, color: "var(--fg3)" }}>
          No creative yet
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "#f0f2f5" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#050505" }}>
            {headline || <span style={{ color: "var(--fg3)", fontWeight: 400 }}>(no headline yet)</span>}
          </div>
          {description && <div style={{ fontSize: 11.5, color: "#65676b", marginTop: 2 }}>{description}</div>}
        </div>
        <span style={{
          fontSize: 12.5, fontWeight: 600, color: "#050505", background: "#e4e6eb",
          borderRadius: 6, padding: "6px 12px", whiteSpace: "nowrap",
        }}>Learn More</span>
      </div>

      <div style={{ fontSize: 10.5, color: "var(--fg3)", fontStyle: "italic", padding: "6px 12px" }}>
        Preview — Meta feed, approximate layout only
      </div>
    </div>
  );
}
