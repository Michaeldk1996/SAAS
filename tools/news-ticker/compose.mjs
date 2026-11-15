// News ticker — the full match report, written automatically (founder 2026-11-14: "the goal is to make it automatic").
//
// The reports the founder wrote by hand tell the match set by set, carry one or two quotes and close on "All in all"
// and the next opponent. This module does the same from stored data:
//
//   1. factSheet()      every fact we hold for the match, as plain lines: result, the breaks of serve in playing order
//                       (point-by-point), the box score per match and per set, the shot numbers, what was seen in the
//                       match, the way to the next round — and the players' own words about this match, word for word.
//   2. composeReport()  a model writes the report from that sheet in the founder's voice.
//   3. checkComposed()  the text is published only when every number, score, name and quotation in it is on the sheet.
//                       One retry with the reasons; a second failure keeps the older report text (template + voice).
//
// The check cannot read meaning. It makes sure nothing NEW enters the text: a number that is not on the sheet, a
// player who is not part of it, a quotation we do not hold, or a word about shots, the body, nerves or conditions
// that no line on the sheet carries. Pipeline only: the key is ANTHROPIC_API_KEY from GitHub Actions secrets.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { strictGame, pbpFacts } from './pbp-facts.mjs';
import { surnameOf, REPORT_MODEL } from './humanise.mjs';
import { wueUsable, foldText, verbatimIn, dominanceRatio } from './news-core.mjs';
import { shotSentences } from './match-cards.mjs';
const require = createRequire(import.meta.url);
const PI = require('../../pbp-integrity.js');

const API_URL = 'https://api.anthropic.com/v1/messages';
export const COMPOSE_VERSION = 3;        // 3 = the short report of the founder's 15 Nov feedback
export const MAX_COMPOSE_RUNS = 2;       // a report is written ONCE (founder 2026-11-15); the second run exists only for a report whose first write failed its check
export const COMPOSE_FRESH_HOURS = 36;   // after this, a report that failed its check is no longer tried again
// Written once, when the quotes and the highlights are in (founder 2026-11-15: "Good"): from 45 minutes after the match
// when what was seen in the match is on file, else at 75 minutes with what there is. Until then: the result line.
export const COMPOSE_WAIT_MIN = 45, COMPOSE_WAIT_MAX_MIN = 75;
export const COMPOSE_UPGRADE_HOURS = 72; // a report of an older version is written again once, only this long after its match
export const MAX_QUOTES = 6, QUOTE_MAX_CHARS = 520, QUOTES_IN_TEXT = 2;
export const WORDS_LONG_MAX = 330;   // a five-setter or a match that went the distance with a turning point: up to about 250 words with the quotes (founder 2026-11-15)
export const WORDS_MIN = 70, WORDS_MAX = 250;   // founder 2026-11-15: 150 to 180 words with the quotes; this counts the words outside quotations, with room so a first try a little over is not paid twice
export const STAT_NUMBERS_MAX = 4;       // founder 2026-11-15: one stat per report (with the player's average when the gap is big)
export const SHORT_WORDS = 7, SHORT_RUN = 3;   // three sentences of 7 words or fewer in a row read like a machine
export const PHRASES = ['The first set could easily have gone the other way.', 'From there the match turned completely.', 'It was the same story in the second set.', 'That was the moment of the match.',
  'He really struggled behind his second serve.', 'He was clearly the better player from the baseline.', 'He did not see another break point.', 'He got broken straight back.', 'He served it out.',
  'It was not his best return performance.', 'That made the difference in the end.', 'He stayed calm.', 'Credit to him.'];
// a wing is "his best shot" from 10 winners and 1.5 times the other wing; "most of his errors" from 12 and 1.5 times
export const RUN_IN_SET = 4;
export const DR_STANDS_OUT = 1.5, PERF_STANDS_OUT = 9.0;
export const WEAK_UE_MIN = 30, WEAK_DF_MIN = 6, WEAK_FIRST_IN = 55, WEAK_SECOND_WON = 45;
export const TIME_LONG_MIN = 165, TIME_SHORT_MIN = 70;   // best of three: from 2h45 the time is told; any match of 70 minutes or less
export const H2H_MIN_MEETINGS = 10, H2H_TOP_RANK = 10;
export const BEST_SHOT_MIN = 10, WEAK_SIDE_MIN = 12, BEST_SHOT_RATIO = 1.5;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const other = (k) => (k === 'p1' ? 'p2' : 'p1');
const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const SET_WORD = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth' };
const ROUND_CODE = { 'first round': 'R1', 'second round': 'R2', 'third round': 'R3', 'fourth round': 'R4', 'quarter-finals': 'the QF', 'semi-finals': 'the SF', final: 'the final',
  'round of 128': 'R1', 'round of 64': 'the round of 64', 'round of 32': 'the round of 32', 'round of 16': 'the round of 16' };
export const roundCode = (words) => (words ? ROUND_CODE[String(words).toLowerCase()] || String(words) : null);
const hdr = (s) => { const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String(s || '')); return m ? { p1: +m[1], p2: +m[2] } : null; };
const gamePoint = (sc, k) => { const o = other(k); return (sc[k] === 3 && sc[o] <= 2) || sc[k] === 4; };

// "7-6(2), 6-7(7), 7-5" -> per set the tiebreak score from the set winner's side ("7–2", "9–7"), else null
export function tiebreakScores(finalScore) {
  const parts = String((finalScore && finalScore.display) || '').split(',').map((x) => x.trim());
  return ((finalScore && finalScore.sets) || []).map((s, i) => {
    if (finalScore.tb && finalScore.tb[i]) return `${Math.max(...finalScore.tb[i])}–${Math.min(...finalScore.tb[i])}`;
    const m = /\((\d+)\)/.exec(parts[i] || '');
    if (!m || !((s.p1 === 7 && s.p2 === 6) || (s.p1 === 6 && s.p2 === 7))) return null;
    const lo = +m[1]; return `${Math.max(7, lo + 2)}–${lo}`;
  });
}

// The match in playing order, from the point-by-point shard. Lines only when the whole shard agrees with the final
// score (pbpFacts); break points, set points and match points only from games whose point list is complete (strict).
// Where the match stands after a set (founder 2026-11-15: "the reader always knows who is ahead and how close he is").
const SETS_WORD = ['love', 'one', 'two', 'three'];
export function standing(sw, N, toWin) {
  const a = sw.p1 >= sw.p2 ? 'p1' : 'p2', b = a === 'p1' ? 'p2' : 'p1';
  if (sw[a] === toWin) return `After this set: ${N(a)} wins the match.`;
  if (sw[a] === sw[b]) return `After this set: ${sw[a] === 1 ? 'one set all' : 'two sets all'}${sw[a] === toWin - 1 ? ', a deciding set follows' : ''}.`;
  return `After this set: ${N(a)} leads by ${sw[a] === 1 ? 'a set' : `${SETS_WORD[sw[a]]} sets`}${sw[b] ? ` to ${SETS_WORD[sw[b]]}` : ''}${sw[a] === toWin - 1 ? ' and is one set away from winning the match' : ''}.`;
}

