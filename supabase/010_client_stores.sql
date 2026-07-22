-- 010_client_stores.sql — Shopify revenue collector → conversions_daily(source='shopify').
-- Run after 006 (platform_secrets registry, whose auth_ref this points at).
-- Revenue ground truth (docs/CLAUDE-monitor-draft.md): ad platforms over-attribute
-- (each claims the same orders), so Shopify's actual orders/dollars let the
-- platform compute honest blended MER (revenue ÷ ad spend) instead of trusting
-- platform ROAS. Reuses conversions_daily (migration 005) with source='shopify'
-- — no new revenue table.

-- Per-client store registry — which platform store(s) a client has connected,
-- and (via auth_ref) where its durable secret lives in the vault
-- (platform_secrets, stream 2). One row per (client, platform); a client could
-- in principle have more than one storefront, but v1 tracks one active store
-- per platform.
create table if not exists client_stores (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid references clients(id) on delete cascade,
  platform       text not null,                      -- 'shopify', ...
  domain         text not null,                       -- e.g. my-shop.myshopify.com
  api_client_id  text,                                 -- Shopify custom app Client ID (durable, not a secret)
  auth_ref       text,                                 -- points at a platform_secrets row (stream 2) holding the shpss_ secret
  status         text not null default 'active',      -- active | paused | revoked
  created_at     timestamptz not null default now(),
  unique (client_id, platform)
);
alter table client_stores enable row level security;
