/**
 * BSP Consult — Data Pipeline (Odds + API-Tennis)
 * -----------------------------------------------------------------
 * Combines two real, tested sources:
 *   - The Odds API: live odds, best-price comparison (free tier)
 *   - API-Tennis.com: real fixtures with player keys, H2H history,
 *     and career/surface stats (trial key confirmed working)
 *
 * WHAT'S REAL vs WHAT'S STILL MISSING
 * ------------------------------------
 * REAL now: odds, best-price, vig-removed implied probability, H2H
 *   record (via API-Tennis get_H2H), each player's singles surface
 *   win rate (via get_players, singles-only, confirmed bug-fixed),
 *   current ATP/WTA singles rank, tournament round.
 * STILL MISSING: playing-style classification (nobody sells this —
 *   it's your own methodology to build on top of the stats above),
 *   weather (separate, unresearched API), and `value` (needs your
 *   own model probability compared against the market — left null,
 *   never faked).
 *
 * SETUP
 * -----
 * 1. Node 18+ (built-in fetch)
 * 2. npm install dotenv
 * 3. .env file:
 *      ODDS_API_KEY=your_odds_api_key
 *      API_TENNIS_KEY=your_api_tennis_key
 * 4. node bsp-pipeline.js
 */

require('dotenv').config();
const fs = require('fs');
const { backfillProfilesHistory, backfillMatchesTournamentHistory, buildArchiveHistories } = require('./career-backfill');
// Layer #8 W/UE source resolver: api-tennis primary, @ATP_Entry OCR fallback,
// never mixed within a match (see atp-entry-fallback.js).
const { attachWue, lookupWue } = require('./atp-entry-fallback');

