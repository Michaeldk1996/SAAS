// News ticker — the generic outlet reader (Michael's ruling of 11 Nov 2026: any outlet page served publicly to a plain
// request may be read). The limits it keeps:
//   a. no bypassing a technical block: 401 / 402 / 403 / 429, a challenge or CAPTCHA page, a login or a paywall keeps the
//      outlet (or that article) out. One honest user agent, plain fetch, no proxy, no headless browser;
//   b. only the quoted words, the speaker and the labelling context leave this module. The article text lives in
//      memory for the verbatim check and is never stored or published;
//   c. one request per outlet section per run (the job runs every 30 minutes); an article page is fetched once, ever
//      (the URL is remembered in the cache the caller passes in);
//   d. a registry entry with "enabled": false is never read.
// Pure helpers are exported for tools/test-news-ticker-live.mjs.
import { htmlToParagraphs } from './quote-sources.mjs';
import { foldText } from './news-core.mjs';

export const UA = 'stennisfy-news/1.0 (+https://michaeldk1996.github.io/SAAS/; quote collector; plain client)';
export const MAX_ARTICLES_PER_OUTLET = 6;

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// -> a reason string when the answer is a technical block, else null. Never "worked around".
export function technicalBlock(status, body) {
  if ([401, 402, 403, 407, 429, 451].includes(status)) return 'the site refuses a plain request';
  if (status >= 500) return 'server error';
  if (status !== 200) return `unexpected answer`;
  const head = String(body || '').slice(0, 6000);
  if (/just a moment\.\.\.|cf-chl|challenge-platform|captcha|are you a robot|verify you are human|px-captcha|datadome/i.test(head)) return 'a bot-check / CAPTCHA page';
  if (String(body || '').length < 600) return 'an empty page';
  return null;
}
// A paywalled or login-only article: what is served is not the article. Kept out.
export function paywalled(html) {
  return /"isAccessibleForFree"\s*:\s*(?:"?false"?)|class="[^"]*\bpaywall\b|id="paywall|data-paywall|subscribe to (?:read|continue)|log in to (?:read|continue)|inicia sesi[oó]n para (?:leer|continuar)|abonn[eé]s? uniquement|r[eé]serv[eé] aux abonn[eé]s|solo para suscriptores|nur f[uü]r abonnenten/i.test(String(html || ''));
}

// Article links of a section page or an RSS / Atom feed: [{ url, title, published }]
export function sectionLinks(body, baseUrl) {
  const out = new Map(), s = String(body || '');
  let base; try { base = new URL(baseUrl); } catch (e) { return []; }
  const add = (href, title, published) => {
    let u; try { u = new URL(String(href).replace(/&amp;/g, '&').trim(), base); } catch (e) { return; }
    if (!/^https?:$/.test(u.protocol) || u.hostname.split('.').slice(-2).join('.') !== base.hostname.split('.').slice(-2).join('.')) return;
    u.hash = ''; const key = u.href;
    if (/\.(jpg|jpeg|png|gif|webp|svg|css|js|pdf|xml|mp4)(\?|$)/i.test(u.pathname) || u.pathname.replace(/\/$/, '').split('/').pop().length < 12) return;   // an article slug, not a section
    if (!out.has(key)) out.set(key, { url: key, title: String(title || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim(), published: published || null });
  };
  if (/<rss[\s>]|<feed[\s>]|<rdf:RDF/i.test(s.slice(0, 2000))) {
    for (const it of s.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || []) {
      const link = (/<link[^>]*href="([^"]+)"/i.exec(it) || /<link[^>]*>\s*(?:<!\[CDATA\[)?\s*([^<\]]+)/i.exec(it) || [])[1];
      const title = (/<title[^>]*>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/title>/i.exec(it) || [])[1];
      const pub = (/<(?:pubDate|published|updated|dc:date)[^>]*>([^<]+)</i.exec(it) || [])[1];
      if (link) add(link, title, pub && !Number.isNaN(Date.parse(pub)) ? new Date(pub).toISOString() : null);
    }
  } else {
    const re = /<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi; let m;
    while ((m = re.exec(s))) add(m[1], m[2], null);
  }
  return [...out.values()];
}

