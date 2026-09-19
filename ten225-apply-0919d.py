#!/usr/bin/env python3
"""TEN-225 — founder rulings 2026-09-19T06:05Z, items 1 / 3 / 4 / 6.

A replayable patch rather than hand edits: this checkout is shared with
concurrent runs and a reset destroys hand edits silently. Every anchor is
exact-match; the RESULT is tested before the anchor so a replay is a no-op.

Usage: python3 ten225-apply-0919d.py <repo-root>
"""
import os
import sys

EDITS = []
DASH = 'bsp-consult-dashboard.html'


def edit(name, old, new, path=DASH):
    EDITS.append((path, name, old, new))


# ── ITEM 1 — THE LADDER IS A NAMED ORDER, NOT COVERAGE ────────────────────
edit('ladder: the founder\'s named order outranks coverage',
     """function _mcBooksByCoverage(){""",
     """// ───────────────────── TEN-225 item 1 — THE BOOK LADDER, 2026-09-19 ───────
// Founder: "1. bet365  2. Superbet  3. Betano  4. Unibet  5. William Hill
// 6. Betfair  7. 1xBet  8. Pinnacle (sharp reference) ... SBOBET, Marathon,
// BetVictor only when nothing above has the fixture."
//
// ⚠️ THIS SUPERSEDES RANKING BY COVERAGE, and the reason is measurable today.
// The tail ladder sorted purely on how many cards a book covered, and on the
// 2026-09-19 board SBOBET quotes 45 of 116 priced fixtures against bet365's 4 —
// so the widest-margin book we measured (11.61% overround, against Pinnacle's
// 3.44%) was winning cards on volume. That is the exact failure the founder
// named: "SBOBET carries the widest margin we measured and must not win cards
// on coverage alone."
//
// Superbet and Unibet are BACK after a correction: they were dropped on a
// measurement taken over 2026-09-09..18, a window sitting entirely inside a
// feed-wide coverage collapse. Over 08-12..09-08 Superbet quotes 96-100% of
// priced fixtures — better covered than bet365. bwin stays out: it returned
// nothing on any day measured, August included.
const MX_BOOK_LADDER = ['bet365', 'Superbet', 'Betano', 'Unibet',
                        'William Hill', 'Betfair', '1xBet', 'Pinnacle'];
// "only when nothing above has the fixture" — explicitly below every unlisted
// book, not merely below the ladder.
const MX_BOOK_LAST = ['SBOBET', 'Marathon', 'BetVictor'];
// Identity, folding the three vendor-CONFIRMED abbreviations. The feed spells
// SBOBET `Sbo` and Pinnacle `Pncl`, so a ladder keyed on the display spelling
// would rank neither — the same shape that reported William Hill absent while
// api-tennis returned `WilliamHill` on 244 fixtures. Mirrors book_names.ident.
const MX_BOOK_ALIAS = { sbo: 'sbobet', pncl: 'pinnacle', victorchandler: 'betvictor' };
function mxBookIdent(b){
  const k = String(b || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return MX_BOOK_ALIAS[k] || k;
}
// Lower is better. The gap between the named ladder and the explicit tail is
// deliberate: an unlisted book sits BETWEEN them, so a book the founder has
// never ruled on still beats one he has ruled to the bottom, and coverage
// orders only within that middle band.
function mxBookRank(book){
  const id = mxBookIdent(book);
  if (!id) return 999;
  const i = MX_BOOK_LADDER.findIndex(b => mxBookIdent(b) === id);
  if (i >= 0) return i;
  if (MX_BOOK_LAST.some(b => mxBookIdent(b) === id)) return 900;
  return 500;
}
function _mcBooksByCoverage(){""")

edit('ladder: sort by rank first, coverage only as the tiebreak',
     """  const cov = _mcBooksByCoverage();
  cands.sort((a, b) => (cov[b.book] || 0) - (cov[a.book] || 0));""",
     """  const cov = _mcBooksByCoverage();
  // TEN-225 item 1 — RANK FIRST, coverage only inside a rank. Coverage still
  // does real work: it orders the unlisted middle band, which is where a book
  // the founder has not ruled on belongs. What it no longer does is let volume
  // beat the ruling.
  cands.sort((a, b) => (mxBookRank(a.book) - mxBookRank(b.book))
                    || ((cov[b.book] || 0) - (cov[a.book] || 0)));""")

