// =================================================================
// SETTLEMENT — the two retirement rules (founder ruling, round 2 item 1.3, 2026-10-25)
// -----------------------------------------------------------------
//   matchWinner — WHO WON: the official ATP result. A retirement counts for the player who did not retire; a walkover
//                 (no ball played) is not a match and has no winner here (null → the caller excludes and counts it).
//                 Used by Favourite reliability, favourites/underdogs and every win-rate figure.
//   settleBet   — THE BET: Pinnacle rules (founder ruling 2026-10-22). A retirement before the first set is completed
//                 is void; after it, the bet stands on the result. A walkover is void. Used by the units ledger,
//                 Market edge, the price join and every ROI / yield figure.
// One module for both, so no surface re-derives either rule. UMD: node builders require() it, the page reads
// window.Settlement (loaded before market-edge-core.js, which delegates its retirement settlement here).
// =================================================================
(function (root) {
'use strict';

// Tennis-Data `comment` values (and api-tennis event_status mapped onto them by the feeds).
const RETIRED = new Set(['Retired', 'Rrtired', 'Retired.']);   // Rrtired = a typo in the source
const WALKOVER = new Set(['Walkover', 'Walk Over', 'W/O']);
const COMPLETED = new Set(['Completed', 'Finished']);

function kindOf(comment) {
  const c = String(comment == null ? '' : comment).trim();
  if (COMPLETED.has(c)) return 'completed';
  if (RETIRED.has(c)) return 'retired';
  if (WALKOVER.has(c)) return 'walkover';
  // build-market-edge.js isRetiredComment read the comment case-insensitively ("retired" / "rrtired"): kept
  const l = c.toLowerCase();
  if (l === 'retired' || l === 'rrtired') return 'retired';
  return 'other';
}

// matchWinner({ comment, winnerSide }) → winnerSide ('fav' | 'dog' | a player id — whatever the caller passes) or null.
// A completed match and a retirement both stand on the official result; a walkover and any non-result is null.
function matchWinner(m) {
  const k = kindOf(m && m.comment);
  return k === 'completed' || k === 'retired' ? (m.winnerSide ?? null) : null;
}

// The first set of a stored set list (moved here from market-edge-core.js, ruling 4, founder 2026-10-22):
// 'complete' (6-0 … 6-4, 7-5, 7-6), 'incomplete' (anything short of that — 6-5, and 6-6, a retirement during the
// first-set tiebreak) or 'missing' (no list, an empty list, a non-numeric game). Takes every set shape the stores
// carry: [a, b], { p, o }, { a, b }, { w, l }. Order-free: completeness is symmetric.
function firstSetState(sets) {
  if (!Array.isArray(sets) || !sets.length || sets[0] == null) return 'missing';
  const s = sets[0];
  const a = Array.isArray(s) ? s[0] : s.p != null ? s.p : s.a != null ? s.a : s.w;
  const b = Array.isArray(s) ? s[1] : s.o != null ? s.o : s.b != null ? s.b : s.l;
  const x = Number(a), y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y) || a === '' || b === '' || a == null || b == null) return 'missing';
  const hi = Math.max(x, y), lo = Math.min(x, y);
  return (hi === 6 && lo <= 4) || (hi === 7 && (lo === 5 || lo === 6)) ? 'complete' : 'incomplete';
}
// the compact first-set code the stores carry ('c' / 'i' / 'm') of a firstSetState result
const fsCode = (st) => (st === 'complete' ? 'c' : st === 'incomplete' ? 'i' : 'm');

// settleBet(r) — Pinnacle rules, EXTRACTED (not re-written) from market-edge-core.js retSettlement (ruling 4) and
// build-market-edge.js isRetiredComment + its retirement loop. r carries any of: comment (Tennis-Data / the master),
// wo / walkover (a feed flag), ret / retired / retSettle (a feed retirement flag), fs ('c' / 'i' / 'm', a precomputed
// first-set state, which wins over the sets), sets / setGames (the stored set list). Returns
//   'void'     a walkover (no ball played), or a retirement before the first set was completed
//   'stands'   a retirement after the first set was completed: settles on the official result
//   'no-sets'  a retirement whose first set is unknown (no stored set scores, or the sources disagree): no units, never
//              guessed — the extracted rule (Market edge, the price join, the profile ledger leave these out). Treat as void.
//   null       neither: an ordinary result. Every other non-result a store carries (a started "Awarded" /
//              "Disqualified", Tennis-Data's "Sched" US Open 2019 final) settles on the result, as build-market-edge.js
//              has always settled them.
function settleBet(r) {
  if (!r) return null;
  const k = kindOf(r.comment);
  if (r.wo || r.walkover || k === 'walkover') return 'void';
  if (!(r.retSettle || r.retired || r.ret || k === 'retired')) return null;
  const st = r.fs === 'c' ? 'complete' : r.fs === 'i' ? 'incomplete' : r.fs === 'm' ? 'missing'
    : firstSetState(r.sets || r.setGames || null);
  return st === 'complete' ? 'stands' : st === 'incomplete' ? 'void' : 'no-sets';
}
// betCounts(r) — the bet is in a units / ROI / yield figure: an ordinary result, or a retirement that stands.
function betCounts(r) { const s = settleBet(r); return s !== 'void' && s !== 'no-sets'; }

const SETTLEMENT = { kindOf, matchWinner, firstSetState, fsCode, settleBet, betCounts, RETIRED, WALKOVER, COMPLETED };
if (typeof module !== 'undefined' && module.exports) module.exports = SETTLEMENT;
if (root) root.Settlement = SETTLEMENT;
}(typeof window !== 'undefined' ? window : null));
