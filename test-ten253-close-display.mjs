// TEN-253 ruling 2 (founder, 2026-09-23) — THE CLOSE DISPLAY RULE, executed.
//
// "Show the last real price seen before the actual start, even when it's older
//  than 60 minutes. Hover: '[book] · last seen X min before start' (hours and
//  minutes if over 60). Older: a simple muted style. Stats and calculations
//  (CLV, ROI, price movement, Biggest Market Move) use ONLY within-60 Closes.
//  Displayed older prices never feed a number."
//
// The functions are SLICED out of the shipped HTML and EXECUTED — a regex over
// the source would pass on code that never runs.
//
// Run: node --test test-ten253-close-display.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');

function slice(name, src = html) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

function build(src = html) {
  const s = n => slice(n, src);
  return new Function(`
    const MX_J_LEVELS = /challenger/i;
    const _ocsOf = m => m.__ocs || null;
    const mxIsSuspendedPair = () => false;
    const _openDerivedOf = (m, who) => (m.__open ? m.__open[who] : null);
    const ocsBookOf = m => (m.__ocs ? m.__ocs.book : null);
    const _openAnchorOf = (m, who) => (m.__open ? m.__open[who] : null);
    const _openPinIsVendor = () => false;
    ${s('mxOddsTxt')} ${s('mcTitleAttr')} ${s('oddsPctDelta')} ${s('mxMovePct')}
    ${s('mxJLevel')} ${s('mxJClose')} ${s('_mcCloseOf')} ${s('mxCloseIsJ')}
    ${s('_mcCloseW60')} ${s('_mcCloseDerivedOf')} ${s('mxCloseIsOlder')}
    ${s('mxCloseAgeMin')} ${s('mxAgeText')}
    ${s('_mcPinClose')} ${s('_mcPinCloseOf')} ${s('mxPinCloseAgeMs')} ${s('mxPinCloseAgeMin')} ${s('_mcPinCloseW60')}
    const MX_BOOK_LABELS = { pncl: 'Pinnacle' }; ${s('mxBookLabel')} ${s('_mcCardCloseOf')} ${s('_mcCardCloseDerivedOf')}
    ${s('upsetScore')} ${s('closingScore')} ${s('moveScore')} ${s('marketWrongScore')}
    ${s('mcJourney')} ${s('mcDriftCell')}
    return { mcDriftCell, _mcCloseOf, _mcCloseDerivedOf, _mcCloseW60, mxCloseIsOlder, mxCloseAgeMin,
             mxAgeText, upsetScore, closingScore, moveScore, marketWrongScore, mcJourney,
             _mcPinCloseOf, _mcPinCloseW60, _mcCardCloseOf, _mcCardCloseDerivedOf };
  `)();
}
const A = build();

const START = '2026-09-22T12:00:00Z';
// De Minaur v Majchrzak's shape: an Open, and a close last seen well before the off.
// TEN-377 (founder 2026-10-03, card 0b990217 — replaces TEN-295's "Close slot = Pinnacle"): the
// Completed Close is the CARD BOOK's close; every close-based NUMBER reads it within-60 only
// (TEN-253 ruling 2 binds stats), and the card face shows an older close white with its Move.
function card(c1, c2, w1, w2, ts1 = '2026-09-22T09:09:00Z', ts2 = ts1, book = 'bet105') {
  return {
    finalScore: { winner: 'p2' },
    __open: { p1: 1.256, p2: 4.11 },
    __ocs: { book, startTs: START,
             p1: { open: 1.256, close: c1, closeTs: ts1, closeW60: w1 },
             p2: { open: 4.11, close: c2, closeTs: ts2, closeW60: w2 } },
    pinClose: { p1: 1.99, p2: 1.99, p1At: '2026-09-22T11:40:00Z', p2At: '2026-09-22T11:40:00Z',
                source: 'Pinnacle +30s (Oddspapi)', startTs: START, startBasis: 'actual' },
  };
}
const OLDER = card(1.30, 3.70, false, false);
const W60 = card(1.30, 3.70, true, true, '2026-09-22T11:40:00Z');

test('an OLDER close is DISPLAYED — ruling 2: show the last real price', () => {
  assert.equal(A._mcCloseOf(OLDER, 'p1'), 1.30);
  assert.equal(A._mcCardCloseOf(OLDER, 'p2'), 3.70);
  assert.equal(A.mxCloseIsOlder(OLDER, 'p1'), true);
});

test('...and an OLDER close feeds NO number except the printed Move (founder TEN-403 414de0fe: the move tile + sort rank every close the cards show): upset, market-wrong, closing sort (ruling 2)', () => {
  assert.equal(A._mcCardCloseDerivedOf(OLDER, 'p1'), null);
  assert.equal(A._mcCardCloseOf(OLDER, 'p1'), 1.30, 'still displayed');
  assert.ok(A.moveScore(OLDER) > 0, 'price movement: the card prints this Move, so the Biggest-move sort ranks it (TEN-403)');
  assert.equal(A.upsetScore(OLDER), -1, 'upset');
  assert.equal(A.marketWrongScore(OLDER), -1, 'market got it wrong');
  assert.equal(A.closingScore(OLDER), Infinity, 'closing favourite sort');
});

test('CONTROL: a WITHIN-60 card-book close feeds every close number; open and close are one book', () => {
  assert.equal(A._mcCardCloseDerivedOf(W60, 'p1'), 1.30);
  assert.equal(A.upsetScore(W60), 3.70);
  assert.equal(A.closingScore(W60), 1.30);
  assert.ok(A.moveScore(W60) > 0, 'Bet105 open -> Bet105 close: one book, measured');
  assert.equal(A.mxCloseIsOlder(W60, 'p1'), false);
});