# ── ITEM 3 — EXTEND J TO ATP ──────────────────────────────────────────────
edit('J: ATP joins the scope, on the August measurement',
     """// LEVEL SCOPE. Challenger and below means Challenger and ITF. ATP, WTA and the
// team events are excluded: the ATP window has not been measured yet (the J
// sample joined n=1 ATP fixture, which is no sample at all), and on Davis Cup
// bet365's api-tennis close is absent outright — 0 of 33 — so there is nothing
// there to wire even if it were in scope.
const MX_J_LEVELS = /challenger/i;
function mxJLevel(m){
  const t = String((m && m.tour) || '');
  if (/davis cup|billie jean/i.test(t)) return false;
  return MX_J_LEVELS.test(t) || /\\bitf\\b|^m15|^m25|^w15/i.test(t);
}""",
     """// LEVEL SCOPE: ATP, Challenger and ITF. WTA and the team events stay out.
//
// ATP WAS EXCLUDED AND IS NOW IN, on the founder's ruling of 2026-09-19 and the
// August window that ruling asked for. The first J sample joined n=1 ATP
// fixture, which is no sample; eight August days richest in ATP give n=217
// joined, bet365 returning a two-sided close on 91.7% of them, and against our
// own pinned bet365 close (n=199): 18.6% identical to the tick, median |Δ price|
// 0.004, **median |Δ implied| 0.06pp**. Every OTHER book on the same fixtures
// sits at 0.80-1.48pp. That 13-25x gap is the evidence — it is not that
// api-tennis's numbers are close to ours, it is that bet365's are and nobody
// else's are. ATP now agrees MORE tightly than Challenger (0.08pp, n=205), the
// tier that was already wired.
//
// WTA is out because it is unmeasured against our own closes, not because it
// looks worse. The team events are out twice over: excluded here explicitly,
// and bet365's api-tennis close is absent there outright (0 of 33), so Betano
// and 1xBet are the only books that could fill a Davis Cup dash — and they are
// different books, which the founder ruled must never be dressed as a bet365
// close.
const MX_J_LEVELS = /challenger|\\batp\\b/i;
function mxJLevel(m){
  const t = String((m && m.tour) || '');
  // Checked FIRST. Every Davis Cup / BJK tie in the feed is named "ATP Davis
  // Cup - World Group ...", so an ATP test running first would admit the one
  // tier where this close does not exist at all.
  if (/davis cup|billie jean|united cup|laver cup/i.test(t)) return false;
  if (/\\bwta\\b/i.test(t)) return false;
  return MX_J_LEVELS.test(t) || /\\bitf\\b|^m15|^m25|^w15/i.test(t);
}""")

# ── ITEM 4 — THE FLOOR MOVES TO < 1.01 ────────────────────────────────────
edit('floor: strictly below 1.01, so a genuine 1.01 survives',
     """const MX_MIN_REAL_PRICE = 1.01;""",
     """// TEN-225 item 4, founder 2026-09-19: "move it to < 1.01 ... It keeps 1xBet's
// genuine 1.01 and bet365's opening pin, and still suppresses Marathon's 1.00
// placeholder and the 1.001-1.008 band."
//
// THE COMPARISON IS STRICT (`p < MX_MIN_REAL_PRICE`), NOT `<=`. That one
// character is the whole ruling: at `<=` the floor suppressed every genuine
// 1.01, which the data says is a real quotable price — 1xBet quotes exactly
// 1.01 on three fixtures and bet365 pins 1.01 as its OWN open on a fourth.
// A book minimum is not a placeholder.
//
// WHAT IT STILL CATCHES: 1.00 exactly (Marathon, 5 fixtures — a decimal of 1.00
// returns nothing, so it is a slot with a number in it rather than a price) and
// the 1.001-1.008 band, which is genuine but so extreme that printing it beside
// an ordinary price misleads more than it informs.
const MX_MIN_REAL_PRICE = 1.01;""")

