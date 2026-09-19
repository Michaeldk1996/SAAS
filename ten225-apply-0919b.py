#!/usr/bin/env python3
"""TEN-225 — founder rulings 2026-09-19T04:03Z, items 2 / 3 / 5.

A replayable patch rather than hand edits, for the reason item 7 is about: this
checkout is shared with concurrent runs, a reset destroys hand edits silently,
and it destroyed one change set already today. Every anchor is exact-match and
asserted, so a drifted source fails here instead of half-applying.

Usage: python3 ten225-apply-0919b.py <repo-root>
"""
import os
import sys

EDITS = []
DASH = 'bsp-consult-dashboard.html'


def edit(name, old, new, path=DASH):
    EDITS.append((path, name, old, new))


# ── ITEM 2 — bet365 cadence to 30 minutes ─────────────────────────────────
edit('cadence: METERED_EVERY 4 -> 2 (30 min)',
     '''METERED_EVERY="${METERED_EVERY:-4}"      # 4 x 15min = the approved flat hour''',
     '''METERED_EVERY="${METERED_EVERY:-2}"      # 2 x 15min = 30 min (founder 2026-09-19)''',
     'odds-capture-loop.sh')

edit('cadence: the rationale block says what it now is, and what it buys',
     '''# Every METERED_EVERY-th (4th, i.e. 60 min):  refresh-odds.py
#     ~2 billable /v4/odds-by-tournaments units. This is the NOW leg, and its
#     cadence is DELIBERATELY UNCHANGED — flat hourly is the founder's ruling
#     (option (a), 2026-09-10) and this loop is here to make hourly actually
#     mean hourly, not to spend more. 86% of bet365's pre-match movement is
#     >6h out, so sprinting buys resolution where nothing moves.''',
     '''# Every METERED_EVERY-th (2nd, i.e. 30 min):  refresh-odds.py
#     ~1-2 billable /v4/odds-by-tournaments units. This is the NOW leg.
#
#     WAS FLAT HOURLY (founder ruling option (a), 2026-09-10). Moved to 30 min
#     on 2026-09-19 with the trade stated and accepted: "I know it buys a
#     fresher label more than a fresher price, but at +24 units/day and 54% of
#     the monthly cap at reset the headroom is there and I would rather spend
#     it."
#
#     THE COST IS EXACTLY +24 UNITS/DAY, measured, not projected: the leg asks
#     for `ceil(distinct tournamentIds / 5)` and the board has resolved to ONE
#     tournament on 104 of 104 runs across 21 days, with a 61-day maximum of
#     four concurrent events. So 48 runs x 1 unit against 24 x 1.
#
#     WHAT IT DOES NOT BUY: 86% of bet365's pre-match movement is >6h out, and
#     on the board this was measured against, 31 of 32 pairable cards were flat
#     and evidenced. Halving the interval halves the age of the LABEL; it does
#     not make a still market move.''',
     'odds-capture-loop.sh')

# ── ITEM 3 — show 3 decimals below 1.10 ───────────────────────────────────
edit('display: one odds formatter, three decimals below 1.10',
     '''function mcPriceTitle(pair, px){''',
     '''// ───────────────────────── TEN-225 item 3 — HOW A PRICE IS PRINTED ────────
// Founder 2026-09-19: "keep [the 1.01 floor] where it is, fix the DISPLAY.
// Show 3 decimals below 1.10 (1.012, not \\"1.01\\")."
//
// WHY. Two decimals is fine across the range a member actually reads, and it is
// what every card has always used — but under 1.10 the second decimal is the
// whole price. bet365 quotes Dougaz v Murtaza at 1.004 and the card printed
// "1.00", which is not a rounding of that price so much as a different claim:
// 1.00 returns nothing, 1.004 returns 0.4%. That mis-print is what made the
// pair look impossible when only the leg was extreme.
//
// MEASURED on the deployed board 2026-09-19, n=62 fixtures / 760 priced legs:
// 115 legs sit below 1.10, and 26 of them LOSE a digit at two decimals —
// 1.004 (x6), 1.052 (x6), 1.091 (x4), 1.025 (x4), 1.068 (x2), 1.012 (x2),
// 1.001, 1.008. Everything at or above 1.10 is untouched.
//
// THE CUT IS ON THE VALUE, NOT THE CELL, so one price reads the same in the
// card face, the drift arrow, the completed journey and the hover. A per-site
// rule is how the same number comes to be printed two ways on one screen.
//
// ⚠️ SCOPE: book prices on the matches board. Model-derived numbers
// (edgeOdds, the implied-probability inverses, court speed) keep two decimals —
// they are not quotes, and widening them would be a change nobody asked for.
const MX_3DP_BELOW = 1.10;
function mxOddsTxt(v){
  if (!(typeof v === 'number' && isFinite(v) && v > 0)) return '';
  return v < MX_3DP_BELOW ? v.toFixed(3) : v.toFixed(2);
}
function mcPriceTitle(pair, px){''')

