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
const anchor = 'const LOWER_RANK = { 3: 0, 4: 0, 5: 1, 2: 1.5, 8: 1.75, 6: 3, 7: 4, 10: 5, 11: 6 };';
ok(src.split(anchor).length === 2, 'the mutant anchor is found exactly once');
const mp = path.join(ROOT, '.mutant-lower-yield.js');
fs.writeFileSync(mp, src.replace(anchor, 'const LOWER_RANK = { 3: 0, 4: 0, 5: 2, 11: 2, 2: 1, 6: 0, 7: 0, 10: 0 };'));
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
fs.writeFileSync(mp2, src.replace(anchor, 'const LOWER_RANK = { 3: 0, 4: 0, 5: 1, 8: 1.25, 2: 1.5, 6: 3, 7: 4, 10: 5, 11: 6 };'));
let red2 = false;
try { const M = build(Object.assign({}, FEEDS, { DB_YIELD_LOWER_APPROX: path.join(tmp, 'approx-te.csv') }), mp2);
  const r = M.x.xRows.map((x, i) => [x, M.x.xNames[i]]).find(([, n]) => n[1] === 'Roe R.'); red2 = !(r && r[0][8] === 2); }
finally { fs.unlinkSync(mp2); }
ok(red2, 'MUTANT (TE ranked above api-tennis Pinnacle, the 2026-10-19 order) turns the order check red');
// ── 'atp-nt' (founder 2026-11-01, Task A "TE never-tried"): an ATP main-draw match with an api-tennis fixture and no
// Tennis-Data row. An ATP main-draw era row: no 't' / 'l' flag (Market edge and the join read it), Bet365 behind 'b', a
// Tennis-Data copy of the same match wins (the row is dropped and counted), never a Database figure.
fs.writeFileSync(path.join(tmp, 'approx-nt.csv'), [COLS].concat(approx.slice(1),
  TEC({ date: '2026-10-27', level: 'atp-nt', tournament: 'ATP Basel', winner: 'Fils A.', loser: 'Mpetshi Perricard G.', winnerKey: '21', loserKey: '22', psw: 1.55, psl: 2.45, eventKey: 701, source: 'Tennis Explorer · Pinnacle', comment: 'Completed' }),
  TEC({ date: '2026-10-28', level: 'atp-nt', tournament: 'ATP Basel', winner: 'Ruud C.', loser: 'Borges N.', winnerKey: '23', loserKey: '24', psw: 1.6, psl: 2.3, eventKey: 702, source: 'Tennis Explorer · Bet365', comment: 'Completed' }),
  TEC({ date: '2026-05-21', level: 'atp-nt', tournament: 'ATP Geneva', winner: 'Ace A.', loser: 'Bee B.', winnerKey: '25', loserKey: '26', psw: 1.45, psl: 2.7, eventKey: 703, source: 'Tennis Explorer · Pinnacle', comment: 'Completed' }),
).join('\n') + '\n');
const NT = build(Object.assign({}, FEEDS, { DB_YIELD_LOWER_APPROX: path.join(tmp, 'approx-nt.csv') }));
const nx = NT.x.xRows.map((x, i) => ({ x, n: NT.x.xNames[i] }));
const ntBy = (w, l) => nx.find(o => o.n[0] === w && o.n[1] === l);
const n1 = ntBy('Fils A.', 'Mpetshi Perricard G.'), n2 = ntBy('Ruud C.', 'Borges N.');
ok(n1 && n1.x[8] === 8 && n1.x[9] === '' && n1.x[1] == null, `atp-nt: a TE Pinnacle price is an ATP main-draw era row — book 8, no flag, no lower level (got ${n1 && JSON.stringify(n1.x)})`);
ok(n2 && /b/.test(n2.x[9]) && !/[lt]/.test(n2.x[9]), 'atp-nt: a TE Bet365 price rides behind the main-draw Bet365 flag b, never l / t');
ok(!ntBy('Ace A.', 'Bee B.') && NT.x.meta.lower.ntHasTd === 1, 'atp-nt: a match Tennis-Data holds (Geneva, a day later) is never a second row — dropped and counted');
const mRows = NT.master.rows.filter(r => r[7] === 'Fils A.' && r[8] === 'Mpetshi Perricard G.');
ok(mRows.length === 1 && !/[lt]/.test(mRows[0][14]), 'atp-nt: the master holds the match once, outside the team / lower flags (Market edge reads it)');
ok(NT.base === B.base, 'atp-nt: the Database files are byte-identical (never a Database figure)');
// founder 2026-11-09: api-tennis files some ATP main draws as "<event> - Qualification" (Lyon (France) 2026); an archive close
// of such a match must not come back as a second, 'atp-q' row of a match the Database already holds (the join dashes both)
fs.writeFileSync(path.join(tmp, 'approx-q.csv'), [COLS].concat(approx.slice(1),
  TEC({ date: '2026-05-21', level: 'atp-q', tournament: 'Geneva - Qualification', winner: 'Ace A.', loser: 'Bee B.', winnerKey: '25', loserKey: '26', psw: 1.45, psl: 2.7, eventKey: 704, source: 'Tennis Explorer · Pinnacle', comment: 'Completed' }),
  TEC({ date: '2026-05-21', level: 'atp-q', tournament: 'Geneva - Qualification', winner: 'Qual Q.', loser: 'Fier F.', winnerKey: '27', loserKey: '28', psw: 1.5, psl: 2.6, eventKey: 705, source: 'Tennis Explorer · Pinnacle', comment: 'Completed' }),
).join('\n') + '\n');
const Q = build(Object.assign({}, FEEDS, { DB_YIELD_LOWER_APPROX: path.join(tmp, 'approx-q.csv') }));
const qx = Q.x.xRows.map((x, i) => ({ x, n: Q.x.xNames[i] }));
ok(!qx.find(o => o.n[0] === 'Ace A.' && o.n[1] === 'Bee B.') && Q.x.meta.lower.qHasTd === 1,
   "atp-q: a 'qualifying' row of a match the Database holds (api-tennis's Lyon label) is dropped and counted, never a second row");
