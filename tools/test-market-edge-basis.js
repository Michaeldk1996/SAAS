#!/usr/bin/env node
/**
 * test-market-edge-basis.js — founder ruling TEN-310 (2026-09-27), locked. SUPERSEDES R1 (2026-09-17,
 * "Pinnacle closing only").
 *
 *   The player-profile Market edge uses the Match analysis Market edge tab's rules ("Both use this
 *   tab's rules"): every figure — headline, role cards, price bands, the cumulative curve and the tour
 *   baseline — is struck on Pinnacle close, else Bet365 close (one book per match); favourite = price
 *   under 2.00; a row's band is decided by its own price on the half-open ladder of market-edge-core.js.
 *
 * Rule 5: a ruling applied without a lock is not applied. Reads the COMMITTED shards (the floor that
 * ships if the pipeline's builder fails), so this fails if someone reverts the builder AND if someone
 * commits shards built by a pre-TEN-310 builder.
 *
 * Trap 5 — "tests that cannot fail". Every assertion below is paired with a negative control in
 * `controls()`: a mutation of a real shard that MUST turn that assertion red.
 */
const fs = require('fs');
const path = require('path');
const core = require('../market-edge-core.js');

const DIR = path.join(__dirname, '..', 'market-edge');
const INDEX = path.join(__dirname, '..', 'market-edge-index.json');
const BASIS = 'Pinnacle closing, else Bet365 closing';

let failures = 0;
const fail = (msg) => { console.error(`  FAIL ${msg}`); failures += 1; };
const ok = (msg) => console.log(`  ok   ${msg}`);

/** The ruling on one shard. Returns an array of violation strings (empty = passes). */
function checkShard(name, s) {
  const bad = [];
  if (s.priceBasis !== BASIS) bad.push(`${name}: priceBasis ${JSON.stringify(s.priceBasis)} != ${JSON.stringify(BASIS)}`);
  const summaries = [
    ['headline', s.headline],
    ...Object.keys(s.roles || {}).map((k) => [`roles.${k}`, s.roles[k]]),
    ...['favourite', 'underdog'].flatMap((g) => ((s.bands || {})[g] || []).map((b, i) => [`bands.${g}[${i}]`, b])),
    ...Object.keys(s.surface || {}).map((k) => [`surface.${k}`, s.surface[k]]),
  ];
  for (const [where, sum] of summaries) {
    if (!sum) continue;
    // every priced row is on the basis: the book mix adds to n exactly
    if (sum.book && sum.book.pinnacle + sum.book.bet365 !== sum.n) bad.push(`${name}: ${where} book mix ${JSON.stringify(sum.book)} does not add to n=${sum.n}`);
    if (sum.n > 0 && sum.units == null) bad.push(`${name}: ${where} has n=${sum.n} but no units — the "At 1u flat" figure would dash`);
  }
  // one curve point per summed row
  if (Array.isArray(s.curve) && s.headline && s.curve.length !== s.headline.n) {
    bad.push(`${name}: curve has ${s.curve.length} points against headline n=${s.headline.n}`);
  }
  for (const m of (s.matches || [])) {
    if (m.inBasis !== (m.band != null)) { bad.push(`${name}: row ${m.date} (book=${m.book}, band ${m.band}) inBasis=${m.inBasis} — every banded priced row is on the basis, nothing else`); break; }
    if (!m.inBasis) continue;
    // role and band follow the price alone (the tab's rule), never the opponent's price. `price` on the
    // row is rounded to 2dp and the band stamp comes from the unrounded price, so the role is checked
    // against the stamp, and the stamp against the rounded price everywhere but at the 2.00 edge.
    const expectRole = m.band ? (m.band[0] === 'f' ? 'fav' : 'dog') : null;
    if (m.band == null || m.role !== expectRole) { bad.push(`${name}: row ${m.date} price ${m.price} role ${m.role} band ${m.band} — role must follow the band (price < 2.00 = favourite)`); break; }
    if (Math.abs(m.price - 2.0) > 0.006 && (m.price < 2.0) !== (m.role === 'fav')) { bad.push(`${name}: row ${m.date} price ${m.price} is ${m.role} — favourite is price < 2.00`); break; }
    // the stamp is the core's band for the price (rows at a band edge may differ only by the 2dp rounding)
    const ids = ['f101_120', 'f121_140', 'f141_164', 'f165_199', 'd200_249', 'd250_349', 'd350_599', 'd600_up'];
    const EDGES = [1.21, 1.41, 1.65, 2.0, 2.5, 3.5, 6.0];
    if (m.band !== ids[core.bandOf(m.price)] && !EDGES.some((e) => Math.abs(m.price - e) < 0.006)) { bad.push(`${name}: row ${m.date} price ${m.price} stamped ${m.band}, the core says ${ids[core.bandOf(m.price)]}`); break; }
  }
  // reconciliation: favourite + underdog = headline; no level role any more; bands cover the headline
  if (s.roles && s.headline) {
    const parts = (s.roles.favourite.n || 0) + (s.roles.underdog.n || 0);
    if ((s.roles.level && s.roles.level.n) || 0) bad.push(`${name}: ${s.roles.level.n} "level" rows — the price-only role has no level`);
    if (parts !== s.headline.n) bad.push(`${name}: roles sum to ${parts} against headline n=${s.headline.n}`);
    const banded = ['favourite', 'underdog'].reduce((a, g) => a + (s.bands[g] || []).reduce((x, b) => x + (b.n || 0), 0), 0);
    if (banded !== s.headline.n) bad.push(`${name}: bands sum to ${banded} against headline n=${s.headline.n}`);
    if (s.coverage && s.coverage.bandStraddle) bad.push(`${name}: bandStraddle ${s.coverage.bandStraddle} — impossible on the price-only ladder`);
  }
  return bad;
}

