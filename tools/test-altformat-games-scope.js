#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// TEN-244 — an alternate-format match keeps its MATCH identity and loses only
// its GAMES. Founder ruling 2026-09-21, deliberately narrower than the first
// build: "NextGen matches count as matches. A 3-2 win is a win... What doesn't
// carry is the games scale."
//
//   EXCLUDED : per-set games, games handicap, total games, gameW/gameL/gamePct,
//              the first-set games total, any line built on game counts, and
//              — founder 2026-09-21, reversing the retention flagged on the
//              first pass — tbW/tbL/tbPct, because a NextGen tiebreak triggers
//              at 3-3 rather than 6-6 and is therefore a differently-REACHED
//              event, not merely a shorter one.
//   RETAINED : match counts, win/loss, surface record, H2H, set counts as sets.
//
// Two surfaces reach games by two different routes and therefore need two
// matchers, which is the thing most likely to drift apart later:
//
//   build-series.js          -> api-tennis fixtures, keyed on `tournament_key`
//                               2793 (the SAME key bsp-pipeline.js uses).
//   tools/build-career-splits.js -> Tennis Abstract matchmx, which carries NO
//                               tournament id at all, so the handle there can
//                               only be the NAME. Both variants present today
//                               are asserted, and so is the Adelaide guard.
//
// Every assertion drives the REAL exported function. The previous round of this
// ticket shipped a parser test standing in for a wiring test and a clean-context
// review proved two one-line deletions passed it green, so the field-name and
// end-to-end cases below exist specifically because of that.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const path = require('path');

const CS = require(path.join(__dirname, 'build-career-splits.js'));
const BS = require(path.join(__dirname, '..', 'build-series.js'));

let pass = 0; const fails = [];
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fails.push(name); console.error(`  FAIL ${name}\n       ${e.message}`); }
}

// ── 1 · career-splits: the NAME matcher, both directions ────────────────────
check('career-splits tags every NextGen name variant present in matchmx', () => {
  // Measured 2026-09-21 over 233 player files / 731 distinct tournament names:
  // `NextGen Finals` 151 rows, `Next Gen Finals` 57. The third is TML's spelling,
  // carried in case TA adopts it.
  for (const t of ['NextGen Finals', 'Next Gen Finals', 'Next Gen ATP Finals',
                   '  nextgen finals  ', 'NEXT GEN FINALS']) {
    assert.strictEqual(CS.altFormatOf({ tournament: t }), 'nextgen', `${JSON.stringify(t)} should be tagged`);
  }
});

check('NEGATIVE CONTROL: "Next Generation Hardcourts" is Bo3 Adelaide and is NOT tagged', () => {
  // The 2005-2008 Adelaide ATP 250 carried that sponsor name and was played
  // best-of-three. A substring match on "next gen" swallows it, which would
  // silently delete a real event's games from the population.
  for (const t of ['Next Generation Hardcourts', 'Next Generation Adelaide International',
                   'Milan', 'Jeddah', 'Tour Finals', 'ATP Finals', 'Next Gen Finals Qualifying']) {
    assert.strictEqual(CS.altFormatOf({ tournament: t }), null, `${JSON.stringify(t)} must NOT be tagged`);
  }
  assert.strictEqual(CS.altFormatOf(null), null);
  assert.strictEqual(CS.altFormatOf({}), null);
});

check('career-splits reads BOTH field names — the internal one and the shard one', () => {
  // splits() is fed parseMatches() output, whose key is `tournament`. The
  // published drawer shard (shardMatch) renames it to `t`. A matcher that knew
  // only `t` would compile, pass a shard-shaped test, and never fire in the
  // build — which is exactly what an earlier draft of this change did.
  assert.strictEqual(CS.altFormatOf({ tournament: 'NextGen Finals' }), 'nextgen', 'internal shape (tournament)');
  assert.strictEqual(CS.altFormatOf({ t: 'NextGen Finals' }), 'nextgen', 'shard shape (t)');
});

