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
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

type Creative = {
  id: string;
  concept_group_id: string;
  aspect_ratio: string;
  image_url: string | null;
  status: "generating" | "completed" | "failed" | "approved";
  prompt: string | null;
  created_at: string;
};

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

export default async function Creative({ params }: { params: { id: string } }) {
  const db = userClient();
  const [{ data: client }, { data: creatives }] = await Promise.all([
    db.from("clients").select("id, name, domain, tier, client_type").eq("id", params.id).single(),
    db.from("creatives").select("id, concept_group_id, aspect_ratio, image_url, status, prompt, created_at")
      .eq("client_id", params.id).order("created_at", { ascending: false }),
  ]);
  if (!client) return <main style={{ padding: 48 }}>Client not found. <Link href="/dashboard">Back</Link></main>;

  const rows = (creatives ?? []) as Creative[];
  const groups = new Map<string, Creative[]>();
  for (const r of rows) {
    const g = groups.get(r.concept_group_id) ?? [];
    g.push(r);
    groups.set(r.concept_group_id, g);
  }

  return (
    <main style={{ padding: "40px 32px 64px" }}>
      <div style={{ maxWidth: 1000 }}>
        <ClientHeader id={params.id} name={client.name} domain={client.domain} tier={client.tier} clientType={(client as any).client_type ?? null} active="paid"
          sub="Ad creative — generated 4:5 first; approve to fan out to 1:1 and 9:16" />

        <section style={{ ...card, padding: "16px 20px", marginBottom: 16, fontSize: 13, color: "var(--fg2)" }}>
          Generate a new concept via <code>/api/ops/ad-creative?action=generate&amp;client={params.id}&amp;campaign_name=...</code> (owner-only). A future "Generate creative" button on this page is a follow-up.
        </section>

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
      </div>
    </main>
  );
}
