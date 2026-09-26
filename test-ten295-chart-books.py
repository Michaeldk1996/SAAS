#!/usr/bin/env python3
"""TEN-295 (TEN-287 Wave 1, founder 2026-09-26 card 89e3671d) — the chart writers.

Drives the SHIPPED writers (chart_series.py, build-chart-books.py, refresh-odds-history.py)
end to end on fixtures, with the network stubbed. Rules under test (.claude/rules/odds.md,
"Oddspapi" and "The odds-movement chart"):

  1. oddsMovement.books / capturedAt / startTime / fixtureId are never touched by a chart
     write, and the edge model's output for a fixed fixture is byte-identical with and
     without the chart field (meta.generatedAt aside — a wall clock).
  2. Oddspapi BOOKS == ('pinnacle+30',); both legs write "Pinnacle +30s" to the chart only;
     the bet365-only paths (open-monitor, OPEN pin) do not run.
  3. odds-api.io join: both surnames, either orientation, ±1 day, unique on both sides,
     skips counted; p1/p2 follow the card (a swapped fixture is tested).
  4. Series: floor 1.01, suspended pair (>20% overround) dropped, same-price re-stamps
     collapse, a re-read never shortens the held line, checkedAt only moves forward and
     never passes the source's own clock.
  5. Bet105 = the price-history box's rows: stream + poller, card orientation, cut at startTs.
  6. The RPC is service_role only, pre-match only, books from config; the loop runs the
     writer on both the normal and the push-race path with the Supabase secrets.

Run: python3 test-ten295-chart-books.py
"""
import copy, importlib.util, json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import chart_series as cs  # noqa: E402

FAILS = []


def check(cond, msg):
    print(('ok     ' if cond else 'FAIL   ') + msg)
    if not cond:
        FAILS.append(msg)


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, file))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


bcb = load('bcb', 'build-chart-books.py')
hist = load('hist', 'refresh-odds-history.py')

LEGACY = {'market': 'Match Winner', 'capturedAt': '2026-09-26T02:45:01Z',
          'startTime': '2026-09-26T05:00:00.000Z', 'fixtureId': 'id1201413374753332',
          'books': {'bet365': {'p1': [['2026-09-24T20:42:50.000Z', 2.37]],
                               'p2': [['2026-09-24T20:42:50.000Z', 1.54]]}}}


def card(**kw):
    m = {'id': 'upcoming-12165868', 'date': '2026-09-26', 'time': '07:00',
         'p1': 'J. M. Cerundolo', 'p2': 'A. Davidovich Fokina', 'tour': 'ATP Chengdu'}
    m.update(kw)
    return m


# ── 1. chart_series.put_chart never touches the model's fields ───────────────
m = card(oddsMovement=copy.deepcopy(LEGACY))
before = json.dumps({k: v for k, v in m['oddsMovement'].items()}, sort_keys=True)
cs.put_chart(m, 'Pinnacle +30s', {'p1': [['2026-09-25T08:21:00Z', 2.5], ['2026-09-26T02:40:00Z', 2.35]],
                                  'p2': [['2026-09-25T08:21:00Z', 1.578]]},
             {'source': 'Oddspapi', 'group': 'sharp', 'clock': 'book tick', 'checkedAt': '2026-09-26T04:00:00Z'})
after = {k: v for k, v in m['oddsMovement'].items() if k != 'chart'}
check(json.dumps(after, sort_keys=True) == before, 'put_chart leaves books/capturedAt/startTime/fixtureId byte-identical')
check(list(m['oddsMovement']['books']) == ['bet365'], 'no chart label ever lands in oddsMovement.books')
check(cs.chart_series(m, 'Pinnacle +30s')['p1'][0] == ['2026-09-25T08:21:00.000Z', 2.5], 'timestamps normalised to ms-Z')
# a shorter re-read (vendor pruned the old end) never shortens the line
cs.put_chart(m, 'Pinnacle +30s', {'p1': [['2026-09-26T02:40:00Z', 2.35], ['2026-09-26T03:10:00Z', 2.31]], 'p2': []},
             {'source': 'Oddspapi', 'group': 'sharp', 'clock': 'book tick', 'checkedAt': '2026-09-26T03:00:00Z'})
