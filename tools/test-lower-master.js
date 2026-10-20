#!/usr/bin/env node
// Founder ruling 2026-10-18 (item 3): ATP qualifying, Challenger (main draw + qualifying) and ITF go into the master with
// the ATP main-draw source order — our close at a verified start > the Oddspapi archive at start − 10 > api-tennis's
// Pinnacle snapshot > our captured Bet365 (approx.) > a dash — one source per match, in the era shard behind flag 'l',
// never a Database figure. Runs the real build-database-yield.js on fixture feeds, then twice more as controls: with no
// lower feeds (the Database files must be byte-identical) and as a MUTANT that ranks the sources the other way round.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lower-master-'));
const arch = path.join(tmp, 'odds-archive'); fs.mkdirSync(arch);
const H = 'date,tournament,series,court,surface,round,bestof,winner,loser,wrank,lrank,comment,b365w,b365l,psw,psl,maxw,maxl,avgw,avgl,avgsrc';
fs.writeFileSync(path.join(arch, '2026.csv'), H + '\n' + ['2026-05-20', 'Geneva Open', 'ATP250', 'Outdoor', 'Clay', '1st Round', 3, 'Ace A.', 'Bee B.', 10, 20,
  'Completed', 1.5, 2.6, 1.5, 2.6, 1.6, 2.7, 1.5, 2.6, 'file'].join(',') + '\n');
const COLS = 'date,level,tournament,round,winner,loser,winnerKey,loserKey,psw,psl,eventKey,snapshotId,source,cutTs,gapToStartS,comment';
const L = (o) => COLS.split(',').map(k => o[k] == null ? '' : o[k]).join(',');
// closes (from 17 Sep): a Challenger close, an ITF... (none at ITF: no verified start)
fs.writeFileSync(path.join(tmp, 'closes.csv'), [COLS,
  L({ date: '2026-10-05', level: 'ch', tournament: 'Challenger Olbia', winner: 'Bergs Z.', loser: 'Moe M.', winnerKey: '1', loserKey: '2', psw: 1.5, psl: 2.6, eventKey: 501, source: 'from Pinnacle history', comment: 'Completed' }),
].join('\n') + '\n');
// snapshots: event 601 has both sources (start − 10 must win), 602 api-tennis only, 603 below the floor (no row)
fs.writeFileSync(path.join(tmp, 'approx.csv'), [COLS,
  L({ date: '2026-05-20', level: 'ch-q', tournament: 'Challenger Bordeaux - Qualification', winner: 'Bergs Z.', loser: 'Herbert P.H.', winnerKey: '1', loserKey: '3', psw: 1.62, psl: 2.3, eventKey: 601, source: 'oddspapi Pinnacle (start − 10)', comment: 'Completed' }),
  L({ date: '2026-05-20', level: 'ch-q', tournament: 'Challenger Bordeaux - Qualification', winner: 'Bergs Z.', loser: 'Herbert P.H.', winnerKey: '1', loserKey: '3', psw: 1.70, psl: 2.15, eventKey: 601, source: 'api-tennis Pinnacle', comment: 'Completed' }),
  L({ date: '2026-03-10', level: 'itf', tournament: 'M25 Antalya', winner: 'Doe J.', loser: 'Roe R.', winnerKey: '4', loserKey: '5', psw: 2.05, psl: 1.75, eventKey: 602, source: 'api-tennis Pinnacle', comment: 'Retired' }),
  L({ date: '2026-03-11', level: 'itf', tournament: 'M25 Antalya', winner: 'Doe J.', loser: 'Coe C.', winnerKey: '4', loserKey: '6', psw: 1.00, psl: 9, eventKey: 603, source: 'api-tennis Pinnacle', comment: 'Completed' }),
  // founder brief 2026-10-19: api-tennis's Bet365 (book 7) — below api-tennis Pinnacle on 602, alone on 606
  L({ date: '2026-03-10', level: 'itf', tournament: 'M25 Antalya', winner: 'Doe J.', loser: 'Roe R.', winnerKey: '4', loserKey: '5', psw: 2.2, psl: 1.6, eventKey: 602, source: 'api-tennis Bet365', comment: 'Retired' }),
  L({ date: '2025-06-02', level: 'ch', tournament: 'Challenger Heilbronn', winner: 'Bergs Z.', loser: 'Loe L.', winnerKey: '1', loserKey: '9', psw: 1.44, psl: 2.75, eventKey: 606, source: 'api-tennis Bet365', comment: 'Completed' }),
  // an ATP event Tennis-Data does not carry ('atp-x'): behind the team flag, never a lower-level ('l') row
  L({ date: '2025-09-13', level: 'atp-x', tournament: 'Davis Cup - World Group I', winner: 'Bergs Z.', loser: 'Joe J.', winnerKey: '1', loserKey: '10', psw: 1.3, psl: 3.5, eventKey: 607, source: 'api-tennis Pinnacle', comment: 'Completed' }),
].join('\n') + '\n');
// our captured Bet365: one on event 602 (api-tennis wins it), one on a Challenger match no other source prices
const b3 = path.join(tmp, 'b365'); fs.mkdirSync(path.join(b3, 'bet365-history'), { recursive: true }); fs.mkdirSync(path.join(b3, 'career-history'));
const t = (iso) => Math.floor(Date.parse(iso) / 1000);
fs.writeFileSync(path.join(b3, 'bet365-history', '2026-03.json'), JSON.stringify({ fixtures: {
  f1: { cat: 'ITF Men', p1: 'Doe, John', p2: 'Roe, Rob', s1: [[t('2026-03-10T09:00:00Z'), 2.0]], s2: [[t('2026-03-10T09:00:00Z'), 1.8]], trueStart: '2026-03-10T10:00:00Z' },
  f2: { cat: 'Challenger', p1: 'Doe, John', p2: 'Poe, Pat', s1: [[t('2026-03-12T09:00:00Z'), 1.9]], s2: [[t('2026-03-12T09:00:00Z'), 1.95]], trueStart: '2026-03-12T10:00:00Z' },
  f3: { cat: 'ATP', p1: 'Doe, John', p2: 'Toe, Tim', s1: [[t('2026-03-13T09:00:00Z'), 1.9]], s2: [[t('2026-03-13T09:00:00Z'), 1.95]], trueStart: '2026-03-13T10:00:00Z' } } }));
