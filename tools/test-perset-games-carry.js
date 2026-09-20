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
const { playerMatchHistory, formSetsFromFixture, careerRowIsComplete, writeCareerHistoryShards,
  NEXTGEN_TOURNAMENT_KEY, CAREER_HISTORY_INDEX_PATH } =
  require(path.join(__dirname, '..', 'bsp-pipeline.js'));
const cb = require(path.join(__dirname, '..', 'career-backfill.js'));
const { altFormatForTourneyId, buildArchiveHistories } = cb;
const { buildTmlIndex } = cb._internal;

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

  // ── 4 · TEN-244 round 2: format READ not inferred, plus DEF and W/O flags ──
// One control per direction for each, to the same standard as the pair above:
// each fails if the change silently reverts.

check('the STORED format wins over the tournament name (Davis Cup direction)', async () => {
  // The 2000 Davis Cup rubber shape: best_of=5 on an event the Slam-name
  // inference calls Bo3. Before TEN-244 round 2 this was 4,454 missed Bo5 rows
  // (5.70% of the archive) and 4,231 COMPLETED matches wrongly excluded.
  const cwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten244b-'));
  try {
    process.chdir(tmp);
    await writeCareerHistoryShards({ p: { careerMatches: [
      // A completed straight-sets Bo5 Davis Cup rubber. Name inference says
      // Bo3, on which "0 - 3" is three sets won and therefore INCOMPLETE.
      { year: '2000', date: '2000-02-04', tournament: 'Davis Cup G1 QF: CHN vs UZB', round: 'RR',
        result: '0 - 3', won: true, src: 'archive', bestOf: 5 },
      // The pre-2008 Masters-1000 final shape, same trap, different event.
      { year: '2000', date: '2000-03-19', tournament: 'Indian Wells Masters', round: 'F',
        result: '0 - 3', won: true, src: 'archive', bestOf: 5 },
    ] } }, { log: () => {} });
    const sh = JSON.parse(fs.readFileSync(path.join('career-history', 'p.json'), 'utf8'));
    assert.strictEqual(sh.incomplete, 0,
      `a completed Bo5 must NOT be excluded once best_of is read (got ${sh.incomplete} excluded)`);
    sh.matches.forEach(m => assert.strictEqual(!!m.incomplete, false, `${m.tournament} wrongly excluded`));
  } finally { process.chdir(cwd); fs.rmSync(tmp, { recursive: true, force: true }); }
});

check('CONTROL: strip bestOf and the SAME rows revert to being wrongly excluded', async () => {
  // Proves the assertion above is carried by `bestOf` and not by something
  // else — remove the field and the old defect comes straight back.
  const cwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten244c-'));
  try {
    process.chdir(tmp);
    await writeCareerHistoryShards({ p: { careerMatches: [
      { year: '2000', date: '2000-02-04', tournament: 'Davis Cup G1 QF: CHN vs UZB', round: 'RR',
        result: '0 - 3', won: true, src: 'archive' },   // no bestOf
    ] } }, { log: () => {} });
    const sh = JSON.parse(fs.readFileSync(path.join('career-history', 'p.json'), 'utf8'));
    assert.strictEqual(sh.incomplete, 1,
      'without bestOf the Davis Cup row should fall back to name inference and be excluded — ' +
      'if it is not, this control proves nothing');
  } finally { process.chdir(cwd); fs.rmSync(tmp, { recursive: true, force: true }); }
});

check('the stored format also holds the OTHER way — bestOf 3 beats a Slam name', async () => {
  // Slam QUALIFYING is best-of-three. The name says "Australian Open"; the
  // stored format must win, or a completed 2-0 qualifier reads as a truncated Bo5.
  const cwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten244d-'));
  try {
    process.chdir(tmp);
    await writeCareerHistoryShards({ p: { careerMatches: [
      { year: '2019', date: '2019-01-08', tournament: 'Australian Open', round: 'Q2',
        result: '0 - 2', won: true, src: 'archive', bestOf: 3 },
    ] } }, { log: () => {} });
    const sh = JSON.parse(fs.readFileSync(path.join('career-history', 'p.json'), 'utf8'));
    assert.strictEqual(sh.incomplete, 0, 'a completed Bo3 at a Slam must not be excluded');
  } finally { process.chdir(cwd); fs.rmSync(tmp, { recursive: true, force: true }); }
});

