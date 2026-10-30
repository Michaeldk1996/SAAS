#!/usr/bin/env node
// Founder 2026-10-30 ("TE above Bet365" follow-up, "Yes, last before dash"; "for market edge and derived lines it's fine"):
// Tennis Explorer's Bet365 (book 10) prices a match only where no other source does — last before the dash at every level.
// Lower levels: the era shard behind flag 'l', never a Database figure. ATP main draw (founder ruling 2026-10-30, replacing
// the earlier ones): the Database is Pinnacle only; Bet365 (Tennis-Data, then TE) rides the era shard behind flag 'b' — a
// Database dash, the join's "B". Runs the real build-database-yield.js on fixture feeds, with mutants.
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
  // a Bet365-only row (the mutant control)
  ['2025-05-22', 'Geneva Open', 'ATP250', 'Outdoor', 'Clay', '2nd Round', 3, 'Eee E.', 'Fee F.', 50, 60, 'Completed', 1.8, 2.0, '', '', '', '', '', '', 'file'],
].map(r => r.join(',')).join('\n') + '\n');
const COLS = 'date,level,tournament,round,winner,loser,winnerKey,loserKey,psw,psl,eventKey,snapshotId,source,cutTs,gapToStartS,comment';
const L = (o) => COLS.split(',').map(k => o[k] == null ? '' : o[k]).join(',');
const ACOLS = 'date,tournament,winner,loser,psw,psl,eventKey,snapshotId,source,cutTs,gapToStartS';
const A_ = (o) => ACOLS.split(',').map(k => o[k] == null ? '' : o[k]).join(',');
const TEB = 'Tennis Explorer · Bet365';
const lowerBase = [L({ date: '2025-06-02', level: 'ch', tournament: 'Challenger Heilbronn', winner: 'Bergs Z.', loser: 'Loe L.', winnerKey: '1', loserKey: '9', psw: 1.44, psl: 2.75, eventKey: 702, source: 'api-tennis Bet365', comment: 'Completed' })];
const lowerTeb = [
  L({ date: '2025-06-01', level: 'ch', tournament: 'Challenger Heilbronn', winner: 'Bergs Z.', loser: 'Moe M.', winnerKey: '1', loserKey: '8', psw: 1.8, psl: 2.0, eventKey: 701, source: TEB, comment: 'Completed' }),
  L({ date: '2025-06-02', level: 'ch', tournament: 'Challenger Heilbronn', winner: 'Bergs Z.', loser: 'Loe L.', winnerKey: '1', loserKey: '9', psw: 1.5, psl: 2.5, eventKey: 702, source: TEB, comment: 'Completed' }),
];
fs.writeFileSync(path.join(tmp, 'lower-base.csv'), [COLS, ...lowerBase].join('\n') + '\n');
fs.writeFileSync(path.join(tmp, 'lower-teb.csv'), [COLS, ...lowerBase, ...lowerTeb].join('\n') + '\n');
// main draw: the dash (Cee v Dee) and the priced match (Ace v Bee) both carry a TE Bet365 snapshot
fs.writeFileSync(path.join(tmp, 'main-teb.csv'), [ACOLS,
  A_({ date: '2025-05-21', tournament: 'Geneva Open', winner: 'Cee C.', loser: 'Dee D.', psw: 1.7, psl: 2.1, eventKey: 703, snapshotId: 1, source: TEB }),
  A_({ date: '2025-05-20', tournament: 'Geneva Open', winner: 'Ace A.', loser: 'Bee B.', psw: 1.4, psl: 2.9, eventKey: 704, snapshotId: 2, source: TEB })].join('\n') + '\n');
fs.writeFileSync(path.join(tmp, 'main-none.csv'), ACOLS + '\n');

