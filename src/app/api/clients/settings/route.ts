// api/clients/settings — edit a client's configuration from the product.
//
// WO-003. Until now every integration needed hand-written SQL in the Supabase
// console: GA4 property, Shopify scopes, WordPress credentials, PostFlow group.
// That is not a workflow, and it is how a wrong property ID sat undetected for
// six days.
//
// ── Secrets are write-only ───────────────────────────────────────────────────
// The form never receives a stored secret, only whether one EXISTS. A settings
// page that renders credentials turns every screen-share into a leak, and the
// vault exists precisely so nothing client-facing sees a token (autonomy #5).
// Submitting a blank secret field leaves the stored value alone rather than
// clearing it — the common case is editing something else on the same form.
import { NextResponse } from "next/server";
import { getProfile, isAgency } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AEO_PROVIDERS, DEFAULT_PROVIDERS } from "@/lib/aeoProviders";
import { TIERS } from "@/lib/clientProfile";

export const dynamic = "force-dynamic";

const TYPES = ["local_service", "national_ecom", "hybrid"];
/** Must match the cron's FREQ_DAYS keys, plus `paused`. */
const AI_FREQUENCIES = ["daily", "weekly", "biweekly", "monthly", "paused"];

function back(req: Request, id: string, msg: string) {
  const url = new URL(`/dashboard/${id}/settings`, req.url);
  url.searchParams.set("msg", msg);
  return NextResponse.redirect(url, { status: 303 });
}

