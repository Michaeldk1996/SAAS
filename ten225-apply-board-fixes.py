#!/usr/bin/env python3
"""TEN-225 items 1/2/4 — apply the founder's 2026-09-19 live-board rulings.

Written as a SCRIPT rather than made by hand, for one reason that is itself the
subject of item 1: this checkout is shared with concurrent runs, and a run that
resets the working tree destroys hand edits silently. It destroyed this change
set once already at 11:17:19Z. A replayable patch survives that; a hand edit
does not, and the last time a hand edit lost this argument the result was the
Underway chip going back onto the live board.

Every replacement is exact-match and asserted, so a drifted source fails here
instead of producing a half-applied file.

Usage: python3 ten225-apply-board-fixes.py <repo-root>
"""
import os
import sys

EDITS = []
DASH = 'bsp-consult-dashboard.html'


def edit(name, old, new, path=DASH):
    EDITS.append((path, name, old, new))


# ── ITEM 1 — the Underway chip, removed for the second time ────────────────
edit('css: drop the .mc-underway rule', '''  /* TEN-8 "Underway" — display-only state marker for a match whose start instant
     has passed but which the feed has no final score for (see cardStartMs check in
     renderMatches). Deliberately NOT a live indicator: neutral muted colour, no
     warn/red, no dot, no animation — it reads as a state, not an event, and sits in
     the same .mc-scoreline slot a live score will later occupy. */
  [data-page="matches"] .mc-scoreline.underway{ align-items:center; }
  [data-page="matches"] .mc-underway{ font-family:var(--mx-font-ui); font-size:10px; font-weight:600; letter-spacing:0.09em; text-transform:uppercase; color:var(--mc-muted-2); background:rgba(255,255,255,0.045); border:1px solid var(--mc-border-data); border-radius:5px; padding:2px 8px; }
  /* TEN-8 terminal chip — "Retired"/"Walkover" status marker. Same neutral,
     state-not-event treatment as Underway (no red, no dot). On a retirement it
     replaces the partial set-score cluster (the "game" has no added value once a
     player retired — founder's call); on a scoreless walkover it sits in the
     .mc-scoreline slot in place of the wrong "Underway" marker. */''', '''  /* Chip-carrying score line — baseline alignment is wrong for a bordered chip, so
     the row centres instead. Its one remaining user is the terminal chip below; the
     TEN-8 "Underway" marker that also used it was removed on the founder's ruling
     (2026-09-18, TEN-225) for breaking card symmetry, and `.mc-underway` went with
     it rather than being left as a dead rule.
     REMOVED TWICE. The first removal (2ed98d15) was clobbered back in by my own
     commit 1d6c042f, which wrote a whole-file blob taken from a shared checkout
     that had drifted behind main — not a second render path, and not somebody
     else's revert. test-ten225-no-underway-chip.mjs is the standing guard: it
     fails the build on any reappearance of this rule or of the branch it served. */
  [data-page="matches"] .mc-scoreline.underway{ align-items:center; }
  /* TEN-8 terminal chip — "Retired"/"Walkover" status marker. Neutral,
     state-not-event treatment (no red, no dot). On a retirement it
     replaces the partial set-score cluster (the "game" has no added value once a
     player retired — founder's call); on a scoreless walkover it sits in the
     .mc-scoreline slot, which is truthful where "Underway" would not have been. */''')

edit('css: stale cross-reference in the TEN-179 q3 note',
     '     The Upcoming and live .mc-termchip / .mc-underway markers are untouched. */',
     '     The Upcoming and live .mc-termchip markers are untouched. */')

