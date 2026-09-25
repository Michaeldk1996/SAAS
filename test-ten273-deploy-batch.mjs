// TEN-273 item 3 — one build for several ready commits; and the suite receipt.
//
// FOUNDER, 2026-09-25: "When more than one agent has a ready commit, combine
// them into one push and one pipeline run. Run the suite and clobber check on
// the combined tree first. If anything conflicts, fall back to one-by-one."
//
// Every case runs tools/deploy-batch.mjs against a REAL temp git repo with a
// bare origin (real cherry-picks, real pushes, a real data bot committing
// `[skip ci]` to origin), the REAL tools/clobber-check.sh, the REAL lane store
// and the REAL Paperclip adapters over HTTP to a fake board. The one substitute
// is the suite (the real one clones GitHub and runs npm test for ~6 min): its
// fake returns the real shape { ok, exit, log, output }. tools/ci-suite.sh is
// then tested for real against a temp origin, with a trivial npm test.
//
// Each case is paired with mutants of the real source that must make it fail.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// TEN273_BATCH_SRC runs the cases against another copy (e.g. the pre-change tool).
const BATCH_SRC = process.env.TEN273_BATCH_SRC || path.join(HERE, 'tools', 'deploy-batch.mjs');
const LANE_SRC = path.join(HERE, 'tools', 'deploy-lane.mjs');
const SUITE_SRC = path.join(HERE, 'tools', 'ci-suite.sh');
const MIN = 60 * 1000;
const T0 = Date.parse('2026-09-25T08:00:00Z');

const laneMod = await import(pathToFileURL(LANE_SRC).href);
const real = await import(pathToFileURL(BATCH_SRC).href);

// ── fake board ───────────────────────────────────────────────────────────────
function startBoard() {
  const runs = {};
  const comments = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const m = req.url.match(/^\/api\/heartbeat-runs\/([^/?]+)$/);
      if (req.method === 'GET' && m) {
        if (!runs[m[1]]) { res.writeHead(404); return res.end('{}'); }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ id: m[1], status: runs[m[1]] }));
      }
      const c = req.url.match(/^\/api\/issues\/([^/]+)\/comments$/);
      if (req.method === 'POST' && c) {
        const id = `c${comments.length + 1}`;
        comments.push({ id, issueId: c[1], ...JSON.parse(body) });
        res.writeHead(201, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ id }));
      }
      res.writeHead(404); res.end('{}');
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({
    base: `http://127.0.0.1:${srv.address().port}`, runs, comments, close: () => { srv.closeAllConnections(); srv.close(); },
  })));
}

