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
import * as metaAds from "@/lib/metaAdsAdapter";
import * as googleAds from "@/lib/googleAdsAdapter";
import * as microsoftAds from "@/lib/microsoftAdsAdapter";
import type { GoogleAdsAuth } from "@/lib/googleAds";
import type { MicrosoftAdsAuth } from "@/lib/microsoftAds";
import { checkSpendGuard } from "@/lib/adSpendGuard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Payload = {
  adapter: "shopify" | "wordpress" | "postflow" | "meta_ads" | "google_ads" | "microsoft_ads";
  /** Shopify change type, a WordPress one, or an ad changeType below — the adapter field disambiguates. */
  changeType: string;
  /** Shopify GID, a JSON {postType,id} for WordPress, or the platform's own campaign id for ad actions. */
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

  // ── paid ads (adapter: "meta_ads" | "google_ads" | "microsoft_ads") ──────
  // WO-006 stream D. changeType is "pause" | "resume" | "update_budget" |
  // "create_campaign". For update_budget, before/after above hold the
  // current/proposed daily budget as strings. create_campaign has no
  // existing campaign yet, so the spec travels here instead of in targetGid.
  campaignSpec?: { name: string; objective: string; dailyBudget: number };
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

const AD_PLATFORM_OF: Record<"meta_ads" | "google_ads" | "microsoft_ads", string> = {
  meta_ads: "meta",
  google_ads: "google_ads",
  microsoft_ads: "microsoft",
};

/**
 * Resolve ad-platform write credentials from `ad_platform_accounts` (not
 * `client_stores` — a different registry than the Shopify/WordPress path).
 *
 * v1 scope: only the simple per-account vaulted-bundle path is supported
 * here, matching the first resolution branch each collector tries. The
 * portfolio-level OAuth-refresh fallback lib/googleAdsCollector.ts also
 * supports for read collection at scale isn't replicated for writes yet —
 * flagged as a follow-up, not silently dropped, since a manually-triggered
 * approval can require the account to carry its own credentials by then.
 */
async function adCredentials(
  db: ReturnType<typeof dbClient>,
  clientId: string,
  adapter: "meta_ads" | "google_ads" | "microsoft_ads"
): Promise<{ externalId: string; secret: string }> {
  const platform = AD_PLATFORM_OF[adapter];
  const { data: account } = await db
    .from("ad_platform_accounts")
    .select("external_id, auth_ref")
    .eq("client_id", clientId)
    .eq("platform", platform)
    .maybeSingle();

  if (!account?.external_id || !account.auth_ref) {
    throw new Error(`${platform} ad account not configured for this client`);
  }
  const secret = await readSecret(db, account.auth_ref);
  if (!secret) throw new Error(`${platform} credentials missing from vault`);

  return { externalId: account.external_id, secret };
}

type AdActionResult = { before: string; after: string; campaignId?: string | null };

/**
 * Dispatch one ad-platform write to the right adapter. Split out of
 * publishOne() so every branch is forced to either return a result or
 * throw — no `let result` that TypeScript (or a reviewer) has to prove is
 * assigned on every path.
 */
