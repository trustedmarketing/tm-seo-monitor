-- 040_ad_spend_guards.sql — WO-006 stream D: per-client/platform spend
-- ceilings (spec §7 "hard guardrail... every write action passes through a
-- spend-guard layer... any action that could exceed them is blocked and
-- escalated, not approved-through").
-- Run after 012 (has_client_access()) and 039 (campaigns).

begin;

create table if not exists public.ad_spend_guards (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  platform         text not null,                 -- 'meta' | 'google_ads' | 'microsoft'
  daily_ceiling    numeric,
  monthly_ceiling  numeric,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (client_id, platform)
);

alter table public.ad_spend_guards enable row level security;
drop policy if exists ad_spend_guards_read on public.ad_spend_guards;
create policy ad_spend_guards_read on public.ad_spend_guards
  for select to authenticated using (public.has_client_access(client_id));

commit;
