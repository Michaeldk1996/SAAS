#!/usr/bin/env node
// TEN-273 item 3 — one build for several ready commits.
//
// FOUNDER, 2026-09-25: "When more than one agent has a ready commit, combine
// them into one push and one pipeline run. Run the suite and clobber check on
// the combined tree first. If anything conflicts, fall back to one-by-one."
//
// Run by the LANE HOLDER, after `deploy-lane.mjs claim` gave exit 0:
//
//   node tools/deploy-batch.mjs --ticket TEN-123 --sha <the sha you claimed with>
//
// 1. Refuses (exit 1) unless the caller holds the lane, --sha IS the sha on the
//    claim, and that sha still has a green suite receipt. Refuses a merge commit
//    in merge-base..S ("rebase, don't merge") and a holder commit that fails its
//    own clobber check (against its merge-base, as a solo land).
// 2. Batch candidates = other runs' queued entries, oldest first. Dropped from
//    the queue: expired (READY_TTL_MIN) and dead-owner entries. Skipped but left
//    queued, marked with a status: `merge` (contains a merge commit),
//    `not-rebased`, `clobber` (the entry's own clobber check against ITS
//    merge-base fails), `conflict` (does not cherry-pick onto the batch).
// 3. A temp worktree at origin/main (START). The holder's commit goes first: if
//    S already descends from START it is used AS IS (its sha survives);
//    otherwise its commits are cherry-picked. Then each entry is cherry-picked.
// 4. On the combined tree: tools/clobber-check.sh START <every file written>,
//    then tools/ci-suite.sh <combined head>.
// 5. Both pass → one `git push origin <head>:main`. Rejected because data-bot
//    `[skip ci]` commits landed → replay onto the new origin/main, re-run the
//    clobber check, retry ONCE. A CODE commit landed → fall back. The pushed
//    tree can therefore differ from the suite-tested tree ONLY by `[skip ci]`
//    data-bot commits, with the clobber check re-run against them.
// 6. Success → each included entry gets `landedAs` in the store (removed from
//    the queue only if run AND sha match), and a notice on its issue.
// 7. Anything fails on the combined tree → FALL BACK: land only the holder's
//    own commit as a normal land (fast-forward of S itself when possible),
//    leave the others queued, and say why.
// Always prints the holder's `readBack` sha: the one to give
// tools/check-live-build.sh (it equals --sha whenever S was pushed as is).
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

// Data-bot commits carry the marker in the SUBJECT line; a body mention is not data.
const isData = (subject) => subject.includes('[skip ci]');

