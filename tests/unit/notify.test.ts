import { describe, it, expect, vi, afterEach } from "vitest";
import { notify } from "@/lib/notify";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const MSG = { subject: "test", body: "body" };

function stubEnv(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
}

describe("notify — email channel diagnostics", () => {
  it("says which env var is missing rather than failing silently", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    stubEnv({ SLACK_WEBHOOK_URL: "", RESEND_API_KEY: "re_fake", ALERT_EMAIL_TO: "" });

    const out = await notify(MSG);

    expect(out.email).toBe(false);
    // The half-configured case: a key with no recipient looks set up and sends
    // nothing. Naming the missing var is the difference between a 5-minute fix
    // and an afternoon of guessing.
    expect(out.emailError).toBe("ALERT_EMAIL_TO unset");
  });

  it("names both when neither is set", async () => {
    vi.stubGlobal("fetch", vi.fn());
    stubEnv({ SLACK_WEBHOOK_URL: "", RESEND_API_KEY: "", ALERT_EMAIL_TO: "" });

    const out = await notify(MSG);
    expect(out.emailError).toBe("RESEND_API_KEY and ALERT_EMAIL_TO both unset");
  });

  it("surfaces Resend's own rejection reason instead of a bare false", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => '{"message":"You can only send testing emails to your own email address"}',
    });
    vi.stubGlobal("fetch", fetchMock);
    stubEnv({ SLACK_WEBHOOK_URL: "", RESEND_API_KEY: "re_fake", ALERT_EMAIL_TO: "tom@example.com" });

    const out = await notify(MSG);

    expect(out.email).toBe(false);
    expect(out.emailError).toContain("403");
    expect(out.emailError).toContain("your own email address");
  });

  it("reports a network failure distinctly from an API rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    stubEnv({ SLACK_WEBHOOK_URL: "", RESEND_API_KEY: "re_fake", ALERT_EMAIL_TO: "tom@example.com" });

    const out = await notify(MSG);
    expect(out.emailError).toContain("fetch failed");
    expect(out.emailError).toContain("ECONNREFUSED");
  });

  it("reports no error when Resend accepts the send", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    stubEnv({ SLACK_WEBHOOK_URL: "", RESEND_API_KEY: "re_fake", ALERT_EMAIL_TO: "tom@example.com" });

    const out = await notify(MSG);
    expect(out.email).toBe(true);
    expect(out.emailError).toBeUndefined();
  });

  it("still sends email when Slack is unconfigured — the channels are independent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    stubEnv({ SLACK_WEBHOOK_URL: "", RESEND_API_KEY: "re_fake", ALERT_EMAIL_TO: "tom@example.com" });

    const out = await notify(MSG);

    expect(out.email).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.resend.com/emails");
  });
});
