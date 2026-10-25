#!/usr/bin/env node
// Founder ruling 2026-10-25 (round 2 item 1.3): two retirement rules, two shared functions, ONE module (settlement.js).
//   matchWinner — who won: the official ATP result; a retirement COUNTS; a walkover is no match (null).
//   settleBet   — the bet: Pinnacle rules (founder 2026-10-22); a retirement before the first set is completed is void,
//                 after it the bet stands on the result; a walkover is void; an unknown first set = no units ('no-sets').
// Checks, each with the mutation it catches (MUTANTS below re-run the behavioural checks on mutated copies and require red):
//   1. the rules (unit)                      — a rule change in settlement.js (M1, M2, M3)
//   2. the Database build on a fixture        — rows-only figures (M4), a local first-set rule, the shared lookup unused
//   3. tournament-market on the same fixture  — favRel on the bet rows (M5), ROI on the win rows (M6)
//   4. odds-performance on the same fixture   — retirements skipped (M7), money figures on the win population (M8)
//   5. a source guard: every listed site calls settlement.js and none re-derives either rule (M9: the page's figure
//      view dropped; any local `comment !== 'completed'` / RETIRED set / first-set test reintroduced)
// Usage: node tools/test-settlement.js            (the checks + the mutants; exit 1 on any failure)
//        node tools/test-settlement.js --no-mutants
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const ROOT = process.env.SETTLE_ROOT || path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ---------------------------------------------------------------------------------------------------------------------
// 1. the rules
// ---------------------------------------------------------------------------------------------------------------------
function ruleChecks(S) {
  const r = [];
  const c = (cond, m) => r.push([!!cond, m]);
  c(S.matchWinner({ comment: 'Completed', winnerSide: 'fav' }) === 'fav', 'matchWinner: a completed match → its winner');
  c(S.matchWinner({ comment: 'Retired', winnerSide: 'dog' }) === 'dog', 'matchWinner: a retirement COUNTS on the official result');
  c(S.matchWinner({ comment: 'Rrtired', winnerSide: 'fav' }) === 'fav', 'matchWinner: the archive typo "Rrtired" is a retirement');
  c(S.matchWinner({ comment: 'Walkover', winnerSide: 'fav' }) === null, 'matchWinner: a walkover → null (excluded)');
  c(S.settleBet({ comment: 'Retired', sets: [[3, 2]] }) === 'void', 'settleBet: retired before the first set was completed (3-2) → void');
  c(S.settleBet({ comment: 'Retired', sets: [[6, 6]] }) === 'void', 'settleBet: retired in the first-set tiebreak (6-6) → void');
  c(S.settleBet({ comment: 'Retired', sets: [[6, 4], [1, 0]] }) === 'stands', 'settleBet: retired after the first set (6-4) → stands');
  c(S.settleBet({ comment: 'Retired', sets: [{ p: 7, o: 6 }] }) === 'stands', 'settleBet: a 7-6 first set ({p,o} shape) → stands');
  c(S.settleBet({ ret: true, fs: 'c' }) === 'stands' && S.settleBet({ ret: true, fs: 'i' }) === 'void', 'settleBet: a precomputed fs (c / i) decides');
  c(S.settleBet({ ret: true, fs: 'c', sets: [[2, 1]] }) === 'stands', 'settleBet: fs wins over the sets (the Market edge shard rule)');
  c(S.settleBet({ comment: 'Walkover' }) === 'void' && S.settleBet({ wo: true }) === 'void', 'settleBet: a walkover → void');
  c(S.settleBet({ comment: 'Retired' }) === 'no-sets' && S.settleBet({ ret: true, fs: 'm' }) === 'no-sets',
    'settleBet: first set unknown → no-sets (the extracted rule: no units, never guessed)');
  c(!S.betCounts({ comment: 'Retired' }) && !S.betCounts({ comment: 'Retired', fs: 'i' }) && S.betCounts({ comment: 'Retired', fs: 'c' }),
    'betCounts: void and no-sets carry no units; a standing retirement does');
  c(S.settleBet({ comment: 'Completed' }) === null && S.betCounts({ comment: 'Completed' }), 'settleBet: an ordinary result → null (settles on the result)');
  c(S.firstSetState([[6, 4]]) === 'complete' && S.firstSetState([[6, 5]]) === 'incomplete' && S.firstSetState(null) === 'missing',
    'firstSetState: complete / incomplete / missing');
  return r;
}
console.log('1. the rules');
ruleChecks(require(path.join(ROOT, 'settlement.js'))).forEach(([c, m]) => ok(c, m));
{ // market-edge-core keeps its contract and delegates
  const core = require(path.join(ROOT, 'market-edge-core.js'));
  ok(core.retSettlement({ ret: true, sets: [[6, 3]] }) === 'stands' && core.retSettlement({ ret: true, sets: [[4, 3]] }) === 'void' &&
    core.retSettlement({ ret: true }) === 'no-sets' && core.retSettlement({ won: true }) === null && core.retSettlement({ wo: true, ret: true }) === null,
    'market-edge-core retSettlement: same contract (null / stands / void / no-sets), delegated to settlement.js');
}

