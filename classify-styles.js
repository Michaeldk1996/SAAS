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
// All-Court Elite: current players qualify by TPW (Djokovic/Sinner/Alcaraz). Retired
// legends can't be reached by a current-tour threshold, so these are force-seeded AND
// surfaced in the output roster even though they are retired.
const ELITE_LEGENDS = new Set(['federer', 'nadal', 'murray']);
// Reference rosters (Michael's confirmed calibration anchors). Seeded as overrides because the
// lists carry genuine stylistic tensions (clay-leaners as Attacking, hard-courters as Defenders)
// that no single stat formula can fully separate; the formula classifies every NON-seeded player.
const SEED = {};
const seedArch = (arch, names) => names.forEach(x => { SEED[x] = arch; });
// NOTE: 'muller' (A. Muller) removed from big_server — his serve sits bottom-quintile
// (ace 20th pct, 1st-won 14th, hold 20th); he is a defender, not a big server.
seedArch('big_server', ['isner', 'raonic', 'karlovic', 'anderson', 'opelka', 'querrey', 'rinderknech', 'damm', 'perricard', 'quinn']);
seedArch('solid_baseliner', ['stricker']);
// Big serve + genuine baseline game (not pure serve-bots). Griekspoor/Diallo/Hurkacz/
// Berrettini/Halys added — all have top-decile serves + a real groundstroke game.
seedArch('big_server_baseliner', ['aliassime', 'shelton', 'fritz', 'bublik', 'mensik', 'soderling', 'korda', 'griekspoor', 'diallo', 'hurkacz', 'berrettini', 'halys']);
seedArch('attacking_baseliner', ['zverev', 'rublev', 'fils', 'tsitsipas', 'draper', 'rune', 'cerundolo', 'lehecka', 'cobolli', 'tiafoe', 'humbert', 'machac', 'ruud', 'musetti', 'fonseca', 'etcheverry', 'tabilo', 'darderi', 'molcan', 'sonego', 'khachanov', 'dimitrov', 'collignon', 'safiullin']);
// 'moutet' moved to solid_defender (weak serve, elite return, grinds) per review.
seedArch('counter_puncher', ['medvedev', 'tien', 'fokina', 'wu', 'fucsovics', 'giron', 'majchrzak', 'nishikori']);
seedArch('solid_defender', ['minaur', 'norrie', 'munar', 'nardi', 'assche', 'goffin', 'simon', 'schwartzman', 'wild', 'ymer', 'moutet', 'muller', 'basavareddy']);
seedArch('all_court', ['granollers', 'alboran', 'butvilas', 'schwaerzler', 'vasilev', 'sousa', 'turcanu', 'bennani', 'loutit', 'monnou']);
// High Risk / High Reward badge overrides. The natural formula (top-10 ceiling +
// upset variance + high unforced errors) captures the erratic shot-makers, but
// three reference must-includes (Monfils, Rune, Tiafoe) are NOT statistically
// erratic — their unforced-error rate sits at/below tour median — so they can
// only enter by seed. Fritz/De Minaur are disciplined (low error) and stay out
// naturally, but anti-seed guarantees it.
const HRHR_SEED = new Set(['monfils', 'rune']);
const HRHR_ANTI = new Set(['fritz', 'minaur', 'fils', 'tiafoe', 'shelton']);

