// market-edge-stale (founder 2026-10-29): the committed market-edge/ is a price-free floor (tools/market-edge-floor.js),
// so a test that needs Market edge rows builds them as the pipeline does: the REAL builders in a temp root over the
// committed odds archive (build-database-yield.js → the master → build-market-edge.js), the floor's names as the
// roster. Returns the temp root (market-edge/ + market-edge-index.json inside it); removed when the process exits.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let built = null;
function freshMarketEdge() {
  if (built) return built;
  const R = path.join(__dirname, '..');
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'market-edge-fresh-'));
  process.on('exit', () => fs.rmSync(t, { recursive: true, force: true }));
  for (const f of ['build-market-edge.js', 'build-odds-performance.js', 'settlement.js', 'market-edge-core.js', 'build-database-yield.js', 'td-identity.js', 'player-profiles.json']) fs.copyFileSync(path.join(R, f), path.join(t, f));
  for (const f of ['odds-archive', 'court-speed-map.json', 'playing-styles.json']) if (fs.existsSync(path.join(R, f))) fs.symlinkSync(path.join(R, f), path.join(t, f));
  fs.cpSync(path.join(R, 'market-edge'), path.join(t, 'market-edge'), { recursive: true });
  execFileSync(process.execPath, [path.join(t, 'build-database-yield.js')], { stdio: 'pipe' });
  execFileSync(process.execPath, [path.join(t, 'build-market-edge.js'), '--quiet'], { stdio: 'pipe' });
  built = t;
  return t;
}
module.exports = { freshMarketEdge };
