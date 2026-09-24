#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// TEN-273 Part B — H2H meeting rows get their box score fetched.
//
// FOUNDER, 2026-09-25: "Most matches in the Ruud v F. Cerundolo H2H list open to
// 'Stats not available for this match'." Measured cause: the popup looks a row up
// by api-tennis eventKey in matchstats-index / setstats-index / pbp-index, and
// build-point-by-point.js only ever fetched board fixtures and Form rows — never
// H2H meeting keys. Miami 2025 R16 (12022323) has 116 stat rows in the feed and
// no shard. Not a key mismatch: 0 of 28 failing rows were held under another key.
//
// Driven through the REAL main() with a stubbed fetch (the same harness as
// test-ten263-pipeline.js). Cases:
//   1. an H2H meeting key on the board is fetched and lands in matchstats-index,
//      setstats-index and pbp-index when the feed has each half;
//   2. a meeting the feed has nothing for writes no shard (never a fabricated
//      one) and is cached negative, so the next run does not refetch it;
//   3. Form rows keep priority: with a budget of 1, the Form row is fetched and
//      the H2H row waits.
// Plus the card label: "ATP ATP Laver Cup" (tourLabelOf in bsp-pipeline.js).
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0; const fails = [];
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fails.push(name); console.log(`  FAIL ${name}\n       ${e.message}`); }
}

// Feed-shaped rows (same shape as test-ten263-pipeline.js, copied from get_fixtures).
const NAME_KEY = 'stat' + '_name';
const row = (pk, period, type, name, value, won = null, total = null) =>
  ({ player_key: pk, stat_period: period, stat_type: type, [NAME_KEY]: name, stat_value: value, stat_won: won, stat_total: total });
const sheet = (period, a, b) => [
  row(a, period, 'Service', 'Aces', '4'), row(b, period, 'Service', 'Aces', '9'),
  row(a, period, 'Points', 'Total Points Won', '44%', 61, 138), row(b, period, 'Points', 'Total Points Won', '56%', 77, 138),
];
const RUUD = 430, CER = 1104;
const FEED = {
  // Miami 2025 R16: match + per-set rows and a point log.
  12022323: { event_key: 12022323, first_player_key: RUUD, second_player_key: CER,
    event_first_player: 'C. Ruud', event_second_player: 'F. Cerundolo',
    statistics: [...sheet('match', RUUD, CER), ...sheet('set1', RUUD, CER)],
    pointbypoint: [{ set_number: 'Set 1', number_game: '1', player_served: 'First Player', serve_winner: 'First Player', score: '1 - 0', points: [] }] },
  // Bastad 2022: the feed returns the fixture with no stats and no log.
  11716393: { event_key: 11716393, first_player_key: RUUD, second_player_key: CER,
    event_first_player: 'C. Ruud', event_second_player: 'F. Cerundolo', statistics: [], pointbypoint: [] },
  // A Form row.
  777: { event_key: 777, first_player_key: RUUD, second_player_key: 9, event_first_player: 'C. Ruud', event_second_player: 'X. Y',
    statistics: sheet('match', RUUD, 9), pointbypoint: [] },
};

function runBuilder(dir, env = {}) {
  const log = path.join(dir, 'fetched.txt');
  const stub = path.join(dir, 'stub.js');
  fs.writeFileSync(stub, `const fs=require('fs');const FEED=${JSON.stringify(FEED)};` +
    `globalThis.fetch=async(u)=>{const m=/match_key=(\\d+)/.exec(String(u));if(m)fs.appendFileSync(${JSON.stringify(log)},m[1]+'\\n');` +
    `const r=m&&FEED[m[1]];return{ok:true,json:async()=>({success:1,result:r?[r]:[]})};};`);
  const r = spawnSync(process.execPath, ['-r', stub, path.join(ROOT, 'build-point-by-point.js')], {
    cwd: dir, encoding: 'utf8',
    env: Object.assign({}, process.env, { API_TENNIS_KEY: 'test', SETSTATS_MAX_BACKFILL: '0', DOTENV_CONFIG_QUIET: 'true' }, env),
  });
  const fetched = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  fs.rmSync(log, { force: true });
  const read = (f) => (fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) : null);
  return { r, fetched, matchIdx: read('matchstats-index.json'), setIdx: read('setstats-index.json'), pbpIdx: read('pbp-index.json') };
}

