-- 002_admin_gsc.sql — run after schema.sql

-- GSC property per client. Format: 'sc-domain:example.com' (domain property)
-- or 'https://www.example.com/' (URL-prefix property). Copy it exactly as it
-- appears in the Search Console property switcher.
alter table clients add column if not exists gsc_property text;

-- Daily GSC history (backfilled up to 16 months, then extended by cron)
create table if not exists gsc_history (
  id          bigint generated always as identity primary key,
  client_id   uuid not null references clients(id) on delete cascade,
  date        date not null,
  clicks      integer not null default 0,
  impressions integer not null default 0,
  ctr         numeric(6,4),
  position    numeric(6,2),
  unique (client_id, date)
);
create index if not exists gsc_history_client_date on gsc_history (client_id, date desc);

-- AI-visibility prompts (phase 2 — table ready now)
create table if not exists tracked_prompts (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  prompt     text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, prompt)
);

alter table gsc_history     enable row level security;
alter table tracked_prompts enable row level security;
