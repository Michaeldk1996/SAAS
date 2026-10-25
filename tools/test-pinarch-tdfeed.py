#!/usr/bin/env python3
"""Our Pinnacle closes into the Database archive (founder brief 2026-10-14, F3c / item 2). tools/pinarch.py td-feed turns
the archive export into a Tennis-Data-shaped feed; build-database-yield.js reads it. Checks: a Tennis-Data 2026 row with
no Pinnacle pair takes our close (named exactly as Tennis-Data wrote it, oriented by surname + initial); a Tennis-Data
Pinnacle price is never replaced; an ATP main-draw match after Tennis-Data's last day is added from an ARCHIVE close with
its api-tennis result (round in Tennis-Data's words from the event's last edition), never from a captured-only close;
Challenger, qualifying, walkovers, an event with no Tennis-Data edition and two candidate rows are counted, never
guessed; a retirement rides in retRows (behind the flag); without the feed the build is byte-identical (control)."""
import csv, importlib.util, json, os, shutil, subprocess, sys, tempfile
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
spec = importlib.util.spec_from_file_location('pinarch', os.path.join(HERE, 'pinarch.py'))
P = importlib.util.module_from_spec(spec); spec.loader.exec_module(P)
passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-500:])
check('names: "J. M. Cerundolo" → "Cerundolo J.M.", "B. Van De Zandschulp" → "Van De Zandschulp B."',
      P.td_name('J. M. Cerundolo') == 'Cerundolo J.M.' and P.td_name('B. Van De Zandschulp') == 'Van De Zandschulp B.')
check('surnames: Tennis-Data short compound forms join; brothers never do',
      P.same_surname('Mpetshi G.', 'G. Mpetshi Perricard') and P.same_surname('Ramos-Vinolas A.', 'A. Ramos')
      and not P.same_surname('Zverev A.', 'M. Zverev') and not P.same_surname('Cerundolo J.M.', 'F. Cerundolo'))
check('rounds in Tennis-Data words: a 96-draw (K=4) R64 = "2nd Round", R128 = "1st Round"; a 28-draw (K=2) R32 = "1st Round"',
      P.td_round('ATP Shanghai - 1/32-finals', 4) == '2nd Round' and P.td_round('ATP Shanghai - 1/64-finals', 4) == '1st Round'
      and P.td_round('ATP Chengdu - 1/16-finals', 2) == '1st Round' and P.td_round('X - 1/8-finals', 2) == '2nd Round'
      and P.td_round('X - Quarter-finals', 2) == 'Quarterfinals' and P.td_round('X - Final', 2) == 'The Final')
# Mutation: let the 'qualif' text test win over the feed's flag → the Lyon main draw reads qualifying → red.
check('items 1-2: the feed flag decides; the text test is only a fallback when the flag is absent',
      P.api_is_qualifying({'event_qualification': 'True', 'tournament_round': 'ATP Almaty - Semi-finals'})
      and not P.api_is_qualifying({'event_qualification': 'False', 'tournament_name': 'ATP Lyon (France) - Qualification'})
      and P.api_is_qualifying({'tournament_round': 'ATP X - Qualification Final'})
      and not P.api_is_qualifying({'tournament_round': 'ATP X - 1/16-finals'}))
check('items 1-2: lower_level files the Lyon main draw (flag False) as ATP main draw, and Almaty qualifying (flag True) as atp-q',
      P.lower_level({'event_type_type': 'Atp Singles', 'event_qualification': 'False', 'tournament_name': 'ATP Lyon (France) - Qualification'}) is None
      and P.lower_level({'event_type_type': 'Atp Singles', 'event_qualification': 'True', 'tournament_round': 'ATP Almaty - Final'}) == 'atp-q')