ok(qx.find(o => o.n[0] === 'Qual Q.' && o.n[1] === 'Fier F.'), 'atp-q: a real qualifying match (no Database row) stays');
const ntAnchor = "    if (tk.length && !tk.every(k => tdUnpricedPairs.has(k))) { if (nt) lower.ntHasTd = (lower.ntHasTd || 0) + 1; else lower.qHasTd = (lower.qHasTd || 0) + 1; continue; }";
ok(src.split(ntAnchor).length === 2, 'atp-nt: the duplicate-guard mutant anchor is found exactly once');
const mp3 = path.join(ROOT, '.mutant-lower-yield-nt.js');
fs.writeFileSync(mp3, src.replace(ntAnchor, ''));
let red3 = false, red3q = false;
try { const M = build(Object.assign({}, FEEDS, { DB_YIELD_LOWER_APPROX: path.join(tmp, 'approx-nt.csv') }), mp3);
  red3 = M.x.xNames.some(n => n[0] === 'Ace A.' && n[1] === 'Bee B.');
  const MQ = build(Object.assign({}, FEEDS, { DB_YIELD_LOWER_APPROX: path.join(tmp, 'approx-q.csv') }), mp3);
  red3q = MQ.x.xNames.some(n => n[0] === 'Ace A.' && n[1] === 'Bee B.'); }