// Words that attribute speech, per language (accents folded). A language without a list yields no quote.
export const SAID = {
  en: ['said', 'says', 'added', 'explained', 'admitted', 'told', 'reflected', 'commented', 'stated', 'continued'],
  es: ['dijo', 'declaro', 'afirmo', 'explico', 'comento', 'aseguro', 'senalo', 'reconocio', 'confeso', 'indico', 'manifesto', 'apunto', 'analizo', 'expreso', 'conto', 'sostuvo', 'anadio', 'admitio', 'valoro'],
  pt: ['disse', 'afirmou', 'declarou', 'explicou', 'comentou', 'contou', 'analisou', 'admitiu', 'destacou', 'avaliou', 'completou', 'acrescentou'],
  fr: ['a declare', 'a dit', 'a explique', 'a confie', 'a reagi', 'a commente', 'a analyse', 'a reconnu', 'a souligne', 'a ajoute', 'a lance', 'a raconte', 'a savoure', 'a estime', 'explique', 'confie', 'declare', 'raconte', 'estime', 'a-t-il'],
  it: ['ha detto', 'ha dichiarato', 'ha spiegato', 'ha commentato', 'ha ammesso', 'ha aggiunto', 'ha raccontato', 'ha affermato', 'le parole di', 'spiega', 'racconta', 'ha concluso', 'ha proseguito'],
  de: ['sagte', 'erklarte', 'meinte', 'betonte', 'kommentierte', 'gestand', 'erganzte', 'so', 'resumierte', 'berichtete'],
  nl: ['zei', 'zegt', 'vertelde', 'aldus', 'verklaarde', 'reageerde', 'vertelt'],
  sv: ['sager', 'sade', 'sa', 'berattar', 'konstaterar', 'forklarar'],
  da: ['siger', 'sagde', 'fortaeller', 'forklarer', 'lod det', 'lyder det fra'],
  no: ['sier', 'sa', 'forteller', 'uttaler', 'forklarer'],
  fi: ['sanoi', 'sanoo', 'kertoi', 'kertoo', 'totesi', 'toteaa'],
  sr: ['rekao je', 'rekao', 'izjavio je', 'izjavio', 'kazao je', 'kazao', 'istakao je', 'porucio je', 'dodao je', 'naglasio je'],
  hr: ['rekao je', 'rekao', 'izjavio je', 'izjavio', 'kazao je', 'kazao', 'istaknuo je', 'porucio je', 'dodao je'],
  bs: ['rekao je', 'rekao', 'izjavio je', 'izjavio', 'kazao je', 'kazao', 'istakao je', 'dodao je'],
  cs: ['rekl', 'uvedl', 'prohlasil', 'dodal', 'priznal', 'popsal', 'hodnotil'],
  sk: ['povedal', 'uviedol', 'vyhlasil', 'dodal', 'priznal', 'hodnotil'],
  pl: ['powiedzial', 'stwierdzil', 'dodal', 'przyznal', 'ocenil', 'skomentowal', 'mowil'],
  hu: ['mondta', 'nyilatkozta', 'fogalmazott', 'tette hozza'],
  ro: ['a spus', 'a declarat', 'a afirmat', 'a explicat', 'a adaugat', 'a marturisit'],
};
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// players: [{ key, surname, initial }] (surname folded, may be several words; initial = the first letter of the given
// name on our card). -> the ONE player a said-word attributes the paragraph's speech to, or null.
// The name must stand outside the quotation, directly at a said-word: "said Rune", "said Holger Rune", "Rune said",
// "Rune, who won here in 2022, said". A capitalised word right before the surname is a given name and must start with
// the player's initial: "siger Aneke Rune" (his mother) is not H. Rune. A possessive ("Rune's coach said") never matches.
const keepCase = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[‐-―-]/g, ' ');
export function speakerIn(outside, players, language) {
  const verbs = SAID[language]; if (!verbs) return null;
  const kc = keepCase(outside), lc = kc.toLowerCase();
  const v = `(?:${verbs.map(esc).join('|')})`, hits = new Set();
  const givenOk = (words, p) => words.every((w) => !/^[A-Z]/.test(w) || (p.initial && w[0].toLowerCase() === p.initial));
  for (const p of players) {
    const n = esc(p.surname);
    let m, ok = false;
    const after = new RegExp(`\\b${v}\\s+((?:[^\\s,.;:!?¶]+\\s+){0,2}?)${n}(?![\\w'’])`, 'g');          // said [Holger] Rune
    while (!ok && (m = after.exec(lc))) { const words = kc.slice(m.index, m.index + m[0].length).split(/\s+/).slice(1, -p.surname.split(' ').length).filter((w) => !new RegExp(`^${v}$`, 'i').test(w)); ok = givenOk(words.slice(-2), p); }
    const before = new RegExp(`(^|[\\s¶(])((?:[^\\s,.;:!?¶]+\\s+)?)${n}(?:\\s+${v}\\b|,[^,¶]{0,70},\\s+${v}\\b)`, 'g');   // [Holger] Rune said / Rune, who …, said
    while (!ok && (m = before.exec(lc))) {
      const at = m.index + m[1].length, pre = kc.slice(at, at + m[2].length).trim();
      // the surname opens the clause ("…," Rune said) or follows the player's own given name; "the coach of Rune said" is nobody
      const prevChar = kc.slice(0, at).trim().slice(-1);
      ok = pre ? (/^[A-Z]/.test(pre) && !!p.initial && pre[0].toLowerCase() === p.initial) : (!prevChar || /[¶.!?,;:–—"”»]/.test(prevChar));
    }
    if (ok) hits.add(p.key);
  }
  return hits.size === 1 ? [...hits][0] : null;
}

// Direct speech of one paragraph, in whatever marks the outlet uses: “…” "…" «…» „…“ 「…」, or a dash-led line.
// -> { spans: [original text], outside: the paragraph with its speech removed }
export function speechOf(par) {
  const p = String(par || '').replace(/[​-‍⁠]/g, '').trim(), spans = [];
  const dash = /^[–—-]\s+(.+)$/s.exec(p);
  if (dash && !/["“„«]/.test(p)) {
    const cut = /^(.*[.!?…,])\s*[–—-]?\s*([^.!?…]{3,160})\.?$/s.exec(dash[1]);   // "…quote, säger Rune."  /  "…quote. – dijo Rune"
    if (cut) return { spans: [cut[1].replace(/[,\s]+$/, '').trim()].filter((x) => x.length >= 25), outside: cut[2] };
    return { spans: [], outside: '' };
  }
  let outside = p;
  for (const re of [/“([^”]{25,})”/g, /„([^“”]{25,})[“”]/g, /«\s*([^»]{25,}?)\s*»/g, /「([^」]{12,})」/g, /"([^"]{25,})"/g]) {
    outside = outside.replace(re, (m, g) => { spans.push(g.trim()); return ' ¶ '; });
  }
  return { spans, outside };
}

// One article -> candidates. players: [{ key, surname }]. No candidate carries more than the quoted words.
export function candidatesFromOutletArticle({ url, html, outlet, language, players, published }) {
  const pars = htmlToParagraphs(html), sourceText = pars.join('\n');
  const meta = /"datePublished"\s*:\s*"([^"]+)"/.exec(html) || /property="article:published_time"\s+content="([^"]+)"/.exec(html) || /content="([^"]+)"\s+property="article:published_time"/.exec(html);
  const ts = meta && !Number.isNaN(Date.parse(meta[1])) ? new Date(meta[1]).toISOString() : (published || null);
  const out = []; let unnamed = 0, last = null;
  pars.forEach((par, i) => {
    const sp = speechOf(par);
    if (!sp.spans.length) { if (!/["“„«–—]/.test(par)) last = null; return; }
    let key = speakerIn(sp.outside, players, language);
    // a paragraph that is ONLY a quotation right after an attributed one continues the same speaker
    if (!key && last && !fold(sp.outside).replace(/[¶\s.,;:!?–—-]/g, '')) key = last;
    if (!key) { unnamed++; return; }
    last = key;
    out.push({ id: `${outlet}-${i}`, speakerKey: key, spans: sp.spans, text: sp.spans.join(' … '), sourceText, sourceName: outlet, sourceUrl: url,
      day: ts ? ts.slice(0, 10) : null, timestamp: ts, timestampKind: ts ? 'observed (the outlet\'s own publication time)' : null, language });
  });
  return { candidates: out, unnamed, published: ts };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, fetchFn) {
  try {
    const r = await fetchFn(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    return { status: r.status, body: r.status === 200 ? await r.text() : '', url: r.url || url };
  } catch (e) { return { status: 0, body: '', url }; }
}

// Read one outlet for one tournament. cache: { [articleUrl]: { at, ... } } — mutated; an article in it is never fetched again.
// -> { candidates, stats }
export async function readOutlet({ outlet, players, tournamentName, cache, nowIso, since, fetchFn = fetch, sectionMemo = new Map() }) {
  const stats = { outlet: outlet.outlet, country: outlet.country, language: outlet.language, section: 0, links: 0, relevant: 0, fetched: 0, alreadyFetched: 0, blocked: null, paywalled: 0, offTopic: 0, tooOld: 0, candidates: 0, unnamed: 0 };
  if (outlet.enabled === false || outlet.status !== 'allowed') { stats.blocked = 'not enabled'; return { candidates: [], stats }; }
  // one section request per outlet per run, however many tournaments are on
  if (!sectionMemo.has(outlet.sectionUrl)) sectionMemo.set(outlet.sectionUrl, await get(outlet.sectionUrl, fetchFn));
  const sec = sectionMemo.get(outlet.sectionUrl);
  stats.section = sec.status;
  const tb = technicalBlock(sec.status, sec.body);
  if (tb) { stats.blocked = tb; return { candidates: [], stats }; }
  const links = sectionLinks(sec.body, sec.url);
  stats.links = links.length;
  const tn = fold(tournamentName);
  const rel = links.filter((l) => { let dec = l.url; try { dec = decodeURIComponent(l.url); } catch (e) { /* keep the raw URL */ }
    const hay = fold(dec.replace(/[-_/]+/g, ' ') + ' ' + l.title); return hay.includes(tn) || players.some((p) => new RegExp(`\\b${esc(p.surname)}\\b`).test(hay)); });
  stats.relevant = rel.length;
  const candidates = [];
  for (const l of rel) {
    if (cache[l.url]) { stats.alreadyFetched++; continue; }
    if (stats.fetched >= MAX_ARTICLES_PER_OUTLET) break;
    await sleep(1000);
    const a = await get(l.url, fetchFn);
    stats.fetched++;
    cache[l.url] = { at: nowIso, http: a.status };
    if (technicalBlock(a.status, a.body)) { cache[l.url].note = 'blocked'; continue; }
    if (paywalled(a.body)) { stats.paywalled++; cache[l.url].note = 'paywall'; continue; }
    const text = fold(a.body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
    if (!text.includes(tn)) { stats.offTopic++; cache[l.url].note = 'does not mention the tournament'; continue; }
    const got = candidatesFromOutletArticle({ url: l.url, html: a.body, outlet: outlet.outlet, language: outlet.language, players, published: l.published });
    if (got.published && since && Date.parse(got.published) < since) { stats.tooOld++; cache[l.url].note = 'published before this edition'; continue; }
    stats.unnamed += got.unnamed; stats.candidates += got.candidates.length;
    cache[l.url].quotes = got.candidates.length;
    for (const c of got.candidates) { if (!c.timestamp) { c.timestamp = nowIso; c.timestampKind = 'collected (the outlet shows no publication time)'; c.day = nowIso.slice(0, 10); } candidates.push(c); }
  }
  return { candidates, stats };
}

export const initialOf = (cardName) => { const m = /^\s*([A-Za-z])/.exec(fold(cardName)); return m ? m[1] : ''; };
export const surnameOf = (cardName) => { const t = fold(foldText(cardName)).replace(/[.]/g, ' ').split(/\s+/).filter(Boolean); let i = 0; while (i < t.length - 1 && t[i].length <= 2) i++; return t.slice(i).join(' ').replace(/-/g, ' '); };
