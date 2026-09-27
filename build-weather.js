#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════════
// TEN-304 · per-venue forecast files for the Match analysis → Weather tab.
//
// Writes, for every tournament on the board (matches.json):
//   weather-index.json            m.tour → { key, indoor, file }   (tiny, eager)
//   weather/<slug>.json           one outdoor venue's forecast     (lazy, ~9 KB)
// matches.json is never touched (protected file).
//
// Source: Open-Meteo's free endpoint (founder ruling TEN-304: licence accepted,
// no key). One call per OUTDOOR venue, never per match. Hourly for 2 past + 8
// forecast days, requested in the venue's own zone (timezone=auto), so every
// hour and every daily high/low is venue-local. Past hours are ARCHIVED FORECAST
// values, not observations (Open-Meteo docs, `past_days`): `pastHours:'forecast'`.
//
// A failed fetch never writes a guess: the last good file is carried over from
// the live site with its ORIGINAL fetchedAt, so the tab can say how old it is
// (6–24 h amber, >24 h unavailable — TEN-304 brief §2.4). No last good copy →
// the venue gets no file, and the tab shows the unavailable state.
// ════════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const SITE = 'https://michaeldk1996.github.io/SAAS/';
const SOURCE = 'Open-Meteo';
const HOURLY = ['temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'precipitation_probability',
  'precipitation', 'wind_speed_10m', 'wind_gusts_10m'];
const DAILY = ['weather_code', 'temperature_2m_max', 'temperature_2m_min'];
// Venues with no fixed site that are always played under a roof (founder ruling TEN-304: Laver Cup → indoor panel).
const INDOOR_NO_VENUE = ['Laver Cup'];

const slugOf = key => String(key).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function venueKeyFor(tour, hints) {
  if (typeof tour !== 'string' || !tour) return null;
  return Object.keys(hints).find(k => tour.includes(k)) || null;
}

// Map the board's tournaments to venue entries. Pure — tested directly.
function planVenues(matches, hints, coords) {
  const tours = {}, venues = {};
  for (const m of matches || []) {
    const tour = m && m.tour;
    if (!tour || tours[tour]) continue;
    const noVenue = INDOOR_NO_VENUE.find(k => tour.includes(k));
    if (noVenue) { tours[tour] = { key: noVenue, indoor: true, file: null }; continue; }
    const key = venueKeyFor(tour, hints);
    if (!key) continue;                                   // unmapped → no entry → tab: unavailable
    const hint = hints[key];
    if (hint.indoor === true) { tours[tour] = { key, indoor: true, file: null }; continue; }
    const c = coords[key];
    const file = c ? `weather/${slugOf(key)}.json` : null;
    tours[tour] = { key, indoor: false, file };
    if (c) venues[key] = { key, lat: c.lat, lon: c.lon, file };
  }
  return { tours, venues };
}

function forecastUrl(lat, lon) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&hourly=${HOURLY.join(',')}&daily=${DAILY.join(',')}`
    + `&past_days=2&forecast_days=8&timezone=auto&wind_speed_unit=kmh`;
}

// Open-Meteo response → our file. A missing array or value stays null (the tab dashes it).
function toFile(key, lat, lon, data, fetchedAt) {
  const h = data && data.hourly, d = data && data.daily;
  if (!h || !Array.isArray(h.time) || !h.time.length || !data.timezone) return null;
  const col = (obj, k, n) => Array.from({ length: n }, (_, i) =>
    (obj && Array.isArray(obj[k]) && typeof obj[k][i] === 'number' && Number.isFinite(obj[k][i])) ? obj[k][i] : null);
  const n = h.time.length, nd = d && Array.isArray(d.time) ? d.time.length : 0;
  return {
    v: 1, venue: key, lat, lon, tz: data.timezone, source: SOURCE, fetchedAt, pastHours: 'forecast',
    hourly: {
      time: h.time.slice(),                                  // venue-local 'YYYY-MM-DDTHH:MM'
      temp: col(h, 'temperature_2m', n), humidity: col(h, 'relative_humidity_2m', n),
      feels: col(h, 'apparent_temperature', n), rainChance: col(h, 'precipitation_probability', n),
      rainMm: col(h, 'precipitation', n), wind: col(h, 'wind_speed_10m', n), gusts: col(h, 'wind_gusts_10m', n),
    },
    daily: { date: nd ? d.time.slice() : [], code: col(d, 'weather_code', nd),
             hi: col(d, 'temperature_2m_max', nd), lo: col(d, 'temperature_2m_min', nd) },
  };
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function build({ outDir = '.', matchesPath = 'matches.json', fetchImpl = fetch, now = () => new Date(),
                       hints, coords, log = console.log } = {}) {
  const raw = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));
  const matches = Array.isArray(raw) ? raw : (raw.matches || []);
  const { tours, venues } = planVenues(matches, hints, coords);
  fs.mkdirSync(path.join(outDir, 'weather'), { recursive: true });
  const status = {};
  for (const v of Object.values(venues)) {
    let file = null;
    try {
      file = toFile(v.key, v.lat, v.lon, await getJson(forecastUrl(v.lat, v.lon), fetchImpl), now().toISOString());
      status[v.key] = file ? 'fetched' : 'bad-response';
    } catch (e) { status[v.key] = 'fetch-failed: ' + e.message; }
    if (!file) {                                          // carry the last good copy, original fetchedAt kept
      try {
        const prev = await getJson(SITE + v.file + '?t=' + Date.now(), fetchImpl);
        if (prev && prev.v === 1 && prev.hourly && prev.fetchedAt) { file = prev; status[v.key] += ' → carried ' + prev.fetchedAt; }
      } catch (e) { status[v.key] += ' → no last good copy'; }
    }
    if (file) fs.writeFileSync(path.join(outDir, v.file), JSON.stringify(file));
    else for (const t of Object.values(tours)) if (t.key === v.key) t.file = null;
  }
  const index = { v: 1, generatedAt: now().toISOString(), source: SOURCE, tours };
  fs.writeFileSync(path.join(outDir, 'weather-index.json'), JSON.stringify(index));
  log(`weather: ${Object.keys(tours).length} tournaments, ${Object.keys(venues).length} outdoor venues`);
  for (const [k, s] of Object.entries(status)) log(`  ${k}: ${s}`);
  return { index, status };
}

module.exports = { planVenues, toFile, forecastUrl, slugOf, build, INDOOR_NO_VENUE, HOURLY, DAILY };

if (require.main === module) {
  const { TOURNAMENT_VENUE_HINTS } = require('./bsp-pipeline.js');
  const coords = JSON.parse(fs.readFileSync('tournament-venues.json', 'utf8')).venues;
  build({ hints: TOURNAMENT_VENUE_HINTS, coords }).catch(e => { console.error('build-weather failed:', e); process.exit(1); });
}
