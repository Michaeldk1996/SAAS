#!/usr/bin/env python3
"""tools/archive-fill-probe.py — the pure logic, on fixtures, with no network and no secrets: the read-only request guard,
the start-time ladder (Oddspapi trueStart after the gate -> live-flip lower bound -> dash, never the schedule), the close
(last active pinnacle+30 entry >= 1.01 at or before the start, both sides), close_reliable (lag <= 60 min; flip gap <= 300 s
on a live-flip cut), the first captured price (earliest, flagged under 6 h), the candidate diff (nothing overwrites a held
row) and the per-month n.

Then every MUTANT below must turn the suite red (a check that passes on a broken build is not a check): source mutants of
the probe itself, and monkeypatches of the reused pinarch functions it depends on."""
import datetime as dt, importlib.util, json, math, os, sys, types

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, 'archive-fill-probe.py')
SRC = open(PATH).read()


def load(src=SRC):
    spec = importlib.util.spec_from_file_location('afp', PATH)
    m = importlib.util.module_from_spec(spec)
    exec(compile(src, PATH, 'exec'), m.__dict__)
    return m


U = lambda s: dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
def e(t, price, active=True): return {'createdAt': t, 'price': price, 'active': active, 'limit': 1000}
BODY = {'bookmakers': {'pinnacle+30': {'markets': {'121': {'outcomes': {
    '121': {'players': {'0': [e('2026-06-01T02:00:00Z', 1.005), e('2026-06-01T02:30:00Z', 1.90, False), e('2026-06-01T03:00:00Z', 1.80), e('2026-06-01T09:00:00Z', 1.70, False),
                              e('2026-06-01T11:50:00Z', 1.65), e('2026-06-01T12:20:00Z', 1.30)]}},
    '122': {'players': {'0': [e('2026-06-01T04:00:00Z', 2.00), e('2026-06-01T11:55:00Z', 2.30), e('2026-06-01T11:58:00Z', 2.40, False),
                              e('2026-06-01T12:20:00Z', 3.60)]}}}}}}}}
START = '2026-06-01T12:00:00Z'
TD = {'date': '2026-06-01', 'tournament': 'X Open', 'round': '1st Round', 'winner': 'Alpha A.', 'loser': 'Beta B.'}
F = {'event_key': 900001, 'event_date': '2026-06-01', 'event_first_player': 'A. Alpha', 'event_second_player': 'B. Beta',
     'first_player_key': '11', 'second_player_key': '22', 'event_type_type': 'Atp Singles'}
FX = {'trueStartTime': START, 'trueEndTime': '2026-06-01T13:40:00Z', 'startTime': '2026-06-01T11:30:00Z'}
RAW = {'id': 501, 'pulled_at': '2026-06-02T00:00:00Z'}


class Fails(Exception):
    pass


