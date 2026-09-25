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
//     ready → exit 7, listing what is missing (a caller already waiting keeps its
//     place and gets its position; a new caller is not recorded).
//  2. First come, first served. A ready `claim` joins the waiter queue with its
//     wait-start time (`since`). A free lane goes ONLY to the head of the queue —
//     the oldest `since` among waiters not dropped — never to whoever polls
//     first. Every claim returns, and logs, its position and minutes waited.
//  3. Waiters drop out when their run is confirmed ended (liveness, checked
//     BEFORE the lock within a shared deadline), or when they have not called `claim` for
//     WAITER_STALE_MIN — alive or not. A not-ready claim (exit 7) still counts as
//     claiming: it refreshes the waiter and reports and logs its position. A run
//     whose commit was batched in leaves the waiter queue.
//  4. A same-ticket NEW run inherits its ticket's wait-start only if the old run
//     is dead AND it claims within WAITER_STALE_MIN of the old run's last claim;
//     otherwise it joins at the back. It never inherits a HOLD: a dead holder is
//     released and the lane goes to the head of the queue.
//  5. Holding (founder, 02:05Z), evaluated on every claim/status/renew/confirm-live:
//     (i) owner run dead → release, `owner-dead`; (ii) the owner's pipeline run
//     in progress → held (a healthy deploy is never cut off), then
//     READBACK_GRACE_MIN (12) after it completes successfully; (iii) the owner's
//     run queued > PIPELINE_QUEUED_MAX_MIN (10) → release,
//     `pipeline-queued-10min`; (iv) MAX_HOLD_MIN (40) since takenAt and none of
//     that → release, `cap-40min-no-run`. The owner's run is the FIRST pipeline
//     run that started at/after pushedAt, recorded once seen; later ticks never
//     extend. HEALTHY_QUEUE_PAUSES_CLOCK (ruled 2026-09-25 03:24Z): pending
//     behind a tick that started before the push counts as moving. GitHub
//     unreachable = unknown: never extends. Renew and claim never extend. A
//     forced release re-queues the holder at the BACK only if it had not pushed
//     (and is alive), logs the reason, posts on its ticket and dispatches the
//     freshness alarm (pipeline-watchdog.yml lane_alert) — both best-effort.
//     A legacy TEN-261 claim at cutover: its lease expiry is honoured once.
//  6. The lane covers deploying only: `confirm-live --sha S` (S = the claimed
//     sha or deploy-batch's recorded read-back sha; any other → exit 1) checks
//     the SITE first (tools/check-live-build.sh S): live → released
//     (`released-live-confirmed`), never a forced release; not live (1/2) → the
//     hold rules run, and if it still holds, exit 3.
//  Data-bot commits: [skip ci] in the subject AND an allowlisted author
//  (DATA_BOT_AUTHORS). Nothing inside the store lock touches the network.
//  7. Every land goes through tools/deploy-batch.mjs, which records readBack and
//     pushedAt on the claim. A raw `git push` is outside the contract (this tool
//     cannot block it).
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
//   node tools/deploy-lane.mjs checkin      --ticket TEN-123   (waiting: keep your place while busy)
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

// FOUNDER, 2026-09-25 02:05Z: "Cap: 40 minutes from claim to live-confirm.
// Auto-extend while the owner's pipeline run is actively running (in progress,
// not queued). A healthy deploy is never cut off. Release immediately if: the
// owner run is dead; its pipeline run has sat queued for more than 10 minutes;
// 40 minutes pass with no run in progress. A forced release posts a message
// naming the reason, in the same channel as the freshness alarm."
export const MAX_HOLD_MIN = 40;
export const PIPELINE_QUEUED_MAX_MIN = 10;
// After the owner's pipeline run completes SUCCESSFULLY the hold stays this long,
// so the live read-back can see it: Pages max-age 600 s + 2 min. (Review of
// c003eb8f: "a healthy deploy is never cut off" must include its CDN lag.)
export const READBACK_GRACE_MIN = 12;
// RULED by the founder 2026-09-25 03:24Z ("proposal"): the pipeline group allows
// one running + one pending run, so the owner's run can sit pending behind a tick
// that started before the push — healthy queueing, not stuck. While true, that
// counts as "the deploy is moving" (no pipeline-queued release, and it counts as
// in progress for the 40-min clause) and the 10-min queued clock only runs while
// nothing is in progress. false = the ruling's literal text.
export const HEALTHY_QUEUE_PAUSES_CLOCK = true; // ruled 2026-09-25 03:24Z; false = the literal 02:05Z text
// A single failed GitHub read must not cut a healthy deploy off: the owner run's
// last KNOWN state is reused if it is at most this old; older → unknown.
export const PIPELINE_STALE_OK_MIN = 5;
// A commit is a DATA-BOT commit only if ALL of:
//  (a) its SUBJECT carries [skip ci];
//  (b) its author email is a data bot — the bot authors of every [skip ci]
//      commit on origin/main in the 30 days to 2026-09-25 (agent and human
//      identities that also used [skip ci] are excluded);
//  (c) it touches at least one file and EVERY file it touches is a path a data
//      bot really `git add`s: DATA_FILES / DATA_DIRS below, derived from the
//      files touched by allowlisted-author [skip ci] commits over the 90 days to
//      2026-09-25 and cross-checked against the `git add` / commit-back lines of
//      the bot workflows and launchd scripts. Hand-curated files the code reads
//      (court-speed-map.json, tournament-surfaces.json, player-atp-aliases.json,
//      any *config* / *schema* / tsconfig / .eslintrc) are NOT data. Code
//      (.js .mjs .cjs .py .sh .yml .yaml .html .css), package*.json, .github/
//      and tools/ never are.
// Agents HAVE committed code as bsp-bot and bot@bspconsult.local with [skip ci]
// in the title (TEN-232, 09-18: kibl_client.py, workflows) — (c) catches that.
export const DATA_BOT_AUTHORS = new Set([
  'bsp-odds-bot@users.noreply.github.com',
  'bsp-admin-log-bot@users.noreply.github.com',
  'bsp-series-outcomes-bot@users.noreply.github.com',
  'bsp-asap-bot@users.noreply.github.com',
  'bsp-bot@users.noreply.github.com',
  'bsp-profile-cache-bot@users.noreply.github.com',
  'bsp-surface-bot@users.noreply.github.com',
  'bsp-wue-bot@users.noreply.github.com',
  'bsp-radar-bot@users.noreply.github.com',
  'bsp-elo-bot@users.noreply.github.com',
  'bsp-clutch-bot@users.noreply.github.com',
  'bsp-archetypes-bot@users.noreply.github.com',
  'bsp-par-bot@users.noreply.github.com',
  'bsp-atp-entry-bot@users.noreply.github.com',   // atp-entry-harvest.yml (scheduled 6x/day; commits only on change)
  'bsp-splits-bot@users.noreply.github.com',      // career-splits.yml (manual dispatch)
  'bot@bspconsult.local', // BSP Entry Lists / Styles / Splits (launchd refresh-*.sh)
]);
// Every file a data bot writes, with its writer.
export const DATA_FILES = new Set([
  'admin-log.json', 'series-outcomes.json',                                      // pipeline.yml commit-backs
  'player-profiles-cache.json.gz', 'player-tournament-history.json.gz', 'historical-match-stats.floor.json',
  'matches.json', 'odds-open-monitor.json', 'odds-quota-history.json', 'alert-state.json',   // odds-now / odds-history / scores
  'odds-fixture-map.json', 'odds-capture-cadence.json', 'odds-now-staleness.json', 'underway-audit.jsonl',
  'odds-card-state.json', 'kibl-entitlement-baseline.json',                       // ten232-kibl-archive.yml
  '.bet365-history-targets.json.gz', '.oddspapi-raw-targets.json.gz',             // bet365-archive / oddspapi-raw-archive
  'asapsports-signal.json', 'archetypes-classified.json', 'clutch-rating.json',   // weekly bots
  'elo-ratings.json', 'elo-history.json', 'points-at-risk.json', 'surface-ratings.json', 'wue-store.json',
  'radar-calibration.json', 'style-radar.json',                                   // style-radar.yml writes both
  'atp-entry-harvest-state.json', 'atp-entry-harvest-queue.json',
  'career-splits.json', 'splits-matches-index.json',                              // refresh-career-splits.sh / career-splits.yml
  'playing-styles.json', 'matchup-matrix.json', 'holdbreak.json', 'situational.json', 'style-meetings-index.json', // refresh-playing-styles.sh
  'entry_lists.json', 'entry_lists_advance.json',                                 // refresh-entry-lists*.sh
]);
export const DATA_DIRS = ['style-meetings/', 'bet365-history/', 'splits-matches/'];
const CODE_FILE = /\.(js|mjs|cjs|py|sh|ya?ml|html|css)$/i;
export function isDataPath(f) {
  const base = f.split('/').pop();
  if (CODE_FILE.test(f) || /^package.*\.json$/i.test(base) || f.startsWith('.github/') || f.startsWith('tools/')) return false;
  if (DATA_FILES.has(f)) return true;
  return DATA_DIRS.some((d) => f.startsWith(d)) && /\.json(\.gz)?$/i.test(f);
}
export const isDataCommit = ({ subject = '', authorEmail = '', files = [] }) =>
  subject.includes('[skip ci]') && DATA_BOT_AUTHORS.has(authorEmail.toLowerCase()) && files.length > 0 && files.every(isDataPath);

