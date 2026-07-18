// =================================================================
// UNDER-PRESSURE / CLUTCH RATING (self-derived, ATP-methodology-style)
// -----------------------------------------------------------------
// Reproduces the ATP "Under Pressure" leaderboard's four components from
// the SAME raw Jeff-Sackmann-schema match data we already cache (TML mirror)
// — NO ATP/Infosys scraping, no new licence exposure. Every number here is
// our own derivation from public match results.
//
//   1. Break points saved %      = bpSaved / bpFaced           (serve side)
//   2. Break points converted %  = (oppBpFaced - oppBpSaved) / oppBpFaced (return side)
//   3. Tie-breaks won %          = tiebreak sets won / played  (parsed from score)
//   4. Deciding-sets won %       = deciding sets won / played  (parsed from score)
//
// ATP ranks its board by the raw SUM of the four percentages; we publish that
// (`atpStyleRating`) for comparability AND a pool-percentile 0-100 `clutchIndex`
// for display. Components below a reliability floor are nulled, not guessed, and
// the composite is averaged over whatever qualifies (confidence flags how many).
//
// Output: clutch-rating.json  { generatedAt, window, method, players:[...] }
// Independent of archetypes-classified.json — same player pool, different axis.
// =================================================================
const fs = require('fs');
const path = require('path');

const TML_BASE = 'https://raw.githubusercontent.com/Tennismylife/TML-Database/master/';
const CACHE = path.join(__dirname, 'tml-cache');
const FROM_YEAR = 2010;
const TO_YEAR = 2026;
const MIN_MATCHES = 20;     // reliable-player floor (mirrors classifier)
const MIN_SVPT = 400;
// per-component reliability floors — below these the component is nulled, not shown
const MIN_BP_FACED = 50;    // break points saved
const MIN_BP_CHANCE = 50;   // break points converted
const MIN_TB = 10;          // tiebreaks played
const MIN_DEC = 8;          // deciding sets played

function deaccent(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function nameKey(name) {
  const s = deaccent(name).toLowerCase().replace(/[.]/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = s.split(' ');
  if (parts.length < 2) return null;
  return `${parts.slice(1).join(' ')}|${parts[0].charAt(0)}`;
}
function n(v) { const x = parseFloat(v); return Number.isFinite(x) ? x : null; }

async function getCsv(year) {
  const file = path.join(CACHE, `${year}.csv`);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return fs.readFileSync(file, 'utf8');
  const res = await fetch(`${TML_BASE}${year}.csv`, { headers: { 'User-Agent': 'bsp-consult' } });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text || text.length < 50) return null;
  if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, text);
  return text;
}

const RETIRED = /\b(RET|W\/O|DEF|ABD|WALK|Walkover|Def)\b/i;
// Parse a winner-first score string into per-side tiebreak + deciding-set outcomes.
// Returns { tbPlayed, tbWonByWinner, decPlayed(0|1), decWonByWinner(0|1) }.
function parseScore(score, bestOf) {
  const out = { tbPlayed: 0, tbWonByWinner: 0, decPlayed: 0, decWonByWinner: 0 };
  if (!score) return out;
  const retired = RETIRED.test(score);
  const tokens = score.trim().split(/\s+/);
  const sets = []; // { w, l, tb }
  for (let tok of tokens) {
    const hasParen = tok.includes('(');
    const m = tok.replace(/\(.*?\)/g, '').match(/^(\d+)-(\d+)$/);
    if (!m) continue;                          // skip RET / W/O / bracket super-tb / junk
    const w = +m[1], l = +m[2];
    const isTb = hasParen || (Math.max(w, l) === 7 && Math.min(w, l) === 6);
    sets.push({ w, l, tb: isTb });
  }
  for (const s of sets) {
    if (s.tb) { out.tbPlayed++; if (s.w > s.l) out.tbWonByWinner++; }
  }
  // deciding set = final set of a completed, full-length match (winner takes it by definition)
  if (!retired && bestOf) {
    if ((bestOf === 3 && sets.length === 3) || (bestOf === 5 && sets.length === 5)) {
      out.decPlayed = 1; out.decWonByWinner = 1;
    }
  }
  return out;
}

function newAgg(id, name) {
  return {
    id, name, matches: 0, svpt: 0,
    bpFaced: 0, bpSaved: 0,          // serve: BP saved
    brkChances: 0, brkMade: 0,       // return: BP converted
    tbPlayed: 0, tbWon: 0,
    decPlayed: 0, decWon: 0,
  };
}