export function setStory(shard, m, bestOf = 3) {
  // The whole log must agree with the final score. When it does not (the feed's log of one set is cut short), the
  // sets that do add up on their own are still told and the others get their score only (founder 2026-11-15:
  // "point by point should be everywhere"; measured: 1 of 79 Grand Slam logs of 2026).
  const whole = !!pbpFacts(shard, m.finalScore, bestOf);
  if (!whole && (!shard || !Array.isArray(shard.sets) || !m.finalScore || shard.sets.length !== (m.finalScore.sets || []).length)) return [];
  const setGames = (i) => {
    const all = (shard.sets[i].games || []).filter((g) => PI.isGame(g));
    if (whole) return all;
    const f = m.finalScore.sets[i], tb = (f.p1 === 7 && f.p2 === 6) || (f.p1 === 6 && f.p2 === 7), kept = [];
    let prev = { p1: 0, p2: 0 };
    for (const g of all) {
      if (tb && prev.p1 === 6 && prev.p2 === 6) break;   // what follows 6–6 is the tiebreak
      const h = hdr(g.score);
      if (!h || !['p1', 'p2'].includes(g.server) || !['p1', 'p2'].includes(g.winner) || h[g.winner] !== prev[g.winner] + 1 || h[other(g.winner)] !== prev[other(g.winner)]) return null;
      kept.push(g); prev = h;
    }
    return (tb ? prev.p1 === 6 && prev.p2 === 6 : prev.p1 === f.p1 && prev.p2 === f.p2) ? kept : null;
  };
  const N = (k) => surnameOf(m[k]), toWin = bestOf === 5 ? 3 : 2, fs = m.finalScore.sets, tbs = tiebreakScores(m.finalScore);
  const setsWon = { p1: 0, p2: 0 }, out = [];
  for (let i = 0; i < shard.sets.length; i++) {
    const games = setGames(i), sw = SET_WORD[i + 1] || `set ${i + 1}`, lines = [];
    if (!games) {   // this set's log does not add up: its score only, nothing claimed about breaks
      const f0 = fs[i], w0 = f0.p1 > f0.p2 ? 'p1' : 'p2';
      out.push(`${sw[0].toUpperCase()}${sw.slice(1)} set: ${N(w0)} won it ${f0[w0]}–${f0[other(w0)]}${tbs[i] ? ` (tiebreak ${tbs[i]})` : ''}.`);
      setsWon[w0]++; out.push(`  ${standing(setsWon, N, toWin)}`); continue;
    }
    let prev = { p1: 0, p2: 0 }, lastBreakBy = null, lastBreakIdx = -9, breaks = 0, run = { k: null, n: 0 }, best = { k: null, n: 0, end: false };
    games.forEach((g, j) => {
      const h = hdr(g.score), s = g.server, r = other(s), broken = g.winner !== s, st = strictGame(g);
      const clinch = (k) => prev[k] >= 5 && prev[k] > prev[other(k)];
      const kind = (k) => (setsWon[k] === toWin - 1 ? 'match' : 'set');
      let needed = 0;
      if (st.ok) {
        for (const k of [s, r]) {
          if (!clinch(k)) continue;
          const missed = st.scores.filter((sc) => gamePoint(sc, k)).length - (g.winner === k ? 1 : 0);
          // founder 2026-11-15: a point saved in a game he then lost anyway is not worth telling
          if (missed > 0 && g.winner !== k) lines.push(`${N(other(k))} saved ${pl(missed, `${kind(k)} point`)} with ${N(k)} leading ${prev[k]}–${prev[other(k)]} (${N(s)} serving).`);
        }
        const bps = st.scores.filter((sc) => gamePoint(sc, r)).length;
        if (!broken && bps > 0 && !clinch(r)) lines.push(`${N(s)} saved ${pl(bps, 'break point')} and held for ${h[s]}–${h[r]}${clinch(s) ? ` (he was serving for the ${kind(s)})` : ''}.`);
        if (broken && bps > 1) needed = bps;
      }
      if (broken) {
        breaks++;
        let t = `${N(r)} broke for ${h[r]}–${h[s]}`;
        const notes = [];
        if (needed) notes.push(`he needed ${needed} break points in that game`);
        if (lastBreakBy === s && lastBreakIdx === j - 1) notes.push('straight back');
        if (clinch(s)) notes.push(`${N(s)} was serving for the ${kind(s)}`);
        if (clinch(r)) notes.push(`that game won him the ${kind(r)}`);
        lines.push(t + (notes.length ? ` (${notes.join('; ')})` : '') + '.');
        lastBreakBy = r; lastBreakIdx = j;
      }
      prev = h;
      run = g.winner === run.k ? { k: run.k, n: run.n + 1 } : { k: g.winner, n: 1 };
      if (run.n >= best.n) best = { k: run.k, n: run.n, end: j === games.length - 1 };
    });
    const f = fs[i], wk = f.p1 > f.p2 ? 'p1' : 'p2';
    out.push(`${sw[0].toUpperCase()}${sw.slice(1)} set: ${N(wk)} won it ${f[wk]}–${f[other(wk)]}${tbs[i] ? ` (tiebreak ${tbs[i]})` : ''}.${breaks === 0 ? ' No break of serve in this set.' : ''}`);
    out.push(...lines.map((x) => `  ${x}`));
    // a run of games is told inside its set (founder 2026-11-15: "he won 5 games in a row to win 6–1"), never across two sets
    if (best.n >= RUN_IN_SET && best.k === wk) out.push(`  ${N(wk)} won ${best.n} games in a row in this set${best.end ? ' to take it' : ''}.`);
    setsWon[wk]++;
    out.push(`  ${standing(setsWon, N, toWin)}`);
  }
  return out;
}

const pct = (v) => (num(v) == null ? null : `${Math.round(v)}%`);
const raw = (st, k) => { const r = st && st.raw && st.raw[k]; return r && num(r.won) != null && num(r.total) != null && r.total > 0 ? r : null; };
// one player's box score as a line of facts; nothing is written for a field we do not hold
export function statLine(st, { wue = true, full = true } = {}) {
  if (!st) return null;
  const p = [];
  const a = num(st['Service:Aces']), d = num(st['Service:Double Faults']);
  if (a != null) p.push(pl(a, 'ace')); if (d != null) p.push(pl(d, 'double fault'));
  if (pct(st['Service:1st serve percentage'])) p.push(`first serve in ${pct(st['Service:1st serve percentage'])}`);
  if (pct(st['Service:1st serve points won'])) p.push(`won ${pct(st['Service:1st serve points won'])} of first-serve points`);
  if (pct(st['Service:2nd serve points won'])) p.push(`won ${pct(st['Service:2nd serve points won'])} of second-serve points`);
  const bs = raw(st, 'Service:Break Points Saved'), bc = raw(st, 'Return:Break Points Converted');
  if (bs) p.push(`saved ${bs.won} of ${pl(bs.total, 'break point')}`);
  if (bc) p.push(`converted ${bc.won} of ${pl(bc.total, 'break point')}`);
  const W = num(st['Points:Winners']), U = num(st['Points:Unforced errors']);
  if (wue && W != null && U != null) p.push(`${pl(W, 'winner')}`, `${pl(U, 'unforced error')}`);
  if (full) {
    if (pct(st['Return:1st return points won'])) p.push(`won ${pct(st['Return:1st return points won'])} of the points against the first serve`);
    if (pct(st['Return:2nd return points won'])) p.push(`won ${pct(st['Return:2nd return points won'])} of the points against the second serve`);
    const net = raw(st, 'Points:Net points won'); if (net && net.total >= 5) p.push(`won ${net.won} of ${net.total} points at the net`);
  }
  return p.length ? p.join(', ') : null;
}

const startKey = (c) => `${c.date || ''} ${c.time || '99:99'}`;
const has = (c, key) => String(c.p1Key) === String(key) || String(c.p2Key) === String(key);
const sideOf = (c, key) => (String(c.p1Key) === String(key) ? 'p1' : 'p2');
// One earlier match of `key` in this tournament, told without its score (founder 2026-11-14: "do not list scores, say
// what his week looks like"): "beat Norrie in straight sets (R2)" / "walkover from Rune, no match played (the QF)".
function weekEntry(c, key, rc) {
  const k = sideOf(c, key), o = other(k), where = rc(c) ? ` (${rc(c)})` : '';
  if (!c.finalScore || c.finalScore.winner !== k) return null;
  if (c.walkover) return { walkover: true, text: `walkover from ${surnameOf(c[o])}, no match played${where}`, dropped: 0, tiebreaks: 0 };
  const sets = c.finalScore.sets || [], lost = sets.filter((x) => x[o] > x[k]).length;
  const tb = sets.filter((x) => (x.p1 === 7 && x.p2 === 6) || (x.p1 === 6 && x.p2 === 7)).length;
  const how = c.retired ? 'by retirement' : (lost === 0 ? 'in straight sets' : `in ${sets.length === 3 ? 'three' : sets.length} sets${sets[0] && sets[0][o] > sets[0][k] ? ' after losing the first set' : ''}`);
  return { walkover: false, text: `beat ${surnameOf(c[o])} ${how}${where}`, dropped: lost, tiebreaks: tb };
}
const earlierOf = (m, key, all, limit) => all.filter((c) => c.id !== m.id && has(c, key) && startKey(c) < limit).sort((a, b) => startKey(a).localeCompare(startKey(b)));
// The way to and from this match inside the tournament. all = every card of the edition we hold; rc(card) = its round code.
export function pathLines(m, w, all, rc, isFinal) {
  const out = [], wKey = m[w + 'Key'], me = startKey(m), W = surnameOf(m[w]);
  // no recap of anybody's week (founder 2026-11-15: "we know it from the earlier match reports"): the title, or the next opponent
  if (isFinal) { out.push(`This was the final: ${W} wins the title.`); return out; }
  const next = all.filter((c) => c.id !== m.id && has(c, wKey) && startKey(c) > me).sort((a, b) => startKey(a).localeCompare(startKey(b)))[0];
  if (!next) return out;
  const O = surnameOf(next[other(sideOf(next, wKey))]);
  out.push(`Next for ${W}: ${O}${rc(next) ? ` in ${rc(next)}` : ''}.`);
  return out;
}

