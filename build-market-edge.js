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
const { readCsv, keyFromArchiveName, ourCandidateKeys, fullKey, devig, LEVEL_ALIASES, archiveOverride } = base;

const ROOT = __dirname;
const ARCHIVE_DIR = path.join(ROOT, 'odds-archive');
const OUT_DIR = path.join(ROOT, 'market-edge');
const INDEX_PATH = path.join(ROOT, 'market-edge-index.json');
const PROFILES_PATH = path.join(ROOT, 'player-profiles.json');
const SPEED_MAP_PATH = path.join(ROOT, 'court-speed-map.json');

// 2 — the 8-band role-specific price ladder (founder ruling 2026-09-18). Band ids
// and labels both changed, so a v1 shard in the browser cache cannot be read by
// the v2 renderer's drill: the id set no longer overlaps.
const SCHEMA_VERSION = 2;

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

/**
 * Price bands — the design's own ladder, not a re-derived one.
 *
 * ★ Founder ruling, 2026-09-18: "the file wins — 8 bands. Four is useless when
 *   434 of 534 land in one row." The locked export's `Player Stat Boxes.dc.html`
 *   :3117-3128 prints EIGHT bands, four per role, and its note at :3165 reads
 *   "The eight bands cover all 537 priced matches". The v7 README §5.8 still
 *   prints the superseded 4-band ladder (Under 1.50 · 1.50–2.00 · 2.00–3.00 ·
 *   Over 3.00); spec order says the .dc.html wins.
 *
 * The ladder is ROLE-SPECIFIC: the favourite ladder runs 1.01–1.99, the underdog
 * ladder 2.00–6.00+. That is the design's own arithmetic — its four favourite
 * bands sum to its favourite card (363) and its four underdog bands to its
 * underdog card (174), so a row is banded inside its role, never across roles.
 *
 * ⚠ The two ladders do NOT quite tile the price line, because role is decided by
 * "was he the shorter price", not by 2.00. A 1.95 quote against a 1.85 opponent
 * is an underdog priced below 2.00; an arbed close can make a favourite priced
 * above it. So the outer band of each ladder is a catch-all in its open
 * direction — fav's last band takes everything above 1.64, dog's first takes
 * everything below 2.50. Every role row therefore lands in exactly one band and
 * the bands still sum to the role card (§4 reconciliation). The rows whose price
 * sits outside its band's printed range are counted into `bandStraddle` and
 * published rather than silently absorbed.
 */
const FAV_BANDS = [
  { id: 'f101_120', label: '1.01 – 1.20', test: (p) => p <= 1.2 },
  { id: 'f121_140', label: '1.21 – 1.40', test: (p) => p <= 1.4 },
  { id: 'f141_164', label: '1.41 – 1.64', test: (p) => p <= 1.64 },
  { id: 'f165_199', label: '1.65 – 1.99', test: () => true },
];
const DOG_BANDS = [
  { id: 'd200_249', label: '2.00 – 2.49', test: (p) => p < 2.5 },
  { id: 'd250_349', label: '2.50 – 3.49', test: (p) => p < 3.5 },
  { id: 'd350_599', label: '3.50 – 5.99', test: (p) => p < 6.0 },
  { id: 'd600_up', label: '6.00 +', test: () => true },
];
const PRICE_BANDS = { fav: FAV_BANDS, dog: DOG_BANDS };
/** True when `price` falls outside the printed range of the band it was put in. */
const OUT_OF_RANGE = { fav: (p) => p >= 2.0, dog: (p) => p < 2.0 };

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

/**
 * ★ R1 — founder ruling, 2026-09-17. SUPERSEDES `market-1` where they conflict.
 *
 * "Headline yield, role cards, price bands and the cumulative profit chart use
 *  Pinnacle closing only. No fallback to Bet365 or any other book inside those
 *  figures — neither the Tennis-Data archive close nor Oddspapi. Bet365 may
 *  appear on ledger rows, labelled by book, but is excluded from every yield and
 *  every units figure."
 *
 * One predicate, used at every aggregation point, so the basis cannot drift apart
 * between the headline and the bands. Rows the predicate rejects are still carried
 * in `matches[]` with their own `book` label — the ledger reads those — they are
 * simply never summed into a yield or a unit count.
 */