edit('floor: the leg test itself',
     """  const unbettable = p1 <= MX_MIN_REAL_PRICE || p2 <= MX_MIN_REAL_PRICE;""",
     """  const unbettable = p1 < MX_MIN_REAL_PRICE || p2 < MX_MIN_REAL_PRICE;""")


# ── THE SANDBOX CLASS AGAIN — _mcAnyBookPair now reaches mxBookRank ───────
# Adding a free identifier to a shipped function throws inside every harness
# that evaluates it against a fixed list, and a throwing sandbox stops asserting
# while the file still looks like a suite. Fourth time on this issue; the fix is
# the same and it is the right one — SLICE the real helper, never stub it.
edit('suspended-guard: the sandbox needs the ladder helpers, sliced not stubbed',
     """const FNS = ['_ocsSanePx', 'mxOverround', 'mxIsSuspendedPair', 'mxRealPair',
             '_ocsOf', 'ocsKeyOf', 'ocsMatchKey', 'ocsNameKey', 'ocsNfd',
             '_isBet365', '_mcBet365Now',
             '_mcBooksByCoverage', '_mcAnyBookPair', '_mcNowPair',
             '_mcNowSuppressed', 'mxJLevel', 'mxJClose', '_mcCloseOf',
             '_openAnchorOf'];""",
     """// mxBookIdent / mxBookRank are here because _mcAnyBookPair CALLS them
// (TEN-225 item 1 — the ladder is a named order now, not coverage). Sliced,
// never stubbed: a stub would let this file keep passing while the shipped
// ladder changed underneath it, and the ladder IS the ruling.
const FNS = ['_ocsSanePx', 'mxOverround', 'mxIsSuspendedPair', 'mxRealPair',
             '_ocsOf', 'ocsKeyOf', 'ocsMatchKey', 'ocsNameKey', 'ocsNfd',
             '_isBet365', '_mcBet365Now', 'mxBookIdent', 'mxBookRank',
             '_mcBooksByCoverage', '_mcAnyBookPair', '_mcNowPair',
             '_mcNowSuppressed', 'mxJLevel', 'mxJClose', '_mcCloseOf',
             '_openAnchorOf'];""",
     'test-ten225-suspended-guard.mjs')

edit('suspended-guard: sliceConst must survive a MULTI-LINE declaration',
     """function sliceConst(name) {
  const re = new RegExp(`^const ${name} = .*?;$`, 'm');
  const hit = SRC.match(re);
  if (!hit) throw new Error(`const ${name} not found in the shipped HTML`);
  return hit[0];
}""",
     """function sliceConst(name) {
  // MULTI-LINE CAPABLE. The single-line form `^const NAME = .*?;$` went red
  // against correct code the moment MX_BOOK_LADDER was declared across two
  // lines — it was measuring the source's line wrapping, not the constant.
  // Now: find the declaration, then consume to the `;` that closes it,
  // balancing brackets so a `;` inside a string or a nested literal cannot end
  // it early.
  const at = SRC.indexOf(`const ${name} = `);
  if (at < 0) throw new Error(`const ${name} not found in the shipped HTML`);
  let depth = 0;
  for (let i = at; i < SRC.length; i++) {
    const c = SRC[i];
    if (c === '[' || c === '{' || c === '(') depth++;
    else if (c === ']' || c === '}' || c === ')') depth--;
    else if (c === ';' && depth === 0) return SRC.slice(at, i + 1);
  }
  throw new Error(`const ${name} is not terminated`);
}""",
     'test-ten225-suspended-guard.mjs')

edit('suspended-guard: and the ladder constants those helpers read',
     """    ${sliceConst('MX_MIN_REAL_PRICE')}""",
     """    ${sliceConst('MX_MIN_REAL_PRICE')}
    ${sliceConst('MX_BOOK_LADDER')}
    ${sliceConst('MX_BOOK_LAST')}
    ${sliceConst('MX_BOOK_ALIAS')}""",
     'test-ten225-suspended-guard.mjs')

