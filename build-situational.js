// Situational in-play rollup shard  (TEN-206 build item 3)
// =============================================================================
// The eight point-by-point rows of the Live trading "Situational" panel. The
// other six rows come from per-set outcomes and are computed in the renderer
// from recentForm, which every player on the roster carries; these eight need
// GAME-LEVEL sequence and so need this shard.
//
// SOURCE: apitennis-holdbreak-cache — the same keyed point-by-point harvest
// build-holdbreak.js reads. This is a widening of an existing harvest, not a new
// integration, and it costs ZERO API calls. Each cache row carries per game:
// set_number, number_game, player_served, serve_winner/serve_lost, and per point
// break_point / set_point / match_point.
//
// ROW DEFINITIONS. Each is stated here because several are judgement calls and
// the panel prints them as fact:
//
//   brokenFirstSvc      per MATCH. His first service game of the match.
//                       numerator = he was broken in it.
//   firstBreak          per MATCH, over matches in which any break happened.
//                       numerator = the first break of the match was his.
//   brokenBack          per OCCASION. Every time he broke and then served the
//                       next game. numerator = he was broken in that game.
//   breakBack           per OCCASION. Every time he was broken in a set.
//                       numerator = he broke back later in the SAME set.
//   lostS1FirstBreakS2  per MATCH, over matches where he lost set 1 and set 2
//                       contained a break. numerator = the first break of set 2
//                       was his.
//   holdWinSet          per OCCASION. His service games where holding WINS the
//                       set — he leads 5-3, 5-4 or 6-5 in games. numerator = held.
//   holdStaySet         per OCCASION. His service games where losing the game
//                       LOSES the set — he trails 3-5, 4-5 or 5-6. numerator = held.
//   breakOppServing     per OCCASION. Opponent service games where the opponent
//                       would win the set by holding. numerator = he broke.
//
// Game standings are reconstructed by COUNTING games won in order, never by
// parsing the `score` string: the count is exact and cannot drift with a format
// change upstream.
//
// A match can land in several rows. The panel's footnote says so.
// =============================================================================

const fs = require('fs');
const path = require('path');

// The cache lives beside whichever clone harvested it. The daily styles bot
// runs this from its own clone (~/.bsp-splits-cron/SAAS-styles), so both paths
// are overridable rather than pinned to __dirname — that is also what lets the
// shard be rebuilt and checked from the working clone without touching the
// bot's tree.
const CACHE_DIR = process.env.SITUATIONAL_CACHE_DIR
  || path.join(__dirname, 'apitennis-holdbreak-cache');
const OUT_PATH = process.env.SITUATIONAL_OUT
  || path.join(__dirname, 'situational.json');
const WINDOW_MONTHS = 24;
const SAMPLE_FLOOR = 10;             // display hint only; every row keeps its own n
const FINAL_STATUSES = new Set(['Finished', 'Retired', 'Walk Over']);

const ROW_IDS = [
  'brokenFirstSvc', 'firstBreak', 'brokenBack', 'breakBack',
  'lostS1FirstBreakS2', 'holdWinSet', 'holdStaySet', 'breakOppServing',
];

function windowStartFrom(maxDate) {
  const d = new Date(maxDate + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() - WINDOW_MONTHS);
  return d.toISOString().slice(0, 10);
}

// Lifted from build-holdbreak.js, tiebreak rule included. api-tennis labels a
// set "Set 1", not "1" — parsing it as a bare integer yields NaN and silently
// drops EVERY game, which is exactly what the first run of this builder did
// (0 matches folded, 668 players bucketed). It also emits a tiebreak as
// "Set N TieBreak" with a SEPARATE row per mini-serve; folding those into the
// numeric set would invent six to eight phantom service games at 6-6, the very
// place "serving for the set" is read.
function setKey(setNumberRaw) {
  const raw = String(setNumberRaw);
  if (/tie/i.test(raw)) return null;
  const n = parseInt(raw.replace(/[^0-9]/g, ''), 10);
  if (!n) return null;
  return n >= 5 ? '5' : String(n);
}

// Set winners come from the row's own per-set scores, NOT from counting games:
// the tiebreak rows are dropped above, so a 7-6 set would otherwise read 6-6 and
// fall to whichever side the comparison happened to favour.
function setWinnersFrom(scores) {
  const out = {};
  if (!Array.isArray(scores)) return out;
  for (const s of scores) {
    const k = setKey(s && s.score_set);
    const a = parseInt(s && s.score_first, 10), b = parseInt(s && s.score_second, 10);
    if (!k || !isFinite(a) || !isFinite(b) || a === b) continue;
    out[k] = a > b ? 'First Player' : 'Second Player';
  }
  return out;
}

