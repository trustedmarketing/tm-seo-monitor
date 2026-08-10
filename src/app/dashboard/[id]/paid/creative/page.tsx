// app/dashboard/[id]/paid/creative/page.tsx — ad creative library (WO-006 stream F).
//
// Read-only view over the `creatives` table + links into
// api/ops/ad-creative's generate/check/approve actions (owner-only, manual
// for now — same convention as api/ops/stage-change). Concepts are grouped
// by concept_group_id: one 4:5 primary, plus its 1:1/9:16 siblings once
// fanned out (never before — see lib/adCreative.ts's fanOutSizes()).
import Link from "next/link";
import { userClient } from "@/lib/supabaseServer";
import { ClientHeader } from "@/components/ClientHeader";
import { PaidNav } from "@/components/PaidNav";
import { SearchAdPreview } from "@/components/SearchAdPreview";
import { PerformanceMaxPreview } from "@/components/PerformanceMaxPreview";
import { MetaFeedPreview } from "@/components/MetaFeedPreview";
import { buildAdRollups, type AdMetricRow } from "@/lib/creativeRollup";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

type Creative = {
  id: string;
  campaign_id: string | null;
  concept_group_id: string;
  aspect_ratio: string;
  image_url: string | null;
  status: "generating" | "completed" | "failed" | "approved";
  prompt: string | null;
  created_at: string;
};

type FlaggedText = { text: string; chars: number; overLimit: boolean };
type AdCopySet = {
  id: string;
  campaign_id: string | null;
  platform: "meta" | "google_ads" | "microsoft";
  format: "rsa" | "pmax" | "meta_feed";
  headlines: FlaggedText[] | null;
  long_headlines: FlaggedText[] | null;
  descriptions: FlaggedText[] | null;
  primary_texts: FlaggedText[] | null;
  business_name: string | null;
  status: "generated" | "approved";
  created_at: string;
};

type CampaignOption = { id: string; platform: string; campaign_id: string; campaign_name: string | null };
type PersonaOption = { id: string; name: string };

const PLATFORM_LABEL: Record<string, string> = { meta: "Meta", google_ads: "Google Ads", microsoft: "Microsoft Ads" };
const FORMAT_LABEL: Record<string, string> = { rsa: "Search (RSA)", pmax: "Performance Max", meta_feed: "Feed" };

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)" };
const eyebrow: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg3)" };
const STATUS_COLOR: Record<string, string> = {
  generating: "var(--fg3)", completed: "#B8860B", approved: "var(--tm-green-deep)", failed: "#B8433D",
};
const linkBtn: React.CSSProperties = {
  fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 12.5,
  padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border-strong)",
  color: "var(--fg2)", textDecoration: "none", display: "inline-block",
};
const L: React.CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--fg3)", marginBottom: 4 };
const I: React.CSSProperties = {
  fontFamily: "var(--font-body)", fontSize: 13, padding: "8px 10px", width: "100%", boxSizing: "border-box",
  border: "1px solid var(--border-strong)", borderRadius: 7, background: "#fff", color: "var(--fg1)",
};
const BTN: React.CSSProperties = {
  fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 13, padding: "9px 16px",
  borderRadius: 8, border: "none", cursor: "pointer", background: "var(--tm-performance-green)", color: "#080808",
};

