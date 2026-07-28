import { describe, it, expect, beforeEach } from "vitest";
import { stage, publish, revert, preflight } from "@/lib/shopifyAdapter";

// WO-003 Stream E-S. Exercised through MOCK_APIS, matching every other adapter.

beforeEach(() => { process.env.MOCK_APIS = "1"; });

const CHANGE = {
  type: "page_seo_title" as const,
  targetGid: "gid://shopify/Page/123",
  proposed: "Boat Salt Remover & Marine Cleaning Products",
};

describe("shopifyAdapter · staging", () => {
  it("captures the live value as the before, without touching the store", async () => {
    const staged = await stage("x.myshopify.com", "t", CHANGE);
    expect(staged.current).toBeTruthy();
    expect(staged.proposed).toBe(CHANGE.proposed);
    expect(staged.stagedAt).toBeTruthy();
  });
});

describe("shopifyAdapter · publish safety", () => {
  it("DEFAULTS to dry run — writing to a client store must be deliberate", async () => {
    const staged = await stage("x.myshopify.com", "t", CHANGE);
    const res = await publish("x.myshopify.com", "t", staged); // no opts
    expect(res.dryRun).toBe(true);
    expect(res.detail).toMatch(/nothing written/i);
  });

  it("carries everything needed to reverse the change", async () => {
    const staged = await stage("x.myshopify.com", "t", CHANGE);
    const res = await publish("x.myshopify.com", "t", staged, { dryRun: false });
    // The revert value is the ORIGINAL, not the new one.
    expect(res.revert.value).toBe(staged.current);
    expect(res.revert.value).not.toBe(staged.proposed);
    expect(res.revert.targetGid).toBe(CHANGE.targetGid);
  });

  it("reports before and after for the ledger", async () => {
    const staged = await stage("x.myshopify.com", "t", CHANGE);
    const res = await publish("x.myshopify.com", "t", staged, { dryRun: false });
    expect(res.before).toBe(staged.current);
    expect(res.after).toBe(CHANGE.proposed);
  });
});

describe("shopifyAdapter · revert", () => {
  it("also defaults to dry run", async () => {
    const r = { targetGid: CHANGE.targetGid, type: CHANGE.type, value: "old title" };
    expect((await revert("x.myshopify.com", "t", r)).dryRun).toBe(true);
  });

  it("restores the original value", async () => {
    const r = { targetGid: CHANGE.targetGid, type: CHANGE.type, value: "old title" };
    const res = await revert("x.myshopify.com", "t", r, { dryRun: false });
    expect(res.after).toBe("old title");
  });
});

describe("shopifyAdapter · preflight", () => {
  it("reports whether the app can write at all", async () => {
    const p = await preflight("x.myshopify.com", "t");
    expect(p.canWrite).toBe(true);
    expect(p.scopes).toContain("write_content");
  });
});
