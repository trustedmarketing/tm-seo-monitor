// api/ops/google-ads-check — diagnose the Google Ads collector for one client.
//
// GA4, Shopify, WordPress and PostFlow all have a per-client verifier. The two
// connections whose failure mode is *silent* — Meta and Google Ads — had none
// (STATUS, 2026-08-18). That matters more here than elsewhere: Google Ads has
// five independent gates and missing any one of them ends in the same place, a
// `skipped` run with an empty Paid tab and a healthy-looking portfolio row.
//
// The gates are walked in the order lib/googleAdsCollector.ts resolves them and
// the first unmet one ends the check, so the answer names the single next thing
// to fix rather than a list to work through. The SOP's fallback for this is a
// hand-written SQL query against collector_runs; `last_run` below is that query,
// so the whole check is reachable without the Supabase console.
//
// Owner-only. Reports identifiers — the MCC id, the customer id, the account's
// own name and currency — because those are what you compare against the Google
// Ads UI. For credentials it reports presence and length only, never a value
// ("secrets never surface", CLAUDE.md autonomy #5).
import { getProfile } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { readSecret } from "@/lib/vault";
import { API_VERSION, CANDIDATE_API_VERSIONS, mintAccessToken, type GoogleAdsOAuth } from "@/lib/googleAds";
import { classifyApiFailure, normaliseCustomerId, readCustomerRow } from "@/lib/googleAdsCheck";
import { mockApis } from "@/lib/apiMock";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Must match the constants in lib/googleAdsCollector.ts and the allowlist in
// api/ops/org-secret — these are the names /dashboard/secrets writes.
const OAUTH_SECRET = "google_ads_oauth";
const DEV_TOKEN_SECRET = "google_ads_developer_token";


interface ClientRow {
  id: string;
  name: string | null;
  domain: string | null;
}

interface AccountRow {
  external_id: string;
  status: string;
  auth_ref: string | null;
}

interface RunRow {
  status: string;
  detail: string | null;
  error: string | null;
  rows_written: number | null;
  started_at: string;
}

