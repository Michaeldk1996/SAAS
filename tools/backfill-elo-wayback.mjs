#!/usr/bin/env node
// TEN-263 Part 2 (founder-approved 2026-09-24): ONE-TIME backfill of archived Tennis Abstract ATP Elo
// reports from the Wayback Machine into elo-history.json, so Form / H2H rows older than the first
// weekly scrape (2026-07-18) can carry the opponent's Elo at the match date.
//
//   node tools/backfill-elo-wayback.mjs [--history elo-history.json] [--out <path>] [--cache tml-cache/wayback]
//                                       [--cdx <path>] [--offline] [--stats <path>]
//
// Founder's rules, each enforced below:
//   1. every parseable Wayback capture before the first live snapshot is backfilled;
//   2. asOf = the UTC day of the Wayback capture timestamp, NEVER TA's printed "Last update" label:
//      a report is never used before it provably existed;
//   3. each archived snapshot stores source 'wayback', captureUrl (the id_ URL actually fetched),
//      captureTimestamp (14 digits), taLastUpdate (TA's label or null), players (rows parsed),
//      ratings, ambiguous (keys 2+ players share WITHIN THAT report), generatedAt null;
//   4. several captures of the same report (same label AND identical ratings) keep the EARLIEST;
//      a capture whose ratings equal the previous kept snapshot's is not a new snapshot;
//   5. older page layouts (2016-2024) are read by a separate, header-verified parser (see below);
//   6. fetches are rate-limited (>= 1.5 s apart), retried with backoff on 429/5xx, raw id_ captures,
//      every fetched body cached so a rerun never refetches;
//   7. a key two players share inside an archived report never resolves (per-report `ambiguous`).
// The git-backfilled / live snapshots are never re-dated or re-rated: they only gain source 'git' and
// taLastUpdate (from a Wayback capture with IDENTICAL ratings, if any; else null).
// Idempotent: a second run over its own output changes nothing.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import https from 'node:https';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const TARGET = 'tennisabstract.com/reports/atp_elo_ratings.html';
const CDX_URL = `https://web.archive.org/cdx/search/cdx?url=${TARGET}&output=json&fl=timestamp,statuscode,digest,length,original,mimetype`;
const MIN_GAP_MS = 1500;

