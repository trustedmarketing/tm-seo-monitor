-- 008_client_ga4_property.sql — wire GA4 into the collector (integration pass).
-- Stream 3's collectConversions reads clients.ga4_property_id; add it here.
alter table clients add column if not exists ga4_property_id text;
