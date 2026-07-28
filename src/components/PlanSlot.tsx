// components/PlanSlot.tsx — one post, being finished.
//
// WO-004. The slot is the unit of work: a brief on the left becomes an image and
// a caption on the right, and only leaves for PostFlow when both are right.
//
// ── Why image and copy sit side by side ─────────────────────────────────────
// They are judged against each other. A caption that reads well next to the
// wrong photograph is still a post nobody should publish, and reviewing them on
// separate screens hides exactly that.
//
// Every control posts a form to /api/content-plan/item. No client-side state, so
// a half-finished edit cannot be lost to a refresh.
import { fmtDate } from "@/lib/time";
import { aspectFor } from "@/lib/platformPlaybook";

type Item = {
  id: number; slot: number; scheduled_for: string | null;
  platform: string | null; format: string | null; theme: string | null;
  brief: string; why: string | null; source_post_id: number | null;
  status: string; caption: string | null; hashtags: string[] | null; headline: string | null;
  image_url: string | null; bloom_image_id: string | null; image_status: string | null;
  postflow_id: string | null;
};

const SOURCE = {
  "Repeat what worked": { label: "Proven", fg: "#2F8F4E", bg: "#E5FFB8", edge: "#C7E89A" },
  "Answer a customer question": { label: "Customer ask", fg: "#2F6F8F", bg: "#E7F4FB", edge: "#BFDDEC" },
  "Show the product working": { label: "Catalogue", fg: "#7A5AA8", bg: "#F1EBFA", edge: "#DCCCF0" },
  "Evergreen angle": { label: "Evergreen", fg: "var(--fg3)", bg: "var(--bg)", edge: "var(--border)" },
} as const;

const CARD: React.CSSProperties = {
  background: "#fff", border: "1px solid var(--border)", borderRadius: 14,
  overflow: "hidden", marginBottom: 18,
};
const EYEBROW: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
  color: "var(--fg3)",
};
const PILL = (fg: string, bg: string, edge: string): React.CSSProperties => ({
  fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase",
  padding: "4px 10px", borderRadius: 999, background: bg, color: fg,
  border: `1px solid ${edge}`, whiteSpace: "nowrap",
});
const INPUT: React.CSSProperties = {
  fontFamily: "var(--font-body)", fontSize: 13, padding: "10px 12px",
  border: "1px solid var(--border)", borderRadius: 10, width: "100%",
  boxSizing: "border-box", background: "#fff", color: "var(--fg1)",
};
const BTN = (primary: boolean): React.CSSProperties => ({
  fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 13.5,
  padding: "10px 20px", borderRadius: 999, cursor: "pointer",
  border: primary ? "none" : "1px solid var(--fg1)",
  background: primary ? "var(--tm-performance-green)" : "#fff",
  color: "#080808", whiteSpace: "nowrap",
});

function Hidden({ clientId, itemId, action }: { clientId: string; itemId: number; action: string }) {
  return (
    <>
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="item_id" value={itemId} />
      <input type="hidden" name="action" value={action} />
    </>
  );
}

