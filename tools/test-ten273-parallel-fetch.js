#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// TEN-273 item 5 — the Trading Report splits and Series streaks generators fetch
// their per-player get_fixtures windows through a bounded pool (default 8) instead
// of one at a time + a 150 ms sleep. The claim this suite holds them to:
//
//   GIVEN IDENTICAL API RESPONSES, THE OUTPUT IS BYTE-IDENTICAL TO THE SERIAL BUILD —
//   every shard, the index, the divergence report, series.json, the outcomes
//   ledger, stdout, stderr and the exit code — even when the responses resolve
//   OUT OF ORDER, and when a fetch fails.
//
// How: the REAL scripts run as child processes under `node -r <stub>`. The stub
// replaces globalThis.fetch with deterministic synthetic api-tennis responses
// (fixtures with box scores, a slate, standings, odds), freezes the clock, and —
// on the "random" leg — delays each player's fixtures by a random 0-15 ms so the
// pool completes in a scrambled order (logged, and asserted to be scrambled, so
// the equivalence is not vacuously tested on in-order completion).
//
// Oracles, in order of strength:
//   1. the ORIGINAL serial script (git object BASELINE_SHA — origin/main when the
//      pool landed), run on the same stub. Needs that object in the clone; a
//      shallow clone that has lost it SKIPS THIS LEG OUT LOUD (never a pass).
//   2. the shipped script at concurrency 1 with no delay (completion order ==
//      roster order by construction). Always runs.
// Control: a mutant of the shipped script that slots results in COMPLETION order
// (anchor replaced exactly once, asserted) must FAIL the equivalence.
//
// Scenarios: mixed (one rejected fetch, one success:0), allfail (every player
// fetch rejects: trading must still fail loud, exit 1, no index), throw (a
// malformed fixture throws outside the per-player try mid-roster: exit 1 AFTER
// the earlier shards are written, exactly as the serial loop did).
//
// Also executes the REAL combined workflow run block (trading + series in
// parallel) with a fake `node`, to prove the step's exit code is trading's alone.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BASELINE_SHA = 'ce99fcdb43ee3c4f72bc0727c3fa510b9701feba';
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'pipeline.yml');

let pass = 0; const fails = []; const skips = [];
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fails.push(name); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
const TMP = [];
function tmpdir(tag) { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `ten273-${tag}-`))); TMP.push(d); return d; }

// ── synthetic universe ───────────────────────────────────────────────────────
const ROSTER = Array.from({ length: 30 }, (_, i) => 1000 + i * 37);   // player-profiles keys
const FAIL_KEY = ROSTER[4];    // fetch rejects (network error)
const EMPTY_KEY = ROSTER[9];   // success:0 (transient api failure -> [])
const THROW_KEY = ROSTER[17];  // 'throw' scenario: malformed statistics row
const EXTRA = [5001, 5002];    // slate players absent from player-profiles (standings rank path)
const NOW_ISO = '2026-09-20T12:00:00.000Z';

