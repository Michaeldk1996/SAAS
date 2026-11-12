#!/usr/bin/env python3
"""The historical odds archive (founder brief 2026-10-16, items 1-4), on pure functions and temp dirs — no network.
Each check has a control (the mutation it must catch)."""
import collections, csv, datetime as dt, gzip, io, json, os, shutil, subprocess, sys, tempfile, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('tdarch', os.path.join(HERE, 'tdarch.py'))
T = importlib.util.module_from_spec(spec); spec.loader.exec_module(T)
passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-400:])

HEAD = 'date,tournament,series,court,surface,round,bestof,winner,loser,wrank,lrank,comment,b365w,b365l,psw,psl,maxw,maxl,avgw,avgl,avgsrc\n'
def csvb(*rows):
    return (HEAD + ''.join(','.join(r) + '\n' for r in rows)).encode()
R1 = ['2026-01-05', 'Brisbane', 'ATP250', 'Outdoor', 'Hard', '1st Round', '3', 'Alpha A.', 'Beta B.', '1', '2', 'Completed', '1.5', '2.5', '1.52', '2.6', '', '', '', '', 'file']
R2 = ['2026-03-01', 'Dubai', 'ATP500', 'Outdoor', 'Hard', '2nd Round', '3', 'Gamma C.', 'Delta D.', '1', '2', 'Completed', '1.8', '2', '', '', '', '', '', '', 'file']
R3 = ['2026-03-02', 'Dubai', 'ATP500', 'Outdoor', 'Hard', '2nd Round', '3', 'Eps E.', 'Zeta Z.', '1', '2', 'Completed', '-', '', '', '', '', '', '', '', 'file']
R0 = ['2009-05-01', 'Rome', 'Masters', 'Outdoor', 'Clay', 'Final', '3', 'Old O.', 'Timer T.', '1', '2', 'Completed', '1.5', '2.5', '1.5', '2.6', '', '', '', '', 'file']
files = [('odds-archive/2026.csv', csvb(R1, R2, R3)), ('odds-archive/2009.csv', csvb(R0))]
rows = T.td_close_rows(files)
by = collections.Counter((r['source'], r['winner']) for r in rows)
check('closes: Pinnacle and Bet365 are SEPARATE rows, each only when both prices are real; 2009 is out',
      by == collections.Counter({('tennis-data Pinnacle', 'Alpha A.'): 1, ('tennis-data Bet365', 'Alpha A.'): 1, ('tennis-data Bet365', 'Gamma C.'): 1}), by)
check('closes: a dash or an empty price is no row (never a zero)', not any(r['winner'] == 'Eps E.' for r in rows))
check('closes: every row names the sha256 of the file it came from', all(r['file_sha256'] == T.sha(files[0][1]) for r in rows))
for i, r in enumerate(rows): r['id'] = i + 1
held = [dict(r) for r in rows]
check('plan: a re-import adds nothing', T.plan_closes(T.td_close_rows(files), held) == [])
R1b = list(R1); R1b[14] = '1.55'
add = T.plan_closes(T.td_close_rows([('odds-archive/2026.csv', csvb(R1b, R2, R3))]), held)
check('plan: a changed Pinnacle price is ONE new row that supersedes the old one (the old row stays)',
      len(add) == 1 and add[0]['price_winner'] == 1.55 and add[0]['supersedes'] == next(r['id'] for r in held if r['source'] == 'tennis-data Pinnacle'), add)
# export
td = held + [dict(add[0], id=99)]
arch = [{'eventKey': 1, 'date': '2026-03-01', 'p1Name': 'D. Delta', 'p2Name': 'C. Gamma', 'p1': 2.1, 'p2': 1.75, 'label': 'from Pinnacle history',
         'closeTs': '2026-03-01T10:59:00Z', 'startTs': '2026-03-01T11:00:00Z', 'startSource': 'live-flip (last poll not live)', 'gapToStartS': 60,
         'apiTennis': {'event_type_type': 'Atp Singles', 'tournament_name': 'ATP Dubai'}},
        {'eventKey': 2, 'date': '2026-03-04', 'p1Name': 'X. Chal', 'p2Name': 'Y. Lenger', 'p1': 1.3, 'p2': 3.4, 'label': 'captured',
         'apiTennis': {'event_type_type': 'Challenger Men Singles', 'tournament_name': 'Challenger Biel', 'tournament_round': 'Challenger Biel - 1/8-finals',
                       'event_winner': 'Second Player', 'event_final_result': '0 - 2'}},
        {'eventKey': 3, 'date': '2026-03-05', 'p1Name': 'Q. Qual', 'p2Name': 'R. Ifier', 'p1': 1.9, 'p2': 1.9, 'label': 'from Pinnacle history',
         'apiTennis': {'event_type_type': 'Itf Men Singles', 'tournament_name': 'M25'}}]
ex = T.export_rows(td, arch, T.td_matches(files))
e = {(r['date'], r['player1']): r for r in ex}
check('export: one row per Tennis-Data match 2010+, priced or not (Eps v Zeta has empty prices)',
      ('2026-03-02', 'Eps E.') in e and e[('2026-03-02', 'Eps E.')]['pinnacle_p1'] == '' and e[('2026-03-02', 'Eps E.')]['bet365_p1'] == '', sorted(e))
a = e[('2026-01-05', 'Alpha A.')]
check('export: a Tennis-Data Pinnacle close is the CURRENT row (the correction), source Tennis-Data, Bet365 beside it',
      a['pinnacle_p1'] == 1.55 and a['source'] == 'Tennis-Data' and a['bet365_p1'] == 1.5 and a['bet365_source'] == 'Tennis-Data', a)
g = e[('2026-03-01', 'Gamma C.')]
check('export: a Tennis-Data match with no Pinnacle pair takes the ONE archive close that joins it, oriented to its winner, with times',
      g['pinnacle_p1'] == 1.75 and g['pinnacle_p2'] == 2.1 and g['source'] == 'Oddspapi' and g['start_source'].startswith('live-flip') and g['gap_to_start_s'] == 60, g)
c = [r for r in ex if r['player1'] == 'X. Chal']
check('export: an archive-only Challenger close is its own row, labelled Challenger, winner from api-tennis, Bet365 empty',
      len(c) == 1 and c[0]['tour'] == 'Challenger' and c[0]['winner'] == 'Y. Lenger' and c[0]['source'] == 'captured' and c[0]['bet365_p1'] == '', c)
check('export: an ITF close is not exported (ATP main draw / qualifying / Challenger only)', not any(r['player1'] == 'Q. Qual' for r in ex))
check('export: the joined archive close is not ALSO its own row', sum(1 for r in ex if r['date'] == '2026-03-01') == 1)
cb = T.csv_bytes(ex).decode()
check('export: the header is the brief\'s columns, in order', cb.splitlines()[0] == ','.join(T.EXPORT_COLS))
check('export: a missing value is an empty cell, never 0', ',0,' not in cb and ',0\n' not in cb)
# dated files, never replaced
ops = tempfile.mkdtemp()
man = T.write_export(ops, '2026-10-16', ex)
names = [f['name'] for f in man['files']]
check('export: one 2010–YYYY file plus one per year, dated in the name', names[0] == 'pinnacle-closes-2010-2026_2026-10-16.csv' and 'pinnacle-closes-2026_2026-10-16.csv' in names, names)
# founder ruling 2026-10-16 (round 3, item 5): a same-day re-run skips a COMPLETE day with a clear line, replaces nothing,
# and a real failure (an incomplete or tampered day) is never hidden as a skip
import contextlib
before = {f: open(os.path.join(ops, T.EXPORT_DIR, '2026-10-16', f), 'rb').read() for f in os.listdir(os.path.join(ops, T.EXPORT_DIR, '2026-10-16'))}
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    again = T.write_export(ops, '2026-10-16', ex[:1])
after = {f: open(os.path.join(ops, T.EXPORT_DIR, '2026-10-16', f), 'rb').read() for f in os.listdir(os.path.join(ops, T.EXPORT_DIR, '2026-10-16'))}
check('export: a same-day re-run of a complete day is skipped ("day already written, skipped"), nothing replaced',
      again is None and 'day already written, skipped' in buf.getvalue() and before == after, buf.getvalue())
bad_day = os.path.join(ops, T.EXPORT_DIR, '2026-10-17'); os.makedirs(bad_day)
try:
    T.write_export(ops, '2026-10-17', ex); hid = True
except RuntimeError as e:
    hid = 'not a complete day' not in str(e)
check('control: a day folder without its manifest is a real failure, never skipped or replaced', not hid)
shutil.copytree(os.path.join(ops, T.EXPORT_DIR, '2026-10-16'), os.path.join(ops, T.EXPORT_DIR, '2026-10-18'))
open(os.path.join(ops, T.EXPORT_DIR, '2026-10-18', names[0]), 'ab').write(b'x')
try:
    T.write_export(ops, '2026-10-18', ex); hid = True
except RuntimeError as e:
    hid = 'does not match its manifest' not in str(e)