// Atomic JSON write: write to a temp file in the same directory, then rename
// over the target. rename(2) is atomic on the same filesystem, so a reader
// (e.g. the dashboard's 3-minute refresh) always sees either the old complete
// file or the new complete file — never a half-written one. This eliminates the
// intermittent "Unexpected end of JSON / Expected ',' or '}'" parse errors the
// dashboard hit when it fetched matches.json mid-write.
function writeJsonAtomic(file, data, compact) {
  const tmp = `${file}.tmp-${process.pid}`;
  // `compact` (no indentation) for large machine-consumed files served to the
  // browser (e.g. player-profiles.json) — pretty-printing them is ~2.4x wasted
  // bytes over the wire. Human-diffed/committed files (matches.json) stay pretty.
  fs.writeFileSync(tmp, compact ? JSON.stringify(data) : JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

const API_TENNIS_KEY = process.env.API_TENNIS_KEY;
const API_TENNIS_BASE = 'https://api.api-tennis.com/tennis/';

// =================================================================
// ODDS API — fixtures + live odds (unchanged, already tested)
// =================================================================
async function fetchActiveTennisSportKeys() {
  const url = `${ODDS_API_BASE}/sports?apiKey=${ODDS_API_KEY}`;
  const res = await fetch(url);
  const sports = await res.json();
  // ATP only — BSP Consult is focused on ATP, not WTA.
  return sports.filter(s => s.key.startsWith('tennis_') && s.key.includes('atp') && s.active)
    .map(s => ({ key: s.key, title: s.title }));
}

async function fetchOddsForSport(sportKey) {
  const url = `${ODDS_API_BASE}/sports/${sportKey}/odds?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h&oddsFormat=decimal`;
  const res = await fetch(url);
  if (!res.ok) return [];
  return res.json();
}

async function fetchAllTennisEvents() {
  const sports = await fetchActiveTennisSportKeys();
  const allEvents = [];
  for (const sport of sports) {
    const events = await fetchOddsForSport(sport.key);
    allEvents.push(...events);
  }
  return allEvents;
}

function impliedProbability(decimalOdds) {
  return decimalOdds ? 1 / decimalOdds : null;
}

function removeVig(p1Implied, p2Implied) {
  const total = p1Implied + p2Implied;
  return { p1Fair: p1Implied / total, p2Fair: p2Implied / total };
}

function bestOdds(event) {
  let bestP1 = { price: 0, bookmaker: null };
  let bestP2 = { price: 0, bookmaker: null };
  for (const bm of event.bookmakers || []) {
    const h2h = bm.markets?.find(m => m.key === 'h2h');
    if (!h2h) continue;
    const p1Outcome = h2h.outcomes.find(o => normalizeName(o.name) === normalizeName(event.home_team));
    const p2Outcome = h2h.outcomes.find(o => normalizeName(o.name) === normalizeName(event.away_team));
    if (p1Outcome && p1Outcome.price > bestP1.price) bestP1 = { price: p1Outcome.price, bookmaker: bm.title };
    if (p2Outcome && p2Outcome.price > bestP2.price) bestP2 = { price: p2Outcome.price, bookmaker: bm.title };
  }
  return { bestP1, bestP2 };
}

function pinnacleOrFirst(event) {
  return event.bookmakers?.find(b => b.key === 'pinnacle') || event.bookmakers?.[0];
}

function normalizeName(name) {
  return (name || '').toLowerCase().replace(/[^a-z]/g, '');
}

// Last-name matching between Odds API ("Alex de Minaur") and
// API-Tennis ("A. De Minaur") formats — CONFIRMED working against
// real data from both APIs for the same real match.
function lastName(name) {
  return (name || '').trim().split(/\s+/).pop().toLowerCase();
}

function surfaceFromEvent(event) {
  const s = (event.sport_title || '').toLowerCase();
  if (s.includes('wimbledon')) return 'grass';
  if (s.includes('roland garros') || s.includes('french open')) return 'clay';
  return 'hard';
}

function computeDay(commenceTime) {
  const matchDate = new Date(commenceTime);
  const now = new Date();
  const dayMs = 86400000;
  const dateStr = d => d.toISOString().split('T')[0];
  const matchDay = dateStr(matchDate);

  const twoDaysAgo = dateStr(new Date(now.getTime() - 2 * dayMs));
  const yesterday = dateStr(new Date(now.getTime() - dayMs));
  const today = dateStr(now);
  const tomorrow = dateStr(new Date(now.getTime() + dayMs));
  const dayAfterTomorrow = dateStr(new Date(now.getTime() + 2 * dayMs));

  if (matchDay === twoDaysAgo) return 'daymin2';
  if (matchDay === yesterday) return 'yesterday';
  if (matchDay === today) return matchDate < now ? 'past' : 'today';
  if (matchDay === tomorrow) return 'tomorrow';
  if (matchDay === dayAfterTomorrow) return 'day2';
  if (matchDate < now) return 'past'; // older than 2 days ago
  return 'later'; // further out than day2 — visible only under "All days"
}

// =================================================================
// API-TENNIS.COM — fixtures (for player keys), H2H, career stats
// All three endpoints below CONFIRMED working against real trial-key data.
// =================================================================
async function fetchApiTennisFixtures(dateStartStr, dateStopStr) {
  const url = `${API_TENNIS_BASE}?method=get_fixtures&APIkey=${API_TENNIS_KEY}&date_start=${dateStartStr}&date_stop=${dateStopStr}&event_type_key=265`; // 265 = Atp Singles
  const res = await fetch(url);
  const data = await res.json();
  if (!data.success) return [];
  return Array.isArray(data.result) ? data.result : [];
}

// get_H2H is confirmed live to sometimes OMIT real completed matches that
// DO exist in the underlying fixtures database — e.g. the 2022 Wimbledon QF
// and 2023 Wimbledon SF between Sinner/Djokovic, and separately the 2019
// Basel and 2021 Wimbledon meetings between Fritz/Zverev, are all absent
// from get_H2H's response but present via get_fixtures?player_key=<key>,
// fully scored with a real winner. This backfills those gaps: get_fixtures
// accepts a player_key param that returns one player's full match list
// across a date range in a single request (confirmed live: 185 real Sinner
// matches for 2021-2023, 425 real Fritz matches for 2015-2026, each in one
// call), so we scope it to firstPlayerKey and filter locally for matches
// against secondPlayerKey — one extra request per H2H lookup, not a
// monthly ATP-wide scan.
//
// Date range: intentionally NOT limited to PROFILE_YEARS_BACK (that window
// is specific to the tournament-profile builder's own reliability cutoff).
// Confirmed live that get_fixtures has real, correctly-classified matches
// older than that window (2019 Basel), so the backfill queries as far back
// as 2000 — before any active player's pro career — to avoid silently
// missing older real meetings for any pair the pipeline processes.
async function fetchH2HSupplement(firstPlayerKey, secondPlayerKey) {
  const start = '2000-01-01';
  const stop = new Date().toISOString().split('T')[0];
  const url = `${API_TENNIS_BASE}?method=get_fixtures&APIkey=${API_TENNIS_KEY}&date_start=${start}&date_stop=${stop}&event_type_key=265&player_key=${firstPlayerKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.success) return [];
  return (Array.isArray(data.result) ? data.result : []).filter(f =>
    (String(f.first_player_key) === String(secondPlayerKey) || String(f.second_player_key) === String(secondPlayerKey)) &&
    (f.event_winner === 'First Player' || f.event_winner === 'Second Player') &&
    // Team events (Laver Cup, United Cup, ATP Cup) come back with
    // event_qualification: null rather than 'False' in this API — confirmed
    // live on 2022 ATP Cup / 2023 United Cup / Laver Cup fixtures — so only
    // exclude actual qualifying-round matches ('True'), don't require an
    // exact 'False' match.
    f.event_qualification !== 'True'
  );
}

async function fetchH2H(firstPlayerKey, secondPlayerKey) {
  const url = `${API_TENNIS_BASE}?method=get_H2H&APIkey=${API_TENNIS_KEY}&first_player_key=${firstPlayerKey}&second_player_key=${secondPlayerKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.success) return null;
  // get_H2H returns `result` as an object { H2H, firstPlayerResults, ... }, but
  // can hand back a non-object (or omit it) on a no-data/error response; treat
  // anything that isn't a plain object as empty so the accesses below can't throw.
  const result = (data.result && typeof data.result === 'object' && !Array.isArray(data.result))
    ? data.result : {};
  // Exclude pure exhibitions (e.g. Six Kings Slam, tagged "Exhibition Men" by
  // this API) — confirmed live these are NOT part of official ATP head-to-head
  // records. Laver Cup / United Cup matches are correctly tagged "Atp Singles"
  // by this API and DO count toward official H2H (confirmed), so they're kept.
  // Same event_type_type === 'Atp Singles' check used to scope official
  // head-to-head records — applied here for consistency.
  const officialH2H = (Array.isArray(result.H2H) ? result.H2H : []).filter(m => m.event_type_type === 'Atp Singles');

  // Backfill matches get_H2H omitted but the fixtures database actually has,
  // deduped by event_key so nothing already present gets double-counted.
  const seenKeys = new Set(officialH2H.map(m => m.event_key));
  const supplement = await fetchH2HSupplement(firstPlayerKey, secondPlayerKey);
  for (const m of supplement) {
    if (!seenKeys.has(m.event_key) && m.event_type_type === 'Atp Singles') {
      officialH2H.push(m);
      seenKeys.add(m.event_key);
    }
  }

  return {
    headToHead: officialH2H,
    p1RecentResults: result.firstPlayerResults,
    p2RecentResults: result.secondPlayerResults,
  };
}

function summarizeH2H(h2hMatches, player1Name) {
  let p1Wins = 0, p2Wins = 0;
  for (const m of h2hMatches || []) {
    const p1WasFirst = lastName(m.event_first_player) === lastName(player1Name);
    const winnerIsFirst = m.event_winner === 'First Player';
    const p1Won = p1WasFirst ? winnerIsFirst : !winnerIsFirst;
    if (p1Won) p1Wins++; else p2Wins++;
  }
  return { p1Wins, p2Wins, record: `${p1Wins}-${p2Wins}` };
}

// Full past-meeting list from get_H2H's raw H2H array — same last-name
// comparison technique as summarizeH2H() above, so a match's winner here can
// never disagree with the overall record. get_H2H doesn't return a surface
// field directly (confirmed live) — surface is derived from tournament_key
// via the same surfaceMap already used elsewhere in the pipeline (e.g.
// seasonRowFromFixtures), not a new lookup.
function buildH2HMatchList(h2hMatches, player1Name, surfaceMap) {
  return (h2hMatches || [])
    .map(m => {
      const p1WasFirst = lastName(m.event_first_player) === lastName(player1Name);
      const winnerIsFirst = m.event_winner === 'First Player';
      const p1Won = p1WasFirst ? winnerIsFirst : !winnerIsFirst;
      // event_final_result is always "player1 sets - player2 sets" in RAW
      // fixture order, NOT self-first — same reordering already applied in
      // recentFormFromFixtures/loadTournamentProfiles for the same raw quirk.
      let result = m.event_final_result;
      if (!p1WasFirst && result && result.includes('-')) {
        const parts = result.split('-').map(s => s.trim());
        if (parts.length === 2) result = `${parts[1]} - ${parts[0]}`;
      }
      return {
        date: m.event_date,
        tournament: m.tournament_name,
        round: m.tournament_round || null,
        surface: surfaceMap.get(String(m.tournament_key)) || null,
        p1Won,
        result,
        // The row's identity, and the only way it can reach its own
        // setstats/{ek}.json and pbp/{ek}.json shards — without it an H2H row is
        // text with nothing to join to.
        eventKey: m.event_key,
      };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

// Year-by-year record at THIS specific tournament, for ONE player.
//
// Deliberately NOT sourced from loadTournamentProfiles()'s allEditionMatches
// — that whole-tour month-by-month scan is capped at PROFILE_YEARS_BACK
// because it has to see every player's matches per edition to work out the
// champion/draw size. A single player's OWN record doesn't need that: same
// player_key + wide-date-range pattern already proven for the H2H backfill
// (fetchH2HSupplement) returns one player's entire fixture history in a
// single call regardless of how far back it goes (confirmed live: 425 real
// Fritz fixtures spanning 2015-2026 in one call) — no cost reason to cap
// this the way the whole-tour scan has to be. CONFIRMED GAP: qualifying-round
// matches are excluded (`event_qualification === 'True'`), so a separate
// qualifying-round record can't be derived from this data.
function roundLabel(round) {
  if (!round) return null;
  const parts = round.split(' - ');
  return parts.length > 1 ? parts[parts.length - 1].trim() : round.trim();
}
async function fetchPlayerTournamentMatches(playerKey, hintKey) {
  const stop = new Date().toISOString().split('T')[0];
  const url = `${API_TENNIS_BASE}?method=get_fixtures&APIkey=${API_TENNIS_KEY}&date_start=2000-01-01&date_stop=${stop}&event_type_key=265&player_key=${playerKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.success) return [];
  return (Array.isArray(data.result) ? data.result : [])
    .filter(f =>
      f.tournament_name && f.tournament_name.includes(hintKey) &&
      f.tournament_round && f.event_qualification !== 'True' &&
      (f.event_winner === 'First Player' || f.event_winner === 'Second Player')
    )
    .map(trimFixture);
}
function buildTournamentHistory(matches, playerKey) {
  if (!matches || matches.length === 0) return null;
  const bySeason = {};
  for (const m of matches) {
    const season = m.season || m.date.slice(0, 4);
    if (!bySeason[season]) bySeason[season] = [];
    bySeason[season].push(m);
  }
  const years = [];
  let longMatches = 0; // matches that went over 3.5 total sets (4 or 5)
  let scoredMatches = 0; // matches where the set score could actually be parsed
  for (const [season, seasonMatches] of Object.entries(bySeason)) {
    let won = 0, lost = 0;
    for (const m of seasonMatches) {
      const isP1 = String(m.p1Key) === String(playerKey);
      const didWin = (m.winner === 'First Player' && isP1) || (m.winner === 'Second Player' && !isP1);
      if (didWin) won++; else lost++;
    }
    const latest = seasonMatches.reduce((a, b) => (b.date > a.date ? b : a));
    // Per-match detail (opponent, round, self-first score, win/loss) for this
    // edition — same self-first score reordering already used in
    // buildH2HMatchList (event_final_result is always "player1 sets -
    // player2 sets" in raw fixture order, not self-first).
    const matchList = seasonMatches
      .map(m => {
        const isP1 = String(m.p1Key) === String(playerKey);
        const opponent = isP1 ? m.p2 : m.p1;
        const won2 = (m.winner === 'First Player' && isP1) || (m.winner === 'Second Player' && !isP1);
        let result = m.result;
        if (!isP1 && result && result.includes('-')) {
          const parts = result.split('-').map(s => s.trim());
          if (parts.length === 2) result = `${parts[1]} - ${parts[0]}`;
        }
        // "Over 3.5 sets" = the match went 4 or 5 sets (i.e. wasn't decided
        // in straight sets) — parsed straight from the same self-first
        // result string, no separate API field needed.
        if (result && result.includes('-')) {
          const nums = result.split('-').map(s => parseInt(s.trim(), 10));
          if (nums.length === 2 && !nums.some(Number.isNaN)) {
            scoredMatches++;
            if (nums[0] + nums[1] > 3.5) longMatches++;
          }
        }
        return { date: m.date, opponent, round: roundLabel(m.round), won: won2, result, eventKey: m.eventKey || null };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    years.push({ year: season, matchCount: seasonMatches.length, won, lost, roundReached: roundLabel(latest.round), matches: matchList });
  }
  if (years.length === 0) return null;

  // Fill in any year strictly between the player's earliest and latest
  // edition on file where they have zero matches — e.g. Zverev skipping
  // Wimbledon 2022 while playing 2021/2023-2026. Shown as an explicit 0-0
  // "Withdrawal" row instead of silently disappearing from the list. Only
  // fills gaps INSIDE the player's own known span at this tournament — never
  // guesses at editions outside the years we actually have data for.
  const presentYears = new Set(years.map(y => parseInt(y.year, 10)));
  const minYear = Math.min(...presentYears);
  const maxYear = Math.max(...presentYears);
  for (let y = minYear + 1; y < maxYear; y++) {
    if (!presentYears.has(y)) {
      years.push({ year: String(y), matchCount: 0, won: 0, lost: 0, roundReached: 'Withdrawal', matches: [], withdrew: true });
    }
  }
  years.sort((a, b) => parseInt(b.year, 10) - parseInt(a.year, 10));
  return {
    editionsPlayed: years.filter(y => !y.withdrew).length,
    totalWon: years.reduce((s, y) => s + y.won, 0),
    totalLost: years.reduce((s, y) => s + y.lost, 0),
    longMatches,
    longMatchesPlayed: scoredMatches,
    longMatchPct: scoredMatches > 0 ? Math.round((longMatches / scoredMatches) * 100) : 0,
    years,
  };
}

// Recent form: filters get_H2H's recentResults field (reuses the H2H call —
// no extra request needed) down to real main-tour matches, resolves self vs.
// opponent by player KEY (not name/position — confirmed live that position
// varies entry to entry), normalizes the score to self-first order, and
// derives the surface from the same TOURNAMENT_VENUE_HINTS lookup already
// used for tournament profiles. The win % and the returned match list are
// computed from the exact same filtered array, so they can never visually
// contradict each other in the UI.
//
// CONFIRMED live against the real API: get_H2H returns at most 10 entries
// per player (not 20 — that's a competitor's own model window, not a real
// limit of this data source), and raw entries mix in Exhibition/Challenger/
// ITF/qualifying matches alongside real ATP Singles results — filtered out
// below to keep "recent form" meaning real tour-level form.
async function fetchPlayerStats(playerKey) {
  const url = `${API_TENNIS_BASE}?method=get_players&APIkey=${API_TENNIS_KEY}&player_key=${playerKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.success) return null;
  return data.result?.[0] || null;
}

// CONFIRMED FIX: `stats` mixes singles/doubles/mixed_doubles together,
// and some seasons have "" instead of a number — both handled here.
function surfaceWinRate(playerStats, surface) {
  const wonKey = `${surface}_won`;
  const lostKey = `${surface}_lost`;
  let won = 0, lost = 0;
  for (const season of playerStats?.stats || []) {
    if (season.type !== 'singles') continue;
    won += parseInt(season[wonKey], 10) || 0;
    lost += parseInt(season[lostKey], 10) || 0;
  }
  const total = won + lost;
  return total > 0 ? Math.round((won / total) * 1000) / 10 : null;
}

function currentSinglesRank(playerStats) {
  const singlesSeasons = (playerStats?.stats || [])
    .filter(s => s.type === 'singles' && s.season && s.rank)
    .sort((a, b) => parseInt(b.season, 10) - parseInt(a.season, 10));
  return singlesSeasons[0]?.rank || null;
}

// Year-by-year singles record, most recent season first. Same singles-only
// filter as surfaceWinRate(), but unlike that function this one does NOT
// coalesce "" to 0 — a blank surface value means the player didn't play
// that surface that year, which is a different fact than 0 wins/0 losses,
// so it's preserved as `null` and the UI shows "—" instead of a false 0/0.
function wonLostOrNull(season, wonKey, lostKey) {
  const wonRaw = season[wonKey];
  const lostRaw = season[lostKey];
  const hasData = wonRaw !== '' && wonRaw !== undefined && wonRaw !== null
    && lostRaw !== '' && lostRaw !== undefined && lostRaw !== null;
  if (!hasData) return null;
  return { won: parseInt(wonRaw, 10) || 0, lost: parseInt(lostRaw, 10) || 0 };
}

// Earliest season shown in the year-by-year table. Capped so every player's
// column covers the same range (some players have 20+ years of data, others
// far less — an uncapped table would be long and uneven side by side).
const YEARLY_BREAKDOWN_MIN_SEASON = 2015;

// CONFIRMED GAP: get_players' per-season `stats` aggregate lags for the
// current year — sometimes missing entirely (Djokovic has no 2026 row at
// all), sometimes present but incomplete (Auger-Aliassime shows 1/1 for
// 2026 despite having played far more real matches, per get_fixtures).
// The current season is therefore excluded here and computed separately,
// live, from real match results (see seasonRowFromFixtures below) — every
// other season still comes from this aggregate, which is stable/complete.
function yearlyBreakdown(playerStats) {
  const currentYear = new Date().getFullYear();
  return (playerStats?.stats || [])
    .filter(s => s.type === 'singles' && s.season
      && parseInt(s.season, 10) >= YEARLY_BREAKDOWN_MIN_SEASON
      && parseInt(s.season, 10) !== currentYear)
    .map(season => ({
      year: season.season,
      clay: wonLostOrNull(season, 'clay_won', 'clay_lost'),
      hard: wonLostOrNull(season, 'hard_won', 'hard_lost'),
      grass: wonLostOrNull(season, 'grass_won', 'grass_lost'),
      // Total is API-Tennis's own season total (matches_won/matches_lost),
      // not a sum of the 3 tracked surfaces — some seasons include carpet
      // or other surfaces not broken out individually above.
      total: wonLostOrNull(season, 'matches_won', 'matches_lost'),
    }))
    .sort((a, b) => parseInt(b.year, 10) - parseInt(a.year, 10));
}

// Year-by-year record across ALL tiers (ATP + Challenger + ITF), tallied from the
// broad recent-form fixtures (which span currentYear-5..now). Seasons older than
// that window fall back to the provider's ATP-only aggregates (yearlyBreakdown),
// flagged allTier:false so the UI can mark them. Newest-first; fully-empty years
// dropped; a surface cell is null when the player had no match on it that year
// (mirrors the provider-aggregate shape so the table renders identically).
function buildAllTierYearly(fixtures, playerKey, playerStats, currentYear, surfaceMap) {
  const cutoff = currentYear - 5;
  const isSingles = f => /singles/i.test(f.event_type_type || '') && !/doubles/i.test(f.event_type_type || '');
  const tierOf = f => /atp/i.test(f.event_type_type || '') ? 'atp' : 'chitf';
  const blank = () => ({ won: 0, lost: 0 });
  const blankTier = () => ({ total: blank(), clay: blank(), hard: blank(), grass: blank() });
  const byYear = {}; // year -> { atp: {...}, chitf: {...} }
  for (const f of (fixtures || [])) {
    if (!isSingles(f)) continue;
    if (!['Finished', 'Retired', 'Walk Over'].includes(f.event_status)) continue;
    if (f.event_qualification !== 'False') continue;
    if (!f.event_winner) continue;
    const isFirst = String(f.first_player_key) === String(playerKey);
    const isSecond = String(f.second_player_key) === String(playerKey);
    if (!isFirst && !isSecond) continue;
    const year = String(f.event_date || '').slice(0, 4);
    if (!/^\d{4}$/.test(year) || parseInt(year, 10) < cutoff) continue;
    const won = (f.event_winner === 'First Player' && isFirst) || (f.event_winner === 'Second Player' && isSecond);
    if (!byYear[year]) byYear[year] = { atp: blankTier(), chitf: blankTier() };
    const bucket = byYear[year][tierOf(f)];
    bucket.total[won ? 'won' : 'lost']++;
    const surface = surfaceMap.get(String(f.tournament_key));
    if (surface && bucket[surface]) bucket[surface][won ? 'won' : 'lost']++;
  }
  const nn = b => (b.won + b.lost > 0 ? b : null);
  const sum = (a, b) => ((a || b) ? { won: (a ? a.won : 0) + (b ? b.won : 0), lost: (a ? a.lost : 0) + (b ? b.lost : 0) } : null);
  const tierObj = t => ({ total: nn(t.total), clay: nn(t.clay), hard: nn(t.hard), grass: nn(t.grass) });
  const hasAny = t => t.total || t.clay || t.hard || t.grass;
  // 2021+ rows carry per-tier (atp / chitf) splits AND a combined all-tier view
  // (total/clay/hard/grass) so the default "All" render is unchanged.
  const allTierRows = Object.entries(byYear).map(([year, tiers]) => {
    const atp = tierObj(tiers.atp), chitf = tierObj(tiers.chitf);
    return {
      year, allTier: true,
      total: sum(atp.total, chitf.total), clay: sum(atp.clay, chitf.clay), hard: sum(atp.hard, chitf.hard), grass: sum(atp.grass, chitf.grass),
      atp: hasAny(atp) ? atp : null, chitf: hasAny(chitf) ? chitf : null,
    };
  });
  // Pre-window rows: ATP-only provider aggregates (no all-tier data that far back).
  const preRows = yearlyBreakdown(playerStats)
    .filter(r => parseInt(r.year, 10) < cutoff)
    .map(r => ({
      year: r.year, allTier: false,
      total: r.total, clay: r.clay, hard: r.hard, grass: r.grass,
      atp: { total: r.total, clay: r.clay, hard: r.hard, grass: r.grass }, chitf: null,
    }));
  return [...allTierRows, ...preRows]
    .filter(r => r.total || r.clay || r.hard || r.grass)
    .sort((a, b) => parseInt(b.year, 10) - parseInt(a.year, 10));
}

// Flat all-tier match list (currentYear-5..now) for the Overview year-table
// drill-down: click a year+surface number -> see those matches (tournament,
// date, opponent, score). Powers the lazily-loaded player-histories.json side
// file. Newest-first. Rows are the row-level twin of buildAllTierYearly's counts
// over the same fixtures — the two MUST stay tallyable against each other, which
// is why an unknown-surface row is kept rather than dropped (see below).
// No matchStats — kept lean so the side file stays small.
function playerMatchHistory(fixtures, playerKey, currentYear, surfaceMap) {
  const cutoff = currentYear - 5;
  const isSingles = f => /singles/i.test(f.event_type_type || '') && !/doubles/i.test(f.event_type_type || '');
  const out = [];
  for (const f of (fixtures || [])) {
    if (!isSingles(f)) continue;
    if (!['Finished', 'Retired', 'Walk Over'].includes(f.event_status)) continue;
    if (f.event_qualification !== 'False') continue;
    if (!f.event_winner) continue;
    const isFirst = String(f.first_player_key) === String(playerKey);
    const isSecond = String(f.second_player_key) === String(playerKey);
    if (!isFirst && !isSecond) continue;
    const year = String(f.event_date || '').slice(0, 4);
    if (!/^\d{4}$/.test(year) || parseInt(year, 10) < cutoff) continue;
    // Surface may be unknown (a tournament missing from get_tournaments, or a
    // carpet/other event). Such a row is KEPT with surface:null: buildAllTierYearly
    // counts it in the year's Total, so dropping it here would make the row list
    // shorter than the Total the user clicked — the exact mismatch this pair of
    // builders exists to avoid. The surface-scoped drills filter it out anyway.
    const rawSurface = surfaceMap.get(String(f.tournament_key));
    const surface = ['clay', 'hard', 'grass'].includes(rawSurface) ? rawSurface : null;
    const won = (f.event_winner === 'First Player' && isFirst) || (f.event_winner === 'Second Player' && isSecond);
    const opponent = isFirst ? f.event_second_player : f.event_first_player;
    let result = f.event_final_result;
    if (isSecond && result && result.includes('-')) {
      const p = result.split('-').map(s => s.trim());
      if (p.length === 2) result = `${p[1]} - ${p[0]}`;
    }
    let round = f.tournament_round || '';
    if (round.includes(' - ')) round = round.split(' - ').pop().trim();
    const level = /atp/i.test(f.event_type_type || '') ? 'atp' : 'chitf';
    // eventKey is the row's identity: without it a drill-down row is a string of
    // text with nothing to join to, so the per-match shards (setstats/{ek}.json,
    // pbp/{ek}.json) are unreachable from here no matter how many exist. The
    // "kept lean" note above predates sharding — the cost is ~13 bytes on a row
    // in a lazily-loaded side file, against the alternative of fuzzy-matching a
    // date, a tournament name and an abbreviated opponent back to a fixture.
    // A retirement or a walkover leaves a score that contradicts the W/L badge:
    // the score column is sets-won-at-the-moment-play-stopped, so the player who
    // is ahead (or level, or on 0-0) can still be the loser, and a walkover has
    // no score at all. Carrying the feed's own verdict lets the drill-down say
    // `ret.`/`w/o` instead of rendering what reads as a wrong result.
    const retired = f.event_status === 'Retired';
    const walkover = f.event_status === 'Walk Over';
    out.push({ year, surface, level, date: f.event_date, tournament: f.tournament_name, round, opponent, result, won, eventKey: f.event_key, src: 'fixtures', ...(retired ? { retired: true } : {}), ...(walkover ? { walkover: true } : {}) });
  }
  out.sort((a, b) => new Date(b.date) - new Date(a.date));
  return out;
}

// =================================================================
// TOURNAMENT SURFACE LOOKUP + LIVE CURRENT-SEASON COMPUTATION
// get_tournaments returns a `tournament_sourface` field per tournament_key,
// which get_fixtures results reference — this lets us tally the current
// season's real win/loss record per surface directly from match results,
// instead of relying on get_players' lagging aggregate. Cached locally
// since the tournament list (~10k entries) is large and rarely changes.
// =================================================================
const TOURNAMENT_SURFACE_CACHE_PATH = 'tournament-surfaces.json';
const TOURNAMENT_SURFACE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function normalizeSurface(raw) {
  const s = (raw || '').toLowerCase();
  if (s.includes('clay')) return 'clay';
  if (s.includes('grass')) return 'grass';
  if (s.includes('hard')) return 'hard';
  return null; // covers "", null, and non-surface values like "- Qualification"
}

// A few tournaments carry the wrong surface in API-Tennis's metadata. Verified
// against the real draws and corrected here so surface tallies/records are right.
// Keyed by exact lowercase name, optionally scoped by tour (event_type_type).
const SURFACE_CORRECTIONS = [
  // Mallorca Championships (ATP 250, the week before Wimbledon) is GRASS; the
  // API reports it as clay on the ATP singles/doubles entries.
  { name: 'mallorca', tour: 'atp', surface: 'grass' },
];
function correctTournamentSurface(t) {
  const name = String(t.tournament_name || '').trim().toLowerCase();
  const type = String(t.event_type_type || '').toLowerCase();
  for (const c of SURFACE_CORRECTIONS) {
    if (name === c.name && (!c.tour || type.startsWith(c.tour))) return c.surface;
  }
  return normalizeSurface(t.tournament_sourface);
}

async function fetchAllTournaments() {
  const url = `${API_TENNIS_BASE}?method=get_tournaments&APIkey=${API_TENNIS_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.success) return [];
  return Array.isArray(data.result) ? data.result : [];
}

async function loadTournamentSurfaceMap() {
  if (fs.existsSync(TOURNAMENT_SURFACE_CACHE_PATH)) {
    const cache = JSON.parse(fs.readFileSync(TOURNAMENT_SURFACE_CACHE_PATH, 'utf8'));
    if (Date.now() - new Date(cache.fetchedAt).getTime() < TOURNAMENT_SURFACE_CACHE_MAX_AGE_MS) {
      return new Map(Object.entries(cache.surfaces));
    }
  }
  console.log('Refreshing tournament surface lookup from API-Tennis...');
  const tournaments = await fetchAllTournaments();
  const surfaces = {};
  for (const t of tournaments) {
    surfaces[t.tournament_key] = correctTournamentSurface(t);
  }
  fs.writeFileSync(TOURNAMENT_SURFACE_CACHE_PATH, JSON.stringify({ fetchedAt: new Date().toISOString(), surfaces }, null, 2));
  return new Map(Object.entries(surfaces));
}

async function fetchPlayerFixturesForYear(playerKey, year) {
  const todayStr = new Date().toISOString().split('T')[0];
  const dateStop = year === new Date().getFullYear() ? todayStr : `${year}-12-31`;
  const url = `${API_TENNIS_BASE}?method=get_fixtures&APIkey=${API_TENNIS_KEY}&date_start=${year}-01-01&date_stop=${dateStop}&player_key=${playerKey}&event_type_key=265`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.success) return [];
  // API returns success with no `result` field for a player who has no
  // fixtures in the range (confirmed live for a player's prior-year window).
  // Callers spread this directly, so always hand back an array.
  return Array.isArray(data.result) ? data.result : [];
}

// Current-season per-surface record split by tier (ATP vs Challenger & ITF),
// retaining every contributing match so the Overview record can be expanded on
// click. Singles, main-draw, decided matches in the given season only — mirrors
// seasonRowFromFixtures but keeps the match list and separates tiers via
// event_type_type. Fed the same all-tier fixtures already fetched for recent
// form (fetchRecentSinglesFixtures — memoized, so no extra API calls), filtered
// to `year`. Each surface bucket: { won, lost, matches:[{opponent, result,
// tournament, date, won}] }.
function seasonSurfaceByTier(fixtures, playerKey, year, surfaceMap) {
  const isSingles = f => /singles/i.test(f.event_type_type || '') && !/doubles/i.test(f.event_type_type || '');
  const tierOf = f => /atp/i.test(f.event_type_type || '') ? 'atp' : 'chitf';
  const blank = () => ({ clay: { won: 0, lost: 0, matches: [] }, hard: { won: 0, lost: 0, matches: [] }, grass: { won: 0, lost: 0, matches: [] } });
  const out = { atp: blank(), chitf: blank() };
  for (const f of (fixtures || [])) {
    if (!isSingles(f)) continue;
    if (String(f.event_date || '').slice(0, 4) !== String(year)) continue;
    if (!['Finished', 'Retired', 'Walk Over'].includes(f.event_status)) continue;
    if (f.event_qualification !== 'False') continue;
    if (!f.event_winner) continue;
    const isFirst = String(f.first_player_key) === String(playerKey);
    const isSecond = String(f.second_player_key) === String(playerKey);
    if (!isFirst && !isSecond) continue;
    const surface = surfaceMap.get(String(f.tournament_key));
    if (!surface || !['clay', 'hard', 'grass'].includes(surface)) continue;
    const won = (f.event_winner === 'First Player' && isFirst) || (f.event_winner === 'Second Player' && isSecond);
    const opponent = isFirst ? f.event_second_player : f.event_first_player;
    let result = f.event_final_result;
    if (isSecond && result && result.includes('-')) {
      const parts = result.split('-').map(s => s.trim());
      if (parts.length === 2) result = `${parts[1]} - ${parts[0]}`;
    }
    const bucket = out[tierOf(f)][surface];
    bucket[won ? 'won' : 'lost']++;
    bucket.matches.push({ opponent, result, tournament: f.tournament_name, date: f.event_date, won });
  }
  for (const tier of ['atp', 'chitf']) {
    for (const s of ['clay', 'hard', 'grass']) {
      out[tier][s].matches.sort((a, b) => new Date(b.date) - new Date(a.date));
    }
  }
  return out;
}

// Recent-form fixtures — deliberately BROADER than the ATP-only aggregates
// above. "Recent form" is meant to reflect a player's actual last-N completed
// singles matches across ALL tours (ATP + Challenger + ITF), because lower-
// ranked players play mostly Challenger/ITF events that event_type_key=265
// would hide entirely (leaving them with 0 recent matches). So we drop the
// type filter and pull a wide multi-year window in ONE get_fixtures call, then
// filter to singles client-side (recentFormFromFixtures). Used ONLY for
// recentForm — every other stat on the profile stays strictly ATP-tour-level.
// Memoized per run: the same player often appears in more than one match AND
// also gets a full profile built, and finished fixtures don't change mid-run,
// so each player's wide fixtures window is fetched from the API at most once.
const _recentSinglesFixturesCache = new Map();
async function fetchRecentSinglesFixtures(playerKey) {
  const cacheKey = String(playerKey);
  if (_recentSinglesFixturesCache.has(cacheKey)) return _recentSinglesFixturesCache.get(cacheKey);
  const stop = new Date().toISOString().split('T')[0];
  const start = `${new Date().getFullYear() - 5}-01-01`; // 5-yr window: plenty for a last-10 even for inactive players
  const url = `${API_TENNIS_BASE}?method=get_fixtures&APIkey=${API_TENNIS_KEY}&date_start=${start}&date_stop=${stop}&player_key=${playerKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.success) return []; // transient failure: don't cache, so a later call can retry
  const result = Array.isArray(data.result) ? data.result : [];
  _recentSinglesFixturesCache.set(cacheKey, result);
  return result;
}

// Builds one season's { total, clay, hard, grass } row straight from real,
// decided match results — ground truth, not an aggregate that can lag.
function seasonRowFromFixtures(fixtures, playerKey, year, surfaceMap) {
  const tally = {
    total: { won: 0, lost: 0 },
    clay: { won: 0, lost: 0 },
    hard: { won: 0, lost: 0 },
    grass: { won: 0, lost: 0 },
  };
  let decidedCount = 0;
  for (const f of fixtures) {
    if (!['Finished', 'Retired', 'Walk Over'].includes(f.event_status)) continue;
    if (!f.event_winner) continue;
    const isFirst = String(f.first_player_key) === String(playerKey);
    const isSecond = String(f.second_player_key) === String(playerKey);
    if (!isFirst && !isSecond) continue;
    const won = (f.event_winner === 'First Player' && isFirst) || (f.event_winner === 'Second Player' && isSecond);
    decidedCount++;
    tally.total[won ? 'won' : 'lost']++;
    const surface = surfaceMap.get(String(f.tournament_key));
    if (surface) tally[surface][won ? 'won' : 'lost']++;
  }
  if (decidedCount === 0) return null;
  const nullIfEmpty = b => (b.won + b.lost > 0 ? b : null);
  return {
    year: String(year),
    total: tally.total,
    clay: nullIfEmpty(tally.clay),
    hard: nullIfEmpty(tally.hard),
    grass: nullIfEmpty(tally.grass),
  };
}

// =================================================================
// EXTRA STATS — real per-match serve/return/point stats, straight from
// get_fixtures' inline `statistics` array (confirmed live this session:
// aces, double faults, serve %, break points saved/converted, winners,
// unforced errors, etc. — no extra per-match API call needed).
//
// SCOPE, confirmed honestly rather than fabricated:
// - "Last 52 weeks" and "This surface" are both built for real below,
//   using each player's current + previous calendar year of fixtures
//   (already fetched for the Overview tab's season row — reused here,
//   plus one extra fetch for the prior year to guarantee full 52-week
//   coverage even early in a calendar year).
// - A genuine full-"Career" aggregate is NOT built: for a veteran like
//   Djokovic (pro since 2003) that would mean ~20 more years of
//   get_fixtures calls per player, on every pipeline run, which isn't
//   practical here. "This surface" is explicitly scoped to the last two
//   seasons on file, not implied to be a career figure.
// - "Opponent style" filtering is NOT built: it depends on the playing-
//   style classification system, which is explicitly out of scope
//   (needs Michael's own methodology).
// =================================================================
// Matched case-insensitively (like MATCH_STAT_DEFS below) — the feed changed
// its casing at the 2025/2026 boundary ('1st Serve Points Won' -> '1st serve
// points won'), and a 52-week window spans both. `name` here stays the
// canonical casing: it builds the output key, so it must not follow the feed.
const EXTRA_STAT_DEFS = [
  { type: 'Service', name: 'Aces', kind: 'count' },
  { type: 'Service', name: 'Double Faults', kind: 'count' },
  { type: 'Service', name: '1st Serve Points Won', kind: 'pct' },
  { type: 'Service', name: '2nd Serve Points Won', kind: 'pct' },
  { type: 'Service', name: 'Break Points Saved', kind: 'pct' },
  { type: 'Return', name: 'Break Points Converted', kind: 'pct' },
  { type: 'Points', name: 'Winners', kind: 'count' },
  { type: 'Points', name: 'Unforced Errors', kind: 'count' },
  { type: 'Points', name: 'Service Points Won', kind: 'pct' },
  { type: 'Points', name: 'Return Points Won', kind: 'pct' },
  // Confirmed live: the feed carries 'Points'/'Total Points Won' with real
  // stat_won/stat_total per match, so this is the provider's own number —
  // never derived from the service/return percentages.
  { type: 'Points', name: 'Total Points Won', kind: 'pct' },
];

// Minimum sample a percentage needs before it is presented as a rate.
// Break Points Converted is the only stat here with a genuinely small
// denominator: a player faces a handful of break points in a match, so one
// converted chance reads "100%" and sits beside Alcaraz's honest 44% (verified
// live: 15 of 357 players read exactly 0% or 100%, e.g. A. Ritschard 100%).
// Every other percentage is drawn from dozens of points per match and cannot
// be distorted this way. The number is arithmetically true, so it is not
// dropped — it is held back from being read as a rate, and the sample is shown
// instead. Mirrored in the dashboard's PP_MIN_SAMPLE.
const MIN_STAT_SAMPLE = {
  'Return:Break Points Converted': 5,
};

// Aggregates real per-match `statistics` entries for one player across a
// set of fixtures. Percentage stats (kind: 'pct') are weighted by summing
// each match's real stat_won/stat_total (not averaging pre-rounded
// percentages, which would skew toward short matches). Count stats
// (kind: 'count') are reported as an average over the matches that actually
// carry THAT stat — the feed's coverage is per-stat, not per-match (Aces are
// on 100% of match sheets, Winners/Unforced Errors only ~66%, and the gap is
// concentrated at ATP 250s), so a single shared denominator divided by
// matches the numerator never saw and read up to 75% low for 250-level
// players while the headline names looked correct.
function aggregateStatsFromFixtures(fixtures, playerKey) {
  const totals = {};
  let matchCount = 0;
  for (const f of fixtures) {
    if (!Array.isArray(f.statistics) || f.statistics.length === 0) continue;
    const isFirst = String(f.first_player_key) === String(playerKey);
    const isSecond = String(f.second_player_key) === String(playerKey);
    if (!isFirst && !isSecond) continue;
    // One entry per stat per MATCH, not per row. A stat must contribute at
    // most once to its own denominator, and the feed cannot be trusted to
    // emit it once: verified live on Burruchaga (Costa do Sauipe 2025-10-23
    // and 2025-10-25), where `statistics` carries the real match block AND a
    // trailing fragment block for both players — a second full set of
    // match-period rows totalling 6 points against the real 99. Summing every
    // row read those fragments as extra tennis (Total Points Won became 60/105
    // instead of 58/99), and counting every row would inflate the denominator
    // past the number of matches played. First block wins: it is the real
    // match, the fragment trails it.
    const seen = new Map();
    for (const stat of f.statistics) {
      // Match-level rows only. The feed emits the same stat names again under
      // stat_period 'set1', 'set2', ... and the per-set counts reconcile exactly
      // to the match total, so counting every row doubled every count stat
      // (verified live: aces match:16 + set1:4 + set2:6 + set3:6 = 32).
      if (stat.stat_period !== 'match') continue;
      if (String(stat.player_key) !== String(playerKey)) continue;
      const def = EXTRA_STAT_DEFS.find(d =>
        d.type === stat.stat_type &&
        d.name.toLowerCase() === String(stat.stat_name).toLowerCase());
      if (!def) continue;
      const key = `${def.type}:${def.name}`;
      if (seen.has(key)) continue;
      seen.set(key, stat);
    }
    if (seen.size > 0) matchCount++;
    for (const [key, stat] of seen) {
      const def = EXTRA_STAT_DEFS.find(d => `${d.type}:${d.name}` === key);
      // `n` = matches carrying THIS stat. It is the only correct denominator
      // for a count average; `matchCount` above stays the "matches on file"
      // sample size shown to the user and is deliberately not used to divide.
      if (!totals[key]) totals[key] = { won: 0, total: 0, sum: 0, n: 0, kind: def.kind };
      if (def.kind === 'pct') {
        const won = Number(stat.stat_won);
        const total = Number(stat.stat_total);
        if (!Number.isFinite(won) || !Number.isFinite(total)) continue;
        // The feed does emit impossible rows: verified live on M. H. Rehberg,
        // Geneva 2026-05-17, Break Points Saved "2/0" — 2 saved out of 0
        // faced. One such row poisons the whole window (that player read 300%
        // Break Points Saved on the live site, because won=3 summed against
        // total=1). A row claiming more won than were played is corrupt, not
        // an extreme performance, so drop it rather than let it skew a real
        // average — the remaining matches still produce an honest number.
        if (won < 0 || total < 0 || won > total) continue;
        totals[key].won += won;
        totals[key].total += total;
        totals[key].n++;
      } else {
        const value = parseInt(stat.stat_value, 10);
        if (!Number.isFinite(value)) continue;
        totals[key].sum += value;
        totals[key].n++;
      }
    }
  }
  if (matchCount === 0) return null;
  const stats = {};
  for (const [key, v] of Object.entries(totals)) {
    if (v.kind === 'pct') {
      const pct = v.total > 0 ? Math.round((v.won / v.total) * 1000) / 10 : null;
      // Corrupt rows are already dropped above, so this cannot currently fire.
      // It stays as the last line of defence: nothing else in the codebase
      // validates a percentage before it reaches a card, and an impossible
      // number should never render. Null flags it as "no data" rather than
      // clamping to a plausible-looking 100%.
      stats[key] = (pct !== null && (pct < 0 || pct > 100)) ? null : pct;
    } else {
      stats[key] = v.n > 0 ? Math.round((v.sum / v.n) * 10) / 10 : null;
    }
  }
  // Sample size behind each number, so a card can tell an honest 44% off 55
  // break points from a "100%" off one. For a percentage that is the attempts
  // actually played (break points faced); for a count average it is the number
  // of matches carrying that stat. Never inferred from matchCount — the feed's
  // coverage is per-stat, so a stat's own denominator is the only true sample.
  const samples = {};
  for (const [key, v] of Object.entries(totals)) {
    samples[key] = v.kind === 'pct' ? v.total : v.n;
  }
  return { matchCount, stats, samples };
}

// Buckets a player's real last-52-weeks fixtures by court-speed category
// (via the same COURT_CONDITIONS name-matching used for match.courtSpeed)
// and tallies win/loss at the given category — zero new API calls, reuses
// fixtures already fetched for buildExtraStats. Returns null (not a
// fabricated 0%) if the player has no decided matches in that category.
function courtSpeedRecordFromFixtures(fixtures, playerKey, category) {
  if (!category) return null;
  let wins = 0, losses = 0;
  for (const f of fixtures) {
    if (!['Finished', 'Retired', 'Walk Over'].includes(f.event_status) || !f.event_winner) continue;
    const isFirst = String(f.first_player_key) === String(playerKey);
    const isSecond = String(f.second_player_key) === String(playerKey);
    if (!isFirst && !isSecond) continue;
    const cc = courtConditionsFor(f.tournament_name);
    if (!cc || courtSpeedCategory(cc.speed) !== category) continue;
    const won = isFirst ? f.event_winner === 'First Player' : f.event_winner === 'Second Player';
    if (won) wins++; else losses++;
  }
  const sampleSize = wins + losses;
  if (sampleSize === 0) return null;
  return { wins, losses, sampleSize, pct: Math.round((wins / sampleSize) * 1000) / 10 };
}

async function buildExtraStats(p1Key, p2Key, surface, surfaceMap, p1CurrentYearFixtures, p2CurrentYearFixtures, courtSpeedCategoryForMatch) {
  const currentYear = new Date().getFullYear();
  const [p1PrevYearFixtures, p2PrevYearFixtures] = await Promise.all([
    fetchPlayerFixturesForYear(p1Key, currentYear - 1),
    fetchPlayerFixturesForYear(p2Key, currentYear - 1),
  ]);
  const p1Fixtures = [...p1CurrentYearFixtures, ...p1PrevYearFixtures];
  const p2Fixtures = [...p2CurrentYearFixtures, ...p2PrevYearFixtures];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 371); // 53 weeks, safely covers a full 52-week window
  const inLast52Weeks = f => new Date(f.event_date) >= cutoff;
  const onThisSurface = f => surfaceMap.get(String(f.tournament_key)) === surface;

  return {
    last52Weeks: {
      p1: aggregateStatsFromFixtures(p1Fixtures.filter(inLast52Weeks), p1Key),
      p2: aggregateStatsFromFixtures(p2Fixtures.filter(inLast52Weeks), p2Key),
    },
    surface: {
      p1: aggregateStatsFromFixtures(p1Fixtures.filter(onThisSurface), p1Key),
      p2: aggregateStatsFromFixtures(p2Fixtures.filter(onThisSurface), p2Key),
    },
    surfaceLabel: surface,
    courtSpeedRecord: courtSpeedCategoryForMatch ? {
      p1: courtSpeedRecordFromFixtures(p1Fixtures.filter(inLast52Weeks), p1Key, courtSpeedCategoryForMatch),
      p2: courtSpeedRecordFromFixtures(p2Fixtures.filter(inLast52Weeks), p2Key, courtSpeedCategoryForMatch),
    } : null,
  };
}

// =================================================================
// OPEN-METEO — free weather API, no key required. Verified live:
// returns real hourly forecast for the match's venue/time (sane
// temperature/wind/humidity for the current forecast window).
// LIMITATION: the default forecast endpoint only covers ~today
// forward (no historical/past data), so match.weather comes back
// null for any match more than a few hours in the past — this is
// why "record by temperature/wind" (needs weather at *past* matches)
// isn't built from this endpoint; see the dashboard's weather-splits
// note for why that data isn't available at all right now.
// LICENSE NOTE: free tier is for non-commercial use; underlying data
// is CC BY 4.0 (commercial-friendly with attribution). Check their
// commercial API tier before high-volume production use.
//
// VENUE COVERAGE — API-Tennis's tournament_name is basically a city
// name for almost every ATP event (checked live via get_tournaments:
// 198 "Atp Singles" entries, e.g. "Miami", "Rome", "Cincinnati", not
// just "Wimbledon"). So instead of hand-typing lat/lon per venue, we
// keep a curated city+country hint per known tour-level tournament
// (Slams, ATP 1000s, ATP Finals, 500s, and the ATP 250s we could
// confidently confirm are current/active) and resolve exact
// coordinates automatically via Open-Meteo's free geocoding API,
// cached to disk. Plain city-name geocoding is ambiguous on its own
// (e.g. "Wimbledon" alone resolves to a 213-person town in North
// Dakota before London) — verified live — so every hint carries a
// country code to disambiguate correctly.
// Deliberately EXCLUDED: team events / rotating-venue events (Davis
// Cup, ATP Cup, United Cup, Olympics, Asian Games, Laver Cup) and
// defunct ones (Hopman Cup, Grand Slam Cup) — there's no single fixed
// venue to assign, so guessing one would mean fabricating a location.
// Also excluded: older/historical tournament_name entries in the API
// dump I couldn't confidently confirm are still on the current tour
// (e.g. many of the smaller legacy stops) — left unmapped rather than
// guessed. This is best-effort coverage of the recognizable ATP tour
// calendar, not a claim of 100% completeness; unmapped tournaments
// safely fall back to "weather not available" rather than a guess.
// =================================================================
// `category`, `indoor`, and `surface` are curated static reference facts (not
// pulled from any API — API-Tennis has no category/venue-type field at all,
// confirmed by checking every field on every endpoint live; surface duplicates
// tournament-surfaces.json's per-tournament-key data here as a per-name fact so
// the dashboard's static tournament catalog can be built without an extra
// key lookup). These are fixed, public, verifiable facts about the tour
// calendar (they don't change season to season), same spirit as the city/
// country hints above — not a proprietary metric or a guess.
// `indoor: true` is only set for events I can confirm with confidence; every
// other hard-court event defaults to outdoor, and all clay/grass events are
// always outdoor.
const TOURNAMENT_VENUE_HINTS = {
  // Grand Slams
  'Australian Open': { city: 'Melbourne', country: 'AU', category: 'Grand Slam', indoor: false, surface: 'hard' },
  'French Open': { city: 'Paris', country: 'FR', category: 'Grand Slam', indoor: false, surface: 'clay' },
  'Roland Garros': { city: 'Paris', country: 'FR', category: 'Grand Slam', indoor: false, surface: 'clay' },
  'Wimbledon': { city: 'Wimbledon', country: 'GB', category: 'Grand Slam', indoor: false, surface: 'grass' },
  'US Open': { city: 'New York', country: 'US', category: 'Grand Slam', indoor: false, surface: 'hard' },
  // ATP 1000
  'Indian Wells': { city: 'Indian Wells', country: 'US', category: 'ATP 1000', indoor: false, surface: 'hard' },
  'Miami': { city: 'Miami', country: 'US', category: 'ATP 1000', indoor: false, surface: 'hard' },
  'Monte Carlo': { city: 'Monaco', country: 'MC', category: 'ATP 1000', indoor: false, surface: 'clay' }, // "Monte Carlo" isn't in Open-Meteo's geocoding db; "Monaco" resolves correctly
  'Madrid': { city: 'Madrid', country: 'ES', category: 'ATP 1000', indoor: false, surface: 'clay' },
  'Rome': { city: 'Rome', country: 'IT', category: 'ATP 1000', indoor: false, surface: 'clay' },
  'Montreal': { city: 'Montreal', country: 'CA', category: 'ATP 1000', indoor: false, surface: 'hard' },
  'Toronto': { city: 'Toronto', country: 'CA', category: 'ATP 1000', indoor: false, surface: 'hard' },
  'Cincinnati': { city: 'Cincinnati', country: 'US', category: 'ATP 1000', indoor: false, surface: 'hard' },
  'Shanghai': { city: 'Shanghai', country: 'CN', category: 'ATP 1000', indoor: false, surface: 'hard' },
  'Paris': { city: 'Paris', country: 'FR', category: 'ATP 1000', indoor: true, surface: 'hard' }, // Paris Masters (indoor, distinct tournament_key from French Open)
  // ATP Finals
  'Turin': { city: 'Turin', country: 'IT', category: 'ATP Finals', indoor: true, surface: 'hard' },
  // ATP 500
  'Rotterdam': { city: 'Rotterdam', country: 'NL', category: 'ATP 500', indoor: true, surface: 'hard' },
  'Dubai': { city: 'Dubai', country: 'AE', category: 'ATP 500', indoor: false, surface: 'hard' },
  'Acapulco': { city: 'Acapulco', country: 'MX', category: 'ATP 500', indoor: false, surface: 'hard' },
  'Rio de Janeiro': { city: 'Rio de Janeiro', country: 'BR', category: 'ATP 500', indoor: false, surface: 'clay' },
  'Barcelona': { city: 'Barcelona', country: 'ES', category: 'ATP 500', indoor: false, surface: 'clay' },
  'Halle': { city: 'Halle', country: 'DE', category: 'ATP 500', indoor: false, surface: 'grass' },
  'London': { city: 'London', country: 'GB', category: 'ATP 500', indoor: false, surface: 'grass' }, // Queen's Club
  'Hamburg': { city: 'Hamburg', country: 'DE', category: 'ATP 500', indoor: false, surface: 'clay' },
  'Washington': { city: 'Washington', country: 'US', category: 'ATP 500', indoor: false, surface: 'hard' },
  'Beijing': { city: 'Beijing', country: 'CN', category: 'ATP 500', indoor: false, surface: 'hard' },
  'Tokyo': { city: 'Tokyo', country: 'JP', category: 'ATP 500', indoor: false, surface: 'hard' },
  'Vienna': { city: 'Vienna', country: 'AT', category: 'ATP 500', indoor: true, surface: 'hard' },
  'Basel': { city: 'Basel', country: 'CH', category: 'ATP 500', indoor: true, surface: 'hard' },
  // ATP 250 (confirmed current/active on the tour calendar)
  'Auckland': { city: 'Auckland', country: 'NZ', category: 'ATP 250', indoor: false, surface: 'hard' },
  'Adelaide': { city: 'Adelaide', country: 'AU', category: 'ATP 250', indoor: false, surface: 'hard' },
  'Brisbane': { city: 'Brisbane', country: 'AU', category: 'ATP 250', indoor: false, surface: 'hard' },
  'Sydney': { city: 'Sydney', country: 'AU', category: 'ATP 250', indoor: false, surface: 'hard' },
  'Hong Kong': { city: 'Hong Kong', country: 'HK', category: 'ATP 250', indoor: false, surface: 'hard' },
  'Chengdu': { city: 'Chengdu', country: 'CN', category: 'ATP 250', indoor: false, surface: 'hard' },
  'Zhuhai': { city: 'Zhuhai', country: 'CN', category: 'ATP 250', indoor: false, surface: 'hard' },
  'Hangzhou': { city: 'Hangzhou', country: 'CN', category: 'ATP 250', indoor: false, surface: 'hard' },
  'Pune': { city: 'Pune', country: 'IN', category: 'ATP 250', indoor: false, surface: 'hard' },
  'Doha': { city: 'Doha', country: 'QA', category: 'ATP 250', indoor: false, surface: 'hard' },
  'Marseille': { city: 'Marseille', country: 'FR', category: 'ATP 250', indoor: true, surface: 'hard' },
  'Delray Beach': { city: 'Delray Beach', country: 'US', category: 'ATP 250', indoor: false, surface: 'hard' },
  'Dallas': { city: 'Dallas', country: 'US', category: 'ATP 250', indoor: true, surface: 'hard' },
  'Montpellier': { city: 'Montpellier', country: 'FR', category: 'ATP 250', indoor: true, surface: 'hard' },
  'Cordoba': { city: 'Cordoba', country: 'AR', category: 'ATP 250', indoor: false, surface: 'clay' },
  'Buenos Aires': { city: 'Buenos Aires', country: 'AR', category: 'ATP 250', indoor: false, surface: 'clay' },
  'Santiago': { city: 'Santiago', country: 'CL', category: 'ATP 250', indoor: false, surface: 'clay' },
  'Los Cabos': { city: 'Los Cabos', country: 'MX', category: 'ATP 250', indoor: false, surface: 'hard' },
  'Marrakech': { city: 'Marrakesh', country: 'MA', category: 'ATP 250', indoor: false, surface: 'clay' }, // Open-Meteo's geocoding db uses the "Marrakesh" spelling
  'Munich': { city: 'Munich', country: 'DE', category: 'ATP 250', indoor: false, surface: 'clay' },
  'Bucharest': { city: 'Bucharest', country: 'RO', category: 'ATP 250', indoor: false, surface: 'clay' },
  'Estoril': { city: 'Estoril', country: 'PT', category: 'ATP 250', indoor: false, surface: 'clay' },
  'Geneva': { city: 'Geneva', country: 'CH', category: 'ATP 250', indoor: false, surface: 'clay' },
  'Lyon': { city: 'Lyon', country: 'FR', category: 'ATP 250', indoor: false, surface: 'clay' },
  'Gstaad': { city: 'Gstaad', country: 'CH', category: 'ATP 250', indoor: false, surface: 'clay' },
  'Bastad': { city: 'Bastad', country: 'SE', category: 'ATP 250', indoor: false, surface: 'clay' },
  'Newport': { city: 'Newport', country: 'US', category: 'ATP 250', indoor: false, surface: 'grass' },
  'Umag': { city: 'Umag', country: 'HR', category: 'ATP 250', indoor: false, surface: 'clay' },
  'Kitzbuhel': { city: 'Kitzbuhel', country: 'AT', category: 'ATP 250', indoor: false, surface: 'clay' },
  'Winston-Salem': { city: 'Winston-Salem', country: 'US', category: 'ATP 250', indoor: false, surface: 'hard' },
  'Tel Aviv': { city: 'Tel Aviv', country: 'IL', category: 'ATP 250', indoor: false, surface: 'hard' },
  'Almaty': { city: 'Almaty', country: 'KZ', category: 'ATP 250', indoor: true, surface: 'hard' },
  'Astana': { city: 'Astana', country: 'KZ', category: 'ATP 250', indoor: true, surface: 'hard' },
  'Antwerp': { city: 'Antwerp', country: 'BE', category: 'ATP 250', indoor: true, surface: 'hard' },
  'Stockholm': { city: 'Stockholm', country: 'SE', category: 'ATP 250', indoor: true, surface: 'hard' },
  'Metz': { city: 'Metz', country: 'FR', category: 'ATP 250', indoor: true, surface: 'hard' },
  'Belgrade': { city: 'Belgrade', country: 'RS', category: 'ATP 250', indoor: false, surface: 'clay' },
  'Eastbourne': { city: 'Eastbourne', country: 'GB', category: 'ATP 250', indoor: false, surface: 'grass' },
  'Hertogenbosch': { city: 'Hertogenbosch', country: 'NL', category: 'ATP 250', indoor: false, surface: 'grass' },
  'Mallorca': { city: 'Mallorca', country: 'ES', category: 'ATP 250', indoor: false, surface: 'grass' },
  'Stuttgart': { city: 'Stuttgart', country: 'DE', category: 'ATP 250', indoor: false, surface: 'grass' },
  'Ho Chi Minh City': { city: 'Ho Chi Minh City', country: 'VN', category: 'ATP 250', indoor: false, surface: 'hard' },
  'Houston': { city: 'Houston', country: 'US', category: 'ATP 250', indoor: false, surface: 'clay' },
  'Jeddah': { city: 'Jeddah', country: 'SA', category: 'Next Gen Finals', indoor: true, surface: 'hard' },
};

// Real court-conditions data, self-compiled by the user in a Google Sheet
// ("OFFICIAL 2026 COURT CONDITIONS MODEL", tab "COURT CONDITIONS GENERAL",
// docs.google.com/spreadsheets/d/1WT9HNK7vSTbznrNBEiBz58-i44CdLj9IGOSCjyArIBQ),
// fetched 2026-07-08. Supersedes the earlier 57-entry dataset — this sheet
// has real per-tournament ALTITUDE, 3-year Abstract Speed history (AS
// 2023/2024/2025), 1ST SERVE POINTS WON %, SERVICE HOLD %, and CPI (official
// Court Pace Index, mostly Masters 1000/Slams/Finals only) columns. Matched
// by tournament name against the keys above: 64/65 real matches (1 sheet
// row, "Atlanta Open", isn't a current ATP-tour venue and was dropped, not
// guessed) — includes real, separate rows for both Toronto and Montreal this
// time (previously only Montreal had data).
//   speed: 0-100 index — NOT a sheet column this time (the sheet has no
//     direct 0-100 field). Derived by min-max normalizing each tournament's
//     most-recent-available AS value (2025→2024→2023 fallback) across all 64
//     real values (min 0.41 "Bucharest"→0, max 1.42 "Hangzhou"→100). A
//     disclosed transformation of real data, not a fabricated number.
//   altitude: meters, real.
//   abstractSpeed/abstractSpeedYear: the most-recent-available AS value and
//     which year it's actually from (so a 2023 fallback is never mislabeled
//     as current).
//   as2023/as2024/as2025: real per-year AS values (null = real gap in the
//     sheet), for the 3-year trend chart — never plot a fake value for a gap.
//   firstServeWon/serviceHold: real %s.
//   cpi/cpiYear: real official Court Pace Index and which year it's from
//     (null = not published for this venue, true for most non-Masters/Slam
//     events). 2025→2024→2023 fallback, same as abstractSpeed.
// To refresh: re-pull the sheet's "COURT CONDITIONS GENERAL" tab CSV and
// re-run the matching/derivation scripts that produced this table.
const COURT_CONDITIONS = {
  'Hangzhou': { speed: 100, altitude: 42, abstractSpeed: 1.42, abstractSpeedYear: 2025, as2023: null, as2024: 1.38, as2025: 1.42, firstServeWon: 74, serviceHold: 80, cpi: null, cpiYear: null },
  'Stuttgart': { speed: 98, altitude: 245, abstractSpeed: 1.4, abstractSpeedYear: 2025, as2023: 1.45, as2024: 1.36, as2025: 1.4, firstServeWon: 76, serviceHold: 86, cpi: null, cpiYear: null },
  'Basel': { speed: 98, altitude: 260, abstractSpeed: 1.4, abstractSpeedYear: 2025, as2023: 1.11, as2024: 1.43, as2025: 1.4, firstServeWon: 75, serviceHold: 82, cpi: null, cpiYear: null },
  'Turin': { speed: 94, altitude: 240, abstractSpeed: 1.36, abstractSpeedYear: 2025, as2023: 1.76, as2024: 1.41, as2025: 1.36, firstServeWon: 77, serviceHold: 87, cpi: 38.9, cpiYear: 2025 },
  'London': { speed: 93, altitude: 24, abstractSpeed: 1.35, abstractSpeedYear: 2025, as2023: 1.1, as2024: 1.34, as2025: 1.35, firstServeWon: 74, serviceHold: 82, cpi: null, cpiYear: null },
  'Metz': { speed: 93, altitude: 209, abstractSpeed: 1.35, abstractSpeedYear: 2025, as2023: 1.08, as2024: 1.34, as2025: 1.35, firstServeWon: 72, serviceHold: 81, cpi: null, cpiYear: null },
  'Antwerp': { speed: 92, altitude: 8, abstractSpeed: 1.34, abstractSpeedYear: 2025, as2023: 1.25, as2024: 1.33, as2025: 1.34, firstServeWon: 74, serviceHold: 83, cpi: null, cpiYear: null },
  'Halle': { speed: 85, altitude: 90, abstractSpeed: 1.27, abstractSpeedYear: 2025, as2023: 1.28, as2024: 1.23, as2025: 1.27, firstServeWon: 75, serviceHold: 86, cpi: null, cpiYear: null },
  'Vienna': { speed: 81, altitude: 190, abstractSpeed: 1.23, abstractSpeedYear: 2025, as2023: 1.15, as2024: 1.24, as2025: 1.23, firstServeWon: 73, serviceHold: 83, cpi: null, cpiYear: null },
  'Brisbane': { speed: 81, altitude: 32, abstractSpeed: 1.23, abstractSpeedYear: 2025, as2023: null, as2024: 1.26, as2025: 1.23, firstServeWon: 75, serviceHold: 85, cpi: null, cpiYear: null },
  'Almaty': { speed: 80, altitude: 800, abstractSpeed: 1.22, abstractSpeedYear: 2025, as2023: null, as2024: 1.16, as2025: 1.22, firstServeWon: 74, serviceHold: 84, cpi: null, cpiYear: null },
  'Dallas': { speed: 79, altitude: 150, abstractSpeed: 1.21, abstractSpeedYear: 2025, as2023: 1.29, as2024: 1.19, as2025: 1.21, firstServeWon: 75, serviceHold: 85, cpi: null, cpiYear: null },
  'Cincinnati': { speed: 78, altitude: 226, abstractSpeed: 1.2, abstractSpeedYear: 2025, as2023: 0.8, as2024: 1.19, as2025: 1.2, firstServeWon: 72, serviceHold: 80, cpi: 43, cpiYear: 2025 },
  'Miami': { speed: 76, altitude: 5, abstractSpeed: 1.18, abstractSpeedYear: 2025, as2023: 1.24, as2024: 1.16, as2025: 1.18, firstServeWon: 72, serviceHold: 80, cpi: 40.7, cpiYear: 2025 },
  'Tokyo': { speed: 76, altitude: 40, abstractSpeed: 1.18, abstractSpeedYear: 2025, as2023: 1.12, as2024: 1.17, as2025: 1.18, firstServeWon: 71, serviceHold: 79, cpi: null, cpiYear: null },
  'Washington': { speed: 76, altitude: 90, abstractSpeed: 1.18, abstractSpeedYear: 2025, as2023: 1, as2024: 1.17, as2025: 1.18, firstServeWon: 72, serviceHold: 79, cpi: null, cpiYear: null },
  'Chengdu': { speed: 75, altitude: 250, abstractSpeed: 1.17, abstractSpeedYear: 2025, as2023: 1, as2024: 1.17, as2025: 1.17, firstServeWon: 72, serviceHold: 78, cpi: null, cpiYear: null },
  'Adelaide': { speed: 73, altitude: 0, abstractSpeed: 1.15, abstractSpeedYear: 2025, as2023: 1.25, as2024: 1.1, as2025: 1.15, firstServeWon: 73, serviceHold: 83, cpi: null, cpiYear: null },
  'Cordoba': { speed: 73, altitude: 390, abstractSpeed: 1.15, abstractSpeedYear: 2023, as2023: 1.15, as2024: null, as2025: null, firstServeWon: 70, serviceHold: 75, cpi: null, cpiYear: null },
  'Wimbledon': { speed: 69, altitude: 24, abstractSpeed: 1.11, abstractSpeedYear: 2025, as2023: 1.1, as2024: 1.08, as2025: 1.11, firstServeWon: 72, serviceHold: 81, cpi: 37, cpiYear: 2025 },
  'Delray Beach': { speed: 69, altitude: 5, abstractSpeed: 1.11, abstractSpeedYear: 2025, as2023: 1.12, as2024: 1.09, as2025: 1.11, firstServeWon: 71, serviceHold: 78, cpi: null, cpiYear: null },
  'Winston-Salem': { speed: 68, altitude: 241, abstractSpeed: 1.1, abstractSpeedYear: 2025, as2023: 1.15, as2024: 1.09, as2025: 1.1, firstServeWon: 72, serviceHold: 77, cpi: null, cpiYear: null },
  'Montpellier': { speed: 68, altitude: 27, abstractSpeed: 1.1, abstractSpeedYear: 2025, as2023: 1.02, as2024: 1.08, as2025: 1.1, firstServeWon: 71, serviceHold: 79, cpi: null, cpiYear: null },
  'Marseille': { speed: 67, altitude: 50, abstractSpeed: 1.09, abstractSpeedYear: 2025, as2023: 1.12, as2024: 1.04, as2025: 1.09, firstServeWon: 73, serviceHold: 81, cpi: null, cpiYear: null },
  'Shanghai': { speed: 66, altitude: 4, abstractSpeed: 1.08, abstractSpeedYear: 2025, as2023: 1.07, as2024: 1.08, as2025: 1.08, firstServeWon: 71, serviceHold: 80, cpi: 32.8, cpiYear: 2025 },
  'Doha': { speed: 66, altitude: 16, abstractSpeed: 1.08, abstractSpeedYear: 2025, as2023: 1.06, as2024: 1.07, as2025: 1.08, firstServeWon: 69, serviceHold: 78, cpi: null, cpiYear: null },
  'Mallorca': { speed: 64, altitude: 60, abstractSpeed: 1.06, abstractSpeedYear: 2025, as2023: 1.12, as2024: 1.05, as2025: 1.06, firstServeWon: 75, serviceHold: 85, cpi: null, cpiYear: null },
  'Australian Open': { speed: 64, altitude: 14, abstractSpeed: 1.06, abstractSpeedYear: 2025, as2023: 1.03, as2024: 1.06, as2025: 1.06, firstServeWon: 71, serviceHold: 79, cpi: null, cpiYear: null },
  'Beijing': { speed: 64, altitude: 50, abstractSpeed: 1.06, abstractSpeedYear: 2025, as2023: 0.93, as2024: 1.05, as2025: 1.06, firstServeWon: 70, serviceHold: 76, cpi: null, cpiYear: null },
  'Dubai': { speed: 61, altitude: 16, abstractSpeed: 1.03, abstractSpeedYear: 2025, as2023: 1.15, as2024: 1, as2025: 1.03, firstServeWon: 73, serviceHold: 82, cpi: null, cpiYear: null },
  'Hong Kong': { speed: 60, altitude: 47, abstractSpeed: 1.02, abstractSpeedYear: 2025, as2023: null, as2024: 1.3, as2025: 1.02, firstServeWon: 72, serviceHold: 80, cpi: null, cpiYear: null },
  'Montreal': { speed: 60, altitude: 30, abstractSpeed: 1.02, abstractSpeedYear: 2025, as2023: 1.07, as2024: null, as2025: 1.02, firstServeWon: 72, serviceHold: 79, cpi: 37.8, cpiYear: 2025 },
  'Los Cabos': { speed: 60, altitude: 20, abstractSpeed: 1.02, abstractSpeedYear: 2025, as2023: 0.92, as2024: 0.98, as2025: 1.02, firstServeWon: 70, serviceHold: 77, cpi: null, cpiYear: null },
  'Toronto': { speed: 59, altitude: 30, abstractSpeed: 1.01, abstractSpeedYear: 2024, as2023: null, as2024: 1.01, as2025: null, firstServeWon: 72, serviceHold: 79, cpi: 44.6, cpiYear: 2025 },
  'Gstaad': { speed: 58, altitude: 1050, abstractSpeed: 1, abstractSpeedYear: 2025, as2023: 0.78, as2024: 1.05, as2025: 1, firstServeWon: 71, serviceHold: 79, cpi: null, cpiYear: null },
  'US Open': { speed: 56, altitude: 10, abstractSpeed: 0.98, abstractSpeedYear: 2025, as2023: 1.01, as2024: 0.98, as2025: 0.98, firstServeWon: 72, serviceHold: 78, cpi: 42.8, cpiYear: 2024 },
  'Hertogenbosch': { speed: 55, altitude: 6, abstractSpeed: 0.97, abstractSpeedYear: 2025, as2023: 1.22, as2024: 0.98, as2025: 0.97, firstServeWon: 73, serviceHold: 83, cpi: null, cpiYear: null },
  'Paris': { speed: 55, altitude: 35, abstractSpeed: 0.97, abstractSpeedYear: 2025, as2023: 1.1, as2024: 0.99, as2025: 0.97, firstServeWon: 74, serviceHold: 81, cpi: 35.1, cpiYear: 2025 },
  'Auckland': { speed: 51, altitude: 39, abstractSpeed: 0.93, abstractSpeedYear: 2025, as2023: 1.15, as2024: 0.93, as2025: 0.93, firstServeWon: 72, serviceHold: 80, cpi: null, cpiYear: null },
  'Stockholm': { speed: 51, altitude: 28, abstractSpeed: 0.93, abstractSpeedYear: 2025, as2023: 0.95, as2024: 0.89, as2025: 0.93, firstServeWon: 70, serviceHold: 77, cpi: null, cpiYear: null },
  'Rio de Janeiro': { speed: 50, altitude: 40, abstractSpeed: 0.91, abstractSpeedYear: 2025, as2023: 0.87, as2024: 0.91, as2025: 0.91, firstServeWon: 65, serviceHold: 71, cpi: null, cpiYear: null },
  'Buenos Aires': { speed: 48, altitude: 25, abstractSpeed: 0.89, abstractSpeedYear: 2025, as2023: 0.7, as2024: 0.86, as2025: 0.89, firstServeWon: 65, serviceHold: 71, cpi: null, cpiYear: null },
  'Bastad': { speed: 43, altitude: 14, abstractSpeed: 0.84, abstractSpeedYear: 2025, as2023: 0.86, as2024: 0.85, as2025: 0.84, firstServeWon: 67, serviceHold: 73, cpi: null, cpiYear: null },
  'Umag': { speed: 41, altitude: 1, abstractSpeed: 0.82, abstractSpeedYear: 2025, as2023: 0.67, as2024: 0.79, as2025: 0.82, firstServeWon: 67, serviceHold: 72, cpi: null, cpiYear: null },
  'Acapulco': { speed: 40, altitude: 30, abstractSpeed: 0.81, abstractSpeedYear: 2025, as2023: 0.68, as2024: 0.81, as2025: 0.81, firstServeWon: 70, serviceHold: 75, cpi: null, cpiYear: null },
  'Kitzbuhel': { speed: 40, altitude: 762, abstractSpeed: 0.81, abstractSpeedYear: 2025, as2023: 0.95, as2024: 0.8, as2025: 0.81, firstServeWon: 70, serviceHold: 77, cpi: null, cpiYear: null },
  'Madrid': { speed: 39, altitude: 650, abstractSpeed: 0.8, abstractSpeedYear: 2025, as2023: 0.92, as2024: 0.77, as2025: 0.8, firstServeWon: 71, serviceHold: 81, cpi: 26.1, cpiYear: 2025 },
  'Marrakech': { speed: 39, altitude: 457, abstractSpeed: 0.8, abstractSpeedYear: 2025, as2023: 0.59, as2024: 0.77, as2025: 0.8, firstServeWon: 67, serviceHold: 72, cpi: null, cpiYear: null },
  'Rotterdam': { speed: 37, altitude: 2, abstractSpeed: 0.78, abstractSpeedYear: 2025, as2023: 0.96, as2024: 0.77, as2025: 0.78, firstServeWon: 71, serviceHold: 79, cpi: null, cpiYear: null },
  'Eastbourne': { speed: 36, altitude: 15, abstractSpeed: 0.77, abstractSpeedYear: 2025, as2023: 1.1, as2024: 0.75, as2025: 0.77, firstServeWon: 71, serviceHold: 80, cpi: null, cpiYear: null },
  'Houston': { speed: 35, altitude: 24, abstractSpeed: 0.76, abstractSpeedYear: 2025, as2023: 0.93, as2024: 0.76, as2025: 0.76, firstServeWon: 70, serviceHold: 79, cpi: null, cpiYear: null },
  'Indian Wells': { speed: 33, altitude: 27, abstractSpeed: 0.74, abstractSpeedYear: 2025, as2023: 0.89, as2024: 0.72, as2025: 0.74, firstServeWon: 71, serviceHold: 77, cpi: 30.9, cpiYear: 2025 },
  'Geneva': { speed: 31, altitude: 375, abstractSpeed: 0.72, abstractSpeedYear: 2025, as2023: 0.88, as2024: 0.7, as2025: 0.72, firstServeWon: 71, serviceHold: 78, cpi: null, cpiYear: null },
  'Santiago': { speed: 29, altitude: 520, abstractSpeed: 0.7, abstractSpeedYear: 2025, as2023: 0.88, as2024: 0.68, as2025: 0.7, firstServeWon: 69, serviceHold: 76, cpi: null, cpiYear: null },
  'Lyon': { speed: 29, altitude: 230, abstractSpeed: 0.7, abstractSpeedYear: 2023, as2023: 0.7, as2024: null, as2025: null, firstServeWon: 68, serviceHold: 75, cpi: null, cpiYear: null },
  'Estoril': { speed: 29, altitude: 49, abstractSpeed: 0.7, abstractSpeedYear: 2023, as2023: 0.7, as2024: null, as2025: null, firstServeWon: 67, serviceHold: 74, cpi: null, cpiYear: null },
  'Roland Garros': { speed: 27, altitude: 35, abstractSpeed: 0.68, abstractSpeedYear: 2025, as2023: 0.62, as2024: 0.68, as2025: 0.68, firstServeWon: 69, serviceHold: 74, cpi: null, cpiYear: null },
  'Munich': { speed: 24, altitude: 520, abstractSpeed: 0.65, abstractSpeedYear: 2025, as2023: 0.63, as2024: 0.64, as2025: 0.65, firstServeWon: 68, serviceHold: 75, cpi: null, cpiYear: null },
  'Newport': { speed: 21, altitude: 5, abstractSpeed: 0.62, abstractSpeedYear: 2023, as2023: 0.62, as2024: null, as2025: null, firstServeWon: 71, serviceHold: 78, cpi: null, cpiYear: null },
  'Rome': { speed: 20, altitude: 21, abstractSpeed: 0.61, abstractSpeedYear: 2025, as2023: 0.69, as2024: 0.59, as2025: 0.61, firstServeWon: 69, serviceHold: 77, cpi: 28.9, cpiYear: 2025 },
  'Barcelona': { speed: 18, altitude: 65, abstractSpeed: 0.59, abstractSpeedYear: 2025, as2023: 0.51, as2024: 0.56, as2025: 0.59, firstServeWon: 65, serviceHold: 70, cpi: null, cpiYear: null },
  'Hamburg': { speed: 17, altitude: 23, abstractSpeed: 0.58, abstractSpeedYear: 2025, as2023: 0.8, as2024: 0.56, as2025: 0.58, firstServeWon: 69, serviceHold: 76, cpi: null, cpiYear: null },
  'Monte Carlo': { speed: 15, altitude: 25, abstractSpeed: 0.56, abstractSpeedYear: 2025, as2023: 0.61, as2024: 0.55, as2025: 0.56, firstServeWon: 67, serviceHold: 72, cpi: 29, cpiYear: 2025 },
  'Bucharest': { speed: 0, altitude: 75, abstractSpeed: 0.41, abstractSpeedYear: 2025, as2023: null, as2024: 0.44, as2025: 0.41, firstServeWon: 67, serviceHold: 72, cpi: null, cpiYear: null },
};

// Speed category buckets aren't an externally sourced label — they're real
// terciles of the 64 derived speed values (p33≈43, p66=68), disclosed here
// as a derived split rather than presented as sourced data. Recomputed for
// this new dataset (previous thresholds were 47/67, based on the old
// 58-tournament speed set).
function courtSpeedCategory(speed) {
  if (speed == null) return null;
  return speed <= 43 ? 'Slow' : speed <= 68 ? 'Medium' : 'Fast';
}

// Matches a raw tournament_name (verbose API string, e.g. "Halle Terra
// Wortmann Open") to a COURT_CONDITIONS key, reusing the exact substring
// pattern already used for TOURNAMENT_VENUE_HINTS lookups elsewhere.
function courtConditionsFor(tournamentName) {
  if (!tournamentName) return null;
  const key = Object.keys(COURT_CONDITIONS).find(k => tournamentName.includes(k));
  return key ? { key, ...COURT_CONDITIONS[key] } : null;
}

async function geocodeCity(city, countryCode) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10&countryCode=${countryCode}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.results || data.results.length === 0) return null;
    const best = [...data.results].sort((a, b) => (b.population || 0) - (a.population || 0))[0];
    return { lat: best.latitude, lon: best.longitude };
  } catch (err) {
    console.error(`Geocoding failed for ${city}, ${countryCode}:`, err);
    return null;
  }
}

const TOURNAMENT_VENUE_CACHE_PATH = 'tournament-venues.json';
const TOURNAMENT_VENUE_CACHE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // venues rarely move

async function loadTournamentVenueMap() {
  if (fs.existsSync(TOURNAMENT_VENUE_CACHE_PATH)) {
    const cache = JSON.parse(fs.readFileSync(TOURNAMENT_VENUE_CACHE_PATH, 'utf8'));
    if (Date.now() - new Date(cache.fetchedAt).getTime() < TOURNAMENT_VENUE_CACHE_MAX_AGE_MS) {
      return cache.venues;
    }
  }
  console.log('Refreshing tournament venue coordinates via Open-Meteo geocoding...');
  const venues = {};
  const geocodeCache = new Map(); // avoid duplicate lookups for the same city+country
  for (const [key, hint] of Object.entries(TOURNAMENT_VENUE_HINTS)) {
    const cacheKey = `${hint.city}|${hint.country}`;
    if (!geocodeCache.has(cacheKey)) {
      geocodeCache.set(cacheKey, await geocodeCity(hint.city, hint.country));
      await new Promise(r => setTimeout(r, 120)); // be polite to the free geocoding API
    }
    const coords = geocodeCache.get(cacheKey);
    if (coords) venues[key] = coords;
  }
  fs.writeFileSync(TOURNAMENT_VENUE_CACHE_PATH, JSON.stringify({ fetchedAt: new Date().toISOString(), venues }, null, 2));
  return venues;
}

// =================================================================
// TOURNAMENT PROFILES — draw size, defending champion, palmarès, and
// full match lists per tournament, reconstructed from real historical
// get_fixtures data (never invented). Confirmed live before building
// this: Wimbledon 2021 final (Djokovic d. Berrettini), 2022 final
// (Djokovic d. Kyrgios), 2025 final (Sinner d. Alcaraz), Halle 2024
// final (Sinner d. Hurkacz) — all match real-world results.
//
// COVERAGE LIMITATION (verified live): API-Tennis's fixture history has
// real gaps before ~2021 — several months/years from 2016-2020 return
// ZERO fixtures for the entire ATP tour, not just one event. So we only
// look back PROFILE_YEARS_BACK seasons and label stats as "on record
// since <year>", never as an unverifiable all-time figure.
//
// APPROACH: rather than guess each of the 73 tournaments' exact
// calendar week (high risk of a bad guess silently under-reporting),
// we fetch the ENTIRE ATP season month by month for each of the last
// PROFILE_YEARS_BACK years and split results locally by tournament
// name. Worst case on this approach is slower, never wrong — each
// match's own tournament_name + tournament_season fields say
// definitively which edition it belongs to, regardless of which
// month we happened to fetch it in.
// =================================================================
const TOURNAMENT_PROFILE_CACHE_PATH = 'tournament-profiles.json';
const TOURNAMENT_PROFILE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PROFILE_YEARS_BACK = 6; // covers 2021 (earliest reliable season) through the current year

function isFinalRound(round) {
  if (!round) return false;
  const r = round.toLowerCase().trim();
  return r.endsWith('final') && !r.includes('semi') && !r.includes('quarter');
}

// Real ATP main draws only ever use these public, fixed sizes. Used to clean
// up small amounts of raw-data noise (see snapToCanonicalDrawSize below) —
// never to guess a size we have no match evidence for.
const CANONICAL_DRAW_SIZES = [128, 96, 64, 56, 48, 32, 28, 16, 8];
function snapToCanonicalDrawSize(raw) {
  if (raw <= 0) return null;
  for (const size of CANONICAL_DRAW_SIZES) {
    if (raw >= size && raw <= size + 6) return size;
  }
  return raw; // doesn't fit any canonical size within a small margin — return raw rather than guess
}

async function fetchAtpFixturesForMonth(year, month) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const stop = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const url = `${API_TENNIS_BASE}?method=get_fixtures&APIkey=${API_TENNIS_KEY}&date_start=${start}&date_stop=${stop}&event_type_key=265`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return Array.isArray(data.result) ? data.result : [];
  } catch (err) {
    console.error(`get_fixtures failed for ${year}-${month}:`, err);
    return [];
  }
}