const STUB = String.raw`
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = process.env.TEN273_ROOT;
const VARIANT_DIR = process.env.TEN273_VARIANT_DIR;
// Variant scripts (baseline / mutant copies) live outside the repo; resolve their
// requires ('./bsp-pipeline.js', dotenv, ...) as if they sat in the repo root.
const origResolve = Module._resolveFilename;
const fakeParent = { id: path.join(ROOT, '_x.js'), filename: path.join(ROOT, '_x.js'), paths: Module._nodeModulePaths(ROOT) };
Module._resolveFilename = function (req, parent, ...rest) {
  if (VARIANT_DIR && parent && parent.filename && parent.filename.startsWith(VARIANT_DIR)) return origResolve.call(this, req, fakeParent, ...rest);
  return origResolve.call(this, req, parent, ...rest);
};
// Frozen clock (generatedAt, windows, URLs).
const FIXED = Date.parse(process.env.TEN273_NOW);
const RealDate = Date;
class FakeDate extends RealDate { constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); } static now() { return FIXED; } }
globalThis.Date = FakeDate;
// Pacing sleeps (>=100 ms: PACE_MS, get_odds 120 ms, retries) carry no output; squash
// them so the serial baseline runs in seconds. Stub jitter (<20 ms) is kept.
const rst = setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => rst(fn, (ms || 0) >= 100 ? 0 : ms, ...a);

const SCEN = process.env.TEN273_SCENARIO || 'mixed';
const DELAY = process.env.TEN273_DELAY || 'none';
const ORDER_LOG = process.env.TEN273_ORDER_LOG || '';
const FAIL_KEY = ${FAIL_KEY}, EMPTY_KEY = ${EMPTY_KEY}, THROW_KEY = ${THROW_KEY};
const SLATE_KEYS = ${JSON.stringify([...ROSTER.slice(0, 22), ...EXTRA])};

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const TOURNEYS = [
  { k: '1001', n: 'Stub Hard Open' }, { k: '1002', n: 'Stub Clay Cup' }, { k: '1003', n: 'Stub Grass Trophy' },
  { k: '1004', n: 'US Open', slam: true }, { k: '1005', n: 'Stub Indoor' }, { k: '1006', n: 'Stub Unmapped Event' },
];
const METRICS = [['Points', 'Service Points Won'], ['Points', 'Return Points Won'], ['Service', 'Break Points Saved'], ['Return', 'Break Points Converted'], ['Games', 'Service Games Won']];
const WIN_SETS = [[6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [7, 5], ['7.7', '6.4']];
const ymd = ms => new RealDate(ms).toISOString().slice(0, 10);

function statRows(r, pk, i) {
  const rows = [];
  for (const [ty, nm] of METRICS) {
    const w = 3 + Math.floor(r() * 40), t = w + Math.floor(r() * 30);
    const roll = r();
    const name = i % 2 ? nm : nm.toLowerCase();
    if (roll < 0.05) rows.push({ player_key: String(pk), stat_period: 'match', stat_type: ty, stat_name: name, stat_won: null, stat_total: null, stat_value: w + '/' + t });
    else if (roll < 0.08) rows.push({ player_key: String(pk), stat_period: 'match', stat_type: ty, stat_name: name, stat_won: null, stat_total: null, stat_value: '40%' });
    else if (roll < 0.10) rows.push({ player_key: String(pk), stat_period: 'match', stat_type: ty, stat_name: name, stat_won: t + 3, stat_total: t, stat_value: '' });
    else rows.push({ player_key: String(pk), stat_period: 'match', stat_type: ty, stat_name: name, stat_won: w, stat_total: t, stat_value: w + '/' + t });
    rows.push({ player_key: String(pk), stat_period: 'set1', stat_type: ty, stat_name: name, stat_won: 1, stat_total: 2, stat_value: '1/2' });
  }
  // trailing fragment block (first block must win)
  rows.push({ player_key: String(pk), stat_period: 'match', stat_type: 'Points', stat_name: 'Service Points Won', stat_won: 1, stat_total: 1, stat_value: '1/1' });
  return rows;
}

function fixture(r, k, i, dateStr, won, forced) {
  const t = TOURNEYS[Math.floor(r() * TOURNEYS.length)];
  const tierTour = (k % 2 === 0) ? r() < 0.75 : r() < 0.3;
  const tt = tierTour ? 'Atp Singles' : (r() < 0.9 ? 'Challenger Men Singles' : 'Itf Men Singles');
  const slam = !!t.slam && tierTour;
  const oppKey = 700000 + Math.floor(r() * 400);
  const meFirst = r() < 0.5;
  const sr = r();
  const status = forced ? 'Finished' : sr < 0.04 ? 'Retired' : sr < 0.07 ? 'Walk Over' : 'Finished';
  const need = slam ? 3 : 2;
  const lost = forced ? 0 : Math.floor(r() * need);
  const seq = [];
  for (let s = 0; s < lost; s++) seq.push(false);
  for (let s = 0; s < need - 1; s++) seq.push(true);
  for (let s = seq.length - 1; s > 0; s--) { const j = Math.floor(r() * (s + 1)); [seq[s], seq[j]] = [seq[j], seq[s]]; }
  seq.push(true);                       // the match winner takes the last set
  const scores = []; let fS = 0, sS = 0;
  if (status !== 'Walk Over') seq.forEach((winnerTookSet, n) => {
    const [a, b] = WIN_SETS[Math.floor(r() * WIN_SETS.length)];
    const firstWonSet = winnerTookSet === (won === meFirst);   // winner-of-match POV -> first POV
    if (firstWonSet) fS++; else sS++;
    scores.push({ score_first: String(firstWonSet ? a : b), score_second: String(firstWonSet ? b : a), score_set: String(n + 1) });
  });
  const firstKey = meFirst ? k : oppKey, secondKey = meFirst ? oppKey : k;
  const fx = {
    event_key: String(k * 1000 + i), event_date: dateStr, event_time: '12:00', event_status: status,
    event_type_type: tt, event_qualification: 'False',
    first_player_key: String(firstKey), second_player_key: String(secondKey),
    event_first_player: meFirst ? 'P. Player' + k : 'O. Opp' + oppKey,
    event_second_player: meFirst ? 'O. Opp' + oppKey : 'P. Player' + k,
    event_winner: (won === meFirst) ? 'First Player' : 'Second Player',
    event_final_result: fS + ' - ' + sS,
    tournament_key: t.k, tournament_name: t.n, scores,
  };
  if (r() < 0.85) fx.statistics = [...statRows(r, k, i), ...statRows(r, oppKey, i)];
  return fx;
}

const SERVED = new Map();   // event_key -> date, for get_odds
function fixturesFor(k) {
  const r = rng(Math.imul(k, 2654435761));
  const out = [];
  let day = RealDate.UTC(2026, 8, 19);
  const forceRun = k % 3 === 0 ? 7 : 0;
  const pWin = 0.35 + r() * 0.45;
  for (let i = 0; i < 55; i++) {
    const d = ymd(day);
    day -= (2 + Math.floor(r() * 14)) * 86400000;
    const forced = i < forceRun;
    out.push(fixture(r, k, i, d, forced ? true : r() < pWin, forced));
  }
  out.push(JSON.parse(JSON.stringify(out[3])));                       // duplicate event_key (dedupe path)
  out.push(fixture(r, k, 99, '2026-09-25', true, true));              // future-dated (window upper bound)
  if (SCEN === 'throw' && k === THROW_KEY) (out[1].statistics = out[1].statistics || []).unshift(null);
  for (const fx of out) SERVED.set(fx.event_key, fx.event_date);
  return out;
}

function slate() {
  const rows = [];
  for (let i = 0; i + 1 < SLATE_KEYS.length; i += 2) {
    const a = SLATE_KEYS[i], b = SLATE_KEYS[i + 1];
    const t = TOURNEYS[i % TOURNEYS.length];
    const played = i % 8 === 0;
    const date = (i % 4 === 0) ? '2026-09-20' : '2026-09-21';
    rows.push({
      event_key: String(900000 + i), event_date: played ? '2026-09-20' : date, event_time: String(10 + (i % 9)) + ':30',
      event_status: played ? 'Finished' : '', event_type_type: (i % 3 === 0) ? 'Atp Singles' : 'Challenger Men Singles',
      event_qualification: 'False',
      first_player_key: String(a), second_player_key: String(b),
      event_first_player: 'P. Player' + a, event_second_player: 'P. Player' + b,
      event_winner: played ? 'First Player' : null, event_final_result: played ? '2 - 0' : '-',
      tournament_key: t.k, tournament_name: t.n,
      scores: played ? [{ score_first: '6', score_second: '4', score_set: '1' }, { score_first: '6', score_second: '3', score_set: '2' }] : [],
    });
  }
  // a player on the slate twice (soonest-unplayed preference)
  rows.push({ ...rows[1], event_key: '909999', event_date: '2026-09-21', event_time: '09:00', first_player_key: String(SLATE_KEYS[2]), event_first_player: 'P. Player' + SLATE_KEYS[2], second_player_key: '5002', event_second_player: 'P. Player5002' });
  return rows;
}

const reply = (obj) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(obj)) });
globalThis.fetch = async (u) => {
  const url = new URL(String(u));
  const m = url.searchParams.get('method');
  const pk = url.searchParams.get('player_key');
  if (m === 'get_fixtures' && pk) {
    const k = Number(pk);
    if (DELAY === 'random') await new Promise(res => rst(res, Math.floor(Math.random() * 16)));
    if (ORDER_LOG) fs.appendFileSync(ORDER_LOG, pk + '\n');
    if (SCEN === 'allfail' || k === FAIL_KEY) throw new Error('stub: ECONNRESET for ' + pk);
    if (k === EMPTY_KEY) return reply({ success: 0, result: 'stub transient' });
    return reply({ success: 1, result: fixturesFor(k) });
  }
  if (m === 'get_fixtures') return reply({ success: 1, result: slate() });
  if (m === 'get_standings') return reply({ success: 1, result: [{ player_key: '5001', place: '151' }, { player_key: String(SLATE_KEYS[0]), place: '12' }, { player_key: '5002', place: '0' }] });
  if (m === 'get_odds') {
    const d = url.searchParams.get('date_start');
    const res = {};
    const keys = [...SERVED].filter(([, dd]) => dd === d).map(([ek]) => ek).sort((x, y) => Number(x) - Number(y));
    for (const ek of keys) {
      const h = Number(ek) % 7;
      if (h === 0) continue;                                     // no market
      const ha = { Home: { bet365: (1.3 + h / 10).toFixed(2) }, Away: { bet365: (3.1 - h / 10).toFixed(2) } };
      if (h % 2) { ha.Home.Pncl = (1.32 + h / 10).toFixed(2); ha.Away.Pncl = (3.05 - h / 10).toFixed(2); }
      res[ek] = { 'Home/Away': ha };
    }
    return reply({ success: 1, result: res });
  }
  throw new Error('stub: unexpected url ' + url.pathname + '?method=' + m);
};
`;

