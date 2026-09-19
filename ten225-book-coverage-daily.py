#!/usr/bin/env python3
"""TEN-225 item 2 — DAILY per-book coverage on api-tennis, with the rule-out built in.

FOUNDER, 2026-09-19: "THE COVERAGE COLLAPSE IS NOW THE PRIORITY. bet365 at 6 of
115 today against 191 on 09-08 explains most of our empty cards. ... Meanwhile
report: is the collapse in the payload only, or does it track something we
changed (endpoint, parameters, the bulk-by-date switch)? Rule us out before
blaming them. Report coverage daily from now on, per book, so we see it recover
or worsen without me asking."

Separate from `ten225-book-coverage.py`, which answers item H — coverage by
LEVEL over a fixed window, run on demand. This one is the daily time series and
the standing rule-out, and it appends to a committed ledger so the trend accrues
whether or not anyone reads a log.

TWO JOBS, ONE SCRIPT, DELIBERATELY:

1. COVERAGE. Per book, the share of priced fixtures where that book quotes BOTH
   sides — a one-sided quote cannot make a card, so counting it would overstate
   what a member can actually see.

2. THE RULE-OUT, RUN EVERY DAY AND NOT ONCE. "Is it them or us" is not settled
   by a single investigation; our call shape can change again. So every run
   re-asks it, on the same fixtures, in the same minute:

     - bulk-by-date  get_odds&date_start=D&date_stop=D   (what we ship today)
     - per-match     get_odds&match_key=K                (what we shipped before 64c7237a)

   If the two disagree about which books exist for one fixture, the call shape
   is implicated and this run says so in an ::error::. If they agree, our switch
   is exonerated for that day by measurement rather than by argument.

⚠️ THE CONTROL COSTS REQUESTS, so it runs on a SAMPLE (default 5 fixtures).
api-tennis is 2M/day on Ultra so this is free in practice, but a per-match call
per fixture per day is exactly the shape the bulk switch removed and it is not
being reintroduced wholesale to answer a question a sample answers.

Usage:
  python3 ten225-book-coverage-daily.py                      # today
  python3 ten225-book-coverage-daily.py 2026-08-12           # one date
  python3 ten225-book-coverage-daily.py 2026-09-01 2026-09-19  # a span
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

BASE = 'https://api.api-tennis.com/tennis/'
LEDGER = 'book-coverage-daily.json'
CONTROL_SAMPLE = 5

# The founder's ladder, 2026-09-19 (Superbet and Unibet restored). Printed first
# and in order, so the report answers "are the books we RANK actually there"
# before it answers anything else. bwin is out of the ladder but still measured:
# it is the one book absent in August too, and that only stays known if it keeps
# being counted.
LADDER = ['bet365', 'Superbet', 'Betano', 'Unibet', 'William Hill',
          'Betfair', '1xBet', 'Pinnacle']
ALSO = ['bwin', 'SBOBET', 'Marathon', 'BetVictor']


# ⚠️ ident(), NOT canon(), AND THE FIRST RUN OF THIS SCRIPT IS WHY. Keyed on
# canon() it printed "Pinnacle 0 0.0% <- ABSENT" while the same payload carried
# `Pncl` on 5 fixtures, and "SBOBET not returned at all" against `Sbo` on 45.
# canon() fixes SPELLING; an abbreviation is not a spelling. See book_names.ident.
from book_names import ident as canon    # noqa: E402  (named canon locally on purpose:
                                         # every keying site below is an identity test)


def api_key():
    for line in open('.env', encoding='utf-8'):
        if line.startswith('API_TENNIS_KEY='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    raise SystemExit('::error:: API_TENNIS_KEY not in .env')


def call(k, **params):
    q = urllib.parse.urlencode({'method': 'get_odds', 'APIkey': k, **params})
    with urllib.request.urlopen(BASE + '?' + q, timeout=90) as r:
        return json.load(r)


def two_sided(markets):
    hw = (markets or {}).get('Home/Away') or {}
    return set(hw.get('Home', {})) & set(hw.get('Away', {}))


def coverage(k, day):
    res = (call(k, date_start=day, date_stop=day).get('result') or {})
    priced, per_book = 0, {}
    for _ek, mk in res.items():
        books = two_sided(mk)
        if not books:
            continue
        priced += 1
        for b in books:
            per_book[canon(b)] = per_book.get(canon(b), 0) + 1
    return res, priced, per_book


def rule_out(k, res):
    """Same fixtures, both call shapes, same minute. Reported either way."""
    keys = [ek for ek, mk in res.items() if two_sided(mk)][:CONTROL_SAMPLE]
    if not keys:
        return {'checked': 0, 'agree': 0, 'disagree': 0,
                'note': 'no priced fixture to check — this control is VACUOUS today'}
    agree, diffs = 0, []
    for ek in keys:
        bulk = {canon(b) for b in two_sided(res[ek])}
        try:
            r2 = (call(k, match_key=ek).get('result') or {})
        except Exception as e:                       # noqa: BLE001
            diffs.append({'fixture': ek, 'error': str(e)[:120]})
            continue
        mk2 = r2.get(str(ek)) or (list(r2.values())[0] if len(r2) == 1 else None)
        per = {canon(b) for b in two_sided(mk2)} if mk2 else set()
        if per == bulk:
            agree += 1
        else:
            diffs.append({'fixture': ek, 'bulk_only': sorted(bulk - per),
                          'per_match_only': sorted(per - bulk)})
    return {'checked': len(keys), 'agree': agree, 'disagree': len(diffs),
            'diffs': diffs[:5]}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    if len(args) == 2:
        d0, d1 = date.fromisoformat(args[0]), date.fromisoformat(args[1])
        days = [(d0 + timedelta(days=i)).isoformat()
                for i in range((d1 - d0).days + 1)]
    else:
        days = [args[0]] if args else [date.today().isoformat()]

    k = api_key()
    rows = []
    for day in days:
        res, priced, per = coverage(k, day)
        row = {'date': day, 'priced': priced, 'books': len(per), 'per_book': per}
        rows.append(row)
        print(f"\n{day}  priced fixtures {priced}  distinct books {len(per)}")
        if not priced:
            print('  ::warning:: 0 priced fixtures — every zero below is VACUOUS')
            continue
        print('  ladder:')
        for b in LADDER:
            n = per.get(canon(b), 0)
            print(f'    {b:<14} {n:>4}  {100 * n / priced:5.1f}%'
                  + ('  <- ABSENT' if n == 0 else ''))
        others = {b: n for b, n in per.items()
                  if b not in {canon(x) for x in LADDER}}
        print('  outside the ladder: '
              + (', '.join(f'{b}={n}' for b, n in
                           sorted(others.items(), key=lambda x: -x[1])) or 'none'))
        missing = [b for b in ALSO if canon(b) not in per]
        if missing:
            print('  not returned at all: ' + ', '.join(missing))

        if day == days[-1]:
            ctl = rule_out(k, res)
            row['rule_out'] = ctl
            print(f"\n  RULE-OUT — bulk-by-date vs per-match, same fixtures, same minute")
            print(f"    checked {ctl['checked']}  agree {ctl['agree']}  "
                  f"disagree {ctl['disagree']}")
            if ctl.get('note'):
                print('    ::warning:: ' + ctl['note'])
            for d in ctl.get('diffs', []):
                print('      ' + json.dumps(d))
            if ctl['checked'] and not ctl['disagree']:
                print('    -> both call shapes return the SAME books. The '
                      'bulk-by-date switch is not the cause.')
            elif ctl['disagree']:
                print('    ::error:: the call shapes DISAGREE — the endpoint is '
                      'implicated and this one is OURS, not theirs.')

    hist = []
    if os.path.exists(LEDGER):
        try:
            hist = json.load(open(LEDGER, encoding='utf-8')).get('days', [])
        except Exception:                            # noqa: BLE001
            hist = []
    by_date = {r['date']: r for r in hist}
    for r in rows:
        by_date[r['date']] = r                       # a re-measure replaces
    out = sorted(by_date.values(), key=lambda r: r['date'])
    json.dump({'updated_at': datetime.now(timezone.utc)
               .strftime('%Y-%m-%dT%H:%M:%SZ'), 'days': out},
              open(LEDGER, 'w', encoding='utf-8'), indent=1, sort_keys=True)
    print(f'\n{LEDGER}: {len(out)} day(s) recorded')

    if len(out) >= 2:
        print('\nTREND  date        priced  books  bet365  Superbet')
        for r in out[-16:]:
            p = r['per_book']
            print(f"  {r['date']}  {r['priced']:>6}  {r['books']:>5}  "
                  f"{p.get('bet365', 0):>6}  {p.get('superbet', 0):>8}")


if __name__ == '__main__':
    main()