edit('render: drop the started-but-scoreless branch', '''    } else if (!finalScore && isFinite(cardStartMs(m)) && Date.now() >= cardStartMs(m)) {
      // TEN-8 "Underway": derived purely from the client clock — the start instant
      // has passed and the feed carries no final score yet. Independent of m.live,
      // so it's true even before (or without) the feed's in-play flag, which at our
      // ~hourly refresh cadence can lag badly. It makes NO score/clock/set claim; it
      // only asserts "this has started", which is why a member can't bet it. When the
      // live poller lands, formatLiveScore replaces this in the very same slot.
      // Guarded on a reliable start instant (cardStartMs finite) — a match with no
      // usable start time gets nothing here, never a guess.
      scoreLineHtml = `<div class="mc-scoreline underway"><span class="mc-underway">Underway</span></div>`;
    }''', '''    }
    // REMOVED (founder ruling, 2026-09-18, TEN-225): the TEN-8 client-clock
    // "Underway" chip. It occupied the .mc-scoreline slot on a started-but-
    // scoreless card and on nothing else, so one card on the grid grew a row its
    // neighbours did not have — "it breaks the whole card symmetry with the
    // others. Just remove it." A started fixture renders NO score line until the
    // feed supplies a real one; the m.live branch above (formatLiveScore) still
    // fills the same slot once there is an actual score, and the started-ness test
    // itself survives as `mcStarted` below, which the drift column reads.
    //
    // IT CAME BACK ONCE AND THIS IS WHY. Commit 1d6c042f (2026-09-19, the header
    // clock) landed a whole-file blob taken from a shared checkout that had drifted
    // behind main, silently reverting 2ed98d15 — and TEN-206's event-coverage fetch
    // with it. Not a second render path; a stale-blob clobber. The standing guard
    // is test-ten225-no-underway-chip.mjs. Do not reintroduce a marker here whose
    // only content is "this has started".''')

# ── collateral of the same clobber: TEN-206's event-coverage fetch ─────────
edit('restore: matchStatEventCoverage declaration',
     """  if (!('matchStats' in window)) window.matchStats = null;
  // §5.3 Record per tournament: the edition store carries no date, no surface""",
     """  if (!('matchStats' in window)) window.matchStats = null;
  // Q2 third clause: the per-EVENT coverage index behind the match sheet's
  // whole-event note. null means "not fetched yet"; the renderer emits no note at
  // all without it, so an absent fetch loses the sentence and never the sheet.
  // RESTORED 2026-09-19 — TEN-206 landed this in 46f44a15 and my own 1d6c042f
  // clobbered it out with the same stale whole-file blob that brought the Underway
  // chip back. Collateral of one mistake, so it is repaired in the same commit.
  if (!('matchStatEventCoverage' in window)) window.matchStatEventCoverage = null;
  // §5.3 Record per tournament: the edition store carries no date, no surface""")

edit('restore: the paired event-coverage fetch',
     """  _pp2StatsPromise = fetch('./historical-match-stats.json', { cache: 'no-cache' })
    .then(res => res.ok ? res.json() : null)
    .then(j => { window.matchStats = j || {}; pp2RepaintIfOpen(key); })
    .catch(() => { window.matchStats = {}; pp2RepaintIfOpen(key); });
  return _pp2StatsPromise;""",
     """  // Two fetches on the same trigger, settled TOGETHER. The 51 KB event-coverage
  // index rides along with the store because both feed the same sheet, and racing
  // them separately would repaint once with the note missing and again with it
  // present — a sentence appearing a beat later reads as a glitch.
  // Promise.allSettled, not all: the index is additive, and losing it must cost the
  // note and never the box scores.
  // RESTORED 2026-09-19; see the matchStatEventCoverage declaration above.
  _pp2StatsPromise = Promise.allSettled([
    fetch('./historical-match-stats.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null),
    fetch('./match-stat-event-coverage.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null),
  ]).then(([stats, cov]) => {
    window.matchStats = (stats.status === 'fulfilled' && stats.value) || {};
    // Left null, NOT {}, when it does not land. The renderer treats null as "no
    // index" and stays silent; an empty object would look like a fully-built index
    // that happens to know no events, which is the same silence for the wrong
    // reason and would hide a broken build.
    window.matchStatEventCoverage = (cov.status === 'fulfilled' && cov.value) || null;
    pp2RepaintIfOpen(key);
  });
  return _pp2StatsPromise;""")

