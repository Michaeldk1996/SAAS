#!/usr/bin/env node
'use strict';
// TEN-304 Wave B · build-weather.js — the per-venue forecast files the Weather tab reads.
// Drives the real build() with an injected fetch (no network) and a real temp directory.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const B = require('../build-weather.js');

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' :: ' + e.message); }
}
const HINTS = {
  Chengdu: { city: 'Chengdu', country: 'CN', indoor: false },
  Basel: { city: 'Basel', country: 'CH', indoor: true },
  Paris: { city: 'Paris', country: 'FR', indoor: true },
};
const COORDS = { Chengdu: { lat: 30.66, lon: 104.06 }, Basel: { lat: 47.5, lon: 7.6 } };
const MATCHES = [{ tour: 'ATP Chengdu' }, { tour: 'ATP Chengdu' }, { tour: 'ATP Basel' }, { tour: 'ATP Laver Cup' }, { tour: 'ATP Nowhere' }];
function omResponse() {
  const time = [], t = [];
  for (let h = 0; h < 48; h++) { time.push(`2026-09-${27 + Math.floor(h / 24)}T${String(h % 24).padStart(2, '0')}:00`); t.push(20 + (h % 24)); }
  const nul = () => time.map(() => 1);
  return { timezone: 'Asia/Shanghai', utc_offset_seconds: 28800, hourly: { time, temperature_2m: t, relative_humidity_2m: nul(), apparent_temperature: nul(),
    precipitation_probability: nul(), precipitation: nul(), wind_speed_10m: nul(), wind_gusts_10m: time.map((_, i) => i === 5 ? null : 9) },
    daily: { time: ['2026-09-27', '2026-09-28'], weather_code: [3, 61], temperature_2m_max: [30, 25], temperature_2m_min: [20, 19] } };
}
const ok = body => async () => ({ ok: true, json: async () => body });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ten304-bw-')); fs.writeFileSync(path.join(d, 'm.json'), JSON.stringify(MATCHES)); return d; };

