#!/usr/bin/env node
// Founder ruling 2026-10-17 (odds master close-out, item 1): a match that STARTED counts as played and shows its price —
// retired, defaulted, or marked "Awarded" / "Disqualified" after play began. Only a true walkover (no ball played) stays a
// dash; where the sources disagree on whether it started, the dash stays. Tests the evidence tool (tools/started-evidence.js)
// and the Database build (build-database-yield.js) on fixtures, then re-runs the build checks with the rule removed — they
// must go red (the mutant).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const { build, rowSays, verdictOf, sameMatch } = require('./started-evidence.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };

// --- the verdict rule ----------------------------------------------------------------------------------------------
ok(rowSays({ sets: [{ p: 6, o: 4 }, { p: 2, o: 1 }], defaulted: true }) === 'started', 'a default with games played says started');
ok(rowSays({ walkover: true }) === 'walkover', 'a walkover row says no ball was played');
ok(rowSays({ sets: null }) === null, 'a row with no score says nothing');
ok(verdictOf('Awarded', ['started', 'started']) === 'started', 'Awarded + both career rows started → started');
ok(verdictOf('Awarded', ['started', null]) === 'started', 'Awarded + one career row started, the other silent → started');
ok(verdictOf('Awarded', ['walkover', null]) === 'walkover', 'Awarded + a walkover row → walkover (a dash)');
ok(verdictOf('Awarded', ['started', 'walkover']) === 'disagree', 'career rows disagree → disagree (a dash)');
ok(verdictOf('Walkover', ['started', null]) === 'disagree', 'Tennis-Data Walkover v a played career row → disagree (a dash)');
ok(verdictOf('Walkover', [null, null]) === 'walkover', 'Tennis-Data Walkover alone → walkover');
ok(verdictOf('Disqualified', [null, null]) === 'none', 'no source speaks → none (a dash)');

// --- fixtures ------------------------------------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'started-'));
const arch = path.join(tmp, 'odds-archive'); fs.mkdirSync(arch); fs.mkdirSync(path.join(tmp, 'career-history'));
const H = 'date,tournament,series,court,surface,round,bestof,winner,loser,wrank,lrank,comment,b365w,b365l,psw,psl,maxw,maxl,avgw,avgl,avgsrc';
const L = (d, t, r, w, l, c, pw, pl) => [d, t, 'ATP250', 'Outdoor', 'Hard', r, 3, w, l, 10, 20, c, pw, pl, pw, pl, pw, pl, pw, pl, 'file'].join(',');
fs.writeFileSync(path.join(arch, '2023.csv'), [H,
  L('2023-05-01', 'Alpha Open', '1st Round', 'Ace A.', 'Bee B.', 'Completed', 1.5, 2.6),
  L('2023-05-02', 'Alpha Open', '2nd Round', 'Ace A.', 'Cee C.', 'Awarded', 1.7, 2.1),        // started default → priced
  L('2023-05-02', 'Alpha Open', '2nd Round', 'Dee D.', 'Eff E.', 'Walkover', 1.4, 2.9),       // true walkover → dash
  L('2023-05-03', 'Alpha Open', 'Quarterfinals', 'Dee D.', 'Gee G.', 'Disqualified', 1.6, 2.3), // sources disagree → dash
  L('2023-05-03', 'Alpha Open', 'Quarterfinals', 'Ace A.', 'Hay H.', 'Walkover', 1.3, 3.4),   // TD Walkover v a played row → dash
  L('2023-05-04', 'Alpha Open', 'Semifinals', 'Jay J.', 'Kay K.', 'Sched', 1.8, 2.0),         // played out, mislabelled → a Database row
  L('2023-05-04', 'Alpha Open', 'Semifinals', 'Lee L.', 'Moe M.', 'Awarded', 1.9, 1.95),       // one row played out, one retired → behind the flag
].join('\n') + '\n');
const names = { 1: 'A. Ace', 2: 'B. Bee', 3: 'C. Cee', 4: 'D. Dee', 5: 'E. Eff', 7: 'G. Gee', 8: 'H. Hay', 10: 'J. Jay', 11: 'K. Kay', 12: 'L. Lee', 13: 'M. Moe' };
fs.writeFileSync(path.join(tmp, 'player-profiles.json'), JSON.stringify({ players: Object.fromEntries(Object.entries(names).map(([k, n]) => [k, { name: n }])) }));
const sh = (k, rows) => fs.writeFileSync(path.join(tmp, 'career-history', `${k}.json`), JSON.stringify({ matches: rows }));
sh(1, [{ date: '2023-05-02', opponent: 'C. Cee', won: true, sets: [{ p: 4, o: 2 }], defaulted: true },
  { date: '2023-05-03', opponent: 'H. Hay', won: true, sets: [{ p: 3, o: 1 }] }]);
