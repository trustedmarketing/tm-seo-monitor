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
- **`docs/wo-003-design-implementation.md`** drafted — build order, agent-parallel streams, punch-list
  items assigned to streams. Awaiting approval; **no implementation started**.

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
- **Bloom (trybloom.ai) evaluation for Module D generation** — `docs/bloom-eval.md`. Deliverables 3/4/5
  drafted; 1 (generation spike) partially done — 6 Salty Dog creatives across 3 sizes, then credits
  exhausted (402). **Preliminary posture: adopt-for-subset**, pending written agency-use/no-training/DPA
  answers from Bloom. **Decision due 2026-07-29 — two days out.**

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
3. ⚠️ **Confirm the Meta system-user token is live.** WORKLOG 2026-07-23 records it as generated and
   vaulted; the feasibility review lists it as not generated. **Reconcile — likely already done.**
4. ✅ **PostFlow API — RESOLVED 2026-07-27. Yes, full REST API.** Verified against their docs +
   `llms.txt`: create/schedule posts, explicit **draft** set/unset, list + retrieve post groups,
   per-post and per-group analytics, media upload, activity logging. The design's "drafts land in
   PostFlow" handoff works as drawn; PostFlow stays the publishing tool. **Module E unblocked on
   this question.** Small follow-up: generate a PostFlow API token from account settings → vault as
   `postflow`. Confirm at build time (does not change scope): rate limits · plan-tier gating ·
   whether post details expose a published permalink.
5. ⛔ **Decide the call-tracking question** (plan §10, decision 0). Blocks portal headline metrics for
   local-service clients. *An eCommerce portal pilot removes this from the critical path entirely.*

Also pending: **choose the portal pilot client** (recommend eCommerce — see WO-003 open questions).

## Next (unblocked, not started)
- WO-003 Wave 1 on approval: Supabase Auth + RLS (hard gate), screenshot service, audit log.
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
