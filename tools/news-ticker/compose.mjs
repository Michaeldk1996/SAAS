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
import { wueUsable, foldText, verbatimIn } from './news-core.mjs';
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
export const WORDS_MIN = 70, WORDS_MAX = 215;   // founder 2026-11-15: 150 to 180 words with the quotes; this counts the words outside quotations, with room so a first try a little over is not paid twice
export const STAT_NUMBERS_MAX = 3;       // founder 2026-11-15: one stat per report (with the player's average when the gap is big)
export const SHORT_WORDS = 7, SHORT_RUN = 3;   // three sentences of 7 words or fewer in a row read like a machine
export const PHRASES = ['The first set could easily have gone the other way.', 'From there the match turned completely.', 'It was the same story in the second set.', 'That was the moment of the match.',
  'He really struggled behind his second serve.', 'He was clearly the better player from the baseline.', 'He did not see another break point.', 'He got broken straight back.', 'He served it out.',
  'It was not his best return performance.', 'That made the difference in the end.', 'He stayed calm.', 'Credit to him.'];
// a wing is "his best shot" from 10 winners and 1.5 times the other wing; "most of his errors" from 12 and 1.5 times
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
    const m = /\((\d+)\)/.exec(parts[i] || '');
    if (!m || !((s.p1 === 7 && s.p2 === 6) || (s.p1 === 6 && s.p2 === 7))) return null;
    const lo = +m[1]; return `${Math.max(7, lo + 2)}–${lo}`;
  });
}