// 8 primary archetypes (overhaul).
const ARCH8 = ['big_server', 'big_server_baseliner', 'attacking_baseliner', 'solid_baseliner', 'all_court_elite', 'counter_puncher', 'solid_defender', 'all_court'];
const ARCH_LABEL = {
  big_server: 'Big Server', big_server_baseliner: 'Big Server + Baseliner', attacking_baseliner: 'Attacking Baseliner',
  solid_baseliner: 'Solid Baseliner', all_court_elite: 'All-Court Elite', counter_puncher: 'Counter Puncher',
  solid_defender: 'Solid Defender', all_court: 'All-Court Player',
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
    id, name, matches: 0, wins: 0, losses: 0, upsetLosses: 0, upsetWins: 0, bigUpsetWins: 0,
    clayM: 0, clayW: 0, hardM: 0, hardW: 0, grassM: 0, grassW: 0,
    top10Opps: new Set(),   // distinct top-10 opponents beaten
    svpt: 0, ace: 0, df: 0, firstIn: 0, firstWon: 0, secondWon: 0, svGms: 0, breaksSuffered: 0,
    bpFacedSv: 0, bpSavedSv: 0,   // serve-side break points faced / saved (serve clutch)
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
      accum(aw, W, L, true, surface, ps, tourneyKey, wRank, lRank, lId);
      accum(al, L, W, false, surface, ps, tourneyKey, lRank, wRank, wId);
    }
  }
  console.log(`TML: ${allMatches.length} matches, ${byId.size} players.`);

  function accum(a, me, op, won, surface, ps, tourneyKey, myRank, oppRank, oppId) {
    a.matches++; if (won) a.wins++; else a.losses++;
    if (!won && myRank != null && oppRank != null && oppRank >= myRank + 50) a.upsetLosses++;  // lost to a player ranked 50+ spots below
    if (won && myRank != null && oppRank != null && oppRank <= myRank - 50) a.upsetWins++;      // beat a player ranked 50+ spots ABOVE (giant-killer)
    if (won && myRank != null && oppRank != null && oppRank <= myRank - 100) a.bigUpsetWins++;  // ...100+ spots above (huge upset)
    if (won && oppRank != null && oppRank <= 10 && oppId) a.top10Opps.add(oppId);                // distinct top-10 opponents beaten
    if (surface === 'clay') { a.clayM++; if (won) a.clayW++; }
    else if (surface === 'hard') { a.hardM++; if (won) a.hardW++; }
    else if (surface === 'grass') { a.grassM++; if (won) a.grassW++; }
    const t = a.tourneys.get(tourneyKey) || { w: 0, l: 0 }; if (won) t.w++; else t.l++; a.tourneys.set(tourneyKey, t);
    a.tbPlayed += ps.tbPlayed; a.tbWon += won ? ps.tbWonByWinner : (ps.tbPlayed - ps.tbWonByWinner);
    a.decPlayed += ps.decPlayed; a.decWon += won ? ps.decWonByWinner : (ps.decPlayed - ps.decWonByWinner);
    if (me.svpt && me.firstIn != null) {
      a.svpt += me.svpt; a.ace += me.ace || 0; a.df += me.df || 0; a.firstIn += me.firstIn;
      a.firstWon += me.firstWon || 0; a.secondWon += me.secondWon || 0; a.svGms += me.svGms || 0;
      a.breaksSuffered += Math.max(0, (me.bpFaced || 0) - (me.bpSaved || 0));
      a.bpFacedSv += me.bpFaced || 0; a.bpSavedSv += me.bpSaved || 0;
    }
    if (op.svpt && op.firstIn != null) {
      a.retPts += op.svpt; a.retFirstWonBy += (op.firstIn - (op.firstWon || 0));
      const op2 = op.svpt - op.firstIn; a.ret2ndPts += op2; a.ret2ndWonBy += (op2 - (op.secondWon || 0));
      a.retGms += op.svGms || 0; a.brkChances += op.bpFaced || 0; a.brkMade += Math.max(0, (op.bpFaced || 0) - (op.bpSaved || 0));
    }
  }

  // ---- MCP: charted count, rally length, winner rate ----
  const mcp = new Map();  // key -> { charted, b13,b46,b79,b10, winners, unforced, pts }
  const mcpGet = k => { let m = mcp.get(k); if (!m) { m = { charted: 0, b13: 0, b46: 0, b79: 0, b10: 0, winners: 0, unforced: 0, pts: 0 }; mcp.set(k, m); } return m; };
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
      for (let i = 1; i < L.length; i++) { const c = L[i].split(','); if (c[ix.set] !== 'Total') continue; const k = nameKey(c[ix.player]); if (!k) continue; const m = mcpGet(k); m.winners += (+c[ix.winners] || 0); m.unforced += (+c[ix.unforced] || 0); m.pts += (+c[ix.serve_pts] || 0) + (+c[ix.return_pts] || 0); }
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
    const m = mcp.get(nk) || { charted: 0, b13: 0, b46: 0, b79: 0, b10: 0, winners: 0, unforced: 0, pts: 0 };
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
      tbWin: a.tbPlayed >= 15 ? a.tbWon / a.tbPlayed : null, bpConv: a.brkChances >= 100 ? a.brkMade / a.brkChances : null,
      decWin: a.decPlayed >= 12 ? a.decWon / a.decPlayed : null,
      bpSave: a.bpFacedSv >= 100 ? a.bpSavedSv / a.bpFacedSv : null,
      tbPlayed: a.tbPlayed, tbWon: a.tbWon, brkChances: a.brkChances, brkMade: a.brkMade, decPlayed: a.decPlayed, decWon: a.decWon, bpFacedSv: a.bpFacedSv, bpSavedSv: a.bpSavedSv, matches: a.matches,
      upsetRate: a.losses >= 10 ? a.upsetLosses / a.losses : null, tourneyStd,
      upsetWins: a.upsetWins, bigUpsetWins: a.bigUpsetWins,
      upsetWinRate: a.matches >= 40 ? a.upsetWins / a.matches : null,   // giant-killer: share of matches that are 50-spot-up wins
      bigUpsetDensity: a.matches >= 60 ? a.bigUpsetWins / a.matches : null,  // density of huge (100-spot) upsets
      winPct: a.matches ? a.wins / a.matches * 100 : 0, top10Distinct: a.top10Opps.size,
      clayM: a.clayM, clayWr: a.clayM ? a.clayW / a.clayM * 100 : null, hardWr: a.hardM ? a.hardW / a.hardM * 100 : null,
      grassM: a.grassM, grassWr: a.grassM ? a.grassW / a.grassM * 100 : null,
      hasMcp, mcpCharted: m.charted,
      rallyLen: hasMcp ? (2 * m.b13 + 5 * m.b46 + 8 * m.b79 + 12 * m.b10) / rallyPts : null,
      winnerRate: hasMcp ? m.winners / m.pts : null, unforcedRate: hasMcp ? m.unforced / m.pts : null,
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
  // surface-lean helpers (per row) for the archetype filters
  for (const r of rows) {
    const fastAvg = (r.hardWr != null) ? ((r.hardWr + (r.grassWr != null ? r.grassWr : r.hardWr)) / 2) : null;
    r.fastBias = (fastAvg != null && r.clayWr != null) ? (fastAvg - r.clayWr) : null;
    r.clayVsHard = (r.clayWr != null && r.hardWr != null) ? (r.clayWr - r.hardWr) : null;
  }
  const sortNumCols = (key) => sortNum(currentRows.map(r => r[key]).filter(v => v != null));
  for (const key of ['aceR', 'firstInPct', 'firstWonPct', 'secondWonPct', 'dfR', 'holdPct', 'SPW', 'RPW', 'TPW', 'DR', 'breakPct', 'rallyLen', 'winnerRate', 'unforcedRate', 'tbWin', 'bpConv', 'bpSave', 'decWin', 'upsetRate', 'fastBias', 'clayVsHard']) {
    cols[key] = sortNumCols(key);
  }
  const P = (key, v) => v == null ? null : pctOf(cols[key], v);      // 0-100 percentile (50 = tour average)
  const Pi = (key, v) => v == null ? null : 100 - pctOf(cols[key], v);
  const medTPW = cols.TPW.length ? cols.TPW[Math.floor(cols.TPW.length / 2)] : 0.5;       // tour-average total-points-won (fraction)
  const grassMs = sortNum(currentRows.map(r => r.grassM));
  const grassM75 = grassMs.length ? grassMs[Math.floor(grassMs.length * 0.75)] : 0;        // 75th pct of grass matches played
  const grassM50 = grassMs.length ? grassMs[Math.floor(grassMs.length * 0.50)] : 0;        // median grass matches played

  // ---- 8-archetype dimension scores (0-100, calibrated to the reference lists) ----
  for (const r of rows) {
    r.scores = {}; r.partial = {};
    const aceP = P('aceR', r.aceR), rpwP = P('RPW', r.RPW), spwP = P('SPW', r.SPW), brkP = P('breakPct', r.breakPct),
      drP = P('DR', r.DR), holdP = P('holdPct', r.holdPct), tpwP = P('TPW', r.TPW), scndP = P('secondWonPct', r.secondWonPct),
      firstWonP = P('firstWonPct', r.firstWonPct), firstInP = P('firstInPct', r.firstInPct), dfInvP = Pi('dfR', r.dfR);

    const clayVsHardP = r.clayVsHard == null ? 50 : P('clayVsHard', r.clayVsHard);
    const rallyLongP = r.hasMcp ? P('rallyLen', r.rallyLen) : null;
    const winnerLowP = r.hasMcp ? Pi('winnerRate', r.winnerRate) : null;

    // 1 Big Server — measures the SERVE, not match outcomes: A%35 1stIn10 1st%35 hold20.
    // The old formula multiplied by 0.45 when a player's fast-surface WIN RATE didn't beat
    // clay by 8, which scored Mpetshi Perricard 38 and Kyrgios 39 (both 99th-pct on every
    // serve counter) below Thompson at 64. Win rate reflects opponent quality and draw, not
    // serve size, so it does not belong in a serve axis. Surface lean is expressed through
    // the Clay/Grass Specialist badges instead.
    let bs = 0.35 * aceP + 0.10 * firstInP + 0.35 * firstWonP + 0.20 * holdP;
    // Membership gate, on the serve itself: the label means a genuinely big serve, so it
    // needs a top-30% ace rate AND an above-median hold. Without a gate the axis alone wins
    // argmax for tour-median servers (Altmaier at 49 was landing here). This replaces the
    // win-rate gate it used to inherit — same exclusivity, measured on the right quantity.
    if (aceP < 70 || holdP < 50) bs *= 0.5;
    if (rpwP > 65) bs *= 0.8;                                        // an elite returner is a complete player, not a serve-bot
    r.scores.big_server = bs;

    // 2 Big Server + Baseliner — big serve AND complete both ways AND doesn't collapse on clay
    let bsbl = 0.22 * aceP + 0.15 * firstWonP + 0.16 * spwP + 0.16 * rpwP + 0.16 * holdP + 0.15 * drP;
    if (aceP < 55 || rpwP < 50 || spwP < 50) bsbl *= 0.5;            // needs genuine serve + above-avg on both sides
    if (r.clayVsHard != null && r.clayVsHard < -10) bsbl *= 0.7;     // drops off badly on clay -> pure big server, not this
    r.scores.big_server_baseliner = bsbl;

    // 3 Attacking Baseliner — dominant on serve AND return, aggressive, hard lean
    let ab = 0.22 * spwP + 0.22 * scndP + 0.16 * drP + 0.12 * rpwP + 0.10 * brkP + (r.hasMcp ? 0.18 * P('winnerRate', r.winnerRate) : 0.18 * firstWonP);
    if (r.clayVsHard != null && r.clayVsHard > 6) ab *= 0.9;        // clearly clay-better -> softer "attacking on fast" read
    r.scores.attacking_baseliner = ab;

    // 4 Solid Baseliner — Hold30 DFinv20 DR30 TPW20 (unchanged)
    r.scores.solid_baseliner = 0.30 * holdP + 0.20 * dfInvP + 0.30 * drP + 0.20 * tpwP;

    // 5 Counter Puncher — RPW40 Brk35 rally25; must be above tour average on BOTH RPW and Brk%
    let cp = r.hasMcp ? (0.40 * rpwP + 0.35 * brkP + 0.25 * rallyLongP) : ((0.40 * rpwP + 0.35 * brkP) / 0.75);
    if (!r.hasMcp) r.partial.counter_puncher = true;
    if (rpwP <= 50 || brkP <= 50) cp *= 0.45;                       // not converting defence into attack
    r.scores.counter_puncher = cp;

    // 6 Solid Defender — return + rally grinder, low ace/DF, low winners, clay skew, NO hold; lower Brk than counter
    let sd = 0.15 * Pi('aceR', r.aceR) + 0.10 * dfInvP + 0.28 * rpwP + 0.12 * brkP + 0.10 * clayVsHardP;
    if (r.hasMcp) sd += 0.15 * winnerLowP + 0.10 * rallyLongP; else { sd = sd / 0.75; r.partial.solid_defender = true; }
    r.scores.solid_defender = sd;

    for (const k of ['big_server', 'big_server_baseliner', 'attacking_baseliner', 'solid_baseliner', 'counter_puncher', 'solid_defender']) r.scores[k] = Math.max(0, Math.min(100, Math.round(r.scores[k])));
  }

  // ---- primary label (argmax + mandatory All-Court condition + Elite tier + Defender seed) ----
  const SPEC6 = ['big_server', 'big_server_baseliner', 'attacking_baseliner', 'solid_baseliner', 'counter_puncher', 'solid_defender'];
  for (const r of rows) {
    const ln = lastName(r.name);
    const six = SPEC6.map(k => r.scores[k]);
    const ownAvg = six.reduce((s, v) => s + v, 0) / 6;
    const std = Math.sqrt(six.reduce((s, v) => s + (v - ownAvg) ** 2, 0) / 6);
    r.scores.all_court = Math.max(0, Math.min(100, Math.round(ownAvg - std)));   // radar balance score
    const ranked = SPEC6.map(k => [k, r.scores[k]]).sort((a, b) => b[1] - a[1]);
    const top = ranked[0], second = ranked[1];
    // All-Court is mandatory-gated: statistically average (TPW near tour avg) AND no dominant dimension.
    const tpwNearAvg = r.TPW != null && Math.abs(r.TPW - medTPW) <= 0.03;
    const noDominant = (top[1] - ownAvg) <= 15;

    if (ELITE_LEGENDS.has(ln)) {
      // Retired all-time greats — force into the elite tier (a current-tour TPW gate can't reach them).
      r.primary = 'all_court_elite'; r.archetype_label = 'All-Court Elite';
    } else if (SEED[ln]) {
      r.primary = SEED[ln]; r.archetype_label = ARCH_LABEL[r.primary];
    } else if (r.isCurrent && r.TPW != null && r.TPW >= medTPW + 0.04) {
      // All-Court Elite: wins an exceptional share of ALL points (~tour avg + 4-5pp) = complete,
      // dominant everywhere. Applies regardless of which single dimension is the argmax.
      r.primary = 'all_court_elite'; r.archetype_label = 'All-Court Elite';
    } else if (tpwNearAvg && noDominant) {
      r.primary = 'all_court'; r.archetype_label = 'All-Court Player';
    } else {
      r.primary = top[0];
      const labels = [ARCH_LABEL[r.primary]];
      if (second[1] >= top[1] - HYBRID_GAP && second[0] !== r.primary) labels.push(ARCH_LABEL[second[0]]);
      r.archetype_label = labels.join(' / ');
    }
    r.coverage = r.hasMcp ? 'full' : 'partial';
    r.reliableLabel = true;
  }

  // ---- badges (4) ----
  // Pressure = clutch across the four moments that decide tight matches: tiebreaks
  // (purest pressure games), break points SAVED (serve clutch), break points
  // CONVERTED (return clutch), and deciding sets (match-long nerve). Each is a
  // percentile vs the current tour; a player needs all four to be scored.
  const pressureVals = rows.map(r => (r.tbWin != null && r.bpConv != null && r.decWin != null && r.bpSave != null)
    ? (0.30 * P('tbWin', r.tbWin) + 0.25 * P('bpSave', r.bpSave) + 0.25 * P('bpConv', r.bpConv) + 0.20 * P('decWin', r.decWin)) : null);
  rows.forEach((r, i) => {
    r.badges = [];
    const ln = lastName(r.name);
    const pv = pressureVals[i];
    r.pressureScore = pv == null ? null : Math.round(pv);
    if (pv != null && r.matches >= 60 && pv >= 80) r.badges.push('pressure_player');
    // Clay Specialist: rewards clay DEPENDENCE, not just dominance. Big clay-vs-hard
    // gap (>=18) catches grinders like Baez/Cecchinato/Coria whose absolute clay win%
    // is modest only because they play deep clay fields; an elite-absolute escape
    // (clay>=65 & gap>=12) keeps players like Ruud whose gap is smaller. Clay must be
    // the best surface, and >=30 clay matches removes small-sample artifacts.
    if (r.clayM >= 30 && r.clayWr != null && r.hardWr != null &&
        ((r.clayWr - r.hardWr) >= 18 || (r.clayWr >= 65 && (r.clayWr - r.hardWr) >= 12)) &&
        (r.grassWr == null || r.clayWr >= r.grassWr)) r.badges.push('clay_specialist');
    // Grass Specialist: grass% > 60, grass >= hard + 10, grass matches above the 75th
    // percentile. Mutually exclusive with clay — a player's best surface is one or the
    // other, and the clay rule already required clay to be their top surface.
    if (r.grassWr != null && r.hardWr != null && r.grassWr >= 56 && (r.grassWr - r.hardWr) >= 9 && r.grassM >= 12 && !r.badges.includes('clay_specialist')) r.badges.push('grass_specialist');
    // High Risk / High Reward: high top-10 ceiling + high upset variance + high
    // unforced-error rate (MCP required). Tight natural gate (>72 on both variance
    // axes) keeps the erratic core near ~9; seed adds the low-error must-includes.
    const hrhrNatural = r.top10Distinct >= 5 && r.upsetRate != null && P('upsetRate', r.upsetRate) > 72 &&
        r.hasMcp && r.unforcedRate != null && P('unforcedRate', r.unforcedRate) > 72;
    if ((hrhrNatural || HRHR_SEED.has(ln)) && !HRHR_ANTI.has(ln)) r.badges.push('high_risk_high_reward');
  });

  // ---- matchup matrix on 6 primaries (reliable labels only) ----
  const idToPrimary = new Map();
  for (const r of rows) if (r.reliableLabel) for (const id of r.ids) idToPrimary.set(id, r.primary);
  const winsByPair = {}; for (const A of ARCH8) { winsByPair[A] = {}; for (const B of ARCH8) winsByPair[A][B] = 0; }
  let matrixMatches = 0;
  for (const [wId, lId] of allMatches) { const aw = idToPrimary.get(wId), al = idToPrimary.get(lId); if (!aw || !al) continue; winsByPair[aw][al]++; matrixMatches++; }
  const matrix = {};
  for (const A of ARCH8) { matrix[A] = {}; for (const B of ARCH8) { if (A === B) { matrix[A][B] = null; continue; } const aw = winsByPair[A][B], bw = winsByPair[B][A], nAB = aw + bw; matrix[A][B] = { pct: nAB >= MATRIX_MIN_N ? +(aw / nAB * 100).toFixed(0) : null, n: nAB }; } }

  // ---- write outputs ----
  function avg(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
  // playing-styles.json holds the current-ATP players (what the dashboard displays) PLUS
  // the retired all-time greats surfaced in the All-Court Elite tier; the remaining retired
  // players were classified purely to enrich the matchup matrix above.
  const outRows = rows.filter(r => r.isCurrent || ELITE_LEGENDS.has(lastName(r.name))).sort((a, b) => a.rank - b.rank);
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
      win_pct: +r.winPct.toFixed(1), clay_wr: r.clayWr == null ? null : +r.clayWr.toFixed(0), hard_wr: r.hardWr == null ? null : +r.hardWr.toFixed(0), grass_wr: r.grassWr == null ? null : +r.grassWr.toFixed(0), top10_wins: r.top10Distinct,
    })),
  };
  writeAtomic('playing-styles.json', stylesOut);
  writeAtomic('styles-debug-all.json', { players: rows.map(r => ({ name: r.name, isCurrent: r.isCurrent, primary: r.primary, scores: r.scores, badges: r.badges, win_pct: +r.winPct.toFixed(1), clay_wr: r.clayWr==null?null:+r.clayWr.toFixed(0), hard_wr: r.hardWr==null?null:+r.hardWr.toFixed(0), grass_wr: r.grassWr==null?null:+r.grassWr.toFixed(0), grassM: r.grassM, clayM: r.clayM, tpw: r.TPW==null?null:+(r.TPW*100).toFixed(1), top10: r.top10Distinct, matches: r.matches, pressure_score: r.pressureScore, tbWin: r.tbWin, tbPlayed: r.tbPlayed, tbWon: r.tbWon, bpConv: r.bpConv, brkChances: r.brkChances, brkMade: r.brkMade, decWin: r.decWin, decPlayed: r.decPlayed, decWon: r.decWon, bpSave: r.bpSave, bpFacedSv: r.bpFacedSv, bpSavedSv: r.bpSavedSv, aceR: r.aceR, firstWonPct: r.firstWonPct, holdPct: r.holdPct, SPW: r.SPW, RPW: r.RPW, fastBias: r.fastBias, clayVsHard: r.clayVsHard, upsetWins: r.upsetWins, bigUpsetWins: r.bigUpsetWins, upsetWinRate: r.upsetWinRate })) });
  console.log(`Wrote playing-styles.json (${outRows.length} current players).`);

  const matrixOut = {
    generatedAt: new Date().toISOString(),
    source: 'Computed from BSP 6-axis classification x TML match results',
    window: `${FROM_YEAR}-${TO_YEAR}`,
    note: 'Win% of row archetype (primary label) vs column, over matches where both players have a reliably-determined primary label. Cells below the sample floor show n but no pct.',
    minSampleN: MATRIX_MIN_N, matchesCounted: matrixMatches,
    archetypes: Object.fromEntries(ARCH8.map(k => [k, { en: ARCH_LABEL[k] }])),
    matrix,
  };
  writeAtomic('matchup-matrix.json', matrixOut);
  console.log(`Wrote matchup-matrix.json (${matrixMatches} matches on 8 primaries).`);

  // ---- console sanity (current-ATP players = what the dashboard shows) ----
  const counts = {}; outRows.forEach(r => counts[r.primary] = (counts[r.primary] || 0) + 1);
  console.log('\nPrimary archetype counts (current-ATP):'); for (const k of ARCH8) console.log(`  ${ARCH_LABEL[k].padEnd(20)} ${counts[k] || 0}`);
  const cov = { full: 0, partial: 0 }; outRows.forEach(r => cov[r.coverage]++); console.log(`Coverage: ${cov.full} full / ${cov.partial} partial`);
  console.log('Badges: pressure', outRows.filter(r => r.badges.includes('pressure_player')).length, '| clay', outRows.filter(r => r.badges.includes('clay_specialist')).length, '| grass', outRows.filter(r => r.badges.includes('grass_specialist')).length, '| highRisk', outRows.filter(r => r.badges.includes('high_risk_high_reward')).length);
  console.log('\nSpot-checks:');
  for (const nm of ['Djokovic', 'Alcaraz', 'Sinner', 'Medvedev', 'Opelka', 'De Minaur', 'Federer', 'Nadal']) { const r = rows.find(x => x.name.includes(nm)); if (r) console.log(`  ${nm.padEnd(10)} ${r.archetype_label.padEnd(38)} [${r.coverage}] badges:${r.badges.join(',') || '-'}  scores: BS${r.scores.big_server} SB${r.scores.solid_baseliner} CP${r.scores.counter_puncher} AC${r.scores.all_court} AB${r.scores.attacking_baseliner} SD${r.scores.solid_defender}`); }

  function writeAtomic(name, obj) { const dest = path.join(__dirname, name), tmp = dest + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj, null, 2)); fs.renameSync(tmp, dest); }
  function avg2() {}
})();

function avg(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
