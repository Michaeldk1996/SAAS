#!/usr/bin/env python3
"""TEN-225 item 5 — the filter must match what the CARD PRINTS.

LIVE READ, deployed 0da39868: the click filtered 57 -> 12, and **3 of those 12
still painted "0%" on both legs**. The founder's rule is about what he sees —
"drop every 0% card" — and the card prints `Math.round((now/open - 1) * 100)`,
so a 0.3% move scores > 0, survives `moveNowScore(m) > 0`, and then renders 0%.
The filter and the cell were using two different definitions of "moved".

Found by reading the live board, not by reading the code.

Usage: python3 ten225-apply-0919c.py <repo-root>
"""
import os
import sys

EDITS = [(
    'bsp-consult-dashboard.html',
    'filter: moved means what the CARD PRINTS',
    """function mxMoved(m){ return moveNowScore(m) > 0; }""",
    """function mxMoved(m){
  const p = _mcOpenNowPair(m);
  if (!p || !(p.o1 > 0) || !(p.o2 > 0) || !(p.n1 > 0) || !(p.n2 > 0)) return false;
  // ROUNDED THE WAY THE CELL ROUNDS. oddsPctDelta is `Math.round((now/open-1)*100)`,
  // so a 0.3% move is a positive score AND a painted "0%". The first cut of this
  // filter used `moveNowScore(m) > 0` and 3 of 12 survivors on the live board
  // printed 0% on both legs — the wall of 0% cards the founder asked to be rid
  // of, just shorter. Sharing oddsPctDelta is what makes the filter and the cell
  // agree by construction rather than by coincidence.
  return oddsPctDelta(p.o1, p.n1).pct !== 0 || oddsPctDelta(p.o2, p.n2).pct !== 0;
}""")]


def main():
    root = sys.argv[1]
    if os.path.isfile(root):
        root = os.path.dirname(root)
    applied = already = 0
    for path, name, old, new in EDITS:
        full = os.path.join(root, path)
        src = open(full, encoding='utf-8').read()
        if src.count(new) >= 1:
            already += 1
            print(f'  ok (already applied)  {name}')
            continue
        n = src.count(old)
        if n != 1:
            raise SystemExit(f'::error:: anchor count {n} (want 1) for {name}')
        open(full, 'w', encoding='utf-8').write(src.replace(old, new))
        applied += 1
        print(f'  applied               {name}')
    print(f'\n{applied} applied, {already} already in place')


if __name__ == '__main__':
    main()
