#!/usr/bin/env node
/*
 * fetch-market-size.js — MARKET SIZE data builder (TEN-8)
 *
 * Pulls prediction-market volume for each ATP match on the board from two
 * venues and writes per-match shards the dashboard reads lazily.
 *
 *   Kalshi     — a match is TWO per-player binary markets ("Will X win?").
 *                MARKET SIZE (display) = sum of both legs' volume_24h_fp.
 *                All-time (data only)  = sum of both legs' volume_fp.
 *   Polymarket — a match is one event bundling ~16 markets. Use ONLY the
 *                single market with sportsMarketType == "moneyline".
 *                MARKET SIZE (display) = its volume24hr.
 *                All-time (data only)  = its volume.
 *
 * Both figures are stored per venue (24h shown, all-time carried) so the
 * display basis can be switched on evidence later — cheap to store,
 * impossible to backfill (founder, 2026-07-28).
 *
 * Missing-venue rule: both venues always hold their line. A venue with no
 * market for the match -> present:false (display renders an em dash). The
 * whole section hides only when NEITHER venue has a market.
 *
 * Settlement freeze: once a venue's market has settled (Kalshi legs off
 * 'active' / Polymarket moneyline closed:true), its 24h figure is frozen at
 * that snapshot and never re-queried. A settlement-frozen 24h window is a
 * different object than a live 24h window — both states are flagged per venue.
 *
 * No fabricated data: a field that is absent is written null, never
 * substituted. A market that cannot be confidently matched is dropped
 * (counted separately from "venue has no market").
 *
 * The venue hosts are DNS-poisoned on the founder's LAN, so hostnames are
 * resolved via DoH (Cloudflare) and connected by IP with TLS SNI. In CI DNS
 * is clean; DoH still returns the real IP, so the same path works everywhere.
 * If DoH fails we fall back to system resolution.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT_DIR = process.env.MS_OUT_DIR || 'market';
const INDEX_PATH = process.env.MS_INDEX || 'market-index.json';
const HEALTH_PATH = process.env.MS_HEALTH || 'market-size-health.json';
const KALSHI_HOST = 'api.elections.kalshi.com';
const PM_HOST = 'gamma-api.polymarket.com';
const DATE_WINDOW_DAYS = 2;      // venue event date must be within +/- this of our match
const REQUEST_TIMEOUT_MS = 15000;

/* ------------------------------------------------------------------ *
 *  Name matching  (deaccent + surname-token, order-independent,      *
 *  ambiguity-drop). Modelled on surface-ratings.js deaccent/nameKey. *
 * ------------------------------------------------------------------ */