def suite(M):
    """Returns (passed, [failures])."""
    P = M.P
    S = P.mw_series(json.dumps(BODY).encode())
    out, bad = [], []
    def check(name, cond):
        (out if cond else bad).append(name)
    def raises(fn):
        try:
            fn(); return False
        except M.ReadOnlyRefused:
            return True
        except Exception:
            return False

    # ── guard
    check('guard: a plain GET select of an allow-listed table passes',
          M.check_request('GET', '/rest/v1/pinnacle_archive_close?select=id,p1&event_key=in.(1,2)&id=gt.0&order=id.asc&limit=1000') is True)
    check('guard: Prefer count=exact on a GET passes', M.check_request('GET', '/rest/v1/oddspapi_archive_raw?select=id&limit=1', headers={'Prefer': 'count=exact'}) is True)
    for meth in ('POST', 'PATCH', 'PUT', 'DELETE', 'HEAD'):
        check(f'guard: {meth} refused', raises(lambda: M.check_request(meth, '/rest/v1/pinnacle_archive_close?select=id')))
    check('guard: an RPC refused even as GET', raises(lambda: M.check_request('GET', '/rest/v1/rpc/pinnacle_archive_guard?select=x')))
    check('guard: a table off the allow-list refused', raises(lambda: M.check_request('GET', '/rest/v1/pinnacle_archive_count?select=id')))
    check('guard: a body refused', raises(lambda: M.check_request('GET', '/rest/v1/pinnacle_archive_close?select=id', body={})))
    check('guard: Prefer resolution / return refused', raises(lambda: M.check_request('GET', '/rest/v1/pinnacle_archive_close?select=id',
                                                                                     headers={'Prefer': 'resolution=ignore-duplicates,return=representation'})))
    check('guard: on_conflict refused', raises(lambda: M.check_request('GET', '/rest/v1/pinnacle_archive_close?select=id&on_conflict=dedupe_key')))
    check('guard: a read without select refused', raises(lambda: M.check_request('GET', '/rest/v1/pinnacle_archive_close?id=eq.1')))
    fake = types.SimpleNamespace(calls=[])
    fake.rest = lambda method, path, body=None, headers=None, timeout=180, raw=False: fake.calls.append((method, path)) or (200, [], {})
    fake.insert = lambda *a, **k: fake.calls.append(('INSERT',))
    fake.record_count = lambda *a, **k: fake.calls.append(('COUNT',))
    fake.guard_state = lambda *a, **k: fake.calls.append(('RPC',))
    M.install_guard(fake)
    fake.rest('GET', '/rest/v1/live_flip_log?select=event_key')
    check('installed guard: a GET reaches the transport', fake.calls == [('GET', '/rest/v1/live_flip_log?select=event_key')])
    check('installed guard: a POST never reaches the transport', raises(lambda: fake.rest('POST', '/rest/v1/pinnacle_archive_close?select=id', body=[{}])) and len(fake.calls) == 1)
    fake.rest = lambda method, path, body=None, headers=None, timeout=180, raw=False: fake.calls.append(('NEW', method)) or (200, [], {})
    M.install_guard(fake)
    check('installed guard: a re-assigned transport is wrapped again (never left bare)', raises(lambda: fake.rest('POST', '/rest/v1/pinnacle_archive_close?select=id', body=[{}]))
          and len(fake.calls) == 1)
    check('installed guard: insert / record_count / guard_state refused', raises(lambda: fake.insert('t', [{}], 'id')) and raises(lambda: fake.record_count('j', {}))
          and raises(lambda: fake.guard_state()) and len(fake.calls) == 1)

    # ── start ladder (pinarch.effective_cut via evaluate)
    rec, row, _ = M.evaluate(TD, F, True, 'idX', True, FX, None, RAW, S)
    check('ladder: Oddspapi trueStart is the start when it passes the gate', rec['start'] == U(START).isoformat() and rec['startSource'] == P.NO_FLIP_SOURCE)
    r2, row2, _ = M.evaluate(TD, F, True, 'idX', True, dict(FX, trueEndTime='2026-06-01T18:30:00Z'), None, RAW, S)
    check('ladder: trueEnd - trueStart > 6 h rejects the start -> no close (never the schedule)', r2['start'] is None and row2 is None and 'close' not in r2)
    r3, row3, _ = M.evaluate(TD, F, True, 'idX', True, dict(FX, trueEndTime='2026-06-01T11:00:00Z'), None, RAW, S)
    check('ladder: trueEnd before trueStart rejects the start', r3['start'] is None and row3 is None)
    flip = {'last_not_live_seen_at': '2026-06-01T11:58:00Z', 'first_live_seen_at': '2026-06-01T12:01:00Z', 'gap_seconds': 180}
    r4, row4, _ = M.evaluate(TD, F, True, 'idX', True, dict(FX, trueStartTime=None), flip, RAW, S)
    check('ladder: no trueStart -> the live-flip lower bound', r4['start'] == U('2026-06-01T11:58:00Z').isoformat() and r4['startSource'] == P.CUT_SOURCE)
    r5, row5, _ = M.evaluate(TD, F, True, 'idX', True, {'startTime': '2026-06-01T11:30:00Z'}, None, RAW, S)
    check('ladder: only a scheduled time -> dash (no start, no close)', r5['start'] is None and row5 is None)

    # ── close selection
    c = rec.get('close') or {}
    check('close: the last ACTIVE entry at or before the start per side (inactive 11:58 and in-play 12:20 excluded)', c.get('winner') == 1.65 and c.get('loser') == 2.30)
    check('close: candidate row names the start source and lag', row and row['start_source'] == P.NO_FLIP_SOURCE and row['gap_to_start_s'] == 300.0)
    one = {'bookmakers': {'pinnacle+30': {'markets': {'121': {'outcomes': {'121': {'players': {'0': [e('2026-06-01T11:00:00Z', 1.5)]}}}}}}}}
    r6, row6, _ = M.evaluate(TD, F, True, 'idX', True, FX, None, RAW, P.mw_series(json.dumps(one).encode()))
    check('close: one side only -> no close and no first captured (dash both sides)', row6 is None and 'close' not in r6 and 'firstCaptured' not in r6)
    floor = {'bookmakers': {'pinnacle+30': {'markets': {'121': {'outcomes': {'121': {'players': {'0': [e('2026-06-01T11:00:00Z', 1.005)]}},
                                                                             '122': {'players': {'0': [e('2026-06-01T11:00:00Z', 9.0)]}}}}}}}}
    r7, row7, _ = M.evaluate(TD, F, True, 'idX', True, FX, None, RAW, P.mw_series(json.dumps(floor).encode()))
    check('close: a price below 1.01 is suppressed (no close)', row7 is None)
    r8, _, _ = M.evaluate(TD, F, True, 'idX', True, FX, None, None, {})
    check('no payload -> hasPayload false, no close', r8['hasPayload'] is False and 'close' not in r8)

    # ── close_reliable
    check('reliable: trueStart cut, lag 5 min -> true', c.get('reliable') is True)
    check('reliable: lag 59 min true, 61 min false', M.close_reliable(U(START), U('2026-06-01T11:01:00Z'), P.NO_FLIP_SOURCE, None)[0] is True
          and M.close_reliable(U(START), U('2026-06-01T10:59:00Z'), P.NO_FLIP_SOURCE, None)[0] is False)
    check('reliable: live-flip cut needs flip gap <= 300 s (180 true, 400 false, missing false)',
          M.close_reliable(U(START), U('2026-06-01T11:55:00Z'), P.CUT_SOURCE, 180)[0] is True
          and M.close_reliable(U(START), U('2026-06-01T11:55:00Z'), P.CUT_SOURCE, 400)[0] is False
          and M.close_reliable(U(START), U('2026-06-01T11:55:00Z'), P.CUT_SOURCE, None)[0] is False)
    check('reliable: through evaluate, a flip cut with a 400 s gap is unreliable',
          M.evaluate(TD, F, True, 'idX', True, dict(FX, trueStartTime=None), dict(flip, gap_seconds=400), RAW, S)[0].get('close', {}).get('reliable') is False)

    # ── first captured
    fc = rec.get('firstCaptured') or {}
    check('first captured: the EARLIEST active pre-start entry >= 1.01 per side (1.005 and the inactive 1.90 skipped)', fc.get('winner') == 1.80 and fc.get('loser') == 2.00)
    check('first captured: pair time = the later side, 8 h before the start, not late', fc.get('hoursBeforeStart') == 8.0 and fc.get('late') is False)
    late = {'bookmakers': {'pinnacle+30': {'markets': {'121': {'outcomes': {'121': {'players': {'0': [e('2026-06-01T09:00:00Z', 1.5)]}},
                                                                            '122': {'players': {'0': [e('2026-06-01T07:00:00Z', 2.6)]}}}}}}}}
    fcl = M.evaluate(TD, F, True, 'idX', True, FX, None, RAW, P.mw_series(json.dumps(late).encode()))[0].get('firstCaptured') or {}
    check('first captured: under 6 h before the start is flagged late', fcl.get('late') is True and fcl.get('hoursBeforeStart') == 3.0)
    post = {'bookmakers': {'pinnacle+30': {'markets': {'121': {'outcomes': {'121': {'players': {'0': [e('2026-06-01T12:10:00Z', 1.5)]}},
                                                                            '122': {'players': {'0': [e('2026-06-01T12:10:00Z', 2.6)]}}}}}}}}
    rp = M.evaluate(TD, F, True, 'idX', True, FX, None, RAW, P.mw_series(json.dumps(post).encode()))[0]
    check('first captured: an entry after the start is never a first captured price', 'firstCaptured' not in rp)
    check('first captured: no start -> none (cannot be shown pre-match)', M.first_captured(S, None)[0] is None)

    # ── orientation
    rs, rows, _ = M.evaluate(TD, F, False, 'idX', True, FX, None, RAW, S)
    check('orientation: winner is the api-tennis SECOND player -> winner takes participant 2', rs['close']['winner'] == 2.30
          and rs['firstCaptured']['winner'] == 2.00)
    rs2, _, _ = M.evaluate(TD, F, True, 'idX', False, FX, None, RAW, S)
    check('orientation: api-tennis first player is Oddspapi participant 2', rs2['close']['winner'] == 2.30 and rs2['close']['loser'] == 1.65
          and rs2['firstCaptured']['winner'] == 2.00 and rs2['firstCaptured']['loser'] == 1.80)

    # ── candidate diff
    other = dict(row, event_key=900002, dedupe_key=row['dedupe_key'].replace('900001', '900002'))
    third = dict(row, event_key=900003, dedupe_key=row['dedupe_key'].replace('900001', '900003'))
    held = [{'id': 7, 'event_key': 900002, 'label': 'captured', 'dedupe_key': 'cap|1', 'p1': 1.6, 'p2': 2.4, 'close_ts': '2026-06-01T11:00:00Z',
             'supersedes': None, 'match_date': '2026-06-01'},
            dict(third, id=8)]
    cand, rep = M.diff_candidates([row, other, third], held)
    check('diff: only the event with no held row is a candidate', [str(r['event_key']) for r in cand] == ['900001'])
    check('diff: the event with a captured close would supersede it -> listed, not a candidate', rep['wouldSupersedeAnExistingClose'] == 1
          and rep['supersedeList'][0]['supersedes'] == 7)
    check('diff: a close already held (same dedupe key) adds nothing', rep['sameCloseAlreadyHeld'] == 1)
    check('diff: proof — no candidate event or dedupe key is held, none supersedes', rep['proof']['noneOverwrites'] is True)
    check('diff: a trueStart-alone candidate is held back if written (start-alone ruling)', rep['candidatesHeldBackIfWritten'].get('start-alone') == 1
          and rep['candidatesThatWouldExportUnderCurrentRulings'] == 0)

    # ── per month
    recs = [dict(rec, month='2026-06')] * 31 + [dict(r8, month='2026-09', date='2026-09-01')] * 3
    per = M.summarize(recs, {'900001': {'label': 'captured'}})
    check('summary: n per month, n < 30 flagged', per['2026-06']['n'] == 31 and per['2026-06']['smallN'] is False and per['2026-09']['smallN'] is True)
    check('summary: close and reliable counts over n', per['2026-06']['close'] == 31 and per['2026-06']['closeReliable'] == 31
          and per['2026-06']['display']['close'] == '31/31' and per['2026-09']['display']['close'] == '0/3 (n<30)')
    check('summary: before = the exported close per event, after = before ∪ derived', per['2026-06']['before']['exportedClose'] == 31
          and per['2026-09']['after']['closeAny'] == 3 and per['2026-06']['firstCapturedUnder6h'] == 0)
    return out, bad


