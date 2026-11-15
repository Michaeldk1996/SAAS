#!/usr/bin/env node
// Founder 2026-11-14 ("find these surfaces and fix it"): (1) an event name that ends in its court ("…, Clay",
// "…, Hard (Indoor)") fills a blank surface, never replacing a map surface; (2) only cached profiles built before
// SURFACE_FILL_AT that still hold a match on no surface are stale (a targeted rebuild, not a schema bump).
const P = require('../bsp-pipeline.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
ok(eq(P.nameSurface('Buenos Aires 3 (Argentina), Clay'), ['clay', 0]), 'a name ending ", Clay" reads clay, outdoor');
ok(eq(P.nameSurface('Baton Rouge (Usa), Hard (Indoor)'), ['hard', 1]), '"Hard (Indoor)" reads hard, indoor');
ok(eq(P.nameSurface('Asuncion (Paraguay) - Qualification, Clay'), ['clay', 0]), 'a qualifying name reads its court too');
ok(P.nameSurface('ITF M15 Novi Sad 2 Men') === null, 'a name with no court suffix reads nothing (never guessed)');
ok(P.nameSurface('Hard Rock Open') === null && P.nameSurface('Clay Court Classic, Carpet') === null, 'a court word elsewhere in the name, or carpet, is not read');
const map = new Map([['100', 'grass']]);
ok(P.fixtureSurface({ tournament_key: 100, tournament_name: 'X (Y), Clay', event_date: '2024-05-01' }, map) === 'grass',
  'a tournament surface on the map always wins over the name');
ok(P.fixtureSurface({ tournament_key: 101, tournament_name: 'X (Y), Clay', event_date: '2024-05-01' }, map) === 'clay',
  'a key the map leaves blank takes the name\'s court');
// targeted rebuild
const unk = { careerByYear: [{ year: 2024, total: { won: 5, lost: 3 }, clay: { won: 4, lost: 2 }, hard: { won: 0, lost: 1 } }] };
const full = { careerByYear: [{ year: 2024, total: { won: 5, lost: 3 }, clay: { won: 5, lost: 2 }, hard: { won: 0, lost: 1 } }] };
ok(P.profileHasUnknownSurface(unk) && !P.profileHasUnknownSurface(full), 'a season with matches on no surface is detected; a full one is not');
ok(P.profileCacheStaleBySurface({ builtAt: '2026-11-10T00:00:00Z', profile: unk }), 'a profile built before the fill with unknown matches is stale');
ok(!P.profileCacheStaleBySurface({ builtAt: '2026-11-10T00:00:00Z', profile: full }), 'a profile with every surface known is NOT rebuilt (control)');
ok(!P.profileCacheStaleBySurface({ builtAt: '2026-11-15T00:00:00Z', profile: unk }), 'once rebuilt after the fill it is never re-flagged (no rebuild loop)');
ok(!P.profileCacheStaleBySurface({ builtAt: '2026-11-10T00:00:00Z', profile: null }), 'a cached null is not touched');
// data review 2026-11-14: the served-profile pass caps recentForm with the build's own rule (18 Form rows), not the old
// "season + last 10 rows" cut that undid it; profiles that cut left short rebuild once
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'bsp-pipeline.js'), 'utf8');
ok(/rf\.matches = capRecentFormMatches\(rf\.matches, _capYear\)/.test(src) && !/i < 10 \|\| String\(m\.date/.test(src),
  'the served-profile pass uses capRecentFormMatches, not "season + last 10 rows"');
const rows = (n, y) => Array.from({ length: n }, (_, i) => ({ date: y + '-0' + (1 + (i % 9)) + '-01', tournament: 'X', won: true }));
const capped = P.capRecentFormMatches(rows(15, 2026).concat(rows(10, 2025)), 2026);
ok(capped.length === 18, 'a 15-match season keeps 3 older rows to reach 18 Form rows (got ' + capped.length + ')');
const short = { careerByYear: [{ year: 2025, total: { won: 30, lost: 10 } }], recentForm: { matches: rows(15, 2026) } };
ok(P.profileCacheStaleByForm({ builtAt: '2026-11-10T00:00:00Z', profile: short }), 'a cached profile cut to 15 Form rows (40 played) is rebuilt');
ok(!P.profileCacheStaleByForm({ builtAt: '2026-11-16T00:00:00Z', profile: short }), 'once rebuilt after the fix it is never re-flagged');
ok(!P.profileCacheStaleByForm({ builtAt: '2026-11-10T00:00:00Z', profile: { careerByYear: [{ total: { won: 10, lost: 5 } }], recentForm: { matches: rows(15, 2026) } } }),
  'a player who has played only 15 matches is not rebuilt (control)');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