check('DEF is excluded even when its partial scoreline reaches a legal set count', async () => {
  // 6 of 16 archive defaults did exactly this — e.g. "3-6 7-5 6-0 5-2 DEF"
  // reduces to a set count that a format check accepts.
  const cwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten244e-'));
  try {
    process.chdir(tmp);
    await writeCareerHistoryShards({ p: { careerMatches: [
      { year: '2004', date: '2004-03-26', tournament: 'Miami Masters', round: 'R64',
        result: '0 - 2', won: true, src: 'archive', bestOf: 3, defaulted: true },
    ] } }, { log: () => {} });
    const sh = JSON.parse(fs.readFileSync(path.join('career-history', 'p.json'), 'utf8'));
    assert.strictEqual(sh.incomplete, 1, 'a DEF with a legal set count must still be excluded');
  } finally { process.chdir(cwd); fs.rmSync(tmp, { recursive: true, force: true }); }
});

check('CONTROL: the same DEF row without the flag passes — so the flag is what excludes it', async () => {
  const cwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten244f-'));
  try {
    process.chdir(tmp);
    await writeCareerHistoryShards({ p: { careerMatches: [
      { year: '2004', date: '2004-03-26', tournament: 'Miami Masters', round: 'R64',
        result: '0 - 2', won: true, src: 'archive', bestOf: 3 },
    ] } }, { log: () => {} });
    const sh = JSON.parse(fs.readFileSync(path.join('career-history', 'p.json'), 'utf8'));
    assert.strictEqual(sh.incomplete, 0,
      'the identical row minus `defaulted` must pass — otherwise the test above is not measuring the flag');
  } finally { process.chdir(cwd); fs.rmSync(tmp, { recursive: true, force: true }); }
});

check('W/O is excluded BY ITS FLAG, not by the 0-0 arithmetic accident', async () => {
  // The whole point of giving walkovers a real flag: a walkover carrying a
  // score that is NOT 0-0 must still be excluded. Under the old behaviour this
  // row passed, because only "0 - 0" failed the format check.
  const cwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten244g-'));
  try {
    process.chdir(tmp);
    await writeCareerHistoryShards({ p: { careerMatches: [
      { year: '2015', date: '2015-06-01', tournament: 'Test Open', round: 'R32',
        result: '0 - 2', won: true, src: 'archive', bestOf: 3, walkover: true },
    ] } }, { log: () => {} });
    const sh = JSON.parse(fs.readFileSync(path.join('career-history', 'p.json'), 'utf8'));
    assert.strictEqual(sh.incomplete, 1,
      'a walkover with a non-0-0 set count must still be excluded — the flag, not the arithmetic');
  } finally { process.chdir(cwd); fs.rmSync(tmp, { recursive: true, force: true }); }
});