export async function GET(req: Request) {
  const profile = await getProfile();
  if (profile?.role !== "owner") {
    return Response.json({ error: "Owner access required" }, { status: 403 });
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get("client");
  const domain = url.searchParams.get("domain");
  const customerOverride = url.searchParams.get("customer");

  const db = dbClient();
  const out: Record<string, unknown> = {};

  // Reported on every answer, pass or fail. A sunset version is the one failure
  // here that is nobody's configuration and everybody's problem, and it is
  // invisible unless the version is on screen next to the error.
  out.api_version = API_VERSION;

  // MOCK_APIS makes the collector read fixtures, so a live check would be
  // answering for a file. Say so rather than returning a green that means
  // nothing — this is the same trap as the crawl bug's lying success path.
  if (mockApis()) {
    return Response.json({
      ok: false,
      failed_at: "mock_apis_enabled",
      hint: "MOCK_APIS=1 — the collector reads tests/fixtures and never calls Google. Unset it before trusting any result here.",
    });
  }

  // 1. Which client, and is there an ad account row for it? This is the gate
  //    arX Display sat behind: no row means a skipped run, and until #55 the
  //    Google collector reported that same condition as success.
  let client: ClientRow | null = null;
  if (clientId || domain) {
    const q = db.from("clients").select("id, name, domain");
    const { data } = await (clientId ? q.eq("id", clientId) : q.eq("domain", domain!)).limit(1);
    client = (data?.[0] as ClientRow | undefined) ?? null;
    if (!client) {
      return Response.json({
        ok: false,
        failed_at: "no_such_client",
        hint: `No clients row matches ${clientId ? `id ${clientId}` : `domain ${domain}`}. Domains are stored lowercased and bare — no scheme, no www.`,
      });
    }
  }

  let account: AccountRow | null = null;
  if (client) {
    const { data } = await db
      .from("ad_platform_accounts")
      .select("external_id, status, auth_ref")
      .eq("client_id", client.id)
      .eq("platform", "google_ads")
      .maybeSingle();
    account = (data as AccountRow | undefined) ?? null;
  } else if (!customerOverride) {
    // No client named — fall back to the first client that has a google_ads row,
    // so the endpoint is useful with no arguments at all.
    const { data } = await db
      .from("ad_platform_accounts")
      .select("external_id, status, auth_ref, client_id")
      .eq("platform", "google_ads")
      .limit(1);
    const first = data?.[0] as (AccountRow & { client_id: string }) | undefined;
    if (first) {
      account = first;
      const { data: c } = await db
        .from("clients")
        .select("id, name, domain")
        .eq("id", first.client_id)
        .maybeSingle();
      client = (c as ClientRow | undefined) ?? null;
    }
  }

  out.client = client ? { id: client.id, name: client.name, domain: client.domain } : null;

  // The SOP's verification query, inlined — this is what you would otherwise
  // open the Supabase console for. Reported whether or not the check passes,
  // because a `skipped` here is the symptom the rest of this explains.
  if (client) {
    const { data: runs } = await db
      .from("collector_runs")
      .select("status, detail, error, rows_written, started_at")
      .eq("client_id", client.id)
      .eq("module", "google_ads")
      .order("started_at", { ascending: false })
      .limit(1);
    const run = runs?.[0] as RunRow | undefined;
    out.last_run = run
      ? {
          status: run.status,
          started_at: run.started_at,
          rows_written: run.rows_written,
          detail: run.detail,
          error: run.error,
        }
      : null;
  }

  out.account_status = account?.status ?? null;
  out.auth_ref = account?.auth_ref ?? null; // a name, not a secret

  if (!account && !customerOverride) {
    return Response.json({
      ok: false,
      failed_at: "no_ad_platform_accounts_row",
      hint: client
        ? `No google_ads row in ad_platform_accounts for ${client.domain}. Insert one with the customer id (digits only) in external_id and auth_ref null — see docs/sop-client-onboarding.md §6.`
        : "No google_ads row exists for any client. Pass ?domain= or ?customer= once one is inserted.",
      ...out,
    });
  }

  const { id: customerId, problem } = normaliseCustomerId(customerOverride ?? account?.external_id);
  out.customer_id = customerId || null;
  if (problem) out.customer_id_note = problem;
  if (!customerId) {
    return Response.json({ ok: false, failed_at: "malformed_customer_id", hint: problem, ...out });
  }

  // 2. Portfolio-level configuration. All three are shared across every client,
  //    so a failure here is never about the client being checked.
  const loginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? "").replace(/-/g, "");
  out.login_customer_id = loginCustomerId || null; // the MCC — an identifier
  if (!loginCustomerId) {
    return Response.json({
      ok: false,
      failed_at: "no_login_customer_id",
      hint: "GOOGLE_ADS_LOGIN_CUSTOMER_ID is not set in this environment. Without it the collector skips every client no matter what is vaulted. Set it to the MCC id, digits only, and redeploy — env changes are baked in at build.",
      ...out,
    });
  }

  const [oauthRaw, devToken] = await Promise.all([
    readSecret(db, OAUTH_SECRET),
    readSecret(db, DEV_TOKEN_SECRET),
  ]);

  out.developer_token = devToken ? { vaulted: true, length: devToken.length } : { vaulted: false };
  if (!devToken) {
    return Response.json({
      ok: false,
      failed_at: "no_developer_token",
      hint: `Nothing vaulted as '${DEV_TOKEN_SECRET}'. Copy it from the MCC (Tools → API Center) and paste it at /dashboard/secrets.`,
      ...out,
    });
  }

  // Narrowed here rather than relied on inside callVersion(): the guard above
  // proves it, but a closure could in principle run later, so TypeScript will
  // not carry the narrowing across the function boundary.
  const developerToken: string = devToken;

  let oauth: GoogleAdsOAuth | null = null;
  try {
    const parsed = JSON.parse(oauthRaw ?? "") as Partial<GoogleAdsOAuth>;
    if (parsed.client_id && parsed.client_secret && parsed.refresh_token) oauth = parsed as GoogleAdsOAuth;
    // Field names only — never a value. A bundle can be present and still be
    // missing the one field that matters.
    out.oauth_bundle = {
      vaulted: true,
      fields_present: (["client_id", "client_secret", "refresh_token"] as const).filter((f) => !!parsed[f]),
    };
  } catch {
    out.oauth_bundle = { vaulted: !!oauthRaw, fields_present: [] };
  }
  if (!oauth) {
    return Response.json({
      ok: false,
      failed_at: "no_oauth_bundle",
      hint: `'${OAUTH_SECRET}' is missing or incomplete. Run \`node scripts/google-oauth.mjs\` and paste the whole .google-oauth.local.json at /dashboard/secrets — it needs client_id, client_secret and refresh_token.`,
      ...out,
    });
  }

  // 3. Does the refresh token still work? Distinct from the API call below:
  //    this one fails when the OAuth app or the grant changed, which is a
  //    different fix from a developer token or an account-link problem.
  let accessToken: string;
  try {
    accessToken = await mintAccessToken(oauth);
  } catch (e) {
    return Response.json({
      ok: false,
      failed_at: "oauth_refresh",
      google_says: String((e as Error).message ?? e).slice(0, 400),
      hint: "The vaulted refresh token was rejected. Re-run scripts/google-oauth.mjs and re-vault the bundle.",
      ...out,
    });
  }

  // 4. The real thing: one row about the account itself. This single request
  //    exercises the developer token, the MCC link and access to this customer
  //    at once — and returns the account's own name, which is the only way to
  //    confirm the customer id points at who you think it does.
  const query =
    "SELECT customer.id, customer.descriptive_name, customer.currency_code, " +
    "customer.time_zone, customer.manager, customer.test_account FROM customer LIMIT 1";

  // One authenticated call, factored so the sweep below can repeat it verbatim
  // against another version. Returns the raw status and body — no throwing, so
  // a version that fails is data rather than an exception.
  async function callVersion(version: string): Promise<{ status: number; body: string }> {
    const res = await fetch(
      `https://googleads.googleapis.com/${version}/customers/${customerId}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": developerToken,
          "login-customer-id": loginCustomerId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      }
    );
    return { status: res.status, body: await res.text() };
  }

  try {
    const requested = url.searchParams.get("version");
    if (requested) out.api_version = requested; // explicit override, reported as used
    const { status, body } = await callVersion(requested ?? API_VERSION);

    // A 404 here means the version/method pair does not dispatch — which is not
    // something an unauthenticated probe can determine (see CANDIDATE_API_VERSIONS).
    // So when the configured version 404s and no version was pinned by hand, ask
    // every candidate and report what each one said. One request, definitive.
    if (status === 404 && !requested) {
      const sweep: Record<string, string> = {};
      let working: string | null = null;
      for (const v of CANDIDATE_API_VERSIONS) {
        const r = v === API_VERSION ? { status, body } : await callVersion(v);
        const isHtml = /^\s*(<!doctype html|<html)/i.test(r.body);
        sweep[v] = r.status === 200
          ? "200 OK — this version works"
          : isHtml
            ? `${r.status} HTML — no such version`
            : `${r.status} ${(/"message":\s*"([^"]{0,90})/.exec(r.body)?.[1] ?? "").trim() || "JSON error"}`;
        if (r.status === 200 && !working) working = v;
      }
      out.version_sweep = sweep;

      if (working) {
        return Response.json({
          ok: false,
          failed_at: "wrong_api_version",
          hint: `The configured API_VERSION (${API_VERSION}) does not serve, but ${working} does — every credential and the account itself are fine. Set API_VERSION = "${working}" in src/lib/googleAds.ts and redeploy. The sweep below is what each version answered to the identical authenticated call.`,
          status,
          ...out,
        });
      }
      return Response.json({
        ok: false,
        failed_at: "no_working_api_version",
        hint: "No candidate version served this call, so the problem is not the version. Read the sweep: if every version returns the same non-404 message, that message is the real error and it is the same one on all of them.",
        status,
        ...out,
      });
    }

    if (status !== 200) {
      // classifyApiFailure separates a sunset API version — which answers HTML
      // from the generic googleapis front door and looks exactly like a bad
      // customer id — from a genuine API rejection.
      return Response.json({ ok: false, status, ...classifyApiFailure(status, body), ...out });
    }

    const account_summary = readCustomerRow(JSON.parse(body));
    out.account = account_summary;

    if (!account_summary) {
      return Response.json({
        ok: false,
        failed_at: "no_customer_row",
        hint: "Google answered 200 with no customer row. The credentials work; this customer id resolved to nothing.",
        ...out,
      });
    }

    return Response.json({
      ok: true,
      hint: account_summary.is_test_account
        ? "Connected — but this is a Google Ads TEST account, so its metrics are synthetic. Real spend will never appear."
        : "Connected. The next scheduled collection will write ad_metrics_daily rows; check last_run after it.",
      ...out,
    });
  } catch (e) {
    return Response.json({
      ok: false,
      failed_at: "google_ads_call",
      google_says: String((e as Error).message ?? e).slice(0, 400),
      ...out,
    });
  }
}