// Trim a raw fixture down to only what a tournament profile needs — the
// raw object also carries a heavy statistics/pointbypoint payload we
// never use here, and keeping it would bloat the cache file.
function trimFixture(f) {
  return {
    date: f.event_date,
    p1: f.event_first_player,
    p1Key: f.first_player_key,
    p2: f.event_second_player,
    p2Key: f.second_player_key,
    winner: f.event_winner,
    result: f.event_final_result,
    round: f.tournament_round,
    season: f.tournament_season,
    // The row's identity. Without it a tournament-history row is a string of
    // text with nothing to join its setstats/{ek}.json and pbp/{ek}.json
    // shards from, which is what kept the Tournament tab's match rows from
    // expanding (Task 11).
    eventKey: f.event_key,
  };
}

async function loadTournamentProfiles() {
  if (fs.existsSync(TOURNAMENT_PROFILE_CACHE_PATH)) {
    const cache = JSON.parse(fs.readFileSync(TOURNAMENT_PROFILE_CACHE_PATH, 'utf8'));
    if (Date.now() - new Date(cache.fetchedAt).getTime() < TOURNAMENT_PROFILE_CACHE_MAX_AGE_MS) {
      return cache;
    }
  }
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear; y > currentYear - PROFILE_YEARS_BACK; y--) years.push(y);
  console.log(`Rebuilding tournament profiles for seasons ${years[years.length - 1]}-${years[0]} (this takes a while — ${years.length * 12} monthly requests)...`);

  const hintKeys = Object.keys(TOURNAMENT_VENUE_HINTS);
  const matchesByTournament = {};
  hintKeys.forEach(k => { matchesByTournament[k] = {}; });

  for (const year of years) {
    for (let month = 1; month <= 12; month++) {
      const fixtures = await fetchAtpFixturesForMonth(year, month);
      for (const f of fixtures) {
        if (!f.tournament_round || f.event_qualification === 'True') continue;
        const key = hintKeys.find(k => f.tournament_name && f.tournament_name.includes(k));
        if (!key) continue;
        const season = f.tournament_season || String(year);
        if (!matchesByTournament[key][season]) matchesByTournament[key][season] = [];
        matchesByTournament[key][season].push(trimFixture(f));
      }
      await new Promise(r => setTimeout(r, 150)); // be polite to the API
    }
    console.log(`  ...season ${year} done`);
  }

  // Resolve champion nationality once per unique player, cached inline
  // for this run (get_players has no bulk-lookup, so this is one call
  // per distinct champion, not per match).
  const countryCache = {};
  async function countryFor(playerKey) {
    if (!playerKey) return null;
    if (countryCache[playerKey] !== undefined) return countryCache[playerKey];
    try {
      const url = `${API_TENNIS_BASE}?method=get_players&APIkey=${API_TENNIS_KEY}&player_key=${playerKey}`;
      const res = await fetch(url);
      const data = await res.json();
      const country = data.result?.[0]?.player_country || null;
      countryCache[playerKey] = country;
      await new Promise(r => setTimeout(r, 100));
      return country;
    } catch {
      countryCache[playerKey] = null;
      return null;
    }
  }

  const profiles = {};
  for (const [key, seasons] of Object.entries(matchesByTournament)) {
    const seasonYears = Object.keys(seasons).sort((a, b) => b - a); // newest first
    if (seasonYears.length === 0) { profiles[key] = null; continue; }

    const editions = [];
    for (const season of seasonYears) {
      // Drop unplayed/walkover-replaced fixture ghosts (no winner recorded
      // means the match never actually happened — confirmed real artifact,
      // e.g. Halle 2026 has a "B. Shelton vs N. Kyrgios" row with winner:null
      // sitting alongside the real "B. Shelton vs L. Sonego" replacement
      // match on the same day).
      const played = seasons[season].filter(m => m.winner === 'First Player' || m.winner === 'Second Player');

      // Pick the Final-round match with the LATEST date, not just the first
      // one found. Confirmed real bug otherwise: API-Tennis sometimes
      // mislabels qualifying-round matches with the exact same round-name
      // string as a main-draw round (e.g. Wimbledon 2021 has 16 qualifying
      // "Final Round" matches dated 2021-06-24, sharing the literal round
      // label "Wimbledon - Final" with the real final played 2021-07-11 —
      // picking the first match in API order would return the wrong champion).
      const finalCandidates = played.filter(m => isFinalRound(m.round));
      const final = finalCandidates.length
        ? finalCandidates.reduce((a, b) => (b.date > a.date ? b : a))
        : null;

      // Anchor on the real final's date and drop anything more than 15 days
      // earlier — comfortably covers the longest real ATP main draw (a
      // 128-draw Slam runs ~13 days from Round 1 to Final, confirmed against
      // real Wimbledon 2021 dates) while excluding the qualifying rounds
      // that the same round-label bug above also contaminates earlier
      // rounds with (confirmed: Wimbledon 2021 Quarterfinal/Semifinal
      // buckets were similarly inflated by mislabeled qualifying matches).
      const clean = final
        ? played.filter(m => {
            const days = (new Date(final.date) - new Date(m.date)) / 86400000;
            return days >= 0 && days <= 15;
          })
        : played;

      let champion = null;
      if (final) {
        const winnerName = final.winner === 'First Player' ? final.p1 : final.p2;
        const winnerKey = final.winner === 'First Player' ? final.p1Key : final.p2Key;
        // event_final_result is always "player1 sets - player2 sets", NOT
        // winner-first — confirmed real bug otherwise: when the winner was
        // "Second Player", the raw string (e.g. "0 - 2") reads as if the
        // champion lost. Reorder to winner-first so the stored result always
        // reflects the champion's own score.
        let result = final.result;
        if (final.winner === 'Second Player' && result && result.includes('-')) {
          const parts = result.split('-').map(s => s.trim());
          if (parts.length === 2) result = `${parts[1]} - ${parts[0]}`;
        }
        champion = { name: winnerName, country: await countryFor(winnerKey), result };
      }
      // Draw size = count of distinct players who appear in the clean match
      // set, snapped to the nearest canonical ATP draw size. NOT round-match-
      // count*2 — confirmed real bug: ATP 1000 draws (Miami, Monte Carlo,
      // etc.) give the top ~1/3 of seeds a bye straight to the second round,
      // so the "first round" bucket only contains the non-bye players and
      // undercounts (e.g. Miami's real 96-draw has only 32 "Round of 64"
      // matches because 32 seeds sit out that round — round-count*2 wrongly
      // computed 64). Distinct-player count isn't affected by byes (bye
      // players still show up once they play their first real match) and
      // stays correct for walkover ghosts too (a player whose only fixture
      // was an unplayed/cancelled match never entered `clean` to begin with).
      const distinctPlayers = new Set();
      clean.forEach(m => { distinctPlayers.add(m.p1); distinctPlayers.add(m.p2); });
      const drawSize = snapToCanonicalDrawSize(distinctPlayers.size);
      editions.push({ season, champion, drawSize, matchCount: clean.length, matches: clean });
    }

    const totalMatches = editions.reduce((sum, e) => sum + e.matchCount, 0);
    const currentYearEdition = editions.find(e => e.season === String(currentYear));
    const mostRecentCompleted = editions.find(e => e.champion);
    profiles[key] = {
      editionsOnRecord: editions.length,
      totalMatchesOnRecord: totalMatches,
      mostRecentDrawSize: mostRecentCompleted?.drawSize || editions[0]?.drawSize || null,
      defendingChampion: mostRecentCompleted?.champion || null,
      palmares: editions.filter(e => e.champion).slice(0, 3).map(e => ({ season: e.season, champion: e.champion })),
      currentEditionMatches: currentYearEdition ? currentYearEdition.matches : null,
      allEditionMatches: editions.map(e => ({ season: e.season, matches: e.matches })),
    };
  }

  const output = {
    fetchedAt: new Date().toISOString(),
    sinceYear: years[years.length - 1],
    profiles,
  };
  writeJsonAtomic(TOURNAMENT_PROFILE_CACHE_PATH, output);
  console.log('Tournament profiles rebuilt.');
  return output;
}

