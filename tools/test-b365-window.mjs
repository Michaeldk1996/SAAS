// Founder ruling 2026-10-26: ATP main draw is Pinnacle only — the Bet365 "B" fallback prices a Database row only in
// Jan–Apr 2026. Runs the REAL build-database-yield.js (temp dir) on Tennis-Data rows, then the REAL
// build-favourites-by-round.js on its master (the Almaty "past editions" column), then checks the page's dash reason.
// Each rule has a control (a Jan–Apr 2026 Bet365 row stays "B"; a Pinnacle row is untouched; pre-2010 is unchanged), and
// the mutants below must each turn it red.
// Run: node tools/test-b365-window.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const H = 'date,tournament,series,court,surface,round,bestof,winner,loser,wrank,lrank,comment,b365w,b365l,psw,psl,maxw,maxl,avgw,avgl,avgsrc';
const ROWS = {
  2008: ['2008-10-06,Old Open,International,Indoor,Hard,1st Round,3,Old A.,Older B.,10,20,Completed,1.5,2.5,,,,,,,file'],          // pre-2010: era shard, unchanged
  2025: ['2025-10-13,Almaty Open,ATP250,Indoor,Hard,1st Round,3,Alpha A.,Beta B.,10,20,Completed,1.44,2.75,,,,,,,file',         // Bet365 only: dash
         '2025-10-14,Almaty Open,ATP250,Indoor,Hard,1st Round,3,Gamma G.,Delta D.,10,20,Completed,1.30,3.40,1.33,3.50,,,,,file'], // Pinnacle: untouched
  2026: ['2026-03-10,Indian Wells Masters,Masters 1000,Outdoor,Hard,1st Round,3,Eps E.,Zet Z.,10,20,Completed,1.6,2.3,,,,,,,file', // Jan–Apr 2026: B
         '2026-04-30,Madrid Open,Masters 1000,Outdoor,Clay,1st Round,3,Eta E.,Theta T.,10,20,Completed,1.7,2.1,,,,,,,file',       // the window's last day: B
         '2026-05-25,French Open,Grand Slam,Outdoor,Clay,1st Round,5,Van Assche L.,Gaubas V.,10,20,Completed,1.8,2.0,,,,,,,file', // May on: dash
         '2026-04-20,Barcelona Open,ATP500,Outdoor,Clay,1st Round,3,Mu M.,Nu N.,10,20,Completed,1.5,2.6,,,,,,,file',       // start - 10 + Bet365 in window: dash, no fall-through
         '2026-06-10,Stuttgart Open,ATP250,Outdoor,Grass,1st Round,3,Xi X.,Omi O.,10,20,Completed,,,,,,,,,file',            // start - 10 + api-tennis: dash, no fall-through
         '2026-07-01,Wimbledon,Grand Slam,Outdoor,Grass,1st Round,5,Pi P.,Rho R.,10,20,Completed,,,,,,,,,file'],            // api-tennis approx only: book 2 (control)
};
const APPROX = ['date,tournament,winner,loser,psw,psl,eventKey,snapshotId,source,cutTs,gapToStartS',
  '2026-04-20,Barcelona Open,Mu M.,Nu N.,1.55,2.5,1,1,oddspapi Pinnacle (start − 10),2026-04-20T10:50:00Z,30',
  '2026-06-10,Stuttgart Open,Xi X.,Omi O.,1.7,2.2,2,2,oddspapi Pinnacle (start − 10),2026-06-10T10:50:00Z,30',
  '2026-06-10,Stuttgart Open,Xi X.,Omi O.,1.72,2.15,2,3,api-tennis Pinnacle,,',
  '2026-07-01,Wimbledon,Pi P.,Rho R.,1.3,3.6,3,4,api-tennis Pinnacle,,'];
const FILES = ['build-database-yield.js', 'settlement.js', 'td-identity.js', 'build-odds-performance.js', 'market-edge-core.js',
  'build-favourites-by-round.js', 'build-tournament-market.js', 'build-market-edge.js'];
