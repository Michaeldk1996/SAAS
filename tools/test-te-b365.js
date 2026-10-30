#!/usr/bin/env node
// Founder 2026-10-30 ("TE above Bet365" follow-up, "Yes, last before dash"; "for market edge and derived lines it's fine"):
// Tennis Explorer's Bet365 (book 10) prices a match only where no other source does — last before the dash at every level —
// and only through the join: the era shard behind flag 'l', never a Database figure. Its ATP main-draw rows (level atp-md)
// fill only a Database dash. Runs the real build-database-yield.js on fixture feeds, with controls: no TE Bet365 rows (the
// Database files byte-identical), and a MUTANT without the main-draw dash guard (a priced match gains a second price).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m + (d ? '\n        ' + JSON.stringify(d).slice(0, 400) : '')); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'te-b365-'));
const arch = path.join(tmp, 'odds-archive'); fs.mkdirSync(arch);
const H = 'date,tournament,series,court,surface,round,bestof,winner,loser,wrank,lrank,comment,b365w,b365l,psw,psl,maxw,maxl,avgw,avgl,avgsrc';
fs.writeFileSync(path.join(arch, '2025.csv'), H + '\n' + [
  ['2025-05-20', 'Geneva Open', 'ATP250', 'Outdoor', 'Clay', '1st Round', 3, 'Ace A.', 'Bee B.', 10, 20, 'Completed', 1.5, 2.6, 1.5, 2.6, 1.6, 2.7, 1.5, 2.6, 'file'],
  // a Database dash: no price on either book
  ['2025-05-21', 'Geneva Open', 'ATP250', 'Outdoor', 'Clay', '2nd Round', 3, 'Cee C.', 'Dee D.', 30, 40, 'Completed', '', '', '', '', '', '', '', '', 'file'],
].map(r => r.join(',')).join('\n') + '\n');
const COLS = 'date,level,tournament,round,winner,loser,winnerKey,loserKey,psw,psl,eventKey,snapshotId,source,cutTs,gapToStartS,comment';
const L = (o) => COLS.split(',').map(k => o[k] == null ? '' : o[k]).join(',');
const TEB = 'Tennis Explorer · Bet365';
const base = [
  L({ date: '2025-06-02', level: 'ch', tournament: 'Challenger Heilbronn', winner: 'Bergs Z.', loser: 'Loe L.', winnerKey: '1', loserKey: '9', psw: 1.44, psl: 2.75, eventKey: 702, source: 'api-tennis Bet365', comment: 'Completed' }),
];
const teb = [
  L({ date: '2025-06-01', level: 'ch', tournament: 'Challenger Heilbronn', winner: 'Bergs Z.', loser: 'Moe M.', winnerKey: '1', loserKey: '8', psw: 1.8, psl: 2.0, eventKey: 701, source: TEB, comment: 'Completed' }),
  L({ date: '2025-06-02', level: 'ch', tournament: 'Challenger Heilbronn', winner: 'Bergs Z.', loser: 'Loe L.', winnerKey: '1', loserKey: '9', psw: 1.5, psl: 2.5, eventKey: 702, source: TEB, comment: 'Completed' }),
  L({ date: '2025-05-21', level: 'atp-md', tournament: 'Geneva Open', round: '2nd Round', winner: 'Cee C.', loser: 'Dee D.', winnerKey: '3', loserKey: '4', psw: 1.7, psl: 2.1, eventKey: 703, source: TEB, comment: 'Completed' }),
  L({ date: '2025-05-20', level: 'atp-md', tournament: 'Geneva Open', round: '1st Round', winner: 'Ace A.', loser: 'Bee B.', winnerKey: '5', loserKey: '6', psw: 1.4, psl: 2.9, eventKey: 704, source: TEB, comment: 'Completed' }),
];
fs.writeFileSync(path.join(tmp, 'base.csv'), [COLS, ...base].join('\n') + '\n');
fs.writeFileSync(path.join(tmp, 'teb.csv'), [COLS, ...base, ...teb].join('\n') + '\n');