// Builds the Mon–Sun forecast week that the match falls in, from the SAME
// Open-Meteo response (daily block + hourly humidity), so it costs no extra
// API call. Every value is a real forecast number; days that fall outside
// Open-Meteo's window are marked { available:false } rather than invented.
function buildForecastWeek(daily, hourly, matchDateStr) {
  if (!daily || !daily.time) return null;
  const mon = new Date(matchDateStr + 'T00:00:00Z');
  mon.setUTCDate(mon.getUTCDate() - ((mon.getUTCDay() + 6) % 7)); // back to Monday
  const ymd = d => d.toISOString().slice(0, 10);
  const week = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(mon); day.setUTCDate(mon.getUTCDate() + i);
    const ds = ymd(day);
    const di = daily.time.indexOf(ds);
    if (di === -1) { week.push({ date: ds, available: false }); continue; }
    let hSum = 0, hN = 0; // daily-mean humidity from the hourly series
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

// Task 3: completed matches now show the REAL weather on the day they were
// played, not a "forecast not available" fallback. The /v1/forecast endpoint
// only spans today ±7 days, so for anything older we pull the actual conditions
// from Open-Meteo's historical archive (ERA5, same hourly/daily schema). The
// returned object carries `historical` so the dashboard can label it "Weather
// on match day" instead of "Forecast". A future match with no forecast still
// returns null (genuine no-data) — we only reach the archive for past matches.
async function fetchMatchWeather(tournamentName, matchDateTimeISO, venueMap) {
  const key = Object.keys(venueMap).find(k => tournamentName.includes(k));
  if (!key) return null;
  const { lat, lon } = venueMap[key];

  const matchTime = new Date(matchDateTimeISO);
  const matchHour = matchTime.toISOString().slice(0, 13) + ':00';
  const matchDateStr = matchTime.toISOString().slice(0, 10);
  const isPast = matchTime.getTime() < Date.now();

  // Build the weather payload from an Open-Meteo response. Both /v1/forecast and
  // the archive endpoint expose the same hourly/daily arrays, so this is shared.
  const buildPayload = (data, historical) => {
    if (!data || !data.hourly || !data.hourly.time) return null;
    const hourIndex = data.hourly.time.indexOf(matchHour);
    if (hourIndex === -1) return null;
    const forecast = buildForecastWeek(data.daily, data.hourly, matchDateStr);
    return {
      temperature: data.hourly.temperature_2m[hourIndex],
      windSpeed: data.hourly.windspeed_10m[hourIndex],
      humidity: data.hourly.relative_humidity_2m[hourIndex],
      source: 'Open-Meteo',
      historical,
      weekRange: forecast ? forecast.weekRange : null,
      week: forecast ? forecast.days : null,
    };
  };

  // 1) Forecast endpoint — covers today ±7 days. `past_days` returns real
  //    measured values for recent past days, so a match played this week is
  //    still real data; `historical` is keyed off whether the match is past,
  //    not off which endpoint answered.
  const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&hourly=temperature_2m,windspeed_10m,relative_humidity_2m`
    + `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max`
    + `&past_days=7&forecast_days=7&timezone=UTC`;
  try {
    const data = await (await fetch(forecastUrl)).json();
    const payload = buildPayload(data, isPast);
    if (payload) return payload;
  } catch (err) {
    console.error('Weather forecast fetch failed:', err);
  }

  // 2) Match sits outside the forecast window. If it already happened, pull the
  //    real conditions on the day from the historical archive. A future match
  //    with no forecast stays null rather than inventing data.
  if (!isPast) return null;
  const mon = new Date(matchDateStr + 'T00:00:00Z');
  mon.setUTCDate(mon.getUTCDate() - ((mon.getUTCDay() + 6) % 7)); // back to Monday
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  const ymd = d => d.toISOString().slice(0, 10);
  // The ERA5 archive only serves dates up to today; a match played earlier this
  // week has a Sunday-of-week end_date in the future, which returns HTTP 400 and
  // wipes the whole fetch. Clamp end_date to today so the request always
  // succeeds — the match day itself is always in range, so the hourly lookup
  // still resolves; later days of the week simply render "—".
  const todayYmd = new Date().toISOString().slice(0, 10);
  const endYmd = ymd(sun) > todayYmd ? todayYmd : ymd(sun);
  const archiveUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}`
    + `&hourly=temperature_2m,windspeed_10m,relative_humidity_2m`
    + `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max`
    + `&start_date=${ymd(mon)}&end_date=${endYmd}&timezone=UTC`;
  try {
    const data = await (await fetch(archiveUrl)).json();
    // The archive has no precipitation_probability_max (a forecast-only field);
    // expose a null array so buildForecastWeek renders "—" for rain, not a crash.
    if (data && data.daily && !data.daily.precipitation_probability_max) {
      const n = (data.daily.time || []).length;
      data.daily.precipitation_probability_max = new Array(n).fill(null);
    }
    return buildPayload(data, true);
  } catch (err) {
    console.error('Weather archive fetch failed:', err);
    return null;
  }
}

// =================================================================
// MERGE — match an Odds API event to its API-Tennis fixture by last name
// =================================================================
function findApiTennisFixture(oddsEvent, apiTennisFixtures) {
  const p1Last = lastName(oddsEvent.home_team);
  const p2Last = lastName(oddsEvent.away_team);
  return apiTennisFixtures.find(f =>
    (lastName(f.event_first_player) === p1Last && lastName(f.event_second_player) === p2Last) ||
    (lastName(f.event_first_player) === p2Last && lastName(f.event_second_player) === p1Last)
  );
}

// PLACEHOLDER — your real W/UE + first serve + surface form + fatigue
// model goes here. Returns null deliberately until it's built, so
// `value` is never faked.
function computeModelProbability() {
  return null;
}

async function buildMatchObject(oddsEvent, apiTennisFixtures, surfaceMap, venueMap) {
  const surface = surfaceFromEvent(oddsEvent);
  const tour = oddsEvent.sport_key.includes('atp') ? 'ATP' : 'WTA';

  const bookmaker = pinnacleOrFirst(oddsEvent);
  const h2hMarket = bookmaker?.markets?.find(m => m.key === 'h2h')?.outcomes;
  const p1Odds = h2hMarket?.find(o => normalizeName(o.name) === normalizeName(oddsEvent.home_team))?.price;
  const p2Odds = h2hMarket?.find(o => normalizeName(o.name) === normalizeName(oddsEvent.away_team))?.price;

  let value = null;
  const modelProb = computeModelProbability();
  if (modelProb !== null && p1Odds && p2Odds) {
    const { p1Fair } = removeVig(impliedProbability(p1Odds), impliedProbability(p2Odds));
    value = Math.round((modelProb - p1Fair) * 1000) / 10;
  }

  const { bestP1, bestP2 } = bestOdds(oddsEvent);

  const match = {
    id: oddsEvent.id,
    day: computeDay(oddsEvent.commence_time),
    date: new Date(oddsEvent.commence_time).toISOString().slice(0, 10),
    time: new Date(oddsEvent.commence_time).toISOString().slice(11, 16),
    p1: oddsEvent.home_team,
    p2: oddsEvent.away_team,
    tour: oddsEvent.sport_title,
    tourBadge: tour,
    surface,
    style: 'TBD', // still nobody's API — your own methodology, still to build
    value,
    odds: { p1: p1Odds, p2: p2Odds, bookmaker: bookmaker?.title },
    bestOdds: { p1: bestP1, p2: bestP2 },
    // New: enriched from API-Tennis if a matching fixture was found
    tournamentRound: null,
    p1Key: null,
    p2Key: null,
    h2h: null,
    p1SurfaceWinRate: null,
    p2SurfaceWinRate: null,
    p1Rank: null,
    p2Rank: null,
    p1RecentForm: null,
    p2RecentForm: null,
    p1RecentFormMatches: null,
    p2RecentFormMatches: null,
    p1SeasonSurface: null,
    p2SeasonSurface: null,
    p1Yearly: null,
    p2Yearly: null,
    p1TournamentHistory: null,
    p2TournamentHistory: null,
    extraStats: null,
    matchStats: null,
    setStats: null,
    venue: null,
    courtSpeed: null,
    weather: null, // from Open-Meteo, independent of API-Tennis fixture match
    live: false,
    liveStatus: null,
    liveScore: null,
    liveGameScore: null,
    liveServer: null,
    p1PhotoUrl: null,
    p2PhotoUrl: null,
  };

  // Weather doesn't depend on the API-Tennis fixture match, only on tournament + time
  match.weather = await fetchMatchWeather(oddsEvent.sport_title, oddsEvent.commence_time, venueMap);

  // Curated static reference facts (city/country/category/indoor) — same source
  // of truth as TOURNAMENT_VENUE_HINTS used for weather above, not a new lookup.
  const hintKey = Object.keys(TOURNAMENT_VENUE_HINTS).find(k => oddsEvent.sport_title.includes(k));
  const hint = hintKey ? TOURNAMENT_VENUE_HINTS[hintKey] : null;
  match.venue = hint ? { city: hint.city, country: hint.country, category: hint.category, indoor: hint.indoor } : null;

  // Court-conditions data reuses the same hintKey lookup as match.venue above
  // (both keyed by the same short tournament names) — real data from the
  // user's court-conditions sheet (COURT_CONDITIONS), not re-derived.
  const courtConditions = hintKey ? COURT_CONDITIONS[hintKey] : null;
  match.courtSpeed = courtConditions
    ? { ...courtConditions, category: courtSpeedCategory(courtConditions.speed) }
    : null;

  const fixture = findApiTennisFixture(oddsEvent, apiTennisFixtures);
  if (!fixture) return match; // no API-Tennis match found — stays "coming soon" in the UI

  match.tournamentRound = fixture.tournament_round;

  // CORRECTNESS FIX: findApiTennisFixture() matches by last name in EITHER
  // player order (see its OR clause), so fixture.event_first_player is NOT
  // guaranteed to be match.p1 (oddsEvent.home_team) — it can legitimately be
  // match.p2 instead. Every field below used to assume fixture-first == p1
  // unconditionally, which would silently swap p1/p2 data (H2H, form, rank,
  // surface win rate, live score/server) for any real match where API-Tennis
  // happened to list the players in the opposite order from the odds feed.
  // Established once here via the same lastName() comparison already used
  // throughout this file, and used consistently below instead of assuming order.
  const p1IsFixtureFirst = lastName(fixture.event_first_player) === lastName(oddsEvent.home_team);
  const p1Key = p1IsFixtureFirst ? fixture.first_player_key : fixture.second_player_key;
  const p2Key = p1IsFixtureFirst ? fixture.second_player_key : fixture.first_player_key;
  match.p1Key = p1Key;
  match.p2Key = p2Key;

  // Real headshot URLs from the API-Tennis fixture (confirmed live this session:
  // event_first_player_logo / event_second_player_logo). Reuses p1IsFixtureFirst
  // for the same reason the live-state fields below do — the fixture's player
  // order isn't guaranteed to match p1/p2 (oddsEvent.home_team/away_team).
  match.p1PhotoUrl = p1IsFixtureFirst ? fixture.event_first_player_logo : fixture.event_second_player_logo;
  match.p2PhotoUrl = p1IsFixtureFirst ? fixture.event_second_player_logo : fixture.event_first_player_logo;

  // Live state — real fields from the API-Tennis fixture, confirmed live this session
  // against an actual in-progress match (event_live: "1", event_status: "Set 1").
  match.live = fixture.event_live === '1';
  match.liveStatus = match.live ? fixture.event_status : null;
  match.liveScore = match.live && Array.isArray(fixture.scores)
    ? fixture.scores.map(s => ({
        set: Number(s.score_set),
        p1: Number(p1IsFixtureFirst ? s.score_first : s.score_second),
        p2: Number(p1IsFixtureFirst ? s.score_second : s.score_first),
      }))
    : null;
  match.liveGameScore = match.live ? (fixture.event_game_result || null) : null;
  match.liveServer = match.live
    ? (fixture.event_serve === (p1IsFixtureFirst ? 'First Player' : 'Second Player') ? 'p1'
      : fixture.event_serve === (p1IsFixtureFirst ? 'Second Player' : 'First Player') ? 'p2' : null)
    : null;

  const h2hData = await fetchH2H(p1Key, p2Key);
  if (h2hData) {
    match.h2h = summarizeH2H(h2hData.headToHead, oddsEvent.home_team);
    match.h2h.matches = buildH2HMatchList(h2hData.headToHead, oddsEvent.home_team, surfaceMap);
    const [p1Form, p2Form] = await Promise.all([
      buildRecentFormForMatch(p1Key, surfaceMap),
      buildRecentFormForMatch(p2Key, surfaceMap),
    ]);
    match.p1RecentForm = p1Form.pct;
    match.p2RecentForm = p2Form.pct;
    match.p1RecentFormMatches = p1Form.matches;
    match.p2RecentFormMatches = p2Form.matches;
  }

  const [p1Stats, p2Stats] = await Promise.all([
    fetchPlayerStats(p1Key),
    fetchPlayerStats(p2Key),
  ]);
  match.p1SurfaceWinRate = surfaceWinRate(p1Stats, surface);
  match.p2SurfaceWinRate = surfaceWinRate(p2Stats, surface);
  match.p1Rank = currentSinglesRank(p1Stats);
  match.p2Rank = currentSinglesRank(p2Stats);

  const currentYear = new Date().getFullYear();
  const [p1CurrentFixtures, p2CurrentFixtures] = await Promise.all([
    fetchPlayerFixturesForYear(p1Key, currentYear),
    fetchPlayerFixturesForYear(p2Key, currentYear),
  ]);
  // All-tier fixtures (ATP + Challenger + ITF, ~5 seasons) — memoized, so one
  // fetch per player is shared by the yearly table AND the season-surface block
  // below (no extra API calls). p1CurrentFixtures stays fetched above for the
  // extra-stats reuse further down.
  const p1AllTierFix = await fetchRecentSinglesFixtures(p1Key);
  const p2AllTierFix = await fetchRecentSinglesFixtures(p2Key);

  // Year-by-year record: all-tier (ATP + Challenger + ITF) for the seasons the
  // fetch covers (currentYear-5..now); ATP-only provider aggregates (flagged)
  // for earlier seasons where no all-tier match data exists.
  match.p1Yearly = buildAllTierYearly(p1AllTierFix, p1Key, p1Stats, currentYear, surfaceMap);
  match.p2Yearly = buildAllTierYearly(p2AllTierFix, p2Key, p2Stats, currentYear, surfaceMap);

  // All-tier current-season surface record (ATP vs Challenger&ITF) with each
  // surface's match list, for the Overview season-surface tier filter + click
  // drill-down. Same memoized fetch, filtered to the current season.
  match.p1SeasonSurface = seasonSurfaceByTier(p1AllTierFix, p1Key, currentYear, surfaceMap);
  match.p2SeasonSurface = seasonSurfaceByTier(p2AllTierFix, p2Key, currentYear, surfaceMap);

  // Real per-match serve/return/point stats — reuses p1CurrentFixtures/
  // p2CurrentFixtures already fetched above for the season row, plus one
  // extra fetch for the prior year (inside buildExtraStats) to guarantee
  // full 52-week coverage.
  match.extraStats = await buildExtraStats(p1Key, p2Key, surface, surfaceMap, p1CurrentFixtures, p2CurrentFixtures, match.courtSpeed ? match.courtSpeed.category : null);

  // Year-by-year record at this specific tournament — one dedicated
  // per-player query each (see fetchPlayerTournamentMatches), covering each
  // player's full career at this tournament, not capped at PROFILE_YEARS_BACK.
  if (hintKey) {
    const [p1TournMatches, p2TournMatches] = await Promise.all([
      fetchPlayerTournamentMatches(p1Key, hintKey),
      fetchPlayerTournamentMatches(p2Key, hintKey),
    ]);
    match.p1TournamentHistory = buildTournamentHistory(p1TournMatches, p1Key);
    match.p2TournamentHistory = buildTournamentHistory(p2TournMatches, p2Key);
  }

  return match;
}

// =================================================================
// PAST MATCHES (Yesterday / 2-days-ago day-tabs) — a completed fixture has
// no betting-odds event (markets close once a match starts/finishes), so
// these matches are built directly from an API-Tennis fixture instead of
// from an oddsEvent. No player-order reordering is needed here (unlike
// buildMatchObject above): p1/p2 are simply the fixture's own first/second
// player, since there's no separate odds-feed order to reconcile against.
// =================================================================

// Parses one set's raw score pair into game counts + a display string.
// API-Tennis encodes a set that went to a tiebreak as "<games>.<tiebreakPoints>"
// per side, e.g. score_first:"6.4", score_second:"7.7" means the set was won
// 7-6 with the tiebreak itself going 7-4 — NOT a decimal game count. Confirmed
// against a real fixture this session (De Minaur 5-7, 6-7(4), 3-6 Cobolli).
// Returns null (never a guessed/partial value) if either side isn't parseable.
function formatSetScore(scoreFirst, scoreSecond) {
  if (scoreFirst == null || scoreSecond == null) return null;
  const [gF, tbF] = String(scoreFirst).split('.');
  const [gS, tbS] = String(scoreSecond).split('.');
  const p1 = Number(gF);
  const p2 = Number(gS);
  if (!Number.isFinite(p1) || !Number.isFinite(p2)) return null;
  let tb = '';
  if (tbF !== undefined || tbS !== undefined) {
    const loserTb = p1 < p2 ? tbF : tbS;
    if (loserTb !== undefined) tb = `(${loserTb})`;
  }
  return { p1, p2, display: `${p1}-${p2}${tb}` };
}

// Builds the final-score summary for a finished fixture from its real
// `scores` array. Returns null (shown as "pending" client-side, never
// blank/guessed) if the fixture has no usable scores data.
// A match the API has stopped mid-play: play is suspended (rain, bad light,
// curfew) but no result exists yet. The feed marks these `event_status:
// "Interrupted"` with `event_live: 0` — NOT live (nothing is being played right
// now) and NOT finished (no event_winner). They still carry the full
// `statistics` block up to the moment play stopped, so the box score is real —
// it's simply frozen until play resumes. Deliberately kept OUT of the
// Finished/Retired/Walk Over lists used by the career-record aggregates: an
// undecided match must never count toward a win/loss record.
const INTERRUPTED_STATUSES = ['Interrupted', 'Suspended'];
const isInterruptedFixture = f => INTERRUPTED_STATUSES.includes(f.event_status);

function buildFinalScore(fixture) {
  if (!Array.isArray(fixture.scores) || fixture.scores.length === 0) return null;
  const sorted = [...fixture.scores].sort((a, b) => Number(a.score_set) - Number(b.score_set));
  const sets = sorted.map(s => formatSetScore(s.score_first, s.score_second));
  if (sets.some(s => s === null)) return null;
  const p1Sets = sets.filter(s => s.p1 > s.p2).length;
  const p2Sets = sets.filter(s => s.p2 > s.p1).length;
  const winner = fixture.event_winner === 'First Player' ? 'p1'
    : fixture.event_winner === 'Second Player' ? 'p2' : null;
  return {
    display: sets.map(s => s.display).join(', '),
    sets: sets.map(s => ({ p1: s.p1, p2: s.p2 })),
    p1Sets,
    p2Sets,
    winner,
  };
}

// Real per-match box-score stats (distinct from EXTRA_STAT_DEFS above, which
// aggregates across many matches for a season-level view). These come from
// the same fixture's own `statistics` array, filtered to stat_period==='match'
// (the API also returns per-set rows under the same stat names, which must be
// excluded here to avoid mixing set-level and match-level numbers). Matched
// case-insensitively since the API's stat_name casing is inconsistent
// (confirmed live: '1st serve percentage' lowercase vs 'Break Points Saved'
// capitalized).
const MATCH_STAT_DEFS = [
  { type: 'Service', name: 'Aces', kind: 'count' },
  { type: 'Service', name: 'Double Faults', kind: 'count' },
  { type: 'Service', name: '1st serve percentage', kind: 'pctDirect' },
  { type: 'Service', name: '1st serve points won', kind: 'pct' },
  { type: 'Service', name: '2nd serve points won', kind: 'pct' },
  { type: 'Service', name: 'Break Points Saved', kind: 'pct' },
  { type: 'Return', name: '1st return points won', kind: 'pct' },
  { type: 'Return', name: '2nd return points won', kind: 'pct' },
  { type: 'Return', name: 'Break Points Converted', kind: 'pct' },
  { type: 'Points', name: 'Winners', kind: 'count' },
  { type: 'Points', name: 'Unforced errors', kind: 'count' },
  { type: 'Points', name: 'Total Points Won', kind: 'pct' },
];

// Shared by buildMatchStatsFromFixture() and buildTournamentProgression() —
// finds one player's raw stat row for a given stat_type/stat_name within an
// already stat_period==='match'-filtered list, matched case-insensitively
// (API casing is inconsistent — confirmed live).
function findMatchStat(matchStats, playerKey, type, name) {
  return matchStats.find(s =>
    String(s.player_key) === String(playerKey) &&
    s.stat_type === type &&
    String(s.stat_name).toLowerCase() === name.toLowerCase()
  );
}

// Extracts both players' box scores out of an already period-filtered list of
// raw `statistics` rows. Period-agnostic on purpose: the match sheet and each
// per-set sheet are the identical shape built from identical stat defs, so
// they share one extractor rather than two drifting copies.
function extractStatPairFromRows(rows, p1Key, p2Key) {
  const extractFor = playerKey => {
    const out = {};
    // Raw won/total counts behind the ratio-based (`pct`) stats, kept so the
    // UI can show the real fraction (e.g. Break Points Saved "(1/1) 100%")
    // instead of only the derived percentage. Only populated when the API
    // actually returns both stat_won and stat_total for that stat.
    const raw = {};
    for (const def of MATCH_STAT_DEFS) {
      const stat = findMatchStat(rows, playerKey, def.type, def.name);
      if (!stat) continue;
      const key = `${def.type}:${def.name}`;
      if (def.kind === 'pct') {
        out[key] = stat.stat_total > 0 ? Math.round((stat.stat_won / stat.stat_total) * 1000) / 10 : null;
        const won = parseInt(stat.stat_won, 10);
        const total = parseInt(stat.stat_total, 10);
        if (Number.isFinite(won) && Number.isFinite(total) && total > 0) {
          raw[key] = { won, total };
        }
      } else if (def.kind === 'pctDirect') {
        const n = parseFloat(stat.stat_value);
        out[key] = Number.isFinite(n) ? n : null;
      } else {
        out[key] = parseInt(stat.stat_value, 10) || 0;
      }
    }
    if (Object.keys(raw).length > 0) out.raw = raw;
    return out;
  };

  const p1 = extractFor(p1Key);
  const p2 = extractFor(p2Key);
  if (Object.keys(p1).length === 0 && Object.keys(p2).length === 0) return null;
  return { p1, p2 };
}

function buildMatchStatsFromFixture(fixture, p1Key, p2Key) {
  if (!Array.isArray(fixture.statistics) || fixture.statistics.length === 0) return null;
  const matchStats = fixture.statistics.filter(s => s.stat_period === 'match');
  if (matchStats.length === 0) return null;
  return extractStatPairFromRows(matchStats, p1Key, p2Key);
}

// Per-set box scores, from the same fixture's `statistics` array — the rows the
// match sheet deliberately drops. Confirmed live against api-tennis: alongside
// stat_period 'match' the feed emits 'set1', 'set2', ... carrying the same
// stat names (and the same stat_won/stat_total behind the ratio stats), and
// the per-set counts reconcile exactly to the match totals (verified on real
// fixtures: aces 4+3+4=11; winners 18+11=29). Two real gaps, flagged rather
// than filled: 'Points:Last 10 balls' is match-only (it has no per-set
// meaning), and a set still in progress is simply absent until the feed
// publishes it.
//
// Returns { '1': {p1,p2}, '2': {p1,p2}, ... } keyed by set number, or null when
// the feed carries no per-set rows for this match (older/lower-tier fixtures) —
// null is the signal for the UI to hide the set selector rather than invent one.
function buildSetStatsFromFixture(fixture, p1Key, p2Key) {
  if (!Array.isArray(fixture.statistics) || fixture.statistics.length === 0) return null;
  const bySet = new Map();
  for (const s of fixture.statistics) {
    const m = /^set\s*(\d+)$/i.exec(String(s.stat_period || '').trim());
    if (!m) continue;
    const setNo = parseInt(m[1], 10);
    if (!Number.isFinite(setNo) || setNo < 1) continue;
    if (!bySet.has(setNo)) bySet.set(setNo, []);
    bySet.get(setNo).push(s);
  }
  if (bySet.size === 0) return null;
  const out = {};
  for (const setNo of [...bySet.keys()].sort((a, b) => a - b)) {
    const pair = extractStatPairFromRows(bySet.get(setNo), p1Key, p2Key);
    if (pair) out[String(setNo)] = pair;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// =================================================================
// HISTORICAL MATCH STATS — real per-match box scores for the Form-tab
// recent-form matches (not just the small set of top-level tracked
// matches). Finished matches never change, so this cache has no TTL:
// once an eventKey is fetched (success or genuine provider miss), it's
// never re-fetched.
// =================================================================
const HISTORICAL_STATS_CACHE_PATH = 'historical-match-stats.json';

function loadHistoricalStatsCache() {
  if (fs.existsSync(HISTORICAL_STATS_CACHE_PATH)) {
    return JSON.parse(fs.readFileSync(HISTORICAL_STATS_CACHE_PATH, 'utf8'));
  }
  return {};
}

async function fetchFixtureByMatchKey(matchKey) {
  const url = `${API_TENNIS_BASE}?method=get_fixtures&APIkey=${API_TENNIS_KEY}&match_key=${matchKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.success) return null;
  return data.result?.[0] || null;
}

// =================================================================
// PLAYER TOURNAMENT PROGRESSION — round-by-round stat trend for players
// in the currently active tournament(s), plus a per-round field-average
// benchmark computed across every finished match in the draw. Distinct
// from both MATCH_STAT_DEFS (one match's box score) and EXTRA_STAT_DEFS
// (season-level aggregate): this tracks ONE tournament edition's real
// per-round numbers, consumed by the Match Analysis modal's Progression
// tab for the two players in whichever match is being analyzed.
// =================================================================
const PROGRESSION_WINDOW_DAYS = 15; // longest real ATP main draw runs ~13 days (Slam R1->F), confirmed elsewhere in this file

function isFinalRoundLabel(round) { return isFinalRound(round); }

// Labels a chronologically-sorted list of distinct round strings as
// R1, R2, R3... / QF / SF / F, without assuming a fixed draw size. Walks
// from the end so it works whether this tournament ever has 5 rounds
// (ATP 250, 32-draw) or 7 rounds (Slam, 128-draw).
// The feed reports tournament_round as null or '' for team events (Davis Cup,
// BJK Cup), UTS exhibitions and some ITF draws, so never call a string method
// on it directly.
function roundText(round) { return typeof round === 'string' ? round.toLowerCase() : ''; }

function labelRounds(sortedRoundStrings) {
  const labels = new Array(sortedRoundStrings.length);
  let i = sortedRoundStrings.length - 1;
  if (i >= 0 && isFinalRoundLabel(sortedRoundStrings[i])) { labels[i] = 'F'; i--; }
  if (i >= 0 && roundText(sortedRoundStrings[i]).includes('semi')) { labels[i] = 'SF'; i--; }
  if (i >= 0 && roundText(sortedRoundStrings[i]).includes('quarter')) { labels[i] = 'QF'; i--; }
  let n = 1;
  for (let j = 0; j <= i; j++) labels[j] = `R${n++}`;
  return labels;
}

const PROGRESSION_METRIC_DEFS = [
  { key: 'firstServePct', type: 'Service', name: '1st serve percentage', kind: 'pctDirect' },
  { key: 'firstServeWonPct', type: 'Service', name: '1st serve points won', kind: 'pct' },
  { key: 'secondServeWonPct', type: 'Service', name: '2nd serve points won', kind: 'pct' },
  { key: 'winners', type: 'Points', name: 'Winners', kind: 'count' },
  { key: 'unforcedErrors', type: 'Points', name: 'Unforced errors', kind: 'count' },
  { key: 'totalPointsWonPct', type: 'Points', name: 'Total Points Won', kind: 'pct' },
];

const PROGRESSION_DERIVED_METRIC_KEYS = [
  'firstServePct', 'firstServeWonPct', 'secondServeWonPct',
  'winnersPct', 'unforcedErrorsPct', 'winnersUnforcedRatio',
  'totalPointsWonPct',
];

// Extracts the 6 derived progression metrics for one player from one
// match's already stat_period==='match'-filtered statistics list. Shared
// by the per-player round loop and the per-round field-average aggregator
// below so both use exactly the same derivation logic.
function extractProgressionMetrics(matchStats, playerKey, fallbackCtx) {
  const metrics = {};
  for (const def of PROGRESSION_METRIC_DEFS) {
    const stat = findMatchStat(matchStats, playerKey, def.type, def.name);
    if (!stat) { metrics[def.key] = null; continue; }
    if (def.kind === 'pct') {
      metrics[def.key] = stat.stat_total > 0 ? Math.round((stat.stat_won / stat.stat_total) * 1000) / 10 : null;
    } else if (def.kind === 'pctDirect') {
      const n = parseFloat(stat.stat_value);
      metrics[def.key] = Number.isFinite(n) ? n : null;
    } else {
      metrics[def.key] = parseInt(stat.stat_value, 10) || 0;
    }
  }

  // Layer #8 W/UE source priority for the Tournament Reports charts. The round
  // comparison + player progression views read winners/UE straight from the raw
  // api-tennis stat sheet, which carries NO Winners/Unforced Errors for the
  // ~20% ATP-250 gap (Estoril, Kitzbühel) — leaving those bars and their
  // field-average line empty. When (and only when) api-tennis has neither value
  // for this player, fall back to the reviewed @ATP_Entry OCR corpus, honouring
  // the same strict priority + never-mix rule as attachWue(). Flagged wueSource.
  let wueSource = (metrics.winners != null && metrics.unforcedErrors != null) ? 'api-tennis' : null;
  if (wueSource == null && fallbackCtx) {
    const fb = lookupWue(fallbackCtx.tour, fallbackCtx.playerName, fallbackCtx.opponentName);
    if (fb) { metrics.winners = fb.winners; metrics.unforcedErrors = fb.unforcedErrors; wueSource = 'ATP_Entry_OCR'; }
  }

  // winnersPct / unforcedErrorsPct need total points played as the denominator.
  // That row (Total Points Won) is on every stat sheet even for fixtures missing
  // W/UE, so it is available for OCR-sourced matches too. It is a point count,
  // not a W/UE stat, so pairing it with OCR winners/UE does not mix W/UE sources.
  const totalPoints = metrics.winners != null && metrics.unforcedErrors != null
    ? findMatchStat(matchStats, playerKey, 'Points', 'Total Points Won')
    : null;
  const totalPointsPlayed = totalPoints && totalPoints.stat_total > 0 ? totalPoints.stat_total : null;
  return {
    firstServePct: metrics.firstServePct,
    firstServeWonPct: metrics.firstServeWonPct,
    secondServeWonPct: metrics.secondServeWonPct,
    winnersPct: totalPointsPlayed ? Math.round((metrics.winners / totalPointsPlayed) * 1000) / 10 : null,
    unforcedErrorsPct: totalPointsPlayed ? Math.round((metrics.unforcedErrors / totalPointsPlayed) * 1000) / 10 : null,
    winnersUnforcedRatio: (metrics.unforcedErrors != null && metrics.unforcedErrors > 0 && metrics.winners != null)
      ? Math.round((metrics.winners / metrics.unforcedErrors) * 100) / 100
      : null,
    // Share of all points played that the player won — already derived from the
    // feed's own won/total, so it needs no winners/UE data (which this feed is
    // routinely missing) and is populated for every match that has a stat sheet.
    totalPointsWonPct: metrics.totalPointsWonPct,
    // Provenance of the winners/UE-derived metrics: 'api-tennis', 'ATP_Entry_OCR',
    // or null (neither source had W/UE — those three metrics stay null).
    wueSource,
  };
}

function average(nums) {
  const real = nums.filter(n => n != null && Number.isFinite(n));
  if (real.length === 0) return null;
  return Math.round((real.reduce((a, b) => a + b, 0) / real.length) * 100) / 100;
}

// The bulk get_fixtures endpoint hard-caps any single query at a 7-day date
// range — an over-wide range returns the error STRING "Maximum date range for
// odds is 7 days." as `result` (not an array). PROGRESSION_WINDOW_DAYS is
// deliberately wider (a ~2-week main draw), so fetch the window in <=7-day
// chunks and merge, deduped by event_key. Memoized per (start,stop) so the
// several per-tournament progression builds in one run share one set of calls.
// Returns null only if EVERY chunk failed (so the caller can bail); an empty
// array means "queried fine, no fixtures".
const _progressionFixturesCache = new Map();
async function fetchProgressionFixtures(windowStart, today) {
  const dateStr = d => d.toISOString().split('T')[0];
  const cacheKey = `${dateStr(windowStart)}|${dateStr(today)}`;
  if (_progressionFixturesCache.has(cacheKey)) return _progressionFixturesCache.get(cacheKey);
  const CHUNK_MS = 7 * 86400000; // API hard limit: 7-day max range per call
  const byKey = new Map();
  let anySuccess = false;
  for (let s = new Date(windowStart); s < today; s = new Date(s.getTime() + CHUNK_MS + 86400000)) {
    const e = new Date(Math.min(s.getTime() + CHUNK_MS, today.getTime()));
    const url = `${API_TENNIS_BASE}?method=get_fixtures&APIkey=${API_TENNIS_KEY}&date_start=${dateStr(s)}&date_stop=${dateStr(e)}&event_type_key=265`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (Array.isArray(data.result)) {
        anySuccess = true;
        for (const f of data.result) if (f && f.event_key != null) byKey.set(f.event_key, f);
      } else {
        console.error(`Progression fixtures ${dateStr(s)}..${dateStr(e)} returned non-array:`, JSON.stringify(data.result).slice(0, 80));
      }
    } catch (err) {
      console.error(`Progression fixtures ${dateStr(s)}..${dateStr(e)} failed:`, err.message);
    }
  }
  const merged = anySuccess ? [...byKey.values()] : null;
  _progressionFixturesCache.set(cacheKey, merged);
  return merged;
}

async function buildTournamentProgression(tourName) {
  const bareName = tourName.replace(/^ATP\s+/, '').trim();
  const today = new Date();
  const windowStart = new Date(today.getTime() - PROGRESSION_WINDOW_DAYS * 86400000);

  const fixtures = await fetchProgressionFixtures(windowStart, today);
  if (!fixtures) return null;

  const played = fixtures.filter(f =>
    f.tournament_name && f.tournament_name.includes(bareName) &&
    // A round-less fixture cannot sit anywhere on the ladder; keeping it would
    // add a phantom leading round and shift every real label by one.
    typeof f.tournament_round === 'string' && f.tournament_round.trim() !== '' &&
    f.event_qualification !== 'True' &&
    (f.event_winner === 'First Player' || f.event_winner === 'Second Player')
  );
  if (played.length === 0) return null;

  const roundOrder = [...new Set(played.map(f => f.tournament_round))]
    .map(round => ({ round, minDate: played.filter(f => f.tournament_round === round).reduce((min, f) => f.event_date < min ? f.event_date : min, '9999-99-99') }))
    .sort((a, b) => a.minDate < b.minDate ? -1 : a.minDate > b.minDate ? 1 : 0)
    .map(r => r.round);
  const roundLabels = labelRounds(roundOrder);
  const roundLabelByName = {};
  roundOrder.forEach((round, i) => { roundLabelByName[round] = roundLabels[i]; });

  // Group each player's matches by player_key, tracking whether they've lost.
  const byPlayer = {}; // playerKey -> { name, matches: [...], eliminated: bool }
  for (const f of played) {
    const p1Key = f.first_player_key, p2Key = f.second_player_key;
    const p1Won = f.event_winner === 'First Player';
    for (const [key, name, won] of [[p1Key, f.event_first_player, p1Won], [p2Key, f.event_second_player, !p1Won]]) {
      if (!byPlayer[key]) byPlayer[key] = { name, matches: [], eliminated: false };
      byPlayer[key].matches.push({ fixture: f, won, opponent: key === p1Key ? f.event_second_player : f.event_first_player });
      if (!won) byPlayer[key].eliminated = true;
    }
  }

  const players = [];
  for (const [playerKey, info] of Object.entries(byPlayer)) {
    // Include eliminated players too — the Match Analysis modal's Progression
    // tab needs both match participants even if one already lost.
    const sortedMatches = [...info.matches].sort((a, b) => a.fixture.event_date < b.fixture.event_date ? -1 : 1);
    const rounds = [];
    for (const { fixture, opponent } of sortedMatches) {
      if (!Array.isArray(fixture.statistics) || fixture.statistics.length === 0) continue;
      const matchStats = fixture.statistics.filter(s => s.stat_period === 'match');
      if (matchStats.length === 0) continue;
      const metrics = extractProgressionMetrics(matchStats, playerKey, {
        tour: fixture.tournament_name, playerName: info.name, opponentName: opponent,
      });
      rounds.push({
        round: roundLabelByName[fixture.tournament_round] || fixture.tournament_round,
        opponent,
        resultDisplay: fixture.event_final_result || null,
        metrics,
      });
    }
    if (rounds.length > 0) players.push({ name: info.name, playerKey, eliminated: info.eliminated, rounds });
  }
  if (players.length === 0) return null;

  // Field average: for every round, average the 6 derived metrics across
  // BOTH players of every finished fixture at that round (real full-draw
  // aggregate — `played` already contains every finished match, not just
  // still-alive players, so no extra fetching is needed).
  const fieldAverageMetrics = {};
  for (const key of PROGRESSION_DERIVED_METRIC_KEYS) fieldAverageMetrics[key] = [];
  const fieldSampleSize = [];
  for (const round of roundOrder) {
    const roundFixtures = played.filter(f => f.tournament_round === round);
    const perMetricValues = {};
    for (const key of PROGRESSION_DERIVED_METRIC_KEYS) perMetricValues[key] = [];
    let sampleCount = 0;
    for (const f of roundFixtures) {
      if (!Array.isArray(f.statistics) || f.statistics.length === 0) continue;
      const matchStats = f.statistics.filter(s => s.stat_period === 'match');
      if (matchStats.length === 0) continue;
      for (const key of [f.first_player_key, f.second_player_key]) {
        const isFirst = key === f.first_player_key;
        const m = extractProgressionMetrics(matchStats, key, {
          tour: f.tournament_name,
          playerName: isFirst ? f.event_first_player : f.event_second_player,
          opponentName: isFirst ? f.event_second_player : f.event_first_player,
        });
        for (const metricKey of PROGRESSION_DERIVED_METRIC_KEYS) perMetricValues[metricKey].push(m[metricKey]);
        sampleCount++;
      }
    }
    for (const key of PROGRESSION_DERIVED_METRIC_KEYS) fieldAverageMetrics[key].push(average(perMetricValues[key]));
    fieldSampleSize.push(sampleCount);
  }

  return {
    rounds: roundLabels,
    players,
    fieldAverage: { rounds: roundLabels, metrics: fieldAverageMetrics, sampleSize: fieldSampleSize },
  };
}

// Task 4: api-tennis' get_odds carries real per-book Home/Away prices for BOTH
// finished matches (prices survive after the match ends, unlike the-odds-api
// which drops completed events) and upcoming ones — so completed cards can show
// odds like upcoming cards, and upcoming cards keep odds even when the-odds-api
// has no active tennis market. Home = event_first_player (= match.p1), Away =
// event_second_player (= match.p2). We pick a reference bookmaker for the
// headline `odds` and the highest price per side for `bestOdds`, mirroring the
// odds-event shape so the dashboard renders them identically.
async function fetchApiTennisMatchOdds(eventKey) {
  try {
    const url = `${API_TENNIS_BASE}?method=get_odds&APIkey=${API_TENNIS_KEY}&match_key=${eventKey}`;
    const data = await (await fetch(url)).json();
    const ha = data && data.result && data.result[eventKey] && data.result[eventKey]['Home/Away'];
    if (!ha || !ha.Home || !ha.Away) return null;
    const books = Object.keys(ha.Home).filter(b => ha.Away[b] != null);
    if (!books.length) return null;
    const prefer = ['bet365', 'Pncl', 'Betfair', 'Unibet', 'WilliamHill', 'Marathon'];
    const ref = prefer.find(b => books.includes(b)) || books[0];
    const p1 = parseFloat(ha.Home[ref]);
    const p2 = parseFloat(ha.Away[ref]);
    if (!(p1 > 0) || !(p2 > 0)) return null;
    // bestOdds mirrors the upcoming-match shape: { price, bookmaker } per side,
    // the single highest price on offer across the books (best value for a bettor).
    const bestSide = side => {
      let bestBook = null, bestPrice = 0;
      for (const b of books) { const v = parseFloat(ha[side][b]); if (v > bestPrice) { bestPrice = v; bestBook = b; } }
      return bestBook ? { price: bestPrice, bookmaker: bestBook } : null;
    };
    return {
      odds: { p1, p2, bookmaker: ref },
      bestOdds: { p1: bestSide('Home'), p2: bestSide('Away') },
    };
  } catch (e) {
    console.error('Finished-match odds fetch failed for', eventKey, '-', e.message);
    return null;
  }
}

async function buildPastMatchObject(fixture, surfaceMap, venueMap) {
  const surface = surfaceMap.get(String(fixture.tournament_key)) || 'hard';
  // Task 6: the same builder also handles suspended matches. Everything about
  // them is identical to a completed match (real stats, real per-set score, real
  // odds) EXCEPT that there's no result — so the score goes on `partialScore`
  // and `finalScore` stays null. That split is load-bearing: `finalScore` is what
  // every "this match is decided" code path keys off (winner tick, Past tab,
  // point-by-point, career records), and none of those may fire without a result.
  const interrupted = isInterruptedFixture(fixture);
  // Same real, already-provided-by-the-API string format used by h2hRoundLabel()
  // client-side ("ATP <Name> - <Round>") — take the tournament-name segment.
  const tour = fixture.tournament_round
    ? fixture.tournament_round.split(' - ')[0].trim()
    : `ATP ${fixture.tournament_name}`;

  const p1Key = fixture.first_player_key;
  const p2Key = fixture.second_player_key;

  const match = {
    id: `past-${fixture.event_key}`,
    day: computeDay(fixture.event_date),
    date: fixture.event_date,
    time: fixture.event_time || null,
    p1: fixture.event_first_player,
    p2: fixture.event_second_player,
    p1PhotoUrl: fixture.event_first_player_logo || null,
    p2PhotoUrl: fixture.event_second_player_logo || null,
    tour,
    tourBadge: 'ATP', // event_type_key=265 = ATP Singles only, same filter used everywhere else
    surface,
    style: 'TBD',
    value: null,
    // Default null; populated below from api-tennis get_odds (Task 4 — finished
    // matches keep their pre-match markets, so completed cards show odds too).
    odds: { p1: null, p2: null, bookmaker: null },
    bestOdds: { p1: null, p2: null },
    tournamentRound: fixture.tournament_round,
    p1Key,
    p2Key,
    h2h: null,
    p1SurfaceWinRate: null,
    p2SurfaceWinRate: null,
    p1Rank: null,
    p2Rank: null,
    p1RecentForm: null,
    p2RecentForm: null,
    p1RecentFormMatches: null,
    p2RecentFormMatches: null,
    p1SeasonSurface: null,
    p2SeasonSurface: null,
    p1Yearly: null,
    p2Yearly: null,
    p1TournamentHistory: null,
    p2TournamentHistory: null,
    extraStats: null,
    venue: null,
    courtSpeed: null,
    // Default null; populated below via fetchMatchWeather, which falls back to
    // Open-Meteo's historical archive (ERA5) for past match dates outside the
    // forecast window (Task 3 — completed matches show the real weather on the
    // day they were played, flagged `historical`).
    weather: null,
    live: false,
    liveStatus: interrupted ? fixture.event_status : null,
    liveScore: null,
    liveGameScore: null,
    liveServer: null,
    interrupted,
    // Score at the moment play stopped, same shape/format as finalScore (so the
    // card and modal render it identically) but with winner forced null — the
    // feed leaves event_winner unset for a suspended match and we never infer one.
    partialScore: interrupted ? (sc => sc && { ...sc, winner: null })(buildFinalScore(fixture)) : null,
    finalScore: interrupted ? null : buildFinalScore(fixture),
    matchStats: buildMatchStatsFromFixture(fixture, p1Key, p2Key),
    setStats: buildSetStatsFromFixture(fixture, p1Key, p2Key),
  };

  // Layer #8 Winners/Unforced-Errors: resolve the per-match source with the
  // founder's strict priority (api-tennis primary; @ATP_Entry OCR fallback for
  // the ATP-250 gap; never mixed), flagging `matchStats.wueSource` + each
  // player's `wue.source`. No-op for matches with no stat sheet.
  attachWue(match.matchStats, match.tour, match.p1, match.p2);

  const hintKey = Object.keys(TOURNAMENT_VENUE_HINTS).find(k => fixture.tournament_name.includes(k));
  const hint = hintKey ? TOURNAMENT_VENUE_HINTS[hintKey] : null;
  match.venue = hint ? { city: hint.city, country: hint.country, category: hint.category, indoor: hint.indoor } : null;

  const courtConditions = hintKey ? COURT_CONDITIONS[hintKey] : null;
  match.courtSpeed = courtConditions
    ? { ...courtConditions, category: courtSpeedCategory(courtConditions.speed) }
    : null;

  // Task 3 — real weather on the day the match was played (historical archive
  // fallback lives inside fetchMatchWeather). Task 4 — pre-match odds recovered
  // from api-tennis get_odds so completed cards show odds like upcoming ones.
  const pastMatchDateTime = `${fixture.event_date}T${(fixture.event_time || '12:00')}:00Z`;
  const [pastWeather, pastOdds] = await Promise.all([
    venueMap ? fetchMatchWeather(tour, pastMatchDateTime, venueMap) : Promise.resolve(null),
    fetchApiTennisMatchOdds(fixture.event_key),
  ]);
  match.weather = pastWeather;
  if (pastOdds) {
    match.odds = pastOdds.odds;
    match.bestOdds = pastOdds.bestOdds;
  }

  const h2hData = await fetchH2H(p1Key, p2Key);
  if (h2hData) {
    match.h2h = summarizeH2H(h2hData.headToHead, match.p1);
    match.h2h.matches = buildH2HMatchList(h2hData.headToHead, match.p1, surfaceMap);
    const [p1Form, p2Form] = await Promise.all([
      buildRecentFormForMatch(p1Key, surfaceMap),
      buildRecentFormForMatch(p2Key, surfaceMap),
    ]);
    match.p1RecentForm = p1Form.pct;
    match.p2RecentForm = p2Form.pct;
    match.p1RecentFormMatches = p1Form.matches;
    match.p2RecentFormMatches = p2Form.matches;
  }

  const [p1Stats, p2Stats] = await Promise.all([
    fetchPlayerStats(p1Key),
    fetchPlayerStats(p2Key),
  ]);
  match.p1SurfaceWinRate = surfaceWinRate(p1Stats, surface);
  match.p2SurfaceWinRate = surfaceWinRate(p2Stats, surface);
  match.p1Rank = currentSinglesRank(p1Stats);
  match.p2Rank = currentSinglesRank(p2Stats);

  const currentYear = new Date().getFullYear();
  const [p1CurrentFixtures, p2CurrentFixtures] = await Promise.all([
    fetchPlayerFixturesForYear(p1Key, currentYear),
    fetchPlayerFixturesForYear(p2Key, currentYear),
  ]);
  // All-tier fixtures (ATP + Challenger + ITF, ~5 seasons) — memoized, so one
  // fetch per player is shared by the yearly table AND the season-surface block
  // below (no extra API calls). p1CurrentFixtures stays fetched above for the
  // extra-stats reuse further down.
  const p1AllTierFix = await fetchRecentSinglesFixtures(p1Key);
  const p2AllTierFix = await fetchRecentSinglesFixtures(p2Key);

  // Year-by-year record: all-tier (ATP + Challenger + ITF) for the seasons the
  // fetch covers (currentYear-5..now); ATP-only provider aggregates (flagged)
  // for earlier seasons where no all-tier match data exists.
  match.p1Yearly = buildAllTierYearly(p1AllTierFix, p1Key, p1Stats, currentYear, surfaceMap);
  match.p2Yearly = buildAllTierYearly(p2AllTierFix, p2Key, p2Stats, currentYear, surfaceMap);

  // All-tier current-season surface record (ATP vs Challenger&ITF) with each
  // surface's match list, for the Overview season-surface tier filter + click
  // drill-down. Same memoized fetch, filtered to the current season.
  match.p1SeasonSurface = seasonSurfaceByTier(p1AllTierFix, p1Key, currentYear, surfaceMap);
  match.p2SeasonSurface = seasonSurfaceByTier(p2AllTierFix, p2Key, currentYear, surfaceMap);

  match.extraStats = await buildExtraStats(p1Key, p2Key, surface, surfaceMap, p1CurrentFixtures, p2CurrentFixtures, match.courtSpeed ? match.courtSpeed.category : null);

  if (hintKey) {
    const [p1TournMatches, p2TournMatches] = await Promise.all([
      fetchPlayerTournamentMatches(p1Key, hintKey),
      fetchPlayerTournamentMatches(p2Key, hintKey),
    ]);
    match.p1TournamentHistory = buildTournamentHistory(p1TournMatches, p1Key);
    match.p2TournamentHistory = buildTournamentHistory(p2TournMatches, p2Key);
  }

  return match;
}

// =================================================================
// UPCOMING fixture-only matches — scheduled matches that exist in
// API-Tennis get_fixtures but have NO betting-odds event yet (a bookmaker
// hasn't opened markets). The odds-driven Today/Tomorrow tabs are built
// only from fetchAllTennisEvents(), so these would otherwise never appear
// until odds are published. This forward-looking sibling of
// buildPastMatchObject() surfaces them the moment they're in the fixtures
// feed (odds stay null → the UI renders them "coming soon", same as any
// odds-driven match with no markets yet, see buildMatchObject). No
// finalScore/matchStats since the match hasn't been played.
// =================================================================
async function buildUpcomingMatchObject(fixture, surfaceMap, venueMap) {
  const surface = surfaceMap.get(String(fixture.tournament_key)) || 'hard';
  const tour = fixture.tournament_round
    ? fixture.tournament_round.split(' - ')[0].trim()
    : `ATP ${fixture.tournament_name}`;

  const p1Key = fixture.first_player_key;
  const p2Key = fixture.second_player_key;

  // Combine event_date + event_time so computeDay() gets a real datetime.
  // Passing date-only would land a not-yet-played match at 00:00, which
  // computeDay classifies as 'past' (matchDate < now) for today's fixtures.
  const commence = `${fixture.event_date}T${fixture.event_time || '00:00'}:00`;

  const match = {
    id: `upcoming-${fixture.event_key}`,
    day: computeDay(commence),
    date: fixture.event_date,
    time: fixture.event_time || null,
    p1: fixture.event_first_player,
    p2: fixture.event_second_player,
    tour,
    tourBadge: 'ATP', // event_type_key=265 = ATP Singles only
    surface,
    style: 'TBD',
    value: null,
    // No betting markets exist yet for this fixture — same null shape a
    // no-market odds event produces, which the UI already handles.
    odds: { p1: null, p2: null, bookmaker: null },
    bestOdds: { p1: null, p2: null },
    tournamentRound: fixture.tournament_round,
    p1Key,
    p2Key,
    h2h: null,
    p1SurfaceWinRate: null,
    p2SurfaceWinRate: null,
    p1Rank: null,
    p2Rank: null,
    p1RecentForm: null,
    p2RecentForm: null,
    p1RecentFormMatches: null,
    p2RecentFormMatches: null,
    p1SeasonSurface: null,
    p2SeasonSurface: null,
    p1Yearly: null,
    p2Yearly: null,
    p1TournamentHistory: null,
    p2TournamentHistory: null,
    extraStats: null,
    matchStats: null,
    setStats: null,
    venue: null,
    courtSpeed: null,
    weather: null,
    live: false,
    liveStatus: null,
    liveScore: null,
    liveGameScore: null,
    liveServer: null,
    p1PhotoUrl: fixture.event_first_player_logo || null,
    p2PhotoUrl: fixture.event_second_player_logo || null,
  };

  // Weather is forward-looking here (unlike past matches), so it's fetched.
  match.weather = await fetchMatchWeather(tour, commence, venueMap);

  // Odds from api-tennis get_odds — a fixture-only card has no the-odds-api
  // event, but api-tennis usually already carries a pre-match Home/Away market.
  // Keeps odds visible even when the-odds-api has no active tennis sport.
  const upOdds = await fetchApiTennisMatchOdds(fixture.event_key);
  if (upOdds) {
    match.odds = upOdds.odds;
    match.bestOdds = upOdds.bestOdds;
  }

  const hintKey = Object.keys(TOURNAMENT_VENUE_HINTS).find(k => fixture.tournament_name.includes(k));
  const hint = hintKey ? TOURNAMENT_VENUE_HINTS[hintKey] : null;
  match.venue = hint ? { city: hint.city, country: hint.country, category: hint.category, indoor: hint.indoor } : null;

  const courtConditions = hintKey ? COURT_CONDITIONS[hintKey] : null;
  match.courtSpeed = courtConditions
    ? { ...courtConditions, category: courtSpeedCategory(courtConditions.speed) }
    : null;

  const h2hData = await fetchH2H(p1Key, p2Key);
  if (h2hData) {
    match.h2h = summarizeH2H(h2hData.headToHead, match.p1);
    match.h2h.matches = buildH2HMatchList(h2hData.headToHead, match.p1, surfaceMap);
    const [p1Form, p2Form] = await Promise.all([
      buildRecentFormForMatch(p1Key, surfaceMap),
      buildRecentFormForMatch(p2Key, surfaceMap),
    ]);
    match.p1RecentForm = p1Form.pct;
    match.p2RecentForm = p2Form.pct;
    match.p1RecentFormMatches = p1Form.matches;
    match.p2RecentFormMatches = p2Form.matches;
  }

  const [p1Stats, p2Stats] = await Promise.all([
    fetchPlayerStats(p1Key),
    fetchPlayerStats(p2Key),
  ]);
  match.p1SurfaceWinRate = surfaceWinRate(p1Stats, surface);
  match.p2SurfaceWinRate = surfaceWinRate(p2Stats, surface);
  match.p1Rank = currentSinglesRank(p1Stats);
  match.p2Rank = currentSinglesRank(p2Stats);

  const currentYear = new Date().getFullYear();
  const [p1CurrentFixtures, p2CurrentFixtures] = await Promise.all([
    fetchPlayerFixturesForYear(p1Key, currentYear),
    fetchPlayerFixturesForYear(p2Key, currentYear),
  ]);
  // All-tier fixtures (ATP + Challenger + ITF, ~5 seasons) — memoized, so one
  // fetch per player is shared by the yearly table AND the season-surface block
  // below (no extra API calls). p1CurrentFixtures stays fetched above for the
  // extra-stats reuse further down.
  const p1AllTierFix = await fetchRecentSinglesFixtures(p1Key);
  const p2AllTierFix = await fetchRecentSinglesFixtures(p2Key);

  // Year-by-year record: all-tier (ATP + Challenger + ITF) for the seasons the
  // fetch covers (currentYear-5..now); ATP-only provider aggregates (flagged)
  // for earlier seasons where no all-tier match data exists.
  match.p1Yearly = buildAllTierYearly(p1AllTierFix, p1Key, p1Stats, currentYear, surfaceMap);
  match.p2Yearly = buildAllTierYearly(p2AllTierFix, p2Key, p2Stats, currentYear, surfaceMap);

  // All-tier current-season surface record (ATP vs Challenger&ITF) with each
  // surface's match list, for the Overview season-surface tier filter + click
  // drill-down. Same memoized fetch, filtered to the current season.
  match.p1SeasonSurface = seasonSurfaceByTier(p1AllTierFix, p1Key, currentYear, surfaceMap);
  match.p2SeasonSurface = seasonSurfaceByTier(p2AllTierFix, p2Key, currentYear, surfaceMap);

  match.extraStats = await buildExtraStats(p1Key, p2Key, surface, surfaceMap, p1CurrentFixtures, p2CurrentFixtures, match.courtSpeed ? match.courtSpeed.category : null);

  if (hintKey) {
    const [p1TournMatches, p2TournMatches] = await Promise.all([
      fetchPlayerTournamentMatches(p1Key, hintKey),
      fetchPlayerTournamentMatches(p2Key, hintKey),
    ]);
    match.p1TournamentHistory = buildTournamentHistory(p1TournMatches, p1Key);
    match.p2TournamentHistory = buildTournamentHistory(p2TournMatches, p2Key);
  }

  return match;
}

// =================================================================
// PLAYER PROFILES — a player-shaped (not match-shaped) view of the same
// real data already fetched for matches.json, built for the dedicated
// Player Profile page. Built once per pipeline run, for every player who
// appears in at least one match in this run's matches.json — same scope
// the rest of the app already uses (there is no standalone full-ATP-tour
// player roster endpoint at this API tier, confirmed).
//
// SCOPE, confirmed honestly rather than fabricated:
// - Ranking points, handedness/plays, and turned-pro year have no real
//   data source at this API tier (get_standings is schema-documented but
//   returns empty; no other endpoint carries these) — omitted entirely,
//   never guessed.
// - Player DNA has six axes to match the reference design's shape, but
//   only Serve/Return/Baseline/Clutch are backed by real per-match stats.
//   Net play and Movement have no real data source for the full tour at
//   this tier (confirmed against API-Tennis, Sportradar, Matchstat.com,
//   and open charted datasets) — both are always null here and rendered
//   client-side as an explicit "N/A" state, never a fabricated number.
// =================================================================
const DNA_AXES = ['serve', 'return', 'baseline', 'clutch']; // movement/netPlay excluded — no real values to average
const RAW_STAT_KEYS = [
  'Service:Aces', 'Service:Double Faults', 'Service:1st Serve Points Won',
  'Service:2nd Serve Points Won', 'Service:Break Points Saved',
  'Return:Break Points Converted', 'Points:Winners', 'Points:Unforced Errors',
  'Points:Service Points Won', 'Points:Return Points Won',
  // Mirrors EXTRA_STAT_DEFS — a key missing here still renders on the profile
  // card, just with no "Tour avg" next to it, unlike every neighbouring row.
  'Points:Total Points Won',
];

function clampPct(x) {
  return Math.max(0, Math.min(100, x));
}

// Fixed linear-bound normalization: maps a real stat value from [lo, hi]
// onto a 0-100 scale, clamped at the edges. Returns null (not 0) when the
// underlying stat itself is unavailable — never a fabricated score.
function scale(v, lo, hi) {
  if (v === null || v === undefined) return null;
  return clampPct(((v - lo) / (hi - lo)) * 100);
}

// Averages whichever of the given [value, lo, hi] triples have real
// (non-null) data; returns null only if every input is unavailable.
function blendScale(parts) {
  const scaled = parts.map(([v, lo, hi]) => scale(v, lo, hi)).filter(v => v !== null);
  if (scaled.length === 0) return null;
  return Math.round(scaled.reduce((a, b) => a + b, 0) / scaled.length);
}

function meanOf(values) {
  const nums = values.filter(v => v !== null && v !== undefined && !Number.isNaN(v));
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

// Maps real per-match aggregate stats (aggregateStatsFromFixtures output)
// to the reference design's 0-100 "Player DNA" percentile axes. Bounds are
// fixed, hand-set from realistic ATP tour ranges — consistent with the
// reference design's own disclaimer that these are "BSP model estimates":
// every input is a real, fetched stat, only the 0-100 scaling is modeled.
//   Serve   = blend of 1st-serve-won% [55-85], 2nd-serve-won% [35-60], aces/match [2-18]
//   Return  = blend of return-points-won% [25-45], break-points-converted% [25-55]
//   Baseline = blend of winners/match [10-35] and inverted unforced-errors/match [10-35]
//   Clutch  = blend of break-points-saved% [50-75], break-points-converted% [25-55]
//   Movement / Net play = always null (no real data source, rendered as N/A)
function computeDnaScores(aggStats) {
  const s = aggStats?.stats || null;
  if (!s) return { serve: null, return: null, baseline: null, movement: null, netPlay: null, clutch: null };

  const winnersScore = scale(s['Points:Winners'], 10, 35);
  const ueScore = scale(s['Points:Unforced Errors'], 10, 35);
  const baselineParts = [winnersScore, ueScore === null ? null : 100 - ueScore].filter(v => v !== null);
  const baseline = baselineParts.length
    ? Math.round(baselineParts.reduce((a, b) => a + b, 0) / baselineParts.length)
    : null;

  return {
    serve: blendScale([
      [s['Service:1st Serve Points Won'], 55, 85],
      [s['Service:2nd Serve Points Won'], 35, 60],
      [s['Service:Aces'], 2, 18],
    ]),
    return: blendScale([
      [s['Points:Return Points Won'], 25, 45],
      [s['Return:Break Points Converted'], 25, 55],
    ]),
    baseline,
    movement: null,
    netPlay: null,
    clutch: blendScale([
      [s['Service:Break Points Saved'], 50, 75],
      [s['Return:Break Points Converted'], 25, 55],
    ]),
  };
}

// Career (all-seasons) singles record for one surface — same singles-only,
// blank-vs-zero handling as surfaceWinRate(), but also exposes raw won/lost
// counts for the surface-performance cards' "267-62" style display.
function surfaceRecord(playerStats, surface) {
  const wonKey = `${surface}_won`;
  const lostKey = `${surface}_lost`;
  let won = 0, lost = 0;
  for (const season of playerStats?.stats || []) {
    if (season.type !== 'singles') continue;
    won += parseInt(season[wonKey], 10) || 0;
    lost += parseInt(season[lostKey], 10) || 0;
  }
  const total = won + lost;
  return { won, lost, winRate: total > 0 ? Math.round((won / total) * 1000) / 10 : null };
}

// Recent-form list for a single player, built from their own real fixtures
// across every tour tier (ATP + Challenger + ITF, see fetchRecentSinglesFixtures).
// This is the SINGLE source of truth for recent form everywhere: player
// profiles call it directly, and every match's Form tab reaches it through
// buildRecentFormForMatch(). get_H2H isn't used here because a standalone
// profile has no natural "opponent" to pair against; the wide fetch carries no
// event_type_key, so tour-tier scoping and the decided-match / qualifying-round
// filters are all applied client-side below.
// Per-set games for a recent-form row, oriented to the tracked player (`p`)
// rather than to the fixture's first player, so both Form columns read left to
// right as "my games vs theirs" regardless of which slot the player occupied.
// event_final_result only carries SETS won ("2 - 1"), so the set-by-set line the
// Form tab draws has to come from the fixture's own `scores` array — which the
// wide recent-form fetch already returns, so this costs no extra API call.
// Tiebreaks arrive encoded as "<games>.<tiebreakPoints>" (see formatSetScore);
// both sides' tiebreak points are kept here, since the Form tab superscripts
// each player's own. Returns null (never a partial line) when a fixture has no
// usable scores — walkovers have none at all.
function formSetsFromFixture(fixture, isFirst) {
  if (!Array.isArray(fixture.scores) || fixture.scores.length === 0) return null;
  const sorted = [...fixture.scores].sort((a, b) => Number(a.score_set) - Number(b.score_set));
  const sets = sorted.map(s => {
    const mine = isFirst ? s.score_first : s.score_second;
    const theirs = isFirst ? s.score_second : s.score_first;
    const [pG, pTb] = String(mine ?? '').split('.');
    const [oG, oTb] = String(theirs ?? '').split('.');
    const p = Number(pG), o = Number(oG);
    if (!Number.isFinite(p) || !Number.isFinite(o)) return null;
    const set = { p, o };
    if (pTb !== undefined) set.pTb = Number(pTb);
    if (oTb !== undefined) set.oTb = Number(oTb);
    return set;
  });
  if (sets.some(s => s === null)) return null;
  // A 0-0 "set" is never a real set — it's what the feed carries for a match
  // that was never played (a walkover reports one 0-0 set and no final result)
  // or for the unplayed remainder of a retirement. Dropping them stops the Form
  // tab drawing a 0-0 scoreline for a match nobody hit a ball in; a walkover is
  // then left with no set list at all and shows only its w/o marker.
  const played = sets.filter(s => !(s.p === 0 && s.o === 0));
  return played.length ? played : null;
}

function recentFormFromFixtures(fixtures, playerKey, surfaceMap) {
  // Singles across every tour tier (Atp/Challenger/Itf "... Singles"), never
  // doubles. The wide recent-form fetch carries no event_type_key, so this is
  // where tour-tier scoping happens. Main-draw, decided matches only.
  const isSingles = f => /singles/i.test(f.event_type_type || '') && !/doubles/i.test(f.event_type_type || '');
  const clean = (fixtures || [])
    .filter(f => isSingles(f) && ['Finished', 'Retired', 'Walk Over'].includes(f.event_status) && f.event_qualification === 'False')
    .slice()
    .sort((a, b) => new Date(b.event_date) - new Date(a.event_date));

  const matches = clean.map(f => {
    const isFirst = String(f.first_player_key) === String(playerKey);
    const opponent = isFirst ? f.event_second_player : f.event_first_player;
    const opponentKey = isFirst ? f.second_player_key : f.first_player_key;
    const won = isFirst ? f.event_winner === 'First Player' : f.event_winner === 'Second Player';
    let result = f.event_final_result;
    if (!isFirst && result && result.includes('-')) {
      const parts = result.split('-').map(s => s.trim());
      if (parts.length === 2) result = `${parts[1]} - ${parts[0]}`;
    }
    return {
      opponent, opponentKey,
      date: f.event_date,
      tournament: f.tournament_name,
      round: f.tournament_round,
      surface: surfaceMap.get(String(f.tournament_key)) || null,
      result, won,
      sets: formSetsFromFixture(f, isFirst),
      retired: f.event_status === 'Retired',
      walkover: f.event_status === 'Walk Over',
      eventKey: f.event_key,
    };
  });

  const pct = matches.length ? Math.round((matches.filter(m => m.won).length / matches.length) * 1000) / 10 : null;
  return { pct, matches };
}

// Per-match recent form for the Match Analysis modal. Uses the SAME broad
// all-tier source as the profile's recentForm (ATP + Challenger + ITF, see
// fetchRecentSinglesFixtures) so lower-ranked players who play mostly
// Challenger/ITF still get real recent form — this is the single source of
// truth for recent form across the whole dashboard.
//
// Two DIFFERENT windows, and the split is load-bearing:
//
//  * RECENT_FORM_PCT_WINDOW — what "form" MEANS. The form score, the hero
//    W–L and the pills are all "how is he playing right now", so they stay on
//    the last 10 and must not drift when the row cap moves. This is the number
//    on the match card (m.p1RecentForm), so changing it changes the product.
//  * RECENT_FORM_ROW_CAP — how many rows the Form tab can LIST. Rows are cheap
//    (246 B each) and cost no API call: fetchRecentSinglesFixtures already
//    pulls a 5-year window per player in one memoized call and we were throwing
//    all but 10 of it away. The real cost of a row is the box score attached to
//    it below (1,230 B + one fetch), which is why that enrichment carries its
//    own per-run budget rather than scaling silently with this number.
//
// Env-tunable so the cap can be raised without a code change once we've seen a
// few runs' API volume at the new value. 5 years of history is ~200 rows per
// player; going straight there would queue ~9.6k one-time box-score fetches.
const RECENT_FORM_PCT_WINDOW = 10;
const RECENT_FORM_ROW_CAP = Number(process.env.RECENT_FORM_ROW_CAP || 40);
async function buildRecentFormForMatch(playerKey, surfaceMap) {
  const full = recentFormFromFixtures(await fetchRecentSinglesFixtures(playerKey), playerKey, surfaceMap);
  const matches = full.matches.slice(0, RECENT_FORM_ROW_CAP);
  const scored = matches.slice(0, RECENT_FORM_PCT_WINDOW);
  const pct = scored.length ? Math.round((scored.filter(m => m.won).length / scored.length) * 1000) / 10 : null;
  return { pct, matches };
}

// Lift every match's recent-form rows into one shard per player and blank the
// fields on the match objects, so matches.json ships the scalar form pct and
// nothing else. Called immediately before matches.json is written — by then the
// rows carry their attached box scores, which is the whole point of the shard.
//
// The rows for a given player are identical across that player's cards (same
// player key, same memoized fixture window), so the first card to carry them
// wins and the rest are dropped as duplicates.
const FORM_SHARD_DIR = 'form';
const FORM_INDEX_PATH = 'form-index.json';
function extractFormShards(matches) {
  const byPlayer = new Map();
  for (const m of matches) {
    for (const [field, keyField] of [['p1RecentFormMatches', 'p1Key'], ['p2RecentFormMatches', 'p2Key']]) {
      const rows = m[field];
      const key = m[keyField];
      if (rows && rows.length && key != null && !byPlayer.has(String(key))) {
        byPlayer.set(String(key), rows);
      }
      m[field] = null;   // out of the critical path — the modal fetches the shard
    }
  }

  fs.mkdirSync(FORM_SHARD_DIR, { recursive: true });
  const index = [];
  let bytes = 0;
  for (const [key, rows] of byPlayer) {
    const file = `${FORM_SHARD_DIR}/${key}.json`;
    writeJsonAtomic(file, { key, matches: rows }, true);
    bytes += fs.statSync(file).size;
    index.push(key);
  }
  // Which players have form rows at all. The modal needs this BEFORE it renders,
  // and a 404 per formless player is not an answer it can render against — so
  // availability ships as data, not as a failed request (same reasoning as
  // pbp-index.json).
  writeJsonAtomic(FORM_INDEX_PATH, index, true);
  const rowCount = [...byPlayer.values()].reduce((n, r) => n + r.length, 0);
  console.log(`Wrote ${index.length} recent-form shard(s) to ${FORM_SHARD_DIR}/ (${rowCount} rows, ${(bytes / 1024).toFixed(0)} KB total, lazy — off the matches.json critical path).`);
}

// =================================================================
// CAREER-RECORD DRILL-DOWN SHARDS
// -----------------------------------------------------------------
// One lazy shard per player holding every match behind the Player Profile's
// Career-record table, so clicking any cell lists exactly the matches that cell
// counts. Two spans, joined here because no single source covers a career:
//
//   currentYear-5 .. now : all-tier fixtures (ATP + Challenger + ITF), the same
//                          rows buildAllTierYearly tallies into careerByYear.
//                          Count == row count, by construction.
//   .. currentYear-6     : the TML archive (buildArchiveHistories). API-Tennis's
//                          fixture feed is effectively empty before ~2021 —
//                          measured on Rublev, 2019 returns 8 fixtures against a
//                          provider season of 81 matches, and 2017/2018 return
//                          none at all — which is why every pre-window cell used
//                          to open on "no individual match records on file".
//
// The archive is ATP TOUR-LEVEL ONLY, while the pre-window counts in the table
// are the provider's all-tier season totals. Those two genuinely differ (Rublev
// 2017: 39 tour matches on file against a 78-match season) and no available
// source closes the gap, so the shard reports `atpOnly` per year and the UI says
// so in words rather than letting a short list silently contradict the number.
//
// Sharded, not one file: full career for every profiled player is ~10 MB, and
// this is opened by one player at a time. Same convention as the form/pbp/odds
// shards — derived, rebuilt every run, published to _site by pipeline.yml.
const CAREER_HISTORY_SHARD_DIR = 'career-history';
const CAREER_HISTORY_INDEX_PATH = 'career-history-index.json';
const CAREER_HISTORY_SCHEMA_VERSION = 1;

async function writeCareerHistoryShards(profiles, opts = {}) {
  const log = opts.log || (() => {});
  const currentYear = new Date().getFullYear();
  const archiveMaxYear = currentYear - 6;   // the fixture window starts at currentYear-5

  // Pre-window rows from the TML archive, keyed by API player key. Network- and
  // reconciliation-tolerant: a player who cannot be matched to a TML identity
  // simply gets no pre-window rows (never a guessed one).
  let archive = {};
  try {
    archive = await buildArchiveHistories(profiles, 2000, archiveMaxYear, { log }) || {};
  } catch (e) {
    log(`  Career archive unavailable (${e.message}) — shards will cover the fixture window only.`);
  }

  fs.mkdirSync(CAREER_HISTORY_SHARD_DIR, { recursive: true });
  const index = {};
  let bytes = 0, rowTotal = 0, archived = 0;

  for (const [key, p] of Object.entries(profiles)) {
    if (!p) continue;
    const fixtureRows = Array.isArray(p.careerMatches) ? p.careerMatches : [];
    const archiveRows = (archive[key] || []).map(r => ({ ...r, src: 'archive' }));
    const rows = [...fixtureRows, ...archiveRows]
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    // careerMatches is a build-time carrier only; it must not ship inside
    // player-profiles.json, which is on the critical path.
    delete p.careerMatches;
    if (!rows.length) continue;

    // Per-year row counts, so the table can decide whether a cell is drillable
    // and how to caption it WITHOUT fetching the shard first.
    const blank = () => ({ won: 0, lost: 0 });
    const byYear = {};
    for (const r of rows) {
      const y = String(r.year || '');
      if (!/^\d{4}$/.test(y)) continue;
      if (!byYear[y]) byYear[y] = { rows: 0, atpOnly: true, total: blank(), clay: blank(), hard: blank(), grass: blank() };
      const b = byYear[y];
      b.rows++;
      if (r.src !== 'archive') b.atpOnly = false;
      b.total[r.won ? 'won' : 'lost']++;
      if (b[r.surface]) b[r.surface][r.won ? 'won' : 'lost']++;
    }
    const size = c => (c ? (c.won || 0) + (c.lost || 0) : 0);
    for (const row of (p.careerByYear || [])) {
      const y = byYear[String(row.year || '')];
      row.rows = y ? y.rows : 0;
      row.atpOnly = y ? y.atpOnly : false;
      // Pre-window years count from the provider's season aggregate while their
      // rows come from the tour-level archive, so the two can differ either way.
      // When the archive is not SHORT of the aggregate it is the better source —
      // it names every match it counts — so the cell adopts its tally and
      // becomes exact. (Djokovic 2015 read 88 against 89 nameable matches.)
      // When the archive IS short the aggregate stays: it is the truer count of
      // a season that included Challenger/ITF play the archive doesn't carry
      // (Rublev 2017, 39 tour matches in a 78-match season), and the drill-down
      // says so in words.
      if (y && row.allTier === false && y.rows >= size(row.total)) {
        row.total = y.total;
        row.clay = size(y.clay) ? y.clay : null;
        row.hard = size(y.hard) ? y.hard : null;
        row.grass = size(y.grass) ? y.grass : null;
        row.atpOnly = false;   // number and rows now describe the same set
      }
    }

    writeJsonAtomic(`${CAREER_HISTORY_SHARD_DIR}/${key}.json`, {
      v: CAREER_HISTORY_SCHEMA_VERSION, key, matches: rows,
    }, true);
    bytes += fs.statSync(`${CAREER_HISTORY_SHARD_DIR}/${key}.json`).size;
    index[key] = rows.length;
    rowTotal += rows.length;
    if (archiveRows.length) archived++;
  }

  writeJsonAtomic(CAREER_HISTORY_INDEX_PATH, { v: CAREER_HISTORY_SCHEMA_VERSION, players: index }, true);
  log(`Wrote ${Object.keys(index).length} career-history shard(s) to ${CAREER_HISTORY_SHARD_DIR}/ `
    + `(${rowTotal} rows, ${(bytes / 1024 / 1024).toFixed(1)} MB total, ${archived} with pre-${archiveMaxYear + 1} archive rows).`);
  return index;
}

// Per-book odds timelines move OUT of matches.json into one lazy shard per match.
//
// Measured on the first full capture after the refresher was fixed: 44 fixtures
// carried 34,598 real price points, which is +1.13 MB compact on a 1.87 MB
// board — a 60% page-load regression for data that is read only when someone
// opens one match's Odds tab. The scalar the card needs (m.odds/m.bestOdds) and
// the pinned m.openingOdds/m.closingOdds stay inline; they are a few bytes.
//
// Keyed by EVENT KEY, not m.id: the id carries an `upcoming-`/`past-` prefix
// that flips the moment a match finishes, and the whole point of this data is
// to survive that transition (closing odds are derived after it). Same
// derivation build-point-by-point.js uses — split m.id on the first '-'.
const ODDS_SHARD_DIR = 'odds';
const ODDS_INDEX_PATH = 'odds-index.json';
function eventKeyOf(m) {
  const parts = String(m && m.id != null ? m.id : '').split('-');
  return parts.length > 1 ? parts.slice(1).join('-') : '';
}
function extractOddsShards(matches) {
  fs.mkdirSync(ODDS_SHARD_DIR, { recursive: true });
  const index = [];
  const bestPoints = new Map();
  let bytes = 0, points = 0;
  for (const m of matches) {
    const om = m.oddsMovement;
    const books = om && om.books;
    const ek = eventKeyOf(m);
    // Strip unconditionally, shard only what is real and addressable. A match
    // with no event key would be unreachable from the client anyway, so leaving
    // its timeline inline would be pure weight.
    m.oddsMovement = null;
    if (!ek || !books || !Object.keys(books).length) continue;
    // Two board entries can share an event key while a fixture is resolving (the
    // feed re-dates it, so the same match briefly exists as both upcoming- and
    // past-). Last-write-wins would let the thinner series clobber the richer
    // one, so keep whichever has more real points and index the key once.
    const nPoints = Object.values(books).reduce((n, b) => n + ((b.p1 || []).length + (b.p2 || []).length), 0);
    if (bestPoints.has(ek)) {
      if (nPoints <= bestPoints.get(ek)) continue;
      bytes -= fs.statSync(`${ODDS_SHARD_DIR}/${ek}.json`).size;   // this rewrite replaces it
      points -= bestPoints.get(ek);
    } else {
      index.push(ek);
    }
    bestPoints.set(ek, nPoints);
    const file = `${ODDS_SHARD_DIR}/${ek}.json`;
    writeJsonAtomic(file, { eventKey: ek, market: om.market || 'Match Winner', capturedAt: om.capturedAt || null, books }, true);
    bytes += fs.statSync(file).size;
    points += nPoints;
  }
  // Availability ships as data, not as a failed request: the Odds tab must know
  // BEFORE it renders whether to show the movement chart or the reduced view,
  // and a 404 is not something it can render against (same reasoning as
  // form-index.json / pbp-index.json).
  writeJsonAtomic(ODDS_INDEX_PATH, index, true);
  console.log(`Wrote ${index.length} odds-movement shard(s) to ${ODDS_SHARD_DIR}/ (${points} price points, ${(bytes / 1024).toFixed(0)} KB total, lazy — off the matches.json critical path).`);
}

// API-Tennis player_bday is "DD.MM.YYYY" (confirmed live).
function computeAgeFromBday(bday) {
  if (!bday || typeof bday !== 'string') return null;
  const parts = bday.split('.');
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts.map(p => parseInt(p, 10));
  if (!dd || !mm || !yyyy) return null;
  const birth = new Date(yyyy, mm - 1, dd);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const hadBirthdayThisYear = (now.getMonth() > birth.getMonth())
    || (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
  if (!hadBirthdayThisYear) age--;
  return age;
}

function titlesForYear(playerStats, year) {
  const season = (playerStats?.stats || []).find(s => s.type === 'singles' && s.season === String(year));
  return season ? (parseInt(season.titles, 10) || 0) : 0;
}

function titlesCareer(playerStats) {
  return (playerStats?.stats || [])
    .filter(s => s.type === 'singles')
    .reduce((sum, s) => sum + (parseInt(s.titles, 10) || 0), 0);
}

// Real mean across every player built in this run's player-profiles.json —
// not a hardcoded constant. Used for every player's "vs tour avg" sublabels
// and the radar's dashed baseline polygon. Movement/Net play excluded (no
// values to average).
function computeTourAverage(profiles) {
  const all = Object.values(profiles);
  const dna = {};
  for (const axis of DNA_AXES) dna[axis] = meanOf(all.map(p => p.dna.All[axis]));
  dna.movement = null;
  dna.netPlay = null;

  const stats = {};
  for (const key of RAW_STAT_KEYS) {
    // A player below the minimum sample cannot help define the benchmark he is
    // about to be measured against: a 100%-off-one-break-point player would
    // drag the tour average up and make every honest converter look worse than
    // he is. Same rule as the card, applied one level earlier.
    const min = MIN_STAT_SAMPLE[key];
    const eligible = min
      ? all.filter(p => (p.samplesAll ? p.samplesAll[key] : 0) >= min)
      : all;
    stats[key] = meanOf(eligible.map(p => (p.statsAll ? p.statsAll[key] : null)));
  }

  return { dna, stats };
}

const DNA_AXIS_LABELS = { serve: 'Serve', return: 'Return', baseline: 'Baseline play', clutch: 'Clutch performance' };

// Narrative bullets, following the same honest-threshold pattern already
// used by abstractSpeedInsight()/trendInsight()/buildProgressionAiSummary():
// each bullet is independently gated on a real signal clearing a real
// threshold, and is omitted (never invented) when it doesn't qualify.
function buildPlayerInsights(profile, tourAverage) {
  const insights = [];

  let bestAxis = null, bestGap = 0;
  for (const axis of DNA_AXES) {
    const val = profile.dna.All[axis];
    const avg = tourAverage.dna[axis];
    if (val === null || avg === null) continue;
    const gap = val - avg;
    if (gap > bestGap) { bestGap = gap; bestAxis = axis; }
  }
  if (bestAxis && bestGap >= 8) {
    const label = DNA_AXIS_LABELS[bestAxis];
    insights.push({
      title: `${label} is a standout strength`,
      text: `${profile.name}'s ${label.toLowerCase()} score (${profile.dna.All[bestAxis]}) is ${Math.round(bestGap)} points above the tour average.`,
      accent: 'blue',
    });
  }

  let bestSurface = null, bestWinRate = -1;
  for (const surface of ['Grass', 'Hard', 'Clay']) {
    const rec = profile.surfaces[surface]?.record;
    if (!rec || rec.winRate === null || (rec.won + rec.lost) < 5) continue;
    if (rec.winRate > bestWinRate) { bestWinRate = rec.winRate; bestSurface = surface; }
  }
  if (bestSurface) {
    const rec = profile.surfaces[bestSurface].record;
    insights.push({
      title: `${bestSurface} is the strongest surface`,
      text: `${profile.name} wins ${rec.winRate}% of matches on ${bestSurface.toLowerCase()} (${rec.won}-${rec.lost} career).`,
      accent: 'green',
    });
  }

  const form = profile.recentForm;
  if (form && form.matches.length >= 3) {
    const last = form.matches.slice(0, 9);
    const wins = last.filter(m => m.won).length;
    const ratio = wins / last.length;
    if (ratio >= 0.6) {
      insights.push({ title: 'In strong recent form', text: `${wins}-${last.length - wins} across the last ${last.length} tour matches (${form.pct}% recent win rate).`, accent: 'gold' });
    } else if (ratio <= 0.4) {
      insights.push({ title: 'Struggling for recent form', text: `${wins}-${last.length - wins} across the last ${last.length} tour matches (${form.pct}% recent win rate).`, accent: 'gold' });
    } else {
      // Overall form is even (40-60%). Rather than a vague "mixed form" label,
      // surface the actionable read: which surface has he been sharpest on in
      // this run? Real per-match surface data, no fabrication.
      const bySurf = {};
      last.forEach(m => {
        const s = (m.surface || '').toLowerCase();
        if (!['clay', 'hard', 'grass'].includes(s)) return;
        (bySurf[s] = bySurf[s] || { won: 0, lost: 0 })[m.won ? 'won' : 'lost']++;
      });
      const ranked = Object.entries(bySurf)
        .filter(([, r]) => (r.won + r.lost) >= 2)
        .sort((a, b) => (b[1].won / (b[1].won + b[1].lost)) - (a[1].won / (a[1].won + a[1].lost)));
      if (ranked.length) {
        const [s, r] = ranked[0];
        const label = s[0].toUpperCase() + s.slice(1);
        insights.push({ title: `Sharpest on ${label} recently`, text: `${r.won}-${r.lost} on ${s} in his last ${last.length} matches — his most productive surface in an otherwise even run (${form.pct}% overall).`, accent: 'gold' });
      } else {
        insights.push({ title: 'Evenly-matched recent run', text: `${wins}-${last.length - wins} across the last ${last.length} tour matches (${form.pct}% win rate) — no clear hot or cold streak.`, accent: 'gold' });
      }
    }
  }

  return insights.slice(0, 3);
}

