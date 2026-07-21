-- seed.sql — staging demo data. NOT for production; applied to tm-growth-staging only.
--
-- One local-service client + one national-ecom client, with ~30 days of history
-- across every table so every dashboard section renders. Idempotent: re-running
-- deletes the two seed clients (cascading to all children) and rebuilds them.

begin;

delete from clients where domain in ('sharkey-air.example', 'salty-dog.example');

-- ── Clients ──────────────────────────────────────────────────────────
insert into clients (id, name, domain, tier, location_code, language_code,
  core_frequency, serp_frequency, crawl_frequency, active, gsc_property,
  last_core_at, last_serp_at, last_crawl_at, ga4_property_id, clickup_list_id)
values
  ('11111111-1111-1111-1111-111111111111',
   'Sharkey Air (Staging)', 'sharkey-air.example', 'Dominate', 2840, 'en',
   'weekly', 'daily', 'monthly', true, 'sc-domain:sharkey-air.example',
   now() - interval '1 day', now() - interval '6 hours', now() - interval '10 days',
   'properties/451112233', 'staging-list-sharkey'),
  ('22222222-2222-2222-2222-222222222222',
   'Salty Dog Boat Care (Staging)', 'salty-dog.example', 'Momentum', 2840, 'en',
   'weekly', 'weekly', 'monthly', true, 'https://salty-dog.example/',
   now() - interval '2 days', now() - interval '2 days', now() - interval '20 days',
   'properties/451445566', 'staging-list-salty');

-- ── Keywords ─────────────────────────────────────────────────────────
insert into tracked_keywords (client_id, keyword) values
  ('11111111-1111-1111-1111-111111111111', 'ac repair stuart fl'),
  ('11111111-1111-1111-1111-111111111111', 'air conditioning installation martin county'),
  ('11111111-1111-1111-1111-111111111111', 'emergency hvac stuart'),
  ('22222222-2222-2222-2222-222222222222', 'best salt remover for boats'),
  ('22222222-2222-2222-2222-222222222222', 'boat cleaning kit'),
  ('22222222-2222-2222-2222-222222222222', 'marine salt wash concentrate');

-- ── Prompts ──────────────────────────────────────────────────────────
insert into tracked_prompts (client_id, prompt) values
  ('11111111-1111-1111-1111-111111111111', 'best ac repair company in stuart fl'),
  ('11111111-1111-1111-1111-111111111111', 'who does emergency air conditioning repair in martin county'),
  ('22222222-2222-2222-2222-222222222222', 'best salt remover for boats'),
  ('22222222-2222-2222-2222-222222222222', 'how to remove salt from a boat after saltwater');

-- ── Ad platform accounts (Meta) — MOCK: no token needed under MOCK_APIS=1 ─
insert into ad_platform_accounts (client_id, platform, external_id) values
  ('11111111-1111-1111-1111-111111111111', 'meta', 'act_1110001110001'),
  ('22222222-2222-2222-2222-222222222222', 'meta', 'act_2220002220002');

-- ── Keyword rankings: 30 days, positions improving toward the present ─
insert into keyword_rankings (client_id, keyword_id, checked_at, position, url)
select k.client_id, k.id,
       (current_date - g)::timestamptz + interval '10 hours',
       greatest(1, 3 + (g / 6))::int,
       'https://' || c.domain || '/lp'
from tracked_keywords k
join clients c on c.id = k.client_id
cross join generate_series(0, 29) g
where c.domain in ('sharkey-air.example', 'salty-dog.example');

-- ── Prompt results: 30 days, mention/citation rising recently ─────────
insert into prompt_results (client_id, prompt_id, checked_at, mentioned, cited)
select p.client_id, p.id,
       (current_date - g)::timestamptz + interval '11 hours',
       (g < 20),
       (g < 8)
from tracked_prompts p
join clients c on c.id = p.client_id
cross join generate_series(0, 29) g
where c.domain in ('sharkey-air.example', 'salty-dog.example');

-- ── Metric snapshots: 5 weekly points, trending up toward present ─────
insert into metric_snapshots (client_id, captured_at, organic_traffic, organic_keywords,
  backlinks, referring_domains, site_health, visibility, ai_visibility, ai_mentions)
