#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// TEN-243 — elo-ratings.json carries a PEAK, and it carries it in a shape the
// Ratings board can render without inventing anything.
//
// Founder 2026-09-21: Peak Elo and Peak Month are published columns on
// tennisabstract.com/reports/atp_elo_ratings.html and the scraper was simply
// stopping its regex before them. This suite exists so the column cannot go
// quiet again — a peak that silently stops parsing looks exactly like a peak
// that was never there, and the board would just dash.
//
// SHAPE, NEVER LITERALS. elo.yml rewrites this file every Monday and commits it,
// so asserting a specific rating would fail the deploy gate the first time
// somebody plays a match. This repo has already lost ~19 hours of deploys to two
// assertions that pinned a value a job rewrites. Everything below is an
// invariant: presence, type, range, format, coverage ratio.
//
// NETWORK-FREE on purpose: it reads the committed store, never the source page.
// `npm test` is the fail-closed pre-deploy gate.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const STORE = path.join(__dirname, '..', 'elo-ratings.json');
let pass = 0; const fails = [];
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fails.push(name); console.error(`  FAIL ${name}\n       ${e.message}`); }
}

if (!fs.existsSync(STORE)) {
  console.error(`elo store shape: ${STORE} is missing — nothing to check.`);
  process.exit(1);
}
const d = JSON.parse(fs.readFileSync(STORE, 'utf8'));
const recs = Object.entries(d.elo || {});

check('the store still parses into a non-trivial keyed set', () => {
  assert.ok(recs.length > 300, `expected a few hundred keyed players, got ${recs.length}`);
  assert.strictEqual(typeof d.count, 'number');
  assert.ok(d.count >= recs.length, 'count must be at least the keyed set');
});

check('every record still carries all/hard/clay/grass — the peak did not displace them', () => {
  for (const [k, r] of recs) {
    for (const s of ['all', 'hard', 'clay', 'grass']) {
      assert.ok(s in r, `${k} lost its ${s} node`);
    }
    assert.strictEqual(typeof r.all.rating, 'number', `${k} overall rating is not a number`);
  }
});

check('PEAK is present on effectively the whole keyed set', () => {
  // A ratio, not a literal: the source publishes a peak for every row it lists,
  // measured 550/550 on 2026-09-21. If that ever drops below nearly-all, the
  // parse has broken rather than the data having changed.
  const withPeak = recs.filter(([, r]) => r.peak).length;
  const ratio = withPeak / recs.length;
  assert.ok(ratio > 0.95,
    `peak present on only ${withPeak}/${recs.length} (${(ratio * 100).toFixed(1)}%) — the regex has probably stopped reaching the Peak columns`);
});

check('a peak is {rating:number, month:"YYYY-MM"} or null — never 0, never a bare number', () => {
  for (const [k, r] of recs) {
    if (r.peak === null || r.peak === undefined) continue;
    assert.strictEqual(typeof r.peak, 'object', `${k} peak is not an object`);
    assert.strictEqual(typeof r.peak.rating, 'number', `${k} peak.rating is not a number`);
    assert.ok(r.peak.rating > 0, `${k} peak.rating is ${r.peak.rating} — a peak of zero is a parse failure, not a rating`);
    assert.ok(/^\d{4}-\d{2}$/.test(String(r.peak.month)),
      `${k} peak.month is ${JSON.stringify(r.peak.month)} — must be the month the source printed, not a widened date`);
  }
});

check('a peak is never BELOW the current rating by more than rounding', () => {
  // The peak is the all-time high, so current <= peak. Both are rounded to whole
  // points on the way in, so allow exactly 1 for the rounding seam and no more.
  // This is the assertion that catches a column-offset bug — reading the wrong
  // <td> would put an ATP rank or a log-diff here and this would fire at once.
  const bad = recs.filter(([, r]) => r.peak && r.all.rating - r.peak.rating > 1);
  assert.strictEqual(bad.length, 0,
    `${bad.length} player(s) have a current Elo above their peak, e.g. ` +
    bad.slice(0, 3).map(([k, r]) => `${k} ${r.all.rating} > ${r.peak.rating}`).join(', '));
});

check('peak months are inside a believable window, so a mis-read column is caught', () => {
  const yr = new Date().getUTCFullYear();
  for (const [k, r] of recs) {
    if (!r.peak) continue;
    const y = parseInt(String(r.peak.month).slice(0, 4), 10);
    const mo = parseInt(String(r.peak.month).slice(5, 7), 10);
    assert.ok(y >= 1968 && y <= yr, `${k} peak month year ${y} is outside the open era..now`);
    assert.ok(mo >= 1 && mo <= 12, `${k} peak month ${mo} is not a month`);
  }
});

check('the surname fallback carries the same shape as the keyed map', () => {
  // bySurnameElo is what the board consults when the key misses, so a peak that
  // exists on one map and not the other would dash for exactly the players the
  // fallback was built to rescue.
  const fb = Object.entries(d.bySurnameElo || {});
  assert.ok(fb.length > 100, `expected a populated fallback map, got ${fb.length}`);
  const withPeak = fb.filter(([, r]) => r && r.peak).length;
  assert.ok(withPeak / fb.length > 0.95,
    `fallback map carries peak on only ${withPeak}/${fb.length} — the two maps have diverged`);
});

console.log(`\nelo store shape: ${pass} pass, ${fails.length} fail`);
if (fails.length) { console.error('FAILED: ' + fails.join(' · ')); process.exit(1); }
