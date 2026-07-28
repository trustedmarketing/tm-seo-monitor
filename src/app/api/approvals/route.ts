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
import { getProfile, isAgency, type Profile } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { readSecret } from "@/lib/vault";
import { writeAudit, canDecide, UNDO_WINDOW_MS } from "@/lib/audit";
import { policyFor, suppressUntil } from "@/lib/declinePolicy";
import { connect, publish, revert as revertChange, type ShopifyChangeType } from "@/lib/shopifyAdapter";
import * as wp from "@/lib/wordpressAdapter";
import { listSocialAccounts, createDraft } from "@/lib/postflow";
import { draftPost } from "@/lib/caption";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Payload = {
  adapter: "shopify" | "wordpress" | "postflow";
  /** Shopify change type, or a WordPress one — the adapter field disambiguates. */
  changeType: string;
  /** Shopify GID, or a JSON {postType,id} for WordPress. */
  targetGid: string;
  targetLabel?: string;
  before: string;
  after: string;

  // ── social series (adapter: "postflow") ──────────────────────────────────
  // A social card stages a BRIEF rather than finished copy: the words are
  // written at approval time, so nobody reviews a caption that was drafted
  // days earlier against numbers that have since moved.
  /** One line per instalment, e.g. "Week 3 — the cost of not doing it". */
  outline?: string[];
  /** The post that earned the series, for voice and subject continuity. */
  sourceContent?: string | null;
};

/** WordPress targets are stored as JSON because they need two fields, not one. */
function wpTarget(siteUrl: string, targetGid: string): wp.WpTarget {
  const parsed = JSON.parse(targetGid) as { postType: "posts" | "pages"; id: number };
  return { siteUrl, postType: parsed.postType, id: parsed.id };
}

/**
 * Resolve a client's platform credentials.
 *
 * Both adapters store the same shape in client_stores, so this is one lookup
 * rather than a branch per platform at every call site.
 */