// ── 2 · career-splits: the MATCH columns must not move ──────────────────────
const M = (over = {}) => ({
  date: '20241220', tournament: 'Test Open', surface: 'Hard', level: 'A',
  wl: 'W', round: 'F', score: '6-4 6-3', srv: null, opp: null, ...over,
});
const NG = (over = {}) => M({ tournament: 'NextGen Finals', score: '4-3(4) 4-2 4-1', ...over });

check('a NextGen match still counts in M / W / L and in the SET columns', () => {
  const rows = CS.splits([M(), NG()]);
  const hard = rows.Hard;
  assert.ok(hard, 'no Hard row built');
  assert.strictEqual(hard.M, 2, 'the NextGen match must still be a match');
  assert.strictEqual(hard.W, 2, 'a NextGen win is a win');
  assert.strictEqual(hard.L, 0);
  // 2 sets from the normal match + 3 from the NextGen one, all retained.
  assert.strictEqual(hard.setW, 5, `sets are retained as sets (got ${hard.setW})`);
  assert.strictEqual(hard.setL, 0);
});

check('TIEBREAKS leave too — a 3-3 breaker is a differently-REACHED event', () => {
  // Founder ruling 2026-09-21, reversing what the first pass retained. The
  // fixture pairs a normal match carrying ONE tiebreak with a NextGen match
  // carrying TWO, so a rule that kept the NextGen breakers would read 3.
  const normalWithTb = M({ score: '7-6(4) 6-3' });                 // 1 tiebreak, reached at 6-6
  const ngWithTb     = NG({ score: '4-3(4) 2-4(5) 4-1' });         // 2 tiebreaks, reached at 3-3
  const hard = CS.splits([normalWithTb, ngWithTb]).Hard;
  assert.strictEqual(hard.M, 2, 'both are still matches');
  assert.strictEqual(hard.tbW + hard.tbL, 1,
    `only the 6-6 tiebreak may count (got ${hard.tbW + hard.tbL})`);
  assert.strictEqual(hard.tbW, 1, 'and it is the one the player won');
  // ...and it shares the games population rather than inventing a second one.
  assert.strictEqual(hard.gameM, 1, 'tiebreaks and games rest on the same gameM');
  assert.strictEqual(hard.gameX, 1);
});

check('CONTROL: the same two tiebreaks under a normal name BOTH count', () => {
  // Proves the exclusion above is the matcher and not the scoreline — without
  // this, a parser that simply failed to read "4-3(4)" would pass it.
  const hard = CS.splits([
    M({ score: '7-6(4) 6-3' }),
    M({ score: '4-3(4) 2-4(5) 4-1', tournament: 'Some Open' }),
  ]).Hard;
  assert.strictEqual(hard.tbW + hard.tbL, 3,
    `untagged, all three tiebreaks must count (got ${hard.tbW + hard.tbL}) — else this control is vacuous`);
  assert.strictEqual('gameX' in hard, false);
});

check('a row whose only match is alternate-format dashes its TIEBREAK pct too', () => {
  const hard = CS.splits([NG({ score: '4-3(4) 4-2 4-1' })]).Hard;
  assert.strictEqual(hard.M, 1, 'the match still exists');
  assert.strictEqual(hard.tbW, 0);
  assert.strictEqual(hard.tbPct, null, `expected null (dash), got ${hard.tbPct}`);
  assert.strictEqual(hard.setPct, 100, 'sets still compute — they are retained');
});

check('...and its GAMES are excluded, with the reduced population stated on the row', () => {
  const rows = CS.splits([M(), NG()]);
  const hard = rows.Hard;
  assert.strictEqual(hard.gameM, 1, `games population must exclude the NextGen match (got ${hard.gameM})`);
  assert.strictEqual(hard.gameX, 1, 'the excluded count must be stated, not implied');
  assert.strictEqual(hard.gameW, 12, `only the normal match's games (6+6), got ${hard.gameW}`);
  assert.strictEqual(hard.gameL, 7,  `only the normal match's games (4+3), got ${hard.gameL}`);
  assert.notStrictEqual(hard.gameM, hard.M, 'this fixture is only meaningful when gameM < M');
});

