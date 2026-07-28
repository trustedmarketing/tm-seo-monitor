-- 019_qc_scans.sql — site quality history.
-- WO-003 Stream I / QC panel.
--
-- metric_snapshots already carries `site_health`, a single score. That answers
-- "is it worse?" and not "what do I fix?", which is the only question a pod lead
-- actually has. This stores the crawl's full check map alongside the score, so
-- the panel can rank real issues and show them over time.
--
-- `checks` is jsonb rather than a child table on purpose: DataForSEO's check set
-- changes as they add crawler rules, and a normalised table would need a
-- migration every time they ship one. The classification lives in lib/qc.ts
-- where it can be edited without touching stored data.
begin;

create table if not exists public.qc_scans (
  id            bigint generated always as identity primary key,
  client_id     uuid not null references public.clients(id) on delete cascade,
  scanned_at    timestamptz not null default now(),
  score         numeric,
  pages_crawled int not null default 0,
  checks        jsonb not null default '{}'::jsonb,
  task_id       text
);

create index if not exists qc_scans_client_idx on public.qc_scans(client_id, scanned_at desc);

alter table public.qc_scans enable row level security;

drop policy if exists qc_scans_read on public.qc_scans;
create policy qc_scans_read on public.qc_scans
  for select to authenticated
  using (public.has_client_access(client_id));

commit;
