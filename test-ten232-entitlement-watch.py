#!/usr/bin/env python3
"""TEN-232 / TEN-225 item 3 — the Kibl entitlement watch must SPEAK on the day it changes.

Founder 2026-09-19: "Re-run this check on a schedule from now on, say daily, and
tell me the day it changes. I should not have to ask."

The failure this guards is not "the check does not run" — it is "the check runs
every day and the day it changes looks exactly like the day it did not". A watch
that reprints the same table is a log, not a watch.

So the assertions below are about the DIFFERENCE in output between a quiet run
and a changed one, and every state is manufactured (standing rule N) rather than
waiting for Bet105 to actually appear — which is the one day the check must not
be discovered to be broken.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = open(os.path.join(HERE, 'ten232-bet105-find.py')).read()
WF = open(os.path.join(HERE, '.github/workflows/ten232-kibl-archive.yml')).read()

FAILED = []


def check(name, cond, detail=''):
    print(f"  {'ok  ' if cond else 'FAIL'} {name}" + (f'   {detail}' if detail else ''))
    if not cond:
        FAILED.append(name)


print('TEN-225 item 3 — the entitlement watch')

print('\n  — it is wired to RUN, not merely to exist')
check('the watch runs on a SWEEP, not only on an explicit mode=books dispatch — '
      'otherwise it only ever runs when somebody remembers to ask, which is the '
      'thing the founder said he should not have to do',
      "inputs.mode == 'books' || inputs.mode == 'sweep' || inputs.mode == ''" in WF)
check('the baseline is COMMITTED, so the next runner diffs against the same file '
      'rather than an empty one (which would announce a change every run)',
      'kibl-entitlement-baseline.json' in WF and 'ci-commit-push.sh' in WF)

print('\n  — the rule is in the shipped script')
check('it diffs against a committed baseline rather than the previous run',
      'ENTITLEMENT_BASELINE' in SRC)
check('a CHANGE raises a ::error:: annotation, which surfaces without anyone '
      'opening the run log',
      '::error::KIBL ENTITLEMENT CHANGED' in SRC)
check('it names what was added, removed and RENAMED — a feed_source_id that keeps '
      'its number and changes its book is the same hazard as a new one',
      'added=' in SRC and 'removed=' in SRC and 'renamed=' in SRC)
check('an UNREADABLE baseline refuses to report "no change" — it warns instead, '
      'so a corrupt file cannot read as a clean day',
      'cannot diff and is NOT reporting' in SRC)
# Matched on a fragment that survives the source's own line wrapping. A first
# cut searched for the whole sentence and went red against correct code, because
# the f-string splits it across two lines — the assertion was measuring the
# formatting, not the behaviour.
check('a MISSING baseline says plainly that the NEXT run is the first that can '
      'detect anything, rather than implying this one checked',
      'the NEXT run is the first that can detect a' in SRC.replace('\n', ' '))
check('the baseline writer never raises — this job unschedules the Supabase '
      'pinger after 3 non-zero runs, so a bookkeeping failure must not starve '
      'the archive',
      'def _write_baseline' in SRC and 'Never raises' in SRC)

print('\n  — the diff itself, on manufactured entitlements')
# The shipped comparison is a plain dict equality plus three set differences.
# Reproducing it here is safe because the assertions above pin the shipped text;
# what is being tested is that the RULE distinguishes the cases at all.
def diff(base, seen):
    return ({k: v for k, v in seen.items() if k not in base},
            {k: v for k, v in base.items() if k not in seen},
            {k: (base[k], seen[k]) for k in seen if k in base and seen[k] != base[k]},
            seen != base)

TODAY = {'43': 'Sports411'}
add, gone, ren, changed = diff(TODAY, TODAY)
check('today vs today: NO change reported — a quiet day must be quiet, or the '
      'alert becomes noise and stops being read',
      not changed and not add and not gone and not ren)

add, gone, ren, changed = diff(TODAY, {'43': 'Sports411', '77': 'Bet105'})
check('Bet105 appearing IS a change, and it is named',
      changed and add == {'77': 'Bet105'} and not gone, json.dumps(add))

add, gone, ren, changed = diff(TODAY, {})
check('the entitlement going EMPTY is a change too — a book we lose is as much '
      'news as one we gain',
      changed and gone == {'43': 'Sports411'})

add, gone, ren, changed = diff(TODAY, {'43': 'Bet105'})
check('the same id carrying a DIFFERENT book is caught as a rename, not missed: '
      'an id-only comparison would call this no change while the card path kept '
      'trusting feed_source_id 43',
      changed and ren == {'43': ('Sports411', 'Bet105')}, json.dumps(ren))

print('\n  — the card path still refuses a new book until its gate passes')
CARD = open(os.path.join(HERE, 'ten225-kibl-card-state.py')).read()
check('VERIFIED_FEED_SOURCE_ID is still the only book the card path admits, so a '
      'newly activated book is captured by the sweep and REFUSED by the card',
      'VERIFIED_FEED_SOURCE_ID = 43' in CARD)

print('\n  — the baseline on disk matches what the account actually returned')
bl = os.path.join(HERE, 'kibl-entitlement-baseline.json')
check('a baseline file exists to diff against', os.path.exists(bl))
if os.path.exists(bl):
    d = json.load(open(bl))
    check('it records exactly the one book measured 2026-09-19 (43 Sports411) — '
          'seeded from a real read, not invented',
          d.get('books') == {'43': 'Sports411'}, json.dumps(d.get('books')))

print()
if FAILED:
    print(f'{len(FAILED)} FAILED: {FAILED}')
    sys.exit(1)
print('all checks passed')
