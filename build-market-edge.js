#!/usr/bin/env node
/**
 * build-market-edge.js — TEN-206 §5, per-player Market edge with PER-ROW book identity.
 *
 * Why this exists and why it is not build-odds-performance.js
 * -----------------------------------------------------------
 * The existing odds-performance shards declare their own priceBasis as
 * "average closing price across books, de-vigged". That average is struck at BUILD time,
 * so the per-row book identity the founder's ruling B requires was already gone by the
 * time the shard was written. No amount of page wiring can recover it. This is a second,
 * additive pass over the same source (odds-archive/*.csv) that keeps the book label on
 * every row. build-odds-performance.js is NOT modified and its consumers are untouched —
 * TEN-206 §1 "don't touch pipeline outputs other pages depend on".
 *
 * FOUNDER RULING B (TEN-206 gate 1, answered 2026-09-16)
 *   "Pinnacle, falling back to archive-Bet365 close, labelled per row."
 * and gate 2: "find a solution and do as on the design with the data of our archives
 * and api's."
 *
 * Price selection, per row, in this order:
 *   1. Pinnacle  (psw/psl)  — the book §5 names. Both sides must be present.
 *   2. Bet365    (b365w/b365l) — the Tennis-Data ARCHIVE close. This is a closing price
 *      from the same archive row, NOT the Oddspapi pre-match snapshot that §5 bars from
 *      the headline. Two different artefacts that happen to share a book name; the ticket
 *      conflates them. Rows carry book:"bet365-archive" so the UI can label them.
 * A row with neither is unpriced and is dropped, never filled from the `avg` columns —
 * an average across books has no book identity, which is the whole point of this pass.
 *
 * Why the fallback is necessary rather than cosmetic (measured over the whole archive):
 *   Pinnacle coverage:  99%+ 2010-2024, 95.8% in 2025, 0% in 2009, 4.1% in 2026.
 *   Last Pinnacle row per level: ATP250 2026-01-13 · Masters 1000 2025-11-01 ·
 *                                ATP500 2025-10-22 · Grand Slam 2025-09-07.
 *   With Pinnacle alone the Market edge box is dark from Jan 2026 for every player and
 *   the whole of 2009 is missing. With the fallback, coverage is >= 95.6% every season.
 *
 * De-vig always uses BOTH prices from the SAME book. Mixing a Pinnacle price with a
 * Bet365 opposite-side price would produce a probability that belongs to no market.
 *
 * Usage: node build-market-edge.js [--quiet] [--only <playerKey>]
 */

const fs = require('fs');
const path = require('path');

const base = require('./build-odds-performance.js');
const { readCsv, keyFromArchiveName, ourCandidateKeys, fullKey, devig, LEVEL_ALIASES } = base;

const ROOT = __dirname;
const ARCHIVE_DIR = path.join(ROOT, 'odds-archive');
const OUT_DIR = path.join(ROOT, 'market-edge');
const INDEX_PATH = path.join(ROOT, 'market-edge-index.json');
const PROFILES_PATH = path.join(ROOT, 'player-profiles.json');
const SPEED_MAP_PATH = path.join(ROOT, 'court-speed-map.json');

const SCHEMA_VERSION = 1;

/**
 * TEN-206 §5.5 — venue + Tennis Abstract speed, stamped per row so the Court speed
 * modal reads one field instead of re-deriving a name join in the browser.
 *
 * The map is built by build-court-speed-map.js (voted out of data, never hand-written);
 * this pass only CONSUMES it. With the map absent every row carries venue/speed null
 * and the modal dashes — the correct behaviour for "not wired", not a crash.
 */
