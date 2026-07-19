// =================================================================
// 6-AXIS PLAYING-STYLE CLASSIFIER (ATP/Infosys-aligned)
// -----------------------------------------------------------------
// Layer 1: 6 radar dimensions, each scored 0-100 relative to the tour
//   (percentile within the qualified pool; 50 = tour-typical).
//   big_server, solid_baseliner, counter_puncher, all_court,
//   attacking_baseliner, solid_defender. Primary = top score;
//   hybrid label if 2nd is within 10 pts (max two labels).
// Layer 2: badges (inconsistent_attacker, pressure_player) from base data.
// Also recomputes matchup-matrix.json on the 6 primary labels.
//
// Base stats: Jeff Sackmann tennis_atp (Tennismylife/TML mirror).
// MCP (rally length + winner rate): Match Charting Project — R&D use only
//   (CC BY-NC-SA). Coverage collapses below the Top ~100, so MCP-dependent
//   axes are computed only where a player has >= MCP_MIN charted matches;
//   otherwise they fall back to the non-MCP components and are flagged partial.
//
// Outputs: playing-styles.json, matchup-matrix.json
// =================================================================
const fs = require('fs');
const path = require('path');

const TML_BASE = 'https://raw.githubusercontent.com/Tennismylife/TML-Database/master/';
const MCP_BASE = 'https://raw.githubusercontent.com/JeffSackmann/tennis_MatchChartingProject/master/';
const TML_CACHE = path.join(__dirname, 'tml-cache');
const MCP_CACHE = path.join(__dirname, 'mcp-cache');
const FROM_YEAR = 2000, TO_YEAR = 2026;    // widened from 2010 for a much larger match/player pool
const MIN_MATCHES = 20, MIN_SVPT = 400;   // base-stat reliability floor
const MCP_MIN = 10;                        // charted matches needed to trust rally/winner axes
const HYBRID_GAP = 10;                      // 2nd label within this many pts of the top
const MATRIX_MIN_N = 20;                    // matchup cell needs this many real matches
const ELITE_WINPCT = 65;                    // All-Court -> Elite gate
// Clay Specialist badge thresholds — a REAL clay specialist wins big on clay AND is
// clay-dependent (genuinely weak on hard), not just a big hitter who also wins on clay.
const CLAY_MIN_M = 40, CLAY_GAP = 14, CLAY_WR = 52, CLAY_HARD_MAX = 50;
// Elite All-Court roster verified by Michael (guarantees these even if win% dips, e.g. Wawrinka)
const ELITE_SEED = new Set(['djokovic', 'federer', 'nadal', 'alcaraz', 'sinner', 'murray', 'wawrinka']);
// Solid Defender seed (thin charting coverage -> not detectable on stats alone; Michael's list)
const SOLID_DEFENDER_SEED = new Set(['munar', 'moutet', 'nardi', 'assche', 'schwartzman', 'fery', 'navone']);

// 6 radar axes; the primary label adds a 7th (all_court_elite) split off from all_court.
const ARCH6 = ['big_server', 'solid_baseliner', 'counter_puncher', 'all_court', 'attacking_baseliner', 'solid_defender'];
const ARCH7 = ['big_server', 'solid_baseliner', 'counter_puncher', 'all_court', 'all_court_elite', 'attacking_baseliner', 'solid_defender'];
const ARCH_LABEL = {
  big_server: 'Big Server', solid_baseliner: 'Solid Baseliner', counter_puncher: 'Counter Puncher',
  all_court: 'All-Court Player', all_court_elite: 'All-Court Elite', attacking_baseliner: 'Attacking Baseliner', solid_defender: 'Solid Defender',
};
function lastName(nm){ const p = String(nm || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.\-]/g, ' ').trim().split(/\s+/); return p[p.length - 1] || ''; }

