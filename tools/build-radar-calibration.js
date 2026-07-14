#!/usr/bin/env node
'use strict';
// =============================================================================
// Task 11 — Player-DNA radar recalibration, Part 1: the percentile engine.
//
// Builds an EMPIRICAL calibration from the Match Charting Project (MCP), the
// only open dataset with real, hand-charted per-shot data for the ATP tour.
// Instead of the pipeline's old hand-set linear bounds (see computeDnaScores in
// bsp-pipeline.js), each of the six radar axes is scored as a real percentile
// against the actual distribution of charted men — so "80 on Serve" means
// "serves better than 80% of charted players", not an arbitrary rescale.
//
// Output artifact: radar-calibration.json
//   .axes[axis].breakpoints  → 101 quantiles (p0..p100) of the population; the
//                              pipeline maps a player's raw metric → percentile
//                              by linear interpolation between breakpoints.
//   .players[normName]       → each player's six raw metrics, matches charted,
//                              percentile radar, and a data-sufficiency flag.
//
// Honesty constraints (carried from the task spec + prior feasibility notes):
//   - Movement is NOT measured by MCP (it is shot-charting, not player
//     tracking). We ship it as an explicit long-rally (7+ shot) win-rate PROXY
//     and label the axis "Movement / Defense". Never presented as tracking.
//   - Coverage is the real constraint: a player under MIN_MATCHES charted is
//     flagged `sufficient:false` so the UI can degrade (grey out / hide the
//     radar) rather than draw a confident shape from 2 matches.
//
// Usage:  RADAR_MCP_DIR=/path/to/mcp node tools/build-radar-calibration.js
//         (defaults to /tmp/mcp-sparse; needs charting-m-stats-*.csv)
// =============================================================================

const fs = require('fs');
const path = require('path');

const MCP_DIR = process.env.RADAR_MCP_DIR || '/tmp/mcp-sparse';
const OUT = path.join(__dirname, '..', 'radar-calibration.json');

// A player needs at least this many charted matches for their radar to count as
// reliable — both for inclusion in the population distribution and for the
// per-player `sufficient` flag the dashboard reads. Matches the 29/76 coverage
// finding: below this the shape is noise.
const MIN_MATCHES = 10;

const AXES = ['serve', 'return', 'baseline', 'netPlay', 'movement', 'clutch'];

// ---- tiny CSV reader. MCP fields carry no embedded commas (names use spaces,
// match_id uses hyphens/underscores), so a naive split is safe and fast here. --
function readCsv(name) {
  const p = path.join(MCP_DIR, name);
  if (!fs.existsSync(p)) throw new Error(`missing MCP file: ${p}`);
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  const header = lines[0].split(',');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = lines[i].split(',');
    const o = {};
    for (let c = 0; c < header.length; c++) o[header[c]] = cells[c];
    rows.push(o);
  }
  return rows;
}

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Normalized join key: lower-cased, accent-stripped full name. The pipeline
// resolves its abbreviated "J. Sinner" display names to this key on the Part 2
// join; the artifact itself is always keyed by MCP's full "Jannik Sinner".
function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

// Per-player running sums for each axis's pooled rate (sum-of-numerators over
// sum-of-denominators — the statistically correct pooling, not a mean of
// per-match percentages), plus the set of matches they appear in.
function bucket() {
  return {
    display: null,
    matchIds: new Set(),
    serve_num: 0, serve_den: 0,       // (first_won+second_won) / serve_pts
    return_num: 0, return_den: 0,     // return_pts_won / return_pts
    base_num: 0, base_den: 0,         // winners / (winners+unforced)
    clutch_num: 0, clutch_den: 0,     // bp_saved / bk_pts
    net_num: 0, net_den: 0,           // net pts_won / net_pts
    move_num: 0, move_den: 0,         // long-rally (7+ shot) won / pts
  };
}

const players = new Map();
function get(name) {
  const k = normName(name);
  if (!k) return null;
  let b = players.get(k);
  if (!b) { b = bucket(); b.display = name; players.set(k, b); }
  return b;
}

// ---- Overview: Serve, Return, Baseline, Clutch (set=='Total' rows) ----------
for (const r of readCsv('charting-m-stats-Overview.csv')) {
  if (r.set !== 'Total') continue;
  const b = get(r.player); if (!b) continue;
  b.matchIds.add(r.match_id);
  const servePts = num(r.serve_pts);
  if (servePts > 0) {
    b.serve_num += num(r.first_won) + num(r.second_won);
    b.serve_den += servePts;
  }
  const retPts = num(r.return_pts);
  if (retPts > 0) { b.return_num += num(r.return_pts_won); b.return_den += retPts; }
  const decisive = num(r.winners) + num(r.unforced);
  if (decisive > 0) { b.base_num += num(r.winners); b.base_den += decisive; }
  const bk = num(r.bk_pts);
  if (bk > 0) { b.clutch_num += num(r.bp_saved); b.clutch_den += bk; }
}

