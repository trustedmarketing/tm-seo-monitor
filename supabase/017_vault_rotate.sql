-- 017_vault_rotate.sql — make credential rotation possible.
--
-- `vault_write_secret` (011) only ever INSERTS, so writing to a name that
-- already exists fails on the unique constraint. That makes rotation impossible
-- through our own API, which is not an edge case:
--
--   · WordPress application passwords get regenerated (and are per-site)
--   · Meta system-user tokens expire
--   · WO-001 explicitly recommends rotating a production key that was once
--     pasted into a chat
--   · a leaked credential must be replaceable in seconds, not by hand-editing
--     the vault schema
--
-- Hit for real on 2026-07-28 while connecting the first WordPress site.
--
-- Rotation is deliberately a SEPARATE function rather than making the existing
-- one upsert. Overwriting a live credential should be something a caller asks
-- for explicitly — a create that silently replaces is how the wrong secret ends
-- up under the right name with nothing recording that it happened.

begin;

create or replace function public.vault_rotate_secret(p_secret text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_name;

  if v_id is null then
    return vault.create_secret(p_secret, p_name);
  end if;

  perform vault.update_secret(v_id, p_secret, p_name);
  return v_id;
end;
$$;

revoke all on function public.vault_rotate_secret(text, text) from public, anon, authenticated;
grant execute on function public.vault_rotate_secret(text, text) to service_role;

commit;
