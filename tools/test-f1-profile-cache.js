#!/usr/bin/env node
// F1 (founder ruling 2026-10-14): a board player's fresh build is written to the profile cache, and a cached profile
// built on or before a later board match of that player is stale. Musetti: cache built 2026-10-06, board match
// 2026-10-09 → stale; built 2026-10-10 → fresh. Each check is run against a mutant (the rule removed / inverted).
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'bsp-pipeline.js'), 'utf8');
const { boardMatchDatesByPlayer, profileCacheStaleByBoard } = require('../bsp-pipeline.js');
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; };

// 1 · the rule
ok(profileCacheStaleByBoard({ builtAt: '2026-10-06T11:04:34Z' }, '2026-10-09') === true, 'built before the board match → stale');
ok(profileCacheStaleByBoard({ builtAt: '2026-10-09T09:00:00Z' }, '2026-10-09') === true, 'built on the match day → stale (may predate the result)');
ok(profileCacheStaleByBoard({ builtAt: '2026-10-10T02:00:00Z' }, '2026-10-09') === false, 'built after the match day → fresh');
ok(profileCacheStaleByBoard({ builtAt: '2026-10-06T11:04:34Z' }, undefined) === false, 'no board match → the TTL alone decides');
ok(profileCacheStaleByBoard(null, '2026-10-09') === false, 'no entry → not this rule');

// 2 · the dates come from the captured closes, both players, latest per key; unreadable → empty (adds no rebuild)
const tmp = path.join(os.tmpdir(), `f1-${process.pid}.json`);
fs.writeFileSync(tmp, JSON.stringify({ rows: [
  { date: '2026-10-07', p1Key: 39862, p2Key: 2849 }, { date: '2026-10-09', p1Key: 39862, p2Key: 2849 }, { date: '2026-10-01', p1Key: 2849, p2Key: 1 } ] }));
const m = boardMatchDatesByPlayer(tmp);
ok(m.get('2849') === '2026-10-09' && m.get('39862') === '2026-10-09' && m.get('1') === '2026-10-01', 'latest board date per player key');
ok(boardMatchDatesByPlayer(tmp + '.missing').size === 0, 'missing file → no stale verdicts');
fs.unlinkSync(tmp);

// 3 · wiring: pass 1 writes the cache on a successful build; both reuse paths consult the rule
const p1 = src.slice(src.indexOf('// Pass 1 — seed players, always fresh.'), src.indexOf('// Pass 2 — opponents, TTL-cached'));
ok(/if \(profile\) \{[\s\S]*?cachedPlayers\[key\] = \{ builtAt: new Date\(\)\.toISOString\(\), v: PROFILE_SCHEMA_VERSION, profile \}/.test(p1), 'pass 1 writes a successful seed build to the cache');
ok(!/cachedPlayers\[key\] = \{[^}]*profile: profile \|\| null/.test(p1), 'pass 1 never caches a failed (null) seed build over a held profile');
ok((src.match(/&& !staleByBoard\(key, cached\)/g) || []).length === 2, 'pass 2 and pass 2b both treat a board-stale entry as not fresh');

// 4 · mutants: each must turn a check red
const mut = (name, f) => { let red = false; try { f(); } catch (e) { red = true; } assert.ok(red, `mutant survived: ${name}`); pass++; };
mut('rule removed', () => assert.ok(((c, d) => false)({ builtAt: '2026-10-06' }, '2026-10-09') === true));
mut('strict < (same-day build kept)', () => assert.ok(((c, d) => String(c.builtAt).slice(0, 10) < d)({ builtAt: '2026-10-09T09:00Z' }, '2026-10-09') === true));
mut('pass 1 write-back removed', () => assert.ok(/cachedPlayers\[key\] = \{ builtAt/.test(p1.replace(/cachedPlayers\[key\] = \{ builtAt[^\n]*\n/, ''))));
console.log(`test-f1-profile-cache: ${pass} checks passed`);
