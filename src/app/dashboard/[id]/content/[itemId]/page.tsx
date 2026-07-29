// app/dashboard/[id]/content/[itemId] — one pipeline item, end to end.
//
// WO-005. "Add to pipeline" used to be a dead end: it produced a queued row with
// no way to move it and nothing saying what to write. This is where an accepted
// recommendation becomes work someone can do, and then a published URL that
// measures itself.
//
// Form-POST only. Everything here survives a refresh.
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProfile, isAgency, userClient } from "@/lib/supabaseServer";
import { PageHeader } from "@/components/PageHeader";
import { fmtDateTime } from "@/lib/time";
import type { ContentBrief } from "@/lib/contentBrief";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

const FLOW = [
  { key: "queued", label: "Queued" },
  { key: "drafting", label: "Drafting" },
  { key: "in_qc", label: "In QC" },
  { key: "awaiting_client", label: "Awaiting client" },
  { key: "published", label: "Published" },
] as const;

const card = {
  background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)", padding: "var(--space-5)",
};

export default async function ContentItem({
  params, searchParams,
}: { params: { id: string; itemId: string }; searchParams: { msg?: string } }) {
  const profile = await getProfile();
  const db = userClient();

  const [{ data: client }, { data: item, error }] = await Promise.all([
    db.from("clients").select("id, name, domain").eq("id", params.id).single(),
    db.from("content_items").select("*").eq("id", params.itemId).eq("client_id", params.id).maybeSingle(),
  ]);

  if (error) throw new Error(error.message);
  if (!item || !client) notFound();

  const brief = item.brief as ContentBrief | null;
  const stageIndex = FLOW.findIndex((f) => f.key === item.status);

  return (
    <main>
      <PageHeader
        eyebrow={`${client.name} · Content`}
        title={item.title}
        subtitle={item.rationale ?? undefined}
        actions={
          <Link href={`/dashboard/${params.id}/organic`} style={{
            fontSize: 13, fontWeight: 600, color: "var(--fg2)", textDecoration: "none",
          }}>← Organic</Link>
        }
      />

      <div style={{ padding: "var(--space-6) var(--space-8) var(--space-10)", maxWidth: 1040 }}>
        {searchParams.msg && (
          <div className="body-sm" style={{
            padding: "var(--space-3) var(--space-4)", marginBottom: "var(--space-5)",
            borderRadius: "var(--radius-md)", background: "var(--tm-green-soft)", color: "var(--fg1)",
          }}>{searchParams.msg}</div>
        )}

        {/* ── where it is ─────────────────────────────────────────────────── */}
        <section style={{ ...card, marginBottom: "var(--space-5)" }}>
          <div className="eyebrow" style={{ color: "var(--fg3)", marginBottom: "var(--space-4)" }}>Stage</div>

          <div style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap", marginBottom: "var(--space-5)" }}>
            {FLOW.map((f, i) => {
              const done = stageIndex >= 0 && i <= stageIndex;
              return (
                <div key={f.key} style={{ display: "flex", alignItems: "center" }}>
                  <span style={{
                    fontSize: 12.5, fontWeight: 600, padding: "5px 12px",
                    borderRadius: "var(--radius-pill)",
                    background: done ? "var(--tm-performance-green)" : "var(--tm-stone-200)",
                    color: done ? "var(--tm-deep-charcoal)" : "var(--fg3)",
                  }}>{f.label}</span>
                  {i < FLOW.length - 1 && (
                    <span style={{ width: 18, height: 1, background: "var(--border)" }} />
                  )}
                </div>
              );
            })}
          </div>

          {item.status === "declined" ? (
            <div className="body-sm" style={{ color: "var(--fg2)" }}>
              Declined{item.decline_reason ? `: ${item.decline_reason}` : ""}. Muted for 60 days from
              {" "}{item.declined_at ? fmtDateTime(item.declined_at) : "then"}.
            </div>
          ) : (
            // Every stage offers the next one AND publishing, because work does
            // not always move one step at a time — an article can go straight
            // from drafting to live when the client asked for it that morning.
            <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "flex-start" }}>
              {FLOW.filter((f) => f.key !== item.status && f.key !== "published").map((f) => (
                <form key={f.key} action="/api/content" method="post">
                  <input type="hidden" name="action" value="status" />
                  <input type="hidden" name="client_id" value={params.id} />
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="status" value={f.key} />
                  <button type="submit" style={{
                    fontFamily: "var(--font-body)", fontSize: 12.5, fontWeight: 600,
                    padding: "7px 14px", borderRadius: "var(--radius-pill)", cursor: "pointer",
                    border: "1px solid var(--border-strong)", background: "transparent", color: "var(--fg2)",
                  }}>Move to {f.label.toLowerCase()}</button>
                </form>
              ))}

              {/* Publishing needs the URL: without it nothing can be measured,
                  and an item marked published that we cannot measure is worse
                  than one still marked drafting. */}
              <form action="/api/content" method="post" style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                <input type="hidden" name="action" value="status" />
                <input type="hidden" name="client_id" value={params.id} />
                <input type="hidden" name="id" value={item.id} />
                <input type="hidden" name="status" value="published" />
                <input
                  name="url" type="url" required placeholder={`https://${client.domain}/...`}
                  defaultValue={item.url ?? ""}
                  style={{
                    fontFamily: "var(--font-body)", fontSize: 12.5, padding: "7px 12px",
                    borderRadius: "var(--radius-pill)", border: "1px solid var(--border-strong)",
                    background: "transparent", color: "var(--fg1)", width: 250,
                  }}
                />
                <button type="submit" style={{
                  fontFamily: "var(--font-body)", fontSize: 12.5, fontWeight: 600,
                  padding: "7px 14px", borderRadius: "var(--radius-pill)", cursor: "pointer",
                  border: "none", background: "var(--tm-performance-green)", color: "var(--tm-deep-charcoal)",
                }}>Mark published</button>
              </form>
            </div>
          )}

          {item.expected_clicks_mo != null && (
            <div className="caption" style={{ color: "var(--fg3)", marginTop: "var(--space-4)" }}>
              Predicted at acceptance: +{item.expected_clicks_mo} clicks/mo, confidence {item.confidence}.
              {item.status === "published"
                ? " Measured against the current Search Console window on the Organic tab."
                : " Recorded before the outcome is known, so the verdict later means something."}
            </div>
          )}
        </section>

        {/* ── the brief ───────────────────────────────────────────────────── */}
        <section style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", marginBottom: "var(--space-4)", flexWrap: "wrap" }}>
            <div className="eyebrow" style={{ color: "var(--fg3)" }}>Brief</div>
            {item.brief_generated_at && (
              <span className="caption" style={{ color: "var(--fg3)" }}>
                Generated {fmtDateTime(item.brief_generated_at)}
              </span>
            )}
            <form action="/api/content" method="post" style={{ marginLeft: "auto" }}>
              <input type="hidden" name="action" value="brief" />
              <input type="hidden" name="client_id" value={params.id} />
              <input type="hidden" name="id" value={item.id} />
              <button type="submit" style={{
                fontFamily: "var(--font-body)", fontSize: 12.5, fontWeight: 600,
                padding: "7px 14px", borderRadius: "var(--radius-pill)", cursor: "pointer",
                border: brief ? "1px solid var(--border-strong)" : "none",
                background: brief ? "transparent" : "var(--tm-performance-green)",
                color: brief ? "var(--fg2)" : "var(--tm-deep-charcoal)",
              }}>{brief ? "Regenerate" : "Write the brief"}</button>
            </form>
          </div>

          {!brief ? (
            <div className="body-sm" style={{ color: "var(--fg2)", lineHeight: 1.6 }}>
              No brief yet. Generating one uses the client&apos;s own Search Console cluster — every
              search this site already appears for around this topic — so the outline is grounded in
              demand rather than in what a model assumes people search.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
              <Field label="Goal">{brief.goal}</Field>
              <Field label="Audience">{brief.audience}</Field>

              <div>
                <div className="eyebrow" style={{ color: "var(--fg3)", marginBottom: "var(--space-2)" }}>
                  Meta title <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                    ({brief.metaTitle.length}/60)
                  </span>
                </div>
                <div className="body-sm" style={{ color: "var(--fg1)" }}>{brief.metaTitle}</div>
                <div className="body-sm" style={{ color: "var(--fg2)", marginTop: 4 }}>{brief.metaDescription}</div>
              </div>

              <Field label="H1">{brief.h1}</Field>

              <div>
                <div className="eyebrow" style={{ color: "var(--fg3)", marginBottom: "var(--space-3)" }}>
                  Outline · {brief.wordCount} words
                </div>
                {brief.sections.map((sec, i) => (
                  <div key={i} style={{
                    padding: "var(--space-3) 0",
                    borderTop: i === 0 ? "none" : "1px solid var(--divider)",
                  }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--fg1)" }}>{sec.heading}</div>
                    <div className="body-sm" style={{ color: "var(--fg2)", marginTop: 3, lineHeight: 1.5 }}>{sec.covers}</div>
                    {sec.answers.length > 0 && (
                      <div className="caption" style={{ color: "var(--fg3)", marginTop: 5 }}>
                        Answers: {sec.answers.map((a) => `"${a}"`).join(", ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {brief.gaps.length > 0 && (
                <List label="What the current page is likely missing" items={brief.gaps} />
              )}

              {/* The most important block on the page. These are the things the
                  model refused to invent, and shipping without answering them is
                  how a confident wrong claim reaches a client's site. */}
              {brief.openQuestions.length > 0 && (
                <div style={{
                  padding: "var(--space-4)", borderRadius: "var(--radius-md)",
                  background: "#FFF9EC", border: "1px solid #EAD9A6",
                }}>
                  <div className="eyebrow" style={{ color: "#8A6D1F", marginBottom: "var(--space-2)" }}>
                    Check before writing
                  </div>
                  <ul className="body-sm" style={{ margin: 0, paddingLeft: 18, color: "var(--fg1)", lineHeight: 1.7 }}>
                    {brief.openQuestions.map((q, i) => <li key={i}>{q}</li>)}
                  </ul>
                </div>
              )}

              <List label="Target searches" items={brief.targetQueries} />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow" style={{ color: "var(--fg3)", marginBottom: "var(--space-2)" }}>{label}</div>
      <div className="body-sm" style={{ color: "var(--fg1)", lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}

function List({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="eyebrow" style={{ color: "var(--fg3)", marginBottom: "var(--space-2)" }}>{label}</div>
      <ul className="body-sm" style={{ margin: 0, paddingLeft: 18, color: "var(--fg2)", lineHeight: 1.7 }}>
        {items.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    </div>
  );
}
