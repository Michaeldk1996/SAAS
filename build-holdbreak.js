// Break/Hold heatmap rollup shard  (TEN-107)
// =============================================================================
// FOUNDER RULING 2026-09-01 (comment 0f9961ce): window = 24 MONTHS, axis =
// BUCKETED. Ship it. This file encodes that ruling; do not silently change the
// window or un-bucket the axis without a new ruling.
//
// WHAT THIS IS
//   A pre-computed nightly rollup shard (like career-splits.json) — ZERO live
//   API calls. It reads the keyed historical point-by-point we already harvest
//   in apitennis-styles-cache/{playerKey}-{year}.json and rolls up, per player
//   and pooled across the tour:
//     - SERVE  panel: hold%  by (surface x set x service-game bucket)
//     - RETURN panel: break% by (surface x set x service-game bucket)
//   hold  = the server won their own service game (serve_winner === player_served)
//   break = the returner won it (serve_winner !== player_served)
//
// WHY THIS SOURCE (measured, see board doc holdbreak-heatmap-spec)
//   The historical pbp is the ONLY source carrying game position. Box scores and
//   Tennis-Abstract splits are match/set aggregates — they cannot build this.
//   Each cache row carries per game: set_number, number_game (game index in the
//   set), player_served, serve_winner/serve_lost, and per point break_point.
//
// AXIS = BUCKETED, by the SERVER'S service-game ORDINAL within the set (NOT the
//   raw game number, which alternates server and can't answer "does THIS player
//   hold up late in the set"):
//     early = 1st-2nd service game, mid = 3rd-4th, late = 5th+.
//
// WINDOW = 24 months. The cache the operator harvests is current-season-heavy,
//   so live coverage will start shallow and DEEPEN toward 24M as the history
//   backfill accumulates. meta.coverage reports what actually went in.
//
// SAMPLE FLOOR: this shard emits {pct,n} on EVERY cell and never drops data;
//   meta.sampleFloor is the RECOMMENDED display floor (grey cells below it).
//   Keeping n on the wire lets the UI (and any re-floor ruling) adjust without a
//   regen. Sample floor is a standing rule on every axis.
// =============================================================================

const fs = require('fs');
const path = require('path');

// TEN-107: hold/break reads its OWN cache dir, populated by harvest-holdbreak.js
// (own roster, rank<=400, NO TML exclusion, rolling 24M). Decoupled from the
// archetype style cache (apitennis-styles-cache) so widening this window can
// never perturb classify-styles.js. build-holdbreak still applies the 24M clip.
const CACHE_DIR = path.join(__dirname, 'apitennis-holdbreak-cache');
const OUT_PATH = path.join(__dirname, 'holdbreak.json');
const WINDOW_MONTHS = 24;
const SAMPLE_FLOOR = 20;              // recommended display floor; data keeps n
const FINAL_STATUSES = new Set(['Finished', 'Retired', 'Walk Over']);
const BUCKETS = ['early', 'mid', 'late'];
// TEN-107 PHASE 2 (founder ruling 2026-09-02): split sets to S1..S5 (was '4+')
// so the DataEdge panel can show one column per set of a best-of-five match. A
// set number >=5 folds into '5' (ATP is best-of-five; a 6th set can't occur in
// singles). GLOBAL (across-sets) is derived in the frontend by summing S1..S5.
const SETS = ['1', '2', '3', '4', '5'];
const SURFACES = ['all', 'hard', 'clay', 'grass'];

// Anchor "now" from the newest event_date in the cache rather than the wall
// clock, so a re-run on a frozen cache is deterministic and the window can't
// drift past the data. (Also keeps the generator pure for review re-runs.)
function windowStartFrom(maxDateISO) {
  const d = new Date(maxDateISO + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() - WINDOW_MONTHS);
  return d.toISOString().slice(0, 10);
}

let SURFACE_MAP = new Map();
try {
  const raw = require('./tournament-surfaces.json');
  const sf = raw.surfaces || raw;
  for (const k in sf) if (sf[k]) SURFACE_MAP.set(String(k), String(sf[k]).toLowerCase());
} catch (_) { /* fall back to name */ }

function surfaceOf(tournamentKey, tournamentName) {
  const byKey = tournamentKey != null && SURFACE_MAP.get(String(tournamentKey));
  if (byKey) return byKey;
  const s = String(tournamentName || '').toLowerCase();
  return s.includes('clay') ? 'clay' : s.includes('grass') ? 'grass' : s.includes('hard') ? 'hard' : 'other';
}

