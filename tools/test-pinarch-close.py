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
print(f'\ntest-pinarch-close: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
