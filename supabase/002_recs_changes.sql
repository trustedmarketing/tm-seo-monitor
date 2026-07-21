-- 002_recs_changes.sql — recommendations engine + change ledger. Run after 001.
--
-- Reconstructed from production (project xelweikfciqakagkerat) on 2026-07-21.
-- The recommendations lifecycle (open → approved → measuring → validated/no_effect)
-- and the change ledger with 28-day before/after measurement live here.

-- Recommendations — one row per (client, rule_key), upserted by the rules engine.
create table if not exists recommendations (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  rule_key    text not null,
  severity    text not null,
  category    text not null,
  title       text not null,
  detail      text not null,
  status      text not null default 'open',
  shipped_at  timestamptz,
  measured_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (client_id, rule_key)
);
alter table recommendations enable row level security;

-- Change ledger — every executed change, with automatic before/after measurement.
create table if not exists changes (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references clients(id) on delete cascade,
  recommendation_id uuid references recommendations(id) on delete set null,
  title             text not null,
  description       text,
  changed_at        date not null,
  affected_keywords text[],
  source            text not null default 'manual',
  pr_url            text,
  verdict           text,
  metrics           jsonb,
  measured_at       timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists changes_client_date on changes (client_id, changed_at desc);
alter table changes enable row level security;
