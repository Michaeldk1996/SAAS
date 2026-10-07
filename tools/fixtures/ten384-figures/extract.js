#!/usr/bin/env node
// tools/fixtures/ten384-figures/extract.js — writes the PINNED fixture the TEN-384 figures-agree gate runs on.
//
// WHY A FIXTURE. tools/test-ten384-figures-agree.js used to read the deployed stores plus the gitignored
// career-history/ directory, so in a clean CI clone (no career-history/) it aborted, and the checks it did
// run measured whatever the live data said that hour. The gating checks now run on ONE real player's
// complete, internally consistent record, frozen here with the instant it was taken (`asOf`): the test
// pins the module's clock to that instant, so the Last-52 window, the ledger's "not in the future" gate
// and every other clock-relative rule see the same day forever. Nothing in the fixture moves with live data.
//
// Every store the checks render through is captured for that player ONLY:
//   profile            player-profiles.json entry (deployed)            careerByYear spine, recentForm ledger
//   careerHistory      career-history/<key>.json matches                the Calendar's dated rows
//   marketEdge         market-edge/<key>.json (deployed)                the Market edge basis, H / A, roles
//   tournamentHistory  tournament-history/<key>.json (deployed)         Record per tournament
//   bet365History      bet365-history/YYYY-MM.json, his fixtures only   the ledger's second price source
//
// Re-run ONLY to refresh the fixture deliberately (it is a snapshot, not a mirror):
//   node tools/fixtures/ten384-figures/extract.js <key> [<career-history dir>]
// The career-history dir defaults to ./career-history (the deployed shards; see tools/deployed-store.js).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
const D = require(path.join(ROOT, 'tools', 'deployed-store.js'));

const key = String(process.argv[2] || '');
if (!/^\d+$/.test(key)) { console.error('usage: extract.js <playerKey> [career-history dir]'); process.exit(2); }
const chDir = path.resolve(process.argv[3] || path.join(ROOT, 'career-history'));

const store = D.playerProfiles();
if (store.source !== 'deployed') { console.error('could not read the deployed player-profiles.json'); process.exit(1); }
const profile = store.players[key];
if (!profile) { console.error('player ' + key + ' is not in the deployed roster'); process.exit(1); }
const chFile = path.join(chDir, key + '.json');
if (!fs.existsSync(chFile)) { console.error('no career-history shard at ' + chFile); process.exit(1); }
const ch = JSON.parse(fs.readFileSync(chFile, 'utf8'));
const idx = D.careerHistoryIndex() || {};
if (typeof idx[key] === 'number' && (ch.matches || []).length < idx[key]) {
  console.error(`career-history ${key} is SHORT of the deployed index (${ch.matches.length} < ${idx[key]})`); process.exit(1);
}
const me = D.fetchJson('market-edge/' + key + '.json');
if (!me || !me.headline) { console.error('no market-edge shard for ' + key); process.exit(1); }
const th = D.fetchJson('tournament-history/' + key + '.json');

// bet365: only the fixtures naming him (surname token), kept in the month files' own shape.
const sur = String(profile.name).split(/\s+/).pop().toLowerCase().replace(/[^a-z]/g, '');
const B365 = {};
const bdir = path.join(ROOT, 'bet365-history');
fs.readdirSync(bdir).filter(f => /^\d{4}-\d{2}\.json$/.test(f)).forEach((f) => {
  const j = JSON.parse(fs.readFileSync(path.join(bdir, f), 'utf8'));
  const fx = {};
  Object.keys(j.fixtures || {}).forEach((id) => {
    const x = j.fixtures[id];
    const names = (String(x.p1 || '') + ' ' + String(x.p2 || '')).toLowerCase().replace(/[^a-z ]/g, '');
    if (names.split(/\s+/).indexOf(sur) >= 0) fx[id] = x;
  });
  if (Object.keys(fx).length) B365[f.replace(/\.json$/, '')] = { book: j.book, market: j.market, fixtures: fx };
});

const out = {
  asOf: new Date().toISOString(),
  key,
  name: profile.name,
  provenance: {
    profiles: store.fetchedAt,
    careerHistoryRows: (ch.matches || []).length,
    marketEdgeBuiltAt: me.builtAt || null,
    marketEdgeCommit: me.builtFromCommit || null,
    extractedBy: 'tools/fixtures/ten384-figures/extract.js'
  },
  profile,
  careerHistory: ch.matches || [],
  marketEdge: me,
  tournamentHistory: (th && th.tournamentHistory) || [],
  bet365History: B365
};
const file = path.join(__dirname, 'player-' + key + '.json');
fs.writeFileSync(file, JSON.stringify(out) + '\n');
console.log(`wrote ${path.relative(ROOT, file)} · ${Math.round(fs.statSync(file).size / 1024)} KB · ${out.careerHistory.length} career rows · ` +
  `${(me.matches || []).length} market rows · ${out.tournamentHistory.length} tournaments · ${Object.keys(B365).length} bet365 months`);
