// app/dashboard/[id]/social/page.tsx — organic social.
//
// WO-003 / Module E. The plan's rule for this tab: rank by DISTANCE TO REVENUE.
// Lead with saves, shares and profile actions — the signals that mean intent —
// and keep followers and likes as trend only, never a hero number.
//
// Source is PostFlow, which covers whatever networks the team actually publishes
// to. Reach on accounts NOT published through PostFlow needs Meta Graph, which
// is a later addition rather than a gap being hidden here.
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabaseServer";
import { ClientHeader } from "@/components/ClientHeader";
import { workspaceTabs, type ClientType } from "@/lib/workspaceTabs";
import { fmtDate } from "@/lib/time";
import { dbClient } from "@/lib/db";
import { readSecret } from "@/lib/vault";
import { listSocialAccounts } from "@/lib/postflow";
import { normaliseNetwork } from "@/lib/platformPlaybook";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

type Post = {
  id: number; external_id: string; platform: string | null; post_type: string | null;
  title: string | null; content: string | null; permalink: string | null; posted_at: string | null;
};
type Metric = {
  post_id: number; date: string; views: number | null; reach: number | null;
  likes: number | null; shares: number | null; saves: number | null; replies: number | null;
  engagements: number | null; video_views: number | null; link_clicks: number | null;
};

function n(v: number | null | undefined): number { return v ?? 0; }

const INP: React.CSSProperties = {
  fontFamily: "var(--font-body)", fontSize: 13, padding: "8px 10px",
  border: "1px solid var(--border-strong)", borderRadius: 7, width: "100%",
  boxSizing: "border-box", background: "#fff", color: "var(--fg1)",
};

function ITEM_BTN(primary: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 12.5,
    padding: "6px 12px", borderRadius: 7, cursor: "pointer",
    border: primary ? "none" : "1px solid var(--border-strong)",
    background: primary ? "var(--tm-performance-green)" : "#fff",
    color: "#080808",
  };
}

const PLAN_MSG: Record<string, string> = {
  approved: "Plan approved. Run the drafting job to write the captions and push them to PostFlow.",
  "item-drafted": "Caption written. Review it, add artwork, then send.",
  regenerated: "Rewritten.",
  "caption-saved": "Your copy saved.",
  "image-saved": "Image attached. It uploads when you send.",
  "image-not-https": "Image URL must start with https://.",
  sent: "Sent to PostFlow.",
  "already-sent": "That slot is already in PostFlow.",
  "nothing-to-send": "Write a caption before sending.",
  "empty-caption": "Caption cannot be empty.",
  "item-skipped": "Slot skipped. It stays in the plan and can be restored.",
  "item-restored": "Slot restored.",
  "already-drafted": "That slot is already in PostFlow.",
  "item-failed": "Could not draft that slot. The brief is unchanged, so it is safe to retry.",
  "already-approved": "That month is already approved. Build a different month, or edit the plan in PostFlow.",
  "build-failed": "Could not build a plan. Check the client has collected social posts.",
  "no-plan": "No plan found for that month.",
};

