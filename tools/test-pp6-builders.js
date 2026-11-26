#!/usr/bin/env node
// tools/test-pp6-builders.js — founder 2026-11-26: the point-by-point builders carry a Last 52 weeks window.
//   build-situational.js writes per player `w52` (+ pooled `tour52`) next to the 24-month rows
//   build-holdbreak.js writes holdbreak-52w.json beside holdbreak.json (same shape, the 24-month roster)
// Fixture: three real api-tennis rows of one player (tools/fixtures/pp6/hb-cache), dated 22 Oct 2024, 3 Oct 2025 and
// 19 Oct 2026 — the anchor is the newest, so all three are in the 24 months and only the last in the 52 weeks.
// CONTROL: the same fixture without the 52-week node (the pre-ruling builders) has nothing to read on Last 52 weeks.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..'), CACHE = path.join(__dirname, 'fixtures', 'pp6', 'hb-cache');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp6-builders-'));
let fails = 0;
const check = (name, fn) => { try { fn(); console.log('  PASS  ' + name); } catch (e) { fails++; console.log('  FAIL  ' + name + ' :: ' + e.message); } };
const run = (script, env) => execFileSync(process.execPath, [path.join(ROOT, script)], { env: Object.assign({}, process.env, env), stdio: 'pipe' });

run('build-situational.js', { SITUATIONAL_CACHE_DIR: CACHE, SITUATIONAL_OUT: path.join(tmp, 'situational.json') });
const sit = JSON.parse(fs.readFileSync(path.join(tmp, 'situational.json'), 'utf8'));
check('situational · 24 months holds 3 matches, the w52 node 1, pooled tour52 beside tour', () => {
  const pl = sit.players['2848'];
  assert(pl, 'player 2848 missing');
  assert.strictEqual(pl.matches, 3, '24-month matches');
  assert(pl.w52 && pl.w52.matches === 1, 'w52 node: ' + JSON.stringify(pl.w52 && pl.w52.matches));
  assert(sit.tour52 && Object.keys(sit.tour52).length === sit.meta.rows.length, 'tour52');
  assert.strictEqual(sit.meta.w52Start, '2025-10-20', 'the 52-week start is 364 days before the anchor');
  const n = r => r.w + r.l;
  sit.meta.rows.forEach(id => assert(n(pl.w52.rows[id]) <= n(pl.rows[id]), id + ': the 52-week count exceeds the 24-month one'));
  assert(sit.meta.rows.some(id => n(pl.w52.rows[id]) < n(pl.rows[id])), 'vacuous: the two windows agree on every row');
});
check('situational · written atomically (no .tmp left beside it)', () => assert(!fs.existsSync(path.join(tmp, 'situational.json.tmp'))));

run('build-holdbreak.js', { HOLDBREAK_CACHE_DIR: CACHE, HOLDBREAK_OUT: path.join(tmp, 'holdbreak.json'), HOLDBREAK_OUT_52W: path.join(tmp, 'holdbreak-52w.json') });
check('holdbreak · a 52-week sibling: 1 match in it, 3 in the 24-month shard, same shape', () => {
  const a = JSON.parse(fs.readFileSync(path.join(tmp, 'holdbreak.json'), 'utf8'));
  const b = JSON.parse(fs.readFileSync(path.join(tmp, 'holdbreak-52w.json'), 'utf8'));
  assert.strictEqual(a.meta.coverage.matches, 3, '24 months');
  assert.strictEqual(b.meta.coverage.matches, 1, '52 weeks');
  assert.strictEqual(b.meta.windowWeeks, 52);
  assert.deepStrictEqual(Object.keys(b.pooled.serve), Object.keys(a.pooled.serve), 'surface nodes');
  Object.keys(b.players).forEach(k => assert(a.players[k], k + ' is in the 52-week shard but not the 24-month roster'));
});
// CONTROL: the builder as it was before the ruling (the last commit that lacks the w52 node) must fail the w52 check.
check('CONTROL · the pre-ruling build-situational.js gives no w52 node', () => {
  let src;
  try { src = execFileSync('git', ['log', '-1', '--format=%H', '-S', 'w52Start', '--', 'build-situational.js'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch (e) { src = ''; }
  const base = src ? src + '^' : 'HEAD';
  let old;
  try { old = execFileSync('git', ['show', base + ':build-situational.js'], { cwd: ROOT, encoding: 'utf8' }); } catch (e) { old = null; }
  if (!old || /w52Start/.test(old)) { console.log('        SKIP (no pre-ruling copy in this history) — not a pass'); return; }
  const oldPath = path.join(tmp, 'old-build-situational.js');
  fs.writeFileSync(oldPath, old);
  execFileSync(process.execPath, [oldPath], { env: Object.assign({}, process.env, { SITUATIONAL_CACHE_DIR: CACHE, SITUATIONAL_OUT: path.join(tmp, 'old.json') }), stdio: 'pipe' });
  const o = JSON.parse(fs.readFileSync(path.join(tmp, 'old.json'), 'utf8'));
  assert(!o.players['2848'].w52 && !o.tour52, 'the pre-ruling builder already wrote a w52 node');
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
