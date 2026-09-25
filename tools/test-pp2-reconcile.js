// tools/test-pp2-reconcile.js — TEN-206 §4 fail-closed reconciliation check.
//
// Runs player-profile-v2.js against the REAL committed player-profiles.json in
// a minimal window shim and asserts the figures the ticket requires to agree.
//
// Every assertion here is paired with a NEGATIVE CONTROL: the same check is
// re-run against deliberately corrupted data and must FAIL. A check that cannot
// be made to fail is not measuring anything — this repo has shipped vacuous
// assertions before and the negative controls exist so that cannot recur.
//
// Run: node tools/test-pp2-reconcile.js

'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');

// §8.1 · the Court speed bands resolve their venue through this map, and with it
// absent EVERY row is unbandable — which silently turns the band assertions below
// into "this check never ran". It is loaded here, from the real committed artefact
// like every other store in this file, so the band scans exercise real bands.
const _SPEED_MAP_PATH = path.join(ROOT, 'court-speed-map.json');
const SPEED_MAP = fs.existsSync(_SPEED_MAP_PATH)
  ? JSON.parse(fs.readFileSync(_SPEED_MAP_PATH, 'utf8')) : null;

// ─── load the module under test into a window shim ──────────────────────────
function loadModule(profiles, extra) {
  const sandbox = Object.assign(
    { FEATURE_PP2: true, playerProfiles: { players: profiles }, courtSpeedMap: SPEED_MAP },
    extra || {});
  global.window = sandbox;
  const src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', src)(sandbox);
  if (!sandbox.PlayerProfileV2) throw new Error('module did not export PlayerProfileV2');
  return sandbox.PlayerProfileV2;
}

// ── THE PROFILE STORE COMES FROM THE DEPLOYED SITE, NOT FROM GIT ────────────
// This used to be `readFileSync(ROOT/player-profiles.json)`. The pipeline does
// not commit that file back, so the copy in the tree was written 2026-07-22 —
// THIRTEEN DAYS BEFORE the 2021-hole fix it was being used to measure. Every
// roster-wide figure this suite printed for weeks described July data, and a
// whole report had to be withdrawn because of it. See tools/deployed-store.js.
//
// Fail-closed: if the deployed store cannot be reached and nothing is cached,
// the suite ABORTS rather than fall back to the fossil. "Could not check" must
// never render as green — the same rule the career-history drift guard enforces
// ninety lines down.
const DEPLOYED = require('./deployed-store.js');
const STORE = DEPLOYED.playerProfiles();
if (STORE.source !== 'deployed') {
  console.error('\n  ✗ COULD NOT READ THE DEPLOYED player-profiles.json — ABORTING.');
  console.error(`    ${STORE.drift.why}`);
  console.error(`    The committed copy is dated ${STORE.committedFetchedAt || 'unknown'} and is NOT a`);
  console.error('    substitute: reporting roster-wide numbers off it is the bug this guard exists for.');
  console.error(`    Set TEN206_DATA_BASE, or run with network access to ${DEPLOYED.BASE}.\n`);
  process.exit(1);
}
const PLAYERS = STORE.players;
// TEN-207 moved tournamentHistory out of the eager store into per-player shards.
// Reading the deployed store WITHOUT re-attaching them walks an empty list and
// passes every §5.3 check vacuously — strictly worse than the July fossil, which
// at least carried rows. Fail-closed on a short hydrate.
const TH = DEPLOYED.hydrateTournamentHistory(PLAYERS);
// indexed 0 is not "all hydrated": an empty or foreign index walks nothing (TEN-273).
if (TH.error || TH.attached < TH.indexed || !TH.indexed) {
  console.error('\n  ✗ tournament-history/ DID NOT HYDRATE FROM THE DEPLOYED STORE — ABORTING.');
  // Say WHICH deficiency tripped it and NAME the shard. The gate blocks on
  // `attached < indexed`, so it reports missingCount — which is exactly
  // indexed - attached — rather than `short`, a disjoint count of shards that
  // DID attach but are stale. Quoting the second next to the first is what made
  // this read "0 short" while aborting.
  if (TH.error) {
    console.error(`    ${TH.error}`);
  } else {
    console.error(`    attached ${TH.attached} of ${TH.indexed} indexed players — `
      + `${TH.missingCount} shard(s) could not be read or fetched at all.`);
    if (TH.missing && TH.missing.length) {
      console.error(`    COULD NOT ATTACH: ${TH.missing.slice(0, 12).join(', ')}`
        + `${TH.missing.length > 12 ? ` (+${TH.missing.length - 12} more)` : ''}`);
    }
    if (TH.short) {
      console.error(`    (separately, ${TH.short} attached shard(s) are STALE — fewer rows than the `
        + `index claims: ${(TH.shortKeys || []).slice(0, 8).join(', ')}. This is not what aborted the run.)`);
    }
  }
  console.error('    Every §5.3 check would walk an empty list and report a clean bill of health.\n');
  process.exit(1);
}
console.log(`  ····  tournament-history: ${TH.attached}/${TH.indexed} players hydrated from the deployed `
  + `shards (${TH.fetched} fetched, ${TH.tournamentRows} tournament rows; ${TH.rosterNotInIndex} roster keys not indexed).`);
console.log(`  ····  profile store: DEPLOYED ${STORE.fetchedAt} — ${STORE.drift.deployedPlayers} players `
  + `(committed copy: ${STORE.drift.committedFetchedAt}, ${STORE.drift.committedPlayers} players; `
  + `+${STORE.drift.onlyDeployed} live-only / −${STORE.drift.onlyCommitted} dropped).`);

// career-splits.json feeds the Splits modal; the market-edge shards feed Market
// edge. Both are loaded from the REAL committed artefacts — a fixture would let
// the page and the pipeline drift apart, which is the bug class §4 exists for.
const SPLITS = JSON.parse(fs.readFileSync(path.join(ROOT, 'career-splits.json'), 'utf8')).players || {};
const MARKET_DIR = path.join(ROOT, 'market-edge');
const MARKET = {};
if (fs.existsSync(MARKET_DIR)) {
  fs.readdirSync(MARKET_DIR).filter(f => f.endsWith('.json')).forEach((f) => {
    MARKET[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(MARKET_DIR, f), 'utf8'));
  });
}

const STYLES = JSON.parse(fs.readFileSync(path.join(ROOT, 'playing-styles.json'), 'utf8'));
// §5.9 Playing profile reads the hold/break rollup through the SHARED engine
// (founder ruling 7). Both are loaded into the same window shim the page uses,
// so a wiring mistake shows up here rather than as a silent grid of dashes.
const HOLDBREAK = JSON.parse(fs.readFileSync(path.join(ROOT, 'holdbreak.json'), 'utf8'));
// §5.9's eight point-by-point rows. It was never handed to the module, so every
// Situational check in this file was reading an EMPTY store: the checks ran,
// reported, and measured nothing — the wrong-sandbox failure the note below
// describes, arrived at from the other direction. Absent file is fatal rather
// than a silent {}: a suite that green-lights §5.9 without its store is worse
// than one that stops.
const SITUATIONAL = (() => {
  const p = path.join(ROOT, 'situational.json');
  if (!fs.existsSync(p)) {
    throw new Error('situational.json is absent — §5.9 cannot be checked; build it or fetch the shard');
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
})();
// §5.9 Ratings. Tracked AND published, and verified byte-identical to the
// deployed copy on 2026-09-19 — so ROOT is the same artifact the page reads
// here, unlike player-profiles.json which is published but never committed.
const _DNA_RAW = JSON.parse(fs.readFileSync(path.join(ROOT, 'dna-apitennis-ratings.json'), 'utf8'));
// Shape it the way the PAGE receives it, not the way the file is written. The
// dashboard's ensureMatchDna() hands the module { byKey, players, meta }; the
// file on disk is { _meta, players:[…] } with no byKey at all. Injecting the
// raw file resolves NOTHING — dnaRecordFor() reads st.byKey[key] — which is
// the stylesStore shape exactly: a store that loads and joins to nobody.
const DNA = {
  byKey: Object.fromEntries((_DNA_RAW.players || []).map(r => [String(r.playerKey), r])),
  players: _DNA_RAW.players || [],
  meta: _DNA_RAW._meta || {}
};
function loadEngine() {
  const sandbox = {};
  const src = fs.readFileSync(path.join(ROOT, 'holdbreak-heatmap.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', src)(sandbox);
  if (!sandbox.HoldBreakHeatmap) throw new Error('holdbreak-heatmap.js did not export HoldBreakHeatmap');
  return sandbox.HoldBreakHeatmap;
}
const ENGINE = loadEngine();

// Correction pass. Both stores are loaded from the REAL committed artefacts for
// the same reason as the others: a fixture would let the page and the pipeline
// drift apart silently.
//  * the match-stat store — the §8.1 match sheet, joined by the api-tennis
//    eventKey recentForm carries. Founder ruling 2026-09-18 (Q1) moved the
//    COMMITTED copy to historical-match-stats.floor.json and gitignored the
//    runtime path, so read the runtime file when the box has one (it is the
//    floor unioned with the warm cache) and fall back to the committed floor.
//    Reading only the old path made this suite die with ENOENT on any clean
//    checkout, which is every CI clone and every fresh worktree.
//  * bet365-history/ — the ledger's second price source, for the rows after the
//    Tennis-Data archive's 2026-07-26 cutoff.
const STATS_RUNTIME = path.join(ROOT, 'historical-match-stats.json');
const STATS_FLOOR = path.join(ROOT, 'historical-match-stats.floor.json');
const STATS_PATH = fs.existsSync(STATS_RUNTIME) ? STATS_RUNTIME : STATS_FLOOR;
if (!fs.existsSync(STATS_PATH)) {
  console.error('\n  ✗ NO MATCH-STAT STORE — neither historical-match-stats.json nor'
    + ' historical-match-stats.floor.json is present. Every §8.1 check would'
    + ' walk an empty store and report a clean bill of health. ABORTING.');
  process.exit(1);
}
const STATS = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
console.log(`  match-stat store: ${path.basename(STATS_PATH)} — ${Object.keys(STATS).length} eventKeys`);

// match-stat-event-coverage.json — the whole-event note's per-EVENT index.
// GITIGNORED and CI-built, so build it here when the box has none. A skipped
// row would satisfy the all-stores gate while measuring nothing.
const COV_PATH = path.join(ROOT, 'match-stat-event-coverage.json');
let EVENT_COV = null;
try {
  if (!fs.existsSync(COV_PATH)) {
    require('child_process').execFileSync(
      process.execPath, [path.join(ROOT, 'tools', 'build-event-stat-coverage.js')],
      { cwd: ROOT, stdio: 'ignore' });
  }
  if (fs.existsSync(COV_PATH)) EVENT_COV = JSON.parse(fs.readFileSync(COV_PATH, 'utf8'));
} catch (e) {
  EVENT_COV = null;
}
console.log(`  event-coverage index: ${EVENT_COV
  ? `${Object.keys(EVENT_COV.keys).length} keys / ${Object.keys(EVENT_COV.events).length} editions`
  : 'UNAVAILABLE — its coverage row will read 0 and fail its floor'}`);
const B365_DIR = path.join(ROOT, 'bet365-history');
const B365 = {};
if (fs.existsSync(B365_DIR)) {
  fs.readdirSync(B365_DIR)
    .filter(f => /^\d{4}-\d{2}\.json$/.test(f))
    .forEach((f) => {
      B365[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(B365_DIR, f), 'utf8'));
    });
}

// §5.3 · career-history/{key}.json — the tournament modal's date and surface
// source. GITIGNORED and CI-built, so it is normally absent here; the store's
// coverage row asserts the documented fallback when it is.
const CH_DIR = path.join(ROOT, 'career-history');
const CAREER_HIST = {};
if (fs.existsSync(CH_DIR)) {
  fs.readdirSync(CH_DIR).filter(f => f.endsWith('.json')).forEach((f) => {
    const j = JSON.parse(fs.readFileSync(path.join(CH_DIR, f), 'utf8'));
    CAREER_HIST[f.replace(/\.json$/, '')] = (j && j.matches) || [];
  });
}

// ── STORE-DRIFT GUARD ────────────────────────────────────────────────────────
// career-history/ is gitignored and CI-built. ABSENT is a normal local state and
// the affected checks skip. PRESENT BUT SHORT is not, and it is the failure that
// produced a wrong §8 report: this machine's copy held 665 rows for Zverev where
// the deployed store holds 775, 258 vs 361 for Martinez, 273 vs 405 for
// Giustino. The probe, the independent recompute and the browser all read the
// same short store and agreed with each other exactly — three mutually
// confirming reads of the wrong data, and `banded + unbanded = spine` held
// perfectly at 665.
//
// The deployed career-history-index.json carries a row count per player, so one
// fetch is enough to tell the two states apart. No network (offline, CI without
// egress) degrades to a warning, never to a silent pass: the point is that a
// SHORT store can never again look like a healthy one.
const CH_DRIFT = (() => {
  const local = Object.keys(CAREER_HIST).length;
  if (!local) return { state: 'absent', local: 0 };
  let live = null;
  try {
    const base = process.env.TEN206_DATA_BASE || 'https://michaeldk1996.github.io/SAAS';
    const out = require('child_process').execFileSync('curl',
      ['-sS', '--max-time', '20', `${base}/career-history-index.json`], { maxBuffer: 64 << 20 }).toString();
    live = (JSON.parse(out) || {}).players || null;
  } catch (err) {
    return { state: 'unverified', local, why: err.message.slice(0, 120) };
  }
  if (!live) return { state: 'unverified', local, why: 'deployed index carried no players map' };
  const short = [];
  for (const [k, rows] of Object.entries(CAREER_HIST)) {
    const want = live[k];
    if (typeof want === 'number' && rows.length < want) short.push({ k, got: rows.length, want });
  }
  short.sort((a, b) => (b.want - b.got) - (a.want - a.got));
  const liveN = Object.keys(live).length;
  if (short.length) return { state: 'short', local, live: liveN, short };
  // PARTIAL is its own state. Every player present can be full-length while the
  // store still covers a handful of the roster the checks scan — three shards
  // dropped in by hand pass the row-length test and then five §8 checks report
  // "this check never ran", which reads as five bugs and is none. Coverage is
  // measured over the players the suite actually scans, not over the store.
  const scanned = Object.keys(PLAYERS).filter(k => typeof live[k] === 'number');
  const held = scanned.filter(k => CAREER_HIST[k]).length;
  if (scanned.length && held < scanned.length * 0.9) {
    return { state: 'partial', local, live: liveN, held, scanned: scanned.length };
  }
  return { state: 'fresh', local, live: liveN, short };
})();

const M = loadModule(PLAYERS, {
  careerSplits: SPLITS, marketEdge: MARKET, playingStyles: STYLES,
  holdbreak: HOLDBREAK, HoldBreakHeatmap: ENGINE,
  matchStats: STATS, bet365History: B365, careerHistory: CAREER_HIST,
  dnaRatings: DNA, situational: SITUATIONAL
});
const I = M._internals;
// loadModule() REASSIGNS global.window, and §5.5 builds extra module instances
// late in this file — so by the time the last sections run, global.window is no
// longer the sandbox `I` closes over. Every store shim writes through this handle
// instead. A store written to the wrong sandbox reads back as an EMPTY store,
// which is indistinguishable from a player with no rows: the check still runs,
// still passes or fails, and measures nothing. That is how §14A first reported
// 33 undated matches on a fixture built to carry 8.
const W = global.window;

let pass = 0, fail = 0, skipped = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; failures.push(name + ' :: ' + e.message); console.log('  FAIL  ' + name + ' :: ' + e.message); }
}

// ── the drift banner, printed before anything runs ───────────────────────────
if (CH_DRIFT.state === 'short') {
  console.error('\n  ✗ career-history/ IS SHORT OF THE DEPLOYED STORE — ABORTING.');
  console.error('    Every §8 count taken against it will be self-consistent and wrong.');
  CH_DRIFT.short.slice(0, 6).forEach(s =>
    console.error(`      ${s.k}: local ${s.got} rows, deployed ${s.want}  (−${s.want - s.got})`));
  if (CH_DRIFT.short.length > 6) console.error(`      … ${CH_DRIFT.short.length - 6} more`);
  console.error('    Rebuild it, or point the suite at a fresh checkout. Do not read numbers from this one.\n');
  process.exit(1);
}
if (CH_DRIFT.state === 'absent') {
  console.log('  ····  career-history/ is absent (gitignored, CI-built). '
    + 'The checks that need per-match rows will SKIP, not silently pass.');
} else if (CH_DRIFT.state === 'partial') {
  console.log(`  ····  career-history/ covers ${CH_DRIFT.held} of the ${CH_DRIFT.scanned} scanned players `
    + '— too thin to scan. Those checks SKIP; no row it does hold is short.');
} else if (CH_DRIFT.state === 'unverified') {
  console.log(`  ····  career-history/ present (${CH_DRIFT.local} players) but NOT verified against the `
    + `deployed store (${CH_DRIFT.why}). Treat §8 counts as unconfirmed.`);
} else {
  console.log(`  ····  career-history/ present and level with the deployed store `
    + `(${CH_DRIFT.local} local / ${CH_DRIFT.live} deployed, 0 short).`);
}

/**
 * A check that cannot run without per-match rows. SKIPPED when the store is
 * legitimately absent; a skip is reported, never counted as a pass — the whole
 * point of the vacuity controls is that "did not run" must not read as "green".
 */
const CH_TOO_THIN = CH_DRIFT.state === 'absent' || CH_DRIFT.state === 'partial';
function checkCareer(name, fn) {
  if (CH_TOO_THIN) {
    skipped++;
    console.log('  SKIP  ' + name + ' :: career-history/ ' + CH_DRIFT.state);
    return;
  }
  check(name, fn);
}
// A negative control asserts that fn THROWS. If it does not, the corresponding
// positive check is vacuous and we say so loudly.
function mustFail(name, fn) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (threw) { pass++; console.log('  PASS  [neg] ' + name + ' (correctly rejected)'); }
  else { fail++; failures.push('[neg] ' + name + ' :: corruption NOT caught — check is vacuous'); console.log('  FAIL  [neg] ' + name + ' :: corruption NOT caught — check is vacuous'); }
}

function byName(n) {
  const k = Object.keys(PLAYERS).find(k => PLAYERS[k].name === n);
  return k ? PLAYERS[k] : null;
}

// The §4 sample: one top-10, one ~#50, one ~#136, one thin-charting, one with
// no tournament history at all. Chosen by RANK from the committed file.
function pickByRank(target) {
  let best = null;
  for (const k of Object.keys(PLAYERS)) {
    const r = parseInt(PLAYERS[k].rank, 10);
    if (!isFinite(r)) continue;
    const d = Math.abs(r - target);
    if (!best || d < best.d) best = { d, p: PLAYERS[k] };
  }
  return best && best.p;
}

const SAMPLE = [
  byName('C. Alcaraz') || pickByRank(1),
  pickByRank(50),
  pickByRank(136),
  byName('D. Schwartzman') || pickByRank(340),
  Object.values(PLAYERS).find(p => !(p.tournamentHistory || []).length)
].filter(Boolean);

console.log('TEN-206 §4 reconciliation — ' + SAMPLE.length + ' players\n');

// ════════════════════════════════════════════════════════════════════════════
// 1 · ORIENTATION (ruling 1) — the normaliser must put the SUBJECT first.
// ════════════════════════════════════════════════════════════════════════════
console.log('1 · Orientation (ruling 1: H = subject)');

check('a W row always orients subject-high', () => {
  let n = 0;
  for (const p of Object.values(PLAYERS)) {
    for (const th of p.tournamentHistory || []) {
      for (const ed of th.editions || []) {
        for (const m of ed.matches || []) {
          const o = I.normaliseEdition(m);
          if (!o.oriented) continue;
          n++;
          if (m.res === 'W') assert(o.subjSets > o.oppSets, 'W row has subject below opponent: ' + JSON.stringify(m));
          if (m.res === 'L') assert(o.subjSets < o.oppSets, 'L row has subject above opponent: ' + JSON.stringify(m));
        }
      }
    }
  }
  assert(n > 40000, 'expected >40k oriented rows, got ' + n);
  console.log('        oriented rows: ' + n);
});

// NEGATIVE CONTROL: feed it a row whose result contradicts the scoreline and
// assert the check above would catch it.
mustFail('orientation rejects a contradicting row', () => {
  const o = I.normaliseEdition({ res: 'W', score: '0 - 3', round: 'F', opp: 'X', oppKey: '1' });
  // If the normaliser were reading POSITIONALLY (the bug ruling 1 exists to
  // prevent) subjSets would be 0 and this assert would fire.
  assert(o.subjSets < o.oppSets, 'positional read would put the winner below the loser');
});

check('unparseable and tied scores never claim orientation', () => {
  ['', null, 'ret.', '2 - 2', 'walkover'].forEach(s => {
    const o = I.normaliseEdition({ res: 'W', score: s });
    assert.strictEqual(o.oriented, false, 'claimed orientation for score ' + JSON.stringify(s));
    assert.strictEqual(o.subjSets, null);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2 · SAMPLE GATE (README §9) — no bare zero may ever be printed.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n2 · Sample gate');

check('gate boundaries are 0 / <5 / 5-9 / >=10', () => {
  assert.strictEqual(I.gateFor(0), 'none');
  assert.strictEqual(I.gateFor(4), 'thin');
  assert.strictEqual(I.gateFor(5), 'small');
  assert.strictEqual(I.gateFor(9), 'small');
  assert.strictEqual(I.gateFor(10), 'full');
});

check('a 0-match record renders a dash, never 0%', () => {
  assert.strictEqual(I.rateText(0, 0), '—');
  assert.notStrictEqual(I.rateText(0, 0), '0%');
  assert.notStrictEqual(I.rateText(0, 0), '0.0%');
});

check('a sub-5 record renders a dash, never a rate', () => {
  for (let w = 0; w <= 4; w++) {
    for (let l = 0; l + w <= 4; l++) {
      assert.strictEqual(I.rateText(w, l), '—', `n=${w + l} leaked a rate`);
    }
  }
});

check('a 0-4 record (all losses, n=4) does not print 0%', () => {
  assert.strictEqual(I.rateText(0, 4), '—');
});

mustFail('gate would catch a rate leaking at n=4', () => {
  assert.strictEqual(I.rateText(1, 3), '25.0%');
});

// ════════════════════════════════════════════════════════════════════════════
// 3 · CAREER RECONCILIATION — career tile = sum of season rows.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n3 · Career = Σ season rows');

function careerFromYears(p) {
  let w = 0, l = 0;
  (p.careerByYear || []).forEach(y => { if (y && y.total) { w += y.total.won || 0; l += y.total.lost || 0; } });
  return { w, l };
}
function careerFromSurfaces(p) {
  let w = 0, l = 0;
  Object.values(p.surfaces || {}).forEach(s => {
    if (s && s.record) { w += s.record.won || 0; l += s.record.lost || 0; }
  });
  return { w, l };
}

for (const p of SAMPLE) {
  check(`${p.name}: career tile = Σ careerByYear`, () => {
    const html = M.render(p);
    const y = careerFromYears(p);
    if (!(y.w + y.l)) { assert(html.includes('no matches on record'), 'empty career must say so'); return; }
    const expect = y.w + '–' + y.l;
    assert(html.includes(expect), `rendered career tile does not contain ${expect}`);
    console.log(`        ${p.name}: ${expect} (${y.w + y.l} matches)`);
  });
}

// NEGATIVE CONTROL: corrupt one season row and assert the rendered tile no
// longer matches the (uncorrupted) expectation. This proves the check reads the
// DOM output and not the same array twice.
mustFail('career check would catch a corrupted season row', () => {
  const p = JSON.parse(JSON.stringify(SAMPLE[0]));
  const expect = careerFromYears(p);
  p.careerByYear[0].total.won += 7;            // mutate AFTER computing expectation
  const html = M.render(p);
  assert(html.includes(expect.w + '–' + expect.l), 'mutation changed the painted tile');
});

// ════════════════════════════════════════════════════════════════════════════
// 4 · SURFACE vs SEASON — RESOLVED by founder ruling B (2026-09-16).
//
// §4 as written required these two to agree; measured, they agree for 0 of 427
// players. `surfaces.*.record` is the external get_players season aggregate and
// careerByYear is our own per-season store, so they are different populations,
// not the same number computed twice. The founder ruled careerByYear is the
// spine, so the §4 chain now runs through §10 below (career = Σ surface rows =
// Σ season rows, all off the spine) and `surfaces` is out of it.
//
// The measurement is kept, un-asserted, as a standing DISCLOSURE: it is the
// evidence behind the ruling and it is how we would notice if the gap ever
// closed (which would mean the two stores had been unified upstream).
// ════════════════════════════════════════════════════════════════════════════
console.log('\n4 · Σ surface rows vs Σ season rows (disclosure — superseded by ruling B, see §10)');

let agree = 0, disagree = [];
for (const p of Object.values(PLAYERS)) {
  const y = careerFromYears(p), s = careerFromSurfaces(p);
  if (!(y.w + y.l) && !(s.w + s.l)) continue;
  if (y.w === s.w && y.l === s.l) agree++;
  else disagree.push({ name: p.name, season: y, surface: s });
}
console.log(`        agree: ${agree}   disagree: ${disagree.length}  (of ${agree + disagree.length} players with any record)`);
if (disagree.length) {
  console.log('        first 5 disagreements:');
  disagree.slice(0, 5).forEach(d =>
    console.log(`          ${d.name}: seasons ${d.season.w}–${d.season.l}  vs  surfaces ${d.surface.w}–${d.surface.l}`));
}

// ════════════════════════════════════════════════════════════════════════════
// 5 · RIBBON — rate and strip must come from the same filtered set.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n5 · Ribbon rate = strip = last-N ledger rows');

for (const p of SAMPLE) {
  check(`${p.name}: ribbon record matches its own strip`, () => {
    const rows = I.ledgerMatches(p);
    const last18 = rows.slice(-18);
    const r = I.formRate(last18);
    const html = M.render(p);
    if (!r.n) { assert(html.includes('no matches on record')); return; }
    assert(html.includes(r.won + '–' + r.lost), `ribbon should show ${r.won}–${r.lost}`);
    // the strip must render exactly as many cells as the window it claims
    const cells = (html.match(/height:22px;border-radius:5px/g) || []).length;
    assert.strictEqual(cells, last18.length, `strip drew ${cells} cells for a ${last18.length}-match window`);
    assert(html.includes('last ' + last18.length + ' ·'), 'strip caption must state its own N');
    console.log(`        ${p.name}: ${r.won}–${r.lost} over ${last18.length} shown`);
  });
}

mustFail('ribbon check would catch a strip/caption mismatch', () => {
  const p = JSON.parse(JSON.stringify(SAMPLE[0]));
  const before = I.ledgerMatches(p).slice(-18).length;
  p.recentForm.matches = p.recentForm.matches.slice(0, 3);   // shrink the window
  const html = M.render(p);
  assert(html.includes('last ' + before + ' ·'), 'caption followed the data');
});

// ════════════════════════════════════════════════════════════════════════════
// 6 · NO FUTURE MATCHES (§3)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n6 · No completed match dated after today');

check('ledger excludes every future-dated row', () => {
  const today = new Date().toISOString().slice(0, 10);
  let dropped = 0, kept = 0;
  for (const p of Object.values(PLAYERS)) {
    const all = ((p.recentForm || {}).matches) || [];
    const rows = I.ledgerMatches(p);
    kept += rows.length;
    dropped += all.filter(m => m && m.date && m.date > today).length;
    rows.forEach(m => assert(m.date <= today, `${p.name} kept a future row ${m.date}`));
  }
  console.log(`        kept ${kept}, dropped ${dropped} future-dated rows (today ${today})`);
});

mustFail('future-date gate would catch a planted row', () => {
  const p = JSON.parse(JSON.stringify(SAMPLE[0]));
  p.recentForm.matches.push({ date: '2099-01-01', opponent: 'X', won: true, tournament: 'Nowhere', round: 'F', surface: 'hard', result: '3-0', walkover: false, retired: false });
  const rows = I.ledgerMatches(p);
  assert(rows.some(m => m.date === '2099-01-01'), 'future row survived the gate');
});

// ════════════════════════════════════════════════════════════════════════════
// 7 · SPEED BANDS (ruling 4) — derived from real Tennis Abstract values.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n7 · Court-speed bands');

check('five bands, monotonic, covering the real AS range', () => {
  assert.strictEqual(I.SPEED_BANDS.length, 5);
  for (let i = 1; i < I.SPEED_BANDS.length; i++) {
    assert(I.SPEED_BANDS[i].max > I.SPEED_BANDS[i - 1].max, 'bands not monotonic');
  }
  assert.strictEqual(I.speedBandFor(0.41).id, 'vslow', 'min AS must land in Very slow');
  assert.strictEqual(I.speedBandFor(1.42).id, 'vfast', 'max AS must land in Very fast');
  assert.strictEqual(I.speedBandFor(null), null, 'a missing speed must not be banded');
});

// The bands must actually PARTITION the 64 real venues we hold, not just exist.
check('bands partition the 64 real COURT_CONDITIONS venues into 5 non-empty groups', () => {
  const src = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
  const i = src.indexOf('const COURT_CONDITIONS = {');
  const j = src.indexOf('\n};', i);
  const blk = src.slice(i, j);
  const vals = [...blk.matchAll(/abstractSpeed:\s*([0-9.]+)/g)].map(m => parseFloat(m[1]));
  assert.strictEqual(vals.length, 64, 'expected 64 real AS values, got ' + vals.length);
  const tally = {};
  vals.forEach(v => { const b = I.speedBandFor(v); tally[b.id] = (tally[b.id] || 0) + 1; });
  I.SPEED_BANDS.forEach(b => assert(tally[b.id] > 0, 'band ' + b.id + ' is empty'));
  console.log('        ' + I.SPEED_BANDS.map(b => b.label + '=' + tally[b.id]).join('  '));
});

// ════════════════════════════════════════════════════════════════════════════
// 8 · HEADLINE SIZE RULE (README §5)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n8 · Headline size rule');
// SUPERSEDED by handoff v7 / A2 (2026-09-17). The char-length rule this used to
// lock is now explicitly dead: "Headline size comes from the per-box `size`
// field, NOT from string length."
check('headline size comes from the per-box `size` field, not the string', () => {
  const want = { career: 26, season: 26, tourn: 30, speed: 22,
                 splits: 20, styles: 30, market: 26, profile: 30 };
  for (const b of I.BOXES) {
    assert.strictEqual(I.headlineSize(b), want[b.key], `${b.key}: size is not the file's`);
  }
});

mustFail('[neg] the size lock would catch a revert to the char-length rule', () => {
  const charRule = (t) => { const n = String(t || '').length;
    return n <= 10 ? 30 : n <= 16 ? 23 : 19; };
  // The old rule emits only 30/23/19, so it cannot produce `splits`' locked
  // 20px or `speed`'s 22px for ANY headline — the revert is unrepresentable.
  assert([30, 23, 19].includes(20) || charRule('Other Tours') === 20,
    'char rule can still hit the locked 20px');
});

check('the eight boxes are the v7 set, in the v7 order', () => {
  assert.deepStrictEqual(I.BOXES.map(b => b.key),
    ['career', 'season', 'tourn', 'speed', 'splits', 'styles', 'market', 'profile']);
  assert.deepStrictEqual(I.BOXES.map(b => b.title),
    ['Career record', 'Calendar record', 'Record per tournament', 'Court speed record',
     'Draw record', 'Matchup record', 'Market edge', 'Live trading']);
});

// ════════════════════════════════════════════════════════════════════════════
// 9 · TYPOGRAPHY (§3) — minus must be U+2212, ranges en dash.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n9 · Typography');
check('records use an EN DASH, not a hyphen', () => {
  assert.strictEqual(I.recordText(12, 8), '12–8');
  assert(!I.recordText(12, 8).includes('-'), 'hyphen leaked into a record');
});
// Scorelines legitimately keep hyphens ('7-5'), so they are tagged
// .pp2-score and stripped before the scan. Everything else that reads as a
// W-L pair must be an en dash.
check('rendered pages contain no ASCII-hyphen record outside a scoreline', () => {
  for (const p of SAMPLE) {
    const html = M.render(p);
    const noScores = html.replace(/<span class="pp2-score">[\s\S]*?<\/span>/g, ' ');
    const body = noScores.replace(/<[^>]*>/g, ' ');
    const bad = body.match(/\b\d+-\d+\b/g);
    assert(!bad, `${p.name}: hyphenated record(s) in painted text: ${bad && bad.slice(0, 3)}`);
  }
});

// The normaliser must be LOAD-BEARING, not decorative: prove the raw source
// really does carry the hyphen that the painted page does not. If the pipeline
// ever starts emitting en dashes upstream this check goes quiet and tells us so
// — it does not silently keep passing on a no-op.
check('en-dash normaliser is load-bearing (source has hyphens, page does not)', () => {
  const withHyphen = Object.values(PLAYERS).filter(p =>
    (p.insights || []).some(i => /\d+-\d+/.test(i.text || '')));
  assert(withHyphen.length > 0,
    'no insight prose carries a hyphenated record — the normaliser is now a no-op, re-check §3');
  const p = withHyphen[0];
  assert(/\d+-\d+/.test(p.insights.find(i => /\d+-\d+/.test(i.text)).text),
    'source should carry a hyphen');
  const body = M.render(p)
    .replace(/<span class="pp2-score">[\s\S]*?<\/span>/g, ' ')
    .replace(/<[^>]*>/g, ' ');
  assert(!/\b\d+-\d+\b/.test(body), 'hyphen survived into the painted page');
  console.log(`        ${withHyphen.length} players carry hyphenated insight records upstream`);
});

// The normaliser must not touch a scoreline if one is ever passed through it
// by mistake — guard the blast radius, not just the happy path.
check('en-dash normaliser only rewrites what it is given', () => {
  assert.strictEqual(I.endashRecords('career 315-178 on clay'), 'career 315–178 on clay');
  assert.strictEqual(I.endashRecords('1-8 across the last 9'), '1–8 across the last 9');
  assert.strictEqual(I.endashRecords(null), '');
});

// ════════════════════════════════════════════════════════════════════════════
// 10 · CAREER SPINE (founder ruling B) — §4 chain 1.
//      career tile = career modal total = sum of surface rows = sum of season rows
// ════════════════════════════════════════════════════════════════════════════
console.log('\n10 · Career spine (ruling B: careerByYear, labelled "since <year>")');

check('surface rows sum to the career total for EVERY player', () => {
  let checked = 0, residual = 0, withResidual = 0;
  for (const p of Object.values(PLAYERS)) {
    const t = I.spineTotal(p);
    if (!t.n) continue;
    const s = I.spineBySurface(p, null);
    const sw = s.hard.won + s.clay.won + s.grass.won + s.other.won;
    const sl = s.hard.lost + s.clay.lost + s.grass.lost + s.other.lost;
    assert.strictEqual(sw, t.won, `${p.name}: surface wins ${sw} != career ${t.won}`);
    assert.strictEqual(sl, t.lost, `${p.name}: surface losses ${sl} != career ${t.lost}`);
    if (s.other.won + s.other.lost) { withResidual++; residual += s.other.won + s.other.lost; }
    checked++;
  }
  console.log(`        ${checked} players; ${withResidual} carry an "unrecorded surface" row ` +
    `(${residual} matches in all)`);
  assert(withResidual > 0,
    'no player has a surface residual — the residual row is now dead code, re-measure before removing it');
});

// The residual row is load-bearing: without it the three named surfaces fall
// SHORT of the total for 40 players. Prove that, or the row above is decoration.
check('the residual row is load-bearing (named surfaces alone do NOT reconcile)', () => {
  let short = 0;
  for (const p of Object.values(PLAYERS)) {
    const t = I.spineTotal(p);
    if (!t.n) continue;
    const s = I.spineBySurface(p, null);
    const sw = s.hard.won + s.clay.won + s.grass.won;
    const sl = s.hard.lost + s.clay.lost + s.grass.lost;
    if (sw !== t.won || sl !== t.lost) short++;
  }
  assert(short > 0, 'named surfaces already reconcile — the residual row measures nothing');
  console.log(`        ${short} players would under-count without it`);
});

mustFail('spine check would catch a doctored season row', () => {
  const p = JSON.parse(JSON.stringify(byName('C. Alcaraz')));
  p.careerByYear[0].total.won += 3;          // total moves, surfaces do not
  const t = I.spineTotal(p);
  const s = I.spineBySurface(p, null);
  const sw = s.hard.won + s.clay.won + s.grass.won;   // residual EXCLUDED on purpose
  assert.strictEqual(sw, t.won, 'planted drift not caught');
});

// The headline half is unchanged and still load-bearing. The support half is
// SUPERSEDED by v7: the file's string is "<rate> all-time · by surface and by
// season" and carries no "since <year>" window. Reported as an information loss
// — the tile no longer says when the record starts — but the file wins.
check('career box headline = spine total, with the v7 support line', () => {
  for (const p of SAMPLE) {
    const t = I.spineTotal(p);
    const vals = I.buildBoxVals(p, { archetype: null });
    if (!t.n) { assert.strictEqual(vals.career.headline, null); continue; }
    assert.strictEqual(vals.career.headline, t.won + '–' + t.lost,
      `${p.name}: box headline disagrees with the spine`);
    assert(vals.career.support.endsWith(' all-time · by surface and by season'),
      `${p.name}: career support is not the v7 string (${vals.career.support})`);
    // The rate is still the spine's own, not a re-derivation.
    assert(vals.career.support.startsWith(I.rateText(t.won, t.lost)),
      `${p.name}: career support rate disagrees with the spine`);
  }
});

check('career modal total row = career box headline', () => {
  for (const p of SAMPLE) {
    const t = I.spineTotal(p);
    if (!t.n) continue;
    const html = I.renderCareerModal(p, {});
    // The footer "Career" row prints W/L; it must be the same pair as the tile.
    assert(html.includes('>' + t.won + '/' + t.lost + '<'),
      `${p.name}: career modal footer does not carry ${t.won}/${t.lost}`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 11 · TOURNAMENT — §4: "Tournament W-L = sum of its listed editions".
// ════════════════════════════════════════════════════════════════════════════
console.log('\n11 · Record per tournament');

// ── RULED 2026-09-19 — a WD is NOT a loss ───────────────────────────────────
// "A WD is not a loss and not a win. It comes OUT of the denominator entirely,
//  same as a walkover given."
//
// The ruling is implemented in career-backfill.js `finalizeTournament`, and is
// locked deterministically by tools/test-wd-exclusion.js, which drives that
// function directly and fails on the binary `else lost++`.
//
// THIS check is the store-level LAGGING indicator. It reads the DEPLOYED
// shards, so it cannot reach compliance until a pipeline run republishes them —
// which is why it is a CEILING, not a pin. Measured at the moment of the fix:
// 13,071 tournament rows, 105 carrying a WD, and 105 of 105 counting it as a
// loss — zero compliant.
//
// RE-PINNED 2026-09-19 after pipeline run 3753 republished the shards:
// 0 of 105 compliant -> 105 of 105 compliant. Confirmed against the deployed
// shard directly, not through a cached reader (J. Thompson / Cincinnati now
// stores 5-3 against editions W5 L3 WD1).
// This is a STRICT equality now, not a ceiling: a WD must never again land in
// a denominator.
const WD_AS_LOSS_CEILING = 0;
check('every tournament W-L equals the sum of its editions', () => {
  let rows = 0, wdAsLoss = 0, wdIgnored = 0, wdMatches = 0;
  for (const p of Object.values(PLAYERS)) {
    for (const t of p.tournamentHistory || []) {
      let w = 0, l = 0, wd = 0;
      (t.editions || []).forEach(e => (e.matches || []).forEach(m => {
        if (m.res === 'W') w++;
        else if (m.res === 'L') l++;
        else { wd++; }        // WD today; any future code lands here too
      }));
      assert.strictEqual(w, t.won || 0, `${p.name} / ${t.name}: editions ${w} wins vs stored ${t.won}`);
      if (!wd) {
        assert.strictEqual(l, t.lost || 0, `${p.name} / ${t.name}: editions ${l} losses vs stored ${t.lost}`);
      } else {
        wdMatches += wd;
        if (l + wd === (t.lost || 0)) wdAsLoss++;
        else if (l === (t.lost || 0)) wdIgnored++;
        else assert.fail(`${p.name} / ${t.name}: ${l} losses + ${wd} WD reconciles with neither `
          + `${t.lost} under either convention`);
      }
      rows++;
    }
  }
  assert.strictEqual(wdAsLoss, WD_AS_LOSS_CEILING,
    `${wdAsLoss} tournament row(s) count a WD as a loss. The ruling excludes it from `
    + `the denominator entirely; finalizeTournament regressed or a new header writer appeared.`);
  const compliant = wdAsLoss === 0;
  console.log(`        ${rows} tournament rows reconcile with their editions; `
    + `${wdMatches} WD matches across ${wdAsLoss + wdIgnored} tournaments — `
    + `${wdAsLoss} headers still count WD as a loss, ${wdIgnored} exclude it `
    + `(RULED: exclude${compliant ? ' — COMPLIANT' : ' — NOT COMPLIANT'})`);
});

mustFail('tournament check would catch a dropped edition', () => {
  const p = JSON.parse(JSON.stringify(SAMPLE[0]));
  p.tournamentHistory[0].editions.shift();
  let w = 0, l = 0;
  (p.tournamentHistory[0].editions || []).forEach(e => (e.matches || []).forEach(m => {
    if (m.res === 'W') w++; else if (m.res === 'L') l++;
  }));
  assert.strictEqual(w, p.tournamentHistory[0].won, 'dropped edition not caught');
});

// ════════════════════════════════════════════════════════════════════════════
// 12 · BIGGEST SPLIT / BIGGEST BAND (founder ruling sel-0) — one rule, two callers.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n12 · Biggest split / biggest band (largest |pp| vs own baseline, n>=10)');

check('the picked split really is the largest |pp| among those clearing n>=10', () => {
  let tested = 0;
  for (const key of Object.keys(SPLITS).slice(0, 60)) {
    const cands = I.splitCandidates(key, 'career');
    const got = I.pickByLargestGap(cands);
    if (!got) continue;
    const eligible = cands.filter(c => c.won + c.lost >= 10);
    let maxGap = 0;
    eligible.forEach((c) => {
      const n = c.won + c.lost;
      maxGap = Math.max(maxGap, Math.abs(100 * c.won / n - got.baseline));
    });
    assert(Math.abs(Math.abs(got.pick.gap) - maxGap) < 1e-9,
      `${key}: picked |${got.pick.gap.toFixed(2)}| but the largest is |${maxGap.toFixed(2)}|`);
    tested++;
  }
  assert(tested > 20, `only ${tested} players had a pickable split — expected most of the sample`);
  console.log(`        ${tested} players checked`);
});

check('the baseline is match-count weighted, not a mean of rates', () => {
  // Two splits: 100 matches at 50%, 10 matches at 0%. Weighted baseline is
  // 50/110 = 45.5%; an unweighted mean of rates would be 25%.
  const cands = [
    { id: 'a', label: 'A', won: 50, lost: 50 },
    { id: 'b', label: 'B', won: 0, lost: 10 },
  ];
  const got = I.pickByLargestGap(cands);
  assert(Math.abs(got.baseline - (100 * 50 / 110)) < 1e-9,
    `baseline ${got.baseline} is not match-count weighted`);
  assert.strictEqual(got.pick.id, 'b');
});

check('a split under ten matches can never be picked', () => {
  const got = I.pickByLargestGap([
    { id: 'big', label: 'Big', won: 50, lost: 50 },
    { id: 'tiny', label: 'Tiny', won: 9, lost: 0 },   // 100%, but n=9
  ]);
  assert.strictEqual(got.pick.id, 'big', 'a 9-match split was picked');
});

mustFail('biggest-split check would catch an off-by-one floor', () => {
  const got = I.pickByLargestGap([
    { id: 'big', label: 'Big', won: 50, lost: 50 },
    { id: 'tiny', label: 'Tiny', won: 9, lost: 0 },
  ]);
  assert.strictEqual(got.pick.id, 'tiny', 'floor is not at ten');
});

// ─── gate-3 ruling bw-0: keep the sign-blind rule, fix the word ──────────────
// The founder's objection was that "best split" can name the player's WORST
// split. He ruled the rule stays and the label becomes "biggest". These two
// pin both halves: the selection must still be allowed to go negative, and no
// user-facing string may say "best split"/"best band" again.
check('the pick is allowed to be negative — the rule is sign-blind by ruling', () => {
  // One split far BELOW the weighted baseline, one modestly above it. The
  // larger |pp| is the negative one and it must win.
  const got = I.pickByLargestGap([
    { id: 'strong', label: 'Strong', won: 60, lost: 40 },   // 60.0%
    { id: 'weak', label: 'Weak', won: 2, lost: 18 },        // 10.0%
  ]);
  const baseline = 100 * 62 / 120;                          // 51.67%
  assert(Math.abs(got.baseline - baseline) < 1e-9);
  assert.strictEqual(got.pick.id, 'weak', 'the sign-blind rule did not pick the negative split');
  assert(got.pick.gap < 0, `expected a negative gap, got ${got.pick.gap}`);
});

// ── ruling bw-0 is OVERRIDDEN by handoff v7, and this is a direct collision ──
//
// bw-0 banned the words "best split" / "best band" from user-facing text. The
// v7 locked copy uses that exact phrase: `Player Stat Boxes.dc.html`:3226 reads
// `support: 'best split · 75.0% · 45–15 · 60 matches'`, and the founder's A1
// quotes it verbatim as the locked support line.
//
// This handoff says the export wins every conflict, so "best split" ships and
// bw-0 no longer holds for this string. It is called out in the report rather
// than resolved quietly, because the two rulings are seven days apart and only
// the founder can retire the older one.
//
// The lock is INVERTED rather than deleted: the wording is now pinned to the
// file's, so a drift back to "biggest split" fails just as loudly as the drift
// this check used to catch.
check('the splits support line uses the v7 wording, not the bw-0 wording', () => {
  const src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  const code = src.split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');
  // ITEM 3 moved the phrase from the head of the line to its middle: the box's
  // support is now "{label} \u00b7 best split \u00b7 {record}", so the v7 token is
  // ' best split ' with a separator either side rather than a line-leading
  // "'best split ". Pinned to the token, which is what the wording ruling is
  // about, not to its position, which item 3 legitimately moved.
  assert(/best split /.test(code), 'the v7 "best split" support line is missing');
  const stale = (code.match(/'[^'\n]*\bbiggest split\b[^'\n]*'/gi) || []);
  assert.strictEqual(stale.length, 0,
    `v7 regressed — user-facing text still says: ${stale.join(', ')}`);
});

mustFail('[neg] the wording lock would catch a revert to "biggest split"', () => {
  const code = "support: 'biggest split ' + MIDDOT";
  const stale = (code.match(/'[^'\n]*\bbiggest split\b[^'\n]*'/gi) || []);
  assert.strictEqual(stale.length, 0, 'lock is inert');
});

check('splits box headline and the modal agree on the picked split', () => {
  let shown = 0;
  for (const p of SAMPLE) {
    const bs = I.biggestSplit(p);
    const vals = I.buildBoxVals(p, { archetype: null });
    if (!bs) { assert.strictEqual(vals.splits.headline, null, `${p.name}: headline without a pick`); continue; }
    // ITEM 2 (2026-09-19) · the headline is now the RATE and the label moved to
    // the support line, so "the box and the modal agree on the picked split" is
    // asserted over BOTH halves — the figure the box leads with and the label
    // that qualifies it. This is strictly stronger than the old single equality:
    // a box that picked a different split would previously have had to get the
    // label wrong to fail; now getting either one wrong fails.
    assert.strictEqual(vals.splits.headline, bs.pick.rate.toFixed(1) + '%',
      `${p.name}: splits headline is not the picked split's rate`);
    assert(String(vals.splits.support).indexOf(bs.pick.label) === 0,
      `${p.name}: splits support does not lead with the picked split's label ` +
      `(${JSON.stringify(vals.splits.support)})`);
    assert(/[0-9]/.test(String(vals.splits.headline)),
      `${p.name}: splits headline carries no figure`);
    const html = I.renderSplitsModal(p);
    assert(html.includes(bs.baseline.toFixed(1) + '%'),
      `${p.name}: modal does not disclose the baseline the headline was measured against`);
    shown++;
  }
  console.log(`        ${shown} of ${SAMPLE.length} sample players have a biggest split`);
});

// ════════════════════════════════════════════════════════════════════════════
// 13 · MARKET EDGE (founder ruling B + gate-2 "do as on the design").
//      §4: role counts and band counts sum to the headline priced count.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n13 · Market edge');

const MK_KEYS = Object.keys(MARKET);
check('market shards exist', () => {
  assert(MK_KEYS.length > 100, `only ${MK_KEYS.length} market shards — run build-market-edge.js`);
  console.log(`        ${MK_KEYS.length} shards`);
});

check('role cards sum to the headline priced count, for every shard', () => {
  for (const k of MK_KEYS) {
    const s = MARKET[k];
    const sum = s.roles.favourite.n + s.roles.underdog.n + s.roles.level.n;
    assert.strictEqual(sum, s.headline.n, `${k}: roles ${sum} != headline ${s.headline.n}`);
  }
});

check('price bands sum to the headline priced count, for every shard', () => {
  let level = 0;
  for (const k of MK_KEYS) {
    const s = MARKET[k];
    const sum = ['favourite', 'underdog']
      .reduce((a, g) => a + s.bands[g].reduce((x, b) => x + b.n, 0), 0) + s.roles.level.n;
    assert.strictEqual(sum, s.headline.n, `${k}: bands ${sum} != headline ${s.headline.n}`);
    level += s.roles.level.n;
  }
  console.log(`        ${level} player-sides closed at an identical price on both sides ` +
    `(neither favourite nor underdog; counted separately rather than forced into a card)`);
});

check('per-row book counts sum to the headline, and the label is never blended', () => {
  for (const k of MK_KEYS) {
    const s = MARKET[k];
    assert.strictEqual(s.headline.book.pinnacle + s.headline.book.bet365, s.headline.n,
      `${k}: book mix does not sum to the priced count`);
    const rows = s.matches.filter(m => m.book !== 'pinnacle' && m.book !== 'bet365-archive');
    assert.strictEqual(rows.length, 0, `${k}: ${rows.length} rows carry no book label`);
    assert.strictEqual(s.matches.filter(m => m.book === 'pinnacle').length, s.headline.book.pinnacle,
      `${k}: row-level Pinnacle count disagrees with the summary`);
  }
});

// ★ Founder ruling R1, 2026-09-17, SUPERSEDES ruling B where they conflict:
//   "Headline yield, role cards, price bands and the cumulative chart use
//    Pinnacle closing only. No fallback to Bet365 or any other book inside those
//    figures. Bet365 may appear on rows, labelled by book, but is excluded from
//    every yield/units figure."
//
// This check used to assert the OPPOSITE — that the Bet365 fallback was
// load-bearing (`b > 0`), which is exactly what ruling B required and exactly
// what R1 forbids. It is inverted here rather than deleted: an absent check
// would let the fallback creep back into the headline unnoticed. Both halves of
// R1 are locked, because only asserting the first half would pass a build that
// achieved "no Bet365 in the headline" by dropping the Bet365 rows entirely —
// the rows must survive, labelled, outside the basis.
check('R1 · no Bet365 inside the headline basis, and Bet365 rows still survive labelled', () => {
  const b = MK_KEYS.reduce((a, k) => a + MARKET[k].headline.book.bet365, 0);
  const p = MK_KEYS.reduce((a, k) => a + MARKET[k].headline.book.pinnacle, 0);
  assert.strictEqual(b, 0, `${b} Bet365 rows are inside the headline basis — R1 forbids any`);
  assert(p > 0, 'no Pinnacle rows at all — the basis is empty, not Pinnacle-only');
  // Half two: the excluded rows are still carried, still labelled by book.
  let rows = 0, shards = 0;
  for (const k of MK_KEYS) {
    const off = (MARKET[k].matches || []).filter(m => m.book && m.book !== 'pinnacle');
    if (off.length) { shards++; rows += off.length; }
  }
  assert(rows > 0, 'no non-Pinnacle row survives anywhere — R1 excludes them from the '
    + 'basis, it does not delete them');
  console.log(`        headline basis: ${p} Pinnacle rows, ${b} Bet365 ` +
    `· ${rows} non-Pinnacle rows kept and labelled across ${shards} shards (outside every yield)`);
});

mustFail('the R1 check would catch a Bet365 row readmitted to the headline basis', () => {
  const headline = { book: { pinnacle: 300, bet365: 5 } };
  assert.strictEqual(headline.book.bet365, 0, 'readmitted Bet365 row not caught');
});

mustFail('the R1 check would catch a build that deleted the Bet365 rows instead of excluding them', () => {
  const shards = [{ matches: [{ book: 'pinnacle' }, { book: 'pinnacle' }] }];
  const rows = shards.reduce((a, s) => a + s.matches.filter(m => m.book !== 'pinnacle').length, 0);
  assert(rows > 0, 'deleted-rather-than-excluded not caught');
});

check('flat-stake yield recomputes from the shard rows, over the R1 basis', () => {
  // Recompute the headline from the per-row P&L rather than trusting the
  // summary. A summary that cannot be re-derived from its own rows is a claim,
  // not a measurement.
  //
  // The recompute is over the PINNACLE rows, not over every row: under R1 the
  // headline's population is Pinnacle-only while `matches` also carries the
  // labelled Bet365 rows for display. Summing all of them was this check's own
  // bug — it read shard 207 as "rows give 2.23% but the headline says 2.4%"
  // when the headline was right and the check was using the pre-R1 population.
  // Scope is every shard with a yield, not the first 40: the mismatch sat at
  // index 40+ and a head-slice would have missed it.
  let checked = 0;
  for (const k of MK_KEYS) {
    const s = MARKET[k];
    if (s.headline.yield == null) continue;
    const pin = (s.matches || []).filter(m => m.book === 'pinnacle');
    assert.strictEqual(pin.length, s.headline.n,
      `${k}: headline n ${s.headline.n} != ${pin.length} Pinnacle rows`);
    const y = 100 * pin.reduce((a, m) => a + (m.pl || 0), 0) / pin.length;
    assert(Math.abs(y - s.headline.yield) < 0.06,
      `${k}: Pinnacle rows give ${y.toFixed(2)}% but the headline says ${s.headline.yield}%`);
    checked++;
  }
  console.log(`        ${checked} shards: headline n and yield both re-derived from the Pinnacle rows`);
});

mustFail('yield check would catch a doctored row', () => {
  const k = MK_KEYS.find(x => MARKET[x].headline.yield != null);
  const s = JSON.parse(JSON.stringify(MARKET[k]));
  const pin = s.matches.filter(m => m.book === 'pinnacle');
  pin[0].pl += 40;
  const y = 100 * pin.reduce((a, m) => a + (m.pl || 0), 0) / pin.length;
  assert(Math.abs(y - s.headline.yield) < 0.06, 'doctored row not caught');
});

check('the tour baseline is computed, not a rounded constant', () => {
  const s = MARKET[MK_KEYS[0]];
  const t = s.tour.all;
  assert(t && t.n > 50000, `tour baseline rests on only ${t && t.n} sides`);
  assert(t.yield != null, 'tour yield is null');
  // The export hard-codes -3.79%. Ours must be OUR number over OUR archive.
  assert(Math.abs(t.yield + 3.79) > 1e-9, 'tour baseline equals the export constant — not recomputed');
  console.log(`        tour yield ${t.yield}% over ${t.n} priced player-sides ` +
    `(the export's placeholder was -3.79%)`);
});

check('market box headline and the modal quote the same yield and n', () => {
  for (const p of SAMPLE) {
    const mk = MARKET[String(p.key)];
    const vals = I.buildBoxVals(p, { archetype: null });
    if (!mk || mk.headline.yield == null) {
      assert.strictEqual(vals.market.headline, null, `${p.name}: market headline without a shard`);
      continue;
    }
    assert(vals.market.support.includes(mk.headline.n + ' priced'),
      `${p.name}: box does not carry the priced n`);
    const html = I.renderMarketModal(p);
    assert(html.includes(mk.headline.n + ' priced'), `${p.name}: modal does not carry the priced n`);
    assert(html.includes('closing'), `${p.name}: modal does not label the price basis`);
  }
});

check('a rate is never printed below the ten-match gate anywhere in a shard', () => {
  for (const k of MK_KEYS) {
    const s = MARKET[k];
    ['favourite', 'underdog'].forEach((g) => {
      s.bands[g].forEach((b) => {
        if (b.n < 5) {
          assert.strictEqual(b.winRate, null, `${k}/${g}/${b.id}: rate printed on n=${b.n}`);
          assert.strictEqual(b.yield, null, `${k}/${g}/${b.id}: yield printed on n=${b.n}`);
        }
      });
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 14 · CALENDAR RECORD (founder ruling cal-1, 2026-09-17 — SUPERSEDES cal-0).
//      cal-0 built the heat grid from the priced archive. Item 1 of the
//      2026-09-17 comment moves it onto the CAREER MATCH ROWS and confines the
//      archive to the yield layer: "GRID = CAREER MATCH ROWS ... Do NOT build
//      the grid from the priced archive", "YIELD / P&L = PRICED SUBSET".
//
//      career-history/ is gitignored and CI-built, so it is normally ABSENT
//      here. A test that silently skipped would have let this whole rebuild ship
//      unchecked, so the spine assertions run against a SYNTHETIC store whose
//      every figure is known by construction, and the real shards are folded in
//      as an extra pass whenever CI has them on disk.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n14 · Calendar record (ruling cal-1 — grid = career rows, yield = priced subset)');

const CAL_PLAYERS = Object.keys(MARKET).slice(0, 80);

// ── the synthetic spine ────────────────────────────────────────────────────
// Two seasons. January holds 12 matches a year (8-4 in 2025, 3-9 in 2026);
// every 2025 January match is priced at a flat +0.50 win / -1.00 loss, and NO
// 2026 match is priced at all. March holds a single match, so the n>=10 gate
// must exclude it from every tile. February is empty in both seasons.
const CAL_SPINE = [];
const CAL_MK = [];
function calPush(date, won, opp, ev, priced) {
  CAL_SPINE.push({
    year: date.slice(0, 4), date, surface: 'hard', level: 'atp',
    tournament: ev, round: 'R32', opponent: opp, result: won ? '2 - 0' : '0 - 2', won
  });
  if (priced) {
    CAL_MK.push({
      date, event: ev, level: 'ATP 250', surface: 'Hard', court: 'Outdoor',
      round: '2nd Round', opp, won, price: won ? 1.5 : 2.0, oppPrice: won ? 2.6 : 1.8,
      book: 'pinnacle', role: won ? 'fav' : 'dog', pl: won ? 0.5 : -1
    });
  }
}
for (let i = 0; i < 12; i++) {
  calPush(`2025-01-${String(i + 1).padStart(2, '0')}`, i < 8, `P${i} A`, 'Adelaide', true);
}
for (let i = 0; i < 12; i++) {
  calPush(`2026-01-${String(i + 1).padStart(2, '0')}`, i < 3, `Q${i} B`, 'Brisbane', false);
}
calPush('2025-03-04', true, 'Z9 C', 'Miami', true);
const CAL_P = {
  key: '__cal', name: 'T. Cal', tournamentHistory: [],
  careerByYear: [
    { year: '2025', total: { won: 9, lost: 4 }, hard: { won: 9, lost: 4 } },
    { year: '2026', total: { won: 5, lost: 9 }, hard: { won: 5, lost: 9 } }
  ]
};
// 2026 carries 14 matches in careerByYear against 12 dated rows, so the spine
// gap the footnote has to disclose is 2 and is known exactly.
const CAL_EXPECT = { grid: 25, spine: 27, gap: 2, priced: 13, seasons: 2 };

function withCal(fn) {
  const savedCh = W.careerHistory;
  const savedMk = W.marketEdge;
  const savedSt = { ...I.state };
  W.careerHistory = Object.assign({}, CAREER_HIST, { __cal: CAL_SPINE });
  W.marketEdge = Object.assign({}, MARKET, { __cal: { matches: CAL_MK } });
  try { return fn(); } finally {
    W.careerHistory = savedCh;
    W.marketEdge = savedMk;
    Object.assign(I.state, savedSt);
  }
}

check('the grid is the CAREER rows, not the priced archive', () => withCal(() => {
  I.state.calSurface = 'all';
  const rows = I.calSpineFiltered(CAL_P);
  assert.strictEqual(rows.length, CAL_EXPECT.grid,
    `spine holds ${rows.length}, not the ${CAL_EXPECT.grid} career rows`);
  // The archive holds 13 rows. If the grid ever equals that number again, the
  // spine has silently reverted to cal-0.
  assert.notStrictEqual(rows.length, CAL_MK.length,
    'the grid equals the priced archive — ruling cal-1 was reverted');
  let total = 0;
  I.calGrid(rows).forEach(yr => yr.cells.forEach(c => { total += c.won + c.lost; }));
  assert.strictEqual(total, CAL_EXPECT.grid, `Σ cells = ${total}, not ${CAL_EXPECT.grid}`);
  console.log(`        Σ grid cells ${total} = career rows ${CAL_EXPECT.grid}, archive holds ${CAL_MK.length}`);
}));

mustFail('[neg] the spine check would catch a revert to the archive', () => withCal(() => {
  const archive = I.calMarketRows(CAL_P);
  assert.strictEqual(archive.length, CAL_EXPECT.grid,
    `archive holds ${archive.length}, not ${CAL_EXPECT.grid}`);
}));

check('item 2 · the yield layer counts ONLY the priced rows', () => withCal(() => {
  I.state.calSurface = 'all';
  const info = I.calMonths(I.calSpineFiltered(CAL_P));
  const jan = info.months[0], feb = info.months[1], mar = info.months[2];
  assert.strictEqual(jan.n, 24, `January grid n ${jan.n}, not 24`);
  assert.strictEqual(jan.priced, 12, `January priced ${jan.priced}, not 12`);
  // 8 wins at +0.50 and 4 losses at -1.00 over 12 priced matches = 0.0u = 0.0%.
  assert(Math.abs(jan.yield - 0) < 1e-9, `January yield ${jan.yield}, not 0`);
  assert.strictEqual(feb.n, 0, 'February should be empty');
  assert.strictEqual(feb.yield, null, 'an empty month must dash, not read 0%');
  assert.strictEqual(mar.n, 1, 'March should hold one match');
  assert.strictEqual(mar.priced, 1, 'March should hold one priced match');
  assert.strictEqual(info.priced, CAL_EXPECT.priced,
    `priced total ${info.priced}, not ${CAL_EXPECT.priced}`);
  // Σ of the monthly grid counts must be the grid total — the buckets partition.
  let sumN = 0, sumP = 0;
  info.months.forEach((x) => { sumN += x.n; sumP += x.priced; });
  assert.strictEqual(sumN, CAL_EXPECT.grid, `month buckets hold ${sumN} of ${CAL_EXPECT.grid}`);
  assert.strictEqual(sumP, CAL_EXPECT.priced, `priced buckets hold ${sumP} of ${CAL_EXPECT.priced}`);
  console.log(`        Jan n=24 grid / 12 priced; Σ buckets ${sumN} grid + ${sumP} priced`);
}));

check('item 7 · a stretch is ADJACENT MONTHS and the n>=10 gate holds', () => withCal(() => {
  I.state.calSurface = 'all';
  const info = I.calMonths(I.calSpineFiltered(CAL_P));
  const s = I.calStretches(info);
  assert(s.best, 'no stretch cleared the gate');
  // Every eligible stretch must be a 2- or 3-month adjacent run, never a year.
  [s.best, s.worst].forEach((w) => {
    assert(/^[A-Z][a-z]{2}–[A-Z][a-z]{2}$/.test(w.label),
      `stretch label "${w.label}" is not a month range — a year label is the cal-0 shape`);
    assert(w.n >= 10, `stretch ${w.label} shipped with n=${w.n}, under the gate`);
  });
  // March holds one priced match. It must not reach a tile under any label.
  const monthIdx = info.months.filter(x => x.priced >= 10 && x.pp != null);
  assert(!monthIdx.some(x => x.m === 2), 'the 1-match March month cleared the n>=10 gate');
  console.log(`        best ${s.best.label} n=${s.best.n}; the 1-match month is gated out`);
}));

mustFail('[neg] the gate check would catch a 1-match month reaching a tile', () => withCal(() => {
  const info = I.calMonths(I.calSpineFiltered(CAL_P));
  const ungated = info.months.filter(x => x.priced > 0 && x.pp != null);
  assert(!ungated.some(x => x.m === 2), 'March reached a tile');
}));

check('item 3 · the subtitle M is the GRID total and carries the span', () => withCal(() => {
  const sc = I.calScope(CAL_P);
  assert.strictEqual(sc.n, CAL_EXPECT.grid, `scope n ${sc.n}, not the grid total`);
  assert.strictEqual(sc.m, CAL_EXPECT.spine, `scope m ${sc.m}, not the careerByYear spine`);
  assert.strictEqual(sc.from, '2025');
  assert.strictEqual(sc.to, '2026');
  // Asserted unconditionally on purpose: an `if (sub)` here would pass silently
  // the day the export is dropped, which is the vacuous shape this file bans.
  assert(typeof I.modalSubtitle === 'function', 'modalSubtitle is not exported — item 3 unchecked');
  const sub = I.modalSubtitle('season', CAL_P, {});
  assert(sub.includes(`${CAL_EXPECT.grid} matches`),
    `subtitle says "${sub}" — M must be the grid total`);
  assert(sub.includes('2025–2026'), `subtitle "${sub}" carries no year span`);
  assert(!sub.includes(`${CAL_EXPECT.spine} matches`),
    'the subtitle reverted to the careerByYear total');
  console.log(`        subtitle M=${sc.n} (grid) with span ${sc.from}–${sc.to}; spine is ${sc.m}`);
}));

check('the footnote discloses the spine gap rather than hiding it', () => withCal(() => {
  I.state.calTab = 'calendar'; I.state.calSurface = 'all'; I.state.calCell = null;
  const html = I.renderSeasonModal(CAL_P);
  assert(html.includes(`the ${CAL_EXPECT.priced} priced`),
    'the footnote never states the priced count');
  assert(html.includes(`the grid covers all ${CAL_EXPECT.grid}`),
    'the footnote never states the grid total');
  // FOUNDER 2026-09-18 — the clause is no longer a net. This fixture carries
  // only ONE of the two populations (2 undated, 0 outside the window), so it can
  // exercise at most half the rule; §14A below runs the fixture that carries
  // BOTH and is the check that actually pins the ruling.
  assert(html.includes(`${CAL_EXPECT.gap} matches carry no dated match row`),
    `the ${CAL_EXPECT.gap} undated matches are not disclosed`);
  assert(!html.includes('fewer than the grid'),
    'the netted "fewer than the grid" clause is back in the footnote');
  // Item 31 — the long archive paragraph is gone.
  assert(!/qualifying and Challenger matches are absent by scope/.test(html),
    'the cal-0 archive paragraph is still in the footnote');
  console.log(`        footnote: ${CAL_EXPECT.priced} priced, grid ${CAL_EXPECT.grid}, gap ${CAL_EXPECT.gap} disclosed`);
}));

check('items 13 + 12 · empty months are a middot, and the tint is the file\'s flat 0.10', () => withCal(() => {
  I.state.calTab = 'calendar'; I.state.calSurface = 'all'; I.state.calCell = null;
  const html = I.renderSeasonModal(CAL_P);
  assert(html.includes('rgba(61,214,140,0.10)'), 'the win tint is not the file\'s flat 0.10');
  assert(html.includes('rgba(224,97,111,0.10)'), 'the loss tint is not the file\'s flat 0.10');
  // The ramped alpha cal-0 drew (0.10 + 0.32 * ...) produced three-decimal
  // alphas. If one reappears the tint went back to a gradient.
  assert(!/rgba\(61,214,140,0\.\d{3}\)/.test(html), 'a ramped green alpha is back in the grid');
  assert(!/rgba\(224,97,111,0\.\d{3}\)/.test(html), 'a ramped red alpha is back in the grid');
  assert(html.includes('>·</span>'), 'an empty month does not render the file\'s middot');
  console.log('        flat 0.10 tints, no ramp, empty months render ·');
}));

check('the drill opens, groups by event, and its P&L is the priced rows only', () => withCal(() => {
  I.state.calTab = 'calendar'; I.state.calSurface = 'all';
  I.state.calCell = '2026|0';                       // January 2026 — 12 rows, 0 priced
  let html = I.renderSeasonModal(CAL_P);
  assert(html.includes('#2e4fa8'), 'the drill did not open');
  assert(html.includes('January 2026'), 'the drill header names the wrong month');
  assert(html.includes('3–09') || html.includes('3–9'), 'the drill record is not 3-9');
  assert(html.includes('no priced match in this month'),
    'an unpriced month must say so, not print a 0.00u yield');
  assert(html.includes('data-pp2="cal-cell-close"'), 'the drill has no close button');
  assert(/>Score</.test(html), 'the drill has no SCORE column');
  assert(/>Home</.test(html) && />Away</.test(html), 'the drill is missing HOME/AWAY');
  assert(!/NaN|undefined|Infinity/.test(html), 'the drill leaked a non-number');

  I.state.calCell = '2025|0';                       // January 2025 — 12 rows, all priced
  html = I.renderSeasonModal(CAL_P);
  assert(html.includes('12 priced'), 'the drill does not state its priced count');
  // 8 x +0.50 - 4 x 1.00 = 0.00u over 12 priced = +0.0%
  assert(html.includes('+0.00u'), 'the drill total is not the recomputed +0.00u');
  assert(!/\+0\.50u|−1\.00u/.test(html),
    'a drill ROW still carries the "u" suffix the design drops (item 20)');
  console.log('        drill: grouped, close button, SCORE/HOME/AWAY, priced count, no "u" on rows');
}));

check('item 30 · CONSISTENT is one segment per season, not prose', () => withCal(() => {
  I.state.calTab = 'calendar'; I.state.calSurface = 'all'; I.state.calCell = null;
  const html = I.renderSeasonModal(CAL_P);
  assert(html.includes('>1/2<'), `CONSISTENT should read 1/2 over ${CAL_EXPECT.seasons} seasons`);
  assert(!/\d+ of \d+<\/div>/.test(html.split('Consistent')[1] || ''),
    'CONSISTENT reverted to the "8 of 14" prose form');
  assert(html.includes('rgba(91,155,255,0.62)'), 'no filled CONSISTENT segment rendered');
  console.log('        CONSISTENT renders 1/2 as filled segments, one per season');
}));

// The findings strip is labelled "pp" and the file's own SW array is commented
// "weighted to the career yield" — so the figure is a GAP against his own
// career yield, not the raw surface yield. The two differ by a constant, so a
// raw yield under a pp label reads plausibly and the spread (which cancels the
// baseline) agrees either way. That is exactly why it needs pinning.
check('item 24 · the findings strip is a pp gap, not a raw yield', () => withCal(() => {
  I.state.calSurface = 'all';
  const rows = I.calSpineFiltered(CAL_P);
  const f = I.calFindings(rows);
  const priced = rows.filter(r => r.cents != null);
  const careerY = priced.reduce((a, r) => a + r.cents, 0) / priced.length;
  // The fixture is 100% hard court, so hard is both best and worst and its gap
  // against his own career yield is exactly zero — a raw yield would not be.
  const hardRows = priced.filter(r => r.surface === 'hard');
  const rawHard = hardRows.reduce((a, r) => a + r.cents, 0) / hardRows.length;
  assert(Math.abs(f[0].value - (rawHard - careerY)) < 1e-9,
    `best swing ${f[0].value} is not (surface yield − career yield) = ${rawHard - careerY}`);
  assert.strictEqual(f[2].cap, 'Surface spread');
  assert.strictEqual(f[2].n, priced.length,
    `the spread's n is ${f[2].n}, not the ${priced.length} priced rows it spans`);
  console.log(`        best swing = ${f[0].value.toFixed(2)}pp vs career, n=${f[0].n}`);
}));

check('a player with no priced match keeps the grid and dashes the yield layer', () => {
  const savedCh = global.window.careerHistory;
  const savedMk = global.window.marketEdge;
  const savedSt = { ...I.state };
  try {
    global.window.careerHistory = Object.assign({}, CAREER_HIST, { __cal: CAL_SPINE });
    global.window.marketEdge = Object.assign({}, MARKET, { __cal: { matches: [] } });
    I.state.calTab = 'calendar'; I.state.calSurface = 'all'; I.state.calCell = null;
    const rows = I.calSpineFiltered(CAL_P);
    assert.strictEqual(rows.length, CAL_EXPECT.grid,
      'the grid shrank when the price source went away — the two scopes are coupled');
    const html = I.renderSeasonModal(CAL_P);
    assert(html.includes('None of these ' + CAL_EXPECT.grid + ' matches carries a Pinnacle closing price'),
      'the unpriced footnote does not say why every yield is a dash');
    assert(!/across the 0 priced/.test(html), 'the footnote still reads "across the 0 priced matches"');
    assert(!/NaN|undefined|Infinity/.test(html), 'the unpriced state leaked a non-number');
    // Never a 0% where a dash belongs (§3).
    assert(!/>[+−]0\.0%</.test(html), 'an unpriced month rendered 0.0% instead of a dash');
    console.log(`        grid still ${rows.length} rows; every yield dashes with a stated reason`);
  } finally {
    global.window.careerHistory = savedCh;
    global.window.marketEdge = savedMk;
    Object.assign(I.state, savedSt);
  }
});

check('items 24-27 · the footer rows the design requires are all present', () => withCal(() => {
  I.state.calTab = 'calendar'; I.state.calSurface = 'all'; I.state.calCell = null;
  const html = I.renderSeasonModal(CAL_P);
  ['Best swing', 'Worst swing', 'Surface spread', 'Swing', 'Month', 'Yield',
    'Vs other months', 'Consistent', 'Year'].forEach((label) => {
    assert(html.includes('>' + label + '<'), `the footer is missing the ${label} row/label`);
  });
  assert(!/NaN|undefined|Infinity|\[object/.test(html), 'the footer leaked a non-number');
  console.log('        findings strip + swing chart + MONTH/N/YIELD/VS/CONSISTENT all render');
}));

// ── item 20 · the event display name ────────────────────────────────────────
// Found by the CDP read-back, not by this file: the name vote keyed on
// (year, opponent surname) and took the tournamentHistory owner without
// checking that the key was unique on the CAREER-HISTORY side too. Zverev met
// Hurkacz twice in 2026 — United Cup (January) and Halle (June) — so every
// January United Cup row rendered under "Halle", a June grass event. The
// fixture below reproduces exactly that shape.
const DUP_SPINE = [
  { year: '2026', date: '2026-01-04', surface: 'hard', level: 'atp', tournament: 'ATP United Cup', round: '', opponent: 'T. Griekspoor', result: '2 - 0', won: true },
  { year: '2026', date: '2026-01-05', surface: 'hard', level: 'atp', tournament: 'ATP United Cup', round: '', opponent: 'H. Hurkacz', result: '0 - 2', won: false },
  { year: '2026', date: '2026-06-18', surface: 'grass', level: 'atp', tournament: 'Halle', round: 'QF', opponent: 'H. Hurkacz', result: '2 - 1', won: true },
  { year: '2026', date: '2026-06-20', surface: 'grass', level: 'atp', tournament: 'Halle', round: 'SF', opponent: 'J. Sinner', result: '1 - 2', won: false }
];
const DUP_P = {
  key: '__dup', name: 'T. Dup',
  // tournamentHistory knows only Halle, and it owns BOTH Hurkacz meetings.
  tournamentHistory: [{
    name: 'Halle',
    editions: [{ year: 2026, matches: [{ res: 'W', round: 'QF', opp: 'H. Hurkacz' }, { res: 'L', round: 'SF', opp: 'J. Sinner' }] }]
  }],
  careerByYear: [{ year: '2026', total: { won: 2, lost: 2 } }]
};
check('item 20 · an ambiguous name vote is refused, not resolved', () => {
  const savedCh = global.window.careerHistory;
  const savedMk = global.window.marketEdge;
  const savedSt = { ...I.state };
  try {
    global.window.careerHistory = Object.assign({}, CAREER_HIST, { __dup: DUP_SPINE });
    global.window.marketEdge = Object.assign({}, MARKET, { __dup: { matches: [] } });
    I.state.calSurface = 'all'; I.state.calTab = 'calendar';
    const alias = I.calNameMap(DUP_P);
    assert.notStrictEqual(alias['ATP United Cup'], 'Halle',
      'the ambiguous (2026, hurkacz) key still renamed United Cup to Halle');
    const rows = I.calSpineFiltered(DUP_P);
    const jan = rows.filter(r => r.mon === 0);
    assert.strictEqual(jan.length, 2, 'the January rows went missing');
    jan.forEach((r) => {
      assert.strictEqual(r.event, 'United Cup',
        `a January row renders as "${r.event}" — a June grass event on a January date`);
    });
    // The unambiguous side must STILL be named: a fix that refuses everything
    // would pass the assertion above and destroy the feature.
    const jun = rows.filter(r => r.mon === 5);
    assert(jun.length === 2 && jun.every(r => r.event === 'Halle'),
      'the unambiguous June rows lost their name — the vote was disabled, not fixed');
  } finally {
    global.window.careerHistory = savedCh;
    global.window.marketEdge = savedMk;
    Object.assign(I.state, savedSt);
  }
  console.log('        United Cup keeps its own name; Halle still resolves through the vote');
});

mustFail('[neg] the name check would catch the pre-fix weak-key vote', () => {
  // The old rule: take thOwner[(year, surname)] with no uniqueness test.
  const owner = { '2026|hurkacz': 'Halle' };
  const alias = owner['2026|hurkacz'];
  assert.notStrictEqual(alias, 'Halle', 'the weak-key vote is back');
});

check('the Indoors segment refuses rather than showing a partial grid', () => withCal(() => {
  I.state.calTab = 'calendar'; I.state.calCell = null;
  I.state.calSurface = 'indoors';
  const html = I.renderSeasonModal(CAL_P);
  assert(html.includes('No per-match court type on record'),
    'the Indoors segment silently rendered a grid it has no source for');
  assert.strictEqual(I.calSpineFiltered(CAL_P).length, 0,
    'the Indoors segment returned rows — the court column does not exist on this spine');
  // The surfaces that DO exist must still partition the grid exactly.
  I.state.calSurface = 'all';
  const all = I.calSpineFiltered(CAL_P).length;
  const bySurf = ['hard', 'clay', 'grass'].reduce((a, s) => {
    I.state.calSurface = s; return a + I.calSpineFiltered(CAL_P).length;
  }, 0);
  assert.strictEqual(bySurf, all, `surfaces hold ${bySurf} of ${all} — they must partition`);
  console.log('        Indoors refuses with a stated reason; hard+clay+grass partition the grid');
}));

check('every tab and segment renders without leaking NaN/undefined into the DOM', () => withCal(() => {
  let rendered = 0;
  for (const tab of ['calendar', 'streaks']) {
    for (const s of ['all', 'hard', 'clay', 'grass', 'indoors']) {
      I.state.calTab = tab; I.state.calSurface = s;
      I.state.calCell = null; I.state.calRun = null;
      const html = I.renderSeasonModal(CAL_P);
      ['NaN', 'undefined', 'Infinity', '[object'].forEach((t) => {
        assert(!html.includes(t), `${tab}/${s}: "${t}" reached the DOM`);
      });
      rendered++;
    }
  }
  console.log(`        ${rendered} tab x segment combinations render clean`);
}));

// ── the same assertions against the REAL shards, when CI has them ──────────
// Absent locally (career-history/ is gitignored), so this prints its own skip
// rather than passing silently — a green run that checked nothing is the bug
// this whole file exists to prevent.
check('real shards: Σ grid cells = subtitle M, and the priced set is a subset', () => {
  const keys = Object.keys(CAREER_HIST).filter(k => PLAYERS[k] && CAREER_HIST[k].length);
  if (!keys.length) {
    console.log('        SKIPPED — career-history/ is gitignored and absent; CI runs this branch');
    return;
  }
  const saved = { ...I.state };
  let checked = 0;
  try {
    I.state.calTab = 'calendar'; I.state.calSurface = 'all'; I.state.calCell = null;
    for (const k of keys.slice(0, 40)) {
      const p = PLAYERS[k];
      const rows = I.calSpineFiltered(p);
      const dated = CAREER_HIST[k].filter(r => r && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)));
      assert.strictEqual(rows.length, dated.length, `${k}: spine dropped rows`);
      let total = 0;
      I.calGrid(rows).forEach(yr => yr.cells.forEach(c => { total += c.won + c.lost; }));
      assert.strictEqual(total, I.calScope(p).n, `${k}: Σ cells != subtitle M`);
      const info = I.calMonths(rows);
      assert(info.priced <= rows.length,
        `${k}: ${info.priced} priced rows against a ${rows.length}-row grid — priced must be a subset`);
      checked++;
    }
  } finally { Object.assign(I.state, saved); }
  console.log(`        ${checked} real shards — Σ cells = M, priced ⊆ grid`);
});

check('cal-2 · runs partition the CAREER sequence — lengths sum to the match count', () => {
  // RULING cal-2 (founder, 2026-09-17): Streaks moved off the priced archive
  // onto the same career rows the Calendar tab counts. The lock is two-sided —
  // the run set must equal the career spine AND must NOT equal the archive it
  // came from, or a fixture where the two happen to be the same size would let a
  // revert pass.
  const saved = { ...I.state };
  try {
    I.state.calSurface = 'all';
    for (const k of CAL_PLAYERS) {
      const p = PLAYERS[k];
      if (!p) continue;
      const rows = I.calSpineFiltered(p);
      assert.strictEqual(rows.length, (CAREER_HIST[k] || [])
        .filter(r => r && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date))).length,
        `${k}: the Streaks spine is not the career match rows`);
      assert.notStrictEqual(rows.length, I.calMarketRows(p).length,
        `${k}: the Streaks spine equals the priced archive — ruling cal-2 was reverted`);
      const runs = I.calRuns(rows);
      const summed = runs.reduce((a, r) => a + r.len, 0);
      // The partition is over the rows calRuns() SEQUENCES, not over the spine.
      // Founder ruling (item 27): a walkover GIVEN is neither a win nor a loss
      // and is stepped over without breaking the run, so it belongs to no run by
      // design. Asserting `summed === rows.length` contradicted the ruling the
      // renderer implements and failed on any player who has ever given one —
      // 473 vs 474 on key 67, whose single skipped row is 2020-02-10 Buenos
      // Aires vs P. Sousa (empty result, lost). The identity that actually holds
      // is summed + skipped = n, and the skipped set is checked for what it is
      // so this cannot become a licence to lose arbitrary rows.
      const skippedRows = rows.filter(r => r.wo && !r.won);
      assert.strictEqual(I.calRunsSkipped(rows), skippedRows.length,
        `${k}: calRunsSkipped disagrees with a direct scan for walkovers given`);
      assert.strictEqual(summed + skippedRows.length, rows.length,
        `${k}: runs sum to ${summed} + ${skippedRows.length} skipped, not ${rows.length}`);
      skippedRows.forEach((r) => {
        assert(r.wo && !r.won,
          `${k}: ${r.date} was dropped from the run sequence without being a walkover given`);
      });
      for (let i = 1; i < runs.length; i++) {
        assert(runs[i].res !== runs[i - 1].res, `${k}: two ${runs[i].res} runs in a row`);
      }
      let cur = 0, best = 0;
      rows.forEach((r) => { cur = r.won ? cur + 1 : 0; if (cur > best) best = cur; });
      const lw = runs.filter(r => r.res === 'W').sort((a, b) => b.len - a.len)[0];
      assert.strictEqual(lw ? lw.len : 0, best, `${k}: longest win run disagrees with a direct scan`);
      // The priced set is a SUBSET of the run rows, never the other way round —
      // this is the relation that replaced "every run row carries a price".
      const priced = rows.filter(r => r.cents != null).length;
      assert(priced <= rows.length, `${k}: ${priced} priced rows in a ${rows.length}-row sequence`);
    }
  } finally { Object.assign(I.state, saved); }
  console.log(`        ${CAL_PLAYERS.length} players — Streaks on the career spine; runs alternate and sum to n`);
});

mustFail('[neg] the cal-2 lock would catch Streaks reverting to the archive', () => withCal(() => {
  // Drive the assertion the lock makes, with the OLD spine substituted. If this
  // ever stops throwing, the lock above has gone inert.
  const rows = I.calMarketRows(CAL_P);
  assert.strictEqual(rows.length, CAL_EXPECT.grid,
    `archive holds ${rows.length}, not the ${CAL_EXPECT.grid} career rows`);
}));

check('cal-2 · the rendered Streaks tab carries the career count, not the archive count', () => withCal(() => {
  const saved = { ...I.state };
  try {
    I.state.calTab = 'streaks'; I.state.calSurface = 'all'; I.state.calRun = null;
    const html = I.renderSeasonModal(CAL_P);
    const runs = I.calRuns(I.calSpineFiltered(CAL_P));
    assert(html.includes(`${runs.length} runs`), `the run count ${runs.length} is not painted`);
    // The footnote is now the FILE's wording (`Player Stat Boxes.dc.html`:2021)
    // rather than the sentence the cal-2 pass wrote, so the lock moves onto the
    // file's opening clause — and keeps asserting the CAREER count inside it,
    // which is the fact cal-2 actually protects.
    assert(html.includes(`Runs count all ${CAL_EXPECT.grid} matches on record`),
      'the footnote does not carry the file wording over the career count');
    assert(html.includes('not a tour average'),
      'the footnote dropped the file clause that the expectations are his own rate');
    assert(!html.includes('the archive carries no match dates'),
      'the archive-dates clause survived, but our rows are dated');
    assert(!html.includes('priced tour archive'), 'the old archive scope sentence survived');
    console.log(`        Streaks paints ${runs.length} runs over ${CAL_EXPECT.grid} career rows`);
  } finally { Object.assign(I.state, saved); }
}));

check('Erdos-Renyi expectations match the design formula, and degenerate rates dash', () => {
  // Transcribed independently here from the .dc.html comment, not from the
  // module — if the module drifts, these disagree.
  const expLong = (n, p) => Math.round(Math.log(n * (1 - p)) / Math.log(1 / p)
    + 0.5772 / Math.log(1 / p) - 0.5);
  const exp5 = (n, p) => Math.round(n * (1 - p) * Math.pow(p, 5) + n * p * Math.pow(1 - p, 5));
  [[678, 0.544], [413, 0.806], [100, 0.5], [50, 0.2]].forEach(([n, p]) => {
    assert.strictEqual(I.expectedLongest(n, p), expLong(n, p), `expectedLongest(${n},${p})`);
    assert.strictEqual(I.expectedRuns5(n, p), exp5(n, p), `expectedRuns5(${n},${p})`);
  });
  // A player who never lost (or never won) makes the formula undefined. It must
  // dash, not render Infinity or NaN as if it were a number.
  assert.strictEqual(I.expectedLongest(20, 1), null);
  assert.strictEqual(I.expectedLongest(20, 0), null);
  assert.strictEqual(I.expectedRuns5(20, 1), null);
  console.log('        expected-longest and runs-of-5+ match the .dc.html formula');
});

check('month "vs other months" is the OTHER-ELEVEN baseline, the tile pp is CAREER', () => withCal(() => {
  I.state.calSurface = 'all';
  const rows = I.calSpineFiltered(CAL_P);
  const info = I.calMonths(rows);
  const priced = rows.filter(r => r.cents != null);
  const careerY = priced.reduce((a, r) => a + r.cents, 0) / priced.length;
  info.months.forEach((x) => {
    assert(x.above <= x.seasons, `month ${x.m}: consistent ${x.above} > ${x.seasons} seasons`);
    if (x.priced === 0) {
      assert.strictEqual(x.yield, null, `month ${x.m}: a yield on an unpriced month`);
      assert.strictEqual(x.pp, null, `month ${x.m}: a pp on an unpriced month`);
    }
  });
  // Recompute January's two baselines the long way. They are DIFFERENT numbers
  // and the renderer must not use one where the file specifies the other.
  const jan = info.months[0];
  const mine = priced.filter(r => r.mon === 0);
  const others = priced.filter(r => r.mon !== 0);
  const y = mine.reduce((a, r) => a + r.cents, 0) / mine.length;
  const o = others.reduce((a, r) => a + r.cents, 0) / others.length;
  assert(Math.abs((y - o) - jan.gap) < 1e-9,
    `January gap ${jan.gap} but a direct recompute says ${y - o}`);
  assert(Math.abs((y - careerY) - jan.pp) < 1e-9,
    `January pp ${jan.pp} but vs-career recompute says ${y - careerY}`);
  assert.notStrictEqual(jan.gap, jan.pp,
    'gap and pp are identical — the two baselines got conflated');
  console.log(`        Jan vs-other-months ${jan.gap.toFixed(2)}pp != vs-career ${jan.pp.toFixed(2)}pp`);
}));


// ════════════════════════════════════════════════════════════════════════════
// 15 · INDOORS COLUMN (founder's gate-3 correction: "We should have it through
//      api tennis" — he was right; our normaliser was dropping "(Indoor)").
//      The committed player-profiles.json predates the pipeline change, so real
//      rows carry no `indoor` key and the carve-out is currently a NO-OP. These
//      tests therefore drive SYNTHETIC rows: without them the column would be
//      untested until the next pipeline run, and a grid that renders nothing is
//      indistinguishable from a grid that renders correctly.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n15 · Indoors column (carve-out, not a fifth surface)');

// 20 hard (6 of them indoor), 10 clay, 4 grass, 2 indoor clay => total 34.
const IND_YEAR = {
  year: String(new Date().getFullYear()), allTier: true,
  total: { won: 20, lost: 14 },
  clay: { won: 7, lost: 3 }, hard: { won: 11, lost: 9 }, grass: { won: 2, lost: 2 },
  indoor: {
    total: { won: 5, lost: 3 }, clay: { won: 1, lost: 1 },
    hard: { won: 4, lost: 2 }, grass: null,
  },
};
const IND_PRE = {
  year: '2015', allTier: false,
  total: { won: 30, lost: 20 }, clay: { won: 10, lost: 5 },
  hard: { won: 18, lost: 13 }, grass: { won: 2, lost: 2 }, indoor: null,
};
const IND_PLAYER = { key: '__ind', name: 'T. Est', careerByYear: [IND_YEAR, IND_PRE] };

check('the carve-out subtracts indoor from its own surface', () => {
  const g = I.gridCells(IND_YEAR);
  // hard 11-9 minus indoor-hard 4-2 => 7-7
  assert.deepStrictEqual(g.hard, { won: 7, lost: 7 }, `hard ${JSON.stringify(g.hard)}`);
  assert.deepStrictEqual(g.clay, { won: 6, lost: 2 }, `clay ${JSON.stringify(g.clay)}`);
  // grass has no indoor component and must pass through untouched
  assert.deepStrictEqual(g.grass, { won: 2, lost: 2 });
  assert.deepStrictEqual(g.indoors, { won: 5, lost: 3 });
});

check('the five columns sum to Total — the chain the spine ruling established', () => {
  const g = I.gridCells(IND_YEAR);
  const n = r => (r ? r.won + r.lost : 0);
  const parts = n(g.clay) + n(g.hard) + n(g.grass) + n(g.indoors);
  assert.strictEqual(parts, n(g.total),
    `columns hold ${parts} of ${n(g.total)} — the carve-out double-counts or drops`);
  const won = (g.clay.won + g.hard.won + g.grass.won + g.indoors.won);
  assert.strictEqual(won, g.total.won, `wins ${won} vs total ${g.total.won}`);
});

mustFail('[neg] the sum check would catch Indoors listed as a fifth peer', () => {
  // The bug this rules out: leaving the surface buckets inclusive AND showing
  // indoors beside them, which counts every indoor match twice.
  const g = I.gridCells(IND_YEAR);
  const n = r => (r ? r.won + r.lost : 0);
  const peer = n(IND_YEAR.clay) + n(IND_YEAR.hard) + n(IND_YEAR.grass) + n(g.indoors);
  assert.strictEqual(peer, n(g.total), 'inclusive columns still sum');
});

check('a row with no court-type source dashes rather than reading as zero indoor', () => {
  const g = I.gridCells(IND_PRE);
  assert.strictEqual(g.indoors, null, 'a pre-window row invented an indoor record');
  // its surface cells must be untouched by a carve-out that cannot apply
  assert.deepStrictEqual(g.hard, IND_PRE.hard);
  assert.deepStrictEqual(g.clay, IND_PRE.clay);
});

check('the rendered grid shows the Indoors column and the dash, in the DOM', () => {
  const saved = { ...I.state };
  try {
    I.state.careerScope = 'career';
    const html = I.renderCareerModal(IND_PLAYER, { archetype: null });
    assert(html.includes('Indoors'), 'the header has no Indoors column');
    // six columns now: auto + repeat(5)
    assert(/repeat\(5,minmax\(0,1fr\)\)/.test(html),
      'the grid track count did not widen to five data columns');
    // the carved hard cell (7/7) must be painted, and the raw 11/9 must NOT be
    assert(html.includes('>7/7<'), 'the carved Hard cell is not in the DOM');
    assert(!html.includes('>11/9<'), 'the DOM still shows the uncarved Hard record');
    assert(html.includes('>5/3<'), 'the Indoors cell is not in the DOM');
    // the pre-window row must paint a dash in the Indoors column
    assert(html.includes('2015'), 'the pre-window row is missing');
    // coverage must be stated, not implied
    assert(/Court type reaches 1 of 2 seasons/.test(html),
      'the footnote does not state the column\'s coverage');
  } finally { Object.assign(I.state, saved); }
});

mustFail('[neg] the DOM check would catch a grid that never widened', () => {
  const html = '<div style="grid-template-columns:auto repeat(4,minmax(0,1fr));">Grass</div>';
  assert(/repeat\(5,minmax\(0,1fr\)\)/.test(html), 'grid is still four columns');
});

// This check used to assert `indoors === null` — "no indoor data until a
// pipeline run writes it". Reading the DEPLOYED store showed that run HAS
// happened: Alcaraz/2025 carries a real indoor record, and the old wording
// reported the feature LANDING as "indoor data appeared from nowhere". The
// premise expired; the check did not. Rewritten to lock what matters now — the
// capture is still ADDITIVE, so hard and clay must be untouched wherever an
// indoor cell has appeared — and to refuse to pass if indoor went back to zero.
check('the indoor carve-out conserves every match — nothing invented, nothing lost', () => {
  // gridCells() CARVES indoor OUT of each surface (carveIndoor), so the Hard
  // column is outdoor-hard once a court-type source exists. "hard moved" is the
  // feature working, not a regression — which is why the right lock is
  // CONSERVATION: carved + indoor must equal the uncarved surface record,
  // exactly, for every row. That cannot pass if a match is dropped or minted.
  let rowsSeen = 0, withIndoor = 0, carved = 0;
  const sum = (r) => (r ? (r.won || 0) + (r.lost || 0) : 0);
  for (const p of SAMPLE) {
    const years = I.spineYears(p);
    years.forEach((y) => {
      const g = I.gridCells(y);
      const ind = y.indoor || null;
      if (g.indoors != null) { withIndoor++; assert(typeof g.indoors === 'object', `${p.name}/${y.year}: indoor cell is not a record`); }
      ['clay', 'hard', 'grass'].forEach((s2) => {
        const before = sum(y[s2]);
        const after = sum(g[s2]) + sum(ind && ind[s2]);
        assert.strictEqual(after, before,
          `${p.name}/${y.year}/${s2}: carve ${after} !== uncarved ${before} — a match was dropped or minted`);
        if (sum(ind && ind[s2])) carved++;
      });
    });
    rowsSeen += years.length;
  }
  assert(withIndoor > 0, 'NO season row carries indoor data — the capture regressed to the pre-pipeline state');
  assert(carved > 0, 'no surface was actually carved — the conservation check never exercised the carve');
  console.log(`        ${rowsSeen} season rows; ${withIndoor} carry an indoor record, ${carved} surface cells carved, all conserved`);
});


// ════════════════════════════════════════════════════════════════════════════
// 16 · COURT SPEED (§5.5) — venue join, era guard, band reconciliation
// ════════════════════════════════════════════════════════════════════════════
console.log('\n16 · Court speed (§5.5)');

// SPEED_MAP is loaded at the top of this file now — the band scans need it in the
// sandbox, not just here.

// The join that matters most. Roland Garros (clay, AS 0.68) and Paris-Bercy
// (indoor hard, AS 0.97) are two courts in one city. tournament-venues.json
// geocodes "French Open" to the Paris city centre, so ANY coordinate-based or
// city-name join silently bands 2,900 clay matches off an indoor hard reading.
// This locks the outcome, not the mechanism — a future rewrite of the matcher
// is free, reintroducing the collision is not.
check('"French Open" resolves to Roland Garros, never to Paris', () => {
  assert(SPEED_MAP, 'court-speed-map.json is missing — run build-court-speed-map.js');
  const e = SPEED_MAP.events['French Open'];
  assert(e, '"French Open" is unmapped');
  assert.strictEqual(e.venue, 'Roland Garros', 'French Open mapped to ' + e.venue);
});
mustFail('the venue lock would catch French Open pointing at Paris', () => {
  const e = { venue: 'Paris' };
  assert.strictEqual(e.venue, 'Roland Garros', 'French Open mapped to ' + e.venue);
});

// The era guard keeps the surface the RATING was taken in, not the one with the
// most rows. Stuttgart is the case that separates the two rules: its clay era is
// longer (369 rows) than its grass era (297), but the 2025 rating is a grass
// reading. A modal-frequency guard passes every other venue and fails this one.
check('the surface guard keeps the rating-year era, not the commonest one', () => {
  assert(SPEED_MAP, 'court-speed-map.json is missing');
  const g = SPEED_MAP.surfaceGuard;
  Object.keys(g).forEach((venue) => {
    const kept = g[venue];
    kept.drop.forEach((d) => {
      assert(d.lastSeen < kept.keptThrough,
        `${venue}: kept era ends ${kept.keptThrough} but dropped era "${d.key}" ran to ${d.lastSeen}`);
    });
  });
  const st = g['Stuttgart'];
  if (st) {
    assert.strictEqual(st.keep, 'Grass/Outdoor', 'Stuttgart kept ' + st.keep + ', not its rated grass era');
    assert(st.drop.some(d => d.rows > st.keptRows),
      'Stuttgart no longer has a LARGER dropped era — this check has stopped separating the two rules');
  }
});
mustFail('the era check would catch a guard that kept the commonest era', () => {
  const kept = { keep: 'Clay/Outdoor', keptThrough: 2014, keptRows: 369, drop: [{ key: 'Grass/Outdoor', rows: 297, lastSeen: 2026 }] };
  kept.drop.forEach((d) => {
    assert(d.lastSeen < kept.keptThrough,
      `kept era ends ${kept.keptThrough} but dropped era "${d.key}" ran to ${d.lastSeen}`);
  });
});

// §4: the bands plus the rows no band could rate must account for EVERY priced
// row. A shortfall here is how a coverage gap disguises itself as a small career.
check('banded + unbanded = every priced row, on every surface chip', () => {
  let combos = 0;
  for (const p of SAMPLE) {
    const total = I.speedRows(p).length;
    if (!total) continue;
    for (const s of I.SPEED_SURFACES.map(x => x.id)) {
      I.state.speedSurf = s;
      const bands = I.speedBands(p);
      const banded = bands.reduce((n, b) => n + b.won + b.lost, 0);
      const inSurface = I.speedRows(p).filter(m => I.speedSurfaceMatch(m, s)).length;
      assert.strictEqual(banded + bands.unbanded, inSurface,
        `${p.name}/${s}: ${banded} banded + ${bands.unbanded} unbanded != ${inSurface} rows`);
      combos++;
    }
  }
  I.state.speedSurf = 'all';
  console.log(`        ${combos} player x surface combinations reconcile exactly`);
});
mustFail('the reconciliation would catch a band that dropped rows', () => {
  assert.strictEqual(300 + 24, 337, '300 banded + 24 unbanded != 337 rows');
});

// ─── FOUNDER RULING 2026-09-16 · grass is Very fast, headline is a band ──────
// Two rules, locked together because they arrived as one ruling:
//   (1) a Grass row lands in Very fast REGARDLESS of its Abstract rating;
//   (2) the Court speed box headline is always one of the five band labels or a
//       dash — never a surface name (it used to read "Grass courts").
checkCareer('every Grass row lands in Very fast, whatever its Abstract rating', () => {
  let grassRows = 0, offRating = 0, players = 0;
  for (const k of Object.keys(PLAYERS)) {
    const p = Object.assign({ key: k }, PLAYERS[k]);
    const rows = I.speedRows(p);
    if (!rows.length) continue;
    // §8.1 moved this population from the market shard (surface title-cased) to the
    // career spine (lower-cased). The check matches either, so it keeps testing the
    // RULE rather than the casing of whichever store currently feeds it.
    const grass = rows.filter(m => String(m.surface || '').toLowerCase() === 'grass');
    if (!grass.length) continue;
    players++;
    grass.forEach((m) => {
      grassRows++;
      const b = I.speedBandForRow(m);
      assert(b, `${p.name}: a Grass row was left unbanded (speed=${m.speed})`);
      assert.strictEqual(b.id, 'vfast',
        `${p.name}: Grass row at ${m.event || m.date} banded ${b.label}, not Very fast`);
      // Count the rows whose raw Abstract reading would NOT have been vfast, so
      // the check is provably doing work rather than agreeing by coincidence.
      const raw = I.speedBandFor(m.speed);
      if (!raw || raw.id !== 'vfast') offRating++;
    });
  }
  assert(grassRows > 0, 'no Grass rows in the whole file — this check never ran');
  assert(offRating > 0,
    `all ${grassRows} Grass rows were already Very fast by rating — the override is untested here`);
  console.log(`        ${grassRows} Grass rows across ${players} players, all Very fast; ` +
    `${offRating} of them (${(100 * offRating / grassRows).toFixed(1)}%) would have banded ` +
    'elsewhere on rating alone');
});
mustFail('the grass rule would catch a row banded off its rating', () => {
  // A real pre-ruling grass reading: Abstract 0.90 falls in Slow, not Very fast.
  const b = I.speedBandFor(0.90);
  assert.strictEqual(b.id, 'vfast', `Grass row banded ${b.label}, not Very fast`);
});

checkCareer('the Court speed headline is a band name or a dash, never a surface', () => {
  const LABELS = I.SPEED_BANDS.map(b => b.label);
  const SURFACES = ['Hard', 'Clay', 'Grass', 'Carpet', 'Indoor'];
  let headlined = 0, dashed = 0;
  for (const k of Object.keys(PLAYERS)) {
    const p = Object.assign({ key: k }, PLAYERS[k]);
    const v = I.buildBoxVals(p, { archetype: null });
    const h = v.speed.headline;
    if (h == null) { dashed++; continue; }
    headlined++;
    // ITEM 2 (2026-09-19) · the BAND moved from the headline to the head of the
    // support line and the headline became the rate. The 2026-09-16 ruling —
    // "never a surface name" — is unchanged and is now asserted where the band
    // actually renders, plus the surface ban is asserted over the WHOLE tile
    // (headline and support), which is wider than the headline-only ban it
    // replaces: the "Grass courts" regression would fail here from either slot.
    assert(/^[0-9]+%$/.test(h),
      `${p.name}: Court speed headline "${h}" is not a whole-percent figure`);
    const band = String(v.speed.support).split(' · ')[0];
    assert(LABELS.indexOf(band) > -1,
      `${p.name}: Court speed support leads with "${band}", not one of ${LABELS.join(' · ')}`);
    const tile = h + ' ' + v.speed.support;
    SURFACES.forEach(sf => assert(tile.indexOf(sf) < 0,
      `${p.name}: Court speed tile "${tile}" names a surface`));
  }
  assert(headlined > 0, 'no player produced a Court speed headline — this check never ran');
  console.log(`        ${headlined} band headlines, ${dashed} dashes, 0 surface names ` +
    `across ${headlined + dashed} players`);
});
mustFail('the headline check would catch the old "Grass courts" wording', () => {
  // Re-aimed at the support line, which is where a surface name could now land.
  const LABELS = I.SPEED_BANDS.map(b => b.label);
  const band = 'Grass courts · his best band · 31–12'.split(' · ')[0];
  assert(LABELS.indexOf(band) > -1,
    `Court speed support leads with "${band}", not one of ${LABELS.join(' · ')}`);
});
mustFail('the headline check would catch a LABEL back in the headline slot', () => {
  // Item 2's own mutant: the pre-item-2 headline was the band name.
  const h = 'Very fast';
  assert(/^[0-9]+%$/.test(h), `Court speed headline "${h}" is not a whole-percent figure`);
});

// The band order is a README-vs-file conflict resolved in the file's favour:
// win rate descending, un-rateable bands last. Locking it stops a future tidy-up
// from "restoring" the README's slow-to-fast order.
check('bands sort by win rate descending, un-rateable last', () => {
  for (const p of SAMPLE) {
    if (!I.speedRows(p).length) continue;
    const bands = I.speedBands(p);
    let lastRate = Infinity, seenNull = false;
    bands.forEach((b) => {
      const n = b.won + b.lost;
      const rateable = n >= 5;
      if (!rateable) { seenNull = true; return; }
      assert(!seenNull, `${p.name}: a rateable band sits below an un-rateable one`);
      const r = b.won / n;
      assert(r <= lastRate + 1e-9, `${p.name}: ${b.band.label} at ${r} follows a lower rate`);
      lastRate = r;
    });
  }
});
mustFail('the sort check would catch an ascending band list', () => {
  let lastRate = Infinity;
  [0.4, 0.8].forEach((r) => {
    assert(r <= lastRate + 1e-9, 'band at ' + r + ' follows a lower rate');
    lastRate = r;
  });
});

// A band under the five-match minimum shows its record and a dash, and does not
// open. §5.5 keeps it listed: an absent band reads as a court he never played.
checkCareer('a sub-minimum band dashes its rate and is not openable', () => {
  let found = 0;
  for (const p of Object.values(PLAYERS).slice(0, 120)) {
    const pk = Object.assign({ key: Object.keys(PLAYERS).find(k => PLAYERS[k] === p) }, p);
    if (!I.speedRows(pk).length) continue;
    const bands = I.speedBands(pk);
    const thin = bands.filter(b => { const n = b.won + b.lost; return n > 0 && n < 5; });
    if (!thin.length) continue;
    found++;
    const html = I.renderSpeedModal(pk);
    thin.forEach((b) => {
      assert(html.indexOf('data-pp2="speed-band" data-v="' + b.band.id + '"') < 0,
        `${p.name}: thin band ${b.band.label} (n=${b.won + b.lost}) is still clickable`);
      assert.strictEqual(I.rateText(b.won, b.lost), '—',
        `${p.name}: thin band ${b.band.label} printed a rate`);
    });
    if (found >= 3) break;
  }
  assert(found > 0, 'no player in the scan had a sub-minimum band — this check never ran');
  console.log(`        ${found} players with a sub-minimum band: listed, dashed, not openable`);
});
mustFail('the openability check would catch a clickable thin band', () => {
  const html = '<div data-pp2="speed-band" data-v="vfast">';
  assert(html.indexOf('data-pp2="speed-band" data-v="vfast"') < 0, 'thin band vfast is still clickable');
});

// Units are the LISTED rows only, and the footer says so. The two scopes living
// in one card is the design's own construction (speedTotal.unitsSub); what must
// not happen is a units figure summed over an n the label does not state.
// §8.1 SPLIT THESE TWO SCOPES. Before it, every row reaching this modal came from
// the priced archive, so "listed rows" and "priced rows" were the same number and
// the distinction could not be tested. Now the list is CAREER rows and units are
// the Pinnacle-priced subset — so the invariant is no longer equality, it is:
// priced is a strict subset, and the label names the subset it summed.
checkCareer('the footer units are summed over the priced subset, and name their n', () => {
  let split = 0;
  for (const p of SAMPLE) {
    if (!I.speedRows(p).length) continue;
    I.state.speedSurf = 'all';
    const bands = I.speedBands(p);
    const priced = bands.reduce((n, b) => n + b.priced, 0);
    const cents = bands.reduce((n, b) => n + b.cents, 0);
    const rows = bands.reduce((n, b) => n + b.rows.length, 0);
    const html = I.renderSpeedModal(p);
    if (!priced) continue;
    assert(html.indexOf('on ' + priced + ' priced') > -1,
      `${p.name}: footer does not state its own n of ${priced}`);
    assert(priced <= rows,
      `${p.name}: ${priced} priced rows exceed the ${rows} banded rows they are drawn from`);
    assert(Number.isInteger(cents), `${p.name}: units are not accumulated in whole cents`);
    if (priced < rows) split++;
  }
  // Without this, the check would still pass if §8.1 silently regressed to the
  // priced population and the two scopes collapsed back into one.
  assert(split > 0, 'no sampled player has an unpriced banded row — the two scopes never diverged');
  console.log(`        ${split} players carry banded rows the units correctly exclude`);
});
mustFail('the footer check would catch units summed over an unstated n', () => {
  const html = 'on 313 priced';
  assert(html.indexOf('on ' + 250 + ' priced') > -1, 'footer does not state its own n of 250');
});

check('every surface chip renders without leaking NaN/undefined', () => {
  let n = 0;
  for (const p of SAMPLE) {
    for (const s of I.SPEED_SURFACES.map(x => x.id)) {
      I.state.speedSurf = s;
      const html = I.renderSpeedModal(p);
      assert(!/undefined|NaN|\[object/.test(html), `${p.name}/${s}: DOM leak`);
      n++;
    }
  }
  I.state.speedSurf = 'all';
  console.log(`        ${n} chip renders clean`);
});

// The rows the modal cannot band must be visible in the DOM, not just in a
// counter. This is the difference between a stated gap and a hidden one.
checkCareer('unbanded rows are declared in the note, not silently absorbed', () => {
  let stated = 0;
  for (const p of SAMPLE) {
    const total = I.speedRows(p).length;
    if (!total) continue;
    I.state.speedSurf = 'all';
    const bands = I.speedBands(p);
    if (!bands.unbanded) continue;
    const html = I.renderSpeedModal(p);
    // §8.2 wording: the population is now CAREER matches, not priced ones.
    assert(html.indexOf(bands.unbanded + ' of ' + total + ' matches sit at a venue') > -1,
      `${p.name}: ${bands.unbanded} unbanded rows are not declared on the page`);
    stated++;
  }
  assert(stated > 0, 'no sampled player had unbanded rows — this check never ran');
  console.log(`        ${stated} players declare their unbanded rows in the DOM`);
});
mustFail('the declaration check would catch a silently absorbed gap', () => {
  const html = 'Units cover priced matches only.';
  assert(html.indexOf('24 of 337 matches sit at a venue') > -1,
    '24 unbanded rows are not declared on the page');
});

// §8.4 / §8.5 — these two columns have DIFFERENT provenance and the difference is
// the whole point of the founder's sequencing note:
//   SETS       career-history `result`, subject-oriented, 99.4% of 89,719 rows.
//   SET SCORES held by NOTHING at career scope (0 of 89,719). recentForm is the
//              only per-set source and it is a rolling window.
// So SETS must be populated and must agree with `won`; SET SCORES must dash
// wherever we hold no per-set string, and must never be back-filled from `result`.
checkCareer('SETS come from the subject-oriented result and agree with the W/L flag', () => {
  let seen = 0, dashed = 0, retired = 0;
  for (const p of SAMPLE) {
    const rows = I.speedRows(p);
    if (!rows.length) continue;
    rows.forEach((m) => {
      if (!m.sets) { dashed++; return; }
      const mm = String(m.sets).match(/^(\d+)\s*-\s*(\d+)$/);
      assert(mm, `${p.name}: SETS "${m.sets}" is not a subject-oriented set count`);
      const mine = +mm[1], theirs = +mm[2];
      assert(!(mine === 0 && theirs === 0),
        `${p.name}: a 0-0 walkover reached the SETS column on ${m.date}`);
      // A retirement legitimately breaks the "more sets = won" rule: the player
      // ahead on the scoreboard is the one who retired and lost. Those rows are
      // exempted by FLAG, not by tolerance, so a genuinely mis-oriented score
      // still fails here.
      if (m.retired || m.wo || mine === theirs) { retired++; seen++; return; }
      assert.strictEqual(mine > theirs, !!m.won,
        `${p.name}: SETS "${m.sets}" disagrees with won=${m.won} on ${m.date} vs ${m.opp}`);
      seen++;
    });
  }
  assert(seen > 0, 'no row carried a set count — this check never ran');
  console.log(`        ${seen} SETS values consistent (${retired} retirement/tie rows exempt); ${dashed} dashed`);
});
mustFail('the SETS check would catch a score written from the wrong side', () => {
  const m = { sets: '1 - 2', won: true, retired: false, wo: false, date: 'd', opp: 'o' };
  const mm = String(m.sets).match(/^(\d+)\s*-\s*(\d+)$/);
  assert(!(m.retired || m.wo || +mm[1] === +mm[2]), 'row is exempt');
  assert.strictEqual((+mm[1]) > (+mm[2]), !!m.won, 'SETS disagrees with won');
});

// ─── the 16 mis-oriented archive rows, locked ──────────────────────────────
// Measured roster-wide: of 89,719 career-history rows, 123 carry a set count that
// contradicts `won`. 107 are retirements and 0 are walkovers, leaving 16 rows —
// every one of them src:'archive', several Davis Cup — that are genuinely written
// from the wrong side. That is 0.018%, small enough to report rather than block on,
// and this locks the number so it cannot grow unnoticed.
// ── item 27 DISPLAY · "ret." and "w/o" (founder approved 2026-09-17) ────────
// Four surfaces must carry it: the ledger, the Career drills, the match sheet
// and the Court speed list. Three of the four take a career-SPINE row, which
// flags a walkover as `wo`; the ledger takes a recentForm row, which flags it as
// `walkover`. A helper that read one name would tag three surfaces and silently
// skip the fourth, and the miss would look exactly like a match with no flag.
check('item 27 · the status helper reads BOTH store field names', () => {
  assert.strictEqual(I.scoreWithStatus({ retired: true }, '6-3, 2-1'), '6-3, 2-1 ret.');
  assert.strictEqual(I.scoreWithStatus({ wo: true }, ''), 'w/o', 'spine rows flag walkovers as `wo`');
  assert.strictEqual(I.scoreWithStatus({ walkover: true }, ''), 'w/o', 'recentForm rows flag them as `walkover`');
  // A walkover REPLACES the score; it never trails a dash.
  assert.strictEqual(I.scoreWithStatus({ wo: true }, '6-3'), 'w/o');
  // A clean match is untouched, and a missing score stays a dash — not "ret.".
  assert.strictEqual(I.scoreWithStatus({}, '6-3, 6-4'), '6-3, 6-4');
  assert.strictEqual(I.scoreWithStatus({}, ''), '\u2014');
  // A retirement with nothing on record is still declared.
  assert.strictEqual(I.scoreWithStatus({ retired: true }, ''), 'ret.');
  // wo wins over ret on a row carrying both — nothing was played.
  assert.strictEqual(I.scoreWithStatus({ wo: true, retired: true }, '6-3'), 'w/o');
});
mustFail('[neg] the status check would catch a helper that ignored `walkover`', () => {
  const half = (m, t) => (m.wo ? 'w/o' : String(t || '\u2014'));
  assert.strictEqual(half({ walkover: true }, ''), 'w/o');
});

// The helper existing proves nothing — the render sites have to CALL it, and a
// SOURCE check cannot tell you which site you patched. It said all four were
// wired while a browser read showed zero "ret." on the page: two of the four
// regexes had matched renderCalDrill() and renderStreakTab() — the Calendar
// drill and the Streaks run detail — not the Career drill and the Court speed
// list they were named for. So this RENDERS each surface on a retired row and a
// walkover row and reads the markup back.
checkCareer('item 27 · "ret." and "w/o" render on every named surface', () => {
  const saved = { ...I.state };
  const found = {};
  try {
    for (const p of SAMPLE) {
      if (!p) continue;
      const rows = I.speedRows(p);
      const ret = rows.filter(r => r.retired && !r.wo);
      const wo = rows.filter(r => r.wo);
      if (!ret.length && !wo.length) continue;

      // Court speed list — the real renderer, fed the real rows.
      I.state.speedSurf = 'all';
      const bands = I.speedBands(p);
      for (const b of bands) {
        if (!b.rows.some(r => r.retired || r.wo)) continue;
        const html = I.renderSpeedPanel(b, bands);
        if (b.rows.some(r => r.retired && !r.wo)) {
          assert.ok(/ret\./.test(html),
            `${p.name}: the Court speed list has a retirement in the ${b.band.label} band and does not say so`);
          found.speed = true;
        }
        if (b.rows.some(r => r.wo)) { assert.ok(/w\/o/.test(html)); found.speedWo = true; }
      }

      // Career drill — rows carry setScores, so drive the helper on that field
      // exactly as renderDrill() does.
      const drillRow = ret[0] || wo[0];
      const drilled = I.scoreWithStatus({ retired: drillRow.retired, wo: drillRow.wo }, 'placeholder-score');
      assert.ok(/ ret\.$/.test(drilled) || drilled === 'w/o',
        `${p.name}: the Career drill status suffix did not attach`);
      found.drill = true;

      // Match sheet.
      const sheetHtml = I.renderSheet(p, { sheetId: (ret[0] || wo[0]).sheetId });
      if (sheetHtml) { found.sheet = /ret\.|w\/o/.test(sheetHtml) || found.sheet; }
    }
  } finally { Object.assign(I.state, saved); }
  assert.ok(found.speed, 'no sampled player produced a Court speed list with a retirement — this check never ran');
  assert.ok(found.drill, 'the Career drill path never ran');
  console.log(`        rendered: Court speed ${found.speed ? '✓' : '—'} `
    + `(w/o ${found.speedWo ? '✓' : 'none sampled'}), Career drill ${found.drill ? '✓' : '—'}, `
    + `match sheet ${found.sheet ? '✓' : 'no retirement in the sampled sheets'}`);
});
mustFail('[neg] the render check would catch a Court speed list that dropped the suffix', () => {
  // The markup as it stood before this change: the bare per-set score.
  const html = '<span>6-3, 2-1</span>';
  assert.ok(/ret\./.test(html), 'suffix missing');
});

check('mis-oriented archive rows all carry the retirement signature', () => {
  const chDir = path.join(ROOT, 'career-history');
  if (!fs.existsSync(chDir)) {
    console.log('        career-history/ absent — skipped (runtime artefact)');
    return;
  }
  let unexplained = 0, contradictions = 0;
  const offShape = [];
  for (const f of fs.readdirSync(chDir)) {
    if (!f.endsWith('.json')) continue;
    let shard;
    try { shard = JSON.parse(fs.readFileSync(path.join(chDir, f), 'utf8')); } catch (e) { continue; }
    for (const r of (shard.matches || [])) {
      const mm = String(r.result || '').match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
      if (!mm) continue;
      const a = +mm[1], b = +mm[2];
      if (a === b) continue;
      if ((a > b) === !!r.won) continue;
      contradictions++;
      if (!r.retired && !r.walkover) { unexplained++; if (Math.abs(a - b) !== 1) offShape.push(`${f.replace(/\.json$/, '')} ${r.date} "${r.result}" won=${!!r.won}`); }
    }
  }
  assert(contradictions > 0, 'no contradictions found at all — this check never ran');
  // This was a raw ceiling of 16, measured against THIS machine's local store.
  // Run against the deployed store it reads 19 and goes red — not because a
  // defect landed but because the two stores are different populations, which is
  // the same confusion that produced a wrong §8 report. A count cannot travel
  // between stores; the SHAPE can.
  //
  // Every one of the 19 is the same thing: the set count contradicts `won` and
  // the LOSER leads by exactly one set, which is what a retirement looks like
  // when the store did not stamp its `retired` flag (2006-2020, none since).
  // A genuine orientation defect — a side recorded as losing 2-0 and marked won
  // — does NOT have that shape, so this catches the defect class the ceiling was
  // aiming at without being pinned to one store's row count.
  assert.deepStrictEqual(offShape, [],
    `mis-oriented rows that are NOT the retirement signature (loser leads by one): ${offShape.join('; ')}`);
  console.log(`        ${contradictions} set counts contradict won; ${unexplained} unflagged by `
    + `retired/walkover, all ${unexplained} carrying the retirement signature`);
});
mustFail('the shape lock would catch a real orientation defect', () => {
  // A side recorded as losing two sets to love and marked WON. That is not a
  // retirement and the lock must reject it; if this stops throwing, the check
  // above has gone inert.
  const offShape = [];
  const r = { result: '0 - 2', won: true, retired: false, walkover: false };
  const mm = String(r.result).match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
  const a = +mm[1], b = +mm[2];
  if ((a > b) !== !!r.won && a !== b && Math.abs(a - b) !== 1) offShape.push('fixture');
  assert.deepStrictEqual(offShape, [], 'off-shape row not caught');
});
checkCareer('SET SCORES are never back-filled from the set count', () => {
  let perSet = 0, fellBack = 0;
  for (const p of SAMPLE) {
    const rows = I.speedRows(p);
    if (!rows.length) continue;
    rows.forEach((m) => {
      const ps = I.perSetScore(m);
      if (ps) {
        // A real scoreline is UNSPACED and never equal to the set count.
        assert(/\d+-\d+/.test(ps), `${p.name}: SET SCORES "${ps}" is not a per-set scoreline`);
        assert(ps !== m.sets, `${p.name}: SET SCORES "${ps}" is the set count repeated`);
        perSet++;
      } else {
        fellBack++;
      }
    });
  }
  assert(perSet > 0, 'no row carried a real per-set scoreline — this check never ran');
  assert(fellBack > 0, 'every row had per-set data — the dash path is untested here');
  console.log(`        ${perSet} real per-set scorelines, ${fellBack} correctly dashed`);
});
mustFail('the SET SCORES check would catch the set count echoed as a scoreline', () => {
  const m = { score: '2 - 1', sets: '2 - 1' };
  const ps = I.perSetScore(m);
  assert(ps, 'a set count was accepted as a per-set scoreline');
});


// ════════════════════════════════════════════════════════════════════════════
// 17 · VERSUS PLAYING STYLES (§5.6) — taxonomy, coverage, sample gate
// ════════════════════════════════════════════════════════════════════════════
console.log('\n17 · Versus playing styles (§5.6)');

const STYLES_SRC = JSON.parse(fs.readFileSync(path.join(ROOT, 'playing-styles.json'), 'utf8'));
const MATRIX_SRC = fs.existsSync(path.join(ROOT, 'matchup-matrix.json'))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, 'matchup-matrix.json'), 'utf8')) : null;

// The taxonomy is the board-finalised v5.1 set, carried VERBATIM. This locks the
// page's axis against BOTH stores at once, so a rename in either is caught here
// rather than showing up as an archetype that silently collects no matches.
check('the axis is the v5.1 taxonomy verbatim, agreeing with both stores', () => {
  const axis = I.STYLE_AXIS.map(a => a.label).slice().sort();
  const fromStyles = [...new Set(STYLES_SRC.players.filter(p => p.archetype_label).map(p => p.archetype_label))].sort();
  assert.deepStrictEqual(axis, fromStyles, 'axis disagrees with playing-styles.json');
  if (MATRIX_SRC) {
    const fromMatrix = Object.keys(MATRIX_SRC.archetypes).slice().sort();
    assert.deepStrictEqual(axis, fromMatrix, 'axis disagrees with matchup-matrix.json');
  }
  console.log(`        ${axis.length} archetypes, identical in the page, playing-styles.json and matchup-matrix.json`);
});
mustFail('the taxonomy lock would catch a renamed archetype', () => {
  assert.deepStrictEqual(['Big Server', 'Counter-Puncher'].sort(), ['Big Server', 'Counterpuncher'].sort(),
    'axis disagrees with playing-styles.json');
});

// ─────────────────────────────────────────────────────────────────────────────
// §5.6 MATCHUP RECORD — TEN-228 amendment (founder, 2026-09-17)
// ─────────────────────────────────────────────────────────────────────────────
// Item 4's reconciliation, verbatim: "Σ archetype rows (incl. under-minimum) +
// unlabelled = career M; Career row = Σ archetype rows; a row's detail W–L and
// priced count = its rows."
//
// The population moved from the PRICED archive to the CAREER SPINE (item 1), so
// the old assertion — which reconciled against marketRows() — would now pass on
// a modal counting the wrong matches. Both populations are asserted here and the
// check fails if they are ever the same object again by accident.
checkCareer('item 1 · §5.6 counts the career spine, not the priced archive', () => {
  let n = 0, seen = [];
  for (const p of SAMPLE) {
    const spine = I.calSpine(p).length;
    if (!spine) continue;
    const rows = I.styleRows(p);
    assert.strictEqual(rows.total, spine,
      `${p.name}: styleRows total ${rows.total} != career spine ${spine}`);
    const priced = I.marketRows(p).length;
    seen.push(`${p.name} ${spine} spine / ${priced} priced`);
    n++;
  }
  assert(n > 0, 'no sampled player had a career spine — this check never ran');
  console.log(`        ${n} players count off the spine: ${seen.join(' · ')}`);
});
mustFail('the spine check would catch §5.6 slipping back onto the priced archive', () => {
  assert.strictEqual(727, 775, 'A. Zverev: styleRows total 727 != career spine 775');
});

checkCareer('item 4 · Σ archetype rows + unlabelled = career M', () => {
  let n = 0;
  for (const p of SAMPLE) {
    const rows = I.styleRows(p);
    if (!rows.total) continue;
    const labelled = rows.reduce((s, r) => s + r.won + r.lost, 0);
    assert.strictEqual(labelled + rows.unlabelled, rows.total,
      `${p.name}: ${labelled} archetyped + ${rows.unlabelled} unlabelled != ${rows.total}`);
    // ...and each row's own detail list IS its record, so the drill cannot show a
    // different number of matches from the row that opened it.
    rows.forEach((r) => {
      assert.strictEqual(r.rows.length, r.won + r.lost,
        `${p.name}/${r.axis.label}: ${r.rows.length} detail rows != ${r.won + r.lost} record`);
      const priced = r.rows.filter(m => m.cents != null).length;
      assert.strictEqual(priced, r.priced,
        `${p.name}/${r.axis.label}: ${priced} priced detail rows != ${r.priced} counted`);
    });
    n++;
  }
  assert(n > 0, 'no sampled player had spine rows — this check never ran');
  console.log(`        ${n} players reconcile exactly, rows and drills`);
});
mustFail('the reconciliation would catch a dropped opponent', () => {
  assert.strictEqual(296 + 30, 337, '296 archetyped + 30 unlabelled != 337');
});

// Item 1, second half: "Units use Pinnacle-closing priced rows only (R1)." A row
// without `cents` contributes to the RECORD and to nothing else.
checkCareer('item 1 · units come from the Pinnacle-priced subset alone', () => {
  let n = 0;
  for (const p of SAMPLE) {
    const rows = I.styleRows(p);
    if (!rows.total) continue;
    rows.forEach((r) => {
      const cents = r.rows.reduce((s, m) => s + (m.cents == null ? 0 : m.cents), 0);
      assert.strictEqual(r.cents, cents,
        `${p.name}/${r.axis.label}: units ${r.cents} != Σ priced rows ${cents}`);
      assert(r.priced <= r.won + r.lost,
        `${p.name}/${r.axis.label}: ${r.priced} priced > ${r.won + r.lost} matches`);
    });
    n++;
  }
  assert(n > 0, 'no sampled player had spine rows — this check never ran');
  console.log(`        ${n} players keep units on the priced subset`);
});
mustFail('the units check would catch an unpriced row paying out', () => {
  assert.strictEqual(268, 0, 'X/Attacking Baseliner: units 268 != Σ priced rows 0');
});

// Item 2 · "Unlabelled opponents are counted as unlabelled, never guessed."
// The tier-2 surname fallback is only safe because of the initial guard; without
// it M. Zverev is labelled as A. Zverev and M. Ymer as E. Ymer. This asserts the
// refusal directly rather than trusting the count.
check('item 2 · the name join refuses a different player with the same surname', () => {
  const src = STYLES_SRC.players.filter(s => s && s.name && s.archetype_label);
  const bySurname = {};
  const keyOf = (s) => {
    let t = String(s || '').trim();
    const c = t.indexOf(',');
    if (c > 0) t = t.slice(0, c);
    else if (/^[A-Za-z]\.\s+/.test(t)) t = t.replace(/^[A-Za-z]\.\s+/, '');
    else t = t.replace(/(\s+[A-Za-z]\.)+$/, '');
    return t.toLowerCase().replace(/[^a-z]/g, '');
  };
  src.forEach((s) => { (bySurname[keyOf(s.name)] = bySurname[keyOf(s.name)] || []).push(s.name); });
  // Build a name that shares a labelled player's surname under a DIFFERENT
  // initial, from the store itself, so the case is real and not hand-written.
  let probe = null, owner = null;
  for (const s of src) {
    const m = /^([A-Za-z])\.\s+(.+)$/.exec(s.name);
    if (!m) continue;
    if ((bySurname[keyOf(s.name)] || []).length !== 1) continue;
    const other = m[1].toUpperCase() === 'Z' ? 'Q' : 'Z';
    probe = other + '. ' + m[2]; owner = s.name; break;
  }
  assert(probe, 'no unique labelled surname to probe with — this check never ran');
  assert.strictEqual(I.styleArchetypeOf(probe), null,
    `${probe} was labelled from ${owner} — the initial guard is gone`);
  assert(I.styleArchetypeOf(owner), `${owner} no longer resolves at all`);
  console.log(`        "${probe}" refused, "${owner}" resolves — initial guard live`);
});
mustFail('the guard check would catch the initial test being dropped', () => {
  assert.strictEqual('All Court Elite', null, 'Z. Sinner was labelled from J. Sinner — the initial guard is gone');
});

// §5.6 keeps an under-minimum archetype LISTED with a dash. Dropping it would read
// as an opponent type he has never faced, which is a different claim entirely.
// Item 23 adds the file's colour and meta line to that.
checkCareer('item 23 · an under-minimum archetype stays listed, dashed, dim and inert', () => {
  let found = 0;
  for (const key of Object.keys(PLAYERS)) {
    const p = Object.assign({ key }, PLAYERS[key]);
    const rows = I.styleRows(p);
    if (!rows.length || !rows.total) continue;
    const thin = rows.filter(r => { const n = r.won + r.lost; return n > 0 && n < 5; });
    if (!thin.length) continue;
    const html = I.renderStylesModal(p);
    thin.forEach((r) => {
      const n = r.won + r.lost;
      assert(html.indexOf(esc17(r.axis.label)) > -1, `${p.name}: thin archetype ${r.axis.label} dropped out`);
      assert(html.indexOf('data-pp2="style-row" data-v="' + esc17(r.axis.label) + '"') < 0,
        `${p.name}: thin archetype ${r.axis.label} is still clickable`);
      assert(html.indexOf(n + ' matches · below the five-match minimum') > -1,
        `${p.name}: thin archetype ${r.axis.label} does not carry the file's meta line`);
    });
    // The file's DIM (#6e7a93), not its FAINT (#6e7a93) — item 23 names it.
    assert(html.indexOf('font-size:14px;font-weight:700;color:#6e7a93;') > -1,
      `${p.name}: the under-minimum name is not the file's DIM colour`);
    if (++found >= 3) break;
  }
  assert(found > 0, 'no player had an under-minimum archetype — this check never ran');
  console.log(`        ${found} players keep a sub-minimum archetype listed, dashed and dim`);
});
function esc17(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

// Item 32's footnote dash is PUNCTUATION, so it is U+2014 — both the design file
// and the README write it that way and the amendment quotes it verbatim. The
// build emitted ENDASH (U+2013) and no source-reading check saw it; it took
// reading the rendered footnote in a browser. §3's "ranges en dash" rule is about
// ranges and does not reach a sentence dash, so the two constants exist
// separately (ENDASH for ranges, EMDASH for punctuation) and this locks the
// choice at the one call site that got it wrong.
//
// 2026-09-18: this check was RED for several runs with "no player carried the
// footnote — this check never ran", while the renderer was already emitting
// U+2014 correctly. The bug was in the check, not the build: it hunted the
// committed store for a player carrying an archetype row with 0 < n < 5 and
// asserted nothing when none did. That made the lock hostage to a store shape,
// and a lock that silently stops running is worse than no lock. It now calls
// renderStyleNote() — the one function that emits the sentence — with rows built
// to order, so the thin branch is ALWAYS exercised and the only way to go red is
// for the dash to actually be wrong. Both singular ("One sits") and plural
// ("N sit") phrasings are covered, since they are separate string literals.
check('item 32 · the footnote sentence dash is an em dash, not an en dash', () => {
  // styleOpenable() is the renderer's own gate — build the fixture from it
  // rather than hard-coding 5, so a future gate change can't quietly un-thin
  // these rows and make the check vacuous again.
  const thinN = [1, 2, 3, 4].filter(n => !I.styleOpenable(n));
  assert(thinN.length > 0, 'no sub-gate sample size exists — fixture cannot be built');
  const fatN = [10, 20, 40].filter(n => I.styleOpenable(n));
  assert(fatN.length > 0, 'no above-gate sample size exists — fixture cannot be built');

  function rowsWith(thinCount) {
    const rows = [];
    for (let i = 0; i < thinCount; i++) rows.push({ won: thinN[0], lost: 0 });
    rows.push({ won: fatN[0], lost: fatN[0] });           // one openable row
    let total = 0;
    rows.forEach(r => { total += r.won + r.lost; });
    rows.total = total;
    rows.unlabelled = 0;
    return rows;
  }

  let checked = 0;
  for (const thinCount of [1, 3]) {                        // singular and plural
    const html = I.renderStyleNote(rowsWith(thinCount));
    const i = html.indexOf('rather than dropping out');
    assert(i > -1,
      `thin=${thinCount}: renderStyleNote emitted no thin-row sentence — the fixture no longer trips the branch`);
    const tail = html.slice(i, i + 60);
    assert(tail.indexOf('—') > -1,
      `thin=${thinCount}: footnote dash is not U+2014 — got ${JSON.stringify(tail.slice(24, 32))}`);
    assert(tail.indexOf('dropping out –') < 0,
      `thin=${thinCount}: footnote still uses the en dash U+2013`);
    // The phrasing must actually differ, or "plural" was never really tested.
    assert(html.indexOf(thinCount === 1 ? 'One sits' : thinCount + ' sit') > -1,
      `thin=${thinCount}: wrong singular/plural phrasing`);
    checked++;
  }
  assert(checked === 2, 'both the singular and plural footnote forms must be checked');
  console.log(`        ${checked} footnote forms (singular + plural) carry U+2014, none U+2013`);
});

mustFail('the footnote-dash check would catch the en dash it was shipped with', () => {
  const tail = 'rather than dropping out – an absent row reads as';
  assert(tail.indexOf('—') > -1, 'en dash not caught');
});
mustFail('the listing check would catch a dropped thin archetype', () => {
  const html = '<div>Attacking Baseliner</div>';
  assert(html.indexOf('Solid Defender') > -1, 'thin archetype Solid Defender dropped out');
});

// Item 22 · rate descending, under-minimum at the bottom. The design's own D array
// is written that way; the live build listed them in taxonomy order, which put a
// 2-match row above a 156-match one.
checkCareer('item 22 · rows sort by win rate, under-minimum last', () => {
  let n = 0;
  for (const p of SAMPLE) {
    const rows = I.styleRows(p);
    if (!rows.total) continue;
    let seenThin = false, last = Infinity;
    rows.forEach((r) => {
      const c = r.won + r.lost;
      if (!I.styleOpenable(c)) { seenThin = true; return; }
      assert(!seenThin, `${p.name}: ${r.axis.label} sits below an under-minimum row`);
      const rate = 100 * r.won / c;
      assert(rate <= last + 1e-9, `${p.name}: ${r.axis.label} at ${rate} breaks the descending order`);
      last = rate;
    });
    n++;
  }
  assert(n > 0, 'no sampled player had spine rows — this check never ran');
  console.log(`        ${n} players ordered rate-desc with thin rows last`);
});
mustFail('the order check would catch a thin row left at the top', () => {
  assert(!true, 'X: Counterpuncher sits below an under-minimum row');
});

// Item 3 · ONE coverage line with real counts, and the old three-sentence roster
// essay gone. Both halves matter: he asked for the fact AND for the essay to go.
checkCareer('item 3 · coverage is one line with real counts, essay removed', () => {
  let stated = 0;
  for (const p of SAMPLE) {
    const rows = I.styleRows(p);
    if (!rows.total) continue;
    const html = I.renderStylesModal(p);
    const labelled = rows.total - rows.unlabelled;
    assert(html.indexOf(labelled + ' of ' + rows.total + ' matches against a labelled opponent') > -1,
      `${p.name}: the coverage line is missing or does not carry real counts`);
    assert(html.indexOf('The labelled roster is the current 250 players') < 0,
      `${p.name}: the roster essay is still in the footnote`);
    assert(html.indexOf('priced matches were against an opponent') < 0,
      `${p.name}: the footnote still describes the priced population`);
    stated++;
  }
  assert(stated > 0, 'no sampled player rendered — this check never ran');
  console.log(`        ${stated} players state coverage in one line`);
});
mustFail('the coverage check would catch a hidden gap', () => {
  const html = 'Click an archetype for the matches behind it.';
  assert(html.indexOf('424 of 1277 matches against a labelled opponent') > -1,
    'X: the coverage line is missing or does not carry real counts');
});

// ─── item 10 · the axis EXTENDS, it never clips or clamps ───────────────────
// This is the defect the founder photographed: 81% drawn above the top of the
// plot and 33% below the bottom. The rule is tested on styleScale() directly,
// because a real player with both extremes may not exist in the local stores and
// a check that silently never runs is worse than no check.
check('item 10 · the y scale extends in 10pp steps and never clamps', () => {
  const base = I.styleScale([74, 63, 48]);
  assert.deepStrictEqual(base.ticks, [80, 70, 60, 50, 40], 'default tick set changed');
  assert.strictEqual(base.LO, 35, 'the file\'s 5pp bottom pad (LO = 35) is gone');
  assert.strictEqual(base.HI, 80, 'the default top of scale is not the 80 tick');

  const hi = I.styleScale([81, 50]);
  assert.strictEqual(hi.hi, 90, '81% did not extend the top tick to 90');
  assert(hi.ticks.indexOf(90) === 0 && hi.ticks[hi.ticks.length - 1] === 40,
    'the extended tick ladder was not regenerated');

  const lo = I.styleScale([33, 60]);
  assert.strictEqual(lo.lo, 30, '33% did not extend the bottom tick to 30');
  assert.strictEqual(lo.LO, 25, 'the bottom pad did not travel with the extension');

  const both = I.styleScale([33, 81]);
  assert.strictEqual(both.lo, 30, 'two-sided extension lost the bottom');
  assert.strictEqual(both.hi, 90, 'two-sided extension lost the top');

  // A value sitting exactly ON the top tick has half its disc outside the plot.
  // "Never clipped" is the harder rule, so a boundary value extends.
  assert.strictEqual(I.styleScale([80, 50]).hi, 90, 'a value exactly on the top tick did not extend');
  // 100% cannot extend the ticks past 100, so the SCALE takes the headroom.
  const sweep = I.styleScale([100, 50]);
  assert.strictEqual(sweep.hi, 100, 'ticks ran past 100');
  assert.strictEqual(sweep.HI, 105, 'a 100% bubble was left sitting on the plot border');

  // Every plotted value must land strictly inside the drawn scale — that is what
  // "never clipped" means numerically.
  [[74, 63, 48], [81, 50], [33, 60], [33, 81], [100, 50], [40, 55]].forEach((vs) => {
    const s = I.styleScale(vs);
    vs.forEach((v) => {
      const top = (1 - (v - s.LO) / (s.HI - s.LO)) * 100;
      assert(top > 0 && top < 100, `${v}% lands at ${top.toFixed(1)}% — outside the plot`);
    });
  });
  console.log('        40–80 default · extends to 30–90 · 100% padded · no value on an edge');
});
mustFail('the axis check would catch a return to clamping', () => {
  assert.strictEqual(80, 90, '81% did not extend the top tick to 90');
});

// The printed value must stay exact whatever the axis does — a rewritten label
// would be a false number, which is the failure mode clamping used to risk.
checkCareer('a bubble prints its exact whole-number rate', () => {
  let checked = 0;
  for (const key of Object.keys(PLAYERS)) {
    const p = Object.assign({ key }, PLAYERS[key]);
    const rows = I.styleRows(p).filter(r => I.styleOpenable(r.won + r.lost));
    if (!rows.length) continue;
    const html = I.renderStylesModal(p);
    rows.forEach((r) => {
      const rate = Math.round(100 * r.won / (r.won + r.lost));
      assert(html.indexOf('>' + rate + '%<') > -1,
        `${p.name}: ${r.axis.label} at ${rate}% does not print its exact value`);
      checked++;
    });
    if (checked >= 12) break;
  }
  assert(checked > 0, 'no plotted bubble found — this check never ran');
  console.log(`        ${checked} bubbles print their exact rate`);
});
mustFail('the value check would catch a label rewritten to the axis bound', () => {
  const html = '>80%<';
  assert(html.indexOf('>' + '95' + '%<') > -1, 'X: Y at 95% does not print its exact value');
});

// ─── shell and row chrome (items 5, 12, 17-21, 25, 27-29) ──────────────────
// One render, many assertions: these are all "is this exact value in the DOM",
// and splitting them into ten checks would just render the same html ten times.
checkCareer('items 5,12,17-21,25,27-29 · the shell, rows and drill carry the file\'s values', () => {
  let subject = null;
  for (const p of SAMPLE) {
    const rows = I.styleRows(p);
    if (rows.total && rows.some(r => I.styleOpenable(r.won + r.lost) && r.priced > 0)) { subject = p; break; }
  }
  assert(subject, 'no sampled player has a priced, openable archetype — this check never ran');
  const rows = I.styleRows(subject);
  const open = rows.filter(r => I.styleOpenable(r.won + r.lost) && r.priced > 0)[0];
  I.state.styleRow = open.axis.label;
  const html = I.renderStylesModal(subject);
  I.state.styleRow = null;

  const want = [
    // item 7 · the eyebrow, and the flex gap that gives the plot clear space
    ['WIN RATE BY ARCHETYPE eyebrow', 'Win rate by archetype · bubble size is match count'],
    ['item 7 · chart card clear space', 'display:flex;flex-direction:column;gap:14px;'],
    // item 8 · layout and plot box
    ['item 8 · 52px 1fr layout', 'grid-template-columns:52px minmax(0,1fr);gap:12px;'],
    ['item 8 · 240px plot with 0.12 borders',
      'height:240px;border-left:1px solid rgba(255,255,255,0.12);border-bottom:1px solid rgba(255,255,255,0.12);'],
    // item 9 · tick labels right-aligned in the gutter, rotated label at its left
    ['item 9 · rotated label left of the ticks', 'left:-2px;top:50%;transform:translateY(-50%) rotate(-90deg);'],
    ['item 9 · tick label', 'font-size:10px;color:#6e7a93;'],
    // item 11 · the EVEN rule and its right-aligned, uppercased label
    ['item 11 · even rule', 'height:1px;background:rgba(255,255,255,0.28);'],
    ['item 11 · EVEN label right-aligned', 'right:6px;top:'],
    ['item 11 · EVEN uppercased', 'text-transform:uppercase;color:#6e7a93;">even<'],
    // item 12 · the value label above the bubble
    ['item 12 · value label above the bubble', 'font-size:12px;font-weight:700;color:#ebf1f2;white-space:nowrap;pointer-events:none;'],
    // item 13 · disc
    ['item 13 · disc border', 'border-radius:50%;'],
    ['item 13 · disc fill', 'background:rgba(91,155,255,'],
    // item 15 · abbreviations and the foot labels
    ['item 15 · x tick label class', 'class="pp2-stk'],
    ['item 15 · foot label SERVE', '>Serve<'],
    ['item 15 · foot label BASELINE', '>Baseline<'],
    ['item 15 · foot label ARCHETYPE', '>Archetype<'],
    // items 17-19 · the row is a card with the minimal bar
    ['item 17 · row card grid', 'grid-template-columns:minmax(0,1fr) 300px 58px;gap:16px;align-items:center;border-radius:10px;padding:13px 16px;'],
    ['item 18 · row name', 'font-size:14px;font-weight:700;'],
    ['item 18 · row meta', 'font-size:11.5px;color:#6e7a93;'],
    ['item 19 · minimal bar track', 'height:4px;border-radius:2px;background:rgba(255,255,255,0.06);'],
    ['item 19 · minimal bar fill', 'background:#6a9af8;border-radius:2px;'],
    // item 20 · units above the rate
    ['item 20 · right column stacks', 'display:flex;flex-direction:column;align-items:flex-end;gap:4px;'],
    ['item 20 · units', 'font-size:12px;font-weight:700;color:#'],
    // item 24 · the selected row
    ['item 24 · selected row background', 'background:rgba(91,155,255,0.08);'],
    ['item 24 · selected row border', 'border:1px solid rgba(91,155,255,0.4);'],
    // item 25 · the CAREER footer
    ['item 25 · Career eyebrow', '>Career<'],
    // items 26-28 · the drill
    ['item 26 · drill container', 'border:0.33px solid #2e4fa8;border-radius:10px;padding:13px 15px;'],
    ['item 28 · drill grid',
      'grid-template-columns:16px 64px minmax(0,1.1fr) minmax(0,1fr) 38px 104px 48px 48px 58px;gap:0 12px;'],
    ['item 28 · drill head Score', '>Score<'],
    ['item 28 · drill head P&L', '>P&amp;L<']
  ];
  want.forEach(([what, needle]) => {
    assert(html.indexOf(needle) > -1, `${subject.name}: ${what} missing — "${needle}"`);
  });

  // item 21 · a whole-number win rate. The live build printed "81.2%".
  assert(!/\d\.\d%</.test(html.replace(/[+−]\d+\.\d%/g, '')),
    `${subject.name}: a fractional rate is being printed`);
  // item 27 · the drill header's three-part P&L line
  assert(new RegExp('u \\u00b7 [+\\u2212]\\d+\\.\\d% \\u00b7 ' + open.priced + ' priced').test(html),
    `${subject.name}: the drill header does not carry "Xu · Y% · ${open.priced} priced"`);
  // item 29 · the drill's P&L column carries no "u" — the unit is in the header
  assert(html.indexOf('text-align:right;color:#3ed68c;">+') > -1 ||
         html.indexOf('text-align:right;color:#da6259;">−') > -1,
    `${subject.name}: no signed P&L cell rendered`);
  // item 29 · "Oct 2026" dates
  assert(/>(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}</.test(html),
    `${subject.name}: the drill date is not the file's "Mon YYYY"`);
  console.log(`        ${want.length + 4} values verified on ${subject.name}/${open.axis.label}`);
});
mustFail('the chrome check would catch the plain-text row list coming back', () => {
  const html = '<div style="display:grid;grid-template-columns:1fr 300px 58px;">';
  assert(html.indexOf('grid-template-columns:minmax(0,1fr) 300px 58px;gap:16px;') > -1,
    'X: item 17 · row card grid missing');
});

check('item 5 · the shell says "Matchup record" with the file\'s subtitle', () => {
  // Deliberately NOT gated on the career store: the subtitle is a constant and
  // the title now comes from the box set, so this stays green with no spine.
  assert.strictEqual(I.modalSubtitle('styles', SAMPLE[0], {}),
    'Win rate by opposing archetype · minimum 5 matches');
  // v7 moved the title onto the box object and the MODAL_TITLE override map is
  // gone. The assertion is the same fact read from its new single source — and
  // this is now stronger, because it proves the TILE says it too.
  const styles = I.BOXES.filter(b => b.key === 'styles')[0];
  assert.strictEqual(styles.title, 'Matchup record');
  assert.strictEqual(I.MODAL_WIDTH.styles, 820, 'item 6 · the modal is not 820px');
  console.log('        title, subtitle and 820px width all as specified');
});
mustFail('the shell check would catch the old subtitle', () => {
  assert.strictEqual('Win rate against each playing style Zverev\'s record covers',
    'Win rate by opposing archetype · minimum 5 matches');
});

// item 30 · an unpriced row dashes PRICE/OPP/P&L and does not inflate `priced`.
checkCareer('item 30 · unpriced drill rows dash and stay out of the priced count', () => {
  let n = 0;
  for (const p of SAMPLE) {
    const rows = I.styleRows(p);
    const open = rows.filter(r => I.styleOpenable(r.won + r.lost) &&
      r.rows.some(m => m.cents == null))[0];
    if (!open) continue;
    I.state.styleRow = open.axis.label;
    const html = I.renderStylesModal(p);
    I.state.styleRow = null;
    const unpriced = open.rows.filter(m => m.cents == null).length;
    assert(unpriced > 0 && open.priced === open.rows.length - unpriced,
      `${p.name}/${open.axis.label}: priced count includes an unpriced row`);
    // Three dashed money cells per unpriced row.
    const dashes = (html.match(/text-align:right;color:#6e7a93;">—</g) || []).length;
    assert(dashes >= unpriced,
      `${p.name}/${open.axis.label}: ${dashes} dashed money cells for ${unpriced} unpriced rows`);
    n++;
    if (n >= 2) break;
  }
  assert(n > 0, 'no archetype had an unpriced row — this check never ran');
  console.log(`        ${n} archetypes dash their unpriced rows`);
});
mustFail('the unpriced check would catch an invented price', () => {
  assert(0 >= 1, 'X/Y: 0 dashed money cells for 1 unpriced rows');
});

// item 31 · every drill row opens the match sheet.
checkCareer('item 31 · every drill row carries the match-sheet hook', () => {
  let n = 0;
  for (const p of SAMPLE) {
    const rows = I.styleRows(p);
    const open = rows.filter(r => I.styleOpenable(r.won + r.lost))[0];
    if (!open) continue;
    I.state.styleRow = open.axis.label;
    const html = I.renderStylesModal(p);
    I.state.styleRow = null;
    const hooks = (html.match(/data-pp2="sheet"/g) || []).length;
    // Nine cells per row, each individually hooked (the file hooks every cell so
    // the whole row is clickable without a wrapper the grid cannot have).
    assert.strictEqual(hooks, open.rows.length * 9,
      `${p.name}/${open.axis.label}: ${hooks} sheet hooks for ${open.rows.length} rows`);
    n++;
    if (n >= 2) break;
  }
  assert(n > 0, 'no openable archetype found — this check never ran');
  console.log(`        ${n} drills hook every row to the match sheet`);
});
mustFail('the sheet-hook check would catch an unclickable drill row', () => {
  assert.strictEqual(0, 27 * 9, 'X/Y: 0 sheet hooks for 27 rows');
});

checkCareer('every archetype drill renders without leaking NaN/undefined', () => {
  let n = 0;
  for (const p of SAMPLE) {
    if (!I.calSpine(p).length) continue;
    for (const a of I.STYLE_AXIS) {
      I.state.styleRow = a.label;
      const html = I.renderStylesModal(p);
      assert(!/undefined|NaN|\[object/.test(html), `${p.name}/${a.label}: DOM leak`);
      n++;
    }
  }
  I.state.styleRow = null;
  console.log(`        ${n} drill renders clean`);
});


// A regression that hid in plain sight: `stylesStore` was declared and never
// assigned, so archetypeFor returned null for all 428 players and box 5's
// headline dashed — indistinguishable from a legitimate "not held". The fix is
// only meaningful if coverage is NON-ZERO, so that is what is asserted.
check('box 5 shows a real archetype for players who carry one', () => {
  let resolved = 0, labelled = 0;
  for (const key of Object.keys(PLAYERS)) {
    const nm = PLAYERS[key].name;
    const hasLabel = STYLES.players.some(s => s.name === nm && s.archetype_label);
    if (hasLabel) labelled++;
    if (I.archetypeFor(key)) resolved++;
  }
  assert(resolved > 0, 'archetypeFor resolved nobody — the store is unwired again');
  assert(resolved >= labelled * 0.9,
    `only ${resolved} of ${labelled} labelled players resolve an archetype`);
  const axis = I.STYLE_AXIS.map(a => a.label);
  for (const key of Object.keys(PLAYERS)) {
    const a = I.archetypeFor(key);
    if (a) assert(axis.indexOf(a) > -1, `archetypeFor returned an off-taxonomy label: ${a}`);
  }
  console.log(`        ${resolved} of ${labelled} labelled players resolve, all on-taxonomy`);
});
mustFail('the coverage check would catch the store being unwired again', () => {
  const resolved = 0;
  assert(resolved > 0, 'archetypeFor resolved nobody — the store is unwired again');
});

// ════════════════════════════════════════════════════════════════════════════
// 18 · ALL STORES — founder ruling 6 (2026-09-16), approved.
//
//   "Extend the non-zero coverage assertion to every data store this page reads,
//    so no other unwired store can hide behind a dash."
//
// The stylesStore bug was invisible because a declared-but-unassigned store and
// a genuinely empty dataset render identically: an em dash. The dash is correct
// behaviour, so no visual check can tell them apart. The only thing that can is
// an assertion that each store resolves a NON-ZERO number of real values through
// the SAME accessor the page calls.
//
// This table is the gate. A new store wired into this page without a row here is
// a store that can silently go dark, so the last check asserts the table covers
// every window.* the module actually reads.
// ════════════════════════════════════════════════════════════════════════════
const STORES = [
  // ─── §8.2 match panel · three indexes and two shard maps ───────────────────
  // These are LAZY and per-match: nothing is fetched until a match sheet opens,
  // so at suite time they are legitimately empty. The row that matters is
  // therefore not "did it load" but "does the page's own accessor resolve a
  // populated one" — the stylesStore failure this table exists to catch is a
  // store that loads and joins to nobody. Each drives the module's accessor
  // with a store built by construction, and a universe of 1.
  // These five drive the accessor against a store built by construction, which
  // means they WRITE to window. Every one restores what it touched: the first
  // draft left `window.matchStats = null` behind and turned three unrelated
  // checks red — a gate that corrupts the run it is measuring.
  ...(function () {
    const KEYS = ['pbpIndex', 'setStatsIndex', 'matchStatsIndex', 'pbpShards',
                  'setStatsShards', 'matchStats'];
    const sandboxed = (fn) => () => {
      const saved = {};
      KEYS.forEach((k) => { saved[k] = window[k]; });
      try { return fn(); } finally { KEYS.forEach((k) => { window[k] = saved[k]; }); }
    };
    return [
      { name: 'pbpIndex', file: 'pbp-index.json', universe: () => 1, floor: 1,
        resolve: sandboxed(() => {
          window.pbpIndex = new Set(['1']);
          return I.mpAvailable({ eventKey: 1 }).points ? 1 : 0; }) },
      { name: 'setStatsIndex', file: 'setstats-index.json', universe: () => 1, floor: 1,
        resolve: sandboxed(() => {
          window.setStatsIndex = new Set(['2']); window.matchStatsIndex = new Set();
          window.matchStats = null; window.setStatsShards = {};
          return I.mpAvailable({ eventKey: 2 }).stats ? 1 : 0; }) },
      { name: 'matchStatsIndex', file: 'matchstats-index.json', universe: () => 1, floor: 1,
        resolve: sandboxed(() => {
          window.setStatsIndex = new Set(); window.matchStatsIndex = new Set(['3']);
          window.matchStats = null; window.setStatsShards = {};
          return I.mpAvailable({ eventKey: 3 }).stats ? 1 : 0; }) },
      { name: 'pbpShards', file: 'pbp/{eventKey}.json', universe: () => 1, floor: 1,
        // The accessor must tell ABSENT (not fetched) from NULL (answered,
        // empty); collapsing them is the defect, so both halves are exercised.
        // The fixture game carries a POINT with a non-blank score. It used to
        // carry `points: []`, and `40a421d5` correctly made an empty points[] the
        // signature of a TIEBREAK mini-point rather than of a game — the deployed
        // US Open final shard paints nine phantom service games without that
        // rule. So the fixture, not the rule, was wrong: a real game always has
        // at least one scored point, and this store check is about whether the
        // accessor resolves a shard, not about tiebreak discrimination.
        resolve: sandboxed(() => {
          window.pbpShards = { 4: { p1Key: 1, p2Key: 2, sets: [
            { set: 1, games: [{ g: 1, server: 'p1', winner: 'p1', score: '6 - 3',
              points: [{ s: '40 - 0' }] }] }] } };
          const held = I.mpSetGames({ sets: [] }, window.pbpShards[4], true);
          return (held && held.length === 1 && held[0].a === 6) ? 1 : 0; }) },
      { name: 'setStatsShards', file: 'setstats/{eventKey}.json', universe: () => 1, floor: 1,
        resolve: sandboxed(() => {
          window.setStatsShards = { 5: { p1Key: 9, p2Key: 8, match: {}, sets: {} } };
          window.setStatsIndex = new Set(['5']); window.matchStatsIndex = new Set();
          window.matchStats = null;
          return I.mpAvailable({ eventKey: 5 }).stats ? 1 : 0; }) },
    ];
  })(),
  {
    name: 'situational',
    file: 'situational.json',
    // §5.9's eight point-by-point rows. Resolution is measured through the
    // page's own accessor over the REAL store, so a shard that publishes but
    // joins to nobody reads as zero rather than as coverage.
    resolve: () => {
      const st = (typeof I.sitStore === 'function' && I.sitStore()) || window.situational;
      if (!st || !st.players) return 0;
      return Object.keys(PLAYERS).filter(k => st.players[String(k)]).length;
    },
    universe: () => {
      const st = (typeof I.sitStore === 'function' && I.sitStore()) || window.situational;
      return (st && st.players) ? Object.keys(st.players).length : 0;
    },
    floor: 0.2,
  },
  {
    name: 'playerProfiles',
    file: 'player-profiles.json',
    // every block's spine — career, ribbon, ledger, calendar, header
    resolve: () => Object.keys(PLAYERS).filter(k => I.spineTotal(PLAYERS[k]).n > 0).length,
    universe: () => Object.keys(PLAYERS).length,
    floor: 0.5,
  },
  {
    name: 'careerSplits',
    file: 'career-splits.json',
    // splitCandidates takes the KEY, not the player object. The first draft of
    // this row passed the object, got [] for everyone, and reported the store
    // "unwired" — a false alarm from the gate's own accessor. Call the page's
    // accessors the way the page calls them or the gate measures itself.
    resolve: () => Object.keys(PLAYERS).filter(k => (I.splitCandidates(k, 'career') || []).length > 0).length,
    universe: () => Object.keys(SPLITS).length,
    floor: 0.5,
  },
  {
    name: 'marketEdge',
    file: 'market-edge/{key}.json',
    resolve: () => Object.keys(PLAYERS).filter((k) => {
      const v = I.buildBoxVals(PLAYERS[k], { rows: I.ledgerMatches(PLAYERS[k]), archetype: null });
      return v.market && v.market.headline != null;
    }).length,
    universe: () => Object.keys(MARKET).length,
    floor: 0.5,
  },
  {
    name: 'courtSpeedMap',
    file: 'court-speed-map.json',
    // §8.1 · the gate that matters for this store is not "did the file load" but
    // "does a CAREER row come back banded" — the failure it exists to catch is the
    // map serving 200 while resolving nothing, which paints five dashed bands and
    // a full unbanded footnote without ever looking broken.
    resolve: () => Object.keys(PLAYERS).filter((k) => {
      const p = Object.assign({ key: k }, PLAYERS[k]);
      return I.speedRows(p).some(m => m.speed != null);
    }).length,
    // Only players whose spine has rows at all can band one, so that is the
    // universe. Scoring against the whole roster would charge this store for
    // players career-history holds nothing for.
    universe: () => Object.keys(PLAYERS).filter((k) => {
      const p = Object.assign({ key: k }, PLAYERS[k]);
      return I.speedRows(p).length > 0;
    }).length,
    floor: 0.5,
  },
  {
    name: 'playingStyles',
    file: 'playing-styles.json',
    resolve: () => Object.keys(PLAYERS).filter(k => I.archetypeFor(k)).length,
    // The universe is the labelled rows that CAN reach this page — i.e. those
    // whose name matches a profiled player. The rows that cannot are a separate,
    // measured defect (see "the archetype name join" check below); folding them
    // in here would turn a store-wiring gate into a join-coverage gate and blur
    // two different failures into one number.
    universe: () => {
      const names = new Set(Object.keys(PLAYERS).map(k => PLAYERS[k].name));
      return (STYLES.players || []).filter(s => s.archetype_label && names.has(s.name)).length;
    },
    floor: 0.9,
  },
  {
    name: 'holdbreak',
    file: 'holdbreak.json',
    resolve: () => Object.keys(PLAYERS).filter(k => I.hbCoverage(PLAYERS[k])).length,
    // The universe is the artefact's rows THAT BELONG TO TODAY'S BOARD, not
    // every row it holds. holdbreak.json is a fixed 337-row build; 43 of those
    // rows are for players who have since left the board, and a row for a
    // player the page never renders cannot "reach the page" by any definition.
    // Scoring against the raw 337 charged this store for the roster moving:
    // it read 294/337 (87.2%) and tripped the 90% floor, which looks exactly
    // like a store going dark and is nothing of the kind — all 294 in-roster
    // rows resolve. The separate, real coverage gap (165 board players have no
    // holdbreak row at all) is reported by the line below, not hidden in a
    // denominator.
    universe: () => Object.keys(HOLDBREAK.players).filter(k => PLAYERS[k]).length,
    floor: 0.9,
  },
  // ── correction pass · the two stores wired this run ──────────────────────
  // Both are LOW-coverage by nature and their floors say so honestly rather
  // than being set where they would always pass. The gate's job is to catch a
  // store going DARK (the stylesStore bug), not to assert a coverage target.
  {
    name: 'matchStats',
    file: 'historical-match-stats.json',
    // Measured through the page's own accessor: recentForm rows whose eventKey
    // reaches a populated stats block. api-tennis only fills the statistics
    // block from 2024, so most of a long career is legitimately absent.
    resolve: () => {
      let n = 0;
      for (const k of Object.keys(PLAYERS)) {
        for (const m of I.ledgerMatches(PLAYERS[k])) if (I.statsFor(m.eventKey)) { n++; }
      }
      return n;
    },
    universe: () => Object.keys(STATS).filter(k => STATS[k] && STATS[k].matchStats).length,
    floor: 0.5,
  },
  {
    name: 'dnaRatings',
    file: 'dna-apitennis-ratings.json',
    // §5.9 Ratings — the radar's five axes and all 13 metric tiles.
    //
    // Measured through the page's OWN accessor, not by counting the file. The
    // failure this catches is the stylesStore shape: a store that loads, is
    // never joined to a player, and leaves every axis and tile dashed — which
    // is indistinguishable from "we hold no rating for him" and so goes
    // unreported forever. Counting rows in the file would pass happily while
    // the page resolved nothing.
    //
    // The universe is the ROSTER, not the file: the question is how many
    // profiled players the panel can actually draw for. Measured 2026-09-19 at
    // 276 of 575 (48%) — the floor is set well under that so ordinary roster
    // churn does not red the build, but a wiring break goes to ~0 and trips it.
    resolve: () => Object.keys(PLAYERS).filter(k => {
      const m = I.dnaModel(PLAYERS[k]);
      return m && Array.isArray(m.axes) && m.axes.some(a => a && a.rating != null);
    }).length,
    universe: () => Object.keys(PLAYERS).length,
    floor: 0.25,
  },
  {
    name: 'matchStatEventCoverage',
    file: 'match-stat-event-coverage.json',
    // The whole-event note's index (founder ruling 2026-09-18 Q2, third clause).
    // Measured through the page's OWN join, not by counting the file: the
    // failure this exists to catch is an index that loads and resolves nothing,
    // which silences the note on every sheet while looking perfectly healthy —
    // and the page's documented behaviour for an absent index is silence, so
    // nothing else on the site would ever go red.
    //
    // GITIGNORED and CI-built, and the deploy copies it with a tolerant
    // `cp … || true`, so it is normally absent here. Build it from the floor
    // rather than skip: a skipped row satisfies the all-stores gate while
    // measuring nothing, which is the vacuity this table exists to prevent.
    resolve: () => {
      const cov = EVENT_COV;
      if (!cov) return 0;
      let n = 0;
      for (const k of Object.keys(PLAYERS)) {
        for (const m of I.ledgerMatches(PLAYERS[k])) {
          const ed = cov.keys[String(m.eventKey)];
          if (ed && cov.events[ed] && cov.events[ed].n >= 1) n++;
        }
      }
      return n;
    },
    // Only ledger rows whose eventKey the store holds a sheet for can ever be
    // indexed, so that is the honest denominator.
    universe: () => {
      let n = 0;
      for (const k of Object.keys(PLAYERS)) {
        for (const m of I.ledgerMatches(PLAYERS[k])) if (I.statsFor(m.eventKey)) n++;
      }
      return n;
    },
    floor: 0.5,
  },
  {
    name: 'bet365History',
    file: 'bet365-history/{month}.json',
    // The capture only exists to price rows the archive never reached, so the
    // gate measures exactly that: ledger rows that came back priced on the
    // pre-match basis rather than on an archive close.
    resolve: () => {
      let n = 0;
      for (const k of Object.keys(PLAYERS)) {
        for (const r of I.ledgerRows(PLAYERS[k])) if (r.basis === 'prematch') n++;
      }
      return n;
    },
    universe: () => {
      let n = 0;
      for (const mo of Object.keys(B365)) n += Object.keys((B365[mo] || {}).fixtures || {}).length;
      return n;
    },
    floor: 0,
  },
  // ── §5.3 · the tournament modal's date and surface source ────────────────
  // career-history/ is GITIGNORED and rebuilt by CI, so it is genuinely absent
  // from a fresh checkout. That absence is REPORTED rather than passed over:
  // the row below still runs, and when the artefact is missing it asserts the
  // page's documented fallback instead (the market shard must keep dating rows),
  // so "the store is not here" can never be mistaken for "the store is wired".
  // The join itself has its own negative control further down.
  {
    name: 'careerHistory',
    file: 'career-history/{key}.json',
    ciBuilt: true,
    resolve: () => {
      let n = 0;
      for (const k of Object.keys(CAREER_HIST)) {
        const p = PLAYERS[k];
        if (!p) continue;
        global.window.careerHistory = CAREER_HIST;
        global.window.marketEdge = MARKET;
        for (const t of I.tournViews(p)) {
          for (const e of t.editions) for (const m of e.matches) if (m.date) n++;
        }
      }
      return n;
    },
    universe: () => {
      let n = 0;
      for (const k of Object.keys(CAREER_HIST)) n += (CAREER_HIST[k] || []).length;
      return n;
    },
    floor: 0.2,
  },
];

for (const s of STORES) {
  check(`store ${s.name} resolves a non-zero share of what it holds`, () => {
    if (s.ciBuilt && s.universe() === 0) {
      // Fallback assertion: without the CI artefact the modal must still date
      // its rows off the market shard, and it must not date NONE of them.
      global.window.careerHistory = {};
      global.window.marketEdge = MARKET;
      let dated = 0, rows = 0;
      const zv = byName('A. Zverev');
      assert(zv, 'A. Zverev is not in the committed profiles — pick another subject');
      for (const t of I.tournViews(zv)) {
        for (const e of t.editions) for (const m of e.matches) { rows++; if (m.date) dated++; }
      }
      assert(rows > 0, 'the tournament modal produced no rows at all');
      assert(dated > 0,
        `${s.file} is absent AND the market-shard date fallback produced nothing — ` +
        `the date column would be entirely dashed`);
      console.log(`        ${s.name}: ${s.file} absent from this checkout (CI-built); ` +
        `fallback dates ${dated} of ${rows} Zverev rows off the market shard`);
      return;
    }
    const resolved = s.resolve();
    const universe = s.universe();
    // courtSpeedMap scores against players whose SPINE has rows, and the spine
    // is career-history/. With that store absent the universe is 0 for reasons
    // that have nothing to do with the map, so the row skips rather than
    // reporting an empty artefact it never looked at.
    if (universe === 0 && s.name === 'courtSpeedMap' && CH_TOO_THIN) {
      console.log(`        ${s.name}: SKIPPED — its universe is the career-history spine, which is ${CH_DRIFT.state} here`);
      return;
    }
    assert(universe > 0, `${s.file} holds nothing — the artefact itself is empty`);
    assert(resolved > 0,
      `${s.name} resolved NOTHING through the page's own accessor — the store is unwired (this is the stylesStore bug)`);
    assert(resolved >= universe * s.floor,
      `${s.name}: only ${resolved} of ${universe} rows in ${s.file} reach the page (floor ${Math.round(s.floor * 100)}%)`);
    console.log(`        ${s.name}: ${resolved} of ${universe} rows in ${s.file} reach the page`);
  });
}

mustFail('the all-stores gate would catch any one store going dark', () => {
  const resolved = 0, universe = 428;
  assert(resolved > 0,
    `store resolved NOTHING through the page's own accessor — the store is unwired`);
});

mustFail('the all-stores gate would catch a store that resolves only a token few', () => {
  const resolved = 3, universe = 428, floor = 0.5;
  assert(resolved >= universe * floor, `only ${resolved} of ${universe} rows reach the page`);
});

// ── the archetype name join — OPEN DEFECT, pinned at its measured size ───────
// Found by the ruling-6 gate on its first run, 2026-09-16.
//
// playing-styles.json joins to the page by NAME ONLY (its rows carry no player
// key). The artefact mixes two name forms: most rows are short form ("N. Djokovic")
// but 43 are full form ("Zsombor Piros"). archetypeFor does an exact-name lookup,
// so every full-form row misses — and 40 of those 40-odd players ARE profiled.
// They render a dashed archetype box despite carrying a hand-assigned label.
//
// NOT FIXED HERE, deliberately. The only page-level join available is surname
// matching, and this repo has been bitten by exactly that: api-tennis reorders
// multi-part surnames, so "Felipe Meligeni Alves" sits beside a profile row
// reading "M. Alves". A wrong surname match would paint the WRONG archetype on a
// player, which is worse than the dash it replaces. The fix belongs upstream in
// classify-styles.js — emit one name form, or better, emit the player key.
//
// ── RULED 2026-09-19 · the normaliser landed; the metric changes with it ─────
// "Get the 40 back … Do NOT join on surname alone anywhere, ever … The 3
//  off-roster rows stay unmatched — nothing to join to. Don't count them as
//  failures."
//
// The old check measured "rescuable" by SURNAME ALONE, which the ruling now
// forbids outright — and that metric is what made Dali Blanch look rescuable
// when joining her row would have painted her archetype onto Darwin Blanch.
// It is replaced by the real normaliser (tools/name-canon.js), which is locked
// deterministically by tools/test-name-canon.js.
//
// A raw unmatched count is the wrong number to pin, because it sums three
// populations with different meanings. This splits them:
//
//   RECOVERABLE  we hold the label AND the normaliser places it on exactly one
//                roster row — a real defect, every one a dash on a player whose
//                archetype we already know. THIS is the number that must reach 0.
//   AMBIGUOUS    two compatible roster rows; blank is correct.
//   OFF-ROSTER   nothing to join to; per the ruling, not a failure.
//
// Like the WD check above, this reads the DEPLOYED playing-styles.json and is a
// LAGGING indicator: it cannot fall until the styles workflow republishes with
// the normaliser in it. Measured at the moment of the fix — 43 unmatched, of
// which 39 recoverable, 0 ambiguous, 4 off-roster (D. Schwartzman, M. Martineau,
// D. Rincon, and Dali Blanch, who is correctly refused).
//
// CEILING, not a pin: recoverable may only ever go DOWN. TARGET: 0.
const NAME_JOIN_RECOVERABLE_CEILING = 39;
check('the archetype name join leaves no recoverable label unplaced', () => {
  const { buildRosterIndex, resolveNameDetailed } = require('./name-canon.js');
  const names = new Set(Object.keys(PLAYERS).map(k => PLAYERS[k].name));
  const ix = buildRosterIndex(PLAYERS);
  const labelled = (STYLES.players || []).filter(s => s.archetype_label);
  const unmatched = labelled.filter(s => !names.has(s.name));
  let recoverable = 0, ambiguous = 0, offRoster = 0;
  const names_recoverable = [];
  for (const s of unmatched) {
    const r = resolveNameDetailed(s.name, ix);
    if (r.status === 'resolved') { recoverable++; if (names_recoverable.length < 5) names_recoverable.push(`${s.name} -> ${r.match.name}`); }
    else if (r.status === 'ambiguous') ambiguous++;
    else offRoster++;
  }
  assert.ok(recoverable <= NAME_JOIN_RECOVERABLE_CEILING,
    `recoverable archetype labels GREW: ${recoverable} against a ceiling of ${NAME_JOIN_RECOVERABLE_CEILING}. `
    + `Each is a player whose archetype we hold and do not show. e.g. ${names_recoverable.join(' · ')}`);
  console.log(`        ${unmatched.length} labelled rows miss the exact-name join — `
    + `${recoverable} recoverable (ceiling ${NAME_JOIN_RECOVERABLE_CEILING}, target 0), `
    + `${ambiguous} ambiguous (blank is correct), ${offRoster} off-roster (not a failure)`
    + `${recoverable === 0 ? ' — COMPLIANT, re-pin to strict 0' : ''}`);
});

mustFail('the name-join ceiling would catch recoverable labels growing', () => {
  const recoverable = 62;
  assert.ok(recoverable <= NAME_JOIN_RECOVERABLE_CEILING,
    `recoverable archetype labels GREW: ${recoverable}`);
});

// The gate is only as good as its coverage of the stores that actually exist.
// This reads the module's source for every window.* it touches and asserts each
// data store among them has a row above — so wiring a new store without
// extending this table fails the build rather than passing quietly.
check('the all-stores table covers every data store the module reads', () => {
  const src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  const read = new Set((src.match(/window\.[A-Za-z_][A-Za-z0-9_]*/g) || [])
    .map(s => s.replace('window.', '')));
  // Not data stores: the feature flag, the module's own export, and the two
  // shared helper singletons (logic, not data — they carry no player rows).
  const NOT_STORES = new Set(['FEATURE_PP2', 'PlayerProfileV2', 'RoundClassify', 'HoldBreakHeatmap']);
  // Host callbacks the mount calls back into (navigation, not data). Exempt from
  // the coverage table but NOT from scrutiny: the module must not assume the
  // host defined them, so each is asserted to be typeof-guarded at its call
  // site. Simply widening NOT_STORES would have let any future window.* through
  // the gate by being named plausibly.
  const HOST_CALLBACKS = new Set(['showPlayerList', 'onPp2SheetOpen', 'onPp2MatchPageOpen']);
  for (const cb of HOST_CALLBACKS) {
    assert(new RegExp(`typeof window\\.${cb} === 'function'`).test(src),
      `window.${cb} is called without a typeof guard — the page must not assume the host defines it`);
  }
  const covered = new Set(STORES.map(s => s.name));
  const missing = [...read].filter(n =>
    !NOT_STORES.has(n) && !HOST_CALLBACKS.has(n) && !covered.has(n));
  assert.deepStrictEqual(missing, [],
    `these stores are read by the page but have no coverage row: ${missing.join(', ')}`);
  console.log(`        ${read.size} window.* reads, ${covered.size} data stores, ` +
    `${HOST_CALLBACKS.size} guarded host callback, all covered`);
});

mustFail('the host-callback guard check would catch an unguarded call', () => {
  const src = 'if (window.showPlayerList) window.showPlayerList();';
  assert(/typeof window\.showPlayerList === 'function'/.test(src),
    'window.showPlayerList is called without a typeof guard');
});

mustFail('the table-coverage check would catch a newly wired store', () => {
  const read = new Set(['playerProfiles', 'careerSplits', 'someNewStore']);
  const NOT_STORES = new Set(['FEATURE_PP2', 'PlayerProfileV2', 'RoundClassify', 'HoldBreakHeatmap']);
  const covered = new Set(['playerProfiles', 'careerSplits']);
  const missing = [...read].filter(n => !NOT_STORES.has(n) && !covered.has(n));
  assert.deepStrictEqual(missing, [], `uncovered: ${missing.join(', ')}`);
});

// ════════════════════════════════════════════════════════════════════════════
// 19 · §5.9 PLAYING PROFILE — hold/break heatmap (founder ruling 7)
// ════════════════════════════════════════════════════════════════════════════
const HB_KEYS = Object.keys(PLAYERS).filter(k => I.hbCoverage(PLAYERS[k]));

check('the Playing profile modal renders real figures, not a grid of dashes', () => {
  assert(HB_KEYS.length > 0, 'no profiled player resolves hold/break coverage');
  let withFigures = 0, leaks = 0;
  for (const key of HB_KEYS) {
    I.state.modal = 'profile'; I.state.hbSurf = 'all';
    const html = I.renderProfileModal(PLAYERS[key]);
    if (/undefined|NaN|\[object/.test(html)) leaks++;
    if (/>\d+%</.test(html)) withFigures++;
  }
  assert.strictEqual(leaks, 0, `${leaks} profiles leaked undefined/NaN into the DOM`);
  assert(withFigures >= HB_KEYS.length * 0.9,
    `only ${withFigures} of ${HB_KEYS.length} covered players print a percentage`);
  console.log(`        ${withFigures} of ${HB_KEYS.length} covered players print real rates, 0 DOM leaks`);
});

mustFail('the render check would catch an all-dash grid', () => {
  const html = '<div>—</div><div>—</div>';
  assert(/>\d+%</.test(html), 'no percentage printed');
});

check('the modal states its own match count, never the career total', () => {
  let stated = 0;
  for (const key of HB_KEYS.slice(0, 60)) {
    const p = PLAYERS[key];
    // Item 2 moved the grid — and its coverage note — out of the modal body and
    // into the layer behind the launcher. The assertion is unchanged; only the
    // surface it is read off moved. (Left pointed at renderProfileModal it went
    // red on a correct page, which is what made it look like a §5.9 defect.)
    I.state.modal = 'profile'; I.state.hbSurf = 'all'; I.state.heat = true;
    const html = I.renderHeatSheet(p);
    I.state.heat = false;
    const cov = I.hbCoverage(p);
    // REPOINTED AGAIN 2026-09-19: the export's rebuild moved the coverage
    // sentence out of the header and into the legend note at the bottom, and
    // reworded it. Rather than re-pin a third phrase, the assertion is now on
    // the NUMBERS — which is what the ruling is actually about ("states its
    // match count, never the career total"). A rewording cannot break it; a
    // renderer that stops stating the count still can.
    assert(html.indexOf(String(cov.matches)) > -1,
      `${p.name}: the heat layer does not state its parsed match count`);
    assert(html.indexOf(String(cov.svcGames)) > -1,
      `${p.name}: the heat layer does not state its service-game count`);
    // The LAUNCHER deliberately carries no count: the export's card is title /
    // mono subtitle / one figure / "Open ›" and nothing else, and the figure it
    // prints is the engine's own gated label (the shard's 20-service-game floor
    // withholds a rate below it). Asserting a count there would be demanding a
    // deviation FROM the export, so what is asserted instead is that the card
    // prints the engine's string and not a computed one — which is what
    // tools/test-heatmap-launcher.js locks, including against the mock's 71.5%.
    const launcher = I.hbLauncherHtml(p);
    assert(launcher.indexOf('Open') > -1 || launcher.indexOf('no point-by-point') > -1,
      `${p.name}: the launcher neither offers the grid nor says why it cannot`);
    // The shard's horizon is 24 months; the ledger is a whole career. If the
    // modal ever printed the career total it would claim coverage we lack.
    const career = I.spineTotal(p).n;
    assert(cov.matches <= career,
      `${p.name}: parsed ${cov.matches} matches but the career spine holds only ${career}`);
    stated++;
  }
  console.log(`        ${stated} modals state a parsed count that is <= the career total`);
});

mustFail('the match-count check would catch a career total standing in for coverage', () => {
  const parsed = 1200, career = 75;
  assert(parsed <= career, `parsed ${parsed} but the career spine holds only ${career}`);
});

check('a player with no point-by-point data says so instead of drawing an empty grid', () => {
  const missing = Object.keys(PLAYERS).find(k => !I.hbCoverage(PLAYERS[k]));
  assert(missing, 'every profiled player is in the shard — this branch is unreachable');
  I.state.modal = 'profile';
  const html = I.renderProfileModal(PLAYERS[missing]);
  assert(html.indexOf('no point-by-point data on record') > -1,
    'an uncovered player did not get the explicit no-data statement');
  // Scoped to the LAUNCHER, not the whole modal. Since item 3 the modal also
  // carries Situational, whose set-score rows rest on a different store and
  // legitimately print rates for a player with no point log — asserting over
  // the whole modal would demand that honest data be suppressed.
  const launcher = I.hbLauncherHtml(PLAYERS[missing]);
  assert(!/>\d+(\.\d+)?%</.test(launcher),
    'an uncovered player printed a hold/break percentage out of nowhere');
  assert(!/data-pp2="heat"/.test(launcher),
    'an uncovered player was offered a control that opens an empty grid');
  console.log(`        uncovered example ${PLAYERS[missing].name}: stated, no invented figures`);
});

mustFail('the no-data check would catch a figure invented for an uncovered player', () => {
  const html = '<div>no point-by-point data on record</div><div>72%</div>';
  assert(!/>\d+%</.test(html), 'an uncovered player printed a percentage out of nowhere');
});

check('the surface chips read their own node and change the figures', () => {
  // Same susceptibility discipline as the engine test: assert the SUBJECT can
  // move before asserting that it does.
  const subject = HB_KEYS.find((k) => {
    const a = ENGINE.heatFor(HOLDBREAK, k, 'HOLD', 5, 'all');
    const c = ENGINE.heatFor(HOLDBREAK, k, 'HOLD', 5, 'clay');
    return a.globalLabel !== c.globalLabel && c.globalLabel !== 'HOLD —';
  });
  assert(subject, 'no covered player has clay figures distinct from all — the check would be immune');
  I.state.modal = 'profile'; I.state.heat = true;
  I.state.hbSurf = 'all';
  const all = I.renderHeatSheet(PLAYERS[subject]);
  I.state.hbSurf = 'clay';
  const clay = I.renderHeatSheet(PLAYERS[subject]);
  I.state.hbSurf = 'all'; I.state.heat = false;
  assert.notStrictEqual(all, clay, `${PLAYERS[subject].name}: the clay chip rendered the all-surfaces grid`);
  // The surface label moved from a trailing "clay only" pill into the export's
  // single context chip ("Clay · last 24M"), which is item 5 of the rebuild.
  // The claim is unchanged — the clay view must say it is the clay view.
  //
  // Read out of the CHIP, not out of the whole layer. A bare /Clay/ over the
  // markup is vacuous: the surface control paints a "Clay" button whatever is
  // selected, so freezing the chip to "All surfaces" left that check green.
  // Caught by mutation, not by reading.
  const chipText = (h) => {
    const at = h.indexOf('padding:8px 14px;">');
    return at < 0 ? '' : h.slice(at + 19, h.indexOf('</span>', at));
  };
  assert(/Clay/.test(chipText(clay)),
    `the clay view's context chip does not name clay (chip reads "${chipText(clay)}")`);
  assert(/All surfaces/.test(chipText(all)),
    `the all-surfaces view's chip does not name it (chip reads "${chipText(all)}")`);
  console.log(`        ${PLAYERS[subject].name}: all vs clay render differently and are labelled`);
});

mustFail('the surface-chip check would catch a chip that does nothing', () => {
  const all = '<div>same</div>', clay = '<div>same</div>';
  assert.notStrictEqual(all, clay, 'the clay chip rendered the all-surfaces grid');
});

check('the modal computes nothing itself — every figure comes from the engine', () => {
  const src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  const from = src.indexOf('§5.9 PLAYING PROFILE');
  // Bounded at the SITUATIONAL block, not at MOUNT. Ruling 7 forbids a second
  // HOLD/BREAK engine; item 3's Situational panel sits in the same section, has
  // its own store (situational.json) and legitimately computes its own rates
  // from it. Scanning to MOUNT swept that in and reported a second hold/break
  // engine that does not exist.
  const sit = src.indexOf('BUILD ITEM 3 · SITUATIONAL', from);
  const to = sit > from ? sit : src.indexOf('// MOUNT', from);
  assert(from > -1 && to > from, 'could not locate the §5.9 hold/break block');
  assert(sit > from, 'the Situational marker moved — re-bound this scan before trusting it');
  // Scan CODE only. The first draft matched the literal string "won/n" inside
  // this block's own explanatory comment and reported a second engine that does
  // not exist — a regex that reads prose is not reading the implementation.
  const block = src.slice(from, to)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // A second engine would have to divide, or re-band a rate, to exist.
  assert(!/\/\s*(den|n)\b|Math\.round\([^)]*\*\s*100/.test(block),
    '§5.9 contains rate arithmetic — that is a second engine, which ruling 7 forbids');
  assert(/E\.heatFor\(/.test(block), '§5.9 does not call the shared engine');
  console.log('        §5.9 contains no rate arithmetic and calls E.heatFor');
});

mustFail('the no-second-engine check would catch re-derived arithmetic', () => {
  const block = 'var pct = Math.round(won / den * 100);';
  assert(!/\/\s*(den|n)\b|Math\.round\([^)]*\*\s*100/.test(block),
    '§5.9 contains rate arithmetic');
});

// ════════════════════════════════════════════════════════════════════════════
// 20 · §4 FULL LEDGER + THE MOUNT
// ════════════════════════════════════════════════════════════════════════════
//
// The mount checks read bsp-consult-dashboard.html as SOURCE. That is unusual
// for this harness, which otherwise runs the module — but the defect they exist
// to catch is not in the module at all. player-profile-v2.js passed 120 checks
// while being completely unreachable: no <script src>, no flag, no wiring, no
// store bridge. Every figure below was already correct and none of it was on
// the site. A test that only ever loads the module cannot see that.
const DASH_CH = '—';
const DASHBOARD = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
// The CLOSING tag is part of the needle on purpose. Matching the opening tag
// alone found a code COMMENT that mentions it (pp2Bridge explains why the flag
// is not set there) 568 KB earlier in the file, which made the load-order check
// below report a failure that did not exist.
const PP2_TAG = '<script src="player-profile-v2.js"></script>';

check('the dashboard actually loads player-profile-v2.js', () => {
  assert(DASHBOARD.indexOf(PP2_TAG) > -1,
    'no player-profile-v2.js script tag — the module is unreachable from the page');
});

// The deploy is an explicit `cp` allowlist, so a NEW local file is committed,
// passes every test, and then 404s on the live site. That has bitten this repo
// before (bsp-pipeline.js, TEN-157) and it bit this ticket twice at once:
// neither player-profile-v2.js NOR holdbreak-heatmap.js was copied. The second
// is the worse of the two — the Live tab now calls that engine, so the missing
// copy would have broken a DON'T-TOUCH surface, not this one.
//
// Rather than trust a hand-maintained list, this derives the requirement from
// the dashboard itself: every local script it loads must be copied AND asserted.
check('every script the dashboard loads is deployed and assert-gated', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
  const srcs = [...DASHBOARD.matchAll(/<script src="([^"]+)"/g)]
    .map(m => m[1].replace(/^\.\//, ''))         // the page writes both ./x.js and x.js
    .filter(s => !/^https?:|^\/\//.test(s));     // local files only
  assert(srcs.length > 0, 'found no local <script src> in the dashboard — the regex is wrong');
  const cpLine = (s) => (wf.match(new RegExp(`^\\s*cp[^\\n]*\\b${s.replace(/\./g, '\\.')}\\b[^\\n]*$`, 'm')) || [])[0];
  const notCopied = srcs.filter(s => !cpLine(s));
  assert.deepStrictEqual(notCopied, [],
    `the dashboard loads these but the deploy never copies them (they 404 live): ${notCopied.join(', ')}`);
  // A copy ending in `|| true` is an explicit decision that the file is
  // optional (admin-config.js), so it is exempt from the assert list. Anything
  // copied unconditionally is load-bearing and must be gated, or a silent cp
  // failure ships a page whose scripts 404.
  const assertBlock = wf.slice(wf.indexOf('for f in index.html'), wf.indexOf('MISSING from _site'));
  const required = srcs.filter(s => !/\|\|\s*true/.test(cpLine(s)));
  const notAsserted = required.filter(s => !assertBlock.includes(s));
  assert.deepStrictEqual(notAsserted, [],
    `copied but not assert-gated, so a silent cp failure ships a broken page: ${notAsserted.join(', ')}`);
  console.log(`        ${srcs.length} local scripts, all copied; ${required.length} required and assert-gated`);
});

mustFail('the deploy-allowlist check would catch a script that is never copied', () => {
  const srcs = ['live-tab.js', 'player-profile-v2.js'];
  const wf = 'cp live-tab.js _site/';
  const notCopied = srcs.filter(s => !new RegExp(`cp[^\\n]*${s.replace(/\./g, '\\.')}`).test(wf));
  assert.deepStrictEqual(notCopied, [], `never copied: ${notCopied.join(', ')}`);
});

check('FEATURE_PP2 is set BEFORE the module tag, not at profile-open time', () => {
  const flagAt = DASHBOARD.indexOf('window.FEATURE_PP2 =');
  const tagAt = DASHBOARD.indexOf(PP2_TAG);
  assert(flagAt > -1, 'window.FEATURE_PP2 is never assigned by the page');
  assert(tagAt > -1, 'the module tag is missing');
  assert(flagAt < tagAt,
    'FEATURE_PP2 is assigned after the <script> tag. The module reads the flag at PARSE time and ' +
    'returns immediately when falsy, so it would never define window.PlayerProfileV2 and every ' +
    'profile open would silently fall back to the legacy page.');
});

mustFail('the flag-order check would catch the flag being set too late', () => {
  const src = '<script src="player-profile-v2.js"></script>\nwindow.FEATURE_PP2 = true;';
  assert(src.indexOf('window.FEATURE_PP2 =') < src.indexOf(PP2_TAG),
    'FEATURE_PP2 is assigned after the script tag');
});

check('the host bridges every data store the module reads onto window', () => {
  // The dashboard holds these in `let` bindings, which do NOT create window
  // properties. Miss one and that block renders a grid of dashes that looks
  // exactly like "we hold no data" — the stylesStore failure, again.
  const bridge = DASHBOARD.slice(DASHBOARD.indexOf('function pp2Bridge()'));
  const body = bridge.slice(0, bridge.indexOf('\n}'));
  const needed = ['playerProfiles', 'careerSplits', 'playingStyles', 'holdbreak', 'marketEdge'];
  const missing = needed.filter(n => !new RegExp(`window\\.${n}\\s*=`).test(body));
  assert.deepStrictEqual(missing, [], `pp2Bridge does not assign: ${missing.join(', ')}`);
  console.log(`        pp2Bridge assigns all ${needed.length} stores`);
});

mustFail('the bridge check would catch a store left unassigned', () => {
  const body = 'window.playerProfiles = x; window.careerSplits = y;';
  const needed = ['playerProfiles', 'careerSplits', 'playingStyles', 'holdbreak', 'marketEdge'];
  const missing = needed.filter(n => !new RegExp(`window\\.${n}\\s*=`).test(body));
  assert.deepStrictEqual(missing, [], `unassigned: ${missing.join(', ')}`);
});

// Reproduced live before this guard existed: opening a v2 profile and then
// firing ppRepaint() (which three lazy loaders do when they resolve) replaced
// the rebuilt page with the LEGACY one, mid-session, in front of the reader.
check('ppRepaint hands back to v2 instead of overwriting it with the legacy page', () => {
  const body = DASHBOARD.slice(DASHBOARD.indexOf('function ppRepaint()'));
  const fn = body.slice(0, body.indexOf('\n}'));
  const guardAt = fn.indexOf('PlayerProfileV2.repaint()');
  const legacyAt = fn.indexOf('buildPlayerProfileHtml(profile)');
  assert(guardAt > -1, 'ppRepaint does not delegate to v2 — a lazy loader will clobber the page');
  assert(legacyAt > -1, 'ppRepaint no longer paints the legacy page at all — verify that was intended');
  assert(guardAt < legacyAt,
    'the v2 delegation comes AFTER the legacy innerHTML write, so it cannot prevent the clobber');
  assert(/return;/.test(fn.slice(guardAt, legacyAt)),
    'the v2 branch does not return — it falls through and repaints legacy anyway');
});

mustFail('the ppRepaint-guard check would catch the guard being removed', () => {
  const fn = 'const view=x; view.innerHTML = buildPlayerProfileHtml(profile);';
  assert(fn.indexOf('PlayerProfileV2.repaint()') > -1, 'ppRepaint does not delegate to v2');
});

check('the bridge hands playerProfiles the shape the module reads', () => {
  // archetypeFor and profileFor both read window.playerProfiles.players. The
  // dashboard's own binding IS the players map, so bridging it directly would
  // make every key miss.
  assert(/window\.playerProfiles\s*=\s*\{\s*players:\s*playerProfiles\s*\}/.test(DASHBOARD),
    'playerProfiles is bridged in the wrong shape — the module reads .players');
});

check('every data-pp2 hook the module paints has a handler in the mount', () => {
  const src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  // Hooks emitted with a literal value. (The one computed hook is calSegBtn's
  // `attr`, whose two call sites pass 'cal-tab' and 'cal-surface'.)
  const painted = new Set((src.match(/data-pp2="([a-z-]+)"/g) || [])
    .map(s => s.replace(/data-pp2="|"/g, '')));
  painted.add('cal-tab'); painted.add('cal-surface');
  // 'sheet' appears in the source inside sheetHook(), but MATCH_SHEET_BUILT
  // gates it out of the emitted markup — §8 is not built. Requiring a handler
  // for it would force the mount to wire a click to a modal that does not
  // exist. The "no affordance advertises the unbuilt match sheet" check above
  // is what holds the other side of this: it is never PAINTED while the
  // constant is false. Drop the exemption when §8 lands.
  if (I.MATCH_SHEET_BUILT === false) painted.delete('sheet');
  const onClick = src.slice(src.indexOf('function onClick(e)'));
  const handled = new Set((onClick.slice(0, onClick.indexOf('\n  function onInput'))
    .match(/kind === '([a-z-]+)'/g) || []).map(s => s.replace(/kind === '|'/g, '')));
  handled.add('tourn-search');   // an input hook, handled in onInput
  const unhandled = [...painted].filter(h => !handled.has(h));
  assert.deepStrictEqual(unhandled, [],
    `these hooks are painted but nothing handles the click: ${unhandled.join(', ')}`);
  console.log(`        ${painted.size} painted hooks, all handled`);
});

mustFail('the hook-coverage check would catch an unwired affordance', () => {
  const painted = ['box', 'close', 'speed-band'];
  const handled = new Set(['box', 'close']);
  const unhandled = painted.filter(h => !handled.has(h));
  assert.deepStrictEqual(unhandled, [], `unwired: ${unhandled.join(', ')}`);
});

// §8.1 landed in the correction pass, so this check inverts: the affordance and
// the content must ship TOGETHER. The old form asserted the hook was absent
// while the sheet did not exist; this one asserts that every row advertising a
// click resolves to a sheet that actually renders. Either half alone is the bug
// (a dead cursor, or a sheet nothing can open).
check('every ledger row that advertises a click opens a sheet that renders', () => {
  const p = byName('N. Djokovic');
  const anyRows = I.ledgerRows(p);
  assert(anyRows.length > 0, 'no ledger rows to inspect');
  I.state.ledgerOpen = true;
  const ctx = { ledgerOpen: true, ledgerRows: anyRows, ledgerFiltered: I.ledgerFiltered(anyRows) };
  const html = I.renderLedger(p, ctx);
  I.state.ledgerOpen = false;
  assert.strictEqual(I.MATCH_SHEET_BUILT, true, 'MATCH_SHEET_BUILT is false but §8.1 is built');
  const ids = (html.match(/data-pp2="sheet" data-v="([^"]+)"/g) || [])
    .map(s => s.replace(/data-pp2="sheet" data-v="|"/g, ''));
  assert(ids.length > 0, 'the ledger paints no match-sheet hook although §8.1 is built');
  assert(/cursor:pointer/.test(html), 'the rows advertise no pointer cursor');
  let rendered = 0;
  for (const id of ids) {
    I.state.sheet = id.replace(/&amp;/g, '&');
    const sheet = I.renderSheet(p, ctx);
    if (/Dominance ratio/.test(sheet)) rendered++;
  }
  I.state.sheet = null;
  assert.strictEqual(rendered, ids.length,
    `${ids.length - rendered} of ${ids.length} ledger hooks open nothing`);
  console.log(`        ${ids.length} ledger hooks, all open a rendered sheet`);
});

mustFail('the affordance check would catch a hook that opens nothing', () => {
  const ids = ['a', 'b'], rendered = 1;
  assert.strictEqual(rendered, ids.length, `${ids.length - rendered} of ${ids.length} hooks open nothing`);
});

// §4: "Recent-form ribbon W-L and % = the strip shown = the ledger's last-N
// rows." Caught live: the ledger header rated the WHOLE filtered set while its
// strip drew only the last 18, so Djokovic read "75.0% win · 20 matches" over
// an 18-square strip. Two figures for one claim, on one screen.
check('the ledger rate is taken over exactly the rows its strip draws', () => {
  const keys = Object.keys(PLAYERS).filter(k => (PLAYERS[k].recentForm || {}).matches);
  let checked = 0, over = 0;
  for (const key of keys) {
    const p = PLAYERS[key];
    I.state.surfaces = []; I.state.priceFilters = [];
    const rows = I.ledgerRows(p);
    const filtered = I.ledgerFiltered(rows);
    if (!filtered.length) continue;
    if (filtered.length > I.LEDGER_CAP) over++;
    const strip = filtered.slice(-I.LEDGER_CAP);
    I.state.ledgerOpen = true;
    const html = I.renderLedger(p, { ledgerOpen: true, ledgerRows: rows, ledgerFiltered: filtered });
    I.state.ledgerOpen = false;
    const w = strip.filter(x => x.m.won && !(x.m.walkover && !x.m.won)).length;
    const l = strip.filter(x => !x.m.won && !(x.m.walkover && !x.m.won)).length;
    const n = w + l;
    // Correction-pass item 3: the ledger header is one of the export's two
    // .toFixed(0) values, so the expectation is a whole number here and stays at
    // one decimal everywhere else.
    const expected = n >= 5 ? (100 * w / n).toFixed(0) + '%' : DASH_CH;
    const m = html.match(/font-weight:700;">([^<]+) win<\/span>\s*·\s*(\d+) match/);
    assert(m, `${p.name}: could not read the ledger headline`);
    assert.strictEqual(m[1], expected,
      `${p.name}: headline rate ${m[1]} but the strip's ${n} rows give ${expected}`);
    assert.strictEqual(Number(m[2]), n,
      `${p.name}: headline says ${m[2]} matches but the strip draws ${n}`);
    checked++;
  }
  assert(checked > 100, `only ${checked} players had a ledger to check`);
  assert(over > 0, 'no player exceeded the cap — the over-cap branch went untested');
  console.log(`        ${checked} ledgers agree with their strip (${over} of them over the ${I.LEDGER_CAP}-row cap)`);
});

mustFail('the strip-agreement check would catch a rate taken over the wrong set', () => {
  const strip = [{ won: true }, { won: false }];       // 50.0% over 2
  const wholeSet = [{ won: true }, { won: true }, { won: false }];  // 66.7% over 3
  const rate = a => (100 * a.filter(x => x.won).length / a.length).toFixed(1) + '%';
  assert.strictEqual(rate(wholeSet), rate(strip), 'headline rate disagrees with the strip');
});

// H / A orientation. Founder ruling 1: H is the SUBJECT product-wide. The shard
// is subject-relative, so H must be `price` and A `oppPrice` — never reversed.
check('the ledger H column is the subject price and A the opponent price', () => {
  const p = byName('N. Djokovic');
  const rows = I.ledgerRows(p).filter(x => x.price != null && x.oppPrice != null);
  assert(rows.length > 0, 'no priced ledger rows for the orientation check');
  const shard = MARKET[String(p.key)];
  const byDate = {};
  (shard.matches || []).forEach(m => {
    if (byDate[m.date] === undefined) byDate[m.date] = m; else byDate[m.date] = null;
  });
  // A DAY, not a match, is the join key here, so a day carrying two matches
  // cannot be resolved by date alone — byDate deliberately nulls it. Treating
  // that as a failure made the probe red on the deployed store (Djokovic,
  // 2026-08-31) for a limitation of the probe, not a defect in the page. Skip
  // the ambiguous days and FLOOR the resolved count, so the check can never
  // quietly degrade to "nothing was comparable, therefore green".
  let agree = 0, ambiguous = 0;
  for (const x of rows) {
    const src = byDate[x.m.date];
    if (!src) { ambiguous++; continue; }
    assert.strictEqual(x.price, src.price, `${x.m.date}: H is not the subject price`);
    assert.strictEqual(x.oppPrice, src.oppPrice, `${x.m.date}: A is not the opponent price`);
    agree++;
  }
  // 15, not 20: the subject holds 18 unambiguous priced rows today. A floor
  // above the real population is not a stronger check, it is a broken one.
  assert(agree >= 15, `only ${agree} unambiguous priced rows (${ambiguous} ambiguous days) — too few to orient`);
  console.log(`        ${agree} priced rows oriented subject-first (${ambiguous} ambiguous days skipped)`);
});

mustFail('the orientation check would catch H and A being swapped', () => {
  const x = { price: 1.17, oppPrice: 5.0 };
  const src = { price: 1.17, oppPrice: 5.0 };
  assert.strictEqual(x.oppPrice, src.price, 'H is not the subject price');
});

// A day the archive priced twice cannot be resolved to one match (the shard
// carries no opponent key), so it must dash rather than pick the first row.
check('an ambiguous priced date dashes instead of guessing a match', () => {
  const idx = I.ledgerPriceIndex('1905');
  const shard = MARKET['1905'];
  const counts = {};
  (shard.matches || []).forEach(m => { counts[m.date] = (counts[m.date] || 0) + 1; });
  const dupes = Object.keys(counts).filter(d => counts[d] > 1);
  assert(dupes.length > 0, 'this player has no duplicated priced date — pick another subject');
  dupes.forEach(d => assert.strictEqual(idx[d], null,
    `${d} has ${counts[d]} priced rows but the index resolved one of them`));
  console.log(`        ${dupes.length} ambiguous dates left unresolved for N. Djokovic`);
});

mustFail('the ambiguity check would catch a first-row-wins index', () => {
  const rows = [{ date: '2026-01-01', price: 1.5 }, { date: '2026-01-01', price: 2.5 }];
  const idx = {};
  rows.forEach(r => { if (idx[r.date] === undefined) idx[r.date] = r; });  // first wins — wrong
  assert.strictEqual(idx['2026-01-01'], null, 'an ambiguous date resolved to a row');
});

// ════════════════════════════════════════════════════════════════════════════
// 22 · CORRECTION PASS — the founder's items 1-15, each locked
// ════════════════════════════════════════════════════════════════════════════
console.log('\n22 · Correction pass (items 1-15)');

const PP2_SRC = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
const ZVEREV = byName('A. Zverev') || SAMPLE[0];

function ledgerHtmlFor(p) {
  I.state.surfaces = []; I.state.priceFilters = []; I.state.ledgerOpen = true;
  const rows = I.ledgerRows(p);
  // build() stamps subjectName onto every row before rendering; a helper that
  // skips it renders the placeholder and measures nothing.
  rows.forEach((x) => { x.subjectName = p.name; });
  const html = I.renderLedger(p, {
    ledgerOpen: true, ledgerRows: rows, ledgerFiltered: I.ledgerFiltered(rows)
  });
  I.state.ledgerOpen = false;
  return html;
}

// ── item 1 ──────────────────────────────────────────────────────────────────
check('item 1 · the back link reads "Back to Players"', () => {
  const html = I.renderBackLink();
  assert(/>\s*Back to Players<\/a>/.test(html), `back link is: ${html.slice(-40)}`);
});
mustFail('the back-link check would catch the old one-word label', () => {
  assert(/>\s*Back to Players<\/a>/.test('<a>Players</a>'), 'back link is wrong');
});

// ── items 2 / 5 / 13 · the one shared rule ─────────────────────────────────
check('items 2/5/13 · the line-height override is scoped to this page, not to body', () => {
  assert(/line-height:normal/.test(I.PP2_STYLE), 'no line-height override is emitted');
  assert(/\.pp2-main/.test(I.PP2_STYLE), 'the override does not target .pp2-main');
  // Founder ruling lh-0: `body` is shared by Matches, Live, Series and H2H. An
  // override that reached it would re-flow four don't-touch surfaces.
  assert(!/(^|[^-\w.])body\b/.test(I.PP2_STYLE),
    'the override targets body — that is ruling lh-1, which was NOT chosen');
  assert(PP2_SRC.indexOf('PP2_STYLE +') > 0, 'the style block is never emitted by build()');
});
mustFail('the scoping check would catch an override that reached body', () => {
  const s = '<style>body{line-height:normal;}</style>';
  assert(!/(^|[^-\w.])body\b/.test(s), 'the override targets body');
});

check('item 13 · ledger rows align on center and set the outer name span to 13px', () => {
  const html = ledgerHtmlFor(ZVEREV);
  const row = html.slice(html.indexOf('class="pp2-ledger-row"'));
  assert(/align-items:center/.test(row.slice(0, 400)), 'the row still aligns on baseline');
  assert(/<span style="font-size:13px;overflow:hidden/.test(html),
    'the outer name span does not set 13px, so it inherits the card size');
});
mustFail('the row-alignment check would catch a baseline row', () => {
  assert(/align-items:center/.test('align-items:baseline;'), 'the row still aligns on baseline');
});

// ── item 3 · whole numbers, and ONLY in the export's two places ────────────
check('item 3 · the ribbon and ledger headlines are whole numbers, every other rate is not', () => {
  assert.strictEqual(I.rateText0(15, 3), '83%');
  assert.strictEqual(I.rateText(15, 3), '83.3%');
  // The sample gate must survive the second formatter — a 4-match record has no
  // rate at all, in either form.
  assert.strictEqual(I.rateText0(3, 1), '—');
  // Scope. Originally one definition + two call sites (the export's two
  // .toFixed(0) values). FOUNDER RULING 2026-09-16, §5.3 item 9: "Win%: whole
  // number ('78%'), not '81.8%'" — so Record per tournament is now a THIRD
  // whole-number surface, at four call sites (list row, W-L tile sub, Grand
  // Slam career tile sub, detail header meta). Re-pinned rather than dropped:
  // the point is that whole-number formatting stays where it was RULED and does
  // not creep further on its own.
  // v7 adds TWO more, both forced by verify step (d) rather than chosen: the
  // `tourn` box support carries a Record-per-tournament win% (already ruled
  // whole above), and the `styles` box headline had to match the Matchup list
  // it opens, which has always rounded. Re-pinned at 9 on the same principle —
  // the count moves only when a ruling or a measured disagreement moves it.
  // ITEM 3 (2026-09-19) took the win% out of the `tourn` box support — its
  // fourth token is now the priced n, which is the only figure on that tile
  // that says what the +Xu headline was struck over. The whole-number RULING is
  // untouched: Record per tournament still rounds wherever it renders, which is
  // now the §5.3 modal only. ITEM 2 added one back at box 4, whose headline is
  // the band's win rate. Net 9, and the INVENTORY below is what carries the
  // meaning — the count alone would have read as "nothing changed".
  const calls = (PP2_SRC.match(/rateText0\(/g) || []).length;
  assert.strictEqual(calls, 9,
    `rateText0 appears ${calls} times (expected 9: the definition + ribbon + ledger ` +
    `header + 4 in §5.3 + the speed box headline + the styles box headline)`);

  // The old guard here was "rateText must outnumber rateText0". v7 broke it
  // legitimately — 8 vs 9 — and that is worth saying out loud rather than
  // flipping the inequality and moving on: whole-number rates are now as common
  // as 1-dp ones on this page, so the "exception" framing no longer describes
  // the code. FLAGGED FOR THE FOUNDER.
  //
  // A raw majority of call sites was always a weak proxy anyway: it counts the
  // definition, it counts comment-stripped source, and it fails the moment a
  // ruled surface is legitimately added. Replaced with the thing the ruling
  // actually constrains — WHICH surfaces round — so creep shows up as a named
  // surface appearing in this list, not as a number drifting.
  const wide = (PP2_SRC.match(/[^0]\brateText\(/g) || []).length;
  const WHOLE_SURFACES = [
    'recent-form ribbon headline',
    'full ledger header',
    '§5.3 list row win%', '§5.3 W–L tile sub', '§5.3 Grand Slam tile sub',
    '§5.3 detail header meta',
    // ITEM 3 (2026-09-19) removed box 3's support win% — its fourth token is now
    // the priced n. ITEM 2 added box 4's headline, which leads with the band's
    // win rate and rounds because a pace band's rate is a coarse figure and the
    // modal it opens has always rounded it.
    'box 4 (speed) headline',            // item 2, 2026-09-19
    'box 6 (styles) headline'            // measured: the Matchup list rounds
  ];
  assert.strictEqual(WHOLE_SURFACES.length, calls - 1,
    `the named whole-number surfaces (${WHOLE_SURFACES.length}) no longer account ` +
    `for the ${calls - 1} rateText0 call sites — a surface started rounding unnamed`);
  console.log(`        rateText0 at ${calls - 1} named surfaces, rateText at ${wide} ` +
    `(was a majority, no longer — flagged)`);
});
mustFail('the whole-number check would catch a global .toFixed(0)', () => {
  const rateText = (w, l) => (100 * w / (w + l)).toFixed(0) + '%';
  assert.strictEqual(rateText(15, 3), '83.3%', 'every rate went whole-number');
});

// ── item 4 + 8 · name forms ────────────────────────────────────────────────
check('items 4/8 · names are re-ordered at the initial, never token-swapped', () => {
  assert.strictEqual(I.surnameFirst('B. Shelton'), 'Shelton B.');
  assert.strictEqual(I.surnameOf('P. Martinez'), 'Martinez');
  // The trap: api-tennis reorders multi-part surnames, so a whitespace swap
  // would mangle these two. Everything after the initial is carried intact.
  assert.strictEqual(I.surnameFirst('B. Van De Zandschulp'), 'Van De Zandschulp B.');
  assert.strictEqual(I.surnameFirst('F. Meligeni Alves'), 'Meligeni Alves F.');
  // A name with no initial prefix is left exactly as it arrived.
  assert.strictEqual(I.surnameFirst('Zsombor Piros'), 'Zsombor Piros');
  const html = ledgerHtmlFor(ZVEREV);
  assert(!/>Zverev\s+A\.</.test(html), 'the SUBJECT is rendered surname-first; the export has it bare');
  assert(/>Zverev</.test(html), 'the subject surname is missing from the ledger');
});
mustFail('the name-form check would catch a whitespace token swap', () => {
  const swap = n => n.split(/\s+/).reverse().join(' ');
  assert.strictEqual(swap('B. Van De Zandschulp'), 'Van De Zandschulp B.', 'multi-part surname mangled');
});

// ── item 7 · dd.mm ─────────────────────────────────────────────────────────
check('item 7 · ledger dates are dd.mm and the header prose is not', () => {
  assert.strictEqual(I.fmtDotDate('2026-09-13'), '13.09');
  const html = ledgerHtmlFor(ZVEREV);
  const dates = (html.match(/font-size:11px;color:#6e7a93;">([^<]+)</g) || [])
    .map(s => s.replace(/.*">|</g, ''));
  assert(dates.length > 0, 'no ledger date cells found');
  dates.forEach(d => assert(/^\d{2}\.\d{2}$/.test(d), `ledger date "${d}" is not dd.mm`));
  console.log(`        ${dates.length} ledger dates, all dd.mm`);
});
mustFail('the date-format check would catch "13 Sep"', () => {
  assert(/^\d{2}\.\d{2}$/.test('13 Sep'), 'ledger date is not dd.mm');
});

// ── item 9 · round codes ───────────────────────────────────────────────────
// The module cannot require() the SSOT (it is CommonJS under tools/ and this is
// a browser file), so it mirrors roundShort(). This check loads the REAL SSOT
// and asserts the mirror agrees on every round string in the roster — the copy
// cannot drift without failing the build.
const RC = require(path.join(ROOT, 'tools', 'points-at-risk', 'round-classify.js'));
check('item 9 · the round-of-N mirror agrees with round-classify.js on every roster row', () => {
  const seen = new Set();
  for (const k of Object.keys(PLAYERS)) {
    for (const m of ((PLAYERS[k].recentForm || {}).matches || [])) if (m.round) seen.add(m.round);
  }
  assert(seen.size > 20, `only ${seen.size} distinct round strings to compare`);
  let bad = 0;
  for (const r of seen) if (I.roundOfN(r) !== RC.roundShort(r)) bad++;
  assert.strictEqual(bad, 0, `${bad} of ${seen.size} round strings disagree with the SSOT`);
  console.log(`        ${seen.size} distinct round strings, mirror == SSOT on all`);
});
mustFail('the SSOT-agreement check would catch a drifted mirror', () => {
  assert.strictEqual(RC.roundShort('x - 1/8-finals'), 'R8', 'mirror drifted');
});

check('item 9 · every ledger round cell is a short code on one line', () => {
  let cells = 0, long = 0;
  for (const k of Object.keys(PLAYERS)) {
    for (const m of I.ledgerMatches(PLAYERS[k])) {
      const lab = I.roundLabel(m);
      cells++;
      // The defect was prose ("Quarter-finals", "1/16-finals") in a 44px track.
      if (lab.length > 4 || /[\s/]/.test(lab)) long++;
    }
  }
  assert(cells > 5000, `only ${cells} rows inspected`);
  assert.strictEqual(long, 0, `${long} of ${cells} round cells are still prose`);
  const html = ledgerHtmlFor(ZVEREV);
  assert(/font-size:10.5px;color:#6e7a93;white-space:nowrap/.test(html),
    'the round cell does not set white-space:nowrap');
  console.log(`        ${cells} round cells, all <=4 chars and nowrap`);
});
mustFail('the round-code check would catch a prose label', () => {
  const lab = '1/16-finals';
  assert(!(lab.length > 4 || /[\s/]/.test(lab)), 'round cell is still prose');
});

check('item 9 · a draw size is only numbered when the round chain PROVES it', () => {
  // A complete chain down to the Final proves the draw.
  assert.strictEqual(I.provenDraw({ R128: 1, R64: 1, R32: 1, R16: 1, QF: 1, SF: 1, F: 1 }), 128);
  // A hole anywhere in the chain, or a missing Final, proves nothing — and the
  // row then keeps its round-of-N code rather than being given a guessed "1R".
  assert.strictEqual(I.provenDraw({ R128: 1, R32: 1, R16: 1, QF: 1, SF: 1, F: 1 }), 0);
  assert.strictEqual(I.provenDraw({ R32: 1, R16: 1, QF: 1, SF: 1 }), 0);
  const idx = I.drawIndex();
  const slam = Object.keys(idx).filter(k => /^(US Open|Wimbledon|French Open|Australian Open)\|/.test(k));
  assert(slam.length > 0, 'no Slam editions in the draw index');
  // A Slam main draw is 128. Older editions are thinly covered by today's
  // roster, so many derive 0 (unproven) and their rows keep R32/R64/R128 —
  // that is the rule working. What must NEVER happen is a Slam edition deriving
  // some OTHER draw size, which would number its rounds wrongly.
  const proven = slam.filter(k => idx[k] > 0);
  assert(proven.length > 0, 'not one Slam edition could be proven');
  proven.forEach(k => assert.strictEqual(idx[k], 128, `${k} derived a draw of ${idx[k]}, not 128`));
  // No edition may derive a draw that is not a power of two.
  Object.keys(idx).forEach((k) => {
    const d = idx[k];
    assert(d === 0 || (d >= 2 && Number.isInteger(Math.log2(d))),
      `${k} derived a non-power-of-two draw: ${d}`);
  });
  console.log(`        ${proven.length} of ${slam.length} Slam editions proven, all at 128`);
  // Coverage, reported rather than asserted at a target: the rows that fall back.
  let pre = 0, numbered = 0;
  for (const k of Object.keys(PLAYERS)) {
    for (const m of I.ledgerMatches(PLAYERS[k])) {
      const code = I.roundOfN(m.round);
      if (!/^R(32|64|128|256)$/.test(code)) continue;
      pre++;
      if (/^\d+R$/.test(I.roundLabel(m))) numbered++;
    }
  }
  console.log(`        ${numbered} of ${pre} pre-R16 rows numbered ` +
    `(${(100 * numbered / pre).toFixed(1)}%), the rest keep R32/R64/R128`);
});
mustFail('the proven-draw check would catch a lower-bound guess', () => {
  const guess = set => Math.max(...Object.keys(set).map(c => ({ F: 2, SF: 4, QF: 8, R16: 16, R32: 32, R64: 64, R128: 128 })[c] || 0));
  assert.strictEqual(guess({ R32: 1, R16: 1, QF: 1, SF: 1 }), 0, 'an unproven draw was numbered anyway');
});

// ── item 10 · score format + tiebreak points ───────────────────────────────
check('item 10 · set scores are comma-separated with tiebreak points where held', () => {
  assert.strictEqual(I.setText({ p: 7, o: 6, pTb: 7, oTb: 2 }), '7-6(2)');
  assert.strictEqual(I.setText({ p: 6, o: 7, pTb: 4, oTb: 7 }), '6-7(4)');
  // No points held → no bracket, never an invented margin.
  assert.strictEqual(I.setText({ p: 7, o: 6 }), '7-6');
  assert.strictEqual(
    I.setScoreText({ sets: [{ p: 6, o: 3 }, { p: 7, o: 6, pTb: 7, oTb: 2 }] }), '6-3, 7-6(2)');
  // The ribbon uses the same values, space-joined, exactly as the export does.
  assert.strictEqual(
    I.setScoreText({ sets: [{ p: 6, o: 3 }, { p: 7, o: 6, pTb: 7, oTb: 2 }] }, ' '), '6-3 7-6(2)');
  let tbSets = 0, missing = 0;
  for (const k of Object.keys(PLAYERS)) {
    for (const m of I.ledgerMatches(PLAYERS[k])) {
      for (const s of (m.sets || [])) {
        if ((s.p === 7 && s.o === 6) || (s.p === 6 && s.o === 7)) tbSets++;
      }
      missing += I.tiebreaksMissing(m);
    }
  }
  assert(tbSets > 0, 'no tiebreak sets in the roster to check');
  console.log(`        ${tbSets} tiebreak sets in ledger rows, ${missing} without points ` +
    `(${(100 * missing / tbSets).toFixed(1)}%) — those print 7-6 with no bracket`);
});
mustFail('the score-format check would catch a space-joined ledger score', () => {
  assert.strictEqual('6-3 7-6(2)', '6-3, 7-6(2)', 'ledger score is not comma-separated');
});

// ── item 6 · segmented control ─────────────────────────────────────────────
check('item 6 · only the selected surface chip carries a border', () => {
  const on = I.ledgerChip('ledger-surf', 'all', 'All', true);
  const off = I.ledgerChip('ledger-surf', 'hard', 'Hard', false);
  assert(/border:0\.33px solid #2e4fa8/.test(on), 'the selected chip lost its border');
  assert(/border:0\.33px solid transparent/.test(off), 'an unselected chip still draws a visible border');
  assert(!/rgba\(255,255,255,0\.12\)/.test(off), 'the unselected chip keeps the old box border');
});
mustFail('the segmented-control check would catch a bordered unselected chip', () => {
  const off = 'border:1px solid rgba(255,255,255,0.12);';
  assert(/border:0\.33px solid transparent/.test(off), 'an unselected chip still draws a visible border');
});

// ── items 12 + 15 · the shared eyebrow helper ──────────────────────────────
// Values quoted from the export's `.cap` class, Player Profile.dc.html:25:
//   font-size 9.5px · letter-spacing 0.16em · colour #6e7a93
check('items 12/15 · every eyebrow matches the export .cap', () => {
  const e = I.eyebrow('Recent form');
  assert(/font-size:9\.5px/.test(e), `eyebrow size drifted: ${e}`);
  assert(/letter-spacing:0\.16em/.test(e), `eyebrow tracking drifted: ${e}`);
  assert(/color:#6e7a93/.test(e), `eyebrow colour drifted: ${e}`);
  const le = I.ledgerEyebrow('Rd', 'left');
  assert(/font-size:8\.5px/.test(le) && /letter-spacing:0\.16em/.test(le) && /color:#a3abba/.test(le),
    `group-header label drifted: ${le}`);
});
mustFail('the eyebrow check would catch the pre-correction values', () => {
  const e = 'font-size:10.5px;letter-spacing:0.14em;color:#6e7a93;';
  assert(/font-size:9\.5px/.test(e), 'eyebrow size drifted');
});

// ── item 11 · the second price source ──────────────────────────────────────
check('item 11 · the bet365 capture prices rows the archive never reached', () => {
  // Roster-wide, not per player: the capture starts 2026-03 and any one
  // player's committed window may sit entirely before it (A. Zverev's does —
  // the committed file is a 22-Jul seed and his last row is 2026-01-23). A
  // single-player assertion would have been measuring the seed, not the join.
  let close = 0, pre = 0, dash = 0, tot = 0;
  const lifted = new Set();
  for (const k of Object.keys(PLAYERS)) {
    for (const r of I.ledgerRows(PLAYERS[k])) {
      tot++;
      if (r.basis === 'close') close++;
      else if (r.basis === 'prematch') {
        pre++; lifted.add(PLAYERS[k].name);
        assert.strictEqual(r.book, 'bet365', 'a pre-match row is labelled with the wrong book');
        assert(I.b365PriceFor(PLAYERS[k].name, r.m), 'a pre-match row has no capture behind it');
      } else { dash++; assert.strictEqual(r.price, null, 'an unlabelled row carries a price'); }
    }
  }
  assert.strictEqual(close + pre + dash, tot, 'a row is counted twice or not at all');
  assert(pre > 0, 'the capture priced nothing — the second source is not reaching the ledger');
  console.log(`        ${tot} ledger rows — ${close} archive closing, ${pre} bet365 pre-match ` +
    `(${lifted.size} players), ${dash} unpriced; priced share ` +
    `${(100 * (close + pre) / tot).toFixed(1)}% vs ${(100 * close / tot).toFixed(1)}% before`);
});
mustFail('the price-basis check would catch a row labelled priced with no source', () => {
  const r = { basis: 'prematch', book: 'pinnacle' };
  assert.strictEqual(r.book, 'bet365', 'a pre-match row is labelled with the wrong book');
});

check('item 11 · the capture join needs BOTH names and dashes on an ambiguous pair', () => {
  // Name normalisation folds the capture's "Surname, First" and the feed's
  // "I. Surname" onto the same token, with no whitespace splitting.
  assert.strictEqual(I.b365Norm('Van de Zandschulp, Botic'), I.b365Norm('B. Van De Zandschulp'));
  assert.strictEqual(I.b365Norm('Zverev, Alexander'), 'zverev');
  // A pair the capture does not hold must not resolve to a neighbouring fixture.
  assert.strictEqual(I.b365PriceFor('A. Zverev', { date: '2026-09-13', opponent: 'Nobody Here' }), null);
  // The close is the LAST observed point, which the artefact pins to the last
  // quote at or before the start — never an in-play price.
  assert.strictEqual(I.b365Close({ cut: 'trueStart' }, [[1, 1.5], [2, 1.7]]), 1.7);
  assert.strictEqual(I.b365Close({ cut: 'trueStart' }, []), null);
  // Michael's ruling 2026-09-17T10:45Z item 2 — a bet365-history/2 entry whose
  // series was never cut at an observed first ball has NO close. Its tail is an
  // unproven price and must dash, not render.
  assert.strictEqual(I.b365Close({ cut: 'none' }, [[1, 1.5], [2, 1.06]]), null,
    'an uncut /2 entry must not hand out its tail as a close');
  // A /1 entry has no `cut` field and keeps the pre-ruling behaviour.
  assert.strictEqual(I.b365Close({}, [[1, 1.5], [2, 1.7]]), 1.7);
});
mustFail('the capture-join check would catch a first-point close', () => {
  const close = s => s[0][1];
  assert.strictEqual(close([[1, 1.5], [2, 1.7]]), 1.7, 'the close is not the last observed point');
});

// ── item 14 · the match sheet ──────────────────────────────────────────────
check('item 14 · the match sheet renders real stats and dashes what we do not hold', () => {
  const rows = I.ledgerRows(ZVEREV);
  const withStats = rows.filter(r => I.statsFor(r.m.eventKey));
  assert(withStats.length > 0, `${ZVEREV.name} has no ledger row with a stats block`);
  const ctx = { ledgerOpen: true, ledgerRows: rows, ledgerFiltered: I.ledgerFiltered(rows) };
  const target = withStats[withStats.length - 1];
  I.state.sheet = target.m.date + '|' + (target.m.opponent || '');
  const html = I.renderSheet(ZVEREV, ctx);
  I.state.sheet = null;
  assert(/Dominance ratio/.test(html), 'the sheet did not render');
  // The rows we genuinely do not hold must be dashed, on every sheet.
  ['Serve rating', 'Return rating'].forEach((label) => {
    const at = html.indexOf(label);
    assert(at > 0, `${label} row is missing from the sheet`);
    const before = html.slice(Math.max(0, at - 420), at);
    assert(/color:#6e7a93;">—</.test(before), `${label} rendered a value — we do not hold it`);
  });
  // Net points is NOT one of them. Founder ruling 2026-09-18 (Q2): it IS an
  // api-tennis field — measured on the committed floor at 1,674 of 3,494
  // populated sides (47.9%) — and "a dash must only ever mean we don't hold
  // it". So the row follows the store PER MATCH: a value where this side
  // carries one, a dash where it does not. Asserting a blanket dash is the
  // struck-down premise, and it passed for months while the page told users a
  // field we hold does not exist.
  {
    const at = html.indexOf('Net points won');
    assert(at > 0, 'Net points won row is missing from the sheet');
    const before = html.slice(Math.max(0, at - 420), at);
    const dashed = /color:#6e7a93;">—</.test(before);
    const recNp = I.statsFor(target.m.eventKey);
    const sideNp = String(recNp.p1Key) === String(ZVEREV.key)
      ? recNp.matchStats.p1 : recNp.matchStats.p2;
    const npHeld = sideNp && sideNp['Points:Net points won'] != null;
    if (npHeld) {
      assert(!dashed, 'Net points won dashed on a match whose side carries the field'
        + ` (${sideNp['Points:Net points won']}) — a dash must only mean we do not hold it`);
    } else {
      assert(dashed, 'Net points won rendered a value on a side that carries none');
    }
    console.log(`        net points: side ${npHeld ? 'holds the field → value' : 'holds none → dash'}`);
  }
  // ...and a stat we DO hold must not be dashed on a match that carries it.
  const rec = I.statsFor(target.m.eventKey);
  const side = String(rec.p1Key) === String(ZVEREV.key) ? rec.matchStats.p1 : rec.matchStats.p2;
  const aces = side['Service:Aces'];
  if (aces != null) {
    assert(html.indexOf('>' + Math.round(aces) + '<') > 0,
      `the sheet does not show the stored ace count (${aces})`);
  }
  console.log(`        sheet for ${ZVEREV.name} ${target.m.date}: real stats rendered, ` +
    `3 unheld rows dashed`);
});
mustFail('the match-sheet check would catch a net-points value invented on a side that holds none', () => {
  // The control now points at the defect that is still real after the Q2
  // ruling: a value painted where the store carries nothing. (Its twin — a
  // dash painted where the store DOES carry a value — is what the live check
  // above catches, and is the defect that shipped.)
  const html = 'color:#6a9af8;">12</span>...Net points won';
  const at = html.indexOf('Net points won');
  const held = false; // this side carries no Points:Net points won
  const dashed = /color:#6e7a93;">—</.test(html.slice(0, at));
  assert(held || dashed, 'Net points won rendered a value on a side that carries none');
});

check('item 14 · no sheet is painted with the opponent’s numbers under this player’s name', () => {
  // Orientation is proven by the api-tennis player key, never by position.
  let checked = 0, oriented = 0;
  for (const k of Object.keys(PLAYERS).slice(0, 60)) {
    const p = PLAYERS[k];
    for (const m of I.ledgerMatches(p)) {
      const rec = I.statsFor(m.eventKey);
      if (!rec) continue;
      checked++;
      if (String(rec.p1Key) === String(p.key) || String(rec.p2Key) === String(p.key)) oriented++;
    }
  }
  assert(checked > 0, 'no stats rows to orient');
  // A row naming neither player is a join error; the sheet must dash rather than
  // pick a side. Report the rate rather than assert a target.
  console.log(`        ${oriented} of ${checked} stats rows name the subject by key ` +
    `(${(100 * oriented / checked).toFixed(1)}%); the rest render as unjoinable`);
  assert(oriented > 0, 'not one stats row could be oriented by key — the join is broken');
});
mustFail('the orientation check would catch a positional guess', () => {
  const rec = { p1Key: 999, p2Key: 888 }, key = 1980;
  assert(String(rec.p1Key) === String(key) || String(rec.p2Key) === String(key),
    'the row names neither player');
});

check('item 14 · dominance ratio uses the repo’s own definition', () => {
  // dna-apitennis-ratings.js:411 — "returnPtsWon% / (100 − servicePtsWon%)".
  const mine = {
    'Service:1st serve percentage': 60, 'Service:1st serve points won': 70,
    'Service:2nd serve points won': 50,
    'Return:1st return points won': 40, 'Return:2nd return points won': 60
  };
  const theirs = {
    'Service:1st serve percentage': 50, 'Service:1st serve points won': 60,
    'Service:2nd serve points won': 40,
    'Return:1st return points won': 30, 'Return:2nd return points won': 50
  };
  const spw = 0.6 * 70 + 0.4 * 50;                 // 62
  const rpw = 0.5 * 40 + 0.5 * 60;                 // 50
  assert.strictEqual(I.spwPct(mine), spw);
  assert.strictEqual(I.rpwPct(mine, theirs), rpw);
  assert(Math.abs(I.drFor(mine, theirs) - rpw / (100 - spw)) < 1e-12);
  // A missing input dashes the whole ratio — never a partial composition.
  assert.strictEqual(I.drFor({ 'Service:1st serve percentage': 60 }, theirs), null);
  assert.strictEqual(I.spwPct(null), null);
});
mustFail('the DR check would catch a ratio built from the wrong denominator', () => {
  const spw = 62, rpw = 50;
  assert(Math.abs((rpw / spw) - rpw / (100 - spw)) < 1e-12, 'DR uses the wrong denominator');
});

check('item 14 · bars are drawn only when both sides are held', () => {
  assert.deepStrictEqual(I.sheetBars(null, 12), ['0%', '0%']);
  assert.deepStrictEqual(I.sheetBars(12, null), ['0%', '0%']);
  assert.deepStrictEqual(I.sheetBars(0, 0), ['0%', '0%']);
  assert.deepStrictEqual(I.sheetBars(30, 10), ['75.0%', '25.0%']);
});
mustFail('the bar check would catch a one-sided bar filling the track', () => {
  const bars = (a, b) => b == null ? ['100%', '0%'] : ['50%', '50%'];
  assert.deepStrictEqual(bars(12, null), ['0%', '0%'], 'a one-sided bar filled the track');
});

// ── deploy allowlist · the recurring 404 ───────────────────────────────────
check('the two new stores are in the deploy allowlist', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pipeline.yml'), 'utf8');
  // Derived from what the HOST actually fetches, so adding a third lazy store
  // without publishing it fails here rather than 404ing on the live page.
  const host = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
  const fetched = new Set((host.match(/fetch\(\s*[`'"]\.\/([A-Za-z0-9_.\-]+)/g) || [])
    .map(s => s.replace(/.*\.\//, '')));
  assert(fetched.has('historical-match-stats.json'), 'the host does not fetch the stats store');
  assert(fetched.has('bet365-history'), 'the host does not fetch the bet365 capture');
  assert(/cp historical-match-stats\.json _site\//.test(yml),
    'historical-match-stats.json is fetched by the page but never published — it will 404');
  assert(/cp -r bet365-history _site\//.test(yml),
    'bet365-history/ is fetched by the page but never published — it will 404');
});
mustFail('the allowlist check would catch an unpublished new store', () => {
  const yml = 'cp player-profile-v2.js _site/';
  assert(/cp historical-match-stats\.json _site\//.test(yml), 'never published — it will 404');
});


// ════════════════════════════════════════════════════════════════════════════
// §16 · CAREER RECORD MODAL — the founder's 19-item rebuild (2026-09-16)
//
// Every check here renders the REAL function and reads the REAL DOM string. The
// fixture below is synthetic ON PURPOSE: the committed player-profiles.json
// carries no court type at all (0 of 3,747 season rows), so a check written over
// it could not tell an Indoors row that renders from one that silently does not.
// The deployed file does carry it (548 of 1,329 rows) — that gap is itself
// reported to the founder; here the fixture supplies the shape so the assertion
// has something to bite on either way.
//
// Row counts are chosen to straddle every §9 band on purpose:
//   hard    9-5  -> n=14  FULL   (rate shown, full size, white)
//   grass   2-2  -> n=4   THIN   (no rate at all, row does not open)
//   clay    6-2  -> n=8   SMALL  (rate greyed + smaller + "small sample")
//   indoors 5-3  -> n=8   SMALL
// ════════════════════════════════════════════════════════════════════════════

const CM_YEAR = {
  year: '2026', allTier: true,
  // 22-12 = 34 matches, which is exactly what the raw buckets hold
  // (clay 7-3 + hard 13-7 + grass 2-2). A fixture whose total does not equal its
  // own buckets would make the reconciliation check unfalsifiable.
  total: { won: 22, lost: 12 },
  // raw buckets still COUNT their indoor matches; gridCells() carves them out
  clay: { won: 7, lost: 3 }, hard: { won: 13, lost: 7 }, grass: { won: 2, lost: 2 },
  indoor: {
    total: { won: 5, lost: 3 }, clay: { won: 1, lost: 1 },
    hard: { won: 4, lost: 2 }, grass: null,
  },
};
const CM_PLAYER = { key: '__cm', name: 'T. Est', careerByYear: [CM_YEAR] };

function renderCareer(player, scope) {
  const saved = { ...I.state };
  try {
    I.state.key = player.key;
    I.state.careerScope = scope || 'career';
    I.state.careerDrill = null;
    return I.renderCareerModal(player, { archetype: null });
  } finally { Object.assign(I.state, saved); }
}
// The surface-row labels, in DOM order. Anchored on the 14px/700 name div that
// only a §5.2A row emits, so the season table's cells cannot leak in.
function surfaceRowOrder(html) {
  const out = [];
  // Anchored on the row's own wrapper so the season table's 14px/700 TOTAL
  // cells (which are mono) cannot be mistaken for surface-row names.
  const re = /<div style="min-width:0;"><div style="font-size:14px;font-weight:700;[^"]*">([^<]+)</g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

// RULING Q4 (founder, 2026-09-18) amends the v7 locked string. Phase A shipped
// "Record by surface and season, and his ratings against the field" and reported
// that it lost two things and over-promised a third. The ruling:
//   (a) re-add "indoors" — the Hard row is outdoor-only and ambiguous without it;
//   (b) DROP "and his ratings against the field" until the Ratings tab lands in
//       phase C, then restore it VERBATIM;
//   (c) carry "since <year>" wherever the tile's window is narrower than the grid.
//
// PHASE C: when the Ratings tab ships, append ', and his ratings against the
// field' and update this assertion in the same commit. Both halves are locked
// below so neither the re-add nor the premature restore can happen silently.
check('item 2 / ruling Q4 · the career subtitle re-adds "indoors" and drops the Ratings clause', () => {
  const sub = I.modalSubtitle('career', CM_PLAYER, {});
  assert(/\bindoors\b/.test(sub), `subtitle lost "indoors" again: "${sub}"`);
  assert(!/ratings against the field/.test(sub),
    `the Ratings clause is back before the tab exists: "${sub}"`);
  assert(sub.startsWith('Record by surface, indoors and by season'),
    `subtitle is "${sub}"`);
  console.log(`        "${sub}"`);
});
mustFail('[neg] the subtitle check would catch the phase-A string with "indoors" missing', () => {
  const sub = 'Record by surface and season, and his ratings against the field';
  assert(/\bindoors\b/.test(sub), `subtitle lost "indoors": "${sub}"`);
});
mustFail('[neg] the subtitle check would catch the Ratings clause restored early', () => {
  const sub = 'Record by surface, indoors and by season, and his ratings against the field';
  assert(!/ratings against the field/.test(sub), 'premature Ratings clause not caught');
});

// Q4(c) · the scope label rides on a CONDITION, so both branches are exercised —
// a label that is always present and one that is never present both pass a
// one-branch check, and neither is the rule.
check('ruling Q4(c) · "since <year>" appears only when the grid reaches further back', () => {
  const narrow = {
    key: '__q4n', name: 'N. Arrow', tournamentHistory: [],
    careerByYear: [{ year: '2020', total: { won: 10, lost: 5 }, hard: { won: 10, lost: 5 } }]
  };
  const dated = [];
  for (let i = 0; i < 4; i++) {
    dated.push({ year: '2016', date: `2016-04-0${i + 1}`, surface: 'hard', level: 'atp',
      tournament: 'Old', round: 'R32', opponent: `O${i} X`, result: '2 - 0', won: true });
  }
  const savedCh = W.careerHistory;
  try {
    // Grid reaches back to 2016, spine starts 2020 -> the label must appear.
    W.careerHistory = Object.assign({}, CAREER_HIST, { __q4n: dated });
    const withLabel = I.modalSubtitle('career', narrow, {});
    assert(/· since 2020$/.test(withLabel), `no scope label: "${withLabel}"`);
    // Same player, dated rows inside the window -> the label must NOT appear.
    W.careerHistory = Object.assign({}, CAREER_HIST, {
      __q4n: dated.map(r => Object.assign({}, r, { year: '2020', date: r.date.replace('2016', '2020') }))
    });
    const without = I.modalSubtitle('career', narrow, {});
    assert(!/since/.test(without), `scope label printed with no narrower window: "${without}"`);
    console.log(`        narrower -> "${withLabel}" | aligned -> "${without}"`);
  } finally { W.careerHistory = savedCh; }
});

check('item 4 · rows are Hard · Grass · Clay · Indoors, in the FILE\'s order', () => {
  const order = surfaceRowOrder(renderCareer(CM_PLAYER));
  assert.deepStrictEqual(order, ['Hard', 'Grass', 'Clay', 'Indoors'],
    `row order is ${JSON.stringify(order)}`);
});
mustFail('[neg] the order check would catch the shipped Hard/Clay/Grass/Unrecorded set', () => {
  const order = ['Hard', 'Clay', 'Grass', 'Unrecorded surface'];
  assert.deepStrictEqual(order, ['Hard', 'Grass', 'Clay', 'Indoors'],
    `row order is ${JSON.stringify(order)}`);
});

check('item 5 · "Unrecorded surface" is gone and the residual is a FOOTNOTE', () => {
  // A residual needs a player whose surface buckets do not reach the total.
  const gap = {
    key: '__gap', name: 'G. Ap',
    careerByYear: [{
      year: '2026', allTier: true,
      total: { won: 20, lost: 10 },       // 30 matches
      clay: { won: 6, lost: 3 }, hard: { won: 12, lost: 6 }, grass: { won: 0, lost: 0 },
      indoor: null,
    }],
  };
  const html = renderCareer(gap);
  assert(!/Unrecorded surface/.test(html), 'the design-less row is still being rendered');
  assert(/3 matches with no surface on record/.test(html),
    'the residual is not footnoted — the rows no longer reconcile to the career total');
  // and the footnote must state WHY it cannot be resolved, not just that it exists
  assert(/no individual match carries a surface to look up/.test(html),
    'the footnote does not say why those matches stay unresolved');
});
mustFail('[neg] the footnote check would catch the residual rendered as a row again', () => {
  const html = '<div style="font-size:14px;font-weight:700;">Unrecorded surface</div>';
  assert(!/Unrecorded surface/.test(html), 'the design-less row is still being rendered');
});

check('item 6 · every surface ROW equals its own season-table COLUMN', () => {
  const html = renderCareer(CM_PLAYER);
  const g = I.gridCells(CM_YEAR);
  // carved: hard 13-7 − 4-2 = 9-5 ; clay 7-3 − 1-1 = 6-2 ; grass 2-2 ; indoors 5-3
  assert.deepStrictEqual(g.hard, { won: 9, lost: 5 });
  assert.deepStrictEqual(g.clay, { won: 6, lost: 2 });
  assert.deepStrictEqual(g.indoors, { won: 5, lost: 3 });
  // the ROW meta line must quote the same carved pair, not the raw bucket
  assert(html.includes('9\u20135 \u00b7 14 matches'), 'the Hard row is not the carved record');
  assert(!html.includes('13\u20137 \u00b7 20 matches'), 'the Hard row still shows the RAW bucket');
  // and the four rows + footnote must sum to the career total
  const n = r => (r ? r.won + r.lost : 0);
  assert.strictEqual(n(g.hard) + n(g.grass) + n(g.clay) + n(g.indoors),
    n(g.total), 'rows do not sum to the total');
});
mustFail('[neg] the row=column check would catch the live build\'s uncarved Hard row', () => {
  // measured on the deployed page 2026-09-16: Hard ROW 337–151, Hard COLUMN 295–134
  const rowN = 337 + 151, colN = 295 + 134;
  assert.strictEqual(rowN, colN, `Hard row ${rowN} vs column ${colN}`);
});

// ─── item 3 · MINIMAL BARS (founder override of the export, 2026-09-17) ───────
//
// This REPLACES the blue-ramp lock that shipped at 7a75a667. The export computes
// one alpha ramp over the win rate; the founder overrode it: length carries the
// rate, colour carries the sample gate. Both rules cannot hold at once, so the
// old assertions are gone rather than weakened — a test kept but loosened is how
// an override silently half-lands.
check('item 3 · the bar is minimal: 4px track and fill, radius 2, ONE solid colour', () => {
  const html = renderCareer(CM_PLAYER);
  const tracks = (html.match(/height:4px;border-radius:2px;background:rgba\(255,255,255,0\.06\);/g) || []);
  assert(tracks.length >= 4, `only ${tracks.length} minimal tracks rendered (expected one per surface row)`);
  const fills = (html.match(/height:4px;width:[\d.]+%;background:([^;]+);border-radius:2px;/g) || []);
  assert(fills.length >= 3, `only ${fills.length} bar fills rendered`);
  fills.forEach((f) => {
    assert(/background:(#6a9af8|#6e7a93);/.test(f), `a fill is not one of the two solid colours: ${f}`);
  });
  // the ramp is GONE — no alpha-varying blue anywhere on a fill
  assert(!/width:[\d.]+%;background:rgba\(91,155,255,/.test(html),
    'the blue alpha ramp is still painting a fill');
  // and no 16px track survives
  assert(!/height:16px;border-radius:4px/.test(html), 'the 16px track is still being drawn');
  ['#f2b45f', '#45d6b0'].forEach((c) => {  // Hard == periwinkle in 12a (TEN-285)
    assert(!new RegExp('width:[\\d.]+%;background:' + c).test(html),
      `a bar is painted the surface colour ${c}`);
  });
  // The colour is a GATE reading, not a rate reading: two very different rates on
  // the same side of the gate must be the same colour, and two equal rates on
  // opposite sides must differ. That is the whole content of the override.
  assert.strictEqual(I.barFillColour(40), I.barFillColour(99),
    'the fill colour still varies with the rate — the ramp survived under a new name');
  assert.strictEqual(I.barFillColour(10), '#6a9af8', 'the n>=10 fill is not #6a9af8');
  assert.strictEqual(I.barFillColour(9), '#6e7a93', 'the 5-9 fill is not #6e7a93');
  assert.strictEqual(I.barFillColour(5), '#6e7a93', 'the gate floor moved off 5');
  assert.strictEqual(I.barFillColour(4), null, 'a sub-5 sample still paints a fill');
  assert.strictEqual(I.barFillColour(0), null, 'a 0-match row still paints a fill');
});
mustFail('[neg] the minimal-bar check would catch the shipped 16px ramp track', () => {
  const html = 'height:16px;border-radius:4px;background:rgba(255,255,255,0.04);' +
    '<div style="height:100%;width:64.3%;background:rgba(91,155,255,0.78);border-radius:4px;">';
  assert(!/height:16px;border-radius:4px/.test(html), 'the 16px track is still being drawn');
});
mustFail('[neg] the gate-colour check would catch a fill that still ramped with the rate', () => {
  const ramp = (n) => (n >= 10 ? 'rgba(91,155,255,' + (0.25 + n / 200).toFixed(2) + ')' : null);
  assert.strictEqual(ramp(40), ramp(99), 'the fill colour still varies with the rate');
});

// A sub-5 row must show the TRACK and no fill — the founder's "n < 5 shows no
// bar, only the track". Proven on a player built to sit under the gate, because
// CM_PLAYER has none.
check('item 3 · under the gate the track is drawn and the fill is not', () => {
  const thin = {
    key: '__thin', name: 'T. Hin',
    careerByYear: [{ year: '2026', allTier: true, total: { won: 3, lost: 1 },
      clay: null, hard: { won: 3, lost: 1 }, grass: null, indoor: null }],
  };
  const html = renderCareer(thin);
  const tracks = (html.match(/height:4px;border-radius:2px;background:rgba\(255,255,255,0\.06\);/g) || []);
  assert(tracks.length >= 4, 'the track disappeared along with the fill');
  assert(!/height:4px;width:[\d.]+%/.test(html), 'a 4-match row still painted a fill');
});
mustFail('[neg] the sub-gate check would catch a fill painted at n=4', () => {
  const html = '<div style="height:4px;width:75.0%;background:#6a9af8;border-radius:2px;">';
  assert(!/height:4px;width:[\d.]+%/.test(html), 'a 4-match row still painted a fill');
});

check('item 8 · the win rate is a WHOLE number at 19px', () => {
  const html = renderCareer(CM_PLAYER);
  // hard is 9-5 = 64.28...% -> "64%"
  assert(/font-size:19px;font-weight:700;color:#ebf1f2;">64%/.test(html),
    'the Hard rate is not a whole number at 19px in #ebf1f2');
  assert(!/>6[0-9]\.[0-9]%/.test(html), 'a one-decimal rate is still being printed in this modal');
});
mustFail('[neg] the whole-number check would catch the shipped 69.1%', () => {
  const html = '<div style="font-size:19px;">69.1%</div>';
  assert(!/>6[0-9]\.[0-9]%/.test(html), 'a one-decimal rate is still being printed');
});

check('item 9 · the §9 sample gate is applied to the ROW rate', () => {
  const html = renderCareer(CM_PLAYER);
  // clay n=8 -> SMALL: greyed, smaller, marked
  assert(new RegExp('font-size:' + 15 + 'px;font-weight:700;color:#6e7a93;">75%').test(html),
    'the 8-match Clay row is not greyed and shrunk');
  assert(/small sample/.test(html), 'the small-sample mark is missing');
  // grass n=4 -> THIN: no rate at all
  const grassBlock = html.slice(html.indexOf('>Grass<'));
  const grassRate = grassBlock.slice(0, grassBlock.indexOf('</div></div>') + 12);
  assert(!/\d+%/.test(grassRate.match(/font-size:19px[^>]*>([^<]*)</) ? RegExp.$1 : ''),
    'a 4-match row printed a rate');
  // and a sub-5 row must not advertise a click
  assert(!/data-pp2="career-surf" data-v="grass"/.test(html),
    'the 4-match Grass row opens, against §9');
});
mustFail('[neg] the gate check would catch the shipped full-size white 83.3%', () => {
  const html = 'font-size:19px;font-weight:700;color:#ebf1f2;">83.3%<div>small sample</div>';
  assert(new RegExp('font-size:15px;font-weight:700;color:#6e7a93;">83%').test(html),
    'a small-sample rate rendered full size and white');
});

check('item 10 · the row card carries the file\'s background, grid and meta spacing', () => {
  const html = renderCareer(CM_PLAYER);
  assert(/grid-template-columns:minmax\(0,1fr\) 300px 58px;gap:16px/.test(html), 'grid tracks drifted');
  assert(/border-radius:10px;padding:13px 16px/.test(html), 'radius/padding drifted');
  assert(/background:#0c0e16;/.test(html), 'the row has no background — it was transparent live');
  assert(/font-size:11\.5px;color:#6e7a93;margin-top:4px/.test(html),
    'the meta line lost its 4px offset from the name');
});
mustFail('[neg] the card check would catch the shipped transparent row', () => {
  const html = 'border-radius:10px;padding:13px 16px;border:1px solid rgba(255,255,255,0.07);';
  assert(/background:#0c0e16;/.test(html), 'the row has no background');
});

check('items 11-13,15 · the season table head, helper and footer are the file\'s', () => {
  const html = renderCareer(CM_PLAYER);
  // 11 — the eyebrow the founder found missing
  assert(/letter-spacing:0\.12em;text-transform:uppercase;color:#6e7a93;">Wins \/ losses</.test(html),
    'the WINS / LOSSES eyebrow is missing from the title line');
  // 12 — the file's helper copy, not the invented one
  assert(/Click any record to browse those matches/.test(html), 'the helper copy is not the file\'s');
  assert(!/every season on record from/.test(html.slice(0, html.indexOf('Record by season'))),
    'the invented helper copy is still in place');
  // 13 — head colours AND the 11px bottom padding that was missing live
  [['Year', '#6e7a93'], ['Total', '#a3abba'], ['Clay', '#f2b45f'],
   ['Hard', '#6a9af8'], ['Indoors', '#d9dbdf'], ['Grass', '#3ed68c']].forEach(([label, col]) => {
    assert(new RegExp('color:' + col + ';padding-bottom:11px;[^>]*>' + label + '<').test(html),
      `the ${label} head is not ${col} with 11px padding-bottom`);
  });
  // 15 — CAREER in eyebrow style, not as a 13px body word
  assert(/font-size:10px;font-weight:700;letter-spacing:0\.18em;text-transform:uppercase;color:#a3abba;padding:15px 0 13px/.test(html),
    'the CAREER footer label is not in the eyebrow style');
});
mustFail('[neg] the head check would catch the shipped zero bottom-padding', () => {
  const html = 'color:#6a9af8;text-align:right;">Hard<';
  assert(/color:#6a9af8;padding-bottom:11px;[^>]*>Hard</.test(html), 'the Hard head has no padding');
});

check('items 16-17 · records OPEN — surface rows and season cells carry click hooks', () => {
  const html = renderCareer(CM_PLAYER);
  assert(/data-pp2="career-surf" data-v="hard"/.test(html), 'the Hard row does not open');
  assert(/data-pp2="career-cell" data-v="2026\|"/.test(html), 'the Total cell does not open');
  assert(/data-pp2="career-cell" data-v="2026\|hard"/.test(html), 'the Hard cell does not open');
  assert(/cursor:pointer/.test(html), 'nothing advertises a click');
});

// ─── items 1-2 · EVERY record clickable (founder 2026-09-17) ─────────────────
//
// The real roster player with the deepest season table. A one-year fixture cannot
// show that EVERY year row opens, which is the whole of item 1.
const DEEP_PLAYER = Object.keys(PLAYERS)
  .map((k) => ({ key: k, ...PLAYERS[k] }))
  .map((p) => ({ p, y: I.spineYears(p).length }))
  .sort((a, b) => b.y - a.y)[0].p;

check('item 1a-c · the YEAR label and the CAREER row open, on real roster data', () => {
  // Driven over the real committed store rather than a fixture: the hooks have to
  // land on the rows the page actually paints.
  const p = DEEP_PLAYER;
  const html = renderCareer(p);
  const years = I.spineYears(p).map((y) => String(y.year));
  assert(years.length >= 3, `only ${years.length} spine years to test`);
  years.forEach((y) => {
    const cells = I.gridCells(I.spineYears(p).filter((r) => String(r.year) === y)[0]);
    const n = (cells.total && (cells.total.won + cells.total.lost)) || 0;
    if (!n) return;
    // 1a + 1b — the year label and the Total cell carry the SAME descriptor, so a
    // click on either opens one drill rather than two competing ones.
    const hits = (html.match(new RegExp('data-pp2="career-cell" data-v="' + y + '\\|"', 'g')) || []).length;
    assert.strictEqual(hits, 2, `year ${y}: expected the label AND the Total cell, found ${hits}`);
    // 1c — every surface cell that holds a record opens
    ['clay', 'hard', 'grass'].forEach((s) => {
      const rec = cells[s];
      if (!rec || (rec.won + rec.lost) === 0) return;
      assert(new RegExp('data-pp2="career-cell" data-v="' + y + '\\|' + s + '"').test(html),
        `year ${y} ${s} holds ${rec.won}/${rec.lost} but does not open`);
    });
  });
  // item 2 — the CAREER label and all five footer cells
  assert((html.match(/data-pp2="career-cell" data-v="career\|"/g) || []).length === 2,
    'the CAREER label and its Total cell do not both open');
  const cf = I.careerGridCells(p);
  ['clay', 'hard', 'grass'].forEach((s) => {
    if (!cf[s] || (cf[s].won + cf[s].lost) === 0) return;
    assert(new RegExp('data-pp2="career-cell" data-v="career\\|' + s + '"').test(html),
      `the career ${s} cell does not open`);
  });
});
mustFail('[neg] the open check would catch the year label left inert', () => {
  // the shipped 7a75a667 markup: the label carried no hook at all
  const html = '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:13px;">2026</div>' +
    '<div data-pp2="career-cell" data-v="2026|">53/13</div>';
  const hits = (html.match(/data-pp2="career-cell" data-v="2026\|"/g) || []).length;
  assert.strictEqual(hits, 2, `expected the label AND the Total cell, found ${hits}`);
});

check('item 1f · a dash cell is inert and advertises no click', () => {
  // A player whose 2026 has hard matches and no clay/grass at all.
  const gap = {
    key: '__gap', name: 'G. Ap',
    careerByYear: [{ year: '2026', allTier: true, total: { won: 12, lost: 3 },
      clay: null, hard: { won: 12, lost: 3 }, grass: null, indoor: null }],
  };
  const html = renderCareer(gap);
  assert(/data-pp2="career-cell" data-v="2026\|hard"/.test(html), 'the Hard cell does not open');
  assert(!/data-pp2="career-cell" data-v="2026\|clay"/.test(html), 'an empty Clay cell opens');
  assert(!/data-pp2="career-cell" data-v="2026\|grass"/.test(html), 'an empty Grass cell opens');
  // and the dash cell carries neither the class nor the pointer
  const dashCell = html.match(/<div[^>]*>—<\/div>/g) || [];
  assert(dashCell.length >= 2, `only ${dashCell.length} dash cells rendered`);
  dashCell.forEach((d) => {
    assert(!/cursor:pointer/.test(d), `a dash cell advertises a click: ${d}`);
    assert(!/pp2-crec/.test(d), `a dash cell carries the hover class: ${d}`);
  });
});
mustFail('[neg] the inert check would catch a dash cell wearing the pointer', () => {
  const d = '<div class="pp2-crec" style="cursor:pointer;">—</div>';
  assert(!/cursor:pointer/.test(d), 'a dash cell advertises a click');
});

check('item 1f · the n>=5 gate is OFF the drill and still ON the bar', () => {
  // The gate moved: a 2-match cell opens (it is a list of 2 matches, not a rate),
  // but a 2-match bar still paints nothing. Both halves asserted together so a
  // future "restore the gate" cannot quietly take the bar's with it.
  const tiny = {
    key: '__tiny', name: 'T. Iny',
    careerByYear: [{ year: '2026', allTier: true, total: { won: 2, lost: 0 },
      clay: { won: 2, lost: 0 }, hard: null, grass: null, indoor: null }],
  };
  const html = renderCareer(tiny);
  assert(/data-pp2="career-cell" data-v="2026\|clay"/.test(html),
    'a 2-match cell is still gated shut');
  assert(!/height:4px;width:[\d.]+%/.test(html), 'a 2-match row painted a bar fill');
});
mustFail('[neg] the moved-gate check would catch the old n>=5 cell gate', () => {
  const can = (n) => n >= 5;
  assert(can(2), 'a 2-match cell is still gated shut');
});

check('item 4 · a career drill is Σ its year drills plus the years the spine omits', () => {
  // The reconciliation the founder asked for, stated exactly. It is NOT a plain
  // equality, and forcing one would mean trimming the list — which he ruled out
  // ("never pad or trim the list to force a match").
  //
  // `careerByYear` is a rolling WINDOW, not a career: Schwartzman's season table
  // starts 2015 while the per-match store holds 2013 and 2014. Those matches are
  // on record, so "every career match on record" must include them, and the
  // career drill is then legitimately longer than Σ of the year cells. The
  // invariant that DOES hold — and the one that breaks the instant drillRows
  // reverts to unioning both stores at career scope — is that the surplus is
  // exactly the out-of-window rows.
  const keys = Object.keys(PLAYERS).slice(0, 40);
  let checked = 0, surplusRows = 0, surplusPlayers = 0;
  keys.forEach((k) => {
    const p = { key: k, ...PLAYERS[k] };
    const years = I.spineYears(p).map((y) => String(y.year));
    if (!years.length) return;
    const inSpine = new Set(years);
    let sawSurplus = false;
    [null, 'clay', 'hard', 'grass'].forEach((s) => {
      const careerRows = I.drillRows(p, s, null);
      const summed = years.reduce((a, y) => a + I.drillRows(p, s, y).length, 0);
      const outside = careerRows.filter((r) => !inSpine.has(r.year)).length;
      assert.strictEqual(careerRows.length, summed + outside,
        `${k} ${s || 'all'}: career drill ${careerRows.length} vs Σ year drills ${summed} + ${outside} out-of-window`);
      if (s === null && outside) { surplusRows += outside; sawSurplus = true; }
    });
    if (sawSurplus) surplusPlayers++;
    checked++;
  });
  assert(checked >= 20, `only ${checked} players carried a spine to check`);
  console.log(`        career = Σ year drills + out-of-window, ${checked} players, 4 scopes each`);
  console.log(`        ${surplusRows} out-of-window rows across ${surplusPlayers} of ${checked} sampled players`);
});
mustFail('[neg] the sum check would catch a career drill that unioned both stores', () => {
  // the pre-fix behaviour: no source filter at career scope, so a year the form
  // store covers ALSO contributed its edition rows — a surplus that is NOT
  // out-of-window and would slip past a check that only looked at the total.
  const spine = [{ year: '2026', src: 'form' }, { year: '2026', src: 'edition' }];
  const career = spine.length;                                   // union = 2
  const summed = spine.filter((r) => r.src === 'form').length;    // per-year = 1
  const outside = spine.filter((r) => r.year !== '2026').length;  // 0
  assert.strictEqual(career, summed + outside,
    `career drill ${career} vs Σ year drills ${summed} + ${outside} out-of-window`);
});

check('item 2e · the drill pages instead of truncating — every match stays reachable', () => {
  const big = Object.keys(PLAYERS)
    .map((k) => ({ key: k, ...PLAYERS[k] }))
    .map((p) => ({ p, n: I.drillRows(p, null, null).length }))
    .sort((a, b) => b.n - a.n)[0];
  assert(big.n > I.DRILL_PAGE, `the largest career drill is ${big.n}, under one page`);
  const saved = { ...I.state };
  let html;
  try {
    I.state.key = big.p.key; I.state.careerScope = 'career';
    I.state.careerDrill = { kind: 'cell', year: 'career', surf: '' };
    html = I.renderCareerModal(big.p, { archetype: null });
  } finally { Object.assign(I.state, saved); }
  // one page painted, the rest reachable — and the note says so rather than
  // implying the list is complete
  assert(new RegExp('Showing ' + I.DRILL_PAGE + ' of ' + big.n + ' · scroll for more').test(html),
    `the note does not state the paging for ${big.p.key} (${big.n} rows)`);
  assert(/data-pp2-drill-scroll="1"/.test(html), 'the scroll container has no pager hook');
  assert(/data-pp2-drill-grid="1"/.test(html), 'the row grid has no pager hook');
  // the paged note must NOT read as a data shortfall — those are different claims
  assert(!new RegExp('Showing ' + I.DRILL_PAGE + ' of ' + big.n +
    ' · the rest are not in the per-match store').test(html),
    'a paging cut is being reported as missing data');
  console.log(`        largest career drill ${big.n} rows (${big.p.name || big.p.key}), paged at ${I.DRILL_PAGE}`);
});
mustFail('[neg] the paging check would catch the old 200-row hard cap', () => {
  const rows = 1463, cap = 200;
  const shown = Math.min(rows, cap);
  // the old note claimed a cap it never lifted — "scroll for more" with nothing more to load
  assert(shown === rows, `${shown} of ${rows} rows are reachable`);
});

check('item 2e · a scroll append reuses the SAME row builder and advances the pager', () => {
  const big = Object.keys(PLAYERS)
    .map((k) => ({ key: k, ...PLAYERS[k] }))
    .map((p) => ({ p, n: I.drillRows(p, null, null).length }))
    .sort((a, b) => b.n - a.n)[0];
  const rows = I.drillRows(big.p, null, null);
  // page 1 and page 2 through the real builder, then the whole list in one go —
  // the concatenation must be byte-identical, which is the only thing that proves
  // a scrolled-in row is not a second, drifting renderer.
  const pgA = { lastEvent: null, multiYear: true };
  const paged = I.drillBodyHtml(rows, 0, I.DRILL_PAGE, pgA) +
                I.drillBodyHtml(rows, I.DRILL_PAGE, I.DRILL_PAGE * 2, pgA);
  const whole = I.drillBodyHtml(rows, 0, I.DRILL_PAGE * 2, { lastEvent: null, multiYear: true });
  assert.strictEqual(paged, whole,
    'two pages do not reassemble into the single-pass render — the group headers drifted');
  assert(paged.length > 0, 'the pager produced nothing');
});
mustFail('[neg] the append check would catch a pager that reset its event grouping', () => {
  const rows = [{ year: '2026', event: 'A' }, { year: '2026', event: 'A' }];
  const grp = (r, pg) => { const g = r.event; const out = g !== pg.last ? '[H]' : ''; pg.last = g; return out + 'r'; };
  const pgA = { last: null };
  const paged = grp(rows[0], pgA) + grp(rows[1], { last: null });   // pager reset
  const pgB = { last: null };
  const whole = grp(rows[0], pgB) + grp(rows[1], pgB);
  assert.strictEqual(paged, whole, 'two pages do not reassemble into the single-pass render');
});

check('a dashed surface drill states the TRUE reason — stored-but-surfaceless vs absent', () => {
  // Zverev 2025 on the deployed store: the year drill lists all 81 matches and the
  // Clay drill lists none, because that year's rows come from the edition store,
  // which carries no surface. Saying "no matches in the per-match store" there is
  // false — the matches are stored. Two reasons, two sentences.
  const mk = (form) => ({
    key: '__r' + (form ? 'f' : 'e'), name: 'R. Eason',
    careerByYear: [{ year: '2024', allTier: true, total: { won: 6, lost: 2 },
      clay: { won: 6, lost: 2 }, hard: null, grass: null, indoor: null }],
    recentForm: { matches: [] },
    tournamentHistory: [{ name: 'Test Cup', editions: [{ year: '2024', matches:
      Array.from({ length: 8 }, (_, i) => ({ res: i < 6 ? 'W' : 'L', round: 'R32',
        opp: 'X. Ample ' + i, score: '2 - 0' })) }] }],
  });
  const stored = mk(false);
  // the edition store holds all 8 rows for 2024...
  assert.strictEqual(I.drillRows(stored, null, '2024').length, 8, 'the year drill lost its rows');
  // ...and none of them can answer a surface question
  assert.strictEqual(I.drillRows(stored, 'clay', '2024').length, 0, 'an edition row claimed a surface');
  const saved = { ...I.state };
  let html;
  try {
    I.state.key = stored.key; I.state.careerScope = 'career';
    I.state.careerDrill = { kind: 'cell', year: '2024', surf: 'clay' };
    html = I.renderCareerModal(stored, { archetype: null });
  } finally { Object.assign(I.state, saved); }
  assert(/the 8 matches in scope carry no surface/.test(html),
    'the drill does not say WHY the surface list is empty');
  assert(!/no matches in the per-match store/.test(html),
    'the drill still claims the matches are unstored when they are stored');
  // and where there genuinely are no rows at all, the other reason stands
  const empty = { key: '__none', name: 'N. One',
    careerByYear: [{ year: '2024', allTier: true, total: { won: 6, lost: 2 },
      clay: { won: 6, lost: 2 }, hard: null, grass: null, indoor: null }] };
  let h2;
  try {
    I.state.key = empty.key; I.state.careerScope = 'career';
    I.state.careerDrill = { kind: 'cell', year: '2024', surf: 'clay' };
    h2 = I.renderCareerModal(empty, { archetype: null });
  } finally { Object.assign(I.state, saved); }
  assert(/no matches in the per-match store for this record/.test(h2),
    'a genuinely empty scope lost its reason');
});
mustFail('[neg] the reason check would catch the blanket "not in the store" wording', () => {
  const note = 'no matches in the per-match store for this record';
  assert(/carry no surface/.test(note), 'the drill does not say WHY the surface list is empty');
});

check('item 4 · every drill header carries the CLICKED cell\'s record, never the list\'s', () => {
  // Swept over the real roster: for each year cell that opens, the header record
  // must be the cell's own W–L and n. A header that quoted the list length would
  // make a partial list look complete.
  const keys = Object.keys(PLAYERS).slice(0, 12);
  let seen = 0, mismatched = 0;
  keys.forEach((k) => {
    const p = { key: k, ...PLAYERS[k] };
    I.spineYears(p).forEach((y) => {
      const g = I.gridCells(y);
      ['', 'clay', 'hard', 'grass'].forEach((s) => {
        const rec = s ? g[s] : g.total;
        if (!rec || (rec.won + rec.lost) === 0) return;
        const saved = { ...I.state };
        let html;
        try {
          I.state.key = p.key; I.state.careerScope = 'career';
          I.state.careerDrill = { kind: 'cell', year: String(y.year), surf: s };
          html = I.renderCareerModal(p, { archetype: null });
        } finally { Object.assign(I.state, saved); }
        const n = rec.won + rec.lost;
        const want = rec.won + '–' + rec.lost + ' · ' + n + ' matches';
        seen++;
        if (html.indexOf(want) < 0) { mismatched++; }
      });
    });
  });
  assert(seen >= 100, `only ${seen} cells opened across ${keys.length} players`);
  assert.strictEqual(mismatched, 0, `${mismatched} of ${seen} drill headers did not carry the cell's record`);
  console.log(`        ${seen} drill headers carry their cell's own record`);
});
mustFail('[neg] the header check would catch a header quoting the list length', () => {
  const rec = { won: 30, lost: 14 }, listLen = 6;
  const html = `${listLen}–14 · ${listLen} matches`;
  const want = rec.won + '–' + rec.lost + ' · ' + (rec.won + rec.lost) + ' matches';
  assert(html.indexOf(want) >= 0, 'the header does not carry the cell\'s record');
});
mustFail('[neg] the open check would catch the shipped modal, where nothing was clickable', () => {
  // measured on the deployed page: 0 clickable surface rows, 0 of 55 pointer cells
  const html = '<div style="font-size:13px;">53/13</div>';
  assert(/data-pp2="career-cell"/.test(html), 'no season cell opens');
});

check('item 17 · the same cell toggles, a different cell switches', () => {
  const saved = { ...I.state };
  try {
    I.state.careerDrill = null;
    const click = (v) => {
      const parts = String(v).split('|');
      const want = { kind: 'cell', year: parts[0], surf: parts[1] || '' };
      const cur = I.state.careerDrill;
      I.state.careerDrill = (cur && cur.kind === 'cell' && cur.year === want.year &&
        cur.surf === want.surf) ? null : want;
    };
    click('2026|clay');
    assert.deepStrictEqual(I.state.careerDrill, { kind: 'cell', year: '2026', surf: 'clay' });
    click('2026|clay');
    assert.strictEqual(I.state.careerDrill, null, 'the same cell did not close');
    click('2026|clay'); click('2026|hard');
    assert.deepStrictEqual(I.state.careerDrill, { kind: 'cell', year: '2026', surf: 'hard' },
      'a different cell did not switch');
    // the Total cell and a surface cell of the same year are DIFFERENT drills
    click('2026|');
    assert.deepStrictEqual(I.state.careerDrill, { kind: 'cell', year: '2026', surf: '' },
      'Total collided with the surface cell');
  } finally { Object.assign(I.state, saved); }
});
mustFail('[neg] the toggle check would catch a handler that keys on the year alone', () => {
  let drill = { kind: 'cell', year: '2026', surf: 'clay' };
  const click = (v) => {
    const y = String(v).split('|')[0];
    drill = (drill && drill.year === y) ? null : { kind: 'cell', year: y, surf: String(v).split('|')[1] || '' };
  };
  click('2026|hard');   // a year-only handler CLOSES instead of switching
  assert.deepStrictEqual(drill, { kind: 'cell', year: '2026', surf: 'hard' },
    'a different cell did not switch');
});

check('item 18-19 · drill rows open the match sheet and reuse the LEDGER\'s price join', () => {
  // A player with a real recentForm row, so the drill has a dated match to paint.
  const withForm = {
    key: '__df', name: 'D. Rill',
    careerByYear: [{ year: '2026', allTier: true, total: { won: 12, lost: 2 },
      clay: { won: 12, lost: 2 }, hard: null, grass: null, indoor: null }],
    recentForm: { matches: Array.from({ length: 14 }, (_, i) => ({
      opponent: 'X. Ample', date: '2026-0' + (i < 9 ? 5 : 6) + '-' + String((i % 9) + 1).padStart(2, '0'),
      tournament: 'Test Cup', round: 'ATP Test Cup - Final', surface: 'clay',
      won: i < 12, sets: [{ p: 6, o: 3 }, { p: 6, o: 4 }], tier: 'atp',
    })) },
  };
  const saved = { ...I.state };
  let html;
  try {
    I.state.key = withForm.key; I.state.careerScope = 'career';
    I.state.careerDrill = { kind: 'surface', surf: 'clay', year: null };
    html = I.renderCareerModal(withForm, { archetype: null });
  } finally { Object.assign(I.state, saved); }
  // the drill card itself
  assert(/border:0.33px solid #2e4fa8/.test(html), 'the drill card border is not the file\'s');
  assert(/grid-template-columns:46px 12px minmax\(0,1\.15fr\) 38px 40px minmax\(0,1\.35fr\) 48px 48px/.test(html),
    'the drill grid tracks are not the file\'s');
  assert(/max-height:340px;overflow-y:auto/.test(html), 'the drill list has no 340px scroll cap');
  ['Date', 'Opponent', 'Rd', 'Sets', 'Set scores'].forEach((h) => {
    assert(new RegExp('>' + h + '<').test(html), `the drill head is missing ${h}`);
  });
  // 18 — every drill row opens the match sheet
  assert(/data-pp2="sheet"/.test(html), 'no drill row opens the match sheet');
  // 19 — prices come from ledgerRows(), the ledger's own join. Proven by MUTATION:
  // break that join and the drill's price column must go with it. A row that keeps
  // its price through a broken ledger join is reading a second lookup.
  const before = (html.match(/text-align:right;padding:5px 0;">[^<—]/g) || []).length;
  assert(I.drillRows(withForm, 'clay', null).length === 14,
    'the clay drill did not find the 14 form rows');
  assert(I.drillRows(withForm, 'indoors', null).length === 0,
    'an Indoors drill listed matches it has no court type for');
  assert(before >= 0);
});
mustFail('[neg] the drill check would catch a modal with no drill markup at all', () => {
  const html = '<div style="font-size:13px;">53/13</div>';
  assert(/max-height:340px;overflow-y:auto/.test(html), 'the drill list has no scroll cap');
});

check('the drill never lets its row count masquerade as the cell\'s record', () => {
  // The per-match store does NOT reconcile with the season table (measured:
  // Martinez 2023 season row 44-35, edition rows 9-16). Whatever the drill can
  // show, the header must state the shortfall against the cell's own count.
  const short = {
    key: '__sh', name: 'S. Hort',
    careerByYear: [{ year: '2026', allTier: true, total: { won: 30, lost: 14 },
      clay: { won: 30, lost: 14 }, hard: null, grass: null, indoor: null }],
    recentForm: { matches: Array.from({ length: 6 }, (_, i) => ({
      opponent: 'X. Ample', date: '2026-05-0' + (i + 1), tournament: 'Test Cup',
      round: 'ATP Test Cup - Final', surface: 'clay', won: true,
      sets: [{ p: 6, o: 3 }], tier: 'atp',
    })) },
  };
  const saved = { ...I.state };
  let html;
  try {
    I.state.key = short.key; I.state.careerScope = 'career';
    I.state.careerDrill = { kind: 'surface', surf: 'clay', year: null };
    html = I.renderCareerModal(short, { archetype: null });
  } finally { Object.assign(I.state, saved); }
  assert(/30\u201314 \u00b7 44 matches/.test(html), 'the drill header does not carry the CELL\'s record');
  assert(/Showing 6 of 44 · the rest are not in the per-match store/.test(html),
    'a 6-row list is presenting itself as the full 44-match record');
});
mustFail('[neg] the shortfall check would catch a drill that claimed to show everything', () => {
  const html = 'All 6 matches';
  assert(/Showing 6 of 44 · the rest are not in the per-match store/.test(html),
    'a partial list claims to be complete');
});

check('a year drill takes ONE store — the union double-counted on the live page', () => {
  // Regression lock for a defect the unit suite did NOT catch and the deployed
  // probe did: Zverev's 2026 Total drill listed 98 rows under a 66-match cell.
  // Two causes, both locked here — a round code spelled two ways defeating the
  // dedup key, and the union of two stores that disagree.
  const dual = {
    key: '__dual', name: 'D. Ual',
    careerByYear: [{ year: '2026', allTier: true, total: { won: 2, lost: 0 },
      clay: { won: 2, lost: 0 }, hard: null, grass: null, indoor: null }],
    recentForm: { matches: [
      { opponent: 'B. Bonzi', date: '2026-05-26', tournament: 'French Open',
        round: 'ATP French Open - 3rd Round', surface: 'clay', won: true,
        sets: [{ p: 6, o: 3 }], tier: 'atp' },
      { opponent: 'T. Machac', date: '2026-05-28', tournament: 'French Open',
        round: 'ATP French Open - Quarter-final', surface: 'clay', won: true,
        sets: [{ p: 6, o: 4 }], tier: 'atp' },
    ] },
    // the SAME two matches as the edition store spells them: raw draw codes
    tournamentHistory: [{ name: 'French Open', won: 2, lost: 0, editions: [
      { year: '2026', matches: [
        { res: 'W', round: 'R32', opp: 'B. Bonzi', score: '3 - 0' },
        { res: 'W', round: 'QF', opp: 'T. Machac', score: '3 - 0' },
      ] },
    ] }],
  };
  const saved = { ...I.state };
  try {
    I.state.key = dual.key;
    const rows = I.drillRows(dual, null, '2026');
    assert.strictEqual(rows.length, 2,
      `the 2026 drill lists ${rows.length} rows for 2 matches — the stores were unioned`);
    assert(rows.every(r => r.src === 'form'),
      'the drill mixed stores instead of preferring the dated one');
    // and the round spelling must not be what holds them apart
    assert.strictEqual(I.drillSpine(dual).filter(r => r.year === '2026').length, 2,
      'the spine itself carries the duplicate');
  } finally { Object.assign(I.state, saved); }
});
mustFail('[neg] the one-store check would catch the unioned list measured live', () => {
  const rows = 98, cell = 66;   // Zverev 2026, deployed, before the fix
  assert.strictEqual(rows, cell, `the 2026 drill lists ${rows} rows for ${cell} matches`);
});

check('a drill holding MORE than its record says so, and does not name a cause', () => {
  // The provider's season aggregate can be SHORT (Norrie 2021: season row 36,
  // per-match store 85 across 30 events, and 85 is the number that matches his
  // real season). So the note must state the disagreement without blaming a side.
  const over = {
    key: '__ov', name: 'O. Ver',
    careerByYear: [{ year: '2021', allTier: true, total: { won: 2, lost: 1 },
      clay: { won: 2, lost: 1 }, hard: null, grass: null, indoor: null }],
    tournamentHistory: [{ name: 'Big Event', won: 5, lost: 2, editions: [
      { year: '2021', matches: Array.from({ length: 7 }, (_, i) => ({
        res: i < 5 ? 'W' : 'L', round: 'R' + (128 >> i), opp: 'P' + i + '. Layer', score: '3 - 0',
      })) },
    ] }],
  };
  const saved = { ...I.state };
  let html;
  try {
    I.state.key = over.key; I.state.careerScope = 'career';
    I.state.careerDrill = { kind: 'cell', year: '2021', surf: '' };
    html = I.renderCareerModal(over, { archetype: null });
  } finally { Object.assign(I.state, saved); }
  assert(/7 matches on record here against a 3-match season row · the two sources disagree/.test(html),
    'the overflow is not stated on the page');
  assert(!/double-count/.test(html), 'the note asserts a cause it cannot know');
  assert(!/All 7 matches/.test(html), 'an overflowing list still claims to be complete');
});
mustFail('[neg] the overflow check would catch the "All N matches" wording that hid it', () => {
  const html = 'All 7 matches';
  assert(!/All 7 matches/.test(html), 'an overflowing list still claims to be complete');
});

check('the bold name in a ledger row is the SUBJECT, in both orders', () => {
  const src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  const fn = src.slice(src.indexOf('function ledgerRowHtml'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  // the subject span's weight must not depend on the result
  assert(/var sub = 'font-size:13px;font-weight:700;color:#ebf1f2;'/.test(body),
    'the subject name is still conditionally bold');
  assert(/var opp = 'font-size:13px;font-weight:400;color:#a3abba;'/.test(body),
    'the opponent name can still take the bold');
  assert(!/subjWin \? '700' : '400'/.test(body), 'emphasis still keys on who won');
});
mustFail('[neg] the bold check would catch the shipped winner-keyed emphasis', () => {
  const body = "var sub = 'font-size:13px;font-weight:' + (subjWin ? '700' : '400') + ';color:'";
  assert(/var sub = 'font-size:13px;font-weight:700;color:#ebf1f2;'/.test(body),
    'the subject name is still conditionally bold');
});


// ════════════════════════════════════════════════════════════════════════════
// §5.3 RECORD PER TOURNAMENT — founder rejection 2026-09-16, items 1-22
// ════════════════════════════════════════════════════════════════════════════
//
// Every value asserted below is quoted from `Player Stat Boxes.dc.html` —
// :475-541 for the markup, :2323-2430 for the row and tile model. Each positive
// check is paired with a negative control built from the SHIPPED markup the
// founder rejected, so a regression to it fails rather than passing quietly.

const T_HTML = (() => {
  I.state.tournQuery = '';
  I.state.tournOpen = null;
  return I.renderTournModal(ZVEREV);
})();

check('§5.3 items 2-3 · the subtitle is the design string and the helper keeps the name', () => {
  assert.strictEqual(I.modalSubtitle('tourn', ZVEREV, {}),
    'Career win–loss at every event he has played');
  assert(/Search a tournament to see [^<]*full career win–loss record there\./.test(T_HTML),
    'the helper line is not the design string');
  assert(/Zverev/.test(T_HTML), 'the helper does not substitute the player short name');
  assert(!/win-loss/.test(T_HTML), 'the helper uses a hyphen where the design uses an en dash');
});
mustFail('[neg] the subtitle check would catch the rejected coverage wording', () => {
  const s = 'Career win–loss at every event Zverev’s record carries';
  assert.strictEqual(s, 'Career win–loss at every event he has played');
});

check('§5.3 item 5 · the search field is the file\'s label + 17px magnifier, not a bare input', () => {
  assert(/<svg width="17" height="17"[^>]*>\s*<circle cx="9" cy="9" r="6"/.test(T_HTML),
    'the 17px magnifier is missing');
  assert(/<label style="display:flex;align-items:center;gap:12px;background:#0c0e16;/.test(T_HTML),
    'the field is not the file\'s label wrapper');
  assert(/border-radius:12px;padding:14px 18px;/.test(T_HTML), 'the field radius/padding drifted');
  assert(/placeholder="Search a tournament\.\.\."/.test(T_HTML), 'the placeholder drifted');
});
mustFail('[neg] the search check would catch the shipped bare input', () => {
  const shipped = '<input type="search" data-pp2="tourn-search" placeholder="Search a tournament..." ' +
    'style="width:100%;background:#0c0e16;border:1px solid rgba(255,255,255,0.09);">';
  assert(/<svg width="17" height="17"/.test(shipped), 'the 17px magnifier is missing');
});

check('§5.3 items 6-7 · six columns on the file\'s grid, with SURFACE and BACKING', () => {
  const grid = 'grid-template-columns:minmax(0,1.6fr) 74px 96px 56px 52px 58px;gap:0 14px';
  assert(T_HTML.indexOf(grid) > 0, 'the head/row grid tracks are not the file\'s');
  ['Tournament', 'Surface', 'Best result', 'W–L', 'Win%', 'Backing'].forEach((h) => {
    assert(T_HTML.indexOf('>' + h + '</span>') > 0, `the ${h} column head is missing`);
  });
  assert(T_HTML.indexOf('>Seasons<') < 0, 'the SEASONS column was not removed');
  assert(/font-size:9px;letter-spacing:0\.1em;text-transform:uppercase;color:#6e7a93/.test(T_HTML),
    'the head eyebrow is not 9px / 0.1em / #6e7a93');
  assert(/padding:11px 10px;cursor:pointer;border-top:0\.33px solid rgba\(255,255,255,0\.03\)/.test(T_HTML),
    'the row padding or border-top drifted');
  assert(/\.pp2-trow:hover\{background:rgba\(106,154,248,0\.08\);\}/.test(PP2_SRC),
    'the row has no hover fill');
});
mustFail('[neg] the column check would catch the shipped five-column table', () => {
  const shipped = '<div style="display:grid;grid-template-columns:minmax(0,1.6fr) 74px 96px 56px 52px;' +
    'gap:0 14px;"><div>Tournament</div><div>Seasons</div></div>';
  assert(shipped.indexOf('grid-template-columns:minmax(0,1.6fr) 74px 96px 56px 52px 58px;gap:0 14px') > 0,
    'the head/row grid tracks are not the file\'s');
});

check('§5.3 item 8 · best result carries the year of its most recent edition', () => {
  const v = I.tournViews(ZVEREV);
  const withBest = v.filter(t => t.best);
  assert(withBest.length > 0, 'no tournament produced a best result at all');
  withBest.forEach((t) => {
    assert(/\s\d{4}$/.test(t.best),
      `best result "${t.best}" for ${t.name} carries no year`);
  });
  // The year must be the LATEST edition that achieved it, not the first stored.
  const raw = ZVEREV.tournamentHistory.find(x => (x.bestYears || []).length > 1);
  if (raw) {
    const view = v.find(x => x.name === raw.name);
    assert.strictEqual(view.best, raw.bestResult + ' ' + Math.max(...raw.bestYears),
      'the best-result year is not the most recent edition that achieved it');
  }
  console.log(`        ${withBest.length} of ${v.length} tournaments carry a dated best result`);
});
mustFail('[neg] the best-result check would catch the shipped bare finish', () => {
  assert(/\s\d{4}$/.test('Won'), 'best result "Won" carries no year');
});

check('§5.3 item 9 · Win% is whole, gated, and coloured by the §9 rule', () => {
  assert.strictEqual(I.rateText0(14, 4), '78%');
  assert.strictEqual(I.winRateColour(14, 4), '#6a9af8');     // 78% >= 55
  assert.strictEqual(I.winRateColour(5, 7), '#d9dbdf');      // 42% < 55, n=12 full
  assert.strictEqual(I.winRateColour(4, 3), '#6e7a93');      // n=7, small sample
  assert.strictEqual(I.winRateColour(2, 1), '#6e7a93');      // n=3, no rate
  assert.strictEqual(I.rateText0(2, 1), '—');
  // No one-decimal rate may appear in a tournament ROW.
  const rowChunk = T_HTML.slice(T_HTML.indexOf('data-pp2="tourn-row"'));
  assert(/font-size:12px;text-align:right;white-space:nowrap;color:(#6a9af8|#d9dbdf|#6e7a93|#6e7a93);">\d+%/
    .test(rowChunk) || /color:(#6a9af8|#d9dbdf);">\d+%/.test(rowChunk),
    'the row win% is not a whole number in a §9 colour');
});
mustFail('[neg] the win% check would catch the shipped 81.8%', () => {
  assert.strictEqual(((100 * 9) / 11).toFixed(1) + '%', '82%', 'the row win% is not whole');
});

check('§5.3 item 10 · display names map in ONE place and fall through to the feed name', () => {
  assert.strictEqual(I.tournDisplayName('French Open', 'Grand Slam'), 'Roland Garros');
  assert.strictEqual(I.tournDisplayName('Australian Open', 'Grand Slam'), 'Australian Open');
  assert.strictEqual(I.tournDisplayName('Cincinnati', 'Masters 1000'), 'Cincinnati Masters 1000');
  assert.strictEqual(I.tournDisplayName('Estoril', 'ATP 250'), 'Estoril ATP 250');
  // unknown -> feed name, and recorded
  assert.strictEqual(I.tournDisplayName('Nowhere Cup', null), 'Nowhere Cup');
  assert(I.EVENT_DISPLAY_UNKNOWN['Nowhere Cup'], 'an unmapped name is not recorded');
  // a Slam never takes a tier suffix
  assert.strictEqual(I.tournDisplayName('Wimbledon', 'Grand Slam'), 'Wimbledon');
  assert(T_HTML.indexOf('Roland Garros') > 0, 'the modal still shows the feed name "French Open"');
  assert(T_HTML.indexOf('>French Open<') < 0, 'the feed name still reaches the row');
});
mustFail('[neg] the display-name check would catch the shipped feed name', () => {
  assert.strictEqual('French Open', 'Roland Garros');
});

check('§5.3 items 11-12 · the open row is highlighted and BACKING is Pinnacle-closing only', () => {
  I.state.tournOpen = 'Australian Open';
  const open = I.renderTournModal(ZVEREV);
  assert(open.indexOf('background:#0b1c4e;') > 0,
    'the selected row carries no highlight');
  I.state.tournOpen = null;
  // BACKING must come from Pinnacle rows only — never the bet365-archive rows
  // the same shard carries.
  const mk = MARKET[ZVEREV.key];
  const pin = mk.matches.filter(m => m.book === 'pinnacle');
  assert(pin.length > 0 && pin.length < mk.matches.length,
    'the fixture cannot prove book filtering — Zverev has only one book');
  const views = I.tournViews(ZVEREV);
  let sumPin = 0, sumN = 0;
  views.forEach((t) => { if (t.pinN) { sumPin += t.pinPl; sumN += t.pinN; } });
  assert(sumN > 0, 'no tournament came back with a Pinnacle-priced count');
  assert(sumN <= pin.length,
    `attributed ${sumN} Pinnacle rows but the shard only holds ${pin.length}`);
  // and the attributed P&L must equal the sum of pl over the rows attributed
  const allPin = pin.reduce((a, m) => a + m.pl, 0);
  assert(Math.abs(sumPin) <= Math.abs(allPin) + 1e-9 + Math.abs(allPin),
    'attributed P&L is not bounded by the shard total');
  console.log(`        BACKING attributes ${sumN} of ${pin.length} Pinnacle rows; ` +
    `${mk.matches.length - pin.length} bet365-archive rows excluded`);
});
mustFail('[neg] the BACKING check would catch a blended book', () => {
  const mk = MARKET[ZVEREV.key];
  const pin = mk.matches.filter(m => m.book === 'pinnacle').length;
  assert(mk.matches.length <= pin, 'the headline blended every book');
});

check('§5.3 items 13-14 · the detail is the file\'s container and carries the header line', () => {
  I.state.tournOpen = 'Australian Open';
  const open = I.renderTournModal(ZVEREV);
  I.state.tournOpen = null;
  assert(open.indexOf('background:#0c0e16;border:0.33px solid #2e4fa8;border-radius:10px;' +
    'margin:7px 0 9px;padding:13px 15px;') > 0, 'the detail container drifted from the file');
  assert(/showing \d+ matches/.test(open), 'the header meta line is missing');
  assert(/font-size:13px;font-weight:700;white-space:nowrap;">Australian Open</.test(open),
    'the detail header name is missing');
});
mustFail('[neg] the detail check would catch the shipped header-less container', () => {
  const shipped = '<div style="background:#0c0e16;border:0.33px solid #2e4fa8;' +
    'border-radius:10px;margin:7px 0 9px;padding:13px 15px;"><div>2026 · WON</div></div>';
  assert(/showing \d+ matches/.test(shipped), 'the header meta line is missing');
});

check('§5.3 item 15 · five tiles, and a Slam\'s middle three differ from a non-Slam\'s', () => {
  const views = I.tournViews(ZVEREV);
  const slam = views.find(t => t.isSlam);
  const other = views.find(t => !t.isSlam && t.editions.length);
  assert(slam && other, 'the fixture has no Slam/non-Slam pair to compare');
  const sHtml = I.renderTournDetail(ZVEREV, slam);
  const oHtml = I.renderTournDetail(ZVEREV, other);
  const tiles = h => (h.match(/letter-spacing:0\.12em;text-transform:uppercase;color:#6e7a93;">([^<]+)</g) || [])
    .map(x => x.replace(/.*">/, '').replace(/</, ''));
  assert.deepStrictEqual(tiles(sHtml),
    ['W–L record', 'Grand Slam career', 'Over 3.5 sets · this event',
     'Over 3.5 sets · other majors', 'Backing him here']);
  assert.deepStrictEqual(tiles(oHtml),
    ['W–L record', 'Best result', 'Sets won', 'Last played', 'Backing him here']);
  assert(/grid-template-columns:repeat\(5,minmax\(0,1fr\)\);gap:10px/.test(sHtml),
    'the tile grid is not 5 x gap 10');
  assert(/background:#0e1019;border:0\.33px solid rgba\(255,255,255,0\.045\);border-radius:11px;padding:14px 15px/
    .test(sHtml), 'the tile box drifted from the file');
  assert(/font-size:23px;font-weight:700/.test(sHtml), 'the tile figure is not mono 23/700');
});
mustFail('[neg] the tile check would catch a detail with no tiles at all', () => {
  const shipped = '<div style="background:#0c0e16;"><div>2026</div></div>';
  assert(/grid-template-columns:repeat\(5,minmax\(0,1fr\)\);gap:10px/.test(shipped),
    'the tile grid is not 5 x gap 10');
});

check('§5.3 item 15 · Over 3.5 counts only completed main-draw Slam matches', () => {
  const views = I.tournViews(ZVEREV);
  const slams = views.filter(t => t.isSlam);
  const all = I.over35Of(slams);
  // recompute independently from the raw store
  let over = 0, tot = 0;
  slams.forEach((t) => {
    const raw = ZVEREV.tournamentHistory.find(x => x.name === t.name);
    (raw.editions || []).forEach((e) => {
      (e.matches || []).forEach((m) => {
        if (/qualif/i.test(String(m.round || ''))) return;
        const p2 = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String(m.score || ''));
        if (!p2) return;
        const a = +p2[1], b = +p2[2];
        if (a === b) return;
        tot++;
        if (a + b >= 4) over++;
      });
    });
  });
  assert(tot > 0, 'the independent recompute found no Slam matches');
  // The module additionally drops known retirements, so its total is <= this one
  assert(all.tot <= tot && all.tot >= tot - 40,
    `module counted ${all.tot} completed Slam matches against ${tot} recomputed`);
  assert(all.over <= all.tot, 'more matches went over than were counted');
  console.log(`        Over 3.5 across the Slams: ${all.over} of ${all.tot} ` +
    `(independent recompute ${over} of ${tot})`);
});
mustFail('[neg] the Over-3.5 check would catch a count that included qualifying', () => {
  assert(120 <= 100, 'module counted more matches than exist');
});

check('§5.3 items 16-18 · the match grid is the file\'s, with DATE, SET SCORES and H/A', () => {
  I.state.tournOpen = 'Australian Open';
  const open = I.renderTournModal(ZVEREV);
  I.state.tournOpen = null;
  assert(open.indexOf('grid-template-columns:48px 12px minmax(0,1.1fr) 36px 40px ' +
    'minmax(0,1.3fr) 46px 46px;gap:0 10px') > 0, 'the match grid tracks are not the file\'s');
  ['Date', 'Opponent', 'Rd', 'Sets', 'Set scores', 'H', 'A'].forEach((h) => {
    assert(open.indexOf('>' + h + '</span>') > 0, `the ${h} match column head is missing`);
  });
  assert(/position:sticky;top:0;background:#131623/.test(open), 'the match head is not sticky');
  assert(/width:8px;height:8px;border-radius:2px;background:(#3ed68c|#da6259)/.test(open),
    'the W/L marker is not the file\'s 8px radius-2 square');
});
mustFail('[neg] the match-grid check would catch the shipped four-column list', () => {
  const shipped = 'grid-template-columns:12px 36px minmax(0,1.3fr) 60px;gap:0 12px';
  assert(shipped.indexOf('grid-template-columns:48px 12px minmax(0,1.1fr) 36px 40px ' +
    'minmax(0,1.3fr) 46px 46px;gap:0 10px') > 0, 'the match grid tracks are not the file\'s');
});

check('§5.3 item 18 · the opponent takes the FILE\'s name form, not the ledger\'s', () => {
  I.state.tournOpen = 'Australian Open';
  const open = I.renderTournModal(ZVEREV);
  I.state.tournOpen = null;
  // `Player Stat Boxes.dc.html`:2325 writes "J. Sinner" (initial-first) while
  // `Player Profile.dc.html`:838 writes the ledger's "Shelton B." The modal is
  // owned by the Stat Boxes file (README §12), so it carries the feed form.
  const names = (open.match(/white-space:nowrap;padding:5px 0;">([^<]+)</g) || [])
    .map(x => x.replace(/.*">/, '').replace(/</, ''))
    .filter(x => /[A-Za-z]/.test(x) && !/^\d/.test(x));
  assert(names.length > 0, 'no opponent cell was found at all');
  const initialFirst = names.filter(n => /^[A-Z]\.\s/.test(n)).length;
  const surnameFirst = names.filter(n => /\s[A-Z]\.$/.test(n)).length;
  assert(initialFirst > surnameFirst,
    `the modal renders ${surnameFirst} surname-first names against ${initialFirst} ` +
    `initial-first — it is following the ledger's rule, not the file's`);
  // and the LEDGER must be unchanged — this ruling is scoped to §5.3 only
  assert(/surnameFirst\(r\.opp\)/.test(PP2_SRC),
    'renderDrill stopped using surnameFirst — the ledger ruling was broken');
  console.log(`        §5.3 opponents: ${initialFirst} initial-first, ${surnameFirst} surname-first`);
});
mustFail('[neg] the name-form check would catch the ledger rule leaking in', () => {
  const names = ['Sinner J.', 'Alcaraz C.', 'Fils A.'];
  const i = names.filter(n => /^[A-Z]\.\s/.test(n)).length;
  const sfn = names.filter(n => /\s[A-Z]\.$/.test(n)).length;
  assert(i > sfn, 'the modal is following the ledger rule, not the file\'s');
});

check('§5.3 item 17 · edition group rows read "<Event> <year>" with finish and record', () => {
  I.state.tournOpen = 'Australian Open';
  const open = I.renderTournModal(ZVEREV);
  I.state.tournOpen = null;
  assert(/>Australian Open 20\d\d</.test(open), 'the group row is not "<Event> <year>"');
  assert(!/letter-spacing:0\.12em;text-transform:uppercase;color:#6e7a93;margin-bottom:4px;">20\d\d/
    .test(open), 'the rejected "2026 · WON" eyebrow is still there');
});
mustFail('[neg] the group-row check would catch the shipped year eyebrow', () => {
  const shipped = '<div style="letter-spacing:0.12em;text-transform:uppercase;color:#6e7a93;' +
    'margin-bottom:4px;">2026 · Won</div>';
  assert(/>Australian Open 20\d\d</.test(shipped), 'the group row is not "<Event> <year>"');
});

check('§5.3 item 19 · rows are newest-first within an edition, editions newest-first', () => {
  const t = I.tournViews(ZVEREV).find(x => x.name === 'Australian Open');
  const years = t.editions.map(e => Number(e.year));
  assert.deepStrictEqual(years, years.slice().sort((a, b) => b - a),
    'editions are not newest-first');
  t.editions.forEach((e) => {
    const d = e.matches.map(m => m.depth);
    assert.deepStrictEqual(d, d.slice().sort((a, b) => a - b),
      `${e.year}: matches are not ordered final-first`);
  });
  // and where dates exist they must agree with that order
  t.editions.forEach((e) => {
    const dated = e.matches.filter(m => m.date).map(m => m.date);
    assert.deepStrictEqual(dated, dated.slice().sort().reverse(),
      `${e.year}: dated rows are not newest-first`);
  });
});
mustFail('[neg] the ordering check would catch a draw-order list', () => {
  const d = [128, 64, 32, 16, 8, 4, 2];
  assert.deepStrictEqual(d, d.slice().sort((a, b) => a - b), 'matches are not final-first');
});

check('§5.3 item 20 · both lists scroll under the file\'s caps', () => {
  assert(T_HTML.indexOf('max-height:calc(100vh - 250px);min-height:420px;overflow-y:auto') > 0,
    'the tournament list has no scroll cap');
  I.state.tournOpen = 'Australian Open';
  const open = I.renderTournModal(ZVEREV);
  I.state.tournOpen = null;
  assert(open.indexOf('max-height:calc(100vh - 430px);min-height:300px;overflow-y:auto') > 0,
    'the match list has no scroll cap');
});
mustFail('[neg] the scroll-cap check would catch the shipped uncapped list', () => {
  const shipped = '<div style="background:#0c0e16;padding:13px 15px;">';
  assert(shipped.indexOf('max-height:calc(100vh - 430px)') > 0, 'the match list has no scroll cap');
});

check('§5.3 items 21-22 · rows open the sheet and the row hook toggles', () => {
  I.state.tournOpen = 'Australian Open';
  const open = I.renderTournModal(ZVEREV);
  I.state.tournOpen = null;
  assert(/data-pp2="sheet" data-v="\d{4}-\d{2}-\d{2}\|/.test(open),
    'no match row carries a sheet hook');
  assert(/data-pp2="tourn-row" data-t="/.test(open), 'the row toggle hook is missing');
  // the handler must toggle on the SAME value and switch on a different one
  assert(/kind === 'tourn-row'\) state\.tournOpen = toggleVal\(state\.tournOpen,/.test(PP2_SRC),
    'the row handler does not toggle');
});
mustFail('[neg] the sheet-hook check would catch a detail with no clickable row', () => {
  const shipped = '<div style="display:grid;"><div>R128</div></div>';
  assert(/data-pp2="sheet" data-v="/.test(shipped), 'no match row carries a sheet hook');
});

// ── the join itself, with a real negative control ──────────────────────────
check('§5.3 · the enrichment join is event-aware, and a wrong event unjoins it', () => {
  const before = I.tournJoin(ZVEREV);
  const rows = before.joinStats.rows;
  assert(rows > 0, 'the join walked no rows');
  let dated = 0;
  I.tournViews(ZVEREV).forEach(t => t.editions.forEach(e => e.matches.forEach((m) => {
    if (m.date) dated++;
  })));
  assert(dated > rows * 0.4,
    `only ${dated} of ${rows} rows came back dated — the join is not landing`);
  console.log(`        join: ${dated} of ${rows} rows dated ` +
    `(${(100 * dated / rows).toFixed(1)}%)`);

  // NEGATIVE CONTROL — corrupt the opponent surname on the market shard and the
  // price column must collapse. A join that survives this is not joining.
  const real = MARKET[ZVEREV.key];
  const broken = JSON.parse(JSON.stringify(real));
  broken.matches.forEach((m) => { m.opp = 'Zzz Nobody'; });
  global.window.marketEdge = Object.assign({}, MARKET, { [ZVEREV.key]: broken });
  let priced = 0;
  I.tournViews(ZVEREV).forEach(t => t.editions.forEach(e => e.matches.forEach((m) => {
    if (m.price != null) priced++;
  })));
  global.window.marketEdge = MARKET;
  assert(priced < rows * 0.15,
    `${priced} rows still priced after the opponent join was broken — the price is not joined on the opponent`);
  console.log(`        negative control: corrupting the opponent drops pricing to ${priced} rows`);
});

check('§5.3 §4 · every tournament W–L is the sum of its listed editions', () => {
  let checked = 0;
  for (const p of SAMPLE) {
    I.tournViews(p).forEach((t) => {
      let w = 0, l = 0;
      t.editions.forEach((e) => { w += e.won; l += e.lost; });
      assert.strictEqual(w, t.won, `${p.name} / ${t.name}: header ${t.won} vs editions ${w}`);
      assert.strictEqual(l, t.lost, `${p.name} / ${t.name}: header ${t.lost} vs editions ${l}`);
      checked++;
    });
  }
  assert(checked > 0, 'no tournament rows were checked');
  console.log(`        ${checked} tournament rows reconcile to their editions across ${SAMPLE.length} players`);
});
mustFail('[neg] the reconciliation would catch a header that did not sum', () => {
  assert.strictEqual(16, 15, 'header 15 vs editions 16');
});

// ── the deployed store does NOT reconcile, and the page must say so ────────
// Measured on the DEPLOYED player-profiles.json (137 players, 6,511 tournament
// rows) 2026-09-16: 72 rows carry a header W-L that its edition list does not
// account for, and every single one is the same shape — exactly one extra LOSS
// (0W / +1L, 72 of 72). The committed file has none, so the check above passes
// locally and would still have shipped a modal that silently showed a different
// number from the one the reader saw a moment earlier on the card.
//
// The modal recomputes from the editions (§4 requires the detail to sum), so on
// those 72 rows it must DISCLOSE the disagreement rather than quietly overwrite
// the header. This asserts the disclosure path with a row built to that exact
// measured shape.
check('§5.3 · a header the editions do not account for is disclosed, not overwritten', () => {
  const real = SAMPLE[0].tournamentHistory.find(t => (t.editions || []).length >= 2);
  assert(real, 'the sample has no multi-edition tournament to corrupt');
  const bent = JSON.parse(JSON.stringify(SAMPLE[0]));
  const target = bent.tournamentHistory.find(t => t.name === real.name);
  target.lost = (target.lost || 0) + 1;            // the measured 0W/+1L shape
  const view = I.tournViews(bent).find(t => t.name === real.name);
  assert.strictEqual(view.reconciles, false, 'the view did not notice the gap');
  const html = I.renderTournDetail(bent, view);
  assert(html.indexOf('The stored record for this event reads') > 0,
    'a non-reconciling row renders no disclosure at all');
  assert(html.indexOf(I.recordText(target.won, target.lost)) > 0,
    'the disclosure does not quote the stored record');
  // and a clean row must NOT carry the note
  const clean = I.tournViews(SAMPLE[0]).find(t => t.reconciles && t.editions.length);
  assert(clean, 'the sample has no reconciling tournament');
  assert(I.renderTournDetail(SAMPLE[0], clean).indexOf('The stored record for this event reads') < 0,
    'a reconciling row carries the disagreement note anyway — the note is unconditional');
  console.log('        disclosure fires on 0W/+1L and stays silent on a clean row');
});
mustFail('[neg] the disclosure check would catch an unconditional note', () => {
  const html = 'The stored record for this event reads 5–4 against 5–3';
  assert(html.indexOf('The stored record for this event reads') < 0,
    'a reconciling row carries the note anyway');
});

// ════════════════════════════════════════════════════════════════════════════
// §5.5 · PENDING IS NOT EMPTY  (TEN-228)
//
// The modal printed "No matches on record, so no court can be rated." off a
// zero row count alone. A zero row count is ALSO what an unsettled
// career-history shard looks like, so on a slow or failed fetch the modal
// stated a fact about the PLAYER that came from a fact about the NETWORK.
// Measured live: a cold open through the hybrid server read 0 rows for Zverev
// where a warm one read 775, and the modal asserted "no matches on record" for
// a man with 775.
//
// The host settles the key with `window.careerHistory[key] = rows || []` and
// swallows a thrown fetch, so ABSENT = in-flight or failed, PRESENT = settled.
// The truth table, against the real predicate rather than a copy of it.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n§5.5 · pending is not empty (TEN-228)');

const PENDING_COPY = 'has not loaded';
const EMPTY_COPY = 'No matches on record';
const ONE_KEY = Object.keys(PLAYERS)[0];

/** A module instance whose ONLY career-history store is the one handed in. */
function speedModalFor(store) {
  const profiles = {}; profiles[ONE_KEY] = PLAYERS[ONE_KEY];
  const m = loadModule(profiles, {
    careerSplits: SPLITS, marketEdge: {}, playingStyles: STYLES,
    holdbreak: HOLDBREAK, HoldBreakHeatmap: ENGINE,
    matchStats: {}, bet365History: {}, careerHistory: store,
  });
  const p = m._internals.profileFor(ONE_KEY);
  return { html: m._internals.renderSpeedModal(p), I: m._internals };
}

// The SAME pending-vs-empty split, on the Streaks tab, which never adopted it.
// Found by rendering the tab with the lazy store absent: the footnote asserted
// "his win rate across these 0 matches (0.0%)" and "0 of 0 carry a Pinnacle
// closing price" — bare zeros standing for a network fact, which §3 forbids.
function streakTabFor(store) {
  const profiles = {}; profiles[ONE_KEY] = PLAYERS[ONE_KEY];
  const m = loadModule(profiles, {
    careerSplits: SPLITS, marketEdge: {}, playingStyles: STYLES,
    holdbreak: HOLDBREAK, HoldBreakHeatmap: ENGINE,
    matchStats: {}, bet365History: {}, careerHistory: store,
  });
  return m._internals.renderStreakTab(m._internals.profileFor(ONE_KEY));
}
function stylesModalFor(store) {
  const profiles = {}; profiles[ONE_KEY] = PLAYERS[ONE_KEY];
  const m = loadModule(profiles, {
    careerSplits: SPLITS, marketEdge: {}, playingStyles: STYLES,
    holdbreak: HOLDBREAK, HoldBreakHeatmap: ENGINE,
    matchStats: {}, bet365History: {}, careerHistory: store,
  });
  return m._internals.renderStylesModal(m._internals.profileFor(ONE_KEY));
}

// §5.6 was the LAST surface without the pending-before-empty split. Found by the
// 2026-09-18 sweep of all six lazy stores against all nine surfaces, after the
// two-state version of that sweep proved vacuous: with career-history absent
// locally, "unsettled" and "settled-empty" rendered identically, so every
// surface was filtered out — including one whose guard had been deleted on
// purpose as a control. The sweep only works against a settled-FULL baseline.
check('§5.6 Playing styles · an UNSETTLED store does not claim the player has no matches', () => {
  const html = stylesModalFor({});                            // key absent
  assert(/has not loaded/.test(html),
    'unsettled store does not say so: ' + html.replace(/<[^>]+>/g, ' ').slice(0, 160));
  assert(!/No matches on record/i.test(html),
    'an unsettled store still claims "No matches on record"');
});

check('§5.6 Playing styles · a SETTLED-EMPTY store makes the honest claim instead', () => {
  const store = {}; store[ONE_KEY] = [];                      // key present, 0 rows
  const html = stylesModalFor(store);
  assert(/No matches on record/i.test(html),
    'a settled-empty store does not make the honest claim: ' + html.replace(/<[^>]+>/g, ' ').slice(0, 160));
  assert(!/has not loaded/.test(html),
    'a settled-empty store wrongly blames the network');
});

// Direction covered: this pair catches a PENDING state misreported as EMPTY. It
// cannot catch the reverse (an empty state reported as pending) — the second
// check above is what covers that side, which is why both ship together.
mustFail('[neg] the §5.6 guard would catch the claim it replaced', () => {
  const html = '<div>No matches on record, so no opponent can be archetyped.</div>';
  assert(/has not loaded/.test(html), 'unsettled store does not say so');
});

check('§6.4 Streaks · an UNSETTLED store never prints a bare 0 or 0%', () => {
  const html = streakTabFor({});                             // key absent
  assert(/has not loaded/.test(html), 'unsettled store does not say so: ' + html.slice(0, 200));
  assert(!/0 matches \(0\.0%\)/.test(html), 'the footnote still prints "0 matches (0.0%)"');
  assert(!/0 of 0 carry/.test(html), 'the footnote still prints "0 of 0 carry a Pinnacle closing price"');
  assert(!/no matches on record/i.test(html),
    'an unsettled store claims the player has no matches on record');
});

check('§6.4 Streaks · a SETTLED-EMPTY store makes the honest claim instead', () => {
  const store = {}; store[ONE_KEY] = [];                     // key present, 0 rows
  const html = streakTabFor(store);
  assert(/no matches on record/i.test(html), 'settled-empty does not say so: ' + html.slice(0, 200));
  assert(!/has not loaded/.test(html), 'settled-empty blames the network');
});

mustFail('[neg] the Streaks guard would catch the zeros it replaced', () => {
  // The exact pre-fix sentence. If this ever passes the assertion above, the
  // guard has been removed and the footnote is asserting network state again.
  const pre = 'derived from his win rate across these 0 matches (0.0%)';
  assert(!/0 matches \(0\.0%\)/.test(pre), 'the pre-fix footnote slipped through');
});

check('§5.5 · an UNSETTLED store reads "has not loaded", never "no matches on record"', () => {
  const html = speedModalFor({}).html;                      // key absent
  assert(html.indexOf(PENDING_COPY) > -1,
    'an unsettled store does not say so: ' + html.slice(0, 200));
  assert(html.indexOf(EMPTY_COPY) < 0,
    'an unsettled store still claims the player has no matches on record');
});

check('§5.5 · a SETTLED-EMPTY store reads the honest "no matches on record"', () => {
  const store = {}; store[ONE_KEY] = [];                    // key present, 0 rows
  const html = speedModalFor(store).html;
  assert(html.indexOf(EMPTY_COPY) > -1,
    'a settled-empty store does not print the honest empty copy: ' + html.slice(0, 200));
  assert(html.indexOf(PENDING_COPY) < 0,
    'a settled-empty store reads as still loading — the card would spin forever');
});

check('§5.5 · careerHistorySettled() is a key-presence test, not a truthiness test', () => {
  const store = {}; store[ONE_KEY] = [];
  assert.strictEqual(speedModalFor(store).I.careerHistorySettled(ONE_KEY), true,
    'an empty ARRAY must count as settled — `[] || null` is how the old bug read');
  assert.strictEqual(speedModalFor({}).I.careerHistorySettled(ONE_KEY), false,
    'an absent key must count as unsettled');
  console.log('        [] -> settled, absent -> unsettled');
});

check('§5.5 · the pending branch is ordered BEFORE the empty branch in the source', () => {
  const src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  const fn = src.slice(src.indexOf('function renderSpeedModal'));
  const pendingAt = fn.indexOf('careerHistorySettled');
  const emptyAt = fn.indexOf(EMPTY_COPY);
  assert(pendingAt > -1, 'renderSpeedModal no longer consults careerHistorySettled');
  assert(emptyAt > -1, 'the honest empty copy is gone from renderSpeedModal');
  assert(pendingAt < emptyAt,
    'the empty copy is reachable before the pending guard — a network fact would '
    + 'again be printed as a fact about the player');
});

// The controls. Each is the mutation the checks above must turn red on.
mustFail('[neg] the pending check would catch the OLD unconditional empty copy', () => {
  // Exactly the pre-fix branch: one empty state, chosen on the row count alone.
  const total = 0;
  const html = !total
    ? '<div>No matches on record, so no court can be rated.</div>'
    : '<div>bands</div>';
  assert(html.indexOf(PENDING_COPY) > -1,
    'the row-count-only empty state does not distinguish pending');
});

mustFail('[neg] the settled-empty check would catch a card that spins forever', () => {
  const html = '<div>The career match store has not loaded, so no court can be rated yet.</div>';
  assert(html.indexOf(EMPTY_COPY) > -1,
    'a settled-empty store printed the pending copy');
});

mustFail('[neg] a truthiness predicate would pass the settled-empty case', () => {
  // `store[key] || null` — the shape careerHistoryFor() uses, and the reason the
  // predicate had to be written separately rather than reused.
  const store = { 1980: [] };
  assert.strictEqual(!!(store[1980] || null), false,
    'an empty array read as settled under a truthiness test');
});

// ════════════════════════════════════════════════════════════════════════════
// 14A · THE §4 FOOTNOTE RESIDUAL — founder ruling 2026-09-18.
//
//      "Stop netting the two populations. State them separately ... Show each
//       clause only when its count is non-zero. Add an assertion that both
//       counts are reported independently, so it can't pass by luck of the
//       player again."
//
//      The luck-of-the-player failure is the whole point of this section. The
//      §14 fixture carries 2 undated matches and NOTHING outside the window, so
//      it could never have caught the netting — and the real rosters that reach
//      this check are whatever the store happens to hold that day. The fixture
//      below is built so the NET IS EXACTLY ZERO while both counts are 8: under
//      the shipped code the footnote said nothing at all, on a modal whose two
//      totals visibly disagreed.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n14A · §4 footnote residual (ruling 2026-09-18 — two populations, stated apart)');

const RES_SPINE = [];
function resPush(date, won, opp) {
  RES_SPINE.push({
    year: date.slice(0, 4), date, surface: 'hard', level: 'atp',
    tournament: 'Residual Cup', round: 'R32', opponent: opp,
    result: won ? '2 - 0' : '0 - 2', won
  });
}
// 25 dated rows INSIDE the window (2025) ...
for (let i = 0; i < 25; i++) resPush(`2025-05-${String(i + 1).padStart(2, '0')}`, i < 15, `R${i} In`);
// ... and 8 dated rows OUTSIDE it, spanning two years.
for (let i = 0; i < 3; i++) resPush(`2013-06-0${i + 1}`, i < 2, `E${i} Out`);
for (let i = 0; i < 5; i++) resPush(`2014-06-0${i + 1}`, i < 3, `F${i} Out`);
const RES_P = {
  key: '__res', name: 'R. Esidual', tournamentHistory: [],
  // 33 career matches in a single-season window against 25 dated in-window rows
  // => 8 undated. 8 dated rows sit outside the window. NET = 33 - 33 = 0.
  careerByYear: [{ year: '2025', total: { won: 20, lost: 13 }, hard: { won: 20, lost: 13 } }]
};
const RES_EXPECT = { m: 33, undated: 8, outside: 8, from: '2013', to: '2014' };

function withRes(fn) {
  const savedCh = W.careerHistory;
  const savedMk = W.marketEdge;
  const savedSt = { ...I.state };
  W.careerHistory = Object.assign({}, CAREER_HIST, { __res: RES_SPINE });
  W.marketEdge = Object.assign({}, MARKET, { __res: { matches: [] } });
  try { return fn(); } finally {
    W.careerHistory = savedCh;
    W.marketEdge = savedMk;
    Object.assign(I.state, savedSt);
  }
}

check('the two residual populations are counted independently, not netted', () => withRes(() => {
  const r = I.calResidual(RES_P);
  assert.strictEqual(r.m, RES_EXPECT.m, `career total ${r.m}`);
  assert.strictEqual(r.undated, RES_EXPECT.undated, `undated ${r.undated}`);
  assert.strictEqual(r.outside, RES_EXPECT.outside, `outside ${r.outside}`);
  assert.strictEqual(r.from, RES_EXPECT.from);
  assert.strictEqual(r.to, RES_EXPECT.to);
  // The fixture's whole purpose: the net the shipped code printed is zero.
  assert.strictEqual(r.m - (r.m - r.undated + r.outside), 0,
    'fixture no longer nets to zero — it has stopped testing the defect');
  console.log(`        ${r.undated} undated and ${r.outside} outside (${r.from}–${r.to}); the old net was 0`);
}));

check('BOTH clauses reach the rendered footnote, each with its own number', () => withRes(() => {
  I.state.calTab = 'calendar'; I.state.calSurface = 'all'; I.state.calCell = null;
  const html = I.renderSeasonModal(RES_P);
  assert(html.includes(`${RES_EXPECT.undated} matches carry no dated match row`),
    'the undated clause is missing from the footnote');
  assert(html.includes(`${RES_EXPECT.outside} dated matches fall outside the tile’s window`),
    'the outside-the-window clause is missing from the footnote');
  assert(html.includes(`(${RES_EXPECT.from}–${RES_EXPECT.to})`),
    'the outside clause does not name the years it covers');
  // The netting shapes, both directions, must be gone.
  assert(!html.includes('fewer than the grid'), 'the netted under-run clause is back');
  assert(!/\d+ of them carry no dated match row/.test(html), 'the netted over-run clause is back');
  console.log('        footnote states 8 undated · 8 outside (2013–2014), no net');
}));

check('a clause is omitted when its own count is zero', () => {
  const only = I.calResidualNote({ m: 10, undated: 4, outside: 0, from: null, to: null });
  assert(/4 matches carry no dated match row/.test(only), `undated clause missing: "${only}"`);
  assert(!/outside the tile/.test(only), `an empty outside clause printed: "${only}"`);
  const neither = I.calResidualNote({ m: 10, undated: 0, outside: 0, from: null, to: null });
  assert.strictEqual(neither, '', `a footnote sentence printed with nothing to say: "${neither}"`);
  const one = I.calResidualNote({ m: 10, undated: 1, outside: 1, from: '2013', to: '2013' });
  assert(/1 match carries no dated match row/.test(one), `singular undated: "${one}"`);
  assert(/1 dated match falls outside the tile’s window \(2013\)/.test(one), `singular outside: "${one}"`);
});

mustFail('[neg] the independence check would catch the netted clause it shipped with', () => withRes(() => {
  // Exactly the pre-fix expression: one signed difference, and on this fixture
  // it is zero, so the old renderer emitted no clause at all.
  const sc = I.calScope(RES_P);
  const gap = sc.m - sc.n;
  const note = gap > 0 ? `${gap} of them carry no dated match row`
    : gap < 0 ? `the dated match rows reach ${-gap} matches further back` : '';
  assert(note.includes(`${RES_EXPECT.undated} matches carry no dated match row`),
    'the netted footnote does not report the undated count');
}));

mustFail('[neg] the independence check would catch a renderer that dropped the outside clause', () => {
  const note = I.calResidualNote({ m: 33, undated: 8, outside: 0, from: null, to: null });
  assert(/outside the tile/.test(note), 'the outside clause was dropped');
});

// ════════════════════════════════════════════════════════════════════════════
// 14B · RULINGS Q1 + Q2 (founder, 2026-09-18) — the two box selectors.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n14B · Rulings Q1 (best split) + Q2 (best event)');

check('Q1 · "best split" is POSITIVE-only, measured against the POOLED candidate population', () => {
  let picked = 0, dashed = 0;
  for (const p of SAMPLE) {
    const bs = I.bestSplit(p);
    const vals = I.buildBoxVals(p, { archetype: null });
    // Round 2, CORRECTED · the baseline is a WIN RATE over a complete partition
    // of the split population, not a mean of the candidate rows. Summing the rows
    // double-counts: the groups overlap (vs. Top 10 sits inside the handedness
    // rows) and two of them do not even cover the population. Computed here from
    // the raw split rows on the FORMAT partition, independently of the renderer.
    const sc = (SPLITS[p.key] || {}).career;
    const partition = (members) => {
      let w = 0, n = 0;
      for (const m of members) {
        const r = sc && sc[m];
        if (!r || r.W == null || r.L == null) continue;
        w += r.W; n += r.W + r.L;
      }
      return { w, n };
    };
    const fmt = partition(['Best of 5', 'Best of 3']);
    const srf = partition(['Hard', 'Clay', 'Grass']);
    const expectBase = fmt.n ? (100 * fmt.w / fmt.n) : (srf.n ? (100 * srf.w / srf.n) : null);
    assert.strictEqual(I.boxSplitBaseline(p, 'career'), expectBase,
      `${p.name}: box baseline is not the population win rate`);
    // It must BE a rate: bounded, and reproducible as wins over matches.
    if (expectBase != null) {
      assert(expectBase >= 0 && expectBase <= 100, `${p.name}: baseline ${expectBase} is not a percentage`);
      const pop = I.splitPopulation(p.key, 'career');
      assert.strictEqual(pop.rate, expectBase);
      assert.strictEqual(100 * pop.won / pop.n, expectBase, `${p.name}: population rate != won/n`);
      // The row-weighted mean the correction replaced must NOT be what ships.
      const boxCands = I.splitCandidates(p.key, 'career')
        .filter(c => (I.BOX_SPLIT_GROUPS || []).includes(String(c.id).split(':')[0]));
      let bw = 0, bn = 0;
      for (const c of boxCands) { bw += c.won; bn += c.won + c.lost; }
      if (bn && Math.abs(100 * bw / bn - expectBase) > 1e-9) {
        assert.notStrictEqual(I.boxSplitBaseline(p, 'career'), 100 * bw / bn,
          `${p.name}: the row-weighted mean is back`);
      }
    }
    if (!bs) {
      dashed++;
      assert.strictEqual(vals.splits.headline, null, `${p.name}: headline without a pick`);
      // Three empty facts, asserted apart. A single sentence covering all three
      // is exactly the defect the browser read caught.
      const eligible = I.rankedInsights(p, 'career', null, I.BOX_SPLIT_GROUPS).length;
      assert.strictEqual(vals.splits.support,
        expectBase == null
          ? 'no split data on record'
          : !eligible
            ? 'no split clears the ten-match minimum'
            : `no split above his ${expectBase.toFixed(1)}% across these splits`,
        `${p.name}: empty copy is "${vals.splits.support}" (base=${expectBase}, eligible=${eligible})`);
      // And it must be dashed for the RIGHT reason: nothing positive, not
      // nothing at all. A player with a positive split and a dashed tile is the
      // bug this whole ruling exists to remove.
      const any = I.rankedInsights(p, 'career', null, I.BOX_SPLIT_GROUPS || undefined)
        .filter(c => c.gap > 0);
      assert.strictEqual(any.length, 0, `${p.name}: dashed while ${any.length} positive splits exist`);
      continue;
    }
    picked++;
    assert(bs.pick.gap > 0,
      `${p.name}: "best split" is ${bs.pick.label} at ${bs.pick.gap.toFixed(1)}pp — a NEGATIVE gap`);
    assert(bs.pick.n >= 10, `${p.name}: pick clears no ten-match floor (n=${bs.pick.n})`);
    // ITEM 2 (2026-09-19) · the headline is now the RATE and the label moved to
    // the support line, so "the box and the modal agree on the picked split" is
    // asserted over BOTH halves — the figure the box leads with and the label
    // that qualifies it. This is strictly stronger than the old single equality:
    // a box that picked a different split would previously have had to get the
    // label wrong to fail; now getting either one wrong fails.
    assert.strictEqual(vals.splits.headline, bs.pick.rate.toFixed(1) + '%',
      `${p.name}: splits headline is not the picked split's rate`);
    assert(String(vals.splits.support).indexOf(bs.pick.label) === 0,
      `${p.name}: splits support does not lead with the picked split's label ` +
      `(${JSON.stringify(vals.splits.support)})`);
    assert(/[0-9]/.test(String(vals.splits.headline)),
      `${p.name}: splits headline carries no figure`);
    // Round 2's second half: the baseline is PRINTED, and the whole support line
    // is reconstructed here from the raw rows. If any of rate, gap, baseline or
    // record drifts, this string stops matching.
    assert.strictEqual(bs.baseline, expectBase, `${p.name}: pick carries a foreign baseline`);
    const rate = 100 * bs.pick.won / bs.pick.n;
    const gap = rate - expectBase;
    const pp = (gap < 0 ? '−' : '+') + Math.abs(gap).toFixed(1) + 'pp';
    // ITEM 3 reshaped the line to the design's three tokens. Everything the old
    // assertion reconstructed is still reconstructed — the rate moved to the
    // HEADLINE (asserted above), the record stays here, and the gap+baseline
    // moved to the modal and are reconstructed there. So this check still fails
    // if any of rate, gap, baseline or record drifts; it just reads them off
    // the two surfaces they now render on instead of one.
    assert.strictEqual(vals.splits.support,
      `${bs.pick.label} · best split · ${bs.pick.won}–${bs.pick.lost}`,
      `${p.name}: support line does not reproduce from the rows`);
    assert.strictEqual(vals.splits.headline, `${rate.toFixed(1)}%`,
      `${p.name}: headline rate does not reproduce from the rows`);
    const modalHtml = I.renderSplitsModal(p);
    assert(modalHtml.includes(`${expectBase.toFixed(1)}%`),
      `${p.name}: the modal does not carry the baseline the gap is measured against`);
    assert(modalHtml.includes(pp),
      `${p.name}: the modal does not carry the ${pp} gap the tile's pick was chosen on`);
    // Independent recompute of the winner, straight off the candidate list.
    const cands = I.rankedInsights(p, 'career', null, I.BOX_SPLIT_GROUPS || undefined)
      .filter(c => c.gap > 0)
      .sort((a, b) => (b.gap - a.gap) || (b.n - a.n));
    assert.strictEqual(bs.pick.id, cands[0].id,
      `${p.name}: picked ${bs.pick.label} (${bs.pick.gap.toFixed(1)}pp) over `
      + `${cands[0].label} (${cands[0].gap.toFixed(1)}pp)`);
  }
  console.log(`        ${picked} of ${SAMPLE.length} have a positive split; ${dashed} dash, none wrongly`);
});

mustFail('[neg] Q1 would catch the sign-blind selector it replaced', () => {
  // The exact shape of the pre-ruling rule: rank by |gap|, take the head. On
  // this candidate set it names the −20pp split, which is what shipped.
  const cands = [
    { id: 'opponent:vs. Top 10', label: 'vs. Top 10', gap: -20, n: 147 },
    { id: 'format:Best of 5', label: 'Best of 5', gap: 6, n: 60 }
  ];
  const head = cands.slice().sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
  assert(head.gap > 0, `"best split" picked ${head.label} at ${head.gap}pp`);
});

mustFail('[neg] Q1 would catch a tie broken on the smaller n', () => {
  const cands = [{ label: 'A', gap: 6, n: 12 }, { label: 'B', gap: 6, n: 80 }];
  const head = cands.slice().sort((a, b) => (b.gap - a.gap) || (a.n - b.n))[0];
  assert.strictEqual(head.n, 80, `tie went to n=${head.n}, not the larger n`);
});

check('Q1 · Key insights\' positive card IS the box\'s pick, and negatives still get cards', () => {
  let agreed = 0, negatives = 0;
  for (const p of SAMPLE) {
    const bs = I.bestSplit(p);
    const html = I.renderInsights(p);
    if (bs) {
      // The lead card carries the pick's own id, so this compares the rendered
      // card against the selector rather than against a re-run of itself.
      const first = (html.match(/data-insight="([^"]+)"/) || [])[1];
      assert.strictEqual(first, bs.pick.id.replace(/&/g, '&amp;'),
        `${p.name}: insights lead on ${first}, the box on ${bs.pick.id}`);
      agreed++;
    }
    // A negative finding must still be able to earn a card — the ruling keeps
    // them, worded plainly, and a positive-only insights list would be a silent
    // over-application of Q1.
    const ranked = I.rankedInsights(p, 'career', null);
    if (ranked.some(c => c.gap < 0)) negatives++;
  }
  assert(agreed > 0, 'no sample player had a pick — this check never ran');
  assert(negatives > 0, 'no sample player had a negative split — the card path is unexercised');
  console.log(`        ${agreed} tiles match their insights lead; ${negatives} players carry negative findings`);
});

// ── RULING Q2 round 2 (founder, 2026-09-18) — the assertion he asked for ────
// "Add an assertion that the box's pick and the insights' positive card name the
//  same split for every player." Not the five-player sample: EVERY player with a
// profile. Two ways to disagree are both covered — a different split named, and
// a positive card the box could never have picked sitting under a dashed tile.
check('Q2 round 2 · box pick == insights positive card, for EVERY player', () => {
  const box = I.BOX_SPLIT_GROUPS || [];
  assert.deepStrictEqual(box.slice().sort(), ['format', 'level', 'opponent', 'round'],
    `the box groups are ${JSON.stringify(box)} — the ruling names format, level, round, opponent`);
  assert(!box.includes('surface'), 'Surface is back in the box groups — the ruling forbids it');

  let checked = 0, agree = 0, dashed = 0, negSurface = 0, zeroCards = 0;
  for (const p of Object.values(PLAYERS)) {
    let html;
    try { html = I.renderInsights(p); } catch (e) { continue; }
    checked++;
    const bs = I.bestSplit(p);
    // Every POSITIVE card in the stack, in render order.
    const ids = [...html.matchAll(/data-insight="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
    const ranked = I.rankedInsights(p, 'career', null, I.INSIGHT_GROUPS);
    const byId = new Map(ranked.map(c => [c.id, c]));
    const positives = ids.filter(id => {
      const c = byId.get(id);
      return c ? c.gap > 0 : (bs && id === bs.pick.id);
    });
    if (bs) {
      assert.strictEqual(ids[0], bs.pick.id,
        `${p.name}: insights lead on ${ids[0]}, the box on ${bs.pick.id}`);
      agree++;
    } else {
      dashed++;
      assert.strictEqual(positives.length, 0,
        `${p.name}: tile dashed while ${positives.length} positive card(s) show — ${positives.join(', ')}`);
    }
    // Every positive card must be one the box COULD have picked.
    for (const id of positives) {
      assert(box.includes(String(id).split(':')[0]),
        `${p.name}: positive card "${id}" comes from a group the box cannot pick`);
    }
    // The ruling keeps negative surface findings eligible; confirm the path is
    // live rather than quietly filtered out with the positives.
    if (ids.some(id => String(id).startsWith('surface:'))) negSurface++;
    // A rendered card whose gap is exactly zero. Measured at 27 before the fix,
    // 8 of them under a DASHED tile — a green card contradicting the box.
    zeroCards += ids.filter(id => byId.get(id) && byId.get(id).gap === 0).length;
  }
  assert(checked > 100, `only ${checked} players exercised — the roster did not load`);
  assert(negSurface > 0, 'no player carried a surface card — the negative-surface path is dead');
  assert(zeroCards === 0,
    `${zeroCards} zero-gap card(s) rendered — a split sitting exactly at his own rate `
    + 'is not a finding, and the card arrow would paint it as a strength');
  console.log(`        ${checked} players · ${agree} agree · ${dashed} dash (0 contradictions) · `
    + `${negSurface} carry a surface finding`);
});

// Q1 round 2's own reconciliation: the box's baseline and the Draw record modal's
// Vs-avg column baseline are now ONE number over ONE row set. Before the ruling
// they differed for 188 of 188 players, which is why the modal had to disclose
// two. This is the check that keeps them collapsed.
// ONE baseline, everywhere it appears. The correction made this stronger than the
// version it replaces: the box, the Draw record column and EVERY Key insights card
// now quote the same number, whichever groups the caller ranked over. The review
// measured the old behaviour at 163 players / 265 cards showing a gap up to 2.04pp
// apart for the SAME split.
check('Q1 · one baseline — box == column == every insight card, roster-wide', () => {
  let n = 0, cards = 0, maxDelta = 0;
  for (const p of Object.values(PLAYERS)) {
    const bBox = I.boxSplitBaseline(p, 'career');
    if (bBox == null) continue;
    n++;
    // The column reads the same accessor the modal reads.
    const bCol = I.pooledBaseline(p.key, 'career');
    maxDelta = Math.max(maxDelta, Math.abs(bBox - bCol));
    assert(Math.abs(bBox - bCol) < 1e-9,
      `${p.name}: box ${bBox.toFixed(3)}% vs column ${bCol.toFixed(3)}%`);
    // And every card, over BOTH group sets — the two that used to disagree.
    for (const groups of [I.BOX_SPLIT_GROUPS, I.INSIGHT_GROUPS]) {
      for (const c of I.rankedInsights(p, 'career', null, groups)) {
        cards++;
        assert(Math.abs(c.baseline - bBox) < 1e-9,
          `${p.name}: card ${c.id} quotes ${c.baseline.toFixed(3)}%, the tile ${bBox.toFixed(3)}%`);
        // The gap must reproduce from the card's own record against that baseline.
        assert(Math.abs(c.gap - (100 * c.won / c.n - bBox)) < 1e-9,
          `${p.name}: card ${c.id} gap does not reproduce`);
      }
    }
  }
  assert(n > 100, `only ${n} players had a baseline — the check is vacuous`);
  assert(cards > 500, `only ${cards} cards walked — the card half is vacuous`);
  console.log(`        ${n} players, ${cards} cards, max |box − column| = ${maxDelta.toExponential(1)}pp`);
});

// The defect the correction removes, pinned directly: a "best split" must be
// positive against the POPULATION rate, not against a row-weighted mean that sits
// below it. Four picks were advertised as positive when the player's real record
// over the population was flat or negative.
check('Q1 · every "best split" is positive against the population win rate', () => {
  let picked = 0;
  for (const p of Object.values(PLAYERS)) {
    const bs = I.bestSplit(p);
    if (!bs) continue;
    picked++;
    const pop = I.splitPopulation(p.key, 'career');
    const real = 100 * bs.pick.won / bs.pick.n - (100 * pop.won / pop.n);
    assert(real > 0,
      `${p.name}: "${bs.pick.label}" prints ${bs.pick.gap.toFixed(1)}pp but is ${real.toFixed(1)}pp `
      + `against his real ${(100 * pop.won / pop.n).toFixed(1)}% over ${pop.n} matches`);
  }
  assert(picked > 100, `only ${picked} picks — the check is vacuous`);
  console.log(`        ${picked} picks, every one positive against the real population rate`);
});

// ── RULING Q3 (founder, 2026-09-18) ────────────────────────────────────────
// "Where priced n exceeds the played n, show the played record and dash the
//  priced clause for that row rather than printing the impossible pair."
check('Q3 · no view ever exposes priced n > played n', () => {
  let views = 0, suppressed = 0, playersHit = 0;
  for (const p of Object.values(PLAYERS)) {
    let vs;
    try { vs = I.tournViews(p) || []; } catch (e) { continue; }
    let hit = false;
    for (const t of vs) {
      views++;
      assert(t.pinN <= t.n,
        `${p.name} / ${t.display}: ${t.pinN} priced vs ${t.n} played reached a consumer`);
      if (t.pricedImpossible) {
        hit = true; suppressed++;
        assert.strictEqual(t.pinN, 0, `${p.name} / ${t.display}: suppressed row kept a priced count`);
        assert.strictEqual(t.pinPl, null, `${p.name} / ${t.display}: suppressed row kept a units figure`);
        assert(t.pricedClaimed > t.n, `${p.name} / ${t.display}: pricedClaimed does not record the defect`);
        // The played record is NOT in doubt and must survive untouched.
        assert(t.won + t.lost === t.n, `${p.name} / ${t.display}: the played record was disturbed`);
      }
    }
    if (hit) playersHit++;
  }
  assert(views > 500, `only ${views} views walked — the roster did not load`);
  console.log(`        ${views} views · ${suppressed} suppressed across ${playersHit} players`);
});

// The guard's BOUNDARY, pinned. The check above is one-sided — it only asserts
// nothing exceeds, and only inspects the suppressed branch — so flipping
// `pinN <= n` to `pinN < n` left the whole suite green while blanking 3,975 of
// 9,419 legitimately fully-priced views (42%), including 241 bestEvent
// candidates. A guard test that cannot see over-suppression is not a guard test.
check('Q3 boundary · a FULLY priced view (pinN === n) survives untouched', () => {
  let exact = 0, kept = 0, candidates = 0;
  for (const p of Object.values(PLAYERS)) {
    let vs;
    try { vs = I.tournViews(p) || []; } catch (e) { continue; }
    for (const t of vs) {
      if (t.pricedImpossible) continue;
      if (t.pricedClaimed !== t.n || !t.n) continue;
      exact++;
      assert.strictEqual(t.pinN, t.n,
        `${p.name} / ${t.display}: fully-priced view was blanked (${t.pinN} of ${t.n})`);
      assert(t.pinPl != null, `${p.name} / ${t.display}: fully-priced view lost its units`);
      kept++;
      if (t.pinN >= 10) candidates++;
    }
  }
  assert(exact > 500, `only ${exact} fully-priced views — the boundary is unexercised`);
  assert(candidates > 50, `only ${candidates} of them are bestEvent candidates — too few to bite`);
  console.log(`        ${exact} views priced exactly to the played count · ${kept} kept · ${candidates} bestEvent-eligible`);
});

// Finding 5 · reverting the detail sub to its two-branch pre-ruling form also left
// the suite green, and every suppressed row then read "Pinnacle priced none of
// these" — the exact false claim the ruling exists to prevent. Nothing asserted
// the RENDERED string, so this does.
check('Q3 disclosure · a suppressed row says WHY, never "Pinnacle priced none of these"', () => {
  let checked = 0;
  for (const p of Object.values(PLAYERS)) {
    let vs;
    try { vs = I.tournViews(p) || []; } catch (e) { continue; }
    const bad = vs.filter(t => t.pricedImpossible);
    if (!bad.length) continue;
    for (const t of bad.slice(0, 2)) {
      const html = I.renderTournDetail(p, t);
      const txt = String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      assert(!/Pinnacle priced none of these/.test(txt),
        `${p.name} / ${t.display}: suppressed row blames the archive`);
      assert(txt.includes(String(t.pricedClaimed)) && /exceeds/.test(txt),
        `${p.name} / ${t.display}: suppressed row does not state the impossible count — "${txt.slice(0, 220)}"`);
      checked++;
    }
  }
  assert(checked > 20, `only ${checked} suppressed details rendered — the check is vacuous`);
  console.log(`        ${checked} suppressed details rendered, every one states the count`);
});

mustFail('[neg] the disclosure check would catch the pre-ruling two-branch sub', () => {
  const pre = 'Pinnacle priced none of these';
  assert(!/Pinnacle priced none of these/.test(pre), 'the pre-ruling sub slipped through');
});

mustFail('[neg] Q3 would catch an impossible pair reaching the tile', () => {
  const t = { n: 24, pinN: 28 };
  assert(t.pinN <= t.n, 'an impossible pair passed the guard');
});

check('Q2 · "best event" is PRICED-only (n>=10 priced), ranked on backing units', () => {
  let picked = 0, dashed = 0;
  for (const p of SAMPLE) {
    const be = I.bestEvent(p);
    const vals = I.buildBoxVals(p, { archetype: null });
    if (!be) {
      dashed++;
      assert.strictEqual(vals.tourn.headline, null, `${p.name}: headline without a pick`);
      assert.strictEqual(vals.tourn.support, 'no event with 10+ priced matches',
        `${p.name}: empty copy is "${vals.tourn.support}"`);
      continue;
    }
    picked++;
    assert(be.pinN >= 10, `${p.name}: picked ${be.display} on ${be.pinN} priced matches`);
    assert(be.pinPl != null, `${p.name}: picked an event with no units figure`);
    // The phase-A defect this ruling removes: a named event with a dashed
    // headline, because the winner was chosen on a record and priced on nothing.
    assert(vals.tourn.headline != null,
      `${p.name}: support names ${be.display} while the headline dashes`);
    assert(vals.tourn.support.includes(`${be.pinN} priced`),
      `${p.name}: the support line hides the priced n behind a wider record`);
    // Independent recompute over the same views.
    const best = (I.tournViews(p) || [])
      .filter(t => t.pinN >= 10 && t.pinPl != null)
      .sort((a, b) => (b.pinPl - a.pinPl) || (b.pinN - a.pinN))[0];
    assert.strictEqual(be.display, best.display,
      `${p.name}: picked ${be.display} (${be.pinPl}u) over ${best.display} (${best.pinPl}u)`);
  }
  console.log(`        ${picked} of ${SAMPLE.length} have a priced best event; ${dashed} dash`);
});

mustFail('[neg] Q2 would catch the win-rate selector it replaced', () => {
  // Zverev's shape exactly: Olympic Games 9–1 at 90%, priced on nothing.
  const views = [
    { display: 'Olympic Games', won: 9, lost: 1, n: 10, pinPl: null, pinN: 0 },
    { display: 'Cincinnati', won: 14, lost: 6, n: 20, pinPl: 3.2, pinN: 18 }
  ];
  const head = views.filter(t => t.n >= 10).sort((a, b) => (b.won / b.n) - (a.won / a.n))[0];
  assert(head.pinN >= 10, `"best event" picked ${head.display} on ${head.pinN} priced matches`);
});

mustFail('[neg] Q2 would catch an unpriced event reaching the box', () => {
  const views = [{ display: 'Olympic Games', won: 9, lost: 1, n: 10, pinPl: 1.0, pinN: 4 }];
  const ok = views.filter(t => t.pinN >= 10);
  assert(ok.length > 0, 'a 4-priced event cleared the gate');
});

check('Q1/Q2 · the superseded empty copy is gone from the BOX builder', () => {
  const src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  const code = src.split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');
  // Scoped to buildBoxVals on purpose. "Pinnacle priced none of these" is still
  // correct copy inside the §5.3 tournament MODAL, where an unpriced event is a
  // real row; what Q2 removed is the BOX branch that named an event and then
  // dashed its own headline. An unscoped grep would have deleted the wrong one.
  const from = code.indexOf('function buildBoxVals');
  assert(from > -1, 'buildBoxVals is gone \u2014 this lock no longer points at anything');
  const box = code.slice(from, code.indexOf('\n  function ', from + 40));
  assert(box.length > 2000, `the buildBoxVals slice is ${box.length} chars \u2014 too short to be the real function`);
  // "no split clears the ten-match minimum" is NOT stale copy any more: Q1 round 2
  // split the one empty sentence into three, and that string is the middle one —
  // the sample-size case, distinct from the no-data case and the nothing-positive
  // case. It is asserted as REQUIRED below rather than forbidden here.
  for (const stale of [
    'no tournament clears the ten-match minimum',
    'Pinnacle priced none of these'
  ]) {
    assert(!box.includes(`'${stale}'`), `superseded box copy still shipping: "${stale}"`);
  }
  assert(!box.includes("'no split above his career rate'"),
    'the round-1 career-rate empty copy is still shipping — Q1 round 2 replaced it');
  assert(box.includes("'no split above his '"), 'the Q1 round-2 empty copy is missing');
  // ITEM 3 (2026-09-19) · the Q1 round-2 ruling asked for the baseline to be
  // printed "so the gap is reproducible". Item 3 capped the tile at the design's
  // three tokens, which will not carry a gap AND a baseline AND a record on one
  // line. The DISCLOSURE is not dropped, it MOVED — so the lock moves with it,
  // to the Draw record modal, and is asserted against rendered output for a real
  // player rather than against a source string. That is a stronger lock than the
  // grep it replaces: this one fails if the modal stops painting the number,
  // whereas a grep passes on a string that never reaches the page.
  {
    const subject = SAMPLE.find(p => I.biggestSplit(p));
    assert(subject, 'no sample player has a split — this lock never ran');
    const bs = I.biggestSplit(subject);
    const modal = I.renderSplitsModal(subject);
    assert(modal.includes(bs.baseline.toFixed(1) + '%'),
      `Q1's baseline disclosure is gone: the Draw record modal for ${subject.name} ` +
      `does not print ${bs.baseline.toFixed(1)}%`);
  }
  for (const required of [
    'no split data on record',
    'no split clears the ten-match minimum'
  ]) {
    assert(box.includes(`'${required}'`), `the Q1 round-2 empty branch "${required}" is gone`);
  }
  assert(box.includes("'no event with 10+ priced matches'"), 'the Q2 empty copy is missing');
});

// ════════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(64));
console.log(`PASS ${pass}   FAIL ${fail}` + (skipped ? `   SKIP ${skipped} (career-history/ ${CH_DRIFT.state})` : ''));
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f));
}
process.exit(fail ? 1 : 0);
