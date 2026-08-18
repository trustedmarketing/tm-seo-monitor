import { describe, it, expect } from "vitest";
import { normaliseCustomerId, readCustomerRow } from "@/lib/googleAdsCheck";

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
