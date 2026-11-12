// News ticker — match reports in Michael's voice (founder 2026-11-12).
//
// The template report (news-core reportText) stays the source of truth: a list of sentences, each built from stored
// match facts. A model rewrites the sentences ONE FOR ONE in the founder's voice; every rewritten sentence is then
// checked against the template sentence it replaces, and a sentence that fails the check is not published: the
// template sentence stands in its place. Nothing here can add a fact: the check is a whitelist, not a blacklist.
//
//   numbers   every number, score, ordinal and "X of Y" in the rewrite is in the template sentence, with the same word
//             after it (9 aces, 41 winners, 83 minutes); scores in the same order
//   names     only the players the template sentence names, in the same order; "He" only for the one player the
//             sentence is about, and only when the sentence before opened with him
//   words     every other word is in the template sentence or in VOCAB (neutral connecting words) — so no "looked",
//             "felt", "solid", "clutch", rating or opinion can pass
//
// Pipeline only: the key is ANTHROPIC_API_KEY from GitHub Actions secrets, never in the browser or a published file.
const API_URL = 'https://api.anthropic.com/v1/messages';
export const REPORT_MODEL = process.env.NEWS_REPORT_MODEL || 'claude-opus-5-5';
export const VOICE_VERSION = 2;   // bump to have every stored report rewritten again

// Neutral connecting words a rewrite may add. No judgement word, no quantity word (none / all / twice / double / half),
// no stat verb (saved, converted, faced, broke): those may appear only where the template sentence already has them.
export const VOCAB = new Set(('a an the and but then while with in on at of to for from by as it its he his him who that this their they both was were is had has did ' +
  'beat match set sets game games round final meeting meetings time minutes after before against along way also now still so ' +
  'hit made came went got took finished ended first second third fourth fifth opening ' +
  'aces ace winners winner unforced errors error double faults fault break point points tiebreak tiebreaks row down up serve serving').split(/\s+/));
// Opinion words (founder 2026-11-12: ratings and opinions are allowed) — only in a sentence the code gave a tone, and
// only the words of that tone, so a judgement always sits beside the number that shows it. "clutch" is for break points.
export const TONE_WORDS = { good: new Set(['strong', 'solid', 'clean', 'sharp', 'well', 'good', 'better', 'clearly', 'clutch']),
  bad: new Set(['shaky', 'poor', 'weak', 'error-prone', 'worse', 'bad', 'low', 'clearly', 'not', 'clutch', 'solid', 'clean', 'sharp', 'good']) };