edit('display: the hover title',
     """  const priceTxt = (typeof px === 'number' && px > 0) ? px.toFixed(2) : '';""",
     """  const priceTxt = mxOddsTxt(px);""")

edit('display: drift cell — the Now value',
     """  const nowTxt = (now != null) ? now.toFixed(2) : '—';""",
     """  const nowTxt = (now != null) ? mxOddsTxt(now) : '—';""")

edit('display: card face, both legs',
     """    const p1OddsDisplay = nowPair?.p1 != null ? nowPair.p1.toFixed(2) : '—';
    const p2OddsDisplay = nowPair?.p2 != null ? nowPair.p2.toFixed(2) : '—';""",
     """    const p1OddsDisplay = nowPair?.p1 != null ? mxOddsTxt(nowPair.p1) : '—';
    const p2OddsDisplay = nowPair?.p2 != null ? mxOddsTxt(nowPair.p2) : '—';""")

edit('display: the match-detail Open / Close pair',
     """      if (open != null)  rows.push(`<span class="fo-pair open"><span class="fo-l">Open</span><span class="fo-v">${open.toFixed(2)}</span></span>`);
      if (close != null) rows.push(`<span class="fo-pair"><span class="fo-l">${open != null ? 'Close' : 'Odds'}</span><span class="fo-v">${close.toFixed(2)}</span></span>`);""",
     """      if (open != null)  rows.push(`<span class="fo-pair open"><span class="fo-l">Open</span><span class="fo-v">${mxOddsTxt(open)}</span></span>`);
      if (close != null) rows.push(`<span class="fo-pair"><span class="fo-l">${open != null ? 'Close' : 'Odds'}</span><span class="fo-v">${mxOddsTxt(close)}</span></span>`);""")

# ── ITEM 5 — Biggest Market Move FILTERS ──────────────────────────────────
edit('filter: the drift view shows only fixtures that moved',
     """const MOVE_NONE     = -1;  // priced, but no same-book open→now pair to measure
const MOVE_UNPRICED = -2;  // the card shows no price at all: no open, no now, either side""",
     """const MOVE_NONE     = -1;  // priced, but no same-book open→now pair to measure
const MOVE_UNPRICED = -2;  // the card shows no price at all: no open, no now, either side
// ───────────────────── TEN-225 item 5 — FILTER, DON'T SORT TO THE BOTTOM ──
// Founder 2026-09-19: "When I click the tile, show ONLY fixtures that actually
// moved. Drop every 0% card, every card with no computable move, and every
// unpriced card out of the view entirely — the tile exists to make the real
// moves easy to see, and a wall of 0% cards defeats it."
//
// This SUPERSEDES his 2026-09-18 ruling ("fixtures without both legs from one
// book go to the bottom, not hidden"), which is why the five-tier score below
// is kept rather than deleted: the ordering of what survives is unchanged, and
// MOVE_NONE / MOVE_UNPRICED still separate correctly for the count. Only the
// membership of the view changed.
//
// A fixture MOVED when its same-book open→now pair exists and is not flat.
// `moveNowScore` already returns exactly that as a positive number, so the
// filter is one comparison and cannot drift away from the sort's definition —
// the tile, the order and the filter read one resolver.
function mxMoved(m){ return moveNowScore(m) > 0; }""")

