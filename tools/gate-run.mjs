#!/usr/bin/env node
// tools/gate-run.mjs — the pre-deploy gate (every `npm test` command, exactly once) in parallel shards.
//
// TEN-351 (founder ruling 2026-09-30, TEN-312 6c9a9e55): the gate runs on EVERY rebuild; it may be
// parallelised, cached or de-duplicated, never skipped, run less often, or moved after publishing.
// Measured 2026-09-29: `npm test` ran serially for 577 s median of a 17 min run, before the build.
// pipeline.yml now starts this runner in the background before the build and waits for it before
// anything is uploaded, deployed or committed back.
//
// What it guarantees (tools/test-ten351-gate-run.js):
//   - the command list is package.json `scripts.test` split on ` && `, and every command runs exactly
//     once. A list it cannot split safely (`||`, `;`, a lone `&`) aborts before anything runs;
//   - each shard runs its commands in package.json order, in its OWN clean worktree of HEAD, and
//     stops at its first failure exactly as `&&` would. Shards share no working tree, so one suite's
//     scratch files (.deployed-cache/, hydrated shards, built indexes) can never reach another;
//   - exit 0 only when every command ran and passed. Anything else — a failed command, a command
//     that never ran, a worktree that could not be made — is exit 1.
//
// It tests HEAD, not uncommitted edits: pipeline.yml runs it on a clean checkout. tools/ci-suite.sh still
// runs the same commands serially (`npm test`) before a push.
//
// Usage: node tools/gate-run.mjs [--shards N] [--plan]
//   --plan  print the shard plan and exit (no tests run).

