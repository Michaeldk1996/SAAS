-- TEN-294 pop-up (founder 2026-09-26, comment 777a3192, decision 1) — every recorded book quoting a flagged line.
--
-- A drop row is one selection × book (drops.md). The price-move pop-up shows that selection at EVERY book we
-- record a pre-match price for, so the reader can compare books. This returns, per selection flagged in the
-- window, each recorded book's first pre-match price and its last-24h pre-match series for BOTH sides (the
-- other side feeds the margin). Board-matched ATP cards get the same from TEN-295's chart shard on the page;
-- this covers the rows the board does not (most Challenger / ITF).
--
-- Rules (tests: test-ten294-drops.mjs):
--   * books: Bet105 (Kibl poller, feed 171) and every ten287_rec.config book (Superbet, Betfair Exchange);
--   * the same match across vendors = both players' surname keys equal AND starts within 12 h AND exactly ONE
--     candidate — two or more is ambiguous and that book is left out, never guessed;
--   * pre-match only, TEN-295's rule for the recorder: a tick counts while `pending` AND before the event's first
--     non-pending sighting on any book (the vendor flips live -> pending mid-match); Kibl: is_live false;
--   * same-price re-stamps collapse (a point only when the price changed); at most 400 points per side per book,
--     and ALWAYS the latest point even when older than the window (a quoting book that has not moved stays in);
--   * lastSeen = the book's latest sighting of this line, re-stamps included — the page drops a book not seen in 24 h;
--   * the side maps by surname key; a same-surname pair maps nothing for that book.
-- Called by drops_api.snapshot() inside its one read per cadence; nothing here is per-viewer.
create schema if not exists drops_api;   -- this file installs before ten294-drops-api.sql (review: a fresh DB)
revoke all on schema drops_api from public, anon, authenticated;

create or replace function drops_api.nk(p text) returns text
language sql immutable set search_path = pg_catalog, pg_temp as $$
  -- surname key for "First Last" (Kibl, alerts) and "Last, First" (odds-api.io): last token of the surname part
  select regexp_replace(lower(regexp_replace(coalesce(case when p like '%,%' then split_part(p, ',', 1) else p end, ''),
                                             '^.*\s', '')), '[^a-z]', '', 'g')
$$;

