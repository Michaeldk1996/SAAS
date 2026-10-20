#!/usr/bin/env node
// tools/draws/build-calendar.mjs — the season calendar of ATP tournament IDs (founder brief 2026-10-20, C15).
//
// SOURCE: Wikipedia's "<season> ATP Tour" article → every "<season> <event>" article it links → the article's own
// atptour.com/en/tournaments/<slug>/<id> link (the ATP id is the protennislive posting folder: /posting/<season>/<id>/).
// Dates / location / category come from the article's TennisEventInfo infobox. Licence: Wikipedia text is CC BY-SA;
// we keep only facts (an id, a date range, a city) and cite the article per row.
// VERIFIED IDS: an id is `verified` only when an official protennislive sheet at that id printed this event's own
// header (name + city + dates). VERIFIED below carries that evidence. Everything else is `unverified` (Wikipedia-only).
// MISSING IDS are left out — never guessed. tools/draws/check-draws.py fails when a board tournament has no id.
//
// Run: node tools/draws/build-calendar.mjs [season]   (network: en.wikipedia.org API only, ~4 requests)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEASON = process.argv[2] || '2026';
const UA = 'StennisfyCalendar/1.0 (micha.dekegel@hotmail.com)';
const API = 'https://en.wikipedia.org/w/api.php?';
const OUT = path.join(ROOT, 'tools', 'draws', `calendar-${SEASON}.json`);