import { readFileSync, mkdtempSync, rmSync, existsSync, cpSync, createWriteStream, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Seconds per command, measured serially on a clean worktree 2026-09-30 (TEN-351; 663 s in all).
// Only used to balance the shards: a wrong or missing weight costs time, never a check. A key matches
// every command that starts with it; unlisted commands weigh DEFAULT_WEIGHT.
export const WEIGHTS = {
  'node --test test-ten225-drift-order.mjs': 203,   // the ~45-file node --test batch
  'node tools/test-ten304-mutants.js': 123,
  'node tools/test-ten303-mutants.js': 80,
  'python3 -B test-ten270-cardstate-egress.py': 78,
  'node tools/test-ten314-mutants.js': 31,
  'node tools/test-perset-games-carry.js': 20,
  'node tools/test-pp2-reconcile.js': 16,
  'node tools/test-ten341-mutants.js': 11,
  'node tools/test-surface-ratings-no-autorun.js': 9,
  'node tools/test-ten273-parallel-fetch.js': 8,
  'node tools/test-ten304-build-weather.js': 8,
  'node tools/test-ten350-mutants.js': 7,
  'node tools/test-ten340-mutants.js': 6,
  'node tools/test-ten255-build-stamp.js': 6,
  'node tools/test-commitback-push.js': 5,
};
const DEFAULT_WEIGHT = 2;
const weightOf = (cmd) => {
  const k = Object.keys(WEIGHTS).find((w) => cmd === w || cmd.startsWith(`${w} `));
  return k ? WEIGHTS[k] : DEFAULT_WEIGHT;
};

/** package.json `scripts.test` → the ordered command list. Throws on a shape it cannot split safely. */
export function commandsOf(testScript) {
  if (typeof testScript !== 'string' || !testScript.trim()) throw new Error('package.json has no scripts.test');
  if (/\|\||;|(^|[^&])&([^&]|$)/.test(testScript)) {
    throw new Error('scripts.test uses ||, ; or a lone & — only a plain `a && b && c` chain can be sharded safely');
  }
  const cmds = testScript.split(' && ').map((c) => c.trim());
  if (cmds.some((c) => !c || c.includes('&&'))) throw new Error('scripts.test does not split cleanly on " && "');
  return cmds;
}

/** Longest-first onto the lightest shard; each shard keeps package.json order. → [[index…], …] */
export function plan(cmds, shards, weight = weightOf) {
  const n = Math.max(1, Math.min(shards, cmds.length));
  const bins = Array.from({ length: n }, () => ({ load: 0, idx: [] }));
  const order = cmds.map((c, i) => i).sort((a, b) => weight(cmds[b]) - weight(cmds[a]) || a - b);
  for (const i of order) {
    const bin = bins.reduce((m, b) => (b.load < m.load ? b : m), bins[0]);
    bin.idx.push(i); bin.load += weight(cmds[i]);
  }
  const out = bins.map((b) => b.idx.sort((a, b2) => a - b2)).filter((b) => b.length);
  // Every command in exactly one shard — or nothing runs.
  const seen = out.flat().sort((a, b) => a - b);
  if (seen.length !== cmds.length || seen.some((v, k) => v !== k)) throw new Error('shard plan does not cover every command exactly once');
  return out;
}

function runShard(k, idx, cmds, dir, tmp, logFile) {
  return new Promise((resolve) => {
    const log = createWriteStream(logFile);
    const results = [];
    let at = 0;
    const next = () => {
      if (at >= idx.length) { log.end(() => resolve(results)); return; }
      const i = idx[at++];
      const t0 = Date.now();
      log.write(`\n$ ${cmds[i]}\n`);
      const ch = spawn('sh', ['-c', cmds[i]], { cwd: dir, env: { ...process.env, TMPDIR: tmp }, stdio: ['ignore', 'pipe', 'pipe'] });
      const onData = (d) => log.write(d);
      ch.stdout.on('data', onData); ch.stderr.on('data', onData);
      // Move on when the command EXITS, as `&&` does. Its output gets up to 5 s to drain; a stray
      // grandchild that keeps the pipe open must not hang the shard (`npm test` never waited for it).
      let done = false;
      const finish = (code, sig) => {
        if (done) return; done = true;
        ch.stdout.off('data', onData); ch.stderr.off('data', onData);
        const rc = code == null ? `signal ${sig}` : code;
        const s = (Date.now() - t0) / 1000;
        results.push({ i, rc, s });
        // Live progress, so a hang is visible in the log while the run is still going.
        console.log(`shard ${k + 1}  ${rc === 0 ? 'ok  ' : 'FAIL'}  ${s.toFixed(1).padStart(6)} s  ${cmds[i].slice(0, 100)}`);
        if (rc !== 0) { log.end(() => resolve(results)); return; }   // `&&`: stop this shard at its first failure
        next();
      };
      ch.on('exit', (code, sig) => {
        const t = setTimeout(() => finish(code, sig), 5000);
        ch.on('close', () => { clearTimeout(t); finish(code, sig); });
      });
    };
    next();
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const nArg = argv.indexOf('--shards');
  const shards = nArg > -1 ? Number(argv[nArg + 1]) : 3;
  if (!Number.isInteger(shards) || shards < 1) throw new Error(`--shards must be a positive integer, got ${argv[nArg + 1]}`);
  const cmds = commandsOf(JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts?.test);
  const shardPlan = plan(cmds, shards);
  shardPlan.forEach((idx, k) => console.log(`shard ${k + 1}: ${idx.length} commands, ~${idx.reduce((a, i) => a + weightOf(cmds[i]), 0)} s planned`));
  if (argv.includes('--plan')) {
    shardPlan.forEach((idx, k) => idx.forEach((i) => console.log(`  ${k + 1}  #${i + 1}  ${cmds[i]}`)));
    return 0;
  }

  const t0 = Date.now();
  const made = [];
  let results;
  try {
    // Every worktree exists before any command starts: a failure here runs nothing.
    shardPlan.forEach((idx, k) => {
      const base = mkdtempSync(path.join(tmpdir(), `gate-${k + 1}-`));
      const dir = path.join(base, 'tree');
      made.push({ base, dir });
      execFileSync('git', ['-C', ROOT, 'worktree', 'add', '--detach', '--quiet', dir, 'HEAD'], { stdio: ['ignore', 'ignore', 'inherit'] });
      if (existsSync(path.join(ROOT, 'node_modules'))) cpSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), { recursive: true, verbatimSymlinks: true });
    });
    results = await Promise.all(shardPlan.map((idx, k) => {
      const { base, dir } = made[k];
      return runShard(k, idx, cmds, dir, mkdtempSync(path.join(base, 'tmp-')), path.join(base, 'log'));
    }));
    // Logs, one shard at a time, so each suite's output stays contiguous.
    made.forEach(({ base }, k) => {
      console.log(`\n================ shard ${k + 1} ================`);
      process.stdout.write(readFileSync(path.join(base, 'log'), 'utf8'));
    });
  } finally {
    for (const { base, dir } of made) {
      try { execFileSync('git', ['-C', ROOT, 'worktree', 'remove', '--force', dir], { stdio: 'ignore' }); } catch { /* reported by the count below */ }
      rmSync(base, { recursive: true, force: true });
    }
  }

  const ran = results.flat();
  const passed = ran.filter((r) => r.rc === 0);
  console.log('\n================ pre-deploy gate ================');
  ran.sort((a, b) => b.s - a.s).slice(0, 12).forEach((r) => console.log(`${r.s.toFixed(1).padStart(7)} s  rc=${r.rc}  ${cmds[r.i].slice(0, 110)}`));
  for (const r of ran.filter((x) => x.rc !== 0)) console.log(`::error title=pre-deploy gate::FAILED (rc=${r.rc}): ${cmds[r.i]}`);
  const notRun = cmds.length - ran.length;
  console.log(`gate: ${passed.length}/${cmds.length} commands passed, ${notRun} not run, ${shardPlan.length} shards, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return passed.length === cmds.length ? 0 : 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().then((rc) => process.exit(rc), (e) => { console.error(`::error title=pre-deploy gate::${e.message}`); process.exit(1); });
}
