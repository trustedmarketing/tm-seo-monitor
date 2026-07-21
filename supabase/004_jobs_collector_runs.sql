-- 004_jobs_collector_runs.sql — Phase A.5 core (WO-001 stream 1). Run after 003.
--
-- Two operational-hardening tables:
--   collector_runs — one row per module execution (observability spine). The
--     collector records every run here, so silent staleness / partial failures
--     become visible instead of hiding inside a 200 response.
--   jobs — durable work queue with retries + idempotency, so collection fans out
--     as queued units and never depends on one 300s cron request across 13 clients.

-- ── collector_runs ───────────────────────────────────────────────────
create table if not exists collector_runs (
  id           bigint generated always as identity primary key,
  module       text not null,                       -- 'core','serp','ai','crawl','recs',...
  client_id    uuid references clients(id) on delete cascade,  -- null = portfolio-wide run
  status       text not null default 'running',     -- running | success | error | skipped
  detail       text,
  error        text,
  rows_written integer,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  duration_ms  integer
);
create index if not exists collector_runs_module_started on collector_runs (module, started_at desc);
create index if not exists collector_runs_client_started on collector_runs (client_id, started_at desc);
create index if not exists collector_runs_errors on collector_runs (started_at desc) where status = 'error';
alter table collector_runs enable row level security;

-- ── jobs queue ───────────────────────────────────────────────────────
do $$ begin
  create type job_status as enum ('queued','running','succeeded','failed','dead');
exception when duplicate_object then null; end $$;

create table if not exists jobs (
  id              bigint generated always as identity primary key,
  job_type        text not null,
  client_id       uuid references clients(id) on delete cascade,
  payload         jsonb not null default '{}'::jsonb,
  idempotency_key text unique,                       -- repeat key = no-op enqueue
  status          job_status not null default 'queued',
  priority        integer not null default 100,      -- lower = sooner
  attempts        integer not null default 0,
  max_attempts    integer not null default 3,
  run_after       timestamptz not null default now(),
  locked_at       timestamptz,
  locked_by       text,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists jobs_claimable on jobs (run_after, priority) where status in ('queued', 'failed');
create index if not exists jobs_client on jobs (client_id, created_at desc);
alter table jobs enable row level security;
