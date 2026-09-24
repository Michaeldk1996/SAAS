#!/usr/bin/env node
// TEN-261 → TEN-273 — the deploy lane: held only while deploying.
//
// FOUNDER, 2026-09-23 (TEN-261): "A lane with no time limit means one stalled
// or crashed run blocks every other agent, silently."
// FOUNDER, 2026-09-25 (TEN-273, items 2 + 3, SUPERSEDES the TEN-261 lease):
// hold the lane only while deploying — claim only when the commit is fully
// ready (suite green, review done, rebased); maximum hold 30 minutes, then it
// auto-releases; a claim whose owner run is dead is released immediately. And
// when several agents have a ready commit, combine them into one push.
//
// THE FAILURES IT PREVENTS. 2026-09-23: TEN-253's run 07fff3f5 announced the
// lane in a comment, pushed, and was cancelled mid-poll; nothing expired it and
// TEN-260 queued behind it blind. That gave the 45-min renewable lease. The
// lease then let a live holder keep the lane for its whole suite, review and
// rebase — work that does not need the lane — while everyone else waited.
//
// ── THE RULE (mirrored in .claude/rules/deploy-lane.md) ──────────────────────
//  1. A claim needs a READY commit: `--sha S --reviewed`, a suite receipt for
//     exactly S with exit 0 (written only by tools/ci-suite.sh), and S rebased
//     (every commit in S..origin/main is a `[skip ci]` data-bot commit).
//     Not ready → exit 7, listing what is missing. The store is not touched.
//  2. A claim expires MAX_HOLD_MIN after it is taken, and that NEVER moves.
//     Any claim/status/renew/release at or past expiresAt clears it
//     (`auto-released`, best-effort notice on the owner's ticket).
//  3. A claim held by another run whose owner is confirmed ended on the board
//     is released on the spot (`released-dead-owner`, evidence recorded,
//     best-effort notice) and the caller gets the lane. Liveness `unknown`
//     (board unreachable, session owners) is NOT dead: only the cap frees it.
//  4. Same ticket, new run: no silent inheritance. The old run must be dead;
//     the new run then claims FRESH (its own run id, its own 30 min, notice
//     says RE-CLAIMED). It can never renew or release the old run's claim.
//  5. A waiter never waits silently: past WAIT_REPORT_MIN it reports who holds
//     the lane, since when, and whether that run is alive — and again every
//     WAIT_REPORT_MIN it keeps waiting.
//  6. `ready` queues a ready commit for the next holder to batch
//     (tools/deploy-batch.mjs); `claim` lists the queued entries of other runs.
//     An entry leaves the queue when it lands, when its run calls `unready` or
//     `release`, READY_TTL_MIN after it was queued, or at batch time when its
//     owner run has ended.
//
// ── CLI ──────────────────────────────────────────────────────────────────────
//   node tools/deploy-lane.mjs claim   --ticket TEN-123 --sha <commit> --reviewed
//   node tools/deploy-lane.mjs ready   --ticket TEN-123 --sha <commit> --reviewed
//   node tools/deploy-lane.mjs renew   --ticket TEN-123     (do I still hold it?)
//   node tools/deploy-lane.mjs release --ticket TEN-123     (also withdraws your queue entry)
//   node tools/deploy-lane.mjs unready --ticket TEN-123     (withdraw your queued commit)
//   node tools/deploy-lane.mjs status  [--ticket TEN-123]
// Run id / issue id come from PAPERCLIP_RUN_ID / PAPERCLIP_TASK_ID. Without
// them the owner is a "session" whose liveness cannot be checked, so only the
// 30-min cap ever frees a session claim.
//
// Exit codes: 0 you hold the lane (ready: queued) · 1 refused (not the owner /
// not held any more) · 2 usage · 3 wait (held by a live or unknowable run) ·
// 6 error (store unreadable, lock timeout) — never a hold · 7 not ready.
// 4 and 5 (TEN-261's expired-owner-alive and takeover-refused) are retired.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MAX_HOLD_MIN = 30;
export const WAIT_REPORT_MIN = 30;
// A queued ready commit nobody has batched within this long is dropped: the run that
// queued it has most likely moved on, and nobody would do its live read-back.
export const READY_TTL_MIN = 60;
const MIN = 60 * 1000;