sh(3, [{ date: '2023-05-02', opponent: 'A. Ace', won: false, sets: [{ p: 2, o: 4 }], defaulted: true }]);
sh(4, [{ date: '2023-05-02', opponent: 'E. Eff', won: true, walkover: true }, { date: '2023-05-03', opponent: 'G. Gee', won: true, sets: [{ p: 6, o: 3 }] }]);
sh(7, [{ date: '2023-05-03', opponent: 'D. Dee', won: false, walkover: true }]);
sh(10, [{ date: '2023-05-04', opponent: 'K. Kay', won: true, sets: [{ p: 6, o: 3 }, { p: 6, o: 4 }] }]);
sh(11, [{ date: '2023-05-04', opponent: 'J. Jay', won: false, sets: [{ p: 3, o: 6 }, { p: 4, o: 6 }] }]);
sh(12, [{ date: '2023-05-04', opponent: 'M. Moe', won: true, sets: [{ p: 6, o: 3 }, { p: 6, o: 4 }] }]);
sh(13, [{ date: '2023-05-04', opponent: 'L. Lee', won: false, sets: [{ p: 3, o: 6 }, { p: 1, o: 2 }], retired: true }]);
const ev = build(tmp);
const v = t => (ev.matches.find(x => x.loser === t) || {}).verdict;
ok(ev.rows === 6, `the evidence covers the 6 priced non-result rows (got ${ev.rows})`);
ok(v('Kay K.') === 'completed', 'Jay v Kay ("Sched", both rows played out 6-3 6-4) → completed (founder 2026-10-18)');
ok(v('Moe M.') === 'started', 'Lee v Moe (one row played out, the other a retirement) → started, never completed');
ok(rowSays({ won: true, sets: [{ p: 6, o: 3 }, { p: 6, o: 4 }] }, 5) === 'started', 'two sets won of a best-of-five is not played out');
ok(verdictOf('Sched', ['completed', 'live']) === 'completed' && verdictOf('Sched', ['started', 'live']) === 'started', 'our live-flip says it started, nothing about its end');
ok(v('Cee C.') === 'started', 'Ace v Cee (Awarded, both rows played) → started');
ok(v('Eff E.') === 'walkover', 'Dee v Eff (Walkover, a walkover row) → walkover');
ok(v('Gee G.') === 'disagree', 'Dee v Gee (Disqualified, one row played, one walkover) → disagree');
ok(v('Hay H.') === 'disagree', 'Ace v Hay (Tennis-Data Walkover, a played row) → disagree');
// --- the same match, not a neighbouring meeting (founder 2026-10-18) -------------------------------------------------
ok(sameMatch({ eventKey: 9, round: 'SF' }, 'Semifinals', 1) && !sameMatch({ eventKey: 9 }, 'Semifinals', 2) && !sameMatch({ eventKey: 9 }, 'Semifinals', -2),
  'a feed row (eventKey) is the match only within ±1 day');
