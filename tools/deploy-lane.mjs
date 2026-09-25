#!/usr/bin/env node
// TEN-261 → TEN-273 — the deploy lane: first come, first served; held only
// while deploying.
//
// FOUNDER, 2026-09-23 (TEN-261): "A lane with no time limit means one stalled
// or crashed run blocks every other agent, silently."
// FOUNDER, 2026-09-25 (TEN-273): claim only when the commit is fully ready
// (suite green, review done, rebased); combine several ready commits into one push.
// FOUNDER, 2026-09-25 00:55Z (TEN-273, SUPERSEDES the 30-min auto-release):
//   "Claimants join a queue with their wait-start time. When the lane frees, the
//   longest-waiting live claimant gets it. No re-claim race. Dead claimants drop
//   out automatically. Log queue position and wait on every claim." — the case:
//   TEN-273 waited from 23:41Z and TEN-270 took the lane at 00:07Z.
//   "A task holds it from rebase/suite/push to 'live SHA confirmed is mine,' then
//   releases. Verifying, watching and reading logs run without the lane."
//   "Renewals can't extend a hold past a maximum total … Report it and wait for
//   Michael's number before wiring it. At the cap: release, re-queue, log and alert."
//
// ── THE RULE (mirrored in .claude/rules/deploy-lane.md) ──────────────────────
//  1. A claim needs a READY commit: `--sha S --reviewed`, a suite receipt for
//     exactly S with exit 0 (written only by tools/ci-suite.sh), and S rebased
//     (every commit in S..origin/main has `[skip ci]` in its SUBJECT). Not
//     ready → exit 7, listing what is missing; the store is not touched.
//  2. First come, first served. A ready `claim` joins the waiter queue with its
//     wait-start time (`since`). A free lane goes ONLY to the head of the queue —
//     the oldest `since` among waiters not dropped — whoever polls first. Every
//     claim returns, and logs, its position and minutes waited.
//  3. Waiters drop out when their run is confirmed ended (liveness, checked under
//     the lock within a time budget), or when they have not called `claim` for
//     WAITER_STALE_MIN and are not confirmed alive (every session waiter). A live
//     Paperclip waiter keeps its place however long it waits.
//  4. A same-ticket NEW run inherits its ticket's wait-start only if the old run
//     is dead AND it claims within WAITER_STALE_MIN of the old run's last claim;
//     otherwise it joins at the back. It never inherits a HOLD: a dead holder is
//     released and the lane goes to the head of the queue.
//  5. A holder whose run is confirmed ended is released on the next claim
//     (`released-dead-owner`, best-effort notice). Liveness `unknown` is not dead.
//  6. The lane covers deploying only: `confirm-live --sha S` runs
//     tools/check-live-build.sh S and releases the lane on exit 0
//     (`released-live-confirmed`); on 1/2 it keeps holding (exit 3).
//  7. Total-hold cap MAX_HOLD_MIN, measured from takenAt; renew and claim never
//     extend it. At the cap: release, the holder re-joins the queue at the BACK
//     with a fresh wait-start, history `cap-released`, best-effort alert. The
//     NUMBER IS PENDING (founder): MAX_HOLD_MIN = null = no cap wired.
//  8. A waiter never waits silently: past WAIT_REPORT_MIN it reports who holds
//     the lane and its position, and again every WAIT_REPORT_MIN.
//  9. `ready` queues a ready commit for the holder's batch (tools/deploy-batch.mjs).
//     A ready entry is NOT a lane waiter unless its run also calls `claim`. It
//     leaves the ready queue when it lands, on `unready` / `release`,
//     READY_TTL_MIN after it was queued, or at batch time when its run has ended.
//
// ── CLI ──────────────────────────────────────────────────────────────────────
//   node tools/deploy-lane.mjs claim        --ticket TEN-123 --sha <commit> --reviewed
//   node tools/deploy-lane.mjs confirm-live --ticket TEN-123 --sha <the sha you pushed>
//   node tools/deploy-lane.mjs ready        --ticket TEN-123 --sha <commit> --reviewed
//   node tools/deploy-lane.mjs renew        --ticket TEN-123   (do I still hold it?)
//   node tools/deploy-lane.mjs release      --ticket TEN-123   (lane, waiter place and ready entry)
//   node tools/deploy-lane.mjs unready      --ticket TEN-123   (withdraw your queued commit)
//   node tools/deploy-lane.mjs status       [--ticket TEN-123]
// Run id / issue id come from PAPERCLIP_RUN_ID / PAPERCLIP_TASK_ID. Without
// them the claimant is a "session" whose liveness cannot be checked.
//
// Exit codes: 0 you hold the lane (ready: queued; confirm-live: released) ·
// 1 refused (not the holder) · 2 usage · 3 wait (not your turn / held; for
// confirm-live: not live yet, still holding) · 6 error (store unreadable, lock
// timeout) — never a hold · 7 not ready. 4 and 5 (TEN-261) are retired.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// TODO(TEN-273): FOUNDER NUMBER PENDING. The total-hold cap is NOT WIRED while
// this is null: "Renewals can't extend a hold past a maximum total … Report it
// and wait for Michael's number before wiring it." Set it to that number (in
// minutes, measured from takenAt) and nothing else; tests inject their own value.
export const MAX_HOLD_MIN = null;
// A waiter that has not called `claim` for this long and is not confirmed alive
// (every session waiter; a Paperclip waiter the board cannot vouch for) leaves
// the waiter queue. A live Paperclip waiter is kept however long it has waited.
export const WAITER_STALE_MIN = 15;
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
const CHECK_LIVE_TIMEOUT_MS = 120000;
const HISTORY_KEEP = 500;
// Waiter and ready-entry liveness is checked UNDER the store lock: an overall
// deadline per pass keeps that well inside LOCK_STALE_MS (plus at most one NET_TIMEOUT_MS call).
export const BATCH_LIVENESS_BUDGET_MS = 60000;

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
// checkLive(sha)        -> {code: 0|1|2, output}   (tools/check-live-build.sh)
// maxHoldMin            -> the total-hold cap in minutes, or null = no cap wired
export function createLane({ file, now = () => Date.now(), liveness, notify, suiteReceipt, rebaseCheck, checkLive,
  maxHoldMin = MAX_HOLD_MIN, livenessBudgetMs = BATCH_LIVENESS_BUDGET_MS }) {
  const log = (s, event) => { s.history.push({ at: iso(now()), ...event }); s.history = s.history.slice(-HISTORY_KEEP); };
  const capMs = maxHoldMin == null ? null : maxHoldMin * MIN;
  const waitedMin = (w, t = now()) => Math.round((t - Date.parse(w.since)) / MIN);

  function newClaim(me, ready) {
    const t = now();
    return { ticket: me.ticket, issueId: me.issueId || null, runId: me.runId, kind: me.kind,
      sha: ready.sha, reviewed: true, suiteFinishedAt: (ready.receipt && ready.receipt.finishedAt) || null,
      takenAt: iso(t), renewedAt: iso(t), expiresAt: capMs == null ? null : iso(t + capMs) };
  }

  function describe(c, live) {
    return `**${c.ticket}** (run \`${c.runId}\`), taken ${c.takenAt}, last checked ${c.renewedAt}, ` +
      `${c.expiresAt ? `hold cap at ${c.expiresAt}` : 'no hold cap wired'}.${live ? ` Owner run: **${live.state}**${live.detail ? ` (${live.detail})` : ''}.` : ''}`;
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

  // ── the waiter queue (first come, first served) ────────────────────────────
  // s.waiters[runId] = {ticket, issueId, kind, since, lastSeen, reportedAt}.
  // Order is by `since` (the wait-start time), oldest first.
  // Ties on `since` (same millisecond) go by `seq`, the order of joining.
  const order = (s) => Object.entries(s.waiters).map(([runId, w]) => ({ ...w, runId }))
    .sort((a, b) => (Date.parse(a.since) - Date.parse(b.since)) || ((a.seq || 0) - (b.seq || 0)));

  function addWaiter(s, who, since, extra = {}) {
    s.seq = (s.seq || 0) + 1;
    s.waiters[who.runId] = { ticket: who.ticket, issueId: who.issueId || null, kind: who.kind, since, lastSeen: iso(now()), reportedAt: null, seq: s.seq, ...extra };
    return s.waiters[who.runId];
  }

  // The caller joins the queue (or is already in it). A NEW run of a ticket
  // that was already waiting inherits that wait-start time only if the old run
  // is dead AND it last polled within WAITER_STALE_MIN: the ticket's work never
  // stopped waiting, it only changed runs. Otherwise the new run joins at the back.
  async function join(s, me) {
    const t = now();
    if (s.waiters[me.runId]) { s.waiters[me.runId].lastSeen = iso(t); return { w: s.waiters[me.runId] }; }
    for (const old of order(s)) {
      if (old.ticket !== me.ticket || old.runId === me.runId) continue;
      if (t - Date.parse(old.lastSeen || old.since) > WAITER_STALE_MIN * MIN) continue;
      const live = await liveness(old);
      if (live.state !== 'dead') continue;
      delete s.waiters[old.runId];
      const w = addWaiter(s, me, old.since, { inheritedFrom: old.runId, reportedAt: old.reportedAt || null });
      log(s, { event: 'waiter-inherited', ticket: me.ticket, runId: me.runId, from: old.runId, since: old.since, evidence: live.detail });
      return { w, inheritedFrom: old.runId };
    }
    const w = addWaiter(s, me, iso(t));
    log(s, { event: 'waiter-joined', ticket: me.ticket, runId: me.runId, since: w.since });
    return { w };
  }

  // Waiters ahead of the caller, after dropping the dead ones (their run ended)
  // and stale ones (no claim for more than WAITER_STALE_MIN and not confirmed
  // alive — a session waiter can never be confirmed alive). A live Paperclip
  // waiter is kept however long it has waited. Liveness is checked under the
  // store lock, so the whole pass has a deadline; a waiter not reached in time
  // counts as still waiting.
  async function ahead(s, me) {
    const t = now();
    const deadline = Date.now() + livenessBudgetMs;
    const out = [];
    for (const w of order(s)) {
      if (w.runId === me.runId) break;
      if (Date.now() >= deadline) { out.push(w); continue; }
      const live = await liveness(w);
      const stale = t - Date.parse(w.lastSeen || w.since) > WAITER_STALE_MIN * MIN;
      if (live.state === 'dead' || (stale && live.state !== 'alive')) {
        delete s.waiters[w.runId];
        log(s, { event: live.state === 'dead' ? 'waiter-dropped-dead' : 'waiter-dropped-stale', ticket: w.ticket, runId: w.runId, since: w.since, evidence: live.detail });
        continue;
      }
      out.push(w);
    }
    return out;
  }

  // The total-hold cap, measured from takenAt; nothing extends it. Not wired
  // while maxHoldMin is null. At the cap: release, the holder goes to the BACK
  // of the waiter queue with a fresh wait-start, history `cap-released`, and a
  // best-effort alert on the holder's ticket (a failed alert never blocks).
  async function capRelease(s) {
    const c = s.claim;
    if (!c || capMs == null || now() < Date.parse(c.takenAt) + capMs) return null;
    const notice = await notify({ to: 'owner', issueId: c.issueId,
      body: `## Deploy lane CAP-RELEASED — ${maxHoldMin}-min total-hold cap reached\n\nClaim: ${describe(c)}\n\n` +
        `The lane was released and your run is back in the queue, at the back. If your push is out, keep polling ` +
        `\`tools/check-live-build.sh ${c.sha || '<your sha>'}\` — it tests containment, so a later push does not invalidate it.` });
    s.claim = null;
    addWaiter(s, c, iso(now()), { requeuedAfterCap: true });
    log(s, { event: 'cap-released', ticket: c.ticket, runId: c.runId, takenAt: c.takenAt, capMin: maxHoldMin, requeued: true, notice: notice.ok ? notice.id : `failed: ${notice.error}` });
    return { claim: c, notice };
  }

  async function waitReport(s, me, w, holder, live, position) {
    const t = now();
    const waited = t - Date.parse(w.since);
    if (!(waited > WAIT_REPORT_MIN * MIN && (!w.reportedAt || t - Date.parse(w.reportedAt) >= WAIT_REPORT_MIN * MIN))) return null;
    const body = `## Deploy lane: ${me.ticket} has waited ${Math.round(waited / MIN)} min (position ${position})\n\n` +
      (holder ? `Lane held by ${describe(holder, live)}` : 'The lane is free; waiters ahead of you go first.') +
      `\n\nWaiting since ${w.since}.`;
    const report = await notify({ to: 'founder', issueId: me.issueId, body });
    if (report.ok) { w.reportedAt = iso(t); log(s, { event: 'wait-reported', ticket: me.ticket, runId: me.runId, holder: holder ? holder.runId : null, position }); }
    return report;
  }

  const batchFor = (s, me) => s.queue.filter((e) => e.runId !== me.runId);

  // Entries older than READY_TTL_MIN leave the ready queue. Called under the lock.
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
      pruneQueue(s);
      // Join BEFORE the cap check, so a holder released at the cap in this same
      // call lands behind this caller.
      const joined = s.claim && s.claim.runId === me.runId ? null : await join(s, me);
      const capped = await capRelease(s);
      let c = s.claim;
      let out;
      if (c && c.runId === me.runId) {
        // Calling claim again never extends the hold. A NEW ready sha (it passed
        // the gate above) replaces the claimed one, so deploy-batch accepts it.
        c.renewedAt = iso(t);
        const from = c.sha;
        if (ready.sha !== from) {
          c.sha = ready.sha; c.suiteFinishedAt = (ready.receipt && ready.receipt.finishedAt) || null;
          log(s, { event: 'claim-sha-updated', ticket: me.ticket, runId: me.runId, from, to: ready.sha });
        }
        save(s);
        return { code: EXIT.HOLD, action: 'already-held', claim: c, position: 0, shaUpdatedFrom: ready.sha !== from ? from : undefined, batch: batchFor(s, me) };
      }
      // A holder whose run has ended is released on the spot. The lane then goes
      // to the longest-waiting live claimant — not necessarily this caller.
      let freed = null;
      let live = null;
      if (c) {
        live = await liveness(c);
        if (live.state === 'dead') {
          const notice = await notify({ to: 'owner', issueId: c.issueId,
            body: `## Deploy lane released — owner run ended\n\nClaim: ${describe(c, live)}\n\n` +
              `The owning run is no longer active, so the claim is released (founder ruling TEN-273). The lane goes to the ` +
              `longest-waiting live claimant. Nothing this ticket left unfinished has been finished or undone.` });
          log(s, { event: 'released-dead-owner', ticket: c.ticket, runId: c.runId, evidence: live.detail, by: me.runId, notice: notice.ok ? notice.id : `failed: ${notice.error}` });
          s.claim = null;
          freed = { claim: c, evidence: live.detail, notice };
          c = null;
        }
      }
      const { w, inheritedFrom } = joined || await join(s, me);
      const before = await ahead(s, me);
      const position = before.length + 1;
      const waited = waitedMin(w, t);
      if (!c && before.length === 0) {
        s.claim = newClaim(me, ready);
        delete s.waiters[me.runId];
        const reclaim = freed && freed.claim.ticket === me.ticket;
        if (reclaim) {
          s.claim.reclaimedFrom = freed.claim.runId;
          await notify({ to: 'owner', issueId: freed.claim.issueId,
            body: `## Deploy lane RE-CLAIMED by a new run of ${me.ticket}\n\nRun \`${me.runId}\` holds the lane now (previous run \`${freed.claim.runId}\` ended). ` +
              `New run id recorded; nothing the old run left unfinished has been finished or undone.` });
        } else if (freed) s.claim.releasedFrom = freed.claim.runId;
        log(s, { event: reclaim ? 're-claimed' : 'claimed', ticket: me.ticket, runId: me.runId, sha: ready.sha, position: 1, waitedMin: waited, inheritedFrom });
        out = { code: EXIT.HOLD, action: reclaim ? 're-claimed' : (freed ? 'released-dead-owner' : 'claimed'), claim: s.claim, position: 1, waitedMin: waited,
          from: freed ? freed.claim : undefined, evidence: freed ? freed.evidence : undefined, notice: freed ? freed.notice : undefined,
          capReleased: capped ? capped.claim : undefined, batch: batchFor(s, me) };
      } else {
        const report = await waitReport(s, me, w, c, live, position);
        log(s, { event: 'waiting', ticket: me.ticket, runId: me.runId, position, waitedMin: waited, holder: c ? c.runId : null, head: before[0] ? before[0].runId : null });
        out = { code: EXIT.WAIT, action: c ? 'wait' : 'wait-turn', claim: c, owner: live || undefined, position, waitedMin: waited, since: w.since,
          ahead: before.map((x) => ({ ticket: x.ticket, runId: x.runId, since: x.since })), inheritedFrom, waitReport: report };
      }
      save(s);
      return out;
    });
  }

  // "Do I still hold it?" — never extends the hold.
  async function renew(me) {
    return withLock(file, async (save) => {
      const s = readState(file);
      const capped = await capRelease(s);
      if (capped) save(s);
      const c = s.claim;
      if (!c || c.runId !== me.runId) return { code: EXIT.REFUSED, action: capped && capped.claim.runId === me.runId ? 'cap-released' : 'not-owner', claim: c };
      c.renewedAt = iso(now());
      save(s);
      return { code: EXIT.HOLD, action: 'held', claim: c,
        minutesLeft: capMs == null ? null : Math.max(0, Math.floor((Date.parse(c.takenAt) + capMs - now()) / MIN)) };
    });
  }

  // Withdraws the caller's ready entry AND its place in the waiter queue whether
  // or not it holds the lane; releases the lane if it does.
  async function release(me) {
    return withLock(file, async (save) => {
      const s = readState(file);
      const capped = await capRelease(s);
      const c = s.claim;
      const queued = s.queue.length;
      s.queue = s.queue.filter((e) => e.runId !== me.runId);
      if (s.queue.length !== queued) log(s, { event: 'unready', ticket: me.ticket, runId: me.runId, by: 'release' });
      if (s.waiters[me.runId]) { delete s.waiters[me.runId]; log(s, { event: 'waiter-left', ticket: me.ticket, runId: me.runId }); }
      if (!c || c.runId !== me.runId) { save(s); return { code: EXIT.REFUSED, action: capped && capped.claim.runId === me.runId ? 'cap-released' : 'not-owner', claim: c }; }
      s.claim = null;
      log(s, { event: 'released', ticket: me.ticket, runId: me.runId });
      save(s);
      return { code: EXIT.HOLD, action: 'released' };
    });
  }

  // The lane covers deploying only: once the live build contains the sha, the
  // lane is released. Verifying and watching happen without it.
  async function confirmLive(me, { sha } = {}) {
    const held = await renew(me);
    if (held.code !== 0) return { code: EXIT.REFUSED, action: held.action, claim: held.claim };
    const r = await checkLive(sha);
    if (r.code !== 0) {
      return { code: EXIT.WAIT, action: 'still-holding', live: r.code,
        detail: r.code === 1 ? `${sha} is not in the live build yet — still holding the lane; poll again` : `live build undetermined (check-live-build exit ${r.code}) — still holding the lane; poll again`,
        output: r.output };
    }
    return withLock(file, async (save) => {
      const s = readState(file);
      const c = s.claim;
      if (!c || c.runId !== me.runId) return { code: EXIT.REFUSED, action: 'not-owner', claim: c };
      s.claim = null;
      delete s.waiters[me.runId];
      log(s, { event: 'released-live-confirmed', ticket: me.ticket, runId: me.runId, sha, heldMin: Math.round((now() - Date.parse(c.takenAt)) / MIN) });
      save(s);
      return { code: EXIT.HOLD, action: 'released-live-confirmed', sha, output: r.output };
    });
  }

  async function status(me) {
    return withLock(file, async (save) => {
      const s = readState(file);
      await capRelease(s);
      pruneQueue(s);
      save(s);
      const c = s.claim;
      const t = now();
      const waitQueue = order(s).map((w, i) => ({ position: i + 1, ticket: w.ticket, runId: w.runId, since: w.since, waitedMin: waitedMin(w, t), lastSeen: w.lastSeen }));
      const mine = me && s.landed[me.runId] ? { landed: s.landed[me.runId] } : {};
      if (!c) return { code: EXIT.HOLD, action: 'free', waitQueue, queue: s.queue, capMin: maxHoldMin, ...mine };
      const live = await liveness(c);
      return { code: EXIT.HOLD, action: 'held', claim: c, owner: live, waitQueue, queue: s.queue, capMin: maxHoldMin, ...mine };
    });
  }

  // Item 3: a ready commit waits in the ready queue for the next holder's
  // batch. Queuing it does NOT make the run a lane waiter; only `claim` does.
  async function ready(me, opts = {}) {
    const r = await readiness(opts);
    if (!r.ok) return { code: EXIT.NOT_READY, action: 'not-ready', missing: r.missing };
    return withLock(file, async (save) => {
      const s = readState(file);
      await capRelease(s);
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
      const unchecked = new Set();
      const deadline = Date.now() + livenessBudgetMs;
      for (const e of s.queue) {
        if (e.runId === me.runId) { keep.push(e); continue; }
        // Out of time: treat as unknown — kept, but not batched this round.
        if (Date.now() >= deadline) { keep.push(e); unchecked.add(e); continue; }
        const live = await liveness(e);
        if (live.state !== 'dead') { keep.push(e); continue; }
        const notice = await notify({ to: 'owner', issueId: e.issueId,
          body: `## Deploy lane: your queued commit was dropped — run ended\n\n\`${e.sha}\` (run \`${e.runId}\`) was queued with \`deploy-lane.mjs ready\`, ` +
            `but that run is no longer active (${live.detail}), so nobody would do its live read-back. It was NOT landed. Re-queue it from a live run.` });
        log(s, { event: 'ready-dropped-dead-owner', ticket: e.ticket, runId: e.runId, sha: e.sha, evidence: live.detail, notice: notice.ok ? notice.id : `failed: ${notice.error}` });
      }
      s.queue = keep;
      save(s);
      return batchFor(s, me).filter((e) => !unchecked.has(e)).sort((a, b) => Date.parse(a.readyAt) - Date.parse(b.readyAt));
    });
  }

  // Used by tools/deploy-batch.mjs to record the outcome of a batch. An entry
  // leaves the queue only if BOTH its run and its sha match what was landed: a
  // run that re-queued a newer commit during the batch keeps that entry.
  async function recordBatch(me, { landed = [], skipped = [], dropped = [] }) {
    return withLock(file, async (save) => {
      const s = readState(file);
      const t = iso(now());
      for (const l of landed) {
        s.landed[l.runId] = { ticket: l.ticket, sha: l.sha, landedAs: l.landedAs, by: me.ticket, at: t };
        s.queue = s.queue.filter((e) => !(e.runId === l.runId && e.sha === l.sha));
      }
      // Already on origin/main (landed some other way): dropped silently, no notice.
      for (const d of dropped) {
        s.queue = s.queue.filter((e) => !(e.runId === d.runId && e.sha === d.sha));
        log(s, { event: 'ready-already-on-main', ticket: d.ticket, runId: d.runId, sha: d.sha });
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

  return { claim, renew, release, confirmLive, status, ready, unready, readiness, batchCandidates, recordBatch, peek, receipt: suiteReceipt };
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

export function checkLiveBuild({ cwd = process.cwd() } = {}) {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-live-build.sh');
  return async (sha) => {
    const r = spawnSync('bash', [script, sha], { cwd, encoding: 'utf8', timeout: CHECK_LIVE_TIMEOUT_MS });
    // Killed by the timeout (it has hung in shallow clones) = undetermined, never a pass.
    const code = r.status === 0 || r.status === 1 ? r.status : 2;
    return { code, output: `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-6).join('\n') };
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
    checkLive: checkLiveBuild({ cwd }),
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
  '       node tools/deploy-lane.mjs confirm-live --ticket TEN-123 --sha <the sha you pushed>\n' +
  '       node tools/deploy-lane.mjs renew|release|unready --ticket TEN-123\n       node tools/deploy-lane.mjs status [--ticket TEN-123]';

async function main() {
  let a;
  try { a = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`${e.message}\n${USAGE}`); process.exit(EXIT.USAGE); }
  const needsSha = a.cmd === 'claim' || a.cmd === 'ready' || a.cmd === 'confirm-live';
  if (!['claim', 'ready', 'unready', 'renew', 'release', 'status', 'confirm-live'].includes(a.cmd) || (a.cmd !== 'status' && !a.ticket) || (needsSha && !a.sha)) {
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
      : a.cmd === 'confirm-live' ? await lane.confirmLive(me, { sha: a.sha })
      : needsSha ? await lane[a.cmd](me, { sha: a.sha, reviewed: a.reviewed })
      : await lane[a.cmd](me);
  } catch (e) { console.error(`deploy-lane: ${e.message}`); process.exit(EXIT.ERROR); }
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.code);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