check('control: a day whose file does not match its manifest is a real failure, never skipped', not hid)
shutil.rmtree(bad_day); shutil.rmtree(os.path.join(ops, T.EXPORT_DIR, '2026-10-18'))
n, bad = T.verify_exports(ops)
check('export: every file matches its manifest sha256', n == len(names) and bad == [], (n, bad))
p = os.path.join(ops, T.EXPORT_DIR, '2026-10-16', names[0])
open(p, 'ab').write(b'x')
check('control: a tampered export file is reported', T.verify_exports(ops)[1] == [names[0]])
shutil.rmtree(ops)
# inventory: every git version, one entry per sha256
repo = tempfile.mkdtemp()
G = lambda *a: subprocess.run(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', *a], cwd=repo, check=True, capture_output=True)
G('init', '-q'); os.makedirs(os.path.join(repo, 'odds-archive'))
open(os.path.join(repo, 'odds-archive', '2026.csv'), 'wb').write(csvb(R1)); G('add', '.'); G('commit', '-qm', 'a')
open(os.path.join(repo, 'odds-archive', '2026.csv'), 'wb').write(csvb(R1, R2)); G('add', '.'); G('commit', '-qm', 'b')
wb = tempfile.mkdtemp(); open(os.path.join(wb, '2026_2.xlsx'), 'wb').write(b'PK\x03\x04 not a real workbook')
inv = T.inventory(repo, [wb])
k = collections.Counter(x['source'] for x in inv)
check('inventory: both git versions of 2026.csv are kept (HEAD = the second, not stored twice) and the workbook is a drop-in original',
      len(inv) == 3 and k['git history'] == 2 and k['drop-in workbook'] == 1 and any(x.get('describeError') for x in inv if x['kind'] == 'workbook'), [(x['name'], x['source']) for x in inv])
fr = T.file_rows(inv)
check('file rows: gzip of the ORIGINAL bytes, which decompress back to their sha256',
      all(T.sha(gzip.decompress(bytes.fromhex(r['content_gz'][2:]))) == r['sha256'] for r in fr))
shutil.rmtree(repo); shutil.rmtree(wb)
# a reader that exits (the .xls reader without xlrd) blanks the description, never stops the archive run
_orig = T.P._load
class _M:
    @staticmethod
    def read_xls(b): raise SystemExit('pre-2013 seasons are .xls and need xlrd')
T.P._load = lambda n, f: _M
d = T.describe_workbook(b'\xd0\xcf\x11\xe0 old xls')
T.P._load = _orig
check('workbook: a reader that calls sys.exit is caught (the bytes are still stored; the description is a dash)',
      d['row_count'] is None and 'xlrd' in d.get('describeError', ''), d)
# ── Pinnacle (approx.), founder ruling 2026-10-16 ──
A1 = dict(zip(HEAD.strip().split(','), ['2026-02-03', 'Dallas', 'ATP500', 'Indoor', 'Hard', '1st Round', '3', 'Alpha A.', 'Beta B.', '1', '2', 'Completed', '1.5', '2.5', '', '', '', '', '', '', 'file']))
A2 = dict(A1, date='2026-01-12')                                     # before the window
A3 = dict(A1, date='2026-01-13', psw='1.52', psl='2.6')             # Tennis-Data has Pinnacle: never replaced
A4 = dict(A1, date='2026-09-17')                                     # after the window (16 Sep, founder round 3 item 3)
A7 = dict(A1, date='2026-05-20', winner='Eta E.', loser='Theta T.')  # inside the widened window (13 Apr - 16 Sep)
A5 = dict(A1, date='2026-03-01', winner='Gamma C.', loser='Delta D.', comment='Walkover')
A6 = dict(A1, date='2026-03-02', winner='Eps E.', loser='Zeta Z.')
tg = T.approx_targets([A1, A2, A3, A4, A5, A6, A7])
check('approx: targets = the window 13 Jan – 16 Sep, no Tennis-Data Pinnacle pair, walkovers out',
      [r['date'] for r in tg] == ['2026-02-03', '2026-03-02', '2026-05-20'], [r['date'] for r in tg])
tg = T.approx_targets([A1, A2, A3, A4, A5, A6])
bd = {'2026-02-04': [{'event_key': 7, 'event_first_player': 'B. Beta', 'event_second_player': 'A. Alpha', 'event_date': '2026-02-04'}],
      '2026-03-02': [{'event_key': 8, 'event_first_player': 'E. Eps', 'event_second_player': 'Z. Zeta', 'event_date': '2026-03-02'},
                     {'event_key': 9, 'event_first_player': 'Z. Zeta', 'event_second_player': 'E. Eps', 'event_date': '2026-03-02'}]}
check('approx: the one fixture, either orientation (winner second here)', T.approx_join(A1, bd)[0]['event_key'] == 7 and T.approx_join(A1, bd)[1] is False)
check('control: two candidate fixtures join nothing (never a guess)', T.approx_join(A6, bd) == (None, 'two fixtures'))
odds = {7: {'Home': {'Pncl': '2.40', 'bet365': '2.3'}, 'Away': {'Pncl': '1.62'}}}
rows_, rep_ = T.approx_rows(tg, bd, odds.get, '2026-10-16T12:00:00+00:00')
r0 = rows_[0] if rows_ else {}
check('approx: Home = the first player, oriented to the Tennis-Data winner (Away 1.62 / Home 2.40)',
      len(rows_) == 1 and r0['price_winner'] == 1.62 and r0['price_loser'] == 2.4 and r0['label'] == 'Pinnacle (approx.)' and r0['source'] == 'api-tennis Pinnacle', rows_)
check('approx: the report counts every target (one stored, one two-fixture join)', rep_ == {'stored': 1, 'join: two fixtures': 1}, rep_)
r1, rp1 = T.approx_rows(tg[:1], bd, {7: {'Home': {'Pncl': '2.40'}, 'Away': {'bet365': '1.6'}}}.get, 'x')
check('approx: a missing Pinnacle side is no row (Bet365 stays the fallback; never another book)', r1 == [] and rp1 == {'no Pinnacle pair on api-tennis': 1}, (r1, rp1))
r2, _ = T.approx_rows(tg[:1], bd, {7: {'Home': {'Pncl': '1.00'}, 'Away': {'Pncl': '9'}}}.get, 'x')
check('approx: a price below 1.01 is no row', r2 == [])
held = [dict(r0, id=1)]
check('approx: a re-import adds nothing', T.plan_snapshots(rows_, held) == [])
ch = T.approx_rows(tg[:1], bd, {7: {'Home': {'Pncl': '2.30'}, 'Away': {'Pncl': '1.65'}}}.get, 'x')[0]
pl = T.plan_snapshots(ch, held)
check('approx: a changed snapshot is ONE new row that supersedes the old one', len(pl) == 1 and pl[0]['supersedes'] == 1, pl)
cur = T.current_snapshots(held + [dict(pl[0], id=2)])
fr = T.approx_feed_rows(cur)
check('approx: the feed carries the current snapshot only', len(fr) == 1 and fr[0]['psw'] == 1.65 and fr[0]['snapshotId'] == 2 and list(fr[0]) == T.APPROX_FEED_COLS, fr)
check('approx: the hover is the ruled words', T.APPROX_HOVER == 'Pinnacle snapshot from api-tennis, no timestamp, not a confirmed close')

# ── Pinnacle (approx.) from the Oddspapi Pinnacle archive at start - 10 (founder ruling 2026-10-17, item 2) ──
B1 = dict(A1, date='2026-05-20', winner='Eta E.', loser='Theta T.')
B0 = dict(A1, date='2026-04-12', winner='Kappa K.', loser='Lambda L.')              # before the start - 10 window
tg10 = T.start10_targets([A1, B0, B1, A4])
check('start10: targets = 13 Apr - 16 Sep only (January - 12 April stays on api-tennis)', [r['date'] for r in tg10] == ['2026-05-20'], [r['date'] for r in tg10])
bd10 = {'2026-05-20': [{'event_key': 50, 'event_first_player': 'T. Theta', 'event_second_player': 'E. Eta', 'event_date': '2026-05-20', 'event_time': '12:00'}]}
FX = {'F50': {'trueStartTime': '2026-05-20T12:00:00Z', 'trueEndTime': '2026-05-20T13:30:00Z', 'startTime': '2026-05-20T12:00:00Z', 'from': 'fixture index'}}
def e(ts, p, active=True): return {'createdAt': ts, 'price': p, 'active': active}
SER = {'121': [e('2026-05-20T11:40:00Z', 2.10), e('2026-05-20T11:49:00Z', 2.20), e('2026-05-20T11:55:00Z', 2.30), e('2026-05-20T12:05:00Z', 3.00)],
       '122': [e('2026-05-20T11:40:00Z', 1.75), e('2026-05-20T11:48:00Z', 1.70), e('2026-05-20T11:56:00Z', 1.65), e('2026-05-20T12:05:00Z', 1.40)]}
od_of = lambda f: ('F50', True)                                                   # the api-tennis first player = participant 1
r10, rep10 = T.start10_rows(tg10, bd10, od_of, FX, lambda fid: (77, SER), '2026-10-17T10:00:00+00:00')
x = r10[0] if r10 else {}
check('start10: the last ACTIVE pinnacle+30 pair at trueStart - 10 min, oriented to the Tennis-Data winner (Eta 1.70 / Theta 2.20)',
      len(r10) == 1 and x['price_winner'] == 1.70 and x['price_loser'] == 2.2 and x['source'] == 'oddspapi Pinnacle (start − 10)' and x['label'] == 'Pinnacle (approx.)', r10)
check('start10: stored with its cut, price time, start, start source and gap to start',
      x.get('cut_ts') == '2026-05-20T11:50:00Z' and x.get('price_ts') == '2026-05-20T11:49:00Z' and x.get('start_ts') == '2026-05-20T12:00:00Z'
      and x.get('gap_to_start_s') == 660.0 and x.get('start_source') == T.P.NO_FLIP_SOURCE and x.get('fixture_id') == 'F50' and x.get('raw_id') == 77, x)
check('control: an entry after the cut (11:55 / 11:56) and an in-play one (12:05) are never the price', x.get('price_winner') not in (1.65, 1.40) and x.get('price_loser') not in (2.30, 3.00))
r10b, _ = T.start10_rows(tg10, bd10, lambda f: ('F50', False), FX, lambda fid: (77, SER), 'x')
check('start10: the other orientation (api first player = participant 2) swaps the sides', r10b and r10b[0]['price_winner'] == 2.20 and r10b[0]['price_loser'] == 1.70, r10b)
bad = {'F50': dict(FX['F50'], trueEndTime='2026-05-21T09:00:00Z')}
rr, rp = T.start10_rows(tg10, bd10, od_of, bad, lambda fid: (77, SER), 'x')
check('start10: a trueStart the ruled gate rejects (a match over 6 h) gives no row (api-tennis, then Bet365, price it)', rr == [] and any(k.startswith('start: ') for k in rp), rp)
late = {'121': SER['121'][2:], '122': SER['122'][2:]}
rr2, rp2 = T.start10_rows(tg10, bd10, od_of, FX, lambda fid: (77, late), 'x')
check('start10: no active pair at or before the cut gives no row', rr2 == [] and any(k.startswith('no pre-cut pair') for k in rp2), rp2)
rr3, rp3 = T.start10_rows(tg10, bd10, od_of, FX, lambda fid: (None, 'no pinnacle+30 payload held'), 'x')
check('start10: no payload held gives no row', rr3 == [] and rp3 == {'payload: no pinnacle+30 payload held': 1}, rp3)
B2 = dict(B1, winner='Eta E.', loser='Theta T.', tournament='Other')
rr4, rp4 = T.start10_rows([B1, B2], bd10, od_of, FX, lambda fid: (77, SER), 'x')
check('start10: one Oddspapi fixture two Tennis-Data rows claim is no one\'s', rr4 == [] and rp4.get('oddspapi: one fixture, two Tennis-Data rows') == 2, rp4)
at_row = T.approx_rows(tg10, {'2026-05-20': bd10['2026-05-20']}, {50: {'Home': {'Pncl': '2.25'}, 'Away': {'Pncl': '1.68'}}}.get, 'x')[0][0]
heldA = [dict(at_row, id=1)]
pl10 = T.plan_snapshots(r10, heldA)
check('start10: a start - 10 snapshot never supersedes the api-tennis one for the same match (two sources, both kept)',
      len(pl10) == 1 and not pl10[0].get('supersedes'), pl10)
cur10 = T.current_snapshots(heldA + [dict(pl10[0], id=2)])
fr10 = T.approx_feed_rows(cur10)
check('start10: the feed carries both sources, each named, the start - 10 row with its cut and gap',
      sorted(r['source'] for r in fr10) == ['api-tennis Pinnacle', 'oddspapi Pinnacle (start − 10)']
      and [r for r in fr10 if r['source'].startswith('oddspapi')][0]['cutTs'] == '2026-05-20T11:50:00Z'
      and [r for r in fr10 if r['source'].startswith('api')][0]['cutTs'] == '' and list(fr10[0]) == T.APPROX_FEED_COLS, fr10)
check('start10: the hover is the ruled words', T.START10_HOVER == 'Pinnacle history, taken 10 minutes before the recorded start, not a confirmed close')

# founder ruling 2026-10-17 item 4: the archive name table joins "Struff J.L." / "O Connell C." on the player's key
al = {'2026-07-21': [{'event_key': 91, 'event_first_player': 'J-L. Struff', 'second_player_key': 1, 'event_second_player': 'A. Shevchenko',
                      'first_player_key': 2831},
                     {'event_key': 92, 'event_first_player': 'J. Duckworth', 'first_player_key': 5, 'event_second_player': "C. O'Connell", 'second_player_key': 421}]}
st = {'date': '2026-07-21', 'winner': 'Struff J.L.', 'loser': 'Shevchenko A.'}
oc = {'date': '2026-07-21', 'winner': 'Duckworth J.', 'loser': 'O Connell C.'}
check('alias: "Struff J.L." joins J-L. Struff on his key 2831', T.approx_join(st, al)[0]['event_key'] == 91, T.approx_join(st, al))
check('alias: "O Connell C." joins C. O\'Connell on his key 421', T.approx_join(oc, al)[0]['event_key'] == 92, T.approx_join(oc, al))
bad = {'2026-07-21': [dict(al['2026-07-21'][0], first_player_key=9999)]}
check('control: the same names with another key do not join (the surname rule alone misses them)', T.approx_join(st, bad) == (None, 'no fixture'), T.approx_join(st, bad))
check('control: the table only adds joins: a plain surname match still joins', T.P.same_player('Zverev A.', 'A. Zverev', None) and not T.P.same_player('Zverev A.', 'M. Zverev', None))
# ── the lower levels (founder ruling 2026-10-18 item 3) ──────────────────────────────────────────────────────────────
F = lambda ek, t, st='Finished', win='First Player', q='False', tn='M25 Somewhere', d='2026-05-20', rnd='1/16-finals': {
    'event_key': ek, 'event_type_type': t, 'event_status': st, 'event_winner': win, 'event_qualification': q, 'tournament_name': tn,
    'tournament_round': rnd, 'event_date': d, 'event_first_player': 'A. One', 'event_second_player': 'B. Two', 'first_player_key': 11, 'second_player_key': 22}
fxs = [F(1, 'Itf Men Singles'), F(2, 'Challenger Men Singles', win='Second Player'), F(3, 'Challenger Men Singles', q='True'),
       F(4, 'Atp Singles', q='True'), F(5, 'Atp Singles'), F(6, 'Itf Men Singles', st='Walk Over'), F(7, 'Itf Men Singles', win=None),
       F(8, 'Itf Women Singles'), F(9, 'Itf Men Singles', d='2099-01-01')]
tg, trep = T.lower_targets(fxs)
check('lower levels: ITF, Challenger, Challenger qualifying, ATP qualifying in; ATP main draw (Tennis-Data\'s), ITF Women, walkovers, no-result and after the window (yesterday) out',
      [r['_f']['event_key'] for r in tg] == [1, 2, 3, 4] and [r['_detail']['level'] for r in tg] == ['itf', 'ch', 'ch-q', 'atp-q']
      and trep.get('itf: walkover') == 1 and trep.get('itf: no result') == 1, (tg, trep))
check('lower levels: the winner and both keys follow event_winner (no name guess)', tg[1]['winner'] == 'B. Two' and tg[1]['_detail']['winnerKey'] == '22', tg[1])
odds = {1: {'Home': {'Pncl': '1.80'}, 'Away': {'Pncl': '2.05'}}, 2: {'Home': {'Pncl': '1.50'}, 'Away': {'Pncl': '2.60'}},
        3: {'Home': {'Pncl': '1.00'}, 'Away': {'Pncl': '9.0'}}, 4: {'Home': {'bet365': '1.5'}, 'Away': {'bet365': '2.5'}}}
ar, arep = T.approx_rows(tg, None, lambda ek: odds.get(ek), 'now', join=T._lower_join)
check('lower levels: api-tennis Pinnacle oriented to the winner; a side below 1.01 or no Pinnacle pair = no row (never bet365 in its place)',
      [(r['event_key'], r['price_winner'], r['price_loser']) for r in ar] == [(1, 1.8, 2.05), (2, 2.6, 1.5)] and arep.get('no Pinnacle pair on api-tennis') == 2
      and all(r['label'] == 'Pinnacle (approx.)' and r['detail']['level'] for r in ar), (ar, arep))
cur = [dict(r, id=i + 1) for i, r in enumerate(ar)] + [{'id': 9, 'source': T.START10_SOURCE, 'match_date': '2026-05-20', 'tournament': 'M25 Somewhere',
       'winner': 'A. One', 'loser': 'B. Two', 'event_key': 1, 'price_winner': 1.77, 'price_loser': 2.1, 'cut_ts': '2026-05-20T09:50:00Z', 'gap_to_start_s': 610,
       'detail': {'level': 'itf', 'winnerKey': '11', 'loserKey': '22'}}, {'id': 10, 'source': T.APPROX_SOURCE, 'match_date': '2026-05-20', 'tournament': 'X',
       'winner': 'W', 'loser': 'L', 'event_key': 99, 'price_winner': 1.5, 'price_loser': 2.5, 'detail': {}}]
lf = T.lower_feed_rows(cur)
check('lower feed: one source per match, start - 10 over api-tennis; Tennis-Data snapshots (no level) are never in it',
      [(r['eventKey'], r['source'], r['psw']) for r in lf] == [(1, T.START10_SOURCE, 1.77), (2, T.APPROX_SOURCE, 2.6)], lf)
check('lower feed: the columns build-database-yield.js reads', all(set(T.LOWER_FEED_COLS) <= set(r) for r in lf))
# ── founder brief 2026-10-19: events Tennis-Data does not cover ('atp-x') and api-tennis's Bet365 as the next tier ───────────
xf = [F(10, 'Atp Singles', tn='Davis Cup - World Group I', d='2024-09-14'), F(11, 'Atp Singles', tn='ATP Next Gen Finals - Jeddah', d='2024-12-18'),
      F(12, 'Atp Singles', tn='Finals - Turin', d='2024-11-12'), F(13, 'Atp Singles', tn='United Cup', q='True', d='2025-01-02'), F(14, 'Atp Singles', tn='ATP Shanghai', d='2025-10-05')]
xt, _ = T.lower_targets(xf)
check("atp-x: Davis Cup and the Next Gen Finals are in; the ATP Finals (Tennis-Data's), a tour event and a qualifying row keep their level",
      [(r['_f']['event_key'], r['_detail']['level']) for r in xt] == [(10, 'atp-x'), (11, 'atp-x'), (13, 'atp-q')], xt)
check("atp-x is tdarch's only: pinarch's lower_level (its lower closes) never reads a team event", T.P.lower_level(xf[0]) is None and T.lower_level(xf[0]) == 'atp-x')
check('the history window reaches back to 2021 (api-tennis keeps prices from 2022-23)', T.LOWER_FROM == '2021-01-01' and T.LOWER_TO == (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)).date().isoformat())
br, brep = T.approx_rows(tg, None, lambda ek: odds.get(ek), 'now', join=T._lower_join, book='bet365', source=T.B365_SOURCE, label=T.B365_LABEL, hover=T.B365_HOVER)
check('api-tennis Bet365: its own source and label, oriented to the winner, never a Pinnacle label or a close',
      [(r['event_key'], r['source'], r['label'], r['price_winner']) for r in br] == [(4, 'api-tennis Bet365', 'Bet365 (approx.)', 1.5)]
      and br[0]['detail']['apiTennisBook'] == 'bet365' and 'not a confirmed close' in br[0]['detail']['hover'], (br, brep))
