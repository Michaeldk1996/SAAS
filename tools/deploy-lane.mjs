#!/usr/bin/env node
// TEN-261 — the deploy lane, with an expiry.
//
// FOUNDER, 2026-09-23: "A lane with no time limit means one stalled or crashed
// run blocks every other agent, silently."
//
// THE FAILURE IT PREVENTS. On 2026-09-23 TEN-253's run 07fff3f5 announced the
// lane in an issue comment at 06:50Z, pushed, and was cancelled at 07:06Z
// mid-poll. The lane was a sentence in a comment: nothing expired it, nothing
// could tell a live holder from a dead one, and TEN-260 queued behind it with
// no way to find out. This file is the lane as a record with a lease.
//
// ── THE RULE (mirrored in .claude/rules/deploy-lane.md) ──────────────────────
//  1. A claim records the owner (ticket + run id), when it was taken, and an
//     expiry LEASE_MIN later.
//  2. The owner renews at least every RENEW_MIN while its run is active. A
//     renewal must come from the owning run and that run must be alive, so a
//     crashed run cannot renew and its claim lapses on its own.
//  3. An expired claim is taken only after (a) the owner's run is confirmed
//     no longer active, (b) a notice with the evidence is posted on the
//     owner's ticket, (c) the clobber check passes against current
//     origin/main. Expired but the owner is alive (or unknowable): NOT taken,
//     reported to the founder.
//  4. A waiter never waits silently: past WAIT_REPORT_MIN it reports who holds
//     the lane, since when, and whether that run is alive — and again every
//     WAIT_REPORT_MIN it keeps waiting.
//  Succession: a NEW run on the SAME ticket inherits an UNEXPIRED claim whose
//  run is dead (a Paperclip session reset is not a new task). Once expired, a
//  same-ticket run takes it like anyone else: notice + clobber check. Same
//  ticket, old run alive: it waits like anyone else.
//
// ── CLI ──────────────────────────────────────────────────────────────────────
//   node tools/deploy-lane.mjs claim   --ticket TEN-123 [--base <sha> --files a b …]
//   node tools/deploy-lane.mjs renew   --ticket TEN-123
//   node tools/deploy-lane.mjs release --ticket TEN-123
//   node tools/deploy-lane.mjs status
// Run id / issue id come from PAPERCLIP_RUN_ID / PAPERCLIP_TASK_ID. Without
// them the owner is a "session" whose liveness cannot be checked, so an
// expired session claim is never taken automatically — it goes to the founder.
//
// Exit codes: 0 you hold the lane · 3 wait (held, unexpired) · 4 expired but
// the owner is alive/unknown — reported, do NOT take · 5 takeover refused
// (clobber check or notice failed) · 1 refused (not the owner) · 2 usage ·
// 6 error (store unreadable, lock timeout) — never a hold.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const LEASE_MIN = 45;
export const RENEW_MIN = 15;
export const WAIT_REPORT_MIN = 30;
const MIN = 60 * 1000;

export const EXIT = { HOLD: 0, REFUSED: 1, USAGE: 2, WAIT: 3, EXPIRED_OWNER_ALIVE: 4, TAKEOVER_REFUSED: 5, ERROR: 6 };

// Every network call and the clobber check is time-boxed well inside
// LOCK_STALE_MS, so a lock is only ever broken when its holder has died.
const NET_TIMEOUT_MS = 10000;
const CLOBBER_TIMEOUT_MS = 60000;
const LOCK_STALE_MS = 180000;

const iso = (ms) => new Date(ms).toISOString();