/** Empty string means "not provided", which is different from "clear this". */
function opt(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export async function POST(req: Request) {
  const profile = await getProfile();
  if (!isAgency(profile)) return NextResponse.json({ error: "Agency access required" }, { status: 403 });

  const form = await req.formData();
  const id = String(form.get("client_id") ?? "");
  const section = String(form.get("section") ?? "");
  if (!id) return NextResponse.json({ error: "client_id required" }, { status: 400 });

  const db = dbClient();
  const { data: before } = await db.from("clients").select("*").eq("id", id).maybeSingle();
  if (!before) return back(req, id, "not-found");

  // ── which AI assistants this client's prompts are checked against ─────────
  //
  // OWNER-only, unlike the rest of this route. Each provider is a separately
  // billed DataForSEO call per prompt per run, on a balance shared with every
  // other collector — turning two more on triples AEO spend, and that is a
  // money decision, not a preference. Same reasoning as the spend guardrail.
  if (section === "aeo") {
    if (profile?.role !== "owner") {
      return NextResponse.json({ error: "Owner access required" }, { status: 403 });
    }

    // ChatGPT is always kept: it is the baseline the headline number and every
    // figure already collected are measured on. Dropping it would not save a
    // meaningful amount and would break comparability with all of that history.
    const chosen = AEO_PROVIDERS
      .filter((p) => p.key === DEFAULT_PROVIDERS[0] || form.get(`provider_${p.key}`) === "on")
      .map((p) => p.key);

    // Validated against the cron's own vocabulary — an unrecognised value would
    // silently fall back to weekly inside isDue(), so the setting would appear
    // to save and then not do what it says.
    const freq = String(form.get("ai_frequency") ?? "weekly");
    if (!AI_FREQUENCIES.includes(freq)) return back(req, id, "bad-frequency");

    const { error } = await db
      .from("clients")
      .update({ aeo_providers: chosen, ai_frequency: freq })
      .eq("id", id);
    if (error) return back(req, id, "save-failed");

    await writeAudit(
      {
        action: "budget_change",
        targetType: "client",
        targetId: id,
        clientId: id,
        detail:
          `AEO providers set to ${chosen.join("+")} (was ${(before.aeo_providers ?? []).join("+") || "none"}), ` +
          `cadence ${freq} (was ${before.ai_frequency ?? "weekly"})`,
      },
      profile
    );
    return back(req, id, "saved");
  }

  // ── client profile + integration ids ───────────────────────────────────────
  if (section === "profile") {
    const tier = opt(form, "tier");
    const clientType = opt(form, "client_type");

    if (tier && !(TIERS as readonly string[]).includes(tier)) return back(req, id, "bad-tier");
    if (clientType && !TYPES.includes(clientType)) return back(req, id, "bad-type");

    const patch: Record<string, unknown> = {
      name: opt(form, "name") ?? before.name,
      domain: opt(form, "domain") ?? before.domain,
      tier,
      // Nullable on purpose: clearing a client type is a legitimate action, and
      // the tab set falls back to the safe universal set rather than guessing.
      client_type: clientType,
      gsc_property: opt(form, "gsc_property"),
      ga4_property_id: opt(form, "ga4_property_id"),
      clickup_list_id: opt(form, "clickup_list_id"),
      postflow_group_id: opt(form, "postflow_group_id"),
      bloom_brand_id: opt(form, "bloom_brand_id"),
      // module/daily-brief: an Incoming Webhook URL for this client's own Slack
      // channel. Plain text, not vaulted — same trust level as the other
      // integration IDs on this form (revocable in Slack in seconds if pasted
      // somewhere it shouldn't be, unlike a platform credential).
      slack_webhook_url: opt(form, "slack_webhook_url"),
      // The monthly commitment the plan is built against. Null means "no stated
      // cadence", and the planner falls back to the playbook minimum and says so.
      social_posts_per_month: opt(form, "social_posts_per_month")
        ? Number(opt(form, "social_posts_per_month"))
        : null,
      // Standing tags, applied to every post for this client. Stored normalised
      // so "#SaltyDog", "saltydog" and " #saltydog " cannot become three tags.
      hashtag_core: opt(form, "hashtag_core")
        ? Array.from(new Set(
            String(opt(form, "hashtag_core"))
              .split(/[\s,]+/)
              .map((t) => t.trim())
              .filter(Boolean)
              .map((t) => (t.startsWith("#") ? t : `#${t}`))
          )).slice(0, 5)
        : null,
      // Normalised hard: someone will paste "https://www.Salt-Away.com/products"
      // and the matcher compares hostnames, so it has to be stored as a bare
      // lower-case domain or the block silently fails.
      competitor_domains: String(opt(form, "competitor_domains") ?? "")
        .split(/[\s,]+/)
        .map((d) => d.trim().toLowerCase()
          .replace(/^https?:\/\//, "")
          .replace(/^www\./, "")
          .split("/")[0])
        .filter((d) => d.length > 2 && d.includes(".")),
      active: form.get("active") === "on",
    };

    const { error } = await db.from("clients").update(patch).eq("id", id);
    if (error) return back(req, id, "save-failed");

    // Only record what actually changed — an audit row saying "profile updated"
    // with 12 identical fields is noise that hides the one that moved.
    const changed: Record<string, [unknown, unknown]> = {};
    for (const [k, v] of Object.entries(patch)) {
      if ((before as Record<string, unknown>)[k] !== v) changed[k] = [(before as Record<string, unknown>)[k], v];
    }
    if (Object.keys(changed).length) {
      await writeAudit(
        { action: "budget_change", targetType: "client", targetId: id, clientId: id,
          before: Object.fromEntries(Object.entries(changed).map(([k, [a]]) => [k, a])),
          after: Object.fromEntries(Object.entries(changed).map(([k, [, b]]) => [k, b])),
          detail: `settings: ${Object.keys(changed).join(", ")}` },
        profile
      );
    }
    return back(req, id, "saved");
  }

  // ── platform connection (shopify / wordpress) ──────────────────────────────
  if (section === "connection") {
    // Credentials are owner-only. A pod lead needs to SEE whether a connection
    // works; they do not need to be able to replace a client's credentials.
    if (profile!.role !== "owner") return back(req, id, "owner-only");

    const platform = String(form.get("platform") ?? "");
    if (!["shopify", "wordpress"].includes(platform)) return back(req, id, "bad-platform");

    const domain = opt(form, "store_domain");
    const user = opt(form, "store_user");
    const secret = opt(form, "store_secret");
    const authRef = `${platform}:${id}`;

    if (secret) {
      // Rotate rather than create: this path is used to REPLACE a credential at
      // least as often as to set one, and a create would fail on the unique name.
      const { error } = await db.rpc("vault_rotate_secret", { p_secret: secret, p_name: authRef });
      if (error) return back(req, id, "vault-failed");
    }

    const { data: existing } = await db
      .from("client_stores").select("id").eq("client_id", id).eq("platform", platform).maybeSingle();

    const row = {
      client_id: id, platform,
      domain: domain ?? undefined,
      api_client_id: user ?? undefined,
      auth_ref: authRef,
      status: "active",
    };

    const { error } = existing
      ? await db.from("client_stores").update(row).eq("id", existing.id)
      : await db.from("client_stores").insert({ ...row, domain: domain ?? "", api_client_id: user ?? "" });

    if (error) return back(req, id, "save-failed");

    await writeAudit(
      { action: "budget_change", targetType: "client", targetId: id, clientId: id,
        detail: `${platform} connection updated${secret ? " (credential rotated)" : ""}` },
      profile
    );
    return back(req, id, secret ? "connection-saved-secret" : "connection-saved");
  }

  return back(req, id, "unknown-section");
}
