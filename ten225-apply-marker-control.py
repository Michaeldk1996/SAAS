#!/usr/bin/env python3
"""TEN-225 item 1(b) — MEASURE the suspension-marker recovery, do not claim it.

The marker fix landed with a SUPPRESSED counter that nothing printed, so "the
recovery is a measurement" was a claim I could not cash. Worse, a plain count of
skipped rows is not the number the founder asked for — he asked how many
FIXTURES GAINED A REAL CLOSE, and a run can skip fifty markers while recovering
nothing (if the only pre-start rows were all markers) or skip one and recover a
fixture.

So this computes the PRE-FIX answer alongside the real one, on the same data, in
the same pass, and reports the difference:

    recovered  — the pre-fix selector picked a marker; this one picks a price
    still lost — both pick nothing (the series is markers all the way back)
    unchanged  — both pick the same row (the ordinary case)

That is a control, not a claim: it reconstructs the exact selector that shipped
before this change and runs it on live data every time the job runs. It cannot
report a recovery that did not happen, and it cannot report zero on a build that
recovered something.

Usage: python3 ten225-apply-marker-control.py <repo-root>
"""
import os
import sys

EDITS = []
CARD = 'ten225-kibl-card-state.py'


def edit(path, name, old, new):
    EDITS.append((path, name, old, new))


edit(CARD, 'card-state: the pre-fix selector, kept as a control',
     """def close_of(obs_list, start_ts):""",
     """def close_of_prefix(obs_list, start_ts):
    \"\"\"THE SELECTOR AS IT SHIPPED BEFORE 2026-09-21. Kept deliberately.

    Byte-for-byte the old rule: any dated pre-start row, last one wins, with no
    test for whether the price is a price. It exists so every run can answer
    "what would the old build have picked here?" against LIVE data, which is the
    only way the recovery number below is a measurement rather than my estimate.

    DO NOT USE THIS TO PICK A CLOSE. It is the control arm.
    \"\"\"
    if start_ts is None:
        return None
    pre = [o for o in obs_list
           if o.get('price_decimal') is not None
           and epoch(o.get('inserted_on')) is not None
           and epoch(o['inserted_on']) < start_ts]
    if not pre:
        return None
    pre.sort(key=lambda o: (epoch(o['inserted_on']),
                            epoch(o.get('observed_at')) or 0.0))
    return pre[-1]


def close_of(obs_list, start_ts):""")

edit(CARD, 'card-state: run the control at the call site',
     """            close_obs = close_of(lst, start_ts)""",
     """            close_obs = close_of(lst, start_ts)
            # ITEM 1(b) CONTROL — what the pre-fix build would have picked on
            # this same series. Compared on the ROW, not the price: two
            # different rows can carry the same number, and counting a price
            # match as "unchanged" would under-report a genuine recovery.
            _ctl = close_of_prefix(lst, start_ts)
            _ctl_bad = _ctl is not None and real_price(_ctl) is None
            if _ctl_bad and close_obs is not None:
                st['close_RECOVERED_from_marker'] += 1
            elif _ctl_bad and close_obs is None:
                # The whole pre-start series is markers. Not a regression: the
                # old build would have "had" a close that the publisher then
                # suppressed into a dash anyway. Named so it is not mistaken
                # for something this change broke.
                st['close_still_lost_all_markers'] += 1""")

edit(CARD, 'card-state: print the recovery and the suppressed counts',
     """    print(f'kibl card rows: {len(rows)}  {dict(st)}')""",
     """    print(f'kibl card rows: {len(rows)}  {dict(st)}')
    # ITEM 1(b), founder 2026-09-21: "how many fixtures gained a real Close".
    # Printed unconditionally, including the zeros — a run that recovered
    # nothing must say so rather than print nothing, because a silent section
    # and a clean one look identical.
    print(f'suspension marker: rows skipped open={SUPPRESSED["open"]} '
          f'close={SUPPRESSED["close"]}  |  sides RECOVERED a real close='
          f'{st["close_RECOVERED_from_marker"]}  still lost (series is all '
          f'markers)={st["close_still_lost_all_markers"]}')""")


edit('test-ten225-kibl-card-state.py', 'card-test: the control ARM is driven, not reconstructed',
     """check('CONTROL: the pre-fix selector picks the 0.000 marker on this same input',
      float(_pre_fix[-1]['price_decimal']) == 0.0)""",
     """check('CONTROL: the pre-fix selector picks the 0.000 marker on this same input',
      float(_pre_fix[-1]['price_decimal']) == 0.0)
# ...and the SHIPPED control arm, not my reconstruction of it. close_of_prefix
# is what the run compares against live every time, so if it ever stops
# reproducing the defect the recovery number silently becomes zero and reads as
# "nothing to recover" rather than "the control broke".
_ctl = K.close_of_prefix(_susp, _start)
check('the shipped control arm reproduces the defect',
      _ctl is not None and float(_ctl['price_decimal']) == 0.0)
check('...and it disagrees with the real selector on this input, which is the '
      'only thing that makes the recovery count non-vacuous',
      K.epoch(_ctl['inserted_on']) != K.epoch(_c['inserted_on']))
check('...while agreeing on a clean series, so it is not simply broken',
      K.epoch(K.close_of_prefix([obs(2.10, T % (13, 0)), obs(2.15, T % (14, 30))], _start)['inserted_on'])
      == K.epoch(K.close_of([obs(2.10, T % (13, 0)), obs(2.15, T % (14, 30))], _start)['inserted_on']))""")


def apply(root):
    changed = 0
    for path, name, old, new in EDITS:
        full = os.path.join(root, path)
        with open(full, encoding='utf-8') as fh:
            src = fh.read()
        if src.count(new) >= 1:
            print(f'  no-op   {name}')
            continue
        n = src.count(old)
        if n != 1:
            print(f'::error::  {name}: anchor matched {n} times, expected 1')
            return 1
        with open(full, 'w', encoding='utf-8') as fh:
            fh.write(src.replace(old, new, 1))
        print(f'  applied {name}')
        changed += 1
    print(f'{changed} edit(s) applied')
    return 0


if __name__ == '__main__':
    raise SystemExit(apply(sys.argv[1] if len(sys.argv) > 1 else '.'))
