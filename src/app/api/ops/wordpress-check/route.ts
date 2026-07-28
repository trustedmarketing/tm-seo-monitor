// api/ops/wordpress-check — verify a client's WordPress connection.
//
// WO-003 Stream N. Same pattern as the Shopify and GA4 checks, and for the same
// reason: every integration failure this week has been an invisible value rather
// than broken code, and each one was diagnosed in minutes once a route reported
// what the server actually resolves.
//
// Reports each hop so a failure says WHICH one broke: store row → vault secret →
// authentication → write capability → SEO plugin. Owner-only. Never returns the
// application password.
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { readSecret } from "@/lib/vault";
import { preflight, stage } from "@/lib/wordpressAdapter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const profile = await getProfile();
  if (profile?.role !== "owner") {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }

  const p = new URL(req.url).searchParams;
  const clientId = p.get("client");

  const db = dbClient();
  const q = db
    .from("client_stores")
    .select("client_id, domain, api_client_id, auth_ref, status")
    .eq("platform", "wordpress");
  const { data: sites } = clientId ? await q.eq("client_id", clientId) : await q.limit(1);
  const site = sites?.[0];

  if (!site) {
    return NextResponse.json({
      ok: false,
      failed_at: "no_site_row",
      hint: "add a client_stores row with platform='wordpress': domain = site URL, api_client_id = WP username, auth_ref = vault key for the application password",
    });
  }

  const out: Record<string, unknown> = {
    site_url: site.domain,
    wp_username: site.api_client_id,     // an identifier, not a secret
    auth_ref: site.auth_ref,
    status: site.status,
  };

  if (!site.api_client_id || !site.auth_ref) {
    return NextResponse.json({ ok: false, failed_at: "incomplete_site_config", ...out });
  }

  const appPassword = await readSecret(db, site.auth_ref);
  out.vault_secret_present = !!appPassword;
  if (!appPassword) return NextResponse.json({ ok: false, failed_at: "vault_secret_missing", ...out });

  try {
    const pre = await preflight(site.domain, site.api_client_id, appPassword);
    out.authenticated_as = pre.user;
    out.can_write = pre.canWrite;
    out.seo_plugin = pre.seoPlugin;
    out.seo_fields_writable = pre.seoWritable;
    out.capabilities = pre.capabilities.slice(0, 12);

    if (!pre.seoWritable) {
      out.seo_detail = pre.seoDetail;
      out.note =
        "Title, content and excerpt changes work. SEO title and meta description do not yet — " +
        (pre.seoPlugin === "none"
          ? "no Rank Math or Yoast REST namespace was found on this site."
          : `${pre.seoPlugin} is present but its meta is not registered for REST.`);
    }

    // Optional read-only probe against a real post, same as the Shopify check.
    // ?post=123&type=pages
    const postId = p.get("post");
    if (postId) {
      const staged = await stage(
        site.domain, site.api_client_id, appPassword,
        {
          type: "post_title",
          target: { siteUrl: site.domain, postType: (p.get("type") as "posts" | "pages") ?? "pages", id: Number(postId) },
          proposed: "(probe — not written)",
        },
        pre.seoPlugin
      );
      out.staged = { target: staged.targetLabel, current_title: staged.current, note: "read-only probe, nothing written" };
    }

    return NextResponse.json({
      ok: pre.canWrite,
      failed_at: pre.canWrite ? null : "cannot_write",
      hint: pre.canWrite ? undefined : "the application password's user needs edit_posts / edit_pages",
      ...out,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      failed_at: "connect_or_preflight",
      error: (e as Error).message.slice(0, 400),
      ...out,
    });
  }
}