// Orchestrates the full per-player build for every unique player appearing
// in this run's matches[], then computes a real tour average across the
// resulting set. Players with no real fetchPlayerStats() result are
// skipped entirely — no fabricated profile is ever created.
// Builds ONE player's profile object from real API-Tennis data (the same
// fields the profile page reads), plus the set of opponents discovered in that
// player's own fixtures. Returns { profile:null } when get_players yields
// nothing — an honest skip, never a fabricated profile. `insights` is left
// empty here and filled by the caller once the tour average is known.
async function buildOneProfile(key, name, surfaceMap) {
  const currentYear = new Date().getFullYear();
  const playerStats = await fetchPlayerStats(key);
  if (!playerStats) return { profile: null, opponents: [] };

  const [currentFixtures, prevFixtures] = await Promise.all([
    fetchPlayerFixturesForYear(key, currentYear),
    fetchPlayerFixturesForYear(key, currentYear - 1),
  ]);
  const allFixtures = [...currentFixtures, ...prevFixtures];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 371); // 53 weeks, safely covers a full 52-week window
  const last52WeeksFixtures = allFixtures.filter(f => new Date(f.event_date) >= cutoff);

  const aggBySurface = { All: aggregateStatsFromFixtures(last52WeeksFixtures, key) };
  for (const surface of ['grass', 'hard', 'clay']) {
    const label = surface[0].toUpperCase() + surface.slice(1);
    const onSurface = allFixtures.filter(f => surfaceMap.get(String(f.tournament_key)) === surface);
    aggBySurface[label] = aggregateStatsFromFixtures(onSurface, key);
  }

  const dna = {};
  for (const label of ['All', 'Grass', 'Hard', 'Clay']) dna[label] = computeDnaScores(aggBySurface[label]);

  const currentRow = seasonRowFromFixtures(currentFixtures, key, currentYear, surfaceMap);
  const currentYearRecord = currentRow?.total || { won: 0, lost: 0 };
  const currentYearWinRate = (currentYearRecord.won + currentYearRecord.lost) > 0
    ? Math.round((currentYearRecord.won / (currentYearRecord.won + currentYearRecord.lost)) * 1000) / 10
    : null;

  const surfaces = {};
  for (const surface of ['grass', 'hard', 'clay']) {
    const label = surface[0].toUpperCase() + surface.slice(1);
    surfaces[label] = { record: surfaceRecord(playerStats, surface), agg: aggBySurface[label] };
  }

  const seasonTrend = [currentRow, ...yearlyBreakdown(playerStats)]
    .filter(Boolean)
    .filter(row => parseInt(row.year, 10) >= currentYear - 5)
    .sort((a, b) => parseInt(a.year, 10) - parseInt(b.year, 10))
    .map(row => ({
      year: row.year,
      winRate: (row.total.won + row.total.lost) > 0
        ? Math.round((row.total.won / (row.total.won + row.total.lost)) * 1000) / 10
        : null,
    }));

  // The broad all-tier fixture list (currentYear-5..now) that backs BOTH the
  // Career-record counts and the Career-record drill-down rows. Memoized, and
  // already fetched below for recentForm — this is not an extra call.
  const allTierFixtures = await fetchRecentSinglesFixtures(key);

  // Full-career year-by-year W-L (per surface + total) for the Player Profile
  // "Career record" table. recentForm.matches is capped below to current-year +
  // last-10, so the table CANNOT be derived from it (that collapses every
  // player's career to the current season) — it reads this field instead.
  //
  // These counts are tallied by buildAllTierYearly from `allTierFixtures`, the
  // SAME fixtures playerMatchHistory turns into careerMatches below. That is the
  // whole point: for every year in the fixture window, the number in the table
  // equals the number of rows the drill-down lists, by construction. It used to
  // be `[currentRow, ...yearlyBreakdown(playerStats)]` — the provider's own
  // season aggregate — which is a different population from the rows and so
  // disagreed with the list in both directions (Rublev 2025 clay: 8-6 in the
  // table against 16 rows on file).
  //
  // Pre-window years (< currentYear-5) still fall back to the provider aggregate
  // inside buildAllTierYearly, flagged allTier:false; their rows come from the
  // TML archive and are attached after the fact — see attachCareerHistory().
  const careerByYear = buildAllTierYearly(allTierFixtures, key, playerStats, currentYear, surfaceMap);

  // Row-level twin of careerByYear over the same fixtures. Stripped out of the
  // published profile and written to its own per-player shard (see writeCareerHistoryShards).
  const careerMatches = playerMatchHistory(allTierFixtures, key, currentYear, surfaceMap);

  // The Player Profile page only reads current-season matches (season tiles +
  // the expandable "all results this season" list) and the last 10 (form % and
  // form dots) from recentForm — never older history. So cap the stored match
  // list to current-year + the last 10 instead of the full ~5-year all-tier
  // window. This is the single biggest driver of player-profiles.json size
  // (~68% of the file); capping it trims the file dramatically with zero UI
  // change. matches.json's Form tab uses its own separate field, untouched.
  const _recentForm = recentFormFromFixtures(allTierFixtures, key, surfaceMap);
  const recentFormCapped = {
    ..._recentForm,
    matches: (_recentForm.matches || []).filter((m, i) => i < 10 || String(m.date || '').slice(0, 4) === String(currentYear)),
  };

  const profile = {
    key,
    name,
    country: playerStats.player_country || null,
    age: computeAgeFromBday(playerStats.player_bday),
    rank: currentSinglesRank(playerStats),
    titlesThisYear: titlesForYear(playerStats, currentYear),
    titlesCareer: titlesCareer(playerStats),
    kpis: {
      All: { record: currentYearRecord, winRate: currentYearWinRate },
      Grass: { record: surfaces.Grass.record, winRate: surfaces.Grass.record.winRate },
      Hard: { record: surfaces.Hard.record, winRate: surfaces.Hard.record.winRate },
      Clay: { record: surfaces.Clay.record, winRate: surfaces.Clay.record.winRate },
    },
    dna,
    statsAll: aggBySurface.All?.stats || null,
    samplesAll: aggBySurface.All?.samples || null,
    surfaces,
    // Recent form uses its own broad all-tier fetch (see fetchRecentSinglesFixtures),
    // NOT the ATP-only allFixtures used for the season/DNA/surface aggregates above.
    // Capped above to current-year + last-10 (all the profile UI reads).
    recentForm: recentFormCapped,
    seasonTrend,
    careerByYear,
    careerMatches,
    insights: [], // filled in by the caller, once tourAverage is known
  };

  // Opponents this player has actually faced (1st-degree only, no recursion),
  // taken straight from the fixtures we already fetched — keyed by their real
  // player_key, named from the fixture. Used to widen the searchable pool.
  const opponents = [];
  for (const f of allFixtures) {
    const isFirst = String(f.first_player_key) === String(key);
    const oppKey = isFirst ? f.second_player_key : f.first_player_key;
    const oppName = isFirst ? f.event_second_player : f.event_first_player;
    if (oppKey && oppName) opponents.push([String(oppKey), oppName]);
  }

  return { profile, opponents };
}

