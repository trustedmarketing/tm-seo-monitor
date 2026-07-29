import { describe, it, expect, vi } from "vitest";
import { belongsTo, hostOf, classify, applyPolicy, normalisePath } from "@/lib/linkPolicy";

const L = (url: string, anchor = "x") => ({ url, anchor });

describe("belongsTo", () => {
  it("matches the domain and its subdomains", () => {
    expect(belongsTo("salt-away.com", "salt-away.com")).toBe(true);
    expect(belongsTo("shop.salt-away.com", "salt-away.com")).toBe(true);
    expect(belongsTo("www.salt-away.com", "salt-away.com")).toBe(true);
  });

  // The bug this function exists to prevent: a substring match would block or
  // allow the wrong site entirely.
  it("does not match a domain that merely contains the string", () => {
    expect(belongsTo("notsalt-away.com", "salt-away.com")).toBe(false);
    expect(belongsTo("salt-away.com.evil.com", "salt-away.com")).toBe(false);
  });

  it("ignores an empty competitor entry rather than matching everything", () => {
    expect(belongsTo("anything.com", "")).toBe(false);
    expect(belongsTo("anything.com", "   ")).toBe(false);
  });
});

describe("hostOf", () => {
  it("rejects non-http schemes", () => {
    expect(hostOf("javascript:alert(1)")).toBeNull();
    expect(hostOf("mailto:a@b.com")).toBeNull();
    expect(hostOf("ftp://x.com")).toBeNull();
  });

  it("rejects nonsense", () => {
    expect(hostOf("not a url")).toBeNull();
    expect(hostOf("")).toBeNull();
  });
});

describe("classify", () => {
  const opts = { ownDomain: "getsaltydog.com", competitors: ["salt-away.com", "saltsgone.com"] };

  it("blocks a competitor outright", () => {
    const v = classify(L("https://salt-away.com/how-it-works"), opts);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("competitor");
  });

  it("blocks a competitor subdomain", () => {
    expect(classify(L("https://blog.saltsgone.com/x"), opts).reason).toBe("competitor");
  });

  it("allows a genuine third party", () => {
    expect(classify(L("https://www.boatus.com/expert-advice"), opts).ok).toBe(true);
  });

  it("allows an internal link to a page we know exists", () => {
    const v = classify(L("https://getsaltydog.com/pages/how-to-use"), {
      ...opts, knownPages: new Set(["/pages/how-to-use"]),
    });
    expect(v.ok).toBe(true);
  });

  // The model guesses tidy URLs on the client's own domain most readily,
  // because the domain is right there in the prompt.
  it("blocks an internal link to a page that does not exist", () => {
    const v = classify(L("https://getsaltydog.com/pages/invented"), {
      ...opts, knownPages: new Set(["/pages/how-to-use"]),
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("not_on_site");
  });

  it("rejects a malformed url", () => {
    expect(classify(L("htp:/broken"), opts).reason).toBe("malformed");
  });
});

describe("normalisePath", () => {
  it("strips the trailing slash and keeps root as /", () => {
    expect(normalisePath("https://x.com/a/b/")).toBe("/a/b");
    expect(normalisePath("https://x.com/")).toBe("/");
    expect(normalisePath("https://x.com")).toBe("/");
  });
});

describe("applyPolicy", () => {
  const base = { ownDomain: "getsaltydog.com", competitors: ["salt-away.com"] };

  it("drops an unreachable external link", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const { kept, rejected } = await applyPolicy([L("https://example.com/gone")], { ...base, fetchImpl });
    expect(kept).toHaveLength(0);
    expect(rejected[0].reason).toBe("unreachable");
    expect(rejected[0].status).toBe(404);
  });

  it("keeps a link that resolves", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 })) as unknown as typeof fetch;
    const { kept } = await applyPolicy([L("https://example.com/good")], { ...base, fetchImpl });
    expect(kept).toHaveLength(1);
  });

  it("treats a redirect as alive", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 301 })) as unknown as typeof fetch;
    const { kept } = await applyPolicy([L("https://example.com/moved")], { ...base, fetchImpl });
    expect(kept).toHaveLength(1);
  });

  it("treats a timeout as unreachable rather than throwing", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("aborted"); }) as unknown as typeof fetch;
    const { kept, rejected } = await applyPolicy([L("https://example.com/slow")], { ...base, fetchImpl });
    expect(kept).toHaveLength(0);
    expect(rejected[0].reason).toBe("unreachable");
  });

  it("never fetches a competitor link", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 })) as unknown as typeof fetch;
    await applyPolicy([L("https://salt-away.com/x")], { ...base, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("counts a source cited twice as one source", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 })) as unknown as typeof fetch;
    const { kept } = await applyPolicy(
      [L("https://example.com/a"), L("https://EXAMPLE.com/a".toLowerCase())],
      { ...base, fetchImpl }
    );
    expect(kept).toHaveLength(1);
  });

  it("does not hit the network for internal links", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 })) as unknown as typeof fetch;
    const { kept } = await applyPolicy([L("https://getsaltydog.com/pages/x")], {
      ...base, knownPages: new Set(["/pages/x"]), fetchImpl,
    });
    expect(kept).toHaveLength(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
