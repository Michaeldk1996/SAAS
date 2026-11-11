// News ticker sample — quote collection from ONE source: the official tournament site's own news pages (plain HTML,
// robots.txt read and honoured, one request per page, an honest user agent). Nothing else is fetched.
//
// A candidate = one paragraph's direct speech with a NAMED speaker in that paragraph ("…," Norrie said / said Rune), or
// a paragraph that continues an open quote from the paragraph before. "said the 23-year-old" names nobody: skipped and
// counted, never resolved from context. The builder then re-checks every span against the fetched text (verbatimIn).
import { quotedSpans, foldText } from './news-core.mjs';

const UA = 'stennisfy-news-sample/1.0 (feasibility test; contact via michaeldk1996.github.io/SAAS)';
export const SITES = {
  Stockholm: { name: 'Stockholm Open (official tournament site)', origin: 'https://www.stockholmopen.se', list: '/en/tournament/nyheter', article: /href="(\/en\/tournament\/nyheter\/[a-z0-9-]+)"/g },
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
    else if (quotes % 2 === 1) { const tail = f.slice(f.lastIndexOf('"') + 1).trim(); if (tail.length >= 25) spans.push(tail); }
    if (!speaker && open && f.startsWith('"')) speaker = open;
    open = quotes % 2 === 1 && speaker ? speaker : (quotes % 2 === 1 ? open : null);
    if (!spans.length) return;
    if (!speaker) { unnamed++; return; }
    out.push({ id: `${url.split('/').pop()}-${i}`, speaker, spans, text: spans.join(' … '), sourceText, sourceName, sourceUrl: url, day,
      timestamp: day ? `${day}T00:00:00.000Z` : null, timestampKind: 'article date (the page shows no clock time)', language: 'en' });
  });
  return { candidates: out, unnamed, day };
}

export async function collectQuotes({ tournament, main }) {
  const site = SITES[tournament];
  if (!site) return { sources: [{ name: 'none configured for ' + tournament, articles: 0 }], candidates: [] };
  const robots = await get(site.origin + '/robots.txt');
  const src = { name: site.name, list: site.origin + site.list, robotsStatus: robots.status, articles: 0, articlesWithQuotes: 0, unnamedSpeakerParagraphs: 0, skippedByRobots: 0 };
  const list = await get(site.origin + site.list);
  const paths = [...new Set([...list.body.matchAll(site.article)].map((m) => m[1]))];
  const candidates = [];
  for (const p of paths) {
    if (robots.status === 200 && robotsDisallows(robots.body, p)) { src.skippedByRobots++; continue; }
    await sleep(1500);
    const a = await get(site.origin + p);
    if (a.status !== 200) continue;
    src.articles++;
    const got = candidatesFromArticle({ url: site.origin + p, html: a.body, sourceName: site.name });
    src.unnamedSpeakerParagraphs += got.unnamed;
    if (got.candidates.length) src.articlesWithQuotes++;
    // context from OUR results only: the speaker's completed main-draw match on the article's day
    for (const c of got.candidates) {
      const sur = c.speaker.split(' ').pop().toLowerCase();
      const ms = main.filter((m) => m.date === c.day && !m.walkover && ['p1', 'p2'].some((k) => String(m[k]).toLowerCase().endsWith(' ' + sur)));
      if (ms.length === 1) {
        const m = ms[0], w = m.finalScore.winner, l = w === 'p1' ? 'p2' : 'p1';
        const won = String(m[w]).toLowerCase().endsWith(' ' + sur);
        c.opponent = won ? m[l] : m[w];
        c.context = `${won ? 'after beating' : 'after losing to'} ${c.opponent}`;
        c.contextBasis = 'our result for the speaker on the article date';
        c.matchId = m.id; c.won = won;
      }
      candidates.push(c);
    }
  }
  return { sources: [src], candidates };
}