// The commits in `range` with subject, author email and every file touched.
export function commitsIn(range, { cwd = process.cwd(), git: g = git } = {}) {
  const l = g(['log', '--format=%x1e%H%x1f%s%x1f%ae', '--name-only', range], { cwd });
  if (l.status !== 0) return { ok: false, error: l.stderr };
  const commits = l.stdout.split('\x1e').map((x) => x.trim()).filter(Boolean).map((x) => {
    const [head, ...files] = x.split('\n');
    const [h, subject, authorEmail] = head.split('\x1f');
    return { sha: h, subject, authorEmail, files: files.map((f) => f.trim()).filter(Boolean) };
  });
  return { ok: true, commits };
}
const QUEUED = new Set(['queued', 'waiting', 'pending', 'requested']);
// A waiter that has not called `claim` (or `checkin`) for this long leaves the
// waiter queue — alive or not. Founder, 2026-09-25 03:24Z: "Accept the 15-min
// rule, on two conditions. A dropped waiter can rejoin at the back of the queue.
// Every drop is logged with the task and time." A not-ready claim and a
// `checkin` (ci-suite.sh runs one every 4 min) both count as checking in.
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
const DEFAULT_REPO = 'Michaeldk1996/SAAS';
// Holder, waiter and ready-entry liveness is checked BEFORE the store lock, under
// one shared deadline per pass (plus at most one NET_TIMEOUT_MS call); nothing
// inside the lock touches the network.
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
// pipelineRuns({since}) -> {ok: true, runs: [{id, status, conclusion, createdAt, startedAt, completedAt, url}]} | {ok: false, detail}
// alert({reason, message}) -> {ok, error?}   (the freshness alarm's channel: pipeline-watchdog.yml)
//
// LOCK DISCIPLINE: nothing inside the store lock touches the network. Liveness,
// pipeline runs (and the keychain token they need) are fetched BEFORE the lock
// against an unlocked snapshot and re-validated cheaply inside it (the claim
// must be the same one); notices and alerts are sent AFTER the lock, and their
// results are appended to the history under a second, short lock.
export function createLane({ file, now = () => Date.now(), liveness, notify, suiteReceipt, rebaseCheck, checkLive,
  pipelineRuns = async () => ({ ok: false, detail: 'no pipeline adapter configured' }),
  alert = async () => ({ ok: false, error: 'no alert adapter configured' }),
  maxHoldMin = MAX_HOLD_MIN, pipelineQueuedMaxMin = PIPELINE_QUEUED_MAX_MIN, readbackGraceMin = READBACK_GRACE_MIN,
  healthyQueue = HEALTHY_QUEUE_PAUSES_CLOCK, pipelineStaleOkMin = PIPELINE_STALE_OK_MIN, livenessBudgetMs = BATCH_LIVENESS_BUDGET_MS }) {
  const log = (s, event) => { s.history.push({ at: iso(now()), ...event }); s.history = s.history.slice(-HISTORY_KEEP); };
  const capMs = maxHoldMin == null ? null : maxHoldMin * MIN;
  const graceMs = readbackGraceMin * MIN;
  const staleOkMs = pipelineStaleOkMin * MIN;
  const waitedMin = (w, t = now()) => Math.round((t - Date.parse(w.since)) / MIN);
  // A claim written by the TEN-261 tool: no version marker, and a lease expiry.
  const isLegacy = (c) => !!c && c.version !== 2 && !!c.expiresAt;
  const claimKey = (c) => (c ? `${c.runId}|${c.takenAt}` : null);

  // Runs fn under the store lock with an effects list; effects (notices,
  // alerts) run after the lock is released, and may return a patch applied
  // to the store under a second, short lock.
  async function locked(fn) {
    const fx = [];
    const out = await withLock(file, (save) => fn(save, fx));
    if (fx.length) {
      const patches = [];
      for (const f of fx) { try { const p = await f(); if (p) patches.push(p); } catch { /* best-effort */ } }
      if (patches.length) await withLock(file, async (save) => { const s = readState(file); for (const p of patches) p(s); save(s); });
    }
    return out;
  }

  function newClaim(me, ready) {
    const t = now();
    return { version: 2, ticket: me.ticket, issueId: me.issueId || null, runId: me.runId, kind: me.kind,
      sha: ready.sha, reviewed: true, suiteFinishedAt: (ready.receipt && ready.receipt.finishedAt) || null,
      takenAt: iso(t), renewedAt: iso(t), expiresAt: capMs == null ? null : iso(t + capMs), pushedAt: null, readBack: null, ownerRun: null };
  }

  function describe(c, live) {
    const hold = isLegacy(c) ? `a legacy TEN-261 lease claim, honoured once until ${c.legacyExpiresAt || c.expiresAt}, then freed`
      : c.expiresAt ? `plain cap at ${c.expiresAt} (extended while its own pipeline run is in progress, then ${readbackGraceMin} min of read-back grace)` : 'no hold cap wired';
    return `**${c.ticket}** (run \`${c.runId}\`), taken ${c.takenAt}, last checked ${c.renewedAt}, ${hold}.` +
      `${live ? ` Owner run: **${live.state}**${live.detail ? ` (${live.detail})` : ''}.` : ''}`;
  }

  // The readiness gate: pure reads plus a git fetch, before any lock.
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
  const order = (s) => Object.entries(s.waiters).map(([runId, w]) => ({ ...w, runId }))
    .sort((a, b) => (Date.parse(a.since) - Date.parse(b.since)) || ((a.seq || 0) - (b.seq || 0)));

  function addWaiter(s, who, since, extra = {}) {
    s.seq = (s.seq || 0) + 1;
    s.waiters[who.runId] = { ticket: who.ticket, issueId: who.issueId || null, kind: who.kind, since, lastSeen: iso(now()), reportedAt: null, seq: s.seq, ...extra };
    return s.waiters[who.runId];
  }

  // Pre-lock checks against an unlocked snapshot, under ONE shared deadline for
  // every liveness call (holder, then the waiters ahead of the caller — which
  // also covers the same-ticket waiter a new run might inherit from). Pipeline
  // runs (and the token they need) are fetched here too, only when the hold
  // rules need them.
  async function prefetch(me, { waiters = false } = {}) {
    const snap = readState(file);
    const deadline = Date.now() + livenessBudgetMs;
    const pre = { claimKey: claimKey(snap.claim), live: null, pr: null, waiterLive: new Map() };
    const c = snap.claim;
    if (c) {
      pre.live = await liveness(c);
      if (capMs != null && !isLegacy(c) && (c.pushedAt || now() - Date.parse(c.takenAt) >= capMs)) {
        pre.pr = await pipelineRuns({ since: c.pushedAt, ownerRunId: c.ownerRun ? c.ownerRun.id : undefined });
      }
    }
    if (waiters) {
      for (const w of order(snap)) {
        if (me && w.runId === me.runId) break;
        if (Date.now() >= deadline) break;          // not reached: counts as still waiting
        pre.waiterLive.set(w.runId, await liveness(w));
      }
    }
    return pre;
  }

  const isStale = (w, t = now()) => t - Date.parse(w.lastSeen || w.since) > WAITER_STALE_MIN * MIN;

  // Every drop from the waiter queue (founder, 2026-09-25 03:24Z: "Every drop is
  // logged with the task and time"): a history event with the ticket, run id,
  // time and reason, and — after the lock, best-effort — a notice on the dropped
  // waiter's ticket saying it can rejoin (at the back, with a fresh wait-start).
  function dropWaiter(s, w, reason, detail, fx) {
    delete s.waiters[w.runId];
    log(s, { event: `waiter-dropped-${reason}`, reason, ticket: w.ticket, runId: w.runId, since: w.since, lastSeen: w.lastSeen || null, evidence: detail });
    if (fx && reason !== 'batched-in') {
      fx.push(async () => {
        await notify({ to: 'owner', issueId: w.issueId,
          body: `## Deploy lane: ${w.ticket} was dropped from the waiter queue (${reason})\n\n` +
            `Run \`${w.runId}\`, waiting since ${w.since}: ${detail}. It can rejoin at any time — ` +
            `\`node tools/deploy-lane.mjs claim --ticket ${w.ticket} --sha <sha> --reviewed\` — at the back of the queue, with a fresh wait-start. ` +
            `While your suite runs, run tools/ci-suite.sh with DEPLOY_LANE_TICKET=${w.ticket} set so it keeps checking in.` });
        return null;
      });
    }
  }
  const staleDetail = (w) => `no claim or check-in for more than ${WAITER_STALE_MIN} min (last ${w.lastSeen || w.since})`;

  // The caller joins the queue (or is already in it). A NEW run of a ticket
  // that was already waiting inherits that wait-start time only if the old run
  // is (pre-lock checked) dead AND it last polled within WAITER_STALE_MIN. A
  // caller whose own entry has gone silent is dropped (logged) and rejoins at
  // the BACK with a fresh wait-start — even if nobody had pruned it yet.
  function join(s, me, pre, fx) {
    const t = now();
    if (s.waiters[me.runId] && isStale(s.waiters[me.runId], t)) dropWaiter(s, { ...s.waiters[me.runId], runId: me.runId }, 'stale', staleDetail(s.waiters[me.runId]), fx);
    if (s.waiters[me.runId]) { s.waiters[me.runId].lastSeen = iso(t); return { w: s.waiters[me.runId] }; }
    for (const old of order(s)) {
      if (old.ticket !== me.ticket || old.runId === me.runId) continue;
      if (t - Date.parse(old.lastSeen || old.since) > WAITER_STALE_MIN * MIN) continue;
      const live = pre.waiterLive.get(old.runId);
      if (!live || live.state !== 'dead') continue;
      delete s.waiters[old.runId];
      const w = addWaiter(s, me, old.since, { inheritedFrom: old.runId, reportedAt: old.reportedAt || null });
      log(s, { event: 'waiter-inherited', ticket: me.ticket, runId: me.runId, from: old.runId, since: old.since, evidence: live.detail });
      return { w, inheritedFrom: old.runId };
    }
    const w = addWaiter(s, me, iso(t));
    log(s, { event: 'waiter-joined', ticket: me.ticket, runId: me.runId, since: w.since });
    return { w };
  }

  // Waiters ahead of the caller, after dropping the silent ones (no `claim` for
  // WAITER_STALE_MIN, alive or not) and the dead ones (pre-lock liveness). A
  // waiter the pre-lock pass did not reach counts as still waiting.
  function ahead(s, me, pre, fx) {
    const t = now();
    const out = [];
    for (const w of order(s)) {
      if (w.runId === me.runId) break;
      const stale = isStale(w, t);
      if (stale) {
        dropWaiter(s, w, 'stale', staleDetail(w), fx);
        continue;
      }
      const live = pre.waiterLive.get(w.runId);
      if (live && live.state === 'dead') {
        dropWaiter(s, w, 'dead', `its run has ended (${live.detail})`, fx);
        continue;
      }
      out.push(w);
    }
    return out;
  }

  // ── holding the lane: the founder's cap ruling (2026-09-25 02:05Z) ─────────
  //  (i)   owner run dead                                  → release: owner-dead
  //  (ii)  the owner's pipeline run is in_progress          → hold (never cut off)
  //        …then READBACK_GRACE_MIN after it completes SUCCESSFULLY (the CDN's
  //        max-age + 2 min, so the live read-back can see it); no grace after a
  //        failed or cancelled run
  //  (iii) the owner's run queued > PIPELINE_QUEUED_MAX_MIN   → release: pipeline-queued-10min
  //  (iv)  MAX_HOLD_MIN since takenAt, none of the above      → release: cap-40min-no-run
  // "The owner's pipeline run" is the FIRST pipeline.yml run that started at or
  // after the claim's pushedAt; it is recorded on the claim once seen, and only
  // it extends — later ticks never do. Queued = created at/after pushedAt and not
  // yet started. HEALTHY_QUEUE_PAUSES_CLOCK (ruled 2026-09-25 03:24Z):
  // while another pipeline run is in progress ahead of it, the owner's queued
  // run is "moving" — no (iii), and it counts as in progress for (iv); its
  // queued clock only runs while nothing is in progress.
  // GitHub unreachable = unknown: NEVER extends (a grace already earned from a
  // recorded successful completion still applies).
  function enforce(s, pre, fx) {
    const c = s.claim;
    if (!c) return { forced: null, live: null };
    if (!pre || pre.claimKey !== claimKey(c)) return { forced: null, live: null, skipped: 'the claim changed since the pre-lock checks' };
    const t = now();
    const live = pre.live;
    if (live && live.state === 'dead') return { forced: forced(s, c, 'owner-dead', live.detail, fx), live };
    if (isLegacy(c)) {
      if (!c.legacyExpiresAt) c.legacyExpiresAt = c.expiresAt; // honoured ONCE: later renewals by an old tool do not move it
      if (t >= Date.parse(c.legacyExpiresAt)) return { forced: forced(s, c, 'legacy-lease-expired', `TEN-261 lease claim honoured once, until ${c.legacyExpiresAt}`, fx), live };
      return { forced: null, live };
    }
    if (capMs == null) return { forced: null, live };
    const elapsed = t - Date.parse(c.takenAt);
    const pushedAt = c.pushedAt ? Date.parse(c.pushedAt) : null;
    let pr = pre.pr;
    let lastKnown = false;
    if (pr && pr.ok) c.lastKnownPipeline = { at: iso(t), runs: pr.runs };
    else if (pr && c.lastKnownPipeline && t - Date.parse(c.lastKnownPipeline.at) <= staleOkMs) {
      // One failed GitHub read: reuse the last known state (≤ PIPELINE_STALE_OK_MIN old)
      // — but ONLY to keep the lane (owner run in progress / read-back grace). Saved
      // state never causes a release: the queued rule is skipped on it, leaving
      // just the plain 40-min cap, exactly as when GitHub is unknown.
      pr = { ok: true, runs: c.lastKnownPipeline.runs, detail: pr.detail };
      lastKnown = true;
    }
    const known = !!(pr && pr.ok);
    const runs = known && pushedAt != null ? pr.runs : [];
    let owner = null;
    if (c.ownerRun) owner = runs.find((r) => r.id === c.ownerRun.id) || null;
    else owner = runs.filter((r) => r.startedAt && Date.parse(r.startedAt) >= pushedAt)
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))[0] || null;
    if (owner) c.ownerRun = { id: owner.id, startedAt: owner.startedAt, status: owner.status, conclusion: owner.conclusion || null, completedAt: owner.completedAt || null, url: owner.url || null };
    const or = c.ownerRun;
    const held = (state, extra = {}) => { c.pipeline = { checkedAt: iso(t), state, ...(lastKnown ? { lastKnownAt: c.lastKnownPipeline.at } : {}), ...extra }; return { forced: null, live }; };
    if (owner && owner.status === 'in_progress') return held('owner-run-in-progress', { run: owner.url || owner.id });
    if (or && or.status === 'completed' && or.conclusion === 'success' && or.completedAt && t < Date.parse(or.completedAt) + graceMs) {
      return held('read-back-grace', { until: iso(Date.parse(or.completedAt) + graceMs) });
    }
    if (!or && known && !lastKnown && pushedAt != null) {
      const queued = runs.filter((r) => QUEUED.has(r.status) && Date.parse(r.createdAt) >= pushedAt)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
      if (queued) {
        const moving = runs.some((r) => r.status === 'in_progress');
        if (healthyQueue && moving) return held('queued-behind-a-running-tick', { run: queued.url || queued.id });
        let clockStart = Date.parse(queued.createdAt);
        if (healthyQueue) {
          for (const r of runs) {
            const done = r.completedAt ? Date.parse(r.completedAt) : NaN;
            if (r.status === 'completed' && done > clockStart && done <= t) clockStart = done;
          }
        }
        const min = (t - clockStart) / MIN;
        if (min > pipelineQueuedMaxMin) {
          return { forced: forced(s, c, 'pipeline-queued-10min', `pipeline run ${queued.id} has sat queued ${min.toFixed(1)} min${healthyQueue ? ' with nothing in progress ahead of it' : ''} (limit ${pipelineQueuedMaxMin})`, fx), live };
        }
      }
    }
    if (elapsed >= capMs) {
      const why = !known && pushedAt != null
        ? `${maxHoldMin} min since the claim; GitHub unreachable (${pr ? pr.detail : 'not checked'}) — unknown never extends a hold`
        : or && or.status === 'completed' ? `${maxHoldMin} min since the claim; the owner's pipeline run ${or.id} ended (${or.conclusion || 'no conclusion'})${or.conclusion === 'success' ? ` and its ${readbackGraceMin}-min read-back grace is over` : ', no grace'}`
          : `${maxHoldMin} min since the claim and no owner pipeline run in progress`;
      return { forced: forced(s, c, 'cap-40min-no-run', why, fx), live };
    }
    return held(known ? 'none-in-progress' : pushedAt != null ? 'unknown' : 'not-pushed', known ? {} : { detail: pr ? pr.detail : undefined });
  }

  // A forced release: the lane is freed; the holder re-joins the queue at the
  // BACK only if it has NOT pushed (a pushed holder has nothing to wait for) and
  // its run is alive. The reason is logged now; the ticket notice and the alarm
  // go out AFTER the lock (best-effort: a failure is logged, never keeps the
  // lane held).
  function forced(s, c, reason, detail, fx) {
    const dead = reason === 'owner-dead';
    const pushed = !!c.pushedAt;
    const requeue = !dead && !pushed;
    const message = `deploy lane forced release (${reason}): ${c.ticket} run ${c.runId} — ${detail}. ` +
      `Claim taken ${c.takenAt}${pushed ? `, pushed ${c.pushedAt}` : ', nothing pushed'}.`;
    s.claim = null;
    if (requeue) addWaiter(s, c, iso(now()), { requeuedAfterCap: true, requeueReason: reason });
    log(s, { event: dead ? 'released-dead-owner' : 'cap-released', reason, ticket: c.ticket, runId: c.runId, evidence: detail,
      takenAt: c.takenAt, pushedAt: c.pushedAt || null, requeued: requeue });
    const result = { claim: c, reason, detail, requeued: requeue, notice: null, alert: null };
    fx.push(async () => {
      const body = dead
        ? `## Deploy lane released — owner run ended\n\nClaim: ${describe(c, { state: 'dead', detail })}\n\n` +
          `The owning run is no longer active, so the claim is released (founder ruling TEN-273). The lane goes to the ` +
          `longest-waiting live claimant. Nothing this ticket left unfinished has been finished or undone.`
        : `## Deploy lane CAP-RELEASED — ${reason}\n\n${detail}.\n\nClaim: ${describe(c)}\n\n` +
          (pushed
            ? `Your push is out, so you are NOT re-queued: do your live read-back without the lane with ` +
              `\`tools/check-live-build.sh ${c.readBack || c.sha}\` (it tests containment, so a later push does not invalidate it).`
            : `You had not pushed, so you are back in the queue, at the back. If you have nothing more to push, run ` +
              `\`node tools/deploy-lane.mjs release --ticket ${c.ticket}\` to leave the queue.`);
      const notice = await notify({ to: 'owner', issueId: c.issueId, body });
      let al;
      try { al = await alert({ reason, message }); } catch (e) { al = { ok: false, error: e.message }; }
      result.notice = notice; result.alert = al;
      return (st) => log(st, { event: 'forced-release-delivery', reason, ticket: c.ticket, runId: c.runId,
        notice: notice.ok ? notice.id : `failed: ${notice.error}`, alert: al.ok ? 'dispatched' : `failed: ${al.error}` });
    });
    return result;
  }

  function queueWaitReport(s, me, w, holder, live, position, fx, out) {
    const t = now();
    const waited = t - Date.parse(w.since);
    if (!(waited > WAIT_REPORT_MIN * MIN && (!w.reportedAt || t - Date.parse(w.reportedAt) >= WAIT_REPORT_MIN * MIN))) return;
    const body = `## Deploy lane: ${me.ticket} has waited ${Math.round(waited / MIN)} min (position ${position})\n\n` +
      (holder ? `Lane held by ${describe(holder, live)}` : 'The lane is free; waiters ahead of you go first.') +
      `\n\nWaiting since ${w.since}.`;
    fx.push(async () => {
      const report = await notify({ to: 'founder', issueId: me.issueId, body });
      out.waitReport = report;
      if (!report.ok) return null;
      return (st) => { const ww = st.waiters[me.runId]; if (ww) ww.reportedAt = iso(t); log(st, { event: 'wait-reported', ticket: me.ticket, runId: me.runId, holder: holder ? holder.runId : null, position }); };
    });
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
    const pre = await prefetch(me, { waiters: true });
    if (!ready.ok) {
      // A waiter that is re-preparing is still claiming: it keeps its place
      // while it keeps calling, and it is told (and the log records) where it stands.
      return locked(async (save, fx) => {
        const s = readState(file);
        const w = s.waiters[me.runId];
        if (!w) return { code: EXIT.NOT_READY, action: 'not-ready', missing: ready.missing };
        if (isStale(w)) {
          // Gone silent: dropped (it rejoins at the back once it is ready again).
          dropWaiter(s, { ...w, runId: me.runId }, 'stale', staleDetail(w), fx);
          save(s);
          return { code: EXIT.NOT_READY, action: 'not-ready', missing: ready.missing, dropped: 'stale' };
        }
        w.lastSeen = iso(now());
        const before = ahead(s, me, pre, fx);
        const position = before.length + 1;
        const waited = waitedMin(w);
        log(s, { event: 'waiting-not-ready', ticket: me.ticket, runId: me.runId, position, waitedMin: waited, missing: ready.missing.map((m) => m.split(':')[0]) });
        save(s);
        return { code: EXIT.NOT_READY, action: 'not-ready', missing: ready.missing, position, waitedMin: waited, since: w.since };
      });
    }
    return locked(async (save, fx) => {
      const s = readState(file);
      const t = now();
      pruneQueue(s);
      // Join BEFORE enforcing, so a holder re-queued in this same call lands
      // behind this caller.
      const joined = s.claim && s.claim.runId === me.runId ? null : join(s, me, pre, fx);
      const { forced: freed, live } = enforce(s, pre, fx);
      const c = s.claim;
      if (c && c.runId === me.runId) {
        // Calling claim again never extends the hold. A NEW ready sha (it passed
        // the gate above) replaces the claimed one, so deploy-batch accepts it.
        c.renewedAt = iso(t);
        const from = c.sha;
        if (ready.sha !== from && c.pushedAt) {
          // Your push is out: a new commit is a new deploy. Confirm the pushed one
          // (confirm-live releases the lane), then claim the new sha — at the back
          // of the queue, like anyone else (founder: "a fix found during
          // verification re-queues like anyone else").
          save(s);
          return { code: EXIT.REFUSED, action: 'pushed-confirm-first', claim: c,
            detail: `you pushed ${c.readBack || from} at ${c.pushedAt}; run confirm-live on it first, then claim ${ready.sha} again (you will join the back of the queue)` };
        }
        if (ready.sha !== from) {
          c.sha = ready.sha; c.suiteFinishedAt = (ready.receipt && ready.receipt.finishedAt) || null;
          log(s, { event: 'claim-sha-updated', ticket: me.ticket, runId: me.runId, from, to: ready.sha });
        }
        save(s);
        return { code: EXIT.HOLD, action: 'already-held', claim: c, position: 0, shaUpdatedFrom: ready.sha !== from ? from : undefined, batch: batchFor(s, me) };
      }
      const { w, inheritedFrom } = joined || join(s, me, pre, fx);
      const before = ahead(s, me, pre, fx);
      const position = before.length + 1;
      const waited = waitedMin(w, t);
      let out;
      if (!c && before.length === 0) {
        s.claim = newClaim(me, ready);
        delete s.waiters[me.runId];
        const reclaim = !!freed && freed.reason === 'owner-dead' && freed.claim.ticket === me.ticket;
        if (reclaim) {
          s.claim.reclaimedFrom = freed.claim.runId;
          fx.push(async () => { await notify({ to: 'owner', issueId: freed.claim.issueId,
            body: `## Deploy lane RE-CLAIMED by a new run of ${me.ticket}\n\nRun \`${me.runId}\` holds the lane now (previous run \`${freed.claim.runId}\` ended). ` +
              `New run id recorded; nothing the old run left unfinished has been finished or undone.` }); return null; });
        } else if (freed) s.claim.releasedFrom = freed.claim.runId;
        log(s, { event: reclaim ? 're-claimed' : 'claimed', ticket: me.ticket, runId: me.runId, sha: ready.sha, position: 1, waitedMin: waited, inheritedFrom });
        out = { code: EXIT.HOLD, action: reclaim ? 're-claimed' : (freed && freed.reason === 'owner-dead' ? 'released-dead-owner' : 'claimed'), claim: s.claim, position: 1, waitedMin: waited,
          from: freed ? freed.claim : undefined, forcedRelease: freed ? { reason: freed.reason, detail: freed.detail } : undefined,
          evidence: freed ? freed.detail : undefined,
          capReleased: freed && freed.reason !== 'owner-dead' ? freed.claim : undefined, batch: batchFor(s, me) };
        if (freed) fx.push(async () => { out.notice = freed.notice; return null; });
      } else {
        log(s, { event: 'waiting', ticket: me.ticket, runId: me.runId, position, waitedMin: waited, holder: c ? c.runId : null, head: before[0] ? before[0].runId : null });
        out = { code: EXIT.WAIT, action: c ? 'wait' : 'wait-turn', claim: c, holder: c ? describe(c, live) : undefined, owner: live || undefined, position, waitedMin: waited, since: w.since,
          ahead: before.map((x) => ({ ticket: x.ticket, runId: x.runId, since: x.since })), inheritedFrom, waitReport: null };
        queueWaitReport(s, me, w, c, live, position, fx, out);
      }
      save(s);
      return out;
    });
  }

  // "Do I still hold it?" — never extends the hold.
  async function renew(me) {
    const pre = await prefetch(me);
    return locked(async (save, fx) => {
      const s = readState(file);
      const { forced: freed } = enforce(s, pre, fx);
      const c = s.claim;
      if (!c || c.runId !== me.runId) {
        save(s);
        const mine = freed && freed.claim.runId === me.runId;
        return { code: EXIT.REFUSED, action: mine ? 'cap-released' : 'not-owner', reason: mine ? freed.reason : undefined, claim: c };
      }
      c.renewedAt = iso(now());
      save(s);
      return { code: EXIT.HOLD, action: 'held', claim: c, pipeline: c.pipeline,
        minutesLeft: capMs == null || isLegacy(c) ? null : Math.max(0, Math.floor((Date.parse(c.takenAt) + capMs - now()) / MIN)) };
    });
  }

  // Withdraws the caller's ready entry AND its place in the waiter queue whether
  // or not it holds the lane; releases the lane if it does.
  async function release(me) {
    return locked(async (save) => {
      const s = readState(file);
      const c = s.claim;
      const queued = s.queue.length;
      s.queue = s.queue.filter((e) => e.runId !== me.runId);
      if (s.queue.length !== queued) log(s, { event: 'unready', ticket: me.ticket, runId: me.runId, by: 'release' });
      if (s.waiters[me.runId]) { delete s.waiters[me.runId]; log(s, { event: 'waiter-left', ticket: me.ticket, runId: me.runId }); }
      if (!c || c.runId !== me.runId) { save(s); return { code: EXIT.REFUSED, action: 'not-owner', claim: c }; }
      s.claim = null;
      log(s, { event: 'released', ticket: me.ticket, runId: me.runId });
      save(s);
      return { code: EXIT.HOLD, action: 'released' };
    });
  }

  // tools/deploy-batch.mjs records what it pushed: the holder's read-back sha
  // and the push time (captured BEFORE the push), which is what "the owner's
  // pipeline run" is measured from. A new push resets the recorded owner run.
  async function recordPush(me, { readBack, pushedHead, pushedAt }) {
    return locked(async (save) => {
      const s = readState(file);
      const c = s.claim;
      if (!c || c.runId !== me.runId) return { code: EXIT.REFUSED, action: 'not-owner' };
      c.readBack = readBack; c.pushedHead = pushedHead || readBack; c.pushedAt = pushedAt || iso(now()); c.ownerRun = null;
      log(s, { event: 'pushed', ticket: me.ticket, runId: me.runId, readBack, pushedHead: c.pushedHead, pushedAt: c.pushedAt });
      save(s);
      return { code: EXIT.HOLD, action: 'recorded', claim: c };
    });
  }

  // The lane covers deploying only. The SITE is checked FIRST: once the live
  // build contains the sha, the lane is released as released-live-confirmed —
  // never as a forced release. Only if it is not live yet do the hold rules run.
  // Only the claimed sha or the recorded read-back sha is accepted.
  async function confirmLive(me, { sha } = {}) {
    const c = readState(file).claim;
    if (!c || c.runId !== me.runId) return { code: EXIT.REFUSED, action: 'not-owner', claim: c };
    if (sha !== c.sha && sha !== c.readBack) {
      return { code: EXIT.REFUSED, action: 'wrong-sha', detail: `${sha} is neither your claimed sha (${c.sha}) nor the read-back sha deploy-batch recorded (${c.readBack || 'none yet'})` };
    }
    const r = await checkLive(sha);
    if (r.code === 0) {
      return locked(async (save) => {
        const s = readState(file);
        const cur = s.claim;
        if (!cur || cur.runId !== me.runId) return { code: EXIT.REFUSED, action: 'not-owner', claim: cur };
        s.claim = null;
        delete s.waiters[me.runId];
        log(s, { event: 'released-live-confirmed', ticket: me.ticket, runId: me.runId, sha, heldMin: Math.round((now() - Date.parse(cur.takenAt)) / MIN) });
        save(s);
        return { code: EXIT.HOLD, action: 'released-live-confirmed', sha, output: r.output };
      });
    }
    const held = await renew(me);
    if (held.code !== 0) return { code: EXIT.REFUSED, action: held.action, reason: held.reason, claim: held.claim, live: r.code };
    return { code: EXIT.WAIT, action: 'still-holding', live: r.code, pipeline: held.pipeline,
      detail: r.code === 1 ? `${sha} is not in the live build yet — still holding the lane; poll again` : `live build undetermined (check-live-build exit ${r.code}) — still holding the lane; poll again`,
      output: r.output };
  }

  async function status(me) {
    const pre = await prefetch(me);
    return locked(async (save, fx) => {
      const s = readState(file);
      const { live } = enforce(s, pre, fx);
      pruneQueue(s);
      save(s);
      const c = s.claim;
      const t = now();
      const waitQueue = order(s).map((w, i) => ({ position: i + 1, ticket: w.ticket, runId: w.runId, since: w.since, waitedMin: waitedMin(w, t), lastSeen: w.lastSeen }));
      const mine = me && s.landed[me.runId] ? { landed: s.landed[me.runId] } : {};
      const rules = { capMin: maxHoldMin, pipelineQueuedMaxMin, readbackGraceMin, healthyQueue, waiterStaleMin: WAITER_STALE_MIN };
      if (!c) return { code: EXIT.HOLD, action: 'free', waitQueue, queue: s.queue, ...rules, ...mine };
      return { code: EXIT.HOLD, action: 'held', claim: c, holder: describe(c, live), legacy: isLegacy(c) || undefined, owner: live, waitQueue, queue: s.queue, ...rules, ...mine };
    });
  }

  // Item 3: a ready commit waits in the ready queue for the next holder's
  // batch. Queuing it does NOT make the run a lane waiter; only `claim` does.
  async function ready(me, opts = {}) {
    const r = await readiness(opts);
    if (!r.ok) return { code: EXIT.NOT_READY, action: 'not-ready', missing: r.missing };
    return locked(async (save) => {
      const s = readState(file);
      pruneQueue(s);
      const entry = { ticket: me.ticket, issueId: me.issueId || null, runId: me.runId, kind: me.kind, sha: r.sha, reviewed: true, readyAt: iso(now()) };
      s.queue = s.queue.filter((e) => e.runId !== me.runId);
      s.queue.push(entry);
      log(s, { event: 'ready', ticket: me.ticket, runId: me.runId, sha: r.sha });
      save(s);
      return { code: EXIT.HOLD, action: 'queued', entry, queue: s.queue, claim: s.claim };
    });
  }

  // A waiter checks in while it is busy (e.g. its suite runs — tools/ci-suite.sh
  // does this every 4 min when DEPLOY_LANE_TICKET is set), so a long test run
  // never costs it its place. It ONLY refreshes lastSeen: no readiness check, no
  // grant, and it never joins a run that is not already waiting. A waiter that
  // has already gone silent is dropped (logged), not revived.
  async function checkin(me) {
    return locked(async (save, fx) => {
      const s = readState(file);
      const w = s.waiters[me.runId];
      if (!w) return { code: EXIT.REFUSED, action: 'not-waiting', detail: 'not in the waiter queue: check-in only keeps an existing place' };
      if (isStale(w)) {
        dropWaiter(s, { ...w, runId: me.runId }, 'stale', staleDetail(w), fx);
        save(s);
        return { code: EXIT.REFUSED, action: 'dropped', detail: `${staleDetail(w)} — claim again to rejoin at the back` };
      }
      w.lastSeen = iso(now());
      log(s, { event: 'checked-in', ticket: me.ticket, runId: me.runId });
      save(s);
      return { code: EXIT.HOLD, action: 'checked-in', since: w.since, lastSeen: w.lastSeen };
    });
  }

  // Withdraw the caller's queued entry.
  async function unready(me) {
    return locked(async (save) => {
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
  // do their live read-back). Liveness is checked BEFORE the lock under a
  // deadline; an entry not reached is kept but not batched this round. The
  // notice for a dropped entry goes out after the lock (best-effort).
  async function batchCandidates(me) {
    const snap = readState(file);
    const deadline = Date.now() + livenessBudgetMs;
    const liveOf = new Map();
    for (const e of snap.queue) {
      if (e.runId === me.runId) continue;
      if (Date.now() >= deadline) break;
      liveOf.set(`${e.runId}|${e.sha}`, await liveness(e));
    }
    return locked(async (save, fx) => {
      const s = readState(file);
      pruneQueue(s);
      const keep = [];
      const unchecked = new Set();
      for (const e of s.queue) {
        if (e.runId === me.runId) { keep.push(e); continue; }
        const live = liveOf.get(`${e.runId}|${e.sha}`);
        if (!live) { keep.push(e); unchecked.add(e); continue; }
        if (live.state !== 'dead') { keep.push(e); continue; }
        log(s, { event: 'ready-dropped-dead-owner', ticket: e.ticket, runId: e.runId, sha: e.sha, evidence: live.detail });
        fx.push(async () => {
          await notify({ to: 'owner', issueId: e.issueId,
            body: `## Deploy lane: your queued commit was dropped — run ended\n\n\`${e.sha}\` (run \`${e.runId}\`) was queued with \`deploy-lane.mjs ready\`, ` +
              `but that run is no longer active (${live.detail}), so nobody would do its live read-back. It was NOT landed. Re-queue it from a live run.` });
          return null;
        });
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
    return locked(async (save) => {
      const s = readState(file);
      const t = iso(now());
      for (const l of landed) {
        s.landed[l.runId] = { ticket: l.ticket, sha: l.sha, landedAs: l.landedAs, by: me.ticket, at: t };
        s.queue = s.queue.filter((e) => !(e.runId === l.runId && e.sha === l.sha));
        // Its commit is on main: it no longer waits for the lane.
        if (s.waiters[l.runId]) dropWaiter(s, { ...s.waiters[l.runId], runId: l.runId }, 'batched-in', `its commit landed in ${me.ticket}'s batch as ${l.landedAs}`, null);
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

  return { claim, renew, release, confirmLive, recordPush, status, ready, unready, checkin, readiness, batchCandidates, recordBatch, peek, receipt: suiteReceipt };
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
    const l = commitsIn(`${sha}..origin/main`, { cwd });
    if (!l.ok) return { ok: false, codeCommits: [], dataCommits: 0, detail: `git log ${sha}..origin/main failed: ${l.error}` };
    const commits = l.commits;
    // Data = [skip ci] in the SUBJECT AND a data-bot author AND only data paths.
    const code = commits.filter((c) => !isDataCommit(c));
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

// ── GitHub (the owner's pipeline run; the watchdog alert) ────────────────────
// The token comes from GH_TOKEN, else the macOS keychain entry git uses for
// github.com (`git credential-osxkeychain get`). It is read lazily, only when a
// call needs it, and never printed.
export function githubToken(env = process.env) {
  if (env.GH_TOKEN) return env.GH_TOKEN;
  const r = spawnSync('git', ['credential-osxkeychain', 'get'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', timeout: NET_TIMEOUT_MS });
  const m = /^password=(.+)$/m.exec(r.stdout || '');
  return m ? m[1].trim() : null;
}

const GH_API = 'https://api.github.com';
async function gh(pathname, { token, method = 'GET', body, apiBase = GH_API } = {}) {
  const r = await fetch(`${apiBase}${pathname}`, { method, signal: AbortSignal.timeout(NET_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return r;
}

// pipeline.yml runs, newest first. A run counts as STARTED only if one of its
// jobs has a non-null started_at: live GitHub sets run_started_at == created_at
// on every run, including the ~21% cancelled while still queued, which have no
// jobs at all — such a run is never "the owner's run". Jobs are read for at most
// JOBS_CALLS_MAX runs: the recorded owner run if there is one, else the earliest
// created at/after `since` − 10 min that are not queued (not-cancelled first).
const JOBS_CALLS_MAX = 3;
export function githubPipelineRuns({ repo = DEFAULT_REPO, token = () => githubToken(), workflow = 'pipeline.yml', apiBase = GH_API } = {}) {
  return async ({ since, ownerRunId } = {}) => {
    try {
      const tk = typeof token === 'function' ? token() : token;
      if (!tk) return { ok: false, detail: 'no GitHub token (GH_TOKEN or keychain)' };
      const call = (p) => gh(p, { token: tk, apiBase });
      const r = await call(`/repos/${repo}/actions/workflows/${workflow}/runs?per_page=20`);
      if (!r.ok) return { ok: false, detail: `GitHub runs HTTP ${r.status}` };
      const runs = ((await r.json()).workflow_runs || []).map((run) => ({ id: run.id, status: run.status, conclusion: run.conclusion || null,
        createdAt: run.created_at, startedAt: null, completedAt: run.status === 'completed' ? run.updated_at : null, url: run.html_url }));
      const sinceMs = since ? Date.parse(since) : -Infinity;
      const cands = ownerRunId != null ? runs.filter((x) => x.id === ownerRunId)
        : runs.filter((x) => !QUEUED.has(x.status) && Date.parse(x.createdAt) >= sinceMs - 10 * MIN)
          .sort((a, b) => ((a.conclusion === 'cancelled') - (b.conclusion === 'cancelled')) || (Date.parse(a.createdAt) - Date.parse(b.createdAt)))
          .slice(0, JOBS_CALLS_MAX);
      for (const x of cands) {
        const j = await call(`/repos/${repo}/actions/runs/${x.id}/jobs?per_page=50`);
        if (!j.ok) return { ok: false, detail: `GitHub jobs HTTP ${j.status}` };
        const starts = ((await j.json()).jobs || []).map((k) => k.started_at).filter(Boolean).sort();
        x.startedAt = starts[0] || null;
      }
      return { ok: true, runs };
    } catch (e) { return { ok: false, detail: `GitHub unreachable: ${e.message}` }; }
  };
}

// The freshness alarm's channel: dispatch pipeline-watchdog.yml with lane_alert,
// whose first step prints ::error:: and fails the run.
export function githubAlert({ repo = DEFAULT_REPO, token = () => githubToken(), workflow = 'pipeline-watchdog.yml', ref = 'main', apiBase = GH_API } = {}) {
  return async ({ message }) => {
    try {
      const tk = typeof token === 'function' ? token() : token;
      if (!tk) return { ok: false, error: 'no GitHub token (GH_TOKEN or keychain)' };
      const r = await gh(`/repos/${repo}/actions/workflows/${workflow}/dispatches`, { token: tk, method: 'POST', apiBase, body: { ref, inputs: { lane_alert: message.slice(0, 1000) } } });
      return r.status === 204 || r.ok ? { ok: true } : { ok: false, error: `dispatch HTTP ${r.status}` };
    } catch (e) { return { ok: false, error: e.message }; }
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
    pipelineRuns: githubPipelineRuns({ repo: env.GITHUB_REPOSITORY || DEFAULT_REPO }),
    alert: githubAlert({ repo: env.GITHUB_REPOSITORY || DEFAULT_REPO }),
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
  '       node tools/deploy-lane.mjs rebased --sha <commit>   (exit 0 rebased, 7 not)\n' +
  '       node tools/deploy-lane.mjs renew|release|unready|checkin --ticket TEN-123\n       node tools/deploy-lane.mjs status [--ticket TEN-123]';

async function main() {
  let a;
  try { a = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`${e.message}\n${USAGE}`); process.exit(EXIT.USAGE); }
  const needsSha = a.cmd === 'claim' || a.cmd === 'ready' || a.cmd === 'confirm-live' || a.cmd === 'rebased';
  if (a.cmd === 'rebased' && a.sha) {
    // The one data-commit classifier, for shell callers (the drop-in job): exit 0 rebased, 7 not.
    const full = git(['rev-parse', '--verify', '--quiet', `${a.sha}^{commit}`]);
    const r = gitRebaseCheck()(full.status === 0 ? full.stdout : a.sha);
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? EXIT.HOLD : EXIT.NOT_READY);
  }
  if (!['claim', 'ready', 'unready', 'renew', 'release', 'status', 'confirm-live', 'checkin'].includes(a.cmd) || (a.cmd !== 'status' && !a.ticket) || (needsSha && !a.sha)) {
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

// For the store-lock test only.
export const _internals = { withLock, readState, writeState };