/** The ruling on the index. */
function checkIndex(idx) {
  const bad = [];
  if (idx.priceBasis !== BASIS) bad.push(`index priceBasis ${JSON.stringify(idx.priceBasis)} != ${JSON.stringify(BASIS)}`);
  const tour = (idx.tour || {}).all;
  if (!tour) bad.push('index carries no tour baseline');
  else {
    // The baseline is COMPUTED on the same basis: Bet365 fallback sides are in it, and the mix adds up.
    if (!tour.book || !(tour.book.bet365 > 0)) bad.push('index tour baseline has no Bet365 side — the superseded Pinnacle-only baseline');
    else if (tour.book.pinnacle + tour.book.bet365 !== tour.n) bad.push(`index tour baseline book mix does not add to n=${tour.n}`);
    if (tour.yield === -3.79) bad.push('index tour baseline is the hard-coded -3.79% constant, not a computed figure');
    if (!(tour.n > 10000)) bad.push(`index tour baseline rests on ${tour.n} sides — too few to be the whole archive`);
  }
  return bad;
}

// ── run ──────────────────────────────────────────────────────────────────────
console.log('TEN-310 · Market edge is struck on Pinnacle, else Bet365 closing; favourite = price < 2.00');

if (!fs.existsSync(DIR) || !fs.existsSync(INDEX)) {
  console.error('market-edge/ or market-edge-index.json missing — nothing to check');
  process.exit(1);
}

const idx = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const idxBad = checkIndex(idx);
idxBad.forEach(fail);
if (!idxBad.length) ok(`index on basis "${idx.priceBasis}", tour baseline ${idx.tour.all.yield}% over ${idx.tour.all.n} sides (${idx.tour.all.book.bet365} Bet365)`);

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
if (files.length < 300) fail(`only ${files.length} shards present`);

let priced = 0, rows = 0, excluded = 0, b365 = 0;
for (const f of files) {
  const s = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  checkShard(f, s).forEach(fail);
  if (s.headline && s.headline.n) priced += 1;
  rows += (s.headline && s.headline.n) || 0;
  excluded += (s.coverage && s.coverage.excludedNonPinnacle) || 0;
  b365 += (s.headline && s.headline.book && s.headline.book.bet365) || 0;
}
if (!priced) fail('no shard carries a priced sample — the join is empty');
else ok(`${files.length} shards, ${priced} with a priced sample, ${rows} rows summed (${b365} Bet365 fallback), ${excluded} priced rows excluded`);
if (!b365) fail('no Bet365 fallback row in any headline — the Pinnacle-only build is back');

