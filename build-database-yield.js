#!/usr/bin/env node
/*
 * build-database-yield.js  (TEN-146)
 * ----------------------------------
 * Precompute the Database-tab artefact: one compact match-level base file
 * (Tour + Tournaments views) plus a lazy player-names shard (Players view).
 *
 * ALL methodology is the founder's locked TEN-146 ruling — do not re-litigate here.
 *
 *   Book:      Pinnacle (psw/psl) for every season EXCEPT 2026; Bet365 (b365w/b365l)
 *              for 2026 only. No Avg tier. No fallback — fail-closed: a row whose
 *              resolving book has no valid closing pair is DROPPED (e.g. all of 2009,
 *              where Pinnacle = 0, and 2026 rows lacking a Bet365 pair).
 *   Results:   retirements included (result stands, 'Rrtired' typo folded in);
 *              walkovers excluded; edge non-results (Awarded/Disqualified/Sched) excluded.
 *   Ties:      exact resolving-price ties excluded. No ranking/positional fallback.
 *   Overround: 1/pw + 1/pl > 1.15 excluded (corrupt-market hygiene).
 *   Fav/dog:   shorter price is the favourite.
 *   Levels:    8 raw series -> 5 canonical.
 *   Scope:     ATP tour only (the archive carries nothing else).
 *
 * Every archive row lands in exactly one bucket (used or one exclusion reason) so the
 * footnote reconciles with no unexplained gap.
 *
 * Emits (additive, unreferenced until the Database tab flag is flipped on):
 *   database-yield.json          base, no names   (Tour + Tournaments)
 *   database-yield-players.json  winner/loser names, parallel to base rows (Players, lazy)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ARCHIVE_DIR = path.join(__dirname, 'odds-archive');
const OUT_BASE = path.join(__dirname, 'database-yield.json');
const OUT_NAMES = path.join(__dirname, 'database-yield-players.json');

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
const RESULT_STANDS = new Set(['Completed', 'Retired', 'Rrtired']); // Rrtired = Retired typo
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
const bucket = { archive: 0, used: 0, walkover: 0, edge: 0, noPrice: 0, tie: 0, overround: 0 };
const bookCount = { 0: 0, 1: 0 };
let dateMin = '99999999', dateMax = '00000000';

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

    const comment = (c[col.comment] || '').trim();
    if (WALKOVER.has(comment)) { bucket.walkover++; continue; }
    if (!RESULT_STANDS.has(comment)) { bucket.edge++; continue; } // Awarded/Disqualified/Sched

    // resolving book (fail-closed)
    const bookIdx = (season === 2026) ? 1 : 0;
    let pw, pl;
    if (bookIdx === 1) { pw = num(c[col.b365w]); pl = num(c[col.b365l]); }
    else { pw = num(c[col.psw]); pl = num(c[col.psl]); }
    if (!validPrice(pw) || !validPrice(pl)) { bucket.noPrice++; continue; }

    if (pw === pl) { bucket.tie++; continue; }                    // exact tie
    if ((1 / pw) + (1 / pl) > 1.15) { bucket.overround++; continue; } // corrupt market

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

// --- write artefacts --------------------------------------------------------
const meta = {
  schema: 1,
  generatedFrom: `odds-archive/*.csv (${files[0]}..${files[files.length - 1]})`,
  archiveRows: bucket.archive,
  used: bucket.used,
  dateRange: [dateMin, dateMax],
  exclusions: {
    walkover: bucket.walkover,
    edge: bucket.edge,
    noResolvingBookPrice: bucket.noPrice,
    exactTie: bucket.tie,
    overroundGt115: bucket.overround,
  },
  books: BOOKS,
  bookCounts: { Pinnacle: bookCount[0], Bet365: bookCount[1] },
  seamSeason: 2026,       // first season resolved on Bet365
  levels, surfaces, rounds, tournaments,
  yieldOverall: {
    all: yAll, Pinnacle: yPS, Bet365: yB365,
  },
};

fs.writeFileSync(OUT_BASE, JSON.stringify({ meta, rows }));
fs.writeFileSync(OUT_NAMES, JSON.stringify({ names }));

// --- reconciliation + payload report ---------------------------------------
const recon = bucket.used + bucket.walkover + bucket.edge + bucket.noPrice + bucket.tie + bucket.overround;
const gz = (p) => zlib.gzipSync(fs.readFileSync(p)).length;
const kb = (n) => (n / 1024).toFixed(0) + ' KB';
const pct = (x) => x == null ? '-' : (x * 100).toFixed(2) + '%';

console.log('=== TEN-146 build-database-yield ===');
console.log(`archive rows        : ${bucket.archive}`);
console.log(`  used              : ${bucket.used}`);
console.log(`  - walkover        : ${bucket.walkover}`);
console.log(`  - edge non-result : ${bucket.edge}   (Awarded/Disqualified/Sched)`);
console.log(`  - no book price   : ${bucket.noPrice}  (fail-closed; incl. all 2009 & non-B365 2026)`);
console.log(`  - exact tie       : ${bucket.tie}`);
console.log(`  - overround>1.15  : ${bucket.overround}`);
console.log(`RECONCILE used+excl : ${recon}  ${recon === bucket.archive ? 'OK == archive' : 'MISMATCH!'}`);
console.log(`date range          : ${dateMin} .. ${dateMax}`);
console.log(`book split (used)   : Pinnacle ${bookCount[0]}  Bet365 ${bookCount[1]}`);
console.log(`yield ALL           : fav ${pct(yAll.fav)}  dog ${pct(yAll.dog)}  n=${yAll.n}`);
console.log(`yield Pinnacle      : fav ${pct(yPS.fav)}  dog ${pct(yPS.dog)}  n=${yPS.n}`);
console.log(`yield Bet365        : fav ${pct(yB365.fav)}  dog ${pct(yB365.dog)}  n=${yB365.n}`);
console.log(`payload base        : ${kb(fs.statSync(OUT_BASE).size)} raw / ${kb(gz(OUT_BASE))} gz`);
console.log(`payload names shard : ${kb(fs.statSync(OUT_NAMES).size)} raw / ${kb(gz(OUT_NAMES))} gz`);
console.log(`levels=${levels.length} surfaces=${surfaces.length} rounds=${rounds.length} tournaments=${tournaments.length}`);