fs.writeFileSync(path.join(b3, 'player-profiles.json'), JSON.stringify({ players: { 4: { name: 'J. Doe' }, 5: { name: 'R. Roe' }, 7: { name: 'P. Poe' }, 8: { name: 'T. Toe' } } }));
fs.writeFileSync(path.join(b3, 'career-history', '4.json'), JSON.stringify({ matches: [
  { date: '2026-03-10', opponent: 'R. Roe', oppKey: '5', won: true, tournament: 'M25 Antalya', eventKey: 602 },
  { date: '2026-03-12', opponent: 'P. Poe', oppKey: '7', won: false, tournament: 'Challenger Lugano', eventKey: 604 },
  { date: '2026-03-13', opponent: 'T. Toe', oppKey: '8', won: true, tournament: 'Indian Wells', eventKey: 605 }] }));

function build(env, script) {
  const out = fs.mkdtempSync(path.join(tmp, 'out-'));
  execFileSync('node', [script || path.join(ROOT, 'build-database-yield.js')], { stdio: 'pipe', env: Object.assign({}, process.env, {
    DB_YIELD_ARCHIVE_DIR: arch, DB_YIELD_OUT_DIR: out, DB_YIELD_FEED: path.join(tmp, 'no-feed.csv'), DB_YIELD_APPROX: path.join(tmp, 'no-approx.csv'),
    DB_YIELD_STARTED: path.join(tmp, 'no-started.json'), DB_YIELD_LOWER_CLOSES: path.join(tmp, 'none.csv'), DB_YIELD_LOWER_APPROX: path.join(tmp, 'none.csv'),
    DB_YIELD_B365_ROOT: path.join(tmp, 'none') }, env) });
  const r = f => JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'));
  return { out, x: r('database-yield-x.json'), base: fs.readFileSync(path.join(out, 'database-yield.json'), 'utf8'), master: r('database-yield-master.json') };
}
const FEEDS = { DB_YIELD_LOWER_CLOSES: path.join(tmp, 'closes.csv'), DB_YIELD_LOWER_APPROX: path.join(tmp, 'approx.csv'), DB_YIELD_B365_ROOT: b3 };
const A = build(FEEDS), B = build({});
const lrows = A.x.xRows.map((x, i) => ({ x, n: A.x.xNames[i] })).filter(o => String(o.x[9]).includes('l'));
const by = (w, l) => lrows.find(o => o.n[0] === w && o.n[1] === l);
ok(lrows.length === 5, `five lower-level matches priced (got ${lrows.length})`);
const close = by('Bergs Z.', 'Moe M.');
ok(close && close.x[8] === 3 && close.x[1] === 'Challenger', 'Challenger from 17 Sep: our archive close (book 3)');
const s10 = by('Bergs Z.', 'Herbert P.H.');
ok(s10 && s10.x[8] === 5 && s10.x[5] === 1.62 && s10.x[1] === 'Challenger Qualifying', 'one source per match: start − 10 (book 5) over the api-tennis snapshot of the same match');
const at = by('Doe J.', 'Roe R.');
ok(at && at.x[8] === 2 && /r/.test(at.x[9]) && at.x[7] === 0, 'ITF: the api-tennis snapshot (book 2) over our captured Bet365 of the same match; a retirement keeps flag r; the winner first');
const bc = by('Poe P.', 'Doe J.');
ok(bc && bc.x[8] === 6 && bc.x[1] === 'Challenger', 'a Challenger match only our captured Bet365 prices: book 6, the result from the player\'s own career row (Poe won)');
ok(!lrows.some(o => o.n.includes('Toe T.')), 'an ATP main-draw capture is never a lower-level row (Tennis-Data prices ATP main draw)');
ok(!lrows.some(o => o.n.includes('Coe C.')), 'a price below 1.01 is no row (a dash)');
const b7 = by('Bergs Z.', 'Loe L.');
ok(b7 && b7.x[8] === 7 && b7.x[1] === 'Challenger', 'a Challenger match only api-tennis Bet365 prices: book 7 (the last tier before a dash)');
const tx = A.x.xRows.map((x, i) => ({ x, n: A.x.xNames[i] })).find(o => o.n[1] === 'Joe J.');
ok(tx && /t/.test(tx.x[9]) && !/l/.test(tx.x[9]) && tx.x[1] == null && tx.x[8] === 2, 'an atp-x (Davis Cup) snapshot rides behind the team flag t, series empty, book 2');
ok(A.base === B.base, 'the Database files are byte-identical with and without the lower levels (never a Database figure)');
ok(A.x.meta.counts.lower === 5 && A.x.meta.counts.team === B.x.meta.counts.team + 1 && A.master.meta.counts.x === B.master.meta.counts.x + 6, 'the era shard and the master count the lower rows (and the atp-x row as team)');
// mutant: the source order reversed (api-tennis over start − 10) → the source checks go red
const src = fs.readFileSync(path.join(ROOT, 'build-database-yield.js'), 'utf8');
const anchor = 'const LOWER_RANK = { 3: 0, 4: 0, 5: 1, 2: 1.5, 8: 1.75, 6: 3, 7: 4 };';
ok(src.split(anchor).length === 2, 'the mutant anchor is found exactly once');
const mp = path.join(ROOT, '.mutant-lower-yield.js');
fs.writeFileSync(mp, src.replace(anchor, 'const LOWER_RANK = { 3: 0, 4: 0, 5: 2, 2: 1, 6: 0, 7: 0 };'));
let red = false;
try { const M = build(FEEDS, mp); const m = M.x.xRows.map((x, i) => [x, M.x.xNames[i]]).filter(([x]) => String(x[9]).includes('l'));
  const r1 = m.find(([, n]) => n[1] === 'Herbert P.H.'), r2 = m.find(([, n]) => n[1] === 'Roe R.');
  red = !(r1 && r1[0][8] === 5) || !(r2 && r2[0][8] === 2); }