// ── negative controls (trap 5) ───────────────────────────────────────────────
// Each mutates a REAL shard in memory in the exact way a regression would, and
// demands the matching assertion turn red. A control that does not fire means the
// assertion above it is vacuous.
function controls() {
  const sample = files.map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')))
    .find((s) => s.headline && s.headline.n > 20 && s.matches && s.matches.length);
  if (!sample) { fail('no shard fat enough to run the negative controls on'); return 0; }
  const clone = () => JSON.parse(JSON.stringify(sample));
  const cases = [
    ['priceBasis reverted to R1 wording', (s) => { s.priceBasis = 'Pinnacle closing only'; }],
    ['a Bet365 row dropped from the headline (R1 regression)', (s) => { s.headline.book.bet365 = Math.max(0, s.headline.book.bet365 - 1); s.headline.book.pinnacle -= 1; }],
    ['a band summing a row it does not count', (s) => { s.bands.underdog[0].book.bet365 += 1; }],
    ['units dropped from a priced summary', (s) => { s.headline.units = null; }],
    ['the cumulative curve drawn over a wider population', (s) => { s.curve.push({ d: '2030-01-01', c: 0 }); }],
    ['a priced row left out of the basis', (s) => { s.matches[0].inBasis = false; }],
    ['a row stamped into the neighbouring band', (s) => {
      const m = s.matches.find((x) => x.band === 'f121_140' && x.price > 1.25 && x.price < 1.35); m.band = 'f101_120'; m.role = 'fav';
    }],
    ['a row given the opponent-relative role (a 2.10 favourite)', (s) => {
      const m = s.matches.find((x) => x.price >= 2.1); m.role = 'fav';
    }],
    ['a "level" role coming back', (s) => { s.roles.level = Object.assign({}, s.roles.level, { n: 1 }); }],
    ['the role split no longer reconciling to the headline', (s) => { s.roles.favourite.n += 1; }],
  ];
  let fired = 0;
  for (const [what, mutate] of cases) {
    const s = clone();
    mutate(s);
    const bad = checkShard('control', s);
    if (bad.length) { fired += 1; console.log(`  ctl  fires on: ${what}`); }
    else fail(`CONTROL DID NOT FIRE — the assertion for "${what}" is vacuous`);
  }
  // Index control, same posture.
  const ic = JSON.parse(JSON.stringify(idx));
  ic.tour.all.yield = -3.79;
  if (checkIndex(ic).length) { fired += 1; console.log('  ctl  fires on: tour baseline reverted to the hard-coded -3.79%'); }
  else fail('CONTROL DID NOT FIRE — the -3.79% constant check is vacuous');
  const ic2 = JSON.parse(JSON.stringify(idx));
  ic2.tour.all.n -= ic2.tour.all.book.bet365; ic2.tour.all.book.bet365 = 0;
  if (checkIndex(ic2).length) { fired += 1; console.log('  ctl  fires on: tour baseline back on Pinnacle only'); }
  else fail('CONTROL DID NOT FIRE — the Pinnacle-only baseline check is vacuous');
  return fired;
}

console.log('negative controls');
const fired = controls();
console.log(`  ${fired} control(s) fired`);
if (fired < 12) fail(`only ${fired} of 12 controls fired`);

