import { describe, it, expect } from "vitest";
import { idempotencyKey, canDecide } from "@/lib/audit";

// WO-003 Stream C.

describe("idempotencyKey · approving twice must not publish twice", () => {
  it("is stable for the same action and target", () => {
    const a = idempotencyKey({ action: "approve", targetId: "abc" });
    const b = idempotencyKey({ action: "approve", targetId: "abc" });
    expect(a).toBe(b);
  });

  it("does not include time, so a retried request collides with the original", () => {
    // The whole point: a double-click or a retried POST must hit the same key.
    expect(idempotencyKey({ action: "approve", targetId: "abc" })).not.toMatch(/\d{10,}/);
  });

  it("separates different actions on the same target", () => {
    expect(idempotencyKey({ action: "approve", targetId: "x" }))
      .not.toBe(idempotencyKey({ action: "revert", targetId: "x" }));
  });

  it("lets a deliberate retry through via attempt", () => {
    expect(idempotencyKey({ action: "publish", targetId: "x", attempt: 1 }))
      .not.toBe(idempotencyKey({ action: "publish", targetId: "x" }));
  });
});

describe("canDecide · punch list #5, role-locked cards", () => {
  it("a specialist cannot approve what needs a pod lead", () => {
    expect(canDecide("specialist", "pod_lead")).toBe(false);
  });

  it("a pod lead can approve specialist-level work", () => {
    expect(canDecide("pod_lead", "specialist")).toBe(true);
  });

  it("an owner can approve anything", () => {
    for (const r of ["specialist", "pod_lead", "owner"]) {
      expect(canDecide("owner", r)).toBe(true);
    }
  });

  it("a client user cannot decide agency work", () => {
    expect(canDecide("client", "specialist")).toBe(false);
    expect(canDecide("client", "pod_lead")).toBe(false);
  });

  it("no role means no authority", () => {
    expect(canDecide(undefined, "specialist")).toBe(false);
  });

  it("an unknown role is denied rather than defaulting open", () => {
    expect(canDecide("intern", "specialist")).toBe(false);
  });
});

describe("undo window · punch list #1", () => {
  it("a change published moments ago is undoable", async () => {
    const { withinUndoWindow } = await import("@/lib/audit");
    expect(withinUndoWindow(new Date().toISOString())).toBe(true);
  });

  it("a change published two hours ago is NOT undoable — it ran, so it is data", async () => {
    const { withinUndoWindow } = await import("@/lib/audit");
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    expect(withinUndoWindow(twoHoursAgo)).toBe(false);
  });

  it("treats a never-published change as not undoable", async () => {
    const { withinUndoWindow } = await import("@/lib/audit");
    expect(withinUndoWindow(null)).toBe(false);
    expect(withinUndoWindow(undefined)).toBe(false);
  });

  it("the boundary is one hour", async () => {
    const { withinUndoWindow, UNDO_WINDOW_MS } = await import("@/lib/audit");
    expect(UNDO_WINDOW_MS).toBe(3_600_000);
    // Just inside vs just outside.
    expect(withinUndoWindow(new Date(Date.now() - UNDO_WINDOW_MS + 5000).toISOString())).toBe(true);
    expect(withinUndoWindow(new Date(Date.now() - UNDO_WINDOW_MS - 5000).toISOString())).toBe(false);
  });
});
