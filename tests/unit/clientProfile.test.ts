import { describe, it, expect } from "vitest";
import {
  buildClientRow,
  normaliseDomain,
  normaliseGa4PropertyId,
  normaliseGscProperty,
  normaliseLocationCode,
  parseServiceAreas,
  US_LOCATION_CODE,
} from "@/lib/clientProfile";

const ok = <T,>(r: { value: T } | { error: string }): T => {
  if ("error" in r) throw new Error(`expected a value, got error: ${r.error}`);
  return r.value;
};
const err = (r: object | { error: string }): string => {
  if (!("error" in r)) throw new Error("expected an error");
  return r.error;
};

describe("normaliseGa4PropertyId", () => {
  it("accepts digits and the properties/ prefix people paste", () => {
    expect(ok(normaliseGa4PropertyId("539468239"))).toBe("539468239");
    expect(ok(normaliseGa4PropertyId(" properties/539468239 "))).toBe("539468239");
    expect(ok(normaliseGa4PropertyId("Properties/539468239"))).toBe("539468239");
  });

  it("treats blank as not set rather than invalid", () => {
    expect(ok(normaliseGa4PropertyId(""))).toBeNull();
    expect(ok(normaliseGa4PropertyId(null))).toBeNull();
  });

  // The six-day GA4 outage was a wrong value in this exact field, and GA4's own
  // error never named the property. Each wrong-ID class gets told apart by name.
  it("names the three IDs that get confused with a property ID", () => {
    expect(err(normaliseGa4PropertyId("G-ABC123XYZ"))).toMatch(/measurement ID/i);
    expect(err(normaliseGa4PropertyId("GTM-ABC123"))).toMatch(/Tag Manager/i);
    expect(err(normaliseGa4PropertyId("UA-12345-1"))).toMatch(/Universal Analytics/i);
  });

  it("rejects anything else non-numeric", () => {
    expect(err(normaliseGa4PropertyId("539468239 (Salty Dog)"))).toMatch(/digits only/i);
  });
});

describe("normaliseDomain", () => {
  it("reduces a pasted URL to the bare host", () => {
    expect(ok(normaliseDomain("https://Example.com/pages/about?x=1"))).toBe("example.com");
    expect(ok(normaliseDomain("  http://getsaltydog.com/  "))).toBe("getsaltydog.com");
    expect(ok(normaliseDomain("example.com."))).toBe("example.com");
  });

  // clients.domain is unique and everything joins to it; www is part of how the
  // domain matches GSC and DataForSEO targets, so stripping it would repoint data.
  it("keeps www", () => {
    expect(ok(normaliseDomain("https://www.example.com"))).toBe("www.example.com");
  });

  it("rejects empty and non-domains", () => {
    expect(err(normaliseDomain(""))).toMatch(/required/i);
    expect(err(normaliseDomain("not a domain"))).toMatch(/not a domain/i);
  });
});

describe("normaliseLocationCode", () => {
  it("defaults to the US only when nothing was given", () => {
    expect(ok(normaliseLocationCode(""))).toBe(US_LOCATION_CODE);
    expect(ok(normaliseLocationCode(null))).toBe(US_LOCATION_CODE);
  });

  it("accepts a code as a string or a number", () => {
    expect(ok(normaliseLocationCode("1026339"))).toBe(1026339);
    expect(ok(normaliseLocationCode(1026339))).toBe(1026339);
  });

  it("rejects junk rather than silently falling back to national", () => {
    expect(err(normaliseLocationCode("Dallas"))).toMatch(/whole number/i);
    expect(err(normaliseLocationCode(-1))).toMatch(/whole number/i);
    expect(err(normaliseLocationCode(12.5))).toMatch(/whole number/i);
  });
});

describe("parseServiceAreas", () => {
  it("parses one area per line", () => {
    expect(ok(parseServiceAreas("Dallas, TX | 1026339\nFort Worth, TX | 1026460"))).toEqual([
      { city: "Dallas, TX", location_code: 1026339 },
      { city: "Fort Worth, TX", location_code: 1026460 },
    ]);
  });

  it("ignores blank lines and surrounding space", () => {
    expect(ok(parseServiceAreas("\n  Dallas, TX  |  1026339  \n\n"))).toEqual([
      { city: "Dallas, TX", location_code: 1026339 },
    ]);
  });

  it("treats empty input as cleared, not as an empty list", () => {
    expect(ok(parseServiceAreas(""))).toBeNull();
    expect(ok(parseServiceAreas("   "))).toBeNull();
  });

  it("names the offending line", () => {
    expect(err(parseServiceAreas("Dallas, TX"))).toMatch(/Dallas, TX/);
    expect(err(parseServiceAreas("Dallas, TX | nope"))).toMatch(/not a location code/i);
  });
});

