// api/approvals — the yes/no. This is where an approval becomes a real change
// on a client's property.
//
// WO-003 Streams D + E-S. The whole product reduces to this route working
// correctly, so the order of operations matters more than the code volume:
//
//   1. authenticate + authorise (role must actually be allowed to decide)
//   2. claim the card atomically (status staged → publishing)  ← idempotency
//   3. execute against the platform
//   4. record the outcome, whatever it is
//   5. audit, always
//
// Step 2 before step 3 is deliberate. Two people on the same card, a double
// click, or a retried request must publish ONCE — so the claim is a conditional
// UPDATE that only one caller can win, not a read-then-write.
import { NextResponse } from "next/server";
import { getProfile, isAgency } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { readSecret } from "@/lib/vault";
import { writeAudit, canDecide } from "@/lib/audit";
import { connect, publish, type ShopifyChangeType } from "@/lib/shopifyAdapter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Payload = {
  adapter: "shopify" | "wordpress";
  changeType: ShopifyChangeType;
  targetGid: string;
  targetLabel?: string;
  before: string;
  after: string;
};

function back(req: Request, msg?: string) {
  const url = new URL("/dashboard/approvals", req.url);
  if (msg) url.searchParams.set("msg", msg);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(req: Request) {
  const profile = await getProfile();
  if (!isAgency(profile)) {
    return NextResponse.json({ error: "Agency access required" }, { status: 403 });
  }

  const form = await req.formData();
  const id = String(form.get("id") ?? "");
  const action = String(form.get("action") ?? "");
  const reason = form.get("reason") ? String(form.get("reason")) : null;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const db = dbClient();
  const { data: row } = await db.from("approvals").select("*").eq("id", id).maybeSingle();
  if (!row) return back(req, "not-found");

  // Authority is checked here, not just hidden in the UI. A locked card that is
  // merely not rendered is not a control.
  if (!canDecide(profile!.role, row.requires_role)) {
    await writeAudit(
      { action: "request_approval", targetType: "approval", targetId: id, clientId: row.client_id,
        detail: `${profile!.email} lacks ${row.requires_role}`, ip },
      profile
    );
    return back(req, "needs-higher-role");
  }

  // ── decline ────────────────────────────────────────────────────────────────
  if (action === "decline") {
    if (!reason) return back(req, "reason-required");

    // 60-day suppression so the same rule stops re-proposing what was refused.
    const suppress = new Date();
    suppress.setDate(suppress.getDate() + 60);

    await db.from("approvals").update({
      status: "declined", decline_reason: reason,
      decided_by: profile!.id, decided_at: new Date().toISOString(),
      suppress_until: suppress.toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    }).eq("id", id);

    await writeAudit(
      { action: "decline", targetType: "approval", targetId: id, clientId: row.client_id,
        before: { status: row.status }, after: { status: "declined", reason }, detail: reason, ip },
      profile
    );
    return back(req, "declined");
  }

  if (action === "request_approval") {
    await writeAudit(
      { action: "request_approval", targetType: "approval", targetId: id, clientId: row.client_id, ip },
      profile
    );
    return back(req, "approval-requested");
  }

  if (action !== "approve" && action !== "retry") return back(req, "unknown-action");

  // ── claim ──────────────────────────────────────────────────────────────────
  // Conditional update: only a card currently in a claimable state can be moved
  // to `publishing`, and only one caller wins the race. This is what makes a
  // double click safe.
  const claimable = action === "retry" ? "failed" : "staged";
  const { data: claimed } = await db
    .from("approvals")
    .update({ status: "publishing", attempt: (row.attempt ?? 0) + 1, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", claimable)
    .select("id")
    .maybeSingle();

  if (!claimed) return back(req, "already-in-progress");

  const payload = row.payload as Payload | null;
  if (!payload) {
    await fail(db, id, "approval has no staged change payload");
    return back(req, "no-payload");
  }

  try {
    if (payload.adapter !== "shopify") throw new Error(`adapter not implemented: ${payload.adapter}`);

    const { data: store } = await db
      .from("client_stores")
      .select("domain, api_client_id, auth_ref")
      .eq("client_id", row.client_id).eq("platform", "shopify").maybeSingle();
    if (!store?.api_client_id || !store.auth_ref) throw new Error("shopify store not configured for this client");

    const secret = await readSecret(db, store.auth_ref);
    if (!secret) throw new Error("shopify credentials missing from vault");

    const token = await connect(store.domain, store.api_client_id, secret);

    // dryRun: false is the ONLY place in the codebase that writes to a client
    // property, and it happens after a human has said yes to this exact card.
    const result = await publish(
      store.domain, token,
      {
        type: payload.changeType, targetGid: payload.targetGid,
        proposed: payload.after, current: payload.before,
        targetLabel: payload.targetLabel ?? payload.targetGid,
        stagedAt: row.created_at,
      },
      { dryRun: false }
    );

    const now = new Date().toISOString();
    await db.from("approvals").update({
      status: "published", decided_by: profile!.id, decided_at: now,
      published_at: now, error_detail: null, updated_at: now,
    }).eq("id", id);

    // The change ledger is what measurement attaches to. Without this row the
    // change happened and nothing will ever ask whether it worked.
    await db.from("changes").insert({
      client_id: row.client_id,
      title: row.title,
      description: `${payload.changeType} on ${payload.targetLabel ?? payload.targetGid}`,
      changed_at: now,
    });

    await writeAudit(
      { action: "publish", targetType: "approval", targetId: id, clientId: row.client_id,
        before: { value: result.before }, after: { value: result.after },
        detail: `${payload.changeType} → ${payload.targetLabel ?? payload.targetGid}`, ip },
      profile
    );

    return back(req, "published");
  } catch (e) {
    // Punch list #2: the card stays in the queue, carrying the real error.
    // A publish that fails silently is how a ledger ends up lying.
    const msg = (e as Error).message.slice(0, 500);
    await fail(db, id, msg);
    await writeAudit(
      { action: "publish", targetType: "approval", targetId: id, clientId: row.client_id,
        detail: `FAILED: ${msg}`, ip },
      profile
    );
    return back(req, "failed");
  }
}

async function fail(db: ReturnType<typeof dbClient>, id: string, detail: string) {
  await db.from("approvals")
    .update({ status: "failed", error_detail: detail, updated_at: new Date().toISOString() })
    .eq("id", id);
}