finally { fs.unlinkSync(mp); }
ok(red, 'MUTANT (the sources ranked the other way round) turns the source-order checks red');
// ── Tennis Explorer · Pinnacle (book 8; order founder 2026-10-20): after api-tennis Pinnacle, before captured Bet365
// The feed carries TE rows when tools/tdarch.py TE_FEED_ON is on (on since 2026-10-20).
const approx = fs.readFileSync(path.join(tmp, 'approx.csv'), 'utf8').split('\n').filter(Boolean);
const TEC = (o) => L(o);
fs.writeFileSync(path.join(tmp, 'approx-te.csv'), [COLS].concat(approx.slice(1),
  TEC({ date: '2026-05-20', level: 'ch-q', tournament: 'Challenger Bordeaux - Qualification', winner: 'Bergs Z.', loser: 'Herbert P.H.', winnerKey: '1', loserKey: '3', psw: 1.66, psl: 2.2, eventKey: 601, source: 'Tennis Explorer · Pinnacle', comment: 'Completed' }),
  TEC({ date: '2025-06-02', level: 'ch', tournament: 'Challenger Heilbronn', winner: 'Bergs Z.', loser: 'Loe L.', winnerKey: '1', loserKey: '9', psw: 1.4, psl: 2.9, eventKey: 606, source: 'Tennis Explorer · Pinnacle', comment: 'Completed' }),
  TEC({ date: '2026-03-10', level: 'itf', tournament: 'M25 Antalya', winner: 'Doe J.', loser: 'Roe R.', winnerKey: '4', loserKey: '5', psw: 2.1, psl: 1.7, eventKey: 602, source: 'Tennis Explorer · Pinnacle', comment: 'Retired' }),
  TEC({ date: '2025-09-13', level: 'atp-x', tournament: 'Davis Cup - World Group I', winner: 'Bergs Z.', loser: 'Joe J.', winnerKey: '1', loserKey: '10', psw: 1.33, psl: 3.4, eventKey: 607, source: 'Tennis Explorer · Pinnacle', comment: 'Completed' }),
  TEC({ date: '2025-09-14', level: 'atp-x', tournament: 'Davis Cup - World Group I', winner: 'Bergs Z.', loser: 'Koe K.', winnerKey: '1', loserKey: '11', psw: 1.25, psl: 3.9, eventKey: 608, source: 'Tennis Explorer · Pinnacle', comment: 'Completed' }),
).join('\n') + '\n');
const E = build(Object.assign({}, FEEDS, { DB_YIELD_LOWER_APPROX: path.join(tmp, 'approx-te.csv') }));
const ex = E.x.xRows.map((x, i) => ({ x, n: E.x.xNames[i] }));
const eBy = (w, l) => ex.find(o => o.n[0] === w && o.n[1] === l);
ok(eBy('Bergs Z.', 'Herbert P.H.').x[8] === 5, 'TE: start − 10 still wins a match both price (601)');
ok(eBy('Bergs Z.', 'Loe L.').x[8] === 8, 'TE: over api-tennis Bet365 (606), book 8');
ok(eBy('Doe J.', 'Roe R.').x[8] === 2, 'TE: api-tennis Pinnacle wins a match both price (602, founder 2026-10-20)');
ok(eBy('Bergs Z.', 'Joe J.').x[8] === 2, 'TE: an atp-x match api-tennis Pinnacle also prices stays on api-tennis Pinnacle (607)');
ok(eBy('Bergs Z.', 'Koe K.').x[8] === 8 && /t/.test(eBy('Bergs Z.', 'Koe K.').x[9]), 'TE: an atp-x match (Davis Cup) on TE alone is book 8, behind the team flag t (608)');
ok(eBy('Bergs Z.', 'Moe M.').x[8] === 3, 'TE: our verified close still wins (from 17 Sep)');
ok(E.base === B.base, 'TE: the Database files are byte-identical with TE rows in the feed (never a Database figure)');
ok(E.x.xTs === undefined && Object.keys(E.x).sort().join() === Object.keys(A.x).sort().join(), 'TE: the era shard carries no time (no new field: the shape is unchanged)');
ok(E.master.meta.bookCodes[8] === 'Pinnacle (approx.) Tennis Explorer', 'TE: the master names book 8');
const mp2 = path.join(ROOT, '.mutant-lower-yield-te.js');
fs.writeFileSync(mp2, src.replace(anchor, 'const LOWER_RANK = { 3: 0, 4: 0, 5: 1, 8: 1.25, 2: 1.5, 6: 3, 7: 4 };'));
let red2 = false;
try { const M = build(Object.assign({}, FEEDS, { DB_YIELD_LOWER_APPROX: path.join(tmp, 'approx-te.csv') }), mp2);
  const r = M.x.xRows.map((x, i) => [x, M.x.xNames[i]]).find(([, n]) => n[1] === 'Roe R.'); red2 = !(r && r[0][8] === 2); }
finally { fs.unlinkSync(mp2); }
ok(red2, 'MUTANT (TE ranked above api-tennis Pinnacle, the 2026-10-19 order) turns the order check red');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\ntest-lower-master: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
