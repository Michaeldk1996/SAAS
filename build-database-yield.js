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
 *   Results:   retirements included (result stands, 'Rrtired' typo folded in);
 *              walkovers excluded; edge non-results (Awarded/Disqualified/Sched) excluded.
 *   Ties:      exact resolving-price ties excluded. No ranking/positional fallback.
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

const ARCHIVE_DIR = path.join(__dirname, 'odds-archive');
const OUT_BASE = path.join(__dirname, 'database-yield.json');
const OUT_NAMES = path.join(__dirname, 'database-yield-players.json');
const OUT_BASELINES = path.join(__dirname, 'tour-baselines.json');

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

const BOOKS = ['Pinnacle', 'Bet365']; // idx 0,1

const rows = [];      // [dateInt, lvlIdx, surfIdx, rndIdx, tourIdx, favPrice, dogPrice, favWon, bookIdx]
const names = [];     // [winnerName, loserName] parallel to rows

// reconciliation buckets (disjoint, first failing reason wins)
// `retired` is its own bucket, not folded into `edge`: the footnote has to be
// able to say how many rows were voided, and a number hidden inside another
// number is exactly what the footnote was criticised for.
const bucket = { archive: 0, used: 0, walkover: 0, retired: 0, edge: 0, noPrice: 0, tie: 0, overround: 0, preWindow: 0 };
const WINDOW_START = 2010; // founder TEN-146 ruling (2026-09-04): window starts 2010, fail-closed, no pre-window fallback
const bookCount = { 0: 0, 1: 0 };
let dateMin = '99999999', dateMax = '00000000';
// TEN-262: the latest archive date with a valid Pinnacle pair, read BEFORE any exclusion.
// The Database header says where the source's Pinnacle prices stop; it is never typed.
let pinnacleLastPriced = '';

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
    bucket.archive++;
    { const d = (c[col.date] || '').trim(); if (d > pinnacleLastPriced && validPrice(num(c[col.psw])) && validPrice(num(c[col.psl]))) pinnacleLastPriced = d; }

    const comment = (c[col.comment] || '').trim();
    if (WALKOVER.has(comment)) { bucket.walkover++; continue; }
    if (RETIRED.has(comment)) { bucket.retired++; continue; }     // voided, per the 2026-09-20 ruling
    if (!RESULT_STANDS.has(comment)) { bucket.edge++; continue; } // Awarded/Disqualified/Sched

    // resolving book, per row (TEN-384 option "me" = build-market-edge.js pickBook): Pinnacle
    // when both of its prices are valid, else Bet365 when both of its are; neither = dropped.
    const P = [num(c[col.psw]), num(c[col.psl])], B365 = [num(c[col.b365w]), num(c[col.b365l])];
    const bookIdx = (validPrice(P[0]) && validPrice(P[1])) ? 0 : (validPrice(B365[0]) && validPrice(B365[1])) ? 1 : -1;
    if (bookIdx < 0) { bucket.noPrice++; continue; }
    const [pw, pl] = bookIdx === 0 ? P : B365;

    if (pw === pl) { bucket.tie++; continue; }                    // exact tie
    if ((1 / pw) + (1 / pl) > 1.15) { bucket.overround++; continue; } // corrupt market

    // pre-window regime cut: 2004-2008 is a materially different sport (founder ruling,
    // Option A, 2026-09-04). Placed AFTER the exclusion checks so those buckets keep their
    // full-archive counts and preWindow captures only otherwise-usable pre-2010 rows.
    // (2009 carries no Pinnacle and no Bet365 pair -> falls out via noPrice, not here.)
    if (season < WINDOW_START) { bucket.preWindow++; continue; }

    // ---- usable row ----
    const dateStr = (c[col.date] || '').trim();
    const dateInt = parseInt(dateStr.replace(/-/g, ''), 10);
    if (!Number.isFinite(dateInt)) { bucket.edge++; continue; }   // unparseable date (none expected)
    if (dateStr < dateMin) dateMin = dateStr;
    if (dateStr > dateMax) dateMax = dateStr;

    const rawSeries = (c[col.series] || '').trim();
    const canon = LEVEL_MAP[rawSeries];
    if (!canon) { bucket.edge++; continue; }                      // unknown level (none expected)
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
const yPS = yields(r => r[8] === 0);
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
const TB = baselinesOf(dbList, { Pinnacle: bookCount[0], Bet365: bookCount[1] });

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
  books: BOOKS,
  priceRule: PRICE_RULE,
  bookCounts: { Pinnacle: bookCount[0], Bet365: bookCount[1] },   // rows per book ACTUALLY used (r[8])
  // No season seam (TEN-384): Bet365 prices any row Pinnacle cannot. The page marks the
  // change where the source's Pinnacle prices stop — the latest archive date with a valid
  // Pinnacle pair, read before any exclusion; every used row after it is Bet365-priced.
  pinnacleLastPriced: pinnacleLastPriced || null,
  levels, surfaces, rounds, tournaments,
  yieldOverall: {
    all: yAll, Pinnacle: yPS, Bet365: yB365,
  },
};

fs.writeFileSync(OUT_BASE, JSON.stringify({ meta, rows }));
fs.writeFileSync(OUT_NAMES, JSON.stringify({ names }));
// TEN-384: loaded by the player profile WITH the profile data (never database-yield.json).
const B = TB;
fs.writeFileSync(OUT_BASELINES, JSON.stringify({
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
console.log(`date range          : ${dateMin} .. ${dateMax}`);
console.log(`book split (used)   : Pinnacle ${bookCount[0]}  Bet365 ${bookCount[1]}`);
console.log(`yield ALL           : fav ${pct(yAll.fav)}  dog ${pct(yAll.dog)}  n=${yAll.n}`);
console.log(`yield Pinnacle      : fav ${pct(yPS.fav)}  dog ${pct(yPS.dog)}  n=${yPS.n}`);
console.log(`yield Bet365        : fav ${pct(yB365.fav)}  dog ${pct(yB365.dog)}  n=${yB365.n}`);
console.log(`payload base        : ${kb(fs.statSync(OUT_BASE).size)} raw / ${kb(gz(OUT_BASE))} gz`);
console.log(`payload names shard : ${kb(fs.statSync(OUT_NAMES).size)} raw / ${kb(gz(OUT_NAMES))} gz`);
console.log(`tour baselines      : all ${pct(TB.all.yield)}  fav ${pct(TB.favourite.yield)}  ` +
  `dog ${pct(TB.underdog.yield)}  n=${TB.all.matches} matches  (Pinnacle ${TB.bookCounts.Pinnacle} / Bet365 ${TB.bookCounts.Bet365})`);
console.log(`pinnacle last priced: ${pinnacleLastPriced || '-'}`);
console.log(`payload baselines   : ${fs.statSync(OUT_BASELINES).size} B raw  -> ${path.basename(OUT_BASELINES)}`);
console.log(`levels=${levels.length} surfaces=${surfaces.length} rounds=${rounds.length} tournaments=${tournaments.length}`);