# ── ITEM 4 — the impossible-leg floor the 20% pair test cannot see ─────────
edit('guard: MX_MIN_REAL_PRICE constant', '''// WHY A PAIR TEST AND NOT A PRICE TEST. 1.01 alone is a legitimate price on a
// fixture that is 100-to-1 on. It is 1.01 AGAINST 1.01 that is impossible. Any
// single-price rule would either miss the sentinel or suppress real favourites.
const MX_SUSPENDED_OVERROUND = 0.20;''', '''// WHY A PAIR TEST AND NOT ONLY A PRICE TEST. 1.01 alone can be a real price on a
// fixture that is 100-to-1 on. It is 1.01 AGAINST 1.01 that is impossible, and no
// single-price rule catches that pair at all.
//
// ── AND WHY THE PAIR TEST WAS NOT ENOUGH (founder, 2026-09-19) ──
// "Dougaz 1.00/1.00 is not a price. The 20% overround guard should have caught
// it — report why it did not, and extend it to catch any leg at or below 1.01."
//
// WHY IT DID NOT FIRE. The pair is not suspended-looking at all. MEASURED on the
// deployed board 2026-09-19: bet365 quotes Dougaz v Murtaza at 1.004 / 17.00, an
// overround of 5.5% — sharper than that book's own median. The card rounds 1.004
// to two places and prints "1.00". So the PAIR is ordinary and the LEG is
// impossible, which a pair test cannot see by construction. Marathon prices the
// same fixture at exactly 1.00 / 9.80, overround 10.2%: same shape.
//
// I argued the other way on 2026-09-18 and the founder has ruled. He is right
// about the number a member actually sees: 1.004 returns 0.4% of stake and 1.00
// returns nothing, and neither is something anyone can act on.
//
// MEASURED COST, deployed board 2026-09-19, n=64 fixtures: 7 carry a leg at or
// below 1.01 on at least one path — Dougaz/Murtaza, Van Herck/Piros,
// Photiades/Kravchenko, Dlimi/Adeleye, Duran/Borges, Cruz/Faria, Prado
// Angelo/Wong. They do not dash: like every other suppression they fall through
// the ladder, and dash only if every book quotes an impossible leg. Two of those
// legs are an honest 1.01 rather than a rounded-to-nothing 1.004, so this rule
// does cost a real price on a genuine 1/100 favourite. Reported, not buried.
const MX_SUSPENDED_OVERROUND = 0.20;
// A leg at or below this returns so little that it is not a bettable price, and
// at 1.00 it returns nothing at all. ABSOLUTE, not relative — which is the whole
// point, because the pair around such a leg can be perfectly ordinary.
const MX_MIN_REAL_PRICE = 1.01;''')

edit('guard: two independent suppression reasons', '''function mxIsSuspendedPair(p1, p2, ctx){
  const ov = mxOverround(p1, p2);
  // null (a missing or non-positive price) is NOT suspension — it is absence,
  // and the existing dash rules already own it. Returning true here would
  // convert every unpriced fixture into a logged suppression.
  if (ov === null || ov <= MX_SUSPENDED_OVERROUND) return false;
  const c = ctx || {};''', '''function mxIsSuspendedPair(p1, p2, ctx){
  const ov = mxOverround(p1, p2);
  // null (a missing or non-positive price) is NOT suspension — it is absence,
  // and the existing dash rules already own it. Returning true here would
  // convert every unpriced fixture into a logged suppression. The null test comes
  // FIRST, so the impossible-leg test below only ever runs on two real numbers.
  if (ov === null) return false;
  // Two independent reasons, recorded separately. Folding them into one flag
  // would leave the log unable to say WHICH rule fired, and the second is new
  // enough that its cost has to stay measurable.
  const wide = ov > MX_SUSPENDED_OVERROUND;
  const unbettable = p1 <= MX_MIN_REAL_PRICE || p2 <= MX_MIN_REAL_PRICE;
  if (!wide && !unbettable) return false;
  const c = ctx || {};''')

edit('guard: record which rule fired', '''    const rec = { id: c.id || null, book: c.book || null, path: c.path || null,
                  p1: p1, p2: p2, overroundPct: +(ov * 100).toFixed(1),
                  firstSeen: new Date().toISOString() };''', '''    const rec = { id: c.id || null, book: c.book || null, path: c.path || null,
                  p1: p1, p2: p2, overroundPct: +(ov * 100).toFixed(1),
                  reason: wide ? (unbettable ? 'wide+unbettable' : 'wide')
                               : 'unbettable-leg',
                  firstSeen: new Date().toISOString() };''')

