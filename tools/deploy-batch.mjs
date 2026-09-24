#!/usr/bin/env node
// TEN-273 item 3 — one build for several ready commits.
//
// FOUNDER, 2026-09-25: "When more than one agent has a ready commit, combine
// them into one push and one pipeline run. Run the suite and clobber check on
// the combined tree first. If anything conflicts, fall back to one-by-one."
//
// Run by the LANE HOLDER, after `deploy-lane.mjs claim` gave exit 0:
//
//   node tools/deploy-batch.mjs --ticket TEN-123 --sha <your ready commit>
//
// 1. Refuses (exit 1) unless the caller holds the lane.
// 2. `git fetch origin`; a temp worktree at origin/main (START).
// 3. Cherry-picks the holder's commits (merge-base..S), then each queued entry
//    (`deploy-lane.mjs ready`) in readyAt order. An entry that conflicts is
//    aborted and skipped: it stays queued, marked `conflict` with the reason.
// 4. On the combined tree: tools/clobber-check.sh START <every file the
//    combined commits write>, then tools/ci-suite.sh <combined head>.
// 5. Both pass → `git push origin <head>:main`. Rejected because data-bot
//    `[skip ci]` commits landed → replay onto the new origin/main, re-run the
//    clobber check, retry ONCE. A CODE commit landed → fall back.
// 6. Success → each included entry gets `landedAs` (its last commit in the
//    combined history) in the store, a notice on its issue, and leaves the queue.
// 7. Clobber check / suite / push fails on the combined tree → FALL BACK to
//    one-by-one: land only the holder's own commit as a normal land (it already
//    has its own suite receipt; rebased + clobber check against its merge-base),
//    leave the others queued, and say why.
// Prints a JSON summary. Exit: 0 pushed · 1 refused / nothing pushed · 2 usage · 6 error.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { git as realGit, gitRebaseCheck, realLane, whoAmI } from './deploy-lane.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITE_TIMEOUT_MS = 25 * 60 * 1000;
const CLOBBER_TIMEOUT_MS = 120000;

export function realClobberCheck({ cwd = process.cwd() } = {}) {
  return ({ base, files }) => {
    const r = spawnSync('bash', [path.join(HERE, 'clobber-check.sh'), base, ...files], { cwd, encoding: 'utf8', timeout: CLOBBER_TIMEOUT_MS });
    return { ok: r.status === 0, output: `${r.stdout || ''}${r.stderr || ''}`.trim() };
  };
}

export function realSuite({ cwd = process.cwd() } = {}) {
  return async (sha) => {
    const r = spawnSync('bash', [path.join(HERE, 'ci-suite.sh'), sha], { cwd, encoding: 'utf8', timeout: SUITE_TIMEOUT_MS });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const m = out.match(/^log: (.*)$/m);
    return { ok: r.status === 0, exit: r.status, log: m ? m[1] : null, output: out.trim().split('\n').slice(-5).join('\n') };
  };
}

const isData = (body) => body.includes('[skip ci]');