// ── real git fixture ─────────────────────────────────────────────────────────
// Fixture commits are dated in the past, so a cherry-pick (dated now) can never
// reproduce a fixture sha by accident — "S reached main" then means S itself.
const PAST = { ...process.env, GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z', GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z' };
function sh(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: PAST });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function commit(cwd, file, content, msg) {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), content);
  sh(cwd, 'add', file);
  sh(cwd, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', msg);
  return sh(cwd, 'rev-parse', 'HEAD');
}
function receipt(dir, sha, exit = 0) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sha}.json`), JSON.stringify({ sha, tree: 'f'.repeat(40), exit, startedAt: '2026-09-25T07:50:00Z', finishedAt: '2026-09-25T07:56:00Z', log: '/tmp/x.log' }));
}

const A = { ticket: 'TEN-301', issueId: 'issue-A', runId: 'run-A', kind: 'paperclip' };
const B = { ticket: 'TEN-302', issueId: 'issue-B', runId: 'run-B', kind: 'paperclip' };
const C = { ticket: 'TEN-303', issueId: 'issue-C', runId: 'run-C', kind: 'paperclip' };
const Z = { ticket: 'TEN-304', issueId: 'issue-Z', runId: 'run-Z', kind: 'paperclip' };
const W = { ticket: 'TEN-305', issueId: 'issue-W', runId: 'run-W', kind: 'paperclip' };
const M = { ticket: 'TEN-306', issueId: 'issue-M', runId: 'run-M', kind: 'paperclip' };
const E = { ticket: 'TEN-307', issueId: 'issue-E', runId: 'run-E', kind: 'paperclip' };

// origin/main: seed + one data-bot commit. Holder A edits a.txt, B edits b.txt,
// C edits c.txt, Z edits b.txt the other way (conflicts with B). All branch off
// the seed, so each is "rebased" (only a [skip ci] commit ahead of it). W writes
// matches.json, which the data bot moved (its own clobber check fails); M carries a
// merge commit. B2 is B's newer commit. `holderOnTip` builds the holder on top of
// origin/main (so it can fast-forward); `beforeHolder` runs after the entries are
// queued and before the holder commit is made and claimed.
async function fixture({ entries = [B, C], holderOnTip = false, beforeHolder = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ten273-batch-'));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const bot = path.join(root, 'bot');
  sh(root, 'init', '-q', '--bare', '-b', 'main', origin);
  sh(origin, 'config', 'core.logAllRefUpdates', 'always'); // one reflog line per push
  sh(root, 'clone', '-q', origin, work);
  sh(work, 'config', 'user.name', 't'); sh(work, 'config', 'user.email', 't@t'); sh(work, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  for (const f of ['a.txt', 'b.txt', 'c.txt', 'matches.json']) fs.writeFileSync(path.join(work, f), `${f} v1\n`);
  sh(work, 'add', '.'); sh(work, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'seed');
  sh(work, 'push', '-q', 'origin', 'main');
  const seed = sh(work, 'rev-parse', 'HEAD');
  sh(root, 'clone', '-q', origin, bot);
  // The data bot commits as a real, allowlisted data-bot author.
  sh(bot, 'config', 'user.name', 'bsp-odds-bot'); sh(bot, 'config', 'user.email', 'bsp-odds-bot@users.noreply.github.com');
  let n = 0;
  const onOrigin = (file, msg) => { sh(bot, 'pull', '-q', '--rebase', 'origin', 'main'); commit(bot, file, `${msg} ${++n}\n`, msg); sh(bot, 'push', '-q', 'origin', 'HEAD:main'); };
  const dataBot = () => onOrigin('matches.json', 'data refresh [skip ci]');
  // A CODE commit whose BODY mentions [skip ci]: the marker only counts in the subject.
  const codePush = () => onOrigin('other.txt', 'TEN-999: an unlaned code push\n\nThis body mentions [skip ci] but the commit is code.');
  const mk = (file, content, msg, from = seed) => { sh(work, 'checkout', '-q', '--detach', from); return commit(work, file, content, msg); };
  const shas = { B: mk('b.txt', 'b.txt from B\n', 'TEN-302: B change'), B2: mk('b2.txt', 'B again\n', 'TEN-302: B newer change'),
    C: mk('c.txt', 'c.txt from C\n', 'TEN-303: C change'), Z: mk('b.txt', 'b.txt from Z\n', 'TEN-304: Z change'),
    W: mk('matches.json', 'W rewrote data\n', 'TEN-305: W writes matches.json') };
  const m1 = mk('m1.txt', 'm1\n', 'TEN-306: m1');
  mk('m2.txt', 'm2\n', 'TEN-306: m2');
  sh(work, '-c', 'core.hooksPath=/dev/null', 'merge', '-q', '--no-ff', '--no-edit', m1);
  shas.M = sh(work, 'rev-parse', 'HEAD');
  shas.E = seed; // an entry already on origin/main
  sh(work, 'checkout', '-q', '--detach', seed);
  dataBot();
  const receipts = path.join(root, 'receipts');
  for (const s of Object.values(shas)) receipt(receipts, s);

  const board = await startBoard();
  for (const r of ['run-A', 'run-B', 'run-C', 'run-Z', 'run-W', 'run-M', 'run-E']) board.runs[r] = 'running';
  const clock = { t: T0 };
  const notify = laneMod.paperclipNotify({ apiBase: board.base, apiKey: 'k', agentId: 'agent-x' });
  const lane = laneMod.createLane({ file: path.join(root, 'lane.json'), now: () => clock.t,
    liveness: laneMod.paperclipLiveness({ apiBase: board.base, apiKey: 'k' }), notify,
    suiteReceipt: laneMod.fileSuiteReceipts({ dir: receipts }), rebaseCheck: laneMod.gitRebaseCheck({ cwd: work }) });
  for (const e of entries) {
    clock.t += MIN;
    const r = await lane.ready(e, { sha: shas[e.runId.slice(4)], reviewed: true });
    if (r.code !== 0) throw new Error(`ready ${e.ticket}: ${JSON.stringify(r)}`);
  }
  if (beforeHolder) await beforeHolder({ codePush, dataBot });
  if (holderOnTip) { sh(work, 'fetch', '-q', 'origin'); shas.A = mk('a.txt', 'a.txt holder\n', 'TEN-301: holder change', 'origin/main'); }
  else shas.A = mk('a.txt', 'a.txt holder\n', 'TEN-301: holder change');
  sh(work, 'checkout', '-q', '--detach', seed);
  receipt(receipts, shas.A);
  clock.t += MIN;
  const claim = await lane.claim(A, { sha: shas.A, reviewed: true });
  if (claim.code !== 0) throw new Error(`claim: ${JSON.stringify(claim)}`);

  const suiteCalls = [];
  let suiteHook = null;
  let suiteOk = true;
  const suite = async (sha) => { suiteCalls.push(sha); if (suiteHook) await suiteHook(); return { ok: suiteOk, exit: suiteOk ? 0 : 1, log: `/tmp/ci-suite-${sha}.log`, output: `EXIT=${suiteOk ? 0 : 1}` }; };
  const tipOf = () => sh(origin, 'rev-parse', 'main');
  const pushes = () => sh(origin, 'reflog', 'show', 'main').split('\n').filter(Boolean).length;
  const subjects = (from) => sh(origin, 'log', '--reverse', '--format=%s', `${from}..main`).split('\n').filter(Boolean);
  return { root, origin, work, bot, board, lane, clock, shas, claim, notify, suite, suiteCalls, dataBot, codePush, receipts, mk,
    setSuiteOk: (v) => { suiteOk = v; }, setSuiteHook: (f) => { suiteHook = f; }, tipOf, pushes, subjects,
    close: () => board.close() };
}

async function batch(mod, f, me = A, sha = f.shas.A, extra = {}) {
  return mod.runBatch({ lane: f.lane, me, sha, repo: f.work, suite: f.suite, clobber: real.realClobberCheck({ cwd: f.work }), notify: f.notify, ...extra });
}

// ── the cases ────────────────────────────────────────────────────────────────
const CASES = {
  // i · two ready entries + the holder → ONE push carrying all three; landedAs
  //     recorded; a notice on each entry's issue; the queue emptied.
  async combinesIntoOnePush(mod) {
    const f = await fixture();
    try {
      if (f.claim.batch.length !== 2) return false;
      const start = f.tipOf(); const pushes0 = f.pushes();
      const r = await batch(mod, f);
      const st = f.lane.peek();
      const tip = f.tipOf();
      const lB = st.landed['run-B']; const lC = st.landed['run-C'];
      const subjOf = (s) => sh(f.origin, 'log', '-1', '--format=%s', s);
      const isAnc = (s) => spawnSync('git', ['merge-base', '--is-ancestor', s, tip], { cwd: f.origin }).status === 0;
      const nB = f.board.comments.find((c) => c.issueId === 'issue-B'); const nC = f.board.comments.find((c) => c.issueId === 'issue-C');
      return r.code === 0 && r.mode === 'batch'
        && f.pushes() === pushes0 + 1
        && JSON.stringify(f.subjects(start)) === JSON.stringify(['TEN-301: holder change', 'TEN-302: B change', 'TEN-303: C change'])
        && f.suiteCalls.length === 1 && f.suiteCalls[0] === tip
        && !!lB && !!lC && isAnc(lB.landedAs) && isAnc(lC.landedAs) && subjOf(lB.landedAs) === 'TEN-302: B change' && subjOf(lC.landedAs) === 'TEN-303: C change'
        && st.queue.length === 0
        && !!nB && nB.body.includes(`landed in a batch by TEN-301 as ${lB.landedAs}`) && nB.body.includes(`tools/check-live-build.sh ${lB.landedAs}`)
        && !!nC && nC.body.includes(lC.landedAs) && nB.body.includes('release --ticket TEN-302')
        && st.claim.readBack === r.readBack && !!st.claim.pushedAt
        && r.holder.landedAs && subjOf(r.holder.landedAs) === 'TEN-301: holder change';
    } catch (e) { if (process.env.DEBUG_TEN273) console.error("CASE THREW:", e.message); return false; } finally { f.close(); }
  },

  // ii · an entry that conflicts is skipped and stays queued (marked conflict);
  //      the others land.
  async conflictingEntryIsSkipped(mod) {
    const f = await fixture({ entries: [B, Z, C] });
    try {
      const start = f.tipOf();
      const r = await batch(mod, f);
      const st = f.lane.peek();
      const z = st.queue.find((e) => e.runId === 'run-Z');
      return r.code === 0 && r.mode === 'batch'
        && JSON.stringify(f.subjects(start)) === JSON.stringify(['TEN-301: holder change', 'TEN-302: B change', 'TEN-303: C change'])
        && st.queue.length === 1 && !!z && z.status === 'conflict' && /CONFLICT|apply/.test(z.reason) && z.sha === f.shas.Z
        && !!st.landed['run-B'] && !!st.landed['run-C'] && !st.landed['run-Z']
        && f.board.comments.every((c) => c.issueId !== 'issue-Z');
    } catch (e) { if (process.env.DEBUG_TEN273) console.error("CASE THREW:", e.message); return false; } finally { f.close(); }
  },

  // iii · a red suite on the combined tree → fall back: only the holder's own
  //       commit is pushed; the others stay queued, untouched; the reason printed.
  async redSuiteFallsBackToHolderOnly(mod) {
    const f = await fixture();
    try {
      f.setSuiteOk(false);
      const start = f.tipOf();
      const r = await batch(mod, f);
      const st = f.lane.peek();
      return r.code === 0 && r.mode === 'fallback' && /suite RED/.test(r.fallbackReason)
        && JSON.stringify(f.subjects(start)) === JSON.stringify(['TEN-301: holder change'])
        && st.queue.length === 2 && st.queue.every((e) => !e.status && !e.landedAs)
        && !st.landed['run-B'] && !st.landed['run-C'] && !!st.landed['run-A']
        && f.board.comments.every((c) => c.issueId !== 'issue-B' && c.issueId !== 'issue-C');
    } catch (e) { if (process.env.DEBUG_TEN273) console.error("CASE THREW:", e.message); return false; } finally { f.close(); }
  },

  // iv · only the lane holder may run it.
  async nonHolderIsRefused(mod) {
    const f = await fixture();
    try {
      const tip0 = f.tipOf();
      const r = await batch(mod, f, B, f.shas.B);
      return r.code === 1 && r.action === 'not-holder' && f.tipOf() === tip0 && f.suiteCalls.length === 0 && f.lane.peek().queue.length === 2;
    } catch (e) { if (process.env.DEBUG_TEN273) console.error("CASE THREW:", e.message); return false; } finally { f.close(); }
  },

  // v · a data bot lands while the suite runs → the push is rejected; the batch
  //     replays onto the new origin/main, re-runs the clobber check, retries once.
  async dataBotRejectionIsRetried(mod) {
    const f = await fixture();
    try {
      const start = f.tipOf();
      f.setSuiteHook(() => f.dataBot());
      const r = await batch(mod, f);
      const subj = f.subjects(start);
      return r.code === 0 && r.mode === 'batch' && r.pushAttempts === 2
        && subj.length === 4 && /\[skip ci\]/.test(subj[0]) && subj.slice(1).join('|') === 'TEN-301: holder change|TEN-302: B change|TEN-303: C change';
    } catch (e) { if (process.env.DEBUG_TEN273) console.error("CASE THREW:", e.message); return false; } finally { f.close(); }
  },

  // vi · a CODE commit lands during the batch → no push over it: fall back, and the
  //      holder's own commit is refused too (it is no longer rebased).
  async codeCommitAbortsTheBatch(mod) {
    const f = await fixture();
    try {
      f.setSuiteHook(() => f.codePush());
      const r = await batch(mod, f);
      const tip = f.tipOf();
      return r.code === 1 && r.mode === 'fallback' && /code commit landed/.test(r.fallbackReason) && /no longer rebased/.test(r.detail)
        && sh(f.origin, 'log', '-1', '--format=%s', tip) === 'TEN-999: an unlaned code push'
        && f.lane.peek().queue.length === 2;
    } catch (e) { if (process.env.DEBUG_TEN273) console.error("CASE THREW:", e.message); return false; } finally { f.close(); }
  },
};

Object.assign(CASES, {
  // vii · the sha deploy-batch pushes must be the one the claim was granted for.
  async shaMustBeTheClaimedSha(mod) {
    const f = await fixture();
    try {
      const tip0 = f.tipOf();
      const s2 = f.mk('a2.txt', 'untested\n', 'TEN-301: a later, untested commit', f.shas.A);
      receipt(f.receipts, s2); // even a green receipt does not make it the claimed commit
      const r = await batch(mod, f, A, s2);
      return r.code === 1 && /not the sha you claimed/.test(r.detail) && f.tipOf() === tip0 && f.suiteCalls.length === 0;
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { f.close(); }
  },

  // viii · the claimed sha's receipt is re-checked at batch time: gone or red → refused.
  async receiptRecheckedAtBatchTime(mod) {
    const f = await fixture();
    try {
      const tip0 = f.tipOf();
      const file = path.join(f.receipts, `${f.shas.A}.json`);
      fs.rmSync(file);
      const gone = await batch(mod, f);
      receipt(f.receipts, f.shas.A, 1);
      const red = await batch(mod, f);
      return gone.code === 1 && /no green suite receipt/.test(gone.detail) && red.code === 1 && /no green suite receipt/.test(red.detail)
        && f.tipOf() === tip0 && f.suiteCalls.length === 0;
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { f.close(); }
  },

  // ix · holder alone and already on top of origin/main: S ITSELF is pushed, so
  //      check-live-build.sh <S> can find it; readBack is S.
  async holderAloneFastForwardsItsOwnSha(mod) {
    const f = await fixture({ entries: [], holderOnTip: true });
    try {
      const r = await batch(mod, f);
      return r.code === 0 && r.mode === 'holder-only' && f.tipOf() === f.shas.A && r.readBack === f.shas.A && r.holder.pushedAsIs === true;
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { f.close(); }
  },

  // x · an entry whose own clobber check fails (a data bot moved a file it writes
  //     since its merge-base) is skipped, stays queued, marked `clobber`.
  async entryClobberCheckSkips(mod) {
    const f = await fixture({ entries: [B, W] });
    try {
      const start = f.tipOf();
      const r = await batch(mod, f);
      const w = f.lane.peek().queue.find((e) => e.runId === 'run-W');
      return r.code === 0 && JSON.stringify(f.subjects(start)) === JSON.stringify(['TEN-301: holder change', 'TEN-302: B change'])
        && !!w && w.status === 'clobber' && /matches\.json/.test(w.reason);
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { f.close(); }
  },

  // xi · an entry that contains a merge commit is skipped: "rebase, don't merge".
  async mergeEntrySkipped(mod) {
    const f = await fixture({ entries: [B, M] });
    try {
      const r = await batch(mod, f);
      const m = f.lane.peek().queue.find((e) => e.runId === 'run-M');
      return r.code === 0 && !!m && m.status === 'merge' && /rebase, don't merge/.test(m.reason) && !!f.lane.peek().landed['run-B'];
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { f.close(); }
  },

  // xii · entries no longer rebased at batch time (a code commit landed after they
  //       were queued) are skipped and left queued; the rebased holder lands alone.
  async staleEntriesSkippedNotLanded(mod) {
    const f = await fixture({ entries: [B, C], holderOnTip: true, beforeHolder: ({ codePush }) => codePush() });
    try {
      const r = await batch(mod, f);
      const q = f.lane.peek().queue;
      return r.code === 0 && r.mode === 'holder-only' && f.tipOf() === f.shas.A
        && q.length === 2 && q.every((e) => e.status === 'not-rebased' && /code commit/.test(e.reason));
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { f.close(); }
  },

  // xiii · a dead owner's entry is dropped at batch time, not landed.
  async deadOwnerEntryNotLanded(mod) {
    const f = await fixture();
    try {
      f.board.runs['run-B'] = 'cancelled';
      const start = f.tipOf();
      const r = await batch(mod, f);
      const st = f.lane.peek();
      return r.code === 0 && JSON.stringify(f.subjects(start)) === JSON.stringify(['TEN-301: holder change', 'TEN-303: C change'])
        && !st.landed['run-B'] && st.queue.every((e) => e.runId !== 'run-B')
        && f.board.comments.some((c) => c.issueId === 'issue-B' && /dropped/.test(c.body) && /NOT landed/.test(c.body))
        && st.history.some((h) => h.event === 'ready-dropped-dead-owner' && h.runId === 'run-B');
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { f.close(); }
  },
});

Object.assign(CASES, {
  // xv · an entry already on origin/main is dropped silently: no notice, not
  //      landed, and it does not make this a batch.
  async alreadyOnMainEntryDroppedSilently(mod) {
    const f = await fixture({ entries: [E] });
    try {
      const r = await batch(mod, f);
      const st = f.lane.peek();
      return r.code === 0 && r.mode === 'holder-only' && st.queue.length === 0 && !st.landed['run-E']
        && f.board.comments.every((c) => c.issueId !== 'issue-E')
        && st.history.some((h) => h.event === 'ready-already-on-main' && h.runId === 'run-E');
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { f.close(); }
  },

  // xvi · pushedAt is captured BEFORE git push (the owner's run is the first to
  //       start at/after it; a tick can start the moment the push lands).
  async pushedAtIsCapturedBeforeThePush(mod) {
    const f = await fixture({ entries: [] });
    try {
      let t = Date.parse('2026-09-25T09:00:00Z');
      const clock = () => t;
      const gitSpy = (args, opts) => { if (args[0] === 'push') t += 60000; return laneMod.git(args, opts); };
      const r = await batch(mod, f, A, f.shas.A, { clock, git: gitSpy });
      return r.code === 0 && f.lane.peek().claim.pushedAt === '2026-09-25T09:00:00.000Z';
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { f.close(); }
  },

  // xvii · if the lane cannot record the push, deploy-batch says so loudly and
  //        exits non-zero — the push landed, but the lane does not know it.
  async unrecordedPushIsLoud(mod) {
    const f = await fixture({ entries: [] });
    try {
      const start = f.tipOf();
      const lane = { ...f.lane, recordPush: async () => ({ code: 1, action: 'not-owner' }) };
      const r = await mod.runBatch({ lane, me: A, sha: f.shas.A, repo: f.work, suite: f.suite, clobber: real.realClobberCheck({ cwd: f.work }), notify: f.notify });
      return r.code === 1 && r.action === 'pushed-lane-unaware' && f.tipOf() !== start && r.recordPush === 'not-owner';
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { f.close(); }
  },

  // xviii · a code commit whose title says [skip ci] but whose author is not a
  //         data bot lands during the batch → treated as code: no push over it.
  async skipCiByANonBotStopsThePush(mod) {
    const f = await fixture();
    try {
      f.setSuiteHook(() => {
        sh(f.bot, 'pull', '-q', '--rebase', 'origin', 'main');
        sh(f.bot, 'config', 'user.email', 'dev@example.com');
        commit(f.bot, 'sneaky.txt', 'x\n', 'TEN-998: a code change titled [skip ci]');
        sh(f.bot, 'config', 'user.email', 'bsp-odds-bot@users.noreply.github.com');
        sh(f.bot, 'push', '-q', 'origin', 'HEAD:main');
      });
      const r = await batch(mod, f);
      return r.mode === 'fallback' && /code commit landed/.test(r.fallbackReason || '') && sh(f.origin, 'log', '-1', '--format=%s', 'main') === 'TEN-998: a code change titled [skip ci]';
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { f.close(); }
  },

  // xix · an AGENT's code commit under a data-bot identity with [skip ci] in the
  //       title (TEN-232 did this) lands during the batch → code: no push over it.
  async botIdentityCodeStopsThePush(mod) {
    const f = await fixture();
    try {
      f.setSuiteHook(() => {
        sh(f.bot, 'pull', '-q', '--rebase', 'origin', 'main');
        sh(f.bot, 'config', 'user.email', 'bsp-bot@users.noreply.github.com');
        commit(f.bot, 'lib.js', 'module.exports = 1;\n', 'TEN-997: agent code under the bot identity [skip ci]');
        sh(f.bot, 'config', 'user.email', 'bsp-odds-bot@users.noreply.github.com');
        sh(f.bot, 'push', '-q', 'origin', 'HEAD:main');
      });
      const r = await batch(mod, f);
      return r.mode === 'fallback' && /code commit landed/.test(r.fallbackReason || '') && /TEN-997/.test(r.fallbackReason || '');
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { f.close(); }
  },

  // xiv · the holder's own claimed commit containing a merge is refused.
  async holderMergeRefused(mod) {
    const f = await fixture({ entries: [] });
    try {
      const other = f.mk('x.txt', 'x\n', 'TEN-301: side');
      sh(f.work, 'checkout', '-q', '--detach', f.shas.A);
      sh(f.work, '-c', 'core.hooksPath=/dev/null', 'merge', '-q', '--no-ff', '--no-edit', other);
      const merged = sh(f.work, 'rev-parse', 'HEAD');
      receipt(f.receipts, merged);
      if ((await f.lane.release(A)).code !== 0 || (await f.lane.claim(A, { sha: merged, reviewed: true })).code !== 0) return false;
      const tip0 = f.tipOf();
      const r = await batch(mod, f, A, merged);
      return r.code === 1 && /rebase, don't merge/.test(r.detail) && f.tipOf() === tip0;
    } catch (e) { if (process.env.DEBUG_TEN273) console.error('CASE THREW:', e.message); return false; } finally { f.close(); }
  },
});

const MUTANTS = [
  ['queued entries are never picked', 'combinesIntoOnePush',
    'const b = build(START, [holder, ...entries]);', 'const b = build(START, [holder]);'],
  ['landedAs is not recorded for the entries', 'combinesIntoOnePush',
    'const landed = b.included.map((g) => ({', 'const landed = b.included.filter((g) => g.holder).map((g) => ({'],
  ['the push is not recorded on the claim (no readBack / pushedAt)', 'combinesIntoOnePush',
    'try { rp = await lane.recordPush(me, { readBack: hold.landedAs, pushedHead: b.head, pushedAt }); }', "try { rp = { code: 0, action: 'recorded' }; }"],
  ['the batch notice does not tell the run to release', 'combinesIntoOnePush',
    'If you have nothing more to push, also run \\`node tools/deploy-lane.mjs release --ticket ${g.ticket}\\` to withdraw anything else you queued.', 'Done.'],
  ['no notice to the included entries', 'combinesIntoOnePush',
    'for (const g of b.included.filter((x) => !x.holder)) {', 'for (const g of []) {'],
  ['each commit pushed separately', 'combinesIntoOnePush',
    "      included.push({ ...g, commits, landedAs: W(['rev-parse', 'HEAD']).stdout });",
    "      W(['push', '-q', 'origin', 'HEAD:refs/heads/main']);\n      included.push({ ...g, commits, landedAs: W(['rev-parse', 'HEAD']).stdout });"],
  ['a conflicting entry sinks the whole batch', 'conflictingEntryIsSkipped',
    "conflicts.push({ ticket: g.ticket, runId: g.runId, sha: g.sha, status: 'conflict', reason }); continue;", 'return { ok: false, reason };'],
  ['a conflict is not marked in the queue', 'conflictingEntryIsSkipped',
    'skipped.push(...b.conflicts);', ''],
  ['a conflicting cherry-pick is not aborted', 'conflictingEntryIsSkipped',
    "W(['cherry-pick', '--abort']);\n        W(['reset', '-q', '--hard', before]);", ''],
  ['a red combined suite is ignored', 'redSuiteFallsBackToHolderOnly',
    'if (!su.ok) return await fallback(', 'if (false) return await fallback('],
  ['the fallback pushes the combined tree', 'redSuiteFallsBackToHolderOnly',
    'const b = build(tip, [holder]);', 'const b = build(tip, [holder, ...entries]);'],
  ['the fallback clears the others from the queue', 'redSuiteFallsBackToHolderOnly',
    'return finish(fb.mode, p.b,', 'p.b.included.push(...entries.map((e) => ({ ...e, landedAs: e.sha })));\n    return finish(fb.mode, p.b,'],
  ['anyone may run the batch', 'nonHolderIsRefused',
    "if (held.code !== 0) return { code: 1, action: 'not-holder'", "if (false) return { code: 1, action: 'not-holder'"],
  ['no retry after a data-bot rejection', 'dataBotRejectionIsRetried', 'if (attempt >= 1) return', 'if (attempt >= 0) return'],
  ['a code commit that landed is pushed over', 'codeCommitAbortsTheBatch',
    'if (code.length) return { ok: false, reason: `a code commit', 'if (false) return { ok: false, reason: `a code commit'],
  ['the fallback skips the rebased check', 'codeCommitAbortsTheBatch',
    'const rb = rebaseCheck(sha);', 'const rb = { ok: true };'],
  ['any --sha is pushed, not only the claimed one', 'shaMustBeTheClaimedSha',
    'if (held.claim.sha !== sha) return refuse(', 'if (false) return refuse('],
  ['the receipt is not re-checked at batch time', 'receiptRecheckedAtBatchTime',
    'if (!rec || rec.sha !== sha || rec.exit !== 0) return refuse(', 'if (false) return refuse('],
  ['the holder is always cherry-picked (its sha never reaches main)', 'holderAloneFastForwardsItsOwnSha',
    'if (g.holder && isAnc(onto, g.sha)) {', 'if (false) {'],
  ['no per-entry clobber check', 'entryClobberCheckSkips',
    "if (!ck.ok) { skip('clobber',", "if (false) { skip('clobber',"],
  ['merge commits are not refused', 'mergeEntrySkipped',
    "if (hasMerges(mb, e.sha)) { skip('merge',", "if (false) { skip('merge',"],
  ['entries are not re-checked for rebased at batch time', 'staleEntriesSkippedNotLanded',
    "if (!rb.ok) { skip('not-rebased', rb.detail); continue; }", ''],
  ['the batch ignores dead owners (reads the raw queue)', 'deadOwnerEntryNotLanded',
    'for (const e of await lane.batchCandidates(me)) {', 'for (const e of lane.peek().queue.filter((x) => x.runId !== me.runId)) {'],
  ['an entry already on main is batched (misleading notice)', 'alreadyOnMainEntryDroppedSilently',
    'if (mb === e.sha) { onMain.push(', 'if (false) { onMain.push('],
  ['pushedAt is taken after the push', 'pushedAtIsCapturedBeforeThePush',
    "      const pushedAt = new Date(clock()).toISOString();\n      const p = W(['push', '-q', 'origin', `${b.head}:refs/heads/main`]);",
    "      const p = W(['push', '-q', 'origin', `${b.head}:refs/heads/main`]);\n      const pushedAt = new Date(clock()).toISOString();"],
  ['a failed recordPush is ignored', 'unrecordedPushIsLoud', 'const unrecorded = !rp || rp.code !== 0;', 'const unrecorded = false;'],
  ['the batch classifies data by subject alone', 'skipCiByANonBotStopsThePush',
    'const code = lr.commits.filter((c) => !isDataCommit(c));', "const code = lr.commits.filter((c) => !c.subject.includes('[skip ci]'));"],
  ['the batch ignores which files a data-bot commit touches', 'botIdentityCodeStopsThePush',
    'const code = lr.commits.filter((c) => !isDataCommit(c));', "const code = lr.commits.filter((c) => !isDataCommit({ ...c, files: ['admin-log.json'] }));"],
  ['a holder merge commit is not refused', 'holderMergeRefused',
    'if (hasMerges(holderMb, sha)) return refuse(', 'if (false) return refuse('],
];

async function loadMutant(find, replace) {
  const src = fs.readFileSync(BATCH_SRC, 'utf8');
  const n = src.split(find).length - 1;
  assert.equal(n, 1, `mutant anchor must occur exactly once, found ${n}: ${find}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten273-mut-'));
  const f = path.join(dir, 'deploy-batch.mjs');
  // The mutant imports the REAL lane module.
  fs.writeFileSync(f, src.replace(find, replace).replace("from './deploy-lane.mjs'", `from '${pathToFileURL(LANE_SRC).href}'`));
  return import(pathToFileURL(f).href);
}