export const EXIT = { HOLD: 0, REFUSED: 1, USAGE: 2, WAIT: 3, ERROR: 6, NOT_READY: 7 };

// Every network call is time-boxed well inside LOCK_STALE_MS, so a lock is only
// ever broken when its holder has died. Git (fetch) runs OUTSIDE the lock.
const NET_TIMEOUT_MS = 10000;
const GIT_TIMEOUT_MS = 120000;
const LOCK_STALE_MS = 180000;

const iso = (ms) => new Date(ms).toISOString();

// ── store: one JSON file, read-modify-write under a mkdir lock ───────────────
function emptyState() { return { version: 2, claim: null, waiters: {}, queue: [], landed: {}, history: [] }; }

function readState(file) {
  let s;
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return emptyState(); throw e; }
  // A v1 (TEN-261) store has no queue/landed; its claim keeps its expiresAt.
  s.waiters = s.waiters || {}; s.queue = s.queue || []; s.landed = s.landed || {}; s.history = s.history || [];
  return s;
}

function writeState(file, state) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// The lock is a directory holding a token, so a holder only ever removes (or
// writes under) its OWN lock — never one another process has since taken.
async function withLock(file, fn) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const token = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + LOCK_STALE_MS + 20000;
  for (;;) {
    try { fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'token'), token); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Older than LOCK_STALE_MS: its holder died, since every step inside is time-boxed.
      try { if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) { fs.rmSync(lock, { recursive: true, force: true }); continue; } } catch {}
      if (Date.now() > deadline) throw new Error(`deploy-lane: store lock ${lock} held too long`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const owns = () => { try { return fs.readFileSync(path.join(lock, 'token'), 'utf8') === token; } catch { return false; } };
  try {
    return await fn((s) => {
      if (!owns()) throw new Error('deploy-lane: lost the store lock; nothing written');
      writeState(file, s);
    });
  } finally { if (owns()) fs.rmSync(lock, { recursive: true, force: true }); }
}

