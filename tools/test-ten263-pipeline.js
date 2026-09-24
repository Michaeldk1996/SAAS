#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// TEN-263 follow-up (pipeline) — founder rulings 2026-09-24, four of them:
//
//  1. Missing stored as 0 → fixed at the source. The feed's untracked Winners /
//     Unforced errors placeholder ("0" for BOTH players) is stored as null; a real
//     0 the feed tracked stays 0. Driven through the REAL writers (the pipeline's
//     sheet builders, progression metrics, layer #8 aggregate, 52-week aggregate,
//     the point-by-point parser, and the match-stat store's hydrate/freeze/guards).
//  2. Per-set backlog → the recent-form fetch queue is NEWEST FIRST and the cap is
//     raised. Driven through build-point-by-point.js main() with a stubbed fetch.
//  3. Market-edge crash goes red AFTER the deploy. The build step's real run block
//     and the final step's real command are executed from pipeline.yml.
//  4. Split builds, option 1: if .github/workflows/ differs between the queued SHA
//     and the tip, build the queued SHA. The real "Re-point" run block is executed
//     against throwaway git repositories.
//
// Nothing here re-implements a rule: every case runs the shipped code or the
// shipped workflow text, so reverting a rule turns its case red.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'pipeline.yml');
const YML = fs.readFileSync(WORKFLOW, 'utf8');

let pass = 0; const fails = [];
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fails.push(name); console.log(`  FAIL ${name}\n       ${e.message}`); }
}
const TMP = [];
function tmpdir(tag) { const d = fs.mkdtempSync(path.join(os.tmpdir(), `ten263p-${tag}-`)); TMP.push(d); return d; }

// Quiet the pipeline module's dotenv banner; it prints nothing else on require.
process.env.DOTENV_CONFIG_QUIET = 'true';
const P = require(path.join(ROOT, 'bsp-pipeline.js'));
const PH = require(path.join(ROOT, 'match-stat-placeholders.js'));
const PBP = require(path.join(ROOT, 'build-point-by-point.js'));
const STORE = require(path.join(ROOT, 'tools', 'match-stats-store.js'));

// ── Fixture rows ──────────────────────────────────────────────────────────────
// Shape copied from the live feed: get_fixtures match_key=12156826 (Winston-Salem,
// 2026-08-26, 138 points) returned exactly these W/UE/Net rows for both players.
// A fixture WRITES feed rows with the feed's own casing on purpose, so it names the field through
// NAME_KEY rather than a literal: tools/test-statname-casing.js guards raw READS of that field.
const NAME_KEY = 'stat' + '_name';
const row = (pk, period, type, name, value, won = null, total = null) =>
  ({ player_key: pk, stat_period: period, stat_type: type, [NAME_KEY]: name, stat_value: value, stat_won: won, stat_total: total });
function sheetRows(period, a, b, { w = ['0', '0'], ue = ['0', '0'], tpw = [61, 77] } = {}) {
  const tot = tpw[0] + tpw[1];
  return [
    row(a, period, 'Service', 'Aces', '4'), row(b, period, 'Service', 'Aces', '9'),
    row(a, period, 'Points', 'Winners', w[0]), row(b, period, 'Points', 'Winners', w[1]),
    row(a, period, 'Points', 'Unforced errors', ue[0]), row(b, period, 'Points', 'Unforced errors', ue[1]),
    row(a, period, 'Points', 'Net points won', '0%', 0, 0), row(b, period, 'Points', 'Net points won', '0%', 0, 0),
    row(a, period, 'Points', 'Total Points Won', `${Math.round(100 * tpw[0] / tot)}%`, tpw[0], tot),
    row(b, period, 'Points', 'Total Points Won', `${Math.round(100 * tpw[1] / tot)}%`, tpw[1], tot),
  ];
}
function fixture(ek, date, statistics, a = 2848, b = 10148) {
  return { event_key: ek, event_date: date, first_player_key: a, second_player_key: b,
    event_first_player: 'A. One', event_second_player: 'B. Two', tournament_name: 'Test Open', statistics };
}
const clone = (x) => JSON.parse(JSON.stringify(x));

console.log('\n1 · untracked W/UE is null, a real 0 stays 0\n');