edit('filter: apply it inside getFiltered, where the view is built',
     """  const surfaceOrder = { clay:0, hard:1, grass:2 };""",
     """  // TEN-225 item 5. The filter lives HERE, beside the other view predicates,
  // rather than in the renderer — Prev/Next, the keyboard walk, the empty-state
  // message and the per-day counter all read getFiltered(), so filtering in the
  // renderer would leave every one of them counting a board nobody can see.
  //
  // GATED ON mxDriftView(), NOT on `state.sort` alone. `state.sort` survives a
  // switch to Results, where the drift ordering is never applied — filtering the
  // Results tab down to movers would hide finished matches on a view that has
  // no drift in it. mxDriftView() is the same predicate the drift CELL uses, so
  // the filter and the rendering cannot disagree about which view this is.
  //
  // Clicking the tile again sets state.sort back to 'time', which restores the
  // full board by construction: this branch only exists while drift is on.
  //
  // The counts are recorded rather than recomputed, because the denominator is
  // "what this view would have shown", which only this line knows — every other
  // caller sees the filtered array and could not reconstruct it.
  if (mxDriftView()){
    const before = out.length;
    out = out.filter(mxMoved);
    MX_DRIFT_FILTER = { shown: out.length, total: before };
  } else {
    MX_DRIFT_FILTER = null;
  }
  const surfaceOrder = { clay:0, hard:1, grass:2 };""")

edit('filter: the counter the tile reads',
     """function mxDriftView(){ return state.view !== 'completed' && state.sort === 'drift'; }""",
     """function mxDriftView(){ return state.view !== 'completed' && state.sort === 'drift'; }
// TEN-225 item 5 — \"Show the count in the view ... so it is clear the rest were
// filtered, not lost.\" Written by getFiltered() on every build and read by the
// tile; null whenever the filter is not applied, so the tile cannot print a
// stale count from a view the member has already left.
let MX_DRIFT_FILTER = null;""")

edit('filter: the tile says how many moved, and that the rest are filtered',
     """            + `<div class="mc-story__faint">${mcMoveBookLabel(bmv.m, 'now')} · ${driftCov.text}</div>`""",
     """            + `<div class="mc-story__faint">${mcMoveBookLabel(bmv.m, 'now')} · ${driftOn && MX_DRIFT_FILTER ? `${MX_DRIFT_FILTER.shown} of ${MX_DRIFT_FILTER.total} matches moved · the rest are filtered out` : driftCov.text}</div>`""")


# ── THE SANDBOX CLASS, AGAIN ──────────────────────────────────────────────
# Adding a free identifier to mcPriceTitle breaks every harness that evaluates
# it against a fixed stub set — the sandbox throws and every assertion below it
# stops running while the file still looks like a suite. That is exactly what
# G1 did with mxBookLabel on 2026-09-18 (8 pass / 17 fail on main, unnoticed for
# a day), and mxOddsTxt would have done it again. Both sandboxes SLICE the real
# function rather than stubbing it, so they exercise the shipped formatter and a
# future change to it shows up here as a behaviour diff, not a ReferenceError.
_SLICE_ODDS = """  ${slice('mxOddsTxt')}
  const MX_3DP_BELOW = ${Number(/const MX_3DP_BELOW = ([0-9.]+);/.exec(html)?.[1])};
"""

edit('both-clocks: the sandbox needs mxOddsTxt, sliced not stubbed',
     """  const newsTz = () => 'UTC';
  const mxBookLabel = b => b;
  ${shipped}""",
     """  const newsTz = () => 'UTC';
  const mxBookLabel = b => b;
  // mxOddsTxt is SLICED, not stubbed: it decides how many decimals a price
  // prints, and a stub would let this file keep passing while the page changed
  // what a member reads. See MX_3DP_BELOW in the dashboard.
  const MX_3DP_BELOW = ${Number(/const MX_3DP_BELOW = ([0-9.]+);/.exec(html)?.[1])};
  ${slice('mxOddsTxt')}
  ${shipped}""",
     'test-ten225-both-clocks.mjs')