// ── inputs ───────────────────────────────────────────────────────────────────
function writeInputs(dir) {
  const players = {};
  ROSTER.forEach((k, i) => { players[k] = { key: k, name: 'P. Player' + k, rank: i % 5 === 0 ? null : 20 + i * 3, country: i % 2 ? 'ESP' : 'ARG' }; });
  fs.writeFileSync(path.join(dir, 'player-profiles.json'), JSON.stringify({ players }));
  fs.writeFileSync(path.join(dir, 'tournament-surfaces.json'), JSON.stringify({ surfaces: { 1001: 'hard', 1002: 'clay', 1003: 'grass', 1004: 'hard', 1005: 'hard' } }));
  const styles = [];
  for (let k = 700000; k < 700400; k++) if (k % 4 < 2) styles.push({ name: 'O. Opp' + k, archetype_label: k % 4 ? 'Counterpuncher' : 'Aggressive Baseliner' });
  for (const k of [...ROSTER, ...EXTRA]) styles.push({ name: 'P. Player' + k, archetype_label: k % 2 ? 'Counterpuncher' : 'Aggressive Baseliner' });
  fs.writeFileSync(path.join(dir, 'playing-styles.json'), JSON.stringify({ players: styles }));
  fs.writeFileSync(path.join(dir, 'series-outcomes.json'), JSON.stringify({ records: { 'seed|1|all': { date: '2026-09-01', held: true, family: 'all', type: 'all' } } }));
}

