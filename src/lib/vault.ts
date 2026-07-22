// lib/vault.ts — secrets vault + registry (Stream 2, WO-001).
// Per-client platform tokens (Meta, Google Ads, Microsoft, ClickUp, etc.) live in
// Supabase Vault (encrypted at rest), never in env vars. `platform_secrets` is the
// TRACKING REGISTRY only — it never holds a raw secret, only the `auth_ref` that
// points at the corresponding row in `vault.decrypted_secrets` / `vault.secrets`.
//
// "Secrets never surface" (docs/CLAUDE-monitor-draft.md, autonomy ladder #5):
// nothing in this module logs a secret value. `readSecret` is the only function
// that ever returns one, and only to its direct caller.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface StoreSecretInput {
  clientId: string;
  platform: string;
  value: string;
  expiresAt?: string | null;
}

export interface ExpiringSecret {
  client_id: string;
  platform: string;
  auth_ref: string;
  expires_at: string;
}

// Deterministic Vault secret name for a client+platform pair — this is what
// `auth_ref` holds, both in the vault and in the registry row that points at it.
export function buildAuthRef(platform: string, clientId: string): string {
  return `${platform}:${clientId}`;
}

// Registry-only upsert of `platform_secrets` — never touches Vault. Kept separate
// from `storeSecret` so unit tests can exercise the registry logic (insert vs.
// update, unique-key behavior) via `createFakeDb` without a live Vault RPC.
export async function upsertSecretRegistry(
  db: SupabaseClient,
  input: { clientId: string; platform: string; authRef: string; expiresAt?: string | null }
): Promise<{ auth_ref: string }> {
  const { data: existing } = await db
    .from("platform_secrets")
    .select("id")
    .eq("client_id", input.clientId)
    .eq("platform", input.platform)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  const row = {
    client_id: input.clientId,
    platform: input.platform,
    auth_ref: input.authRef,
    status: "active",
    expires_at: input.expiresAt ?? null,
    last_rotated_at: nowIso,
  };

  if (existing) {
    await db.from("platform_secrets").update(row).eq("id", (existing as { id: string }).id);
  } else {
    await db.from("platform_secrets").insert(row);
  }

  return { auth_ref: input.authRef };
}

// Write a secret's value to Supabase Vault, then register it in `platform_secrets`.
// Never logs or returns `input.value`.
export async function storeSecret(
  db: SupabaseClient,
  input: StoreSecretInput
): Promise<{ auth_ref: string }> {
  const authRef = buildAuthRef(input.platform, input.clientId);

  const { error } = await db.rpc("vault_write_secret", {
    p_secret: input.value,
    p_name: authRef,
  });
  if (error) throw new Error(`vault.create_secret failed: ${error.message}`);

  return upsertSecretRegistry(db, {
    clientId: input.clientId,
    platform: input.platform,
    authRef,
    expiresAt: input.expiresAt ?? null,
  });
}

// Read a secret's plaintext value back out of Vault by its `auth_ref` (the vault
// secret's name). Returns null if not found. This is the ONLY function in this
// module allowed to return a raw secret value — callers must not log it either.
export async function readSecret(db: SupabaseClient, authRef: string): Promise<string | null> {
  const { data, error } = await db.rpc("vault_read_secret", { p_name: authRef });
  if (error || data == null) return null;
  return data as string;
}

// Registry rows (active only) whose expires_at falls within `withinDays` from now
// — inclusive of already-expired rows, so a missed check still surfaces them.
// Soonest-expiring first. Pure registry logic — no Vault access.
export async function listExpiring(db: SupabaseClient, withinDays = 14): Promise<ExpiringSecret[]> {
  const cutoff = new Date(Date.now() + withinDays * 86_400_000).toISOString();
  const { data } = await db
    .from("platform_secrets")
    .select("client_id, platform, auth_ref, expires_at")
    .eq("status", "active")
    .lte("expires_at", cutoff)
    .order("expires_at", { ascending: true });

  return ((data ?? []) as ExpiringSecret[]).filter((r) => r.expires_at != null);
}
