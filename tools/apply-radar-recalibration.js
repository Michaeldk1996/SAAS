#!/usr/bin/env node
'use strict';
// =============================================================================
// Task 11 — Player-DNA recalibration, Parts 2/2b/3 (the injector).
//
// Reads the empirical Match Charting Project (MCP) calibration built by
// build-radar-calibration.js and folds it into player-profiles.json (the file
// the dashboard actually fetches), WITHOUT a full pipeline re-run:
//
//   Part 2  — replace each matched player's dna.All (all six axes) with the real
//             MCP percentile radar; flag dnaSource / dnaSufficiency so the UI can
//             degrade (grey "limited data") for under-charted players instead of
//             drawing a confident shape from 2 matches.
//   Part 2b — derive a single playing-style archetype from the six percentiles.
//   Part 3  — emit tour-wide card benchmarks (median + percentile ladder) for the
//             Serve / Return & rally stat cards, computed from the SAME MCP pool
//             (Overview.csv), so a player at tour median shows a mid-length bar.
//
// Honesty: Movement is an explicit long-rally PROXY (see build tool); Break
// Points Converted is NOT derivable from Overview alone, so it is intentionally
// omitted from cardBenchmarks and the card keeps its existing (non-MCP) render.
//
// Usage:  RADAR_MCP_DIR=/tmp/mcp-sparse node tools/apply-radar-recalibration.js
// Idempotent: re-reads profiles + calibration each run and overwrites the
// injected fields.
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MCP_DIR = process.env.RADAR_MCP_DIR || '/tmp/mcp-sparse';
const PROFILES = path.join(ROOT, 'player-profiles.json');
const CAL = path.join(ROOT, 'radar-calibration.json');
const MIN_MATCHES = 10;

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
function normName(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

// ---- MCP Overview → per-player card-stat accumulators ----------------------
function readCsv(name) {
  const p = path.join(MCP_DIR, name);
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  const header = lines[0].split(',');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = lines[i].split(',');
    const o = {}; for (let c = 0; c < header.length; c++) o[header[c]] = cells[c];
    rows.push(o);
  }
  return rows;
}

const acc = new Map(); // normName -> sums
function bucket() {
  return { matchIds: new Set(), aces: 0, serve_pts: 0, first_in: 0, first_won: 0,
    second_in: 0, second_won: 0, bk_pts: 0, bp_saved: 0, return_pts: 0,
    return_pts_won: 0, winners: 0, points: 0 };
}
for (const r of readCsv('charting-m-stats-Overview.csv')) {
  if (r.set !== 'Total') continue;
  const k = normName(r.player); if (!k) continue;
  let b = acc.get(k); if (!b) { b = bucket(); acc.set(k, b); }
  b.matchIds.add(r.match_id);
  b.aces += num(r.aces); b.serve_pts += num(r.serve_pts);
  b.first_in += num(r.first_in); b.first_won += num(r.first_won);
  b.second_in += num(r.second_in); b.second_won += num(r.second_won);
  b.bk_pts += num(r.bk_pts); b.bp_saved += num(r.bp_saved);
  b.return_pts += num(r.return_pts); b.return_pts_won += num(r.return_pts_won);
  b.winners += num(r.winners);
  b.points += num(r.serve_pts) + num(r.return_pts);
}

// Card stat definitions: key (matches dashboard PP_*_DEFS) -> per-player value.
// Break Points Converted is deliberately absent (not derivable from Overview).
const CARD_STATS = {
  'Service:Aces':                 b => b.matchIds.size ? b.aces / b.matchIds.size : null,
  'Service:1st Serve Points Won': b => b.first_in ? b.first_won / b.first_in * 100 : null,
  'Service:2nd Serve Points Won': b => b.second_in ? b.second_won / b.second_in * 100 : null,
  'Service:Break Points Saved':   b => b.bk_pts ? b.bp_saved / b.bk_pts * 100 : null,
  'Points:Return Points Won':     b => b.return_pts ? b.return_pts_won / b.return_pts * 100 : null,
  'Points:Service Points Won':    b => b.serve_pts ? (b.first_won + b.second_won) / b.serve_pts * 100 : null,
  'Points:Winners':               b => b.points ? b.winners / b.points * 100 : null,
};

function breakpoints(sorted) {
  if (!sorted.length) return null;
  const bp = [];
  for (let q = 0; q <= 100; q++) {
    const idx = (q / 100) * (sorted.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx), f = idx - lo;
    bp.push(sorted[lo] * (1 - f) + sorted[hi] * f);
  }
  return bp;
}

