#!/usr/bin/env node
// "How it plays" — every check in tools/test-how-it-plays.js must FAIL when the behaviour it locks is reverted. Each
// mutant is applied to a copy of build-how-it-plays.js (written next to it, so its relative requires resolve) and the
// suite is run against it (HOWPLAYS_BUILDER); a mutant that leaves it green is a vacuous check and fails this runner.
// Anchors must occur exactly once.
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const FILE = 'build-how-it-plays.js';
const MUTANTS = [
  // formulas
  ['hold ignores break points saved', 'const held = sg - (bpf - bps);', 'const held = sg - bpf;'],
  ['1st won over all serve points', 'return { held, sg, fw, fi, sw, sp: svpt - fi, ace };', 'return { held, sg, fw, fi: svpt, sw, sp: svpt - fi, ace };'],
  ['2nd won over all serve points', 'return { held, sg, fw, fi, sw, sp: svpt - fi, ace };', 'return { held, sg, fw, fi, sw, sp: svpt, ace };'],
  ['aces of the winner only', 'ace: w.ace + l.ace }', 'ace: w.ace }'],
  ['a 6-7 set is not a tiebreak', 'tb: (s.p === 7 && s.o === 6) || (s.p === 6 && s.o === 7), nonStd: Math.max(s.p, s.o) >= 10 })) : null;\n  return { completed, partial: false',
    'tb: (s.p === 7 && s.o === 6), nonStd: Math.max(s.p, s.o) >= 10 })) : null;\n  return { completed, partial: false'],
  ['match tiebreak counted as a set', 'nonStd: Math.max(s.p, s.o) >= 10 })) : null;\n  return { completed, partial: false', 'nonStd: false })) : null;\n  return { completed, partial: false'],
  ['retirements counted (Sackmann)', 'const completed = !!score && ', 'const completed = true || '],
  ['box aces of one side', 'sp: a.sp + b.sp, ace: a.ace + b.ace }', 'sp: a.sp + b.sp, ace: a.ace }'],
  ['box tiebreak = reached 7-6 not 6-6', 'return +m[1] === 6 && +m[2] === 6;', 'return +m[1] === 7 && +m[2] === 6;'],
  // guard
  ['partial-stats guard off', 'pbpRegularGames(e) - sgTot >= PARTIAL_GAP', 'pbpRegularGames(e) - sgTot >= 99'],
  ['guard at a gap of 2', 'const PARTIAL_GAP = 3;', 'const PARTIAL_GAP = 2;'],
  ['partial count not carried (slice)', 'if (rec.partial) { S.partial++; return S; }', 'if (rec.partial) { return S; }'],
  ['partial count not carried (event)', 'excludedPartial: (past ? past.excludedPartial : 0) + (current ? current.excludedPartial : 0),', 'excludedPartial: 0,'],
  // completion
  ['Tennis-Data Retired ignored', "if (tdComment != null) completed = tdComment === 'Completed';", 'if (tdComment != null) completed = true;'],
  ['unknown status assumed complete', 'else completed = completedFromSets(perSetScores(e));', 'else completed = true;'],
  // population
  ['qualifying counted', '      if (isQualifying(ek, e, inp.qFlags)) { counts.qualifying++; continue; }\n', ''],
  ['Slams in', "const SLAM_RE = /\\b(australian open|french open|roland[\\s-]?garros|wimbledon|us open)\\b/i;", 'const SLAM_RE = /$^/;'],
  ['Finals in', 'const NON_BO3_RE = /finals|olympic|', 'const NON_BO3_RE = /olympic|'],
  ['Sackmann Slams / Finals levels in', "  if (r.tourney_level !== 'A' && r.tourney_level !== 'M') return true;\n", ''],
  ['unknown court read as outdoor', "const indoorOf = k => courts[k] === 'indoor' ? true : courts[k] === 'outdoor' ? false : null;", "const indoorOf = k => courts[k] === 'indoor';"],
  ['baseline buckets swapped', "const b = ind ? 'indoorHard' : 'outdoorHard';", "const b = ind ? 'outdoorHard' : 'indoorHard';"],
  ['baseline window one season early', 'const from = season - BASELINE_SEASONS, to = season - 1;', 'const from = season - BASELINE_SEASONS - 1, to = season - 1;'],
  // lineage
  ['lineage ignores surface', "    if (ed.surface !== 'Hard') continue;\n", ''],
  ['lineage ignores court', '    if (ki != null && ed.indoor != null && ki !== ed.indoor) { courtMismatch.push({ key: k, edition: ed.id, name: ed.name }); continue; }\n', ''],
  ['lineage by event, not venue name', "function venueName(n) { return letters(String(n || '').replace(/^ATP\\s+/i, '').replace(/\\s+Masters$/i, '').replace(/\\s+\\d$/, '')); }", "function venueName(n) { return 'event'; }"],
  ['ambiguous name joined', '    if (ks.size > 1) { ambiguous.add(venueName(ed.name)); continue; }\n', ''],
  // current
  ['progression 1st-serve counts not inverted', 'const inv = x => ({ won: x.total - x.won, total: x.total });', 'const inv = x => x;'],
  ['progression row counted twice', '      if (ek && boxEks.has(ek)) continue;   // the box score already counted it\n', ''],
  ['progression walkover counted', "rec: { completed: m.status === 'finished',", 'rec: { completed: true,'],
  // floor
  ['floor moved', 'const SAMPLE_FLOOR = 15;', 'const SAMPLE_FLOOR = 10;'],
  ['floor applied (numbers dropped below it)', 'function metric(num, den, n) { return { value: den > 0 ? num / den : null, n, num, den }; }',
    'function metric(num, den, n) { return { value: den > 0 && n >= SAMPLE_FLOOR ? num / den : null, n, num, den }; }'],
];
const TEST = path.join(__dirname, 'test-how-it-plays.js');
const run = env => spawnSync(process.execPath, [TEST], { env: Object.assign({}, process.env, env || {}), encoding: 'utf8' });
if (run().status !== 0) { console.error('✖ the suite is red on the unmutated builder — mutants are meaningless'); process.exit(1); }
console.log('✔ control: the unmutated builder passes');
const src = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
const file = path.join(ROOT, `.howplays-mutant-${process.pid}.js`);
let survived = 0;
try {
  for (const [name, from, to] of MUTANTS) {
    if (src.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
    fs.writeFileSync(file, src.replace(from, to));
    const r = run({ HOWPLAYS_BUILDER: file });
    if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; }
    else console.log(`✔ caught: ${name}  ← ${(r.stdout.match(/FAIL {2}([^:]+)/) || [])[1] || 'suite red'}`);
  }
} finally { fs.rmSync(file, { force: true }); }
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