cb = [dict(br[0], id=20), dict(br[0], id=21, event_key=2, source=T.B365_SOURCE, price_winner=2.4), dict(ar[1], id=22)]
lb = T.lower_feed_rows(cb)
check('lower feed: api-tennis Pinnacle over api-tennis Bet365 for one match; Bet365 alone where no Pinnacle source holds it',
      sorted((r['eventKey'], r['source']) for r in lb) == [(2, T.APPROX_SOURCE), (4, T.B365_SOURCE)], lb)
mut = T.lower_feed_rows([dict(r, source=T.APPROX_SOURCE if r['source'] == T.B365_SOURCE else T.B365_SOURCE) for r in cb])
check('control: with the sources swapped the Bet365 row wins match 2 (the rank decides, not the order)', any(r['eventKey'] == 2 and r['source'] == T.APPROX_SOURCE and r['psw'] == 2.4 for r in mut), mut)
# ── Tennis Explorer · Pinnacle (founder 2026-10-19, steps 0-3): a snapshot, never a close, behind TE_FEED_ON ─────────
SHA = 'b' * 64
TX = lambda ek, lvl='ch', pin={'p1': 1.36, 'p2': 2.9, 'p1Ts': '2026-09-28T09:18:00Z', 'p2Ts': None, 'open': {'p1': 1.38, 'p2': 2.9, 'p1Ts': '2026-09-27T05:48:00Z', 'p2Ts': None}, 'moves': [2, 0]}, st='joined', ka='11', kb='22': {
    'ek': str(ek), 'level': lvl, 'date': '2026-09-28', 'a': 'A. One', 'b': 'B. Two', 'ka': ka, 'kb': kb, 'status': st, 'teId': '3338923', 'tour': 'Porto challenger',
    'books': ['bet365', 'Pinnacle'], 'pageSha256': SHA, 'fetchedAt': '2026-10-20T03:00:00Z', 'pin': pin}
tdocs = [{'batch': 'calib-01', 'source': T.TE_SOURCE, 'complete': True, 'rows': [
    TX(31), TX(32, ka='22', kb='11'), TX(33, lvl='wta'), TX(34, st='ambiguous'), TX(35, pin=None), TX(36, pin={'p1': 1.005, 'p2': 9.0}),
    TX(37), TX(38)]}]
tfx = {'31': F(31, 'Challenger Men Singles', d='2026-09-28'), '32': F(32, 'Challenger Men Singles', win='Second Player', d='2026-09-28'),
       '37': F(37, 'Challenger Men Singles', st='Walk Over', d='2026-09-28'), '38': None}
te, terep = T.te_rows(tdocs, tfx.get, lambda ek: '2026-09-28T23:00:00Z')   # a verified start: no start of any kind is not stored (2026-10-26)
check('TE: a joined match with a Pinnacle pair is a "Tennis Explorer · Pinnacle" snapshot labelled "Pinnacle (approx.)", never a close',
      [(r['event_key'], r['source'], r['label']) for r in te] == [(31, T.TE_SOURCE, 'Pinnacle (approx.)'), (32, T.TE_SOURCE, 'Pinnacle (approx.)')], (te, terep))
check('TE: oriented to the winner — TE a / b = api-tennis first / second; a reversed target and a second-player win still read the right side',
      (te[0]['winner'], te[0]['price_winner'], te[0]['price_loser']) == ('A. One', 1.36, 2.9) and (te[1]['winner'], te[1]['price_winner'], te[1]['price_loser']) == ('B. Two', 1.36, 2.9), te)
check('TE: the later side change is price_ts, every side time and the opening price kept; page sha256 + TE id in detail, hover is the one fixed text',
      te[0]['price_ts'] == '2026-09-28T09:18:00Z' and te[0]['detail']['open']['first'] == 1.38 and te[0]['detail']['pageSha256'] == SHA
      and te[0]['detail']['teMatchId'] == '3338923' and te[0]['detail']['hover'] == 'Tennis Explorer, last pre-match price, not a confirmed close' and te[0]['fetched_at'] == '2026-10-20T03:00:00Z', te[0])
check('TE: a level outside TE_LEVELS refused, ambiguous / no Pinnacle / a side below 1.01 / a walkover / an unreadable fixture = no row, each counted',
      terep.get('level out of scope') == 1 and terep.get('ambiguous') == 1 and terep.get('joined, no Pinnacle on the page') == 1 and terep.get('a side below 1.01') == 1
      and terep.get('walkover') == 1 and terep.get('api-tennis fixture unreadable') == 1, terep)
tcur = [dict(r, id=40 + i) for i, r in enumerate(te)] + [dict(ar[1], id=50, event_key=31), dict(cur[2], id=51, event_key=32)]
orig = T.TE_FEED_ON
try:
    T.TE_FEED_ON = False
    off = T.lower_feed_rows(tcur)
    check('TE_FEED_ON off: the feed carries no TE row — match 31 stays on api-tennis Pinnacle (nothing a page shows changes)',
          sorted((r['eventKey'], r['source']) for r in off) == [(31, T.APPROX_SOURCE), (32, T.START10_SOURCE)], off)
    T.TE_FEED_ON = True
    tcur2 = tcur + [dict(te[0], id=60, event_key=33), dict(te[0], id=61, event_key=34), dict(ar[1], id=62, event_key=34, source=T.B365_SOURCE)]
    on = T.lower_feed_rows(tcur2)
    # founder 2026-10-20: start - 10 > api-tennis Pinnacle > Tennis Explorer Pinnacle > api-tennis Bet365
    check('TE_FEED_ON on (order of 2026-10-20): api-tennis Pinnacle over TE (31), start - 10 over TE (32), TE alone (33), TE over api-tennis Bet365 (34); no time in the feed',
          sorted((r['eventKey'], r['source']) for r in on) == [(31, T.APPROX_SOURCE), (32, T.START10_SOURCE), (33, T.TE_SOURCE), (34, T.TE_SOURCE)]
          and all('priceTs' not in r for r in on), on)
finally:
    T.TE_FEED_ON = orig
check('TE_FEED_ON is committed ON (founder 2026-10-20: the calibration passed)', T.TE_FEED_ON is True)
# the in-play rule (founder 2026-10-20): a TE price whose last change came after the start is dropped; the start is our
# verified start (the close's start in the batch row, else our live-flip), otherwise api-tennis's scheduled start (UTC)
PIN = lambda ts: {'p1': 1.5, 'p2': 2.6, 'p1Ts': ts, 'p2Ts': None, 'open': {}, 'moves': [1, 0]}
idocs = [{'batch': 'atp-q-01', 'complete': True, 'rows': [
    dict(TX(71, pin=PIN('2026-09-28T10:05:00Z')), close={'startTs': '2026-09-28T10:00:00Z'}),        # after our close's start -> dropped
    dict(TX(72, pin=PIN('2026-09-28T09:55:00Z')), close={'startTs': '2026-09-28T10:00:00Z'}),        # before it -> kept
    TX(73, pin=PIN('2026-09-28T10:05:00Z')),                                                          # after our live-flip -> dropped
    TX(74, pin=PIN('2024-03-01T12:31:00Z')),                                                          # after the scheduled 12:30 -> dropped
    TX(75, pin=PIN('2024-03-01T12:29:00Z')),                                                          # before it -> kept
    TX(76, pin=PIN('2024-03-01T12:31:00Z')),                                                          # no start of any kind -> not stored, counted (2026-10-26)
    TX(77, pin=PIN(None))]}]                                                                         # no change recorded -> kept
G = lambda ek, d, tm=None: dict(F(ek, 'Challenger Men Singles', d=d), **({'event_time': tm} if tm else {}))
ifx = {'71': G(71, '2026-09-28'), '72': G(72, '2026-09-28'), '73': G(73, '2026-09-28', '11:00'), '74': G(74, '2024-03-01', '12:30'),
       '75': G(75, '2024-03-01', '12:30'), '76': G(76, '2024-03-01'), '77': G(77, '2024-03-01', '12:30')}
irows, irep = T.te_rows(idocs, ifx.get, {'73': '2026-09-28T10:00:00Z'}.get)
check('in-play rule: dropped after our close start (71), after our live-flip although the schedule says 11:00 (73), after the scheduled start (74); kept before them (72, 75) and with no change (77); no start of any kind is not stored (76, counted; founder 2026-10-26)',
      sorted(r['event_key'] for r in irows) == [72, 75, 77] and irep.get('dropped: last change after the start') == 3
      and irep.get('dropped in batch atp-q-01') == 3 and irep.get('not stored: no start of any kind') == 1
      and irep.get('dropped: last change after the start (scheduled)') == 1 and irep.get('dropped: last change after the start (verified (live-flip))') == 1, irep)
check('in-play rule: each kept row names the start it was checked against',
      [(r['event_key'], r['detail']['startKind']) for r in sorted(irows, key=lambda r: r['event_key'])]
      == [(72, 'verified (our close)'), (75, 'scheduled'), (77, 'scheduled')], irows)
