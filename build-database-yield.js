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
const OUT_X = path.join(OUT_DIR, 'database-yield-x.json');             // the era shard (before 2010 + team events)
const OUT_MASTER = path.join(OUT_DIR, 'database-yield-master.json');   // the one master file the builders read
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
const APPROX_COLS = ['date', 'tournament', 'winner', 'loser', 'psw', 'psl', 'eventKey', 'snapshotId', 'source', 'cutTs', 'gapToStartS'];
const APPROX_HOVER = 'Pinnacle snapshot from api-tennis, no timestamp, not a confirmed close';
// Founder ruling 2026-10-17 (item 2): for 13 Apr - 16 Sep the first Pinnacle (approx.) source is the Oddspapi Pinnacle archive at
// Oddspapi's start - 10 min (book index 5, its own hover); api-tennis (book 2) only where the archive has no pre-cut pair.
const APPROX_SRC = { 'api-tennis Pinnacle': 'at', 'oddspapi Pinnacle (start − 10)': 'od' };
const APPROX_HOVER_OD10 = 'Pinnacle history, taken 10 minutes before the recorded start, not a confirmed close';

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
// everything else non-Completed (Awarded/Disqualified/Sched) => edge non-result, excluded — UNLESS the match started
// (founder ruling 2026-10-17, odds master close-out item 1): a match that started counts as played and shows its price —
// retired, defaulted, or marked "Awarded" / "Disqualified" / any other non-result after play began. Only a match where
// no ball was played (a true walkover) stays a dash; where the sources disagree on whether it started, the dash stays.
// Evidence: started-evidence.json (tools/started-evidence.js: both players' career-history rows + Tennis-Data's comment,
// verdict 'started' only), and for an archive-fed row our own live-flip (the archive derives a close only for a match our
// poller saw go live; td-feed passes api-tennis "Awarded" through as the row's comment). A started non-result is priced
// BEHIND the retired flag, settled on the official result like a retirement: no Database figure moves.
const STARTED_PATH = process.env.DB_YIELD_STARTED || path.join(__dirname, 'started-evidence.json');
const started = { on: false, evidence: 0, says: new Map(), matched: 0, priced: 0, byComment: {} };
if (fs.existsSync(STARTED_PATH)) {
  const ev = JSON.parse(fs.readFileSync(STARTED_PATH, 'utf8'));
  if (!ev || !Array.isArray(ev.matches)) { console.error(`${STARTED_PATH}: no matches array`); process.exit(1); }
  started.on = true; started.evidence = ev.matches.length;
  for (const x of ev.matches) started.says.set([x.date, x.tournament, x.winner, x.loser].join('|'), Array.isArray(x.says) ? x.says : []);
}
// the row's verdict: its career sources (the evidence file) + our archive's live-flip close (a td-feed override), against
// Tennis-Data's own comment (tools/started-evidence.js verdictOf — the one rule)
// loaded only when a source speaks (a copy of this builder in a test's temp folder carries no tools/)
let _startedVerdict = null;
const startedVerdict = (comment, says) => {
  if (!says.length) return 'none';
  _startedVerdict = _startedVerdict || require('./tools/started-evidence.js').verdictOf;
  return _startedVerdict(comment, says);
};
const startedOf = (tdKey, comment, archiveLiveFlip) =>
  startedVerdict(comment, (started.says.get(tdKey) || []).concat(archiveLiveFlip ? ['started'] : [])) === 'started';
const FEED_STARTED = new Set(['Awarded']);   // an archive-fed row: api-tennis "Awarded" after our poller saw it go live

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
// idx 5 = Pinnacle (approx.) from the Oddspapi Pinnacle archive at start - 10 (founder 2026-10-17): counted as 'Pinnacle (approx.)'
const isApproxIdx = i => i === 2 || i === 5;
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
// Founder ruling 2026-10-17 ("one source of truth for every match and every price"): the matches the master holds but
// the Database's statistics leave out — every priced match before 2010 and the team events (Davis Cup, Laver Cup …) —
// ride in their own era shard, database-yield-x.json, read by the price join only (never a Database figure). Shape:
// [dateInt, level|null, surface, round, tournament, favPrice, dogPrice, favWon, bookIdx, winner, loser, flags] with flags
// 'p' (before 2010) or 't' (team event), plus 'r' (a retirement) and 'e' (an exact price tie).
const xRaw = [];
// …and every priced match of every set goes into the ONE master file (database-yield-master.json) with the attributes the
// builders downstream need (series, court, best-of, comment): `att` is pushed beside each accepted row, same index.
const rowsAtt = [], retAtt = [], tieAtt = [], xAtt = [];
const retRaw = [];    // [dateInt, lvlIdx, surface, round, tournament, favPrice, dogPrice, favWon, bookIdx, winner, loser]
const retBucket = { priced: 0, noPrice: 0, tie: 0, overround: 0, preWindow: 0, edge: 0 };