const isYieldBasis = (side) => side.book === 'pinnacle';

function emptyAgg() {
  // profitCents, not profit. Summing `price - 1` as a float reorders with the row
  // order and has already moved a painted card 1.42 -> 1.41 on this codebase. A
  // decimal price is exact in cents, so the sum is exact in cents.
  return { n: 0, wins: 0, expSum: 0, varSum: 0, profitCents: 0, priceCents: 0, pinnacle: 0, bet365: 0 };
}

function addTo(a, side) {
  a.n += 1;
  if (side.won) a.wins += 1;
  a.expSum += side.p;
  a.varSum += side.p * (1 - side.p);
  const cents = Math.round(side.price * 100);
  a.profitCents += side.won ? cents - 100 : -100;
  a.priceCents += cents;
  if (side.book === 'pinnacle') a.pinnacle += 1; else a.bet365 += 1;
}

/**
 * A summary NEVER prints a rate its sample cannot carry. Below the gate the record and n
 * survive and every rate is null, which the page renders as a dash — README §3, "never 0,
 * never 0%, never a plausible default".
 */
function summarise(a) {
  if (!a || !a.n) return { n: 0, wins: 0, losses: 0, gate: 'none', winRate: null, expectedWinRate: null, vsMarket: null, yield: null, units: null, ci95: null, avgPrice: null, book: { pinnacle: 0, bet365: 0 } };
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
    yield: rateOk ? r1((a.profitCents / a.n) / 100 * 100) : null,
    // The role card's second figure. §5's file specifies "At 1u flat" — the units
    // actually returned — where the build showed a bare win rate; founder default
    // on the §6 item-2 question is "the file wins". Units, not a rate, because a
    // 70% win rate at odds-on prices and a 40% win rate at 3.00 are the same card
    // otherwise. Struck from the cents sum, so it is exact.
    units: a.n ? r2(a.profitCents / 100) : null,
    ci95: rateOk && se > 0 ? [r1(actual - expected - 1.96 * se), r1(actual - expected + 1.96 * se)] : null,
    avgPrice: r2(a.priceCents / a.n / 100),
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

  const byKey = new Map();
  byFullKey.forEach((e) => byKey.set(String(e.key), e));
  function resolve(archiveName) {
    // TEN-263 §2c: the shared alias/block table first (build-odds-performance.js).
    const ov = archiveOverride(archiveName);
    if (ov) return ov.block ? null : (byKey.get(String(ov.key)) || null);
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
        // R1 (founder, 2026-09-17) — the tour baseline is what every player's yield
        // is compared against, so it must rest on the SAME basis as the yields:
        // Pinnacle closing only. Left blended, a Pinnacle-only player yield would
        // be measured against a part-Bet365 field and the "vs tour" gap would be a
        // book-mix artefact rather than a finding.
        if (isYieldBasis(side)) {
          addTo(tour.all, side);
          if (level) { tour.level[level] = tour.level[level] || emptyAgg(); addTo(tour.level[level], side); }
          tour.season[season] = tour.season[season] || emptyAgg();
          addTo(tour.season[season], side);
        }

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
    let bandStraddle = 0;
    FAV_BANDS.forEach((b) => { bands.fav[b.id] = emptyAgg(); });
    DOG_BANDS.forEach((b) => { bands.dog[b.id] = emptyAgg(); });

    // R1: every aggregate below — headline, roles, bands, per-surface and the
    // cumulative curve — is struck on Pinnacle closing only. `sides` keeps every
    // priced row for `matches[]`; `basis` is the subset that may be summed.
    const basis = sides.filter(isYieldBasis);
    let cumCents = 0;
    const curve = [];
    basis.forEach((s) => {
      addTo(all, s);
      if (s.role === 'fav') addTo(fav, s);
      else if (s.role === 'dog') addTo(dog, s);
      else addTo(lvl, s);
      if (s.role !== 'level') {
        const band = PRICE_BANDS[s.role].find((b) => b.test(s.price));
        addTo(bands[s.role][band.id], s);
        if (OUT_OF_RANGE[s.role](s.price)) bandStraddle += 1;
      }
      const surf = s.surface || 'Unknown';
      bySurface[surf] = bySurface[surf] || emptyAgg();
      addTo(bySurface[surf], s);
      // Integer cents, for the same reason emptyAgg() carries cents: this running
      // total is what the cumulative chart plots, so a float drift here is a
      // visible drift in the line.
      cumCents += s.won ? Math.round(s.price * 100) - 100 : -100;
      curve.push({ d: s.date, c: Math.round(cumCents) / 100 });
    });

    const bandOut = (group) => PRICE_BANDS[group].map((b) => Object.assign({ id: b.id, label: b.label }, summarise(bands[group][b.id])));

    const surfaceOut = {};
    Object.keys(bySurface).forEach((s) => { surfaceOut[s] = summarise(bySurface[s]); });

    const out = {
      schemaVersion: SCHEMA_VERSION,
      playerKey: key,
      name: rec.name,
      // §5: every figure below is a CLOSING price. The label is not decoration — the
      // page prints it, and the book mix says how much of it is Pinnacle.
      // R1: the basis is now a single book. This string is printed on the page, so it
      // must name the basis the numbers were actually struck on — not the join's
      // wider reach. `matches[]` still carries Bet365-archive rows, labelled.
      priceBasis: 'Pinnacle closing only',
      headline: summarise(all),
      // Median over the BASIS, not over every priced row: the headline names a
      // Pinnacle-only sample, so a median drawn from a wider set would describe a
      // different population than the figure beside it.
      medianPrice: r2(median(basis.map((s) => s.price))),
      roles: { all: summarise(all), favourite: summarise(fav), underdog: summarise(dog), level: summarise(lvl) },
      bands: { favourite: bandOut('fav'), underdog: bandOut('dog') },
      surface: surfaceOut,
      curve,
      tour: { all: tourSummary, level: tourByLevel },
      coverage: {
        firstPriced: basis.length ? basis[0].date : null,
        lastPriced: basis.length ? basis[basis.length - 1].date : null,
        // Disclosure, not decoration: how many priced rows the R1 basis excluded.
        // Without it "603 priced" and a ledger showing 727 priced rows read as a
        // bug rather than as two different, correctly-labelled populations.
        pricedAnyBook: sides.length,
        excludedNonPinnacle: sides.length - basis.length,
        pinnacleEndByLevel: pinnacleEnd,
        bet365ArchiveEndByLevel: bet365End,
        // Rows banded inside their role but priced outside that band's printed
        // range — a sub-2.00 underdog or an arbed favourite above it. Published
        // because the alternative is a label that quietly lies about its rows.
        bandStraddle,
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
        book: s.book, role: s.role,
        // Per-row P&L in units, struck in cents. `inBasis` is what the modal reads
        // to grey a row out of the yield: the row is real and priced, it is simply
        // not on the R1 basis.
        pl: (s.won ? Math.round(s.price * 100) - 100 : -100) / 100,
        inBasis: isYieldBasis(s),
      })),
    };

    fs.writeFileSync(path.join(OUT_DIR, `${key}.json`), JSON.stringify(out));
    index[key] = { n: out.headline.n, yield: out.headline.yield, pinnacle: out.headline.book.pinnacle, bet365: out.headline.book.bet365 };
    shipped += 1;
  });

  fs.writeFileSync(INDEX_PATH, JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    priceBasis: 'Pinnacle closing only',
    tour: { all: tourSummary, level: tourByLevel },
    coverage: { pinnacleEndByLevel: pinnacleEnd, bet365ArchiveEndByLevel: bet365End },
    players: index,
  }, null, 1));

  log(`archive rows ${stats.rows}, ${stats.incomplete} retired/walkover excluded, ${stats.unpriced} unpriced dropped`);
  log(`player-sides ${stats.sides}, joined to a profile ${stats.joined}, exact price ties ${stats.ties}`);
  log(`tour baseline (R1, Pinnacle closing only): ${tourSummary.n} priced sides, yield ${tourSummary.yield}%, `
    + `book mix ${tourSummary.book.pinnacle} Pinnacle / ${tourSummary.book.bet365} Bet365-archive`);
  if (tourSummary.book.bet365 !== 0) {
    throw new Error(`R1 violated: ${tourSummary.book.bet365} non-Pinnacle sides reached the tour baseline`);
  }
  log(`shards written: ${shipped}`);
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { pickBook, summarise, PRICE_BANDS, GATE_FULL, GATE_SMALL };