def fill_suite(M):
    """The founder ruling of 2026-10-25: measurement stats, the rule's branches, the fill rows and their closeCut, the
    export exemption (pinarch), the digest and the write guard. Returns (passed, [failures])."""
    P = M.P
    S = P.mw_series(json.dumps(BODY).encode())
    out, bad = [], []
    def check(name, cond):
        (out if cond else bad).append(name)
    def raises(fn):
        try:
            fn(); return False
        except M.ReadOnlyRefused:
            return True
        except Exception:
            return False

    # ── stats
    check('pct: nearest rank (p98 of 1..100 = 98, of 1..10 = 10; p50 of 1..4 = 2)', M.pct(list(range(1, 101)), 98) == 98
          and M.pct(list(range(1, 11)), 98) == 10 and M.pct([1, 2, 3, 4], 50) == 2 and M.pct([], 50) is None)
    st = M.lateness_stats([-60] * 95 + [30, 60, 90, 150, 400])
    check('stats: n, median d, share later', st['n'] == 100 and st['medianS'] == -60 and st['lateN'] == 5 and st['lateShare'] == 0.05)
    check('stats: lateness percentiles over the LATER matches, seconds and minutes', st['lateS']['p50'] == 90 and st['lateS']['p98'] == 400
          and st['lateS']['max'] == 400 and st['lateMin']['max'] == 6.67)
    check('stats: histogram of lateness', st['histogram'] == {'(0,30]s': 1, '(30,60]s': 1, '(60,120]s': 1, '(120,300]s': 1, '(300,600]s': 1,
                                                             '(600,1800]s': 0, '(1800,3600]s': 0, '>3600s': 0})
    check('stats: d = 0 is not later', M.lateness_stats([0, 0, -1])['lateN'] == 0)

    # ── rule
    R_ = lambda ds: M.fill_rule(M.lateness_stats(ds))
    check('rule: n < 50 -> stop (no fill)', R_([-10] * 49)['decision'] == 'stop' and R_([-10] * 49)['X'] is None)
    check('rule: n = 50 is enough', R_([-10] * 50)['decision'] == 'trueStart')
    check('rule: later in exactly 2% and never > 2 min -> trueStart', R_([-10] * 98 + [60, 120])['decision'] == 'trueStart')
    check('rule: one later by 121 s -> buffer', R_([-10] * 98 + [60, 121])['decision'] == 'trueStart-buffer')
    b = R_([-10] * 97 + [30, 30, 30])
    check('rule: later in 3% -> buffer, X = ceil(p98 / 60) = 1 for 30 s', b['decision'] == 'trueStart-buffer' and b['X'] == 1)
    check('rule: X rounds UP to the next whole minute (p98 121 s -> 3; 120 s -> 2)', R_([-10] * 90 + [121] * 10)['X'] == 3 and R_([-10] * 90 + [120] * 10)['X'] == 2)

    # ── measurement edges
    pairs = [{'eventKey': '1', 'level': 'Atp Singles', 'date': '2026-10-01', 'dLowerS': 100.0, 'dUpperS': -50.0, 'gapS': 150.0},
             {'eventKey': '2', 'level': 'Atp Singles', 'date': '2026-10-02', 'dLowerS': 5000.0, 'dUpperS': 4000.0, 'gapS': 400.0},
             {'eventKey': '3', 'level': 'Challenger Men Singles', 'date': '2026-09-20', 'dLowerS': -30.0, 'dUpperS': -200.0, 'gapS': None}]
    me = M.measure(pairs)
    check('measure: primary = lower edge on flips with gap <= 300 s (one late by 100 s)', me['primary']['n'] == 1 and me['primary']['lateS']['max'] == 100
          and me['gapOver300Excluded'] == 2)
    check('measure: the upper edge and every-gap views are reported beside', me['upperEdgeGap300']['lateN'] == 0 and me['lowerEdgeAllGaps']['n'] == 3
          and me['lowerEdgeAllGaps']['lateS']['max'] == 5000 and me['upperEdgeAllGaps']['lateN'] == 1)
    fxs = {'f1': {'trueStartTime': '2026-10-01T12:01:40Z', 'trueEndTime': '2026-10-01T13:30:00Z', 'startTime': '2026-10-01T12:00:00Z'},
           'f2': {'trueStartTime': '2026-10-01T12:00:00Z', 'trueEndTime': '2026-10-01T19:00:00Z', 'startTime': '2026-10-01T12:00:00Z'},
           'f3': {'startTime': '2026-10-01T12:00:00Z'}}
    fl = {'e1': {'last_not_live_seen_at': '2026-10-01T12:00:00Z', 'first_live_seen_at': '2026-10-01T12:02:30Z', 'gap_seconds': 150},
          'e2': {'last_not_live_seen_at': '2026-10-01T12:00:00Z', 'first_live_seen_at': '2026-10-01T12:02:30Z', 'gap_seconds': 150},
          'e3': {'last_not_live_seen_at': '2026-10-01T12:00:00Z', 'first_live_seen_at': '2026-10-01T12:02:30Z', 'gap_seconds': 150}}
    ps, rj = M.overlap_pairs([{'event_key': 'e1', 'fixture_id': 'f1', 'level': 'Atp Singles'}, {'event_key': 'e2', 'fixture_id': 'f2'},
                              {'event_key': 'e3', 'fixture_id': 'f3'}], fxs, fl)
    check('overlap: d = gated trueStart - each flip edge (100 s after the lower, 50 s before the upper)', len(ps) == 1 and ps[0]['dLowerS'] == 100
          and ps[0]['dUpperS'] == -50 and ps[0]['gapS'] == 150)
    check('overlap: a trueStart the gate rejects (> 6 h match) and a missing one are not measured', rj.get('trueStart rejected: implausible_duration') == 1
          and rj.get('no Oddspapi trueStart') == 1)

    # ── fill rows
    RS = {'decision': 'trueStart', 'X': None, 'n': 80, 'lateShare': 0.0, 'maxLateS': None, 'p98LateS': None}
    RB = lambda x: {'decision': 'trueStart-buffer', 'X': x, 'n': 80, 'lateShare': 0.1, 'maxLateS': 600, 'p98LateS': 590}
    _, _, f0 = M.evaluate(TD, F, True, 'idX', True, FX, None, RAW, S, RS)
    check('fill trueStart: cut at trueStart, start_source the fill source, closeCut marked, no buffer', f0 and f0['p1'] == 1.65 and f0['p2'] == 2.30
          and f0['start_source'] == P.FILL_START_SOURCE and f0['detail']['closeCut'] == 'trueStart' and 'bufferMin' not in f0['detail']
          and f0['start_ts'] == U(START).isoformat() and f0['gap_to_start_s'] == 300.0)
    _, _, f10 = M.evaluate(TD, F, True, 'idX', True, FX, None, RAW, S, RB(10))
    check('fill buffer X=10: last pair at or before trueStart - 10 min (11:50), closeCut + bufferMin + cutTs carried',
          f10 and f10['p1'] == 1.65 and f10['p2'] == 2.00 and f10['detail']['closeCut'] == 'trueStart-buffer' and f10['detail']['bufferMin'] == 10
          and f10['detail']['cutTs'] == U('2026-06-01T11:50:00Z').isoformat() and f10['start_ts'] == U(START).isoformat() and f10['gap_to_start_s'] == 600.0)
    check('fill buffer X=2: the 11:55 price counts (11:58 cut), the in-play ones never', M.evaluate(TD, F, True, 'idX', True, FX, None, RAW, S, RB(2))[2]['p2'] == 2.30)
    r30, _, f30 = M.evaluate(TD, F, True, 'idX', True, FX, None, RAW, S, RB(30))
    check('fill: a pair more than 60 min before the CUT is stale (dash, reason kept)', f30 is None and r30['fill']['why'].startswith(M.STALE_WHY))
    check('fill: rule stop -> no fill row', M.evaluate(TD, F, True, 'idX', True, FX, None, RAW, S, {'decision': 'stop', 'X': None})[2] is None)
    flip = {'last_not_live_seen_at': '2026-06-01T11:58:00Z', 'first_live_seen_at': '2026-06-01T12:01:00Z', 'gap_seconds': 180}
    check('fill: an event with a live-flip row is not filled (the derive job owns it)', M.evaluate(TD, F, True, 'idX', True, FX, flip, RAW, S, RS)[2] is None)
    check('fill: a buffered rule without a whole-minute X makes no row', M.fill_row({'cut': U(START), 'cutSource': P.NO_FLIP_SOURCE}, 1, 'f', S,
                                                                                    {'decision': 'trueStart-buffer', 'X': None})[0] is None)

    near = {'bookmakers': {'pinnacle+30': {'markets': {'121': {'outcomes': {'121': {'players': {'0': [e('2026-06-01T10:50:00Z', 1.7)]}},
                                                                            '122': {'players': {'0': [e('2026-06-01T10:50:00Z', 2.2)]}}}}}}}}
    _, _, f65 = M.evaluate(TD, F, True, 'idX', True, FX, None, RAW, P.mw_series(json.dumps(near).encode()), RB(65))
    check('fill X=65: a price 5 min before the cut and 70 min before trueStart fills (staleness is measured from the cut)',
          f65 is not None and f65['gap_to_start_s'] == 4200.0 and f65['detail']['bufferMin'] == 65)

    # ── per tier (founder ruling 2026-10-25 (2): never pooled)
    def lv(level, ds):
        return [{'eventKey': str(i), 'level': level, 'date': '2026-10-01', 'dLowerS': float(d), 'dUpperS': float(d) - 120, 'gapS': 120.0} for i, d in enumerate(ds)]
    mt = M.measure(lv('Atp Singles', [-60] * 40 + [600] * 50 + [4231] * 10) + lv('Challenger Men Singles', [-60] * 50 + [300] * 145 + [671] * 5))
    tr = M.tier_rules(mt)
    check('per tier: X_ATP = ceil(ATP-only p98) = 71, X_Challenger = ceil(Challenger-only p98) = 12', tr['ATP']['X'] == 71 and tr['Challenger']['X'] == 12
          and tr['ATP']['tier'] == 'ATP' and tr['Challenger']['level'] == 'Challenger Men Singles')
    check('per tier: the pooled X (71 here) would wrongly give Challenger 71 — each tier reads only its own matches (control)',
          M.fill_rule(mt['primary'])['X'] == 71 and tr['Challenger']['X'] == 12)
    tt = M.tier_table(tr, mt)
    check('per tier: the table names n, median lateness, p98 and X; only ATP is filled here', tt['ATP']['n'] == 100 and tt['Challenger']['n'] == 200
          and tt['ATP']['medianLateS'] == 600 and tt['ATP']['p98LateS'] == 4231 and tt['ATP']['filled'] and not tt['Challenger']['filled'])
    check('per tier: a tier below n = 50 stops on its own', M.tier_rules(M.measure(lv('Atp Singles', [600] * 49)))['ATP']['decision'] == 'stop')
    RT = dict(RB(71), tier='ATP')
    _, _, ft = M.evaluate(TD, F, True, 'idX', True, FX, None, RAW, P.mw_series(json.dumps(near).encode()), dict(RB(65), tier='ATP'))
    check('per tier: the row carries its tier and its X (bufferMin)', ft['detail']['tier'] == 'ATP' and ft['detail']['bufferMin'] == 65)
    check('per tier: the digest moves with the tier', M.plan_digest(RT, [ft]) != M.plan_digest(dict(RT, tier='Challenger'), [ft])
          and M.plan_digest(RT, [ft]) != M.plan_digest(RT, [dict(ft, detail=dict(ft['detail'], tier='Challenger'))]))
    check('marker text: the founder\'s tooltip with the row\'s own X', M.early_hover(71) == "Early Pinnacle price — taken 71–131 min before Oddspapi's recorded start. True closing price unavailable."
          and M.early_hover(12).startswith('Early Pinnacle price — taken 12–72 min'))

    # ── re-cut (founder ruling 2026-10-25 (3)): any true close supersedes a fill row in the export
    fb = dict(base_row := {'label': P.ARCHIVE_LABEL, 'match_date': '2026-06-01', 'p1_key': 1, 'p2_key': 2, 'p1': 1.6, 'p2': 2.3, 'source': 's', 'book': 'b',
                           'supersedes': None, 'event_key': 50}, id=10, start_source=P.FILL_START_SOURCE, detail={'closeCut': 'trueStart-buffer', 'bufferMin': 71})
    true_arch = dict(base_row, id=9, start_source=P.CUT_SOURCE, p1=1.55, detail={})
    true_cap = dict(base_row, id=11, label='captured', match_date='2026-09-20', start_source='api-tennis-live', p1=1.5, detail={})
    ex1 = P.export_rows([fb])
    check('re-cut: a fill row alone exports, marked (closeCut, bufferMin) and fed as "early cut 71"', len(ex1) == 1 and ex1[0]['closeCut'] == 'trueStart-buffer'
          and ex1[0]['bufferMin'] == 71 and P.feed_label(ex1[0]) == 'early cut 71')
    ex2 = P.export_rows([fb, true_arch])
    check('re-cut: an archive close at a true start beats a NEWER fill row', len(ex2) == 1 and ex2[0]['archiveId'] == 9 and 'closeCut' not in ex2[0]
          and P.feed_label(ex2[0]) == P.ARCHIVE_LABEL)
    ex3 = P.export_rows([fb, true_cap])
    check('re-cut: a captured close at our live-flip beats the fill row', len(ex3) == 1 and ex3[0]['archiveId'] == 11)
    ex4 = P.export_rows([dict(fb, id=12, detail={'closeCut': 'trueStart'}), fb])
    check('re-cut: between two fill rows the newer one stands (both re-cuttable)', ex4[0]['archiveId'] == 12)
    check('feed label: a trueStart-alone fill row (no buffer) keeps the archive label; a buffer without minutes too',
          P.feed_label({'label': P.ARCHIVE_LABEL, 'closeCut': 'trueStart'}) == P.ARCHIVE_LABEL
          and P.feed_label({'label': P.ARCHIVE_LABEL, 'closeCut': 'trueStart-buffer'}) == P.ARCHIVE_LABEL)
    tdr = [{'date': '2026-06-01', 'tournament': 'X Open', 'winner': 'Alpha A.', 'loser': 'Beta B.', 'psw': '', 'psl': '', 'comment': 'Completed', 'round': '1st Round'},
           {'date': '2026-06-02', 'tournament': 'X Open', 'winner': 'Alpha A.', 'loser': 'Gamma G.', 'psw': '1.5', 'psl': '2.6', 'comment': 'Completed', 'round': '2nd Round'}]
    exf = [dict(ex1[0], eventKey=50, date='2026-06-01', p1Name='A. Alpha', p2Name='B. Beta', p1Key=None, p2Key=None),
           dict(ex1[0], eventKey=51, date='2026-06-02', p1Name='A. Alpha', p2Name='G. Gamma', p1Key=None, p2Key=None)]
    fr, frep = P.td_feed_rows(exf, tdr, {}, '2025-12-31')
    check('td-feed: the fill row overrides an unpriced Tennis-Data row with label "early cut 71"; a Tennis-Data Pinnacle close is never replaced',
          [(r['kind'], r['label'], r['eventKey']) for r in fr] == [('override', 'early cut 71', 50)] and frep['tdHasPinnacle'] == 1)

    # ── the export exemption (pinarch.held_back / verified_start / export_rows)
    base = {'label': P.ARCHIVE_LABEL, 'match_date': '2026-06-01', 'p1_key': 1, 'p2_key': 2, 'p1': 1.6, 'p2': 2.3, 'source': 's', 'book': 'b', 'supersedes': None}
    rows = [dict(base, id=1, event_key=1, start_source=P.FILL_START_SOURCE, detail={'closeCut': 'trueStart'}),
            dict(base, id=2, event_key=2, start_source=P.FILL_START_SOURCE, detail={'closeCut': 'trueStart-buffer', 'bufferMin': 3}),
            dict(base, id=3, event_key=3, start_source=P.NO_FLIP_SOURCE, detail={}),
            dict(base, id=4, event_key=4, start_source=P.NO_FLIP_SOURCE, detail={'closeCut': 'trueStart'}),
            dict(base, id=5, event_key=5, start_source=P.FILL_START_SOURCE, detail={}),
            dict(base, id=6, event_key=6, start_source=P.FILL_START_SOURCE, detail={'closeCut': 'trueStart-buffer'}),
            dict(base, id=7, event_key=7, start_source=P.FILL_START_SOURCE, detail={'closeCut': 'trueStart', 'x': 1}, label='captured')]
    ex = sorted(r['eventKey'] for r in P.export_rows(rows))
    check('export: the fill-rule closes (trueStart, and buffered with bufferMin) export as closes', ex == [1, 2])
    check('export: a start-alone derive-held row (no closeCut) is still held back as start-alone', P.held_back_reason(rows[2]) == 'start-alone')
    check('export: a start-alone row claiming a closeCut is still held back (the source must be the fill\'s)', P.held_back_reason(rows[3]) == 'start-alone')
    check('export: the fill source without closeCut, a buffer without bufferMin, a captured row -> held back',
          all(P.held_back(r) for r in rows[4:]))
    check('export: the fill candidates the plan builds would export', not P.held_back(f0) and not P.held_back(f10))

    # ── digest
    dg = M.plan_digest(RS, [f0])
    check('digest: stable, order-independent, and moves with a price, the cut or X',
          dg == M.plan_digest(RS, [dict(f0)]) and M.plan_digest(RB(10), [f10, f0]) == M.plan_digest(RB(10), [f0, f10])
          and dg != M.plan_digest(RS, [dict(f0, p1=1.66)]) and M.plan_digest(RB(10), [f10]) != M.plan_digest(RB(11), [f10])
          and dg != M.plan_digest(RS, [dict(f0, detail=dict(f0['detail'], closeCut='trueStart-buffer'))]))

    # ── the write guard
    keys = frozenset({f0['dedupe_key']})
    ins = lambda **k: M.check_write_request(k.get('m', 'POST'), k.get('path', '/rest/v1/pinnacle_archive_close?on_conflict=dedupe_key&select=id'),
                                            k.get('body', [f0]), k.get('h', {'Prefer': 'resolution=ignore-duplicates,return=representation'}), keys)
    check('write guard: the plan\'s rows as INSERT … ignore-duplicates pass; reads pass', ins() is True
          and M.check_write_request('GET', '/rest/v1/pinnacle_archive_close?select=id', None, None, keys) is True
          and M.check_write_request('POST', '/rest/v1/pinnacle_archive_count?on_conflict=id&select=id', [{'job': 'archive-fill'}],
                                    {'Prefer': 'resolution=ignore-duplicates,return=representation'}, keys) is True)
    for meth in ('PATCH', 'PUT', 'DELETE'):
        check(f'write guard: {meth} refused', raises(lambda: ins(m=meth)))
    check('write guard: an upsert (merge-duplicates) refused', raises(lambda: ins(h={'Prefer': 'resolution=merge-duplicates,return=representation'})))
    check('write guard: a row not in the plan refused', raises(lambda: ins(body=[dict(f0, dedupe_key='other')])))
    check('write guard: a row with supersedes or an id refused', raises(lambda: ins(body=[dict(f0, supersedes=5)])) and raises(lambda: ins(body=[dict(f0, id=5)])))
    check('write guard: another table / an RPC refused', raises(lambda: ins(path='/rest/v1/oddspapi_archive_raw?on_conflict=id&select=id'))
          and raises(lambda: ins(path='/rest/v1/rpc/pinnacle_archive_guard')))
    check('write guard: other insert parameters refused', raises(lambda: ins(path='/rest/v1/pinnacle_archive_close?on_conflict=id&select=id')))
    check('write guard: the count row must be this job\'s', raises(lambda: M.check_write_request('POST', '/rest/v1/pinnacle_archive_count?on_conflict=id&select=id',
                                                                                                 [{'job': 'x'}], {'Prefer': 'resolution=ignore-duplicates,return=representation'}, keys)))

    # ── preflight
    proof_ok = {'proof': {'noneOverwrites': True}}
    plan = {'digest': dg, 'rule': RS, 'candidates': [f0], 'diff': proof_ok}
    check('preflight: the approved digest and no collision -> exactly the plan\'s rows', M.write_preflight(plan, dg, []) == [f0])
    check('preflight: a stale digest refused', raises(lambda: M.write_preflight(plan, '0' * 64, [])) and raises(lambda: M.write_preflight(plan, None, [])))
    check('preflight: rule stop / n < 50 refused', raises(lambda: M.write_preflight(dict(plan, rule={'decision': 'stop', 'n': 80}), dg, []))
          and raises(lambda: M.write_preflight(dict(plan, rule=dict(RS, n=49)), dg, [])))
    check('preflight: a held event key or dedupe key refused', raises(lambda: M.write_preflight(plan, dg, [{'event_key': f0['event_key'], 'dedupe_key': 'x'}]))
          and raises(lambda: M.write_preflight(plan, dg, [{'event_key': 1, 'dedupe_key': f0['dedupe_key']}])))
    check('preflight: no proof, no rows, or a non-fill row refused', raises(lambda: M.write_preflight(dict(plan, diff={'proof': {'noneOverwrites': False}}), dg, []))
          and raises(lambda: M.write_preflight(dict(plan, candidates=[]), dg, []))
          and raises(lambda: M.write_preflight(dict(plan, candidates=[dict(f0, start_source=P.NO_FLIP_SOURCE)]), dg, [])))
    return out, bad


