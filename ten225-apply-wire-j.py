#!/usr/bin/env python3
"""TEN-225 item 4 — WIRE J, scoped exactly as the founder ruled.

Founder 2026-09-19: "WIRE J, scoped: bet365's api-tennis close only, on
Challenger and below, and only where we would otherwise dash. Never override a
close we can age. Label the source on the card and in the hover, and record in
the data that it carries no timestamp and no lag check. Do NOT use Betano/1xBet
as a 'bet365 close' on Davis Cup. Run the ATP window from August before wiring
anything ATP."

A replayable patch, not hand edits — the shared checkout resets.

Usage: python3 ten225-apply-wire-j.py <repo-root>
"""
import os
import sys

EDITS = []


def edit(name, old, new, path):
    EDITS.append((path, name, old, new))


# ── CAPTURE ───────────────────────────────────────────────────────────────
# The blocker measured first: `trackBookNow` returns on `m.finalScore`, so
# bookNow is ABSENT on every finished fixture (0 of 39 on the deployed board).
# That guard is right — a settled fixture's current price is not a Now — and it
# is exactly why J needs its own field rather than a relaxation of it.
edit('capture: the api-tennis last-pre-match price, as a CLOSE and not a Now',
     """  let bookNowChanged = 0, bookNowHeld = 0;
  const trackBookNow = (m, carried) => {""",
     """  // ───────────────── TEN-225 item 4 — J, WIRED AND SCOPED ─────────────────
  // api-tennis, verbatim (2026-09-18): they "store and display the LATEST ODDS
  // RECEIVED BEFORE THE MATCH STARTS". On a FINISHED fixture that is, by their
  // own definition, a Close — which is why it is captured here and not through
  // trackBookNow, whose `if (m.finalScore) return` guard is correct and stays.
  // Two different claims about the same number: before the off it is a Now and
  // must be withheld after it; after the off it is the last pre-match price.
  //
  // MEASURED before wiring (n=120 Challenger fixtures, both books present):
  // bet365's api-tennis price sits 0.43 implied-probability points from our
  // pinned bet365 close, median |Δ price| 0.017, 12.5% identical to the tick.
  // Every OTHER book sits at 1.7-1.9pp, which is ordinary cross-book spread —
  // the gap between those two numbers is the evidence that this really is the
  // same book's closing quote and not a coincidence.
  //
  // ⚠️ WHAT IS RECORDED WITH IT, because the founder asked for it in the DATA
  // and not only in the tooltip: `noTimestamp` and `noLagCheck`. The feed
  // carries no clock, so the <=60-min lag limb every other Close must pass
  // cannot be applied to this one at all. A consumer that forgets that would be
  // treating an unaged price as an aged one.
  //
  // bet365 ONLY. "Do NOT use Betano/1xBet as a 'bet365 close' on Davis Cup —
  // different books." They are not written here under any name; if they are to
  // fill a dash later it is as a labelled fallback under their own book, which
  // is a separate ruling.
  let atCloseWritten = 0;
  const pinApiTennisClose = (m) => {
    if (!m.finalScore) return;                 // a Close needs a finished match
    const raw = m.apiTennisBooks;
    if (!raw) return;
    const bk = Object.keys(raw).find(k => String(k).toLowerCase() === 'bet365');
    if (!bk) return;
    const v = raw[bk];
    if (!(v && v.p1 > 0 && v.p2 > 0)) return;  // both legs or nothing
    m.apiTennisClose = {
      p1: v.p1, p2: v.p2, book: 'bet365', src: 'api-tennis',
      // Stated in the row, not inferred by the reader.
      noTimestamp: true, noLagCheck: true,
      seenAt: new Date().toISOString(),        // when WE read it, never the cut
    };
    atCloseWritten++;
  };
  let bookNowChanged = 0, bookNowHeld = 0;
  const trackBookNow = (m, carried) => {""",
     'bsp-pipeline.js')

edit('capture: call it',
     """    trackBookNow(m, carried);""",
     """    trackBookNow(m, carried);
    pinApiTennisClose(m);""",
     'bsp-pipeline.js')

edit('capture: carry it forward like every other pinned value',
     """                    bookNow: pm.bookNow || null,""",
     """                    bookNow: pm.bookNow || null,
                    apiTennisClose: pm.apiTennisClose || null,""",
     'bsp-pipeline.js')

