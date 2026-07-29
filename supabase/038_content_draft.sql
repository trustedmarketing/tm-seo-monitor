-- 038_content_draft.sql — the article, and the link policy that governs it.
--
-- WO-005. Moving an item to drafting should produce the whole post, not a
-- prompt to go and write one.
--
-- `competitor_domains` is the load-bearing column here. "Do not link to
-- competitors" in a prompt is a request, not a guarantee — the model has no idea
-- who this client competes with, and it will cheerfully cite the best-written
-- page on the topic, which is very often a competitor's. Enforcement has to
-- happen in code against a stored list, so the list has to exist.

begin;

alter table public.content_items
  add column if not exists draft              jsonb,
  add column if not exists draft_generated_at timestamptz;

-- Domains we must never link out to. Registrable domains, no scheme, no www:
-- "salt-away.com", not "https://www.salt-away.com/products".
alter table public.clients
  add column if not exists competitor_domains text[] not null default '{}';

commit;