// Opponent-profile cache. Seed players (today's matches) are always rebuilt
// fresh; their 1st-degree opponents — a much larger, slow-changing pool — are
// profiled once and reused for OPPONENT_PROFILE_MAX_AGE_MS. Because a built
// opponent is cached (and not rebuilt until it expires), its build cost is a
// one-time cost, NOT a per-run cost — so the per-run cap is set high enough to
// backfill the whole current opponent set in a single run. That way every
// player a seed player has faced becomes searchable right away instead of
// trickling in over several runs; the cap now only guards against a
// pathologically large opponent set appearing at once.
const PLAYER_PROFILE_CACHE_PATH = 'player-profiles-cache.json';
const OPPONENT_PROFILE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const MAX_OPPONENT_BUILDS_PER_RUN = 400;

// Bump whenever a change alters the CONTENT of a built profile (a stat formula,
// a new/removed field, a cap). The TTL above only answers "is this data old?" —
// it cannot answer "was this built by the current code?", so without this a
// cached opponent keeps serving numbers from the old formula for up to 14 days
// while seed players (rebuilt every run) show the new ones. That split is what
// hid the doubled ace counts: fixing the aggregator moved today's players and
// left ~370 cached profiles wrong, with nothing to signal why.
// v2 = match-level-only stat aggregation (count stats were doubled before).
// v3 = case-insensitive stat-name matching (1st/2nd Serve Points Won and
//      Unforced Errors silently dropped every 2026 match before).
// v4 = per-stat denominator for count averages (Winners/Unforced Errors were
//      divided by every match on file, not just the ~66% that carry them) plus
//      rejection of impossible feed rows (won > total).
// v5 = per-stat sample sizes (samplesAll) persisted alongside the numbers, so a
//      percentage off a handful of attempts can be held back instead of read as
//      a rate. Load-bearing: computeTourAverage now filters on samplesAll, and a
//      cached v4 profile has none — it would silently drop out of the benchmark.
// v6 = careerByYear (full-career year-by-year W-L) plus the surface-specific
//      recent-form insight. Both are built in buildOneProfile, so a cached v5
//      opponent carries neither: its Career-record table falls back to the
//      recentForm path (capped to the current season → collapses to one row,
//      the "no data" report) and it keeps the old vague "Mixed recent form".
//      Seed players rebuild every run so they were already correct; without
//      this bump the other ~370 stayed wrong for up to 14 days.
// v7 = careerByYear re-sourced from the all-tier FIXTURES (buildAllTierYearly)
//      instead of the provider's season aggregate, plus careerMatches — the
//      row-level twin over the same fixtures. A v6 profile has counts from one
//      population and rows from another, which is exactly the table-vs-list
//      disagreement this version removes; and it has no careerMatches at all, so
//      its Career-record drill-down would fall back to the current season only.
//      Seed players rebuild every run; without this bump the other ~370 keep the
//      mismatched pair for up to 14 days.
const PROFILE_SCHEMA_VERSION = 7;

