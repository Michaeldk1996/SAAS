// tools/test-profile-roster.js — TEN-206 fail-closed roster gate.
//
// WHAT THIS EXISTS FOR
// --------------------
// The published player-profiles.json used to be rebuilt from today's board only:
// the seed players on matches.json plus the opponents found in THEIR recent form.
// Players already profiled and sitting in player-profiles-cache.json were never
// unioned back in, so the roster tracked how busy the tour was that day rather
// than how many players we hold. Measured 2026-09-16: a 5-match board published
// 137 players where the 2026-07-22 snapshot of a full tour week published 428.
// Nothing failed — the file was valid, just two thirds empty — and the shrink
// propagated to every downstream builder that reads this file as its roster.
//
// This gate locks the OUTCOME, not the mechanism: whatever we hold a usable
// profile for must appear in the published file. A future rewrite of
// buildPlayerProfiles is free; quietly re-cutting the roster is not.
//
// Run: node tools/test-profile-roster.js
// Exits non-zero on failure, so it can gate the deploy.

'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const PUBLISHED = path.join(ROOT, 'player-profiles.json');
const CACHE = path.join(ROOT, 'player-profiles-cache.json');

let pass = 0, fail = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; failures.push(name + ' :: ' + e.message); console.log('  FAIL  ' + name + ' :: ' + e.message); }
}
// A negative control asserts fn THROWS. If it does not, the paired positive
// check is vacuous and we say so loudly rather than banking a free PASS.
function mustFail(name, fn) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (threw) { pass++; console.log('  PASS  [neg] ' + name + ' (correctly rejected)'); }
  else {
    fail++; failures.push('[neg] ' + name + ' :: corruption NOT caught — check is vacuous');
    console.log('  FAIL  [neg] ' + name + ' :: corruption NOT caught — check is vacuous');
  }
}

console.log('TEN-206 · published-roster gate');

if (!fs.existsSync(PUBLISHED)) {
  console.log('  SKIP  player-profiles.json absent — nothing published to gate.');
  process.exit(0);
}
const published = JSON.parse(fs.readFileSync(PUBLISHED, 'utf8')).players || {};
const pubKeys = Object.keys(published);

if (!fs.existsSync(CACHE)) {
  // A cold cache is legitimate (first run on a fresh machine). Say so out loud
  // rather than passing silently — a silent pass here is how a cut hides.
  console.log(`  SKIP  no player-profiles-cache.json — cannot gate a ${pubKeys.length}-player file against it.`);
  process.exit(0);
}
const cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')).players || {};
// The negative cache (profile:null) is players the feed has no stats for. They
// are excluded from publication by design, so they are not expected here.
const cacheKeys = Object.keys(cache).filter(k => cache[k] && cache[k].profile);

console.log(`        cache holds ${cacheKeys.length} usable profile(s); published file carries ${pubKeys.length}`);

// ── 1 · the union actually happened ─────────────────────────────────────────
check('every cached profile reaches the published file', () => {
  const pub = new Set(pubKeys);
  const missing = cacheKeys.filter(k => !pub.has(k));
  assert.strictEqual(missing.length, 0,
    `${missing.length} of ${cacheKeys.length} cached profiles were dropped `
    + `(e.g. ${missing.slice(0, 5).map(k => (cache[k].profile.name || k)).join(', ')})`);
});
mustFail('the union check would catch a board-scoped re-cut', () => {
  // Reproduce the exact defect: publish only the players built this run.
  const pub = new Set(pubKeys.slice(0, Math.max(1, Math.floor(pubKeys.length / 3))));
  const missing = cacheKeys.filter(k => !pub.has(k));
  assert.strictEqual(missing.length, 0, `${missing.length} cached profiles were dropped`);
});

// ── 2 · the roster cannot collapse to board size ─────────────────────────────
// A standing floor, independent of the union above: whatever the board looks
// like on a given day, the site is an ATP-roster product. 137 was the observed
// failure; 300 sits well below any healthy run and well above any quiet board.
const ROSTER_FLOOR = 300;
check(`the published roster clears the ${ROSTER_FLOOR}-player floor`, () => {
  assert(pubKeys.length >= ROSTER_FLOOR,
    `only ${pubKeys.length} players published — the roster has collapsed toward board size again`);
});
mustFail('the floor would catch the 2026-09-16 state', () => {
  assert(137 >= ROSTER_FLOOR, 'only 137 players published — the roster has collapsed toward board size again');
});

// ── 3 · the roster is not padded with empty shells ───────────────────────────
// A union that restored key-only stubs would clear checks 1 and 2 while leaving
// the page full of dashes, so require the restored profiles to carry real rows.
check('published profiles carry real career data, not empty shells', () => {
  const shells = pubKeys.filter((k) => {
    const p = published[k];
    return !p || !Array.isArray(p.careerByYear) || !p.careerByYear.length;
  });
  const pct = 100 * shells.length / pubKeys.length;
  assert(pct < 10,
    `${shells.length}/${pubKeys.length} (${pct.toFixed(1)}%) published profiles have no careerByYear rows`);
  console.log(`        ${pubKeys.length - shells.length}/${pubKeys.length} carry careerByYear rows`);
});
mustFail('the shell check would catch a roster padded with stubs', () => {
  const shells = new Array(50).fill(0);
  const pct = 100 * shells.length / 100;
  assert(pct < 10, `${shells.length}/100 (${pct.toFixed(1)}%) published profiles have no careerByYear rows`);
});

// ── 4 · report the cost this gate is defending ───────────────────────────────
// Not an assertion — a disclosure. Pages serves this gzipped, and quoting the
// raw MB alone has repeatedly overstated the real cost of the roster.
const raw = fs.statSync(PUBLISHED).size;
const gz = zlib.gzipSync(fs.readFileSync(PUBLISHED), { level: 6 }).length;
console.log(`        payload: ${(raw / 1048576).toFixed(2)} MB raw, `
  + `${(gz / 1048576).toFixed(2)} MB gzipped over the wire, `
  + `${(raw / pubKeys.length / 1024).toFixed(1)} KB/player`);

console.log('\n' + '='.repeat(64));
console.log(`PASS ${pass}   FAIL ${fail}`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f));
}
process.exit(fail ? 1 : 0);
