'use strict';

/**
 * run.js — CLI to run the green H2H model against a real matches.json record
 * and print a readable review of every stage. No UI, no side effects.
 *
 * Usage:
 *   node h2h-model/run.js                 # runs on the first upcoming match
 *   node h2h-model/run.js <matchId>       # e.g. upcoming-12147452
 *   node h2h-model/run.js <p1> <p2>       # fuzzy name match, e.g. Kopriva Buse
 *   node h2h-model/run.js --list [n]      # list first n match ids
 *   node h2h-model/run.js --json <id>     # dump raw structured output
 *   node h2h-model/run.js --subj <id> <s> # apply subjective signal s in [-1,1]
 *   node h2h-model/run.js --summary <id>  # also generate the Stage 4 AI summary
 *                                         # (needs ANTHROPIC_API_KEY; no-ops without)
 */

const data = require('./data');
const { runModel } = require('./model');

const matches = data.load('matches.json');
// `--summary` is a position-independent boolean flag; strip it before parsing.
const rawArgs = process.argv.slice(2);
const wantSummary = rawArgs.includes('--summary');
const args = rawArgs.filter(a => a !== '--summary');

function findMatch(a, b) {
  if (!a) return matches.find(m => /^upcoming/.test(m.id)) || matches[0];
  if (!b) return matches.find(m => m.id === a) ||
    matches.find(m => (m.p1 + ' ' + m.p2).toLowerCase().includes(a.toLowerCase()));
  const la = a.toLowerCase(), lb = b.toLowerCase();
  return matches.find(m =>
    (m.p1 + ' ' + m.p2).toLowerCase().includes(la) &&
    (m.p1 + ' ' + m.p2).toLowerCase().includes(lb));
}

// ---- list mode ----
if (args[0] === '--list') {
  const n = parseInt(args[1], 10) || 30;
  matches.slice(0, n).forEach(m =>
    console.log(`${m.id}\t${m.p1} vs ${m.p2}\t${m.surface}\t${m.tour}`));
  process.exit(0);
}

// ---- json / subjective flags ----
let subjectiveSignal;
let idArgs = args;
if (args[0] === '--subj') { subjectiveSignal = parseFloat(args[2]); idArgs = [args[1]]; }
const jsonMode = args[0] === '--json';
if (jsonMode) idArgs = args.slice(1);

const match = findMatch(idArgs[0], idArgs[1]);
if (!match) { console.error('No match found for:', idArgs.join(' ')); process.exit(1); }

const result = runModel(match, { subjectiveSignal });

if (jsonMode) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

// ---- pretty print ----
const bar = '\u2500'.repeat(64);
function pct(x) { return x == null ? ' n/a ' : (x * 100).toFixed(1).padStart(5) + '%'; }
function signIco(dir) { return dir === 'p1' ? '\u25b2 p1' : dir === 'p2' ? '\u25bc p2' : '  \u00b7 '; }

console.log(bar);
console.log(`  ${result.match.p1}  vs  ${result.match.p2}`);
console.log(`  ${result.match.tour} \u2014 ${result.match.round}`);
console.log(`  ${result.match.surface} \u00b7 Best of ${result.match.bestOf} \u00b7 ${result.match.id}`);
console.log(bar);

if (!result.ok) {
  console.log('  MODEL COULD NOT RUN:', result.reason);
  console.log('  p1 sources:', JSON.stringify(result.players.p1.sources));
  console.log('  p2 sources:', JSON.stringify(result.players.p2.sources));
  process.exit(0);
}

// players
for (const side of ['p1', 'p2']) {
  const pm = result.players[side];
  console.log(`  ${side.toUpperCase()} ${pm.name}  ELO ${pm.eloAll}  ${pm.archetype || 'unclassified'}`);
  const miss = Object.entries(pm.sources).filter(([, v]) => !v).map(([k]) => k);
  if (miss.length) console.log(`       missing sources: ${miss.join(', ')}`);
}
console.log(bar);

