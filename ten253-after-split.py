#!/usr/bin/env python3
"""TEN-253 — the AFTER picture for the 185, on the SAME 185.

READ-ONLY: PostgREST GETs only. Founder 2026-09-23 06:23Z: "The 185:
within-60 Close + older last-seen Close (with an age distribution) + still
dashed = 185, split by fix: guarded Fix 1, the switch, Oddspapi history."

The population is PINNED (ten253-population-185.json, from audit run
35827198225) rather than re-derived, because after the fix the set of cards
with no close is a different set — re-deriving it would measure the survivors
and call it the whole.

For each (fixture, book) it reads the match's rows across EVERY book and
reports what the SELECTED card now carries:
  fix1_within60 / fix1_older   same book, recovered by Fix 1
  switch_within60 / switch_older  another book's close, via the switch
  dash_<reason>                 still no close, and why
"""
import collections
import json
import os
import statistics
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location('A', os.path.join(HERE, 'ten253-close-lastseen-audit.py'))
A = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(A)


def pct(n, d):
    return '—' if not d else f'{100.0 * n / d:.1f}%'


def classify(pop, rows_by_mkey, mkey_of):
    """Pure: -> (per-fixture list, Counter). Drives the report and the test."""
    out, tally = [], collections.Counter()
    for p in pop:
        fid, book = str(p['fixture_id']), p['book']
        mkey = mkey_of.get((fid, book))
        if not mkey:
            cls = 'dash_card_row_gone'
            out.append({**p, 'after': cls}); tally[cls] += 1
            continue
        rows = rows_by_mkey.get(mkey, [])
        sel = [r for r in rows if r.get('is_selected')]
        books = {r.get('book') for r in sel}
        if len(books) > 1:
            cls = 'MIXED_BOOKS'
        elif not sel:
            cls = 'dash_nothing_selected'
        else:
            sb = next(iter(books))
            both = len(sel) == 2 and all(r.get('close_price') is not None for r in sel)
            if not both:
                any_close = any(r.get('close_price') is not None for r in rows)
                cls = ('dash_no_book_had_a_close' if not any_close
                       else 'dash_one_sided_or_unselected_close')
            else:
                w60 = all(r.get('close_within_60') is True for r in sel)
                cls = (('fix1_' if sb == book else 'switch_')
                       + ('within60' if w60 else 'older'))
                if not w60:
                    st_ = A.epoch(sel[0].get('start_ts'))
                    ages = [(st_ - A.epoch(r['close_ts'])) / 60.0 for r in sel
                            if st_ is not None and A.epoch(r.get('close_ts')) is not None]
                    p = {**p, 'older_age_min': round(max(ages), 1) if ages else None}
                p = {**p, 'selected_book': sb}
        out.append({**p, 'after': cls})
        tally[cls] += 1
    return out, tally


def main():
    url, key = A.creds()
    pop = json.load(open(os.path.join(HERE, 'ten253-population-185.json')))['population']
    fids = sorted({str(p['fixture_id']) for p in pop})
    mkey_of = {}
    for i in range(0, len(fids), 100):
        ids = ','.join(urllib.parse.quote(f) for f in fids[i:i + 100])
        for r in A.paged(url, key, '/rest/v1/odds_card_state?select=fixture_id,book,match_key'
                         f'&market=eq.match%20winner&id_space=eq.kibl&fixture_id=in.({ids})'):
            mkey_of[(str(r['fixture_id']), r['book'])] = r.get('match_key')
    mkeys = sorted({v for v in mkey_of.values() if v})
    rows_by_mkey = collections.defaultdict(list)
    for i in range(0, len(mkeys), 60):
        ks = ','.join('"' + k.replace('"', '') + '"' for k in mkeys[i:i + 60])
        for r in A.paged(url, key, '/rest/v1/odds_card_state?select=match_key,book,side,'
                         'is_selected,close_price,close_ts,close_within_60,start_ts'
                         f'&market=eq.match%20winner&match_key=in.({urllib.parse.quote(ks)})'):
            rows_by_mkey[r['match_key']].append(r)
    per, tally = classify(pop, rows_by_mkey, mkey_of)
    d = len(pop)
    print(f'## TEN-253 — the 185 AFTER Fix 1 + the switch (population pinned from run 35827198225), n={d}')
    for k in sorted(tally):
        print(f'  {k:<38} {tally[k]:>4}  ({pct(tally[k], d)})')
    print(f'  SUM {sum(tally.values())} (must equal {d})')
    by = collections.Counter((p['book'], p['after']) for p in per)
    print('\n  by the card\'s ORIGINAL book:')
    for k in sorted(by):
        print(f'    {k[0]:<10} {k[1]:<38} {by[k]}')
    sw = collections.Counter(f"{p['book']}->{p.get('selected_book')}" for p in per
                             if p['after'].startswith('switch_'))
    print(f'\n  switches, from -> to: {dict(sw)}')
    ages = sorted(p['older_age_min'] for p in per if p.get('older_age_min') is not None)
    if ages:
        n = len(ages)
        print(f'\n  OLDER-close age, min before the off (worse side): n={n}'
              f'{"  <-- n<30" if n < 30 else ""}  median {statistics.median(ages):.1f}, '
              f'p25 {ages[int(0.25*(n-1))]:.1f}, p75 {ages[int(0.75*(n-1))]:.1f}, max {ages[-1]:.1f}')
    json.dump({'tally': dict(tally), 'perFixture': per},
              open(os.environ.get('TEN253_SPLIT_OUT', 'ten253-after-split.json'), 'w'), indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
