#!/usr/bin/env python3
"""The Bet105 drop bot's own price table (tools/ten299-live-cut.sql, architecture program 2026-11-03) on a REAL
throwaway Postgres: ten280_bot.tick_cache, filled by ten280_bot.refresh_cache(), must hold exactly the rows the bot's
direct read of kibl_line_observations selected, through sweeps that commit after the refresh began, a sweep longer than
the 1-hour margin, re-sightings (state / last_seen_at), other books and markets, the daily re-seed and the 15-day prune.
Each guard has a mutant that must turn a check red. No Postgres binaries on this machine → SKIP out loud (never a pass);
CI runners carry them."""
import os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pinarch_pg import PG

SRC = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ten299-live-cut.sql')).read()
pg = PG()
if not pg.available():
    print(f'SKIP  test-ten280-tick-cache-sql: {pg.why} — NOT A PASS (CI runs it)'); sys.exit(0)
passed = failed = 0


def check(name, ok, detail=''):
    global passed, failed
    if ok:
        passed += 1; print('  PASS ', name)
    else:
        failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-500:])


def q(sql):
    rc, out = pg.q(sql)
    if rc:
        raise RuntimeError(sql[:300] + ' :: ' + out)
    return out


def piece(src, start, end):
    i = src.index(start)
    return src[i:src.index(end, i)]


STUBS = """
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
drop schema if exists ten280_bot cascade; create schema ten280_bot;
drop table if exists public.kibl_line_observations, public.kibl_sweeps;
create table public.kibl_line_observations (
  row_key text primary key, fixture_id bigint, side_id integer, price_decimal numeric, inserted_on timestamptz,
  observed_at timestamptz, last_seen_at timestamptz, state text, is_opener boolean, feed_source_id integer,
  market_type_id integer, segment_id integer, betting_type_id integer, is_live boolean);
create table public.kibl_sweeps (sweep_id text primary key, started_at timestamptz, finished_at timestamptz);
"""
T0 = "timestamptz '2026-11-03 12:00:00+00'"
DIRECT = """select o.row_key, o.fixture_id, o.side_id, o.price_decimal, o.inserted_on, o.observed_at, coalesce(o.is_opener, false)
  from public.kibl_line_observations o
 where o.feed_source_id = 171 and o.market_type_id = 1 and o.segment_id = 1 and o.betting_type_id = 1
   and o.is_live is false and o.price_decimal >= 1.01 and o.side_id in (2, 3)
   and o.inserted_on between {lo} and {hi} and o.observed_at <= {hi}"""
CACHE = """select row_key, fixture_id, side_id, price, at, known_at, is_opener from ten280_bot.tick_cache
 where at between {lo} and {hi} and known_at <= {hi}"""


def diff(at):
    lo, hi = f"({at} - interval '14 days')", at
    d, c = DIRECT.format(lo=lo, hi=hi), CACHE.format(lo=lo, hi=hi)
    return int(q(f"select count(*) from (({d} except {c}) union all ({c} except {d})) x").strip())


def obs(key, minutes, observed_min=None, price=2.0, **kw):
    """A row Kibl inserted `minutes` after T0 and we observed `observed_min` after T0 (default the same)."""
    o = observed_min if observed_min is not None else minutes
    cols = dict(feed_source_id=171, market_type_id=1, segment_id=1, betting_type_id=1, is_live='false', side_id=2,
                fixture_id=7, is_opener='false')
    cols.update(kw)
    q(f"insert into public.kibl_line_observations (row_key, fixture_id, side_id, price_decimal, inserted_on, observed_at, "
      f"last_seen_at, state, is_opener, feed_source_id, market_type_id, segment_id, betting_type_id, is_live) values "
      f"('{key}', {cols['fixture_id']}, {cols['side_id']}, {price}, {T0} + interval '{minutes} minutes', "
      f"{T0} + interval '{o} minutes', {T0} + interval '{o} minutes', 'current', {cols['is_opener']}, {cols['feed_source_id']}, "
      f"{cols['market_type_id']}, {cols['segment_id']}, {cols['betting_type_id']}, {cols['is_live']})")


def refresh(minutes):
    q(f"select ten280_bot.refresh_cache({T0} + interval '{minutes} minutes')")


