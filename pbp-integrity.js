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
 *     repeat. The exceptions are the deuce cycle (an advantage back to 40:40) and a gap in the list (15:0 -> 40:0, or an
 *     advantage straight to the other side's): a missing point is not an impossible sequence. An A is only valid
 *     against a 40. A blank entry (" - ") is not a point and is skipped, as every renderer already does.
 *   - Tiebreak: the rows of a set's tiebreak (less the provider's 7-6 set-closing row), in the order every renderer
 *     draws them (by running total), are numeric and monotonic. Neither side falls and no two rows share a running total (a repeated row is a duplicate).
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
      // advantage to the other side's advantage: the 40:40 between them is missing from the list, a gap like 15:0 -> 40:0
      const advSwap = (prev[0] === 4 && p[1] === 4) || (prev[1] === 4 && p[0] === 4);
      if (!forward && !deuceBack && !advSwap) {
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
    // The provider closes a tiebreak set with one more "Set N" row scored 7-6 (or 6-7) and no points, beside the tiebreak's
    // own "Set N TieBreak" rows (12172316 set 2: TieBreak 1..16 to 9-7, then Set 2 #13 "7 - 6"; 12170854 lists it first).
    // The stored log keeps only the set number, so that row looks like a second 7-6 tiebreak point. It is the set's result,
    // not a point: ONE pointless row scored 7-6 / 6-7 whose number is the set's game count + 1 (13 after 12 games) is left
    // out of the tiebreak check.
    let tbRows = rows.filter(isTbRow);
    const closerNo = rows.filter(isGame).length + 1;
    const closer = tbRows.findIndex(g => Number(g.g) === closerNo && /^\s*(7\s*-\s*6|6\s*-\s*7)\s*$/.test(String(g.score || '')));
    if (tbRows.length > 3 && closer >= 0) tbRows = tbRows.filter((_, i) => i !== closer);
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

  // ── REPAIR: deletion only (founder brief 2026-10-22, item 3) ──────────────────────────────────────────────────────────
  // Three provable provider duplicates are removed; nothing else is touched. A score is never changed, filled or guessed,
  // and every removal is returned so the caller can log it. What none of the rules can prove stays exactly as received.
  //   R1 'tiebreak-duplicate'  a tiebreak row repeating another row's number AND score: the first is kept
  //   R2 'repeated-score'      the same running score twice in a row (a game's points, or consecutive tiebreak rows): one kept
  //   R3 'replayed-game'       a game's points that run forward, then go back and replay: the first run is kept, ONLY if it
  //                            ends on a game point of the player the header says won the game (A, or 40 against < 40)
  const sameScore = (a, b) => String(a || '').replace(/\s+/g, '') === String(b || '').replace(/\s+/g, '');
  function gamePointFor(score, side) {
    const p = parsePoint(score);
    if (!p) return false;
    const [own, oth] = side === 'p1' ? p : [p[1], p[0]];
    return own === 4 || (own === 3 && oth < 3);
  }
  function repairSet(st, log) {
    const rows = Array.isArray(st && st.games) ? st.games : [];
    const closerNo = rows.filter(isGame).length + 1;
    const isCloser = g => Number(g.g) === closerNo && /^\s*(7\s*-\s*6|6\s*-\s*7)\s*$/.test(String(g.score || ''));
    const out = [];
    const seenTb = new Set();
    let prevTb = null, prevHeader = [0, 0];
    for (const g of rows) {
      if (isTbRow(g) && !isCloser(g)) {
        const key = `${g.g}|${String(g.score).replace(/\s+/g, '')}`;
        if (seenTb.has(key)) { log.push({ set: st.set, game: null, rule: 'tiebreak-duplicate', removed: [`#${g.g} ${String(g.score).trim()}`] }); continue; }
        if (prevTb && sameScore(prevTb.score, g.score)) { log.push({ set: st.set, game: null, rule: 'repeated-score', removed: [`#${g.g} ${String(g.score).trim()}`] }); continue; }
        seenTb.add(key); prevTb = g; out.push(g); continue;
      }
      if (!isGame(g)) { out.push(g); continue; }
      let points = g.points || [];
      const kept = [], dropped = [];
      for (const p of points) {
        const last = kept.filter(scored).slice(-1)[0];
        if (scored(p) && last && sameScore(last.s, p.s)) dropped.push(p); else kept.push(p);
      }
      if (dropped.length) log.push({ set: st.set, game: g.g, rule: 'repeated-score', removed: dropped.map(p => String(p.s).trim()) });
      points = kept;
      const h = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String(g.score || ''));
      const hd = h ? [+h[1] - prevHeader[0], +h[2] - prevHeader[1]] : null;
      const winner = hd && hd[0] === 1 && hd[1] === 0 ? 'p1' : hd && hd[0] === 0 && hd[1] === 1 ? 'p2' : null;
      if (h) prevHeader = [+h[1], +h[2]];
      const reason = gameReason(points);
      if (reason && /regresses|repeats/.test(reason) && winner) {
        const seq = points.filter(scored);
        const n = Number(/point (\d+)/.exec(reason)[1]);         // 1-based index of the first point that goes back
        const firstRun = seq.slice(0, n - 1);
        if (firstRun.length && !gameReason(firstRun) && gamePointFor(firstRun[firstRun.length - 1].s, winner)) {
          const cut = points.indexOf(seq[n - 1]);
          log.push({ set: st.set, game: g.g, rule: 'replayed-game', removed: points.slice(cut).map(p => String(p.s).trim()) });
          points = points.slice(0, cut);
        }
      }
      out.push(points === g.points ? g : Object.assign({}, g, { points }));
    }
    return Object.assign({}, st, { games: out });
  }
  // { sets, repairs } — the shard's sets with provable duplicates removed (a new object; the input is not changed).
  function repair(shard) {
    const repairs = [];
    const sets = ((shard && shard.sets) || []).map(st => repairSet(st, repairs));
    return { sets, repairs };
  }

  const api = { UNAVAILABLE, parsePoint, gameReason, tiebreakReason, checkSet, check, annotate, isGame, isTbRow, repair };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PbpIntegrity = api;
})(typeof window !== 'undefined' ? window : this);
