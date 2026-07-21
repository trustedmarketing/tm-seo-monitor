import { describe, it, expect, vi, afterEach } from "vitest";
import { createFakeDb } from "../helpers/fakeDb";
import { checkTokenExpiry } from "@/lib/tokenExpiry";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("checkTokenExpiry", () => {
  it("alerts Slack and records a collector_runs row when a token is expiring soon", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/x/y/z");

    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const db = createFakeDb({
      platform_secrets: [
        { id: "1", client_id: "c1", platform: "meta", auth_ref: "meta:c1", status: "active", expires_at: soon },
      ],
    }) as any;

    const result = await checkTokenExpiry(db, 14);

    expect(result.expiring).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.text).toContain("1 platform token(s)");
    expect(body.text).toContain("meta:c1");

    const runs = db._rows("collector_runs");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ module: "token_expiry", client_id: null, status: "success", rows_written: 1 });
  });

  it("does not alert Slack but still records a success run when nothing is expiring", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/x/y/z");

    const db = createFakeDb() as any;
    const result = await checkTokenExpiry(db, 14);

    expect(result.expiring).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();

    const runs = db._rows("collector_runs");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ module: "token_expiry", status: "success", rows_written: 0 });
  });

  it("does not throw when the registry lookup fails — records an error run instead", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SLACK_WEBHOOK_URL", "");

    const runsWritten: Record<string, any>[] = [];
    const brokenDb = {
      from(table: string) {
        if (table === "collector_runs") {
          return { insert: async (row: any) => { runsWritten.push(row); return { data: null, error: null }; } };
        }
        throw new Error("db unreachable");
      },
    } as any;

    await expect(checkTokenExpiry(brokenDb, 14)).resolves.toEqual({ expiring: 0 });
    expect(runsWritten).toHaveLength(1);
    expect(runsWritten[0]).toMatchObject({ module: "token_expiry", status: "error", error: "db unreachable" });
  });
});
