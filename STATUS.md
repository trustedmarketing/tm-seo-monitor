# Growth OS — STATUS

_Last updated: 2026-07-27_
_Location note: this file and `WORKLOG.md` live at the **repo root**, not in `docs/`. See `CLAUDE.md`._

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
- Daily cron firing and completing (last verified run 2026-07-27 10:01 UTC, no errors).

## Design deliverables — ✅ DONE
- **Growth OS design export** committed at `docs/design/` — 16 screens across agency + client portal,
  plus ApprovalCard (4 variants × 8 states) and RecCard (5 variants × 6 states). Mapped in
  `docs/design/README.md`.
- **Design review** — `docs/design-review-punch-list.md`. Verdict: approve the direction and build from it.
- **Feasibility review vs current stack** — `docs/feasibility-review-stack.md`. ~60% builds on what's
  running, 25% new-but-ordinary, **15% blocked on approvals never started**.
- **`docs/wo-003-design-implementation.md`** — ✅ **APPROVED 2026-07-27, Wave 1 in progress.** Six
  waves, 12 agent-parallel streams, every punch-list item assigned to a stream.

## Punch list — 10 items, all NOT STARTED
Each is assigned to a WO-003 stream (see that doc); none is unowned.

| # | Item | WO-003 stream |
|---|---|---|
| 1 | Undo (60 min) vs Revert (writes a second ledger entry) | E · `module/wp-adapter` |
| 2 | Failed-job state — publish fails, card stays in queue | D · `module/approval-card` |
| 3 | Slipped playbook items — status chip + reason + owner date | J · `module/portal-shell` |
| 4 | Client decline round-trip back to the agency queue | K · `module/portal-approvals` |
| 5 | Role-aware locked card + Request approval | D · `module/approval-card` |
| 6 | Automatic-changes audit surface (filter in Changes log) | C · `module/audit-log` / I · `module/changes-log` |
| 7 | Per-module data freshness lines | D · `module/approval-card` |
| 8 | Bulk approve never crosses clients | F · `module/approvals-queue` |
| 9 | SLA breach consequence — notify 24h, escalate 48h | F · `module/approvals-queue` |
| 10 | "Share this page" — signed expiring link, or cut from v1 | J · `module/portal-shell` (decision) |

## In flight
- **Bloom (trybloom.ai) — vendor answers received 2026-07-27, RECOMMENDATION: ADOPT FOR SUBSET.**
  Full written answers from Ray (founder), two days ahead of the deadline. Every blocking gate
  cleared: **agency/client/resale use explicitly permitted** (the largest flag — the ToS was silent),
  **no model training** (they run on Google/OpenAI/Anthropic commercial APIs and do not opt into
  sharing), ownership retained, workspace isolation confirmed, **4:5 supported** plus seven more
  ratios, export via API at any time.
  **Two conditions before client data is onboarded:** (1) request the **DPA + subprocessor list** —
  none exist today but Ray offered to put them in place; (2) start **month-to-month at $340/mo**, not
  the annual $3,672, until the fidelity spike is finished.
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
