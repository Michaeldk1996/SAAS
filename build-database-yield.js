#!/usr/bin/env node
/*
 * build-database-yield.js  (TEN-146)
 * ----------------------------------
 * Precompute the Database-tab artefact: one compact match-level base file
 * (Tour + Tournaments views) plus a lazy player-names shard (Players view).
 *
 * ALL methodology is the founder's locked TEN-146 ruling, with the book rule replaced by
 * TEN-384 (2026-10-07, option "me") — do not re-litigate here.
 *
 *   Book:      the Market edge price join, PER ROW, for every season: Pinnacle closing
 *              (psw/psl) when both Pinnacle prices are valid, else Bet365 closing
 *              (b365w/b365l) when both of those are — build-market-edge.js pickBook.
 *              No Avg tier, no other book. A row with no valid pair on either book is
 *              DROPPED (`noResolvingBookPrice`, e.g. all of 2009). The source's Pinnacle
 *              prices stop on meta.pinnacleLastPriced (2026-01-13), so Bet365 prices
 *              every later row; there is no season seam. Each row carries the book used.
 *              This supersedes TEN-146/TEN-262 "one book per season, never fill a
 *              missing Pinnacle price from another book".
 *   Results:   completed matches only; retirements VOIDED on the Database (2026-09-20, below);
 *              walkovers excluded; edge non-results (Awarded/Disqualified/Sched) excluded.
 *   Retired:   TEN-402 founder ruling (2026-10-08): the same join prices retirements for the
 *              Head to Head page and the Player Profile per-event Backing, settled on the
 *              official ATP result (the archive's winner column). They ride BEHIND A FLAG:
 *              `retRows` / `retNames`, outside `rows` / `names`, priced and filtered exactly
 *              as a used row (book, tie, overround, window, level). The Database page never
 *              reads them, so every Database figure (and tour-baselines.json,
 *              tournament-market.json) is unchanged; `exclusions.retired` still counts them.
 *   Ties:      an exact resolving-price tie is no favourite and no underdog, so it is out of every Database
 *              figure (`exclusions.exactTie` counts it). Founder ruling 2026-10-16 ("keep tied prices, exclude
 *              them only from favourite/underdog figures"): a tie that passes every other filter (overround,
 *              window, level, date) rides BEHIND A FLAG like a retirement — `tieRows` / `tieNames`, read only
 *              by the site's one price join (DatabaseTab.priceRows), which prices both players at the tie.
 *   Overround: 1/pw + 1/pl > 1.15 excluded (corrupt-market hygiene).
 *   Fav/dog:   shorter price is the favourite.
 *   Levels:    8 raw series -> 5 canonical.
 *   Window:    season >= 2010, fail-closed, NO pre-window fallback (founder ruling,
 *              Option A, 2026-09-04): 2004-2008 is a materially different sport, so a
 *              blended yield across it prices a market that no longer exists. Pre-2010
 *              rows that would otherwise be usable land in the `preWindow` bucket.
 *   Scope:     ATP tour only (the archive carries nothing else).
 *
 * Every archive row lands in exactly one bucket (used or one exclusion reason) so the
 * footnote reconciles with no unexplained gap.
 *
 * Emits (additive, unreferenced until the Database tab flag is flipped on):
 *   database-yield.json          base, no names   (Tour + Tournaments)
 *   database-yield-players.json  winner/loser names, parallel to base rows (Players, lazy)
 *   tour-baselines.json          TEN-384: the player profile's Market edge tour baselines
 *                                (All · Favourite · Underdog), < 10 KB — computed from the
 *                                SAME rows as database-yield.json, so they equal the
 *                                Database Tour aggregates (one join, no alternative basis).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ARCHIVE_DIR = process.env.DB_YIELD_ARCHIVE_DIR || path.join(__dirname, 'odds-archive');
const OUT_DIR = process.env.DB_YIELD_OUT_DIR || __dirname;
const OUT_BASE = path.join(OUT_DIR, 'database-yield.json');
const OUT_NAMES = path.join(OUT_DIR, 'database-yield-players.json');
const OUT_BASELINES = path.join(__dirname, 'tour-baselines.json');
const BASELINES_OUT = process.env.DB_YIELD_OUT_DIR ? path.join(OUT_DIR, 'tour-baselines.json') : OUT_BASELINES;   // tests write elsewhere
// Founder brief 2026-10-14 (F3c): our Pinnacle closes are fed into this archive. The feed is a Tennis-Data-shaped CSV
// written every pipeline run by `tools/pinarch.py td-feed` from the permanent Pinnacle archive (Supabase): `override`
// rows give a Tennis-Data 2026 row with NO Pinnacle pair our archive's Pinnacle close (same date, tournament, winner,
// loser — the row is otherwise untouched; a Tennis-Data Pinnacle price is never replaced); `add` rows are ATP main-draw
// matches after the Tennis-Data file's last day, built from api-tennis's result and the event's previous Tennis-Data
// edition, priced on our Pinnacle close. No feed file = the Tennis-Data archive alone (byte-identical to before).
const FEED = process.env.DB_YIELD_FEED || path.join(__dirname, 'pinnacle-archive-td.csv');
// --- Pinnacle (approx.) (founder ruling 2026-10-16) — optional feed ----------------------------------------------
// written every pipeline run by `tools/tdarch.py approx-feed` from the historical archive's snapshot table: api-tennis's
// stored Pinnacle price for an ATP main-draw match of 13 Jan - 16 Sep 2026 with no Tennis-Data Pinnacle pair. A SNAPSHOT
// (no timestamp), never a close: book index 2, its own name. Order per row: Tennis-Data Pinnacle > our archive's close
// (the td-feed override) > Pinnacle (approx.) > Bet365. No file = no row on book 2 (byte-identical to before).
const APPROX_FEED = process.env.DB_YIELD_APPROX || path.join(__dirname, 'pinnacle-approx.csv');
const APPROX_COLS = ['date', 'tournament', 'winner', 'loser', 'psw', 'psl', 'eventKey', 'snapshotId'];
const APPROX_HOVER = 'Pinnacle snapshot from api-tennis, no timestamp, not a confirmed close';

// --- TEN-384 · the price join (founder ruling 2026-10-07, option "me") --------
// The profile's tour baselines ("the same price join as Market edge (Pinnacle, else Bet365)")
// and the Database ("equal the Database Tour aggregates") used to disagree, because this
// builder priced one book per season. The founder chose the Market edge join for BOTH, so
// there is one join and no --baseline-basis flag: database-yield.json rows and
// tour-baselines.json are the same rows priced the same way.
const PRICE_RULE = 'Pinnacle closing, else Bet365 closing, per row (build-market-edge.js pickBook)';

// --- locked canonical level map (8 raw -> 5) --------------------------------
const LEVEL_MAP = {
  'Grand Slam': 'Grand Slam',
  'Masters 1000': 'Masters 1000',
  'Masters': 'Masters 1000',
  'ATP500': 'ATP 500',
  'International Gold': 'ATP 500',
  'ATP250': 'ATP 250',
  'International': 'ATP 250',
  'Masters Cup': 'Finals',
};
const LEVEL_ORDER = ['Grand Slam', 'Masters 1000', 'ATP 500', 'ATP 250', 'Finals'];

// comment classification
//
// FOUNDER RULING 2026-09-20: "Void them — match what books actually do."
// A retirement is VOIDED, not settled. Most books void the match market when a
// player retires, so a figure that settles those rows prices a bet the reader
// could never have had. Retirements used to be inside RESULT_STANDS.
//
// Measured before the change (2010+ store, 41,667 rows): 1,278 retirements,
// 3.07% of the store. NOTE the direction, because the intuition runs the other
// way: the favourite is credited the win in only 58.8% of retirements against
// 69.5% overall, so retirements were disproportionately UNDERDOG results.
// Voiding them therefore moves roiFav UP (+0.40pp) and roiDog DOWN (-1.50pp) —
// it does not flatter favourites, it stops flattering underdogs.
const RESULT_STANDS = new Set(['Completed']);
const RETIRED = new Set(['Retired', 'Rrtired']);   // Rrtired = Retired typo in the source
const WALKOVER = new Set(['Walkover']);
// everything else non-Completed (Awarded/Disqualified/Sched) => edge non-result, excluded

function num(x) {
  if (x === undefined || x === null) return NaN;
  const s = String(x).trim();
  if (s === '') return NaN;
  const v = Number(s);
  return Number.isFinite(v) ? v : NaN;
}
function validPrice(p) { return Number.isFinite(p) && p > 1.0; }

// --- read archive -----------------------------------------------------------
const files = fs.readdirSync(ARCHIVE_DIR).filter(f => /^\d{4}\.csv$/.test(f)).sort();
if (!files.length) { console.error('no archive csv files found'); process.exit(1); }

// dictionaries (order = insertion, stable)
const levels = [...LEVEL_ORDER];
const surfaces = [];
const rounds = [];
const tournaments = [];
const idxOf = (arr, v) => { let i = arr.indexOf(v); if (i < 0) { i = arr.length; arr.push(v); } return i; };

const BOOKS = ['Pinnacle', 'Bet365', 'Pinnacle (approx.)']; // idx 0,1,2 (2 = a snapshot, never a close: founder 2026-10-16)
// Founder ruling 2026-10-16 (round 3, item 1): OUR Pinnacle closes (the permanent Pinnacle archive, fed in by td-feed)
// carry their own codes so every surface names their source: 3 = 'from Pinnacle history', 4 = 'captured'. Both are
// Pinnacle closing prices: every Pinnacle count, yield and figure counts them as Pinnacle (prices unchanged).
const ARCH_BOOK = { 'from Pinnacle history': 3, captured: 4 };
const isPinIdx = i => i === 0 || i === 3 || i === 4;

const rows = [];      // [dateInt, lvlIdx, surfIdx, rndIdx, tourIdx, favPrice, dogPrice, favWon, bookIdx]
const names = [];     // [winnerName, loserName] parallel to rows
// TEN-402 (2026-10-08): retirements priced on the same join, settled on the ATP result (favWon = the
// archive's winner held the shorter price). Same row shape as `rows`; never in `rows`. Dictionary
// indices are assigned AFTER the main loop so a retired row can never reorder meta.surfaces / rounds /
// tournaments for the Database rows (an entry only a retirement uses is appended at the end).
const tieRaw = [];    // same shape as retRaw (+ isRet): ties kept for the price join only (founder 2026-10-16)
const retRaw = [];    // [dateInt, lvlIdx, surface, round, tournament, favPrice, dogPrice, favWon, bookIdx, winner, loser]
const retBucket = { priced: 0, noPrice: 0, tie: 0, overround: 0, preWindow: 0, edge: 0 };

// reconciliation buckets (disjoint, first failing reason wins)
// `retired` is its own bucket, not folded into `edge`: the footnote has to be
// able to say how many rows were voided, and a number hidden inside another
// number is exactly what the footnote was criticised for.
const bucket = { archive: 0, used: 0, walkover: 0, retired: 0, edge: 0, noPrice: 0, tie: 0, overround: 0, preWindow: 0 };
const WINDOW_START = 2010; // founder TEN-146 ruling (2026-09-04): window starts 2010, fail-closed, no pre-window fallback
const bookCount = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
let dateMin = '99999999', dateMax = '00000000';
// TEN-262: the latest archive date with a valid Pinnacle pair, read BEFORE any exclusion.
// The Database header says where the source's Pinnacle prices stop; it is never typed.
let pinnacleLastPriced = '';

// --- the archive feed (optional) ---------------------------------------------
const feed = { overrides: new Map(), adds: [], overridden: 0, tdHadPinnacle: 0, overrideUnmatched: 0, added: 0, addedRetired: 0, addedDropped: 0 };
const FEED_COLS = ['kind', 'date', 'tournament', 'series', 'court', 'surface', 'round', 'bestof', 'winner', 'loser', 'comment', 'psw', 'psl', 'archiveId', 'label', 'eventKey'];
const feedOn = fs.existsSync(FEED);
if (feedOn) {
  const lines = fs.readFileSync(FEED, 'utf8').split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',');
  if (head.join(',') !== FEED_COLS.join(',')) { console.error(`${FEED}: unexpected header ${lines[0]}`); process.exit(1); }
  for (const l of lines.slice(1)) {
    const c = l.split(','); const r = {}; FEED_COLS.forEach((k, i) => { r[k] = c[i]; });
    if (r.kind === 'override') feed.overrides.set([r.date, r.tournament, r.winner, r.loser].join('|'), [num(r.psw), num(r.psl), r.label]);
    else if (r.kind === 'add') feed.adds.push(r);
  }
}
const feedUsedKeys = new Set();
const approx = { map: new Map(), applied: 0, tdHadPinnacle: 0, archiveFirst: 0, unmatched: 0, rows: 0 };
const approxOn = fs.existsSync(APPROX_FEED);
if (approxOn) {
  const lines = fs.readFileSync(APPROX_FEED, 'utf8').split(/\r?\n/).filter(Boolean);
  if (lines[0] !== APPROX_COLS.join(',')) { console.error(`${APPROX_FEED}: unexpected header ${lines[0]}`); process.exit(1); }
  for (const l of lines.slice(1)) {
    const c = l.split(','); const r = {}; APPROX_COLS.forEach((k, i) => { r[k] = c[i]; });
    approx.map.set([r.date, r.tournament, r.winner, r.loser].join('|'), [num(r.psw), num(r.psl)]);
    approx.rows++;
  }
}
const approxUsed = new Set();

function processLine(c, col, season, fromFeed) {
    bucket.archive++;
    if (!fromFeed) { const d = (c[col.date] || '').trim(); if (d > pinnacleLastPriced && validPrice(num(c[col.psw])) && validPrice(num(c[col.psl]))) pinnacleLastPriced = d; }

    const comment = (c[col.comment] || '').trim();
    if (WALKOVER.has(comment)) { bucket.walkover++; return; }
    const isRet = RETIRED.has(comment);
    if (isRet) bucket.retired++;                                  // voided on the Database, per the 2026-09-20 ruling
    else if (!RESULT_STANDS.has(comment)) { bucket.edge++; return; } // Awarded/Disqualified/Sched

    // resolving book, per row (TEN-384 option "me" = build-market-edge.js pickBook): Pinnacle
    // when both of its prices are valid, else Bet365 when both of its are; neither = dropped.
    let P = [num(c[col.psw]), num(c[col.psl])];
    const B365 = [num(c[col.b365w]), num(c[col.b365l])];
    let archLabel = fromFeed ? (c[col.label] || '').trim() : null;   // our archive's own close: its label (3 / 4 below)
    if (!fromFeed && feedOn) {
      const fk = [(c[col.date] || '').trim(), (c[col.tournament] || '').trim(), (c[col.winner] || '').trim(), (c[col.loser] || '').trim()].join('|');
      const ov = feed.overrides.get(fk);
      if (ov) {
        feedUsedKeys.add(fk);
        if (validPrice(P[0]) && validPrice(P[1])) feed.tdHadPinnacle++;           // a Tennis-Data Pinnacle price is never replaced
        else if (validPrice(ov[0]) && validPrice(ov[1])) { P = [ov[0], ov[1]]; archLabel = ov[2]; feed.overridden++; }
      }
    }
    let AP = null;                                                // Pinnacle (approx.): only where no Pinnacle close exists
    if (!fromFeed && approxOn) {
      const ak = [(c[col.date] || '').trim(), (c[col.tournament] || '').trim(), (c[col.winner] || '').trim(), (c[col.loser] || '').trim()].join('|');
      const ap = approx.map.get(ak);
      if (ap) {
        approxUsed.add(ak);
        if (validPrice(num(c[col.psw])) && validPrice(num(c[col.psl]))) approx.tdHadPinnacle++;   // never over a Tennis-Data close
        else if (validPrice(P[0]) && validPrice(P[1])) approx.archiveFirst++;                       // never over our archive's close
        else if (validPrice(ap[0]) && validPrice(ap[1])) { AP = ap; approx.applied++; }
      }
    }
    const pinIdx = archLabel ? ARCH_BOOK[archLabel] : 0;
    if (archLabel && pinIdx == null) { console.error(`archive feed: unknown label ${JSON.stringify(archLabel)}`); process.exit(1); }
    const bookIdx = (validPrice(P[0]) && validPrice(P[1])) ? pinIdx : AP ? 2 : (validPrice(B365[0]) && validPrice(B365[1])) ? 1 : -1;
    // TEN-402: a retirement passes the SAME filters as a used row, counted in its own buckets (retBucket),
    // so the Database's reconciliation (each archive row in exactly one bucket) is untouched.
    const B_ = isRet ? retBucket : bucket;
    if (bookIdx < 0) { B_.noPrice++; return; }
    const [pw, pl] = isPinIdx(bookIdx) ? P : bookIdx === 2 ? AP : B365;

    if (pw === pl) {                                            // exact tie: no favourite, no underdog
      B_.tie++;
      const dT = (c[col.date] || '').trim(), dI = parseInt(dT.replace(/-/g, ''), 10), lvT = LEVEL_MAP[(c[col.series] || '').trim()];
      if ((1 / pw) + (1 / pl) <= 1.15 && season >= WINDOW_START && Number.isFinite(dI) && lvT) {
        tieRaw.push([dI, levels.indexOf(lvT), (c[col.surface] || '').trim(), (c[col.round] || '').trim(),
          (c[col.tournament] || '').trim(), pw, pl, 1, bookIdx, (c[col.winner] || '').trim(), (c[col.loser] || '').trim(), isRet ? 1 : 0]);
      }
      return;
    }
    if ((1 / pw) + (1 / pl) > 1.15) { B_.overround++; return; } // corrupt market

    // pre-window regime cut: 2004-2008 is a materially different sport (founder ruling,
    // Option A, 2026-09-04). Placed AFTER the exclusion checks so those buckets keep their
    // full-archive counts and preWindow captures only otherwise-usable pre-2010 rows.
    // (2009 carries no Pinnacle and no Bet365 pair -> falls out via noPrice, not here.)
    if (season < WINDOW_START) { B_.preWindow++; return; }

    // ---- usable row ----
    const dateStr = (c[col.date] || '').trim();
    const dateInt = parseInt(dateStr.replace(/-/g, ''), 10);
    if (!Number.isFinite(dateInt)) { B_.edge++; return; }       // unparseable date (none expected)
    if (isRet) {
      const canonR = LEVEL_MAP[(c[col.series] || '').trim()];
      if (!canonR) { retBucket.edge++; return; }
      retRaw.push([dateInt, levels.indexOf(canonR), (c[col.surface] || '').trim(), (c[col.round] || '').trim(),
        (c[col.tournament] || '').trim(), Math.min(pw, pl), Math.max(pw, pl), pw < pl ? 1 : 0, bookIdx,
        (c[col.winner] || '').trim(), (c[col.loser] || '').trim()]);
      retBucket.priced++;
      return;
    }
    if (dateStr < dateMin) dateMin = dateStr;
    if (dateStr > dateMax) dateMax = dateStr;

    const rawSeries = (c[col.series] || '').trim();
    const canon = LEVEL_MAP[rawSeries];
    if (!canon) { bucket.edge++; return; }                      // unknown level (none expected)
    const lvlIdx = levels.indexOf(canon);
    const surfIdx = idxOf(surfaces, (c[col.surface] || '').trim());
    const rndIdx = idxOf(rounds, (c[col.round] || '').trim());
    const tourIdx = idxOf(tournaments, (c[col.tournament] || '').trim());

    const favPrice = Math.min(pw, pl);
    const dogPrice = Math.max(pw, pl);
    const favWon = pw < pl ? 1 : 0;   // winner carries pw; shorter price won iff pw<pl

    rows.push([dateInt, lvlIdx, surfIdx, rndIdx, tourIdx, favPrice, dogPrice, favWon, bookIdx]);
    names.push([(c[col.winner] || '').trim(), (c[col.loser] || '').trim()]);
    bucket.used++;
    bookCount[bookIdx]++;
}

for (const f of files) {
  const season = parseInt(f.slice(0, 4), 10);
  const text = fs.readFileSync(path.join(ARCHIVE_DIR, f), 'utf8');
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(',');
  const col = {}; header.forEach((h, i) => col[h.trim()] = i);
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li];
    if (!line) continue;
    const c = line.split(',');
    if (c.length < header.length) continue;
    processLine(c, col, season, false);
  }
}
approx.unmatched = approxOn ? [...approx.map.keys()].filter(k => !approxUsed.has(k)).length : 0;
feed.overrideUnmatched = feedOn ? [...feed.overrides.keys()].filter(k => !feedUsedKeys.has(k)).length : 0;
if (feedOn) {
  const col = {}; FEED_COLS.forEach((h, i) => { col[h] = i; });
  for (const r of feed.adds) {
    const before = bucket.used + retBucket.priced;
    processLine(FEED_COLS.map(k => r[k] == null ? '' : r[k]), col, parseInt(String(r.date).slice(0, 4), 10), true);
    const got = bucket.used + retBucket.priced - before;
    if (!got) feed.addedDropped++;
    else if (RETIRED.has((r.comment || '').trim())) feed.addedRetired++;
    else feed.added++;
  }
}

// TEN-402: the retired rows' dictionary indices, assigned after every Database row has claimed its own.
const retRows = [], retNames = [];
for (const x of retRaw) {
  retRows.push([x[0], x[1], idxOf(surfaces, x[2]), idxOf(rounds, x[3]), idxOf(tournaments, x[4]), x[5], x[6], x[7], x[8]]);
  retNames.push([x[9], x[10]]);
}

// Founder 2026-10-16: the kept ties' dictionary indices, after every Database and retired row has claimed its own.
const tieRows = [], tieNames = [];
for (const x of tieRaw) {
  tieRows.push([x[0], x[1], idxOf(surfaces, x[2]), idxOf(rounds, x[3]), idxOf(tournaments, x[4]), x[5], x[6], x[7], x[8]]);
  tieNames.push([x[9], x[10]]);
}

// --- overall yields (for the verify report + a page cross-check) ------------
function yields(pred) {
  let n = 0, favProfit = 0, dogProfit = 0;
  for (const r of rows) {
    if (pred && !pred(r)) continue;
    const fav = r[5], dog = r[6], favWon = r[7];
    n++;
    favProfit += favWon ? (fav - 1) : -1;
    dogProfit += favWon ? -1 : (dog - 1);
  }
  return { n, fav: n ? favProfit / n : null, dog: n ? dogProfit / n : null };
}
const yAll = yields(null);
const yPS = yields(r => isPinIdx(r[8]));
const yB365 = yields(r => r[8] === 1);

// --- TEN-384 · tour baselines (the profile's Market edge tiles and box) ------
// The Database Tour view with no filter is every row; its "Favourites All" / "Underdogs All"
// are bands(values).all over {p: price, w: won}, where agg() sums the flat 1u P&L in ascending
// price order. Summed here in that SAME order (stable sort, same comparator), so the floats are
// bit-identical to what the Database page prints — not merely close. All = both sides of every
// match pooled: (fav + dog) / 2 over the same n.
function dbRoleYield(list, side) {
  const vs = list.map(r => side === 'fav' ? { p: r.fav, w: r.won } : { p: r.dog, w: r.won ? 0 : 1 })
    .sort((a, b) => a.p - b.p);
  let profit = 0;
  for (const v of vs) profit += v.w ? (v.p - 1) : -1;
  return vs.length ? profit / vs.length : null;
}
function baselinesOf(list, books) {
  const fav = dbRoleYield(list, 'fav'), dog = dbRoleYield(list, 'dog');
  return {
    all: { matches: list.length, bets: 2 * list.length, yield: fav == null ? null : (fav + dog) / 2 },
    favourite: { n: list.length, yield: fav },
    underdog: { n: list.length, yield: dog },
    bookCounts: books,
  };
}
const dbList = rows.map(r => ({ fav: r[5], dog: r[6], won: r[7], book: r[8] }));
const BOOK_COUNTS = { Pinnacle: bookCount[0] + bookCount[3] + bookCount[4], Bet365: bookCount[1], ...(approxOn ? { [BOOKS[2]]: bookCount[2] } : {}) };
const TB = baselinesOf(dbList, BOOK_COUNTS);

// --- write artefacts --------------------------------------------------------
const meta = {
  schema: 1,
  generatedFrom: `odds-archive/*.csv (${files[0]}..${files[files.length - 1]})`,
  archiveRows: bucket.archive,
  used: bucket.used,
  dateRange: [dateMin, dateMax],
  exclusions: {
    walkover: bucket.walkover,
    retired: bucket.retired,
    edge: bucket.edge,
    noResolvingBookPrice: bucket.noPrice,
    exactTie: bucket.tie,
    overroundGt115: bucket.overround,
    preWindow: bucket.preWindow,   // pre-2010 regime cut (otherwise-usable rows dropped by the window)
  },
  windowStart: WINDOW_START,
  books: approxOn ? BOOKS : BOOKS.slice(0, 2),
  priceRule: PRICE_RULE,
  bookCounts: BOOK_COUNTS,   // rows per book ACTUALLY used (r[8]); 'Pinnacle (approx.)' only when its feed exists
  // No season seam (TEN-384): Bet365 prices any row Pinnacle cannot. The page marks the
  // change where the source's Pinnacle prices stop — the latest archive date with a valid
  // Pinnacle pair, read before any exclusion; every used row after it is Bet365-priced.
  pinnacleLastPriced: pinnacleLastPriced || null,
  // TEN-402 (founder 2026-10-08): retirements behind a flag — `retRows` (this file) / `retNames` (the names
  // shard), parallel, same shape as rows / names. NOT Database rows: the Database voids them (exclusions.retired).
  // Read only by the price join of the Head to Head page and the Player Profile per-event Backing
  // (DatabaseTab.priceRows), which settle them on the official ATP result (the archive's winner).
  retired: {
    rule: 'Retirements priced on the same join (Pinnacle closing, else Bet365 closing; ties, overround > 1.15 and pre-' +
      WINDOW_START + ' out), settled on the official ATP result. Not Database rows.',
    priced: retBucket.priced,
    dropped: { noResolvingBookPrice: retBucket.noPrice, exactTie: retBucket.tie, overroundGt115: retBucket.overround,
      preWindow: retBucket.preWindow, edge: retBucket.edge },
  },
  // Founder ruling 2026-10-16: exact ties behind a flag — `tieRows` (this file) / `tieNames` (the names shard), parallel,
  // same shape as rows / names (favWon 1: the winner's price = the loser's). NOT Database rows: no Database figure,
  // tour-baselines.json or tournament-market.json reads them. Read only by the price join (DatabaseTab.priceRows).
  ties: {
    rule: 'Exact price ties kept for the price join only (both players priced at the tie; overround > 1.15, pre-' +
      WINDOW_START + ' and unknown levels out); excluded from every favourite / underdog figure.',
    kept: tieRows.length, keptRetired: tieRaw.filter(x => x[11]).length,
    byBook: { Pinnacle: tieRaw.filter(x => isPinIdx(x[8])).length, Bet365: tieRaw.filter(x => x[8] === 1).length },
  },
  ...(approxOn ? { approx: {
    file: path.basename(APPROX_FEED), book: BOOKS[2], hover: APPROX_HOVER,
    rule: 'api-tennis\'s stored Pinnacle price (a snapshot: no timestamp, not a confirmed close) for an ATP main-draw match of ' +
      '13 Jan - 16 Sep 2026 with no Tennis-Data Pinnacle close and no close in our Pinnacle archive; Bet365 where api-tennis has no pair.',
    rows: approx.rows, applied: approx.applied, tdHadPinnacle: approx.tdHadPinnacle, archiveFirst: approx.archiveFirst, unmatched: approx.unmatched,
  } } : {}),
  ...(feedOn ? { archiveFeed: {
    file: path.basename(FEED),
    rule: 'Our Pinnacle closes (the permanent Pinnacle archive, labelled captured / from Pinnacle history): a Tennis-Data 2026 row with no ' +
      'Pinnacle pair takes our close; ATP main-draw matches after the Tennis-Data file\'s last day are added, priced on our close. ' +
      'A Tennis-Data Pinnacle price is never replaced.',
    overridden: feed.overridden, tdHadPinnacle: feed.tdHadPinnacle, overrideUnmatched: feed.overrideUnmatched,
    added: feed.added, addedRetired: feed.addedRetired, addedDropped: feed.addedDropped,
    // founder 2026-10-16 (round 3, item 1): the Database rows priced on our archive's closes, by their own code / label
    bookCodes: { 3: 'from Pinnacle history', 4: 'captured' },
    rowsByLabel: { 'from Pinnacle history': bookCount[3], captured: bookCount[4] },
  } } : {}),
  levels, surfaces, rounds, tournaments,
  yieldOverall: {
    all: yAll, Pinnacle: yPS, Bet365: yB365,
  },
};

// Atomic writes (CLAUDE.md rule 3): temp file + rename, never a half-written live JSON.
function writeAtomic(p, text) { const tmp = p + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, p); }
writeAtomic(OUT_BASE, JSON.stringify({ meta, rows, retRows, tieRows }));
// Founder brief 2026-10-15 item 2: the site's ONE archive name table (build-odds-performance.js ARCHIVE_NAME_ALIASES /
// ARCHIVE_NAME_BLOCK, hand-checked) reaches the page's price join too: `aliases` = a Tennis-Data name in this store ->
// our spelling of the player it names ("Barrios M." -> "T. Barrios Vera", "Miguel L." -> "G. Miguel"). Only names the
// store holds are listed; nothing else changes. ARCHIVE_NAME_BLOCK is NOT carried: the feed's own rows spell Zhizhen
// Zhang "Zhang Z." (pinarch td_name), so blocking that name would drop his 2026 prices (measured 15 Oct: 3 matches).
const nameTable = (() => {
  const { ARCHIVE_NAME_ALIASES, ARCHIVE_ALIAS_NAMES } = require('./build-odds-performance.js');
  let prof = {};
  try { prof = (JSON.parse(fs.readFileSync(path.join(__dirname, 'player-profiles.json'), 'utf8')).players) || {}; } catch (e) { /* no table: page join as before */ }
  const held = new Set(); for (const pr of names.concat(retNames, tieNames)) for (const n of pr || []) held.add(n);
  const aliases = {};
  const missing = [];
  for (const [n, k] of Object.entries(ARCHIVE_NAME_ALIASES)) {
    if (n.includes(',') || !held.has(n)) continue;
    const our = (prof[k] && prof[k].name) || ARCHIVE_ALIAS_NAMES[k];
    if (our) aliases[n] = our; else missing.push(`${n} (${k})`);
  }
  if (missing.length) console.log(`name table: aliased archive names with no spelling of ours (left unjoined): ${missing.join(', ')}`);
  return { aliases };
})();
writeAtomic(OUT_NAMES, JSON.stringify({ names, retNames, tieNames, aliases: nameTable.aliases }));
console.log(`name table (archive aliases → page join): ${JSON.stringify(nameTable)}`);
// TEN-384: loaded by the player profile WITH the profile data (never database-yield.json).
const B = TB;
writeAtomic(BASELINES_OUT, JSON.stringify({
  schema: 1,
  basis: 'market-edge',
  equalsDatabaseTour: true,   // one join (TEN-384 option "me"): the same rows as database-yield.json
  source: 'build-database-yield.js over odds-archive/*.csv, the same run that writes database-yield.json',
  priceRule: PRICE_RULE,
  filters: 'ATP main tour, all levels incl. Finals, all surfaces, seasons ' + WINDOW_START + ' on; completed matches only ' +
    '(walkovers, retirements and other non-results excluded); exact price ties and overround > 1.15 excluded; ' +
    'favourite = the shorter price; flat 1u, a win pays price − 1',
  dateRange: [dateMin, dateMax],
  bookCounts: B.bookCounts,
  roles: { all: B.all, favourite: B.favourite, underdog: B.underdog },
}, null, 1) + '\n');

