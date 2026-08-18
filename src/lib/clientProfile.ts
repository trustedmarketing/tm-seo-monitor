// lib/clientProfile.ts — validating and shaping a client row before it is written.
//
// Onboarding a client (plan Appendix A) starts in /admin, which until now wrote
// four fields and defaulted the rest. Two of those defaults are wrong often
// enough to matter:
//
//   · location_code defaults to 2840 — the United States as a whole. For a local
//     service client that silently tracks national rankings for a business that
//     only competes in one metro, and the numbers look plausible either way.
//   · client_type is left null, so the workspace falls back to the universal tab
//     set and Revenue/GBP are decided by a guess nobody made.
//
// The GA4 rule here exists because of a specific failure: clients.ga4_property_id
// held a property that was not the client's, the collector failed daily for six
// days, and GA4's error never named the property it was refusing. A measurement
// ID (G-…) pasted into a property-ID field produces exactly that error, so it is
// rejected by name rather than by a generic "invalid".

// "Project" is a real engagement type, not a retainer rung — fixed-scope work
// rather than an ongoing tier. It sits last because the first three are ordered
// by commitment and it does not belong on that ladder.
//
// No migration needed: clients.tier is plain text (001_core.sql). The only thing
// that ever constrained it was this list, which existed in three copies until
// the other two started importing it from here.
export const TIERS = ["Consistency", "Momentum", "Dominate", "Project"] as const;
export const CLIENT_TYPES = ["local_service", "national_ecom", "hybrid"] as const;
export const STORE_PLATFORMS = ["shopify", "woocommerce", "custom"] as const;

export type Tier = (typeof TIERS)[number];
export type ClientTypeValue = (typeof CLIENT_TYPES)[number];

/** DataForSEO's code for the United States — the national default. */
export const US_LOCATION_CODE = 2840;

export type Normalised<T> = { value: T } | { error: string };

/**
 * A GA4 *property* ID: digits only.
 *
 * Accepts what people actually paste — `properties/539468239`, stray whitespace —
 * and names the two IDs that get confused with it, because both are visible in
 * the same GA4 screens and neither works.
 */