create or replace function drops_api.lines(p_hours integer default 24) returns jsonb
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
-- BEGIN LINES QUERY
with al as (
  select a.eval_at, a.player_a pa, a.player_b pb, a.side_player sp, fx.scheduled_start st,
         a.fixture_id fid, null::bigint eid
    from ten280_bot.alerts a left join public.kibl_fixtures fx on fx.fixture_id = a.fixture_id
   where a.mode = 'live' and a.eval_at >= now() - make_interval(hours => p_hours)
  union all
  select a.eval_at, a.player_a, a.player_b, a.side_player, ev.start_at, null::bigint, a.event_id
    from ten287_bot.alerts a left join ten287_rec.events ev on ev.event_id = a.event_id
   where a.mode = 'live' and a.eval_at >= now() - make_interval(hours => p_hours)
),
k as (
  select al.*, drops_api.nk(pa) ka, drops_api.nk(pb) kb, drops_api.nk(sp) ks from al
),
sel as (   -- one per selection: the players/side of its newest alert, any known ids
  select least(ka, kb) k1, greatest(ka, kb) k2, ks,
         (array_agg(pa order by eval_at desc))[1] pa, (array_agg(pb order by eval_at desc))[1] pb,
         (array_agg(sp order by eval_at desc))[1] sp, min(st) st, max(fid) fid, max(eid) eid
    from k where ka <> '' and kb <> '' and ka <> kb and ks in (ka, kb)
   group by 1, 2, 3
),
fx_c as (  -- Kibl fixtures in reach (bounded window), keyed once
  select f.fixture_id, f.scheduled_start, f.player1_name, f.player2_name,
         least(drops_api.nk(f.player1_name), drops_api.nk(f.player2_name)) k1,
         greatest(drops_api.nk(f.player1_name), drops_api.nk(f.player2_name)) k2
    from public.kibl_fixtures f
   where f.scheduled_start >= now() - make_interval(hours => p_hours + 24)
     and f.scheduled_start <  now() + interval '3 days'
),
ev_c as (
  select e.event_id, e.start_at, e.home, e.away,
         least(drops_api.nk(e.home), drops_api.nk(e.away)) k1, greatest(drops_api.nk(e.home), drops_api.nk(e.away)) k2
    from ten287_rec.events e
   where e.start_at >= now() - make_interval(hours => p_hours + 24) and e.start_at < now() + interval '3 days'
     and coalesce(e.home, '') not like '%/%' and coalesce(e.away, '') not like '%/%'
),
m as (     -- the same match at each vendor: the alert's own id, else exactly one candidate
  select s.*,
    coalesce(s.fid, (select case when count(*) = 1 then min(c.fixture_id) end from fx_c c
                      where c.k1 = s.k1 and c.k2 = s.k2
                        and (s.st is null or abs(extract(epoch from c.scheduled_start - s.st)) < 43200))) kfx,
    coalesce(s.eid, (select case when count(*) = 1 then min(c.event_id) end from ev_c c
                      where c.k1 = s.k1 and c.k2 = s.k2
                        and (s.st is null or abs(extract(epoch from c.start_at - s.st)) < 43200))) kev
    from sel s
),
-- ── odds-api.io books (TEN-295's pre-match rule) ──
live_from as (
  select t.event_id, min(least(coalesce(t.book_updated_at, t.seen_at), t.seen_at)) at
    from ten287_rec.ticks t where t.event_id in (select kev from m where kev is not null)
     and t.event_status is distinct from 'pending'
   group by 1
),
tk as (
  select m.k1, m.k2, m.ks, t.book, t.id::text id, t.book_updated_at at, t.seen_at seen,
         case when drops_api.nk(e.home) = m.ks then t.back_home when drops_api.nk(e.away) = m.ks then t.back_away end ps,
         case when drops_api.nk(e.home) = m.ks then t.back_away when drops_api.nk(e.away) = m.ks then t.back_home end po
    from m
    join ten287_rec.ticks t on t.event_id = m.kev
    join ten287_rec.events e on e.event_id = t.event_id
    left join live_from lf on lf.event_id = m.kev
   where t.market = 'ML' and t.event_status = 'pending' and t.book_updated_at is not null
     and exists (select 1 from ten287_rec.config c where c.id and t.book = any (c.books))
     and (lf.at is null or t.book_updated_at < lf.at)
     and drops_api.nk(e.home) <> drops_api.nk(e.away)
),
-- ── Bet105 (Kibl poller, the drop bot's own feed) ──
ko as (
  select m.k1, m.k2, m.ks, 'Bet105'::text book, o.row_key id, o.inserted_on at, coalesce(o.last_seen_at, o.inserted_on) seen,
         o.side_id, o.price_decimal px,
         case when drops_api.nk(f.player1_name) = m.ks then 2 when drops_api.nk(f.player2_name) = m.ks then 3 end side_s
    from m
    join public.kibl_fixtures f on f.fixture_id = m.kfx
    join public.kibl_line_observations o on o.fixture_id = f.fixture_id
   where o.market_type_id = 1 and o.segment_id = 1 and o.feed_source_id = 171 and o.betting_type_id = 1
     and o.is_live is false and o.price_decimal >= 1.01 and o.inserted_on is not null
     and o.side_id in (2, 3)            -- the drop bot's own filter: any other side_id is not a player
     and drops_api.nk(f.player1_name) <> drops_api.nk(f.player2_name)
),
pts as (   -- one stream of (selection, book, which side, time, price)
  select k1, k2, ks, book, id, at, seen, 's' w, ps px from tk where ps >= 1.01
  union all select k1, k2, ks, book, id, at, seen, 'o', po from tk where po >= 1.01
  union all select k1, k2, ks, book, id, at, seen, case when side_id = side_s then 's' else 'o' end, px from ko where side_s is not null
),
chg as (   -- same-price re-stamps collapse
  select *, lag(px) over (partition by k1, k2, ks, book, w order by at, id) prev from pts
),
kept as (
  select *, row_number() over (partition by k1, k2, ks, book, w order by at desc, id desc) rn,
            first_value(px) over (partition by k1, k2, ks, book, w order by at, id) first_px,
            first_value(at) over (partition by k1, k2, ks, book, w order by at, id) first_at
    from chg where prev is distinct from px
),
per_side as (
  select k1, k2, ks, book, w, min(first_px) first_px, min(first_at) first_at,
         coalesce(jsonb_agg(jsonb_build_array(at, round(px::numeric, 3)) order by at, id)
                    filter (where rn = 1 or (rn <= 400 and at >= now() - make_interval(hours => p_hours))), '[]'::jsonb) series
    from kept group by 1, 2, 3, 4, 5
),
per_book as (
  select k1, k2, ks, book,
         jsonb_build_object(
           'source', case when book = 'Bet105' then 'Kibl' else 'odds-api.io' end,
           -- every sighting, re-stamps included (the series collapses them): a book not seen lately is not quoting
           'lastSeen', (select max(p.seen) from pts p where p.k1 = b.k1 and p.k2 = b.k2 and p.ks = b.ks and p.book = b.book),
           'first', (select jsonb_build_array(p.first_at, round(p.first_px::numeric, 3)) from per_side p
                      where p.k1 = b.k1 and p.k2 = b.k2 and p.ks = b.ks and p.book = b.book and p.w = 's'),
           'side',  coalesce((select p.series from per_side p where p.k1 = b.k1 and p.k2 = b.k2 and p.ks = b.ks and p.book = b.book and p.w = 's'), '[]'::jsonb),
           'other', coalesce((select p.series from per_side p where p.k1 = b.k1 and p.k2 = b.k2 and p.ks = b.ks and p.book = b.book and p.w = 'o'), '[]'::jsonb)
         ) j
    from (select distinct k1, k2, ks, book from per_side) b
)
select coalesce(jsonb_agg(jsonb_build_object(
         'key', s.k1 || '|' || s.k2 || '|' || s.ks, 'playerA', s.pa, 'playerB', s.pb, 'side', s.sp,
         'books', coalesce((select jsonb_object_agg(pb.book, pb.j) from per_book pb
                             where pb.k1 = s.k1 and pb.k2 = s.k2 and pb.ks = s.ks), '{}'::jsonb))
       order by s.k1, s.k2, s.ks), '[]'::jsonb)
  from sel s
-- END LINES QUERY
$fn$;

revoke all on function drops_api.lines(integer) from public, anon, authenticated;
revoke all on function drops_api.nk(text) from public, anon, authenticated;
