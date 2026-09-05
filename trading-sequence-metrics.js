#!/usr/bin/env node
/**
 * trading-sequence-metrics.js — TEN-151 Trading Report, the 11 situational splits
 * beyond Key Stats. Pure functions over ONE api-tennis fixture, so the generator
 * and the validation harness compute the SAME numbers from the SAME code.
 *
 * SOURCE: the fixture already fetched per player (fetchRecentSinglesFixtures) —
 * `scores[]` (per-set games) and `pointbypoint[]` (per-game: server, winner,
 * whether serve was lost, running games score, and per-point break/set/match
 * flags), both inline in the SAME get_fixtures window. Zero extra API cost.
 *   Verified live 2026-09-05 (player 2072 window): every finished fixture carries
 *   `pointbypoint` with fields set_number "Set N", number_game, player_served /
 *   serve_winner / serve_lost ∈ {"First Player","Second Player",null}, score
 *   "g - g" (first-second games AFTER the game).
 *
 * Every metric is returned as [numerator, denominator] for THIS match, summed by
 * the generator over the 24-month window exactly like the Key Stats metrics. A
 * situation that never arises contributes [0,0] (absent) — NEVER a zero-filled
 * rate. Missing orientation (player not in the fixture) or missing winner
 * (match-outcome metrics only) yields no contribution for the affected metric.
 *
 * DEFINITIONS ARE WORKED OUT, NOT INHERITED (founder instruction 2026-09-05:
 * "work out the eleven remaining abbreviations yourself"). Each is stated in one
 * line here and MUST match the column-info tooltip verbatim in trading-report.js —
 * the tooltip is the founder's required "column info affordance". Where the
 * competitor's intent is genuinely ambiguous from the abbreviation, the chosen
 * definition is defensible tennis-trading semantics and is falsifiable on the
 * board because the number computes exactly what the tooltip says.
 *
 * The 11 (verbatim abbreviation -> shard key):
 *   HTWS         -> htws     Held To Win Set    (serving for the set, held to take it)
 *   HTSS         -> htss     Held To Stay in Set (serving to avoid losing the set, held)
 *   BOFS         -> bofs     Broke Opponent's First Service game of the match
 *   BFSG         -> bfsg     Broken in own First Service Game of the match
 *   BABB         -> babb     Broke then Broken Back in the same set (lead surrendered)
 *   BBK          -> bbk      Broken Back immediately — opp breaks straight back next game
 *   BBKB         -> bbkb     Broke-Broken-Back-then-Broke again — re-broke after being broken back
 *   GFB          -> gfb      Got First Break of the match
 *   LOST SET 1 FB-> ls1fb    Lost Set 1, Fought Back to WIN THE MATCH
 *   LOST SET 1 BF-> ls1bf    Lost Set 1, then Broke First in Set 2
 *   BFS2AWS1     -> bfs2aws1 Broke First in Set 2 After Winning Set 1
 */
'use strict';

// The 5 set-outcome splits whose meaning is unambiguous from the header (founder
// named these directly): won first set, won set 2, won set 1 then set 2 (2-0),
// lost set 1 then won set 2, won set 1 then won match. Score-only (scores[] +
// event_winner). Built alongside the 11 worked-out codes; all summed identically.
//   wfs -> Won First Set                     ws2    -> Won Set 2
//   ws1w2 -> Won Set 1 → Won Set 2 (2-0 up)  ls1ws2 -> Lost Set 1 → Won Set 2
//   ws1wm -> Won Set 1 → Won Match
const SEQ_KEYS = [
  // worked-out (game-sequence + set-1-conditioned) — see header block
  'htws', 'htss', 'bofs', 'bfsg', 'babb', 'bbk', 'bbkb', 'gfb', 'ls1fb', 'ls1bf', 'bfs2aws1',
  // named set-outcome (score-only)
  'wfs', 'ws2', 'ws1w2', 'ls1ws2', 'ws1wm',
];