for (const [name, fn] of Object.entries(CASES)) {
  test(`real batch: ${name}`, async () => { assert.equal(await fn(real), true); });
}
for (const [label, caseName, find, replace] of MUTANTS) {
  test(`mutant bites — ${label} → ${caseName} fails`, async () => {
    const mod = await loadMutant(find, replace);
    assert.equal(await CASES[caseName](mod), false);
  });
}

test('a commit re-queued DURING the batch stays queued (removal matches run AND sha)', async () => {
  const f = await fixture();
  try {
    f.setSuiteHook(async () => {
      const r = await f.lane.ready(B, { sha: f.shas.B2, reviewed: true });
      assert.equal(r.code, 0);
    });
    const r = await batch(real, f);
    assert.equal(r.code, 0); assert.equal(r.mode, 'batch');
    const st = f.lane.peek();
    assert.equal(st.landed['run-B'].sha, f.shas.B, 'the batched B commit is the one recorded as landed');
    const q = st.queue.filter((e) => e.runId === 'run-B');
    assert.equal(q.length, 1); assert.equal(q[0].sha, f.shas.B2, 'the newer B commit is still queued');
  } finally { f.close(); }
});

// ── tools/ci-suite.sh, run for real against a temp origin ────────────────────
// The origin's main is RED (exit.txt = 1). The local repo carries two commits
// that are NOT on origin: green (exit.txt = 0) and red (exit.txt = 2). npm test
// records the directory it ran in, so a suite run in the wrong checkout shows.
function suiteFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ten273-suite-'));
  const origin = path.join(root, 'origin.git');
  const local = path.join(root, 'local');
  const marks = path.join(root, 'marks');
  const nm = path.join(root, 'nm');
  fs.mkdirSync(marks); fs.mkdirSync(nm);
  sh(root, 'init', '-q', '--bare', '-b', 'main', origin);
  sh(root, 'clone', '-q', origin, local);
  sh(local, 'config', 'user.name', 't'); sh(local, 'config', 'user.email', 't@t'); sh(local, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  fs.mkdirSync(path.join(local, 'kibl-stream'));
  fs.writeFileSync(path.join(local, 'kibl-stream', 'README.md'), 'x\n');
  fs.writeFileSync(path.join(local, 'package.json'), JSON.stringify({ name: 'x', private: true, scripts: {
    test: `node -e "const fs=require('fs');fs.writeFileSync(process.env.MARKS+'/'+Date.now()+Math.random(),process.cwd()+' nm='+fs.existsSync('node_modules'));process.exit(Number(fs.readFileSync('exit.txt','utf8')))"` } }));
  fs.writeFileSync(path.join(local, 'exit.txt'), '1');
  sh(local, 'add', '.'); sh(local, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'seed (red)');
  sh(local, 'push', '-q', 'origin', 'main');
  const green = commit(local, 'exit.txt', '0', 'green');
  const red = commit(local, 'exit.txt', '2', 'red');
  return { root, origin, local, marks, nm, green, red, receipts: path.join(root, 'receipts') };
}