// ---------------------------------------------------------------------------------------------------------------------
// 2-4. fixture: one event, 30 completed matches + 4 retirements (first set complete / incomplete / unknown, one
// favourite-won complete) + 1 walkover. Manufactured state, so no check passes on an empty set.
// ---------------------------------------------------------------------------------------------------------------------
const H = 'date,tournament,series,court,surface,round,bestof,winner,loser,wrank,lrank,comment,b365w,b365l,psw,psl,maxw,maxl,avgw,avgl,avgsrc';
const L = (d, w, l, c, pw, pl) => [d, 'Australian Open', 'Grand Slam', 'Outdoor', 'Hard', '1st Round', 5, w, l, 10, 20, c, pw, pl, pw, pl, pw, pl, pw, pl, 'file'].join(',');
function fixture(dir) {
  fs.mkdirSync(path.join(dir, 'odds-archive'), { recursive: true });
  const lines = [H];
  // 30 completed: the favourite (1.50 v 2.60) wins 20, the underdog wins 10
  for (let i = 0; i < 30; i++) {
    const d = `2020-01-${String(10 + (i % 15)).padStart(2, '0')}`;
    lines.push(i < 20 ? L(d, `Fav${i} F.`, `Dog${i} D.`, 'Completed', 1.5, 2.6) : L(d, `Dog${i} D.`, `Fav${i} F.`, 'Completed', 2.6, 1.5));
  }
  lines.push(L('2020-01-20', 'Rdog A.', 'Rfav A.', 'Retired', 3.0, 1.4));   // underdog wins, first set COMPLETE → stands
  lines.push(L('2020-01-20', 'Rdog B.', 'Rfav B.', 'Retired', 3.0, 1.4));   // underdog wins, first set INCOMPLETE → void
  lines.push(L('2020-01-21', 'Rdog C.', 'Rfav C.', 'Retired', 3.0, 1.4));   // underdog wins, first set UNKNOWN → no-sets
  lines.push(L('2020-01-21', 'Rfav D.', 'Rdog D.', 'Retired', 1.4, 3.0));   // favourite wins, first set COMPLETE → stands
  lines.push(L('2020-01-22', 'Wo W.', 'Wo X.', 'Walkover', 1.4, 3.0));      // walkover: never in any figure
  fs.writeFileSync(path.join(dir, 'odds-archive', '2020.csv'), lines.join('\n') + '\n');
  const ret = (w, l, fsv) => ({ date: w === 'Rdog C.' || w === 'Rfav D.' ? '2020-01-21' : '2020-01-20', tournament: 'Australian Open', winner: w, loser: l, fs: fsv });
  fs.writeFileSync(path.join(dir, 'started-evidence.json'), JSON.stringify({ matches: [],
    retired: [ret('Rdog A.', 'Rfav A.', 'c'), ret('Rdog B.', 'Rfav B.', 'i'), ret('Rdog C.', 'Rfav C.', 'm'), ret('Rfav D.', 'Rdog D.', 'c')] }));
}
const COPY = ['build-database-yield.js', 'build-tournament-market.js', 'build-odds-performance.js', 'build-market-edge.js', 'market-edge-core.js',
  'td-identity.js', 'settlement.js'];
