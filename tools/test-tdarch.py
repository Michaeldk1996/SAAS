#!/usr/bin/env python3
"""The historical odds archive (founder brief 2026-10-16, items 1-4), on pure functions and temp dirs — no network.
Each check has a control (the mutation it must catch)."""
import collections, csv, gzip, io, json, os, shutil, subprocess, sys, tempfile, importlib.util
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
       F(8, 'Itf Women Singles'), F(9, 'Itf Men Singles', d='2026-09-20')]
tg, trep = T.lower_targets(fxs)
check('lower levels: ITF, Challenger, Challenger qualifying, ATP qualifying in; ATP main draw (Tennis-Data\'s), ITF Women, walkovers, no-result and after 16 Sep out',
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
check('the history window reaches back to 2021 (api-tennis keeps prices from 2022-23)', T.LOWER_FROM == '2021-01-01' and T.LOWER_TO == '2026-09-16')
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
    TX(31), TX(32, ka='22', kb='11'), TX(33, lvl='itf'), TX(34, st='ambiguous'), TX(35, pin=None), TX(36, pin={'p1': 1.005, 'p2': 9.0}),
    TX(37), TX(38)]}]
tfx = {'31': F(31, 'Challenger Men Singles', d='2026-09-28'), '32': F(32, 'Challenger Men Singles', win='Second Player', d='2026-09-28'),
       '37': F(37, 'Challenger Men Singles', st='Walk Over', d='2026-09-28'), '38': None}
te, terep = T.te_rows(tdocs, tfx.get)
check('TE: a joined match with a Pinnacle pair is a "Tennis Explorer · Pinnacle" snapshot labelled "Pinnacle (approx.)", never a close',
      [(r['event_key'], r['source'], r['label']) for r in te] == [(31, T.TE_SOURCE, 'Pinnacle (approx.)'), (32, T.TE_SOURCE, 'Pinnacle (approx.)')], (te, terep))
check('TE: oriented to the winner — TE a / b = api-tennis first / second; a reversed target and a second-player win still read the right side',
      (te[0]['winner'], te[0]['price_winner'], te[0]['price_loser']) == ('A. One', 1.36, 2.9) and (te[1]['winner'], te[1]['price_winner'], te[1]['price_loser']) == ('B. Two', 1.36, 2.9), te)
check('TE: the later side change is price_ts, every side time and the opening price kept; page sha256 + TE id in detail, hover is the one fixed text',
      te[0]['price_ts'] == '2026-09-28T09:18:00Z' and te[0]['detail']['open']['first'] == 1.38 and te[0]['detail']['pageSha256'] == SHA
      and te[0]['detail']['teMatchId'] == '3338923' and te[0]['detail']['hover'] == 'Tennis Explorer, last pre-match price, not a confirmed close' and te[0]['fetched_at'] == '2026-10-20T03:00:00Z', te[0])
check('TE: ITF refused, ambiguous / no Pinnacle / a side below 1.01 / a walkover / an unreadable fixture = no row, each counted',
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
    TX(76, pin=PIN('2024-03-01T12:31:00Z')),                                                          # no time on the fixture -> kept, counted
    TX(77, pin=PIN(None))]}]                                                                         # no change recorded -> kept
G = lambda ek, d, tm=None: dict(F(ek, 'Challenger Men Singles', d=d), **({'event_time': tm} if tm else {}))
ifx = {'71': G(71, '2026-09-28'), '72': G(72, '2026-09-28'), '73': G(73, '2026-09-28', '11:00'), '74': G(74, '2024-03-01', '12:30'),
       '75': G(75, '2024-03-01', '12:30'), '76': G(76, '2024-03-01'), '77': G(77, '2024-03-01', '12:30')}
irows, irep = T.te_rows(idocs, ifx.get, {'73': '2026-09-28T10:00:00Z'}.get)
check('in-play rule: dropped after our close start (71), after our live-flip although the schedule says 11:00 (73), after the scheduled start (74); kept before them (72, 75), with no change (77), and with no start time (76, counted)',
      sorted(r['event_key'] for r in irows) == [72, 75, 76, 77] and irep.get('dropped: last change after the start') == 3
      and irep.get('dropped in batch atp-q-01') == 3 and irep.get('no start time to check (kept)') == 1
      and irep.get('dropped: last change after the start (scheduled)') == 1 and irep.get('dropped: last change after the start (verified (live-flip))') == 1, irep)
check('in-play rule: each kept row names the start it was checked against',
      [(r['event_key'], r['detail']['startKind']) for r in sorted(irows, key=lambda r: r['event_key'])]
      == [(72, 'verified (our close)'), (75, 'scheduled'), (76, None), (77, 'scheduled')], irows)
nrows, _ = T.te_rows(idocs, ifx.get)
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
td = tempfile.mkdtemp(); os.makedirs(os.path.join(td, 'te-odds'))
json.dump(tdocs[0], open(os.path.join(td, 'te-odds', 'calib-01.json'), 'w'))
json.dump(dict(tdocs[0], batch='ch-01', complete=False), open(os.path.join(td, 'te-odds', 'ch-01.json'), 'w'))
dd, sk = T.te_docs(td)
check('TE import reads COMPLETE batch files only; a partial batch is skipped and named', [d['batch'] for d in dd] == ['calib-01'] and sk == ['ch-01'], (dd, sk))
shutil.rmtree(td)
print(f'\ntest-tdarch: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