ok(!sameMatch({ round: 'QF' }, 'Quarterfinals', 1) && sameMatch({ round: 'QF' }, 'Quarterfinals', -6), 'an archive row is never after the match');
ok(!sameMatch({ round: 'SF' }, 'The Final', -3) && !sameMatch({ round: 'R32' }, 'Quarterfinals', -3) && sameMatch({ round: 'R32' }, '2nd Round', -3)
  && sameMatch({ round: null }, 'The Final', -3), 'an archive row whose round contradicts Tennis-Data\'s is another meeting');
{
  // the four measured walkovers had paired a real meeting at another event: a feed row two days off, an archive row
  // after the match, an archive row in another round. Each must leave the Tennis-Data Walkover a walkover.
  const t2 = fs.mkdtempSync(path.join(os.tmpdir(), 'started-wo-'));
  const a2 = path.join(t2, 'odds-archive'); fs.mkdirSync(a2); fs.mkdirSync(path.join(t2, 'career-history'));
  fs.writeFileSync(path.join(a2, '2017.csv'), [H,
    L('2017-03-16', 'Beta Masters', 'Quarterfinals', 'Fed F.', 'Kyr K.', 'Walkover', 1.3, 3.4),
    L('2021-03-10', 'Gamma Open', 'Quarterfinals', 'Rub R.', 'Fuc F.', 'Walkover', 1.3, 3.4),
    L('2025-04-30', 'Delta Masters', '3rd Round', 'Rub R.', 'Mon M.', 'Walkover', 1.5, 2.6),
  ].join('\n') + '\n');
  const n2 = { 21: 'F. Fed', 22: 'N. Kyr', 23: 'A. Rub', 24: 'M. Fuc', 25: 'G. Mon' };
  fs.writeFileSync(path.join(t2, 'player-profiles.json'), JSON.stringify({ players: Object.fromEntries(Object.entries(n2).map(([k, n]) => [k, { name: n }])) }));
  const s2 = (k, rows) => fs.writeFileSync(path.join(t2, 'career-history', `${k}.json`), JSON.stringify({ matches: rows }));
  s2(21, [{ date: '2017-03-18', eventKey: 501, round: 'SF', opponent: 'N. Kyr', won: true, sets: [{ p: 6, o: 4 }, { p: 6, o: 3 }] }]);
  s2(23, [{ date: '2021-03-12', round: 'QF', opponent: 'M. Fuc', won: true, sets: [{ p: 6, o: 2 }, { p: 6, o: 3 }] },
    { date: '2025-04-26', round: 'F', opponent: 'G. Mon', won: true, sets: [{ p: 6, o: 2 }, { p: 6, o: 3 }] }]);
  const e2 = build(t2), v2 = l => (e2.matches.find(x => x.loser === l) || {}).verdict;
  ok(v2('Kyr K.') === 'walkover', 'a feed row two days off is another meeting → the walkover stays a walkover');
  ok(v2('Fuc F.') === 'walkover', 'an archive row dated after the match is another meeting → walkover');
  ok(v2('Mon M.') === 'walkover', 'an archive row in another round (F v 3rd Round) is another meeting → walkover');
  // mutant: the same-match rule removed → the three read "disagree" again
  const evSrc = fs.readFileSync(path.join(__dirname, 'started-evidence.js'), 'utf8');
  const a3 = 'if (!sameMatch(x, r.round, dd)) return false;';
  ok(evSrc.split(a3).length === 2, 'the same-match mutant anchor is found exactly once');
  const mp = path.join(__dirname, '.mutant-started-evidence.js');
  fs.writeFileSync(mp, evSrc.replace(a3, ''));
  let red = false;
  try { delete require.cache[mp]; const m = require(mp).build(t2); red = ['Kyr K.', 'Fuc F.', 'Mon M.'].some(l => (m.matches.find(x => x.loser === l) || {}).verdict !== 'walkover'); }
  finally { fs.unlinkSync(mp); }
  ok(red, 'MUTANT (the same-match rule removed) pairs a neighbouring meeting and turns the walkover checks red');
  fs.rmSync(t2, { recursive: true, force: true });
}
const evPath = path.join(tmp, 'started-evidence.json'); fs.writeFileSync(evPath, JSON.stringify(ev));

