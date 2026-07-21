-- 001_core.sql — core schema: clients + tracking tables. Run first.
--
-- Reconstructed from production (project xelweikfciqakagkerat) on 2026-07-21.
-- Production carried no tracked migration history and the repo had only committed
-- 003, so this baseline reproduces prod exactly (columns, defaults, enums,
-- indexes, unique constraints, FK cascade rules, RLS-enabled with no policies —
-- the server uses the service-role key, which bypasses RLS).

-- Enum: tracking cadence per collection module.
do $$ begin
  create type tracking_frequency as enum ('daily','weekly','biweekly','monthly','paused');
exception when duplicate_object then null; end $$;

-- Clients — the portfolio spine. Everything joins to this.
create table if not exists clients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  domain          text not null unique,
  tier            text,
  location_code   integer not null default 2840,          -- DataForSEO US
  language_code   text not null default 'en',
  core_frequency  tracking_frequency not null default 'weekly',
  serp_frequency  tracking_frequency not null default 'weekly',
  crawl_frequency tracking_frequency not null default 'monthly',
  last_core_at    timestamptz,
  last_serp_at    timestamptz,
  last_crawl_at   timestamptz,
  onpage_task_id  text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  gsc_property    text
);
alter table clients enable row level security;

-- Tracked keywords per client.
create table if not exists tracked_keywords (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  keyword    text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, keyword)
);
alter table tracked_keywords enable row level security;

-- Per-keyword SERP position history.
create table if not exists keyword_rankings (
  id         bigint generated always as identity primary key,
  client_id  uuid not null references clients(id) on delete cascade,
  keyword_id uuid not null references tracked_keywords(id) on delete cascade,
  checked_at timestamptz not null default now(),
  position   integer,
  url        text
);
create index if not exists keyword_rankings_client_id_checked_at_idx
  on keyword_rankings (client_id, checked_at desc);
alter table keyword_rankings enable row level security;

-- Daily/periodic rollup snapshot per client — the dashboard reads these.
create table if not exists metric_snapshots (
  id                bigint generated always as identity primary key,
  client_id         uuid not null references clients(id) on delete cascade,
  captured_at       timestamptz not null default now(),
  organic_traffic   integer,
  organic_keywords  integer,
  backlinks         integer,
  referring_domains integer,
  site_health       numeric,
  visibility        numeric,
  ai_visibility     numeric,
  ai_mentions       integer
);
create index if not exists metric_snapshots_client_id_captured_at_idx
  on metric_snapshots (client_id, captured_at desc);
alter table metric_snapshots enable row level security;

-- Google Search Console real-clicks history (16-month window).
create table if not exists gsc_history (
  id          bigint generated always as identity primary key,
  client_id   uuid not null references clients(id) on delete cascade,
  date        date not null,
  clicks      integer not null default 0,
  impressions integer not null default 0,
  ctr         numeric,
  position    numeric,
  unique (client_id, date)
);
create index if not exists gsc_history_client_date on gsc_history (client_id, date desc);
alter table gsc_history enable row level security;

-- AI-visibility prompts per client (checked by the collector's ai module).
create table if not exists tracked_prompts (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  prompt     text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, prompt)
);
alter table tracked_prompts enable row level security;
