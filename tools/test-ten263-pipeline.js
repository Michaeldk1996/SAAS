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
//  3. Market-edge not rebuilt — REVISED by founder decision 19 Oct (TEN-449): ALERT
//     ONLY, never blocks, one Telegram per streak. The build step's, the check step's
//     and the alert step's real run blocks are executed from pipeline.yml (the alert
//     against a fake GitHub API and a fake Telegram), each with a mutant that would
//     block the run or alert every run.
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

console.log('\n3 · market-edge not rebuilt → alert only (never blocks), one Telegram per streak\n');

// Step helpers: the real text of a named step in pipeline.yml.
function stepBlock(name, yml = YML) {
  const lines = yml.split('\n');
  const i = lines.findIndex(l => l.trim() === `- name: ${name}`);
  if (i < 0) return null;
  const ind = lines[i].indexOf('-');
  let j = i + 1;
  // A step ends at the next line indented at or left of its own `- name:` (the next
  // step, or a comment block introducing it).
  while (j < lines.length && !(lines[j].trim() && lines[j].search(/\S/) <= ind)) j++;
  return { start: i, end: j, lines: lines.slice(i, j) };
}
function stepRun(name, yml = YML) {
  const b = stepBlock(name, yml); if (!b) return null;
  const k = b.lines.findIndex(l => /^\s+run: /.test(l));
  if (k < 0) return null;
  const m = /^(\s+)run: (.*)$/.exec(b.lines[k]);
  if (m[2] !== '|') return m[2];
  const body = b.lines.slice(k + 1);
  const ind = body.find(l => l.trim()).search(/\S/);
  return body.map(l => l.slice(ind)).join('\n');
}
// the build job's steps (founder 2026-10-18: the separate fail-alert job after it is not the build job)
const buildSteps = (yml) => yml.split('\n  fail-alert:')[0].split('\n').filter(l => /^      - name: /.test(l)).map(l => l.replace(/^      - name: /, '').trim());

const BUILD = 'Build market-edge shards (best-effort)';
const CHECK = 'Market-edge rebuilt check (alert only, never blocks)';
const ALERT = 'Alert — market-edge not rebuilt (Telegram, once per streak)';
const REBUILT = 'Market-edge rebuilt (streak reset marker)';
const MARKER = 'Market-edge alert sent (streak marker)';
const UPLOAD = 'Upload the built site for publish.yml (site-data)';

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

