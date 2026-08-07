// =================================================================
// PER-SURFACE UNDER-PRESSURE (self-derived, additive sidecar) — TEN-8
// -----------------------------------------------------------------
// clutch-rating.js emits ONE career-aggregate Under-Pressure index per player.
// Serve and Return already re-price PER SURFACE (model layers #9/#10 blend a
// surface-specific rating with a career fallback). Under-pressure did not — the
// Clutch layer (#15) read the single career index on every surface. This builder
// mirrors the serve/return pattern for under-pressure: it computes the SAME four
// ATP components (BP saved %, BP converted %, tiebreak win %, deciding-set win %)
// split by surface (Hard / Clay / Grass) from the SAME raw TML (Sackmann-schema)
// match data — NO new licence exposure, NO ATP/Infosys scraping.
//
// Output is an ADDITIVE sidecar `clutch-surface.json`; clutch-rating.json is left
// byte-identical. The model resolves it like clutch-supplement.json: a match on a
// given surface prefers that surface's index when its per-surface sample clears
// the floor, and falls back to the career index otherwise — never overriding it.
//
// Percentiles are placed PER SURFACE (a player's clay index is percentile-ranked
// against the pool's clay distribution, not the career distribution) so a
// per-surface index means "vs peers ON THAT SURFACE".
//
// Floors are identical to clutch-rating.js. A surface bucket that fails a
// component floor nulls THAT component on THAT surface only — it is not guessed,
// and it does not contaminate the career row (which keeps its own full-sample
// number). This is the tour pool only; Challenger sub-floor players are handled
// separately (they need the per-component Challenger discount, a distinct ruling).
// =================================================================
const fs = require('fs');
const path = require('path');

const TML_BASE = 'https://raw.githubusercontent.com/Tennismylife/TML-Database/master/';
const CACHE = path.join(__dirname, 'tml-cache');
const FROM_YEAR = 2010;
const TO_YEAR = 2026;
// Career-level qualification (mirrors clutch-rating.js) to enter the pool at all.
const MIN_MATCHES = 20;
const MIN_SVPT = 400;
// Per-component reliability floors — identical to clutch-rating.js. Applied PER
// SURFACE here: a surface bucket must independently clear the floor to publish.
const MIN_BP_FACED = 50;
const MIN_BP_CHANCE = 50;
const MIN_TB = 10;
const MIN_DEC = 8;

const SURFACES = ['Hard', 'Clay', 'Grass'];
function surfaceKey(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'hard') return 'Hard';
  if (s === 'clay') return 'Clay';
  if (s === 'grass') return 'Grass';
  return null; // Carpet / blank / unknown — excluded (not a live tour surface)
}

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
// Identical to clutch-rating.js parseScore: winner-first score -> per-side
// tiebreak + deciding-set outcomes.
function parseScore(score, bestOf) {
  const out = { tbPlayed: 0, tbWonByWinner: 0, decPlayed: 0, decWonByWinner: 0 };
  if (!score) return out;
  const retired = RETIRED.test(score);
  const tokens = score.trim().split(/\s+/);
  const sets = [];
  for (let tok of tokens) {
    const hasParen = tok.includes('(');
    const m = tok.replace(/\(.*?\)/g, '').match(/^(\d+)-(\d+)$/);
    if (!m) continue;
    const w = +m[1], l = +m[2];
    const isTb = hasParen || (Math.max(w, l) === 7 && Math.min(w, l) === 6);
    sets.push({ w, l, tb: isTb });
  }
  for (const s of sets) { if (s.tb) { out.tbPlayed++; if (s.w > s.l) out.tbWonByWinner++; } }
  if (!retired && bestOf) {
    if ((bestOf === 3 && sets.length === 3) || (bestOf === 5 && sets.length === 5)) {
      out.decPlayed = 1; out.decWonByWinner = 1;
    }
  }
  return out;
}

function newSurfAgg() {
  return { matches: 0, svpt: 0, bpFaced: 0, bpSaved: 0, brkChances: 0, brkMade: 0, tbPlayed: 0, tbWon: 0, decPlayed: 0, decWon: 0 };
}
function newAgg(id, name) {
  return { id, name, matches: 0, svpt: 0, bySurface: { Hard: newSurfAgg(), Clay: newSurfAgg(), Grass: newSurfAgg() } };
}

function pctOf(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
  return arr.length ? lo / arr.length * 100 : 0;
}