edit('suspended-guard: the floor is STRICTLY below 1.01 now',
     """  check('the impossible-leg floor is the ruled 1.01, read from the shipped constant',
        api.MX_MIN_REAL_PRICE === 1.01, String(api.MX_MIN_REAL_PRICE));""",
     """  check('the impossible-leg floor is the ruled 1.01, read from the shipped constant',
        api.MX_MIN_REAL_PRICE === 1.01, String(api.MX_MIN_REAL_PRICE));
  // SUPERSEDED TWICE, AND REWRITTEN BOTH TIMES RATHER THAN DELETED. The
  // constant has not moved; the COMPARISON has. On 2026-09-19 the founder ruled
  // "< 1.01, not <= 1.01" after the data showed 1.01 is a price a book will
  // take: 1xBet quotes exactly 1.01 on three fixtures and bet365 pins 1.01 as
  // its own OPEN on a fourth. A book minimum is not a placeholder.
  check('a genuine 1.01 SURVIVES — the floor is strictly below it',
        !api.mxIsSuspendedPair(1.01, 15.0), (ov(1.01, 15.0) * 100).toFixed(1) + '%');
  check('...and 1.00 exactly is still suppressed — a decimal of 1.00 returns nothing',
        api.mxIsSuspendedPair(1.00, 9.80), (ov(1.00, 9.80) * 100).toFixed(1) + '%');
  check('...and the 1.001-1.008 band is still suppressed',
        api.mxIsSuspendedPair(1.008, 12.0) && api.mxIsSuspendedPair(1.001, 20.0));""",
     'test-ten225-suspended-guard.mjs')

# ── ITEM 3's tests: the ATP exclusion is superseded ───────────────────────
edit('j-close: ATP is IN, on the August window the founder asked for',
     """test('ATP, WTA and the team events are NOT — the ATP window is unmeasured and Davis Cup has no bet365 close at all', () => {
  for (const t of ['ATP US Open', 'ATP Davis Cup - World Group II', 'WTA Guadalajara',
                   'Billie Jean King Cup', 'ATP Cincinnati'])
    assert.equal(api.mxJLevel({ tour: t }), false, t);
});""",
     """test('ATP is IN — superseded 2026-09-19 on the August window', () => {
  // SUPERSEDED, REWRITTEN NOT DELETED. This asserted ATP was refused, which was
  // right while the ATP sample was n=1. Eight August days give n=199 joined
  // against our own pinned bet365 close: median |Δ implied| 0.06pp, against
  // 0.80-1.48pp for every other book on the same fixtures. ATP now agrees more
  // tightly than Challenger (0.08pp), the tier already wired.
  for (const t of ['ATP US Open', 'ATP Cincinnati', 'ATP Winston-Salem'])
    assert.equal(api.mxJLevel({ tour: t }), true, t);
});

test('WTA and the team events stay OUT, as ruled', () => {
  for (const t of ['WTA Guadalajara', 'WTA 125K Series', 'Billie Jean King Cup',
                   'ATP Davis Cup - World Group II', 'Laver Cup', 'United Cup'])
    assert.equal(api.mxJLevel({ tour: t }), false, t);
});

test('a Davis Cup tie is refused even though its name STARTS "ATP"', () => {
  // The feed names every tie "ATP Davis Cup - World Group ...". With ATP now in
  // scope, an ATP test running before the team-event test would admit the one
  // tier where this close does not exist at all (bet365: 0 of 33). The order of
  // those two tests inside mxJLevel is the guard, so it gets its own assertion.
  assert.equal(api.mxJLevel({ tour: 'ATP Davis Cup - World Group I' }), false);
  assert.equal(api.mxJLevel({ tour: 'ATP Billie Jean King Cup' }), false);
});""",
     'test-ten225-j-close.mjs')

