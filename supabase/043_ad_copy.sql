-- 043_ad_copy.sql — WO-006 streams G/H: ad copy generation + turnkey linking.
-- Run after 012 (has_client_access()), 039 (campaigns), 042 (creatives).
--
-- `ad_copy_sets` mirrors `creatives`'s shape (client_id/campaign_id/status,
-- a jsonb payload rather than one row per headline — per-headline editing
-- is a v2 follow-up, flagged not built here).
--
-- `approval_id` on both tables (new here, and added to `creatives`) is the
-- turnkey link: staging a NEW campaign generates a 4:5 creative and a copy
-- set before the real campaign exists, so there's no `campaign_id` yet to
-- attach them to. They're tagged with the staged approval's id instead;
-- once that approval executes and the real campaign row exists,
-- api/approvals/route.ts backfills campaign_id on both and the approval_id
-- tag has done its job.

begin;

alter table public.creatives add column if not exists approval_id uuid references public.approvals(id) on delete set null;
create index if not exists creatives_approval on public.creatives (approval_id) where approval_id is not null;

create table if not exists public.ad_copy_sets (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  campaign_id     uuid references public.campaigns(id) on delete set null,
  approval_id     uuid references public.approvals(id) on delete set null,
  platform        text not null,               -- 'meta' | 'google_ads' | 'microsoft'
  format          text not null,               -- 'rsa' | 'pmax' | 'meta_feed'
  -- Each jsonb array holds {text, chars, overLimit} objects — see
  -- lib/adCopyLimits.ts's flagOverLimit(). overLimit is a flag for review,
  -- never a reason to silently truncate generated text.
  headlines       jsonb,
  long_headlines  jsonb,           -- PMax only
  descriptions    jsonb,
  primary_texts   jsonb,           -- Meta only
  business_name   text,            -- PMax only
  status          text not null default 'generated', -- generated | approved
  approved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists ad_copy_sets_client on public.ad_copy_sets (client_id);
create index if not exists ad_copy_sets_campaign on public.ad_copy_sets (campaign_id) where campaign_id is not null;
create index if not exists ad_copy_sets_approval on public.ad_copy_sets (approval_id) where approval_id is not null;

alter table public.ad_copy_sets enable row level security;
drop policy if exists ad_copy_sets_read on public.ad_copy_sets;
create policy ad_copy_sets_read on public.ad_copy_sets
  for select to authenticated using (public.has_client_access(client_id));

commit;