p1 = cs.chart_series(m, 'Pinnacle +30s')['p1']
check([p[1] for p in p1] == [2.5, 2.35, 2.31], f'merge keeps the old end and adds the new point: {p1}')
check(m['oddsMovement']['chart']['meta']['Pinnacle +30s']['checkedAt'] == '2026-09-26T04:00:00.000Z',
      'checkedAt never moves backwards')
check(cs.merge_side([['2026-09-26T01:00:00Z', 1.0], ['2026-09-26T02:00:00Z', 1.009]], []) == [],
      'prices below 1.01 are not points')
check(cs.merge_side([['2026-09-26T01:00:00Z', 2.0], ['2026-09-26T02:00:00Z', 2.0], ['2026-09-26T03:00:00Z', 2.1]], [])
      == [['2026-09-26T01:00:00.000Z', 2.0], ['2026-09-26T03:00:00.000Z', 2.1]], 'same-price re-stamps collapse')
try:
    cs.put_chart(card(), 'X', None, {'group': 'medium'})
    check(False, 'an unknown group is refused')
except ValueError:
    check(True, 'an unknown group is refused')

# the edge model: byte-identical with and without the chart field
node = r"""
const path = require('path'); const R = process.argv[1];
const { runModel } = require(path.join(R, 'h2h-model/model.js'));
const matches = require(path.join(R, 'matches.json'));
const out = [];
for (const m of matches.filter(x => x.oddsMovement && x.oddsMovement.books && Object.keys(x.oddsMovement.books).length).slice(0, 3)) {
  const run = mm => { const r = runModel(mm, {}); if (r && r.meta) delete r.meta.generatedAt; return JSON.stringify(r); };
  const a = run(JSON.parse(JSON.stringify(m)));
  const m2 = JSON.parse(JSON.stringify(m));
  m2.oddsMovement.chart = { books: { 'Pinnacle +30s': { p1: [['2026-09-25T08:21:00.000Z', 1.9], ['2026-09-26T02:40:00.000Z', 2.35]], p2: [['2026-09-25T08:21:00.000Z', 1.9], ['2026-09-26T02:40:00.000Z', 1.657]] },
                                     Superbet: { p1: [['2026-09-25T10:00:00.000Z', 2.2]], p2: [['2026-09-25T10:00:00.000Z', 1.7]] } },
                            meta: { 'Pinnacle +30s': { source: 'Oddspapi', group: 'sharp', clock: 'book tick', checkedAt: '2026-09-26T04:00:00.000Z' } } };
  out.push({ id: m.id, same: a === run(m2), n: a.length });
}
console.log(JSON.stringify(out));
"""
try:
    res = json.loads(subprocess.run(['node', '-e', node, HERE], capture_output=True, text=True,
                                    timeout=120).stdout.strip().splitlines()[-1])
    check(len(res) >= 1 and all(r['same'] for r in res),
          f'edge model output byte-identical with a chart field on {len(res)} fixture(s) {res}')
except Exception as e:
    check(False, f'edge model identity check ran ({e})')

# ── 3. odds-api.io join ──────────────────────────────────────────────────────
EV = lambda eid, home, away, start, books: {'event_id': eid, 'home': home, 'away': away,
                                            'start_at': start, 'tier': 'ATP', 'live_from': None,
                                            'books': books}
cards = [card(), card(id='upcoming-2', p1='H. Gaston', p2='A. Rublev', date='2026-09-27'),
         card(id='upcoming-3', p1='Q. Halys', p2='R. Safiullin', date='2026-09-29')]
events = [
    # swapped vs the card: vendor home = card p2
    EV(1, 'Davidovich Fokina, Alejandro', 'Cerundolo, Juan Manuel', '2026-09-26T05:00:00+00:00', {}),
    EV(2, 'Gaston, Hugo', 'Rublev, Andrey', '2026-09-27T05:30:00+00:00', {}),
    EV(3, 'Gaston, Hugo', 'Rublev, Andrey', '2026-09-27T09:30:00+00:00', {}),   # 2nd event, same card
    EV(4, 'Halys, Quentin', 'Safiullin, Roman', '2026-09-26T05:30:00+00:00', {}),  # 3 days off
    EV(5, 'Nobody, A', 'Else, B', '2026-09-26T05:30:00+00:00', {}),
]
joined, counts = bcb.join_events(cards, events)
check(joined.get(id(cards[0])) and joined[id(cards[0])][0]['event_id'] == 1 and joined[id(cards[0])][1] == 'swap',
      'both-surname join, either orientation (swap detected)')