// The physical paragraph (founder 2026-11-14): its opening sentence changes from report to report; the timeout is told
// by where in the set it came ("early in the second set"), not by the game score; and the earlier rounds of the same
// tournament are read for the same thing ("his second medical timeout in two matches"). The reason is never guessed.
// rows = mto-matches.json's rows for this match; earlier = [{ rows }] for the SAME player's earlier matches here, in
// order (the caller builds it per player). -> { sentences: string[], facts: string[] (for the fact sheet) }
const ORD_WORD = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth' }, NUM_WORD = { 2: 'two', 3: 'three', 4: 'four', 5: 'five' };
// A medical timeout is something to follow, not proof of a problem (founder 2026-11-14: "some players just take MTOs
// for other reasons"): the opener never says how he looked. "did not look 100%" is used only when it is confirmed —
// he spoke about his body on court, or what was seen in the match says so.
const BODY_SEEN = /\b(injur|physio|trainer|treatment|limp|strapp|taped?|cramp|pain|struggl\w* (?:physically|with his)|not (?:moving|100)|hampered|bothered)/i;
export function physicalParagraph(m, rows, { winner = null, final = false, quotes = [], earlier = {}, seen = null } = {}) {
  const last = (x) => String(x || '').trim().split(/\s+/).pop().toLowerCase(), mine = (k, rs) => (rs || []).filter((r) => r && !r.retired && last(r.player) === last(m[k]));
  const by = new Map();
  for (const r of (rows || []).slice().sort((a, b) => String(a.calledAt).localeCompare(String(b.calledAt))).slice(0, 3)) {
    if (!r || r.retired || ![1, 2].includes(r.playerSide) || !Array.isArray(r.games) || r.games.length !== 2) continue;
    const sides = ['p1', 'p2'].filter((k) => last(m[k]) === last(r.player));
    if (sides.length !== 1) continue;
    const own = r.games[r.playerSide - 1], opp = r.games[2 - r.playerSide];
    if (!Array.isArray(own) || !Array.isArray(opp) || !own.length || own.length !== opp.length || !SET_WORD[own.length]) continue;
    const played = own[own.length - 1] + opp[opp.length - 1];
    if (!Number.isInteger(played)) continue;
    if (!by.has(sides[0])) by.set(sides[0], []);
    by.get(sides[0]).push(`${played <= 3 ? 'early in' : (played >= 8 ? 'late in' : 'in the middle of')} the ${SET_WORD[own.length]} set`);
  }
  const sentences = [], facts = [];
  // follow-up (founder 2026-11-15: "if we flagged it, the next report says what happened"): a player who took a medical
  // timeout in his previous match here and none in this one
  for (const k of ['p1', 'p2']) {
    if (by.has(k)) continue;
    const e = (earlier[k] || []).slice(-1)[0];
    if (e && mine(k, e.rows).length) facts.push(`${surnameOf(m[k])} called the physio (a medical timeout) in his previous match here${e.round ? ` (${e.round})` : ''} and did not call for one in this match. Say exactly that in one clause, nothing about how he looked.`);
  }
  for (const [k, at] of by) {
    const N = surnameOf(m[k]);
    // the run of matches in a row, ending with this one, in which he took a medical timeout
    let matches = 1, total = at.length;
    for (const e of (earlier[k] || []).slice().reverse()) { const n = mine(k, e.rows).length; if (!n) break; matches++; total += n; }
    const pattern = matches >= 2 && ORD_WORD[total] && NUM_WORD[matches] ? `his ${ORD_WORD[total]} medical timeout in ${NUM_WORD[matches]} matches` : null;
    const what = at.length === 1 ? `${N} called the physio ${at[0]}` : `${N} called the physio ${at.length === 2 ? 'twice' : 'three times'}: ${at.slice(0, -1).join(', ')} and ${at[at.length - 1]}`;
    const q = (quotes || []).find((x) => x && x.interview === 'on-court' && String(x.playerId) === String(m[k + 'Key']) && /\b(physical|body|injur|fitness|health|pain|hand|wrist|arm|shoulder|back|leg|knee|ankle|foot|hip|blister|cramp)/i.test(String(x.topic || '')) && String(x.text || '').length <= 260);
    const confirmed = !!q || (seen && BODY_SEEN.test(String(seen)) && new RegExp(`\\b${N.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(String(seen)));
    facts.push(`${what}${pattern ? `, ${pattern}` : ''}.${confirmed ? '' : ' Nothing confirms a physical problem: never write that he is hurt or not fit.'} Never write anything about the reason.${winner && k === winner && !final ? ' He plays again: it is the doubt before his next match.' : ''}`);
  }
  return { sentences, facts };
}

// The quotes of this match a report may use: the players' own words, the longest version of each, oldest first.
export function matchQuotes(m, eventKey, items, exclude = '') {
  const mine = (items || []).filter((q) => q && q.type === 'quote' && String(q.eventKey) === String(eventKey) && [m.p1Key, m.p2Key].map(String).includes(String(q.playerId))
    && String(q.text || '').length >= 20 && String(q.text).length <= QUOTE_MAX_CHARS && !foldText(exclude).includes(foldText(q.text)));
  const kept = mine.filter((q) => !mine.some((x) => x !== q && foldText(x.text).length > foldText(q.text).length && foldText(x.text).includes(foldText(q.text).replace(/[,.]$/, ''))));
  const seen = new Set();
  return kept.filter((q) => { const t = foldText(q.text); if (seen.has(t)) return false; seen.add(t); return true; })
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))).slice(0, MAX_QUOTES)
    .map((q) => ({ id: q.id, speaker: surnameOf(String(q.playerId) === String(m.p1Key) ? m.p1 : m.p2), topic: q.topic || null, text: String(q.text).trim() }));
}

// -> { lines: string[], quotes, hash, winner, loser }
// What the result means, from our own match histories (founder 2026-11-15: titles and first finals "can come from our
// own records"): the title count after a final, a first final, and how often he has been this far at a Grand Slam.
// histW / histL = the two players' career-history rows; only tour-level rows before this match are counted. Every line
// says "in our records": a history with a gap would count low.
const SLAM_RE = /australian open|french open|roland garros|wimbledon|us open/i;
const ROUND_RANK = { '1/8-finals': 4, 'round of 16': 4, r16: 4, 'quarter-finals': 5, qf: 5, 'semi-finals': 6, sf: 6, final: 7, f: 7 };
const rankOf = (r) => ROUND_RANK[String(r || '').toLowerCase().split(' - ').pop().trim()] || 0;
const ORDINAL = (n) => (n === 1 ? 'first' : n === 2 ? 'second' : n === 3 ? 'third' : `${n}th`);
export function milestoneLines({ m, w, l, round, histW = [], histL = [], eventKey = null }) {
  const W = surnameOf(m[w]), L = surnameOf(m[l]), rn = rankOf(round), slamNow = SLAM_RE.test(String(m.tour || '')), out = [];
  const before = (h) => (h || []).filter((r) => r && r.level === 'atp' && !r.walkover && !r.unconfirmed && String(r.eventKey) !== String(eventKey) && String(r.date) < String(m.date));
  const hw = before(histW), hl = before(histL), fin = (h) => h.filter((r) => rankOf(r.round) === 7), slam = (h) => h.filter((r) => SLAM_RE.test(String(r.tournament || '')));
  if (!rn || !histW.length) return out;
  if (rn === 7) {
    const titles = fin(hw).filter((r) => r.won).length + 1, slamTitles = fin(slam(hw)).filter((r) => r.won).length + 1;
    out.push(`In our records this is tour-level title number ${titles} for ${W}${slamNow ? ` and his ${ORDINAL(slamTitles)} Grand Slam title${slamTitles >= 2 && slamTitles <= 5 ? ` (a ${['', '', 'two', 'three', 'four', 'five'][slamTitles]}-time Grand Slam champion)` : ''}` : ''}.`);   // "champion" on the sheet: the founder's own opening cost a paid retry twice
    const lostHere = fin(hw).filter((r) => !r.won && String(r.tournament || '').toLowerCase() === String(m.tour || '').toLowerCase()).map((r) => r.year).sort();
    if (lostHere.length) out.push(`${W} lost the final here in ${lostHere[lostHere.length - 1]}.`);
    if (histL.length) { if (slamNow && !fin(slam(hl)).length) out.push(`It was the first Grand Slam final of ${L}.`); else if (!fin(hl).length) out.push(`It was the first tour-level final of ${L}.`); }
  } else if (slamNow && rn >= 4) {
    const next = { 4: 'quarter-final', 5: 'semi-final', 6: 'final' }[rn];
    const nth = slam(hw).filter((r) => rankOf(r.round) >= rn + 1).length + 1;
    if (nth <= 3) out.push(`${W} is in a Grand Slam ${next} for the ${ORDINAL(nth)} time in our records.`);   // the 8th time is not news
  } else if (rn === 6 && !fin(hw).length) out.push(`${W} reaches his first tour-level final in our records.`);
  return out;
}

// The archetype is named only when the numbers of this match show it (founder 2026-11-15: "we can't say that for each
// match report"). st = the winner's box score, opp = the loser's.
export function styleEarned(style, st, opp) {
  const s = String(style || '').toLowerCase(), v = (o, k) => num(o && o[k]);
  const first = v(st, 'Service:1st serve points won'), aces = v(st, 'Service:Aces'), W = v(st, 'Points:Winners'), U = v(st, 'Points:Unforced errors'), oU = v(opp, 'Points:Unforced errors'), ret = v(st, 'Points:Return Points Won');
  // "really confirmed" (founder 2026-11-15, second time): two things in the numbers, not one
  const serve = first != null && first >= 80 && aces != null && aces >= 8;
  const attack = W != null && U != null && W >= 30 && W >= U * 1.3;
  const solid = U != null && oU != null && oU >= 20 && U <= oU * 0.6 && ret != null && ret >= 40;
  if (/big server/.test(s)) return /first strike|baseliner/.test(s) ? serve && (attack || solid || W >= U) : serve;
  if (/attacking|first strike/.test(s)) return attack;
  if (/counterpuncher|defender|solid/.test(s)) return solid;
  if (/all court/.test(s)) return attack && ret != null && ret >= 40;
  return false;
}

export function factSheet({ m, w, l, rep, shard = null, round = null, duration = null, card = null, commentary = null, quotes = [], path = [], styles = null, physical = [], bestOf = 3, milestones = [] }) {
  const W = surnameOf(m[w]), L = surnameOf(m[l]), ms = m.matchStats || {}, lines = [];
  const add = (head, arr) => { const a = (arr || []).filter(Boolean); if (a.length) { lines.push(`## ${head}`); lines.push(...a); } };
  const sets = (m.finalScore.sets || []).map((s) => `${s[w]}–${s[l]}`), tbs = tiebreakScores(m.finalScore);
  // the round of 16 of a Grand Slam is R4, as in the founder's previews
  const rcode = round ? (bestOf === 5 && /round of 16/i.test(String(round)) ? 'R4' : roundCode(round)) : null;
  const res = [`${W} beat ${L} ${sets.map((s, i) => (tbs[i] ? `${s} (tiebreak ${tbs[i]})` : s)).join(', ')}${m.retired ? ' (retirement)' : ''}${rcode ? ` in ${rcode}` : ''}.`];
  const h = rep && rep.fields && rep.fields.h2h;
  // head to head only in a big rivalry (founder 2026-11-15): both in the top 10 and 10 meetings or more
  if (h && h.n >= H2H_MIN_MEETINGS && [w, l].every((k) => num(m[k + 'Rank']) != null && m[k + 'Rank'] <= H2H_TOP_RANK)) { const a = h.a, b2 = h.n - h.a; res.push(a === b2 ? `Big rivalry: the head-to-head is now level at ${a}–${b2}.` : `Big rivalry: ${a > b2 ? W : L} now leads the head-to-head ${Math.max(a, b2)}–${Math.min(a, b2)}.`); }
  // the match time is on the sheet only when it is part of the story (founder 2026-11-15): a five-setter, a best-of-three
  // close to three hours, or a very short match. Never estimated: no time on file = no line.
  const nSets = (m.finalScore.sets || []).length, decider = nSets === (bestOf === 5 ? 5 : 3);
  const timeTold = num(duration) != null && ((bestOf === 5 && nSets === 5) || (bestOf !== 5 && duration >= TIME_LONG_MIN) || duration <= TIME_SHORT_MIN);
  if (timeTold) res.push(`Match time: ${duration >= 90 ? `${Math.floor(duration / 60)} hour${duration >= 120 ? 's' : ''} ${String(duration % 60).padStart(2, '0')}` : `${duration} minutes`} (${duration} minutes; it is part of the story: put it in the opening sentence).`);
  const long = decider && (bestOf === 5 || nSets === 3);
  if (long) res.push('LONG REPORT: this match went the distance. Up to about 250 words, the extra ones for the context and the turning point.');
  if (m.surface) res.push(`Surface: ${m.surface}${m.venue && m.venue.indoor ? ', indoors' : ''}.`);
  for (const k of [w, l]) { const r = num(m[k + 'Rank']); if (r != null) res.push(`${surnameOf(m[k])} is ranked ${r}.`); }
  if (styles && styles[w] && styleEarned(styles[w], ms[w], ms[l])) res.push(`Playing style of ${W}: ${styles[w]} (the numbers of this match show it).`);
  add('RESULT', res);
  add('THE MATCH IN PLAYING ORDER (from the point log)', shard ? setStory(shard, m, bestOf) : []);
  add('WHAT IT MEANS (from our own records)', milestones);
  add('WHAT STOOD OUT (each figure already compared with the player\'s own average where one is given)', rep ? rep.sentences.slice(1).filter((s) => !/games in a row/.test(s)).map((s) => [m[w], m[l]].reduce((t, c) => t.split(c).join(surnameOf(c)), s)) : []);
  const wueOk = wueUsable(ms);
  // The two summary figures (founder 2026-11-15: "use it once in a while ... especially if they are high and impressive"):
  // the dominance ratio (ours) and the performance rating (the broadcast card, when there is one). On the sheet only
  // when they stand out; the SHAPE section then asks for one of them in about half of those reports.
  const dw = dominanceRatio(ms[w]), dl = dominanceRatio(ms[l]), perf = card && card[w] ? num(card[w].performance) : null, summary = [];
  if (dw != null && dl != null && dw >= DR_STANDS_OUT) summary.push(`Dominance ratio: ${W} ${dw.toFixed(2)}, ${L} ${dl.toFixed(2)} (above 1 means he won more points on return than he lost on serve; write it as "a dominance ratio of ${dw.toFixed(2)}").`);
  if (perf != null && perf >= PERF_STANDS_OUT && perf <= 10) summary.push(`Performance rating of ${W}: ${perf.toFixed(1)} out of 10 (write it as "a performance rating of ${perf.toFixed(1)}").`);
  add('SUMMARY FIGURES THAT STAND OUT (you may use one as the number of this report)', summary);
  // What was NOT good in the winner's match (founder 2026-11-15: "mostly a low serve number or a high number of
  // unforced errors"): said in one honest clause, never hidden because he won.
  { const st = ms[w] || {}, v = (k) => num(st[k]), weak = [], Wn = v('Points:Winners'), Un = v('Points:Unforced errors'), df = v('Service:Double Faults'), fin = v('Service:1st serve percentage'), sec = v('Service:2nd serve points won');
    if (wueOk && Un != null && Wn != null && Un >= WEAK_UE_MIN && Un > Wn) weak.push(`${W} made ${Un} unforced errors against ${Wn} winners.`);
    if (df != null && df >= WEAK_DF_MIN) weak.push(`${W} made ${df} double faults.`);
    if (fin != null && fin < WEAK_FIRST_IN) weak.push(`${W} landed only ${Math.round(fin)}% of his first serves.`);
    if (sec != null && sec < WEAK_SECOND_WON) weak.push(`${W} won only ${Math.round(sec)}% of the points behind his second serve.`);
    add('NOT GOOD IN THE WINNER\'S MATCH (say it in one honest clause or sentence: he won, but this was not good)', weak.slice(0, 2)); }
  add('BOX SCORE, WHOLE MATCH', [w, l].map((k) => { const s = statLine(ms[k], { wue: wueOk }); return s ? `${surnameOf(m[k])}: ${s}.` : null; }));
  // no box score per set (founder 2026-11-15: "never per set: 17% in one set is built on a handful of points")
  if (card && card.p1 && card.p2) {
    const c = [];
    for (const k of [w, l]) {
      const x = card[k], p = [];
      if (num(x.serveQuality) != null) p.push(`serve quality ${x.serveQuality.toFixed(1)}`);
      if (num(x.unreturnedPct) != null) p.push(`${x.unreturnedPct}% unreturned serves`);
      if (num(x.returnQuality) != null) p.push(`return quality ${x.returnQuality.toFixed(1)}`);
      if (p.length) c.push(`${surnameOf(m[k])}: ${p.join(', ')} (quality figures are out of 10).`);
    }
    c.push(...shotSentences(m, w, l, card).filter((s) => /baseline|long rallies/.test(s)));
    // forehand and backhand (founder 2026-11-14: "then you must say it, especially if you have the forehand winners"):
    // the counts per wing, and a wing is named his best shot / his weak side only on a clear gap
    for (const k of [w, l]) {
      const x = card[k], N = surnameOf(m[k]), fw = num(x.fhWinners), bw = num(x.bhWinners), fu = num(x.fhUnforced), bu = num(x.bhUnforced);
      if (fw != null && bw != null) c.push(`${N}: ${pl(fw, 'forehand winner')}, ${pl(bw, 'backhand winner')}.`);
      if (fu != null && bu != null) c.push(`${N}: ${pl(fu, 'forehand unforced error')}, ${pl(bu, 'backhand unforced error')}.`);
      const clear = (a, b2, min) => a != null && b2 != null && Math.max(a, b2) >= min && Math.max(a, b2) >= BEST_SHOT_RATIO * Math.min(a, b2);
      const best = clear(fw, bw, BEST_SHOT_MIN) ? (fw > bw ? 'forehand' : 'backhand') : null, weak = clear(fu, bu, WEAK_SIDE_MIN) ? (fu > bu ? 'forehand' : 'backhand') : null;
      // the wording changes from match to match so the reports do not repeat one sentence (founder 2026-11-14)
      const pick = (arr) => arr[parseInt(crypto.createHash('sha256').update(`${m.id}|${k}`).digest('hex').slice(0, 6), 16) % arr.length];
      if (best && best === weak) c.push(pick([`It was all or nothing on the ${best} of ${N}: most of his winners and most of his unforced errors came from that wing.`,
        `${N} played high risk and high reward on the ${best}: most of his winners and most of his unforced errors came from that wing.`]));
      else {
        if (best) c.push(pick([`The ${best} was the best shot of ${N}.`, `${N} did most of his damage with the ${best}.`, `The ${best} of ${N} made the difference in the rallies.`, `Most of the winners of ${N} came from the ${best}.`, `The ${best} was the big weapon of ${N}.`]));
        if (weak) c.push(pick([`Most of the unforced errors of ${N} came from the ${weak}.`, `The ${weak} of ${N} was not reliable.`, `${N} missed too much on the ${weak}.`]));
      }
    }
    add('SHOT NUMBERS', c);
  }
  if (commentary) add('SEEN IN THE MATCH (observations; never name where they come from)', [String(commentary).trim()]);
  add('THE TOURNAMENT', bestOf === 5 ? path.map((x) => x.replace(/\bthe round of 16\b/g, 'R4')) : path);
  if (physical.length) add('PHYSICAL (tell it in ONE flowing sentence, as its own short paragraph just before "All in all")', physical);
  const cs = m.courtSpeed && m.courtSpeed.category ? String(m.courtSpeed.category).toLowerCase() : null;
  // the conclusion ties his style to the conditions of this tournament (founder 2026-11-15), so every sheet says what they are
  { const c = []; if (m.surface) c.push(`${m.surface} court${m.venue && m.venue.indoor ? ', indoors' : ''}.`);
    if (cs && m.venue && m.venue.city) c.push(`The court in ${m.venue.city} plays ${cs === 'medium' ? 'at a medium pace' : cs} (our court-speed reading${m.courtSpeed.abstractSpeedYear ? ` from ${m.courtSpeed.abstractSpeedYear}` : ''}; do not print the year).`);
    add('CONDITIONS', c); }
  // No two reports built the same way (founder 2026-11-15): the opening, the number paragraph and the ending of THIS
  // report are picked here, by match, from the shapes the founder listed; a shape that needs a fact the sheet lacks
  // (a match time, a milestone, a style line, a physical doubt) is not offered.
  { const pk = (arr, salt) => arr[parseInt(crypto.createHash('sha256').update(`${m.id}|shape|${salt}|${process.env.NEWS_SHAPE_SALT || ''}`).digest('hex').slice(0, 6), 16) % arr.length];
    const five = bestOf === 5 && nSets === 5, hasMile = milestones.length > 0, final = /\bfinal$/.test(String(round || ''));
    const open = [`"${W} beat ${L} [score] in [the round] to ..."`, `"${W} beat ${L} in ${nSets === 2 || (bestOf === 5 && nSets === 3) ? 'straight sets' : `${['', '', '', 'three', 'four', 'five'][nSets]} sets`} in [the round] ..." with the set scores told in the next paragraph`];
    if (timeTold) open.push(...(duration <= TIME_SHORT_MIN ? [`"It took ${W} only [time] to beat ${L} [score]."`] : [`"${W} needed ${five ? 'five sets and ' : ''}[time] to get past ${L}, [score]."`, `"${W} beat ${L} in a ${five ? 'five-setter' : 'three-setter'} of [time], [score], to ..."`, `"${W} came through a [time] battle against ${L}, [score]."`]));
    else if (five) open.push(`"${W} needed five sets to get past ${L}, [score] ..."`, `"${W} beat ${L} in a five-setter, [score], to ..."`);
    if (hasMile) open.push(final ? `"${W} is [what the WHAT IT MEANS section says] after beating ${L} [score] in the final."` : `"${W} is into [what the WHAT IT MEANS section says] after beating ${L} [score]."`);
    const close = ['"All in all, ..."', '"In the end, ..."', '"Overall, ..."', '"Credit to him: ..."', `a plain statement with his name first ("${W} did what he had to do ...")`, '"That is ... " (a verdict on the match in a few words, then why)', '"A win that says a lot about ..."', `no opener: "A [big / deserved / hard-earned] win for ${W}, who ..."`, ...(final ? [] : [`"So ${W} is through to [the next round], after ..."`]), '"It was not perfect but ..." (only when the sheet shows a weak point of the winner)'];
    const built = ['the key moment of the match', 'the one thing that decided it', 'how he reacted when the match was going against him (only if it did)', 'what he still has to do better (only if the sheet shows a weak point)', 'how clear the difference was between the two players'];
    if (hasMile) built.push('what it means for him (the WHAT IT MEANS section)');
    if (quotes.length) built.push('the player\'s own words (a few words taken from his quote, without a second quotation)');
    const styled = res.findIndex((x) => x.startsWith('Playing style'));
    if (styled >= 0) built.push('his style of play and the conditions here');
    if (physical.length) built.push('the one doubt that stays');
    const stat = ['"His [first serve / return / ...] was the base of it all."', 'the opponent could not do something against him ("[Loser] never got a look at his serve: ...")', 'a plain start with the number first ("[N]% behind his first serve says how ...")', `"${W} was at his best when it mattered most, ..."`, `"${L} also gave a lot away, with ..." (only when the loser's errors are the story)`, 'a link to the previous paragraph ("That [what the paragraph before showed] also showed on ...")', 'the number inside the story of a set, with no paragraph of its own'];
    const builtOn = pk(built, 'b');
    // a standout summary figure is asked for in about half of the reports that have one
    const useSummary = summary.length && parseInt(crypto.createHash('sha256').update(`${m.id}|summary`).digest('hex').slice(0, 6), 16) % 2 === 0;
    // the style is named in one report out of the few that earn it: when this ending is not built on it, the line leaves the sheet
    if (styled >= 0 && !/style of play/.test(builtOn)) { const at = lines.indexOf(res[styled]); if (at >= 0) lines.splice(at, 1); }
    const nextUp = ['"Next is [opponent] in [round]."', '"[Opponent] is next."', '"He plays [opponent] in [round]."', '"[Opponent] waits in [round]."', '"Up next: [opponent]."', 'inside the last sentence ("... and now gets [opponent] in [round]")'];
    const lead = ['what he felt at that moment', 'the game or the set the quote is about ("On that game at 5–4 he said:")', 'what it meant to him', 'a short plain "[Name] afterwards:"', 'his own verdict on the match ("[Name] knows ...:")'];
    add('SHAPE OF THIS REPORT (follow it, so that no two reports are built the same way)', [`Opening sentence, in this form: ${pk(open, 'o')}`, `The quote is introduced through ${pk(lead, 'q')}.`, `The number: ${useSummary ? `use ${/Performance rating/.test(summary[summary.length - 1]) ? 'the performance rating' : 'the dominance ratio'} from the SUMMARY FIGURES section, in the last paragraph or as the number of the report` : pk(stat, 's')}`,
      `Last paragraph: open it with ${pk(close, 'c')} and build it on ${builtOn}.`, ...(final ? [] : [`The next opponent: ${pk(nextUp, 'n')}`])]); }
  // the founder's phrases: each report is offered a few of them, so no sentence returns in every report
  const ph = PHRASES.map((x, i) => [crypto.createHash('sha256').update(`${m.id}|${i}`).digest('hex'), x]).sort((x, y) => x[0].localeCompare(y[0])).slice(0, 4).map((x) => x[1]);
  add('WORDING (phrases of the founder you may use here, two at most; none is required)', ph);
  const text = lines.join('\n');
  const hash = crypto.createHash('sha256').update(JSON.stringify([COMPOSE_VERSION, text, quotes.map((q) => q.text)])).digest('hex').slice(0, 16);
  return { lines, text, quotes, hash, sets, long, winner: W, loser: L, isFinal: /final\b/.test(String(round || '')) && !/quarter|semi/.test(String(round || '')) };
}

// ---- the check ------------------------------------------------------------------------------------------------------
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[–—−]/g, '-').replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
const PAIR = /\b\d{1,3}-\d{1,3}(?:\(\d+\))?(?![\w-])/g;
const NUMBER = /\d+(?:\.\d+)?/g;
const NUM_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twice: 2 };
const COUNTED = '(?:straight |more |consecutive |of the |of his |match |set |break |double |unforced |service |games? |sets? )?(?:breaks?|points?|aces?|games?|sets?|winners?|errors?|faults?|hours?|times|tiebreaks?|meetings?|matches|wins?|titles?|finals?|in a row)';
// words that state something we can only know from a source: allowed only when a line on the sheet carries the same word
export const RISKY = ['forehand', 'backhand', 'volley', 'slice', 'drop shot', 'dropshot', 'lob', 'smash', 'overhead', 'net', 'injur', 'pain', 'cramp', 'tired', 'fatigue', 'exhaust', 'limp',
  'physio', 'doctor', 'trainer', 'medical', 'treatment', 'crowd', 'wind', 'sun', 'roof', 'heat', 'humid', 'cold', 'nervous', 'nerves', 'angry', 'frustrat', 'racket', 'racquet', 'umpire',
  'coach', 'fresh', 'tape', 'strapp', 'blister', 'knee', 'ankle', 'shoulder', 'wrist', 'elbow', 'hip', 'thigh', 'calf', 'fever', 'sick', 'illness', 'title', 'trophy', 'career', 'ranking', 'ranked',
  'seed', 'champion', 'debut', 'record', 'streak', 'qualif', 'wildcard', 'wild card', 'lucky loser', 'bye', 'year', 'season', 'month', 'yesterday', 'tomorrow', 'aged', 'years old',
  'birthday', 'left-hand', 'lefty', 'slow court', 'fast court', 'conditions', 'balls', 'altitude'];
const SOURCE_WORDS = /\b(the card|stats card|commentator|commentators|commentary|highlights|broadcast|tennis tv|atp tour|according to|reportedly|the data|our data|point log|box score|press conference|on-court interview|interview)\b/i;

export function sheetIndex(sheet) {
  const t = norm(sheet.text);
  const pairs = new Set(t.match(PAIR) || []);
  const numbers = new Set((t.replace(PAIR, (p) => ' ' + p.replace(/[-()]/g, ' ') + ' ').match(NUMBER) || []).map((x) => String(+x)));
  for (const p of pairs) for (const x of p.match(/\d+/g)) numbers.add(String(+x));
  const caps = new Set((t.match(/\p{Lu}[\p{L}'-]+/gu) || []).map((x) => x.toLowerCase()));
  return { pairs, numbers, caps, lower: t.toLowerCase() };
}

// -> { ok, failures: string[] }
export function checkComposed(text, sheet, { surnames = new Set() } = {}) {
  const fail = [], ix = sheetIndex(sheet), full = norm(text).trim();
  // quotations first: each one word for word from the sheet, with its speaker named just before it
  const spans = [...full.matchAll(/"([^"]*)"/g)];
  if ((full.match(/"/g) || []).length % 2) fail.push('an unclosed quotation mark');
  if (spans.length > QUOTES_IN_TEXT) fail.push(`more than ${QUOTES_IN_TEXT} quotations`);
  const used = new Set();
  for (const sp of spans) {
    const q = sheet.quotes.find((x) => verbatimIn(sp[1], x.text));
    if (!q) { fail.push(`quotation not on the sheet word for word: "${sp[1].slice(0, 60)}"`); continue; }
    const whole = foldText(q.text), part = foldText(sp[1]), at = whole.indexOf(part), pre = whole.slice(0, at).trim(), post = whole.slice(at + part.length).trim();
    if ((pre && !/[.!?…]$|\.\.\.$/.test(pre)) || (post && !/[.!?…,]$|\.\.\.$/.test(part))) fail.push(`quotation cut in the middle of a sentence: "${sp[1].slice(0, 60)}"`);
    const lead = full.slice(0, sp.index).split('\n').pop();   // a quote sits inside the paragraph it explains: its speaker is named earlier in that paragraph
    // the speaker is named earlier in the paragraph — or he is the last of the two players named before the quotation
    // ("... like Fritz in these conditions. He said:" cost a paid retry three times on 2026-11-15)
    const befo = norm(full.slice(0, sp.index)).toLowerCase(), who = norm(q.speaker).toLowerCase(), oth = norm(q.speaker === sheet.winner ? sheet.loser : sheet.winner).toLowerCase();
    const lastNamed = befo.lastIndexOf(who) >= 0 && befo.lastIndexOf(who) > befo.lastIndexOf(oth);
    if (!norm(lead).toLowerCase().includes(who) && !lastNamed) fail.push(`the speaker (${q.speaker}) is not named before his quotation`);
    if (used.has(q.id)) fail.push('the same quotation twice'); used.add(q.id);
  }
  const body = full.replace(/"[^"]*"/g, ' QUOTE ');
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean), words = (body.match(/[\p{L}\d'%-]+/gu) || []).length;
  if (paras.length < 3 || paras.length > 9) fail.push(`${paras.length} paragraphs (3 to 9)`);
  const wmax = sheet.long ? WORDS_LONG_MAX : WORDS_MAX;
  if (words < WORDS_MIN || words > wmax) fail.push(`${words} words (${WORDS_MIN} to ${wmax})`);
  // the ending is not always "All in all" (founder 2026-11-15: "change the wording and the shape of the last paragraph")
  // the score and the round are in the first sentence (founder 2026-11-14)
  const s1 = (paras[0] || '').split(/(?<=[.!?])\s+/)[0] || '', sc = (sheet.sets || []).map((x) => norm(x));
  // founder 2026-11-15: "you can also say beat him in 5 sets, important to alternate": then every set score is told later
  const inSets = /\bin (straight|two|three|four|five) sets\b/i.test(s1);
  // an opening that says how many sets it took needs no score list: asking for one made every such report a paid second try
  if (sc.length && !inSets && !sc.every((x) => s1.includes(x))) fail.push(`the first sentence gives neither the score (${(sheet.sets || []).join(', ')}) nor how many sets it took`);
  // no chain of very short sentences
  { let run = 0; for (const sen of body.split(/\n+/).flatMap((par) => par.replace(/QUOTE\s*$/, 'QUOTE.').split(/(?<=[.!?])\s+/))) { const n = (sen.match(/[\p{L}\d'%-]+/gu) || []).length; run = n && n <= SHORT_WORDS ? run + 1 : 0; if (run >= SHORT_RUN) { fail.push(`${SHORT_RUN} very short sentences in a row (join what belongs together)`); break; } } }
  // one number per idea: few percentages and quality figures
  { const st = (body.replace(PAIR, ' ').match(/\d+(?:\.\d+)?%|\b\d\.\d\b/g) || []).length; if (st > STAT_NUMBERS_MAX) fail.push(`${st} percentages and quality figures (at most ${STAT_NUMBERS_MAX}: one number per idea, never two numbers for the same thing)`); }
  const first = (paras[0] || '').toLowerCase();
  if (!first.includes(norm(sheet.winner).toLowerCase()) || !first.includes(norm(sheet.loser).toLowerCase())) fail.push('the first paragraph does not name both players');
  if (/\b(I|me|my|we|us|our)\b/.test(body)) fail.push('first person outside a quotation');
  if (SOURCE_WORDS.test(body)) fail.push(`names a source ("${SOURCE_WORDS.exec(body)[0]}")`);
  if (/\?/.test(body) || /!/.test(body.replace('(!!!)', ''))) fail.push('a question mark or exclamation mark (only one "(!!!)" is allowed)');
  if (/(^|\s)[A-Z]\.\s/.test(body)) fail.push('an initial before a name');
  if (/[*#_]|^\s*[-•]/m.test(body)) fail.push('markdown or a list');
  if (/,\s+(but|and)\b/i.test(body)) fail.push(`a comma before "${/,\s+(but|and)\b/i.exec(body)[1].toLowerCase()}" (write it without the comma, or start a new sentence)`);
  // scores and numbers
  const rev = (p) => p.replace(/^(\d+)-(\d+)$/, '$2-$1');   // the same score told from the other player's side
  for (const p of body.match(PAIR) || []) if (!ix.pairs.has(p) && !ix.pairs.has(rev(p))) fail.push(`score "${p}" is not on the sheet`);
  for (const n of body.replace(PAIR, ' ').replace(/\bR[1-4]\b/g, ' ').match(NUMBER) || []) if (!ix.numbers.has(String(+n))) fail.push(`number "${n}" is not on the sheet`);
  for (const mm of body.matchAll(new RegExp(`\\b(${Object.keys(NUM_WORDS).join('|')})\\s+${COUNTED}\\b`, 'gi'))) {
    if (mm[1].toLowerCase() !== 'twice' && !ix.numbers.has(String(NUM_WORDS[mm[1].toLowerCase()]))) fail.push(`"${mm[0]}" — ${NUM_WORDS[mm[1].toLowerCase()]} is not on the sheet`);
  }
  // names: a capitalised word inside a sentence must be on the sheet; any player's surname must be on the sheet
  const OK_CAPS = new Set(['qf', 'sf', 'all', 'next', 'quote']);
  const nameBody = full.replace(/"[^"]*"/g, (q) => (/[.!?…]"$/.test(q) ? ' QUOTE. ' : ' QUOTE '));   // a quotation that ends its sentence: the next word opens a sentence
  for (const mm of nameBody.matchAll(/(^|[.!?:…]["')]*\s+|\n\s*)?(\p{Lu}[\p{L}'-]+)/gu)) {
    const w = mm[2].toLowerCase().replace(/'s$/, ''), opener = mm[1] !== undefined || mm.index === 0;   // "Dahlin's" is Dahlin
    if (ix.caps.has(w) || OK_CAPS.has(w)) continue;
    if (opener && !surnames.has(w)) continue;
    fail.push(`"${mm[2]}" is not on the sheet`);
  }
  // words that need a line behind them
  const low = body.toLowerCase();
  // how a player felt may be said when it sets up his own quotation (founder 2026-11-15: "a set down and angry" before
  // "Yeah, I was pissed"): with a quotation in the text, these words need no sheet line. Measured: "angry" cost two paid retries.
  const FELT = new Set(['angry', 'frustrat', 'nervous', 'nerves']);
  for (const r of RISKY) if (new RegExp(`\\b${r}`, 'i').test(low) && !new RegExp(`\\b${r}`, 'i').test(ix.lower) && !(FELT.has(r) && spans.length)) fail.push(`"${r}" — nothing on the sheet says it`);
  return { ok: fail.length === 0, failures: [...new Set(fail)] };
}

// ---- the writer -----------------------------------------------------------------------------------------------------
export const SYSTEM = `You write the match report of one ATP tennis match for Stennisfy, in the voice of its founder, who watches every match and writes for bettors in plain English. You receive a FACT SHEET and a list of QUOTES. Write the report from the fact sheet only.

The report is short and it reads fluently. It is a small story told out loud: after reading it, somebody who did not see the match can picture what happened. It is never a list of facts and it never sounds like the report before it.

Length: 150 to 180 words, quotes included. Only when the sheet says "LONG REPORT": up to about 250 words, and the extra words go to the context and the turning point, never to more numbers or to game by game. In a long report too, a game score ("at 5–4", "1–4 behind") appears at most twice, only at the turning point: say "served for the set", "a break down", "late in the set" instead.

Shape (4 or 5 short paragraphs, one blank line between them, plain text: no title, no headings, no lists, no bold):
1. The opening sentence: who beat who, the round, what it means when the sheet says it (a title, a first final, a first Grand Slam quarter-final) and either the score of every set or how many sets it took. Build it the way the SHAPE section of the sheet asks. When the sheet has a "Match time" line, the time goes in this sentence; when it has none, never mention a time. No head to head, unless the sheet has a "Big rivalry" line.
2. The match, so the reader can picture it:
   - Tell the events in the order they happened: he served for the set, he got broken, the tiebreak, who won it. Never "X took the set even though Y had broken him before".
   - Tell the turning point step by step, each step its own moment ("He was one game away from the quarter-final and served for the match but Arnaldi broke back just in time, forced another tiebreak and was clearly the better player in it.").
   - Say where the match stands after a set, with the sheet's own words ("to lead by two sets", "two sets to one", "two sets all", "one set away from the semi-final"). The reader always knows who is ahead.
   - One quote, set up before it: say what it refers to and what the player felt, so the reader does not have to work it out, and show the consequence right after it. Choose a lead-in that fits this quote ("It was new territory for him:", "On that game at 5–4 he said:", "Fritz knows he let it slip:"). Do not write "He explained it himself:".
   - One sentence per set at most in a normal match; no game by game ("broke for 3–1", "needed 2 break points"). A run of games is told inside its set with the score it led to ("he won 6 games in a row to take the second set"), never across two sets.
3. One number that tells the story, inside a sentence that links it to what came before. Read the number before you praise it: use it only when the sheet shows it is far from the player's own average or clearly extreme (the opponent's 53 unforced errors, 85% behind the first serve against a 74% average). A number that is ordinary for that player proves nothing: leave it out and say in words how he played. When the winner saved clearly more of the break points than his opponent, say in your own words that he was the more clutch player on the big points. Open this paragraph the way the SHAPE section asks.
4. Only when the sheet has a PHYSICAL section: one flowing sentence as its own paragraph. Never a word about the reason.
5. The last paragraph: open it and build it the way the SHAPE section asks. It is not always "All in all". The winner's style of play is named only when the sheet has a "Playing style" line and then attached to HIM and to the conditions here ("exactly what makes a big server and complete baseliner like him so effective on a hard court like this one"), never as a general truth. With no such line, name no style and do not describe one in other words either (no "his mix of a big serve and a complete game", no "his attacking game from the baseline"): most reports end without any. Before a final or earlier round ends: the next opponent in one short clause. After a final: the title, and a second quote may close the report.

How it reads:
- Simple words, the way you would say it out loud. If a sentence needs to be read twice, rewrite it. No idioms, no tennis-writer words ("lost the thread", "a tight decider", "sealed", "clinical", "dug deep").
- Plain words for who was better ("was the better player in the first set and took it 6–2"), but do not repeat one praise phrase: not always "very solid behind his serve", not always "clutch". Say what the number or the moment actually shows.
- When the sheet has a NOT GOOD IN THE WINNER'S MATCH section, say it plainly in one clause or one sentence ("It was not perfect: he made 54 unforced errors."). A win does not hide a low serve number or a lot of errors.
- A point he saved in a game he then lost anyway is not told: say he was broken, or that he lost the set.
- Vary how the same kind of moment is told ("broke him at the last moment", "broke back just in time", "Shelton was not done yet", "Alcaraz did not give up").
- No chains of short sentences. Join what belongs together and let one sentence lead into the next: one longer sentence, then a shorter one.
- Every paragraph after the first opens with a link to the one before it, not with a name and a fact.
- After a number, stop: do not explain what the number already says. Do not link two facts with "so" when one simply follows the other.
- The report is about the winner. The loser gets a clause or a line only when the sheet has important information about him.
- No recap of anybody's week. Never invent a detail to add colour (how he walked, how he looked, what the crowd did): only what the sheet, the "seen in the match" lines and the player's own words give you.

Hard rules:
- Every fact comes from the fact sheet. Never use your own knowledge of the players, the tournament, rankings, injuries, past seasons or anything that happened after the match. If the sheet does not say it, it is not in the report.
- Copy every number and every score exactly as the sheet writes it, as digits (7–5, 90%, 5 games in a row). Scores with an en dash. Do not calculate new numbers. Percentages, never the counts behind them. Never a figure for one set. Winners are printed under your text and stay out of it; unforced errors may be the one number only when they are the story.
- Players by SURNAME ONLY, never a first name or an initial.
- A quote is copied word for word from the QUOTES list, inside straight double quotation marks ("). You may use a whole quote, or whole sentences from the start of it. Never change, shorten inside, translate or tidy a quote. Nothing else goes inside quotation marks. The speaker's surname must appear earlier in the same paragraph. One quote; two only after a final, where the last one is the quote that says most about the title. When the QUOTES list is not empty, the report carries a quote.
- Never say where anything comes from: no "the stats", "the data", "the card", "the commentators", "the highlights", "in his interview", "in his press conference", "according to".
- Never write about a shot (forehand, backhand, volley, net), the body (injury, pain, knee, tired, fresh), nerves, the crowd, the court speed or the balls unless a line of the fact sheet says so. A quote does not count as a line of the fact sheet.
- About a medical timeout: only what the PHYSICAL section says. Never the reason, never "the reason is not known", never how he looked.
- No "I", "me", "my", "we" or "our" outside a quote. No questions. No exclamation marks, except "(!!!)" at most once, straight after one number that is truly exceptional.
- Past tense for what happened. Do not print a ranking. A dominance ratio or a performance rating only when the sheet has a SUMMARY FIGURES section and only that one figure.
- The WORDING section of the sheet offers a few phrases of the founder. Use one at most, only where it fits.
- When the sheet has no match in playing order: 80 to 120 words.

Five reports written by the founder, as the models for voice, flow and how much context a match gets. Never reuse their facts or their exact sentences, and never build two reports the same way: the SHAPE section of your sheet decides the opening, the number paragraph and the ending of THIS report.

---
Fritz beat Tirante 6–2, 4–6, 7–6 in the final to win the title in Stockholm.

Fritz was the better player in the first set and took it 6–2. The second set went the other way: Tirante got the break and won it 6–4. Fritz knows he let it slip: "It was a stressful match, … I came out and was playing really well but then let some opportunities slip." The third set stayed on serve all the way to the tiebreak, where Fritz was the better player at the end and took it 7–3.

Fritz was very solid behind his serve, especially his second serve, where he won 73% of the points, far above his average of 53% on hard.

All in all, a deserved title for Fritz, built on a strong start and a serve that held when the final got tight. That is what makes a big server and complete baseliner like him so effective in these conditions. On the title he said: "I have lost a lot of indoor finals but at the same time I didn't look too much into it, because when I won Tokyo, it was pretty much indoors as the roof was closed a lot, … It feels good to get that one now."
---
Tirante beat Tabilo 7–5, 7–6 in the SF to reach his first tour-level final.

Both sets were close and decided on a few points. Tirante got the only break of the first set late to take it 7–5 and in the second he served for the match at 5–4 but could not finish it, as Tabilo broke back. He stayed calm and was clearly the better player in the tiebreak, taking it 7–1. On that game at 5–4 he said: "Well, always we have nervous all the matches … I think I keep believing in me, in my team"

Once again his serve carried him, with 90% of the points won behind his first serve (!!!) and the forehand did the rest.

The one doubt before the final is his body: he called the physio early in the second set, his second medical timeout in two matches.

All in all, a strong win from Tirante, built on his first serve and his forehand, the two shots that make an attacking baseliner like him so effective in these indoor conditions. Next is Fritz in the final.
---
Shelton needed five sets to get past Alcaraz, 6–7, 6–1, 6–3, 1–6, 7–6 and reach a Grand Slam semi-final for the third time.

It went back and forth from the start. Alcaraz was one game away from the first set and served for it but Shelton broke him at the last moment to force a tiebreak. Alcaraz still won that tiebreak, so Shelton was a set down and angry. But he had just shown he could break Alcaraz when it mattered and that changed the match: "Yeah, I was pissed, but I broke the last game before the tiebreaker, so that kind of helped my confidence going into the second set." From there he won 6 games in a row to take the second set.

An early break gave him the third set too and he was one set away from the semi-final. Alcaraz did not give up: he came back strongly in the fourth and took it 6–1 to force a fifth set. That fifth set stayed on serve all the way to the deciding tiebreak, where Shelton kept his calm and took it 10–7.

Alcaraz also gave a lot away over five sets, with 53 unforced errors, while Shelton stayed solid behind his serve from start to finish.

A huge win for Shelton, who lost the first set, saw Alcaraz come back to two sets all and was still the stronger player at the very end. Next is Tiafoe in the SF.
---
Zverev is a two-time Grand Slam champion after beating Shelton 6–3, 7–6, 5–7, 6–2 in the final.

Zverev was the better player in the first set and took it 6–3. The second was much closer: both players held serve all the way to the tiebreak and Zverev won it 7–2 to lead by two sets. Shelton was not done yet. He broke late in the third set to take it 7–5 and get back into the final. Zverev's answer came straight away in the fourth, with two breaks and he didn't even know the exact score when he served for the title: "No, I thought it was 5-1. I knew I broke him twice, but I thought it was 5-1 instead of 6-2, which helped me in a way, because I didn't really get nervous serving out the match."

His first serve was the base of it all. He won 85% of the points behind it, far above his 74% average on hard and on the big points he was the more clutch player of the two.

In the end, a title built on that first serve and on staying calm when it mattered, exactly what makes a big server and complete baseliner like him so effective on a hard court like this one. It also closes a chapter for him, after the final he lost here in 2020: "It feels amazing, especially with the heartbreak I had in 2020 here."
---
Arnaldi beat Tiafoe in a five-setter, 7–6, 6–7, 3–6, 7–6, 6–4, to reach his first Grand Slam quarter-final.

It could not have been closer at the start: the first two sets both went to a tiebreak and both finished 7–5, the first for Arnaldi and the second for Tiafoe. Tiafoe then got the break in the third set to take it 6–3 and lead by two sets to one. In the fourth he was one game away from the quarter-final and served for the match but Arnaldi broke back just in time, forced another tiebreak and was clearly the better player in it, 7–3. With the match turned around, he finished the job in the fifth set, 6–4. It was new territory for him: "I mean, I feel like I always see myself as a fighter, as someone that would give everything on court, but I never actually played these kind of matches, that match that long, and in a row."

Arnaldi was at his best when it mattered most, far more clutch than Tiafoe on the big points and his serve helped him too, with 65% of first serves in against his 56% average on clay.

Overall, a fighter's win from Arnaldi, who was one game away from going out and turned it around. Next is Berrettini in the QF.
---

Before you answer, read your report out loud in your head. If it sounds like a list being read, or like one of the models with the names changed, rewrite it. Reply with the report text only.`;

export function userMessage(sheet, failures = null, previous = null) {
  const q = sheet.quotes.length ? sheet.quotes.map((x, i) => `Q${i + 1} — ${x.speaker}${x.topic ? ` (${x.topic})` : ''}: "${x.text}"`).join('\n') : '(none)';
  let t = `FACT SHEET\n${sheet.text}\n\nQUOTES (word for word; use at most ${QUOTES_IN_TEXT})\n${q}`;
  if (failures && failures.length) t += `\n\nYour previous text was rejected by the fact check:\n${failures.slice(0, 12).map((f) => `- ${f}`).join('\n')}\n\nPrevious text:\n${previous}\n\nWrite it again and fix every point. Leave out anything the fact sheet does not carry.`;
  return t;
}

async function callModel(sheet, failures, previous, apiKey, fetchFn) {
  const body = { model: REPORT_MODEL, max_tokens: 8000, output_config: { effort: 'medium' }, system: SYSTEM, messages: [{ role: 'user', content: userMessage(sheet, failures, previous) }] };
  let res;
  try { res = await fetchFn(API_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) }); }
  catch (e) { return { status: 'api-error', detail: String(e && e.message || e).slice(0, 200) }; }
  if (!res.ok) { const t = res.text ? await res.text().catch(() => '') : ''; return { status: 'api-error', detail: `HTTP ${res.status} ${String(t).slice(0, 240)}` }; }
  const data = await res.json();
  const usage = data.usage ? { input: data.usage.input_tokens || 0, output: data.usage.output_tokens || 0 } : null;
  if (data.stop_reason === 'refusal' || data.stop_reason === 'max_tokens') return { status: 'api-error', detail: `stop_reason ${data.stop_reason}`, usage };
  return { status: 'ok', text: String(((data.content || []).find((b) => b.type === 'text') || {}).text || '').trim(), usage, model: REPORT_MODEL };
}

// The comma before "but" / "and" is taken out by code (founder 2026-11-14: "you can see it's AI"): punctuation only,
// never inside a quotation, so a report is not thrown away for it.
export function noCommaBefore(text) {
  return String(text).split(/("[^"]*")/).map((part, i) => (i % 2 ? part : part.replace(/,(\s+(?:but|and)\b)/g, '$1'))).join('');
}
// One report. opts.writer(sheet, failures, previous) replaces the model in tests.
// -> { status: 'ok'|'failed-check'|'no-key'|'api-error', text?, tries, failures?, usage, model? }
export async function composeReport(sheet, opts = {}) {
  const apiKey = opts.apiKey !== undefined ? opts.apiKey : process.env.ANTHROPIC_API_KEY;
  if (!opts.writer && !apiKey) return { status: 'no-key', tries: 0, usage: { input: 0, output: 0 } };
  const usage = { input: 0, output: 0 };
  let failures = null, previous = null, model = null;
  for (let t = 1; t <= 2; t++) {
    const r = opts.writer ? await opts.writer(sheet, failures, previous) : await callModel(sheet, failures, previous, apiKey, opts.fetchFn || fetch);
    if (r.usage) { usage.input += r.usage.input; usage.output += r.usage.output; }
    if (r.status !== 'ok') return { status: r.status, detail: r.detail || null, tries: t, usage };
    model = r.model || null;
    const text = noCommaBefore(String(r.text || '').replace(/\r/g, '').replace(/[“”]/g, '"').replace(/\n{3,}/g, '\n\n').trim());
    const c = checkComposed(text, sheet, { surnames: opts.surnames || new Set() });
    if (c.ok) return { status: 'ok', text, tries: t, usage, model, ...(failures ? { retryWhy: failures.slice(0, 6) } : {}) };   // why the first try was refused: the retry doubles the cost
    failures = c.failures; previous = text;
  }
  return { status: 'failed-check', failures, tries: 2, usage, model, rejected: previous };
}

// The published text: the written paragraphs, the physical paragraph before the verdict, the closing lines last.
export function assemble(body, mto = [], rating = []) {
  const paras = String(body).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const last = paras.pop();
  return [...paras, mto.length ? mto.join(' ') : null, last, ...rating].filter(Boolean).join('\n\n');
}