check('CONTROL: the identical fixture under a normal name keeps its games', () => {
  // Proves the exclusion is carried by the matcher and nothing else — the same
  // scoreline, the same everything, one word different.
  const rows = CS.splits([M(), NG({ tournament: 'Some Open' })]);
  const hard = rows.Hard;
  assert.strictEqual(hard.gameM, 2, 'without the tag both matches must count');
  assert.strictEqual('gameX' in hard, false, 'gameX must be absent when nothing was excluded');
  assert.strictEqual(hard.gameW, 12 + 12, `4+4+4 won plus the normal 6+6, got ${hard.gameW}`);
});

check('a row whose ONLY match is alternate-format dashes rather than reporting 0.0%', () => {
  // The standing rule: missing data is a dash, never a zero, never a plausible
  // default. An empty games population must not render as "0.0% of games won".
  const rows = CS.splits([NG()]);
  const hard = rows.Hard;
  assert.strictEqual(hard.M, 1, 'the match still exists');
  assert.strictEqual(hard.gameM, 0);
  assert.strictEqual(hard.gamePct, null, `expected null (dash), got ${hard.gamePct}`);
  assert.strictEqual(hard.setPct, 100, 'the SET percentage still computes — sets are retained');
});

// ── 3 · build-series: the KEY matcher, both directions ──────────────────────
check('build-series tags on tournament_key 2793 and nothing else', () => {
  assert.strictEqual(BS.altFormatOf({ tournament_key: '2793' }), 'nextgen');
  assert.strictEqual(BS.altFormatOf({ tournament_key: 2793 }), 'nextgen', 'numeric key must work too');
  for (const k of ['3683', '2505', '279', '27930', '', null, undefined]) {
    assert.strictEqual(BS.altFormatOf({ tournament_key: k }), null, `key ${JSON.stringify(k)} must not tag`);
  }
  assert.strictEqual(BS.altFormatOf(null), null);
  // NEGATIVE CONTROL: the NAME must not be what decides it here. Milan's ATP
  // singles event is key 3683 and the Challenger is 2505.
  assert.strictEqual(BS.altFormatOf({ tournament_key: '3683', tournament_name: 'Next Gen Finals - Milan' }), null,
    'a NextGen-NAMED fixture under another key must not tag — the key is the handle');
});

check('upcomingBestOf refuses to type an alternate-format fixture', () => {
  // This is the gate that decides which format-locked games streaks may render
  // against the upcoming match. Falling through to 3 would render a bo3
  // total-games run, built on sets to six, against sets to four.
  assert.strictEqual(BS.upcomingBestOf({ tournament_key: '2793', event_type_type: 'Atp Singles' }), null);
  // ...while a normal tour fixture still types, or this proves nothing.
  assert.strictEqual(BS.upcomingBestOf({ tournament_key: '3683', event_type_type: 'Atp Singles' }), 3);
});

// ── 4 · build-series: end to end through recordFor ──────────────────────────
// The fixture deliberately carries a NORMAL best-of-five scoreline and varies
// ONLY the tournament_key. That isolates the guard: if the key is what excludes
// the match, the identical scoreline must type Bo5 under any other key.
//
// It is built this way because of a measured accident documented below — a real
// NextGen scoreline is ALREADY rejected by setsFromScores for an unrelated
// reason, so a test using real NextGen scores would pass whether or not the
// guard existed. That is the W/O 0-0 trap in a new place.
function fixture(over = {}) {
  return {
    event_key: 'e1', event_date: '2024-12-22', event_status: 'Finished',
    event_type_type: 'Atp Singles', tournament_key: '2793',
    tournament_name: 'ATP Next Gen Finals - Jeddah', tournament_round: 'Final',
    first_player_key: '111', second_player_key: '222',
    event_first_player: 'A. One', event_second_player: 'B. Two',
    event_winner: 'First Player', event_final_result: '3 - 1',
    scores: [
      { score_first: '6', score_second: '4', score_set: '1' },
      { score_first: '4', score_second: '6', score_set: '2' },
      { score_first: '6', score_second: '3', score_set: '3' },
      { score_first: '6', score_second: '2', score_set: '4' },
    ],
    ...over,
  };
}
const rec = fx => BS.recordFor(fx, '111', 'tour', {}, new Map(), false);