finally { fs.unlinkSync(mp3); }
ok(red3, 'MUTANT (no Tennis-Data guard) lets the Geneva match in twice — the duplicate check turns red');
ok(red3q, "MUTANT (no Tennis-Data guard) lets the Lyon-style 'atp-q' copy in twice — the atp-q check turns red");
// ── founder 2026-11-08 ("add them if it's also on tennis explorer"): a Tennis-Data row with NO price is a Database dash; an
// atp-nt row of the same match is then the only price there is — kept (behind its usual flags), counted, never a Database figure
const arch2 = path.join(tmp, 'odds-archive-2'); fs.mkdirSync(arch2);
fs.writeFileSync(path.join(arch2, '2026.csv'), fs.readFileSync(path.join(arch, '2026.csv'), 'utf8') + ['2026-05-22', 'Geneva Open', 'ATP250', 'Outdoor', 'Clay', '2nd Round', 3, 'Cee C.', 'Dee D.', 30, 40,
  'Completed', '', '', '', '', '', '', '', '', 'file'].join(',') + '\n');
fs.writeFileSync(path.join(tmp, 'approx-nt2.csv'), [COLS].concat(approx.slice(1),
  TEC({ date: '2026-05-21', level: 'atp-nt', tournament: 'ATP Geneva', winner: 'Ace A.', loser: 'Bee B.', winnerKey: '25', loserKey: '26', psw: 1.45, psl: 2.7, eventKey: 703, source: 'Tennis Explorer · Pinnacle', comment: 'Completed' }),
  TEC({ date: '2026-05-22', level: 'atp-nt', tournament: 'ATP Geneva', winner: 'Cee C.', loser: 'Dee D.', winnerKey: '27', loserKey: '28', psw: 1.8, psl: 2.05, eventKey: 705, source: 'Tennis Explorer · other book · Interwetten', comment: 'Completed' }),
).join('\n') + '\n');
const N2 = build(Object.assign({}, FEEDS, { DB_YIELD_ARCHIVE_DIR: arch2, DB_YIELD_LOWER_APPROX: path.join(tmp, 'approx-nt2.csv') }));
const N2b = build(Object.assign({}, FEEDS, { DB_YIELD_ARCHIVE_DIR: arch2 }));
const cd = N2.x.xRows.map((x, i) => ({ x, n: N2.x.xNames[i] })).filter(o => o.n[0] === 'Cee C.' && o.n[1] === 'Dee D.');
ok(cd.length === 1 && cd[0].x[8] === 12 && /v/.test(cd[0].x[9]) && !/[lt]/.test(cd[0].x[9]), `unpriced Tennis-Data row: the atp-nt price (Interwetten, book 12, flag v) is kept (got ${JSON.stringify(cd.map(o => o.x))})`);
ok(N2.x.meta.lower.ntFillsTdDash === 1 && N2.x.meta.lower.ntHasTd === 1, 'unpriced Tennis-Data row: counted as filling a dash; the priced Geneva match is still dropped as a duplicate');
ok(N2.base === N2b.base, 'unpriced Tennis-Data row: the Database files are byte-identical (the Database keeps its dash, ROI untouched)');
const mpU = path.join(ROOT, '.mutant-lower-yield-ntu.js');
fs.writeFileSync(mpU, src.replace(ntAnchor, "    if (tk.length) { lower.ntHasTd = (lower.ntHasTd || 0) + 1; continue; }"));
let redU = false;
try { const M = build(Object.assign({}, FEEDS, { DB_YIELD_ARCHIVE_DIR: arch2, DB_YIELD_LOWER_APPROX: path.join(tmp, 'approx-nt2.csv') }), mpU);
  redU = !M.x.xNames.some(n => n[0] === 'Cee C.' && n[1] === 'Dee D.'); }
