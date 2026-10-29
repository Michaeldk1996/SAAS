#!/usr/bin/env node
// The committed Market edge floor (founder 2026-10-29, "no stale or mislabelled Market edge content can reach the site").
// market-edge/ and market-edge-index.json are a pipeline output, rebuilt every run from the master. The committed copy
// ships only when build-market-edge.js fails, and doubles as the builder's roster (rosterProfiles reads each shard's
// name). So it carries names and NO price: the real builder is run on an EMPTY master in a temp directory (every shard
// rewritten as the builder writes a player with no row), and the index is stamped as a floor with no source, so the
// publish guard's lag check (tools/price-consistency.mjs) refuses it as it always has.
// Usage: node tools/market-edge-floor.js            (rewrites market-edge/ and market-edge-index.json in this checkout)
//        node tools/market-edge-floor.js --check    (exit 1 if the committed floor holds any price or names a source)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'market-edge'), INDEX = path.join(ROOT, 'market-edge-index.json');

/** Every way the committed floor could carry a price or claim to be a build: [] when it is clean. */
function floorFaults(dir = DIR, index = INDEX) {
  const out = [];
  const ix = JSON.parse(fs.readFileSync(index, 'utf8'));
  if (ix.floor !== true) out.push('index: not stamped floor');
  if (ix.source) out.push(`index: names a source (${ix.source}) — the lag guard would take it for a build`);
  if (ix.latestMatch) out.push(`index: carries a latest match (${ix.latestMatch})`);
  if (ix.builtAt) out.push(`index: carries a build time (${ix.builtAt}) — the floor is not a build`);
  for (const [k, p] of Object.entries(ix.players || {})) if (p && p.n) out.push(`index: player ${k} counts ${p.n} priced`);
  let shards = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!/^\d+\.json$/.test(f)) continue;
    shards += 1;
    const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const priced = (s.matches || []).filter((m) => m && (m.price != null || m.oppPrice != null));
    if (priced.length) out.push(`${f}: ${priced.length} priced row(s), latest ${priced.map((m) => m.date).sort().pop()}`);
    if (!s.name) out.push(`${f}: no name (the builder's roster reads it)`);
  }
  if (!shards) out.push('no shard at all: the builder would lose its roster');
  return out;
}

function rebuild() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'me-floor-'));
  try {
    for (const f of ['build-market-edge.js', 'build-odds-performance.js', 'market-edge-core.js', 'settlement.js', 'td-identity.js', 'player-profiles.json']) fs.copyFileSync(path.join(ROOT, f), path.join(d, f));
    fs.cpSync(DIR, path.join(d, 'market-edge'), { recursive: true });
    // the empty master: the builder's own columns, no row
    fs.writeFileSync(path.join(d, 'database-yield-master.json'), JSON.stringify({ meta: { schema: 1, cols: ['date', 'tournament', 'series', 'surface', 'court',
      'round', 'bestof', 'winner', 'loser', 'comment', 'pw', 'pl', 'book', 'set', 'flags', 'wrank', 'lrank', 'fs'], latest: null }, rows: [] }));
    const r = spawnSync(process.execPath, ['build-market-edge.js', '--quiet'], { cwd: d, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('build-market-edge.js on an empty master exited ' + r.status + ': ' + (r.stderr || '').slice(-400));
    const ix = JSON.parse(fs.readFileSync(path.join(d, 'market-edge-index.json'), 'utf8'));
    Object.assign(ix, { floor: true, source: null, latestMatch: null, masterLatest: null, builtAt: null, builtFromCommit: null,
      note: 'Committed floor (tools/market-edge-floor.js): names only, no price. Ships only if build-market-edge.js fails; the publish guard refuses it (no source).' });
    fs.writeFileSync(path.join(d, 'market-edge-index.json'), JSON.stringify(ix, null, 1));
    // no build time either: the floor is not a build (the completeness assert and the rebuilt check read builtAt)
    for (const f of fs.readdirSync(DIR)) if (/^\d+\.json$/.test(f)) {
      const s = JSON.parse(fs.readFileSync(path.join(d, 'market-edge', f), 'utf8'));
      Object.assign(s, { builtAt: null, builtFromCommit: null });
      fs.writeFileSync(path.join(DIR, f), JSON.stringify(s));
    }
    fs.copyFileSync(path.join(d, 'market-edge-index.json'), INDEX);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
}

if (require.main === module) {
  if (!process.argv.includes('--check')) rebuild();
  const faults = floorFaults();
  if (faults.length) { console.error('market-edge floor: ' + faults.length + ' fault(s)\n  ' + faults.slice(0, 20).join('\n  ')); process.exit(1); }
  console.log(`market-edge floor: ${fs.readdirSync(DIR).filter((f) => /^\d+\.json$/.test(f)).length} shards, names only, no price, index stamped floor (no source)`);
}
module.exports = { floorFaults };
