#!/usr/bin/env node
'use strict';
/**
 * TEN-206 — per-EVENT coverage index for the ruled match-stat fields.
 *
 * FOUNDER RULING 2026-09-18 (Q2), third clause: "Add the whole-event note when an
 * event is 0/n ('no match at this event carries winners'), so a total absence reads
 * as a feed gap rather than a per-player one. Apply the same rule to Winners, UE and
 * Net points."
 *
 * WHY THIS IS A BUILD-TIME ARTIFACT AND NOT A CLIENT-SIDE SCAN. The question the note
 * answers is about the WHOLE EVENT — "does any match at this tournament edition carry
 * winners" — and the page only ever loads one player. The event's other matches belong
 * to other players' profiles, so the browser cannot see them. Answering it client-side
 * would silently narrow the claim to "none of THIS PLAYER's matches here carry winners",
 * which is the per-player reading the ruling exists to stop.
 *
 * ZERO API REQUESTS. historical-match-stats.json is keyed by api-tennis eventKey and
 * carries no tournament identity, but the profile store's recentForm rows carry both
 * `eventKey` and `tournament`+`date` — so the eventKey -> edition mapping is a join
 * over data we already publish. Measured 2026-09-18: 1,996 of 2,122 store keys map
 * (94.1%). The founder deferred new requests (Q3), and this needs none.
 *
 * AN EDITION, NOT A TOURNAMENT. The key is `tournament|year`. "Winners are absent from
 * Genova" is not a claim anyone can act on; "no match at Genova 2026 carries winners"
 * is, because the feed's stat depth changes between editions, not between venues.
 *
 * THE n>=2 FLOOR IS LOAD-BEARING. An event we hold exactly one match for is 0/1 when
 * that match dashes — which is the per-player case wearing the feed-gap label, i.e.
 * precisely the confusion the note is meant to remove. Those stay silent. Measured
 * cost of the floor: 5 events for winners, 6 for net points.
 *
 * Usage: node tools/build-event-stat-coverage.js [--out=match-stat-event-coverage.json]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STORE = path.join(ROOT, 'historical-match-stats.json');
const FLOOR = path.join(ROOT, 'historical-match-stats.floor.json');
const OUT_DEFAULT = 'match-stat-event-coverage.json';

// The three fields the ruling names, with the short code the page reads them under.
// Codes rather than the full api-tennis key so the published artifact stays small;
// the page's SHEET_SECTIONS rows carry the same codes.
const FIELDS = [
  { code: 'w', field: 'Points:Winners', label: 'winners' },
  { code: 'u', field: 'Points:Unforced errors', label: 'unforced errors' },
  { code: 'n', field: 'Points:Net points won', label: 'net points' },
];

/** eventKey -> "tournament|year", joined out of the profile store's recentForm. */
function editionIndex(players) {
  const out = new Map();
  for (const p of players) {
    const ms = p && p.recentForm && p.recentForm.matches;
    if (!Array.isArray(ms)) continue;
    for (const r of ms) {
      if (r == null || r.eventKey == null || !r.tournament || !r.date) continue;
      const key = String(r.eventKey);
      if (out.has(key)) continue;
      const year = String(r.date).slice(0, 4);
      if (!/^\d{4}$/.test(year)) continue;
      out.set(key, `${r.tournament}|${year}`);
    }
  }
  return out;
}

/**
 * For each edition, how many of its matches in the store carry each field — counting a
 * match as carrying it when EITHER player's side does. Either, not both: a half-published
 * sheet still proves the feed publishes the field at this event, which is the only thing
 * the note claims.
 */
function tally(store, editions) {
  const events = {};
  for (const [eventKey, edition] of editions) {
    const ms = store[eventKey] && store[eventKey].matchStats;
    if (!ms || !ms.p1) continue;
    const e = events[edition] || (events[edition] = { n: 0, w: 0, u: 0, n_: 0 });
    e.n++;
    for (const f of FIELDS) {
      if (['p1', 'p2'].some((s) => ms[s] && ms[s][f.field] != null)) {
        e[f.code === 'n' ? 'n_' : f.code]++;
      }
    }
  }
  return events;
}

function build(store, players) {
  const editions = editionIndex(players);
  const events = tally(store, editions);
  // Only the keys that resolved to an edition are published — an unmapped key would
  // otherwise read as "no event known" and "event fully covered" identically.
  const keys = {};
  for (const [eventKey, edition] of editions) {
    if (store[eventKey] && store[eventKey].matchStats && events[edition]) keys[eventKey] = edition;
  }
  return { builtFrom: { storeEntries: Object.keys(store).length, mapped: Object.keys(keys).length }, keys, events };
}

function summarise(model) {
  const lines = [];
  for (const f of FIELDS) {
    const c = f.code === 'n' ? 'n_' : f.code;
    let silentThin = 0, gap = 0, gapMatches = 0, full = 0, mixed = 0;
    for (const e of Object.values(model.events)) {
      if (e[c] === 0) { if (e.n >= 2) { gap++; gapMatches += e.n; } else silentThin++; }
      else if (e[c] === e.n) full++;
      else mixed++;
    }
    lines.push(`  ${f.label.padEnd(16)} ${gap} event(s) carry none (${gapMatches} matches, the note fires), ` +
      `${full} carry all, ${mixed} mixed, ${silentThin} held back by the n>=2 floor`);
  }
  return lines.join('\n');
}

if (require.main === module) {
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  const out = path.join(ROOT, outArg ? outArg.slice(6) : OUT_DEFAULT);

  // The working store when the pipeline has written one, else the committed floor, so
  // this is runnable on an operator box where the pipeline has never run.
  const storePath = fs.existsSync(STORE) ? STORE : FLOOR;
  const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));

  // Deployed profile store, with the same fail-closed rule the rest of the suite uses:
  // the committed player-profiles.json is a known fossil and building this index off it
  // would publish a coverage claim describing months-old data.
  const DEPLOYED = require('./deployed-store.js');
  const S = DEPLOYED.playerProfiles();
  if (S.source !== 'deployed') {
    console.error(`::error title=event coverage index not built::could not read the deployed profile store (${S.drift && S.drift.why}). Refusing to build the whole-event note off the committed fossil.`);
    process.exit(1);
  }
  const players = Object.values(S.players);

  const model = build(store, players);
  fs.writeFileSync(out, JSON.stringify(model));
  const pct = (100 * model.builtFrom.mapped / model.builtFrom.storeEntries).toFixed(1);
  console.log(`event-stat-coverage: ${path.basename(out)} <- ${path.basename(storePath)} + ${players.length} deployed profiles.`);
  console.log(`  ${model.builtFrom.mapped}/${model.builtFrom.storeEntries} store keys mapped to an edition (${pct}%), ${Object.keys(model.events).length} editions.`);
  console.log(summarise(model));
}

module.exports = { FIELDS, editionIndex, tally, build, summarise };