# ── ITEM 2 — the three card states ────────────────────────────────────────
edit('states: mcStarted no longer means CLOSE', '''    // TEN-225 ruling 4c — "has this fixture started?", the client-clock test the card
    // already uses for its Underway marker (see scoreLineHtml). Defined ONCE here so
    // the drift cell, its column header and the marker cannot disagree about it.
    const mcStarted = !finalScore && isFinite(cardStartMs(m)) && Date.now() >= cardStartMs(m);
    // The drift cell's right-hand value. Before the off it is the Now; after the off
    // it is the CLOSE, because a started fixture's current price is a settled price
    // and not a current one — that is why the Now is withheld in the first place.
    //
    // MEASURED CONSEQUENCE, deployed board 2026-09-18, reported rather than routed
    // around: n=1 fixture is affected today (Kwon/Suresh) and it renders Open + a
    // DASH, not Open + Close — because `close_price` is NULL on every sports411 row
    // in odds_card_state. The cause is upstream and already on the founder's list:
    // `start_ts_source` is 'none' for every Kibl row, so the publisher can never
    // promote that book's last pre-start tick to a Close. Its last tick (01:40Z) is
    // 3h25m BEFORE the 05:05Z off, i.e. a genuine pre-play price that nothing is
    // allowed to label. That is item I(b) — live_flip_log as the primary path to a
    // Kibl Close — and this dash is its visible symptom on the board.''', '''    // "Has this fixture started?" — the client-clock test. Defined ONCE here so the
    // drift column and its header cannot disagree about it.
    const mcStarted = !finalScore && isFinite(cardStartMs(m)) && Date.now() >= cardStartMs(m);
    // ──────────────────── TEN-225 — THE THREE CARD STATES (founder, 2026-09-19) ──
    // Verbatim: "UPCOMING (not started): OPEN and NOW. UNDERWAY (started, not
    // finished): OPEN and NOW. If the book has stopped quoting, keep showing the
    // last pre-match price as Now and label it as such — never an empty CLOSE
    // column. COMPLETED (finished): OPEN and CLOSE only."
    //
    // THIS REVERSES RULING 4c, which I built on 2026-09-18 and which was wrong on
    // the board. An underway card relabelled its header to CLOSE and resolved the
    // value through `_mcCloseOf`. But a close is only computed for a fixture with a
    // resolved start AND a finished series, so on a fixture that has merely started
    // it is null — the header asserted a value that cannot exist yet, and dashed
    // over a real price to do it. MEASURED on the deployed board 2026-09-19:
    // De Minaur v Kasnikowski and Hsu v Wallin, both ~12 min past their off, both
    // rendering OPEN / CLOSE with CLOSE dashed on both sides.
    //
    // So a non-finished card's right-hand column is ALWAYS the Now. Where the book
    // really has stopped quoting, it falls back to the recorded last pre-start cut
    // — the same number `_mcCloseOf` returns, presented as what it is: the last
    // price before the off, not a settled close. `_nowTitleFor` says so on hover,
    // and `mcLastPreMatch` is what tells the two cases apart.''')

edit('states: a started fixture resolves a Now, not a Close', '''    const mcDriftRight = who => {
      if (mcStarted) return _mcCloseOf(m, who);
      if (_dpair) return who === 'p1' ? _dpair.n1 : _dpair.n2;
      if (_openAnchorOf(m, 'p1') != null || _openAnchorOf(m, 'p2') != null) return _mcNowOf(m, who);
      return _dfaceNow ? (_dfaceNow[who] ?? null) : null;
    };''', '''    // The live Now by the ladder, with NO started-fixture special case. Named, so
    // the underway fallback below can ASK whether the book stopped quoting instead
    // of assuming it did the moment the clock passed the scheduled off.
    const _liveNow = who => {
      if (_dpair) return who === 'p1' ? _dpair.n1 : _dpair.n2;
      if (_openAnchorOf(m, 'p1') != null || _openAnchorOf(m, 'p2') != null) return _mcNowOf(m, who);
      return _dfaceNow ? (_dfaceNow[who] ?? null) : null;
    };
    // TRUE only when the fixture is underway AND the ladder has no current price on
    // EITHER side — i.e. the book really has gone quiet, rather than one leg being
    // momentarily absent. Per-leg would let one side read "last pre-match" while
    // the other read as current: two different claims on one row.
    const mcLastPreMatch = mcStarted
      && _liveNow('p1') == null && _liveNow('p2') == null
      && (_mcCloseOf(m, 'p1') != null || _mcCloseOf(m, 'p2') != null);
    const mcDriftRight = who => {
      const n = _liveNow(who);
      if (n != null) return n;
      // Underway with the book gone quiet: the last price before the off, shown in
      // the Now slot and labelled as such. Never on an UPCOMING card — before the
      // off there is no "last pre-match price" to carry, and a close on a fixture
      // that has not started would be a value out of its own future.
      if (mcStarted) return _mcCloseOf(m, who);
      return null;
    };''')