function runSuite(script, f, sha, url) {
  const r = spawnSync('bash', [script, sha], { cwd: f.local, encoding: 'utf8', env: { ...process.env, CI_SUITE_CLONE_URL: url || pathToFileURL(f.origin).href,
    CI_SUITE_NODE_MODULES: f.nm, SUITE_RECEIPTS_DIR: f.receipts, MARKS: f.marks } });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

async function ciSuiteReceiptOnlyWhenGreen(script) {
  const f = suiteFixture();
  const localReal = fs.realpathSync(f.local);
  const g = runSuite(script, f, f.green.slice(0, 10));
  const rec = path.join(f.receipts, `${f.green}.json`);
  if (g.status !== 0 || !fs.existsSync(rec)) return false;
  const j = JSON.parse(fs.readFileSync(rec, 'utf8'));
  const okReceipt = j.sha === f.green && j.exit === 0 && j.tree === sh(f.local, 'rev-parse', `${f.green}^{tree}`) && j.startedAt && j.finishedAt && fs.existsSync(j.log);
  const r = runSuite(script, f, f.red);
  const bad = runSuite(script, f, f.green, 'file:///nonexistent/nowhere.git');
  const ran = fs.readdirSync(f.marks).map((m) => fs.readFileSync(path.join(f.marks, m), 'utf8'));
  return okReceipt && /EXIT=0/.test(g.out) && /log: \//.test(g.out)
    && r.status === 2 && !fs.existsSync(path.join(f.receipts, `${f.red}.json`)) && /EXIT=2/.test(r.out) && /log: \//.test(r.out)
    && bad.status === 2 && /EXIT=2/.test(bad.out)
    && ran.length === 2 && ran.every((x) => !x.startsWith(localReal) && / nm=true$/.test(x))
    && !fs.existsSync(path.join(f.local, 'node_modules')) && sh(f.local, 'status', '--porcelain') === '';
}

const SUITE_MUTANTS = [
  ['a receipt is written for a red suite', 'if [ "$EXIT" -eq 0 ]; then', 'if true; then'],
  ['the exit code is read off a pipe', 'npm test > "$LOG" 2>&1\nEXIT=$?', 'npm test 2>&1 | tee "$LOG" >/dev/null\nEXIT=$?'],
  ['the suite runs on origin/main, not the sha', 'git -C "$D" checkout -q --detach "$SHA" || fail "could not check out $SHA in the clone"\n[ "$(git -C "$D" rev-parse HEAD)" = "$SHA" ] || fail "clone HEAD is not $SHA"\n', ''],
  ['node_modules is not linked into the clone', 'ln -s "$NODE_MODULES" "$D/node_modules" || fail "could not link node_modules into the clone"', ':'],
];

test('real ci-suite.sh: receipt only when green, on exactly the sha, in the throwaway clone', async () => {
  assert.equal(await ciSuiteReceiptOnlyWhenGreen(SUITE_SRC), true);
});
for (const [label, find, replace] of SUITE_MUTANTS) {
  test(`mutant bites — ci-suite.sh: ${label}`, async () => {
    const src = fs.readFileSync(SUITE_SRC, 'utf8');
    assert.equal(src.split(find).length - 1, 1, `anchor must occur exactly once: ${find}`);
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ten273-suite-mut-')), 'ci-suite.sh');
    fs.writeFileSync(f, src.replace(find, replace));
    assert.equal(await ciSuiteReceiptOnlyWhenGreen(f), false);
  });
}

test('CLI: deploy-batch usage is exit 2; a caller that does not hold the lane gets exit 1 and nothing runs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten273-cli-'));
  const env = { ...process.env, DEPLOY_LANE_FILE: path.join(dir, 'lane.json'), SUITE_RECEIPTS_DIR: path.join(dir, 'r'), PAPERCLIP_API_URL: '', PAPERCLIP_RUN_ID: 'run-X' };
  assert.equal(spawnSync(process.execPath, [BATCH_SRC, '--ticket', 'TEN-1'], { cwd: dir, env, encoding: 'utf8' }).status, 2);
  const r = spawnSync(process.execPath, [BATCH_SRC, '--ticket', 'TEN-1', '--sha', 'HEAD'], { cwd: dir, env, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).action, 'not-holder');
});

