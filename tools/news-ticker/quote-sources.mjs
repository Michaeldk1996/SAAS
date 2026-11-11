// News ticker sample — quote collection. Two sources, each plain HTML with robots.txt read and honoured, one request per
// page, an honest user agent:
//   1. the official tournament site's news (it carries every ATP daily report under the same slug as atptour.com; the
//      full list comes from the site's own "load more" JSON, not only the first page);
//   2. SVT Sport's tennis section (Swedish; its robots.txt allows real-time retrieval) — quotes are dash-led lines
//      ("– …, säger Etcheverry."), kept in Swedish for the verbatim check and translated later (translate.mjs).
// Nothing else is fetched.
//
// A candidate = one paragraph's direct speech with a NAMED speaker in that paragraph ("…," Norrie said / said Rune), or
// a paragraph that continues an open quote from the paragraph before. "said the 23-year-old" names nobody: skipped and
// counted, never resolved from context. The builder then re-checks every span against the fetched text (verbatimIn).
import { quotedSpans, foldText } from './news-core.mjs';

const UA = 'stennisfy-news-sample/1.0 (feasibility test; contact via michaeldk1996.github.io/SAAS)';
export const SITES = {
  Stockholm: { name: 'ATP Tour daily report (via the official tournament site)', ownName: 'Stockholm Open (official tournament site)', origin: 'https://www.stockholmopen.se',
    list: '/en/tournament/nyheter', feed: '/en/-/tournaments/news/latest?articlesToTake=60&articlesToSkip=0', article: /href="(\/en\/tournament\/nyheter\/[a-z0-9-]+)"/g,
    press: [{ name: 'SVT Sport', origin: 'https://www.svt.se', list: '/sport/tennis/', article: /href="(\/sport\/tennis\/[a-z0-9-]+)"/g, mention: /stockholm open/i, language: 'sv' }] },
};