finally { fs.unlinkSync(mpU); }
ok(redU, 'MUTANT (any Tennis-Data row wins, priced or not — the pre-2026-11-08 rule) drops the only price — red');
// ── founder 2026-11-04 ("always find prices"): one match = one row, whatever the spelling or the key
// (a) an atp-nt row whose names Tennis-Data spells another way (hyphen, a longer initial) is the same match: dropped
fs.writeFileSync(path.join(tmp, 'approx-sp.csv'), [COLS].concat(approx.slice(1),
  TEC({ date: '2026-05-20', level: 'atp-nt', tournament: 'ATP Geneva', winner: 'A-ce A.', loser: 'Bee Be.', winnerKey: '25', loserKey: '26', psw: 1.45, psl: 2.7, eventKey: 704, source: 'Tennis Explorer · Pinnacle', comment: 'Completed' }),
  // (b) the same Davis Cup match stored with its event key and without it (team-event import) — one row, the keyed copy
  TEC({ date: '2026-09-18', level: 'atp-x', tournament: 'ATP Davis Cup - World Group II', winner: 'Gee G.', loser: 'Hee H.', winnerKey: '41', loserKey: '42', psw: 1.44, psl: 2.62, eventKey: 12163905, source: 'Tennis Explorer · Bet365', comment: 'Completed' }),
  TEC({ date: '2026-09-18', level: 'atp-x', tournament: 'Davis Cup', winner: 'Gee G.', loser: 'Hee H.', winnerKey: '42', loserKey: '41', psw: 1.44, psl: 2.62, source: 'Tennis Explorer · Bet365', comment: 'Completed' }),
  // control: the same pair on another day is another match — kept
  TEC({ date: '2026-09-20', level: 'atp-x', tournament: 'Davis Cup', winner: 'Gee G.', loser: 'Hee H.', winnerKey: '41', loserKey: '42', psw: 1.5, psl: 2.5, source: 'Tennis Explorer · Bet365', comment: 'Completed' }),
).join('\n') + '\n');
const SP = build(Object.assign({}, FEEDS, { DB_YIELD_LOWER_APPROX: path.join(tmp, 'approx-sp.csv') }));
const spN = SP.x.xNames.map((n, i) => ({ n, x: SP.x.xRows[i] }));
ok(!spN.some(o => o.n[0] === 'A-ce A.') && SP.x.meta.lower.ntHasTd === 1, 'one match: an atp-nt row Tennis-Data spells another way ("A-ce A." / "Bee Be." v "Ace A." / "Bee B.") is never a second row');
const gh = spN.filter(o => o.n[0] === 'Gee G.' && o.n[1] === 'Hee H.');
ok(gh.length === 2 && gh.some(o => o.x[0] === 20260918 && o.x[4] === 'ATP Davis Cup - World Group II') && gh.some(o => o.x[0] === 20260920),
  `one match: a Davis Cup match stored with and without its event key is one row (the keyed copy); another day stays (got ${JSON.stringify(gh.map(o => [o.x[0], o.x[4]]))})`);