test("the card book's close is the Close — never Pinnacle's, never the J close, never another book's closingOdds", () => {
  const c = card(1.30, 3.70, true, true, '2026-09-22T11:40:00Z');
  assert.equal(A.closingScore(c), 1.30, 'not the Pinnacle 1.99');
  c.__ocs.p1.close = null;
  assert.equal(A._mcCardCloseOf(c, 'p1'), null, 'no card-book close -> dash, never filled');
  const noOcs = { finalScore: { winner: 'p1' }, openingOdds: { p1: 2, p2: 1.8, bookmaker: 'bet105' },
                  closingOdds: { p1: 1.9, p2: 1.9, bookmaker: 'Pinnacle' } };
  assert.equal(A._mcCardCloseOf(noOcs, 'p1'), null, 'a closingOdds from another book is not this card\'s close');
  noOcs.closingOdds.bookmaker = 'Bet105';
  assert.equal(A._mcCardCloseOf(noOcs, 'p1'), 1.9, 'same book (any casing) -> shown');
});

test('one older leg disqualifies the pair for close-derived stats; the Move (shown on the card) still ranks (TEN-403)', () => {
  const mixed = card(1.30, 3.70, true, false);
  assert.equal(A._mcCardCloseDerivedOf(mixed, 'p1'), null);
  assert.ok(A.moveScore(mixed) > 0);
});

test('review 2026-09-27: Pinnacle age runs to ageRefTs (the LATEST schedule), and 60 min is exact (pop-up line + Odds tab)', () => {
  const c = card(1.684, 2.3, true, true, '2026-09-26T11:16:21Z');
  c.pinClose = { ...c.pinClose, p1: 1.684, p2: 2.3, p1At: '2026-09-26T11:16:21Z', p2At: '2026-09-26T11:16:21Z',
                 startTs: '2026-09-26T11:30:00.000Z', ageRefTs: '2026-09-26T13:40:00.000Z', startBasis: 'scheduled' };
  assert.equal(A._mcPinCloseW60(c), false, 'Wong v Vallejo: 144 min to the later schedule, not 14 to the earlier');
  const edge = card(1.3, 3.7, true, true);
  edge.pinClose = { ...edge.pinClose, p1At: '2026-09-22T10:59:31Z', p2At: '2026-09-22T11:30:00Z' };   // 60m29s
  assert.equal(A._mcPinCloseW60(edge), false, '60 min 29 s is older than 60, whatever the rounding prints');
});

test('hover age: minutes under an hour, "Xh Ym" over it', () => {
  assert.equal(A.mxCloseAgeMin(OLDER, 'p1'), 171);
  assert.equal(A.mxAgeText(171), '2h 51m');
  assert.equal(A.mxCloseAgeMin(W60, 'p1'), 20);
  assert.equal(A.mxAgeText(20), '20 min');
  assert.equal(A.mxAgeText(60), '1h 0m');
  const noStart = card(1.3, 3.7, false, false); noStart.__ocs.startTs = null;
  assert.equal(A.mxCloseAgeMin(noStart, 'p1'), null, 'no start -> no age, never a guess');
});

test('TEN-377: the card face shows an older close WHITE with its Move; no muted style, no journey bar', () => {
  const html1 = A.mcJourney(1.256, 1.30, false, {});
  assert.match(html1, /mc-px__close">1\.30</);
  assert.match(html1, /mc-px__move pos">\+3\.2%/);
  assert.doesNotMatch(html1, /mx-close-older|journey__bar|linear-gradient/);
  const slot = html.slice(html.indexOf('const playersHtml = isCompleted'), html.indexOf("const playersHtml = isCompleted") + 2500);
  assert.match(slot, /mcJourney\(p1Open, p1Close, openAnchorOnly, \{ openTitle: _openTitle\('p1'\), closeTitle: _closeTitle\('p1'\) \}\)/);
  assert.doesNotMatch(slot, /closeOlder|_mcPinClose/, 'the card passes no age flag and no Pinnacle close');
});

test('MUTATION: stats on the DISPLAY close -> an older close feeds a number', () => {
  const src = html.replace(
    "function _mcCardCloseDerivedOf(m, who){ return _mcCloseW60(m) ? _mcCardCloseOf(m, who) : null; }",
    "function _mcCardCloseDerivedOf(m, who){ return _mcCardCloseOf(m, who); }");
  assert.notEqual(src, html, 'mutation anchor vanished');
  assert.equal(build(src).upsetScore(OLDER), 3.70, 'the suite would catch this revert');
});

test('review blocker: the underway Now slot carrying an OLDER close renders muted', () => {
  const h = A.mcDriftCell(1.256, 1.30, false, { paired: false, nowOlder: true });
  assert.match(h, /mc-drifted__now[^"]*mx-close-older/);
  assert.doesNotMatch(h, /mc-drifted__pct (pos|neg)/, 'no % move off an older close');
});

test('review item 2: with no card-state row the J close NEVER feeds a number', () => {
  const chal = { tour: 'ATP Challenger Seville', finalScore: { winner: 'p1' },
                 apiTennisClose: { p1: 1.35, p2: 3.2 } };
  assert.equal(A._mcCloseOf(chal, 'p1'), 1.35, 'still DISPLAYED as the J fill');
  assert.equal(A._mcCloseDerivedOf(chal, 'p1'), null, 'but not a number input');
  const pinned = { ...chal, closingOdds: { p1: 1.40, p2: 3.0, bookmaker: 'bet365' } };
  assert.equal(A._mcCloseDerivedOf(pinned, 'p1'), 1.40, 'CONTROL: the pinned close still counts');
});
