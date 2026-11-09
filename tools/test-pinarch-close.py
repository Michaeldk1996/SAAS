#!/usr/bin/env python3
"""The archive close (founder brief 2026-10-14, item 2): the last ACTIVE Pinnacle +30 match-winner entry at or before our
live-flip start, both sides required; a captured close is superseded (never edited) by the archive close; the same
close from a later pull adds nothing; a different one is a correction; the export carries one close per event, the
archive's over the capture. Orientation: the board map's orient against the api-tennis first player, else both
surnames on the Oddspapi fixture (exactly one candidate). Pure functions, no network."""
import datetime as dt, json, os, sys, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('pinarch', os.path.join(HERE, 'pinarch.py'))
P = importlib.util.module_from_spec(spec); spec.loader.exec_module(P)
passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-400:])
T = lambda s: dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
def e(t, price, active=True): return {'createdAt': t, 'price': price, 'active': active, 'limit': 1000}
# Musetti v Zhou shape: Zhou is participant 1 at Oddspapi, Musetti the api-tennis first player
body = {'fixtureId': 'idMZ', 'bookmakers': {'pinnacle+30': {'markets': {'121': {'outcomes': {
    '121': {'players': {'0': [e('2026-10-09T08:00:00Z', 4.40), e('2026-10-09T10:58:00Z', 4.64), e('2026-10-09T11:01:00Z', 5.10), e('2026-10-09T11:20:00Z', 9.0)]}},
    '122': {'players': {'0': [e('2026-10-09T08:00:00Z', 1.25), e('2026-10-09T10:59:30Z', 1.229), e('2026-10-09T11:00:30Z', 1.20, False), e('2026-10-09T11:20:00Z', 1.05)]}}}}}}}}
S = P.mw_series(json.dumps(body).encode())
cut = T('2026-10-09T11:00:40Z')
c, why = P.close_at(S, cut)
check('close = the last ACTIVE entry at or before the cut, per side (an inactive entry is skipped)', c and c['121'][0] == 4.64 and c['122'][0] == 1.229, (c, why))
c, why = P.close_at(S, T('2026-10-09T07:00:00Z'))
check('no entry before the start → no close, with the reason (never a later price)', c is None and 'no active entry' in why, why)
S2 = P.mw_series(json.dumps({'bookmakers': {'pinnacle+30': {'markets': {'121': {'outcomes': {'121': {'players': {'0': [e('2026-10-09T08:00:00Z', 4.4)]}}}}}}}}).encode())
check('one side missing → no close (both sides required)', P.close_at(S2, cut)[0] is None)
S3 = P.mw_series(json.dumps({'bookmakers': {'pinnacle+30': {'markets': {'121': {'outcomes': {'121': {'players': {'0': [e('2026-10-09T08:00:00Z', 1.005)]}}}, '122': {'players': {'0': [e('2026-10-09T08:00:00Z', 9.0)]}}}}}}}).encode())
check('a price below 1.01 is not a price', P.close_at(S3, cut)[0] is None)
ev = {'event_key': '12168000', 'date': '2026-10-09', 'p1Key': 2849, 'p2Key': 9999, 'p1Name': 'L. Musetti', 'p2Name': 'Y. Zhou',
      'p1IsParticipant1': False, 'cut': cut, 'firstLive': '2026-10-09T11:01:10Z', 'lastNotLive': '2026-10-09T11:00:40Z',
      'trueStart': T('2026-10-09T11:00:00Z')}
row, why = P.archive_close_row(ev, 77, 'idMZ', S)
check('orientation: participant 2 is the api-tennis first player → p1 = 1.229 (Musetti), p2 = 4.64 (Zhou)', row and row['p1'] == 1.229 and row['p2'] == 4.64, row)
check('label, source, close time, start and gap are stored', row['label'] == 'from Pinnacle history' and row['close_ts'].startswith('2026-10-09T10:59:30')
      and row['start_ts'].startswith('2026-10-09T11:00:40') and row['gap_to_start_s'] == 70.0 and row['raw_id'] == 77, row)
sc = row['detail']['startCheck']
check('start check: Oddspapi trueStart 40 s before our cut, one entry inside that window, the close at trueStart recorded',
      sc['trueStartMinusCutS'] == -40 and sc['entriesBetweenTrueStartAndCut'] == 1 and sc['closeAtTrueStart'][:2] == [1.229, 4.64], sc)
captured = {'id': 5, 'event_key': 12168000, 'label': 'captured', 'dedupe_key': 'cap|x', 'p1': 1.23, 'p2': 4.67, 'close_ts': '2026-10-09T10:40:00Z', 'supersedes': None}
add = P.plan_archive_closes([row], [captured])
check('the archive close SUPERSEDES the captured one (a new row; the captured row stays)', len(add) == 1 and add[0]['supersedes'] == 5, add)
held = [captured, dict(add[0], id=6)]
check('the same close from a later pull adds nothing', P.plan_archive_closes([dict(row, dedupe_key=row['dedupe_key'] + 'x')], held) == [])
later = dict(row, p1=1.22, close_ts='2026-10-09T11:00:20+00:00', dedupe_key='other')
add2 = P.plan_archive_closes([later], held)
check('a different close from a later payload is a correction of the archive row', len(add2) == 1 and add2[0]['supersedes'] == 6, add2)
cur = P.current_closes(held + [dict(add2[0], id=7)])
check('current close = the newest archive row nobody supersedes', cur[12168000]['id'] == 7)
cur2 = P.current_closes([captured, dict(captured, id=8, label='captured', dedupe_key='cap|y', supersedes=5)])
check('with no archive row, the newest unsuperseded captured row is current', cur2[12168000]['id'] == 8)
cur3 = P.current_closes([dict(add[0], id=6), dict(captured, id=9, dedupe_key='cap|z', supersedes=5)])
check('a later captured row never displaces an archive close', cur3[12168000]['id'] == 6)
ex = P.export_rows([captured | {'match_date': '2026-10-09', 'p1_key': 2849, 'p2_key': 9999, 'source': 's', 'book': 'b'},
                    dict(add[0], id=6, match_date='2026-10-09', p1_key=2849, p2_key=9999)])
check('export: one row per event in the captured file\'s shape, labelled', len(ex) == 1 and ex[0]['p1'] == 1.229 and ex[0]['label'] == 'from Pinnacle history'
      and ex[0]['p1Key'] == 2849 and ex[0]['date'] == '2026-10-09', ex)
# founder ruling 2026-11-09 (replaces 2026-10-16 round 3 item 2): a close cut at Oddspapi's trueStart ALONE is Oddspapi's
# own close — exported, and it outranks a captured or live-flip close of the same event
base = dict(add[0], match_date='2026-04-20', p1_key=11, p2_key=22)
nf = dict(base, id=20, event_key=7001, start_source=P.NO_FLIP_SOURCE)
nf_cap = dict(captured, id=21, event_key=7002, match_date='2026-04-21', p1_key=11, p2_key=22, source='s', book='b')
nf2 = dict(base, id=22, event_key=7002, start_source=P.NO_FLIP_SOURCE, supersedes=21)
ok = dict(base, id=23, event_key=7003)
exh = {r['eventKey']: r for r in P.export_rows([nf, nf_cap, nf2, ok])}
check("Oddspapi close: a trueStart-only close is exported", exh.get(7001, {}).get('startSource') == P.NO_FLIP_SOURCE and exh[7001]['oddspapiClose'], exh.get(7001))
check("Oddspapi close: the trueStart-only close that superseded a captured one of 21 Apr is the event's export", exh.get(7002, {}).get('archiveId') == 22, exh.get(7002))
exh2 = {r['eventKey']: r for r in P.export_rows([dict(nf_cap, match_date='2026-09-18', start_source='api-tennis-live'), dict(nf2, match_date='2026-09-18')])}
check("Oddspapi close: it beats a captured close at our live-flip (18 Sep)", exh2.get(7002, {}).get('archiveId') == 22, exh2.get(7002))
lf = dict(base, id=24, event_key=7005, start_source=P.CUT_SOURCE)
od = dict(base, id=25, event_key=7005, start_source=P.ODDSPAPI_CLOSE_SOURCE, p1=1.7, supersedes=None)
lf_late = dict(base, id=26, event_key=7005, start_source=P.CUT_SOURCE, p1=1.8)
check("Oddspapi close: it outranks a live-flip close of the same event, even a newer one", P.current_closes([lf, od, lf_late])[7005]['id'] == 25)
same = dict(base, id=27, event_key=7006, start_source=P.CUT_SOURCE, detail={'startCheck': {'closeAtTrueStart': [base['p1'], base['p2'], 'x']}})
check("Oddspapi close: a live-flip close whose price at the trueStart is its own price IS Oddspapi's close", P.is_oddspapi_close(same)
      and not P.is_oddspapi_close(dict(same, detail={'startCheck': {'closeAtTrueStart': [9.9, base['p2'], 'x']}})))