// ── build stamp (TEN-263 follow-up, founder 2026-09-24) ─────────────────────
// 1. The REAL builder, run in a temp root over the committed archive, writes builtAt
//    (ISO, this run) and builtFromCommit (GITHUB_SHA) on the index and every shard.
// 2. The REAL "Assert site completeness" market-edge block, cut out of pipeline.yml,
//    passes a fresh index and fails the committed floor (older builtAt, or none).
// 3. The modal's "rebuilt DD Mon HH:MMZ" text, sliced out of player-profile-v2.js.
console.log('build stamp');
{
  const os = require('os');
  const { execFileSync, spawnSync } = require('child_process');
  const ROOT = path.join(__dirname, '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'market-edge-stamp-'));
  try {
    for (const f of ['build-market-edge.js', 'build-odds-performance.js', 'market-edge-core.js']) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
    for (const f of ['odds-archive', 'court-speed-map.json', 'playing-styles.json']) if (fs.existsSync(path.join(ROOT, f))) fs.symlinkSync(path.join(ROOT, f), path.join(tmp, f));
    fs.writeFileSync(path.join(tmp, 'player-profiles.json'), JSON.stringify({ players: { 47: { name: 'J. Sinner' } } }));
    const t0 = Date.now();
    execFileSync(process.execPath, [path.join(tmp, 'build-market-edge.js'), '--quiet'], { env: Object.assign({}, process.env, { GITHUB_SHA: 'abc123stamp' }), stdio: 'pipe' });
    const built = JSON.parse(fs.readFileSync(path.join(tmp, 'market-edge-index.json'), 'utf8'));
    const bt = Date.parse(built.builtAt);
    if (typeof built.builtAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(built.builtAt) && bt >= t0 - 1000 && bt <= Date.now()) ok(`builder stamps the index builtAt ${built.builtAt}`);
    else fail(`builder index builtAt ${JSON.stringify(built.builtAt)} is not this run`);
    if (built.builtFromCommit === 'abc123stamp') ok('builder stamps builtFromCommit from GITHUB_SHA'); else fail(`builtFromCommit ${JSON.stringify(built.builtFromCommit)}`);
    const shard = JSON.parse(fs.readFileSync(path.join(tmp, 'market-edge', '47.json'), 'utf8'));
    if (shard.builtAt && shard.builtAt === built.builtAt) ok('each shard carries the same builtAt (the modal prints it)'); else fail(`shard builtAt ${JSON.stringify(shard.builtAt)}`);

    // 2 · the workflow assert, executed.
    const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pipeline.yml'), 'utf8');
    const blk = [...yml.matchAll(/\n\s*node -e '\n([\s\S]*?)\n\s*'\n/g)].map((m) => m[1]).find((b) => b.includes('market-edge-index.json priceBasis'));
    if (!blk) fail('market-edge assert block not found in pipeline.yml');
    else {
      const site = path.join(tmp, 'site'); fs.mkdirSync(path.join(site, '_site', 'market-edge'), { recursive: true });
      for (let i = 0; i < 300; i++) fs.writeFileSync(path.join(site, '_site', 'market-edge', `${i}.json`), JSON.stringify({ priceBasis: BASIS, headline: { n: 5, units: 1, book: { pinnacle: 4, bet365: 1 } } }));
      const run = (builtAt, start) => {
        const ix = { priceBasis: BASIS, tour: { all: { n: 3, yield: -4.7, book: { pinnacle: 2, bet365: 1 } } } };
        if (builtAt !== undefined) ix.builtAt = builtAt;
        fs.writeFileSync(path.join(site, '_site', 'market-edge-index.json'), JSON.stringify(ix));
        const env = Object.assign({}, process.env); delete env.MARKET_EDGE_BUILD_START;
        if (start) env.MARKET_EDGE_BUILD_START = start;
        const r = spawnSync(process.execPath, ['-e', blk], { cwd: site, env, encoding: 'utf8' });
        // A stale index is a run WARNING (exit 0 + ::warning::), not a failure: the red gate is unruled.
        return r.status !== 0 ? 'exit ' + r.status : /::warning::market-edge stale/.test(r.stdout) ? 'warn' : 'ok';
      };
      const start = '2026-09-24T14:05:00Z';
      const cases = [
        ['index built this run', run('2026-09-24T14:05:03.120Z', start), 'ok'],
        ['index built in the same second the step started', run('2026-09-24T14:05:00.400Z', start), 'ok'],
        ['committed floor shipped (older builtAt)', run('2026-09-23T09:00:00.000Z', start), 'warn'],
        ['committed floor shipped (no builtAt: pre-stamp index)', run(undefined, start), 'warn'],
        ['build step never ran (no start recorded)', run('2026-09-24T14:05:03.120Z', null), 'warn'],
      ];
      for (const [what, got, want] of cases) {
        if (got === want) ok(`assert ${want}: ${what}`);
        else fail(`assert ${got} (want ${want}) for: ${what}`);
      }
      // The step records its start BEFORE building and the builder's exit status after
      // (the post-deploy red step reads both — tools/test-ten263-pipeline.js).
      if (/- name: Build market-edge shards \(best-effort\)\n\s+run: \|\n\s+echo "MARKET_EDGE_BUILD_START=\$\(date -u \+%Y-%m-%dT%H:%M:%SZ\)" >> "\$GITHUB_ENV"\n\s+ME_RC=0\n\s+node build-market-edge\.js --quiet \|\| ME_RC=\$\?\n/.test(yml)) ok('the build step records its start before building');
      else fail('the market-edge build step does not record MARKET_EDGE_BUILD_START before building');
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  // 3 · the modal's stamp text.
  const pp2 = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  const st = pp2.indexOf('function marketBuiltText(');
  if (st < 0) fail('marketBuiltText not found in player-profile-v2.js');
  else {
    let d = 0, i = pp2.indexOf('{', st); for (; i < pp2.length; i++) { if (pp2[i] === '{') d++; else if (pp2[i] === '}') { d--; if (!d) break; } }
    const T = new Function(pp2.slice(st, i + 1) + '\nreturn marketBuiltText;')();
    const a = T({ builtAt: '2026-09-24T14:05:09.000Z' }), b = T({}), c = T({ builtAt: 'nonsense' }), e = T({ builtAt: '2026-03-02T07:09:00Z' });
    if (a === 'rebuilt 24 Sep 14:05Z' && e === 'rebuilt 2 Mar 07:09Z') ok(`modal stamp reads "${a}"`); else fail(`modal stamp reads ${JSON.stringify([a, e])}`);
    if (b === '' && c === '') ok('no stamp, or an unparseable one, prints nothing'); else fail(`missing stamp printed ${JSON.stringify([b, c])}`);
    if (/esc\(marketBuiltText\(mk\)\)/.test(pp2)) ok('renderMarketModal prints it'); else fail('renderMarketModal does not print marketBuiltText');
  }
}

if (failures) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log('\nTEN-310 locked: Market edge is Pinnacle, else Bet365 closing (favourite = price < 2.00), and every assertion has a control that fails without it.');
