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

print(f'\ntest-tdarch: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