function loadSpeedMap() {
  if (!fs.existsSync(SPEED_MAP_PATH)) return null;
  let helper;
  try { helper = require('./build-court-speed-map.js'); } catch (e) { return null; }
  const m = JSON.parse(fs.readFileSync(SPEED_MAP_PATH, 'utf8'));
  const CC = helper.loadCourtConditions();
  const ccKeys = Object.keys(CC).filter((k) => CC[k].abstractSpeed != null);
  const venueOf = helper.makeVenueMatcher(ccKeys);
  const cache = new Map();
  return {
    /** { venue, speed, ratingYear } or null when this row must not be banded. */
    forRow(event, surface, court) {
      if (!cache.has(event)) cache.set(event, venueOf(event) || (m.events[event] && m.events[event].venue) || null);
      const venue = cache.get(event);
      if (!venue || !CC[venue]) return null;
      // Surface guard: a row from an era the venue no longer plays is NOT banded off
      // today's rating. See build-court-speed-map.js for why this is era-based and
      // not modal-frequency based.
      const guard = m.surfaceGuard[venue];
      if (guard) {
        const sk = (surface || '?').trim() + '/' + ((court || '?').trim() || '?');
        if (sk !== guard.keep) return null;
      }
      return { venue, speed: CC[venue].abstractSpeed, ratingYear: CC[venue].abstractSpeedYear || null };
    },
  };
}

/**
 * Sample gate, README §9. Identical to the page's gate so a band that renders a rate
 * here can never disagree with one the page would grey out.
 *   n >= 10 full rate · 5-9 small sample · < 5 record only · 0 dash
 */
const GATE_FULL = 10;
const GATE_SMALL = 5;

/** Price bands are the design's own ladder (README §5.8), not a re-derived one. */
const PRICE_BANDS = [
  { id: 'u150', label: 'Under 1.50', test: (p) => p < 1.5 },
  { id: 'b150_200', label: '1.50–2.00', test: (p) => p < 2.0 },
  { id: 'b200_300', label: '2.00–3.00', test: (p) => p < 3.0 },
  { id: 'o300', label: 'Over 3.00', test: () => true },
];

const num = (v) => {
  const f = parseFloat(v);
  return Number.isFinite(f) ? f : null;
};
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

/**
 * Pick the book for one archive row. Returns null when neither book priced both sides —
 * a one-sided price cannot be de-vigged and a half-priced market is not a market.
 */
function pickBook(row) {
  const pw = num(row.psw);
  const pl = num(row.psl);
  if (pw > 1 && pl > 1) return { book: 'pinnacle', label: 'Pinnacle', w: pw, l: pl };
  const bw = num(row.b365w);
  const bl = num(row.b365l);
  if (bw > 1 && bl > 1) return { book: 'bet365-archive', label: 'Bet365 (archive close)', w: bw, l: bl };
  return null;
}

function emptyAgg() {
  return { n: 0, wins: 0, expSum: 0, varSum: 0, profit: 0, priceSum: 0, pinnacle: 0, bet365: 0 };
}

function addTo(a, side) {
  a.n += 1;
  if (side.won) a.wins += 1;
  a.expSum += side.p;
  a.varSum += side.p * (1 - side.p);
  a.profit += side.won ? side.price - 1 : -1;
  a.priceSum += side.price;
  if (side.book === 'pinnacle') a.pinnacle += 1; else a.bet365 += 1;
}

/**
 * A summary NEVER prints a rate its sample cannot carry. Below the gate the record and n
 * survive and every rate is null, which the page renders as a dash — README §3, "never 0,
 * never 0%, never a plausible default".
 */
function summarise(a) {
  if (!a || !a.n) return { n: 0, wins: 0, losses: 0, gate: 'none', winRate: null, expectedWinRate: null, vsMarket: null, yield: null, ci95: null, avgPrice: null, book: { pinnacle: 0, bet365: 0 } };
  const gate = a.n >= GATE_FULL ? 'full' : a.n >= GATE_SMALL ? 'small' : 'thin';
  const actual = (a.wins / a.n) * 100;
  const expected = (a.expSum / a.n) * 100;
  const se = (Math.sqrt(a.varSum) / a.n) * 100;
  const rateOk = gate === 'full' || gate === 'small';
  return {
    n: a.n,
    wins: a.wins,
    losses: a.n - a.wins,
    gate,
    winRate: rateOk ? r1(actual) : null,
    expectedWinRate: rateOk ? r1(expected) : null,
    vsMarket: rateOk ? r1(actual - expected) : null,
    // Flat 1-unit stake on this player every match, at the closing price actually
    // recorded for that row. Yield, not ROI on turnover — one unit per match.
    yield: rateOk ? r1((a.profit / a.n) * 100) : null,
    ci95: rateOk && se > 0 ? [r1(actual - expected - 1.96 * se), r1(actual - expected + 1.96 * se)] : null,
    avgPrice: r2(a.priceSum / a.n),
    book: { pinnacle: a.pinnacle, bet365: a.bet365 },
  };
}