const SB = tmpdir('sb');
const STUB_FILE = path.join(SB, 'stub.js');
fs.writeFileSync(STUB_FILE, STUB);
const INPUTS = path.join(SB, 'inputs');
fs.mkdirSync(INPUTS);
writeInputs(INPUTS);
const VARIANTS = path.join(SB, 'variants');
fs.mkdirSync(VARIANTS);

function readTree(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).sort()) out[f] = fs.readFileSync(path.join(dir, f), 'utf8');
  return out;
}

let runN = 0;
function run(kind, script, { scenario = 'mixed', delay = 'none', conc, orderLog } = {}) {
  const work = path.join(SB, `run-${++runN}`);
  fs.mkdirSync(work);
  for (const f of fs.readdirSync(INPUTS)) fs.copyFileSync(path.join(INPUTS, f), path.join(work, f));
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, NODE_PATH: process.env.NODE_PATH || '',
    API_TENNIS_KEY: 'stub-key', DOTENV_CONFIG_QUIET: 'true',
    TEN273_ROOT: ROOT, TEN273_VARIANT_DIR: VARIANTS, TEN273_NOW: NOW_ISO,
    TEN273_SCENARIO: scenario, TEN273_DELAY: delay, TEN273_ORDER_LOG: orderLog || '',
  };
  if (kind === 'trading') {
    Object.assign(env, {
      TS_PROFILES: path.join(work, 'player-profiles.json'), TS_SURFACES: path.join(work, 'tournament-surfaces.json'),
      TS_OUT: path.join(work, 'trading-splits'), TS_INDEX: path.join(work, 'trading-splits-index.json'),
      TS_DIVERGENCE: path.join(work, 'trading-splits-divergence.json'),
    });
    if (conc != null) env.TS_CONCURRENCY = String(conc);
  } else {
    Object.assign(env, { SERIES_ROOT: work, SERIES_OUT: path.join(work, 'series.json'), SERIES_OUTCOMES: path.join(work, 'series-outcomes.json') });
    if (conc != null) env.SERIES_CONCURRENCY = String(conc);
  }
  const r = spawnSync(process.execPath, ['-r', STUB_FILE, script], { cwd: work, env, encoding: 'utf8', timeout: 120000 });
  const norm = s => String(s || '').split(script).join('<SCRIPT>').split(work).join('<WORK>');
  const files = kind === 'trading'
    ? { shards: readTree(path.join(work, 'trading-splits')), index: readOpt(path.join(work, 'trading-splits-index.json')), divergence: readOpt(path.join(work, 'trading-splits-divergence.json')) }
    : { series: readOpt(path.join(work, 'series.json')), outcomes: readOpt(path.join(work, 'series-outcomes.json')) };
  return { code: r.status, signal: r.signal, stdout: norm(r.stdout), stderr: norm(r.stderr), files };
}
function readOpt(f) { return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; }

