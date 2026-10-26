#!/usr/bin/env python3
"""bet105 line prices on the stream — offline tests for kibl-stream/line_engine.py (no broker, no database, no network).
Each check names the mutation that turns it red; tools/test-line-engine-mutants.py applies each to a copy and needs red.
  1  nothing is written for a fixture before a full seed: a partial ladder would withdraw lines  (mutant NO_SEED_GATE)
  2  guards run BEFORE the write: an incoherent pair is written dashed, both sides              (mutant GUARDS_SKIPPED)
  3  a tick only when price or status changes; a re-post at the same price updates current only (mutant TICK_EVERY_CHANGE)
  4  a line Kibl stops offering is written once as 'withdrawn', no price                        (mutant NO_WITHDRAW)
  5  the first in-play row closes the fixture: every key 'started', once; later rows ignored    (mutant NO_CLOSE)
  6  dry run (write off): computed and counted, no request sent                                 (mutant DRY_WRITES)
  7  a failed write retries from the NEWEST rows and leaves the written state alone             (mutant FORGET_ON_FAIL)
  8  restart: rows read back are not re-ticked; a line gone since is withdrawn                  (mutant NO_READ_BACK)
  9  isolation: a bad row or a failing store never raises into the Now loop
 12b a start learnt from api-tennis (fixture status or live score) closes too; a market Kibl suspended at the start closes on
      the price that stood until then (mutant CLOSE_LOSES_SUSPENDED)
 13  close freshness: the worker's last check before the start <= 180 s, else no close, counted (mutant CLOSE_ANY_AGE)
 12  the close: a start seen live closes each ok key on its last pre-match price; a dashed pair, a start found at the join
      and the in-play price give none; a restart keeps the close it read back   (mutants CLOSE_ANY_START, CLOSE_ANY_STATUS,
      CLOSE_LOST_ON_RESTART)
 10  other book, other market, superseded row: ignored
 11  the worker: line_engine is wired by hooks only; the Now engine's decisions are byte-identical with it present
"""
import importlib.util
import json
import time
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..'))
SRC = os.environ.get('LE_FILE') or os.path.join(HERE, 'line_engine.py')
spec = importlib.util.spec_from_file_location('line_engine_under_test', SRC)
LE = importlib.util.module_from_spec(spec)
spec.loader.exec_module(LE)
FAILED = []


def check(name, cond, detail=''):
    print(f'  {"ok  " if cond else "FAIL"} {name}' + ('' if cond else f'  {detail}'))
    if not cond:
        FAILED.append(name)


KFX = [{'fixture_id': 771905, 'start_time': '2026-10-25T13:00:00Z', 'name': 'Daniil Medvedev vs Alexander Bublik',
        'league_id': 19,
        'participants': [{'side_id': 2, 'name': 'Daniil Medvedev'}, {'side_id': 3, 'name': 'Alexander Bublik'}]}]
AT = [{'event_key': 12173801, 'event_date': '2026-10-25', 'event_time': '13:00', 'event_type_type': 'Atp Singles',
       'event_first_player': 'D. Medvedev', 'first_player_key': 1093, 'event_second_player': 'A. Bublik',
       'second_player_key': 1895, 'event_status': ''}]
T0 = '2026-10-25T09:00:00Z'


def row(mt, seg, side, point, price, alt=0, ins=T0, opener=False, current=True, live=False, status=1, fsid=171, fid=771905):
    return {'fixture_id': fid, 'market_type_id': mt, 'segment_id': seg, 'side_id': side,
            'participant_side_id': side if side in (2, 3) else 0, 'point': point, 'price_decimal': price, 'alt_id': alt,
            'is_opener': opener, 'is_current': current, 'is_live': live, 'market_status_id': status, 'inserted_on': ins,
            'max_limit': 3900.0, 'feed_source_id': fsid, 'betting_type_id': 2 if live else 1}