check('the feed placeholder (all four "0") is stored as null in the match sheet — Net points too', () => {
  const ms = P.buildMatchStatsFromFixture(fixture(1, '2026-08-26', sheetRows('match', 2848, 10148)), 2848, 10148);
  for (const s of ['p1', 'p2']) {
    assert.strictEqual(ms[s]['Points:Winners'], null, `${s} Winners = ${ms[s]['Points:Winners']}`);
    assert.strictEqual(ms[s]['Points:Unforced errors'], null, `${s} UE = ${ms[s]['Points:Unforced errors']}`);
    assert.strictEqual(ms[s]['Points:Net points won'], null, `${s} Net = ${ms[s]['Points:Net points won']}`);
  }
  assert.strictEqual(ms.p1['Service:Aces'], 4, 'an unrelated count was touched');
});

check('a real 0 beside a tracked opponent stays 0', () => {
  const ms = P.buildMatchStatsFromFixture(fixture(2, '2026-08-26',
    sheetRows('match', 2848, 10148, { w: ['0', '23'], ue: ['11', '15'] })), 2848, 10148);
  assert.strictEqual(ms.p1['Points:Winners'], 0);
  assert.strictEqual(ms.p2['Points:Winners'], 23);
  assert.strictEqual(ms.p1['Points:Unforced errors'], 11);
});

check('all-zero W/UE over fewer than 10 points (a real early retirement) stays 0', () => {
  const ms = P.buildMatchStatsFromFixture(fixture(3, '2026-08-26',
    sheetRows('match', 2848, 10148, { tpw: [3, 3] })), 2848, 10148);
  assert.strictEqual(ms.p1['Points:Winners'], 0);
  assert.strictEqual(ms.p2['Points:Unforced errors'], 0);
});

check('a W/UE value that is not a count ("" / null) is null, never 0', () => {
  const ms = P.buildMatchStatsFromFixture(fixture(4, '2026-08-26',
    sheetRows('match', 2848, 10148, { w: ['', '20'], ue: [null, '18'] })), 2848, 10148);
  assert.strictEqual(ms.p1['Points:Winners'], null);
  assert.strictEqual(ms.p1['Points:Unforced errors'], null);
  assert.strictEqual(ms.p2['Points:Winners'], 20);
});

check('per set: an untracked set is null while the tracked set keeps its counts', () => {
  const rows = [...sheetRows('set1', 2848, 10148, { w: ['5', '14'], ue: ['4', '6'] }), ...sheetRows('set2', 2848, 10148)];
  const sets = P.buildSetStatsFromFixture(fixture(5, '2026-08-26', rows), 2848, 10148);
  assert.strictEqual(sets['1'].p2['Points:Winners'], 14);
  assert.strictEqual(sets['2'].p1['Points:Winners'], null);
  assert.strictEqual(sets['2'].p2['Points:Unforced errors'], null);
});

check('progression metrics: placeholder W/UE is null, so wueSource is not claimed as api-tennis', () => {
  // extractProgressionMetrics reads the rows it is handed; the fetch layer nulls the
  // placeholder first, exactly as fetchProgressionFixtures does.
  const rows = PH.sanitizeFixture(fixture(6, '2026-08-26', sheetRows('match', 2848, 10148))).statistics;
  const m2 = P.extractProgressionMetrics(rows, 2848, null);
  assert.strictEqual(m2.winnersPct, null, `winnersPct ${m2.winnersPct}`);
  assert.strictEqual(m2.winnersUnforcedRatio, null);
  assert.notStrictEqual(m2.wueSource, 'api-tennis', `wueSource ${m2.wueSource}`);
});

// Layer #8 input: three tracked matches + two placeholder matches.
const L8 = [
  fixture(11, '2026-09-10', sheetRows('match', 2848, 10148, { w: ['30', '20'], ue: ['25', '22'], tpw: [100, 90] })),
  fixture(12, '2026-09-08', sheetRows('match', 2848, 10148, { w: ['20', '10'], ue: ['20', '15'], tpw: [80, 70] })),
  fixture(13, '2026-09-06', sheetRows('match', 2848, 10148, { w: ['10', '10'], ue: ['15', '12'], tpw: [60, 75] })),
  fixture(14, '2026-09-04', sheetRows('match', 2848, 10148)),   // placeholder
  fixture(15, '2026-09-02', sheetRows('match', 2848, 10148)),   // placeholder
];

