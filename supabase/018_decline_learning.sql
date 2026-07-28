-- 018_decline_learning.sql
-- WO-003 — make a decline mean something.
--
-- Spec §2: "decline reasons feed the learning layer". The first implementation
-- stored the reason and then ignored it, suppressing everything for 60 days.
-- The four reasons are four different statements, not variations on "no".
--
-- `decline_note` exists because "other" tells us nothing on its own, and an
-- unexplained decline is the one kind we cannot learn from.
--
-- `redraft_of` lets a rule try once more with a different phrasing when the
-- VALUE was wrong rather than the intent — and, because it points at the card
-- that was refused, stops that from becoming an endless chain of retries.

begin;

alter table public.approvals
  add column if not exists decline_note text,
  add column if not exists redraft_of   uuid references public.approvals(id) on delete set null;

create index if not exists approvals_redraft_idx on public.approvals(redraft_of);
create index if not exists approvals_decline_reason_idx
  on public.approvals(client_id, decline_reason) where status = 'declined';

commit;
