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
export const COMPOSE_VERSION = 1;        // bump to have every report on file written again
export const MAX_COMPOSE_RUNS = 3;       // a report is written at most this many times (later quotes, the next opponent)
export const COMPOSE_FRESH_HOURS = 36;   // after this, new data no longer rewrites a report
export const MAX_QUOTES = 6, QUOTE_MAX_CHARS = 520, QUOTES_IN_TEXT = 3;
export const WORDS_MIN = 70, WORDS_MAX = 520;
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
// one earlier result of `key` in this tournament, as a clause: "beat Halys 6–4, 7–6 in R1" / "got a walkover from Rune in the QF"
function resultClause(c, key, rc) {
  const k = sideOf(c, key), o = other(k), where = rc(c) ? ` in ${rc(c)}` : '';
  if (c.walkover && c.finalScore && c.finalScore.winner === k) return `got a walkover from ${surnameOf(c[o])}${where}`;
  if (!c.finalScore || c.finalScore.winner !== k || c.walkover) return null;
  const sets = (c.finalScore.sets || []).map((s) => `${s[k]}–${s[o]}`).join(', ');
  return `beat ${surnameOf(c[o])}${sets ? ' ' + sets : ''}${c.retired ? ' (retirement)' : ''}${where}`;
}
// The way to and from this match inside the tournament. all = every card of the edition we hold; rc(card) = its round code.
export function pathLines(m, w, all, rc, isFinal) {
  const out = [], wKey = m[w + 'Key'], me = startKey(m);
  const before = (key, limit) => all.filter((c) => c !== m && c.id !== m.id && has(c, key) && startKey(c) < limit).sort((a, b) => startKey(a).localeCompare(startKey(b))).map((c) => resultClause(c, key, rc)).filter(Boolean);
  const own = before(wKey, me);
  if (own.length) out.push(`${surnameOf(m[w])} earlier in this tournament: ${own.join('; ')}.`);
  if (isFinal) { out.push(`This was the final: ${surnameOf(m[w])} wins the title.`); return out; }
  const next = all.filter((c) => c.id !== m.id && has(c, wKey) && startKey(c) > me).sort((a, b) => startKey(a).localeCompare(startKey(b)))[0];
  if (!next) return out;
  const oKey = next[other(sideOf(next, wKey)) + 'Key'], oName = surnameOf(next[other(sideOf(next, wKey))]);
  out.push(`Next for ${surnameOf(m[w])}: ${oName}${rc(next) ? ` in ${rc(next)}` : ''}.`);
  const their = before(oKey, startKey(next));
  if (their.length) out.push(`${oName} in this tournament: ${their.join('; ')}.`);
  return out;
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
export function factSheet({ m, w, l, rep, shard = null, round = null, duration = null, card = null, commentary = null, quotes = [], path = [], styles = null, hasMto = false }) {
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
    for (const k of [w, l]) { const s = statLine(ss[k], { wue: wueUsable(ss), full: false }); if (s) per.push(`${surnameOf(m[k])} in the ${SET_WORD[n]} set: ${s}.`); }
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
      if (fw != null && bw != null) {
        c.push(`${N}: ${pl(fw, 'forehand winner')}, ${pl(bw, 'backhand winner')}.`);
        const hi = Math.max(fw, bw), lo = Math.min(fw, bw);
        if (hi >= BEST_SHOT_MIN && hi >= BEST_SHOT_RATIO * lo) c.push(`The ${fw > bw ? 'forehand' : 'backhand'} was the best shot of ${N}.`);
      }
      if (fu != null && bu != null) {
        c.push(`${N}: ${pl(fu, 'forehand unforced error')}, ${pl(bu, 'backhand unforced error')}.`);
        const hi = Math.max(fu, bu), lo = Math.min(fu, bu);
        if (hi >= WEAK_SIDE_MIN && hi >= BEST_SHOT_RATIO * lo) c.push(`Most of the unforced errors of ${N} came from the ${fu > bu ? 'forehand' : 'backhand'}.`);
      }
    }
    add('SHOT NUMBERS', c);
  }
  if (commentary) add('SEEN IN THE MATCH (observations; never name where they come from)', [String(commentary).trim()]);
  add('THE TOURNAMENT', path);
  if (hasMto) add('NOTE', ['A separate paragraph about the medical timeout is added after your text. Do not write about any medical timeout or injury.']);
  const text = lines.join('\n');
  const hash = crypto.createHash('sha256').update(JSON.stringify([COMPOSE_VERSION, text, quotes.map((q) => q.text)])).digest('hex').slice(0, 16);
  return { lines, text, quotes, hash, winner: W, loser: L, isFinal: /final\b/.test(String(round || '')) && !/quarter|semi/.test(String(round || '')) };
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
    // the speaker is named in the words that lead into the quotation: the same paragraph, after the last full stop
    const lead = full.slice(0, sp.index).split('\n').pop().split(/[.!?]\s/).pop();
    if (!norm(lead).toLowerCase().includes(norm(q.speaker).toLowerCase())) fail.push(`the speaker (${q.speaker}) is not named before his quotation`);
    if (used.has(q.id)) fail.push('the same quotation twice'); used.add(q.id);
  }
  const body = full.replace(/"[^"]*"/g, ' QUOTE ');
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean), words = (body.match(/[\p{L}\d'%-]+/gu) || []).length;
  if (paras.length < 3 || paras.length > 9) fail.push(`${paras.length} paragraphs (3 to 9)`);
  if (words < WORDS_MIN || words > WORDS_MAX) fail.push(`${words} words (${WORDS_MIN} to ${WORDS_MAX})`);
  if (paras.length && !/^All in all,/.test(paras[paras.length - 1])) fail.push('the last paragraph does not start with "All in all,"');
  const first = (paras[0] || '').toLowerCase();
  if (!first.includes(norm(sheet.winner).toLowerCase()) || !first.includes(norm(sheet.loser).toLowerCase())) fail.push('the first paragraph does not name both players');
  if (/\b(I|me|my|we|us|our)\b/.test(body)) fail.push('first person outside a quotation');
  if (SOURCE_WORDS.test(body)) fail.push(`names a source ("${SOURCE_WORDS.exec(body)[0]}")`);
  if (/\?/.test(body) || /!/.test(body.replace('(!!!)', ''))) fail.push('a question mark or exclamation mark (only one "(!!!)" is allowed)');
  if (/(^|\s)[A-Z]\.\s/.test(body)) fail.push('an initial before a name');
  if (/[*#_]|^\s*[-•]/m.test(body)) fail.push('markdown or a list');
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
- 4 to 7 short paragraphs, separated by one blank line. Plain text: no title, no headings, no bullet points, no bold.
- Paragraph 1: one or two sentences. Who beat whom and what kind of match it was (for example: straight sets but the first set could have gone the other way; a comeback from a set down; one single break of serve in the whole match). Not the score.
- Then tell the match in playing order, one short paragraph per set or per phase: who broke first, the break points and set points that were saved, who served for a set and got broken, runs of games, the tiebreaks, and how the level of a player changed from set to set when the per-set numbers show it.
- One paragraph with the numbers that explain the result, 3 to 5 sentences and at most 7 numbers in it; pick the few that explain why he won and leave the rest out: serve quality, unreturned serves and return quality when the sheet has them, the serve and return percentages that stood out, who was better from the baseline, and the best shot of a player when the sheet names it ("The forehand was his best shot: 24 forehand winners."), or the side his errors came from. Percentages only, never the counts behind them ("won 94% of the points behind his first serve", not "(29 of 31)"). Compare a number with a player's own average only when the sheet gives that average, and only when the gap is big.
- One or two quotes when the list has good ones (prefer the ones about this match: a turning point, how he played, how his body felt), each in its own paragraph or at the end of the paragraph it belongs to, introduced like: Fritz on that first set: "..." or simply Tabilo: "..."
- Last paragraph: it starts with "All in all," and gives a short verdict in one or two sentences. Then the next opponent when the sheet names him ("Next is Rune, who ...") with what the sheet says about his week. After a final: the title.

Hard rules:
- Every fact comes from the fact sheet. Never use your own knowledge of the players, the tournament, rankings, injuries, past seasons or anything that happened after the match. If the sheet does not say it, it is not in the report.
- Copy every number and every score exactly as the sheet writes it, as digits (3 break points, 7–5, 94%, 8.8). Scores with an en dash. Do not calculate new numbers, do not add or subtract, do not round.
- Players by SURNAME ONLY, never a first name or an initial.
- A quote is copied word for word from the QUOTES list, inside straight double quotation marks ("). You may use a whole quote, or whole sentences from the start of it. Never change, shorten inside, translate or tidy a quote. At most 3 quotes. Nothing else goes inside quotation marks.
- Never say where anything comes from: no "the stats", "the data", "the card", "the commentators", "the highlights", "in his interview", "according to".
- Never write about a shot (forehand, backhand, volley, net), the body (injury, pain, tired, fresh), nerves, the crowd, the court speed or the balls unless a line of the fact sheet says so. A quote does not count as a line of the fact sheet.
- No "I", "me", "my", "we" or "our" outside a quote. No questions. No exclamation marks, except "(!!!)" at most once, straight after one number that is truly exceptional.
- Simple words everybody understands. No idioms, no sports-page phrases ("sealed the deal", "punched his ticket", "dug deep", "clinical"). Short sentences. Past tense for what happened.
- Write little about the loser: what he did well in one sentence when the numbers show it, and what went wrong.
- The playing style of a player may be used once, and only in the form "against a counterpuncher like Norrie" or "Gojo is a big server", only when the sheet gives it. Never call a player by his style in the verdict.
- Never print a ranking unless it explains the match (a very low-ranked player who took a set). Never print a dominance ratio or a performance rating: they are added under your text.
- 150 to 330 words when the sheet has the match in playing order; 80 to 160 words when it does not.

The founder's own phrases, use them where they fit: "The first set could easily have gone the other way." "From there the match turned completely." "It was the same story." "That was the moment of the match." "really struggled behind his second serve" "was clearly the better player" "did not see another break point" "got broken straight back" "served it out" "It was not his best return performance" "a very convincing second set after a slow start" "that made the difference in the end".

Two reports the founder wrote, for the voice only (never reuse their facts):

---
Fritz is into the quarter-finals in straight sets, but the first set could easily have gone the other way.

Norrie started better. He broke in the third game. Fritz was struggling to find his first serve (49% in the first set) and lost a few big points. Norrie led 5–3 and had two set points. Fritz saved both, and from there the match turned completely: he won five games in a row, breaking Norrie when he served for the set at 5–4 and again at 6–5.

Fritz on that first set: "I feel like there were a lot of times in the first set when I lost some big points, I had some chances."

The second set was a different Fritz. His first serve went up to 71% and he won 94% of the points behind it. He broke at 4–3 and served out the match in the next game, finishing with his 13th ace.

Fritz ended with an 8.8 serve quality and 40% unreturned serves. He also returned very well, with an 8.4 return quality, as he was able to create 7 break points against a counterpuncher like Norrie. Norrie did not get many free points on his serve, only 20% of his serves did not come back, and Fritz was clearly the better player from the baseline (36–22).

All in all, a very convincing second set after a slow start. Next is Rune, who came back from a set down against Kecmanovic.
---
Humbert won in straight sets against Gojo, without playing his best tennis.

The first set was over quickly. Humbert broke twice at the start and led 4–0. Gojo really struggled behind his second serve and made 4 double faults, so Humbert always had chances on return. He converted 4 of his 5 break points in the match.

The second set was closer. Gojo broke first and led 3–1, with his only break point of the match. Humbert broke straight back, and then again at 4–4 before serving it out. It was not a clean set from Humbert, with 15 unforced errors for 8 winners, and his first serve percentage was low the whole match (55%).

All in all, an easy scoreline, but Humbert will need to serve better in the next round. Next is Musetti, who had a bye and beat Samuel in straight sets in his only match so far.
---

Reply with the report text only.`;

export function userMessage(sheet, failures = null, previous = null) {
  const q = sheet.quotes.length ? sheet.quotes.map((x, i) => `Q${i + 1} — ${x.speaker}${x.topic ? ` (${x.topic})` : ''}: "${x.text}"`).join('\n') : '(none)';
  let t = `FACT SHEET\n${sheet.text}\n\nQUOTES (word for word; use at most ${QUOTES_IN_TEXT})\n${q}`;
  if (failures && failures.length) t += `\n\nYour previous text was rejected by the fact check:\n${failures.slice(0, 12).map((f) => `- ${f}`).join('\n')}\n\nPrevious text:\n${previous}\n\nWrite it again and fix every point. Leave out anything the fact sheet does not carry.`;
  return t;
}

async function callModel(sheet, failures, previous, apiKey, fetchFn) {
  const body = { model: REPORT_MODEL, max_tokens: 2500, output_config: { effort: 'medium' }, system: SYSTEM, messages: [{ role: 'user', content: userMessage(sheet, failures, previous) }] };
  let res;
  try { res = await fetchFn(API_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) }); }
  catch (e) { return { status: 'api-error', detail: String(e && e.message || e).slice(0, 200) }; }
  if (!res.ok) { const t = res.text ? await res.text().catch(() => '') : ''; return { status: 'api-error', detail: `HTTP ${res.status} ${String(t).slice(0, 240)}` }; }
  const data = await res.json();
  const usage = data.usage ? { input: data.usage.input_tokens || 0, output: data.usage.output_tokens || 0 } : null;
  if (data.stop_reason === 'refusal' || data.stop_reason === 'max_tokens') return { status: 'api-error', detail: `stop_reason ${data.stop_reason}`, usage };
  return { status: 'ok', text: String(((data.content || []).find((b) => b.type === 'text') || {}).text || '').trim(), usage, model: REPORT_MODEL };
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
    const text = String(r.text || '').replace(/\r/g, '').replace(/[“”]/g, '"').replace(/\n{3,}/g, '\n\n').trim();
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
