'use strict';
// TEN-308: the ONE reader for an api-tennis `event_date` + `event_time` (the card's `date` +
// `time` on a record with no `startTs`). That pair is the api-tennis account zone's wall clock,
// Europe/Berlin — CEST (UTC+2) until 25 Oct 2026 03:00, CET (UTC+1) after. The offset comes from
// the tz database through Intl, never a fixed +2 and never a UTC read.
//
// Clock-change days:
//   - the autumn repeated hour (25 Oct 2026 02:00–02:59 happens twice) takes the EARLIER
//     instant, the CEST one. A cut at the earlier instant can only drop a real pre-start
//     price, never take an in-play one. Python's zoneinfo fold=0 gives the same.
//   - the spring gap (28 Mar 2027 02:00–02:59 never happens) reads with the pre-change
//     offset (CET), as zoneinfo fold=0 does.
// The page's cardStartMs (bsp-consult-dashboard.html) and stennisfy-drops/status.mjs carry an
// inline copy of this method because neither can require a file; build-chart-books.py,
// refresh-scores.py and kibl-stream/card_join.py use zoneinfo('Europe/Berlin').

const BERLIN_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

// Berlin's UTC offset (ms) in force at instant `at`.
function berlinOffsetMs(at) {
  const p = Object.fromEntries(BERLIN_FMT.formatToParts(new Date(at)).map(x => [x.type, x.value]));
  return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`) - Math.floor(at / 60000) * 60000;
}

// 'YYYY-MM-DD' + 'H:MM'/'HH:MM' (seconds ignored) Berlin wall clock → epoch ms; NaN when unusable.
function berlinWallMs(date, time) {
  if (typeof date !== 'string' || typeof time !== 'string') return NaN;
  const d = date.slice(0, 10), mt = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !mt) return NaN;
  const wall = Date.parse(`${d}T${mt[1].padStart(2, '0')}:${mt[2]}:00Z`);   // the wall clock AS IF it were UTC
  if (!Number.isFinite(wall)) return NaN;
  // The offsets a day either side bracket any single change; keep the ones that read back.
  const before = berlinOffsetMs(wall - 86400000), after = berlinOffsetMs(wall + 86400000);
  const hits = [wall - before, wall - after].filter(ms => ms + berlinOffsetMs(ms) === wall);
  return hits.length ? Math.min(...hits) : wall - before;
}

// Same, as a UTC ISO string; null when there is no usable instant.
function berlinWallIso(date, time) {
  const ms = berlinWallMs(date, time);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

module.exports = { berlinWallMs, berlinWallIso, berlinOffsetMs };