// --- reconciliation + payload report ---------------------------------------
const recon = bucket.used + bucket.walkover + bucket.retired + bucket.edge + bucket.noPrice + bucket.tie + bucket.overround + bucket.preWindow;
const gz = (p) => zlib.gzipSync(fs.readFileSync(p)).length;
const kb = (n) => (n / 1024).toFixed(0) + ' KB';
const pct = (x) => x == null ? '-' : (x * 100).toFixed(2) + '%';

console.log('=== TEN-146 build-database-yield ===');
console.log(`archive rows        : ${bucket.archive}`);
console.log(`  used              : ${bucket.used}`);
console.log(`  - walkover        : ${bucket.walkover}`);
console.log(`  - retired (void)  : ${bucket.retired}`);
console.log(`  - edge non-result : ${bucket.edge}   (Awarded/Disqualified/Sched)`);
console.log(`  - no book price   : ${bucket.noPrice}  (no valid Pinnacle pair and no valid Bet365 pair; incl. all 2009)`);
console.log(`  - exact tie       : ${bucket.tie}`);
console.log(`  - overround>1.15  : ${bucket.overround}`);
console.log(`  - pre-${WINDOW_START} regime  : ${bucket.preWindow}  (otherwise-usable rows dropped by the window)`);
console.log(`RECONCILE used+excl : ${recon}  ${recon === bucket.archive ? 'OK == archive' : 'MISMATCH!'}`);
const retSum = retBucket.priced + retBucket.noPrice + retBucket.tie + retBucket.overround + retBucket.preWindow + retBucket.edge;
console.log(`retired, flagged    : ${retBucket.priced} priced (retRows) of ${bucket.retired}  ` +
  `[no price ${retBucket.noPrice}, tie ${retBucket.tie}, overround ${retBucket.overround}, pre-${WINDOW_START} ${retBucket.preWindow}, edge ${retBucket.edge}]  ` +
  `${retSum === bucket.retired ? 'OK' : 'MISMATCH!'}`);