check('model layer #8 (aggregatePlayerWue): placeholder matches are not in n or the pooled rates', () => {
  const w = P.aggregatePlayerWue(PH.sanitizeFixtures(clone(L8)), 2848, 'A. One');
  assert.ok(w, 'no aggregate');
  assert.strictEqual(w.matches, 3, `n = ${w.matches} (placeholder matches counted)`);
  // Pooled over the three tracked matches' points played (190 + 150 + 135), not the placeholders' too.
  assert.strictEqual(w.winnersRate, Math.round((60 / 475) * 10000) / 10000, `winnersRate ${w.winnersRate}`);
  assert.strictEqual(w.ratio, Math.round((60 / 60) * 1000) / 1000);
});

check('52-week aggregate (aggregateStatsFromFixtures): W/UE average and n over tracked matches only', () => {
  const a = P.aggregateStatsFromFixtures(PH.sanitizeFixtures(clone(L8)), 2848);
  assert.strictEqual(a.stats['Points:Winners'], 20, `avg ${a.stats['Points:Winners']}`);
  assert.strictEqual(a.samples['Points:Winners'], 3, `n ${a.samples['Points:Winners']}`);
});

check('every get_fixtures response in bsp-pipeline.js goes through the placeholder rule', () => {
  const src = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
  const sites = src.split('method=get_fixtures').length - 1;
  const wrapped = (src.match(/sanitizeFixtures?\(/g) || []).length;
  // 9 fetch sites (8 list responses + 1 match_key) + 2 builder guards.
  assert.ok(sites >= 9 && wrapped >= sites + 2, `get_fixtures sites ${sites}, sanitize calls ${wrapped}`);
  assert.ok(!/parseInt\([^)]*stat_value[^)]*\)\s*\|\|\s*0/.test(src), 'a `parseInt(stat_value) || 0` count parse is back');
});

check('build-point-by-point parser: fresh fixture → null match + per-set W/UE', () => {
  const rows = [...sheetRows('match', 2848, 10148), ...sheetRows('set1', 2848, 10148)];
  const got = PBP.parseFixture(fixture(7, '2026-08-26', rows));
  assert.strictEqual(got.matchStats.p1['Points:Winners'], null);
  assert.strictEqual(got.stats['1'].p2['Points:Unforced errors'], null);
});

// The stored shape, as written before the rule (historical-match-stats + pbp cache).
const zeroPair = () => ({
  p1: { 'Service:Aces': 4, 'Points:Winners': 0, 'Points:Unforced errors': 0, 'Points:Total Points Won': 44.2, raw: { 'Points:Total Points Won': { won: 61, total: 138 } } },
  p2: { 'Service:Aces': 9, 'Points:Winners': 0, 'Points:Unforced errors': 0, 'Points:Total Points Won': 55.8, raw: { 'Points:Total Points Won': { won: 77, total: 138 } } },
});

check('stored point-by-point cache sheets (match + per set) are corrected on load', () => {
  const cache = { 7: { sets: [], stats: { 1: zeroPair(), 2: zeroPair() }, matchStats: zeroPair() } };
  assert.strictEqual(PH.sanitizePbpCache(cache), 3);
  assert.strictEqual(cache[7].matchStats.p2['Points:Winners'], null);
  assert.strictEqual(cache[7].stats[2].p1['Points:Unforced errors'], null);
  const src = fs.readFileSync(path.join(ROOT, 'build-point-by-point.js'), 'utf8');
  const load = src.indexOf("JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))");
  const fix = src.indexOf('sanitizePbpCache(cache)');
  const write = src.indexOf('fs.mkdirSync(SETSTATS_DIR');
  assert.ok(load > 0 && fix > load && fix < write, 'build-point-by-point main() does not sanitize the cache between load and the setstats/ write');
});

check('match-stat store: a placeholder 0 and a null have the same depth (guards cannot refuse the fix)', () => {
  const z = zeroPair(); const n = zeroPair(); PH.nullPlaceholderWueInPair(n);
  assert.deepStrictEqual(STORE.sideDepths(z), STORE.sideDepths(n));
  // ...while a TRACKED zero still counts as held.
  const t = zeroPair(); t.p2['Points:Winners'] = 12;
  assert.ok(STORE.sideDepths(t)[0] > STORE.sideDepths(n)[0], 'a tracked 0 lost its depth');
});

