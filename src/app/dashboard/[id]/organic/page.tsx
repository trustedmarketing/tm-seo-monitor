import Link from "next/link";
import { METRIC_INFO } from "@/lib/metricInfo";
import { userClient } from "@/lib/supabaseServer";
import { Info, InfoStyles } from "@/components/Info";
import { getProfile, isAgency } from "@/lib/supabaseServer";
import { RecActions, ChangeLogger } from "@/components/Tracking";
import { ChannelNav } from "@/components/ChannelNav";
import "@/styles/tm-tokens.css";
import { fmtDate } from "@/lib/time";

export const dynamic = "force-dynamic";

type Snap = {
  captured_at: string;
  organic_traffic: number | null; organic_keywords: number | null;
  backlinks: number | null; site_health: number | null;
  visibility: number | null; ai_visibility: number | null;
};
type Ranking = { keyword_id: string; position: number | null; url: string | null; checked_at: string };
type Kw = { id: string; keyword: string };
type GscDay = { date: string; clicks: number; impressions: number; position: number | null };
type TrackedPrompt = { id: string; prompt: string };
type PromptResult = { prompt_id: string; mentioned: boolean; cited: boolean; checked_at: string };

const RANGES: { key: string; label: string }[] = [
  { key: "30d", label: "Last 30" },
  { key: "60d", label: "Last 60" },
  { key: "90d", label: "Last 90" },
  { key: "365d", label: "Last 365" },
  { key: "mtd", label: "Month to date" },
  { key: "last-month", label: "Last month" },
];

function iso(d: Date): string { return d.toISOString().slice(0, 10); }

function rangeBounds(range: string, from?: string, to?: string): { start: Date; end: Date; label: string } {
  const end = new Date(); end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  if (range === "custom" && from && to) {
    return { start: new Date(from), end: new Date(to), label: `${from} → ${to}` };
  }
  if (range === "mtd") { start.setDate(1); return { start, end, label: "Month to date" }; }
  if (range === "last-month") {
    const s = new Date(end.getFullYear(), end.getMonth() - 1, 1);
    const e = new Date(end.getFullYear(), end.getMonth(), 0);
    return { start: s, end: e, label: "Last month" };
  }
  const days = parseInt(range) || 30;
  start.setDate(start.getDate() - days);
  return { start, end, label: `Last ${days} days` };
}

function fmt(n: number | null): string {
  if (n == null) return "–";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}
function d(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null) return null;
  return Math.round((cur - prev) * 100) / 100;
}
function pct(cur: number, prev: number): string | null {
  if (prev === 0) return null;
  const p = ((cur - prev) / prev) * 100;
  return `${p > 0 ? "+" : ""}${p.toFixed(1)}%`;
}
function dateShort(s: string): string {
  return fmtDate(s);
}

function Delta({ value, suffix = "" }: { value: number | null; suffix?: string }) {
  if (value == null || value === 0) return <span style={{ fontSize: 12, color: "var(--fg3)" }}>–</span>;
  const good = value > 0;
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color: good ? "var(--success)" : "var(--danger)" }}>
      {value > 0 ? "+" : ""}{Number.isInteger(value) ? value : value.toFixed(2)}{suffix}
    </span>
  );
}

function Metric({ label, value, delta }: { label: string; value: string; delta: number | null }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg2)", display: "flex", alignItems: "center" }}>
        {label}
        <Info text={METRIC_INFO[label] ?? ""} />
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 44, lineHeight: 1.1, letterSpacing: "-0.02em", margin: "6px 0 2px" }}>{value}</div>
      <Delta value={delta} />
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em",
  textTransform: "uppercase", color: "var(--fg2)", padding: "10px 12px",
  borderBottom: "1px solid var(--border)",
};
const td: React.CSSProperties = {
  fontSize: 14, padding: "10px 12px", borderBottom: "1px solid var(--border)",
};
const card: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)",
};
const eyebrow: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase",
  color: "var(--fg2)", display: "flex", alignItems: "center",
};