import tempfile as _tf
_TINY_INDEX = os.path.join(_tf.mkdtemp(prefix='afp-idx-'), 'index.json.gz')


def _fake_world(M, flips=(), held_now=lambda: [], late=3):
    """A fake transport + api-tennis + fixtures for run(). `flips`: live_flip_log rows; `held_now()`: the close rows a
    pinnacle_archive_close read returns at that moment."""
    import gzip
    P, T = M.P, M.T
    seen, blob = [], gzip.compress(json.dumps(BODY).encode())
    def fake(method, path, body=None, headers=None, timeout=180, raw=False):
        seen.append((method, path, body))
        if method == 'POST':
            return 201, [{'id': 70000 + i} for i, _ in enumerate(body)], {}
        if 'count=exact' in str((headers or {}).get('Prefer')):
            return 200, [], {'Content-Range': '0-0/7'}
        if path.startswith('/rest/v1/oddspapi_archive_raw') and 'payload_gz' in path:
            return 200, [{'id': 501, 'fixture_id': 'idX', 'payload_gz': '\\x' + blob.hex(), 'pulled_at': RAW['pulled_at'], 'books': ['pinnacle+30']}], {}
        if path.startswith('/rest/v1/oddspapi_archive_raw') and 'fixture_id=in.' in path:
            return 200, [{'id': 501, 'fixture_id': 'idX', 'books': ['pinnacle+30'], 'pulled_at': RAW['pulled_at']}], {}
        if path.startswith('/rest/v1/live_flip_log'):
            return 200, (list(flips) if 'offset=0' in path else []), {}
        if path.startswith('/rest/v1/pinnacle_archive_close') and 'id=gt.0' in path:
            return 200, held_now(), {}
        return 200, [], {}
    P.rest = fake
    if not os.path.exists(_TINY_INDEX):
        with gzip.open(_TINY_INDEX, 'wt') as fh:
            json.dump({'fixtures': {}}, fh)
    P.FIXTURE_INDEX = _TINY_INDEX                          # an absolute path: the committed index is never read here
    T._at = lambda params: {'success': 1, 'result': [F] if params.get('date_start') == '2026-06-01' else []}
    bm = {'900001': {'fixtureId': 'idX', 'orient': 'same', 'p1': 'A. Alpha'}}
    meta = {'idX': {'fixtureId': 'idX', 'categoryName': 'ATP', 'participant1Name': 'Alpha, A', 'participant2Name': 'Beta, B',
                    'startTime': FX['startTime'], 'trueStartTime': FX['trueStartTime'], 'trueEndTime': FX['trueEndTime']}}
    for fl in flips:
        k = str(fl['event_key'])
        bm[k] = {'fixtureId': 'idM' + k, 'orient': 'same', 'p1': fl['first_player']}
        meta['idM' + k] = {'fixtureId': 'idM' + k, 'categoryName': 'ATP', 'participant1Name': 'x, y', 'participant2Name': 'z, w',
                           'startTime': fl['_ts'], 'trueStartTime': fl['_ts'], 'trueEndTime': fl['_te']}
    P._board_map = lambda: bm
    real_meta = P.held_fixture_meta
    P.held_fixture_meta = lambda idx, rows: dict(real_meta({}, rows), **meta)
    return seen