SEED = [row(1, 1, 2, 0.0, 1.52), row(1, 1, 3, 0.0, 2.71),
        row(2, 1, 2, -2.5, 2.01), row(2, 1, 3, 2.5, 1.862),
        row(2, 1, 2, -3.5, 2.48, alt=2), row(2, 1, 3, 3.5, 1.571, alt=2),
        row(3, 1, 7, 22.5, 1.66), row(3, 1, 6, 22.5, 2.30),
        row(2, 1, 2, -3.5, 2.40, alt=2, ins='2026-10-24T20:00:00Z', opener=True, current=False)]


class Store:
    def __init__(self, fail=False):
        self.calls, self.fail = [], fail

    def __call__(self, method, path, body, prefer):
        self.calls.append((method, path, body, prefer))
        if self.fail:
            return 503, 'down'
        return 201, ''

    def rows(self, table):
        return [r for m, p, b, _ in self.calls if m == 'POST' and p.startswith(f'/rest/v1/{table}?') for r in b]


def eng(write=True, seed=True):
    e = LE.LineEngine(171, write=write, log=lambda *_: None)
    e.load_written([])
    e.checked()                                   # the worker's heartbeat just landed (the close-freshness clock)
    e.set_mapping(KFX, AT, now_mono=0)
    if seed:
        for r in SEED:
            e.accept(r, now_mono=0)
        e.seeded.add(771905)
    return e


def cur(store):
    return {(r['market'], r['side'], r['line']): r for r in store.rows('line_prices_current')}


print('1  no write before a full seed')
e = eng(seed=False)
s = Store()
e.accept(row(2, 1, 2, -2.5, 2.05, ins='2026-10-25T09:01:00Z'), now_mono=0)
e.flush(s, now_mono=100)
check('a stream row on an unseeded fixture writes nothing', s.calls == [], s.calls)
check('it is counted as held', e.count['held_unseeded'] >= 1, dict(e.count))

print('2  guards before the write')
e, s = eng(), Store()
e.flush(s, now_mono=100)
c = cur(s)
check('Medvedev −2.5 written ok, de-vigged', c[('gh', '1093', -2.5)]['status'] == 'ok' and c[('gh', '1093', -2.5)]['implied'] is not None, c.get(('gh', '1093', -2.5)))
check('Bublik +2.5 is the other side', c[('gh', '1895', 2.5)]['price'] == 1.862)
check('Over 22.5 / Under 22.5', c[('tg', 'over', 22.5)]['price'] == 1.66 and c[('tg', 'under', 22.5)]['price'] == 2.30)
check('the opener on the same line is the open price', c[('gh', '1093', -3.5)]['open_price'] == 2.40, c.get(('gh', '1093', -3.5)))
check('ticks go in before current (append-only history first)',
      [p.split('?')[0] for m, p, b, _ in s.calls] == ['/rest/v1/line_price_ticks', '/rest/v1/line_prices_current'], [p for _, p, _, _ in s.calls])
s2 = Store()
e.accept(row(3, 1, 7, 22.5, 1.20, ins='2026-10-25T09:02:00Z'), now_mono=200)
e.flush(s2, now_mono=300)
c = cur(s2)
check('an incoherent pair is written dashed, BOTH sides (guard b before write)',
      c.get(('tg', 'over', 22.5), {}).get('status') == 'incoherent' and c.get(('tg', 'under', 22.5), {}).get('status') == 'incoherent', c)
check('no implied % on a dashed pair', c[('tg', 'over', 22.5)]['implied'] is None)

print('3  ticks only on change')
e, s = eng(), Store()
e.flush(s, now_mono=100)
s = Store()
e.accept(row(2, 1, 2, -2.5, 2.01, ins='2026-10-25T09:05:00Z'), now_mono=200)
e.flush(s, now_mono=300)
check('same price re-posted: current updated (new Kibl time), no tick',
      len(s.rows('line_prices_current')) == 1 and s.rows('line_price_ticks') == [], (s.rows('line_prices_current'), s.rows('line_price_ticks')))
