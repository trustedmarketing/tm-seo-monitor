// app/dashboard/[id]/paid/personas/page.tsx — customer personas (WO-006 stream E).
//
// Pure context for ad copy and creative-generation prompts (streams C and F)
// — NOT a native Meta/Google audience-object integration in v1 (confirmed
// scope). No platform targeting API is touched from this page.
import Link from "next/link";
import { userClient } from "@/lib/supabaseServer";
import { ClientHeader } from "@/components/ClientHeader";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

type Persona = {
  id: string;
  name: string;
  description: string | null;
  locations: string[] | null;
  categories: string[] | null;
  pain_points: string | null;
  messaging_angle: string | null;
};

const MSG: Record<string, string> = {
  "persona-created": "Persona added.",
  "persona-updated": "Persona updated.",
  "persona-deleted": "Persona removed.",
  "persona-name-required": "A name is required.",
  "persona-not-found": "Could not find that persona.",
};

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)" };
const eyebrow: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg3)" };
const L: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg3)", marginBottom: 5 };
const I: React.CSSProperties = {
  fontFamily: "var(--font-body)", fontSize: 14, padding: "9px 11px",
  border: "1px solid var(--border-strong)", borderRadius: 8, width: "100%",
  boxSizing: "border-box", background: "#fff", color: "var(--fg1)",
};
const BTN: React.CSSProperties = {
  fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 13.5,
  padding: "9px 16px", borderRadius: 8, border: "none", cursor: "pointer",
  background: "var(--tm-performance-green)", color: "#080808",
};
const BTN_GHOST: React.CSSProperties = {
  fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 13,
  padding: "8px 14px", borderRadius: 8, cursor: "pointer",
  border: "1px solid var(--border-strong)", background: "transparent", color: "var(--fg2)",
};

function PersonaForm({ clientId, persona }: { clientId: string; persona?: Persona }) {
  return (
    <form action="/api/clients/personas" method="post">
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="action" value="save" />
      {persona && <input type="hidden" name="persona_id" value={persona.id} />}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <div>
          <label style={L}>Name</label>
          <input style={I} name="name" defaultValue={persona?.name ?? ""} required placeholder="e.g. Weekend boat owner" />
        </div>
        <div>
          <label style={L}>Locations (comma-separated)</label>
          <input style={I} name="locations" defaultValue={persona?.locations?.join(", ") ?? ""} placeholder="e.g. Tampa Bay, Charleston" />
        </div>
        <div>
          <label style={L}>Categories (comma-separated)</label>
          <input style={I} name="categories" defaultValue={persona?.categories?.join(", ") ?? ""} placeholder="e.g. Boat cleaning, Marine detailing" />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label style={L}>Description</label>
        <input style={I} name="description" defaultValue={persona?.description ?? ""} placeholder="Who they are, in a sentence" />
      </div>
      <div style={{ marginTop: 12 }}>
        <label style={L}>Pain points</label>
        <input style={I} name="pain_points" defaultValue={persona?.pain_points ?? ""} placeholder="What frustrates them today" />
      </div>
      <div style={{ marginTop: 12 }}>
        <label style={L}>Messaging angle</label>
        <input style={I} name="messaging_angle" defaultValue={persona?.messaging_angle ?? ""} placeholder="The hook that lands with this persona" />
      </div>
      <button type="submit" style={{ ...BTN, marginTop: 16 }}>{persona ? "Save changes" : "Add persona"}</button>
    </form>
  );
}

export default async function Personas({
  params, searchParams,
}: {
  params: { id: string };
  searchParams: { msg?: string };
}) {
  const db = userClient();
  const [{ data: client }, { data: personas }] = await Promise.all([
    db.from("clients").select("id, name, domain, tier, client_type").eq("id", params.id).single(),
    db.from("client_personas").select("*").eq("client_id", params.id).order("created_at", { ascending: false }),
  ]);
  if (!client) return <main style={{ padding: 48 }}>Client not found. <Link href="/dashboard">Back</Link></main>;

  const rows = (personas ?? []) as Persona[];

  return (
    <main style={{ padding: "40px 32px 64px" }}>
      <div style={{ maxWidth: 900 }}>
        <ClientHeader id={params.id} name={client.name} domain={client.domain} tier={client.tier} clientType={(client as any).client_type ?? null} active="paid"
          sub="Customer personas — targeting and messaging context for ad copy and creative, not a platform audience sync" />

        {searchParams.msg && MSG[searchParams.msg] && (
          <div style={{ ...card, padding: "12px 16px", marginBottom: 16, fontSize: 13.5, color: "var(--fg2)" }}>{MSG[searchParams.msg]}</div>
        )}

        <section style={{ ...card, padding: "20px 24px", marginBottom: 16 }}>
          <div style={eyebrow}>Add a persona</div>
          <div style={{ marginTop: 12 }}>
            <PersonaForm clientId={params.id} />
          </div>
        </section>

        {rows.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--fg3)" }}>No personas yet — add one above to sharpen ad copy and creative targeting.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {rows.map((p) => (
              <section key={p.id} style={{ ...card, padding: "18px 20px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 15.5, fontWeight: 600 }}>{p.name}</div>
                    {p.description && <div style={{ fontSize: 13, color: "var(--fg2)", marginTop: 3 }}>{p.description}</div>}
                  </div>
                  <form action="/api/clients/personas" method="post">
                    <input type="hidden" name="client_id" value={params.id} />
                    <input type="hidden" name="action" value="delete" />
                    <input type="hidden" name="persona_id" value={p.id} />
                    <button type="submit" style={BTN_GHOST}>Remove</button>
                  </form>
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10, fontSize: 12.5, color: "var(--fg2)" }}>
                  {p.locations?.length ? <span>Locations: {p.locations.join(", ")}</span> : null}
                  {p.categories?.length ? <span>Categories: {p.categories.join(", ")}</span> : null}
                </div>
                {p.pain_points && <div style={{ fontSize: 12.5, color: "var(--fg2)", marginTop: 8 }}><strong>Pain points:</strong> {p.pain_points}</div>}
                {p.messaging_angle && <div style={{ fontSize: 12.5, color: "var(--fg2)", marginTop: 4 }}><strong>Angle:</strong> {p.messaging_angle}</div>}

                <details style={{ marginTop: 12 }}>
                  <summary style={{ fontSize: 12.5, color: "var(--fg3)", cursor: "pointer" }}>Edit</summary>
                  <div style={{ marginTop: 10 }}>
                    <PersonaForm clientId={params.id} persona={p} />
                  </div>
                </details>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
