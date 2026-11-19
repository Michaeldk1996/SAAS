// News ticker — the quote digest (founder 2026-11-18): what a player said about one match, as at most DIGEST_MAX_BLOCKS
// blocks, one subject each ("after his win over Medvedev", "on the physical scare vs Medvedev"), never the same answer
// twice. Two outlets carrying one answer in two translations become one block, the fullest version. Slips of a
// transcript or a translation are corrected; nothing is added. The on-court interview is always kept.
// Pipeline / quote job only (ANTHROPIC_API_KEY from Actions secrets). A digest that fails its check is not published:
// the card keeps the quotes as collected.
import crypto from 'node:crypto';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.NEWS_DIGEST_MODEL || process.env.NEWS_TRANSLATE_MODEL || 'claude-opus-5-5';
export const DIGEST_VERSION = 1;
export const DIGEST_MAX_BLOCKS = 6;
export const DIGEST_WORDS_FROM_SOURCE = 0.85;   // share of a block's words that must be in the quotes it names
export const DIGEST_MAX_OVERLAP = 0.6;          // two blocks sharing more of their words than this repeat each other
export const DIGEST_MAX_PER_RUN = 12;

// &#039; &#x27; &amp; &quot; … as the characters they stand for (outlets send them inside quotes)
const NAMED = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', ndash: '–', mdash: '—' };
export const decodeEntities = (s) => String(s == null ? '' : s)
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&([a-z]+);/gi, (m, n) => (NAMED[n.toLowerCase()] != null ? NAMED[n.toLowerCase()] : m));

