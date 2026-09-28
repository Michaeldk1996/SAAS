#!/usr/bin/env node
// TEN-329 (founder 2026-09-28, fix-first item 2): the reconcile suite also runs against the
// store the pipeline JUST BUILT, before the upload. `npm test` runs before the build and reads
// the DEPLOYED store, so it passed on run 5201, which then published TEN-313's rebuilt walkover
// records; runs 5203-5207 went red on data already live. This locks the three pieces:
//   1. tools/deployed-store.js reads PP2_BUILT_STORE from disk (no Pages, no .deployed-cache);
//   2. tools/test-pp2-reconcile.js fails closed on a built store it cannot fully read;
//   3. pipeline.yml runs it on _site/ after assembly and before the upload / commit-backs.
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); } };

// ── a minimal built store: one player, one tournament shard, NO career-history/ ──────────
const KEY = 'zz329';                        // not a real player key: nothing on Pages or in ROOT answers it
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten329-'));
const built = path.join(tmp, 'site');
fs.mkdirSync(path.join(built, 'tournament-history'), { recursive: true });
const profile = { key: KEY, name: 'T. Builtstore', recentForm: { matches: [] }, careerByYear: [] };
fs.writeFileSync(path.join(built, 'player-profiles.json'),
  JSON.stringify({ fetchedAt: '2026-09-28T00:00:00.000Z', players: { [KEY]: profile } }));
fs.writeFileSync(path.join(built, 'tournament-history-index.json'), JSON.stringify({ players: { [KEY]: { n: 1, m: 1 } } }));
fs.writeFileSync(path.join(built, 'tournament-history', KEY + '.json'), JSON.stringify({ tournamentHistory: [
  { name: 'Builtstore Open', won: 1, lost: 0, editions: [{ year: 2026, matches: [{ res: 'W', round: 'R32' }] }] }] }));
const empty = path.join(tmp, 'empty');
fs.mkdirSync(empty);

