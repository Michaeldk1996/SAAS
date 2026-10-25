#!/usr/bin/env node
// Founder ruling 2026-10-25: build-odds-performance.js crashed on every pipeline run with a career-history store
// ("ourCandidateKeys is not a function"): td-identity.js requires it back, and main() ran above module.exports, so the
// cycle handed the gate a half-built {}. The step was best-effort, so the Profile market shards stayed at their 7 Aug floor.
// Checks, each with the mutation it catches (MUTANTS at the end must all go red):
//   1. the cycle, both require orders + a script run, in fresh processes      — main() back above the exports (M1)
//   2. the builder runs AS A SCRIPT on a fixture WITH a career-history store  — M1; the gate silently skipped (M2)
//   3. an EMPTY career-history store: exit 0, the gate off, said out loud     — the CI annotation dropped (M3)
//   4. a roster that yields no shard fails loudly (never an empty index)     — the zero-shard guard dropped (M4)
//   5. source guard: the pipeline step is fail-closed (no `||`, no `set +e`, no continue-on-error, no step-check
//      swallow) and lives in the job fail-alert watches (`needs: build-and-deploy`, `if: failure()`)  — M5, M6
// Usage: node tools/test-oddsperf-cycle.js [--no-mutants]
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const ROOT = process.env.ODDSPERF_ROOT || path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const node = (args, opts) => spawnSync(process.execPath, args, Object.assign({ encoding: 'utf8' }, opts));
const FILES = ['build-odds-performance.js', 'td-identity.js', 'settlement.js'];

function sandbox(mutate, { career = 'full', roster = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oddsperf-'));
  for (const f of FILES) { let t = fs.readFileSync(path.join(ROOT, f), 'utf8'); if (mutate && mutate[f]) t = mutate[f](t); fs.writeFileSync(path.join(dir, f), t); }
  // master: 36 matches for "Ace A." (a favourite at 1.50 v 2.60), winner first, 2024
  const cols = ['date', 'tournament', 'series', 'surface', 'court', 'round', 'bestof', 'winner', 'loser', 'comment', 'pw', 'pl', 'book', 'set', 'flags', 'wrank', 'lrank', 'fs'];
  const rows = [];
  for (let i = 0; i < 36; i++) {
    const d = `2024-0${1 + (i % 9)}-1${i % 10}`, opp = `Opp${i} O.`, won = i % 3 !== 0;
    rows.push([d, 'Alpha Open', 'ATP250', 'Hard', 'Outdoor', '1st Round', '3', won ? 'Ace A.' : opp, won ? opp : 'Ace A.', 'Completed',
      won ? 1.5 : 2.6, won ? 2.6 : 1.5, 0, 'db', '', '20', '40', '']);
  }
  fs.writeFileSync(path.join(dir, 'database-yield-master.json'), JSON.stringify({ meta: { cols }, rows }));
  fs.writeFileSync(path.join(dir, 'player-profiles.json'), JSON.stringify({ players: roster ? { 101: { name: 'A. Ace' } } : {} }));
  if (career) {
    fs.mkdirSync(path.join(dir, 'career-history'));
    if (career === 'full') fs.writeFileSync(path.join(dir, 'career-history', '101.json'), JSON.stringify({ matches:
      rows.map(r => ({ date: r[0], opponent: (r[7] === 'Ace A.' ? r[8] : r[7]).replace(/(\S+) (\S)\./, '$2. $1'), won: r[7] === 'Ace A.', sets: [{ p: 6, o: 4 }, { p: 6, o: 3 }] })) }));
  }
  return dir;
}
const build = (dir, env) => node(['build-odds-performance.js'], { cwd: dir, env: Object.assign({}, process.env, env || {}) });
const readJ = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };

function cycleChecks(dir) {
  const r = [], c = (x, m) => r.push([!!x, m]);
  const a = node(['-e', "require('./td-identity.js'); const o = require('./build-odds-performance.js'); process.stdout.write(typeof o.ourCandidateKeys + ' ' + typeof o.keyFromArchiveName)"], { cwd: dir });
  c(a.status === 0 && a.stdout === 'function function', 'require td-identity.js first, then build-odds-performance.js: the exports are whole');
  const b = node(['-e', "const o = require('./build-odds-performance.js'); const t = require('./td-identity.js'); process.stdout.write(typeof o.ourCandidateKeys + ' ' + typeof t.buildIdentityGate)"], { cwd: dir });
  c(b.status === 0 && b.stdout === 'function function', 'require build-odds-performance.js first, then td-identity.js: the exports are whole');
  return r;
}
function scriptChecks(dir) {
  const r = [], c = (x, m) => r.push([!!x, m]);
  const run = build(dir, { GITHUB_ACTIONS: '' });
  c(run.status === 0, `the builder runs as a script with a career-history store (exit ${run.status}${run.status ? ': ' + String(run.stderr).split('\n').find(l => /Error/.test(l)) : ''})`);
  c(/identity gate: career-history store loaded/.test(run.stdout), 'the identity gate is ON (the store was read)');
  const ix = readJ(path.join(dir, 'odds-performance-index.json')), sh = readJ(path.join(dir, 'odds-performance', '101.json'));
  c(ix && ix.players && ix.players['101'] && ix.identityGate, 'odds-performance-index.json lists the player and the gate\'s stats');
  c(sh && sh.overall && sh.overall.matches === 36 && sh.overall.wins === 24, 'the shard carries his 36 matches (24-12)');
  return r;
}
function emptyStoreChecks(dir) {
  const r = [], c = (x, m) => r.push([!!x, m]);
  const run = build(dir, { GITHUB_ACTIONS: 'true' });
  c(run.status === 0, `an EMPTY career-history store is not a failure (exit ${run.status})`);
  c(/SKIP identity gate/.test(run.stdout) && /::warning title=odds-performance::no career-history store/.test(run.stdout),
    'an empty store is said out loud: the SKIP line and an Actions ::warning:: annotation');
  c(readJ(path.join(dir, 'odds-performance', '101.json')), 'the shard is still written (names joined without the gate)');
  return r;
}
function emptyRosterChecks(dir) {
  const r = [], c = (x, m) => r.push([!!x, m]);
  const run = build(dir);
  c(run.status !== 0 && /0 shards written/.test(run.stderr), 'a roster that yields no shard fails loudly (never publishes an empty index)');
  c(!fs.existsSync(path.join(dir, 'odds-performance-index.json')), 'and writes no index');
  return r;
}
const STEP_RE = /\n( {6}- name: Build market performance shards[^\n]*\n)((?: {8}[^\n]*\n|\s*\n)*)/;
function guardChecks(yml) {
  const r = [], c = (x, m) => r.push([!!x, m]);
  const m = STEP_RE.exec(yml);
  c(m, 'the pipeline has the market performance step');
  if (!m) return r;
  const step = m[1] + m[2];
  c(/run: node build-odds-performance\.js\n/.test(step), 'the step runs the builder directly: `run: node build-odds-performance.js`');
  c(!/\|\||set \+e|continue-on-error|step-check|best-effort|\|\s*true/.test(step), 'no `||`, `set +e`, continue-on-error, step-check swallow or best-effort label');
  const jobStart = yml.lastIndexOf('\n  build-and-deploy:', m.index), nextJob = yml.slice(jobStart + 2).search(/\n {2}[a-z][\w-]*:\n/);
  c(jobStart > 0 && (nextJob < 0 || jobStart + 2 + nextJob > m.index), 'the step is in the build-and-deploy job');
  const fa = /\n {2}fail-alert:\n((?: {4}[^\n]*\n|\s*\n)*)/.exec(yml);
  c(fa && /needs: build-and-deploy/.test(fa[1]) && /if: failure\(\)/.test(fa[1]) && /pipeline-fail-alert\.mjs/.test(fa[1]),
    'fail-alert needs build-and-deploy and runs on its failure (the Telegram)');
  return r;
}

console.log('1. the require cycle');
const d0 = sandbox(); cycleChecks(d0).forEach(([x, m]) => ok(x, m));
console.log('2. a script run with a career-history store');
scriptChecks(d0).forEach(([x, m]) => ok(x, m));
console.log('3. an empty career-history store');
emptyStoreChecks(sandbox(null, { career: 'empty' })).forEach(([x, m]) => ok(x, m));
console.log('4. a roster with no shard');
emptyRosterChecks(sandbox(null, { roster: false })).forEach(([x, m]) => ok(x, m));
console.log('5. source guard (.github/workflows/pipeline.yml)');
const YML = fs.readFileSync(path.join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
guardChecks(YML).forEach(([x, m]) => ok(x, m));

if (!process.argv.includes('--no-mutants')) {
  console.log('mutants (each must go red)');
  const sub = (a, b) => (t) => { if (!t.includes(a)) throw new Error('mutant anchor not found: ' + a.slice(0, 70)); return t.replace(a, b); };
  const MAIN = 'if (require.main === module) process.exit(main());\n';
  const red = (rs) => rs.some(([x]) => !x);
  const MUT = [
    ['M1 main() back above module.exports (the crash)', () => red(scriptChecks(sandbox({ 'build-odds-performance.js': (t) => {
      const i = t.indexOf('module.exports = {'); return sub(MAIN, '')(t).slice(0, i) + MAIN + sub(MAIN, '')(t).slice(i); } })))],
    ['M2 the gate silently skipped (never built)', () => red(scriptChecks(sandbox({ 'build-odds-performance.js': sub("const idGate = require('./td-identity.js').buildIdentityGate(", "const idGate = false && require('./td-identity.js').buildIdentityGate(") })))],
    ['M3 the empty-store annotation dropped', () => red(emptyStoreChecks(sandbox({ 'build-odds-performance.js': sub("if (!idGate && process.env.GITHUB_ACTIONS) console.log(", "if (false) console.log(") }, { career: 'empty' })))],
    ['M4 the zero-shard guard dropped', () => red(emptyRosterChecks(sandbox({ 'build-odds-performance.js': sub('if (!shipped) throw new Error(', 'if (false) throw new Error(') }, { roster: false })))],
    ['M5 the step swallows again (`|| rc=$?`)', () => red(guardChecks(sub('        run: node build-odds-performance.js\n', '        run: |\n          node build-odds-performance.js || rc=$?\n')(YML)))],
    ['M6 the step continue-on-error', () => red(guardChecks(sub('      - name: Build market performance shards (fail-closed)\n', '      - name: Build market performance shards (fail-closed)\n        continue-on-error: true\n')(YML)))],
  ];
  for (const [name, f] of MUT) { let isRed; try { isRed = f(); } catch (e) { isRed = false; console.log('        (mutant error: ' + e.message + ')'); } ok(isRed, `${name} → red`); }
}
console.log(`\ntest-oddsperf-cycle: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