nrows, _ = T.te_rows(idocs, ifx.get)
# founder 2026-11-09 ("Yes, accept them"): with only the scheduled time to check against, a later start on TE's own match page
# (the saved page the batch read, by sha256) is the check for the lower levels; a verified start still decides
pdocs = [{'batch': 'gap-x', 'complete': True, 'rows': [
    dict(TX(91, pin=PIN('2024-03-01T12:40:00Z')), teId='9001', pageSha256='a' * 64),    # after scheduled 12:30, before TE 12:50 -> kept
    dict(TX(92, pin=PIN('2024-03-01T12:55:00Z')), teId='9002', pageSha256='a' * 64),    # after TE's 12:50 too -> dropped
    dict(TX(93, pin=PIN('2024-03-01T12:40:00Z')), teId='9003', pageSha256='b' * 64),    # TE's page is another copy -> dropped
    dict(TX(94, pin=PIN('2024-03-01T12:40:00Z')), teId='9004', pageSha256='a' * 64),    # TE lists an EARLIER start -> dropped (scheduled)
    dict(TX(95, pin=PIN('2026-09-28T10:05:00Z')), teId='9005', pageSha256='a' * 64, close={'startTs': '2026-09-28T10:00:00Z'})]}]  # verified decides
pfx = {str(k): G(k, '2024-03-01', '12:30') for k in (91, 92, 93, 94)} | {'95': G(95, '2026-09-28', '09:00')}
PST = {'9001': {'start': '2024-03-01T12:50:00Z', 'pageSha256': 'a' * 64}, '9002': {'start': '2024-03-01T12:50:00Z', 'pageSha256': 'a' * 64},
       '9003': {'start': '2024-03-01T12:50:00Z', 'pageSha256': 'a' * 64}, '9004': {'start': '2024-03-01T12:00:00Z', 'pageSha256': 'a' * 64},
       '9005': {'start': '2026-09-28T11:00:00Z', 'pageSha256': 'a' * 64}}
prows, prep = T.te_rows(pdocs, pfx.get, page_start=T.te_page_start_of(PST))
check('TE page start (2026-11-09): kept when the last change is before TE\'s later start (91); dropped after it (92), on another page copy (93), when TE lists an earlier start (94), and when a verified start says in play (95)',
      [(r['event_key'], r['detail']['startKind'], r['detail']['startChecked']) for r in prows] == [(91, T.TE_PAGE_START_KIND, '2024-03-01T12:50:00Z')]
      and prep.get('dropped: last change after the start') == 4, (prows, prep))
check('TE page start: the read-time rule feeds the kept row (its startChecked is TE\'s start)', not T.te_in_play(dict(prows[0], id=1)) if prows else False)
p0, _ = T.te_rows(pdocs, pfx.get)
check('control: without the TE start times, 91 is dropped against the scheduled 12:30 (the rule before the ruling)', 91 not in [r['event_key'] for r in p0])
# founder 2026-11-01 (Task A, "TE never-tried"): 'atp-nt' — an ATP main-draw match with an api-tennis fixture and no
# Tennis-Data row — is a TE level: keyed on the event key, oriented by the players' api-tennis keys like every level here
ndocs = [{'batch': 'atp-nt-01', 'complete': True, 'rows': [TX(81, lvl='atp-nt', ka='22', kb='11', pin=PIN('2026-10-27T09:55:00Z'))]}]
nfx = {'81': G(81, '2026-10-27', '10:00') | {'event_type_type': 'Atp Singles', 'tournament_name': 'ATP Basel'}}
ntrows, ntrep = T.te_rows(ndocs, nfx.get)
check('atp-nt: stored as its own level, the TE a / b turned to the fixture by key (TE a = key 22 = the second player, the loser)',
      [(r['event_key'], r['detail']['level'], r['winner'], r['price_winner'], r['price_loser']) for r in ntrows] == [(81, 'atp-nt', 'A. One', 2.6, 1.5)], (ntrows, ntrep))
check('atp-nt: rides the lower feed (the era shard), never the ATP main-draw snapshots the Database reads',
      [x['level'] for x in T.lower_feed_rows([dict(r, id=1) for r in ntrows])] == ['atp-nt'] and T.main_snapshots([dict(r, id=1) for r in ntrows]) == [])
check('control: without the live-flip start, 73 is checked against its schedule (11:00) and kept — the verified start decides',
      73 in [r['event_key'] for r in nrows])
# founder 2026-10-20 (item 5 revised): kept and counted per batch — no TE time, a change in the start's own minute, no start;
# the over-1pp share of the no-time group where the row carries our verified close
crows, crep = T.te_rows([{'batch': 'calib-x', 'complete': True, 'rows': [
    dict(TX(81, pin=PIN(None)), close={'startTs': '2026-09-28T10:00:00Z', 'p1': 1.50, 'p2': 2.60}),             # no time, gap 0
    dict(TX(82, pin=PIN(None)), close={'startTs': '2026-09-28T10:00:00Z', 'p1': 1.30, 'p2': 3.50}),             # no time, gap > 1pp
    dict(TX(83, pin=PIN('2026-09-28T10:00:00Z')), close={'startTs': '2026-09-28T10:00:30Z', 'p1': 1.50, 'p2': 2.60}),   # start's minute
    dict(TX(84, pin=PIN('2026-09-28T09:58:00Z')), close={'startTs': '2026-09-28T10:00:30Z', 'p1': 1.50, 'p2': 2.60})]}],  # before it
    {str(k): G(k, '2026-09-28') for k in (81, 82, 83, 84)}.get)
check('item 5 revised: no-time and start-minute rows are KEPT and counted per batch, with the no-time over-1pp share',
      sorted(r['event_key'] for r in crows) == [81, 82, 83, 84] and crep.get('batch calib-x: kept, no TE timestamp') == 2
      and crep.get("batch calib-x: kept, in the start's own minute") == 1 and crep.get('batch calib-x: no TE timestamp, with our close') == 2
      and crep.get('batch calib-x: no TE timestamp, over 1pp vs our close') == 1 and crep.get('batch calib-x: with a TE timestamp, with our close') == 2, crep)
# the in-play rule at read time: a stored row whose price_ts is after its startChecked is never fed (even if an import let it in)
rin = dict(te[0], id=90, event_key=91, price_ts='2026-09-28T10:05:00Z', detail=dict(te[0]['detail'], startChecked='2026-09-28T10:00:00Z'))
rok = dict(te[0], id=91, event_key=92, price_ts=None, detail=dict(te[0]['detail'], startChecked='2026-09-28T10:00:00Z'))
fed = {r['eventKey'] for r in T.lower_feed_rows([rin, rok])}
check('read time: an in-play TE row (price_ts after startChecked) is not fed; a row with no time is', fed == {92}, fed)
_tip = T.te_in_play
try:
    T.te_in_play = lambda r: False
    check('control: without the read-time rule the in-play row is fed', {r['eventKey'] for r in T.lower_feed_rows([rin, rok])} == {91, 92})
finally:
    T.te_in_play = _tip
# paging by id: a select that names no id still pages past 1,000 rows (te-import's closes read failed on the 1,001st row)
P = T.P; _rest = P.rest
try:
    pages = []
    def fake_rest(method, path, body=None, headers=None, **k):
        import re as _re
        sel = _re.search(r'select=([^&]+)', path).group(1); last = int(_re.search(r'id=gt\.(\d+)', path).group(1)); pages.append(sel)
        ids = [i for i in range(1, 2501) if i > last][:1000]
        return 200, [dict({'id': i} if 'id' in sel.split(',') else {}, event_key=i) for i in ids], {}
    P.rest = fake_rest
    got = P.select_all(P.CLOSE, 'event_key')
    check('select_all pages past 1,000 rows when the select names no id (id added); 2,500 rows read', len(got) == 2500 and all(p.startswith('id,') for p in pages), (len(got), pages[:2]))
    got2 = list(P.select_pages(P.CLOSE, 'event_key'))
    check('select_pages too', sum(len(g) for g in got2) == 2500)
finally:
    P.rest = _rest
# coverage gained: TE prices a match only where no close, start - 10 or api-tennis Pinnacle holds it
crow = lambda ek, y, lv='ch': {'event_key': ek, 'match_date': f'{y}-05-01', 'detail': {'level': lv}}
cov = T.te_coverage([crow(1, 2024), crow(2, 2024), crow(3, 2024), crow(4, 2023, 'atp-q'), crow(5, 2024)],
                    [{'event_key': 2, 'source': T.APPROX_SOURCE, 'supersedes': None}, {'event_key': 3, 'source': T.B365_SOURCE, 'supersedes': None},
                     {'event_key': 5, 'source': T.TE_SOURCE, 'supersedes': None}], {'4'})
check('coverage: newly priced (1, 5), over api-tennis Bet365 (3); none where api-tennis Pinnacle (2) or our close (4) holds it',
      cov == {'teWins': {'ch': {'2024': 3}}, 'newlyPriced': {'ch': {'2024': 2}}, 'overB365': {'ch': {'2024': 1}}}, cov)
cl = T.te_coverage_lines({'teWins': {'atp-x': {'2021': 82, '2024': 161}}, 'newlyPriced': {'atp-x': {'2021': 82, '2024': 161}}, 'overB365': {}})
check('coverage lines: a level with no api-tennis Bet365 to replace reads 0 there, never a KeyError (te-import 22 Oct, atp-x)',
      cl == ['te-import coverage atp-x: 2021 82 priced by TE (82 with no snapshot before, 0 replacing an api-tennis Bet365 snapshot) · '
             '2024 161 priced by TE (161 with no snapshot before, 0 replacing an api-tennis Bet365 snapshot)'], cl)
td = tempfile.mkdtemp(); os.makedirs(os.path.join(td, 'te-odds'))
json.dump(tdocs[0], open(os.path.join(td, 'te-odds', 'calib-01.json'), 'w'))
json.dump(dict(tdocs[0], batch='ch-01', complete=False), open(os.path.join(td, 'te-odds', 'ch-01.json'), 'w'))
dd, sk = T.te_docs(td)
check('TE import reads COMPLETE batch files only; a partial batch is skipped and named', [d['batch'] for d in dd] == ['calib-01'] and sk == ['ch-01'], (dd, sk))
shutil.rmtree(td)
# the scheduled import's batch line (founder brief 2026-10-23 items 3 + 5): per batch, rows stored, in-play dropped, no-timestamp
# kept with its share, coverage gained; a share over 25% is flagged
brow = lambda ek, y, b, lv='ch': {'event_key': ek, 'match_date': f'{y}-05-01', 'detail': {'level': lv, 'batch': b}}
brows = [brow(1, 2021, 'ch-02'), brow(2, 2021, 'ch-02'), brow(3, 2022, 'ch-02'), brow(4, 2022, 'ch-02', 'ch-q'), brow(5, 2021, 'ch-01')]
brep = {'dropped in batch ch-02': 1, 'batch ch-02: kept, no TE timestamp': 1, 'batch ch-01: kept, no TE timestamp': 1}
bl = T.te_batch_lines(['ch-02'], brows, brows[:4], brep, [{'event_key': 3, 'source': T.APPROX_SOURCE, 'supersedes': None}], {'2'})
check('batch line: stored, in-play dropped, no-timestamp share, coverage gained per level and year (only this batch, the order rule)',
      bl == ['TE batch ch-02: 4 rows stored, 1 dropped as in-play, 1 of 4 kept with no TE timestamp (25%); coverage gained ch 2021 +1; ch-q 2022 +1'], bl)
bl2 = T.te_batch_lines(['ch-01'], brows, brows[4:], brep, [], set())
check('batch line: a no-timestamp share over 25% is flagged', bl2[0].endswith('FLAG: no-timestamp share 100% is over 25%'), bl2)
check('batch line: a batch with nothing new reads 0 of 0, never a ZeroDivisionError', T.te_batch_lines(['x'], [], [], {}, [], set())
      == ['TE batch x: 0 rows stored, 0 dropped as in-play, 0 of 0 kept with no TE timestamp (0%); coverage gained none'])
# te-import-new: nothing new -> no import, an empty lines file; a new batch -> the import runs once and its line is written
td = tempfile.mkdtemp(); os.makedirs(os.path.join(td, 'te-odds'))
json.dump(dict(tdocs[0], batch='calib-01'), open(os.path.join(td, 'te-odds', 'calib-01.json'), 'w'))
json.dump(dict(tdocs[0], batch='ch-02'), open(os.path.join(td, 'te-odds', 'ch-02.json'), 'w'))
# the import report counts rows per level; an atp-md row has no detail.level (31 Oct: KeyError after the insert)
_lc = T.te_level_counts([{'detail': {'level': 'ch'}}, {'detail': {}}, {'detail': {'level': 'atp-q'}}, {'detail': {'level': 'ch'}}])
check('te-import report: an atp-md row (no detail.level) counts under the atp-md level, never a KeyError', dict(_lc) == {'ch': 2, T.TE_MD_LEVEL: 1, 'atp-q': 1})