check('an alternate-format match is still a RECORD and still a win', () => {
  const r = rec(fixture());
  assert.ok(r, 'the match must not be dropped — it still counts in the series');
  assert.strictEqual(r.won, true, 'a 3-1 win is a win');
  assert.strictEqual(r.altFormat, 'nextgen', 'the row must say why its games are null');
});

check('...and it does not type a best-of, nor enter total-games / handicap / first-set', () => {
  const r = rec(fixture());
  assert.strictEqual(r.bestOf, null, `must not type a best-of (got ${r.bestOf})`);
  assert.strictEqual(r.totalGames, null, 'must not enter the total-games pool');
  assert.strictEqual(r.gameMargin, null, 'must not enter the handicap pool');
  assert.strictEqual(r.set1Total, null, 'must not enter the first-set GAMES pool');
  // The first-set OUTCOME is a set fact and survives — he won set 1.
  assert.strictEqual(r.lostSet1, false, 'the first-set OUTCOME is a set fact and is retained');
});

check('CONTROL: the identical scoreline under a normal key DOES type Bo5 and price', () => {
  // Same match, same scores, one field different. Without this the assertions
  // above could pass because the scoreline was unreadable rather than because
  // the key excluded it.
  const r = rec(fixture({ tournament_key: '3683', event_key: 'e2' }));
  assert.ok(r, 'control row missing');
  assert.strictEqual('altFormat' in r, false, 'control must carry no exclusion reason');
  assert.strictEqual(r.bestOf, 5, `control must type Bo5 off the same 3-1 (got ${r.bestOf})`);
  assert.strictEqual(r.totalGames, 37, `control must carry its games (got ${r.totalGames})`);
  assert.strictEqual(r.set1Total, 10, `control must carry its first-set total (got ${r.set1Total})`);
});

check('MEASURED: a REAL NextGen scoreline was already rejected — by accident, not design', () => {
  // setsFromScores marks a set `decided` only when the winner reached >= 6
  // games. A NextGen set is first to FOUR, so no NextGen set has ever been
  // decided in this engine, and every games field was already null.
  //
  // This is the same shape as the walkover 0-0 accident the founder replaced
  // with a real flag: correct today, and silently broken the first time that
  // >= 6 rule is relaxed or a short-set format reaches 6 games. The assertion
  // is recorded so the accident is documented rather than relied upon, and the
  // key-based guard above is what actually holds the ruling.
  const realNextGen = fixture({
    tournament_key: '3683',     // NORMAL key, so only the scoreline can exclude it
    event_key: 'e3',
    scores: [
      { score_first: '4', score_second: '2', score_set: '1' },
      { score_first: '2', score_second: '4', score_set: '2' },
      { score_first: '4', score_second: '1', score_set: '3' },
      { score_first: '4', score_second: '3', score_set: '4' },
    ],
  });
  const r = rec(realNextGen);
  assert.ok(r, 'the row still exists');
  assert.strictEqual(r.bestOf, null, 'short sets never reach the >= 6 decided test');
  assert.strictEqual(r.totalGames, null);
  assert.strictEqual(r.set1Total, null);
  // ...and the guard makes it explicit rather than incidental:
  const guarded = rec({ ...realNextGen, tournament_key: '2793', event_key: 'e4' });
  assert.strictEqual(guarded.altFormat, 'nextgen', 'the guard states the reason the accident cannot');
});

console.log(`\naltFormat games scope: ${pass} pass, ${fails.length} fail`);
if (fails.length) { console.error('FAILED: ' + fails.join(' · ')); process.exit(1); }
