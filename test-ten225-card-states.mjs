// TEN-225 items 2 + 4 — the three card states, and the impossible-leg guard.
//
// FOUNDER, 2026-09-19, verbatim:
//   "UPCOMING (not started): OPEN and NOW.
//    UNDERWAY (started, not finished): OPEN and NOW. If the book has stopped
//    quoting, keep showing the last pre-match price as Now and label it as such
//    — never an empty CLOSE column.
//    COMPLETED (finished): OPEN and CLOSE only."
//   "Dougaz 1.00/1.00 is not a price. The 20% overround guard should have caught
//    it — report why it did not, and extend it to catch any leg at or below 1.01."
//
// The functions are sliced out of the shipped HTML and evaluated, not
// copy-pasted, so this file goes red if the page changes and it does not.
//
// Run: node --test test-ten225-card-states.mjs
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

// ── ITEM 4 — the guard, over the real shipped text ────────────────────────
const guardSrc = ['mxOverround', 'mxIsSuspendedPair'].map(slice).join('\n');
const MX_SUSPENDED_OVERROUND = Number(
  /const MX_SUSPENDED_OVERROUND = ([0-9.]+);/.exec(html)?.[1]);
const MX_MIN_REAL_PRICE = Number(
  /const MX_MIN_REAL_PRICE = ([0-9.]+);/.exec(html)?.[1]);
const guard = new Function(`
  const MX_SUSPENDED_OVERROUND = ${MX_SUSPENDED_OVERROUND};
  const MX_MIN_REAL_PRICE = ${MX_MIN_REAL_PRICE};
  const MX_SUPPRESSED = new Map();
  const console = { warn(){} };
  ${guardSrc}
  return { mxOverround, mxIsSuspendedPair, MX_SUPPRESSED };
`)();

test('the two thresholds are the ruled values, in absolute units', () => {
  // Pinned as literals so a widened constant cannot pass by being read out of
  // the file it widened — the trap that made an earlier lag harness vacuous.
  assert.equal(MX_SUSPENDED_OVERROUND, 0.20);
  assert.equal(MX_MIN_REAL_PRICE, 1.01);
});

test('WHY THE 20% RULE MISSED DOUGAZ — the real deployed numbers', () => {
  // bet365, deployed board 2026-09-19: A. Dougaz v M. Murtaza at 1.004 / 17.00.
  const ov = guard.mxOverround(1.004, 17);
  assert.ok(ov < 0.06, `overround was ${(ov * 100).toFixed(1)}% — well inside 20%`);
  // So under the pair rule ALONE the fixture is ordinary. This is the control
  // for the fix: it must have been a pass before, or the fix proves nothing.
  const pairRuleAlone = ov > MX_SUSPENDED_OVERROUND;
  assert.equal(pairRuleAlone, false, 'the pair rule alone would not have fired');
  // And with the leg floor it is caught.
  assert.equal(guard.mxIsSuspendedPair(1.004, 17, { id: 'dougaz', path: 't' }), true);
});

test('Marathon quoted the same fixture at exactly 1.00 — caught too', () => {
  assert.equal(guard.mxOverround(1.0, 9.8) > MX_SUSPENDED_OVERROUND, false);
  assert.equal(guard.mxIsSuspendedPair(1.0, 9.8, { id: 'dougaz-m', path: 't' }), true);
});

test('the floor is symmetric — an impossible leg on EITHER side fires', () => {
  assert.equal(guard.mxIsSuspendedPair(9.8, 1.0, { id: 'a', path: 't' }), true);
  assert.equal(guard.mxIsSuspendedPair(26, 1.001, { id: 'b', path: 't' }), true);
});

test('the 1.01/1.01 sentinel the pair rule was written for still fires', () => {
  assert.equal(guard.mxIsSuspendedPair(1.01, 1.01, { id: 'c', path: 't' }), true);
});

test('ordinary prices are NOT suppressed — the rule is a sentinel, not a margin bar', () => {
  // Sbo's measured median overround is 11.6%, the widest honest book we carry.
  for (const [a, b] of [[1.02, 10.5], [1.025, 15], [1.22, 3.75], [1.87, 1.77],
                        [2.62, 1.41], [1.11, 5], [1.052, 8]]) {
    assert.equal(guard.mxIsSuspendedPair(a, b, { id: `ok-${a}`, path: 't' }), false,
      `${a}/${b} was suppressed and should not have been`);
  }
});

test('ABSENCE is not suspension — an unpriced leg must not be logged', () => {
  const before = guard.MX_SUPPRESSED.size;
  for (const [a, b] of [[null, 2], [1.2, null], [0, 2], [undefined, undefined]])
    assert.equal(guard.mxIsSuspendedPair(a, b, { id: 'absent', path: 't' }), false);
  assert.equal(guard.MX_SUPPRESSED.size, before,
    'a missing price was recorded as a suppression — every dashed fixture would be');
});