_imp, _run, calls = T.te_imported_batches, T.te_import_run, []
try:
    T.te_import_run = lambda store, dry_run=False, only=None: calls.append((store, only)) or {'rows': brows, 'add': brows[:4], 'rep': brep, 'held': [], 'closed': set()}
    T.te_imported_batches = lambda: {'calib-01', 'ch-02'}
    out = os.path.join(td, 'lines.txt')
    check('te-import-new: every store batch already held -> no import and an empty lines file',
          T.cmd_te_import_new(td, out) == [] and calls == [] and open(out).read() == '', calls)
    json.dump(dict(tdocs[0], batch='atp-x-02', rows=[dict(x, pin=None) for x in tdocs[0]['rows']]), open(os.path.join(td, 'te-odds', 'atp-x-02.json'), 'w'))
    check('te-import-new: a batch with no joined Pinnacle pair is never new (atp-x-02, 23 Oct: it was re-sent every run)',
          T.cmd_te_import_new(td, out) == [] and calls == [], calls)
    T.te_imported_batches = lambda: {'calib-01'}
    got = T.cmd_te_import_new(td, out)
    check('te-import-new: a batch the archive holds no row of -> one import, its line in the file (control: the held batch has none)',
          len(calls) == 1 and len(got) == 1 and got[0].startswith('TE batch ch-02:') and open(out).read() == got[0] + '\n', (calls, got))
    check('te-import-new (founder 2026-11-11): a new batch is read ALONE, never every batch (the job outgrew 45 min re-reading all)',
          calls[-1][1] == {'ch-02'}, calls)
    _st, _ist = T.te_page_starts, T.te_imported_starts
    try:
        T.te_page_starts = lambda store: ({}, 'f' * 64); T.te_imported_starts = lambda: set()
        calls.clear(); T.cmd_te_import_new(td, out)
        check('te-import-new: a start-times file not read yet re-reads EVERY batch (only=None)', calls == [(td, None)], calls)
    finally:
        T.te_page_starts, T.te_imported_starts = _st, _ist
finally:
    T.te_imported_batches, T.te_import_run = _imp, _run
shutil.rmtree(td)
# founder 2026-11-11: the batches an import read are recorded in its count row (teBatchesRead), so a batch whose every row is
# refused is not "new" on every run; the start-times sha is recorded only when every batch was read
_sa = T.P.select_all
try:
    def _sel(table, cols, flt=''):
        if table == T.SNAPCOUNT: return [{'detail': {'teBatchesRead': ['gap-06', 'other-gap-06']}}, {'detail': {'guardOk': True}}]
        return [{'detail': {'batch': 'ch-02'}}, {'detail': {}}]
    T.P.select_all = _sel
    check('imported batches = batches holding a row + batches an import read (a batch that stored nothing is not new again)',
          T.te_imported_batches() == {'ch-02', 'gap-06', 'other-gap-06'}, T.te_imported_batches())
    T.P.select_all = lambda table, cols, flt='': [{'detail': {'batch': 'ch-02'}}]
    check('control: without the count rows the never-storing batch is new again', 'gap-06' not in T.te_imported_batches())
finally:
    T.P.select_all = _sa
td = tempfile.mkdtemp(); os.makedirs(os.path.join(td, 'te-odds'))
json.dump(dict(tdocs[0], batch='calib-01'), open(os.path.join(td, 'te-odds', 'calib-01.json'), 'w'))
json.dump(dict(tdocs[0], batch='ch-02'), open(os.path.join(td, 'te-odds', 'ch-02.json'), 'w'))
_keep = {n: getattr(T, n) for n in ('te_md_joiner', 'te_flip_starts', 'te_rows', 'plan_snapshots', 'te_coverage', 'te_coverage_lines', 'cmd_snapshot_counts', 'te_page_starts')}
_kp = {n: getattr(T.P, n) for n in ('apitennis_fixture_fetcher', 'select_all', 'insert')}
recorded, seen = [], []
try:
    os.environ.setdefault('API_TENNIS_KEY', 'test')
    T.P.apitennis_fixture_fetcher = lambda k: (lambda eks: {})
    T.te_md_joiner = lambda md: (lambda td_: (None, ''), [])
    T.te_flip_starts = lambda eks: {}
    T.te_rows = lambda docs, *a, **k: seen.append([d['batch'] for d in docs]) or ([], {})
    T.P.select_all = lambda *a, **k: []
    T.plan_snapshots = lambda rows, held: []
    T.te_coverage = lambda *a: {'teWins': {}}
    T.te_coverage_lines = lambda g: []
    T.cmd_snapshot_counts = lambda job, extra=None: recorded.append(extra)
    T.te_page_starts = lambda store: ({}, 'a' * 64)
    T.te_import_run(td, only={'ch-02'})
    check('te_import_run(only=...) reads only those batches and records them; no start-times sha on a partial read',
          seen[-1] == ['ch-02'] and recorded[-1] == {'teBatchesRead': ['ch-02']}, (seen, recorded))
    T.te_import_run(td)
    check('te_import_run (full) reads every batch and records them with the start-times sha',
          seen[-1] == ['calib-01', 'ch-02'] and recorded[-1] == {'teBatchesRead': ['calib-01', 'ch-02'], 'teStartsSha256': 'a' * 64}, (seen, recorded))
finally:
    for n, v in _keep.items(): setattr(T, n, v)
    for n, v in _kp.items(): setattr(T.P, n, v)
shutil.rmtree(td)
# The single qualifying rule in the price import (founder 2026-10-30): an unflagged ATP word round before either player's first
# "1/N-finals" round of the edition is ATP qualifying ('atp-q', a lower-level target); a main-draw run, a Davis Cup tie and a
# flagged fixture keep their level. Mirrors h2h-core qualifyingByMainDraw (tools/test-qualifying-rule.js runs the JS twin).
def _qf(ek, date, rnd, a, b, flag='False', name='ATP Washington', tk='2100', season='2021'):
    return {'event_key': ek, 'event_date': date, 'tournament_round': f'{name} - {rnd}', 'tournament_name': name, 'tournament_key': tk,
            'tournament_season': season, 'event_type_type': 'Atp Singles', 'event_qualification': flag,
            'first_player_key': a, 'second_player_key': b}
qfx = [_qf(1, '2021-07-31', 'Semi-finals', '359', '700'), _qf(2, '2021-08-01', 'Final', '359', '701'),     # Ofner's qualifying SF / F
       _qf(3, '2021-08-03', '1/32-finals', '359', '702'),                                                   # ...then his main-draw R64 (LL)
       _qf(4, '2021-08-02', '1/32-finals', '800', '801'), _qf(5, '2021-08-06', 'Quarter-finals', '800', '803'),  # a main-draw run
       _qf(6, '2021-08-03', '1/16-finals', '803', '804'),
       _qf(7, '2021-09-18', 'Semi-finals', '900', '901', name='ATP Davis Cup - World Group I', tk='2300'),
       _qf(8, '2021-07-30', 'Final', '360', '361', flag='True')]
n_ruled = T.mark_rule_qualifying(qfx)
lv = {f['event_key']: T.lower_level(f) for f in qfx}
check('qualifying rule: the unflagged qualifying SF / F are atp-q (lower-level targets); 2 marked', n_ruled == 2 and lv[1] == 'atp-q' and lv[2] == 'atp-q', (n_ruled, lv))
check('qualifying rule controls: the LL main-draw R64 and a main-draw QF after R64 stay ATP main draw (Tennis-Data); Davis Cup keeps atp-x; the flag still decides',
      lv[3] is None and lv[4] is None and lv[5] is None and lv[7] == 'atp-x' and lv[8] == 'atp-q', lv)
_mr = T.mark_rule_qualifying
check('qualifying rule wired: _lower_fixtures marks the rule before filtering to lower levels',
      'ruled = mark_rule_qualifying(fx)' in open(os.path.join(os.path.dirname(__file__), 'tdarch.py')).read())

# ── TE on the ATP main draw (founder 2026-10-30, "TE above Bet365"): level atp-md, keyed by the Tennis-Data row ──────
MDTD = lambda w='One A.', l='Two B.': {'date': '2025-03-10', 'tournament': 'BNP Paribas Open', 'winner': w, 'loser': l}
MD = lambda n, pin, group='B', a='One A.', b='Two B.', td=None: {'ek': f'md:{n}', 'level': T.TE_MD_LEVEL, 'group': group, 'date': '2025-03-10',
    'round': '2nd Round', 'a': a, 'b': b, 'ka': None, 'kb': None, 'td': td or MDTD(a, b), 'status': 'joined', 'teId': str(9000 + n),
    'tour': 'Indian Wells', 'books': ['Pinnacle'], 'pageSha256': SHA, 'fetchedAt': '2026-10-31T03:00:00Z', 'pin': pin}
MDF = lambda ek, win='First Player', tm='18:00': dict(F(ek, 'Atp Singles', win=win, d='2025-03-10'), event_time=tm, event_first_player='A. One', event_second_player='B. Two')
mjoin = {('One A.', 'Two B.'): (MDF(501), True), ('Rev R.', 'Two B.'): (MDF(502, win='Second Player'), False),
         ('Late L.', 'Two B.'): (MDF(503), True), ('Bad W.', 'Two B.'): (MDF(504, win='Second Player'), True)}
mdocs = [{'batch': 'atp-md-id', 'complete': True, 'rows': [
    MD(1, {'p1': 1.6, 'p2': 2.4, 'p1Ts': '2025-03-10T17:00:00Z', 'p2Ts': None, 'open': {'p1': 1.7}, 'moves': [1, 0]}),
    MD(2, {'p1': 2.2, 'p2': 1.7, 'p1Ts': None, 'p2Ts': None, 'open': {}, 'moves': [0, 0]}, group='od10', a='Rev R.'),
    MD(3, {'p1': 1.5, 'p2': 2.6, 'p1Ts': '2025-03-10T18:05:00Z', 'p2Ts': None, 'open': {}, 'moves': [1, 0]}, a='Late L.'),
    MD(4, {'p1': 1.5, 'p2': 2.6, 'p1Ts': None, 'p2Ts': None, 'open': {}, 'moves': [0, 0]}, a='None N.'),
    MD(5, {'p1': 1.5, 'p2': 2.6, 'p1Ts': None, 'p2Ts': None, 'open': {}, 'moves': [0, 0]}, a='Bad W.'),
    MD(6, {'p1': 1.5, 'p2': 2.6, 'p1Ts': None, 'p2Ts': None, 'open': {}, 'moves': [0, 0]}, a='One A.', td=MDTD('Two B.', 'One A.'))]}]
mrows, mrep = T.te_rows(mdocs, lambda ek: None, lambda ek: None, lambda td: mjoin.get((td['winner'], td['loser']), (None, 'no fixture')))
m1 = next((r for r in mrows if r['detail']['teMatchId'] == '9001'), None)
check('atp-md: stored under the Tennis-Data key (date, tournament, winner, loser), prices oriented to the Tennis-Data winner, event key from its ONE fixture, NO level (the main-draw feed)',
      m1 is not None and (m1['match_date'], m1['tournament'], m1['winner'], m1['loser'], m1['price_winner'], m1['price_loser'], m1['event_key'])
      == ('2025-03-10', 'BNP Paribas Open', 'One A.', 'Two B.', 1.6, 2.4, 501) and 'level' not in m1['detail'] and m1['detail']['group'] == 'B'
      and m1['source'] == T.TE_SOURCE and m1['label'] == 'Pinnacle (approx.)' and m1['detail']['startKind'] == 'scheduled', (mrows, mrep))
m2 = next((r for r in mrows if r['detail']['teMatchId'] == '9002'), None)
check('atp-md: a fixture whose first player is the loser still reads the winner\'s price (a / b are the Tennis-Data winner / loser)',
      m2 is not None and (m2['winner'], m2['price_winner'], m2['price_loser']) == ('Rev R.', 2.2, 1.7), m2)
check('atp-md: the in-play rule applies — a last change after the scheduled start is dropped (3); no fixture = no start = not stored (4); a fixture naming the other winner (5) and a / b that are not the Tennis-Data winner / loser (6) are refused, each counted',
      sorted(r['detail']['teMatchId'] for r in mrows) == ['9001', '9002'] and mrep.get('dropped: last change after the start') == 1
      and mrep.get('atp-md: not stored, no api-tennis fixture (no fixture) — no start') == 1 and mrep.get('atp-md: the fixture names the other winner') == 1
      and mrep.get('atp-md: a / b are not the Tennis-Data winner / loser') == 1 and mrep.get('atp-md stored: B') == 1 and mrep.get('atp-md stored: od10') == 1, mrep)
# the batches as te-odds-batch.mjs really wrote them on 30 Oct: no td / group / round, the Tennis-Data match only in the key
RAW = lambda n, a, b: {k: v for k, v in dict(MD(n, {'p1': 1.6, 'p2': 2.4, 'p1Ts': None, 'p2Ts': None, 'open': {}, 'moves': [0, 0]}, a=a, b=b),
                                                ek=f'md:2025-03-10|BNP Paribas Open|{a}|{b}').items() if k not in ('td', 'group', 'round')}
