-- Trusted Marketing SEO Monitor — Supabase schema
-- Run in the Supabase SQL editor. Postgres 15+.

-- ── Clients ──────────────────────────────────────────────────────
create type tracking_frequency as enum ('daily', 'weekly', 'biweekly', 'monthly', 'paused');

create table clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  domain        text not null unique,          -- bare domain, e.g. sharkeyair.com
  tier          text,                          -- Consistency | Momentum | Dominate
  location_code integer not null default 2840, -- DataForSEO location (2840 = US); use city codes for local
  language_code text not null default 'en',
  -- per-metric-group frequency. Change a row, cron picks it up next morning.
  core_frequency  tracking_frequency not null default 'weekly',  -- traffic/keywords/backlinks
  serp_frequency  tracking_frequency not null default 'weekly',  -- rank tracking → visibility %
  crawl_frequency tracking_frequency not null default 'monthly', -- on-page site health
  last_core_at  timestamptz,
  last_serp_at  timestamptz,
  last_crawl_at timestamptz,
  onpage_task_id text,                         -- pending DataForSEO crawl task, picked up next run
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ── Tracked keywords (drives visibility %) ───────────────────────
create table tracked_keywords (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  keyword    text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, keyword)
);

-- ── Per-keyword rank checks ──────────────────────────────────────
create table keyword_rankings (
  id          bigint generated always as identity primary key,
  client_id   uuid not null references clients(id) on delete cascade,
  keyword_id  uuid not null references tracked_keywords(id) on delete cascade,
  checked_at  timestamptz not null default now(),
  position    integer,                         -- null = not in top 100
  url         text
);
create index on keyword_rankings (client_id, checked_at desc);

-- ── Metric snapshots (one row per client per collection run) ─────
create table metric_snapshots (
  id               bigint generated always as identity primary key,
  client_id        uuid not null references clients(id) on delete cascade,
  captured_at      timestamptz not null default now(),
  organic_traffic  integer,                    -- Labs ETV estimate
  organic_keywords integer,
  backlinks        integer,
  referring_domains integer,
  site_health      numeric(5,2),               -- OnPage score 0–100
  visibility       numeric(6,2),               -- computed CTR-weighted, 0–100
  ai_visibility    numeric(6,2),               -- phase 2
  ai_mentions      integer                     -- phase 2
);
create index on metric_snapshots (client_id, captured_at desc);

-- ── Latest snapshot + delta vs previous, per client ──────────────
create or replace view client_dashboard as
with ranked as (
  select ms.*,
         row_number() over (partition by client_id order by captured_at desc) as rn
  from metric_snapshots ms
)
select
  c.id, c.name, c.domain, c.tier,
  cur.captured_at,
  cur.organic_traffic,  cur.organic_traffic  - prev.organic_traffic  as d_traffic,
  cur.organic_keywords, cur.organic_keywords - prev.organic_keywords as d_keywords,
  cur.backlinks,        cur.backlinks        - prev.backlinks        as d_backlinks,
  cur.site_health,      cur.site_health      - prev.site_health      as d_health,
  cur.visibility,       cur.visibility       - prev.visibility       as d_visibility,
  cur.ai_visibility,    cur.ai_mentions
from clients c
left join ranked cur  on cur.client_id  = c.id and cur.rn = 1
left join ranked prev on prev.client_id = c.id and prev.rn = 2
where c.active;

-- ── RLS: service role only (dashboard reads server-side) ─────────
alter table clients          enable row level security;
alter table tracked_keywords enable row level security;
alter table keyword_rankings enable row level security;
alter table metric_snapshots enable row level security;
-- No public policies on purpose. The Next.js server uses the service
-- role key; nothing is readable from the browser directly.
