// TEN-225 — the founder's 2026-09-18 drift rulings, as tests.
//
// Two rulings landed in one message and both are the kind that regress silently,
// because the surface still LOOKS fine when they break — a board that is sorted,
// just wrongly, and a tile that names a real fixture, just not the biggest one.
//
//   RULING — ORDER. "Largest absolute % move first, then smaller moves, then 0%
//   moves, then fixtures with no move computable, then fully unpriced fixtures
//   last." Five tiers. The last two used to share the score -1, so they tied and
//   interleaved; that is how a dash/dash card reached the top of the board.
//
//   RULING — TILE AND SORT AGREE. "The tile and the sort MUST use the same
//   comparator." They share `_mcOpenNowPair`, and what broke that agreement was
//   upstream of both: `_openPinIsVendor` called a fixture a vendor pin when it
//   was not one, so TEN-198's exclusion fired on a population it was never
//   written for and removed the board's largest move from the tile.
//
// The functions are NOT copy-pasted here — they are sliced out of the shipped
// HTML and evaluated, so this file goes red if the page changes and it does not.
// Their collaborators are stubbed off fields on the fixture, which is what lets
// the four override conditions be exercised one at a time.
//
// Run: node --test test-ten225-drift-order.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');

function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found in bsp-consult-dashboard.html`);
  let depth = 0, i = html.indexOf('{', start);
  const open = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  assert.ok(i > open, `${name} braces did not balance`);
  return html.slice(start, i + 1);
}

// The shipped text of the three functions under test, over stubbed resolvers.
// Every stub reads a field the fixture literal sets, so a test can withhold
// exactly one input and see which guard was load-bearing.
const shipped = ['_openPinIsVendor', '_mcHasAnyPrice', 'moveNowScore'].map(slice).join('\n');
const { _openPinIsVendor, moveNowScore, MOVE_NONE, MOVE_UNPRICED } = new Function(`
  const MOVE_NONE = -1, MOVE_UNPRICED = -2;
  const _ocsOf        = m => m.__ocs || null;
  const _openAnchorOf = (m, who) => (m.__ocs ? (m.__ocs[who].open ?? null)
                                             : (m.openingOdds ? (m.openingOdds[who] ?? null) : null));
  const _mcNowOf      = (m, who) => (m.__now ? (m.__now[who] ?? null) : null);
  const _mcNowPair    = m => m.__nowPair || null;
  const _mcOpenNowPair = m => m.__pair || null;
  ${shipped}
  return { _openPinIsVendor, moveNowScore, MOVE_NONE, MOVE_UNPRICED };
