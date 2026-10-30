#!/usr/bin/env node
// Founder 2026-10-30 ("TE above Bet365" follow-up, "Yes, last before dash"; "for market edge and derived lines it's fine"):
// Tennis Explorer's Bet365 (book 10) prices a match only where no other source does — last before the dash at every level.
// Lower levels: the era shard behind flag 'l', never a Database figure. ATP main draw (founder, same day: "the Database must
// show the same price"): a Database row of its own, book 10, labelled, only on a match that would otherwise be a dash.
// Runs the real build-database-yield.js on fixture feeds, with a MUTANT that ranks TE Bet365 above Tennis-Data's Bet365.
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
// 2. ATP main draw: a Database row of its own on the dash; the priced match keeps its price
const C = build(path.join(tmp, 'lower-base.csv'), path.join(tmp, 'main-teb.csv')), dc = dbOf(C), m = (w, l) => dc.filter(r => r.names[0] === w && r.names[1] === l);
ok(m('Cee C.', 'Dee D.').length === 1 && m('Cee C.', 'Dee D.')[0].book === 10 && m('Cee C.', 'Dee D.')[0].fav === 1.7,
  'ATP main draw: the Database dash becomes a Database row priced on TE Bet365 (book 10), so the Database shows the price every page shows', m('Cee C.', 'Dee D.'));
ok(m('Ace A.', 'Bee B.').length === 1 && m('Ace A.', 'Bee B.')[0].book === 0 && m('Ace A.', 'Bee B.')[0].fav === 1.5, 'a main-draw match the Database prices keeps its Tennis-Data Pinnacle price', m('Ace A.', 'Bee B.'));
ok(!(C.x.uRows || []).some(u => u[1] === 'Cee C.'), 'the filled match is no longer a dash');
ok(C.base.meta.bookCounts['Bet365 (approx.) · Tennis Explorer'] === 1 && C.base.meta.approx.sources.tb.used === 1 && C.base.meta.approx.sources.tb.filledDash === 1,
  'the Database names it: bookCounts "Bet365 (approx.) · Tennis Explorer" 1, meta.approx.sources.tb', { bc: C.base.meta.bookCounts, tb: C.base.meta.approx.sources.tb });
ok(C.base.meta.approx.sources.tb.hover === 'Bet365 (approx.) · Tennis Explorer, last pre-match price, not a confirmed close', 'its hover is the ruled words, never a close');
// MUTANT: TE Bet365 ranked above Tennis-Data's Bet365 (the dash test dropped)
const src = fs.readFileSync(path.join(ROOT, 'build-database-yield.js'), 'utf8');
const mutated = src.replace('if (bookIdx < 0 && !fromFeed && approxOn) {', 'if (!fromFeed && approxOn && !(validPrice(P[0]) && validPrice(P[1]))) {');
ok(mutated !== src, 'mutant applies');
const mf = path.join(ROOT, '.mutant-te-b365-build.js'); fs.writeFileSync(mf, mutated);
try {
  fs.writeFileSync(path.join(tmp, 'main-teb2.csv'), [ACOLS, A_({ date: '2025-05-22', tournament: 'Geneva Open', winner: 'Eee E.', loser: 'Fee F.', psw: 1.9, psl: 1.95, eventKey: 705, snapshotId: 3, source: TEB })].join('\n') + '\n');
  const Mu = build(path.join(tmp, 'lower-base.csv'), path.join(tmp, 'main-teb2.csv'), mf), Ok = build(path.join(tmp, 'lower-base.csv'), path.join(tmp, 'main-teb2.csv'));
  const e = (R) => dbOf(R).filter(r => r.names[0] === 'Eee E.').map(r => r.book);
  ok(JSON.stringify(e(Ok)) === '[1]' && JSON.stringify(e(Mu)) === '[10]', 'MUTANT caught: TE Bet365 above Tennis-Data\'s Bet365 replaces a Bet365 row (the real build keeps Bet365)', { ok: e(Ok), mu: e(Mu) });
} finally { fs.unlinkSync(mf); }
console.log(`\ntest-te-b365: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
