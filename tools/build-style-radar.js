#!/usr/bin/env node
/**
 * build-style-radar.js — derive the shippable style radar from radar-calibration.json.
 *
 * radar-calibration.json is a 340 KB R&D artifact: it carries the raw Match
 * Charting rates alongside the percentiles, and MCP raw data is internal-only
 * (CLAUDE.md). This emits only the 0-100 percentile block plus the charted-match
 * count, keyed the same way the dashboard keys every other player lookup
 * (last surname token + first initial), so it is small enough to ship and
 * carries nothing we are not allowed to serve.
 *
 * Output: style-radar.json
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'radar-calibration.json');
const OUT = path.join(ROOT, 'style-radar.json');

// Mirrors psEloNorm() + styleKey() in the dashboard character for character:
// "<last token>|<first initial>". Keep the two in sync or the join silently
// misses and every radar renders empty. Note psEloNorm folds hyphens to spaces,
// so "Davidovich-Fokina" keys on "fokina", not "davidovich-fokina".
function psEloNorm(name){
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’]/g, '').replace(/[.\-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function radarKey(name){
  const parts = psEloNorm(name).split(' ').filter(Boolean);
  if (parts.length < 2) return null;
  return parts[parts.length - 1] + '|' + parts[0][0];
}

const cal = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const players = {};
let dropped = 0, collisions = 0;

for (const [mcpName, rec] of Object.entries(cal.players || {})){
  if (!rec || !rec.radar) { dropped++; continue; }
  const k = radarKey(rec.name || mcpName);
  if (!k) { dropped++; continue; }
  const row = {
    name: rec.name || mcpName,
    n: rec.matches || 0,
    // `sufficient` is the calibration's own >=10-charted-match gate. The UI
    // degrades rather than hides below it, so keep the flag rather than filter.
    ok: !!rec.sufficient,
    radar: {},
  };
  for (const [ax, v] of Object.entries(rec.radar)) row.radar[ax] = Math.round(v);
  // Same key from two MCP spellings: keep the better-charted record.
  if (players[k]){ collisions++; if (players[k].n >= row.n) continue; }
  players[k] = row;
}

const out = {
  generatedAt: new Date().toISOString(),
  source: 'radar-calibration.json (percentile block only — raw MCP rates excluded)',
  axes: cal.axes ? Object.keys(cal.axes) : ['serve','return','baseline','netPlay','movement','clutch'],
  minCharted: (cal.meta && cal.meta.minMatches) || 10,
  note: 'Each axis is a 0-100 percentile across the charted field. "movement" is a long-rally (7+ shot) win-rate proxy, not tracking data — render it as Movement / Defence.',
  playerCount: Object.keys(players).length,
  players,
};

fs.writeFileSync(OUT, JSON.stringify(out));
const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`style-radar.json: ${out.playerCount} players, ${kb} KB (dropped ${dropped}, key collisions ${collisions})`);
