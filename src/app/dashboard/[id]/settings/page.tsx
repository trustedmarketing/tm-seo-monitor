// app/dashboard/[id]/settings/page.tsx — client configuration.
//
// WO-003. Everything that previously required hand-written SQL in the Supabase
// console: property ids, platform credentials, tier, client type.
//
// Secrets are never rendered. The page shows whether one is SET and offers a
// field to replace it — a settings screen that displays credentials turns every
// screen-share into a leak.
import { redirect } from "next/navigation";
import { userClient, getProfile } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { ClientHeader } from "@/components/ClientHeader";
import { workspaceTabs, type ClientType } from "@/lib/workspaceTabs";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

const MSG: Record<string, string> = {
  saved: "Saved.",
  "connection-saved": "Connection updated.",
  "connection-saved-secret": "Connection updated and credential rotated. Verify it with the check link below.",
  "owner-only": "Only an owner can change credentials.",
  "save-failed": "Could not save. Check the values and try again.",
  "vault-failed": "Could not store the credential.",
  "bad-tier": "That is not a valid tier.",
  "bad-type": "That is not a valid client type.",
};

const L: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em",
  textTransform: "uppercase", color: "var(--fg3)", marginBottom: 5,
};
const I: React.CSSProperties = {
  fontFamily: "var(--font-body)", fontSize: 14, padding: "9px 11px",
  border: "1px solid var(--border-strong)", borderRadius: 8, width: "100%",
  boxSizing: "border-box", background: "#fff", color: "var(--fg1)",
};
const CARD: React.CSSProperties = {
  background: "#fff", border: "1px solid var(--border)", borderRadius: 12,
  padding: "24px 26px", marginBottom: 20, maxWidth: 860,
};
const BTN: React.CSSProperties = {
  fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 13.5,
  padding: "10px 18px", borderRadius: 8, border: "none", cursor: "pointer",
  background: "var(--tm-performance-green)", color: "#080808", marginTop: 18,
};
const HINT: React.CSSProperties = { fontSize: 12, color: "var(--fg3)", marginTop: 5 };

