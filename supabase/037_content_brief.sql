-- 037_content_brief.sql — the brief a writer actually works from.
--
-- WO-005. "Add to pipeline" produced a queued row and nothing else: no way to
-- move it along, and nothing telling anyone what to write. A recommendation that
-- stops at "write about X" has handed the hard part back to a human.
--
-- Stored as jsonb rather than columns because the shape differs by action: a new
-- article needs an outline and a word count, a page rework needs what the
-- current page is missing. Both are briefs; neither is the other's schema.
--
-- Kept alongside the prediction (expected_clicks_mo) so the whole decision — why
-- this, what to write, what we expected — sits in one row.

begin;

alter table public.content_items
  add column if not exists brief              jsonb,
  add column if not exists brief_generated_at timestamptz;

commit;
