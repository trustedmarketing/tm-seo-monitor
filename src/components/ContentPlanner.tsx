// components/ContentPlanner.tsx — the Organic tab's content surfaces.
//
// WO-005, ported from the design's Organic screen: a recommendation card that
// shows its evidence, and a pipeline rail showing what is already in flight.
//
// Form-POST only, no client state. An account manager who accepts four ideas and
// then refreshes must not lose three of them, and the surest way to guarantee
// that is to have no unsaved state to lose.
import type { ContentIdea } from "@/lib/contentIdeas";
import type { MovementRow } from "@/lib/keywordMovement";
import { fmtDate } from "@/lib/time";
import "@/styles/tm-tokens.css";

// ── status vocabulary ───────────────────────────────────────────────────────
// The design shows one chip per pipeline item. Colour carries urgency, not
// decoration: amber is the only one that means someone is waiting on somebody.
const STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  idea:            { label: "Idea",           fg: "var(--fg2)",          bg: "var(--tm-stone-200)" },
  queued:          { label: "Queued",         fg: "var(--fg2)",          bg: "var(--tm-stone-200)" },
  drafting:        { label: "Drafting",       fg: "var(--fg2)",          bg: "var(--tm-stone-200)" },
  in_qc:           { label: "In QC",          fg: "var(--fg1)",          bg: "var(--tm-green-soft)" },
  awaiting_client: { label: "Awaiting client", fg: "#8A6D1F",            bg: "#FFF9EC" },
  published:       { label: "Published",      fg: "var(--tm-green-deep)", bg: "transparent" },
  declined:        { label: "Declined",       fg: "var(--danger)",       bg: "transparent" },
};

export type PipelineItem = {
  id: string;
  title: string;
  status: string;
  status_note: string | null;
  url: string | null;
  published_at: string | null;
  /** Clicks the published URL has won since going live. Null until measurable. */
  clicksSincePublish?: number | null;
};

function StatusChip({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.idea;
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, color: s.fg, background: s.bg,
      padding: s.bg === "transparent" ? 0 : "2px 7px",
      borderRadius: "var(--radius-pill)",
    }}>{s.label}</span>
  );
}

/** Days since publication — the design's "Day 9". */
function daysLive(publishedAt: string | null): number | null {
  if (!publishedAt) return null;
  const d = Math.floor((Date.now() - new Date(publishedAt).getTime()) / 86400000);
  return d >= 0 ? d : null;
}

