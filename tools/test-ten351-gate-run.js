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
// Wiring cases (code/data split, founder 2026-10-12: gate.yml tests CODE, pipeline.yml builds DATA, publish.yml deploys):
//   W1. gate.yml runs tools/gate-run.mjs, one shard per machine, on every push to main; no step is soft;
//   W2. only publish.yml deploys Pages, and only the code tools/publish-resolve.mjs picked (the newest GATED commit);
//       pipeline.yml deploys nothing and starts no gate of its own;
//   W3. gate.yml's result job, run for real: every shard passed → exit 0; failure / cancelled / skipped → exit 1;
//   W4. nothing runs a serial `npm test` in pipeline.yml, gate.yml or publish.yml (one gate, not two);
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
const WF = (f) => fs.readFileSync(path.join(ROOT, '.github/workflows', f), 'utf8');
const YML = WF('pipeline.yml');
const WY = { yml: YML, gate: WF('gate.yml'), publish: WF('publish.yml') };

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
function gate(src, testScript, shards, only) {
  const r = repoWith(src, testScript, { 'step.js': STEP });
  const out = spawnSync(process.execPath, [path.join(r.repo, 'tools', 'gate-run.mjs'), '--shards', String(shards), ...(only ? ['--shard', String(only)] : [])],
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
  // gate.yml runs one shard per machine (--shard K of N): together the N machines run every command exactly once,
  // each machine runs only its own shard, and a machine passes only when every command of ITS shard passed.
  'F. --shard K runs only shard K; the N machines together run every command once': (src) => {
    const all = [];
    for (let k = 1; k <= 3; k++) {
      const r = gate(src, chain('a', 'b', 'c', 'd', 'e', 'f', 'g'), 3, k);
      assert.strictEqual(r.status, 0, r.stdout.slice(-400));
      assert.ok(r.marks.length >= 1 && r.marks.length < 7, `shard ${k} ran ${r.marks.length} commands`);
      all.push(...r.marks);
    }
    assert.deepStrictEqual(all.sort(), ['a', 'b', 'c', 'd', 'e', 'f', 'g'], 'every command exactly once across the shards');
  },
  'G. --shard K fails when a command of shard K fails, and rejects a K outside the plan': (src) => {
    let failed = 0;
    for (let k = 1; k <= 2; k++) { const r = gate(src, chain('a', 'fail', 'c', 'd'), 2, k); if (r.marks.includes('fail')) { assert.strictEqual(r.status, 1); failed++; } else assert.strictEqual(r.status, 0); }
    assert.strictEqual(failed, 1, 'exactly one shard holds the failing command');
    const bad = gate(src, chain('a', 'b'), 2, 3);
    assert.strictEqual(bad.status, 1); assert.deepStrictEqual(bad.marks, [], 'nothing runs for a shard the plan does not have');
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
function runResult(gate, shardResult) {
  const job = gate.slice(gate.indexOf('\n  result:'));
  const script = job.split(/\n\s+run: \|\n/)[1].split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n')
    .split('${{ needs.shard.result }}').join(shardResult);
  return spawnSync('bash', ['-e', '-c', script], { encoding: 'utf8' }).status;
}
const WIRING = {
  'W1. gate.yml runs one shard per machine on every push to main, never soft': (w) => {
    assert.ok(/on:\n  push:\n    branches: \[main\]/.test(w.gate), 'gate.yml does not run on push to main');
    const run = /\n\s+run: (node tools\/gate-run\.mjs[^\n]*)/.exec(w.gate);
    assert.ok(run && /--shards "\$GATE_SHARDS" --shard \$\{\{ matrix\.shard \}\}/.test(run[1]), 'the shard step does not run gate-run.mjs --shard');
    const n = Number(/GATE_SHARDS: (\d+)/.exec(w.gate)[1]);
    assert.deepStrictEqual(/shard: \[([\d, ]+)\]/.exec(w.gate)[1].split(',').map(Number), Array.from({ length: n }, (_, i) => i + 1));
    assert.ok(!/continue-on-error/.test(w.gate), 'a gate step is soft');
  },
  'W2. only publish.yml deploys, only the gated code it resolved; pipeline.yml deploys nothing and runs no gate': (w) => {
    const code = (y) => y.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');   // comments may name the old wiring
    assert.ok(!/upload-pages-artifact|deploy-pages|gate-run\.mjs/.test(code(w.yml)), 'pipeline.yml still deploys Pages or runs a gate');
    assert.ok(/uses: actions\/deploy-pages@v4/.test(w.publish) && /uses: actions\/upload-pages-artifact@v3/.test(w.publish), 'publish.yml does not deploy');
    assert.ok(/\n\s+node tools\/publish-resolve\.mjs\n/.test(w.publish), 'publish.yml does not resolve the gated code');
    assert.ok(/git worktree add --detach "\$RUNNER_TEMP\/code" "\$\{\{ steps\.resolve\.outputs\.codeSha \}\}"/.test(w.publish), 'publish.yml does not check out the resolved gated commit');
    assert.ok(/--code "\$RUNNER_TEMP\/code"/.test(w.publish), 'publish.yml lays down other code than the gated checkout');
    assert.ok(/deploy:\n    needs: assemble\n    if: needs\.assemble\.outputs\.ready == 'true'/.test(w.publish), 'the deploy does not wait for a resolved, assembled site');
    assert.ok(/PUBLISH_DEPLOY: 'true'/.test(w.publish), 'publish.yml is still in shadow: nothing would deploy the site');
  },
  'W3. the gate passes only when every shard passed': (w) => {
    assert.strictEqual(runResult(w.gate, 'success'), 0, 'success');
    for (const r of ['failure', 'cancelled', 'skipped']) assert.strictEqual(runResult(w.gate, r), 1, r);
  },
  'W4. nothing else runs npm test in the job': (w) => {
    for (const [f, y] of Object.entries(w)) assert.ok(!/^\s+run: npm test\s*$/m.test(y), `a serial \`npm test\` step is wired in ${f}`);
  },
  'W5. the tournament-history seed runs before the build and cannot be stepped over': (w) => {
    const steps = stepsOf(w.yml);
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
    'return passed.length === expected ? 0 : 1;', 'return 0;'],
  ['--shard ignored (every machine runs the whole plan)', 'F. --shard K runs only shard K; the N machines together run every command once', 'src', "const shardPlan = only != null ? [fullPlan[only - 1]] : fullPlan;", "const shardPlan = fullPlan;"],
  ['--shard counts the whole plan as expected (a shard can never pass)', 'F. --shard K runs only shard K; the N machines together run every command once', 'src', "const expected = shardPlan.flat().length;", "const expected = cmds.length;"],
  ['a shard keeps going after a failure', 'B. a failure exits 1 and stops the rest of its shard', 'src',
    "if (rc !== 0) { log.end(() => resolve(results)); return; }", ''],
  ['every shard runs in the repo checkout', 'C. shards are isolated and the repo checkout is untouched', 'src',
    "spawn('sh', ['-c', cmds[i]], { cwd: dir,", "spawn('sh', ['-c', cmds[i]], { cwd: ROOT,"],
  ['a || chain is split anyway', 'D. a chain it cannot split safely aborts before anything runs', 'src',
    "throw new Error('scripts.test uses ||, ; or a lone & — only a plain `a && b && c` chain can be sharded safely');", ''],
  ['a command lands in two shards', 'E. the plan covers every command of the real package.json exactly once', 'src',
    "  const out = bins.map((b) => b.idx.sort((a, b2) => a - b2)).filter((b) => b.length);\n  // Every command in exactly one shard — or nothing runs.\n  const seen = out.flat().sort((a, b) => a - b);\n  if (seen.length !== cmds.length || seen.some((v, k) => v !== k)) throw new Error('shard plan does not cover every command exactly once');",
    "  const out = bins.map((b) => b.idx.sort((a, b2) => a - b2)).filter((b) => b.length);\n  if (out.length > 1) out[1] = [...new Set([...out[1], out[0][0]])].sort((a, b) => a - b);"],
  ['the gate runs the whole plan on one machine', 'W1. gate.yml runs one shard per machine on every push to main, never soft', 'gate',
    ' --shard ${{ matrix.shard }}', ''],
  ['a gate step made soft', 'W1. gate.yml runs one shard per machine on every push to main, never soft', 'gate',
    '      - name: Run this shard of every npm test command\n', '      - name: Run this shard of every npm test command\n        continue-on-error: true\n'],
  ['pipeline.yml deploys Pages again', 'W2. only publish.yml deploys, only the gated code it resolved; pipeline.yml deploys nothing and runs no gate', 'yml',
    '      - name: Upload the built site for publish.yml (site-data)\n', '      - name: Deploy to GitHub Pages\n        uses: actions/deploy-pages@v4\n\n      - name: Upload the built site for publish.yml (site-data)\n'],
  ['publish lays down the tip, not the gated commit', 'W2. only publish.yml deploys, only the gated code it resolved; pipeline.yml deploys nothing and runs no gate', 'publish',
    'node tools/publish-site.mjs --code "$RUNNER_TEMP/code"', 'node tools/publish-site.mjs --code "$PWD"'],
  ['publish left in shadow', 'W2. only publish.yml deploys, only the gated code it resolved; pipeline.yml deploys nothing and runs no gate', 'publish',
    "PUBLISH_DEPLOY: 'true'", "PUBLISH_DEPLOY: 'false'"],
  ['every shard runs in one shared directory', 'C. shards are isolated and the repo checkout is untouched', 'src',
    "spawn('sh', ['-c', cmds[i]], { cwd: dir,", "spawn('sh', ['-c', `cp -R ${JSON.stringify(dir)}/. ${JSON.stringify(tmpdir())}/ 2>/dev/null; cd ${JSON.stringify(tmpdir())} && ${cmds[i]}`], { cwd: dir,"],
  ['a cancelled shard passes', 'W3. the gate passes only when every shard passed', 'gate',
    '[ "${{ needs.shard.result }}" = "success" ] ||', '[ "${{ needs.shard.result }}" != "failure" ] ||'],
  ['the serial npm test step left in as well', 'W4. nothing else runs npm test in the job', 'gate',
    '      - name: Install dependencies\n        run: npm ci\n', '      - name: Install dependencies\n        run: npm ci\n\n      - name: Old gate\n        run: npm test\n'],
  ['the seed passes a failed hydrate', 'S2. an unreachable deployed index exits 1', 'seed',
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
  for (const [name, fn] of Object.entries(WIRING)) await check(`real: ${name}`, () => fn(WY));
  for (const [name, fn] of Object.entries(SEED)) await check(`real: ${name}`, () => fn(SEED_SRC));
  for (const [label, caseName, file, find, replace] of MUTANTS) {
    await check(`mutant bites — ${label} → "${caseName.split(' (')[0]}" fails`, async () => {
      const base = file === 'src' ? SRC : file === 'seed' ? SEED_SRC : WY[file];
      assert.strictEqual(base.split(find).length - 1, 1, `anchor must occur exactly once: ${find.slice(0, 80)}`);
      const mutated = base.replace(find, () => replace);
      const fn = (RUNNER[caseName] || WIRING[caseName] || SEED[caseName]);
      const arg = WIRING[caseName] ? { ...WY, [file]: mutated } : mutated;
      let failed = false;
      try { await fn(arg); } catch { failed = true; }
      assert.ok(failed, `"${caseName}" still passes with the mechanism cut out`);
    });
  }
  console.log(`\ngate run: ${pass} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