// --- the Database build --------------------------------------------------------------------------------------------
function runBuild(script) {
  const out = fs.mkdtempSync(path.join(tmp, 'out-'));
  execFileSync('node', [script], { env: Object.assign({}, process.env, { DB_YIELD_ARCHIVE_DIR: arch, DB_YIELD_OUT_DIR: out,
    DB_YIELD_STARTED: evPath, DB_YIELD_FEED: path.join(tmp, 'no-feed.csv'), DB_YIELD_APPROX: path.join(tmp, 'no-approx.csv') }), stdio: 'pipe' });
  return { base: JSON.parse(fs.readFileSync(path.join(out, 'database-yield.json'), 'utf8')), names: JSON.parse(fs.readFileSync(path.join(out, 'database-yield-players.json'), 'utf8')) };
}
function buildChecks(script, label) {
  const r = runBuild(script), b = r.base, nm = r.names;
  const retPairs = (b.retRows || []).map((x, i) => (nm.retNames || [])[i]).filter(Boolean).map(p => (Array.isArray(p) ? p : [p]).map(j => (typeof j === 'number' && nm.players ? nm.players[j] : j)).join(' v '));
  const checks = [
    [(b.rows || []).length === 2, 'the Completed match and the played-out "Sched" match are the Database rows (a started default never moves a Database figure)'],
    [(nm.names || []).some(p => /Jay J\./.test(JSON.stringify(p))), 'the played-out "Sched" match is a Database row (founder 2026-10-18)'],
    [!retPairs.some(p => /Kay K\./.test(p)), 'the played-out match is not behind the flag'],
    [retPairs.some(p => /Moe M\./.test(p)), 'the half played-out, half retired match stays behind the flag'],
    [b.meta && b.meta.started && b.meta.started.completed === 1 && b.meta.started.completedByComment.Sched === 1, 'meta.started counts 1 completed ("Sched")'],
    [retPairs.some(p => /Ace A\. v Cee C\.|Cee C\. v Ace A\./.test(p)), 'the started Awarded match is priced behind the retired flag'],
    [!retPairs.some(p => /Eff E\./.test(p)), 'the true walkover stays a dash'],
    [!retPairs.some(p => /Gee G\./.test(p)), 'the Disqualified match whose sources disagree stays a dash'],
    [!retPairs.some(p => /Hay H\./.test(p)), 'Tennis-Data Walkover v a played career row stays a dash'],
    [b.meta && b.meta.started && b.meta.started.priced === 2, 'meta.started counts 2 priced behind the flag'],
  ];
  return { checks, label };
}
const real = buildChecks(path.join(ROOT, 'build-database-yield.js'));
real.checks.forEach(([c, m]) => ok(c, m));

// --- mutant: the rule removed ----------------------------------------------------------------------------------------
const src = fs.readFileSync(path.join(ROOT, 'build-database-yield.js'), 'utf8');
const anchor = 'const behindFlag = isRet || startedNonResult;';
ok(src.split(anchor).length === 2, 'the mutant anchor is found exactly once');
const mutPath = path.join(ROOT, '.mutant-started-build.js');
fs.writeFileSync(mutPath, src.replace(anchor, 'const behindFlag = isRet;'));
let caught = false;
try { const m = buildChecks(mutPath); caught = m.checks.some(([c]) => !c); }
catch (e) { caught = true; }
finally { fs.unlinkSync(mutPath); }
ok(caught, 'MUTANT (the started rule removed) turns the build checks red');
// mutant 2: a played-out non-result treated like a started one (behind the flag) → red
const anchor2 = 'const completedNonResult = verdict === \'completed\';';
ok(src.split(anchor2).length === 2, 'the completed-rule mutant anchor is found exactly once');
fs.writeFileSync(mutPath, src.replace(anchor2, 'const completedNonResult = false;').replace("const startedNonResult = verdict === 'started';", "const startedNonResult = verdict === 'started' || verdict === 'completed';"));
let caught2 = false;
try { const m = buildChecks(mutPath); caught2 = m.checks.some(([c]) => !c); } catch (e) { caught2 = true; } finally { fs.unlinkSync(mutPath); }
ok(caught2, 'MUTANT (a played-out match kept behind the flag, out of the Database figures) turns the build checks red');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\ntest-started-priced: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