check(id(cards[1]) not in joined and counts['ambiguous_card'] == 2, f'two events for one card -> neither, counted {counts}')
check(id(cards[2]) not in joined and counts['no_card'] == 2, 'a date 3 days off and an unknown pair join nothing, counted')
dup = [card(), card(id='past-12165868')]
j2, c2 = bcb.join_events(dup, events[:1])
check(len(j2) == 2 and c2['ambiguous_event'] == 0, 'the upcoming-/past- pair of one match is one card, both written')
twin = [card(), card(id='upcoming-99', date='2026-09-27')]
j3, c3 = bcb.join_events(twin, events[:1])
check(not j3 and c3['ambiguous_event'] == 1, 'an event fitting two different cards joins neither, counted')

# ── 4. series + checkedAt ────────────────────────────────────────────────────
rows = [['2026-09-26T01:00:00+00:00', 1.60, 2.40],
        ['2026-09-26T01:10:00+00:00', 1.60, 2.40],        # re-stamp
        ['2026-09-26T01:20:00+00:00', 1.00, 30.0],        # below the floor
        ['2026-09-26T01:30:00+00:00', 1.40, 1.90],        # overround 24% -> suspended
        ['2026-09-26T01:40:00+00:00', 1.55, 2.50]]
ser = bcb.event_series(rows, 'swap')
check(ser['p1'] == [['2026-09-26T01:00:00.000Z', 2.4], ['2026-09-26T01:40:00.000Z', 2.5]]
      and ser['p2'] == [['2026-09-26T01:00:00.000Z', 1.6], ['2026-09-26T01:40:00.000Z', 1.55]],
      f'swap orientation, floor, suspended pair and re-stamp handled: {ser}')
c = card(oddsMovement=copy.deepcopy(LEGACY))
payload = {'books': ['Betfair Exchange', 'Superbet', 'Bet365', 'Foo'],
           'polled_ok_at': {'Betfair Exchange': '2026-09-26T04:15:42.07+00:00', 'Superbet': '2026-09-26T04:15:42.07+00:00',
                            'Bet365': '2026-09-26T04:10:00+00:00'},
           'events': [dict(events[0], live_from='2026-09-26T04:05:00+00:00',
                           books={'Betfair Exchange': rows, 'Superbet': rows[:1], 'Bet365': rows[:1], 'Foo': rows[:1]})]}
cnt = bcb.apply_odds_api([c], payload, '2026-09-26T04:20:00.000Z')
meta = c['oddsMovement']['chart']['meta']
check(set(c['oddsMovement']['chart']['books']) == {'Betfair Exchange (recorded by us)', 'Superbet', 'Bet365 (odds-api.io)', 'Foo (odds-api.io)'},
      f'labels from config.books, no code change for a new slot: {sorted(c["oddsMovement"]["chart"]["books"])}')
check(meta['Superbet'] == {'source': 'odds-api.io', 'group': 'soft', 'clock': 'vendor updatedAt',
                           'checkedAt': '2026-09-26T04:05:00.000Z'}, f'checkedAt capped at the first live sighting: {meta["Superbet"]}')
check(meta['Betfair Exchange (recorded by us)']['clock'] == 'recorded by us', 'Betfair Exchange is labelled self-recorded')
check(meta['Foo (odds-api.io)']['checkedAt'] is None, 'no recorded poll for a book -> no checkedAt claimed')
check(c['oddsMovement']['books'] == LEGACY['books'] and c['oddsMovement']['capturedAt'] == LEGACY['capturedAt'],
      'odds-api.io write leaves the legacy fields alone')
c2 = card()
bcb.apply_odds_api([c2], dict(payload, events=[dict(events[0], live_from=None, books={'Superbet': rows[:1]})]),
                   '2026-09-26T04:20:00.000Z')
check(c2['oddsMovement']['chart']['meta']['Superbet']['checkedAt'] == '2026-09-26T04:15:42.070Z',
      'checkedAt = the recorder poll, not our read time')

