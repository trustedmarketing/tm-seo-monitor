-- 013_client_type.sql
-- WO-003 Wave 1 · Stream M (module/agency-shell)
--
-- Client-type awareness. Specced in docs/tm-growth-os-plan.md §2 as "a data-model
-- concern, not a UI afterthought" and never built — so today every client is
-- treated identically, and the dashboard cannot answer "does this client even
-- have revenue?"
--
-- It cuts both ways: Revenue applies only to eCommerce, GBP and Automation only
-- to local service. Without this column the workspace tab set has to be a fixed
-- list, which is wrong for every client.
--
-- client_type is deliberately NULLABLE. An unclassified client falls back to the
-- safe common tab set rather than forcing a guess during onboarding; /admin
-- surfaces unclassified clients so the gap stays visible instead of silent.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'client_type') then
    create type public.client_type as enum ('local_service', 'national_ecom', 'hybrid');
  end if;
end$$;

alter table public.clients
  add column if not exists client_type      public.client_type,
  -- geo definitions for local rank tracking: [{city, county, location_code}, …]
  add column if not exists service_areas    jsonb,
  -- Google Business Profile locations, once the API access clears (plan §0)
  add column if not exists gbp_location_ids text[],
  -- shopify | woocommerce | custom — drives which revenue adapter applies
  add column if not exists store_platform   text;

create index if not exists clients_client_type_idx on public.clients(client_type);

-- Classify what we can prove rather than what we assume. A client with a linked
-- store and real Shopify revenue is unambiguously eCommerce; everything else is
-- left NULL for a human to classify, which is the honest default.
update public.clients c
   set client_type    = 'national_ecom',
       store_platform = coalesce(c.store_platform, 'shopify')
 where c.client_type is null
   and exists (select 1 from public.client_stores s where s.client_id = c.id)
   and exists (
     select 1 from public.conversions_daily v
      where v.client_id = c.id and v.source = 'shopify'
   );

commit;