s = Store()
e.accept(row(2, 1, 2, -2.5, 2.10, ins='2026-10-25T09:06:00Z'), now_mono=400)
e.flush(s, now_mono=500)
check('a price move: one tick, for that key only', [(t['side'], t['line'], t['price']) for t in s.rows('line_price_ticks')] == [('1093', -2.5, 2.10)], s.rows('line_price_ticks'))
s = Store()
e.flush(s, now_mono=600)
check('nothing due -> no request', s.calls == [])

print('4  withdrawn lines')
e, s = eng(), Store()
e.flush(s, now_mono=100)
s = Store()
e.accept(row(2, 1, 2, -4.5, 2.90, alt=2, ins='2026-10-25T09:10:00Z'), now_mono=200)
e.accept(row(2, 1, 3, 4.5, 1.42, alt=2, ins='2026-10-25T09:10:00Z'), now_mono=200)
e.flush(s, now_mono=300)
c = cur(s)
check('the slot moved −3.5 -> −4.5: −3.5 withdrawn, no price', c.get(('gh', '1093', -3.5), {}).get('status') == 'withdrawn'
      and c[('gh', '1093', -3.5)]['price'] is None, c.get(('gh', '1093', -3.5)))
check('… and its other side', c.get(('gh', '1895', 3.5), {}).get('status') == 'withdrawn')
check('−4.5 written ok', c.get(('gh', '1093', -4.5), {}).get('status') == 'ok', c.get(('gh', '1093', -4.5)))
check('the old opener (−3.5) is no open price for −4.5', c[('gh', '1093', -4.5)]['open_price'] is None)
s = Store()
e.accept(row(2, 1, 2, -4.5, 2.95, alt=2, ins='2026-10-25T09:11:00Z'), now_mono=400)
e.flush(s, now_mono=500)
check('withdrawn is written once, not again', ('gh', '1093', -3.5) not in cur(s), list(cur(s)))

print('5  the Closing point')
e, s = eng(), Store()
e.flush(s, now_mono=100)
s = Store()
e.accept(row(2, 1, 2, -2.5, 1.70, live=True, ins='2026-10-25T13:05:00Z'), now_mono=200)
e.flush(s, now_mono=300)
c = cur(s)
check('every key written as started', c and all(r['status'] == 'started' for r in c.values()) and len(c) == 8, {k: v['status'] for k, v in c.items()})
check('the in-play price is never written', c[('gh', '1093', -2.5)]['price'] != 1.70)
s = Store()
e.accept(row(2, 1, 2, -2.5, 2.30, ins='2026-10-25T13:06:00Z'), now_mono=400)
e.accept(row(2, 1, 2, -2.5, 1.60, live=True, ins='2026-10-25T13:07:00Z'), now_mono=400)
e.flush(s, now_mono=500)
check('nothing more for a started fixture', s.calls == [], s.calls)
e = LE.LineEngine(171, write=True, log=lambda *_: None)
e.load_written([])
e.set_mapping(KFX, [dict(AT[0], event_status='Set 1', event_game_result='15 - 0')], now_mono=0)
check('api-tennis already live: started at the join', 771905 in e.started)

print('6  dry run')
e, s = eng(write=False), Store()
e.flush(s, now_mono=100)
check('no request in a dry run', s.calls == [], s.calls)
check('would_write counted', e.count['would_write_current'] == 8 and e.count['would_write_ticks'] == 8, dict(e.count))

print('7  a failed write')
e, bad = eng(), Store(fail=True)
e.flush(bad, now_mono=100)
check('failed: nothing recorded as written', e.written == {} and e.write_ok is False, len(e.written))
check('re-marked due for a retry', 771905 in e.dirty)
e.accept(row(2, 1, 2, -2.5, 2.20, ins='2026-10-25T09:20:00Z'), now_mono=105)
s = Store()
e.flush(s, now_mono=200)
check('the retry writes the NEWEST price', cur(s)[('gh', '1093', -2.5)]['price'] == 2.20 and e.write_ok, cur(s).get(('gh', '1093', -2.5)))

print('8  restart')
e0, s0 = eng(), Store()
e0.flush(s0, now_mono=100)
back = [dict(r) for r in s0.rows('line_prices_current')]
back.append({'event_key': 12173801, 'market': 'gh', 'side': '1093', 'line': -5.5, 'book': 'bet105', 'price': 3.2,
             'implied': 0.3, 'status': 'ok', 'open_price': None, 'max_limit': 3900, 'inserted_on': '2026-10-24T10:00:00Z'})
