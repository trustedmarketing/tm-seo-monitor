import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { onPageTaskPost } from "@/lib/dataforseo";

// Every crawl is billed. onPageTaskPost previously called post() for the task,
// threw the result away, then made a second raw call to read the id — so each
// press of "Run scan now" queued two crawls, paid for both, and orphaned the
// first. The second call also dropped the load_resources/enable_javascript
// flags, making the crawl we kept the expensive one.
//
// These tests exist to keep that from coming back, so they assert on the call
// count and the request body rather than only on the returned id.

function okTask(id: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ tasks: [{ id, status_code: 20000, status_message: "Ok." }] }),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("MOCK_APIS", "0");
  vi.stubEnv("DATAFORSEO_LOGIN", "login@example.com");
  vi.stubEnv("DATAFORSEO_PASSWORD", "password");
  fetchMock = vi.fn(async () => okTask("07281949-9445-0216-0000-0eb804ecc849"));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("onPageTaskPost", () => {
  it("queues exactly one crawl", async () => {
    await onPageTaskPost("getsaltydog.com");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns the task id from the response", async () => {
    expect(await onPageTaskPost("getsaltydog.com")).toBe("07281949-9445-0216-0000-0eb804ecc849");
  });

  it("keeps the cheap crawl config on the call it actually makes", async () => {
    await onPageTaskPost("getsaltydog.com", 300);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual([{
      target: "getsaltydog.com",
      max_crawl_pages: 300,
      load_resources: false,
      enable_javascript: false,
    }]);
  });

  it("throws on an HTTP error instead of returning a bad id", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 402, json: async () => ({}) });
    await expect(onPageTaskPost("getsaltydog.com")).rejects.toThrow("HTTP 402");
  });

  it("surfaces a DataForSEO task error", async () => {
    // The common one is 40200 "Payment Required" on an empty balance. Silently
    // returning no id here would look like a crawl that vanished.
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ tasks: [{ status_code: 40200, status_message: "Payment Required." }] }),
    });
    await expect(onPageTaskPost("getsaltydog.com")).rejects.toThrow("40200");
  });

  it("throws when the response carries no id", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ tasks: [{ status_code: 20000 }] }) });
    await expect(onPageTaskPost("getsaltydog.com")).rejects.toThrow("no id");
  });

  it("still short-circuits under MOCK_APIS without touching the network", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    expect(await onPageTaskPost("getsaltydog.com")).toBe("mock-task-000");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
