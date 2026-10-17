#!/usr/bin/env node
// TEN-445 (founder approval TEN-443 gate 91feaca9, 2026-10-17) — the June ATP Stuttgart event is GRASS, every season.
// api-tennis's catalogue lists ATP Stuttgart (tournament_key 2068) as clay; the clay Stuttgart is the WTA event (1977).
// WIRING: the real resolver (correctTournamentSurface, which builds tournament-surfaces.json on every refresh), the
// committed cache the builders read, and a June Stuttgart fixture through the real buildAllTierYearly.
// Fails if: the correction is removed, scoped so it also flips the WTA event, or the committed cache says clay again.
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const P = require('../bsp-pipeline.js');
let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.log('  FAIL ' + n + ' :: ' + e.message); } };

check('resolver: ATP Stuttgart (provider says Clay) -> grass; WTA Stuttgart stays clay', () => {
  assert.strictEqual(P.correctTournamentSurface({ tournament_name: 'Stuttgart', event_type_type: 'Atp Singles', tournament_sourface: 'Clay' }), 'grass');
  assert.strictEqual(P.correctTournamentSurface({ tournament_name: 'Stuttgart', event_type_type: 'Atp Doubles', tournament_sourface: 'Clay' }), 'grass');
  assert.strictEqual(P.correctTournamentSurface({ tournament_name: 'Stuttgart', event_type_type: 'Wta Singles', tournament_sourface: 'Clay (Indoor)' }), 'clay');
  assert.strictEqual(P.correctTournamentSurface({ tournament_name: 'Mallorca', event_type_type: 'Atp Singles', tournament_sourface: 'Clay' }), 'grass', 'Mallorca correction kept');
});
const cache = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tournament-surfaces.json'), 'utf8'));
check('committed cache: key 2068 (ATP Stuttgart) = grass, key 1977 (WTA Stuttgart) = clay', () => {
  assert.strictEqual(cache.surfaces['2068'], 'grass');
  assert.strictEqual(cache.surfaces['1977'], 'clay');
});
check('buildAllTierYearly: a June 2025 Stuttgart title counts under Grass, not Clay', () => {
  const surfaceMap = new Map(Object.entries(cache.surfaces)), courtMap = new Map(Object.entries(cache.courts || {}));
  let ek = 1;
  const fx = (d, won) => ({ event_key: String(ek++), event_date: d, tournament_key: '2068', tournament_name: 'Stuttgart', tournament_season: '2025',
    event_type_type: 'Atp Singles', event_status: 'Finished', event_winner: won ? 'First Player' : 'Second Player', first_player_key: '7',
    second_player_key: '9' + ek, event_first_player: 'P. Seven', event_second_player: 'O. Opp' + ek, event_final_result: won ? '2 - 0' : '0 - 2',
    tournament_round: 'Stuttgart - 1/8-finals', event_qualification: 'False', scores: [] });
  const rows = P.buildAllTierYearly([fx('2025-06-12', true), fx('2025-06-13', true), fx('2025-06-14', true), fx('2025-06-15', true)], '7', {}, 2026, surfaceMap, courtMap);
  const y = rows.find((r) => String(r.year) === '2025');
  assert.ok(y.grass && y.grass.won === 4, 'grass ' + JSON.stringify(y.grass));
  assert.ok(!y.clay || (y.clay.won || 0) + (y.clay.lost || 0) === 0, 'clay ' + JSON.stringify(y.clay));
});
console.log(`\nTEN-445 Stuttgart: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
