#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// TEN-244 — per-set GAMES survive the fixtures half, and completeness is
// derived from the SCORE rather than the flags.
//
// WHY THIS DRIVES SYNTHETIC FIXTURES RATHER THAN THE STORE. `career-history/`
// is gitignored and CI-built, so a fresh clone sees it EMPTY. A test that
// walked the shards would find nothing, report nothing, and pass — the exact
// shape of "a suite that exists and never guards" this repo already paid for
// once. So every assertion below runs the REAL exported function over a
// fixture built here.
//
// The two things being held:
//
//   1. `result` is a set COUNT ("2 - 1"). `scores[]` is the GAMES in each set.
//      Until TEN-244 the fixtures-half push kept the first and dropped the
//      second, which put per-set games at 7.9% on that half and 0.5% across the
//      last 52 weeks. Every derived line on the Database Lines tab needs games,
//      so that gap was the whole blocker.
//
//   2. Completeness cannot key on `retired`/`walkover`. In a 5,870-row ATP
//      sample, 115 rows are not a finished 2-or-3-set win and 21 of those carry
//      NEITHER flag. Counted as line misses they silently deflate every rate on
//      the page and nothing on screen reveals it.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { playerMatchHistory, formSetsFromFixture, careerRowIsComplete, writeCareerHistoryShards } =
  require(path.join(__dirname, '..', 'bsp-pipeline.js'));

let pass = 0; const fails = [];
const queue = [];
function check(name, fn) {
  queue.push(async () => {
    try { await fn(); pass++; console.log(`  ok   ${name}`); }
    catch (e) { fails.push(name); console.error(`  FAIL ${name}\n       ${e.message}`); }
  });
}

const KEY = '1234';
// A finished best-of-five won 3-1, with a tiebreak in set 2. api-tennis encodes
// tiebreak points on the games number as "<games>.<tiebreakPoints>".
function fixture(over = {}) {
  return {
    event_key: 'e1', event_date: '2026-03-04', tournament_name: 'Test Open',
    tournament_key: 't1', tournament_season: '2026', tournament_round: 'Quarter-finals',
    event_type_type: 'Atp Singles', event_status: 'Finished',
    first_player_key: KEY, second_player_key: '9999',
    event_first_player: 'T. Subject', event_second_player: 'O. Opponent',
    event_winner: 'First Player', event_final_result: '3 - 1',
    scores: [
      { score_first: '6', score_second: '4', score_set: '1' },
      { score_first: '6.7', score_second: '7.9', score_set: '2' },
      { score_first: '7', score_second: '5', score_set: '3' },
      { score_first: '6', score_second: '2', score_set: '4' },
    ],
    ...over,
  };
}
// surfaceMap is a Map in the pipeline; passing a bare object made every
// playerMatchHistory assertion fail on `surfaceMap.get is not a function`.
const rowsFor = f => playerMatchHistory([f], KEY, 2026, new Map());

// ── 1 · the games actually arrive on the row ────────────────────────────────
check('a fixtures-half row carries per-set GAMES, not just the set count', () => {
  const r = rowsFor(fixture())[0];
  assert.ok(r, 'no row produced at all');
  assert.strictEqual(r.src, 'fixtures', `expected the fixtures half, got ${r.src}`);
  assert.strictEqual(r.result, '3 - 1', 'the set count must not regress');
  assert.ok(Array.isArray(r.sets), 'row carries no `sets` array — the scoreline was dropped again');
  assert.strictEqual(r.sets.length, 4, `expected 4 sets, got ${r.sets.length}`);
  assert.deepStrictEqual(r.sets.map(s => [s.p, s.o]), [[6, 4], [6, 7], [7, 5], [6, 2]]);
});

check('the sets are PLAYER-oriented, so the same match flips for the opponent', () => {
  const asSecond = playerMatchHistory([fixture()], '9999', 2026, new Map())[0];
  assert.ok(asSecond && Array.isArray(asSecond.sets), 'opponent row carries no sets');
  assert.deepStrictEqual(asSecond.sets.map(s => [s.p, s.o]), [[4, 6], [7, 6], [5, 7], [2, 6]],
    'the opponent must see the mirror image, not the winner\'s scoreline');
  assert.strictEqual(asSecond.won, false);
});

