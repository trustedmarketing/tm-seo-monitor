// app/dashboard/secrets — agency-wide credentials.
//
// WO-004. Write-only: the page shows whether a secret is SET and how long it is,
// never what it is. Length is the one property worth showing — a key that is 11
// characters when it should be 40 is a truncated paste, which is a failure mode
// that has already cost us an afternoon on ScreenshotOne.
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

const SECRETS = [
  { name: "postflow", label: "PostFlow", hint: "Bearer token. One account covers every client; groups are per client." },
  { name: "bloom", label: "Bloom", hint: "Developer API key from Bloom account settings, sent as x-api-key. Not the MCP connection." },
  { name: "clickup", label: "ClickUp", hint: "Personal API token for task sync." },
  { name: "screenshotone", label: "ScreenshotOne", hint: "Access key for rendering client pages." },
  {
    name: "google_ads_oauth",
    label: "Google Ads — OAuth bundle",
    hint: "The JSON from `node scripts/google-oauth.mjs` (.google-oauth.local.json). Paste the whole thing, formatting and all — it is parsed and stored minified. One MCC covers every client.",
  },
  {
    name: "google_ads_developer_token",
    label: "Google Ads — developer token",
    hint: "From the MCC: Tools → API Center. Portfolio-wide. Also needs GOOGLE_ADS_LOGIN_CUSTOMER_ID set in Vercel, or the collector skips every client.",
  },
];

const MSG: Record<string, string> = {
  empty: "Nothing was entered.",
  "has-whitespace": "That value contains a space or line break. Paste it as one unbroken line.",
  "unknown-name": "That is not a credential this app reads.",
  "bad-json": "That credential is a JSON bundle and this is not valid JSON. Paste the file's whole contents.",
  "missing-fields": "That JSON is missing a field the collector needs — client_id, client_secret and refresh_token must all be present.",
  failed: "Could not store the credential.",
};

export default async function Secrets({ searchParams }: { searchParams: { msg?: string } }) {
  const profile = await getProfile();
  if (profile?.role !== "owner") redirect("/dashboard");

  const db = dbClient();
  const state: Record<string, number | null> = {};
  for (const s of SECRETS) {
    const { data } = await db.rpc("vault_read_secret", { p_name: s.name });
    state[s.name] = typeof data === "string" && data.length ? data.length : null;
  }

  const raw = searchParams.msg ?? "";
  const msg = raw.startsWith("saved:")
    ? `${raw.split(":")[1]} saved. Verify it with that platform's ops check before relying on it.`
    : MSG[raw] ?? null;

  return (
    <main style={{ padding: "40px 32px 64px" }}>
      <div style={{ maxWidth: 780 }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 40, margin: "0 0 6px" }}>
          Agency credentials
        </h1>
        <p style={{ fontSize: 14, color: "var(--fg2)", margin: "0 0 26px", lineHeight: 1.6 }}>
          Shared across every client. Per-client credentials live on each client&#39;s Settings tab.
          Values are write-only: this page can tell you a key is stored and how long it is, never what it is.
        </p>

        {msg && (
          <div style={{ padding: "12px 16px", borderRadius: 8, background: "#fff",
                        border: "1px solid var(--border)", fontSize: 14, marginBottom: 22 }}>{msg}</div>
        )}

        {SECRETS.map((s) => {
          const len = state[s.name];
          return (
            <form key={s.name} action="/api/ops/org-secret" method="post" style={{
              background: "#fff", border: "1px solid var(--border)", borderRadius: 12,
              padding: "20px 22px", marginBottom: 16,
            }}>
              <input type="hidden" name="name" value={s.name} />

              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 16 }}>{s.label}</strong>
                <span style={{
                  fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 999,
                  background: len ? "#E5FFB8" : "var(--bg)",
                  color: len ? "#2F8F4E" : "var(--fg3)",
                  border: `1px solid ${len ? "#C7E89A" : "var(--border)"}`,
                }}>
                  {len ? `Stored · ${len} chars` : "Not set"}
                </span>
              </div>

              <div style={{ fontSize: 12.5, color: "var(--fg3)", marginBottom: 12 }}>{s.hint}</div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input name="secret" type="password" autoComplete="new-password"
                       placeholder={len ? "Paste a new value to replace it" : "Paste the key"}
                       style={{
                         fontFamily: "var(--font-body)", fontSize: 14, padding: "9px 11px",
                         border: "1px solid var(--border-strong)", borderRadius: 8,
                         flex: 1, minWidth: 260, background: "#fff", color: "var(--fg1)",
                       }} />
                <button type="submit" style={{
                  fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 13.5,
                  padding: "9px 18px", borderRadius: 8, border: "none", cursor: "pointer",
                  background: "var(--tm-performance-green)", color: "#080808",
                }}>Save</button>
              </div>
            </form>
          );
        })}

        <p style={{ fontSize: 12.5, color: "var(--fg3)", lineHeight: 1.6, marginTop: 22 }}>
          A stored length that looks wrong is worth investigating before anything else. An 11-character
          key where 40 was expected is a truncated paste, and it fails later as an authentication error
          that looks nothing like the cause.
        </p>
      </div>
    </main>
  );
}