// Wiring, as a list of problems so a mutant workflow can be shown to produce one.
function wiringProblems(yml) {
  const p = [];
  const names = buildSteps(yml);
  if (names.slice(-4).join('|') !== [CHECK, REBUILT, ALERT, MARKER].join('|')) p.push(`the last four steps are not the check, the reset marker, the alert, the alerted marker: ${names.slice(-4).join(' | ')}`);
  // "rebuilt" only on an EVALUATED check (a broken check writes no outputs and must never look like a rebuild)
  const rb = (stepBlock(REBUILT, yml) || { lines: [] }).lines.join('\n');
  if (!/\n\s+if: always\(\) && steps\.me_check\.outputs\.evaluated == 'true' && steps\.me_check\.outputs\.stale == 'false'\n/.test(rb)) p.push('the reset marker is not gated on an evaluated, rebuilt check');
  if (!(names.indexOf(UPLOAD) >= 0 && names.indexOf(UPLOAD) < names.indexOf(CHECK))) p.push('the check does not run after the site-data upload');
  const up = (stepBlock(UPLOAD, yml) || { lines: [] }).lines.join('\n');
  if (!/\n\s+id: site_data\n/.test(up)) p.push('the site-data upload has no id: site_data');
  const c = (stepBlock(CHECK, yml) || { lines: [] }).lines.join('\n');
  if (!/\n\s+id: me_check\n/.test(c)) p.push('the check has no id: me_check');
  // runs whenever this run handed its site to publish.yml — never on a step that does not exist in this job
  if (!/\n\s+if: always\(\) && steps\.site_data\.outcome == 'success'\n/.test(c)) p.push(`the check's gate is not "always() && steps.site_data.outcome == 'success'"`);
  if (/continue-on-error/.test(c)) p.push('the check relies on continue-on-error (chosen: it exits 0 by construction)');
  const a = (stepBlock(ALERT, yml) || { lines: [] }).lines.join('\n');
  if (!/\n\s+if: always\(\) && steps\.me_check\.outputs\.stale == 'true'\n/.test(a)) p.push('the alert is not gated on the check finding market-edge not rebuilt');
  if (!/\n\s+id: me_alert\n/.test(a)) p.push('the alert has no id: me_alert');
  // the streak marker runs only on a delivered message (sent=true after a Telegram 2xx), never merely because the alert ran
  const mk = (stepBlock(MARKER, yml) || { lines: [] }).lines.join('\n');
  if (!/\n\s+if: always\(\) && \(steps\.me_alert\.outputs\.sent == 'true' \|\| steps\.me_alert\.outputs\.alerted == 'true'\)\n/.test(mk)) p.push('the marker is not gated on a delivered (sent) or carried-forward (alerted) alert');
  // a missing or broken script can never turn the run red
  for (const n of [CHECK, ALERT]) if (!/^node tools\/[\w.-]+ ?[^|]*\|\| echo "::error title=[^"]*"$/.test(stepRun(n, yml) || '')) p.push(`${n}: the run line does not end in || echo "::error::…"`);
  if (!/TELEGRAM_BOT_TOKEN: \$\{\{ secrets\.TELEGRAM_BOT_TOKEN \}\}/.test(a) || /\$\{\{/.test(stepRun(ALERT, yml) || '')) p.push('the alert must take its secrets through env:, never inline in run:');
  if (/steps\.deploy\b/.test(yml)) p.push('pipeline.yml still reads steps.deploy (the deploy is publish.yml\'s since cf703d612)');
  // the pre-upload half stays a warning: "Assert site completeness" must not exit on staleness
  if (/market-edge stale[^\n]*process\.exit/.test(yml)) p.push('the pre-upload stale check exits');
  return p;
}

check('wiring: the check, the reset marker, the alert and the alerted marker are the last four build steps, after the site-data upload, gated on it (no steps.deploy)', () => {
  assert.deepStrictEqual(wiringProblems(YML), []);
});
check('wiring mutants are caught: the dead steps.deploy gate, an ungated alert, an inline secret, continue-on-error, a marker on "alert ran", a bare run line', () => {
  const mutants = {
    'gate back on steps.deploy': YML.replace("if: always() && steps.site_data.outcome == 'success'", "if: always() && steps.deploy.outcome == 'success'"),
    'alert every run': YML.replace("if: always() && steps.me_check.outputs.stale == 'true'", 'if: always()'),
    'secret inline in run': YML.replace('run: node tools/market-edge-alert.mjs', 'run: TELEGRAM_BOT_TOKEN=${{ secrets.TELEGRAM_BOT_TOKEN }} node tools/market-edge-alert.mjs'),
    'continue-on-error instead of exit 0': YML.replace('        id: me_check\n', '        id: me_check\n        continue-on-error: true\n'),
    'marker on "the alert step ran"': YML.replace("if: always() && (steps.me_alert.outputs.sent == 'true' || steps.me_alert.outputs.alerted == 'true')", "if: always() && steps.me_alert.outcome == 'success'"),
    'marker without carry-forward': YML.replace("if: always() && (steps.me_alert.outputs.sent == 'true' || steps.me_alert.outputs.alerted == 'true')", "if: always() && steps.me_alert.outputs.sent == 'true'"),
    'reset marker on "check ran"': YML.replace("if: always() && steps.me_check.outputs.evaluated == 'true' && steps.me_check.outputs.stale == 'false'", "if: always() && steps.me_check.outputs.stale != 'true'"),
    'bare run line (no || echo)': YML.replace(/(run: node tools\/market-edge-alert\.mjs) \|\| echo "[^"]*"/, '$1'),
  };
  for (const [what, m] of Object.entries(mutants)) {
    assert.notStrictEqual(m, YML, `${what}: mutant did not apply`);
    assert.ok(wiringProblems(m).length > 0, `${what}: not caught`);
  }
});

const CHECK_SRC = fs.readFileSync(path.join(ROOT, 'tools', 'market-edge-rebuilt-check.js'), 'utf8');
// Runs the check step's REAL run block over a scratch _site; `src` swaps in a mutant of the script.
function runCheckStep({ rc, start, index }, src = CHECK_SRC, cmd = stepRun(CHECK)) {
  const dir = tmpdir('mecheck');
  fs.mkdirSync(path.join(dir, '_site'));
  fs.mkdirSync(path.join(dir, 'tools'));
  if (src !== null) fs.writeFileSync(path.join(dir, 'tools', 'market-edge-rebuilt-check.js'), src);   // null = the script is missing
  if (index !== undefined) fs.writeFileSync(path.join(dir, '_site', 'market-edge-index.json'), JSON.stringify(index));
  const summary = path.join(dir, 'summary.md'), output = path.join(dir, 'output.txt');
  const env = Object.assign({}, process.env, { GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output });
  delete env.MARKET_EDGE_BUILD_RC; delete env.MARKET_EDGE_BUILD_START;
  if (rc !== undefined) env.MARKET_EDGE_BUILD_RC = rc;
  if (start !== undefined) env.MARKET_EDGE_BUILD_START = start;
  const r = spawnSync('/bin/bash', ['-e', '-c', cmd], { cwd: dir, encoding: 'utf8', env });
  const read = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  return { status: r.status, out: r.stdout + r.stderr, summary: read(summary), output: read(output) };
}
const START = '2026-09-24T14:05:00Z';
const fresh = { priceBasis: 'Pinnacle closing, else Bet365 closing', builtAt: '2026-09-24T14:05:03.120Z', builtFromCommit: 'abc' };
const STALE_CASES = [
  ['builder crashed (rc 1)', { rc: '1', start: START, index: fresh }, /exited 1/],
  ['committed floor shipped (older builtAt)', { rc: '0', start: START, index: { ...fresh, builtAt: '2026-09-23T09:00:00.000Z' } }, /not built by this run/],
  ['committed floor shipped (pre-stamp index, no builtAt)', { rc: '0', start: START, index: { priceBasis: 'x' } }, /not built by this run/],
  ['build step never ran (no start)', { rc: '0', index: fresh }, /did not run/],
  ['no exit status recorded', { start: START, index: fresh }, /no exit status/],
  ['shipped index missing', { rc: '0', start: START }, /missing or unreadable/],
];
// "Never blocks" = the SCRIPT itself exits 0 on every stale case (the step's `|| echo` is a second, separate guard).
const SCRIPT_ONLY = 'node tools/market-edge-rebuilt-check.js _site/market-edge-index.json';
function blockingCases(src) {
  return STALE_CASES.filter(([, args]) => runCheckStep(args, src, SCRIPT_ONLY).status !== 0).map(([what]) => what);
}

check('rebuilt this run (rc 0, builtAt after the step start) → green, silent, stale=false', () => {
  const r = runCheckStep({ rc: '0', start: START, index: fresh });
  assert.strictEqual(r.status, 0, r.out);
  assert.ok(!/::(error|warning)/.test(r.out), r.out);
  assert.match(r.output, /^stale=false$/m);
  assert.match(r.output, /^evaluated=true$/m);
});
for (const [what, args, want] of STALE_CASES) {
  check(`not rebuilt → exit 0 (never blocks), ::warning:: + summary + stale=true with the reason: ${what}`, () => {
    const r = runCheckStep(args);
    assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.out}`);
    assert.match(r.out, /::warning title=Market-edge was not rebuilt this run::/);
    assert.ok(!/::error/.test(r.out), `an ::error:: annotation: ${r.out}`);
    assert.match(r.out, want);
    assert.match(r.summary, /Market-edge was not rebuilt this run \(alert only\)/);
    assert.match(r.output, /^stale=true$/m);
    assert.match(r.output, /^evaluated=true$/m);
    assert.match(r.output, new RegExp(`^reason=.*${want.source}`, 'm'));
  });
}
check('mutant: the pre-TEN-449 exit (red on not rebuilt) is caught as blocking on every stale case', () => {
  const mutant = CHECK_SRC
    .replace(/\n  return 0;\n}\n\n\/\/ Alert only/, '\n  return 1;\n}\n\n// Alert only')
    .replace(/if \(require\.main === module\) \{[\s\S]*?\n\}\n/, 'if (require.main === module) process.exitCode = main();\n');
  assert.notStrictEqual(mutant, CHECK_SRC, 'mutant did not apply');
  assert.deepStrictEqual(blockingCases(CHECK_SRC), [], 'the shipped check blocks');
  assert.deepStrictEqual(blockingCases(mutant), STALE_CASES.map(([w]) => w));
});
check('a crash inside the check still exits 0 (a throwing main), with an ::error::', () => {
  const throwing = CHECK_SRC.replace("function main() {\n", "function main() {\n  throw new Error('boom');\n");
  assert.notStrictEqual(throwing, CHECK_SRC);
  const r = runCheckStep({ rc: '1', start: START, index: fresh }, throwing);
  assert.strictEqual(r.status, 0, r.out);
  assert.match(r.out, /::error title=Market-edge check could not run::boom/);
  assert.ok(!/evaluated=true/.test(r.output), 'a broken check claimed it evaluated');
});
check('a missing script: the step still exits 0 with an ::error:: (its `|| echo`); without it the run would go red', () => {
  const r = runCheckStep({ rc: '1', start: START, index: fresh }, null);
  assert.strictEqual(r.status, 0, r.out);
  assert.match(r.out, /::error title=Market-edge check did not run::market-edge-rebuilt-check\.js exited [1-9]/);
  const bare = runCheckStep({ rc: '1', start: START, index: fresh }, null, SCRIPT_ONLY);
  assert.notStrictEqual(bare.status, 0, 'control: a bare run line on a missing script should fail');
});

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

// ── 5 · the alert: ONE Telegram per streak (async: fake GitHub API + fake Telegram in-process) ──────────────────
const http = require('http');
const { spawn } = require('child_process');
async function acheck(name, fn) {
  try { await fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fails.push(name); console.log(`  FAIL ${name}\n       ${e.message}`); }
}
const ALERT_SRC = fs.readFileSync(path.join(ROOT, 'tools', 'market-edge-alert.mjs'), 'utf8');
const SEND_SRC = fs.readFileSync(path.join(ROOT, 'tools', 'price-alert-send.mjs'), 'utf8');

(async () => {
  console.log('\n5 · market-edge alert: one DELIVERED Telegram per streak, never fails the step\n');
  // RUNS: [{ id, n, min, steps }]. steps: 'fresh' (check evaluated + rebuilt: reset marker ran) | 'sent' (alert ran,
  // alerted marker ran — delivered or carried) | 'unsent' (alert ran, no marker: the send failed) | 'broken' (check step
  // ran but wrote no outputs: nothing else ran) | 'none' (check skipped) | 'nojobs' (no jobs at all)
  let RUNS = [], SENT = [], TG_STATUS = 200, TG_HANG = false, GH_DOWN = false, GH_HANG = false, JOB_CALLS = 0;
  const S = (name, ran) => ({ name, conclusion: ran ? 'success' : 'skipped' });
  const stepsFor = (k) => [{ name: 'Checkout', conclusion: 'success' }, S(CHECK, k !== 'none'), S(REBUILT, k === 'fresh'),
    S(ALERT, k === 'sent' || k === 'unsent'), S(MARKER, k === 'sent')];
  const asRun = (r) => ({ id: r.id, run_number: r.n, status: r.status || 'completed', conclusion: r.conclusion || 'success',
    created_at: new Date(Date.UTC(2026, 9, 19, 10, 0) + r.min * 60000).toISOString(), html_url: `https://x/${r.id}` });
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      let m, out = null, code = 200;
      if (/\/sendMessage$/.test(u.pathname) && TG_HANG) return;   // never answers
      if (/\/sendMessage$/.test(u.pathname)) { SENT.push({ text: JSON.parse(body).text, status: TG_STATUS }); code = TG_STATUS; out = { ok: code === 200 }; }
      else if (GH_HANG) return;                       // never answers
      else if (GH_DOWN) { code = 502; out = {}; }
      else if ((m = /\/actions\/runs\/(\d+)\/jobs$/.exec(u.pathname))) { JOB_CALLS++; const r = RUNS.find(x => String(x.id) === m[1]); out = { jobs: r && r.steps !== 'nojobs' ? [{ name: 'build-and-deploy', steps: stepsFor(r.steps) }] : [] }; }
      else if ((m = /\/actions\/runs\/(\d+)$/.exec(u.pathname))) { const r = RUNS.find(x => String(x.id) === m[1]); out = r && asRun(r); }
      else if (/\/actions\/workflows\/pipeline\.yml\/runs$/.test(u.pathname)) out = { workflow_runs: RUNS.filter(r => (r.status || 'completed') === 'completed').map(asRun) };
      res.writeHead(out ? code : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify(out || {}));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const delivered = () => SENT.filter(x => x.status === 200);
  // Runs the alert step's REAL run command in a scratch dir holding the shipped (or a mutant) script.
  function runAlertStep(runId, src = ALERT_SRC, extra = {}) {
    const dir = tmpdir('mealert');
    fs.mkdirSync(path.join(dir, 'tools'));
    if (src !== null) fs.writeFileSync(path.join(dir, 'tools', 'market-edge-alert.mjs'), src);
    fs.writeFileSync(path.join(dir, 'tools', 'price-alert-send.mjs'), SEND_SRC);
    const summary = path.join(dir, 'summary.md'), output = path.join(dir, 'output.txt');
    const env = Object.assign({}, process.env, { GITHUB_API_URL: base, TELEGRAM_API_URL: base, GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: String(runId),
      GH_TOKEN: 't', TELEGRAM_BOT_TOKEN: 'bot-token-secret', TELEGRAM_CHAT_ID: '1', ME_REASON: 'build-market-edge.js exited 1 in this run',
      GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output }, extra);
    const t0 = Date.now();
    return new Promise((resolve) => {
      const c = spawn('/bin/bash', ['-e', '-c', stepRun(ALERT)], { cwd: dir, env });
      let out = ''; c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; });
      const read = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
      c.on('close', (status) => resolve({ status, out, ms: Date.now() - t0, summary: read(summary), sent: /^sent=true$/m.test(read(output)), alerted: /^alerted=true$/m.test(read(output)) }));
    });
  }
  const me = (id, n, min) => ({ id, n, min, status: 'in_progress', conclusion: null });

  await acheck('previous run rebuilt market-edge → this first stale run sends ONE message and records sent=true', async () => {
    RUNS = [{ id: 1, n: 10, min: 0, steps: 'fresh' }, me(2, 11, 10)]; SENT = [];
    const r = await runAlertStep(2);
    assert.strictEqual(r.status, 0, r.out);
    assert.strictEqual(SENT.length, 1, r.out);
    assert.ok(r.sent, 'sent=true not recorded');
    assert.match(SENT[0].text, /Market edge was not rebuilt in data run 11: build-market-edge\.js exited 1/);
    assert.ok(!/bot-token-secret/.test(r.out), 'the bot token was printed');
  });
  await acheck('an earlier run of the streak DELIVERED (marker ran) → no message', async () => {
    RUNS = [{ id: 1, n: 10, min: 0, steps: 'fresh' }, { id: 2, n: 11, min: 10, steps: 'sent' }, me(3, 12, 20)]; SENT = [];
    const r = await runAlertStep(3);
    assert.strictEqual(r.status, 0, r.out);
    assert.strictEqual(SENT.length, 0, r.out);
    assert.ok(!r.sent && r.alerted, 'the quiet run did not carry the marker forward (alerted=true)');
  });
  await acheck('a broken check (ran, wrote no outputs) never looks like "rebuilt": looked past', async () => {
    RUNS = [{ id: 1, n: 10, min: 0, steps: 'sent' }, { id: 2, n: 11, min: 10, steps: 'broken' }, me(3, 12, 20)]; SENT = [];
    const r = await runAlertStep(3);
    assert.strictEqual(SENT.length, 0, r.out);
  });
  await acheck('a failed send on run N (no marker) → run N+1 sends', async () => {
    RUNS = [{ id: 1, n: 10, min: 0, steps: 'fresh' }, me(2, 11, 10)]; SENT = []; TG_STATUS = 500;
    let r = await runAlertStep(2); TG_STATUS = 200;
    assert.ok(!r.sent && delivered().length === 0, r.out);
    RUNS = [{ id: 1, n: 10, min: 0, steps: 'fresh' }, { id: 2, n: 11, min: 10, steps: 'unsent' }, me(3, 12, 20)];
    r = await runAlertStep(3);
    assert.strictEqual(delivered().length, 1, r.out);
    assert.ok(r.sent);
  });
  await acheck('cancelled runs cost no jobs read; failed-before-the-upload runs are looked past', async () => {
    RUNS = [{ id: 1, n: 10, min: 0, steps: 'sent' }];
    for (let i = 0; i < 25; i++) RUNS.push({ id: 100 + i, n: 20 + i, min: 1 + i, steps: 'nojobs', conclusion: 'cancelled' });
    RUNS.push({ id: 200, n: 50, min: 30, steps: 'none', conclusion: 'failure' }, me(201, 51, 40));
    SENT = []; JOB_CALLS = 0;
    const r = await runAlertStep(201);
    assert.strictEqual(SENT.length, 0, `a long cancelled gap re-alerted: ${r.out}`);
    assert.strictEqual(JOB_CALLS, 2, `jobs reads ${JOB_CALLS}`);
  });
  await acheck('nothing decisive within the jobs-read cap → one message (loud, not silent)', async () => {
    RUNS = [{ id: 1, n: 10, min: 0, steps: 'sent' }];
    for (let i = 0; i < 12; i++) RUNS.push({ id: 100 + i, n: 20 + i, min: 1 + i, steps: 'none', conclusion: 'failure' });
    RUNS.push(me(201, 51, 40)); SENT = []; JOB_CALLS = 0;
    const r = await runAlertStep(201);
    assert.strictEqual(SENT.length, 1, r.out);
    assert.strictEqual(JOB_CALLS, 10);
  });
  // A whole day in miniature: S S S F S S F → two streaks of "not rebuilt" → exactly two delivered messages.
  // `failFirst` makes the first send of the day fail (Telegram 500).
  async function streakMessages(src, failFirst = false) {
    const seq = ['stale', 'stale', 'stale', 'fresh', 'stale', 'stale', 'fresh'];
    RUNS = [{ id: 100, n: 99, min: 0, steps: 'fresh' }]; SENT = [];
    let first = true;
    for (let i = 0; i < seq.length; i++) {
      const id = 101 + i; let kind = 'fresh';
      if (seq[i] === 'stale') {
        RUNS.push(me(id, 100 + i, 10 * (i + 1)));
        TG_STATUS = failFirst && first ? 500 : 200; first = false;
        const r = await runAlertStep(id, src); TG_STATUS = 200;
        kind = r.sent || r.alerted ? 'sent' : 'unsent';
      }
      RUNS = RUNS.filter(r => r.id !== id).concat([{ id, n: 100 + i, min: 10 * (i + 1), steps: kind }]);
    }
    return delivered().length;
  }
  // One long streak: n stale runs in a row (more than the jobs-read cap) → exactly one delivered message.
  async function longStreak(src, n = 40) {
    RUNS = [{ id: 1000, n: 999, min: 0, steps: 'fresh' }]; SENT = [];
    for (let i = 0; i < n; i++) {
      const id = 1001 + i;
      RUNS.push(me(id, 1000 + i, 10 * (i + 1)));
      const r = await runAlertStep(id, src);
      RUNS = RUNS.filter(x => x.id !== id).concat([{ id, n: 1000 + i, min: 10 * (i + 1), steps: r.sent || r.alerted ? 'sent' : 'unsent' }]);
    }
    return delivered().length;
  }
  await acheck('a streak of 40 stale runs (4x the jobs-read cap) sends exactly 1', async () => {
    assert.strictEqual(await longStreak(ALERT_SRC), 1);
  });
  await acheck('mutant: without carrying the marker forward (alerted=true) the 40-run streak re-alerts — caught', async () => {
    const mutant = ALERT_SRC.replace("if (d.carried) output('alerted=true');", '');
    assert.notStrictEqual(mutant, ALERT_SRC, 'mutant did not apply');
    const n = await longStreak(mutant);
    assert.ok(n > 1, `mutant sent ${n}`);
  });
  await acheck('one delivered Telegram per streak: S S S F S S F (10-minute runs) → exactly 2', async () => {
    assert.strictEqual(await streakMessages(ALERT_SRC), 2);
  });
  await acheck('…and when the streak\'s first send fails, the next run delivers it: still exactly 2', async () => {
    assert.strictEqual(await streakMessages(ALERT_SRC, true), 2);
  });
  await acheck('mutant: without the streak de-dup it would alert every stale run (5) — caught', async () => {
    const mutant = ALERT_SRC.replace("if (RAN(steps.find(s => s.name === MARKER_STEP))) return { alert: false,", "if (RAN(steps.find(s => s.name === MARKER_STEP))) return { alert: true, text,");
    assert.notStrictEqual(mutant, ALERT_SRC, 'mutant did not apply');
    assert.strictEqual(await streakMessages(mutant), 5);
  });
  await acheck('mutant: "alert step ran" counted as alerted silences a streak whose send failed (1, not 2) — caught', async () => {
    const mutant = ALERT_SRC.replace("    // check not reached, a broken check, or a failed send", "    if (RAN(steps.find(s => s.name === ALERT_STEP))) return { alert: false, why: 'x' };\n    // check not reached");
    assert.notStrictEqual(mutant, ALERT_SRC, 'mutant did not apply');
    assert.strictEqual(await streakMessages(mutant, true), 1);
  });
  await acheck('Telegram refuses / no secrets → exit 0, an ::error::, the message in the summary, no sent=true', async () => {
    RUNS = [{ id: 1, n: 10, min: 0, steps: 'fresh' }, me(2, 11, 10)]; SENT = []; TG_STATUS = 500;
    let r = await runAlertStep(2); TG_STATUS = 200;
    assert.strictEqual(r.status, 0, r.out);
    assert.match(r.out, /::error title=Market-edge alert not sent::Telegram HTTP 500/);
    assert.ok(!r.sent && !/bot-token-secret/.test(r.out), r.out);
    assert.match(r.summary, /Market-edge alert NOT sent/);
    r = await runAlertStep(2, ALERT_SRC, { TELEGRAM_BOT_TOKEN: '' });
    assert.strictEqual(r.status, 0, r.out);
    assert.match(r.out, /::error title=Market-edge alert not sent::Telegram no Telegram secret set/);
    assert.ok(!r.sent);
  });
  await acheck('GitHub unreadable → exit 0, an ::error::, no message', async () => {
    RUNS = [{ id: 1, n: 10, min: 0, steps: 'fresh' }, me(2, 11, 10)]; SENT = []; GH_DOWN = true;
    const r = await runAlertStep(2); GH_DOWN = false;
    assert.strictEqual(r.status, 0, r.out);
    assert.strictEqual(SENT.length, 0);
    assert.match(r.out, /::error title=Market-edge alert not sent::could not read the runs \(GitHub .*HTTP 502\)/);
  });
  await acheck('GitHub hangs → the time budget ends the step, exit 0, an ::error::', async () => {
    RUNS = [{ id: 1, n: 10, min: 0, steps: 'fresh' }, me(2, 11, 10)]; SENT = []; GH_HANG = true;
    const r = await runAlertStep(2, ALERT_SRC, { ME_ALERT_BUDGET_MS: '1500' }); GH_HANG = false;
    assert.strictEqual(r.status, 0, r.out);
    assert.ok(r.ms < 6000, `took ${r.ms} ms`);
    assert.match(r.out, /::error title=Market-edge alert not sent::/);
    assert.strictEqual(SENT.length, 0);
  });
  await acheck('Telegram hangs → the send gets the budget left minus a margin, exit 0, an ::error::, no sent=true', async () => {
    RUNS = [{ id: 1, n: 10, min: 0, steps: 'fresh' }, me(2, 11, 10)]; SENT = []; TG_HANG = true;
    const r = await runAlertStep(2, ALERT_SRC, { ME_ALERT_BUDGET_MS: '2000' }); TG_HANG = false;
    assert.strictEqual(r.status, 0, r.out);
    assert.ok(r.ms < 6000, `took ${r.ms} ms`);
    assert.match(r.out, /::error title=Market-edge alert not sent::Telegram (TimeoutError|AbortError)/);
    assert.ok(!r.sent);
  });
  await acheck('a missing script: the step still exits 0 with an ::error:: (its `|| echo`)', async () => {
    const r = await runAlertStep(2, null);
    assert.strictEqual(r.status, 0, r.out);
    assert.match(r.out, /::error title=Market-edge alert not sent::market-edge-alert\.mjs exited [1-9]/);
  });
  await acheck('the step names the alert reads are the names in pipeline.yml', async () => {
    const mod = await import(path.join(ROOT, 'tools', 'market-edge-alert.mjs'));
    assert.strictEqual(mod.CHECK_STEP, CHECK);
    assert.strictEqual(mod.ALERT_STEP, ALERT);
    assert.strictEqual(mod.MARKER_STEP, MARKER);
    assert.strictEqual(mod.REBUILT_STEP, REBUILT);
  });
  srv.close();

  for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ } }
  console.log(`\nten263-pipeline: ${pass} passed, ${fails.length} failed.`);
  if (fails.length) { console.log(`FAILED:\n  - ${fails.join('\n  - ')}`); process.exit(1); }
})().catch((e) => { console.log(`ten263-pipeline: crashed: ${e && e.stack}`); process.exit(1); });