# ── 5. Bet105 = the box's rows ───────────────────────────────────────────────
ph = {'fixtures': [{'fixture_id': 77, 'player1': 'Alejandro Davidovich Fokina', 'player2': 'Juan Manuel Cerundolo'}],
      'poller': [{'fixture_id': 77, 'side': '1', 'price': 1.6, 'at': '2026-09-25T10:00:00.123+00:00'},
                 {'fixture_id': 77, 'side': '2', 'price': 2.4, 'at': '2026-09-25T10:00:00.123+00:00'},
                 {'fixture_id': 77, 'side': '2', 'price': 2.3, 'at': '2026-09-26T06:00:00+00:00'},
                 {'fixture_id': 77, 'side': '2', 'price': 2.2, 'at': '2026-09-26T07:30:00+00:00'}],   # after start
      'stream': [{'side': 'cerundolo', 'price': 2.4, 'at': '2026-09-25T10:00:00.123+00:00'},          # dup
                 {'side': 'fokina', 'price': 1.0, 'at': '2026-09-25T11:00:00+00:00'}]}               # 0.000-ish
s105 = bcb.bet105_series(ph, card(), '2026-09-26T07:00:00+00:00')
check(s105 == {'p1': [['2026-09-25T10:00:00.123Z', 2.4], ['2026-09-26T06:00:00.000Z', 2.3]],
               'p2': [['2026-09-25T10:00:00.123Z', 1.6]]},
      f'Bet105: poller sides named by the fixture, stream by key, deduped, floor, cut at startTs: {s105}')
cst = {'byKey': {'2026-09-26|cerundolo|fokina': {'book': 'bet105', 'startTs': '2026-09-26T07:00:00+00:00'},
                 '2026-09-27|gaston|rublev': {'book': 'bet365'}}}
t = bcb.bet105_cards([card(), card(id='upcoming-2', p1='H. Gaston', p2='A. Rublev', date='2026-09-27')], cst)
check([k for _, k, _ in t] == ['2026-09-26|cerundolo|fokina', '2026-09-27|gaston|rublev'],
      'every board card is read for Bet105, selected book or not (TEN-295 coverage pass)')
# (review 2026-09-26) the stop rule must be reachable by the REAL writer: checkedAt is
# capped at startTs, so "read after the finish" could never fire — driven through main().
tmpb = tempfile.mkdtemp()
bcb.MATCHES, bcb.CARD_STATE = os.path.join(tmpb, 'matches.json'), os.path.join(tmpb, 'ocs.json')
json.dump([card(finalScore='6-4 6-4', finishedAt='2026-09-26T09:00:00Z')], open(bcb.MATCHES, 'w'))
json.dump(cst, open(bcb.CARD_STATE, 'w'))
seen = []
bcb.rpc = lambda name, args, timeout=60: (seen.append(name) or
    ({'events': [], 'polled_ok_at': {}, 'kibl_sweep_ok_at': '2026-09-26T09:30:00+00:00'} if name == 'chart_book_series' else ph))
_now = cs.now_iso
cs.now_iso = lambda: '2026-09-26T10:00:00.000Z'      # after the 07:00 start
bcb.main(); bcb.main()
cs.now_iso = _now
got = json.load(open(bcb.MATCHES))[0]['oddsMovement']['chart']
check(seen.count('chart_bet105_history') == 1, f'a completed Bet105 card is read once after its start, then left alone {seen}')
check(got['meta']['Bet105']['checkedAt'] == '2026-09-26T07:00:00.000Z', 'Bet105 checkedAt capped at the card start')
check(all(p[0] <= '2026-09-26T07:00:00.000Z' for sd in ('p1', 'p2') for p in got['books']['Bet105'][sd]),
      'no Bet105 point after the start')

# odds-api.io: cut at the card start (odds-card-state), else the vendor's scheduled start
late = card(date='2026-09-26')
ev_late = dict(events[0], start_at='2026-09-26T01:30:00+00:00', live_from='2026-09-26T01:45:00+00:00',
               books={'Superbet': rows})