async function dispatchAdAction(
  adapter: "meta_ads" | "google_ads" | "microsoft_ads",
  cred: { externalId: string; secret: string },
  changeType: string,
  targetGid: string,
  currentStatus: metaAds.CampaignStatus,
  currentDailyBudget: number,
  proposedDailyBudget: number,
  campaignSpec?: { name: string; objective: string; dailyBudget: number }
): Promise<AdActionResult> {
  if (adapter === "meta_ads") {
    if (changeType === "pause") return metaAds.pause(cred.secret, targetGid, currentStatus, { dryRun: false });
    if (changeType === "resume") return metaAds.resume(cred.secret, targetGid, currentStatus, { dryRun: false });
    if (changeType === "update_budget") {
      return metaAds.updateBudget(cred.secret, targetGid, currentDailyBudget, proposedDailyBudget, { dryRun: false });
    }
    if (changeType === "create_campaign" && campaignSpec) {
      return metaAds.createCampaign(cred.secret, cred.externalId, campaignSpec, { dryRun: false });
    }
  } else if (adapter === "google_ads") {
    const auth = JSON.parse(cred.secret) as GoogleAdsAuth;
    if (changeType === "pause") return googleAds.pause(auth, cred.externalId, targetGid, currentStatus, { dryRun: false });
    if (changeType === "resume") return googleAds.resume(auth, cred.externalId, targetGid, currentStatus, { dryRun: false });
    if (changeType === "update_budget") {
      return googleAds.updateBudget(auth, cred.externalId, targetGid, currentDailyBudget, proposedDailyBudget, { dryRun: false });
    }
    if (changeType === "create_campaign" && campaignSpec) {
      return googleAds.createCampaign(
        auth, cred.externalId,
        { name: campaignSpec.name, advertisingChannelType: campaignSpec.objective, dailyBudget: campaignSpec.dailyBudget },
        { dryRun: false }
      );
    }
  } else {
    const auth = JSON.parse(cred.secret) as MicrosoftAdsAuth;
    if (changeType === "pause") return microsoftAds.pause(auth, cred.externalId, targetGid, currentStatus, { dryRun: false });
    if (changeType === "resume") return microsoftAds.resume(auth, cred.externalId, targetGid, currentStatus, { dryRun: false });
    if (changeType === "update_budget") {
      return microsoftAds.updateBudget(auth, cred.externalId, targetGid, currentDailyBudget, proposedDailyBudget, { dryRun: false });
    }
    if (changeType === "create_campaign" && campaignSpec) {
      return microsoftAds.createCampaign(
        auth, cred.externalId,
        { name: campaignSpec.name, campaignType: campaignSpec.objective, dailyBudget: campaignSpec.dailyBudget },
        { dryRun: false }
      );
    }
  }
  throw new Error(`unsupported ad changeType: ${changeType}`);
}

/** Audit action matching what actually happened, not a generic "publish" —
 * lib/audit.ts's AuditAction already reserves pause/resume/budget_change. */
