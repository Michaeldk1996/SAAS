#!/usr/bin/env node
// tools/build-derived-field.js — the Derived lines FIELD (founder approval 2026-10-23), pre-built in the pipeline.
//
// For every Window × Tier × format × card × Surface × Court speed and every line, the cover record of that line pooled
// over every player-side in the database: one player's matches from his own side, so a match between two database
// players counts once from each. ONE DEFINITION OF A LINE: the page's own player-profile-v2.js computes each player's
// lines (lineCoverage — the same population, exclusions, retirement and void rules the player's table uses); this file
// only adds them up. Per player it asks the page for Window × Tier × format (18 tables, every card, every surface, every
// speed) and buckets each counted match by its own card (the Market edge close role), Surface (the Career record's cell)
// and Court speed (the Court speed record's band, Unrated when none). Retirements are listed, never counted, as on the page.
//
// Output (atomic write): derived-field.json
//   { v, generatedAt, players, lines: { bo3: [labels], bo5: [labels] },
//     cells: { "<win>|<tier>|<fmt>|<role>|<surf>|<speed>": [[cover, notCovered, void, players], … one per line] } }
// A combination nobody played is absent (the page dashes it), never zeros.
//
// Inputs (a directory holding the run's stores, default cwd): player-profiles.json or profiles/<key>.json,
// career-history-index.json + career-history/<key>.json, career-record/<key>.json, market-edge/<key>.json,
// court-speed-map.json, bsp-consult-dashboard.html (the site's one court-speed scheme).
//
// Usage: node tools/build-derived-field.js [--dir <stores>] [--out derived-field.json]
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./ten384-figures-lib.js');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DIR = path.resolve(opt('--dir', process.cwd()));
const OUT = path.resolve(opt('--out', path.join(DIR, 'derived-field.json')));
const SRC = path.join(L.ROOT, 'player-profile-v2.js');
const J = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (e) { return null; } };

const idx = J('career-history-index.json');
if (!idx || !idx.players) { console.error('build-derived-field: career-history-index.json missing — no field built'); process.exit(1); }
const keys = Object.keys(idx.players);
// the run's per-player profile shards (profiles/<key>.json, the files the page loads), else the bundle
let bundle;
const profileOf = (k) => {
  const shard = J('profiles/' + k + '.json');
  if (shard && shard.profile) return shard.profile;
  if (bundle === undefined) bundle = J('player-profiles.json') || null;
  return (bundle && bundle.players && bundle.players[k]) || null;
};

const WINS = ['career', 'l24', 'l52'], TIERS = ['all', 'atp', 'chitf'], FMTS = ['bo3', 'bo5'];
const cells = {};
const lineLabels = {};
let loaded = 0;
const t0 = Date.now();
for (const k of keys) {
  const p = profileOf(k), ch = J('career-history/' + k + '.json');
  if (!p || !ch) continue;
  const cr = J('career-record/' + k + '.json'), me = J('market-edge/' + k + '.json');
  const { I } = L.loadPp2({ src: SRC, players: { [k]: p }, careerHistory: { [k]: ch.matches || ch },
    marketEdge: me ? { [k]: me } : {}, extra: { careerRecord: cr && cr.record ? { [k]: cr.record } : {} } });
  loaded++;
  for (const win of WINS) for (const tier of TIERS) for (const fmt of FMTS) {
    const cov = I.lineCoverage(p, fmt, 'all', { win, tier });
    const rows = [].concat.apply([], cov.groups.map((g) => g.rows));
    rows.forEach((row, li) => {
      const seen = {};
      row.members.forEach((x) => {
        if (x.res === 'retired') return;
        const r = x.m.r, b = I.speedBandForRow(I.speedRowOf(r));
        const roles = ['all'].concat(x.m.role ? [x.m.role] : []);
        const surfs = ['all'].concat(['hard', 'indoors', 'clay', 'grass'].indexOf(r.cell) >= 0 ? [r.cell] : []);
        const speeds = ['all', b ? b.id : 'unrated'];
        roles.forEach((ro) => surfs.forEach((sf) => speeds.forEach((sp) => {
          const key = [win, tier, fmt, ro, sf, sp].join('|');
          const c = cells[key] || (cells[key] = rows.map(() => [0, 0, 0, 0]));
          const t = c[li];
          if (x.res === 'cover') t[0]++; else if (x.res === 'miss') t[1]++; else if (x.res === 'void') t[2]++;
          if (!seen[key]) { seen[key] = 1; t[3]++; }
        })));
      });
      if (!lineLabels[fmt]) lineLabels[fmt] = rows.map((r) => r.label);
    });
  }
}
const out = { v: 1, generatedAt: new Date().toISOString(), players: loaded, lines: lineLabels, cells };
const tmp = OUT + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(out));
fs.renameSync(tmp, OUT);
console.log(`build-derived-field: ${loaded} players · ${Object.keys(cells).length} cells · ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