bcb.apply_odds_api([late], dict(payload, events=[ev_late]), '2026-09-26T04:20:00.000Z', card_state={})
lser = late['oddsMovement']['chart']['books']['Superbet']
check(all(p[0] <= '2026-09-26T01:30:00.000Z' for p in lser['p1'] + lser['p2'])
      and late['oddsMovement']['chart']['meta']['Superbet']['checkedAt'] == '2026-09-26T01:30:00.000Z',
      f'a point after the scheduled start (before the vendor live flip) is dropped: {lser}')
late2 = card(date='2026-09-26')
bcb.apply_odds_api([late2], dict(payload, events=[ev_late]), '2026-09-26T04:20:00.000Z',
                   card_state={'byKey': {'2026-09-26|cerundolo|fokina': {'startTs': '2026-09-26T01:20:00+00:00'}}})
check(late2['oddsMovement']['chart']['meta']['Superbet']['checkedAt'] == '2026-09-26T01:20:00.000Z'
      and all(p[0] <= '2026-09-26T01:20:00.000Z' for p in late2['oddsMovement']['chart']['books']['Superbet']['p1']),
      'the card\'s actual startTs wins over the scheduled start')

# main() end to end, network stubbed
tmp = tempfile.mkdtemp()
bcb.MATCHES, bcb.CARD_STATE = os.path.join(tmp, 'matches.json'), os.path.join(tmp, 'ocs.json')
board = [card(oddsMovement=copy.deepcopy(LEGACY))]
json.dump(board, open(bcb.MATCHES, 'w')); json.dump(cst, open(bcb.CARD_STATE, 'w'))
calls = []


def fake_rpc(name, args, timeout=60):
    calls.append(name)
    if name == 'chart_book_series':
        return dict(payload, kibl_sweep_ok_at='2026-09-26T04:12:06+00:00')
    return ph


bcb.rpc = fake_rpc
rc = bcb.main()
out = json.load(open(bcb.MATCHES))[0]['oddsMovement']
check(rc == 0 and calls == ['chart_book_series', 'chart_bet105_history'], f'main(): one series call + one Bet105 read per card {calls}')
check({k: v for k, v in out.items() if k != 'chart'} == LEGACY, 'main(): the written file keeps the legacy fields byte-identical')
check(out['chart']['meta']['Bet105']['group'] == 'sharp' and out['chart']['books']['Bet105']['p1'][0][1] == 2.4,
      'main(): Bet105 line written, Sharp')
check(out['chart']['meta']['Bet105']['checkedAt'] <= '2026-09-26T04:12:06.000Z', 'Bet105 checkedAt <= the Kibl poller sweep')

# ── 2. refresh-odds-history.py: pinnacle+30 into the chart, both legs ────────
check(hist.BOOKS == ('pinnacle+30',) and not hist.BET365_ACTIVE, 'Oddspapi BOOKS == (pinnacle+30,), bet365 paths off')
PIN = {'bookmakers': {'pinnacle+30': {'markets': {'121': {'outcomes': {
    '121': {'players': {'0': [{'createdAt': '2026-09-25T08:21:00.000Z', 'price': 1.578}, {'createdAt': '2026-09-26T02:40:00.000Z', 'price': 1.657}]}},
    '122': {'players': {'0': [{'createdAt': '2026-09-25T08:21:00.000Z', 'price': 2.5}, {'createdAt': '2026-09-26T02:40:00.000Z', 'price': 2.35}]}}}}}}}}
tmp2 = tempfile.mkdtemp()
hist.MATCHES = os.path.join(tmp2, 'matches.json')
hist.FIXTURE_MAP_FILE = os.path.join(tmp2, 'map.json')
hist.OPEN_MONITOR_FILE = os.path.join(tmp2, 'open-monitor.json')
hist.BILLED_STRIKE_FILE = os.path.join(tmp2, 'strike')
future = card(date='2099-01-01', oddsMovement=copy.deepcopy(LEGACY))
json.dump([future, card(id='upcoming-5', p1='H. Gaston', p2='A. Rublev', date='2099-01-01')], open(hist.MATCHES, 'w'))
json.dump({'byKey': {'12165868': {'fixtureId': 'idX', 'orient': 'swap', 'startTime': '2099-01-01T07:00:00.000Z'},
                     '5': {'fixtureId': 'idY', 'orient': 'same', 'startTime': '2099-01-01T09:00:00.000Z'}}},
          open(hist.FIXTURE_MAP_FILE, 'w'))
