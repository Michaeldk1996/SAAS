-- TEN-299 — the Telegram drop bots stop at the live start (founder comment 8585095a, 2026-09-27; card 518c56f0
-- Q3 = a: the page/endpoint side shipped on TEN-297, the bots' side here, on the same signal).
--
-- THE SIGNAL. Our 10-second api-tennis live poller's first live sighting per event (public.live_flip_log), joined
-- to each bot's events exactly as the drops endpoint joins its rows (stennisfy-drops/status.mjs):
--   * both players: the surname key (accents, hyphens and a Jr/Sr/II suffix ignored) AND the given-name initials
--     agree whenever both names carry given names ("Adolfo Daniel Vallejo" = "D. Vallejo");
--   * the vendor's scheduled start within 24 h of our live sighting (founder 2026-10-26: the sighting, never api-tennis's
--     scheduled time -- TEN-225 ruling 1);
--   * exactly one sighting -> cut at its live time; two or more (ambiguous) -> cut at the vendor's scheduled start.
-- A match with no sighting is not cut here (the vendor's start is not a live signal: Superbet's ran up to 1 h 52 min
-- late). Measured 2026-09-27: every in-play Superbet alert of the last 24 h joined a sighting (30 of 30).
--
-- WHAT CHANGES. Each bot's load_ticks deletes every tick recorded at or after the cut (so current AND reference
-- prices are pre-match: a drop is always measured against a pre-match price) and keeps the cuts in a temp
-- table; its scan evaluates nothing at or after a match's cut (review of 43f06494: a pre-match tick still inside
-- the 10-min window, or one recorded late, would otherwise alert minutes after the start).
-- Cost: the cut covers matches scheduled in the 4 days before the window's end (+2 days of slack); a 10-minute
-- detector never needs older (measured 2026-09-27: the full 16 days cost 0.68 s a tick for Bet105).
-- load_ticks below are the LIVE definitions (read from the database 2026-09-27) plus that one delete, nothing else.
-- ⚠️ The bots' branches (ten280-probe, ten287-probe) still carry the pre-TEN-299 load_ticks: a re-install from
-- them reverts this. This file re-applies on every ten294-drops install (tools/ten294-steps-install.json).
-- ONE transaction: the guard at the end raises on any failure and nothing is installed.
begin;
-- the first install of the Bet105 price table seeds it (a 15-day read) and the guard compares it with the direct read:
-- on a throttled disk that is minutes, not seconds (3 Nov: 8,367 disk reads took 47 s)
set local statement_timeout = '25min';
create schema if not exists drops_live;
revoke all on schema drops_live from public, anon, authenticated;

-- the join surname key: status.mjs sk()
create or replace function drops_live.sk(p text) returns text
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select lower(regexp_replace(regexp_replace(regexp_replace(btrim(regexp_replace(
           regexp_replace(normalize(coalesce(case when p like '%,%' then split_part(p, ',', 1) else p end, ''), NFD),
                          '[̀-ͯ]', '', 'g'), '-', ' ', 'g')),
           '\s+(jr|sr|ii|iii|iv)\.?$', '', 'i'), '^.*\s', ''), '[^A-Za-z]', '', 'g'))
$$;
-- every given name's initial: status.mjs initials()
create or replace function drops_live.gi(p text) returns text[]
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select coalesce(array(select distinct left(w, 1) from regexp_split_to_table(lower(regexp_replace(normalize(
           case when coalesce(p, '') like '%,%' then split_part(p, ',', 2) else regexp_replace(btrim(coalesce(p, '')), '\s*\S+$', '') end,
           NFD), '[̀-ͯ]', '', 'g')), '[^a-z]+') w where w <> ''), '{}')