export function PlanSlot({ item, clientId }: { item: Item; clientId: string }) {
  const src = SOURCE[(item.theme ?? "Evergreen angle") as keyof typeof SOURCE] ?? SOURCE["Evergreen angle"];
  const sent = item.status === "sent";
  const skipped = item.status === "skipped";
  // Keyed on status, not the id: a generation can be in flight without us having
  // an id for it, which is exactly the case that produced a silently empty slot.
  const generating = item.image_status === "generating";
  const aspect = aspectFor(item.platform, item.format);

  // A headline, not a sentence of instructions. The brief carries "Platform: x.
  // Format: y." for the model's benefit; a human already has that in the eyebrow.
  const headline = item.brief
    .replace(/\s*(Platform|Format):\s*\w+\.?/gi, "")
    .replace(/\s+As an? \w+ for [\w\s]+\.?$/i, "")
    .trim();

  return (
    <div style={{ ...CARD, opacity: skipped ? 0.55 : 1 }}>
      {/* ── header ─────────────────────────────────────────────────────── */}
      <div style={{ padding: "18px 22px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={EYEBROW}>
            {fmtDate(item.scheduled_for)} · {item.platform} · {item.format}
          </span>
          <span style={{ color: "var(--border-strong)" }}>·</span>
          <span style={PILL(src.fg, src.bg, src.edge)}>{src.label}</span>
          <span style={PILL("var(--fg3)", "var(--bg)", "var(--border)")}>
            {sent ? "In PostFlow" : skipped ? "Skipped" : item.caption ? "Draft" : "Not written"}
          </span>

          <form action="/api/content-plan/item" method="post" style={{ marginLeft: "auto" }}>
            <Hidden clientId={clientId} itemId={item.id} action={skipped ? "unskip" : "skip"} />
            {!sent && <button type="submit" style={BTN(false)}>{skipped ? "Restore" : "Skip"}</button>}
          </form>
        </div>

        <h3 style={{
          fontSize: 21, fontWeight: 600, letterSpacing: "-0.01em",
          margin: "12px 0 6px", color: "var(--fg1)", lineHeight: 1.3,
        }}>{headline}</h3>

        {item.why && (
          <p style={{ fontSize: 13.5, color: "var(--fg2)", margin: 0, lineHeight: 1.55, maxWidth: 720 }}>
            {item.why}
          </p>
        )}
      </div>

      {skipped ? null : !item.caption ? (
        // Nothing written yet. One action, so it is obvious what to do next.
        <div style={{ padding: "20px 22px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <form action="/api/content-plan/item" method="post">
            <Hidden clientId={clientId} itemId={item.id} action="draft" />
            <button type="submit" style={BTN(true)}>
              {item.status === "failed" ? "Try again" : "Write this post"}
            </button>
          </form>
          <span style={{ fontSize: 12.5, color: "var(--fg3)" }}>
            Writes the copy. You add artwork after.
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 26, padding: "20px 22px", flexWrap: "wrap" }}>

          {/* ── image ────────────────────────────────────────────────────── */}
          <div style={{ width: 250 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
              <span style={EYEBROW}>Image</span>
              {/* Stated up front, because someone sourcing their own needs it
                  before they crop rather than after. */}
              <span style={{ fontSize: 11.5, color: "var(--fg3)" }}>
                {aspect}{item.format === "short" || item.format === "video" ? " · opening frame" : " · required"}
              </span>
            </div>

            {/* The words that will be set across the artwork. Shown because it
                is the single thing most likely to be wrong, and it is far
                cheaper to fix here than after a generation. */}
            {item.headline && !sent && (
              <form action="/api/content-plan/item" method="post" style={{ marginBottom: 10 }}>
                <Hidden clientId={clientId} itemId={item.id} action="headline" />
                <input name="headline" defaultValue={item.headline}
                       style={{ ...INPUT, fontWeight: 700, letterSpacing: "0.02em", textTransform: "uppercase" }} />
                <div style={{ fontSize: 11, color: "var(--fg3)", marginTop: 4 }}>
                  Set large across the image. Two to four words.
                </div>
              </form>
            )}

            {generating ? (
              <form action="/api/content-plan/item" method="post">
                <Hidden clientId={clientId} itemId={item.id} action="check-image" />
                <div style={{
                  width: "100%", aspectRatio: "4/5", borderRadius: 10,
                  border: "1px dashed var(--border-strong)", display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 4,
                  color: "var(--fg3)", fontSize: 13.5, textAlign: "center", padding: 12,
                }}>
                  <span>Generating…</span>
                  <span style={{ fontSize: 12 }}>About a minute</span>
                </div>
                <button type="submit" style={{ ...BTN(true), width: "100%", marginTop: 10 }}>Check</button>
              </form>
            ) : item.image_url ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.image_url} alt="" style={{
                  width: "100%", borderRadius: 10, display: "block", border: "1px solid var(--border)",
                }} />
                {!sent && (
                  <form action="/api/content-plan/item" method="post" style={{ marginTop: 10 }}>
                    <Hidden clientId={clientId} itemId={item.id} action="generate-image" />
                    <input name="steer" placeholder="What to change" style={INPUT} />
                    <button type="submit" style={{ ...BTN(false), width: "100%", marginTop: 8 }}>Regenerate</button>
                  </form>
                )}
              </>
            ) : (
              <>
                <div style={{
                  width: "100%", aspectRatio: "4/5", borderRadius: 10,
                  border: "1px dashed var(--border-strong)", display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 4,
                  color: "var(--fg3)", textAlign: "center", padding: 12,
                }}>
                  <span style={{ fontSize: 14, color: "var(--fg2)" }}>No image yet</span>
                  <span style={{ fontSize: 12.5 }}>Generate it, or paste a URL</span>
                </div>

                {!sent && (
                  <form action="/api/content-plan/item" method="post" style={{ marginTop: 10 }}>
                    <Hidden clientId={clientId} itemId={item.id} action="generate-image" />
                    <input name="steer" placeholder="Optional direction for Bloom" style={INPUT} />
                    <button type="submit" style={{ ...BTN(false), width: "100%", marginTop: 8 }}>
                      Generate with Bloom
                    </button>
                  </form>
                )}
              </>
            )}

            {!sent && !generating && (
              <form action="/api/content-plan/item" method="post" style={{ marginTop: 10 }}>
                <Hidden clientId={clientId} itemId={item.id} action="image" />
                <input name="image_url" defaultValue={item.image_url ?? ""}
                       placeholder="or paste an image URL"
                       style={{ ...INPUT, fontSize: 12, border: "none", borderBottom: "1px solid var(--border)",
                                borderRadius: 0, textAlign: "center", padding: "6px 2px" }} />
              </form>
            )}
          </div>

          {/* ── copy ─────────────────────────────────────────────────────── */}
          <div style={{ flex: 1, minWidth: 340 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
              <span style={EYEBROW}>Post copy</span>
              <span style={{ fontSize: 11.5, color: "var(--fg3)" }}>
                {item.caption.length} characters
              </span>
            </div>

            {sent ? (
              <div style={{
                padding: "14px 16px", background: "var(--bg)", borderRadius: 10,
                fontSize: 14, color: "var(--fg2)", lineHeight: 1.6, whiteSpace: "pre-wrap",
              }}>{item.caption}</div>
            ) : (
              <form action="/api/content-plan/item" method="post">
                <Hidden clientId={clientId} itemId={item.id} action="caption" />
                <textarea name="caption" defaultValue={item.caption} rows={12}
                          style={{ ...INPUT, fontSize: 14, lineHeight: 1.6, resize: "vertical" }} />
                <button type="submit" style={{ ...BTN(false), marginTop: 10 }}>Save copy</button>
              </form>
            )}

            {item.hashtags && item.hashtags.length > 0 && (
              <div style={{
                display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
                marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)",
              }}>
                <span style={EYEBROW}>Hashtags</span>
                {item.hashtags.map((h) => (
                  <span key={h} style={{
                    fontSize: 12.5, padding: "4px 11px", borderRadius: 999,
                    border: "1px solid var(--border)", color: "var(--fg2)",
                  }}>{h}</span>
                ))}
              </div>
            )}

            {!sent && (
              <form action="/api/content-plan/item" method="post"
                    style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                <Hidden clientId={clientId} itemId={item.id} action="regenerate" />
                <input name="steer" style={{ ...INPUT, flex: 1, minWidth: 260 }}
                       placeholder="Ask for a rewrite — shorter, less salesy, lead with the anode point" />
                <button type="submit" style={BTN(false)}>Rewrite</button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── send ───────────────────────────────────────────────────────── */}
      {!skipped && item.caption && !sent && (
        <div style={{
          display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap",
          padding: "16px 22px", background: "var(--bg)", borderTop: "1px solid var(--border)",
        }}>
          <form action="/api/content-plan/item" method="post">
            <Hidden clientId={clientId} itemId={item.id} action="send" />
            <button type="submit" style={BTN(true)}>Send to PostFlow</button>
          </form>
          <div style={{ fontSize: 12.5, color: "var(--fg3)", lineHeight: 1.5 }}>
            Lands as an unscheduled draft. Nothing posts until someone schedules it.
            {!item.image_url && (
              // Not a blocker — a post can be sent and have its image added in
              // PostFlow — but it is worth knowing before you send twelve of them.
              <><br />No image yet, so it cannot be scheduled as it stands.</>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
