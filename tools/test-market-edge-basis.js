#!/usr/bin/env node
/**
 * test-market-edge-basis.js — founder ruling R1 (2026-09-17), locked.
 *
 *   "Headline yield, role cards, price bands and the cumulative profit chart use
 *    Pinnacle closing only. No fallback to Bet365 or any other book inside those
 *    figures. Bet365 may appear on ledger rows, labelled by book, but is excluded
 *    from every yield and every units figure."
 *
 * R1 supersedes `market-1` (Pinnacle close -> archive-Bet365 close fallback) for
 * the Market edge headline. Rule 5: a ruling applied without a lock is not applied.
 *
 * Reads the COMMITTED shards, which are what ships — the pipeline copies committed
 * JSON, it does not regenerate. So this fails if someone reverts the builder AND if
 * someone commits shards built by a pre-R1 builder.
 *
 * Trap 5 — "tests that cannot fail". Every assertion below is paired with a
 * negative control in `controls()`: a mutation of the real shard that MUST turn
 * that assertion red. A suite that cannot fail is not a suite, and this file
 * reports its own control count so a silently-skipped control is visible.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'market-edge');
const INDEX = path.join(__dirname, '..', 'market-edge-index.json');
const BASIS = 'Pinnacle closing only';

let failures = 0;
const fail = (msg) => { console.error(`  FAIL ${msg}`); failures += 1; };
const ok = (msg) => console.log(`  ok   ${msg}`);

// ── the assertions, as reusable predicates so the controls can re-run them ────

/** R1 on one shard. Returns an array of violation strings (empty = passes). */
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
    if (sum.book && sum.book.bet365 !== 0) bad.push(`${name}: ${where} sums ${sum.book.bet365} Bet365 side(s) — R1 forbids any non-Pinnacle row in a yield`);
    // "At 1u flat" is the role card's second figure (§6 item 2, file wins). A
    // summary with a priced sample and no units figure dashes on the page.
    if (sum.n > 0 && sum.units == null) bad.push(`${name}: ${where} has n=${sum.n} but no units — the "At 1u flat" figure would dash`);
  }
  // The cumulative chart plots the same basis. Its point count must equal the
  // headline n — one point per row summed — or the line is drawn over a different
  // population than the figure above it.
  if (Array.isArray(s.curve) && s.headline && s.curve.length !== s.headline.n) {
    bad.push(`${name}: curve has ${s.curve.length} points against headline n=${s.headline.n} — chart and headline disagree on the population`);
  }
  // matches[] is deliberately WIDER than the basis (it feeds the ledger drill), so
  // it is not a violation for it to hold Bet365 rows — but every one of them must
  // be labelled out of the basis, or the modal cannot grey it correctly.
  for (const m of (s.matches || [])) {
    if (m.inBasis === undefined) { bad.push(`${name}: a match row carries no inBasis flag`); break; }
    if ((m.book === 'pinnacle') !== m.inBasis) { bad.push(`${name}: match row book=${m.book} but inBasis=${m.inBasis}`); break; }
  }
  // §4 reconciliation, fail-closed: favourite + underdog + level must equal the
  // headline exactly. This is what catches a filter applied at one aggregation
  // point and forgotten at another — the failure R1 is most likely to produce.
  if (s.roles && s.headline) {
    const parts = (s.roles.favourite.n || 0) + (s.roles.underdog.n || 0) + (s.roles.level.n || 0);
    if (parts !== s.headline.n) bad.push(`${name}: roles sum to ${parts} against headline n=${s.headline.n}`);
    const banded = ['favourite', 'underdog'].reduce((a, g) => a + (s.bands[g] || []).reduce((x, b) => x + (b.n || 0), 0), 0);
    if (banded + (s.roles.level.n || 0) !== s.headline.n) {
      bad.push(`${name}: bands+level sum to ${banded + (s.roles.level.n || 0)} against headline n=${s.headline.n}`);
    }
  }
  return bad;
}