def _flips(n, late, late_s=90):
    """n live-flip rows (Oct 2026), the last `late` with a trueStart `late_s` after the lower edge, the rest 60 s before."""
    out = []
    t0 = U('2026-10-01T10:00:00Z')
    for i in range(n):
        lo = t0 + dt.timedelta(hours=i)
        d = late_s if i >= n - late else -60
        out.append({'event_key': 800000 + i, 'first_live_seen_at': (lo + dt.timedelta(seconds=120)).isoformat(), 'last_not_live_seen_at': lo.isoformat(),
                    'gap_seconds': 120, 'event_date': lo.date().isoformat(), 'first_player': f'A. P{i}', 'second_player': f'B. Q{i}',
                    'tournament_name': 'T', 'event_type_type': 'Atp Singles',
                    '_ts': (lo + dt.timedelta(seconds=d)).isoformat(), '_te': (lo + dt.timedelta(hours=2)).isoformat()})
    return out


def smoke(M):
    """run() end to end on a fake transport, plan and write. Returns (passed, [failures])."""
    import csv, tempfile, contextlib, io
    out, bad = [], []
    def check(name, cond):
        (out if cond else bad).append(name)
    d = tempfile.mkdtemp(prefix='afp-')
    td = os.path.join(d, 'td.csv')
    with open(td, 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=['date', 'tournament', 'round', 'winner', 'loser', 'comment', 'psw', 'psl'])
        w.writeheader(); w.writerow(dict(TD, comment='Completed', psw='', psl=''))
        w.writerow(dict(TD, winner='Gamma G.', loser='Delta D.', comment='Walkover', psw='', psl=''))
    def go(sub, **k):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return M.run(os.path.join(d, sub), '2026-05-31', '2026-06-02', td_path=td, measure_to='2026-10-24', **k)

    # plan, no overlap: the rule stops
    seen = _fake_world(M)
    rep = go('a')
    check('smoke plan: every request was a guarded GET', seen and all(m == 'GET' and M.check_request(m, p_) for m, p_, _ in seen))
    check('smoke plan: the archive, the live-flip log and the close archive were all read', {p_.split('?')[0] for _, p_, _ in seen} >=
          {'/rest/v1/oddspapi_archive_raw', '/rest/v1/live_flip_log', '/rest/v1/pinnacle_archive_close'})
    check('smoke plan: n = 1 (the walkover is out), payload, first captured, reliable close', rep['totals']['n'] == 1 and rep['population']['walkoversExcluded'] == 1
          and rep['totals']['hasPinnacle30Payload'] == 1 and rep['totals']['firstCaptured'] == 1 and rep['totals']['closeReliable'] == 1)
    check('smoke plan: no overlap -> rule stop, no fill row, coverage after = before', rep['rule']['decision'] == 'stop' and rep['diff']['candidates'] == 0
          and rep['totals']['exportedAfterFill'] == rep['totals']['beforeExported'] == 0)
    check('smoke plan: the output files are written', sorted(os.listdir(os.path.join(d, 'a'))) == ['archive-fill-candidates.json', 'archive-fill-matches.json',
          'archive-fill-measure-pairs.json', 'archive-fill-probe.json', 'archive-fill-probe.md'])

    # plan with 60 overlaps, 3 later by 90 s (5%): buffer X = 2 -> one fill row, which would export
    seen = _fake_world(M, _flips(60, 3))
    rep = go('b')
    check('smoke plan: the measurement reads the flips (n = 60, 3 later, max 90 s)', rep['measure']['primary']['n'] == 60 and rep['measure']['primary']['lateN'] == 3
          and rep['measure']['primary']['lateS']['max'] == 90)
    check('smoke plan: rule = buffer, X = 2, one candidate, coverage after = 1/1', rep['rule']['decision'] == 'trueStart-buffer' and rep['rule']['X'] == 2
          and rep['diff']['candidates'] == 1 and rep['totals']['exportedAfterFill'] == 1 and rep['diff']['candidatesThatWouldExportUnderCurrentRulings'] == 1)
    check('smoke plan: still GET only', all(m == 'GET' for m, _, _ in seen))
    dg = rep['digest']

    # write with a stale digest: refused, nothing sent but GETs
    seen = _fake_world(M, _flips(60, 3))
    try:
        go('c', write=True, digest_in='0' * 64); stale = False
    except SystemExit:
        stale = True
    check('smoke write: a stale digest is refused and nothing is inserted', stale and all(m == 'GET' for m, _, _ in seen))

    # write with a collision appearing after the plan: refused
    state = {'held': []}
    seen = _fake_world(M, _flips(60, 3), held_now=lambda: state['held'])
    cand = json.load(open(os.path.join(d, 'b', 'archive-fill-candidates.json')))
    orig_held_for = M.held_for
    calls = []
    def held_for(eks, dks=()):
        calls.append(1)
        if len(calls) > 1:                                # the fresh read just before the insert
            state['held'] = [{'id': 1, 'event_key': cand[0]['event_key'], 'dedupe_key': 'z', 'label': 'captured', 'p1': 1.5, 'p2': 2.5,
                              'close_ts': '2026-06-01T11:00:00Z', 'supersedes': None}]
        return orig_held_for(eks, dks)
    M.held_for = held_for
    try:
        go('d', write=True, digest_in=dg); coll = False
    except SystemExit:
        coll = True
    M.held_for = orig_held_for
    check('smoke write: a candidate colliding with a held row is refused, nothing inserted', coll and all(m == 'GET' for m, _, _ in seen))

    # write with the approved digest: exactly the plan's row inserted, then one count row; nothing else
    seen = _fake_world(M, _flips(60, 3))
    go('e', write=True, digest_in=dg)
    posts = [(p_.split('?')[0], b) for m, p_, b in seen if m != 'GET']
    check('smoke write: only INSERTs — the plan\'s one row, then one count row', [p_ for p_, _ in posts] == ['/rest/v1/pinnacle_archive_close', '/rest/v1/pinnacle_archive_count']
          and [r['dedupe_key'] for r in posts[0][1]] == [c['dedupe_key'] for c in cand])
    res = json.load(open(os.path.join(d, 'e', 'archive-fill-write.json')))
    check('smoke write: the result names the digest and the count inserted', res['inserted'] == 1 and res['recomputedDigest'] == dg == res['approvedDigest'])
    return out, bad


