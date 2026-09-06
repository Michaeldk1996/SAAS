// TEN-157 / TEN-158 / TEN-160 — round-label regression harness.
// Encodes the founder's ruling (CLAUDE.md, 2026-09-06): "authoritative fields
// beat heuristics — a set-count / structural net may never override a main-draw
// signal", and "never derive a durable label from a non-final match".
// Exercises fetchPlayerCareerHistory end-to-end with a mocked feed (no network).
// Run: node tools/test-round-label.js
const assert = require('assert');

// --- mock the feed BEFORE requiring the module (module reads global.fetch) ---
let FIXTURES = [];
global.fetch = async () => ({ json: async () => ({ success: true, result: FIXTURES }) });

const { fetchPlayerCareerHistory } = require('../bsp-pipeline.js');

const PK = '999';
// One US Open fixture, player 999 as first player. Helper keeps cases terse.
function fx({ season, round, qual = 'False', status = 'Finished', winner = 'First Player', score = '3 - 1', opp = 'M. Trungelliti', oppKey = '395' }) {
  return {
    tournament_name: 'US Open', tournament_round: round,
    event_qualification: qual, event_status: status, event_winner: winner,
    first_player_key: PK, second_player_key: oppKey,
    event_first_player: 'T. Player', event_second_player: opp,
    event_final_result: score, tournament_season: String(season),
    event_date: `${season}-09-03`, event_type_type: 'Atp Singles',
  };
}

function roundsFor(hist, season) {
  const us = (hist || []).find((t) => /us open/i.test(t.name));
  if (!us) return null;
  const ed = (us.editions || []).find((e) => String(e.year) === String(season));
  return ed ? ed.matches.map((m) => ({ res: m.res, round: m.round, opp: m.opp, score: m.score, ret: !!m.ret })) : null;
}

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`); }
}

(async () => {
  // CASE 1 — settled main-draw R64 (Blockx def. Trungelliti). Must be R64, not Q.
  FIXTURES = [fx({ season: 2026, round: 'ATP US Open - 1/32-finals', score: '3 - 1' })];
  let r = roundsFor(await fetchPlayerCareerHistory(PK), 2026);
  check('settled 3-1 main-draw 1/32-finals → R64 (not Q)',
    r && r.length === 1 && r[0].round === 'R64', `got ${JSON.stringify(r)}`);

  // CASE 2 — in-play snapshot (winner declared, score lags at 2-1, status not
  // terminal). ROOT FIX: must NOT enter career history at all.
  FIXTURES = [fx({ season: 2025, round: 'ATP US Open - 1/16-finals', status: '3', score: '2 - 1' })];
  r = roundsFor(await fetchPlayerCareerHistory(PK), 2025);
  check('in-play 2-1 snapshot (non-final status) → excluded, no row',
    r === null, `got ${JSON.stringify(r)}`);

  // CASE 3 — genuine qualifying row (event_qualification === 'True'). Stays 'Q'.
  FIXTURES = [fx({ season: 2024, round: 'ATP US Open - Final', qual: 'True', score: '2 - 1' })];
  r = roundsFor(await fetchPlayerCareerHistory(PK), 2024);
  check('genuine qualifying (event_qualification=True) → Q (TEN-89 not regressed)',
    r && r.length === 1 && r[0].round === 'Q', `got ${JSON.stringify(r)}`);

  // CASE 4 — Slam retirement at 2 sets, main-draw round. Must stay main draw.
  FIXTURES = [fx({ season: 2023, round: 'ATP US Open - 1/8-finals', status: 'Retired', score: '2 - 0' })];
  r = roundsFor(await fetchPlayerCareerHistory(PK), 2023);
  check('Slam retirement 2-0 main-draw 1/8-finals → R16 (not Q), ret flagged',
    r && r.length === 1 && r[0].round === 'R16' && r[0].ret === true, `got ${JSON.stringify(r)}`);

  // CASE 5 — STRUCTURAL-NET HOLE (the second arm this ticket closes). An edition
  // with a main-draw LOSS at a shallow round and a main-draw WIN at a deeper
  // '1/N-finals' round. The structural first-loss net would retag the deeper win
  // to 'Q'; the _frac certifier must block it.
  FIXTURES = [
    fx({ season: 2022, round: 'ATP US Open - 1/64-finals', winner: 'Second Player', score: '1 - 3', opp: 'A. Loser' }), // R128 loss
    fx({ season: 2022, round: 'ATP US Open - 1/32-finals', winner: 'First Player', score: '3 - 0', opp: 'B. Beaten' }), // R64 win (deeper)
  ];
  r = roundsFor(await fetchPlayerCareerHistory(PK), 2022);
  const win = r && r.find((m) => m.res === 'W');
  check('structural net: main-draw 1/32-finals win after a loss → stays R64 (not Q)',
    win && win.round === 'R64', `got ${JSON.stringify(r)}`);

  console.log(`\n${fail ? 'FAILED' : 'PASSED'}: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
