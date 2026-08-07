#!/usr/bin/env node
/* TEN-8 verification: does the full-name join fix (7f27582) resolve style +
 * under-pressure for EVERY player on the board, and is there any residual
 * name-format miss for anyone in our database?
 *
 * Method:
 *   - Enumerate every (numericKey, name) player appearing in matches.json.
 *   - Run resolvePlayer() exactly as the model does -> did style/clutch join?
 *   - ORACLE (name-format independent): index playing-styles.json and
 *     clutch-rating.json by eloKey (last|firstInitial) computed from each ROW's
 *     own name. If the oracle has a row for a player's eloKey but resolvePlayer
 *     returned null, that is a RESIDUAL NAME-FORMAT MISS (the bug class the
 *     founder wants at zero). If the oracle has no row either, it's a genuine
 *     coverage gap (player simply not classified) -- not a naming bug.
 *   - STRESS: re-run resolve with the fixture name forced to (a) full name and
 *     (b) abbreviated name, to catch direction-specific breakage.
 */
const data = require('../h2h-model/data.js');
const { resolvePlayer, abbrFromFullName } = data;

// same normaliser resolvePlayer uses internally
const stripAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
function eloKeyFromName(name) {
  if (!name) return null;
  let s = stripAccents(name).toLowerCase().replace(/'/g, '').replace(/\./g, ' ').replace(/-/g, ' ');
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[parts.length - 1]}|${parts[0][0]}`;
}
const po = (o) => Array.isArray(o) ? o : (o.players || o.styles || o);

// ---- build oracle indexes (name-format independent) -----------------------
function indexByEloKey(arr) {
  const idx = new Map();
  for (const row of arr) {
    const k = eloKeyFromName(row.name);
    if (!k) continue;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(row);
  }
  return idx;
}
const styleOracle = indexByEloKey(po(data.load('playing-styles.json')));
const clutchOracle = indexByEloKey(po(data.load('clutch-rating.json')));

// ---- enumerate board players ----------------------------------------------
const matches = po(data.load('matches.json'));
const players = new Map(); // numericKey -> {key,name,mids:Set}
for (const m of matches) {
  for (const side of ['p1', 'p2']) {
    const key = m[`${side}Key`];
    const name = m[side];
    if (key == null) continue;
    const id = String(key);
    if (!players.has(id)) players.set(id, { key, name, count: 0 });
    players.get(id).count++;
  }
}

// ---- test each player ------------------------------------------------------
const rows = [];
for (const { key, name } of players.values()) {
  const r = resolvePlayer(key, name);
  const eloK = r.eloKey; // computed from best full name
  const styleOracleHas = eloK ? styleOracle.has(eloK) : false;
  const clutchOracleHas = eloK ? clutchOracle.has(eloK) : false;

  // stress both name directions
  const full = r.fullName || name;
  const abbr = abbrFromFullName(full) || name;
  const styleFull = !!resolvePlayer(key, full).style;
  const styleAbbr = !!resolvePlayer(key, abbr).style;

  rows.push({
    key, name, fullName: r.fullName, eloK,
    style: !!r.style, clutch: !!r.clutch,
    styleOracleHas, clutchOracleHas,
    styleResidualMiss: styleOracleHas && !r.style,
    clutchResidualMiss: clutchOracleHas && !r.clutch,
    styleFull, styleAbbr,
    directionBreak: styleFull !== styleAbbr,
    count: players.get(String(key)).count,
  });
}

// ---- report ----------------------------------------------------------------
const n = rows.length;
const styled = rows.filter(r => r.style).length;
const clutched = rows.filter(r => r.clutch).length;
const styleResidual = rows.filter(r => r.styleResidualMiss);
const clutchResidual = rows.filter(r => r.clutchResidualMiss);
const dirBreaks = rows.filter(r => r.directionBreak);
const noStyleNoOracle = rows.filter(r => !r.style && !r.styleOracleHas);

console.log('=== BOARD-WIDE STYLE / UNDER-PRESSURE JOIN VERIFICATION ===');
console.log(`unique players on board: ${n}  (across ${matches.length} priced fixtures)`);
console.log(`style row resolved:      ${styled}/${n}  (${(100*styled/n).toFixed(0)}%)`);
console.log(`under-pressure resolved: ${clutched}/${n}  (${(100*clutched/n).toFixed(0)}%)`);
console.log('');
console.log(`>> RESIDUAL name-format MISSES (bug class) — style:  ${styleResidual.length}`);
console.log(`>> RESIDUAL name-format MISSES (bug class) — clutch: ${clutchResidual.length}`);
console.log(`>> direction-dependent breaks (full vs abbr disagree): ${dirBreaks.length}`);
console.log('');
if (styleResidual.length) {
  console.log('--- STYLE residual misses (oracle has a row, join missed it) ---');
  styleResidual.forEach(r => console.log(`  key=${r.key}  "${r.name}"  full="${r.fullName}"  eloKey=${r.eloK}`));
}
if (clutchResidual.length) {
  console.log('--- CLUTCH residual misses ---');
  clutchResidual.forEach(r => console.log(`  key=${r.key}  "${r.name}"  full="${r.fullName}"  eloKey=${r.eloK}`));
}
if (dirBreaks.length) {
  console.log('--- direction-dependent breaks ---');
  dirBreaks.forEach(r => console.log(`  key=${r.key}  "${r.name}"  full->${r.styleFull}  abbr->${r.styleAbbr}`));
}
console.log('');
console.log(`--- genuine coverage gaps (no style row exists anywhere): ${noStyleNoOracle.length} ---`);
noStyleNoOracle.forEach(r => console.log(`  key=${r.key}  "${r.name}"  full="${r.fullName}"  clutch=${r.clutch}`));

// machine-readable summary
require('fs').writeFileSync(process.env.OUT || '/dev/null',
  JSON.stringify({ n, styled, clutched,
    styleResidual: styleResidual.map(r=>({key:r.key,name:r.name,eloK:r.eloK})),
    clutchResidual: clutchResidual.map(r=>({key:r.key,name:r.name,eloK:r.eloK})),
    dirBreaks: dirBreaks.map(r=>({key:r.key,name:r.name,full:r.styleFull,abbr:r.styleAbbr})),
    coverageGaps: noStyleNoOracle.map(r=>({key:r.key,name:r.name})) }, null, 2));
