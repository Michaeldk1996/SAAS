#!/usr/bin/env node
// Mutation harness for verify-r8.mjs. Each mutant reintroduces a specific way of
// breaking the `keep-as-is` + `footnote-tour-only` rulings. A mutant that scores
// clean means the probe cannot see that defect.
//
// THREE THINGS THIS HARNESS LEARNED THE HARD WAY, ALL ON ITS OWN FIRST RUN:
//  · It mutates a file in place, so TWO CONCURRENT RUNS CORRUPT IT. One run's
//    "restore" writes back an ORIG it read while the other had a mutation live,
//    and every later mutant silently compares against a poisoned baseline. The
//    first run of this file did exactly that (a timed-out foreground run kept
//    going while a second was started) and reported 4 caught / 3 missed, all
//    meaningless. Hence the lock file below, and the git-clean precondition.
//  · A probe that THROWS is not a probe that passed or failed. Reporting a crash
//    as "survived" hides a mutant that broke the page outright — the worst class.
//    Crash is now its own verdict.
//  · A mutation that does not apply is INERT and proves nothing. Asserted, not
//    reported as a result.
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';

const HERE = path.dirname(new globalThis.URL(import.meta.url).pathname);
const ROOT = path.join(HERE, '..');
const FILE = path.join(ROOT, 'bsp-consult-dashboard.html');
const LOCK = path.join(HERE, '.mutate.lock');

try { fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); }
catch { console.error(`another mutation run holds ${LOCK} (pid ${fs.readFileSync(LOCK,'utf8')}). Refusing to race on ${FILE}.`); process.exit(2); }
const release = () => { try { fs.unlinkSync(LOCK); } catch {} };
process.on('exit', release); process.on('SIGINT', () => { release(); process.exit(130); });

// Precondition: the subject must be pristine, or ORIG is already poisoned.
const dirty = execSync(`git -C ${JSON.stringify(ROOT)} status --porcelain -- bsp-consult-dashboard.html`, { encoding: 'utf8' }).trim();
if (dirty) { console.error(`bsp-consult-dashboard.html is not clean:\n${dirty}\nRestore it before mutating.`); process.exit(2); }
const ORIG = fs.readFileSync(FILE, 'utf8');

const MUTANTS = [
  // The headline regression: a later run conforms the page to CHARTS.md §8.
  // Faithful to the shape the rejected round-7 build actually had — one constant
  // at MODULE scope, read by both paths.
  ['M1 full §8 conformance — one shared module-scope ladder, both paths', s => s
     .replace("  var COL_FAV='#5b9bff'", "  var STEP_LADDER=[10,25,50,100,250,500,1000,2500];\n  var COL_FAV='#5b9bff'")
     .replace('var STEPS=[10,25,50,100,250,500,1000,2500,5000];', 'var STEPS=STEP_LADDER;')
     .replace('var PSTEPS=[1,2,5,10,20,25,50,100];', 'var PSTEPS=STEP_LADDER;')],
  ['M2 Players alone conformed to §8 (Tour untouched)', s => s
     .replace('var PSTEPS=[1,2,5,10,20,25,50,100];', 'var PSTEPS=[10,25,50,100,250,500,1000,2500];')],
  // DOM-INVISIBLE by measurement: widest span over all 64,003 non-empty views is
  // 2,326.3u against the 25,000u this rung needs. Only the source lock can see it.
  ['M3 the 5000 rung deleted — DOM-invisible, source lock only', s => s
     .replace('var STEPS=[10,25,50,100,250,500,1000,2500,5000];', 'var STEPS=[10,25,50,100,250,500,1000,2500];')],
  // NEGATIVE CONTROL, flagged `expectPass`. `5e3 === 5000`: identical behaviour, no
  // defect. An earlier version of this harness counted it as a CAUGHT DEFECT, which
  // was a false positive dressed as a success — and it fired S1 (exact text) while
  // S6, written expressly to tolerate the respelling, passed, leaving S6 unreachable.
  // S1 now compares by value, so this must come back CLEAN.
  ['M4 the 5000 rung respelled 5e3 — NEGATIVE CONTROL, must NOT be flagged', s => s
     .replace('var STEPS=[10,25,50,100,250,500,1000,2500,5000];', 'var STEPS=[10,25,50,100,250,500,1000,2500,5e3];'), true],
  ['M5 seam footnote rendered on the Players card too (the clause-2 undo)', s => s
     .replace('    card.appendChild(pair);\n    return card;',
              "    card.appendChild(pair);\n    card.appendChild(el('div','db-seamfoot','Book change at '+M.seamSeason+' ('+esc(M.books[0])+' → '+esc(M.books[1])+', wider margin) — the step is a book artefact, not a market move.'));\n    return card;")],
  ['M6 Players rnd unified to the Tour formula', s => s
     .replace('rnd=Math.max(1, step/5);', 'rnd=Math.max(10, step/10);')],
  ['M7 off-by-one at the bottom of the Players label loop', s => s
     .replace('var grid=[]; for(var v=Math.floor(hi/step)*step; v>=lo; v-=step)', 'var grid=[]; for(var v=Math.floor(hi/step)*step; v>lo; v-=step)')],
  // FOUND BY CLEAN-CONTEXT REVIEW, and it scored a clean 59/59 against the previous
  // card-scoped probe. This — not M5 — is the likeliest undo of `footnote-tour-only`:
  // a later run "restoring the missing seam note" puts it on the PAGE, beside
  // renderFootnote(body), not inside the chart card. M5 only covers the card.
  ['M8 seam footnote on the Players PAGE BODY (the undo the card-scoped probe missed)', s => s
     .replace('  // ---------- footnote (S1) + disclaimer ----------',
              "  function __seamOnBody(body){ body.appendChild(el('div','db-seamfoot','Book change at '+M.seamSeason+' ('+esc(M.books[0])+' → '+esc(M.books[1])+', wider margin) — the step is a book artefact, not a market move.')); }\n  // ---------- footnote (S1) + disclaimer ----------")
     .replace('    body.appendChild(el(\'div\',\'db-disclaimer\'', '    __seamOnBody(body);\n    body.appendChild(el(\'div\',\'db-disclaimer\'')],
];

