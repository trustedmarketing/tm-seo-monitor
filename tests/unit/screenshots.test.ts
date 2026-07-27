import { describe, it, expect, beforeEach } from "vitest";
import { captureFor, captureBeforeAfter } from "@/lib/screenshots";

// WO-003 Stream B. Exercised through the MOCK_APIS path so the pipeline is
// testable before the vendor account exists — same pattern as every collector.

beforeEach(() => { process.env.MOCK_APIS = "1"; });

describe("screenshots · mock path", () => {
  it("captures a shot keyed by client, target and side", async () => {
    const shot = await captureFor({
      targetType: "approval", targetId: "a1", clientId: "c1",
      pageUrl: "https://example.test/services", kind: "before",
    });
    expect(shot.kind).toBe("before");
    expect(shot.sourceUrl).toBe("https://example.test/services");
    expect(shot.url).toContain("c1/approval/a1/before");
  });

  it("captures both sides in one call", async () => {
    const { before, after } = await captureBeforeAfter({
      targetType: "approval", targetId: "a2", clientId: "c1",
      liveUrl: "https://example.test/x", stagedUrl: "https://staging.example.test/x",
    });
    expect(before.sourceUrl).not.toBe(after.sourceUrl);
    expect(before.kind).toBe("before");
    expect(after.kind).toBe("after");
  });

  it("takes both sides at effectively the same moment", async () => {
    // A 'before' captured hours earlier lets unrelated drift into the comparison,
    // which makes the pair misleading rather than evidential.
    const { before, after } = await captureBeforeAfter({
      targetType: "approval", targetId: "a3", clientId: "c1",
      liveUrl: "https://example.test/y", stagedUrl: "https://staging.example.test/y",
    });
    const gap = Math.abs(Date.parse(before.capturedAt) - Date.parse(after.capturedAt));
    expect(gap).toBeLessThan(2000);
  });

  it("fails loudly without an API key when not mocking", async () => {
    process.env.MOCK_APIS = "0";
    delete process.env.SCREENSHOT_API_KEY;
    await expect(captureFor({
      targetType: "approval", targetId: "a4", clientId: "c1",
      pageUrl: "https://example.test/z", kind: "after",
    })).rejects.toThrow(/SCREENSHOT_API_KEY/);
  });
});