// The board card is UPCOMING (no finalScore): only its H2H list can reach these keys.
function board(dir, { form = false } = {}) {
  fs.writeFileSync(path.join(dir, 'matches.json'), JSON.stringify([{ id: 'upcoming-12165828', p1: 'C. Ruud', p2: 'F. Cerundolo',
    h2h: { matches: [{ date: '2025-03-25', eventKey: 12022323, level: 'ATP' }, { date: '2022-07-13', eventKey: 11716393, level: 'ATP' }] } }]));
  if (form) {
    fs.mkdirSync(path.join(dir, 'form'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'form', '430.json'), JSON.stringify({ key: RUUD, matches: [{ eventKey: 777, date: '2026-09-01' }] }));
  }
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ten273-h2h-'));

console.log('\nTEN-273 · H2H meeting rows are fetched\n');

check('an H2H meeting with feed stats lands in matchstats-, setstats- and pbp-index', () => {
  const dir = tmp(); board(dir);
  const { r, fetched, matchIdx, setIdx, pbpIdx } = runBuilder(dir);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(fetched.includes('12022323'), `fetched ${JSON.stringify(fetched)}\n${r.stdout}${r.stderr}`);
  assert.deepStrictEqual(matchIdx, ['12022323']);
  assert.deepStrictEqual(setIdx, ['12022323']);
  assert.deepStrictEqual(pbpIdx, ['12022323']);
  const shard = JSON.parse(fs.readFileSync(path.join(dir, 'setstats', '12022323.json'), 'utf8'));
  assert.strictEqual(shard.p1Key, RUUD); assert.strictEqual(shard.p2Key, CER);
  assert.strictEqual(shard.match.p1['Service:Aces'], 4);
});

check('a meeting the feed has nothing for writes no shard, and is not refetched next run', () => {
  const dir = tmp(); board(dir);
  runBuilder(dir);
  assert.ok(!fs.existsSync(path.join(dir, 'setstats', '11716393.json')), 'a shard was written for a meeting with no feed stats');
  const second = runBuilder(dir);
  assert.deepStrictEqual(second.fetched, [], `second run refetched ${JSON.stringify(second.fetched)}`);
  assert.deepStrictEqual(second.matchIdx, ['12022323'], 'the resolved meeting dropped out on a cached run');
});

check('Form rows keep priority over H2H rows on a spent budget', () => {
  const dir = tmp(); board(dir, { form: true });
  const { fetched } = runBuilder(dir, { PBP_MAX_FETCHES: '1' });
  assert.deepStrictEqual(fetched, ['777']);
});

console.log('\nTEN-273 · the card label never doubles the tour prefix\n');

check('tourLabelOf: team events already named "ATP …" are not prefixed again; others are', () => {
  process.env.DOTENV_CONFIG_QUIET = 'true';
  const { tourLabelOf } = require(path.join(ROOT, 'bsp-pipeline.js'));
  // Feed names measured on the live board 2026-09-25 (tournament_round empty).
  assert.strictEqual(tourLabelOf({ tournament_name: 'ATP Laver Cup', tournament_round: '' }), 'ATP Laver Cup');
  assert.strictEqual(tourLabelOf({ tournament_name: 'ATP Davis Cup - World Group II', tournament_round: null }), 'ATP Davis Cup - World Group II');
  assert.strictEqual(tourLabelOf({ tournament_name: 'Hangzhou', tournament_round: '' }), 'ATP Hangzhou');
  assert.strictEqual(tourLabelOf({ tournament_name: 'Chengdu', tournament_round: 'ATP Chengdu - 1/8-finals' }), 'ATP Chengdu');
});

console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
