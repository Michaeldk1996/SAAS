'use strict';
// TEN-391 — the Node reader for career splits, one file per player.
//
// tools/build-career-splits.js writes:
//   career-splits/<profileKey>.json   one player's object (what the old single
//                                     career-splits.json held under players[key])
//   career-splits-tour.json           build metadata + coverage + `pooled`
//                                     (slim per-player rows for tour-wide readers)
//
// The browser fetches one player's file at a time. Node tools that want the
// whole set (suites, refit reports, validators) assemble it here, so there is
// ONE definition of where a player's splits live.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = 'career-splits';
const TOUR = 'career-splits-tour.json';

// One player's object, or null when he has no file (genuinely not built).
function readPlayer(key, root) {
  const k = String(key);
  if (!/^[A-Za-z0-9_-]+$/.test(k)) return null;
  const f = path.join(root || ROOT, DIR, k + '.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

// { ...tour metadata (without `pooled`), players: { key: object } } — the shape
// the old career-splits.json had. `players` is empty when no file exists.
function loadAll(root) {
  const r = root || ROOT;
  const tourFile = path.join(r, TOUR);
  const meta = fs.existsSync(tourFile) ? JSON.parse(fs.readFileSync(tourFile, 'utf8')) : {};
  delete meta.pooled;
  const players = {};
  const dir = path.join(r, DIR);
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith('.json')) continue;
      players[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    }
  }
  return Object.assign(meta, { players });
}

module.exports = { readPlayer, loadAll, DIR, TOUR };