function emptyRows() {
  const o = {};
  for (const id of ROW_IDS) o[id] = { w: 0, l: 0 };
  return o;
}

function add(rows, id, won) {
  const r = rows[id];
  if (won) r.w++; else r.l++;
}

// Does winning this service game win the set for the SERVER? Standard set: reach
// 6 with a 2-game margin, or 7-5. From (mine, theirs) BEFORE the game, holding
// wins the set at 5-3, 5-4 and 6-5 — and nowhere else (at 5-5 holding gives 6-5,
// at 6-6 the tiebreak decides).
function holdWinsSet(mine, theirs) {
  return (mine === 5 && (theirs === 3 || theirs === 4)) || (mine === 6 && theirs === 5);
}
// Does losing this service game lose the set for the SERVER? The mirror image.
function lossEndsSet(mine, theirs) {
  return (theirs === 5 && (mine === 3 || mine === 4)) || (theirs === 6 && mine === 5);
}

// Walk one match's point-by-point and fold it into both players' row counters.
// Exported for the unit tests, which drive it with hand-built fixtures — the
// cache is CI-side and gitignored, so a local "the cache is empty" read proves
// nothing about this function.
function foldMatch(pbp, sideRows, scores) {
  const games = pbp.slice().sort((a, b) => {
    const sa = setKey(a.set_number), sb = setKey(b.set_number);
    if (sa !== sb) return (parseInt(sa, 10) || 9) - (parseInt(sb, 10) || 9);
    return (parseInt(a.number_game, 10) || 0) - (parseInt(b.number_game, 10) || 0);
  });

  const SIDES = ['First Player', 'Second Player'];
  const other = (s) => (s === 'First Player' ? 'Second Player' : 'First Player');

  // per-match state
  const firstSvcDone = { 'First Player': false, 'Second Player': false };
  let firstBreakOwner = null;                 // side that got the match's first break
  const setWinner = setWinnersFrom(scores);   // setKey -> side, from the row's scores
  const firstBreakInSet = {};                 // setKey -> side
  let used = false;

  // per-set state, rebuilt as the set changes
  let curSet = null;
  let gamesWon = { 'First Player': 0, 'Second Player': 0 };
  let brokenOpen = { 'First Player': false, 'Second Player': false };  // broken, not yet broken back
  let lastBreaker = null;                     // who broke the immediately preceding game

  for (const g of games) {
    const sKey = setKey(g.set_number);
    if (!sKey) continue;
    const server = g.player_served;
    const winner = g.serve_winner;
    if (SIDES.indexOf(server) < 0 || SIDES.indexOf(winner) < 0) continue;

    if (sKey !== curSet) {
      if (curSet !== null) {
        // A set that ENDS with an unanswered break is a break that was never
        // broken back. Settling this only at the end of the match would drop
        // every set but the last out of the denominator.
        for (const s of SIDES) if (brokenOpen[s]) add(sideRows[s], 'breakBack', false);
      }
      curSet = sKey;
      gamesWon = { 'First Player': 0, 'Second Player': 0 };
      brokenOpen = { 'First Player': false, 'Second Player': false };
      lastBreaker = null;
    }

    const returner = other(server);
    const held = winner === server;
    const mine = gamesWon[server], theirs = gamesWon[returner];

    // ── serving for / to stay in the set ────────────────────────────────────
    if (holdWinsSet(mine, theirs)) {
      add(sideRows[server], 'holdWinSet', held);
      add(sideRows[returner], 'breakOppServing', !held);
    }
    if (lossEndsSet(mine, theirs)) {
      add(sideRows[server], 'holdStaySet', held);
    }

    // ── broken back immediately after breaking ──────────────────────────────
    // The server broke the game before this one, and is now serving.
    if (lastBreaker === server) add(sideRows[server], 'brokenBack', !held);

    // ── first service game of the match ─────────────────────────────────────
    if (!firstSvcDone[server]) {
      firstSvcDone[server] = true;
      add(sideRows[server], 'brokenFirstSvc', !held);
    }

    if (!held) {
      if (!firstBreakOwner) firstBreakOwner = returner;
      if (!firstBreakInSet[sKey]) firstBreakInSet[sKey] = returner;
      // the SERVER has now been broken in this set, and can break back
      brokenOpen[server] = true;
      // ...and if the returner was himself broken earlier in this set, this is
      // the break back.
      if (brokenOpen[returner]) {
        add(sideRows[returner], 'breakBack', true);
        brokenOpen[returner] = false;
      }
      lastBreaker = returner;
    } else {
      lastBreaker = null;
    }

    gamesWon[winner] += 1;
    used = true;
  }

  if (!used) return false;
  // The final set never hits the rollover above, so it is settled here.
  for (const s of SIDES) if (brokenOpen[s]) add(sideRows[s], 'breakBack', false);

  // ── first break of the match ────────────────────────────────────────────────
  if (firstBreakOwner) {
    for (const s of SIDES) add(sideRows[s], 'firstBreak', s === firstBreakOwner);
  }

  // ── lost set 1, first break in set 2 ───────────────────────────────────────
  if (setWinner['1'] && firstBreakInSet['2']) {
    const loser = other(setWinner['1']);
    add(sideRows[loser], 'lostS1FirstBreakS2', firstBreakInSet['2'] === loser);
  }
  return true;
}