function build(lowerApprox, mainApprox, script) {
  const out = fs.mkdtempSync(path.join(tmp, 'out-'));
  execFileSync('node', [script || path.join(ROOT, 'build-database-yield.js')], { stdio: 'pipe', env: Object.assign({}, process.env, {
    DB_YIELD_ARCHIVE_DIR: arch, DB_YIELD_OUT_DIR: out, DB_YIELD_FEED: path.join(tmp, 'no-feed.csv'), DB_YIELD_APPROX: mainApprox,
    DB_YIELD_STARTED: path.join(tmp, 'no-started.json'), DB_YIELD_LOWER_CLOSES: path.join(tmp, 'none.csv'), DB_YIELD_LOWER_APPROX: lowerApprox,
    DB_YIELD_B365_ROOT: path.join(tmp, 'none'), DB_YIELD_LOWER_UNPRICED: path.join(tmp, 'none.json') }) });
  const r = f => fs.readFileSync(path.join(out, f), 'utf8');
  return { x: JSON.parse(r('database-yield-x.json')), base: JSON.parse(r('database-yield.json')), names: JSON.parse(r('database-yield-players.json')),
    raw: r('database-yield.json') + r('database-yield-players.json') + r('tour-baselines.json') };
}
const xOf = (R) => R.x.xRows.map((r, i) => ({ book: r[8], flags: r[9], names: R.x.xNames[i] }));
const dbOf = (R) => R.base.rows.map((r, i) => ({ book: r[8], fav: r[5], dog: r[6], names: R.names.names[i] }));
// 1. lower levels: join-only, the Database untouched
const A = build(path.join(tmp, 'lower-base.csv'), path.join(tmp, 'main-none.csv')), B = build(path.join(tmp, 'lower-teb.csv'), path.join(tmp, 'main-none.csv'));
const xb = xOf(B), at = (w, l) => xb.filter(r => r.names[0] === w && r.names[1] === l);
ok(B.raw === A.raw, 'lower levels: no Database figure moves — database-yield.json, its names shard and tour-baselines.json byte-identical with and without TE Bet365');
ok(at('Bergs Z.', 'Moe M.').length === 1 && at('Bergs Z.', 'Moe M.')[0].book === 10 && /^l/.test(at('Bergs Z.', 'Moe M.')[0].flags), 'a lower match only TE Bet365 prices: one era-shard row, book 10, flag l', at('Bergs Z.', 'Moe M.'));
ok(at('Bergs Z.', 'Loe L.').length === 1 && at('Bergs Z.', 'Loe L.')[0].book === 7, 'api-tennis Bet365 keeps its match: TE Bet365 is last before the dash', at('Bergs Z.', 'Loe L.'));
// 2. ATP main draw (founder ruling 2026-10-30, replacing the earlier ones): the Database is Pinnacle prices only. A match with
// no Pinnacle is a Database dash; its Bet365 (Tennis-Data's, then Tennis Explorer's) rides the era shard behind flag 'b'.
const C = build(path.join(tmp, 'lower-base.csv'), path.join(tmp, 'main-teb.csv')), dc = dbOf(C), xc = xOf(C);
const m = (w, l) => dc.filter(r => r.names[0] === w && r.names[1] === l), xm = (w, l) => xc.filter(r => r.names[0] === w && r.names[1] === l);
ok(dc.every(r => r.book !== 1 && r.book !== 10), 'the Database\'s ATP main draw holds no Bet365 row of any kind (books 1 and 10)', dc.map(r => r.book));
ok(m('Eee E.', 'Fee F.').length === 0 && xm('Eee E.', 'Fee F.').length === 1 && xm('Eee E.', 'Fee F.')[0].book === 1 && xm('Eee E.', 'Fee F.')[0].flags === 'b',
  'a Tennis-Data Bet365-only row leaves the Database: a dash there, the join\'s "B" (era shard, book 1, flag b)', { db: m('Eee E.', 'Fee F.'), x: xm('Eee E.', 'Fee F.') });
ok(m('Cee C.', 'Dee D.').length === 0 && xm('Cee C.', 'Dee D.').length === 1 && xm('Cee C.', 'Dee D.')[0].book === 10 && xm('Cee C.', 'Dee D.')[0].flags === 'b',
  'a match with no Pinnacle and no Tennis-Data Bet365 takes TE Bet365 in the join only (book 10, flag b) — a Database dash', xm('Cee C.', 'Dee D.'));
