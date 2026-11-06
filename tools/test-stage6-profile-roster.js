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

console.log(`test-stage6-profile-roster: ${n} checks passed`);
