#!/usr/bin/env node
// TEN-443 step 2 · build the Tennis Explorer (TE) store the pipeline reads, from the raw page cache of te-scrape.mjs.
//
//   te-history/<profileKey>.json   one player: { key, slug, dob, name, builtAt, balance: {season: TE table row}, rows: [...] }
//   te-history-index.json          { builtAt, players: {key: {slug, rows, seasons}}, totalRows, highWater: {totalRows, players} }
//
// Written ONLY by this tool, run on this Mac after a scrape (founder 2026-10-17: TE is licensed via the Livesport
// agreement; rows carry src 'te'). Nothing in CI, the nightly pipeline or a profile rebuild writes either path — the
// guard (tools/te-history-guard.mjs, in npm test and the publish workflow) fails if the store is missing, a listed
// player's file is gone or short, or the total falls below the high-water mark this tool records.
//
// Each player's rows are checked against TE's OWN season table before they are written: per season and per column
// (Summary, Clay, Hard, Indoors, Grass, Not set), the parsed rows minus walkovers must equal the table. A season off by
// more than 2 matches means the parse is wrong: that player is NOT written (his previous file is kept) and is listed.
// Off by 1–2 is TE disagreeing with itself: written, flagged `tableMismatch`, never resolved silently.
//
// Row: { season, date, dateAmbiguous?, event, eventHref, cat, round, surface, court, opp, oppSlug, won, score,
//        sets, wo, ret, teMatchId, src: 'te' }
//   season  = TE's page year (the EDITION year: a United Cup tie on 30 Dec 2023 sits in season 2024)
//   date    = the calendar date the match was played (ISO); TE prints "dd.mm." only, so a December row below a
//             January–November row on the same page belongs to the year before the page (dateAmbiguous when a page
//             holds December rows only)
//   cat     = ATP | ATP qual | Challenger | Challenger qual | ITF | ITF qual | Davis Cup | ATP Cup | United Cup |
//             Laver Cup | Hopman Cup | Olympics | Next Gen Finals | Exhibition  (Exhibition = exhibition or club
//             match: not counted, founder ruling TEN-443)
//   surface = clay | hard | grass | null (TE "Not set");  court = indoor | outdoor | null
// Run: node tools/te-build-history.mjs [--cache ~/.stennisfy/te-cache] [--out <repo root>] [--only key,key]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CACHE = arg('--cache', process.env.TE_CACHE || path.join(os.homedir(), '.stennisfy', 'te-cache'));
const OUT = arg('--out', path.join(path.dirname(new URL(import.meta.url).pathname), '..'));
const ONLY = arg('--only', '') ? new Set(arg('--only').split(',')) : null;

const ent = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"');
const txt = (s) => ent(String(s).replace(/<sup>(\d+)<\/sup>/g, '($1)').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const cacheFile = (rel) => path.join(CACHE, 'html', rel.replace(/^\/+/, '').replace(/[^A-Za-z0-9._-]+/g, '_') + '.html');

// Event categories. Exhibition/club: TE's own exhibition and club events (founder ruling: not counted). Identified by
// the EVENT TE files the match under — a name list kept narrow on purpose ("Hurlingham - exhibition", never ITF
// "M25 Hurlingham", which carries a Futures/Challenger header and counts).
const TEAM = [['davis cup', 'Davis Cup'], ['atp cup', 'ATP Cup'], ['united cup', 'United Cup'], ['laver cup', 'Laver Cup'], ['hopman cup', 'Hopman Cup']];
const EXHIBITION = [/exhibition/, /^boodles/, /^utr pro/, /^diriyah/, /^adria tour/, /^ultimate tennis showdown/, /^six kings/, /^6 kings/,
  /^kooyong classic/, /^mubadala world tennis/, /^world tennis league/, /^tie break tens/, /bundesliga/, / - championship$/, /^hurlingham/];
export function categoryOf(tour, round) {
  const t = String(tour || '').toLowerCase().trim();
  const q = /^Q-/.test(round || '') ? ' qual' : '';
  if (EXHIBITION.some((re) => re.test(t)) && !/^m\d+ /.test(t)) return 'Exhibition';
  for (const [k, v] of TEAM) if (t.includes(k)) return v;
  if (/olympic/.test(t)) return 'Olympics';
  if (/next gen/.test(t)) return 'Next Gen Finals';
  if (/^futures \d{4}$/.test(t)) return 'ITF' + q;
  if (/chall/.test(t)) return 'Challenger' + q;
  return 'ATP' + q;
}
const SURF = { hard: ['hard', 'outdoor'], clay: ['clay', 'outdoor'], grass: ['grass', 'outdoor'], indoors: [null, 'indoor'] };

// "7-6(4), 6-7(5), 6-3" (winner's view) -> [{w, l}] games per set; a retirement's last partial set is kept as printed
function setsOf(score) {
  return String(score || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^(\d+)(?:\(\d+\))?-(\d+)(?:\(\d+\))?$/); return m ? { w: +m[1], l: +m[2] } : null;
  }).filter(Boolean);
}