const root = process.env.B365W_ROOT || ROOT;
const req = createRequire(import.meta.url);

function run() {
  const d = mkdtempSync(join(tmpdir(), 'b365w-'));
  try {
    for (const f of FILES) copyFileSync(join(root, f), join(d, f));
    mkdirSync(join(d, 'odds-archive'));
    for (const [y, rows] of Object.entries(ROWS)) writeFileSync(join(d, 'odds-archive', `${y}.csv`), [H, ...rows].join('\n') + '\n');
    writeFileSync(join(d, 'approx.csv'), APPROX.join('\n') + '\n');
    const r = spawnSync(process.execPath, ['build-database-yield.js'], { cwd: d, encoding: 'utf8', env: { ...process.env, DB_YIELD_APPROX: join(d, 'approx.csv') } });
    if (r.status !== 0) return { err: r.stderr.slice(-400) };
    const db = JSON.parse(readFileSync(join(d, 'database-yield.json'), 'utf8'));
    const names = JSON.parse(readFileSync(join(d, 'database-yield-players.json'), 'utf8'));
    const x = JSON.parse(readFileSync(join(d, 'database-yield-x.json'), 'utf8'));
    const master = JSON.parse(readFileSync(join(d, 'database-yield-master.json'), 'utf8'));
    const F = req(join(d, 'build-favourites-by-round.js'));
    const fav = F.buildFavouritesByRound({ master, csvRows: [], progression: null, now: '2026-10-26T00:00:00Z' });
    const baselines = JSON.parse(readFileSync(join(d, 'tour-baselines.json'), 'utf8'));
    // Market edge: the real builder over the same master (founder 2026-10-17: it prices from the master, never the CSVs)
    mkdirSync(join(d, 'market-edge'));
    // founder 2026-10-28: the shards a LAST build left (the committed floor) — Xi's start − 10 match still Bet365-priced, and a
    // player with no master row at all; the real builder must rewrite both (the 14 Market edge prices the Database dashed)
    const stale = (name, date) => JSON.stringify({ name, headline: { n: 1 }, matches: [{ date, event: 'Old Open', opp: 'Old O.', won: true, price: 1.9, oppPrice: 1.9, book: 'bet365-archive', inBasis: true }] });
    writeFileSync(join(d, 'market-edge', '1.json'), stale('X. Xi', '2026-06-10'));
    writeFileSync(join(d, 'market-edge', '9.json'), stale('Q. Stale', '2026-07-21'));
    writeFileSync(join(d, 'player-profiles.json'), JSON.stringify({ players: { 1: { name: 'X. Xi' }, 2: { name: 'M. Mu' }, 3: { name: 'P. Pi' } } }));
    const me = spawnSync(process.execPath, ['build-market-edge.js', '--quiet'], { cwd: d, encoding: 'utf8' });
    const meOut = me.status === 0 ? Object.fromEntries(['1', '2', '3', '9'].map(k => { try { return [k, JSON.parse(readFileSync(join(d, 'market-edge', k + '.json'), 'utf8'))]; } catch { return [k, null]; } })) : { err: me.stderr.slice(-300) };
    return { db, names, x, master, fav, baselines, me: meOut };
  } finally { rmSync(d, { recursive: true, force: true }); }
}

