// app/dashboard/[id]/changes/page.tsx — the receipts.
//
// WO-003 Stream I. The design review singled this out: "Changes log as receipts
// with a Decided by column." It is what justifies the retainer in a renewal
// conversation, and what makes an automated change defensible if a client ever
// queries it.
//
// Punch list #6: the **Automatic** filter. Alt text, schema and internal links
// ship with no human in the loop. A log showing only human decisions hides
// everything the system does on its own, which is the opposite of a receipt.
import { redirect } from "next/navigation";
import Link from "next/link";
import { userClient } from "@/lib/supabaseServer";
import { ClientHeader } from "@/components/ClientHeader";
import { workspaceTabs, type ClientType } from "@/lib/workspaceTabs";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

type Change = {
  id: string;
  title: string;
  description: string | null;
  changed_at: string;
  source: string;
  verdict: string | null;
  measured_at: string | null;
  decided_by_email: string | null;
  automatic: boolean;
};

const MEASURE_DAYS = 28;

/** Where a change sits in its 28-day measurement window. */
function measurement(c: Change): { label: string; tone: "good" | "bad" | "wait" | "flat" } {
  if (c.verdict === "validated") return { label: "Working", tone: "good" };
  if (c.verdict === "no_effect") return { label: "No effect", tone: "flat" };
  if (c.verdict === "declined") return { label: "Declined performance", tone: "bad" };
  if (c.verdict === "inconclusive") return { label: "Inconclusive", tone: "flat" };

  const days = Math.floor((Date.now() - new Date(c.changed_at).getTime()) / 86_400_000);
  const left = MEASURE_DAYS - days;
  // The design's honest state: "Measuring — 12 days left. We will not guess
  // before then." Never a verdict the data cannot yet support.
  return left > 0
    ? { label: `Measuring, ${left} day${left === 1 ? "" : "s"} left`, tone: "wait" }
    : { label: "Awaiting verdict", tone: "wait" };
}

const TONE: Record<string, { fg: string; bg: string }> = {
  good: { fg: "#2F8F4E", bg: "#E5FFB8" },
  bad:  { fg: "var(--danger)", bg: "#FBE7E4" },
  wait: { fg: "var(--fg2)", bg: "var(--bg)" },
  flat: { fg: "var(--fg2)", bg: "var(--bg)" },
};

export default async function Changes({
  params, searchParams,
}: {
  params: { id: string };
  searchParams: { filter?: string };
}) {
  const db = userClient();
  const { data: client } = await db
    .from("clients").select("id, name, domain, tier, client_type").eq("id", params.id).single();
  if (!client) redirect("/dashboard");

  const type = ((client as { client_type?: string }).client_type ?? null) as ClientType;
  if (!workspaceTabs(type).some((t) => t.key === "changes")) redirect(`/dashboard/${params.id}`);

  const filter = searchParams.filter ?? "all";

  let q = db.from("changes")
    .select("id, title, description, changed_at, source, verdict, measured_at, decided_by_email, automatic")
    .eq("client_id", params.id)
    .order("changed_at", { ascending: false })
    .limit(200);

  if (filter === "automatic") q = q.eq("automatic", true);
  if (filter === "human") q = q.eq("automatic", false);

  const [{ data }, { data: allRows }] = await Promise.all([
    q,
    db.from("changes").select("automatic").eq("client_id", params.id),
  ]);

  const changes = (data ?? []) as Change[];

  const counts = { all: 0, automatic: 0, human: 0 };
  for (const r of (allRows ?? []) as { automatic: boolean }[]) {
    counts.all++;
    if (r.automatic) counts.automatic++; else counts.human++;
  }

  const FILTERS = [
    { key: "all", label: "All", n: counts.all },
    { key: "human", label: "Decided by a person", n: counts.human },
    { key: "automatic", label: "Automatic", n: counts.automatic },
  ];

  return (
    <main style={{ padding: "40px 32px 64px" }}>
      <div style={{ maxWidth: 1180 }}>
        <ClientHeader
          id={params.id} name={client.name} domain={client.domain} tier={client.tier}
          clientType={type} active="changes"
          sub="Every change we shipped, who decided it, and what it did."
        />

        {/* Punch list #6 — nothing the system does alone is invisible. */}
        <div style={{ display: "flex", gap: 8, marginBottom: 22, flexWrap: "wrap" }}>
          {FILTERS.map((f) => {
            const on = filter === f.key;
            return (
              <Link key={f.key} href={`?filter=${f.key}`} style={{
                fontSize: 13, fontWeight: 600, padding: "7px 13px", borderRadius: 999,
                textDecoration: "none",
                background: on ? "var(--tm-deep-charcoal)" : "#fff",
                color: on ? "var(--tm-performance-green)" : "var(--fg2)",
                border: `1px solid ${on ? "var(--tm-deep-charcoal)" : "var(--border)"}`,
              }}>
                {f.label} <span style={{ opacity: 0.7 }}>{f.n}</span>
              </Link>
            );
          })}
        </div>

        {changes.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "32px 28px", maxWidth: 700 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 26, marginBottom: 8 }}>
              Nothing shipped yet
            </div>
            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--fg2)", margin: 0 }}>
              {filter === "automatic"
                ? "No automatic changes have run for this client."
                : "Approved changes appear here with who decided them, and what they did after 28 days."}
            </p>
          </div>
        ) : (
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            {changes.map((c, i) => {
              const m = measurement(c);
              const tone = TONE[m.tone];
              return (
                <div key={c.id} style={{
                  display: "flex", alignItems: "flex-start", gap: 16, padding: "16px 20px",
                  borderTop: i === 0 ? "none" : "1px solid var(--border)", flexWrap: "wrap",
                }}>
                  <div style={{ minWidth: 92, fontSize: 12.5, color: "var(--fg3)", fontVariantNumeric: "tabular-nums", paddingTop: 2 }}>
                    {new Date(c.changed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </div>

                  <div style={{ flex: 1, minWidth: 260 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--fg1)" }}>{c.title}</div>
                    {c.description && (
                      <div style={{ fontSize: 13, color: "var(--fg2)", marginTop: 3 }}>{c.description}</div>
                    )}
                    <div style={{ fontSize: 12, color: "var(--fg3)", marginTop: 6 }}>
                      {c.automatic ? (
                        <span style={{
                          fontWeight: 600, padding: "2px 7px", borderRadius: 999,
                          background: "var(--bg)", border: "1px solid var(--border)",
                        }}>Automatic</span>
                      ) : (
                        <>Decided by <span style={{ color: "var(--fg2)" }}>{c.decided_by_email ?? "unknown"}</span></>
                      )}
                    </div>
                  </div>

                  <div style={{
                    fontSize: 12.5, fontWeight: 600, padding: "5px 11px", borderRadius: 999,
                    background: tone.bg, color: tone.fg, whiteSpace: "nowrap",
                  }}>
                    {m.label}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