check('tiebreak points survive as pTb/oTb — DSTB% depends on them', () => {
  const r = rowsFor(fixture())[0];
  const tb = r.sets[1];
  assert.strictEqual(tb.p, 6); assert.strictEqual(tb.o, 7);
  assert.strictEqual(tb.pTb, 7, `lost the player's tiebreak points (got ${tb.pTb})`);
  assert.strictEqual(tb.oTb, 9, `lost the opponent's tiebreak points (got ${tb.oTb})`);
  const noTb = r.sets[0];
  assert.strictEqual(noTb.pTb, undefined, 'a non-tiebreak set must not invent tiebreak points');
});

check('a 0-0 pseudo-set is not carried as a played set', () => {
  // The feed reports one 0-0 "set" for a walkover and for the unplayed
  // remainder of a retirement. Carrying it would draw a 0-0 scoreline for a
  // match nobody hit a ball in.
  const r = rowsFor(fixture({
    event_final_result: '1 - 0', event_winner: 'First Player',
    scores: [ { score_first: '6', score_second: '3', score_set: '1' },
              { score_first: '0', score_second: '0', score_set: '2' } ],
  }))[0];
  assert.deepStrictEqual(r.sets.map(s => [s.p, s.o]), [[6, 3]], 'the 0-0 set was carried');
});

check('a fixture with no scoreline gets NO sets key rather than an empty one', () => {
  const r = rowsFor(fixture({ scores: [] }))[0];
  assert.ok(r, 'row missing');
  assert.strictEqual('sets' in r, false, 'an absent scoreline must not mint an empty `sets`');
  assert.strictEqual(r.result, '3 - 1', 'the set count still comes through');
});

check('CONTROL: the parser is what supplies the sets — strip scores and they vanish', () => {
  const withScores = formSetsFromFixture(fixture(), true);
  const without = formSetsFromFixture(fixture({ scores: [] }), true);
  assert.ok(Array.isArray(withScores) && withScores.length === 4, 'parser returned nothing on a good fixture');
  assert.strictEqual(without, null, 'parser invented sets from an empty scoreline');
});

// ── 2 · completeness knows the FORMAT, and the flags only add to it ─────────
check('a finished best-of-three and best-of-five are complete on their own ladder', () => {
  for (const r of ['2 - 0', '2 - 1', '0 - 2', '1 - 2']) {
    assert.strictEqual(careerRowIsComplete(r, false), true, `${r} should be a complete Bo3`);
  }
  for (const r of ['3 - 0', '3 - 1', '3 - 2', '0 - 3', '2 - 3']) {
    assert.strictEqual(careerRowIsComplete(r, true), true, `${r} should be a complete Bo5`);
  }
});

check('THE BO5 RETIREMENT — "2 - 0" at a Slam is NOT a finished match', () => {
  // The defect a format-blind rule has. "7-6 6-4 RET" in a best-of-five reduces
  // to the set count "2 - 0", which is an ordinary completed best-of-THREE. Over
  // the 78,090-match TML archive that misread 1,391 of 2,362 retirements (58.9%)
  // as complete — and archive rows are exactly the ones with no flag to fall
  // back on.
  assert.strictEqual(careerRowIsComplete('2 - 0', true), false, 'Bo5 stopped at 2-0 must be incomplete');
  assert.strictEqual(careerRowIsComplete('2 - 1', true), false, 'Bo5 stopped at 2-1 must be incomplete');
  // ...while the very same score on the three-set ladder is finished.
  assert.strictEqual(careerRowIsComplete('2 - 0', false), true);
});

check('too many sets for the format is incomplete in both directions', () => {
  assert.strictEqual(careerRowIsComplete('3 - 1', false), false, 'Bo3 cannot reach 3 sets won');
  assert.strictEqual(careerRowIsComplete('4 - 1', true), false, 'nothing reaches 4 sets won');
  assert.strictEqual(careerRowIsComplete('2 - 2', false), false);
  assert.strictEqual(careerRowIsComplete('3 - 3', true), false);
});

check('the real UNFLAGGED abandonments are caught — the reason this is score-based', () => {
  // Real rows from the TEN-244 sample carrying NO retired and NO walkover flag.
  assert.strictEqual(careerRowIsComplete('1 - 1', true), false, 'AO 2019 R128 "1 - 1" (won=true, no flags)');
  assert.strictEqual(careerRowIsComplete('0 - 1', false), false, 'Wimbledon 2016 R16 "0 - 1" (won=false, no flags)');
  for (const r of ['1 - 0', '0 - 0']) {
    assert.strictEqual(careerRowIsComplete(r, false), false, `${r} should be incomplete`);
  }
});