# ── RENDER ────────────────────────────────────────────────────────────────
edit('render: the scoped fallback, last in the chain',
     """function _mcCloseOf(m, who){
  const o = _ocsOf(m);
  if (o) return o[who].close ?? null;""",
     """// ───────────────────── TEN-225 item 4 — the J fallback, scoped ────────────
// "bet365's api-tennis close only, on Challenger and below, and only where we
// would otherwise dash. Never override a close we can age."
//
// LEVEL SCOPE. Challenger and below means Challenger and ITF. ATP, WTA and the
// team events are excluded: the ATP window has not been measured yet (the J
// sample joined n=1 ATP fixture, which is no sample at all), and on Davis Cup
// bet365's api-tennis close is absent outright — 0 of 33 — so there is nothing
// there to wire even if it were in scope.
const MX_J_LEVELS = /challenger/i;
function mxJLevel(m){
  const t = String((m && m.tour) || '');
  if (/davis cup|billie jean/i.test(t)) return false;
  return MX_J_LEVELS.test(t) || /\\bitf\\b|^m15|^m25|^w15/i.test(t);
}
// TRUE only when nothing we can age is available. The order is the ruling: a
// close with a timestamp and a lag check always wins, and this never overrides
// one — it only fills a cell that would otherwise be a dash.
function mxJClose(m, who){
  const c = m && m.apiTennisClose;
  if (!c || !(c.p1 > 0 && c.p2 > 0)) return null;
  if (!mxJLevel(m)) return null;
  return c[who] ?? null;
}
function _mcCloseOf(m, who){
  const o = _ocsOf(m);
  if (o) return o[who].close ?? mxJClose(m, who);""",
     'bsp-consult-dashboard.html')

edit('render: and after the matches.json pinned close',
     """  const c = m.closingOdds;
  if (!c) return null;
  if (mxIsSuspendedPair(c.p1, c.p2,
                        { id: (m && (m.id || m.matchKey)) || null,
                          book: c.bookmaker || null, path: 'closingOdds' })) return null;
  return c[who] ?? null;
}""",
     """  const c = m.closingOdds;
  if (!c) return mxJClose(m, who);
  if (mxIsSuspendedPair(c.p1, c.p2,
                        { id: (m && (m.id || m.matchKey)) || null,
                          book: c.bookmaker || null, path: 'closingOdds' }))
    return mxJClose(m, who);
  return c[who] ?? mxJClose(m, who);
}
// Did THIS cell's close come from the unaged api-tennis fallback? The label has
// to follow the value, so it asks the same question the resolver just answered
// rather than re-deriving it from the level — a card can be in scope and still
// have a real aged close, and labelling that one "no timestamp" would be the
// false label this issue has paid for three times.
function mxCloseIsJ(m, who){
  if (mxJClose(m, who) == null) return false;
  const o = _ocsOf(m);
  if (o && o[who].close != null) return false;
  const c = m && m.closingOdds;
  if (c && c[who] != null && !mxIsSuspendedPair(c.p1, c.p2, { path: 'closingOdds.probe' }))
    return false;
  return true;
}""",
     'bsp-consult-dashboard.html')

edit('render: the hover says it carries no timestamp and no lag check',
     """    const _closeTitle = who => {
      const o = _ocsOf(m);
      const book = o ? o.book : ((m.closingOdds && m.closingOdds.bookmaker) || null);
      if (!book) return '';""",
     """    const _closeTitle = who => {
      // TEN-225 item 4 — the J fallback names its own book and says plainly what
      // it is not: no clock, so no lag check. Checked FIRST, because on a card
      // this fills, `_ocsOf`/`closingOdds` name a book that did not supply the
      // number.
      if (mxCloseIsJ(m, who))
        return mcPriceTitle({ book: 'bet365', at: null, kind: 'sighting',
                              note: 'last pre-match price · api-tennis · no timestamp, no lag check' },
                            _mcCloseOf(m, who));
      const o = _ocsOf(m);
      const book = o ? o.book : ((m.closingOdds && m.closingOdds.bookmaker) || null);
      if (!book) return '';""",
     'bsp-consult-dashboard.html')


