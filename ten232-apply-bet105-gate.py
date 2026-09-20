#!/usr/bin/env python3
"""TEN-232 — wire the Bet105 gate. A REPLAYABLE patch, not hand edits.

This checkout is shared with concurrent runs and a reset destroys hand edits
silently (measured: commit 1d6c042f reverted two other issues' work). Every
anchor is exact-match, and the RESULT is tested before the anchor so a replay is
a verified no-op rather than a double-apply.

Usage: python3 ten232-apply-bet105-gate.py <repo-root>
"""
import os
import sys

EDITS = []


def edit(path, name, old, new):
    EDITS.append((path, name, old, new))


WF = '.github/workflows/ten232-kibl-archive.yml'

# ── 1. a `gate` mode, so the report runs where the credentials are ───────────
edit(WF, 'workflow_dispatch: the gate mode',
     "        description: 'sweep | backfill | report | cards | publish | audit | sides | books'",
     "        description: 'sweep | backfill | report | cards | publish | audit | sides | books | gate'")

edit(WF, 'the gate step',
     """      - name: Side-mapping probe
        if: inputs.mode == 'sides'""",
     """      # TEN-232 — the Bet105 gate. REPORT ONLY: it reads the book under test
      # directly instead of through VERIFIED_FEED_SOURCE_ID, because the card
      # path's filter is 43 and Bet105 is 171, so running the card path today
      # would read zero rows and print a clean 0% for every figure the founder
      # asked for. It writes nothing and renders nothing.
      #
      # API_TENNIS_KEY is passed because the side-mapping gate's free referee
      # arm needs it. Without it the gate sees the board alone, which on a
      # Challenger-heavy book is almost no referee at all.
      - name: Bet105 gate (report only)
        if: inputs.mode == 'gate'
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}
          KIBL_USERNAME: ${{ secrets.KIBL_USERNAME }}
          KIBL_PASSWORD: ${{ secrets.KIBL_PASSWORD }}
          API_TENNIS_KEY: ${{ secrets.API_TENNIS_KEY }}
        run: |
          set -o pipefail
          python3 -B ten232-bet105-gate.py \\
            --feed-source-id "${{ inputs.feed_source_id }}" \\
            | tee -a "$GITHUB_STEP_SUMMARY"

      - name: Side-mapping probe
        if: inputs.mode == 'sides'""")

# The id is an INPUT with no default rather than a constant. A gate that
# defaults to a book id would keep reporting confidently after the entitlement
# changed again — which is precisely what just happened to the card path.
edit(WF, 'workflow_dispatch: feed_source_id input',
     """      cadence_gate:
        description: 'sweep: apply should_sweep() before pulling (the pinger sets this)'
        default: 'false'""",
     """      feed_source_id:
        description: 'gate: the book under test, e.g. 171 for Bet105. No default on purpose — verified against the live entitlement before anything is reported.'
        default: ''
      cadence_gate:
        description: 'sweep: apply should_sweep() before pulling (the pinger sets this)'
        default: 'false'""")

# ── 2. the new suite runs in CI ──────────────────────────────────────────────
# Not optional: tools/test-every-suite-is-wired.js fails the build if a suite
# file exists and nothing names it, and npm test is the pre-deploy gate. An
# unwired suite here would redden every deploy in the repo.
edit('package.json', 'wire the gate harness into npm test',
     "python3 test-ten232-entitlement-watch.py",
     "python3 test-ten232-entitlement-watch.py && python3 test-ten232-bet105-gate.py")

# ── 3. the client docstring asserts something that is now FALSE ─────────────
# It has said "Bet105 does not appear in our entitlement" since 2026-09-18. As
# of 2026-09-19T14:07Z that is wrong, and it is wrong in the most expensive
# direction: the next reader to wire Bet105 would find a client whose header
# tells them the book does not exist. Corrected with the new measurement and
# its date, rather than deleted.
edit('kibl_client.py', 'the entitlement claim in the client header',
     "The book this account is served is SPORTS411, not Bet105. Sports411, NOT "
     "Bet105 — measured 2026-09-18T22:33Z (run 35401888326): /reference/sportsbooks "
     "returns exactly one book, feed_source_id 43, name Sports411. Bet105 does not "
     "appear in our entitlement. The two are not the same book and nothing here "
     "carries an affiliate relationship.",
     "⚠️ THE BOOK THIS ACCOUNT IS SERVED CHANGED, AND IT SWAPPED RATHER THAN GREW.\n"
     "Measured 2026-09-20T23:18Z (run 35544209624): /reference/sportsbooks returns\n"
     "exactly one book, **feed_source_id 171, name Bet105**, tag `bet105`. Sports411\n"
     "(feed_source_id 43) is GONE. The change landed 2026-09-19T14:07Z, the stamp the\n"
     "entitlement watch wrote into kibl-entitlement-baseline.json.\n"
     "\n"
     "Until 2026-09-18 this header said the opposite — \"Sports411, NOT Bet105 ...\n"
     "Bet105 does not appear in our entitlement\" (run 35401888326). That was true\n"
     "when it was written and false by the next day. It is corrected here rather\n"
     "than deleted, because the next reader to wire Bet105 would otherwise meet a\n"
     "client whose header tells them the book does not exist.\n"
     "\n"
     "Sports411 and Bet105 are NOT the same book. Every row already archived under\n"
     "feed_source_id 43 stays Sports411 and keeps that label; no new one can arrive.")


def apply(root):
    changed = 0
    for path, name, old, new in EDITS:
        full = os.path.join(root, path)
        src = open(full, encoding='utf-8').read()
        # RESULT FIRST. Several edits below insert before an anchor they keep,
        # so the anchor still matches after a successful apply — testing the
        # anchor first would double-apply on replay.
        if src.count(new) >= 1:
            print(f'  no-op   {name}')
            continue
        n = src.count(old)
        if n != 1:
            print(f'::error::  {name}: anchor matched {n} times, expected 1')
            return 1
        open(full, 'w', encoding='utf-8').write(src.replace(old, new, 1))
        print(f'  applied {name}')
        changed += 1
    print(f'{changed} edit(s) applied')
    return 0


if __name__ == '__main__':
    raise SystemExit(apply(sys.argv[1] if len(sys.argv) > 1 else '.'))
