#!/usr/bin/env node
// TEN-196 round 7 — mutation test. A probe that scores clean against a broken
// build measures nothing. Each mutant reintroduces exactly one half of the ruling;
// the named assertion must fail, and the mutation must be CONFIRMED PRESENT in the
// served bytes before its score counts (a mutant that never reaches the page
// reads as "the probe missed it" in either direction).
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const F = 'bsp-consult-dashboard.html';
const orig = fs.readFileSync(F, 'utf8');

const MUTANTS = [
  { name: 'M1 · Players ladder reverted to [1,2,5,10,20,25,50,100]',
    apply: (s) => s.replace('var PSTEPS=STEP_LADDER;', 'var PSTEPS=[1,2,5,10,20,25,50,100];'),
    marker: 'var PSTEPS=[1,2,5,10,20,25,50,100];',
    expects: ['P·Khachanov K. main-panel labels', 'P·Sinner J. main-panel labels', 'S3', 'S5', 'S6'] },
  { name: 'M2 · the unlisted 5000 put back on the shared ladder',
    apply: (s) => s.replace('var STEP_LADDER=[10,25,50,100,250,500,1000,2500];', 'var STEP_LADDER=[10,25,50,100,250,500,1000,2500,5000];'),
    marker: '2500,5000]',
    expects: ['S1', 'S4'] },
  { name: 'M3 · seam footnote rendered on the Players card too',
    apply: (s) => s.replace(
      "    card.appendChild(pair);\n    return card;",
      "    card.appendChild(pair);\n    card.appendChild(el('div','db-seamfoot','Book change at 2026.'));\n    return card;"),
    marker: "el('div','db-seamfoot','Book change at 2026.')",
    expects: ['P·Khachanov K. renders NO seam footnote', 'P·Khachanov K. renders NO amber element'] },

  // ── the three a clean-context review found and the first probe did NOT catch ──
  // All three scored a clean 36 of 36 against the two-subject, prefix-matching
  // version. They are kept here permanently: each names a hole that was real.
  { name: 'M4 · Tour rnd unified onto the Players formula (the thing CLAUDE.md says MUST NOT happen)',
    apply: (s) => s.replace('rnd=Math.max(10, step/10);', 'rnd=Math.max(1, step/5);'),
    marker: 'rnd=Math.max(1, step/5);\n      hi = (isTourn',
    expects: ['S7'] },
  { name: 'M5 · off-by-one at the bottom of the Players label loop (57 panels left with an EMPTY axis)',
    apply: (s) => s.replace("var grid=[]; for(var v=Math.floor(hi/step)*step; v>=lo; v-=step)",
                            "var grid=[]; for(var v=Math.floor(hi/step)*step; v>lo; v-=step)"),
    marker: 'v>lo; v-=step)',
    // Michelsen is IMMUNE to this one and the first run proved it: his axis is the
    // bare "0", and 0 > lo, so the off-by-one never reaches him. Murray is the
    // subject the bug can move.
    expects: ['P·Murray A.'] },
  { name: 'M6 · the removed rung put back at the use site, spelled 5e3',
    apply: (s) => s.replace('var STEPS=STEP_LADDER;', 'var STEPS=STEP_LADDER.concat([5e3]);'),
    marker: 'STEP_LADDER.concat([5e3])',
    expects: ['S2', 'S4b'] },
];

let allGood = true;
for (const m of MUTANTS) {
  const mutated = m.apply(orig);
  if (mutated === orig) { console.log(`${m.name}\n  SKIPPED — the mutation did not apply, so it measures nothing.\n`); allGood = false; continue; }
  fs.writeFileSync(F, mutated);
  let out = '';
  // Retry once: the probe binds port 8199 for its own http server, and a previous
  // mutant's server can still hold it for a moment. A run that dies on EADDRINUSE
  // produces no score line, which reads as "the probe missed it" — the same false
  // negative this whole file exists to prevent. Diagnostics are printed either way.
  for (let attempt = 0; attempt < 2; attempt++) {
    try { out = execSync('node verify-r7.mjs 2>&1', { encoding: 'utf8', maxBuffer: 1 << 24 }); }
    catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
    if (/^\d+ assertions/m.test(out)) break;
    execSync('sleep 3');
  }
  fs.writeFileSync(F, orig);
  if (!/^\d+ assertions/m.test(out))
    console.log(`  !! probe produced no score line (${out.length} bytes). tail: ${out.slice(-300).replace(/\n/g, ' ')}`);

  // confirm the mutation reached the served file, not just the disk
  const present = mutated.includes(m.marker);
  const line = (out.match(/^\d+ assertions.*$/m) || ['(no score line)'])[0];
  const failed = out.split('\n').filter((l) => /^[A-Z]\d|^P·|^T\d|^TN·/.test(l.trim()) && /got=/.test(l));
  const caught = m.expects.filter((e) => failed.some((f) => f.includes(e)));
  const good = present && caught.length > 0;
  if (!good) allGood = false;
  console.log(`${m.name}`);
  console.log(`  mutation present in file: ${present}`);
  console.log(`  ${line}`);
  console.log(`  failing assertions: ${failed.length ? failed.map((f) => f.trim().split('  ')[0]).join(', ') : '(none)'}`);
  console.log(`  ${good ? 'CAUGHT' : '*** NOT CAUGHT — the assertion is decoration ***'}\n`);
}
console.log(allGood ? 'every mutant was caught by the assertion that names it.' : 'AT LEAST ONE MUTANT SURVIVED.');
process.exit(allGood ? 0 : 1);