// Orientation: which side of the fixture is the target player. Returns 'first',
// 'second', or null (player absent — the fixture contributes nothing).
function sideOf(fx, playerKey) {
  const pk = String(playerKey);
  if (String(fx.first_player_key) === pk) return 'first';
  if (String(fx.second_player_key) === pk) return 'second';
  return null;
}

// Did side `me` win the match? null when the feed carries no winner.
function matchWinner(fx, me) {
  const w = fx.event_winner;
  if (w === 'First Player') return me === 'first';
  if (w === 'Second Player') return me === 'second';
  return null;
}

// Per-set games for the target side from scores[]. Returns array indexed by set
// number (1-based) of { mine, theirs, decided, won } — decided requires a real,
// unequal, terminal-looking score. Undecided/blank sets are excluded downstream.
function setsFromScores(fx, me) {
  const out = {};
  const arr = Array.isArray(fx.scores) ? fx.scores : [];
  for (const s of arr) {
    const n = Number(s.score_set);
    if (!Number.isFinite(n) || n < 1) continue;
    // api-tennis encodes a tiebreak set as "7.7"/"6.3": integer part = games
    // (7-6), decimal = tiebreak points. Truncate to games for set outcome.
    const a = Math.trunc(Number(s.score_first)), b = Math.trunc(Number(s.score_second));
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const mine = me === 'first' ? a : b;
    const theirs = me === 'first' ? b : a;
    const played = (a + b) > 0;
    // Terminal set: a winner reached 6 (2-game margin) or 7 (7-5 / 7-6). Match
    // tiebreaks (e.g. 10-x deciders) also read as a>=... — accept any unequal
    // score where the leader has >=6; drops in-progress/blank/malformed sets.
    const hi = Math.max(a, b), lo = Math.min(a, b);
    const terminal = played && a !== b && hi >= 6 && (hi - lo >= 2 || hi === 7 || hi >= 10);
    out[n] = { mine, theirs, played, decided: terminal, won: terminal && mine > theirs };
  }
  return out;
}

// Parse pointbypoint into ordered games grouped by set. Each game:
//   { set, order, server:'first'|'second', winner, broke:bool, breaker, gfBefore, gsBefore }
// gfBefore/gsBefore = first/second games in the set BEFORE this game (reconstructed
// by accumulation; the feed's per-game `score` is the count AFTER the game).
function gamesFromPbp(fx) {
  const pbp = Array.isArray(fx.pointbypoint) ? fx.pointbypoint : [];
  const bySet = {};
  const norm = (v) => v === 'First Player' ? 'first' : v === 'Second Player' ? 'second' : null;
  // Which set numbers actually went to a tiebreak (carry a "Set N TieBreak" block).
  // Only those sets get the phantom-decider drop below, so a genuine advantage
  // final-set game legitimately scored 7-6/8-7 is never dropped.
  const tbSets = new Set();
  for (const g of pbp) {
    if (/tie\s*break/i.test(String(g.set_number || ''))) {
      const n = Number(String(g.set_number).replace(/[^0-9]/g, ''));
      if (Number.isFinite(n)) tbSets.add(n);
    }
  }
  let order = 0;
  for (const g of pbp) {
    const rawSet = String(g.set_number || '');
    // api-tennis emits tiebreak points as their own "Set N TieBreak" pseudo-games
    // (with serve_lost set on mini-holds) AND a phantom deciding game "Set N g13"
    // scored "7 - 6" to mark the tiebreak result. Neither is a real service game;
    // counting their serve_lost as a break corrupts every break-sequence metric.
    // Drop both: tiebreak blocks by name, the phantom decider by its 7-6 signature
    // BUT only in sets that actually had a tiebreak (never a real advantage game).
    if (/tie\s*break/i.test(rawSet)) continue;
    const setN = Number(rawSet.replace(/[^0-9]/g, ''));
    if (!Number.isFinite(setN) || setN < 1) continue;
    if (tbSets.has(setN)) {
      const sc = String(g.score || '').split('-').map(x => Number(x.trim()));
      if (sc.length === 2) {
        const hi = Math.max(sc[0], sc[1]), lo = Math.min(sc[0], sc[1]);
        if (hi === 7 && lo === 6) continue;        // phantom tiebreak-set decider
      }
    }
    const server = norm(g.player_served);
    const winner = norm(g.serve_winner);
    if (!server || !winner) continue;
    const broke = g.serve_lost != null;           // server lost serve => a break
    (bySet[setN] = bySet[setN] || []).push({
      setN, order: order++, server, winner, broke,
      breaker: broke ? winner : null,              // returner won the game
    });
  }
  // reconstruct before-scores per set (games are in feed order within a set)
  for (const setN of Object.keys(bySet)) {
    let gf = 0, gs = 0;
    for (const g of bySet[setN]) {
      g.gfBefore = gf; g.gsBefore = gs;
      if (g.winner === 'first') gf++; else gs++;
    }
  }
  return bySet;                                    // { setN: [game,...] }
}

