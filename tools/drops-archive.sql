-- Dropping Odds archive, "Biggest moves of the past days" (founder 2026-11-28: approved; design
-- design_handoff_dropping_odds_final_2026-11-27 → Dropping Odds Archive.dc.html, LOCKED). Rules: .claude/rules/drops.md.
--
-- WHAT A RECORD IS. One selection (a player to win a match) that the live drop bots flagged — a selection in
-- drops_api.lines(72), so a price of it dropped at some book — once its api-tennis match is decided (Finished or
-- Retired with a winner; a walkover is no match and never a record). It keeps that selection's recorded pre-match
-- series exactly as lines() served them, cut before the verified start (our live poller's last not-live sighting,
-- live_flip_log_current); with no verified start the series are kept whole and the record carries start_at NULL, so
-- the reader never calls a price a close. Every figure (first price, close, biggest single move, the soft books'
-- delay, Bet105 without its margin) is computed by the reader, stennisfy-drops/archive.mjs, never stored.
--
-- WHO WRITES. drops_archive.collect(), pg_cron every 30 min: insert-only (a record is written once), then records older
-- than 90 days go. WHO READS. drops_archive.read(days) for the Fly app's role drops_reader only. Idempotent.
create schema if not exists drops_archive;
revoke all on schema drops_archive from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema drops_archive from anon, authenticated'; end if;
end $$;

create table if not exists drops_archive.records (
    key           text primary key,          -- event_key | the side's surname key
    event_key     bigint not null,
    player_a      text not null,
    player_b      text not null,
    side          text not null,
    side_first    boolean not null,           -- the side is api-tennis's first player
    winner_first  boolean not null,           -- api-tennis's winner is the first player
    status        text not null,              -- 'Finished' | 'Retired'
    event_type    text,
    tournament    text,
    round         text,
    scheduled_at  timestamptz,                -- api-tennis's schedule, for the day the record files under
    start_at      timestamptz,                -- verified start (live poller), NULL when none
    books         jsonb not null,             -- lines() books, series cut before start_at
    recorded_at   timestamptz not null default now()
);
create index if not exists records_sched_idx on drops_archive.records (scheduled_at);
alter table drops_archive.records enable row level security;

-- a series [[at, price], ...] without the points at or after p_cut (NULL = kept whole)
create or replace function drops_archive.cut(p_series jsonb, p_cut timestamptz) returns jsonb
language sql immutable as $$
  select coalesce((select jsonb_agg(e order by o) from jsonb_array_elements(coalesce(p_series, '[]'::jsonb)) with ordinality x(e, o)
                    where p_cut is null or (e->>0)::timestamptz < p_cut), '[]'::jsonb)
$$;

create or replace function drops_archive.collect() returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare n integer;
begin
  with l as (
    select e->>'playerA' pa, e->>'playerB' pb, e->>'side' sp, e->'books' books
      from jsonb_array_elements(drops_api.lines(72)) e
  ),
  fx as (   -- the selection's api-tennis match: both players, decided, exactly one candidate
    select l.*, c.event_key, c.first_player, c.event_status, c.event_winner, c.event_type_type, c.tournament_name,
           c.tournament_round, c.start_utc
      from l
      join lateral (
        select f.* from drops_scope.fixture f
         where ((drops_scope.same(f.first_player, l.pa) and drops_scope.same(f.second_player, l.pb))
             or (drops_scope.same(f.first_player, l.pb) and drops_scope.same(f.second_player, l.pa)))
           and f.start_utc > now() - interval '4 days'
      ) c on true
  ),
  one as (
    select * from fx where (select count(*) from fx y where y.pa = fx.pa and y.pb = fx.pb and y.sp = fx.sp) = 1
       and event_status in ('Finished', 'Retired') and event_winner in ('First Player', 'Second Player')
  ),
  cut as (
    select o.*, lf.last_not_live_seen_at start_at
      from one o left join public.live_flip_log_current lf on lf.event_key = o.event_key::text
  )
  insert into drops_archive.records (key, event_key, player_a, player_b, side, side_first, winner_first, status, event_type,
                                     tournament, round, scheduled_at, start_at, books)
  select c.event_key || '|' || drops_scope.sk(c.sp), c.event_key, c.pa, c.pb, c.sp, drops_scope.same(c.first_player, c.sp),
         c.event_winner = 'First Player', c.event_status, c.event_type_type, c.tournament_name, c.tournament_round, c.start_utc,
         c.start_at,
         coalesce((select jsonb_object_agg(b.key, b.value || jsonb_build_object(
                    'side', drops_archive.cut(b.value->'side', c.start_at), 'other', drops_archive.cut(b.value->'other', c.start_at)))
                     from jsonb_each(c.books) b), '{}'::jsonb)
    from cut c
   where drops_scope.sk(c.sp) is not null
  on conflict (key) do nothing;
  get diagnostics n = row_count;
  delete from drops_archive.records where coalesce(scheduled_at, recorded_at) < now() - interval '90 days';
  return n;
end $$;

-- the Fly app's read: records of the last p_days (1–90), newest first
create or replace function drops_archive.read(p_days integer default 90) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(to_jsonb(r) - 'recorded_at' order by coalesce(r.scheduled_at, r.recorded_at) desc), '[]'::jsonb)
    from drops_archive.records r
   where coalesce(r.scheduled_at, r.recorded_at) >= now() - make_interval(days => least(greatest(p_days, 1), 90))
$$;

revoke all on all functions in schema drops_archive from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all functions in schema drops_archive from anon, authenticated';
    execute 'revoke all on all tables in schema drops_archive from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'drops_reader') then
    execute 'grant usage on schema drops_archive to drops_reader';
    execute 'grant execute on function drops_archive.read(integer) to drops_reader';
  end if;
end $$;

-- every 30 min (an archive needs no faster clock; one lines() call is the endpoint's own 30-s read)
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'drops-archive-collect';
    perform cron.schedule('drops-archive-collect', '7,37 * * * *', 'select drops_archive.collect()');
  end if;
end $$;
