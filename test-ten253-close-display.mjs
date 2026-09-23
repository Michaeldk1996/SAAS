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
    ${s('mxOddsTxt')} ${s('mcTitleAttr')} ${s('oddsPctDelta')}
    ${s('mxJLevel')} ${s('mxJClose')} ${s('_mcCloseOf')} ${s('mxCloseIsJ')}
    ${s('_mcCloseW60')} ${s('_mcCloseDerivedOf')} ${s('mxCloseIsOlder')}
    ${s('mxCloseAgeMin')} ${s('mxAgeText')}
    ${s('upsetScore')} ${s('closingScore')} ${s('moveScore')} ${s('marketWrongScore')}
    ${s('mcJourney')} ${s('mcDriftCell')}
    return { mcDriftCell, _mcCloseOf, _mcCloseDerivedOf, _mcCloseW60, mxCloseIsOlder, mxCloseAgeMin,
             mxAgeText, upsetScore, closingScore, moveScore, marketWrongScore, mcJourney };
  `)();
}
const A = build();

const START = '2026-09-22T12:00:00Z';
// De Minaur v Majchrzak's shape: an Open, and a close last seen well before the off.
function card(c1, c2, w1, w2, ts1 = '2026-09-22T09:09:00Z', ts2 = ts1) {
  return {
    finalScore: { winner: 'p2' },
    __open: { p1: 1.256, p2: 4.11 },
    __ocs: { book: 'bet105', startTs: START,
             p1: { open: 1.256, close: c1, closeTs: ts1, closeW60: w1 },
             p2: { open: 4.11, close: c2, closeTs: ts2, closeW60: w2 } },
  };
}
const OLDER = card(1.30, 3.70, false, false);
const W60 = card(1.30, 3.70, true, true, '2026-09-22T11:40:00Z');

test('an OLDER close is DISPLAYED — ruling 2: show the last real price', () => {
  assert.equal(A._mcCloseOf(OLDER, 'p1'), 1.30);
  assert.equal(A._mcCloseOf(OLDER, 'p2'), 3.70);
  assert.equal(A.mxCloseIsOlder(OLDER, 'p1'), true);
});

test('...and feeds NO number: move, upset, market-wrong, closing sort', () => {
  assert.equal(A._mcCloseDerivedOf(OLDER, 'p1'), null);
  assert.equal(A.moveScore(OLDER), 0, 'price movement');
  assert.equal(A.upsetScore(OLDER), -1, 'upset');
  assert.equal(A.marketWrongScore(OLDER), -1, 'market got it wrong');
  assert.equal(A.closingScore(OLDER), Infinity, 'closing favourite sort');
});

test('CONTROL: the same card WITHIN 60 feeds every number', () => {
  assert.equal(A._mcCloseDerivedOf(W60, 'p1'), 1.30);
  assert.ok(A.moveScore(W60) > 0);
  assert.equal(A.upsetScore(W60), 3.70);
  assert.equal(A.mxCloseIsOlder(W60, 'p1'), false);
});

test('one older leg disqualifies the pair — a move needs both legs', () => {
  const mixed = card(1.30, 3.70, true, false);
  assert.equal(A._mcCloseW60(mixed), false);
  assert.equal(A._mcCloseDerivedOf(mixed, 'p1'), null);
  assert.equal(A.moveScore(mixed), 0);
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

test('MUTATION: point moveScore back at the DISPLAY close -> the older close feeds a number', () => {
  const src = html.replace(
    "const c1 = _mcCloseDerivedOf(m, 'p1'), c2 = _mcCloseDerivedOf(m, 'p2');\n  const p1 = ",
    "const c1 = _mcCloseOf(m, 'p1'), c2 = _mcCloseOf(m, 'p2');\n  const p1 = ");
  assert.notEqual(src, html, 'mutation anchor vanished');
  assert.ok(build(src).moveScore(OLDER) > 0, 'the suite would catch this revert');
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