e = LE.LineEngine(171, write=True, log=lambda *_: None)
e.load_written(json.loads(json.dumps(back, default=str)))
e.set_mapping(KFX, AT, now_mono=0)
for r in SEED:
    e.accept(r, now_mono=0)
e.seeded.add(771905)
s = Store()
e.flush(s, now_mono=100)
check('unchanged rows are not re-ticked after a restart', [t for t in s.rows('line_price_ticks') if t['status'] != 'withdrawn'] == [], s.rows('line_price_ticks'))
check('a line gone since (−5.5) is withdrawn', cur(s).get(('gh', '1093', -5.5), {}).get('status') == 'withdrawn', list(cur(s)))

print('9  isolation')
e = eng()
check('a garbage row does not raise', e.accept({'market_type_id': 2, 'segment_id': 1, 'feed_source_id': 171, 'fixture_id': 771905,
                                                 'is_current': True, 'inserted_on': object()}) in (True, False))


def boom(*a):
    raise RuntimeError('store exploded')


e.flush(boom, now_mono=100)
check('a store that raises does not raise into the caller: counted as a fault', e.count['error_flush'] == 1, dict(e.count))
check('summary always answers', isinstance(e.summary(), dict) and 'counts' in e.summary())

print('10 filters')
e = eng()
n = e.count['accepted']
check('another book is ignored', e.accept(row(2, 1, 2, -2.5, 2.2, fsid=43, ins='2026-10-25T09:30:00Z')) is False)
check('a market we do not price is ignored', e.accept(row(4, 1, 2, 0.0, 2.2, ins='2026-10-25T09:30:00Z')) is False)
check('a superseded row is ignored', e.accept(row(2, 1, 2, -2.5, 2.2, current=False, ins='2026-10-25T09:30:00Z')) is False)
check('an unmatched fixture is ignored', e.accept(row(2, 1, 2, -2.5, 2.2, fid=1, ins='2026-10-25T09:30:00Z')) is False)
check('an older row never replaces a newer one', e.accept(row(2, 1, 2, -2.5, 9.9, ins='2026-10-24T00:00:00Z')) and
      e.rows[771905][(2, 1, 0, 2, 2)]['price_decimal'] == 2.01)
check('nothing above was accepted as a price', e.count['accepted'] == n)

print('12 the close (founder 2026-10-26: the last price before the start, labelled as the close)')
e, s0 = eng(), Store()
e.flush(s0, now_mono=100)
e.accept(row(3, 1, 7, 22.5, 1.20, ins='2026-10-25T12:59:00Z'), now_mono=150)     # Over 22.5 goes incoherent just before
e.accept(row(2, 1, 2, -2.5, 2.05, ins='2026-10-25T12:58:00Z'), now_mono=150)     # the last pre-match move on −2.5
e.accept(row(2, 1, 2, -2.5, 1.70, live=True, ins='2026-10-25T13:05:00Z'), now_mono=200)
s1 = Store()
e.flush(s1, now_mono=300)
c = cur(s1)
check('a start seen live: an ok key closes on its last pre-match price, source kibl-inplay',
      c[('gh', '1093', -2.5)]['close_price'] == 2.05 and c[('gh', '1093', -2.5)]['close_src'] == 'kibl-inplay'
      and c[('gh', '1093', -2.5)]['close_at'] == '2026-10-25T12:58:00Z', c.get(('gh', '1093', -2.5)))
check('… with its de-vigged implied', c[('gh', '1093', -2.5)]['close_implied'] is not None)
check('the in-play price is never the close', all(r['close_price'] != 1.70 for r in c.values()))
check('a pair that was dashed at the start (incoherent) has no close',
      c[('tg', 'over', 22.5)]['close_price'] is None and c[('tg', 'under', 22.5)]['close_price'] is None, c.get(('tg', 'over', 22.5)))
