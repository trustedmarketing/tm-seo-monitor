# WORKLOG — WO-001 Parallel-Build Enabling Layer

Update channel for WO-001 execution. Newest entries on top.

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

**Remaining for full acceptance:** Vercel Preview deploy of the branch pointed at
staging (env-var wiring) + Tom's merge. Then dispatch the parallel wave (streams
3+5, then 2→4→6). Note: enabling layer + stream 1 co-landed on one branch (the
first module must co-land with the harness that proves it); streams 2–6 will each
be their own `module/*` branch, demonstrating the parallel-build pattern.

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
