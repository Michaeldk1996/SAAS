#!/usr/bin/env node
'use strict';
// A PASSING TEST MUST NOT ANNOTATE THE RUN.
//
// tools/test-match-stats-store.js drives freeze() through every refusal path on
// purpose — that is the point of it. Each refusal printed a real
// `::error title=match-stats floor refused::…`, and GitHub turns those into
// annotations on the WORKFLOW RUN, not on the test. Measured on run 3761, a
// fully GREEN deploy: six failure-level annotations, with fixture keys showing
// through as "1 eventKey(s) ... are MISSING from the live store (e.g. b)".
//
// That is worse than log noise. A genuine floor refusal would have been the
// seventh red line under a heading that already had six, on a run that says
// "success" — the founder's "the warning must never become wallpaper", arrived
// at from the other direction.
//
// This guard runs the suite as a CHILD PROCESS and asserts the real thing: a
// green run emits no annotations. A source grep would not have caught the second
// emitter, which is what leaked after the first was fixed.

const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SUITE = path.join(__dirname, 'test-match-stats-store.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
}

function run(env) {
  const r = spawnSync(process.execPath, [SUITE], {
    cwd: ROOT,
    env: Object.assign({}, process.env, env || {}),
    encoding: 'utf8',
  });
  return (r.stdout || '') + (r.stderr || '');
}

console.log('\nCI annotation noise\n');

const out = run();

check('the match-stats suite passes (or the checks below are meaningless)', () => {
  assert.match(out, /checks passed/, `the suite did not report success:\n${out.slice(-400)}`);
});

check('a passing run emits NO workflow annotations', () => {
  const hits = out.split('\n').filter((l) => /^::(error|warning|notice)\b/.test(l.trim()));
  assert.deepStrictEqual(hits, [],
    `a green run annotated the workflow ${hits.length} time(s):\n  ${hits.slice(0, 6).join('\n  ')}`);
});

// ── the control: the annotation channel must still WORK ─────────────────────
// Suppression that could not be turned off would be a guard quietly disabled
// rather than a guard kept quiet under test. This drives the MODULE, not the
// suite: the suite sets the suppression flag itself at require time, so passing
// the env to it as a child proves nothing.
check('the annotation channel still fires when suppression is off', () => {
  const probe = `
    const fs=require('fs'),os=require('os'),path=require('path');
    delete process.env.MATCH_STATS_STORE_ANNOTATE;
    const s=require(${JSON.stringify(path.join(ROOT, 'tools/match-stats-store.js'))});
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'msann-'));
    const SHEET={p1:{'Service:Aces':'5'},p2:{'Service:Aces':'3'}};
    fs.writeFileSync(path.join(root,s.FLOOR),JSON.stringify({a:{matchStats:SHEET},b:{matchStats:SHEET}}));
    fs.writeFileSync(path.join(root,s.PLAIN),JSON.stringify({a:{matchStats:SHEET}}));
    s.freeze(root);
  `;
  const r = spawnSync(process.execPath, ['-e', probe], { cwd: ROOT, encoding: 'utf8' });
  const outp = (r.stdout || '') + (r.stderr || '');
  const hits = outp.split('\n').filter((l) => /^::(error|warning)\b/.test(l.trim()));
  assert.ok(hits.length > 0,
    `with suppression off the module emitted no annotation at all — the channel is dead, not quiet:\n${outp.slice(-300)}`);
  assert.match(hits.join('\n'), /title=match-stats floor/,
    'the annotation fired but not from the floor guard');
});

// ── every emitter goes through the one channel ──────────────────────────────
check('the module writes a "::" workflow command in exactly one place', () => {
  const src = require('fs').readFileSync(path.join(ROOT, 'tools/match-stats-store.js'), 'utf8');
  // Code lines only: the note on refuse() quotes "::error" in prose, and a
  // comment edit must not move this count.
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  // annotate() builds the level dynamically, so match the template opener as
  // well as a literal level — matching only the literal is what made this read
  // zero emitters after annotate() was introduced.
  const emitters = (code.match(/`::(\$\{|error|warning|notice)/g) || []).length;
  assert.strictEqual(emitters, 1,
    `${emitters} place(s) write a workflow command directly — route them all through annotate(), ` +
    'or the next one leaks the way "floor unreadable" and "live store unreadable" both did');
});

console.log(`\nCI annotation noise: ${pass} pass, ${fail} fail`);
if (fail) { console.error(`FAILED: ${fail} check(s)`); process.exit(1); }
