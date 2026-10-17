#!/usr/bin/env node
// TEN-444 (founder ruling TEN-443, 2026-10-17, gate 91feaca9 "our_errors") — junior events are not counted.
//
// A WIRING test: real fixtures through the real record builders in bsp-pipeline.js —
//   buildAllTierYearly (the season table's counts) · playerMatchHistory (the per-match rows behind them) ·
//   seasonSurfaceByTier (current-season surface record) · recentFormFromFixtures (the form list)
// with a junior Slam run mixed into a pro season, exactly as api-tennis serves it: event_type_type "Boys Singles"
// under a PLAIN Slam name ("French Open", rounds that look like qualifying). Measured 2026-10-17: 943 of the 1,464
// junior rows at a Slam carried no "Boys" in the name (31 more are "Pardubicka juniorka"), so the test names them as the feed does.
//
// What makes it fail: the old predicate (/singles/ && !/doubles/) at ANY of the four builder sites, a predicate that
// tests the tournament name instead of the event type, or one that drops Challenger/ITF singles with the juniors.
'use strict';
const assert = require('assert');
const P = require('../bsp-pipeline.js');

let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); } };

const KEY = '7', CUR = 2026;
const surfaceMap = new Map([['900', 'clay'], ['901', 'clay'], ['902', 'hard'], ['903', 'grass']]);
const courtMap = new Map([['900', 'outdoor'], ['901', 'outdoor'], ['902', 'outdoor'], ['903', 'outdoor']]);
const EVENTS = {
  900: ['French Open', 'Atp Singles'], 901: ['French Open', 'Boys Singles'],        // same name, junior type
  902: ['Bergamo Challenger', 'Challenger Men Singles'], 903: ['Wimbledon', 'Girls Singles'],
  904: ['M25 Toulouse', 'Itf Men Singles'],
};
surfaceMap.set('904', 'hard'); courtMap.set('904', 'outdoor');
let ek = 5000;
function fx(date, tk, won, opp, round) {
  const [name, type] = EVENTS[tk];
  return {
    event_key: String(ek++), event_date: date, tournament_key: String(tk), tournament_name: name, tournament_season: date.slice(0, 4),
    event_type_type: type, event_status: 'Finished', event_winner: won ? 'First Player' : 'Second Player',
    first_player_key: KEY, second_player_key: '99' + ek, event_first_player: 'P. Seven', event_second_player: opp,
    event_final_result: won ? '2 - 0' : '0 - 2', tournament_round: name + (round || ' - 1/16-finals'), event_qualification: 'False', scores: [],
  };
}
const pro = [
  fx('2026-05-26', 900, true, 'A. Aa'), fx('2026-05-28', 900, false, 'B. Bb'),           // ATP French Open 1–1
  fx('2026-04-10', 902, true, 'C. Cc'),                                                    // Challenger 1–0
  fx('2026-08-04', 904, true, 'D. Dd'),                                                    // ITF 1–0
];
const juniors = [
  fx('2026-06-06', 901, true, 'J. Jr1'), fx('2026-06-08', 901, true, 'J. Jr2'),
  fx('2026-06-11', 901, true, 'J. Jr3', ' - Qualifying'), fx('2026-06-12', 901, false, 'J. Jr4', ' - Qualifying'),
  fx('2026-07-06', 903, true, 'J. Jr5'),
];
const all = pro.concat(juniors);

const wl = (r) => (r ? `${r.won || 0}-${r.lost || 0}` : '—');
const season = (rows) => rows.find((y) => String(y.year) === String(CUR));

check('isCountedSinglesFixture: pro singles in, juniors / doubles / exhibitions / team types out', () => {
  const t = (x) => P.isCountedSinglesFixture({ event_type_type: x });
  ['Atp Singles', 'Challenger Men Singles', 'Itf Men Singles'].forEach((x) => assert.strictEqual(t(x), true, x));
  ['Boys Singles', 'Girls Singles', 'Atp Doubles', 'Boys Doubles', 'Exhibition Men', 'Teams Men', ''].forEach((x) => assert.strictEqual(t(x), false, x));
  assert.strictEqual(P.isCountedSinglesFixture({ event_type_type: 'Atp Singles', tournament_name: 'Boys French Open' }), true,
    'decided on the event type, not the tournament name');
});

check('buildAllTierYearly: the season counts only the pro matches (3–1), juniors add nothing anywhere', () => {
  const y = season(P.buildAllTierYearly(all, KEY, {}, CUR, surfaceMap, courtMap));
  const base = season(P.buildAllTierYearly(pro, KEY, {}, CUR, surfaceMap, courtMap));
  assert.strictEqual(wl(y.total), '3-1');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(y)), JSON.parse(JSON.stringify(base)), 'adding junior fixtures changed the season row');
  assert.strictEqual(wl(y.clay), '1-1', 'clay = the ATP French Open only, not the boys event');
  assert.strictEqual(y.grass == null || wl(y.grass) === '0-0', true, 'girls Wimbledon must not create a grass record');
});

check('playerMatchHistory: no junior row in the list behind the cells', () => {
  const rows = P.playerMatchHistory(all, KEY, CUR, surfaceMap, courtMap);
  assert.strictEqual(rows.length, 4, `rows ${rows.length}`);
  assert.ok(!rows.some((r) => /Jr\d/.test(r.opponent)), 'a junior opponent is listed');
});

check('seasonSurfaceByTier: the current-season surface record ignores juniors', () => {
  const a = JSON.stringify(P.seasonSurfaceByTier(all, KEY, CUR, surfaceMap));
  const b = JSON.stringify(P.seasonSurfaceByTier(pro, KEY, CUR, surfaceMap));
  assert.strictEqual(a, b);
});

check('recentFormFromFixtures: no junior match in the form list', () => {
  if (typeof P.recentFormFromFixtures !== 'function') throw new Error('recentFormFromFixtures not exported');
  const out = P.recentFormFromFixtures(all, KEY, surfaceMap);
  const ms = (out && (out.matches || out)) || [];
  assert.ok(Array.isArray(ms), 'unexpected shape');
  assert.ok(!JSON.stringify(ms).match(/Jr\d/), 'a junior opponent is in recent form');
});

console.log(`\nTEN-444 juniors: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