check('match-stat store: hydrate over a 0-carrying floor publishes null; freeze carries it to the floor', () => {
  const dir = tmpdir('store');
  fs.writeFileSync(path.join(dir, STORE.FLOOR), JSON.stringify({ 9: { p1Key: 1, p2Key: 2, matchStats: zeroPair() } }));
  fs.writeFileSync(path.join(dir, STORE.PLAIN), JSON.stringify({ 9: { p1Key: 1, p2Key: 2, matchStats: zeroPair() }, 10: { matchStats: null } }));
  const logs = []; const orig = console.log; console.log = (...a) => logs.push(a.join(' '));
  let h, f;
  try { h = STORE.hydrate(dir); f = STORE.freeze(dir); } finally { console.log = orig; }
  const plain = JSON.parse(fs.readFileSync(path.join(dir, STORE.PLAIN), 'utf8'));
  const floor = JSON.parse(fs.readFileSync(path.join(dir, STORE.FLOOR), 'utf8'));
  assert.strictEqual(h, 1); assert.strictEqual(f, 1, `freeze refused: ${logs.join(' | ')}`);
  assert.strictEqual(plain[9].matchStats.p1['Points:Winners'], null);
  assert.strictEqual(floor[9].matchStats.p2['Points:Unforced errors'], null);
});

console.log('\n2 · per-set backlog: newest first, cap raised\n');

check('orderFormQueue puts the newest match first and undated rows last', () => {
  const keys = new Set(['a', 'b', 'c', 'd', 'e']);
  const dates = new Map([['a', '2026-06-01'], ['b', '2026-09-20'], ['c', '2026-07-15'], ['e', '2026-09-20']]);
  assert.deepStrictEqual(PBP.orderFormQueue(keys, dates), ['b', 'e', 'c', 'a', 'd']);
});

check('the fetch cap defaults to 750 (was 250)', () => {
  const r = spawnSync(process.execPath, ['-e', `delete process.env.PBP_MAX_FETCHES; console.log(require(${JSON.stringify(path.join(ROOT, 'build-point-by-point.js'))}).MAX_FETCHES_PER_RUN)`],
    { env: Object.assign({}, process.env, { PBP_MAX_FETCHES: '' }), encoding: 'utf8' });
  assert.strictEqual(r.stdout.trim().split('\n').pop(), '750', r.stdout + r.stderr);
});

check('main() spends a capped budget on the NEWEST recent-form matches (real loop, stubbed fetch)', () => {
  const dir = tmpdir('pbp');
  fs.writeFileSync(path.join(dir, 'matches.json'), JSON.stringify([]));
  fs.mkdirSync(path.join(dir, 'form'));
  // Two player shards; the file that sorts first holds the OLDEST rows.
  const row = (ek, date) => ({ eventKey: ek, date });
  fs.writeFileSync(path.join(dir, 'form', '100.json'), JSON.stringify({ key: 100, matches: [row(1001, '2026-06-02'), row(1002, '2026-06-01'), row(1003, '2026-06-03')] }));
  fs.writeFileSync(path.join(dir, 'form', '200.json'), JSON.stringify({ key: 200, matches: [row(2001, '2026-09-19'), row(2002, '2026-09-21'), row(2003, '2026-08-30')] }));
  const log = path.join(dir, 'fetched.txt');
  const stub = path.join(dir, 'stub.js');
  fs.writeFileSync(stub, `const fs=require('fs');globalThis.fetch=async(u)=>{const m=/match_key=(\\d+)/.exec(String(u));if(m)fs.appendFileSync(${JSON.stringify(log)},m[1]+'\\n');return{ok:true,json:async()=>({success:1,result:[]})};};`);
  const r = spawnSync(process.execPath, ['-r', stub, path.join(ROOT, 'build-point-by-point.js')], {
    cwd: dir, encoding: 'utf8',
    env: Object.assign({}, process.env, { API_TENNIS_KEY: 'test', PBP_MAX_FETCHES: '3', SETSTATS_MAX_BACKFILL: '0' }),
  });
  const got = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  assert.deepStrictEqual(got, ['2002', '2001', '2003'], `fetched ${JSON.stringify(got)}\n${r.stdout}${r.stderr}`);
});

console.log('\n3 · market-edge not rebuilt → red AFTER the deploy\n');