// ── the lane ─────────────────────────────────────────────────────────────────
// liveness(owner)       -> {state: 'alive'|'dead'|'unknown', detail}
// notify({to:'owner'|'founder', issueId, body}) -> {ok, id?, error?}
// suiteReceipt(sha)     -> {sha, tree, exit, startedAt, finishedAt, log} | null
// rebaseCheck(sha)      -> {ok, codeCommits: [{sha, subject}], dataCommits: n, detail}
export function createLane({ file, now = () => Date.now(), liveness, notify, suiteReceipt, rebaseCheck }) {
  const log = (s, event) => { s.history.push({ at: iso(now()), ...event }); s.history = s.history.slice(-100); };

  function newClaim(me, ready) {
    const t = now();
    return { ticket: me.ticket, issueId: me.issueId || null, runId: me.runId, kind: me.kind,
      sha: ready.sha, reviewed: true, suiteFinishedAt: (ready.receipt && ready.receipt.finishedAt) || null,
      takenAt: iso(t), renewedAt: iso(t), expiresAt: iso(t + MAX_HOLD_MIN * MIN) };
  }

  function describe(c, live) {
    return `**${c.ticket}** (run \`${c.runId}\`), taken ${c.takenAt}, last checked ${c.renewedAt}, ` +
      `auto-releases ${c.expiresAt}.${live ? ` Owner run: **${live.state}**${live.detail ? ` (${live.detail})` : ''}.` : ''}`;
  }

  // The readiness gate. Pure reads plus a git fetch: it runs before the store
  // lock is taken and never writes the store.
  async function readiness({ sha, reviewed } = {}) {
    const missing = [];
    if (!sha) return { ok: false, missing: ['sha: pass --sha <the commit you will push>'] };
    const receipt = suiteReceipt(sha);
    if (!receipt) missing.push(`suite: no receipt for ${sha} — run tools/ci-suite.sh ${sha}`);
    if (receipt && (receipt.sha !== sha || receipt.exit !== 0)) missing.push(`suite: the receipt for ${sha} is not green (exit ${receipt.exit}, sha ${receipt.sha})`);
    const rebase = rebaseCheck(sha);
    if (!rebase.ok) missing.push(`rebased: ${rebase.detail}`);
    if (!reviewed) missing.push('review: not attested — pass --reviewed once the review is done');
    return { ok: missing.length === 0, missing, sha, receipt, rebase };
  }

  // Rule 2: the 30-min cap. Called under the lock by every command.
  async function autoRelease(s) {
    const c = s.claim;
    if (!c || now() < Date.parse(c.expiresAt)) return null;
    const notice = await notify({ to: 'owner', issueId: c.issueId,
      body: `## Deploy lane AUTO-RELEASED — ${MAX_HOLD_MIN}-min cap reached\n\nClaim: ${describe(c)}\n\n` +
        `The lane is held at most ${MAX_HOLD_MIN} min (founder ruling TEN-273). Your live read-back is still yours to do: ` +
        `\`tools/check-live-build.sh ${c.sha || '<your sha>'}\` tests containment, so a later push does not invalidate it.` });
    s.claim = null;
    log(s, { event: 'auto-released', ticket: c.ticket, runId: c.runId, expiresAt: c.expiresAt, notice: notice.ok ? notice.id : `failed: ${notice.error}` });
    return { claim: c, notice };
  }

  async function waiting(s, me, c, live, extra) {
    const t = now();
    const w = s.waiters[me.runId] || (s.waiters[me.runId] = { ticket: me.ticket, issueId: me.issueId || null, since: iso(t), reportedAt: null });
    w.lastSeen = iso(t);
    const waited = t - Date.parse(w.since);
    let report = null;
    if (waited > WAIT_REPORT_MIN * MIN && (!w.reportedAt || t - Date.parse(w.reportedAt) >= WAIT_REPORT_MIN * MIN)) {
      const body = `## Deploy lane: ${me.ticket} has waited ${Math.round(waited / MIN)} min\n\n` +
        `Lane held by ${describe(c, live)}\n\nWaiting since ${w.since}. Not taking it: the owner run is not confirmed ended, ` +
        `and the claim has not reached its ${MAX_HOLD_MIN}-min cap.`;
      report = await notify({ to: 'founder', issueId: me.issueId, body });
      if (report.ok) { w.reportedAt = iso(t); log(s, { event: 'wait-reported', ticket: me.ticket, runId: me.runId, holder: c.runId }); }
    }
    return { ...extra, waitedMin: Math.round(waited / MIN), waitReport: report };
  }

  const batchFor = (s, me) => s.queue.filter((e) => e.runId !== me.runId);

  // Entries older than READY_TTL_MIN leave the queue. Called under the lock.
  function pruneQueue(s) {
    const t = now();
    const keep = [];
    for (const e of s.queue) {
      if (t - Date.parse(e.readyAt) >= READY_TTL_MIN * MIN) log(s, { event: 'ready-expired', ticket: e.ticket, runId: e.runId, sha: e.sha, readyAt: e.readyAt });
      else keep.push(e);
    }
    s.queue = keep;
  }

  async function claim(me, opts = {}) {
    const ready = await readiness(opts);
    if (!ready.ok) return { code: EXIT.NOT_READY, action: 'not-ready', missing: ready.missing };
    return withLock(file, async (save) => {
      const s = readState(file);
      const t = now();
      for (const [id, w] of Object.entries(s.waiters)) if (t - Date.parse(w.lastSeen || w.since) > 2 * WAIT_REPORT_MIN * MIN) delete s.waiters[id];
      const auto = await autoRelease(s);
      pruneQueue(s);
      const c = s.claim;
      let out;
      if (!c) {
        s.claim = newClaim(me, ready); delete s.waiters[me.runId];
        log(s, { event: 'claimed', ticket: me.ticket, runId: me.runId, sha: ready.sha });
        out = { code: EXIT.HOLD, action: 'claimed', claim: s.claim, autoReleased: auto ? auto.claim : undefined, batch: batchFor(s, me) };
      } else if (c.runId === me.runId) {
        // Calling claim again never extends the hold.
        c.renewedAt = iso(t);
        out = { code: EXIT.HOLD, action: 'already-held', claim: c, batch: batchFor(s, me) };
      } else {
        const live = await liveness(c);
        if (live.state === 'dead') {
          const sameTicket = c.ticket === me.ticket;
          const notice = await notify({ to: 'owner', issueId: c.issueId,
            body: sameTicket
              ? `## Deploy lane RE-CLAIMED by a new run of ${me.ticket}\n\nPrevious claim: ${describe(c, live)}\n\n` +
                `That run has ended, so its claim is released and run \`${me.runId}\` claims the lane fresh: new run id recorded, ` +
                `a new ${MAX_HOLD_MIN}-min hold. Nothing the old run left unfinished has been finished or undone.`
              : `## Deploy lane released — owner run ended\n\nClaim: ${describe(c, live)}\n\n` +
                `The owning run is no longer active, so the claim is released (founder ruling TEN-273) and ` +
                `${me.ticket} (run \`${me.runId}\`) takes the lane. Nothing this ticket left unfinished has been finished or undone.` });
          s.claim = newClaim(me, ready); delete s.waiters[me.runId];
          if (sameTicket) s.claim.reclaimedFrom = c.runId; else s.claim.releasedFrom = c.runId;
          log(s, { event: 'released-dead-owner', ticket: c.ticket, runId: c.runId, evidence: live.detail, by: me.runId, notice: notice.ok ? notice.id : `failed: ${notice.error}` });
          log(s, { event: sameTicket ? 're-claimed' : 'claimed', ticket: me.ticket, runId: me.runId, sha: ready.sha });
          out = { code: EXIT.HOLD, action: sameTicket ? 're-claimed' : 'released-dead-owner', claim: s.claim, from: c, evidence: live.detail, notice, batch: batchFor(s, me) };
        } else {
          out = await waiting(s, me, c, live, { code: EXIT.WAIT, action: 'wait', claim: c, owner: live });
        }
      }
      save(s);
      return out;
    });
  }

  // "Do I still hold it?" — never extends the hold.
  async function renew(me) {
    return withLock(file, async (save) => {
      const s = readState(file);
      const auto = await autoRelease(s);
      if (auto) save(s);
      const c = s.claim;
      if (!c || c.runId !== me.runId) return { code: EXIT.REFUSED, action: auto && auto.claim.runId === me.runId ? 'auto-released' : 'not-owner', claim: c };
      c.renewedAt = iso(now());
      save(s);
      return { code: EXIT.HOLD, action: 'held', claim: c, minutesLeft: Math.max(0, Math.floor((Date.parse(c.expiresAt) - now()) / MIN)) };
    });
  }

  async function release(me) {
    return withLock(file, async (save) => {
      const s = readState(file);
      const auto = await autoRelease(s);
      if (auto) save(s);
      const c = s.claim;
      if (!c || c.runId !== me.runId) return { code: EXIT.REFUSED, action: auto && auto.claim.runId === me.runId ? 'auto-released' : 'not-owner', claim: c };
      s.claim = null;
      s.queue = s.queue.filter((e) => e.runId !== me.runId);
      log(s, { event: 'released', ticket: me.ticket, runId: me.runId });
      save(s);
      return { code: EXIT.HOLD, action: 'released' };
    });
  }

  async function status(me) {
    return withLock(file, async (save) => {
      const s = readState(file);
      await autoRelease(s);
      pruneQueue(s);
      save(s);
      const c = s.claim;
      const mine = me && s.landed[me.runId] ? { landed: s.landed[me.runId] } : {};
      if (!c) return { code: EXIT.HOLD, action: 'free', waiters: s.waiters, queue: s.queue, ...mine };
      const live = await liveness(c);
      return { code: EXIT.HOLD, action: 'held', claim: c, owner: live, waiters: s.waiters, queue: s.queue, ...mine };
    });
  }

  // Item 3: a ready commit waits in the queue for the next holder's batch.
  async function ready(me, opts = {}) {
    const r = await readiness(opts);
    if (!r.ok) return { code: EXIT.NOT_READY, action: 'not-ready', missing: r.missing };
    return withLock(file, async (save) => {
      const s = readState(file);
      await autoRelease(s);
      pruneQueue(s);
      const entry = { ticket: me.ticket, issueId: me.issueId || null, runId: me.runId, kind: me.kind, sha: r.sha, reviewed: true, readyAt: iso(now()) };
      s.queue = s.queue.filter((e) => e.runId !== me.runId);
      s.queue.push(entry);
      log(s, { event: 'ready', ticket: me.ticket, runId: me.runId, sha: r.sha });
      save(s);
      return { code: EXIT.HOLD, action: 'queued', entry, queue: s.queue, claim: s.claim };
    });
  }

  // Withdraw the caller's queued entry.
  async function unready(me) {
    return withLock(file, async (save) => {
      const s = readState(file);
      const before = s.queue.length;
      s.queue = s.queue.filter((e) => e.runId !== me.runId);
      if (s.queue.length === before) return { code: EXIT.REFUSED, action: 'not-queued' };
      log(s, { event: 'unready', ticket: me.ticket, runId: me.runId });
      save(s);
      return { code: EXIT.HOLD, action: 'withdrawn', queue: s.queue };
    });
  }

  // The holder's batch candidates: other runs' entries, oldest first, after
  // dropping expired entries and entries whose owner run has ended (nobody would
  // do their live read-back). A notice for a dropped entry is best-effort.
  async function batchCandidates(me) {
    return withLock(file, async (save) => {
      const s = readState(file);
      pruneQueue(s);
      const keep = [];
      for (const e of s.queue) {
        if (e.runId === me.runId) { keep.push(e); continue; }
        const live = await liveness(e);
        if (live.state !== 'dead') { keep.push(e); continue; }
        const notice = await notify({ to: 'owner', issueId: e.issueId,
          body: `## Deploy lane: your queued commit was dropped — run ended\n\n\`${e.sha}\` (run \`${e.runId}\`) was queued with \`deploy-lane.mjs ready\`, ` +
            `but that run is no longer active (${live.detail}), so nobody would do its live read-back. It was NOT landed. Re-queue it from a live run.` });
        log(s, { event: 'ready-dropped-dead-owner', ticket: e.ticket, runId: e.runId, sha: e.sha, evidence: live.detail, notice: notice.ok ? notice.id : `failed: ${notice.error}` });
      }
      s.queue = keep;
      save(s);
      return batchFor(s, me).sort((a, b) => Date.parse(a.readyAt) - Date.parse(b.readyAt));
    });
  }

  // Used by tools/deploy-batch.mjs to record the outcome of a batch. An entry
  // leaves the queue only if BOTH its run and its sha match what was landed: a
  // run that re-queued a newer commit during the batch keeps that entry.
  async function recordBatch(me, { landed = [], skipped = [] }) {
    return withLock(file, async (save) => {
      const s = readState(file);
      const t = iso(now());
      for (const l of landed) {
        s.landed[l.runId] = { ticket: l.ticket, sha: l.sha, landedAs: l.landedAs, by: me.ticket, at: t };
        s.queue = s.queue.filter((e) => !(e.runId === l.runId && e.sha === l.sha));
      }
      for (const k of skipped) {
        const e = s.queue.find((x) => x.runId === k.runId && x.sha === k.sha);
        if (e) { e.status = k.status; e.reason = k.reason; e.skippedAt = t; }
      }
      log(s, { event: 'batch', by: me.runId, landed: landed.map((l) => l.runId), skipped: skipped.map((k) => `${k.runId}:${k.status}`) });
      save(s);
      return { queue: s.queue };
    });
  }

  const peek = () => readState(file);

  return { claim, renew, release, status, ready, unready, readiness, batchCandidates, recordBatch, peek, receipt: suiteReceipt };
}

