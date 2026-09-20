#!/usr/bin/env python3
"""TEN-232 / TEN-225 — THE BET105 GATE. REPORT ONLY. RENDERS NOTHING.

FOUNDER, 2026-09-20T23:14Z: "If it IS there, run the full gate before anything
renders ... Do not change the book ladder or render anything until (f) passes.
Report and I will rule."

WHY THIS IS A SEPARATE SCRIPT AND NOT A FLAG ON THE CARD PATH.
`ten225-kibl-card-state.py` reads with `feed_source_id=eq.VERIFIED_FEED_SOURCE_ID`
and VERIFIED_FEED_SOURCE_ID is 43 (Sports411). Running it today would read ZERO
Bet105 rows and print a clean 0% for every figure in this gate — a vacuous pass
on an empty set, which is the failure mode the founder has ruled against more
times on this issue than any other. So this file reads the book under test
directly, and the card path's refusal stays exactly where it is.

Nothing here writes. It does not touch odds_card_state, the ladder, the
published JSON, or any card. It reads Supabase and (for the entitlement check
and the market vocabulary) Kibl. Kibl is free and unmetered; zero oddspapi units.

⚠️ THE ENTITLEMENT SWAPPED, IT DID NOT GROW. Measured 2026-09-20T23:18Z, run
35544209624: /reference/sportsbooks returns exactly ONE book, feed_source_id
**171 = Bet105**, and **Sports411 (43) is gone**. So this is not "a second book
appeared" — Bet105 REPLACED Sports411 on this credential, at 2026-09-19T14:07Z
(the timestamp the entitlement watch wrote into kibl-entitlement-baseline.json).
Every Sports411 row in the archive is history now; no new one can arrive.

Usage:
  python3 ten232-bet105-gate.py --feed-source-id 171 [--days-back 45]
"""
import argparse
import collections
import json
import os
import statistics
import sys
import types
import urllib.parse
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))

# The card-state module, loaded whole. Its build_rows/run_orientation ARE the
# gate the founder means by "same bar as Sports411" — re-implementing them here
# would let this report pass a rule the shipped code does not apply, which is
# the one thing a gate must never do.
K = types.ModuleType('K')
K.__file__ = os.path.join(HERE, 'ten225-kibl-card-state.py')
_argv, sys.argv = sys.argv, ['K']
exec(compile(open(K.__file__).read(), K.__file__, 'exec'), K.__dict__)
sys.argv = _argv

from kibl_client import KiblClient, TENNIS_LEAGUES_MEN  # noqa: E402

# The three leagues the founder named in (a). Kibl's own ids, from kibl_client.
LEAGUES = dict(TENNIS_LEAGUES_MEN)          # {19: ATP, 537: Challenger, 962: ITF Men}

# Historical comparator for (g). Sports411 is no longer entitled, so these rows
# can only ever be the ones already captured — the comparison is against a
# closed set, and that is stated rather than implied.
SPORTS411_ID = 43


def out(k, v):
    """A machine-readable line per figure, so the job summary is greppable."""
    print(f'{k}={v}')


def hours(a, b):
    """Hours from a to b, or None if either clock is missing. Never 0 for missing."""
    if a is None or b is None:
        return None
    return (b - a) / 3600.0


def dist(vals):
    """median / min / max / n, flagged under 30. Missing stays a dash."""
    vals = [v for v in vals if v is not None]
    if not vals:
        return {'n': 0, 'median': None, 'min': None, 'max': None, 'thin': True}
    return {'n': len(vals), 'median': round(statistics.median(vals), 2),
            'min': round(min(vals), 2), 'max': round(max(vals), 2),
            'thin': len(vals) < 30}


def fmt(d, unit='h'):
    if not d['n']:
        return '—  (n=0)'
    return (f"median {d['median']}{unit}  range {d['min']}..{d['max']}{unit}  "
            f"n={d['n']}" + ('  ⚠️ n<30' if d['thin'] else ''))