async function credentials(db: ReturnType<typeof dbClient>, clientId: string, platform: string) {
  const { data: store } = await db
    .from("client_stores")
    .select("domain, api_client_id, auth_ref")
    .eq("client_id", clientId).eq("platform", platform).maybeSingle();
  if (!store?.api_client_id || !store.auth_ref) throw new Error(`${platform} store not configured for this client`);

  const secret = await readSecret(db, store.auth_ref);
  if (!secret) throw new Error(`${platform} credentials missing from vault`);

  return { domain: store.domain, user: store.api_client_id, secret };
}

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

  // ── bulk approve ───────────────────────────────────────────────────────────
  //
  // Punch list #8: "Approve all 3 is correctly scoped to low-risk change types.
  // Add the second constraint: bulk actions never span clients without explicit
  // per-client selection (client-isolation rule)."
  //
  // Both constraints are enforced HERE, not in the UI that renders the button.
  // A bulk action is the one place where a mistake multiplies, so the server
  // re-derives the eligible set rather than trusting a list of ids from a form.
  if (action === "approve_all") {
    const clientId = String(form.get("client_id") ?? "");
    if (!clientId) return back(req, "bulk-needs-client");

    const { data: eligible } = await db
      .from("approvals")
      .select("id, requires_role, severity")
      .eq("client_id", clientId)          // never spans clients
      .eq("status", "staged")
      .neq("severity", "High");           // low-risk only

    const ids = ((eligible ?? []) as { id: string; requires_role: string }[])
      .filter((r) => canDecide(profile!.role, r.requires_role))
      .map((r) => r.id);

    if (ids.length === 0) return back(req, "bulk-nothing-eligible");

    // Sequential on purpose: each card publishes through the same claim-execute
    // -record-audit path as a single approval, so one failure cannot corrupt the
    // others and every card still gets its own audit row.
    let ok = 0, failedCount = 0;
    for (const each of ids) {
      const r = await publishOne(db, each, profile, ip);
      if (r) ok++; else failedCount++;
    }

    await writeAudit(
      { action: "approve", targetType: "client", targetId: clientId, clientId,
        detail: `bulk approve: ${ok} published, ${failedCount} failed, ${ids.length} eligible`, ip },
      profile
    );
    return back(req, failedCount ? "bulk-partial" : "bulk-done");
  }

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

    const note = form.get("note") ? String(form.get("note")).slice(0, 500) : null;
    const policy = policyFor(reason);

    // "Other" without a note is a decline we cannot learn anything from, which
    // is the one kind the spec's learning layer specifically needs.
    if (policy.requiresNote && !note) return back(req, "note-required");

    // The reason decides the window. "Ask me next month" and "the client refused
    // this" are not the same statement, and treating them identically either
    // kills good proposals or nags a client on a schedule.
    await db.from("approvals").update({
      status: "declined", decline_reason: reason, decline_note: note,
      decided_by: profile!.id, decided_at: new Date().toISOString(),
      suppress_until: suppressUntil(reason),
      updated_at: new Date().toISOString(),
    }).eq("id", id);

    await writeAudit(
      { action: "decline", targetType: "approval", targetId: id, clientId: row.client_id,
        before: { status: row.status },
        after: { status: "declined", reason, note, suppress_days: policy.suppressDays, redraft: policy.redraft },
        detail: note ? `${reason}: ${note}` : reason, ip },
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

  // ── undo / revert ──────────────────────────────────────────────────────────
  //
  // Punch list #1. Two controls, one mechanism, and the difference is what
  // happens to the MEASUREMENT record — never to the audit trail, which records
  // both identically and permanently.
  //
  //   UNDO (< 60 min)   the change did not run long enough to mean anything.
  //                     Reverse it and drop the ledger row, so the 28-day queue
  //                     is not holding a verdict on something that was live for
  //                     four minutes.
  //   REVERT (>= 60 min) it ran. That is data. Reverse it and write a SECOND
  //                     ledger entry rather than erasing the first — a change
  //                     that ran three days and was then pulled is exactly the
  //                     kind of thing measurement must not hide.
  if (action === "undo" || action === "revert") {
    if (row.status !== "published") return back(req, "not-published");

    const payload0 = row.payload as Payload | null;
    if (!payload0) return back(req, "no-payload");

    const publishedAt = row.published_at ? new Date(row.published_at).getTime() : 0;
    const withinUndoWindow = Date.now() - publishedAt < UNDO_WINDOW_MS;
    // The window decides, not the button that was pressed. A stale page showing
    // "Undo" an hour later must not quietly skip the ledger entry.
    const mode = withinUndoWindow ? "undo" : "revert";

    try {
      const cred = await credentials(db, row.client_id, payload0.adapter);

      // Restore the value captured at stage time — the true original.
      if (payload0.adapter === "shopify") {
        const token = await connect(cred.domain, cred.user, cred.secret);
        await revertChange(
          cred.domain, token,
          { targetGid: payload0.targetGid, type: payload0.changeType as ShopifyChangeType, value: payload0.before },
          { dryRun: false }
        );
      } else if (payload0.adapter === "wordpress") {
        const pre = await wp.preflight(cred.domain, cred.user, cred.secret);
        await wp.revert(
          cred.domain, cred.user, cred.secret,
          { target: wpTarget(cred.domain, payload0.targetGid), type: payload0.changeType as wp.WpChangeType, value: payload0.before },
          { dryRun: false, plugin: pre.seoPlugin }
        );
      } else {
        throw new Error(`adapter not implemented: ${payload0.adapter}`);
      }

      const now = new Date().toISOString();
      await db.from("approvals").update({
        status: "reverted", error_detail: null, updated_at: now,
      }).eq("id", id);

      if (mode === "undo") {
        // Never ran meaningfully: take it out of the measurement queue. The
        // audit log below still records that it happened, so nothing is lost —
        // only the pending verdict goes.
        // Scoped by approval_id, not by title — two cards can legitimately
        // share a title, and deleting by title could take out someone else's
        // pending measurement.
        await db.from("changes").delete()
          .eq("approval_id", id).is("verdict", null);
      } else {
        await db.from("changes").insert({
          client_id: row.client_id,
          title: `Reverted: ${row.title}`,
          description: `Restored ${payload0.changeType} on ${payload0.targetLabel ?? payload0.targetGid}`,
          changed_at: now.slice(0, 10),
          source: "growth-os",
          approval_id: id,
          decided_by: profile!.id,
          decided_by_email: profile!.email,
          automatic: false,
        });
      }

      await writeAudit(
        { action: mode, targetType: "approval", targetId: id, clientId: row.client_id,
          before: { value: payload0.after }, after: { value: payload0.before },
          detail: mode === "undo"
            ? "undone inside the 60-minute window; ledger entry removed"
            : "reverted after the undo window; second ledger entry written",
          ip },
        profile
      );

      return back(req, mode === "undo" ? "undone" : "reverted");
    } catch (e) {
      const msg = (e as Error).message.slice(0, 500);
      await writeAudit(
        { action: mode, targetType: "approval", targetId: id, clientId: row.client_id,
          detail: `FAILED: ${msg}`, ip },
        profile
      );
      return back(req, "revert-failed");
    }
  }

  if (action !== "approve" && action !== "retry") return back(req, "unknown-action");

  const ok = await publishOne(db, id, profile, ip, action === "retry" ? "failed" : "staged");
  return back(req, ok === null ? "already-in-progress" : ok ? "published" : "failed");
}

