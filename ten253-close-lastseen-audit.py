#!/usr/bin/env python3
"""TEN-253 Fix 1 step 1 — the BEFORE picture for the Close-rule change.

READ-ONLY. Issues nothing but PostgREST GETs. Writes no table, no bucket, no
file outside the workflow artifact. Founder 2026-09-23: "run the read-only
last_seen_at query on the 179 fixtures and record the baseline ... This is the
before picture."

WHAT IT ANSWERS. The Close rule currently selects and times a close on
`inserted_on` — Kibl's own row-write clock. The proposal is to use
`last_seen_at` — OUR sweep clock, bumped only when a sweep re-received that
exact row. For every started fixture that currently has NO close, this reports
both clocks against the actual start, so the recovery is a measurement and not
an estimate.

⚠️ IT IDENTIFIES THE POPULATION FROM THE DATABASE, NOT FROM A PUBLISHED FILE.
The published odds-card-state.json is a projection that can be stale or
half-written; counting off it would measure the publisher, not the archive.
"""
import collections
import json
import os
import statistics
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

PAGE = 1000
MIN_REAL_PRICE = 1.01          # the founder's render floor; a 0.000 is a suspension marker
RELIABLE_LAG_MIN = 60.0        # the limit under test


def creds():
    url = (os.environ.get('SUPABASE_URL') or '').rstrip('/')
    key = os.environ.get('SUPABASE_SECRET_KEY') or ''
    if not url or not key:
        print('::error::SUPABASE_URL / SUPABASE_SECRET_KEY are not both set.')
        sys.exit(1)
    return url, key


def get(url, key, path):
    """One PostgREST GET. Returns a parsed list, or exits — never a silent []."""
    req = urllib.request.Request(url + path)
    req.add_header('apikey', key)
    req.add_header('Authorization', 'Bearer ' + key)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            body = r.read()
    except Exception as e:                      # noqa: BLE001
        detail = ''
        try:
            detail = e.read().decode('utf-8', 'replace')[:300]
        except Exception:                        # noqa: BLE001
            detail = str(e)[:300]
        print(f'::error::GET failed: {detail}')
        sys.exit(1)
    out = json.loads(body.decode('utf-8'))
    if not isinstance(out, list):
        print(f'::error::expected a JSON list, got {type(out).__name__}')
        sys.exit(1)
    return out


def paged(url, key, path):
    """Every row. PostgREST caps a page at 1,000 and truncates SILENTLY."""
    out, off = [], 0
    while True:
        sep = '&' if '?' in path else '?'
        rows = get(url, key, f'{path}{sep}limit={PAGE}&offset={off}')
        out.extend(rows)
        if len(rows) < PAGE:
            return out
        off += PAGE


def epoch(ts):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace('Z', '+00:00')).timestamp()
    except (ValueError, TypeError):
        return None


def real(v):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f >= MIN_REAL_PRICE else None


def pct(n, d):
    return '—' if not d else f'{100.0 * n / d:.1f}%'


def seen_at(o):
    """When we last saw this row STILL LISTED. Falls back to its first sighting.

    `last_seen_at` is OUR sweep clock, bumped by archive-kibl's PASS 2 only for
    rows that sweep actually received back from Kibl. The fallback to
    `observed_at` is for rows written before that column existed, where
    observed_at IS the last time we saw them — the truthful value, not a filler.
    """
    return (epoch(o.get('last_seen_at')) or epoch(o.get('observed_at'))
            or epoch(o.get('inserted_on')))