describe("normaliseGscProperty", () => {
  it("accepts the two forms Google actually accepts", () => {
    expect(ok(normaliseGscProperty("sc-domain:daps.fit"))).toBe("sc-domain:daps.fit");
    expect(ok(normaliseGscProperty("https://getsaltydog.com/"))).toBe("https://getsaltydog.com/");
  });

  it("treats blank as not set rather than invalid", () => {
    expect(ok(normaliseGscProperty(""))).toBeNull();
    expect(ok(normaliseGscProperty(null))).toBeNull();
    expect(ok(normaliseGscProperty("   "))).toBeNull();
  });

  it("rejects the blend that was on twelve production clients", () => {
    const e = err(normaliseGscProperty("sc-domain:https://alphazetaent.com/"));
    expect(e).toMatch(/mixes both/i);
    // The message must carry BOTH corrected forms — the whole failure was not
    // knowing which one this property is.
    expect(e).toContain("sc-domain:alphazetaent.com");
    expect(e).toContain("https://alphazetaent.com/");
  });

  it("refuses to guess at a bare hostname", () => {
    // Ambiguous by construction: a Domain property missing its prefix and a
    // URL-prefix property missing its scheme look identical here.
    const e = err(normaliseGscProperty("arxdisplay.com"));
    expect(e).toMatch(/sc-domain:arxdisplay\.com/);
    expect(e).toMatch(/https:\/\/arxdisplay\.com\//);
  });

  it("fixes what is unambiguous instead of refusing it", () => {
    // Google's URL-prefix siteUrl always ends in a slash; there is one reading.
    expect(ok(normaliseGscProperty("https://cwnow.com"))).toBe("https://cwnow.com/");
    // A trailing slash on the domain form has one reading too.
    expect(ok(normaliseGscProperty("sc-domain:daps.fit/"))).toBe("sc-domain:daps.fit");
  });

  it("normalises case and whitespace but never the path", () => {
    expect(ok(normaliseGscProperty("  SC-Domain:DAPS.Fit  "))).toBe("sc-domain:daps.fit");
    expect(ok(normaliseGscProperty("HTTPS://CWNOW.COM/"))).toBe("https://cwnow.com/");
    // Search Console paths are case-sensitive — a subpath property must survive.
    expect(ok(normaliseGscProperty("https://example.com/Shop"))).toBe("https://example.com/Shop/");
  });

  it("keeps http properties, which Search Console still has", () => {
    expect(ok(normaliseGscProperty("http://example.com/"))).toBe("http://example.com/");
  });

  it("names what is wrong rather than saying invalid", () => {
    expect(err(normaliseGscProperty("sc-domain:"))).toMatch(/no domain/i);
    expect(err(normaliseGscProperty("sc-domain:notadomain"))).toMatch(/not a domain/i);
  });
});

describe("buildClientRow — insert", () => {
  it("fills the defaults a new client needs", () => {
    const built = buildClientRow({ name: "Acme", domain: "https://acme.com/" }, "insert");
    expect("error" in built).toBe(false);
    if ("error" in built) return;
    expect(built.row).toMatchObject({
      name: "Acme",
      domain: "acme.com",
      tier: null,
      client_type: null,
      location_code: US_LOCATION_CODE,
      ga4_property_id: null,
      gsc_property: null,
      core_frequency: "weekly",
      serp_frequency: "weekly",
      crawl_frequency: "monthly",
    });
  });

  it("requires a name and a domain", () => {
    expect(err(buildClientRow({ domain: "acme.com" }, "insert"))).toMatch(/name is required/i);
    expect(err(buildClientRow({ name: "Acme" }, "insert"))).toMatch(/domain is required/i);
  });

  it("refuses an invalid enum rather than letting Postgres say it", () => {
    expect(err(buildClientRow({ name: "A", domain: "a.com", client_type: "ecommerce" }, "insert")))
      .toMatch(/not a client type/i);
    expect(err(buildClientRow({ name: "A", domain: "a.com", tier: "Platinum" }, "insert")))
      .toMatch(/not a tier/i);
  });
});

describe("buildClientRow — update", () => {
  // The bug this replaced: /admin rebuilt the whole row from its own copy of the
  // client, so changing a frequency reverted whatever Settings had just changed.
  it("writes only the fields it was given", () => {
    const built = buildClientRow({ serp_frequency: "daily" }, "update");
    if ("error" in built) throw new Error(built.error);
    expect(built.row).toEqual({ serp_frequency: "daily" });
    expect(built.row).not.toHaveProperty("tier");
    expect(built.row).not.toHaveProperty("location_code");
    expect(built.row).not.toHaveProperty("gsc_property");
  });

  it("distinguishes clearing a field from omitting it", () => {
    const cleared = buildClientRow({ gsc_property: "" }, "update");
    if ("error" in cleared) throw new Error(cleared.error);
    expect(cleared.row).toEqual({ gsc_property: null });

    const omitted = buildClientRow({ name: "Acme" }, "update");
    if ("error" in omitted) throw new Error(omitted.error);
    expect(omitted.row).toEqual({ name: "Acme" });
  });

  it("parses service areas from the textarea and passes structured input through", () => {
    const typed = buildClientRow({ service_areas: "Dallas, TX | 1026339" }, "update");
    if ("error" in typed) throw new Error(typed.error);
    expect(typed.row.service_areas).toEqual([{ city: "Dallas, TX", location_code: 1026339 }]);

    const structured = buildClientRow({ service_areas: [{ city: "Dallas", location_code: 1 }] }, "update");
    if ("error" in structured) throw new Error(structured.error);
    expect(structured.row.service_areas).toEqual([{ city: "Dallas", location_code: 1 }]);
  });

  it("does not default location_code on an update it was not given", () => {
    const built = buildClientRow({ tier: "Dominate" }, "update");
    if ("error" in built) throw new Error(built.error);
    expect(built.row).not.toHaveProperty("location_code");
  });
});