function build(lowerApprox, script) {
  const out = fs.mkdtempSync(path.join(tmp, 'out-'));
  execFileSync('node', [script || path.join(ROOT, 'build-database-yield.js')], { stdio: 'pipe', env: Object.assign({}, process.env, {
    DB_YIELD_ARCHIVE_DIR: arch, DB_YIELD_OUT_DIR: out, DB_YIELD_FEED: path.join(tmp, 'no-feed.csv'), DB_YIELD_APPROX: path.join(tmp, 'no-approx.csv'),
    DB_YIELD_STARTED: path.join(tmp, 'no-started.json'), DB_YIELD_LOWER_CLOSES: path.join(tmp, 'none.csv'), DB_YIELD_LOWER_APPROX: lowerApprox,
    DB_YIELD_B365_ROOT: path.join(tmp, 'none'), DB_YIELD_LOWER_UNPRICED: path.join(tmp, 'none.json') }) });
  const r = f => fs.readFileSync(path.join(out, f), 'utf8');
  return { x: JSON.parse(r('database-yield-x.json')), base: r('database-yield.json'), names: r('database-yield-players.json'), tb: r('tour-baselines.json') };
}
const A = build(path.join(tmp, 'base.csv')), B = build(path.join(tmp, 'teb.csv'));
const xOf = (R) => R.x.xRows.map((r, i) => ({ d: r[0], book: r[8], flags: r[9] !== undefined ? r[9] : null, names: R.x.xNames[i], round: r[3], fav: r[5], dog: r[6] }));
const xb = xOf(B);
const at = (w, l) => xb.filter(r => r.names[0] === w && r.names[1] === l);
ok(B.base === A.base && B.names === A.names && B.tb === A.tb, 'no Database figure moves: database-yield.json, its names shard and tour-baselines.json byte-identical with and without TE Bet365');
ok(at('Bergs Z.', 'Moe M.').length === 1 && at('Bergs Z.', 'Moe M.')[0].book === 10, 'a match only Tennis Explorer\'s Bet365 prices: one row, book 10', at('Bergs Z.', 'Moe M.'));
ok(at('Bergs Z.', 'Loe L.').length === 1 && at('Bergs Z.', 'Loe L.')[0].book === 7, 'api-tennis\'s Bet365 keeps its match: TE Bet365 is last before the dash', at('Bergs Z.', 'Loe L.'));
const md = at('Cee C.', 'Dee D.');
ok(md.length === 1 && md[0].book === 10 && /^l/.test(String(md[0].flags || '')) && md[0].round === '2nd Round',
  'an ATP main-draw Database dash gains the TE Bet365 price in the era shard behind flag l (join-only), its Tennis-Data round kept', md);
ok(at('Ace A.', 'Bee B.').length === 0, 'an ATP main-draw match the Database prices gets no second price from TE Bet365');
ok(B.x.meta.lower.teB365MainDraw.kept === 1 && B.x.meta.lower.teB365MainDraw.notADash === 1, 'the build counts both main-draw cases', B.x.meta.lower.teB365MainDraw);
ok(xb.every(r => !/t/.test(String(r.flags || '')) || r.book !== 10), 'no TE Bet365 row rides the team flag');
// MUTANT: the main-draw dash guard removed
const src = fs.readFileSync(path.join(ROOT, 'build-database-yield.js'), 'utf8');
const mutated = src.replace("if (!mainDash.has(`${dI}|${r.winner.trim()}|${r.loser.trim()}`)) { lower.teB365MainDraw.notADash++; continue; }", '');
ok(mutated !== src, 'mutant applies');
const mf = path.join(ROOT, '.mutant-te-b365-build.js'); fs.writeFileSync(mf, mutated);
try { const M = build(path.join(tmp, 'teb.csv'), mf); const xm = xOf(M);
  ok(xm.filter(r => r.names[0] === 'Ace A.' && r.names[1] === 'Bee B.').length === 1, 'MUTANT caught: without the dash guard the priced main-draw match gains a second price');
} finally { fs.unlinkSync(mf); }
console.log(`\ntest-te-b365: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
