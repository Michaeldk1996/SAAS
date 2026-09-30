#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// TEN-351 — the pre-deploy gate in parallel shards (tools/gate-run.mjs) and its pipeline wiring.
//
// FOUNDER, 2026-09-30 (TEN-312 6c9a9e55): the gate runs on EVERY rebuild; speed-ups may parallelise,
// cache or de-duplicate, never skip it, run it less often, or move it after publishing.
//
// Runner cases (the REAL tools/gate-run.mjs, copied into a throwaway git repo whose package.json
// `test` is a small chain; each command appends its name to a marker file outside the repo):
//   A. every command runs exactly once and a green chain exits 0;
//   B. a failing command exits 1, and the rest of ITS shard does not run (as `&&`);
//   C. shards are isolated: a file one command writes into its checkout is not seen by another shard,
//      and the repo's own working tree is untouched;
//   D. a chain it cannot split safely (||) aborts before anything runs;
//   E. the plan covers every command of the REAL package.json exactly once, for 1..8 shards.
// Wiring cases (.github/workflows/pipeline.yml):
//   W1. the gate starts before "Run pipeline" and runs tools/gate-run.mjs, writing its exit code;
//   W2. "Pre-deploy gate result" sits after the start and before the upload, the deploy and every
//       commit-back, and cannot be stepped over;
//   W3. that step's script, run for real: rc 0 → exit 0; rc 1 → exit 1; no rc → exit 1;
//   W4. nothing else runs `npm test` in the job (one gate, not two);
//   W5. "Seed tournament-history/" runs before the build and cannot be stepped over.
// Seed cases (the REAL tools/seed-tournament-history.js + tools/deployed-store.js, copied into a throwaway
// root, against a local fake site): the in-place gate used to leave the deployed shards in the checkout
// and "Assemble site" republished them; the seed keeps that, so the move changes nothing published.
//   S1. the deployed shard of every indexed player lands in tournament-history/, and it exits 0;
//   S2. an unreachable index exits 1 (fail-closed, as the gate's hydrate was).
// Every case is then run against named mutants of the real source; each mutant must fail its case.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync, spawn } = require('child_process');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(__dirname, 'gate-run.mjs'), 'utf8');
const YML = fs.readFileSync(path.join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');

// ── runner harness ──────────────────────────────────────────────────────────
function repoWith(src, testScript, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten351-gate-'));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tools', 'gate-run.mjs'), src);
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: testScript } }));
  for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(repo, f), body);
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'ignore' });
  git('init', '-q'); git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture');
  return { dir, repo, marks: path.join(dir, 'marks') };
}
// cmd N: append N to the marker file; `fail` exits 1; `write` drops scratch.txt in its checkout;
// `look` waits 1.5 s (so `write` has run) and fails if it can see scratch.txt.
const STEP = `const fs=require('fs');const n=process.argv[2];fs.appendFileSync(process.env.MARKS,n+'\\n');
if(n==='fail')process.exit(1);
if(n==='write')fs.writeFileSync('scratch.txt','x');
if(n==='look'){const t=Date.now()+1500;while(Date.now()<t){}if(fs.existsSync('scratch.txt'))process.exit(3);}`;
const tmpOf = (dir) => { const t = path.join(dir, 'tmp'); fs.mkdirSync(t, { recursive: true }); return t; };
function gate(src, testScript, shards) {
  const r = repoWith(src, testScript, { 'step.js': STEP });
  const out = spawnSync(process.execPath, [path.join(r.repo, 'tools', 'gate-run.mjs'), '--shards', String(shards)],
    { cwd: r.repo, env: { ...process.env, MARKS: r.marks, TMPDIR: tmpOf(r.dir) }, encoding: 'utf8' });
  const marks = fs.existsSync(r.marks) ? fs.readFileSync(r.marks, 'utf8').trim().split('\n').filter(Boolean) : [];
  const rootDirty = execFileSync('git', ['-C', r.repo, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  const worktrees = execFileSync('git', ['-C', r.repo, 'worktree', 'list'], { encoding: 'utf8' }).trim().split('\n').length;
  fs.rmSync(r.dir, { recursive: true, force: true });
  return { status: out.status, stdout: out.stdout + out.stderr, marks, rootDirty, worktrees };
}
const chain = (...names) => names.map((n) => `node step.js ${n}`).join(' && ');

const RUNNER = {
  'A. every command runs exactly once; a green chain exits 0': (src) => {
    const r = gate(src, chain('a', 'b', 'c', 'd', 'e'), 2);
    assert.strictEqual(r.status, 0, r.stdout.slice(-400));
    assert.deepStrictEqual([...r.marks].sort(), ['a', 'b', 'c', 'd', 'e']);
    assert.strictEqual(r.worktrees, 1, 'the shard worktrees are removed afterwards');
  },
  'B. a failure exits 1 and stops the rest of its shard': (src) => {
    // one shard, so the order is fixed: a, fail, c — c must not run
    const r = gate(src, chain('a', 'fail', 'c'), 1);
    assert.strictEqual(r.status, 1, r.stdout.slice(-400));
    assert.deepStrictEqual(r.marks, ['a', 'fail']);
    assert.ok(/FAILED \(rc=1\): node step\.js fail/.test(r.stdout), 'the failing command is named');
  },
  'C. shards are isolated and the repo checkout is untouched': (src) => {
    // two commands, two shards: `write` and `look` never share a checkout
    const r = gate(src, chain('write', 'look'), 2);
    assert.strictEqual(r.status, 0, r.stdout.slice(-400));
    assert.deepStrictEqual([...r.marks].sort(), ['look', 'write'], 'both commands ran');
    assert.strictEqual(r.rootDirty, '', `the repo working tree changed: ${r.rootDirty}`);
  },
  'D. a chain it cannot split safely aborts before anything runs': (src) => {
    const r = gate(src, 'node step.js a || node step.js b', 2);
    assert.strictEqual(r.status, 1);
    assert.deepStrictEqual(r.marks, []);
  },
  'E. the plan covers every command of the real package.json exactly once': async (src) => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ten351-plan-')), 'gate-run.mjs');
    fs.writeFileSync(f, src);
    const M = await import(f);
    const cmds = M.commandsOf(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts.test);
    assert.ok(cmds.length > 50, `only ${cmds.length} commands parsed`);
    for (let n = 1; n <= 8; n++) {
      const p = M.plan(cmds, n);
      const all = p.flat().sort((a, b) => a - b);
      assert.deepStrictEqual(all, cmds.map((c, i) => i), `${n} shards`);
      p.forEach((s) => assert.deepStrictEqual(s, [...s].sort((a, b) => a - b), 'a shard runs in package.json order'));
    }
    fs.rmSync(path.dirname(f), { recursive: true, force: true });
  },
};


// ── seed harness ────────────────────────────────────────────────────────────
const SEED_SRC = fs.readFileSync(path.join(__dirname, 'seed-tournament-history.js'), 'utf8');
const STORE_SRC = fs.readFileSync(path.join(__dirname, 'deployed-store.js'), 'utf8');
async function seed(src, { indexDown = false } = {}) {
  const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/player-profiles.json') { res.end(JSON.stringify({ fetchedAt: 'x', players: { p1: {}, p2: {} } })); return; }
    if (u === '/tournament-history-index.json') {
      if (indexDown) { res.statusCode = 503; res.end('down'); return; }
      res.end(JSON.stringify({ players: { p1: { n: 1 } } })); return;
    }
    if (u === '/tournament-history/p1.json') { res.end(JSON.stringify({ v: 1, key: 'p1', tournamentHistory: [{ name: 'DEPLOYED' }] })); return; }
    res.statusCode = 404; res.end('nope');
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ten351-seed-'));
  fs.mkdirSync(path.join(root, 'tools'));
  fs.writeFileSync(path.join(root, 'tools', 'seed-tournament-history.js'), src);
  fs.writeFileSync(path.join(root, 'tools', 'deployed-store.js'), STORE_SRC);
  const status = await new Promise((ok) => {
    const ch = spawn(process.execPath, [path.join(root, 'tools', 'seed-tournament-history.js')], {
      env: { ...process.env, TEN206_DATA_BASE: `http://127.0.0.1:${srv.address().port}`, PP2_BUILT_STORE: '' }, stdio: 'ignore' });
    ch.on('close', ok);
  });
  srv.closeAllConnections(); srv.close();
  const f = path.join(root, 'tournament-history', 'p1.json');
  const shard = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  fs.rmSync(root, { recursive: true, force: true });
  return { status, shard };
}
const SEED = {
  'S1. every indexed deployed shard lands in tournament-history/': async (src) => {
    const r = await seed(src);
    assert.strictEqual(r.status, 0);
    assert.ok(r.shard && r.shard.tournamentHistory[0].name === 'DEPLOYED', JSON.stringify(r.shard));
  },
  'S2. an unreachable deployed index exits 1': async (src) => {
    const r = await seed(src, { indexDown: true });
    assert.strictEqual(r.status, 1);
  },
};

// ── wiring ──────────────────────────────────────────────────────────────────
const stepsOf = (yml) => yml.split(/\n(?=      - name: )/).map((s) => ({
  name: (/^\s*- name: (.*)/m.exec(s) || [])[1] || '',
  body: s.replace(/\n\s*\n(\s*#[^\n]*\n?)*\s*$/, ''),
}));
function runWait(yml, rc) {
  const steps = stepsOf(yml);
  const w = steps.find((s) => /^Pre-deploy gate result/.test(s.name));
  const script = w.body.split(/\n\s+run: \|\n/)[1].split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten351-wait-'));
  fs.mkdirSync(path.join(tmp, 'gate'));
  fs.writeFileSync(path.join(tmp, 'gate', 'log'), 'gate log\n');
  if (rc != null) fs.writeFileSync(path.join(tmp, 'gate', 'rc'), `${rc}\n`);
  const r = spawnSync('bash', ['-e', '-c', script], { env: { ...process.env, RUNNER_TEMP: tmp, GATE_WAIT_SECONDS: '2' }, encoding: 'utf8' });
  fs.rmSync(tmp, { recursive: true, force: true });
  return r.status;
}
const WIRING = {
  'W1. the gate starts before the build and records its exit code': (yml) => {
    const steps = stepsOf(yml);
    const at = (re) => steps.findIndex((s) => re.test(s.name));
    const start = at(/^Start the pre-deploy gate/), build = at(/^Run pipeline/);
    assert.ok(start > -1 && build > -1, 'anchor steps not found');
    assert.ok(start < build, `the gate starts at #${start}, after the build (#${build})`);
    assert.ok(/set \+e; node tools\/gate-run\.mjs[^\n]*> "\$RUNNER_TEMP\/gate\/log" 2>&1; echo \$\? > "\$RUNNER_TEMP\/gate\/rc" \) &/.test(steps[start].body), steps[start].body.slice(-300));
  },
  'W2. the result step sits before the upload, the deploy and every commit-back, and cannot be stepped over': (yml) => {
    const steps = stepsOf(yml);
    const at = (re) => steps.findIndex((s) => re.test(s.name));
    const start = at(/^Start the pre-deploy gate/), wait = at(/^Pre-deploy gate result/);
    const guard = at(/^Deploy ancestor guard/), upload = at(/^Upload Pages artifact$/), deploy = at(/^Deploy to GitHub Pages$/);
    const commitbacks = steps.map((s, i) => (/commitback-push\.sh/.test(s.body) ? i : -1)).filter((i) => i > -1);
    assert.ok(wait > -1 && guard > -1 && upload > -1 && deploy > -1 && commitbacks.length, 'anchor steps not found');
    assert.ok(wait > start, 'the result is read before the gate starts');
    assert.ok(wait < guard && wait < upload && wait < deploy, `the result step #${wait} runs after a publish step`);
    assert.ok(commitbacks.every((i) => i > wait), `a commit-back runs before the gate result: #${commitbacks.join(',')}`);
    assert.ok(!/continue-on-error|^\s+if:|\|\|/m.test(steps[wait].body), 'the result step is soft');
  },
  'W3. the result step passes only on rc 0': (yml) => {
    assert.strictEqual(runWait(yml, 0), 0, 'rc 0');
    assert.strictEqual(runWait(yml, 1), 1, 'rc 1');
    assert.strictEqual(runWait(yml, null), 1, 'no rc');
  },
  'W4. nothing else runs npm test in the job': (yml) => {
    assert.ok(!/^\s+run: npm test\s*$/m.test(yml), 'a serial `npm test` step is still wired');
  },  'W5. the tournament-history seed runs before the build and cannot be stepped over': (yml) => {
    const steps = stepsOf(yml);
    const at = (re) => steps.findIndex((s) => re.test(s.name));
    const sd = at(/^Seed tournament-history\/ from the deployed store$/), build = at(/^Run pipeline/);
    assert.ok(sd > -1 && build > -1, 'anchor steps not found');
    assert.ok(sd < build, `the seed #${sd} runs after the build #${build}`);
    assert.ok(/\n\s+run: node tools\/seed-tournament-history\.js\s*$/.test(steps[sd].body), steps[sd].body.slice(-200));
    assert.ok(!/continue-on-error|^\s+if:|\|\|/m.test(steps[sd].body), 'the seed step is soft');
  },
};

// ── named mutants ───────────────────────────────────────────────────────────
const MUTANTS = [
  // [label, case, file ('src'|'yml'), find, replace]
  ['a command dropped from the plan (and the coverage check gone)', 'A. every command runs exactly once; a green chain exits 0', 'src',
    "  if (seen.length !== cmds.length || seen.some((v, k) => v !== k)) throw new Error('shard plan does not cover every command exactly once');\n  return out;",
    '  return out.map((s, k) => (k === 0 ? s.slice(1) : s));'],
  ['a failure is reported but the gate exits 0', 'B. a failure exits 1 and stops the rest of its shard', 'src',
    'return passed.length === cmds.length ? 0 : 1;', 'return 0;'],
  ['a shard keeps going after a failure', 'B. a failure exits 1 and stops the rest of its shard', 'src',
    "if (rc !== 0) { log.end(() => resolve(results)); return; }", ''],
  ['every shard runs in the repo checkout', 'C. shards are isolated and the repo checkout is untouched', 'src',
    "spawn('sh', ['-c', cmds[i]], { cwd: dir,", "spawn('sh', ['-c', cmds[i]], { cwd: ROOT,"],
  ['a || chain is split anyway', 'D. a chain it cannot split safely aborts before anything runs', 'src',
    "throw new Error('scripts.test uses ||, ; or a lone & — only a plain `a && b && c` chain can be sharded safely');", ''],
  ['a command lands in two shards', 'E. the plan covers every command of the real package.json exactly once', 'src',
    "  const out = bins.map((b) => b.idx.sort((a, b2) => a - b2)).filter((b) => b.length);\n  // Every command in exactly one shard — or nothing runs.\n  const seen = out.flat().sort((a, b) => a - b);\n  if (seen.length !== cmds.length || seen.some((v, k) => v !== k)) throw new Error('shard plan does not cover every command exactly once');",
    "  const out = bins.map((b) => b.idx.sort((a, b2) => a - b2)).filter((b) => b.length);\n  if (out.length > 1) out[1] = [...new Set([...out[1], out[0][0]])].sort((a, b) => a - b);"],
  ['the gate starts after the build', 'W1. the gate starts before the build and records its exit code', 'yml',
    '      - name: Start the pre-deploy gate (runs beside the build)',
    '      - name: Run pipeline (moved ahead of the gate)\n        run: node run-pipeline.js\n\n      - name: Start the pre-deploy gate (runs beside the build)'],
  ['a publish step before the gate result', 'W2. the result step sits before the upload, the deploy and every commit-back, and cannot be stepped over', 'yml',
    '      - name: Pre-deploy gate result (fail-closed; nothing publishes until it passes)\n',
    '      - name: Upload Pages artifact\n        uses: actions/upload-pages-artifact@v3\n\n      - name: Pre-deploy gate result (fail-closed; nothing publishes until it passes)\n'],
  ['every shard runs in one shared directory', 'C. shards are isolated and the repo checkout is untouched', 'src',
    "spawn('sh', ['-c', cmds[i]], { cwd: dir,", "spawn('sh', ['-c', `cp -R ${JSON.stringify(dir)}/. ${JSON.stringify(tmpdir())}/ 2>/dev/null; cd ${JSON.stringify(tmpdir())} && ${cmds[i]}`], { cwd: dir,"],
  ['the exit code is not recorded when the runner fails (bash -e subshell)', 'W1. the gate starts before the build and records its exit code', 'yml',
    '( set +e; node tools/gate-run.mjs', '( node tools/gate-run.mjs'],
  ['the result step made soft', 'W2. the result step sits before the upload, the deploy and every commit-back, and cannot be stepped over', 'yml',
    '      - name: Pre-deploy gate result (fail-closed; nothing publishes until it passes)\n',
    '      - name: Pre-deploy gate result (fail-closed; nothing publishes until it passes)\n        continue-on-error: true\n'],
  ['a missing result passes', 'W3. the result step passes only on rc 0', 'yml',
    '            echo "::error title=pre-deploy gate::no result after ${GATE_WAIT_SECONDS} s. Nothing publishes."\n            exit 1',
    '            echo "::error title=pre-deploy gate::no result after ${GATE_WAIT_SECONDS} s. Nothing publishes."\n            exit 0'],
  ['a red result passes', 'W3. the result step passes only on rc 0', 'yml',
    '            echo "::error title=pre-deploy gate::failed (exit ${rc}). Nothing publishes."\n            exit 1',
    '            echo "::error title=pre-deploy gate::failed (exit ${rc}). Nothing publishes."\n            exit 0'],
  ['the serial npm test step left in as well', 'W4. nothing else runs npm test in the job', 'yml',
    '      - name: Start the pre-deploy gate (runs beside the build)',
    '      - name: Old gate\n        run: npm test\n\n      - name: Start the pre-deploy gate (runs beside the build)'],  ['the seed passes a failed hydrate', 'S2. an unreachable deployed index exits 1', 'seed',
    "  console.error(`::error title=tournament-history seed::${TH.error || `attached ${TH.attached} of ${TH.indexed} indexed players`}`);\n  process.exit(1);",
    "  console.error(`::error title=tournament-history seed::${TH.error || `attached ${TH.attached} of ${TH.indexed} indexed players`}`);"],
  ['the seed hydrates nothing', 'S1. every indexed deployed shard lands in tournament-history/', 'seed',
    'const TH = DEPLOYED.hydrateTournamentHistory(STORE.players);', 'const TH = { attached: 1, indexed: 1, fetched: 0 };'],
  ['the seed step moved after the build', 'W5. the tournament-history seed runs before the build and cannot be stepped over', 'yml',
    '      - name: Seed tournament-history/ from the deployed store\n',
    '      - name: Run pipeline (moved ahead of the seed)\n        run: node run-pipeline.js\n\n      - name: Seed tournament-history/ from the deployed store\n'],
];

(async () => {
  let pass = 0; const fails = [];
  const check = async (name, fn) => {
    try { await fn(); pass++; console.log(`  ok   ${name}`); } catch (e) { fails.push(name); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`); }
  };
  console.log('\nTEN-351 · pre-deploy gate in parallel shards (tools/gate-run.mjs) + pipeline wiring\n');
  for (const [name, fn] of Object.entries(RUNNER)) await check(`real: ${name}`, () => fn(SRC));
  for (const [name, fn] of Object.entries(WIRING)) await check(`real: ${name}`, () => fn(YML));
  for (const [name, fn] of Object.entries(SEED)) await check(`real: ${name}`, () => fn(SEED_SRC));
  for (const [label, caseName, file, find, replace] of MUTANTS) {
    await check(`mutant bites — ${label} → "${caseName.split(' (')[0]}" fails`, async () => {
      const base = file === 'src' ? SRC : file === 'seed' ? SEED_SRC : YML;
      assert.strictEqual(base.split(find).length - 1, 1, `anchor must occur exactly once: ${find.slice(0, 80)}`);
      const mutated = base.replace(find, () => replace);
      const fn = (RUNNER[caseName] || WIRING[caseName] || SEED[caseName]);
      let failed = false;
      try { await fn(mutated); } catch { failed = true; }
      assert.ok(failed, `"${caseName}" still passes with the mechanism cut out`);
    });
  }
  console.log(`\ngate run: ${pass} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
