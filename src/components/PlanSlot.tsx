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
import { aspectFor, requiresMedia } from "@/lib/platformPlaybook";

type Item = {
  id: number; slot: number; scheduled_for: string | null;
  platform: string | null; format: string | null; theme: string | null;
  brief: string; why: string | null; source_post_id: number | null;
  status: string; caption: string | null; hashtags: string[] | null; headline: string | null;
  image_url: string | null; bloom_image_id: string | null; image_status: string | null;
  image_error: string | null;
  declined_at: string | null; decline_note: string | null; decline_by: string | null;
  send_error: string | null;
  postflow_id: string | null;
};

const SOURCE = {
  "Repeat what worked": { label: "Proven", fg: "#2F8F4E", bg: "#E5FFB8", edge: "#C7E89A" },
  "Answer a customer question": { label: "Customer ask", fg: "#2F6F8F", bg: "#E7F4FB", edge: "#BFDDEC" },
  "Show the product working": { label: "Catalogue", fg: "#7A5AA8", bg: "#F1EBFA", edge: "#DCCCF0" },
  "Evergreen angle": { label: "Evergreen", fg: "var(--fg3)", bg: "var(--bg)", edge: "var(--border)" },
  // Deliberately the loudest badge: this is the slot someone asked for.
  Campaign: { label: "Campaign", fg: "#8A5A00", bg: "#FFF1D6", edge: "#EAD9A6" },
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

type Slide = {
  id: number; position: number; headline: string | null; body: string | null;
  image_url: string | null; image_status: string | null; image_error: string | null;
};

export function PlanSlot(
  { item, clientId, slides = [] }: { item: Item; clientId: string; slides?: Slide[] }
) {
  const src = SOURCE[(item.theme ?? "Evergreen angle") as keyof typeof SOURCE] ?? SOURCE["Evergreen angle"];
  const sent = item.status === "sent";
  const declined = !!item.declined_at;
  const skipped = item.status === "skipped";
  // Keyed on status, not the id: a generation can be in flight without us having
  // an id for it, which is exactly the case that produced a silently empty slot.
  const generating = item.image_status === "generating";
  const aspect = aspectFor(item.platform, item.format);
  const isCarousel = (item.format ?? "").toLowerCase() === "carousel";
  // For a carousel the SLIDES are the media. Judging it by the post-level image
  // would block a complete carousel and pass an empty one.
  const slidesReady = slides.length > 0 && slides.every((sl) => sl.image_url);
  const blockedForMedia = isCarousel
    ? !slidesReady
    : !item.image_url && requiresMedia(item.platform);

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
            {declined ? "Declined" : sent ? "In PostFlow" : skipped ? "Skipped" : item.caption ? "Draft" : "Not written"}
          </span>

          <form action="/api/content-plan/item" method="post" style={{ marginLeft: "auto" }}>
            <Hidden clientId={clientId} itemId={item.id} action={skipped ? "unskip" : "skip"} />
            {!sent && <button type="submit" style={BTN(false)}>{skipped ? "Restore" : "Skip"}</button>}
          </form>
        </div>

        {/* Shown in full, and kept until the next send succeeds. A failure that
            only exists in a redirect banner is gone the moment anyone clicks. */}
        {item.send_error && (
          <div style={{
            background: "#FBE7E4", border: "1px solid #EBC9C4", borderRadius: 10,
            padding: "12px 14px", margin: "12px 0 4px", maxWidth: 860,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)" }}>Last send had a problem</div>
            <div style={{
              fontSize: 12.5, color: "var(--fg2)", marginTop: 5, lineHeight: 1.5,
              fontFamily: "var(--font-mono, ui-monospace, monospace)", wordBreak: "break-word",
            }}>{item.send_error}</div>
          </div>
        )}

        {declined && (
          <div style={{
            background: "#FBE7E4", border: "1px solid #EBC9C4", borderRadius: 10,
            padding: "12px 14px", margin: "12px 0 4px", maxWidth: 860,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)" }}>
              Declined by the client{item.decline_by ? ` — ${item.decline_by}` : ""}
            </div>
            {/* The reason is the useful half. "Declined" alone sends someone to
                PostFlow to find out why; the reason tells them what to change. */}
            <div style={{ fontSize: 13.5, color: "var(--fg2)", marginTop: 5, lineHeight: 1.55 }}>
              {item.decline_note
                ? `“${item.decline_note}”`
                : "No reason was given. Worth asking before redrafting blind."}
            </div>
          </div>
        )}

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
          <div style={{ width: 250, display: isCarousel ? "none" : "block" }}>
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
              <div>
                <div style={{
                  width: "100%", aspectRatio: "4/5", borderRadius: 10,
                  border: "1px dashed var(--border-strong)", display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 4,
                  color: "var(--fg3)", fontSize: 13.5, textAlign: "center", padding: 12,
                }}>
                  <span>Generating…</span>
                  <span style={{ fontSize: 12 }}>About 90 seconds</span>
                </div>
                {/* No Check button: the page collects it and refreshes itself.
                    A button whose only job is to work around our own plumbing is
                    a chore we invented. */}
                <div style={{ fontSize: 11.5, color: "var(--fg3)", textAlign: "center", marginTop: 8 }}>
                  This page updates itself
                </div>

                {/* An escape hatch, always. A generation that never lands would
                    otherwise leave the slot with no way to proceed — which is
                    exactly what happened, and hiding the alternative while
                    waiting made a slow step into a dead end. */}
                <form action="/api/content-plan/item" method="post" style={{ marginTop: 10 }}>
                  <Hidden clientId={clientId} itemId={item.id} action="image" />
                  <input name="image_url" placeholder="or paste an image URL"
                         style={{ ...INPUT, fontSize: 12, border: "none",
                                  borderBottom: "1px solid var(--border)", borderRadius: 0,
                                  textAlign: "center", padding: "6px 2px" }} />
                </form>
              </div>
            ) : item.image_status === "failed" && !item.image_url ? (
              <div style={{
                width: "100%", aspectRatio: "4/5", borderRadius: 10,
                border: "1px solid #EBC9C4", background: "#FBE7E4", display: "flex",
                flexDirection: "column", alignItems: "center", justifyContent: "center",
                gap: 4, color: "var(--danger)", fontSize: 13, textAlign: "center", padding: 12,
              }}>
                <span>Generation failed</span>
                {item.image_error && (
                  <span style={{ fontSize: 11.5, opacity: 0.85 }}>{item.image_error}</span>
                )}
              </div>
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

          {/* ── slides ───────────────────────────────────────────────────── */}
          {/* A carousel's real deliverable. Each slide regenerates on its own,
              because "slide 4 is wrong" must not cost five images that were fine. */}
          {isCarousel && slides.length > 0 && (
            <div style={{ flexBasis: "100%", order: 3, marginTop: 16 }}>
              <div style={{ ...EYEBROW, marginBottom: 10 }}>
                Slides · {slides.filter((s) => s.image_url).length} of {slides.length} with artwork
              </div>

              <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 6 }}>
                {slides.map((sl) => (
                  <div key={sl.id} style={{ width: 170, flexShrink: 0 }}>
                    {sl.image_status === "generating" ? (
                      <div style={{
                        width: "100%", aspectRatio: "4/5", borderRadius: 10,
                        border: "1px dashed var(--border-strong)", display: "flex",
                        alignItems: "center", justifyContent: "center",
                        fontSize: 12, color: "var(--fg3)",
                      }}>Generating…</div>
                    ) : sl.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sl.image_url} alt="" style={{
                        width: "100%", borderRadius: 10, display: "block",
                        border: "1px solid var(--border)",
                      }} />
                    ) : (
                      <div style={{
                        width: "100%", aspectRatio: "4/5", borderRadius: 10,
                        border: "1px dashed var(--border-strong)", display: "flex",
                        alignItems: "center", justifyContent: "center",
                        fontSize: 12, color: sl.image_error ? "var(--danger)" : "var(--fg3)",
                        textAlign: "center", padding: 8,
                      }}>{sl.image_error ? "Failed" : "No image"}</div>
                    )}

                    <div style={{ fontSize: 11.5, fontWeight: 700, marginTop: 6, color: "var(--fg1)" }}>
                      {sl.position === 0 ? "Cover · " : `${sl.position}. `}{sl.headline}
                    </div>
                    {sl.body && (
                      <div style={{ fontSize: 11.5, color: "var(--fg3)", marginTop: 2, lineHeight: 1.4 }}>
                        {sl.body}
                      </div>
                    )}

                    {!sent && sl.image_status !== "generating" && (
                      <form action="/api/content-plan/item" method="post" style={{ marginTop: 6 }}>
                        <Hidden clientId={clientId} itemId={item.id} action="generate-slide" />
                        <input type="hidden" name="slide_id" value={sl.id} />
                        <button type="submit" style={{ ...BTN(!sl.image_url), width: "100%", padding: "6px 10px", fontSize: 12 }}>
                          {sl.image_url ? "Redo" : "Generate"}
                        </button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── copy ─────────────────────────────────────────────────────── */}
          <div style={{ flex: 1, minWidth: 340 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
              <span style={EYEBROW}>Post copy</span>
              <span style={{ fontSize: 11.5, color: "var(--fg3)" }}>
                {item.caption.length} characters
              </span>
            </div>

            {sent && !declined ? (
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

            {(!sent || declined) && (
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
            <button type="submit" disabled={blockedForMedia} style={{
              ...BTN(true),
              opacity: blockedForMedia ? 0.45 : 1,
              cursor: blockedForMedia ? "not-allowed" : "pointer",
            }}>Send to PostFlow</button>
          </form>
          <div style={{ fontSize: 12.5, color: "var(--fg3)", lineHeight: 1.5 }}>
            Goes to the {item.platform} account only, as an unscheduled draft.
            Nothing posts until someone schedules it.
            {blockedForMedia && isCarousel && (
              <><br /><span style={{ color: "var(--danger)" }}>
                Every slide needs artwork before this can ship. A carousel with a gap
                publishes in the wrong order.
              </span></>
            )}
            {blockedForMedia && !isCarousel && (
              // A hard stop rather than a warning: a text-only post sent to
              // Instagram lands unpublishable — done in our queue, broken in
              // theirs — which is worse than not sending it.
              <><br /><span style={{ color: "var(--danger)" }}>
                {item.platform} will not accept a post without an image.
              </span></>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