export async function runBatch({ lane, me, sha, repo = process.cwd(), git = realGit, suite, clobber, notify, rebaseCheck }) {
  const G = (args, cwd = repo) => git(args, { cwd });
  rebaseCheck = rebaseCheck || gitRebaseCheck({ cwd: repo });

  const held = await lane.renew(me);
  if (held.code !== 0) return { code: 1, action: 'not-holder', detail: 'deploy-batch runs only for the lane holder: claim the lane first', claim: held.claim };

  const full = G(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
  if (full.status !== 0) return { code: 1, action: 'refused', detail: `${sha} is not a commit in ${repo}` };
  sha = full.stdout;
  if (G(['fetch', 'origin', '--quiet']).status !== 0) return { code: 1, action: 'refused', detail: 'git fetch origin failed' };
  const START = G(['rev-parse', 'origin/main']).stdout;

  const entries = lane.peek().queue.filter((e) => e.runId !== me.runId).sort((a, b) => Date.parse(a.readyAt) - Date.parse(b.readyAt));
  const holder = { ticket: me.ticket, issueId: me.issueId, runId: me.runId, sha, holder: true };

  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-batch-'));
  const W = (args) => G(args, wt);
  if (G(['worktree', 'add', '-q', '--detach', wt, START]).status !== 0) return { code: 6, action: 'error', detail: 'could not create the batch worktree' };

  // Replays groups onto `onto`. The holder must apply; an entry that does not is skipped.
  function build(onto, groups) {
    W(['reset', '-q', '--hard', onto]);
    const included = []; const skipped = [];
    for (const g of groups) {
      if (W(['cat-file', '-e', `${g.sha}^{commit}`]).status !== 0) { skipped.push({ ...g, reason: `${g.sha} is not in this repository` }); continue; }
      const mb = W(['merge-base', g.sha, onto]);
      if (mb.status !== 0) { skipped.push({ ...g, reason: `no merge-base with origin/main` }); continue; }
      const commits = W(['rev-list', '--reverse', `${mb.stdout}..${g.sha}`]).stdout.split('\n').filter(Boolean);
      if (!commits.length) { included.push({ ...g, commits, landedAs: g.sha, already: true }); continue; }
      const before = W(['rev-parse', 'HEAD']).stdout;
      const cp = W(['-c', 'core.hooksPath=/dev/null', 'cherry-pick', ...commits]);
      if (cp.status !== 0) {
        W(['cherry-pick', '--abort']);
        W(['reset', '-q', '--hard', before]);
        const reason = `does not apply on top of the batch: ${(cp.stderr || cp.stdout).split('\n').filter((l) => /CONFLICT|error|empty/i.test(l)).slice(0, 3).join(' | ') || 'cherry-pick failed'}`;
        if (g.holder) return { ok: false, reason: `the holder's own commit ${reason}` };
        skipped.push({ ...g, reason }); continue;
      }
      included.push({ ...g, commits, landedAs: W(['rev-parse', 'HEAD']).stdout });
    }
    const head = W(['rev-parse', 'HEAD']).stdout;
    return { ok: true, head, included, skipped, files: W(['diff', '--name-only', onto, head]).stdout.split('\n').filter(Boolean) };
  }

  // Push; if rejected because data-bot commits landed, replay and retry once.
  async function push(b, checkBase, groups) {
    for (let attempt = 0; ; attempt++) {
      if ((await lane.renew(me)).code !== 0) return { ok: false, fatal: true, reason: 'the lane auto-released before the push — nothing pushed' };
      const p = W(['push', '-q', 'origin', `${b.head}:refs/heads/main`]);
      if (p.status === 0) return { ok: true, b, attempts: attempt + 1 };
      if (attempt >= 1) return { ok: false, reason: `push rejected twice: ${p.stderr.split('\n')[0]}` };
      if (G(['fetch', 'origin', '--quiet']).status !== 0) return { ok: false, reason: 'git fetch origin failed after a rejected push' };
      const tip = G(['rev-parse', 'origin/main']).stdout;
      const landed = G(['log', '--format=%H%x1f%s%x1f%B%x1e', `${b.head}..${tip}`]).stdout.split('\x1e').map((x) => x.trim()).filter(Boolean)
        .map((x) => { const [h, s, body] = x.split('\x1f'); return { sha: h, subject: s, body }; });
      const code = landed.filter((c) => !isData(c.body));
      if (code.length) return { ok: false, reason: `a code commit landed on origin/main during the batch: ${code.map((c) => `${c.sha.slice(0, 8)} ${c.subject}`).join('; ')}` };
      const nb = build(tip, groups);
      if (!nb.ok || nb.skipped.length) return { ok: false, reason: `replay onto the new origin/main failed: ${nb.reason || nb.skipped.map((s) => s.reason).join('; ')}` };
      const ck = clobber({ base: checkBase, files: nb.files });
      if (!ck.ok) return { ok: false, reason: `clobber check after the data-bot rebase failed:\n${ck.output}` };
      b = nb;
    }
  }

  async function finish(mode, b, extra) {
    const landed = b.included.map((g) => ({ ticket: g.ticket, runId: g.runId, sha: g.sha, landedAs: g.landedAs }));
    const conflicts = extra.conflicts || [];
    await lane.recordBatch(me, { landed, conflicts });
    const notices = [];
    for (const g of b.included.filter((x) => !x.holder)) {
      const n = await notify({ to: 'owner', issueId: g.issueId,
        body: `## Deploy lane: your commit landed in a batch by ${me.ticket} as ${g.landedAs}\n\n` +
          `\`${g.sha}\` was pushed to main in one batch with the lane holder's commit (founder ruling TEN-273): landed in a batch by ${me.ticket} as ${g.landedAs}; ` +
          `run your live read-back with \`tools/check-live-build.sh ${g.landedAs}\`.` });
      notices.push({ ticket: g.ticket, issueId: g.issueId, ok: n.ok, id: n.id, error: n.error });
    }
    const h = b.included.find((x) => x.holder);
    return { code: 0, action: 'pushed', mode, base: START, pushed: b.head, holder: { sha, landedAs: h.landedAs },
      included: landed.filter((l) => l.runId !== me.runId), notices,
      stillQueued: lane.peek().queue.map((e) => ({ ticket: e.ticket, runId: e.runId, sha: e.sha, status: e.status || 'queued', conflict: e.conflict })),
      readBack: `tools/check-live-build.sh ${h.landedAs}`, ...extra };
  }

  // One-by-one: the holder's own commit as a normal land.
  async function fallback(why, conflicts = []) {
    const rb = rebaseCheck(sha);
    if (!rb.ok) return { code: 1, action: 'refused', mode: 'fallback', fallbackReason: why, detail: `holder's commit is no longer rebased: ${rb.detail}` };
    const tip = G(['rev-parse', 'origin/main']).stdout;
    const mb = G(['merge-base', sha, tip]).stdout;
    const b = build(tip, [holder]);
    if (!b.ok) return { code: 1, action: 'refused', mode: 'fallback', fallbackReason: why, detail: b.reason };
    if (!b.files.length) return { code: 1, action: 'refused', mode: 'fallback', fallbackReason: why, detail: 'nothing to land' };
    const ck = clobber({ base: mb, files: b.files });
    if (!ck.ok) return { code: 1, action: 'refused', mode: 'fallback', fallbackReason: why, detail: `clobber check failed for the holder's own commit — rebase:\n${ck.output}` };
    const p = await push(b, mb, [holder]);
    if (!p.ok) return { code: 1, action: 'refused', mode: 'fallback', fallbackReason: why, detail: p.reason };
    return finish(why ? 'fallback' : 'holder-only', p.b, { fallbackReason: why || undefined, clobber: ck.output, conflicts, pushAttempts: p.attempts });
  }

  try {
    const b = build(START, [holder, ...entries]);
    if (!b.ok) return { code: 1, action: 'refused', detail: `${b.reason} — rebase onto origin/main` };
    const conflicts = b.skipped.filter((s) => !s.holder).map((s) => ({ ticket: s.ticket, runId: s.runId, sha: s.sha, reason: s.reason }));
    if (b.included.length === 1) return await fallback(null, conflicts);
    if (!b.files.length) return { code: 1, action: 'refused', detail: 'nothing to land' };
    const ck = clobber({ base: START, files: b.files });
    if (!ck.ok) return await fallback(`clobber check failed on the combined tree:\n${ck.output}`, conflicts);
    const su = await suite(b.head);
    if (!su.ok) return await fallback(`suite RED on the combined tree (exit ${su.exit}, log ${su.log})`, conflicts);
    const groups = b.included;
    const p = await push(b, START, groups);
    if (!p.ok && p.fatal) return { code: 1, action: 'refused', detail: p.reason };
    if (!p.ok) return await fallback(p.reason, conflicts);
    return await finish('batch', p.b, { clobber: ck.output, suite: { exit: su.exit, log: su.log }, conflicts, pushAttempts: p.attempts });
  } finally {
    G(['worktree', 'remove', '--force', wt]);
    fs.rmSync(wt, { recursive: true, force: true });
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ticket') o.ticket = argv[++i];
    else if (argv[i] === '--sha') o.sha = argv[++i];
    else { o.bad = argv[i]; break; }
  }
  if (o.bad || !o.ticket || !o.sha || o.ticket.startsWith('--') || o.sha.startsWith('--')) {
    console.error('usage: node tools/deploy-batch.mjs --ticket TEN-123 --sha <your ready commit>');
    process.exit(2);
  }
  const { lane, notify } = realLane();
  let out;
  try {
    out = await runBatch({ lane, me: whoAmI(o.ticket), sha: o.sha, suite: realSuite(), clobber: realClobberCheck(), notify });
  } catch (e) { console.error(`deploy-batch: ${e.message}`); process.exit(6); }
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.code);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
