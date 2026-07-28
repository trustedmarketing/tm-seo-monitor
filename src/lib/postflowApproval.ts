// lib/postflowApproval.ts — find out when a client says no.
//
// WO-004. PostFlow has a full approval model and NO webhooks: 26 endpoints, none
// for callbacks. So the only way to learn that a client declined a post is to
// ask. This polls the posts we sent and reads the answer.
//
// What a decline looks like, from their schema:
//   PostApprovalData.rejected_at   — the timestamp
//   PostCommentData.is_rejected    — the comment carrying the REASON
//
// The reason is the point. "Declined" on its own tells a pod lead to go and look
// somewhere else; "declined: we are not running that promotion this month" tells
// them what to do.
import type { SupabaseClient } from "@supabase/supabase-js";
import { readSecret } from "@/lib/vault";
import { findArray } from "@/lib/apiShape";

const BASE = process.env.POSTFLOW_API_URL ?? "https://api.postflow.app/v1";

type Approval = { approved_at?: string | null; rejected_at?: string | null };
type Comment = {
  content?: string | null; guest_name?: string | null;
  is_rejected?: boolean; is_internal?: boolean;
  user?: { name?: string | null } | null;
};

export type PostState = {
  id: string;
  status: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  /** Why, in the client's words. */
  reason: string | null;
  reasonBy: string | null;
};

/**
 * Read approval state for a group's posts in a window.
 *
 * `include=postComments` because the rejection timestamp and the reason live on
 * different objects, and fetching them separately would double the calls against
 * a 60/min budget shared by every client.
 */
export async function fetchPostStates(
  token: string,
  groupId: string,
  days = 60
): Promise<Map<string, PostState>> {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const qs = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString(),
    groupId,
    include: "postComments",
  });

  const res = await fetch(`${BASE}/posts?${qs}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`PostFlow /posts failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const arr = findArray(await res.json());
  if (!arr) throw new Error("PostFlow returned posts in an unrecognised shape");

  const out = new Map<string, PostState>();

  for (const raw of arr) {
    const p = raw as Record<string, unknown>;
    if (p.id == null) continue;

    const approvals = (p.approvals ?? []) as Approval[];
    const comments = (p.comments ?? []) as Comment[];

    const rejected = approvals.find((a) => a.rejected_at);
    // The most recent rejecting comment. Internal notes are excluded: those are
    // the team talking to each other, not the client's answer.
    const reasonComment = comments
      .filter((c) => c.is_rejected && !c.is_internal && c.content?.trim())
      .slice(-1)[0];

    out.set(String(p.id), {
      id: String(p.id),
      status: (p.status as string) ?? null,
      approvedAt: (p.approved_at as string) ?? null,
      rejectedAt: rejected?.rejected_at ?? null,
      reason: reasonComment?.content?.trim() ?? null,
      reasonBy: reasonComment?.guest_name ?? reasonComment?.user?.name ?? null,
    });
  }

  return out;
}

export type DeclineResult = {
  client: string;
  checked: number;
  declined: number;
  approved: number;
  newlyDeclined: { slot: number; reason: string | null; by: string | null }[];
};

export async function checkApprovals(
  db: SupabaseClient,
  client: { id: string; name: string; postflow_group_id: string | null }
): Promise<DeclineResult> {
  const base: DeclineResult = {
    client: client.name, checked: 0, declined: 0, approved: 0, newlyDeclined: [],
  };
  if (!client.postflow_group_id) return base;

  const { data: plans } = await db
    .from("content_plans").select("id").eq("client_id", client.id);
  const planIds = (plans ?? []).map((p: { id: number }) => p.id);
  if (planIds.length === 0) return base;

  const { data: sent } = await db
    .from("content_plan_items")
    .select("id, slot, postflow_id, declined_at")
    .in("plan_id", planIds)
    .not("postflow_id", "is", null);

  const rows = (sent ?? []) as { id: number; slot: number; postflow_id: string; declined_at: string | null }[];
  if (rows.length === 0) return base;

  const token = await readSecret(db, "postflow");
  if (!token) return base;

  const states = await fetchPostStates(token, client.postflow_group_id);
  const now = new Date().toISOString();

  for (const row of rows) {
    const state = states.get(row.postflow_id);
    if (!state) continue;
    base.checked++;

    if (state.rejectedAt) {
      base.declined++;
      // Only NEWLY declined counts as news. A post declined last week must not
      // generate an alert every time the collector runs.
      if (!row.declined_at) {
        base.newlyDeclined.push({ slot: row.slot, reason: state.reason, by: state.reasonBy });
      }
      await db.from("content_plan_items").update({
        postflow_status: state.status, declined_at: state.rejectedAt,
        decline_note: state.reason, decline_by: state.reasonBy,
        approval_checked_at: now,
      }).eq("id", row.id);
    } else {
      if (state.approvedAt) base.approved++;
      // Clear a previous decline: a client who declined and then approved has
      // changed their mind, and the card should stop showing the old objection.
      await db.from("content_plan_items").update({
        postflow_status: state.status,
        declined_at: null, decline_note: null, decline_by: null,
        approval_checked_at: now,
      }).eq("id", row.id);
    }
  }

  return base;
}
