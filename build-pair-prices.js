'use strict';
/**
 * build-pair-prices.js — the Head to Head page's likely opening price for any two players (founder 2026-11-16:
 * "the head to head is to compare two players, to have a likely opening price based on our database, Elo ratings etc").
 *
 * For every pair of players in this week's ATP top PAIR_TOP (player-index.json, api-tennis standings) it runs the
 * Stennisfy Model engine itself (h2h-model runModel, pairOnly) on each surface (Hard, Clay, Grass) and format (best of
 * 3 / 5), with no market anchor (base state 3: Elo + surface Elo) and without the layers that need a real match
 * (h2h-model PAIR_SKIP_LAYERS). Its H2H input is the screens' H2H list (TEN-437, the same builder buildModelOutput uses).
 *
 * The probability becomes a likely OPENING price by putting Pinnacle's opening margin on it, proportionally:
 * price = 1 / (p × (1 + PAIR_MARGIN)). PAIR_MARGIN = the median overround of Pinnacle's first two-sided price on the
 * board (Pinnacle +30s, Oddspapi), measured 16 Nov 2026 over the matches.json history 27 Sep – 16 Nov: 3.39%, n = 442
 * (p25 2.93%, p75 3.50%). Its closing margin is lower (ATP main draw 2025: 2.67%, n = 2,532).
 *
 * Writes pair-prices/<key>.json (one per player: every opponent, every context, with the margin and its n — the page reads
 * only this) + pair-prices-index.json (run metadata), atomically
 * (tmp + rename). Never committed; published by pipeline.yml. A player with no Elo is no row (the engine's own rule:
 * never forced to 50%).
 */
const fs = require('fs');
const path = require('path');

const PAIR_TOP = 200;
const PAIR_MARGIN = 0.0339;
const PAIR_MARGIN_N = 442;
const SURFACES = ['Hard', 'Clay', 'Grass'];
const FORMATS = [3, 5];
const OUT_DIR = 'pair-prices';
const INDEX = 'pair-prices-index.json';

function readJ(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }

// Probability (0..1) → integer basis points, the shard's compact form.
const bp = (p) => Math.round(p * 1e4);

function contextKey(surface, bestOf) { return surface[0] + bestOf; }   // H3 H5 C3 C5 G3 G5

function topPlayers(indexFile, top) {
  const idx = readJ(indexFile);
  const arr = idx && (Array.isArray(idx) ? idx : idx.players);
  if (!Array.isArray(arr)) throw new Error(`${indexFile} missing or unreadable`);
  return arr.filter(p => p && p.key != null && Number.isFinite(Number(p.rank)) && Number(p.rank) >= 1 && Number(p.rank) <= top)
    .sort((a, b) => a.rank - b.rank).map(p => ({ key: String(p.key), name: p.name, rank: Number(p.rank) }));
}

/**
 * Run every pair. `runModel` and `h2hFor` are injected so the test can drive the real engine on fixtures.
 * Returns { shards: { key: {...} }, stats }.
 */
function buildPairs(players, { runModel, h2hFor, shortName, date }) {
  const shards = {};
  const stats = { players: players.length, pairs: 0, priced: 0, unpriced: 0 };
  for (const p of players) shards[p.key] = { key: p.key, opp: {} };
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      stats.pairs++;
      const m0 = { id: `pair-${a.key}-${b.key}`, p1Key: a.key, p2Key: b.key, p1: shortName(a), p2: shortName(b), date, tour: '' };
      const h2hMatches = h2hFor ? h2hFor(m0) : null;
      const rowA = {}, rowB = {};
      let any = false;
      for (const surface of SURFACES) {
        for (const bestOf of FORMATS) {
          const m = Object.assign({}, m0, { surface }, h2hMatches ? { h2h: { matches: h2hMatches } } : {});
          const r = runModel(m, { pairOnly: true, bestOf });
          if (!r || !r.ok) continue;
          any = true;
          const pA = r.stage2.adjustedP1, base = r.stage1.baseP1;
          const applied = r.stage2.adjustments.filter(x => x.applied).length;
          const k = contextKey(surface, bestOf);
          rowA[k] = [bp(pA), bp(base), applied];
          rowB[k] = [bp(1 - pA), bp(1 - base), applied];
        }
      }
      if (!any) { stats.unpriced++; continue; }
      stats.priced++;
      shards[a.key].opp[b.key] = rowA;
      shards[b.key].opp[a.key] = rowB;
    }
  }
  return { shards, stats };
}

function writeAtomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

function main() {
  const { runModel, PAIR_SKIP_LAYERS } = require('./h2h-model/model');
  const { modelH2hMatches, modelH2hInputs } = require('./bsp-pipeline.js');
  const h2hIn = modelH2hInputs([]);
  const players = topPlayers('player-index.json', PAIR_TOP);
  const profiles = (readJ('player-profiles.json') || {}).players || {};
  // The engine's names: the profile's short name (its card spelling), else the standings' full name.
  const shortName = p => (profiles[p.key] && profiles[p.key].name) || p.name;
  const date = new Date().toISOString().slice(0, 10);
  const t0 = Date.now();
  const { shards, stats } = buildPairs(players, {
    runModel, date, shortName,
    h2hFor: h2hIn ? (m => modelH2hMatches(m, h2hIn)) : null,
  });
  const generatedAt = new Date().toISOString();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const f of fs.readdirSync(OUT_DIR)) if (/\.json$/.test(f)) fs.unlinkSync(path.join(OUT_DIR, f));
  const written = [];
  for (const k of Object.keys(shards)) {
    if (!Object.keys(shards[k].opp).length) continue;
    writeAtomic(path.join(OUT_DIR, `${k}.json`), Object.assign({ v: 1, generatedAt, margin: PAIR_MARGIN, marginN: PAIR_MARGIN_N }, shards[k]));
    written.push(k);
  }
  writeAtomic(INDEX, {
    v: 1, generatedAt, top: PAIR_TOP, margin: PAIR_MARGIN, marginN: PAIR_MARGIN_N,
    contexts: SURFACES.flatMap(s => FORMATS.map(b => contextKey(s, b))),
    skippedLayers: PAIR_SKIP_LAYERS, h2hSource: h2hIn ? 'career-history' : 'none',
    players: written, stats: Object.assign(stats, { ms: Date.now() - t0 }),
  });
  console.log(`pair prices: ${written.length} players, ${stats.priced}/${stats.pairs} pairs priced, ${Date.now() - t0} ms`);
  if (!written.length) { console.error('::error::pair prices: no player priced'); process.exitCode = 1; }
}

if (require.main === module) main();
module.exports = { buildPairs, topPlayers, contextKey, PAIR_MARGIN, PAIR_MARGIN_N, PAIR_TOP, SURFACES, FORMATS };
