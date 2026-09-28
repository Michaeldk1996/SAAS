// house-ratings.js — the ONE Serve rating and ONE Return rating (founder ruling 2026-09-28, TEN-327:
// "one formula per stat name"; rules: .claude/rules/modal-analysis.md "One formula per stat name").
//
//   Serve  = 1st-in % + 1st-won % + 2nd-won % + service games won % + aces − double faults
//   Return = 1st-return-won % + 2nd-return-won % + return games won % + break points converted %
//
// Per match the aces / double faults are the match's raw counts; per season they are per-match
// averages. The ATP leaderboards list these components (atptour.com/en/stats/leaderboard,
// boardType=serve / return); the arithmetic is the house formula ruled 2026-08-29 (TEN-103).
// Any missing component → no rating (the caller shows "—", never a partial sum), and a Return
// rating with 0 break-point chances has none (0/0 converted is not 0%). Summed unrounded; round
// once, at display.
//
// Loaded by the dashboard (<script src>, before live-tab.js / player-profile-v2.js use it) and
// required by h2h-model/adjustments.js in Node. Hand-written; nothing regenerates it.
(function (root) {
  'use strict';
  var SERVE_TERMS = ['1st serve %', '1st serve points won', '2nd serve points won', 'service games won', 'aces', 'double faults'];
  var RETURN_TERMS = ['1st return points won', '2nd return points won', 'return games won', 'break points converted'];

  function fin(v) { return v != null && v !== '' && isFinite(Number(v)) ? Number(v) : null; }
  function sum(vals, names, negate) {
    var missing = [], v = 0;
    for (var i = 0; i < names.length; i++) {
      var x = fin(vals[i]);
      if (x == null) { missing.push(names[i]); continue; }
      v += negate[i] ? -x : x;
    }
    return missing.length ? { v: null, missing: missing } : { v: v, missing: [] };
  }
  /** p = { firstIn, firstWon, secondWon, svGames, aces, dfs } — rates in %, aces/dfs counts. */
  function serve(p) {
    p = p || {};
    return sum([p.firstIn, p.firstWon, p.secondWon, p.svGames, p.aces, p.dfs], SERVE_TERMS, [0, 0, 0, 0, 0, 1]);
  }
  /** p = { ret1, ret2, retGames, bpConv } — rates in %. bpConv null when there were 0 chances. */
  function ret(p) {
    p = p || {};
    return sum([p.ret1, p.ret2, p.retGames, p.bpConv], RETURN_TERMS, [0, 0, 0, 0]);
  }
  /** A {won,total} count pair as a %, or null (0 opportunities is not 0%). */
  function pct(fr) {
    if (!fr) return null;
    var w = fin(fr.won), t = fin(fr.total);
    return w != null && t != null && t > 0 ? w / t * 100 : null;
  }
  /**
   * One side of an api-tennis box score, in the match-stats shape the dashboard, the player
   * profile and the Live tab all hold: `side['Service:Aces']` counts, `side.raw['<Group>:<name>']`
   * = {won,total}. Every rate is rebuilt from its count (a rate the feed sent bare is not enough),
   * and 1st-in % = 1st-serve points ÷ (1st + 2nd serve points), since the feed's own is whole-number.
   */
  function components(side) {
    var raw = (side && side.raw) || {};
    var f = raw['Service:1st serve points won'], s = raw['Service:2nd serve points won'];
    var ft = f ? fin(f.total) : null, st = s ? fin(s.total) : null;
    return {
      serve: {
        firstIn: ft != null && st != null && ft + st > 0 ? ft / (ft + st) * 100 : null,
        firstWon: pct(f), secondWon: pct(s), svGames: pct(raw['Games:Service games won']),
        aces: side ? fin(side['Service:Aces']) : null, dfs: side ? fin(side['Service:Double Faults']) : null
      },
      ret: {
        ret1: pct(raw['Return:1st return points won']), ret2: pct(raw['Return:2nd return points won']),
        retGames: pct(raw['Games:Return games won']), bpConv: pct(raw['Return:Break Points Converted'])
      }
    };
  }
  function fromBoxSide(side) {
    var c = components(side);
    return { serve: serve(c.serve), ret: ret(c.ret) };
  }

  var api = { SERVE_TERMS: SERVE_TERMS, RETURN_TERMS: RETURN_TERMS, serve: serve, ret: ret, pct: pct, components: components, fromBoxSide: fromBoxSide };
  root.HouseRatings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
