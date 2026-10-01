// TEN-371 (founder ruling 2026-10-01) — api-tennis is the spine for every card,
// player name and profile; The Odds API is a price backup only.
//
// On 1 Oct 00:00Z The Odds API's monthly quota reset. Odds events came back, the
// cards built from them took `home_team` / `away_team` ("Alexander Zverev") as
// display names, profiles copied those names, the pre-publish gate's
// byName('A. Zverev') missed, and every publish failed for 7+ hours.
//
// This drives the REAL writers (buildMatchObject, buildUpcomingMatchObject,
// buildOneProfile, fetchOddsForSport) with fetch stubbed, in three states —
// Odds API data present, absent, and present with full-name forms — and asserts
// the display names come out identical, in api-tennis form, in all three.
'use strict';
const fs = require('fs');
const path = require('path');

const PLAYER_NAMES = { 1980: 'A. Zverev', 1103: 'C. Norrie' };
const ODDS_API_REFUSAL = { status: 401, remaining: '0' };
let oddsApiCalls = 0;

global.fetch = async (url) => {
  const u = String(url);
  const reply = (status, body, headers = {}) => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: (h) => (h.toLowerCase() in headers ? headers[h.toLowerCase()] : null) },
    json: async () => body,
  });
  if (u.includes('the-odds-api.com')) {
    oddsApiCalls++;
    return reply(ODDS_API_REFUSAL.status, { message: 'Usage quota has been reached' },
      { 'x-requests-remaining': ODDS_API_REFUSAL.remaining });
  }
  const pk = /[?&]player_key=(\d+)/.exec(u);
  if (u.includes('method=get_players') && pk) {
    return reply(200, { success: 1, result: [{ player_key: Number(pk[1]), player_name: PLAYER_NAMES[pk[1]], player_country: 'X', stats: [], tournaments: [] }] });
  }
  return reply(200, { success: 0, result: [] });
};

const P = require('../bsp-pipeline.js');

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n); } };

// The fixture is listed Norrie-first on purpose: the odds event lists Zverev as
// home, so the orientation has to be resolved, not assumed.
const FIXTURE = {
  event_key: 12166537, event_date: '2026-10-01', event_time: '09:50',
  event_first_player: 'C. Norrie', event_second_player: 'A. Zverev',
  first_player_key: 1103, second_player_key: 1980,
  event_status: '', event_live: '0', event_qualification: 'False',
  tournament_round: 'ATP Beijing - 1/16-finals', tournament_name: 'ATP Beijing', tournament_key: 2201,
  event_first_player_logo: null, event_second_player_logo: null,
};
const oddsEvent = (home, away) => ({
  id: 'oddsapi-test', sport_key: 'tennis_atp_china_open', sport_title: 'ATP China Open',
  commence_time: '2026-10-01T07:20:00Z', home_team: home, away_team: away,
  bookmakers: [{ key: 'pinnacle', title: 'Pinnacle', markets: [{ key: 'h2h', outcomes: [
    { name: home, price: 1.30 }, { name: away, price: 3.60 }] }] }],
});
const namesByKey = (m) => ({ [m.p1Key]: m.p1, [m.p2Key]: m.p2 });