export function normaliseGa4PropertyId(input: string | null | undefined): Normalised<string | null> {
  const raw = (input ?? "").trim();
  if (!raw) return { value: null };

  const stripped = raw.replace(/^properties\//i, "").trim();

  if (/^G-/i.test(stripped)) {
    return { error: "That is a measurement ID (G-…), not a property ID. The property ID is the number in GA4 → Admin → Property Settings." };
  }
  if (/^GTM-/i.test(stripped)) {
    return { error: "That is a Google Tag Manager container ID, not a GA4 property ID." };
  }
  if (/^UA-/i.test(stripped)) {
    return { error: "That is a Universal Analytics ID. UA properties stopped collecting data in 2023 — use the GA4 property ID." };
  }
  if (!/^\d+$/.test(stripped)) {
    return { error: "A GA4 property ID is digits only." };
  }

  return { value: stripped };
}

/**
 * A Search Console `siteUrl`, in one of the exactly two forms Google accepts.
 *
 * `clients.gsc_property` is passed verbatim into the API path (`lib/gsc.ts`),
 * so a near-miss does not degrade — it matches no property and returns **403**,
 * which reads as a permissions problem. That ambiguity is expensive: on GA4 the
 * same class of mistake cost six days and three unnecessary access grants.
 *
 * This validator exists because it was the only field on the client row with no
 * normaliser, and twelve of nineteen production clients were found holding
 * `sc-domain:https://example.com/` — a blend of both forms that can never match.
 * The two rows that were correct were exactly the two Domain properties, which
 * is the tell: someone took a URL-prefix property and prefixed it anyway.
 *
 *   Domain property      → `sc-domain:example.com`      (no scheme, no slash)
 *   URL-prefix property  → `https://example.com/`       (scheme AND trailing slash)
 *
 * A bare `example.com` is rejected rather than guessed at: it is a valid Domain
 * property missing its prefix *and* a valid URL-prefix property missing its
 * scheme, and picking one silently is how the wrong property gets tracked for a
 * month. Search Console's own property picker shows which type it is — bare
 * hostname or full URL — so the answer is always one glance away.
 */
export function normaliseGscProperty(input: string | null | undefined): Normalised<string | null> {
  const raw = (input ?? "").trim();
  if (!raw) return { value: null };

  if (/^sc-domain:/i.test(raw)) {
    // Strip the prefix and whatever was wrongly attached to it.
    const rest = raw.replace(/^sc-domain:/i, "").trim();

    if (/^https?:\/\//i.test(rest)) {
      const host = rest.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
      return {
        error: `"${raw}" mixes both property forms. Use "sc-domain:${host.toLowerCase()}" for a Domain property, or "${rest.toLowerCase().replace(/\/?$/, "/")}" for a URL-prefix one — never both.`,
      };
    }

    // A trailing slash on the domain form is unambiguous, so fix rather than refuse.
    const host = rest.replace(/\/+$/, "").toLowerCase();
    if (!host) return { error: `"${raw}" has no domain after "sc-domain:".` };
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) {
      return { error: `"${host}" is not a domain. A Domain property is "sc-domain:example.com".` };
    }
    return { value: `sc-domain:${host}` };
  }

  if (/^https?:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return { error: `"${raw}" is not a URL.` };
    }
    // Google's URL-prefix siteUrl always ends in a slash — appending one is the
    // only possible reading, so it is corrected rather than rejected.
    const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    return { value: `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${path}${url.search}` };
  }

  return {
    error: `"${raw}" is missing its form. Search Console shows the property type in its picker: a bare hostname is a Domain property — enter "sc-domain:${raw.toLowerCase()}"; a full URL is a URL-prefix property — enter "https://${raw.toLowerCase()}/".`,
  };
}

/**
 * The bare host. Everything joins to `clients.domain`, and it is unique, so
 * `https://Example.com/path` and `example.com` must not become two clients.
 *
 * `www.` is deliberately NOT stripped: it is part of how the domain is matched
 * against GSC properties and DataForSEO targets, and quietly changing it would
 * repoint an existing client's data.
 */
export function normaliseDomain(input: string | null | undefined): Normalised<string> {
  const host = (input ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "");

  if (!host) return { error: "Domain is required." };
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return { error: `"${host}" is not a domain.` };

  return { value: host };
}

/** DataForSEO location code — a positive integer, and never silently defaulted on edit. */
export function normaliseLocationCode(input: unknown): Normalised<number> {
  if (input === "" || input == null) return { value: US_LOCATION_CODE };
  const n = Number(input);
  if (!Number.isInteger(n) || n <= 0) return { error: "Location code is a whole number from DataForSEO's location list (2840 = United States)." };
  return { value: n };
}

export function normaliseTier(input: string | null | undefined): Normalised<string | null> {
  const v = (input ?? "").trim();
  if (!v) return { value: null };
  if (!(TIERS as readonly string[]).includes(v)) return { error: `"${v}" is not a tier.` };
  return { value: v };
}

export function normaliseClientType(input: string | null | undefined): Normalised<string | null> {
  const v = (input ?? "").trim();
  if (!v) return { value: null };
  if (!(CLIENT_TYPES as readonly string[]).includes(v)) return { error: `"${v}" is not a client type.` };
  return { value: v };
}

export function normaliseStorePlatform(input: string | null | undefined): Normalised<string | null> {
  const v = (input ?? "").trim().toLowerCase();
  if (!v) return { value: null };
  if (!(STORE_PLATFORMS as readonly string[]).includes(v)) return { error: `"${v}" is not a store platform.` };
  return { value: v };
}