// reconciliation buckets (disjoint, first failing reason wins)
// `retired` is its own bucket, not folded into `edge`: the footnote has to be
// able to say how many rows were voided, and a number hidden inside another
// number is exactly what the footnote was criticised for.
const bucket = { archive: 0, used: 0, walkover: 0, retired: 0, edge: 0, noPrice: 0, tie: 0, overround: 0, preWindow: 0 };
const WINDOW_START = 2010; // founder TEN-146 ruling (2026-09-04): window starts 2010, fail-closed, no pre-window fallback
const bookCount = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
let dateMin = '99999999', dateMax = '00000000';
// TEN-262: the latest archive date with a valid Pinnacle pair, read BEFORE any exclusion.
// The Database header says where the source's Pinnacle prices stop; it is never typed.
let pinnacleLastPriced = '';

// --- the archive feed (optional) ---------------------------------------------
const feed = { overrides: new Map(), adds: [], team: [], teamKept: 0, teamDropped: 0, overridden: 0, tdHadPinnacle: 0, overrideUnmatched: 0, added: 0, addedRetired: 0, addedDropped: 0 };
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
    else if (r.kind === 'team') feed.team.push(r);   // founder 2026-10-17: a team event's archive close (the era shard only)
  }
}
const feedUsedKeys = new Set();
const approx = { map: new Map(), applied: 0, appliedBySource: { at: 0, od: 0 }, tdHadPinnacle: 0, archiveFirst: 0, unmatched: 0, rows: 0, rowsBySource: { at: 0, od: 0 } };
const approxOn = fs.existsSync(APPROX_FEED);
if (approxOn) {
  const lines = fs.readFileSync(APPROX_FEED, 'utf8').split(/\r?\n/).filter(Boolean);
  if (lines[0] !== APPROX_COLS.join(',')) { console.error(`${APPROX_FEED}: unexpected header ${lines[0]}`); process.exit(1); }
  for (const l of lines.slice(1)) {
    const c = l.split(','); const r = {}; APPROX_COLS.forEach((k, i) => { r[k] = c[i]; });
    const src = APPROX_SRC[r.source];
    if (!src) { console.error(`${APPROX_FEED}: unknown snapshot source ${JSON.stringify(r.source)}`); process.exit(1); }
    const key = [r.date, r.tournament, r.winner, r.loser].join('|');
    const e = approx.map.get(key) || {};
    e[src] = [num(r.psw), num(r.psl)];
    approx.map.set(key, e);
    approx.rows++; approx.rowsBySource[src]++;
  }
}
const approxUsed = new Set();

