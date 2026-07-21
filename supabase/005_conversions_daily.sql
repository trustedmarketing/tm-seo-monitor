-- 005_conversions_daily.sql — WO-001 stream 3: GA4 collector → conversions_daily.
-- Run after 004. Conversion/revenue spine (plan §4): one row per client per day
-- per source, so ecom and lead-gen revenue windows join every measurement.

create table if not exists conversions_daily (
  id           bigint generated always as identity primary key,
  client_id    uuid not null references clients(id) on delete cascade,
  date         date not null,
  source       text not null default 'ga4',
  sessions     integer,
  conversions  integer,
  revenue      numeric,
  created_at   timestamptz not null default now(),
  unique (client_id, date, source)
);
create index if not exists conversions_daily_client_date on conversions_daily (client_id, date desc);
alter table conversions_daily enable row level security;
