// api/ops/shopify-check — verify a client's Shopify connection and, critically,
// which scopes the app actually presents.
//
// WO-003 Stream N. Scopes are configured in the Shopify admin and minted into
// the token at runtime, so what the app *can do* is invisible from our side
// until something fails. Discovering a missing write scope mid-publish means a
// human already approved a change we cannot make: the card says published, the
// store disagrees, and the ledger records a lie.
//
// This runs the adapter's own preflight() — the same call publish() makes — so
// the check and the execution path cannot drift apart.
//
// Owner-only. Reports scopes and store domain, never the client secret or the
// minted token.
import { getProfile } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { readSecret } from "@/lib/vault";
import { connect, preflight, stage } from "@/lib/shopifyAdapter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Scopes we would rather a reporting-and-content app did NOT hold. */
const OVER_PRIVILEGED = ["write_orders", "write_customers", "write_price_rules", "write_discounts"];

export async function GET(req: Request) {
  const profile = await getProfile();
  if (profile?.role !== "owner") {
    return Response.json({ error: "Owner access required" }, { status: 403 });
  }

  const db = dbClient();
  const clientId = new URL(req.url).searchParams.get("client");

  const q = db
    .from("client_stores")
    .select("client_id, platform, domain, api_client_id, auth_ref, status")
    .eq("platform", "shopify");
  const { data: stores } = clientId ? await q.eq("client_id", clientId) : await q.limit(1);
  const store = stores?.[0];

  if (!store) {
    return Response.json({ ok: false, failed_at: "no_store_row", hint: "no shopify row in client_stores" });
  }

  const out: Record<string, unknown> = {
    store_domain: store.domain,
    status: store.status,
    api_client_id_present: !!store.api_client_id,
    auth_ref: store.auth_ref,
  };

  if (!store.api_client_id || !store.auth_ref) {
    return Response.json({ ok: false, failed_at: "incomplete_store_config", ...out });
  }

  const secret = await readSecret(db, store.auth_ref);
  out.vault_secret_present = !!secret;
  if (!secret) {
    return Response.json({ ok: false, failed_at: "vault_secret_missing", ...out });
  }

  try {
    // Mints a fresh short-lived token — this alone proves the credentials work.
    const token = await connect(store.domain, store.api_client_id, secret);
    out.token_minted = true;

    const { canWrite, scopes } = await preflight(store.domain, token);
    out.scopes = scopes;
    out.can_write_content = canWrite;

    // Optional: prove stage() against a real object, read-only.
    // ?page=gid://shopify/Page/123  — validates the GraphQL shape against the
    // live API before any UI is built on top of it. Reads only; writes nothing.
    const gid = new URL(req.url).searchParams.get("page");
    if (gid) {
      const staged = await stage(store.domain, token, {
        type: "page_seo_title",
        targetGid: gid,
        proposed: "(probe — not written)",
      });
      out.staged = {
        target: staged.targetLabel,
        current_seo_title: staged.current,
        note: "read-only probe, nothing written",
      };
    }

    // Flag anything broader than this app needs. Not a failure — an observation
    // the owner should see, since scope creep on a live revenue store is exactly
    // the kind of thing nobody re-reads after setup.
    const excess = scopes.filter((s) => OVER_PRIVILEGED.includes(s));
    if (excess.length) out.over_privileged = excess;

    return Response.json({
      ok: canWrite,
      failed_at: canWrite ? null : "missing_write_content",
      hint: canWrite ? undefined : "add write_content to the custom app's Admin API scopes",
      ...out,
    });
  } catch (e) {
    return Response.json({
      ok: false,
      failed_at: "connect_or_preflight",
      error: (e as Error).message.slice(0, 300),
      ...out,
    });
  }
}