function auditActionFor(changeType: string): "pause" | "resume" | "budget_change" | "publish" {
  if (changeType === "pause") return "pause";
  if (changeType === "resume") return "resume";
  if (changeType === "update_budget") return "budget_change";
  return "publish"; // create_campaign
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

    // ── paid ads: pause/resume/update_budget/create_campaign ────────────────
    // WO-006 stream D. A different credential registry (ad_platform_accounts,
    // not client_stores) and a different write target (a `campaigns` row,
    // not a content field), so this branches out fully rather than sharing
    // the shopify/wordpress path below. Undo/revert for these actions isn't
    // wired yet — pause/resume/budget changes are self-reversing via a second
    // approval card in v1 (flagged, not silently dropped; see CLAUDE.md
    // autonomy #1 — no agent performs a paid write autonomously either way).
    if (payload.adapter === "meta_ads" || payload.adapter === "google_ads" || payload.adapter === "microsoft_ads") {
      const platform = AD_PLATFORM_OF[payload.adapter];
      const isCreate = payload.changeType === "create_campaign";

      const { data: campaignRow } = isCreate
        ? { data: null as { id: string; daily_budget: number | null; status: string } | null }
        : await db
            .from("campaigns")
            .select("id, daily_budget, status")
            .eq("client_id", row.client_id)
            .eq("platform", platform)
            .eq("campaign_id", payload.targetGid)
            .maybeSingle();

      if (!isCreate && !campaignRow) {
        await fail(db, id, `campaign ${payload.targetGid} not found in the campaigns registry`);
        await writeAudit(
          { action: "publish", targetType: "ad_entity", targetId: id, clientId: row.client_id,
            detail: `FAILED: campaign ${payload.targetGid} not found`, ip },
          profile
        );
        return false;
      }

      // ── spend guard (spec §7 hard guardrail) — escalate, never approve-through ──
      const currentDailyBudget = campaignRow?.daily_budget ?? 0;
      const proposedDailyBudget = Number(payload.after) || 0;
      const projectedDailyBudget =
        payload.changeType === "pause" ? 0
        : payload.changeType === "resume" ? currentDailyBudget
        : payload.changeType === "update_budget" ? proposedDailyBudget
        : payload.campaignSpec?.dailyBudget ?? 0;

      const { data: otherCampaigns } = await db
        .from("campaigns")
        .select("daily_budget")
        .eq("client_id", row.client_id)
        .eq("platform", platform)
        .eq("status", "active")
        .neq("id", campaignRow?.id ?? "");
      const otherCampaignsMonthlyBudget = ((otherCampaigns ?? []) as { daily_budget: number | null }[])
        .reduce((sum, c) => sum + (c.daily_budget ?? 0) * 30, 0);

      const { data: guard } = await db
        .from("ad_spend_guards")
        .select("daily_ceiling, monthly_ceiling")
        .eq("client_id", row.client_id)
        .eq("platform", platform)
        .maybeSingle();

      const guardResult = checkSpendGuard(guard ?? null, { projectedDailyBudget, otherCampaignsMonthlyBudget });
      if (guardResult.blocked) {
        await fail(db, id, `blocked by spend guard: ${guardResult.reason}`);
        await writeAudit(
          { action: "publish", targetType: "ad_entity", targetId: id, clientId: row.client_id,
            detail: `BLOCKED by spend guard: ${guardResult.reason}`, ip },
          profile
        );
        return false;
      }

      const cred = await adCredentials(db, row.client_id, payload.adapter);
      const currentStatus = (campaignRow?.status ?? "paused") as metaAds.CampaignStatus;

      const adResult = await dispatchAdAction(
        payload.adapter, cred, payload.changeType, payload.targetGid,
        currentStatus, currentDailyBudget, proposedDailyBudget, payload.campaignSpec
      );

      // Reflect the change locally right away — don't wait for tomorrow's collector run.
      if (isCreate) {
        if (adResult.campaignId) {
          const { data: newCampaign } = await db.from("campaigns").insert({
            client_id: row.client_id, platform, campaign_id: adResult.campaignId,
            campaign_name: payload.campaignSpec?.name ?? null, status: "paused",
            objective: payload.campaignSpec?.objective ?? null, daily_budget: payload.campaignSpec?.dailyBudget ?? null,
            last_synced_at: new Date().toISOString(),
          }).select("id").single();

          // Turnkey link (WO-006 streams G/H): the creative and copy set
          // generated at staging time (stage-ad-action) had no real
          // campaign to attach to yet, so they were tagged with this
          // approval's id instead. Now that the campaign exists, backfill
          // campaign_id on both — approval_id already scoped this to
          // exactly the assets this campaign's own staging generated.
          if (newCampaign) {
            await db.from("creatives").update({ campaign_id: newCampaign.id }).eq("approval_id", id);
            await db.from("ad_copy_sets").update({ campaign_id: newCampaign.id }).eq("approval_id", id);
          }
        }
      } else if (campaignRow) {
        await db.from("campaigns").update({
          status: payload.changeType === "pause" ? "paused" : payload.changeType === "resume" ? "active" : campaignRow.status,
          daily_budget: payload.changeType === "update_budget" ? proposedDailyBudget : campaignRow.daily_budget,
          updated_at: new Date().toISOString(),
        }).eq("id", campaignRow.id);
      }

      const nowAd = new Date().toISOString();
      await db.from("approvals").update({
        status: "published", decided_by: profile?.id ?? null, decided_at: nowAd,
        published_at: nowAd, error_detail: null, updated_at: nowAd,
      }).eq("id", id);

      await db.from("changes").insert({
        client_id: row.client_id,
        title: row.title,
        description: `${payload.changeType} on ${payload.targetLabel ?? payload.targetGid}`,
        changed_at: nowAd.slice(0, 10),
        source: "growth-os",
        approval_id: id,
        decided_by: profile?.id ?? null,
        decided_by_email: profile?.email ?? null,
        automatic: false,
      });

      await writeAudit(
        { action: auditActionFor(payload.changeType), targetType: "ad_entity", targetId: id, clientId: row.client_id,
          before: { value: adResult.before }, after: { value: adResult.after },
          detail: `${payload.changeType} → ${payload.targetLabel ?? payload.targetGid}`, ip },
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