edit('states: the hover carries the last-pre-match qualifier', '''      const px = mcDriftRight(who);
      if (mcStarted){
        const o = _ocsOf(m);
        const book = o ? o.book : ((m.closingOdds && m.closingOdds.bookmaker) || null);
        if (!book) return '';
        return mcPriceTitle({ book, at: o ? (o.p1.closeTs || o.p2.closeTs) : null,
                              kind: o ? (o.tsKind || null) : null }, px);
      }''', '''      const px = mcDriftRight(who);
      // Underway, book gone quiet. The value is the last price before the off and
      // the hover says exactly that. The column header still reads NOW, because
      // that is the slot the member is looking at — so the qualifier has to live
      // here, or the number claims a currency it does not have.
      if (mcLastPreMatch){
        const o = _ocsOf(m);
        const book = o ? o.book : ((m.closingOdds && m.closingOdds.bookmaker) || null);
        if (!book) return '';
        return mcPriceTitle({ book, at: o ? (o[who].closeTs || null) : null,
                              kind: o ? (o.tsKind || null) : null,
                              note: 'last price before the off' }, px);
      }''')

edit('states: mcPriceTitle carries a qualifier line', '''  const first = bookClock ? head + ' since ' + bookClock : head;
  if (!seenClock) return first;
  const one = first + ' · seen ' + seenClock;
  return one.length <= MC_TITLE_1LINE_MAX ? one : first + '\\nseen ' + seenClock;
}''', '''  const first = bookClock ? head + ' since ' + bookClock : head;
  // `note` — a qualifier about WHAT the number is, not about when it was seen.
  // Used by the underway card whose book has stopped quoting, where the Now slot
  // carries the last price before the off. Always on its own line: the founder's
  // one-line format is a contract about the two clocks, and a qualifier squeezed
  // into it would be the first thing to fall off the end of the slot.
  const tail = pair.note ? '\\n' + pair.note : '';
  if (!seenClock) return first + tail;
  const one = first + ' · seen ' + seenClock;
  return (one.length <= MC_TITLE_1LINE_MAX ? one : first + '\\nseen ' + seenClock) + tail;
}''')

edit('states: the header never says CLOSE on a non-finished card',
     """        ? `<span class="mc-colhead-drift"><span>Open</span><span></span><span>${mcStarted ? 'Close' : 'Now'}</span><span></span></span>`""",
     """        // TEN-225, founder 2026-09-19: a NON-FINISHED card's right-hand column is
        // "Now" in every case — upcoming and underway alike. The 4c relabel to
        // "Close" is gone: "never an empty CLOSE column". Where the fixture is
        // underway and the book has stopped quoting, the value is the last
        // pre-match price and the hover carries that qualifier (see _nowTitleFor).
        // CLOSE now appears only on the completed branch above, which is the only
        // state in which a close exists at all.
        ? `<span class="mc-colhead-drift"><span>Open</span><span></span><span>Now</span><span></span></span>`""")


# ── TWO EXISTING HARNESSES THAT STOPPED GUARDING ──────────────────────────
# Both are sandboxes that evaluate the shipped source against a fixed stub set,
# so a new free identifier in the function under test makes them throw — and a
# throwing harness is a harness that has silently stopped asserting anything.
# test-ten225-both-clocks.mjs has been red on main since G1 (c4eab0b7) added
# mxBookLabel to mcPriceTitle: 8 pass / 17 fail, measured on origin/main
# 71011340 BEFORE any change in this patch. I did not notice, which is the same
# class of miss as the chip.
edit('both-clocks: stub the identifiers mcPriceTitle has since acquired',
     """const shipped = ['ocsFmtTs', 'ocsFmtClock', 'mcPriceTitle', '_obsMs', '_measurablePair'].map(slice).join('\\n');
const { mcPriceTitle, _measurablePair, _obsMs } = new Function(`
  const MC_TITLE_1LINE_MAX = ${MAX};
  ${shipped}
  return { mcPriceTitle, _measurablePair, _obsMs };
`)();""",
     """// The stub set is NOT a fixed list — every free identifier the shipped functions
// reach for has to be declared here, or the sandbox throws and every assertion
// below stops running while the file still looks like a test suite. That is what
// happened when G1 (c4eab0b7) put mxBookLabel inside mcPriceTitle: this file went
// 8/17 red on main and nothing surfaced it. `newsTz` and `mxBookLabel` are
// stubbed to identity/UTC so the assertions stay about CLOCK SELECTION, which is
// what this file is for — the labels have their own tests.
const shipped = ['ocsFmtTs', 'ocsFmtClock', 'mcPriceTitle', '_obsMs', '_measurablePair'].map(slice).join('\\n');
const { mcPriceTitle, _measurablePair, _obsMs } = new Function(`
  const MC_TITLE_1LINE_MAX = ${MAX};
  const newsTz = () => 'UTC';
  const mxBookLabel = b => b;
  ${shipped}
  return { mcPriceTitle, _measurablePair, _obsMs };
`)();""",
     'test-ten225-both-clocks.mjs')

