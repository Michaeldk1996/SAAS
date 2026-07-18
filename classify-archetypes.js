// =================================================================
// 13-ARCHETYPE PLAYING-STYLE CLASSIFIER (Sackmann/TML basis)
// -----------------------------------------------------------------
// Reproduces matchup-tennis.fr's 13 playing-style archetypes from raw
// Jeff-Sackmann-schema match data (mirrored by the Tennismylife TML-Database,
// same columns tennis_atp pioneered). Aggregates per-player serve/return/
// break/surface metrics over career-since-2010, then assigns each current-ATP
// player one archetype via an ordered decision tree.
//
// Two thresholds are taken verbatim from matchup-tennis's own published rules:
//   - Solid Offensive - Server   : ace rate >= 7%
//   - Solid Offensive - Returner : points won vs opponent 2nd serve >= 50%
// The remaining rules are our own, calibrated against the top-10 rosters
// scraped from matchup-tennis (VALIDATION set below). Because Sackmann match
// stats contain no rally-length / net-play / winner-error data, the finer
// baseline splits (Lift vs Power) and Serve & Volley are approximations; S&V
// is seeded from its 4 known members rather than inferred.
//
// Output: archetypes-classified.json  { generatedAt, window, pool, players:[...] }
// This does NOT touch player-profiles.json's separate 'archetype' field.
// =================================================================
const fs = require('fs');
const path = require('path');

const TML_BASE = 'https://raw.githubusercontent.com/Tennismylife/TML-Database/master/';
const CACHE = path.join(__dirname, 'tml-cache');
const FROM_YEAR = 2010;
const TO_YEAR = 2026;
const MIN_MATCHES = 20;      // reliable classification floor
const MIN_SVPT = 400;        // enough serve points to trust serve/return rates

// ---- 13 archetypes (id -> English + French labels) ------------------------
const ARCHETYPES = {
  allcourt:   { en: 'All-Court Elite',            fr: 'All-Court Élite' },
  bigsrv:     { en: 'Big Server',                 fr: 'Big Server' },
  bsbl:       { en: 'Big Server + Baseliner',     fr: 'Big Server + Baseliner' },
  attpower:   { en: 'Baseline Attacker (Power)',  fr: 'Attaquant de Fond (Power)' },
  attlift:    { en: 'Baseline Attacker (Topspin)',fr: 'Attaquant de Fond (Lift)' },
  counter:    { en: 'Offensive Counter-Puncher',  fr: 'Counter Puncher Offensif' },
  soldef:     { en: 'Solid Defensive',            fr: 'Solide Défensif' },
  terrien:    { en: 'Pure Clay-Courter',          fr: 'Pur Terrien' },
  sv:         { en: 'Serve & Volleyer',           fr: 'Serve and volleyeur' },
  soloffsrv:  { en: 'Solid Offensive - Server',   fr: 'Solide Offensif Serveur' },
  soloff:     { en: 'Solid Offensive - Core',     fr: 'Solide Offensif Core' },
  attirreg:   { en: 'Inconsistent Attacker',      fr: 'Attaquant Irrégulier' },
};

// ---- ground-truth validation set (scraped top-10 per archetype) -----------
// last-name (deaccented, lowercase) -> expected archetype id
const VALIDATION = {
  allcourt: ['sinner','alcaraz','djokovic','nadal','murray','wawrinka'],
  attirreg: ['shapovalov','collignon','zandschulp','kecmanovic','monfils','mmoh','shevchenko','vavassori','baghdatis','sock'],
  attlift:  ['fils','musetti','ruud','fonseca','etcheverry','tabilo','darderi','tsitsipas','molcan','sonego'],
  attpower: ['zverev','draper','rublev','cerundolo','rune','lehecka','cobolli','tiafoe','humbert','machac'],
  bigsrv:   ['rinderknech','raonic','roddick','opelka','perricard','isner','anderson','damm','muller','querrey'],
  bsbl:     ['aliassime','shelton','fritz','bublik','mensik','soderling','korda','kyrgios','berrettini','hurkacz'],
  counter:  ['medvedev','tien','fokina','moutet','wu','fucsovics','giron','majchrzak','nishikori','agut'],
  sv:       ['evans','mahut','zverev','lopez'],
  soldef:   ['minaur','norrie','munar','nardi','assche','goffin','simon','schwartzman','wild','ymer'],
  soloffsrv:['vacherot','dimitrov','griekspoor','nakashima','rodionov','pouille','connell','kovacevic','kubler','kohlschreiber'],
  soloff:   ['granollers','alboran','butvilas','schwaerzler','vasilev','sousa','turcanu','bennani','loutit','monnou'],
  terrien:  ['baez','cerundolo','kopriva','buse','navone','burruchaga','ruiz','taberner','martinez','carabelli'],
};
// S&V seed (last-name -> forced archetype). Not inferable from serve stats.
const SV_SEED = new Set(['mahut','lopez','evans']); // net-rushers not inferable from serve stats; seed current-pool members (Evans qualifies; Mahut/Lopez retired/out-of-pool)