const NEGATED = new Set(['clutch', 'solid', 'clean', 'sharp', 'good']);
const ROUND_CODE = [[/\bfirst round\b/, 'R1'], [/\bsecond round\b/, 'R2'], [/\bthird round\b/, 'R3'], [/\bfourth round\b/, 'R4'],
  [/\bquarter-?finals?\b/, 'QF'], [/\bsemi-?finals?\b/, 'SF']];

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s) => fold(s).replace(/[–—]/g, '-').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const SCORE = /\b\d{1,2}-\d{1,2}(?:\(\d+\))?(?![\w-])/g;
const tokens = (s) => norm(s).match(/[A-Za-z][A-Za-z'-]*|\d+(?:st|nd|rd|th)?/g) || [];

// "I. Surname" card name + (optional) full name -> the words that may name this player
export function playerRef(card, full) {
  const c = norm(card).replace(/\./g, ' ').split(' ').filter(Boolean);
  let i = 0; while (i < c.length - 1 && c[i].length <= 2) i++;
  const surname = c.slice(i).join(' ');
  const words = new Set([...surname.split(/[ -]/), ...norm(full || '').split(/[ -]/)].filter((w) => w.length > 1).map((w) => w.toLowerCase()));
  return { card, full: full || null, surname, words };
}
const mentions = (text, p) => new RegExp(`(^|[^A-Za-z])${p.surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'i').test(norm(text));

// number -> the word after it ("9|aces", "0|of", "83|minutes"), scores taken out first
function numberKeys(s) {
  const t = tokens(norm(s).replace(SCORE, ' '));
  const out = [];
  t.forEach((w, i) => { if (/^\d/.test(w)) out.push(`${w}|${(t[i + 1] || '').toLowerCase().replace(/s$/, '')}`); });
  return out;
}

// -> { ok, why }
export function checkSentence(src, out, ctx) {
  const o = norm(out), s = norm(src);
  if (!o) return { ok: false, why: 'empty' };
  if (/[!?]/.test(o)) return { ok: false, why: 'exclamation or question mark' };
  if (/(^|\s)[A-Z]\.(\s|$)/.test(o)) return { ok: false, why: 'an initial ("H. Rune")' };
  if ((o.match(/[.…](\s|$)/g) || []).length > 1) return { ok: false, why: 'more than one sentence' };
  if (tokens(o).length > 45) return { ok: false, why: 'too long' };
  // round code: allowed only as the code of the round words the template sentence has
  let body = o;
  const codes = body.match(/\b(?:R\d+|QF|SF)\b/g) || [];
  for (const c of codes) {
    const hit = ROUND_CODE.find(([re, code]) => code === c && re.test(s.toLowerCase()));
    if (!hit) return { ok: false, why: `round "${c}" is not this match's round` };
    body = body.replace(new RegExp(`\\b${c}\\b`), ' ');
  }
  // scores: the same ones, in the same order
  const so = o.match(SCORE) || [], ss = s.match(SCORE) || [];
  if (so.length && so.join(',') !== ss.join(',')) return { ok: false, why: 'score differs' };
  // numbers with the word after them
  const have = new Set(numberKeys(s));
  for (const k of numberKeys(body)) if (!have.has(k)) return { ok: false, why: `"${k.replace('|', ' ')}" is not in the facts` };
  // players
  const inSrc = ctx.players.filter((p) => mentions(s, p)), inOut = ctx.players.filter((p) => mentions(o, p));
  for (const p of inOut) if (!inSrc.includes(p)) return { ok: false, why: `${p.surname} is not in this fact` };
  const he = /\b(he|his|him)\b/i.test(o);
  // "He" only in a sentence about ONE player, and only when he is named in it or the sentence before opened with him
  if (he && !(inSrc.length === 1 && (inOut.length === 1 || ctx.prevSubject === inSrc[0]))) return { ok: false, why: '"he" is not clear' };
  for (const p of inSrc) if (!inOut.includes(p) && !(he && ctx.prevSubject === p)) return { ok: false, why: `${p.surname} is not named` };
  if (inSrc.length === 2) {
    const pos = (t, p) => t.toLowerCase().indexOf(p.surname.toLowerCase());
    if ((pos(s, inSrc[0]) < pos(s, inSrc[1])) !== (pos(o, inSrc[0]) < pos(o, inSrc[1]))) return { ok: false, why: 'the two players swapped places' };
  }
  // every other word: the template sentence's own, a player's name, or neutral vocabulary
  const srcWords = new Set(tokens(s).map((w) => w.toLowerCase()));
  const nameWords = new Set(inSrc.flatMap((p) => [...p.words]));
  for (const w of tokens(body)) {
    if (/^\d/.test(w)) continue;
    const lw = w.toLowerCase();
    if (srcWords.has(lw) || nameWords.has(lw) || VOCAB.has(lw)) continue;
    if (ctx.tone && TONE_WORDS[ctx.tone].has(lw) && (lw !== 'clutch' || ctx.kind === 'bp')) continue;
    return { ok: false, why: `"${w}" is not in the facts` };
  }
  if (ctx.tone === 'bad') {   // a good word in a bad sentence only as "not clutch" / "not solid"; "not" only before one
    const t = tokens(body).map((w) => w.toLowerCase());
    for (let i = 0; i < t.length; i++) {
      if (NEGATED.has(t[i]) && !srcWords.has(t[i]) && t[i - 1] !== 'not') return { ok: false, why: `"${t[i]}" in a sentence about a weak number` };
      if (t[i] === 'not' && !srcWords.has('not') && !NEGATED.has(t[i + 1])) return { ok: false, why: '"not" with nothing to negate' };
    }
  }
  return { ok: true, why: null };
}

const SYSTEM = () => `You rewrite the sentences of a short ATP match report in the voice of Stennisfy's founder. You receive a JSON array of sentences. Return ONLY a JSON array of the same length: element i is your rewrite of sentence i, using only the facts in sentence i.

Rules, all strict:
- One sentence in, one sentence out. Never move a fact to another sentence, never merge, never drop a sentence.
- Use only the facts in that sentence. Add nothing: no cause, mood, opinion, rating or judgement, no comparison between numbers, no "looked", "felt", "solid", "clutch", "only", "just".
- Keep every number as a digit with the same word after it (9 aces, 41 winners, 28 unforced errors, 83 minutes, 0 of 3 break points, the 4th time in 5 meetings). You may leave a number out of a stat sentence, but keep at least two.
- Sentence 1: the winner's full name, then the loser's full name, as given in "names". Scores with en dashes (6–2), unchanged and in the same order. The round as R1, R2, R3, R4, QF or SF when it is one of those; otherwise as written.
- After sentence 1: surname only, never an initial ("Rune", not "H. Rune"). Use "He" only when the sentence is about one player and the sentence before it started with that same player.
- Keep the two players in the same order as in the original sentence.
- Plain past tense, no exclamation marks, no hyphen in a score. A short sentence stays short: never pad it (no "in the match", "during the match", "in this match").
- Words: you may use only the words of the original sentence, the players' names, and these connecting words: ${[...VOCAB].join(' ')}. Any other word makes the sentence invalid.
- Judgement: "tones" gives each sentence good, bad or none. In a GOOD sentence you may add one of: strong, solid, clean, sharp, well, clearly, better (and "clutch" only when its kind is "bp"). In a BAD sentence one of: shaky, poor, weak, error-prone, low, worse, clearly (and "not clutch" only when its kind is "bp"). In a sentence with tone none: no judgement word at all. Keep "above" / "below" and both percentages exactly as given, with the same words after each number.
- These sentences are what stood out in the match, so word them like a person who watched the numbers, not like a list. Vary how sentences open.
- Preferred wording: "came from a set down", "got broken", "won 7 games in a row", "saved 2 of 3 break points", "hit 9 aces and 41 winners", "made 28 unforced errors", "went to a tiebreak".`;

// -> { status: 'ok'|'no-key'|'api-error'|'bad-output', sentences?: string[], usage?, detail? }
export async function rewriteSentences(sentences, names, apiKey = process.env.ANTHROPIC_API_KEY, fetchFn = fetch, tones = [], kinds = []) {
  if (!apiKey) return { status: 'no-key' };
  const body = { model: REPORT_MODEL, max_tokens: 4000, output_config: { effort: 'low' }, system: SYSTEM(),
    messages: [{ role: 'user', content: JSON.stringify(tones.some((t) => t && t !== 'none') ? { names, sentences, tones, kinds } : { names, sentences }) }] };
  let res;
  try { res = await fetchFn(API_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) }); }
  catch (e) { return { status: 'api-error', detail: String(e && e.message || e).slice(0, 200) }; }
  if (!res.ok) { const t = res.text ? await res.text().catch(() => '') : ''; return { status: 'api-error', http: res.status, detail: `HTTP ${res.status} ${String(t).slice(0, 240)}` }; }
  const data = await res.json();
  const usage = data.usage ? { input: data.usage.input_tokens || 0, output: data.usage.output_tokens || 0 } : null;
  if (data.stop_reason === 'refusal' || data.stop_reason === 'max_tokens') return { status: 'api-error', detail: `stop_reason ${data.stop_reason}`, usage };
  const text = ((data.content || []).find((b) => b.type === 'text') || {}).text || '';
  const a = text.indexOf('['), b = text.lastIndexOf(']');
  let arr = null;
  try { arr = JSON.parse(text.slice(a, b + 1)); } catch (e) { /* bad output */ }
  if (!Array.isArray(arr) || arr.length !== sentences.length || !arr.every((x) => typeof x === 'string')) return { status: 'bad-output', detail: 'not a JSON array of the same length', usage };
  return { status: 'ok', sentences: arr, usage, model: REPORT_MODEL };
}

