// api/ops/org-secret — set an agency-wide credential without writing SQL.
//
// WO-004. Per-client credentials got a Settings UI weeks ago; org-level ones —
// postflow, bloom, anything shared across the whole agency — never did, so every
// one of them has been hand-written SQL in the Supabase console. That is how a
// key gets truncated by an editor appending `limit 100` to an unterminated
// string, which is exactly what happened.
//
// Owner-only, write-only, and the value never comes back out.
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * The org-level secrets this app knows about.
 *
 * An allowlist rather than free text: a typo'd name writes a secret nothing ever
 * reads, and it fails silently at the point of use days later.
 */
const KNOWN = [
  "postflow", "bloom", "clickup", "screenshotone",
  // Google Ads. Both are portfolio-level: one Google account/MCC covers every
  // client, and the per-client part is the customer id in ad_platform_accounts.
  //
  // Their absence from this list is why they were never vaulted. STATUS recorded
  // them as vaulted on 2026-07-22; `vault.secrets` says otherwise, and the
  // Google Ads collector has never had credentials for any client — which is
  // consistent with it having never collected for one.
  "google_ads_oauth", "google_ads_developer_token",
] as const;

/** The OAuth bundle is JSON; everything else is an opaque token string. */
const JSON_SECRETS: Record<string, string[]> = {
  google_ads_oauth: ["client_id", "client_secret", "refresh_token"],
};

export async function POST(req: Request) {
  const profile = await getProfile();
  if (profile?.role !== "owner") {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }

  const form = await req.formData();
  const name = String(form.get("name") ?? "").trim();
  const secret = String(form.get("secret") ?? "");

  const url = new URL("/dashboard/secrets", req.url);

  if (!KNOWN.includes(name as (typeof KNOWN)[number])) {
    url.searchParams.set("msg", "unknown-name");
    return NextResponse.redirect(url, { status: 303 });
  }

  // Trim, because a trailing newline from a paste is invisible and produces a
  // 401 that looks like a wrong key.
  const clean = secret.trim();
  if (!clean) {
    url.searchParams.set("msg", "empty");
    return NextResponse.redirect(url, { status: 303 });
  }
  // A JSON bundle legitimately contains whitespace, and `scripts/google-oauth.mjs`
  // writes it pretty-printed — so rejecting whitespace outright would reject the
  // exact thing the script produces. Parse it instead, require the fields the
  // collector reads, and store it minified. A bundle missing a field fails at
  // parse here rather than as a silent skip days later.
  const fields = JSON_SECRETS[name];
  let toStore = clean;
  if (fields) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(clean) as Record<string, unknown>;
    } catch {
      url.searchParams.set("msg", "bad-json");
      return NextResponse.redirect(url, { status: 303 });
    }
    const missing = fields.filter((f) => !parsed[f]);
    if (missing.length) {
      url.searchParams.set("msg", "missing-fields");
      return NextResponse.redirect(url, { status: 303 });
    }
    toStore = JSON.stringify(Object.fromEntries(fields.map((f) => [f, parsed[f]])));
  } else if (/\s/.test(clean)) {
    url.searchParams.set("msg", "has-whitespace");
    return NextResponse.redirect(url, { status: 303 });
  }

  const db = dbClient();
  const { error } = await db.rpc("vault_rotate_secret", { p_secret: toStore, p_name: name });
  if (error) {
    url.searchParams.set("msg", "failed");
    return NextResponse.redirect(url, { status: 303 });
  }

  // Length only. Never the value, not even in an audit row.
  await writeAudit(
    { action: "budget_change", targetType: "client", targetId: name,
      detail: `org secret '${name}' rotated (${toStore.length} chars)` },
    profile
  );

  url.searchParams.set("msg", `saved:${name}`);
  return NextResponse.redirect(url, { status: 303 });
}