def close_arms(obs_list, start):
    """The three candidate Closes for one fixture. -> {arm: (row|None, lag|None)}

    OLD     last real price whose `inserted_on` precedes the start — what ships
            today, and what throws away a price that was still listed at the off
            merely because it was first written hours earlier.
    STRICT  last real price whose last-seen precedes the start. Wrong, and kept
            only to show why: it DISCARDS the straddlers, which are the best
            closes there are.
    CAPPED  the founder's rule. Eligible = the price existed before the off
            (`inserted_on < start`); its effective close time is
            min(last_seen, start). A price listed before AND after the off was
            the price standing AT the off, so it scores lag 0.

    The pre-start test stays on `inserted_on` in the capped arm so a price that
    did not exist before the off can never be capped down into contention.
    """
    def lag(t):
        return None if t is None else (start - t) / 60.0

    real_rows = [o for o in obs_list if real(o.get('price_decimal')) is not None]

    old = [o for o in real_rows
           if epoch(o.get('inserted_on')) is not None and epoch(o['inserted_on']) < start]
    strict = [o for o in real_rows if seen_at(o) is not None and seen_at(o) < start]
    capped = [o for o in real_rows
              if epoch(o.get('inserted_on')) is not None and epoch(o['inserted_on']) < start]

    ob = max(old, key=lambda o: epoch(o['inserted_on'])) if old else None
    sb = max(strict, key=seen_at) if strict else None
    # Ties on the capped clock break on the later insert — the fresher price.
    cb = (max(capped, key=lambda o: (min(seen_at(o), start), epoch(o['inserted_on'])))
          if capped else None)
    return {
        'old': (ob, lag(epoch(ob['inserted_on'])) if ob else None),
        'strict': (sb, lag(seen_at(sb)) if sb else None),
        'capped': (cb, lag(min(seen_at(cb), start)) if cb else None),
    }



