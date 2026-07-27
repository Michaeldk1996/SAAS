// Tournament entries builder (TEN-8 / ten8-news-updates, 2026-07-27).
//
// Produces `tournament-entries.json` — for each CURRENT ATP-main-tour singles
// tournament, the roster of players actually in it, enriched with ATP ranking
// and nationality. This powers the News page's tournament filter: pick a
// tournament and the feed narrows to articles that mention a player in that draw.
//
// ─── IMPORTANT: why this is fixtures-derived, not an "entry list" endpoint ───
// api-tennis has NO entry-list / draw / seed endpoint. Its catalogue is a fixed
// nine methods (the API's own 404 enumerates them): get_events, get_tournaments,
// get_fixtures, get_livescore, get_H2H, get_standings, get_players, get_odds,
// get_live_odds. Probed live three times (2026-07-17, -26, -27) — get_entry_list
// / get_entries / get_tournament_entries all 404, and no field anywhere carries
// a seed. So the participant roster is DERIVED from get_fixtures: a fixture only
// materialises once BOTH players are known, i.e. as the draw is made / play
// begins. Consequences the caller must know:
//   • No SEEDS — not available in api-tennis. `seed` is always null here.
//   • Roster fills IN as the draw populates; it is not a pre-draw acceptance
//     list. Early in a tournament week only the players with a scheduled/played
//     match appear. It converges to the full main draw as rounds are played.
//   • Ranking + nationality come from get_standings (live ATP), joined by
//     player_key.
//
// Best-effort, exactly like build-news-feed.js: any failure keeps the previous
// tournament-entries.json (from the pipeline cache) and never blocks the deploy.

const fs = require('fs');
try { require('dotenv').config({ quiet: true }); } catch (_) { /* dotenv optional */ }

const API_TENNIS_KEY = process.env.API_TENNIS_KEY;
const API_TENNIS_BASE = 'https://api.api-tennis.com/tennis/';
const OUT_PATH = 'tournament-entries.json';

// Look back far enough to capture rounds already played this tournament week and
// a little ahead for freshly-published early rounds. ATP events run ~7 days.
// get_fixtures caps the span at 7 days, so keep (LOOKBACK+LOOKAHEAD) <= 6.
const LOOKBACK_DAYS = 5;
const LOOKAHEAD_DAYS = 1;
const MIN_PLAYERS = 2; // ignore tournaments with a near-empty roster

function ymd(d) { return d.toISOString().slice(0, 10); }

// "D. Schwartzman" / "Diego Schwartzman" → "Schwartzman" (surname for the
// News page's article name-matching). Keeps multi-word surnames intact.
function surnameOf(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  return n.replace(/^(?:[A-Z]\.\s*)+/, '')       // strip leading initials "T. M. "
          .replace(/^[A-Z][a-z]+\s+(?=[A-Z])/, '') // strip a leading full first name
          .trim();
}

async function apiGet(params) {
  const url = `${API_TENNIS_BASE}?APIkey=${API_TENNIS_KEY}&${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${params.split('&')[0]}`);
  const payload = JSON.parse(await res.text());
  if (!payload || !Array.isArray(payload.result)) {
    throw new Error(`unexpected shape for ${params.split('&')[0]}: ${JSON.stringify(payload).slice(0, 160)}`);
  }
  return payload.result;
}

// Live ATP standings → player_key → { rank, country, points }.
async function loadStandings() {
  try {
    const rows = await apiGet('method=get_standings&event_type=ATP');
    const map = new Map();
    for (const r of rows) {
      if (r && r.player_key != null) {
        map.set(String(r.player_key), {
          rank: Number(r.place) || null,
          country: r.country || null,
          points: r.points != null ? Number(r.points) : null,
        });
      }
    }
    return map;
  } catch (err) {
    console.error(`tournament-entries: standings unavailable (${err.message}) — rosters will lack rank/country.`);
    return new Map();
  }
}

// tournament_key → surface, from the static get_tournaments catalogue.
async function loadSurfaces() {
  try {
    const rows = await apiGet('method=get_tournaments');
    const map = new Map();
    for (const t of rows) {
      if (t && t.tournament_key != null && t.tournament_sourface) {
        map.set(String(t.tournament_key), String(t.tournament_sourface));
      }
    }
    return map;
  } catch (err) {
    console.error(`tournament-entries: get_tournaments unavailable (${err.message}) — surfaces omitted.`);
    return new Map();
  }
}

