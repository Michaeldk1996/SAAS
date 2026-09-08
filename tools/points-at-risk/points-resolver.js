'use strict';
/**
 * points-resolver.js — TEN-173 ATP points-at-risk resolver (main tour, rolling-52).
 *
 * Joins  tier (atp-tier-map-v1.json)  x  draw size (per-season edition)  x
 * round reached  ->  points (atp-points-table-v1.json), per player per event,
 * summed over the trailing 52 weeks = points-at-risk.
 *
 * LOCKED RULINGS (TEN-172): rolling-52 window; main tour only; full tier map.
 *
 * ROUND MODEL (verified against live api-tennis, TEN-173):
 *   - A fixture's round is resolved by round-classify.js (the TEN-160 single
 *     source of truth). `1/64-finals`->R128, `1/32-finals`->R64, `1/16`->R32,
 *     `1/8`->R16, Quarter-finals->QF, Semi-finals->SF, Final->F.
 *   - A player's points at an event = points for the round they LOST in (or W
 *     if they won the Final). The "round they lost" is the round code of their
 *     deepest main-draw match, when they did not win it.
 *
 * BYE INFERENCE (rulebook §9.03 G.2, verbatim): "Any player who reaches the
 *   second round by drawing a bye and then loses shall be considered to have
 *   lost in the first round and shall receive first round loser's points."
 *   => a player who (a) entered above the edition's first round (no first-round
 *   match: a bye) and (b) lost their first and only match is credited the
 *   FIRST-round loser cell, not the (deeper) cell of the match they lost.
 *   Byes emit no fixture, so this is inferred from the draw's first round.
 *
 * QUALIFIER BONUS (§9.03 G.3): a player who came THROUGH qualifying into the
 *   main draw gets Q_into_MD added on top of their main-draw points.
 *
 * MISSING DATA IS A DASH, never a zero/plausible default (guardrail). A real
 * first-round loss worth 0 points at a 250/500 is a genuine 0, not a dash —
 * the two are distinguished: dash => points:null + reason; 0 => points:0.
 */

const { classifyRound, ROUND_RANK } = require('./round-classify.js');
const { validateEdition, nextPow2, isPlayed } = require('./round-integrity-qa.js');

const MS_PER_WEEK = 7 * 24 * 3600 * 1000;

// tiers whose points are NOT a function of round reached -> dash unless a
// special formula is separately authorised (TEN-172 §6).
const NON_ROUND_TIERS = new Set(['NittoATPFinals', 'NextGenFinals', 'UnitedCup', 'WTL', 'DavisCup', 'Olympics', 'LaverCup']);

// map our tier-map tier -> points-table top-level key.
const TIER_TO_TABLE = {
  GrandSlam: 'GrandSlam',
  Masters1000: 'Masters1000',
  ATP500: 'ATP500',
  ATP250: 'ATP250',
};

/** ISO date (YYYY-MM-DD) -> ms. */
function dms(d) { return new Date(String(d) + 'T00:00:00Z').getTime(); }

/** Monday (UTC) of the week containing date d, as ms. */
function mondayOf(d) {
  const t = new Date(dms(d));
  const dow = (t.getUTCDay() + 6) % 7; // 0 = Monday
  return dms(d) - dow * 24 * 3600 * 1000;
}

/**
 * The award (ranking) Monday for an event edition = the Monday AFTER its last
 * match (rulebook §9.01 D/E: points enter on the Monday following the event).
 * Exceptions the caller may pass in `opts`: Nitto ATP Finals and ITF second-
 * Monday rule (§9.01 D/E) — hard-coded at the call site, not guessed here.
 */
function awardMonday(lastMatchDate) {
  return mondayOf(lastMatchDate) + MS_PER_WEEK; // Monday following the final
}