check('every key is still written as started', all(r['status'] == 'started' for r in c.values()))
e2, s2 = eng(), Store()
e2.flush(s2, now_mono=100)
e2.set_mapping(KFX, [dict(AT[0], event_status='Set 1', event_game_result='15 - 0')], now_mono=200)   # the start learnt from api-tennis, not seen live
s2 = Store()
e2.flush(s2, now_mono=300)
c2 = cur(s2)
check('a start learnt from api-tennis while the ladder is held closes too (measured: Kibl sends no in-play row), '
      'source api-tennis-fixtures', len(c2) == 8 and c2[('gh', '1093', -2.5)]['close_price'] == 2.01
      and c2[('gh', '1093', -2.5)]['close_src'] == 'api-tennis-fixtures', [(r['status'], r['close_price'], r['close_src']) for r in c2.values()][:3])
e7, s7 = eng(), Store()
e7.flush(s7, now_mono=100)
e7.accept(row(2, 1, 2, -2.5, 0, status=2, ins='2026-10-25T13:01:00Z'), now_mono=150)   # Kibl suspends -2.5 at the start
e7.accept(row(2, 1, 3, 2.5, 0, status=2, ins='2026-10-25T13:01:00Z'), now_mono=150)
e7.flush(Store(), now_mono=160)
check('api-tennis live score starts the fixture', e7.started_events({12173801}, now_mono=170) == 1)
s7 = Store()
e7.flush(s7, now_mono=300)
c7 = cur(s7).get(('gh', '1093', -2.5)) or {}
check('a market Kibl suspended at the start closes on the price that stood until then (mutant CLOSE_LOSES_SUSPENDED)',
      c7.get('close_price') == 2.01 and c7.get('close_src') == 'api-tennis-live', c7)
back = [dict(r) for r in s1.rows('line_prices_current')]
e3 = LE.LineEngine(171, write=True, log=lambda *_: None)
e3.checked()
e3.load_written(json.loads(json.dumps(back, default=str)))
e3.set_mapping(KFX, [dict(AT[0], event_status='Set 2', event_game_result='30 - 15')], now_mono=0)   # restarted mid-match: live at the first join
for r in SEED:
    e3.accept(r, now_mono=0)
e3.seeded.add(771905)
s3 = Store()
e3.flush(s3, now_mono=100)
k25 = (12173801, 'gh', '1093', -2.5, 'bet105')
check('a restart mid-match keeps the close it read back (never nulled, never rewritten)',
      e3.written[k25]['close_price'] == 2.05 and all(r['close_price'] is not None for r in cur(s3).values()
                                                     if (r['market'], r['side'], r['line']) == ('gh', '1093', -2.5)),
      (e3.written[k25].get('close_price'), cur(s3).get(('gh', '1093', -2.5))))
e8 = LE.LineEngine(171, write=True, log=lambda *_: None)
e8.load_written(json.loads(json.dumps(back, default=str)))   # restarted after the close was captured
e8.set_mapping(KFX, AT, now_mono=0)                          # api-tennis still says not started
for r in SEED:
    e8.accept(r, now_mono=0)
e8.seeded.add(771905)
e8.last_check = time.time() - 600                            # no fresh check: this start can capture nothing new
e8.set_mapping(KFX, [dict(AT[0], event_status='Set 1', event_game_result='15 - 0')], now_mono=0)
s8 = Store()
e8.flush(s8, now_mono=100)
check('a start that cannot capture keeps the close already on record (mutant CLOSE_LOST_ON_RESTART)',
      (cur(s8).get(('gh', '1093', -2.5)) or {}).get('close_price') == 2.05, cur(s8).get(('gh', '1093', -2.5)))
e4 = eng(seed=False)
e4.accept(row(2, 1, 2, -2.5, 1.70, live=True, ins='2026-10-25T13:05:00Z'), now_mono=10)
s4 = Store()
e4.flush(s4, now_mono=100)
check('a start seen before any full seed captures no close (a partial ladder is no close)',
      all(r['close_price'] is None for r in cur(s4).values()) and 771905 not in e4.flip, list(cur(s4).values())[:1])