function pctOf(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
  return arr.length ? lo / arr.length * 100 : 0;
}

(async () => {
  const prof = require('./player-profiles.json').players;
  const pool = new Map();
  for (const k in prof) {
    const nm = prof[k].name; if (!nm) continue;
    const nk = nameKey(nm); if (!nk) continue;
    if (!pool.has(nk)) pool.set(nk, { name: nm, rank: parseInt(prof[k].rank, 10) || 9999 });
  }
  console.log(`Pool: ${pool.size} current-ATP name keys.`);

  const byId = new Map();
  for (let y = FROM_YEAR; y <= TO_YEAR; y++) {
    const text = await getCsv(y);
    if (!text) { console.log(`  ${y}: missing`); continue; }
    const lines = text.split(/\r?\n/).filter(l => l.length);
    const H = lines[0].split(','); const ix = {}; H.forEach((h, i) => { ix[h] = i; });
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',');
      const wId = c[ix.winner_id], lId = c[ix.loser_id];
      if (!wId || !lId) continue;
      const w = { svpt: n(c[ix.w_svpt]), bpFaced: n(c[ix.w_bpFaced]), bpSaved: n(c[ix.w_bpSaved]) };
      const l = { svpt: n(c[ix.l_svpt]), bpFaced: n(c[ix.l_bpFaced]), bpSaved: n(c[ix.l_bpSaved]) };
      const bestOf = parseInt(c[ix.best_of], 10) || null;
      const ps = parseScore(c[ix.score], bestOf);

      let aw = byId.get(wId); if (!aw) { aw = newAgg(wId, c[ix.winner_name]); byId.set(wId, aw); }
      let al = byId.get(lId); if (!al) { al = newAgg(lId, c[ix.loser_name]); byId.set(lId, al); }

      aw.matches++; al.matches++;
      if (w.svpt) aw.svpt += w.svpt;
      if (l.svpt) al.svpt += l.svpt;
      // serve: BP saved (mine)
      if (w.bpFaced != null) { aw.bpFaced += w.bpFaced; aw.bpSaved += w.bpSaved || 0; }
      if (l.bpFaced != null) { al.bpFaced += l.bpFaced; al.bpSaved += l.bpSaved || 0; }
      // return: BP converted (chances = opp BP faced; made = opp faced - opp saved)
      if (l.bpFaced != null) { aw.brkChances += l.bpFaced; aw.brkMade += Math.max(0, l.bpFaced - (l.bpSaved || 0)); }
      if (w.bpFaced != null) { al.brkChances += w.bpFaced; al.brkMade += Math.max(0, w.bpFaced - (w.bpSaved || 0)); }
      // tiebreaks (winner-perspective from score) + deciding sets
      aw.tbPlayed += ps.tbPlayed; aw.tbWon += ps.tbWonByWinner;
      al.tbPlayed += ps.tbPlayed; al.tbWon += (ps.tbPlayed - ps.tbWonByWinner);
      aw.decPlayed += ps.decPlayed; aw.decWon += ps.decWonByWinner;
      al.decPlayed += ps.decPlayed; al.decWon += (ps.decPlayed - ps.decWonByWinner);
    }
  }
  console.log(`TML aggregated: ${byId.size} distinct players.`);

  // reconcile pool -> best TML id (most matches)
  const keyToIds = new Map();
  for (const [id, a] of byId) {
    const nk = nameKey(a.name); if (!nk) continue;
    (keyToIds.get(nk) || keyToIds.set(nk, []).get(nk)).push(id);
  }
  const rows = [];
  for (const [nk, meta] of pool) {
    const ids = keyToIds.get(nk); if (!ids || !ids.length) continue;
    ids.sort((x, y) => byId.get(y).matches - byId.get(x).matches);
    const a = byId.get(ids[0]);
    if (a.matches < MIN_MATCHES || a.svpt < MIN_SVPT) continue;
    const comp = {
      bpSavedPct: a.bpFaced >= MIN_BP_FACED ? a.bpSaved / a.bpFaced * 100 : null,
      bpConvPct: a.brkChances >= MIN_BP_CHANCE ? a.brkMade / a.brkChances * 100 : null,
      tbWinPct: a.tbPlayed >= MIN_TB ? a.tbWon / a.tbPlayed * 100 : null,
      decWinPct: a.decPlayed >= MIN_DEC ? a.decWon / a.decPlayed * 100 : null,
    };
    rows.push({ nk, name: meta.name, rank: meta.rank, ...comp,
      sample: { bpFaced: a.bpFaced, bpChances: a.brkChances, tbPlayed: a.tbPlayed, decPlayed: a.decPlayed } });
  }
  console.log(`Reconciled + qualified: ${rows.length} players.`);

  // pool percentile arrays (only over players with the component present)
  const sortNum = (a) => a.slice().sort((x, y) => x - y);
  const P = {};
  for (const key of ['bpSavedPct', 'bpConvPct', 'tbWinPct', 'decWinPct']) {
    P[key] = sortNum(rows.map(r => r[key]).filter(v => v != null));
  }

  for (const r of rows) {
    const parts = [];
    for (const key of ['bpSavedPct', 'bpConvPct', 'tbWinPct', 'decWinPct']) {
      if (r[key] != null) parts.push(pctOf(P[key], r[key]));
    }
    r.clutchIndex = parts.length ? +(parts.reduce((s, v) => s + v, 0) / parts.length).toFixed(1) : null;
    const allFour = ['bpSavedPct', 'bpConvPct', 'tbWinPct', 'decWinPct'].every(k => r[k] != null);
    r.atpStyleRating = allFour
      ? +(r.bpSavedPct + r.bpConvPct + r.tbWinPct + r.decWinPct).toFixed(1) : null;
    const have = parts.length;
    r.confidence = have === 4 ? 'high' : have === 3 ? 'med' : 'low';
  }

  // sanity: top & bottom by clutch index
  const ranked = rows.filter(r => r.clutchIndex != null).sort((a, b) => b.clutchIndex - a.clutchIndex);
  console.log('\n=== TOP 12 clutch index ===');
  ranked.slice(0, 12).forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)}. ${r.name.padEnd(24)} idx=${r.clutchIndex.toFixed(1)}  BPsv=${(r.bpSavedPct||0).toFixed(0)} BPcv=${(r.bpConvPct||0).toFixed(0)} TB=${(r.tbWinPct||0).toFixed(0)} DEC=${(r.decWinPct||0).toFixed(0)} [${r.confidence}]`));
  console.log('=== BOTTOM 6 ===');
  ranked.slice(-6).forEach((r) => console.log(`      ${r.name.padEnd(24)} idx=${r.clutchIndex.toFixed(1)}  BPsv=${(r.bpSavedPct||0).toFixed(0)} BPcv=${(r.bpConvPct||0).toFixed(0)} TB=${(r.tbWinPct||0).toFixed(0)} DEC=${(r.decWinPct||0).toFixed(0)} [${r.confidence}]`));

  // write output (atomic: temp + rename, per project rule)
  rows.sort((a, b) => a.rank - b.rank);
  const out = {
    generatedAt: new Date().toISOString(),
    source: 'Self-derived from Jeff Sackmann tennis_atp schema (Tennismylife/TML-Database) — no ATP/Infosys data',
    window: `${FROM_YEAR}-${TO_YEAR} (career aggregate)`,
    method: 'ATP Under-Pressure components: BP saved %, BP converted %, tiebreak win %, deciding-set win %. atpStyleRating = raw sum of the four (ATP board method); clutchIndex = mean pool-percentile 0-100.',
    floors: { minMatches: MIN_MATCHES, minSvpt: MIN_SVPT, minBpFaced: MIN_BP_FACED, minBpChances: MIN_BP_CHANCE, minTiebreaks: MIN_TB, minDecidingSets: MIN_DEC },
    players: rows.map(r => ({
      name: r.name, rank: r.rank,
      clutchIndex: r.clutchIndex, atpStyleRating: r.atpStyleRating, confidence: r.confidence,
      bpSavedPct: r.bpSavedPct == null ? null : +r.bpSavedPct.toFixed(1),
      bpConvPct: r.bpConvPct == null ? null : +r.bpConvPct.toFixed(1),
      tbWinPct: r.tbWinPct == null ? null : +r.tbWinPct.toFixed(1),
      decWinPct: r.decWinPct == null ? null : +r.decWinPct.toFixed(1),
      sample: r.sample,
    })),
  };
  const dest = path.join(__dirname, 'clutch-rating.json');
  const tmp = dest + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, dest);
  console.log(`\nWrote clutch-rating.json (${rows.length} players).`);
})();
