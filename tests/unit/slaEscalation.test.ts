import { describe, it, expect } from "vitest";
import { levelFor, NOTIFY_AFTER_H, ESCALATE_AFTER_H } from "@/lib/slaEscalation";

// WO-003 punch list #9. The review's point: "'4 cards past their 24-hour window'
// is displayed. Define what happens... otherwise the stale styling is decoration."

describe("SLA escalation levels", () => {
  it("a card still inside its window triggers nothing", () => {
    expect(levelFor(-1)).toBeNull();
    expect(levelFor(-12)).toBeNull();
  });

  it("notifies as soon as the window is passed", () => {
    expect(levelFor(0)).toBe("notify");
    expect(levelFor(5)).toBe("notify");
  });

  it("escalates once it is a further 24h over — 48h from staging", () => {
    expect(levelFor(ESCALATE_AFTER_H - NOTIFY_AFTER_H)).toBe("escalate");
    expect(levelFor(100)).toBe("escalate");
  });

  it("uses the thresholds the review specified", () => {
    expect(NOTIFY_AFTER_H).toBe(24);
    expect(ESCALATE_AFTER_H).toBe(48);
  });
});