# ───────────────────────────── the entitlement precondition ─────────────────
def verify_entitled(fsid):
    """Refuse to report on a book we are not served.

    A confident report about the wrong feed_source_id is worse than no report:
    every figure below would be real, internally consistent, and about something
    else. The id is checked against the LIVE list, not against the committed
    baseline — the baseline is what we last saw, which is exactly the thing in
    question when a book has just changed.
    """
    # `get` returns (payload, meta) and authenticates on demand. Unpacked
    # explicitly: handing the tuple to rows() yields an empty list, which would
    # read as "no entitlement" and is exactly the wrong answer to get quietly.
    c = KiblClient()
    payload, meta = c.get('/reference/sportsbooks')
    if meta.get('status') != 200:
        print(f"::error::/reference/sportsbooks HTTP {meta.get('status')}")
        return None, c
    rows = [b for b in c.rows(payload) if isinstance(b, dict)]
    seen = {}
    for r in rows:
        i = r.get('feed_source_id')
        if i is not None:
            seen[int(i)] = r.get('name') or r.get('tag') or '(unnamed)'
    print('/reference/sportsbooks — ' + (', '.join(f'{i}={n}' for i, n in
                                                   sorted(seen.items())) or 'EMPTY'))
    if not seen:
        print('::error::/reference/sportsbooks returned zero books. Every '
              'figure below would be vacuous. Refusing.')
        return None, c
    if fsid not in seen:
        print(f'::error::feed_source_id {fsid} is NOT in our entitlement '
              f'({sorted(seen)}). Refusing to report on a book we are not served.')
        return None, c
    return seen, c


# ───────────────────────────────── a — coverage ─────────────────────────────
def section_a(fixtures, obs_by_fixture, fsid):
    """% of fixtures priced per league, with n.

    PRICED MEANS BOTH SIDES. A one-sided quote cannot make a card, so counting
    it would overstate what a member could ever see. Both numerators are printed
    anyway, because the gap between them is itself a finding.
    """
    print('\n=== (a) COVERAGE — % of fixtures priced, per league ===')
    print('    priced = this book quotes BOTH sides of the match-winner market')
    res = {}
    for lid, lname in sorted(LEAGUES.items()):
        fx = [f for f in fixtures if f.get('league_id') == lid]
        any_side = both = 0
        for f in fx:
            mw = [o for o in obs_by_fixture.get(f['fixture_id'], [])
                  if K.is_match_winner(o) and o.get('price_decimal') is not None]
            if not mw:
                continue
            any_side += 1
            if len({o.get('fixture_participant_id') for o in mw}) >= 2:
                both += 1
        pct = (100.0 * both / len(fx)) if fx else None
        res[lname] = {'fixtures': len(fx), 'priced_both': both,
                      'priced_any': any_side,
                      'pct': None if pct is None else round(pct, 1)}
        bar = '—' if pct is None else f'{pct:5.1f}%'
        print(f'  {lname:<12} {both:>5} of {len(fx):<5} fixtures  {bar}'
              f'   (one-sided only: {any_side - both})'
              + ('   ⚠️ n<30' if len(fx) < 30 else ''))
        out(f'coverage_{lname.replace(" ", "_").lower()}_pct',
            'dash' if pct is None else round(pct, 1))
        out(f'coverage_{lname.replace(" ", "_").lower()}_n', len(fx))
    other = collections.Counter(f.get('league_id') for f in fixtures
                                if f.get('league_id') not in LEAGUES)
    if other:
        print(f'  leagues outside the three named: {dict(other)}')
    return res