let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('  PASS  ' + n); } catch (e) { fail++; console.log('  FAIL  ' + n + '\n        ' + String(e.message).split('\n')[0]); } };
const R = run();
const byName = () => (R.db.rows || []).map((r, i) => [String(r[0]), R.names.names[i][0], r[8]]);
// founder ruling 2026-10-30 (replacing 2026-10-26): the Database's ATP main draw is Pinnacle only — a Bet365-only match is a
// Database dash and the price join's "B", in the era shard behind flag 'b'
const xB = () => (R.x.xRows || []).filter(r => String(r[9] || '').includes('b')).map(r => [String(r[0]), r[8]]);
check('the builder ran', () => assert.ok(!R.err, R.err));
// founder 2026-10-26 ("finish and close" item 2, interim): the Bet365 close shows, marked "B", outside Jan–Apr 2026 too
check('2026-10-30: a Bet365-only row is no Database row, at any date (Almaty 2025, French Open 2026, Jan–Apr 2026 included)', () => {
  assert.ok(!byName().some(([d]) => ['20251013', '20260525', '20260310', '20260430'].includes(d)));
  assert.ok(!(R.db.rows || []).some(r => r[8] === 1), 'no Bet365 book in the Database rows');
});
check('2026-10-30: each is the join\'s "B" — the era shard, book 1, flag b', () => {
  assert.deepEqual(xB().filter(([d]) => ['20251013', '20260525', '20260310', '20260430'].includes(d)).map(x => x[1]), [1, 1, 1, 1]);
});
check('control: a Pinnacle row is untouched (book 0)', () => assert.deepEqual(byName().filter(([d]) => d === '20251014').map(x => x[2]), [0]));
check('control: before 2010 (the era shard) Bet365 still prices — the ruling\'s count does not cover it', () => {
  assert.ok(R.x.xRows.some(r => r[0] === 20081006 && r[8] === 1));
});
check('interim: no Bet365-only row is unpriced ("nopin" never emitted)', () => {
  assert.ok(!R.x.uRows.some(u => u[3] === 'nopin'));
});
check('meta.bet365Window says the window is off (interim) and drops nothing', () => {
  assert.deepEqual(R.db.meta.bet365Window, { from: '2026-01-01', to: '2026-04-30', interim: true, droppedOutside: { rows: 0, byYear: {} } });
});
check('Favourites (Almaty, past editions): a Database figure — the Pinnacle row only (n 1, b365 0)', () => {
  const p = R.fav.events.Almaty.past.rows[0];
  assert.deepEqual([p.n, p.b365], [1, 0]);
});
const od10Dates = ['20260420', '20260610'];
check('start − 10: every book-5 row is a Database dash — no fall-through to api-tennis or a Database Bet365 row', () => {
  const got = byName();
  for (const d of od10Dates) assert.ok(!got.some(([x]) => x === d), d + ' must not be priced');
  assert.ok(!(R.db.rows || []).some(r => r[8] === 5), 'no book 5 left');
});
check('control: an api-tennis snapshot with no start − 10 still prices (book 2)', () => assert.deepEqual(byName().filter(([d]) => d === '20260701').map(x => x[2]), [2]));
check('start − 10: its own dash reason "od10"', () => {
  // the one with Bet365 (20 Apr) is the join's "B" (no dash reason); the other keeps "od10"
  assert.deepEqual(R.x.uRows.filter(u => od10Dates.includes(String(u[0]))).map(u => [String(u[0]), u[3]]), [['20260610', 'od10']]);
});
check('meta.od10Dropped counts them, and how many had another price it did not fall back to', () => {
  assert.deepEqual(R.db.meta.od10Dropped, { rows: 2, byMonth: { '2026-04': 1, '2026-06': 1 }, hadApiTennisSnapshot: 1, hadBet365: 1, pricedByTe: 0, pricedByTeBet365: 0, bet365InJoin: 1 });
});
check('single price: the master holds no book 5; a dash with no Bet365 is in no master row', () => {
  const c = R.master.meta.cols, bi = c.indexOf('book'), di = c.indexOf('date');
  assert.ok(!R.master.rows.some(r => r[bi] === 5));
  assert.ok(!R.master.rows.some(r => r[di] === '2026-06-10'), 'the start − 10 match with no Bet365 is in no master row');
  assert.ok(R.master.rows.some(r => r[di] === '2026-04-20' && r[bi] === 1), 'the start − 10 match with Bet365 is the master\'s Bet365 row (the join\'s "B")');
  const fi = c.indexOf('flags');
  assert.ok(['2025-10-13', '2026-05-25'].every(d => R.master.rows.some(r => r[di] === d && r[bi] === 1 && String(r[fi]).includes('b'))), 'the B rows are in the master as Bet365, flag b');
});
check('single price: tour-baselines counts only the priced rows (no dashed match in its n)', () => {
  const n = JSON.stringify(R.baselines).match(/"n":\s*(\d+)/);
  assert.ok(n && +n[1] === (R.db.rows || []).length, 'baseline n = the Database rows: ' + (n && n[1]) + ' vs ' + (R.db.rows || []).length);
});
check('single price: Market edge (the real builder) holds no price for the dashed matches; the control prices', () => {
  assert.ok(!R.me.err, R.me.err);
  const has = (k, date) => ((R.me[k] && R.me[k].matches) || []).some(m => m.date === date && m.price != null);
  assert.equal(has('1', '2026-06-10'), false, 'Xi v Omi (start − 10) is a dash in Market edge');
  // founder 2026-10-30: Market edge = the Pinnacle order, then Bet365 — a start − 10 match with Bet365 is "B" there
  assert.equal(((R.me['2'] && R.me['2'].matches) || []).find(m => m.date === '2026-04-20')?.book, 'bet365-archive', 'Mu v Nu (start − 10, Bet365): "B" in Market edge');
  assert.equal(has('3', '2026-07-01'), true, 'control: Pi v Rho (api-tennis approx.) still prices in Market edge');
});
check('one price: a shard the last build left is rewritten — a player whose rows all left the master gets an empty shard, never his old price', () => {
  assert.ok(!R.me.err, R.me.err);
  assert.ok(R.me['9'], 'the stale shard of a player with no master row is still there (rewritten, not deleted)');
  assert.equal(R.me['9'].name, 'Q. Stale', 'its name is kept (the roster reads it)');
  assert.deepEqual((R.me['9'].matches || []).filter(m => m.price != null), [], 'no price left in it');
  assert.equal(((R.me['1'] && R.me['1'].matches) || []).some(m => m.price != null), false, 'Xi: the stale Bet365 row is gone');
});
check('single price: the Tournament cards and every page join read the same database-yield rows (one source)', () => {
  assert.match(readFileSync(join(root, 'build-tournament-market.js'), 'utf8'), /const YIELD = path\.join\(ROOT, 'database-yield\.json'\);/);
  const html = readFileSync(join(root, 'bsp-consult-dashboard.html'), 'utf8');
  assert.match(html, /od10: 'No Pinnacle close: the only Pinnacle price was read 10 min before a recorded start that can run late, so it may be in play'/);
});
check('single price on every page surface: the ONE Database join (Head to Head, Form, profile, Series, Tournament tab) — no Pinnacle, no Bet365 = a dash; Bet365 = "B"', () => {
  const html = readFileSync(join(root, 'bsp-consult-dashboard.html'), 'utf8');
  const slice = name => { const st = html.indexOf(`function ${name}(`); assert.ok(st > 0, name); let dep = 0, i = html.indexOf('{', st);
    for (; i < html.length; i++) { if (html[i] === '{') dep++; else if (html[i] === '}') { dep--; if (!dep) break; } } return html.slice(st, i + 1); };
  const cl = name => { const m = new RegExp(`^\\s*const ${name} = [^\\n]*$`, 'm').exec(html); assert.ok(m, name); return m[0].replace(/\/\/[^'\n]*$/, ''); };
  const fhDayNum = new Function(`${slice('fhDayNum')}\nreturn fhDayNum;`)();
  const J = new Function('fhDayNum', `const FH_DASHC = '—';\n${['H2H_PAGE_PRICE_WINDOW', 'H2H_PAGE_MATCH_WINDOW', 'H2H_PAGE_START_WINDOW', 'H2H_PAGE_ROW_WINDOW', 'H2H_TD_ROUND', 'H2H_PAGE_BEFORE_RANK'].map(cl).join('\n')}
${['fhIsInitial', 'fhNameKey', 'psRoundAbbr', 'h2hRoundLabel', 'fhRoundCode', 'h2hTdIx', 'h2hTdKey', 'h2hTdSame', 'h2hTdRound', 'h2hTdEvent', 'h2hNearest', 'h2hPriceJoin'].map(slice).join('\n')}
return h2hPriceJoin;`)(fhDayNum);
  globalThis.FH_SRC = { td: 'Tennis-Data', cap: 'captured', hist: 'from Pinnacle history' };
  const dbJ = new Function(`${slice('dbPriceJoinRows')}\nreturn dbPriceJoinRows;`)()(R.db, R.names, R.x);   // the era shard joins too
  const one = (date, a, b) => { const v = [{ date, won: true, round: null }]; J(v, { full: a }, { full: b }, dbJ); return v[0]; };
  assert.equal(one('2026-06-10', 'X. Xi', 'O. Omi').price ?? null, null, 'start − 10 match: a dash');
  // founder 2026-10-30: a start − 10 match with a Bet365 price is the join's "B" (a Database dash, flag b)
  assert.equal(one('2026-04-20', 'M. Mu', 'N. Nu').book, 'B', 'start − 10 match with Bet365: "B" in the join');
  assert.equal(one('2025-10-13', 'A. Alpha', 'B. Beta').book, 'B', 'Bet365-only 2025 prices as "B" in the join');
  assert.equal(one('2026-07-01', 'P. Pi', 'R. Rho').book, 'A', 'control: the api-tennis snapshot prices');
});
console.log(`\ntest-b365-window: ${pass} passed, ${fail} failed`);

// ── mutants (only when not already running one) ────────────────────────────────────────────────────────────────────
if (!process.env.B365W_ROOT) {
  const MUT = [
    ['build-database-yield.js', 'interim off: the Jan–Apr-only window (B rows dashed)', 'const B365_INTERIM = true;', 'const B365_INTERIM = false;'],
    ['build-database-yield.js', 'the interim not recorded in meta', 'interim: B365_INTERIM, droppedOutside', 'droppedOutside'],
    ['build-database-yield.js', 'start − 10 shown again', "          if (pick === 'od') {", "          if (false) {"],
    ['build-database-yield.js', 'start − 10 dash reason lost', "od10Cut ? 'od10' : b365Cut", "b365Cut"],
    ['build-database-yield.js', 'start − 10 rows not counted', "            od10Dropped.rows++;", "            void 0;"],
    ['build-market-edge.js', 'a shard the last build left is kept (no rewrite)', "    if (!m || perPlayer.has(m[1])) continue;", "    continue;"],
    ['bsp-consult-dashboard.html', 'the page has no start − 10 reason', "  od10: 'No Pinnacle close: the only Pinnacle price was read 10 min before a recorded start that can run late, so it may be in play' };", ' };'],
  ];
  let caught = 0;
  for (const [f, name, from, to] of MUT) {
    const d = mkdtempSync(join(tmpdir(), 'b365wm-'));
    for (const g of [...FILES, 'bsp-consult-dashboard.html']) copyFileSync(join(ROOT, g), join(d, g));
    const src = readFileSync(join(d, f), 'utf8');
    if (!src.includes(from)) { console.log(`  FAIL  mutant ${name}: anchor gone`); fail++; rmSync(d, { recursive: true, force: true }); continue; }
    writeFileSync(join(d, f), src.split(from).join(to));
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8', env: { ...process.env, B365W_ROOT: d } });
    rmSync(d, { recursive: true, force: true });
    const red = r.status !== 0;
    if (red) caught++; else fail++;
    console.log(`  ${red ? 'PASS' : 'FAIL'}  mutant caught: ${name}${red ? '  (' + (r.stdout.split('\n').find(l => l.includes('FAIL')) || '').trim().replace(/^FAIL\s+/, '') + ')' : ' — SURVIVED'}`);
  }
  console.log(`mutants: ${caught}/${MUT.length} caught`);
}
process.exit(fail ? 1 : 0);