// First differing field between two run snapshots (null = byte-identical).
function firstDiff(a, b) {
  const walk = (x, y, p) => {
    if (typeof x === 'string' || typeof y === 'string' || x == null || y == null || typeof x !== 'object') {
      if (x === y) return null;
      if (typeof x === 'string' && typeof y === 'string') {
        let i = 0; while (i < x.length && x[i] === y[i]) i++;
        return `${p} differs at byte ${i}: …${JSON.stringify(x.slice(Math.max(0, i - 40), i + 60))} vs …${JSON.stringify(y.slice(Math.max(0, i - 40), i + 60))}`;
      }
      return `${p}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`;
    }
    const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].sort();
    for (const k of keys) { const d = walk(x[k], y[k], `${p}.${k}`); if (d) return d; }
    return null;
  };
  return walk(a, b, '$');
}
const assertSame = (a, b, what) => { const d = firstDiff(a, b); assert.strictEqual(d, null, `${what}: ${d}`); };

// ── script variants ─────────────────────────────────────────────────────────
const SCRIPTS = { trading: 'build-trading-splits.js', series: 'build-series.js' };
const NEW = { trading: path.join(ROOT, SCRIPTS.trading), series: path.join(ROOT, SCRIPTS.series) };

function baselineOf(kind) {
  const r = spawnSync('git', ['-C', ROOT, 'show', `${BASELINE_SHA}:${SCRIPTS[kind]}`], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0 || !r.stdout) return null;
  const f = path.join(VARIANTS, `baseline-${SCRIPTS[kind]}`);
  fs.writeFileSync(f, r.stdout);
  return f;
}
// The control: slot each result at the next COMPLETION index instead of its own.
const MUTANT_ANCHORS = {
  trading: ['try { out[i] = { value: await fn(items[i], i) }; } catch (e) { out[i] = { threw: true, thrown: e }; }',
            'let v; try { v = { value: await fn(items[i], i) }; } catch (e) { v = { threw: true, thrown: e }; } out[filled++] = v;',
            'let next = 0;', 'let next = 0; let filled = 0;'],
  series: ['try { fetched[i] = { fixtures: await fetchRecentSinglesFixtures(limit[i]) }; } catch (e) { fetched[i] = { failed: true, error: e }; }',
           'let v; try { v = { fixtures: await fetchRecentSinglesFixtures(limit[i]) }; } catch (e) { v = { failed: true, error: e }; } fetched[filled++] = v;',
           'let nextFetch = 0;', 'let nextFetch = 0; let filled = 0;'],
};
function mutantOf(kind) {
  let src = fs.readFileSync(NEW[kind], 'utf8');
  const a = MUTANT_ANCHORS[kind];
  for (let j = 0; j < a.length; j += 2) {
    const n = src.split(a[j]).length - 1;
    assert.strictEqual(n, 1, `mutant anchor for ${kind} must occur exactly once, found ${n}: ${a[j]}`);
    src = src.replace(a[j], a[j + 1]);
  }
  const f = path.join(VARIANTS, `mutant-${SCRIPTS[kind]}`);
  fs.writeFileSync(f, src);
  return f;
}

console.log('TEN-273 item 5 — pooled fetch equivalence (trading splits + series)');

