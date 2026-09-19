#!/usr/bin/env python3
"""TEN-225 item 2 — where the metered oddspapi units actually go, per tournament.

Founder 2026-09-19: "16.7 units/run is tournament count / 5, so we pay per
tournament on the board... a. Units per run by tournament and level over the last
7 days. b. LIST THE TOURNAMENTS WE ACTUALLY ASK FOR... how many fixtures it
carried, and how many came back with a bet365 price. c. DAVIS CUP: are WG / WG I
/ WG II separate tournamentIds? d. Rank every tournament by units spent vs bet365
fixtures returned... name the waste. e. Is tournament packing efficient?
f. What the leg costs scoped to ATP + Challenger only, at hourly, 2h and 4h."

HOW THE SPEND IS SHAPED (read out of refresh-odds.py, not assumed):

    matched_tids = distinct tournamentId over every UPCOMING DATED match on the
                   board that resolved to an oddspapi fixture
    units/run    = ceil(len(matched_tids) / 5)      # CHUNK_TIDS, the API's hard cap
    one book     = bet365, the only entitled book

So the unit count is a function of the TOURNAMENT COUNT alone. A tournament with
one fixture costs exactly as much as one with sixty, and a tournament bet365 does
not price costs exactly as much as one it does. That asymmetry is the whole
finding, and it is why scope is the lever before cadence.

METHOD, and why it costs nothing. Both inputs are committed by the pipeline every
run, so their git history IS the per-run record:

    odds-fixture-map.json  ->  which tournamentIds were matched (the spend)
    matches.json           ->  the board: tournament name, level, and whether
                               bet365Now came back for each fixture (the return)

Replaying them is free, needs no API call, and measures what the runs really
sent rather than what a re-run today would send.

⚠️ "Came back with a bet365 price" is read as `bet365Now` present on the fixture
in the matches.json committed by that run. That is the artefact the call
produces, so its absence is the honest reading of "we paid and got nothing" --
but it is an OBSERVATION of the outcome, not a read of the HTTP response, so a
fixture whose price arrived and was then dropped downstream would look the same.
Flagged rather than glossed.
"""
import json
import math
import subprocess
import sys
from collections import defaultdict

REPO = '/Users/Michael/bsp-consult-project'
CHUNK_TIDS = 5          # refresh-odds.py: the API's hard cap, never raise it


def sh(*a):
    return subprocess.run(a, cwd=REPO, capture_output=True, text=True).stdout


def level_of(name):
    """Bucket a tournament name into the levels the founder asked for."""
    s = (name or '').lower()
    if 'davis cup' in s:
        return 'Davis Cup'
    if 'billie jean' in s or 'bjk' in s:
        return 'BJK Cup'
    if 'challenger' in s or s.startswith('ch '):
        return 'Challenger'
    if 'itf' in s or s.startswith('m15') or s.startswith('m25') or s.startswith('w15'):
        return 'ITF'
    if 'wta' in s:
        return 'WTA'
    if 'utr' in s:
        return 'UTR'
    return 'ATP'


def load(commit, path):
    raw = sh('git', 'show', f'{commit}:{path}')
    if not raw.strip():
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def snapshot(commit):
    """One run's spend picture: {tid: {...}} plus the board it was computed from."""
    mp = load(commit, 'odds-fixture-map.json')
    ms = load(commit, 'matches.json')
    if not mp or not ms:
        return None
    by_key = (mp.get('byKey') or {})
    matches = ms['matches'] if isinstance(ms, dict) and 'matches' in ms else ms
    if not isinstance(matches, list):
        return None

    # refresh-odds.py's own population: upcoming AND dated.
    upcoming = {}
    for m in matches:
        if m.get('finalScore') or not m.get('date'):
            continue
        ek = str(m.get('id', '')).split('-')[-1]
        if ek:
            upcoming[ek] = m

    tids = defaultdict(lambda: {'fixtures': 0, 'with_b365': 0, 'names': set()})
    for ek, m in upcoming.items():
        rec = by_key.get(ek)
        if not rec or rec.get('tournamentId') is None:
            continue                      # unresolved: costs nothing, asks nothing
        t = tids[rec['tournamentId']]
        t['fixtures'] += 1
        t['names'].add(m.get('tour') or m.get('tournament') or '?')
        if m.get('bet365Now'):
            t['with_b365'] += 1
    return tids


