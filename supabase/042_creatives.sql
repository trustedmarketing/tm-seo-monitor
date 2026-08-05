-- 042_creatives.sql — WO-006 stream F: ad creative library.
-- Run after 039 (campaigns), 041 (client_personas), 012 (has_client_access()).
--
-- Per docs/tm-growth-os-plan.md Module D: "generated assets mirrored into
-- our own `creatives` table... so vendor loss costs us the generator, not
-- the asset history." `concept_group_id` links the 4:5/1:1/9:16 siblings of
-- one approved concept — see lib/adCreative.ts's fanOutSizes() for the gate
-- that decides when the 1:1/9:16 rows get created at all.

begin;

create table if not exists public.creatives (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  campaign_id       uuid references public.campaigns(id) on delete set null,
  persona_id        uuid references public.client_personas(id) on delete set null,
  -- Groups the 4:5 primary with its 1:1/9:16 siblings once fanned out. Not a
  -- foreign key to itself on purpose — the primary row's own id doubles as
  -- the group id, so there's nothing to backfill when the group is created.
  concept_group_id  uuid not null,
  aspect_ratio      text not null,           -- '4:5' | '1:1' | '9:16'
  bloom_image_id    text,
  image_url         text,
  status            text not null default 'generating', -- generating | completed | failed | approved
  prompt            text,
  approved_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists creatives_concept_group on public.creatives (concept_group_id);
create index if not exists creatives_client on public.creatives (client_id);

alter table public.creatives enable row level security;
drop policy if exists creatives_read on public.creatives;
create policy creatives_read on public.creatives
  for select to authenticated using (public.has_client_access(client_id));

commit;
