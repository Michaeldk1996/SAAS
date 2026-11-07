#!/usr/bin/env node
// Stage 6 (2026-11-07) — profile-roster.json + atomic profile shards (bsp-pipeline.js).
//  1. profileRoster(store) = exactly the eager key set, each field copied verbatim from the profile
//     (key, name, rank, country, age, lastTournament = recentForm.matches[0].tournament), plus tourAverage.
//  2. writeProfileShardsAtomic: a write that fails part-way leaves the previous complete set in place
//     (control: the old unlink-then-write order loses it), and a good write replaces the set whole.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const assert = require('assert');
const { profileRoster, writeProfileShardsAtomic } = require('../bsp-pipeline.js');

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- 1. roster shape
const store = {
  fetchedAt: '2026-11-07T00:00:00Z', tourAverage: { dna: { a: 1 }, stats: {} },
  players: {
    '2382': { key: 2382, name: 'C. Alcaraz', rank: '1', country: 'Spain', age: 23, dna: { x: 1 },
      recentForm: { matches: [{ tournament: 'ATP Paris' }, { tournament: 'ATP Basel' }] }, careerByYear: [1, 2] },
    '1905': { key: 1905, name: 'N. Djokovic', rank: null, country: 'Serbia', age: 39 },
    '9': null,
  },
};
const r = profileRoster(store);
ok(Object.keys(r.players).sort().join() === '1905,2382', 'roster = the eager key set (null skipped)');
ok(JSON.stringify(r.players['2382']) === JSON.stringify({ key: 2382, name: 'C. Alcaraz', rank: '1', country: 'Spain', age: 23, lastTournament: 'ATP Paris' }), 'fields verbatim');
ok(r.players['1905'].lastTournament === null && r.players['1905'].rank === null, 'no form -> null, rank kept null');
ok(r.tourAverage === store.tourAverage && r.fetchedAt === store.fetchedAt, 'tourAverage + fetchedAt carried');
ok(!('careerByYear' in r.players['2382']) && !('dna' in r.players['2382']), 'no heavy field');

// ---- 2. atomic shards
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stage6-'));
const dir = path.join(tmp, 'profiles');
const n1 = writeProfileShardsAtomic(dir, { a: { name: 'A' }, b: { name: 'B' }, c: null }, { t: 1 });
ok(n1 === 2 && fs.readdirSync(dir).sort().join() === 'a.json,b.json', 'first write: 2 shards');
ok(JSON.parse(fs.readFileSync(path.join(dir, 'a.json'), 'utf8')).profile.name === 'A', 'shard shape {key, profile, tourAverage}');
// a profile whose serialisation throws part-way (after one shard is written)
const bad = { x: { name: 'X' }, y: { toJSON() { throw new Error('boom'); } } };
assert.throws(() => writeProfileShardsAtomic(dir, bad, {}), /boom/);
ok(fs.readdirSync(dir).sort().join() === 'a.json,b.json', 'failed write keeps the previous complete set');
ok(!fs.readdirSync(tmp).some(f => /\.tmp-|\.old-/.test(f)), 'no temp folder left behind');
// control: the pre-Stage-6 order (unlink, then write in place) loses the set on the same failure
fs.mkdirSync(path.join(tmp, 'ctl2')); fs.writeFileSync(path.join(tmp, 'ctl2', 'a.json'), '{}');
try { for (const f of fs.readdirSync(path.join(tmp, 'ctl2'))) fs.unlinkSync(path.join(tmp, 'ctl2', f)); JSON.stringify(bad); } catch (e) { /* died */ }
ok(fs.readdirSync(path.join(tmp, 'ctl2')).length === 0, 'CONTROL: the unlink-first order loses the old set');
const n2 = writeProfileShardsAtomic(dir, { z: { name: 'Z' } }, {});
ok(n2 === 1 && fs.readdirSync(dir).join() === 'z.json', 'a good write replaces the set whole (a leaver is gone)');
fs.rmSync(tmp, { recursive: true, force: true });

