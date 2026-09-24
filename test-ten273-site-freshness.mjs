// TEN-273 item 4 — site-freshness alarm. Each founder condition is driven
// through the real assessFreshness() with GitHub-shaped inputs (compare API
// commits oldest-first, workflow_runs rows), and the 30-min boundary is tested
// from both sides so a mutant threshold turns a case red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessFreshness, FRESHNESS_MAX_BEHIND_MIN } from './tools/check-site-freshness.mjs';

const MIN = 60 * 1000;
const NOW = Date.parse('2026-09-25T12:00:00Z');
const LIVE = { commit: 'a'.repeat(40), builtAt: '2026-09-25T11:00:00Z' };
const ago = (m) => new Date(NOW - m * MIN).toISOString();
const commit = (sha, minAgo, msg = 'TEN-1 code change') => ({ sha: sha.repeat(40).slice(0, 40), commit: { message: msg, committer: { date: ago(minAgo) } } });
const ahead = (...cs) => ({ status: 'ahead', ahead_by: cs.length, commits: cs });
// GitHub's shape on this repo: run_started_at is set at creation (pending time
// included) even for a queued run; jobStartedAt is what the CLI reads from the
// jobs API for an in_progress run.
const run = (n, status, createdMin, jobStartedMin) => ({ run_number: n, status, created_at: ago(createdMin),
  run_started_at: ago(createdMin), jobStartedAt: jobStartedMin == null ? undefined : ago(jobStartedMin),
  html_url: `https://github.com/x/actions/runs/${n}` });

test('the limit is one constant: 30 minutes', () => {
  assert.equal(FRESHNESS_MAX_BEHIND_MIN, 30);
});

test('red: behind > 30 min and no pipeline run at all (missing) — names live, waiting and "none"', () => {
  const r = assessFreshness({ now: NOW, live: LIVE, compare: ahead(commit('b', 41, 'TEN-9 fix the card'), commit('c', 5)), runs: [] });
  assert.equal(r.red, true);
  assert.equal(r.reason, 'run-missing');
  assert.match(r.message, /live aaaaaaaa/);
  assert.match(r.message, /waiting bbbbbbbb "TEN-9 fix the card"/);
  assert.match(r.message, /no pipeline run is queued or running/);
});

test('red: behind > 30 min while a run is queued — names the stuck run', () => {
  const r = assessFreshness({ now: NOW, live: LIVE, compare: ahead(commit('b', 35)),
    runs: [run(4700, 'queued', 20), run(4699, 'in_progress', 50, 49)] });
  assert.equal(r.red, true);
  assert.equal(r.reason, 'run-queued');
  assert.match(r.message, /stuck run #4700 queued since/);
  assert.match(r.message, /runs\/4700/);
});

test('red: the only in_progress run started BEFORE the waiting commit landed — it cannot carry it', () => {
  const r = assessFreshness({ now: NOW, live: LIVE, compare: ahead(commit('b', 40)), runs: [run(4699, 'in_progress', 45, 44)] });
  assert.equal(r.red, true);
  assert.equal(r.reason, 'run-missing');
  assert.match(r.message, /#4699 in_progress since .* started before the commit landed/);
});

test('green: behind > 30 min but a run that started after the commit is in progress (deploy in flight)', () => {
  const r = assessFreshness({ now: NOW, live: LIVE, compare: ahead(commit('b', 40)), runs: [run(4701, 'in_progress', 38, 36)] });
  assert.equal(r.red, false);
  assert.equal(r.reason, 'deploy-in-flight');
});

test('boundary: 29.9 min behind with nothing queued stays green; 30.1 goes red', () => {
  const below = assessFreshness({ now: NOW, live: LIVE, compare: ahead(commit('b', 29.9)), runs: [] });
  const above = assessFreshness({ now: NOW, live: LIVE, compare: ahead(commit('b', 30.1)), runs: [] });
  assert.equal(below.red, false);
  assert.equal(above.red, true);
});

test('the WAITING commit is the oldest unshipped one, not the tip', () => {
  // The tip is 2 min old; the oldest unshipped commit is 45 min old. Measuring
  // the tip would stay green forever on a busy main.
  const r = assessFreshness({ now: NOW, live: LIVE, compare: ahead(commit('b', 45), commit('c', 20), commit('d', 2)), runs: [] });
  assert.equal(r.red, true);
  assert.ok(r.behindMin > 44 && r.behindMin < 46);
  assert.match(r.message, /waiting bbbbbbbb/);
  assert.match(r.message, /tip dddddddd/);
});

test('green: live is the tip', () => {
  assert.equal(assessFreshness({ now: NOW, live: LIVE, compare: { status: 'identical', ahead_by: 0, commits: [] } }).red, false);
});

test('a run created BEFORE the commit but whose job started AFTER it carries it (run_started_at is creation time)', () => {
  // Created 45 min ago and pending behind the group; its job re-pointed 35 min ago, after the 40-min-old commit.
  const r = assessFreshness({ now: NOW, live: LIVE, compare: ahead(commit('b', 40)), runs: [run(4702, 'in_progress', 45, 35)] });
  assert.equal(r.red, false);
  assert.equal(r.reason, 'deploy-in-flight');
});

test('an in_progress run whose job start is unknown is not counted as carrying the commit', () => {
  const r = assessFreshness({ now: NOW, live: LIVE, compare: ahead(commit('b', 40)), runs: [run(4703, 'in_progress', 20, null)] });
  assert.equal(r.red, true);
});

test('undeterminable states are red, never a pass', () => {
  assert.equal(assessFreshness({ now: NOW, live: { commit: 'unknown' }, compare: null }).red, true);
  assert.equal(assessFreshness({ now: NOW, live: LIVE, compare: { status: 'diverged', ahead_by: 3, commits: [] } }).red, true);
  assert.equal(assessFreshness({ now: NOW, live: LIVE, compare: { status: 'ahead', ahead_by: 3, commits: [] } }).red, true);
  assert.equal(assessFreshness({ now: NOW, live: LIVE, compare: { status: 'behind', ahead_by: 0, behind_by: 2, commits: [] } }).red, true, 'live ahead of main (rewound main) is not "current"');
  const noDate = { sha: 'e'.repeat(40), commit: { message: 'x', committer: { date: 'not a date' } } };
  assert.equal(assessFreshness({ now: NOW, live: LIVE, compare: ahead(noDate), runs: [] }).red, true, 'an unparseable commit date is not "within limit"');
});