check('qualifying and an unknown round have no Tennis-Data round', P.td_round('X - Qualification Final', 4) is None and P.td_round('X - Group A', 0) is None)
H = 'date,tournament,series,court,surface,round,bestof,winner,loser,wrank,lrank,comment,b365w,b365l,psw,psl'
TD25 = [
    '2025-10-05,Shanghai Masters,Masters 1000,Outdoor,Hard,1st Round,3,Aaa A.,Bbb B.,1,2,Completed,1.5,2.6,1.52,2.7',
    '2025-10-07,Shanghai Masters,Masters 1000,Outdoor,Hard,4th Round,3,Aaa A.,Ccc C.,1,2,Completed,1.5,2.6,1.52,2.7',
]
TD26 = [
    '2026-01-05,Brisbane International,ATP250,Outdoor,Hard,1st Round,3,Pin P.,Ned N.,1,2,Completed,1.5,2.6,1.55,2.62',   # Pinnacle to 13 Jan
    '2026-01-13,Brisbane International,ATP250,Outdoor,Hard,2nd Round,3,Pin P.,Odd O.,1,2,Completed,1.5,2.6,1.55,2.62',
    '2026-06-12,Rosmalen Grass Court Championships,ATP250,Outdoor,Grass,2nd Round,3,Cilic M.,Borges N.,47,50,Completed,1.91,1.91,,',
    '2026-07-21,Estoril Open,ATP250,Outdoor,Clay,1st Round,3,Skatov T.,De Jong J.,163,98,Completed,,,,',
    '2026-08-02,Washington Open,ATP500,Outdoor,Hard,2nd Round,3,Keep K.,Have H.,1,2,Completed,1.8,2.0,1.81,2.05',
    '2026-09-13,Davis Cup Final,ATP250,Outdoor,Hard,1st Round,3,Last L.,Day D.,1,2,Completed,1.8,2.0,,',
]
api = lambda **k: dict({'event_type_type': 'Atp Singles', 'event_status': 'Finished', 'event_winner': 'First Player',
                        'tournament_name': 'ATP Shanghai', 'tournament_round': 'ATP Shanghai - 1/32-finals'}, **k)
