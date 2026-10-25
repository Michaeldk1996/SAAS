#!/usr/bin/env node
// TEN-321 (founder, 2026-09-28): TOURNAMENT_VENUE_HINTS keys the Slam as "French Open" (api-tennis's
// name) while COURT_CONDITIONS keys it "Roland Garros" (the sheet's), so every French Open card had no
// court speed, altitude or hold rate. Drives the REAL pipeline join (venueAndCourtSpeedFor, the one
// function all three match build paths call) and the real court-speed record matcher.
const assert = require('assert');
const fs = require('fs'), path = require('path');
const P = require('../bsp-pipeline.js');
let pass = 0, fail = 0;
const check = (n, f) => { try { f(); pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.log('  FAIL ' + n + ' :: ' + e.message); } };

// Mutation: delete `'French Open': 'Roland Garros'` from COURT_CONDITIONS_ALIASES → courtSpeed null → red.
check('an RG match (api-tennis name and round string) resolves its AS 0.68 · Slow, 35 m, 74% hold', () => {
  for (const name of ['French Open', 'ATP French Open - 1/64-finals']) {
    const cs = P.venueAndCourtSpeedFor(name).courtSpeed;
    assert.ok(cs, `${name}: no courtSpeed`);
    assert.deepStrictEqual([cs.abstractSpeed, cs.category, cs.altitude, cs.serviceHold], [0.68, 'Slow', 35, 74], name);
  }
});
// Mutation: map the alias to 'Paris' → RG reads Bercy's 0.97 · Medium → red.
check('the RG join never reaches Paris (Bercy, indoor hard 0.97)', () => {
  assert.strictEqual(P.venueAndCourtSpeedFor('French Open').courtSpeed.abstractSpeed, P.COURT_CONDITIONS['Roland Garros'].abstractSpeed);
  assert.strictEqual(P.venueAndCourtSpeedFor('ATP Paris - 1/32-finals').courtSpeed.abstractSpeed, 0.97);
});

// Mutation: drop the alias fallback line in courtConditionsFor → the RG win is not counted (null) → red.
check('an RG fixture counts toward the player\'s Slow court-speed record', () => {
  const f = { event_status: 'Finished', event_winner: 'First Player', first_player_key: 1, second_player_key: 2,
    tournament_name: 'French Open', event_final_result: '3 - 0' };
  assert.deepStrictEqual(P.courtSpeedRecordFromFixtures([f], 1, 'Slow'), { wins: 1, losses: 0, sampleSize: 1, pct: 100 });
});

// The full scan, pinned. Every hint key either joins a sheet row or is a venue the sheet does not rate.
// Mutation: add a hint key whose sheet row is spelled differently (or rename a COURT_CONDITIONS key) → red.
// 'Lyon (France)' (round 2 item 1.1): the October event, new — the sheet's 'Lyon' row is the clay event, so it joins none.
const UNRATED = ['Sydney', 'Zhuhai', 'Pune', 'Lyon (France)', 'Tel Aviv', 'Astana', 'Belgrade', 'Ho Chi Minh City', 'Jeddah', 'Brussels'];
check('75 hint keys: 65 join a sheet row, the 10 unrated venues have none; all 64 sheet rows are reached', () => {
  const hints = Object.keys(P.TOURNAMENT_VENUE_HINTS);
  const joined = hints.filter(k => P.venueAndCourtSpeedFor(k).courtSpeed);
  assert.deepStrictEqual(hints.filter(k => !joined.includes(k)), UNRATED);
  const reached = new Set(joined.map(k => P.courtConditionsFor(k) && P.courtConditionsFor(k).key));
  assert.deepStrictEqual(Object.keys(P.COURT_CONDITIONS).filter(k => !reached.has(k)), []);
});

// Mutation: put back an inline `COURT_CONDITIONS[hintKey]` join at any build site → red.
check('every match build path joins through venueAndCourtSpeedFor (no inline COURT_CONDITIONS[hintKey])', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bsp-pipeline.js'), 'utf8');
  assert.strictEqual((src.match(/COURT_CONDITIONS\[hintKey\]/g) || []).length, 0);
  assert.strictEqual((src.match(/= venueAndCourtSpeedFor\(/g) || []).length, 3);
});

// Defect brief 2026-10-24 item 4: Lyon 2026 is indoor hard; the 'Lyon' hint + sheet row are the clay Lyon (0.70, 2023).
// Mutation: drop the feed-surface check in venueAndCourtSpeedFor → Lyon hard reads 0.70 → red.
check('a match whose feed surface contradicts the hint gets NO court speed (Lyon 2026 hard → dash)', () => {
  assert.strictEqual(P.venueAndCourtSpeedFor('ATP Lyon - 1/16-finals', 'hard').courtSpeed, null);
  assert.strictEqual(P.venueAndCourtSpeedFor('ATP Lyon', 'Hard').courtSpeed, null);
  assert.strictEqual(P.venueAndCourtSpeedFor('ATP Lyon', 'hard').hintKey, 'Lyon', 'the venue hint itself still resolves');
});
// Mutation: dash on ANY passed surface (or treat an unknown surface as 'hard') → the clay Lyon / unknown read null → red.
check('the matching surface, or an unknown one, keeps the reading (clay Lyon 0.70; no guessed surface)', () => {
  assert.strictEqual(P.venueAndCourtSpeedFor('ATP Lyon', 'clay').courtSpeed.abstractSpeed, 0.7);
  assert.strictEqual(P.venueAndCourtSpeedFor('ATP Lyon', null).courtSpeed.abstractSpeed, 0.7);
  assert.strictEqual(P.venueAndCourtSpeedFor('ATP Lyon').courtSpeed.abstractSpeed, 0.7);
  assert.strictEqual(P.venueAndCourtSpeedFor('French Open', 'clay').courtSpeed.abstractSpeed, 0.68);
});
// Mutation: a build path that calls the join without the fixture's own surface → red.
check('all three build paths pass the fixture\'s own feed surface (fixtureSurface), never a default', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bsp-pipeline.js'), 'utf8');
  assert.strictEqual((src.match(/= venueAndCourtSpeedFor\([^;]*, \(surfaceMap \? fixtureSurface\(fixture, surfaceMap\) : null\)\);/g) || []).length, 3);
});

console.log(`\nten321-rg-court-speed: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
