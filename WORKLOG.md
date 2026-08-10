# WORKLOG — Growth OS

Update channel for all work orders on `tm-seo-monitor`. Newest entries on top.
Lives at the **repo root** alongside `STATUS.md` (see `CLAUDE.md`).

---

## 2026-08-10 · Session 5 · Automated accuracy alerts — revenue reconciliation + data staleness

Tom, after the Overview-page revenue bug: "this just needs to work seamlessly.
If this isn't working or numbers are not updating or what is Shopify is
different than what is on the system you need to send me an alert of some
kind." Nobody should have to spot a wrong number by eye against Shopify's own
dashboard — that's what caught the last bug, and it took a week.

Two distinct failure modes, so two checks (autonomy #3, accuracy gate):

**1. `lib/revenueReconciliation.ts` — the number is WRONG.** After the Shopify
collector runs, independently re-fetches from Shopify via the same
`fetchDailySales()` client and compares that sum against what is currently
STORED in `conversions_daily`. Deliberately fresh-vs-stored, not
fresh-vs-just-written: comparing a fetch against rows written from that same
fetch only ever catches a write failure. This shape exercises collector write
AND downstream read together, which is the only way it would have caught the
Overview page's unbounded-date-window bug — a read-side bug no write-time
check could see. Tolerance is two-gated (>2% AND >$25) so small accounts don't
page on rounding and large ones don't hide a real gap under a small
percentage. Wrapped in `tracked()`, module `shopify_reconciliation`.

Subtlety worth keeping: it compares exactly the dates Shopify itself returned
rather than a separately-computed wall-clock window. A first draft used its
own 30-day window and a test immediately caught it disagreeing with the
client's window — which would have paged Tom about a discrepancy that wasn't
real. The check must not commit the bug class it exists to catch.

**2. `lib/dataFreshness.ts` — the number STOPPED.** A frozen dashboard looks
identical to a calm one: no error, no red, just a figure that stopped moving.
`findStaleData()` flags any client whose freshest `conversions_daily(shopify)`
or `ad_metrics_daily` row is more than 3 days old. Only flags a source that
has reported before — a client with no Shopify store isn't stale, it's
unconfigured, and alerting on that daily is how a failure list gets ignored.
This finally wires up `alertOnStaleness()`, which had been dead code in
`lib/slack.ts` since it was written.

**Delivery — `lib/accuracyAlerts.ts`.** Both alerts go through `notify()`
(Slack AND email via Resend, attempted independently) rather than `slackAlert()`
directly, unlike the collector-failure alerts. Those are ops noise for whoever
watches the channel; these are the ones Tom personally needs to see, and betting
them on a single webhook being configured is how an alert system quietly isn't
one. Setting `RESEND_API_KEY` + `ALERT_EMAIL_TO` turns email on with no code
change. There's a test asserting the email goes out with Slack deliberately
unconfigured. Lives in its own module because `notify.ts` imports `slack.ts` —
calling notify() from inside slack.ts would be circular.

Removed the Slack-only `alertOnStaleness()` from `lib/slack.ts` while doing
this: nothing ever called it, and leaving a second staleness alerter that
skips email is a trap for whoever wires it up next.

One batched message per check (matching `alertOnFailures`), both non-fatal — a
monitoring check that can sink the collection it rides on is worse than no
check. Cron response now reports `revenue_mismatches` and `stale_sources`
alongside `failures`.

Verified: 493 tests passing (was 477), `tsc --noEmit` clean.

**`api/ops/alert-check` — verifying the alerting itself.** These alerts only
fire when something is wrong, so the first time anyone would discover the
channel was misconfigured is the moment they needed it and it stayed silent.
Owner-only endpoint: bare GET reports which channels are configured (presence
booleans only, never values); `?send=1` actually delivers a test alert so
"configured" becomes "I watched it arrive". Reports `resend_key_present` and
`alert_email_to_present` separately because `notify()` gates email on BOTH —
a Resend key with no recipient sends nothing, silently, which is the likeliest
way this ends up half-configured. Also corrects for `notify()` returning
`slack: true` even when unconfigured (slackAlert no-ops rather than throwing),
so the endpoint can't hand back a false positive.

**Slack routing note:** `SLACK_WEBHOOK_URL` is a single global env var and
every existing Slack alert (collector failures, critical QC issues, token
expiry, SLA breaches) is internal ops. It must point at an INTERNAL channel,
never one of the per-client channels — a client-channel webhook would receive
every other client's revenue and spend figures, plus alerts stating our own
numbers are wrong. Flagged to Tom; he confirmed and configured an internal one.

**Alerting verified end-to-end (PRs #29, #30).** Tom ran
`api/ops/alert-check?send=1`: Slack arrived, email didn't. `notify()` gave no
way to diagnose it — every email failure collapsed to `email: false` with
Resend's response body discarded, so an unverified domain, test-mode's
recipient restriction, and a bad key were indistinguishable. Added
`emailError` (missing env var name, or Resend's real HTTP status + message)
and a `notify.test.ts`, which did not exist despite notify() being the
delivery path for every alert in the system.

Root cause was `ALERT_EMAIL_FROM`. It has a default
(`Growth OS <onboarding@resend.dev>`) so it reads as optional — but Resend
only permits that shared sender to deliver to the account owner's own address,
so it works in a first test and fails for every other recipient. A default
that works just often enough to look correct. Now documented in the README
with the full env var table, and `alert-check` returns an
`email_from_warning` when it's unset.

**Dead-man's switch — `lib/heartbeat.ts` (PR #32).** The gap the two checks
above could never close: they fire from INSIDE the cron, so a cron that never
runs produces silence, and silence is indistinguishable from health. We cannot
detect our own absence; an external service watching for a scheduled ping can.
`pingHeartbeat()` GETs `HEARTBEAT_URL` as the LAST thing the run does — so the
ping means "got all the way to the end", and a run that dies partway never
reports health. Provider-agnostic, no-op when unset, never throws, 10s timeout
(the cron is already near Vercel's 300s ceiling by then). Reports "not
configured" rather than ok when unset, so the response can't claim the switch
is armed when it isn't.

### Verified end-to-end, 2026-08-10

Slack ✅ · Email ✅ · both confirmed by `api/ops/alert-check?send=1` landing in
the real channel and the real inbox — not merely "configured".

Getting email working took three separate misconfigurations, each invisible
until the diagnostic named it, which is the whole argument for having built
`alert-check` rather than trusting the env vars:

1. `ALERT_EMAIL_FROM` unset → Resend's default shared sender only delivers to
   the account owner's own address.
2. `ALERT_EMAIL_TO` unset → `notify()` gates email on BOTH vars, so a Resend
   key alone looks configured and sends nothing, silently.
3. `send.trustedmarketing.com` not verified in Resend → HTTP 403.

None of these would have surfaced on their own. All three would have been
discovered the first time a real revenue mismatch needed reporting and didn't
arrive.

**Still open, needs Tom (escalation list — external account):** `HEARTBEAT_URL`
is not set, so the dead-man's switch is inert. healthchecks.io (free) → new
check on a daily schedule with a few hours' grace → copy ping URL → add
`HEARTBEAT_URL` in Vercel → redeploy. Until then the cron response reports
`"heartbeat": "not configured"`.

---

## 2026-08-10 · Session 4 · WO-006 merged to main — all ten PRs, migrations run on both environments

Tom: "we need to get this launched and clients in the system so we can start
testing everything." This session was entirely that.

### Migrations, staging then production
Walked Tom through migrations 039–043 one file at a time (a combined paste
hit a syntax error in Supabase's SQL editor — five separate small runs
sidestepped it and made any failure trivial to isolate). Ran clean on
`tm-growth-staging`, then again on production, confirmed with a direct
`information_schema.tables`/`information_schema.columns` check rather than
trusting "I already did all of them" at face value — all 5 tables present,
`creatives.approval_id` column present, on the actual production database.

### Merged all ten PRs (#15–#24) into `main`, in dependency order
A, B, D, E (independent) → C, F (needed B, E) → G (needed F) → H (needed G
and D) → I (needed C and H) → docs. Two PRs (#23, #24) showed CONFLICTING
after their base was retargeted to `main`, despite a local `git merge`
against the exact same commits going through clean — GitHub's mergeability
cache was stale. Fix: checked out each branch, merged `origin/main` into it
locally (clean both times), pushed that merge commit back, then GitHub's
check flipped to MERGEABLE and the PR merge went through. Worth remembering
if this happens again — don't trust the "CONFLICTING" label without a local
test merge to confirm it's real.

Verified on the ACTUAL merged `main` (not a scratch branch this time):
`npm test` 455/455, `tsc --noEmit` clean. All nine now-merged module
branches deleted locally; remote branches left in place.

### Confirmed the other concurrent session came through fine
`module/daily-brief` (a different feature, unrelated to WO-006) now has its
own PR (#25, open) — confirms the stash-and-restore handling of its
uncommitted work from session 3 landed correctly and nothing was lost.

### What's still open
Write-scope OAuth tokens for live Meta/Google/Microsoft Ads writes — Tom-only,
same escalation as always. Testing plan is Salty Dog only for now; next
daily cron (10:00 UTC) or a manual hit to `/api/cron/collect` populates its
`campaigns` table for the first time.

---

## 2026-08-06 · Session 3 · The forms — stream I, WO-006's ninth branch

Everything through stream H worked, but only by typing an API URL into a
browser. Tom said keep going; the flagged gap was the obvious next pick.

### Shipped (PR #24)
**`module/paid-ui-actions`** — a "New test campaign" form and per-campaign
Pause/Resume + budget-change controls on `/paid`; "Generate creative" and
"Generate copy" forms on `/paid/creative`, replacing the placeholder
instructional text left in streams F and H. New `api/ops/ad-copy` route
for on-demand copy generation against a campaign that already exists (the
`create_campaign` bundle only covers brand-new ones). `lib/personaContext.ts`
lets a persona `<select>` resolve into the brief fields the generation
functions expect, so a form needs one picker, not separately-typed name/
angle/pain-point text — wired into all three generate paths (`ad-creative`,
the new `ad-copy`, and `stage-ad-action`).

Branches off H, merges in B+C (`module/paid-recommendations`) since the new
forms attach to the campaign table that stream builds.

### Verified
All nine module branches + docs merged together locally (never pushed
merged): `npm test` 455/455, `tsc --noEmit` clean. Scratch merge branch
deleted after.

---

## 2026-08-06 · Session 2 · Ad copy generation + previews, and tests actually ran this time

Tom's follow-up on WO-006: campaigns need the actual TEXT assets each
platform requires (Google RSA headlines/descriptions, PMax's larger set,
Meta primary text/headline/description, Microsoft's RSA equivalent) and a
way to preview how they'll render — "a total turnkey solution," not just
budget + an image.

### Verified limits before writing any code
Web search, not memory, since these change and getting them wrong ships a
broken tool: **Google RSA** 3-15 headlines (30 chars) / 2-4 descriptions
(90 chars). **Google PMax** adds 1-5 long headlines (90 chars) + business
name (25 chars). **Microsoft RSA** mirrors Google's. **Meta feed** is 1-5
primary texts (125 chars) / 1-5 headlines (40 chars) / 1-5 descriptions
(30 chars).

### Shipped, two more module branches (PRs #22, #23)
- **`module/paid-ad-copy`** (migration 043, `ad_copy_sets`) — `lib/adCopy.ts`
  reuses `lib/ai.ts`'s `generate()` (the same Claude wrapper social captions
  already use). Two gotchas discovered and designed around: the
  structured-output schema can't carry length/count constraints (the API
  rejects them outright — they live in the prompt and in post-processing
  instead, same as `lib/caption.ts` already does), and `generate()`'s own
  mock branch returns a caption-shaped fixture regardless of `feature` (new
  code checks `mockApis()` itself first). Over-limit copy is flagged, never
  truncated.
- **`module/paid-ad-previews`** — three preview components (Google/Microsoft
  search, PMax, Meta feed), wired into `/paid/creative`. The actual turnkey
  piece: staging a new campaign now generates a 4:5 creative AND a matching
  copy set together, tagged with the approval id until the real campaign
  exists, then backfilled on approval.

### The other thing that actually changed this session: tests ran for real
Earlier in this WO, every test was hand-traced because this machine had no
Node/npm. This session: installed Node via Homebrew (it was already
`brew`-installed but not linked to PATH — used the direct
`/opt/homebrew/opt/node/bin` path rather than fighting `brew link`), ran
`npm install`, and actually executed the suite. **All eight WO-006 branches
merged together locally and verified as one unit: `npm test` 455/455,
`tsc --noEmit` clean.** The merges were conflict-free, which is real
confirmation the streams are as independent as the WO doc claims — not
just an assertion. Scratch merge branch deleted after verification; nothing
merged was ever pushed.

### Also produced this session, for Tom to actually see the UI
Chrome's browser-automation tools refused to navigate to `localhost` (looks
like a deliberate security restriction, not a bug) — worked around it by
taking the real server-rendered HTML/CSS from `/paid`, `/paid/personas`,
and `/paid/creative` under a `DEMO_MODE=1` flag (temporarily stubbed
`userClient()`/`middleware.ts`, never committed, fully reverted) seeded
with realistic fake data, and packaging it as a local preview artifact.
Confirms the pages actually render, not just that they typecheck.

---

## 2026-08-05 · Session 1 · Paid ads control surface built end to end — WO-006, six branches

Tom asked for: campaign-level ROAS on `/paid` (day-prior/7-day/30-day),
recommendations + a pause/amend/create-campaign execution path, Bloom
creative for ads (4:5 first, fan out to 1:1/9:16 only after approval), and a
customer-persona layer. `docs/wo-006-paid-ads-control-surface.md` has the
full writeup; summary here.

**This isn't from scratch.** `docs/spec-growth-os-two-sided.md` §7/§9 and
`docs/tm-growth-os-plan.md` Module C/D already scoped almost exactly this —
approval tiers, a spend-guard hard guardrail, paused-by-default staging, and
the Bloom→ads creative loop. WO-006 **supersedes** `wo-003`'s Wave 3 Stream G
(`module/paid-controls`), which was reserved but never built. Named WO-006
because WO-005 is already taken (organic content, shipped).

### Shipped, six module branches, not yet merged
- **`module/paid-campaign-registry`** (migration 039) — `campaigns` entity
  registry with real status/budget, synced by each collector.
- **`module/paid-dashboard`** — campaign ROAS table on `/paid`
  (`lib/paidRollup.ts`), anchored on the latest date actually in the data.
- **`module/paid-recommendations`** — `lib/paidRecommendations.ts`, a new
  `"Paid"` category in the existing recs lifecycle, surfaced on `/paid`.
- **`module/paid-controls`** (migration 040) — pause/resume/updateBudget/
  createCampaign adapters for all three platforms, wired into
  `api/approvals/route.ts`'s publish path with a spend-guard check that
  fails the card rather than approving through a ceiling breach.
- **`module/paid-personas`** (migration 041) — `client_personas` + a new
  `/paid/personas` page. Copy/creative context only, no platform targeting
  API touched, per Tom's confirmed scope.
- **`module/paid-creative`** (migration 042) — `creatives` library +
  `lib/adCreative.ts`. The fan-out gate (`fanOutSizes()`) is the one piece
  worth reading closely: 1:1/9:16 are only ever generated for an approved
  4:5, never as a default.

### Escalation for Tom, not a blocker
Live pause/amend against real Meta/Google/Microsoft ad accounts needs
write-scope tokens — today's `auth_ref` credentials are read-only. Per
CLAUDE.md's escalation list, provisioning those is a Tom-only step. Every
adapter is built and tested against `MOCK_APIS=1` and stays dry-run-only
against real accounts until that lands.

### Honest gap
**Could not run `npm test`** — this environment has no Node/npm installed.
Every test file was hand-traced against the implementation instead of
executed. Run the real suite before merging any of these six branches.

### Next phase, explicitly not started
Landing pages. Tom's direction: CTO starts researching landing-page
technology now, in parallel — nothing in WO-006 blocks on it or depends on it.

---

## 2026-08-03 · Session 1 · Onboarding a client was broken — `module/client-onboarding`

Started as "add Emporium Threads", found that **no client could be added at all**.

### The blocker
`/admin` → Add client returned `null value in column "organization_id" of relation
"clients" violates not-null constraint`. Migration 012 added `organization_id`,
backfilled the rows that existed and set NOT NULL; `upsert_client` never set it.
Salty Dog and DAPS predate 012, so the first person to hit it was the first
person to onboard a client after 2026-07-27.

Fixed by resolving the organization at insert: one organization is unambiguous,
more than one must be passed explicitly. Attaching a client to the wrong agency
is not a mistake RLS lets you see afterwards.

### Three more the same path was getting wrong
- **Lost update.** `upsert_client` rebuilt the entire row from the page's copy of
  the client, so changing a collection frequency in `/admin` rewrote tier, GSC
  property and location code — reverting whatever Settings had changed in another
  tab. Updates are partial now and the page sends only what changed.
- **`location_code` had no UI anywhere** and defaulted to 2840, the whole US.
  For a local client that tracks national rankings for a business competing in
  one metro, and it looks plausible either way. Now a field, with `service_areas`
  alongside it — also previously SQL-only.
- **`client_type` could only be set after creation**, so every client started
  unclassified. On the create form now; unclassified clients are badged in the
  list, which is the condition migration 013 attached to its null default.

GA4 property IDs are validated by class — measurement ID, GTM container and UA
property each named rather than a generic "invalid". A wrong value in that exact
field failed daily for six days and GA4's error never named the property.

### Corrected the record
An earlier read of this session claimed `client_type` and `ga4_property_id` were
SQL-only. They are not — `/dashboard/[id]/settings` has covered both, plus the
Shopify and WordPress connections, since WO-003. The gap was only that Settings
edits a client that already exists, and `/admin` is the only thing that creates one.

### Verified
`lib/clientProfile.ts` (21 tests) · 378/378 unit · tsc clean · build clean ·
end to end against staging: create, partial update, both rejection paths. Probe
row deleted.

### Next
Emporium Threads still not added — needs this branch merged (main auto-deploys),
then Appendix A steps 1–7. Outstanding from Tom: client type, store platform,
GA4 property ID, keyword list, AI prompts.

---

## 2026-07-29 · Session 1 · Design port finished, work parked, Organic started — `main`

### Shipped
- **Portfolio + sidebar ported to the design export** (`bf57455`). `PageHeader.tsx`
  now carries the pattern every screen shares — eyebrow, display-serif title,
  subtitle — plus `AttentionRail`. Portfolio moved from stacked scorecards to the
  design's table, which is why the design uses a table: the stack does not survive
  13 clients. Kept Revenue/MER/Ad spend columns rather than reducing to the
  export's four, since the export predates that data existing.

### Two bugs found while porting
- **The sidebar's active state never moved.** `active` was hardcoded to
  `"/dashboard"` in the layout, so Portfolio stayed highlighted on every page.
  Now read from `usePathname`.
- **A badge that would have read zero forever.** Wiring the nav counts, the first
  attempt counted `qc_scans.status = 'failed'`. There is no `status` column on
  `qc_scans` — the verdict lives in the `checks` jsonb. PostgREST would have
  errored, the count would have come back null, and the badge would have rendered
  a confident 0 indefinitely. Computed through `classifyChecks` instead.
  Same failure mode as the seven vendor-envelope bugs on 07-28: writing the shape
  I expected rather than reading the shape that exists.

### Corrected the record
`STATUS.md`'s punch-list table claimed **all 10 items NOT STARTED** and had said so
since 2026-07-27. Verified against `src/` — items **1, 2, 5, 7 and 9 are built**
(`ApprovalCard.tsx`, `lib/slaEscalation.ts`), #4 is half-built by WO-004's PostFlow
decline handling. The table now carries a verified status column. A status file
that overstates open work is as misleading as one that understates it.

Stream M's specced attention-rail double-count was also already fixed.

### Parked, in priority order
New **"Parked"** section in `STATUS.md` with enough detail to resume cold:
1. **Verify the social pipeline against real data** — campaign date windows,
   decline round-trip, cross-month dedup. All shipped, none observed working.
   The only client-visible risk currently live.
2. **Wave 4 — Salty Dog portal.** No client-facing surface exists yet.
3. **Finish the token conversion** — `PlanSlot`, `ClientHeader`, tab bar, queue.
4. **Google Ads Basic access — still not submitted** (Tom). Explorer token vaulted
   since 07-22, collector built and wired. Pure calendar time not being burned.

### Shipped — WO-005 Organic (migration 036)
- **`gsc_query_windows`.** The blocker behind the whole Organic screen was that
  `gsc_history` stores one aggregate row per day: we knew a client got 9,420
  clicks and nothing about which searches produced them. Now stores GSC query and
  query×page performance over a rolling 28-day window, top 250 by impressions.
- **`content_items`.** The pipeline, idea through published, carrying the
  rationale AND the prediction. Recording what we expected before the outcome is
  known is the only way the verdict later means anything.
- **`lib/contentIdeas.ts`.** Ranked recommendations with evidence: striking
  distance, content gap, question, rising demand, cannibalisation. No impact
  number ships without a stated basis, and a query we cannot measure gets no
  estimate rather than a plausible guess. 22 tests.
- **Organic tab** — recommendation cards, pipeline rail, "Collect now" button,
  **keyword movement table** and the **four stat tiles**. Screen complete.
- **`lib/keywordMovement.ts`** — was/now/delta/trend between windows. 12 tests.

**Two headings deliberately differ from the design**, both because its version
claims something we cannot measure. "Conversion keyword" is "Keyword movement":
conversions are recorded per source platform, not per keyword, and GSC does not
attribute conversions at all. "Calls from organic" derives from `client_type` and
is blank either way — for local_service it is the call-tracking blocker, for
eCommerce summing `conversions_daily` would credit paid, email and direct revenue
to SEO. Both variants name what is missing rather than showing a zero.

**Caught before shipping:** PostgREST cannot name an expression index in
`onConflict`, so the `coalesce(page,'')` unique index would have forced every
write into a delete-then-insert. `page` is now NOT NULL with an `''` sentinel.
The two places `''`/`null` meet are marked and tested both directions — `?? null`
does not catch empty string, and getting it wrong would have made every rollup
row look like a page and broken cannibalisation detection silently.

### ⚠️ Branch finding — two days of work was not on main
Discovered on the first push today: the working tree was on
**`module/qc-crawl-reliability`**, not `main`, and had been for both sessions.
Every WO-004 social commit, the design port and all of WO-005 were on that
branch. Local `main` was 27 behind; remote `main` was at `58fd024`.

The branch was **local-only** (never pushed), so nothing of anyone else's was
entangled and nothing was lost. `origin/main` was a direct ancestor of the branch
tip, so recovery was a plain fast-forward — `git push origin HEAD:main` — with no
history rewritten. Local `main` fast-forwarded to match, and the branch's other
contents (the QC session's `onPageTask.test.ts`) came with it.

Also cleared: a corrupt ref file `.git/refs/remotes/origin/main 2` — a
sync-artifact duplicate, verified to be an ancestor of HEAD before deleting —
which was making `git fetch` fail with "did not send all necessary objects" and
producing a misleading "branch is behind" message on every push.

**Standing fix:** check `git branch --show-current` before the first commit of a
session, not after the first failed push.

### Next
Salty Dog and DAPS both have Search Console properties. The Organic tab has a
**Collect now** button; nothing renders until it is pressed or the daily cron
runs. Local dev has no `GOOGLE_SERVICE_ACCOUNT_JSON`, so the collector is proven
against fixtures only — first real run is the verification.

---

## 2026-07-28 · Session 3 · WO-004 social content planner — `main`

Built the month planner end to end: **build a month → decide slot by slot → write copy →
generate artwork → send to PostFlow**. Proven live on Salty Dog and DAPS, including a
six-slide Instagram carousel.

### Shipped
- **Planner** (migrations 023–024, 030, 033–034). Sources in priority order: campaign brief,
  proven posts, tracked customer questions, live Shopify catalogue, evergreen. Dealt
  proportionally, not exhausted in order. Every slot badged with its provenance on screen.
- **Campaign briefs.** Free-text per month, parsed for dates — "from the 8th to the 15th",
  "on the 14th" — and those slots re-dated inside the window. The plan shows what it parsed,
  because a date read wrongly is worse than one not read.
- **Copy.** Playbook rules per network reach the writer, standing hashtags enforced in code,
  a 2–4 word headline for the artwork, month context on every caption.
- **Artwork.** Bloom generation, async with self-collecting refresh. Aspect ratio per
  network/format, actually sent rather than only displayed.
- **Carousels.** Slides with their own headline, body and *shot*; treatment chosen per
  carousel (informational vs photographic); per-slide regeneration; gaps block the send.
- **Decline detection** (migration 031). PostFlow has no webhooks, so it polls. Alerts carry
  the client's reason, and the card becomes editable again.
- **Agency credentials page** and `notify()` (Slack now, email on `RESEND_API_KEY`).

### Two patterns worth carrying forward
1. **Seven vendor-response failures, all one root cause** — writing the shape I expected
   rather than reading the one that arrives. Fixed properly by `lib/apiShape.ts` plus the rule
   that an unrecognised envelope must report the raw payload, never "empty". Reading
   PostFlow's OpenAPI spec took two minutes and settled what four guesses could not.
2. **Four dead ends shipped** — states with no action available. Stuck generation, slide-less
   carousel, slides without a URL field, slides stuck mid-generation. Every state a row can
   reach needs at least one way out, and *"mid-operation"* is a state.

### Still open
- **Untested:** campaign dates landing correctly, the decline flow end to end, cross-month dedup.
- **Config:** `social_posts_per_month` and `hashtag_core` unset on all three clients — both
  change output. Alpha Zeta has no Bloom brand (correct while the pilot is two brands).
- **Not built:** UGC reposting (needs Meta Graph `tags` edge, and a rights-permission step),
  Higgsfield for video slots, Playbook tab.
- **Known limit:** signed Bloom URLs expire in ~7 days, so old plans will show broken
  thumbnails. Sent posts are safe — PostFlow keeps its own copy.

---

## 2026-07-28 · Session 2 · QC crawl reliability — branch `module/qc-crawl-reliability`

Raised by Tom: manual QC scans run that morning and the findings never appeared in the panel.
Diagnosed against production; nothing was broken in the way it looked, but three real defects
sat underneath it.

### What was actually happening
- The two crawls queued 12:49 ET (Salty Dog, Alpha Zeta) were still holding `onpage_task_id`.
  Findings only land when something *collects* a finished crawl: the "Check for results" button,
  or the daily cron. The cron had already run at 06:01 ET, hours before the scans were queued,
  so the next automatic pickup was the following morning. Working as built, not as expected.
- **`qc_scans` had zero rows, for any client, ever.** The one crawl on record (Salty Dog, 7/23,
  `site_health=92.5`) predates the code that writes the table — its `collector_runs` detail lacks
  the `· N check types flagged` suffix the current code appends. The findings path had never
  executed in production. Untested there, not proven broken.

### Fixed
- **Every "Run scan now" queued two crawls and billed for both.** `onPageTaskPost` called `post()`
  for the task, discarded the result, then made a second raw call to read the id — so the first
  crawl was orphaned and paid for. The kept call also dropped `load_resources` /
  `enable_javascript`, making it the expensive config. Now one call, with the cheap flags and
  proper HTTP + `status_code` error handling. This is what the six-hour rate limit on
  `/api/qc/scan` was protecting, and it was leaking straight past it.
- **A wedged task pinned a client forever.** The cron's collect branch polled `onpage_task_id`
  every run and the queue branch never got a turn, so a task that never finishes silently ends
  crawling for that client. DAPS.FIT sat on a leftover `mock-task-000` for five days, logging
  "crawl still running" daily. Added `isCrawlStale` / `STALE_CRAWL_HOURS` (48h) in `lib/qc.ts`;
  past the cutoff the cron abandons the id, logs a `collector_runs` error, and falls through to
  requeue in the same run.
  - 48h, not the manual route's 12h: the cron queues on one run and collects on the next, so a
    healthy crawl is already ~24h old the first time it is checked. A lower cutoff would abandon
    every crawl before it was ever collected. Test covers that boundary.
  - A missing `onpage_task_started_at` reads as stale, so rows predating the fix heal themselves.
- **The cron never wrote `onpage_task_started_at`** when queueing, only the manual route did.
  It does now, which is what makes the staleness cutoff measurable.
- Requeue is guarded by `collectedThisRun`: `c.last_crawl_at` is the value read at the top of the
  loop, so `isDue()` would otherwise say yes for a crawl scored moments earlier and pay twice.

### Production data touched
- Cleared DAPS.FIT's `mock-task-000` (`onpage_task_id` + `onpage_task_started_at` → null). Its
  `last_crawl_at` is null and frequency is monthly, so the next cron queues a real crawl. The
  staleness fix would also have healed it on deploy; cleared by hand so it is not waiting on one.

### Tests
`tests/unit/onPageTask.test.ts` (new, 7) asserts the call count and request body, not just the
returned id — the old bug was invisible to a return-value assertion. `tests/unit/qc.test.ts` +6
for the staleness boundary. Full suite green: 262 passed, 11 skipped. `tsc --noEmit` clean.

### Still open for Tom
- **`MOCK_APIS` is set on the Production environment** in Vercel, not just Preview. It appears to
  be off (this morning's task ids are real), but its presence in production is how DAPS got a
  `mock-task-000` in the first place. Recommend removing it from Production entirely.
- The two crawls from this morning are still uncollected. "Check for results" on each QC page
  pulls them in now; otherwise the next cron takes them. Either way they will be the first rows
  `qc_scans` has ever held, so the panel's render path gets its first real exercise then.

---

## 2026-07-27 · Session 1 · WO-003 Wave 1 — Stream A shipped, Stream M shell built

### Stream A · Supabase Auth + per-client RLS — SHIPPED TO PRODUCTION
The hard gate is closed. Client isolation is enforced by Postgres, not by application code.

- Migration 012 applied to staging **and production**: `organization → clients → users`,
  `user_profiles` (owner/pod_lead/specialist/client), `client_users`, and RLS on every table.
  Every policy routes through one function, `has_client_access(uuid)`.
- App moved off the two shared passwords onto per-user Supabase Auth. All six dashboard pages read
  through `userClient()` so RLS applies; `dbClient()` (service role) remains only for cron,
  collectors and agency writes. `lib/authToken.ts` deleted.
- Role mapping deliberately not one-to-one: the old `admin` password covered both client config and
  everyday pod work. `/admin` is now owner-only; research and change-logging accept any agency role,
  so a pod lead can work without holding the keys to client credentials.
- `platform_secrets`: RLS on, **no policy at all** — deny-all for every signed-in user including
  owners. Service role only, via the 011 vault RPCs.
- **Verified on real production data before merge:** owner sees DAPS.FIT + Salty Dog / 300 rankings;
  the Salty Dog client user sees 1 client / 201 rankings; asking explicitly for DAPS.FIT's UUID
  returns **zero rows**. Both accounts confirmed working in a browser.
- 🔒 **Security defect found and fixed same-day.** Push review caught an **open redirect** in the
  login `next` parameter: the check asked whether `next` pointed at `/portal` but never whether it
  pointed at this site, so `/login?next=https://evil.com` would sign a user in legitimately and then
  hand them to an attacker — credible phishing precisely because the sign-in is genuine. Fixed in
  `lib/safeNext.ts`, 19 regression tests, deployed. Live ~10 minutes on a private dashboard.
- `/portal` placeholder added so client logins land on an honest holding page rather than a 404.

### Stream M · agency shell — NEW, and it was missing from WO-003
Tom flagged that the built UI still looked nothing like the design. He was right, and WO-003 as
drafted had no stream for it: streams existed for the new components and the portal, none for
restyling the existing agency surfaces. Added as Stream M and built.

**The bigger finding underneath it.** Tom's point that "only our ecommerce brands would have that"
could not be expressed at all: **`client_type` was specced in plan §2 as 'a data-model concern, not
a UI afterthought' and never built.** Every client was treated identically. Migration 013 adds it
plus `service_areas`, `gbp_location_ids`, `store_platform`. It classifies only what it can prove —
a linked store *and* real Shopify rows — so Salty Dog self-classified and DAPS.FIT correctly stayed
NULL rather than being guessed.

- Tabs derive from client type, both directions: Revenue is eCommerce-only (and folded into
  Overview per Tom), GBP and Automation are local-only, Search kept despite the design omitting it.
- Sidebar ported from the design export. **Departure:** the export's Agency/Portal toggle is a
  demo device; in production the side is decided by role and enforced by RLS, so a toggle would
  mislead. Omitted.
- Eight holding pages that say what they wait on. **None renders a zero** — a zero is a claim that
  we measured and found none, which is usually false.
- Attention rail deduped: the cron fires per client, so one broken collector read as
  "NEEDS ATTENTION · 2" for a single failure.

### Findings surfaced today that nobody was looking for
1. **GA4 collector failing every run for 5 days** — service account never granted Viewer on Salty
   Dog property `451445566`. Fixed by Tom; verifies on the next cron run. Correction to an earlier
   claim: the attention rail *did* show it. Nobody looked. That is a different problem from a blind
   spot, and a better one.
2. **Open redirect in my own code**, above.
3. **AEO shows 0% and it is real data, not a display bug** — 121 prompt checks for Salty Dog with
   zero mentions and zero citations. Either genuine absence (an opportunity) or a false-negative in
   detection. **Spot-check before it is client-visible** — accuracy gate.
4. **DAPS.FIT looks onboarded but is not** — Dominate tier, no store, no ad accounts, nothing
   collected since 24 Jul, and now unclassified.
5. Attention-rail double count, fixed above.

### Follow-ups (none blocking)
- Preview env vars missing (Vercel CLI 54.10.2 rejects its own suggested command) → branch previews
  for Streams B/C will fail to build until added.
- `DASHBOARD_PASSWORD` now unused, safe to delete. `ADMIN_PASSWORD` stays (machine bearer token).
- Old Revenue tab's AOV / order count / revenue-by-source needs merging into the Overview block.
- Accounts needed for any other staff who used the shared password.
- **Call tracking surfaced three times today** (portal headline, local Overview, Automation tab).
  It is the one open decision with no deadline on it.

### Next
Stream B (screenshot service, vendor decided) and Stream C (audit log, migration now 014).

---

## 2026-07-27 · Session 1 · Design inputs reconciled · housekeeping resolved · WO-003 drafted

Read the new inputs (`docs/design/`, punch list, feasibility review), resolved the two housekeeping
conflicts, reconciled the plan, and drafted WO-003. **No implementation started** — as instructed.

### Housekeeping 1 — the WO-002 collision, resolved by renaming, not renumbering
Two documents claimed WO-002:
- `docs/wo-002-dashboard-reorg.md` — CTO's. Approved, built, **shipped to production 2026-07-23** (PR #13).
- `docs/wo-002-growth-os-saas-spec.md` — Tom's. Self-described "spec for review, not yet scheduled."

The shipped one **keeps the number**: it's fixed in git history (`WO-002 v1`, `WO-002 v1.5` commits) and
in prior WORKLOG entries, and rewriting that is churn for no gain. Tom's document is not a work order —
it defines a product surface rather than a scheduled unit of work — so it was renamed **out of** the WO
sequence to `docs/spec-growth-os-two-sided.md` and marked a **standing spec**. Content unchanged; a
renumbering note explains the move at the top. The work order that implements it is **WO-003**.
Also marked the reorg doc ✅ SHIPPED, and recorded what did *not* ship from it (the Search view is still
a placeholder; per-client cron fan-out was deferred once parallelization proved sufficient).

### Housekeeping 2 — doc locations. The conflict was worse than described.
The brief wasn't pointing at `docs/` — **root `CLAUDE.md` was still the WordPress-theme brief for a
different project entirely**, and referenced `STATUS.md` / `WORKLOG.md` nowhere at all. The only doc
naming their location was `docs/CLAUDE-monitor-draft.md`, which correctly said "repo root." So a fresh
session read a WordPress brief and never found either file. That's the same failure that blocked
WO-001 session 1 (blocker #4, 2026-07-21) — still unfixed six days later.

Resolution: **files stay at the repo root** (zero churn, matches history and the draft). The monitor
brief was **promoted from `docs/CLAUDE-monitor-draft.md` to root `CLAUDE.md`**; the WordPress brief is
archived at `docs/archive/CLAUDE-wordpress-theme.md`. Added a "Where things live" table to `CLAUDE.md`
stating root explicitly. **Tom: this promotes the draft you were asked to approve — content is
unchanged from what you reviewed, so if you want edits, edit in place rather than reverting.**

### Delivered
- **`docs/design/README.md`** — map of the export so nobody parses 161 KB again. Documents the `x-dc`
  format (bindings + `sc-if`/`sc-for`, state machine in the bottom script), all 16 screens by key and
  nav label, the 11 workspace tabs, both components' variants and states, and the porting rule (take
  tokens + state logic, don't port `support.js`).
  - Two gaps found while mapping: a **`results` screen exists in `header()` but is in no nav** — the
    client-language change log is specced and unreachable; and GBP/LinkedIn/Google panels render
    **populated with sample data** for integrations we can't fill.
- **`docs/tm-growth-os-plan.md` reconciled** — new §0 access-status table (Google Ads / GBP / LinkedIn
  all ⛔ blocked-on-application, none submitted); Phase A.5 now carries **Supabase Auth + RLS**
  (moved from Phase C — the design makes the portal a v1 surface), **screenshot service**, and
  **audit log** as explicit infrastructure prerequisites; **call tracking added as open decision 0**
  (the COO's single biggest gap); **PostFlow flagged as blocking Module E**; API inventory updated with
  four new rows. Also fixed the §8 contradiction that still budgeted RLS for Phase C, and added the
  multi-model AEO claim and the Automation module to the verify-before-promising list.
- **`STATUS.md` rewritten** — design deliverables done, all 10 punch-list items as not-started with
  their stream assignment, five external actions on Tom, and the housekeeping resolutions.
- **`docs/wo-003-design-implementation.md` drafted** — six waves, 12 agent-parallel streams on WO-001
  conventions (`module/<slug>`, reserved migration numbers 012/013 so parallel agents don't collide),
  every punch-list item assigned to the stream it belongs to.

---

### Tom — what your five blockers actually cost

You asked which streams each blocker gates. Short version: **three of the five gate only Wave 5, one
gates one stream, and one is probably already done.** Waves 1–3 are not blocked by any of them.

| Your blocker | Streams it gates | What the delay costs |
|---|---|---|
| **0.1 Google Ads — Explorer→Basic upgrade** (not submitted; an Explorer token + OAuth bundle *are* vaulted) | Wave 5 Google panels only | **Low.** The collector is built, wired into cron, and mints tokens per run. Nothing in Waves 1–4 waits on it. Cost is an incomplete cross-platform MER and a "connection pending" tile. **Note:** the two remaining steps for *first* real Google data aren't applications at all — link Salty Dog's account under the MCC and seed its customer ID (~2 min each). Worth doing before the upgrade clears. |
| **0.2 GBP API access** (not submitted) | Wave 5 GBP module — workspace GBP tab + portal Google Business screen | **Medium, and it's the longest clock.** Stated 14-day review, realistically weeks, so every week of delay is a week added to the *end* of the project, not absorbed. For local-service clients this is also a headline portal metric (calls). **Submit first.** Good news (verified 2026-07-27): it's **one application per GCP project, not one per client** — per client is just a Manager invite. Applying needs a verified GBP active 60+ days (ours or a client's). |
| **0.3 Meta system-user token** | Wave 3 Stream G (`module/paid-controls`) | **Probably zero — please just confirm.** WORKLOG 2026-07-23 records this generated with you via the Business Settings wizard, co-admin approved, vaulted as `meta:65f0506d…`, and Meta spend is flowing in prod today. The feasibility review lists it as outstanding. I believe the review is stale. |
| **0.4 PostFlow API yes/no** | Module E / Social — the workspace Social tab and the portal Social screen | **Medium, and it's a scope question, not a plumbing one.** No API means "drafts land in PostFlow" becomes manual paste or PostFlow gets replaced. That changes what we build, so it can't be answered during the build. |
| **0.5 Call-tracking decision** | Wave 4 Stream J (`module/portal-shell`) headline metrics — **for local-service clients only** | **Zero or total, depending on one other choice.** The portal leads with Calls · Cost per job · Jobs booked · Return per $1. For local clients we can't compute any of them today. **But if the portal pilot is an eCommerce client, this blocks nothing** — Shopify revenue is ground truth already. |

**The one decision that removes the most risk: pick an eCommerce portal pilot (Salty Dog).** It takes
0.5 off the critical path entirely and lets Wave 4 start the moment Auth + RLS lands.

**Highest-value action today: submit 0.2 (GBP).** It has the longest approval clock and it's pure
calendar time — every day it sits unsubmitted is a day added to the far end of the schedule.

### Addendum — GBP access verified, and it's smaller than we scoped it

Tom asked whether each business needs its own GBP API. Checked against Google's developer docs rather
than answering from memory. **It does not — one application, per GCP project, not per client.**

- Approval is **one-time per Google Cloud project**, manually reviewed, stated 14-day window
  (realistically weeks). It does **not** carry over between GCP projects, so submit against the
  project we intend to keep.
- One approval unlocks a default quota across **all eight Business Profile APIs**, including the
  Business Performance API we need for calls/directions/views. Performance also needs enabling in the
  GCP console — a toggle, not a second application.
- **To apply we must cite a verified GBP active 60+ days** — TM's own or a client's. Incomplete
  submissions are the main cause of delay, so pick which profile we cite before filing.
- **Per client it's an access grant, not an application:** the client adds TM as a **Manager**, then
  TM calls the API with its own credentials. Added as Appendix A step **5b**, alongside the GSC/GA4
  grants, with the gotcha that a *pending* invite reads as connected and returns nothing.
- ⚠️ **Left open:** GBP uses OAuth (`business.manage`) and the manager pattern implies **user**
  credentials; we use a **service account** for GSC/GA4. Not confirmed that GBP supports service
  accounts. Assume the GBP stream may need its own OAuth flow — auth plumbing, not scope, but it's a
  day or two the WO-003 estimate doesn't currently carry. Verify when filing.

Folded into plan §0 (new subsection), Appendix A step 5b, WO-003 Wave 5, and STATUS blocker 2.
**Net: this blocker is one form plus per-client Manager invites — but it's still the longest clock of
the five, so it stays the highest-value thing to submit today.**

### Addendum 2 — external actions worked, live GA4 failure found

Ran the blocker list with Tom. Two changes to the picture:

- ✅ **Meta token confirmed live — blocker 0.3 was stale, now closed.** Verified from `collector_runs`
  rather than asking: `meta_ads` succeeded with **706 rows today, 690 yesterday**. The feasibility
  review's "token not yet generated" was out of date; WORKLOG 2026-07-23 was right.
- 🚨 **New: `conversions` (GA4) has been erroring on every run** — *"User does not have sufficient
  permissions for this property"* against Salty Dog property `451445566`. The collector service
  account was never granted Viewer. This is silent staleness, the failure mode plan §7 A.5 calls the
  worst client-facing one, and our own Slack staleness alerting did not surface it. **Two issues,
  not one:** the missing grant (Tom, 2 min) and the fact that a daily-erroring collector went
  unnoticed. Fold an alert-coverage check into WO-003 Stream C.
- ✅ **GBP access request SUBMITTED 2026-07-27** — "Application For Basic API Access", against the
  `tm-seo-monitor` GCP project number, citing **Alpha Zeta Landscapes** (verified, 60+ days) as the
  qualifying profile. Response expected **~2026-08-10**. The longest clock of the five is now running,
  which was the single most valuable thing to start today.
  - Note for whoever picks up the GBP stream: approval is bound to that **project number**. Do not
    move the API calls to a different GCP project without re-applying from zero.
- ✅ **PostFlow API question RESOLVED — yes, and better than the fallback we were bracing for.** Tom
  found their docs; verified against `postflow.app/docs` and `docs/llms.txt` rather than the AI
  summary. Full REST API at `https://api.postflow.app/v1`, bearer auth: create + schedule posts,
  **explicit draft set/unset** (exactly the design's "drafts land in PostFlow" handoff), list/filter/
  retrieve post groups up to 200/request, **per-post and per-group analytics** with per-story
  breakdowns, media upload (direct + URL), activity logging. **PostFlow is not being replaced and
  Module E's scope is unchanged from the design.** Three build-time details still unconfirmed, none
  affecting scope: rate limits · plan-tier gating · whether a published **permalink** is exposed
  (the join key between publishing and our analytics). **Token generated by Tom and vaulted as `postflow` in prod
  the same day**, verified readable through `vault_read_secret` (52 chars) — so the collector's own
  read path works, not merely the write. Rate limits confirmed at 60 req/min per token.
- ✅ **Salty Dog confirmed to run Google Ads**, so the MCC link is live work rather than hypothetical.
  Awaiting the customer ID from Tom, then I seed `ad_platform_accounts` and the next run tells us
  whether the Explorer-tier token can pull production data.
- ⏳ Still open with Tom: GA4 grant verification (waits on the next cron run) · Google Ads customer
  ID · Explorer→Basic upgrade · PostFlow token · portal pilot + screenshot-vendor decisions.

**Blocker count is now 2 of 5 fully closed (Meta, PostFlow) and 1 submitted-and-waiting (GBP).**
The remaining external work is small: one customer ID, one upgrade application, two tokens.

### Next action
Awaiting approval on WO-003 before any implementation. Five open questions at the bottom of that doc
(portal pilot client · punch-list #10 signed-link-or-cut · screenshot service self-host vs vendor ·
portal tier entitlement · individual vs shared client logins). Bloom adopt/pass decision still due
**2026-07-29**.

---

## 2026-07-23 · Session 1 · WO-002 opened — Growth OS dashboard reorg (channel-oriented)

Convened a 4-role consult (CTO / COO / Head of Performance / Head of Social) on the "SEO-shaped
dashboard" problem; synthesized into **docs/wo-002-dashboard-reorg.md**.

- **Locked decisions:** single-client deep-dive first (+ thin portfolio alarm strip); restructure
  existing SEO+Paid+Revenue into channels now, Social fast-follow; paid-social surfaced under Paid
  now (Meta data already flows), organic-social the net-new build. Split social by budget mechanic.
- **Beyond a reorg:** revenue-first Overview that **absorbs `/command`**; a **Search view**
  (organic + paid × query/landing page → cannibalization + gaps); over-attribution as reconciliation
  math (not a boolean); alerts/deltas/sparklines + freshness badges; shared `channel_metrics` model.
- **HARD GATE (v1.5):** refactor the 300s-bound daily cron to **fan-out per client×source** before
  Social or more clients — it's already biting (blocked the live SEO-snapshot refresh today).
- Stopgap: hand-patched Salty Dog's SEO snapshot to real values (7,696 traffic / 229 kw / 976
  backlinks / 14.84% visibility) since the cron limit blocked a live refresh.
- **Build starting: v1 restructure.**

### v1 + v1.5 shipped to `feature/dashboard-reorg` (preview live)
- **Channel shell + revenue-first Overview** — `/dashboard/[id]` is now the Overview (MER hero +
  revenue + spend + inline over-attribution reconciliation + channel summary tiles). SEO detail
  moved intact to `/organic`. New `/paid` (spend + per-platform ROAS + reconciliation), `/revenue`
  (Shopify ground truth, orders, AOV, by-source), `/search` (placeholder — needs the GSC-query ×
  paid-search-term join). ChannelNav + ClientHeader shared components.
- **Portfolio roll-up** — `/dashboard` rebuilt as the revenue-first roll-up (attention rail over
  per-client scorecards led MER · Revenue · Spend · Organic · AI). **`/command` retired** → redirect.
- **v1.5 cron fix** — parallelized SERP (cap 8) + AI (cap 6) with `mapLimit`; SERP resilient
  per-keyword. Fixes the 300s timeout + the SEO-snapshot staleness; unblocks scale. 98 unit /
  5-5 staging green, tsc + build clean.
- **Remaining:** Search view build (needs the query-join data pipeline); per-client fan-out only
  if parallelization proves insufficient at higher client counts. Production untouched — on branch.

---

## 2026-07-23 · Session 1 · PROD GO-LIVE — real data + MER live for Salty Dog

Discovered the public dashboard (seo.trustedmarketing.com) was showing fake data, root-caused it,
and took the platform fully live on real data.

**Two root causes found:**
1. Vercel `trusted-marketing-seo` prod env pointed at the **staging** Supabase — site showed the
   `salty-dog.example` seed client; the real `getsaltydog.com` client (prod DB `tm-seo-monitor`)
   was unwired.
2. `MOCK_APIS=1` on the deployment — the **entire platform ran in demo mode** (every number a
   fixture), independent of the DB.

**Fixed (all live):**
- Repointed Vercel prod env: `SUPABASE_URL` + `SERVICE_ROLE_KEY` → prod project (xelweikfciqakagkerat).
- `MOCK_APIS` → `0`, redeployed. Platform out of demo mode.
- Wired prod Salty Dog (65f0506d, getsaltydog.com): Meta account act_1485787419951582, Shopify store
  d-vein-company.myshopify.com (secret already in prod vault), GA4 properties/451445566, tier Momentum.
  Left its real SEO setup (23 keywords) untouched.
- **Meta system-user token** (tmseoapp, ads_read, never-expire) generated with Tom via the Business
  Settings wizard — earlier "No permissions available" was just the wrong app selected. Required a
  2nd-admin approval (business security control); once approved, vaulted per-client as
  `meta:65f0506d…` and wired to ad_platform_accounts.auth_ref (no redeploy — vault read at runtime).
- Purged the mock rows a first (mock-mode) collection wrote to prod; cleaned 24 test-run mock
  snapshots from staging (demo history preserved).

**Live result (real data, 28-day):** SEO 7,696 traffic / 229 kw / 976 backlinks · Shopify revenue
**$42,190.58** · Meta spend **$22,878.96** · **MER 1.84×**.

**Follow-ups:** (a) SERP hit a transient DataForSEO `40101` — re-run to populate rankings; (b) the
`force=1` full run brushes the 300s function limit (slow AI checks) — normal daily (non-force) runs
finish fine, but worth optimizing; (c) Google/Microsoft ads still deferred (account-linking).

---

## 2026-07-22 · Session 1 · Google Ads API credentials provisioned + vaulted

Cleared the whole Google Ads auth chain with Tom (browser-driven).

- **Developer token** exists (Explorer Access tier) on MCC **711-022-5227**; vaulted as
  `google_ads_developer_token` (staging).
- **OAuth (Desktop app)** created in the `tm-seo-monitor` GCP project under the
  trustedmarketing.com org → consent screen set **Internal** (no verification, non-expiring
  refresh token). One-shot minter at `scripts/google-oauth.mjs` (zero-dep, reads secret from a
  seeded 0600 file, loopback flow) captured client_id + client_secret + refresh_token.
- All three **vaulted as `google_ads_oauth`** (JSON bundle); round-trip read verified; local
  plaintext scrubbed. `.google-oauth.local.json` gitignored.
- **Left before live Google data:** (a) wire the collector to the refresh-token flow — mint
  access token per run from the vaulted OAuth bundle + set login-customer-id = MCC (code, CTO);
  (b) link Salty Dog's Google Ads account under MCC 711-022-5227 and seed its real customer ID
  into `ad_platform_accounts` (Tom, ~2 min); (c) upgrade Explorer → **Basic access** for
  full-portfolio daily volume (application, async).

---

## 2026-07-22 · Session 1 · Google + Microsoft ads collectors wired into cron (PR #12)

Completes the paid-media spine — MER now reconciles across Meta, Google, Microsoft, Shopify.

- **Merged** the parallel-built Google Ads (PR #10) and Microsoft Advertising (PR #11)
  collectors into `feature/google-microsoft-cron`; no conflicts. Both reuse
  `ad_platform_accounts` / `ad_metrics_daily` — **no new migration**.
- **Wired** `collectGoogleAds` + `collectMicrosoftAds` into the per-client cron loop (after
  Meta, before Shopify). Each self-records `collector_runs`, self-skips unconfigured clients,
  never throws.
- **Proved against staging:** seeded mock google_ads + microsoft accounts on the staging
  Salty Dog client; extended the smoke to assert both collect >0 rows and land in
  `ad_metrics_daily`. Google 5 rows/$2,468.75, Microsoft 5 rows/$375.95 — spend in dollars
  (Google `cost_micros ÷ 1e6` confirmed).
- **Green:** tsc clean · 92/92 unit · 5/5 staging smoke · build compiles. **PR #12 open.**
- **Prod activation (pending Tom):** real per-client creds vaulted + `ad_platform_accounts`
  rows; Google Ads also needs dev-token + Standard-access approval (application in progress).

---

## 2026-07-22 · Session 1 · Bloom (trybloom.ai) Module D eval — kicked off

Work order: evaluate Bloom as the *primary* generation engine for Module D volume ad
creative (Figma → precision tier). Full eval in **`docs/bloom-eval.md`**; tracked in `STATUS.md`.

- **Verified Bloom is real + a strong structural fit:** native **Claude Code MCP** + REST API,
  learn-brand-from-URL/IG (no per-client template build), sizes 1:1/9:16/16:9 confirmed
  (4:5 TBD), Scale $90/mo (500 credits, API/MCP in every plan), you retain asset ownership.
- **Deliverables 3 (pricing), 4 (terms/privacy), 5 (architecture/zero-lock-in): drafted** from
  verified sources. Key flags: ToS silent on **agency/client/resale** use; privacy silent on
  **model-training** of brand assets (no opt-out); no indemnity (we bear IP risk); permanent
  deletion / no export (lock-in — mitigated by re-hosting every asset into our `creatives` table).
- **Deliverables 1 (generation spike) + 2 (brand fidelity): BLOCKED** — need a Bloom account +
  **MCP connector authorized in this session**, Salty Dog + DAPS **design tokens**, and DAPS **URL**.
- **Preliminary posture: adopt-for-subset**, pending the spike + Bloom's written answers on the
  agency-use / no-training / DPA gaps. Decision due 2026-07-29.

---

## 2026-07-22 · Session 1 · Shopify collector + MER proven; 2 bugs caught by the gate

First real-client integration (Salty Dog / `d-vein-company` store).

- **Shopify collector built** (PR #7): client-credentials grant → per-run token →
  Admin orders API → `conversions_daily(source='shopify')`. Per-client vault creds
  via migration 010 (`client_stores`). Validated against the real store through the
  production auth path (not the session MCP).
- **MER proven on real Salty Dog data:** Shopify actual **$42,758.45** (478 orders)
  ÷ Meta spend **$23,022.65** = **1.86× blended MER**; Meta claims **93.7%** of
  actual revenue — the over-attribution tell.
- **Bug #1 (PR #6):** Meta collector summed 6 overlapping purchase action types →
  6× revenue overcount (fake 10.4× ROAS). Fixed to canonical `omni_purchase` →
  true 1.74×, matches Meta's own account-level number to the penny.
- **Bug #2 (PR #8):** vault `readSecret`/`storeSecret` queried the `vault` schema
  via the data API (Supabase doesn't expose it) → always null. Fixed with
  SECURITY DEFINER RPC wrappers (migration 011). Caught wiring the Shopify secret;
  also updated the meta collector test for the rpc change.
- Memory saved: production pulls are per-client/dynamic from vaulted creds, never
  the assistant's session MCPs (Tom's architecture call).

### Open PRs — suggested merge order
1. **PR #8** vault RPC fix — foundational (any vaulted secret needs it).
2. **PR #6** Meta dedup fix.
3. **PR #7** Shopify collector — depends on #8; its readSecret test needs the same
   `.schema`→`.rpc` one-line update when it rebases on the vault fix (I'll do it at
   integration).

### Still to do after merges
Apply migrations 010/011 to **prod** (prod is at 004–009); wire Salty Dog's real
Shopify + Meta creds into the prod vault; wire `collectShopify` into cron; build
the **MER reconciliation view** in Module A (Spend · actual revenue · MER ·
per-platform ROAS with the over-attribution flag).

### Staging state
Salty Dog (staging) has real Meta `ad_metrics_daily` + real Shopify
`conversions_daily(source='shopify')`; migrations 001–011 applied.

---

## 2026-07-21 · Session 1 · 🚢 SHIPPED TO PRODUCTION

WO-001 complete and live.
- Applied migrations 004–009 to **prod** (`xelweikfciqakagkerat`) as one atomic
  additive migration (all `if not exists`; verified 6 new tables present).
- Merged **PR #1** → main (`8dc554e`). Vercel prod deploy `dpl_41R6…` **READY**,
  aliased to **seo.trustedmarketing.com**.
- Prod smoke: `/login` 200, `/command` 307 (new route + auth middleware live).
- Module PRs #2–#5 auto-marked merged (branches now in main).
- **Safe by construction:** new modules self-skip for prod clients until configured
  (no `ga4_property_id` / ad account / `clickup_list_id`), so the existing SEO
  monitor is unchanged and nothing client-facing surfaces (accuracy gate intact).

### Now live in prod (dormant until configured)
Enabling layer · stream 1 (jobs + collector_runs + Slack) · vault · GA4 conversions
· ClickUp sync · Meta ads · Module A `/command` dashboard.

### Phase B (next — gated, per client)
Wire real data one client at a time (Meta token → vault, GA4 service-account access,
real ClickUp), two clean collection cycles before surfacing (accuracy gate §8).
Pending Tom: Meta token (near), Microsoft dev token + Azure app (stream 6), 👍 the
CLAUDE.md draft, decision on recSync auto-resolve-approved.

---

## 2026-07-21 · Session 1 · Stream 4 INTEGRATED + Module A Paid channel live

- Merged `module/meta-ads-collector` (PR #5) onto enabling layer (clean merge, 49 tests).
- Migration **009** applied to staging; seeded a mock Meta `ad_platform_accounts` per
  client. Wired `collectMetaAds` into cron (self-skips if no account).
- **Proven vs staging:** 10 `ad_metrics_daily` rows ($1,479.90 spend / $2,840 rev),
  `meta_ads` collector_runs green; 49 unit + staging smoke pass; tsc clean.
- **Module A** `/command`: Paid·Meta channel now shows spend + ROAS (was "soon").
  Verified rendering on local server.
- Meta app 967936846294439 now has Marketing API use cases enabled (Tom); token
  generation is the last step → then real paid data replaces the mock via vault.

---

## 2026-07-21 · Session 1 · Stream 4 (Meta ads) dispatched against fixtures

Tom hit Meta's system-user token maze (app has no Marketing API product / needs
Full-control app role / business requires 2nd-admin approval for token gen). To
keep momentum, dispatched stream 4 to build against a recorded fixture now, with
real token-wiring (vault `readSecret` on `ad_platform_accounts.auth_ref`, fallback
`META_ACCESS_TOKEN`) in place — goes live with only a vault entry later.
- Module: migration 009 (`ad_platform_accounts` + `ad_metrics_daily`), `src/lib/meta.ts`
  (Marketing API insights client, MOCK_APIS-gated), `src/lib/metaAdsCollector.ts`
  (standalone, collector_runs), fixtures + unit tests. Draft PR, base enabling-layer.
- Pending Tom: Meta system-user token (add Marketing API product to the app +
  Full-control app role + clear the 2nd-admin approval), then I store it via vault.
- Stream 6 (Microsoft) still awaits its dev token + Azure OAuth app.

---

## 2026-07-21 · Session 1 · Module A — command dashboard (visual surface)

New `/command` route (viewer-accessible; added to middleware matcher). The whole
portfolio in one screen:
- **Attention rail** (account-manager morning page): collector failures, stale-data,
  declined verdicts — or a healthy "All clear" state (charcoal band, green dot,
  live counts). Currently healthy on staging.
- **Per-client scorecards** with a **channel strip**: Organic (visibility) · AI
  answers · Revenue·GA4 (from conversions_daily) · Site health — each headline +
  delta. Plus a data-freshness dot per client and open/approved rec counts.
  Paid·Social shown as "soon" until those modules land.
- Extends the existing TM design system (Instrument Serif italic-green signature,
  stone/charcoal/green tokens). Linked from the SEO dashboard; links back.

**Verified:** booted the app against staging, logged in, rendered `/command` — both
clients, all channels, healthy rail all present (28 KB SSR HTML, no client JS).
`tsc` + `next build` clean. Committed + pushed on `chore/enabling-layer`.

**To view:** add `ADMIN_PASSWORD` (or `DASHBOARD_PASSWORD`) on Vercel Preview →
preview `/login` → `/command`. (Same env gap that blocked the SEO dashboard.)

---

## 2026-07-21 · Session 1 · Wave 1 INTEGRATED + proven green against staging

Streams 2/3/5 merged onto `chore/enabling-layer` (merge commits preserve agent
authorship). Integration pass wired all three collectors into the cron:
- Migration **008** adds `clients.ga4_property_id`; migrations 001–008 all on staging.
- Cron route now calls `collectConversions` (guarded on `ga4_property_id`),
  `syncApprovedRecs` per client, and a portfolio-wide `checkTokenExpiry` sweep —
  each self-records `collector_runs` and never throws.
- Staging clients configured (GA4 property + ClickUp list); seed.sql updated to match.

**Proven against staging (real data, not just "no error"):**
- GA4 → `conversions_daily` **10 rows** (5/client).
- ClickUp → an approved `striking_distance` rec **synced to a task**
  (`clickup_task_id`/`url`/`synced_at` stamped; mock task under MOCK_APIS).
- token_expiry → green sweep (0 expiring).
- **37 unit tests + staging smoke 4/4 green; `tsc` clean.**

`chore/enabling-layer` (PR #1) is now the full **wave-1 bundle** for Tom's merge;
per-module PRs #2/#3/#4 are subsumed (their branches are ancestors) and can close.

**⚠️ Observation (flagged, not changed):** `recSync.syncRecommendations`
auto-resolves any `open`/`approved` rec whose rule stops firing — so a
human-*approved* rec can be silently resolved before ClickUp sync sees it. Worth a
design decision (approved recs probably shouldn't be auto-resolved).

**Next:** Module A (command dashboard — the visual surface) · streams 4 (Meta) +
6 (Microsoft) once Tom provides platform tokens · fix: worktree dirs were
accidentally committed then removed + gitignored.

---

## 2026-07-21 · Session 1 · Wave landed — 3 draft PRs, migrations serialized to staging

All three wave agents returned green. CTO review + serialization done:

| Stream | PR | Migration | Applied to staging | Tests |
|---|---|---|---|---|
| 3 GA4 → conversions_daily | #3 | 005 | ✅ | 21/21 |
| 2 secrets vault + expiry | #4 | 006 | ✅ (+ Vault RPC round-trip verified) | 23/23 |
| 5 ClickUp sync | #2 | 007 | ✅ | 23/23 |

- All PRs **draft**, based on `chore/enabling-layer` (clean stacked diffs), tests green,
  `tsc` clean. No agent touched shared files (cron/admin routes, package.json, CLAUDE.md).
- Migrations serialized in order 005 → 006 → 007; each is additive/independent.
- Streams **4 (Meta)** and **6 (Microsoft)** are now unblocked (vault landed) — dispatch
  next, needs Tom's platform tokens.

### Integration pass (pending — best done after Tom merges PR #1)
1. Wire `collectConversions` / `syncApprovedRecs` / `checkTokenExpiry` into the cron
   route (single shared-file edit, once the module branches merge).
2. Schema-spine adds: `clients.ga4_property_id` (GA4) — migration 008; seed staging
   clients with `ga4_property_id` + `clickup_list_id` so their smoke passes.
3. Decide invocation model for ClickUp sync (every cron tick vs on-approve) + wire
   `markShippedFromClickup` to a ClickUp completion webhook/poll.
4. Re-run combined staging smoke; flip PRs #2–#4 ready for merge.

### Still pending on Tom (not blocking wave build)
- Merge PR #1 (enabling layer) → then module PRs retarget to main automatically.
- 👍 `docs/CLAUDE-monitor-draft.md`. `CLICKUP_TOKEN` + real Salty Dog list_id.
  Meta + Microsoft tokens for streams 4/6.

---

## 2026-07-21 · Session 1 · ACCEPTANCE PROVEN + wave dispatched

- **Green preview against staging — PROVEN.** Tom set Preview-scoped env
  (staging URL/key + MOCK_APIS=1) and redeployed. Probed the deployed preview's
  `/api/cron/collect?force=1` with the staging CRON_SECRET → **HTTP 200**, staging
  clients in report (`sharkey-air.example`, `salty-dog.example`), **failures:0**,
  all modules green. WO-001 acceptance path spawn → green-preview-against-staging
  is met; only the human merge of PR #1 remains (by design, v1).
- **Parallel wave dispatched** (3 agents, each own worktree/branch, based on
  `origin/chore/enabling-layer`, mirroring the stream-1 template):
  - Stream 3 — GA4 collector → `conversions_daily` (migration 005)
  - Stream 5 — ClickUp sync (migration 007)
  - Stream 2 — secrets vault + token expiry (migration 006; unblocks 4 & 6)
  Each opens a DRAFT PR; CTO (me) serializes/applies their migrations to staging
  and wires collectors into the cron on review. Streams 4 (Meta) + 6 (Microsoft)
  follow stream 2's vault.
- Migration numbers pre-assigned to avoid collision: 005 GA4, 006 vault, 007 clickup.

---

## 2026-07-21 · Session 1 · Stream 1 shipped + green against staging

**Enabling layer + stream 1 built, verified, committed on `chore/enabling-layer`.**

- **Harness (§3):** vitest added; `MOCK_APIS=1` fixture layer (`src/lib/apiMock.ts`
  + `tests/fixtures/`) short-circuits DataForSEO/GSC; reusable in-memory Supabase
  fake (`tests/helpers/fakeDb.ts`). **15 unit tests green.** CI at
  `.github/workflows/ci.yml` (typecheck + unit + build, placeholder env, no creds).
- **Migration 004** (`jobs` queue + `collector_runs`) applied to staging.
- **Stream 1 code:** `src/lib/jobs.ts` (durable queue, retries + idempotency),
  `src/lib/collectorRuns.ts` (records every run; failure path records, never
  throws), `src/lib/slack.ts` (ops alerts, no-op if unset), and `collector_runs`
  integration wired into `src/app/api/cron/collect/route.ts` per module.
- **PROOF (§Acceptance):** `npm run test:staging` runs the real collector against
  staging with `MOCK_APIS=1` → **4/4 green**, 0 failures, both seed clients
  processed, and `collector_runs` populated (core/serp/ai/crawl/recs all
  `success`, e.g. `traffic=1234`, `visibility=21.88`, `site_health=92.5`).
  `npx tsc --noEmit` clean; `next build` clean.
- Slack webhook verified live earlier (test alert posted).

**Shipped to review:** `chore/enabling-layer` pushed; **PR #1** opened
(github.com/trustedmarketing/tm-seo-monitor/pull/1). CI (typecheck + unit + build,
no creds) runs on the PR.

**Remaining for full acceptance (1 external step + merge):**
- **Vercel Preview env vars** — the Vercel MCP has no env-var tool, so this needs a
  Vercel token (then I wire it via CLI) OR Tom sets them once in the dashboard for
  project `trusted-marketing-seo` (`prj_RJqMzlFmBXphXhQD5F97VlskUfSh`),
  **Preview** scope:
  - `SUPABASE_URL` = https://wwgcpveakcyebfmtdwyt.supabase.co
  - `SUPABASE_SERVICE_ROLE_KEY` = (staging secret key)
  - `CRON_SECRET` = 68c8f8c79cca779b13a038ef2617660a
  - `MOCK_APIS` = 1  (so previews never burn DataForSEO/GSC credits)
  This is a **one-time** setup; every future module branch's preview inherits it —
  that's what makes per-module previews zero-touch (acceptance §).
- Tom's merge of PR #1.

**Parallel wave — staged, dispatch after PR #1 merges (WO-001 §1–4 land):**
streams 3 (GA4→conversions_daily) + 5 (ClickUp sync) start; then 2 (vault) →
4 (Meta ads) + 6 (Microsoft ads). Each as its own `module/*` branch off merged
main, inheriting the harness + conventions + staging previews.

Enabling layer + stream 1 co-landed on one branch (the first module must co-land
with the harness that proves it); streams 2–6 are each their own branch.

---

## 2026-07-21 · Session 1 · Reconciliation + blockers (CTO)

**Task:** Execute WO-001 — build the enabling layer, prove it by shipping stream 1
through the full path, then dispatch the first parallel wave.

**Status:** ⛔ Blocked at the foundation. Escalated to Tom (4 items). No code
written yet — deliberately, to avoid building on a fabricated schema or faking a
staging run I can't verify.

### What I verified about the actual repo
- Repo is `tm-seo-monitor` (git remote confirms), Next.js 14 + Supabase — the
  correct WO-001 target. ✅
- Collector architecture read and understood (`src/app/api/cron/collect/route.ts`,
  `src/lib/*`). Tables the collector touches: `clients`, `tracked_keywords`,
  `keyword_rankings`, `tracked_prompts`, `prompt_results`, `metric_snapshots`,
  plus `recommendations` / `changes` via `recSync`. Env it needs:
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`.

### Blockers (only Tom can clear) — the escalation list
1. **Staging credentials never provided.** The brief says credentials are "in
   [wherever you put them]" — the placeholder was never filled. No `.env*` files,
   no secrets in repo or session. Without staging Supabase URL / service key /
   CRON_SECRET I cannot create+seed staging, run a collector green against it, or
   set Vercel Preview env vars. This blocks WO-001's acceptance criterion directly.
2. **Base migrations 001/002/004 are missing.** `supabase/` contains only
   `003_prompt_results.sql`. WO-001 §1 requires applying 001–004 to staging. The
   schema is the "shared spine" (§4) — I will not fabricate it. Need the real
   migration files (or a prod schema dump from project `xelweikfciqakagkerat`).
3. **External provisioning I shouldn't do unilaterally:** creating the billed
   `tm-growth-staging` Supabase project, Vercel Preview-scoped env vars, GitHub
   Actions secrets. WO-001 itself reserves these ("token generation, API
   applications") for Tom. Supabase/Vercel MCP servers also need Tom's OAuth.
4. **Governing doc mismatch.** Brief says "operate under the autonomy policy in
   CLAUDE.md." This repo's CLAUDE.md is the *WordPress theme* brief — wrong
   project, and it contains no autonomy policy or escalation list. Not overwriting
   a 14 KB standing brief without confirmation.

### Ready to build the moment blockers clear (in-repo, no live creds needed)
- §3 vitest harness: config, `MOCK_APIS=1` plumbing, `tests/fixtures/`, first
  collector test asserting rows written + failure paths writing `collector_runs`.
- §1 stream-1 schema: `jobs` queue + `collector_runs` migration files (proposed,
  applied to staging first).
- §3 CI GitHub Action (build + test on PR).
- §4 branch/agent conventions + a correct monitor CLAUDE.md.
- §1 staging seed script (1 local + 1 ecom fake client).

### Tom's decisions (received)
1. Staging access → **authenticate Supabase + Vercel MCP** (OAuth flows started).
2. Schema spine → **pull from prod Supabase** (`xelweikfciqakagkerat`) via MCP.
3. Autonomy policy → **draft from plan §8** → done, in `docs/CLAUDE-monitor-draft.md`,
   awaiting approval before it replaces the stale root CLAUDE.md.

### In flight
- Supabase + Vercel MCP OAuth URLs issued to Tom; waiting on authorization.
- Governance draft written (`docs/CLAUDE-monitor-draft.md`).

### DONE this session (staging stood up)
- Supabase + Vercel MCP authenticated. ✅
- Pulled full prod schema from `xelweikfciqakagkerat` (9 tables + `tracking_frequency`
  enum, all indexes / uniques / FK cascades; RLS enabled, zero policies —
  server uses service-role). Prod had **no** tracked migration history.
- Reconstructed the spine as committed migrations: `supabase/001_core.sql`,
  `supabase/002_recs_changes.sql` (existing `003_prompt_results.sql` kept as-is).
  Note: WO-001 said "001–004"; reality was only 003 in-repo + untracked prod, so
  the baseline is 001–003 and stream-1's schema becomes the next migration (004).
- Created staging project **`tm-growth-staging`** (`wwgcpveakcyebfmtdwyt`,
  us-east-1, $10/mo, org `nugvctznnswkayyboyuw`). Applied 001→002→003. Verified
  9 tables match prod.
- Wrote + applied `supabase/seed.sql` (idempotent): 1 local (Sharkey Air) + 1 ecom
  (Salty Dog) client, 30 days across every table — 180 rankings, 120 prompt
  results, 10 snapshots, 60 GSC rows, 3 recs, 1 measured/validated change.
- Governance draft written: `docs/CLAUDE-monitor-draft.md` (from plan §8 + WO §4).

### Input status (2026-07-21, cont.)
- ✅ Slack webhook received + verified (`ok`, test alert posted). Channel wired for
  failure/staleness alerts.
- ✅ ClickUp target received — Salty Dog link (workspace 90141342552). NOTE: this is
  a **real** client space; staging "Salty Dog" is fake, so stream-5 proof will use
  clearly-labeled `[STAGING TEST]` tasks, cleaned up after.
- 🚨 Service-role key pasted was **PRODUCTION's** (`sb_secret_...RWsZYhc4` reads real
  data from `xelweikfciqakagkerat`). NOT stored, NOT used. Caught before any write.
  Still need the **staging** secret key from project `wwgcpveakcyebfmtdwyt`.
  (Recommend Tom rotate the prod key since it was pasted in chat.)
- ⏳ CLAUDE.md draft approval still pending.

### Staging connection (for Vercel Preview env wiring)
- `SUPABASE_URL` = https://wwgcpveakcyebfmtdwyt.supabase.co
- anon (legacy JWT) and `sb_publishable_...` keys retrieved via MCP.
- ⛔ `SUPABASE_SERVICE_ROLE_KEY` — **MCP cannot surface the secret key.** Only Tom
  can copy it from dashboard → Project Settings → API. This is the one value
  blocking preview-collector-green.

### Escalation (2 items for Tom)
1. Paste the **staging service-role key** for `wwgcpveakcyebfmtdwyt` so I can wire
   Vercel Preview env + prove the collector green against staging.
2. Review/approve `docs/CLAUDE-monitor-draft.md` → then it replaces root CLAUDE.md.

### Next action (checkpointed for 2 inputs, then one verified push)
Read the full collector surface (DataForSEO Basic-auth fetch, GSC service-account
JWT, recSync/measureChanges). The harness's "correct rows written" tests AND the
preview deploy both need the staging **service-role key** to run green — so rather
than write stream-1 code I can't prove, I'm checkpointing. Once the key + draft
approval land, one coherent push: vitest harness + `MOCK_APIS=1` fixtures + CI →
stream 1 (`module/job-queue`: migration 004 jobs+collector_runs, queue lib,
collector_runs integration, Slack alerts, tests) → Vercel Preview env wired →
collector green against staging → into merge review. Then dispatch the wave.