def scenario(src):
    """Returns the per-step diffs (0 = the table equals the direct read)."""
    q(STUBS)
    q(piece(src, 'create table if not exists ten280_bot.tick_cache (',
            'create or replace function ten280_bot.load_ticks('))
    out = {}
    # day 0: a mix of rows the bot reads and rows it never reads (other book, market, live, a marker, side 3 kept)
    obs('a1', -600); obs('a2', -300, side_id=3); obs('x1', -200, feed_source_id=43); obs('x2', -100, market_type_id=2)
    obs('x3', -90, is_live='true'); obs('x4', -80, price='0.0'); obs('old', -16 * 24 * 60)
    refresh(0)
    out['not seeded after one call'] = int(q("select (not seeded)::int from ten280_bot.tick_cache_state").strip()) - 1
    for _ in range(60):
        refresh(0)
    out['seeded after 61 calls (6 h each)'] = int(q("select seeded::int from ten280_bot.tick_cache_state").strip()) - 1
    out['seed'] = diff(f"{T0}")
    # a sweep that began at -20 min and commits after the refresh at 0: its row carries observed_at -20
    obs('late', -25, observed_min=-20); obs('n1', 3)
    refresh(10); out['late commit'] = diff(f"{T0} + interval '10 minutes'")
    # a re-sighting: only state / last_seen_at move (the bot copies neither)
    q("update public.kibl_line_observations set state = 'previous', last_seen_at = last_seen_at + interval '1 hour' where row_key = 'a1'")
    # a sweep longer than the margin: started at -170 min, finished at 15 (after the refresh at 10), its row observed -170
    q(f"insert into public.kibl_sweeps values ('long', {T0} - interval '170 minutes', {T0} + interval '15 minutes')")
    obs('long', -175, observed_min=-170)
    refresh(20); out['long sweep'] = diff(f"{T0} + interval '20 minutes'")
    # the daily re-seed and the 15-day prune
    obs('n2', 25 * 60)
    refresh(25 * 60 + 5); out['daily re-walk'] = diff(f"{T0} + interval '{25 * 60 + 5} minutes'")
    out['the re-walk keeps the table serving (seeded stays true)'] = int(q("select seeded::int from ten280_bot.tick_cache_state").strip()) - 1
    out['15-day prune'] = int(q(f"select count(*) from ten280_bot.tick_cache where at < {T0} + interval '{25 * 60 + 5} minutes' - interval '15 days'").strip())
    return out


r = scenario(SRC)
for k, v in r.items():
    check(f'price table = the direct read: {k}', v == 0, r)
check('the 15-day prune leaves nothing older', r['15-day prune'] == 0, r)

MUT = [
    ('no 1-hour margin (a sweep that commits after the refresh loses its rows)',
     "bound := coalesce(st.read_at, p_now) - interval '1 hour';", "bound := coalesce(st.read_at, p_now);"),
    ('a long sweep that finished since does not move the bound',
     "if sw is not null and sw - interval '1 minute' < bound then bound := sw - interval '1 minute'; end if;", ""),
]
for name, a, b in MUT:
    assert SRC.count(a) == 1, 'mutant anchor gone: ' + name
    m = scenario(SRC.replace(a, b))
    check(f'MUTANT caught: {name}', any(v for k, v in m.items() if k != '15-day prune'), m)
m = scenario(SRC.replace("lo := greatest(st.seed_low - interval '6 hours', horizon);", "lo := horizon;"))
check('MUTANT (control): the whole window in one call seeds at once — the staged walk is what the first two checks see',
      m['seeded after 61 calls (6 h each)'] == 0 and m['not seeded after one call'] != 0, m)

src_t = piece(SRC, 'create or replace function ten280_bot.tick()', '$function$\n;')
check('tick() refreshes the price table before load_ticks reads it',
      src_t.index('ten280_bot.refresh_cache(e)') < src_t.index('ten280_bot.load_ticks('), src_t[:200])
check('until seeded a tick only advances the seed (returns before load_ticks / scan), so it commits inside the timeout',
      src_t.index('ten280_bot.refresh_cache(e)') < src_t.index('if not coalesce((select seeded from ten280_bot.tick_cache_state where id = 1), false) then')
      < src_t.index('ten280_bot.load_ticks('), src_t[:400])
lt = piece(SRC, 'create or replace function ten280_bot.load_ticks(', 'strm as (')
check("load_ticks' poll reads the price table once seeded, the direct read until then (never both)",
      'from ten280_bot.tick_cache c join fx' in lt and "where (select ok from seeded) and c.at between" in lt
      and "where not (select ok from seeded)" in lt)
check('cache_check() compares the table with the direct read over a window, for a by-hand check once seeded',
      'create or replace function ten280_bot.cache_check(' in SRC)
check('the install transaction no longer seeds or compares 15 days (it ran past 25 min and rolled back)',
      'price-table guard' not in SRC)
pg.close()
print(f'\ntest-ten280-tick-cache-sql: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