// Each probe runs in a child: BUILT_DIR is read once, at require time.
function storeProbe(dir, body) {
  const r = spawnSync(process.execPath, ['-e', `const D = require(${JSON.stringify(path.join(ROOT, 'tools/deployed-store.js'))});\n${body}`],
    { env: { ...process.env, PP2_BUILT_STORE: dir }, encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) throw new Error('probe exited ' + r.status + ': ' + (r.stderr || '').slice(0, 300));
  return JSON.parse(r.stdout.trim().split('\n').pop());
}
function suite(dir) {
  return spawnSync(process.execPath, [path.join(ROOT, 'tools/test-pp2-reconcile.js')],
    { env: { ...process.env, PP2_BUILT_STORE: dir }, encoding: 'utf8', timeout: 300000 });
}

// Mutation: drop the `if (BUILT_DIR)` branch in fetchText → the store comes from Pages (or the
// <1h .deployed-cache the pre-build step left) → no zz329, hundreds of real players, source 'deployed'.
check('deployed-store: PP2_BUILT_STORE reads the built player-profiles.json, labelled built', () => {
  const o = storeProbe(built, `const s = D.playerProfiles(); console.log(JSON.stringify({ source: s.source, keys: Object.keys(s.players) }));`);
  assert.deepStrictEqual(o, { source: 'built', keys: [KEY] });
});
// Mutation: restore `const dir = opts.dir || path.join(ROOT, 'tournament-history')` → ROOT holds
// no zz329 shard, so hydrate "fetches" it and writes the built shard INTO ROOT/tournament-history.
check('deployed-store: tournament history attaches from the BUILT shards, not ROOT/tournament-history', () => {
  const leak = path.join(ROOT, 'tournament-history', KEY + '.json');
  const o = storeProbe(built, `const s = D.playerProfiles(); const r = D.hydrateTournamentHistory(s.players);
    console.log(JSON.stringify({ indexed: r.indexed, attached: r.attached, rows: r.tournamentRows, name: s.players['${KEY}'].tournamentHistory[0].name }));`);
  const leaked = fs.existsSync(leak);
  if (leaked) fs.unlinkSync(leak);
  assert.deepStrictEqual(o, { indexed: 1, attached: 1, rows: 1, name: 'Builtstore Open' });
  assert.ok(!leaked, 'built mode wrote a shard into ROOT/tournament-history');
});
// Mutation: drop the `if (BUILT_DIR)` branch in fetchShards → a shard missing from the build is
// curled from Pages. '207' is a real deployed shard, so the mutant attaches it from the LIVE site
// and the gap in the build is papered over (needs network to go red; the guarded path never does).
check('deployed-store: a shard missing from the build stays missing (never fetched from Pages)', () => {
  const dir2 = path.join(tmp, 'site2');
  fs.mkdirSync(path.join(dir2, 'tournament-history'), { recursive: true });
  fs.writeFileSync(path.join(dir2, 'tournament-history-index.json'), JSON.stringify({ players: { '207': { n: 1, m: 1 } } }));
  const o2 = storeProbe(dir2, `const r = D.hydrateTournamentHistory({ '207': {} });
    console.log(JSON.stringify({ indexed: r.indexed, attached: r.attached, missing: r.missing }));`);
  assert.deepStrictEqual(o2, { indexed: 1, attached: 0, missing: ['207'] });
});

// Mutation: make playerProfiles() label its committed-fossil fallback 'built' (or drop the
// source check in the suite) → the suite runs on the 2026-07-22 committed store and never
// prints this line.
check('reconcile suite: an empty built dir aborts before any check (fail-closed)', () => {
  const r = suite(empty);
  assert.strictEqual(r.status, 1, 'exit ' + r.status);
  assert.ok(/COULD NOT READ THE BUILT player-profiles\.json — ABORTING/.test(r.stderr), r.stderr.slice(0, 300));
  assert.ok(!/ PASS  /.test(r.stdout), 'a check ran on a store that was never read');
});
// Mutation: delete the `if (BUILT && CH_DRIFT.state !== 'fresh')` block → the 19 career-history
// checks SKIP and the run reports on the rest, as the pre-build run always did.
check('reconcile suite: a built store without career-history/ aborts instead of SKIPping', () => {
  const r = suite(built);
  assert.strictEqual(r.status, 1, 'exit ' + r.status);
  assert.ok(/BUILT career-history\/ is absent — the per-match checks cannot run; ABORTING/.test(r.stderr), r.stderr.slice(0, 300));
  assert.ok(!/ SKIP  /.test(r.stdout), 'a check SKIPped inside the publish gate');
});

// ── the workflow wiring ──────────────────────────────────────────────────────
const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
// A step runs from its `- name:` to the next one; the comment block that heads the NEXT step is cut off.
const steps = yml.split(/\n(?=      - name: )/).map((s) => ({ name: (/^\s*- name: (.*)/m.exec(s) || [])[1] || '', body: s.replace(/\n\s*\n(\s*#[^\n]*\n?)*\s*$/, '') }));
const at = (re) => steps.findIndex((s) => re.test(s.name));
const gate = at(/^Reconcile suite on the freshly built store/);
// Mutation: delete the step, or drop PP2_BUILT_STORE=_site from it (→ it re-reads the DEPLOYED store).
check('pipeline: the gate step runs the reconcile suite on _site/', () => {
  assert.ok(gate > -1, 'no built-store gate step');
  assert.ok(/\n\s+run: PP2_BUILT_STORE=_site node tools\/test-pp2-reconcile\.js\s*$/.test(steps[gate].body), steps[gate].body.slice(-200));
});
// Mutation: add `continue-on-error: true`, an `if:` or `|| true` to the step → a red gate publishes.
check('pipeline: the gate cannot be stepped over', () => {
  assert.ok(!/continue-on-error|^\s+if:|\|\|/m.test(steps[gate].body), 'the gate step is soft');
});
// Mutation: move the step below "Upload Pages artifact" (or above "Assemble site").
check('pipeline: the gate sits after the site is assembled and before anything publishes or commits back', () => {
  const assemble = at(/^Assemble site$/), complete = at(/^Assert site completeness$/);
  const upload = at(/^Upload Pages artifact$/), deploy = at(/^Deploy to GitHub Pages$/);
  const commitbacks = steps.map((s, i) => (/commitback-push\.sh/.test(s.body) ? i : -1)).filter((i) => i > -1);
  assert.ok(assemble > -1 && complete > -1 && upload > -1 && deploy > -1 && commitbacks.length, 'anchor steps not found');
  assert.ok(gate > assemble && gate > complete, `gate #${gate} runs before the site is assembled (#${assemble})`);
  assert.ok(gate < upload && gate < deploy, `gate #${gate} runs after the upload (#${upload})`);
  assert.ok(commitbacks.every((i) => i > gate), `a commit-back runs before the gate: #${commitbacks.join(',')}`);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nTEN-329 built-store gate: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