check('control: a close cut at the live-flip / earlier-of rule is exported unchanged', exh.get(7003, {}).get('p1') == base['p1'], exh.get(7003))
check("Oddspapi close: no hold-back reason on a trueStart-only close", not P.held_back(nf) and not P.held_back(nf2) and not P.held_back(ok))
# founder ruling 2026-10-17 item 1: a CAPTURED close of a match on or before 16 Sep (cut at Oddspapi's start alone) is held
# back — kept in the archive as its own source, never exported as a close; from 17 Sep (the live-flip / earlier-of era) it is
cap_jul = dict(captured, id=30, event_key=7101, match_date='2026-07-20', p1_key=11, p2_key=22, source='s', book='b')
cap_sep16 = dict(captured, id=31, event_key=7102, match_date='2026-09-16', p1_key=11, p2_key=22, source='s', book='b')
cap_sep17 = dict(captured, id=32, event_key=7103, match_date='2026-09-17', p1_key=11, p2_key=22, source='s', book='b', start_source='api-tennis-live')
hist_jul = dict(base, id=33, event_key=7104, match_date='2026-07-21', supersedes=None)
cap_jul2 = dict(captured, id=34, event_key=7104, match_date='2026-07-21', p1_key=11, p2_key=22, source='s', book='b')
exc = {r['eventKey']: r for r in P.export_rows([cap_jul, cap_sep16, cap_sep17, hist_jul, cap_jul2])}
check('captured hold-back: a captured close of 20 Jul is never exported (its event has no close)', 7101 not in exc, sorted(exc))
check('captured hold-back: 16 Sep (the last day of the window) is held back too', 7102 not in exc, sorted(exc))
check('captured hold-back: 17 Sep (verified start era) is exported as captured', exc.get(7103, {}).get('label') == 'captured', exc.get(7103))
check('captured hold-back: a live-flip archive close of the same July event is still exported', exc.get(7104, {}).get('label') == 'from Pinnacle history', exc.get(7104))
check('captured hold-back: the rule is named, and the rows stay archive rows', P.held_back_reason(cap_jul) == 'captured-before-live-flip'
      and P.held_back_reason(cap_sep17) is None and P.held_back_reason(nf) is None)
check('control: without the captured hold-back the July captured close WOULD be the export',
      7101 in P.current_closes([cap_jul, cap_sep16, cap_sep17]))
# orientation through the event mapper
fl = [{'event_key': 1, 'first_player': 'L. Musetti', 'second_player': 'Y. Zhou', 'first_live_seen_at': '2026-10-09T11:01:10Z',
       'last_not_live_seen_at': '2026-10-09T11:00:40Z', 'event_date': '2026-10-09', 'event_type_type': 'Atp Singles'},
      {'event_key': 2, 'first_player': 'A. Smith', 'second_player': 'B. Jones', 'first_live_seen_at': '2026-10-09T12:00:00Z',
       'last_not_live_seen_at': '2026-10-09T11:59:50Z', 'event_date': '2026-10-09', 'event_type_type': 'Challenger Men Singles'},
      {'event_key': 3, 'first_player': 'C. Kim', 'second_player': 'D. Lee', 'first_live_seen_at': '2026-10-09T12:00:00Z',
       'last_not_live_seen_at': '2026-10-09T11:59:50Z', 'event_date': '2026-10-09', 'event_type_type': 'Challenger Men Singles'}]
bmap = {'1': {'fixtureId': 'idMZ', 'orient': 'swap', 'p1': 'L. Musetti', 'p2': 'Y. Zhou'}}
disc = [{'fixtureId': 'idSJ', 'participant1Name': 'Jones, Bob', 'participant2Name': 'Smith, Al', 'startTime': '2026-10-09T11:50:00Z', 'trueStartTime': '2026-10-09T11:58:00Z'},
        {'fixtureId': 'idKL1', 'participant1Name': 'Kim, C', 'participant2Name': 'Lee, D', 'startTime': '2026-10-09T11:00:00Z'},
        {'fixtureId': 'idKL2', 'participant1Name': 'Kim, C', 'participant2Name': 'Lee, D', 'startTime': '2026-10-09T15:00:00Z'}]
evs, miss = P.events_for(fl, bmap, disc, {'1': {'first_player_key': '2849', 'second_player_key': '9999'}})
by = {e['event_key']: e for e in evs}
check('board map: orient "swap" with the card p1 = the api-tennis first player → participant 1 is NOT the first player', by['1']['p1IsParticipant1'] is False and by['1']['p1Key'] == 2849)
check('Oddspapi fixture joined on both surnames: participant 1 is the api-tennis SECOND player', by['2']['fixture_id'] == 'idSJ' and by['2']['p1IsParticipant1'] is False
      and by['2']['trueStart'] == T('2026-10-09T11:58:00Z'), by.get('2'))
check('two candidate fixtures → no match (never a guess), counted', '3' not in by and miss.get('two or more Oddspapi fixtures') == 1, miss)
# PostgREST refuses a request whose rows carry different keys (PGRST102, seen on the first derive, 2026-10-14):
# insert() sends one request per key set; the old single-request insert is the control
def fake_rest(sent):
    def rest(method, path, body=None, headers=None, **k):
        if len({tuple(sorted(r)) for r in body}) > 1:
            raise RuntimeError('POST -> HTTP 400: PGRST102 All object keys must match')
        sent.append(body); return 201, [{'id': i} for i in range(len(body))], {}
    return rest
mixed = [{'dedupe_key': 'a', 'p1': 1.5}, {'dedupe_key': 'b', 'p1': 1.6, 'supersedes': 5}, {'dedupe_key': 'c', 'p1': 1.7}]
sent = []; real = P.rest; P.rest = fake_rest(sent)
try: ids = P.insert(P.CLOSE, mixed, 'dedupe_key'); err = None
except Exception as x: ids, err = [], x
check('insert(): rows with and without supersedes go in one request per key set, every row sent, none padded',
      err is None and len(ids) == 3 and len(sent) == 2 and all('supersedes' not in r for r in sent[0]) and sent[1][0].get('supersedes') == 5, (err, sent))
def old_insert(table, rows, conflict):
    _, out, _ = P.rest('POST', '/x', body=rows, headers={}); return [r['id'] for r in out]
try: old_insert(P.CLOSE, mixed, 'dedupe_key'); ctl = False
except RuntimeError: ctl = True
check('control: one request with mixed keys is refused (the first derive\'s failure)', ctl)
P.rest = real
# flips(): PostgREST caps every answer at 1,000 rows; the first 30-day derive read exactly 1,000 and stopped
import re as _re
def cap_rest(total):
    def rest(method, path, body=None, headers=None, **k):
        lim = int(_re.search(r'limit=(\d+)', path).group(1)); off = int((_re.search(r'offset=(\d+)', path) or [0, 0])[1] or 0)
        n = max(0, min(lim, 1000, total - off))
        return 200, [{'event_key': off + j} for j in range(n)], {}
    return rest
P.rest = cap_rest(2003)
got = P.flips(T('2026-09-14T00:00:00Z'))
check('flips(): pages past the 1,000-row cap (2,003 flips → 2,003 rows, none twice)', len(got) == 2003 and len({g['event_key'] for g in got}) == 2003, len(got))
def old_flips(since):
    _, rows, _ = P.rest('GET', '/rest/v1/live_flip_log?limit=20000'); return rows
check('control: one request with limit=20000 returns only 1,000 (the first derive)', len(old_flips(None)) == 1000)
# raw_latest(): the newest payload CARRYING Pinnacle +30, never a newer other-book payload
RAWS = [{'id': 1, 'fixture_id': 'f1', 'books': ['pinnacle+30'], 'pulled_at': 'a', 'payload_gz': 'P1'},
        {'id': 2, 'fixture_id': 'f1', 'books': ['bet365'], 'pulled_at': 'b', 'payload_gz': 'B1'},
        {'id': 3, 'fixture_id': 'f2', 'books': ['bet365'], 'pulled_at': 'c', 'payload_gz': 'B2'}]
def raw_rest(method, path, body=None, headers=None, **k):
    m = _re.search(r'id=eq\.(\d+)', path)
    if m: return 200, [r for r in RAWS if r['id'] == int(m.group(1))], {}
    return 200, [dict(r, payload_gz=None) for r in RAWS], {}
P.rest = raw_rest
rl = P.raw_latest(['f1', 'f2'])
check('raw_latest(): f1 → its Pinnacle +30 payload (id 1), not the newer bet365 one (id 2); f2 (bet365 only) → NO_PINNACLE',
      rl['f1']['id'] == 1 and rl['f1']['payload_gz'] == 'P1' and rl['f2'] is P.NO_PINNACLE, rl)