E = [
    {'eventKey': 1, 'date': '2026-06-12', 'p1Name': 'N. Borges', 'p2Name': 'M. Cilic', 'p1': 2.12, 'p2': 1.79, 'label': 'captured', 'archiveId': 11},
    {'eventKey': 2, 'date': '2026-07-21', 'p1Name': 'T. Skatov', 'p2Name': 'J. De Jong', 'p1': 5.9, 'p2': 1.15, 'label': 'from Pinnacle history', 'archiveId': 12},
    {'eventKey': 3, 'date': '2026-08-02', 'p1Name': 'K. Keep', 'p2Name': 'H. Have', 'p1': 1.7, 'p2': 2.2, 'label': 'captured', 'archiveId': 13},
    {'eventKey': 4, 'date': '2026-10-09', 'p1Name': 'L. Musetti', 'p2Name': 'Y. Zhou', 'p1': 1.229, 'p2': 4.64, 'label': 'from Pinnacle history', 'archiveId': 14,
     'apiTennis': api(event_winner='Second Player')},
    {'eventKey': 5, 'date': '2026-10-10', 'p1Name': 'A. Ret', 'p2Name': 'B. Win', 'p1': 1.6, 'p2': 2.4, 'label': 'from Pinnacle history', 'archiveId': 15,
     'apiTennis': api(event_status='Retired', event_winner='Second Player', tournament_round='ATP Shanghai - 1/16-finals')},
    {'eventKey': 6, 'date': '2026-10-10', 'p1Name': 'C. Cap', 'p2Name': 'D. Only', 'p1': 1.6, 'p2': 2.4, 'label': 'captured', 'archiveId': 16},
    {'eventKey': 7, 'date': '2026-10-10', 'p1Name': 'E. Chal', 'p2Name': 'F. Lenger', 'p1': 1.6, 'p2': 2.4, 'label': 'from Pinnacle history', 'archiveId': 17,
     'apiTennis': api(event_type_type='Challenger Men Singles')},
    {'eventKey': 8, 'date': '2026-10-10', 'p1Name': 'G. Qual', 'p2Name': 'H. Ifier', 'p1': 1.6, 'p2': 2.4, 'label': 'from Pinnacle history', 'archiveId': 18,
     'apiTennis': api(tournament_round='ATP Shanghai - Qualification Final')},
    {'eventKey': 9, 'date': '2026-10-10', 'p1Name': 'I. New', 'p2Name': 'J. Event', 'p1': 1.6, 'p2': 2.4, 'label': 'from Pinnacle history', 'archiveId': 19,
     'apiTennis': api(tournament_name='ATP Nowhere')},
    {'eventKey': 10, 'date': '2026-10-10', 'p1Name': 'K. Walk', 'p2Name': 'L. Over', 'p1': 1.6, 'p2': 2.4, 'label': 'from Pinnacle history', 'archiveId': 20,
     'apiTennis': api(event_status='Walk Over')},
    # Defect brief 2026-10-24 item 1 (Almaty 2026): a QUALIFYING match flagged by the feed, whose round label reads as a
    # main-draw "Semi-finals" — it must never become a Database row.
    {'eventKey': 12, 'date': '2026-10-10', 'p1Name': 'M. Almaty', 'p2Name': 'N. Qual', 'p1': 1.6, 'p2': 2.4, 'label': 'from Pinnacle history', 'archiveId': 22,
     'apiTennis': api(event_qualification='True', tournament_round='ATP Shanghai - Semi-finals')},
    {'eventKey': 11, 'date': '2026-01-10', 'p1Name': 'P. Pin', 'p2Name': 'O. Odd', 'p1': 1.5, 'p2': 2.7, 'label': 'captured', 'archiveId': 21},
]
tmp = tempfile.mkdtemp(prefix='pinarch-td-')
try:
    arch = os.path.join(tmp, 'odds-archive'); os.makedirs(arch)
    open(os.path.join(arch, '2025.csv'), 'w').write(H + '\n' + '\n'.join(TD25) + '\n')
    open(os.path.join(arch, '2026.csv'), 'w').write(H + '\n' + '\n'.join(TD26) + '\n')
    td = P.read_td(arch)
    alias = {'Shanghai': ['Shanghai Masters']}
    rows, rep = P.td_feed_rows(E, td, alias, '2026-01-13')
    by = {r['eventKey']: r for r in rows}
    check('override: a Tennis-Data row with no Pinnacle (Bet365 1.91/1.91) takes our close, oriented to its winner',
          by.get(1, {}).get('kind') == 'override' and by[1]['winner'] == 'Cilic M.' and by[1]['psw'] == 1.79 and by[1]['psl'] == 2.12, by.get(1))
    check('override: a Tennis-Data row with no price at all takes it too', by.get(2, {}).get('kind') == 'override' and by[2]['psw'] == 5.9)
    check('a Tennis-Data Pinnacle price is never replaced', 3 not in by and rep['tdHasPinnacle'] == 1, rep)
    check('before the Tennis-Data Pinnacle stop (13 Jan) nothing is fed', 11 not in by and rep['beforePinnacleStop'] == 1, rep)
    a4 = by.get(4, {})
    check('add: Musetti v Zhou after Tennis-Data\'s last day = Shanghai Masters 2026, 2nd Round, Zhou won, priced 4.64 / 1.229',
          a4.get('kind') == 'add' and a4['tournament'] == 'Shanghai Masters' and a4['round'] == '2nd Round' and a4['winner'] == 'Zhou Y.'
          and a4['loser'] == 'Musetti L.' and a4['psw'] == 4.64 and a4['psl'] == 1.229 and a4['series'] == 'Masters 1000' and a4['comment'] == 'Completed', a4)
    check('add: a retirement is a "Retired" row (the Database voids it; the join settles it)', by.get(5, {}).get('comment') == 'Retired' and by[5]['round'] == '3rd Round', by.get(5))
    check('a captured-only close after Tennis-Data is not added (no result on record yet)', 6 not in by and rep['capturedOnlyAfterTd'] == 1, rep)
    check('Challenger, qualifying, an event with no Tennis-Data edition, a walkover: counted, never added',
          not any(k in by for k in (7, 8, 9, 10)) and rep['notAtpSingles'] == 1 and rep['qualifying'] == 2 and rep['noTdEdition'] == 1 and rep['walkover'] == 1, rep)
    # Mutation: drop the api_is_qualifying guard in td_feed_rows → event 12 is added as a main-draw Semifinals row → red.
    check('item 1: a feed-flagged qualifying match with a "Semi-finals" round label is never a main-draw row (Almaty 2026)',
          12 not in by and rep['qualifyingOrRound'] == 0, by.get(12))
    feed = os.path.join(tmp, 'feed.csv')
    with open(feed, 'w') as fh:
        fh.write(','.join(P.FEED_COLS) + '\n')
        for r in rows:
            fh.write(','.join('' if r.get(k) is None else str(r[k]) for k in P.FEED_COLS) + '\n')
    def build(out, feed_path):
        os.makedirs(out, exist_ok=True)
        r = subprocess.run(['node', os.path.join(ROOT, 'build-database-yield.js')], capture_output=True, text=True,
                           env=dict(os.environ, DB_YIELD_ARCHIVE_DIR=arch, DB_YIELD_OUT_DIR=out, DB_YIELD_FEED=feed_path))
        if r.returncode:
            return None, r.stderr
        return (json.load(open(os.path.join(out, 'database-yield.json'))), json.load(open(os.path.join(out, 'database-yield-players.json')))), r.stdout
    (base0, names0), log0 = build(os.path.join(tmp, 'o0'), '/nonexistent')
    (base1, names1), log1 = build(os.path.join(tmp, 'o1'), feed)
    m1 = base1['meta']
    def row_of(base, names, w, l, ret=False):
        rr, nn = (base['retRows'], names['retNames']) if ret else (base['rows'], names['names'])
        return next((r for r, n in zip(rr, nn) if n == [w, l]), None)
    r_bor0, r_bor1 = row_of(base0, names0, 'Cilic M.', 'Borges N.'), row_of(base1, names1, 'Cilic M.', 'Borges N.')
    # founder 2026-10-16 (round 3, item 1): our archive's close carries its own code — 4 = captured (3 = from Pinnacle history)
    check('control: without the feed the 1.91/1.91 tie is excluded; with it the row is priced on our captured Pinnacle close (book 4)',
          r_bor0 is None and r_bor1 is not None and r_bor1[8] == 4 and r_bor1[5] == 1.79 and r_bor1[6] == 2.12, (r_bor0, r_bor1))
    r_sk1 = row_of(base1, names1, 'Skatov T.', 'De Jong J.')
    check('the unpriced Tennis-Data row is priced on our close (favourite De Jong won? no: Skatov won at 5.90)', r_sk1 and r_sk1[7] == 0 and r_sk1[6] == 5.9, r_sk1)
    r_mz = row_of(base1, names1, 'Zhou Y.', 'Musetti L.')
    check('the added Shanghai match is a Database row (Zhou the underdog won), absent without the feed',
          r_mz and r_mz[5] == 1.229 and r_mz[6] == 4.64 and r_mz[7] == 0 and row_of(base0, names0, 'Zhou Y.', 'Musetti L.') is None, r_mz)
    check('the added retirement rides in retRows, never in rows', row_of(base1, names1, 'Win B.', 'Ret A.', ret=True) is not None
          and row_of(base1, names1, 'Win B.', 'Ret A.') is None)
    sem = lambda base, r: r and [r[0], base['meta']['tournaments'][r[4]], base['meta']['rounds'][r[3]], r[5], r[6], r[7], r[8]]
    check('a Tennis-Data Pinnacle row is unchanged by the feed (date, event, round, prices, result, book)',
          sem(base1, row_of(base1, names1, 'Keep K.', 'Have H.')) == sem(base0, row_of(base0, names0, 'Keep K.', 'Have H.')) is not None,
          (sem(base1, row_of(base1, names1, 'Keep K.', 'Have H.')), sem(base0, row_of(base0, names0, 'Keep K.', 'Have H.'))))
    check('meta: the feed never moves pinnacleLastPriced (Tennis-Data\'s own last Pinnacle day); archiveFeed counts every fed row',
          m1['pinnacleLastPriced'] == base0['meta']['pinnacleLastPriced'] == '2026-08-02' and m1['archiveFeed']['overridden'] == 2 and m1['archiveFeed']['added'] == 1
          and m1['archiveFeed']['addedRetired'] == 1 and m1['archiveFeed']['tdHadPinnacle'] == 0 and 'archiveFeed' not in base0['meta'], (m1['pinnacleLastPriced'], m1.get('archiveFeed')))
    check('the reconciliation still closes with the feed (every archive row in one bucket)', 'OK == archive' in log1, log1[-600:])
    check('dateRange runs to the newest added match', m1['dateRange'][1] == '2026-10-09', m1['dateRange'])
