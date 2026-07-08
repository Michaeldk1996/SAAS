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
  return data.result;
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
  return (data.result || []).filter(f =>
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
  // Exclude pure exhibitions (e.g. Six Kings Slam, tagged "Exhibition Men" by
  // this API) — confirmed live these are NOT part of official ATP head-to-head
  // records. Laver Cup / United Cup matches are correctly tagged "Atp Singles"
  // by this API and DO count toward official H2H (confirmed), so they're kept.
  // Same event_type_type === 'Atp Singles' check already used and proven
  // correct in buildRecentFormData() below — applied here for consistency.
  const officialH2H = (data.result.H2H || []).filter(m => m.event_type_type === 'Atp Singles');

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
    p1RecentResults: data.result.firstPlayerResults,
    p2RecentResults: data.result.secondPlayerResults,
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
      // buildRecentFormData/loadTournamentProfiles for the same raw quirk.
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
      };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

// Year-by-year record at THIS specific tournament, reused straight from the
// tournament-profile match data already fetched/cached by
// loadTournamentProfiles() (allEditionMatches) — no new API calls needed,
// same principle as seasonRowFromFixtures reusing real match results instead
// of a separate aggregate. CONFIRMED GAP: qualifying-round matches are
// explicitly excluded when tournament profiles are built (see the
// `event_qualification === 'True'` filter in loadTournamentProfiles), so a
// separate qualifying-round record can't be derived from this data — would
// need its own fetch path per player/tournament, left out entirely rather
// than faked or half-built.
function roundLabel(round) {
  if (!round) return null;
  const parts = round.split(' - ');
  return parts.length > 1 ? parts[parts.length - 1].trim() : round.trim();
}
function buildTournamentHistory(profile, playerKey) {
  if (!profile || !profile.allEditionMatches) return null;
  const years = [];
  for (const edition of profile.allEditionMatches) {
    const playerMatches = (edition.matches || []).filter(m =>
      String(m.p1Key) === String(playerKey) || String(m.p2Key) === String(playerKey));
    if (playerMatches.length === 0) continue;
    let won = 0, lost = 0;
    for (const m of playerMatches) {
      const isP1 = String(m.p1Key) === String(playerKey);
      const didWin = (m.winner === 'First Player' && isP1) || (m.winner === 'Second Player' && !isP1);
      if (didWin) won++; else lost++;
    }
    const latest = playerMatches.reduce((a, b) => (b.date > a.date ? b : a));
    years.push({ year: edition.season, matchCount: playerMatches.length, won, lost, roundReached: roundLabel(latest.round) });
  }
  if (years.length === 0) return null;
  years.sort((a, b) => parseInt(b.year, 10) - parseInt(a.year, 10));
  return {
    editionsPlayed: years.length,
    totalWon: years.reduce((s, y) => s + y.won, 0),
    totalLost: years.reduce((s, y) => s + y.lost, 0),
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
function buildRecentFormData(recentResults, playerKey) {
  const hintKeys = Object.keys(TOURNAMENT_VENUE_HINTS);
  const clean = (recentResults || [])
    .filter(m => m.event_type_type === 'Atp Singles' && m.event_qualification === 'False')
    .slice()
    .sort((a, b) => new Date(b.event_date) - new Date(a.event_date));

  const matches = clean.map(m => {
    const isFirst = String(m.first_player_key) === String(playerKey);
    const opponent = isFirst ? m.event_second_player : m.event_first_player;
    const opponentKey = isFirst ? m.second_player_key : m.first_player_key;
    const won = isFirst ? m.event_winner === 'First Player' : m.event_winner === 'Second Player';
    // event_final_result is always "player1 sets - player2 sets", NOT
    // self-first — same raw-order quirk already fixed for tournament
    // champions. Reorder so it always reads as this player's own score first.
    let result = m.event_final_result;
    if (!isFirst && result && result.includes('-')) {
      const parts = result.split('-').map(s => s.trim());
      if (parts.length === 2) result = `${parts[1]} - ${parts[0]}`;
    }
    const surfaceKey = hintKeys.find(k => m.tournament_name && m.tournament_name.includes(k));
    return {
      opponent, opponentKey,
      date: m.event_date,
      tournament: m.tournament_name,
      round: m.tournament_round,
      surface: surfaceKey ? TOURNAMENT_VENUE_HINTS[surfaceKey].surface : null,
      result, won,
    };
  });

  const pct = matches.length ? Math.round((matches.filter(m => m.won).length / matches.length) * 1000) / 10 : null;
  return { pct, matches };
}

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

async function fetchAllTournaments() {
  const url = `${API_TENNIS_BASE}?method=get_tournaments&APIkey=${API_TENNIS_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.success) return [];
  return data.result;
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
    surfaces[t.tournament_key] = normalizeSurface(t.tournament_sourface);
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
  return data.result;
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
];

// Aggregates real per-match `statistics` entries for one player across a
// set of fixtures. Percentage stats (kind: 'pct') are weighted by summing
// each match's real stat_won/stat_total (not averaging pre-rounded
// percentages, which would skew toward short matches). Count stats
// (kind: 'count') are reported as a per-match average.
function aggregateStatsFromFixtures(fixtures, playerKey) {
  const totals = {};
  let matchCount = 0;
  for (const f of fixtures) {
    if (!Array.isArray(f.statistics) || f.statistics.length === 0) continue;
    const isFirst = String(f.first_player_key) === String(playerKey);
    const isSecond = String(f.second_player_key) === String(playerKey);
    if (!isFirst && !isSecond) continue;
    let matchHadStats = false;
    for (const stat of f.statistics) {
      if (String(stat.player_key) !== String(playerKey)) continue;
      const def = EXTRA_STAT_DEFS.find(d => d.type === stat.stat_type && d.name === stat.stat_name);
      if (!def) continue;
      matchHadStats = true;
      const key = `${def.type}:${def.name}`;
      if (!totals[key]) totals[key] = { won: 0, total: 0, sum: 0, kind: def.kind };
      if (def.kind === 'pct') {
        totals[key].won += Number(stat.stat_won) || 0;
        totals[key].total += Number(stat.stat_total) || 0;
      } else {
        totals[key].sum += parseInt(stat.stat_value, 10) || 0;
      }
    }
    if (matchHadStats) matchCount++;
  }
  if (matchCount === 0) return null;
  const stats = {};
  for (const [key, v] of Object.entries(totals)) {
    stats[key] = v.kind === 'pct'
      ? (v.total > 0 ? Math.round((v.won / v.total) * 1000) / 10 : null)
      : Math.round((v.sum / matchCount) * 10) / 10;
  }
  return { matchCount, stats };
}

async function buildExtraStats(p1Key, p2Key, surface, surfaceMap, p1CurrentYearFixtures, p2CurrentYearFixtures) {
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
// (Slams, Masters 1000s, ATP Finals, 500s, and the ATP 250s we could
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
  // Masters 1000
  'Indian Wells': { city: 'Indian Wells', country: 'US', category: 'Masters 1000', indoor: false, surface: 'hard' },
  'Miami': { city: 'Miami', country: 'US', category: 'Masters 1000', indoor: false, surface: 'hard' },
  'Monte Carlo': { city: 'Monaco', country: 'MC', category: 'Masters 1000', indoor: false, surface: 'clay' }, // "Monte Carlo" isn't in Open-Meteo's geocoding db; "Monaco" resolves correctly
  'Madrid': { city: 'Madrid', country: 'ES', category: 'Masters 1000', indoor: false, surface: 'clay' },
  'Rome': { city: 'Rome', country: 'IT', category: 'Masters 1000', indoor: false, surface: 'clay' },
  'Montreal': { city: 'Montreal', country: 'CA', category: 'Masters 1000', indoor: false, surface: 'hard' },
  'Toronto': { city: 'Toronto', country: 'CA', category: 'Masters 1000', indoor: false, surface: 'hard' },
  'Cincinnati': { city: 'Cincinnati', country: 'US', category: 'Masters 1000', indoor: false, surface: 'hard' },
  'Shanghai': { city: 'Shanghai', country: 'CN', category: 'Masters 1000', indoor: false, surface: 'hard' },
  'Paris': { city: 'Paris', country: 'FR', category: 'Masters 1000', indoor: true, surface: 'hard' }, // Paris Masters (indoor, distinct tournament_key from French Open)
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
    return data.result || [];
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
      // count*2 — confirmed real bug: Masters 1000 draws (Miami, Monte Carlo,
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
  fs.writeFileSync(TOURNAMENT_PROFILE_CACHE_PATH, JSON.stringify(output, null, 2));
  console.log('Tournament profiles rebuilt.');
  return output;
}

async function fetchMatchWeather(tournamentName, matchDateTimeISO, venueMap) {
  const key = Object.keys(venueMap).find(k => tournamentName.includes(k));
  if (!key) return null;
  const { lat, lon } = venueMap[key];

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,windspeed_10m,relative_humidity_2m&timezone=UTC`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const matchHour = new Date(matchDateTimeISO).toISOString().slice(0, 13) + ':00';
    const hourIndex = data.hourly.time.indexOf(matchHour);
    if (hourIndex === -1) return null;
    return {
      temperature: data.hourly.temperature_2m[hourIndex],
      windSpeed: data.hourly.windspeed_10m[hourIndex],
      humidity: data.hourly.relative_humidity_2m[hourIndex],
      source: 'Open-Meteo',
    };
  } catch (err) {
    console.error('Weather fetch failed:', err);
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

async function buildMatchObject(oddsEvent, apiTennisFixtures, surfaceMap, venueMap, tournamentProfiles) {
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
    h2h: null,
    p1SurfaceWinRate: null,
    p2SurfaceWinRate: null,
    p1Rank: null,
    p2Rank: null,
    p1RecentForm: null,
    p2RecentForm: null,
    p1RecentFormMatches: null,
    p2RecentFormMatches: null,
    p1Yearly: null,
    p2Yearly: null,
    p1TournamentHistory: null,
    p2TournamentHistory: null,
    extraStats: null,
    venue: null,
    weather: null, // from Open-Meteo, independent of API-Tennis fixture match
    live: false,
    liveStatus: null,
    liveScore: null,
    liveGameScore: null,
    liveServer: null,
  };

  // Weather doesn't depend on the API-Tennis fixture match, only on tournament + time
  match.weather = await fetchMatchWeather(oddsEvent.sport_title, oddsEvent.commence_time, venueMap);

  // Curated static reference facts (city/country/category/indoor) — same source
  // of truth as TOURNAMENT_VENUE_HINTS used for weather above, not a new lookup.
  const hintKey = Object.keys(TOURNAMENT_VENUE_HINTS).find(k => oddsEvent.sport_title.includes(k));
  const hint = hintKey ? TOURNAMENT_VENUE_HINTS[hintKey] : null;
  match.venue = hint ? { city: hint.city, country: hint.country, category: hint.category, indoor: hint.indoor } : null;

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
    const p1Form = buildRecentFormData(h2hData.p1RecentResults, p1Key);
    const p2Form = buildRecentFormData(h2hData.p2RecentResults, p2Key);
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
  const p1CurrentRow = seasonRowFromFixtures(p1CurrentFixtures, p1Key, currentYear, surfaceMap);
  const p2CurrentRow = seasonRowFromFixtures(p2CurrentFixtures, p2Key, currentYear, surfaceMap);

  match.p1Yearly = [p1CurrentRow, ...yearlyBreakdown(p1Stats)].filter(Boolean);
  match.p2Yearly = [p2CurrentRow, ...yearlyBreakdown(p2Stats)].filter(Boolean);

  // Real per-match serve/return/point stats — reuses p1CurrentFixtures/
  // p2CurrentFixtures already fetched above for the season row, plus one
  // extra fetch for the prior year (inside buildExtraStats) to guarantee
  // full 52-week coverage.
  match.extraStats = await buildExtraStats(p1Key, p2Key, surface, surfaceMap, p1CurrentFixtures, p2CurrentFixtures);

  // Year-by-year record at this specific tournament — reused from the
  // tournament-profile match data (allEditionMatches), no new API calls.
  const profile = hintKey ? tournamentProfiles?.[hintKey] : null;
  match.p1TournamentHistory = buildTournamentHistory(profile, p1Key);
  match.p2TournamentHistory = buildTournamentHistory(profile, p2Key);

  return match;
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

  // Loaded before match-building (moved up from its old post-matches spot) so
  // buildMatchObject() can reuse allEditionMatches for each match's real
  // year-by-year record at that specific tournament — no new API calls.
  console.log('Loading tournament profiles (draw size / champion / palmarès / per-edition match history — cached for 30 days)...');
  const tournamentProfiles = await loadTournamentProfiles();
  const profileCount = Object.values(tournamentProfiles.profiles).filter(Boolean).length;
  console.log(`Tournament profiles ready: ${profileCount}/${Object.keys(tournamentProfiles.profiles).length} tournaments have historical data on record.`);

  const matches = [];
  for (const event of oddsEvents) {
    matches.push(await buildMatchObject(event, apiTennisFixtures, surfaceMap, venueMap, tournamentProfiles.profiles));
  }

  fs.writeFileSync('matches.json', JSON.stringify(matches, null, 2));
  console.log(`Wrote ${matches.length} matches to matches.json`);
  const enriched = matches.filter(m => m.h2h !== null).length;
  console.log(`${enriched}/${matches.length} matches got real H2H/stats data (rest had no API-Tennis fixture match).`);
}

runPipeline().catch(err => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
