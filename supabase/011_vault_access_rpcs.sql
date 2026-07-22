-- 011_vault_access_rpcs.sql — controlled Vault access for the service-role app.
-- The `vault` schema is intentionally NOT exposed to PostgREST (exposing it would
-- defeat the point of the vault), so `db.schema('vault')...` calls fail from the
-- app. These SECURITY DEFINER wrappers in `public` are the only access path:
-- the app reads/writes secrets via RPC, the vault schema stays private.

create or replace function public.vault_write_secret(p_secret text, p_name text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select vault.create_secret(p_secret, p_name);
$$;

create or replace function public.vault_read_secret(p_name text)
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$$;

-- Only the service role (server-side) may call these — never anon/authenticated.
revoke all on function public.vault_write_secret(text, text) from public, anon, authenticated;
revoke all on function public.vault_read_secret(text) from public, anon, authenticated;
grant execute on function public.vault_write_secret(text, text) to service_role;
grant execute on function public.vault_read_secret(text) to service_role;
