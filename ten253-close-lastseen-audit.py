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
                         'market_type_id,feed_source_id'
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
        # The OLD rule: last real price whose inserted_on precedes the start.
        old = [o for o in lst if real(o.get('price_decimal')) is not None
               and epoch(o.get('inserted_on')) is not None
               and epoch(o['inserted_on']) < start]
        # The NEW rule, STRICT: last real price whose last-seen precedes the start.
        strict = [o for o in lst if real(o.get('price_decimal')) is not None
                  and epoch(o.get('last_seen_at') or o.get('observed_at')) is not None
                  and epoch(o.get('last_seen_at') or o.get('observed_at')) < start]

        # ⚠️ THE NEW RULE AS THE FOUNDER WROTE IT — "using last_seen_at, CAPPED
        # AT THE ACTUAL START". The cap is the whole point and the strict form
        # above gets it wrong: a price first listed BEFORE the off and still
        # listed AFTER it was, by definition, the price standing AT the off —
        # the best possible close. Strict discards it because its last-seen is
        # on the wrong side of the line. Capped scores it at lag 0.
        #
        # The pre-start test stays on `inserted_on`, so a price that did not
        # exist before the off can never be capped down into contention.
        capped = [o for o in lst if real(o.get('price_decimal')) is not None
                  and epoch(o.get('inserted_on')) is not None
                  and epoch(o['inserted_on']) < start]

        def seen(o):
            return epoch(o.get('last_seen_at') or o.get('observed_at')) or epoch(o['inserted_on'])

        def eff(o):
            return min(seen(o), start)

        old_best = max(old, key=lambda o: epoch(o['inserted_on'])) if old else None
        strict_best = max(strict, key=seen) if strict else None
        capped_best = max(capped, key=lambda o: (eff(o), epoch(o['inserted_on']))) if capped else None
        old_lag = ((start - epoch(old_best['inserted_on'])) / 60.0) if old_best else None
        strict_lag = ((start - seen(strict_best)) / 60.0) if strict_best else None
        new_lag = ((start - eff(capped_best)) / 60.0) if capped_best else None
        rows.append({
            'fixture_id': fid, 'book': book, 'n_obs': len(lst),
            'inserted_on': old_best['inserted_on'] if old_best else None,
            'last_seen_at': (new_best.get('last_seen_at') or new_best.get('observed_at'))
                            if new_best else None,
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
    straddle = sum(1 for r in rows
                   if r['new_lag_min'] is not None and r['strict_lag_min'] is None)
    print(f'  of which STRADDLE the off (listed before AND after): {straddle}'
          f'  — these are lag 0 under the cap and are DISCARDED without it')
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

    out = os.environ.get('TEN253_OUT', 'ten253-close-lastseen-audit.json')
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump({'generatedAt': datetime.now(timezone.utc).isoformat(),
                   'population': {'noCloseWithStart': len(noclose),
                                  'kibl': len(kibl), 'measured': len(rows),
                                  'noObservation': no_obs},
                   'within60': {'old': old_ok, 'strict': strict_ok, 'new': new_ok,
                                'recovered': new_ok - old_ok, 'denominator': d},
                   'rows': rows}, fh, indent=1)
    print(f'\nwrote {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