edit('j-close: the out-of-scope case is WTA now, not ATP',
     """test('out of scope, it fills nothing — an ATP dash stays a dash', () => {
  const m = { tour: 'ATP US Open', apiTennisClose: { ...J } };
  assert.equal(api._mcCloseOf(m, 'p1'), null);
  assert.equal(api.mxCloseIsJ(m, 'p1'), false);
});""",
     """test('out of scope, it fills nothing — a WTA dash stays a dash', () => {
  // Was ATP; ATP is in scope now. WTA carries the case because it is the tier
  // that is genuinely unmeasured against our own closes.
  const m = { tour: 'WTA Guadalajara', apiTennisClose: { ...J } };
  assert.equal(api._mcCloseOf(m, 'p1'), null);
  assert.equal(api.mxCloseIsJ(m, 'p1'), false);
});

test('an ATP fixture that would dash NOW fills, and is labelled', () => {
  const m = { tour: 'ATP Cincinnati', apiTennisClose: { ...J } };
  assert.equal(api._mcCloseOf(m, 'p1'), 1.35);
  assert.equal(api.mxCloseIsJ(m, 'p1'), true);
});""",
     'test-ten225-j-close.mjs')

# ── ITEM 6 — THE 13 UNWIRED SUITES, AND THE ONE THAT WAS RED ─────────────
# Audited in a clean worktree at origin/main (the shared checkout is stale and
# reported my own TEN-225 wiring as missing — a false alarm from the same
# stale-checkout hazard that caused the clobber). 67 suite files, 54 wired, 13
# not: 10 tools/*.js from the TEN-196/206/228 era and 3 python.
#
# 12 of the 13 are GREEN. One is red and it is mine — see below.
edit('CI: the 10 unwired node suites join the run',
     """node tools/test-no-ci-annotation-noise.js""",
     """node tools/test-no-ci-annotation-noise.js && node tools/test-every-suite-is-wired.js && node tools/test-history-freshness.js && node tools/test-holdbreak-engine.js && node tools/test-indoor-court.js && node tools/test-market-edge-basis.js && node tools/test-open-provenance.js && node tools/test-player-search-index.js && node tools/test-pp2-reconcile.js && node tools/test-round-label.js && node tools/test-slam-boxes.js && node tools/test-trading-colour-directions.js && node --test test-ten225-book-ladder.mjs && python3 test-ten225-free-leg-attribution.py && python3 test-ten232-entitlement-watch.py && python3 tools/test-first-appearance-billed.py""",
     'package.json')

# ⚠️ THE ONE RED SUITE, AND IT WENT RED ON A COMMENT I WROTE.
#
# tools/test-open-provenance.js guards TEN-198's no-retroactive-backfill ruling:
# the api-tennis sighting carrier may only ever be written straight from a live
# get_odds call. It asserts that by checking the carrier's two write sites and
# then that each source variable is "bound to" fetchApiTennisMatchOdds() —
# implemented as a regex allowing at most 200 characters between them.
#
# My bulk-by-date switch (64c7237a) added a two-line comment inside the
# Promise.all that binds `pastOdds`. The distance went 121 -> 258 characters and
# the guard went red. MEASURED, not inferred: both numbers are from the file.
#
# THE RULING IS FULLY HONOURED — still exactly 2 write sites, both of the form
# `if (X.bet365) match.apiTennisBet365 = X.bet365;`, and both X bound to a live
# call. What failed was an assertion measuring PROXIMITY when it meant BINDING.
# So it is fixed to parse the binding statement, not to count characters: a
# comment must never be able to turn a ruling red, and widening the window to
# 400 would only move the day it happens again.
BLOCK_EDITS = []


def edit_block(path, name, start_marker, end_marker, new, done_marker):
    """Replace everything from `start_marker` through `end_marker`.

    Used where the target text contains regex backslashes: hand-escaping those
    through two layers of quoting is how the exact-match edit above failed, and
    an anchor I cannot type reliably is not an anchor. Both markers are plain
    substrings with no escapes in them.
    """
    BLOCK_EDITS.append((path, name, start_marker, end_marker, new, done_marker))


