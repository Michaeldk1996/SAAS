// TEN-225 items 3 + 5 — the odds formatter, and the drift view as a FILTER.
//
// FOUNDER, 2026-09-19:
//   item 3: "keep [the 1.01 floor] where it is, fix the DISPLAY. Show 3
//            decimals below 1.10 (1.012, not '1.01')."  — SUPERSEDED by TEN-403 R1
//            (2026-10-09): every price at 2 dp.
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
// SUPERSEDED by TEN-403 R1 (founder 2026-10-09, item 2): "Every price at 2 dp, open included"
// ("1.092" must read "1.09"). The TEN-225 three-decimals-below-1.10 rule (2026-09-19 / 09-21,
// MX_3DP_BELOW) is gone; every book price prints two decimals.
const { mxOddsTxt } = new Function(`${slice('mxOddsTxt')}\nreturn { mxOddsTxt };`)();

test('TEN-403 R1: no three-decimal cut is left in the page', () => {
  assert.doesNotMatch(html, /const MX_3DP_BELOW = /);
});

test('TEN-403 R1: below 1.10 prints TWO decimals — the founder\'s own example 1.092 → 1.09', () => {
  for (const [v, want] of [[1.092, '1.09'], [1.012, '1.01'], [1.004, '1.00'], [1.001, '1.00'],
                           [1.052, '1.05'], [1.091, '1.09'], [1.099, '1.10'], [1.020, '1.02']])
    assert.equal(mxOddsTxt(v), want, `${v}`);
});

test('at and above 1.10 nothing changes — the rest of the board is untouched', () => {
  for (const [v, want] of [[1.10, '1.10'], [1.22, '1.22'], [2.5, '2.50'],
                           [17, '17.00'], [1.15, '1.15']])
    assert.equal(mxOddsTxt(v), want, `${v}`);
});

test('every value is its own toFixed(2), across the old three-decimal band and above', () => {
  for (let i = 1001; i < 3000; i++) { const v = i / 1000; assert.equal(mxOddsTxt(v), v.toFixed(2), `${v}`); }
});

test('CONTROL: the PRE-change (TEN-225) formatter disagrees exactly where the third decimal was non-zero below 1.10', () => {
  // Without this, every assertion above would also pass on a formatter that had never been changed.
  const pre = v => { if (v >= 1.10) return v.toFixed(2); const t = v.toFixed(3); return t.endsWith('0') ? t.slice(0, -1) : t; };
  assert.equal(pre(1.092), '1.092');                       // the founder's "1.092", reproduced
  assert.notEqual(pre(1.092), mxOddsTxt(1.092));
  for (const v of [1.020, 1.22, 2.5, 17]) assert.equal(pre(v), mxOddsTxt(v), `${v} unchanged`);
});

test('a non-price is still empty, not "0.000"', () => {
  for (const v of [null, undefined, 0, -1, NaN, Infinity, '1.20'])
    assert.equal(mxOddsTxt(v), '', String(v));
});

test('EVERY odds template on the board goes through it — no cell formats on its own', () => {
  // The defect this guards is a PARTIAL rollout: one renderer printing a price its own way
  // and another printing it differently for the same fixture on the same screen.
  const stragglers = html.match(
    /\$\{(open|close|bmv\.[oc]|sp\.price|a1|b1|u\.price|now|nowPair\.p[12])\.toFixed\(2\)\}/g) || [];
  assert.deepEqual(stragglers, [], `still formatting at 2dp: ${stragglers.join(', ')}`);
  // ...and the formatter is actually reached from many sites, so the zero above
  // cannot come from a page that stopped rendering prices at all.
  // (TEN-403 folded the move-view cell's five per-branch templates into one: 21 sites → 19.)
  assert.ok((html.match(/mxOddsTxt\(/g) || []).length >= 18);
});

// ── ITEM 5 — SUPERSEDED by TEN-403 (founder Shell refresh, 2026-10-08, part 3) ─────────
// "The list re-orders by biggest |move| first … If a player has no opening price, the move is
// `—` and the card sorts last." The move view no longer drops a card; the ordering, the `—`
// tier and the one-decimal move are locked in test-ten403-matches.mjs.
test('TEN-403 supersedes item 5: the move view re-orders, it never filters', () => {
  const gf = /function getFiltered\(\)\{([\s\S]*?)\n\}/.exec(html)?.[1] || '';
  assert.ok(gf.length > 500, 'getFiltered not found — this check would be vacuous');
  assert.doesNotMatch(gf, /out = out\.filter\(mxMoved\)/);
  assert.doesNotMatch(html, /function mxMoved\(/, 'the filter predicate is gone with the filter');
  assert.match(gf, /else if \(state\.sort === 'drift'\)\{/);
});

test('TEN-377 review item 8 (supersedes TEN-225 item 5): the tile carries no "N of M matches moved" line', () => {
  assert.doesNotMatch(html, /matches moved · the rest are filtered out|MX_DRIFT_FILTER/);
});

test('clicking again restores the time view', () => {
  // The toggle sets state.sort back to 'time'; mxDriftView() is then false.
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
  const pre = html.replace(/\$\{mxOddsTxt\(open\)\}/g, '${open.toFixed(2)}');
  assert.notEqual(pre, html, 'the mutation anchors are gone — this control is vacuous');
  assert.ok((pre.match(/\$\{open\.toFixed\(2\)\}/g) || []).length > 0);
  const filtered = html.replace("else if (state.sort === 'drift'){", "if (mxDriftView()){ out = out.filter(mxMoved); }\n  else if (state.sort === 'drift'){");
  const gf = /function getFiltered\(\)\{([\s\S]*?)\n\}/.exec(filtered)?.[1] || '';
  assert.match(gf, /out = out\.filter\(mxMoved\)/, 'MUTANT: a re-introduced filter is caught by the check above');
});
