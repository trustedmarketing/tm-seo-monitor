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
const KNOWN = ["postflow", "bloom", "clickup", "screenshotone"] as const;

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
  if (/\s/.test(clean)) {
    url.searchParams.set("msg", "has-whitespace");
    return NextResponse.redirect(url, { status: 303 });
  }

  const db = dbClient();
  const { error } = await db.rpc("vault_rotate_secret", { p_secret: clean, p_name: name });
  if (error) {
    url.searchParams.set("msg", "failed");
    return NextResponse.redirect(url, { status: 303 });
  }

  // Length only. Never the value, not even in an audit row.
  await writeAudit(
    { action: "budget_change", targetType: "client", targetId: name,
      detail: `org secret '${name}' rotated (${clean.length} chars)` },
    profile
  );

  url.searchParams.set("msg", `saved:${name}`);
  return NextResponse.redirect(url, { status: 303 });
}