$$;
create or replace function drops_live.ini_ok(a text, b text) returns boolean
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select cardinality(drops_live.gi(a)) = 0 or cardinality(drops_live.gi(b)) = 0 or drops_live.gi(a) && drops_live.gi(b)
$$;
-- singles sightings since p_from, keyed once. The join window is measured from the sighting itself (live_at), a real
-- observed instant; the API's scheduled time is not read here (TEN-225 ruling 1). The old definition returned one more
-- column, so it is dropped first (create or replace cannot change a return type; its callers are SQL functions, untracked).
drop function if exists drops_live.flips(timestamptz);
create or replace function drops_live.flips(p_from timestamptz)
returns table(event_key text, live_at timestamptz, p1 text, p2 text, k1 text, k2 text)
language sql stable set search_path = pg_catalog, pg_temp as $$
  select f.event_key, f.first_live_seen_at,
         f.first_player, f.second_player, drops_live.sk(f.first_player), drops_live.sk(f.second_player)
    from public.live_flip_log_current f   -- superseded false starts skipped (20261027120000)
   where f.first_live_seen_at >= p_from
     and coalesce(f.first_player, '') not like '%/%' and coalesce(f.second_player, '') not like '%/%'
$$;
-- (vendor event, candidate sighting) pairs, both orientations; the caller keeps exactly-one
create or replace function drops_live.cut_of(p_start timestamptz, p_keys text[], p_live timestamptz[]) returns timestamptz
language sql immutable as $$
  select case when cardinality(p_keys) = 1 then p_live[1] else p_start end
$$;

-- Superbet (ten287_rec.events: "Surname, First" or "First Surname")
create or replace function drops_live.cuts_287(p_from timestamptz) returns table(event_id bigint, cut_at timestamptz)
language sql stable set search_path = pg_catalog, pg_temp as $$
  with ev as (
    select e.event_id, e.home, e.away, e.start_at, drops_live.sk(e.home) h, drops_live.sk(e.away) a
      from ten287_rec.events e
     where e.start_at >= p_from and coalesce(e.home, '') not like '%/%' and coalesce(e.away, '') not like '%/%'
  ), fl as (select * from drops_live.flips(p_from - interval '1 day')),
  m as (
    select ev.event_id, ev.start_at, fl.event_key, fl.live_at from ev join fl on fl.k1 = ev.h and fl.k2 = ev.a
     where ev.h <> '' and ev.a <> '' and drops_live.ini_ok(fl.p1, ev.home) and drops_live.ini_ok(fl.p2, ev.away) and abs(extract(epoch from fl.live_at - ev.start_at)) < 86400
    union
    select ev.event_id, ev.start_at, fl.event_key, fl.live_at from ev join fl on fl.k1 = ev.a and fl.k2 = ev.h
     where ev.h <> '' and ev.a <> '' and drops_live.ini_ok(fl.p1, ev.away) and drops_live.ini_ok(fl.p2, ev.home) and abs(extract(epoch from fl.live_at - ev.start_at)) < 86400
  )
  select event_id, drops_live.cut_of(min(start_at), array_agg(distinct event_key), array_agg(live_at order by live_at))
    from m group by event_id
$$;