export default async function Social({
  params, searchParams,
}: {
  params: { id: string };
  searchParams: { msg?: string };
}) {
  const db = userClient();
  const { data: client } = await db
    .from("clients").select("id, name, domain, tier, client_type, postflow_group_id").eq("id", params.id).single();
  if (!client) redirect("/dashboard");

  const type = ((client as { client_type?: string }).client_type ?? null) as ClientType;
  if (!workspaceTabs(type).some((t) => t.key === "social")) redirect(`/dashboard/${params.id}`);

  const [{ data: postRows }, { count: pending }] = await Promise.all([
    db.from("social_posts")
      .select("id, external_id, platform, post_type, title, content, permalink, posted_at")
      .eq("client_id", params.id).order("posted_at", { ascending: false }).limit(60),
    db.from("approvals").select("id", { count: "exact", head: true })
      .eq("client_id", params.id).in("status", ["staged", "failed"]),
  ]);

  // Next month's plan, if one has been built.
  const now = new Date();
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    .toISOString().slice(0, 10);

  const { data: plan } = await db
    .from("content_plans")
    .select("id, month, status, target_posts, rationale")
    .eq("client_id", params.id).eq("month", nextMonth).maybeSingle();

  const { data: planItems } = plan
    ? await db.from("content_plan_items")
        .select("id, slot, scheduled_for, platform, format, theme, brief, why, source_post_id, status, caption, postflow_id")
        .eq("plan_id", plan.id).order("slot")
    : { data: [] };


  const slots = (planItems ?? []) as Record<string, unknown>[];
  const pendingSlots = slots.filter((i) => ["planned", "failed"].includes(String(i.status))).length;
  const draftedSlots = slots.filter((i) => String(i.status) === "sent").length;
  const skippedSlots = slots.filter((i) => String(i.status) === "skipped").length;

  const groupId = (client as { postflow_group_id?: string | null }).postflow_group_id;
  // ── what this client can actually publish to ──────────────────────────────
  // CONNECTED accounts, same source the planner uses. An earlier version read
  // posting history and the existing plan, which meant a brand that had never
  // posted got no picker at all — precisely the client who most needs to choose.
  //
  // Read with the service role because the vault is not reachable under RLS, and
  // wrapped because a PostFlow outage should cost the picker, not the page.
  let connectedNets: string[] = [];
  let connectError: string | null = null;
  if (groupId) {
    try {
      const svcDb = dbClient();
      const token = await readSecret(svcDb, "postflow");
      if (token) {
        const accounts = await listSocialAccounts(token, groupId);
        connectedNets = Array.from(
          new Set(
            accounts
              .map((a) => (a.network ? normaliseNetwork(a.network) : null))
              .filter(Boolean) as string[]
          )
        );
      }
    } catch (e) {
      connectError = (e as Error).message.slice(0, 220);
    }
  }

  const { data: acctRows } = await db
    .from("social_posts").select("platform").eq("client_id", params.id).not("platform", "is", null);
  const historicalNets = Array.from(
    new Set((acctRows ?? []).map((r: { platform: string | null }) => r.platform).filter(Boolean) as string[])
  );

  const pickable = connectedNets.length ? connectedNets : historicalNets;

  const rawMsg = searchParams.msg ?? "";
  const planMsg = rawMsg.startsWith("built:")
    ? `Plan built: ${rawMsg.split(":")[1]} posts. Review below, then approve.`
    : rawMsg.startsWith("item-failed:")
    // Carry the actual error through. The first version replaced it with a
    // generic line, which turned a fixable problem into a mystery.
    ? `Could not draft that slot: ${decodeURIComponent(rawMsg.slice("item-failed:".length))}`
    : rawMsg.startsWith("build-failed:")
    ? `Could not build a plan: ${decodeURIComponent(rawMsg.slice("build-failed:".length))}`
    : PLAN_MSG[rawMsg.split(":")[0]] ?? null;

  const posts = (postRows ?? []) as Post[];

  // Latest metric row per post.
  const { data: metricRows } = posts.length
    ? await db.from("social_metrics_daily")
        .select("post_id, date, views, reach, likes, shares, saves, replies, engagements, video_views, link_clicks")
        .in("post_id", posts.map((p) => p.id))
        .order("date", { ascending: false })
    : { data: [] };

  const latest = new Map<number, Metric>();
  for (const m of (metricRows ?? []) as Metric[]) if (!latest.has(m.post_id)) latest.set(m.post_id, m);

  const rows = posts.map((p) => ({ p, m: latest.get(p.id) }));

  const totals = rows.reduce(
    (a, r) => ({
      saves: a.saves + n(r.m?.saves),
      shares: a.shares + n(r.m?.shares),
      clicks: a.clicks + n(r.m?.link_clicks),
      engagements: a.engagements + n(r.m?.engagements),
      reach: a.reach + n(r.m?.reach),
    }),
    { saves: 0, shares: 0, clicks: 0, engagements: 0, reach: 0 }
  );

  // Ranked by intent signals, not by likes. A post with 400 likes and no saves
  // did not move anyone closer to buying.
  const best = [...rows]
    .sort((a, b) =>
      (n(b.m?.saves) + n(b.m?.shares) + n(b.m?.link_clicks)) -
      (n(a.m?.saves) + n(a.m?.shares) + n(a.m?.link_clicks))
    )
    .slice(0, 5);


  return (
    <main style={{ padding: "40px 32px 64px" }}>
      <div style={{ maxWidth: 1180 }}>
        <ClientHeader
          id={params.id} name={client.name} domain={client.domain} tier={client.tier}
          clientType={type} active="social" pending={pending ?? 0}
          sub={posts.length ? `${posts.length} posts collected via PostFlow` : "No posts collected yet"}
        />

        {connectError && (
          <div style={{
            background: "#FFF9EC", border: "1px solid #EAD9A6", borderRadius: 10,
            padding: "12px 16px", marginBottom: 18, fontSize: 13.5, color: "#8A6D1F", maxWidth: 900,
          }}>
            <strong>Nothing can be published for this client yet.</strong> {connectError}
          </div>
        )}

        {planMsg && (
          <div style={{ padding: "12px 16px", borderRadius: 8, background: "#fff",
                        border: "1px solid var(--border)", fontSize: 14, marginBottom: 20, maxWidth: 900 }}>
            {planMsg}
          </div>
        )}

        {/* ── next month's plan ─────────────────────────────────────────── */}
        {groupId && (
          <section style={{ marginBottom: 36 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 10 }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 26, margin: 0 }}>
                Next month
              </h2>
              <span style={{ fontSize: 13, color: "var(--fg3)" }}>
                {new Date(nextMonth + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}
              </span>

              <form action="/api/content-plan" method="post" style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <input type="hidden" name="client_id" value={params.id} />
                <input type="hidden" name="action" value="build" />

                {/* More than one connected network is a choice worth offering.
                    Exactly one is worth STATING, so nobody wonders why there is
                    no picker. None is worth warning about, because a plan cannot
                    be published anywhere. */}
                {pickable.length > 1 ? (
                  <span style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5, color: "var(--fg2)" }}>
                    {pickable.map((n) => (
                      <label key={n} style={{ display: "flex", gap: 5, alignItems: "center", textTransform: "capitalize" }}>
                        <input type="checkbox" name="network" value={n} />
                        {n}
                      </label>
                    ))}
                  </span>
                ) : pickable.length === 1 ? (
                  <span style={{ fontSize: 12.5, color: "var(--fg3)", textTransform: "capitalize" }}>
                    {pickable[0]} only
                  </span>
                ) : (
                  <span style={{ fontSize: 12.5, color: "var(--danger)" }}>
                    No connected accounts
                  </span>
                )}

                <button type="submit" style={{
                  fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 13.5,
                  padding: "9px 16px", borderRadius: 8, border: "none", cursor: "pointer",
                  background: plan ? "#fff" : "var(--tm-performance-green)",
                  color: "#080808",
                  boxShadow: plan ? "inset 0 0 0 1px var(--border-strong)" : "none",
                }}>
                  {plan ? "Rebuild plan" : "Build next month"}
                </button>
              </form>
            </div>

            {!plan ? (
              <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "24px 22px", maxWidth: 900 }}>
                <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--fg2)", margin: 0 }}>
                  Build a month and the planner deals slots across this client&#39;s networks using what
                  their own posts have proven, then fills the rest with evergreen angles. Building costs
                  nothing and can be re-run until it looks right. Nothing is written or drafted until you
                  approve it.
                </p>
              </div>
            ) : (
              <>
                <div style={{
                  background: "#fff", border: "1px solid var(--border)", borderRadius: 12,
                  padding: "16px 20px", marginBottom: 14, maxWidth: 900, fontSize: 13.5,
                  color: "var(--fg2)", lineHeight: 1.6,
                }}>
                  {plan.rationale}
                </div>

                <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                  {(planItems ?? []).map((it: Record<string, unknown>, i: number) => (
                    <div key={it.slot as number} style={{
                      display: "flex", alignItems: "flex-start", gap: 14, padding: "13px 20px",
                      borderTop: i === 0 ? "none" : "1px solid var(--border)", flexWrap: "wrap",
                    }}>
                      <div style={{ minWidth: 70, fontSize: 12.5, color: "var(--fg3)", paddingTop: 2 }}>
                        {fmtDate(it.scheduled_for as string)}
                      </div>
                      <div style={{ minWidth: 96, fontSize: 12, color: "var(--fg3)", paddingTop: 3 }}>
                        {String(it.platform)} · {String(it.format)}
                      </div>
                      <div style={{ flex: 1, minWidth: 260 }}>
                        <div style={{ fontSize: 14, color: "var(--fg1)" }}>{String(it.brief)}</div>
                        <div style={{ fontSize: 12, color: "var(--fg3)", marginTop: 3 }}>{String(it.why)}</div>
                      </div>
                      {/* Each slot says where it came from. A filler slot that
                          looks identical to an evidence-backed one is how a
                          calendar gets mistaken for a strategy. */}
                      {(() => {
                        const theme = String(it.theme ?? "");
                        const style =
                          theme === "Repeat what worked"
                            ? { label: "Proven", fg: "#2F8F4E", bg: "#E5FFB8", edge: "#C7E89A" }
                            : theme === "Answer a customer question"
                            ? { label: "Customer ask", fg: "#2F6F8F", bg: "#E7F4FB", edge: "#BFDDEC" }
                            : theme === "Show the product working"
                            ? { label: "Catalogue", fg: "#7A5AA8", bg: "#F1EBFA", edge: "#DCCCF0" }
                            : { label: "Evergreen", fg: "var(--fg3)", bg: "var(--bg)", edge: "var(--border)" };
                        return (
                          <div style={{
                            fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                            padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap",
                            background: style.bg, color: style.fg, border: `1px solid ${style.edge}`,
                          }}>{style.label}</div>
                        );
                      })()}

                      {/* Each slot decides for itself. Reviewing a month means
                          keeping most of it and killing a couple, not one yes. */}
                      <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 150, justifyContent: "flex-end" }}>
                        {String(it.status) === "sent" ? (
                          <span style={{ fontSize: 12.5, color: "#2F8F4E", fontWeight: 600 }}>In PostFlow ✓</span>
                        ) : String(it.status) === "skipped" ? (
                          <form action="/api/content-plan/item" method="post">
                            <input type="hidden" name="client_id" value={params.id} />
                            <input type="hidden" name="item_id" value={it.id as number} />
                            <input type="hidden" name="action" value="unskip" />
                            <button type="submit" style={ITEM_BTN(false)}>Restore</button>
                          </form>
                        ) : (
                          <>
                            <form action="/api/content-plan/item" method="post">
                              <input type="hidden" name="client_id" value={params.id} />
                              <input type="hidden" name="item_id" value={it.id as number} />
                              <input type="hidden" name="action" value="draft" />
                              <button type="submit" style={ITEM_BTN(true)}>
                                {String(it.status) === "failed" ? "Retry" : "Draft"}
                              </button>
                            </form>
                            <form action="/api/content-plan/item" method="post">
                              <input type="hidden" name="client_id" value={params.id} />
                              <input type="hidden" name="item_id" value={it.id as number} />
                              <input type="hidden" name="action" value="skip" />
                              <button type="submit" style={ITEM_BTN(false)}>Skip</button>
                            </form>
                          </>
                        )}
                      </div>

                      {/* ── the post itself ──────────────────────────────────
                          Copy and artwork are edited independently, because the
                          real cases are "good image, wrong copy" and the reverse.
                          Nothing leaves for PostFlow until both are right. */}
                      {it.caption ? (
                        <div style={{ flexBasis: "100%", marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>

                          {/* artwork */}
                          <div style={{ width: 150 }}>
                            {it.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={String(it.image_url)} alt="" style={{
                                width: "100%", borderRadius: 8, display: "block",
                                border: "1px solid var(--border)",
                              }} />
                            ) : (
                              <div style={{
                                width: "100%", aspectRatio: "1", borderRadius: 8,
                                border: "1px dashed var(--border-strong)", display: "flex",
                                alignItems: "center", justifyContent: "center",
                                fontSize: 12, color: "var(--fg3)", textAlign: "center", padding: 8,
                              }}>No image yet</div>
                            )}

                            {String(it.status) !== "sent" && (
                              <form action="/api/content-plan/item" method="post" style={{ marginTop: 6 }}>
                                <input type="hidden" name="client_id" value={params.id} />
                                <input type="hidden" name="item_id" value={it.id as number} />
                                <input type="hidden" name="action" value="image" />
                                <input name="image_url" placeholder="Paste an image URL"
                                       defaultValue={String(it.image_url ?? "")}
                                       style={{ ...INP, fontSize: 11.5, padding: "6px 8px" }} />
                                <button type="submit" style={{ ...ITEM_BTN(false), marginTop: 5, width: "100%" }}>
                                  {it.image_url ? "Replace image" : "Attach image"}
                                </button>
                              </form>
                            )}
                          </div>

                          {/* copy */}
                          <div style={{ flex: 1, minWidth: 320 }}>
                            {String(it.status) === "sent" ? (
                              <div style={{
                                padding: "10px 12px", background: "var(--bg)", borderRadius: 8,
                                fontSize: 13.5, color: "var(--fg2)", lineHeight: 1.55, whiteSpace: "pre-wrap",
                              }}>{String(it.caption)}</div>
                            ) : (
                              <>
                                <form action="/api/content-plan/item" method="post">
                                  <input type="hidden" name="client_id" value={params.id} />
                                  <input type="hidden" name="item_id" value={it.id as number} />
                                  <input type="hidden" name="action" value="caption" />
                                  <textarea name="caption" defaultValue={String(it.caption)} rows={8}
                                            style={{ ...INP, lineHeight: 1.55, resize: "vertical" }} />
                                  <button type="submit" style={{ ...ITEM_BTN(false), marginTop: 6 }}>Save copy</button>
                                </form>

                                {/* A steer is cheaper than a rewrite and keeps the
                                    voice rules the prompt enforces. */}
                                <form action="/api/content-plan/item" method="post"
                                      style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                                  <input type="hidden" name="client_id" value={params.id} />
                                  <input type="hidden" name="item_id" value={it.id as number} />
                                  <input type="hidden" name="action" value="regenerate" />
                                  <input name="steer" placeholder="Rewrite it — e.g. shorter, less salesy, lead with the anode point"
                                         style={{ ...INP, flex: 1, minWidth: 240, fontSize: 12.5 }} />
                                  <button type="submit" style={ITEM_BTN(false)}>Rewrite</button>
                                </form>
                              </>
                            )}

                            {Array.isArray(it.hashtags) && (it.hashtags as string[]).length > 0 && (
                              <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--fg3)" }}>
                                {(it.hashtags as string[]).join(" ")}
                              </div>
                            )}

                            {String(it.status) !== "sent" && (
                              <form action="/api/content-plan/item" method="post" style={{ marginTop: 10 }}>
                                <input type="hidden" name="client_id" value={params.id} />
                                <input type="hidden" name="item_id" value={it.id as number} />
                                <input type="hidden" name="action" value="send" />
                                <button type="submit" style={ITEM_BTN(true)}>Send to PostFlow</button>
                                <span style={{ fontSize: 12, color: "var(--fg3)", marginLeft: 10 }}>
                                  Lands as an unscheduled draft.
                                </span>
                              </form>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>

                {/* Bulk is the shortcut, not the primary path — it only offers to
                    do what is still undecided, so it can never re-draft or
                    resurrect something already skipped. */}
                {pendingSlots > 0 && (
                  <form action="/api/content-plan" method="post" style={{ marginTop: 16 }}>
                    <input type="hidden" name="client_id" value={params.id} />
                    <input type="hidden" name="plan_id" value={plan.id} />
                    <input type="hidden" name="action" value="approve" />
                    <button type="submit" style={{
                      fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 14,
                      padding: "11px 20px", borderRadius: 8, border: "none", cursor: "pointer",
                      background: "var(--tm-performance-green)", color: "#080808",
                    }}>
                      Draft all {pendingSlots} remaining
                    </button>
                    <span style={{ fontSize: 12.5, color: "var(--fg3)", marginLeft: 12 }}>
                      Or decide slot by slot above. Drafts land in PostFlow unscheduled.
                    </span>
                  </form>
                )}

                {pendingSlots === 0 && (
                  <div style={{ marginTop: 14, fontSize: 13.5, color: "var(--fg2)" }}>
                    Every slot decided — {draftedSlots} drafted, {skippedSlots} skipped.
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {!groupId ? (
          <div style={{ background: "#FFF9EC", border: "1px solid #EAD9A6", borderRadius: 12, padding: "28px 26px", maxWidth: 760 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 26, marginBottom: 8 }}>Not connected</div>
            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "#8A6D1F", margin: 0 }}>
              This client has no PostFlow group set, so nothing can be collected. Set
              <code style={{ margin: "0 5px" }}>clients.postflow_group_id</code>
              to the group that publishes for them, then verify with
              <code style={{ marginLeft: 5 }}>/api/ops/postflow-check</code>.
            </p>
          </div>
        ) : posts.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "30px 26px", maxWidth: 760 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 26, marginBottom: 8 }}>Nothing collected yet</div>
            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--fg2)", margin: 0 }}>
              The group is connected but no posts have come back for the last 30 days. Either nothing has
              published in that window, or the group id points somewhere without posts.
            </p>
          </div>
        ) : (
          <>
            {/* Distance to revenue, in order. Followers and likes are deliberately
                not here — they are trend material, not a headline. */}
            <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginBottom: 30 }}>
              <Stat label="Saves" value={totals.saves.toLocaleString()} sub="strongest intent signal" accent />
              <Stat label="Shares" value={totals.shares.toLocaleString()} sub="earned distribution" />
              <Stat label="Link clicks" value={totals.clicks.toLocaleString()} sub="left the platform for you" />
              <Stat label="Engagements" value={totals.engagements.toLocaleString()} sub="all interactions" />
              <Stat label="Reach" value={totals.reach.toLocaleString()} sub="people, not impressions" />
            </div>

            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 26, margin: "0 0 4px" }}>
              What actually worked
            </h2>
            <p style={{ fontSize: 13.5, color: "var(--fg2)", margin: "0 0 16px" }}>
              Ranked by saves, shares and clicks rather than likes — a post with plenty of likes and no
              saves moved nobody closer to buying.
            </p>

            <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 34 }}>
              {best.map((r, i) => (
                <div key={r.p.id} style={{
                  display: "flex", alignItems: "flex-start", gap: 16, padding: "15px 20px",
                  borderTop: i === 0 ? "none" : "1px solid var(--border)", flexWrap: "wrap",
                }}>
                  <div style={{ minWidth: 74, fontSize: 12.5, color: "var(--fg3)", paddingTop: 2 }}>
                    {fmtDate(r.p.posted_at)}
                  </div>
                  <div style={{ flex: 1, minWidth: 260 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--fg1)" }}>
                      {r.p.title || (r.p.content ? r.p.content.slice(0, 90) + (r.p.content.length > 90 ? "…" : "") : "Untitled post")}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--fg3)", marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
                      {r.p.post_type && <span>{r.p.post_type}</span>}
                      {r.p.permalink && (
                        <a href={r.p.permalink} target="_blank" rel="noreferrer"
                           style={{ color: "var(--fg2)" }}>View post ↗</a>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 18, fontSize: 12.5, color: "var(--fg2)", whiteSpace: "nowrap" }}>
                    <Metric2 label="saves" v={n(r.m?.saves)} strong />
                    <Metric2 label="shares" v={n(r.m?.shares)} />
                    <Metric2 label="clicks" v={n(r.m?.link_clicks)} />
                    <Metric2 label="reach" v={n(r.m?.reach)} />
                  </div>
                </div>
              ))}
            </div>

            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 26, margin: "0 0 16px" }}>
              Everything published
            </h2>
            <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
              {rows.map((r, i) => (
                <div key={r.p.id} style={{
                  display: "flex", alignItems: "center", gap: 16, padding: "12px 20px",
                  borderTop: i === 0 ? "none" : "1px solid var(--border)", flexWrap: "wrap",
                }}>
                  <div style={{ minWidth: 74, fontSize: 12.5, color: "var(--fg3)" }}>{fmtDate(r.p.posted_at)}</div>
                  <div style={{ flex: 1, minWidth: 240, fontSize: 13.5, color: "var(--fg1)" }}>
                    {r.p.title || (r.p.content ? r.p.content.slice(0, 80) + "…" : "Untitled")}
                  </div>
                  <div style={{ display: "flex", gap: 16, fontSize: 12.5, color: "var(--fg2)" }}>
                    <Metric2 label="saves" v={n(r.m?.saves)} />
                    <Metric2 label="shares" v={n(r.m?.shares)} />
                    <Metric2 label="reach" v={n(r.m?.reach)} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Metric2({ label, v, strong }: { label: string; v: number; strong?: boolean }) {
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      <strong style={{ color: strong && v > 0 ? "var(--tm-green-deep)" : "var(--fg1)" }}>{v.toLocaleString()}</strong>{" "}
      <span style={{ color: "var(--fg3)" }}>{label}</span>
    </span>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg3)" }}>{label}</div>
      <div style={{
        fontFamily: "var(--font-display)", fontSize: 40, lineHeight: 1.05, margin: "4px 0 2px",
        color: accent ? "var(--tm-green-deep)" : "var(--fg1)",
      }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--fg3)" }}>{sub}</div>
    </div>
  );
}
