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
    ${/const MX_3DP_BELOW = [^;]+;/.exec(src)[0]}
    const _ocsOf = m => m.__ocs || null;
    const mxIsSuspendedPair = () => false;
    const _openDerivedOf = (m, who) => (m.__open ? m.__open[who] : null);
    const ocsBookOf = m => (m.__ocs ? m.__ocs.book : null);
    const _openAnchorOf = (m, who) => (m.__open ? m.__open[who] : null);
    const _openPinIsVendor = () => false;
    ${s('mxOddsTxt')} ${s('mcTitleAttr')} ${s('oddsPctDelta')}
    ${s('mxJLevel')} ${s('mxJClose')} ${s('_mcCloseOf')} ${s('mxCloseIsJ')}
    ${s('_mcCloseW60')} ${s('_mcCloseDerivedOf')} ${s('mxCloseIsOlder')}
    ${s('mxCloseAgeMin')} ${s('mxAgeText')}
    ${s('_mcPinClose')} ${s('_mcPinCloseOf')} ${s('mxPinCloseAgeMs')} ${s('mxPinCloseAgeMin')} ${s('_mcPinCloseW60')}
    ${s('_mcPinCloseDerivedOf')} ${s('_mcOpenIsPinnacle')} ${s('_mcPinCloseMoveOf')} ${s('mxPinCloseTitle')}
    ${s('upsetScore')} ${s('closingScore')} ${s('moveScore')} ${s('marketWrongScore')}
    ${s('mcJourney')} ${s('mcDriftCell')}
    return { mcDriftCell, _mcCloseOf, _mcCloseDerivedOf, _mcCloseW60, mxCloseIsOlder, mxCloseAgeMin,
             mxAgeText, upsetScore, closingScore, moveScore, marketWrongScore, mcJourney,
             _mcPinCloseOf, _mcPinCloseDerivedOf, _mcPinCloseW60, mxPinCloseTitle };
  `)();
}
const A = build();

const START = '2026-09-22T12:00:00Z';
// De Minaur v Majchrzak's shape: an Open, and a close last seen well before the off.
// TEN-295 (founder 2026-09-27, card f09c2fd5): every close-based NUMBER reads the Pinnacle close
// (m.pinClose), within-60 only; the card-state close stays the underway Now fallback.
function card(c1, c2, w1, w2, ts1 = '2026-09-22T09:09:00Z', ts2 = ts1, book = 'bet105') {
  return {
    finalScore: { winner: 'p2' },
    __open: { p1: 1.256, p2: 4.11 },
    __ocs: { book, startTs: START,
             p1: { open: 1.256, close: c1, closeTs: ts1, closeW60: w1 },
             p2: { open: 4.11, close: c2, closeTs: ts2, closeW60: w2 } },
    pinClose: { p1: c1, p2: c2, p1At: w1 ? '2026-09-22T11:40:00Z' : ts1, p2At: w2 ? '2026-09-22T11:40:00Z' : ts2,
                source: 'Pinnacle +30s (Oddspapi)', startTs: START, startBasis: 'actual' },
  };
}
const OLDER = card(1.30, 3.70, false, false);
const W60 = card(1.30, 3.70, true, true, '2026-09-22T11:40:00Z');

test('an OLDER close is DISPLAYED — ruling 2: show the last real price', () => {
  assert.equal(A._mcCloseOf(OLDER, 'p1'), 1.30);
  assert.equal(A._mcCloseOf(OLDER, 'p2'), 3.70);
  assert.equal(A.mxCloseIsOlder(OLDER, 'p1'), true);
});

test('...and an OLDER Pinnacle close feeds NO number: move, upset, market-wrong, closing sort', () => {
  assert.equal(A._mcCloseDerivedOf(OLDER, 'p1'), null);
  assert.equal(A._mcPinCloseDerivedOf(OLDER, 'p1'), null);
  assert.equal(A._mcPinCloseOf(OLDER, 'p1'), 1.30, 'still displayed');
  assert.equal(A.moveScore(OLDER), 0, 'price movement');
  assert.equal(A.upsetScore(OLDER), -1, 'upset');
  assert.equal(A.marketWrongScore(OLDER), -1, 'market got it wrong');
  assert.equal(A.closingScore(OLDER), Infinity, 'closing favourite sort');
});

test('CONTROL: a WITHIN-60 Pinnacle close feeds every close number; the move needs a Pinnacle open', () => {
  assert.equal(A._mcPinCloseDerivedOf(W60, 'p1'), 1.30);
  assert.equal(A.upsetScore(W60), 3.70);
  assert.equal(A.closingScore(W60), 1.30);
  assert.equal(A.moveScore(W60), 0, 'Bet105 open -> Pinnacle close is two books: no move');
  const pinOpen = card(1.30, 3.70, true, true, '2026-09-22T11:40:00Z', undefined, 'pinnacle');
  assert.ok(A.moveScore(pinOpen) > 0, 'Pinnacle open -> Pinnacle close: one book, measured');
  assert.equal(A.mxCloseIsOlder(W60, 'p1'), false);
});

test('the Pinnacle close replaces the card book close in every number (never the card-state close)', () => {
  const c = card(1.30, 3.70, true, true, '2026-09-22T11:40:00Z');
  c.__ocs.p1.close = 1.99; c.__ocs.p2.close = 1.99;
  assert.equal(A.closingScore(c), 1.30);
  delete c.pinClose;
  assert.equal(A.closingScore(c), Infinity, 'no Pinnacle close -> no number, never the card-state 1.99');
  assert.equal(A._mcPinCloseOf(c, 'p1'), null, 'and the Close slot dashes');
});

test('one older leg disqualifies the pair — a move needs both legs', () => {
  const mixed = card(1.30, 3.70, true, false);
  assert.equal(A._mcPinCloseW60(mixed), false);
  assert.equal(A._mcPinCloseDerivedOf(mixed, 'p1'), null);
  assert.equal(A.moveScore(mixed), 0);
});

test('review 2026-09-27: age runs to ageRefTs (the LATEST schedule), and 60 min is exact', () => {
  const c = card(1.684, 2.3, true, true, '2026-09-26T11:16:21Z');
  c.pinClose = { ...c.pinClose, p1At: '2026-09-26T11:16:21Z', p2At: '2026-09-26T11:16:21Z',
                 startTs: '2026-09-26T11:30:00.000Z', ageRefTs: '2026-09-26T13:40:00.000Z', startBasis: 'scheduled' };
  assert.equal(A._mcPinCloseW60(c), false, 'Wong v Vallejo: 144 min to the later schedule, not 14 to the earlier');
  assert.equal(A.upsetScore(c), -1, 'so it feeds no figure');
  const edge = card(1.3, 3.7, true, true);
  edge.pinClose = { ...edge.pinClose, p1At: '2026-09-22T10:59:31Z', p2At: '2026-09-22T11:30:00Z' };   // 60m29s
  assert.equal(A._mcPinCloseW60(edge), false, '60 min 29 s is older than 60, whatever the rounding prints');
  const noOpen = card(1.3, 3.7, true, true, '2026-09-22T11:40:00Z'); delete noOpen.__open;
  assert.doesNotMatch(A.mxPinCloseTitle(noOpen, 'p1'), /open is another book/, 'no open -> no cross-book note');
});

test('the Close hover names the Pinnacle source, its age and the cross-book rule', () => {
  assert.equal(A.mxPinCloseTitle(W60, 'p1'),
    'Pinnacle +30s (Oddspapi) · 1.30 · last price change 20 min before the actual start · open is another book: no move shown');
  assert.match(A.mxPinCloseTitle(OLDER, 'p1'), /2h 51m before the actual start · older than 60 min, not used in any figure/);
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

test('the card renders an older close MUTED, with no move bar and no % delta', () => {
  const html1 = A.mcJourney(1.256, 1.30, false, { closeOlder: true });
  assert.match(html1, /mc-journey__close mx-close-older/);
  assert.doesNotMatch(html1, /mc-journey__bar/);
  assert.doesNotMatch(html1, /mc-journey__delta (pos|neg)/);
  const html2 = A.mcJourney(1.256, 1.30, false, {});
  assert.match(html2, /mc-journey__bar/, 'CONTROL: a within-60 close draws its move');
  assert.doesNotMatch(html2, /mx-close-older/);
});

test('MUTATION: moveScore on the Pinnacle close WITHOUT the same-book test -> a cross-book move is measured', () => {
  const src = html.replace(
    "const c1 = _mcPinCloseMoveOf(m, 'p1'), c2 = _mcPinCloseMoveOf(m, 'p2');\n  const p1 = ",
    "const c1 = _mcPinCloseDerivedOf(m, 'p1'), c2 = _mcPinCloseDerivedOf(m, 'p2');\n  const p1 = ");
  assert.notEqual(src, html, 'mutation anchor vanished');
  assert.ok(build(src).moveScore(W60) > 0, 'the suite would catch this revert');
});

test('MUTATION: moveScore on the DISPLAY Pinnacle close -> the older close feeds a number', () => {
  const src = html.replace(
    "function _mcPinCloseDerivedOf(m, who){ return _mcPinCloseW60(m) ? _mcPinCloseOf(m, who) : null; }",
    "function _mcPinCloseDerivedOf(m, who){ return _mcPinCloseOf(m, who); }");
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
