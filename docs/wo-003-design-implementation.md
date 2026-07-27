# WO-003 — Growth OS Design Implementation

**Status:** ✅ APPROVED by Tom 2026-07-27. Wave 1 in progress on `module/auth-rls`.
**Opened:** 2026-07-27 · **Owner:** CTO
**Update channel:** `WORKLOG.md` (repo root).

**Implements:** `docs/spec-growth-os-two-sided.md` (product surface) rendered as
`docs/design/` (UI source of truth).
**Ordered by:** the joint recommendation in `docs/feasibility-review-stack.md` §"the order to do this in".
**Must close:** all 10 items in `docs/design-review-punch-list.md` — each is
assigned to a stream below, none is left to "we'll get to it".

---

## Scope in one line

Turn the approved design into the two-sided product: agency approves with a
yes/no, the system stages/executes/measures, the client sees their program.
Build agency-side first, one client and one change type end to end, then widen.

**Explicitly out of scope for WO-003:** campaign creation, the Bloom creative
loop, LinkedIn, and any GBP or Google Ads panel beyond a "connection pending"
state. Those are Wave 5 and mostly wait on applications we haven't filed.

---

## Conventions (WO-001 §4, unchanged)

- **One agent = one stream = one branch = one worktree.** Branch: `module/<slug>`.
  No agent touches another stream's files.
- **Schema is the shared spine.** Agents *propose* migration files; the CTO merges
  them **in order** before dependent streams start. Migration numbers are reserved
  per stream below so parallel agents never collide.
- **Definition of done per stream:** preview URL renders · tests green ·
  collector/adapter green against staging · CI green · README section → then
  Tom's daily merge review.
- **Accuracy gate applies per module, not per product** (COO): each surface runs
  two full collection cycles parallel-checked against the platform's own UI
  before any client sees it.

---

## Wave 0 — Zero build. Five external actions, all Tom, all calendar time.

**This wave is the critical path and it has not started.** Every item is
approval latency we do not control; none of it goes faster by being started
later. Detail on what each one gates is in the WORKLOG entry for 2026-07-27.

| # | Action | Gates |
|---|---|---|
| 0.1 | Submit **Google Ads** Basic-access developer token (MCC 711-022-5227) | Wave 5 Google panel; full cross-platform MER |
| 0.2 | Submit **GBP** Business Profile Performance API access | Wave 5 GBP module (agency tab + portal screen), both sides |
| 0.3 | Confirm the **Meta system-user token** is live *(WORKLOG 2026-07-23 says generated + vaulted; the feasibility review says not generated — reconcile)* | Wave 3 Stream G |
| 0.4 | Get a **yes/no on the PostFlow API** | Module E / Social, both the workspace tab and the portal screen |
| 0.5 | Decide the **call-tracking question** (plan §10 decision 0) | Wave 4 portal headline metrics **for local-service clients only** |

> **Pilot-choice lever.** If the portal pilot client is **eCommerce** (Salty Dog —
> Shopify revenue is ground truth today), Wave 4 is **not** gated by 0.5 at all.
> Choosing a local-service pilot puts the entire portal wave behind a decision
> that hasn't been made. Recommend eCommerce pilot.

---

## Wave 1 — Infrastructure prerequisites (the design rests on these)

Runs in parallel. **Stream A is a hard gate on Wave 4 and on anything
client-facing, anywhere.**

### Stream A · `module/auth-rls` — Supabase Auth + per-client RLS ⛔ HARD GATE
Reserved migration: **012**
- `organization → clients → users` schema now, even with one org, so a future
  white-label isn't a migration of everything.
- Per-user accounts; agency users see all clients, client users see exactly one.
- RLS policies on **every** table currently read by the app. Touches every query.
- Est. ~1 week. Nothing client-facing merges before this lands. It cannot be
  retrofitted after client access exists.

### Stream B · `module/screenshots` — before/after screenshot service
- Playwright on a job runner, or Browserless/ScreenshotOne. Decide vendor vs
  self-host in the stream; both are acceptable, cost is small either way.
