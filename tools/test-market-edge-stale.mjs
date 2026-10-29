#!/usr/bin/env node
// market-edge-stale (founder 2026-10-29): "no stale or mislabelled Market edge content can reach the site".
//  1. The committed floor (market-edge/ + market-edge-index.json, shipped only when build-market-edge.js fails) holds
//     names and no price, and its index names no source (tools/market-edge-floor.js --check).
//  2. A FORCED builder failure (master missing, master corrupt) exits non-zero, leaves the floor as it is (no price), and
//     the publish guard (tools/price-consistency.mjs, its lag check) refuses a site carrying that floor — exit 1 — so a
//     failed builder never publishes a price, let alone one the Database does not hold.
//  3. CONTROL: the 28 Sep floor shape (a priced row, an index naming the master) is caught by the same check.
//  4. The profile's empty state says why: dashed by the close rules / no main-draw match / no reason claimed.
import { spawnSync } from 'node:child_process';
import { cpSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { floorFaults } = require('./market-edge-floor.js');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const shardNames = (d) => readdirSync(d).filter((f) => /^\d+\.json$/.test(f));

// 1 · the committed floor
const f1 = floorFaults(join(ROOT, 'market-edge'), join(ROOT, 'market-edge-index.json'));
ok(f1.length === 0, `committed floor: 0 faults (${shardNames(join(ROOT, 'market-edge')).length} shards)` + (f1.length ? ' — ' + f1.slice(0, 3).join('; ') : ''));

// 2 · forced failure, twice
const DEPS = ['build-market-edge.js', 'build-odds-performance.js', 'market-edge-core.js', 'settlement.js', 'td-identity.js', 'player-profiles.json'];
for (const [label, master] of [['master missing', null], ['master corrupt', '{"meta": {"cols": [']]) {
  const d = mkdtempSync(join(tmpdir(), 'me-stale-'));
  try {
    for (const f of DEPS) copyFileSync(join(ROOT, f), join(d, f));
    cpSync(join(ROOT, 'market-edge'), join(d, 'market-edge'), { recursive: true });
    copyFileSync(join(ROOT, 'market-edge-index.json'), join(d, 'market-edge-index.json'));
    if (master != null) writeFileSync(join(d, 'database-yield-master.json'), master);
    const r = spawnSync(process.execPath, ['build-market-edge.js', '--quiet'], { cwd: d, encoding: 'utf8' });
    ok(r.status !== 0, `${label}: the builder fails (exit ${r.status})`);
    const f2 = floorFaults(join(d, 'market-edge'), join(d, 'market-edge-index.json'));
    ok(f2.length === 0, `${label}: what is left to ship is the floor — no price, no source`);
    // the site that run would assemble: the Database files + that floor
    const site = join(d, '_site'); mkdirSync(site);
    for (const f of ['bsp-consult-dashboard.html', 'database-yield.json', 'database-yield-players.json']) copyFileSync(join(ROOT, f), join(site, f));
    writeFileSync(join(site, 'career-history-index.json'), '{}');
    cpSync(join(d, 'market-edge'), join(site, 'market-edge'), { recursive: true });
    copyFileSync(join(d, 'market-edge-index.json'), join(site, 'market-edge-index.json'));
    const g = spawnSync(process.execPath, [join(ROOT, 'tools/price-consistency.mjs'), '--site', site], { encoding: 'utf8', timeout: 60000 });
    ok(g.status === 1 && /lags the master/.test(g.stderr), `${label}: the publish guard refuses the site (exit ${g.status}: ${(g.stderr || '').trim().split('\n').pop()})`);
  } finally { rmSync(d, { recursive: true, force: true }); }
}

// 3 · CONTROL: the old floor's shape is caught
{
  const d = mkdtempSync(join(tmpdir(), 'me-stale-c-'));
  try {
    cpSync(join(ROOT, 'market-edge'), join(d, 'market-edge'), { recursive: true });
    const ix = JSON.parse(readFileSync(join(ROOT, 'market-edge-index.json'), 'utf8'));
    const f = shardNames(join(d, 'market-edge'))[0];
    const s = JSON.parse(readFileSync(join(d, 'market-edge', f), 'utf8'));
    s.matches = [{ date: '2026-09-13', price: 1.5, oppPrice: 2.6 }];
    writeFileSync(join(d, 'market-edge', f), JSON.stringify(s));
    Object.assign(ix, { floor: undefined, source: 'database-yield-master.json', latestMatch: '2026-09-13' });
    writeFileSync(join(d, 'ix.json'), JSON.stringify(ix));
    const fc = floorFaults(join(d, 'market-edge'), join(d, 'ix.json'));
    ok(fc.some((x) => /priced row/.test(x)) && fc.some((x) => /names a source/.test(x)) && fc.some((x) => /not stamped/.test(x)),
      `CONTROL: a priced row + an index naming the master is caught (${fc.length} faults)`);
  } finally { rmSync(d, { recursive: true, force: true }); }
}

// 4 · the empty state's words (the profile's own functions) and the host bridge (the page's own function)
{
  const src = readFileSync(join(ROOT, 'player-profile-v2.js'), 'utf8');
  const a = src.indexOf('  function marketEmptyWhy('), b = src.indexOf('  function renderMarketModal(');
  ok(a > 0 && b > a, 'profile: marketEmptyWhy / marketEmptyText found');
  const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(src.slice(a, b), ctx);
  const say = (d) => { ctx.window.pp2MarketDashed = () => d; return vm.runInContext('marketEmptyText("1")', ctx); };
  const t1 = say({ main: 14, dashed: 3, priced: 0 });
  ok(/^No confirmed closing prices for these matches\. 3 of his 14 ATP main-draw matches have no Pinnacle close/.test(t1) && !/Challenger/.test(t1), 'dashed by the close rules: "' + t1 + '"');
  const t2 = say({ main: 0, dashed: 0, priced: 0 });
  ok(/Challenger or qualifying/.test(t2), 'no main-draw match: the Challenger / qualifying line');
  const t3 = say({ main: 9, dashed: 0, priced: 0 }), t4 = say(null);
  ok(t3 === 'No priced matches on record.' && t4 === 'No priced matches on record.', 'main-draw matches with another reason, or not answered: no reason claimed');
  delete ctx.window.pp2MarketDashed;
  ok(vm.runInContext('marketEmptyText("1")', ctx) === 'No priced matches on record.', 'no host bridge: no reason claimed');
  ok(/marketEmptyWhy\(p\.key\)\.dashed \? 'no confirmed closing prices'/.test(src), 'profile box: "no confirmed closing prices" when dashed');
  ok(!/marketEmptyWhy[\s\S]{0,400}pp2DbJoinNeed/.test(src.slice(a, b)), 'the empty state never requests the join itself (TEN-402 R2 load order)');

  const page = readFileSync(join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
  const pa = page.indexOf('const PP2_TEAM_EVENT'), pb = page.indexOf('window.pp2MarketDashed = pp2MarketDashed;');
  ok(pa > 0 && pb > pa, 'page: pp2MarketDashed found');
  const pc = { window: { careerHistory: {} }, _careerHistoryShards: {}, _sfDbJoinSt: 'ready', _sfDbJoin: {}, fhRoundCode: (r) => r || '—',
    sfDbPxRows: (k, n, views) => { const out = views.map((v) => (v.date === '2026-01-20' ? { price: 1.5 } : null)); out.why = views.map((v) => (v.date === '2026-05-01' ? 'od10' : v.date === '2026-06-01' ? 'nopin' : 'none')); return out; } };
  vm.createContext(pc); vm.runInContext(page.slice(pa, pb), pc);
  pc.window.careerHistory['7'] = [
    { date: '2026-01-20', level: 'atp', round: 'R32', opponent: 'A. B', won: true },
    { date: '2026-05-01', level: 'atp', round: 'R32', opponent: 'C. D', won: false },
    { date: '2026-06-01', level: 'atp', round: 'R16', opponent: 'E. F', won: true },
    { date: '2026-07-01', level: 'atp', round: 'R16', opponent: 'G. H', won: true },
    { date: '2026-05-02', level: 'atp', round: 'Qualifying', opponent: 'I. J', won: true },
    { date: '2026-05-03', level: 'atp', round: 'R64', opponent: 'K. L', won: true, walkover: true },
    { date: '2026-05-04', level: 'chitf', round: 'R32', opponent: 'M. N', won: true }];
  const r = vm.runInContext('pp2MarketDashed("7")', pc);
  ok(r && r.main === 4 && r.dashed === 2 && r.priced === 1 && r.team === 0, `bridge: 4 ATP main-draw, 2 dashed by the close rules (od10 + nopin), 1 priced (${JSON.stringify(r)})`);
  pc._sfDbJoinSt = 'loading';
  ok(JSON.stringify(vm.runInContext('pp2MarketDashed("7")', pc)) === '{"pending":true}', 'bridge: join not loaded → pending (no reason claimed; market-edge-box)');
}

console.log(fails ? `\n${fails} check(s) failed` : '\nmarket-edge-stale: all checks pass');
process.exit(fails ? 1 : 0);
