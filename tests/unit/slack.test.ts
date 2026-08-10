import { describe, it, expect, vi, afterEach } from "vitest";
import { alertOnFailures, alertOnRevenueMismatch } from "@/lib/slack";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("slack alerts", () => {
  it("does not call the webhook when there are no failures", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/x/y/z");
    await alertOnFailures("2026-07-21T10:00:00Z", []);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a formatted message when failures exist", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/x/y/z");
    await alertOnFailures("2026-07-21T10:00:00Z", [
      { module: "core", client: "sharkey-air.example", error: "HTTP 500" },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.text).toContain("1 failure(s)");
    expect(body.text).toContain("sharkey-air.example");
    expect(body.text).toContain("HTTP 500");
  });

  it("does not call the webhook when no client's revenue mismatches", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/x/y/z");
    await alertOnRevenueMismatch("2026-07-21T10:00:00Z", []);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts one batched message naming each client and both revenue figures", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/x/y/z");
    await alertOnRevenueMismatch("2026-07-21T10:00:00Z", [
      { client: "saltydog.example", storedRevenue: 51300, freshRevenue: 30502.67, diffAbs: 20797.33, diffPct: 0.6818 },
      { client: "other.example", storedRevenue: 1000, freshRevenue: 1500, diffAbs: 500, diffPct: 0.3333 },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce(); // one batched alert, not one per client
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.text).toContain("2 client(s)");
    expect(body.text).toContain("saltydog.example");
    expect(body.text).toContain("51300.00");
    expect(body.text).toContain("30502.67");
    expect(body.text).toContain("68.2%");
  });

  it("omits the percentage rather than printing null when diffPct is unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/x/y/z");
    await alertOnRevenueMismatch("t", [
      { client: "zero.example", storedRevenue: 500, freshRevenue: 0, diffAbs: 500, diffPct: null },
    ]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.text).not.toContain("null");
    expect(body.text).toContain("off by $500.00");
  });

  it("is a no-op (no throw) when SLACK_WEBHOOK_URL is unset", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SLACK_WEBHOOK_URL", "");
    await expect(
      alertOnFailures("t", [{ module: "core", client: "c", error: "e" }])
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