- Capture-on-stage + capture-on-publish, stored against the change ledger entry.
- Est. 2–3 days. **Every site-change Approval Card depends on this** — "the work
  is already done before you see it" is a visual claim.

### Stream C · `module/audit-log` — audit log, approvals table, realtime
Reserved migration: **013**
- Immutable row per approve/decline/publish/pause: actor, action, target,
  before/after, timestamp, IP.
- `approvals` table + Supabase Realtime so two people never work the same card.
- Idempotency keys on every write path: approving twice must not publish twice.
- **Punch list #6** — the `automatic` flag lives here, so alt-text/schema/internal-link
  changes that ship with no human in the loop are still recorded.

---

## Wave 2 — The Approval Card, and one change type end to end

The feasibility review's step 3: agency side, one client, one change type, whole
path. WP staging → approval card → publish → ledger → measurement.

### Stream D · `module/approval-card` — the component
Depends on: B (screenshots), C (states/flags). Front-end.
- 4 variants (`site` · `ad` · `creative` · `content`) × the full state set from
  `docs/design/ApprovalCard.dc.html`, plus `warm` copy mode for client-facing.
- **Punch list #2 — failed-job state.** The design has running → steps → done and
  no fourth outcome. Design and build it: real error text, a Retry, and the card
  **stays in the queue** rather than silently disappearing.
- **Punch list #5 — role-aware locked state.** Card above your role renders
  visible + explained ("Pod lead approval required") + one-click *Request approval*.
- **Punch list #7 — per-module freshness line.** Each card and module carries its
  own freshness ("Search Console lands 48 hours behind"). Paid is near-real-time,
  GBP lags ~3 days. Without this, clients compare to platform UIs and find
  mismatches — which is the accuracy gate failing in public.

### Stream E · `module/wp-adapter` — WP Engine staging → publish → ledger
Depends on: B, C.
- WP Engine staging environment as the staging target; WP REST API + application
  passwords for content/meta changes. **Not LocalWP** (spec §5 CTO correction).