(async () => {
  console.log('TEN-304 · build-weather.js\n');
  await check('plan: one outdoor venue per tournament; indoor and Laver Cup carry indoor:true and no file; unmapped absent', () => {
    const { tours, venues } = B.planVenues(MATCHES, HINTS, COORDS);
    assert.deepStrictEqual(Object.keys(venues), ['Chengdu']);                              // mutation: fetch indoor venues too
    assert.deepStrictEqual(tours['ATP Chengdu'], { key: 'Chengdu', indoor: false, file: 'weather/chengdu.json' });
    assert.deepStrictEqual(tours['ATP Basel'], { key: 'Basel', indoor: true, file: null });
    assert.deepStrictEqual(tours['ATP Laver Cup'], { key: 'Laver Cup', indoor: true, file: null }); // mutation: drop INDOOR_NO_VENUE
    assert.ok(!('ATP Nowhere' in tours));
  });
  await check('request: every hourly field the tab needs, in the venue zone (timezone=auto)', () => {
    const u = B.forecastUrl(1, 2);
    for (const f of ['wind_gusts_10m', 'wind_speed_10m', 'temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'precipitation_probability', 'precipitation'])
      assert.ok(u.includes(f), f);
    assert.ok(/timezone=auto/.test(u) && /forecast_days=8/.test(u) && /weather_code/.test(u));
  });
  await check('build: writes index + file; a null source value stays null (never 0); tz and fetchedAt recorded', async () => {
    const d = tmp(), calls = [];
    await B.build({ outDir: d, matchesPath: path.join(d, 'm.json'), hints: HINTS, coords: COORDS, log: () => {},
      now: () => new Date('2026-09-27T04:00:00Z'), fetchImpl: async u => { calls.push(u); return ok(omResponse())(); } });
    assert.strictEqual(calls.filter(u => /open-meteo/.test(u)).length, 1);                 // mutation: one call per match
    const f = JSON.parse(fs.readFileSync(path.join(d, 'weather/chengdu.json'), 'utf8'));
    assert.strictEqual(f.tz, 'Asia/Shanghai'); assert.strictEqual(f.fetchedAt, '2026-09-27T04:00:00.000Z');
    assert.strictEqual(f.hourly.gusts[5], null);                                            // mutation: `|| 0` in toFile
    assert.strictEqual(f.hourly.gusts[4], 9); assert.strictEqual(f.pastHours, 'forecast');
    const idx = JSON.parse(fs.readFileSync(path.join(d, 'weather-index.json'), 'utf8'));
    assert.strictEqual(idx.tours['ATP Chengdu'].file, 'weather/chengdu.json');
  });
  await check('fetch fails → the last good live copy is carried with its ORIGINAL fetchedAt (the tab can age it)', async () => {
    const d = tmp(), prev = { v: 2, venue: 'Chengdu', tz: 'Asia/Shanghai', fetchedAt: '2026-09-26T01:00:00.000Z', hourly: { time: [] }, daily: {} };
    await B.build({ outDir: d, matchesPath: path.join(d, 'm.json'), hints: HINTS, coords: COORDS, log: () => {},
      now: () => new Date('2026-09-27T04:00:00Z'),
      fetchImpl: async u => { if (/open-meteo/.test(u)) throw new Error('down'); return ok(prev)(); } });
    const f = JSON.parse(fs.readFileSync(path.join(d, 'weather/chengdu.json'), 'utf8'));
    assert.strictEqual(f.fetchedAt, '2026-09-26T01:00:00.000Z');                            // mutation: restamp fetchedAt
  });
  await check('fetch fails and no last good copy → no file and index file:null (tab: unavailable), never a guess', async () => {
    const d = tmp();
    await B.build({ outDir: d, matchesPath: path.join(d, 'm.json'), hints: HINTS, coords: COORDS, log: () => {},
      fetchImpl: async () => { throw new Error('down'); } });
    assert.ok(!fs.existsSync(path.join(d, 'weather/chengdu.json')));
    const idx = JSON.parse(fs.readFileSync(path.join(d, 'weather-index.json'), 'utf8'));
    assert.strictEqual(idx.tours['ATP Chengdu'].file, null);
  });
  await check('refresh every 3 h: a live copy under 3 h old is carried with NO Open-Meteo call; at 3 h it is re-fetched', async () => {
    const live = { v: 2, venue: 'Chengdu', tz: 'Asia/Shanghai', fetchedAt: '2026-09-27T01:30:00.000Z', hourly: { time: ['x'] }, daily: {} };
    const run = async nowIso => { const d = tmp(), calls = [];
      await B.build({ outDir: d, matchesPath: path.join(d, 'm.json'), hints: HINTS, coords: COORDS, log: () => {}, now: () => new Date(nowIso),
        fetchImpl: async u => { calls.push(u); return ok(/open-meteo/.test(u) ? omResponse() : live)(); } });
      return { om: calls.filter(u => /open-meteo/.test(u)).length, f: JSON.parse(fs.readFileSync(path.join(d, 'weather/chengdu.json'), 'utf8')) }; };
    assert.strictEqual(B.REFRESH_HOURS, 3);
    const fresh = await run('2026-09-27T04:29:00Z');                                        // 2 h 59 min old
    assert.strictEqual(fresh.om, 0);                                                        // mutation: fetch every run
    assert.strictEqual(fresh.f.fetchedAt, live.fetchedAt);
    const due = await run('2026-09-27T04:30:00Z');                                          // 3 h old
    assert.strictEqual(due.om, 1);                                                          // mutation: never refresh
    assert.strictEqual(due.f.fetchedAt, '2026-09-27T04:30:00.000Z');
  });
  await check('DST: hourly labels (Open-Meteo, fixed offset of the range start) become TRUE UTC instants; daily stays venue-local', () => {
    // Real response shape, Sydney 3–6 Oct 2026 (timezone=auto): 96 labels at a FIXED +10 (utc_offset_seconds
    // 36000) although AEDT (+11) starts 4 Oct 02:00 — the label "2026-10-04T02:00" does not exist locally.
    const time = []; for (let h = 0; h < 96; h++) time.push(`2026-10-0${3 + Math.floor(h / 24)}T${String(h % 24).padStart(2, '0')}:00`);
    const one = () => time.map(() => 1);
    const f = B.toFile('Sydney', -33.9, 151.2, { timezone: 'Australia/Sydney', utc_offset_seconds: 36000,
      hourly: { time, temperature_2m: one(), relative_humidity_2m: one(), apparent_temperature: one(), precipitation_probability: one(),
        precipitation: one(), wind_speed_10m: one(), wind_gusts_10m: one() },
      daily: { time: ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'], weather_code: [0, 0, 0, 0], temperature_2m_max: [1, 2, 3, 4], temperature_2m_min: [0, 0, 0, 0] } }, 'x');
    assert.strictEqual(f.v, 2);
    assert.strictEqual(f.hourly.time[0], '2026-10-02T14:00:00Z');                           // 03 Oct 00:00 at +10
    assert.strictEqual(f.hourly.time[62], '2026-10-05T04:00:00Z');                          // label 05 Oct 14:00 = 15:00 AEDT
    assert.strictEqual(new Set(f.hourly.time).size, 96);                                     // one instant per row, no duplicate
    assert.deepStrictEqual(f.daily.date, ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']);   // venue-local days kept
    assert.strictEqual(B.toFile('X', 0, 0, { timezone: 'UTC', hourly: { time: ['2026-10-03T00:00'] } }, 'x'), null);  // no offset → no file
  });
  await check('a v1 live copy (fixed-offset labels) is never carried', async () => {
    const d = tmp(), old = { v: 1, venue: 'Chengdu', tz: 'Asia/Shanghai', fetchedAt: '2026-09-27T03:00:00.000Z', hourly: { time: ['x'] }, daily: {} };
    await B.build({ outDir: d, matchesPath: path.join(d, 'm.json'), hints: HINTS, coords: COORDS, log: () => {}, now: () => new Date('2026-09-27T04:00:00Z'),
      fetchImpl: async u => { if (/open-meteo/.test(u)) throw new Error('down'); return ok(old)(); } });
    assert.ok(!fs.existsSync(path.join(d, 'weather/chengdu.json')));
  });
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
