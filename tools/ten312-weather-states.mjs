// TEN-304 / TEN-337 · TEST-ONLY sample data for the Match analysis → Weather tab: the design's STATE switcher
// states (DF `wxFor` WEEK / MT tables, spec §7) in build-weather.js's file shape. Never loaded by the live page.
// Used by tools/ten304-weather-fixture.mjs and tools/ten312-build-capture.mjs. Regenerates nothing.
import { makeFile } from './ten304-weather-harness.mjs';

export const WX_TZ = 'America/New_York';                         // Washington
export const WX_DAYS = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26'];
export const WX_NOW = Date.parse('2026-07-20T14:00:00Z');        // Mon Jul 20, 10:00 venue time
const CODE = { sun: 0, cloud: 3, rain: 61 };
const WEEK = {
  a: [['sun', 26, 17], ['sun', 27, 18], ['cloud', 25, 17], ['sun', 26, 16], ['cloud', 24, 16], ['sun', 25, 17], ['cloud', 24, 15]],
  b: [['sun', 26, 17], ['cloud', 25, 17], ['sun', 27, 18], ['cloud', 24, 16], ['cloud', 23, 16], ['rain', 21, 15], ['cloud', 23, 15]],
  c: [['cloud', 29, 21], ['rain', 24, 18], ['sun', 27, 18], ['sun', 28, 19], ['cloud', 26, 18], ['cloud', 25, 17], ['sun', 26, 17]],
};
// match-time values at 18:00 venue (gusts, avg wind, feels, temp, humidity, rain %, rain mm)
const MT = {
  a: { gusts: 14, wind: 8, feels: 25, temp: 24, humidity: 52, rainChance: 5, rainMm: 0 },
  b: { gusts: 16, wind: 9, feels: 27, temp: 26, humidity: 55, rainChance: 8, rainMm: 0 },
  c: { gusts: 38, wind: 22, feels: 31, temp: 29, humidity: 64, rainChance: 12, rainMm: 0.1 },
};
// in-window flags (the day's worst hour between 10:00 and 23:00)
const FLAGS = {
  a: {},
  b: { '2026-07-25': { 14: { rainChance: 72, gusts: 31 } } },
  c: { '2026-07-20': { 13: { feels: 33 } }, '2026-07-21': { 15: { rainChance: 44 } } },
};
function stateFile(k) {
  return makeFile({ tz: WX_TZ, venue: 'Washington', from: '2026-07-18', days: 12,
    fetchedAt: new Date(WX_NOW - 2 * 3600e3).toISOString(),
    day: d => { const i = WX_DAYS.indexOf(d); return i < 0 ? {} : { code: CODE[WEEK[k][i][0]], hi: WEEK[k][i][1], lo: WEEK[k][i][2] }; },
    hour: (d, h) => Object.assign({}, d === '2026-07-20' && h === 18 ? MT[k] : {}, (FLAGS[k][d] || {})[h] || {}) });
}
// The design's base court speed for Washington (DF TR.market: 0.98, Medium).
export const WX_COURT_SPEED = { abstractSpeed: 0.98, category: 'Medium' };
// { entry: the weather-index.json tours[] entry (every real entry carries the venue tz), file: weather/<slug>.json } per design state
export const WX_STATES = {
  a: { entry: { key: 'Washington', indoor: false, tz: WX_TZ, file: 'weather/fx-a.json' }, file: stateFile('a') },
  b: { entry: { key: 'Washington', indoor: false, tz: WX_TZ, file: 'weather/fx-b.json' }, file: stateFile('b') },
  c: { entry: { key: 'Washington', indoor: false, tz: WX_TZ, file: 'weather/fx-c.json' }, file: stateFile('c') },
  e: { entry: { key: 'Washington', indoor: false, tz: WX_TZ, file: null }, file: null },
  d: { entry: { key: 'Washington', indoor: true, tz: WX_TZ, file: null }, file: null },
};