asked = []
hist.read_key = lambda: 'k'
hist.log_quota = lambda key, when: 100
hist.seed_from_live = lambda committed: committed
hist.time.sleep = lambda s: None
hist.bsp_alerts = None
hist.hist_get = lambda fx, books, key: (asked.append((fx, books)) or (PIN if fx == 'idX' else None, None if fx == 'idX' else 404))
rc = hist.first_appearance()
got = json.load(open(hist.MATCHES))
om = got[0]['oddsMovement']
check(rc == 0 and all(b == ('pinnacle+30',) for _, b in asked), f'--first-appearance asks pinnacle+30 only, one book per call {asked}')
check(om['chart']['books']['Pinnacle +30s']['p1'][-1] == ['2026-09-26T02:40:00.000Z', 2.35]
      and om['chart']['books']['Pinnacle +30s']['p2'][-1] == ['2026-09-26T02:40:00.000Z', 1.657],
      'swapped fixture: p1/p2 follow the card')
check({k: v for k, v in om.items() if k != 'chart'} == LEGACY, '--first-appearance: legacy books/capturedAt/startTime/fixtureId untouched')
check(om['chart']['meta']['Pinnacle +30s']['group'] == 'sharp' and om['chart']['meta']['Pinnacle +30s']['clock'] == 'book tick',
      'Pinnacle +30s meta: sharp, book tick')
check('Pinnacle' not in om['books'] and 'Pinnacle +30s' not in om['books'], 'the model anchor key never appears')
g1 = (got[1].get('oddsMovement') or {}).get('chart') or {}
check(not (g1.get('books') or {}).get('Pinnacle +30s') and (g1.get('meta') or {}).get('Pinnacle +30s', {}).get('checkedAt'),
      'a 404 writes no line — only the verdict "checked, not priced" with its time')
check(not os.path.exists(hist.OPEN_MONITOR_FILE), 'the bet365 open-monitor did not run')

# ── TEN-295 coverage pass ────────────────────────────────────────────────────
# (a) the "Jr" suffix: Oddspapi 'Damm Jr, Martin' v 'Hurkacz, Hubert' (raw /v4/fixtures,
# fixture id1201413374753338) joins the board's 'M. Damm v H. Hurkacz' — it missed 27 runs.
dm = card(id='upcoming-12165854', p1='M. Damm', p2='H. Hurkacz', date='2026-09-26', time='08:30')
check(hist.orient(dm, 'Damm Jr, Martin', 'Hurkacz, Hubert') == 'same'
      and hist.orient(dm, 'Hurkacz, Hubert', 'Damm Jr, Martin') == 'swap',
      'Oddspapi join survives a generational suffix, either orientation')
check(hist.orient(dm, 'Damm, Martin', 'Hurkacz, Hubert') == 'same', 'a plain name still joins')
check(hist.orient(dm, 'Jr, X', 'Hurkacz, Hubert') is None, 'a suffix is never the whole surname')
j5, c5 = bcb.join_events([dm], [EV(74753338, 'Damm Jr, Martin', 'Hurkacz, Hubert', '2026-09-26T06:40:00+00:00', {})])
check(id(dm) in j5 and j5[id(dm)][1] == 'same', f'odds-api.io join survives the suffix too {c5}')
check(cs.join_key('Martin Damm Jr.') == 'damm' and cs.join_key('Damm Jr, Martin') == 'damm'
      and cs.join_key('M. Damm') == 'damm', 'join_key strips the suffix in every name order')
from ten225_names import name_key as _nk
check(_nk('Damm Jr, Martin') == 'jr', 'the card-state key (name_key) is untouched — only the JOIN strips')

# (b) every configured odds-api.io book gets a verdict on every card; pre-recording cards
# say "not recorded", never "not priced"
old = card(id='past-1', date='2026-09-24', finalScore='6-4 6-4')
new = card(id='upcoming-9', p1='A. B', p2='C. D', date='2026-09-27')
bcb.apply_odds_api([old, new], {'books': ['Superbet', 'Betfair Exchange'], 'events': [],
                                'polled_ok_at': {'Superbet': '2026-09-26T04:00:00+00:00'}},
                   '2026-09-26T04:20:00.000Z', card_state={})
