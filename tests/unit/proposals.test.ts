import { describe, it, expect } from "vitest";
import { proposeSeoTitle, proposeMetaDescription, proposalsFor, trimToWord } from "@/lib/proposals";

// WO-003. These become real edits to client sites, so the bar is not "does it
// produce output" but "would I defend this change to the client".

const BRAND = "Alpha Zeta Landscapes";

describe("proposeSeoTitle", () => {
  it("proposes nothing when a title is already set — we do not overwrite human work", () => {
    expect(proposeSeoTitle(
      { title: "Design Build", seoTitle: "Existing Title", metaDescription: "", bodyText: "" }, BRAND
    )).toBeNull();
  });

  it("proposes Page | Brand when the title is missing", () => {
    const p = proposeSeoTitle(
      { title: "Design Build", seoTitle: "", metaDescription: "", bodyText: "" }, BRAND
    );
    expect(p?.after).toBe("Design Build | Alpha Zeta Landscapes");
    expect(p?.before).toBe("");
  });

  it("drops the brand rather than truncating it — a cut-off brand looks broken", () => {
    const long = "Commercial Landscape Design and Build Services for Large Estates";
    const p = proposeSeoTitle({ title: long, seoTitle: "", metaDescription: "", bodyText: "" }, BRAND);
    expect(p!.after).not.toContain("| Alpha Zeta Land");   // no partial brand
    expect(p!.after.length).toBeLessThanOrEqual(60);
  });

  it("never cuts mid-word", () => {
    const p = proposeSeoTitle(
      { title: "Extraordinary Landscaping Transformations Across Martin County Florida", seoTitle: "", metaDescription: "", bodyText: "" },
      BRAND
    );
    expect(p!.after.endsWith(" ")).toBe(false);
    // the final token must be a whole word from the original
    const last = p!.after.split(" ").pop()!;
    expect("Extraordinary Landscaping Transformations Across Martin County Florida").toContain(last);
  });

  it("proposes nothing when there is no page title to work from", () => {
    expect(proposeSeoTitle({ title: "  ", seoTitle: "", metaDescription: "", bodyText: "" }, BRAND)).toBeNull();
  });
});

describe("proposeMetaDescription", () => {
  const body =
    "Alpha Zeta Landscapes designs and builds outdoor spaces across Martin County. " +
    "We handle everything from initial concept through to planting and maintenance. " +
    "Every project starts with a site visit.";

  it("proposes nothing when one already exists", () => {
    expect(proposeMetaDescription(
      { title: "x", seoTitle: "", metaDescription: "Already written", bodyText: body }
    )).toBeNull();
  });

  it("builds from the page's own copy, ending on a sentence", () => {
    const p = proposeMetaDescription({ title: "x", seoTitle: "", metaDescription: "", bodyText: body });
    expect(p!.after.length).toBeLessThanOrEqual(155);
    expect(p!.after).toMatch(/[.!?]$/);
    expect(body).toContain(p!.after.slice(0, 40));
  });

  it("declines when the page has too little copy to describe itself", () => {
    // A 40-character description is worse than letting the engine choose.
    expect(proposeMetaDescription(
      { title: "x", seoTitle: "", metaDescription: "", bodyText: "Short page." }
    )).toBeNull();
  });
});

describe("trimToWord", () => {
  it("returns short strings untouched", () => {
    expect(trimToWord("short", 60)).toBe("short");
  });

  it("cuts at a word boundary and strips trailing punctuation", () => {
    const out = trimToWord("one two three four five six seven eight nine ten", 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out).not.toMatch(/[\s,.;:-]$/);
  });
});

describe("proposalsFor", () => {
  it("returns nothing for a fully optimised page", () => {
    expect(proposalsFor(
      { title: "T", seoTitle: "Set", metaDescription: "Set too", bodyText: "x".repeat(200) }, BRAND
    )).toEqual([]);
  });

  it("can return both proposals for a bare page", () => {
    const out = proposalsFor(
      { title: "Design Build", seoTitle: "", metaDescription: "",
        bodyText: "We design and build outdoor spaces across Martin County Florida with care and attention to detail." },
      BRAND
    );
    expect(out.map((p) => p.kind).sort()).toEqual(["meta_description", "seo_title"]);
  });
});
