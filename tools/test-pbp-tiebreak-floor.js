#!/usr/bin/env node
'use strict';
// TEN-318 (TEN-312 N12) — locks the tiebreak floor in build-point-by-point.js.
//
// api-tennis no longer returns tiebreak point rows for past matches: asked again, it
// sends the games plus a ONE-ROW set summary. So a rebuild must never drop a TB row
// we hold. Every scenario below drives the REAL writer (build-point-by-point.js
// main(), in a temp cwd) against a STUBBED feed that returns exactly that one-row
// summary, then counts TB rows the way the PAGE does, with pbpSplitSet sliced out of
// bsp-consult-dashboard.html, never a copy of the rule.
//
// Each scenario also runs against a MUTANT (a guard switched off on the live module
// object the builder calls through), and the test fails if the scenario stays green.
// The mutation that turns the suite red when made in the source:
//   delete the post-fetch `tbFloor.restore(cache, held)` in build-point-by-point.js
//   (scenarios A, B, D go red), or make loadFloor() return {} (B goes red), or drop
//   `tbFloor: held` from the emitShards() call (E goes red: archive-sourced shards).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.env.API_TENNIS_KEY = 'stub';          // read at require time by the builder
process.env.PBP_TB_FLOOR_ANNOTATE = '0';      // refusal paths are driven on purpose
process.env.PBP_MAX_FETCHES = '50';

const tbFloor = require('./pbp-tiebreak-floor.js');
const builder = require(path.join(ROOT, 'build-point-by-point.js'));

// ── the page's own tiebreak rule, sliced from the dashboard ─────────────────────
const DASH = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
function slice(name) {
  const at = DASH.indexOf(`function ${name}(`);
  assert.ok(at >= 0 && DASH.indexOf(`function ${name}(`, at + 1) < 0, `${name} not found exactly once in the dashboard`);
  let i = DASH.indexOf('{', at), depth = 0;
  for (; i < DASH.length; i++) { if (DASH[i] === '{') depth++; else if (DASH[i] === '}' && --depth === 0) break; }
  return DASH.slice(at, i + 1);
}
const pbpSplitSet = new Function(`${slice('pbpParseScore')}\n${slice('pbpSplitSet')}\nreturn pbpSplitSet;`)();
// TB rows the page renders, per set number.
const pageTb = sets => Object.fromEntries((sets || []).map(s => [s.set, pbpSplitSet(s).tbPts.map(g => g.score).sort()]));

// ── fixtures ────────────────────────────────────────────────────────────────────
const TENNIS = ['15 - 0', '30 - 0', '40 - 0'].map((s, i) => ({ n: i + 1, s }));
// A 7-6 set: 12 real games, a 9-point tiebreak (7-2 to p1), and the summary row.
const TB_SCORES = ['1 - 0', '1 - 1', '2 - 1', '3 - 1', '4 - 1', '5 - 1', '5 - 2', '6 - 2', '7 - 2'];
function storedSet1() {
  const games = [];
  for (let g = 1; g <= 12; g++) games.push({ g, server: g % 2 ? 'p1' : 'p2', winner: g % 2 ? 'p1' : 'p2', score: `${Math.ceil(g / 2)} - ${Math.floor(g / 2)}`, points: TENNIS });
  TB_SCORES.forEach((score, i) => games.push({ g: i + 1, server: i % 4 < 2 ? 'p2' : 'p1', winner: /^[1-7] - [0-2]$/.test(score) && i !== 1 && i !== 6 ? 'p1' : 'p2', score, points: [] }));
  games.push({ g: 13, server: 'p2', winner: 'p1', score: '7 - 6', points: [{ n: 1, s: ' - ' }] });
  return { set: 1, games };
}
const storedSet2 = () => ({ set: 2, games: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(g => ({ g, server: 'p1', winner: g <= 6 ? 'p1' : 'p2', score: `${Math.min(g, 6)} - ${Math.max(0, g - 6)}`, points: TENNIS })) });
function storedEntry({ named = true } = {}) {
  return { ...(named ? { p1: 'A. First', p2: 'B. Second' } : {}), sets: [storedSet1(), storedSet2()], p1Key: 1, p2Key: 2, stats: null, matchStats: null };
}
// What the feed sends TODAY for the same match: games + the one-row summary.
function feedFixture(ek, { tbRows = [] } = {}) {
  const pbp = [];
  for (let g = 1; g <= 12; g++) pbp.push({ set_number: 'Set 1', number_game: String(g), player_served: g % 2 ? 'First Player' : 'Second Player', serve_winner: g % 2 ? 'First Player' : 'Second Player', score: `${Math.ceil(g / 2)} - ${Math.floor(g / 2)}`, points: [{ number_point: '1', score: '15 - 0' }, { number_point: '2', score: '30 - 0' }, { number_point: '3', score: '40 - 0' }] });
  for (const [i, score] of tbRows.entries()) pbp.push({ set_number: 'Set 1', number_game: String(i + 1), player_served: 'First Player', serve_winner: 'First Player', score, points: [] });
  pbp.push({ set_number: 'Set 1', number_game: '13', player_served: 'Second Player', serve_winner: 'First Player', score: '7 - 6', points: [{ number_point: '1', score: ' - ' }] });
  for (let g = 1; g <= 9; g++) pbp.push({ set_number: 'Set 2', number_game: String(g), player_served: 'First Player', serve_winner: g <= 6 ? 'First Player' : 'Second Player', score: `${Math.min(g, 6)} - ${Math.max(0, g - 6)}`, points: [{ number_point: '1', score: '15 - 0' }, { number_point: '2', score: '30 - 0' }, { number_point: '3', score: '40 - 0' }] });
  return { event_key: Number(ek), event_first_player: 'A. First', event_second_player: 'B. Second', first_player_key: 1, second_player_key: 2, pointbypoint: pbp, statistics: [] };
}

