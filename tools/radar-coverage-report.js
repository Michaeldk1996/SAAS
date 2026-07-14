#!/usr/bin/env node
'use strict';
// Task 11 Part 1 — coverage check against the LIVE player universe.
// Joins the abbreviated display names in matches.json ("J. Sinner") to the
// MCP-keyed radar-calibration.json (full "Jannik Sinner") by surname + first
// initial, and reports how many current players actually have a reliable radar.
// This is the mandatory pre-UI coverage gate: it tells the dashboard how many
// of the 76 must fall back to a degraded / hidden radar.

const fs = require('fs');
const path = require('path');
const cal = require(path.join(__dirname, '..', 'radar-calibration.json'));
const matchesRaw = require(path.join(__dirname, '..', 'matches.json'));
const matches = Array.isArray(matchesRaw) ? matchesRaw : (matchesRaw.matches || matchesRaw.data || []);

const strip = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Abbreviated "J. M. Cerundolo" -> { initial:'j', surname:'cerundolo' }.
function parseAbbrev(disp) {
  const parts = strip(disp).replace(/\./g, '').split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const surname = parts[parts.length - 1];
  const initial = parts[0][0];
  return { initial, surname };
}

// Index MCP players by surname -> [{key, first, matches, sufficient}].
const bySurname = new Map();
for (const [key, p] of Object.entries(cal.players)) {
  const toks = strip(p.name).split(/\s+/).filter(Boolean);
  if (toks.length < 2) continue;
  const surname = toks[toks.length - 1];
  if (!bySurname.has(surname)) bySurname.set(surname, []);
  bySurname.get(surname).push({ key, first: toks[0], matches: p.matches, sufficient: p.sufficient });
}

const universe = new Map(); // display -> abbrev
for (const m of matches) { if (m.p1) universe.set(m.p1, parseAbbrev(m.p1)); if (m.p2) universe.set(m.p2, parseAbbrev(m.p2)); }

let matched = 0, sufficient = 0, thin = 0, none = 0;
const rows = [];
for (const [disp, ab] of universe.entries()) {
  let hit = null;
  if (ab) {
    const cands = (bySurname.get(ab.surname) || []).filter(c => c.first[0] === ab.initial);
    // pick the best-charted candidate on ties (most matches = the tour regular)
    cands.sort((a, b) => b.matches - a.matches);
    hit = cands[0] || null;
  }
  if (!hit) { none++; rows.push([disp, '—', 0, 'no MCP match']); continue; }
  matched++;
  if (hit.sufficient) { sufficient++; rows.push([disp, hit.key, hit.matches, 'reliable']); }
  else { thin++; rows.push([disp, hit.key, hit.matches, 'thin (<10)']); }
}

rows.sort((a, b) => b[2] - a[2]);
console.log(`\nLIVE universe: ${universe.size} players`);
console.log(`  reliable radar (>=${cal.meta.minMatches} charted): ${sufficient}`);
console.log(`  thin data (<10 charted):                 ${thin}`);
console.log(`  no MCP match at all:                     ${none}`);
console.log(`  => UI must DEGRADE ${thin + none}/${universe.size} players\n`);
console.log('player'.padEnd(22), 'mcp_key'.padEnd(24), 'm', 'state');
for (const r of rows) console.log(String(r[0]).padEnd(22), String(r[1]).padEnd(24), String(r[2]).padStart(3), r[3]);

fs.writeFileSync(path.join(__dirname, '..', 'radar-coverage.json'),
  JSON.stringify({ universe: universe.size, sufficient, thin, none, rows }, null, 0));