# ───────────────────────────────── b — markets ──────────────────────────────
def section_b(obs, client, fsid):
    """Which markets this book actually returns, named from Kibl's own vocabulary.

    The founder's question is specific and it is the reason Kibl mattered at all:
    do SET HANDICAP or TOTAL SETS appear? Those were absent on Sports411. A
    set-level market is (market_type = Spread|Total) x (segment = a SET), so the
    answer needs both vocabularies, not market_type alone — a Spread on the full
    game and a Spread on a set are the same market_type_id and completely
    different products.
    """
    print('\n=== (b) MARKETS — what this book returns ===')
    mt, sg, bt = {}, {}, {}
    for ep, into in (('/reference/market-types', mt),
                     ('/reference/segments', sg),
                     ('/reference/betting-types', bt)):
        try:
            payload, _meta = client.get(ep)
            for r in (b for b in client.rows(payload) if isinstance(b, dict)):
                for idk in ('market_type_id', 'segment_id', 'betting_type_id', 'id'):
                    if r.get(idk) is not None:
                        into[int(r[idk])] = r.get('name') or r.get('tag') or '?'
                        break
        except Exception as e:                                  # noqa: BLE001
            print(f'::warning::{ep} failed ({e}) — ids below stay unnamed')

    combos = collections.Counter(
        (o.get('market_type_id'), o.get('segment_id'), o.get('betting_type_id'))
        for o in obs)
    print(f'  {len(combos)} distinct (market_type, segment, betting_type) combos')
    print(f'  {"market_type":<28} {"segment":<24} {"betting_type":<14} rows')
    for (m, s, b), n in combos.most_common():
        print(f'  {str(mt.get(m, m))[:27]:<28} {str(sg.get(s, s))[:23]:<24} '
              f'{str(bt.get(b, b))[:13]:<14} {n}')

    def present(mnames, seg_exact):
        """Rows matching a market-type word AND an EXACT segment name.

        ⚠️ THE SEGMENT MATCH IS EXACT, NOT A SUBSTRING, AND THE FIRST CUT OF
        THIS FUNCTION GOT IT WRONG. Matching 'set' as a substring folds
        "First Set" into "Sets", so `Spread x First Set` — a GAMES handicap
        inside set one — was counted as a SET HANDICAP, and `Total x First Set`
        — total GAMES in set one — as TOTAL SETS. On the first live run that
        inflated the two answers the founder actually asked about from 4,322 to
        8,669 and from 2,006 to 5,802. Two different products with one word in
        common is exactly how a market gets claimed that the book does not sell.
        """
        hit = 0
        for (m, s, _b), n in combos.items():
            mn = str(mt.get(m, '')).lower()
            sn = str(sg.get(s, '')).lower().strip()
            if any(x in mn for x in mnames) and sn in seg_exact:
                hit += n
        return hit

    # The three the founder named, plus the two that decide whether this book is
    # worth more than Sports411 was, plus the two near-misses printed beside
    # them so the distinction is visible rather than a footnote.
    asks = [
        ('match winner (moneyline, full game)', present(('moneyline', 'money line',
                                                         'winner'), {'full game'})),
        ('spread — games handicap (full game)', present(('spread', 'handicap'),
                                                        {'full game'})),
        ('total — total games (full game)',     present(('total',), {'full game'})),
        ('SET HANDICAP (spread on SETS)',       present(('spread', 'handicap'),
                                                        {'sets'})),
        ('TOTAL SETS (total on SETS)',          present(('total',), {'sets'})),
        ('  — not those: spread on FIRST SET (games hcp in set 1)',
         present(('spread', 'handicap'), {'first set'})),
        ('  — not those: total on FIRST SET (games in set 1)',
         present(('total',), {'first set'})),
    ]
    print()
    for label, n in asks:
        print(f'  {label:<38} {"YES" if n else "NO ":<4} rows={n if n else "—"}')
        out('market_' + label.split(' (')[0].strip().lower().replace(' ', '_'),
            'yes' if n else 'no')
    if not present(('spread', 'handicap'), {'sets'}) and not present(('total',), {'sets'}):
        print('\n  ⚠️ NO SET-LEVEL MARKET. Same as Sports411. The set handicap / '
              'total sets that made Kibl interesting are still absent.')
    return {'combos': {f'{m}/{s}/{b}': n for (m, s, b), n in combos.items()},
            'asks': dict(asks)}