async function main() {
  if (!API_TENNIS_KEY) {
    console.error('tournament-entries: API_TENNIS_KEY not set — skipping (site deploy unaffected).');
    return;
  }

  const now = new Date();
  const start = new Date(now.getTime() - LOOKBACK_DAYS * 864e5);
  const stop = new Date(now.getTime() + LOOKAHEAD_DAYS * 864e5);
  const dateStart = ymd(start);
  const dateStop = ymd(stop);

  let fixtures;
  try {
    fixtures = await apiGet(`method=get_fixtures&date_start=${dateStart}&date_stop=${dateStop}`);
  } catch (err) {
    console.error(`tournament-entries: get_fixtures failed (${err.message}) — keeping previous ${OUT_PATH}.`);
    return;
  }

  const [standings, surfaces] = await Promise.all([loadStandings(), loadSurfaces()]);

  // Keep ATP singles main-draw fixtures only. event_qualification is the STRING
  // 'True'/'False' (truthy either way in JS) — compare explicitly so qualifying
  // matches don't leak into the main-draw roster.
  const isAtpSingles = f => /atp/i.test(f.event_type_type || '') && /single/i.test(f.event_type_type || '');
  const byTournament = new Map();
  for (const f of fixtures) {
    if (!isAtpSingles(f)) continue;
    if (String(f.event_qualification) === 'True') continue; // main draw only
    const tKey = String(f.tournament_key);
    if (!byTournament.has(tKey)) {
      byTournament.set(tKey, {
        tournamentKey: tKey,
        // tournament_name carries a round suffix ("Washington - Quarter-finals");
        // strip it to the bare event name.
        name: String(f.tournament_name || '').replace(/\s*-\s*[^-]+$/, '').trim() || String(f.tournament_name || ''),
        season: f.tournament_season || null,
        surface: surfaces.get(tKey) || null,
        players: new Map(),
      });
    }
    const t = byTournament.get(tKey);
    for (const side of [['first_player_key', 'event_first_player'], ['second_player_key', 'event_second_player']]) {
      const pk = f[side[0]];
      const pname = f[side[1]];
      if (pk == null || !pname) continue;
      const key = String(pk);
      if (!t.players.has(key)) {
        const s = standings.get(key) || {};
        t.players.set(key, {
          key,
          name: String(pname),
          surname: surnameOf(pname),
          rank: s.rank || null,       // ATP ranking (get_standings); null if unranked/missing
          country: s.country || null, // nationality (get_standings)
          seed: null,                 // NOT available in api-tennis — see header note
        });
      }
    }
  }

  const tournaments = [...byTournament.values()]
    .map(t => ({
      tournamentKey: t.tournamentKey,
      name: t.name,
      season: t.season,
      surface: t.surface,
      playerCount: t.players.size,
      // roster ordered by ATP rank (unranked last) so the strongest names lead.
      players: [...t.players.values()].sort((a, b) => (a.rank || 9e9) - (b.rank || 9e9)),
    }))
    .filter(t => t.playerCount >= MIN_PLAYERS)
    .sort((a, b) => b.playerCount - a.playerCount);

  const out = {
    generatedAt: now.toISOString(),
    window: { start: dateStart, stop: dateStop },
    source: 'api-tennis get_fixtures (roster) + get_standings (rank/country)',
    note: 'Fixtures-derived rosters — api-tennis has no entry-list/seed endpoint. ' +
          'Seeds are unavailable (always null); the roster fills in as the draw is played, ' +
          'not a pre-draw acceptance list.',
    tournamentCount: tournaments.length,
    tournaments,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(out));
  const summary = tournaments.map(t => `${t.name} (${t.playerCount})`).join(', ');
  console.log(`tournament-entries: wrote ${tournaments.length} ATP tournaments to ${OUT_PATH} — ${summary || 'none in window'}.`);
}

if (require.main === module) {
  main().catch(err => {
    // Never let this break the deploy.
    console.error('tournament-entries: unexpected error —', err && err.message);
  });
}

module.exports = { surnameOf };
