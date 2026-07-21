# TM SEO Monitor

Semrush-style client monitoring on DataForSEO + Supabase, built to merge
into the existing reports.trustedmarketing.com Next.js app. No n8n needed:
a Vercel cron collects, Supabase stores, a dashboard page reads.

## What's here

```
supabase/schema.sql                    → run once in Supabase SQL editor
src/lib/dataforseo.ts                  → API client + visibility calc
src/app/api/cron/collect/route.ts      → daily cron, respects per-client frequency
src/app/dashboard/page.tsx             → TM-branded dashboard (server component)
src/styles/tm-tokens.css               → tokens trimmed from the design system
vercel.json                            → cron schedule (10:00 UTC daily = 6am ET)
preview/dashboard-preview.html         → static preview with mock data
```

## Setup (30 min)

1. **Supabase**: run `supabase/schema.sql`. Seed clients:
   ```sql
   insert into clients (name, domain, tier, location_code) values
   ('Sharkey Air', 'sharkeyair.com', 'Momentum', 1015116), -- example FL city code
   ('Replay Club', 'replayclub.com', 'Dominate', 2840);
   ```
   Look up city-level `location_code`s with DataForSEO's `serp_locations`
   endpoint so local clients are tracked in their actual market
   (e.g. Martin County targeting like the Semrush project used).

2. **Keywords**: insert each client's tracked list into `tracked_keywords`.
   Start with the same lists you had in Semrush position tracking.

3. **Env vars** (Vercel project settings):
   ```
   DATAFORSEO_LOGIN=
   DATAFORSEO_PASSWORD=
   SUPABASE_URL=
   SUPABASE_SERVICE_ROLE_KEY=
   CRON_SECRET=            (any long random string)
   ```

4. **Merge** `src/` into the reports repo, copy the four font TTFs from the
   design-system handoff into `public/fonts/`, add `@supabase/supabase-js`,
   deploy. Vercel picks up `vercel.json` crons automatically.

5. **First run**: hit `/api/cron/collect` manually with the bearer secret
   to backfill the first snapshot. Deltas appear from the second run on.

## Changing frequency

Per client, per metric group, no redeploy:

```sql
update clients set serp_frequency = 'daily' where domain = 'replayclub.com';
update clients set crawl_frequency = 'monthly' where tier = 'Consistency';
```

`paused` stops a group entirely. The daily cron only runs what's due.

## Cost model (per client / month, approx)

| Metric group        | Weekly cadence | Daily cadence |
|---------------------|----------------|---------------|
| Traffic + keywords  | ~$0.05         | ~$0.35        |
| Backlinks summary   | ~$0.10         | ~$0.70        |
| SERP × 50 keywords  | ~$2.00         | ~$14.00       |
| On-page crawl (300p)| ~$0.40/mo      | n/a           |

13 clients, everything weekly ≈ $30–35/mo total. The SERP line is the
lever; that's why frequency is a per-client column.

## Notes

- Vercel hobby caps functions at 60s. 13 clients × 50 keywords of live
  SERP calls will exceed that. Either stay on Pro (maxDuration 300) or
  switch `serpPosition` to DataForSEO's task-based queue (also ~70% cheaper).
- `maxDuration` is set to 300 assuming Pro.
- AI visibility is stubbed. DataForSEO's AI Optimization endpoints (LLM
  mentions, ChatGPT scraper) map to it; wire `aiVisibility()` when ready.
- RLS is locked to service role. If clients ever get logins, add per-client
  read policies keyed to auth.

## v2 additions: admin UI, keyword suggestions, GSC history

New files:
```
supabase/002_admin_gsc.sql        → run after schema.sql
src/lib/gsc.ts                    → Search Console client (service account)
src/app/api/admin/route.ts        → admin API (clients, keywords, suggest, backfill)
src/app/admin/page.tsx            → admin UI at /admin
```

New env vars:
```
ADMIN_PASSWORD                → gates /admin and the admin API
GOOGLE_SERVICE_ACCOUNT_JSON   → full service-account JSON, single line
```

New dependency: `npm install google-auth-library`

### Google Search Console setup (once, ~10 min)
1. console.cloud.google.com → create project "tm-seo-monitor"
2. APIs & Services → enable "Google Search Console API"
3. IAM → Service Accounts → create one (no roles needed) → Keys →
   Add key → JSON. Paste the file's contents into
   GOOGLE_SERVICE_ACCOUNT_JSON (single line).
4. For each client: open their Search Console property → Settings →
   Users and permissions → Add the service account's email
   (…@…iam.gserviceaccount.com) as a Full user.
5. In /admin, set the client's GSC property exactly as Search Console
   shows it: `sc-domain:client.com` or `https://www.client.com/`.

### Workflow per client
1. /admin → Add client (name, domain, tier, GSC property)
2. Backfill GSC history → up to 16 months of daily clicks/impressions/position
3. Suggest keywords → merged list from GSC top queries + DataForSEO
   ranked keywords; click to add. Paste your old Semrush lists in the
   textarea too.
4. Set frequencies per tier. Done — next cron picks it up.