# ─────────────────────────── c, d, e — alt_id, live, openers ────────────────
def section_cde(obs):
    print('\n=== (c) ALTERNATE LINES — is alt_id populated? ===')
    alt = collections.Counter(o.get('alt_id') for o in obs)
    nonzero = sum(n for v, n in alt.items() if v not in (None, 0))
    print(f'  alt_id values: {dict(alt.most_common(8))}')
    print(f'  rows with a non-zero, non-null alt_id: {nonzero} of {len(obs)}'
          + ('   -> alternates ARE served' if nonzero else
             '   -> NO alternates. Every row is the main line.'))
    out('alt_id_nonzero_rows', nonzero)

    print('\n=== (d) LIVE — betting_type_id 3 ===')
    bt = collections.Counter(o.get('betting_type_id') for o in obs)
    live_bt = bt.get(3, 0)
    live_flag = sum(1 for o in obs if o.get('is_live'))
    print(f'  betting_type_id distribution: {dict(bt)}')
    print(f'  betting_type_id == 3 rows: {live_bt}'
          + ('' if live_bt else '   -> NO live rows'))
    print(f'  is_live == true rows:      {live_flag}')
    out('live_betting_type_3_rows', live_bt)
    out('live_flag_rows', live_flag)

    print('\n=== (e) OPENERS — does is_opener return real openers? ===')
    mw = [o for o in obs if K.is_match_winner(o)]
    op = [o for o in mw if o.get('is_opener')]
    print(f'  match-winner rows: {len(mw)}   is_opener=true: {len(op)}')
    if not mw:
        print('  ::warning:: no match-winner rows — this check is VACUOUS')
        out('opener_real', 'dash')
        return
    # An `is_opener` flag is only meaningful if the row it marks is actually the
    # EARLIEST price we hold for that (fixture, side). A flag that marks an
    # arbitrary row would look identical in a count and be worthless as an Open.
    by_side = collections.defaultdict(list)
    for o in mw:
        by_side[(o['fixture_id'], o.get('fixture_participant_id'))].append(o)
    checked = earliest = 0
    for _k, rows in by_side.items():
        flagged = [r for r in rows if r.get('is_opener')]
        if not flagged or len(rows) < 2:
            continue
        checked += 1
        first = min(rows, key=lambda r: r.get('inserted_on') or '')
        if any(r.get('inserted_on') == first.get('inserted_on') for r in flagged):
            earliest += 1
    if not checked:
        print('  ::warning:: no (fixture, side) carries BOTH an opener flag and a '
              'second observation, so "is the opener the earliest" cannot be '
              'answered yet. Not reported as a pass.')
        out('opener_real', 'unmeasurable')
    else:
        print(f'  of {checked} sides with an opener flag AND a later price, the '
              f'flagged row is the earliest on {earliest} '
              f'({100.0 * earliest / checked:.1f}%)'
              + ('   ⚠️ n<30' if checked < 30 else ''))
        out('opener_is_earliest_pct', round(100.0 * earliest / checked, 1))
        out('opener_is_earliest_n', checked)


