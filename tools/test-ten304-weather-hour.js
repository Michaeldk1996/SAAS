#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════════
// TEN-304 · Wave A — weather read at the REAL start hour; weather layer #12 OFF
// ----------------------------------------------------------------------------
// api-tennis event_date + event_time is the scheduled start on the Europe/Berlin
// wall clock. The pipeline built `${date}T${time}:00` (and `...:00Z` for past
// matches) and looked the forecast up as if that were UTC — 2 h late in CEST,
// 1 h late in CET. Founder ruling: parse through the tz database (not a fixed +2)
// and cover a match on each side of the 25 Oct 2026 DST change.
// Layer #12 is switched off until the time fix AND an indoor check are both in.
// ════════════════════════════════════════════════════════════════════════════
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const P = require('../bsp-pipeline.js');
const cfg = require('../h2h-model/config.js');
const { weather } = require('../h2h-model/adjustments.js');

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' :: ' + e.message); }
}

(async () => {
  console.log('TEN-304 · weather hour + layer #12\n');

  // Mutation that fails these: replace berlinWallMs with Date.parse(`${d}T${t}:00Z`) (UTC read),
  // or with a fixed +2 offset (fails the CET case only).
  await check('CEST side (24 Oct): 14:00 Berlin = 12:00Z', () =>
    assert.strictEqual(P.weatherStartIso('2026-10-24', '14:00'), '2026-10-24T12:00:00.000Z'));
  await check('CET side (26 Oct): 14:00 Berlin = 13:00Z — a fixed +2 is 1 h wrong here', () =>
    assert.strictEqual(P.weatherStartIso('2026-10-26', '14:00'), '2026-10-26T13:00:00.000Z'));
  await check('no time → null (no weather at a guessed noon/midnight)', () => {
    assert.strictEqual(P.weatherStartIso('2026-09-27', null), null);
    assert.strictEqual(P.weatherStartIso('2026-09-27', ''), null);
  });

  // Drive the real fetchMatchWeather with a stubbed Open-Meteo response (timezone=UTC rows).
  // Hangzhou QF, Medvedev v Wong: 13:30 Berlin = 11:30Z → the 11:00Z row (19:00 Hangzhou).
  const realFetch = global.fetch;
  const hours = [], temp = [], wind = [], hum = [];
  for (let h = 0; h < 24; h++) { hours.push(`2026-09-27T${String(h).padStart(2, '0')}:00`); temp.push(100 + h); wind.push(h); hum.push(h); }
  global.fetch = async () => ({ json: async () => ({
    hourly: { time: hours, temperature_2m: temp, windspeed_10m: wind, relative_humidity_2m: hum },
    daily: { time: ['2026-09-27'], weathercode: [3], temperature_2m_max: [33], temperature_2m_min: [24],
             precipitation_probability_max: [99], windspeed_10m_max: [12] } }) });
  try {
    const venues = { Hangzhou: { lat: 30.29, lon: 120.16 } };
    await check('fetchMatchWeather reads the 11:00Z row for a 13:30 Berlin start (was 13:00Z)', async () => {
      const w = await P.fetchMatchWeather('ATP Hangzhou', P.weatherStartIso('2026-09-27', '13:30'), venues);
      assert.ok(w, 'weather returned');
      assert.strictEqual(w.temperature, 111, `temperature row ${w.temperature - 100}Z`);
    });
    await check('control: the old zoneless string lands 2 h late (13:00Z row)', async () => {
      const w = await P.fetchMatchWeather('ATP Hangzhou', '2026-09-27T13:30:00Z', venues);
      assert.strictEqual(w.temperature, 113);
    });
  } finally { global.fetch = realFetch; }

  // Both call sites must pass the converted instant. Mutation: restore
  // `fetchMatchWeather(tour, commence, venueMap)` or the `...:00Z` past string.
  const src = fs.readFileSync(path.join(__dirname, '..', 'bsp-pipeline.js'), 'utf8');
  await check('every api-tennis fetchMatchWeather call site goes through weatherStartIso', () => {
    assert.ok(!/fetchMatchWeather\(tour,\s*commence\b/.test(src), 'upcoming path still passes the zoneless commence');
    assert.ok(!/pastMatchDateTime\s*=\s*`\$\{fixture\.event_date\}T/.test(src), 'past path still builds a UTC string');
    const calls = src.match(/fetchMatchWeather\(tour,\s*(\w+)/g) || [];
    assert.deepStrictEqual(calls.map(c => c.split(/,\s*/)[1]).sort(), ['pastMatchDateTime', 'weatherStart']);
  });

  // Layer #12 OFF. Mutation: remove the `if (c.gated) return gate(...)` guard or set gated:false.
  const ctx = { match: { weather: { temperature: 38, windSpeed: 35, humidity: 90, historical: false,
                week: [{ isMatch: true, available: true, rain: 90, code: 63 }] } },
                p1: { radar: { serve: 80, movement: 40 } }, p2: { radar: { serve: 40, movement: 85 } } };
  await check('layer #12 is gated: no delta even in extreme conditions', () => {
    const r = weather(ctx);
    assert.strictEqual(cfg.adjustments.weather.gated, true);
    assert.strictEqual(r.applied, false); assert.strictEqual(r.deltaP1, 0); assert.strictEqual(r.gated, true);
  });
  await check('control: with the flag off the same match WOULD move (the test is not vacuous)', () => {
    cfg.adjustments.weather.gated = false;
    try { const r = weather(ctx); assert.strictEqual(r.applied, true); assert.ok(r.deltaP1 !== 0); }
    finally { cfg.adjustments.weather.gated = true; }
  });

  await check('Brussels mapped (indoor hard) with coordinates; Santiago outdoor clay (founder ruling)', () => {
    const h = P.TOURNAMENT_VENUE_HINTS;
    assert.deepStrictEqual([h.Brussels.indoor, h.Brussels.surface, h.Brussels.country], [true, 'hard', 'BE']);
    assert.deepStrictEqual([h.Santiago.indoor, h.Santiago.surface], [false, 'clay']);
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tournament-venues.json'), 'utf8')).venues;
    assert.ok(Number.isFinite(v.Brussels.lat) && Number.isFinite(v.Brussels.lon));
  });

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