export default async function Settings({
  params, searchParams,
}: {
  params: { id: string };
  searchParams: { msg?: string };
}) {
  const profile = await getProfile();
  const db = userClient();

  const { data: client } = await db.from("clients").select("*").eq("id", params.id).single();
  if (!client) redirect("/dashboard");

  const type = ((client as { client_type?: string }).client_type ?? null) as ClientType;
  if (!workspaceTabs(type).some((t) => t.key === "settings")) redirect(`/dashboard/${params.id}`);

  const { data: stores } = await db
    .from("client_stores").select("platform, domain, api_client_id, auth_ref, status")
    .eq("client_id", params.id);

  // Secret PRESENCE only, resolved server-side with the service role. The value
  // never enters this component, let alone the HTML.
  const svc = dbClient();
  const presence: Record<string, boolean> = {};
  for (const p of ["shopify", "wordpress"]) {
    const { data } = await svc.rpc("vault_read_secret", { p_name: `${p}:${params.id}` });
    presence[p] = !!data;
  }

  const storeOf = (p: string) => (stores ?? []).find((s) => s.platform === p);
  const isOwner = profile?.role === "owner";
  const msg = searchParams.msg ? MSG[searchParams.msg] : null;

  const { count: pending } = await db.from("approvals")
    .select("id", { count: "exact", head: true })
    .eq("client_id", params.id).in("status", ["staged", "failed"]);

  return (
    <main style={{ padding: "40px 32px 64px" }}>
      <div style={{ maxWidth: 1180 }}>
        <ClientHeader
          id={params.id} name={client.name} domain={client.domain} tier={client.tier}
          clientType={type} active="settings" pending={pending ?? 0}
          sub="Everything this client is connected to, in one place."
        />

        {msg && (
          <div style={{ padding: "12px 16px", borderRadius: 8, background: "#fff",
                        border: "1px solid var(--border)", fontSize: 14, marginBottom: 20, maxWidth: 860 }}>
            {msg}
          </div>
        )}

        {/* ── profile + integration ids ─────────────────────────────────── */}
        <form action="/api/clients/settings" method="post" style={CARD}>
          <input type="hidden" name="client_id" value={params.id} />
          <input type="hidden" name="section" value="profile" />

          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 24, margin: "0 0 18px" }}>
            Client
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
            <div><label style={L}>Name</label><input name="name" defaultValue={client.name} style={I} /></div>
            <div><label style={L}>Domain</label><input name="domain" defaultValue={client.domain} style={I} /></div>

            <div>
              <label style={L}>Tier</label>
              <select name="tier" defaultValue={client.tier ?? ""} style={I}>
                <option value="">Not set</option>
                <option>Consistency</option><option>Momentum</option><option>Dominate</option>
              </select>
            </div>

            <div>
              <label style={L}>Client type</label>
              <select name="client_type" defaultValue={type ?? ""} style={I}>
                <option value="">Unclassified</option>
                <option value="local_service">Local service</option>
                <option value="national_ecom">National eCommerce</option>
                <option value="hybrid">Hybrid</option>
              </select>
              <div style={HINT}>Decides which tabs this workspace shows. eCommerce gets Revenue in Overview; local service gets GBP and Automation.</div>
            </div>
          </div>

          <h3 style={{ fontSize: 15, fontWeight: 600, margin: "26px 0 14px" }}>Integration IDs</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
            <div>
              <label style={L}>GA4 property ID</label>
              <input name="ga4_property_id" defaultValue={client.ga4_property_id ?? ""} placeholder="539468239" style={I} />
              <div style={HINT}>Digits only. GA4 → Admin → Property Settings. A wrong ID here looks exactly like a permissions error.</div>
            </div>
            <div>
              <label style={L}>Search Console property</label>
              <input name="gsc_property" defaultValue={client.gsc_property ?? ""} placeholder="sc-domain:example.com" style={I} />
              <div style={HINT}>Match the exact form — <code>sc-domain:</code> or <code>https://</code>.</div>
            </div>
            <div>
              <label style={L}>PostFlow group ID</label>
              <input name="postflow_group_id" defaultValue={client.postflow_group_id ?? ""} style={I} />
              <div style={HINT}>Required for social analytics.</div>
            </div>
            <div>
              <label style={L}>Social posts per month</label>
              <input name="social_posts_per_month" type="number" min="0" max="200"
                     defaultValue={client.social_posts_per_month ?? ""} placeholder="12" style={I} />
              <div style={HINT}>The cadence this client is on. Leave blank and the planner uses the platform minimum and says so.</div>
            </div>
            <div>
              <label style={L}>Standing hashtags</label>
              <input name="hashtag_core"
                     defaultValue={(client.hashtag_core ?? []).join(" ")}
                     placeholder="#SaltyDog #BoatCare" style={I} />
              <div style={HINT}>Applied to every post for this client, before the post-specific ones. Max 5.</div>
            </div>
            <div>
              <label style={L}>ClickUp list ID</label>
              <input name="clickup_list_id" defaultValue={client.clickup_list_id ?? ""} style={I} />
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 20, fontSize: 14 }}>
            <input type="checkbox" name="active" defaultChecked={client.active} />
            Active — collectors run for this client
          </label>

          <button type="submit" style={BTN}>Save client</button>
        </form>

        {/* ── platform connections ──────────────────────────────────────── */}
        {(["shopify", "wordpress"] as const).map((platform) => {
          const store = storeOf(platform);
          const hasSecret = presence[platform];
          const isWp = platform === "wordpress";
          return (
            <form key={platform} action="/api/clients/settings" method="post" style={CARD}>
              <input type="hidden" name="client_id" value={params.id} />
              <input type="hidden" name="section" value="connection" />
              <input type="hidden" name="platform" value={platform} />

              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
                <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 24, margin: 0 }}>
                  {isWp ? "WordPress" : "Shopify"}
                </h2>
                <span style={{
                  fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 999,
                  background: hasSecret ? "#E5FFB8" : "var(--bg)",
                  color: hasSecret ? "#2F8F4E" : "var(--fg3)",
                  border: `1px solid ${hasSecret ? "#C7E89A" : "var(--border)"}`,
                }}>
                  {hasSecret ? "Credential stored" : "No credential"}
                </span>
                <a href={`/api/ops/${platform}-check?client=${params.id}`} target="_blank" rel="noreferrer"
                   style={{ fontSize: 13, fontWeight: 600, color: "var(--fg2)", marginLeft: "auto" }}>
                  Test connection ↗
                </a>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginTop: 14 }}>
                <div>
                  <label style={L}>{isWp ? "Site URL" : "Store domain"}</label>
                  <input name="store_domain" defaultValue={store?.domain ?? ""} disabled={!isOwner}
                         placeholder={isWp ? "https://example.com" : "shop.myshopify.com"} style={I} />
                  <div style={HINT}>{isWp ? "Include https://" : "The .myshopify.com domain, not the custom one."}</div>
                </div>
                <div>
                  <label style={L}>{isWp ? "WordPress username" : "API client ID"}</label>
                  <input name="store_user" defaultValue={store?.api_client_id ?? ""} disabled={!isOwner} style={I} />
                  <div style={HINT}>{isWp ? "The login name, not the email. Use a dedicated Editor account." : "From the custom app's API credentials."}</div>
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <label style={L}>{isWp ? "Application password" : "API secret"}</label>
                <input name="store_secret" type="password" autoComplete="new-password" disabled={!isOwner}
                       placeholder={hasSecret ? "Stored — leave blank to keep it" : "Not set"} style={I} />
                <div style={HINT}>
                  Stored in the vault and never displayed. Leave blank to keep the existing one.
                  {!isOwner && " Only an owner can change credentials."}
                </div>
              </div>

              {isOwner && <button type="submit" style={BTN}>Save {isWp ? "WordPress" : "Shopify"} connection</button>}
            </form>
          );
        })}

        <div style={{ fontSize: 12.5, color: "var(--fg3)", maxWidth: 860 }}>
          Credentials are write-only by design: this page can tell you whether one is stored, never what
          it is. Use the test links above to confirm a connection actually works rather than assuming
          from what is on screen.
        </div>
      </div>
    </main>
  );
}
