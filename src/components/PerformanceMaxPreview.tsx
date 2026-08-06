// components/PerformanceMaxPreview.tsx — WO-006 stream H.
//
// PMax runs across Search, Display, YouTube, Discover, Gmail, and Maps from
// one asset group — Google's own editor shows this as a stack of per-surface
// previews. Two representative cards cover the two visual families that
// actually differ: a Search-style text card (reuses SearchAdPreview with
// the long headline as the primary line) and a Discovery/Display-style
// image card. Not exhaustive of every placement — approximate layout only,
// same caveat as SearchAdPreview.
import { SearchAdPreview } from "./SearchAdPreview";

export function PerformanceMaxPreview({
  domain,
  headline,
  longHeadline,
  businessName,
  descriptions,
  imageUrl,
}: {
  domain: string;
  headline: string | null;
  longHeadline: string | null;
  businessName?: string | null;
  descriptions: string[];
  imageUrl?: string | null;
}) {
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--fg3)", marginBottom: 6 }}>
          Search placement
        </div>
        <SearchAdPreview
          brand="google"
          domain={domain}
          headlines={[longHeadline ?? headline ?? ""].filter(Boolean)}
          descriptions={descriptions}
        />
      </div>
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--fg3)", marginBottom: 6 }}>
          Discover / Display placement
        </div>
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "#fff", width: 220 }}>
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="Ad creative" style={{ width: "100%", aspectRatio: "4/5", objectFit: "cover", display: "block" }} />
          ) : (
            <div style={{ width: "100%", aspectRatio: "4/5", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, color: "var(--fg3)" }}>
              No creative yet
            </div>
          )}
          <div style={{ padding: "8px 10px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#202124", lineHeight: 1.3 }}>
              {headline || <span style={{ color: "var(--fg3)", fontWeight: 400 }}>(no headline yet)</span>}
            </div>
            {businessName && <div style={{ fontSize: 11, color: "var(--fg3)", marginTop: 3 }}>{businessName}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
