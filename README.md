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
the agent operating brief (`CLAUDE.md`).

### Migrations (authoritative set)

```
supabase/001_core.sql              clients, tracked_keywords, keyword_rankings,
                                   metric_snapshots, gsc_history, tracked_prompts
supabase/002_recs_changes.sql      recommendations + change ledger
supabase/003_prompt_results.sql    per-prompt AI visibility checks
supabase/004_jobs_collector_runs.sql  job queue + collector_runs (Phase A.5)
supabase/005_conversions_daily.sql    conversion/revenue spine (WO-001 stream 3, GA4/Shopify)
supabase/006_secrets_registry.sql     platform_secrets vault registry (WO-001 stream 2)
supabase/007_clickup_sync.sql      clickup_list_id + rec clickup_task_* columns (stream 5)
supabase/008_client_ga4_property.sql  clients.ga4_property_id (integration pass)
supabase/009_meta_ads.sql          ad_platform_accounts + ad_metrics_daily (stream 4)
supabase/010_client_stores.sql     client_stores registry (Shopify revenue collector)
supabase/011_vault_access_rpcs.sql vault read/write via SECURITY DEFINER RPCs
supabase/012_auth_tenancy_rls.sql  multi-tenant identity + per-client RLS (WO-003 stream A)
supabase/seed.sql                  staging demo data (1 local + 1 ecom client)
```

Migrations are the serialized shared spine: agents propose files, the CTO merges
them in order, and every migration lands in **staging first**. 001–002 were
reconstructed from production (which had no tracked migration history).

## Auth and tenancy (WO-003 stream A)

Replaces the two shared passwords with per-user Supabase Auth accounts and
enforces client isolation in the database rather than in application code.

**Shape:** `organization → clients → users`. One organization today; the schema
does not assume that, so a future white-label is not a migration of everything.

**Roles.** `owner` · `pod_lead` · `specialist` (agency) and `client`. Agency users
see every client in their organization; client users see only the clients listed
in `client_users`. The old `admin` password mapped to two different things and is
now split: `/admin` (client config, tokens) is **owner** only, while research and
change-logging are **any agency role**, so a pod lead can work without holding
the keys to client credentials.

**Two ways to reach the database, and the difference matters:**

| | Use for | RLS |
|---|---|---|
| `dbClient()` (`lib/db.ts`) | collectors, cron, agency writes | **bypassed** (service role) |
| `userClient()` (`lib/supabaseServer.ts`) | anything rendering client-visible data | **enforced** |

Rendering a page with `dbClient()` is how RLS gets silently bypassed. Pages use
`userClient()`. No exceptions on client-facing surfaces.