// ── harness: one temp cwd, a stubbed fetch, the real main() ─────────────────────
const realFetch = global.fetch;
async function runBuilder({ cache, floor, floorRaw, matches = [], form = [], archive = null, feed = ek => feedFixture(ek) }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten318-'));
  const cwd = process.cwd();
  fs.writeFileSync(path.join(dir, 'matches.json'), JSON.stringify({ matches }));
  if (cache) fs.writeFileSync(path.join(dir, 'point-by-point-cache.json'), JSON.stringify(cache));
  if (floor) fs.writeFileSync(path.join(dir, tbFloor.FLOOR_PATH), tbFloor.serialize(floor));
  if (floorRaw != null) fs.writeFileSync(path.join(dir, tbFloor.FLOOR_PATH), floorRaw);
  if (archive) {   // TEN-323 box-score archive: one gzipped tier-week file, entries in the cache-entry shape
    fs.mkdirSync(path.join(dir, 'boxscore-archive'));
    fs.writeFileSync(path.join(dir, 'boxscore-archive', '265-2024-03-01.json.gz'), require('zlib').gzipSync(JSON.stringify(archive)));
  }
  if (form.length) {
    fs.mkdirSync(path.join(dir, 'form'));
    fs.writeFileSync(path.join(dir, 'form', 'p.json'), JSON.stringify({ matches: form.map(ek => ({ eventKey: ek, date: '2026-09-18' })) }));
  }
  const calls = [];
  global.fetch = async url => {
    const ek = /match_key=(\d+)/.exec(url)[1];
    calls.push(ek);
    return { ok: true, status: 200, json: async () => ({ success: 1, result: [feed(ek)] }) };
  };
  const log = console.log;
  console.log = () => {};
  try { process.chdir(dir); await builder.main(); }
  finally { process.chdir(cwd); global.fetch = realFetch; console.log = log; }
  const read = f => {
    if (!fs.existsSync(path.join(dir, f))) return null;
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { return undefined; }   // the unreadable-floor control
  };
  const res = { dir, calls, cache: read('point-by-point-cache.json'), floor: read(tbFloor.FLOOR_PATH), floorBytes: fs.existsSync(path.join(dir, tbFloor.FLOOR_PATH)) ? fs.readFileSync(path.join(dir, tbFloor.FLOOR_PATH), 'utf8') : null, shard: ek => read(`pbp/${ek}.json`), out: read('point-by-point.json') };
  return res;
}

const STORED_TB = [...TB_SCORES].sort();
const EK_A = '12163900', EK_B = '12164026', EK_X = '12058261';