function deaccent(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function nameKey(name) {
  const p = deaccent(name).toLowerCase().replace(/&nbsp;/g, ' ').replace(/['’]/g, '').replace(/[.\-]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  return p.length < 2 ? null : p[p.length - 1] + '|' + p[0][0];
}
function n(v) { const x = parseFloat(v); return Number.isFinite(x) ? x : null; }
function surfaceOf(raw) { const s = String(raw || '').toLowerCase(); return s.includes('clay') ? 'clay' : s.includes('grass') ? 'grass' : s.includes('hard') ? 'hard' : 'other'; }

async function getCsv(url, cacheFile) {
  if (fs.existsSync(cacheFile) && fs.statSync(cacheFile).size > 0) return fs.readFileSync(cacheFile, 'utf8');
  const res = await fetch(url, { headers: { 'User-Agent': 'bsp-consult' } });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text || text.length < 50) return null;
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, text);
  return text;
}

const RETIRED = /\b(RET|W\/O|DEF|ABD|WALK|Walkover|Def)\b/i;
function parseScore(score, bestOf) {
  const out = { tbPlayed: 0, tbWonByWinner: 0, decPlayed: 0, decWonByWinner: 0 };
  if (!score) return out;
  const retired = RETIRED.test(score);
  const sets = [];
  for (const tok of score.trim().split(/\s+/)) {
    const hasParen = tok.includes('(');
    const m = tok.replace(/\(.*?\)/g, '').match(/^(\d+)-(\d+)$/);
    if (!m) continue;
    const w = +m[1], l = +m[2];
    sets.push({ w, l, tb: hasParen || (Math.max(w, l) === 7 && Math.min(w, l) === 6) });
  }
  for (const s of sets) if (s.tb) { out.tbPlayed++; if (s.w > s.l) out.tbWonByWinner++; }
  if (!retired && bestOf && ((bestOf === 3 && sets.length === 3) || (bestOf === 5 && sets.length === 5))) {
    out.decPlayed = 1; out.decWonByWinner = 1;
  }
  return out;
}

function newAgg(id, name) {
  return {
    id, name, matches: 0, wins: 0, losses: 0, upsetLosses: 0, top10w: 0,
    clayM: 0, clayW: 0, hardM: 0, hardW: 0,
    svpt: 0, ace: 0, df: 0, firstIn: 0, firstWon: 0, secondWon: 0, svGms: 0, breaksSuffered: 0,
    retPts: 0, retFirstWonBy: 0, ret2ndWonBy: 0, ret2ndPts: 0, retGms: 0, brkMade: 0, brkChances: 0,
    tbPlayed: 0, tbWon: 0, decPlayed: 0, decWon: 0,
    tourneys: new Map(),   // tourneyKey -> {w, l}
  };
}

function pctOf(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
  return arr.length ? lo / arr.length * 100 : 0;
}

(async () => {
  // ---- current-ATP identity map (name -> rank). Used to (a) pick display name/rank
  //      and (b) decide which classified players get written to playing-styles.json.
  //      Classification itself runs over EVERY qualified player so the matchup matrix
  //      can count matches against retired opponents too. ----
  const prof = require('./player-profiles.json').players;
  const currentInfo = new Map();
  for (const k in prof) { const nm = prof[k].name; if (!nm) continue; const nk = nameKey(nm); if (!nk) continue; if (!currentInfo.has(nk)) currentInfo.set(nk, { name: nm, rank: parseInt(prof[k].rank, 10) || 9999 }); }
  console.log(`Current-ATP: ${currentInfo.size} name keys.`);

  // ---- TML base stats + matches ----
  const byId = new Map();
  const allMatches = [];
  for (let y = FROM_YEAR; y <= TO_YEAR; y++) {
    const text = await getCsv(`${TML_BASE}${y}.csv`, path.join(TML_CACHE, `${y}.csv`));
    if (!text) { console.log(`  TML ${y}: missing`); continue; }
    const lines = text.split(/\r?\n/).filter(l => l.length);
    const H = lines[0].split(','); const ix = {}; H.forEach((h, i) => { ix[h] = i; });
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',');
      const wId = c[ix.winner_id], lId = c[ix.loser_id];
      if (!wId || !lId) continue;
      allMatches.push([wId, lId]);
      const surface = surfaceOf(c[ix.surface]);
      const wRank = n(c[ix.winner_rank]), lRank = n(c[ix.loser_rank]);
      const tourneyKey = (c[ix.tourney_id] || c[ix.tourney_name] || '') + ':' + String(c[ix.tourney_date] || '').slice(0, 4);
      const ps = parseScore(c[ix.score], parseInt(c[ix.best_of], 10) || null);
      const W = { svpt: n(c[ix.w_svpt]), ace: n(c[ix.w_ace]), df: n(c[ix.w_df]), firstIn: n(c[ix.w_1stIn]), firstWon: n(c[ix.w_1stWon]), secondWon: n(c[ix.w_2ndWon]), svGms: n(c[ix.w_SvGms]), bpFaced: n(c[ix.w_bpFaced]), bpSaved: n(c[ix.w_bpSaved]) };
      const L = { svpt: n(c[ix.l_svpt]), ace: n(c[ix.l_ace]), df: n(c[ix.l_df]), firstIn: n(c[ix.l_1stIn]), firstWon: n(c[ix.l_1stWon]), secondWon: n(c[ix.l_2ndWon]), svGms: n(c[ix.l_SvGms]), bpFaced: n(c[ix.l_bpFaced]), bpSaved: n(c[ix.l_bpSaved]) };
      let aw = byId.get(wId); if (!aw) { aw = newAgg(wId, c[ix.winner_name]); byId.set(wId, aw); }
      let al = byId.get(lId); if (!al) { al = newAgg(lId, c[ix.loser_name]); byId.set(lId, al); }
      accum(aw, W, L, true, surface, ps, tourneyKey, wRank, lRank);
      accum(al, L, W, false, surface, ps, tourneyKey, lRank, wRank);
    }
  }
  console.log(`TML: ${allMatches.length} matches, ${byId.size} players.`);

  function accum(a, me, op, won, surface, ps, tourneyKey, myRank, oppRank) {
    a.matches++; if (won) a.wins++; else a.losses++;
    if (!won && myRank != null && oppRank != null && oppRank >= myRank + 30) a.upsetLosses++;  // lost to a much lower-ranked player
    if (won && oppRank != null && oppRank <= 10) a.top10w++;                                     // beat a top-10 player (ceiling)
    if (surface === 'clay') { a.clayM++; if (won) a.clayW++; } else if (surface === 'hard') { a.hardM++; if (won) a.hardW++; }
    const t = a.tourneys.get(tourneyKey) || { w: 0, l: 0 }; if (won) t.w++; else t.l++; a.tourneys.set(tourneyKey, t);
    a.tbPlayed += ps.tbPlayed; a.tbWon += won ? ps.tbWonByWinner : (ps.tbPlayed - ps.tbWonByWinner);
    a.decPlayed += ps.decPlayed; a.decWon += won ? ps.decWonByWinner : (ps.decPlayed - ps.decWonByWinner);
    if (me.svpt && me.firstIn != null) {
      a.svpt += me.svpt; a.ace += me.ace || 0; a.df += me.df || 0; a.firstIn += me.firstIn;
      a.firstWon += me.firstWon || 0; a.secondWon += me.secondWon || 0; a.svGms += me.svGms || 0;
      a.breaksSuffered += Math.max(0, (me.bpFaced || 0) - (me.bpSaved || 0));
    }
    if (op.svpt && op.firstIn != null) {
      a.retPts += op.svpt; a.retFirstWonBy += (op.firstIn - (op.firstWon || 0));
      const op2 = op.svpt - op.firstIn; a.ret2ndPts += op2; a.ret2ndWonBy += (op2 - (op.secondWon || 0));
      a.retGms += op.svGms || 0; a.brkChances += op.bpFaced || 0; a.brkMade += Math.max(0, (op.bpFaced || 0) - (op.bpSaved || 0));
    }
  }

  // ---- MCP: charted count, rally length, winner rate ----
  const mcp = new Map();  // key -> { charted, b13,b46,b79,b10, winners, pts }
  const mcpGet = k => { let m = mcp.get(k); if (!m) { m = { charted: 0, b13: 0, b46: 0, b79: 0, b10: 0, winners: 0, pts: 0 }; mcp.set(k, m); } return m; };
  // charted match counts
  {
    const t = await getCsv(`${MCP_BASE}charting-m-matches.csv`, path.join(MCP_CACHE, 'matches.csv'));
    if (t) { const L = t.split(/\r?\n/).filter(Boolean); for (let i = 1; i < L.length; i++) { const c = L[i].split(','); for (const nm of [c[1], c[2]]) { const k = nameKey(nm); if (k) mcpGet(k).charted++; } } }
  }
  // rally length (top-level buckets, per match, attributed to both players)
  {
    const t = await getCsv(`${MCP_BASE}charting-m-stats-Rally.csv`, path.join(MCP_CACHE, 'rally.csv'));
    if (t) {
      const L = t.split(/\r?\n/).filter(Boolean); const H = L[0].split(','); const ix = {}; H.forEach((h, i) => ix[h] = i);
      const perMatch = new Map(); // match_id -> {names:Set, b13,b46,b79,b10}
      for (let i = 1; i < L.length; i++) {
        const c = L[i].split(','); const bucket = c[ix.row];
        if (!['1-3', '4-6', '7-9', '10'].includes(bucket)) continue;
        const mid = c[ix.match_id]; let e = perMatch.get(mid); if (!e) { e = { names: new Set([c[ix.server], c[ix.returner]]), b13: 0, b46: 0, b79: 0, b10: 0 }; perMatch.set(mid, e); }
        const pts = +c[ix.pts] || 0;
        if (bucket === '1-3') e.b13 += pts; else if (bucket === '4-6') e.b46 += pts; else if (bucket === '7-9') e.b79 += pts; else e.b10 += pts;
      }
      for (const e of perMatch.values()) for (const nm of e.names) { const k = nameKey(nm); if (!k) continue; const m = mcpGet(k); m.b13 += e.b13; m.b46 += e.b46; m.b79 += e.b79; m.b10 += e.b10; }
    }
  }
  // winner rate (Overview, Total rows: winners / total points)
  {
    const t = await getCsv(`${MCP_BASE}charting-m-stats-Overview.csv`, path.join(MCP_CACHE, 'overview.csv'));
    if (t) {
      const L = t.split(/\r?\n/).filter(Boolean); const H = L[0].split(','); const ix = {}; H.forEach((h, i) => ix[h] = i);
      for (let i = 1; i < L.length; i++) { const c = L[i].split(','); if (c[ix.set] !== 'Total') continue; const k = nameKey(c[ix.player]); if (!k) continue; const m = mcpGet(k); m.winners += (+c[ix.winners] || 0); m.pts += (+c[ix.serve_pts] || 0) + (+c[ix.return_pts] || 0); }
    }
  }
  console.log(`MCP: ${mcp.size} charted players.`);

  // ---- build a row for EVERY qualified player (by name key), current or retired ----
  const keyToIds = new Map();
  for (const [id, a] of byId) { const nk = nameKey(a.name); if (!nk) continue; (keyToIds.get(nk) || keyToIds.set(nk, []).get(nk)).push(id); }
  const rows = [];
  for (const [nk, ids] of keyToIds) {
    ids.sort((x, y) => byId.get(y).matches - byId.get(x).matches);
    const a = byId.get(ids[0]);
    if (a.matches < MIN_MATCHES || a.svpt < MIN_SVPT) continue;
    const meta = currentInfo.get(nk) || { name: a.name, rank: 9999 };
    // base rates
    const SPW = (a.firstWon + a.secondWon) / a.svpt;
    const RPW = a.retPts ? (a.retFirstWonBy + a.ret2ndWonBy) / a.retPts : 0;
    const m = mcp.get(nk) || { charted: 0, b13: 0, b46: 0, b79: 0, b10: 0, winners: 0, pts: 0 };
    const rallyPts = m.b13 + m.b46 + m.b79 + m.b10;
    const hasMcp = m.charted >= MCP_MIN && rallyPts > 0 && m.pts > 0;
    // per-tournament win% variance (tournaments with >=3 matches, in-season grouping already via year key)
    const tvals = []; for (const t of a.tourneys.values()) if (t.w + t.l >= 3) tvals.push(t.w / (t.w + t.l));
    const tourneyStd = tvals.length >= 3 ? Math.sqrt(tvals.reduce((s, v) => s + (v - tvals.reduce((x, y) => x + y, 0) / tvals.length) ** 2, 0) / tvals.length) : null;
    rows.push({
      nk, ids, isCurrent: currentInfo.has(nk), name: meta.name, rank: meta.rank, matches: a.matches,
      aceR: a.ace / a.svpt, firstInPct: a.firstIn / a.svpt, firstWonPct: a.firstIn ? a.firstWon / a.firstIn : 0,
      secondWonPct: (a.svpt - a.firstIn) ? a.secondWon / (a.svpt - a.firstIn) : 0,
      dfR: a.df / a.svpt, holdPct: a.svGms ? (1 - a.breaksSuffered / a.svGms) : 0,
      SPW, RPW, TPW: (a.svpt + a.retPts) ? ((a.firstWon + a.secondWon) + (a.retFirstWonBy + a.ret2ndWonBy)) / (a.svpt + a.retPts) : 0,
      DR: SPW < 1 ? RPW / (1 - SPW) : 0, breakPct: a.retGms ? a.brkMade / a.retGms : 0,
      tbWin: a.tbPlayed >= 10 ? a.tbWon / a.tbPlayed : null, bpConv: a.brkChances >= 50 ? a.brkMade / a.brkChances : null,
      decWin: a.decPlayed >= 8 ? a.decWon / a.decPlayed : null,
      upsetRate: a.losses >= 10 ? a.upsetLosses / a.losses : null, tourneyStd,
      winPct: a.matches ? a.wins / a.matches * 100 : 0, top10Rate: a.matches ? a.top10w / a.matches : 0,
      clayM: a.clayM, clayWr: a.clayM ? a.clayW / a.clayM * 100 : null, hardWr: a.hardM ? a.hardW / a.hardM * 100 : null,
      hasMcp, mcpCharted: m.charted,
      rallyLen: hasMcp ? (2 * m.b13 + 5 * m.b46 + 8 * m.b79 + 12 * m.b10) / rallyPts : null,
      winnerRate: hasMcp ? m.winners / m.pts : null,
    });
  }
  console.log(`Classified: ${rows.length} players (${rows.filter(r => r.isCurrent).length} current-ATP, rest retired/historical for the matrix).`);

  // ---- percentile helpers ----
  // Normalise against the CURRENT-ATP field only, so displayed radar scores + badges
  // are relative to today's tour (unchanged from before this pool expansion). Retired
  // players are scored against those same current-tour cutoffs purely to assign them a
  // primary label for the matrix — they are never displayed.
  const sortNum = a => a.slice().sort((x, y) => x - y);
  const currentRows = rows.filter(r => r.isCurrent);
  const cols = {};
  for (const key of ['aceR', 'firstInPct', 'firstWonPct', 'secondWonPct', 'dfR', 'holdPct', 'RPW', 'TPW', 'DR', 'breakPct', 'rallyLen', 'winnerRate', 'tbWin', 'bpConv', 'decWin', 'upsetRate', 'tourneyStd', 'top10Rate']) {
    cols[key] = sortNum(currentRows.map(r => r[key]).filter(v => v != null));
  }
  const P = (key, v) => v == null ? null : pctOf(cols[key], v);      // 0-100 percentile
  const Pi = (key, v) => v == null ? null : 100 - pctOf(cols[key], v); // inverted

  // ---- Layer 1: dimension scores ----
  for (const r of rows) {
    r.scores = {};
    r.partial = {};
    r.scores.big_server = 0.40 * P('aceR', r.aceR) + 0.20 * P('firstInPct', r.firstInPct) + 0.40 * P('firstWonPct', r.firstWonPct);
    r.scores.solid_baseliner = 0.30 * P('holdPct', r.holdPct) + 0.20 * Pi('dfR', r.dfR) + 0.30 * P('DR', r.DR) + 0.20 * P('TPW', r.TPW);
    // counter puncher: RPW 40, Brk 35, rally(long) 25
    if (r.hasMcp) r.scores.counter_puncher = 0.40 * P('RPW', r.RPW) + 0.35 * P('breakPct', r.breakPct) + 0.25 * P('rallyLen', r.rallyLen);
    else { r.scores.counter_puncher = (0.40 * P('RPW', r.RPW) + 0.35 * P('breakPct', r.breakPct)) / 0.75; r.partial.counter_puncher = true; }
    // attacking baseliner: rally(short) 35, RPW 30, 2nd% 35
    if (r.hasMcp) r.scores.attacking_baseliner = 0.35 * Pi('rallyLen', r.rallyLen) + 0.30 * P('RPW', r.RPW) + 0.35 * P('secondWonPct', r.secondWonPct);
    else { r.scores.attacking_baseliner = (0.30 * P('RPW', r.RPW) + 0.35 * P('secondWonPct', r.secondWonPct)) / 0.65; r.partial.attacking_baseliner = true; }
    // solid defender: RPW 30, Hld 25, rally(long) 25, winner(inv) 20
    if (r.hasMcp) r.scores.solid_defender = 0.30 * P('RPW', r.RPW) + 0.25 * P('holdPct', r.holdPct) + 0.25 * P('rallyLen', r.rallyLen) + 0.20 * Pi('winnerRate', r.winnerRate);
    else { r.scores.solid_defender = (0.30 * P('RPW', r.RPW) + 0.25 * P('holdPct', r.holdPct)) / 0.55; r.partial.solid_defender = true; }
  }
  const SPEC5 = ['big_server', 'solid_baseliner', 'counter_puncher', 'attacking_baseliner', 'solid_defender'];
  for (const r of rows) {
    // Round the 5 specialised scores first.
    for (const k of SPEC5) r.scores[k] = Math.max(0, Math.min(100, Math.round(r.scores[k])));
    // All-Court radar score: an ABSOLUTE balance-and-strength score (mean minus a spread
    // penalty), NOT a percentile — so a spiky profile scores low here instead of topping out.
    const five = SPEC5.map(k => r.scores[k]);
    const mean = five.reduce((s, v) => s + v, 0) / 5;
    const std = Math.sqrt(five.reduce((s, v) => s + (v - mean) ** 2, 0) / 5);
    r.scores.all_court = Math.max(0, Math.min(100, Math.round(mean - 1.5 * std)));
    // Label: All-Court primary only when the player is strong AND has no dominant trait
    // (top-3 specialised all high and close together). Otherwise the strongest specialised
    // wing is primary, with a hybrid second if it is within HYBRID_GAP. This matches the ATP's
    // "comfortable everywhere, no single dominant trait" definition rather than letting a
    // derived balance score out-magnitude genuine specialists.
    const spec = SPEC5.map(k => [k, r.scores[k]]).sort((a, b) => b[1] - a[1]);
    const top3mean = (spec[0][1] + spec[1][1] + spec[2][1]) / 3;
    const spread = spec[0][1] - spec[2][1];
    const ln = lastName(r.name);
    if (ELITE_SEED.has(ln)) {
      // Michael's verified generational all-courters — forced, even if their profile is spiky.
      r.primary = 'all_court_elite';
      r.archetype_label = 'All-Court Elite / ' + ARCH_LABEL[spec[0][0]];
    } else if (SOLID_DEFENDER_SEED.has(ln)) {
      // Grinding defenders whose game isn't detectable from stats alone (thin charting) — seeded from Michael's list.
      r.primary = 'solid_defender';
      r.archetype_label = 'Solid Defender';
    } else if (top3mean >= 72 && spread <= 12) {
      // All-Court — strong AND no dominant trait. Split Elite (the very best) from regular.
      const elite = r.winPct >= ELITE_WINPCT;
      r.primary = elite ? 'all_court_elite' : 'all_court';
      r.archetype_label = (elite ? 'All-Court Elite / ' : 'All-Court Player / ') + ARCH_LABEL[spec[0][0]];
    } else {
      r.primary = spec[0][0];
      const labels = [ARCH_LABEL[spec[0][0]]];
      if (spec[1][1] >= spec[0][1] - HYBRID_GAP) labels.push(ARCH_LABEL[spec[1][0]]);
      r.archetype_label = labels.join(' / ');
    }
    r.coverage = r.hasMcp ? 'full' : 'partial';
    r.reliableLabel = true;   // relaxed: every classified player's matches now count toward the matrix
  }

  // ---- Layer 2: badges ----
  const pressureVals = rows.map(r => (r.tbWin != null && r.bpConv != null && r.decWin != null) ? (0.40 * P('tbWin', r.tbWin) + 0.35 * P('bpConv', r.bpConv) + 0.25 * P('decWin', r.decWin)) : null);
  rows.forEach((r, i) => {
    r.badges = [];
    const pv = pressureVals[i];
    r.pressureScore = pv == null ? null : Math.round(pv);
    if (pv != null && pv >= 65) r.badges.push('pressure_player');   // top-third under pressure
    // Clay Specialist: wins dramatically more on clay than hard, over a real clay sample.
    if (r.clayM >= CLAY_MIN_M && r.clayWr != null && r.hardWr != null && (r.clayWr - r.hardWr) >= CLAY_GAP && r.clayWr >= CLAY_WR && r.hardWr <= CLAY_HARD_MAX) r.badges.push('clay_specialist');
    // High Risk / High Reward: high ceiling (beats the very best) AND high volatility (loses to
    // far-lower-ranked players, or swings wildly tournament to tournament). Both are required, so a
    // consistent grinder with a tough schedule (high upset rate alone) is NOT flagged.
    const upsetPct = r.upsetRate != null ? pctOf(cols.upsetRate, r.upsetRate) : 0;
    const stdPct = r.tourneyStd != null ? pctOf(cols.tourneyStd, r.tourneyStd) : 0;
    // Genuine ceiling (beats the very best) but UNDERACHIEVES on results = boom-or-bust. Upset-loss
    // rate is useless here (it just tracks rank — every top player's losses are to lower-ranked
    // players); the gap between a high top-10-win ceiling and a modest win% is what isolates the
    // erratic shot-makers (Bublik/Shapovalov/Zandschulp) from consistent top players (Fritz/De Minaur).
    if (pctOf(cols.top10Rate, r.top10Rate) >= 72 && r.winPct < 58) r.badges.push('high_risk_high_reward');
  });

  // ---- matchup matrix on 6 primaries (reliable labels only) ----
  const idToPrimary = new Map();
  for (const r of rows) if (r.reliableLabel) for (const id of r.ids) idToPrimary.set(id, r.primary);
  const winsByPair = {}; for (const A of ARCH7) { winsByPair[A] = {}; for (const B of ARCH7) winsByPair[A][B] = 0; }
  let matrixMatches = 0;
  for (const [wId, lId] of allMatches) { const aw = idToPrimary.get(wId), al = idToPrimary.get(lId); if (!aw || !al) continue; winsByPair[aw][al]++; matrixMatches++; }
  const matrix = {};
  for (const A of ARCH7) { matrix[A] = {}; for (const B of ARCH7) { if (A === B) { matrix[A][B] = null; continue; } const aw = winsByPair[A][B], bw = winsByPair[B][A], nAB = aw + bw; matrix[A][B] = { pct: nAB >= MATRIX_MIN_N ? +(aw / nAB * 100).toFixed(0) : null, n: nAB }; } }

  // ---- write outputs ----
  function avg(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
  // playing-styles.json holds only the current-ATP players (what the dashboard displays);
  // retired players were classified purely to enrich the matchup matrix above.
  const outRows = rows.filter(r => r.isCurrent).sort((a, b) => a.rank - b.rank);
  const stylesOut = {
    generatedAt: new Date().toISOString(),
    source: 'tennis_atp (TML mirror) + Match Charting Project (rally/winner, R&D use only)',
    window: `${FROM_YEAR}-${TO_YEAR}`,
    note: 'Each axis is a 0-100 percentile within the full classified field (50 = typical). MCP-dependent axes (counter/attacking/defender) fall back to base components and are flagged partial when a player has < ' + MCP_MIN + ' charted matches.',
    tourAverage: 50, mcpMinCharted: MCP_MIN,
    players: outRows.map(r => ({
      name: r.name, rank: r.rank, primary: r.primary, archetype_label: r.archetype_label,
      archetype_scores: r.scores, archetype_data_coverage: r.coverage,
      partial_axes: Object.keys(r.partial), badges: r.badges,
      pressure_score: r.pressureScore, mcp_charted: r.mcpCharted,
      win_pct: +r.winPct.toFixed(1), clay_wr: r.clayWr == null ? null : +r.clayWr.toFixed(0), hard_wr: r.hardWr == null ? null : +r.hardWr.toFixed(0),
    })),
  };
  writeAtomic('playing-styles.json', stylesOut);
  console.log(`Wrote playing-styles.json (${outRows.length} current players).`);

  const matrixOut = {
    generatedAt: new Date().toISOString(),
    source: 'Computed from BSP 6-axis classification x TML match results',
    window: `${FROM_YEAR}-${TO_YEAR}`,
    note: 'Win% of row archetype (primary label) vs column, over matches where both players have a reliably-determined primary label. Cells below the sample floor show n but no pct.',
    minSampleN: MATRIX_MIN_N, matchesCounted: matrixMatches,
    archetypes: Object.fromEntries(ARCH7.map(k => [k, { en: ARCH_LABEL[k] }])),
    matrix,
  };
  writeAtomic('matchup-matrix.json', matrixOut);
  console.log(`Wrote matchup-matrix.json (${matrixMatches} matches on 7 primaries).`);

  // ---- console sanity (current-ATP players = what the dashboard shows) ----
  const counts = {}; outRows.forEach(r => counts[r.primary] = (counts[r.primary] || 0) + 1);
  console.log('\nPrimary archetype counts (current-ATP):'); for (const k of ARCH7) console.log(`  ${ARCH_LABEL[k].padEnd(20)} ${counts[k] || 0}`);
  const cov = { full: 0, partial: 0 }; outRows.forEach(r => cov[r.coverage]++); console.log(`Coverage: ${cov.full} full / ${cov.partial} partial`);
  console.log('Badges: pressure', outRows.filter(r => r.badges.includes('pressure_player')).length, '| clay', outRows.filter(r => r.badges.includes('clay_specialist')).length, '| highRisk', outRows.filter(r => r.badges.includes('high_risk_high_reward')).length);
  console.log('\nSpot-checks:');
  for (const nm of ['Djokovic', 'Alcaraz', 'Sinner', 'Medvedev', 'Opelka', 'De Minaur', 'Federer', 'Nadal']) { const r = rows.find(x => x.name.includes(nm)); if (r) console.log(`  ${nm.padEnd(10)} ${r.archetype_label.padEnd(38)} [${r.coverage}] badges:${r.badges.join(',') || '-'}  scores: BS${r.scores.big_server} SB${r.scores.solid_baseliner} CP${r.scores.counter_puncher} AC${r.scores.all_court} AB${r.scores.attacking_baseliner} SD${r.scores.solid_defender}`); }

  function writeAtomic(name, obj) { const dest = path.join(__dirname, name), tmp = dest + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj, null, 2)); fs.renameSync(tmp, dest); }
  function avg2() {}
})();

function avg(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
