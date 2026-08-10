-- 039_campaigns.sql — WO-006 stream A: campaign entity registry.
-- Run after 012 (has_client_access()) and 009 (ad_platform_accounts).
--
-- ad_metrics_daily is metrics-only (impressions/clicks/spend/conversions/
-- revenue) and carries no status column, so "is this campaign currently
-- running" can't be answered from it — a paused campaign with a stray
-- same-day charge would look active. This table is synced separately from
-- each platform's campaign-list endpoint (not its insights endpoint) and is
-- the write TARGET for WO-006 stream D's pause/amend/create actions —
-- adapters act on `campaigns` rows, never on ad_metrics_daily.

begin;

create table if not exists public.campaigns (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients(id) on delete cascade,
  platform            text not null,                 -- 'meta' | 'google_ads' | 'microsoft'
  campaign_id         text not null,                  -- the platform's own campaign id
  campaign_name       text,
  status              text not null default 'active', -- active | paused | removed
  objective           text,
  daily_budget        numeric,
  monthly_budget_cap  numeric,
  last_synced_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (client_id, platform, campaign_id)
);

create index if not exists campaigns_client_platform on public.campaigns (client_id, platform);
create index if not exists campaigns_status on public.campaigns (client_id, status);

alter table public.campaigns enable row level security;
drop policy if exists campaigns_read on public.campaigns;
create policy campaigns_read on public.campaigns
  for select to authenticated using (public.has_client_access(client_id));

commit;