`)();

// ── the real rows off the 2026-09-18 board, kept as the corpus ────────────────
// A GENUINE vendor pin: our pipeline wrote it, so it carries the vendor tag and
// deliberately NO `at` (TEN-198 measured the api-tennis timestamp as untrustworthy
// — median 5.2h lag, max 14.6h — so the field is withheld by design).
const SKATOV = () => ({
  p1: 'T. Skatov', p2: 'K. Samrej',
  openingOdds: { p1: 1.44, p2: 2.62, bookmaker: 'bet365',
                 src: 'vendor-sighting', vendor: 'api-tennis',
                 seenAt: '2026-09-17T23:02:56.918Z' },
  __ocs: { book: 'bet365', source: 'api-tennis',
           p1: { open: 1.44 }, p2: { open: 2.62 } },
});
// NOT a vendor pin, though odds_card_state labels it one: matches.json holds the
// same book at the same two prices with a real quote instant, which only the
// oddspapi path can produce.
const MOLLER = () => ({
  p1: 'E. Moller', p2: 'G. Dimitrov',
  openingOdds: { p1: 6.5, p2: 1.091, bookmaker: 'bet365', src: 'first-sighting',
                 at: '2026-09-17T14:35:23.945Z', seenAt: '2026-09-17T15:45:01.000Z' },
  __ocs: { book: 'bet365', source: 'api-tennis',
           p1: { open: 6.5 }, p2: { open: 1.091 } },
});

test('TEN-198 still binds: a genuine vendor pin is still a vendor pin', () => {
  assert.equal(_openPinIsVendor(SKATOV()), true);
});

test('a fixture matches.json evidences as oddspapi is NOT a vendor pin', () => {
  assert.equal(_openPinIsVendor(MOLLER()), false);
});

test('the override needs ALL FOUR conditions — each one alone holds the line', () => {
  // Each mutation removes exactly one piece of evidence and must restore `true`.
  // If any of these ever returns false, the override has become a way to launder
  // an api-tennis price into a derived figure, which is the thing TEN-198 forbids.
  const noAt = MOLLER(); delete noAt.openingOdds.at;
  assert.equal(_openPinIsVendor(noAt), true, 'no quote instant ⇒ OCS label stands');

  const badAt = MOLLER(); badAt.openingOdds.at = 'not-a-date';
  assert.equal(_openPinIsVendor(badAt), true, 'unparseable instant ⇒ OCS label stands');

  const tagged = MOLLER(); tagged.openingOdds.vendor = 'api-tennis';
  assert.equal(_openPinIsVendor(tagged), true, 'an explicit vendor tag always wins');

  const otherBook = MOLLER(); otherBook.openingOdds.bookmaker = 'sports411';
  assert.equal(_openPinIsVendor(otherBook), true, 'a different book is not corroboration');

  const priceDrift = MOLLER(); priceDrift.openingOdds.p2 = 1.09;
  assert.equal(_openPinIsVendor(priceDrift), true, 'stores holding different numbers ⇒ no override');

  const noOpen = MOLLER(); noOpen.openingOdds.p1 = null;
  assert.equal(_openPinIsVendor(noOpen), true, 'a missing side is not corroboration');
});

test('an OCS row that is not api-tennis was never in scope', () => {
  const m = MOLLER();
  m.__ocs.source = 'oddspapi';
  assert.equal(_openPinIsVendor(m), false);
});

test('with no OCS row the matches.json marker alone decides', () => {
  const vend = SKATOV(); vend.__ocs = null;
  assert.equal(_openPinIsVendor(vend), true);
  const plain = MOLLER(); plain.__ocs = null;
  assert.equal(_openPinIsVendor(plain), false);
});

// ── the five tiers ───────────────────────────────────────────────────────────
const moved   = { __pair: { o1: 6.5, o2: 1.091, n1: 9, n2: 1.061 } };   // +38.46%
const smaller = { __pair: { o1: 2.34, o2: 1.599, n1: 2.53, n2: 1.535 } }; // +8.12%
const flat    = { __pair: { o1: 5.5, o2: 1.1, n1: 5.5, n2: 1.1 } };      // 0%
const noMove  = { __now: { p1: 1.24, p2: null } };                       // priced, unpairable
const unprice = {};                                                      // dash / dash

test('the five tiers rank in the founder\'s order', () => {
  const s = m => moveNowScore(m);
  assert.ok(s(moved) > s(smaller),  'largest move first');
  assert.ok(s(smaller) > s(flat),   'smaller moves above 0%');
  assert.ok(s(flat) > s(noMove),    '0% above no-move-computable');
  assert.ok(s(noMove) > s(unprice), 'no-move-computable above fully unpriced');
  assert.equal(s(flat), 0);
  assert.equal(s(noMove), MOVE_NONE);
  assert.equal(s(unprice), MOVE_UNPRICED);
});

test('THE BUG THIS FIXES: unpriced and unpairable no longer tie', () => {
  // They both scored -1, so the comparator returned 0 and left them in feed
  // order — which put B. Van De Zandschulp v J. A. Rodriguez (dash/dash) at the
  // top of the deployed board on 2026-09-18.
  assert.notEqual(moveNowScore(noMove), moveNowScore(unprice));
  const sorted = [unprice, noMove, flat, moved, smaller]
    .map(m => ({ m, sc: moveNowScore(m) }))
    .sort((a, b) => b.sc - a.sc);
  assert.deepEqual(sorted.map(x => x.sc.toFixed(4)),
                   ['0.3846', '0.0812', '0.0000', '-1.0000', '-2.0000']);
});

test('a card priced on EITHER leg stays above a fully unpriced one', () => {
  // Three ways to be priced; each must clear the bottom tier on its own.
  const openOnly = { __ocs: { book: 'bet365', source: 'oddspapi',
                              p1: { open: 1.44 }, p2: { open: null } } };
  const nowOnly  = { __now: { p1: null, p2: 3.42 } };
  const pairOnly = { __nowPair: { p1: 1.24, p2: 3.42, book: 'Marathon' } };
  for (const [label, m] of [['open', openOnly], ['now', nowOnly], ['pair', pairOnly]])
    assert.equal(moveNowScore(m), MOVE_NONE, `${label}-only must not sink to the bottom tier`);
});

test('zero is not a price — a published 0 cannot score a move', () => {
  // The -100% fabrication guard, kept here because this is the function that
  // ranks it: a `now: 0` next to a real open used to score 1.0 and top the board.
  assert.equal(moveNowScore({ __pair: { o1: 1.52, o2: 2.5, n1: 0, n2: 2.5 } }), MOVE_UNPRICED);
  assert.equal(moveNowScore({ __pair: { o1: 0, o2: 2.5, n1: 1.52, n2: 2.5 },
                              __now: { p1: 1.52, p2: 2.5 } }), MOVE_NONE);
});

test('the Drift branch ranks on moveNowScore and on nothing else', () => {
  // A source assert, and it is here for one reason: driftScore() (open→close)
  // was deleted because an unused scorer with a plausible name is one edit away
  // from being wired back into the sort it was wrong for. This fails if it
  // returns, or if the branch starts scoring on something else.
  const branch = html.match(/state\.sort === 'drift'\)\{[\s\S]{0,400}?\n  \}/);
  assert.ok(branch, "the drift sort branch was not found in its expected shape");
  assert.match(branch[0], /moveNowScore\(m\)/);
  assert.equal(html.includes('function driftScore('), false,
               'driftScore (open→close) must stay deleted');
});