const words = (s) => (decodeEntities(s).toLowerCase().replace(/[’']/g, "'").match(/[\p{L}][\p{L}']{2,}/gu) || []);

// One card = one player and one match (else one player and one day): the same grouping the News page uses.
export const digestGroupKey = (q) => `${q.playerId}|${q.eventKey ? 'm' + q.eventKey : 'd' + String(q.timestamp || '').slice(0, 10)}`;
export const digestId = (key) => 'digest-' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 14);
export const memberHash = (qs) => crypto.createHash('sha1').update(qs.map((q) => q.id + ':' + q.text).sort().join('\n')).digest('hex').slice(0, 16);

// -> { ok, reasons }. The digest is published only when every rule holds.
export function checkDigest(blocks, members) {
  const reasons = [], byId = new Map(members.map((q) => [q.id, q]));
  if (!Array.isArray(blocks) || !blocks.length) return { ok: false, reasons: ['no blocks'] };
  if (blocks.length > DIGEST_MAX_BLOCKS) reasons.push(`${blocks.length} blocks, at most ${DIGEST_MAX_BLOCKS}`);
  const wsets = [];
  blocks.forEach((b, i) => {
    const n = i + 1;
    if (!b || !String(b.text || '').trim()) { reasons.push(`block ${n}: no text`); wsets.push(new Set()); return; }
    if (!/^(on|after|before|about)\b/i.test(String(b.label || '')) || String(b.label).length > 80) reasons.push(`block ${n}: the label must start "on" / "after" / "before" and be short`);
    if (/["“”]/.test(String(b.text))) reasons.push(`block ${n}: quotation marks inside the text`);
    const from = (b.from || []).filter((id) => byId.has(id));
    if (!from.length) { reasons.push(`block ${n}: names no quote it comes from`); wsets.push(new Set()); return; }
    const src = new Set(from.flatMap((id) => words(byId.get(id).text)));
    const w = words(b.text), inSrc = w.filter((x) => src.has(x)).length;
    if (!w.length || inSrc / w.length < DIGEST_WORDS_FROM_SOURCE) reasons.push(`block ${n}: ${w.length - inSrc} of ${w.length} words are not in the quotes it names (${w.filter((x) => !src.has(x)).slice(0, 8).join(', ')})`);
    wsets.push(new Set(w));
  });
  for (let i = 0; i < wsets.length; i++) for (let j = i + 1; j < wsets.length; j++) {
    const a = wsets[i], b = wsets[j], small = Math.min(a.size, b.size); if (!small) continue;
    let k = 0; a.forEach((x) => { if (b.has(x)) k++; });
    if (k / small > DIGEST_MAX_OVERLAP) reasons.push(`blocks ${i + 1} and ${j + 1} repeat each other`);
  }
  const used = new Set(blocks.flatMap((b) => b.from || []));
  for (const q of members) if (q.interview && !used.has(q.id)) reasons.push(`the on-court answer ${q.id} is not kept`);
  return { ok: !reasons.length, reasons };
}

const SYSTEM = `You edit what one tennis player said about one match into a clean quotes section for a tennis news feed, like a
good tennis site keeps it: at most ${DIGEST_MAX_BLOCKS} blocks, one subject each, never the same thing twice.

You get every quotation we hold from him, each with an id, its source kind (on-court interview or press) and a short
label. Several are often the SAME answer carried by two outlets, sometimes in two different translations, or one outlet
carrying only half of it.

Rules:
- One block per subject (the match itself, his body / an injury, the opponent, his serve or return, the season, what is next ...). Put everything he said on one subject into its block.
- Two versions of the same answer: keep the fullest and best one; never print both. Parts of one answer that only one version carries may be joined, in the order he said them.
- Every on-court interview answer is kept (it may share a block with a press version of the same subject).
- His own words only, in the first person, in English. You may correct obvious slips of a transcript or a translation (grammar, punctuation, a word misheard or mistranslated, HTML codes such as &#039;) and drop filler ("you know", repeated words). Never add a fact, a word of meaning or an opinion he did not say. Never merge two different subjects into one block.
- Label: lower case, starts with "after" for his general words about the result ("after his win over Medvedev", "after his loss to Alcaraz") or "on" for a subject ("on the physical scare vs Medvedev", "on what it takes to beat Alcaraz"). At most 10 words. The match block comes first, then the rest by importance.
- No quotation marks inside the text.

Reply with ONLY JSON: {"blocks":[{"label":"...","text":"...","from":["<id>", ...]}]} where "from" lists the ids of the quotes the block uses.`;

// A label keeps the capitals of the names it carries ("on beating Alcaraz", "at the ATP Finals"): a word written with a
// capital inside the quotes or the player's name takes it back (the model lowercases them).
export function nameCase(label, members, player = '') {
  const caps = new Map(), lower = new Set();
  for (const t of [player, ...members.map((q) => decodeEntities(q.text) + ' ' + (q.topic || ''))]) {
    for (const w of String(t).match(/[\p{L}][\p{L}'’-]*/gu) || []) {
      if (w === w.toLowerCase()) lower.add(w); else if (!caps.has(w.toLowerCase())) caps.set(w.toLowerCase(), w);
    }
  }
  // a word also written in lower case somewhere ("The" opening a sentence, "the" elsewhere) is not a name
  return String(label).replace(/[\p{L}][\p{L}'’-]*/gu, (w, i) => (i > 0 && w === w.toLowerCase() && caps.has(w) && !lower.has(w) && caps.get(w) !== 'I' ? caps.get(w) : w));
}
export async function digestQuotes({ player, context, members, apiKey = process.env.ANTHROPIC_API_KEY, fetchFn = fetch }) {
  if (!apiKey) return { status: 'no-key' };
  const input = members.map((q) => ({ id: q.id, kind: q.interview ? 'on-court interview' : 'press', label: q.topic || '', text: decodeEntities(q.text) }));
  let usage = { input: 0, output: 0, calls: 0 }, retry = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const body = { model: MODEL, max_tokens: 4000, output_config: { effort: 'low' }, system: SYSTEM,
      messages: [{ role: 'user', content: `Player: ${player}\nMatch: ${context || 'no match (an interview)'}\n\nQuotes:\n${JSON.stringify(input, null, 1)}${retry}` }] };
    let res;
    try { res = await fetchFn(API_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) }); }
    catch (e) { return { status: 'api-error', detail: String(e && e.message), usage }; }
    if (!res.ok) return { status: 'api-error', http: res.status, usage };
    const data = await res.json();
    usage.calls++; if (data.usage) { usage.input += data.usage.input_tokens || 0; usage.output += data.usage.output_tokens || 0; }
    const t = ((data.content || []).find((b) => b.type === 'text') || {}).text || '';
    let blocks = null;
    try { blocks = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)).blocks; } catch (e) { blocks = null; }
    if (Array.isArray(blocks)) blocks = blocks.map((b) => ({ label: nameCase(String(b.label || '').trim().replace(/[:.]+$/, ''), members, player), text: decodeEntities(String(b.text || '').trim()), from: (b.from || []).map(String) }));
    const v = checkDigest(blocks, members);
    if (v.ok) return { status: 'ok', blocks, model: MODEL, usage };
    retry = `\n\nYour previous answer was refused: ${v.reasons.join('; ')}. Answer again, following every rule.`;
    if (attempt === 1) return { status: 'failed-check', reasons: v.reasons, usage };
  }
}

// One tournament file's items -> the digest items for its cards. A held digest is kept while its quotes are unchanged;
// a card whose quotes changed is digested again (at most `limit` calls per run). -> { digests, usage, counts }
export async function buildDigests(items, { held = [], limit = DIGEST_MAX_PER_RUN, digest = digestQuotes, nowIso } = {}) {
  const groups = new Map();
  // injury quotes join the card too (founder 2026-11-19: the physical problem was told several times across two cards)
  for (const q of items) if (q && q.type === 'quote' && q.id && q.text && q.playerId != null) {
    const k = digestGroupKey(q); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(q);
  }
  const heldById = new Map(held.filter((d) => d.type === 'digest').map((d) => [d.id, d]));
  const out = [], usage = { input: 0, output: 0, calls: 0 }, counts = { cards: 0, kept: 0, made: 0, failed: 0, waiting: 0, single: 0 };
  for (const [k, qs] of groups) {
    counts.cards++;
    if (qs.length < 2) { counts.single++; continue; }   // one quote needs no digest
    const id = digestId(k), h = memberHash(qs), old = heldById.get(id);
    if (old && old.memberHash === h && old.version === DIGEST_VERSION) { out.push(old); counts.kept++; continue; }
    if (old && old.failedHash === h) { counts.failed++; continue; }   // the same quotes are not sent twice
    if (usage.calls >= limit * 2) { counts.waiting++; if (old && old.blocks) out.push(old); continue; }
    const first = qs.find((q) => q.interview) || qs[0], ctx = (qs.find((q) => q.context) || {}).context || null;
    const r = await digest({ player: first.player, context: ctx, members: qs });
    if (r.usage) { usage.input += r.usage.input; usage.output += r.usage.output; usage.calls += r.usage.calls; }
    if (r.status === 'no-key' || r.status === 'api-error') { counts.waiting++; if (old && old.blocks) out.push(old); continue; }
    const base = { id, type: 'digest', version: DIGEST_VERSION, playerId: first.playerId, player: first.player, opponentId: first.opponentId || null, opponent: first.opponent || null,
      tournament: first.tournament, tournamentKey: first.tournamentKey, season: first.season, eventKey: first.eventKey || null, context: ctx, category: 'Quotes',
      timestamp: qs.map((q) => q.timestamp).filter(Boolean).sort().pop() || null, members: qs.map((q) => q.id).sort(), memberHash: h, digestedAt: nowIso };
    if (r.status === 'ok') { out.push({ ...base, blocks: r.blocks, model: r.model }); counts.made++; }
    else { out.push({ ...base, blocks: null, failedHash: h, failure: (r.reasons || []).slice(0, 6) }); counts.failed++; }
  }
  return { digests: out, usage, counts };
}
