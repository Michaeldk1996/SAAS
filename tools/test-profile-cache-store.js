#!/usr/bin/env node
'use strict';
/**
 * TEN-206 — locks the founder's Q2(d) ch-1 ruling: "key per day + commit one
 * gzipped file daily."
 *
 * Every assertion here is paired with a negative control that MUTATES the input so
 * the assertion must flip. A check that only reads is a check that can go vacuous
 * the day the code stops running at all; these mutate.
 *
 * What is actually locked:
 *   A  hydrate prefers the newer store by fetchedAt (a stale warm Actions cache must
 *      not shadow a freshly committed rebuild)
 *   B  hydrate falls back to the committed .gz when the cache restored nothing
 *   C  freeze writes at most one refresh per UTC day (the whole point of the ruling —
 *      content changes every 10-minute run, so "commit if changed" would be ~144/day)
 *   D  freeze never overwrites a newer committed copy with an older live one
 *   E  freeze refuses to freeze a store with no fetchedAt stamp
 *   F  freeze's output is byte-deterministic, so an idle day produces no git diff
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const assert = require('assert');

const store = require('./profile-cache-store.js');

let passed = 0;
const failures = [];
function check(label, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${label}`);
  } catch (err) {
    failures.push(`${label}: ${err.message}`);
    console.log(`  ✗ ${label} — ${err.message}`);
  }
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pcstore-'));
}

function makeStore(fetchedAt, n, tag) {
  const players = {};
  for (let i = 0; i < n; i++) {
    players[`p${i}`] = { builtAt: fetchedAt, v: 14, profile: { careerByYear: {}, tag: tag || 'x' } };
  }
  return { fetchedAt, players };
}

function writePlain(root, obj) {
  fs.writeFileSync(path.join(root, 'player-profiles-cache.json'), JSON.stringify(obj));
}
function writeGz(root, obj) {
  fs.writeFileSync(
    path.join(root, 'player-profiles-cache.json.gz'),
    zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'), { level: 9 })
  );
}
function readPlain(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'player-profiles-cache.json'), 'utf8'));
}
function readGz(root) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, 'player-profiles-cache.json.gz'))).toString('utf8'));
}

const OLD = '2026-07-22T02:11:26.179Z'; // the real stamp on the committed July cache
const NEW = '2026-09-16T11:44:15.331Z'; // the real stamp on the v14/470 rebuild

console.log('test-profile-cache-store:');

// ---- A. hydrate prefers the newer store -------------------------------------
check('A1 · committed .gz NEWER than the restored cache wins', () => {
  const root = tmpRoot();
  writePlain(root, makeStore(OLD, 3, 'stale-cache'));
  writeGz(root, makeStore(NEW, 5, 'fresh-commit'));
  store.hydrate(root);
  const got = readPlain(root);
  assert.strictEqual(got.fetchedAt, NEW, `expected the ${NEW} store, got ${got.fetchedAt}`);
  assert.strictEqual(Object.keys(got.players).length, 5);
});

check('A2 · NEG — flip the stamps and the restored cache must survive untouched', () => {
  const root = tmpRoot();
  // Same two files as A1, stamps swapped. If hydrate ignored fetchedAt and always
  // took the .gz, this would come back with 5 entries and the test would fail.
  writePlain(root, makeStore(NEW, 3, 'fresh-cache'));
  writeGz(root, makeStore(OLD, 5, 'stale-commit'));
  store.hydrate(root);
  const got = readPlain(root);
  assert.strictEqual(got.fetchedAt, NEW, `hydrate clobbered a newer cache with an older commit (${got.fetchedAt})`);
  assert.strictEqual(Object.keys(got.players).length, 3);
});

check('A3 · equal stamps keep the restored cache (no pointless rewrite)', () => {
  const root = tmpRoot();
  writePlain(root, makeStore(NEW, 3, 'cache'));
  writeGz(root, makeStore(NEW, 5, 'commit'));
  store.hydrate(root);
  assert.strictEqual(Object.keys(readPlain(root).players).length, 3);
});

check('A4 · an UNSTAMPED restored cache never beats a stamped commit', () => {
  const root = tmpRoot();
  const unstamped = makeStore(NEW, 3, 'cache');
  delete unstamped.fetchedAt;
  writePlain(root, unstamped);
  writeGz(root, makeStore(OLD, 5, 'commit'));
  store.hydrate(root);
  assert.strictEqual(Object.keys(readPlain(root).players).length, 5, 'unstamped cache was allowed to win');
});

// ---- B. hydrate is the cache-miss floor -------------------------------------
check('B1 · no restored cache at all — the committed .gz is what the pipeline builds from', () => {
  const root = tmpRoot();
  writeGz(root, makeStore(NEW, 7, 'commit'));
  store.hydrate(root);
  assert.strictEqual(Object.keys(readPlain(root).players).length, 7);
});

check('B2 · NEG — with no .gz either, hydrate leaves the restored cache alone', () => {
  const root = tmpRoot();
  writePlain(root, makeStore(OLD, 2, 'cache'));
  store.hydrate(root);
  assert.strictEqual(readPlain(root).fetchedAt, OLD);
});

check('B3 · a CORRUPT .gz must not destroy the restored cache', () => {
  const root = tmpRoot();
  writePlain(root, makeStore(OLD, 2, 'cache'));
  fs.writeFileSync(path.join(root, 'player-profiles-cache.json.gz'), Buffer.from('not gzip at all'));
  store.hydrate(root);
  assert.strictEqual(Object.keys(readPlain(root).players).length, 2, 'corrupt .gz wiped the live cache');
});

// ---- C. one refresh per UTC day ---------------------------------------------
const todayStamp = new Date().toISOString();
const yesterdayStamp = new Date(Date.now() - 26 * 3600 * 1000).toISOString();

check("C1 · committed copy already stamped TODAY — freeze skips (this is the '1/day' rule)", () => {
  const root = tmpRoot();
  writeGz(root, makeStore(todayStamp, 4, 'this-morning'));
  writePlain(root, makeStore(new Date(Date.now() + 1000).toISOString(), 9, 'this-run'));
  const written = store.freeze(root);
  assert.strictEqual(written, 0, 'froze a second time on the same UTC day');
  assert.strictEqual(Object.keys(readGz(root).players).length, 4, 'committed copy was rewritten anyway');
});

check('C2 · NEG — move the committed stamp to YESTERDAY and freeze must fire', () => {
  const root = tmpRoot();
  // Identical to C1 except for one mutated field. If the day-guard were not live,
  // C1 would pass for the wrong reason (e.g. freeze never writing at all).
  writeGz(root, makeStore(yesterdayStamp, 4, 'yesterday'));
  writePlain(root, makeStore(todayStamp, 9, 'this-run'));
  const written = store.freeze(root);
  assert.strictEqual(written, 1, 'day-guard blocked a refresh that was a day overdue');
  assert.strictEqual(Object.keys(readGz(root).players).length, 9);
});

check('C3 · no committed copy yet — freeze seeds it', () => {
  const root = tmpRoot();
  writePlain(root, makeStore(todayStamp, 6, 'seed'));
  assert.strictEqual(store.freeze(root), 1);
  assert.strictEqual(Object.keys(readGz(root).players).length, 6);
});

check('C4 · --force overrides the day-guard (the manual seed path)', () => {
  const root = tmpRoot();
  writeGz(root, makeStore(todayStamp, 4, 'this-morning'));
  writePlain(root, makeStore(new Date(Date.now() + 1000).toISOString(), 9, 'this-run'));
  assert.strictEqual(store.freeze(root, { force: true }), 1);
  assert.strictEqual(Object.keys(readGz(root).players).length, 9);
});

// ---- D. never go backwards ---------------------------------------------------
check('D1 · a live store OLDER than the committed one is refused', () => {
  const root = tmpRoot();
  writeGz(root, makeStore(yesterdayStamp, 470, 'good'));
  writePlain(root, makeStore(OLD, 2, 'july-rot'));
  assert.strictEqual(store.freeze(root), 0, 'let a July cache overwrite a current commit');
  assert.strictEqual(Object.keys(readGz(root).players).length, 470);
});

check('D2 · NEG — make the same live store NEWER and it is accepted', () => {
  const root = tmpRoot();
  writeGz(root, makeStore(yesterdayStamp, 470, 'good'));
  // Same entry count as the floor: this control isolates the AGE guard, so it must
  // not also trip the shrink guard below. (It did, first time round — which is the
  // point of running the controls.)
  writePlain(root, makeStore(todayStamp, 470, 'newer'));
  assert.strictEqual(store.freeze(root), 1, 'the age guard is refusing everything, not just older stores');
});

check('D3 · a NEWER but SMALLER live store is refused (broken hydrate, not a real shrink)', () => {
  const root = tmpRoot();
  writeGz(root, makeStore(yesterdayStamp, 470, 'floor'));
  // Exactly what a failed hydrate produces: the pipeline started from {} and
  // rebuilt only today's board, so the store is newer AND much smaller.
  writePlain(root, makeStore(todayStamp, 137, 'board-only'));
  assert.strictEqual(store.freeze(root), 0, 'let a 137-entry board-only store cut the 470 floor');
  assert.strictEqual(Object.keys(readGz(root).players).length, 470);
});

check('D4 · NEG — the same store at EQUAL size is accepted (the guard is size, not paranoia)', () => {
  const root = tmpRoot();
  writeGz(root, makeStore(yesterdayStamp, 470, 'floor'));
  writePlain(root, makeStore(todayStamp, 470, 'grown'));
  assert.strictEqual(store.freeze(root), 1, 'the shrink guard is blocking legitimate refreshes');
});

// ---- E. refuse an unstamped store -------------------------------------------
check('E1 · live store with no fetchedAt is never frozen', () => {
  const root = tmpRoot();
  const unstamped = makeStore(todayStamp, 5, 'x');
  delete unstamped.fetchedAt;
  writePlain(root, unstamped);
  assert.strictEqual(store.freeze(root), 0);
  assert.ok(!fs.existsSync(path.join(root, 'player-profiles-cache.json.gz')), 'wrote an unstamped store');
});

// ---- F. byte-determinism -----------------------------------------------------
check('F1 · identical content gzips to identical bytes (an idle day is a no-op in git)', () => {
  const rootA = tmpRoot();
  const rootB = tmpRoot();
  const obj = makeStore(todayStamp, 25, 'same');
  writePlain(rootA, obj);
  writePlain(rootB, obj);
  store.freeze(rootA);
  store.freeze(rootB);
  const a = fs.readFileSync(path.join(rootA, 'player-profiles-cache.json.gz'));
  const b = fs.readFileSync(path.join(rootB, 'player-profiles-cache.json.gz'));
  assert.ok(a.equals(b), 'gzip output is not reproducible — every day would show a diff even when nothing changed');
});

check('F2 · NEG — change one byte of content and the blob must differ', () => {
  const rootA = tmpRoot();
  const rootB = tmpRoot();
  writePlain(rootA, makeStore(todayStamp, 25, 'same'));
  writePlain(rootB, makeStore(todayStamp, 25, 'different'));
  store.freeze(rootA);
  store.freeze(rootB);
  const a = fs.readFileSync(path.join(rootA, 'player-profiles-cache.json.gz'));
  const b = fs.readFileSync(path.join(rootB, 'player-profiles-cache.json.gz'));
  assert.ok(!a.equals(b), 'F1 is vacuous — the blob is identical regardless of content');
});

console.log(`test-profile-cache-store: ${passed} checks passed${failures.length ? `, ${failures.length} FAILED` : ''}`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}