export async function runBatch({ lane, me, sha, repo = process.cwd(), git = realGit, suite, clobber, notify, rebaseCheck }) {
  const G = (args, cwd = repo) => git(args, { cwd });
  rebaseCheck = rebaseCheck || gitRebaseCheck({ cwd: repo });
  const refuse = (detail, extra = {}) => ({ code: 1, action: 'refused', detail, ...extra });

  const held = await lane.renew(me);
  if (held.code !== 0) return { code: 1, action: 'not-holder', detail: 'deploy-batch runs only for the lane holder: claim the lane first', claim: held.claim };

  const full = G(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
  if (full.status !== 0) return refuse(`${sha} is not a commit in ${repo}`);
  sha = full.stdout;
  // Only the commit the claim was granted for, and only while it is suite-green.
  if (held.claim.sha !== sha) return refuse(`--sha ${sha} is not the sha you claimed the lane with (${held.claim.sha}). Get the new commit ready (tools/ci-suite.sh) and claim with it.`);
  const rec = lane.receipt(sha);
  if (!rec || rec.sha !== sha || rec.exit !== 0) return refuse(`no green suite receipt for ${sha} — run tools/ci-suite.sh ${sha}`);

  if (G(['fetch', 'origin', '--quiet']).status !== 0) return refuse('git fetch origin failed');
  const START = G(['rev-parse', 'origin/main']).stdout;
  const isAnc = (a, b) => G(['merge-base', '--is-ancestor', a, b]).status === 0;
  const hasMerges = (mb, s) => G(['rev-list', '--merges', `${mb}..${s}`]).stdout.length > 0;
  const filesOf = (mb, s) => G(['diff', '--name-only', mb, s]).stdout.split('\n').filter(Boolean);

  const holderMb = G(['merge-base', sha, START]).stdout;
  if (!holderMb) return refuse(`${sha} has no merge-base with origin/main`);
  if (hasMerges(holderMb, sha)) return refuse(`${holderMb.slice(0, 8)}..${sha.slice(0, 8)} contains a merge commit — rebase, don't merge`);
  const holderFiles = filesOf(holderMb, sha);
  if (!holderFiles.length) return refuse('nothing to land: your commit is already on origin/main');
  const hck = clobber({ base: holderMb, files: holderFiles });
  if (!hck.ok) return refuse(`clobber check failed for your own commit — rebase:\n${hck.output}`);
  const holder = { ticket: me.ticket, issueId: me.issueId, runId: me.runId, sha, holder: true };

  // Candidates: each entry passes the same gates as a solo land, or is skipped.
  const skipped = [];
  const entries = [];
  const onMain = [];
  for (const e of await lane.batchCandidates(me)) {
    const skip = (status, reason) => skipped.push({ ticket: e.ticket, runId: e.runId, sha: e.sha, status, reason });
    if (G(['cat-file', '-e', `${e.sha}^{commit}`]).status !== 0) { skip('missing', `${e.sha} is not in this repository`); continue; }
    const mb = G(['merge-base', e.sha, START]).stdout;
    if (!mb) { skip('missing', 'no merge-base with origin/main'); continue; }
    // Already an ancestor of origin/main: nothing to land, no notice, not a batch member.
    if (mb === e.sha) { onMain.push({ ticket: e.ticket, runId: e.runId, sha: e.sha }); continue; }
    if (hasMerges(mb, e.sha)) { skip('merge', "contains a merge commit — rebase, don't merge"); continue; }
    const rb = rebaseCheck(e.sha);
    if (!rb.ok) { skip('not-rebased', rb.detail); continue; }
    const ck = clobber({ base: mb, files: filesOf(mb, e.sha) });
    if (!ck.ok) { skip('clobber', `its own clobber check failed:\n${ck.output}`); continue; }
    entries.push({ ...e, holder: false });
  }

  if (onMain.length) await lane.recordBatch(me, { dropped: onMain });

  let wt = null;
  const W = (args) => G(args, wt);

  // Replays groups onto `onto`. The holder must apply; an entry that does not is skipped.
  function build(onto, groups) {
    W(['reset', '-q', '--hard', onto]);
    const included = []; const conflicts = [];
    for (const g of groups) {
      if (g.holder && isAnc(onto, g.sha)) {
        // S already descends from origin/main: use it as is, so its sha reaches main.
        W(['reset', '-q', '--hard', g.sha]);
        included.push({ ...g, landedAs: g.sha, asIs: true }); continue;
      }
      const mb = W(['merge-base', g.sha, onto]).stdout;
      const commits = W(['rev-list', '--reverse', `${mb}..${g.sha}`]).stdout.split('\n').filter(Boolean);
      if (!commits.length) { included.push({ ...g, commits, landedAs: g.sha, already: true }); continue; }
      const before = W(['rev-parse', 'HEAD']).stdout;
      const cp = W(['-c', 'core.hooksPath=/dev/null', 'cherry-pick', ...commits]);
      if (cp.status !== 0) {
        W(['cherry-pick', '--abort']);
        W(['reset', '-q', '--hard', before]);
        const reason = `does not apply on top of the batch: ${(cp.stderr || cp.stdout).split('\n').filter((l) => /CONFLICT|error|empty/i.test(l)).slice(0, 3).join(' | ') || 'cherry-pick failed'}`;
        if (g.holder) return { ok: false, reason: `the holder's own commit ${reason}` };
        conflicts.push({ ticket: g.ticket, runId: g.runId, sha: g.sha, status: 'conflict', reason }); continue;
      }
      included.push({ ...g, commits, landedAs: W(['rev-parse', 'HEAD']).stdout });
    }
    const head = W(['rev-parse', 'HEAD']).stdout;
    return { ok: true, head, included, conflicts, files: W(['diff', '--name-only', onto, head]).stdout.split('\n').filter(Boolean) };
  }

  // Push; if rejected because data-bot commits landed, replay and retry once.
  async function push(b, checkBase, groups) {
    for (let attempt = 0; ; attempt++) {
      if ((await lane.renew(me)).code !== 0) return { ok: false, fatal: true, reason: 'you no longer hold the lane (released at the hold cap?) — nothing pushed' };
      const p = W(['push', '-q', 'origin', `${b.head}:refs/heads/main`]);
      if (p.status === 0) return { ok: true, b, attempts: attempt + 1 };
      if (attempt >= 1) return { ok: false, reason: `push rejected twice: ${p.stderr.split('\n')[0]}` };
      if (G(['fetch', 'origin', '--quiet']).status !== 0) return { ok: false, reason: 'git fetch origin failed after a rejected push' };
      const tip = G(['rev-parse', 'origin/main']).stdout;
      const landed = G(['log', '--format=%H%x1f%s%x1e', `${b.head}..${tip}`]).stdout.split('\x1e').map((x) => x.trim()).filter(Boolean)
        .map((x) => { const [h, subject] = x.split('\x1f'); return { sha: h, subject }; });
      const code = landed.filter((c) => !isData(c.subject));
      if (code.length) return { ok: false, reason: `a code commit landed on origin/main during the batch: ${code.map((c) => `${c.sha.slice(0, 8)} ${c.subject}`).join('; ')}` };
      const nb = build(tip, groups);
      if (!nb.ok || nb.conflicts.length) return { ok: false, reason: `replay onto the new origin/main failed: ${nb.reason || nb.conflicts.map((s) => s.reason).join('; ')}` };
      const ck = clobber({ base: checkBase, files: nb.files });
      if (!ck.ok) return { ok: false, reason: `clobber check after the data-bot rebase failed:\n${ck.output}` };
      b = nb;
    }
  }

  async function finish(mode, b, extra) {
    const landed = b.included.map((g) => ({ ticket: g.ticket, runId: g.runId, sha: g.sha, landedAs: g.landedAs }));
    await lane.recordBatch(me, { landed, skipped });
    const notices = [];
    for (const g of b.included.filter((x) => !x.holder)) {
      const n = await notify({ to: 'owner', issueId: g.issueId,
        body: `## Deploy lane: your commit landed in a batch by ${me.ticket} as ${g.landedAs}\n\n` +
          `\`${g.sha}\` was pushed to main in one batch with the lane holder's commit (founder ruling TEN-273): landed in a batch by ${me.ticket} as ${g.landedAs}; ` +
          `run your live read-back with \`tools/check-live-build.sh ${g.landedAs}\`.` });
      notices.push({ ticket: g.ticket, issueId: g.issueId, ok: n.ok, id: n.id, error: n.error });
    }
    const h = b.included.find((x) => x.holder);
    return { code: 0, action: 'pushed', mode, readBack: h.landedAs, readBackCommand: `tools/check-live-build.sh ${h.landedAs}`,
      base: START, pushed: b.head, holder: { sha, landedAs: h.landedAs, pushedAsIs: h.landedAs === sha },
      included: landed.filter((l) => l.runId !== me.runId), notices, skipped,
      stillQueued: lane.peek().queue.map((e) => ({ ticket: e.ticket, runId: e.runId, sha: e.sha, status: e.status || 'queued', reason: e.reason })), ...extra };
  }

  async function refuseAndRecord(detail, extra) {
    await lane.recordBatch(me, { skipped });
    return refuse(detail, { skipped, ...extra });
  }

  // One-by-one: the holder's own commit as a normal land.
  async function fallback(why) {
    const fb = { mode: why ? 'fallback' : 'holder-only', fallbackReason: why || undefined };
    const rb = rebaseCheck(sha);
    if (!rb.ok) return refuseAndRecord(`holder's commit is no longer rebased: ${rb.detail}`, fb);
    const tip = G(['rev-parse', 'origin/main']).stdout;
    const mb = G(['merge-base', sha, tip]).stdout;
    const b = build(tip, [holder]);
    if (!b.ok) return refuseAndRecord(b.reason, fb);
    if (!b.files.length) return refuseAndRecord('nothing to land', fb);
    const ck = clobber({ base: mb, files: b.files });
    if (!ck.ok) return refuseAndRecord(`clobber check failed for the holder's own commit — rebase:\n${ck.output}`, fb);
    const p = await push(b, mb, [holder]);
    if (!p.ok) return refuseAndRecord(p.reason, fb);
    return finish(fb.mode, p.b, { fallbackReason: fb.fallbackReason, clobber: ck.output, pushAttempts: p.attempts });
  }

  try {
    wt = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-batch-'));
    if (G(['worktree', 'add', '-q', '--detach', wt, START]).status !== 0) return { code: 6, action: 'error', detail: 'could not create the batch worktree' };
    const b = build(START, [holder, ...entries]);
    if (!b.ok) return refuseAndRecord(`${b.reason} — rebase onto origin/main`);
    skipped.push(...b.conflicts);
    if (b.included.length === 1) return await fallback(null);
    const ck = clobber({ base: START, files: b.files });
    if (!ck.ok) return await fallback(`clobber check failed on the combined tree:\n${ck.output}`);
    const su = await suite(b.head);
    if (!su.ok) return await fallback(`suite RED on the combined tree (exit ${su.exit}, log ${su.log})`);
    const p = await push(b, START, b.included);
    if (!p.ok && p.fatal) return refuseAndRecord(p.reason);
    if (!p.ok) return await fallback(p.reason);
    return await finish('batch', p.b, { clobber: ck.output, suite: { exit: su.exit, log: su.log }, pushAttempts: p.attempts });
  } finally {
    if (wt) {
      G(['worktree', 'remove', '--force', wt]);
      fs.rmSync(wt, { recursive: true, force: true });
    }
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
  if (out.readBack) process.stderr.write(`\nREAD-BACK: tools/check-live-build.sh ${out.readBack}   <- your live read-back sha${out.holder && !out.holder.pushedAsIs ? ' (NOT your --sha: it was cherry-picked)' : ''}\n`);
  process.exit(out.code);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
