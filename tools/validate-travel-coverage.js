#!/usr/bin/env node
/*
 * validate-travel-coverage.js — Layer #11 fatigue TRAVEL coverage audit.
 *
 * The travel multiplier (config.adjustments.fatigue.travelMult) only fires when
 * a player played a DIFFERENT tournament inside the rolling window AND the two
 * venues' UTC offsets differ by >= travelTzGapH. Both venues must resolve
 * through config.tournamentUtcOffset (substring match) or the factor self-hides
 * — never a guessed location.
 *
 * This tool drives the REAL tournamentTz resolver over the live board
 * (matches.json x player-profiles.json recentForm) and reports, per player-side:
 *   - how many have a same-window tournament SWITCH (a travel opportunity),
 *   - how many resolve both venues,
 *   - how many actually FIRE (>= travelTzGapH),
 *   - every UNMAPPED tournament name (the maintenance to-do list).
 *
 * It asserts ZERO unmapped names on the current board (so a new venue that
 * slips onto the board is caught here instead of silently self-hiding), and
 * prints the honest live fire-count — travel is intercontinental-only, so a
 * fully-mapped board can still legitimately fire 0 times.
 *
 * Usage:  node tools/validate-travel-coverage.js
 * Exit 1 if any board tournament is unmapped.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const config = require(path.join(__dirname, '..', 'h2h-model', 'config.js'));

const ROOT = path.join(__dirname, '..');
const prof = JSON.parse(fs.readFileSync(path.join(ROOT, 'player-profiles.json'))).players;
const board = JSON.parse(fs.readFileSync(path.join(ROOT, 'matches.json')));

const WIN_DAYS = config.adjustments.fatigue.windowDays;
const GAP_H = config.adjustments.fatigue.travelTzGapH;

function tournamentTz(name) {
  if (!name) return null;
  const n = String(name).toLowerCase();
  const map = config.tournamentUtcOffset || {};
  for (const k in map) { if (n.includes(k)) return map[k]; }
  return null;
}
function rf(pk) {
  const p = prof[String(pk)];
  return (p && p.recentForm && p.recentForm.matches) || [];
}
// Same-event guard: today's `tour` vs a recentForm row's `tournament` are the
// same event when either base name contains the other (strip "ATP " and the
// " - round" suffix the recentForm rows carry).
function sameEvent(today, prev) {
  const t = String(today || '').toLowerCase().replace(/^atp\s+/, '').trim();
  const p = String(prev || '').split(' - ')[0].trim().toLowerCase();
  return !!t && !!p && (t.includes(p) || p.includes(t));
}

const unmapped = {};
let sides = 0, windowed = 0, opps = 0, bothMapped = 0, fires = 0;
const fired = [];

for (const m of board) {
  if (!m.date) continue;
  const md = new Date(m.date.slice(0, 10));
  for (const side of ['p1Key', 'p2Key']) {
    sides++;
    const win = rf(m[side]).filter((x) => {
      if (!x.date) return false;
      const d = (md - new Date(x.date.slice(0, 10))) / 86400000;
      return d >= 0 && d <= WIN_DAYS;
    });
    if (!win.length) continue;
    windowed++;
    const today = m.tour, prev = win[0].tournament;
    if (sameEvent(today, prev)) continue;
    opps++;
    const tz1 = tournamentTz(today), tz2 = tournamentTz(prev);
    if (tz1 == null) unmapped[today] = (unmapped[today] || 0) + 1;
    if (tz2 == null) unmapped[prev] = (unmapped[prev] || 0) + 1;
    if (tz1 != null && tz2 != null) {
      bothMapped++;
      if (Math.abs(tz1 - tz2) >= GAP_H) {
        fires++;
        fired.push(`${prev} (${tz1 >= 0 ? '+' : ''}${tz1}) -> ${today} (${tz2 >= 0 ? '+' : ''}${tz2}); gap ${Math.abs(tz1 - tz2)}h`);
      }
    }
  }
}

console.log('========= LAYER #11 FATIGUE — TRAVEL COVERAGE AUDIT =========');
console.log(`window ${WIN_DAYS}d | intercontinental gap threshold ${GAP_H}h | board ${board.length} matches`);
console.log(`player-sides:            ${sides}`);
console.log(`  with window matches:   ${windowed}`);
console.log(`  tournament SWITCH:     ${opps}   (travel opportunities)`);
console.log(`  both venues mapped:    ${bothMapped}`);
console.log(`  travel FIRES (>=${GAP_H}h): ${fires}`);
if (fired.length) { console.log('  fired legs:'); fired.forEach((f) => console.log('    ' + f)); }

const unmappedNames = Object.keys(unmapped);
if (unmappedNames.length) {
  console.log('\nUNMAPPED tournament names (add to config.tournamentUtcOffset):');
  Object.entries(unmapped).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  [${v}] ${k}`));
  console.log(`\nRESULT: FAIL — ${unmappedNames.length} board tournament(s) unmapped.`);
  process.exit(1);
}
console.log('\nAll board tournaments resolve. Live fire-count is honest (0 is legitimate when');
console.log('the board has no intercontinental switch inside the window).  PASS');
