// One-off backfill: adds a real Mon–Sun forecast `week` to each match's
// existing `weather` object in matches.json, using the same Open-Meteo
// response shape the pipeline now uses. Groups by venue so each venue is
// fetched once. Every value is real; days outside Open-Meteo's window are
// marked { available:false }. Safe to re-run (idempotent overwrite of the
// week fields only). The pipeline itself now produces this on every run;
// this just populates the current file without a full rebuild.
const fs = require('fs');

const MATCHES_PATH = 'matches.json';
const VENUES = JSON.parse(fs.readFileSync('tournament-venues.json', 'utf8')).venues;

function buildForecastWeek(daily, hourly, matchDateStr) {
  if (!daily || !daily.time) return null;
  const mon = new Date(matchDateStr + 'T00:00:00Z');
  mon.setUTCDate(mon.getUTCDate() - ((mon.getUTCDay() + 6) % 7));
  const ymd = d => d.toISOString().slice(0, 10);
  const week = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(mon); day.setUTCDate(mon.getUTCDate() + i);
    const ds = ymd(day);
    const di = daily.time.indexOf(ds);
    if (di === -1) { week.push({ date: ds, available: false }); continue; }
    let hSum = 0, hN = 0;
    if (hourly && hourly.time) {
      for (let h = 0; h < hourly.time.length; h++) {
        if (hourly.time[h].slice(0, 10) === ds && hourly.relative_humidity_2m[h] != null) {
          hSum += hourly.relative_humidity_2m[h]; hN++;
        }
      }
    }
    const hi = daily.temperature_2m_max[di], lo = daily.temperature_2m_min[di], wd = daily.windspeed_10m_max[di];
    week.push({
      date: ds,
      dow: day.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
      label: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      code: daily.weathercode[di],
      hi: hi != null ? Math.round(hi) : null,
      lo: lo != null ? Math.round(lo) : null,
      rain: daily.precipitation_probability_max[di],
      wind: wd != null ? Math.round(wd) : null,
      humidity: hN ? Math.round(hSum / hN) : null,
      isMatch: ds === matchDateStr,
      available: true,
    });
  }
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  const weekRange = mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    + ' \u2013 ' + sun.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'UTC' })
    + ', ' + sun.getUTCFullYear();
  return { weekRange, days: week };
}

async function fetchVenue(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&hourly=relative_humidity_2m`
    + `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max`
    + `&past_days=7&forecast_days=7&timezone=UTC`;
  const res = await fetch(url);
  return res.json();
}

(async () => {
  const matches = JSON.parse(fs.readFileSync(MATCHES_PATH, 'utf8'));
  const cache = new Map(); // venueKey -> api response
  let patched = 0, skipped = 0;
  for (const m of matches) {
    if (!m.weather || !m.date) { skipped++; continue; }
    const key = Object.keys(VENUES).find(k => (m.tour || '').includes(k));
    if (!key) { skipped++; continue; }
    if (!cache.has(key)) {
      const { lat, lon } = VENUES[key];
      cache.set(key, await fetchVenue(lat, lon));
      await new Promise(r => setTimeout(r, 150));
    }
    const data = cache.get(key);
    const forecast = buildForecastWeek(data.daily, data.hourly, m.date);
    if (forecast) {
      m.weather.weekRange = forecast.weekRange;
      m.weather.week = forecast.days;
      patched++;
    } else { skipped++; }
  }
  fs.writeFileSync(MATCHES_PATH, JSON.stringify(matches, null, 2));
  console.log(`Backfill done: ${patched} matches patched, ${skipped} skipped. Venues fetched: ${cache.size} (${[...cache.keys()].join(', ')}).`);
  // Spot-check one
  const eg = matches.find(x => x.weather && x.weather.week);
  if (eg) { console.log('Sample:', eg.tour, eg.date, eg.weather.weekRange); console.log(JSON.stringify(eg.weather.week.map(d => d.available ? `${d.dow} ${d.code} ${d.hi}/${d.lo} r${d.rain} w${d.wind} h${d.humidity}${d.isMatch?' *MATCH*':''}` : `${d.date} NA`))); }
})();
