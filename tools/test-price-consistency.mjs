// tools/price-consistency.mjs (founder ruling 2026-10-17, item 1: one price per match, on every page) — its own test.
// Runs the REAL guard, in headless Chrome, over a tiny site built from this checkout's code and the committed Database
// store, with one player (J. Sinner) and one match the Database holds (Australian Open 2025 R1 v N. Jarry, Pinnacle
// 1.02 / 29.95):
//   1. every surface agrees → exit 0, and the match was checked on the tab, Form and Market edge (no vacuous pass);
//   2. control: the Market edge shard shows another price for that match → exit 1, "Market edge shard ≠ Database";
//   3. control: the closes shard's captured step shows another price → exit 1, "Head to Head captured step ≠ Database";
//   4. control: a site with no player to check → exit 1 (a check on an empty set is not a check);
//   5. wiring: pipeline.yml runs the guard before the site-data upload, fail-closed;
//   6. lag: Market edge's index names the master and its latest match; controls: a day behind, a floor with no source.
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log('  PASS ', name); } else { fail++; console.log('  FAIL ', name, '\n       ', String(detail).slice(-900)); } };
const chrome = process.env.CHROME_BIN || ['/opt/pw-browsers/chromium', '/usr/bin/google-chrome'].find(existsSync);

// 5 · wiring (no browser needed)
const yml = readFileSync(join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
const step = yml.indexOf('node tools/price-consistency.mjs --site _site'), up = yml.indexOf('- name: Upload the built site for publish.yml (site-data)');
const line = step < 0 ? '' : yml.slice(yml.lastIndexOf('\n', step), yml.indexOf('\n', step));
check('pipeline.yml runs the guard on the built site before the site-data upload', step > 0 && up > step, { step, up });
check('the step is fail-closed (no "|| true", no continue-on-error)', step > 0 && !/\|\|\s*true/.test(line)
  && !/continue-on-error/.test(yml.slice(yml.lastIndexOf('- name:', step), step)), line);

if (!chrome) { console.log('  SKIP  the browser checks: no Chrome (set CHROME_BIN) — said out loud, not a pass'); }
else {
  const site = mkdtempSync(join(tmpdir(), 'pc-site-'));
  try {
    execFileSync('bash', [join(ROOT, 'tools/site-code.sh'), ROOT, site]);
    for (const f of ['database-yield.json', 'database-yield-players.json']) copyFileSync(join(ROOT, f), join(site, f));
    const K = '47', NAME = 'J. Sinner';
    writeFileSync(join(site, 'career-history-index.json'), JSON.stringify({ players: { [K]: { name: NAME } } }));
    writeFileSync(join(site, 'player-profiles.json'), JSON.stringify({ players: { [K]: { name: NAME } } }));
    mkdirSync(join(site, 'career-history')); mkdirSync(join(site, 'match-closes')); mkdirSync(join(site, 'market-edge'));
    writeFileSync(join(site, 'career-history', K + '.json'), JSON.stringify({ matches: [
      { date: '2025-01-13', year: 2025, tournament: 'Australian Open', level: 'atp', surface: 'hard', round: '1/64-finals', opponent: 'N. Jarry',
        oppKey: '400', won: true, result: '3-0', eventKey: 9001, sets: [[6, 3], [6, 2], [6, 1]] }] }));
    const closes = (cap) => JSON.stringify({ rows: [['2025-01-13', 'Jarry N.', 1, 1.02, 29.95, 1.01, 26, 0, '400']], cap });
    const shard = (p) => JSON.stringify({ playerKey: K, name: NAME, matches: [{ date: '2025-01-13', event: 'Australian Open', round: '1st Round', opp: 'Jarry N.',
      won: true, price: p, oppPrice: 29.95, book: 'pinnacle', inBasis: true }] });
    const run = () => spawnSync(process.execPath, [join(ROOT, 'tools/price-consistency.mjs'), '--site', site, '--sample', '1'],
      { encoding: 'utf8', env: Object.assign({}, process.env, { CHROME_BIN: chrome }), timeout: 180000 });
    const summary = (r) => { const m = /### price-consistency (\{.*\})/.exec(r.stdout || ''); return m ? JSON.parse(m[1]) : null; };

    writeFileSync(join(site, 'match-closes', K + '.json'), closes([]));
    writeFileSync(join(site, 'market-edge', K + '.json'), shard(1.02));
    let r = run(), s = summary(r);
    check('1 · every surface agrees → exit 0', r.status === 0, (r.stdout || '') + (r.stderr || ''));
    check('1 · the match was really checked on the tab, the Form tab and Market edge', s && s.dbHeld === 1 && s.checked.tab === 1 && s.checked.form === 1 && s.checked.me === 1, JSON.stringify(s));

    writeFileSync(join(site, 'market-edge', K + '.json'), shard(1.05));
    r = run();
    check('2 · control: a Market edge shard with another price → exit 1', r.status === 1 && /Market edge shard ≠ Database/.test(r.stdout), (r.stdout || '') + (r.stderr || ''));
    writeFileSync(join(site, 'market-edge', K + '.json'), shard(1.02));

    writeFileSync(join(site, 'match-closes', K + '.json'), closes([['2025-01-13', '400', 1.03, 25.0, null, null, 9001, 'captured']]));
    r = run();
    check('3 · control: a captured close with another price (the Head to Head page step) → exit 1', r.status === 1 && /captured step ≠ Database/.test(r.stdout), (r.stdout || '') + (r.stderr || ''));
    writeFileSync(join(site, 'match-closes', K + '.json'), closes([]));

    // 6 · lag (founder ruling 2026-10-17): Market edge's latest match = the master's, and its index names the master
    const b = JSON.parse(readFileSync(join(site, 'database-yield.json'), 'utf8'));
    let last = 0; for (const k of ['rows', 'retRows', 'tieRows']) for (const x of b[k] || []) if (x[0] > last) last = x[0];
    const iso = `${String(last).slice(0, 4)}-${String(last).slice(4, 6)}-${String(last).slice(6, 8)}`;
    writeFileSync(join(site, 'market-edge-index.json'), JSON.stringify({ source: 'database-yield-master.json', latestMatch: iso, players: {} }));
    r = run(); s = summary(r);
    check('6 · Market edge built from the master with its latest match → exit 0, lag checked', r.status === 0 && s && s.lag && s.lag.checked === true, (r.stdout || '') + (r.stderr || ''));
    writeFileSync(join(site, 'market-edge-index.json'), JSON.stringify({ source: 'database-yield-master.json', latestMatch: '2026-09-13', players: {} }));
    r = run();
    check('6 · control: Market edge one match day behind the master → exit 1, "lags the master"', r.status === 1 && /lags the master/.test(r.stderr), (r.stdout || '') + (r.stderr || ''));
    writeFileSync(join(site, 'market-edge-index.json'), JSON.stringify({ latestMatch: iso, players: {} }));
    r = run();
    check('6 · control: a committed floor (no source) → exit 1', r.status === 1 && /lags the master/.test(r.stderr), (r.stdout || '') + (r.stderr || ''));
    rmSync(join(site, 'market-edge-index.json'));

    writeFileSync(join(site, 'career-history', K + '.json'), JSON.stringify({ matches: [] }));
    r = run();
    check('4 · control: nothing to check → exit 1, never a vacuous pass', r.status === 1, (r.stdout || '') + (r.stderr || ''));
  } finally { rmSync(site, { recursive: true, force: true }); }
}
console.log(`\ntest-price-consistency: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