// ── scenarios ───────────────────────────────────────────────────────────────────
const scenarios = {
  // A. Incremental run. The stored entry is unnamed, so the form pass REFETCHES it
  //    (resolve(): "unnamed log, form-only: refetch for names") and the feed answers
  //    with the one-row summary. The refetch must not overwrite the stored TB rows.
  async 'A: a refetch that returns the one-row summary never overwrites stored TB rows'() {
    const r = await runBuilder({ cache: { [EK_A]: storedEntry({ named: false }) }, form: [EK_A] });
    assert.deepStrictEqual(r.calls, [EK_A], 'fixture must force exactly one refetch, or the scenario is vacuous');
    assert.deepStrictEqual(pageTb(r.cache[EK_A].sets)[1], STORED_TB, 'cache lost TB rows');
    assert.deepStrictEqual(pageTb(r.shard(EK_A).sets)[1], STORED_TB, 'pbp shard lost TB rows');
    assert.strictEqual(r.floor[EK_A][1].length, 9, 'floor did not absorb the stored rows');
  },
  // B. From-scratch rebuild: no cache file at all (schema bump / eviction), the
  //    committed floor present, the match on the board. The shard the page gets must
  //    carry every stored TB row, restored from the floor.
  async 'B: a from-scratch rebuild (cache absent) restores stored TB rows from the floor'() {
    const floor = {}; tbFloor.absorb(floor, { [EK_B]: storedEntry() });
    const r = await runBuilder({ floor, matches: [{ id: `past-${EK_B}`, finalScore: '7-6 6-3', p1: 'A. First', p2: 'B. Second' }] });
    assert.deepStrictEqual(r.calls, [EK_B], 'fixture must force exactly one fetch, or the scenario is vacuous');
    assert.deepStrictEqual(pageTb(r.shard(EK_B).sets)[1], STORED_TB, 'pbp shard lost TB rows');
    assert.deepStrictEqual(pageTb(r.out[EK_B].sets)[1], STORED_TB, 'point-by-point.json lost TB rows');
    assert.deepStrictEqual(pageTb(r.cache[EK_B].sets)[1], STORED_TB, 'cache was not healed');
  },
  // C. The floor never shrinks: a match the rebuilt cache does not hold at all keeps
  //    its rows, byte for byte in content.
  async 'C: a floor row whose match is absent from the cache survives the run'() {
    const floor = {}; tbFloor.absorb(floor, { [EK_X]: storedEntry() });
    const r = await runBuilder({ floor });
    assert.deepStrictEqual(r.floor[EK_X], floor[EK_X]);
  },
  // D. Rows only the feed has (a match finished today) are ADDED to the floor, and
  //    a partial refetch (4 of 9 rows) is topped back up to 9.
  async 'D: new TB rows from a fetch join the floor; a partial refetch is topped up'() {
    const floor = {}; tbFloor.absorb(floor, { [EK_B]: storedEntry() });
    const fresh = ['1 - 0', '2 - 0', '3 - 0', '4 - 0', '5 - 0', '6 - 0', '7 - 0'];
    const r = await runBuilder({
      floor,
      matches: [{ id: `past-${EK_B}`, finalScore: '7-6 6-3', p1: 'A. First', p2: 'B. Second' }, { id: `past-${EK_A}`, finalScore: '7-6 6-3', p1: 'A. First', p2: 'B. Second' }],
      feed: ek => feedFixture(ek, { tbRows: ek === EK_A ? fresh : TB_SCORES.slice(0, 4) }),
    });
    assert.deepStrictEqual(r.floor[EK_A][1].map(x => x[3]).sort(), [...fresh].sort(), 'fresh TB rows not absorbed');
    assert.deepStrictEqual(pageTb(r.shard(EK_B).sets)[1], STORED_TB, 'partial refetch not topped up');
  },
  // E. From-scratch rebuild where the shard comes from the TEN-323 box-score ARCHIVE,
  //    not the cache. The archive's point log was fetched after the feed dropped TB
  //    rows. One key is absent from the cache; the other is a cached negative the
  //    archive fills. Both shards must still carry every held TB row.
  async 'E: archive-sourced pbp shards get the held TB rows back'() {
    const floor = {}; tbFloor.absorb(floor, { [EK_B]: storedEntry(), [EK_X]: storedEntry() });
    const fromFeed = ek => builder.buildCacheEntry(builder.parseFixture(feedFixture(ek)));
    const r = await runBuilder({
      floor,
      cache: { [EK_X]: { sets: [], p1Key: 1, p2Key: 2, stats: null, matchStats: null } },
      archive: { [EK_B]: fromFeed(EK_B), [EK_X]: fromFeed(EK_X) },
    });
    assert.deepStrictEqual(r.calls, [], 'fixture must fetch nothing: the shards come from the archive');
    assert.deepStrictEqual(pageTb(fromFeed(EK_B).sets)[1], [], 'fixture: the archived log must carry NO TB rows');
    assert.deepStrictEqual(pageTb(r.shard(EK_B).sets)[1], STORED_TB, 'archive-only shard lost TB rows');
    assert.deepStrictEqual(pageTb(r.shard(EK_X).sets)[1], STORED_TB, 'archive-filled shard lost TB rows');
  },
};

// Controls that must NOT be mutated away: an unreadable floor is never rewritten.
async function unreadableFloorIsNotOverwritten() {
  const r = await runBuilder({ floorRaw: '{"12163900": {"1": [[1,1,1,"1 - 0"]', cache: { [EK_A]: storedEntry({ named: false }) }, form: [EK_A] });
  assert.strictEqual(r.floorBytes, '{"12163900": {"1": [[1,1,1,"1 - 0"]', 'an unreadable floor was overwritten');
  assert.deepStrictEqual(pageTb(r.shard(EK_A).sets)[1], STORED_TB, 'the in-run cache rows were not protected without a floor');
}