select '11111111-1111-1111-1111-111111111111'::uuid,
       (current_date - (w * 7))::timestamptz + interval '10 hours',
       900 + (4 - w) * 80, 260 + (4 - w) * 12, 140 + (4 - w) * 6, 55 + (4 - w) * 3,
       round((82 + (4 - w) * 1.5)::numeric, 1), round((44 + (4 - w) * 4)::numeric, 1),
       round((30 + (4 - w) * 7)::numeric, 1), (2 + (4 - w))::int
from generate_series(0, 4) w
union all
select '22222222-2222-2222-2222-222222222222'::uuid,
       (current_date - (w * 7))::timestamptz + interval '10 hours',
       4200 + (4 - w) * 300, 520 + (4 - w) * 20, 780 + (4 - w) * 25, 210 + (4 - w) * 8,
       round((76 + (4 - w) * 2)::numeric, 1), round((38 + (4 - w) * 5)::numeric, 1),
       round((22 + (4 - w) * 6)::numeric, 1), (1 + (4 - w))::int
from generate_series(0, 4) w;

-- ── GSC history: 30 daily rows per client, clicks growing toward present
insert into gsc_history (client_id, date, clicks, impressions, ctr, position)
select '11111111-1111-1111-1111-111111111111'::uuid,
       current_date - g,
       greatest(0, 18 + (29 - g) / 2 + case when g % 7 in (0, 6) then -4 else 2 end)::int,
       greatest(1, 640 + (29 - g) * 6 + (g % 5) * 10)::int,
       round((0.030 - g::numeric / 4000), 4),
       round((8.5 - (29 - g) * 0.08)::numeric, 1)
from generate_series(0, 29) g
union all
select '22222222-2222-2222-2222-222222222222'::uuid,
       current_date - g,
       greatest(0, 60 + (29 - g) + case when g % 7 in (0, 6) then -10 else 5 end)::int,
       greatest(1, 3200 + (29 - g) * 30 + (g % 5) * 40)::int,
       round((0.022 - g::numeric / 6000), 4),
       round((11.0 - (29 - g) * 0.06)::numeric, 1)
from generate_series(0, 29) g;

-- ── Recommendations ──────────────────────────────────────────────────
insert into recommendations (id, client_id, rule_key, severity, category, title, detail, status,
  shipped_at, measured_at, created_at, updated_at)
values
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'schema_localbusiness_missing', 'high', 'technical',
   'Add LocalBusiness schema to the Stuart location page',
   'The primary service-area page has no LocalBusiness JSON-LD. Adding it improves local pack eligibility and AI extractability.',
   'validated', now() - interval '30 days', now() - interval '2 days',
   now() - interval '45 days', now() - interval '2 days'),
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
   'gbp_review_velocity_low', 'medium', 'local',
   'Lift review velocity — under 2 new reviews/month',
   'Review velocity is a top-three local ranking signal. Set up a post-service review request flow.',
   'approved', null, null, now() - interval '5 days', now() - interval '5 days'),
  ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222',
   'thin_product_copy', 'high', 'content',
   'Expand thin copy on the salt-wash product page',
   'The top revenue product page is under 150 words. Buyers and AI answers both reward answer-first depth here.',
   'open', null, null, now() - interval '3 days', now() - interval '3 days');

-- ── One measured change (the validated Sharkey rec that shipped) ──────
insert into changes (client_id, recommendation_id, title, description, changed_at,
  affected_keywords, source, verdict, metrics, measured_at, created_at)
values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333',
   'Shipped LocalBusiness schema on Stuart page',
   'Added LocalBusiness + GeoCoordinates JSON-LD to /stuart-ac-repair.',
   current_date - 30,
   array['ac repair stuart fl', 'emergency hvac stuart'],
   'manual', 'validated',
   '{"clicks_before": 210, "clicks_after": 288, "delta_pct": 37.1, "window_days": 28}'::jsonb,
   now() - interval '2 days', now() - interval '30 days');

commit;