// Full-career tournament history. Each player's entire ATP-singles history is
// fetched in ONE get_fixtures call (date_start=2000-01-01) and reduced to a
// per-tournament career record. Cached in its own file with a 7-day TTL shared
// across all players so seed players (rebuilt every 30-min run) don't refetch;
// only up to MAX_TOURNAMENT_HISTORY_FETCHES_PER_RUN new/stale players are pulled
// per run so the pool backfills over a few runs instead of one huge burst.
const TOURNAMENT_HISTORY_CACHE_PATH = 'player-tournament-history.json';
const TOURNAMENT_HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_TOURNAMENT_HISTORY_FETCHES_PER_RUN = 250;

// Round depth ranking (higher = deeper run). Used to derive each player's best
// result at a tournament. Covers both the word forms ("Quarter-finals") and the
// fraction forms ("1/4-finals") the API returns across seasons.
const ROUND_RANK = {
  F: 7, SF: 6, QF: 5, R16: 4, R32: 3, R64: 2, R128: 1, R256: 0,
};
// Full-word labels for a finish/round code (used for edition finish badges and
// the tournament-level "best result").
const ROUND_FULL = {
  F: 'Final', SF: 'Semi-final', QF: 'Quarter-final',
  R16: 'Round of 16', R32: 'Round of 32', R64: 'Round of 64',
  R128: 'Round of 128', R256: 'Round of 256',
};
function careerRoundShort(round) {
  if (!round) return '';
  let r = String(round);
  if (r.includes(' - ')) r = r.split(' - ').pop();
  r = r.trim();
  const frac = r.match(/1\/(\d+)/);
  if (frac) {
    const map = { '2': 'SF', '4': 'QF', '8': 'R16', '16': 'R32', '32': 'R64', '64': 'R128', '128': 'R256' };
    return map[frac[1]] || r;
  }
  if (/semi[-\s]?final/i.test(r)) return 'SF';
  if (/quarter[-\s]?final/i.test(r)) return 'QF';
  const ro = r.match(/round of (\d+)/i);
  if (ro) {
    const m = { '16': 'R16', '32': 'R32', '64': 'R64', '128': 'R128', '256': 'R256' };
    return m[ro[1]] || ('R' + ro[1]);
  }
  if (/final/i.test(r)) return 'F';
  return r;
}
function normalizeTournamentName(name) {
  return String(name || '').replace(/^(ATP|WTA|ITF|Challenger)\s+/i, '').trim();
}

// Fetches a player's entire ATP-singles career in one get_fixtures call and
// reduces it to a per-tournament career record with a round-by-round path for
// every edition (who he beat / lost to, with scores). Returns an array sorted
// by total matches desc, or null if the API gave nothing. No fabrication: only
// completed matches with a real winner and round are counted. Each entry:
//   { name, won, lost, firstYear, lastYear, titles, bestResult, bestYears[],
//     editions: [ { year, finish, finishWon,
//       matches: [ { res:'W'|'L', round, opp, oppKey, score } ] } ] }  // newest first
async function fetchPlayerCareerHistory(playerKey) {
  const stop = new Date().toISOString().split('T')[0];
  const url = `${API_TENNIS_BASE}?method=get_fixtures&APIkey=${API_TENNIS_KEY}&date_start=2000-01-01&date_stop=${stop}&event_type_key=265&player_key=${playerKey}`;
  let data;
  try {
    const res = await fetch(url);
    data = await res.json();
  } catch (e) { return null; }
  if (!data || !data.success || !Array.isArray(data.result)) return null;

  const byTournament = {};
  for (const f of data.result) {
    if (!f.tournament_name || !f.tournament_round) continue;
    if (f.event_qualification === 'True') continue;
    if (f.event_winner !== 'First Player' && f.event_winner !== 'Second Player') continue;
    const isP1 = String(f.first_player_key) === String(playerKey);
    if (!isP1 && String(f.second_player_key) !== String(playerKey)) continue;
    const didWin = (f.event_winner === 'First Player' && isP1)
      || (f.event_winner === 'Second Player' && !isP1);
    const name = normalizeTournamentName(f.tournament_name);
    if (!name) continue;
    const year = parseInt(f.tournament_season || (f.event_date || '').slice(0, 4), 10);
    if (!year) continue;
    const code = careerRoundShort(f.tournament_round);
    const opp = (isP1 ? f.event_second_player : f.event_first_player) || '';
    const oppKey = isP1 ? f.second_player_key : f.first_player_key;
    const score = f.event_final_result || '';

    let t = byTournament[name];
    if (!t) {
      t = byTournament[name] = {
        name, won: 0, lost: 0, firstYear: year, lastYear: year, _byEdition: {},
      };
    }
    if (didWin) t.won++; else t.lost++;
    if (year < t.firstYear) t.firstYear = year;
    if (year > t.lastYear) t.lastYear = year;
    if (!t._byEdition[year]) t._byEdition[year] = [];
    t._byEdition[year].push({
      res: didWin ? 'W' : 'L', round: code, opp,
      oppKey: oppKey != null ? String(oppKey) : '', score,
      _rank: ROUND_RANK[code] != null ? ROUND_RANK[code] : -1, _won: didWin,
    });
  }

  const list = Object.values(byTournament);
  if (!list.length) return null;

  for (const t of list) {
    const years = Object.keys(t._byEdition).map(Number).sort((a, b) => b - a);
    let titles = 0;
    let bestScore = -1, bestResult = '', bestYears = [];
    t.editions = years.map((y) => {
      // Order a year's matches earliest round → latest (final last).
      const ms = t._byEdition[y].slice().sort((a, b) => a._rank - b._rank);
      // The deepest-round match is where the player exited (or the final won).
      const deepest = ms.reduce((best, m) => (m._rank > best._rank ? m : best), ms[0]);
      const finishWon = deepest._won && deepest.round === 'F';
      if (finishWon) titles++;
      const finish = finishWon ? 'Won' : (ROUND_FULL[deepest.round] || deepest.round);
      // finishScore ranks a title (Won final) above a lost final.
      const finishScore = finishWon ? 8 : deepest._rank;
      if (finishScore > bestScore) { bestScore = finishScore; bestResult = finish; bestYears = [y]; }
      else if (finishScore === bestScore) { bestYears.push(y); }
      return {
        year: y, finish, finishWon,
        matches: ms.map((m) => ({ res: m.res, round: m.round, opp: m.opp, oppKey: m.oppKey, score: m.score })),
      };
    });
    t.titles = titles;
    t.bestResult = bestResult;
    t.bestYears = bestYears; // newest-first (years array already desc)
    delete t._byEdition;
  }

  list.sort((a, b) => (b.won + b.lost) - (a.won + a.lost));
  return list;
}

// Orchestrates the full per-player build. Seed = every unique player in this
// run's matches[] (built fresh). Then every 1st-degree opponent of those seed
// players is added to the searchable pool via a TTL cache, so player search can
// reach players well beyond today's fixtures. The tour average is computed over
// the seed set only, preserving its meaning as "the current field's average".
// Players with no real fetchPlayerStats() result are skipped — never fabricated.
async function buildPlayerProfiles(matches, surfaceMap) {
  const seedPlayers = new Map(); // key -> name (today's fixtures)
  for (const m of matches) {
    if (m.p1Key && m.p1) seedPlayers.set(String(m.p1Key), m.p1);
    if (m.p2Key && m.p2) seedPlayers.set(String(m.p2Key), m.p2);
  }

  let cachedPlayers = {}; // key -> { builtAt, profile|null }
  try {
    const cache = JSON.parse(fs.readFileSync(PLAYER_PROFILE_CACHE_PATH, 'utf8'));
    cachedPlayers = cache.players || {};
  } catch (e) { /* first run — no cache yet */ }

  const profiles = {};
  const opponentPool = new Map(); // key -> name (discovered, non-seed)

  // Pass 1 — seed players, always fresh. Collect their opponents along the way.
  for (const [key, name] of seedPlayers) {
    const { profile, opponents } = await buildOneProfile(key, name, surfaceMap);
    if (profile) profiles[key] = profile;
    for (const [oppKey, oppName] of opponents) {
      if (!seedPlayers.has(oppKey) && !opponentPool.has(oppKey)) opponentPool.set(oppKey, oppName);
    }
  }

  // Pass 2 — opponents, TTL-cached and throttled. Fresh cache entries are
  // reused as-is (including negatively-cached nulls); stale/missing ones are
  // rebuilt up to MAX_OPPONENT_BUILDS_PER_RUN, and any not reached this run
  // fall back to their stale cached profile so they stay searchable meanwhile.
  const now = Date.now();
  let built = 0, reused = 0, skippedNull = 0;
  for (const [key, name] of opponentPool) {
    const cached = cachedPlayers[key];
    const fresh = cached && cached.builtAt
      && cached.v === PROFILE_SCHEMA_VERSION
      && (now - new Date(cached.builtAt).getTime() < OPPONENT_PROFILE_MAX_AGE_MS);
    if (fresh) {
      if (cached.profile) { profiles[key] = cached.profile; reused++; } else skippedNull++;
      continue;
    }
    if (built >= MAX_OPPONENT_BUILDS_PER_RUN) {
      if (cached && cached.profile) { profiles[key] = cached.profile; reused++; }
      continue;
    }
    const { profile } = await buildOneProfile(key, name, surfaceMap);
    cachedPlayers[key] = { builtAt: new Date().toISOString(), v: PROFILE_SCHEMA_VERSION, profile: profile || null };
    built++;
    if (profile) profiles[key] = profile; else skippedNull++;
  }

  // Cap EVERY served profile's recentForm to current-year + last-10 — the only
  // slice the Player Profile page reads. buildOneProfile already caps freshly
  // built profiles, but opponents reused from the 14-day cache (built before
  // this cap existed) still carry the full ~5-year list, so re-apply it to every
  // profile here. This is the single biggest driver of player-profiles.json size.
  // Idempotent; mutates the shared cached objects so the cache shrinks too.
  const _capYear = String(new Date().getFullYear());
  for (const key of Object.keys(profiles)) {
    const rf = profiles[key] && profiles[key].recentForm;
    if (rf && Array.isArray(rf.matches) && rf.matches.length) {
      rf.matches = rf.matches.filter((m, i) => i < 10 || String(m.date || '').slice(0, 4) === _capYear);
    }
  }

  // Full-career tournament history — attach to every profile so the player
  // profile page can answer "what's his record at <tournament>?" over his whole
  // career (not just the 2-season recentForm window). One get_fixtures call per
  // player, shared across runs via a 7-day-TTL cache; throttled so the pool
  // backfills over a few runs rather than one big burst. Stale/unreached players
  // keep their previously-cached history so they stay answerable meanwhile.
  let historyCache = {}; // key -> { builtAt, history|null }
  try {
    const hc = JSON.parse(fs.readFileSync(TOURNAMENT_HISTORY_CACHE_PATH, 'utf8'));
    historyCache = hc.players || {};
  } catch (e) { /* first run — no history cache yet */ }

  let histFetched = 0, histReused = 0, histEmpty = 0;
  for (const key of Object.keys(profiles)) {
    const cached = historyCache[key];
    const fresh = cached && cached.builtAt
      && (now - new Date(cached.builtAt).getTime() < TOURNAMENT_HISTORY_MAX_AGE_MS);
    if (fresh) {
      if (cached.history) { profiles[key].tournamentHistory = cached.history; histReused++; }
      else histEmpty++;
      continue;
    }
    if (histFetched >= MAX_TOURNAMENT_HISTORY_FETCHES_PER_RUN) {
      if (cached && cached.history) { profiles[key].tournamentHistory = cached.history; histReused++; }
      continue;
    }
    const history = await fetchPlayerCareerHistory(key);
    historyCache[key] = { builtAt: new Date().toISOString(), history: history || null };
    histFetched++;
    if (history) profiles[key].tournamentHistory = history; else histEmpty++;
  }

  fs.writeFileSync(TOURNAMENT_HISTORY_CACHE_PATH,
    JSON.stringify({ fetchedAt: new Date().toISOString(), players: historyCache }, null, 2));
  console.log(`Tournament history: fetched ${histFetched}, reused ${histReused}, `
    + `no-data ${histEmpty} → ${Object.keys(profiles).filter(k => profiles[k].tournamentHistory).length} players with career history.`);

  // Backfill pre-2021 editions the API-Tennis feed can't reach (its fixture
  // history stops ~2021), so per-tournament career records span each player's
  // whole career. Merges the open TML-Database archive (same schema as Jeff
  // Sackmann's tennis_atp) into tournamentHistory in place — API years always
  // win, TML only fills missing pre-2021 years. Idempotent and network-tolerant
  // (a TML outage just logs and skips, leaving the 2021+ records intact).
  console.log('Backfilling pre-2021 career history from TML-Database archive...');
  await backfillProfilesHistory(profiles, { log: (m) => console.log(m) });

  // Tour average over the seed set only (falls back to the whole pool if, on
  // some odd run, no seed profile built), so existing "vs tour avg" insights
  // for the current field don't shift as the opponent pool grows.
  const seedProfiles = {};
  for (const key of seedPlayers.keys()) if (profiles[key]) seedProfiles[key] = profiles[key];
  const tourAverage = computeTourAverage(
    Object.keys(seedProfiles).length ? seedProfiles : profiles);

  for (const key of Object.keys(profiles)) {
    profiles[key].insights = buildPlayerInsights(profiles[key], tourAverage);
  }

  fs.writeFileSync(PLAYER_PROFILE_CACHE_PATH,
    JSON.stringify({ fetchedAt: new Date().toISOString(), players: cachedPlayers }, null, 2));
  console.log(`Player profiles: ${Object.keys(seedProfiles).length} seed, `
    + `opponents [built ${built}, reused ${reused}, no-stats ${skippedNull}] `
    + `→ ${Object.keys(profiles).length} searchable.`);

  return {
    fetchedAt: new Date().toISOString(),
    players: profiles,
    tourAverage,
  };
}