# ──────────────────────────────── g — opening times ─────────────────────────
def section_g(fixtures, obs_by_fixture, s411_by_fixture, url, key):
    """How early each book posts, per level.

    ⚠️ CLOCK LABELS, AND THEY ARE NOT THE SAME CLOCK.
      · Kibl `inserted_on` is VENDOR-INSERT time — when KIBL wrote the row. It is
        latency to Kibl, never latency to the book. Both Bet105 and Sports411
        below are on this clock, so those two are directly comparable.
      · oddspapi `open_ts` is the BOOK'S OWN tick time (createdAt). It is a
        different clock and the two columns must not be read as one measurement.
        Printed side by side because the founder asked for the comparison; the
        difference between them is not purely the books.
      · Every figure is measured against Kibl's / oddspapi's SCHEDULED start,
        never an actual start. A scheduled time is fine as a yardstick for "how
        early"; it is banned only as a Close cutoff.
    """
    print('\n=== (g) OPENING TIMES — hours before scheduled start, per level ===')
    print('    Kibl rows: VENDOR-INSERT time (inserted_on), not book-post time.')
    print('    oddspapi rows: the BOOK\'S OWN tick time. A DIFFERENT CLOCK.')

    def kibl_leads(by_fixture):
        per = collections.defaultdict(list)
        for f in fixtures:
            lid = f.get('league_id')
            if lid not in LEAGUES:
                continue
            sched = K.epoch(f.get('scheduled_start'))
            rows = [o for o in by_fixture.get(f['fixture_id'], [])
                    if K.is_match_winner(o) and o.get('is_opener')]
            if not rows or sched is None:
                continue
            first = min(K.epoch(r.get('inserted_on')) or 0 for r in rows) or None
            per[LEAGUES[lid]].append(hours(first, sched))
        return per

    b105 = kibl_leads(obs_by_fixture)
    s411 = kibl_leads(s411_by_fixture)

    # bet365, from oddspapi's own tables. No name matching needed — fixture_id is
    # the same id space on both sides, so this join cannot mis-pair.
    ofx, err = K.fetch_all(url, key, 'oddspapi_fixtures',
                           'fixture_id,scheduled_start,category_name')
    osum, err2 = K.fetch_all(url, key, 'oddspapi_line_summary',
                             'fixture_id,market,side,open_price,open_ts',
                             f'&market=eq.{urllib.parse.quote(K.MARKET)}')
    b365 = collections.defaultdict(list)
    if err or err2:
        print(f'  ::warning::oddspapi read failed ({err or err2}) — bet365 column '
              f'is a dash, not a zero')
    else:
        sched_of = {r['fixture_id']: (K.epoch(r.get('scheduled_start')),
                                      r.get('category_name') or '')
                    for r in ofx}
        first_open = {}
        for r in osum:
            t = K.epoch(r.get('open_ts'))
            if t is None or r.get('open_price') is None:
                continue
            fid = r['fixture_id']
            if fid not in first_open or t < first_open[fid]:
                first_open[fid] = t
        for fid, t in first_open.items():
            sched, cat = sched_of.get(fid, (None, ''))
            c = cat.lower()
            lvl = ('Challenger' if 'challenger' in c else
                   'ITF Men' if 'itf' in c and 'women' not in c else
                   'ATP' if 'atp' in c and 'davis' not in c else None)
            if lvl:
                b365[lvl].append(hours(t, sched))

    print(f'\n  {"level":<12} {"Bet105 (vendor-insert)":<40} '
          f'{"Sports411 (vendor-insert, HISTORY)":<40} bet365 (book tick)')
    for lvl in ('ATP', 'Challenger', 'ITF Men'):
        print(f'  {lvl:<12} {fmt(dist(b105.get(lvl, []))):<40} '
              f'{fmt(dist(s411.get(lvl, []))):<40} {fmt(dist(b365.get(lvl, [])))}')
        out(f'open_lead_bet105_{lvl.replace(" ", "_").lower()}_median',
            dist(b105.get(lvl, []))['median'] or 'dash')
    print('\n  Sports411 is a CLOSED set: it left our entitlement 2026-09-19T14:07Z, '
          'so its column can never grow again.')
    return {'bet105': {k: dist(v) for k, v in b105.items()},
            'sports411': {k: dist(v) for k, v in s411.items()},
            'bet365': {k: dist(v) for k, v in b365.items()}}


