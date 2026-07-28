-- 021_social.sql — organic social storage.
-- WO-003 / plan Module E.
--
-- Source is PostFlow rather than Meta Graph, deliberately. The PostFlow token is
-- already vaulted and working, it covers every network the team actually
-- publishes to (X, LinkedIn, Instagram, TikTok, Facebook), and it needs no new
-- platform scopes. Meta Graph would give reach on accounts NOT published through
-- PostFlow, which is a later addition rather than the starting point.
--
-- Metrics are stored per day rather than overwritten because social numbers keep
-- moving after publication - a post's reach on day 7 is a different fact from
-- its reach on day 1, and overwriting would make trend analysis impossible.
begin;

alter table public.clients
  add column if not exists postflow_group_id text;

create table if not exists public.social_posts (
  id           bigint generated always as identity primary key,
  client_id    uuid not null references public.clients(id) on delete cascade,
  -- PostFlow's own id for the post metric row; stable per network post.
  external_id  text not null,
  platform     text,                       -- twitter | linkedin | instagram | tiktok | …
  post_type    text,                       -- text | image | video | carousel | story | …
  title        text,
  content      text,
  permalink    text,
  posted_at    timestamptz,
  created_at   timestamptz not null default now(),
  unique (client_id, external_id)
);

create index if not exists social_posts_client_idx on public.social_posts(client_id, posted_at desc);

create table if not exists public.social_metrics_daily (
  id             bigint generated always as identity primary key,
  post_id        bigint not null references public.social_posts(id) on delete cascade,
  date           date not null,
  views          int,
  reach          int,
  likes          int,
  shares         int,
  saves          int,
  replies        int,
  engagements    int,
  video_views    int,
  link_clicks    int,
  score          numeric,
  unique (post_id, date)
);

create index if not exists social_metrics_post_idx on public.social_metrics_daily(post_id, date desc);

alter table public.social_posts         enable row level security;
alter table public.social_metrics_daily enable row level security;

drop policy if exists social_posts_read on public.social_posts;
create policy social_posts_read on public.social_posts
  for select to authenticated using (public.has_client_access(client_id));

-- Metrics inherit access from their post rather than carrying client_id twice.
drop policy if exists social_metrics_read on public.social_metrics_daily;
create policy social_metrics_read on public.social_metrics_daily
  for select to authenticated
  using (exists (
    select 1 from public.social_posts p
     where p.id = social_metrics_daily.post_id and public.has_client_access(p.client_id)
  ));

commit;
