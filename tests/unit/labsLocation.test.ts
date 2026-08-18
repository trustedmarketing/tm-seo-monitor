import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  labsLocationCode,
  domainRankOverview,
  rankedKeywords,
  competitorsDomain,
  keywordSuggestions,
  serpPosition,
} from "@/lib/dataforseo";

// A metro code that is valid for SERP and rejected by Labs with
// `40501 Invalid Field: 'location_code'` — the failure Papa T's and C&W hit.
const DALLAS = 1026339;
const US = 2840;

describe("labsLocationCode", () => {
  it("passes country codes straight through", () => {
    expect(labsLocationCode(US)).toBe(US);
    expect(labsLocationCode(2826)).toBe(2826); // United Kingdom
    expect(labsLocationCode(2124)).toBe(2124); // Canada
    expect(labsLocationCode(2036)).toBe(2036); // Australia
  });

  it("falls back for the codes Labs rejects", () => {
    expect(labsLocationCode(DALLAS)).toBe(US);   // city
    expect(labsLocationCode(21137)).toBe(US);    // US state
    expect(labsLocationCode(9061134)).toBe(US);  // fine-grained geo target
  });

  it("takes a fallback, so a non-US portfolio is a parameter not a rewrite", () => {
    expect(labsLocationCode(DALLAS, 2826)).toBe(2826);
    // A country code is still preferred over the fallback when there is one.
    expect(labsLocationCode(2124, 2826)).toBe(2124);
  });

  it("treats junk as unset rather than forwarding it to the API", () => {
    expect(labsLocationCode(0)).toBe(US);
    expect(labsLocationCode(-1)).toBe(US);
    expect(labsLocationCode(NaN)).toBe(US);
    expect(labsLocationCode(1.5)).toBe(US);
  });
});

// The unit test above proves the mapping; these prove it is actually WIRED to
// every Labs endpoint. The bug was never the arithmetic — it was that four call
// sites passed clients.location_code straight through.
describe("which location code reaches the wire", () => {
  let bodies: Array<{ path: string; payload: Record<string, unknown> }>;

  beforeEach(() => {
    bodies = [];
    vi.stubEnv("MOCK_APIS", "0");
    // Dummy credentials: authHeader() throws without them, and this suite is
    // asserting on the request body rather than on auth.
    vi.stubEnv("DATAFORSEO_LOGIN", "test@example.com");
    vi.stubEnv("DATAFORSEO_PASSWORD", "test-password");
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      bodies.push({
        path: String(url),
        payload: JSON.parse(String(init.body))[0],
      });
      return {
        ok: true,
        json: async () => ({ tasks: [{ status_code: 20000, result: [{ items: [] }] }] }),
      };
    }));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const sentLocation = () => bodies[0].payload.location_code;

  it("sends the country code to every Labs endpoint", async () => {
    for (const call of [
      () => domainRankOverview("example.com", DALLAS, "en"),
      () => rankedKeywords("example.com", DALLAS, "en"),
      () => competitorsDomain("example.com", DALLAS, "en"),
      () => keywordSuggestions("patio covers", DALLAS, "en"),
    ]) {
      bodies = [];
      await call();
      expect(bodies[0].path).toContain("/dataforseo_labs/");
      expect(sentLocation()).toBe(US);
    }
  });

  it("leaves SERP on the client's own metro code", async () => {
    // The whole point of setting a metro code is that rankings are measured
    // where the business competes. If this ever starts returning 2840, local
    // clients are silently being tracked nationally — the exact failure the
    // onboarding SOP warns about, reintroduced from the other direction.
    await serpPosition("patio covers dallas", "example.com", DALLAS, "en");
    expect(bodies[0].path).not.toContain("/dataforseo_labs/");
    expect(sentLocation()).toBe(DALLAS);
  });
});