export function parseSeason(html, slug, season) {
  const i = html.indexOf(`id="matches-${season}-1-data"`);
  if (i < 0) return [];
  const body = html.slice(i, html.indexOf('</table>', i));
  const out = []; let tour = null, href = null;
  for (const m of body.matchAll(/<tr class="([^"]*)">([\s\S]*?)<\/tr>/g)) {
    const [, cls, c] = m;
    if (/head/.test(cls)) {
      const t = c.match(/<td class="t-name"[^>]*>([\s\S]*?)<\/td>/);
      tour = t ? txt(t[1]) : null; const h = t && t[1].match(/href="([^"]+)"/); href = h ? h[1] : null; continue;
    }
    const cell = (k) => { const r = c.match(new RegExp(`<td class="${k}"([^>]*)>([\\s\\S]*?)</td>`)); return r ? { a: r[1], v: r[2] } : { a: '', v: '' }; };
    const date = txt(cell('first time').v);
    const st = (cell('s-color').v.match(/title="([^"]+)"/) || [])[1] || null;
    const names = cell('t-name').v;
    const ps = [...names.matchAll(/<a href="\/player\/([^/]+)\/"[^>]*>([\s\S]*?)<\/a>/g)].map((x) => ({ slug: x[1], name: txt(x[2]) }));
    if (ps.length < 2) continue;
    const won = ps[0].slug === slug;
    const opp = won ? ps[1] : ps[0];
    const rnd = cell('round'); const round = txt(rnd.v);
    const tl = cell('tl'); const score = txt(tl.v); const mid = (tl.v.match(/match-detail\/\?id=(\d+)/) || [])[1] || null;
    const [surface, court] = st ? (SURF[st] || [null, null]) : [null, null];
    out.push({ season: +season, dm: date, event: tour, eventHref: href, cat: categoryOf(tour, round), round,
      surface, court, opp: opp.name, oppSlug: opp.slug, won, score, sets: setsOf(score), wo: score === '', teMatchId: mid, src: 'te' });
  }
  // calendar date: page order is newest first, so a December row BELOW a Jan–Nov row was played the year before
  let seenNonDec = false;
  const onlyDec = out.length > 0 && out.every((r) => /\.12\.?$/.test(r.dm));
  for (const r of out) {
    const [d, mo] = r.dm.replace(/\.$/, '').split('.').map(Number);
    let y = +season;
    if (mo === 12 && seenNonDec) y -= 1;
    if (mo !== 12) seenNonDec = true;
    r.date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (mo === 12 && onlyDec) r.dateAmbiguous = true;
    delete r.dm;
  }
  return out;
}

// Compact on disk, ONE ROW PER LINE so a weekly refresh's git diff is only the new matches (~80 B/row; 314 players ≈ 18 MB).
// Row = [season, date, event, cat, round, surface, court, opp, oppSlug, won, score, wo, ret, teMatchId, dateAmbiguous];
// readers use rowsOf(), which returns the object form with src 'te'.
export const COLS = ['season', 'date', 'event', 'cat', 'round', 'surface', 'court', 'opp', 'oppSlug', 'won', 'score', 'wo', 'ret', 'teMatchId', 'dateAmbiguous'];
function serialise(rec) {
  const { rows, ...head } = rec;
  const lines = rows.map((r) => JSON.stringify(COLS.map((c) => (c === 'won' || c === 'wo' || c === 'ret' || c === 'dateAmbiguous' ? (r[c] ? 1 : 0) : r[c] ?? null))));
  return JSON.stringify({ ...head, format: 'te-history/1', cols: COLS, src: 'te' }).slice(0, -1) + ',"rows":[\n' + lines.join(',\n') + '\n]}\n';
}
export function rowsOf(rec) {
  const cols = rec.cols || COLS;
  return (rec.rows || []).map((a) => { if (!Array.isArray(a)) return a; const o = { src: 'te' };
    cols.forEach((c, i) => { o[c] = (c === 'won' || c === 'wo' || c === 'ret' || c === 'dateAmbiguous') ? !!a[i] : a[i]; });
    o.sets = setsOf(o.score); return o; });
}
export function parseBalance(html) {
  const i = html.indexOf('id="balMenu-1-data"'); if (i < 0) return null;
  const b = html.slice(i, html.indexOf('</table>', i)); const cols = ['total', 'clay', 'hard', 'indoors', 'grass', 'notset']; const out = {};
  for (const tr of b.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => txt(x[1]));
    if (tds.length !== 7) continue;
    const y = tds[0].startsWith('Summary') ? 'career' : tds[0];
    out[y] = Object.fromEntries(cols.map((c, k) => [c, tds[k + 1] === '-' ? null : tds[k + 1].split('/').map(Number)]));
  }
  return out;
}
const injuries = (html) => {
  const i = html.indexOf('Injuries'); if (i < 0) return [];
  return [...html.slice(i, i + 60000).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => txt(x[1])))
    .filter((t) => t.length >= 3 && /^\d\d\.\d\d\.\d{4}/.test(t[0]));
};

