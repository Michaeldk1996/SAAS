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
         '2026-05-25,French Open,Grand Slam,Outdoor,Clay,1st Round,5,Van Assche L.,Gaubas V.,10,20,Completed,1.8,2.0,,,,,,,file'], // May on: dash
};
const FILES = ['build-database-yield.js', 'settlement.js', 'td-identity.js', 'build-odds-performance.js', 'market-edge-core.js',
  'build-favourites-by-round.js', 'build-tournament-market.js'];
const root = process.env.B365W_ROOT || ROOT;
const req = createRequire(import.meta.url);

function run() {
  const d = mkdtempSync(join(tmpdir(), 'b365w-'));
  try {
    for (const f of FILES) copyFileSync(join(root, f), join(d, f));
    mkdirSync(join(d, 'odds-archive'));
    for (const [y, rows] of Object.entries(ROWS)) writeFileSync(join(d, 'odds-archive', `${y}.csv`), [H, ...rows].join('\n') + '\n');
    const r = spawnSync(process.execPath, ['build-database-yield.js'], { cwd: d, encoding: 'utf8' });
    if (r.status !== 0) return { err: r.stderr.slice(-400) };
    const db = JSON.parse(readFileSync(join(d, 'database-yield.json'), 'utf8'));
    const names = JSON.parse(readFileSync(join(d, 'database-yield-players.json'), 'utf8'));
    const x = JSON.parse(readFileSync(join(d, 'database-yield-x.json'), 'utf8'));
    const master = JSON.parse(readFileSync(join(d, 'database-yield-master.json'), 'utf8'));
    const F = req(join(d, 'build-favourites-by-round.js'));
    const fav = F.buildFavouritesByRound({ master, csvRows: [], progression: null, now: '2026-10-26T00:00:00Z' });
    return { db, names, x, master, fav };
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
    ['bsp-consult-dashboard.html', 'the page has no reason text', "  nopin: 'No Pinnacle close: only Bet365 priced it, and Bet365 is used for Jan–Apr 2026 only' };", ' };'],
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
