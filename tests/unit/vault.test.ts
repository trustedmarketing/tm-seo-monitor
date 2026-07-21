import { describe, it, expect } from "vitest";
import { createFakeDb } from "../helpers/fakeDb";
import { buildAuthRef, upsertSecretRegistry, listExpiring } from "@/lib/vault";

describe("vault registry", () => {
  it("buildAuthRef is deterministic per platform+client", () => {
    expect(buildAuthRef("meta", "c1")).toBe("meta:c1");
    expect(buildAuthRef("meta", "c1")).toBe(buildAuthRef("meta", "c1"));
  });

  it("upsertSecretRegistry inserts a new registry row", async () => {
    const db = createFakeDb() as any;
    const result = await upsertSecretRegistry(db, {
      clientId: "c1",
      platform: "meta",
      authRef: "meta:c1",
      expiresAt: "2026-08-01T00:00:00Z",
    });

    expect(result).toEqual({ auth_ref: "meta:c1" });
    const rows = db._rows("platform_secrets");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      client_id: "c1",
      platform: "meta",
      auth_ref: "meta:c1",
      status: "active",
      expires_at: "2026-08-01T00:00:00Z",
    });
  });

  it("upsertSecretRegistry updates the existing row on re-store instead of duplicating", async () => {
    const db = createFakeDb({
      platform_secrets: [
        {
          id: "row-1",
          client_id: "c1",
          platform: "meta",
          auth_ref: "meta:c1",
          status: "active",
          expires_at: "2026-08-01T00:00:00Z",
          last_rotated_at: "2026-01-01T00:00:00Z",
        },
      ],
    }) as any;

    await upsertSecretRegistry(db, {
      clientId: "c1",
      platform: "meta",
      authRef: "meta:c1",
      expiresAt: "2027-01-01T00:00:00Z",
    });

    const rows = db._rows("platform_secrets");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("row-1");
    expect(rows[0].expires_at).toBe("2027-01-01T00:00:00Z");
  });

  it("listExpiring returns only active rows expiring within the window, soonest first", async () => {
    const now = Date.now();
    const soon = new Date(now + 3 * 86_400_000).toISOString();
    const far = new Date(now + 60 * 86_400_000).toISOString();
    const past = new Date(now - 86_400_000).toISOString();

    const db = createFakeDb({
      platform_secrets: [
        { id: "1", client_id: "c1", platform: "meta", auth_ref: "meta:c1", status: "active", expires_at: soon },
        { id: "2", client_id: "c2", platform: "google_ads", auth_ref: "google_ads:c2", status: "active", expires_at: far },
        { id: "3", client_id: "c3", platform: "clickup", auth_ref: "clickup:c3", status: "active", expires_at: past },
        { id: "4", client_id: "c4", platform: "microsoft", auth_ref: "microsoft:c4", status: "revoked", expires_at: past },
        { id: "5", client_id: "c5", platform: "meta", auth_ref: "meta:c5", status: "active", expires_at: null },
      ],
    }) as any;

    const expiring = await listExpiring(db, 14);
    expect(expiring.map((e) => e.auth_ref)).toEqual(["clickup:c3", "meta:c1"]);
  });

  it("listExpiring returns an empty array when nothing is due", async () => {
    const db = createFakeDb() as any;
    const expiring = await listExpiring(db, 14);
    expect(expiring).toEqual([]);
  });
});
