#!/usr/bin/env node
'use strict';
/**
 * TEN-242 — the tournament catalog, founder-ruled 2026-09-21.
 *
 * REPLACES the characterisation suite I retracted. That one asserted what the
 * code did rather than what the ruling says, so it would have passed through
 * the very change this locks. The standard here is the `altFormat` controls':
 * it has to go red when the changed lines break, and the mutations that prove
 * it are named at the bottom of this file and re-run by hand.
 *
 * THE RULING: "same tournament, same slot in the calendar, one entry." A
 * catalog entry maps a display name to a SET of archive strings, never to one.
 * A merged event cannot be represented by a scalar — that is the whole bug, not
 * the merging.
 *
 * Reads the SHIPPED maps out of the dashboard and the SHIPPED archive, so it
 * cannot drift from what ships. No browser, no network: this runs inside the
 * fail-closed pre-deploy gate.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const yield_ = JSON.parse(fs.readFileSync(path.join(ROOT, 'database-yield.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (n, cond, d) => {
  if (cond) { pass++; console.log(`  ok    ${n}${d ? '  — ' + d : ''}`); }
  else { fail++; console.log(`  FAIL  ${n}  — ${d}`); }
};

// ---- lift the shipped maps, not a copy of them ----------------------------
function grab(name) {
  const i = html.indexOf(`var ${name} = {`);
  assert.ok(i > 0, `${name} not found in the dashboard — the catalog's source moved`);
  const b = html.slice(i);
  return b.slice(0, b.indexOf('\n  };'));
}
const parseMap = (blk) => Object.fromEntries(
  [...blk.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)].map((m) => [m[1], m[2].replace(/\\u00b7/g, '·')]));

const COMMON = parseMap(grab('TOURN_COMMON'));
const SPLIT = parseMap(grab('TOURN_SPLIT'));

const T = yield_.meta.tournaments;
const rows = yield_.rows;
const rowsFor = {};
for (const r of rows) rowsFor[T[r[4]]] = (rowsFor[T[r[4]]] || 0) + 1;

// EXECUTE THE SHIPPED tournCatalog(), do not re-implement it.
//
// My first cut of this file rebuilt the grouping here from the parsed maps. It
// passed 27/27 — and three of the four mutations below survived it, because
// mutating the FUNCTION never touched the test's own copy of the rule. That is
// a parser test standing in for a wiring test, on the exact surface where the
// repo already has a rule about it. Slicing the real function out and running
// it is what makes M1 and M2 bite.
function sliceFn(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name}() not found — the catalog builder moved or was renamed`);
  let depth = 0, i = html.indexOf('{', start);
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (depth === 0) return html.slice(start, j + 1); }
  }
  throw new Error(`${name}() is unbalanced`);
}
const tournCatalog = new Function(
  'TOURN_COMMON', 'TOURN_SPLIT', 'M',
  `var _CATALOG = null, _CATALOG_FOR = null; ${sliceFn('tournCatalog')}; return tournCatalog;`
)(COMMON, SPLIT, { tournaments: T });

const byDisplay = {};
for (const e of tournCatalog()) byDisplay[e.label] = e.names;
const entryRows = (name) => (byDisplay[name] || []).reduce((a, s) => a + (rowsFor[s] || 0), 0);

console.log('\nTEN-242 · tournament catalog\n');

// ── The shape of the thing. A set, not a scalar. ───────────────────────────
ok('every archive string lands in exactly one catalog entry',
  Object.values(byDisplay).flat().length === T.length && new Set(Object.values(byDisplay).flat()).size === T.length,
  `${T.length} strings -> ${Object.keys(byDisplay).length} entries, none orphaned, none duplicated`);
ok('the catalog is SMALLER than the string list — i.e. it actually merges',
  Object.keys(byDisplay).length < T.length,
  `${Object.keys(byDisplay).length} entries < ${T.length} strings`);

// ── C · The 33 renames stay merged. Miami is the ruling's own example. ─────
ok('Miami is ONE entry carrying both sponsor eras',
  (byDisplay['Miami'] || []).length === 2
    && byDisplay['Miami'].includes('Sony Ericsson Open')
    && byDisplay['Miami'].includes('Miami Open'),
  (byDisplay['Miami'] || []).join(' | '));
ok('...and it carries 1,448 rows, not the 549 under the current sponsor',
  entryRows('Miami') === 1448, `${entryRows('Miami')} rows`);
for (const [name, n] of [['Madrid', 2], ['Canada', 2], ['Washington', 2], ['Umag', 4], ['Hamburg', 4]]) {
  ok(`...${name} carries its full set`, (byDisplay[name] || []).length === n,
    `${(byDisplay[name] || []).length} strings, ${entryRows(name)} rows`);
}

// ── A · The four that genuinely ran alongside each other stay split. ───────
// These are the co-occurrence cases: two events in the SAME season at one venue.
for (const [a, b] of [
  ['Adelaide 1', 'Adelaide 2'],
  ['Belgrade · Serbia Open', 'Belgrade · Belgrade Open'],
  ['Cologne · Indoors', 'Cologne · Championship'],
  ['Melbourne · Great Ocean Road', 'Melbourne · Murray River'],
]) {
  ok(`SPLIT: "${a}" and "${b}" are separate entries`,
    byDisplay[a] && byDisplay[b] && byDisplay[a].length === 1 && byDisplay[b].length === 1,
    `${entryRows(a)} / ${entryRows(b)} rows`);
}
ok('...and no split entry got folded back under a bare venue name',
  !byDisplay['Cologne'] && !byDisplay['Belgrade'],
  'bare "Cologne"/"Belgrade" entries absent');

// ── B · Pune is ONE tournament, and it is the case that proves the direction ──
// Tata Open and Maharashtra Open DO share 2018 — co-occurrence says split, and
// co-occurrence is wrong here. Sequential rename is the rule.
ok('Pune is merged despite its two strings sharing a season',
  (byDisplay['Pune'] || []).length === 2 && entryRows('Pune') === 129,
  `${(byDisplay['Pune'] || []).join(' | ')} = ${entryRows('Pune')} rows`);

// ── The rename chains TOURN_COMMON did not know about. ────────────────────
ok('Santiago is one event across four sponsors',
  (byDisplay['Santiago'] || []).length === 4 && entryRows('Santiago') === 325,
  (byDisplay['Santiago'] || []).join(' | '));
ok('Delray Beach absorbs International Championships',
  (byDisplay['Delray Beach'] || []).includes('International Championships') && entryRows('Delray Beach') === 472,
  `${entryRows('Delray Beach')} rows`);
ok('Estoril absorbs Portugal Open', (byDisplay['Estoril'] || []).includes('Portugal Open'),
  (byDisplay['Estoril'] || []).join(' | '));
// Astana is held ON PURPOSE — a city change, not a sponsor change, and unruled.
ok('Astana Open is still its own entry, pending the city-change ruling',
  (byDisplay['Astana Open'] || []).length === 1 && !((byDisplay['Almaty'] || []).includes('Astana Open')),
  'held, not merged on our own initiative');

// ── The resolution layer takes the SET. ───────────────────────────────────
ok('filteredRows() matches on membership, not indexOf against one string',
  /var\s+_names\s*=\s*Array\.isArray\(state\.tournament\)/.test(html) && /tSet\.indexOf\(r\[4\]\)/.test(html),
  'array -> tSet -> membership');
ok('the picker hands it the SET, not a string',
  /onPick:function\(names\)\{[\s\S]{0,400}state\.tournament=Array\.isArray\(names\)\?names\.slice\(\):\[names\]/.test(html),
  'onPick stores an array');
ok('...and the picker offers one row per CATALOG ENTRY, not per archive string',
  /var hits=tournCatalog\(\)/.test(html) && !/var hits=M\.tournaments\.map/.test(html),
  'hits come from tournCatalog()');
ok('the selected row cannot be compared by identity against a set',
  /selectedByLabel/.test(html), 'searchField compares on label for this picker');

// ── The typos are corrected AT SOURCE and cannot come back. ───────────────
const mirror = fs.readFileSync(path.join(ROOT, 'mirror-odds-archive.py'), 'utf8');
ok('neither upstream typo survives in the archive',
  !T.includes("U.S.Men's Clay Court Championships") && !T.includes('Millenium Estoril Open'),
  'both absent from database-yield.json');
ok('...and the mirror re-applies the correction, so a refresh cannot revert it',
  /^TOURNAMENT_NAME_FIXUPS = \{/m.test(mirror)
    && /U\.S\.Men's Clay Court Championships/.test(mirror)
    && /Millenium Estoril Open/.test(mirror)
    && /normalize_tournament\(r\.get\('tournament'/.test(mirror),
  'fixup table applied in write_season');
ok('...and the corrected spellings are the ones that survived',
  T.includes("U.S. Men's Clay Court Championships") && T.includes('Millennium Estoril Open'));

// ── The unreachable branch is gone. ───────────────────────────────────────
ok('the dead `occasion` branch is removed',
  !/qt\.occasion/.test(html), 'no record in tournament-quotes.json has ever carried one');

console.log(`\ntest-ten242-catalog: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

/* MUTATIONS RUN TO PROVE THIS SUITE CAN FAIL — results are the measured ones.
 *
 *  M1  tournCatalog(): `var disp = t;` — key on the archive string, the exact
 *      regression the ruling forbids.                    -> 16 assertions red
 *  M2  tournCatalog(): TOURN_SPLIT ignored — the four co-occurring pairs fold
 *      back under their venue name.                      ->  5 assertions red
 *  M3  onPick reverted to `state.tournament=names`.      ->  1 assertion  red
 *  M4  the fixup table renamed out of mirror-odds-archive.py.
 *                                                        ->  1 assertion  red
 *      (Deliberately still 1: the archive assertion keeps passing, which is the
 *      point — a clean archive with no fixup is one mirror run from dirty again.)
 *
 * THE FIRST CUT OF THIS FILE FAILED THIS BAR. It rebuilt the grouping from the
 * parsed maps instead of running tournCatalog(), so M1, M2 and M4 all SURVIVED
 * while it reported 27/27. Score from the "N passed, N failed" line, never by
 * grepping for FAIL: a suite that crashes prints no FAIL lines either and reads
 * as "mutation survived" when it is really "test did not run".
 */
