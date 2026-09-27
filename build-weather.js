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
// forecast days, requested with timezone=auto so every DAILY high/low/code is
// the venue's local day.
//
// ⚠️ DST: with timezone=auto Open-Meteo labels EVERY hour with the UTC offset in
// force at the START of the range (utc_offset_seconds) and never switches — e.g.
// Sydney 3–6 Oct 2026 comes back as 72 rows at a fixed +10, including a 02:00 on
// 4 Oct that does not exist. So the hourly labels are converted here to TRUE UTC
// instants (label − utc_offset_seconds, ISO with Z) and the page buckets them to
// venue-local days/hours with the IANA zone. timezone=GMT (or unixtime) was not
// used for the whole request because the daily arrays would then be UTC days (or
// fixed-offset midnights) — daily stays on timezone=auto, which is the venue-local
// day at that fixed offset: after a DST change its edges are 1 h off, the hi/lo of
// a day are not materially affected. Past hours are ARCHIVED FORECAST
// values, not observations (Open-Meteo docs, `past_days`): `pastHours:'forecast'`.
//
// Refresh cadence: the pipeline runs every ~10 min, but a venue is re-fetched only
// when the live copy is REFRESH_HOURS (3 h) old or more; until then the live copy
// is carried as is (original fetchedAt). The live site is the store — these files
// are built, published and never committed (.gitignore).
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
const REFRESH_HOURS = 3;
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
  const off = data && data.utc_offset_seconds;
  if (!h || !Array.isArray(h.time) || !h.time.length || !data.timezone || typeof off !== 'number' || !Number.isFinite(off)) return null;
  const instant = label => { const t = Date.parse(String(label) + ':00Z'); return Number.isFinite(t) ? new Date(t - off * 1000).toISOString().replace('.000Z', 'Z') : null; };
  const times = h.time.map(instant);
  if (times.some(t => t == null)) return null;
  const col = (obj, k, n) => Array.from({ length: n }, (_, i) =>
    (obj && Array.isArray(obj[k]) && typeof obj[k][i] === 'number' && Number.isFinite(obj[k][i])) ? obj[k][i] : null);
  const n = h.time.length, nd = d && Array.isArray(d.time) ? d.time.length : 0;
  return {
    v: 2, venue: key, lat, lon, tz: data.timezone, source: SOURCE, fetchedAt, pastHours: 'forecast',
    hourly: {
      time: times,                                           // TRUE UTC instants 'YYYY-MM-DDTHH:MM:SSZ' (see DST note above)
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
    let file = null, prev = null;
    try {                                                 // the last good copy, as published
      const p = await getJson(SITE + v.file + '?t=' + Date.now(), fetchImpl);
      if (p && p.v === 2 && p.hourly && p.fetchedAt && Number.isFinite(Date.parse(p.fetchedAt))) prev = p;
    } catch (e) { /* none published yet, or the site is unreachable */ }
    const prevAgeH = prev ? (now().getTime() - Date.parse(prev.fetchedAt)) / 3600e3 : Infinity;
    if (prev && prevAgeH >= 0 && prevAgeH < REFRESH_HOURS) {
      file = prev; status[v.key] = 'fresh (' + prev.fetchedAt + '), not re-fetched';
    } else {
      try {
        file = toFile(v.key, v.lat, v.lon, await getJson(forecastUrl(v.lat, v.lon), fetchImpl), now().toISOString());
        status[v.key] = file ? 'fetched' : 'bad-response';
      } catch (e) { status[v.key] = 'fetch-failed: ' + e.message; }
      if (!file) {                                        // carry the last good copy, original fetchedAt kept
        if (prev) { file = prev; status[v.key] += ' → carried ' + prev.fetchedAt; }
        else status[v.key] += ' → no last good copy';
      }
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

module.exports = { planVenues, toFile, forecastUrl, slugOf, build, INDOOR_NO_VENUE, HOURLY, DAILY, REFRESH_HOURS };

if (require.main === module) {
  const { TOURNAMENT_VENUE_HINTS } = require('./bsp-pipeline.js');
  const coords = JSON.parse(fs.readFileSync('tournament-venues.json', 'utf8')).venues;
  build({ hints: TOURNAMENT_VENUE_HINTS, coords }).catch(e => { console.error('build-weather failed:', e); process.exit(1); });
}