mo = old['oddsMovement']['chart']['meta']; mn = new['oddsMovement']['chart']['meta']
check(mo['Superbet'].get('note') == 'not recorded — our recording began 26 Sep' and not old['oddsMovement']['chart']['books'],
      'a card played before the recorder began: "not recorded", no line')
check('note' not in mn['Superbet'] and mn['Superbet']['checkedAt'] == '2026-09-26T04:00:00.000Z'
      and mn['Betfair Exchange (recorded by us)']['checkedAt'] is None,
      'a card in the recording window: checked, no line, checkedAt = the recorder poll (none recorded -> none claimed)')

# (c) the free sweep backfills a completed, mapped card once, cut at its start, and a card
# Oddspapi does not list gets "not listed by Oddspapi"
_fmap_saved = open(hist.FIXTURE_MAP_FILE).read()
hist.CARD_STATE_FILE = os.path.join(tmp2, 'ocs.json')      # never the repo's own file
done_c = card(id='past-7', date='2026-09-25', finalScore='6-4 6-4', oddsMovement=copy.deepcopy(LEGACY))
miss_c = card(id='upcoming-12165854', p1='M. Damm', p2='H. Hurkacz', date='2099-01-01')
json.dump([done_c, miss_c], open(hist.MATCHES, 'w'))
json.dump({'byKey': {'7': {'fixtureId': 'idX', 'orient': 'swap', 'startTime': '2026-09-26T02:00:00.000Z'},
                     '12165854': {'fixtureId': None, 'mappedAt': '2026-09-26T06:16:05Z', 'missRuns': 27}}},
          open(hist.FIXTURE_MAP_FILE, 'w'))
json.dump({'byKey': {}}, open(hist.CARD_STATE_FILE, 'w'))
asked.clear()
hist.first_appearance()
got = json.load(open(hist.MATCHES))
bf = got[0]['oddsMovement']['chart']
check(asked == [('idX', ('pinnacle+30',))], f'the completed card is swept once for Pinnacle +30s {asked}')
check(all(p[0] <= '2026-09-26T02:00:00.000Z' for p in bf['books']['Pinnacle +30s']['p1'] + bf['books']['Pinnacle +30s']['p2'])
      and {k: v for k, v in got[0]['oddsMovement'].items() if k != 'chart'} == LEGACY,
      'backfilled line cut at the start; legacy fields untouched')
asked.clear()
hist.first_appearance()
check(asked == [], f'…and never swept again once it holds a verdict {asked}')
mm = (got[1].get('oddsMovement') or {}).get('chart', {}).get('meta', {}).get('Pinnacle +30s', {})
check(mm.get('note') == 'not listed by Oddspapi' and mm.get('checkedAt') == '2026-09-26T06:16:05.000Z',
      f'unlisted by Oddspapi -> that verdict, with the mapping run time {mm}')
open(hist.FIXTURE_MAP_FILE, 'w').write(_fmap_saved)

# main() (the 3-hourly leg), fixtures + join stubbed
json.dump([card(date='2099-01-01', oddsMovement=copy.deepcopy(LEGACY))], open(hist.MATCHES, 'w'))
hist.api_get = lambda path, params, key: ([{'fixtureId': 'idX'}], None)
hist.join_fixtures = lambda targets, fixtures, calibrate_from=None: (
    {id(targets[0]): {'fixtureId': 'idX', 'orient': 'swap', 'startTime': '2099-01-01T07:00:00.000Z'}}, [])
hist.report_consumption = lambda *a: None
asked.clear()
try:
    hist.main()
    code = 0
except SystemExit as e:
    code = e.code
om = json.load(open(hist.MATCHES))[0]['oddsMovement']
check(code in (0, None) and asked == [('idX', ('pinnacle+30',))], f'main(): one pinnacle+30 call {asked} rc={code}')
check({k: v for k, v in om.items() if k != 'chart'} == LEGACY and 'Pinnacle +30s' in om['chart']['books'],
      'main(): chart written, legacy fields untouched (never a wholesale replace)')
check(not os.path.exists(hist.OPEN_MONITOR_FILE), 'main(): the bet365 open-monitor did not run')