export default async function Creative({ params }: { params: { id: string } }) {
  const db = userClient();
  const [{ data: client }, { data: creatives }, { data: copySets }, { data: campaignOptions }, { data: personaOptions }, { data: adMetrics }] = await Promise.all([
    db.from("clients").select("id, name, domain, tier, client_type").eq("id", params.id).single(),
    db.from("creatives").select("id, campaign_id, concept_group_id, aspect_ratio, image_url, status, prompt, created_at")
      .eq("client_id", params.id).order("created_at", { ascending: false }),
    db.from("ad_copy_sets").select("id, campaign_id, platform, format, headlines, long_headlines, descriptions, primary_texts, business_name, status, created_at")
      .eq("client_id", params.id).order("created_at", { ascending: false }),
    db.from("campaigns").select("id, platform, campaign_id, campaign_name").eq("client_id", params.id).eq("status", "active"),
    db.from("client_personas").select("id, name").eq("client_id", params.id),
    // 30 days is the widest window lib/creativeRollup.ts computes; no point pulling more.
    db
      .from("ad_metrics_daily")
      .select("ad_id, campaign_id, campaign_name, platform, date, spend, revenue, impressions, clicks")
      .eq("client_id", params.id)
      .gte("date", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)),
  ]);
  if (!client) return <main style={{ padding: 48 }}>Client not found. <Link href="/dashboard">Back</Link></main>;

  const campaignChoices = (campaignOptions ?? []) as CampaignOption[];
  const personaChoices = (personaOptions ?? []) as PersonaOption[];

  const adRollups = buildAdRollups((adMetrics ?? []) as AdMetricRow[])
    .sort((a, b) => b.thirtyDaySpend - a.thirtyDaySpend);

  const rows = (creatives ?? []) as Creative[];
  const groups = new Map<string, Creative[]>();
  for (const r of rows) {
    const g = groups.get(r.concept_group_id) ?? [];
    g.push(r);
    groups.set(r.concept_group_id, g);
  }

  // Best-effort image for a copy set's preview: the same campaign's approved
  // 4:5 if one exists, else this client's most recent completed 4:5 of any
  // campaign, else no image (previews render an explicit "no creative yet"
  // placeholder rather than a broken image).
  function imageFor(campaignId: string | null): string | null {
    const fourFive = rows.filter((r) => r.aspect_ratio === "4:5" && r.image_url);
    const sameCampaign = campaignId ? fourFive.find((r) => r.campaign_id === campaignId && r.status === "approved") : null;
    return sameCampaign?.image_url ?? fourFive.find((r) => r.status === "approved")?.image_url ?? fourFive[0]?.image_url ?? null;
  }

  const copyRows = (copySets ?? []) as AdCopySet[];
  const texts = (list: FlaggedText[] | null) => (list ?? []).map((t) => t.text);

  return (
    <main style={{ padding: "40px 32px 64px" }}>
      <div style={{ maxWidth: 1000 }}>
        <ClientHeader id={params.id} name={client.name} domain={client.domain} tier={client.tier} clientType={(client as any).client_type ?? null} active="paid"
          sub="Ad creative — generated 4:5 first; approve to fan out to 1:1 and 9:16" />
        <PaidNav clientId={params.id} active="creative" />

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
          <section style={{ ...card, padding: "18px 20px", flex: "1 1 320px" }}>
            <div style={{ ...eyebrow, marginBottom: 10 }}>Generate creative (4:5)</div>
            <form action="/api/ops/ad-creative" method="get">
              <input type="hidden" name="action" value="generate" />
              <input type="hidden" name="client" value={params.id} />
              <div style={{ marginBottom: 10 }}>
                <label style={L}>Campaign name</label>
                <input style={I} name="campaign_name" required placeholder="e.g. Prospecting - Broad" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={L}>Link to campaign (optional)</label>
                  <select style={I} name="campaign_id" defaultValue="">
                    <option value="">(none)</option>
                    {campaignChoices.map((c) => (
                      <option key={c.id} value={c.id}>{c.campaign_name ?? c.campaign_id} ({PLATFORM_LABEL[c.platform] ?? c.platform})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={L}>Persona (optional)</label>
                  <select style={I} name="persona_id" defaultValue="">
                    <option value="">(none)</option>
                    {personaChoices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={L}>Offer (optional)</label>
                <input style={I} name="offer" placeholder="e.g. 20% off this week" />
              </div>
              <button type="submit" style={BTN}>Generate 4:5 concept</button>
            </form>
          </section>

          <section style={{ ...card, padding: "18px 20px", flex: "1 1 320px" }}>
            <div style={{ ...eyebrow, marginBottom: 10 }}>Generate ad copy</div>
            {campaignChoices.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--fg3)" }}>No active campaigns yet — copy generation needs an existing campaign to attach to.</div>
            ) : (
              <form action="/api/ops/ad-copy" method="get">
                <input type="hidden" name="action" value="generate" />
                <input type="hidden" name="client" value={params.id} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={L}>Campaign</label>
                    <select style={I} name="campaign_ref" required defaultValue="">
                      <option value="" disabled>Choose…</option>
                      {campaignChoices.map((c) => (
                        <option key={c.id} value={c.id}>{c.campaign_name ?? c.campaign_id} ({PLATFORM_LABEL[c.platform] ?? c.platform})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={L}>Persona (optional)</label>
                    <select style={I} name="persona_id" defaultValue="">
                      <option value="">(none)</option>
                      {personaChoices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={L}>Offer (optional)</label>
                  <input style={I} name="offer" placeholder="e.g. 20% off this week" />
                </div>
                <button type="submit" style={BTN}>Generate copy</button>
                <div style={{ fontSize: 11, color: "var(--fg3)", marginTop: 8 }}>
                  Format (RSA / PMax / Feed) is chosen automatically from the campaign&apos;s platform and objective.
                </div>
              </form>
            )}
          </section>
        </div>

        {groups.size === 0 ? (
          <div style={{ fontSize: 13, color: "var(--fg3)" }}>No creative generated yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {Array.from(groups.entries()).map(([groupId, items]) => {
              const primary = items.find((i) => i.aspect_ratio === "4:5") ?? items[0];
              return (
                <section key={groupId} style={{ ...card, padding: "18px 20px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={eyebrow}>Concept</div>
                    <div style={{ fontSize: 11.5, color: "var(--fg3)" }}>{new Date(primary.created_at).toLocaleDateString()}</div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                    {items.map((c) => (
                      <div key={c.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 6 }}>
                          <span style={{ fontWeight: 700 }}>{c.aspect_ratio}</span>
                          <span style={{ color: STATUS_COLOR[c.status] ?? "var(--fg3)", fontWeight: 600 }}>{c.status}</span>
                        </div>
                        {c.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.image_url} alt={`${c.aspect_ratio} ad creative`} style={{ width: "100%", borderRadius: 6, display: "block" }} />
                        ) : (
                          <div style={{ height: 90, background: "var(--bg)", borderRadius: 6, fontSize: 11.5, color: "var(--fg3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {c.status === "generating" ? "Generating…" : "No image"}
                          </div>
                        )}
                        {c.aspect_ratio === "4:5" && c.status === "completed" && (
                          <a href={`/api/ops/ad-creative?action=approve&id=${c.id}`} style={{ ...linkBtn, marginTop: 8, width: "100%", textAlign: "center", boxSizing: "border-box" }}>
                            Approve &amp; generate 1:1 / 9:16
                          </a>
                        )}
                        {c.status === "generating" && (
                          <a href={`/api/ops/ad-creative?action=check&id=${c.id}`} style={{ ...linkBtn, marginTop: 8, width: "100%", textAlign: "center", boxSizing: "border-box" }}>
                            Check status
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        <section style={{ marginTop: 28 }}>
          <div style={{ ...eyebrow, marginBottom: 12 }}>Ad copy</div>
          {copyRows.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--fg3)" }}>
              No ad copy generated yet. Generate a new campaign via <code>/api/ops/stage-ad-action?action=create_campaign</code> to get creative and copy together, or a copy-only pass is a follow-up action.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {copyRows.map((c) => {
                const imageUrl = imageFor(c.campaign_id);
                return (
                  <div key={c.id} style={{ ...card, padding: "18px 20px" }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        {PLATFORM_LABEL[c.platform] ?? c.platform} · {FORMAT_LABEL[c.format] ?? c.format}
                      </div>
                      <span style={{ fontSize: 11.5, color: c.status === "approved" ? "var(--tm-green-deep)" : "var(--fg3)", fontWeight: 600 }}>
                        {c.status}
                      </span>
                    </div>

                    {(c.format === "rsa") && (
                      <SearchAdPreview
                        brand={c.platform === "microsoft" ? "microsoft" : "google"}
                        domain={client.domain}
                        headlines={texts(c.headlines)}
                        descriptions={texts(c.descriptions)}
                      />
                    )}
                    {c.format === "pmax" && (
                      <PerformanceMaxPreview
                        domain={client.domain}
                        headline={texts(c.headlines)[0] ?? null}
                        longHeadline={texts(c.long_headlines)[0] ?? null}
                        businessName={c.business_name}
                        descriptions={texts(c.descriptions)}
                        imageUrl={imageUrl}
                      />
                    )}
                    {c.format === "meta_feed" && (
                      <MetaFeedPreview
                        businessName={client.name}
                        primaryText={texts(c.primary_texts)[0] ?? null}
                        headline={texts(c.headlines)[0] ?? null}
                        description={texts(c.descriptions)[0] ?? null}
                        imageUrl={imageUrl}
                      />
                    )}

                    <details style={{ marginTop: 12 }}>
                      <summary style={{ fontSize: 12.5, color: "var(--fg3)", cursor: "pointer" }}>
                        All generated variants ({(c.headlines?.length ?? 0) + (c.long_headlines?.length ?? 0) + (c.descriptions?.length ?? 0) + (c.primary_texts?.length ?? 0)})
                      </summary>
                      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5 }}>
                        {(["primary_texts", "headlines", "long_headlines", "descriptions"] as const).map((field) =>
                          (c[field]?.length ?? 0) > 0 ? (
                            <div key={field}>
                              <div style={{ color: "var(--fg3)", fontWeight: 700, textTransform: "uppercase", fontSize: 10.5, letterSpacing: "0.08em", marginBottom: 4 }}>
                                {field.replace("_", " ")}
                              </div>
                              {(c[field] ?? []).map((t, i) => (
                                <div key={i} style={{ color: t.overLimit ? "#B8433D" : "var(--fg2)", display: "flex", justifyContent: "space-between", gap: 8 }}>
                                  <span>{t.text}</span>
                                  <span style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{t.chars}{t.overLimit ? " ⚠" : ""}</span>
                                </div>
                              ))}
                            </div>
                          ) : null
                        )}
                      </div>
                    </details>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section style={{ marginTop: 28 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={eyebrow}>Live ad performance</div>
            <div style={{ fontSize: 11.5, color: "var(--fg3)" }}>
              Per individual ad — Meta, Google Ads, and Microsoft. One ad usually runs one creative;
              Dynamic Creative ads testing multiple variants inside one ad aren&apos;t split out yet.
            </div>
          </div>
          {adRollups.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--fg3)" }}>
              No ad-level performance data yet. Populates automatically once the daily collector has run against a connected account.
            </div>
          ) : (
            <div style={{ ...card, padding: "16px 20px", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                    {["Ad ID", "Platform", "Campaign(s)", "Day-prior ROAS", "7-day ROAS", "30-day ROAS", "30-day CTR", "30-day spend"].map((h) => (
                      <th key={h} style={{ ...eyebrow, fontWeight: 700, padding: "6px 10px 8px", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {adRollups.map((r) => (
                    <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 600, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{r.adId}</td>
                      <td style={{ padding: "8px 10px", color: "var(--fg2)" }}>{PLATFORM_LABEL[r.platform] ?? r.platform}</td>
                      <td style={{ padding: "8px 10px", color: "var(--fg2)" }}>{r.campaignNames.join(", ") || "—"}</td>
                      <td style={{ padding: "8px 10px" }}>{r.dayPriorRoas != null ? r.dayPriorRoas.toFixed(2) + "×" : "–"}</td>
                      <td style={{ padding: "8px 10px" }}>{r.sevenDayRoas != null ? r.sevenDayRoas.toFixed(2) + "×" : "–"}</td>
                      <td style={{ padding: "8px 10px" }}>{r.thirtyDayRoas != null ? r.thirtyDayRoas.toFixed(2) + "×" : "–"}</td>
                      <td style={{ padding: "8px 10px" }}>{r.thirtyDayCtr != null ? r.thirtyDayCtr.toFixed(2) + "%" : "–"}</td>
                      <td style={{ padding: "8px 10px", color: "var(--fg2)" }}>${r.thirtyDaySpend.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
