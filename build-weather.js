#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════════
// TEN-304 · per-venue forecast files for the Match analysis → Weather tab.
//
// Writes, for every tournament on the board (matches.json):
//   weather-index.json            m.tour → { key, indoor, tz, file, archive }   (tiny, eager)
//   weather/<slug>.json           one outdoor venue's forecast     (lazy, ~12 KB)
//   weather/archive/<slug>.json   that venue's ARCHIVED forecasts  (lazy, completed matches only)
// matches.json is never touched (protected file). `tz` is the venue's IANA zone from
// tournament-venues.json, so the tab shows venue time even with no forecast file.
//
// The archive (founder ruling TEN-304, 27 Sep): a completed match shows OUR OWN forecast
// as it stood BEFORE the match — never a forecast fetched for a past date.
//   · matches[<id>]: the hourly row containing the match's start, from the LAST fetch made
//     before that start (a later pre-start fetch replaces it; none after the start ever does).
//   · days[<venue-local date>]: that day's hourly rows + daily code/hi/lo, from the last
//     fetch made before the day's playing window opened (ARCHIVE_WINDOW_FROM_HOUR, venue time).
// Pruned to ARCHIVE_KEEP_DAYS back. DURABLE (founder 2026-09-27): each run merges the COMMITTED copy (this
// checkout) with the live one, newer entry wins, and pipeline.yml commits weather/archive/ back — so a failed
// live read or a crashed run no longer loses history.
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
// Archive: a day is archived from a fetch made before its playing window opens. Must equal the
// page's WX_CONFIG.window.fromHour (a test asserts it).
const ARCHIVE_WINDOW_FROM_HOUR = 10;
const ARCHIVE_KEEP_DAYS = 14;
const ARCHIVE_FIELDS = ['temp', 'humidity', 'feels', 'rainChance', 'rainMm', 'wind', 'gusts'];
// The board's match key without its day prefix (upcoming-/live-/past-), stable across the move.
const matchKeyOf = m => String((m && m.id) || '').replace(/^[a-z]+-/, '');

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
    if (noVenue) { tours[tour] = { key: noVenue, indoor: true, tz: null, file: null, archive: null }; continue; }
    const key = venueKeyFor(tour, hints);
    if (!key) continue;                                   // unmapped → no entry → tab: unavailable
    const hint = hints[key];
    const c = coords[key], tz = (c && typeof c.tz === 'string' && c.tz) || null;
    if (hint.indoor === true) { tours[tour] = { key, indoor: true, tz, file: null, archive: null }; continue; }
    const file = c ? `weather/${slugOf(key)}.json` : null;
    const archive = c ? `weather/archive/${slugOf(key)}.json` : null;
    tours[tour] = { key, indoor: false, tz, file, archive };
    if (c) venues[key] = { key, lat: c.lat, lon: c.lon, file, archive };
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

// Venue-local calendar date + hour of an instant (IANA zone, DST-exact).
function localParts(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour };
}