/**
 * Service areas for local rank tracking: `[{ city, county?, location_code }, …]`.
 *
 * ⚠️ STORED BUT NOT YET USED. Nothing in the collection path reads
 * `clients.service_areas` — `serpPosition()` takes a single `location_code` and
 * that is the only field affecting what gets tracked. The column and this parser
 * exist ahead of multi-area rank tracking; until that ships, filling it in
 * changes nothing, and anyone relying on it would be tracking one area while
 * believing they were tracking five.
 *
 * Entered as one area per line — `Dallas, TX | 1026339` — rather than raw JSON,
 * because the person onboarding a client is copying codes out of DataForSEO's
 * list, not authoring a document. County is optional and rarely known up front.
 */
export function parseServiceAreas(input: string | null | undefined): Normalised<Array<Record<string, unknown>> | null> {
  const text = (input ?? "").trim();
  if (!text) return { value: null };

  const areas: Array<Record<string, unknown>> = [];
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [name, code] = line.split("|").map((p) => p.trim());
    if (!name || !code) return { error: `"${line}" — expected "City, ST | location_code".` };
    const n = Number(code);
    if (!Number.isInteger(n) || n <= 0) return { error: `"${code}" is not a location code.` };
    areas.push({ city: name, location_code: n });
  }

  return { value: areas.length ? areas : null };
}

export type ClientRowInput = Record<string, unknown>;

/**
 * Build the row to write.
 *
 * On UPDATE only the keys actually present in the request are included. The
 * previous version rebuilt the whole row from whatever the client had in memory,
 * so changing a collection frequency in /admin rewrote tier, GSC property and
 * location code from a possibly-stale copy — silently reverting anything the
 * Settings screen had changed in another tab. A partial update cannot do that.
 */
export function buildClientRow(
  body: ClientRowInput,
  mode: "insert" | "update"
): { row: Record<string, unknown> } | { error: string } {
  const row: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

  const put = <T,>(key: string, result: Normalised<T>): string | null => {
    if ("error" in result) return result.error;
    row[key] = result.value;
    return null;
  };

  if (mode === "insert" || has("name")) {
    const name = String(body.name ?? "").trim();
    if (!name) return { error: "Name is required." };
    row.name = name;
  }

  if (mode === "insert" || has("domain")) {
    const e = put("domain", normaliseDomain(body.domain as string));
    if (e) return { error: e };
  }

  if (mode === "insert" || has("tier")) {
    const e = put("tier", normaliseTier(body.tier as string));
    if (e) return { error: e };
  }

  if (mode === "insert" || has("client_type")) {
    const e = put("client_type", normaliseClientType(body.client_type as string));
    if (e) return { error: e };
  }

  if (mode === "insert" || has("location_code")) {
    const e = put("location_code", normaliseLocationCode(body.location_code));
    if (e) return { error: e };
  }

  if (mode === "insert" || has("ga4_property_id")) {
    const e = put("ga4_property_id", normaliseGa4PropertyId(body.ga4_property_id as string));
    if (e) return { error: e };
  }

  if (has("store_platform")) {
    const e = put("store_platform", normaliseStorePlatform(body.store_platform as string));
    if (e) return { error: e };
  }

  if (has("service_areas")) {
    // Already-structured input (an API caller) passes through; a textarea parses.
    const raw = body.service_areas;
    if (Array.isArray(raw) || raw === null) {
      row.service_areas = raw;
    } else {
      const e = put("service_areas", parseServiceAreas(raw as string));
      if (e) return { error: e };
    }
  }

  if (mode === "insert" || has("gsc_property")) {
    const e = put("gsc_property", normaliseGscProperty(body.gsc_property as string));
    if (e) return { error: e };
  }

  for (const f of ["core_frequency", "serp_frequency", "crawl_frequency"] as const) {
    if (has(f)) row[f] = body[f];
  }

  if (mode === "insert") {
    row.core_frequency ||= "weekly";
    row.serp_frequency ||= "weekly";
    row.crawl_frequency ||= "monthly";
  }

  return { row };
}