ok(SP.x.meta.lower.sameMatchMerged === 1, 'one match: the merge is counted');
ok(SP.base === B.base, 'one match: the Database files are byte-identical');
// ── founder 2026-11-01 (Task B): Pinnacle (approx.) before the start (book 11) — after start − 10, before api-tennis, and on
// an ATP main-draw match Tennis-Data does not hold an ATP main-draw era row (no flag), never a Database figure
fs.writeFileSync(path.join(tmp, 'approx-sb.csv'), [COLS].concat(approx.slice(1),
  TEC({ date: '2026-05-20', level: 'ch-q', tournament: 'Challenger Bordeaux - Qualification', winner: 'Bergs Z.', loser: 'Herbert P.H.', winnerKey: '1', loserKey: '3', psw: 1.64, psl: 2.25, eventKey: 601, source: 'oddspapi Pinnacle (before start)', comment: 'Completed' }),
  TEC({ date: '2026-03-10', level: 'itf', tournament: 'M25 Antalya', winner: 'Doe J.', loser: 'Roe R.', winnerKey: '4', loserKey: '5', psw: 2.08, psl: 1.72, eventKey: 602, source: 'oddspapi Pinnacle (before start)', comment: 'Retired' }),
  TEC({ date: '2026-10-29', level: 'atp-nt', tournament: 'ATP Vienna', winner: 'Zverev A.', loser: 'Griekspoor T.', winnerKey: '31', loserKey: '32', psw: 1.33, psl: 3.4, eventKey: 801, source: 'oddspapi Pinnacle (before start)', comment: 'Completed' }),
).join('\n') + '\n');
const SBD = build(Object.assign({}, FEEDS, { DB_YIELD_LOWER_APPROX: path.join(tmp, 'approx-sb.csv') }));
const sx = SBD.x.xRows.map((x, i) => ({ x, n: SBD.x.xNames[i] })), sBy = (w, l) => sx.find(o => o.n[0] === w && o.n[1] === l);
ok(sBy('Bergs Z.', 'Herbert P.H.').x[8] === 5, 'before start: start − 10 still wins a match both price (601)');
ok(sBy('Doe J.', 'Roe R.').x[8] === 2, 'before start: api-tennis Pinnacle keeps a match it prices — book 11 only fills a dash (602)');
const sv = sBy('Zverev A.', 'Griekspoor T.');
ok(sv && sv.x[8] === 11 && sv.x[9] === '', 'before start: an ATP main-draw match Tennis-Data lacks is an era row on book 11 with no flag (Market edge reads it)');
ok(SBD.base === B.base, 'before start: the Database files are byte-identical (never a Database figure)');
ok(SBD.master.meta.bookCodes[11] === 'Pinnacle (approx.) before the start', 'before start: the master names book 11');
// ── founder 2026-11-03: another book, margin removed (books 12-23, one per book of the fixed order) — last of all, flag v
const OB = 'Tennis Explorer · other book · ';
fs.writeFileSync(path.join(tmp, 'approx-ob.csv'), [COLS].concat(approx.slice(1),
  TEC({ date: '2026-05-20', level: 'ch-q', tournament: 'Challenger Bordeaux - Qualification', winner: 'Bergs Z.', loser: 'Herbert P.H.', winnerKey: '1', loserKey: '3', psw: 1.70, psl: 2.43, eventKey: 601, source: OB + 'Interwetten', comment: 'Completed' }),
  TEC({ date: '2026-03-11', level: 'ch', tournament: 'Challenger Rome', winner: 'One A.', loser: 'Two B.', winnerKey: '41', loserKey: '42', psw: 1.52, psl: 2.92, eventKey: 701, source: OB + 'Betway', comment: 'Completed' }),
  TEC({ date: '2026-10-28', level: 'atp-nt', tournament: 'ATP Vienna', winner: 'Three C.', loser: 'Four D.', winnerKey: '43', loserKey: '44', psw: 1.94, psl: 2.06, eventKey: 702, source: OB + 'bwin', comment: 'Completed' }),
  TEC({ date: '2026-03-12', level: 'ch', tournament: 'Challenger Rome', winner: 'Five E.', loser: 'Six F.', winnerKey: '45', loserKey: '46', psw: 1.5, psl: 3.0, eventKey: 703, source: OB + 'Betfair', comment: 'Completed' }),
).join('\n') + '\n');
const OBD = build(Object.assign({}, FEEDS, { DB_YIELD_LOWER_APPROX: path.join(tmp, 'approx-ob.csv') }));
const ox = OBD.x.xRows.map((x, i) => ({ x, n: OBD.x.xNames[i] })), oBy = (w, l) => ox.find(o => o.n[0] === w && o.n[1] === l);
ok(oBy('Bergs Z.', 'Herbert P.H.').x[8] === 5, 'other book: start − 10 keeps a match it prices — the other book only fills a dash (601)');
const o1 = oBy('One A.', 'Two B.'), o2 = oBy('Three C.', 'Four D.');
ok(o1 && o1.x[8] === 13 && /v/.test(o1.x[9]) && /l/.test(o1.x[9]), `other book: a dash is filled on its own book code (Betway = 13), flags l + v (got ${o1 && JSON.stringify(o1.x)})`);
ok(o2 && o2.x[8] === 14 && o2.x[9] === 'v', 'other book: on an ATP main-draw era row it carries v (never a Market edge yield / ROI)');
ok(!oBy('Five E.', 'Six F.'), 'other book: a book outside the fixed order (Betfair, an exchange) is never read');
ok(OBD.base === B.base, 'other book: the Database files are byte-identical (never a Database figure)');
const AO = 'api-tennis · other book · ';
fs.writeFileSync(path.join(tmp, 'approx-ao.csv'), [COLS].concat(approx.slice(1),
  TEC({ date: '2026-03-11', level: 'ch', tournament: 'Challenger Rome', winner: 'One A.', loser: 'Two B.', winnerKey: '41', loserKey: '42', psw: 1.55, psl: 2.82, eventKey: 701, source: AO + '1xBet', comment: 'Completed' }),
  TEC({ date: '2026-03-11', level: 'ch', tournament: 'Challenger Rome', winner: 'One A.', loser: 'Two B.', winnerKey: '41', loserKey: '42', psw: 1.52, psl: 2.92, eventKey: 701, source: OB + 'Betway', comment: 'Completed' }),
  TEC({ date: '2026-03-13', level: 'ch', tournament: 'Challenger Rome', winner: 'Seven G.', loser: 'Eight H.', winnerKey: '47', loserKey: '48', psw: 1.7, psl: 2.43, eventKey: 704, source: AO + 'Marathon', comment: 'Completed' }),
).join('\n') + '\n');
const AOD = build(Object.assign({}, FEEDS, { DB_YIELD_LOWER_APPROX: path.join(tmp, 'approx-ao.csv') }));
const ax = AOD.x.xRows.map((x, i) => ({ x, n: AOD.x.xNames[i] })), aBy = (w, l) => ax.find(o => o.n[0] === w && o.n[1] === l);
ok(aBy('One A.', 'Two B.').x[8] === 13, 'api-tennis other book: ranks after Tennis Explorer\'s other book (Betway keeps 701)');
const a2 = aBy('Seven G.', 'Eight H.');
ok(a2 && a2.x[8] === 41 && /v/.test(a2.x[9]), 'api-tennis other book: alone it fills the dash on its own code (Marathon = 41), flag v');
ok(AOD.base === B.base && AOD.master.meta.bookCodes[40] === '1xBet (api-tennis, approx., margin removed)', 'api-tennis other book: never a Database figure; the master names its code');
ok(OBD.master.meta.bookCodes[12] === 'Interwetten (approx., margin removed)' && OBD.master.meta.bookCodes[23] === 'Unibet (approx., margin removed)', 'other book: the master names every code');
// founder 2026-11-03 ("find all the possible odds"): api-tennis after 16 Sep only fills a dash
fs.writeFileSync(path.join(tmp, 'approx-late.csv'), [COLS].concat(approx.slice(1),
  TEC({ date: '2026-10-22', level: 'atp-q', tournament: 'Lyon (France) - Qualification', winner: 'Late A.', loser: 'Late B.', winnerKey: '61', loserKey: '62', psw: 1.6, psl: 2.4, eventKey: 901, source: 'api-tennis Pinnacle', comment: 'Completed' }),
  TEC({ date: '2026-10-22', level: 'atp-q', tournament: 'Lyon (France) - Qualification', winner: 'Late A.', loser: 'Late B.', winnerKey: '61', loserKey: '62', psw: 1.62, psl: 2.35, eventKey: 901, source: 'Tennis Explorer · Pinnacle', comment: 'Completed' }),
  TEC({ date: '2026-10-23', level: 'atp-q', tournament: 'Lyon (France) - Qualification', winner: 'Late C.', loser: 'Late D.', winnerKey: '63', loserKey: '64', psw: 1.7, psl: 2.2, eventKey: 902, source: 'api-tennis Pinnacle', comment: 'Completed' }),
  TEC({ date: '2026-09-10', level: 'atp-q', tournament: 'X - Qualification', winner: 'Early A.', loser: 'Early B.', winnerKey: '65', loserKey: '66', psw: 1.6, psl: 2.4, eventKey: 903, source: 'api-tennis Pinnacle', comment: 'Completed' }),
  TEC({ date: '2026-09-10', level: 'atp-q', tournament: 'X - Qualification', winner: 'Early A.', loser: 'Early B.', winnerKey: '65', loserKey: '66', psw: 1.62, psl: 2.35, eventKey: 903, source: 'Tennis Explorer · Pinnacle', comment: 'Completed' }),
).join('\n') + '\n');
const LD = build(Object.assign({}, FEEDS, { DB_YIELD_LOWER_APPROX: path.join(tmp, 'approx-late.csv') }));
const lx = LD.x.xRows.map((x, i) => ({ x, n: LD.x.xNames[i] })), lBy = (w, l) => lx.find(o => o.n[0] === w && o.n[1] === l);
ok(lBy('Late A.', 'Late B.').x[8] === 8, 'after 16 Sep: api-tennis Pinnacle never displaces Tennis Explorer Pinnacle (901)');
ok(lBy('Late C.', 'Late D.').x[8] === 2, 'after 16 Sep: api-tennis Pinnacle alone fills the dash (902)');
ok(lBy('Early A.', 'Early B.').x[8] === 2, 'up to 16 Sep the order is unchanged: api-tennis Pinnacle over Tennis Explorer (903)');
ok(LD.base === B.base, 'after 16 Sep: the Database files are byte-identical (never a Database figure)');
// ── founder 2026-11-07 ("try to find prices for all matches"): a team match our archive prices with a CLOSE (the td-feed's
// team row, book 3) and that an 'atp-x' snapshot also holds is ONE match: the close stays, the snapshot is dropped and counted
// (lower.teamHasClose). Two rows made the join dash both (112 Davis Cup / Laver Cup sides of Sep 2026).
const FC = 'kind,date,tournament,series,court,surface,round,bestof,winner,loser,comment,psw,psl,archiveId,label,eventKey';
fs.writeFileSync(path.join(tmp, 'team-feed.csv'), [FC,
  ['team', '2026-09-18', 'ATP Davis Cup - World Group I', '', '', '', '', '3', 'Van De Zandschulp B.', 'Rodriguez J.A.', 'Completed', 1.016, 24.15, 9001, 'from Pinnacle history', ''].join(','),
].join('\n') + '\n');
fs.writeFileSync(path.join(tmp, 'approx-tm.csv'), [COLS].concat(approx.slice(1),
  TEC({ date: '2026-09-18', level: 'atp-x', tournament: 'ATP Davis Cup - World Group I', winner: 'Van De Zandschulp B.', loser: 'Rodriguez J.A.', winnerKey: '81', loserKey: '82', psw: 1.02, psl: 21, eventKey: 12170001, source: 'Tennis Explorer · Pinnacle', comment: 'Completed' }),
  // control: another team match on TE alone keeps its row
  TEC({ date: '2026-09-18', level: 'atp-x', tournament: 'ATP Davis Cup - World Group I', winner: 'Griekspoor T.', loser: 'Mejia N.', winnerKey: '83', loserKey: '84', psw: 1.17, psl: 5.64, eventKey: 12170002, source: 'Tennis Explorer · Pinnacle', comment: 'Completed' }),
).join('\n') + '\n');
const TMENV = Object.assign({}, FEEDS, { DB_YIELD_FEED: path.join(tmp, 'team-feed.csv'), DB_YIELD_LOWER_APPROX: path.join(tmp, 'approx-tm.csv') });
const TM = build(TMENV);
const tmN = TM.x.xRows.map((x, i) => ({ x, n: TM.x.xNames[i] }));
const vdz = tmN.filter(o => o.n[0] === 'Van De Zandschulp B.' && o.n[1] === 'Rodriguez J.A.');
ok(vdz.length === 1 && vdz[0].x[8] === 3 && /t/.test(vdz[0].x[9]), `one team match: our archive close (book 3) is the only row, the TE snapshot is dropped (got ${JSON.stringify(vdz.map(o => o.x[8]))})`);
ok(tmN.filter(o => o.n[0] === 'Griekspoor T.').length === 1 && tmN.find(o => o.n[0] === 'Griekspoor T.').x[8] === 8, 'one team match: a team match TE alone prices keeps its row (control)');
ok(TM.x.meta.lower.teamHasClose === 1, 'one team match: the drop is counted (lower.teamHasClose)');
{ const mp = path.join(ROOT, '.tmp-mutant-teamclose.js');
  fs.writeFileSync(mp, fs.readFileSync(path.join(ROOT, 'build-database-yield.js'), 'utf8').replace('if (tx) {', 'if (false) {'));
  try { const M = build(TMENV, mp); const n = M.x.xNames.filter(x => x[0] === 'Van De Zandschulp B.').length;
    ok(n === 2, `MUTANT (no team-close guard) keeps both rows of the match — the check turns red (got ${n})`);
    ok(M.base === TM.base, 'one team match: the Database files are byte-identical with and without the guard (never a Database figure)'); } finally { fs.rmSync(mp, { force: true }); } }