// ── store: one JSON file, read-modify-write under a mkdir lock ───────────────
function emptyState() { return { version: 1, claim: null, waiters: {}, history: [] }; }

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return emptyState(); throw e; }
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
// liveness(owner)  -> 'alive' | 'dead' | 'unknown'   (evidence in .detail)
// notify({to:'owner'|'founder', issueId, body}) -> {ok, id?, error?}
// clobberCheck({base, files}) -> {ok, output}
export function createLane({ file, now = () => Date.now(), liveness, notify, clobberCheck }) {
  const log = (s, event) => { s.history.push({ at: iso(now()), ...event }); s.history = s.history.slice(-100); };

  function newClaim(me) {
    const t = now();
    return { ticket: me.ticket, issueId: me.issueId || null, runId: me.runId, kind: me.kind,
      takenAt: iso(t), renewedAt: iso(t), expiresAt: iso(t + LEASE_MIN * MIN), expiredReportedAt: null };
  }

  function describe(c, live) {
    return `**${c.ticket}** (run \`${c.runId}\`), taken ${c.takenAt}, last renewed ${c.renewedAt}, ` +
      `expires ${c.expiresAt}. Owner run: **${live.state}**${live.detail ? ` (${live.detail})` : ''}.`;
  }

  async function waiting(s, me, c, extra) {
    const t = now();
    const w = s.waiters[me.runId] || (s.waiters[me.runId] = { ticket: me.ticket, issueId: me.issueId || null, since: iso(t), reportedAt: null });
    w.lastSeen = iso(t);
    const waited = t - Date.parse(w.since);
    let report = null;
    if (waited > WAIT_REPORT_MIN * MIN && (!w.reportedAt || t - Date.parse(w.reportedAt) >= WAIT_REPORT_MIN * MIN)) {
      const live = await liveness(c);
      const body = `## Deploy lane: ${me.ticket} has waited ${Math.round(waited / MIN)} min\n\n` +
        `Lane held by ${describe(c, live)}\n\nWaiting since ${w.since}. Not taking it: ` +
        (Date.parse(c.expiresAt) > t ? 'the claim has not expired.' : 'the claim expired but the owner run is not confirmed dead.');
      report = await notify({ to: 'founder', issueId: me.issueId, body });
      if (report.ok) { w.reportedAt = iso(t); log(s, { event: 'wait-reported', ticket: me.ticket, runId: me.runId, holder: c.runId }); }
    }
    return { ...extra, waitedMin: Math.round(waited / MIN), waitReport: report };
  }

  async function claim(me, { base, files } = {}) {
    return withLock(file, async (save) => {
      const s = readState(file);
      const t = now();
      for (const [id, w] of Object.entries(s.waiters)) if (t - Date.parse(w.lastSeen || w.since) > LEASE_MIN * MIN) delete s.waiters[id];
      const c = s.claim;
      let out;
      if (!c) {
        s.claim = newClaim(me); delete s.waiters[me.runId];
        log(s, { event: 'claimed', ticket: me.ticket, runId: me.runId });
        out = { code: EXIT.HOLD, action: 'claimed', claim: s.claim };
      } else if (c.runId === me.runId) {
        c.renewedAt = iso(t); c.expiresAt = iso(t + LEASE_MIN * MIN); c.expiredReportedAt = null;
        out = { code: EXIT.HOLD, action: 'renewed', claim: c };
      } else {
        const expired = t >= Date.parse(c.expiresAt);
        const sameTicket = c.ticket === me.ticket;
        const live = (expired || sameTicket) ? await liveness(c) : null;
        if (sameTicket && !expired && live.state === 'dead') {
          s.claim = newClaim(me); s.claim.succeededFrom = c.runId; delete s.waiters[me.runId];
          log(s, { event: 'succeeded', ticket: me.ticket, runId: me.runId, from: c.runId, evidence: live.detail });
          out = { code: EXIT.HOLD, action: 'succeeded', claim: s.claim, from: c };
        } else if (!expired) {
          out = await waiting(s, me, c, { code: EXIT.WAIT, action: 'wait', claim: c });
        } else if (live.state !== 'dead') {
          let report = null;
          if (!c.expiredReportedAt) {
            report = await notify({ to: 'founder', issueId: me.issueId,
              body: `## Deploy lane: claim expired, owner still ${live.state} — NOT taking it\n\n` +
                `Lane held by ${describe(c, live)}\n\n${me.ticket} (run \`${me.runId}\`) is waiting. Your call.` });
            if (report.ok) { c.expiredReportedAt = iso(t); log(s, { event: 'expired-owner-alive-reported', holder: c.runId, by: me.runId }); }
          }
          out = await waiting(s, me, c, { code: EXIT.EXPIRED_OWNER_ALIVE, action: 'expired-owner-alive', claim: c, report });
        } else {
          const ck = (base && files && files.length) ? clobberCheck({ base, files })
            : { ok: false, output: 'taking an expired lane needs --base <sha> and --files <every file your commit writes>' };
          if (!ck.ok) {
            out = await waiting(s, me, c, { code: EXIT.TAKEOVER_REFUSED, action: 'clobber-check-failed', claim: c, clobber: ck.output });
          } else {
            const notice = await notify({ to: 'owner', issueId: c.issueId,
              body: `## Deploy lane released as stale — taken by ${me.ticket}\n\n` +
                `Claim: ${describe(c, live)}\n\nThe claim expired and the owning run is no longer active, so ` +
                `${me.ticket} (run \`${me.runId}\`) is taking the lane. Clobber check against current origin/main: clear. ` +
                `Nothing this ticket left unfinished has been finished or undone.` });
            if (!notice.ok) {
              out = await waiting(s, me, c, { code: EXIT.TAKEOVER_REFUSED, action: 'notice-failed', claim: c, error: notice.error });
            } else {
              s.claim = newClaim(me); s.claim.tookOverFrom = c.runId; delete s.waiters[me.runId];
              log(s, { event: 'taken-over', ticket: me.ticket, runId: me.runId, from: c.runId, evidence: live.detail, notice: notice.id });
              out = { code: EXIT.HOLD, action: 'taken-over', claim: s.claim, from: c, notice };
            }
          }
        }
      }
      save(s);
      return out;
    });
  }

  async function renew(me) {
    return withLock(file, async (save) => {
      const s = readState(file);
      const c = s.claim;
      if (!c || c.runId !== me.runId) return { code: EXIT.REFUSED, action: 'not-owner', claim: c };
      const live = await liveness(me);
      if (live.state === 'dead') return { code: EXIT.REFUSED, action: 'run-not-active', claim: c, evidence: live.detail };
      const t = now();
      c.renewedAt = iso(t); c.expiresAt = iso(t + LEASE_MIN * MIN); c.expiredReportedAt = null;
      save(s);
      return { code: EXIT.HOLD, action: 'renewed', claim: c };
    });
  }

  async function release(me) {
    return withLock(file, async (save) => {
      const s = readState(file);
      const c = s.claim;
      if (!c || c.runId !== me.runId) return { code: EXIT.REFUSED, action: 'not-owner', claim: c };
      s.claim = null;
      log(s, { event: 'released', ticket: me.ticket, runId: me.runId });
      save(s);
      return { code: EXIT.HOLD, action: 'released' };
    });
  }

  async function status() {
    const s = readState(file);
    const c = s.claim;
    if (!c) return { code: EXIT.HOLD, action: 'free', waiters: s.waiters };
    const live = await liveness(c);
    return { code: EXIT.HOLD, action: 'held', claim: c, expired: now() >= Date.parse(c.expiresAt), owner: live, waiters: s.waiters };
  }

  return { claim, renew, release, status };
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
      // founder report. An owner notice must reach the owner's ticket: no board, no takeover.
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

export function gitClobberCheck({ cwd = process.cwd() } = {}) {
  return ({ base, files }) => {
    const r = spawnSync('bash', ['tools/clobber-check.sh', base, ...files], { cwd, encoding: 'utf8', timeout: CLOBBER_TIMEOUT_MS });
    return { ok: r.status === 0, output: `${r.stdout || ''}${r.stderr || ''}`.trim() };
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const o = { cmd, files: [] };
  for (let i = 0; i < rest.length; i++) {
    const val = () => { const v = rest[++i]; if (!v || v.startsWith('--')) throw new Error(`${rest[i - 1]} needs a value`); return v; };
    if (rest[i] === '--ticket') o.ticket = val();
    else if (rest[i] === '--base') o.base = val();
    else if (rest[i] === '--files') { while (i + 1 < rest.length && !rest[i + 1].startsWith('--')) o.files.push(rest[++i]); }
    else throw new Error(`unknown argument ${rest[i]}`);
  }
  return o;
}

async function main() {
  let a;
  try { a = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(EXIT.USAGE); }
  if (!['claim', 'renew', 'release', 'status'].includes(a.cmd) || (a.cmd !== 'status' && !a.ticket)) {
    console.error('usage: node tools/deploy-lane.mjs <claim|renew|release|status> --ticket TEN-123 [--base <sha> --files a b …]');
    process.exit(EXIT.USAGE);
  }
  let apiBase = (process.env.PAPERCLIP_API_URL || '').replace(/\/$/, '').replace(/\/api$/, '');
  const apiKey = process.env.PAPERCLIP_API_KEY || '';
  const runId = process.env.PAPERCLIP_RUN_ID;
  const me = runId
    ? { ticket: a.ticket, issueId: process.env.PAPERCLIP_TASK_ID || null, runId, kind: 'paperclip' }
    // A shell pid changes on every tool call, so a session is identified by its ticket.
    : { ticket: a.ticket, issueId: null, runId: `session:${a.ticket}`, kind: 'session' };
  const lane = createLane({
    file: process.env.DEPLOY_LANE_FILE || path.join(os.homedir(), '.stennisfy', 'deploy-lane.json'),
    liveness: paperclipLiveness({ apiBase, apiKey }),
    notify: paperclipNotify({ apiBase, apiKey, agentId: process.env.PAPERCLIP_AGENT_ID, runId }),
    clobberCheck: gitClobberCheck(),
  });
  let out;
  try {
    out = a.cmd === 'status' ? await lane.status()
      : a.cmd === 'claim' ? await lane.claim(me, { base: a.base, files: a.files })
      : await lane[a.cmd](me);
  } catch (e) { console.error(`deploy-lane: ${e.message}`); process.exit(EXIT.ERROR); }
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.code);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