function processLine(c, col, season, fromFeed) {
    bucket.archive++;
    const att = () => [(c[col.series] || '').trim(), (c[col.court] || '').trim(), (c[col.bestof] || '').trim(), (c[col.comment] || '').trim(),
      col.wrank != null ? (c[col.wrank] || '').trim() : '', col.lrank != null ? (c[col.lrank] || '').trim() : ''];
    if (!fromFeed) { const d = (c[col.date] || '').trim(); if (d > pinnacleLastPriced && validPrice(num(c[col.psw])) && validPrice(num(c[col.psl]))) pinnacleLastPriced = d; }

    const comment = (c[col.comment] || '').trim();
    if (WALKOVER.has(comment)) { bucket.walkover++; return; }
    // founder 2026-10-17 (close-out item 1): a non-result that STARTED is priced like a retirement (behind the flag)
    const tdKey = [(c[col.date] || '').trim(), (c[col.tournament] || '').trim(), (c[col.winner] || '').trim(), (c[col.loser] || '').trim()].join('|');
    const startedNonResult = !RESULT_STANDS.has(comment) && !RETIRED.has(comment)
      && (fromFeed ? FEED_STARTED.has(comment) && !!(c[col.label] || '').trim() : startedOf(tdKey, comment, feedOn && feed.overrides.has(tdKey)));
    if (startedNonResult) started.matched++;
    const isRet = RETIRED.has(comment);
    if (isRet) bucket.retired++;                                  // voided on the Database, per the 2026-09-20 ruling
    else if (!RESULT_STANDS.has(comment)) { bucket.edge++; if (!startedNonResult) return; } // Awarded/Disqualified/Sched: out of the Database rows either way
    // a retirement, or a non-result that started: priced behind the retired flag, never a Database row
    const behindFlag = isRet || startedNonResult;

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
    let AP = null, APS = null;                                    // Pinnacle (approx.): only where no Pinnacle close exists
    if (!fromFeed && approxOn) {
      const ak = [(c[col.date] || '').trim(), (c[col.tournament] || '').trim(), (c[col.winner] || '').trim(), (c[col.loser] || '').trim()].join('|');
      const ap = approx.map.get(ak);
      if (ap) {
        approxUsed.add(ak);
        if (validPrice(num(c[col.psw])) && validPrice(num(c[col.psl]))) approx.tdHadPinnacle++;   // never over a Tennis-Data close
        else if (validPrice(P[0]) && validPrice(P[1])) approx.archiveFirst++;                       // never over our archive's close
        else {
          // start - 10 first (founder 2026-10-17), then api-tennis; each only as a two-sided pair
          const pick = ['od', 'at'].find(k => ap[k] && validPrice(ap[k][0]) && validPrice(ap[k][1]));
          if (pick) { AP = ap[pick]; APS = pick; approx.applied++; approx.appliedBySource[pick]++; }
        }
      }
    }
    const pinIdx = archLabel ? ARCH_BOOK[archLabel] : 0;
    if (archLabel && pinIdx == null) { console.error(`archive feed: unknown label ${JSON.stringify(archLabel)}`); process.exit(1); }
    const bookIdx = (validPrice(P[0]) && validPrice(P[1])) ? pinIdx : AP ? (APS === 'od' ? 5 : 2) : (validPrice(B365[0]) && validPrice(B365[1])) ? 1 : -1;
    // TEN-402: a retirement passes the SAME filters as a used row, counted in its own buckets (retBucket),
    // so the Database's reconciliation (each archive row in exactly one bucket) is untouched.
    const B_ = behindFlag ? retBucket : bucket;
    if (bookIdx < 0) { B_.noPrice++; return; }
    const [pw, pl] = isPinIdx(bookIdx) ? P : isApproxIdx(bookIdx) ? AP : B365;

    if (pw === pl) {                                            // exact tie: no favourite, no underdog
      B_.tie++;
      const dT = (c[col.date] || '').trim(), dI = parseInt(dT.replace(/-/g, ''), 10), lvT = LEVEL_MAP[(c[col.series] || '').trim()];
      if ((1 / pw) + (1 / pl) <= 1.15 && season >= WINDOW_START && Number.isFinite(dI) && lvT) {
        tieAtt.push(att());
        tieRaw.push([dI, levels.indexOf(lvT), (c[col.surface] || '').trim(), (c[col.round] || '').trim(),
          (c[col.tournament] || '').trim(), pw, pl, 1, bookIdx, (c[col.winner] || '').trim(), (c[col.loser] || '').trim(), behindFlag ? 1 : 0]);
      }
      else if ((1 / pw) + (1 / pl) <= 1.15 && season < WINDOW_START && Number.isFinite(dI)) {   // a tie before 2010: the era shard
        xAtt.push(att());
        xRaw.push([dI, lvT || null, (c[col.surface] || '').trim(), (c[col.round] || '').trim(), (c[col.tournament] || '').trim(),
          pw, pl, 1, bookIdx, (c[col.winner] || '').trim(), (c[col.loser] || '').trim(), 'pe' + (behindFlag ? 'r' : '')]);
      }
      return;
    }
    if ((1 / pw) + (1 / pl) > 1.15) { B_.overround++; return; } // corrupt market

    // pre-window regime cut: 2004-2008 is a materially different sport (founder ruling,
    // Option A, 2026-09-04). Placed AFTER the exclusion checks so those buckets keep their
    // full-archive counts and preWindow captures only otherwise-usable pre-2010 rows.
    // (2009 carries no Pinnacle and no Bet365 pair -> falls out via noPrice, not here.)
    if (season < WINDOW_START) {
      B_.preWindow++;
      // founder ruling 2026-10-17: before 2010 the match is in the master and the price join, never a Database figure
      const dP = parseInt((c[col.date] || '').trim().replace(/-/g, ''), 10);
      if (Number.isFinite(dP)) {
        xAtt.push(att());
        xRaw.push([dP, LEVEL_MAP[(c[col.series] || '').trim()] || null, (c[col.surface] || '').trim(), (c[col.round] || '').trim(),
          (c[col.tournament] || '').trim(), Math.min(pw, pl), Math.max(pw, pl), pw < pl ? 1 : 0, bookIdx,
          (c[col.winner] || '').trim(), (c[col.loser] || '').trim(), 'p' + (behindFlag ? 'r' : '')]);
        if (startedNonResult) { started.priced++; started.byComment[comment] = (started.byComment[comment] || 0) + 1; }
      }
      return;
    }

    // ---- usable row ----
    const dateStr = (c[col.date] || '').trim();
    const dateInt = parseInt(dateStr.replace(/-/g, ''), 10);
    if (!Number.isFinite(dateInt)) { B_.edge++; return; }       // unparseable date (none expected)
    if (behindFlag) {
      const canonR = LEVEL_MAP[(c[col.series] || '').trim()];
      if (!canonR) { retBucket.edge++; return; }
      retAtt.push(att());
      retRaw.push([dateInt, levels.indexOf(canonR), (c[col.surface] || '').trim(), (c[col.round] || '').trim(),
        (c[col.tournament] || '').trim(), Math.min(pw, pl), Math.max(pw, pl), pw < pl ? 1 : 0, bookIdx,
        (c[col.winner] || '').trim(), (c[col.loser] || '').trim()]);
      retBucket.priced++;
      if (startedNonResult) { started.priced++; started.byComment[comment] = (started.byComment[comment] || 0) + 1; }
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
    rowsAtt.push(att());
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
    else if (RETIRED.has((r.comment || '').trim()) || FEED_STARTED.has((r.comment || '').trim())) feed.addedRetired++;
    else feed.added++;
  }
}