const cardBenchmarks = {};
for (const [key, fn] of Object.entries(CARD_STATS)) {
  const pop = [];
  for (const b of acc.values()) {
    if (b.matchIds.size < MIN_MATCHES) continue;
    const v = fn(b); if (v != null) pop.push(v);
  }
  pop.sort((a, b) => a - b);
  const bp = breakpoints(pop);
  cardBenchmarks[key] = bp ? { n: pop.length, median: Math.round(bp[50] * 100) / 100, breakpoints: bp } : null;
}

// ---- calibration radar (6 axes) keyed by MCP normName ----------------------
const cal = JSON.parse(fs.readFileSync(CAL, 'utf8'));
const bySurname = new Map();
for (const [key, p] of Object.entries(cal.players)) {
  const toks = key.split(' ');
  const surname = toks[toks.length - 1];
  if (!bySurname.has(surname)) bySurname.set(surname, []);
  bySurname.get(surname).push({ key, first: toks[0], p });
}
// Abbreviated live display "J. M. Cerundolo" -> {initial, surname}
function parseAbbrev(disp) {
  const parts = normName(disp).split(' ').filter(Boolean);
  if (parts.length < 2) return null;
  return { initial: parts[0][0], surname: parts[parts.length - 1] };
}
function matchMcp(disp) {
  const ab = parseAbbrev(disp); if (!ab) return null;
  const cands = (bySurname.get(ab.surname) || []).filter(c => c.first[0] === ab.initial);
  if (!cands.length) return null;
  cands.sort((a, b) => b.p.matches - a.p.matches);
  return cands[0];
}

// ---- playing-style archetype from the six MCP percentiles ------------------
// Derived from the calibrated radar (per Task 11 Part 2b). Signals available
// from MCP: baseline = winners/(winners+unforced) percentile (a winners-vs-
// errors proxy), movement = long-rally win-rate percentile (grind/defense proxy
// standing in for rally length), plus serve/return/netPlay/clutch percentiles.
function deriveArchetype(r) {
  const s = r.serve ?? 50, ret = r.return ?? 50, base = r.baseline ?? 50,
    net = r.netPlay ?? 50, mov = r.movement ?? 50;
  if (s - ret >= 25 && s >= 60) return 'Serve-dominated';
  if (net >= 68 && base >= 58) return 'All-Court';
  if (ret >= 68 && mov >= 60 && net < 55) return 'Counterpuncher';
  if (base >= 68 && s >= 50 && mov < 60) return 'Aggressive Baseliner';
  return 'Baseliner';
}

// ---- fold into player-profiles.json ----------------------------------------
const profiles = JSON.parse(fs.readFileSync(PROFILES, 'utf8'));
const players = profiles.players || {};
let mcp = 0, thin = 0, none = 0;
const SURFACES = ['All', 'Hard', 'Clay', 'Grass'];

for (const p of Object.values(players)) {
  const hit = matchMcp(p.name);
  if (!hit) {
    p.dnaSource = 'none'; p.dnaSufficiency = 'none'; p.dnaMatches = 0; p.archetype = null;
    none++; continue;
  }
  p.dnaMatches = hit.p.matches;
  if (!hit.p.sufficient) {
    // matched but under-charted → keep existing (null) dna, flag limited data
    p.dnaSource = 'insufficient'; p.dnaSufficiency = 'thin'; p.archetype = null;
    thin++; continue;
  }
  // reliable MCP radar — career fingerprint (MCP is not surface-split, so the
  // same calibrated radar is shown regardless of the surface tab).
  const radar = hit.p.radar;
  if (!p.dna) p.dna = {};
  for (const surf of SURFACES) {
    p.dna[surf] = { serve: radar.serve, return: radar.return, baseline: radar.baseline,
      movement: radar.movement, netPlay: radar.netPlay, clutch: radar.clutch };
  }
  p.dnaSource = 'mcp'; p.dnaSufficiency = 'reliable';
  p.archetype = deriveArchetype(radar);
  mcp++;
}

profiles.radarCalibration = {
  source: cal.meta.source,
  minMatches: MIN_MATCHES,
  movementProxy: true,
  cardBenchmarks,
  coverage: { mcp, thin, none, total: Object.keys(players).length },
};

fs.writeFileSync(PROFILES, JSON.stringify(profiles));
console.log(`Injected radar recalibration: ${mcp} reliable / ${thin} thin / ${none} no-MCP (of ${Object.keys(players).length}).`);
console.log('cardBenchmarks:', Object.entries(cardBenchmarks).map(([k, v]) => `${k}=${v ? v.median : 'n/a'}`).join('  '));
