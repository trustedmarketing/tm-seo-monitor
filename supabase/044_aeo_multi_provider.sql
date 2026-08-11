-- 044_aeo_multi_provider.sql — AEO across ChatGPT, Gemini and Claude, plus
-- Google AI Overview visibility on tracked keywords.
--
-- Run after 003 (prompt_results) and 001 (keyword_rankings, clients).
--
-- SCHEMA DRIFT NOTE: the cron has been writing `answer`, `sources`, `model` and
-- `web_search` to prompt_results since WO-003, but no migration in this repo
-- ever created those columns — they were added directly in Supabase. The writes
-- succeed in production, so production has been ahead of the repo. The
-- `add column if not exists` block below makes the repo authoritative without
-- disturbing what is already there. Same reason 001–002 were reconstructed from
-- production: untracked schema changes are how a migration set stops describing
-- the database it is supposed to define.

begin;

-- ── prompt_results: reconcile drift, then add the provider dimension ────────
alter table public.prompt_results add column if not exists answer      text;
alter table public.prompt_results add column if not exists sources     jsonb;
alter table public.prompt_results add column if not exists model       text;
alter table public.prompt_results add column if not exists web_search  boolean;

-- Which assistant produced this answer. Defaults to chat_gpt so every row
-- collected before today keeps its true meaning rather than becoming ambiguous —
-- backfilling them as anything else would be inventing history.
alter table public.prompt_results
  add column if not exists provider text not null default 'chat_gpt';

-- The AEO page reads "latest result per prompt". With more than one provider
-- that becomes "latest per prompt PER PROVIDER", so the index has to carry the
-- provider or every read does a sort it cannot use.
create index if not exists prompt_results_prompt_provider_checked
  on public.prompt_results (prompt_id, provider, checked_at desc);

-- ── clients: which providers this client is checked against ─────────────────
-- Opt-in per client, not on for everyone. Each extra provider is a separate
-- billed DataForSEO call per prompt per run, on a balance shared with every
-- other collector — enabling all three for all clients by default would triple
-- AEO spend without anyone choosing it.
alter table public.clients
  add column if not exists aeo_providers text[] not null default array['chat_gpt']::text[];

-- ── keyword_rankings: Google AI Overview, which costs nothing extra ─────────
-- The ai_overview item already arrives in the serp/google/organic/live/advanced
-- response we buy for every tracked keyword; we were discarding it. Nullable
-- because rows collected before today genuinely do not know — a default of
-- false would assert "Google showed no AI Overview" for history we never looked at.
alter table public.keyword_rankings add column if not exists ai_overview        boolean;
alter table public.keyword_rankings add column if not exists ai_overview_cited  boolean;

commit;
