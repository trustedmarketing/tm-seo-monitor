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
