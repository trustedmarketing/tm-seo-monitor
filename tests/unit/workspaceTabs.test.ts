import { describe, it, expect } from "vitest";
import { workspaceTabs, revenueMode, isLocal } from "@/lib/workspaceTabs";

// WO-003 Stream M. Tom's point: not every client has revenue, only the eCommerce
// brands. These lock that in both directions so a future edit cannot quietly
// show a local client a Revenue view or an eCommerce brand a GBP tab.

const keys = (t: ReturnType<typeof workspaceTabs>) => t.map((x) => x.key);

describe("workspaceTabs · derived from client type", () => {
  it("eCommerce clients get no GBP and no Automation", () => {
    const k = keys(workspaceTabs("national_ecom"));
    expect(k).not.toContain("gbp");
    expect(k).not.toContain("automation");
    expect(k).toContain("organic");
    expect(k).toContain("paid");
  });

  it("local-service clients do get GBP and Automation", () => {
    const k = keys(workspaceTabs("local_service"));
    expect(k).toContain("gbp");
    expect(k).toContain("automation");
  });

  it("hybrid clients are treated as local for tab purposes", () => {
    expect(keys(workspaceTabs("hybrid"))).toContain("gbp");
    expect(isLocal("hybrid")).toBe(true);
  });

  it("an unclassified client gets the universal set only, never a guess", () => {
    const k = keys(workspaceTabs(null));
    expect(k).not.toContain("gbp");
    expect(k).not.toContain("automation");
    expect(k).toContain("overview");
  });

  it("Search survives, even though the design export omits it", () => {
    // WO-002's deliberate high-value add: organic + paid on one query.
    for (const t of ["national_ecom", "local_service", null] as const) {
      expect(keys(workspaceTabs(t))).toContain("search");
    }
  });

  it("Revenue is not a tab for anyone — it folded into Overview", () => {
    for (const t of ["national_ecom", "local_service", "hybrid", null] as const) {
      expect(keys(workspaceTabs(t))).not.toContain("revenue" as never);
    }
  });

  it("unbuilt tabs carry an explanation rather than rendering a bare zero", () => {
    for (const tab of workspaceTabs("local_service")) {
      if (tab.state !== "built") {
        expect(tab.note, `${tab.key} has no explanation`).toBeTruthy();
      }
    }
  });

  it("GBP is marked not_connected, not being_built — it waits on Google", () => {
    const gbp = workspaceTabs("local_service").find((t) => t.key === "gbp");
    expect(gbp?.state).toBe("not_connected");
  });

  it("tabs follow the design's reading order", () => {
    const k = keys(workspaceTabs("local_service"));
    expect(k.indexOf("overview")).toBeLessThan(k.indexOf("organic"));
    expect(k.indexOf("organic")).toBeLessThan(k.indexOf("paid"));
    expect(k.indexOf("settings")).toBe(k.length - 1);
  });
});

describe("revenueMode · what the Overview revenue block can honestly show", () => {
  it("eCommerce has Shopify ground truth", () => {
    expect(revenueMode("national_ecom")).toBe("shopify");
  });

  it("local service is blocked on the call-tracking decision, not merely empty", () => {
    // We cannot compute jobs booked or cost per job today. An honest blank beats
    // an invented number on a client screen.
    expect(revenueMode("local_service")).toBe("leads_pending");
    expect(revenueMode("hybrid")).toBe("leads_pending");
  });

  it("an unclassified client shows nothing rather than assuming", () => {
    expect(revenueMode(null)).toBe("unknown");
  });
});