# Pinnacle +30s cut at the card start (review 2026-09-26: oddspapi keeps ticking in-play)
hist.CARD_STATE_FILE = os.path.join(tmp2, 'ocs.json')
json.dump({'byKey': {'2026-09-26|cerundolo|fokina': {'startTs': '2026-09-26T02:00:00+00:00'}}}, open(hist.CARD_STATE_FILE, 'w'))
pc = card()
outp, hits = {}, {'pinnacle+30': 0}
hist._absorb(PIN, 'pinnacle+30', True, outp, hits)
hist._store(pc, outp, '2026-09-26T04:40:00.000Z', 'idX', '2026-09-26T05:00:00.000Z', merge=False)
ps = cs.chart_series(pc, 'Pinnacle +30s')
check(all(p[0] <= '2026-09-26T02:00:00.000Z' for p in ps['p1'] + ps['p2']) and len(ps['p1']) == 1
      and pc['oddsMovement']['chart']['meta']['Pinnacle +30s']['checkedAt'] == '2026-09-26T02:00:00.000Z',
      f'Pinnacle +30s: in-play ticks dropped, checkedAt capped at startTs {ps}')

# a completed card holding the frozen bet365 series is NOT re-targeted by the 3-hourly leg
json.dump([card(date='2026-09-25', finalScore='6-4 6-4', oddsMovement=copy.deepcopy(LEGACY))], open(hist.MATCHES, 'w'))
asked.clear()
try:
    hist.main()
except SystemExit:
    pass
check(asked == [], f'completed card with legacy movement not re-targeted (no new fail-loud gaps) {asked}')

# no OPEN pin without bet365 -> the sweep budget can cut fixtures pinnacle+30 never prices
json.dump([card(date='2099-01-01'), card(id='upcoming-5', p1='H. Gaston', p2='A. Rublev', date='2099-01-01')],
          open(hist.MATCHES, 'w'))
asked.clear()
hist.SWEEP_BUDGET_S = 5.5
hist.first_appearance()
hist.SWEEP_BUDGET_S = 480.0
check(len(asked) == 1 and asked[0][0] == 'idX', f'unopened fixtures are budget-cut when bet365 is off (soonest kept) {asked}')

# ── 6. the RPC and the wiring ────────────────────────────────────────────────
sql = open(os.path.join(HERE, 'chart-books-rpc.sql')).read()
check('security definer' in sql and 'grant execute on function public.chart_book_series(timestamptz, timestamptz) to service_role' in sql
      and 'from anon, authenticated' in sql and 'to anon' not in sql, 'RPC: security definer, service_role only')
check("t.event_status = 'pending'" in sql and "is distinct from 'pending'" in sql and 't.book_updated_at < lf.at' in sql,
      'RPC: pre-match only, cut at the first non-pending sighting')
check('cfg.books' in sql and 'status_code = 200' in sql, 'RPC: books from config, heartbeat = last HTTP 200 poll')
check('order by at, id)' in sql, 'RPC: deterministic order for two changes at one instant')
check("not like '%/%'" in sql and 'e.tier is not null' not in sql,
      'RPC: singles of any league (the Laver Cup exhibition was dropped by the tier filter)')
b105 = sql[sql.index('function public.chart_bet105_history'):]
check('where is_selected' in b105 and 'count(distinct fixture_id) from cand) = 1' in b105
      and "is distinct from 'orientation-disagreement'" in b105
      and 'grant execute on function public.chart_bet105_history(text) to service_role' in b105
      and 'from anon, authenticated' in b105,
      'chart_bet105_history: selected fixture, else the ONLY one, never a dashed one; service_role only')
loop = open(os.path.join(HERE, 'odds-capture-loop.sh')).read()
check(loop.count('python3 build-chart-books.py') == 2, 'loop runs the writer on the normal and the push-race path')
check('build-chart-books.py chart_series.py ten225_names.py' in loop, 'the writer is a DRIVER file (restart on change)')
wf = open(os.path.join(HERE, '.github/workflows/odds-now.yml')).read()
step = wf[wf.index('- name: Run the capture loop'):wf.index('./odds-capture-loop.sh')]
check('SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}' in step and 'SUPABASE_URL' in step,
      'the loop step carries the Supabase secrets')

print(f'\n{len(FAILS)} assertion(s) failed.')
sys.exit(1 if FAILS else 0)