function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function main() {
  const args = process.argv.slice(2);
  const quiet = args.includes('--quiet');
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
  const log = (...a) => { if (!quiet) console.log(...a); };

  const profiles = JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8')).players || {};
  const speedMap = loadSpeedMap();
  log(speedMap ? 'court-speed map loaded' : 'court-speed map absent — venue/speed will be null on every row');

  const byFullKey = new Map();
  const bySurname = new Map();
  Object.entries(profiles).forEach(([key, p]) => {
    const cands = ourCandidateKeys(p.name);
    if (!cands.length) return;
    const primary = cands[0];
    const entry = { key, name: p.name, k: primary };
    byFullKey.set(fullKey(primary), entry);
    cands.forEach((ck) => {
      const e = ck === primary ? entry : { key, name: p.name, k: ck };
      if (!bySurname.has(ck.surname)) bySurname.set(ck.surname, []);
      bySurname.get(ck.surname).push(e);
    });
  });

  function resolve(archiveName) {
    const k = keyFromArchiveName(archiveName);
    if (!k) return null;
    const exact = byFullKey.get(fullKey(k));
    if (exact) return exact;
    const cands = (bySurname.get(k.surname) || []).filter((c) => {
      const a = c.k.initials; const b = k.initials;
      return a && b && (a.startsWith(b) || b.startsWith(a));
    });
    return cands.length === 1 ? cands[0] : null;
  }

  /**
   * TEN-206 §5.6 — the OPPONENT's archetype, stamped per row.
   *
   * SSOT is playing-styles.json `archetype_label`, the board-finalised v5.1 roster
   * that matchup-matrix.json also declares as its own source. Labels and IDs are
   * carried verbatim; the modal does no renaming. (The ticket asks for "v5.2" — no
   * such taxonomy exists in this repo, reported at recon.)
   *
   * Resolution reuses `resolve` above, the same archive-name matcher that joins the
   * SUBJECT of every row, so an opponent and a subject can never disagree about who
   * a name refers to. Unlabelled -> null, which the modal reads as "not archetyped"
   * and counts out loud. It is not a small residue for long careers: the roster is
   * the CURRENT 250 players, so a 2008 opponent is usually absent by construction.
   */
  const stylesPath = path.join(ROOT, 'playing-styles.json');
  const archetypeByName = new Map();
  if (fs.existsSync(stylesPath)) {
    for (const s of JSON.parse(fs.readFileSync(stylesPath, 'utf8')).players || []) {
      if (s && s.name && s.archetype_label) archetypeByName.set(s.name, s.archetype_label);
    }
  }
  log(`archetype roster: ${archetypeByName.size} labelled players`);
  const archetypeOf = (archiveName) => {
    const hit = resolve(archiveName);
    return hit ? (archetypeByName.get(hit.name) || null) : null;
  };

  const seasons = fs.readdirSync(ARCHIVE_DIR).filter((f) => /^\d{4}\.csv$/.test(f)).sort();
  if (!seasons.length) throw new Error(`no season files in ${ARCHIVE_DIR}`);

  // Tour baseline (README §3: "tour baseline" must be COMPUTED over the same window and
  // level, never a rounded constant). Every priced player-side in the archive, backed
  // flat. It comes out near the vig, which is the point — it is what backing the field
  // blind returns, and it is the number each player's yield is compared against.
  const tour = { all: emptyAgg(), level: {}, season: {} };
  const perPlayer = new Map();
  const stats = { rows: 0, incomplete: 0, unpriced: 0, sides: 0, joined: 0, ties: 0 };

  seasons.forEach((file) => {
    const season = file.slice(0, 4);
    readCsv(path.join(ARCHIVE_DIR, file)).forEach((row) => {
      stats.rows += 1;
      // Retirements and walkovers: the price was struck for a match that was never
      // played out. Same exclusion the existing builder makes, for the same reason.
      if (row.comment && row.comment.toLowerCase() !== 'completed') { stats.incomplete += 1; return; }

      const bk = pickBook(row);
      if (!bk) { stats.unpriced += 1; return; }

      const pWin = devig(bk.w, bk.l);
      const pLose = devig(bk.l, bk.w);
      if (pWin == null || pLose == null) return;
      if (bk.w === bk.l) stats.ties += 1;

      const level = LEVEL_ALIASES[row.series] || null;
      const sides = [
        { name: row.winner, opp: row.loser, won: true, p: pWin, price: bk.w, oppPrice: bk.l },
        { name: row.loser, opp: row.winner, won: false, p: pLose, price: bk.l, oppPrice: bk.w },
      ];

      sides.forEach((s) => {
        stats.sides += 1;
        const side = {
          date: row.date, event: row.tournament, level, surface: row.surface,
          // Court type (Indoor/Outdoor). The archive's `court` column is 100%
          // populated across 2004-2026 (59,433 rows, 10,412 Indoor) — measured,
          // not assumed — so this is carried through rather than derived. It is
          // what the Calendar modal's Indoors segment reads. Scope is the
          // archive's: ATP tour MAIN DRAW only, which is why the Record-by-season
          // grid cannot use it and reads api-tennis's "(Indoor)" surface instead.
          court: (row.court || '').trim() || null,
          round: row.round, season,
          speed: speedMap ? speedMap.forRow(row.tournament, row.surface, row.court) : null,
          oppArchetype: archetypeOf(s.opp),
          opp: s.opp, won: s.won, p: s.p, price: s.price, oppPrice: s.oppPrice,
          book: bk.book, bookLabel: bk.label,
          // role: strictly "was he the shorter price". An exact tie is neither, and is
          // counted as such rather than shoved into one card to make a sum work.
          role: s.price < s.oppPrice ? 'fav' : s.price > s.oppPrice ? 'dog' : 'level',
        };
        addTo(tour.all, side);
        if (level) { tour.level[level] = tour.level[level] || emptyAgg(); addTo(tour.level[level], side); }
        tour.season[season] = tour.season[season] || emptyAgg();
        addTo(tour.season[season], side);

        const hit = resolve(s.name);
        if (!hit) return;
        if (only && hit.key !== only) return;
        stats.joined += 1;
        if (!perPlayer.has(hit.key)) perPlayer.set(hit.key, { name: hit.name, sides: [] });
        perPlayer.get(hit.key).sides.push(side);
      });
    });
  });

  const tourSummary = summarise(tour.all);
  const tourByLevel = {};
  Object.keys(tour.level).forEach((L) => { tourByLevel[L] = summarise(tour.level[L]); });

  // Coverage disclosure per level — §5 asks for "Pinnacle coverage end date per level".
  const pinnacleEnd = {};
  const bet365End = {};
  seasons.forEach((file) => {
    readCsv(path.join(ARCHIVE_DIR, file)).forEach((row) => {
      const L = LEVEL_ALIASES[row.series] || row.series;
      if (num(row.psw) > 1 && num(row.psl) > 1 && (!pinnacleEnd[L] || row.date > pinnacleEnd[L])) pinnacleEnd[L] = row.date;
      if (num(row.b365w) > 1 && num(row.b365l) > 1 && (!bet365End[L] || row.date > bet365End[L])) bet365End[L] = row.date;
    });
  });

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const index = {};
  let shipped = 0;
  perPlayer.forEach((rec, key) => {
    const sides = rec.sides.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const all = emptyAgg(); const fav = emptyAgg(); const dog = emptyAgg(); const lvl = emptyAgg();
    const bands = { fav: {}, dog: {} };
    const bySurface = {};
    PRICE_BANDS.forEach((b) => { bands.fav[b.id] = emptyAgg(); bands.dog[b.id] = emptyAgg(); });

    let cum = 0;
    const curve = [];
    sides.forEach((s) => {
      addTo(all, s);
      if (s.role === 'fav') addTo(fav, s);
      else if (s.role === 'dog') addTo(dog, s);
      else addTo(lvl, s);
      if (s.role !== 'level') {
        const band = PRICE_BANDS.find((b) => b.test(s.price));
        addTo(bands[s.role][band.id], s);
      }
      const surf = s.surface || 'Unknown';
      bySurface[surf] = bySurface[surf] || emptyAgg();
      addTo(bySurface[surf], s);
      cum += s.won ? s.price - 1 : -1;
      curve.push({ d: s.date, c: Math.round(cum * 100) / 100 });
    });

    const bandOut = (group) => PRICE_BANDS.map((b) => Object.assign({ id: b.id, label: b.label }, summarise(bands[group][b.id])));

    const surfaceOut = {};
    Object.keys(bySurface).forEach((s) => { surfaceOut[s] = summarise(bySurface[s]); });

    const out = {
      schemaVersion: SCHEMA_VERSION,
      playerKey: key,
      name: rec.name,
      // §5: every figure below is a CLOSING price. The label is not decoration — the
      // page prints it, and the book mix says how much of it is Pinnacle.
      priceBasis: 'closing price, Pinnacle where present, else Bet365 archive close, labelled per row',
      headline: summarise(all),
      medianPrice: r2(median(sides.map((s) => s.price))),
      roles: { all: summarise(all), favourite: summarise(fav), underdog: summarise(dog), level: summarise(lvl) },
      bands: { favourite: bandOut('fav'), underdog: bandOut('dog') },
      surface: surfaceOut,
      curve,
      tour: { all: tourSummary, level: tourByLevel },
      coverage: {
        firstPriced: sides.length ? sides[0].date : null,
        lastPriced: sides.length ? sides[sides.length - 1].date : null,
        pinnacleEndByLevel: pinnacleEnd,
        bet365ArchiveEndByLevel: bet365End,
      },
      // Per-row detail for the drills. Every row carries its own book so the modal can
      // print "Pinnacle" or "Bet365 close" beside the price rather than a blanket claim.
      matches: sides.map((s) => ({
        date: s.date, event: s.event, level: s.level, surface: s.surface,
        court: s.court, round: s.round,
        // §5.5 Court speed. Null means "this row cannot be banded" — either we hold no
        // Abstract rating for the venue or the row predates the venue's current
        // surface. The modal counts those out loud rather than dropping them.
        venue: s.speed ? s.speed.venue : null,
        speed: s.speed ? s.speed.speed : null,
        // §5.6 Versus playing styles. Null = this opponent is not on the labelled
        // roster; the modal counts those rather than folding them into a bucket.
        oppArchetype: s.oppArchetype,
        opp: s.opp, won: s.won, price: r2(s.price), oppPrice: r2(s.oppPrice),
        book: s.book, role: s.role, pl: Math.round((s.won ? s.price - 1 : -1) * 100) / 100,
      })),
    };

    fs.writeFileSync(path.join(OUT_DIR, `${key}.json`), JSON.stringify(out));
    index[key] = { n: out.headline.n, yield: out.headline.yield, pinnacle: out.headline.book.pinnacle, bet365: out.headline.book.bet365 };
    shipped += 1;
  });

  fs.writeFileSync(INDEX_PATH, JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    priceBasis: 'closing price, Pinnacle where present, else Bet365 archive close, labelled per row',
    tour: { all: tourSummary, level: tourByLevel },
    coverage: { pinnacleEndByLevel: pinnacleEnd, bet365ArchiveEndByLevel: bet365End },
    players: index,
  }, null, 1));

  log(`archive rows ${stats.rows}, ${stats.incomplete} retired/walkover excluded, ${stats.unpriced} unpriced dropped`);
  log(`player-sides ${stats.sides}, joined to a profile ${stats.joined}, exact price ties ${stats.ties}`);
  log(`tour baseline: ${tourSummary.n} priced sides, yield ${tourSummary.yield}%, book mix ${tourSummary.book.pinnacle} Pinnacle / ${tourSummary.book.bet365} Bet365-archive`);
  log(`shards written: ${shipped}`);
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { pickBook, summarise, PRICE_BANDS, GATE_FULL, GATE_SMALL };
