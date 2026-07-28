import { describe, it, expect } from "vitest";
import { findArray, describeShape } from "@/lib/apiShape";

// Written after the same envelope mistake in three files in one day. The Bloom
// version used `??`, which falls through on null only — so an object under
// `data` was taken anyway and `.filter is not a function` came back from a line
// that looked like it had a fallback.

describe("findArray", () => {
  it("takes a bare array", () => {
    expect(findArray([1, 2])).toEqual([1, 2]);
  });

  it("takes the common envelope keys", () => {
    expect(findArray({ data: [1] })).toEqual([1]);
    expect(findArray({ items: [2] })).toEqual([2]);
    expect(findArray({ brands: [3] })).toEqual([3]);
    expect(findArray({ social_accounts: [4] })).toEqual([4]);
  });

  it("does NOT take a non-array under a known key — the exact bug", () => {
    // `body.data` is an object. `??` would have returned it and then blown up on
    // .filter. This must keep looking.
    expect(findArray({ data: { items: [7] } })).toEqual([7]);
  });

  it("finds an array nested one level down", () => {
    expect(findArray({ data: { accounts: [1, 2] } })).toEqual([1, 2]);
  });

  it("prefers a known key over an unrelated array", () => {
    // A response carrying both `errors` and `data` must not return `errors`.
    const out = findArray({ errors: ["nope"], data: ["yes"] });
    expect(out).toEqual(["yes"]);
  });

  it("returns undefined rather than [] when there is no array", () => {
    // The distinction the callers depend on: an unrecognised envelope and an
    // empty list are different problems, and reporting the first as the second
    // is what sent us looking at the wrong system twice.
    expect(findArray({ message: "no" })).toBeUndefined();
    expect(findArray(null)).toBeUndefined();
    expect(findArray("string")).toBeUndefined();
    expect(findArray(42)).toBeUndefined();
  });

  it("returns an empty array when the vendor genuinely sent one", () => {
    expect(findArray({ data: [] })).toEqual([]);
  });
});

describe("describeShape", () => {
  it("truncates rather than dumping a whole payload into an error", () => {
    expect(describeShape({ a: "x".repeat(500) }, 50)).toHaveLength(50);
  });

  it("survives something unserialisable", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => describeShape(circular)).not.toThrow();
  });
});

import { normaliseImageUrl } from "@/lib/bloom";

// Bloom's UI gives you a SHARE link to copy. Pasted into an image field it
// renders as nothing — the tag is there, the src is an HTML page, and the slot
// looks broken with no explanation. Tom hit this within a minute of the field
// existing, so converting it is the fix rather than a documentation problem.
describe("normaliseImageUrl", () => {
  it("converts a Bloom share link to the direct asset", () => {
    expect(normaliseImageUrl("https://www.trybloom.ai/i/c0c80f00-4b83-4540-8f19-2dfff4969379"))
      .toBe("https://www.trybloom.ai/img/c0c80f00-4b83-4540-8f19-2dfff4969379");
  });

  it("handles the link without www, and with trailing content", () => {
    expect(normaliseImageUrl("https://trybloom.ai/i/abc123?x=1"))
      .toBe("https://www.trybloom.ai/img/abc123");
  });

  it("leaves an already-direct Bloom URL alone", () => {
    const direct = "https://www.trybloom.ai/img/abc123";
    expect(normaliseImageUrl(direct)).toBe(direct);
  });

  it("does not touch a URL from anywhere else", () => {
    // Someone using their own photograph must not have it rewritten.
    const other = "https://cdn.example.com/i/photo.jpg";
    expect(normaliseImageUrl(other)).toBe(other);
  });

  it("trims surrounding whitespace from a paste", () => {
    expect(normaliseImageUrl("  https://www.trybloom.ai/img/abc  "))
      .toBe("https://www.trybloom.ai/img/abc");
  });
});
