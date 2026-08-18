// lib/googleAdsCheck.ts — the two pure pieces of api/ops/google-ads-check.
//
// Split out because both encode a mistake that is easy to make and invisible
// once made: a customer id that carries formatting, and a searchStream response
// whose field names are not the ones the GAQL query asked for.

/** What a Google Ads customer id looks like once it is fit to put in a URL. */
export interface CustomerId {
  /** Digits only — what goes in the request path. Empty when unusable. */
  id: string;
  /** Human-readable reason this cannot be used, or null when it can. */
  problem: string | null;
}

// Google Ads customer ids are ten digits, written 123-456-7890 everywhere in
// the UI. The collector strips dashes before building the request path, so a
// dashed value in external_id works — but an `act_` prefix (copied off a Meta
// account) or a stray quote does not, and both fail as an opaque 404 from
// Google rather than as anything that names the value.
//
// Length is reported rather than enforced: ten is the only length in the wild,
// but refusing a nine-digit id would break a working account to satisfy a
// pattern, and the request itself is the real test.
export function normaliseCustomerId(raw: string | null | undefined): CustomerId {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { id: "", problem: "empty" };

  const stripped = trimmed.replace(/[-\s]/g, "");
  if (!/^\d+$/.test(stripped)) {
    return {
      id: "",
      problem: `"${trimmed}" is not a Google Ads customer id — those are digits only (dashes and spaces are fine, anything else is not). A value starting "act_" is a Meta ad account.`,
    };
  }
  if (stripped.length !== 10) {
    return {
      id: stripped,
      problem: `"${trimmed}" is ${stripped.length} digits; Google Ads customer ids are 10. Checking it anyway — Google's answer is the real test.`,
    };
  }
  return { id: stripped, problem: null };
}

/** The account facts worth eyeballing against the Google Ads UI. */
export interface CustomerSummary {
  name: string | null;
  currency: string | null;
  time_zone: string | null;
  is_manager: boolean;
  is_test_account: boolean;
}

type Json = Record<string, unknown>;

// GAQL is written in snake_case (`customer.descriptive_name`) and the REST
// transport answers in camelCase (`descriptiveName`), so reading back the field
// you asked for returns undefined. Accept both rather than depend on which
// transport answered — a null name here would read as "the account has no
// name", which is a different and misleading problem.
function pick(obj: Json, camel: string, snake: string): unknown {
  return obj[camel] ?? obj[snake];
}

/**
 * Pulls the single customer row out of a searchStream response body.
 * Returns null when the response carries no row — which is itself an answer:
 * a 200 with no results means the id resolved but the query matched nothing.
 */
export function readCustomerRow(body: unknown): CustomerSummary | null {
  const batches = Array.isArray(body) ? body : [body];
  for (const batch of batches) {
    const results = (batch as Json | null)?.results;
    if (!Array.isArray(results)) continue;
    for (const row of results) {
      const customer = (row as Json | null)?.customer as Json | undefined;
      if (!customer) continue;
      return {
        name: (pick(customer, "descriptiveName", "descriptive_name") as string) ?? null,
        currency: (pick(customer, "currencyCode", "currency_code") as string) ?? null,
        time_zone: (pick(customer, "timeZone", "time_zone") as string) ?? null,
        is_manager: pick(customer, "manager", "manager") === true,
        is_test_account: pick(customer, "testAccount", "test_account") === true,
      };
    }
  }
  return null;
}

/** How a failed Google Ads call should be reported. */
export interface ApiFailure {
  failed_at: string;
  hint: string;
  /** Google's own words, trimmed. HTML is summarised rather than dumped. */
  google_says: string;
}

// Google Ads answers a *sunset* API version with an HTML 404 from the generic
// googleapis front door — not a JSON error, because the versioned path no
// longer routes anywhere. Every caller here reports that as "404 Not Found",
// which reads like a bad customer id and sends you at the account.
//
// That is what happened to v18: it took the collector, the execution adapter
// and this check with it, and the symptom pointed at the wrong system the whole
// time. So the HTML is diagnosed, not surfaced.
export function classifyApiFailure(status: number, body: string): ApiFailure {
  const looksHtml = /^\s*(<!doctype html|<html)/i.test(body);

  if (looksHtml) {
    return {
      failed_at: "api_version_sunset",
      hint:
        `Google answered ${status} with an HTML error page rather than a JSON API error, which means the versioned path no longer exists — the API version is sunset, not the credentials or the account. ` +
        "Find the live versions by probing unauthenticated (no credentials needed): a live version answers JSON UNAUTHENTICATED, a dead one answers this HTML. Then bump API_VERSION in src/lib/googleAds.ts.",
      google_says: `HTML error page (${body.length} bytes) — the generic googleapis 404, carrying no API detail.`,
    };
  }

  return {
    failed_at: "google_ads_call",
    hint:
      "Google rejected the call. Its message below distinguishes the cases that look identical from here: a developer token not approved for production, a customer not linked under this MCC, and a customer id that does not exist.",
    google_says: body.slice(0, 600),
  };
}