// Stage 1
const s1 = result.stage1;
console.log('  STAGE 1  Base probability from ELO');
const cc = s1.components;
console.log(`     ELO raw      ${pct(cc.eloRaw.p1)}  (w ${cc.eloRaw.weight})  ${cc.eloRaw.ratingP1} vs ${cc.eloRaw.ratingP2}`);
console.log(`     ELO surface  ${pct(cc.eloSurface.p1)}  (w ${cc.eloSurface.weight})  ${cc.eloSurface.ratingP1} vs ${cc.eloSurface.ratingP2}  [${cc.eloSurface.surfaceKey || 'n/a'}${cc.eloSurface.surfaceAvailable ? '' : ' fallback'}]`);
console.log(`     ELO 50/50    ${pct(cc.elo5050.p1)}  (w ${cc.elo5050.weight})`);
console.log(`     => base p1 ${pct(s1.baseP1)}   base p2 ${pct(s1.baseP2)}`);
if (s1.note) console.log(`     note: ${s1.note}`);
console.log(bar);

// Stage 2
console.log('  STAGE 2  Adjustments (delta to p1 probability)');
console.log('   #  layer                       dir    signal   deltaP1   conf   detail');
for (const a of result.stage2.adjustments) {
  const idc = String(a.id).padStart(2);
  const nm = a.name.padEnd(26).slice(0, 26);
  const dir = signIco(a.direction);
  const sig = a.applied ? a.signal.toFixed(2).padStart(6) : (a.gated ? ' gate ' : '   \u00b7  ');
  const dp = a.applied ? ((a.deltaP1 >= 0 ? '+' : '') + (a.deltaP1 * 100).toFixed(2) + '%').padStart(8) : '        ';
  const conf = (a.confidence || '').padEnd(4);
  console.log(`  ${idc}  ${nm} ${dir}  ${sig}  ${dp}  ${conf}  ${a.detail}`);
}
console.log(`     applied ${result.stage2.appliedCount}   gated ${result.stage2.gatedCount}   total deltaP1 ${(result.stage2.totalDeltaP1 * 100).toFixed(2)}%`);
console.log(`     => adjusted p1 ${pct(result.stage2.adjustedP1)}   adjusted p2 ${pct(result.stage2.adjustedP2)}`);
console.log(bar);

// Stage 3
const s3 = result.stage3;
console.log('  STAGE 3  Fair price & value');
console.log(`     Fair odds    p1 ${s3.fair.p1.odds}  (${pct(s3.fair.p1.prob)})    p2 ${s3.fair.p2.odds}  (${pct(s3.fair.p2.prob)})`);
if (s3.sharp) {
  console.log(`     Sharp (${s3.sharp.source})  price ${s3.sharp.price.p1}/${s3.sharp.price.p2}`);
  console.log(`        vig-free  p1 ${pct(s3.sharp.vigFreeProb.p1)}  p2 ${pct(s3.sharp.vigFreeProb.p2)}   edge p1 ${(s3.sharp.edge.p1 * 100).toFixed(1)}%  p2 ${(s3.sharp.edge.p2 * 100).toFixed(1)}%`);
} else {
  console.log('     Sharp: no Pinnacle line available.');
}
if (s3.soft) {
  console.log(`     Best price  p1 ${s3.soft.price.p1} (${s3.soft.book.p1})  p2 ${s3.soft.price.p2} (${s3.soft.book.p2})`);
}
if (s3.flags.length) {
  console.log('     VALUE FLAGS:');
  for (const f of s3.flags) {
    const who = f.side === 'p1' ? result.match.p1 : result.match.p2;
    console.log(`        \u2605 ${f.type}: ${who} @ ${f.price} (${f.book}) \u2014 edge +${f.edgePct}%`);
  }
} else {
  console.log('     No value flags at current thresholds.');
}
console.log(bar);

// pending warnings
console.log('  PENDING (warnings — to wire up next):');
for (const w of result.meta.pendingWarnings) {
  console.log(`     \u2022 [${w.id}] ${w.name} \u2014 ${w.reason}`);
}
console.log(bar);

// ---- Stage 4 (optional): AI match summary ----
if (wantSummary) {
  const { generateSummary } = require('./summary');
  console.log('  STAGE 4  AI match summary');
  generateSummary(result).then(s => {
    if (s.ok) {
      // wrap the summary to ~64 cols for the terminal
      const words = s.summary.split(/\s+/);
      let line = '    ';
      for (const w of words) {
        if ((line + w).length > 64) { console.log(line); line = '    '; }
        line += w + ' ';
      }
      if (line.trim()) console.log(line);
      if (s.usage) console.log(`     [${s.model} \u00b7 in ${s.usage.input_tokens} / out ${s.usage.output_tokens} tokens]`);
    } else {
      console.log(`     ${s.gated ? 'skipped' : 'error'}: ${s.reason}`);
    }
    console.log(bar);
  });
}
