-- TEN-299 — the Telegram drop bots stop at the live start (founder comment 8585095a, 2026-09-27; card 518c56f0
-- Q3 = a: the page/endpoint side shipped on TEN-297, the bots' side here, on the same signal).
--
-- THE SIGNAL. Our 10-second api-tennis live poller's first live sighting per event (public.live_flip_log), joined
-- to each bot's events exactly as the drops endpoint joins its rows (stennisfy-drops/status.mjs):
--   * both players: the surname key (accents, hyphens and a Jr/Sr/II suffix ignored) AND the given-name initials
--     agree whenever both names carry given names ("Adolfo Daniel Vallejo" = "D. Vallejo");
--   * the vendor's scheduled start within 24 h of api-tennis's scheduled start;
--   * exactly one sighting -> cut at its live time; two or more (ambiguous) -> cut at the vendor's scheduled start.
-- A match with no sighting is not cut here (the vendor's start is not a live signal: Superbet's ran up to 1 h 52 min
-- late). Measured 2026-09-27: every in-play Superbet alert of the last 24 h joined a sighting (30 of 30).
--
-- WHAT CHANGES. Each bot's load_ticks deletes, from its tick table, every tick recorded at or after the cut. Its
-- scan is unchanged, so an alert needs a current AND a reference price that are both pre-match: nothing fires
-- once a match has started, and a drop is always measured against a pre-match price.
-- Cost: the cut covers matches scheduled in the 4 days before the window's end (+2 days of slack); a 10-minute
-- detector never needs older (measured 2026-09-27: the full 16 days cost 0.68 s a tick for Bet105).
-- load_ticks below are the LIVE definitions (read from the database 2026-09-27) plus that one delete, nothing else.
-- ⚠️ The bots' branches (ten280-probe, ten287-probe) still carry the pre-TEN-299 load_ticks: a re-install from
-- them reverts this. This file re-applies on every ten294-drops install (tools/ten294-steps-install.json).
-- ONE transaction: the guard at the end raises on any failure and nothing is installed.
begin;
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
-- singles sightings since p_from, keyed once (event_time is the API's default zone, Europe/Berlin)
create or replace function drops_live.flips(p_from timestamptz)
returns table(event_key text, live_at timestamptz, sched timestamptz, p1 text, p2 text, k1 text, k2 text)
language sql stable set search_path = pg_catalog, pg_temp as $$
  select f.event_key, f.first_live_seen_at,
         ((f.event_date || ' ' || coalesce(nullif(f.event_time, ''), '00:00'))::timestamp at time zone 'Europe/Berlin'),
         f.first_player, f.second_player, drops_live.sk(f.first_player), drops_live.sk(f.second_player)
    from public.live_flip_log f
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
     where drops_live.ini_ok(fl.p1, ev.home) and drops_live.ini_ok(fl.p2, ev.away) and abs(extract(epoch from fl.sched - ev.start_at)) < 86400
    union
    select ev.event_id, ev.start_at, fl.event_key, fl.live_at from ev join fl on fl.k1 = ev.a and fl.k2 = ev.h
     where drops_live.ini_ok(fl.p1, ev.away) and drops_live.ini_ok(fl.p2, ev.home) and abs(extract(epoch from fl.sched - ev.start_at)) < 86400
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
     where drops_live.ini_ok(fl.p1, ev.p1) and drops_live.ini_ok(fl.p2, ev.p2) and abs(extract(epoch from fl.sched - ev.st)) < 86400
    union
    select ev.fixture_id, ev.st, fl.event_key, fl.live_at from ev join fl on fl.k1 = ev.a and fl.k2 = ev.h
     where drops_live.ini_ok(fl.p1, ev.p2) and drops_live.ini_ok(fl.p2, ev.p1) and abs(extract(epoch from fl.sched - ev.st)) < 86400
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
  delete from pg_temp.t287 t using drops_live.cuts_287(greatest(p_from, p_to - interval '4 days') - interval '2 days') c
   where t.event_id = c.event_id and t.at >= c.cut_at;
  select count(*) into n from t287;
  return n;
end $fn$
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
  poll as (
    select o.fixture_id, o.side_id, o.price_decimal as price, o.inserted_on as at,
           o.observed_at as known_at, coalesce(o.is_opener, false) as is_opener, o.row_key, 'poller'::text as src
    from public.kibl_line_observations o join fx using (fixture_id)
    where o.feed_source_id = 171 and o.market_type_id = 1 and o.segment_id = 1
      and o.betting_type_id = 1 and o.is_live is false and o.price_decimal >= 1.01
      and o.side_id in (2, 3)
      and o.inserted_on between p_from and p_to
      and o.observed_at <= p_to          -- as known at p_to: a re-run over a past window is reproducible
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
  delete from pg_temp.t280 t using drops_live.cuts_280(greatest(p_from, p_to - interval '4 days') - interval '2 days') c
   where t.fixture_id = c.fixture_id and t.at >= c.cut_at;
  select count(*) into n from t280;
  return n;
end $fn$
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
  select count(*) into k from drops_live.flips(now() - interval '3 days');
  if k = 0 then raise exception 'TEN-299 guard: no live sightings in 3 days (the poller is down): not installing a cut that cannot fire'; end if;
end $$;
commit;