check('CONTROL: drop the walkover flag and that row passes again', async () => {
  const cwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten244h-'));
  try {
    process.chdir(tmp);
    await writeCareerHistoryShards({ p: { careerMatches: [
      { year: '2015', date: '2015-06-01', tournament: 'Test Open', round: 'R32',
        result: '0 - 2', won: true, src: 'archive', bestOf: 3 },
    ] } }, { log: () => {} });
    const sh = JSON.parse(fs.readFileSync(path.join('career-history', 'p.json'), 'utf8'));
    assert.strictEqual(sh.incomplete, 0, 'without the flag the row must pass, or the control is vacuous');
  } finally { process.chdir(cwd); fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ── 5 · TEN-244 round 3: NextGen Finals leave the format-typed population ───
// Founder ruling 2026-09-20. Best-of-five SHORT sets (first to four games,
// tiebreak at 3-3), so the set COUNT reads as a normal Bo5 while every
// games-based figure sits on another scale. Excluded, counted, visible — and
// matched on TOURNAMENT IDENTITY, never on the scoreline, because a heuristic
// that infers short sets from a score also catches legitimate blowouts.

check('FIXTURES half: the NextGen row is tagged from tournament_key, not the name', () => {
  // The same fixture twice, differing ONLY in tournament_key. If the tag
  // followed the NAME this pair would be indistinguishable.
  const ng = rowsFor(fixture({ tournament_key: NEXTGEN_TOURNAMENT_KEY, tournament_name: 'ATP Next Gen Finals - Jeddah' }))[0];
  const no = rowsFor(fixture({ tournament_key: '3683', tournament_name: 'ATP Next Gen Finals - Jeddah' }))[0];
  assert.strictEqual(ng.altFormat, 'nextgen', 'the NextGen tournament_key must tag the row');
  assert.strictEqual('altFormat' in no, false,
    'a row carrying the same NAME under a different key must NOT be tagged — the key is the handle');
});

check('NEGATIVE CONTROL: "Next Generation Hardcourts" is Bo3 Adelaide and stays typed', () => {
  // A real trap: the 2005-2008 Adelaide ATP 250 carried the sponsor name
  // "Next Generation Hardcourts" and is present in odds-archive/. A substring
  // match on "next gen" swallows it and silently removes a best-of-THREE event
  // from the typed population.
  const r = rowsFor(fixture({ tournament_key: '3125', tournament_name: 'Next Generation Hardcourts' }))[0];
  assert.strictEqual('altFormat' in r, false, 'Adelaide 2005 must not be excluded as an alternate format');
  // ...and the Milan ATP 250 / Milan Challenger, which share the host city but
  // not the key.
  for (const k of ['3683', '2505']) {
    assert.strictEqual('altFormat' in rowsFor(fixture({ tournament_key: k, tournament_name: 'Milan' }))[0], false,
      `Milan under key ${k} must not be excluded`);
  }
});

check('ARCHIVE half: the tourney_id suffix is the handle, both directions', () => {
  // TML publishes "<season>-<event id>"; the event id is stable at 7696 across
  // all eight editions while the NAME appears as 'Next Gen Finals',
  // 'Next Gen ATP Finals' AND 'NextGen Finals'.
  for (const id of ['2017-7696', '2021-7696', '2025-7696', '7696']) {
    assert.strictEqual(altFormatForTourneyId(id), 'nextgen', `${id} should be the NextGen event`);
  }
  for (const id of ['2000-7308', '2005-337', '', null, undefined, 'abc', '2017-76960', '2017-7696x']) {
    assert.strictEqual(altFormatForTourneyId(id), null,
      `${JSON.stringify(id)} must NOT be excluded — an unreadable id types as normal, it does not drop a match`);
  }
});

check('the shard writer excludes a NextGen row for FORMAT, not as a truncation', async () => {
  const cwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten244i-'));
  try {
    process.chdir(tmp);
    await writeCareerHistoryShards({ p: { careerMatches: [
      // A COMPLETED NextGen final: 3-1 in short sets. On the Bo5 ladder this is
      // a finished match, so nothing about completeness would exclude it — only
      // the format tag does.
      { year: '2024', date: '2024-12-22', tournament: 'ATP Next Gen Finals - Jeddah', round: 'F',
        result: '3 - 1', won: true, src: 'fixtures', altFormat: 'nextgen',
        sets: [{ p: 4, o: 2 }, { p: 2, o: 4 }, { p: 4, o: 1 }, { p: 4, o: 3 }] },
      // An ordinary completed Bo3 alongside it, so the shard counts can be read.
      { year: '2024', date: '2024-10-01', tournament: 'Test Open', round: 'R32',
        result: '2 - 0', won: true, src: 'fixtures' },
    ] } }, { log: () => {} });
    const sh = JSON.parse(fs.readFileSync(path.join('career-history', 'p.json'), 'utf8'));
    assert.strictEqual(sh.altFormat, 1, `expected 1 format exclusion, got ${sh.altFormat}`);
    assert.strictEqual(sh.incomplete, 0,
      'a NextGen match is FINISHED — calling it incomplete would be the plausible default this store forbids');
    const ng = sh.matches.find(m => m.round === 'F');
    assert.strictEqual(ng.altFormat, 'nextgen', 'the reason must survive onto the published row');
    assert.strictEqual(!!ng.incomplete, false, 'a format exclusion must not masquerade as a truncation');
    // and the reason is readable from the INDEX, not only from the code
    const idx = JSON.parse(fs.readFileSync(CAREER_HISTORY_INDEX_PATH, 'utf8'));
    assert.strictEqual(idx.meta.exclusions.altFormat, 1, 'meta.exclusions.altFormat missing or wrong');
    assert.strictEqual(idx.meta.exclusions.byReason.altFormat.nextgen, 1, 'the reason must be named in meta');
    assert.strictEqual(idx.meta.population.rows, 2, 'every count must carry its population');
    assert.deepStrictEqual(idx.meta.exclusions.altFormatByHalf, { fixtures: 1, archive: 0 },
      'the exclusion must be readable PER HALF — the fixtures half converges on the profile-cache TTL');
    // THE BLOCK MUST CLOSE. Here the excluded row DOES carry games, so the
    // all-rows numerator and the games-comparable one differ, and subtracting
    // the exclusion count from the numerator must NOT be the reader's job.
    const g = idx.meta.perSetGames;
    assert.strictEqual(g.rows, 1, 'only the NextGen row carries sets in this fixture');
    assert.strictEqual(g.excluded, 1, 'the store must say how much of the numerator sits on excluded rows');
    assert.strictEqual(g.typed, 0, 'games-comparable numerator');
    assert.strictEqual(g.typedOf, 1, 'games-comparable denominator = population.rows - exclusions.altFormat');
    assert.strictEqual(g.rows - g.excluded, g.typed, 'perSetGames does not reconcile with its own exclusions');
    assert.strictEqual(idx.meta.population.rows - idx.meta.exclusions.altFormat, g.typedOf,
      'the typed denominator must be derivable from the published population');
  } finally { process.chdir(cwd); fs.rmSync(tmp, { recursive: true, force: true }); }
});

check('CONTROL: the identical row WITHOUT the tag is typed and counted normally', async () => {
  // Proves the exclusion above is carried by `altFormat` and nothing else. The
  // same "3 - 1" under name inference is a Bo3 that won three sets — which the
  // completeness rule rejects — so it lands as `incomplete`, NOT as altFormat.
  // Two different outcomes from one field: that is what makes this a control.
  const cwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten244j-'));
  try {
    process.chdir(tmp);
    await writeCareerHistoryShards({ p: { careerMatches: [
      { year: '2024', date: '2024-12-22', tournament: 'ATP Next Gen Finals - Jeddah', round: 'F',
        result: '3 - 1', won: true, src: 'fixtures' },
    ] } }, { log: () => {} });
    const sh = JSON.parse(fs.readFileSync(path.join('career-history', 'p.json'), 'utf8'));
    assert.strictEqual('altFormat' in sh, false, 'without the tag there is no format exclusion to count');
    assert.strictEqual(sh.incomplete, 1,
      'untagged, the row falls back to the typed population — if it did not, the test above proves nothing');
  } finally { process.chdir(cwd); fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ── 6 · the ARCHIVE half's WIRING, not just its parser ─────────────────────
// A clean-context review proved the hole this closes: with only the pure
// `altFormatForTourneyId` test above, deleting `altFormat` from either
// career-backfill.js's pushMatch calls OR its row emitter dropped all 85
// archive-half tags on the live store and the suite still reported 27/27.
// A parser test standing in for a wiring test is a test that cannot fail for
// the reason it exists.
//
// Driven over a STUB csv + a STUB index rather than tml-cache/, which is
// gitignored and whose loader DOWNLOADS a missing year — `npm test` is the
// fail-closed deploy gate and must not reach the network.
const TML_HEADER = 'tourney_id,tourney_name,surface,draw_size,tourney_level,indoor,tourney_date,'
  + 'match_num,winner_id,winner_seed,winner_entry,winner_name,winner_hand,winner_ht,winner_ioc,'
  + 'winner_age,winner_rank,winner_rank_points,loser_id,loser_seed,loser_entry,loser_name,'
  + 'loser_hand,loser_ht,loser_ioc,loser_age,loser_rank,loser_rank_points,score,best_of,round,minutes';
const tmlRow = (id, name, bo, score) =>
  `${id},${name},Hard,8,A,I,20181106,1,W001,,,Arch Winner,R,188,ITA,21.0,20,1500,`
  + `L001,,,Arch Loser,R,185,USA,21.5,30,1200,${score},${bo},RR,90`;

check('ARCHIVE WIRING: the tag survives buildTmlIndex into the match object', async () => {
  const idx = await buildTmlIndex(() => {}, { csvByYear: { 2018: [TML_HEADER,
    tmlRow('2018-7696', 'Next Gen ATP Finals', 5, '4-3(4) 4-2 4-1'),
    tmlRow('2018-7308', 'Adelaide', 3, '6-4 6-4'),
  ].join('\n') } });
  const ms = idx.byId.get('W001') || [];
  assert.strictEqual(ms.length, 2, `expected 2 matches for the winner, got ${ms.length}`);
  const ng = ms.find(m => /Next Gen/.test(m.tournamentName));
  const ad = ms.find(m => m.tournamentName === 'Adelaide');
  assert.strictEqual(ng.altFormat, 'nextgen', 'buildTmlIndex dropped the tag on the way to the match object');
  assert.strictEqual(ad.altFormat, null, 'Adelaide must not be tagged — it is a Bo3 ATP 250');
  // ...and TML's own best_of is still carried, because we decline to USE it on
  // these rows, we do not delete what the source said.
  assert.strictEqual(ng.bestOf, 5);
});

check('ARCHIVE WIRING: the tag survives buildArchiveHistories onto the PUBLISHED row', async () => {
  const idx = await buildTmlIndex(() => {}, { csvByYear: { 2018: [TML_HEADER,
    tmlRow('2018-7696', 'Next Gen ATP Finals', 5, '4-3(4) 4-2 4-1'),
    tmlRow('2018-7308', 'Adelaide', 3, '6-4 6-4'),
  ].join('\n') } });
  const out = await buildArchiveHistories({ apiKey: { name: 'Arch Winner' } }, 2000, 2020,
    { log: () => {}, index: idx });
  const rows = out.apiKey || [];
  assert.strictEqual(rows.length, 2, `expected 2 emitted rows, got ${rows.length} — did reconcile fail?`);
  const ng = rows.find(r => /Next Gen/.test(r.tournament));
  const ad = rows.find(r => r.tournament === 'Adelaide');
  assert.strictEqual(ng.altFormat, 'nextgen', 'the emitter dropped the tag — the archive half would readmit all of them');
  assert.strictEqual('altFormat' in ad, false, 'a normal ATP 250 row must carry no exclusion reason');
});

check('CONTROL: an un-NextGen tourney_id through the SAME chain emits no tag', async () => {
  // Proves the two assertions above are carried by the id and not by the name,
  // the level, the draw size or the best_of — every one of which is identical
  // here to a real NextGen row.
  const idx = await buildTmlIndex(() => {}, { csvByYear: { 2018: [TML_HEADER,
    tmlRow('2018-9999', 'Next Gen ATP Finals', 5, '4-3(4) 4-2 4-1'),
  ].join('\n') } });
  const out = await buildArchiveHistories({ apiKey: { name: 'Arch Winner' } }, 2000, 2020,
    { log: () => {}, index: idx });
  assert.strictEqual(out.apiKey.length, 1);
  assert.strictEqual('altFormat' in out.apiKey[0], false,
    'a NextGen-NAMED row under a different tourney_id must not be excluded — or the id is not what is matching');
});

check('a NextGen row is NOT counted as "untyped" — excluded and untyped are different states', async () => {
  const cwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten244k-'));
  try {
    process.chdir(tmp);
    await writeCareerHistoryShards({ p: { careerMatches: [
      { year: '2024', date: '2024-12-22', tournament: 'ATP Next Gen Finals - Jeddah', round: 'F',
        result: '3 - 1', won: true, src: 'fixtures', altFormat: 'nextgen' },
    ] } }, { log: () => {} });
    const idx = JSON.parse(fs.readFileSync(CAREER_HISTORY_INDEX_PATH, 'utf8'));
    assert.strictEqual(idx.meta.untypedByName, 0,
      'a format EXCLUSION must not inflate the count of rows the format could not be READ for');
    assert.strictEqual(idx.meta.exclusions.altFormat, 1);
  } finally { process.chdir(cwd); fs.rmSync(tmp, { recursive: true, force: true }); }
});

(async () => {
  for (const run of queue) await run();
  console.log(`\nper-set games + completeness: ${pass} pass, ${fails.length} fail`);
  if (fails.length) { console.error('FAILED: ' + fails.join(' · ')); process.exit(1); }
})();