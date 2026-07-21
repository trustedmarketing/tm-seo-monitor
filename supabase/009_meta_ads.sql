-- 009_meta_ads.sql — WO-001 stream 4: Meta ads collector → ad_metrics_daily.
-- Run after 006 (platform_secrets registry, whose auth_ref this points at).
-- Paid-media spine (plan §4): one row per client per platform per day per ad,
-- so ad-level spend/conversions/revenue join the same measurement loop as
-- organic (metric_snapshots) and conversions (conversions_daily).

-- Per-client ad account registry — which platform account(s) a client has
-- connected, and (via auth_ref) where its access token lives in the vault
-- (platform_secrets, stream 2). Multiple platforms per client; one row per
-- (client, platform, external ad-account id).
create table if not exists ad_platform_accounts (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references clients(id) on delete cascade,
  platform    text not null,                      -- 'meta','google_ads','microsoft',...
  external_id text not null,                       -- platform's ad account id, e.g. act_123456789
  status      text not null default 'active',      -- active | paused | revoked
  auth_ref    text,                                 -- points at a platform_secrets row (stream 2)
  created_at  timestamptz not null default now(),
  unique (client_id, platform, external_id)
);
alter table ad_platform_accounts enable row level security;

-- Ad-level daily performance. One row per client/platform/date/ad — the
-- collector upserts on that key so re-running a day never duplicates rows.
create table if not exists ad_metrics_daily (
  id            bigint generated always as identity primary key,
  client_id     uuid references clients(id) on delete cascade,
  platform      text not null,
  date          date not null,
  campaign_id   text,
  campaign_name text,
  adset_id      text,
  ad_id         text,
  creative_id   text,
  impressions   integer,
  clicks        integer,
  spend         numeric,
  conversions   numeric,
  revenue       numeric,
  created_at    timestamptz not null default now(),
  unique (client_id, platform, date, ad_id)
);
create index if not exists ad_metrics_daily_client_date on ad_metrics_daily (client_id, date desc);
alter table ad_metrics_daily enable row level security;
