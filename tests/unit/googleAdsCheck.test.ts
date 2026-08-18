import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { API_VERSION } from "@/lib/googleAds";
import { classifyApiFailure, normaliseCustomerId, readCustomerRow } from "@/lib/googleAdsCheck";

describe("normaliseCustomerId", () => {
  it("takes the id as the Ads UI writes it", () => {
    // 759-807-7939 is how arX Display's customer id appears in Google's own UI;
    // the request path wants it bare.
    expect(normaliseCustomerId("759-807-7939")).toEqual({ id: "7598077939", problem: null });
  });

  it("takes an already-bare id unchanged", () => {
    expect(normaliseCustomerId("7598077939")).toEqual({ id: "7598077939", problem: null });
  });

  it("trims a pasted value", () => {
    expect(normaliseCustomerId("  7598077939\n")).toEqual({ id: "7598077939", problem: null });
  });

  it("rejects a Meta ad account id", () => {
    // The failure this exists for: ad_platform_accounts holds both platforms,
    // so the wrong external_id is a copy-paste away and Google answers it with
    // an opaque 404 that names nothing.
    const out = normaliseCustomerId("act_1761764321488072");
    expect(out.id).toBe("");
    expect(out.problem).toMatch(/Meta ad account/);
  });

  it("rejects empty", () => {
    expect(normaliseCustomerId("")).toEqual({ id: "", problem: "empty" });
    expect(normaliseCustomerId(null)).toEqual({ id: "", problem: "empty" });
    expect(normaliseCustomerId(undefined)).toEqual({ id: "", problem: "empty" });
  });

  it("flags an odd length but still returns the id", () => {
    // Deliberately not a rejection. Ten is the only length in the wild, but
    // refusing a working account to satisfy a pattern is the worse error —
    // Google's answer is the real test.
    const out = normaliseCustomerId("12345");
    expect(out.id).toBe("12345");
    expect(out.problem).toMatch(/5 digits/);
  });
});

describe("readCustomerRow", () => {
  const camel = [
    {
      results: [
        {
          customer: {
            id: "7598077939",
            descriptiveName: "arX Display",
            currencyCode: "USD",
            timeZone: "America/Los_Angeles",
            manager: false,
            testAccount: false,
          },
        },
      ],
    },
  ];

  it("reads the camelCase the REST transport actually returns", () => {
    // The trap: the GAQL asks for customer.descriptive_name and the response
    // carries descriptiveName, so reading back the field you asked for is
    // undefined — which renders as "the account has no name".
    expect(readCustomerRow(camel)).toEqual({
      name: "arX Display",
      currency: "USD",
      time_zone: "America/Los_Angeles",
      is_manager: false,
      is_test_account: false,
    });
  });

  it("reads snake_case too", () => {
    const snake = [
      {
        results: [
          {
            customer: {
              descriptive_name: "arX Display",
              currency_code: "USD",
              time_zone: "America/Los_Angeles",
              manager: false,
              test_account: true,
            },
          },
        ],
      },
    ];
    expect(readCustomerRow(snake)?.name).toBe("arX Display");
    expect(readCustomerRow(snake)?.is_test_account).toBe(true);
  });

  it("returns null for a 200 with no results", () => {
    // Distinct from a failure: the credentials worked and the id matched
    // nothing. Reporting that as an auth problem sends you at the wrong system.
    expect(readCustomerRow([])).toBeNull();
    expect(readCustomerRow([{}])).toBeNull();
    expect(readCustomerRow([{ results: [] }])).toBeNull();
  });

  it("survives a body that is not the shape we expect", () => {
    expect(readCustomerRow(null)).toBeNull();
    expect(readCustomerRow({ error: "nope" })).toBeNull();
    expect(readCustomerRow([{ results: [{ notCustomer: {} }] }])).toBeNull();
  });

  it("finds the row in a later batch", () => {
    // searchStream returns an array of batches; the first can be empty.
    expect(readCustomerRow([{ results: [] }, ...camel])?.name).toBe("arX Display");
  });

  it("treats a missing flag as false, not undefined", () => {
    const bare = [{ results: [{ customer: { descriptiveName: "x" } }] }];
    expect(readCustomerRow(bare)?.is_manager).toBe(false);
    expect(readCustomerRow(bare)?.is_test_account).toBe(false);
  });
});

