-- 041_client_personas.sql — WO-006 stream E: customer personas per client.
-- Run after 012 (has_client_access()).
--
-- Pure context for ad copy and creative-generation prompts (WO-006 streams C
-- and F) — NOT a native Meta/Google audience-object integration in v1
-- (confirmed scope). No platform targeting API is touched by this table.

begin;

create table if not exists public.client_personas (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  name              text not null,
  description       text,
  demographics      jsonb,
  locations         text[],
  categories        text[],
  pain_points       text,
  messaging_angle   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists client_personas_client on public.client_personas (client_id);

alter table public.client_personas enable row level security;
drop policy if exists client_personas_read on public.client_personas;
create policy client_personas_read on public.client_personas
  for select to authenticated using (public.has_client_access(client_id));

commit;