// ── ci-suite.sh keeps a waiting place alive (founder, 2026-09-25 03:24Z) ──────
// "Confirm a waiter keeps checking in while its own suite is running, so a long
// test run never costs it its place." With DEPLOY_LANE_TICKET set, the REAL
// script runs `deploy-lane.mjs checkin` in the background while npm test runs,
// and the loop ends with the script — on a normal exit (trap) and when the
// script is SIGKILLed (no trap runs: the loop watches its parent). Driven for
// real: a slow fake npm test, the real lane CLI against a temp store holding
// the caller as a waiter. Check-ins are not logged, so the observable is the
// waiter's lastSeen. Cleanup kills the RECORDED loop pid, never by pattern.
function checkinFixture(testMs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ten273-checkin-'));
  const origin = path.join(root, 'origin.git');
  const local = path.join(root, 'local');
  sh(root, 'init', '-q', '--bare', '-b', 'main', origin);
  sh(root, 'clone', '-q', origin, local);
  sh(local, 'config', 'user.name', 't'); sh(local, 'config', 'user.email', 't@t'); sh(local, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  fs.mkdirSync(path.join(local, 'kibl-stream'));
  fs.writeFileSync(path.join(local, 'kibl-stream', 'README.md'), 'x\n');
  fs.writeFileSync(path.join(local, 'package.json'), JSON.stringify({ name: 'x', private: true, scripts: { test: `node -e "setTimeout(() => process.exit(0), ${testMs})"` } }));
  sh(local, 'add', '.'); sh(local, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'seed');
  sh(local, 'push', '-q', 'origin', 'main');
  fs.mkdirSync(path.join(local, 'tools'));
  fs.copyFileSync(LANE_SRC, path.join(local, 'tools', 'deploy-lane.mjs'));  // the lane tool the script calls
  const store = path.join(root, 'lane.json');
  const t0 = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(store, JSON.stringify({ version: 2, claim: null, queue: [], landed: {}, history: [],
    waiters: { 'run-W': { ticket: 'TEN-W', issueId: null, kind: 'paperclip', since: t0, lastSeen: t0, reportedAt: null, seq: 1 } } }));
  const lastSeen = () => JSON.parse(fs.readFileSync(store, 'utf8')).waiters['run-W'].lastSeen;
  const env = { ...process.env, CI_SUITE_CLONE_URL: pathToFileURL(origin).href, CI_SUITE_NODE_MODULES: path.join(root, 'nm'), SUITE_RECEIPTS_DIR: path.join(root, 'receipts'),
    DEPLOY_LANE_TICKET: 'TEN-W', DEPLOY_LANE_FILE: store, PAPERCLIP_RUN_ID: 'run-W', PAPERCLIP_API_URL: '', CI_SUITE_CHECKIN_SEC: '1' };
  return { root, local, store, t0, lastSeen, env, sha: sh(local, 'rev-parse', 'HEAD') };
}
const sleepMs = (ms) => new Promise((res) => setTimeout(res, ms));
const killPid = (pid) => { if (pid) { try { process.kill(Number(pid), 'SIGTERM'); } catch { /* already gone */ } } };

async function ciSuiteChecksIn(script) {
  const f = checkinFixture(3500);
  const r = spawnSync('bash', [script, f.sha], { cwd: f.local, encoding: 'utf8', timeout: 30000, env: f.env });
  const pid = (/loop pid (\d+)/.exec(r.stdout || '') || [])[1];
  // The EXIT trap kills the loop and waits for it: gone the moment the script returns.
  let goneAtExit = !!pid;
  if (pid) { try { process.kill(Number(pid), 0); goneAtExit = false; } catch { /* gone */ } }
  const during = f.lastSeen();
  await sleepMs(2500);
  const after = f.lastSeen();
  killPid(pid);
  return r.status === 0 && /check-in every 1s for TEN-W/.test(r.stdout) && goneAtExit && during > f.t0 && after === during;
}

// The script is SIGKILLed mid-suite (no trap runs): the loop must notice its
// parent is gone and stop within one interval.
async function ciSuiteLoopDiesWithItsParent(script) {
  const f = checkinFixture(20000);
  const ch = spawn('bash', [script, f.sha], { cwd: f.local, env: f.env });
  let out = '';
  ch.stdout.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !/loop pid \d+/.test(out); i++) await sleepMs(100);
  const pid = (/loop pid (\d+)/.exec(out) || [])[1];
  await sleepMs(2500);
  const alive = f.lastSeen() > f.t0;
  ch.kill('SIGKILL');
  await sleepMs(1500);                         // one interval (1 s) + margin
  const settled = f.lastSeen();
  await sleepMs(2500);
  const later = f.lastSeen();
  killPid(pid);
  return !!pid && alive && later === settled;
}

