// =================================================================
// LAYER #8 — Per-archetype MCP Winners/Unforced baseline  (STAGED)
// -----------------------------------------------------------------
// Builds `mcp-archetype-baseline.json`: for each of the 8 live BSP
// archetypes, the Match Charting Project winner-rate and unforced-rate
// baseline, aggregated over every reliably-classified player (current +
// historical) who has >= MCP_MIN charted matches.
//
// SOURCE OF TRUTH for the 8 archetypes = the live classifier output
// `styles-debug-all.json` (name + primary label for the full field).
// MCP = charting-m-stats-Overview.csv (winners / unforced / points).
//
// DEPENDENCY: run AFTER classify-styles.js (which writes
// styles-debug-all.json). This script does NOT re-classify.
//
// STAGING NOTE: this artifact is NOT consumed by the dashboard or the
// model yet. Per founder direction (TEN-8, 2026-07-23): build + stage
// only; DO NOT activate live until api-tennis Winners/Unforced-Errors
// data is confirmed reliable. MCP data is CC BY-NC-SA (R&D use only) —
// it seeds the baseline; it is not served to paying members.
// =================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MCP_BASE = 'https://raw.githubusercontent.com/JeffSackmann/tennis_MatchChartingProject/master/';
const MCP_CACHE = path.join(ROOT, 'mcp-cache');
const MCP_MIN = 10; // charted matches to trust a player's rates (matches classify-styles.js)

const ARCH8 = ['big_server', 'big_server_baseliner', 'attacking_baseliner', 'solid_baseliner', 'all_court_elite', 'counter_puncher', 'solid_defender', 'all_court'];
const ARCH_LABEL = {
  big_server: 'Big Server', big_server_baseliner: 'Big Server + Baseliner', attacking_baseliner: 'Attacking Baseliner',
  solid_baseliner: 'Solid Baseliner', all_court_elite: 'All-Court Elite', counter_puncher: 'Counter Puncher',
  solid_defender: 'Solid Defender', all_court: 'All-Court Player',
};

function deaccent(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function nameKey(name) {
  const p = deaccent(name).toLowerCase().replace(/&nbsp;/g, ' ').replace(/['’]/g, '').replace(/[.\-]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  return p.length < 2 ? null : p[p.length - 1] + '|' + p[0][0];
}

async function getCsv(url, cacheFile) {
  if (fs.existsSync(cacheFile) && fs.statSync(cacheFile).size > 0) return fs.readFileSync(cacheFile, 'utf8');
  const res = await fetch(url, { headers: { 'User-Agent': 'bsp-consult' } });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text || text.length < 50) return null;
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, text);
  return text;
}

(async () => {
  const debugPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'styles-debug-all.json');
  if (!fs.existsSync(debugPath)) { console.error(`MISSING ${path.basename(debugPath)} — run classify-styles.js first.`); process.exit(1); }
  const field = require(debugPath).players; // [{name, primary, ...}] full classified field

  // name key -> primary archetype (reliable labels only; debug file already is the reliable field)
  const primaryByKey = new Map();
  for (const p of field) { const k = nameKey(p.name); if (k && p.primary && ARCH8.includes(p.primary)) primaryByKey.set(k, p.primary); }

  // MCP charted counts + winner/unforced per player key
  const mcp = new Map();
  const get = k => { let m = mcp.get(k); if (!m) { m = { charted: 0, winners: 0, unforced: 0, pts: 0 }; mcp.set(k, m); } return m; };
  {
    const t = await getCsv(`${MCP_BASE}charting-m-matches.csv`, path.join(MCP_CACHE, 'matches.csv'));
    if (t) { const L = t.split(/\r?\n/).filter(Boolean); for (let i = 1; i < L.length; i++) { const c = L[i].split(','); for (const nm of [c[1], c[2]]) { const k = nameKey(nm); if (k) get(k).charted++; } } }
  }
  {
    const t = await getCsv(`${MCP_BASE}charting-m-stats-Overview.csv`, path.join(MCP_CACHE, 'overview.csv'));
    if (!t) { console.error('MISSING MCP Overview data'); process.exit(1); }
    const L = t.split(/\r?\n/).filter(Boolean); const H = L[0].split(','); const ix = {}; H.forEach((h, i) => ix[h] = i);
    for (let i = 1; i < L.length; i++) { const c = L[i].split(','); if (c[ix.set] !== 'Total') continue; const k = nameKey(c[ix.player]); if (!k) continue; const m = get(k); m.winners += (+c[ix.winners] || 0); m.unforced += (+c[ix.unforced] || 0); m.pts += (+c[ix.serve_pts] || 0) + (+c[ix.return_pts] || 0); }
  }

  // aggregate per archetype: mean of per-player rates over MCP-qualified members
  const agg = {}; for (const A of ARCH8) agg[A] = [];
  let allRates = [];
  for (const [k, prim] of primaryByKey) {
    const m = mcp.get(k); if (!m || m.charted < MCP_MIN || !m.pts) continue;
    const rec = { winnerRate: m.winners / m.pts, unforcedRate: m.unforced / m.pts, charted: m.charted };
    agg[prim].push(rec); allRates.push(rec);
  }
  const mean = (arr, f) => arr.length ? arr.reduce((s, r) => s + f(r), 0) / arr.length : null;
  const perArchetype = {};
  for (const A of ARCH8) {
    const pool = agg[A]; const wr = mean(pool, r => r.winnerRate), ur = mean(pool, r => r.unforcedRate);
    perArchetype[A] = {
      label: ARCH_LABEL[A], mcpPlayers: pool.length,
      winnerRatePerPt: wr == null ? null : +wr.toFixed(4),
      unforcedRatePerPt: ur == null ? null : +ur.toFixed(4),
      wuRatio: (wr && ur) ? +(wr / ur).toFixed(3) : null,
      totalChartedMatches: pool.reduce((s, r) => s + r.charted, 0),
    };
  }
  const out = {
    generatedAt: new Date().toISOString(),
    layer: 8,
    status: 'STAGED — not activated. Do not serve live until api-tennis Winners/Unforced data is confirmed reliable.',
    source: 'Match Charting Project (CC BY-NC-SA, R&D use only) x live 8-archetype classification',
    mcpMinCharted: MCP_MIN,
    tourBaseline: {
      mcpPlayers: allRates.length,
      winnerRatePerPt: mean(allRates, r => r.winnerRate) == null ? null : +mean(allRates, r => r.winnerRate).toFixed(4),
      unforcedRatePerPt: mean(allRates, r => r.unforcedRate) == null ? null : +mean(allRates, r => r.unforcedRate).toFixed(4),
    },
    archetypes: perArchetype,
  };
  const dest = path.join(ROOT, 'mcp-archetype-baseline.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(`Wrote mcp-archetype-baseline.json — ${allRates.length} MCP-qualified players across 8 archetypes.`);
  for (const A of ARCH8) { const v = perArchetype[A]; console.log(`  ${v.label.padEnd(24)} n=${String(v.mcpPlayers).padStart(3)}  W/pt ${v.winnerRatePerPt}  UE/pt ${v.unforcedRatePerPt}  W:UE ${v.wuRatio}`); }
})();
