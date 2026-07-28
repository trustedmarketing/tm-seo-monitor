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
import "@/styles/tm-tokens.css";
import { fmtDate, fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

type Prompt = { id: string; prompt: string; active: boolean };
type Result = { prompt_id: string; mentioned: boolean | null; cited: boolean | null; checked_at: string };

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
    .from("clients").select("id, name, domain, tier, client_type").eq("id", params.id).single();
  if (!client) redirect("/dashboard");

  const type = ((client as { client_type?: string }).client_type ?? null) as ClientType;
  if (!workspaceTabs(type).some((t) => t.key === "aeo")) redirect(`/dashboard/${params.id}`);

  const [{ data: promptRows }, { data: resultRows }, { count: pending }] = await Promise.all([
    db.from("tracked_prompts").select("id, prompt, active").eq("client_id", params.id).order("prompt"),
    db.from("prompt_results").select("prompt_id, mentioned, cited, checked_at")
      .eq("client_id", params.id).order("checked_at", { ascending: false }).limit(1000),
    db.from("approvals").select("id", { count: "exact", head: true })
      .eq("client_id", params.id).in("status", ["staged", "failed"]),
  ]);

  const prompts = (promptRows ?? []) as Prompt[];
  const results = (resultRows ?? []) as Result[];

  // Latest result per prompt, plus the full history for the trend.
  const latest = new Map<string, Result>();
  const history = new Map<string, Result[]>();
  for (const r of results) {
    if (!latest.has(r.prompt_id)) latest.set(r.prompt_id, r);
    const h = history.get(r.prompt_id) ?? [];
    if (h.length < 12) h.push(r);
    history.set(r.prompt_id, h);
  }

  const rows = prompts
    .map((p) => ({ p, status: statusOf(latest.get(p.id)), last: latest.get(p.id), hist: (history.get(p.id) ?? []).slice().reverse() }))
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

  return (
    <main style={{ padding: "40px 32px 64px" }}>
      <div style={{ maxWidth: 1180 }}>
        <ClientHeader
          id={params.id} name={client.name} domain={client.domain} tier={client.tier}
          clientType={type} active="aeo" pending={pending ?? 0}
          sub={lastCheck
            ? `Checked ${fmtDate(lastCheck)} · ChatGPT only`
            : "No checks recorded yet"}
        />

        {/* The honest caveat, on the agency view, before it can reach a client.
            The design's copy says prompts are checked against "ChatGPT, Gemini
            and AI Overviews". We check ChatGPT. Saying so here is cheaper than
            a client finding out. */}
        <div style={{
          background: "#FFF9EC", border: "1px solid #EAD9A6", borderRadius: 10,
          padding: "12px 16px", marginBottom: 24, fontSize: 13.5, color: "#8A6D1F", maxWidth: 860,
        }}>
          These checks cover <strong>ChatGPT only</strong>. Gemini and Google AI Overviews are not yet
          included, so this is a partial picture — not a claim about AI visibility overall.
        </div>

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
              <Stat label="Showing up" value={`${Math.round((visible / checked) * 100)}%`}
                    sub={`${visible} of ${checked} prompts`} accent={visible > 0} />
              <Stat label="Cited" value={String(counts.cited)} sub="answer linked to them" />
              <Stat label="Mentioned" value={String(counts.mentioned)} sub="named, not linked" />
              <Stat label="Not showing" value={String(counts.absent)} sub="no reference at all" />
            </div>

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
                const st = STATUS_STYLE[r.status];
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

                    <div style={{
                      fontSize: 12.5, fontWeight: 600, padding: "5px 11px", borderRadius: 999,
                      background: st.bg, color: st.fg, border: `1px solid ${st.edge}`, whiteSpace: "nowrap",
                    }}>{st.label}</div>
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