function runFixture(srcRoot, mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settle-'));
  for (const f of COPY) { let t = fs.readFileSync(path.join(srcRoot, f), 'utf8'); if (mutate && mutate[f]) t = mutate[f](t); fs.writeFileSync(path.join(dir, f), t); }
  fixture(dir);
  const env = Object.assign({}, process.env, { DB_YIELD_STARTED: path.join(dir, 'started-evidence.json') });
  for (const k of ['DB_YIELD_OUT_DIR', 'DB_YIELD_ARCHIVE_DIR', 'DB_YIELD_FEED', 'DB_YIELD_APPROX', 'DB_YIELD_CAREER_ROOT']) delete env[k];
  const res = { dir };
  try {
    execFileSync('node', ['build-database-yield.js'], { cwd: dir, env, stdio: 'pipe' });
    execFileSync('node', ['build-tournament-market.js'], { cwd: dir, env, stdio: 'pipe' });
    res.y = JSON.parse(fs.readFileSync(path.join(dir, 'database-yield.json'), 'utf8'));
    res.tb = JSON.parse(fs.readFileSync(path.join(dir, 'tour-baselines.json'), 'utf8'));
    res.tm = JSON.parse(fs.readFileSync(path.join(dir, 'tournament-market.json'), 'utf8'));
    res.master = JSON.parse(fs.readFileSync(path.join(dir, 'database-yield-master.json'), 'utf8'));
    // odds-performance: the four retirements' winners on the roster (A stands, D stands, B void, C unknown first set)
    fs.writeFileSync(path.join(dir, 'player-profiles.json'), JSON.stringify({ players: { 1: { name: 'A. Rdog' }, 2: { name: 'D. Rfav' }, 3: { name: 'B. Rdog' }, 4: { name: 'C. Rdog' } } }));
    execFileSync('node', ['build-odds-performance.js', '--quiet', '--min', '1'], { cwd: dir, env, stdio: 'pipe' });
    res.op = {};
    for (const k of ['1', '2', '3', '4']) { const p = path.join(dir, 'odds-performance', k + '.json'); res.op[k] = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; }
  } catch (e) { res.err = String(e.stderr || e.message).slice(0, 400); }
  return res;
}
// expected, by hand. Completed: 30 rows, fav wins 20 at 1.50 → fav P&L 20 × 0.5 − 10 = 0; dog wins 10 at 2.60 → 10 × 1.6 − 20 = −4.
// Figure rows (settleBet) = 30 + A (dog wins at 3.00: fav −1, dog +2) + D (fav wins at 1.40: fav +0.4, dog −1) = 32.
// roiFav = (0 − 1 + 0.4) / 32 = −1.875% → −1.9; roiDog = (−4 + 2 − 1) / 32 = −9.375% → −9.4.
// favRel (matchWinner) = 30 + every retirement (A, B, C, D) = 34 matches; favourite won 20 + D = 21 → 61.76% → 62.
function fixtureChecks(res) {
  const r = [];
  const c = (cond, m) => r.push([!!cond, m]);
  if (res.err) { c(false, 'fixture build ran: ' + res.err); return r; }
  const y = res.y, ao = res.tm.tournaments['Australian Open'];
  c(y.rows.length === 30 && y.retRows.length === 4, 'database-yield: 30 rows (completed) + 4 retRows (the walkover is neither)');
  c(Array.isArray(y.retFs) && y.retFs.join('') === 'cimc' && Array.isArray(y.retComment) && y.retComment.every(x => x === 'Retired'),
    'database-yield: each retRow carries its comment and first set from the shared lookup (c i m c)');
  c(y.meta.settlement && y.meta.settlement.figureRows === 32 && y.meta.settlement.retired.stands === 2 && y.meta.settlement.retired.void === 1 &&
    y.meta.settlement.retired.noSets === 1, 'database-yield meta.settlement: 32 figure rows, 2 stand, 1 void, 1 no set scores');
  c(res.tb.roles.all.matches === 32 && Math.abs(res.tb.roles.favourite.yield - (-0.6 / 32)) < 1e-12 && Math.abs(res.tb.roles.underdog.yield - (-3 / 32)) < 1e-12,
    'tour-baselines: settleBet — 32 matches, fav −1.875%, dog −9.375% (retirements A and D stand, B void, C no units)');
  c(ao && ao.n === 32 && ao.roiFav === -1.9 && ao.roiDog === -9.4, 'tournament-market ROI: settleBet — n 32, roiFav −1.9, roiDog −9.4');
  c(ao && ao.nRel === 34 && ao.favRel === 62, 'tournament-market favRel: matchWinner — every retirement counts: 21 / 34 = 62%');
  c(res.tm.baseline.n === 32 && res.tm.baseline.nRel === 34 && res.tm.baseline.favRel === 62, 'tournament-market baseline: the same two populations');
  const MC = {}; res.master.meta.cols.forEach((k, i) => { MC[k] = i; });
  c(MC.fs != null && res.master.rows.filter(m => m[MC.set] === 'ret').map(m => m[MC.fs]).join('') === 'cimc', 'master: each retirement carries its first set (fs)');
  // odds-performance: A. Rdog — one underdog side, a retirement that stands → in both; D. Rfav — one favourite side, stands
  const a = res.op['1'], d = res.op['2'];
  c(a && a.overall && a.overall.matches === 1 && a.overall.wins === 1 && a.overall.bets === 1 && a.overall.roi === 200,
    'odds-performance: a standing retirement counts in the win rate (1-0) and in the money (+200%)');
  c(d && d.overall && d.overall.matches === 1 && d.overall.bets === 1 && d.sides.length === 1, 'odds-performance: the standing retirement is a priced side (P&L, curve)');
  const b = res.op['3'], cc = res.op['4'];
  c(b && b.overall && b.overall.matches === 1 && b.overall.wins === 1 && b.overall.bets === 0 && b.overall.roi === null && b.sides.length === 0,
    'odds-performance: a void retirement counts in the win rate, carries no money figure (roi —) and no priced side');
  c(cc && cc.overall && cc.overall.matches === 1 && cc.overall.bets === 0 && cc.sides.length === 0, 'odds-performance: an unknown first set — win rate only, no units');
  return r;
}
console.log('2-4. fixture builds (Database, tour baselines, tournament market, odds performance)');
const real = runFixture(ROOT);
fixtureChecks(real).forEach(([c, m]) => ok(c, m));
// ---------------------------------------------------------------------------------------------------------------------
// 5. source guard — every listed site goes through settlement.js, none re-derives
// ---------------------------------------------------------------------------------------------------------------------
function guardChecks(src) {
  const r = [];
  const c = (cond, m) => r.push([!!cond, m]);
  const db = src('build-database-yield.js'), tm = src('build-tournament-market.js'), op = src('build-odds-performance.js'),
    me = src('build-market-edge.js'), core = src('market-edge-core.js'), se = src('tools/started-evidence.js'), html = src('bsp-consult-dashboard.html');
  const req = /require\('\.\/settlement\.js'\)/;
  c(req.test(db) && /const figRows = rows\.concat\(retRows\.filter\(\(r, i\) => retStands\[i\]\)\)/.test(db) && /Settlement\.betCounts\(\{ comment: retComment\[i\], fs: retFs\[i\] \}\)/.test(db) &&
    /const dbList = figRows\.map/.test(db), 'site 1/7 build-database-yield.js: figure rows + tour baselines through Settlement.betCounts');
  c(/require\(me\)\.firstSetLookup\(/.test(db) && !/firstSetState\s*\(/.test(db), 'site 1 build-database-yield.js: first sets from the shared lookup, no local first-set rule');
  c(req.test(tm) && /Settlement\.betCounts\(\{ comment: retC\[i\], fs: retF\[i\] \}\)/.test(tm) && /Settlement\.matchWinner\(\{ comment: retC\[i\]/.test(tm) &&
    /if \(bet\) \{ n \+= 1;/.test(tm) && /if \(win\) \{ nRel \+= 1;/.test(tm), 'site 2-5 build-tournament-market.js: ROI on settleBet, favRel on matchWinner');
  c(req.test(op) && /Settlement\.matchWinner\(\{ comment: cm/.test(op) && /Settlement\.betCounts\(\{ comment: cm, fs: row\.fs \}\)/.test(op) &&
    !/toLowerCase\(\) !== 'completed'/.test(op), 'site 8 build-odds-performance.js: win rates on matchWinner, money on settleBet, no local completed-only skip');
  c(req.test(me) && /const isYieldBasis = \(side\) => .*Settlement\.betCounts\(side\)/.test(me) && /Settlement\.kindOf\(c\) === 'retired'/.test(me) &&
    !/RETIRED_COMMENTS/.test(me) && !/core\.retSettlement/.test(me), 'site 9 build-market-edge.js: Settlement.settleBet / betCounts, no local retirement set');
  c(/require\('\.\/settlement\.js'\) : root\.Settlement/.test(core) && /return S\.settleBet\(r\);/.test(core) && /const firstSetState = S\.firstSetState;/.test(core) &&
    !/hi === 6 && lo <= 4/.test(core), 'site 10 market-edge-core.js (the price join\'s settlement): delegates to settlement.js, no local first-set rule');
  c(/require\('\.\.\/settlement\.js'\)/.test(se), 'tools/started-evidence.js: the first-set rule from settlement.js');
  c(/S\.betCounts\(\{ comment: rc\[i\], fs: rf\[i\] \}\)/.test(html) && /RAW=j; DATA=dbFigureView\(j\);/.test(html) &&
    /dbPriceJoinRows\(RAW, RAW_NAMES, XDATA, QDATA\)/.test(html), 'site 6 dashboard Database: the figure view through window.Settlement; the join reads the raw store');
  const tagS = html.indexOf('<script src="settlement.js"></script>'), tagC = html.indexOf('<script src="market-edge-core.js"></script>');
  c(tagS > 0 && tagS < tagC, 'dashboard: settlement.js loads before market-edge-core.js');
  // nowhere else defines the first-set rule
  const others = [db, tm, op, me, core, se, html, src('player-profile-v2.js')];
  c(others.every(t => !/hi === 6 && lo <= 4/.test(t)), 'only settlement.js holds the first-set rule');
  const pl = src('.github/workflows/pipeline.yml'), sc = src('tools/site-code.sh'), ps = src('tools/publish-site.mjs');
  c(/cp settlement\.js _site\//.test(pl) && /player-profile-v2\.js settlement\.js market-edge-core\.js/.test(pl) && /cp settlement\.js "\$SITE\/"/.test(sc) &&
    /'settlement\.js', 'market-edge-core\.js'/.test(ps), 'settlement.js is on every site file list (pipeline x2, site-code.sh, publish-site.mjs)');
  return r;
}
console.log('5. source guard');
guardChecks(rd).forEach(([c, m]) => ok(c, m));

// ---------------------------------------------------------------------------------------------------------------------
// mutants — each must turn at least one check red
// ---------------------------------------------------------------------------------------------------------------------
if (!process.argv.includes('--no-mutants')) {
  console.log('mutants (each must go red)');
  const sub = (a, b) => (t) => { if (!t.includes(a)) throw new Error('mutant anchor not found: ' + a.slice(0, 60)); return t.replace(a, b); };
  const S0 = path.join(ROOT, 'settlement.js');
  const loadS = (t) => { const m = { exports: {} }; new Function('module', 'exports', 'require', 'window', 'globalThis', t)(m, m.exports, require, undefined, undefined); return m.exports; };
  const red = (checks) => checks.some(([c]) => !c);
  const MUT = [
    ['M1 settleBet: every retirement stands', 'rules', { 'settlement.js': sub("return st === 'complete' ? 'stands' : st === 'incomplete' ? 'void' : 'no-sets';", "return 'stands';") }],
    ['M2 matchWinner: retirements excluded', 'rules', { 'settlement.js': sub("return k === 'completed' || k === 'retired' ? (m.winnerSide ?? null) : null;", "return k === 'completed' ? (m.winnerSide ?? null) : null;") }],
    ['M3 settleBet: an unknown first set stands', 'rules', { 'settlement.js': sub(": st === 'incomplete' ? 'void' : 'no-sets';", ": st === 'incomplete' ? 'void' : 'stands';") }],
    ['M4 Database figures: rows only (the old rows-only definition)', 'fixture', { 'build-database-yield.js': sub('const figRows = rows.concat(retRows.filter((r, i) => retStands[i]));', 'const figRows = rows.slice();') }],
    ['M5 favRel on the bet rows', 'fixture', { 'build-tournament-market.js': sub('if (win) { nRel += 1; if (won) fw += 1; }', 'if (bet) { nRel += 1; if (won) fw += 1; }') }],
    ['M6 ROI on the win rows', 'fixture', { 'build-tournament-market.js': sub('if (bet) { n += 1;', 'if (win) { n += 1;') }],
    ['M7 odds-performance: retirements skipped (the old completed-only skip)', 'fixture', { 'build-odds-performance.js': sub("if (!inWin && !inBet) { stats.incomplete += 1; return; }", "if (!inWin || !inBet || Settlement.kindOf(cm) === 'retired') { stats.incomplete += 1; return; }") }],
    ['M8 odds-performance: money figures on the win population', 'fixture', { 'build-odds-performance.js': sub('const add = (bucket) => addToBucket(bucket, side.won, side.p, side.price, side.best, inWin, inBet);', 'const add = (bucket) => addToBucket(bucket, side.won, side.p, side.price, side.best, inWin, inWin);') }],
    ['M9 dashboard: the figure view dropped (page reads rows only)', 'guard', { 'bsp-consult-dashboard.html': sub('RAW=j; DATA=dbFigureView(j);', 'RAW=j; DATA=j;') }],
    ['M10 market edge: a local retirement set again', 'guard', { 'build-market-edge.js': sub("const isRetiredComment = (c) => Settlement.kindOf(c) === 'retired';", "const RETIRED_COMMENTS = new Set(['retired', 'rrtired']);\nconst isRetiredComment = (c) => RETIRED_COMMENTS.has(String(c || '').trim().toLowerCase());") }],
  ];
  for (const [name, kind, m] of MUT) {
    let isRed;
    try {
      if (kind === 'rules') isRed = red(ruleChecks(loadS(m['settlement.js'](fs.readFileSync(S0, 'utf8')))));
      else if (kind === 'fixture') isRed = red(fixtureChecks(runFixture(ROOT, m)));
      else isRed = red(guardChecks((f) => (m[f] ? m[f](rd(f)) : rd(f))));
    } catch (e) { isRed = false; console.log('        (mutant error: ' + e.message + ')'); }
    ok(isRed, `${name} → red`);
  }
}

console.log(`\ntest-settlement: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