let caught = 0; const missed = [], inert = [], falsePos = [];
for (const [name, fn, expectPass] of MUTANTS) {
  const mutated = fn(ORIG);
  if (mutated === ORIG) { inert.push(name); console.log(`${name}\n   !! INERT — the mutation did not apply. Not a result; fix the mutant.\n`); continue; }
  fs.writeFileSync(FILE, mutated);
  let out = '', crashed = false;
  try { out = execFileSync('node', [path.join(HERE, 'verify-r8.mjs')], { encoding: 'utf8', timeout: 180000 }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  finally { fs.writeFileSync(FILE, ORIG); }

  const m = /(\d+) assertions, (\d+) pass, (\d+) fail/.exec(out);
  if (!m) crashed = true;
  const failed = m ? Number(m[3]) : 0;
  // Failure names come out of the FAILURES block only, one per entry, taking the
  // first line of each (the entry is three lines: name / got / want).
  const block = out.split('FAILURES:\n')[1] || '';
  const names = block.split('\n').filter(l => l && !/^\s/.test(l) && !/^console errors/.test(l)).slice(0, 4);

  if (expectPass) {
    if (crashed || failed > 0) { falsePos.push(name); console.log(`${name}\n   >>> FALSE POSITIVE — a behaviourally identical build was flagged (${failed} fail):\n     - ${names.join('\n     - ')}\n`); }
    else console.log(`${name}\n   CLEAN as required — ${m[0]}\n`);
    continue;
  }
  if (crashed) { caught++; console.log(`${name}\n   CAUGHT (the probe could not complete — the mutant breaks the page)\n     ${out.trim().split('\n').slice(0,2).join(' / ')}\n`); }
  else if (failed > 0) { caught++; console.log(`${name}\n   CAUGHT — ${failed} of ${m[1]} assertions fail:\n     - ${names.join('\n     - ')}\n`); }
  else { missed.push(name); console.log(`${name}\n   >>> SURVIVED ${m[0]} — THE PROBE IS BLIND TO THIS\n`); }
}
const defects = MUTANTS.filter(x => !x[2]).length;
console.log(`${defects} defect mutants, ${caught} caught, ${missed.length} survived; ${MUTANTS.length - defects} negative control, ${falsePos.length} false positive; ${inert.length} inert`);
if (missed.length) console.log('SURVIVED: ' + missed.join('; '));
if (falsePos.length) console.log('FALSE POSITIVE: ' + falsePos.join('; '));
if (inert.length) console.log('INERT: ' + inert.join('; '));
process.exit(missed.length || inert.length || falsePos.length ? 1 : 0);
