#!/usr/bin/env python3
"""TEN-232 — wire the Bet105 capability report into CI. Replayable patch.

Exact-match anchors, RESULT tested before the anchor, so a replay on a checkout
that already carries the change is a verified no-op rather than an ::error::.
The shared checkout at /Users/Michael/bsp-consult-project is reset by concurrent
runs; hand edits there do not survive and this does.

Usage: python3 ten232-apply-capability.py <repo-root>
"""
import os
import sys

EDITS = []
WF = '.github/workflows/ten232-kibl-archive.yml'
PKG = 'package.json'


def edit(path, name, old, new):
    EDITS.append((path, name, old, new))


# ── 1. A `capability` mode on the archive workflow ──────────────────────────
# Same job as the gate, for the same reason the gate lives there: the Supabase
# and Kibl secrets are scoped to it, and the report reads the archive that job
# writes. A second workflow would need the same four secrets and would be a
# second place to keep in step.
edit(WF, 'workflow: the capability mode is documented on the input',
     "        description: 'sweep | backfill | report | cards | publish | audit | sides | books | gate'",
     "        description: 'sweep | backfill | report | cards | publish | audit | sides | books | gate | capability'")

edit(WF, 'workflow: the capability step',
     """      - name: Side-mapping probe
        if: inputs.mode == 'sides'""",
     """      # TEN-225/232 founder directive 2026-09-21 — the full capability report.
      #
      # READ-ONLY, and the harness in the offline step proves it rather than
      # claiming it: no POST, no upsert, no PATCH, no DELETE, no file opened for
      # writing. It reads the archive this job fills and makes a short list of
      # GETs on endpoints we already hold entitlement for.
      #
      # WHY IT RUNS HERE AND NOT LOCALLY: SUPABASE_URL / SUPABASE_SECRET_KEY
      # exist only as Actions secrets. A local run reads nothing and would
      # report every figure as absent — which this script would correctly print
      # as a dash, and which would still be a wasted report.
      - name: Bet105 capability report (read only)
        if: inputs.mode == 'capability'
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}
          KIBL_USERNAME: ${{ secrets.KIBL_USERNAME }}
          KIBL_PASSWORD: ${{ secrets.KIBL_PASSWORD }}
        run: |
          set -o pipefail
          python3 -B ten232-bet105-capability.py \\
            --section "${{ inputs.section || 'all' }}" \\
            | tee -a "$GITHUB_STEP_SUMMARY"

      - name: Side-mapping probe
        if: inputs.mode == 'sides'""")

edit(WF, 'workflow: the section input',
     """      cadence_gate:
        description: 'sweep: apply should_sweep() before pulling (the pinger sets this)'""",
     """      section:
        description: 'capability: all | accuracy | markets | live | rows | endpoints | stream | coverage | limits'
        default: 'all'
      cadence_gate:
        description: 'sweep: apply should_sweep() before pulling (the pinger sets this)'""")

edit(WF, 'workflow: the harness joins the offline tests',
     """          python3 -B test-ten232-report.py""",
     """          python3 -B test-ten232-report.py
          python3 -B test-ten232-bet105-capability.py""")

# ── 2. And into `npm test`, which is the fail-closed gate ───────────────────
# The workflow step alone would satisfy tools/test-every-suite-is-wired.js, but
# it only runs on a hand dispatch with mode=capability. A report that decides a
# ladder ruling should not be able to rot between the two times someone asks
# for it.
edit(PKG, 'package.json: the harness joins npm test',
     """python3 test-ten232-bet105-gate.py""",
     """python3 test-ten232-bet105-gate.py && python3 test-ten232-bet105-capability.py""")


def apply(root):
    changed = 0
    for path, name, old, new in EDITS:
        full = os.path.join(root, path)
        src = open(full, encoding='utf-8').read()
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