- Dry-run mode mandatory before any live property (autonomy ladder #2).
- **Punch list #1 — undo vs revert.** Undo is available **60 minutes** and
  reverses cleanly. After that the control becomes **Revert**, which writes a
  *second* change-ledger entry rather than erasing the first. A change that ran
  three days then got reverted is data — measurement depends on not hiding it.
- Ships with a tested rollback path or the change type stays staging-only.

### Stream F · `module/approvals-queue` — the queue screen
Depends on: C, D.
- Filters (client / type / severity / age), the earned empty state, median
  decision time instrumentation (COO wants this from day one).
- **Punch list #8 — bulk approve never crosses clients.** "Approve all 3" stays
  scoped to low-risk types *and* to a single client without explicit per-client
  selection. Client-isolation rule.
- **Punch list #9 — SLA breach has a consequence.** Notify pod lead at 24h,
  escalate into the attention view at 48h. Stale styling alone is decoration.

---

## Wave 3 — Paid controls + delivery integration

### Stream G · `module/paid-controls` — Meta pause/budget with spend guards
Depends on: C, D. **Gated by Wave 0.3.**
- Low-risk single approval: pause/resume, budget within ±25% band.
- Higher-risk: the second-yes modal showing **daily and monthly** exposure before
  anything spends.
- Spend-guard layer: per-client daily/monthly ceilings in the DB; anything that
  could exceed them is **blocked and escalated, not approved-through**.
- No agent performs a paid write autonomously in v1.
- Frequency ceilings (3.0 prospecting / 5.0 retargeting) become **per-client
  settings**, not hard-coded copy (punch-list smaller note).

### Stream H · `module/clickup-roundtrip` — approved rec → task → shipped
- Collector-side ClickUp sync already ships; this closes the loop so the pods'
  actual tool reflects approvals and completion flows back to the ledger.

### Stream I · `module/changes-log` — receipts
Depends on: C.
- *Decided by* column, verdicts, 28-day measurement, **Automatic filter**
  (punch list #6) so nothing the system does alone is invisible to team or client.

---

## Wave 4 — Client portal v1, one pilot client

⛔ **Blocked until Stream A merges.** Limited to modules with verified data —
Home, Playbook, Organic, Results. No GBP, no LinkedIn, no Google rows.

### Stream J · `module/portal-shell` — auth'd shell, Home, Playbook
- Home answers "is this working?" in a sentence, above the fold.
- **Punch list #3 — slipped playbook items.** Status chip + one-line reason +
  owner-set date. A silently incomplete bar is worse than "moved to August —
  waiting on photos from you." Dates are set by the pod, never auto-generated.
- **Punch list #10 — "Share this page" is a security decision.** Either it
  produces a **signed, expiring link**, or it comes out of v1. Decide at stream
  kickoff, not at build time.
- Headline metrics honor the Wave 0.5 call-tracking decision. eCommerce pilot ⇒
  unblocked today.

### Stream K · `module/portal-approvals` — the client's own queue
Depends on: D, J.
- **Punch list #4 — client decline round-trip.** A client declining a blog topic
  or ad photo must land agency-side: the rec reopens with the client's reason
  attached, **visibly distinct** from an internal decline.
- `warm` copy mode throughout; no jargon, no negative number without context.

### Stream L · `module/portal-organic` — Organic + Results
Depends on: J.
- Conversion-relevant rankings only. Blog concepts as approve/decline/comment.
- **Resolve the orphaned `results` screen** — it exists in the design's `header()`
  map but is in no nav. Either it becomes a nav item or it folds into Organic.

---

## Wave 5 — Last, highest risk, longest lead time

Campaign creation · Bloom creative loop (pending the adopt/pass decision due
2026-07-29) · LinkedIn · GBP module · Google Ads panels.

Until their applications clear, all four render as **"connection pending"**
states. Per the feasibility review: *mark them pending rather than populated, so
nobody demos a screen we can't fill.* The design already handles honest states
well — apply that discipline to unavailable integrations.

**GBP stream scoping note** *(verified 2026-07-27, see plan §0):* the access
request is **one-time per GCP project, not per client** — approval covers all
eight Business Profile APIs including Performance, and per client it reduces to a
Manager invite in the onboarding runbook (Appendix A step 5b). This is smaller
than the original estimate. ⚠️ But budget for **separate auth plumbing**: GBP uses
OAuth with the `business.manage` scope and the manager pattern implies user
credentials, whereas GSC/GA4 use a service account. Confirm whether GBP supports
service accounts before the stream is scoped — if not, it needs its own OAuth
flow and token refresh, which is a day or two the current estimate doesn't carry.

---

## Cross-cutting, every stream

- **Sample data:** standardize on obviously-fictional client names before anything
  is demoed. The export currently mixes invented and plausible-real names.
- **"Run scan now"** triggers a paid crawl — rate-limit per client per day.
- **Multi-model AEO:** we check ChatGPT only; the design tells clients we check
  Gemini and AI Overviews too. Verify DataForSEO coverage before that copy ships
  client-facing. Accuracy-gate item, not a copy detail.
- **Recommendation quality:** new rule types start in **shadow** state visible
  only to the pod lead until they earn a decent approval rate. A yes/no UI is
  only as good as what's behind the button.

---

## Open questions for Tom before this is scheduled

1. ✅ **Portal pilot client → SALTY DOG** (decided 2026-07-27). eCommerce, so Wave 4
   is not gated by the call-tracking decision. Wave 4 Stream J builds its headline
   as Revenue · Spend · MER · Orders, not the design's Calls / Cost-per-job row —
   **that row is the local-service variant and is deferred, not cancelled.**
2. **Punch list #10** — signed expiring link, or cut "Share this page" from v1?
3. ✅ **Screenshot service → vendor** (Browserless or ScreenshotOne) for v1, CTO call
   2026-07-27. Self-hosting Playwright means owning browser infrastructure for a
   few dollars a month of saving. Revisit only if per-shot cost becomes material.
4. **Portal entitlement** — Dominate + Momentum only? (ties to the open pricing decision)
5. **Individual client logins vs one shared per account** — individual is better
   audit, more support burden.
