-- 047_fix_gsc_property_form.sql — data repair, no schema change.
--
-- Twelve of nineteen production clients held a `gsc_property` in a form Google
-- cannot match:
--
--     sc-domain:https://alphazetaent.com/
--
-- `clients.gsc_property` is passed verbatim into the Search Console API path
-- (lib/gsc.ts), so this matches no property and returns 403 — which reads as a
-- permissions error, not a malformed string. `collectOrganicQueries` throws and
-- the client shows "Collection failed · organic_queries" every morning.
--
-- ── Why stripping the prefix is the right repair ────────────────────────────
-- The two rows that were CORRECT were exactly the two Domain properties
-- (daps.fit, emporiumthreads.com). Every malformed row is a URL-prefix property
-- with `sc-domain:` bolted onto the front — confirmed against Search Console's
-- own property picker for alphazetaent.com, cwnow.com and getsaltydog.com.
-- So the original value is recoverable by removing the prefix.
--
-- ── This cannot make anything worse ─────────────────────────────────────────
-- Every row it touches is already 100% broken. If any of the nine unverified
-- clients turns out to be a Domain property rather than URL-prefix, the result
-- is still a 403 — the same 403 it returns today. There is no row for which
-- this is a regression, which is why it is safe to run before all nine have
-- been confirmed by eye.
--
-- Confirm afterwards with the picker, and by watching `organic_queries` in
-- collector_runs on the next collection.

begin;

-- The blend: sc-domain: + a full URL. Recover the URL-prefix form.
update public.clients
set gsc_property = regexp_replace(gsc_property, '^sc-domain:', '')
where gsc_property ~* '^sc-domain:https?://';

-- Empty string is not the same as "not configured" — the collector treats a
-- blank as falsy and skips, but every other reader has to know that. One row
-- (Berry Fresh Café) held '' rather than null.
update public.clients
set gsc_property = null
where gsc_property is not null and btrim(gsc_property) = '';

commit;

-- Verify — expect zero rows:
--
--   select name, gsc_property from clients
--   where gsc_property is not null
--     and gsc_property !~* '^(sc-domain:[a-z0-9.-]+\.[a-z]{2,}|https?://.+/)$'
--   order by name;
