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
ok(lrows.length === 4, `four lower-level matches priced (got ${lrows.length})`);
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
ok(A.base === B.base, 'the Database files are byte-identical with and without the lower levels (never a Database figure)');
ok(A.x.meta.counts.lower === 4 && A.master.meta.counts.x === B.master.meta.counts.x + 4, 'the era shard and the master count the lower rows');
// mutant: the source order reversed (api-tennis over start − 10) → the source checks go red
const src = fs.readFileSync(path.join(ROOT, 'build-database-yield.js'), 'utf8');
const anchor = 'const LOWER_RANK = { 3: 0, 4: 0, 5: 1, 2: 2, 6: 3 };';
ok(src.split(anchor).length === 2, 'the mutant anchor is found exactly once');
const mp = path.join(ROOT, '.mutant-lower-yield.js');
fs.writeFileSync(mp, src.replace(anchor, 'const LOWER_RANK = { 3: 0, 4: 0, 5: 2, 2: 1, 6: 0 };'));
let red = false;
try { const M = build(FEEDS, mp); const m = M.x.xRows.map((x, i) => [x, M.x.xNames[i]]).filter(([x]) => String(x[9]).includes('l'));
  const r1 = m.find(([, n]) => n[1] === 'Herbert P.H.'), r2 = m.find(([, n]) => n[1] === 'Roe R.');
  red = !(r1 && r1[0][8] === 5) || !(r2 && r2[0][8] === 2); }
finally { fs.unlinkSync(mp); }
ok(red, 'MUTANT (the sources ranked the other way round) turns the source-order checks red');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\ntest-lower-master: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
