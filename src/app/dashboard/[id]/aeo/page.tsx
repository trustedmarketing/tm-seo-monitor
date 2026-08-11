// app/dashboard/[id]/aeo/page.tsx — AI answer visibility.
//
// WO-003. "When someone asks AI about you, are you cited, mentioned, or absent?"
// The plan calls this the section clients find most novel and says to lead with
// it in QBRs — which is exactly why the agency view has to come first and be
// scrutinised before anything reaches a client.
//
// Live example of why: Salty Dog reads 0% across 121 checks. That is either a
// real finding worth acting on or a false negative in detection, and nobody
// could tell without seeing the prompts themselves. This page is what makes that
// answerable — it shows every prompt and its history rather than one headline
// percentage.
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabaseServer";
import { ClientHeader } from "@/components/ClientHeader";
import { workspaceTabs, type ClientType } from "@/lib/workspaceTabs";
import { AEO_PROVIDERS, enabledProviders } from "@/lib/aeoProviders";
import "@/styles/tm-tokens.css";
import { fmtDate, fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

type Prompt = { id: string; prompt: string; active: boolean };
type Result = {
  prompt_id: string; mentioned: boolean | null; cited: boolean | null;
  checked_at: string; provider: string | null;
};
/** Latest AI Overview state per tracked keyword, from the SERP call we already buy. */
type AiOverviewRow = { keyword_id: string; ai_overview: boolean | null; ai_overview_cited: boolean | null; checked_at: string };
type Keyword = { id: string; keyword: string };

type Status = "cited" | "mentioned" | "absent" | "unchecked";

const STATUS_STYLE: Record<Status, { fg: string; bg: string; edge: string; label: string }> = {
  cited:     { fg: "#2F8F4E", bg: "#E5FFB8", edge: "#C7E89A", label: "Cited" },
  mentioned: { fg: "#8C6500", bg: "#FFF9EC", edge: "#EAD9A6", label: "Mentioned" },
  absent:    { fg: "var(--fg2)", bg: "var(--bg)", edge: "var(--border)", label: "Not showing" },
  unchecked: { fg: "var(--fg3)", bg: "transparent", edge: "var(--border)", label: "Not checked yet" },
};

/**
 * Cited beats mentioned beats absent.
 *
 * They are genuinely different outcomes: cited means the answer linked to the
 * client, mentioned means it named them without a link. Collapsing the two would
 * hide the more valuable one.
 */
function statusOf(r: Result | undefined): Status {
  if (!r) return "unchecked";
  if (r.cited) return "cited";
  if (r.mentioned) return "mentioned";
  return "absent";
}

export default async function Aeo({ params }: { params: { id: string } }) {
  const db = userClient();
  const { data: client } = await db
    .from("clients").select("id, name, domain, tier, client_type, aeo_providers").eq("id", params.id).single();
  if (!client) redirect("/dashboard");

  const type = ((client as { client_type?: string }).client_type ?? null) as ClientType;
  if (!workspaceTabs(type).some((t) => t.key === "aeo")) redirect(`/dashboard/${params.id}`);

  const providers = enabledProviders((client as { aeo_providers?: unknown }).aeo_providers);
  const baseline = providers[0];

  const [{ data: promptRows }, { data: resultRows }, { count: pending }, { data: kwRows }, { data: rankRows }] =
    await Promise.all([
      db.from("tracked_prompts").select("id, prompt, active").eq("client_id", params.id).order("prompt"),
      db.from("prompt_results").select("prompt_id, mentioned, cited, checked_at, provider")
        .eq("client_id", params.id).order("checked_at", { ascending: false }).limit(3000),
      db.from("approvals").select("id", { count: "exact", head: true })
        .eq("client_id", params.id).in("status", ["staged", "failed"]),
      db.from("tracked_keywords").select("id, keyword").eq("client_id", params.id).eq("active", true),
      // Google AI Overview rides the SERP call already bought for rankings.
      db.from("keyword_rankings").select("keyword_id, ai_overview, ai_overview_cited, checked_at")
        .eq("client_id", params.id).order("checked_at", { ascending: false }).limit(2000),
    ]);

  const prompts = (promptRows ?? []) as Prompt[];
  const results = (resultRows ?? []) as Result[];

  // Latest result per (prompt, PROVIDER) — with more than one assistant,
  // "latest per prompt" would show whichever provider happened to run last and
  // silently hide the others.
  const key = (promptId: string, provider: string | null) => `${promptId}:${provider ?? baseline.key}`;
  const latest = new Map<string, Result>();
  const history = new Map<string, Result[]>();
  for (const r of results) {
    const k = key(r.prompt_id, r.provider);
    if (!latest.has(k)) latest.set(k, r);
    const h = history.get(k) ?? [];
    if (h.length < 12) h.push(r);
    history.set(k, h);
  }

  const rows = prompts
    .map((p) => {
      const perProvider = providers.map((pr) => ({
        provider: pr,
        status: statusOf(latest.get(key(p.id, pr.key))),
      }));
      // Sorted and counted on the baseline provider, so the ordering and the
      // headline stay comparable with every figure collected before today.
      const status = statusOf(latest.get(key(p.id, baseline.key)));
      return { p, status, perProvider, hist: (history.get(key(p.id, baseline.key)) ?? []).slice().reverse() };
    })
    // Cited first: the wins are what a QBR leads with.
    .sort((a, b) => {
      const order: Status[] = ["cited", "mentioned", "absent", "unchecked"];
      return order.indexOf(a.status) - order.indexOf(b.status);
    });

  const counts = rows.reduce<Record<Status, number>>(
    (acc, r) => ({ ...acc, [r.status]: acc[r.status] + 1 }),
    { cited: 0, mentioned: 0, absent: 0, unchecked: 0 }
  );
  const checked = counts.cited + counts.mentioned + counts.absent;
  const visible = counts.cited + counts.mentioned;
  const lastCheck = results[0]?.checked_at;

  // Per-provider headline, so "absent on ChatGPT, cited on Gemini" is visible
  // rather than averaged away.
  const providerTotals = providers.map((pr) => {
    const seen = prompts.map((p) => statusOf(latest.get(key(p.id, pr.key))));
    const done = seen.filter((s) => s !== "unchecked").length;
    const vis = seen.filter((s) => s === "cited" || s === "mentioned").length;
    return { provider: pr, checked: done, visible: vis, cited: seen.filter((s) => s === "cited").length };
  });

  // ── Google AI Overview, per tracked keyword ────────────────────────────────
  const keywords = (kwRows ?? []) as Keyword[];
  const latestRank = new Map<string, AiOverviewRow>();
  for (const r of (rankRows ?? []) as AiOverviewRow[]) {
    if (!latestRank.has(r.keyword_id)) latestRank.set(r.keyword_id, r);
  }
  // Only rows collected since the AI Overview columns started being written
  // know the answer; older rows are null and must not be counted as "no
  // overview", which would understate coverage.
  const aioRows = keywords
    .map((k) => ({ k, r: latestRank.get(k.id) }))
    .filter((x) => x.r && x.r.ai_overview != null);
  const aioPresent = aioRows.filter((x) => x.r!.ai_overview).length;
  const aioCited = aioRows.filter((x) => x.r!.ai_overview_cited).length;

  return (
    <main style={{ padding: "40px 32px 64px" }}>
      <div style={{ maxWidth: 1180 }}>
        <ClientHeader
          id={params.id} name={client.name} domain={client.domain} tier={client.tier}
          clientType={type} active="aeo" pending={pending ?? 0}
          sub={lastCheck
            ? `Checked ${fmtDate(lastCheck)} · ${providers.map((p) => p.label).join(", ")}`
            : "No checks recorded yet"}
        />

        {/* The honest caveat stays — it just says something different now. The
            point was never "we only do ChatGPT", it was that this page must
            state exactly which assistants it asked, so a percentage is never
            read as a claim about AI visibility in general. */}
        {providers.length < AEO_PROVIDERS.length && (
          <div style={{
            background: "#FFF9EC", border: "1px solid #EAD9A6", borderRadius: 10,
            padding: "12px 16px", marginBottom: 24, fontSize: 13.5, color: "#8A6D1F", maxWidth: 860,
          }}>
            Prompts are checked against <strong>{providers.map((p) => p.label).join(" and ")}</strong> for
            this client.{" "}
            {AEO_PROVIDERS.filter((p) => !providers.some((e) => e.key === p.key)).map((p) => p.label).join(" and ")}{" "}
            {AEO_PROVIDERS.length - providers.length === 1 ? "is" : "are"} not enabled, so this is a partial
            picture — not a claim about AI visibility overall. Each assistant is a separately billed check;
            enable more per client in Settings.
          </div>
        )}

        {/* Google AI Overview — free to measure, so it is always on. It also
            answers a different question from the prompt checks: those ask an
            assistant directly, this is what Google puts above the results for
            keywords the client already tracks. */}
        {aioRows.length > 0 && (
          <section style={{
            background: "#fff", border: "1px solid var(--border)", borderRadius: 12,
            padding: "18px 22px", marginBottom: 24, maxWidth: 860,
          }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg3)" }}>
              Google AI Overview
            </div>
            <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginTop: 10 }}>
              <Stat label="Triggers an overview" value={`${aioPresent}`} sub={`of ${aioRows.length} tracked keywords`} />
              <Stat label="Cited as a source" value={`${aioCited}`} sub={aioPresent > 0 ? `of ${aioPresent} overviews` : "none shown yet"} accent={aioCited > 0} />
            </div>
            {aioPresent > aioCited && (
              <div style={{ fontSize: 13, color: "#8A6D1F", marginTop: 12, lineHeight: 1.6 }}>
                ⚑ Google answers {aioPresent - aioCited} of these queries with AI and sources someone else.
                That is a different problem from not appearing at all — the answer is being given, just not
                from this site.
              </div>
            )}
          </section>
        )}

        {checked === 0 ? (
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "32px 28px", maxWidth: 700 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 26, marginBottom: 8 }}>No checks yet</div>
            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--fg2)", margin: 0 }}>
              {prompts.length === 0
                ? "No prompts are tracked for this client. Add customer-voice questions in /admin — the ones buyers actually ask."
                : `${prompts.length} prompts are tracked but none has been checked yet.`}
            </p>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginBottom: 26 }}>
              <Stat label={`Showing up · ${baseline.label}`} value={`${Math.round((visible / checked) * 100)}%`}
                    sub={`${visible} of ${checked} prompts`} accent={visible > 0} />
              <Stat label="Cited" value={String(counts.cited)} sub="answer linked to them" />
              <Stat label="Mentioned" value={String(counts.mentioned)} sub="named, not linked" />
              <Stat label="Not showing" value={String(counts.absent)} sub="no reference at all" />
            </div>

            {/* Per-assistant, side by side. The headline stays on the baseline
                provider so it remains comparable with the history already
                collected — averaging across models would change what the number
                means and show clients a jump that was a definition change. */}
            {providers.length > 1 && (
              <div style={{
                display: "flex", gap: 0, flexWrap: "wrap", marginBottom: 26,
                background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden",
              }}>
                {providerTotals.map((t, i) => (
                  <div key={t.provider.key} style={{
                    flex: "1 1 180px", padding: "16px 20px",
                    borderLeft: i === 0 ? "none" : "1px solid var(--border)",
                  }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t.provider.label}</div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 30, margin: "4px 0 2px", color: t.visible > 0 ? "var(--tm-green-deep)" : "var(--fg1)" }}>
                      {t.checked > 0 ? `${Math.round((t.visible / t.checked) * 100)}%` : "–"}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--fg3)" }}>
                      {t.checked > 0 ? `${t.visible} of ${t.checked} · ${t.cited} cited` : "not checked yet"}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {visible === 0 && (
              // A flat zero across every prompt is unusual enough to be worth
              // doubting before it becomes a client-facing finding.
              <div style={{
                background: "#FBE7E4", border: "1px solid #EBC9C4", borderRadius: 10,
                padding: "14px 16px", marginBottom: 24, fontSize: 13.5, color: "var(--danger)", maxWidth: 860,
              }}>
                <strong>Zero visibility across every checked prompt.</strong> That is either a real gap worth
                acting on, or a false negative in detection. Spot-check one prompt manually in ChatGPT before
                this is treated as a finding or shown to the client.
              </div>
            )}

            <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
              {rows.map((r, i) => {
                return (
                  <div key={r.p.id} style={{
                    display: "flex", alignItems: "center", gap: 16, padding: "14px 20px",
                    borderTop: i === 0 ? "none" : "1px solid var(--border)", flexWrap: "wrap",
                  }}>
                    <div style={{ flex: 1, minWidth: 300 }}>
                      <div style={{ fontSize: 14.5, color: "var(--fg1)" }}>
                        &ldquo;{r.p.prompt}&rdquo;
                      </div>
                      {!r.p.active && (
                        <div style={{ fontSize: 12, color: "var(--fg3)", marginTop: 3 }}>Paused</div>
                      )}
                    </div>

                    {/* Sparkline of the last dozen checks — the trend matters more
                        than today's answer, which varies run to run. */}
                    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                      {r.hist.map((h, j) => {
                        const s = statusOf(h);
                        return (
                          <span key={j} title={fmtDateTime(h.checked_at)} style={{
                            width: 7, height: 14, borderRadius: 2,
                            background: s === "cited" ? "#2F8F4E" : s === "mentioned" ? "#D9A441" : "var(--border)",
                          }} />
                        );
                      })}
                    </div>

                    {/* One chip per assistant. A single collapsed status would
                        hide the most useful finding this page can produce:
                        absent on one model, cited on another. */}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {r.perProvider.map(({ provider, status }) => {
                        const st = STATUS_STYLE[status];
                        return (
                          <div key={provider.key} title={`${provider.label}: ${st.label}`} style={{
                            fontSize: 12, fontWeight: 600, padding: "5px 10px", borderRadius: 999,
                            background: st.bg, color: st.fg, border: `1px solid ${st.edge}`, whiteSpace: "nowrap",
                          }}>
                            {providers.length > 1 && (
                              <span style={{ opacity: 0.7, marginRight: 5 }}>{provider.label}</span>
                            )}
                            {st.label}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </main>
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