export default async function ClientDetail({
  params, searchParams,
}: {
  params: { id: string };
  searchParams: { range?: string; from?: string; to?: string };
}) {
  const range = searchParams.range ?? "30d";
  const { start, end, label } = rangeBounds(range, searchParams.from, searchParams.to);
  const periodDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  const prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - periodDays);
  const prevEnd = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1);

  const profile = await getProfile();
  const isAdmin = isAgency(profile);
  const db = userClient();

  const [{ data: client }, { data: snaps }, { data: kws }, { data: ranks }, { data: gscCur }, { data: gscPrev }, { data: tprompts }, { data: presults }, { data: recRows }, { data: changeRows }] = await Promise.all([
    db.from("clients").select("*").eq("id", params.id).single(),
    db.from("metric_snapshots").select("*").eq("client_id", params.id)
      .gte("captured_at", start.toISOString())
      .order("captured_at", { ascending: false }).limit(120),
    db.from("tracked_keywords").select("id, keyword").eq("client_id", params.id).eq("active", true).order("keyword"),
    db.from("keyword_rankings").select("keyword_id, position, url, checked_at").eq("client_id", params.id)
      .order("checked_at", { ascending: false }).limit(400),
    db.from("gsc_history").select("date, clicks, impressions, position").eq("client_id", params.id)
      .gte("date", iso(start)).lte("date", iso(end)),
    db.from("gsc_history").select("date, clicks, impressions, position").eq("client_id", params.id)
      .gte("date", iso(prevStart)).lte("date", iso(prevEnd)),
    db.from("tracked_prompts").select("id, prompt").eq("client_id", params.id).eq("active", true).order("prompt"),
    db.from("prompt_results").select("prompt_id, mentioned, cited, checked_at").eq("client_id", params.id)
      .order("checked_at", { ascending: false }).limit(200),
    db.from("recommendations").select("*").eq("client_id", params.id)
      .not("status", "in", "(dismissed,resolved)").order("created_at"),
    db.from("changes").select("*").eq("client_id", params.id)
      .order("changed_at", { ascending: false }).limit(50),
  ]);

  if (!client) {
    return (
      <main style={{ padding: "40px 32px 64px" }}>
        Client not found. <Link href="/dashboard">Back to portfolio</Link>
      </main>
    );
  }

  const snapshots = (snaps ?? []) as Snap[];
  const [cur, prev] = snapshots;

  const sum = (rows: GscDay[] | null, f: "clicks" | "impressions") =>
    (rows ?? []).reduce((s, r) => s + (r[f] ?? 0), 0);
  const gClicks = sum(gscCur as GscDay[], "clicks");
  const gImpr = sum(gscCur as GscDay[], "impressions");
  const gClicksPrev = sum(gscPrev as GscDay[], "clicks");
  const gImprPrev = sum(gscPrev as GscDay[], "impressions");
  const hasGsc = (gscCur ?? []).length > 0;

  const byKw = new Map<string, Ranking[]>();
  for (const r of (ranks ?? []) as Ranking[]) {
    const list = byKw.get(r.keyword_id) ?? [];
    if (list.length < 2) { list.push(r); byKw.set(r.keyword_id, list); }
  }
  const kwRows = ((kws ?? []) as Kw[]).map((k) => {
    const [rCur, rPrev] = byKw.get(k.id) ?? [];
    const posDelta =
      rCur?.position != null && rPrev?.position != null ? rPrev.position - rCur.position : null;
    return { ...k, position: rCur?.position ?? null, url: rCur?.url ?? null, posDelta };
  }).sort((a, b) => (a.position ?? 999) - (b.position ?? 999));

  const latestResult = new Map<string, PromptResult>();
  for (const r of (presults ?? []) as PromptResult[]) {
    if (!latestResult.has(r.prompt_id)) latestResult.set(r.prompt_id, r);
  }
  const promptRows = ((tprompts ?? []) as TrackedPrompt[]).map((tp) => {
    const r = latestResult.get(tp.id);
    return {
      id: tp.id, prompt: tp.prompt,
      mentioned: r ? r.mentioned : null,
      cited: r ? r.cited : null,
      checkedAt: r?.checked_at ?? null,
    };
  });

  const sevOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const recs = ((recRows ?? []) as any[]).sort((a, b) =>
    (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3)
  );
  const sevStyle: Record<string, React.CSSProperties> = {
    high:   { background: "#FBE7E4", color: "#A33023" },
    medium: { background: "#FFF6DB", color: "#8C6500" },
    low:    { background: "#E5F4EA", color: "#2F8F4E" },
  };
  const statusStyle: Record<string, { label: string; style: React.CSSProperties }> = {
    approved:  { label: "Approved",  style: { background: "var(--tm-deep-charcoal)", color: "var(--tm-performance-green)" } },
    measuring: { label: "Measuring", style: { background: "#E8F0FE", color: "#1A56DB" } },
    validated: { label: "Validated ✓", style: { background: "#E5F4EA", color: "#2F8F4E" } },
    no_effect: { label: "No effect", style: { background: "var(--tm-stone-200)", color: "var(--fg2)" } },
  };
  const changes = (changeRows ?? []) as any[];
  const verdictStyle: Record<string, React.CSSProperties> = {
    improved: { background: "#E5F4EA", color: "#2F8F4E" },
    declined: { background: "#FBE7E4", color: "#A33023" },
    flat: { background: "var(--tm-stone-200)", color: "var(--fg2)" },
    inconclusive: { background: "#FFF6DB", color: "#8C6500" },
  };

  const rangeHref = (key: string) => `/dashboard/${params.id}/organic?range=${key}`;

  return (
    <main style={{ padding: "40px 32px 64px" }}>
      <InfoStyles />
      <div style={{ maxWidth: 1180 }}>
        <Link href="/dashboard" style={{ fontSize: 13, fontWeight: 600, color: "var(--fg2)", textDecoration: "none" }}>
          ← Portfolio
        </Link>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, margin: "14px 0 4px", flexWrap: "wrap" }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 48, letterSpacing: "-0.01em", margin: 0 }}>
            {client.name}
          </h1>
          <a href={`https://${client.domain}`} style={{ fontSize: 14, color: "var(--fg3)", textDecoration: "none" }}>{client.domain}</a>
          {client.tier && (
            <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: "var(--radius-pill)", background: "var(--tm-deep-charcoal)", color: "var(--tm-performance-green)" }}>{client.tier}</span>
          )}
        </div>
        <div style={{ fontSize: 13, color: "var(--fg3)", marginBottom: 24 }}>
          {cur ? `Last collected ${dateShort(cur.captured_at)}` : "No data collected yet"}
        </div>

        <ChannelNav clientId={params.id} active="organic" clientType={(client as any)?.client_type ?? null} />

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
          {RANGES.map((r) => {
            const active = range === r.key;
            return (
              <Link key={r.key} href={rangeHref(r.key)} style={{
                fontSize: 13, fontWeight: 600, padding: "7px 14px",
                borderRadius: "var(--radius-pill)", textDecoration: "none",
                background: active ? "var(--tm-deep-charcoal)" : "transparent",
                color: active ? "var(--tm-performance-green)" : "var(--fg1)",
                border: active ? "1px solid transparent" : "1px solid var(--border-strong)",
              }}>{r.label}</Link>
            );
          })}
          <form method="get" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
            <input type="hidden" name="range" value="custom" />
            <input type="date" name="from" defaultValue={range === "custom" ? searchParams.from : ""} style={{ fontFamily: "var(--font-body)", fontSize: 13, padding: "6px 8px", border: "1px solid var(--border-strong)", borderRadius: 8, background: "#fff" }} />
            <span style={{ fontSize: 12, color: "var(--fg3)" }}>to</span>
            <input type="date" name="to" defaultValue={range === "custom" ? searchParams.to : ""} style={{ fontFamily: "var(--font-body)", fontSize: 13, padding: "6px 8px", border: "1px solid var(--border-strong)", borderRadius: 8, background: "#fff" }} />
            <button type="submit" style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 600, padding: "7px 14px", borderRadius: "var(--radius-pill)", border: "1px solid var(--border-strong)", background: range === "custom" ? "var(--tm-deep-charcoal)" : "transparent", color: range === "custom" ? "var(--tm-performance-green)" : "var(--fg1)", cursor: "pointer" }}>
              Apply
            </button>
          </form>
        </div>

        <section style={{ ...card, padding: "20px 24px 24px", marginBottom: 24 }}>
          <div style={{ ...eyebrow, marginBottom: 14 }}>
            Search traffic — {label}
            <Info text="Actual clicks and impressions from Google Search Console for the selected date range, compared against the equal-length period before it. This is real measured traffic, not an estimate." />
          </div>
          {hasGsc ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 24 }}>
              <div>
                <div style={eyebrow}>Clicks</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 44, lineHeight: 1.1, margin: "6px 0 2px" }}>{fmt(gClicks)}</div>
                {pct(gClicks, gClicksPrev) && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: gClicks >= gClicksPrev ? "var(--success)" : "var(--danger)" }}>
                    {pct(gClicks, gClicksPrev)} vs previous {periodDays}d
                  </span>
                )}
              </div>
              <div>
                <div style={eyebrow}>Impressions</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 44, lineHeight: 1.1, margin: "6px 0 2px" }}>{fmt(gImpr)}</div>
                {pct(gImpr, gImprPrev) && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: gImpr >= gImprPrev ? "var(--success)" : "var(--danger)" }}>
                    {pct(gImpr, gImprPrev)} vs previous {periodDays}d
                  </span>
                )}
              </div>
              <div>
                <div style={eyebrow}>Avg CTR</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 44, lineHeight: 1.1, margin: "6px 0 2px" }}>
                  {gImpr > 0 ? `${((gClicks / gImpr) * 100).toFixed(1)}%` : "–"}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 14, color: "var(--fg3)", lineHeight: 1.55 }}>
              No Search Console data for this range yet. Connect the GSC service account and run
              "Backfill GSC history" in the admin to unlock real daily traffic here — up to 16 months
              back, so every range works immediately.
            </div>
          )}
        </section>

        <section style={{ ...card, padding: "20px 24px 24px", marginBottom: 24 }}>
          <div style={{ ...eyebrow, marginBottom: 14 }}>
            Latest snapshot
            <Info text="Point-in-time readings from the most recent collection. Organic traffic here is an estimated monthly rate as of that day — see the range section above for actual traffic over time." />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 24 }}>
            <Metric label="Site health" value={cur?.site_health != null ? `${Math.round(cur.site_health)}%` : "–"} delta={d(cur?.site_health ?? null, prev?.site_health ?? null)} />
            <Metric label="Visibility" value={cur?.visibility != null ? `${cur.visibility}%` : "–"} delta={d(cur?.visibility ?? null, prev?.visibility ?? null)} />
            <Metric label="Organic traffic" value={fmt(cur?.organic_traffic ?? null)} delta={d(cur?.organic_traffic ?? null, prev?.organic_traffic ?? null)} />
            <Metric label="Organic keywords" value={fmt(cur?.organic_keywords ?? null)} delta={d(cur?.organic_keywords ?? null, prev?.organic_keywords ?? null)} />
            <Metric label="Backlinks" value={fmt(cur?.backlinks ?? null)} delta={d(cur?.backlinks ?? null, prev?.backlinks ?? null)} />
            <Metric label="AI visibility" value={cur?.ai_visibility != null ? `${cur.ai_visibility}%` : "–"} delta={null} />
          </div>
        </section>

        {recs.length > 0 && (
          <section style={{ ...card, padding: "20px 24px 24px", marginBottom: 24 }}>
            <div style={{ ...eyebrow, marginBottom: 14 }}>
              Recommendations
              <Info text="Generated from this client's current data: rankings, AI answer checks, site health, and link profile. Ordered by impact." />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {recs.map((r) => (
                <div key={r.id} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap", ...sevStyle[r.severity] }}>
                    {r.severity}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {r.title}
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg3)", marginLeft: 10 }}>{r.category}</span>
                      {statusStyle[r.status] && (
                        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", padding: "3px 10px", borderRadius: 999, marginLeft: 10, ...statusStyle[r.status].style }}>
                          {statusStyle[r.status].label}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--fg2)", lineHeight: 1.5, marginTop: 2 }}>{r.detail}</div>
                    {isAdmin && (
                      <RecActions recId={r.id} clientId={client.id} status={r.status}
                        keywords={kwRows.filter((k) => k.position != null && k.position >= 4 && k.position <= 15).map((k) => k.keyword)} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section style={{ ...card, padding: "20px 24px 16px", marginBottom: 24 }}>
          <div style={{ ...eyebrow, marginBottom: 8, alignItems: "center", gap: 12, display: "flex" }}>
            Change log ({changes.length})
            <Info text="Work shipped for this client, with impact measured automatically: 28 days of real search data before each change vs 28 days after. Verdicts appear once the post-change window completes." />
            {isAdmin && <span style={{ marginLeft: "auto", textTransform: "none", letterSpacing: 0 }}><ChangeLogger clientId={client.id} /></span>}
          </div>
          {changes.length === 0 ? (
            <div style={{ fontSize: 14, color: "var(--fg3)", padding: "6px 0 10px" }}>
              No changes logged yet. Mark a recommendation shipped, or log work directly — every change starts a 28-day before/after measurement.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>Date</th><th style={th}>Change</th><th style={th}>Impact</th><th style={th}>Detail</th>
              </tr></thead>
              <tbody>
                {changes.map((ch) => {
                  const daysLeft = Math.max(0, 28 - Math.floor((Date.now() - new Date(ch.changed_at).getTime()) / 86_400_000));
                  const m = ch.metrics ?? {};
                  return (
                    <tr key={ch.id}>
                      <td style={{ ...td, fontWeight: 600, whiteSpace: "nowrap" }}>{dateShort(ch.changed_at)}</td>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{ch.title}</div>
                        {ch.description && <div style={{ fontSize: 12, color: "var(--fg3)" }}>{ch.description}</div>}
                      </td>
                      <td style={td}>
                        {ch.verdict ? (
                          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", padding: "3px 10px", borderRadius: 999, ...verdictStyle[ch.verdict] }}>
                            {ch.verdict}
                          </span>
                        ) : (
                          <span style={{ fontSize: 12, color: "var(--fg3)" }}>Measuring — {daysLeft}d left</span>
                        )}
                      </td>
                      <td style={{ ...td, fontSize: 12, color: "var(--fg2)" }}>
                        {ch.verdict ? (
                          <>
                            {m.clicks_before != null && <>Clicks {m.clicks_before} → {m.clicks_after}{m.clicks_pct != null ? ` (${m.clicks_pct > 0 ? "+" : ""}${m.clicks_pct}%)` : ""}. </>}
                            {m.avg_position_before != null && <>Avg position {m.avg_position_before} → {m.avg_position_after}.</>}
                            {m.clicks_before == null && m.avg_position_before == null && "Not enough data in the window."}
                          </>
                        ) : "–"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section style={{ ...card, padding: "20px 24px 8px", marginBottom: 24 }}>
          <div style={{ ...eyebrow, marginBottom: 8 }}>
            AI answer visibility ({promptRows.length} prompts)
            <Info text="Each prompt is asked to an AI assistant on the rank-tracking schedule. Cited = the client's site is linked as a source. Mentioned = the brand appears in the answer. Not found = invisible for that question." />
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Prompt</th>
                <th style={th}>Result</th>
                <th style={th}>Last checked</th>
              </tr>
            </thead>
            <tbody>
              {promptRows.map((p) => (
                <tr key={p.id}>
                  <td style={{ ...td, fontWeight: 600 }}>{p.prompt}</td>
                  <td style={td}>
                    {p.mentioned == null ? (
                      <span style={{ fontSize: 12, color: "var(--fg3)" }}>Not checked yet</span>
                    ) : p.cited ? (
                      <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: "var(--tm-deep-charcoal)", color: "var(--tm-performance-green)" }}>Cited</span>
                    ) : p.mentioned ? (
                      <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: "#E5F4EA", color: "#2F8F4E" }}>Mentioned</span>
                    ) : (
                      <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: "#FBE7E4", color: "#A33023" }}>Not found</span>
                    )}
                  </td>
                  <td style={{ ...td, fontSize: 13, color: "var(--fg3)" }}>
                    {p.checkedAt ? dateShort(p.checkedAt) : "–"}
                  </td>
                </tr>
              ))}
              {promptRows.length === 0 && (
                <tr><td style={td} colSpan={3}>No AI prompts tracked yet — add them in the admin to start measuring AI answer visibility.</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section style={{ ...card, padding: "20px 24px 8px", marginBottom: 24 }}>
          <div style={{ ...eyebrow, marginBottom: 8 }}>
            Tracked keywords ({kwRows.length})
            <Info text="This client's tracked search terms and where they currently rank in Google. Position 1 is the top result; '–' means not in the top 100 yet. Change compares to the previous check." />
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Keyword</th>
                <th style={th}>Position</th>
                <th style={th}>Change</th>
                <th style={th}>Ranking page</th>
              </tr>
            </thead>
            <tbody>
              {kwRows.map((k) => (
                <tr key={k.id}>
                  <td style={{ ...td, fontWeight: 600 }}>{k.keyword}</td>
                  <td style={{ ...td, fontFamily: "var(--font-display)", fontSize: 20 }}>{k.position ?? "–"}</td>
                  <td style={td}><Delta value={k.posDelta} /></td>
                  <td style={{ ...td, fontSize: 13, color: "var(--fg3)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {k.url ? k.url.replace(/^https?:\/\/[^/]+/, "") || "/" : "–"}
                  </td>
                </tr>
              ))}
              {kwRows.length === 0 && (
                <tr><td style={td} colSpan={4}>No keywords tracked yet — add them in the admin.</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section style={{ ...card, padding: "20px 24px 8px" }}>
          <div style={{ ...eyebrow, marginBottom: 8 }}>
            Collection history — {label}
            <Info text="Every data collection inside the selected range, newest first. This is how the estimated metrics trend over time. Site health and visibility only appear on runs where those checks were due." />
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Date</th>
                <th style={th}>Visibility</th>
                <th style={th}>Est. traffic /mo</th>
                <th style={th}>Keywords</th>
                <th style={th}>Backlinks</th>
                <th style={th}>Site health</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.captured_at}>
                  <td style={{ ...td, fontWeight: 600 }}>{dateShort(s.captured_at)}</td>
                  <td style={td}>{s.visibility != null ? `${s.visibility}%` : "–"}</td>
                  <td style={td}>{fmt(s.organic_traffic)}</td>
                  <td style={td}>{fmt(s.organic_keywords)}</td>
                  <td style={td}>{fmt(s.backlinks)}</td>
                  <td style={td}>{s.site_health != null ? `${Math.round(s.site_health)}%` : "–"}</td>
                </tr>
              ))}
              {snapshots.length === 0 && (
                <tr><td style={td} colSpan={6}>No collections in this range.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
