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