function setKey(setNumberRaw) {
  const raw = String(setNumberRaw);
  // TEN-107 (founder authorised 2026-09-02): a tiebreak is ONE game in which BOTH
  // players serve, alternating a point or two at a time. api-tennis emits it as
  // "Set N TieBreak" with a SEPARATE row per mini-serve. Stripping non-digits
  // folded those rows into numeric Set N, so each tiebreak was mis-counted as ~6-8
  // service games — ~18.6% of the shard, concentrated in the late bucket (6-6),
  // which read servers as leaky exactly where a bettor checks hold-under-pressure.
  // Skip any tiebreak-labelled row outright; returning null makes the caller's
  // `if (!sKey) continue;` drop it.
  if (/tie/i.test(raw)) return null;
  const n = parseInt(raw.replace(/[^0-9]/g, ''), 10);
  if (!n) return null;
  return n >= 5 ? '5' : String(n);
}

function bucketFor(serviceOrdinal) {
  if (serviceOrdinal <= 2) return 'early';
  if (serviceOrdinal <= 4) return 'mid';
  return 'late';
}

// Empty {surface:{set:{bucket:{won,n,bpSaved,bpFaced}}}} grid.
function emptyGrid() {
  const g = {};
  for (const su of SURFACES) {
    g[su] = {};
    for (const s of SETS) {
      g[su][s] = {};
      for (const b of BUCKETS) g[su][s][b] = { won: 0, n: 0, bpSaved: 0, bpFaced: 0 };
    }
  }
  return g;
}

// Accumulate one service game into a grid from the SERVER's viewpoint.
// held=true means the server won it. For the SERVE grid that's a hold; for the
// RETURN grid the same event is passed with held inverted (a return break).
function addCell(grid, surface, sKey, bucket, held, bpSaved, bpFaced) {
  for (const su of ['all', surface === 'other' ? null : surface]) {
    if (!su || !grid[su]) continue;
    const c = grid[su][sKey] && grid[su][sKey][bucket];
    if (!c) continue;
    c.n += 1;
    if (held) c.won += 1;
    c.bpFaced += bpFaced;
    c.bpSaved += bpSaved;
  }
}

function finalize(grid, mode) {
  // mode 'serve' -> report hold% (won/n); 'return' -> break% (won/n) where for
  // return grids `won` already counts breaks. Emit pct rounded, keep n.
  const out = {};
  for (const su of SURFACES) {
    out[su] = {};
    for (const s of SETS) {
      out[su][s] = {};
      for (const b of BUCKETS) {
        const c = grid[su][s][b];
        // won = holds (serve grid) or breaks (return grid). Emitting the raw
        // numerator lets the panel render the honest fraction `won/n` (e.g.
        // 24/33) with no approximation, and lets the frontend build the GLOBAL
        // column by summing won & n across sets — both exact, not pct-averaged.
        const cell = { pct: c.n ? Math.round((c.won / c.n) * 1000) / 10 : null, n: c.n, won: c.won };
        if (mode === 'serve' && c.bpFaced) {
          cell.bpSavedPct = Math.round((c.bpSaved / c.bpFaced) * 1000) / 10;
          cell.bpFaced = c.bpFaced;
        }
        out[su][s][b] = cell;
      }
    }
  }
  return out;
}