Note: /admin ships with password-gate auth, which is fine while it's
internal-only. If the reports domain ever exposes client logins, move
it behind real auth (Supabase Auth or Vercel's protection).

## Growth OS enabling layer (WO-001)

Parallel-build foundation so agent-built modules are self-verifying. See
`docs/tm-growth-os-plan.md`, `docs/wo-001-parallel-build-enabling-layer.md`, and
the agent operating brief (`docs/CLAUDE-monitor-draft.md`).

### Migrations (authoritative set)

```
supabase/001_core.sql              clients, tracked_keywords, keyword_rankings,
                                   metric_snapshots, gsc_history, tracked_prompts
supabase/002_recs_changes.sql      recommendations + change ledger
supabase/003_prompt_results.sql    per-prompt AI visibility checks
supabase/004_jobs_collector_runs.sql  job queue + collector_runs (Phase A.5)
supabase/005_conversions_daily.sql    conversion/revenue spine (WO-001 stream 3, GA4/Shopify)
supabase/seed.sql                  staging demo data (1 local + 1 ecom client)
```

Migrations are the serialized shared spine: agents propose files, the CTO merges
them in order, and every migration lands in **staging first**. 001–002 were
reconstructed from production (which had no tracked migration history).

### Staging

`tm-growth-staging` (Supabase project `wwgcpveakcyebfmtdwyt`) mirrors prod's
schema and is seeded with two fake clients so every dashboard section renders.
Preview deploys point here via Preview-scoped env vars.

### Testing

```
npm test            unit tests (in-memory fakes + fixtures, no creds) — CI gate
npm run test:staging  live collector run against staging (loads .env.staging.local)
```

- `MOCK_APIS=1` makes every collector read `tests/fixtures/` instead of live
  DataForSEO/GSC — used by tests and by staging so no credits are spent proving
  plumbing.
- `tests/helpers/fakeDb.ts` is a reusable in-memory Supabase stand-in for module
  unit tests.
- CI (`.github/workflows/ci.yml`) runs typecheck + unit tests + build on every PR.

### Job queue + collector_runs (stream 1)

- `collector_runs` records one row per module execution (status, duration, error).
  The collector records failures instead of throwing, so one module failing never
  sinks the batch or hides behind a 200. Failures also push to Slack
  (`SLACK_WEBHOOK_URL`, no-op if unset).
- `src/lib/jobs.ts` is the durable work queue (retries + idempotency) so
  collection fans out as units rather than depending on one 300s cron request.

New env var: `SLACK_WEBHOOK_URL` (internal ops alerts — collector failures + staleness).

### Stream 3 — GA4 conversions

- `src/lib/ga4.ts` — GA4 Data API client via the same service-account model as
  `lib/gsc.ts` (env `GOOGLE_SERVICE_ACCOUNT_JSON`, scope
  `analytics.readonly`). Grant the service account Viewer on each client's GA4
  property (Admin → Property access management). Exports
  `dailyConversions(propertyId, days = 28)`, which queries `runReport` for
  date × channel sessions/conversions/revenue and honors `MOCK_APIS=1`
  (reads `tests/fixtures/ga4/daily_conversions.json`).
- `src/lib/conversionsCollector.ts` — standalone `collectConversions(db, client)`
  that calls `dailyConversions`, upserts into `conversions_daily` (by hand —
  select-then-update-or-insert, matching `lib/recSync.ts`'s pattern — on
  `client_id, date, source`), and records a `collector_runs` row via
  `tracked()`. Not wired into the cron route; the CTO adds a `ga4_property_id`
  column to `clients` and calls it from `app/api/cron/collect/route.ts` once
  migration 005 is merged and per-client GA4 access is granted.
- Migration `supabase/005_conversions_daily.sql` awaits CTO serialize/apply to
  staging — proposed only, not applied.
### Stream 2 — Secrets vault + token expiry tracking

Per-client platform tokens (Meta, Google Ads, Microsoft, ClickUp, etc.) move OUT
of env vars into Supabase Vault (encrypted at rest). `platform_secrets` is the
tracking registry only — the secret value itself lives in `vault.secrets` /
`vault.decrypted_secrets`, referenced by `auth_ref`. Nothing client-facing, and
no log line, ever surfaces a raw token (autonomy ladder #5, `docs/CLAUDE-monitor-draft.md`).

```
supabase/006_secrets_registry.sql   platform_secrets registry (awaits CTO serialize/apply)
src/lib/vault.ts                    storeSecret / readSecret / listExpiring
src/lib/tokenExpiry.ts              checkTokenExpiry() — Slack alert + collector_runs
```

- `storeSecret(db, { clientId, platform, value, expiresAt })` writes the value to
  Supabase Vault via `vault.create_secret`, then upserts a `platform_secrets` row
  keyed by `(client_id, platform)` with the resulting `auth_ref`.
- `readSecret(db, authRef)` reads the plaintext back from `vault.decrypted_secrets`
  — the only function in the module allowed to return a raw value.
- `listExpiring(db, withinDays = 14)` returns active registry rows expiring
  within the window (including already-expired ones a missed check would have
  caught).
- `checkTokenExpiry(db)` calls `listExpiring`, alerts Slack (reusing `slackAlert`)
  when tokens are due, and always records a `collector_runs` row (module
  `token_expiry`) — same never-throw contract as the rest of the collector.
- Future `ad_platform_accounts` (streams 4 & 6) will reference a client's active
  token via `platform_secrets.auth_ref` rather than holding it directly.

Registry-only logic (`upsertSecretRegistry`, `listExpiring`) is unit-tested via
`createFakeDb` with no live Vault dependency; `storeSecret`/`readSecret` need a
real Vault RPC (`vault.create_secret`, `vault.decrypted_secrets`) and are
exercised against staging, not in `npm test`.
