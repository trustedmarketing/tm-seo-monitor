import { describe, it, expect } from "vitest";
import { sanitiseSchema } from "@/lib/ai";

/**
 * The structured-output validator accepts a subset of JSON Schema and 400s on
 * the rest AT REQUEST TIME. On 2026-07-29 the content-brief schema carried four
 * unsupported keywords and surfaced them one per production deploy. These tests
 * exist so the next schema cannot repeat that.
 */
describe("sanitiseSchema", () => {
  it("strips every keyword class the API rejects", () => {
    const out = sanitiseSchema({
      type: "object",
      properties: {
        title: { type: "string", maxLength: 60, minLength: 3, pattern: "^x" },
        count: { type: "integer", minimum: 300, maximum: 4000, multipleOf: 5 },
        list: { type: "array", minItems: 3, maxItems: 9, uniqueItems: true, items: { type: "string" } },
      },
    }) as any;

    expect(out.properties.title).toEqual({ type: "string" });
    expect(out.properties.count).toEqual({ type: "integer" });
    expect(out.properties.list).toEqual({ type: "array", items: { type: "string" } });
  });

  it("keeps everything the API does support", () => {
    const schema = {
      type: "object",
      required: ["a"],
      additionalProperties: false,
      properties: {
        a: { type: "string", enum: ["x", "y"] },
        b: { type: "string", format: "uri" },
        c: { anyOf: [{ type: "string" }, { type: "null" }] },
        d: { const: 4 },
      },
    };
    expect(sanitiseSchema(schema)).toEqual(schema);
  });

  it("recurses into nested objects and array items", () => {
    const out = sanitiseSchema({
      type: "object",
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string", maxLength: 10 } },
          },
        },
      },
    }) as any;
    expect(out.properties.rows.items.properties.name).toEqual({ type: "string" });
  });

  // The subtle one: a schema can describe a FIELD called "pattern" or "maximum".
  // Filtering property NAMES rather than schema keywords would delete it.
  it("does not delete a property that happens to be named like a keyword", () => {
    const out = sanitiseSchema({
      type: "object",
      properties: {
        pattern: { type: "string" },
        maximum: { type: "integer" },
        minItems: { type: "string" },
      },
    }) as any;
    expect(Object.keys(out.properties).sort()).toEqual(["maximum", "minItems", "pattern"]);
  });

  it("does not mutate the caller's schema", () => {
    // Schemas are declared `const` at module scope and reused across requests.
    const schema = { type: "object", properties: { a: { type: "string", maxLength: 5 } } };
    const copy = JSON.parse(JSON.stringify(schema));
    sanitiseSchema(schema);
    expect(schema).toEqual(copy);
  });

  it("survives nulls and primitives without throwing", () => {
    expect(() => sanitiseSchema({ a: null, b: 3, c: "x", d: true })).not.toThrow();
  });
});
