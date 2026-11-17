// =================================================================
// Tour-level fill for surface-ratings.js — the seasons TML does not carry
// -----------------------------------------------------------------
// WHY (measured 17 Nov 2026): surface-ratings.js reads tour-level matches from the
//   Tennismylife/TML-Database CSVs. Its 2026.csv stops on 17 Jan 2026 (136 matches:
//   United Cup, Brisbane, Hong Kong, Adelaide, Auckland) and has not been updated
//   since; api-tennis holds those same 136 main-draw matches plus 2,697 more with box
//   scores (18 Jan – 16 Nov). Without them every player's 2026 tour season was missing
//   from Serve / Return / Under pressure, and a 2026 breakout (R. Jodar, key 50323)
//   fell under the inclusion gate and left the store.
//
// THE RULE — one source per match, never both:
//   • a tour match dated ON OR BEFORE the last date TML holds (`tmlEnd`) comes from TML;
//   • a tour match dated AFTER it comes from api-tennis ATP singles (event_type 265),
//     per player, through the same fetch + stat mapping the Challenger fold-in uses
//     (surface-ratings-chall-apitennis.js), so the numbers are built the same way.
//   When TML resumes publishing, `tmlEnd` moves forward and the fill shrinks with it.
//
// WHICH api-tennis rows count — the TML population (ATP main draw, Davis Cup and team
// events included, retirements included, walkovers carry no stats):
//   • event_status Finished or Retired (Cancelled / Walk Over / Interrupted / Awarded out);
//   • event_qualification !== 'True' (TML holds no qualifying);
//   • a box score for the player (buildContribs skips fixtures without one);
//   • dated after tmlEnd.
// A Retired match counts its tiebreaks but never a deciding set — the same as TML's
// parseScore, which skips the decider on a RET score.
//
// These are TOUR rows: they go into the player's tour buckets, never the Challenger
// bucket, so no CHALL_DISCOUNT applies (they are not Challenger data).
// =================================================================
'use strict';
const { fetchPlayerChallengerFixtures, buildContribs } = require('./surface-ratings-chall-apitennis.js');

const TOUR_EVENT_TYPE = 265;   // ATP Singles
const COUNTED_STATUS = new Set(['Finished', 'Retired']);
const MAX_REFUSAL_RATE = 0.02;  // same fail-loud threshold as the Challenger fetch

function ymdMs(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}

// Pure: one player's api-tennis fixtures -> tour contributions dated after tmlEnd (ms).
function tourFillContribs(fixtures, playerKey, surfaceMap, tmlEnd) {
  const out = [];
  for (const f of fixtures || []) {
    if (!f || !COUNTED_STATUS.has(String(f.event_status))) continue;
    if (String(f.event_qualification) === 'True') continue;
    const d = ymdMs(f.event_date);
    if (d == null || !(d > tmlEnd)) continue;
    const built = buildContribs([f], playerKey, surfaceMap);
    if (!built.length) continue;
    const c = built[0];
    if (String(f.event_status) === 'Retired') { c.decPlayed = 0; c.decWon = 0; }
    c.src = 'api-tennis';
    c.eventKey = f.event_key != null ? String(f.event_key) : null;
    out.push(c);
  }
  return out;
}

// Pure: the player's tour contributions = TML rows up to tmlEnd + api rows after it.
// Defensive: a TML row after tmlEnd cannot exist by construction (tmlEnd is TML's max),
// and an api row on or before it is dropped, so no match is counted twice.
function mergeTourContribs(tmlContribs, apiContribs, tmlEnd) {
  const tml = (tmlContribs || []).filter(c => c.date == null || c.date <= tmlEnd);
  const seen = new Set();
  const api = [];
  for (const c of apiContribs || []) {
    if (c.date == null || !(c.date > tmlEnd)) continue;
    if (c.eventKey && seen.has(c.eventKey)) continue;   // one api-tennis fixture, once
    if (c.eventKey) seen.add(c.eventKey);
    api.push(c);
  }
  return tml.concat(api);
}

// Network: per candidate, ATP singles fixtures from the day after tmlEnd to dateStop.
async function fetchTourFillContribs(candidates, opts) {
  const { apiKey, tmlEnd, dateStop, surfaceMap, concurrency = 8, log = () => {} } = opts;
  const dateStart = new Date(tmlEnd + 86400000).toISOString().slice(0, 10);
  const byKey = new Map();
  const reasons = new Map();
  let i = 0, fetched = 0, refusals = 0, matches = 0;
  async function worker() {
    while (i < candidates.length) {
      const c = candidates[i++];
      const r = await fetchPlayerChallengerFixtures(apiKey, c.playerKey, dateStart, dateStop, TOUR_EVENT_TYPE);
      fetched++;
      if (!r || !r.ok) {
        refusals++;
        const why = (r && r.reason) || 'unknown';
        reasons.set(why, (reasons.get(why) || 0) + 1);
        continue;
      }
      const contribs = tourFillContribs(r.rows, c.playerKey, surfaceMap, tmlEnd);
      byKey.set(String(c.playerKey), contribs);
      matches += contribs.length;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
  const refusalRate = fetched ? refusals / fetched : 0;
  log(`tour-fill: ${dateStart}..${dateStop}, ${fetched} fetched, ${refusals} refused, ` +
      `${[...byKey.values()].filter(v => v.length).length} players with matches, ${matches} player-matches.`);
  return { byKey, fetched, refusals, refusalRate, reasons, maxRefusalRate: MAX_REFUSAL_RATE, dateStart };
}

module.exports = { tourFillContribs, mergeTourContribs, fetchTourFillContribs, TOUR_EVENT_TYPE };
