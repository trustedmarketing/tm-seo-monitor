# Growth OS — STATUS

_Last updated: 2026-08-11_
_Location note: this file and `WORKLOG.md` live at the **repo root**, not in `docs/`. See `CLAUDE.md`._

### 🔴 Open right now — portfolio expansion (2026-08-11)

Went from 4 clients to 19. Everything below is sequenced and unfinished.

**Done:** 15 clients inserted with `location_code` 9057285 (Martin County — Stuart,
Palm City, Jensen Beach, Hobe Sound), plus Alpha Zeta corrected off 2840. eCommerce
and arX Display stay national on 2840.

**Deliberately NOT done — client Slack webhooks.** Held back so the first daily
brief is email-only and can be read before any of it reaches a client, per the
accuracy gate (autonomy #3). Tom holds the 19 webhook URLs; the SQL to apply them
is a `case lower(domain)` update, regenerated from his list rather than stored
here — webhooks are credentials and do not belong in the repo.

**Next, in order:**

1. **Top up DataForSEO.** Balance was $12.93 at 4 clients. Crawls and SERP scale
   per client — 19 will exhaust it, and collection fails partway through.
2. **Read the 10:30 UTC brief**, then apply the client webhooks.
3. **Keywords, prompts, GA4 and GSC** for the 15 new clients — they show
   "collecting" until then, which is expected, not a fault. See
   `docs/sop-client-onboarding.md`.
4. **Verify Salty Dog against Shopify** — order count should be near ~370, not
   599. If it has not moved, the date-window fix did not take.
5. **Confirm the crawl fix on a live task** —
   `api/ops/dataforseo-check?task=<id>`. `crawlProgress: "finished"` = fixed.

**Known gap, unbuilt:** DataForSEO has NO spend ceiling. Ads have a hard
guardrail and Anthropic usage is metered, but crawls/SERP/AEO all draw from one
balance with nothing to stop a runaway. At 4 clients that was theoretical; at 19
it is not, and the failure mode is collection stopping silently mid-month.

**Known gap, unbuilt:** `clients.service_areas` is stored and editable but read
by no collector. `location_code` is the only field that affects tracking. Flagged
in the UI so nobody fills it in believing otherwise.

### Crawls fixed after a month dead (2026-08-10) — ✅ MERGED, ⏳ NEEDS LIVE CONFIRMATION

PR #40. DataForSEO's `/v3/on_page/summary/$id` is a **GET**; we sent POST. It
answers 200 with an empty result rather than erroring, which our code read as
"still crawling" — so every crawl stalled, was abandoned at 48h, requeued, and
repeated. Zero completed crawls in 30 days across all four clients, with no
exception ever raised: the error path was fine, the **success path lied**.

Site-health / QC data was dead portfolio-wide for a month.

**Pending:** confirm against a live task —
`api/ops/dataforseo-check?task=<id>` (ids listed under `pending_tasks`).
`crawlProgress: "finished"` = fixed; `resultRows: 0` = still wrong. Existing
in-flight tasks are days old, so the next cron should score them immediately.

### Paid workspace completed (2026-08-10) — ✅ MERGED

- **PR #39** — `PaidNav` sub-nav. `/paid/personas` previously had no link from
  anywhere in the app; `/paid/creative`'s only route was buried in body copy.
- **PR #41** — Stream J, spend-guard settings UI at `/paid/guardrails`. The
  guardrail has been enforced since stream D but ceilings could only be set via
  hand-written SQL, so no client had one and every budget change passed
  unchallenged. Owner-only writes.

WO-006 is now complete: streams A–J all shipped.

### Portfolio + /paid date windows (2026-08-10) — ✅ MERGED

PR #37. The #28 fix was applied to `/dashboard/[id]` only; the portfolio page and
`/paid` still had **no date filter**, so their Revenue / MER / Ad spend figures
were lifetime totals labelled "period total". The portfolio and client Overview
disagreed with each other for any client live over 30 days. Swept both tables'
readers — only those three were unbounded. All windows are now labelled.

PR #38 also fixed the attention rail, which never selected `collector_runs.error`
(so it could only ever say "Collection failed") and kept showing red for modules
that had since recovered.

### Accuracy alerting (2026-08-10) — ✅ ALL CHANNELS ARMED AND VERIFIED

The platform now tells you when its own numbers stop being trustworthy, rather
than waiting for someone to spot it by eye against Shopify's dashboard (which
is how the Overview page's revenue bug went unnoticed for a week). PRs #29–#35.

| Failure mode | Check | Status |
|---|---|---|
| Numbers are **wrong** | `lib/revenueReconciliation.ts` — stored vs. a fresh Shopify pull, >2% AND >$25 | ✅ armed |
| Numbers **stopped** | `lib/dataFreshness.ts` — no new revenue/spend row in 3+ days | ✅ armed |
| Cron **never ran** | `lib/heartbeat.ts` — external dead-man's switch | ✅ armed, ping confirmed |
| Alerting itself broken | `api/ops/alert-check` | ✅ Slack + email both confirmed arriving |

Delivery via `lib/notify.ts` → Slack **and** email, independently, so one
misconfigured channel can't swallow an alert. All verified by an actual
delivered message, not by the env vars looking right — it took three separate
misconfigurations to get email working (default `ALERT_EMAIL_FROM` sender,
missing `ALERT_EMAIL_TO`, unverified Resend domain) and every one of them
looked fine from the Vercel dashboard.

**Known blind spot, by construction.** Reconciliation compares stored rows
against a fresh `fetchDailySales()` call — but the stored rows were *written*
by `fetchDailySales()`. A bug in that query moves both sides together and
reconciles perfectly clean. It proves the pipeline is internally consistent; it
cannot prove the query is right. That has to be checked against Shopify's own
reporting UI. PR #35 fixed exactly such a bug (see below), which reconciliation
had been reporting as healthy the whole time.

Env vars, the `ALERT_EMAIL_FROM` / `ALERT_EMAIL_TO` gotchas, and the heartbeat
setup are documented in the README's "Alerting channels" section.

### Shopify revenue definition fixed (2026-08-10) — ✅ MERGED, ⏳ NEEDS ACCURACY CHECK

PR #35. The collector summed `totalPriceSet` — Shopify's docs: "the total price
of the order, **before returns**" — so refunded money counted as revenue
permanently, and test-gateway orders counted too. Now uses
`currentTotalPriceSet` ("**after returns**") with a `test:false` filter.

**Expect reported revenue to DROP toward Shopify's own figure on the next
collection. That drop is the fix working, not a regression.**

**Pending (accuracy gate, `CLAUDE.md` autonomy #3):** parallel-check Salty Dog's
next two collection cycles against the Shopify admin dashboard before trusting
the number. Still unsettled: whether cancelled-but-unrefunded orders need a
separate `status:` filter — deliberately not guessed at, needs real store data.

### Paid ads control surface — WO-006 (2026-08-10) — ✅ MERGED TO MAIN

All nine module streams (`module/paid-campaign-registry` through
`-ui-actions`, plus the docs branch) are merged into `main` — PRs #15–#24, in
dependency order. Migrations 039–043 have been run against **both**
`tm-growth-staging` and production Supabase, confirmed via a direct
`information_schema` check (all 5 tables present, `creatives.approval_id`
column present). `npm test` (455/455) and `tsc --noEmit` verified clean on
the actual merged `main`, not just a local scratch branch. Full writeup:
`docs/wo-006-paid-ads-control-surface.md`; session summaries in `WORKLOG.md`.

Ships: campaign-level day-prior/7-day/30-day ROAS on `/paid`, a `"Paid"`
recommendations category, dry-run-first pause/resume/budget/create-campaign
adapters behind the existing approval-card flow with a spend-guard hard
guardrail, a customer-persona data model (copy/creative context only, no
platform targeting sync), Bloom ad creative that generates 4:5 first and only
fans out to 1:1/9:16 after a human approves the concept, generated ad copy
per platform (Google RSA/PMax, Microsoft RSA, Meta feed) with verified
real character/count limits, locally-rendered previews of how each format's
copy will look, and real in-app forms (`/paid`, `/paid/creative`) for all of
the above instead of typed API URLs. Staging a new campaign bundles creative
+ copy generation together — the turnkey path.

**Open before live ad-account writes are safe:** write-scope OAuth tokens for
Meta/Google/Microsoft Ads (escalation — Tom-only, see CLAUDE.md) — until
these exist, pause/resume/budget/create-campaign stay dry-run-only against
real accounts. Testing plan: Salty Dog only for now (already onboarded, real
ad accounts connected) — the next daily cron (10:00 UTC) or a manual
`/api/cron/collect` hit will populate the new `campaigns` table for it.

**Not yet built:** spend-guard ceiling settings UI (still a direct DB
insert), rich creative/copy preview inside `ApprovalCard.tsx` itself (lives
only on `/paid/creative` today), a real Bloom brand allowlist.

### Social content planner — WO-004 (2026-07-28)

Build a month, decide it slot by slot, finish each post, send it. Working
end to end today: plan generation from client-specific evidence, per-slot
approve/skip/rewrite, caption drafting with playbook rules and standing hashtags,
Bloom artwork, and PostFlow delivery as unscheduled drafts.

**Open decisions and next steps**

- **Video slots produce a still, not a video.** Deliberate: the networks reward
  native video, and omitting it to match our tooling would be worse advice
  dressed as a complete month. The still is an OPENING FRAME. Intended path is
  still → video via **Higgsfield**, already connected, not yet wired. Until then
  a video slot is a storyboard frame plus human work.
- **Client approval surface undecided.** Posts land in PostFlow as unscheduled
  drafts. Whether the client approves in PostFlow's strict-approval mode or in
  our own portal is unresolved; PostFlow's approval API is not documented well
  enough to build on.
- **Bloom is pilot-only.** Ray declined a DPA (no timeline). Public assets only,
  two brands. Wider rollout is a CLO decision.

## Shipped to production
- **WO-001 enabling layer** — staging Supabase, vitest + `MOCK_APIS` harness, CI, branch/agent conventions.
- **Collectors** (per-client, vaulted, dynamic, into a shared spine): organic/SEO, AI visibility, **Meta ads**,
  **GA4 conversions**, **Shopify revenue**, **Google Ads**, **Microsoft/Bing ads**; **job queue +
  `collector_runs`** observability; **secrets vault**; **ClickUp sync**.
- **WO-002 — Growth OS dashboard reorg** (PR #13, live 2026-07-23): channel-oriented IA. `/dashboard/[id]`
  is the revenue-first Overview (MER hero + reconciliation), SEO detail moved to `/organic`, new `/paid`
  and `/revenue`; `/dashboard` is the portfolio roll-up; `/command` retired → redirect. v1.5 parallelized
  the SERP + AI collection that was hitting the 300s cron ceiling.
- **Prod go-live on real data** (2026-07-23): repointed prod env off staging Supabase, `MOCK_APIS=0`.
- Two correctness bugs caught by the **accuracy gate** and fixed: Meta 6× conversion/revenue double-count;
  vault read/write via SECURITY DEFINER RPCs.

## Live on a real client
- **Salty Dog** (getsaltydog.com): real data in prod, 28-day — SEO 7,696 traffic / 229 kw / 976 backlinks ·
  Shopify revenue **$42,190.58** · Meta spend **$22,878.96** · **MER 1.84×**.
- Daily cron firing and completing (10:00 UTC = 6am ET).
- ✅ **GA4 conversions fixed 2026-07-28** after six days of daily failures. Root cause was **not**
  permissions: `clients.ga4_property_id` held **451445566**, a property that is not Salty Dog's. The
  real property is **539468239** ("Salty Dog Website", account 396237580). Three access grants were
  applied to fix a problem that was never about access, because GA4's error never named the property
  it was refusing. Verified via `/api/ops/ga4-check` → `ok: true`. First GA4 rows land on the next
  run, which backfills 28 days.

## Design deliverables — ✅ DONE
- **Growth OS design export** committed at `docs/design/` — 16 screens across agency + client portal,
  plus ApprovalCard (4 variants × 8 states) and RecCard (5 variants × 6 states). Mapped in
  `docs/design/README.md`.
- **Design review** — `docs/design-review-punch-list.md`. Verdict: approve the direction and build from it.
- **Feasibility review vs current stack** — `docs/feasibility-review-stack.md`. ~60% builds on what's
  running, 25% new-but-ordinary, **15% blocked on approvals never started**.
- **`docs/wo-003-design-implementation.md`** — ✅ **APPROVED 2026-07-27, Wave 1 in progress.** Six
  waves, 12 agent-parallel streams, every punch-list item assigned to a stream.

## Punch list — corrected 2026-07-29
This table read "all 10 NOT STARTED" from 2026-07-27 until 2026-07-29. It was
wrong: Stream D and F work landed in between and the table was never updated.
Verified against the code on 2026-07-29 — status column below is what is
actually in `src/`, not what was planned.

Each item is assigned to a WO-003 stream (see that doc); none is unowned.

| # | Item | WO-003 stream | Status (verified 2026-07-29) |
|---|---|---|---|
| 1 | Undo (60 min) vs Revert (writes a second ledger entry) | E · `module/wp-adapter` | ✅ in `ApprovalCard.tsx` |
| 2 | Failed-job state — publish fails, card stays in queue | D · `module/approval-card` | ✅ `status: "failed"` keeps the card queued with the real error |
| 3 | Slipped playbook items — status chip + reason + owner date | J · `module/portal-shell` | ⛔ not started (Wave 4) |
| 4 | Client decline round-trip back to the agency queue | K · `module/portal-approvals` | 🟡 half-built — WO-004 does it for PostFlow social declines (`lib/postflowApproval.ts`); the portal half is Wave 4 |
| 5 | Role-aware locked card + Request approval | D · `module/approval-card` | ✅ `canDecide(actorRole, requires_role)` |
| 6 | Automatic-changes audit surface (filter in Changes log) | C · `module/audit-log` / I · `module/changes-log` | ⛔ not started |
| 7 | Per-module data freshness lines | D · `module/approval-card` | ✅ `freshness` prop on every card |
| 8 | Bulk approve never crosses clients | F · `module/approvals-queue` | ⛔ not started |
| 9 | SLA breach consequence — notify 24h, escalate 48h | F · `module/approvals-queue` | ✅ `lib/slaEscalation.ts` |
| 10 | "Share this page" — signed expiring link, or cut from v1 | J · `module/portal-shell` (decision) | ⛔ undecided |

## Parked — picked up in this order when Organic is done (noted 2026-07-29)

Written down because we moved to the Organic tab mid-stream. Nothing here is
blocked; it is all sequenced behind a deliberate choice, and none of it should be
rediscovered from scratch.

### 1. Verify the social pipeline against real data — HIGHEST RISK OPEN ITEM
Three WO-004 paths shipped without ever being watched working. This is the only
**client-visible** risk currently live in production.

- **Campaign date windows.** `lib/campaignDates.ts` has 13 unit tests; no real
  month has been observed posting inside its window. The failure mode is a post
  advertising a sale three days before it opens, which sends people to a page
  that is not live. Test: put a dated campaign line on a Salty Dog month, build
  the plan, confirm the slot dates land inside the window and that the parsed
  window is shown back correctly on the card.
- **Decline round-trip end to end.** `lib/postflowApproval.ts` polls
  `/posts?include=postComments` for `approvals[].rejected_at`. Never exercised
  with a genuine client decline. Test: decline a real draft in PostFlow, confirm
  the alert fires with the client's reason attached and the card returns to
  editable.
- **Cross-month dedup.** The planner is supposed to avoid repeating a post used
  in a previous month. Only provable by building two consecutive months for the
  same client and diffing the source items.

### 2. Wave 4 — the Salty Dog client portal
`/portal` is an honest placeholder (Stream A). Everything built so far is
agency-internal; no client-facing surface exists. Salty Dog is the decided pilot
and is eCommerce, so it sidesteps the call-tracking blocker (plan §10 decision 0)
that has now surfaced four times. Picks up punch-list **#4** (client decline
round-trip), which WO-004 already half-built for social.

This is also the test of the agency-in-a-box question: it gets answered by a
client logging in and finding it useful, not by more internal tooling.

### 3. Finish the design-token conversion
`PageHeader.tsx` now exists, so each remaining surface drops its hand-rolled
header and picks up the shared one. Mechanical, not a redesign. Remaining:
`PlanSlot`, `ClientHeader`, the workspace tab bar, the approvals queue.
Completes WO-003 Stream M.

### 4. Still pending Tom — external actions only he can take
- ⛔ **Google Ads Basic access application: STILL NOT SUBMITTED.** The
  Explorer-tier token has been vaulted since 2026-07-22 and the collector is
  built and wired into cron. This is pure calendar time not being burned.
  Two faster, non-application steps alongside it (~2 min each): link Salty Dog's
  Google Ads account under **MCC 711-022-5227**, and seed its customer ID into
  `ad_platform_accounts`. Those two alone get first real Google data flowing
  without waiting on the upgrade.
- ⏳ **GBP** — submitted 2026-07-27, pure waiting, expect Google ~2026-08-10.
- ⛔ **Call-tracking decision** (plan §10 decision 0). Blocks the "calls from
  organic" tile and the local_service revenue variant. Not on the critical path
  while the portal pilot is eCommerce.

### 5. Known limits accepted, not bugs
- Bloom signed URLs expire after ~7 days, so plans older than that show broken
  thumbnails. Assets are meant to be re-hosted into our own storage; not done.
- Video slots produce an opening frame, not video. Higgsfield is connected but
  not wired.

---

## In flight
- **Bloom (trybloom.ai) — vendor answers received 2026-07-27, RECOMMENDATION: ADOPT FOR SUBSET.**
  Full written answers from Ray (founder), two days ahead of the deadline. Every blocking gate
  cleared: **agency/client/resale use explicitly permitted** (the largest flag — the ToS was silent),
  **no model training** (they run on Google/OpenAI/Anthropic commercial APIs and do not opt into
  sharing), ownership retained, workspace isolation confirmed, **4:5 supported** plus seven more
  ratios, export via API at any time.
  **Conditions, resolved 2026-07-28:** ✅ month-to-month confirmed (not annual);
  ❌ **DPA declined.** Ray replied that Bloom has no DPA or subprocessor process and will not be
  putting one in place in the near term — an honest no rather than a slipped timeline. He offered a
  limited path: brand-fidelity pass on the first brands, revisit before wider rollout.

  **Revised position:** take the limited pilot, under our own constraint — **only assets the client
  has already published publicly** (logos, storefront imagery, live product photography). Nothing
  unreleased, customer-identifiable, or confidential. **Wider rollout is a CLO decision, not a CTO
  one**, and worth scoping alternatives before it is forced. See
  `docs/legal-vendor-data-policy.md`.
  **Accepted risks, explicitly:** no IP/trademark indemnity (mitigated structurally — every creative
  passes a human approval card before it can run, and ad launches are always human-approved), no
  uptime SLA (generation is batch, not real-time), no fixed post-deletion export window (neutralised
  by re-hosting every asset into our own `creatives` table).
  ⚠️ **Pricing detail that changes the model: each aspect ratio is a separate billed asset.** One
  concept in 1:1/4:5/9:16 costs 3 credits, so 2,000 credits ≈ **660 three-ratio concepts/month**, not
  2,000. Budget in assets, not concepts.
  **Still open (not blocking):** deliverable 2, brand fidelity — 6 samples exist, credits ran out
  mid-spike. Finish on the paid plan against Salty Dog + one other before scaling past a subset.
  Also accept Ray's offer of a shared Slack channel.

## Pending Tom — five external actions (Wave 0 of WO-003)
**All calendar time, all currently blocking design surfaces, and three have never been started.**
WORKLOG 2026-07-27 lists exactly which streams each one gates.

1. ⛔ **Google Ads — upgrade the developer token from Explorer to Basic access** (MCC 711-022-5227).
   An **Explorer-tier token already exists and is vaulted** (`google_ads_developer_token`, 2026-07-22),
   along with the full OAuth bundle; the collector is built, wired into cron, and mints access tokens
   per run. What's missing is the **Basic-access upgrade application — not submitted** — which is what
   full-portfolio daily volume needs. Two further ~2-minute steps, also Tom, are *not* applications:
   **link Salty Dog's Google Ads account under MCC 711-022-5227** and **seed its customer ID into
   `ad_platform_accounts`**. Those two are the fastest path to first real Google data.
2. ✅ **GBP Business Profile API access request — SUBMITTED 2026-07-27.** Awaiting Google review;
   stated window 14 days, so expect a response **around 2026-08-10**, possibly later. Filed as
   "Application For Basic API Access" against the **`tm-seo-monitor` GCP project** (approval is
   locked to that project number and does not transfer), citing **Alpha Zeta Landscapes** as the
   verified 60+ day profile. Scoped smaller than assumed: **one application per GCP project, not
   one per client** — approval covers all eight Business Profile APIs including Performance, and per
   client it reduces to a Manager invite (runbook step 5b). ⚠️ Still open: GBP may not support
   service accounts (we use one for GSC/GA4); the stream may need its own OAuth flow. **Nothing to
   do but wait — this is now pure calendar time.**
3. ✅ **Meta system-user token — CONFIRMED LIVE.** Verified from `collector_runs`: `meta_ads` is
   collecting 690–723 rows daily. The feasibility review's claim was stale.
4. ✅ **PostFlow API — RESOLVED 2026-07-27. Yes, full REST API.** Verified against their docs +
   `llms.txt`: create/schedule posts, explicit **draft** set/unset, list + retrieve post groups,
   per-post and per-group analytics, media upload, activity logging. The design's "drafts land in
   PostFlow" handoff works as drawn; PostFlow stays the publishing tool. **Module E unblocked on
   this question.** ✅ Token generated and **vaulted as `postflow` in
   production 2026-07-27** (verified readable via `vault_read_secret`, 52 chars). Rate limits
   confirmed: 60 req/min per token with `X-RateLimit-*` headers. Confirm at build time (neither changes scope):
   plan-tier gating · whether post details expose a published permalink.
5. ⛔ **Decide the call-tracking question** (plan §10, decision 0). Blocks portal headline metrics for
   local-service clients. *An eCommerce portal pilot removes this from the critical path entirely.*

✅ **Decided 2026-07-27:** portal pilot is **Salty Dog** (eCommerce → Wave 4 not gated by call
tracking); screenshot service is a **vendor** (Browserless/ScreenshotOne) rather than self-hosted
Playwright. Remaining WO-003 open question: punch-list #10, signed expiring link or cut from v1.

⚠️ **Do not let the Salty Dog pilot bury this:** the portal's local-service headline (Calls · Cost
per job · Jobs booked) is still uncomputable for most of the portfolio. That's plan §10 decision 0
and it needs its own deadline.

## WO-003 Wave 1 — in progress
- ✅ **Stream A · `module/auth-rls` — SHIPPED TO PRODUCTION 2026-07-27** (merge `75130da`, security
  fix `247ff2f`). The hard gate is closed: client isolation is now enforced by Postgres, not by
  application code. Migration 012 applied to staging **and production**. Vercel production env vars
  set. Live accounts: `thomas@trustedmarketing.com` (**owner**, all clients) and
  `tom@getsaltydog.com` (**client**, Salty Dog only).
  **Verified against real production data before merge:** owner sees DAPS.FIT + Salty Dog / 300
  rankings; the client user sees Salty Dog only / 201 rankings; asking explicitly for DAPS.FIT's
  UUID returns **zero rows**; neither role can read `platform_secrets`.
  🔒 **One security defect found and fixed the same day:** push review caught an **open redirect**
  in the login `next` parameter (`/login?next=https://evil.com` would sign a user in and then hand
  them to an attacker — credible phishing, since the sign-in itself is genuine). Fixed in
  `lib/safeNext.ts` with 19 regression tests. Deployed.
- 〜 superseded detail below — Migration 012 (multi-tenant identity
  + per-client RLS) green on staging; app moved off the two shared passwords onto per-user Supabase
  Auth, and all six dashboard pages read through `userClient()` so RLS is enforced rather than
  bypassed. Proven: agency user sees 2 clients / 258 rankings, client user sees 1 / 129, neither can
  read `platform_secrets`. Green: tsc, build, 98/98 unit, 11/11 staging (collectors unaffected).
  ⛔ **Not deployable yet** — needs `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel **and real user accounts**. No users exist, so merging
  as-is locks everyone out. First accounts to be created deliberately with Tom.
- ✅ **Stream B · `module/screenshots` — VERIFIED END TO END 2026-07-28.** Full pipeline proven in
  production via `/api/ops/screenshot-check`: capture → upload to the private `screenshots` bucket →
  signed URL → 145,946 bytes of PNG returned (HTTP 200). ScreenshotOne, key resolving correctly.
  🚨 **Confirmed limitation: Shopify blocks capture persistently, not transiently.** `getsaltydog.com`
  returns **429 after three attempts with backoff**, while `trustedmarketing.com` and `stripe.com`
  capture fine. Retry does **not** solve it. The Approval Card's visual before/after therefore needs a
  **designed fallback for Shopify clients** — and Salty Dog is both the eCommerce flagship and the
  portal pilot. This is a Wave 2 / Stream D design decision, not a config fix.
- ✅ **Stream C · `module/audit-log` — SHIPPED (migration 014).** Append-only audit log enforced by
  trigger (UPDATE and DELETE refused even as service_role, proven against staging), plus the
  `approvals` table carrying the SLA clock, decline reason + 60-day suppression, `requires_role` for
  locked cards, a `failed` status, and a unique idempotency key.

## WO-003 Wave 2 — core PROVEN end to end on a live store (2026-07-28)

**The loop closed for the first time.** A change the platform proposed was approved by a human and
written to a real Shopify store, with a full record:

| | |
|---|---|
| Approval card | `published`, `attempt: 1` — claimed exactly once, so the race protection held |
| Shopify | Both change types verified live on `getsaltydog.com/pages/test-page` |
| Audit log | 4 immutable rows (stage + publish × 2), attributed, with before/after values |
| Change ledger | 2 rows, `verdict: null` — awaiting 28-day measurement |

- ✅ **Stream E-S · `shopifyAdapter`** — stage / publish / revert / preflight. **Staging inverts on
  Shopify:** there is no staging environment for content, so the proposed change lives in
  `approvals.payload` until approved and the store is touched only on yes. Stronger than a staging
  site — no staged state on the client's property to drift or publish by accident.
  `publish()` and `revert()` default to `dryRun: true`.
- ✅ **Stream D · Approval Card + `lib/textDiff.ts`** — word-level diff, hand-rolled and tested for
  exact reassembly. **For content changes the diff IS the evidence**, which sidesteps the Shopify
  screenshot block entirely for this class. SERP truncation warnings (60/155). Punch list #2
  (failed state keeps the card in the queue with the real error), #5 (role-locked cards visible and
  explained), #7 (per-card freshness).
- ✅ **`/api/approvals`** — authorise → **claim atomically** → execute → record → audit. The claim is
  a conditional update only one caller can win, so a double click cannot publish twice.
- ✅ **Stream N · ops diagnostics** — `ga4-check`, `shopify-check`, `screenshot-check`,
  `stage-change`. These caught **four** silent failures in two days: a wrong GA4 property ID, a
  blocked host, a scope change that had not taken effect, and a wrong GraphQL field.

### Two real defects the live test surfaced
1. **Shopify page/article SEO lives in metafields**, not a `seo` field — Products and Collections
   have one, Pages do not. Caught by the read-only probe before any UI was built on it.
2. **`page_title` (the H1) did not exist as a change type**, and the card labelled the SEO title
   ambiguously. A card that changes one field and reads like another is a trap. Both fixed; labels
   now use Shopify's own wording.

### Wave 2 continued — shipped 2026-07-28
- ✅ **Undo / revert (#1).** Two controls, one mechanism; the difference is what
  happens to the *measurement* record, never the audit trail. Undo inside 60 min drops the pending
  ledger row (a change live for four minutes has nothing to say); revert after it writes a **second**
  entry rather than erasing the first. **The window decides, not the button** — a stale page cannot
  be used to skip the ledger entry.
- ✅ **Changes log (#6)** — the receipts, with a *Decided by* column and an **Automatic** filter, so
  alt-text/schema/internal-link changes that ship with no human in the loop are still visible.
  Migration 016. Measurement shows "Measuring, N days left" rather than a verdict the data cannot
  yet support.
- ✅ **SLA escalation (#9)** — notify at 24h, escalate at 48h, wired into the daily cron and
  non-fatal. One message per run, not one per card: a wall of notifications is indistinguishable
  from no notification, which is exactly how the GA4 failure went unseen for six days.
- ✅ **Bulk approve (#8)** — one client, low-risk only, role-checked, enforced **server-side** by
  re-deriving the eligible set rather than trusting form ids. The button renders per client group so
  no cross-client affordance exists. All approve paths now share one `publishOne()`.
- 🐛 **Diff fix found on the first live card:** shared *whitespace* was anchoring the LCS, so an
  unrelated rewrite interleaved into an unreadable mess. Words now match on the word alone. For
  content changes the diff is the entire evidence, and one people cannot read is one they stop
  trusting.

**Punch list: 6 of 10 closed** — #1, #2, #5, #6, #7, #8, #9 *(7 of 10)*.

- ✅ **Stream E-W · WordPress adapter — CONNECTED AND VERIFIED 2026-07-28** on Alpha Zeta Landscapes
  (`alphazetaent.com`, `457cac65…`). REST API + application password on a dedicated `TMAI` **Editor**
  account. `can_write: true`, Rank Math detected, `seo_fields_writable: true`.
  **Both execution adapters are now live**, which covers the whole portfolio: Shopify for eCommerce,
  WordPress for everything else.

  Four things this connection surfaced, all now fixed and in the runbook:
  1. **Over-privileged credential.** The first application password was on the owner's *administrator*
     account — `edit_themes`, `edit_plugins`, `edit_files`, `edit_users`, `manage_options` — for an
     integration that only edits page content. Now a dedicated Editor account (runbook 8b-ii).
  2. **Rank Math meta invisible to REST.** WordPress does not expose arbitrary post meta; Rank Math
     stores its SEO fields as plain meta without registering them. Fixed by
     `wordpress-mu-plugins/tm-growth-os-seo-rest.php`, which ships as a standard onboarding artifact
     because **every TM non-eCommerce build is WordPress** (runbook 8b-iii).
  3. **SEO detection asked one question when there were two.** The first probe reported "no plugin"
     when Rank Math was installed but unexposed — different problems, different fixes. Presence now
     comes from the REST namespace list, writability is probed separately against pages *and* posts.
  4. **Credential rotation was impossible.** `vault_write_secret` only inserted, so replacing an
     existing secret failed on the unique constraint. Migration 017 adds `vault_rotate_secret`.
     Not an edge case: app passwords get regenerated, Meta tokens expire, and a leaked credential
     must be replaceable in seconds.

### Remaining in Wave 2
- **Recommendations engine feeding cards automatically** instead of manual staging. This is the
  difference between a queue you fill by hand and one that arrives full — the thing that makes it a
  product rather than a demo.
- Punch list #3 (slipped playbook items), #4 (client decline round-trip), #10 ("Share this page")
  — all portal-side, Wave 4

## Next (unblocked, not started)
- Scale Shopify + Meta wiring across the remaining clients.
- `recSync`: stop auto-resolving human-**approved** recommendations (flagged bug).
- Search view build (needs the GSC-query × paid-search-term join pipeline).

## Resolved this session (2026-07-27)
- **WO-002 numbering collision** — two documents claimed WO-002. The shipped dashboard reorg keeps the
  number; the two-sided SaaS spec was renamed to `docs/spec-growth-os-two-sided.md` (it is a standing
  spec, not a work order) and is implemented by WO-003.
- **Doc-location conflict** — root `CLAUDE.md` was still the WordPress-theme brief from a different
  project. The monitor operating brief was promoted from `docs/CLAUDE-monitor-draft.md` to root
  `CLAUDE.md`; the WordPress brief is archived at `docs/archive/CLAUDE-wordpress-theme.md`.
  `STATUS.md` + `WORKLOG.md` stay at the **repo root**, now stated explicitly in `CLAUDE.md`.