/** Choose the points-table draw-size row: smallest row >= actual draw size. */
function drawSizeKey(tierTable, drawSize) {
  const keys = Object.keys(tierTable).map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
  for (const k of keys) if (k >= drawSize) return String(k);
  return keys.length ? String(keys[keys.length - 1]) : null; // fallback: largest
}

/**
 * Resolve one player's points at ONE tournament edition.
 *
 * @param {object} args
 * @param {object[]} args.editionFixtures  ALL fixtures for the (tournament,season)
 *        — needed for the round-integrity gate and first-round/bye inference.
 * @param {number|string} args.playerKey
 * @param {object} args.tierInfo   tier-map row: { tier, draw_size, confirmed, ... }
 * @param {object} args.pointsTable the loaded atp-points-table-v1.json
 * @param {boolean=} args.completed edition finished? (default true)
 * @returns {{points:?number, key:?string, dash:boolean, flags:string[], reason:string,
 *            awardMs:?number}}
 */
function resolveEdition({ editionFixtures, playerKey, tierInfo, pointsTable, completed = true }) {
  const flags = [];
  const pk = String(playerKey);

  // ---- non-round (team) event gate -----------------------------------------
  // An edition with no PLAYED round-based match is a team / round-robin event
  // (empty tournament_round) -> dash by rule, regardless of whether it is in
  // the tier map. Signal (TEN-172 §6): empty round labels.
  const hasRoundMatch = editionFixtures.some((fx) => isPlayed(fx) && String(fx.tournament_round || '').trim() && ROUND_RANK[classifyRound({
    tournamentRound: fx.tournament_round, qualification: fx.event_qualification, isGrandSlam: fx.isGrandSlam,
    tournamentName: fx.tournament_name, finalScore: fx.event_final_result, status: fx.event_status,
  }).code] != null);
  if (!hasRoundMatch) {
    return { points: null, key: null, dash: true, flags: ['non-round-event'], reason: 'non-round / team event (empty round labels) — dash by rule', awardMs: null };
  }

  // ---- tier gate -----------------------------------------------------------
  const tier = tierInfo && tierInfo.tier;
  if (!tier || tierInfo.confirmed === false) {
    return { points: null, key: null, dash: true, flags: ['tier-unconfirmed'], reason: 'tier not confirmed in map', awardMs: null };
  }
  // PER-SEASON FAIL-CLOSED (TEN-172 condition 2): a tier is confirmed for the
  // SEASON it was sourced for, never inherited forward. If the map declares
  // `confirmed_seasons` and this edition's season is not among them, dash —
  // an unconfirmed edition is a fail, never an assumed value. When the map
  // omits `confirmed_seasons` entirely we fall back to the boolean `confirmed`
  // (legacy rows), but the tier map SHOULD carry confirmed_seasons.
  if (Array.isArray(tierInfo.confirmed_seasons) && tierInfo.season != null) {
    const seasons = tierInfo.confirmed_seasons.map(String);
    if (!seasons.includes(String(tierInfo.season))) {
      return { points: null, key: null, dash: true, flags: ['tier-season-unconfirmed'],
        reason: `tier ${tier} not confirmed for season ${tierInfo.season} (confirmed: ${seasons.join(',') || 'none'}) — fail closed`, awardMs: null };
    }
  }
  if (NON_ROUND_TIERS.has(tier)) {
    return { points: null, key: null, dash: true, flags: ['non-round-event'], reason: `non-round event (${tier}) — dash unless a special formula is authorised`, awardMs: null };
  }
  const tableKey = TIER_TO_TABLE[tier];
  if (!tableKey || !pointsTable[tableKey]) {
    return { points: null, key: null, dash: true, flags: ['tier-no-table'], reason: `no points-table block for tier ${tier}`, awardMs: null };
  }

  // ---- draw size (per-season edition, inferred from the bracket) -----------
  // prefer the map's per-season draw size; else infer from the edition itself.
  let drawSize = tierInfo.draw_size || null;
  const qa = validateEdition(editionFixtures, { drawSize: drawSize || undefined, completed });
  if (!drawSize) drawSize = qa.expectedDraw || null;

  // ---- round-integrity gate (FAIL-CLOSED) ----------------------------------
  if (!qa.ok) {
    return { points: null, key: null, dash: true, flags: ['round-integrity-fail', ...qa.violations.slice(0, 2)], reason: `round-integrity gate failed: ${qa.violations[0]}`, awardMs: null };
  }
  if (!drawSize) {
    return { points: null, key: null, dash: true, flags: ['draw-size-unknown'], reason: 'draw size unresolved', awardMs: null };
  }

  const tierTable = pointsTable[tableKey];
  const dsKey = drawSizeKey(tierTable, drawSize);
  const cells = dsKey ? tierTable[dsKey] : null;
  if (!cells) {
    return { points: null, key: null, dash: true, flags: ['draw-row-missing'], reason: `no ${tableKey} row for draw ${drawSize}`, awardMs: null };
  }

  // ---- classify this player's matches at the edition -----------------------
  const mine = [];
  for (const fx of editionFixtures) {
    if (!isPlayed(fx)) continue; // ignore cancelled / live-in-progress fixtures
    const isMine = String(fx.first_player_key) === pk || String(fx.second_player_key) === pk;
    if (!isMine) continue;
    const cls = classifyRound({
      tournamentRound: fx.tournament_round, qualification: fx.event_qualification,
      isGrandSlam: fx.isGrandSlam, tournamentName: fx.tournament_name,
      finalScore: fx.event_final_result, status: fx.event_status,
    });
    const won = matchWon(fx, pk);
    mine.push({ code: cls.code, qualifying: cls.qualifying, won, date: fx.event_date, status: fx.event_status });
  }
  if (!mine.length) {
    return { points: null, key: null, dash: false, flags: ['not-in-draw'], reason: 'player has no fixtures at this edition', awardMs: null };
  }

  const awardMs = awardMonday(mine.map((m) => m.date).sort().slice(-1)[0]);
  const mainMatches = mine.filter((m) => !m.qualifying && ROUND_RANK[m.code] != null);
  const qualMatches = mine.filter((m) => m.qualifying);

  // ---- MAIN-DRAW result ----------------------------------------------------
  if (mainMatches.length) {
    // deepest = highest ROUND_RANK; the player LOST there unless they won the Final.
    mainMatches.sort((a, b) => ROUND_RANK[a.code] - ROUND_RANK[b.code]);
    const deepest = mainMatches[mainMatches.length - 1];
    const shallowestMine = mainMatches[0];

    // the edition's actual first round (shallowest present main-draw round).
    const firstRoundCode = editionFirstRound(editionFixtures);

    let key;
    if (deepest.code === 'F' && deepest.won) {
      key = 'W'; // champion
    } else {
      key = deepest.code; // lost in this round
      // BYE CORRECTION (§9.03 G.2): a bye only ever skips the FIRST round, so a
      // byed player enters EXACTLY one round above the edition's first round.
      // If they then lost that first & only match, credit first-round loser
      // points. Requiring "exactly one round above" (not merely "above") is
      // what stops a coverage gap — a QF loser whose R64/R32/R16 fixtures are
      // missing — from being mistaken for a bye.
      const byes = nextPow2(drawSize) - drawSize;
      const enteredSecondRound = firstRoundCode != null
        && ROUND_RANK[shallowestMine.code] === ROUND_RANK[firstRoundCode] + 1;
      const lostFirstAndOnly = mainMatches.length === 1 && !deepest.won;
      if (byes > 0 && enteredSecondRound && lostFirstAndOnly) {
        key = firstRoundCode;
        flags.push('bye-first-round-correction');
      }
    }

    let pts = cells[key];
    if (pts === undefined) {
      return { points: null, key, dash: true, flags: [...flags, 'round-cell-absent'], reason: `no ${tableKey}[${dsKey}] cell for ${key}`, awardMs };
    }
    if (pts === null) {
      return { points: null, key, dash: true, flags: [...flags, 'round-cell-null'], reason: `${key} not applicable to a ${drawSize} draw`, awardMs };
    }

    // qualifier bonus (§9.03 G.3): came through qualifying into the main draw.
    if (qualMatches.length && qualMatches.some((q) => q.won)) {
      const bonus = cells.Q_into_MD;
      if (typeof bonus === 'number') { pts += bonus; flags.push('qualifier-bonus'); }
    }
    return { points: pts, key, dash: false, flags, reason: 'main-draw result', awardMs };
  }

  // ---- QUALIFYING-only result (lost in qualifying, never reached MD) --------
  if (qualMatches.length) {
    // deepest qualifying round the player played; did they lose it?
    qualMatches.sort((a, b) => (ROUND_RANK[a.code] || 0) - (ROUND_RANK[b.code] || 0));
    const deepestQ = qualMatches[qualMatches.length - 1];
    // final qualifying round in the edition = deepest qualifying round present.
    const finalQCode = editionFinalQualRound(editionFixtures);
    const lostFinalQ = deepestQ.code === finalQCode && !deepestQ.won;
    const key = lostFinalQ ? 'Q_final_round_loss' : 'Q_earlier_round_loss';
    let pts = cells[key];
    if (pts == null) {
      // non-Slam earlier qualifying loss is 0 by rule (table null) — real 0.
      pts = 0;
      flags.push('qual-early-zero');
    }
    return { points: pts, key, dash: false, flags, reason: 'qualifying-only result', awardMs };
  }

  return { points: null, key: null, dash: true, flags: ['no-classifiable-match'], reason: 'no main or qualifying match resolved', awardMs };
}

