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
export const COMPOSE_VERSION = 3;        // bump to have every report on file written again
export const MAX_COMPOSE_RUNS = 3;       // a report is written at most this many times (later quotes, the next opponent)
export const COMPOSE_FRESH_HOURS = 36;   // after this, new data no longer rewrites a report
export const MAX_QUOTES = 6, QUOTE_MAX_CHARS = 520, QUOTES_IN_TEXT = 3;
export const WORDS_MIN = 70, WORDS_MAX = 330;   // the founder's own reports run to about 270 words (2026-11-14: "without making it longer")
export const STAT_NUMBERS_MAX = 4;       // percentages and quality figures in one report (founder 2026-11-14: "one number per idea")
export const SHORT_WORDS = 7, SHORT_RUN = 3;   // three sentences of 7 words or fewer in a row read like a machine
export const PHRASES = ['The first set could easily have gone the other way.', 'From there the match turned completely.', 'It was the same story in the second set.', 'That was the moment of the match.',
  'He really struggled behind his second serve.', 'He was clearly the better player from the baseline.', 'He did not see another break point.', 'He got broken straight back.', 'He served it out.',
  'It was not his best return performance.', 'That made the difference in the end.', 'Once again he won it with his serve.', 'He stayed calm.', 'Credit to him.'];