print('13 close freshness (founder 2026-10-26, item 6: the last check before the start within 180 s)')
for age, want in ((179, True), (181, False)):
    e5, s5 = eng(), Store()
    e5.flush(s5, now_mono=100)
    e5.last_check = time.time() - age
    e5.accept(row(2, 1, 2, -2.5, 1.70, live=True, ins='2026-10-25T13:05:00Z'), now_mono=200)
    s5 = Store()
    e5.flush(s5, now_mono=300)
    c5 = cur(s5).get(('gh', '1093', -2.5)) or {}
    check(f'last check {age} s before the start: ' + ('a close' if want else 'no close, counted'),
          (c5.get('close_price') is not None) == want and (e5.count['close_stale_check'] == (0 if want else 1)), (c5.get('close_price'), dict(e5.count)))
e6 = LE.LineEngine(171, write=True, log=lambda *_: None)
e6.load_written([]); e6.set_mapping(KFX, AT, now_mono=0)
for r in SEED:
    e6.accept(r, now_mono=0)
e6.seeded.add(771905)
e6.accept(row(2, 1, 2, -2.5, 1.70, live=True, ins='2026-10-25T13:05:00Z'), now_mono=200)
check('no check ever made (a worker that never beat): no close', 771905 not in e6.flip and e6.count['close_stale_check'] == 1)

print('14 the close is never cut on start_ts (the api-tennis SCHEDULED time, line_prices.at_start_ts)')
import inspect, re as _re  # noqa: E402
for fn in ('_start', '_close_of', 'started_events', '_accept'):
    body = inspect.getsource(getattr(LE.LineEngine, fn))
    check(f'LineEngine.{fn} never reads start_ts (a close is cut on an OBSERVED start only)', 'start_ts' not in body, fn)
cmp_src = inspect.getsource(LE.LineEngine.compute)
uses = [ln.strip() for ln in cmp_src.splitlines() if 'start_ts' in ln]
check('compute uses start_ts only to copy the scheduled label onto the row, never to cut or compare',
      uses and all(ln.startswith('start = iso(datetime.fromtimestamp(m["start_ts"]') or '"start_ts": start' in ln for ln in uses), uses)

print('15 a live flag at 0-0 is not a start (2026-10-26: api-tennis "Set 1", 0-0, hours before play)')
FALSE = {'event_key': 12173801, 'event_live': '1', 'event_status': 'Set 1', 'event_game_result': '0 - 0', 'event_serve': None,
         'scores': [{'score_first': '0', 'score_second': '0', 'score_set': '1'}], 'pointbypoint': [{'set_number': 'Set 1', 'points': []}]}
check('played(): "Set 1" at 0-0 with no point is NOT play (mutant LIVE_FLAG_IS_START)', LE.played(FALSE) is False)
check('played(): a point on the board is play', LE.played(dict(FALSE, event_game_result='15 - 0')) is True)
check('played(): a set score above 0-0 is play', LE.played(dict(FALSE, scores=[{'score_first': '1', 'score_second': '0'}])) is True)
check('played(): a point in the point-by-point is play', LE.played(dict(FALSE, pointbypoint=[{'points': [{'score': '15 - 0'}]}])) is True)
check('played(): a finished event is play', LE.played(dict(FALSE, event_status='Finished')) is True)
e9 = eng()
e9.set_mapping(KFX, [dict(AT[0], **{k: v for k, v in FALSE.items() if k != 'event_key'})], now_mono=0)
check('the join does not start a fixture on a false live', 771905 not in e9.started)
# a fixture wrongly closed before this fix: on the next recompute it is priced again and its close cleared
bad = [dict(r) for r in s1.rows('line_prices_current')]
e10 = LE.LineEngine(171, write=True, log=lambda *_: None)
e10.checked(); e10.load_written(json.loads(json.dumps(bad, default=str)))
e10.set_mapping(KFX, AT, now_mono=0)
for r in SEED:
    e10.accept(r, now_mono=0)