function deaccent(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Multi-word surnames ("de Minaur", "van Assche", "Pacheco Mendez") are common.
// We reduce a display name to an ordered list of lowercase alpha surname tokens,
// dropping a leading single-letter initial ("A." / "A").
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
function surnameTokens(name) {
  const cleaned = deaccent(name)
    .replace(/\./g, ' ')
    .replace(/[^A-Za-z\s'-]/g, ' ')
    .replace(/[-']/g, ' ')
    .trim();
  let toks = cleaned.split(/\s+/).filter(Boolean).map((t) => t.toLowerCase());
  // drop a leading initial like "A" in "A Bublik"
  if (toks.length > 1 && toks[0].length === 1) toks = toks.slice(1);
  // drop generational suffixes ("Damm Jr" -> "Damm")
  toks = toks.filter((t) => !SUFFIXES.has(t));
  return toks;
}

// Confidence that two names are the same player, from surname tokens.
// 1.0  = identical set, or one side is a trailing slice of the other
//        ("Pacheco Mendez" vs "Mendez", "Damm Jr" vs "Damm")
// 0.85 = the two share a real surname token (len>=4) that is the LAST token
//        of at least one side but not trailing-aligned. Handles venues that
//        truncate a compound surname ("Pacheco Mendez" vs "Rodrigo Pacheco").
//        Only ever decisive at the pair level, where both players must clear
//        the bar and any ambiguity is dropped.
// 0    = no shared surname token
function nameConfidence(a, b) {
  const ta = surnameTokens(a);
  const tb = surnameTokens(b);
  if (!ta.length || !tb.length) return 0;
  if (ta.join(' ') === tb.join(' ')) return 1.0;
  const last = (arr) => arr[arr.length - 1];
  // trailing-slice containment
  const short = ta.length <= tb.length ? ta : tb;
  const long = ta.length <= tb.length ? tb : ta;
  if (long.slice(long.length - short.length).join(' ') === short.join(' ')) return 1.0;
  // shared real surname token, anchored at a last position
  const shared = ta.filter((t) => t.length >= 4 && tb.includes(t));
  if (shared.some((t) => t === last(ta) || t === last(tb))) return 0.85;
  return 0;
}

// Match an unordered player pair {p1,p2} against a venue pair {a,b}.
// Returns { score, orientation } where score is the min of the best
// per-player confidences (both players must match) and orientation tells
// whether venue a maps to our p1 (0) or our p2 (1).
function pairMatch(p1, p2, a, b) {
  const straight = Math.min(nameConfidence(p1, a), nameConfidence(p2, b));
  const swapped = Math.min(nameConfidence(p1, b), nameConfidence(p2, a));
  if (straight >= swapped) return { score: straight, orientation: 0 };
  return { score: swapped, orientation: 1 };
}

const MATCH_THRESHOLD = 0.85; // both players must clear this; ambiguity is dropped

/* ------------------------------------------------------------------ *
 *  DoH-resolved HTTPS GET (JSON)                                      *
 * ------------------------------------------------------------------ */

const _ipCache = new Map();
function resolveDoH(host) {
  if (_ipCache.has(host)) return Promise.resolve(_ipCache.get(host));
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: '1.1.1.1',
        path: `/dns-query?name=${encodeURIComponent(host)}&type=A`,
        headers: { accept: 'application/dns-json' },
        timeout: 8000,
      },
      (res) => {
        let buf = '';
        res.on('data', (d) => (buf += d));
        res.on('end', () => {
          try {
            const j = JSON.parse(buf);
            const ip = (j.Answer || []).find((a) => a.type === 1);
            const val = ip ? ip.data : null;
            if (val) _ipCache.set(host, val);
            resolve(val);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function getJson(host, pathname) {
  const ip = await resolveDoH(host);
  return new Promise((resolve, reject) => {
    const opts = {
      host: ip || host,
      servername: host,
      path: pathname,
      headers: { Host: host, accept: 'application/json', 'user-agent': 'bsp-marketsize/1.0' },
      timeout: REQUEST_TIMEOUT_MS,
    };
    const req = https.request(opts, (res) => {
      let buf = '';
      res.on('data', (d) => (buf += d));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`${host}${pathname} -> ${res.statusCode}`));
        try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`timeout ${host}${pathname}`)); });
    req.end();
  });
}

/* ------------------------------------------------------------------ *
 *  Venue inventory fetchers                                          *
 * ------------------------------------------------------------------ */

const num = (x) => {
  const n = typeof x === 'string' ? parseFloat(x) : x;
  return Number.isFinite(n) ? n : null;
};
function sumNullable(a, b) {
  if (a == null && b == null) return null;
  return (a || 0) + (b || 0);
}

// Kalshi: open KXATPMATCH events, nested markets. Each event = one match,
// two per-player binary markets. event_ticker encodes the date (26JUL26...).
async function fetchKalshiInventory() {
  const j = await getJson(KALSHI_HOST,
    '/trade-api/v2/events?series_ticker=KXATPMATCH&status=open&limit=200&with_nested_markets=true');
  const out = [];
  for (const ev of j.events || []) {
    const title = ev.title || '';
    const vs = title.split(/\s+vs\.?\s+/i);
    if (vs.length !== 2) continue;
    const markets = ev.markets || [];
    const v24 = markets.reduce((s, m) => sumNullable(s, num(m.volume_24h_fp)), null);
    const vAll = markets.reduce((s, m) => sumNullable(s, num(m.volume_fp)), null);
    const settled = markets.length > 0 && markets.every((m) => m.status && m.status !== 'active');
    out.push({
      venue: 'kalshi',
      a: vs[0].trim(), b: vs[1].trim(),
      date: parseKalshiDate(ev.event_ticker),
      ref: ev.event_ticker,
      legs: markets.length,
      v24, vAll, settled,
    });
  }
  return out;
}

// KXATPMATCH-26JUL26BROMOU -> 2026-07-26
const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
function parseKalshiDate(ticker) {
  const m = /-(\d{2})([A-Z]{3})(\d{2})/.exec(ticker || '');
  if (!m) return null;
  return `20${m[1]}-${MONTHS[m[2]] || '01'}-${m[3]}`;
}

// Polymarket: tennis-tag open events; each event bundles ~16 markets.
// Keep only events that look like a singles match ("A vs B") and pull the
// single moneyline market's volume24hr / volume.
async function fetchPolymarketInventory() {
  const out = [];
  for (let off = 0; off < 800; off += 100) {
    let page;
    try {
      page = await getJson(PM_HOST, `/events?tag_slug=tennis&closed=false&limit=100&offset=${off}`);
    } catch { break; }
    if (!Array.isArray(page) || page.length === 0) break;
    for (const ev of page) {
      const title = ev.title || '';
      if (!/ vs\.? /i.test(title)) continue;
      if (/doubles|winner|retire|announce/i.test(title)) continue;
      const ml = (ev.markets || []).find((m) => m.sportsMarketType === 'moneyline');
      if (!ml) continue;
      const players = title.includes(':') ? title.split(':').slice(1).join(':') : title;
      const vs = players.split(/\s+vs\.?\s+/i);
      if (vs.length !== 2) continue;
      out.push({
        venue: 'polymarket',
        a: vs[0].trim(), b: vs[1].trim(),
        tournament: title.includes(':') ? title.split(':')[0].trim() : '',
        date: (ev.startDate || ev.startTime || '').slice(0, 10) || null,
        ref: ml.id || ev.id,
        v24: num(ml.volume24hr), vAll: num(ml.volume),
        settled: ml.closed === true,
      });
    }
    if (page.length < 100) break;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Matching a match to a venue inventory                            *
 * ------------------------------------------------------------------ */

function withinDateWindow(matchDate, venueDate) {
  if (!matchDate || !venueDate) return true; // Kalshi surname-only has a date; be lenient if missing
  const a = new Date(matchDate + 'T00:00:00Z').getTime();
  const b = new Date(venueDate + 'T00:00:00Z').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return Math.abs(a - b) <= DATE_WINDOW_DAYS * 86400000;
}

// Returns { status, entry } where status is one of:
//   'matched'   — one confident, unambiguous market found
//   'absent'    — no candidate market for this pair on this venue
//   'ambiguous' — candidate(s) found but not confidently/uniquely joinable
function matchVenue(match, inventory) {
  // 1) Name match first (both players must clear the bar), date-INDEPENDENT.
  //    A player pair is unique within a tournament, so a confident unique name
  //    match is safe to take even when the board's date and the venue's date
  //    disagree (measured failure mode: board dates Los Cabos R1 three days
  //    after both venues do, which the old ±2-day PRE-filter turned into a miss).
  const cands = [];
  for (const it of inventory) {
    const pm = pairMatch(match.p1, match.p2, it.a, it.b);
    if (pm.score >= MATCH_THRESHOLD) cands.push({ it, score: pm.score });
  }
  if (cands.length === 0) {
    // was there any near-miss (shared one surname)?
    const near = inventory.some((it) => {
      const pm = pairMatch(match.p1, match.p2, it.a, it.b);
      return pm.score > 0 && pm.score < MATCH_THRESHOLD;
    });
    return { status: near ? 'ambiguous' : 'absent', entry: null };
  }
  // 2) Unique name match -> take it.
  if (cands.length === 1) return { status: 'matched', entry: cands[0].it };
  // 3) Multiple name matches -> NOW use the date window to disambiguate; a
  //    single survivor is a confident join, otherwise drop (never guess).
  const dated = cands.filter((c) => withinDateWindow(match.date, c.it.date));
  if (dated.length === 1) return { status: 'matched', entry: dated[0].it };
  return { status: 'ambiguous', entry: null };
}

/* ------------------------------------------------------------------ *
 *  Shard read/write with settlement freeze                          *
 * ------------------------------------------------------------------ */

function eventKeyOf(match) {
  const id = String(match.id || '');
  const i = id.indexOf('-');
  return i >= 0 ? id.slice(i + 1) : id;
}

function readExistingShard(dir, key) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, `${key}.json`), 'utf8')); }
  catch { return null; }
}

// Build a per-venue block, honouring settlement freeze from the prior shard.
function venueBlock(matchResult, prior, capturedAt) {
  // prior already settled/frozen -> carry it forward untouched
  if (prior && prior.settled && prior.frozenAt) return prior;

  if (matchResult.status === 'absent') {
    return { present: false, matched: false, reason: 'no_market' };
  }
  if (matchResult.status === 'ambiguous') {
    // A market may exist but we would not stake a display on a guess.
    return { present: false, matched: false, reason: 'matcher_failed' };
  }
  const e = matchResult.entry;
  const block = {
    present: true,
    matched: true,
    marketSize24h: e.v24,      // display basis
    marketSizeAllTime: e.vAll, // data only, admin surfaces it
    ref: e.ref,
    settled: !!e.settled,
  };
  if (e.settled) block.frozenAt = capturedAt; // freeze the 24h figure now
  return block;
}

/* ------------------------------------------------------------------ *
 *  Main                                                             *
 * ------------------------------------------------------------------ */

function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

async function main() {
  const args = process.argv.slice(2);
  const slatePath = argVal(args, '--slate') || 'matches.json';
  const outDir = argVal(args, '--out') || OUT_DIR;
  const measureOnly = args.includes('--measure');
  const capturedAt = new Date().toISOString();

  console.error(`[market-size] resolving venues via DoH...`);
  const [kInv, pInv] = await Promise.all([
    fetchKalshiInventory().catch((e) => { console.error('kalshi:', e.message); return []; }),
    fetchPolymarketInventory().catch((e) => { console.error('polymarket:', e.message); return []; }),
  ]);
  console.error(`[market-size] kalshi events=${kInv.length}  polymarket singles=${pInv.length}`);

  if (measureOnly) return measure(kInv, pInv);

  const slate = JSON.parse(fs.readFileSync(slatePath, 'utf8'));
  const matches = slate.filter((m) => String(m.id || '').startsWith('upcoming-') ||
                                       String(m.id || '').startsWith('past-'));

  fs.mkdirSync(outDir, { recursive: true });
  const index = [];
  const counters = {
    total: 0,
    kalshi: { matched: 0, no_market: 0, matcher_failed: 0 },
    polymarket: { matched: 0, no_market: 0, matcher_failed: 0 },
    both_present: 0, neither_present: 0,
  };
  const divergence = []; // for admin: 24h vs all-time per matched market

  for (const m of matches) {
    counters.total++;
    const key = eventKeyOf(m);
    const prior = readExistingShard(outDir, key);
    const kRes = matchVenue(m, kInv);
    const pRes = matchVenue(m, pInv);
    tally(counters.kalshi, kRes.status);
    tally(counters.polymarket, pRes.status);

    const kBlock = venueBlock(kRes, prior && prior.venues && prior.venues.kalshi, capturedAt);
    const pBlock = venueBlock(pRes, prior && prior.venues && prior.venues.polymarket, capturedAt);

    if (kBlock.present && pBlock.present) counters.both_present++;
    if (!kBlock.present && !pBlock.present) { counters.neither_present++; continue; } // section hides -> no shard

    const shard = {
      eventKey: key, matchId: m.id, capturedAt,
      p1: m.p1, p2: m.p2, tour: m.tour, date: m.date,
      venues: { kalshi: kBlock, polymarket: pBlock },
    };
    writeJsonAtomic(path.join(outDir, `${key}.json`), shard);
    index.push(key);

    for (const [vn, b] of [['kalshi', kBlock], ['polymarket', pBlock]]) {
      if (b.present && b.marketSize24h != null && b.marketSizeAllTime != null) {
        divergence.push({ key, tour: m.tour, match: `${m.p1} vs ${m.p2}`, venue: vn,
          v24: b.marketSize24h, allTime: b.marketSizeAllTime,
          ratio: b.marketSizeAllTime > 0 ? +(b.marketSize24h / b.marketSizeAllTime).toFixed(3) : null,
          settled: !!b.settled });
      }
    }
  }

  writeJsonAtomic(INDEX_PATH_resolved(outDir), index.sort());
  writeJsonAtomic(HEALTH_PATH, { generatedAt: capturedAt, counters, divergence });

  console.error(`[market-size] wrote ${index.length} shards`);
  console.error(JSON.stringify(counters, null, 2));
}

function INDEX_PATH_resolved(outDir) {
  // index lives beside the shards' parent (site root), matching odds-index.json
  return INDEX_PATH;
}

function tally(bucket, status) {
  if (status === 'matched') bucket.matched++;
  else if (status === 'absent') bucket.no_market++;
  else if (status === 'ambiguous') bucket.matcher_failed++;
}

function argVal(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

/* --measure : cross-match the two live venue inventories against each other.
 * This isolates matcher quality from board-slate staleness: every Kalshi
 * event that also exists on Polymarket SHOULD join; failures are pure
 * matcher misses. Prints measured rates instead of the estimates. */
function measure(kInv, pInv) {
  let joined = 0, failedAmbiguous = 0;
  const misses = [], noMarket = [];
  for (const k of kInv) {
    const cands = pInv.filter((p) => pairMatch(k.a, k.b, p.a, p.b).score >= MATCH_THRESHOLD);
    if (cands.length === 1) joined++;
    else if (cands.length === 0) {
      // near-miss: shares a single surname -> a human might call it the same match
      const near = pInv.find((p) => {
        const s = Math.max(nameConfidence(k.a, p.a), nameConfidence(k.a, p.b),
                           nameConfidence(k.b, p.a), nameConfidence(k.b, p.b));
        return s >= 0.7;
      });
      if (near) { failedAmbiguous++; misses.push(`${k.a} vs ${k.b}  ~?  ${near.a} vs ${near.b}`); }
      else noMarket.push(`${k.a} vs ${k.b}`);
    } else {
      failedAmbiguous++; misses.push(`${k.a} vs ${k.b}  -> ${cands.length} PM candidates`);
    }
  }
  const overlap = joined + failedAmbiguous;
  console.error('\n=== MATCHER MEASUREMENT (Kalshi x Polymarket, same-time live) ===');
  console.error(`Kalshi events: ${kInv.length}   Polymarket singles: ${pInv.length}`);
  console.error(`Confident 1:1 joins: ${joined}`);
  console.error(`Failed/ambiguous where a human match plausibly exists: ${failedAmbiguous}`);
  console.error(`Measured matcher failure rate over overlap: ${overlap ? (100 * failedAmbiguous / overlap).toFixed(1) : 'n/a'}%  (${failedAmbiguous}/${overlap})`);
  if (misses.length) { console.error('--- misses (verify each is a real miss) ---'); misses.forEach((x) => console.error('  ' + x)); }
  console.error(`Kalshi events with NO Polymarket counterpart (true coverage gap, hand-verify): ${noMarket.length}`);
  noMarket.forEach((x) => console.error('  [gap] ' + x));
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