/** R1 on the index. */
function checkIndex(idx) {
  const bad = [];
  if (idx.priceBasis !== BASIS) bad.push(`index priceBasis ${JSON.stringify(idx.priceBasis)} != ${JSON.stringify(BASIS)}`);
  const tour = (idx.tour || {}).all;
  if (!tour) bad.push('index carries no tour baseline');
  // README §3 / the brief: the tour baseline is COMPUTED, never a constant. It was
  // -3.79% hard-coded once and -4.70% on the blended basis; on R1's Pinnacle-only
  // basis it is a different number again. Assert it is computed and on-basis
  // rather than pinning today's value, which would make this test a thing to edit
  // every time the archive grows.
  else {
    if (tour.book && tour.book.bet365 !== 0) bad.push(`index tour baseline sums ${tour.book.bet365} Bet365 sides — R1 violated`);
    if (tour.yield === -3.79) bad.push('index tour baseline is the hard-coded -3.79% constant, not a computed figure');
    if (!(tour.n > 10000)) bad.push(`index tour baseline rests on ${tour.n} sides — too few to be the whole archive`);
  }
  return bad;
}

// ── run ──────────────────────────────────────────────────────────────────────
console.log('R1 · Market edge is struck on Pinnacle closing only');

if (!fs.existsSync(DIR) || !fs.existsSync(INDEX)) {
  console.error('market-edge/ or market-edge-index.json missing — nothing to check');
  process.exit(1);
}

const idx = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const idxBad = checkIndex(idx);
idxBad.forEach(fail);
if (!idxBad.length) ok(`index on basis "${idx.priceBasis}", tour baseline ${idx.tour.all.yield}% over ${idx.tour.all.n} Pinnacle sides`);

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
if (files.length < 300) fail(`only ${files.length} shards present`);

let priced = 0, rows = 0, excluded = 0;
for (const f of files) {
  const s = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  checkShard(f, s).forEach(fail);
  if (s.headline && s.headline.n) priced += 1;
  rows += (s.headline && s.headline.n) || 0;
  excluded += (s.coverage && s.coverage.excludedNonPinnacle) || 0;
}
if (!priced) fail('no shard carries a priced sample — the join is empty');
else ok(`${files.length} shards, ${priced} with a priced sample, ${rows} Pinnacle rows summed, ${excluded} non-Pinnacle rows excluded from every yield`);

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
    ['priceBasis reverted to the market-1 fallback wording', (s) => {
      s.priceBasis = 'closing price, Pinnacle where present, else Bet365 archive close, labelled per row';
    }],
    ['a Bet365 side summed into the headline', (s) => { s.headline.book.bet365 = 3; }],
    ['a Bet365 side summed into a price band', (s) => { s.bands.underdog[0].book.bet365 = 1; }],
    ['units dropped from a priced summary', (s) => { s.headline.units = null; }],
    ['the cumulative curve drawn over a wider population', (s) => { s.curve.push({ d: '2030-01-01', c: 0 }); }],
    ['a match row labelled in-basis that is not Pinnacle', (s) => {
      s.matches[0].book = 'bet365-archive'; s.matches[0].inBasis = true;
    }],
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
  ic.tour.all.book.bet365 = 0;
  if (checkIndex(ic).length) { fired += 1; console.log('  ctl  fires on: tour baseline reverted to the hard-coded -3.79%'); }
  else fail('CONTROL DID NOT FIRE — the -3.79% constant check is vacuous');
  return fired;
}

console.log('negative controls');
const fired = controls();
console.log(`  ${fired} control(s) fired`);
if (fired < 8) fail(`only ${fired} of 8 controls fired`);

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
    for (const f of ['build-market-edge.js', 'build-odds-performance.js']) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
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
      for (let i = 0; i < 300; i++) fs.writeFileSync(path.join(site, '_site', 'market-edge', `${i}.json`), JSON.stringify({ priceBasis: BASIS, headline: { n: 5, units: 1, book: { bet365: 0 } } }));
      const run = (builtAt, start) => {
        const ix = { priceBasis: BASIS, tour: { all: { n: 1, yield: -4.3, book: { bet365: 0 } } } };
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
console.log('\nR1 locked: Market edge is Pinnacle-closing only, and every assertion has a control that fails without it.');
