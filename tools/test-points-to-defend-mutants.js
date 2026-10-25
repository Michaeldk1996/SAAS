'use strict';
// Mutant runner for tools/test-points-to-defend.js. Each mutant re-breaks ONE fix in a temp copy of
// tools/points-at-risk + tools/points-to-defend; the suite must go red on every one, and green on the unmutated copy
// (a suite that is red everywhere proves nothing). PRE = the engine as it was before the fixes (round-classify.js +
// points-resolver.js at 14867752c, origin/main when this landed) — the "run the pre-fix build as a control" rule.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIRS = ['tools/points-at-risk', 'tools/points-to-defend'];
const PRE_FIX = '14867752c';
const R = 'tools/points-at-risk/points-resolver.js';
const C = 'tools/points-at-risk/round-classify.js';
const BLD = 'tools/points-to-defend/build-points-to-defend.js';

const MUTANTS = [
  ['E1 every qualifying row labelled as the last round', [[C, "reason: 'flag', qualRound: qualBracketCode(tournamentRound) }", "reason: 'flag', qualRound: 'F' }"]]],
  ['E1 every qualifying loss treated as the final round', [[R, 'const fromEnd = finalRank - qrank(deepestQ);', 'const fromEnd = 0;']]],
  ['E1 Slam second-round cell ignored (earlier = 0 always)', [[R, "(fromEnd === 1 ? 'Q_earlier_round_loss' : 'Q_first_round_loss')", "'Q_first_round_loss'"]]],
  ['E2 lucky loser gets the qualifier bonus (old some(won) rule)', [
    [R, 'const luckyLoser = mainMatches.length > 0 && qualMatches.some((q) => q.won === false);', 'const luckyLoser = false;'],
    [R, 'const qualifier = mainMatches.length > 0 && !luckyLoser && qualMatches.some((q) => q.won === true);', 'const qualifier = mainMatches.length > 0 && qualMatches.some((q) => q.won === true);']]],
  ['E2 lucky loser filed as a zero row', [[BLD, 'else if (row.points === 0 && !ll) zeroRows.push(row);', 'else if (row.points === 0) zeroRows.push(row);']]],
  ['E3 per-player award date (qualifying-only rows drop early)', [[R, 'const awardMs = editionAwardMs(editionFixtures) != null ? editionAwardMs(editionFixtures) : awardMonday', 'const awardMs = awardMonday']]],
  ['S  inferred withdrawal not marked inferred', [[BLD, "statusBasis: 'entry-list-not-in-draw', statusInferred: true", "statusBasis: 'entry-list-not-in-draw', statusInferred: false"]]],
  ['S  sheet withdrawals ignored', [[BLD, "if (m && keys.has(shortKey(m[1])))", 'if (false)']]],
  ['S  statuses recomputed after the draw leaves draws.json', [[BLD, "if (prevEvent && prevEvent.statusSource === 'draw-sheet' && !draw)", 'if (false)']]],
  ['S  a started event without a draw reads "Entered"', [[BLD, "if (started) return { status: null, statusBasis: 'draw-not-held'", "if (false) return { status: null, statusBasis: 'draw-not-held'"]]],
  ['L  Lyon first-edition override ignored', [[BLD, 'if ((ov.firstEditionSeasons || []).includes(target.season))', 'if (false)']]],
  ['L  Brussels lineage name filter dropped (Antwerp editions admitted)', [[BLD, 'if (ov.priorNameRe) {', 'if (false) {']]],
  ['N  non-round handling removed (builder gate + resolver tier gate)', [
    [BLD, 'if (te && NON_ROUND_TIERS.has(te.tier))', 'if (false)'],
    [R, '  if (NON_ROUND_TIERS.has(tier)) {', '  if (false) {']]],
];

function copyTree(dst) {
  for (const d of DIRS) fs.cpSync(path.join(ROOT, d), path.join(dst, d), { recursive: true });
}
function runSuite(root) {
  return cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'test-points-to-defend.js')], { env: { ...process.env, PTD_ROOT: root }, encoding: 'utf8' });
}
let bad = 0;
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ptd-mut-'));
// control: the unmutated copy passes
{
  const dst = path.join(base, 'control'); copyTree(dst);
  const r = runSuite(dst);
  console.log(`  ${r.status === 0 ? 'ok  ' : 'FAIL'} control (unmutated copy) ${r.status === 0 ? 'passes' : 'FAILS — fix the suite first'}`);
  if (r.status !== 0) { bad++; console.log(r.stdout.split('\n').filter((l) => /FAIL/.test(l)).join('\n')); }
}
MUTANTS.forEach(([name, edits], i) => {
  const dst = path.join(base, 'm' + i); copyTree(dst);
  for (const [file, from, to] of edits) {
    const p = path.join(dst, file); const s = fs.readFileSync(p, 'utf8');
    if (s.split(from).length !== 2) { console.log(`  FAIL ${name}: anchor not found exactly once in ${file} — the mutant cannot be applied`); bad++; return; }
    fs.writeFileSync(p, s.replace(from, to));
  }
  const r = runSuite(dst);
  const red = r.status !== 0;
  const caught = (r.stdout.match(/^ {2}FAIL (\S+)/gm) || []).map((l) => l.trim().split(' ')[1]);
  console.log(`  ${red ? 'ok  ' : 'FAIL'} ${name}: ${red ? 'caught by ' + caught.join(', ') : 'SURVIVED'}`);
  if (!red) bad++;
});
// PRE: the engine before the fixes
{
  const show = (f) => cp.spawnSync('git', ['show', `${PRE_FIX}:${f}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  const a = show(C); const b = show(R);
  if (a.status !== 0 || b.status !== 0) {
    console.log(`  SKIP pre-fix control: commit ${PRE_FIX} is not in this checkout (shallow clone) — not run, not a pass`);
  } else {
    const dst = path.join(base, 'pre'); copyTree(dst);
    fs.writeFileSync(path.join(dst, C), a.stdout); fs.writeFileSync(path.join(dst, R), b.stdout);
    const r = runSuite(dst);
    const caught = (r.stdout.match(/^ {2}FAIL (\S+)/gm) || []).map((l) => l.trim().split(' ')[1]);
    console.log(`  ${r.status !== 0 ? 'ok  ' : 'FAIL'} PRE engine at ${PRE_FIX}: ${r.status !== 0 ? 'red — ' + caught.join(', ') : 'SURVIVED'}`);
    if (r.status === 0) bad++;
  }
}
fs.rmSync(base, { recursive: true, force: true });
if (bad) { console.log(`test-points-to-defend-mutants: ${bad} problem(s)`); process.exit(1); }
console.log('test-points-to-defend-mutants: every mutant caught');
