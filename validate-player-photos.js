#!/usr/bin/env node
/*
 * TEN-97 guard — photo-override integrity, fail-closed.
 *
 * The api-tennis logo assets are occasionally the WRONG player: key 2002
 * (Facundo Díaz Acosta) shipped the byte-identical file for key 391 (Juan Pablo
 * Varillas), a member-visible wrong face on the card. The fix is a key-based
 * override map (player-photos.json) that the dashboard's avatar renderers prefer
 * over the per-match pXPhotoUrl.
 *
 * This validator protects the two ways that fix can silently regress:
 *   1. Data: player-photos.json clobbered / the corrected 2002 entry lost or
 *      pointed back at an api-tennis logo.
 *   2. Wiring: the override lookup (photoOverrideFor) stripped out of one of the
 *      three avatar builders, or no longer loaded on the matches critical path.
 *
 * Exit non-zero on any failure so it can gate a refresh job / CI.
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const errors = [];
const ok = (m) => console.log('  ok  ' + m);
const fail = (m) => { errors.push(m); console.log('  FAIL ' + m); };

// ---- 1. player-photos.json data invariants -------------------------------
let photos = null;
try {
  photos = JSON.parse(fs.readFileSync(path.join(HERE, 'player-photos.json'), 'utf8'));
} catch (e) {
  fail('player-photos.json does not parse: ' + e.message);
}
if (photos && typeof photos === 'object' && !Array.isArray(photos)) {
  ok('player-photos.json parses as a key→{name,photo} object (' + Object.keys(photos).length + ' entries)');
  // Every entry must carry a usable https photo URL.
  for (const [k, v] of Object.entries(photos)) {
    if (!v || typeof v.photo !== 'string' || !/^https:\/\//.test(v.photo)) {
      fail(`entry ${k} (${v && v.name}) has no valid https photo URL`);
    }
  }
  // The specific correction that opened this ticket.
  const diaz = photos['2002'];
  if (!diaz) fail('key 2002 (Facundo Díaz Acosta) override is missing');
  else {
    if (!/diaz\s*acosta/i.test(diaz.name || '')) fail(`key 2002 name is "${diaz.name}", expected Díaz Acosta`);
    else ok('key 2002 override present and named Díaz Acosta');
    if (/api\.api-tennis\.com\/logo-tennis/.test(diaz.photo || '')) {
      fail('key 2002 photo points back at an api-tennis logo (the wrong-asset source)');
    } else ok('key 2002 photo is an off-api-tennis (Wikimedia) asset');
  }
} else if (photos) {
  fail('player-photos.json is not a plain object');
}

// ---- 2. dashboard wiring invariants --------------------------------------
const dash = fs.readFileSync(path.join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const mustContain = [
  ['loadPlayerPhotoOverrides definition', /async function loadPlayerPhotoOverrides\s*\(/],
  ['photoOverrideFor helper',             /function photoOverrideFor\s*\(/],
  ['override loaded on matches path',     /await loadPlayerPhotoOverrides\s*\(\s*\)/],
];
for (const [label, re] of mustContain) {
  if (re.test(dash)) ok('wiring present: ' + label);
  else fail('wiring MISSING: ' + label);
}
// Every avatar <img> builder must prefer the override. Count call sites of the
// helper inside a src-producing context; there are three builders (mc-av,
// avatar, pc-avatar-img) and each must consult photoOverrideFor.
const overrideCallSites = (dash.match(/photoOverrideFor\(/g) || []).length;
// 1 declaration + 3 builder call sites (mc-av, avatar, pc-avatar-img) = 4.
// Drop below 4 and a builder has been left on the raw api-tennis URL.
if (overrideCallSites >= 4) ok(`photoOverrideFor referenced ${overrideCallSites}× (1 decl + 3 builders)`);
else fail(`photoOverrideFor referenced only ${overrideCallSites}× — an avatar builder may be bypassing the override`);

// ---- verdict --------------------------------------------------------------
if (errors.length) {
  console.error(`\nvalidate-player-photos: ${errors.length} failure(s)`);
  process.exit(1);
}
console.log('\nvalidate-player-photos: OK');