# ── THE SANDBOX CLASS, FOR THE THIRD TIME TODAY ───────────────────────────
# _mcCloseOf now reaches mxJClose, so every harness that evaluates it against a
# fixed identifier list throws — and a throwing sandbox stops asserting while the
# file still looks like a suite. G1's mxBookLabel did this on 09-18 (8/17 red on
# main, unnoticed for a day); mxOddsTxt did it an hour ago; this is the third.
# The fix is the same and the right one: SLICE the real functions, so the suite
# exercises the shipped scope rule instead of a stub that cannot go stale.
edit('suspended-guard: the sandbox needs the J helpers, sliced not stubbed',
     """const FNS = ['_ocsSanePx', 'mxOverround', 'mxIsSuspendedPair', 'mxRealPair',
             '_ocsOf', 'ocsKeyOf', 'ocsMatchKey', 'ocsNameKey', 'ocsNfd',
             '_isBet365', '_mcBet365Now',
             '_mcBooksByCoverage', '_mcAnyBookPair', '_mcNowPair',
             '_mcNowSuppressed', '_mcCloseOf', '_openAnchorOf'];""",
     """// mxJLevel / mxJClose are in the list because _mcCloseOf CALLS them (TEN-225
// item 4). Sliced, never stubbed: a stub would let this file keep passing while
// the shipped scope rule changed under it, and the scope rule is the ruling.
const FNS = ['_ocsSanePx', 'mxOverround', 'mxIsSuspendedPair', 'mxRealPair',
             '_ocsOf', 'ocsKeyOf', 'ocsMatchKey', 'ocsNameKey', 'ocsNfd',
             '_isBet365', '_mcBet365Now',
             '_mcBooksByCoverage', '_mcAnyBookPair', '_mcNowPair',
             '_mcNowSuppressed', 'mxJLevel', 'mxJClose', '_mcCloseOf',
             '_openAnchorOf'];""",
     'test-ten225-suspended-guard.mjs')

edit('suspended-guard: and the constant those helpers read',
     """    ${sliceConst('MX_SUSPENDED_OVERROUND')}
    ${sliceConst('MX_MIN_REAL_PRICE')}""",
     """    ${sliceConst('MX_SUSPENDED_OVERROUND')}
    ${sliceConst('MX_MIN_REAL_PRICE')}
    ${sliceConst('MX_J_LEVELS')}""",
     'test-ten225-suspended-guard.mjs')

# ── THE ROOT CAUSE OF THE SANDBOX CLASS, AND IT IS NOT THE SANDBOXES ──────
# MEASURED while fixing the third breakage today: `npm test` runs exactly ONE of
# the ten TEN-225 mjs suites (drift-order). The other nine — the suspended
# guard, both-clocks, card-states, the Underway chip guard, ocs-key, the J
# tests, the price formatter — have never run in CI. That is why both-clocks sat
# 8 pass / 17 fail on main for a day with nobody noticing: nothing was running
# it, so "the harness went red" and "the harness is fine" produced identical
# builds.
#
# pipeline.yml already runs `npm test` and fails the job on it, so wiring them
# in is the whole fix. Measured cost: 1.4 s for all ten.
edit('CI: run every TEN-225 mjs suite, not just one of the ten',
     """node --test test-ten225-drift-order.mjs &&""",
     """node --test test-ten225-drift-order.mjs test-ten225-both-clocks.mjs test-ten225-card-states.mjs test-ten225-j-close.mjs test-ten225-no-underway-chip.mjs test-ten225-ocs-key.mjs test-ten225-price-format-and-filter.mjs test-ten225-apitennis-now.mjs test-ten225-header-clock.mjs test-match-stats-live-union.mjs && node test-ten225-suspended-guard.mjs &&""",
     'package.json')

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
        # ⚠️ THE RESULT IS CHECKED FIRST, and this is not cosmetic. Several of
        # these edits INSERT before an anchor they keep, so `old` still matches
        # after a successful apply — testing `old` first made the script
        # non-idempotent and it re-inserted four blocks on a replay. A patch
        # that is not safe to re-run is not a replayable patch.
        if src.count(new) >= 1:
            already += 1
            print(f'  ok (already applied)  {path}: {name}')
            continue
        n = src.count(old)
        if n == 0:
            raise SystemExit(f'::error:: anchor NOT FOUND and result absent in {path}: {name}')
        if n > 1:
            raise SystemExit(f'::error:: anchor is AMBIGUOUS ({n} hits) in {path}: {name}')
        cache[full] = src.replace(old, new)
        applied += 1
        print(f'  applied               {path}: {name}')
    for full, src in cache.items():
        open(full, 'w', encoding='utf-8').write(src)
    print(f'\n{applied} applied, {already} already in place, {len(EDITS)} total')


if __name__ == '__main__':
    main()