finally:
    shutil.rmtree(tmp, ignore_errors=True)
# ruling 5 (founder 2026-10-16): an added match spells its players as their earlier Tennis-Data rows do
TDS = [dict(zip(H.split(','), l.split(','))) for l in [
    '2026-09-01,US Open,Grand Slam,Outdoor,Hard,1st Round,5,Zhang Zh.,Van Assche L.,1,2,Completed,1.5,2.6,,',
    '2026-09-02,US Open,Grand Slam,Outdoor,Hard,2nd Round,5,Etcheverry T.M.,Carreno Busta P.,1,2,Completed,1.5,2.6,,',
    '2025-10-05,Shanghai Masters,Masters 1000,Outdoor,Hard,1st Round,3,Aaa A.,Bbb B.,1,2,Completed,1.5,2.6,1.52,2.7',
    '2025-10-07,Shanghai Masters,Masters 1000,Outdoor,Hard,4th Round,3,Aaa A.,Ccc C.,1,2,Completed,1.5,2.6,1.52,2.7']]
ES = [{'eventKey': 31, 'date': '2026-09-01', 'p1Name': 'Z. Zhang', 'p2Name': 'L. van Assche', 'p1Key': 590, 'p2Key': 3001, 'p1': 1.5, 'p2': 2.6, 'label': 'captured'},
      {'eventKey': 32, 'date': '2026-09-02', 'p1Name': 'T. M. Etcheverry', 'p2Name': 'P. Carreno-Busta', 'p1Key': 3002, 'p2Key': 3003, 'p1': 1.5, 'p2': 2.6, 'label': 'captured'},
      {'eventKey': 33, 'date': '2026-10-09', 'p1Name': 'L. van Assche', 'p2Name': 'Z. Zhang', 'p1Key': 3001, 'p2Key': 590, 'p1': 1.9, 'p2': 1.9, 'label': 'from Pinnacle history', 'apiTennis': api()},
      {'eventKey': 34, 'date': '2026-10-09', 'p1Name': 'P. Carreno-Busta', 'p2Name': 'T. M. Etcheverry', 'p1Key': 3003, 'p2Key': 3002, 'p1': 1.9, 'p2': 1.9, 'label': 'from Pinnacle history', 'apiTennis': api(event_winner='Second Player')},
      {'eventKey': 35, 'date': '2026-10-09', 'p1Name': 'B. Barrios', 'p2Name': 'Q. Nobody', 'p1Key': 396, 'p2Key': 9999, 'p1': 1.9, 'p2': 1.9, 'label': 'from Pinnacle history', 'apiTennis': api()}]