// Compute the four components for one surface aggregate, nulling any below floor.
function componentsOf(a) {
  return {
    bpSavedPct: a.bpFaced >= MIN_BP_FACED ? a.bpSaved / a.bpFaced * 100 : null,
    bpConvPct: a.brkChances >= MIN_BP_CHANCE ? a.brkMade / a.brkChances * 100 : null,
    tbWinPct: a.tbPlayed >= MIN_TB ? a.tbWon / a.tbPlayed * 100 : null,
    decWinPct: a.decPlayed >= MIN_DEC ? a.decWon / a.decPlayed * 100 : null,
  };
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
      const surf = surfaceKey(c[ix.surface]);
      if (!surf) continue; // exclude Carpet / unknown
      const w = { svpt: n(c[ix.w_svpt]), bpFaced: n(c[ix.w_bpFaced]), bpSaved: n(c[ix.w_bpSaved]) };
      const l = { svpt: n(c[ix.l_svpt]), bpFaced: n(c[ix.l_bpFaced]), bpSaved: n(c[ix.l_bpSaved]) };
      const bestOf = parseInt(c[ix.best_of], 10) || null;
      const ps = parseScore(c[ix.score], bestOf);

      let aw = byId.get(wId); if (!aw) { aw = newAgg(wId, c[ix.winner_name]); byId.set(wId, aw); }
      let al = byId.get(lId); if (!al) { al = newAgg(lId, c[ix.loser_name]); byId.set(lId, al); }
      const sw = aw.bySurface[surf], sl = al.bySurface[surf];

      aw.matches++; al.matches++; sw.matches++; sl.matches++;
      if (w.svpt) { aw.svpt += w.svpt; sw.svpt += w.svpt; }
      if (l.svpt) { al.svpt += l.svpt; sl.svpt += l.svpt; }
      // serve: BP saved (mine)
      if (w.bpFaced != null) { sw.bpFaced += w.bpFaced; sw.bpSaved += w.bpSaved || 0; }
      if (l.bpFaced != null) { sl.bpFaced += l.bpFaced; sl.bpSaved += l.bpSaved || 0; }
      // return: BP converted (chances = opp BP faced; made = opp faced - opp saved)
      if (l.bpFaced != null) { sw.brkChances += l.bpFaced; sw.brkMade += Math.max(0, l.bpFaced - (l.bpSaved || 0)); }
      if (w.bpFaced != null) { sl.brkChances += w.bpFaced; sl.brkMade += Math.max(0, w.bpFaced - (w.bpSaved || 0)); }
      // tiebreaks (winner-perspective) + deciding sets
      sw.tbPlayed += ps.tbPlayed; sw.tbWon += ps.tbWonByWinner;
      sl.tbPlayed += ps.tbPlayed; sl.tbWon += (ps.tbPlayed - ps.tbWonByWinner);
      sw.decPlayed += ps.decPlayed; sw.decWon += ps.decWonByWinner;
      sl.decPlayed += ps.decPlayed; sl.decWon += (ps.decPlayed - ps.decWonByWinner);
    }
  }
  console.log(`TML aggregated: ${byId.size} distinct players.`);

  // reconcile pool -> best TML id (most matches), same rule as clutch-rating.js
  const keyToIds = new Map();
  for (const [id, a] of byId) {
    const nk = nameKey(a.name); if (!nk) continue;
    (keyToIds.get(nk) || keyToIds.set(nk, []).get(nk)).push(id);
  }

  // First pass: qualified players + their raw per-surface component values.
  const rows = [];
  for (const [nk, meta] of pool) {
    const ids = keyToIds.get(nk); if (!ids || !ids.length) continue;
    ids.sort((x, y) => byId.get(y).matches - byId.get(x).matches);
    const a = byId.get(ids[0]);
    if (a.matches < MIN_MATCHES || a.svpt < MIN_SVPT) continue; // same career gate as clutch-rating.js
    const bySurface = {};
    for (const surf of SURFACES) {
      const sa = a.bySurface[surf];
      const comp = componentsOf(sa);
      bySurface[surf] = {
        ...comp,
        sample: { matches: sa.matches, bpFaced: sa.bpFaced, bpChances: sa.brkChances, tbPlayed: sa.tbPlayed, decPlayed: sa.decPlayed },
      };
    }
    rows.push({ nk, name: meta.name, rank: meta.rank, bySurface });
  }
  console.log(`Reconciled + career-qualified: ${rows.length} players.`);

  // Per-surface percentile pools: one sorted array per (component x surface).
  const sortNum = (arr) => arr.slice().sort((x, y) => x - y);
  const P = {}; // P[surf][comp] = sorted values
  for (const surf of SURFACES) {
    P[surf] = {};
    for (const comp of ['bpSavedPct', 'bpConvPct', 'tbWinPct', 'decWinPct']) {
      P[surf][comp] = sortNum(rows.map(r => r.bySurface[surf][comp]).filter(v => v != null));
    }
  }

  // Second pass: per-surface index = mean of present-component percentiles vs
  // that surface's pool. atpStyleRating = raw sum when all four present.
  const coverage = { Hard: 0, Clay: 0, Grass: 0 };
  for (const r of rows) {
    for (const surf of SURFACES) {
      const b = r.bySurface[surf];
      const parts = [];
      for (const comp of ['bpSavedPct', 'bpConvPct', 'tbWinPct', 'decWinPct']) {
        if (b[comp] != null) parts.push(pctOf(P[surf][comp], b[comp]));
      }
      const have = parts.length;
      b.clutchIndex = have ? +(parts.reduce((s, v) => s + v, 0) / parts.length).toFixed(1) : null;
      const allFour = ['bpSavedPct', 'bpConvPct', 'tbWinPct', 'decWinPct'].every(k => b[k] != null);
      b.atpStyleRating = allFour ? +(b.bpSavedPct + b.bpConvPct + b.tbWinPct + b.decWinPct).toFixed(1) : null;
      // Same confidence ladder as the career build: 4 present -> high, 3 -> med, else low/null.
      b.confidence = have === 4 ? 'high' : have === 3 ? 'med' : have >= 1 ? 'low' : null;
      // round the component values for output
      for (const comp of ['bpSavedPct', 'bpConvPct', 'tbWinPct', 'decWinPct']) {
        b[comp] = b[comp] == null ? null : +b[comp].toFixed(1);
      }
      if (b.clutchIndex != null && have >= 3) coverage[surf]++;
    }
  }

  // Sanity: clay specialists should top clay, grass/serve-bots should top grass.
  for (const surf of SURFACES) {
    const ranked = rows.filter(r => r.bySurface[surf].clutchIndex != null && r.bySurface[surf].confidence !== 'low')
      .sort((a, b) => b.bySurface[surf].clutchIndex - a.bySurface[surf].clutchIndex);
    console.log(`\n=== TOP 8 ${surf} clutch index (conf>=med) — n=${ranked.length} ===`);
    ranked.slice(0, 8).forEach((r, i) => {
      const b = r.bySurface[surf];
      console.log(`  ${String(i + 1).padStart(2)}. ${r.name.padEnd(22)} idx=${b.clutchIndex.toFixed(1)}  BPsv=${(b.bpSavedPct||0).toFixed(0)} BPcv=${(b.bpConvPct||0).toFixed(0)} TB=${(b.tbWinPct||0).toFixed(0)} DEC=${(b.decWinPct||0).toFixed(0)} [${b.confidence} n=${b.sample.matches}]`);
    });
  }
  console.log(`\nPer-surface coverage (conf>=med): Hard ${coverage.Hard}, Clay ${coverage.Clay}, Grass ${coverage.Grass} of ${rows.length} pool players.`);

  rows.sort((a, b) => a.rank - b.rank);
  const out = {
    generatedAt: new Date().toISOString(),
    source: 'Self-derived from Jeff Sackmann tennis_atp schema (Tennismylife/TML-Database) — no ATP/Infosys data',
    window: `${FROM_YEAR}-${TO_YEAR} (career aggregate, split by surface)`,
    method: 'Same four ATP Under-Pressure components as clutch-rating.js (BP saved %, BP converted %, tiebreak win %, deciding-set win %), computed separately per surface. clutchIndex = mean per-surface pool-percentile 0-100. Additive sidecar to clutch-rating.json (career index untouched); model prefers the surface index when its floor clears, else falls back to career.',
    floors: { minMatches: MIN_MATCHES, minSvpt: MIN_SVPT, minBpFaced: MIN_BP_FACED, minBpChances: MIN_BP_CHANCE, minTiebreaks: MIN_TB, minDecidingSets: MIN_DEC },
    surfaces: SURFACES,
    coverage,
    players: rows.map(r => ({ name: r.name, rank: r.rank, bySurface: r.bySurface })),
  };
  const dest = path.join(__dirname, 'clutch-surface.json');
  const tmp = dest + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, dest);
  console.log(`\nWrote clutch-surface.json (${rows.length} players).`);
})();
