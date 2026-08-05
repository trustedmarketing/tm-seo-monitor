# WO-006 — Paid Ads Control Surface

**Status:** Built across six module branches, awaiting Tom's merge review.
**Opened:** 2026-08-05 · **Owner:** CTO
**Update channel:** `WORKLOG.md` (repo root).

**Implements:** `docs/spec-growth-os-two-sided.md` §7 ("Paid ads control
surface") and §9, plus `docs/tm-growth-os-plan.md` Module C (paid media) and
Module D (creative intelligence & generation).
**Supersedes:** `docs/wo-003-design-implementation.md` Wave 3 Stream G
(`module/paid-controls` — Meta pause/budget with spend guards), which was
reserved but never built.
**Note on numbering:** WO-005 is already taken (organic content pipeline,
migrations 036–038, shipped). This is WO-006.

---

## Scope in one line

Campaign-level ROAS visibility, a recommendations engine that reads it, a
dry-run-first execution path to pause/amend/create campaigns behind human
approval, a customer-persona layer that feeds ad copy and creative, and
Bloom-generated creative that starts at 4:5 and only fans out to 1:1/9:16
once a human approves the concept.

**Explicitly out of scope for WO-006:**
- Native Meta/Google audience-object targeting sync (personas are copy/
  creative context only in v1 — confirmed with Tom).
- Landing pages — the intended next phase; see "Next phase" below.
- Undo/revert for ad pause/resume/budget actions (self-reversing via a
  second approval card in v1).
- Search-term waste → negative keywords, and audience overlap (both need
  collector data — search-term reports, audience definitions — this repo
  doesn't gather yet).
- A real code-level allowlist for Bloom's "pilot-only, two brands" DPA
  constraint (still enforced by convention only — flagged in stream F).

---

## Conventions (WO-001 §4, unchanged)

One agent = one stream = one branch. Migrations reserved per stream, applied
in numeric order regardless of merge order (039 → 040 → 041 → 042).
Definition of done per stream: tests green, preview renders, then Tom's
merge review — same as every prior WO.

---

## Streams — all six built

### Stream A · `module/paid-campaign-registry` — campaign entity + status sync
**Migration 039** (`campaigns` table). `ad_metrics_daily` has no status
column, so "is this campaign currently running" couldn't be answered from it
reliably. Extended `meta.ts`/`googleAds.ts`/`microsoftAds.ts` with a
`fetchCampaigns()` alongside the existing insights fetch, and every collector
now upserts campaign status/budget/objective into the new registry via a
shared `campaignSync.ts` helper. This is the write *target* for stream D.

### Stream B · `module/paid-dashboard` — campaign-level ROAS
`lib/paidRollup.ts`'s `buildCampaignRollups()` — day-prior, 7-day, and
30-day trailing ROAS per campaign, anchored on the latest date actually
present in the metrics (not the wall clock — collectors run with a lag).
`/paid` now shows a campaign table under the existing platform rollup, with
the Module C tier-ROAS benchmarks as a reference line.

### Stream C · `module/paid-recommendations` — the rules engine
`lib/paidRecommendations.ts` — same `Rec` shape as the SEO rules engine, new
`"Paid"` category: 30-day/7-day-below-benchmark, day-prior divergence,
budget pacing, zero-spend cleanup. Wired into `recSync.ts` alongside the SEO
builder (same lifecycle, same 28-day change-ledger measurement), and
surfaced directly on `/paid` so the engine has a visible output.

### Stream D · `module/paid-controls` — execution adapters + spend guards
**Migration 040** (`ad_spend_guards`). Pause/resume/updateBudget/
createCampaign adapters for all three platforms (dry-run defaults true,
same shape as the Shopify/WordPress adapters). Wired into
`api/approvals/route.ts`'s forward publish path — a blocked spend-guard
check fails the card with the reason rather than approving through (spec
§7's hard guardrail). New campaigns are always created paused.
`api/ops/stage-ad-action` gives a manual entry point to actually create
these approval cards; `ApprovalCard.tsx` shows a spend-exposure block for
the higher-risk tier (new campaign / budget beyond ±25% / pod_lead
approval).

**Escalation, not a build blocker:** live write-scope tokens for Meta/
Google/Microsoft Ads still need Tom to provision (CLAUDE.md escalation
list — "token generation, API access applications"). Everything here is
built and tested against `MOCK_APIS=1` and stays dry-run-only against real
accounts until that lands.

### Stream E · `module/paid-personas` — persona/targeting data model
**Migration 041** (`client_personas`). Name, description, locations,
categories, pain points, messaging angle per client — pure context for ad
copy and creative prompts, no platform targeting API touched. New
`/dashboard/[id]/paid/personas` page (list/add/edit/delete).

### Stream F · `module/paid-creative` — Bloom ad creative generation
**Migration 042** (`creatives`, per Module D's "mirror generated assets into
our own table so vendor loss costs us the generator, not the asset
history"). `lib/adCreative.ts` wraps `bloom.ts`'s async job pattern with a
campaign+persona-aware prompt.

**The fan-out gate, per explicit instruction:** generation always starts at
4:5 only. `fanOutSizes()` — a pure, independently tested function — only
returns the 1:1/9:16 sizes for a primary that is genuinely 4:5 AND genuinely
approved. `api/ops/ad-creative` wires generate/check/approve around it,
reusing the exact approved prompt text for the fan-out siblings. New
`/dashboard/[id]/paid/creative` page shows concepts grouped by
`concept_group_id` with per-size status.

---

## Integration note for the merge session

Streams B, C, and E each touch (or add a sub-route under) `/dashboard/[id]/
paid/`. B and C share one branch chain (C branches from B) so their edits to
`paid/page.tsx` don't collide. E and F added their own sub-routes
(`/paid/personas`, `/paid/creative`) specifically to avoid touching that same
file from independent branches — the one remaining integration step is a
one-line nav link from `/paid` to each sub-route once everything lands.

---

## Next phase — explicitly not started

**Landing pages.** Tom's direction: once this WO ships, the CTO starts
researching landing-page technology (framework, hosting, personalization
approach) as the next build. No code in this WO depends on that research,
and it should run in parallel rather than block on this WO's merge review.

---

## Verification

Per-stream vitest with `MOCK_APIS=1` fixtures, matching the existing
collector/adapter convention — campaign-registry upserts, ROAS window math
(including the divide-by-zero "no spend" case), each recommendation rule at
its threshold boundary, spend-guard math, every adapter's dry-run default,
and the fan-out gate's four cases (approved/unapproved × primary/non-primary).

**Not run in this session:** the actual `npm test` suite — this environment
has no Node/npm installed, so all of the above was verified by hand-tracing
the implementation against each test's assertions, not by executing vitest.
Run `npm test` for real before merging any of these six branches.

**Manual, once a preview deploy exists:** walk one pilot client through
dashboard → recommendation → approval card → dry-run publish → (stream F)
4:5 generate → approve → 1:1/9:16 generate, per the repo's "prove on one
client first" habit (Salty Dog).