alias = {'Shanghai': ['Shanghai Masters']}
fr, rp = P.td_feed_rows(ES, TDS, alias, '2026-01-13', {'Barrios Vera M.T.': '396'})
adds = {(r['winner'], r['loser']) for r in fr if r['kind'] == 'add'}
check('ruling 5: an added match spells both players as their Tennis-Data rows ("Zhang Zh.", "Van Assche L.", "Etcheverry T.M.", "Carreno Busta P.")',
      ('Van Assche L.', 'Zhang Zh.') in adds and ('Etcheverry T.M.', 'Carreno Busta P.') in adds, adds)
check('ruling 5: a player with no Tennis-Data row of his own takes the ONE name the archive name table gives his key, else td_name',
      ('Barrios Vera M.T.', 'Nobody Q.') in adds, adds)
fr0, _ = P.td_feed_rows(ES[2:], TDS, alias, '2026-01-13')
adds0 = {(r['winner'], r['loser']) for r in fr0 if r['kind'] == 'add'}
check('control: without the joins and the table, the api-tennis forms stand (the pre-fix spellings)',
      ('van Assche L.', 'Zhang Z.') in adds0 and ('Etcheverry T.M.', 'Carreno-Busta P.') in adds0 and ('Barrios B.', 'Nobody Q.') in adds0, adds0)
check('ruling 5: the real archive name table parses (hand-checked names only, no "Surname, Given" forms)',
      P.parse_name_table(open(os.path.join(ROOT, 'build-odds-performance.js')).read()).get('Mpetshi G.') == '9222')
# ruling 4 (founder 2026-10-16): a NEW event's details from tournament-surfaces.json + TOURNAMENT_CATALOG; best of 5 at Slams only
NE = [dict(eventKey=41, date='2026-10-20', p1Name='A. New', p2Name='B. Event', p1=1.6, p2=2.4, label='from Pinnacle history',
           apiTennis=api(tournament_name='ATP Newtown', tournament_key=999, tournament_round='ATP Newtown - 1/16-finals')),
      dict(eventKey=42, date='2026-10-21', p1Name='C. New', p2Name='D. Event', p1=1.6, p2=2.4, label='from Pinnacle history',
           apiTennis=api(tournament_name='ATP Newtown', tournament_key=999, tournament_round='ATP Newtown - 1/8-finals')),
      dict(eventKey=43, date='2026-10-21', p1Name='E. Davis', p2Name='F. Cup', p1=1.6, p2=2.4, label='from Pinnacle history',
           apiTennis=api(tournament_name='Davis Cup - World Group I', tournament_key=998, tournament_round='')),
      dict(eventKey=44, date='2026-10-21', p1Name='G. Not', p2Name='H. Listed', p1=1.6, p2=2.4, label='from Pinnacle history',
           apiTennis=api(tournament_name='ATP Nocatalog', tournament_key=997, tournament_round='ATP Nocatalog - Final'))]
