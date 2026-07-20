-- 003_prompt_results.sql — run after 002. Per-prompt AI visibility checks.

create table if not exists prompt_results (
  id         bigint generated always as identity primary key,
  client_id  uuid not null references clients(id) on delete cascade,
  prompt_id  uuid not null references tracked_prompts(id) on delete cascade,
  checked_at timestamptz not null default now(),
  mentioned  boolean not null default false,  -- brand or domain appears in the AI answer
  cited      boolean not null default false   -- domain appears as a source/link
);
create index if not exists prompt_results_client_checked on prompt_results (client_id, checked_at desc);

alter table prompt_results enable row level security;
