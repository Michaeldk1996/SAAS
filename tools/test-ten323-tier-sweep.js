#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// TEN-323 — tier-page box-score archive, unioned into the shards at emit time.
//
// Drives the REAL emitShards() (build-point-by-point.js) and the REAL sweep
// helpers (tools/tier-page-sweep.js) in a scratch cwd. Each case names the
// mutation that turns it red.
//
//   1. A held point log is never replaced by the archive's (TEN-312 N12: the cache
//      is the only copy of past tiebreak points).
//      RED if emitShards merges archive-over-cache (mergeEntry(a, held)), or if
//      mergeEntry's `sets` rule stops checking that the held log is empty.
//   2. An archive-only match gets a setstats shard, a matchstats-index line and a
//      pbp shard. RED if the archive loop in emitShards is removed.
//   3. A cached match whose box score is null gains the archive's box score, and
//      its key is listed ONCE in each index. RED if the `redone` de-dupe is dropped
//      (key listed twice) or the `gainsBox` test is removed (never completed).
//   4. emitShards never writes into the cache object (the cache must not grow
//      towards V8's max string length). RED if the merge is assigned back
//      (`cache[ek] = merged`) or the archive entry is inserted into `cache`.
//   5. Only whole, settled weeks without a file are planned (the file is the
//      negative cache and is written once). RED if planWindows stops skipping
//      archived weeks, stops dropping the partial tail week, or lastSettledDay
//      stops subtracting SETTLE_DAYS.
//   6. 2024-03-01 → 2026-09-28 is 135 contiguous windows of ≤ 7 days.
//      RED if WINDOW_DAYS changes or the last window is not clamped to `to`.
//   7. archiveEntry keeps finished singles only. RED if the status or the
//      singles filter is removed.
//   8. writeWeek is byte-deterministic (an idle rerun commits nothing).
//      RED if a run stamp (a builtAt / fetchedAt field, or a gzip header mtime) is
//      written into the week file. (Key order alone cannot turn it red: V8 already
//      orders integer-like keys ascending, so the explicit sort is belt-and-braces.)
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { emitShards, mergeEntry } = require(path.join(ROOT, 'build-point-by-point.js'));
const sweep = require(path.join(ROOT, 'tools', 'tier-page-sweep.js'));

let pass = 0; const fails = [];
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fails.push(name); console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const sheet = n => ({ p1: { 'Service:Aces': n }, p2: { 'Service:Aces': n + 1 } });
// A 7-6 set whose tiebreak points only the cache holds.
const HELD_SETS = [{ set: 1, games: [{ g: 13, server: 'p1', winner: 'p1', score: '7 - 6', points: [{ n: 1, s: '1 - 0' }, { n: 2, s: '2 - 0' }] }] }];
const FEED_SETS = [{ set: 1, games: [{ g: 13, server: 'p1', winner: 'p1', score: '7 - 6', points: [] }] }];

function withScratch(fn) {
  const prev = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten323-'));
  process.chdir(dir);
  try {
    fs.mkdirSync('pbp'); fs.mkdirSync('setstats'); fs.mkdirSync('boxscore-archive');
    return fn(dir);
  } finally { process.chdir(prev); fs.rmSync(dir, { recursive: true, force: true }); }
}

function run(cache, archiveMonths) {
  for (const [id, entries] of Object.entries(archiveMonths)) { const [tier, start] = id.split('@'); sweep.writeWeek('boxscore-archive', tier, start, entries); }
  const index = [], setIndex = [], matchIndex = [];
  const counts = emitShards(cache, index, setIndex, matchIndex, { archiveDir: 'boxscore-archive' });
  return { index, setIndex, matchIndex, counts };
}
const readShard = p => JSON.parse(fs.readFileSync(p, 'utf8'));

check('1. a held point log (tiebreak points) is never replaced by the archive', () => withScratch(() => {
  const cache = { 100: { p1: 'A', p2: 'B', sets: HELD_SETS, p1Key: 1, p2Key: 2, stats: null, matchStats: null } };
  const arch = { 100: { p1: 'A', p2: 'B', sets: FEED_SETS, p1Key: 1, p2Key: 2, stats: null, matchStats: sheet(3), t: 'atp', d: '2024-08-05' } };
  const r = run(cache, { '265@2024-08-02': arch });
  assert.deepStrictEqual(readShard('pbp/100.json').sets, HELD_SETS, 'pbp shard lost the held tiebreak points');
  assert.deepStrictEqual(mergeEntry(cache[100], arch[100]).sets, HELD_SETS, 'mergeEntry replaced a held log');
  assert.deepStrictEqual(readShard('setstats/100.json').match, sheet(3), 'the archive box score should still complete the entry');
  assert.deepStrictEqual(r.index, ['100']);
}));

check('2. an archive-only match gets setstats + matchstats-index + pbp', () => withScratch(() => {
  const arch = { 200: { p1: 'C', p2: 'D', sets: FEED_SETS, p1Key: 3, p2Key: 4, stats: { 1: sheet(1) }, matchStats: sheet(5), t: 'challenger', d: '2025-01-02' } };
  const r = run({}, { '281@2024-12-27': arch });
  assert.deepStrictEqual(r.matchIndex, ['200']);
  assert.deepStrictEqual(r.setIndex, ['200']);
  assert.deepStrictEqual(r.index, ['200']);
  assert.deepStrictEqual(readShard('setstats/200.json'), { p1Key: 3, p2Key: 4, sets: { 1: sheet(1) }, match: sheet(5) });
  assert.strictEqual(r.counts.added, 1);
}));

