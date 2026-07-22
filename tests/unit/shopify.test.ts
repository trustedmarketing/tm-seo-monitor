import { describe, it, expect, vi, afterEach } from "vitest";
import { mintToken, fetchDailySales } from "@/lib/shopify";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("shopify under MOCK_APIS", () => {
  it("fetchDailySales reads the fixture", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const rows = await fetchDailySales("test-shop.myshopify.com", "fake-token", 28);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({ date: "2026-06-22", orders: 14, revenue: 2380.50 });
  });

  it("mintToken returns a fixed mock token without a network call", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const token = await mintToken("test-shop.myshopify.com", "client-id", "shpss_fake_secret");
    expect(token).toBe("mock-shpat-token");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never attempts a network call for fetchDailySales while MOCK_APIS=1", async () => {
    vi.stubEnv("MOCK_APIS", "1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await fetchDailySales("test-shop.myshopify.com", "fake-token", 28);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("shopify.mintToken live path (fetch mocked)", () => {
  it("POSTs the client-credentials grant and returns access_token", async () => {
    vi.stubEnv("MOCK_APIS", "0");
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "shpat_minted_token", expires_in: 86399 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const token = await mintToken("test-shop.myshopify.com", "client-id-123", "shpss_super_secret");

    expect(token).toBe("shpat_minted_token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://test-shop.myshopify.com/admin/oauth/access_token");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      client_id: "client-id-123",
      client_secret: "shpss_super_secret",
      grant_type: "client_credentials",
    });
  });

  it("throws (does not swallow) when the token endpoint responds with a non-OK status", async () => {
    vi.stubEnv("MOCK_APIS", "0");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ ok: false, status: 401, statusText: "Unauthorized" })
    );

    await expect(
      mintToken("test-shop.myshopify.com", "client-id", "shpss_bad_secret")
    ).rejects.toThrow(/401/);
  });

  it("never logs or includes the client secret in a thrown error", async () => {
    vi.stubEnv("MOCK_APIS", "0");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 500, statusText: "Server Error" }));

    try {
      await mintToken("test-shop.myshopify.com", "client-id", "shpss_should_not_leak");
      throw new Error("expected mintToken to throw");
    } catch (e) {
      expect((e as Error).message).not.toContain("shpss_should_not_leak");
    }
  });
});

describe("shopify.fetchDailySales live path (fetch mocked)", () => {
  it("paginates the orders connection and aggregates revenue/orders by calendar date", async () => {
    vi.stubEnv("MOCK_APIS", "0");

    const page1 = {
      data: {
        orders: {
          pageInfo: { hasNextPage: true, endCursor: "cursor1" },
          edges: [
            { node: { createdAt: "2026-07-01T10:00:00Z", totalPriceSet: { shopMoney: { amount: "100.00" } } } },
            { node: { createdAt: "2026-07-01T18:30:00Z", totalPriceSet: { shopMoney: { amount: "50.50" } } } },
          ],
        },
      },
    };
    const page2 = {
      data: {
        orders: {
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [
            { node: { createdAt: "2026-07-02T09:15:00Z", totalPriceSet: { shopMoney: { amount: "75.25" } } } },
          ],
        },
      },
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => page1 })
      .mockResolvedValueOnce({ ok: true, json: async () => page2 });
    vi.stubGlobal("fetch", fetchMock);

    const rows = await fetchDailySales("test-shop.myshopify.com", "shpat_real_token", 28);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rows).toEqual([
      { date: "2026-07-01", orders: 2, revenue: 150.50 },
      { date: "2026-07-02", orders: 1, revenue: 75.25 },
    ]);

    // token goes on the X-Shopify-Access-Token header, never as a query param
    // or logged in the URL.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://test-shop.myshopify.com/admin/api/2025-01/graphql.json");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-Shopify-Access-Token"]).toBe("shpat_real_token");
  });

  it("throws (does not swallow) when the orders request responds with a non-OK status", async () => {
    vi.stubEnv("MOCK_APIS", "0");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 401, statusText: "Unauthorized" }));

    await expect(
      fetchDailySales("test-shop.myshopify.com", "bad-token", 28)
    ).rejects.toThrow(/401/);
  });

  it("throws when the GraphQL response contains errors", async () => {
    vi.stubEnv("MOCK_APIS", "0");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errors: [{ message: "Throttled" }] }),
    }));

    await expect(
      fetchDailySales("test-shop.myshopify.com", "token", 28)
    ).rejects.toThrow(/Throttled/);
  });
});
