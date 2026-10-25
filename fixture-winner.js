// fixture-winner.js — founder ruling 2026-10-23: api-tennis re-imported ITF events with `event_winner: null` on matches
// still marked "Finished" (measured 22–23 Oct: 5 of the 6 played rows that left career-history). Every reader skips a
// fixture with no winner — correctly: we never guess one. This module reads the winner from the vendor's OWN score, and
// only where that score is complete and unambiguous:
//   - status "Finished" (never "Retired", "Walk Over", "Awarded", "Defaulted": a retirement's sets do not say who retired)
//   - every set played is a finished set — 6–0…6–4, 7–5, 7–6, or a finished match tie-break (10+, two clear) as the last
//     set — trailing 0–0 placeholder sets ignored
//   - one side won the sets the format needs (2 of 3, or 3 of 5) and the other fewer, and the final set is that side's
//   - the vendor's `event_final_result` ("a - b"), when present, says the same set count
// Anything else stays without a winner (and so without a row), as before. A filled fixture carries `_winnerFromScore`.
'use strict';

const games = (v) => { const m = /^\s*(\d+)(?:\.\d+)?\s*$/.exec(String(v == null ? '' : v)); return m ? +m[1] : null; };

// 'first' | 'second' | null — who won a set, if it is a finished set
function setWinner(a, b, last) {
  if (a == null || b == null || a === b) return null;
  const hi = Math.max(a, b), lo = Math.min(a, b);
  const done = (hi === 6 && lo <= 4) || (hi === 7 && (lo === 5 || lo === 6)) || (last && hi >= 10 && hi - lo >= 2);
  return done ? (a > b ? 'first' : 'second') : null;
}

function winnerFromScore(f) {
  if (!f || f.event_status !== 'Finished' || f.event_winner) return null;
  const raw = Array.isArray(f.scores) ? f.scores.map((s) => [games(s && s.score_first), games(s && s.score_second)]) : [];
  while (raw.length && raw[raw.length - 1][0] === 0 && raw[raw.length - 1][1] === 0) raw.pop();   // 0–0 placeholders
  if (!raw.length || raw.some(([a, b]) => a == null || b == null)) return null;
  let first = 0, second = 0, lastWinner = null;
  for (let i = 0; i < raw.length; i++) {
    const w = setWinner(raw[i][0], raw[i][1], i === raw.length - 1);
    if (!w) return null;                                  // an unfinished or unreadable set: not complete
    if (w === 'first') first++; else second++;
    lastWinner = w;
  }
  const hi = Math.max(first, second), lo = Math.min(first, second);
  if (!(hi === 2 || hi === 3) || lo >= hi) return null;    // the format's set count reached by exactly one side
  const side = first > second ? 'first' : 'second';
  if (lastWinner !== side) return null;                   // the match ends on the winner's set
  const fr = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String(f.event_final_result || ''));
  if (fr && (+fr[1] !== first || +fr[2] !== second)) return null;   // the vendor's own count disagrees
  return side === 'first' ? 'First Player' : 'Second Player';
}

function fillWinnerFromScore(f) {
  const w = winnerFromScore(f);
  if (w) { f.event_winner = w; f._winnerFromScore = true; }
  return f;
}

module.exports = { winnerFromScore, fillWinnerFromScore, setWinner };
