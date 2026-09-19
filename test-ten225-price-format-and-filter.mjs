// TEN-225 items 3 + 5 — the odds formatter, and the drift view as a FILTER.
//
// FOUNDER, 2026-09-19:
//   item 3: "keep [the 1.01 floor] where it is, fix the DISPLAY. Show 3
//            decimals below 1.10 (1.012, not '1.01')."
//   item 5: "When I click the tile, show ONLY fixtures that actually moved.
//            Drop every 0% card, every card with no computable move, and every
//            unpriced card out of the view entirely ... Show the count in the
//            view ('9 of 58 matches moved') ... Clicking again clears the
//            filter and restores the full board."
//
// The functions are sliced out of the shipped HTML and evaluated, not
// copy-pasted, so this file goes red if the page changes and it does not.
//
// Run: node --test test-ten225-price-format-and-filter.mjs
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

// ── ITEM 3 — the formatter, over the shipped text ─────────────────────────
const CUT = Number(/const MX_3DP_BELOW = ([0-9.]+);/.exec(html)?.[1]);
const { mxOddsTxt } = new Function(
  `const MX_3DP_BELOW = ${CUT};\n${slice('mxOddsTxt')}\nreturn { mxOddsTxt };`)();

test('the cut is the ruled 1.10, in absolute units', () => {
  // Pinned as a literal so a widened constant cannot pass by being read out of
  // the file it widened.
  assert.equal(CUT, 1.10);
});

test('below 1.10 prints three decimals — the founder\'s own example', () => {
  assert.equal(mxOddsTxt(1.012), '1.012');
  assert.equal(mxOddsTxt(1.004), '1.004');
  assert.equal(mxOddsTxt(1.001), '1.001');
  assert.equal(mxOddsTxt(1.052), '1.052');
  assert.equal(mxOddsTxt(1.091), '1.091');
});

test('at and above 1.10 nothing changes — the rest of the board is untouched', () => {
  for (const [v, want] of [[1.10, '1.10'], [1.22, '1.22'], [2.5, '2.50'],
                           [17, '17.00'], [1.15, '1.15']])
    assert.equal(mxOddsTxt(v), want, `${v}`);
});

test('the boundary, from both sides', () => {
  assert.equal(mxOddsTxt(1.099), '1.099');
  assert.equal(mxOddsTxt(1.1), '1.10');
});

test('a non-price is still empty, not "0.000"', () => {
  for (const v of [null, undefined, 0, -1, NaN, Infinity, '1.20'])
    assert.equal(mxOddsTxt(v), '', String(v));
});

test('EVERY odds template on the board goes through it — no cell left at 2dp', () => {
  // The defect this guards is a PARTIAL rollout: one renderer printing 1.004
  // and another printing 1.00 for the same fixture on the same screen.
  const stragglers = html.match(
    /\$\{(open|close|bmv\.[oc]|sp\.price|a1|b1|u\.price|now|nowPair\.p[12])\.toFixed\(2\)\}/g) || [];
  assert.deepEqual(stragglers, [], `still formatting at 2dp: ${stragglers.join(', ')}`);
  // ...and the formatter is actually reached from many sites, so the zero above
  // cannot come from a page that stopped rendering prices at all.
  assert.ok((html.match(/mxOddsTxt\(/g) || []).length >= 20);
});

// ── ITEM 5 — the filter ───────────────────────────────────────────────────
const filterSrc = ['mxDriftView', 'mxMoved'].map(slice).join('\n');

test('mxMoved is the SORT\'s own definition, not a second one', () => {
  // A separate predicate is how the tile, the order and the filter come to
  // disagree about which fixtures moved.
  assert.match(slice('mxMoved'), /moveNowScore\(m\)\s*>\s*0/);
});

test('the filter runs on mxDriftView(), not on state.sort alone', () => {
  // state.sort survives a switch to Results, where drift is never applied.
  // Filtering the Results tab down to movers would hide finished matches on a
  // view that has no drift in it.
  const gf = /function getFiltered\(\)\{([\s\S]*?)\n\}/.exec(html)?.[1] || html;
  assert.match(gf, /if \(mxDriftView\(\)\)\{/);
  assert.ok(!/if \(state\.sort === 'drift'\) out = out\.filter/.test(gf),
    'the filter is gated on the raw sort flag');
});

test('it FILTERS the array — it does not merely reorder it', () => {
  const gf = /function getFiltered\(\)\{([\s\S]*?)\n\}/.exec(html)?.[1] || '';
  assert.match(gf, /out = out\.filter\(mxMoved\)/);
});

test('the counts are recorded so the tile can say what was filtered', () => {
  const gf = /function getFiltered\(\)\{([\s\S]*?)\n\}/.exec(html)?.[1] || '';
  assert.match(gf, /MX_DRIFT_FILTER = \{ shown: out\.length, total: before \}/);
  assert.match(gf, /MX_DRIFT_FILTER = null/);   // cleared when the view is off
  assert.match(html, /MX_DRIFT_FILTER\.shown\} of \$\{MX_DRIFT_FILTER\.total\} matches moved/);
});

test('the predicate itself, over manufactured fixtures', () => {
  const { mxMoved } = new Function(`
    const state = { view: 'upcoming', sort: 'drift' };
    const MOVE_NONE = -1, MOVE_UNPRICED = -2;
    const moveNowScore = m => m.__score;
    ${filterSrc}
    return { mxMoved };`)();
  assert.equal(mxMoved({ __score: 0.385 }), true,  'a real move survives');
  assert.equal(mxMoved({ __score: 0.0001 }), true, 'a tiny real move survives');
  assert.equal(mxMoved({ __score: 0 }), false,     'a 0% card is dropped');
  assert.equal(mxMoved({ __score: -1 }), false,    'no computable move is dropped');
  assert.equal(mxMoved({ __score: -2 }), false,    'an unpriced card is dropped');
});

test('clicking again restores the full board', () => {
  // The toggle sets state.sort back to 'time'; mxDriftView() is then false and
  // the filter branch is not entered. Asserted on the toggle, because "the
  // filter clears" is a property of the toggle and not of the filter.
  assert.match(html, /state\.sort = \(state\.sort === 'drift'\) \? 'time' : 'drift'/);
  const { mxDriftView } = new Function(`
    const state = { view: 'upcoming', sort: 'time' };
    ${slice('mxDriftView')}
    return { mxDriftView };`)();
  assert.equal(mxDriftView(), false);
});

test('CONTROL: the assertions above fail on the pre-change source', () => {
  // Without this, every check could also be what a checker that had stopped
  // reading the file returns.
  const pre = html
    .replace(/if \(mxDriftView\(\)\)\{[\s\S]*?\n  \}\n/, '')
    .replace(/\$\{mxOddsTxt\(open\)\}/g, '${open.toFixed(2)}');
  assert.notEqual(pre, html, 'the mutation anchors are gone — this control is vacuous');
  assert.ok(!/out = out\.filter\(mxMoved\)/.test(pre));
  assert.ok((pre.match(/\$\{open\.toFixed\(2\)\}/g) || []).length > 0);
});