// ── founder 2026-11-07: a Davis Cup rubber the TE team import stores twice — keyed, and keyless with no player keys
// ("Davis Cup") — is ONE match by day + both names; the keyed copy stays (lower.sameMatchMergedByName)
fs.writeFileSync(path.join(tmp, 'approx-nm.csv'), [COLS].concat(approx.slice(1),
  TEC({ date: '2022-03-04', level: 'atp-x', tournament: 'ATP Davis Cup - World Group', winner: 'Bautista-Agut R.', loser: 'Boitan G.A.', winnerKey: '91', loserKey: '92', psw: 1.08, psl: 12.88, eventKey: 7701, source: 'Tennis Explorer · Pinnacle', comment: 'Completed' }),
  TEC({ date: '2022-03-04', level: 'atp-x', tournament: 'Davis Cup', winner: 'Bautista-Agut R.', loser: 'Boitan G.', psw: 1.08, psl: 12.88, source: 'Tennis Explorer · Pinnacle', comment: 'Completed' }),
  // control: the same two players on the next day stay two matches
  TEC({ date: '2022-03-05', level: 'atp-x', tournament: 'Davis Cup', winner: 'Bautista-Agut R.', loser: 'Boitan G.', psw: 1.1, psl: 9, source: 'Tennis Explorer · Pinnacle', comment: 'Completed' }),
).join('\n') + '\n');
const NM = build(Object.assign({}, FEEDS, { DB_YIELD_LOWER_APPROX: path.join(tmp, 'approx-nm.csv') }));
const nmN = NM.x.xRows.map((x, i) => ({ x, n: NM.x.xNames[i] })).filter(o => o.n[0] === 'Bautista-Agut R.');
ok(nmN.filter(o => o.x[0] === 20220304).length === 1 && nmN.find(o => o.x[0] === 20220304).x[4] === 'ATP Davis Cup - World Group',
  `one team match by name: the keyed and keyless copies are one row, the keyed one (got ${JSON.stringify(nmN.map(o => [o.x[0], o.x[4]]))})`);
ok(nmN.some(o => o.x[0] === 20220305), 'one team match by name: the next day is another match (control)');
ok(NM.x.meta.lower.sameMatchMergedByName === 1, 'one team match by name: the merge is counted');
ok(NM.base === B.base, 'one team match by name: the Database files are byte-identical');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\ntest-lower-master: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
