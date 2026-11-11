// News ticker — quote translation (pipeline only: the key is ANTHROPIC_API_KEY from GitHub Actions secrets, never in
// the browser, never in a published file). The ORIGINAL-language text is what passed the verbatim check and is always
// stored beside the translation. A translation is published only when translationOk() passes; a failing one is dropped
// and counted, never repaired. No key -> nothing is translated (the item is counted "not translated: no key").
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.NEWS_TRANSLATE_MODEL || 'claude-opus-5-5';

// Sentences = runs ending in . ! ? … (a trailing fragment counts as one). Only used to compare counts.
export function sentenceCount(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return 0;
  return (t.match(/[^.!?…]+(?:[.!?…]+|$)/g) || []).filter((x) => /[\p{L}\p{N}]/u.test(x)).length;
}
const numbersOf = (s) => (String(s || '').match(/\d+(?:[.,]\d+)*/g) || []).map((x) => x.replace(',', '.'));
// Proper names = capitalised words that do not open a sentence, plus any capitalised word the original also has.
export function namesOf(s) {
  const out = new Set(), t = String(s || '');
  const re = /(^|[.!?…]\s+|["“(]\s*)?(\p{Lu}[\p{L}'’-]+)/gu;
  let m;
  while ((m = re.exec(t))) { if (m[1] === undefined && m.index > 0) out.add(m[2]); }
  return [...out];
}
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// -> { ok, reason }. Same sentence count; every number and every proper name in the translation exists in the original.
// `known` = extra words that may appear capitalised in English with no capital in the original (weekdays, months,
// nationalities are NOT added automatically: such a translation fails and is dropped).
export function translationOk(original, translated) {
  if (!String(translated || '').trim()) return { ok: false, reason: 'empty translation' };
  const a = sentenceCount(original), b = sentenceCount(translated);
  if (a !== b) return { ok: false, reason: `sentence count ${a} -> ${b}` };
  const on = numbersOf(original);
  for (const n of numbersOf(translated)) if (!on.includes(n)) return { ok: false, reason: `number "${n}" is not in the original` };
  const of = fold(original);
  for (const n of namesOf(translated)) {
    if (n === 'I' || /^I['’]/.test(n)) continue;                       // the English pronoun
    if (!of.includes(fold(n))) return { ok: false, reason: `name "${n}" is not in the original` };
  }
  return { ok: true, reason: null };
}

export async function translateQuote(text, language, apiKey = process.env.ANTHROPIC_API_KEY, fetchFn = fetch) {
  if (!apiKey) return { status: 'no-key', text: null };
  const body = { model: MODEL, max_tokens: 4000, output_config: { effort: 'low' },
    system: 'You translate one direct quotation by a tennis player into English. Translate sentence by sentence: the same number of sentences, in the same order. Keep every name and every number exactly as written. Add nothing, explain nothing, drop nothing. Output only the English translation, with no quotation marks around it.',
    messages: [{ role: 'user', content: `Source language: ${language}\n\n${text}` }] };
  const res = await fetchFn(API_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
  if (!res.ok) { const t = res.text ? await res.text().catch(() => '') : ''; return { status: 'api-error', http: res.status, text: null, detail: `HTTP ${res.status} ${String(t).slice(0, 240)}` }; }
  const data = await res.json();
  if (data.stop_reason === 'refusal' || data.stop_reason === 'max_tokens') return { status: 'api-error', text: null, detail: `stop_reason ${data.stop_reason}` };
  const block = (data.content || []).find((b) => b.type === 'text');
  const out = block ? String(block.text).trim().replace(/^["“]|["”]$/g, '') : '';
  const v = translationOk(text, out);
  const usage = data.usage ? { input: data.usage.input_tokens || 0, output: data.usage.output_tokens || 0 } : null;
  return v.ok ? { status: 'ok', text: out, model: MODEL, usage } : { status: 'failed-check', text: null, detail: v.reason, usage };
}