// ── mutants: each switches one guard off on the module object the builder calls ─
const MUTANTS = {
  'restore() is a no-op': { restore: () => ({ entries: 0, rows: 0 }) },
  'loadFloor() forgets the committed floor': { loadFloor: () => ({ floor: {}, status: 'absent' }) },
  'absorb() adds nothing': { absorb: () => 0 },
};
// Which scenarios each mutant must turn red (a mutant a scenario cannot see is not listed).
const MUST_KILL = {
  'restore() is a no-op': ['A', 'B', 'D', 'E'],
  'loadFloor() forgets the committed floor': ['B', 'C', 'E'],
  'absorb() adds nothing': ['A', 'D'],
};

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); pass++; console.log(`  ok  ${label}`); }
  catch (e) { fail++; console.log(`  FAIL  ${label}\n        ${e.message}`); }
}

(async () => {
  // Unit: the floor's rule IS the page's rule, on the fixture and on the summary row.
  await check('extractTiebreaks() agrees with the dashboard pbpSplitSet on stored and one-row-summary sets', () => {
    const stored = storedEntry().sets;
    assert.deepStrictEqual(Object.keys(tbFloor.extractTiebreaks(stored)), ['1']);
    assert.deepStrictEqual(tbFloor.extractTiebreaks(stored)[1].map(r => r[3]).sort(), pageTb(stored)[1]);
    const summaryOnly = builder.compactPbp(feedFixture(EK_A).pointbypoint).sets;
    assert.deepStrictEqual(pageTb(summaryOnly)[1], [], 'fixture: the feed stub must carry NO TB rows');
    assert.deepStrictEqual(tbFloor.extractTiebreaks(summaryOnly), {});
  });
  await check('assertSuperset() refuses a floor that lost a row', () => {
    const floor = {}; tbFloor.absorb(floor, { [EK_A]: storedEntry() });
    const smaller = tbFloor.clone(floor); smaller[EK_A][1].pop();
    assert.throws(() => tbFloor.assertSuperset(floor, smaller), /would drop 1 row/);
    tbFloor.assertSuperset(floor, floor);
  });

  // 669 stored rows in 248 sets repeat a running score: 364 under another point number,
  // 305 (36 sets) repeating point number AND score (live shards, 2026-09-28). The page
  // renders all of them, so a restore must put back every copy.
  await check('a duplicated stored TB row is restored as many times as it was stored', () => {
    const e = storedEntry();
    e.sets[0].games.push({ ...e.sets[0].games.find(g => g.score === '5 - 1') });                 // verbatim duplicate
    e.sets[0].games.push({ g: 99, server: 'p1', winner: 'p1', score: '5 - 1', points: [] });  // same score, other point number
    const floor = {}; tbFloor.absorb(floor, { [EK_A]: e });
    const want = pageTb(e.sets)[1];
    assert.strictEqual(want.length, 11);
    const bare = { [EK_A]: { ...e, sets: e.sets.map(s => ({ ...s, games: s.games.filter(g => !tbFloor.isTiebreakRow(g)) })) } };
    assert.deepStrictEqual(tbFloor.restore(bare, floor), { entries: 1, rows: 11 });
    assert.deepStrictEqual(pageTb(bare[EK_A].sets)[1], want);
    assert.deepStrictEqual(tbFloor.restore(bare, floor), { entries: 0, rows: 0 }, 'restore is not idempotent');
    assert.strictEqual(tbFloor.absorb(floor, bare), 0, 'absorb is not idempotent');
  });

  for (const [name, fn] of Object.entries(scenarios)) await check(name, fn);
  await check('an unreadable floor is never overwritten, and the in-run rows are still protected', unreadableFloorIsNotOverwritten);

  for (const [mname, patch] of Object.entries(MUTANTS)) {
    const saved = {};
    for (const k of Object.keys(patch)) { saved[k] = tbFloor[k]; tbFloor[k] = patch[k]; }
    try {
      for (const letter of MUST_KILL[mname]) {
        const [name, fn] = Object.entries(scenarios).find(([n]) => n.startsWith(`${letter}:`));
        await check(`mutant "${mname}" turns scenario ${letter} red`, async () => {
          let red = false;
          try { await fn(); } catch (_) { red = true; }
          assert.ok(red, `scenario ${letter} stayed green with "${mname}" — the check is vacuous`);
        });
      }
    } finally { Object.assign(tbFloor, saved); }
  }

  console.log(`\ntest-pbp-tiebreak-floor: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
