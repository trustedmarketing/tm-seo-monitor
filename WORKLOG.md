# WORKLOG — WO-001 Parallel-Build Enabling Layer

Update channel for WO-001 execution. Newest entries on top.

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