rdocs = [{'batch': 'atp-md-id', 'complete': True, 'rows': [RAW(11, 'One A.', 'Two B.'), dict(RAW(12, 'One A.', 'Two B.'), ek='md:2025-03-10|BNP Paribas Open|One A.')]}]
rrows, rrep = T.te_rows(rdocs, lambda ek: None, lambda ek: None, lambda td: mjoin.get((td['winner'], td['loser']), (None, 'no fixture')))
check('atp-md: a batch row with no td field reads its Tennis-Data match from its key (md:date|tournament|winner|loser); a key not of that shape is "no Tennis-Data key", never guessed',
      [(r['match_date'], r['tournament'], r['winner'], r['loser'], r['event_key']) for r in rrows] == [('2025-03-10', 'BNP Paribas Open', 'One A.', 'Two B.', 501)]
      and rrep.get('atp-md: no Tennis-Data key') == 1 and T.md_td({'td': {'date': 'x'}}) == {'date': 'x'}, (rrows, rrep))
_mdj = []
_bd = T._at
T._at = lambda q: (_mdj.append(q['date_start']), {'success': 1, 'result': []})[1]
try:
    T.te_md_joiner([RAW(13, 'One A.', 'Two B.'), dict(RAW(14, 'X', 'Y'), ek='bogus')])
finally:
    T._at = _bd
check('atp-md: the fixture-list days come from the key too (no KeyError on a batch row without td); a bad key reads no day',
      sorted(_mdj) == ['2025-03-09', '2025-03-10', '2025-03-11', '2025-03-12'], _mdj)
nm, nrep = T.te_rows(mdocs, lambda ek: None)
check('control: with no fixture list read, no atp-md row is stored (never a start invented)', nm == [] and nrep.get('atp-md: not stored, no api-tennis fixture (no fixture list read) — no start') == 5, nrep)
mcur = [dict(m1, id=700), dict(m2, id=701, price_ts='2025-03-10T19:00:00Z', detail=dict(m2['detail'], startChecked='2025-03-10T18:00:00Z')),
        dict(te[0], id=702), dict(r0, id=703)]
ms = T.main_snapshots(mcur)
check('main-draw feed: an atp-md TE row is fed, an in-play one is not, a lower-level row never is; api-tennis rows unchanged',
      sorted(r['id'] for r in ms) == [700, 703], [r['id'] for r in ms])
orig = T.TE_FEED_ON
try:
    T.TE_FEED_ON = False
    check('main-draw feed: TE_FEED_ON off feeds no TE row', sorted(r['id'] for r in T.main_snapshots(mcur)) == [703])
finally:
    T.TE_FEED_ON = orig
check('main-draw feed: approx_feed_rows hands TE to the Database under its source, keyed by the Tennis-Data row',
      [(r['source'], r['winner'], r['psw']) for r in T.approx_feed_rows([dict(m1, id=700)])] == [(T.TE_SOURCE, 'One A.', 1.6)])
cv = T.te_coverage([m1], [], set())
check('coverage: an atp-md row counts under its own level (no KeyError on a row with no level)', cv['teWins'] == {'atp-md': {'2025': 1}}, cv)
# ── Tennis Explorer · Bet365 (founder 2026-10-30, "last before dash"): read from saved pages, join-only ──────────────────
B3 = lambda ek, ts=None, lvl='ch', ka='11', kb='22': dict(TX(ek, lvl=lvl, pin=None, ka=ka, kb=kb), books=['bet365'],
    b365={'p1': 1.8, 'p2': 2.0, 'p1Ts': ts, 'p2Ts': None, 'open': {'p1': 1.9, 'p2': 1.9}, 'moves': [1 if ts else 0, 0]})
bdocs = [{'batch': 'b365-ch-01', 'source': T.TE_B365_SOURCE, 'complete': True, 'rows': [B3(81), B3(82, ts='2026-09-28T23:30:00Z'), B3(83, lvl='wta'), dict(B3(84), b365=None)]}]
bfx = {str(k): F(k, 'Challenger Men Singles', d='2026-09-28') for k in (81, 82, 83, 84)}
brows, brep = T.te_rows(bdocs, bfx.get, lambda ek: '2026-09-28T23:00:00Z')
check('TE Bet365: a "Tennis Explorer · Bet365" row labelled "Bet365 (approx.)", its own hover, read from the b365 field (never pin)',
      [(r['event_key'], r['source'], r['label'], r['detail']['hover']) for r in brows] == [(81, T.TE_B365_SOURCE, 'Bet365 (approx.)', T.TE_B365_HOVER)]
      and T.TE_B365_HOVER == 'Bet365 (approx.) · Tennis Explorer, last pre-match price, not a confirmed close' and brows[0]['price_winner'] == 1.8, (brows, brep))
check('TE Bet365: the in-play rule runs where the page shows a change time (82 dropped), a level outside TE_LEVELS refused (83), no Bet365 pair (84) counted',
      brep.get('dropped: last change after the start') == 1 and brep.get('level out of scope') == 1 and brep.get('joined, no Bet365 on the page') == 1
      and brep.get('batch b365-ch-01: kept, no TE timestamp') == 1, brep)
check('TE Bet365: te_docs accepts both TE sources; a doc of another source still stops the import', T.te_doc_kind(bdocs[0])[2] == 'b365' and T.te_doc_kind(tdocs[0])[2] == 'pin')
bcur = [dict(brows[0], id=900, event_key=31), dict(ar[1], id=901, event_key=31, source=T.B365_SOURCE),
        dict(brows[0], id=902, event_key=95), dict(te[0], id=903, event_key=96), dict(brows[0], id=904, event_key=96)]
bf = T.lower_feed_rows(bcur)
check('lower feed (2026-10-30): api-tennis Bet365 over TE Bet365 (31), TE Bet365 alone (95), TE Pinnacle over TE Bet365 (96) — last before the dash',
      sorted((r['eventKey'], r['source']) for r in bf) == [(31, T.B365_SOURCE), (95, T.TE_B365_SOURCE), (96, T.TE_SOURCE)], bf)
mut = T.lower_feed_rows([dict(r, source=T.TE_B365_SOURCE if r.get('source') == T.B365_SOURCE else r['source']) for r in bcur[:2]])
check('control: two TE Bet365 rows on one match keep one (no duplicate)', len(mut) == 1, mut)
bmd = [{'batch': 'b365-atp-md-id', 'source': T.TE_B365_SOURCE, 'complete': True, 'rows': [
    dict(MD(1, None), pin=None, b365={'p1': 1.6, 'p2': 2.4, 'p1Ts': None, 'p2Ts': None, 'open': {}, 'moves': [0, 0]})]}]
bm, bmrep = T.te_rows(bmd, lambda ek: None, lambda ek: None, lambda td: mjoin.get((td['winner'], td['loser']), (None, 'no fixture')))
check('atp-md TE Bet365 (founder 2026-10-30: "the Database must show the same price"): no level — the main-draw feed into the Database, never the lower feed; Tennis-Data names kept',
      len(bm) == 1 and 'level' not in bm[0]['detail'] and bm[0]['source'] == T.TE_B365_SOURCE and bm[0]['label'] == 'Bet365 (approx.)'
      and [r['id'] for r in T.main_snapshots([dict(bm[0], id=910)])] == [910] and T.lower_feed_rows([dict(bm[0], id=910)]) == []
      and [(r['source'], r['winner'], r['psw']) for r in T.approx_feed_rows([dict(bm[0], id=910)])] == [(T.TE_B365_SOURCE, 'One A.', 1.6)], (bm, bmrep))

# ── Pre-2021 on screen (founder 2026-10-31): a TE price with no api-tennis fixture, checked against TE's own page start ──
SHA = 'a' * 64
def PX(tid, a='Bergs Z.', b='Herbert P.', ka='1064', kb='1748', lv='pre-ch', date='2016-10-15', p1=2.5, p2=1.55, t1=None, t2=None):
    return {'ek': f'te:{tid}', 'level': lv, 'date': date, 'a': a, 'b': b, 'ka': ka, 'kb': kb, 'teId': str(tid), 'tour': 'Antwerp',
            'pageSha256': SHA, 'fetchedAt': '2026-10-28T18:22:00Z', 'status': 'joined',
            'pin': {'p1': p1, 'p2': p2, 'p1Ts': t1, 'p2Ts': t2, 'open': {'p1': p1, 'p2': p2}, 'moves': [0, 0]}}
pdocs = [{'batch': 'pre21-01', 'source': T.TE_SOURCE, 'complete': True, 'rows': [
    PX(1),                                                     # Bergs lost (te-history won 0) -> Herbert the winner at 1.55
    PX(2, t1='2016-10-15T15:01:00Z'),                           # last change after the 15:00Z start -> dropped
    PX(3),                                                     # no start on the page -> not stored
    PX(4),                                                     # walkover -> not stored
    PX(5),                                                     # the two histories disagree -> not stored
    PX(6, lv='pre-atp'),                                        # ATP main draw: out of scope, never stored
    PX(7, lv='pre-atp-q', kb=None),                             # a qualifying win, one side with no api-tennis key
    PX(8),                                                     # already priced in the archive -> not stored
    PX(9),                                                     # a retirement
    PX(10, p2=1.0),                                            # a side below 1.01
]}]
pst = {str(i): {'start': '2016-10-15T15:00:00Z', 'stamp': '15.10.2016 17:00', 'pageSha256': SHA} for i in (1, 2, 4, 5, 6, 7, 8, 9, 10)}
H = lambda won, wo=0, ret=0, rnd='R16': {'won': won, 'wo': wo, 'ret': ret, 'round': rnd}
phist = {'1': [('1064', H(0)), ('1748', H(1))], '2': [('1064', H(0))], '3': [('1064', H(0))], '4': [('1064', H(1, wo=1))],
         '5': [('1064', H(1)), ('1748', H(1))], '6': [('1064', H(1))], '7': [('1064', H(1, rnd='Q-R16'))], '8': [('1064', H(1))],
         '9': [('1748', H(0, ret=1))], '10': [('1064', H(1))]}
prows, prep = T.te_pre21_rows(pdocs, pst, phist, lambda ka, kb, d: {ka, kb} == {'1064', '1748'} and d == '2016-10-15' and False)
by = {r['detail']['teMatchId']: r for r in prows}
check('pre-2021: the winner comes from te-history (Bergs lost: Herbert wins at 1.55, Bergs 2.50), keyed by the negative TE match ID',
      by.get('1', {}).get('winner') == 'Herbert P.' and by['1']['price_winner'] == 1.55 and by['1']['price_loser'] == 2.5
      and by['1']['event_key'] == -1 and by['1']['detail']['winnerKey'] == '1748' and by['1']['detail']['level'] == 'ch'
      and by['1']['detail']['startKind'] == T.PRE21_START_KIND and by['1']['detail']['startChecked'] == '2016-10-15T15:00:00Z', prows)
check('pre-2021: a price whose last change came after the TE page start is dropped (the in-play rule)', '2' not in by and prep.get('dropped: last change after the start') == 1, prep)
check('pre-2021: no start on the TE page = not stored, counted', '3' not in by and prep.get('not stored: no start on the TE page') == 1, prep)
check('pre-2021: a walkover is never stored', '4' not in by and prep.get('walkover') == 1, prep)
check("pre-2021: two te-history rows that disagree on the result = not stored", '5' not in by and prep.get("the two players' te-history rows disagree on the result") == 1, prep)
check('pre-2021: ATP main draw is out of scope (founder: "Don\'t touch ATP main draw")', '6' not in by and prep.get('level out of scope') == 1, prep)
# founder 2026-11-01 (team events: "just in terms of pricing for market edge etc."): a team event by TE match ID is stored as
# atp-x (the team flag t downstream), from a team-NN batch read with the pre21 ones
xrows, xrep = T.te_pre21_rows([{'batch': 'team-01', 'source': T.TE_SOURCE, 'complete': True, 'rows': [PX(11, lv='pre-atp-x')]}],
                              {'11': pst['1']}, {'11': [('1064', H(1)), ('1748', H(0))]})
check('team events: pre-atp-x is stored as atp-x, keyed by the negative TE match ID', [(r['event_key'], r['detail']['level']) for r in xrows] == [(-11, 'atp-x')], (xrows, xrep))
# founder 2026-11-11 (Michael via the Pinnacle-close session: "any bookmaker … they don't come into the ROI database, just to have
# a price"): an ATP main-draw match the site showed unpriced, by TE match ID (pre21-md-NN) -> atp-mdj, the Database build's
# join-only flag j; the TE page start and the te-history result as every pre-2021 row; 'pre-atp' (no -md) stays out of scope
mrows, mrep = T.te_pre21_rows([{'batch': 'pre21-md-01', 'source': T.TE_SOURCE, 'complete': True, 'rows': [PX(12, lv='pre-atp-md', kb=None), PX(13, lv='pre-atp-md', kb=None)]}],
                              {'12': pst['1']}, {'12': [('1064', H(1))], '13': [('1064', H(1))]})
check('ATP main draw (pre21-md): pre-atp-md is stored as atp-mdj, keyed by the negative TE match ID, the result from te-history',
      [(r['event_key'], r['detail']['level'], r['winner'], r['price_winner']) for r in mrows] == [(-12, 'atp-mdj', 'Bergs Z.', 2.5)], (mrows, mrep))