// ---------------------------------------------------------------------------
function deaccent(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function lastName(full) {
  const s = deaccent(full).toLowerCase().replace(/[.\-]/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = s.split(' ');
  return parts.length ? parts[parts.length - 1] : '';
}
function nameKey(name) {
  const s = deaccent(name).toLowerCase().replace(/[.]/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = s.split(' ');
  if (parts.length < 2) return null;
  return `${parts.slice(1).join(' ')}|${parts[0].charAt(0)}`;
}

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
function surfaceOf(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('clay')) return 'clay';
  if (s.includes('grass')) return 'grass';
  if (s.includes('hard')) return 'hard';
  return 'other';
}

function newAgg(id, name) {
  return {
    id, name, matches: 0, wins: 0,
    svpt: 0, ace: 0, df: 0, firstIn: 0, firstWon: 0, secondWon: 0, svGms: 0, bpFaced: 0, bpSaved: 0,
    retPts: 0, retFirstIn: 0, retFirstWonBy: 0, ret2ndPts: 0, ret2ndWonBy: 0, retGms: 0, brkMade: 0, brkChances: 0,
    breaksSuffered: 0,
    clayM: 0, clayW: 0, hardM: 0, hardW: 0,
  };
}
// n() parses a possibly-empty numeric cell.
function n(v) { const x = parseFloat(v); return Number.isFinite(x) ? x : null; }

// Accumulate one match into a player agg. `me` = w or l prefix stats, `op` = opponent's.
function addMatch(a, me, op, won, surface) {
  a.matches++; if (won) a.wins++;
  if (surface === 'clay') { a.clayM++; if (won) a.clayW++; }
  else if (surface === 'hard') { a.hardM++; if (won) a.hardW++; }
  // serve side (needs my serve stats present)
  if (me.svpt != null && me.svpt > 0 && me.firstIn != null) {
    a.svpt += me.svpt; a.ace += me.ace || 0; a.df += me.df || 0;
    a.firstIn += me.firstIn; a.firstWon += me.firstWon || 0; a.secondWon += me.secondWon || 0;
    a.svGms += me.svGms || 0; a.bpFaced += me.bpFaced || 0; a.bpSaved += me.bpSaved || 0;
    a.breaksSuffered += Math.max(0, (me.bpFaced || 0) - (me.bpSaved || 0));
  }
  // return side (needs opponent serve stats present)
  if (op.svpt != null && op.svpt > 0 && op.firstIn != null) {
    a.retPts += op.svpt; a.retFirstIn += op.firstIn;
    a.retFirstWonBy += (op.firstIn - (op.firstWon || 0));
    const op2 = op.svpt - op.firstIn;
    a.ret2ndPts += op2; a.ret2ndWonBy += (op2 - (op.secondWon || 0));
    a.retGms += op.svGms || 0;
    a.brkChances += op.bpFaced || 0; a.brkMade += Math.max(0, (op.bpFaced || 0) - (op.bpSaved || 0));
  }
}

function finalize(a) {
  const r = { id: a.id, name: a.name, matches: a.matches, winPct: a.matches ? a.wins / a.matches * 100 : 0 };
  r.aceR = a.svpt ? a.ace / a.svpt : 0;
  r.dfR = a.svpt ? a.df / a.svpt : 0;
  r.firstInPct = a.svpt ? a.firstIn / a.svpt : 0;
  r.firstWonPct = a.firstIn ? a.firstWon / a.firstIn : 0;
  r.secondWonPct = (a.svpt - a.firstIn) ? a.secondWon / (a.svpt - a.firstIn) : 0;
  r.servePtsWon = a.svpt ? (a.firstWon + a.secondWon) / a.svpt : 0;
  r.holdPct = a.svGms ? (1 - a.breaksSuffered / a.svGms) * 100 : 0;
  r.retPtsWon = a.retPts ? (a.retFirstWonBy + a.ret2ndWonBy) / a.retPts : 0;
  r.retSecondWon = a.ret2ndPts ? a.ret2ndWonBy / a.ret2ndPts : 0; // confirmed threshold metric
  r.breakPct = a.retGms ? a.brkMade / a.retGms * 100 : 0;
  r.clayShare = a.matches ? a.clayM / a.matches : 0;
  r.clayWr = a.clayM ? a.clayW / a.clayM * 100 : null;
  r.hardWr = a.hardM ? a.hardW / a.hardM * 100 : null;
  r.svpt = a.svpt;
  return r;
}

// percentile of value v within sorted ascending array arr (0..100)
function pctOf(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
  return arr.length ? lo / arr.length * 100 : 0;
}

function classify(r, P, seedSV) {
  const clayMinusHard = (r.clayWr != null && r.hardWr != null) ? r.clayWr - r.hardWr : 0;
  const p = {
    ace: pctOf(P.aceR, r.aceR),
    ret: pctOf(P.retPtsWon, r.retPtsWon),
    serve: pctOf(P.servePtsWon, r.servePtsWon),
    win: pctOf(P.winPct, r.winPct),
    hold: pctOf(P.holdPct, r.holdPct),
    brk: pctOf(P.breakPct, r.breakPct),
    df: pctOf(P.dfR, r.dfR),
  };
  // 1. Serve & Volleyer — seeded only (not inferable from serve stats)
  if (seedSV) return { id: 'sv', conf: 'seed' };
  // 2. All-Court Elite — the generational few: dominant win% AND both wings strong.
  //    Gated to roughly the top ~4% by win% (~7 players, matching matchup's count).
  if (p.win >= 95 && p.serve >= 60 && p.ret >= 72) return { id: 'allcourt', conf: 'high' };
  // 3. Big Server (pure) — extreme serve, bottom-tier return, holds almost always.
  if (r.aceR >= 0.105 && p.ret <= 25 && p.hold >= 82) return { id: 'bigsrv', conf: 'high' };
  // 4. Pure Clay-Courter — clay-heavy schedule and clearly clay-better.
  if (r.clayShare >= 0.48 && clayMinusHard >= 7) return { id: 'terrien', conf: 'high' };
  // 5. Big Server + Baseliner — genuine big serve (>=9.5%) plus an above-floor game.
  if (r.aceR >= 0.095 && p.serve >= 56) return { id: 'bsbl', conf: 'high' };
  // 5b. Baseline Attacker (Topspin/Lift) — decided EARLY, before counter/soloffsrv can claim them.
  //     A strong clay-vs-hard win-rate gap (>=8 pts) is the one topspin signal serve/return data
  //     reliably carries; players below this fall through to the milder step-11 lift catch.
  //     Fires after terrien so pure clay specialists (clayShare>=.48) stay 'terrien', and after
  //     allcourt so clay-leaning elites (Nadal/Ruud) stay 'allcourt'.
  if (clayMinusHard >= 8 && p.serve >= 35 && p.win >= 35) return { id: 'attlift', conf: 'med' };
  // 6. Offensive Counter-Puncher — elite return, modest serve, wins by breaking.
  if (p.ret >= 78 && p.ace <= 55 && p.win >= 58) return { id: 'counter', conf: 'med' };
  // 7. Solid Defensive — strong return, weak serve, grinds (lower win than counter).
  if (p.ret >= 58 && p.ace <= 45 && r.clayShare < 0.5 && p.win < 58) return { id: 'soldef', conf: 'med' };
  // 8. Solid Offensive - Server (CONFIRMED ace >= 7% — complete player, serve edge)
  if (r.aceR >= 0.07) return { id: 'soloffsrv', conf: 'confirmed' };
  // 9. Baseline Attacker (Power) — aggressive, winning, hard-court lean.
  if (p.serve >= 55 && p.win >= 55 && clayMinusHard <= 3) return { id: 'attpower', conf: 'med' };
  // 11. Baseline Attacker (Topspin/Lift) — baseline with clay lean.
  if (clayMinusHard >= 2 && p.serve >= 35) return { id: 'attlift', conf: 'med' };
  // 12. Inconsistent Attacker — offensive but erratic (high DF, sub-.500-ish).
  if (p.df >= 60 && p.win <= 52) return { id: 'attirreg', conf: 'med' };
  // 13. Solid Offensive - Core (residual complete players)
  return { id: 'soloff', conf: 'low' };
}

(async () => {
  // build pool from current-ATP profiles
  const prof = require('./player-profiles.json').players;
  const pool = new Map(); // nameKey -> { name, rank }
  for (const k in prof) {
    const nm = prof[k].name; if (!nm) continue;
    const nk = nameKey(nm); if (!nk) continue;
    if (!pool.has(nk)) pool.set(nk, { name: nm, rank: parseInt(prof[k].rank, 10) || 9999 });
  }
  console.log(`Pool: ${pool.size} current-ATP name keys.`);

  // aggregate TML matches by player id, tracking a canonical name
  const byId = new Map();
  let totalRows = 0, statRows = 0;
  for (let y = FROM_YEAR; y <= TO_YEAR; y++) {
    const text = await getCsv(y);
    if (!text) { console.log(`  ${y}: missing`); continue; }
    const lines = text.split(/\r?\n/).filter(l => l.length);
    const H = lines[0].split(',');
    const ix = {}; H.forEach((h, i) => { ix[h] = i; });
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',');
      const surface = surfaceOf(c[ix.surface]);
      const wId = c[ix.winner_id], lId = c[ix.loser_id];
      const wName = c[ix.winner_name], lName = c[ix.loser_name];
      if (!wId || !lId) continue;
      totalRows++;
      const w = {
        svpt: n(c[ix.w_svpt]), ace: n(c[ix.w_ace]), df: n(c[ix.w_df]), firstIn: n(c[ix.w_1stIn]),
        firstWon: n(c[ix.w_1stWon]), secondWon: n(c[ix.w_2ndWon]), svGms: n(c[ix.w_SvGms]),
        bpFaced: n(c[ix.w_bpFaced]), bpSaved: n(c[ix.w_bpSaved]),
      };
      const l = {
        svpt: n(c[ix.l_svpt]), ace: n(c[ix.l_ace]), df: n(c[ix.l_df]), firstIn: n(c[ix.l_1stIn]),
        firstWon: n(c[ix.l_1stWon]), secondWon: n(c[ix.l_2ndWon]), svGms: n(c[ix.l_SvGms]),
        bpFaced: n(c[ix.l_bpFaced]), bpSaved: n(c[ix.l_bpSaved]),
      };
      if (w.svpt) statRows++;
      let aw = byId.get(wId); if (!aw) { aw = newAgg(wId, wName); byId.set(wId, aw); }
      let al = byId.get(lId); if (!al) { al = newAgg(lId, lName); byId.set(lId, al); }
      addMatch(aw, w, l, true, surface);
      addMatch(al, l, w, false, surface);
    }
  }
  console.log(`TML: ${totalRows} matches (${statRows} with serve stats), ${byId.size} distinct players.`);

  // map pool nameKey -> best TML id (most matches for that key)
  const keyToIds = new Map();
  for (const [id, a] of byId) {
    const nk = nameKey(a.name); if (!nk) continue;
    (keyToIds.get(nk) || keyToIds.set(nk, []).get(nk)).push(id);
  }
  const finals = [];
  for (const [nk, meta] of pool) {
    const ids = keyToIds.get(nk);
    if (!ids || !ids.length) continue;
    ids.sort((x, y) => byId.get(y).matches - byId.get(x).matches);
    const a = byId.get(ids[0]);
    if (a.matches < MIN_MATCHES || a.svpt < MIN_SVPT) continue;
    const r = finalize(a);
    r.displayName = meta.name; r.rank = meta.rank; r.nameKey = nk;
    finals.push(r);
  }
  console.log(`Reconciled + sample-qualified: ${finals.length} players.`);

  // pool percentile arrays
  const sortNum = (arr) => arr.slice().sort((x, y) => x - y);
  const P = {
    aceR: sortNum(finals.map(r => r.aceR)),
    retPtsWon: sortNum(finals.map(r => r.retPtsWon)),
    servePtsWon: sortNum(finals.map(r => r.servePtsWon)),
    winPct: sortNum(finals.map(r => r.winPct)),
    holdPct: sortNum(finals.map(r => r.holdPct)),
    breakPct: sortNum(finals.map(r => r.breakPct)),
    dfR: sortNum(finals.map(r => r.dfR)),
  };

  // classify
  for (const r of finals) {
    const seedSV = SV_SEED.has(lastName(r.displayName));
    const c = classify(r, P, seedSV);
    r.archetype = c.id; r.confidence = c.conf;
  }

  // counts
  const counts = {};
  for (const r of finals) counts[r.archetype] = (counts[r.archetype] || 0) + 1;
  console.log('\n=== ARCHETYPE COUNTS ===');
  for (const id of Object.keys(ARCHETYPES)) console.log(`  ${ARCHETYPES[id].en.padEnd(30)} ${counts[id] || 0}`);

  // validation confusion
  const byLast = new Map();
  for (const r of finals) { const ln = lastName(r.displayName); if (!byLast.has(ln)) byLast.set(ln, r); }
  let hit = 0, miss = 0; const misses = []; const perArch = {};
  for (const expId in VALIDATION) {
    perArch[expId] = { hit: 0, inPool: 0 };
    for (const ln of VALIDATION[expId]) {
      const r = byLast.get(ln);
      if (!r) continue; // not in pool / insufficient
      perArch[expId].inPool++;
      if (r.archetype === expId) { hit++; perArch[expId].hit++; }
      else { miss++; misses.push(`${ln}: exp ${expId} -> got ${r.archetype} (ace${(r.aceR*100).toFixed(1)}% ret2nd${(r.retSecondWon*100).toFixed(0)}% clay${(r.clayShare*100).toFixed(0)}% win${r.winPct.toFixed(0)}%)`); }
    }
  }
  console.log(`\n=== VALIDATION vs scraped rosters: ${hit}/${hit + miss} correct ===`);
  console.log('  per-archetype recall (hit / in-pool):');
  for (const id of Object.keys(ARCHETYPES)) {
    const s = perArch[id]; if (!s) continue;
    console.log(`    ${ARCHETYPES[id].en.padEnd(30)} ${s.hit}/${s.inPool}`);
  }

  // write output
  finals.sort((a, b) => a.rank - b.rank);
  const out = {
    generatedAt: new Date().toISOString(),
    source: 'Jeff Sackmann tennis_atp schema via Tennismylife/TML-Database',
    window: `${FROM_YEAR}-${TO_YEAR} (career aggregate)`,
    minMatches: MIN_MATCHES, minSvpt: MIN_SVPT,
    archetypes: ARCHETYPES,
    counts,
    players: finals.map(r => ({
      name: r.displayName, rank: r.rank, archetype: r.archetype, confidence: r.confidence,
      matches: r.matches, winPct: +r.winPct.toFixed(1),
      aceR: +(r.aceR * 100).toFixed(2), dfR: +(r.dfR * 100).toFixed(2),
      firstInPct: +(r.firstInPct * 100).toFixed(1), firstWonPct: +(r.firstWonPct * 100).toFixed(1),
      secondWonPct: +(r.secondWonPct * 100).toFixed(1), servePtsWon: +(r.servePtsWon * 100).toFixed(1),
      holdPct: +r.holdPct.toFixed(1), retPtsWon: +(r.retPtsWon * 100).toFixed(1),
      retSecondWon: +(r.retSecondWon * 100).toFixed(1), breakPct: +r.breakPct.toFixed(1),
      clayShare: +(r.clayShare * 100).toFixed(1), clayWr: r.clayWr == null ? null : +r.clayWr.toFixed(1),
      hardWr: r.hardWr == null ? null : +r.hardWr.toFixed(1),
    })),
  };
  fs.writeFileSync(path.join(__dirname, 'archetypes-classified.json'), JSON.stringify(out, null, 2));
  console.log(`\nWrote archetypes-classified.json (${finals.length} players).`);
})();
