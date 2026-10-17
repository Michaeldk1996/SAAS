#!/usr/bin/env node
// TEN-446 (founder ruling 2026-10-17, comment b5b5ef00 on TEN-443) — women's events are not counted in a men's record.
//
// A WIRING test: real fixtures through the real record builders in bsp-pipeline.js —
//   buildAllTierYearly (the season table's counts) · playerMatchHistory (the per-match rows behind them) ·
//   seasonSurfaceByTier (current-season surface record) · recentFormFromFixtures (the form list)
// with women's matches on a man's key, exactly as api-tennis serves them after a name collision: event_type_type
// "Itf Women Singles" under a "W15 Manacor" name (measured 2026-10-17: 56 such rows on men's keys, 8 on 3 profiled
// players). The trap the other way: "ITF W15 Monastir 13 Men" is a W-prefixed name whose type is "Itf Men Singles"
// — a men's event, and it must stay counted.
//
// What makes it fail: the TEN-444 predicate (juniors only) at ANY builder site, or a rule that reads the tournament
// name ("W15", "Women") instead of the event type.
'use strict';
const assert = require('assert');
const P = require('../bsp-pipeline.js');

let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); } };

const KEY = '7', CUR = 2026;
const EVENTS = {
  910: ['Madrid', 'Atp Singles', 'clay'], 911: ['ITF W15 Monastir 13 Men', 'Itf Men Singles', 'hard'],
  912: ['W15 Manacor', 'Itf Women Singles', 'hard'], 913: ['Bol Challenger', 'Challenger Women Singles', 'clay'],
  914: ['Eastbourne', 'Wta Singles', 'grass'],
};
const surfaceMap = new Map(Object.entries(EVENTS).map(([k, e]) => [k, e[2]]));
const courtMap = new Map(Object.keys(EVENTS).map((k) => [k, 'outdoor']));
let ek = 6000;
function fx(date, tk, won, opp) {
  const [name, type] = EVENTS[tk];
  return {
    event_key: String(ek++), event_date: date, tournament_key: String(tk), tournament_name: name, tournament_season: date.slice(0, 4),
    event_type_type: type, event_status: 'Finished', event_winner: won ? 'First Player' : 'Second Player',
    first_player_key: KEY, second_player_key: '99' + ek, event_first_player: 'L. Seven', event_second_player: opp,
    event_final_result: won ? '2 - 0' : '0 - 2', tournament_round: name + ' - 1/16-finals', event_qualification: 'False', scores: [],
  };
}
const men = [
  fx('2026-04-26', 910, true, 'A. Aa'), fx('2026-04-28', 910, false, 'B. Bb'),        // ATP 1–1, clay
  fx('2026-03-10', 911, true, 'C. Cc'), fx('2026-03-11', 911, true, 'D. Dd'),         // ITF men (W-named) 2–0, hard
];
const women = [
  fx('2026-05-05', 912, true, 'W. Wo1'), fx('2026-05-06', 912, false, 'W. Wo2'),
  fx('2026-06-01', 913, true, 'W. Wo3'), fx('2026-06-23', 914, false, 'W. Wo4'),
];
const all = men.concat(women);

const wl = (r) => (r ? `${r.won || 0}-${r.lost || 0}` : '—');
const season = (rows) => rows.find((y) => String(y.year) === String(CUR));

check('isCountedSinglesFixture: every singles type in the api-tennis catalogue, decided by type', () => {
  const t = (x, name) => P.isCountedSinglesFixture({ event_type_type: x, tournament_name: name });
  // the full get_events catalogue, 2026-10-17
  ['Atp Singles', 'Challenger Men Singles', 'Itf Men Singles'].forEach((x) => assert.strictEqual(t(x), true, x));
  ['Itf Women Singles', 'Challenger Women Singles', 'Wta Singles', 'Boys Singles', 'Girls Singles', 'Exhibition Women',
    'Teams Women', 'Itf Women Doubles', 'Wta Doubles'].forEach((x) => assert.strictEqual(t(x), false, x));
  assert.strictEqual(t('Itf Men Singles', 'ITF W15 Monastir 13 Men'), true, 'a W15-named men\'s event stays in');
  assert.strictEqual(t('Itf Women Singles', 'M15 Monastir'), false, 'an M-named women\'s event stays out');
});

check('buildAllTierYearly: the season counts only the men\'s matches (3–1), women\'s rows add nothing', () => {
  const y = season(P.buildAllTierYearly(all, KEY, {}, CUR, surfaceMap, courtMap));
  const base = season(P.buildAllTierYearly(men, KEY, {}, CUR, surfaceMap, courtMap));
  assert.strictEqual(wl(y.total), '3-1');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(y)), JSON.parse(JSON.stringify(base)), 'adding women\'s fixtures changed the season row');
  assert.strictEqual(wl(y.hard), '2-0', 'hard = the Monastir men\'s event only');
  assert.strictEqual(y.grass == null || wl(y.grass) === '0-0', true, 'a WTA grass match must not create a grass record');
});

check('playerMatchHistory: no women\'s row in the list behind the cells; the Monastir men\'s rows are there', () => {
  const rows = P.playerMatchHistory(all, KEY, CUR, surfaceMap, courtMap);
  assert.strictEqual(rows.length, 4, `rows ${rows.length}`);
  assert.ok(!rows.some((r) => /Wo\d/.test(r.opponent)), 'a women\'s-event opponent is listed');
  assert.strictEqual(rows.filter((r) => /Monastir/.test(r.tournament || r.event || '')).length, 2, 'Monastir men rows missing');
});

check('seasonSurfaceByTier: the current-season surface record ignores women\'s events', () => {
  assert.strictEqual(JSON.stringify(P.seasonSurfaceByTier(all, KEY, CUR, surfaceMap)), JSON.stringify(P.seasonSurfaceByTier(men, KEY, CUR, surfaceMap)));
});

check('recentFormFromFixtures: no women\'s match in the form list', () => {
  if (typeof P.recentFormFromFixtures !== 'function') throw new Error('recentFormFromFixtures not exported');
  const out = P.recentFormFromFixtures(all, KEY, surfaceMap);
  const ms = (out && (out.matches || out)) || [];
  assert.ok(Array.isArray(ms), 'unexpected shape');
  assert.ok(!JSON.stringify(ms).match(/Wo\d/), 'a women\'s-event opponent is in recent form');
});

console.log(`\nTEN-446 women's events: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
