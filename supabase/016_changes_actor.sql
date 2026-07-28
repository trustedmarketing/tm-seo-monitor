-- 016_changes_actor.sql
-- WO-003 Stream I (module/changes-log)
--
-- The change ledger records WHAT shipped but not WHO decided it. The design's
-- Changes log has a "Decided by" column, and the feasibility review flagged the
-- gap: "changes table exists; add actor column".
--
-- Also adds `automatic` — punch list #6. Alt text, schema and internal links
-- ship with no human in the loop, and they must still be visible. A change log
-- that only shows human decisions quietly hides everything the system does on
-- its own, which is the opposite of what a receipt is for.
--
-- Note this duplicates information the audit log already holds. That is
-- deliberate: the audit log is the immutable legal record, the ledger is the
-- operational view, and joining sixteen thousand audit rows to render a page is
-- the wrong trade.

begin;

alter table public.changes
  add column if not exists decided_by       uuid references public.user_profiles(id) on delete set null,
  add column if not exists decided_by_email text,
  add column if not exists automatic        boolean not null default false,
  add column if not exists approval_id      uuid references public.approvals(id) on delete set null;

create index if not exists changes_automatic_idx on public.changes(client_id, automatic);
create index if not exists changes_approval_idx  on public.changes(approval_id);

commit;
