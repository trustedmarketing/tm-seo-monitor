// lib/audit.ts — the audit trail.
//
// WO-003 Stream C. Every approve / decline / publish / pause writes one
// immutable row: who, what, when, before, after. This is what makes an
// automated change to a client's site or ad account defensible if the client
// ever disputes it (spec §9, "audit log, non-optional").
//
// Two design points worth knowing:
//
// 1. It uses the SERVICE ROLE deliberately. The audit trail must record actions
//    the acting user could not themselves write, and a user who could write their
//    own audit rows could also shape them. The actor is captured from the session
//    and passed in, never trusted from the caller's own database privileges.
//
// 2. writeAudit never throws. An audit failure must not roll back the action it
//    describes — losing the record of a publish is bad, but failing a publish
//    because logging broke is worse, and would make the logger a new outage
//    surface. Failures are surfaced through collector_runs-style logging instead.
import { dbClient } from "@/lib/db";
import type { Profile } from "@/lib/supabaseServer";

/**
 * Punch list #1: how long a published change can be treated as a mistake rather
 * than as history.
 *
 * Inside the window an undo removes the pending measurement, because a change
 * that was live for four minutes has nothing to say. Outside it, the change ran,
 * running is data, and reversing it writes a SECOND ledger entry rather than
 * erasing the first.
 *
 * The audit log records both identically and permanently either way — this
 * constant only governs the measurement queue.
 */
export const UNDO_WINDOW_MS = 60 * 60 * 1000;

export type AuditAction =
  | "approve" | "decline" | "publish" | "pause" | "resume"
  | "budget_change" | "revert" | "undo" | "retry" | "request_approval";

/** Whether a published change is still inside its undo window. */
export function withinUndoWindow(publishedAt: string | null | undefined): boolean {
  if (!publishedAt) return false;
  return Date.now() - new Date(publishedAt).getTime() < UNDO_WINDOW_MS;
}

export type AuditEntry = {
  action: AuditAction;
  targetType: "approval" | "change" | "recommendation" | "ad_entity" | "client";
  targetId?: string | null;
  clientId?: string | null;
  before?: unknown;
  after?: unknown;
  detail?: string;
  /**
   * True when no human was in the loop — alt text, schema, internal links.
   * Punch list #6: automatic changes must still be visible, so the Changes log
   * can filter on this. Anything the system does alone is recorded, not hidden.
   */
  automatic?: boolean;
  ip?: string | null;
};

export async function writeAudit(entry: AuditEntry, actor: Profile | null): Promise<void> {
  try {
    const db = dbClient();

    // organization_id is NOT NULL: derive it from the actor, else from the
    // client being acted on, so system actions still land.
    let orgId = actor?.organization_id ?? null;
    if (!orgId && entry.clientId) {
      const { data } = await db
        .from("clients").select("organization_id").eq("id", entry.clientId).maybeSingle();
      orgId = data?.organization_id ?? null;
    }
    if (!orgId) {
      console.error("[audit] no organization_id resolvable; entry dropped", entry.action, entry.targetId);
      return;
    }

    const { error } = await db.from("audit_log").insert({
      organization_id: orgId,
      client_id: entry.clientId ?? null,
      actor_id: actor?.id ?? null,
      actor_email: actor?.email ?? null,
      automatic: entry.automatic ?? false,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      detail: entry.detail ?? null,
      ip: entry.ip ?? null,
    });

    if (error) console.error("[audit] insert failed:", error.message, entry.action);
  } catch (e) {
    // Never let the trail break the action it describes.
    console.error("[audit] unexpected failure:", (e as Error).message);
  }
}

/**
 * Idempotency key for an action that must not happen twice.
 *
 * Approving the same card twice — double click, retried request, two people on
 * the same card — must publish once. The key is deterministic from what is being
 * done rather than when, so a retry collides with the original by design.
 */
export function idempotencyKey(parts: {
  action: AuditAction;
  targetId: string;
  /** Bump only when a genuinely new attempt is intended, e.g. a retry after failure. */
  attempt?: number;
}): string {
  return [parts.action, parts.targetId, parts.attempt ?? 0].join(":");
}

/**
 * Whether a role may decide a card that requires `requires_role`.
 *
 * Punch list #5: a card above your role is visible and explained, never hidden,
 * with a one-click request for approval. Visibility is RLS's job; authority is
 * this function's.
 */
const RANK: Record<string, number> = { client: 0, specialist: 1, pod_lead: 2, owner: 3 };

export function canDecide(actorRole: string | undefined, requiresRole: string): boolean {
  if (!actorRole) return false;
  return (RANK[actorRole] ?? -1) >= (RANK[requiresRole] ?? 99);
}