function main() {
  if (!fs.existsSync(CACHE_DIR)) {
    console.error(`build-holdbreak: ${CACHE_DIR} missing — skipping (no shard written).`);
    return;
  }
  const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));

  // First pass: find the newest date so the 24M window is anchored to the data.
  let maxDate = '0000-00-00';
  const rowsByEk = new Map();       // dedup: a match appears under both players
  for (const f of files) {
    let rows;
    try { rows = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8')); } catch (_) { continue; }
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      const ek = r && r.event_key != null ? String(r.event_key) : null;
      if (!ek || rowsByEk.has(ek)) continue;
      rowsByEk.set(ek, r);
      if (r.event_date && r.event_date > maxDate) maxDate = r.event_date;
    }
  }
  if (maxDate === '0000-00-00') { console.error('build-holdbreak: cache empty; no shard.'); return; }
  const windowStart = windowStartFrom(maxDate);

  const pooledServe = emptyGrid();
  const pooledReturn = emptyGrid();
  const players = new Map();   // key -> {name, serve, return, eks:Set}

  const stats = { matches: 0, serviceGames: 0, minDate: '9999', maxDate: '0000', skippedNoWindow: 0, skippedNonSingles: 0 };

  function playerBucket(key, name) {
    let p = players.get(key);
    if (!p) { p = { name, serve: emptyGrid(), return: emptyGrid(), eks: new Set() }; players.set(key, p); }
    else if (name && !p.name) p.name = name;
    return p;
  }

  for (const [ek, r] of rowsByEk) {
    if (!/singles/i.test(r.event_type_type || '') || /doubles/i.test(r.event_type_type || '')) { stats.skippedNonSingles++; continue; }
    if (!FINAL_STATUSES.has(r.event_status)) continue;
    if (!r.event_date || r.event_date < windowStart) { stats.skippedNoWindow++; continue; }
    const pbp = r.pointbypoint;
    if (!Array.isArray(pbp) || !pbp.length) continue;

    const surface = surfaceOf(r.tournament_key, r.tournament_name);
    const p1Key = r.first_player_key != null ? String(r.first_player_key) : null;
    const p2Key = r.second_player_key != null ? String(r.second_player_key) : null;
    const p1 = playerBucket(p1Key, r.event_first_player);
    const p2 = playerBucket(p2Key, r.event_second_player);

    // Count the server's Nth service game WITHIN each set (ordinal), in game order.
    const svcOrdinal = { 'First Player': {}, 'Second Player': {} };  // side -> {setKey: count}
    // pbp is already in game order per set; iterate as-is but sort defensively.
    const games = pbp.slice().sort((a, b) => {
      const sa = setKey(a.set_number), sb = setKey(b.set_number);
      if (sa !== sb) return (parseInt(sa) || 9) - (parseInt(sb) || 9);
      return (parseInt(a.number_game) || 0) - (parseInt(b.number_game) || 0);
    });

    let usedGame = false;
    for (const g of games) {
      const sKey = setKey(g.set_number);
      if (!sKey) continue;
      const server = g.player_served;                 // "First Player" | "Second Player"
      const winner = g.serve_winner;                  // who won the game
      if (server !== 'First Player' && server !== 'Second Player') continue;
      if (winner !== 'First Player' && winner !== 'Second Player') continue;
      const held = winner === server;                 // server won -> hold

      svcOrdinal[server][sKey] = (svcOrdinal[server][sKey] || 0) + 1;
      const ordinal = svcOrdinal[server][sKey];
      const bucket = bucketFor(ordinal);

      // break points the server FACED / SAVED this game (break_point flag names
      // the player who HAS the break point = the returner).
      let bpFaced = 0;
      const returnerName = server === 'First Player' ? 'Second Pla' : 'First Play';
      for (const pt of (g.points || [])) {
        if (pt.break_point && String(pt.break_point).startsWith(returnerName.slice(0, 6))) bpFaced += 1;
      }
      // A service game can be broken AT MOST ONCE, on exactly one converted break
      // point (the game-ending one); every earlier break point in that game was
      // necessarily saved (the game continued). So saved = all faced if the
      // server held, else faced-1. (The earlier `held ? faced : 0` zeroed out
      // every save in a broken game and understated the save rate ~26pp.)
      const bpSaved = bpFaced ? (held ? bpFaced : bpFaced - 1) : 0;

      const serverP = server === 'First Player' ? p1 : p2;
      const returnerP = server === 'First Player' ? p2 : p1;

      // SERVE grid (server viewpoint): hold?
      addCell(pooledServe, surface, sKey, bucket, held, bpSaved, bpFaced);
      addCell(serverP.serve, surface, sKey, bucket, held, bpSaved, bpFaced);
      // RETURN grid (returner viewpoint): break? (= !held)
      addCell(pooledReturn, surface, sKey, bucket, !held, 0, 0);
      addCell(returnerP.return, surface, sKey, bucket, !held, 0, 0);

      serverP.eks.add(ek); returnerP.eks.add(ek);
      stats.serviceGames += 1;
      usedGame = true;
    }
    if (usedGame) {
      stats.matches += 1;
      if (r.event_date < stats.minDate) stats.minDate = r.event_date;
      if (r.event_date > stats.maxDate) stats.maxDate = r.event_date;
    }
  }

  const playersOut = {};
  for (const [key, p] of players) {
    if (!key) continue;
    playersOut[key] = {
      name: p.name || null,
      matches: p.eks.size,
      serve: finalize(p.serve, 'serve'),
      return: finalize(p.return, 'return'),
    };
  }

  const shard = {
    meta: {
      feature: 'holdbreak-heatmap',
      ruling: 'TEN-107 2026-09-01: window=24M, axis=bucketed',
      windowMonths: WINDOW_MONTHS,
      windowStart,
      anchorDate: maxDate,
      sampleFloor: SAMPLE_FLOOR,
      buckets: BUCKETS,
      bucketDef: { early: '1st-2nd service game in set', mid: '3rd-4th', late: '5th+' },
      sets: SETS,
      surfaces: SURFACES,
      coverage: { matches: stats.matches, serviceGames: stats.serviceGames, from: stats.minDate, to: stats.maxDate },
      players: Object.keys(playersOut).length,
    },
    pooled: { serve: finalize(pooledServe, 'serve'), return: finalize(pooledReturn, 'return') },
    players: playersOut,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(shard));
  console.log(`build-holdbreak: wrote ${OUT_PATH}`);
  console.log(`  window=${WINDOW_MONTHS}M start=${windowStart} anchor=${maxDate}`);
  console.log(`  matches=${stats.matches} serviceGames=${stats.serviceGames} coverage=${stats.minDate}..${stats.maxDate} players=${shard.meta.players}`);
}

if (require.main === module) main();
module.exports = { main, bucketFor, setKey, surfaceOf, windowStartFrom };