edit('card-states: same',
     """const { mcPriceTitle } = new Function(`
  const MC_TITLE_1LINE_MAX = ${/const MC_TITLE_1LINE_MAX = (\d+);/.exec(html)?.[1] || 48};
  const mxBookLabel = b => b;
  const ocsFmtClock = t => t ? String(t).slice(11, 16) : '';
  ${titleSrc}
  return { mcPriceTitle };
`)();""",
     """const { mcPriceTitle } = new Function(`
  const MC_TITLE_1LINE_MAX = ${/const MC_TITLE_1LINE_MAX = (\d+);/.exec(html)?.[1] || 48};
  const mxBookLabel = b => b;
  const ocsFmtClock = t => t ? String(t).slice(11, 16) : '';
  // Sliced, not stubbed — see the note in test-ten225-both-clocks.mjs.
  const MX_3DP_BELOW = ${Number(/const MX_3DP_BELOW = ([0-9.]+);/.exec(html)?.[1])};
  ${slice('mxOddsTxt')}
  ${titleSrc}
  return { mcPriceTitle };
`)();""",
     'test-ten225-card-states.mjs')


# The remaining price cells. These are template fragments that appear ONLY in
# odds renderers, so they are replaced globally with the expected count asserted
# — a count that drifts means a new site appeared (or one vanished) and the
# patch stops rather than silently covering less of the board than it says.
# Verified by name before listing: open/close are the drift arrow and the
# completed journey; bmv is the Biggest-market-move tile; sp/a1/b1 are the
# Shortest-price and Tightest-match tiles; u.price is the upset price.
PRICE_FRAGMENTS = [
    ('${open.toFixed(2)}',     '${mxOddsTxt(open)}',     7),
    ('${close.toFixed(2)}',    '${mxOddsTxt(close)}',    3),
    ('${bmv.o.toFixed(2)}',    '${mxOddsTxt(bmv.o)}',    2),
    ('${bmv.c.toFixed(2)}',    '${mxOddsTxt(bmv.c)}',    2),
    ('${sp.price.toFixed(2)}', '${mxOddsTxt(sp.price)}', 1),
    ('${a1.toFixed(2)}',       '${mxOddsTxt(a1)}',       1),
    ('${b1.toFixed(2)}',       '${mxOddsTxt(b1)}',       1),
    ('${u.price.toFixed(2)}',  '${mxOddsTxt(u.price)}',  1),
]


def apply_fragments(src):
    n_done = 0
    for old, new, expect in PRICE_FRAGMENTS:
        hits = src.count(old)
        if hits == 0 and src.count(new) >= expect:
            print(f'  ok (already applied)  fragment {old}')
            continue
        if hits != expect:
            raise SystemExit(f'::error:: fragment {old}: expected {expect} '
                             f'site(s), found {hits}. The renderer changed; '
                             f'refusing to half-cover the board.')
        src = src.replace(old, new)
        n_done += expect
        print(f'  applied               fragment {old} x{expect}')
    print(f'  -> {n_done} price cell site(s) rewritten')
    return src


def main():
    root = sys.argv[1]
    if os.path.isfile(root):
        root = os.path.dirname(root)
    cache, applied, already = {}, 0, 0
    for path, name, old, new in EDITS:
        full = os.path.join(root, path)
        src = cache.get(full)
        if src is None:
            src = cache[full] = open(full, encoding='utf-8').read()
        n = src.count(old)
        if n == 0:
            if src.count(new) >= 1:
                already += 1
                print(f'  ok (already applied)  {path}: {name}')
                continue
            raise SystemExit(f'::error:: anchor NOT FOUND and result absent in {path}: {name}')
        if n > 1:
            raise SystemExit(f'::error:: anchor is AMBIGUOUS ({n} hits) in {path}: {name}')
        cache[full] = src.replace(old, new)
        applied += 1
        print(f'  applied               {path}: {name}')
    dash = os.path.join(root, DASH)
    cache[dash] = apply_fragments(cache.get(dash)
                                  or open(dash, encoding='utf-8').read())
    for full, src in cache.items():
        open(full, 'w', encoding='utf-8').write(src)
    print(f'\n{applied} applied, {already} already in place, {len(EDITS)} total '
          f'across {len(cache)} file(s)')


if __name__ == '__main__':
    main()