edit_block(
    'tools/test-open-provenance.js',
    'open-provenance: assert the BINDING, not the distance to it',
    '  // ...and both of those variables must actually be that live call, not a re-bind.',
    'is not bound to a live fetchApiTennisMatchOdds() call`);\n  }',
    r"""  // ...and both of those variables must actually be that live call, not a re-bind.
  //
  // THIS ASSERTS THE BINDING, NOT THE DISTANCE TO IT. It used to allow at most
  // 200 characters between the variable and the call, which is a proxy for
  // "bound to" rather than the thing itself. On 2026-09-19 a two-line COMMENT
  // added inside the Promise.all that binds `pastOdds` pushed that gap from 121
  // to 258 characters and turned this guard red while the ruling was fully
  // honoured — still exactly two write sites, both assigning straight from a
  // live call. A comment must not be able to fail a ruling, and widening the
  // window would only postpone the day it happens again.
  //
  // Now: find the declaration that binds the variable, consume it to its
  // terminating `;` with brackets balanced, and require the live call INSIDE
  // that statement. A re-bind from anything else still fails, which is the
  // property TEN-198 actually needs.
  const srcAll = lines.join('\n');
  for (const v of ['pastOdds', 'upOdds']) {
    const re = new RegExp(`(?:const|let|var)\\s+(?:\\[[^\\]]*\\b${v}\\b[^\\]]*\\]|${v}\\b)\\s*=`);
    const m = re.exec(srcAll);
    assert.ok(m, `no declaration found for ${v}`);
    let depth = 0, end = -1;
    for (let i = m.index; i < srcAll.length; i++) {
      const c = srcAll[i];
      if (c === '[' || c === '{' || c === '(') depth++;
      else if (c === ']' || c === '}' || c === ')') depth--;
      else if (c === ';' && depth === 0) { end = i; break; }
    }
    assert.ok(end > 0, `the declaration of ${v} is not terminated`);
    const stmt = srcAll.slice(m.index, end + 1);
    assert.ok(/fetchApiTennisMatchOdds\(/.test(stmt),
      `${v} is not bound to a live fetchApiTennisMatchOdds() call:\n${stmt}`);
  }""",
    'THIS ASSERTS THE BINDING, NOT THE DISTANCE TO IT')



def main():
    root = sys.argv[1] if len(sys.argv) > 1 else '.'
    if os.path.isfile(root):
        root = os.path.dirname(root)
    cache, applied, already = {}, 0, 0
    for path, name, old, new in EDITS:
        full = os.path.join(root, path)
        src = cache.get(full)
        if src is None:
            src = cache[full] = open(full, encoding='utf-8').read()
        # The RESULT first: several edits insert before an anchor they keep, so
        # the anchor still matches after a successful apply and testing it first
        # made an earlier script re-insert four blocks on a replay.
        if src.count(new) >= 1:
            already += 1
            print(f'  ok (already applied)  {path}: {name}')
            continue
        n = src.count(old)
        if n != 1:
            raise SystemExit(f'::error:: anchor count {n} (want 1) in {path}: {name}')
        cache[full] = src.replace(old, new)
        applied += 1
        print(f'  applied               {path}: {name}')
    for path, name, sm, em, new, done in BLOCK_EDITS:
        full = os.path.join(root, path)
        src = cache.get(full) or open(full, encoding='utf-8').read()
        if done in src:
            already += 1
            print(f'  ok (already applied)  {path}: {name}')
            cache[full] = src
            continue
        i = src.find(sm)
        j = src.find(em, i)
        if i < 0 or j < 0:
            raise SystemExit(f'::error:: block anchors NOT FOUND in {path}: {name}')
        cache[full] = src[:i] + new + src[j + len(em):]
        applied += 1
        print(f'  applied               {path}: {name}')
    for full, src in cache.items():
        open(full, 'w', encoding='utf-8').write(src)
    print(f'\n{applied} applied, {already} already in place, '
          f'{len(EDITS) + len(BLOCK_EDITS)} total')


if __name__ == '__main__':
    main()