// Step helpers: the real text of a named step in pipeline.yml.
function stepBlock(name) {
  const lines = YML.split('\n');
  const i = lines.findIndex(l => l.trim() === `- name: ${name}`);
  if (i < 0) return null;
  const ind = lines[i].indexOf('-');
  let j = i + 1;
  // A step ends at the next line indented at or left of its own `- name:` (the next
  // step, or a comment block introducing it).
  while (j < lines.length && !(lines[j].trim() && lines[j].search(/\S/) <= ind)) j++;
  return { start: i, end: j, lines: lines.slice(i, j) };
}
function stepRun(name) {
  const b = stepBlock(name); if (!b) return null;
  const k = b.lines.findIndex(l => /^\s+run: /.test(l));
  if (k < 0) return null;
  const m = /^(\s+)run: (.*)$/.exec(b.lines[k]);
  if (m[2] !== '|') return m[2];
  const body = b.lines.slice(k + 1);
  const ind = body.find(l => l.trim()).search(/\S/);
  return body.map(l => l.slice(ind)).join('\n');
}
const stepNames = YML.split('\n').filter(l => /^      - name: /.test(l)).map(l => l.replace(/^      - name: /, '').trim());

const BUILD = 'Build market-edge shards (best-effort)';
const RED = 'Fail the run if market-edge was not rebuilt (post-deploy, loud)';

function runBuildStep(builderExit) {
  const dir = tmpdir('mebuild');
  fs.writeFileSync(path.join(dir, 'build-market-edge.js'), `process.exit(${builderExit});`);
  const env = path.join(dir, 'gh.env'); fs.writeFileSync(env, '');
  const r = spawnSync('/bin/bash', ['-e', '-c', stepRun(BUILD)], { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, { GITHUB_ENV: env }) });
  return { status: r.status, env: fs.readFileSync(env, 'utf8'), out: r.stdout + r.stderr };
}

check('the build step never fails the job and records the builder exit status (crash → 3)', () => {
  assert.ok(stepRun(BUILD), 'build step not found');
  const bad = runBuildStep(3), good = runBuildStep(0);
  assert.strictEqual(bad.status, 0, `step failed on a builder crash: ${bad.out}`);
  assert.match(bad.env, /^MARKET_EDGE_BUILD_RC=3$/m);
  assert.match(bad.env, /^MARKET_EDGE_BUILD_START=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/m);
  assert.strictEqual(good.status, 0);
  assert.match(good.env, /^MARKET_EDGE_BUILD_RC=0$/m);
});

check('the red step is the LAST step, after the deploy, and runs only when the deploy succeeded', () => {
  assert.strictEqual(stepNames[stepNames.length - 1], RED, `last step is "${stepNames[stepNames.length - 1]}"`);
  assert.ok(stepNames.indexOf('Deploy to GitHub Pages') < stepNames.indexOf(RED));
  const b = stepBlock(RED).lines.join('\n');
  assert.match(b, /\n\s+if: always\(\) && steps\.deploy\.outcome == 'success'\n/);
  // The pre-deploy half stays a warning: "Assert site completeness" must not exit on staleness.
  assert.ok(!/market-edge stale[^\n]*process\.exit/.test(YML), 'the pre-deploy stale check exits (would block the deploy)');
});

function runRedStep({ rc, start, index }) {
  const dir = tmpdir('mered');
  fs.mkdirSync(path.join(dir, '_site'));
  fs.mkdirSync(path.join(dir, 'tools'));
  fs.copyFileSync(path.join(ROOT, 'tools', 'market-edge-rebuilt-check.js'), path.join(dir, 'tools', 'market-edge-rebuilt-check.js'));
  if (index !== undefined) fs.writeFileSync(path.join(dir, '_site', 'market-edge-index.json'), JSON.stringify(index));
  const summary = path.join(dir, 'summary.md');
  const env = Object.assign({}, process.env, { GITHUB_STEP_SUMMARY: summary });
  delete env.MARKET_EDGE_BUILD_RC; delete env.MARKET_EDGE_BUILD_START;
  if (rc !== undefined) env.MARKET_EDGE_BUILD_RC = rc;
  if (start !== undefined) env.MARKET_EDGE_BUILD_START = start;
  const r = spawnSync('/bin/bash', ['-e', '-c', stepRun(RED)], { cwd: dir, encoding: 'utf8', env });
  return { status: r.status, out: r.stdout + r.stderr, summary: fs.existsSync(summary) ? fs.readFileSync(summary, 'utf8') : '' };
}
const START = '2026-09-24T14:05:00Z';
const fresh = { priceBasis: 'Pinnacle closing only', builtAt: '2026-09-24T14:05:03.120Z', builtFromCommit: 'abc' };