def main():
    commits = sh('git', 'log', 'origin/main', '--since=7 days ago', '--format=%H %cI',
                 '--', 'odds-fixture-map.json').strip().splitlines()
    commits = [c.split() for c in commits if c.strip()]
    if not commits:
        print('::warning:: no odds-fixture-map.json commits in the window — NOTHING '
              'was assessed. This is not "no spend".')
        return 1
    print(f'{len(commits)} pipeline commit(s) of odds-fixture-map.json in 7 days')
    print(f'window {commits[-1][1]} -> {commits[0][1]}\n')

    # ---- (b) the last 5 runs, dumped in full --------------------------------
    print('=' * 78)
    print('(b) THE TOURNAMENTS WE ACTUALLY ASK FOR — last 5 runs')
    print('=' * 78)
    runs = []
    for h, t in commits[:5]:
        snap = snapshot(h)
        if snap is None:
            print(f'  {t}  {h[:8]}: unreadable, SKIPPED (not counted as zero)')
            continue
        runs.append((h, t, snap))
        n_t = len(snap)
        units = math.ceil(n_t / CHUNK_TIDS)
        waste = units * CHUNK_TIDS - n_t
        fx = sum(v['fixtures'] for v in snap.values())
        b3 = sum(v['with_b365'] for v in snap.values())
        print(f'\n  RUN {t}  {h[:8]}')
        print(f'    tournaments asked {n_t:>3}   units {units:>3}   '
              f'slots wasted {waste}   fixtures {fx}   with bet365 {b3}')
        print(f'    {"tid":>7} {"level":11} {"fx":>3} {"b365":>5}  tournament')
        for tid, v in sorted(snap.items(), key=lambda x: -x[1]['fixtures']):
            nm = sorted(v['names'])[0]
            mark = '  <- 0 bet365' if v['with_b365'] == 0 else ''
            print(f'    {tid:>7} {level_of(nm):11} {v["fixtures"]:>3} '
                  f'{v["with_b365"]:>5}  {nm[:44]}{mark}')

    if not runs:
        print('::warning:: no readable run in the last 5 — nothing assessed.')
        return 1

    # ---- (a) units by level, over the whole window --------------------------
    print('\n' + '=' * 78)
    print('(a) UNITS BY LEVEL — every run in the window')
    print('=' * 78)
    lvl_t, lvl_fx, lvl_b3, lvl_runs = (defaultdict(int), defaultdict(int),
                                       defaultdict(int), defaultdict(int))
    total_units, n_runs = 0, 0
    tour_agg = defaultdict(lambda: {'runs': 0, 'fx': 0, 'b365': 0, 'name': '?'})
    for h, t in commits:
        snap = snapshot(h)
        if snap is None:
            continue
        n_runs += 1
        total_units += math.ceil(len(snap) / CHUNK_TIDS)
        seen_lvl = set()
        for tid, v in snap.items():
            nm = sorted(v['names'])[0]
            lv = level_of(nm)
            lvl_t[lv] += 1
            lvl_fx[lv] += v['fixtures']
            lvl_b3[lv] += v['with_b365']
            seen_lvl.add(lv)
            a = tour_agg[tid]
            a['runs'] += 1; a['fx'] += v['fixtures']
            a['b365'] += v['with_b365']; a['name'] = nm
        for lv in seen_lvl:
            lvl_runs[lv] += 1

    print(f'  runs read {n_runs}   total units {total_units}   '
          f'mean {total_units/n_runs:.1f} units/run'
          + ('   ⚠️ n<30 runs' if n_runs < 30 else ''))
    tt = sum(lvl_t.values())
    print(f'\n  {"level":12} {"tid-slots":>10} {"share":>7} {"fixtures":>9} '
          f'{"bet365 fx":>10} {"hit rate":>9}')
    for lv in sorted(lvl_t, key=lambda x: -lvl_t[x]):
        hit = (100.0 * lvl_b3[lv] / lvl_fx[lv]) if lvl_fx[lv] else 0.0
        print(f'  {lv:12} {lvl_t[lv]:>10} {100.0*lvl_t[lv]/tt:>6.1f}% '
              f'{lvl_fx[lv]:>9} {lvl_b3[lv]:>10} {hit:>8.1f}%')
    print('  NOTE: units are bought per TOURNAMENT SLOT, so the share column — not '
          'the fixture column — is what each level costs.')

    # ---- (c) Davis Cup ------------------------------------------------------
    print('\n' + '=' * 78)
    print('(c) DAVIS CUP — separate tournamentIds?')
    print('=' * 78)
    dc = {tid: a for tid, a in tour_agg.items() if level_of(a['name']) == 'Davis Cup'}
    if not dc:
        print('  no Davis Cup tournament in the window — NOT assessed, not "zero".')
    else:
        print(f'  {len(dc)} distinct tournamentId(s) carrying a Davis Cup name:')
        for tid, a in sorted(dc.items()):
            print(f'    tid {tid:>7}  seen in {a["runs"]:>3} run(s)  '
                  f'fixtures {a["fx"]:>4}  bet365 {a["b365"]:>4}  {a["name"][:48]}')
        # per-run cost: the slots Davis Cup occupies in a typical run
        latest = runs[0][2]
        dc_now = [tid for tid in latest if level_of(sorted(latest[tid]['names'])[0]) == 'Davis Cup']
        n_now = len(latest)
        u_now = math.ceil(n_now / CHUNK_TIDS)
        u_wo = math.ceil((n_now - len(dc_now)) / CHUNK_TIDS)
        print(f'\n  On the most recent run: {len(dc_now)} of {n_now} tournament slots '
              f'are Davis Cup.')
        print(f'  units with Davis Cup {u_now}  ->  without {u_wo}  '
              f'= {u_now - u_wo} unit(s)/run saved, {(u_now-u_wo)*24} units/day at hourly.')

    # ---- (d) the waste ranking ---------------------------------------------
    print('\n' + '=' * 78)
    print('(d) RANKED BY WASTE — units spent vs bet365 fixtures returned')
    print('=' * 78)
    print(f'  {"tid":>7} {"level":11} {"runs":>5} {"fx":>5} {"b365":>5} {"hit":>7}  tournament')
    waste_runs = 0
    for tid, a in sorted(tour_agg.items(), key=lambda x: (x[1]['b365'], -x[1]['runs'])):
        hit = (100.0 * a['b365'] / a['fx']) if a['fx'] else 0.0
        mark = '  <- PURE WASTE' if a['b365'] == 0 else ''
        if a['b365'] == 0:
            waste_runs += a['runs']
        print(f'  {tid:>7} {level_of(a["name"]):11} {a["runs"]:>5} {a["fx"]:>5} '
              f'{a["b365"]:>5} {hit:>6.1f}%  {a["name"][:40]}{mark}')
    zero = [t for t, a in tour_agg.items() if a['b365'] == 0]
    print(f'\n  {len(zero)} of {len(tour_agg)} tournaments returned ZERO bet365 prices '
          f'across the whole window.')
    print(f'  They occupied {waste_runs} tournament-slots in total — '
          f'~{waste_runs/max(n_runs,1):.1f} slots per run.')

    # ---- (e) packing --------------------------------------------------------
    print('\n' + '=' * 78)
    print('(e) PACKING — are all 5 ids per call used?')
    print('=' * 78)
    for h, t, snap in runs:
        n_t = len(snap)
        units = math.ceil(n_t / CHUNK_TIDS)
        waste = units * CHUNK_TIDS - n_t
        print(f'  {t}  {n_t:>3} tournaments -> {units:>3} calls, '
              f'{waste} empty slot(s) in the last chunk '
              f'({100.0*n_t/(units*CHUNK_TIDS):.0f}% full)')
    print('  Packing is already optimal by construction: the chunker fills 5 per call '
          'and only the FINAL chunk is short. There is no packing win available — the '
          'only lever is asking for fewer tournaments.')

    # ---- (f) ATP + Challenger scope -----------------------------------------
    print('\n' + '=' * 78)
    print('(f) SCOPED TO ATP + CHALLENGER — cost at each cadence')
    print('=' * 78)
    latest = runs[0][2]
    keep = {'ATP', 'Challenger'}
    n_all = len(latest)
    n_keep = sum(1 for tid, v in latest.items()
                 if level_of(sorted(v['names'])[0]) in keep)
    print(f'  most recent run: {n_all} tournaments, {n_keep} of them ATP or Challenger')
    print(f'\n  {"scope":24} {"units/run":>10} {"hourly":>8} {"2-hourly":>9} {"4-hourly":>9}')
    for label, n_t in (('everything (today)', n_all), ('ATP + Challenger only', n_keep)):
        u = math.ceil(n_t / CHUNK_TIDS)
        print(f'  {label:24} {u:>10} {u*24:>8} {u*12:>9} {u*6:>9}')
    print('\n  cap = 133 units/day.')
    for label, n_t in (('everything', n_all), ('ATP + Challenger', n_keep)):
        u = math.ceil(n_t / CHUNK_TIDS)
        fits = [c for c, mult in (('hourly', 24), ('2-hourly', 12), ('4-hourly', 6))
                if u * mult <= 133]
        print(f'    {label:18} fits inside 133/day at: '
              + (', '.join(fits) if fits else 'NONE of hourly / 2h / 4h'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