ok(m('Ace A.', 'Bee B.').length === 1 && m('Ace A.', 'Bee B.')[0].book === 0 && xm('Ace A.', 'Bee B.').length === 0, 'a match with a Pinnacle price keeps it in the Database, and no Bet365 row is added');
ok(C.base.meta.bet365OutOfDatabase.rows === 2 && C.base.meta.bet365OutOfDatabase.byBook[1] === 1 && C.base.meta.bet365OutOfDatabase.byBook[10] === 1,
  'the build counts the rows moved out: 2 (Tennis-Data 1, Tennis Explorer 1)', C.base.meta.bet365OutOfDatabase);
ok(!C.base.meta.bookCounts.Bet365 && !C.base.meta.bookCounts['Bet365 (approx.) · Tennis Explorer'], 'the Database\'s book counts name no Bet365', C.base.meta.bookCounts);
ok(C.x.meta.counts.mainDrawBet365 === 2, 'the era shard counts its flag-b rows');
const D = build(path.join(tmp, 'lower-base.csv'), path.join(tmp, 'main-none.csv'));
ok(xOf(D).filter(r => r.flags === 'b').map(r => r.names[0]).join() === 'Eee E.' && !(D.x.uRows || []).some(u => u[1] === 'Eee E.'),
  'with no TE feed the Tennis-Data Bet365 row is still the join\'s "B" (never a dash in the join)');
// MUTANT: Bet365 back in the Database (the flag-b route removed)
const src = fs.readFileSync(path.join(ROOT, 'build-database-yield.js'), 'utf8');
const mutated = src.replace("const joinOnlyB = season >= WINDOW_START && (bookIdx === 1 || bookIdx === TE_B365_BOOK);", 'const joinOnlyB = false;');
ok(mutated !== src, 'mutant applies');
const mf = path.join(ROOT, '.mutant-te-b365-build.js'); fs.writeFileSync(mf, mutated);
try { const Mu = build(path.join(tmp, 'lower-base.csv'), path.join(tmp, 'main-teb.csv'), mf);
  ok(dbOf(Mu).some(r => r.book === 1), 'MUTANT caught: without the route a Tennis-Data Bet365 row is a Database row again');
} finally { fs.unlinkSync(mf); }
// the page texts (founder 2026-10-30): the Database header names Bet365 only while a Database row is on it; Market edge shows
// its Bet365 share ("N of M on Bet365") on the profile box and the Match analysis tab
{
  const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8'), pp = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  const hdr = new Function('esc', 'M', `return M.books[0]+' closing'+(M.bookCounts && !M.bookCounts[M.books[1]] ? ' only' : ', else '+esc(M.books[1]));`);
  ok(html.includes("esc(M.books[0])+' closing'+(M.bookCounts && !M.bookCounts[M.books[1]] ? ' only' : ', else '+esc(M.books[1]))+', per match, '"), 'the Database header sentence follows the data');
  ok(hdr(x => x, { books: ['Pinnacle', 'Bet365'], bookCounts: { Pinnacle: 9, Bet365: 0 } }) === 'Pinnacle closing only'
    && hdr(x => x, { books: ['Pinnacle', 'Bet365'], bookCounts: { Pinnacle: 9, Bet365: 2 } }) === 'Pinnacle closing, else Bet365', 'header: "Pinnacle closing only" with no Bet365 row; control: "else Bet365" with one');
  ok(/' of ' \+ M\.priced\.length\.toLocaleString\('en-US'\) \+ ' on Bet365'/.test(html) && /' on Bet365' : ''\) : M\.state === 'loading'/.test(html), 'Match analysis Market edge: "N of M on Bet365" in the header, the count in the legend');
  ok(/mk\.headline\.book\.bet365 \+ ' of ' \+ mk\.headline\.n \+ ' on Bet365'/.test(pp), 'profile Market edge box: "N of M on Bet365"');
}
console.log(`\ntest-te-b365: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
