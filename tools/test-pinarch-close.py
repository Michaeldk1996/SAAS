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
print(f'\ntest-pinarch-close: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
