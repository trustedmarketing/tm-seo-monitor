-- 036_organic_content.sql — the data the Organic tab actually needs.
--
-- WO-005. The design's Organic screen asks three things of the database that it
-- cannot currently answer:
--
--   1. "Only keywords with recorded conversions in the last 90 days"
--   2. a VOLUME column on the keyword table
--   3. a content pipeline — four items with a status each
--
-- None of those have anywhere to read from today. `gsc_history` stores ONE ROW
-- PER DAY per client: clicks, impressions, ctr, position, aggregated across the
-- whole property. No query dimension, no page dimension. So we know a client got
-- 9,420 clicks and nothing about which searches produced them.
--
-- That single missing dimension is what blocks the whole screen, and it is also
-- the thing that makes content recommendations possible at all. A recommendation
-- to write about X is only worth reading if it can say how many people searched
-- for X and where the client currently sits.

begin;

-- ── 1. GSC query + page performance ─────────────────────────────────────────
--
-- Why a rolling WINDOW rather than daily rows:
-- daily query×page rows for one small site run 1,000–5,000 a day. Over 90 days
-- and 13 clients that is millions of rows to answer a question that is always
-- asked as "the last 28 days versus the 28 before". Storing the window directly
-- is one row per query+page per collection, and every figure on the screen is a
-- plain select rather than a sum over a quarter of a million rows.
--
-- Why TOP N rather than everything:
-- GSC's long tail is mostly single-impression noise. The top 250 by impressions
-- covers everything that could change a content decision. The cap is deliberate,
-- and the UI states it, so nobody reads the table as exhaustive.
create table if not exists public.gsc_query_windows (
  id           bigint generated always as identity primary key,
  client_id    uuid not null references public.clients(id) on delete cascade,

  -- Last day included. GSC lags ~2 days, so this is never today.
  window_end   date not null,
  window_days  int  not null default 28,

  query        text not null,
  -- '' means the query-only rollup; a real URL means a query×page pair, which is
  -- how a published post gets attributed to the searches it actually won.
  --
  -- Empty string rather than NULL on purpose: NULL never equals NULL, so a
  -- nullable column needs an expression index (coalesce(page,'')) — and PostgREST
  -- upserts cannot name an expression index in onConflict. Every write would have
  -- had to become a delete-then-insert. A sentinel keeps the upsert native.
  page         text not null default '',

  clicks       int not null default 0,
  impressions  int not null default 0,
  ctr          numeric,
  position     numeric,

  collected_at timestamptz not null default now(),

  -- Named unique constraint, not an expression index: PostgREST upserts must be
  -- able to name it in onConflict.
  constraint gsc_query_windows_uniq unique (client_id, window_end, query, page)
);

create index if not exists gsc_query_windows_lookup
  on public.gsc_query_windows (client_id, window_end desc, impressions desc);

create index if not exists gsc_query_windows_page
  on public.gsc_query_windows (client_id, page) where page <> '';

alter table public.gsc_query_windows enable row level security;

drop policy if exists gsc_query_windows_read on public.gsc_query_windows;
create policy gsc_query_windows_read on public.gsc_query_windows
  for select to authenticated
  using (public.has_client_access(client_id));


-- ── 2. Search volume on tracked keywords ────────────────────────────────────
--
-- The design's VOLUME column. GSC reports impressions, not search volume, and
-- they are different numbers measuring different things — impressions is how
-- often THIS SITE appeared, volume is how often anyone searched. Showing
-- impressions under a heading that says VOLUME would be a quiet lie, so this is
-- a separate column populated from DataForSEO, and it stays null until it is.
alter table public.tracked_keywords
  add column if not exists search_volume     int,
  add column if not exists volume_updated_at timestamptz;


-- ── 3. Content pipeline ─────────────────────────────────────────────────────
--
-- The design's right-hand rail, and the destination for accepted content
-- recommendations. One row per article from idea through to measurement.
create table if not exists public.content_items (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,

  title         text not null,

  -- The search this is written to win. Free text, because a recommendation can
  -- name a query the client does not track yet — and refusing to record the idea
  -- until someone adds the keyword is how good ideas get lost.
  target_query  text,
  keyword_id    uuid references public.tracked_keywords(id) on delete set null,

  -- idea          — recommended, nobody has accepted it
  -- queued        — accepted, waiting on a writer
  -- drafting      — being written
  -- in_qc         — written, under internal review
  -- awaiting_client — sent for client approval
  -- published     — live
  -- declined      — rejected, with a reason, so it is not re-recommended
  status        text not null default 'idea'
                check (status in ('idea','queued','drafting','in_qc',
                                  'awaiting_client','published','declined')),

  -- Free-text state detail: "Draft v2", "Writer assigned", "Sent Tuesday".
  -- The design shows one of these under every pipeline item.
  status_note   text,

  -- Why this topic, in a sentence, with the numbers that justified it. Written
  -- at recommendation time and kept, so six months later the reason the article
  -- exists is still legible.
  rationale     text,

  -- What we predicted, so it can be checked against what happened. Honest
  -- measurement needs the prediction recorded BEFORE the outcome is known.
  expected_clicks_mo int,
  confidence    text check (confidence in ('low','medium','high')),

  url           text,
  published_at  timestamptz,

  -- Set when a recommendation is turned down. Feeds the same 60-day mute rule
  -- the design describes on the recommendation queue.
  declined_at   timestamptz,
  decline_reason text,

  -- 'agent' when the recommender proposed it, 'human' when someone typed it in.
  source        text not null default 'agent',

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists content_items_client
  on public.content_items (client_id, status, created_at desc);

-- One live idea per client per query. Without this, every recommender run
-- re-proposes the same article and the pipeline fills with duplicates. Declined
-- and published rows are excluded so a topic can genuinely be revisited later.
create unique index if not exists content_items_open_target
  on public.content_items (client_id, lower(target_query))
  where target_query is not null
    and status not in ('declined', 'published');

alter table public.content_items enable row level security;

drop policy if exists content_items_read on public.content_items;
create policy content_items_read on public.content_items
  for select to authenticated
  using (public.has_client_access(client_id));

-- Agency users move items through the pipeline; clients only ever read.
drop policy if exists content_items_write on public.content_items;
create policy content_items_write on public.content_items
  for all to authenticated
  using (public.has_client_access(client_id) and public.is_agency_user())
  with check (public.has_client_access(client_id) and public.is_agency_user());

commit;