e10.seeded.add(771905)
s10 = Store()
e10.flush(s10, now_mono=100)
c10 = cur(s10).get(('gh', '1093', -2.5)) or {}
check('a fixture written as started in error is priced again, its close cleared (mutant CLOSE_KEPT_WHEN_NOT_STARTED)',
      c10.get('status') == 'ok' and c10.get('close_price') is None, c10)

print('11 the worker hooks')
import now_worker as W  # noqa: E402
src = open(os.path.join(HERE, 'now_worker.py')).read()
check('the worker imports line_engine defensively', 'import line_engine as LE' in src and 'except Exception as _e' in src)
check('API_TENNIS_KEY travels as a base64 Fly secret', 'API_TENNIS_KEY' in W.B64_SECRETS)
check('…and is redacted from the log', 'env.get("API_TENNIS_KEY")) if s]' in src)
check('the line writes need their OWN switch', 'env.get("KIBL_LINES_WRITE") == "1"' in src and 'write = enabled and' in src)
import re  # noqa: E402
hooks = collections_counter = {}
for h in re.findall(r'\blines\.(\w+)\(', src):
    hooks[h] = hooks.get(h, 0) + 1
check('the loop touches lines through exactly these hooks: accept x1, tick x1, request_seed x1, summary x2 (heartbeats), '
      'checked x1 (after the connected heartbeat)', hooks == {'accept': 1, 'tick': 1, 'request_seed': 1, 'summary': 2, 'checked': 1}, hooks)
check('checked() follows the CONNECTED heartbeat only', 'dict(where, lines=lines.summary())), log, enabled)\n                    lines.checked()' in src)
off = W._LinesOff('x')
check('the stand-in is a no-op on every hook', off.accept({}) is None and off.tick() is None and off.request_seed() is None
      and off.summary() == {'off': 'x'})
# Byte-identical Now decisions with the line hooks present: one engine fed rows alone, one with lines.accept beside it.
cards = [{"date": "2026-09-24", "time": "07:00", "p1": "C. Ugo Carabelli", "p2": "N. Borges", "tourBadge": "ATP"}]
fx = {1: {"name": "Nuno Borges vs Camilo Ugo Carabelli", "scheduled_start": "2026-09-24T02:00:00Z"}}
from datetime import datetime, timezone  # noqa: E402
NOWW = datetime(2026, 9, 24, 4, 0, tzinfo=timezone.utc)


def mlrow(fp, price, ins):
    return {"fixture_id": 1, "fixture_participant_id": fp, "market_type_id": 1, "segment_id": 1, "betting_type_id": 1,
            "is_live": False, "is_current": True, "is_opener": False, "price_decimal": price, "inserted_on": ins,
            "feed_source_id": 171, "market_id": 9, "uuid": None, "side_id": 2 if fp % 2 else 3, "point": 0.0, "alt_id": 0,
            "is_previous": False, "price_american": 100, "participant_side_id": 2 if fp % 2 else 3}


feed = [mlrow(101, 1.2, "2026-09-24T03:00:00Z"), mlrow(102, 4.8, "2026-09-24T03:00:01Z"),
        dict(mlrow(101, 1.25, "2026-09-24T03:00:02Z"), market_type_id=2, point=-2.5), mlrow(101, 1.22, "2026-09-24T03:00:03Z")]
outs = []
for with_lines in (False, True):
    ne = W.NowEngine("bet105", "Bet105", 171)
    ne.set_fixtures(fx)
    ne.set_cards(cards, NOWW)
    le = LE.LineEngine(171, write=False, log=lambda *_: None)
    le.load_written([])
    got = []
    for r in feed:
        got.append(ne.accept(dict(r), "r"))
        if with_lines:
            le.accept(r)
    outs.append((json.dumps(got, sort_keys=True, default=str), json.dumps(dict(ne.count), sort_keys=True)))
check('the Now engine writes and counts the same with the line engine beside it', outs[0] == outs[1], outs)

print(f'\n{"PASS" if not FAILED else "FAIL"} — {len(FAILED)} failed' + (f': {FAILED}' if FAILED else ''))
sys.exit(1 if FAILED else 0)
