// =================================================================
// Layer #8 Winners/Unforced-Errors source resolver
// -----------------------------------------------------------------
// Founder spec (TEN-8, 2026-07-24): W/UE data has a strict source
// priority, and the two sources are NEVER mixed for the same match.
//
//   1. PRIMARY  — api-tennis.com. If the fixture's own stat sheet
//      carries Winners AND Unforced Errors, use them exclusively.
//   2. FALLBACK — @ATP_Entry OCR (atp-entry-wue.json). Used ONLY when
//      api-tennis has no W/UE for that fixture (the ~20% gap, ATP 250
//      level). FH+BH are summed to totals. Flagged source ATP_Entry_OCR.
//   3. Neither  — W/UE stays null; layer #8 is gated for that match.
//
// The decision is made at MATCH level (both players share one source),
// because api-tennis emits the Winners/UE rows per-fixture — it is all
// players or none — and the founder requires the sources never mix
// within a match. The chosen source is flagged on each player's `wue`
// object AND on `matchStats.wueSource` so downstream (layer #8, model
// output, dashboard) can always tell OCR-sourced from feed-sourced.
//
// This module is intentionally fail-soft: if atp-entry-wue.json is
// absent or malformed the fallback simply yields nothing and the
// pipeline runs exactly as before (CI never breaks on a missing corpus).
// =================================================================
const fs = require('fs');
const path = require('path');

function deaccent(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }

// Must match tools/build-atp-entry-wue.js exactly so the abbreviated feed
// name and the card's full name reduce to the same key.
function nameKey(name) {
  const p = deaccent(name).toLowerCase().replace(/&nbsp;/g, ' ').replace(/['’]/g, '').replace(/[.\-]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  return p.length < 2 ? null : p[p.length - 1] + '|' + p[0][0];
}
// Normalise a tournament name to a join slug. The live feed prefixes "ATP "
// (match.tour = "ATP Kitzbuhel"); the card corpus stores the bare city, so a
// leading "atp" token is stripped to make both sides collapse to "kitzbuhel".
function tourSlug(t) { return deaccent(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/^atp\s+/, '').replace(/\s+/g, ''); }

// Lazy, memoised index: `${tourSlug}::${sortedPairKey}` -> row.
let _index = null;
function ocrIndex() {
  if (_index !== null) return _index;
  _index = new Map();
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'atp-entry-wue.json'), 'utf8');
    const data = JSON.parse(raw);
    for (const row of (data.rows || [])) {
      _index.set(`${row.tourSlug}::${row.matchKey}`, row);
    }
  } catch (_) {
    // no corpus (or unreadable) -> empty index, fallback yields nothing.
  }
  return _index;
}

// Winners / Unforced Errors as stored by extractStatPairFromRows when
// api-tennis actually supplies them. Keys mirror MATCH_STAT_DEFS casing
// (`Points:Winners`, `Points:Unforced errors`). Returns totals or null.
function apiTennisWue(playerStats) {
  if (!playerStats) return null;
  const w = playerStats['Points:Winners'];
  const ue = playerStats['Points:Unforced errors'];
  if (typeof w !== 'number' || typeof ue !== 'number') return null;
  return { winners: w, unforcedErrors: ue };
}

function ratioOf(winners, unforcedErrors) {
  // Same convention as the progression winnersUnforcedRatio: 2dp, null when
  // UE is zero (an undefined / infinite ratio is not a signal).
  if (typeof winners !== 'number' || typeof unforcedErrors !== 'number' || unforcedErrors <= 0) return null;
  return Math.round((winners / unforcedErrors) * 100) / 100;
}