def src_mutants(*pairs):
    def mk():
        src = SRC
        for old, new in pairs:
            assert src.count(old) >= 1, f'mutant anchor gone: {old!r}'
            src = src.replace(old, new)
        return load(src)
    return mk


def src_mutant(old, new):
    def mk():
        assert SRC.count(old) >= 1, f'mutant anchor gone: {old!r}'
        return load(SRC.replace(old, new))
    return mk


PIN_PATH = os.path.join(HERE, 'pinarch.py')
PIN_SRC = open(PIN_PATH).read()


def pin_mutant(old, new):
    """A source mutant of tools/pinarch.py (the export exemption): the probe runs on the mutated pinarch."""
    def mk():
        assert PIN_SRC.count(old) >= 1, f'mutant anchor gone: {old!r}'
        M = load()
        PM = types.ModuleType('pinarch'); PM.__file__ = PIN_PATH
        exec(compile(PIN_SRC.replace(old, new), PIN_PATH, 'exec'), PM.__dict__)
        M.P = M.T.P = PM
        return M
    return mk


def patch_mutant(attr, fn):
    def mk():
        M = load()
        setattr(M.P, attr, fn(M.P))
        return M
    return mk


def _close_at_no_active(P):
    def close_at(series, cut):
        if cut is None:
            return None, 'no start'
        out = {}
        for oc in ('121', '122'):
            pre = [p for p in series.get(oc) or [] if P.iso_ms(p['createdAt']) <= cut and P._price(p) is not None]
            if not pre:
                return None, 'none'
            out[oc] = (P._price(pre[-1]), pre[-1]['createdAt'])
        return out, None
    return close_at