-- Bet105 (public.kibl_fixtures: "First Surname"; the bot's leagues 19 / 537 / 962)
create or replace function drops_live.cuts_280(p_from timestamptz) returns table(fixture_id bigint, cut_at timestamptz)
language sql stable set search_path = pg_catalog, pg_temp as $$
  with ev as (
    select f.fixture_id, f.player1_name p1, f.player2_name p2, f.scheduled_start st,
           drops_live.sk(f.player1_name) h, drops_live.sk(f.player2_name) a
      from public.kibl_fixtures f
     where f.league_id in (19, 537, 962) and f.scheduled_start >= p_from
       and f.player1_name is not null and f.player2_name is not null
  ), fl as (select * from drops_live.flips(p_from - interval '1 day')),
  m as (
    select ev.fixture_id, ev.st, fl.event_key, fl.live_at from ev join fl on fl.k1 = ev.h and fl.k2 = ev.a
     where ev.h <> '' and ev.a <> '' and drops_live.ini_ok(fl.p1, ev.p1) and drops_live.ini_ok(fl.p2, ev.p2) and abs(extract(epoch from fl.live_at - ev.st)) < 86400
    union
    select ev.fixture_id, ev.st, fl.event_key, fl.live_at from ev join fl on fl.k1 = ev.a and fl.k2 = ev.h
     where ev.h <> '' and ev.a <> '' and drops_live.ini_ok(fl.p1, ev.p2) and drops_live.ini_ok(fl.p2, ev.p1) and abs(extract(epoch from fl.live_at - ev.st)) < 86400
  )
  select fixture_id, drops_live.cut_of(min(st), array_agg(distinct event_key), array_agg(live_at order by live_at))
    from m group by fixture_id
$$;
revoke all on all functions in schema drops_live from public, anon, authenticated;

-- ── the bots' load_ticks: the live definitions + the cut ──
create or replace function ten287_bot.load_ticks(p_book text, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
AS $fn$
declare n integer;
begin
  drop table if exists pg_temp.t287;
  create temp table t287 as
  with raw as (
    select t.event_id, s.side, s.price, t.book_updated_at as at, t.seen_at as known_at, t.event_status
    from ten287_rec.ticks t
    join ten287_rec.events e using (event_id)
    cross join lateral (values ('home', t.back_home), ('away', t.back_away)) s(side, price)
    where t.book = p_book and e.tier is not null
      and coalesce(t.event_status, e.status) = 'pending'   -- a tick without a status falls back to the event's current one
      and s.price >= 1.01 and t.book_updated_at is not null
      and t.book_updated_at between p_from and p_to and t.seen_at <= p_to
  ),
  ordered as (
    select *, lag(price) over (partition by event_id, side order by at, known_at) as prev_price from raw
  )
  select event_id, side, price, at, known_at from ordered where prev_price is distinct from price;
  create index on t287 (event_id, side, at);
  -- TEN-299 (founder comment 8585095a, card 518c56f0): no price at or after the match's live start is
  -- pre-match; with the in-play ticks gone, no alert fires on a started match and every drop is measured
  -- against a pre-match price. The cut is drops_live.cuts_287 (tools/ten299-live-cut.sql).
  -- the cuts stay in pg_temp.cut287 for this bot's scan, which evaluates nothing at or after a cut
  drop table if exists pg_temp.cut287;
  create temp table cut287 as select * from drops_live.cuts_287(greatest(p_from, p_to - interval '4 days') - interval '2 days');
  delete from pg_temp.t287 t using pg_temp.cut287 c
   where t.event_id = c.event_id and t.at >= c.cut_at;
  select count(*) into n from t287;
  return n;
end $fn$
;

-- ── THE Bet105 BOT'S OWN PRICE TABLE (architecture program, 2026-11-03) ──────────────────────────────────────────
-- load_ticks read 14 days of match-winner prices straight from kibl_line_observations (887 MB) on every 30-s tick:
-- pg_stat_statements on 3 Nov, ten280_bot.tick() 4,785 calls, mean 39.2 s, 140 M blocks read — the bot ran back to
-- back and the database's disk was throttled for every reader (the sweep failed, card prices froze from 11:30Z).
-- The bot now reads its own copy of exactly the rows the poll CTE selected. A row of kibl_line_observations is
-- inserted once (ignore-duplicates) and afterwards only `state` and `last_seen_at` move — none of the columns kept
-- here — and nothing deletes from it, so each tick adds only the rows first OBSERVED since the last refresh began,
-- re-reading an hour back (a sweep stamps observed_at at its start and commits later; longest sweep 3 Nov 44 min),
-- or back to the start of any sweep that finished since, if earlier. A full re-seed runs daily.
create table if not exists ten280_bot.tick_cache (
  row_key    text primary key,
  fixture_id bigint not null,
  side_id    integer not null,
  price      numeric not null,
  at         timestamptz not null,       -- the row's inserted_on (Kibl's clock)
  known_at   timestamptz not null,       -- the row's observed_at (ours)
  is_opener  boolean not null
);
create index if not exists ten280_tick_cache_fx on ten280_bot.tick_cache (fixture_id, side_id, at);
create index if not exists ten280_tick_cache_at on ten280_bot.tick_cache (at);
create table if not exists ten280_bot.tick_cache_state (
  id smallint primary key default 1 check (id = 1), read_at timestamptz, full_at timestamptz, rows_added integer);
-- seed_low: the table holds every qualifying row OBSERVED at or after it; the seed walks it back 6 h per tick until
-- it reaches the 15-day window (seeded), so no single statement reads the whole window (3 Nov: a one-shot 15-day seed
-- ran past 25 min on the throttled disk and rolled back)
alter table ten280_bot.tick_cache_state add column if not exists seed_low timestamptz;
alter table ten280_bot.tick_cache_state add column if not exists seeded boolean not null default false;
revoke all on ten280_bot.tick_cache, ten280_bot.tick_cache_state from public, anon, authenticated;
alter table ten280_bot.tick_cache enable row level security;
alter table ten280_bot.tick_cache_state enable row level security;

create or replace function ten280_bot.refresh_cache(p_now timestamptz default now()) returns integer
 LANGUAGE plpgsql
AS $fn$
-- each call: (1) the rows first observed since the last call began, re-read an hour back (a sweep stamps observed_at at
-- its start and commits later) or back to the start of any sweep that finished since; (2) while not yet seeded, 6 more
-- hours of history further back, by observed_at (indexed). A day after the seed completed, it starts again from now
-- (re-reading, never deleting: rows only ever arrive). Rows outside the 15-day window leave the table.
declare st ten280_bot.tick_cache_state; bound timestamptz; sw timestamptz; lo timestamptz; n integer := 0; m integer;
        horizon timestamptz := p_now - interval '15 days' - interval '1 hour';
begin
  select * into st from ten280_bot.tick_cache_state where id = 1;
  if st.id is null then
    insert into ten280_bot.tick_cache_state (id, read_at, full_at, rows_added, seed_low, seeded) values (1, null, null, 0, p_now, false);
    select * into st from ten280_bot.tick_cache_state where id = 1;
  elsif st.seed_low <= horizon and st.full_at < p_now - interval '1 day' then
    -- the daily re-walk: the table keeps serving the bot (seeded stays true) while one more day per call is re-read
    update ten280_bot.tick_cache_state set seed_low = p_now where id = 1;
    select * into st from ten280_bot.tick_cache_state where id = 1;
  end if;
  -- (1) new rows
  bound := coalesce(st.read_at, p_now) - interval '1 hour';
  select min(started_at) into sw from public.kibl_sweeps where finished_at >= coalesce(st.read_at, p_now) - interval '5 minutes';
  if sw is not null and sw - interval '1 minute' < bound then bound := sw - interval '1 minute'; end if;
  insert into ten280_bot.tick_cache (row_key, fixture_id, side_id, price, at, known_at, is_opener)
  select o.row_key, o.fixture_id, o.side_id, o.price_decimal, o.inserted_on, o.observed_at, coalesce(o.is_opener, false)
    from public.kibl_line_observations o
   where o.feed_source_id = 171 and o.market_type_id = 1 and o.segment_id = 1
     and o.betting_type_id = 1 and o.is_live is false and o.price_decimal >= 1.01
     and o.side_id in (2, 3) and o.inserted_on is not null and o.observed_at is not null
     and o.inserted_on >= p_now - interval '15 days'
     and o.observed_at >= bound
  on conflict (row_key) do nothing;
  get diagnostics m = row_count; n := n + m;
  -- (2) one day of history, while the walk has not reached the 15-day window
  if st.seed_low > horizon then
    lo := greatest(st.seed_low - interval '6 hours', horizon);   -- 6 h a tick: inside the 2-min statement timeout on a throttled disk
    insert into ten280_bot.tick_cache (row_key, fixture_id, side_id, price, at, known_at, is_opener)
    select o.row_key, o.fixture_id, o.side_id, o.price_decimal, o.inserted_on, o.observed_at, coalesce(o.is_opener, false)
      from public.kibl_line_observations o
     where o.feed_source_id = 171 and o.market_type_id = 1 and o.segment_id = 1
       and o.betting_type_id = 1 and o.is_live is false and o.price_decimal >= 1.01
       and o.side_id in (2, 3) and o.inserted_on is not null
       and o.inserted_on >= p_now - interval '15 days'
       and o.observed_at >= lo and o.observed_at < st.seed_low
    on conflict (row_key) do nothing;
    get diagnostics m = row_count; n := n + m;
    update ten280_bot.tick_cache_state set seed_low = lo, seeded = (st.seeded or lo <= horizon),
           full_at = case when lo <= horizon then p_now else full_at end where id = 1;
  end if;
  delete from ten280_bot.tick_cache where at < p_now - interval '15 days';
  update ten280_bot.tick_cache_state set read_at = p_now, rows_added = n where id = 1;
  return n;
end $fn$
;

-- the table vs the direct read over the last `p_hours` (0 = equal): run by hand once seeded, never by the cron
create or replace function ten280_bot.cache_check(p_hours integer default 6) returns integer
 LANGUAGE sql
AS $fn$
  with d as (
    select o.row_key, o.fixture_id, o.side_id, o.price_decimal as price, o.inserted_on as at, o.observed_at as known_at,
           coalesce(o.is_opener, false) as is_opener
      from public.kibl_line_observations o
     where o.feed_source_id = 171 and o.market_type_id = 1 and o.segment_id = 1 and o.betting_type_id = 1
       and o.is_live is false and o.price_decimal >= 1.01 and o.side_id in (2, 3)
       and o.observed_at >= now() - make_interval(hours => p_hours) - interval '1 hour'
       and o.inserted_on between now() - make_interval(hours => p_hours) and now() and o.observed_at <= now()),
  c as (
    select row_key, fixture_id, side_id, price, at, known_at, is_opener from ten280_bot.tick_cache
     where at between now() - make_interval(hours => p_hours) and now() and known_at <= now())
  select ((select count(*) from (select * from d except select * from c) x) + (select count(*) from (select * from c except select * from d) y))::integer
$fn$
;


create or replace function ten280_bot.load_ticks(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
AS $fn$
declare n integer;
begin
  drop table if exists pg_temp.t280;
  create temp table t280 as
  with fx as (
    select fixture_id, league_id, player1_name, player2_name
    from public.kibl_fixtures
    where league_id in (19, 537, 962) and player1_name is not null and player2_name is not null
  ),
  seeded as (select coalesce((select seeded from ten280_bot.tick_cache_state where id = 1), false) as ok),
  poll as (
    -- once seeded, the bot's own copy of these rows (ten280_bot.tick_cache, refreshed by tick()): the same filter,
    -- applied when the row was copied, and the same window here; until then the direct read, as before
    select c.fixture_id, c.side_id, c.price, c.at, c.known_at, c.is_opener, c.row_key, 'poller'::text as src
    from ten280_bot.tick_cache c join fx using (fixture_id)
    where (select ok from seeded) and c.at between p_from and p_to
      and c.known_at <= p_to             -- as known at p_to: a re-run over a past window is reproducible
    union all
    select o.fixture_id, o.side_id, o.price_decimal as price, o.inserted_on as at,
           o.observed_at as known_at, coalesce(o.is_opener, false) as is_opener, o.row_key, 'poller'::text as src
    from public.kibl_line_observations o join fx using (fixture_id)
    where not (select ok from seeded)
      and o.feed_source_id = 171 and o.market_type_id = 1 and o.segment_id = 1
      and o.betting_type_id = 1 and o.is_live is false and o.price_decimal >= 1.01
      and o.side_id in (2, 3)
      and o.inserted_on between p_from and p_to
      and o.observed_at <= p_to
  ),
  strm as (
    select h.fixture_id,
           coalesce((select o.side_id from public.kibl_line_observations o where o.row_key = h.row_key limit 1),
                    case when ten280_bot.skey(fx.player1_name) = ten280_bot.skey(fx.player2_name) then null  -- same surname: never guess
                         when h.side_key = ten280_bot.skey(fx.player1_name) then 2
                         when h.side_key = ten280_bot.skey(fx.player2_name) then 3 end) as side_id,
           h.price, h.kibl_inserted_on as at, h.written_at as known_at, false as is_opener, h.row_key, 'stream'::text as src
    from public.kibl_now_history h join fx using (fixture_id)
    where h.price >= 1.01 and h.kibl_inserted_on between p_from and p_to and h.written_at <= p_to
      and not exists (select 1 from poll p where p.row_key = h.row_key)
  )
  select * from poll
  union all
  select * from strm where side_id in (2, 3);
  create index on t280 (fixture_id, side_id, at);
  create index on t280 (at);
  -- TEN-299 (founder comment 8585095a, card 518c56f0): no price at or after the match's live start is
  -- pre-match; with the in-play ticks gone, no alert fires on a started match and every drop is measured
  -- against a pre-match price. The cut is drops_live.cuts_280 (tools/ten299-live-cut.sql).
  -- the cuts stay in pg_temp.cut280 for this bot's scan, which evaluates nothing at or after a cut
  drop table if exists pg_temp.cut280;
  create temp table cut280 as select * from drops_live.cuts_280(greatest(p_from, p_to - interval '4 days') - interval '2 days');
  delete from pg_temp.t280 t using pg_temp.cut280 c
   where t.fixture_id = c.fixture_id and t.at >= c.cut_at;
  select count(*) into n from t280;
  return n;
end $fn$
;

-- ── the bots' scan: the live definitions + the at-or-after-the-cut exclusion ──
create or replace function ten287_bot.scan(p_book text, p_from timestamp with time zone, p_to timestamp with time zone, p_threshold numeric, p_mode text, p_run text, p_window interval DEFAULT '00:10:00'::interval, p_floor numeric DEFAULT NULL::numeric, p_cooldown interval DEFAULT '00:30:00'::interval)
 RETURNS integer
 LANGUAGE plpgsql
AS $fn$
declare
  e   timestamptz := case when p_from = p_to then p_from else date_trunc('minute', p_from) end;
  n   integer := 0;
  c   record; op record; ev record; aid bigint;
  o_price numeric; o_at timestamptz; o_kind text;
begin
  while e <= p_to loop
    for c in
      with cur as (
        select distinct on (event_id, side) event_id, side, price as cur_price, at as cur_at
        from pg_temp.t287
        where known_at <= e and at <= e and at > e - p_window
          -- TEN-299: a match is not evaluated once e reaches its live start (a pre-match tick still inside the
          -- 10-min window, or one recorded late, would otherwise alert after the start)
          and not exists (select 1 from pg_temp.cut287 x where x.event_id = t287.event_id and x.cut_at <= e)
        order by event_id, side, at desc, known_at desc
      )
      select cur.*, r.price as ref_price, r.at as ref_at,
             round((r.price - cur.cur_price) / r.price * 100, 2) as pct_10m
      from cur
      cross join lateral (
        select x.price, x.at from pg_temp.t287 x
        where x.event_id = cur.event_id and x.side = cur.side and x.at <= e - p_window and x.known_at <= e
        order by x.at desc, x.known_at desc limit 1) r
      where (p_floor is null or cur.cur_price >= p_floor)
        and (r.price - cur.cur_price) / r.price * 100 >= p_threshold
      order by pct_10m desc, event_id, side
    loop
      if exists (select 1 from ten287_bot.alerts a
                 where a.mode = p_mode and a.run_id is not distinct from p_run and a.book = p_book
                   and a.threshold = p_threshold and a.event_id = c.event_id and a.eval_at > e - p_cooldown) then
        continue;
      end if;
      select e2.home, e2.away, e2.tier into ev from ten287_rec.events e2 where e2.event_id = c.event_id;
      -- Opening: the vendor's first record when we have it, else our own first sighting of that side.
      select case c.side when 'home' then o.open_home else o.open_away end, o.open_at
        into o_price, o_at
        from ten287_rec.openings o where o.event_id = c.event_id and o.book = p_book and o.status_code = 200;
      if o_price is not null and o_price >= 1.01 and o_at is not null then
        o_kind := 'vendor first record';
      else
        select price, at into op from pg_temp.t287
         where event_id = c.event_id and side = c.side and known_at <= e order by at asc limit 1;
        o_price := op.price; o_at := op.at; o_kind := 'first seen';
      end if;
      insert into ten287_bot.alerts (mode, run_id, book, threshold, event_id, side, tier, player_a, player_b, side_player,
          eval_at, ref_price, ref_at, cur_price, cur_at, pct_10m, open_price, open_at, open_kind, pct_open)
      values (p_mode, p_run, p_book, p_threshold, c.event_id, c.side, ev.tier,
          ten287_bot.disp(ev.home), ten287_bot.disp(ev.away),
          ten287_bot.disp(case c.side when 'home' then ev.home else ev.away end),
          e, c.ref_price, c.ref_at, c.cur_price, c.cur_at, c.pct_10m, o_price, o_at, o_kind,
          case when o_price is not null then round((c.cur_price - o_price) / o_price * 100, 2) end)
      returning id into aid;
      update ten287_bot.alerts set message = ten287_bot.render(alerts, e) where id = aid;
      n := n + 1;
      o_price := null; o_at := null; o_kind := null;
    end loop;
    e := e + interval '1 minute';
  end loop;
  return n;
end $fn$
;

create or replace function ten280_bot.scan(p_from timestamp with time zone, p_to timestamp with time zone, p_threshold numeric, p_mode text, p_run text, p_window interval DEFAULT '00:10:00'::interval, p_floor numeric DEFAULT NULL::numeric, p_cooldown interval DEFAULT '00:30:00'::interval)
 RETURNS integer
 LANGUAGE plpgsql
AS $fn$
declare
  -- a single instant (the live tick) is evaluated AS IS, so a 30 s schedule sees
  -- ticks known up to that second; a range (backtest / self-test) steps by whole minutes.
  e   timestamptz := case when p_from = p_to then p_from else date_trunc('minute', p_from) end;
  n   integer := 0;
  c   record;
  op  record;
  fx  record;
  aid bigint;
begin
  while e <= p_to loop
    for c in
      with cur as (
        select distinct on (fixture_id, side_id) fixture_id, side_id, price as cur_price, at as cur_at, src as cur_src
        from pg_temp.t280
        -- only sides that moved inside the window can have dropped; their latest
        -- known tick is then this in-window one (a later tick would be in it too)
        where known_at <= e and at <= e and at > e - p_window
          -- TEN-299: a match is not evaluated once e reaches its live start (a pre-match tick still inside the
          -- 10-min window, or one recorded late, would otherwise alert after the start)
          and not exists (select 1 from pg_temp.cut280 x where x.fixture_id = t280.fixture_id and x.cut_at <= e)
        order by fixture_id, side_id, at desc
      )
      select cur.*, r.price as ref_price, r.at as ref_at,
             round((r.price - cur.cur_price) / r.price * 100, 2) as pct_10m
      from cur
      cross join lateral (
        select x.price, x.at from pg_temp.t280 x
        where x.fixture_id = cur.fixture_id and x.side_id = cur.side_id
          and x.at <= e - p_window and x.known_at <= e
        order by x.at desc limit 1) r
      where cur.cur_at > e - p_window
        and (p_floor is null or cur.cur_price >= p_floor)
        and (r.price - cur.cur_price) / r.price * 100 >= p_threshold
      order by pct_10m desc, fixture_id, side_id
    loop
      if exists (select 1 from ten280_bot.alerts a
                 where a.mode = p_mode and a.run_id is not distinct from p_run
                   and a.threshold = p_threshold
                   and a.fixture_id = c.fixture_id and a.eval_at > e - p_cooldown) then
        continue;
      end if;
      select price, at, is_opener into op from pg_temp.t280
       where fixture_id = c.fixture_id and side_id = c.side_id and known_at <= e
       order by at asc, is_opener desc limit 1;
      select f.league_id, f.player1_name, f.player2_name into fx
        from public.kibl_fixtures f where f.fixture_id = c.fixture_id;
      insert into ten280_bot.alerts (mode, run_id, threshold, fixture_id, side_id, league_id, tier,
          player_a, player_b, side_player, eval_at, ref_price, ref_at, cur_price, cur_at, cur_src, pct_10m,
          open_price, open_at, open_is_opener, pct_open)
      values (p_mode, p_run, p_threshold, c.fixture_id, c.side_id, fx.league_id, ten280_bot.tier_of(fx.league_id),
          fx.player1_name, fx.player2_name,
          case c.side_id when 2 then fx.player1_name when 3 then fx.player2_name end,
          e, c.ref_price, c.ref_at, c.cur_price, c.cur_at, c.cur_src, c.pct_10m,
          op.price, op.at, op.is_opener, round((c.cur_price - op.price) / op.price * 100, 2))
      returning id into aid;
      -- backtest/self-test text is rendered as of the detection minute; the live
      -- tick re-renders it at the moment it sends, so "Moved" is send-time.
      update ten280_bot.alerts set message = ten280_bot.render(alerts, e) where id = aid;
      n := n + 1;
    end loop;
    e := e + interval '1 minute';
  end loop;
  return n;
end $fn$
;

-- tick(): the LIVE definition (read from the database 2026-11-03) plus one line — the price table is refreshed before
-- load_ticks reads it.
create or replace function ten280_bot.tick()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
-- evaluated at the tick instant (cron every 30 s, founder 2026-09-25)
declare e timestamptz := now(); n integer; a ten280_bot.alerts; rid bigint;
        v_at timestamptz; msg text; fl numeric;
begin
  -- one tick at a time: a manual call during a cron run can never double-send
  if not pg_try_advisory_xact_lock(280280) then
    return 0;
  end if;
  perform ten280_bot.settle();
  perform ten280_bot.refresh_cache(e);
  -- while the price table is still seeding, a tick only advances the seed and stops: the direct 14-day read ran past
  -- the 2-min statement timeout on every tick (4 Nov 03:48–04:11Z) and its rollback undid the seed step with it
  if not coalesce((select seeded from ten280_bot.tick_cache_state where id = 1), false) then
    return 0;
  end if;
  perform ten280_bot.load_ticks(now() - interval '14 days', now());
  select min_dropped_to_price into fl from ten280_bot.config;
  n := ten280_bot.scan(e, e, 5, 'live', null, interval '10 minutes', fl);
  for a in select * from ten280_bot.alerts where mode = 'live' and delivery = 'unsent' order by id limit 10 loop  -- Telegram burst cap; the rest go next tick
    v_at := clock_timestamp();
    msg  := ten280_bot.render(a, v_at);
    rid  := ten280_bot.send(msg);
    update ten280_bot.alerts set net_request_id = rid, message = msg,
                                 sent_at = case when rid is not null then v_at end,
                                 move_delay_s = case when rid is not null then round(extract(epoch from (v_at - a.cur_at))::numeric, 3) end,
                                 delivery = case when rid is null then 'unsent: no vault secret' else 'queued' end
     where id = a.id;
  end loop;
  return n;
end $function$
;

-- INSTALL GUARD (same transaction as the definitions above): both bots' load_ticks must run and leave no tick at
-- or after a cut, and the signal must exist; any failure raises and the whole install rolls back, so a broken
-- definition can never reach the 30-s cron.
do $$
declare c int; k int;
begin
  perform ten287_bot.load_ticks('Superbet', now() - interval '3 days', now());
  select count(*) into c from pg_temp.t287 t join drops_live.cuts_287(now() - interval '5 days') x using (event_id) where t.at >= x.cut_at;
  if c <> 0 then raise exception 'TEN-299 guard: % Superbet ticks left after the live cut', c; end if;
  perform ten280_bot.load_ticks(now() - interval '3 days', now());
  select count(*) into c from pg_temp.t280 t join drops_live.cuts_280(now() - interval '5 days') x using (fixture_id) where t.at >= x.cut_at;
  if c <> 0 then raise exception 'TEN-299 guard: % Bet105 ticks left after the live cut', c; end if;
  perform ten287_bot.scan('Superbet', now(), now(), 5, 'selftest', 'ten299-guard', interval '10 minutes', null, interval '0 minutes');
  perform ten280_bot.scan(now(), now(), 5, 'selftest', 'ten299-guard', interval '10 minutes', null, interval '0 minutes');
  select count(*) into k from drops_live.flips(now() - interval '3 days');
  if k = 0 then raise exception 'TEN-299 guard: no live sightings in 3 days (the poller is down): not installing a cut that cannot fire'; end if;
end $$;
commit;