// Build the per-player `wue` object for the OCR fallback path. Carries the
// stored derived fields (winnersPct / unforcedErrorsPct — winners|UE over the
// api-tennis total-points denominator, joined at harvest time) so the fallback
// exposes the same percentage surface the api-tennis path does downstream.
// Falls back to a live-computed ratio if the corpus predates the derived fields.
function ocrWue(o, row) {
  return {
    winners: o.winners,
    unforcedErrors: o.unforcedErrors,
    ratio: o.winnersUnforcedRatio != null ? o.winnersUnforcedRatio : ratioOf(o.winners, o.unforcedErrors),
    winnersPct: o.winnersPct != null ? o.winnersPct : null,
    unforcedErrorsPct: o.unforcedErrorsPct != null ? o.unforcedErrorsPct : null,
    totalPointsPlayed: row.totalPointsPlayed != null ? row.totalPointsPlayed : null,
    wingSplit: { fhWinners: o.fhWinners, bhWinners: o.bhWinners, fhUnforced: o.fhUnforced, bhUnforced: o.bhUnforced },
    source: 'ATP_Entry_OCR', card: row.card,
  };
}

// Resolve the W/UE source for one match and attach `wue` to each player of
// `matchStats`, plus `matchStats.wueSource`. Mutates and returns matchStats.
// `matchStats` is the {p1,p2} object from buildMatchStatsFromFixture (may be
// null). `tour` / `p1Name` / `p2Name` come from the match object.
function attachWue(matchStats, tour, p1Name, p2Name) {
  if (!matchStats) return matchStats;

  // 1. PRIMARY: api-tennis. Only counts if BOTH players carry W/UE (per-match
  //    all-or-nothing) — otherwise the match is not truly feed-sourced.
  const apiP1 = apiTennisWue(matchStats.p1);
  const apiP2 = apiTennisWue(matchStats.p2);
  if (apiP1 && apiP2) {
    matchStats.wueSource = 'api-tennis';
    matchStats.p1.wue = { ...apiP1, ratio: ratioOf(apiP1.winners, apiP1.unforcedErrors), source: 'api-tennis' };
    matchStats.p2.wue = { ...apiP2, ratio: ratioOf(apiP2.winners, apiP2.unforcedErrors), source: 'api-tennis' };
    return matchStats;
  }

  // 2. FALLBACK: @ATP_Entry OCR — only when api-tennis has no W/UE.
  const k1 = nameKey(p1Name);
  const k2 = nameKey(p2Name);
  if (k1 && k2) {
    const pairKey = [k1, k2].sort().join('+');
    const row = ocrIndex().get(`${tourSlug(tour)}::${pairKey}`);
    if (row && row.players[k1] && row.players[k2]) {
      matchStats.wueSource = 'ATP_Entry_OCR';
      matchStats.p1.wue = ocrWue(row.players[k1], row);
      matchStats.p2.wue = ocrWue(row.players[k2], row);
      return matchStats;
    }
  }

  // 3. Neither source has W/UE for this match — layer #8 stays gated.
  matchStats.wueSource = null;
  return matchStats;
}

// Progression-path lookup. The Tournament Reports round/progression charts are
// built by buildTournamentProgression() straight from raw api-tennis fixture
// statistics — a DIFFERENT code path and data shape from attachWue's {p1,p2}
// matchStats object — so they need the same OCR fallback surfaced by name pair.
// Given the tournament and both players' names, returns { winners, unforcedErrors }
// (FH+BH totals) for `playerName` from the reviewed @ATP_Entry card, or null when
// the corpus has no row for that pair. Callers must invoke this ONLY when
// api-tennis carries no W/UE for the fixture, preserving the never-mix rule.
function lookupWue(tour, playerName, opponentName) {
  const k1 = nameKey(playerName);
  const k2 = nameKey(opponentName);
  if (!k1 || !k2) return null;
  const pairKey = [k1, k2].sort().join('+');
  const row = ocrIndex().get(`${tourSlug(tour)}::${pairKey}`);
  if (!row || !row.players[k1]) return null;
  const o = row.players[k1];
  if (typeof o.winners !== 'number' || typeof o.unforcedErrors !== 'number') return null;
  return { winners: o.winners, unforcedErrors: o.unforcedErrors };
}

module.exports = { attachWue, lookupWue, nameKey, tourSlug, ratioOf };