/** Did the player win this fixture? Uses event_winner + player slot. */
function matchWon(fx, pk) {
  const w = String(fx.event_winner || '').toLowerCase();
  const isFirst = String(fx.first_player_key) === String(pk);
  if (w.includes('first')) return isFirst;
  if (w.includes('second')) return !isFirst;
  // fallback: some feeds put the winner slot as '1'/'2'
  if (w === '1') return isFirst;
  if (w === '2') return !isFirst;
  return null; // unknown -> treated as not-a-win by callers that need a boolean
}

/** The edition's first (shallowest) main-draw round code. */
function editionFirstRound(editionFixtures) {
  let best = null; let bestRank = Infinity;
  for (const fx of editionFixtures) {
    if (!isPlayed(fx)) continue;
    const cls = classifyRound({
      tournamentRound: fx.tournament_round, qualification: fx.event_qualification,
      isGrandSlam: fx.isGrandSlam, tournamentName: fx.tournament_name,
      finalScore: fx.event_final_result, status: fx.event_status,
    });
    if (cls.qualifying) continue;
    const r = ROUND_RANK[cls.code];
    if (r != null && r < bestRank) { bestRank = r; best = cls.code; }
  }
  return best;
}

/** The edition's final (deepest) qualifying round code. */
function editionFinalQualRound(editionFixtures) {
  let best = null; let bestRank = -Infinity;
  for (const fx of editionFixtures) {
    if (!isPlayed(fx)) continue;
    const cls = classifyRound({
      tournamentRound: fx.tournament_round, qualification: fx.event_qualification,
      isGrandSlam: fx.isGrandSlam, tournamentName: fx.tournament_name,
      finalScore: fx.event_final_result, status: fx.event_status,
    });
    if (!cls.qualifying) continue;
    const r = ROUND_RANK[cls.code] || 0;
    if (r > bestRank) { bestRank = r; best = cls.code; }
  }
  return best;
}

module.exports = {
  resolveEdition, drawSizeKey, awardMonday, mondayOf, editionFirstRound,
  matchWon, MS_PER_WEEK, NON_ROUND_TIERS,
};