P.rest = real
# the cut (founder ruling 2026-10-14): the EARLIER of our live-flip and Oddspapi's sanity-gated trueStart
flip = T('2026-09-27T16:40:20Z')
c, src, rej = P.effective_cut(flip, T('2026-09-27T16:36:38Z'), T('2026-09-27T18:10:00Z'), T('2026-09-27T16:30:00Z'))
check('cut: a sane trueStart earlier than our live-flip wins (Dickerson v Pissetti Vialle shape)', c == T('2026-09-27T16:36:38Z') and src == P.TRUE_START_SOURCE, (c, src))
c, src, rej = P.effective_cut(flip, T('2026-09-27T16:45:00Z'), T('2026-09-27T18:10:00Z'), None)
check('cut: a trueStart LATER than our live-flip never moves the cut later (resolve_start alone would, within 5 min)', c == flip and src == P.CUT_SOURCE, (c, src))
c, src, rej = P.effective_cut(flip, T('2026-09-27T09:00:00Z'), T('2026-09-27T18:10:00Z'), None)
check('cut: a trueStart failing the 6 h gate is rejected, with the gate\'s reason', c == flip and rej == 'implausible_duration', (c, rej))
c, src, rej = P.effective_cut(flip, T('2026-09-27T16:36:38Z'), T('2026-09-27T16:00:00Z'), None)
check('cut: end before start is rejected', c == flip and rej == 'end_before_start', (c, rej))
check('cut: no trueStart → our live-flip', P.effective_cut(flip, None, None, None)[0] == flip)
# the close moves with the cut: an in-play entry between trueStart and the live-flip is never the close
S4 = P.mw_series(json.dumps({'bookmakers': {'pinnacle+30': {'markets': {'121': {'outcomes': {
    '121': {'players': {'0': [e('2026-09-27T16:00:00Z', 1.08), e('2026-09-27T16:39:00Z', 1.02)]}},
    '122': {'players': {'0': [e('2026-09-27T16:00:00Z', 7.26), e('2026-09-27T16:39:00Z', 12.09)]}}}}}}}}).encode())
evx = dict(ev, cut=T('2026-09-27T16:36:38Z'), liveFlipCut=flip, cutSource=P.TRUE_START_SOURCE, trueStart=T('2026-09-27T16:36:38Z'), p1IsParticipant1=True)
rx, _ = P.archive_close_row(evx, 9, 'idDP', S4)
check('row: the close at the earlier cut (1.08 / 7.26), start_source names the trueStart, the check still measures against the live-flip',
      rx['p1'] == 1.08 and rx['p2'] == 7.26 and rx['start_source'] == P.TRUE_START_SOURCE and rx['detail']['startCheck']['trueStartMinusCutS'] == -222, rx)
rflip, _ = P.archive_close_row(dict(evx, cut=flip, cutSource=P.CUT_SOURCE), 9, 'idDP', S4)
check('control: cut at the live-flip alone takes the in-play 1.02 / 12.09', rflip['p1'] == 1.02 and rflip['p2'] == 12.09, rflip)
held2 = [dict(rflip, id=40)]
corr = P.plan_archive_closes([rx], held2)
check('the changed close is a NEW correction row superseding the old one (never an edit)', len(corr) == 1 and corr[0]['supersedes'] == 40 and corr[0]['dedupe_key'] != rflip['dedupe_key'], corr)
# the post-start pull's own slot: never the odds loop's key gate, always pinnacle+30, 5 s cooldown, 429 pause + retry
import inspect
src_pull = inspect.getsource(P.cmd_pull) + inspect.getsource(P.hist_get)
check('pull: no odds-loop key gate in the pull path (wait_for_key / daily_hist_get / loop_idle / key_is_ours)',
      not any(x in src_pull for x in ('wait_for_key', 'daily_hist_get', 'loop_idle', 'key_is_ours')), src_pull[:200])
calls, now_ = [], [100.0]
slept = []
def fake_get(f):
    calls.append((f, now_[0])); return (None, 429) if len(calls) == 1 else (b'{}', None)
def fake_sleep(x): slept.append(x); now_[0] += x
P._last_hist[0] = 98.0
cnt = {}
body, err = P.hist_get('idX', 'k', cnt, clock=lambda: now_[0], sleep=fake_sleep, get=fake_get)
check('pull: 5.5 s cooldown honoured, a 429 pauses 60 s and retries the same fixture', body == b'{}' and len(calls) == 2 and slept[0] == 3.5 and 60 in slept
      and calls[1][1] - calls[0][1] >= 60 and cnt['http429'] == 1, (calls, slept, cnt))
class FA:
    seen = []
    @staticmethod
    def api_get(path, params, key, timeout=0, raw=False):
        FA.seen.append((path, dict(params))); return b'{}', None
real_load = P._load; P._load = lambda n, f: FA
P._last_hist[0] = 0.0
P.hist_get('idY', 'k', {}, sleep=lambda x: None)
P._load = real_load
check('pull: every history call names bookmakers=pinnacle+30 (never the account default)', FA.seen == [('/v4/historical-odds', {'fixtureId': 'idY', 'bookmakers': 'pinnacle+30'})], FA.seen)
# the back-fill (founder 2026-10-15 item 4): oldest first, own slot, below the post-start pull
NOW = T('2026-10-15T00:00:00Z'); FRM, TO = T('2026-04-17T00:00:00Z'), T('2026-09-17T00:00:00Z')
fx = [{'fixtureId': 'b3', 'categoryName': 'ATP', 'participant1Name': 'A, B', 'startTime': '2026-06-02T10:00:00Z'},
      {'fixtureId': 'b1', 'categoryName': 'Challenger', 'participant1Name': 'C, D', 'trueStartTime': '2026-05-01T09:00:00Z', 'startTime': '2026-05-01T08:00:00Z'},
      {'fixtureId': 'b2', 'categoryName': 'ATP', 'participant1Name': 'E, F', 'startTime': '2026-05-03T10:00:00Z'},
      {'fixtureId': 'held', 'categoryName': 'ATP', 'participant1Name': 'G, H', 'startTime': '2026-05-02T10:00:00Z'},
      {'fixtureId': 'bucket', 'categoryName': 'ATP', 'participant1Name': 'I, J', 'startTime': '2026-05-02T11:00:00Z'},
      {'fixtureId': 'gone', 'categoryName': 'ATP', 'participant1Name': 'K, L', 'startTime': '2026-05-02T12:00:00Z'},
      {'fixtureId': 'itf', 'categoryName': 'ITF Women', 'participant1Name': 'M, N', 'startTime': '2026-05-02T12:00:00Z'},
      {'fixtureId': 'dbl', 'categoryName': 'ATP', 'participant1Name': 'O / P', 'startTime': '2026-05-02T12:00:00Z'},
      {'fixtureId': 'old', 'categoryName': 'ATP', 'participant1Name': 'Q, R', 'startTime': '2026-04-10T12:00:00Z'},
      {'fixtureId': 'late', 'categoryName': 'ATP', 'participant1Name': 'S, T', 'startTime': '2026-09-20T12:00:00Z'}]
q = P.backfill_queue(fx, {'held'}, {'bucket'}, {'gone': {'n404': 2}}, NOW, FRM, TO)
check('back-fill queue: oldest first; skips a held Pinnacle +30 payload, a bucket object awaiting import, two 404s, ITF Women, doubles, out of window',
      [x[1] for x in q] == ['b1', 'b2', 'b3'], [x[1] for x in q])
check('back-fill queue: a fixture with ONE 404 is asked again', [x[1] for x in P.backfill_queue(fx, set(), set(), {'b1': {'n404': 1}}, NOW, FRM, TO)][0] == 'b1')
calls_gh, now2 = [], [0.0]
def gh(path):
    calls_gh.append(path); return ({'total_count': 1 if 'in_progress' in path else 0}, None)
P._busy.update(at=-1e9, busy=False)
check('back-fill yields while a post-start pull run is in progress', P.postmatch_busy(clock=lambda: now2[0], gh=gh) is True and any('oddspapi-postmatch.yml' in c for c in calls_gh), calls_gh)
P._busy.update(at=-1e9, busy=False)
check('back-fill: an unreadable runs list counts as busy (never runs over the pull)', P.postmatch_busy(clock=lambda: 0.0, gh=lambda p: (None, 'boom')) is True)
P._busy.update(at=-1e9, busy=False)
check('back-fill: nothing queued or running → its turn', P.postmatch_busy(clock=lambda: 0.0, gh=lambda p: ({'total_count': 0}, None)) is False)
P._busy.update(at=-1e9, busy=False)
src_bf = inspect.getsource(P.cmd_backfill)
check('back-fill: no odds-loop key gate, the pull\'s hist_get (pinnacle+30), a gap wider than the pull\'s cooldown, insert-only',
      not any(x in src_bf for x in ('wait_for_key', 'daily_hist_get', 'loop_idle', 'key_is_ours', 'sb_upload')) and 'hist_get(' in src_bf and 'postmatch_busy()' in src_bf
      and P.BACKFILL_GAP_S > P.HIST_COOLDOWN_S and 'insert(RAW' in src_bf, src_bf[:120])
# player keys from the current api-tennis fixture (founder 2026-10-15 item 5)
rows_k = [{'eventKey': 12164753, 'p1Key': 1880, 'p2Key': 31666, 'p1Name': 'S. Mochizuki', 'p2Name': 'L. Xiao'},
          {'eventKey': 2, 'p1Key': 10, 'p2Key': 20, 'p1Name': 'A. Alpha', 'p2Name': 'B. Beta'},
          {'eventKey': 3, 'p1Key': 99, 'p2Key': 98, 'p1Name': 'C. Gamma', 'p2Name': 'D. Delta'},
          {'eventKey': 4, 'p1Key': 7, 'p2Key': 8, 'p1Name': 'E. Eps', 'p2Name': 'F. Phi'},
          {'eventKey': 5, 'p1Key': 50, 'p2Key': 51, 'p1Name': 'G. Ga', 'p2Name': 'H. Ha'}]