MUTANTS = [
    ('guard lets any method through', src_mutant("if method != 'GET':", 'if False:')),
    ('guard lets any table through', src_mutant('if table not in READ_TABLES:', 'if False:')),
    ('guard lets a write Prefer through', src_mutant('if not parts <= ALLOWED_PREFER:', 'if False:')),
    ('guard lets an on_conflict through', src_mutant('if bad:\n        raise ReadOnlyRefused', 'if False:\n        raise ReadOnlyRefused')),
    ('guard not installed on rest', src_mutant('mod.rest = guarded\n', 'pass\n')),
    ('guard not re-installed on a new transport', src_mutant("if getattr(mod, '_guarded', None) is not None and mod.rest is mod._guarded:", "if getattr(mod, '_guarded', None) is not None:")),
    ('write helpers not disabled', src_mutant('setattr(mod, name, _refuse(name))', 'pass')),
    ('first captured = the latest pre-start entry', src_mutant("out[oc] = (P._price(pre[0]), pre[0]['createdAt'])", "out[oc] = (P._price(pre[-1]), pre[-1]['createdAt'])")),
    ('first captured never flagged late', src_mutant('late=h < FIRST_CAPTURE_LATE_H', 'late=False')),
    ('first captured ignores the start', src_mutant("if P.iso_ms(p['createdAt']) <= start and p.get('active')", "if p.get('active')")),
    ('first captured takes inactive entries', src_mutant("<= start and p.get('active') and P._price(p)", "<= start and P._price(p)")),
    ('reliable ignores the 60-min lag', src_mutant('ok = 0 <= lag <= RELIABLE_LAG_S', 'ok = 0 <= lag')),
    ('reliable ignores the flip gap', src_mutant('ok = flip_gap_s is not None and float(flip_gap_s) <= FLIP_GAP_MAX_S', 'ok = True')),
    ('ladder: no gate, scheduled fallback', src_mutant('cut, src, reject = P.effective_cut(lower, ts, te, sc)',
                                                       'cut, src, reject = (ts or sc), P.NO_FLIP_SOURCE, None')),
    ('ladder: live-flip rung dropped', src_mutant("lower = P.iso_ms((flip or {}).get('last_not_live_seen_at'))", 'lower = None')),
    ('orientation: participant order ignored', src_mutant('if bool(winner_is_first) == bool(first_is_p1) else', 'if bool(winner_is_first) else')),
    ('diff: held events and corrections become candidates', src_mutant("if not r.get('supersedes') and str(r['event_key']) not in held_events and r['dedupe_key'] not in held_keys]", ']')),
    ('summary: n < 30 not flagged', src_mutant("(' (n<30)' if n < SMALL_N else '')", "''")),
    ('rule: n < 50 does not stop', src_mutant('if n < MIN_OVERLAP_N:', 'if False:')),
    ('rule: the 2% limb dropped', src_mutant("if stats['lateShare'] <= TRUESTART_LATE_SHARE_MAX and (stats", "if (stats")),
    ('rule: the 2-minute limb dropped', src_mutant(" and (stats['lateS']['max'] or 0) <= TRUESTART_LATE_MAX_S:", ':')),
    ('rule: X rounded, not up', src_mutant("math.ceil(stats['lateS']['p98'] / 60)", "round(stats['lateS']['p98'] / 60)")),
    ('measure: primary on the upper edge', src_mutant("'primary': dict(lateness_stats([p['dLowerS'] for p in tight])", "'primary': dict(lateness_stats([p['dUpperS'] for p in tight])")),
    ('measure: wide-gap flips kept in the primary', src_mutant("tight = [p for p in pairs if p['gapS'] is not None and p['gapS'] <= FLIP_GAP_MAX_S]", 'tight = list(pairs)')),
    ('stats: d = 0 counted as later', src_mutant('late = sorted(d for d in ds if d > 0)', 'late = sorted(d for d in ds if d >= 0)')),
    ('stats: percentile off by one', src_mutant('return sorted_vals[k - 1]', 'return sorted_vals[min(k, len(sorted_vals) - 1)]')),
    ('overlap: trueStart not gated', src_mutant('g, _src, why = P.effective_cut(None, ts, te, sc)', 'g, _src, why = ts, None, None')),
    ('fill: buffer ignored', src_mutant('cut = ts - dt.timedelta(minutes=x or 0)', 'cut = ts')),
    ('fill: closeCut not marked', src_mutant("row['detail']['closeCut'] = cut_kind", 'pass')),
    ('fill: bufferMin not carried', src_mutant("row['detail']['bufferMin'] = x", 'pass')),
    ('fill: staleness guard not enforced', src_mutant("if not 0 <= stale <= RELIABLE_LAG_S:", "if False:")),
    ('fill: staleness measured from trueStart, not the cut', src_mutant("stale = (cut - close_ts).total_seconds()", "stale = lag")),
    ('fill: start_source not the fill source', src_mutant('dict(ev, cut=cut, cutSource=P.FILL_START_SOURCE)', 'dict(ev, cut=cut)')),
    ('fill: live-flip events filled too (both guards: evaluate and fill_row)', src_mutants(("        if src != P.NO_FLIP_SOURCE:\n            rec['fill']", "        if False:\n            rec['fill']"),
                                                                                       ("if ts is None or ev.get('cutSource') != P.NO_FLIP_SOURCE:", 'if ts is None:'))),
    ('digest: prices left out', src_mutant("'p1': float(r['p1']), 'p2': float(r['p2']), ", '')),
    ('digest: X left out', src_mutant("'X': rule.get('X'), 'tier': rule.get('tier'), 'rows': proj}", "'tier': rule.get('tier'), 'rows': proj}")),
    ('write guard: any method', src_mutant("if method != 'POST':", 'if False:')),
    ('write guard: an upsert allowed', src_mutant("if prefer != {'resolution=ignore-duplicates', 'return=representation'}:", 'if False:')),
    ('write guard: rows outside the plan allowed', src_mutant('if stray:', 'if False:')),
    ('write guard: any count row allowed', src_mutant("elif len(body) != 1 or body[0].get('job') != job:", 'elif False:')),
    ('preflight: stale digest accepted', src_mutant("if not digest_in or digest_in != plan['digest']:", 'if False:')),
    ('preflight: collision accepted', src_mutant('if hit:', 'if False:')),
    ('preflight: rule stop accepted', src_mutant("if plan['rule']['decision'] not in P.FILL_CUTS:", 'if False:')),
    ('preflight: n < 50 accepted', src_mutant("if plan['rule']['n'] < MIN_OVERLAP_N:", 'if False:')),
    ('write run: no fresh read before the insert', src_mutant("fresh = held_for([c['event_key'] for c in cand], [c['dedupe_key'] for c in cand])", 'fresh = []')),
    ('pinarch: fill closes not exempted from the hold-back', pin_mutant('    if fill_cut(r):\n        return True\n', '')),
    ('pinarch: the fill source alone exempts (no closeCut needed)', pin_mutant("    if c == 'trueStart':\n        return c", "    if True:\n        return c")),
    ('pinarch: a buffered cut without bufferMin exempts', pin_mutant(" and isinstance(d.get('bufferMin'), int) and not isinstance(d.get('bufferMin'), bool) and d['bufferMin'] > 0", '')),
    ('pinarch: start-alone rows exempted too', pin_mutant("    if r.get('start_source') == NO_FLIP_SOURCE:\n        return 'start-alone'\n", '')),
    ('per tier: pooled measurement used for every tier', src_mutant("out[t] = dict(fill_rule(st), tier=t, level=lv)", "out[t] = dict(fill_rule(meas['primary']), tier=t, level=lv)")),
    ('per tier: the tier not carried in the row', src_mutant("        row['detail']['tier'] = rule['tier']", "        pass")),
    ('per tier: the tier not in the digest', src_mutant("'tier': rule.get('tier'), 'rows': proj}", "'rows': proj}")),
    ('marker: tooltip text changed', src_mutant("min before Oddspapi's recorded start. True closing price unavailable.\"", "min before the start\"")),
    ('pinarch: a fill row ranks as a true close (no re-cut)', pin_mutant("    if fill_cut(r):\n        return 0\n", "")),
    ('pinarch: the cut does not travel with the export row', pin_mutant("            out[-1]['closeCut'] = fc\n", "            pass\n")),
    ('pinarch: the feed label ignores the buffer', pin_mutant('        return f"{EARLY_CUT_LABEL} {e[\'bufferMin\']}"', "        return e.get('label')")),
    ('pinarch close_at takes inactive entries', patch_mutant('close_at', _close_at_no_active)),
    ('pinarch price floor removed', patch_mutant('_price', lambda P: (lambda p: float(p.get('price'))))),
]


def both(M):
    a, b = suite(M)
    c, d = fill_suite(M)
    e_, f_ = smoke(M)
    return a + c + e_, b + d + f_


def main():
    ok, bad = both(load())
    for n in ok:
        print('  PASS ', n)
    for n in bad:
        print('  FAIL ', n)
    caught = 0
    for name, mk in MUTANTS:
        try:
            mod = mk()                                      # an anchor that is gone is a FAILED mutant, never a catch
        except AssertionError as ex:
            print('  FAIL ', f'mutant {name}: {ex}'); continue
        try:
            _, b = both(mod)
            hit = bool(b)
        except Exception as ex:                             # a mutant that crashes the suite is caught too, but say so
            hit, b = True, [f'crashed: {type(ex).__name__}: {ex}']
        caught += hit
        print(('  PASS ' if hit else '  FAIL '), f'mutant caught: {name}' + (f'  ({b[0]})' if hit else ' — SURVIVED'))
    total_fail = len(bad) + (len(MUTANTS) - caught)
    print(f'\n{len(ok)} checks passed, {len(bad)} failed; {caught}/{len(MUTANTS)} mutants caught')
    sys.exit(1 if total_fail or not ok else 0)


if __name__ == '__main__':
    main()