def forensic(obs, kibl, obs_by, print_=print):
    """THE STEP-4 SAFETY GATE, MEASURED RATHER THAN ARGUED.

    Founder 2026-09-23: "Check that `last_seen_at` is bumped only when the price
    was genuinely seen still listed in a sweep, and never by something that would
    make an old price look recent. If there's any doubt, stop and report."

    96.8% of the population scoring a capped lag of exactly 0 IS that doubt. Two
    readings fit that number and they have opposite consequences:

      A. TRUE RE-SIGHTING. Kibl served the same row again because the price was
         still standing. Then a price listed before AND after the off was the
         price at the off, capped lag 0 is correct, and Fix 1 recovers real
         closes.

      B. VACUOUS RE-SERVE. Kibl replays its whole history every sweep, so every
         row's last_seen tracks the sweep clock regardless of whether the price
         still stands. Then `last_seen_at` carries no information, every pre-off
         row caps to the start, and the capped rule degenerates to "last row
         inserted before the off" — the SAME PRICE THE OLD RULE PICKS — with the
         60-minute reliability gate silently switched off. That is not a
         recovery. That is 154 closes admitted by disabling the guard.

    The discriminators, in order of how hard they are to argue with:

      1. SAME-ROW RATE. If old and capped select the same observation almost
         always, Fix 1 changes no price and only moves the gate. This is the
         one that decides A vs B, so it is computed per (fixture, side) — the
         grain the real rule runs at — not per fixture.
      2. ROW LIFETIME. last_seen - inserted_on across every observation. Under B
         it is uniformly large. Under A it varies, and a substantial share of
         rows are never re-seen at all (lifetime 0) because the price moved.
      3. DISTINCT last_seen PER FIXTURE. Under B every row shares the sweep
         clock, so the count collapses toward 1.
      4. is_current ON ROWS RE-SEEN AFTER THE OFF. A row Kibl itself no longer
         marks current, still being re-seen, is the signature of a replay.
    """
    print_('')
    print_('=' * 72)
    print_('STEP-4 SAFETY GATE — is `last_seen_at` a re-sighting or a re-serve?')
    print_('=' * 72)

    # ── 2 · row lifetime, over every observation we hold ────────────────────
    lifetimes, never = [], 0
    for o in obs:
        a, b = epoch(o.get('inserted_on')), seen_at(o)
        if a is None or b is None:
            continue
        mins = (b - a) / 60.0
        lifetimes.append(mins)
        if mins < 0.5:
            never += 1
    if lifetimes:
        v = sorted(lifetimes)
        n = len(v)
        print_(f'\nROW LIFETIME (last_seen - inserted_on), all {n} observations:')
        print_(f'  median {statistics.median(v):.1f} min, p25 {v[int(0.25*(n-1))]:.1f}, '
               f'p75 {v[int(0.75*(n-1))]:.1f}, max {v[-1]:.1f}')
        print_(f'  NEVER RE-SEEN (lifetime < 30s): {never} of {n}  ({pct(never, n)})')
        print_('  ^ under a vacuous re-serve this would be ~0% and the median huge.')

    # ── 3 · distinct last_seen values per fixture ───────────────────────────
    ds = []
    for fid, lst in obs_by.items():
        ds.append(len({o.get('last_seen_at') for o in lst}))
    if ds:
        v = sorted(ds)
        print_(f'\nDISTINCT last_seen VALUES PER FIXTURE: median {statistics.median(v)}, '
               f'min {v[0]}, max {v[-1]}')
        one = sum(1 for x in ds if x == 1)
        print_(f'  fixtures where EVERY row shares ONE last_seen: {one} of {len(ds)} '
               f'({pct(one, len(ds))})')
        print_('  ^ a high share here is the re-serve signature.')

    # ── 1 · THE DECIDER: does Fix 1 pick a different PRICE, or just relabel? ─
    same_row = diff_row = 0
    same_price_diff_gate = 0
    examples = []
    for (fid, src, book), cardrows in sorted(kibl.items()):
        start = epoch(cardrows[0].get('start_ts'))
        if start is None:
            continue
        per_side = collections.defaultdict(list)
        for o in obs_by.get(str(fid), []):
            per_side[o.get('side_id')].append(o)
        for sid, lst in per_side.items():
            arms = close_arms(lst, start)
            ob, ol = arms['old']
            cb, nl = arms['capped']
            if ob is None or cb is None:
                continue
            ident = (ob.get('inserted_on') == cb.get('inserted_on')
                     and str(ob.get('price_decimal')) == str(cb.get('price_decimal')))
            if ident:
                same_row += 1
                if (ol is not None and nl is not None
                        and ol > RELIABLE_LAG_MIN >= nl):
                    same_price_diff_gate += 1
            else:
                diff_row += 1
                if len(examples) < 5:
                    examples.append((fid, sid, ob.get('price_decimal'), ol,
                                     cb.get('price_decimal'), nl))
    tot = same_row + diff_row
    print_(f'\nTHE DECIDER — per (fixture, side), n={tot}:')
    print_(f'  Fix 1 selects the SAME observation as the old rule: {same_row}  ({pct(same_row, tot)})')
    print_(f'  Fix 1 selects a DIFFERENT observation             : {diff_row}  ({pct(diff_row, tot)})')
    print_(f'  SAME price, but old FAILED the {RELIABLE_LAG_MIN:g}-min gate and new PASSES: '
           f'{same_price_diff_gate}  ({pct(same_price_diff_gate, tot)})')
    print_('  ^ THIS LAST NUMBER IS THE HONEST COST OF FIX 1. Every one of these is a')
    print_('    close recovered by re-timing a price, not by finding a better one.')
    if examples:
        print_('\n  sides where the SELECTED PRICE genuinely changes:')
        for fid, sid, op, ol, npx, nl in examples:
            print_(f'    fixture {fid} side {sid}: old {op} @ {ol:.1f} min  ->  '
                   f'new {npx} @ {nl:.1f} min')

    # ── 4 · is_current on rows re-seen after the off ────────────────────────
    after_off_cur = after_off_not = 0
    for (fid, src, book), cardrows in sorted(kibl.items()):
        start = epoch(cardrows[0].get('start_ts'))
        if start is None:
            continue
        for o in obs_by.get(str(fid), []):
            sa = seen_at(o)
            if sa is not None and sa > start:
                if o.get('is_current'):
                    after_off_cur += 1
                else:
                    after_off_not += 1
    # ── 5 · THE STATE OF THE ROW FIX 1 ACTUALLY SELECTS ────────────────────
    # is_current is one of the 17 fields in observation_key (kibl_client.py:461)
    # and PASS 2 refreshes only last_seen_at, so a current -> not-current flip
    # MINTS A NEW ROW rather than mutating the old one. A re-seen not-current row
    # is therefore Kibl genuinely still listing it — most often the OPENER, which
    # Kibl keeps for the life of the fixture and which will straddle every off.
    #
    # That is the one way the cap could go wrong: if an opener, still listed at
    # the off, were selected as the close, we would be reporting the OPENING
    # price as the CLOSING price at lag 0. The tie-break on inserted_on should
    # make that impossible, because the opener is by construction the earliest
    # insert. This counts it rather than trusting the argument.
    sel_state = collections.Counter()
    sel_2x2 = collections.Counter()
    sel_opener = 0
    for (fid, src, book), cardrows in sorted(kibl.items()):
        start = epoch(cardrows[0].get('start_ts'))
        if start is None:
            continue
        per_side = collections.defaultdict(list)
        for o in obs_by.get(str(fid), []):
            per_side[o.get('side_id')].append(o)
        for sid, lst in per_side.items():
            cb = close_arms(lst, start)['capped'][0]
            if cb is None:
                continue
            sel_state[cb.get('state') or 'null'] += 1
            if cb.get('is_opener'):
                sel_opener += 1
            # ⚠️ `state` CANNOT ANSWER THIS. state_of() tests is_opener FIRST, so
            # a row flagged BOTH opener and current is labelled "opener" — and a
            # price that opened and never moved is exactly that. Those are valid
            # closes: the opening price WAS the price standing at the off. Only
            # the 2x2 separates them from a genuinely superseded opener.
            sel_2x2[(bool(cb.get('is_opener')), bool(cb.get('is_current')))] += 1
    tsel = sum(sel_state.values())
    print_(f'\nSTATE OF THE ROW FIX 1 SELECTS AS THE CLOSE, n={tsel}:')
    for k, v in sel_state.most_common():
        print_(f'  {k:<12} {v:>5}  ({pct(v, tsel)})')
    print_(f'  is_opener TRUE on the selected close: {sel_opener}  ({pct(sel_opener, tsel)})')
    print_(f'\n  THE 2x2 THAT ACTUALLY DECIDES IT (is_opener, is_current):')
    for (op, cur), v in sorted(sel_2x2.items(), key=lambda kv: -kv[1]):
        verdict = {
            (True, True): 'OK  — opened and never moved; the opener IS the standing price',
            (False, True): 'OK  — a normal current price',
            (True, False): 'BAD — a SUPERSEDED opener selected as the close',
            (False, False): '??  — neither opener nor current',
        }[(op, cur)]
        print_(f'    is_opener={str(op):<5} is_current={str(cur):<5} {v:>5}  ({pct(v, tsel)})  {verdict}')
    bad = sel_2x2[(True, False)]
    print_(f'\n  SUPERSEDED OPENERS SELECTED AS A CLOSE: {bad} of {tsel}  ({pct(bad, tsel)})')
    print_('  ^ THIS is the number that must be ~0, not the raw opener count.')

    tot2 = after_off_cur + after_off_not
    print_(f'\nROWS RE-SEEN AFTER THE OFF, by Kibl\'s OWN is_current flag, n={tot2}:')
    print_(f'  is_current TRUE : {after_off_cur}  ({pct(after_off_cur, tot2)})')
    print_(f'  is_current FALSE: {after_off_not}  ({pct(after_off_not, tot2)})'
           '   <-- NOT a mutated stale row: is_current is in the row key,\n'
           '                       so a current->not-current flip mints a NEW row')
    return {'selectedState': dict(sel_state), 'selectedIsOpener': sel_opener,
            'selected2x2': {f'opener={k[0]},current={k[1]}': v for k, v in sel_2x2.items()},
            'supersededOpenerSelected': sel_2x2[(True, False)],
            'sameRow': same_row, 'diffRow': diff_row,
            'sameRowGateFlip': same_price_diff_gate,
            'neverReseen': never, 'observations': len(lifetimes),
            'afterOffIsCurrent': after_off_cur, 'afterOffNotCurrent': after_off_not}