// P is serving for the set: winning THIS service game clinches the set for P.
// Standard game states 5-0..5-4 and 6-5 (7-5). Excludes 6-6 (tiebreak).
function servingForSet(myG, oppG) {
  return (myG === 5 && oppG <= 4) || (myG === 6 && oppG === 5);
}
// P is serving to stay in the set: losing THIS service game (a break) loses the
// set for P. Mirror of the opponent serving for the set on the return.
function servingToStay(myG, oppG) {
  return (oppG === 5 && myG <= 4) || (oppG === 6 && myG === 5);
}

// Compute all 11 as [num,den] for one fixture relative to playerKey.
// Returns an object keyed by shard key; absent situations are omitted (== [0,0]).
function sequenceMetrics(fx, playerKey) {
  const me = sideOf(fx, playerKey);
  if (!me) return {};
  const opp = me === 'first' ? 'second' : 'first';
  const sets = setsFromScores(fx, me);
  const games = gamesFromPbp(fx);
  const wonMatch = matchWinner(fx, me);
  const out = {};
  const set2 = (k, num, den) => { out[k] = [num, den]; };

  // ── HTWS / HTSS — serving-for-set and serving-to-stay conversion (per game) ──
  let htwsN = 0, htwsD = 0, htssN = 0, htssD = 0;
  // ── BOFS / BFSG — first service game of the match, each side (match-level) ──
  // ── GFB — first break of the whole match ──
  let firstServeSeen = { first: false, second: false };
  let bofsD = 0, bofsN = 0, bfsgD = 0, bfsgN = 0;
  let matchFirstBreakBreaker = null;
  const allGames = Object.keys(games)
    .map(Number).sort((a, b) => a - b)
    .flatMap((n) => games[n]);
  for (const g of allGames) {
    const myG = me === 'first' ? g.gfBefore : g.gsBefore;
    const oppG = me === 'first' ? g.gsBefore : g.gfBefore;
    if (g.server === me) {
      if (servingForSet(myG, oppG)) { htwsD++; if (g.winner === me) htwsN++; }
      if (servingToStay(myG, oppG)) { htssD++; if (g.winner === me) htssN++; }
    }
    // opponent's first service game of the match
    if (g.server === opp && !firstServeSeen[opp]) {
      firstServeSeen[opp] = true;
      bofsD++; if (g.broke && g.breaker === me) bofsN++;
    }
    // my first service game of the match
    if (g.server === me && !firstServeSeen[me]) {
      firstServeSeen[me] = true;
      bfsgD++; if (g.broke && g.breaker === opp) bfsgN++;   // I was broken
    }
    if (g.broke && matchFirstBreakBreaker === null) matchFirstBreakBreaker = g.breaker;
  }
  if (htwsD) set2('htws', htwsN, htwsD);
  if (htssD) set2('htss', htssN, htssD);
  if (bofsD) set2('bofs', bofsN, bofsD);
  if (bfsgD) set2('bfsg', bfsgN, bfsgD);
  if (matchFirstBreakBreaker !== null) set2('gfb', matchFirstBreakBreaker === me ? 1 : 0, 1);

  // ── BABB / BBK / BBKB — break / break-back dynamics (per set) ──
  let babbN = 0, babbD = 0;        // sets P broke; P later broken back in-set
  let bbkN = 0, bbkD = 0;          // P break games with a following P serve; broken straight back
  let bbkbN = 0, bbkbD = 0;        // of BABB sets, P re-broke after being broken back
  for (const n of Object.keys(games).map(Number)) {
    const gs = games[n];
    const myBreaks = gs.filter((g) => g.broke && g.breaker === me);
    if (!myBreaks.length) continue;
    babbD++;                                             // P achieved a break this set
    // immediate break-back (BBK): the next P-service-game after each break
    let firstBreakOrder = myBreaks[0].order;
    for (const b of myBreaks) {
      const nextServe = gs.find((g) => g.server === me && g.order > b.order);
      if (!nextServe) continue;                          // no following service game in set
      bbkD++;
      if (nextServe.broke && nextServe.breaker === opp) bbkN++;
    }
    // was P broken back later in the set (after first break)?
    const brokenBackGames = gs.filter((g) => g.broke && g.breaker === opp && g.order > firstBreakOrder);
    if (brokenBackGames.length) {
      babbN++;
      // BBKB: after the (first) break-back, did P break again in the set?
      bbkbD++;
      const firstBackOrder = brokenBackGames[0].order;
      const reBroke = gs.some((g) => g.broke && g.breaker === me && g.order > firstBackOrder);
      if (reBroke) bbkbN++;
    }
  }
  if (babbD) set2('babb', babbN, babbD);
  if (bbkD) set2('bbk', bbkN, bbkD);
  if (bbkbD) set2('bbkb', bbkbN, bbkbD);

  // ── Named set-outcome splits (score-only) ──
  const s1 = sets[1], s2 = sets[2];
  if (s1 && s1.decided) {
    set2('wfs', s1.won ? 1 : 0, 1);                              // won first set
    if (wonMatch != null) set2('ws1wm', s1.won ? (wonMatch ? 1 : 0) : 0, s1.won ? 1 : 0);  // won s1 -> won match
  }
  if (s2 && s2.decided) {
    set2('ws2', s2.won ? 1 : 0, 1);                              // won set 2
    if (s1 && s1.decided && s1.won) set2('ws1w2', s2.won ? 1 : 0, 1);   // won s1 -> won s2 (2-0)
    if (s1 && s1.decided && !s1.won) set2('ls1ws2', s2.won ? 1 : 0, 1); // lost s1 -> won s2
  }

  // ── LOST SET 1 FB / LOST SET 1 BF / BFS2AWS1 — set-1 conditioned splits ──
  if (s1 && s1.decided) {
    if (!s1.won && wonMatch != null) set2('ls1fb', wonMatch ? 1 : 0, 1);   // lost s1, won match
    // set-2 first-break splits (need set 2 games with a break)
    const s2games = games[2] || [];
    const s2break = s2games.find((g) => g.broke);
    if (s2break) {
      const pBrokeFirstS2 = s2break.breaker === me ? 1 : 0;
      if (!s1.won) set2('ls1bf', pBrokeFirstS2, 1);       // lost s1, broke first in s2
      if (s1.won) set2('bfs2aws1', pBrokeFirstS2, 1);     // won s1, broke first in s2
    }
  }

  return out;
}

module.exports = { sequenceMetrics, SEQ_KEYS, setsFromScores, gamesFromPbp };