check('an unreadable or annotated score is incomplete, never assumed finished', () => {
  for (const r of [null, undefined, '', 'W/O', 'ret.', '2', 'a - b', '2 - ',
                   '2 - 1 ret.', '2 - 1 RET', '2.0 - 1.0', '1 - 1 - 1']) {
    assert.strictEqual(careerRowIsComplete(r, false), false, `${JSON.stringify(r)} must not read as complete`);
  }
});

check('CONTROL: a flag-based rule MISSES what the score-based one catches', () => {
  const flagRule = row => !row.retired && !row.walkover;   // the naive version
  const unflagged = { result: '1 - 1', won: true };        // AO 2019 R128
  assert.strictEqual(flagRule(unflagged), true, 'fixture wrong: the flag rule should pass this');
  assert.strictEqual(careerRowIsComplete(unflagged.result, true), false,
    'the score rule must reject what the flag rule passes');
});

check('CONTROL: the score-based rule MISSES what the flags catch — hence both', () => {
  // The converse, and why the shard writer ORs them. A best-of-three retirement
  // that still reached a legal 2-0 is arithmetically indistinguishable from a
  // finished match; only the flag knows.
  assert.strictEqual(careerRowIsComplete('2 - 0', false), true,
    'a Bo3 2-0 is arithmetically complete — the flag is what must exclude it');
});

// ── 3 · the shard writer stamps BOTH halves and counts what it stamped ──────
check('writeCareerHistoryShards flags both halves and its count matches the rows', async () => {
  const cwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten244-'));
  try {
    process.chdir(tmp);
    const profiles = {
      p1: { careerMatches: [
        // fixtures half
        { year: '2026', date: '2026-03-04', tournament: 'Test Open', round: 'R32',
          result: '2 - 0', won: true, src: 'fixtures', sets: [{ p: 6, o: 4 }, { p: 6, o: 3 }] },
        { year: '2026', date: '2026-03-05', tournament: 'Test Open', round: 'R16',
          result: '1 - 1', won: true, src: 'fixtures' },                       // unflagged abandonment
        { year: '2026', date: '2026-01-20', tournament: 'Australian Open', round: 'R128',
          result: '2 - 0', won: true, src: 'fixtures' },                       // Bo5 stopped early
        { year: '2026', date: '2026-01-22', tournament: 'Australian Open', round: 'R64',
          result: '3 - 1', won: true, src: 'fixtures' },                       // genuine Bo5 win
      ] },
    };
    // The archive half is injected by the writer itself; with no TML available it
    // simply contributes nothing, which is the documented tolerant path.
    const index = await writeCareerHistoryShards(profiles, { log: () => {} });
    assert.ok(index && index.p1 === 4, `expected 4 rows indexed, got ${index && index.p1}`);
    const shard = JSON.parse(fs.readFileSync(path.join('career-history', 'p1.json'), 'utf8'));
    const flagged = shard.matches.filter(m => m.incomplete);
    assert.strictEqual(shard.incomplete, flagged.length,
      `shard count ${shard.incomplete} disagrees with ${flagged.length} flagged rows`);
    assert.strictEqual(shard.incomplete, 2,
      `expected the "1 - 1" and the Slam "2 - 0" to be excluded, got ${shard.incomplete}`);
    const byRound = Object.fromEntries(shard.matches.map(m => [m.round, !!m.incomplete]));
    assert.strictEqual(byRound.R32, false, 'a finished Bo3 must not be excluded');
    assert.strictEqual(byRound.R16, true, 'the unflagged "1 - 1" must be excluded');
    assert.strictEqual(byRound.R128, true, 'the Slam "2 - 0" must be excluded as an unfinished Bo5');
    assert.strictEqual(byRound.R64, false, 'a genuine 3-1 Slam win must not be excluded');
    // and the games survive the round-trip into the written file
    const kept = shard.matches.find(m => m.round === 'R32');
    assert.deepStrictEqual(kept.sets, [{ p: 6, o: 4 }, { p: 6, o: 3 }], 'sets did not survive the shard write');
  } finally { process.chdir(cwd); fs.rmSync(tmp, { recursive: true, force: true }); }
});

(async () => {
  for (const run of queue) await run();
  console.log(`\nper-set games + completeness: ${pass} pass, ${fails.length} fail`);
  if (fails.length) { console.error('FAILED: ' + fails.join(' · ')); process.exit(1); }
})();