**Every policy routes through one function**, `public.has_client_access(uuid)`,
so the access rule lives in a single place rather than being restated in 16
policies. `platform_secrets` deliberately has RLS on and **no** policy at all:
deny-all for every signed-in user including owners, reachable only by the service
role through the vault RPCs from 011 (autonomy ladder #5).

**Testing.** `tests/staging/rls.test.ts` runs two kinds of check: coverage (via
the read-only `rls_coverage()` function) and behavior (an anonymous PostgREST
client must read nothing). The coverage test is not a hard-coded list — any table
with a `client_id` column and no policy fails the build, which is the failure
mode RLS actually has: a missing policy, not a wrong one.

**Deploy requirements.** Needs `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`
and `NEXT_PUBLIC_SUPABASE_ANON_KEY` set before this ships. `DASHBOARD_PASSWORD`
becomes unused and should be removed; `ADMIN_PASSWORD` stays, because `/api/admin`
still uses it as a machine bearer token, which is not a human login.

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

**Point `SLACK_WEBHOOK_URL` at an INTERNAL channel, never a per-client one.**
It is a single global webhook and every alert in the system is internal ops
(collector failures, critical QC issues, token expiry, SLA breaches, revenue
mismatches). A client-channel webhook would deliver every other client's
revenue and spend figures into that client's channel.

### Alerting channels (`src/lib/notify.ts`)

Accuracy alerts (revenue mismatch, stale data) go through `notify()`, which
sends on Slack **and** email independently — so a single misconfigured channel
can't swallow an alert:

| Env var | Required for email? | Notes |
|---|---|---|
| `RESEND_API_KEY` | Yes | Resend API key |
| `ALERT_EMAIL_TO` | Yes | Comma-separated recipients. **Email is skipped entirely unless BOTH this and the key are set** — a key alone looks configured and sends nothing |
| `ALERT_EMAIL_FROM` | In practice, yes | Defaults to `Growth OS <onboarding@resend.dev>`, which Resend only permits to deliver to the account owner's own address. Set this to an address on a domain verified in Resend, or sends to anyone else are rejected |

`ALERT_EMAIL_FROM`'s default is the trap here: it is technically optional, so
it looks safe to skip, and then email fails with a Resend 403 that nothing
surfaced until `api/ops/alert-check` was added.

**Verify it rather than assuming:** `GET /api/ops/alert-check` (owner-only)
reports which channels are configured; `?send=1` delivers a real test alert and
returns Resend's actual error in `email_error` if it fails; `?ping_heartbeat=1`
proves `HEARTBEAT_URL` resolves without waiting for the next nightly cron.
These alerts only fire when something is wrong, so without this the first
discovery of a misconfigured channel is the moment it stays silent.

### Cron dead-man's switch (`src/lib/heartbeat.ts`)

Everything above alerts from *inside* the daily cron, so none of it can see the
cron failing to run at all — and silence is indistinguishable from health. Set
`HEARTBEAT_URL` to a ping URL from healthchecks.io / Cronitor / Better Stack
(provider-agnostic — it is just a URL to GET). The cron pings it as the last
thing it does, so the ping means "the run reached the end"; the external service
alerts when a ping doesn't arrive. No-op when unset, and the cron response
reports `"heartbeat": "not configured"` rather than claiming the switch is armed.

Env var changes require a **redeploy** on Vercel — they do not apply to
already-built deployments.

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
no log line, ever surfaces a raw token (autonomy ladder #5, `CLAUDE.md`).

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
### Stream 5 — ClickUp sync

Closes the loop from approved recommendation to a ClickUp task to "shipped":

- `supabase/007_clickup_sync.sql` (proposed, awaiting CTO serialize/apply) adds
  `clients.clickup_list_id` and `recommendations.clickup_task_id` /
  `clickup_task_url` / `clickup_synced_at`.
- `src/lib/clickup.ts` — ClickUp REST client (`CLICKUP_TOKEN`). Resilient like
  `src/lib/slack.ts`: no-ops + logs when the token is unset, try/catch around the
  call. `MOCK_APIS=1` short-circuits to a deterministic fake task, same convention
  as the DataForSEO fixtures. Every task it creates is prefixed
  `[STAGING TEST] ` — required so staging syncs are never mistaken for a real,
  client-authorized ClickUp task.
- `src/lib/clickupSync.ts` — standalone, db-as-param (unit-testable):
  `syncApprovedRecs(db, client)` creates a ClickUp task for each `approved` rec
  with no `clickup_task_id` yet and records a `collector_runs` row (module
  `clickup_sync`); `markShippedFromClickup(db, recId, changeTitle)` is the
  completion path — mirrors the manual "mark shipped" flow in
  `src/app/api/track/route.ts` but tags the `changes` ledger row
  `source: 'clickup'`.
- Not wired into the cron route or admin route yet. The real target is the Salty
  Dog ClickUp space (workspace `90141342552`); the CTO still needs to resolve the
  Salty Dog list id, provide `CLICKUP_TOKEN`, and decide where `syncApprovedRecs`
  gets called from (cron tick vs. on-approve).

New env var: `CLICKUP_TOKEN` (ClickUp API token — required only outside
`MOCK_APIS=1`).

### Stream 4 — Meta ads

Paid-media spine (plan §4): ad-level Meta spend/conversions/revenue joins the
same measurement loop as organic (`metric_snapshots`) and conversions
(`conversions_daily`).

```
supabase/009_meta_ads.sql          ad_platform_accounts + ad_metrics_daily (awaits CTO serialize/apply)
src/lib/meta.ts                    Meta Marketing (Graph) API client
src/lib/metaAdsCollector.ts        collectMetaAds(db, client) — standalone collector
tests/fixtures/meta/ad_insights.json  recorded ad-level insights fixture
```

- `src/lib/meta.ts` — `fetchAdInsights(accessToken, adAccountId, days = 28)` GETs
  `https://graph.facebook.com/v21.0/{adAccountId}/insights` with `level=ad`,
  `time_increment=1` (one row per ad per day), and a `time_range` covering
  `days`, paginating via `paging.next` until exhausted. Maps Meta's `actions` /
  `action_values` arrays into `conversions` / `revenue` — purchase and lead
  action types (`purchase`, `omni_purchase`, `offsite_conversion.fb_pixel_purchase`,
  `lead`, `onsite_conversion.lead_grouped`, ...) are summed by substring match.
  Honors `MOCK_APIS=1` (reads raw insight rows from
  `tests/fixtures/meta/ad_insights.json` and runs them through the same mapping,
  so the conversions/revenue derivation is exercised in tests too). Never logs
  the access token — it's only ever used as a query param on the outgoing request.
- `src/lib/metaAdsCollector.ts` — standalone `collectMetaAds(db, client, days = 28)`.
  Looks up the client's `meta` row in `ad_platform_accounts`; with none, records a
  `skipped` `collector_runs` row and returns (no throw). Resolves the access
  token via `readSecret(db, account.auth_ref)` (Vault, stream 2) or falls back to
  `process.env.META_ACCESS_TOKEN`; with neither present and `MOCK_APIS` off, also
  records `skipped`. Calls `fetchAdInsights` and upserts by hand (select →
  update-or-insert, matching `lib/conversionsCollector.ts`'s pattern) into
  `ad_metrics_daily` on `(client_id, platform, date, ad_id)`.
- Migration `supabase/009_meta_ads.sql` awaits CTO serialize/apply to staging —
  proposed only, not applied. Goes live once: 009 is merged, a row is seeded
  in `ad_platform_accounts` per client (platform `'meta'`, their ad account id),
  a Meta system-user access token is stored via `storeSecret(db, { clientId,
  platform: 'meta', value, expiresAt })` (stream 2), and the CTO wires
  `collectMetaAds` into `src/app/api/cron/collect/route.ts`.

### Google Ads collector

Reuses the existing paid-media spine from Stream 4 — no new migration. Google
ad data lands in the same `ad_metrics_daily` / `ad_platform_accounts` tables
as Meta, just with `platform='google_ads'` (account `external_id` = the
customer id, e.g. `1234567890`).

```
src/lib/googleAds.ts               Google Ads API (GAQL searchStream) client
src/lib/googleAdsCollector.ts      collectGoogleAds(db, client) — standalone collector
tests/fixtures/google/ad_metrics.json  recorded GAQL-shaped rows fixture
```

- `src/lib/googleAds.ts` — `fetchAdMetrics(auth, customerId, days = 28)` POSTs
  `https://googleads.googleapis.com/v18/customers/{customerId}/googleAds:searchStream`
  with headers `Authorization: Bearer {accessToken}`, `developer-token`,
  `login-customer-id`, and a GAQL body selecting `segments.date`, `campaign.id`,
  `campaign.name`, `ad_group.id`, `ad_group_ad.ad.id`, and the core metrics
  over the last `days` days. Maps `metrics.cost_micros` → `spend` (÷1,000,000 —
  Google Ads reports everything in micros of the account currency) and
  `ad_group.id` → `adset_id`. `auth` is a creds bundle
  `{ accessToken, developerToken, loginCustomerId }`. Honors `MOCK_APIS=1`
  (reads raw GAQL-shaped rows from `tests/fixtures/google/ad_metrics.json` and
  runs them through the same mapping, so the micros→spend conversion is
  exercised in tests too). Never logs any credential — they're only ever used
  as outgoing request headers.
- `src/lib/googleAdsCollector.ts` — standalone `collectGoogleAds(db, client, days = 28)`,
  wrapped in `tracked()`. Looks up the client's `google_ads` row in
  `ad_platform_accounts`; with none, records a `collector_runs` row and
  returns 0 (no throw). Resolves the creds bundle (a JSON string) via
  `readSecret(db, account.auth_ref)` (Vault, stream 2) or falls back to
  `process.env.GOOGLE_ADS_CREDS`; with neither present/valid and `MOCK_APIS`
  off, also records a graceful 0-row run. Calls `fetchAdMetrics` and upserts
  by hand (select → update-or-insert, matching `lib/metaAdsCollector.ts`'s
  pattern) into `ad_metrics_daily` on `(client_id, platform, date, ad_id)`
  with `platform = 'google_ads'`.
- **No migration** — reuses `supabase/009_meta_ads.sql`'s tables as-is.
- **`collectGoogleAds` is wired into `src/app/api/cron/collect/route.ts`** and
  `resolveAuth()` mints an access token per run, so the per-client creds bundle
  above is now the *override* path, not the main one. The production path is
  portfolio-level and has three parts, **all three required**:

  | | Where it lives | Set via |
  |---|---|---|
  | `google_ads_oauth` | Supabase Vault | `/dashboard/secrets` ← `node scripts/google-oauth.mjs` |
  | `google_ads_developer_token` | Supabase Vault | `/dashboard/secrets` ← MCC → Tools → API Center |
  | `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Vercel env | the MCC id, digits only. **Needs a redeploy** |

  Miss any one and every client skips. The per-client part is only the customer
  id in `ad_platform_accounts.external_id`, and the account must be linked under
  the MCC first.

- **`GET /api/ops/google-ads-check?domain=…`** (owner-only) walks those gates in
  the collector's own order and stops at the first unmet one, so `failed_at`
  names a single next step. On a live failure, Google's own message comes back
  in `google_says` — a developer token not approved for production, a customer
  not linked under this MCC, and a nonexistent customer id are three different
  fixes that are indistinguishable without it. Refuses to answer under
  `MOCK_APIS=1` rather than returning a green that is really a fixture, reports
  `is_test_account` (synthetic metrics forever), and inlines the SOP's
  `collector_runs` query as `last_run`. Credentials report presence and length
  only. Its two pure pieces are `src/lib/googleAdsCheck.ts`
  (`tests/unit/googleAdsCheck.test.ts`).

- **The Explorer→Basic developer token upgrade** is still unapplied-for. It
  governs daily *volume*, not first data — it was carried as the blocker for
  four weeks while the gates above were the actual cause.

- ⚠️ **`API_VERSION` sunsets on a calendar.** Google retires Ads API versions on
  a rolling schedule (~yearly support). A sunset version does not warn or
  degrade: the path stops routing and `googleapis.com` answers an **HTML 404**,
  which every caller wraps as `404 Not Found` and reads like a bad customer id.
  `v18` died that way and took the collector, the execution adapter *and* the
  ops check with it. It now lives as one exported constant in
  `src/lib/googleAds.ts`, with a test that fails if a second copy appears.

  **Find the live versions by probing unauthenticated — no credentials needed.**
  A live version answers JSON `UNAUTHENTICATED`; a dead one answers HTML 404:

  ```
  curl -s -X POST "https://googleads.googleapis.com/vNN/customers/1234567890/googleAds:searchStream" \
       -H "Content-Type: application/json" -d '{"query":"SELECT customer.id FROM customer"}' | head -c 40
  ```

  Bump `API_VERSION`, run the suite, deploy. `google-ads-check` reports
  `api_version` on every answer and names this failure `api_version_sunset`.

### Shopify revenue collector

Revenue ground truth (plan §4, `CLAUDE.md`): ad platforms
over-attribute — each claims the same orders — so this collector writes
Shopify's actual orders/dollars into `conversions_daily(source='shopify')`,
letting the platform compute honest blended MER (revenue ÷ ad spend) instead of
trusting platform ROAS. Reuses `conversions_daily` (migration 005); no new
revenue table.

```
supabase/010_client_stores.sql     client_stores registry (awaits CTO serialize/apply)
src/lib/shopify.ts                 Shopify Admin API client (client-credentials + GraphQL)
src/lib/shopifyCollector.ts        collectShopify(db, client) — standalone collector
tests/fixtures/shopify/daily_sales.json  aggregated daily sales fixture
```

- **Auth** is the client-credentials grant, not the old `shpat_` install token.
  A Shopify custom app gives a durable Client ID + `shpss_` client secret; every
  run mints a fresh ~24h `shpat_` access token via
  `POST https://{shopDomain}/admin/oauth/access_token` with
  `{ client_id, client_secret, grant_type: "client_credentials" }`. There is no
  long-lived token to store — only `client_id` + the vaulted secret are durable.
- `src/lib/shopify.ts` — `mintToken(shopDomain, clientId, clientSecret)` mints
  the access token (never logs the secret or the token); `fetchDailySales(shopDomain,
  token, days = 28)` paginates the Admin GraphQL `orders` connection
  (`https://{shopDomain}/admin/api/2025-01/graphql.json`, header
  `X-Shopify-Access-Token`) via `pageInfo.hasNextPage`/`endCursor`, filtered to
  `created_at:>=SINCE created_at:<=UNTIL`, and aggregates by calendar date from
  `createdAt`: `revenue = sum(totalPriceSet.shopMoney.amount)`,
  `orders = order count`. ShopifyQL's Admin GraphQL is deprecated and
  deliberately not used. Both functions honor `MOCK_APIS=1`
  (`fetchDailySales` reads `tests/fixtures/shopify/daily_sales.json`;
  `mintToken` short-circuits to a fixed mock token with no network call).
- `src/lib/shopifyCollector.ts` — standalone `collectShopify(db, client, days = 28)`,
  wrapped in `tracked()`. Looks up the client's `shopify` row in
  `client_stores`; with none, or with `api_client_id`/`auth_ref` missing, or
  with no vault secret found at that `auth_ref`, records a `collector_runs`
  row and returns 0 (no throw). Otherwise resolves the client secret via
  `readSecret(db, auth_ref)` (Vault, stream 2), mints a token, fetches daily
  sales, and upserts by hand (select → update-or-insert, matching
  `lib/conversionsCollector.ts`'s pattern) into `conversions_daily` on
  `(client_id, date, source)` with `source = 'shopify'`.
- Migration `supabase/010_client_stores.sql` awaits CTO serialize/apply to
  staging — proposed only, not applied. Goes live once: 010 is merged, a row
  is seeded in `client_stores` per client (platform `'shopify'`, their
  `{shop}.myshopify.com` domain, the custom app's Client ID as
  `api_client_id`), the app's `shpss_` client secret is stored via
  `storeSecret(db, { clientId, platform: 'shopify', value, expiresAt })`
  (stream 2), and the CTO wires `collectShopify` into
  `src/app/api/cron/collect/route.ts`.

### Stream 6 — Microsoft/Bing ads

Paid-media spine (plan §4), same shape as stream 4: ad-level Microsoft
Advertising spend/conversions/revenue joins the same measurement loop as
Meta, organic (`metric_snapshots`), and conversions (`conversions_daily`).
**Reuses the existing `ad_platform_accounts` + `ad_metrics_daily` tables from
`supabase/009_meta_ads.sql`** with `platform = 'microsoft'` — no new
migration.

```
src/lib/microsoftAds.ts               Microsoft Advertising Reporting API client
src/lib/microsoftAdsCollector.ts      collectMicrosoftAds(db, client) — standalone collector
tests/fixtures/microsoft/ad_metrics.json  recorded ad-level report fixture
```

- `src/lib/microsoftAds.ts` — `fetchAdMetrics(auth, accountId, days = 28)`.
  Microsoft Advertising auth is a three-part bundle — developer token + OAuth2
  access token + customer id — so it's passed as a single `auth` object
  (`{ developerToken, accessToken, customerId }`) rather than a bare token
  string. Microsoft's real Reporting API is an async submit → poll →
  download-CSV flow; this client models it as a single authenticated request
  against Microsoft's REST reporting surface (`AdPerformanceReport`,
  `Aggregation: "Daily"`), matching `lib/meta.ts`'s synchronous single-call
  shape — sufficient for this collector's fixture-driven, unit-tested scope.
  Maps report rows (`TimePeriod`, `CampaignId`, `CampaignName`, `AdGroupId`,
  `AdId`, `Impressions`, `Clicks`, `Spend`, `Conversions`, `Revenue`) into
  `ad_metrics_daily`-shaped rows — `AdGroupId` (Microsoft's ad group, the
  closest analog to Meta's adset) maps onto the shared `adset_id` column.
  Honors `MOCK_APIS=1` (reads raw report rows from
  `tests/fixtures/microsoft/ad_metrics.json` and runs them through the same
  mapping). Never logs the developer token or access token.
- `src/lib/microsoftAdsCollector.ts` — standalone `collectMicrosoftAds(db,
  client, days = 28)`, wrapped in `tracked()`. Looks up the client's
  `microsoft` row in `ad_platform_accounts`; with none, records a
  `collector_runs` row and returns 0 (no throw). Resolves the credential
  bundle as a JSON string via `readSecret(db, account.auth_ref)` (Vault,
  stream 2) or falls back to `process.env.MICROSOFT_ADS_CREDS`; with neither
  present and `MOCK_APIS` off, also records and returns 0. Calls
  `fetchAdMetrics` and upserts by hand (select → update-or-insert, matching
  `lib/metaAdsCollector.ts`'s pattern) into `ad_metrics_daily` on
  `(client_id, platform, date, ad_id)` with `platform = 'microsoft'`.
- Goes live once: a row is seeded in `ad_platform_accounts` per client
  (platform `'microsoft'`, their Microsoft Advertising account id as
  `external_id`), the developer-token + OAuth bundle is stored as a JSON
  string via `storeSecret(db, { clientId, platform: 'microsoft', value:
  JSON.stringify({ developerToken, accessToken, customerId }), expiresAt })`
  (stream 2), and the CTO wires `collectMicrosoftAds` into
  `src/app/api/cron/collect/route.ts`.

New env var: `MICROSOFT_ADS_CREDS` — JSON string
`{ "developerToken": "...", "accessToken": "...", "customerId": "..." }`
(env fallback used only outside `MOCK_APIS=1` when an account has no
`auth_ref`; not required otherwise).
