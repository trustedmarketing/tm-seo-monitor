-- 014_audit_approvals.sql
-- WO-003 Wave 1 · Stream C (module/audit-log)
--
-- Two tables the whole execution layer depends on:
--
--   audit_log  — an immutable record of every approve / decline / publish / pause.
--                This is what makes an automated change to a client's site or ad
--                account defensible if the client ever disputes it. Spec §9:
--                "audit log, non-optional".
--   approvals  — the queue behind the Approval Card. Carries the SLA clock, the
--                decline reason, the 60-day suppression, and an idempotency key
--                so approving twice cannot publish twice.
--
-- Immutability is enforced, not documented: UPDATE and DELETE on audit_log are
-- revoked from every role including service_role, and a trigger rejects them
-- outright. An audit log an application can edit is not an audit log.

begin;

-- ---------------------------------------------------------------- audit log

create table if not exists public.audit_log (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id       uuid references public.clients(id) on delete set null,

  -- Who. actor_id is null for system actions; actor_email is denormalised on
  -- purpose so the record still reads correctly after a user is deleted.
  actor_id        uuid references public.user_profiles(id) on delete set null,
  actor_email     text,
  -- Punch list #6: changes that ship with no human in the loop (alt text,
  -- schema, internal links) must still be visible. This is the flag the
  -- Changes log filters on.
  automatic       boolean not null default false,

  action          text not null,     -- approve | decline | publish | pause | revert | …
  target_type     text not null,     -- approval | change | recommendation | ad_entity | …
  target_id       text,

  before          jsonb,
  after           jsonb,
  detail          text,
  ip              inet,

  created_at      timestamptz not null default now()
);

create index if not exists audit_log_client_idx  on public.audit_log(client_id, created_at desc);
create index if not exists audit_log_actor_idx   on public.audit_log(actor_id, created_at desc);
create index if not exists audit_log_action_idx  on public.audit_log(action, created_at desc);
create index if not exists audit_log_auto_idx    on public.audit_log(automatic) where automatic;

-- Append-only, enforced. Revoking is not enough on its own because service_role
-- is the owner in practice; the trigger closes that.
create or replace function public.audit_log_is_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only: % is not permitted', tg_op;
end$$;

drop trigger if exists audit_log_no_update on public.audit_log;
create trigger audit_log_no_update before update on public.audit_log
  for each row execute function public.audit_log_is_append_only();

drop trigger if exists audit_log_no_delete on public.audit_log;
create trigger audit_log_no_delete before delete on public.audit_log
  for each row execute function public.audit_log_is_append_only();

-- ---------------------------------------------------------------- approvals

do $$
begin
  if not exists (select 1 from pg_type where typname = 'approval_status') then
    create type public.approval_status as enum (
      'staged',      -- work done, waiting on a human
      'approved',
      'declined',
      'publishing',
      'published',
      'failed',      -- punch list #2: the fourth outcome the design was missing
      'reverted'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'approval_variant') then
    create type public.approval_variant as enum ('site', 'ad', 'creative', 'content');
  end if;
end$$;

create table if not exists public.approvals (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  recommendation_id uuid references public.recommendations(id) on delete set null,

  variant           public.approval_variant not null,
  status            public.approval_status  not null default 'staged',
  severity          text not null default 'Medium',

  title             text not null,
  why               text,
  staged_by         text,             -- "Agent SEO-3" — the design's attribution line
  qc_passed         int,
  qc_total          int,

  -- Punch list #5: a card above your role renders locked, not hidden.
  requires_role     public.user_role not null default 'specialist',

  -- Punch list #9: the SLA needs a consequence, so it needs a clock.
  sla_due_at        timestamptz,
  assigned_to       uuid references public.user_profiles(id) on delete set null,

  decided_by        uuid references public.user_profiles(id) on delete set null,
  decided_at        timestamptz,
  decline_reason    text,
  -- Decline feeds the learning layer and suppresses the rule for 60 days.
  suppress_until    date,

  -- Punch list #2: a failure keeps the card in the queue with the real error.
  error_detail      text,

  -- Approving twice must not publish twice.
  idempotency_key   text unique,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists approvals_client_status_idx on public.approvals(client_id, status);
create index if not exists approvals_sla_idx on public.approvals(sla_due_at)
  where status = 'staged';

-- ---------------------------------------------------------------- RLS
-- Same model as 012: reads route through has_client_access(). Writes stay with
-- the service role, so an approval is only ever recorded by our own server code.

alter table public.audit_log  enable row level security;
alter table public.approvals  enable row level security;

drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log
  for select to authenticated
  using (client_id is not null and public.has_client_access(client_id));

drop policy if exists approvals_read on public.approvals;
create policy approvals_read on public.approvals
  for select to authenticated
  using (public.has_client_access(client_id));

commit;
