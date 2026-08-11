-- 045_ai_frequency.sql — give AI answer checks their own cadence.
--
-- Run after 044.
--
-- Until now AEO checks had no schedule of their own: they rode inside the
-- serp_frequency gate in the cron, so a client on `daily` keyword tracking got
-- daily AI checks as a side effect nobody chose. Keyword positions genuinely
-- move day to day; AI answer visibility does not — a brand does not appear in
-- ChatGPT on Tuesday and vanish on Wednesday. That was ~7x the cost for
-- granularity that carries no signal, and each check is a billed LLM call per
-- prompt per provider.
--
-- Defaults to weekly, including for clients currently on daily SERP. That is a
-- deliberate reduction rather than a like-for-like migration: keeping daily
-- would preserve a cadence that was never a decision, only an inherited
-- side effect.

begin;

alter table public.clients
  add column if not exists ai_frequency text not null default 'weekly';

-- Its own last-run stamp. Without this the new cadence would still be judged
-- against last_serp_at, which is the coupling this migration exists to remove.
-- Left NULL so the first run after deploy collects immediately rather than
-- waiting out a week from a date it never actually ran on.
alter table public.clients
  add column if not exists last_ai_at timestamptz;

commit;