// TE's table counts every listed row except walkovers, per column; the store must reproduce it exactly
export function reconcileBalance(rows, balance) {
  const bad = [];
  for (const [season, b] of Object.entries(balance || {})) {
    if (season === 'career') continue;
    const rs = rows.filter((r) => String(r.season) === season && !r.wo);
    const col = (r) => (r.court === 'indoor' ? 'indoors' : r.surface || 'notset');
    for (const c of ['total', 'clay', 'hard', 'indoors', 'grass', 'notset']) {
      const sel = c === 'total' ? rs : rs.filter((r) => col(r) === c);
      const w = sel.filter((r) => r.won).length, l = sel.length - w;
      const want = b[c] || [0, 0];
      if (w !== want[0] || l !== want[1]) bad.push(`${season} ${c}: rows ${w}/${l} vs table ${want[0]}/${want[1]}`);
    }
  }
  return bad;
}

function main() {
  const players = JSON.parse(fs.readFileSync(path.join(CACHE, 'players.json'), 'utf8'));
  const dir = path.join(OUT, 'te-history'); fs.mkdirSync(dir, { recursive: true });
  const idxF = path.join(OUT, 'te-history-index.json');
  const prev = fs.existsSync(idxF) ? JSON.parse(fs.readFileSync(idxF, 'utf8')) : { players: {}, highWater: { totalRows: 0, players: 0 } };
  const idx = { builtAt: new Date().toISOString(), source: 'tennisexplorer.com (licensed, Livesport agreement 2026-10-17)', players: { ...prev.players } };
  const report = { written: 0, kept: [], notReconciled: [], tableMismatch: [], unmatched: [], missingPages: [] };
  for (const [key, p] of Object.entries(players)) {
    if (ONLY && !ONLY.has(key)) continue;
    if (!p.slug) { report.unmatched.push({ key, why: p.unmatched }); continue; }
    const mainF = cacheFile(`/player/${p.slug}/`);
    if (!fs.existsSync(mainF)) { report.missingPages.push(`${key} profile`); continue; }
    const mainHtml = fs.readFileSync(mainF, 'utf8');
    const balance = parseBalance(mainHtml); const inj = injuries(mainHtml);
    let rows = []; let missing = false;
    for (const y of p.years || []) {
      const f = cacheFile(`/player/${p.slug}/?annual=${y}`);
      if (!fs.existsSync(f)) { missing = true; report.missingPages.push(`${key} ${y}`); continue; }
      rows = rows.concat(parseSeason(fs.readFileSync(f, 'utf8'), p.slug, y));
    }
    if (missing) { report.kept.push(key); continue; }
    for (const r of rows) {   // retirements: TE's injury table names the date and event of each match he retired in
      const dmy = r.date.split('-').reverse().join('.');
      if (!r.won && inj.some((x) => x[0].startsWith(dmy) && /retired/i.test(x[2]))) r.ret = true;
    }
    const bad = reconcileBalance(rows, balance);
    // TE's own table and TE's own list can disagree (Barrios Vera 2026: two wins by an opponent's retirement in the
    // list — api-tennis agrees — and 29-29 in the table). Never resolved silently: the player is written, the rows are
    // the record, and every disagreeing cell is carried as `tableMismatch` for the moved-cell report and the drill.
    // A season whose mismatch exceeds 2 matches is a parse problem, not a TE slip: that player is not written.
    const gap = (b) => { const m = b.match(/rows (\d+)\/(\d+) vs table (\d+)\/(\d+)/); return m ? Math.abs(m[1] - m[3]) + Math.abs(m[2] - m[4]) : 99; };
    if (bad.some((b) => gap(b) > 2)) { report.notReconciled.push({ key, slug: p.slug, bad: bad.slice(0, 6) }); continue; }
    if (bad.length) report.tableMismatch.push({ key, slug: p.slug, cells: bad });
    const rec = { key, slug: p.slug, dob: p.dob || null, name: p.name || null, builtAt: idx.builtAt, balance, rows, ...(bad.length ? { tableMismatch: bad } : {}) };
    fs.writeFileSync(path.join(dir, `${key}.json`), serialise(rec));
    idx.players[key] = { slug: p.slug, rows: rows.length, seasons: (p.years || []).length };
    report.written++;
  }
  idx.totalRows = Object.values(idx.players).reduce((s, x) => s + x.rows, 0);
  const n = Object.keys(idx.players).length;
  idx.highWater = { totalRows: Math.max(prev.highWater?.totalRows || 0, idx.totalRows), players: Math.max(prev.highWater?.players || 0, n) };
  fs.writeFileSync(idxF, JSON.stringify(idx, null, 1));
  console.log(JSON.stringify({ players: n, totalRows: idx.totalRows, ...report, notReconciled: report.notReconciled.length, tableMismatch: report.tableMismatch,
    notReconciledList: report.notReconciled.slice(0, 10) }, null, 1));
}
if (import.meta.url === `file://${process.argv[1]}`) main();