test('real ci-suite.sh: with DEPLOY_LANE_TICKET, checks in while npm test runs, and stops on exit', async () => {
  assert.equal(await ciSuiteChecksIn(SUITE_SRC), true);
});
test('real ci-suite.sh: the check-in loop stops within one interval when the script is SIGKILLed', async () => {
  assert.equal(await ciSuiteLoopDiesWithItsParent(SUITE_SRC), true);
});
for (const [label, fn, find, replace] of [
  ['the check-in loop never starts', ciSuiteChecksIn, 'if [ -n "${DEPLOY_LANE_TICKET:-}" ] && [ -f "$LANE_TOOL" ]; then', 'if false; then'],
  ['the check-in loop is not killed on exit', ciSuiteChecksIn, 'stop_checkin() { if [ -n "$CHECKIN_PID" ]; then kill', 'stop_checkin() { if false; then kill'],
  ['the check-in loop does not watch its parent', ciSuiteLoopDiesWithItsParent,
    '      wait "$SP"\n      kill -0 "$PARENT" 2>/dev/null || exit 0\n', '      wait "$SP"\n'],
]) {
  test(`mutant bites — ci-suite.sh: ${label}`, async () => {
    const src = fs.readFileSync(SUITE_SRC, 'utf8');
    assert.equal(src.split(find).length - 1, 1, `anchor must occur exactly once: ${find}`);
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ten273-suite-mut-')), 'ci-suite.sh');
    let src2 = src.replace(find, replace);
    if (fn === ciSuiteLoopDiesWithItsParent) src2 = src2.replace('      kill -0 "$PARENT" 2>/dev/null || exit 0\n      node', '      node');
    fs.writeFileSync(f, src2);
    assert.equal(await fn(f), false);
  });
}