test('the log says WHICH rule fired', () => {
  guard.mxIsSuspendedPair(1.004, 17, { id: 'r1', book: 'bet365', path: 'p' });
  guard.mxIsSuspendedPair(1.05, 1.05, { id: 'r2', book: 'bet365', path: 'p' });
  const recs = [...guard.MX_SUPPRESSED.values()];
  assert.equal(recs.find(r => r.id === 'r1').reason, 'unbettable-leg');
  assert.equal(recs.find(r => r.id === 'r2').reason, 'wide');
});

// ── ITEM 2 — the three card states, read out of the shipped renderer ──────
test('a NON-FINISHED card never labels its column CLOSE', () => {
  assert.ok(!/mcStarted \? 'Close' : 'Now'/.test(html),
    'the 4c relabel is back: an underway card would head its column CLOSE');
  assert.ok(/<span class="mc-colhead-drift"><span>Open<\/span><span><\/span><span>Now<\/span>/.test(html),
    'the drift header is no longer a fixed Open / Now');
});

test('COMPLETED is the only state whose header says CLOSE', () => {
  const heads = [...html.matchAll(/<span>Close<\/span>/g)];
  assert.equal(heads.length, 1, `expected exactly one Close column header, found ${heads.length}`);
  const ctx = html.slice(Math.max(0, heads[0].index - 400), heads[0].index);
  assert.ok(/isCompleted/.test(ctx), 'the surviving Close header is not on the completed branch');
});

test('an UNDERWAY card resolves a Now first, and only then the last pre-match price', () => {
  // The order is the behaviour: `_liveNow` is consulted BEFORE the fallback, so a
  // book still quoting after the off keeps showing its current price. The old
  // code short-circuited to _mcCloseOf on `mcStarted` and never asked.
  const body = /const mcDriftRight = who => \{([\s\S]*?)\n    \};/.exec(html)?.[1];
  assert.ok(body, 'mcDriftRight not found');
  const iLive = body.indexOf('_liveNow(who)');
  const iClose = body.indexOf('_mcCloseOf');
  assert.ok(iLive > -1 && iClose > iLive,
    'the close fallback is not strictly after the live-Now attempt');
  assert.ok(/if \(mcStarted\) return _mcCloseOf/.test(body),
    'the fallback is not gated on mcStarted — an upcoming card could show a close');
  assert.ok(!/if \(mcStarted\) return _mcCloseOf\(m, who\);\n      if \(_dpair\)/.test(body),
    'the pre-fix short circuit is back');
});

test('the last-pre-match fallback needs BOTH legs quiet, not one', () => {
  const decl = /const mcLastPreMatch = ([\s\S]*?);\n/.exec(html)?.[1];
  assert.ok(decl, 'mcLastPreMatch not found');
  assert.ok(/mcStarted/.test(decl), 'it does not require the fixture to have started');
  assert.ok(/_liveNow\('p1'\) == null && _liveNow\('p2'\) == null/.test(decl),
    'it would label a card "last pre-match" while one leg is still current');
  assert.ok(/_mcCloseOf/.test(decl),
    'it claims a last pre-match price without checking one exists');
});

// ── the qualifier itself, over the shipped mcPriceTitle ───────────────────
const titleSrc = slice('mcPriceTitle');
const { mcPriceTitle } = new Function(`
  const MC_TITLE_1LINE_MAX = ${/const MC_TITLE_1LINE_MAX = (\d+);/.exec(html)?.[1] || 48};
  const mxBookLabel = b => b;
  const ocsFmtClock = t => t ? String(t).slice(11, 16) : '';
  // Sliced, not stubbed — see the note in test-ten225-both-clocks.mjs.
  const MX_3DP_BELOW = ${Number(/const MX_3DP_BELOW = ([0-9.]+);/.exec(html)?.[1])};
  ${slice('mxOddsTxt')}
  ${titleSrc}
  return { mcPriceTitle };
`)();

test('the hover LABELS a carried pre-match price as such', () => {
  const t = mcPriceTitle({ book: 'bet365', at: '2026-09-19T01:39:29Z',
                           kind: 'book-tick', note: 'last price before the off' }, 1.22);
  assert.match(t, /last price before the off/);
  // On its own line, so it can never be truncated out of the clock format.
  assert.ok(t.includes('\nlast price before the off'), `got ${JSON.stringify(t)}`);
  assert.match(t, /bet365 · 1\.22 since 01:39/);
});

test('an ordinary Now title is unchanged — the note is opt-in', () => {
  const t = mcPriceTitle({ book: 'bet365', at: '2026-09-19T01:39:29Z',
                           obs: '2026-09-19T02:30:00Z', kind: 'book-tick' }, 1.22);
  assert.equal(t, 'bet365 · 1.22 since 01:39 · seen 02:30');
  assert.ok(!/last price/.test(t));
});

test('a dashed cell still gets no title at all', () => {
  assert.equal(mcPriceTitle(null, null), '');
  assert.equal(mcPriceTitle({ book: null }, 1.2), '');
});