// Founder ruling 2026-10-17 (fix 2): the team events (Davis Cup, Laver Cup …) our Pinnacle archive prices go into the
// master with the same source order and hover as every other match (our archive close: 3 'from Pinnacle history' /
// 4 'captured'), flagged out of every Database statistic and ROI. The same price guards: both sides >= 1.01 (here > 1.00
// as validPrice), overround <= 1.15; an exact tie is kept (flag 'e').
for (const r of feed.team) {
  const pw = num(r.psw), pl = num(r.psl), bk = ARCH_BOOK[(r.label || '').trim()];
  const dI = parseInt(String(r.date || '').replace(/-/g, ''), 10);
  if (!validPrice(pw) || !validPrice(pl) || bk == null || !Number.isFinite(dI) || (1 / pw) + (1 / pl) > 1.15) { feed.teamDropped++; continue; }
  const isRet = RETIRED.has((r.comment || '').trim()) || FEED_STARTED.has((r.comment || '').trim());   // a started default
  xAtt.push([(r.series || '').trim(), (r.court || '').trim(), (r.bestof || '').trim(), (r.comment || '').trim(), '', '']);
  xRaw.push([dI, null, (r.surface || '').trim(), (r.round || '').trim(), (r.tournament || '').trim(), Math.min(pw, pl), Math.max(pw, pl),
    pw <= pl ? 1 : 0, bk, (r.winner || '').trim(), (r.loser || '').trim(), 't' + (isRet ? 'r' : '') + (pw === pl ? 'e' : '')]);
  feed.teamKept++;
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
const BOOK_COUNTS = { Pinnacle: bookCount[0] + bookCount[3] + bookCount[4], Bet365: bookCount[1], ...(approxOn ? { [BOOKS[2]]: bookCount[2] + bookCount[5] } : {}) };
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
  // Founder ruling 2026-10-17 (close-out item 1): matches that STARTED but carry a non-result comment, priced behind the
  // retired flag (in retRows / the era shard), settled on the official result. Absent = no evidence file this run.
  ...(started.on || started.priced ? { started: {
    rule: 'A match that started is priced (behind the retired flag); a true walkover stays a dash; disagreeing sources keep the dash.',
    evidence: started.evidence, matched: started.matched, priced: started.priced, byComment: started.byComment } } : {}),
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
    rule: 'Pinnacle (approx.) — a snapshot, never a close — for an ATP main-draw match of 13 Jan - 16 Sep 2026 with no Tennis-Data ' +
      'Pinnacle close and no close in our Pinnacle archive: for 13 Apr - 16 Sep the Oddspapi Pinnacle archive at Oddspapi\'s start - 10 ' +
      'min (book 5), else api-tennis\'s stored Pinnacle price (book 2); Bet365 where neither has a pair.',
    sources: {
      od: { book: 5, source: 'oddspapi Pinnacle (start − 10)', hover: APPROX_HOVER_OD10, rows: approx.rowsBySource.od, applied: approx.appliedBySource.od, used: bookCount[5] },
      at: { book: 2, source: 'api-tennis Pinnacle', hover: APPROX_HOVER, rows: approx.rowsBySource.at, applied: approx.appliedBySource.at, used: bookCount[2] },
    },
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
  const { ARCHIVE_NAME_ALIASES, ARCHIVE_ALIAS_NAMES, ARCHIVE_PAGE_SPELLINGS } = require('./build-odds-performance.js');
  let prof = {};
  try { prof = (JSON.parse(fs.readFileSync(path.join(__dirname, 'player-profiles.json'), 'utf8')).players) || {}; } catch (e) { /* no table: page join as before */ }
  // the era shard's names too (founder 2026-10-17: before 2010 and the team events are in the join)
  const held = new Set(); for (const pr of names.concat(retNames, tieNames, xRaw.map(x => [x[9], x[10]]))) for (const n of pr || []) held.add(n);
  const aliases = {};
  const missing = [];
  for (const [n, our] of Object.entries(ARCHIVE_PAGE_SPELLINGS || {})) if (held.has(n)) aliases[n] = our;
  for (const [n, k] of Object.entries(ARCHIVE_NAME_ALIASES)) {
    if (n.includes(',') || !held.has(n) || aliases[n]) continue;
    const our = (prof[k] && prof[k].name) || ARCHIVE_ALIAS_NAMES[k];
    if (our) aliases[n] = our; else missing.push(`${n} (${k})`);
  }
  if (missing.length) console.log(`name table: aliased archive names with no spelling of ours (left unjoined): ${missing.join(', ')}`);
  return { aliases };
})();
writeAtomic(OUT_NAMES, JSON.stringify({ names, retNames, tieNames, aliases: nameTable.aliases }));
// Founder ruling 2026-10-17: the era shard (before 2010 + team events), read by the price join only. Its names sit in
// the same file; its strings are its own (no Database dictionary is touched, so no Database picker gains an entry).
const xCount = f => xRaw.filter(x => x[11].includes(f)).length;
const X_META = { schema: 1, rule: 'Priced completed matches the master holds but the Database statistics leave out: before ' + WINDOW_START +
  ' (flag p) and team events (flag t), with r = a retirement (settled on the official ATP result) and e = an exact tie. Same book ' +
  'codes as database-yield.json. Read by the price join only; no Database figure, tour baseline or ROI reads it.',
  counts: { all: xRaw.length, pre2010: xCount('p'), team: xCount('t'), retired: xCount('r'), ties: xCount('e'), teamDropped: feed.teamDropped } };
