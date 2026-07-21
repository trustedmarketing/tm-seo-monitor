import { describe, it, expect, vi, afterEach } from "vitest";
import { alertOnFailures } from "@/lib/slack";

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