# ──────────────────────────────────── main ──────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--feed-source-id', type=int, required=True,
                    help='the book under test. Verified against the LIVE '
                         'entitlement before anything is reported.')
    ap.add_argument('--days-back', type=int, default=45)
    a = ap.parse_args()
    fsid = a.feed_source_id

    print(f'# TEN-232 — the Bet105 gate (feed_source_id {fsid}). REPORT ONLY.\n')
    entitled, client = verify_entitled(fsid)
    if entitled is None:
        return 1
    print(f'  -> feed_source_id {fsid} = {entitled[fsid]}, entitled. Proceeding.\n')

    url, key = K.creds()
    as_of = datetime.now(timezone.utc).timestamp()
    since = K.iso(as_of - a.days_back * 86400)

    fx, err = K.fetch_all(url, key, 'kibl_fixtures',
                          'fixture_id,league_id,scheduled_start,name,'
                          'player1_name,player2_name,match_key,first_seen_at')
    if err:
        print(f'::error::reading kibl_fixtures failed ({err})')
        return 1
    print(f'kibl_fixtures: {len(fx)}')

    # EVERY market type, not just match winner — (b), (c) and (d) are questions
    # about what this book carries, and filtering to the one market we already
    # ship would answer them about our filter instead of about the book.
    obs, err = K.fetch_all(url, key, 'kibl_line_observations', K.OBS_COLUMNS,
                           f'&feed_source_id=eq.{fsid}&observed_at=gte.{since}',
                           order='fixture_id.asc,inserted_on.asc')
    if err:
        print(f'::error::reading kibl_line_observations failed ({err})')
        return 1

    # The filter is a promise about the query; this reads the answer back.
    foreign = sorted({o.get('feed_source_id') for o in obs
                      if o.get('feed_source_id') != fsid})
    if foreign:
        print(f'::error::the feed_source_id filter did not hold — rows from '
              f'{foreign} came back. Every figure below would be a blend.')
        return 1
    if not obs:
        print(f'::error::ZERO rows for feed_source_id {fsid} in the last '
              f'{a.days_back} days. Refusing to report 0% coverage as a '
              f'measurement — an empty set is not a finding about this book.')
        return 1
    print(f'kibl_line_observations (feed_source_id={fsid}, {a.days_back}d): '
          f'{len(obs)} rows over '
          f'{len({o["fixture_id"] for o in obs})} fixtures')

    by_fixture = collections.defaultdict(list)
    for o in obs:
        by_fixture[o['fixture_id']].append(o)

    # Sports411 history, for (g) only. Read separately and never merged.
    s411, _e = K.fetch_all(url, key, 'kibl_line_observations', K.OBS_COLUMNS,
                           f'&feed_source_id=eq.{SPORTS411_ID}',
                           order='fixture_id.asc,inserted_on.asc')
    s411_by_fixture = collections.defaultdict(list)
    for o in (s411 or []):
        s411_by_fixture[o['fixture_id']].append(o)
    print(f'Sports411 history (feed_source_id={SPORTS411_ID}): '
          f'{len(s411 or [])} rows — a CLOSED set, no longer entitled')

    report = {'generatedAt': K.iso(as_of), 'feedSourceId': fsid,
              'book': entitled[fsid], 'daysBack': a.days_back,
              'rows': len(obs), 'sports411HistoryRows': len(s411 or [])}

    report['a_coverage'] = section_a(fx, by_fixture, fsid)
    report['b_markets'] = section_b(obs, client, fsid)
    section_cde(obs)

    # ── (f) SIDE MAPPING — the shipped gate, driven on this book's rows ──────
    print('\n=== (f) SIDE MAPPING — the same bar as Sports411, re-run for this '
          'book ===')
    print('    DIRECTION ONLY. Which player each source makes the favourite. '
          'Never price levels:\n    Bet105 is sharp and the comparators are '
          'soft, so margins WILL differ and that is expected.')
    ofx, e1 = K.fetch_all(url, key, 'oddspapi_fixtures',
                          'fixture_id,player1,player2,scheduled_start,'
                          'true_start,category_name')
    osum, e2 = K.fetch_all(url, key, 'oddspapi_line_summary',
                           'fixture_id,market,side,open_price,open_ts,'
                           'close_price,start_ts,start_ts_source,'
                           'start_reject_reason,flip_gap_seconds',
                           f'&market=eq.{urllib.parse.quote(K.MARKET)}')
    if e1 or e2:
        print(f'::error::oddspapi read failed ({e1 or e2}) — the gate has no '
              f'independent arm and CANNOT pass. Not reported as a pass.')
        return 1
    odds_index, _ist = K.index_oddspapi(ofx, osum)
    rows, st, _unknown, side_shapes = K.build_rows(fx, by_fixture, odds_index,
                                                   as_of, None, False)
    print(f'side_id shapes per priced fixture: {dict(side_shapes)}')
    print(f'card-shaped rows built (NOT written anywhere): {len(rows)}')

    # load_matches() returns (matches, error). Passing the TUPLE crashed the
    # first live run inside board_favourites — and the failure was loud, which
    # is the only reason it is a footnote: a silently-empty board arm would have
    # produced a gate that reported "0 paired" as a finding about Bet105.
    matches, merr = K.load_matches()
    if merr:
        print(f'::warning::the board file is unreadable ({merr}) — the board '
              f'arm of the gate is ABSENT. The api-tennis arm may still referee; '
              f'if neither does, (f) reports 0 paired and CANNOT pass.')
    ids = K.participant_ids_by_fixture(by_fixture)
    gate, dashed = K.run_orientation(rows, fx, odds_index, matches, ids,
                                     os.environ.get('API_TENNIS_KEY'))
    sg = gate.get('shipGate') or {}
    # The criteria, their thresholds and the verdict all come from ship_gate
    # itself rather than being restated here. A gate script that re-derives the
    # bar can pass a rule the shipped code does not apply, which is the one
    # thing a gate must never do.
    for name, c in sorted((sg.get('criteria') or {}).items()):
        print(f"  {name:<28} required {c['required']:<6} actual "
              f"{c['actual']:<6} {'PASS' if c['pass'] else 'FAIL'}")
    lop, near = sg.get('lopsided') or {}, sg.get('nearEven') or {}
    print(f"  lopsided  n={lop.get('n', 0)} agree={lop.get('agree', 0)} "
          f"disagree={lop.get('disagree', 0)}  [BLOCKING]")
    print(f"  near-even n={near.get('n', 0)} agree={near.get('agree', 0)} "
          f"disagree={near.get('disagree', 0)}  [noted, not blocking]")
    K.print_evidence(sg)
    for d in lop.get('disagreements') or []:
        print(f"::error::LOPSIDED disagreement on {d['match_key']} "
              f"({d['kibl']['fixture']}) — this stops the ship. "
              f"kibl={d['kibl']['prices']} independent={d['independent']}")
    passed = bool(sg.get('passes'))
    report['f_sideMapping'] = gate
    report['f_passed'] = passed
    out('side_mapping_paired', (sg.get('criteria', {})
                                  .get('2a_fixtures_both_sources', {})
                                  .get('actual', 0)))
    out('side_mapping_lopsided', lop.get('n', 0))
    out('side_mapping_lopsided_disagree', lop.get('disagree', 'dash'))
    out('side_mapping_passed', 'yes' if passed else 'no')
    print(f"\n  (f) {'PASSES' if passed else 'DOES NOT PASS'} — "
          + ('the founder rules on whether Bet105 renders.'
             if passed else 'nothing renders. Reported, not worked around.'))
    if dashed:
        print(f'  {len(dashed)} match key(s) would be dashed by the permanent '
              f'orientation guard: {sorted(dashed)[:5]}')

    report['g_openingTimes'] = section_g(fx, by_fixture, s411_by_fixture, url, key)

    with open(os.path.join(HERE, 'ten232-bet105-gate.json'), 'w',
              encoding='utf-8') as fh:
        json.dump(report, fh, indent=2, sort_keys=True, default=str)
    print('\nwrote ten232-bet105-gate.json (a report artifact — no card, no '
          'ladder, no published price changed)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