writeAtomic(OUT_X, JSON.stringify({ meta: X_META,
  xRows: xRaw.map(x => [x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], x[8], x[11]]), xNames: xRaw.map(x => [x[9], x[10]]) }));
// …and the ONE master file every builder downstream reads (build-market-edge.js): every priced completed match, one row
// each, winner first, with its price pair, book code and set (db = a Database row, ret / tie = behind their flags, x = the
// era shard). Built from the same rows as the page files above, so a price can never differ between them.
const iso = d => { const s = String(d); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };
// wrank / lrank: the archive's ranks at the match (Tennis-Data's own columns; empty for a match our archive added) — the
// legacy profile odds card's opponent-rank splits read them (founder ruling 2026-10-17, ruling 5)
const MASTER_COLS = ['date', 'tournament', 'series', 'surface', 'court', 'round', 'bestof', 'winner', 'loser', 'comment', 'pw', 'pl', 'book', 'set', 'flags', 'wrank', 'lrank'];
const masterRows = [];
const pushM = (d, tour, surf, rnd, w, l, fav, dog, favWon, book, a, set, flags) => masterRows.push([iso(d), tour, a[0], surf, a[1], rnd, a[2], w, l, a[3],
  favWon ? fav : dog, favWon ? dog : fav, book, set, flags, a[4] || '', a[5] || '']);
