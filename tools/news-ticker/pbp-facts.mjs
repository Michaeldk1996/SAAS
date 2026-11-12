// News ticker sample — counted match facts from the point-by-point shard (pbp/{eventKey}.json). Pure; every figure is a
// count of stored rows. Tested by tools/test-news-ticker.mjs.
//
// THE DEFINITIONS (each one is what the report prints; "X" is a player, "game" a service game unless said otherwise)
//   service game     a set row with tennis points (PbpIntegrity.isGame). Its server and winner are the shard's own.
//                    A tiebreak is not a service game.
//   strict game      its point list starts at the first point, every entry is exactly one point on from the one before
//                    (15/30/40, deuce and advantage), and it ends on the game winner's game point. Only strict games
//                    are counted for break points and 40-0; a side with any non-strict service game gets no pbp count.
//   break point      a score at which the RECEIVER wins the game with the next point: receiver on 40 with the server on
//                    0/15/30, or receiver on advantage. Never 40-40. Read off the score, not the feed's flag.
//   faced            the number of break-point scores in X's service games (one point is played from each).
//   saved            faced minus the service games X lost (a lost service game ends on exactly one converted break point).
//   came from a set down    the match winner lost the first set (final set scores).
//   tiebreak sets    sets whose final games are 7-6 (final set scores); who won each.
//   broken serving for the set    X served a game at 5-0..5-4 or 6-5 up in that set (holding wins the set) and lost it.
//   ...for the match the same game, when winning that set would also win X the match (X already has setsToWin - 1 sets).
//   broken from 40-0 up     a strict service game of X that reached 40-0 to X and that X lost.
//   opening game     set 1's first game: the server faced n >= 1 break points and held ("saved n in the opening game").
//   longest run      the most games in a row won by one player over the whole match, in playing order, a tiebreak
//                    counting as one game and a run carrying over a set change.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PI = require('../../pbp-integrity.js');

const GP = { 0: 0, 15: 1, 30: 2, 40: 3, A: 4 };
const other = (k) => (k === 'p1' ? 'p2' : 'p1');
const hdr = (s) => { const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String(s || '')); return m ? { p1: +m[1], p2: +m[2] } : null; };
const pt = (s) => { const m = /^\s*(0|15|30|40|A)\s*-\s*(0|15|30|40|A)\s*$/i.exec(String(s || '')); return m ? { p1: GP[m[1].toUpperCase()], p2: GP[m[2].toUpperCase()] } : null; };

// one legal point on from `a` (p1/p2 point indices): the list of scores it can become
function nexts(a) {
  const out = [];
  for (const k of ['p1', 'p2']) {
    const o = other(k), me = a[k], op = a[o];
    if (me <= 2) out.push({ [k]: me + 1, [o]: op });                 // 0/15/30 -> next
    else if (me === 3 && op === 3) out.push({ [k]: 4, [o]: 3 });      // deuce -> advantage
    else if (me === 3 && op === 4) out.push({ [k]: 3, [o]: 3 });      // their advantage -> deuce
    // me === 3 && op <= 2, or me === 4: the next point wins the game (no further score row)
  }
  return out;
}
const gamePoint = (sc, k) => { const o = other(k); return (sc[k] === 3 && sc[o] <= 2) || sc[k] === 4; };

// -> { ok, scores:[{p1,p2}] } ; ok only for a strict game
export function strictGame(g) {
  const raw = (g.points || []).map((p) => pt(p && p.s));
  if (!raw.length || raw.some((x) => !x)) return { ok: false, scores: [] };
  let cur = { p1: 0, p2: 0 };
  for (const sc of raw) {
    if (!nexts(cur).some((n) => n.p1 === sc.p1 && n.p2 === sc.p2)) return { ok: false, scores: [] };
    cur = sc;
  }
  if (!gamePoint(cur, g.winner)) return { ok: false, scores: [] };
  return { ok: true, scores: raw };
}