function main() {
  if (!fs.existsSync(CACHE_DIR)) {
    console.error('build-situational: cache dir absent; no shard written.');
    return;
  }
  const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json'));

  const rowsByEk = new Map();
  let maxDate = '0000-00-00';
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
  if (maxDate === '0000-00-00') { console.error('build-situational: cache empty; no shard.'); return; }
  const windowStart = windowStartFrom(maxDate);

  const players = new Map();      // key -> {name, rows, matches}
  const pooled = emptyRows();
  const stats = { matches: 0, minDate: '9999', maxDate: '0000' };

  function bucket(key, name) {
    let p = players.get(key);
    if (!p) { p = { name: name || null, rows: emptyRows(), matches: 0 }; players.set(key, p); }
    else if (name && !p.name) p.name = name;
    return p;
  }

  for (const [, r] of rowsByEk) {
    if (!/singles/i.test(r.event_type_type || '') || /doubles/i.test(r.event_type_type || '')) continue;
    if (!FINAL_STATUSES.has(r.event_status)) continue;
    if (r.event_status === 'Walk Over') continue;      // no play, no situation
    if (!r.event_date || r.event_date < windowStart) continue;
    const pbp = r.pointbypoint;
    if (!Array.isArray(pbp) || !pbp.length) continue;

    const p1Key = r.first_player_key != null ? String(r.first_player_key) : null;
    const p2Key = r.second_player_key != null ? String(r.second_player_key) : null;
    if (!p1Key || !p2Key) continue;
    const p1 = bucket(p1Key, r.event_first_player);
    const p2 = bucket(p2Key, r.event_second_player);

    // Fold into a scratch pair first so a match that turns out to carry no usable
    // game cannot increment either player's match count.
    const scratch = { 'First Player': emptyRows(), 'Second Player': emptyRows() };
    if (!foldMatch(pbp, scratch, r.scores)) continue;

    for (const [side, target] of [['First Player', p1], ['Second Player', p2]]) {
      for (const id of ROW_IDS) {
        target.rows[id].w += scratch[side][id].w;
        target.rows[id].l += scratch[side][id].l;
        pooled[id].w += scratch[side][id].w;
        pooled[id].l += scratch[side][id].l;
      }
      target.matches += 1;
    }
    stats.matches += 1;
    if (r.event_date < stats.minDate) stats.minDate = r.event_date;
    if (r.event_date > stats.maxDate) stats.maxDate = r.event_date;
  }

  const playersOut = {};
  for (const [k, v] of players) {
    if (!/^\d+$/.test(k)) continue;
    playersOut[k] = { name: v.name, matches: v.matches, rows: v.rows };
  }

  const tour = {};
  for (const id of ROW_IDS) {
    const t = pooled[id].w + pooled[id].l;
    tour[id] = { w: pooled[id].w, l: pooled[id].l, pct: t ? Math.round((pooled[id].w / t) * 1000) / 10 : null };
  }

  const shard = {
    meta: {
      builtAt: new Date().toISOString(),
      windowMonths: WINDOW_MONTHS,
      sampleFloor: SAMPLE_FLOOR,
      rows: ROW_IDS,
      coverage: { matches: stats.matches, from: stats.minDate, to: stats.maxDate },
      players: Object.keys(playersOut).length,
    },
    tour,
    players: playersOut,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(shard));
  console.log(`build-situational: wrote ${OUT_PATH}`);
  console.log(`  window=${WINDOW_MONTHS}M start=${windowStart} anchor=${maxDate}`);
  console.log(`  matches=${stats.matches} players=${shard.meta.players} coverage=${stats.minDate}..${stats.maxDate}`);
  for (const id of ROW_IDS) console.log(`  ${id.padEnd(20)} ${tour[id].w}-${tour[id].l}  ${tour[id].pct}%`);
}

if (require.main === module) main();
module.exports = {
  main, foldMatch, setWinnersFrom, emptyRows, holdWinsSet, lossEndsSet, ROW_IDS,
};
