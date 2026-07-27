-- 012_auth_tenancy_rls.sql
-- WO-003 Wave 1 · Stream A (module/auth-rls)
--
-- Multi-tenant identity + per-client RLS. This is the hard gate: no client-facing
-- surface ships before it, and it cannot be retrofitted once client logins exist.
--
-- Shape: organization → clients → users (spec §9, "multi-tenancy from the start").
-- One org today (Trusted Marketing); the schema does not assume that.
--
-- Access model
--   agency users  (owner / pod_lead / specialist) → every client in their org
--   client users  (client)                        → only clients linked in client_users
--   service_role                                  → bypasses RLS entirely (collectors,
--                                                   cron, admin scripts) — unchanged.
--
-- Every policy routes through public.has_client_access(uuid) so the rule lives in
-- exactly one place. Changing the access model means changing that function, not
-- 16 policy definitions.

begin;

-- ---------------------------------------------------------------- organizations

create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now()
);

insert into public.organizations (name, slug)
values ('Trusted Marketing', 'trusted-marketing')
on conflict (slug) do nothing;

-- clients belong to an organization
alter table public.clients
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;

update public.clients
   set organization_id = (select id from public.organizations where slug = 'trusted-marketing')
 where organization_id is null;

alter table public.clients alter column organization_id set not null;

create index if not exists clients_organization_id_idx on public.clients(organization_id);

-- ---------------------------------------------------------------- user profiles

-- Roles mirror the approval matrix in spec §8 (COO review). The matrix itself is
-- enforced in application logic; RLS only decides *visibility*, never *authority*.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('owner', 'pod_lead', 'specialist', 'client');
  end if;
end$$;

create table if not exists public.user_profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  email           text not null,
  full_name       text,
  role            public.user_role not null default 'specialist',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

create index if not exists user_profiles_organization_id_idx on public.user_profiles(organization_id);
create index if not exists user_profiles_role_idx on public.user_profiles(role);

-- client users are scoped to explicit clients. Agency users need no rows here.
create table if not exists public.client_users (
  user_id     uuid not null references public.user_profiles(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, client_id)
);

create index if not exists client_users_client_id_idx on public.client_users(client_id);

-- ---------------------------------------------------------------- access helpers
--
-- SECURITY DEFINER + a pinned search_path: these read user_profiles/client_users
-- while those same tables are themselves under RLS. Without DEFINER the policies
-- would recurse. Same pattern as the vault RPCs in 011.

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select organization_id from public.user_profiles
   where id = auth.uid() and is_active
$$;

create or replace function public.is_agency_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_profiles
     where id = auth.uid()
       and is_active
       and role in ('owner', 'pod_lead', 'specialist')
  )
$$;

-- The single source of truth for "may this session see this client?"
create or replace function public.has_client_access(target_client uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    -- agency user: any client inside their own organization
    exists (
      select 1
        from public.clients c
        join public.user_profiles u on u.id = auth.uid()
       where c.id = target_client
         and c.organization_id = u.organization_id
         and u.is_active
         and u.role in ('owner', 'pod_lead', 'specialist')
    )
    or
    -- client user: only explicitly linked clients
    exists (
      select 1
        from public.client_users cu
        join public.user_profiles u on u.id = cu.user_id
       where cu.user_id = auth.uid()
         and cu.client_id = target_client
         and u.is_active
    )
$$;

revoke all on function public.current_org_id()               from public, anon;
revoke all on function public.is_agency_user()               from public, anon;
revoke all on function public.has_client_access(uuid)        from public, anon;
grant execute on function public.current_org_id()            to authenticated;
grant execute on function public.is_agency_user()            to authenticated;
grant execute on function public.has_client_access(uuid)     to authenticated;

-- ---------------------------------------------------------------- RLS: identity

alter table public.organizations  enable row level security;
alter table public.user_profiles  enable row level security;
alter table public.client_users   enable row level security;

drop policy if exists organizations_read on public.organizations;
create policy organizations_read on public.organizations
  for select to authenticated
  using (id = public.current_org_id());

-- You can always read yourself. Agency users can read their org's roster;
-- client users deliberately cannot enumerate agency staff.
drop policy if exists user_profiles_read on public.user_profiles;
create policy user_profiles_read on public.user_profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (public.is_agency_user() and organization_id = public.current_org_id())
  );

drop policy if exists client_users_read on public.client_users;
create policy client_users_read on public.client_users
  for select to authenticated
  using (user_id = auth.uid() or public.has_client_access(client_id));

-- ---------------------------------------------------------------- RLS: clients

alter table public.clients enable row level security;

drop policy if exists clients_read on public.clients;
create policy clients_read on public.clients
  for select to authenticated
  using (public.has_client_access(id));

-- ---------------------------------------------------------------- RLS: client data
--
-- Every remaining table is client-scoped through client_id, so the policy is
-- identical across all of them. Generated rather than hand-written so a new
-- client-scoped table cannot be silently forgotten: add it to the array.

do $$
declare
  t text;
  client_scoped text[] := array[
    'ad_metrics_daily',
    'ad_platform_accounts',
    'changes',
    'client_stores',
    'collector_runs',
    'conversions_daily',
    'gsc_history',
    'jobs',
    'keyword_rankings',
    'metric_snapshots',
    'prompt_results',
    'recommendations',
    'tracked_keywords',
    'tracked_prompts'
  ];
begin
  foreach t in array client_scoped loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.has_client_access(client_id))',
      t || '_read', t
    );
  end loop;
end$$;

-- platform_secrets is client-scoped but must NEVER be readable by an end user,
-- agency or client. RLS on with no SELECT policy = deny-all; service_role only,
-- via the SECURITY DEFINER vault RPCs from 011. Autonomy ladder #5.
alter table public.platform_secrets enable row level security;
drop policy if exists platform_secrets_read on public.platform_secrets;

-- ---------------------------------------------------------------- coverage view
--
-- Read-only metadata so CI can assert RLS coverage. The failure mode RLS really
-- has is not a wrong policy, it is a MISSING one: a new client-scoped table with
-- no policy is invisible in review and readable by every signed-in user. This
-- lets tests turn that into a red build.
--
-- Deliberately NOT a generic exec_sql RPC: this returns table names and booleans
-- and nothing else, so it cannot be used to read data.
create or replace function public.rls_coverage()
returns table (table_name text, rls_enabled boolean, policy_count int, client_scoped boolean)
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select
    c.relname::text,
    c.relrowsecurity,
    (select count(*)::int from pg_policies p
      where p.schemaname = 'public' and p.tablename = c.relname),
    exists (
      select 1 from information_schema.columns col
       where col.table_schema = 'public'
         and col.table_name = c.relname
         and col.column_name = 'client_id'
    )
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  order by c.relname
$$;

revoke all on function public.rls_coverage() from public, anon, authenticated;
grant execute on function public.rls_coverage() to service_role;

commit;