cat = {'Newtown': 'ATP 250', 'Davis Cup - World Group I': 'ATP 250'}
surf = {'surfaces': {'999': 'hard', '998': 'hard', '997': 'clay'}, 'courts': {'999': 'indoor', '998': 'indoor', '997': 'outdoor'}}
tdn = [dict(zip(H.split(','), l.split(','))) for l in ['2026-10-06,Shanghai Masters,Masters 1000,Outdoor,Hard,1st Round,3,Aaa A.,Bbb B.,1,2,Completed,1.5,2.6,,']]
nf, nr = P.td_feed_rows(NE, tdn, {}, '2026-01-13', None, cat, surf)
na = [r for r in nf if r['kind'] == 'add']
check('ruling 4: a new event is added from our own tables (surface Hard, court Indoor, ATP250, best of 3; R32 = 1st Round of a 32 draw)',
      len(na) == 2 and all(r['series'] == 'ATP250' and r['surface'] == 'Hard' and r['court'] == 'Indoor' and r['bestof'] == '3' for r in na)
      and sorted(r['round'] for r in na) == ['1st Round', '2nd Round'] and nr['newEvent'] == 2, (na, nr))
check('ruling 4: an event the catalog lacks is counted, never guessed', nr['noTdEdition'] == 1, nr)
# Round 2 item 1.1: api-tennis names the Lyon (France) MAIN draw "ATP Lyon (France) - Qualification" (flag False). The
# edition key AND the draw-size table use one key (td_event_key), so its R32 / R16 rows get their rounds — with the
# suffix left on the size table, K was 0 and only QF / SF / F were labelled (4 of 24 Lyon rows, live 2026-10-25).
# Mutation: key the size table on the raw name again → the 1/16 and 1/8 matches are not added → red.
LY = [dict(eventKey=51 + i, date='2026-10-2%d' % (i + 1), p1Name='L%d. A' % i, p2Name='L%d. B' % i, p1=1.6, p2=2.4, label='from Pinnacle history',
           apiTennis=api(tournament_name='ATP Lyon (France) - Qualification', tournament_key=14763, event_qualification='False',
                         tournament_round='ATP Lyon (France) - Qualification - ' + rnd)) for i, rnd in enumerate(['1/16-finals', '1/8-finals', 'Quarter-finals'])]
lf, lr = P.td_feed_rows(LY, tdn, {}, '2026-01-13', None, {'Lyon (France)': 'ATP 250'}, {'surfaces': {'14763': 'hard'}, 'courts': {'14763': 'indoor'}})
la = sorted(r['round'] for r in lf if r['kind'] == 'add')
check('round 2 item 1.1: the Lyon (France) main draw ("… - Qualification", flag False) is a new event with every round: R32, R16, QF',
      la == ['1st Round', '2nd Round', 'Quarterfinals'] and all(r['tournament'] == 'Lyon (France)' and r['court'] == 'Indoor' for r in lf if r['kind'] == 'add'), (la, lr))
# founder ruling 2026-10-17 (fix 2): a Davis Cup close is never a Database row ('add'); it is its own kind, 'team', for the era shard
tm = [r for r in nf if r['kind'] == 'team']
check('2026-10-17 fix 2: Davis Cup is a team row (the era shard), never an added Database row',
      len(tm) == 1 and nr['team'] == 1 and not [r for r in nf if r['kind'] == 'add' and 'Davis' in r['tournament']]
      and tm[0]['label'] and tm[0]['psw'] and tm[0]['psl'], (tm, nr))
slam = [dict(NE[0], apiTennis=dict(NE[0]['apiTennis'], tournament_name='ATP Newslam'))]
sf_, _ = P.td_feed_rows(slam, tdn, {}, '2026-01-13', None, {'Newslam': 'Grand Slam'}, surf)
check('ruling 4: best of 5 at a Grand Slam only', [r['bestof'] for r in sf_ if r['kind'] == 'add'] == ['5'], sf_)
n0, r0 = P.td_feed_rows(NE, tdn, {}, '2026-01-13')
check('control: without the tables a new event is not added (the pre-ruling behaviour)', not [r for r in n0 if r['kind'] == 'add'] and r0['noTdEdition'] == 3 and r0['team'] == 1, r0)
check('ruling 4: the real catalog parses (Madrid ATP 1000, Wimbledon Grand Slam)', P.parse_catalog(open(os.path.join(ROOT, 'bsp-consult-dashboard.html')).read()).get('Madrid') == 'ATP 1000')
print(f'\ntest-pinarch-tdfeed: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