check('rebuilt this run (rc 0, builtAt after the step start) → green', () => {
  const r = runRedStep({ rc: '0', start: START, index: fresh });
  assert.strictEqual(r.status, 0, r.out);
  assert.ok(!/::error/.test(r.out));
});
for (const [what, args, want] of [
  ['builder crashed (rc 1)', { rc: '1', start: START, index: fresh }, /exited 1/],
  ['committed floor shipped (older builtAt)', { rc: '0', start: START, index: { ...fresh, builtAt: '2026-09-23T09:00:00.000Z' } }, /not built by this run/],
  ['committed floor shipped (pre-stamp index, no builtAt)', { rc: '0', start: START, index: { priceBasis: 'x' } }, /not built by this run/],
  ['build step never ran (no start)', { rc: '0', index: fresh }, /did not run/],
  ['no exit status recorded', { start: START, index: fresh }, /no exit status/],
  ['shipped index missing', { rc: '0', start: START }, /missing or unreadable/],
]) {
  check(`not rebuilt → red with the reason: ${what}`, () => {
    const r = runRedStep(args);
    assert.strictEqual(r.status, 1, `exit ${r.status}: ${r.out}`);
    assert.match(r.out, /::error title=Market-edge was not rebuilt this run::/);
    assert.match(r.out, want);
    assert.match(r.summary, /Market-edge was not rebuilt this run/);
  });
}

console.log('\n4 · split builds (option 1): workflow change → build the queued SHA\n');

const REPOINT = 'Re-point this run at the current tip of main';
const gitEnv = Object.assign({}, process.env, {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
});
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function commitFile(repo, file, body, msg) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), body);
  git(repo, 'add', file); git(repo, 'commit', '-q', '-m', msg);
  return git(repo, 'rev-parse', 'HEAD');
}
// origin with main; a CI-like clone checked out at the queued SHA; then main moves.
function scenario(tipChange) {
  const base = tmpdir('git');
  const origin = path.join(base, 'origin');
  fs.mkdirSync(origin);
  git(origin, 'init', '-q', '-b', 'main');
  commitFile(origin, '.github/workflows/pipeline.yml', 'name: v1\n', 'wf v1');
  const queued = commitFile(origin, 'app.js', 'v1\n', 'app v1');
  const ci = path.join(base, 'ci');
  execFileSync('git', ['clone', '-q', `file://${origin}`, ci], { env: gitEnv, stdio: 'ignore' });
  let tip = queued;
  if (tipChange === 'app') tip = commitFile(origin, 'app.js', 'v2\n', 'app v2');
  if (tipChange === 'workflow') { commitFile(origin, 'app.js', 'v2\n', 'app v2'); tip = commitFile(origin, '.github/workflows/pipeline.yml', 'name: v2\n', 'wf v2'); }
  const r = spawnSync('/bin/bash', ['-e', '-c', stepRun(REPOINT)], { cwd: ci, encoding: 'utf8', env: gitEnv });
  return { status: r.status, out: r.stdout + r.stderr, head: git(ci, 'rev-parse', 'HEAD'), queued, tip };
}

check('tip changed only non-workflow files → re-point to the tip', () => {
  assert.ok(stepRun(REPOINT), 're-point step not found');
  const s = scenario('app');
  assert.strictEqual(s.status, 0, s.out);
  assert.strictEqual(s.head, s.tip, `HEAD ${s.head} != tip ${s.tip}\n${s.out}`);
  assert.match(s.out, /Advanced .*\(\.github\/workflows\/ identical\)/);
});

check('tip changed .github/workflows/ → build the queued SHA and say why', () => {
  const s = scenario('workflow');
  assert.strictEqual(s.status, 0, s.out);
  assert.strictEqual(s.head, s.queued, `HEAD ${s.head} moved off the queued SHA ${s.queued}\n${s.out}`);
  assert.match(s.out, /::warning title=Split build avoided::Building the queued SHA/);
  assert.match(s.out, /\.github\/workflows\/pipeline\.yml/);
});

check('already at the tip → unchanged', () => {
  const s = scenario(null);
  assert.strictEqual(s.status, 0, s.out);
  assert.strictEqual(s.head, s.queued);
  assert.match(s.out, /Already at the tip of main/);
});

for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ } }
console.log(`\nten263-pipeline: ${pass} passed, ${fails.length} failed.`);
if (fails.length) { console.log(`FAILED:\n  - ${fails.join('\n  - ')}`); process.exit(1); }