console.log(`date range          : ${dateMin} .. ${dateMax}`);
console.log(`book split (used)   : Pinnacle ${bookCount[0]} (Tennis-Data) + ${bookCount[3]} from Pinnacle history + ${bookCount[4]} captured  Bet365 ${bookCount[1]}` + (approxOn ? `  Pinnacle (approx.) ${bookCount[2]} (feed ${approx.rows}: applied ${approx.applied}, Tennis-Data Pinnacle kept ${approx.tdHadPinnacle}, archive close kept ${approx.archiveFirst}, unmatched ${approx.unmatched})` : ''));
console.log(`yield ALL           : fav ${pct(yAll.fav)}  dog ${pct(yAll.dog)}  n=${yAll.n}`);
console.log(`yield Pinnacle      : fav ${pct(yPS.fav)}  dog ${pct(yPS.dog)}  n=${yPS.n}`);
console.log(`yield Bet365        : fav ${pct(yB365.fav)}  dog ${pct(yB365.dog)}  n=${yB365.n}`);
console.log(`payload base        : ${kb(fs.statSync(OUT_BASE).size)} raw / ${kb(gz(OUT_BASE))} gz`);
console.log(`payload names shard : ${kb(fs.statSync(OUT_NAMES).size)} raw / ${kb(gz(OUT_NAMES))} gz`);
console.log(`tour baselines      : all ${pct(TB.all.yield)}  fav ${pct(TB.favourite.yield)}  ` +
  `dog ${pct(TB.underdog.yield)}  n=${TB.all.matches} matches  (Pinnacle ${TB.bookCounts.Pinnacle} / Bet365 ${TB.bookCounts.Bet365})`);
console.log(`pinnacle last priced: ${pinnacleLastPriced || '-'}`);
if (feedOn) console.log(`archive feed        : ${feed.overridden} Tennis-Data rows priced on our Pinnacle close (${feed.tdHadPinnacle} kept their Tennis-Data Pinnacle, ` +
  `${feed.overrideUnmatched} unmatched); ${feed.added} matches added + ${feed.addedRetired} retirements (flagged), ${feed.addedDropped} dropped by the filters`);
console.log(`payload baselines   : ${fs.statSync(BASELINES_OUT).size} B raw  -> ${path.basename(BASELINES_OUT)}`);
console.log(`levels=${levels.length} surfaces=${surfaces.length} rounds=${rounds.length} tournaments=${tournaments.length}`);