def main():
    url, key = creds()

    # ── the population: started fixtures whose card currently has NO close ──
    cards = paged(url, key,
                  '/rest/v1/odds_card_state?select=fixture_id,match_key,book,source,'
                  'side,close_price,close_ts,open_price,start_ts,start_ts_source'
                  '&market=eq.match%20winner&start_ts=not.is.null'
                  '&order=match_key.asc,fixture_id.asc,side.asc')
    print(f'odds_card_state rows with a resolved start: {len(cards)}')

    byfx = collections.defaultdict(list)
    for c in cards:
        byfx[(c['fixture_id'], c.get('source'), c.get('book'))].append(c)

    noclose = {k: v for k, v in byfx.items()
               if not all(r.get('close_price') is not None for r in v)}
    kibl = {k: v for k, v in noclose.items() if k[1] == 'kibl'}
    print(f'fixtures (fixture_id x book) with a start and NO close: {len(noclose)}')
    print(f'  of which source=kibl: {len(kibl)}   '
          f'(the population this fix targets)')
    if not kibl:
        print('::warning::no kibl no-close fixtures found — nothing to measure. '
              'This is a FINDING, not a pass.')
        return 0

    # ── the two clocks, per fixture, from the archive itself ────────────────
    fids = sorted({k[0] for k in kibl})
    print(f'reading kibl_line_observations for {len(fids)} fixture(s)…')
    obs = []
    for i in range(0, len(fids), 100):
        ids = ','.join(urllib.parse.quote(str(f)) for f in fids[i:i + 100])
        obs.extend(paged(url, key,
                         '/rest/v1/kibl_line_observations?select=fixture_id,side_id,'
                         'price_decimal,inserted_on,observed_at,last_seen_at,'
                         'market_type_id,feed_source_id,is_current,is_opener,state'
                         f'&fixture_id=in.({ids})&market_type_id=eq.1'
                         '&order=fixture_id.asc,inserted_on.asc'))
    print(f'observations read: {len(obs)}')

    obs_by = collections.defaultdict(list)
    for o in obs:
        obs_by[str(o['fixture_id'])].append(o)

    rows = []
    no_obs = 0
    for (fid, src, book), cardrows in sorted(kibl.items()):
        start = epoch(cardrows[0].get('start_ts'))
        lst = obs_by.get(str(fid), [])
        if not lst:
            no_obs += 1
            continue
        arms = close_arms(lst, start)
        old_best, old_lag = arms['old']
        strict_best, strict_lag = arms['strict']
        capped_best, new_lag = arms['capped']
        rows.append({
            'fixture_id': fid, 'book': book, 'n_obs': len(lst),
            'inserted_on': old_best['inserted_on'] if old_best else None,
            'last_seen_at': (capped_best.get('last_seen_at') or capped_best.get('observed_at'))
                            if capped_best else None,
            'start_ts': cardrows[0].get('start_ts'),
            'start_src': cardrows[0].get('start_ts_source'),
            'old_lag_min': None if old_lag is None else round(old_lag, 1),
            'strict_lag_min': None if strict_lag is None else round(strict_lag, 1),
            'new_lag_min': None if new_lag is None else round(new_lag, 1),
        })

    print()
    print(f'fixtures with a start, no close, and at least one observation: {len(rows)}')
    print(f'fixtures with a start, no close, and NO observation at all: {no_obs}  '
          f'(these can never recover a close from this book)')

    def dist(vals, label):
        if not vals:
            print(f'  {label}: — (no values)')
            return
        v = sorted(vals)
        n = len(v)
        flag = '  <-- n<30' if n < 30 else ''
        print(f'  {label}: n={n}{flag}  median {statistics.median(v):.1f} min, '
              f'p25 {v[int(0.25*(n-1))]:.1f}, p75 {v[int(0.75*(n-1))]:.1f}, '
              f'min {v[0]:.1f}, max {v[-1]:.1f}')

    old_lags = [r['old_lag_min'] for r in rows if r['old_lag_min'] is not None]
    strict_lags = [r['strict_lag_min'] for r in rows if r['strict_lag_min'] is not None]
    new_lags = [r['new_lag_min'] for r in rows if r['new_lag_min'] is not None]
    print()
    print('GAP TO THE ACTUAL START, in minutes (lower is better):')
    dist(old_lags, 'OLD    — start minus inserted_on          ')
    dist(strict_lags, 'STRICT — start minus last_seen (uncapped)')
    dist(new_lags, 'NEW    — start minus min(last_seen, start)')

    old_ok = sum(1 for x in old_lags if x <= RELIABLE_LAG_MIN)
    strict_ok = sum(1 for x in strict_lags if x <= RELIABLE_LAG_MIN)
    new_ok = sum(1 for x in new_lags if x <= RELIABLE_LAG_MIN)
    d = len(rows)
    print()
    print(f'WITHIN THE {RELIABLE_LAG_MIN:g}-MINUTE LIMIT — the recovery number:')
    print(f'  OLD    inserted_on            : {old_ok} of {d}  ({pct(old_ok, d)})')
    print(f'  STRICT last_seen, uncapped    : {strict_ok} of {d}  ({pct(strict_ok, d)})')
    print(f'  NEW    min(last_seen, start)  : {new_ok} of {d}  ({pct(new_ok, d)})')
    print(f'  RECOVERED by Fix 1 as briefed : {new_ok - old_ok} of {d}  ({pct(new_ok - old_ok, d)})')
    # ⚠️ TWO DIFFERENT NUMBERS, AND THE FIRST VERSION OF THIS PRINT CONFLATED
    # THEM. `all_post` is the fixtures where EVERY price was last seen after the
    # off, so strict finds nothing at all. `straddle` is the fixtures where a
    # price was still listed AT the off — a much larger set, because a fixture
    # can hold both straddling and expired rows and strict still finds one.
    all_post = sum(1 for r in rows
                   if r['new_lag_min'] is not None and r['strict_lag_min'] is None)
    straddle = sum(1 for r in rows if r['new_lag_min'] == 0.0)
    print(f'  a price was STILL LISTED at the off (capped lag 0): {straddle} of {d}'
          f'  ({pct(straddle, d)})')
    print(f'  ...of which strict finds NO candidate whatsoever: {all_post}'
          f'  — every price on these was last seen after the off')
    # n counts, so a distribution is never read as if it covered every fixture.
    print(f'  fixtures with no candidate at all: old {d - len(old_lags)}, '
          f'strict {d - len(strict_lags)}, new {d - len(new_lags)}')

    same = sum(1 for r in rows
               if r['old_lag_min'] is not None and r['new_lag_min'] is not None
               and abs(r['old_lag_min'] - r['new_lag_min']) < 0.5)
    print()
    print(f'fixtures where the two clocks AGREE within 30s: {same} of {d} ({pct(same, d)})')
    print('  (i.e. the price was never re-seen after it was first written — for these,')
    print('   Fix 1 changes nothing and only the book switch can help)')

    print()
    print('SAMPLE — 10 fixtures, both clocks:')

    def lag(v):
        """A lag in minutes, or an em dash. Never a zero standing in for absent."""
        return '—' if v is None else f'{v:.1f}'

    print(f"  {'fixture':<14}{'book':<11}{'obs':>4}{'old':>10}{'strict':>10}{'NEW':>10}  start_src")
    for r in rows[:10]:
        print(f"  {str(r['fixture_id']):<14}{str(r['book']):<11}{r['n_obs']:>4}"
              f"{lag(r['old_lag_min']):>10}{lag(r['strict_lag_min']):>10}{lag(r['new_lag_min']):>10}  {r['start_src']}")

    fx = forensic(obs, kibl, obs_by)

    out = os.environ.get('TEN253_OUT', 'ten253-close-lastseen-audit.json')
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump({'generatedAt': datetime.now(timezone.utc).isoformat(),
                   'population': {'noCloseWithStart': len(noclose),
                                  'kibl': len(kibl), 'measured': len(rows),
                                  'noObservation': no_obs},
                   'within60': {'old': old_ok, 'strict': strict_ok, 'new': new_ok,
                                'recovered': new_ok - old_ok, 'denominator': d},
                   'forensic': fx,
                   'rows': rows}, fh, indent=1)
    print(f'\nwrote {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