// Fold one forecast file into a venue's archive. Pure — tested directly. `venueMatches` =
// [{ key, startMs }] for this venue's board matches. Only a fetch made BEFORE a match's start
// (before a day's window) is ever archived for it, and a later such fetch replaces an earlier one.
function updateArchive(prev, file, venueMatches, nowMs) {
  const a = { v: 1, venue: (file && file.venue) || (prev && prev.venue) || null,
    tz: (file && file.tz) || (prev && prev.tz) || null, source: SOURCE,
    days: Object.assign({}, prev && prev.days), matches: Object.assign({}, prev && prev.matches) };
  const fAt = file ? Date.parse(file.fetchedAt) : NaN;
  const H = file && file.hourly;
  if (Number.isFinite(fAt) && file.tz && H && Array.isArray(H.time)) {
    const rows = H.time.map((t, i) => { const ms = Date.parse(t); return Number.isFinite(ms) ? Object.assign({ i, ms }, localParts(ms, file.tz)) : null; })
      .filter(Boolean);
    const pick = idx => Object.assign({ time: idx.map(i => H.time[i]) },
      Object.fromEntries(ARCHIVE_FIELDS.map(k => [k, idx.map(i => (Array.isArray(H[k]) && typeof H[k][i] === 'number') ? H[k][i] : null)])));
    const newer = old => !old || fAt > Date.parse(old.fetchedAt);
    const D = file.daily || {}, dv = (k, j) => (j >= 0 && Array.isArray(D[k]) && typeof D[k][j] === 'number') ? D[k][j] : null;
    for (const date of [...new Set(rows.map(r => r.date))]) {
      const day = rows.filter(r => r.date === date), win = day.filter(r => r.hour >= ARCHIVE_WINDOW_FROM_HOUR);
      if (!win.length || !(fAt < Math.min(...win.map(r => r.ms))) || !newer(a.days[date])) continue;
      const j = Array.isArray(D.date) ? D.date.indexOf(date) : -1;
      a.days[date] = { fetchedAt: file.fetchedAt, code: dv('code', j), hi: dv('hi', j), lo: dv('lo', j), hourly: pick(day.map(r => r.i)) };
    }
    for (const m of venueMatches || []) {
      if (!m || !m.key || !Number.isFinite(m.startMs) || !(fAt < m.startMs)) continue;
      const old = a.matches[m.key], moved = !!old && Date.parse(old.start) !== m.startMs;   // a revised start re-reads the same fetch
      if (!(newer(old) || (moved && fAt >= Date.parse(old.fetchedAt)))) continue;
      const r = rows.find(x => x.ms <= m.startMs && m.startMs < x.ms + 3600e3);
      if (r) a.matches[m.key] = { fetchedAt: file.fetchedAt, start: new Date(m.startMs).toISOString(), hourly: pick([r.i]) };
    }
  }
  const cut = nowMs - ARCHIVE_KEEP_DAYS * 86400e3;
  const cutDate = a.tz ? localParts(cut, a.tz).date : new Date(cut).toISOString().slice(0, 10);
  for (const d of Object.keys(a.days)) if (d < cutDate) delete a.days[d];
  for (const [k, x] of Object.entries(a.matches)) if (!(Date.parse(x.start) >= cut)) delete a.matches[k];
  return a;
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// A match's start instant — the page's cardStartMs rule: startTs, else the api-tennis Berlin wall clock.
function defaultStartMs(m) {
  const t = m && m.startTs != null ? Date.parse(m.startTs) : NaN;
  if (Number.isFinite(t)) return t;
  const ms = require('./berlin-time.js').berlinWallMs(m && m.date, m && m.time);
  // the api-tennis 02:00Z placeholder is no time — never archive a forecast for a fake hour (the page's apiStartMs)
  return Number.isFinite(ms) && ((ms % 86400000) + 86400000) % 86400000 !== 7200000 ? ms : NaN;
}

// The live archive: 404 = none published yet (start empty); any other failure is retried with backoff,
// then reported — the build starts that venue's archive from this run rather than blocking the run.
// The committed copy (readCommittedArchive) is the durable one; this live read is the second source.
async function readLiveArchive(url, fetchImpl, log, retryDelayMs = 1500) {
  for (let i = 0; i < 3; i++) {
    try { const a = await getJson(url + '?t=' + Date.now(), fetchImpl); return (a && a.v === 1 && a.days && a.matches) ? a : null; }
    catch (e) {
      if (/HTTP 404/.test(e.message)) return null;
      if (i === 2) { log(`  ⚠️ archive read failed (${e.message}) — rebuilt from this run only: ${url}`); return null; }
      if (retryDelayMs) await new Promise(r => setTimeout(r, retryDelayMs * (i + 1) * (i + 1)));
    }
  }
  return null;
}

// The committed archive in this checkout (the durable copy — pipeline.yml commits it back). Missing or
// unreadable → null (never throws). Read BEFORE this run writes the same path.
function readCommittedArchive(file) {
  try { const a = JSON.parse(fs.readFileSync(file, 'utf8')); return (a && a.v === 1 && a.days && a.matches) ? a : null; } catch (e) { return null; }
}
// Two copies of one venue's archive (committed + live) → one: per day / per match the entry with the
// later fetchedAt wins (both copies only ever hold pre-start / pre-window entries). Pure — tested directly.
function mergeArchives(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const pick = (x, y) => (!x ? y : !y ? x : (Date.parse(y.fetchedAt) > Date.parse(x.fetchedAt) ? y : x));
  const out = Object.assign({}, a, { tz: a.tz || b.tz, venue: a.venue || b.venue, days: {}, matches: {} });
  for (const k of new Set([...Object.keys(a.days), ...Object.keys(b.days)])) out.days[k] = pick(a.days[k], b.days[k]);
  for (const k of new Set([...Object.keys(a.matches), ...Object.keys(b.matches)])) out.matches[k] = pick(a.matches[k], b.matches[k]);
  return out;
}

async function build({ outDir = '.', matchesPath = 'matches.json', fetchImpl = fetch, now = () => new Date(),
                       hints, coords, log = console.log, startMsOf = defaultStartMs, retryDelayMs = 1500 } = {}) {
  const raw = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));
  const matches = Array.isArray(raw) ? raw : (raw.matches || []);
  const { tours, venues } = planVenues(matches, hints, coords);
  fs.mkdirSync(path.join(outDir, 'weather', 'archive'), { recursive: true });
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
    // archive: fold this run's file (fetched or carried) in; always written so it is never dropped
    const venueMatches = matches.filter(m => m && tours[m.tour] && tours[m.tour].key === v.key)
      .map(m => ({ key: matchKeyOf(m), startMs: startMsOf(m) }));
    const prevArch = mergeArchives(readCommittedArchive(path.join(outDir, v.archive)), await readLiveArchive(SITE + v.archive, fetchImpl, log, retryDelayMs));
    const arch = updateArchive(prevArch, file, venueMatches, now().getTime());
    fs.writeFileSync(path.join(outDir, v.archive), JSON.stringify(arch));
    status[v.key] += ` · archive ${Object.keys(arch.days).length} days / ${Object.keys(arch.matches).length} matches`;
  }
  // Venues OFF the board this run: their published archive is carried (pruned) — a site deploy replaces
  // every file, so an archive not written here would vanish with its history.
  const off = Object.keys(coords || {}).filter(k => !venues[k] && hints && hints[k] && hints[k].indoor !== true);
  for (let i = 0; i < off.length; i += 8) {
    await Promise.all(off.slice(i, i + 8).map(async k => {
      const rel = `weather/archive/${slugOf(k)}.json`;
      const local = path.join(outDir, rel);
      const prev = mergeArchives(readCommittedArchive(local), await readLiveArchive(SITE + rel, fetchImpl, log, retryDelayMs));
      if (!prev) return;
      const arch = updateArchive(prev, null, [], now().getTime());
      if (!Object.keys(arch.days).length && !Object.keys(arch.matches).length) {   // fully pruned → let it go (and un-commit it)
        try { fs.unlinkSync(local); } catch (e) { /* not in this checkout */ }
        return;
      }
      fs.writeFileSync(path.join(outDir, rel), JSON.stringify(arch));
      status[k] = `off the board · archive carried: ${Object.keys(arch.days).length} days / ${Object.keys(arch.matches).length} matches`;
    }));
  }
  const index = { v: 1, generatedAt: now().toISOString(), source: SOURCE, tours };
  fs.writeFileSync(path.join(outDir, 'weather-index.json'), JSON.stringify(index));
  log(`weather: ${Object.keys(tours).length} tournaments, ${Object.keys(venues).length} outdoor venues`);
  for (const [k, s] of Object.entries(status)) log(`  ${k}: ${s}`);
  return { index, status };
}

module.exports = { defaultStartMs, planVenues, toFile, forecastUrl, slugOf, build, updateArchive, mergeArchives, localParts, matchKeyOf, INDOOR_NO_VENUE, HOURLY, DAILY, REFRESH_HOURS,
  ARCHIVE_WINDOW_FROM_HOUR, ARCHIVE_KEEP_DAYS };

if (require.main === module) {
  const { TOURNAMENT_VENUE_HINTS } = require('./bsp-pipeline.js');
  const coords = JSON.parse(fs.readFileSync('tournament-venues.json', 'utf8')).venues;
  build({ hints: TOURNAMENT_VENUE_HINTS, coords }).catch(e => { console.error('build-weather failed:', e); process.exit(1); });
}
