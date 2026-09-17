#!/usr/bin/env node
/**
 * TEN-206 — player search must not be bounded by the profile payload.
 *
 * THE DEFECT THIS LOCKS OUT
 * The search dropdown filtered player-profiles.json, and that file's roster is
 * today's board (seed players) plus the opponents found in their recent form.
 * On a 4-match Davis Cup day that collapsed to 31 names, so "Zverev" returned
 * "No player found". Search coverage and payload weight were the same number.
 *
 * They are now two files: player-index.json (every ranked ATP player — name,
 * rank, country, hasProfile) and profiles/<key>.json (one player, fetched when
 * he is opened). These tests assert the split holds, and — the part that
 * actually matters — that the index cannot silently shrink back.
 *
 * Every test here MUTATES its input and asserts the output changes. A test that
 * only reads a healthy fixture would pass just as happily against the broken
 * build it is meant to catch.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}

// Load the pipeline with a key present so module-level config resolves; these
// tests never hit the network (writePlayerShardsAndIndex is pure + fs).
process.env.API_TENNIS_KEY = process.env.API_TENNIS_KEY || 'test-key-not-used';
const pipeline = require('../bsp-pipeline.js');

// A standings list shaped like the real one: 1,800 is the fail-closed floor, so
// the fixture must clear it or every test would be measuring the guard instead.
function standings(n) {
  const rows = [];
  for (let i = 1; i <= n; i++) rows.push({ key: String(1000 + i), name: `Player ${i}`, rank: i, country: 'XX' });
  return rows;
}
function profile(key, name) {
  return { key: String(key), name, country: 'XX', recentForm: { matches: [] } };
}
function inDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten206-idx-'));
  const cwd = process.cwd();
  process.chdir(dir);
  try { return fn(dir); } finally { process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true }); }
}
// The index is built from the rows loadAtpStandings() keeps as a side effect, so
// the tests drive that module state directly rather than re-fetching.
function build(rows, profiles) {
  return inDir(() => {
    pipeline._setStandingRowsForTest(rows);
    pipeline.writePlayerShardsAndIndex(profiles, { dna: {}, stats: {} });
    const shards = fs.readdirSync('profiles').filter(f => f.endsWith('.json'));
    // Read eagerly: inDir() deletes the directory on the way out, so a lazy
    // reader would ENOENT rather than test anything.
    const bodies = {};
    for (const f of shards) bodies[f.replace('.json', '')] = JSON.parse(fs.readFileSync(`profiles/${f}`, 'utf8'));
    return {
      index: JSON.parse(fs.readFileSync('player-index.json', 'utf8')),
      shards,
      read: k => bodies[k],
    };
  });
}

console.log('TEN-206 player search index');

t('search reaches a player who has NO profile — the original defect', () => {
  // The roster is 2 profiles (a 4-match board). The 2,000th ranked player must
  // still be findable. Under the old build he was not in the file at all.
  const { index } = build(standings(2000), { '1001': profile(1001, 'Player 1'), '1002': profile(1002, 'Player 2') });
  assert.strictEqual(index.players.length, 2000, 'index must carry the whole ranked field, not the profiled few');
  const far = index.players.find(p => p.key === '3000');
  assert.ok(far, 'rank-2000 player missing from the index');
  assert.strictEqual(far.hasProfile, false, 'he has no profile and the index must say so');
});

t('MUTATION: drop a player from standings and he leaves the index', () => {
  const full = standings(2000);
  const a = build(full, {}).index.players.length;
  const b = build(full.filter(r => r.key !== '1500'), {}).index.players.length;
  assert.strictEqual(a - b, 1, `removing one standings row must remove one index row (${a} -> ${b})`);
  const gone = build(full.filter(r => r.key !== '1500'), {}).index.players.find(p => p.key === '1500');
  assert.strictEqual(gone, undefined, 'the removed player is still in the index — the index is not reading standings');
});

t('a truncated standings fetch fails closed instead of shrinking search', () => {
  // This is the exact failure being fixed, so a partial return must throw and
  // leave the previous index live rather than quietly publishing a short roster.
  assert.throws(() => build(standings(1799), {}), /failing closed/i,
    'a short standings list was accepted — search would silently shrink');
  // ...and the floor is a real boundary, not an always-throw.
  assert.doesNotThrow(() => build(standings(1800), {}), 'the floor itself must pass');
});

t('hasProfile is exactly the set with a shard on disk', () => {
  const profiles = { '1001': profile(1001, 'Player 1'), '1050': profile(1050, 'Player 50') };
  const { index, shards } = build(standings(2000), profiles);
  const flagged = index.players.filter(p => p.hasProfile).map(p => p.key).sort();
  assert.deepStrictEqual(flagged, ['1001', '1050'], 'hasProfile set is wrong');
  assert.deepStrictEqual(shards.map(f => f.replace('.json', '')).sort(), ['1001', '1050'],
    'a flagged player without a shard renders an empty page; a shard without a flag is unreachable');
});

t('MUTATION: a profile that arrives flips hasProfile true and mints its shard', () => {
  const before = build(standings(2000), {});
  assert.strictEqual(before.index.players.find(p => p.key === '1001').hasProfile, false);
  assert.strictEqual(before.shards.length, 0);
  const after = build(standings(2000), { '1001': profile(1001, 'Player 1') });
  assert.strictEqual(after.index.players.find(p => p.key === '1001').hasProfile, true,
    'hasProfile did not follow the profile — it is hardcoded, not derived');
  assert.deepStrictEqual(after.shards, ['1001.json']);
});

t('a profiled player with no standings row stays searchable (retired/unranked)', () => {
  const { index } = build(standings(2000), { '99999': profile(99999, 'Retired Guy') });
  const r = index.players.find(p => p.key === '99999');
  assert.ok(r, 'a player we hold a profile for was dropped from search');
  assert.strictEqual(r.rank, null, 'no standings row means a dash, never a rank');
  assert.strictEqual(r.hasProfile, true);
});

t('a stale shard is removed when its player leaves the roster', () => {
  // Shards are rewritten from scratch each run; a leftover file would keep
  // serving a profile that no longer refreshes.
  inDir(() => {
    pipeline._setStandingRowsForTest(standings(2000));
    pipeline.writePlayerShardsAndIndex({ '1001': profile(1001, 'Player 1'), '1002': profile(1002, 'Player 2') }, {});
    assert.strictEqual(fs.readdirSync('profiles').length, 2);
    pipeline.writePlayerShardsAndIndex({ '1001': profile(1001, 'Player 1') }, {});
    assert.deepStrictEqual(fs.readdirSync('profiles'), ['1001.json'], 'the departed player kept his shard');
  });
});

t('index rows sort best-rank-first, unranked last, and never mint a rank 0', () => {
  const rows = standings(2000);
  const { index } = build(rows, { '99999': profile(99999, 'Retired Guy') });
  assert.strictEqual(index.players[0].rank, 1);
  assert.strictEqual(index.players[index.players.length - 1].rank, null, 'unranked must sort last');
  assert.ok(!index.players.some(p => p.rank === 0), 'Number("") === 0 minted a phantom rank 0');
});

t('a shard carries a renderable profile, not just a key', () => {
  const { read } = build(standings(2000), { '1001': profile(1001, 'Player 1') });
  const s = read('1001');
  assert.strictEqual(s.key, '1001');
  assert.strictEqual(s.profile.name, 'Player 1', 'the shard must carry the profile the page renders');
});

t('the index stays small enough to load on every page view', () => {
  // The whole point of the split: findability must not cost what the profile
  // payload costs. 2,342 real rows measured at 43 KB gzipped.
  const zlib = require('zlib');
  const { index } = build(standings(2342), {});
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(index)), { level: 9 }).length;
  assert.ok(gz < 120 * 1024, `index is ${(gz / 1024).toFixed(0)} KB gzipped — too heavy to load eagerly`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