check('3. a cached null box score is completed from the archive, listed once', () => withScratch(() => {
  const cache = { 300: { p1: 'E', p2: 'F', sets: HELD_SETS, p1Key: 5, p2Key: 6, stats: { 1: sheet(9) }, matchStats: null } };
  const arch = { 300: { p1: 'E', p2: 'F', sets: FEED_SETS, p1Key: 5, p2Key: 6, stats: { 1: sheet(2) }, matchStats: sheet(7), t: 'atp', d: '2025-03-01' } };
  const r = run(cache, { '265@2025-02-28': arch });
  assert.deepStrictEqual(r.matchIndex, ['300'], 'matchstats-index should list the completed key exactly once');
  assert.deepStrictEqual(r.setIndex, ['300'], 'setstats-index listed the key twice');
  assert.deepStrictEqual(r.index, ['300'], 'pbp-index listed the key twice');
  assert.deepStrictEqual(readShard('setstats/300.json').sets, { 1: sheet(9) }, 'held per-set stats must win');
  assert.strictEqual(r.counts.completed, 1);
}));

check('4. emitShards leaves the cache object untouched', () => withScratch(() => {
  const cache = { 400: { p1: 'G', p2: 'H', sets: [], p1Key: 7, p2Key: 8, stats: null, matchStats: null } };
  const before = JSON.stringify(cache);
  run(cache, { '265@2024-11-01': {
    400: { p1: 'G', p2: 'H', sets: FEED_SETS, p1Key: 7, p2Key: 8, stats: null, matchStats: sheet(1) },
    401: { p1: 'I', p2: 'J', sets: FEED_SETS, p1Key: 9, p2Key: 10, stats: null, matchStats: sheet(2) },
  } });
  assert.strictEqual(JSON.stringify(cache), before);
}));

check('5. only whole, settled, unarchived weeks are planned', () => {
  assert.strictEqual(sweep.lastSettledDay('2026-09-28'), '2026-09-25');
  const to = sweep.lastSettledDay('2026-09-28');
  const all = sweep.planWindows('2024-03-01', to, [265, 281], () => false);
  // 134 whole weeks end on or before 2026-09-25; the 135th (09-25..10-01) has not ended.
  assert.strictEqual(all.length, 2 * 134);
  assert.ok(all.every(p => p.w.stop <= to), 'an unsettled week was planned');
  assert.ok(all.every(p => (Date.parse(p.w.stop) - Date.parse(p.w.start)) / 864e5 === 6), 'a partial week was planned');
  const last = all[all.length - 1];
  assert.strictEqual(last.w.stop, '2026-09-24', 'the newest planned week should be the last whole settled one');
  const held = new Set(['265:2024-03-01', `${last.tier}:${last.w.start}`]);
  const rest = sweep.planWindows('2024-03-01', to, [265, 281], (t, s) => held.has(`${t}:${s}`));
  assert.strictEqual(rest.length, 2 * 134 - 2, 'an archived week was planned again');
  assert.ok(!rest.some(p => held.has(`${p.tier}:${p.w.start}`)));
});

check('6. 2024-03-01..2026-09-28 = 135 contiguous windows of <= 7 days', () => {
  const ws = sweep.weekWindows('2024-03-01', '2026-09-28');
  assert.strictEqual(ws.length, 135);
  assert.strictEqual(ws[0].start, '2024-03-01');
  assert.strictEqual(ws[ws.length - 1].stop, '2026-09-28');
  for (let i = 0; i < ws.length; i++) {
    const span = (Date.parse(ws[i].stop) - Date.parse(ws[i].start)) / 864e5;
    assert.ok(span >= 0 && span <= 6, `window ${i} spans ${span + 1} days`);
    if (i) assert.strictEqual((Date.parse(ws[i].start) - Date.parse(ws[i - 1].stop)) / 864e5, 1, `gap before window ${i}`);
  }
});

check('7. archiveEntry keeps finished singles only', () => {
  const f = (o) => ({ event_key: 1, event_type_type: 'Atp Singles', event_status: 'Finished', first_player_key: 1, second_player_key: 2,
    event_first_player: 'A', event_second_player: 'B', statistics: [], pointbypoint: [], event_date: '2025-01-01', ...o });
  assert.ok(sweep.archiveEntry(f({}), 265));
  assert.strictEqual(sweep.archiveEntry(f({ event_status: 'Set 2' }), 265), null, 'an in-play match was archived');
  assert.strictEqual(sweep.archiveEntry(f({ event_type_type: 'Atp Doubles' }), 265), null, 'a doubles match was archived');
  assert.strictEqual(sweep.archiveEntry(f({}), 265).t, 'atp');
});

check('8. writeWeek is byte-deterministic regardless of insertion order', () => withScratch(() => {
  sweep.writeWeek('boxscore-archive', 265, '2025-05-02', { 20: { a: 1 }, 3: { b: 2 } });
  const file = sweep.weekPath('boxscore-archive', 265, '2025-05-02');
  const a = fs.readFileSync(file);
  const t = Date.now(); while (Date.now() - t < 1100) { /* cross a second boundary so a stamp would differ */ }
  sweep.writeWeek('boxscore-archive', 265, '2025-05-02', { 3: { b: 2 }, 20: { a: 1 } });
  const b = fs.readFileSync(file);
  assert.ok(a.equals(b));
  assert.deepStrictEqual(Object.keys(sweep.readWeek(file)), ['3', '20']);
  assert.ok(sweep.FILE_RE.test(path.basename(file)));
}));

console.log(`\ntest-ten323-tier-sweep: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
