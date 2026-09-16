#!/usr/bin/env node
/**
 * Proves tools/test-roster-gate.js is not vacuous, by MUTATING the artifact it
 * reads and requiring it to go red — not by reading it and agreeing with itself.
 *
 * Lesson this exists for (TEN-206, and the `<10%` gate before it): the rejected
 * roster-union branch shipped a gate whose negative controls were constant-folded
 * (`assert(137 >= 300)`), so they exercised the comparison operator and never the
 * predicate. Each mutant below changes the SUBJECT the gate inspects and names
 * which assertion must catch it; a mutant the gate survives is a failure here.
 *
 * Run: node tools/test-roster-gate-mutants.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const GATE = path.join(__dirname, 'test-roster-gate.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-gate-'));

const pipeline = require(path.join(REPO, 'bsp-pipeline.js'));
const { PROFILE_SCHEMA_VERSION } = pipeline;

// A synthetic, healthy pair: 320 players, every one with a career spine, every
// cache entry current-schema and freshly built. Above ROSTER_FLOOR (300) on
// purpose — so the floor assertion is live, not trivially satisfied.
const N = 320;
function healthy() {
  const players = {}, cache = {};
  for (let i = 0; i < N; i++) {
    const k = String(1000 + i);
    players[k] = { name: `P${i}`, careerByYear: [{ year: '2026', won: 1, lost: 0 }] };
    cache[k] = {
      builtAt: new Date().toISOString(), v: PROFILE_SCHEMA_VERSION,
      profile: { name: `P${i}`, careerByYear: [{ year: '2026', won: 1, lost: 0 }] },
    };
  }
  return { players, cache };
}

function runGate(players, cache) {
  const pPath = path.join(tmp, 'p.json');
  const cPath = path.join(tmp, 'c.json');
  fs.writeFileSync(pPath, JSON.stringify({ players }));
  fs.writeFileSync(cPath, JSON.stringify({ players: cache }));
  try {
    const out = execFileSync('node', [GATE, pPath, cPath], { encoding: 'utf8' });
    return { green: true, out };
  } catch (e) {
    return { green: false, out: (e.stdout || '') + (e.stderr || '') };
  }
}

let failures = 0;
function expect(label, green, wantGreen, out) {
  const ok = green === wantGreen;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — gate went ${green ? 'GREEN' : 'RED'}, expected ${wantGreen ? 'GREEN' : 'RED'}`);
  if (!ok) { failures++; console.log(out.split('\n').map(l => `        ${l}`).join('\n')); }
}

// 0. NEGATIVE CONTROL — the unmutated subject must pass. Without this, a gate that
//    is red on everything would "catch" all four mutants and prove nothing.
{
  const { players, cache } = healthy();
  const r = runGate(players, cache);
  expect('negative control: healthy roster', r.green, true, r.out);
}

// 1. SHELL INJECTED — assertion A (zero shells) must catch it.
{
  const { players, cache } = healthy();
  delete players['1007'].careerByYear;
  const r = runGate(players, cache);
  expect('mutant A: one published profile loses careerByYear', r.green, false, r.out);
}

// 2. ROSTER COLLAPSED — assertion B (floor) must catch it. This is the mutant the
//    "0 shells" rule alone CANNOT catch: an empty roster has zero shells.
{
  const { cache } = healthy();
  const r = runGate({}, cache);
  expect('mutant B: roster published empty (zero shells, zero players)', r.green, false, r.out);
}

// 3. GOOD PLAYER DROPPED — assertion C must catch it. Keeps the roster over the
//    floor and shell-free, so only the cache cross-check can see it.
{
  const { players, cache } = healthy();
  delete players['1009'];
  const r = runGate(players, cache);
  expect('mutant C: a publishable cache entry silently not published', r.green, false, r.out);
}

// 4. IMMUNE SUBJECT — a change the gate is not meant to notice must NOT flip it.
//    Guards against a gate so broad that any edit reds it, which would be equally
//    uninformative.
{
  const { players, cache } = healthy();
  players['1011'].name = 'renamed, still has a career spine';
  const r = runGate(players, cache);
  expect('immune subject: an unrelated field changes', r.green, true, r.out);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nMutation harness: ${failures === 0 ? 'GREEN' : `RED (${failures})`} — 5 subjects, 3 must be caught, 2 must not.`);
process.exit(failures === 0 ? 0 : 1);