rows.forEach((r, i) => pushM(r[0], tournaments[r[4]], surfaces[r[2]], rounds[r[3]], names[i][0], names[i][1], r[5], r[6], r[7], r[8], rowsAtt[i], 'db', ''));
retRaw.forEach((x, i) => pushM(x[0], x[4], x[2], x[3], x[9], x[10], x[5], x[6], x[7], x[8], retAtt[i], 'ret', 'r'));
tieRaw.forEach((x, i) => pushM(x[0], x[4], x[2], x[3], x[9], x[10], x[5], x[6], x[7], x[8], tieAtt[i], 'tie', 'e' + (x[11] ? 'r' : '')));
xRaw.forEach((x, i) => pushM(x[0], x[4], x[2], x[3], x[9], x[10], x[5], x[6], x[7], x[8], xAtt[i], 'x', x[11]));
if (rowsAtt.length !== rows.length || retAtt.length !== retRaw.length || tieAtt.length !== tieRaw.length || xAtt.length !== xRaw.length) {
  console.error('master: an attribute array is out of step with its rows'); process.exit(1);
}
writeAtomic(OUT_MASTER, JSON.stringify({ meta: { schema: 1, cols: MASTER_COLS, builtFrom: 'build-database-yield.js (the same run as database-yield.json)',
  dateRange: [dateMin, dateMax], latest: masterRows.reduce((m, r) => (r[0] > m ? r[0] : m), ''), bookCodes: { 0: 'Tennis-Data Pinnacle', 1: 'Bet365 (Tennis-Data)',
  2: 'Pinnacle (approx.) api-tennis', 3: 'Pinnacle (from Pinnacle history)', 4: 'Pinnacle (captured)', 5: 'Pinnacle (approx.) start - 10' },
  counts: { all: masterRows.length, db: rows.length, ret: retRaw.length, tie: tieRaw.length, x: xRaw.length } }, rows: masterRows }));
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
console.log(`book split (used)   : Pinnacle ${bookCount[0]} (Tennis-Data) + ${bookCount[3]} from Pinnacle history + ${bookCount[4]} captured  Bet365 ${bookCount[1]}` + (approxOn ? `  Pinnacle (approx.) ${bookCount[2] + bookCount[5]} (start − 10 ${bookCount[5]}, api-tennis ${bookCount[2]}; feed ${approx.rows}: applied ${approx.applied}, Tennis-Data Pinnacle kept ${approx.tdHadPinnacle}, archive close kept ${approx.archiveFirst}, unmatched ${approx.unmatched})` : ''));
console.log(`yield ALL           : fav ${pct(yAll.fav)}  dog ${pct(yAll.dog)}  n=${yAll.n}`);
console.log(`yield Pinnacle      : fav ${pct(yPS.fav)}  dog ${pct(yPS.dog)}  n=${yPS.n}`);
console.log(`yield Bet365        : fav ${pct(yB365.fav)}  dog ${pct(yB365.dog)}  n=${yB365.n}`);
console.log(`payload base        : ${kb(fs.statSync(OUT_BASE).size)} raw / ${kb(gz(OUT_BASE))} gz`);
console.log(`payload names shard : ${kb(fs.statSync(OUT_NAMES).size)} raw / ${kb(gz(OUT_NAMES))} gz`);
console.log(`era shard (x)       : ${JSON.stringify(X_META.counts)}  ${kb(fs.statSync(OUT_X).size)} raw / ${kb(gz(OUT_X))} gz`);
console.log(`master file         : ${masterRows.length} priced matches  ${kb(fs.statSync(OUT_MASTER).size)} raw / ${kb(gz(OUT_MASTER))} gz`);
console.log(`tour baselines      : all ${pct(TB.all.yield)}  fav ${pct(TB.favourite.yield)}  ` +
  `dog ${pct(TB.underdog.yield)}  n=${TB.all.matches} matches  (Pinnacle ${TB.bookCounts.Pinnacle} / Bet365 ${TB.bookCounts.Bet365})`);
console.log(`pinnacle last priced: ${pinnacleLastPriced || '-'}`);
if (feedOn) console.log(`archive feed        : ${feed.overridden} Tennis-Data rows priced on our Pinnacle close (${feed.tdHadPinnacle} kept their Tennis-Data Pinnacle, ` +
  `${feed.overrideUnmatched} unmatched); ${feed.added} matches added + ${feed.addedRetired} retirements (flagged), ${feed.addedDropped} dropped by the filters`);
console.log(`payload baselines   : ${fs.statSync(BASELINES_OUT).size} B raw  -> ${path.basename(BASELINES_OUT)}`);
console.log(`levels=${levels.length} surfaces=${surfaces.length} rounds=${rounds.length} tournaments=${tournaments.length}`);