// =================================================================
// MAIN
// =================================================================
async function runPipeline() {
  const today = new Date().toISOString().split('T')[0];
  // Next 3 days (today + 2 more) so tomorrow's and day-after's matches get
  // real H2H/stats enrichment too, not just today's.
  const rangeEnd = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0];

  console.log('Fetching odds events...');
  const oddsEvents = await fetchAllTennisEvents();
  console.log(`Found ${oddsEvents.length} odds events.`);

  console.log(`Fetching API-Tennis fixtures (${today} to ${rangeEnd}) for player keys / H2H / stats...`);
  const apiTennisFixtures = await fetchApiTennisFixtures(today, rangeEnd);
  console.log(`Found ${apiTennisFixtures.length} API-Tennis ATP singles fixtures.`);

  const surfaceMap = await loadTournamentSurfaceMap();
  const venueMap = await loadTournamentVenueMap();

  // Draw size / champion / palmarès per tournament edition — not used for a
  // player's own tournament record (that's fetched per-player directly in
  // buildMatchObject via fetchPlayerTournamentMatches), kept for its own
  // sake as future reference data.
  console.log('Loading tournament profiles (draw size / champion / palmarès — cached for 30 days)...');
  const tournamentProfiles = await loadTournamentProfiles();
  const profileCount = Object.values(tournamentProfiles.profiles).filter(Boolean).length;
  console.log(`Tournament profiles ready: ${profileCount}/${Object.keys(tournamentProfiles.profiles).length} tournaments have historical data on record.`);

  const matches = [];
  for (const event of oddsEvents) {
    matches.push(await buildMatchObject(event, apiTennisFixtures, surfaceMap, venueMap));
  }

  // Fixture-driven upcoming matches: scheduled fixtures in the today→+2-day
  // window (apiTennisFixtures, already fetched above) that have NO odds event
  // yet — so buildMatchObject never created them. Surfaces them anyway (e.g. a
  // freshly-drawn final before bookmakers open markets). Deduped against the
  // odds-driven matches by the same last-name pairing findApiTennisFixture uses,
  // and among themselves by event_key. Only genuinely still-scheduled fixtures
  // (not Finished/Retired/Walk Over/live, not qualifying) are included; day-tab
  // placement is left to computeDay (anything past the day-after lands under
  // 'later' → visible only via "All days").
  const pairKey = (a, b) => [lastName(a), lastName(b)].sort().join('|');
  const oddsMatchKeys = new Set(matches.map(m => pairKey(m.p1, m.p2)));
  const seenUpcomingKeys = new Set();
  const upcomingFixtures = apiTennisFixtures.filter(f => {
    if (['Finished', 'Retired', 'Walk Over'].includes(f.event_status)) return false;
    // An interrupted match is already in play — it's built by the completed-match
    // builder below (with its partial score + stats), so it must not also be
    // surfaced here as a still-scheduled fixture.
    if (isInterruptedFixture(f)) return false;
    if (f.event_live === '1') return false;
    if (f.event_qualification === 'True') return false;
    if (f.event_winner === 'First Player' || f.event_winner === 'Second Player') return false;
    // A fixture with a not-yet-assigned player (TBD / awaiting-qualifier slot)
    // has no player key, so none of the per-player enrichment can run — skip it
    // until both players are set.
    if (!f.first_player_key || !f.second_player_key) return false;
    if (oddsMatchKeys.has(pairKey(f.event_first_player, f.event_second_player))) return false;
    const key = String(f.event_key);
    if (seenUpcomingKeys.has(key)) return false;
    seenUpcomingKeys.add(key);
    return true;
  });
  console.log(`Found ${upcomingFixtures.length} scheduled fixture(s) with no odds event yet — adding them from the fixtures feed.`);
  for (const fixture of upcomingFixtures) {
    matches.push(await buildUpcomingMatchObject(fixture, surfaceMap, venueMap));
  }

  // Completed matches for the Today / Yesterday / 2-days-ago tabs: a 3-day
  // trailing window that now INCLUDES today, so a match that finishes today
  // gets its real score + box-score stats on the very next run instead of
  // waiting until it rolls into "yesterday". Sourced directly from get_fixtures
  // since finished matches have no betting-odds event to build from. Same
  // 'Finished'/'Retired'/'Walk Over' filter already used elsewhere
  // (courtSpeedRecordFromFixtures, seasonRowFromFixtures) for a genuinely
  // decided match, plus excluding qualifying-round matches to match the
  // main-tour-only scope the odds-driven Today/Tomorrow tabs already have.
  const dayMs = 86400000;
  const dateStr = d => d.toISOString().split('T')[0];
  const twoDaysAgo = dateStr(new Date(Date.now() - 2 * dayMs));
  console.log(`Fetching finished fixtures (${twoDaysAgo} to ${today}, incl. today) for completed-match scores/stats...`);
  const pastFixtures = await fetchApiTennisFixtures(twoDaysAgo, today);
  const finishedPastFixtures = pastFixtures.filter(f =>
    (['Finished', 'Retired', 'Walk Over'].includes(f.event_status) || isInterruptedFixture(f))
    && f.event_qualification !== 'True'
  );
  const interruptedCount = finishedPastFixtures.filter(isInterruptedFixture).length;
  console.log(`Found ${finishedPastFixtures.length} played matches in the 3-day trailing window (incl. today)`
    + ` — ${interruptedCount} of them interrupted/suspended (partial score + stats, no result).`);
  for (const fixture of finishedPastFixtures) {
    const pastMatch = await buildPastMatchObject(fixture, surfaceMap, venueMap);
    // A match that finished TODAY may already be present as a scoreless
    // odds-driven or fixture-only card (built above before the result landed).
    // Drop that placeholder so there's exactly one card for the matchup — the
    // scored one. Only ever removes entries that carry no finalScore, so real
    // past results (which never share this matchup+window) are left untouched.
    const key = pairKey(pastMatch.p1, pastMatch.p2);
    for (let i = matches.length - 1; i >= 0; i--) {
      // `!finalScore` alone would also match an interrupted card (which
      // deliberately has none) and delete the very card just built for it, so
      // suspended matches are explicitly exempt from placeholder cleanup.
      if (!matches[i].finalScore && !matches[i].interrupted && pairKey(matches[i].p1, matches[i].p2) === key) {
        matches.splice(i, 1);
      }
    }
    matches.push(pastMatch);
  }

  // -----------------------------------------------------------------
  // HISTORICAL MATCH STATS for Form-tab recent-form matches — real
  // per-match box scores fetched via get_fixtures?match_key=<eventKey>,
  // reusing the same parser (buildMatchStatsFromFixture) already used
  // for the small set of top-level tracked past matches. Deduped across
  // every player's recent-form list (many matches repeat), cached
  // indefinitely in HISTORICAL_STATS_CACHE_PATH since finished matches
  // never change — only uncached eventKeys are actually fetched here.
  // -----------------------------------------------------------------
  const uniqueEventKeys = new Set();
  const formRowDate = new Map();   // event key -> match date, drives the fetch order below
  for (const m of matches) {
    for (const entry of [...(m.p1RecentFormMatches || []), ...(m.p2RecentFormMatches || [])]) {
      if (!entry.eventKey) continue;
      const ek = String(entry.eventKey);
      uniqueEventKeys.add(ek);
      // The same match sits in both players' lists; the date is identical, so
      // first writer wins and a row without one simply sorts last.
      if (entry.date && !formRowDate.has(ek)) formRowDate.set(ek, String(entry.date));
    }
  }
  const historicalStatsCache = loadHistoricalStatsCache();
  // Budgeted, newest-first, on a permanent cache. This loop used to fetch every
  // uncached row in one run, which was fine at a 10-row cap (~426 keys, nearly
  // all long cached) and is not at a higher one: the cap is the multiplier on
  // this number, so an uncapped loop would turn a cap raise into thousands of
  // serial 150ms-paced fetches in a single run and blow the pipeline's runtime.
  // Deferred keys are simply absent from the cache and retried next run, and a
  // row whose box score hasn't landed yet renders without its stat panel rather
  // than not at all — so coverage converges over a few runs instead of the site
  // waiting for all of it. Same total API cost, spread out.
  // Newest first because that is the order the Form tab lists rows in: the
  // months a visitor actually looks at should fill in first (the set-stats
  // backfill in build-point-by-point.js learned this the hard way — ascending
  // key order left June/July at 0% while March sat at 100%).
  const MAX_HISTORICAL_STATS_FETCHES = Number(process.env.FORM_STATS_MAX_FETCHES || 250);
  const allUncached = [...uniqueEventKeys]
    .filter(k => !(k in historicalStatsCache))
    .sort((a, b) => (formRowDate.get(b) || '').localeCompare(formRowDate.get(a) || ''));
  const uncachedEventKeys = allUncached.slice(0, MAX_HISTORICAL_STATS_FETCHES);
  const deferredStats = allUncached.length - uncachedEventKeys.length;
  console.log(`Fetching real stats for ${uncachedEventKeys.length} uncached historical match(es) (${uniqueEventKeys.size - allUncached.length} already cached)...`);
  for (const eventKey of uncachedEventKeys) {
    const fixture = await fetchFixtureByMatchKey(eventKey);
    await new Promise(r => setTimeout(r, 150));
    if (fixture && fixture.first_player_key && fixture.second_player_key) {
      const matchStats = buildMatchStatsFromFixture(fixture, fixture.first_player_key, fixture.second_player_key);
      historicalStatsCache[eventKey] = matchStats
        ? { p1Key: fixture.first_player_key, p2Key: fixture.second_player_key, matchStats }
        : { matchStats: null };
    } else {
      historicalStatsCache[eventKey] = { matchStats: null };
    }
  }
  fs.writeFileSync(HISTORICAL_STATS_CACHE_PATH, JSON.stringify(historicalStatsCache, null, 2));

  let historicalStatsAttached = 0;
  for (const m of matches) {
    for (const [entries, ownKey] of [[m.p1RecentFormMatches, m.p1Key], [m.p2RecentFormMatches, m.p2Key]]) {
      if (!entries) continue;
      for (const entry of entries) {
        const cached = entry.eventKey ? historicalStatsCache[String(entry.eventKey)] : null;
        if (!cached || !cached.matchStats) continue;
        const isOwnFirst = String(cached.p1Key) === String(ownKey);
        entry.matchStats = isOwnFirst
          ? { own: cached.matchStats.p1, opp: cached.matchStats.p2 }
          : { own: cached.matchStats.p2, opp: cached.matchStats.p1 };
        historicalStatsAttached++;
      }
    }
  }
  const historicalStatsSuccessCount = [...uniqueEventKeys].filter(k => historicalStatsCache[k]?.matchStats).length;
  console.log(`${historicalStatsSuccessCount}/${uniqueEventKeys.size} unique historical matches got real stats from API-Tennis (rest not available from provider). Attached to ${historicalStatsAttached} Form-tab row(s).`);
  if (deferredStats) {
    // Say it out loud rather than letting partial coverage read as complete.
    console.log(`${deferredStats} Form-tab row(s) deferred — hit the ${MAX_HISTORICAL_STATS_FETCHES}-fetch/run cap; they resolve on later runs (cache is permanent).`);
  }

  // Preserve odds/bestOdds/oddsMovement patched in by the refreshers between
  // pipeline runs. The pipeline's own odds source (The Odds API) has no ATP 250
  // coverage (Bastad/Gstaad/Umag); refresh-scores.py and refresh-odds.py write
  // odds/bestOdds straight into matches.json, and refresh-odds-history.py writes
  // the per-book opening->now oddsMovement timeline. None of these are produced
  // by a full rebuild, so carry the prior values forward for any match this run
  // produced none for.
  const hasOdds = m => m && m.odds && m.odds.p1 && m.odds.p2;
  const hasMovement = m => m && m.oddsMovement && m.oddsMovement.books
    && Object.keys(m.oddsMovement.books).length > 0;
  try {
    const prior = JSON.parse(fs.readFileSync('matches.json', 'utf8'));
    const priorIndex = new Map();
    for (const pm of prior) {
      if (!hasOdds(pm) && !hasMovement(pm)) continue;
      priorIndex.set(`id:${pm.id}`, pm);
      priorIndex.set(`np:${pm.date}|${normalizeName(pm.p1)}|${normalizeName(pm.p2)}`, pm);
    }
    let preserved = 0, preservedMv = 0;
    for (const m of matches) {
      const pm = priorIndex.get(`id:${m.id}`)
        || priorIndex.get(`np:${m.date}|${normalizeName(m.p1)}|${normalizeName(m.p2)}`);
      if (!pm) continue;
      if (!hasOdds(m) && hasOdds(pm)) {
        m.odds = pm.odds;
        m.bestOdds = pm.bestOdds;
        preserved++;
      }
      if (!hasMovement(m) && hasMovement(pm)) {
        m.oddsMovement = pm.oddsMovement;
        preservedMv++;
      }
    }
    if (preserved) console.log(`Preserved odds on ${preserved} match(es) from the previous matches.json (refresher-patched, no rebuild coverage).`);
    if (preservedMv) console.log(`Preserved odds-movement history on ${preservedMv} match(es) from the previous matches.json.`);
  } catch (e) {
    // No prior matches.json (first run) — nothing to preserve.
  }

  // First-observed-finished timestamp. The tennis API gives no real match end
  // time, so the first run that sees a match as finished stamps finishedAt=now
  // (accurate to the ~15-min run cadence); later runs carry the original value
  // forward. The dashboard's "Past" filter drops a match 24h after finishedAt.
  const priorFinishedAt = new Map();
  try {
    const priorFa = JSON.parse(fs.readFileSync('matches.json', 'utf8'));
    for (const pm of priorFa) {
      if (!pm.finishedAt) continue;
      priorFinishedAt.set(`id:${pm.id}`, pm.finishedAt);
      priorFinishedAt.set(`np:${pm.date}|${normalizeName(pm.p1)}|${normalizeName(pm.p2)}`, pm.finishedAt);
    }
  } catch (e) {
    // No prior matches.json (first run) — every finished match is newly seen.
  }
  const nowIso = new Date().toISOString();
  for (const m of matches) {
    if (!m.finalScore) continue;
    m.finishedAt = priorFinishedAt.get(`id:${m.id}`)
      || priorFinishedAt.get(`np:${m.date}|${normalizeName(m.p1)}|${normalizeName(m.p2)}`)
      || nowIso;
  }

  // Opening / closing odds, derived from the real opening->now timeline the
  // odds-history refresher stored in m.oddsMovement — then PINNED into
  // matches.json and carried forward verbatim on every later rebuild.
  //
  // Persistence rule (CLAUDE.md non-negotiable: "closing odds must be preserved
  // through pipeline rebuilds — never recomputed at display time"): each value
  // is derived exactly ONCE and then frozen. On subsequent runs a match that
  // already carries an openingOdds/closingOdds inherits it unchanged rather than
  // being re-derived.
  //
  // Upcoming vs completed separation (display spec):
  //   openingOdds — first captured snapshot (reference book). Set for BOTH
  //                 upcoming and completed matches.
  //   closingOdds — last snapshot at/before match start. Set ONLY once a match
  //                 is completed (has a finalScore); an upcoming match NEVER
  //                 carries a closingOdds, so its Odds tab shows opening + the
  //                 movement-to-now trajectory only. closingOdds is stamped on
  //                 the first rebuild after the match finishes, then frozen.
  //
  // Reference book = whichever one already headlines m.odds (if it has a
  // timeline), else the book with the most captured points.
  const priorOdds = new Map();
  try {
    const priorO = JSON.parse(fs.readFileSync('matches.json', 'utf8'));
    for (const pm of priorO) {
      if (!pm.openingOdds && !pm.closingOdds) continue;
      const rec = { openingOdds: pm.openingOdds || null, closingOdds: pm.closingOdds || null };
      priorOdds.set(`id:${pm.id}`, rec);
      priorOdds.set(`np:${pm.date}|${normalizeName(pm.p1)}|${normalizeName(pm.p2)}`, rec);
    }
  } catch (e) {
    // No prior matches.json (first run) — nothing pinned to carry forward.
  }

  let openDerived = 0, openPreserved = 0, closeDerived = 0, closePreserved = 0;
  for (const m of matches) {
    const carried = priorOdds.get(`id:${m.id}`)
      || priorOdds.get(`np:${m.date}|${normalizeName(m.p1)}|${normalizeName(m.p2)}`);
    // Carry forward already-pinned values without recomputing them. A pinned
    // closing is only inherited for a completed match, so an upcoming match can
    // never resurrect a stale closing written by an earlier pipeline version.
    if (carried && carried.openingOdds) { m.openingOdds = carried.openingOdds; openPreserved++; }
    if (carried && carried.closingOdds && m.finalScore) { m.closingOdds = carried.closingOdds; closePreserved++; }

    const books = m.oddsMovement && m.oddsMovement.books;
    if (!books || !Object.keys(books).length) continue;
    const preferred = m.odds && m.odds.bookmaker;
    const ref = (preferred && books[preferred]) ? preferred
      : Object.keys(books).reduce((best, n) => {
          const len = (books[n].p1 || []).length + (books[n].p2 || []).length;
          const bl = best ? (books[best].p1 || []).length + (books[best].p2 || []).length : -1;
          return len > bl ? n : best;
        }, null);
    const s = ref && books[ref];
    const p1 = (s && s.p1) || [];
    const p2 = (s && s.p2) || [];
    if (!p1.length || !p2.length) continue;

    // openingOdds: first captured point. Pin once (skip if already inherited).
    if (!m.openingOdds) {
      const o1 = p1[0], o2 = p2[0];
      m.openingOdds = { p1: o1[1], p2: o2[1], bookmaker: ref, at: o1[0] };
      openDerived++;
    }

    // closingOdds: last point at/before match start — completed matches only,
    // and only if not already pinned from an earlier run.
    if (m.finalScore && !m.closingOdds) {
      const startMs = Date.parse(`${m.date}T${/^\d{2}:\d{2}/.test(m.time || '') ? m.time : '00:00'}:00Z`);
      const lastBeforeStart = arr => {
        if (!Number.isFinite(startMs)) return arr[arr.length - 1];
        let chosen = null;
        for (const pt of arr) { if (Date.parse(pt[0]) <= startMs) chosen = pt; }
        return chosen || arr[arr.length - 1];
      };
      const c1 = lastBeforeStart(p1), c2 = lastBeforeStart(p2);
      m.closingOdds = { p1: c1[1], p2: c2[1], bookmaker: ref, at: c1[0] };
      closeDerived++;
    }
  }
  console.log(`Odds snapshots — opening: ${openDerived} derived / ${openPreserved} preserved; closing (completed only): ${closeDerived} derived / ${closePreserved} preserved.`);

  // ---- Frozen Pinnacle opening line + base-state switch log ----
  // (Model v2.0 STEP 2; founder decision 2026-07-24.) The base-probability
  // model's State-2 anchor is the FIRST captured Pinnacle two-way line, frozen
  // so the anchor never drifts as tick history changes on later runs. Same
  // derive-once/pin/carry-forward rule as openingOdds above: derive from the
  // sane opening tick, write { p1, p2, ts, vfP1 } ONCE, inherit verbatim after,
  // and log the alt-book(State 1)/Elo(State 3) -> Pinnacle(State 2) switch the
  // first time a match freezes. Runs while m.oddsMovement is still attached
  // (before the odds shard strip below) and before matches.json is written, so
  // the frozen field persists. CLAUDE.md persistence rule: never recomputed.
  const { pinnacleSeries: pinSeriesFor, bookSeries: bookSeriesFor, vigFree: vigFreeFor } =
    require('./h2h-model/price');
  const altAnchorBooks = require('./h2h-model/config').marketAnchorBooks.alternatives;
  const priorPinOpen = new Map();
  try {
    const priorP = JSON.parse(fs.readFileSync('matches.json', 'utf8'));
    for (const pm of priorP) {
      if (!pm.pinnacleOpen) continue;
      priorPinOpen.set(`id:${pm.id}`, pm.pinnacleOpen);
      priorPinOpen.set(`np:${pm.date}|${normalizeName(pm.p1)}|${normalizeName(pm.p2)}`, pm.pinnacleOpen);
    }
  } catch (e) { /* first run — nothing pinned to carry forward */ }

  const pinSwitchEvents = [];
  let pinFrozen = 0, pinPreserved = 0;
  for (const m of matches) {
    const carried = priorPinOpen.get(`id:${m.id}`)
      || priorPinOpen.get(`np:${m.date}|${normalizeName(m.p1)}|${normalizeName(m.p2)}`);
    if (carried) { m.pinnacleOpen = carried; pinPreserved++; continue; } // never recompute
    const s = pinSeriesFor(m);
    if (!s || !s.opening) continue;
    const vf = vigFreeFor(s.opening.p1, s.opening.p2);
    if (!vf) continue;
    const pinBook = m.oddsMovement && m.oddsMovement.books && m.oddsMovement.books.Pinnacle;
    const ts = (pinBook && pinBook.p1 && pinBook.p1[0] && pinBook.p1[0][0]) || null;
    m.pinnacleOpen = { p1: s.opening.p1, p2: s.opening.p2, ts, vfP1: Math.round(vf.p1 * 1e4) / 1e4 };
    pinFrozen++;
    // Switch event: what was this match anchored on before Pinnacle appeared?
    let altAnchor = null;
    for (const b of altAnchorBooks) {
      const bs = bookSeriesFor(m, b);
      if (bs && bs.opening && bs.opening.vfP1 != null) {
        altAnchor = { book: b, vfP1: Math.round(bs.opening.vfP1 * 1e4) / 1e4 };
        break;
      }
    }
    pinSwitchEvents.push({
      id: m.id, date: m.date, p1: m.p1, p2: m.p2,
      from: altAnchor ? { state: 1, book: altAnchor.book, vfP1: altAnchor.vfP1 } : { state: 3 },
      to: { state: 2, book: 'Pinnacle', vfP1: m.pinnacleOpen.vfP1, ts },
      switchedAt: nowIso,
    });
  }
  if (pinFrozen || pinPreserved) {
    console.log(`Pinnacle opening line — ${pinFrozen} newly frozen, ${pinPreserved} preserved (never recomputed).`);
  }
  if (pinSwitchEvents.length) {
    let priorSwitches = [];
    try { priorSwitches = JSON.parse(fs.readFileSync('pinnacle-switch-log.json', 'utf8')); } catch (e) { /* none yet */ }
    const merged = priorSwitches.concat(pinSwitchEvents);
    writeJsonAtomic('pinnacle-switch-log.json', merged);
    console.log(`Logged ${pinSwitchEvents.length} base-state switch event(s) -> pinnacle-switch-log.json (${merged.length} total).`);
  }

  // Recent-form rows move OUT of matches.json into one lazy shard per player.
  //
  // Measured on the live file before this change: the two row arrays were
  // 975 KB — 27.7% of a 3.5 MB matches.json — and NOTHING on the page-load path
  // read a single one of them. Every reader (the Form tab, Recent Results) sits
  // behind openAnalysisModal, and the match card needs only the scalar
  // m.p1RecentForm pct, which stays right here. So a visitor was downloading a
  // quarter of the critical path to render nothing, on every visit.
  //
  // Sharded per PLAYER, not per match: a player appears on ~1.5 cards, and the
  // same rows were serialised once per card. Per-player means each row ships
  // once, and opening a second match with a shared player is a cache hit.
  // Same shape/convention as the pbp + setstats shards: derived output, rebuilt
  // every run from data already in hand, gitignored, published to _site.
  extractFormShards(matches);
  // Must run AFTER the opening/closing derivation above — that block reads the
  // timelines this one strips out.
  //
  // extractOddsShards nulls each m.oddsMovement (it moves to a lazy shard), but
  // the Tennis Edge Model runs LAST (buildModelOutput, below) and reads
  // m.oddsMovement.books.Pinnacle to price the "sharp" (Pinnacle) reference in
  // the Fair-price panel. Stripping first starved the model: it derived
  // sharp=null on the whole board, so every card read "Pinnacle — not quoted"
  // even when a clean Pinnacle series had been captured (it just lived only in
  // the shard by then). Snapshot the movement here so we can re-attach it to the
  // in-memory matches for the model without putting it back into matches.json.
  const oddsMovementForModel = new Map(matches.map(m => [m.id, m.oddsMovement]));
  extractOddsShards(matches);

  writeJsonAtomic('matches.json', matches);
  console.log(`Wrote ${matches.length} matches to matches.json`);
  const enriched = matches.filter(m => m.h2h !== null).length;
  console.log(`${enriched}/${matches.length} matches got real H2H/stats data (rest had no API-Tennis fixture match).`);

  console.log('Building player profiles for every player in this run...');
  const playerProfiles = await buildPlayerProfiles(matches, surfaceMap);

  // Career-record drill-down rows, for EVERY profiled player and their whole
  // career — not the 48 on today's board over 5 seasons, which is what
  // player-histories.json used to carry. Must run BEFORE player-profiles.json is
  // written: it strips the build-time careerMatches carrier off each profile and
  // stamps per-year row counts onto careerByYear.
  console.log('Building career-record drill-down shards...');
  await writeCareerHistoryShards(playerProfiles.players, { log: (m) => console.log(m) });

  writeJsonAtomic('player-profiles.json', playerProfiles, true);
  console.log(`Wrote player-profiles.json (${Object.keys(playerProfiles.players).length} player profile(s)).`);

  // Backfill the per-match embedded tournament histories (p1/p2TournamentHistory)
  // with the same pre-2021 archive used for the profiles, so the Today's Matches
  // detail agrees with the profile page (e.g. Zverev's full Wimbledon record, not
  // just the API's 2021+ slice). Reconciles by API player key via the profiles
  // just built. Idempotent + network-tolerant, then re-writes matches.json.
  console.log('Backfilling pre-2021 tournament history into match cards...');
  const matchBf = await backfillMatchesTournamentHistory(matches, playerProfiles.players, { log: (m) => console.log(m) });
  if (matchBf.patched > 0) {
    writeJsonAtomic('matches.json', matches);
    console.log(`Re-wrote matches.json with backfilled tournament history (${matchBf.patched} match-sides, ${matchBf.addedEditions} editions).`);
  }

  // Player Tournament Progression — round-by-round real stats for still-alive
  // players in whichever tournament(s) actually have matches this run (one
  // extra get_fixtures call per active tournament, full draw with statistics).
  const activeTournamentNames = [...new Set(matches.map(m => m.tour).filter(Boolean))];
  console.log(`Building tournament progression for ${activeTournamentNames.length} active tournament(s): ${activeTournamentNames.join(', ')}`);
  const progressionTournaments = {};
  for (const tourName of activeTournamentNames) {
    const progression = await buildTournamentProgression(tourName);
    // Keyed by the bare tournament name (stripping "ATP ") to match
    // TOURNAMENT_CATALOG's own `name` field, e.g. "Wimbledon" not "ATP
    // Wimbledon" — that's the key showTournamentProfile(key) actually
    // receives client-side, confirmed by reading TOURNAMENT_CATALOG.
    if (progression) progressionTournaments[tourName.replace(/^ATP\s+/, '').trim()] = progression;
  }
  writeJsonAtomic('tournament-progression.json', {
    fetchedAt: new Date().toISOString(),
    tournaments: progressionTournaments,
  });
  console.log(`Wrote tournament-progression.json (${Object.keys(progressionTournaments).length}/${activeTournamentNames.length} tournaments had enough finished rounds for a progression chart).`);

  // Rank-at-time sidecar (Step 2a): rebuild rank-at-time.json from the TML
  // archive the career backfill above just refreshed into tml-cache/, so the
  // model's quality-adjusted-form layer sees each recent-form opponent's rank
  // AS OF the match date (not today's rank). Best-effort: a failure leaves the
  // committed sidecar in place, and a missing sidecar makes rankOf() fall back
  // to current rank — i.e. exactly the pre-2a behaviour. Never blocks the model.
  try {
    require('child_process').execSync('node build-rank-at-time.js', { stdio: 'inherit' });
  } catch (e) {
    console.warn(`  rank-at-time rebuild skipped (${e.message}) — using committed sidecar / current-rank fallback.`);
  }

  // Tennis Edge Model — precompute the H2H engine output + pre-baked AI summary
  // for every match, for the static dashboard to fetch. MUST run last: the
  // engine reads the fresh matches.json / player-profiles.json /
  // tournament-progression.json this run just wrote (its loaders cache on first
  // read, and nothing has required the engine before now).
  console.log('Running the Tennis Edge Model engine over every match...');
  // Re-attach the pre-strip odds movement so the model can price the Pinnacle
  // (sharp) reference. Safe here: matches.json was already written (above, and
  // again by the tournament-history backfill) WITHOUT oddsMovement, and nothing
  // re-serialises matches after this point — so this in-memory re-attach feeds
  // the model without leaking the timelines back onto the page-load critical
  // path. Without it the Fair-price panel reads "Pinnacle — not quoted" boardwide.
  for (const m of matches) {
    if (!m.oddsMovement) {
      const saved = oddsMovementForModel.get(m.id);
      if (saved) m.oddsMovement = saved;
    }
  }
  await buildModelOutput(matches);
}

// ---- Tennis Edge Model: per-match model output + pre-baked AI summary ------
// The dashboard is a static site (GitHub Pages, no backend), so the Node H2H
// engine cannot run in the browser. We precompute runModel() for every match
// here and write model-output.json for the dashboard to fetch. Stage-4 AI
// summaries (summary.js) are baked in too, using ANTHROPIC_API_KEY from the
// pipeline environment — the key NEVER reaches the client. Each summary is
// cached by a SHA-1 of its model facts, so an API call is spent only when a
// match's numbers actually change (this pipeline runs every 15 min).
const MODEL_OUTPUT_PATH = 'model-output.json';

async function buildModelOutput(matches) {
  let runModel, generateSummary, buildFacts;
  try {
    ({ runModel } = require('./h2h-model/model'));
    ({ generateSummary, buildFacts } = require('./h2h-model/summary'));
  } catch (e) {
    // R&D-safe: a missing/broken engine must never take the whole pipeline down.
    console.warn(`Skipping model-output.json — H2H engine not loadable: ${e.message}`);
    return;
  }
  const crypto = require('crypto');

  // Prior output, so a summary whose facts are unchanged is reused rather than
  // regenerated — bounds Anthropic spend on the 15-min cron.
  let prior = {};
  try {
    const p = JSON.parse(fs.readFileSync(MODEL_OUTPUT_PATH, 'utf8'));
    prior = (p && p.matches) || {};
  } catch (_) { /* first run — no cache yet */ }

  const haveKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (!haveKey) {
    console.warn('  ANTHROPIC_API_KEY not set — engine output still written, AI summaries skipped (cached ones reused).');
  }

  const out = {};
  let ran = 0, failed = 0, sumNew = 0, sumCached = 0, sumSkipped = 0;

  for (const m of matches) {
    let result;
    try {
      result = runModel(m);
    } catch (e) {
      failed++;
      out[m.id] = { ok: false, reason: `engine error: ${e.message}` };
      continue;
    }
    if (!result.ok) {
      // Missing ELO/etc — store the reason + which sources were missing so the
      // UI can show an honest "not enough data" state (never a fabricated read).
      failed++;
      out[m.id] = { ok: false, reason: result.reason || 'model could not run',
        players: result.players || null };
      continue;
    }
    ran++;

    // Faithful, compact copy of the engine result. Every field is exactly what
    // runModel() produced — nothing is invented or reshaped.
    const entry = {
      ok: true,
      match: result.match,
      players: result.players,
      stage1: result.stage1,
      stage2: result.stage2,
      stage3: result.stage3,
      generatedAt: result.meta && result.meta.generatedAt,
      summary: null,
    };

    // ---- Stage 4: pre-baked AI summary, hash-cached ----
    const facts = buildFacts(result);
    const factsHash = crypto.createHash('sha1').update(JSON.stringify(facts)).digest('hex');
    const priorSum = prior[m.id] && prior[m.id].summary;
    if (priorSum && priorSum.ok && priorSum.factsHash === factsHash) {
      entry.summary = priorSum;            // numbers unchanged → reuse cached text
      sumCached++;
    } else if (haveKey) {
      const s = await generateSummary(result);
      if (s.ok) {
        entry.summary = { ok: true, text: s.summary, model: s.model,
          factsHash, generatedAt: new Date().toISOString() };
        sumNew++;
      } else {
        entry.summary = { ok: false, reason: s.reason, factsHash };
        sumSkipped++;
      }
    } else {
      entry.summary = { ok: false, reason: 'no ANTHROPIC_API_KEY at pipeline time', factsHash };
      sumSkipped++;
    }
    out[m.id] = entry;
  }

  writeJsonAtomic(MODEL_OUTPUT_PATH, {
    generatedAt: new Date().toISOString(),
    count: Object.keys(out).length,
    matches: out,
  }, true);
  console.log(`Wrote model-output.json — engine ran on ${ran}/${matches.length} (${failed} could not run). Summaries: ${sumNew} new, ${sumCached} cached, ${sumSkipped} skipped.`);
}

if (require.main === module) {
  runPipeline().catch(err => {
    console.error('Pipeline failed:', err);
    process.exit(1);
  });
}

module.exports = { fetchRecentSinglesFixtures, recentFormFromFixtures, buildTournamentProgression, extractProgressionMetrics, buildSetStatsFromFixture, buildMatchStatsFromFixture, extractFormShards, buildRecentFormForMatch,
  // The Career-record pair. Exported together on purpose: their whole contract
  // is that the counts one returns are tallyable from the rows the other
  // returns, and that is what ten8-career-verify.js asserts.
  buildAllTierYearly, playerMatchHistory, writeCareerHistoryShards };
