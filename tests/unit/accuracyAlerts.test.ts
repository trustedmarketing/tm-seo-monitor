import { describe, it, expect, vi, afterEach } from "vitest";
import { alertOnRevenueMismatch, alertOnStaleData } from "@/lib/accuracyAlerts";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

// notify() posts to Slack and (if configured) Resend. Both go out over fetch,
// so asserting on the fetch bodies covers both channels.
function slackBody(fetchMock: any, call = 0): string {
  return JSON.parse(fetchMock.mock.calls[call][1].body).text;
}

function withSlack() {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/x/y/z");
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("ALERT_EMAIL_TO", "");
  return fetchMock;
}

describe("alertOnRevenueMismatch", () => {
  it("sends nothing when no client mismatches", async () => {
    const fetchMock = withSlack();
    await alertOnRevenueMismatch("2026-08-10T10:00:00Z", []);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends one batched message naming each client and both figures", async () => {
    const fetchMock = withSlack();
    await alertOnRevenueMismatch("2026-08-10T10:00:00Z", [
      { client: "saltydog.example", storedRevenue: 51300, freshRevenue: 30502.67, diffAbs: 20797.33, diffPct: 0.6818 },
      { client: "other.example", storedRevenue: 1000, freshRevenue: 1500, diffAbs: 500, diffPct: 0.3333 },
    ]);

    expect(fetchMock).toHaveBeenCalledOnce(); // one batched alert, not one per client
    const text = slackBody(fetchMock);
    expect(text).toContain("2 client(s)");
    expect(text).toContain("saltydog.example");
    expect(text).toContain("51300.00");
    expect(text).toContain("30502.67");
    expect(text).toContain("68.2%");
  });

  it("omits the percentage rather than printing null when diffPct is unavailable", async () => {
    const fetchMock = withSlack();
    await alertOnRevenueMismatch("t", [
      { client: "zero.example", storedRevenue: 500, freshRevenue: 0, diffAbs: 500, diffPct: null },
    ]);
    const text = slackBody(fetchMock);
    expect(text).not.toContain("null");
    expect(text).toContain("off by $500.00");
  });

  it("also emails when Resend is configured, so a missing Slack webhook can't swallow it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SLACK_WEBHOOK_URL", ""); // Slack deliberately unconfigured
    vi.stubEnv("RESEND_API_KEY", "re_fake");
    vi.stubEnv("ALERT_EMAIL_TO", "thomas@trustedmarketing.com");

    await alertOnRevenueMismatch("t", [
      { client: "saltydog.example", storedRevenue: 51300, freshRevenue: 30502.67, diffAbs: 20797.33, diffPct: 0.68 },
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.resend.com/emails");
    const email = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(email.to).toEqual(["thomas@trustedmarketing.com"]);
    expect(email.subject).toContain("revenue doesn't match Shopify");
    expect(email.text).toContain("saltydog.example");
  });

  it("does not throw when no channel at all is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SLACK_WEBHOOK_URL", "");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("ALERT_EMAIL_TO", "");

    await expect(
      alertOnRevenueMismatch("t", [
        { client: "x", storedRevenue: 1, freshRevenue: 100, diffAbs: 99, diffPct: 0.99 },
      ])
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("alertOnStaleData", () => {
  it("sends nothing when no source is stale", async () => {
    const fetchMock = withSlack();
    await alertOnStaleData("t", []);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the age in days as well as hours", async () => {
    const fetchMock = withSlack();
    await alertOnStaleData("2026-08-10T10:00:00Z", [
      { client: "saltydog.example", module: "shopify revenue", hoursOld: 216 },
    ]);

    const text = slackBody(fetchMock);
    expect(text).toContain("1 source(s)");
    expect(text).toContain("saltydog.example");
    expect(text).toContain("shopify revenue");
    expect(text).toContain("9 day(s)");
    expect(text).toContain("216h");
  });
});