// ---- 3. wiring
const src = fs.readFileSync(path.join(__dirname, '..', 'bsp-pipeline.js'), 'utf8');
ok(/writeJsonAtomic\('profile-roster\.json', profileRoster\(playerProfiles\)/.test(src), 'pipeline writes profile-roster.json atomically');
ok(!/fs\.writeFileSync\(`\$\{dir\}\/\$\{key\}\.json`/.test(src), 'no in-place shard write left');
const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'pipeline.yml'), 'utf8');
ok(/cp profile-roster\.json _site\//.test(yml) && /player-index\.json profile-roster\.json/.test(yml), 'published + asserted in _site');

// ---- 4. the profile's roster-wide pools (Stage 6 step 5): computed by the module's OWN functions over the whole store,
// shipped in the roster, read first by the page — so a profile that is the only one in memory prints the same tour figures.
const loadMod = (players, pools) => {
  const W = { FEATURE_PP2: true, playerProfiles: { players }, profileRosterPools: pools || null };
  const prev = global.window; global.window = W;
  try { new Function('window', fs.readFileSync(path.join(__dirname, '..', 'player-profile-v2.js'), 'utf8'))(W); }
  finally { if (prev === undefined) delete global.window; else global.window = prev; }
  return W.PlayerProfileV2._internals;
};
const big = { fetchedAt: 'x', players: {} };
for (let i = 0; i < 14; i++) {
  const ms = [];
  for (let j = 0; j < 6; j++) {
    const lostS1 = (i + j) % 3 === 0, won = (i * 7 + j) % 2 === 0;
    ms.push({ date: '2025-0' + (1 + (j % 9)) + '-1' + j, tournament: 'ATP T' + (i % 4), round: j === 5 ? 'Final' : j === 4 ? 'Semi-finals' : j === 3 ? 'Quarter-finals' : 'Round of 16', won,
      sets: [{ p: lostS1 ? 3 : 6, o: lostS1 ? 6 : 3 }, { p: won ? 6 : 4, o: won ? 4 : 6 }, { p: won ? 6 : 2, o: won ? 2 : 6 }] });
  }
  big.players[String(100 + i)] = { key: 100 + i, name: 'P. Player' + i, recentForm: { matches: ms } };
}
const full = loadMod(big.players);
const want = { setDown: full.tourFromASetDown(), sit: full.sitTour(), draw: full.drawIndex() };
ok(want.setDown.pct != null && want.setDown.players === 14, 'fixture strikes a tour from-a-set-down figure (14 players)');
const rp = profileRoster(big).pools;
ok(JSON.stringify(rp.setDown) === JSON.stringify(want.setDown), 'roster pools: setDown = the module over the whole store');
ok(JSON.stringify(rp.sitSet.rows) === JSON.stringify(want.sit.rows) && rp.sitSet.players === want.sit.players, 'roster pools: Situational set rows');
ok(JSON.stringify(rp.draw) === JSON.stringify(want.draw), 'roster pools: proven draw sizes');
const one = { '100': big.players['100'] };
const page = loadMod(one, JSON.parse(JSON.stringify(rp)));
ok(JSON.stringify(page.tourFromASetDown()) === JSON.stringify(want.setDown), 'page with one player in memory reads the pooled setDown');
ok(JSON.stringify(page.sitTour().rows) === JSON.stringify(want.sit.rows) && page.sitTour().players === 14, 'page reads the pooled Situational rows');
ok(JSON.stringify(page.drawIndex()) === JSON.stringify(want.draw), 'page reads the pooled draw sizes');
const ctl = loadMod(one, null);
ok(ctl.tourFromASetDown().pct === null && ctl.sitTour().players === 1, 'CONTROL: without the pools one player in memory loses the tour figures');
ok(/out\.pools = require\('\.\/profile-pools\.js'\)\.profilePools\(store\)/.test(src), 'the pipeline writes the pools into profile-roster.json');
ok(/window\.profileRosterPools = \(data && data\.pools\) \|\| null;/.test(fs.readFileSync(path.join(__dirname, '..', 'bsp-consult-dashboard.html'), 'utf8')), 'the page bridges them');

console.log(`test-stage6-profile-roster: ${n} checks passed`);