check('ATP main draw (pre21-md): no start on the TE page = not stored (the in-play rule as every pre-2021 row)', mrep.get('not stored: no start on the TE page') == 1, mrep)
check('ATP main draw (pre21-md): the lower feed carries it as atp-mdj (the Database build keeps it join-only)',
      [r['level'] for r in T.lower_feed_rows([dict(mrows[0], id=990)])] == ['atp-mdj'], mrows)
with tempfile.TemporaryDirectory() as td:
    os.makedirs(os.path.join(td, T.PRE21_DIR))
    for n in ('pre21-01', 'team-01'):
        json.dump({'batch': n, 'source': T.TE_SOURCE, 'complete': True, 'rows': []}, open(os.path.join(td, T.PRE21_DIR, n + '.json'), 'w'))
    tdocs2 = T.te_pre21_docs(td)
    names = sorted(d.get('batch') for d in (tdocs2[0] if isinstance(tdocs2, tuple) else tdocs2))
check('team events: the team-NN batch files are read beside the pre21 ones', names == ['pre21-01', 'team-01'], names)
check('pre-2021: ATP qualifying stored as atp-q, an absent key stays empty', by.get('7', {}).get('detail', {}).get('level') == 'atp-q' and by['7']['detail']['loserKey'] == '', prows)
check('pre-2021: a retirement is stored with status Retired (the lower feed settles it on Pinnacle rules)', by.get('9', {}).get('detail', {}).get('status') == 'Retired', prows)
check('pre-2021: a side below 1.01 is never stored', '10' not in by and prep.get('a side below 1.01') == 1, prep)
_, prep2 = T.te_pre21_rows(pdocs, pst, phist, lambda ka, kb, d: str(ka) in ('1064',) and d == '2016-10-15')
check('pre-2021: a match the archive already prices is never stored over (any row that already holds a price)', prep2.get('already priced in the archive', 0) >= 1, prep2)
_, prep3 = T.te_pre21_rows(pdocs, {k: dict(v, pageSha256='b' * 64) for k, v in pst.items()}, phist)
check('control: a start read from a different page (sha256 differs) is no start — nothing stored', prep3.get('stored', 0) == 0 and prep3.get('not stored: no start on the TE page') == 6, prep3)
pf = T.lower_feed_rows([dict(r, id=1000 + i) for i, r in enumerate(prows)])
check('pre-2021: the lower feed carries them unchanged (level, both keys, negative event key, the TE source)',
      sorted((r['eventKey'], r['level'], r['source']) for r in pf) == sorted((r['event_key'], r['detail']['level'], T.TE_SOURCE) for r in prows) and len(pf) == len(prows), pf)
# 11 Nov (run 43121730549: statement timeout 57014): the import reads the snapshot table ONCE, unfiltered in id order; a
# match_date filter on an id-ordered page scans the whole table per page. The pre-2021 lookup is cut from that one read.
_ks = {n: getattr(T, n) for n in ('te_pre21_docs', 'te_pre21_history', 'te_pre21_rows', 'plan_snapshots', 'te_pre21_priced_index')}
_ksa, _calls, _seen = T.P.select_all, [], {}
try:
    T.te_pre21_docs = lambda s: ([{'batch': 'pre21-01'}], {})
    T.te_pre21_history = lambda s: {}
    T.te_pre21_rows = lambda d, st, h, priced: ([], {})
    T.plan_snapshots = lambda rows, held: []
    T.te_pre21_priced_index = lambda lower: _seen.setdefault('lower', lower)
    T.P.select_all = lambda table, cols, filt='', page=1000: _calls.append((cols, filt)) or [
        {'id': 1, 'match_date': '2016-10-16', 'wk': '1064', 'lk': '1748'}, {'id': 2, 'match_date': '2024-05-01', 'wk': '1', 'lk': '2'}]
    with contextlib.redirect_stdout(io.StringIO()):
        T.cmd_te_pre21_import('unused', True)
finally:
    for n, f in _ks.items(): setattr(T, n, f)
    T.P.select_all = _ksa
check('pre-2021 import: one unfiltered read of the snapshot table (no match_date filter: it timed out, 57014), the pre-2021 lookup cut from it',
      len(_calls) == 1 and _calls[0][1] == '' and 'wk:detail->>winnerKey' in _calls[0][0]
      and [r['id'] for r in _seen.get('lower', [])] == [1], (_calls, _seen))
pix = T.te_pre21_priced_index([{'wk': '1064', 'lk': '1748', 'match_date': '2016-10-16'}])
check('pre-2021: the already-priced lookup is the same two keys +-1 day, either order', pix('1748', '1064', '2016-10-15') and not pix('1748', '1064', '2016-10-13') and not pix('1064', '', '2016-10-16'))
check('names: a hyphenated initial is dotted as Tennis-Data writes it (Struff J.L., Herbert P.H.); plain initials unchanged',
      P.td_name('J-L. Struff') == 'Struff J.L.' and P.td_name('P-H. Herbert') == 'Herbert P.H.'
      and P.td_name('J. M. Cerundolo') == 'Cerundolo J.M.' and P.td_name('A. Zverev') == 'Zverev A.', [P.td_name('J-L. Struff'), P.td_name('P-H. Herbert')])
# founder 2026-11-03 (ITF: "sample first, then run" — the 30-match sample: 30 joined, 21 Pinnacle): ITF is a TE level now;
# no verified start exists for it, so the in-play rule reads api-tennis's scheduled start
idocs = [{'batch': 'itf-s01', 'source': T.TE_SOURCE, 'complete': True, 'rows': [TX(91, lvl='itf'), TX(92, lvl='itf')]}]
ifx = {'91': F(91, 'Itf Men Singles', d='2026-09-28'), '92': dict(F(92, 'Itf Men Singles', d='2026-09-28'), event_time='12:00')}
irows, irep = T.te_rows(idocs, ifx.get)
check('ITF: a Tennis Explorer ITF price is stored at level itf (a snapshot, never a close); one with no start of any kind is not',
      'itf' in T.TE_LEVELS and [(r['event_key'], r['detail']['level'], r['label']) for r in irows] == [(92, 'itf', 'Pinnacle (approx.)')]
      and irep.get('not stored: no start of any kind') == 1, (irows, irep))
# ── founder 2026-11-03: another book, margin removed (one book of a fixed order, only where Pinnacle and Bet365 are missing) ──
OT = lambda ek, book='Betway', p=(1.8, 2.25), lvl='ch', ts=None: dict(TX(ek, lvl=lvl, pin=None, ka='11', kb='22'), books=[book],
    oth={'book': book, 'p1': p[0], 'p2': p[1], 'margin': 0.05, 'raw': {'p1': 1.72, 'p2': 2.1}, 'p1Ts': ts, 'p2Ts': None, 'open': {}, 'moves': [0, 0]})
odocs = [{'batch': 'other-ch-01', 'source': T.TE_OTHER_SOURCE, 'complete': True,
          'rows': [OT(71), OT(72, book='Betfair'), OT(73, p=(1.8, 2.0)), OT(74, ts='2026-09-28T23:30:00Z'), dict(OT(75), level='atp-md')]}]
ofx = {str(k): F(k, 'Challenger Men Singles', d='2026-09-28') for k in (71, 72, 73, 74, 75)}
orows, orep = T.te_rows(odocs, ofx.get, lambda ek: '2026-09-28T23:00:00Z')
ob = {r['event_key']: r for r in orows}
check('other book: a "Tennis Explorer · other book" row, its own label and hover, the book and its raw pair kept in detail',
      sorted(ob) == [71] and ob[71]['source'] == T.TE_OTHER_SOURCE and ob[71]['label'] == 'Other book (approx., margin removed)'
      and ob[71]['detail']['book'] == 'Betway' and ob[71]['detail']['hover'] == T.TE_OTHER_HOVER and ob[71]['detail']['raw'] == {'first': 1.72, 'second': 2.1}, (orows, orep))
check('other book: a book outside the order (72), a pair that does not sum to 100% (73), the in-play rule (74), an atp-md row (75: a Database row = ROI) are never stored',
      orep.get('other book: not a book of the order, or the sides do not sum to 100%') == 2 and orep.get('dropped: last change after the start') == 1
      and orep.get('atp-md: other book not stored (a Database row: ROI)') == 1, orep)
check('other book: te_doc_kind reads the oth field', T.te_doc_kind(odocs[0])[2] == 'oth' and T.TE_OTHER_SOURCE in T.TE_SOURCES)
ocur = [dict(ob[71], id=950, event_key=41), dict(brows[0], id=951, event_key=41), dict(ob[71], id=952, event_key=42), dict(ob[71], id=953, event_key=43),
        dict(ob[71], id=954, event_key=43, source=T.SCHED_SOURCE)]
of = T.lower_feed_rows(ocur)
check('other book: last of all in the lower feed (TE Bet365 keeps 41, before start keeps 43); alone it fills the dash (42), named in the source column',
      sorted((r['eventKey'], r['source']) for r in of) == [(41, T.TE_B365_SOURCE), (42, T.TE_OTHER_SOURCE + ' · Betway'), (43, T.SCHED_SOURCE)], of)
oxrows, oxrep = T.te_pre21_rows([{'batch': 'other-team-01', 'source': T.TE_OTHER_SOURCE, 'complete': True,
                                 'rows': [dict(PX(12, lv='pre-atp-x'), pin=None, books=['Interwetten'], oth={'book': 'Interwetten', 'p1': 1.6, 'p2': 2.67, 'raw': {'p1': 1.55, 'p2': 2.5}})]}],
                                {'12': pst['1']}, {'12': [('1064', H(1)), ('1748', H(0))]})
check('other book: a team / pre-2021 other-book batch is stored like its Pinnacle batch (atp-x, negative TE ID), the book and raw pair oriented to the winner',
      [(r['event_key'], r['source'], r['detail']['level'], r['detail']['book'], r['detail']['raw']) for r in oxrows]
      == [(-12, T.TE_OTHER_SOURCE, 'atp-x', 'Interwetten', {'winner': 1.55, 'loser': 2.5})], (oxrows, oxrep))
with tempfile.TemporaryDirectory() as td:
    os.makedirs(os.path.join(td, T.PRE21_DIR))
    for n, src in (('team-01', T.TE_SOURCE), ('b365-team-01', T.TE_B365_SOURCE), ('other-team-01', T.TE_OTHER_SOURCE), ('other-pre21-01', T.TE_OTHER_SOURCE)):
        json.dump({'batch': n, 'source': src, 'complete': True, 'rows': []}, open(os.path.join(td, T.PRE21_DIR, n + '.json'), 'w'))
    od2 = T.te_pre21_docs(td)
    onames = sorted(d.get('batch') for d in (od2[0] if isinstance(od2, tuple) else od2))
check('other book + Bet365: the b365-* and other-* batches are read beside the team / pre21 ones', onames == ['b365-team-01', 'other-pre21-01', 'other-team-01', 'team-01'], onames)
# ── founder 2026-11-01 (Task B): Pinnacle (approx.) before the start, where no start is verified ──────────────────────
SF = lambda ek, t, tm='12:00', d='2026-10-27', **k: dict(F(ek, t, d=d, **k), event_time=tm, event_key=ek)
sfx = [SF(901, 'Atp Singles'), SF(902, 'Challenger Men Singles', tm='11:58'), SF(903, 'Atp Singles', st='Walk Over'),
       SF(904, 'Itf Men Singles'), SF(905, 'Atp Singles', d='2026-09-10'), dict(SF(906, 'Challenger Men Singles'), event_time=None)]
sod = {'901': ('F901', True), '902': ('F902', True), '903': ('F903', True), '904': ('F904', True), '905': ('F905', True), '906': ('F906', True)}
SFX = {'F901': {'trueStartTime': '2026-10-27T11:50:00Z', 'trueEndTime': '2026-10-27T13:20:00Z', 'startTime': '2026-10-27T12:00:00Z'}}
SSER = {'121': [e('2026-10-27T11:40:00Z', 2.10), e('2026-10-27T11:49:00Z', 2.20), e('2026-10-27T11:55:00Z', 2.30), e('2026-10-27T12:05:00Z', 3.00)],
        '122': [e('2026-10-27T11:40:00Z', 1.75), e('2026-10-27T11:48:00Z', 1.70), e('2026-10-27T11:56:00Z', 1.65), e('2026-10-27T12:05:00Z', 1.40)]}
flive = {'901': P.iso_ms('2026-10-27T11:52:00Z')}
srows, srep = T.sched_rows(sfx, lambda f: sod[str(f['event_key'])], SFX, lambda fid: (88, SSER), flive.get, '2026-11-01T12:00:00+00:00')
sb = {r['event_key']: r for r in srows}
check('before start: an ATP main-draw match (no Tennis-Data row) is cut at the EARLIEST time held — the gated trueStart 11:50, before our first sighting 11:52 and the 12:00 schedule',
      sb.get(901, {}).get('start_source') == 'oddspapi trueStart' and sb[901]['cut_ts'] == '2026-10-27T11:50:00Z' and sb[901]['price_winner'] == 2.2
      and sb[901]['price_loser'] == 1.7 and sb[901]['detail']['level'] == 'atp-nt' and sb[901]['source'] == T.SCHED_SOURCE and sb[901]['label'] == 'Pinnacle (approx.)', srows)
