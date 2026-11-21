#!/usr/bin/env node
// tools/refresh-court-conditions-speed.mjs — refresh COURT_CONDITIONS' current speed reading from court-speed-history.json
// (founder 2026-11-20: one speed figure on every page — Match analysis, Key factors, the profile and the Tournaments
// page read the latest Tennis Abstract season reading). Per row: abstractSpeed / abstractSpeedYear = the latest season in
// `ta` (never older than the stored one); `speed` = the documented 0–100 scale on its original anchors (0.41 → 0, 1.42 → 100),
// clamped. Every other field is untouched. Both copies (bsp-pipeline.js and
// bsp-consult-dashboard.html) are rewritten identically; a row whose line cannot be matched stops the run (nothing
// written). Prints every row whose Slow / Medium / Fast label moves (courtSpeedCategory: ≤ 43 Slow, ≤ 68 Medium).
// Usage: node tools/refresh-court-conditions-speed.mjs [--dry]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILES = ['bsp-pipeline.js', 'bsp-consult-dashboard.html'];
const dry = process.argv.includes('--dry');
const SCALE_LO = 0.41, SCALE_HI = 1.42;
const cat = s => (s == null ? null : s <= 43 ? 'Slow' : s <= 68 ? 'Medium' : 'Fast');

const src0 = fs.readFileSync(path.join(ROOT, FILES[0]), 'utf8');
const m = src0.match(/^const COURT_CONDITIONS = (\{[\s\S]*?^\});/m);
if (!m) throw new Error('COURT_CONDITIONS not found');
const CC = Function('"use strict";return (' + m[1] + ')')();
const H = JSON.parse(fs.readFileSync(path.join(ROOT, 'court-speed-history.json'), 'utf8')).ta;

const next = {};
for (const [k, v] of Object.entries(CC)) {
  let as = v.abstractSpeed, yr = v.abstractSpeedYear;
  const s = H[k] || {}, ys = Object.keys(s).filter(y => s[y] != null).map(Number).sort((a, b) => a - b);
  const ly = ys[ys.length - 1];
  if (ly != null && (yr == null || ly >= yr)) { as = s[ly]; yr = ly; }
  next[k] = { as, yr };
}
// The scale keeps its ORIGINAL anchors (0.41 = 0, 1.42 = 100: the set's min and max when it was cut), clamped to 0–100,
// so a venue's index and label move only when its own reading moves. Re-normalising over the new set would relabel
// unchanged readings (Wimbledon and Miami 1.11 / 1.18 Fast -> Medium only because Montpellier's 1.50 stretched the scale).
const lo = SCALE_LO, hi = SCALE_HI, vals = Object.values(next).map(x => x.as).filter(x => x != null);
for (const x of Object.values(next)) x.speed = x.as == null ? null : Math.max(0, Math.min(100, Math.round(100 * (x.as - lo) / (hi - lo))));

const moved = [];
for (const k of Object.keys(CC)) if (cat(CC[k].speed) !== cat(next[k].speed)) moved.push(`${k}: ${CC[k].abstractSpeed} (${CC[k].abstractSpeedYear}, ${cat(CC[k].speed)}) -> ${next[k].as} (${next[k].yr}, ${cat(next[k].speed)})`);

const out = {};
for (const f of FILES) {
  let s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const [k, x] of Object.entries(next)) {
    const re = new RegExp(`(^  '${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}': \\{ speed: )(-?[\\d.]+|null)(, altitude: [^,]+, abstractSpeed: )([\\d.]+|null)(, abstractSpeedYear: )(\\d+|null)`, 'm');
    if (!re.test(s)) throw new Error(`${f}: row ${k} not matched — nothing written`);
    s = s.replace(re, `$1${x.speed}$3${x.as}$5${x.yr}`);
    // founder 2026-11-20: every season is graded by ITS OWN reading (Paris 2025 = 0.97, Paris 2026 = 1.44), so the row
    // carries asYYYY for every season with a reading — the profile's spdEditionSpeed reads as<year> before the current
    // reading. The run of as<year> fields after abstractSpeedYear is replaced whole.
    const seasons = Object.keys(H[k] || {}).filter(y => H[k][y] != null).sort();
    const asList = seasons.length ? seasons.map(y => `as${y}: ${H[k][y]}`).join(', ') : 'as2023: null, as2024: null, as2025: null';
    const re2 = new RegExp(`(^  '${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}': \\{[^\\n]*?abstractSpeedYear: (?:\\d+|null), )((?:as\\d{4}: (?:[\\d.]+|null), )+)`, 'm');
    if (!re2.test(s)) throw new Error(`${f}: row ${k} has no as<year> run — nothing written`);
    s = s.replace(re2, `$1${asList}, `);
  }
  out[f] = s;
}
console.log(`range ${lo}–${hi} over ${vals.length} rows; ${Object.keys(next).filter(k => next[k].yr !== CC[k].abstractSpeedYear || next[k].as !== CC[k].abstractSpeed).length} readings refreshed; label moves: ${moved.length}`);
moved.forEach(l => console.log('  ' + l));
if (!dry) for (const f of FILES) { fs.writeFileSync(path.join(ROOT, f) + '.tmp', out[f]); fs.renameSync(path.join(ROOT, f) + '.tmp', path.join(ROOT, f)); }