// -> null when the shard cannot be trusted against the final score; else the counted facts
export function pbpFacts(shard, finalScore, bestOf = 3) {
  if (!shard || !Array.isArray(shard.sets) || !finalScore || !Array.isArray(finalScore.sets)) return null;
  const fs = finalScore.sets;
  if (shard.sets.length !== fs.length) return null;
  const setsToWin = bestOf === 5 ? 3 : 2;
  const side = { p1: { faced: 0, lostGames: 0, strict: true, games: 0, brokenForSet: 0, brokenForMatch: 0, brokenFrom400: 0 },
    p2: { faced: 0, lostGames: 0, strict: true, games: 0, brokenForSet: 0, brokenForMatch: 0, brokenFrom400: 0 } };
  const order = [];                      // game winners in playing order (tiebreak = one game)
  const ctx = [];                        // per game in `order`: { set, before: {p1,p2} set score before it, server | null (tiebreak) }
  const forSetAt = { p1: [], p2: [] }, forMatchAt = { p1: [], p2: [] };   // the set numbers of each "broken when serving for …"
  const setsWon = { p1: 0, p2: 0 };
  let opening = null;
  for (let i = 0; i < shard.sets.length; i++) {
    const games = (shard.sets[i].games || []).filter((g) => PI.isGame(g));
    let prev = { p1: 0, p2: 0 };
    for (let j = 0; j < games.length; j++) {
      const g = games[j], h = hdr(g.score);
      if (!h || !['p1', 'p2'].includes(g.server) || !['p1', 'p2'].includes(g.winner)) return null;
      // the header must move on by exactly one game for the stated winner
      if (h[g.winner] !== prev[g.winner] + 1 || h[other(g.winner)] !== prev[other(g.winner)]) return null;
      const s = side[g.server], lead = prev[g.server], trail = prev[other(g.server)];
      const broken = g.winner !== g.server;
      s.games++; if (broken) s.lostGames++;
      const forSet = (lead === 5 && trail <= 4) || (lead === 6 && trail === 5);
      if (forSet && broken) { if (setsWon[g.server] === setsToWin - 1) { s.brokenForMatch++; forMatchAt[g.server].push(i + 1); } else { s.brokenForSet++; forSetAt[g.server].push(i + 1); } }
      const st = strictGame(g);
      if (!st.ok) s.strict = false;
      else {
        const bps = st.scores.filter((sc) => gamePoint(sc, other(g.server))).length;
        s.faced += bps;
        if (broken && st.scores.some((sc) => sc[g.server] === 3 && sc[other(g.server)] === 0)) s.brokenFrom400++;
        if (i === 0 && j === 0 && bps >= 1 && !broken) opening = { side: g.server, saved: bps };
      }
      order.push(g.winner); ctx.push({ set: i + 1, before: prev, server: g.server }); prev = h;
    }
    const f = fs[i];
    const tb = (f.p1 === 7 && f.p2 === 6) || (f.p1 === 6 && f.p2 === 7);
    if (tb) {
      if (prev.p1 !== 6 || prev.p2 !== 6) return null;
      order.push(f.p1 > f.p2 ? 'p1' : 'p2'); ctx.push({ set: i + 1, before: prev, server: null });
    } else if (prev.p1 !== f.p1 || prev.p2 !== f.p2) return null;   // the games must add up to the set score
    setsWon[f.p1 > f.p2 ? 'p1' : 'p2']++;
  }
  let run = { side: null, n: 0 }, cur = { side: null, n: 0 };
  order.forEach((w, idx) => { cur = w === cur.side ? { side: w, n: cur.n + 1, start: cur.start } : { side: w, n: 1, start: idx }; if (cur.n > run.n) run = cur; });
  // a tie for the longest run names nobody
  let ties = 0, c2 = { side: null, n: 0 };
  for (const w of order) { c2 = w === c2.side ? { side: w, n: c2.n + 1 } : { side: w, n: 1 }; if (c2.n === run.n) ties++; }
  const bp = (k) => (side[k].strict ? { faced: side[k].faced, saved: side[k].faced - side[k].lostGames } : null);
  // saved can only be trusted when every lost service game ended on a break point, which strictGame guarantees
  return { bp: { p1: bp('p1'), p2: bp('p2') }, opening,
    brokenForSet: { p1: side.p1.brokenForSet, p2: side.p2.brokenForSet }, brokenForMatch: { p1: side.p1.brokenForMatch, p2: side.p2.brokenForMatch },
    brokenFrom400: { p1: side.p1.strict ? side.p1.brokenFrom400 : null, p2: side.p2.strict ? side.p2.brokenFrom400 : null },
    brokenForSetAt: forSetAt, brokenForMatchAt: forMatchAt,
    longestRun: ties === 1 ? { side: run.side, n: run.n, ...runContext(run, order, ctx) } : { side: null, n: run.n }, games: order.length };
}

// Where the longest run happened: the set and the set score when it began (from the runner's side), whether it began
// straight after he lost his own serve, and whether it ran to the end of the match.
function runContext(run, order, ctx) {
  const first = ctx[run.start], k = run.side, o = other(k), prevGame = run.start > 0 ? ctx[run.start - 1] : null;
  return { set: first.set, from: { me: first.before[k], opp: first.before[o] },
    afterBeingBroken: !!(prevGame && prevGame.set === first.set && prevGame.server === k && order[run.start - 1] === o),
    toTheEnd: run.start + run.n === order.length };
}

// Facts that need only the final set scores.
export function scoreFacts(finalScore, winner) {
  const fs = (finalScore && finalScore.sets) || [];
  if (!fs.length) return { fromSetDown: false, tiebreakSets: [] };
  const l = other(winner);
  const tiebreakSets = [];
  fs.forEach((s, i) => { if ((s.p1 === 7 && s.p2 === 6) || (s.p1 === 6 && s.p2 === 7)) tiebreakSets.push({ set: i + 1, winner: s.p1 > s.p2 ? 'p1' : 'p2' }); });
  return { fromSetDown: fs.length >= 2 && fs[0][l] > fs[0][winner], tiebreakSets };
}