check('before start: a Challenger match with only a schedule is cut at it (11:58), never on an entry after the cut',
      sb.get(902, {}).get('start_source') == 'scheduled start' and sb[902]['price_winner'] == 2.3 and sb[902]['price_loser'] == 1.65
      and sb[902]['price_ts'] <= sb[902]['cut_ts'] and sb[902]['cut_ts'] == sb[902]['start_ts'], srows)
check('before start: a walkover, an ITF match, a match before 17 Sep and a match with no time of any kind are never stored',
      sorted(sb) == [901, 902] and srep.get('atp-nt: walkover') == 1 and srep.get('ch: no start of any kind') == 1 and not any('no pre-start pair' in k for k in srep), srep)
check('before start: the cut is the earliest of the three; with none there is no cut',
      T.sched_cut(None, None, None) == (None, None) and T.sched_cut(P.iso_ms('2026-10-27T12:00:00Z'), None, P.iso_ms('2026-10-27T11:59:00Z'))[1] == 'first live sighting')
_ap = lambda src, p: {'id': 1, 'source': src, 'match_date': '2026-10-27', 'tournament': 'X', 'winner': 'A. One', 'loser': 'B. Two', 'event_key': 902,
                      'price_winner': p, 'price_loser': 2.0, 'detail': {'level': 'ch'}, 'cut_ts': None, 'gap_to_start_s': None}
lf = T.lower_feed_rows([_ap(T.APPROX_SOURCE, 1.5), _ap(T.SCHED_SOURCE, 1.6)])
check('before start: on a match both price after 16 Sep, the before-start price (stored first) keeps it — api-tennis there only fills a dash (2026-11-03)', [x['source'] for x in lf] == [T.SCHED_SOURCE], lf)
_ap16 = lambda src, p: dict(_ap(src, p), match_date='2026-09-10')
lfo = T.lower_feed_rows([_ap16(T.APPROX_SOURCE, 1.5), _ap16(T.TE_SOURCE, 1.55)])
check('up to 16 Sep the order is unchanged: api-tennis Pinnacle over Tennis Explorer', [x['source'] for x in lfo] == [T.APPROX_SOURCE], lfo)
lfl = T.lower_feed_rows([_ap(T.APPROX_SOURCE, 1.5), _ap(T.TE_SOURCE, 1.55)])
lfb = T.lower_feed_rows([_ap(T.B365_SOURCE, 1.52), _ap(T.TE_B365_SOURCE, 1.53)])
check('after 16 Sep (2026-11-03, "find all the possible odds"): api-tennis never displaces another source (Tennis Explorer Pinnacle / Bet365 keep the match) and fills a dash alone',
      [x['source'] for x in lfl] == [T.TE_SOURCE] and [x['source'] for x in lfb] == [T.TE_B365_SOURCE]
      and [x['source'] for x in T.lower_feed_rows([_ap(T.APPROX_SOURCE, 1.5)])] == [T.APPROX_SOURCE], (lfl, lfb))
lf3 = T.lower_feed_rows([_ap(T.TE_B365_SOURCE, 1.62), _ap(T.SCHED_SOURCE, 1.6)])
check('before start: even Tennis Explorer Bet365 keeps its match; alone, the before-start price fills the dash', [x['source'] for x in lf3] == [T.TE_B365_SOURCE] and [x['source'] for x in T.lower_feed_rows([_ap(T.SCHED_SOURCE, 1.6)])] == [T.SCHED_SOURCE], lf3)
lf2 = T.lower_feed_rows([_ap(T.START10_SOURCE, 1.55), _ap(T.SCHED_SOURCE, 1.6)])
check('before start: start − 10 still ranks above it', [x['source'] for x in lf2] == [T.START10_SOURCE], lf2)
# the fetch the importer uses keeps the ATP main-draw matches (the first build dropped every one: atp-nt never reached it)
_at0 = T._at
T._at = lambda q: {'success': 1, 'result': [SF(911, 'Atp Singles'), SF(912, 'Challenger Men Singles'), SF(913, 'Wta Singles')]} if q['method'] == 'get_fixtures' else {'result': {}}
try:
    fk_main, _, _ = T._lower_fixtures('2026-10-27', '2026-10-27', keep_main=True)
    fk_low, _, _ = T._lower_fixtures('2026-10-27', '2026-10-27')
finally:
    T._at = _at0
check('before start: the importer fetch keeps the ATP main-draw match (atp-nt); the lower-level fetch still drops it; WTA never',
      sorted(f['event_key'] for f in fk_main) == [911, 912] and [f['event_key'] for f in fk_low] == [912], (fk_main, fk_low))
import inspect
check('before start: cmd_sched_import asks for the main-draw fixtures', 'keep_main=True' in inspect.getsource(T.cmd_sched_import))
# founder 2026-11-03 ("find all the possible odds"): api-tennis's other book, margin removed, where it holds no Pinnacle / Bet365
atg = [dict(t) for t in tg[:2]]
aod = {1: {'Home': {'1xbet': '1.80', 'Marathon': '1.75', 'Betfair': '1.9'}, 'Away': {'1xbet': '2.00', 'Marathon': '2.10'}},
       2: {'Home': {'Betfair': '1.50'}, 'Away': {'Betfair': '2.70'}}}
aor, aorep = T.api_other_rows(atg, lambda ek: aod.get(ek), 'now', join=T._lower_join)
a1 = {r['event_key']: r for r in aor}
check('api-tennis other book: the first of the order with both sides (1xBet, alias "1xbet"), margin removed, oriented to the winner; its own source and the other-book label',
      a1[1]['detail']['book'] == '1xBet' and (a1[1]['price_winner'], a1[1]['price_loser']) == T.devig(1.8, 2.0)[:2]
      and a1[1]['source'] == T.API_OTHER_SOURCE and a1[1]['label'] == T.TE_OTHER_LABEL and a1[1]['detail']['hover'] == T.API_OTHER_HOVER
      and a1[2]['detail']['book'] == 'Betfair' and (a1[2]['price_winner'], a1[2]['price_loser']) == T.devig(2.7, 1.5)[:2], (aor, aorep))
check('api-tennis other book: no book of the order with both sides = no row, counted', T.api_other_rows([atg[0]], lambda ek: {'Home': {'X': '1.5'}, 'Away': {'X': '2.5'}}, 'now', join=T._lower_join)[1].get('no other book with a pair on api-tennis') == 1)
_apo = lambda src, book: dict(_ap(src, 1.6), detail={'level': 'ch', 'book': book})
lfx = T.lower_feed_rows([_apo(T.API_OTHER_SOURCE, '1xBet'), _apo(T.TE_OTHER_SOURCE, 'Betway')])
check('api-tennis other book: after Tennis Explorer\'s other book; alone it fills the dash, named in the source column',
      [x['source'] for x in lfx] == [T.TE_OTHER_SOURCE + ' · Betway'] and [x['source'] for x in T.lower_feed_rows([_apo(T.API_OTHER_SOURCE, '1xBet')])] == [T.API_OTHER_SOURCE + ' · 1xBet'], lfx)
# self-heal (founder 2026-11-06): the scheduled import maps an unmapped recent match and pulls a missing payload itself
_today = dt.date(2026, 11, 6)
def _hf(ek, d, st='Finished', w='First Player', typ='Atp Singles'):
    return {'event_key': ek, 'event_date': d, 'event_status': st, 'event_winner': w, 'event_type_type': typ, 'event_qualification': 'False',
            'tournament_name': 'Paris', 'event_first_player': f'A{ek}', 'event_second_player': f'B{ek}'}
_hw = [_hf(1, '2026-11-04'), _hf(2, '2026-11-03'), _hf(3, '2026-11-04'), _hf(4, '2026-11-04', st='Walk Over'),
       _hf(5, '2026-11-06'), _hf(6, '2026-10-30'), _hf(7, '2026-11-04', st='Not Started', w=None), _hf(8, '2026-11-05'), _hf(9, '2026-11-05')]
_hod = {1: (None, 'no Oddspapi fixture held'), 2: ('F2', True), 3: ('F3', True), 4: (None, 'no Oddspapi fixture held'),
        5: (None, 'no Oddspapi fixture held'), 6: (None, 'no Oddspapi fixture held'), 7: (None, 'no Oddspapi fixture held'),
        8: (None, 'two or more Oddspapi fixtures'), 9: ('F3', True)}
_hser = {'F2': (None, 'no pinnacle+30 payload held'), 'F3': (77, {'121': [], '122': []})}
hu, hn = T.sched_heal_targets(_hw, lambda f: _hod[f['event_key']], lambda fid: _hser[fid], _today)
check('self-heal: an unmapped played match of the last 4 days or today is mapped (1, 5); a mapped one with no payload is pulled once (F2); a walkover, an unplayed match and older than 4 days are not targets; two candidates are not guessed',
      [f['event_key'] for f in hu] == [1, 5] and hn == ['F2'], (hu, hn))
hl = T.heal_reason_lines(_hw, lambda f: _hod[f['event_key']], lambda fid: _hser[fid], _today)
check('self-heal: the public notice names every recent played ATP main-draw match still without a source, with why — never one that has a payload',
      hl == ['Paris 2026-11-04 A1 v B1: no Oddspapi fixture held', 'Paris 2026-11-03 A2 v B2: no pinnacle+30 payload held',
             'Paris 2026-11-06 A5 v B5: no Oddspapi fixture held', 'Paris 2026-11-05 A8 v B8: two or more Oddspapi fixtures'], hl)
_hser2 = {'F2': (55, {'121': [], '122': []}), 'F3': (77, {'121': [], '122': []})}
check('self-heal: once the payload is held the match is no longer a target (control: before the pull it was)',
      T.sched_heal_targets(_hw, lambda f: _hod[f['event_key']], lambda fid: _hser2[fid], _today)[1] == [] and hn == ['F2'])
_hsrc = open(os.path.join(HERE, 'tdarch.py')).read()
check('self-heal: the pulled payload is stored insert-only as a back-fill row (so later runs hold the fixture) and the workflow passes the Oddspapi key',
      "'trigger': 'backfill', 'via': 'sched-heal'" in _hsrc and 'P.insert(P.RAW' in _hsrc
      and 'ODDSPAPI_KEY: ${{ secrets.ODDSPAPI_KEY }}' in open(os.path.join(HERE, '..', '.github', 'workflows', 'te-import-scheduled.yml')).read())

# founder 2026-11-11: a before-start failure never skips the Tennis Explorer batch import, and the run still goes red
_ts_wf = open(os.path.join(HERE, '..', '.github', 'workflows', 'te-import-scheduled.yml')).read()
_i_s, _i_t, _i_f = _ts_wf.find('id: sched'), _ts_wf.find('te-import-new .te-store'), _ts_wf.find("if: steps.sched.outcome == 'failure'")
check('scheduled import: the before-start step continues on error, the batch import runs after it, then the job fails red',
      'id: sched\n        continue-on-error: true' in _ts_wf and 0 < _i_s < _i_t < _i_f < _ts_wf.find('if: failure()'))

# founder 2026-11-06 ("price it about 30-45 minutes after the match"): today's finished matches are targets, and the
# 15-minute run skips a match that already holds a before-start snapshot
_fh = [{'event_key': 1, 'source': T.SCHED_SOURCE}, {'event_key': 2, 'source': 'api-tennis Pinnacle'}]
check('fast run: a match holding a before-start snapshot is skipped; one holding only another source is still a target',
      [f['event_key'] for f in T.fresh_targets([_hf(1, '2026-11-06'), _hf(2, '2026-11-06'), _hf(3, '2026-11-06')], _fh)] == [2, 3])
_hsrc2 = open(os.path.join(HERE, 'tdarch.py')).read()
_pm = open(os.path.join(HERE, '..', '.github', 'workflows', 'oddspapi-postmatch.yml')).read()
check('fast run: the window ends today (never yesterday) and oddspapi-postmatch.yml runs the 15-minute import with the shared archive lock',
      "to = to or dt.datetime.now(dt.timezone.utc).date().isoformat()" in _hsrc2 and 'timedelta(days=1)).date().isoformat()\n    fx, _od' not in _hsrc2
      and 'tools/tdarch.py sched-import --recent 3 --fresh' in _pm and 'group: historical-archive' in _pm)
check('fast run: the lower levels too (Challenger, qualifying, ITF) — every 15 minutes, today included, no unpriced list written by it',
      'tools/tdarch.py lower-import --recent 1 --fresh' in _pm and '--unpriced' not in _pm.split('lower-import --recent')[1].split('\n')[0]
      and "_lt = _now.isoformat() if '--recent' in a" in _hsrc2 and 'targets = [r for r in targets if str(r[\'_f\'][\'event_key\']) not in have]' in _hsrc2)

print(f'\ntest-tdarch: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
