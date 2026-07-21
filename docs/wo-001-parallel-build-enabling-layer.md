# Work Order 001 — Parallel-Build Enabling Layer
**To:** TM CTO · **From:** Tom · **Priority:** first, before any Phase A.5/B module work
**Goal:** make agent-built modules self-verifying so Tom stops being the integration layer. Est. 2–3 build days. Everything below is prerequisite to running parallel agent streams.

## 1. Staging environment
- Create a second Supabase project `tm-growth-staging`; apply all migrations 001–004 from tm-seo-monitor/supabase/, then every new migration lands in staging first
- Seed script: one fake local client + one fake ecom client with keywords, prompts, snapshots, GSC rows, and one measured change — enough data that every dashboard section renders
- Staging env vars in Vercel (Preview environment scope): staging Supabase URL/key, DataForSEO sandbox-mode flag (see §3), test CRON_SECRET/passwords

## 2. Preview-deploy workflow
- Vercel already builds previews per branch — formalize it: every module is a branch (`module/meta-collector`, `module/clickup-sync`, ...), preview deploys point at staging Supabase via Preview-scoped env vars
- Definition of done for a module PR: preview URL renders, collector runs green against staging, tests pass, then it enters Tom's daily merge review
- Merge cadence: one batched review/merge session per day (Tom), main auto-deploys to production as today

## 3. Collector test harness
- Add vitest; per-collector test pattern: recorded/mocked platform API responses in `tests/fixtures/`, assert correct rows written to a test schema, assert failure paths write `collector_runs` errors instead of throwing
- `MOCK_APIS=1` env flag makes every collector read fixtures instead of live APIs — used by tests and by staging when burning real API credits is pointless
- CI: GitHub Action runs build + tests on every PR; red CI blocks merge

## 4. Branch/agent conventions (for the parallel streams)
- One agent = one module = one branch = one worktree; no agent touches another module's files
- Schema is the shared spine: migrations are serialized — agents propose migration files, CTO merges them in order before dependent module work starts
- Every module ships with: collector, tests+fixtures, `collector_runs` integration, README section, and its recommendations rules where applicable
- CLAUDE.md at repo root updated with these conventions so every spawned agent inherits them

## 5. First parallel wave (dispatch after §1–4 land)
| Stream | Module | Depends on |
|---|---|---|
| 1 | Job queue + collector_runs + Slack alerts (Phase A.5 core) | nothing — first |
| 2 | Secrets vault + token expiry tracking | stream 1 schema |
| 3 | GA4 collector → conversions_daily | staging only |
| 4 | Meta ads collector → ad_metrics_daily | vault (stream 2) |
| 5 | ClickUp sync (recs → tasks → shipped) | nothing |
| 6 | Microsoft Ads collector | vault |

Streams 1, 3, 5 start day one; 2 follows 1; 4 and 6 follow 2. Tom's role: daily merge session + the external-account tasks only agents can't do (token generation, API applications, ClickUp workspace choice).

## Acceptance
Work order is complete when: a new module branch can go from spawn → green preview against staging → merge without Tom touching env vars, schemas, or deploy config manually — proven by shipping stream 1 through the full path.