export function ContentPipelineRail({ items }: { items: PipelineItem[] }) {
  return (
    <section style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)", padding: "var(--space-5)",
    }}>
      <div className="eyebrow" style={{ color: "var(--fg3)", marginBottom: "var(--space-4)" }}>
        Content pipeline
      </div>

      {items.length === 0 ? (
        // Honest empty state: says what would fill it, so it does not read as
        // broken. Approving a recommendation below is exactly what puts a row here.
        <div className="body-sm" style={{ color: "var(--fg3)" }}>
          Nothing in flight. Approving a recommendation below adds it here.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {items.map((it, i) => {
            const days = daysLive(it.published_at);
            return (
              <div key={it.id} style={{
                padding: i === 0 ? "0 0 var(--space-4)" : "var(--space-4) 0",
                borderTop: i === 0 ? "none" : "1px solid var(--divider)",
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg1)", lineHeight: 1.35 }}>
                  {it.url
                    ? <a href={it.url} target="_blank" rel="noopener noreferrer"
                         style={{ color: "inherit", textDecoration: "none" }}>{it.title}</a>
                    : it.title}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: 5, flexWrap: "wrap" }}>
                  <StatusChip status={it.status} />
                  <span className="caption" style={{ color: "var(--fg3)" }}>
                    {[
                      it.status_note,
                      days != null ? `Day ${days}` : null,
                      // Only shown once there is something to show. "0 clicks"
                      // on day one is a true number that reads as a failure.
                      it.clicksSincePublish != null && it.clicksSincePublish > 0
                        ? `${it.clicksSincePublish} clicks`
                        : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── the recommendation card ─────────────────────────────────────────────────

const KIND_LABEL: Record<ContentIdea["kind"], string> = {
  striking_distance: "Rank gap · page one within reach",
  content_gap:       "Content gap · demand with no page",
  question:          "Question · nothing of yours answers it",
  rising:            "Rising demand · moving now",
  cannibalisation:   "Cannibalisation · your pages compete",
};

/** High only where the evidence is strong enough to justify the word. */
function priority(idea: ContentIdea): { label: string; fg: string; bg: string } {
  if (idea.confidence === "high") return { label: "High", fg: "#B4342A", bg: "#FBE7E4" };
  if (idea.confidence === "medium") return { label: "Medium", fg: "#8A6D1F", bg: "#FFF9EC" };
  return { label: "Low", fg: "var(--fg2)", bg: "var(--tm-stone-200)" };
}

export function ContentIdeaCard({
  idea, clientId,
}: { idea: ContentIdea; clientId: string }) {
  const p = priority(idea);

  return (
    <article style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-xs)",
      marginBottom: "var(--space-4)", overflow: "hidden",
    }}>
      {/* header band */}
      <div style={{
        display: "flex", alignItems: "center", gap: "var(--space-3)",
        padding: "var(--space-4) var(--space-5)", flexWrap: "wrap",
      }}>
        <span style={{
          fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
          color: p.fg, background: p.bg, padding: "3px 9px", borderRadius: "var(--radius-pill)",
        }}>{p.label}</span>

        <span className="eyebrow" style={{ color: "var(--fg2)" }}>{KIND_LABEL[idea.kind]}</span>

        <span className="caption" style={{ color: "var(--fg3)" }}>· Staged by SEO agent</span>

        <span className="caption" style={{ marginLeft: "auto", color: "var(--fg3)" }}>
          {idea.action === "new_article" ? "New article" : "Change to an existing page"}
        </span>
      </div>

      <div style={{ padding: "0 var(--space-5) var(--space-5)" }}>
        <h3 style={{
          fontSize: 19, fontWeight: 600, lineHeight: 1.3, margin: "0 0 var(--space-4)", color: "var(--fg1)",
        }}>
          {idea.action === "new_article" ? "Write" : "Rework"}: {idea.title}
        </h3>

        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-6)",
          paddingTop: "var(--space-4)", borderTop: "1px solid var(--divider)",
        }}>
          <div>
            <div className="eyebrow" style={{ color: "var(--tm-green-deep)" }}>Why</div>
            <p className="body-sm" style={{ margin: "var(--space-2) 0 0", color: "var(--fg1)", lineHeight: 1.5 }}>
              {idea.rationale}
            </p>
          </div>

          <div>
            <div className="eyebrow" style={{ color: "var(--fg3)" }}>Expected impact</div>
            {idea.expectedClicks != null ? (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", marginTop: 2 }}>
                  <span style={{
                    fontFamily: "var(--font-display)", fontSize: 32, lineHeight: 1.1, color: "var(--fg1)",
                  }}>+{idea.expectedClicks}</span>
                  <span className="body-sm" style={{ color: "var(--fg2)" }}>clicks / mo</span>
                </div>
                {/* The basis is not a footnote. A modelled number presented as a
                    measured one is how a screen stops being trusted. */}
                <div className="caption" style={{ color: "var(--fg3)", marginTop: 3 }}>
                  {idea.basis} · confidence {idea.confidence}
                </div>
              </>
            ) : (
              <div className="body-sm" style={{ color: "var(--fg3)", marginTop: "var(--space-2)", lineHeight: 1.5 }}>
                Not enough data to estimate honestly. {idea.impressions.toLocaleString("en-US")} impressions
                {idea.position != null && ` at position ${idea.position.toFixed(0)}`} is the demand we can see.
              </div>
            )}
          </div>
        </div>

        {idea.page && (
          <div className="caption" style={{ color: "var(--fg3)", marginTop: "var(--space-4)" }}>
            Page: <a href={idea.page} target="_blank" rel="noopener noreferrer"
                     style={{ color: "var(--fg2)" }}>{idea.page.replace(/^https?:\/\/[^/]+/, "")}</a>
          </div>
        )}

        {/* ── actions ────────────────────────────────────────────────────────
            Approving does NOT publish anything. It moves the idea into the
            pipeline as queued work. The design's "Approve & publish" belongs on
            a staged page change, not on an article nobody has written yet, and
            a button that overstates what it does is worse than a plain one. */}
        <div style={{
          display: "flex", alignItems: "center", gap: "var(--space-3)",
          marginTop: "var(--space-5)", paddingTop: "var(--space-4)",
          borderTop: "1px solid var(--divider)", flexWrap: "wrap",
        }}>
          <form action="/api/content" method="post" style={{ display: "contents" }}>
            <input type="hidden" name="action" value="accept" />
            <input type="hidden" name="client_id" value={clientId} />
            <input type="hidden" name="title" value={idea.title} />
            <input type="hidden" name="target_query" value={idea.query} />
            <input type="hidden" name="rationale" value={idea.rationale} />
            <input type="hidden" name="confidence" value={idea.confidence} />
            <input type="hidden" name="expected_clicks_mo" value={idea.expectedClicks ?? ""} />
            <button type="submit" style={{
              fontFamily: "var(--font-body)", fontSize: 13.5, fontWeight: 600,
              padding: "9px 18px", borderRadius: "var(--radius-pill)", cursor: "pointer",
              border: "none", background: "var(--tm-performance-green)", color: "var(--tm-deep-charcoal)",
            }}>Add to pipeline</button>
          </form>

          <form action="/api/content" method="post" style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
            <input type="hidden" name="action" value="decline" />
            <input type="hidden" name="client_id" value={clientId} />
            <input type="hidden" name="title" value={idea.title} />
            <input type="hidden" name="target_query" value={idea.query} />
            {/* Required: a decline with no reason teaches the recommender
                nothing, and the same idea comes back next month. */}
            <input
              name="reason" required placeholder="Why not?" maxLength={200}
              style={{
                fontFamily: "var(--font-body)", fontSize: 13, padding: "8px 12px",
                borderRadius: "var(--radius-pill)", border: "1px solid var(--border-strong)",
                background: "transparent", color: "var(--fg1)", width: 190,
              }}
            />
            <button type="submit" style={{
              fontFamily: "var(--font-body)", fontSize: 13.5, fontWeight: 600,
              padding: "9px 16px", borderRadius: "var(--radius-pill)", cursor: "pointer",
              border: "1px solid var(--border-strong)", background: "transparent", color: "var(--fg2)",
            }}>Decline</button>
          </form>

          <span className="caption" style={{ marginLeft: "auto", color: "var(--fg3)" }}>
            Declining mutes this topic for 60 days
          </span>
        </div>
      </div>
    </article>
  );
}

/** Window provenance line. Every number above is only as fresh as this. */
export function WindowNote({ windowEnd, capped }: { windowEnd: string | null; capped: number }) {
  if (!windowEnd) return null;
  return (
    <div className="caption" style={{ color: "var(--fg3)", marginTop: "var(--space-3)" }}>
      Search Console, 28 days to {fmtDate(windowEnd)}. Top {capped} queries by impressions — the tail
      below that is mostly single-impression noise. Search Console reports about two days behind.
    </div>
  );
}

// ── keyword movement table ──────────────────────────────────────────────────
//
// The design's "Conversion keyword" table. Renamed, and the reason is in
// lib/keywordMovement.ts: we cannot attribute a conversion to a keyword, and a
// column heading that claims we can is the kind of small lie that costs an
// account manager's trust in every other number on the screen.


const TREND: Record<MovementRow["trend"], { label: string; colour: string }> = {
  rising:  { label: "Rising",  colour: "var(--success)" },
  slipped: { label: "Slipped", colour: "var(--danger)" },
  holding: { label: "Holding", colour: "var(--fg2)" },
  new:     { label: "New",     colour: "var(--fg3)" },
};

/** Serif numerals, matching the design's rank treatment. */
function Rank({ n, muted }: { n: number | null; muted?: boolean }) {
  if (n == null) return <span style={{ color: "var(--fg3)" }}>—</span>;
  return (
    <span style={{
      fontFamily: "var(--font-display)", fontSize: muted ? 16 : 22,
      color: muted ? "var(--fg3)" : "var(--fg1)", letterSpacing: "-0.01em",
    }}>#{n % 1 === 0 ? n : n.toFixed(1)}</span>
  );
}

export function KeywordMovementTable({
  rows, shown = 8,
}: { rows: MovementRow[]; shown?: number }) {
  const visible = rows.slice(0, shown);

  return (
    <section style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)", overflow: "hidden",
    }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
          <thead>
            <tr>
              {["Keyword", "Was", "Now", "Δ", "Volume", "Trend"].map((h, i) => (
                <th key={h} className="eyebrow" style={{
                  textAlign: i === 0 ? "left" : "right",
                  padding: "var(--space-3) var(--space-5)",
                  color: "var(--fg3)", fontWeight: 700,
                  borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              const t = TREND[r.trend];
              return (
                <tr key={r.query} style={{
                  borderTop: i === 0 ? "none" : "1px solid var(--divider)",
                  background: i % 2 ? "var(--tm-stone-100)" : "transparent",
                }}>
                  <td style={{ padding: "var(--space-3) var(--space-5)", fontSize: 14, color: "var(--fg1)" }}>
                    {r.query}
                  </td>
                  <td style={{ padding: "var(--space-3) var(--space-5)", textAlign: "right" }}>
                    <Rank n={r.was} muted />
                  </td>
                  <td style={{ padding: "var(--space-3) var(--space-5)", textAlign: "right" }}>
                    <Rank n={r.now} />
                  </td>
                  <td style={{
                    padding: "var(--space-3) var(--space-5)", textAlign: "right",
                    fontSize: 13, fontWeight: 600, color: t.colour, whiteSpace: "nowrap",
                  }}>
                    {r.delta == null ? "—" : r.delta === 0 ? "0" : `${r.delta > 0 ? "+" : ""}${r.delta}`}
                  </td>
                  <td style={{
                    padding: "var(--space-3) var(--space-5)", textAlign: "right",
                    fontSize: 13.5, color: r.volume == null ? "var(--fg3)" : "var(--fg1)", whiteSpace: "nowrap",
                  }}>
                    {/* Volume is not impressions. Until DataForSEO fills it in
                        this is honestly blank rather than quietly showing the
                        wrong measurement under the right heading. */}
                    {r.volume != null ? r.volume.toLocaleString("en-US") : "–"}
                  </td>
                  <td style={{
                    padding: "var(--space-3) var(--space-5)", textAlign: "right",
                    fontSize: 13, fontWeight: 600, color: t.colour, whiteSpace: "nowrap",
                  }}>{t.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="caption" style={{
        padding: "var(--space-3) var(--space-5)", color: "var(--fg3)",
        borderTop: "1px solid var(--divider)",
      }}>
        {rows.length === 0
          ? "No queries above the noise floor yet."
          : `Ranked by impressions, so the top row is what most traffic depends on. ` +
            `${rows.length} queries with meaningful impressions, ${visible.length} shown. ` +
            `Position is Search Console's average across the window, not a live check.`}
      </div>
    </section>
  );
}

// ── stat tiles ──────────────────────────────────────────────────────────────

export function StatTiles({ tiles }: {
  tiles: { label: string; value: string; sub?: string; tone?: "up" | "down" | "flat" }[];
}) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)", display: "flex", overflowX: "auto",
      marginBottom: "var(--space-6)",
    }}>
      {tiles.map((t, i) => (
        <div key={t.label} style={{
          flex: "1 1 0", minWidth: 190,
          padding: "var(--space-5) var(--space-6)",
          borderLeft: i === 0 ? "none" : "1px solid var(--divider)",
        }}>
          <div className="eyebrow" style={{ color: "var(--fg3)" }}>{t.label}</div>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 38, lineHeight: 1.1,
            letterSpacing: "-0.01em", margin: "var(--space-2) 0 2px",
            color: t.value === "–" ? "var(--fg3)" : "var(--fg1)",
          }}>{t.value}</div>
          {t.sub && (
            <div className="caption" style={{
              color: t.tone === "up" ? "var(--success)" : t.tone === "down" ? "var(--danger)" : "var(--fg3)",
            }}>{t.sub}</div>
          )}
        </div>
      ))}
    </div>
  );
}