for (const kind of ['trading', 'series']) {
  console.log(`\n[${kind}]`);
  const orderLog = path.join(SB, `order-${kind}.log`);
  const ref = run(kind, NEW[kind], { conc: 1, delay: 'none' });
  const pooled = run(kind, NEW[kind], { delay: 'random', orderLog });   // default concurrency (8)

  check(`${kind}: reference run is not vacuous`, () => {
    assert.strictEqual(ref.code, 0, `reference exit ${ref.code}\n${ref.stderr.slice(-800)}`);
    if (kind === 'trading') {
      const n = Object.keys(ref.files.shards).length;
      assert.ok(n >= 20, `only ${n} shards`);
      assert.ok(JSON.parse(ref.files.divergence).records.length > 0, 'no divergence records — the report path is unexercised');
      assert.ok(ref.stderr.includes(`fixture window failed for ${FAIL_KEY}`), 'the rejected fetch did not reach the per-player failure path');
      assert.ok(!(`${EMPTY_KEY}.json` in ref.files.shards), 'the success:0 player should have no shard');
    } else {
      const doc = JSON.parse(ref.files.series);
      assert.ok(doc.players.length >= 5, `only ${doc.players.length} series players`);
      assert.ok(doc.odds.census.priced > 0, 'no priced rows — the odds pass is unexercised');
      assert.ok(Object.keys(JSON.parse(ref.files.outcomes).records).length > 1, 'ledger gained no records — the played-match path is unexercised');
      assert.ok(ref.stderr.includes(`fixture window failed for ${FAIL_KEY}`), 'the rejected fetch did not reach the per-player failure path');
    }
  });

  check(`${kind}: the pooled run completed OUT of order (the scramble is real)`, () => {
    const done = fs.readFileSync(orderLog, 'utf8').trim().split('\n');
    const sorted = [...done].sort((x, y) => Number(x) - Number(y));
    const requested = kind === 'trading' ? sorted : null;   // trading requests in roster (numeric) order
    assert.ok(done.length >= 20, `only ${done.length} fetches logged`);
    if (requested) assert.notDeepStrictEqual(done, requested, 'completion order == roster order; the equivalence would be vacuous');
    else {
      // series requests in slate order; a strictly in-order completion would equal a rerun at c=1
      const serialLog = path.join(SB, 'order-series-serial.log');
      run(kind, NEW[kind], { conc: 1, delay: 'none', orderLog: serialLog });
      assert.notDeepStrictEqual(done, fs.readFileSync(serialLog, 'utf8').trim().split('\n'), 'completion order == request order; the equivalence would be vacuous');
    }
  });

  check(`${kind}: pooled (c=8, random delays) is byte-identical to serial (c=1)`, () => assertSame(pooled, ref, kind));

  const base = baselineOf(kind);
  if (!base) {
    skips.push(`${kind}: ORIGINAL-script leg — git object ${BASELINE_SHA.slice(0, 8)} not in this clone`);
    console.log(`  SKIP ${kind}: ORIGINAL-script leg SKIPPED OUT LOUD — ${BASELINE_SHA.slice(0, 8)} is not in this clone (shallow?). The c=1 oracle above still ran.`);
  } else {
    check(`${kind}: pooled is byte-identical to the ORIGINAL serial script (${BASELINE_SHA.slice(0, 8)})`, () => {
      const orig = run(kind, base, { delay: 'random' });
      assertSame(pooled, orig, `${kind} vs original`);
    });
  }

  check(`${kind}: CONTROL — a completion-order mutant is caught`, () => {
    const mut = run(kind, mutantOf(kind), { delay: 'random' });
    // The mutant must RUN (a variant that crashes on load would "differ" vacuously)
    // and must differ in the ARTIFACTS, not merely in exit code or logs.
    assert.strictEqual(mut.code, 0, `mutant did not run cleanly (exit ${mut.code}) — the control is vacuous\n${mut.stderr.slice(-600)}`);
    const d = firstDiff(mut.files, ref.files);
    assert.ok(d, 'the completion-order mutant produced byte-identical output — this suite cannot see ordering');
    console.log(`       (mutant diverges: ${d.slice(0, 140)}…)`);
  });

  for (const scenario of ['allfail', 'throw']) {
    if (scenario === 'throw' && kind === 'series') continue;   // series has no throw path outside its per-player catch
    check(`${kind}: scenario ${scenario} — pooled == serial${base ? ' == original' : ''}`, () => {
      const a = run(kind, NEW[kind], { scenario, delay: 'random' });
      const b = run(kind, NEW[kind], { scenario, conc: 1 });
      assertSame(a, b, `${kind}/${scenario} pooled vs c=1`);
      if (base) assertSame(a, run(kind, base, { scenario, delay: 'random' }), `${kind}/${scenario} pooled vs original`);
      if (kind === 'trading' && scenario === 'allfail') {
        assert.strictEqual(a.code, 1, 'all fetches failed: trading must fail loud (exit 1)');
        assert.strictEqual(a.files.index, null, 'all fetches failed: no index may be published');
      }
      if (kind === 'trading' && scenario === 'throw') {
        assert.strictEqual(a.code, 1, 'a throw outside the per-player try must still exit 1');
        const n = Object.keys(a.files.shards).length;
        assert.ok(n > 0 && n < 30, `the serial loop wrote the shards BEFORE the throwing player (got ${n})`);
        assert.ok(!(`${THROW_KEY}.json` in a.files.shards), 'no shard for the throwing player');
      }
      if (kind === 'series' && scenario === 'allfail') {
        assert.strictEqual(a.code, 0);
        assert.strictEqual(JSON.parse(a.files.series).players.length, 0);
      }
    });
  }
}