edit('both-clocks: the second sandbox needs the same stubs',
     """const fmt = new Function(`${slice('ocsFmtTs')}\\n${slice('ocsFmtClock')} return ocsFmtClock;`)();""",
     """const fmt = new Function(
  `const newsTz = () => 'UTC';\\n${slice('ocsFmtTs')}\\n${slice('ocsFmtClock')} return ocsFmtClock;`)();
// ocsFmtClock prints a BARE time for today and a dated one otherwise — correctly,
// since a bare "23:45" on a yesterday stamp would understate the tooltip's own
// age. That makes any fixture with a hardcoded calendar date a test that AGES:
// written on 2026-09-18 it asserted a 39-character one-liner, and by 2026-09-19
// the same call returns "Sep 18 09:08 AM" and wraps. The two format tests below
// therefore build their instants from TODAY; the clock VALUES are still asserted
// against the page's own formatter, never against a literal.
const DTODAY = new Date().toISOString().slice(0, 10);""",
     'test-ten225-both-clocks.mjs')

edit('both-clocks: the format test uses today, not a frozen calendar date',
     """  const t = mcPriceTitle(
    { book: 'bet365', at: '2026-09-18T01:08:52Z', obs: '2026-09-18T09:15:00Z', kind: 'book-tick' },
    1.22);
  assert.equal(t, `bet365 · 1.22 since ${fmt('2026-09-18T01:08:52Z')} · seen ${fmt('2026-09-18T09:15:00Z')}`);""",
     """  const AT = `${DTODAY}T01:08:52Z`, OBS = `${DTODAY}T09:15:00Z`;
  const t = mcPriceTitle({ book: 'bet365', at: AT, obs: OBS, kind: 'book-tick' }, 1.22);
  assert.equal(t, `bet365 · 1.22 since ${fmt(AT)} · seen ${fmt(OBS)}`);""",
     'test-ten225-both-clocks.mjs')

edit('both-clocks: the wrap CONTROL uses today too',
     """  const t = mcPriceTitle(
    { book: 'a-very-long-bookmaker-name', at: '2026-09-18T01:08:52Z',
      obs: '2026-09-18T09:15:00Z', kind: 'book-tick' }, 1.22);""",
     """  const t = mcPriceTitle(
    { book: 'a-very-long-bookmaker-name', at: `${DTODAY}T01:08:52Z`,
      obs: `${DTODAY}T09:15:00Z`, kind: 'book-tick' }, 1.22);""",
     'test-ten225-both-clocks.mjs')

edit('both-clocks: and its short-form control',
     """  const short = mcPriceTitle(
    { book: 'bet365', at: '2026-09-18T01:08:52Z', obs: '2026-09-18T09:15:00Z', kind: 'book-tick' }, 1.22);
  assert.ok(!short.includes('\\n'));""",
     """  const short = mcPriceTitle(
    { book: 'bet365', at: `${DTODAY}T01:08:52Z`, obs: `${DTODAY}T09:15:00Z`, kind: 'book-tick' }, 1.22);
  assert.ok(!short.includes('\\n'), `the short form wrapped: ${JSON.stringify(short)}`);""",
     'test-ten225-both-clocks.mjs')

edit('suspended-guard: the sandbox needs the new impossible-leg constant',
     """    ${sliceConst('MX_SUSPENDED_OVERROUND')}
    const MX_SUPPRESSED = new Map();""",
     """    ${sliceConst('MX_SUSPENDED_OVERROUND')}
    ${sliceConst('MX_MIN_REAL_PRICE')}
    const MX_SUPPRESSED = new Map();""",
     'test-ten225-suspended-guard.mjs')