// The match in playing order, from the point-by-point shard. Lines only when the whole shard agrees with the final
// score (pbpFacts); break points, set points and match points only from games whose point list is complete (strict).
export function setStory(shard, m, bestOf = 3) {
  if (!pbpFacts(shard, m.finalScore, bestOf)) return [];
  const N = (k) => surnameOf(m[k]), toWin = bestOf === 5 ? 3 : 2, fs = m.finalScore.sets, tbs = tiebreakScores(m.finalScore);
  const setsWon = { p1: 0, p2: 0 }, out = [];
  for (let i = 0; i < shard.sets.length; i++) {
    const games = (shard.sets[i].games || []).filter((g) => PI.isGame(g)), sw = SET_WORD[i + 1] || `set ${i + 1}`, lines = [];
    let prev = { p1: 0, p2: 0 }, lastBreakBy = null, lastBreakIdx = -9, breaks = 0;
    games.forEach((g, j) => {
      const h = hdr(g.score), s = g.server, r = other(s), broken = g.winner !== s, st = strictGame(g);
      const clinch = (k) => prev[k] >= 5 && prev[k] > prev[other(k)];
      const kind = (k) => (setsWon[k] === toWin - 1 ? 'match' : 'set');
      let needed = 0;
      if (st.ok) {
        for (const k of [s, r]) {
          if (!clinch(k)) continue;
          const missed = st.scores.filter((sc) => gamePoint(sc, k)).length - (g.winner === k ? 1 : 0);
          if (missed > 0) lines.push(`${N(other(k))} saved ${pl(missed, `${kind(k)} point`)} with ${N(k)} leading ${prev[k]}–${prev[other(k)]} (${N(s)} serving).`);
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
    });
    const f = fs[i], wk = f.p1 > f.p2 ? 'p1' : 'p2';
    out.push(`${sw[0].toUpperCase()}${sw.slice(1)} set: ${N(wk)} won it ${f[wk]}–${f[other(wk)]}${tbs[i] ? ` (tiebreak ${tbs[i]})` : ''}.${breaks === 0 ? ' No break of serve in this set.' : ''}`);
    out.push(...lines.map((x) => `  ${x}`));
    setsWon[wk]++;
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
export function factSheet({ m, w, l, rep, shard = null, round = null, duration = null, card = null, commentary = null, quotes = [], path = [], styles = null, physical = [] }) {
  const W = surnameOf(m[w]), L = surnameOf(m[l]), ms = m.matchStats || {}, lines = [];
  const add = (head, arr) => { const a = (arr || []).filter(Boolean); if (a.length) { lines.push(`## ${head}`); lines.push(...a); } };
  const sets = (m.finalScore.sets || []).map((s) => `${s[w]}–${s[l]}`), tbs = tiebreakScores(m.finalScore);
  const res = [`${W} beat ${L} ${sets.map((s, i) => (tbs[i] ? `${s} (tiebreak ${tbs[i]})` : s)).join(', ')}${m.retired ? ' (retirement)' : ''}${round ? ` in ${roundCode(round)}` : ''}${m.qualifying ? '' : ''}.`];
  const h = rep && rep.fields && rep.fields.h2h;
  // head to head only in a big rivalry (founder 2026-11-15): both in the top 10 and 10 meetings or more
  if (h && h.n >= H2H_MIN_MEETINGS && [w, l].every((k) => num(m[k + 'Rank']) != null && m[k + 'Rank'] <= H2H_TOP_RANK)) { const a = h.a, b2 = h.n - h.a; res.push(a === b2 ? `Big rivalry: the head-to-head is now level at ${a}–${b2}.` : `Big rivalry: ${a > b2 ? W : L} now leads the head-to-head ${Math.max(a, b2)}–${Math.min(a, b2)}.`); }
  if (num(duration) != null) res.push(`Match time: ${duration} minutes (${Math.floor(duration / 60)}h${String(duration % 60).padStart(2, '0')}).`);
  if (m.surface) res.push(`Surface: ${m.surface}${m.venue && m.venue.indoor ? ', indoors' : ''}.`);
  for (const k of [w, l]) { const r = num(m[k + 'Rank']); if (r != null) res.push(`${surnameOf(m[k])} is ranked ${r}.`); }
  if (styles) for (const k of [w, l]) if (styles[k]) res.push(`Playing style of ${surnameOf(m[k])}: ${styles[k]}.`);
  add('RESULT', res);
  add('THE MATCH IN PLAYING ORDER (from the point log)', shard ? setStory(shard, m, 3) : []);
  add('WHAT STOOD OUT (each figure already compared with the player\'s own average where one is given)', rep ? rep.sentences.slice(1).map((s) => [m[w], m[l]].reduce((t, c) => t.split(c).join(surnameOf(c)), s)) : []);
  const wueOk = wueUsable(ms);
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
  add('THE TOURNAMENT', path);
  if (physical.length) add('PHYSICAL (tell it in ONE flowing sentence, as its own short paragraph just before "All in all")', physical);
  const cs = m.courtSpeed && m.courtSpeed.category ? String(m.courtSpeed.category).toLowerCase() : null;
  // the conclusion ties his style to the conditions of this tournament (founder 2026-11-15), so every sheet says what they are
  { const c = []; if (m.surface) c.push(`${m.surface} court${m.venue && m.venue.indoor ? ', indoors' : ''}.`);
    if (cs && m.venue && m.venue.city) c.push(`The court in ${m.venue.city} plays ${cs === 'medium' ? 'at a medium pace' : cs} (our court-speed reading${m.courtSpeed.abstractSpeedYear ? ` from ${m.courtSpeed.abstractSpeedYear}` : ''}; do not print the year).`);
    add('CONDITIONS', c); }
  // the founder's phrases: each report is offered a few of them, so no sentence returns in every report
  const ph = PHRASES.map((x, i) => [crypto.createHash('sha256').update(`${m.id}|${i}`).digest('hex'), x]).sort((x, y) => x[0].localeCompare(y[0])).slice(0, 4).map((x) => x[1]);
  add('WORDING (phrases of the founder you may use here, two at most; none is required)', ph);
  const text = lines.join('\n');
  const hash = crypto.createHash('sha256').update(JSON.stringify([COMPOSE_VERSION, text, quotes.map((q) => q.text)])).digest('hex').slice(0, 16);
  return { lines, text, quotes, hash, sets, winner: W, loser: L, isFinal: /final\b/.test(String(round || '')) && !/quarter|semi/.test(String(round || '')) };
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
    if (!norm(lead).toLowerCase().includes(norm(q.speaker).toLowerCase())) fail.push(`the speaker (${q.speaker}) is not named before his quotation`);
    if (used.has(q.id)) fail.push('the same quotation twice'); used.add(q.id);
  }
  const body = full.replace(/"[^"]*"/g, ' QUOTE ');
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean), words = (body.match(/[\p{L}\d'%-]+/gu) || []).length;
  if (paras.length < 3 || paras.length > 9) fail.push(`${paras.length} paragraphs (3 to 9)`);
  if (words < WORDS_MIN || words > WORDS_MAX) fail.push(`${words} words (${WORDS_MIN} to ${WORDS_MAX})`);
  if (paras.length && !/^All in all,/.test(paras[paras.length - 1])) fail.push('the last paragraph does not start with "All in all,"');
  // the score and the round are in the first sentence (founder 2026-11-14)
  const s1 = (paras[0] || '').split(/(?<=[.!?])\s+/)[0] || '', sc = (sheet.sets || []).map((x) => norm(x));
  if (sc.length && !sc.every((x) => s1.includes(x))) fail.push(`the first sentence does not give the score (${(sheet.sets || []).join(', ')})`);
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
  for (const r of RISKY) if (new RegExp(`\\b${r}`, 'i').test(low) && !new RegExp(`\\b${r}`, 'i').test(ix.lower)) fail.push(`"${r}" — nothing on the sheet says it`);
  return { ok: fail.length === 0, failures: [...new Set(fail)] };
}

// ---- the writer -----------------------------------------------------------------------------------------------------
export const SYSTEM = `You write the match report of one ATP tennis match for Stennisfy, in the voice of its founder, who watches every match and writes for bettors in plain English. You receive a FACT SHEET and a list of QUOTES. Write the report from the fact sheet only.

The report is SHORT and it reads fluently. 150 to 180 words, quotes included. It is a small story told out loud, never a list of facts.

Shape (4 or 5 short paragraphs, one blank line between them, plain text: no title, no headings, no lists, no bold):
1. One opening sentence: who beat who, the score of every set, the round and what it means when the sheet says it (the title, a first final). No head to head, unless the sheet has a "Big rivalry" line: then add it naturally ("Alcaraz, who now leads the head-to-head 10–7").
2. The match. One sentence per set at most and only the most important thing of each set: who was the better player, who got the break, a tiebreak. No game by game: never "broke for 3–1", "saved a set point at 5–2", "needed 2 break points". Put one quote here, right after the moment it explains, introduced naturally ("He explained it himself:", "On that game at 5–4 he said:", "Fritz knows he let it slip:").
3. How the winner played: one flowing sentence that carries ONE number, linked to what came before ("That aggression also showed on serve, where even his second serve was a weapon: he won 77% of the points behind it, far above his average of 53% on hard." / "Once again his serve carried him, with 90% of the points won behind his first serve (!!!) and the forehand did the rest."). When the sheet has a SEEN IN THE MATCH section, use it here and in paragraph 2 for HOW he played (aggressive, stepping in, the forehand, the net), in a few words.
4. Only when the sheet has a PHYSICAL section: one flowing sentence as its own paragraph ("The one doubt before the final is his body: he called the physio early in the second set, his second medical timeout in two matches." / "Musetti, who needed the physio in the QF, did not call for a medical timeout this time but he never found a way into the match."). Never a word about the reason.
5. The last paragraph starts with "All in all," and says in one sentence what the win was built on. Then the winner's style of play, attached to HIM and to the conditions of this tournament ("That is what makes a big server and complete baseliner like him so effective in these conditions." / "the two shots that make an attacking baseliner like him so effective in these indoor conditions"), never as a general truth about a type of player. Then the next opponent in one short clause ("Next is Tirante in the final."). After a final: the title, and a second quote about the title may close the report.

How it reads:
- Simple words, the way you would say it out loud. If a sentence needs to be read twice, rewrite it. No idioms, no tennis-writer words ("lost the thread", "a tight decider", "sealed", "clinical", "dug deep").
- Plain words for who was better: "Fritz was the better player in the first set and took it 6–2", "was the better player at the end".
- No chains of short sentences. Join what belongs together and let one sentence lead into the next. Vary the rhythm: one longer sentence, then a shorter one.
- Every paragraph after the first opens with a link to the one before it ("That aggression also showed", "Once again", "The one doubt before the final is"), not with a name and a fact.
- A number never stands alone as its own sentence or paragraph: it sits inside a sentence that links it to the story. After the number, stop: do not explain what the number already says.
- Do not link two facts with "so" when one simply follows the other. Tell it as one natural sentence and vary how you say it from report to report ("The third set stayed on serve all the way to the tiebreak, where Fritz was the better player at the end and took it 7–3." / "Neither player got broken in the third set and Fritz was the better player in the tiebreak, taking it 7–3.").
- Do not write that he "won it with his serve" unless the serve really was the story of the match. Otherwise just highlight it ("was very solid behind his serve").
- The report is about the winner. The loser gets a clause or a line only when the sheet has important information about him (the PHYSICAL section, or one clear reason he lost).
- No recap of anybody's week. No "so dangerous". Do not use the same closing words in every report.

Numbers:
- ONE stat in the whole report: the one that matters most, with the player's own average only when the sheet gives it and the gap is big. A second-serve figure only when that gap is big. Never a figure for one set. Never winners or unforced errors: they are printed under your text.
- Percentages only, never the counts behind them.

Hard rules:
- Every fact comes from the fact sheet. Never use your own knowledge of the players, the tournament, rankings, injuries, past seasons or anything that happened after the match. If the sheet does not say it, it is not in the report.
- Copy every number and every score exactly as the sheet writes it, as digits (7–5, 90%, 5 games in a row). Scores with an en dash. Do not calculate new numbers.
- Players by SURNAME ONLY, never a first name or an initial.
- A quote is copied word for word from the QUOTES list, inside straight double quotation marks ("). You may use a whole quote, or whole sentences from the start of it. Never change, shorten inside, translate or tidy a quote. Nothing else goes inside quotation marks. The speaker's surname must appear earlier in the same paragraph. One quote; two only after a final. In the match paragraph prefer a short quote; after a final, close with the quote that says most about the title.
- Never say where anything comes from: no "the stats", "the data", "the card", "the commentators", "the highlights", "in his interview", "according to".
- Never write about a shot (forehand, backhand, volley, net), the body (injury, pain, knee, tired, fresh), nerves, the crowd, the court speed or the balls unless a line of the fact sheet says so. A quote does not count as a line of the fact sheet.
- About a medical timeout: only what the PHYSICAL section says. Never the reason, never "the reason is not known", never how he looked.
- No "I", "me", "my", "we" or "our" outside a quote. No questions. No exclamation marks, except "(!!!)" at most once, straight after one number that is truly exceptional.
- Past tense for what happened. Do not print a ranking, a dominance ratio or a performance rating.
- The WORDING section of the sheet offers a few phrases of the founder. Use one at most, only where it fits.
- When the sheet has no match in playing order: 80 to 120 words.

Three reports written by the founder, as the models for length, voice and flow (never reuse their facts or their exact sentences):

---
Fritz beat Tirante 6–2, 4–6, 7–6 in the final to win the title in Stockholm.

Fritz was the better player in the first set and took it 6–2. The second set went the other way: Tirante got the break and won it 6–4. Fritz knows he let it slip: "It was a stressful match, … I came out and was playing really well but then let some opportunities slip." The third set stayed on serve all the way to the tiebreak, where Fritz was the better player at the end and took it 7–3.

Fritz was very solid behind his serve, especially his second serve, where he won 73% of the points, far above his average of 53% on hard.

All in all, a deserved title for Fritz, built on a strong start and a serve that held when the final got tight. That is what makes a big server and complete baseliner like him so effective in these conditions. On the title he said: "I have lost a lot of indoor finals but at the same time I didn't look too much into it, because when I won Tokyo, it was pretty much indoors as the roof was closed a lot, … It feels good to get that one now."
---
Fritz beat Musetti 6–4, 6–2 in the SF to reach his first final in Stockholm.

Fritz was the more aggressive player from the very first games and never let Musetti settle. One break was enough to take the first set and after Musetti won the first game of the second, Fritz won 5 games in a row to finish the job. He explained it himself: "But the short answer is I just was a lot more aggressive and took on a lot more shots that are a bit uncomfortable for me. But I felt like against him, I have to if I wanted to win."

That aggression also showed on serve, where even his second serve was a weapon: he won 77% of the points behind it, far above his average of 53% on hard.

Musetti, who needed the physio for his knee in the QF, did not call for a medical timeout this time but he never found a way into the match.

All in all, a complete win from Fritz, who attacked from the first game to the last. That is what makes a big server and complete baseliner like him so effective in these conditions. Next is Tirante in the final.
---
Tirante beat Tabilo 7–5, 7–6 in the SF to reach his first tour-level final.

Both sets were close and decided on a few points. Tirante got the only break of the first set late to take it 7–5 and in the second he served for the match at 5–4 but could not finish it, as Tabilo broke back. He stayed calm and was clearly the better player in the tiebreak, taking it 7–1. On that game at 5–4 he said: "Well, always we have nervous all the matches … I think I keep believing in me, in my team"

Once again his serve carried him, with 90% of the points won behind his first serve (!!!) and the forehand did the rest.

The one doubt before the final is his body: he called the physio early in the second set, his second medical timeout in two matches.

All in all, a strong win from Tirante, built on his first serve and his forehand, the two shots that make an attacking baseliner like him so effective in these indoor conditions. Next is Fritz in the final.
---

Before you answer, read your report out loud in your head. If it sounds like a list being read, rewrite it. Reply with the report text only.`;

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