// A template sentence that stands in for a failed rewrite keeps its wording; only the card name ("H. Rune") becomes
// the full name (first sentence) or the surname — the same player, no fact added.
const cap = (w) => w.replace(/(^|[ -])([a-z])/g, (m, a, b) => a + b.toUpperCase());
export function plainNames(src, players, first) {
  let t = src;
  for (const p of players) { if (!p.card || !t.includes(p.card)) continue; const sur = p.card.replace(/^(?:[A-Za-z]{1,3}\.\s*)+/, ''); t = t.split(p.card).join(first && p.full ? p.full : (sur || p.card)); }
  return t;
}

// The checked merge. -> { text, passed, total, failures: [{ i, why }] }
export function mergeChecked(template, rewritten, players, tones = [], kinds = []) {
  const out = [], failures = [];
  let prevSubject = null;
  template.forEach((src, i) => {
    const cand = String(rewritten[i] || '').trim();
    const r = checkSentence(src, cand, { players, prevSubject, tone: tones[i] || null, kind: kinds[i] || null });
    const final = r.ok ? cand : plainNames(src, players, i === 0);
    if (!r.ok) failures.push({ i, why: r.why });
    out.push(final);
    const firstNamed = players.map((p) => [norm(final).toLowerCase().indexOf(p.surname.toLowerCase()), p]).filter(([n]) => n >= 0).sort((x, y) => x[0] - y[0])[0];
    if (firstNamed) prevSubject = firstNamed[1];
  });
  return { text: out.join(' '), passed: template.length - failures.length, total: template.length, failures };
}

// One report. -> { status, text?, voice?: { version, model, passed, total, failures }, usage?, detail? }
export async function humaniseReport({ sentences, tones = [], kinds = [], winner, loser }, opts = {}) {
  const players = [playerRef(winner.card, winner.full), playerRef(loser.card, loser.full)];
  const names = { winner: winner.full || players[0].surname, loser: loser.full || players[1].surname };
  const r = await (opts.rewrite || rewriteSentences)(sentences, names, opts.apiKey, opts.fetchFn, sentences.map((x, i) => tones[i] || 'none'), sentences.map((x, i) => kinds[i] || 'none'));
  if (r.status !== 'ok') return { status: r.status, detail: r.detail || null, http: r.http || null, usage: r.usage || null };
  const m = mergeChecked(sentences, r.sentences, players, tones, kinds);
  return { status: 'ok', text: m.text, usage: r.usage || null,
    voice: { version: VOICE_VERSION, model: r.model || null, passed: m.passed, total: m.total, failures: m.failures } };
}