# These three assertions encode MY 2026-09-18 reading ("1.01 alone is a
# legitimate price"), which the founder reversed on 2026-09-19. They are
# REWRITTEN to the new rule rather than deleted, so they keep guarding the thing
# that still matters — that the guard is a sentinel detector and not a margin
# referee — while asserting the ruling that is actually in force.
edit('suspended-guard: the 1.01 leg is now the RULE, not the counter-example',
     """  check('a real 1/10-on favourite at 1.01 against a 15.0 dog stays a price: it is '
      + '1.01 AGAINST 1.01 that is impossible, not 1.01 itself',
        !api.mxIsSuspendedPair(1.01, 15.0), (ov(1.01, 15.0) * 100).toFixed(1) + '%');""",
     """  check('the impossible-leg floor is the ruled 1.01, read from the shipped constant',
        api.MX_MIN_REAL_PRICE === 1.01, String(api.MX_MIN_REAL_PRICE));
  // SUPERSEDED, DELIBERATELY REWRITTEN RATHER THAN DELETED. This used to assert
  // that 1.01 against a 15.0 dog STAYS a price — my reading on 2026-09-18. The
  // founder reversed it on 2026-09-19 ("extend it to catch any leg at or below
  // 1.01"), after bet365's 1.004/17.00 on Dougaz v Murtaza rendered as "1.00"
  // with an overround of 5.5% — ordinary pair, impossible leg. The assertion
  // keeps its job: it still pins WHERE the line is, on the same numbers.
  check('an impossible LEG is now caught even inside an ordinary pair — 1.004/17.00 '
      + 'is a 5.5% overround and was the defect the pair rule could not see',
        api.mxIsSuspendedPair(1.004, 17.0), (ov(1.004, 17.0) * 100).toFixed(1) + '%');
  check('...and the boundary holds: 1.02 against 10.5 is untouched',
        !api.mxIsSuspendedPair(1.02, 10.5), (ov(1.02, 10.5) * 100).toFixed(1) + '%');""",
     'test-ten225-suspended-guard.mjs')

edit('suspended-guard: the honest board no longer includes an impossible leg',
     """    { id: 'c', bet365Now: { p1: 1.01, p2: 15.0, at: null, observedAt: null } },
  ] });
  const got = api.matches.map(m => api._mcNowPair(m));
  check('all three honest fixtures still price', got.every(p => p && p.p1 > 0),
        got.map(p => p ? `${p.book} ${p.p1}/${p.p2}` : 'DASH').join(' | '));""",
     """    // Was 1.01/15.0 — a leg the founder's 2026-09-19 rule now suppresses, so it
    // is no longer an "honest board" fixture. Replaced by 1.02/10.5, which is a
    // real short-priced favourite measured on the deployed board and which the
    // floor deliberately leaves alone: the point of this block is that the guard
    // is INVISIBLE on normal pricing, and a short price is normal.
    { id: 'c', bet365Now: { p1: 1.02, p2: 10.5, at: null, observedAt: null } },
  ] });
  const got = api.matches.map(m => api._mcNowPair(m));
  check('all three honest fixtures still price', got.every(p => p && p.p1 > 0),
        got.map(p => p ? `${p.book} ${p.p1}/${p.p2}` : 'DASH').join(' | '));""",
     'test-ten225-suspended-guard.mjs')

edit('suspended-guard: export the new constant so assertions can pin it',
     """    return { ${FNS.join(', ')}, MX_SUPPRESSED, WARNED, matches, OCS,
             MX_SUSPENDED_OVERROUND };""",
     """    return { ${FNS.join(', ')}, MX_SUPPRESSED, WARNED, matches, OCS,
             MX_SUSPENDED_OVERROUND, MX_MIN_REAL_PRICE };""",
     'test-ten225-suspended-guard.mjs')


