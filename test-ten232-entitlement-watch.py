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
import re
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
# ⚠️ DO NOT PIN THE ID HERE. This read `'VERIFIED_FEED_SOURCE_ID = 43' in CARD`
# until 2026-09-20, when the founder promoted Bet105 (171) after its gate passed
# — and a gate that goes red because a ruling was CARRIED OUT is not measuring
# the thing it names. Same defect the baseline assertion below already had to be
# rescued from. The guarantee is single-valued admission bound to a constant;
# the value is TEN-232's business, not this gate's.
_m = re.search(r'^VERIFIED_FEED_SOURCE_ID\s*=\s*(\d+)\s*$', CARD, re.M)
check('the card path admits exactly ONE feed_source_id, and it is a bare int '
      'constant a human has to move deliberately — not a list, not a wildcard',
      _m is not None, '<no single-int assignment found>')
check('...and the observation read is BOUND to that constant rather than to a '
      'literal id, so promoting a book after its gate passes is one line and '
      'cannot leave the filter pointing at the book it replaced',
      'feed_source_id=eq.{VERIFIED_FEED_SOURCE_ID}' in CARD)
check('...and nothing widens it to every book in the archive, which is the '
      'failure this guard actually exists to catch',
      'feed_source_id=in.' not in CARD and 'feed_source_id=neq.' in CARD)

print('\n  — the baseline on disk matches what the account actually returned')
bl = os.path.join(HERE, 'kibl-entitlement-baseline.json')
check('a baseline file exists to diff against', os.path.exists(bl))
if os.path.exists(bl):
    d = json.load(open(bl))
    # ASSERT THE INVARIANT, NOT A FROZEN READING. This check used to pin the
    # literal {'43': 'Sports411'}, which is the value the account happened to
    # return on 2026-09-19. But kibl-entitlement-baseline.json is a LIVE file:
    # the watch job rewrites and commits it every time the account moves, which
    # is the entire point of a watch. So the first time it did its job - the
    # account went to {'171': 'Bet105'} at 14:07Z - this assertion went red, and
    # because `npm test` is the fail-closed PRE-DEPLOY gate, a monitor observing
    # a change took the whole site undeployable. A gate that a passing monitor
    # breaks is not measuring what it meant to.
    #
    # What the check actually means, per its own wording, is "this came from a
    # real read rather than being invented": a dict of feed_source_id -> book
    # name, non-empty, carrying the timestamp the reader stamped on it. That is
    # true of any genuine read and false of a hand-written placeholder, and it
    # does not go stale the next time the entitlement moves.
    #
    # NOTE: the entitlement moved 43/Sports411 -> 171/Bet105 on 2026-09-19T14:07Z,
    # and on 2026-09-20 the founder promoted Bet105 to the card path after it
    # passed its own side-mapping gate (114 paired, 84 lopsided, 0 disagreements,
    # run 35545303855). VERIFIED_FEED_SOURCE_ID is now 171. The assertion above
    # no longer names either number, deliberately: which book we carry is a live
    # question for TEN-232, and a pre-deploy gate must not go red because the
    # answer changed.
    books = d.get('books')
    check('the baseline is a real read: a non-empty {feed_source_id: book} map, '
          'not an invented placeholder',
          isinstance(books, dict) and len(books) > 0
          and all(str(k).isdigit() and isinstance(v, str) and v.strip() for k, v in books.items()),
          json.dumps(books))
    check('...and it is stamped with when it was read, so a stale baseline is '
          'visible rather than silent',
          bool(d.get('updated_at')), json.dumps(d.get('updated_at')))

print()
if FAILED:
    print(f'{len(FAILED)} FAILED: {FAILED}')
    sys.exit(1)
print('all checks passed')