describe("classifyApiFailure", () => {
  // Verbatim shape of what googleapis.com returned for the sunset v18 on
  // 2026-08-18 — an HTML page, not an API error.
  const SUNSET_HTML =
    '<!DOCTYPE html>\n<html lang=en>\n  <meta charset=utf-8>\n' +
    '  <title>Error 404 (Not Found)!!1</title>\n  <style>*{margin:0;padding:0}</style>\n';

  it("names a sunset API version rather than surfacing the HTML", () => {
    // The whole point: this arrived as `status: 404` and read like a bad
    // customer id, so it sent us at the account for months. It is neither the
    // credentials nor the account — the versioned path stopped existing.
    const out = classifyApiFailure(404, SUNSET_HTML);
    expect(out.failed_at).toBe("api_version_sunset");
    expect(out.hint).toMatch(/sunset/);
    expect(out.hint).toMatch(/API_VERSION in src\/lib\/googleAds\.ts/);
  });

  it("summarises the HTML instead of pasting it", () => {
    // A 600-char slice of a Google error page is noise that buries the verdict.
    const out = classifyApiFailure(404, SUNSET_HTML);
    expect(out.google_says).not.toMatch(/<html|DOCTYPE/i);
    expect(out.google_says).toMatch(new RegExp(`${SUNSET_HTML.length} bytes`));
  });

  it("matches <html> with no doctype, and ignores leading whitespace", () => {
    expect(classifyApiFailure(404, "\n  <html><body>nope").failed_at).toBe("api_version_sunset");
  });

  it("passes a real JSON API error straight through", () => {
    const json = JSON.stringify([{ error: { status: "PERMISSION_DENIED", message: "not linked" } }]);
    const out = classifyApiFailure(403, json);
    expect(out.failed_at).toBe("google_ads_call");
    expect(out.google_says).toContain("PERMISSION_DENIED");
    expect(out.hint).toMatch(/developer token not approved/);
  });

  it("does not mistake JSON that merely mentions html for a sunset", () => {
    const json = JSON.stringify([{ error: { message: "invalid <html> in asset text" } }]);
    expect(classifyApiFailure(400, json).failed_at).toBe("google_ads_call");
  });

  it("truncates a very long JSON error", () => {
    const out = classifyApiFailure(400, "x".repeat(5000));
    expect(out.google_says.length).toBe(600);
  });
});

describe("API_VERSION has exactly one definition", () => {
  // v18 was hardcoded in three files — the collector's client, the execution
  // adapter and the ops check. When it sunset, all three died and fixing it
  // meant knowing all three existed. This fails if a fourth copy appears.
  const SRC = new URL("../../src/", import.meta.url).pathname;

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".ts") || e.name.endsWith(".tsx") ? [join(dir, e.name)] : []
    );
  }

  it("is exported from lib/googleAds.ts and looks like a version", () => {
    expect(API_VERSION).toMatch(/^v\d+$/);
  });

  it("no other source file hardcodes a versioned googleads URL", () => {
    const offenders = walk(SRC).filter((f) => {
      if (f.endsWith("src/lib/googleAds.ts")) return false; // the one true home
      const body = readFileSync(f, "utf8").replace(/\/\/.*$/gm, ""); // ignore comments
      return /googleads\.googleapis\.com\/v\d+|["'`]v\d+["'`]\s*;/.test(body);
    });
    expect(offenders.map((f) => f.replace(SRC, "src/"))).toEqual([]);
  });
});
