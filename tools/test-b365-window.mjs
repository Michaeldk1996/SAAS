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
    writeFileSync(join(d, 'player-profiles.json'), JSON.stringify({ players: { 1: { name: 'X. Xi' }, 2: { name: 'M. Mu' }, 3: { name: 'P. Pi' } } }));
    const me = spawnSync(process.execPath, ['build-market-edge.js', '--quiet'], { cwd: d, encoding: 'utf8' });
    const meOut = me.status === 0 ? Object.fromEntries(['1', '2', '3'].map(k => { try { return [k, JSON.parse(readFileSync(join(d, 'market-edge', k + '.json'), 'utf8'))]; } catch { return [k, null]; } })) : { err: me.stderr.slice(-300) };
    return { db, names, x, master, fav, baselines, me: meOut };
  } finally { rmSync(d, { recursive: true, force: true }); }
}

let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('  PASS  ' + n); } catch (e) { fail++; console.log('  FAIL  ' + n + '\n        ' + String(e.message).split('\n')[0]); } };
const R = run();
const byName = () => (R.db.rows || []).map((r, i) => [String(r[0]), R.names.names[i][0], r[8]]);
check('the builder ran', () => assert.ok(!R.err, R.err));
check('a Bet365-only row outside Jan–Apr 2026 is a dash (not a Database row): Almaty 2025 R1, French Open 2026', () => {
  const got = byName();
  assert.ok(!got.some(([d]) => d === '20251013'), 'Almaty 2025-10-13 must not be priced');
  assert.ok(!got.some(([d]) => d === '20260525'), 'French Open 2026-05-25 must not be priced');
});
check('control: Jan–Apr 2026 Bet365 rows stay "B" (book 1), the last day included', () => {
  const got = byName();
  assert.deepEqual(got.filter(([d]) => d === '20260310' || d === '20260430').map(x => x[2]), [1, 1]);
});
check('control: a Pinnacle row is untouched (book 0)', () => assert.deepEqual(byName().filter(([d]) => d === '20251014').map(x => x[2]), [0]));
check('control: before 2010 (the era shard) Bet365 still prices — the ruling\'s count does not cover it', () => {
  assert.ok(R.x.xRows.some(r => r[0] === 20081006 && r[8] === 1));
});
check('the dash says why: reason "nopin" on the unpriced rows', () => {
  const u = R.x.uRows.filter(u => u[0] === 20251013 || u[0] === 20260525).map(u => u[3]);
  assert.deepEqual(u, ['nopin', 'nopin']);
});
check('meta.bet365Window names the window and counts the rows it no longer prices, by year', () => {
  assert.deepEqual(R.db.meta.bet365Window, { from: '2026-01-01', to: '2026-04-30', droppedOutside: { rows: 2, byYear: { 2025: 1, 2026: 1 } } });
});
check('Favourites (Almaty, past editions): the B row leaves the column — n 1, b365 0 (was n 2, b365 1 with the old rule)', () => {
  const p = R.fav.events.Almaty.past.rows[0];
  assert.deepEqual([p.n, p.b365], [1, 0]);
});
check('Favourites (ATP tour, indoor): no B row in 2016–2025', () => {
  assert.equal(R.fav.baseline.Indoor.rows.reduce((m, r) => Math.max(m, r.b365), 0), 0);
});
const od10Dates = ['20260420', '20260610'];
check('start − 10: every book-5 row is a dash — no fall-through to Bet365 (in window) or api-tennis', () => {
  const got = byName();
  for (const d of od10Dates) assert.ok(!got.some(([x]) => x === d), d + ' must not be priced');
  assert.ok(!(R.db.rows || []).some(r => r[8] === 5), 'no book 5 left');
});
check('control: an api-tennis snapshot with no start − 10 still prices (book 2)', () => assert.deepEqual(byName().filter(([d]) => d === '20260701').map(x => x[2]), [2]));
check('start − 10: its own dash reason "od10"', () => {
  assert.deepEqual(R.x.uRows.filter(u => od10Dates.includes(String(u[0]))).map(u => u[3]), ['od10', 'od10']);
});
check('meta.od10Dropped counts them, and how many had another price it did not fall back to', () => {
  assert.deepEqual(R.db.meta.od10Dropped, { rows: 2, byMonth: { '2026-04': 1, '2026-06': 1 }, hadApiTennisSnapshot: 1, hadBet365: 1 });
});
check('single price: the master holds no book 5 and none of the dashed matches', () => {
  const c = R.master.meta.cols, bi = c.indexOf('book'), di = c.indexOf('date');
  assert.ok(!R.master.rows.some(r => r[bi] === 5));
  assert.ok(!R.master.rows.some(r => ['2026-04-20', '2026-06-10', '2025-10-13', '2026-05-25'].includes(r[di])));
});
check('single price: tour-baselines counts only the priced rows (no dashed match in its n)', () => {
  const n = JSON.stringify(R.baselines).match(/"n":\s*(\d+)/);
  assert.ok(n && +n[1] === (R.db.rows || []).length, 'baseline n = the Database rows: ' + (n && n[1]) + ' vs ' + (R.db.rows || []).length);
});
check('single price: Market edge (the real builder) holds no price for the dashed matches; the control prices', () => {
  assert.ok(!R.me.err, R.me.err);
  const has = (k, date) => ((R.me[k] && R.me[k].matches) || []).some(m => m.date === date && m.price != null);
  assert.equal(has('1', '2026-06-10'), false, 'Xi v Omi (start − 10) is a dash in Market edge');
  assert.equal(has('2', '2026-04-20'), false, 'Mu v Nu (start − 10) is a dash in Market edge');
  assert.equal(has('3', '2026-07-01'), true, 'control: Pi v Rho (api-tennis approx.) still prices in Market edge');
});
check('single price: the Tournament cards and every page join read the same database-yield rows (one source)', () => {
  assert.match(readFileSync(join(root, 'build-tournament-market.js'), 'utf8'), /const YIELD = path\.join\(ROOT, 'database-yield\.json'\);/);
  const html = readFileSync(join(root, 'bsp-consult-dashboard.html'), 'utf8');
  assert.match(html, /od10: 'No Pinnacle close: the only Pinnacle price was read 10 min before a recorded start that can run late, so it may be in play'/);
});
check('single price on every page surface: the ONE Database join (Head to Head, Form, profile, Series, Tournament tab) gives the dashed matches no price', () => {
  const html = readFileSync(join(root, 'bsp-consult-dashboard.html'), 'utf8');
  const slice = name => { const st = html.indexOf(`function ${name}(`); assert.ok(st > 0, name); let dep = 0, i = html.indexOf('{', st);
    for (; i < html.length; i++) { if (html[i] === '{') dep++; else if (html[i] === '}') { dep--; if (!dep) break; } } return html.slice(st, i + 1); };
  const cl = name => { const m = new RegExp(`^\\s*const ${name} = [^\\n]*$`, 'm').exec(html); assert.ok(m, name); return m[0].replace(/\/\/[^'\n]*$/, ''); };
  const fhDayNum = new Function(`${slice('fhDayNum')}\nreturn fhDayNum;`)();
  const J = new Function('fhDayNum', `const FH_DASHC = '—';\n${['H2H_PAGE_PRICE_WINDOW', 'H2H_PAGE_MATCH_WINDOW', 'H2H_PAGE_START_WINDOW', 'H2H_PAGE_ROW_WINDOW', 'H2H_TD_ROUND', 'H2H_PAGE_BEFORE_RANK'].map(cl).join('\n')}
${['fhIsInitial', 'fhNameKey', 'psRoundAbbr', 'h2hRoundLabel', 'fhRoundCode', 'h2hTdIx', 'h2hTdKey', 'h2hTdSame', 'h2hTdRound', 'h2hTdEvent', 'h2hNearest', 'h2hPriceJoin'].map(slice).join('\n')}
return h2hPriceJoin;`)(fhDayNum);
  globalThis.FH_SRC = { td: 'Tennis-Data', cap: 'captured', hist: 'from Pinnacle history' };
  const dbJ = new Function(`${slice('dbPriceJoinRows')}\nreturn dbPriceJoinRows;`)()(R.db, R.names);
  const one = (date, a, b) => { const v = [{ date, won: true, round: null }]; J(v, { full: a }, { full: b }, dbJ); return v[0]; };
  assert.equal(one('2026-06-10', 'X. Xi', 'O. Omi').price ?? null, null, 'start − 10 match: a dash');
  assert.equal(one('2026-04-20', 'M. Mu', 'N. Nu').price ?? null, null, 'start − 10 match in Jan–Apr with Bet365: a dash');
  assert.equal(one('2025-10-13', 'A. Alpha', 'B. Beta').price ?? null, null, 'Bet365-only 2025: a dash');
  assert.equal(one('2026-07-01', 'P. Pi', 'R. Rho').book, 'A', 'control: the api-tennis snapshot prices');
});
check('the page names the reason', () => {
  const html = readFileSync(join(root, 'bsp-consult-dashboard.html'), 'utf8');
  assert.match(html, /nopin: 'No Pinnacle close: only Bet365 priced it, and Bet365 is used for Jan–Apr 2026 only'/);
});
console.log(`\ntest-b365-window: ${pass} passed, ${fail} failed`);

// ── mutants (only when not already running one) ────────────────────────────────────────────────────────────────────
if (!process.env.B365W_ROOT) {
  const MUT = [
    ['build-database-yield.js', 'no window: Bet365 everywhere (the old rule)', "(season < WINDOW_START || (dB >= B365_FROM && dB <= B365_TO))", 'true'],
    ['build-database-yield.js', 'the window ends a day early', "const B365_FROM = '2026-01-01', B365_TO = '2026-04-30';", "const B365_FROM = '2026-01-01', B365_TO = '2026-04-29';"],
    ['build-database-yield.js', 'the ruling applied before 2010 too', '(season < WINDOW_START || (dB', '((dB'],
    ['build-database-yield.js', 'the dash reason lost', "b365Cut ? 'nopin' : one ? 'one' : 'nobook'", "one ? 'one' : 'nobook'"],
    ['build-database-yield.js', 'the dropped rows not counted', '      if (b365Cut) { b365Dropped.rows++;', '      if (false) { b365Dropped.rows++;'],
    ['build-database-yield.js', 'start − 10 shown again', "          if (pick === 'od') {", "          if (false) {"],
    ['build-database-yield.js', 'start − 10 falls through to Bet365 / api-tennis', ": od10Cut ? -1 : AP ?", ": AP ?"],
    ['build-database-yield.js', 'start − 10 dash reason lost', "od10Cut ? 'od10' : b365Cut", "b365Cut"],
    ['build-database-yield.js', 'start − 10 rows not counted', "            od10Dropped.rows++;", "            void 0;"],
    ['bsp-consult-dashboard.html', 'the page has no start − 10 reason', "  od10: 'No Pinnacle close: the only Pinnacle price was read 10 min before a recorded start that can run late, so it may be in play' };", ' };'],
    ['bsp-consult-dashboard.html', 'the page has no reason text', "  nopin: 'No Pinnacle close: only Bet365 priced it, and Bet365 is used for Jan–Apr 2026 only',\n", ''],
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