(async () => {
  const surfaceMap = new Map();
  const venueMap = new Map();

  // 1 · Odds API present, full-name forms (what the board got on 1 Oct).
  const present = await P.buildMatchObject(oddsEvent('Alexander Zverev', 'Cameron Norrie'), [FIXTURE], surfaceMap, venueMap);
  ok(present && !present.skipped, 'present: an odds event with an api-tennis fixture is carded');
  ok(present.p1 === 'A. Zverev' && present.p2 === 'C. Norrie',
     `present: card names are api-tennis's (got ${present.p1} v ${present.p2})`);
  ok(String(present.p1Key) === '1980' && String(present.p2Key) === '1103', 'present: keys follow the same orientation as the names');
  ok(present.odds.p1 === 1.30 && present.odds.p2 === 3.60, 'present: the Odds API price still lands on the right player');

  // 2 · Odds API present, already in api-tennis form.
  const short = await P.buildMatchObject(oddsEvent('A. Zverev', 'C. Norrie'), [FIXTURE], surfaceMap, venueMap);
  ok(JSON.stringify(namesByKey(short)) === JSON.stringify(namesByKey(present)),
     'short-form odds names give the same display names as full-form ones');

  // 3 · Odds API absent: the card comes from the fixture alone.
  const absent = await P.buildUpcomingMatchObject(FIXTURE, surfaceMap, venueMap);
  ok(JSON.stringify(namesByKey(absent)) === JSON.stringify(namesByKey(present)),
     `absent: the fixture-only card has the same names per player key (${JSON.stringify(namesByKey(absent))})`);

  // An odds event with no api-tennis fixture is never carded under its own names.
  const orphan = await P.buildMatchObject(oddsEvent('Bu Yunchaokete', 'Novak Djokovic'), [FIXTURE], surfaceMap, venueMap);
  ok(orphan && orphan.skipped === 'no-fixture', 'an Odds-API-only event is left off, not carded with Odds API names');

  // Profiles: the name is get_players' player_name, whatever the card said.
  const fromFull = await P.buildOneProfile('1980', 'Alexander Zverev', surfaceMap);
  const fromShort = await P.buildOneProfile('1980', 'A. Zverev', surfaceMap);
  ok(fromFull.profile && fromFull.profile.name === 'A. Zverev',
     `a profile seeded with "Alexander Zverev" is named "A. Zverev" (got ${fromFull.profile && fromFull.profile.name})`);
  ok(fromShort.profile && fromShort.profile.name === fromFull.profile.name, 'profile names are identical whatever form seeded them');

  // Odds API refusal: logged with its status and remaining credits, never fatal.
  const logged = [];
  const warn = console.warn;
  console.warn = (...a) => { logged.push(a.join(' ')); };
  let events, threw = null;
  try { events = await P.fetchOddsForSport('tennis_atp_china_open'); } catch (e) { threw = e; }
  try { await P.fetchActiveTennisSportKeys(); } catch (e) { threw = threw || e; }
  console.warn = warn;
  ok(!threw, 'an Odds API refusal never throws');
  ok(Array.isArray(events) && events.length === 0, 'a refusal yields no Odds API prices');
  ok(logged.some(l => /^Odds API unavailable: 401 \(tennis_atp_china_open, x-requests-remaining=0\)/.test(l)),
     `a refusal is logged as "Odds API unavailable: 401" with remaining credits (${logged[0] || 'nothing logged'})`);
  ok(logged.some(l => /^Odds API unavailable: 401 \(sports list/.test(l)), 'a refused sports list is logged the same way');
  ok(oddsApiCalls === 2, 'both Odds API calls were really made (the stub was reached)');

  // A dead pairing labelled 'Finished' (no winner, no game won) is never a card,
  // so it can never render a 0-0 final score. Real records from 2026-10-01.
  const molcanRinderknech = { event_key: 12166954, event_status: 'Finished', event_winner: null,
    scores: [{ score_first: '0', score_second: '0', score_set: '1' }] };
  const molcanMachac = { event_key: 12167607, event_status: 'Finished', event_winner: 'First Player',
    scores: [{ score_first: '6', score_second: '3', score_set: '1' }, { score_first: '6', score_second: '2', score_set: '2' }] };
  ok(P.isUnplayedFinishedFixture(molcanRinderknech) === true, 'Molcan v Rinderknech (Finished, no winner, 0-0) is unplayed');
  ok(P.isUnplayedFinishedFixture(molcanMachac) === false, 'Molcan v Machac (6-3 6-2) is a real result');
  ok(P.isUnplayedFinishedFixture({ ...molcanRinderknech, event_winner: 'Second Player' }) === false,
     'a named winner after 0-0 (retirement) stays a real result');
  ok(P.isUnplayedFinishedFixture({ ...molcanRinderknech, scores: [{ score_first: '1', score_second: '0', score_set: '1' }] }) === false,
     'one game won is a real (partial) result');
  ok(P.isUnplayedFinishedFixture({ ...molcanRinderknech, event_status: 'Walk Over' }) === false, 'a Walk Over is untouched');
  const src = fs.readFileSync(path.join(__dirname, '..', 'bsp-pipeline.js'), 'utf8');
  const past = src.slice(src.indexOf('const finishedPastFixtures = pastFixtures.filter('));
  ok(/&& !isUnplayedFinishedFixture\(f\)/.test(past.slice(0, past.indexOf(');'))),
     'the completed-card filter drops unplayed Finished fixtures');

  // The gate's fixtures are keyed, with no stand-in player.
  const gate = fs.readFileSync(path.join(__dirname, 'test-pp2-reconcile.js'), 'utf8');
  ok(!/byName\(/.test(gate), 'the reconcile gate looks up no fixture player by name');
  ok(/const ZVEREV = fixturePlayer\(FIXTURE_KEYS\.zverev\);/.test(gate), 'ZVEREV is the key-1980 player with no fallback');
  ok(!/\|\| SAMPLE\[0\]|\|\| pickByRank\(1\)|\|\| pickByRank\(340\)/.test(gate), 'no fixture falls back to a different player');
  ok(/fixture player \$\{key\} not found/.test(gate), 'a missing fixture player aborts with its key');

  // ...so the pipeline must always build them: one shared key list, built first and
  // outside the per-run budget, or a schema bump would starve an unranked fixture
  // player (Schwartzman sorts last) and freeze every publish.
  const FIX = require('../pp2-fixture-players.js');
  ok(/const FIXTURE_KEYS = require\('\.\.\/pp2-fixture-players\.js'\);/.test(gate), 'the gate reads the shared fixture-key list');
  ok(/const PINNED_PROFILE_KEYS = new Set\(Object\.values\(require\('\.\/pp2-fixture-players'\)\)\);/.test(src),
     'the pipeline pins the same list');
  ok(JSON.stringify(Object.values(FIX).sort()) === JSON.stringify(['1905', '1980', '2382', '67']),
     'the list is Alcaraz 2382, Zverev 1980, Djokovic 1905, Schwartzman 67');
  ok(/if \(built >= MAX_OPPONENT_BUILDS_PER_RUN && !PINNED_PROFILE_KEYS\.has\(String\(key\)\)\)/.test(src),
     'an opponent fixture player is built even past the opponent budget');
  ok(/const outOfBudget = !PINNED_PROFILE_KEYS\.has\(key\) && \(/.test(src), 'a shard fixture player is never out of budget');
  ok(/for \(const key of PINNED_PROFILE_KEYS\) \{\s*if \(!eagerKeys\.has\(key\) && !shardPool\.has\(key\)\) shardPool\.set\(key, ''\);/.test(src),
     'a fixture player is always in the shard pool, ranked or not');
  ok(/const pa = PINNED_PROFILE_KEYS\.has\(a\[0\]\) \? 0 : 1;/.test(src), 'fixture players are built first');
  ok(/if \(fresh && !\(PINNED_PROFILE_KEYS\.has\(String\(key\)\) && !cached\.profile\)\)/.test(src),
     'an opponent fixture player with a cached null is rebuilt, not held for the 14-day TTL');
  ok(/if \(fresh && !\(PINNED_PROFILE_KEYS\.has\(key\) && !cached\.profile\)\)/.test(src),
     'a shard fixture player with a cached null is rebuilt, not held for the 14-day TTL');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('test-ten371-name-spine crashed:', e); process.exit(1); });
