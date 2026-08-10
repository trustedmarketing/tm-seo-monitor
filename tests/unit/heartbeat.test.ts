import { describe, it, expect, vi, afterEach } from "vitest";
import { pingHeartbeat } from "@/lib/heartbeat";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("pingHeartbeat", () => {
  it("is a no-op when HEARTBEAT_URL is unset, and says so rather than claiming success", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("HEARTBEAT_URL", "");

    const r = await pingHeartbeat();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.configured).toBe(false);
    // ok:false when unconfigured is deliberate — reporting ok:true here would
    // let the cron response claim the dead-man's switch is armed when it isn't.
    expect(r.ok).toBe(false);
  });

  it("pings the configured URL and reports success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("HEARTBEAT_URL", "https://hc-ping.com/abc-123");

    const r = await pingHeartbeat();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("https://hc-ping.com/abc-123");
    expect(r).toMatchObject({ configured: true, ok: true });
  });

  it("reports a non-2xx response as a failed ping instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    vi.stubEnv("HEARTBEAT_URL", "https://hc-ping.com/wrong-uuid");

    const r = await pingHeartbeat();

    expect(r).toMatchObject({ configured: true, ok: false, error: "HTTP 404" });
  });

  it("never throws when the network call fails — a heartbeat must not sink the run it monitors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ETIMEDOUT")));
    vi.stubEnv("HEARTBEAT_URL", "https://hc-ping.com/abc-123");

    await expect(pingHeartbeat()).resolves.toMatchObject({ configured: true, ok: false });
    const r = await pingHeartbeat();
    expect(r.error).toContain("ETIMEDOUT");
  });

  it("bounds the request with a timeout signal so a hanging monitor can't stall the cron", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("HEARTBEAT_URL", "https://hc-ping.com/abc-123");

    await pingHeartbeat();

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