// ── real adapters ────────────────────────────────────────────────────────────
const ACTIVE = new Set(['queued', 'running']);
const ENDED = new Set(['succeeded', 'failed', 'cancelled', 'timed_out', 'error']);

export function paperclipLiveness({ apiBase, apiKey }) {
  return async (owner) => {
    if (owner.kind !== 'paperclip') return { state: 'unknown', detail: 'not a Paperclip run; liveness cannot be checked' };
    if (!apiBase) return { state: 'unknown', detail: 'no PAPERCLIP_API_URL' };
    try {
      const r = await fetch(`${apiBase}/api/heartbeat-runs/${owner.runId}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(NET_TIMEOUT_MS) });
      if (!r.ok) return { state: 'unknown', detail: `heartbeat-runs HTTP ${r.status}` };
      const run = await r.json();
      const detail = `status ${run.status}, last output ${run.lastOutputAt || '—'}, finished ${run.finishedAt || '—'}`;
      if (ACTIVE.has(run.status)) return { state: 'alive', detail };
      if (ENDED.has(run.status)) return { state: 'dead', detail };
      return { state: 'unknown', detail };
    } catch (e) { return { state: 'unknown', detail: `heartbeat-runs unreachable: ${e.message}` }; }
  };
}

export function paperclipNotify({ apiBase, apiKey, agentId, runId }) {
  return async ({ to, issueId, body }) => {
    if (!apiBase || !issueId) {
      process.stderr.write(`\n${body}\n\n`);
      // A session outside Paperclip is read by the founder, so stderr delivers a
      // founder report. An owner notice must reach the owner's ticket.
      if (to === 'founder') return { ok: true, id: 'stderr' };
      return { ok: false, error: !apiBase ? 'no PAPERCLIP_API_URL' : 'no issue id to post on' };
    }
    try {
      const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
      if (agentId) headers['X-Paperclip-Agent-Id'] = agentId;
      if (runId) headers['X-Paperclip-Run-Id'] = runId;
      const payload = agentId ? { body, authorType: 'agent', authorAgentId: agentId } : { body };
      const r = await fetch(`${apiBase}/api/issues/${issueId}/comments`, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(NET_TIMEOUT_MS) });
      if (!r.ok) return { ok: false, error: `comments HTTP ${r.status}` };
      const j = await r.json();
      return { ok: true, id: j.id };
    } catch (e) { return { ok: false, error: e.message }; }
  };
}

export const defaultReceiptsDir = () => process.env.SUITE_RECEIPTS_DIR || path.join(os.homedir(), '.stennisfy', 'suite-receipts');

// Receipts are written only by tools/ci-suite.sh, one file per full sha.
export function fileSuiteReceipts({ dir = defaultReceiptsDir() } = {}) {
  return (sha) => {
    if (!/^[0-9a-f]{40}$/.test(sha || '')) return null;
    try { return JSON.parse(fs.readFileSync(path.join(dir, `${sha}.json`), 'utf8')); } catch { return null; }
  };
}

export function git(args, { cwd = process.cwd(), timeout = GIT_TIMEOUT_MS } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

// Rebased = every commit on origin/main that S lacks is a data-bot `[skip ci]`
// commit. Data bots commit every minute, so "zero commits ahead" would make a
// claim impossible; the clobber check guards the data commits.
export function gitRebaseCheck({ cwd = process.cwd() } = {}) {
  return (sha) => {
    const f = git(['fetch', 'origin', '--quiet'], { cwd });
    if (f.status !== 0) return { ok: false, codeCommits: [], dataCommits: 0, detail: `git fetch origin failed — cannot confirm rebased (${f.stderr.split('\n')[0]})` };
    if (git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], { cwd }).status !== 0) return { ok: false, codeCommits: [], dataCommits: 0, detail: `${sha} is not a commit in this repository` };
    const l = git(['log', '--format=%H%x1f%s%x1f%B%x1e', `${sha}..origin/main`], { cwd });
    if (l.status !== 0) return { ok: false, codeCommits: [], dataCommits: 0, detail: `git log ${sha}..origin/main failed: ${l.stderr}` };
    const commits = l.stdout.split('\x1e').map((x) => x.trim()).filter(Boolean).map((x) => { const [h, subject, body] = x.split('\x1f'); return { sha: h, subject, body }; });
    // The marker must be in the SUBJECT: a code commit that merely mentions
    // "[skip ci]" in its body (this very tool's commit did) is still code.
    const code = commits.filter((c) => !c.subject.includes('[skip ci]'));
    const dataCommits = commits.length - code.length;
    return code.length
      ? { ok: false, codeCommits: code.map(({ sha: h, subject }) => ({ sha: h, subject })), dataCommits,
          detail: `${code.length} code commit(s) on origin/main are missing from ${sha} — rebase: ${code.slice(0, 5).map((c) => `${c.sha.slice(0, 8)} ${c.subject}`).join('; ')}` }
      : { ok: true, codeCommits: [], dataCommits, detail: `rebased (${dataCommits} data-bot commit(s) ahead)` };
  };
}

export function whoAmI(ticket, env = process.env) {
  return env.PAPERCLIP_RUN_ID
    ? { ticket, issueId: env.PAPERCLIP_TASK_ID || null, runId: env.PAPERCLIP_RUN_ID, kind: 'paperclip' }
    // A shell pid changes on every tool call, so a session is identified by its ticket.
    : { ticket, issueId: null, runId: `session:${ticket}`, kind: 'session' };
}

export function realLane({ env = process.env, cwd = process.cwd() } = {}) {
  const apiBase = (env.PAPERCLIP_API_URL || '').replace(/\/$/, '').replace(/\/api$/, '');
  const apiKey = env.PAPERCLIP_API_KEY || '';
  const notify = paperclipNotify({ apiBase, apiKey, agentId: env.PAPERCLIP_AGENT_ID, runId: env.PAPERCLIP_RUN_ID });
  const lane = createLane({
    file: env.DEPLOY_LANE_FILE || path.join(os.homedir(), '.stennisfy', 'deploy-lane.json'),
    liveness: paperclipLiveness({ apiBase, apiKey }),
    notify,
    suiteReceipt: fileSuiteReceipts(),
    rebaseCheck: gitRebaseCheck({ cwd }),
  });
  return { lane, notify };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const o = { cmd, reviewed: false };
  for (let i = 0; i < rest.length; i++) {
    const val = () => { const v = rest[++i]; if (!v || v.startsWith('--')) throw new Error(`${rest[i - 1]} needs a value`); return v; };
    if (rest[i] === '--ticket') o.ticket = val();
    else if (rest[i] === '--sha') o.sha = val();
    else if (rest[i] === '--reviewed') o.reviewed = true;
    else throw new Error(`unknown argument ${rest[i]}`);
  }
  return o;
}

const USAGE = 'usage: node tools/deploy-lane.mjs claim|ready --ticket TEN-123 --sha <commit> --reviewed\n' +
  '       node tools/deploy-lane.mjs renew|release|unready --ticket TEN-123\n       node tools/deploy-lane.mjs status [--ticket TEN-123]';

async function main() {
  let a;
  try { a = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`${e.message}\n${USAGE}`); process.exit(EXIT.USAGE); }
  const needsSha = a.cmd === 'claim' || a.cmd === 'ready';
  if (!['claim', 'ready', 'unready', 'renew', 'release', 'status'].includes(a.cmd) || (a.cmd !== 'status' && !a.ticket) || (needsSha && !a.sha)) {
    console.error(USAGE);
    process.exit(EXIT.USAGE);
  }
  // Receipts are keyed by the full sha; resolve a short one here.
  if (needsSha) { const r = git(['rev-parse', '--verify', '--quiet', `${a.sha}^{commit}`]); if (r.status === 0) a.sha = r.stdout; }
  const { lane } = realLane();
  const me = whoAmI(a.ticket || '');
  let out;
  try {
    out = a.cmd === 'status' ? await lane.status(a.ticket ? me : null)
      : needsSha ? await lane[a.cmd](me, { sha: a.sha, reviewed: a.reviewed })
      : await lane[a.cmd](me);
  } catch (e) { console.error(`deploy-lane: ${e.message}`); process.exit(EXIT.ERROR); }
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.code);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
