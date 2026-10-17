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
const { build, rowSays, verdictOf } = require('./started-evidence.js');

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
].join('\n') + '\n');
const names = { 1: 'A. Ace', 2: 'B. Bee', 3: 'C. Cee', 4: 'D. Dee', 5: 'E. Eff', 7: 'G. Gee', 8: 'H. Hay' };
fs.writeFileSync(path.join(tmp, 'player-profiles.json'), JSON.stringify({ players: Object.fromEntries(Object.entries(names).map(([k, n]) => [k, { name: n }])) }));
const sh = (k, rows) => fs.writeFileSync(path.join(tmp, 'career-history', `${k}.json`), JSON.stringify({ matches: rows }));
sh(1, [{ date: '2023-05-02', opponent: 'C. Cee', won: true, sets: [{ p: 4, o: 2 }], defaulted: true },
  { date: '2023-05-03', opponent: 'H. Hay', won: true, sets: [{ p: 3, o: 1 }] }]);
sh(3, [{ date: '2023-05-02', opponent: 'A. Ace', won: false, sets: [{ p: 2, o: 4 }], defaulted: true }]);
sh(4, [{ date: '2023-05-02', opponent: 'E. Eff', won: true, walkover: true }, { date: '2023-05-03', opponent: 'G. Gee', won: true, sets: [{ p: 6, o: 3 }] }]);
sh(7, [{ date: '2023-05-03', opponent: 'D. Dee', won: false, walkover: true }]);
const ev = build(tmp);
const v = t => (ev.matches.find(x => x.loser === t) || {}).verdict;
ok(ev.rows === 4, `the evidence covers the 4 priced non-result rows (got ${ev.rows})`);
ok(v('Cee C.') === 'started', 'Ace v Cee (Awarded, both rows played) → started');
ok(v('Eff E.') === 'walkover', 'Dee v Eff (Walkover, a walkover row) → walkover');
ok(v('Gee G.') === 'disagree', 'Dee v Gee (Disqualified, one row played, one walkover) → disagree');
ok(v('Hay H.') === 'disagree', 'Ace v Hay (Tennis-Data Walkover, a played row) → disagree');
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
    [(b.rows || []).length === 1, 'the Completed match is the one Database row (a started default never moves a Database figure)'],
    [retPairs.some(p => /Ace A\. v Cee C\.|Cee C\. v Ace A\./.test(p)), 'the started Awarded match is priced behind the retired flag'],
    [!retPairs.some(p => /Eff E\./.test(p)), 'the true walkover stays a dash'],
    [!retPairs.some(p => /Gee G\./.test(p)), 'the Disqualified match whose sources disagree stays a dash'],
    [!retPairs.some(p => /Hay H\./.test(p)), 'Tennis-Data Walkover v a played career row stays a dash'],
    [b.meta && b.meta.started && b.meta.started.priced === 1, 'meta.started counts 1 priced'],
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

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\ntest-started-priced: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