// ---- Net play: NetPoints 'NetPoints' row → pts_won / net_pts -----------------
for (const r of readCsv('charting-m-stats-NetPoints.csv')) {
  if (r.row !== 'NetPoints') continue;
  const b = players.get(normName(r.player)); if (!b) continue;
  const np = num(r.net_pts);
  if (np > 0) { b.net_num += num(r.pts_won); b.net_den += np; }
}

// ---- Movement PROXY: long-rally (7-9 and 10+ shot) win rate ------------------
// Rally.csv is server(pl1)/returner(pl2)-oriented; a player earns rows as both.
// Long rallies = rows '7-9' and '10'. Endurance/defense proxy, NOT tracking.
const LONG = new Set(['7-9', '10']);
for (const r of readCsv('charting-m-stats-Rally.csv')) {
  if (!LONG.has(r.row)) continue;
  const pts = num(r.pts);
  if (pts <= 0) continue;
  const server = players.get(normName(r.server));
  if (server) { server.move_num += num(r.pl1_won); server.move_den += pts; }
  const returner = players.get(normName(r.returner));
  if (returner) { returner.move_num += num(r.pl2_won); returner.move_den += pts; }
}

// ---- Raw metric per axis (null when that axis has no denominator) ------------
function metrics(b) {
  const rate = (n, d) => d > 0 ? n / d : null;
  return {
    serve: rate(b.serve_num, b.serve_den),
    return: rate(b.return_num, b.return_den),
    baseline: rate(b.base_num, b.base_den),
    netPlay: rate(b.net_num, b.net_den),
    movement: rate(b.move_num, b.move_den),
    clutch: rate(b.clutch_num, b.clutch_den),
  };
}

// ---- Population distributions (players with >= MIN_MATCHES only) -------------
const pops = {}; AXES.forEach(a => pops[a] = []);
for (const b of players.values()) {
  if (b.matchIds.size < MIN_MATCHES) continue;
  const m = metrics(b);
  for (const a of AXES) if (m[a] != null) pops[a].push(m[a]);
}
for (const a of AXES) pops[a].sort((x, y) => x - y);

// 101 quantile breakpoints (p0..p100) — compact, exact enough for interpolation.
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

// Percentile of a value against a breakpoint ladder (mirrors the pipeline side).
function pct(value, bp) {
  if (value == null || !bp) return null;
  if (value <= bp[0]) return 0;
  if (value >= bp[100]) return 100;
  for (let i = 1; i <= 100; i++) {
    if (value <= bp[i]) {
      const span = bp[i] - bp[i - 1] || 1;
      return Math.round(i - 1 + (value - bp[i - 1]) / span);
    }
  }
  return 100;
}

const axesOut = {};
for (const a of AXES) axesOut[a] = { n: pops[a].length, breakpoints: breakpoints(pops[a]) };

// ---- Per-player radar (percentile per axis) + sufficiency --------------------
const playersOut = {};
for (const [k, b] of players.entries()) {
  const m = metrics(b);
  const radar = {};
  for (const a of AXES) radar[a] = pct(m[a], axesOut[a].breakpoints);
  playersOut[k] = {
    name: b.display,
    matches: b.matchIds.size,
    sufficient: b.matchIds.size >= MIN_MATCHES,
    raw: m,
    radar,
  };
}

const totalPlayers = players.size;
const sufficientPlayers = [...players.values()].filter(b => b.matchIds.size >= MIN_MATCHES).length;

const out = {
  meta: {
    source: 'Match Charting Project (charting-m-stats-*.csv), men\'s singles',
    generatedFromDir: MCP_DIR,
    minMatches: MIN_MATCHES,
    axes: AXES,
    totalPlayers,
    sufficientPlayers,
    notes: {
      movement: 'PROXY only — long-rally (7+ shot) win rate. MCP has no player-tracking data. Render axis as "Movement / Defense".',
      sufficiency: `Players with < ${MIN_MATCHES} charted matches are sufficient:false — UI must degrade the radar for them.`,
      pooling: 'Rates are pooled (sum numerators / sum denominators), not a mean of per-match percentages.',
    },
  },
  axes: axesOut,
  players: playersOut,
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 0));
console.log(`radar-calibration.json written: ${totalPlayers} players (${sufficientPlayers} with >=${MIN_MATCHES} matches).`);
