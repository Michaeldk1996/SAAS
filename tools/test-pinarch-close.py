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
# the back-fill (founder 2026-10-15 item 4): oldest first, own slot, below the post-start pull
NOW = T('2026-10-15T00:00:00Z'); FRM, TO = T('2026-04-17T00:00:00Z'), T('2026-09-17T00:00:00Z')
fx = [{'fixtureId': 'b3', 'categoryName': 'ATP', 'participant1Name': 'A, B', 'startTime': '2026-06-02T10:00:00Z'},
      {'fixtureId': 'b1', 'categoryName': 'Challenger', 'participant1Name': 'C, D', 'trueStartTime': '2026-05-01T09:00:00Z', 'startTime': '2026-05-01T08:00:00Z'},
      {'fixtureId': 'b2', 'categoryName': 'ATP', 'participant1Name': 'E, F', 'startTime': '2026-05-03T10:00:00Z'},
      {'fixtureId': 'held', 'categoryName': 'ATP', 'participant1Name': 'G, H', 'startTime': '2026-05-02T10:00:00Z'},
      {'fixtureId': 'bucket', 'categoryName': 'ATP', 'participant1Name': 'I, J', 'startTime': '2026-05-02T11:00:00Z'},
      {'fixtureId': 'gone', 'categoryName': 'ATP', 'participant1Name': 'K, L', 'startTime': '2026-05-02T12:00:00Z'},
      {'fixtureId': 'itf', 'categoryName': 'ITF Men', 'participant1Name': 'M, N', 'startTime': '2026-05-02T12:00:00Z'},
      {'fixtureId': 'dbl', 'categoryName': 'ATP', 'participant1Name': 'O / P', 'startTime': '2026-05-02T12:00:00Z'},
      {'fixtureId': 'old', 'categoryName': 'ATP', 'participant1Name': 'Q, R', 'startTime': '2026-04-10T12:00:00Z'},
      {'fixtureId': 'late', 'categoryName': 'ATP', 'participant1Name': 'S, T', 'startTime': '2026-09-20T12:00:00Z'}]
q = P.backfill_queue(fx, {'held'}, {'bucket'}, {'gone': {'n404': 2}}, NOW, FRM, TO)
check('back-fill queue: oldest first; skips a held Pinnacle +30 payload, a bucket object awaiting import, two 404s, ITF, doubles, out of window',
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
print(f'\ntest-pinarch-close: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