/**
 * Claim a card and publish it. The ONLY path that writes to a client property.
 *
 * Single approve, retry and bulk approve all route through here, so they cannot
 * drift apart — a bulk action that skipped the claim, the ledger entry or the
 * audit row would be a silent second implementation of the most consequential
 * code in the product.
 *
 * Returns true on publish, false on failure, and null when the card could not be
 * claimed (someone else already has it).
 */
async function publishOne(
  db: ReturnType<typeof dbClient>,
  id: string,
  profile: Profile | null,
  ip: string | null,
  claimable: "staged" | "failed" = "staged"
): Promise<boolean | null> {
  const { data: row } = await db.from("approvals").select("*").eq("id", id).maybeSingle();
  if (!row) return null;

  // ── claim ──────────────────────────────────────────────────────────────────
  // Conditional update: only a card currently in a claimable state can be moved
  // to `publishing`, and only one caller wins the race. This is what makes a
  // double click safe.
  const { data: claimed } = await db
    .from("approvals")
    .update({ status: "publishing", attempt: (row.attempt ?? 0) + 1, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", claimable)
    .select("id")
    .maybeSingle();

  if (!claimed) return null;

  const payload = row.payload as Payload | null;
  if (!payload) {
    await fail(db, id, "approval has no staged change payload");
    return false;
  }

  try {
    // ── social: draft the series and push it to PostFlow ────────────────────
    // Handled before credentials() because PostFlow authenticates differently:
    // one agency-wide token plus a per-client group, not a client_stores row.
    if (payload.adapter === "postflow") {
      const summary = await publishSocialSeries(db, row, payload);

      const nowIso = new Date().toISOString();
      await db.from("approvals").update({
        status: "published", decided_by: profile?.id ?? null, decided_at: nowIso,
        published_at: nowIso, error_detail: null, updated_at: nowIso,
      }).eq("id", id);

      await db.from("changes").insert({
        client_id: row.client_id,
        title: row.title,
        description: summary,
        changed_at: nowIso.slice(0, 10),
        source: "growth-os",
        approval_id: id,
        decided_by: profile?.id ?? null,
        decided_by_email: profile?.email ?? null,
        automatic: false,
      });

      await writeAudit(
        { action: "publish", targetType: "approval", targetId: id, clientId: row.client_id,
          after: { value: summary }, detail: summary, ip },
        profile
      );
      return true;
    }

    const cred = await credentials(db, row.client_id, payload.adapter);

    // dryRun: false below is the ONLY place in the codebase that writes to a
    // client property, and it happens after a human has said yes to this card.
    let result: { before: string; after: string };

    if (payload.adapter === "shopify") {
      const token = await connect(cred.domain, cred.user, cred.secret);
      result = await publish(
        cred.domain, token,
        {
          type: payload.changeType as ShopifyChangeType, targetGid: payload.targetGid,
          proposed: payload.after, current: payload.before,
          targetLabel: payload.targetLabel ?? payload.targetGid,
          stagedAt: row.created_at,
        },
        { dryRun: false }
      );
    } else if (payload.adapter === "wordpress") {
      // Re-check that the SEO meta is still REST-writable. A plugin update or a
      // removed mu-plugin between staging and approval would otherwise fail
      // mid-write with a confusing error.
      const pre = await wp.preflight(cred.domain, cred.user, cred.secret);
      result = await wp.publish(
        cred.domain, cred.user, cred.secret,
        {
          type: payload.changeType as wp.WpChangeType,
          target: wpTarget(cred.domain, payload.targetGid),
          proposed: payload.after, current: payload.before,
          targetLabel: payload.targetLabel ?? payload.targetGid,
          stagedAt: row.created_at,
        },
        { dryRun: false, plugin: pre.seoPlugin }
      );
    } else {
      throw new Error(`adapter not implemented: ${payload.adapter}`);
    }

    const now = new Date().toISOString();
    await db.from("approvals").update({
      status: "published", decided_by: profile?.id ?? null, decided_at: now,
      published_at: now, error_detail: null, updated_at: now,
    }).eq("id", id);

    // The change ledger is what measurement attaches to. Without this row the
    // change happened and nothing will ever ask whether it worked.
    await db.from("changes").insert({
      client_id: row.client_id,
      title: row.title,
      description: `${payload.changeType} on ${payload.targetLabel ?? payload.targetGid}`,
      changed_at: now.slice(0, 10),
      source: "growth-os",
      approval_id: id,
      decided_by: profile?.id ?? null,
      decided_by_email: profile?.email ?? null,
      automatic: false,
    });

    await writeAudit(
      { action: "publish", targetType: "approval", targetId: id, clientId: row.client_id,
        before: { value: result.before }, after: { value: result.after },
        detail: `${payload.changeType} → ${payload.targetLabel ?? payload.targetGid}`, ip },
      profile
    );
    return true;
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
    return false;
  }
}

/**
 * Draft an approved series and land it in PostFlow, unscheduled.
 *
 * Two deliberate properties:
 *
 * · Drafts, never scheduled posts. The design is explicit that "scheduling stays
 *   a human call" — approving here means the idea is good, not that week one goes
 *   out on Tuesday. Those are different decisions.
 * · Partial success is reported, not swallowed. If three of four captions draft
 *   and the fourth fails, the card publishes with three and SAYS three. Failing
 *   the whole card would throw away work that already cost money and landed
 *   correctly.
 */
async function publishSocialSeries(
  db: ReturnType<typeof dbClient>,
  row: { id: string; client_id: string; title: string },
  payload: Payload
): Promise<string> {
  const token = await readSecret(db, "postflow");
  if (!token) throw new Error("no PostFlow token in vault");

  const { data: client } = await db
    .from("clients")
    .select("id, name, domain, client_type, postflow_group_id")
    .eq("id", row.client_id).maybeSingle();

  if (!client?.postflow_group_id) {
    throw new Error("client has no postflow_group_id — set it in Settings");
  }

  const accounts = await listSocialAccounts(token, client.postflow_group_id);
  if (accounts.length === 0) {
    throw new Error("PostFlow group has no connected social accounts");
  }

  // Voice examples come from the client's OWN best posts. Showing the register
  // beats describing it, and keeps drafts anchored to what already worked.
  const { data: topPosts } = await db
    .from("social_posts")
    .select("content, title")
    .eq("client_id", row.client_id)
    .not("content", "is", null)
    .order("posted_at", { ascending: false })
    .limit(5);

  const examples = (topPosts ?? [])
    .map((p: { content: string | null; title: string | null }) => (p.content ?? p.title ?? "").trim())
    .filter(Boolean)
    .slice(0, 3);

  const outline: string[] = Array.isArray(payload.outline) ? payload.outline : [];
  if (outline.length === 0) throw new Error("approval has no series outline");

  const created: string[] = [];
  const failures: string[] = [];

  for (let i = 0; i < outline.length; i++) {
    const brief = outline[i];
    try {
      const drafted = await draftPost({
        db,
        clientId: row.client_id,
        clientName: client.name,
        domain: client.domain,
        clientType: (client as { client_type?: string | null }).client_type ?? null,
        examples,
        brief,
        week: i + 1,
        sourcePost: payload.sourceContent ?? null,
      });

      const body = [drafted.caption, drafted.hashtags.join(" ")].filter(Boolean).join("\n\n");

      const res = await createDraft(token, {
        content: body,
        accountIds: accounts.map((a) => a.id),
        name: `${row.title} — week ${i + 1}`.slice(0, 100),
      });

      created.push(`week ${i + 1}${res.id ? ` (${res.id})` : ""}`);
    } catch (e) {
      failures.push(`week ${i + 1}: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  if (created.length === 0) {
    throw new Error(`no drafts created — ${failures.join("; ")}`);
  }

  const base = `${created.length} unscheduled draft${created.length === 1 ? "" : "s"} created in PostFlow`;
  return failures.length ? `${base}; ${failures.length} failed (${failures.join("; ")})` : base;
}

async function fail(db: ReturnType<typeof dbClient>, id: string, detail: string) {
  await db.from("approvals")
    .update({ status: "failed", error_detail: detail, updated_at: new Date().toISOString() })
    .eq("id", id);
}