// Header-verified on 2026-10-20 from the official sheet at protennislive.com/posting/2026/<id>/mds.pdf
// (header printed name · city · dates). Evidence is the sheet, not memory.
const VERIFIED = {
  9410: { header: 'Almaty Open · Almaty, Kazakhstan · 19 October — 25 October 2026' },
  7485: { header: 'BNP Paribas Fortis European Open · Brussels · 19 October — 25 October 2026' },
  496: { header: 'Grand Prix Auvergne-Rhone-Alpes · Lyon, France · 19 October — 25 October 2026' },
  5014: { header: 'Rolex Shanghai Masters · Shanghai · 7 October — 18 October 2026' },
};
// Header-verified events whose Wikipedia article carries no atptour link (Shanghai, Lyon): the article is still the
// source of the dates; the id comes from the verified sheet.
const ID_BY_ARTICLE = {
  '2026 Rolex Shanghai Masters': 5014,
  '2026 Grand Prix Auvergne-Rhône-Alpes': 496,
};
// Events whose Wikipedia article carries no atptour link: the id is read LIVE from the tournament's Wikidata item,
// property P3456 "Association of Tennis Professionals tennis tournament ID" (formatter atptour.com/en/tournaments/-/$1).
// Added 2026-10-20 for next week (founder brief): both ids also answer protennislive's 2026 "not yet posted" placeholder
// (a bogus id answers 404), so the 2026 folder exists; `verified` flips only when a posted sheet prints the header.
const WIKIDATA_SERIES = {
  '2026 Erste Bank Open': 'Q300007',   // Vienna
  '2026 Swiss Indoors': 'Q299174',     // Basel
};
const NOT_EVENTS = /–|ATP Tour|ATP Challenger|WTA|Davis Cup|United Cup|Laver Cup|Next Gen|ATP Finals|in tennis|ITF|Billie Jean King|Masters 1000 tournaments/;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(params) {
  const res = await fetch(API + new URLSearchParams({ format: 'json', formatversion: '2', ...params }), { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`wikipedia HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`wikipedia: ${j.error.info}`);
  await sleep(1200);
  return j;
}

const strip = (s) => String(s || '').replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').replace(/\{\{[^}]*\}\}/g, '').replace(/<[^>]+>/g, '').trim();
function infobox(wt) {
  const get = (k) => { const m = wt.match(new RegExp(`\\|\\s*${k}\\s*=([^\\n|]*(?:\\|[^\\n=|]*)*)`, 'i')); return m ? strip(m[1].split('\n')[0]) : null; };
  return { date: get('date'), location: get('location'), category: get('category'), surface: get('surface') };
}
// "19–25 October" / "28 September – 4 October" / "13–19 January" → ISO start/end in SEASON
export function parseDates(s, season = SEASON) {
  if (!s) return null;
  const t = s.replace(/&ndash;|&nbsp;/g, (m) => (m === '&ndash;' ? '–' : ' ')).replace(/[−—]/g, '–').replace(/,\s*\d{4}/g, '').replace(/\s+/g, ' ').trim();
  const iso = (d, mi) => `${season}-${String(mi + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const mi = (w) => MONTHS.indexOf(String(w).toLowerCase());
  let m = t.match(/^(\d{1,2})\s*[–-]\s*(\d{1,2})\s+([A-Za-z]+)/);
  if (m && mi(m[3]) >= 0) return { start: iso(+m[1], mi(m[3])), end: iso(+m[2], mi(m[3])) };
  m = t.match(/^(\d{1,2})\s+([A-Za-z]+)\s*[–-]\s*(\d{1,2})\s+([A-Za-z]+)/);
  if (m && mi(m[2]) >= 0 && mi(m[4]) >= 0) return { start: iso(+m[1], mi(m[2])), end: iso(+m[3], mi(m[4])) };
  // US style: "March 17–29", "July 27–August 3"
  m = t.match(/^([A-Za-z]+)\s+(\d{1,2})\s*[–-]\s*(\d{1,2})$/);
  if (m && mi(m[1]) >= 0) return { start: iso(+m[2], mi(m[1])), end: iso(+m[3], mi(m[1])) };
  m = t.match(/^([A-Za-z]+)\s+(\d{1,2})\s*[–-]\s*([A-Za-z]+)\s+(\d{1,2})$/);
  if (m && mi(m[1]) >= 0 && mi(m[3]) >= 0) return { start: iso(+m[2], mi(m[1])), end: iso(+m[4], mi(m[3])) };
  return null;
}

async function main() {
  const tour = await api({ action: 'parse', page: `${SEASON}_ATP_Tour`, prop: 'links' });
  const titles = [...new Set(tour.parse.links.map((l) => l.title).filter((t) => t.startsWith(`${SEASON} `) && !NOT_EVENTS.test(t)))];
  const pages = {};
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const r = await api({ action: 'query', redirects: '1', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: batch.join('|') });
    for (const p of r.query.pages) pages[p.title] = { wt: p.revisions ? p.revisions[0].slots.main.content : '', ids: [] };
    let cont = {};
    do {
      const e = await api({ action: 'query', redirects: '1', prop: 'extlinks', ellimit: 'max', elprotocol: 'https', elquery: 'www.atptour.com/en/tournaments/', titles: batch.join('|'), ...cont });
      for (const p of e.query.pages) for (const l of p.extlinks || []) {
        const m = l.url.match(/tournaments\/([^/]+)\/(\d+)/);
        if (m && pages[p.title] && !pages[p.title].ids.includes(+m[2])) pages[p.title].ids.push(+m[2]);
      }
      cont = e.continue || null;
    } while (cont);
  }
  const wdIds = {};
  for (const [title, q] of Object.entries(WIKIDATA_SERIES)) {
    const r = await (await fetch('https://www.wikidata.org/w/api.php?' + new URLSearchParams({ action: 'wbgetentities', ids: q, props: 'claims', format: 'json' }), { headers: { 'User-Agent': UA } })).json();
    await sleep(1200);
    const vals = ((r.entities[q].claims || {}).P3456 || []).map((c) => c.mainsnak.datavalue && c.mainsnak.datavalue.value)
      .map((v) => Number(String(v).split('/').pop())).filter(Number.isFinite);
    const uniq = [...new Set(vals)];
    if (uniq.length === 1) wdIds[title] = { id: uniq[0], q };
  }
  const rows = [], noId = [], ambiguous = [];
  for (const [title, p] of Object.entries(pages)) {
    const box = infobox(p.wt);
    if (!/ATP|Masters|Grand Slam/i.test(box.category || '') && !/Open|Championships/.test(title)) continue;   // non-ATP pages
    let ids = p.ids;
    if (ID_BY_ARTICLE[title]) ids = [ID_BY_ARTICLE[title]];
    else if (!ids.length && wdIds[title]) ids = [wdIds[title].id];
    if (ids.length === 0) { noId.push(title); continue; }
    if (ids.length > 1) { ambiguous.push(`${title}: ${ids.join(', ')}`); continue; }
    const dates = parseDates(box.date);
    const id = ids[0];
    rows.push({
      atpId: id, article: title, category: box.category || null, city: box.location ? box.location.split(',')[0].trim() : null,
      location: box.location || null, surface: box.surface || null,
      startDate: dates ? dates.start : null, endDate: dates ? dates.end : null,
      idSource: ID_BY_ARTICLE[title] ? 'protennislive-header' : wdIds[title] && ids[0] === wdIds[title].id ? `wikidata-P3456 (${wdIds[title].q})` : 'wikipedia-atptour-link',
      verified: !!VERIFIED[id], verifiedBy: VERIFIED[id] ? VERIFIED[id].header : null,
    });
  }
  rows.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)) || a.atpId - b.atpId);
  const out = {
    season: Number(SEASON), builtAt: new Date().toISOString(),
    source: `en.wikipedia.org "${SEASON} ATP Tour" + linked event articles (CC BY-SA, facts only); ids verified against protennislive sheet headers where marked`,
    challengers: 'out of scope (founder brief 2026-10-20) — protennislive Challenger ids do not follow ATP tour ids',
    tournaments: rows, articlesWithoutId: noId.sort(), ambiguous,
  };
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 1) + '\n');
  fs.renameSync(tmp, OUT);
  console.log(`calendar-${SEASON}: ${rows.length} events with an id (${rows.filter((r) => r.verified).length} header-verified), `
    + `${noId.length} articles without an id, ${ambiguous.length} ambiguous, ${rows.filter((r) => !r.startDate).length} without parsable dates`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(e.message); process.exit(1); });
