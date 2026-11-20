#!/usr/bin/env node
// tools/build-court-speed-history.mjs — court-speed-history.json: one speed reading per event per season.
//   ta  = Tennis Abstract surface speed (ace-rate based): its season archive (surface-speed.cgi?year=Y, published back to
//         1991, used from 2020) and its "last 52 weeks" page for the current season (rows dated in that season only).
//         Seasons TA no longer serves as a page (2024, 2025) keep the as2024 / as2025 readings of COURT_CONDITIONS
//         (bsp-pipeline.js), which were taken from TA's own last-52-week page (2023 values agree with TA's archive).
//   cpi = courtspeed.com Court Pace Index (founder 2026-11-20), every season its grid shows (2012–), Slams, Masters 1000
//         and the ATP Finals. "COVID" and "–" cells are no reading (absent), never 0.
// Run by hand (committed output; flat files, never queried at runtime): node tools/build-court-speed-history.mjs
// Writes atomically. A source that fails to load stops the run (nothing written), never a partial file.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'court-speed-history.json');
const FIRST_TA = 2020, LAST_TA_ARCHIVE = 2023;
const UA = { 'user-agent': 'Mozilla/5.0 (Stennisfy court-speed history)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: UA });
    const t = await r.text();
    if (r.ok && !/error code: 10\d\d/.test(t.slice(0, 40))) return t;
    await sleep(15000 * (i + 1));   // Cloudflare 1015 = rate limited: back off
  }
  throw new Error('could not load ' + url);
}

// COURT_CONDITIONS keys, read from the pipeline's table text (no require: the pipeline module has side effects)
function courtConditions() {
  const src = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
  const m = src.match(/^const COURT_CONDITIONS = (\{[\s\S]*?^\});/m);
  if (!m) throw new Error('COURT_CONDITIONS not found in bsp-pipeline.js');
  return Function('"use strict";return (' + m[1] + ')')();
}

// the page's event registry (TOURNAMENT_CATALOG, bsp-consult-dashboard.html): events with no COURT_CONDITIONS row
function catalogNames() {
  const src = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
  const m = src.match(/^const TOURNAMENT_CATALOG = \[([\s\S]*?)^\];/m);
  if (!m) throw new Error('TOURNAMENT_CATALOG not found');
  return [...m[1].matchAll(/name: '([^']+)'/g)].map(x => x[1]);
}

// a source's event name -> a COURT_CONDITIONS key (exact after the alias table, else strip " Masters")
const ALIAS = {
  'Tour Finals': 'Turin', 'ATP Finals': 'Turin', 'Masters Cup': 'Turin', "Queen's Club": 'London', 'Queens Club': 'London',
  "'s-Hertogenbosch": 'Hertogenbosch', 's Hertogenbosch': 'Hertogenbosch', 'Rio De Janeiro': 'Rio de Janeiro',
  'ATP Rio de Janeiro': 'Rio de Janeiro', 'Nur-Sultan': 'Astana', 'Us Open': 'US Open', 'Roland Garros': 'Roland Garros', 'French Open': 'Roland Garros',
  'Canada Masters': null, 'Canadian Open': null, 'Monte Carlo Masters': 'Monte Carlo', 'Monte-Carlo': 'Monte Carlo',
  'Aus Open': 'Australian Open', 'Rome Masters': 'Rome', 'Madrid Masters': 'Madrid'
};
function keyOf(name, keys, year) {
  const n = String(name).trim();
  // the Canadian event alternates Toronto / Montreal (to 2019 Toronto even; from 2021 Toronto odd), tournaments.md
  if (/^Canad/i.test(n)) { const tor = year <= 2019 ? year % 2 === 0 : year % 2 === 1; return tor ? 'Toronto' : 'Montreal'; }
  if (Object.prototype.hasOwnProperty.call(ALIAS, n) && ALIAS[n]) return keys.has(ALIAS[n]) ? ALIAS[n] : null;
  // Lyon: the October 2026 indoor event is a new event, never the clay Lyon (tournaments.md "Lineage")
  if (n === 'Lyon') return year >= 2026 ? 'Lyon (France)' : 'Lyon';
  if (keys.has(n)) return n;
  const s = n.replace(/\s+Masters$/, '');
  return keys.has(s) ? s : null;
}

function taRows(html) {
  const out = [];
  for (const r of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []) {
    const c = (r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) || []).map(x => x.replace(/<[^>]+>/g, '').trim());
    if (c.length === 5 && /^\d+(\.\d+)?$/.test(c[4])) out.push({ date: c[0], name: c[1], surface: c[2], ace: c[3], speed: Number(c[4]) });
  }
  return out;
}

async function main() {
  const cc = courtConditions(), keys = new Set([...Object.keys(cc), ...catalogNames()]);
  const ta = {}, unmatched = new Set();
  const put = (k, y, v) => { (ta[k] ||= {})[y] = v; };
  for (let y = FIRST_TA; y <= LAST_TA_ARCHIVE; y++) {
    const rows = taRows(await get(`https://www.tennisabstract.com/cgi-bin/surface-speed.cgi?year=${y}`));
    if (!rows.length) throw new Error('Tennis Abstract ' + y + ': no rows');
    for (const r of rows) { const k = keyOf(r.name, keys, y); if (k) put(k, y, r.speed); else unmatched.add(r.name); }
    await sleep(8000);
  }
  for (const [k, v] of Object.entries(cc)) for (const y of [2024, 2025]) {
    if (v['as' + y] == null) continue;
    put(k === 'Toronto' || k === 'Montreal' ? keyOf('Canada', keys, y) : k, y, Number(v['as' + y]));
  }
  const cur = await get('https://tennisabstract.com/reports/atp_surface_speed.html');
  const lastUpd = (cur.match(/Last update:\s*(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
  const curYear = lastUpd ? Number(lastUpd.slice(0, 4)) : new Date().getUTCFullYear();
  for (const r of taRows(cur)) {
    if (!r.date.startsWith(String(curYear))) continue;   // the last 52 weeks reach into the previous season
    const k = keyOf(r.name, keys, curYear); if (k) put(k, curYear, r.speed); else unmatched.add(r.name);
  }

  const cs = await get('https://courtspeed.com/');
  const cpi = {}, cpiUnmatched = new Set();
  for (const m of cs.matchAll(/data-k="([^"|]+)\|(\d{4})"[^>]*>([\d.]+)</g)) {
    const y = Number(m[2]), k = keyOf(m[1], keys, y);
    if (!k) { cpiUnmatched.add(m[1]); continue; }
    (cpi[k] ||= {})[y] = Number(m[3]);
  }
  if (!Object.keys(cpi).length) throw new Error('courtspeed.com: no CPI cells');

  const out = {
    builtAt: new Date().toISOString(),
    sources: {
      ta: `Tennis Abstract surface speed: season archive ${FIRST_TA}–${LAST_TA_ARCHIVE}, 2024–2025 from COURT_CONDITIONS (TA last-52-week readings), ${curYear} from the last-52-week page (last update ${lastUpd})`,
      cpi: 'courtspeed.com Court Pace Index grid'
    },
    unmatched: { ta: [...unmatched].sort(), cpi: [...cpiUnmatched].sort() },
    ta, cpi
  };
  fs.writeFileSync(OUT + '.tmp', JSON.stringify(out, null, 1) + '\n');
  fs.renameSync(OUT + '.tmp', OUT);
  console.log(`ta events ${Object.keys(ta).length}, cpi events ${Object.keys(cpi).length}; unmatched ta ${unmatched.size}, cpi ${cpiUnmatched.size}`);
}
main().catch(e => { console.error(e.message); process.exit(1); });