// a wing is "his best shot" from 10 winners and 1.5 times the other wing; "most of his errors" from 12 and 1.5 times
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
  const week = (key, limit) => earlierOf(m, key, all, limit).map((c) => weekEntry(c, key, rc)).filter(Boolean);
  const own = week(wKey, me);
  if (own.length) {
    out.push(`${W} earlier this week, in order: ${own.map((x) => x.text).join('; ')}.`);
    const l = w === 'p1' ? 'p2' : 'p1', sets = m.finalScore.sets || [], tbNow = sets.filter((x) => (x.p1 === 7 && x.p2 === 6) || (x.p1 === 6 && x.p2 === 7)).length;
    const dropped = own.reduce((t, x) => t + x.dropped, 0) + sets.filter((x) => x[l] > x[w]).length, tbs = own.reduce((t, x) => t + x.tiebreaks, 0) + tbNow;
    out.push(dropped === 0 ? `${W} has not dropped a set this week.` : `${W} has dropped ${pl(dropped, 'set')} this week.`);
    if (tbs >= 2) out.push(`${W} has played ${tbs} tiebreaks this week, this match included.`);
  }
  if (isFinal) { out.push(`This was the final: ${W} wins the title.`); return out; }
  const next = all.filter((c) => c.id !== m.id && has(c, wKey) && startKey(c) > me).sort((a, b) => startKey(a).localeCompare(startKey(b)))[0];
  if (!next) return out;
  const oKey = next[other(sideOf(next, wKey)) + 'Key'], O = surnameOf(next[other(sideOf(next, wKey))]);
  out.push(`Next for ${W}: ${O}${rc(next) ? ` in ${rc(next)}` : ''}.`);
  const their = week(oKey, startKey(next));
  if (their.length) {
    out.push(`${O} this week, in order: ${their.map((x) => x.text).join('; ')}.`);
    const d = their.reduce((t, x) => t + x.dropped, 0);
    out.push(d === 0 ? `${O} has not dropped a set this week.` : `${O} has dropped ${pl(d, 'set')} this week.`);
    // a walkover says something about freshness only when it was his last round (founder 2026-11-14)
    if (their.some((x) => x.walkover)) out.push(their[their.length - 1].walkover ? `The last round of ${O} was the walkover: he did not play that day.` : `The walkover of ${O} was not his last round: he played after it, so it does not make him fresher.`);
  }
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
export const PHYSICAL_OPENERS = [(N) => `One thing to follow is the body of ${N}.`, (N) => `There is one physical point to follow for ${N}.`, (N) => `The fitness of ${N} is the thing to watch.`, (N) => `Physically, ${N} is something to follow.`];
export const PHYSICAL_CONFIRMED = (N) => `${N} did not look 100%.`;
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
  if (!by.size) return { sentences: [], facts: [] };
  const pick = (arr, salt) => arr[parseInt(crypto.createHash('sha256').update(`${m.id}|${salt}`).digest('hex').slice(0, 6), 16) % arr.length];
  const sentences = [], facts = [];
  for (const [k, at] of by) {
    const N = surnameOf(m[k]);
    // the run of matches in a row, ending with this one, in which he took a medical timeout
    let matches = 1, total = at.length;
    for (const e of (earlier[k] || []).slice().reverse()) { const n = mine(k, e.rows).length; if (!n) break; matches++; total += n; }
    const pattern = matches >= 2 && ORD_WORD[total] && NUM_WORD[matches] ? `his ${ORD_WORD[total]} medical timeout in ${NUM_WORD[matches]} matches` : null;
    const what = at.length === 1 ? `${N} called the physio ${at[0]}` : `${N} called the physio ${at.length === 2 ? 'twice' : 'three times'}: ${at.slice(0, -1).join(', ')} and ${at[at.length - 1]}`;
    const q = (quotes || []).find((x) => x && x.interview === 'on-court' && String(x.playerId) === String(m[k + 'Key']) && /\b(physical|body|injur|fitness|health|pain|hand|wrist|arm|shoulder|back|leg|knee|ankle|foot|hip|blister|cramp)/i.test(String(x.topic || '')) && String(x.text || '').length <= 260);
    const confirmed = !!q || (seen && BODY_SEEN.test(String(seen)) && new RegExp(`\\b${N.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(String(seen)));
    sentences.push(confirmed ? PHYSICAL_CONFIRMED(N) : pick(PHYSICAL_OPENERS, k)(N));
    sentences.push(`${what.replace(N, 'He')}${pattern ? `, ${pattern}` : ''}.`);   // the opener has just named him
    sentences.push(q ? `${N} after the match: "${String(q.text).trim()}"` : 'We do not know the reason yet.');
    if (winner && k !== winner) sentences.push(`Something to follow for the next tournaments of ${N}.`);
    facts.push(`${what}${pattern ? `, ${pattern}` : ''}. The reason is not known${confirmed ? '' : ' and nothing confirms a physical problem: say only that it is something to follow, never that he is hurt or not fit'}.${winner && k === winner && !final ? (matches >= 2 ? ` In "All in all", mention that it is already his ${ORD_WORD[total] || 'next'} medical timeout this week.` : ' In "All in all", mention the medical timeout in a few words as something to follow.') : ''}`);
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
  if (h && h.n >= 1) res.push(h.n === 1 ? 'It was their first meeting.' : `Head to head after this match: ${W} ${h.a}, ${L} ${h.n - h.a} (${h.n} meetings).`);
  if (num(duration) != null) res.push(`Match time: ${duration} minutes (${Math.floor(duration / 60)}h${String(duration % 60).padStart(2, '0')}).`);
  if (m.surface) res.push(`Surface: ${m.surface}${m.venue && m.venue.indoor ? ', indoors' : ''}.`);
  for (const k of [w, l]) { const r = num(m[k + 'Rank']); if (r != null) res.push(`${surnameOf(m[k])} is ranked ${r}.`); }
  if (styles) for (const k of [w, l]) if (styles[k]) res.push(`Playing style of ${surnameOf(m[k])}: ${styles[k]}.`);
  add('RESULT', res);
  add('THE MATCH IN PLAYING ORDER (from the point log)', shard ? setStory(shard, m, 3) : []);
  add('WHAT STOOD OUT (each figure already compared with the player\'s own average where one is given)', rep ? rep.sentences.slice(1).map((s) => [m[w], m[l]].reduce((t, c) => t.split(c).join(surnameOf(c)), s)) : []);
  const wueOk = wueUsable(ms);
  add('BOX SCORE, WHOLE MATCH', [w, l].map((k) => { const s = statLine(ms[k], { wue: wueOk }); return s ? `${surnameOf(m[k])}: ${s}.` : null; }));
  const per = [];
  for (const n of Object.keys(m.setStats || {}).sort()) {
    const ss = m.setStats[n]; if (!ss || !SET_WORD[n]) continue;
    for (const k of [w, l]) { const s = statLine(ss[k], { wue: false, full: false }); if (s) per.push(`${surnameOf(m[k])} in the ${SET_WORD[n]} set: ${s}.`); }
  }
  add('BOX SCORE, PER SET', per);
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
  if (physical.length) add('PHYSICAL (a paragraph with these facts is added just before your last paragraph: do not write that paragraph, but name the doubt again in one sentence of "All in all")', physical);
  const cs = m.courtSpeed && m.courtSpeed.category ? String(m.courtSpeed.category).toLowerCase() : null;
  // the same court line in every report of a tournament would be the repeated sentence the founder does not want:
  // one report in three is offered it (by match id)
  if (cs && m.venue && m.venue.city && parseInt(crypto.createHash('sha256').update(`${m.id}|conditions`).digest('hex').slice(0, 6), 16) % 3 === 0) add('CONDITIONS', [`The court in ${m.venue.city} plays ${cs === 'medium' ? 'at a medium pace' : cs}${m.venue.indoor ? ', indoors' : ''} (our court-speed reading${m.courtSpeed.abstractSpeedYear ? ` from ${m.courtSpeed.abstractSpeedYear}` : ''}; do not print the year).`]);
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
  for (const mm of body.matchAll(/(^|[.!?:]\s+|\n\s*)?(\p{Lu}[\p{L}'-]+)/gu)) {
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

What the report looks like:
- 4 to 6 paragraphs, separated by one blank line. Plain text: no title, no headings, no bullet points, no bold.
- First sentence: the winner, the loser, the score of every set and the round, and the head to head when the sheet has it ("Tirante beat Tabilo 7–5, 7–6 in the SF to reach the final."). Then one sentence on what kind of match it was.
- Then tell the match as a story, in playing order: the moment of the match, who broke first, the break points or set points that were saved, who served for a set and got broken, the tiebreaks. Join what belongs together in one sentence ("he broke for 5–4, got broken straight back when serving for the match but stayed calm and took the tiebreak 7–1"). Never a chain of very short sentences.
- One paragraph on why he won: the shot or the part of the game that decided it (serve, return, forehand, backhand, baseline), with ONE number that proves it. One short paragraph on the loser when the sheet shows what went wrong for him, again with one number.
- Quotes: put a quote right after the moment or the idea it explains, inside that paragraph, never as a line on its own. Introduce it naturally ("On that game at 5–4, he said: ...", "He knows it himself: ..."). Use one or two.
- Last paragraph: it starts with "All in all," and says what went well, what makes the winner dangerous (his style of play when the sheet gives it and it fits how he won), and the conditions when the sheet has a CONDITIONS line. When the sheet has a PHYSICAL section about the winner, name that doubt again in one sentence. Then the next opponent: describe his week from the sheet in the right order of rounds, without any score ("Next is Fritz, who has not dropped a set this week and beat Norrie and Musetti in straight sets on the way."). After a final: the title.

Numbers:
- One number per idea. Never two numbers for the same thing: first-serve points won, serve quality, unreturned serves and aces all say "he served well", so pick the strongest one and leave the others out.
- At most 3 percentages or quality figures in the whole report. If a number does not change how the match is read, say it in words or leave it out.
- Winners and unforced errors of the match are printed under your text. Do not repeat them, and never give winners or errors per set. Use them only when they are the story of the match (for example the errors on one wing).
- Read the numbers together before you write. Do not praise and criticise the same thing ("returned well" next to "won only 10% of the points on return"). Choose the reading that matches what happened in the match.
- Percentages only, never the counts behind them. Compare with a player's own average only when the sheet gives that average and the gap is big.
- Look at the lines about earlier rounds: when the same thing happened before in this tournament (another tiebreak, another three-setter, another medical timeout), say it as a pattern.

Hard rules:
- Every fact comes from the fact sheet. Never use your own knowledge of the players, the tournament, rankings, injuries, past seasons or anything that happened after the match. If the sheet does not say it, it is not in the report.
- Copy every number and every score exactly as the sheet writes it, as digits (3 break points, 7–5, 90%). Scores with an en dash. Do not calculate new numbers.
- Players by SURNAME ONLY, never a first name or an initial.
- A quote is copied word for word from the QUOTES list, inside straight double quotation marks ("). You may use a whole quote, or whole sentences from the start of it. Never change, shorten inside, translate or tidy a quote. Nothing else goes inside quotation marks. The speaker's surname must appear earlier in the same paragraph.
- Never say where anything comes from: no "the stats", "the data", "the card", "the commentators", "the highlights", "in his interview", "according to".
- Never write about a shot (forehand, backhand, volley, net), the body (injury, pain, tired, fresh), nerves, the crowd, the court speed or the balls unless a line of the fact sheet says so. A quote does not count as a line of the fact sheet. Never say a walkover made a player fresh unless the sheet says it was his last round.
- Do not write the paragraph about a medical timeout: it is added for you. Only the one sentence in "All in all".
- No "I", "me", "my", "we" or "our" outside a quote. No questions. No exclamation marks, except "(!!!)" at most once, straight after one number that is truly exceptional.
- Never put a comma before "but" or before "and".
- Simple words everybody understands. No idioms, no sports-page phrases ("sealed the deal", "punched his ticket", "dug deep", "clinical"). Past tense for what happened.
- Do not print a ranking, a dominance ratio or a performance rating.
- The WORDING section of the sheet offers a few phrases of the founder. Use two of them at most, only where they fit. Do not use any other stock phrase twice.
- Length: 200 to 280 words when the sheet has the match in playing order, never more than 300; 80 to 150 words when it does not. When the sheet has a SEEN IN THE MATCH section, build the story on it and on the playing order together and cut numbers to make room: the report must not get longer.
- Use what was SEEN IN THE MATCH for how each player played (shots, tactics, net play, how he looked) and keep the claims it makes about a player's season or career to one short clause at most.

The founder's own report of one match, as the model for voice, shape and how few numbers it uses (never reuse its facts; the paragraph about the body was added separately there too):

---
Tirante beat Tabilo 7–5, 7–6 in the SF to reach the final. Two very close sets decided on a few points and he even got broken when he served for the match.

The moment of the match came at the end of the first set. Tirante got the only break for 6–5 and then had to save 3 break points when he served for the set. He saved all 3 and held. The second set was the same story for a long time: he broke for 5–4, got broken straight back when serving for the match but stayed calm and took the tiebreak 7–1. On that game at 5–4, he said: "Well, always we have nervous all the matches … I think I keep believing in me, in my team"

Once again he won it with his serve. Tirante won 90% of the points behind his first serve (!!!) and Tabilo could do almost nothing against it. When the rally started, the forehand did the rest, especially in the second set, where he was clearly the better player from the baseline. He knows it himself: "With the forehand and with the serve there is a very danger for them."

Tabilo stayed close in both sets but his forehand was not reliable enough, with 15 unforced errors on that side. That made the difference in the end.

All in all, a clutch win from Tirante, built on his serve and his forehand, the two shots that make him so dangerous. The only doubt before the final is physical, after two medical timeouts in two matches. Next is Fritz, who has not dropped a set this week and beat Norrie and Musetti in straight sets on the way.
---

Reply with the report text only.`;

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
    if (c.ok) return { status: 'ok', text, tries: t, usage, model };
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
