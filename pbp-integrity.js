/*
 * pbp-integrity.js — per-game integrity check for the point-by-point log (pbp/{eventKey}.json).
 *
 * WHY THIS EXISTS
 * ---------------
 * api-tennis sometimes serves a finished match's point list garbled: the real sequence, then a replay of part of it
 * (Bonzi v Norrie, Lyon R32, event 12172010: set 1 game 9 stored as 15:0 30:0 40:0 30:0 40:0 30:0 40:0). The feed later
 * replaces it with the clean list, but build-point-by-point.js caches a finished match's log on first fetch, so the
 * garbled copy is what the shard holds. This module decides, per game, whether a stored sequence can be shown. It never
 * repairs one: a game that fails renders a dash and "Point-by-point unavailable for this game", never a guessed subset.
 *
 * THE RULES
 *   - Game: the running scores (0/15/30/40/A) only move forward. Neither side's count may fall and the score may not
 *     repeat. The one exception is the deuce cycle: from an advantage (A:40 / 40:A) back to 40:40. An A is only valid
 *     against a 40. A blank entry (" - ") is not a point and is skipped, as every renderer already does.
 *   - Tiebreak: the rows of a set's tiebreak, in the order every renderer draws them (by running total), are numeric
 *     and monotonic. Neither side falls and no two rows share a running total (a repeated row is a duplicate).
 *   - Game header (the running set score, e.g. 4·2): kept only if it moves on from the previous game's header (0-0
 *     before the first) with neither side falling. A repeated or backwards header is a duplicated game row.
 *
 * Classification of a set's rows is the dashboard's own (pbpSplitSet) and the tiebreak floor's (isTiebreakRow): a row
 * with any tennis point (15/30/40/A) is a game; a row with no points and an integer score is a tiebreak point; anything
 * else (the one-row set summary) is not drawn and not checked.
 *
 * Pure. Loaded by the dashboard (<script src>, window.PbpIntegrity, applied once in loadPbpShard so every renderer sees
 * the same verdict) and required by Node (build-point-by-point.js logs the failing event keys; the wiring test).
 */
(function (root) {
  'use strict';

  const GP = { '0': 0, '15': 1, '30': 2, '40': 3, 'A': 4 };
  const TENNIS_POINT = /15|30|40|A/;
  const UNAVAILABLE = 'Point-by-point unavailable for this game';

  const scored = p => /[0-9A]/i.test(String((p && p.s) || ''));
  function parsePoint(s) {
    const m = /^\s*(0|15|30|40|A)\s*-\s*(0|15|30|40|A)\s*$/i.exec(String(s || ''));
    if (!m) return null;
    const a = GP[m[1].toUpperCase()], b = GP[m[2].toUpperCase()];
    if ((a === 4 && b !== 3) || (b === 4 && a !== 3)) return null;   // an advantage only exists against a 40
    return [a, b];
  }
  function parseGames(sc) {
    const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String(sc || ''));
    return m ? [+m[1], +m[2]] : null;
  }
  const isGame = g => (g && g.points || []).some(p => TENNIS_POINT.test((p && p.s) || ''));
  const isTbRow = g => !!g && !isGame(g) && !(g.points || []).length && !!parseGames(g.score);

  // null = valid, else a short reason naming the first bad point (1-based, among scored points).
  function gameReason(points) {
    const seq = (points || []).filter(scored);
    let prev = [0, 0];
    for (let i = 0; i < seq.length; i++) {
      const p = parsePoint(seq[i].s);
      if (!p) return `point ${i + 1} unreadable (${String(seq[i].s).trim()})`;
      const forward = p[0] >= prev[0] && p[1] >= prev[1] && (p[0] !== prev[0] || p[1] !== prev[1]);
      const deuceBack = (prev[0] === 4 || prev[1] === 4) && p[0] === 3 && p[1] === 3;
      if (!forward && !deuceBack) {
        const verb = p[0] === prev[0] && p[1] === prev[1] ? 'repeats' : 'regresses';
        return `point ${i + 1} ${verb} (${String(seq[i - 1] ? seq[i - 1].s : '0 - 0').trim()} -> ${String(seq[i].s).trim()})`;
      }
      prev = p;
    }
    return null;
  }

  // Tiebreak rows in draw order (running total, then p1's points), then the monotonic check.
  function tiebreakReason(rows) {
    const pts = rows.map(g => parseGames(g.score)).sort((x, y) => (x[0] + x[1]) - (y[0] + y[1]) || x[0] - y[0]);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (a[0] + a[1] === b[0] + b[1]) return `duplicate tiebreak row at ${b[0]}-${b[1]}`;
      if (b[0] < a[0] || b[1] < a[1]) return `tiebreak regresses (${a[0]}-${a[1]} -> ${b[0]}-${b[1]})`;
    }
    return null;
  }

  // One set's verdict. games: one entry per checked game row, in stored order.
  function checkSet(st) {
    const out = { set: st && st.set, games: [], tb: null };
    const rows = (st && Array.isArray(st.games)) ? st.games : [];
    let prev = [0, 0];
    for (const g of rows) {
      if (!isGame(g)) continue;
      const h = parseGames(g.score);
      let headerOk = false;
      if (h) {
        // Monotonic and further on: a game missing from the log leaves a jump (3-1 after 1-1) and the header is still the
        // set's real score; a repeated or backwards header is a duplicated game row and is not.
        headerOk = h[0] >= prev[0] && h[1] >= prev[1] && h[0] + h[1] > prev[0] + prev[1];
        prev = h;
      }
      out.games.push({ g: g.g, row: g, pointsReason: gameReason(g.points), headerOk });
    }
    const tbRows = rows.filter(isTbRow);
    if (tbRows.length >= 3) out.tb = { rows: tbRows.length, reason: tiebreakReason(tbRows) };
    return out;
  }

  // Every failing game / tiebreak of a shard, flat. [] = the whole log is drawable.
  function check(shard) {
    const issues = [];
    for (const st of ((shard && shard.sets) || [])) {
      const v = checkSet(st);
      for (const x of v.games) {
        if (x.pointsReason) issues.push({ set: v.set, game: x.g, kind: 'points', reason: x.pointsReason });
        if (!x.headerOk) issues.push({ set: v.set, game: x.g, kind: 'header', reason: `header ${String(x.row.score).trim()} repeats or goes back from the previous game` });
      }
      if (v.tb && v.tb.reason) issues.push({ set: v.set, game: null, kind: 'tiebreak', reason: v.tb.reason });
    }
    return issues;
  }

  // Stamp the verdict onto the shard's own rows, once: g.pbpBad (points not drawable), g.pbpHdrBad (header not drawable),
  // set.pbpTbBad (tiebreak rows not drawable). Renderers read only these flags. Returns the issues (cached on the shard).
  function annotate(shard) {
    if (!shard || !Array.isArray(shard.sets)) return [];
    if (shard.pbpIssues) return shard.pbpIssues;
    for (const st of shard.sets) {
      const v = checkSet(st);
      for (const x of v.games) {
        if (x.pointsReason) x.row.pbpBad = x.pointsReason;
        if (!x.headerOk) x.row.pbpHdrBad = true;
      }
      if (v.tb && v.tb.reason) st.pbpTbBad = v.tb.reason;
    }
    const issues = check(shard);
    Object.defineProperty(shard, 'pbpIssues', { value: issues, enumerable: false });
    return issues;
  }

  const api = { UNAVAILABLE, parsePoint, gameReason, tiebreakReason, checkSet, check, annotate, isGame, isTbRow };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PbpIntegrity = api;
})(typeof window !== 'undefined' ? window : this);