# ── ITEM 5 — WHICH BET365, recorded so nobody re-derives it ───────────────
edit('CLAUDE.md: record which bet365 this is',
     """## Data sources — confirmed status

| Source | What it provides | Status |""",
     """## Data sources — confirmed status

### WHICH BET365 — settled, do not re-derive (founder, 2026-09-19)

bet365 runs different sites per jurisdiction with different margins and
different prices on the same match, so "bet365" alone is not a source. The
answer, measured:

* **Oddspapi's is the UNQUALIFIED `bet365`** — distinct from the nine country
  variants its `/v4/bookmakers` catalogue lists as separate bookmaker rows
  (NJ, AR, BR, DE, ES, FR, GR, IT, NL). Our entitlement record is a bare slug
  plus two booleans: no id, no display name, no region, no country.
* **Which physical site it is scraped from is UNKNOWN.** Oddspapi does not say,
  and we are not inferring it. Record it as unknown rather than guessing.
* **api-tennis's `bet365` is the SAME BOOK.** Measured over 130 commits of
  `matches.json` — every commit is a simultaneous observation of both feeds —
  **n=820 pre-match leg-observations, 94.5% identical** to the oddspapi tick
  current at that instant, 1.1% matching an earlier tick, 4.4% matching no tick
  we hold. ⚠️ Those last two are bounds, not exact: our oddspapi leg is sampled
  hourly, so a tick between two of our reads is invisible and an api-tennis
  price matching it lands in the disagree bucket. 4.4% is an upper bound on
  disagreement. The disagreement cases mostly have one side exact and the other
  stale, which is the signature of a stale leg, not a different jurisdiction.
* api-tennis truncates to 2dp and never rounds, so it is never better than
  oddspapi and up to 0.01 worse — a systematic downward shade. That is why
  TEN-198 excludes a vendor-pinned open from any figure measured in percent.
* **BetVictor and Bet105 are absent from oddspapi's 360-row catalogue entirely.**
  BetVictor reaches our cards from api-tennis, which is why oddspapi has never
  heard of it.

| Source | What it provides | Status |""",
     'CLAUDE.md')

# ── The founder's new standing rule, and the one workflow that still breaks it
edit('CLAUDE.md: self-chaining workflows run from main or not at all',
     """## Non-negotiables — these are hard rules""",
     """## Non-negotiables — these are hard rules

**A self-chaining workflow runs from `main` or it does not run** (founder
standing rule, 2026-09-19). A workflow that dispatches its own successor must
pass `--ref main`, never `${{ github.ref_name }}`. The reason is measured, not
theoretical: `ten227-upcoming.yml` chained itself from its own branch, so the
gated copy on main was not the copy the runs executed, it wrote no budget-ledger
rows, and it went on running **five more times after the founder ruled it
stopped** — ~65-75 oddspapi units between consecutive run starts, invisible to
every instrument we had. Audited 2026-09-19: `ten216-collector.yml` and
`ten227-bulk-load.yml` dispatch with no `--ref`, which defaults to the default
branch and is compliant; `asapsports.yml` and `points-at-risk.yml` already pass
`--ref main`.""",
     'CLAUDE.md')

edit('ten227-history: chain from main, per the standing rule',
     """          gh workflow run ten227-history.yml --ref "${{ github.ref_name }}" \\""",
     """          # Standing rule (founder, 2026-09-19): "a self-chaining workflow runs
          # from main or it does not run." Was --ref of the run's own ref_name,
          # which is what let ten227-upcoming chain from its own branch past the
          # ruling that stopped it, with the gated copy on main never executing.
          gh workflow run ten227-history.yml --ref main \\""",
     '.github/workflows/ten227-history.yml')

edit('ten227-upcoming: same fix, so re-enabling it cannot restore the defect',
     """          gh workflow run ten227-upcoming.yml --ref "${{ github.ref_name }}" \\""",
     """          # Standing rule (founder, 2026-09-19): from main or not at all. This
          # workflow is disabled_manually and stays that way until the founder
          # says otherwise; the ref is fixed here so that re-enabling it cannot
          # quietly restore the branch-chaining defect along with it.
          gh workflow run ten227-upcoming.yml --ref main \\""",
     '.github/workflows/ten227-upcoming.yml')


def main():
    root = sys.argv[1]
    if os.path.isfile(root):          # tolerate being handed the dashboard itself
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
            raise SystemExit(f'::error:: anchor NOT FOUND and result absent in {path}: {name}\n'
                             f'  the source has drifted; refusing to half-apply')
        if n > 1:
            raise SystemExit(f'::error:: anchor is AMBIGUOUS ({n} hits) in {path}: {name}')
        cache[full] = src.replace(old, new)
        applied += 1
        print(f'  applied               {path}: {name}')
    for full, src in cache.items():
        open(full, 'w', encoding='utf-8').write(src)
    print(f'\n{applied} applied, {already} already in place, {len(EDITS)} total '
          f'across {len(cache)} file(s) under {root}')


if __name__ == '__main__':
    main()