// ── the combined workflow step: exit code is trading's alone ─────────────────
console.log('\n[workflow step]');
check('pipeline.yml: combined step keeps id trading_splits + continue-on-error, re-raise reads its outcome', () => {
  const yml = fs.readFileSync(WORKFLOW, 'utf8');
  const i = yml.indexOf('        id: trading_splits\n');
  assert.ok(i > 0, 'no step with id trading_splits');
  const block = yml.slice(yml.lastIndexOf('      - name:', i), yml.indexOf('\n      - name:', i));
  assert.ok(/\n        continue-on-error: true\n/.test(block), 'trading step lost continue-on-error');
  assert.ok(block.includes('node build-trading-splits.js') && block.includes('node build-series.js'), 'both generators must run in the step');
  assert.ok(yml.includes("steps.trading_splits.outcome == 'failure'"), 're-raise step no longer reads the trading outcome');
  assert.ok(!/\n\s+run: node build-series\.js/.test(yml), 'a separate series step still exists — it would run the generator twice');
});

check('pipeline.yml: the REAL run block exits with trading\'s code; series never changes it and always finishes', () => {
  const yml = fs.readFileSync(WORKFLOW, 'utf8');
  const i = yml.indexOf('        id: trading_splits\n');
  const block = yml.slice(i, yml.indexOf('\n      - name:', i));
  const m = /\n        run: \|\n((?:          .*\n|\s*\n)+)/.exec(block + '\n');
  assert.ok(m, 'could not extract the run block');
  const script = m[1].split('\n').map(l => l.replace(/^ {10}/, '')).join('\n');
  for (const [tsRc, seRc] of [[0, 0], [1, 0], [0, 1], [1, 1], [3, 0]]) {
    const d = tmpdir('wf');
    const bin = path.join(d, 'bin'); fs.mkdirSync(bin);
    // fake node: series sleeps so it is still running when trading exits
    fs.writeFileSync(path.join(bin, 'node'), `#!/bin/bash\ncase "$1" in\n  build-series.js) sleep 0.3; echo series-ran; touch "${d}/series.done"; exit ${seRc};;\n  build-trading-splits.js) echo trading-ran; exit ${tsRc};;\nesac\nexit 99\n`);
    fs.chmodSync(path.join(bin, 'node'), 0o755);
    fs.writeFileSync(path.join(d, 'step.sh'), script);
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', path.join(d, 'step.sh')], {
      cwd: d, encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: d },
    });
    assert.strictEqual(r.status, tsRc, `trading rc ${tsRc}, series rc ${seRc}: step exited ${r.status}\n${r.stdout}${r.stderr}`);
    assert.ok(fs.existsSync(path.join(d, 'series.done')), `series did not finish before the step exited (ts ${tsRc})`);
    assert.ok(r.stdout.includes('series-ran'), 'series log was not printed');
  }
});

if (!process.env.TEN273_KEEP) for (const d of TMP) fs.rmSync(d, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fails.length} failed, ${skips.length} skipped out loud`);
for (const s of skips) console.log(`  SKIPPED: ${s}`);
if (fails.length) { console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
