-- 006_secrets_registry.sql — secrets vault registry (Stream 2). Run after 004.
--
-- Per-client platform tokens (Meta, Google Ads, Microsoft, ClickUp, etc.) move OUT
-- of env vars into Supabase Vault (encrypted). This table is the TRACKING
-- REGISTRY only — the secret value itself lives in `vault.decrypted_secrets` /
-- `vault.secrets`, referenced here by `auth_ref`. Nothing in this table (or its
-- RLS policy set) ever holds a raw token. Future `ad_platform_accounts` (streams
-- 4 & 6) will point at a `platform_secrets` row via `auth_ref`.

create extension if not exists supabase_vault with schema vault;

create table if not exists platform_secrets (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references clients(id) on delete cascade,
  platform        text not null,                      -- 'meta','google_ads','microsoft','clickup',...
  auth_ref        text not null unique,                -- name of the corresponding vault.secrets row
  status          text not null default 'active',      -- active | expired | revoked
  expires_at      timestamptz,
  last_rotated_at timestamptz,
  created_at      timestamptz not null default now(),
  unique (client_id, platform)
);
create index if not exists platform_secrets_expires_at_active
  on platform_secrets (expires_at) where status = 'active';
alter table platform_secrets enable row level security;