cur_fx = {12164753: {'first_player_key': 1880, 'second_player_key': 38140, 'event_first_player': 'S. Mochizuki', 'event_second_player': 'L. Xiao'},
          2: {'first_player_key': 20, 'second_player_key': 10},
          3: {'first_player_key': 11, 'second_player_key': 12, 'event_first_player': 'D. Delta', 'event_second_player': 'C. Gamma'},
          4: None,
          5: {'first_player_key': 60, 'second_player_key': 61, 'event_first_player': 'X. Other', 'event_second_player': 'Y. Other'}}
kr = P.refresh_keys(rows_k, cur_fx.get)
check('keys: L. Xiao 31666 → 38140 from the current fixture (Mochizuki\'s key orients it)', rows_k[0]['p1Key'] == 1880 and rows_k[0]['p2Key'] == 38140, rows_k[0])
check('keys: a swapped but equal key pair is unchanged', rows_k[1]['p1Key'] == 10 and rows_k[1]['p2Key'] == 20)
check('keys: both keys changed → oriented by the names (C. Gamma = fixture second)', rows_k[2]['p1Key'] == 12 and rows_k[2]['p2Key'] == 11, rows_k[2])
check('keys: unreadable fixture → stored keys stand, counted', rows_k[3]['p1Key'] == 7 and kr['unreadable'] == 1, kr)
check('keys: names that do not orient → stored keys stand, counted (never a guess)', rows_k[4]['p1Key'] == 50 and kr['unoriented'] == 1 and kr['changed'] == 2, kr)
# item 3: the archive close's api-tennis result is refreshed from the current fixture (the feed then adds the match)
rr = [{'eventKey': 12170243, 'p1Key': 430, 'p2Key': 2073, 'p1Name': 'C. Ruud', 'p2Name': 'F. Auger-Aliassime', 'label': P.ARCHIVE_LABEL,
       'apiTennis': {'event_status': 'Set 1', 'event_type_type': 'Atp Singles', 'tournament_name': 'ATP Shanghai', 'tournament_round': 'ATP Shanghai - 1/8-finals'}},
      {'eventKey': 9, 'p1Key': 1, 'p2Key': 2, 'p1Name': 'A. A', 'p2Name': 'B. B', 'label': 'captured'}]
fx3 = {12170243: {'first_player_key': 430, 'second_player_key': 2073, 'event_status': 'Finished', 'event_winner': 'First Player', 'event_type_type': 'Atp Singles',
                  'tournament_name': 'ATP Shanghai', 'tournament_round': 'ATP Shanghai - 1/8-finals', 'event_first_player': 'C. Ruud', 'event_second_player': 'F. Auger-Aliassime'},
       9: {'first_player_key': 1, 'second_player_key': 2, 'event_status': 'Finished', 'event_winner': 'First Player'}}
k3 = P.refresh_keys(rr, fx3.get)
check('result: an archive close derived mid-match ("Set 1") takes the current fixture\'s result (Finished, First Player)',
      rr[0]['apiTennis']['event_status'] == 'Finished' and rr[0]['apiTennis']['event_winner'] == 'First Player' and k3['resultRefreshed'] == 1, rr[0])