const get = async (url) => {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
      return { status: r.status, body: r.ok ? await r.text() : '' };
    } catch (e) { if (i >= 2) return { status: 0, body: '' }; await new Promise((r) => setTimeout(r, 2000)); }
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// robots.txt, "User-agent: *" group only: is this path disallowed?
export function robotsDisallows(robots, path) {
  let on = false; const rules = [];
  for (const line of String(robots || '').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*(#.*)?$/.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2];
    if (k === 'user-agent') on = v === '*';
    else if (on && k === 'disallow' && v) rules.push(v);
  }
  return rules.some((r) => {
    const re = new RegExp('^' + r.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'));
    return re.test(path);
  });
}

export function htmlToParagraphs(html) {
  const body = (String(html).match(/<article[\s\S]*?<\/article>/i) || String(html).match(/<main[\s\S]*?<\/main>/i) || [String(html)])[0];
  return body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<\/(p|div|h\d|li)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"').split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const NAME = "([A-Z][A-Za-z'’-]+(?: [A-Z][A-Za-z'’-]+){0,3})";
const SAID = '(?:said|says|added|explained|admitted|reflected)';
// -> the named speaker of a paragraph, or null
export function speakerOf(par) {
  const outside = foldText(par).replace(/"[^"]*"?/g, ' " ');
  let m = new RegExp(`${NAME} ${SAID}\\b`).exec(outside); if (m) return m[1];
  m = new RegExp(`\\b${SAID} ${NAME}`).exec(outside); if (m) return m[1];
  return null;
}

export function candidatesFromArticle({ url, html, sourceName }) {
  const pars = htmlToParagraphs(html), sourceText = pars.join('\n');
  const dm = /<span>\s*(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (20\d\d)\s*<\/span>/.exec(html);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const day = dm ? `${dm[3]}-${String(MONTHS.indexOf(dm[2]) + 1).padStart(2, '0')}-${String(dm[1]).padStart(2, '0')}` : null;
  const out = []; let unnamed = 0, open = null;
  pars.forEach((p, i) => {
    const f = foldText(p);
    if (!f.includes('"')) { open = null; return; }
    const quotes = (f.match(/"/g) || []).length;
    let spans = quotedSpans(f), speaker = speakerOf(p);
    // a paragraph that opens a quote and never closes it carries on into the next one (same speaker)
    if (quotes % 2 === 1 && !spans.length && f.startsWith('"')) spans = [f.slice(1).trim()].filter((s) => s.length >= 25);
    else if (quotes % 2 === 1 && /(^|\s)"[^"]*$/.test(f)) { const tail = f.slice(f.lastIndexOf('"') + 1).trim(); if (tail.length >= 25) spans.push(tail); }   // the last mark OPENS a quote that runs on
    if (!speaker && open && f.startsWith('"')) speaker = open;
    open = quotes % 2 === 1 && speaker ? speaker : (quotes % 2 === 1 ? open : null);
    if (!spans.length) return;
    if (!speaker) { unnamed++; return; }
    out.push({ id: `${url.split('/').pop()}-${i}`, speaker, spans, text: spans.join(' … '), sourceText, sourceName, sourceUrl: url, day,
      timestamp: day ? `${day}T00:00:00.000Z` : null, timestampKind: 'article date (the page shows no clock time)', language: 'en' });
  });
  return { candidates: out, unnamed, day };
}

// Swedish press style: a paragraph that opens with a dash is direct speech up to ", säger X" / ", sade X".
const SV_SAID = '(?:säger|sade|sa|berättar|konstaterar|förklarar)';
export function candidatesFromDashArticle({ url, html, sourceName, language }) {
  const pars = htmlToParagraphs(html), sourceText = pars.join('\n');
  const pm = /"datePublished":"([^"]+)"/.exec(html);
  const ts = pm && !Number.isNaN(Date.parse(pm[1])) ? new Date(pm[1]).toISOString() : null;
  const out = []; let unnamed = 0;
  pars.forEach((p, i) => {
    const m = /^[–—-]\s+(.+)$/s.exec(p.trim());
    if (!m) return;
    const cut = new RegExp(`^(.*),\\s+${SV_SAID}\\s+(.+)$`, 's').exec(m[1]);
    if (!cut) { unnamed++; return; }
    const nm = /^(\p{Lu}[\p{L}'’-]+(?: \p{Lu}[\p{L}'’-]+){0,3})/u.exec(cut[2].replace(/[​-‍⁠]/g, ''));
    if (!nm) { unnamed++; return; }                 // "sade 23-åringen …" names nobody
    const text = cut[1].trim();
    if (text.length < 25) return;
    out.push({ id: `${url.split('/').pop().slice(0, 48)}-${i}`, speaker: nm[1], spans: [text], text, sourceText, sourceName, sourceUrl: url,
      day: ts ? ts.slice(0, 10) : null, timestamp: ts, timestampKind: 'observed (the outlet\'s own publication time)', language });
  });
  return { candidates: out, unnamed, day: ts ? ts.slice(0, 10) : null };
}

// context from OUR results only: the speaker's latest completed main-draw match on the article's day or the day before
export function addContext(c, main) {
  if (!c.day) return;
  const sur = c.speaker.split(' ').pop().toLowerCase();
  const prevDay = new Date(Date.parse(c.day + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  const mine = main.filter((m) => !m.walkover && ['p1', 'p2'].some((k) => String(m[k]).toLowerCase().endsWith(' ' + sur)));
  let ms = mine.filter((m) => m.date === c.day);
  if (!ms.length) ms = mine.filter((m) => m.date === prevDay);
  if (ms.length !== 1) return;
  const m = ms[0], w = m.finalScore.winner, l = w === 'p1' ? 'p2' : 'p1';
  const won = String(m[w]).toLowerCase().endsWith(' ' + sur);
  c.opponent = won ? m[l] : m[w];
  c.context = `${won ? 'after beating' : 'after losing to'} ${c.opponent}`;
  c.contextBasis = 'our result for the speaker on or just before the article date';
  c.matchId = m.id; c.won = won;
}

// `site` (optional) = a config built from data/news-outlets.json by collect-quotes.mjs; without it, the sample's SITES.
export async function collectQuotes({ tournament, main, since, site: cfg }) {
  const site = cfg || SITES[tournament];
  if (!site) return { sources: [{ name: 'none configured for ' + tournament, articles: 0 }], candidates: [] };
  const sources = [], candidates = [], seen = new Set();
  const push = (c) => { const k = c.speaker + '|' + c.text; if (seen.has(k)) return false; seen.add(k); addContext(c, main); candidates.push(c); return true; };

  if (site.origin) {
  // 1. the tournament site: every article of its own news feed (ATP daily reports included), then the list page
  const robots = await get(site.origin + '/robots.txt');
  const src = { name: site.name, list: site.origin + site.feed, robotsStatus: robots.status, listed: 0, articles: 0, atpReports: 0, articlesWithQuotes: 0, candidates: 0,
    duplicateOfAnotherUrl: 0, beforeWindow: 0, undatedSkipped: 0, unnamedSpeakerParagraphs: 0, skippedByRobots: 0, language: 'en' };
  const meta = new Map();
  if (!robotsDisallows(robots.body, site.feed)) {
    const feed = await get(site.origin + site.feed);
    try { for (const a of JSON.parse(feed.body).content.articles) if (a && a.url) meta.set(a.url, a); } catch (e) { /* the list page below still runs */ }
  }
  const list = await get(site.origin + site.list);
  for (const m of list.body.matchAll(site.article)) if (!meta.has(m[1])) meta.set(m[1], {});
  src.listed = meta.size;
  for (const [p, a] of meta) {
    // only this edition: an article the feed dates before the tournament window is last year's (or a ticket notice)
    if (since && a.date && !Number.isNaN(Date.parse(a.date)) && Date.parse(a.date) < since) { src.beforeWindow++; continue; }
    if (robots.status === 200 && robotsDisallows(robots.body, p)) { src.skippedByRobots++; continue; }
    await sleep(1200);
    const page = await get(site.origin + p);
    if (page.status !== 200) continue;
    src.articles++;
    const isAtp = /ATP Staff/i.test(a.byline || '');
    if (isAtp) src.atpReports++;
    const got = candidatesFromArticle({ url: site.origin + p, html: page.body, sourceName: isAtp ? site.name : site.ownName });
    src.unnamedSpeakerParagraphs += got.unnamed;
    if (got.candidates.length) src.articlesWithQuotes++;
    for (const c of got.candidates) {
      if (since && c.day && Date.parse(c.day + 'T23:59:59Z') < since && !a.date) { src.undatedSkipped++; continue; }
      if (a.date && !Number.isNaN(Date.parse(a.date))) { c.timestamp = new Date(a.date).toISOString(); c.timestampKind = 'observed (the site\'s own publication time)'; c.day = c.timestamp.slice(0, 10); }
      if (push(c)) src.candidates++; else src.duplicateOfAnotherUrl++;
    }
  }
  sources.push(src);

  }

  // 2. press sections
  for (const pr of site.press || []) {
    const rb = await get(pr.origin + '/robots.txt');
    const ps = { name: pr.name, list: pr.origin + pr.list, robotsStatus: rb.status, listed: 0, articles: 0, articlesAboutTournament: 0, articlesWithQuotes: 0, candidates: 0,
      unnamedSpeakerParagraphs: 0, skippedByRobots: 0, language: pr.language };
    const lp = await get(pr.origin + pr.list);
    const paths = [...new Set([...lp.body.matchAll(pr.article)].map((m) => m[1]))].filter((p) => p !== pr.list && p + '/' !== pr.list);
    ps.listed = paths.length;
    for (const p of paths) {
      if (rb.status === 200 && robotsDisallows(rb.body, p)) { ps.skippedByRobots++; continue; }
      await sleep(1200);
      const page = await get(pr.origin + p);
      if (page.status !== 200) continue;
      ps.articles++;
      if (!pr.mention.test(page.body.replace(/<[^>]+>/g, ' '))) continue;
      ps.articlesAboutTournament++;
      const got = candidatesFromDashArticle({ url: pr.origin + p, html: page.body, sourceName: pr.name, language: pr.language });
      ps.unnamedSpeakerParagraphs += got.unnamed;
      if (got.candidates.length) ps.articlesWithQuotes++;
      for (const c of got.candidates) { if (since && c.timestamp && Date.parse(c.timestamp) < since) continue; if (push(c)) ps.candidates++; }
    }
    sources.push(ps);
  }
  return { sources, candidates };
}