// ---- name key: keep in sync with fetch-elo.js eloNorm()/eloKey() and the dashboard's fhEloKey() ----
function eloNorm(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&nbsp;/g, ' ')
    .replace(/['’]/g, '')
    .replace(/[.\-]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
export function eloKey(name) {
  const p = eloNorm(name).split(' ').filter(Boolean);
  if (p.length < 2) return null;
  return p[p.length - 1] + '|' + p[0][0];
}

// ---- CURRENT layout (Nov 2024 onward): the row regex of fetch-elo.js, copied verbatim.
// keep in sync with fetch-elo.js (const re = ...). Group 2 = name, group 4 = overall Elo.
const CURRENT_ROW_RE = /player\.cgi\?p=([^"]+)">([^<]+)<\/a><\/td><td[^>]*>([\d.]*)<\/td><td[^>]*>([\d.]+)<\/td><td>\s*<\/td><td[^>]*>(\d+)<\/td><td[^>]*>([\d.]+)<\/td><td[^>]*>(\d+)<\/td><td[^>]*>([\d.]+)<\/td><td[^>]*>(\d+)<\/td><td[^>]*>([\d.]+)<\/td>(?:<td>\s*<\/td><td[^>]*>([\d.]*)<\/td><td[^>]*>(\d{4}-\d{2})<\/td>)?/g;
const CURRENT_HEAD = ['Elo Rank', 'Player', 'Age', 'Elo'];
export function parseCurrentRows(html) {
  const rows = []; let m; CURRENT_ROW_RE.lastIndex = 0;
  while ((m = CURRENT_ROW_RE.exec(html))) {
    const overall = parseFloat(m[4]);
    if (Number.isFinite(overall)) rows.push({ name: m[2].replace(/&nbsp;/g, ' ').trim(), overall });
  }
  return rows;
}

// ---- LEGACY layouts (2016 - Sep 2024). The table differs by year AFTER the fourth cell:
//   2016-2017   Rank | Player | Age | Elo | (spacer) | Peak Match | Peak Age | Peak Elo
//   2018-2019   Rank | Player | Age | Elo | (spacer) | Hard | Clay | Grass | (spacer) | Peak Match | Peak Age | Peak Elo
//   2020-2024   Rank | Player | Age | Elo | (spacer) | HardRaw | ClayRaw | GrassRaw | (spacer) | hElo | cElo | gElo | (spacer) | Peak ...
// but the first four header cells are the same in every year: Rank, Player, Age, Elo. This parser reads
// ONLY those four cells, and only on a page whose first four <th> read exactly that (checked in
// parseReport), so it can never read a surface or peak column as the overall Elo.
// Verified cell by cell (Wayback 20160226012703, "Last update: 2016-02-22"):
//   <td align="right">1</td>                  cell 0 Rank      -> 1        (rank, used only for the order check)
//   <td align="left"><a href="...player.cgi?p=NovakDjokovic">Novak&nbsp;Djokovic</a></td>
//                                             cell 1 Player    -> "Novak Djokovic" -> key djokovic|n
//   <td align="right">28.7</td>               cell 2 Age       -> not read
//   <td align="right">2556.2</td>             cell 3 Elo       -> 2556 (overall Elo, rounded like fetch-elo.js)
//   <td align="right"></td>                   cell 4 spacer    -> not read
//   <td align="left">2016 Australian Open F</td> ... Peak Match / Peak Age / Peak Elo -> not read
const LEGACY_ROW_RE = /<td[^>]*>(\d+)<\/td><td[^>]*><a [^>]*player\.cgi\?p=([^"]+)">([^<]+)<\/a><\/td><td[^>]*>([\d.]*)<\/td><td[^>]*>([\d.]+)<\/td>/g;
const LEGACY_HEAD = ['Rank', 'Player', 'Age', 'Elo'];
export function parseLegacyRows(html) {
  const rows = []; let m; LEGACY_ROW_RE.lastIndex = 0;
  while ((m = LEGACY_ROW_RE.exec(html))) {
    const overall = parseFloat(m[5]);
    if (Number.isFinite(overall)) rows.push({ rank: +m[1], name: m[3].replace(/&nbsp;/g, ' ').trim(), overall });
  }
  return rows;
}

export function headerCells(html, n = 4) {
  const out = []; const re = /<th[^>]*>([\s\S]*?)<\/th>/g; let m;
  while ((m = re.exec(html)) && out.length < n) out.push(m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
  return out;
}

// parseReport(html) -> { taLastUpdate, players, ratings, ambiguous, layout }. players 0 = unparseable.
export function parseReport(html) {
  html = String(html || '');
  const lu = /Last update:\s*(\d{4}-\d{2}-\d{2})/.exec(html);          // same label regex as fetch-elo.js
  const taLastUpdate = lu ? lu[1] : null;
  const head = headerCells(html).join(' | ');
  let layout = null, rows = [];
  if (head === CURRENT_HEAD.join(' | ')) { layout = 'current'; rows = parseCurrentRows(html); }
  else if (head === LEGACY_HEAD.join(' | ')) {
    layout = 'legacy'; rows = parseLegacyRows(html);
    // Order check: ranks must run 1..n in row order, else the table is not what the map above says.
    if (!rows.every((r, i) => r.rank === i + 1)) { layout = 'legacy-rank-mismatch'; rows = []; }
  }
  const ratings = {}, count = {};
  for (const r of rows) {
    const k = eloKey(r.name); if (!k) continue;
    ratings[k] = Math.round(r.overall);                                   // last row wins, as fetch-elo.js
    count[k] = (count[k] || 0) + 1;
  }
  const ambiguous = Object.keys(count).filter(k => count[k] > 1).sort();
  return { taLastUpdate, players: rows.length, ratings, ambiguous, layout };
}

const sig = r => JSON.stringify(Object.keys(r || {}).sort().map(k => [k, r[k]]));
export const sameRatings = (a, b) => sig(a) === sig(b);
export const tsDay = ts => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;   // Wayback timestamps are UTC

// dedupeCaptures(list): list of parsed captures {captureTimestamp, captureUrl, taLastUpdate, players,
// ratings, ambiguous}. Returns archived snapshots in asOf order, plus `dropped` reasons on the array.
export function dedupeCaptures(list) {
  const caps = list.filter(c => c && c.players > 0 && /^\d{14}$/.test(c.captureTimestamp))
    .slice().sort((a, b) => a.captureTimestamp.localeCompare(b.captureTimestamp));
  const seen = new Set(), kept = [], dropped = { sameReport: 0, samePrevRatings: 0, labelRegressed: 0, sameDayReplaced: 0 };
  let maxLabel = null;
  for (const c of caps) {
    const id = (c.taLastUpdate || '') + '\u0000' + sig(c.ratings);
    if (seen.has(id)) { dropped.sameReport++; continue; }                  // rule 4: earliest capture kept
    seen.add(id);
    const prev = kept[kept.length - 1];
    if (prev && sameRatings(prev.ratings, c.ratings)) { dropped.samePrevRatings++; continue; }
    // A capture printing an OLDER label than one already kept is a stale copy of a superseded report:
    // the newer report provably existed first, so the stale one must not take over its days.
    if (maxLabel && c.taLastUpdate && c.taLastUpdate < maxLabel) { dropped.labelRegressed++; continue; }
    if (c.taLastUpdate && (!maxLabel || c.taLastUpdate > maxLabel)) maxLabel = c.taLastUpdate;
    const snap = {
      asOf: tsDay(c.captureTimestamp),                                     // rule 2: capture day, not label
      generatedAt: null,
      source: 'wayback',
      captureUrl: c.captureUrl,
      captureTimestamp: c.captureTimestamp,
      taLastUpdate: c.taLastUpdate || null,
      players: c.players,
      ratings: c.ratings,
      ambiguous: [...(c.ambiguous || [])].sort(),
    };
    // Two different reports captured the same UTC day: the later one replaces the earlier, as a
    // same-day re-scrape does in build-elo-history.mjs (one snapshot per asOf).
    if (prev && prev.asOf === snap.asOf) { kept[kept.length - 1] = snap; dropped.sameDayReplaced++; }
    else kept.push(snap);
  }
  Object.defineProperty(kept, 'dropped', { value: dropped, enumerable: false });
  return kept;
}

// mergeArchived(hist, archived): prepends archived snapshots dated before the first non-wayback
// snapshot. Existing snapshots keep asOf/ratings/ambiguous; non-wayback ones gain source 'git'.
// Pure: returns a new history object.
export function mergeArchived(hist, archived) {
  const snaps = (hist && hist.snapshots) || [];
  const live = snaps.filter(s => s.source !== 'wayback').map(s => ('source' in s ? s : { ...s, source: 'git' }));
  const first = live.length ? live[0].asOf : '9999-12-31';
  const have = new Map(snaps.filter(s => s.source === 'wayback').map(s => [s.captureTimestamp, s]));
  for (const a of archived || []) if (a.asOf < first && !have.has(a.captureTimestamp)) have.set(a.captureTimestamp, a);
  const wb = [...have.values()].sort((x, y) => x.asOf.localeCompare(y.asOf) || x.captureTimestamp.localeCompare(y.captureTimestamp));
  return { ...hist, snapshots: [...wb, ...live] };
}

// labelLiveSnapshots(hist, captures): a non-wayback snapshot with no taLastUpdate yet takes the label of
// a Wayback capture (any date) whose parsed ratings are IDENTICAL; else null. Never touches asOf/ratings,
// never overwrites a label already present (the live scraper records its own from Part 1 on).
export function labelLiveSnapshots(hist, captures) {
  const bySig = new Map();
  for (const c of [...(captures || [])].sort((a, b) => a.captureTimestamp.localeCompare(b.captureTimestamp)))
    if (c.players > 0 && !bySig.has(sig(c.ratings))) bySig.set(sig(c.ratings), c);
  return { ...hist, snapshots: hist.snapshots.map(s => {
    if (s.source === 'wayback' || 'taLastUpdate' in s) return s;
    const c = bySig.get(sig(s.ratings));
    return c ? { ...s, taLastUpdate: c.taLastUpdate, taLastUpdateFrom: `wayback ${c.captureTimestamp} (identical ratings)` }
             : { ...s, taLastUpdate: null };
  }) };
}

// ------------------------------------------------------------------ network (CLI only)
const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastReq = 0;
function getRaw(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'stennisfy-elo-backfill (one-time; TEN-263)' }, timeout: 90000 }, res => {
      const chunks = []; res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', e => resolve({ status: 0, error: String(e) }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', e => resolve({ status: 0, error: String(e) }));
  });
}
async function politeGet(url, log) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = lastReq + MIN_GAP_MS - Date.now(); if (wait > 0) await sleep(wait);
    lastReq = Date.now();
    const r = await getRaw(url);
    if (r.status === 200) return r;
    const retry = r.status === 0 || r.status === 429 || r.status >= 500;
    log(`  ${r.status || r.error} on ${url}${retry ? ` (retry ${attempt + 1})` : ''}`);
    if (!retry) return r;
    await sleep(r.status === 429 ? 60000 * (attempt + 1) : 5000 * 2 ** attempt);
  }
  return { status: -1 };
}
const b32 = buf => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, v = 0, o = '';
  for (const x of buf) { v = (v << 8) | x; bits += 8; while (bits >= 5) { o += A[(v >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) o += A[(v << (5 - bits)) & 31]; return o; };
function decode(buf, enc) {
  if (buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd) return zlib.zstdDecompressSync(buf);
  if (buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf);
  if (/br/.test(enc || '')) { try { return zlib.brotliDecompressSync(buf); } catch {} }
  return buf;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const HIST = opt('--history', 'elo-history.json');
  const OUT = opt('--out', HIST);
  const CACHE = opt('--cache', path.join('tml-cache', 'wayback'));
  const CDX = opt('--cdx', path.join(CACHE, 'cdx.json'));
  const STATS = opt('--stats', null);
  const offline = args.includes('--offline');
  const log = s => console.log(s);
  fs.mkdirSync(CACHE, { recursive: true });

  if (!fs.existsSync(CDX)) {
    if (offline) throw new Error(`no CDX at ${CDX} and --offline`);
    const r = await politeGet(CDX_URL, log);
    if (r.status !== 200) throw new Error('CDX fetch failed: ' + r.status);
    fs.writeFileSync(CDX, r.body);
  }
  const cdx = JSON.parse(fs.readFileSync(CDX, 'utf8'));
  const cols = cdx[0]; const I = k => cols.indexOf(k);
  const rows = cdx.slice(1).map(r => ({ ts: r[I('timestamp')], status: r[I('statuscode')], digest: r[I('digest')], original: r[I('original')] || `https://${TARGET}` }));
  const ok = rows.filter(r => r.status === '200').sort((a, b) => a.ts.localeCompare(b.ts));
  // One fetch per distinct payload digest (byte-identical captures), the EARLIEST capture of it.
  const firstOfDigest = new Map(); for (const r of ok) if (!firstOfDigest.has(r.digest)) firstOfDigest.set(r.digest, r);
  log(`CDX: ${rows.length} rows, ${ok.length} status 200, ${firstOfDigest.size} distinct payloads.`);

  const perCapture = [], parsedByDigest = new Map();
  let fetchedNow = 0, digestOk = 0, digestBad = 0;
  for (const [digest, r] of firstOfDigest) {
    const url = `https://web.archive.org/web/${r.ts}id_/${r.original}`;
    const file = path.join(CACHE, `${r.ts}.html`);
    let html = null, note = 'cached';
    if (fs.existsSync(file)) html = fs.readFileSync(file, 'utf8');
    else if (!offline) {
      const res = await politeGet(url, log);
      if (res.status === 200) {
        const h = b32(crypto.createHash('sha1').update(res.body).digest());
        if (h === digest) digestOk++; else digestBad++;
        html = decode(res.body, res.headers['content-encoding']).toString('utf8');
        fs.writeFileSync(file, html); fetchedNow++; note = `fetched (sha1 ${h === digest ? 'matches' : 'differs from'} CDX digest)`;
      } else note = `fetch failed ${res.status}`;
    } else note = 'not cached (offline)';
    const p = html ? parseReport(html) : null;
    parsedByDigest.set(digest, { r, url, p, note });
    log(`${r.ts} ${note} layout=${p ? p.layout : '-'} label=${p ? p.taLastUpdate : '-'} players=${p ? p.players : '-'}`);
  }
  for (const r of ok) {
    const d = parsedByDigest.get(r.digest);
    const own = d.r.ts === r.ts;
    perCapture.push({ captureTimestamp: r.ts, digest: r.digest, fetched: own && !!d.p, sameAs: own ? null : d.r.ts,
      captureUrl: own ? d.url : `https://web.archive.org/web/${r.ts}id_/${r.original}`, ...(d.p || { players: 0, ratings: {}, ambiguous: [], taLastUpdate: null, layout: null }) });
  }
  const hist = JSON.parse(fs.readFileSync(HIST, 'utf8'));
  const first = hist.snapshots.find(s => s.source !== 'wayback').asOf;
  const before = perCapture.filter(c => tsDay(c.captureTimestamp) < first);
  const archived = dedupeCaptures(before);
  let merged = mergeArchived(hist, archived);
  merged = labelLiveSnapshots(merged, perCapture);
  const text = JSON.stringify(merged);
  const changed = !fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== text;
  if (changed) { const tmp = OUT + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, OUT); }
  log(`fetched now ${fetchedNow} (sha1 = CDX digest on ${digestOk}, differs on ${digestBad}); captures before ${first}: ${before.length}, parsed ${before.filter(c => c.players > 0).length}; kept ${archived.length} (dropped ${JSON.stringify(archived.dropped)}).`);
  log(`${OUT}: ${merged.snapshots.length} snapshots (${merged.snapshots.filter(s => s.source === 'wayback').length} wayback), ${changed ? 'written' : 'unchanged'}.`);
  if (STATS) fs.writeFileSync(STATS, JSON.stringify({ first, perCapture: perCapture.map(({ ratings, ...c }) => ({ ...c, nKeys: Object.keys(ratings).length })), kept: archived.map(s => s.captureTimestamp), dropped: archived.dropped }, null, 1));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.stack || String(e)); process.exit(1); });
}
