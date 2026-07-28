import { describe, it, expect } from "vitest";
import { diffWords, diffMagnitude, serpWarning } from "@/lib/textDiff";

// WO-003 Stream D. For content changes the diff IS the evidence, so it has to be
// exactly right — a diff that misrepresents a change is worse than no diff.

const render = (ops: ReturnType<typeof diffWords>) =>
  ops.map((o) => (o.kind === "same" ? o.text : o.kind === "add" ? `+[${o.text}]` : `-[${o.text}]`)).join("");

describe("diffWords", () => {
  it("reassembles the original text exactly, whitespace included", () => {
    const before = "How Salty Dog  Marine Salt Remover Works";
    const after = "How Salty Dog Marine Salt Remover Actually Works";
    const ops = diffWords(before, after);
    const rebuiltBefore = ops.filter((o) => o.kind !== "add").map((o) => o.text).join("");
    const rebuiltAfter = ops.filter((o) => o.kind !== "remove").map((o) => o.text).join("");
    expect(rebuiltBefore).toBe(before);
    expect(rebuiltAfter).toBe(after);
  });

  it("marks an unchanged string as entirely same", () => {
    const ops = diffWords("same text", "same text");
    expect(ops).toEqual([{ kind: "same", text: "same text" }]);
  });

  it("shows a real title change at word level, not whole-string replace", () => {
    const ops = diffWords(
      "How Salty Dog Marine Salt Remover Works",
      "How Salty Dog Marine Salt Remover Works: 3 Formulas, 1 Pod"
    );
    // The shared prefix must survive as 'same' rather than being re-added.
    expect(ops.some((o) => o.kind === "same" && o.text.includes("Salty Dog"))).toBe(true);
    expect(render(ops)).toContain("+[");
  });

  it("handles an empty before — an SEO override that was never set", () => {
    const ops = diffWords("", "Boat Salt Remover");
    expect(ops).toEqual([{ kind: "add", text: "Boat Salt Remover" }]);
  });

  it("handles an empty after — clearing a value", () => {
    const ops = diffWords("Old title", "");
    expect(ops.every((o) => o.kind === "remove")).toBe(true);
  });

  it("degrades to whole-value replace rather than hanging on huge inputs", () => {
    const big = "word ".repeat(3000);
    const ops = diffWords(big, big + "extra");
    expect(ops.length).toBeLessThanOrEqual(2);
  });
});

describe("diffMagnitude", () => {
  it("counts characters added and removed", () => {
    const m = diffMagnitude(diffWords("abc", "abcd"));
    expect(m.added).toBeGreaterThan(0);
  });
});

describe("serpWarning", () => {
  it("stays quiet within Google's truncation point", () => {
    expect(serpWarning("title", "A short title")).toBeNull();
  });

  it("warns on an over-long title, because truncation is a silent failure", () => {
    const w = serpWarning("title", "x".repeat(75));
    expect(w).toContain("75 characters");
    expect(w).toContain("60");
  });

  it("uses the right limit for descriptions", () => {
    expect(serpWarning("description", "x".repeat(100))).toBeNull();
    expect(serpWarning("description", "x".repeat(200))).toContain("155");
  });
});

describe("diffWords · whitespace must not create false anchors", () => {
  it("an unrelated rewrite reads as one removal then one addition", () => {
    // Regression from the first live card: shared SPACES matched even though no
    // words did, interleaving the two strings into an unreadable result.
    const ops = diffWords("Test Page", "Salt Remover Pods for Boats");
    const kinds = ops.map((o) => o.kind);
    expect(kinds).toEqual(["remove", "add"]);
    expect(ops[0].text.trim()).toBe("Test Page");
    expect(ops[1].text.trim()).toBe("Salt Remover Pods for Boats");
  });

  it("still reassembles both sides exactly", () => {
    const before = "Test Page";
    const after = "Salt Remover Pods for Boats";
    const ops = diffWords(before, after);
    expect(ops.filter((o) => o.kind !== "add").map((o) => o.text).join("")).toBe(before);
    expect(ops.filter((o) => o.kind !== "remove").map((o) => o.text).join("")).toBe(after);
  });

  it("genuine shared words are still recognised", () => {
    const ops = diffWords(
      "Marine Salt Remover Works",
      "Marine Salt Remover Works Fast"
    );
    expect(ops.some((o) => o.kind === "same" && o.text.includes("Marine"))).toBe(true);
    expect(ops.some((o) => o.kind === "add" && o.text.includes("Fast"))).toBe(true);
    expect(ops.some((o) => o.kind === "remove")).toBe(false);
  });
});
