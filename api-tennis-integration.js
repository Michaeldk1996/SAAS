/**
 * BSP Consult — API-Tennis.com Integration
 * -----------------------------------------------------------------
 * Feeds the Head-to-Head, Overview, and Tournament tabs in the
 * dashboard's match-analysis modal with REAL data.
 *
 * Confirmed against API-Tennis.com's actual documentation
 * (https://api-tennis.com/documentation) — every endpoint below is
 * real, not guessed.
 *
 * STILL NOT COVERED BY THIS API (needs something else):
 * - Playing style classification — this is your own methodology, no
 *   vendor sells "style" as a field. You'll derive this yourself from
 *   the stats below (e.g. ace rate + net-related stats if available).
 * - Weather — a completely separate, unrelated API (e.g. OpenWeatherMap,
 *   WeatherAPI.com). Not researched yet.
 * - Recent "Form" specifically — not a single field; derive it by
 *   pulling a player's last N fixtures and computing win rate yourself.
 *
 * SETUP
 * -----
 * 1. Register at https://api-tennis.com/register
 * 2. Grab your API key from your account dashboard
 * 3. Add to .env: API_TENNIS_KEY=your_key_here
 * 4. npm install dotenv
 */

require('dotenv').config();

const API_TENNIS_KEY = process.env.API_TENNIS_KEY;
const BASE = 'https://api.api-tennis.com/tennis/';

// ---------------------------------------------------------------
// H2H TAB — real head-to-head history + each player's recent results
// ---------------------------------------------------------------
async function fetchH2H(firstPlayerKey, secondPlayerKey) {
  const url = `${BASE}?method=get_H2H&APIkey=${API_TENNIS_KEY}&first_player_key=${firstPlayerKey}&second_player_key=${secondPlayerKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.success) throw new Error('get_H2H request failed');
  return {
    headToHead: data.result.H2H,           // direct matches between these two
    p1RecentResults: data.result.firstPlayerResults,
    p2RecentResults: data.result.secondPlayerResults,
  };
}

// Derive a simple win/loss H2H record string (e.g. "3-1") from the raw H2H array.
function summarizeH2H(h2hMatches, player1Name) {
  let p1Wins = 0, p2Wins = 0;
  for (const m of h2hMatches) {
    const p1WasFirst = m.event_first_player === player1Name;
    const winnerIsFirst = m.event_winner === 'First Player';
    const p1Won = p1WasFirst ? winnerIsFirst : !winnerIsFirst;
    if (p1Won) p1Wins++; else p2Wins++;
  }
  return { p1Wins, p2Wins, record: `${p1Wins}-${p2Wins}` };
}

// ---------------------------------------------------------------
// OVERVIEW TAB — career stats broken down by surface, per season
// ---------------------------------------------------------------
async function fetchPlayerStats(playerKey) {
  const url = `${BASE}?method=get_players&APIkey=${API_TENNIS_KEY}&player_key=${playerKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.success) return null;
  return data.result?.[0] || null;
}

// Aggregate a player's SINGLES career win % on a given surface, across
// all seasons returned. CONFIRMED from real API response: the `stats`
// array mixes singles/doubles/mixed_doubles together under one list,
// and some seasons have "" (empty string) instead of a number for
// incomplete surface data — both must be handled or the sum breaks.
function surfaceWinRate(playerStats, surface) {
  const wonKey = `${surface}_won`;
  const lostKey = `${surface}_lost`;
  let won = 0, lost = 0;
  for (const season of playerStats.stats || []) {
    if (season.type !== 'singles') continue; // exclude doubles/mixed_doubles
    won += parseInt(season[wonKey], 10) || 0;   // "" or NaN safely becomes 0
    lost += parseInt(season[lostKey], 10) || 0;
  }
  const total = won + lost;
  return total > 0 ? Math.round((won / total) * 1000) / 10 : null;
}

// Current singles ranking — most recent season with a singles entry.
function currentSinglesRank(playerStats) {
  const singlesSeasons = (playerStats.stats || [])
    .filter(s => s.type === 'singles' && s.season && s.rank)
    .sort((a, b) => parseInt(b.season, 10) - parseInt(a.season, 10));
  return singlesSeasons[0]?.rank || null;
}

// ---------------------------------------------------------------
// TOURNAMENT TAB — round / draw context for a specific match
// ---------------------------------------------------------------
async function fetchFixtureDetail(matchKey) {
  const url = `${BASE}?method=get_fixtures&APIkey=${API_TENNIS_KEY}&match_key=${matchKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.success) return null;
  return data.result?.[0] || null; // includes tournament_round, tournament_season, etc.
}

// ---------------------------------------------------------------
// RANKINGS — for context (e.g. "#6 ATP" style display)
// ---------------------------------------------------------------
async function fetchStandings(eventType /* 'ATP' or 'WTA' */) {
  const url = `${BASE}?method=get_standings&APIkey=${API_TENNIS_KEY}&event_type=${eventType}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.success) return [];
  return data.result;
}

// ---------------------------------------------------------------
// EXAMPLE — pulling everything needed for one match's analysis modal
// ---------------------------------------------------------------
async function buildAnalysisData(firstPlayerKey, secondPlayerKey, p1Name, matchKey, surface) {
  const [h2h, p1Stats, p2Stats, fixtureDetail] = await Promise.all([
    fetchH2H(firstPlayerKey, secondPlayerKey),
    fetchPlayerStats(firstPlayerKey),
    fetchPlayerStats(secondPlayerKey),
    matchKey ? fetchFixtureDetail(matchKey) : null,
  ]);

  return {
    h2hRecord: summarizeH2H(h2h.headToHead, p1Name),
    p1SurfaceWinRate: surfaceWinRate(p1Stats, surface),
    p2SurfaceWinRate: surfaceWinRate(p2Stats, surface),
    tournamentRound: fixtureDetail?.tournament_round || null,
  };
}

module.exports = {
  fetchH2H, summarizeH2H, fetchPlayerStats, surfaceWinRate,
  fetchFixtureDetail, fetchStandings, buildAnalysisData,
};