check('result: a captured row is left without an api-tennis result (its orientation is the card\'s)', 'apiTennis' not in rr[1], rr[1])
alias_ = P.parse_alias(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build-tournament-market.js')).read())
td_ = [{'date': '2025-10-08', 'tournament': 'Shanghai Masters', 'series': 'Masters 1000', 'court': 'Outdoor', 'surface': 'Hard', 'round': '4th Round', 'bestof': '3', 'winner': 'X Y.', 'loser': 'Z W.', 'psw': '1.5', 'psl': '2.6', 'comment': 'Completed'},
       {'date': '2025-10-05', 'tournament': 'Shanghai Masters', 'series': 'Masters 1000', 'court': 'Outdoor', 'surface': 'Hard', 'round': '3rd Round', 'bestof': '3', 'winner': 'X Y.', 'loser': 'Z W.', 'psw': '1.5', 'psl': '2.6', 'comment': 'Completed'}]
ex3 = dict(rr[0], date='2026-10-14', p1=1.8, p2=2.05)
f_before, rep_b = P.td_feed_rows([dict(ex3, apiTennis={'event_status': 'Set 1', 'event_type_type': 'Atp Singles', 'tournament_name': 'ATP Shanghai', 'tournament_round': 'ATP Shanghai - 1/8-finals'})], td_, alias_, '2026-01-13')
f_after, rep_a = P.td_feed_rows([ex3], td_, alias_, '2026-01-13')
check('feed: control — the stored mid-match result is "noResult"; with the refreshed result the match is added (R16 = 4th Round)',
      rep_b['noResult'] == 1 and rep_a['add'] == 1 and f_after[0]['round'] == '4th Round' and f_after[0]['winner'] == 'Ruud C.', (rep_b, rep_a, f_after))
# item 1: the failed fixture joins — Davis Cup is discovered, compound surnames join (and nothing looser)
check('discovery keeps Oddspapi\'s Davis Cup category (api-tennis files those ties as Atp Singles); an older cache is asked again',
      'Davis Cup' in P.DISCOVERY_CATEGORIES and 'ITF Men' not in P.DISCOVERY_CATEGORIES and 'cache.get(\'v\') != DISCOVERY_VERSION' in inspect.getsource(P.discovery))
# founder ruling 2026-10-18 item 3: the back-fill pulls ITF Men too; the live-flip joins never see an ITF fixture
_now = dt.datetime(2026, 10, 18, tzinfo=dt.timezone.utc)
_fx = [{'fixtureId': 'itf1', 'participant1Name': 'A, B', 'startTime': '2026-04-20T10:00:00Z', 'categoryName': 'ITF Men'},
       {'fixtureId': 'ch1', 'participant1Name': 'C, D', 'startTime': '2026-04-20T11:00:00Z', 'categoryName': 'Challenger'},
       {'fixtureId': 'w1', 'participant1Name': 'E, F', 'startTime': '2026-04-20T12:00:00Z', 'categoryName': 'ITF Women'}]
_q = [x[1] for x in P.backfill_queue(_fx, set(), set(), {}, _now, dt.datetime(2026, 4, 13, tzinfo=dt.timezone.utc), dt.datetime(2026, 9, 17, tzinfo=dt.timezone.utc))]
check('back-fill: ITF Men queued with ATP / Challenger (never ITF Women); the live-flip joins keep DISCOVERY_CATEGORIES (no ITF)',
      _q == ['itf1', 'ch1'] and 'ITF Men' in P.BACKFILL_CATEGORIES and 'ITF Men' not in P.DISCOVERY_CATEGORIES
      and 'itf=True' in inspect.getsource(P.cmd_backfill) and 'itf=True' not in inspect.getsource(P.cmd_derive), _q)
fl2 = [{'event_key': 11, 'first_player': 'P. Lagutin', 'second_player': 'I. Parisca', 'first_live_seen_at': '2026-10-11T14:40:00Z',
        'last_not_live_seen_at': '2026-10-11T14:39:30Z', 'event_date': '2026-10-11', 'event_type_type': 'Challenger Men Singles'},
       {'event_key': 12, 'first_player': 'Wu Tung-Lin', 'second_player': 'M. Dahlin', 'first_live_seen_at': '2026-09-20T07:05:00Z',
        'last_not_live_seen_at': '2026-09-20T07:04:30Z', 'event_date': '2026-09-20', 'event_type_type': 'Atp Singles'},
       {'event_key': 13, 'first_player': 'A. Martin', 'second_player': 'B. Cole', 'first_live_seen_at': '2026-10-11T10:00:00Z',
        'last_not_live_seen_at': '2026-10-11T09:59:30Z', 'event_date': '2026-10-11', 'event_type_type': 'Challenger Men Singles'}]
disc2 = [{'fixtureId': 'idLP', 'participant1Name': 'Lagutin, Pavel', 'participant2Name': 'Parisca Romera, Ignacio', 'startTime': '2026-10-11T14:25:00Z', 'categoryName': 'Challenger'},
         {'fixtureId': 'idLO', 'participant1Name': 'Lagutin, Pavel', 'participant2Name': 'Ovcharenko, Oleksandr', 'startTime': '2026-10-12T11:20:00Z', 'categoryName': 'Challenger'},
         {'fixtureId': 'idWD', 'participant1Name': 'Wu, Tung-Lin', 'participant2Name': 'Dahlin, Max', 'startTime': '2026-09-20T06:40:00Z', 'categoryName': 'Davis Cup'},
         {'fixtureId': 'idLSM', 'participant1Name': 'Lopez San Martin, Alberto', 'participant2Name': 'Cole, Ben', 'startTime': '2026-10-11T09:50:00Z', 'categoryName': 'Challenger'}]
evs2, miss2 = P.events_for(fl2, {}, disc2, {})
by2 = {e['event_key']: e for e in evs2}
check('join: "I. Parisca" = "Parisca Romera, Ignacio" (ours starts theirs), oriented', by2.get('11', {}).get('fixture_id') == 'idLP' and by2['11']['p1IsParticipant1'] is True, by2.get('11'))
check('join: Davis Cup "Wu Tung-Lin" v "M. Dahlin" = "Wu, Tung-Lin" v "Dahlin, Max"', by2.get('12', {}).get('fixture_id') == 'idWD', by2.get('12'))
check('join: "A. Martin" is never "Lopez San Martin" (a tail of theirs is not ours)', '13' not in by2, by2.get('13'))
real_orient = P._load('roh', 'refresh-odds-history.py').orient
check('control: the strict join alone finds neither Parisca Romera nor Wu, Tung-Lin', real_orient({'p1': 'P. Lagutin', 'p2': 'I. Parisca'}, 'Lagutin, Pavel', 'Parisca Romera, Ignacio') is None
      and real_orient({'p1': 'Wu Tung-Lin', 'p2': 'M. Dahlin'}, 'Wu, Tung-Lin', 'Dahlin, Max') is None)
# a dropped connection mid-body is one failed fixture, never the end of the run (back-fill, 15 Oct 02:01Z)
import http.client
def boom(f): raise http.client.IncompleteRead(b'', 61948)
P._last_hist[0] = 0.0
b_, e_ = P.hist_get('idZ', 'k', {}, sleep=lambda x: None, get=boom)
check('pull: an IncompleteRead is returned as an error (network: IncompleteRead), not raised', b_ is None and e_ == 'network: IncompleteRead', (b_, e_))
# founder ruling 2026-10-16 (TEN-437 item 6): a held payload whose match has NO live-flip row is cut at Oddspapi's trueStart
# alone, after the same gate; missing or rejected -> no close; never the schedule, never an in-play entry
TS, TE, SCH = T('2026-04-20T10:07:00Z'), T('2026-04-20T11:40:00Z'), T('2026-04-20T10:00:00Z')
c, src, rej = P.effective_cut(None, TS, TE, SCH)
check('no live-flip: the sane trueStart is the cut, start_source names it', c == TS and src == P.NO_FLIP_SOURCE == 'oddspapi trueStart (no live-flip held)' and rej is None, (c, src, rej))
check('no live-flip: no trueStart → no cut (never the scheduled time)', P.effective_cut(None, None, TE, SCH) == (None, None, P.NO_TRUE_START))
check('no live-flip: a trueStart over 6 h before its end is rejected → no cut, the gate\'s reason',
      P.effective_cut(None, T('2026-04-20T03:00:00Z'), TE, SCH) == (None, None, 'implausible_duration'))
check('no live-flip: no end and a trueStart over 6 h before the schedule → rejected', P.effective_cut(None, T('2026-04-20T03:00:00Z'), None, SCH) == (None, None, 'implausible_early_start'))
check('no live-flip: end before start → rejected', P.effective_cut(None, TS, T('2026-04-20T09:00:00Z'), SCH)[2] == 'end_before_start')
check('control: with a live-flip the earlier-of rule is unchanged (an earlier sane trueStart wins; a later one never moves the cut)',
      P.effective_cut(T('2026-04-20T10:09:00Z'), TS, TE, SCH)[:2] == (TS, P.TRUE_START_SOURCE)
      and P.effective_cut(T('2026-04-20T10:05:00Z'), TS, TE, SCH)[:2] == (T('2026-04-20T10:05:00Z'), P.CUT_SOURCE)
      and P.effective_cut(T('2026-04-20T10:05:00Z'), T('2026-04-20T03:00:00Z'), TE, SCH) == (T('2026-04-20T10:05:00Z'), P.CUT_SOURCE, 'implausible_duration'))
S5 = P.mw_series(json.dumps({'bookmakers': {'pinnacle+30': {'markets': {'121': {'outcomes': {
    '121': {'players': {'0': [e('2026-04-20T08:00:00Z', 1.60), e('2026-04-20T10:06:30Z', 1.55), e('2026-04-20T10:07:00Z', 1.52), e('2026-04-20T10:20:00Z', 1.15)]}},
    '122': {'players': {'0': [e('2026-04-20T08:00:00Z', 2.40), e('2026-04-20T10:05:00Z', 2.55), e('2026-04-20T10:07:01Z', 2.70), e('2026-04-20T10:20:00Z', 5.50)]}}}}}}}}).encode())
atf = [{'event_key': 12112000, 'event_date': '2026-04-20', 'event_time': '10:00', 'event_first_player': 'A. Rinderknech', 'event_second_player': 'T. Paul',
        'first_player_key': 111, 'second_player_key': 222, 'event_type_type': 'Atp Singles', 'event_status': 'Finished', 'event_winner': 'Second Player',
        'tournament_name': 'ATP Munich', 'tournament_round': 'ATP Munich - 1/16-finals'},
       {'event_key': 12112001, 'event_date': '2026-04-20', 'event_time': '12:00', 'event_first_player': 'B. Bonzi', 'event_second_player': 'C. Moutet',
        'first_player_key': 333, 'second_player_key': 444, 'event_type_type': 'Atp Singles', 'event_status': 'Finished'},
       {'event_key': 12112002, 'event_date': '2026-04-20', 'event_time': '13:00', 'event_first_player': 'D. Altmaier', 'event_second_player': 'E. Hanfmann',
        'first_player_key': 555, 'second_player_key': 666, 'event_type_type': 'Atp Singles', 'event_status': 'Finished'},
       {'event_key': 12112003, 'event_date': '2026-04-20', 'event_time': '14:00', 'event_first_player': 'F. Fritz', 'event_second_player': 'G. Gaston',
        'first_player_key': 777, 'second_player_key': 888, 'event_type_type': 'Atp Singles', 'event_status': 'Finished'},
       {'event_key': 12112004, 'event_date': '2026-04-20', 'event_time': '15:00', 'event_first_player': 'H. Hurkacz', 'event_second_player': 'I. Ivashka',
        'first_player_key': 1, 'second_player_key': 2, 'event_type_type': 'Atp Singles', 'event_status': 'Walk Over'},
       {'event_key': 12112005, 'event_date': '2026-04-12', 'event_time': '15:00', 'event_first_player': 'J. Jarry', 'event_second_player': 'K. Kecmanovic',
        'first_player_key': 3, 'second_player_key': 4, 'event_type_type': 'Atp Singles', 'event_status': 'Finished'}]
idx = {'idRP': {'cat': 'ATP', 'p1': 'Paul, Tommy', 'p2': 'Rinderknech, Arthur', 'startSched': '2026-04-20T10:00:00Z', 'trueStart': '2026-04-20T10:07:00Z', 'trueEnd': '2026-04-20T11:40:00Z'},
       'idBM': {'cat': 'ATP', 'p1': 'Bonzi, Benjamin', 'p2': 'Moutet, Corentin', 'startSched': '2026-04-20T12:00:00Z', 'trueStart': '2026-04-20T05:00:00Z', 'trueEnd': '2026-04-20T13:30:00Z'},
       'idAH': {'cat': 'ATP', 'p1': 'Altmaier, Daniel', 'p2': 'Hanfmann, Yannick', 'startSched': '2026-04-20T13:00:00Z', 'trueStart': None, 'trueEnd': None}}
meta_rows = [{'id': 1, 'fixture_id': 'idFG', 'meta': {'trigger': 'backfill', 'participants': ['Fritz, Taylor', 'Gaston, Hugo'], 'startTime': '2026-04-20T14:00:00Z',
              'trueStartTime': '2026-04-20T14:03:00Z', 'category': 'ATP'}},
             {'id': 2, 'fixture_id': 'idRP', 'meta': {'trigger': 'backfill', 'participants': ['Paul, Tommy', 'Rinderknech, Arthur'], 'startTime': '2026-04-20T10:00:00Z',
              'trueStartTime': '2026-04-20T10:07:00Z', 'category': 'ATP'}}]
fxm = P.held_fixture_meta(idx, meta_rows)
check('held fixtures: the committed index (with trueEnd) over a back-fill row\'s meta; a fixture only in the meta is kept',
      fxm['idRP']['from'] == 'fixture index' and fxm['idRP']['trueEndTime'] == '2026-04-20T11:40:00Z' and fxm['idFG']['from'] == 'back-fill raw meta', fxm)
hevs, hmiss, hwhy = P.events_held(atf, fxm, {'12112003'})
hby = {x['event_key']: x for x in hevs}
check('no live-flip event: joined on both surnames, participant 1 = the api-tennis SECOND player, cut = trueStart, keys from api-tennis',
      list(hby) == ['12112000'] and hby['12112000']['fixture_id'] == 'idRP' and hby['12112000']['p1IsParticipant1'] is False
      and hby['12112000']['cut'] == T('2026-04-20T10:07:00Z') and hby['12112000']['cutSource'] == P.NO_FLIP_SOURCE and hby['12112000']['p1Key'] == 111, (hevs, hmiss))
hw = dict(hwhy)
check('rejected trueStart → no close, counted with the gate\'s reason; missing trueStart → no close, counted',
      hw.get('12112001') == 'trueStart: implausible_duration' and hw.get('12112002') == 'trueStart: ' + P.NO_TRUE_START, hwhy)
check('a match WITH a live-flip row is left to the live-flip derive; a walkover never starts; outside the window → not this path',
      hw.get('12112003', '').startswith('live-flip row held') and hw.get('12112004', '').startswith('api-tennis: never started') and '12112005' not in hw, hwhy)
hrow, _ = P.archive_close_row(hby['12112000'], 2, 'idRP', S5)
check('no live-flip close: the last active entry at or before trueStart per side (Paul 1.52 @10:07:00, Rinderknech 2.55), never the 10:07:01 / 10:20 in-play',
      hrow['p1'] == 2.55 and hrow['p2'] == 1.52 and hrow['close_ts'].startswith('2026-04-20T10:07:00') and hrow['start_ts'].startswith('2026-04-20T10:07:00')
      and hrow['start_source'] == P.NO_FLIP_SOURCE and hrow['label'] == 'from Pinnacle history' and hrow['gap_to_start_s'] == 0.0, hrow)
hsc = hrow['detail']['startCheck']
check('no live-flip close: startCheck says no live-flip and keeps the trueStart / trueEnd / schedule', hsc['liveFlip'] is None and hsc['oddspapiTrueStart'].startswith('2026-04-20T10:07')
      and hsc['oddspapiTrueEnd'].startswith('2026-04-20T11:40') and 'trueStartMinusCutS' not in hsc, hsc)
check('control: cut at the schedule + 20 min would take the in-play 5.50 / 1.15 (so the trueStart cut is what keeps it out)',
      P.close_at(S5, T('2026-04-20T10:20:00Z'))[0]['122'][0] == 5.50)
NOW_RAWS = {'idRP': {'id': 2, 'payload_gz': '\\x' + __import__('gzip').compress(json.dumps({'bookmakers': {'pinnacle+30': {'markets': {'121': {'outcomes': {
    '121': {'players': {'0': [e('2026-04-20T08:00:00Z', 1.60)]}}, '122': {'players': {'0': [e('2026-04-20T08:00:00Z', 2.40)]}}}}}}}}).encode()).hex()}}
drows, dwhy, _ = P.derive_rows(hevs, NOW_RAWS)
check('derive_rows: the held payload → one row; a fixture with no payload is counted, never priced', len(drows) == 1 and drows[0]['p1'] == 2.40 and dwhy == {}, (drows, dwhy))
_, dwhy2, dper2 = P.derive_rows(hevs, {})
check('derive_rows: no payload held → "no raw payload yet", per event', dwhy2 == {'no raw payload yet': 1} and dper2 == [('12112000', 'no raw payload yet')], (dwhy2, dper2))
held_cap = [{'id': 50, 'event_key': 12112000, 'label': 'captured', 'dedupe_key': 'c', 'p1': 2.5, 'p2': 1.5, 'close_ts': '2026-04-20T09:00:00Z', 'supersedes': None}]
pa = P.plan_archive_closes(drows, held_cap)
check('insert-only: the new close supersedes a held one by a NEW row (never an edit); held again → nothing added',
      len(pa) == 1 and pa[0]['supersedes'] == 50 and P.plan_archive_closes(drows, held_cap + [dict(pa[0], id=51)]) == [], pa)
twin = [dict(atf[0], event_key=12112099, event_time='11:00')]
tev, tmiss, _ = P.events_held(atf[:1] + twin, fxm, set())
check('one Oddspapi fixture claimed by two api-tennis events → neither gets a close (never a guess)', tev == [] and tmiss.get('one Oddspapi fixture, two api-tennis events') == 2, tmiss)
src_dh = inspect.getsource(P.cmd_derive_held)
check('derive-held: never the metered /v4/fixtures (no discovery(), no api_get), writes only through insert(), --dry-run inserts nothing',
      'discovery(' not in src_dh and 'api_get' not in src_dh and 'insert(CLOSE' in src_dh and 'if not dry_run' in src_dh, src_dh[:200])
# TEN-437 review: the dispatch writes to the permanent archive only on dry_run exactly "no"; any other value runs nothing
_wf = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.github', 'workflows', 'pinnacle-archive.yml')).read()
_dh = _wf[_wf.index("if: env.MODE == 'derive-held'"):]
_dh = _dh[:_dh.index('      - name:')]
check('derive-held dispatch fails closed: "yes" = --dry-run, only "no" inserts, anything else exits without running',
      'case "$DRY_RUN" in' in _dh and 'yes) python3 tools/pinarch.py derive-held --from "$FROM" --to "$TO" --dry-run ;;' in _dh
      and '*)   echo "dry_run must be exactly' in _dh and 'exit 2' in _dh and _dh.count('derive-held --from') == 2
      and "DRY_RUN: ${{ github.event.inputs.dry_run || 'yes' }}" in _dh, _dh[:300])
# founder ruling 2026-11-09: derive-oddspapi — Oddspapi's own close for EVERY held payload, a live-flip match included, ITF Men too
_do = _wf[_wf.index("if: env.MODE == 'derive-oddspapi'"):]
_do = _do[:_do.index('      - name:')]
check('derive-oddspapi dispatch fails closed: "yes" = --dry-run, only "no" inserts',
      'yes) python3 tools/pinarch.py derive-oddspapi --from "$FROM" --to "$TO" --dry-run ;;' in _do and _do.count('derive-oddspapi --from') == 2
      and '*)   echo "dry_run must be exactly' in _do and "DRY_RUN: ${{ github.event.inputs.dry_run || 'yes' }}" in _do, _do[:300])
_fbk = {'12112003': {'event_key': '12112003', 'last_not_live_seen_at': '2026-04-20T14:00:30Z', 'first_live_seen_at': '2026-04-20T14:00:40Z'}}
_itf = dict(atf[0], event_key=12112010, event_first_player='L. Lehecka', event_second_player='M. Mensik',
            first_player_key=9, second_player_key=10, event_type_type='Itf Men Singles')
_fxm2 = dict(fxm, idLM={'fixtureId': 'idLM', 'participant1Name': 'Lehecka, Jiri', 'participant2Name': 'Mensik, Jakub', 'startTime': '2026-04-20T16:00:00Z',
                        'trueStartTime': '2026-04-20T16:04:00Z', 'categoryName': 'ITF Men'})
oevs, omiss, _ = P.events_held(atf + [_itf], _fxm2, set(), None, P.HELD_FROM, P.HELD_TO, levels=P.ODDSPAPI_LEVELS,
                               categories=P.BACKFILL_CATEGORIES, flips_by_key=_fbk)
oby = {x['event_key']: x for x in oevs}
check("derive-oddspapi: a live-flip match (Fritz) and an ITF Men match are included, cut at Oddspapi's start as Oddspapi's own close",
      sorted(oby) == ['12112000', '12112003', '12112010'] and all(x['cutSource'] == P.ODDSPAPI_CLOSE_SOURCE for x in oevs)
      and oby['12112003']['cut'] == T('2026-04-20T14:03:00Z') and oby['12112003']['liveFlipCut'] == T('2026-04-20T14:00:30Z')
      and oby['12112010']['cut'] == T('2026-04-20T16:04:00Z'), (oevs, omiss))
check('control: without the new flags the same call keeps the old derive-held scope (no live-flip match, no ITF)',
      sorted(x['event_key'] for x in P.events_held(atf + [_itf], _fxm2, {'12112003'})[0]) == ['12112000'])

# ── False 0-0 starts (founder brief 2026-10-27): recut_plan re-cuts an archive close at the gated trueStart ──────────
# Berrettini shape: the current close (cut at the false 12:18:21 start) = 1.581 / 2.53; api-tennis first player is
# Oddspapi participant 2 here, so orientation must come from reproducing the current close, never from slot order.
fbody = {'bookmakers': {'pinnacle+30': {'markets': {'121': {'outcomes': {
    '121': {'players': {'0': [e('2026-10-26T11:53:16Z', 2.53), e('2026-10-26T12:30:00Z', 2.60), e('2026-10-26T12:35:40Z', 2.70, False)]}},
    '122': {'players': {'0': [e('2026-10-26T11:53:16Z', 1.581), e('2026-10-26T12:30:00Z', 1.55), e('2026-10-26T12:35:40Z', 1.50, False)]}}}}}}}}
FS = P.mw_series(json.dumps(fbody).encode())
fcur = {'id': 3880, 'event_key': 12173975, 'fixture_id': 'idB', 'match_date': '2026-10-26', 'p1_key': 1, 'p2_key': 2, 'p1_name': 'M. Berrettini',
        'p2_name': 'T. Etcheverry', 'p1': 1.581, 'p2': 2.53, 'label': P.ARCHIVE_LABEL, 'close_ts': '2026-10-26T11:53:16+00:00',
        'start_ts': '2026-10-26T12:18:21+00:00', 'start_source': P.CUT_SOURCE, 'dedupe_key': 'old', 'detail': {'apiTennis': {'event_key': 12173975}}}
TS, TE = T('2026-10-26T12:35:29.147Z'), T('2026-10-26T14:06:22.131Z')
row, rep = P.recut_plan(fcur, FS, TS, TE)
check('recut: close at trueStart = last active entry before Pinnacle suspended (1.55 / 2.60), oriented by the current close',
      row and (row['p1'], row['p2']) == (1.55, 2.60) and rep['moved'] and rep['nextEntry']['active'] is False, (row and (row['p1'], row['p2']), rep))
check('recut: the row is cut at trueStart under the false-start source, and is a verified (exported) close',
      row and row['start_ts'] == TS.isoformat() and row['start_source'] == P.FALSE_START_SOURCE and P.verified_start(dict(row, label=P.ARCHIVE_LABEL))
      and not P.held_back(row), row and (row['start_source'], row['start_ts']))
check('recut: the superseded live-flip is recorded in the row detail', row and row['detail']['startCheck']['supersededLiveFlip']['start'] == fcur['start_ts'])
add = P.plan_archive_closes([row], [fcur])
check('recut: plan_archive_closes adds ONE superseding row (current close stays)', len(add) == 1 and add[0]['supersedes'] == 3880, add)
same = P.mw_series(json.dumps({'bookmakers': {'pinnacle+30': {'markets': {'121': {'outcomes': {
    '121': {'players': {'0': [e('2026-10-26T11:53:16Z', 2.53)]}}, '122': {'players': {'0': [e('2026-10-26T11:53:16Z', 1.581)]}}}}}}}}).encode())
row2, rep2 = P.recut_plan(fcur, same, TS, TE)
check('recut: a price that did not move writes nothing', row2 is None and rep2['moved'] is False and 'stop' not in rep2, rep2)
other = P.mw_series(json.dumps({'bookmakers': {'pinnacle+30': {'markets': {'121': {'outcomes': {
    '121': {'players': {'0': [e('2026-10-26T11:53:16Z', 2.40)]}}, '122': {'players': {'0': [e('2026-10-26T11:53:16Z', 1.62)]}}}}}}}}).encode())
row3, rep3 = P.recut_plan(fcur, other, TS, TE)
check('recut: a series that does not reproduce the current close at its own cut -> stop, nothing cut', row3 is None and 'does not reproduce' in rep3.get('stop', ''), rep3)
row4, rep4 = P.recut_plan(fcur, FS, TS, TS + dt.timedelta(hours=7))
check('recut: a trueStart the gate rejects (end - start > 6 h) -> stop', row4 is None and 'gate' in rep4.get('stop', ''), rep4)
row5, rep5 = P.recut_plan(fcur, FS, None, TE)
check('recut: no trueStart -> stop (never the scheduled time)', row5 is None and rep5.get('stop'), rep5)
check('recut: Echargui is not re-cut (founder 2026-10-27: keep 1.735 / 2.14)', 12174272 not in P.FALSE_START_RECUT and len(P.FALSE_START_RECUT) == 2)
# mutant: orientation from slot order (participant 1 = api-tennis first player) would give 2.60 / 1.55 — caught above
_src = open(os.path.join(HERE, 'pinarch.py')).read()
check('recut workflow: dry run unless exactly "no"', 'yes) python3 tools/pinarch.py false-starts-recut ;;' in open(os.path.join(HERE, '..', '.github/workflows/pinnacle-archive.yml')).read())

# founder 2026-11-03: the post-start pull reaches every started match; one with no verified live-flip start is pulled
# ONCE (>= PULL_GAP_MIN after our flag) and no close is derived from it; a bound match is pulled and derived as before
def _pull_run(flips_rows, prior_raw=None, now_s=None, disc=None):
    Q = importlib.util.module_from_spec(spec); spec.loader.exec_module(Q)
    seen = {'hist': [], 'insert': [], 'derive': None}
    class A:
        @staticmethod
        def _clock_s(): return 0
    real_load = Q._load
    Q._load = lambda n, f: A if n == 'aor' else real_load(n, f)
    Q.env = lambda k: 'k'
    Q.flips = lambda since, until=None: flips_rows
    Q.select_all = lambda *a, **k: []
    Q.discovery = lambda *a, **k: (disc or [], 0)
    Q._at_keys = lambda days: ({}, [])
    Q._board_map = lambda: {r['event_key']: {'fixtureId': 'fx' + r['event_key'], 'orient': 'same', 'p1': r['first_player']} for r in flips_rows}
    Q.rest = lambda m, path, *a, **k: (200, prior_raw or [], None)
    Q.hist_get = lambda fx, key, counts: (seen['hist'].append(fx) or b'{}', None)
    Q.payload_parts = lambda body: (b'', b'{}', 'sha')
    Q.books_of = lambda b: ['pinnacle+30']
    Q.hexbytes = lambda b: ''
    Q.insert = lambda table, rows, conflict: (seen['insert'].extend(rows) or [1] * len(rows))
    Q.raw_latest = lambda fxs: []
    def dera(evs, raws):
        seen['derive'] = [e['event_key'] for e in evs]
        seen['cuts'] = {e['event_key']: (e['cutSource'], e['cut']) for e in evs}
        return {'derived': len(evs), 'added': 0}, []
    Q.derive_and_add = dera
    if now_s:
        class FakeDT(dt.datetime):
            @classmethod
            def now(cls, tz=None): return dt.datetime.fromtimestamp(now_s, dt.timezone.utc)
        Q.dt = type('m', (), {'datetime': FakeDT, 'timedelta': dt.timedelta, 'timezone': dt.timezone})
    rep = Q.cmd_pull(600, '/dev/null', hours=6)
    return rep, seen
now_ = T('2026-11-02T12:00:00Z').timestamp()
FL = [{'event_key': '1', 'first_player': 'I. Buse', 'second_player': 'Z. Bergs', 'event_date': '2026-11-02',
       'first_live_seen_at': '2026-11-02T10:00:08Z', 'last_not_live_seen_at': None},
      {'event_key': '2', 'first_player': 'D. Merida Aguilar', 'second_player': 'S. Baez', 'event_date': '2026-11-02',
       'first_live_seen_at': '2026-11-02T11:32:15Z', 'last_not_live_seen_at': '2026-11-02T11:32:05Z'}]
rep, seen = _pull_run(FL, now_s=now_)
check('pull: a match with NO verified start is pulled too; a verified one is pulled and derived',
      sorted(seen['hist']) == ['fx1', 'fx2'] and seen['derive'] == ['2'] and rep['pulledNoStart'] == 1, (seen, rep))
meta = {r['meta']['eventKey']: r['meta'] for r in seen['insert']}
check('pull: the unbound match\'s raw row says so (cut None, cutSource names the pull-only reason)',
      meta['1']['cut'] is None and meta['1']['cutSource'] == P.PULL_ONLY_SOURCE and meta['2']['cut'], meta)
rep, seen = _pull_run(FL, now_s=T('2026-11-02T10:10:00Z').timestamp())
check('pull: an unbound match is not pulled until PULL_GAP_MIN after our live flag (the pre-match market has closed)',
      'fx1' not in seen['hist'], seen['hist'])
rep, seen = _pull_run(FL, prior_raw=[{'fixture_id': 'fx1', 'pulled_at': '2026-11-02T10:40:00Z', 'source': 'oddspapi /v4/historical-odds', 'books': ['pinnacle+30']}], now_s=now_)
check('pull: an unbound match is pulled once — never again once its payload is held', 'fx1' not in seen['hist'], seen['hist'])

# founder ruling 2026-11-09: every pulled match with Oddspapi's trueStart gets Oddspapi's own close — bound or not; a
# payload held from an earlier run is derived too; with no trueStart yet a verified match keeps its live-flip cut
DISC = [{'fixtureId': 'fx1', 'participant1Name': 'Buse, Ignacio', 'participant2Name': 'Bergs, Zizou', 'startTime': '2026-11-02T10:00:00Z',
         'trueStartTime': '2026-11-02T10:06:00Z', 'categoryName': 'ATP'},
        {'fixtureId': 'fx2', 'participant1Name': 'Merida Aguilar, Daniel', 'participant2Name': 'Baez, Sebastian', 'startTime': '2026-11-02T11:30:00Z',
         'trueStartTime': '2026-11-02T11:40:00Z', 'categoryName': 'ATP'}]
rep, seen = _pull_run(FL, now_s=now_, disc=DISC)
check("pull: both matches derive Oddspapi's own close at Oddspapi's start (founder 2026-11-09)",
      sorted(seen['derive']) == ['1', '2'] and all(v[0] == P.ODDSPAPI_CLOSE_SOURCE for v in seen['cuts'].values())
      and seen['cuts']['1'][1] == T('2026-11-02T10:06:00Z') and seen['cuts']['2'][1] == T('2026-11-02T11:40:00Z'), seen)
rep, seen = _pull_run(FL, prior_raw=[{'fixture_id': 'fx1', 'pulled_at': '2026-11-02T10:40:00Z', 'source': 'oddspapi /v4/historical-odds', 'books': ['pinnacle+30']}],
                      now_s=now_, disc=DISC)
check("pull: a payload held from an earlier run is derived at Oddspapi's start once the start is known", '1' in (seen['derive'] or []) and 'fx1' not in seen['hist'], seen)
rep, seen = _pull_run(FL, now_s=now_, disc=[dict(DISC[0], trueStartTime=None), dict(DISC[1], trueStartTime=None)])
check("pull: no trueStart yet -> the verified match keeps its live-flip cut, the unbound one waits",
      seen['derive'] == ['2'] and seen['cuts']['2'][0] == P.CUT_SOURCE and rep['waitingForTrueStart'], (seen, rep))
_now = T('2026-11-02T12:00:00Z')
check('discovery: a started fixture with no trueStart (10 min - 48 h) makes its window stale',
      P.missing_true_start([{'startTime': '2026-11-02T11:00:00Z', 'trueStartTime': None}], _now)
      and not P.missing_true_start([{'startTime': '2026-11-02T11:00:00Z', 'trueStartTime': '2026-11-02T11:05:00Z'}], _now)
      and not P.missing_true_start([{'startTime': '2026-11-02T11:55:00Z', 'trueStartTime': None}], _now)
      and not P.missing_true_start([{'startTime': '2026-10-30T11:00:00Z', 'trueStartTime': None}], _now))
_ser = P.mw_series(json.dumps({'bookmakers': {'pinnacle+30': {'markets': {'121': {'outcomes': {
    '121': {'players': {'0': [e('2026-11-02T08:00:00Z', 1.80), e('2026-11-02T10:05:00Z', 1.70), e('2026-11-02T10:20:00Z', 1.20)]}},
    '122': {'players': {'0': [e('2026-11-02T08:00:00Z', 2.00), e('2026-11-02T10:05:00Z', 2.15), e('2026-11-02T10:20:00Z', 4.50)]}}}}}}}}).encode())
_ev = {'event_key': '9', 'date': '2026-11-02', 'p1IsParticipant1': True, 'cut': T('2026-11-02T10:00:20Z'), 'cutSource': P.CUT_SOURCE,
       'liveFlipCut': T('2026-11-02T10:00:20Z'), 'trueStart': T('2026-11-02T10:06:00Z'), 'trueEnd': T('2026-11-02T11:30:00Z'), 'scheduled': T('2026-11-02T10:00:00Z'), 'p1Key': 11, 'p2Key': 22}
_o, _ = P.oddspapi_cut(_ev)
_r, _ = P.archive_close_row(_o, 1, 'fx9', _ser)
check("Oddspapi close: cut at the trueStart (1.70 / 2.15), never an entry after it (1.20 / 4.50); the open is the first pair",
      _r['p1'] == 1.70 and _r['p2'] == 2.15 and _r['start_source'] == P.ODDSPAPI_CLOSE_SOURCE and _r['detail']['open'][:2] == [1.80, 2.00], _r)
_lf, _ = P.archive_close_row(_ev, 1, 'fx9', _ser)
check("control: the live-flip cut gives the earlier price (1.80 / 2.00), so the re-cut is what moves it", _lf['p1'] == 1.80, _lf)
_x = P.export_rows([dict(_lf, id=1, label=P.ARCHIVE_LABEL), dict(_r, id=2, label=P.ARCHIVE_LABEL, supersedes=1)])
check("export: Oddspapi's close is the event's export and carries its open", len(_x) == 1 and _x[0]['p1'] == 1.70 and _x[0]['oddspapiClose']
      and _x[0]['open']['p1'] == 1.80 and _x[0]['open']['p2'] == 2.00, _x)
check("Oddspapi close: no trueStart -> no re-cut (never the schedule)", P.oddspapi_cut(dict(_ev, trueStart=None))[0] is None)

# Founder 2026-11-08: a captured close re-labelled at the verified start (earlierCut) is a NEW archive row (own key), so it
# supersedes the held 'oddspapi' row; that row is held back, the new one exports as a captured close.
_cr = {'eventKey': 7, 'date': '2026-11-05', 'p1Key': 1, 'p2Key': 2, 'p1': 1.5, 'p2': 2.6, 'at': '2026-11-05T10:00:00Z', 'book': 'Pinnacle +30s'}
_old = P.captured_close_rows([dict(_cr, trueStart='2026-11-05T10:20:00Z', startSource='oddspapi')])[0]
_new = P.captured_close_rows([dict(_cr, trueStart='2026-11-05T10:25:00Z', startSource='bet105-switch',
                                   earlierCut={'trueStart': '2026-11-05T10:20:00Z', 'source': 'oddspapi'})])[0]
check('earlier cut: the re-labelled row has its own dedupe key', _old['dedupe_key'] != _new['dedupe_key'], (_old['dedupe_key'], _new['dedupe_key']))
_add = P.plan_captured([_new], [dict(_old, id=11)])
check('earlier cut: it is added and supersedes the held row', len(_add) == 1 and _add[0].get('supersedes') == 11, _add)
_rows = [dict(_old, id=11), dict(_add[0], id=12)]
check('earlier cut: the old row is held back, the new one is the export', P.held_back(_rows[0]) and not P.held_back(_rows[1])
      and [r['p1'] for r in P.export_rows(_rows)] == [1.5] and P.export_rows(_rows)[0]['startSource'] == 'bet105-switch' if 'startSource' in P.export_rows(_rows)[0] else True, P.export_rows(_rows))
check('earlier cut: a plain row keeps the old key (no re-import of held rows)', _old['dedupe_key'].split('|')[3] == '')

# founder 2026-11-09 (ITF Men included): Oddspapi names ITF players given-name first ("Wihan Van Der Merwe"); the join tries
# every surname split, still both players and exactly one candidate (measured 15 Jul 2026: 181 of 187 ITF matches join)
check('ITF names: every "Surname, Given" split of a given-name-first name; a comma name / pair / one word is itself',
      P.od_name_variants('Wihan Van Der Merwe') == ['Van Der Merwe, Wihan', 'Der Merwe, Wihan Van', 'Merwe, Wihan Van Der']
      and P.od_name_variants('Viiala, Zack') == ['Viiala, Zack'] and P.od_name_variants('A / B') == ['A / B'] and P.od_name_variants('Cher') == ['Cher'])
check('ITF names: given-first pairs orient (same / swap), compound surname and extra initials included',
      P.orient_given_first('W. Van Der Merwe', 'C. Sinclair', 'Wihan Van Der Merwe', 'Colin Sinclair') == 'same'
      and P.orient_given_first('C. Sinclair', 'W. Van Der Merwe', 'Wihan Van Der Merwe', 'Colin Sinclair') == 'swap'
      and P.orient_given_first('A. Capatos I.', 'B. Petre S.', 'Andrei Capatos', 'Stefan Ilie Bogdan Petre') == 'same')
check('ITF names: another player, or comma names (the ATP / Challenger form, joined before), never orient here',
      P.orient_given_first('W. Van Der Merwe', 'C. Smith', 'Wihan Van Der Merwe', 'Colin Sinclair') is None
      and P.orient_given_first('Z. Viiala', 'T. Takizawa', 'Viiala, Zack', 'Takizawa, Taiki') is None)
_itfx = {'pnI': {'fixtureId': 'pnI', 'participant1Name': 'Zack Viiala', 'participant2Name': 'Taiki Takizawa', 'startTime': '2026-07-15T00:12:10Z',
                 'trueStartTime': '2026-07-15T00:14:00Z', 'categoryName': 'ITF Men'}}
_ia = [{'event_key': 77001, 'event_date': '2026-07-15', 'event_first_player': 'T. Takizawa', 'event_second_player': 'Z. Viiala',
        'first_player_key': 5, 'second_player_key': 6, 'event_type_type': 'Itf Men Singles', 'event_status': 'Finished'}]
_w0, _w1 = T('2026-07-15T00:00:00Z'), T('2026-07-16T00:00:00Z')
_ie, _im, _ = P.events_held(_ia, _itfx, set(), None, _w0, _w1, levels=P.ODDSPAPI_LEVELS, categories=P.BACKFILL_CATEGORIES, flips_by_key={})
check('ITF join: a given-first Oddspapi fixture joins its api-tennis match, oriented (Takizawa is participant 2)',
      len(_ie) == 1 and _ie[0]['fixture_id'] == 'pnI' and _ie[0]['p1IsParticipant1'] is False and _ie[0]['cutSource'] == P.ODDSPAPI_CLOSE_SOURCE, (_ie, _im))
_keep = P.orient_given_first
P.orient_given_first = lambda *a: None
try:
    _ie2, _im2, _ = P.events_held(_ia, _itfx, set(), None, _w0, _w1, levels=P.ODDSPAPI_LEVELS, categories=P.BACKFILL_CATEGORIES, flips_by_key={})
finally:
    P.orient_given_first = _keep
check('control: without the given-first join the ITF match finds no fixture (the gap of the 9 Nov dry runs)', _ie2 == [] and _im2.get('no Oddspapi fixture held') == 1, _im2)

print(f'\ntest-pinarch-close: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
