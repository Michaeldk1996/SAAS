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
 * R8 (founder, 2026-09-28): per side, in the Match analysis tab's order (FH_BOOK_ORDER) —
 * our captured Pinnacle → Tennis-Data Pinnacle → Tennis-Data Bet365 → our captured Bet365.
 * Captures are read from match-closes/{key}.json (pipeline: build-match-closes runs first).
 * A row with none of them is unpriced and is dropped, never filled from the `avg` columns —
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
// TEN-310 (founder ruling 2026-09-27): the profile's Market edge uses the Match analysis Market edge
// tab's rules, through the same compute — bands, role and P&L come from market-edge-core.js.
const core = require('./market-edge-core.js');
// Founder ruling 2026-10-25 (round 2 item 1.3): the retirement rules live in settlement.js — settleBet (Pinnacle rules)
// decides every unit / yield figure here; this file never re-derives it.
const Settlement = require('./settlement.js');
const { readCsv, keyFromArchiveName, ourCandidateKeys, fullKey, devig, LEVEL_ALIASES, archiveOverride } = base;

const { buildIdentityGate } = require('./td-identity.js');
const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'market-edge');
const INDEX_PATH = path.join(ROOT, 'market-edge-index.json');
const PROFILES_PATH = path.join(ROOT, 'player-profiles.json');
const MASTER_PATH = path.join(ROOT, 'database-yield-master.json');   // the one master file (build-database-yield.js)
const SPEED_MAP_PATH = path.join(ROOT, 'court-speed-map.json');

// 3 — TEN-310 basis (2026-09-27): Pinnacle close, else Bet365 close; favourite = price < 2.00;
// half-open bands. Band ids are unchanged from v2 (the 8-band ladder of 2026-09-18).
const SCHEMA_VERSION = 3;
// The basis every figure is struck on. Printed on the page; asserted by the pipeline.
const PRICE_BASIS = 'Pinnacle closing, else Bet365 closing';

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
 * Price bands — the 8-band ladder (founder ruling 2026-09-18), ids and labels unchanged.
 *
 * ★ TEN-310 ruling (2026-09-27): "Both use this tab's rules." A row's band is decided by its own price
 *   alone, through market-edge-core.js `bandOf` — half-open [1.01,1.21) [1.21,1.41) [1.41,1.65)
 *   [1.65,2.00) | [2.00,2.50) [2.50,3.50) [3.50,6.00) [6.00,∞) — and its role follows: favourite =
 *   price < 2.00, underdog = 2.00 and above. This replaces "role = the shorter price" and the outer
 *   catch-all bands it needed; no row can sit outside its band's printed range any more, so
 *   `bandStraddle` is 0 by construction.
 */
const FAV_BANDS = [
  { id: 'f101_120', label: '1.01 – 1.20' },
  { id: 'f121_140', label: '1.21 – 1.40' },
  { id: 'f141_164', label: '1.41 – 1.64' },
  { id: 'f165_199', label: '1.65 – 1.99' },
];
const DOG_BANDS = [
  { id: 'd200_249', label: '2.00 – 2.49' },
  { id: 'd250_349', label: '2.50 – 3.49' },
  { id: 'd350_599', label: '3.50 – 5.99' },
  { id: 'd600_up', label: '6.00 +' },
];
const PRICE_BANDS = { fav: FAV_BANDS, dog: DOG_BANDS };
/** The band (from the shared core) of a price: { role, band } or null below the 1.01 floor. */
function bandFor(price) {
  const i = core.bandOf(price);
  if (i < 0) return null;
  return i < 4 ? { role: 'fav', band: FAV_BANDS[i] } : { role: 'dog', band: DOG_BANDS[i - 4] };
}

const num = (v) => {
  const f = parseFloat(v);
  return Number.isFinite(f) ? f : null;
};
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
// A closing price at the precision the bands use (thousandths: 1.645, a captured 1.177).
const r3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);

/**
 * Pick the book for one archive row. Returns null when neither book priced both sides —
 * a one-sided price cannot be de-vigged and a half-priced market is not a market.
 */
/** R8: the archive row's two pairs, each [winner, loser] or null (both sides > 1.00). */
function pickBookPairs(row) {
  const two = (a, b) => (num(a) > 1 && num(b) > 1 ? [num(a), num(b)] : null);
  return { P: two(row.psw, row.psl), B: two(row.b365w, row.b365l) };
}
const dayNum = (iso) => { const t = Date.parse(String(iso || '').slice(0, 10) + 'T00:00:00Z'); return Number.isFinite(t) ? t / 864e5 : null; };
/** A captured pair for one side: the subject's capture against this opponent (by key), within ±1 day,
 *  exactly one candidate — the page's fhCloseFor capture rule. */
function capPair(caps, book, date, oppKey) {
  if (!caps || !oppKey) return null;
  const d0 = dayNum(date);
  const hits = caps.filter((c) => c[book] && c.oppKey === oppKey && d0 != null && dayNum(c.date) != null && Math.abs(dayNum(c.date) - d0) <= 1);
  return hits.length === 1 ? hits[0][book] : null;
}
/** The tab's order, FH_BOOK_ORDER = Pcap, Ptd, Btd, Bcap (R8 ruling 2026-09-28: captured Pinnacle first). Returns { book, label, price, oppPrice } or null. */
function pickSide(b, caps, date, oppKey) {
  const order = [
    ['pinnacle-capture', 'Pinnacle (our capture)', () => capPair(caps, 'P', date, oppKey)],
    ['pinnacle', 'Pinnacle', () => b.tdP],
    ['bet365-archive', 'Bet365 (archive close)', () => b.tdB],
    ['bet365-capture', 'Bet365 (our capture)', () => capPair(caps, 'B', date, oppKey)],
  ];
  for (const [book, label, f] of order) {
    const pr = f();
    if (pr && pr[0] >= 1.01 && pr[1] >= 1.01) return { book, label, price: pr[0], oppPrice: pr[1] };
  }
  return null;
}
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
 * ★ TEN-310 ruling (2026-09-27) — SUPERSEDES R1 (2026-09-17, "Pinnacle closing only").
 * "Both use this tab's rules": every figure — headline, role cards, bands, the cumulative curve and
 * the tour baseline — is struck on the Form/H2H price rule: Pinnacle close, else Bet365 close, one
 * book per row (`pickBook`). Every priced row is on the basis; `inBasis` stays on the rows for the
 * renderer and is true for each of them.
 */
// The 1.01 floor (CLAUDE.md odds invariant) is the core's too: a price below it has no band, so it is
// on no basis — never in the headline while missing from the bands.
const BASIS_BOOKS = new Set(['pinnacle', 'pinnacle-capture', 'bet365-archive', 'bet365-capture',
  'pinnacle-history', 'pinnacle-approx', 'pinnacle-approx-od10', 'pinnacle-early', 'pinnacle-approx-te', 'bet365-approx-te']);   // the Database's own books (founder 2026-10-17, item 1; 9 = early cut 2026-10-25; 8 = Tennis Explorer 2026-10-30)

// Founder ruling 2026-10-17: the master's book codes (build-database-yield.js) -> this file's book ids and labels.
const DB_BOOK = {
  0: ['pinnacle', 'Pinnacle'], 1: ['bet365-archive', 'Bet365 (archive close)'], 2: ['pinnacle-approx', 'Pinnacle (approx.)'],
  3: ['pinnacle-history', 'Pinnacle (from Pinnacle history)'], 4: ['pinnacle-capture', 'Pinnacle (our capture)'],
  5: ['pinnacle-approx-od10', 'Pinnacle (approx., start − 10)'],
  // founder ruling 2026-10-25 (the 13 Apr - 16 Sep fill): a Pinnacle price cut the tier buffer before the start, not a close
  9: ['pinnacle-early', 'Pinnacle (early cut, not a close)'],
  // founder ruling 2026-10-30 ("TE above Bet365"): Tennis Explorer's last pre-match Pinnacle price on the ATP main draw — a
  // snapshot, never a close; the page names it "Pinnacle (approx.) · Tennis Explorer, last pre-match price, not a confirmed close"
  8: ['pinnacle-approx-te', 'Pinnacle (approx.) · Tennis Explorer'],
  // founder 2026-10-30: Tennis Explorer's Bet365 on an ATP main-draw match that would otherwise be a dash — never a close
  10: ['bet365-approx-te', 'Bet365 (approx.) · Tennis Explorer'],
};
// ruling 4 (founder 2026-10-22): a retirement is on the basis only when its first set was completed (Pinnacle's rule) —
// void, or no set scores, leaves every aggregate (player, band, curve, tour)
const isYieldBasis = (side) => BASIS_BOOKS.has(side.book) && core.bandOf(side.price) >= 0 && Settlement.betCounts(side);

// Ruling 4 · item 1 (founder 2026-10-23): the first set of a retirement from the PLAYERS' OWN career rows, when
// tools/started-evidence.js left it unknown. The evidence join is narrower than the page's (measured 23 Oct: 30 of the 1,282
// profile-ledger retirements with units settled "no set scores" though both career rows held the first set):
//   8 had no Tennis-Data row (2026 matches priced from our own archive, which the evidence file never reads);
//   7 met an earlier meeting of the same pair inside the -16..+3 day window and refused to pick;
//   5 were archive rows dated at the event's Monday start, one day "after" Tennis-Data's Sunday first round;
//   6 had Tennis-Data's winner as our row's loser (the first set does not depend on who won);
//   4 had an opponent name the evidence resolver could not key.
// So: each side's player (the builder's own resolveAt), his career rows against that opponent's SURNAME dated -16..+1 days
// from the match (archive rows carry the event start), the latest such meeting only (one row on that day, or no answer),
// and the two players' rows must agree. 'c' complete, 'i' incomplete, 'm' unknown — never guessed.
const sameSurname = (x, y) => {
  const t = (v) => String(v || '').replace(/(jr|sr|ii|iii)$/, '');
  const p = t(x), q = t(y);
  if (!p || !q) return false;
  return p === q || (Math.min(p.length, q.length) >= 4 && (p.endsWith(q) || q.endsWith(p)));
};
function careerFirstSet(row, resolveAt, rowsOf) {
  const dayN = (x) => Date.parse(String(x).slice(0, 10)) / 864e5;
  const d = dayN(row.date);
  if (!Number.isFinite(d)) return 'm';
  const states = [];
  for (const [me, opp] of [[row.winner, row.loser], [row.loser, row.winner]]) {
    const h = resolveAt(me, row.date);
    const ok = keyFromArchiveName(opp);
    if (!h || !ok) continue;
    const near = (rowsOf(h.key) || []).filter((x) => {
      if (!x || x.walkover || x.unconfirmed) return false;
      const dd = dayN(x.date) - d;
      return dd >= -16 && dd <= 1 && ourCandidateKeys(x.opponent).some((c) => sameSurname(c.surname, ok.surname));
    });
    if (!near.length) continue;
    const latest = near.reduce((m, x) => (String(x.date) > m ? String(x.date) : m), '');
    const at = near.filter((x) => String(x.date) === latest);
    if (at.length !== 1) continue;
    const st = Settlement.firstSetState(at[0].sets);
    if (st !== 'missing') states.push(st);
  }
  if (!states.length || states.some((x) => x !== states[0])) return 'm';
  return states[0] === 'complete' ? 'c' : 'i';
}

function emptyAgg() {
  // profitCents, not profit. Summing `price - 1` as a float reorders with the row
  // order and has already moved a painted card 1.42 -> 1.41 on this codebase. A
  // decimal price is exact in cents, so the sum is exact in cents.
  return { n: 0, wins: 0, expSum: 0, varSum: 0, profitCents: 0, priceCents: 0, pinnacle: 0, bet365: 0, approx: 0 };
}

function addTo(a, side) {
  a.n += 1;
  if (side.won) a.wins += 1;
  a.expSum += side.p;
  a.varSum += side.p * (1 - side.p);
  const cents = Math.round(side.price * 100);
  a.profitCents += core.plCents(side);          // the tab's P&L, the same function
  a.priceCents += cents;
  // Pinnacle (approx.) and the early cut (book 9, 2026-10-25): never a close — counted with the snapshots
  if (String(side.book).startsWith('pinnacle-approx') || side.book === 'pinnacle-early') a.approx += 1;
  else if (String(side.book).startsWith('pinnacle')) a.pinnacle += 1; else a.bet365 += 1;
}

/**
 * A summary NEVER prints a rate its sample cannot carry. Below the gate the record and n
 * survive and every rate is null, which the page renders as a dash — README §3, "never 0,
 * never 0%, never a plausible default".
 */
function summarise(a) {
  if (!a || !a.n) return { n: 0, wins: 0, losses: 0, gate: 'none', winRate: null, expectedWinRate: null, vsMarket: null, yield: null, units: null, ci95: null, avgPrice: null, book: { pinnacle: 0, bet365: 0, approx: 0 } };
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
    book: { pinnacle: a.pinnacle, bet365: a.bet365, approx: a.approx },
  };
}

/** Tennis-Data `comment` of an in-match retirement: "Retired", and the archive's one "Rrtired" typo (settlement.js kindOf). */
const isRetiredComment = (c) => Settlement.kindOf(c) === 'retired';

/** The player-profile roster this builder joins on: player-profiles.json, plus every player that already has a
 *  market-edge shard (TEN-263, ruling 2026-09-24 — the pipeline's profiles are the eager board roster). */
function rosterProfiles(root) {
  const profiles = JSON.parse(fs.readFileSync(path.join(root, 'player-profiles.json'), 'utf8')).players || {};
  const outDir = path.join(root, 'market-edge');
  if (fs.existsSync(outDir)) {
    for (const f of fs.readdirSync(outDir)) {
      const m = /^(\d+)\.json$/.exec(f);
      if (!m || profiles[m[1]]) continue;
      try { const s = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8')); if (s && s.name) profiles[m[1]] = { name: s.name }; } catch (e) { /* unreadable shard: rebuilt only if the profile roster has it */ }
    }
  }
  return profiles;
}

/** The archive-name → player join (TEN-263 §2c alias table first, then the full key, then a unique surname + initials
 *  prefix), gated by the identity gate (founder 2026-10-18, td-identity.js). Returns { resolve, resolveAt, idGate }. */
function makeResolver(root, profiles) {
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

  // founder ruling 2026-10-18 (the Martín mix-up): one identity gate on every Tennis-Data name join (td-identity.js)
  const idGate = buildIdentityGate(root, new Map(Object.entries(profiles).map(([k, p]) => [k, p && p.name])));
  const resolveAt = (archiveName, date, opp) => { const h = resolve(archiveName); return h && idGate && date && !idGate.allow(h.key, archiveName, date, opp) ? null : h; };   // opp: the row's other side (gate rule 4)
  return { resolve, resolveAt, idGate };
}

/** Ruling 4 (founder 2026-10-22): a retired master row's first set — 'c' complete, 'i' incomplete, 'm' unknown, never
 *  guessed. tools/started-evidence.js's answer first (written earlier in the same run; keyed date|tournament|winner|loser),
 *  else the players' own career rows (careerFirstSet, ruling 4 · item 1). ONE lookup: this builder and
 *  build-database-yield.js (the Database's retRows, founder 2026-10-25) both read it, so a retirement can never settle
 *  one way on Market edge and another on the Database. Returns { of(row) → { fs, fromCareer }, evidence: bool }. */
function firstSetLookup(root, opts) {
  const o = opts || {};
  const evPath = o.evidencePath || path.join(root, 'started-evidence.json');
  const retFs = new Map();
  const evidence = fs.existsSync(evPath);
  if (evidence) {
    const ev = JSON.parse(fs.readFileSync(evPath, 'utf8'));
    (ev.retired || []).forEach((x) => retFs.set([x.date, x.tournament, x.winner, x.loser].join('|'), x.fs));
  }
  const chDir = path.join(root, 'career-history'), chCache = new Map();
  const rowsOf = (k) => {
    if (!chCache.has(k)) { let v = null; try { v = JSON.parse(fs.readFileSync(path.join(chDir, k + '.json'), 'utf8')).matches || null; } catch (e) { v = null; } chCache.set(k, v); }
    return chCache.get(k);
  };
  let resolveAt = o.resolveAt || null;
  const of = (row) => {
    const fs0 = retFs.get([row.date, row.tournament, row.winner, row.loser].join('|')) || 'm';
    if (fs0 !== 'm') return { fs: fs0, fromCareer: false };
    if (!resolveAt) {
      if (!fs.existsSync(path.join(root, 'player-profiles.json'))) return { fs: 'm', fromCareer: false };
      resolveAt = makeResolver(root, rosterProfiles(root)).resolveAt;
    }
    const v = careerFirstSet(row, resolveAt, rowsOf);
    return { fs: v, fromCareer: v !== 'm' };
  };
  return { of, evidence, evidencePath: evPath };
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
  // Build stamp (TEN-263 follow-up, founder 2026-09-24): when this run built the files, and
  // from which commit. "Assert site completeness" WARNS (does not fail) when the shipped index was
  // not built by this run (the committed floor carries an older stamp, or none), and the
  // Market edge modal prints it as "rebuilt DD Mon HH:MMZ".
  const stamp = { builtAt: new Date().toISOString(), builtFromCommit: process.env.GITHUB_SHA || null };

  // TEN-263 (ruling 2026-09-24): market-edge is a per-run pipeline output. The pipeline's
  // player-profiles.json is the eager board roster, so without this a run would refresh only
  // the players on today's board and leave every other published shard as it was. Every
  // player that already has a shard stays on the roster (its shard carries its name) — rosterProfiles().
  const profiles = rosterProfiles(ROOT);
  const speedMap = loadSpeedMap();
  log(speedMap ? 'court-speed map loaded' : 'court-speed map absent — venue/speed will be null on every row');

  const { resolveAt, idGate } = makeResolver(ROOT, profiles);
  log(idGate ? 'identity gate: career-history store loaded' : 'SKIP identity gate: no career-history store (names joined as before)');

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
  const archetypeOf = (archiveName, date) => {
    const hit = resolveAt(archiveName, date);
    return hit ? (archetypeByName.get(hit.name) || null) : null;
  };

  // Founder ruling 2026-10-17 ("one source of truth for every match and every price"): Market edge reads the ONE master
  // file build-database-yield.js writes in the same run (database-yield-master.json) — never the Tennis-Data files (they
  // stopped on 6 Oct and would never show a new match) and never a capture of its own. Every row is a priced completed
  // ATP main-draw match with the Database's price, book and source, winner first. Team events (flag t) stay out, as they
  // stay out of every Database statistic and ROI; before 2010 (flag p) is in, as Market edge always showed it. No master
  // = no build (the committed floor ships and the lag guard says so), never a fallback.
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8'));
  const MC = master.meta && master.meta.cols;
  if (!Array.isArray(MC) || !Array.isArray(master.rows)) throw new Error(`${MASTER_PATH}: not a master file`);
  const ci = {}; MC.forEach((c, i) => { ci[c] = i; });
  const tour = { all: emptyAgg(), level: {}, season: {} };
  const perPlayer = new Map();
  const stats = { rows: 0, retired: 0, team: 0, sides: 0, joined: 0, ties: 0, latest: '', retStands: 0, retVoid: 0, retNoSets: 0 };
  // ruling 4: each retired Tennis-Data row's first set (tools/started-evidence.js, written earlier in the same run). No file
  // = no evidence: every retirement then carries no units — never guessed — and the log says so.
  const EV_PATH = process.env.DB_YIELD_STARTED || path.join(ROOT, 'started-evidence.json');
  const firstSet = firstSetLookup(ROOT, { evidencePath: EV_PATH, resolveAt });
  if (!firstSet.evidence) log(`ruling 4: ${EV_PATH} absent — every retirement carries no units this run`);
  const noSetsRows = [];
  const pinnacleEnd = {};
  const bet365End = {};

  // Founder ruling 2026-10-18 ("one match problem must never stop the site"): the publish run's quarantine
  // (price-quarantine.json, tools/price-consistency.mjs --quarantine-out) names each match a page priced while the join did
  // not, or priced differently. Such a match is a dash on every page, Market edge included, so this build leaves its master
  // row out of every player's shard (the tour baseline keeps it: it is the Database's own aggregate). Next run, a match
  // that joins cleanly is not quarantined and comes back by itself.
  const qPath = process.env.PRICE_QUARANTINE || null;
  const qz = qPath && fs.existsSync(qPath) ? (JSON.parse(fs.readFileSync(qPath, 'utf8')).entries || []) : [];
  const qDb = new Set(qz.map((e) => e.db).filter(Boolean));
  const qMe = new Set(qz.flatMap((e) => e.me || []).map((x) => `${x.key}|${x.date}|${x.opp}|${x.won ? 1 : 0}`));
  stats.quarantined = 0;

  master.rows.forEach((m) => {
    const row = { date: m[ci.date], tournament: m[ci.tournament], series: m[ci.series], surface: m[ci.surface], court: m[ci.court],
      round: m[ci.round], winner: m[ci.winner], loser: m[ci.loser], comment: m[ci.comment] };
    const quarantined = (qDb.size || qMe.size) && (qDb.has(`${String(row.date).replace(/-/g, '')}|${row.winner}|${row.loser}`)
      || [[row.winner, row.loser, 1], [row.loser, row.winner, 0]].some(([nm, opp, w]) => { const h = resolveAt(nm, row.date, opp); return h && qMe.has(`${h.key}|${row.date}|${opp}|${w}`); }));
    const flags = String(m[ci.flags] || '');
    if (flags.includes('t')) { stats.team += 1; return; }   // a team event: in the master, never in Market edge (as the Database)
    if (flags.includes('l')) { stats.lower = (stats.lower || 0) + 1; return; }   // ATP qualifying / Challenger / ITF (founder 2026-10-18): the join's, never Market edge's
    const bk = DB_BOOK[m[ci.book]];
    if (!bk) throw new Error(`master: unknown book code ${m[ci.book]} on ${row.date} ${row.winner} v ${row.loser}`);
    stats.rows += 1;
    if (row.date > stats.latest) stats.latest = row.date;
    const season = String(row.date).slice(0, 4);
    const retired = isRetiredComment(row.comment);
    if (retired) stats.retired += 1;
    // ruling 4: the evidence file's first set, else (item 1) the players' own career rows — the shared lookup
    const fsHit = retired ? firstSet.of(row) : null;
    const fsv = fsHit ? fsHit.fs : null;
    if (fsHit && fsHit.fromCareer) stats.retFromCareer = (stats.retFromCareer || 0) + 1;
    if (retired) {
      const st = Settlement.settleBet({ ret: true, fs: fsv });
      if (st === 'stands') stats.retStands += 1; else if (st === 'void') stats.retVoid += 1;
      else { stats.retNoSets += 1; noSetsRows.push(`${row.date} ${row.tournament}: ${row.winner} d. ${row.loser}`); }
    }
    const level = LEVEL_ALIASES[row.series] || null;
    const L = level || row.series;
    if (/^pinnacle(-history|-capture)?$/.test(bk[0]) && (!pinnacleEnd[L] || row.date > pinnacleEnd[L])) pinnacleEnd[L] = row.date;
    if (bk[0] === 'bet365-archive' && (!bet365End[L] || row.date > bet365End[L])) bet365End[L] = row.date;
    const pw = num(m[ci.pw]), pl = num(m[ci.pl]);
    if (pw === pl) stats.ties += 1;
    [{ name: row.winner, opp: row.loser, won: true }, { name: row.loser, opp: row.winner, won: false }].forEach((b) => {
      const price = b.won ? pw : pl, oppPrice = b.won ? pl : pw;
      const p = devig(price, oppPrice);
      if (p == null) return;
      stats.sides += 1;
      const side = {
        date: row.date, event: row.tournament, level, surface: row.surface,
        // Court type (Indoor/Outdoor), carried in the master from Tennis-Data's court column (the feed's for added
        // matches): what the Calendar modal's Indoors segment reads. Scope: ATP tour MAIN DRAW only.
        court: (row.court || '').trim() || null,
        round: row.round, season, ret: retired, ...(retired ? { fs: fsv } : {}),
        speed: speedMap ? speedMap.forRow(row.tournament, row.surface, row.court) : null,
        oppArchetype: archetypeOf(b.opp, row.date),
        opp: b.opp, won: b.won, p, price, oppPrice,
        book: bk[0], bookLabel: bk[1],
        // role: the tab's rule (TEN-310) — favourite = price < 2.00, from the shared core.
        role: core.isFavPrice(price) ? 'fav' : 'dog',
      };
      // The tour baseline rests on the SAME basis as the player yields, or the "vs tour" gap would be a book-mix artefact.
      if (isYieldBasis(side)) {
        addTo(tour.all, side);
        if (level) { tour.level[level] = tour.level[level] || emptyAgg(); addTo(tour.level[level], side); }
        tour.season[season] = tour.season[season] || emptyAgg();
        addTo(tour.season[season], side);
      }
      const hit = resolveAt(b.name, row.date, b.opp);
      if (!hit) return;
      // the player keeps a shard (rewritten without the match), so an old copy that priced it never stays behind
      if (quarantined) { stats.quarantined += 1; if (!perPlayer.has(hit.key)) perPlayer.set(hit.key, { name: hit.name, sides: [] }); return; }
      if (only && hit.key !== only) return;
      stats.joined += 1;
      if (!perPlayer.has(hit.key)) perPlayer.set(hit.key, { name: hit.name, sides: [] });
      perPlayer.get(hit.key).sides.push(side);
    });
  });

  const tourSummary = summarise(tour.all);
  const tourByLevel = {};
  Object.keys(tour.level).forEach((L) => { tourByLevel[L] = summarise(tour.level[L]); });

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  // Founder 2026-10-28 (one price per match): every shard on disk is rewritten every run. A player whose every master
  // row left (a later ruling dashed it: the 26 Oct start - 10 dash) gets an empty shard, never his last build's rows —
  // the committed floor kept K. Feldbausch's three Bet365 prices on Market edge while every other page read a dash.
  stats.emptied = 0;
  for (const f of fs.readdirSync(OUT_DIR)) {
    const m = /^(\d+)\.json$/.exec(f);
    if (!m || perPlayer.has(m[1])) continue;
    let nm = null;
    try { nm = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8')).name || null; } catch (e) { /* unreadable: still emptied */ }
    perPlayer.set(m[1], { name: nm, sides: [] });
    stats.emptied += 1;
  }

  const index = {};
  let shipped = 0;
  perPlayer.forEach((rec, key) => {
    const sides = rec.sides.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const all = emptyAgg(); const fav = emptyAgg(); const dog = emptyAgg(); const lvl = emptyAgg();
    const bands = { fav: {}, dog: {} };
    const bySurface = {};
    const bandStraddle = 0;   // TEN-310: a band is decided by the price alone, so none can straddle
    FAV_BANDS.forEach((b) => { bands.fav[b.id] = emptyAgg(); });
    DOG_BANDS.forEach((b) => { bands.dog[b.id] = emptyAgg(); });

    // Every aggregate below — headline, roles, bands, per-surface and the cumulative curve — is
    // struck on the TEN-310 basis (Pinnacle, else Bet365 close): every priced row.
    const basis = sides.filter(isYieldBasis);
    let cumCents = 0;
    const curve = [];
    basis.forEach((s) => {
      addTo(all, s);
      if (s.role === 'fav') addTo(fav, s);
      else if (s.role === 'dog') addTo(dog, s);
      else addTo(lvl, s);
      const bf = bandFor(s.price);
      if (bf) addTo(bands[bf.role][bf.band.id], s);
      const surf = s.surface || 'Unknown';
      bySurface[surf] = bySurface[surf] || emptyAgg();
      addTo(bySurface[surf], s);
      // Integer cents, for the same reason emptyAgg() carries cents: this running
      // total is what the cumulative chart plots, so a float drift here is a
      // visible drift in the line.
      cumCents += core.plCents(s);
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
      // This string is printed on the page, so it names the basis the numbers were struck on.
      priceBasis: PRICE_BASIS,
      builtAt: stamp.builtAt,
      builtFromCommit: stamp.builtFromCommit,
      headline: summarise(all),
      // Median over the same basis as the headline.
      medianPrice: r2(median(basis.map((s) => s.price))),
      roles: { all: summarise(all), favourite: summarise(fav), underdog: summarise(dog), level: summarise(lvl) },
      bands: { favourite: bandOut('fav'), underdog: bandOut('dog') },
      surface: surfaceOut,
      curve,
      tour: { all: tourSummary, level: tourByLevel },
      coverage: {
        firstPriced: basis.length ? basis[0].date : null,
        lastPriced: basis.length ? basis[basis.length - 1].date : null,
        // Priced rows left out of the basis: 0 since TEN-310 (every priced row counts). Kept so a
        // future narrower basis has to say how much it drops.
        pricedAnyBook: sides.length,
        excludedNonPinnacle: sides.length - basis.length,
        pinnacleEndByLevel: pinnacleEnd,
        bet365ArchiveEndByLevel: bet365End,
        // Rows priced outside their band's printed range: 0 by construction since TEN-310.
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
        // TEN-310 ruling B: the Match analysis tab reads these rows and bands them from `price`, so the
        // price is stored at the bands' precision (thousandths) — a 2-dp copy re-banded 23 rows (1.645 → 1.65).
        opp: s.opp, won: s.won, price: r3(s.price), oppPrice: r3(s.oppPrice),
        book: s.book, role: s.role,
        // The band this row was counted in (= core.bandOf(price) now that price keeps 3 decimals).
        band: bandFor(s.price) ? bandFor(s.price).band.id : null,
        // Per-row P&L in units, struck in cents (the shared core's formula). Ruling 4: a void retirement, or one with no
        // set scores, carries its prices and NO units (pl null), with the reason in `settle`.
        pl: Settlement.betCounts(s) ? core.plCents(s) / 100 : null,
        inBasis: isYieldBasis(s),
        ret: !!s.ret,
        ...(s.ret ? { fs: s.fs, settle: Settlement.settleBet(s) } : {}),
      })),
    };

    out.identityHidden = idGate && idGate.hidden ? idGate.hidden(key) : 0;   // rows dashed: identity unverified (gate rule 4)
    fs.writeFileSync(path.join(OUT_DIR, `${key}.json`), JSON.stringify(out));
    index[key] = { n: out.headline.n, yield: out.headline.yield, pinnacle: out.headline.book.pinnacle, bet365: out.headline.book.bet365 };
    shipped += 1;
  });

  fs.writeFileSync(INDEX_PATH, JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    priceBasis: PRICE_BASIS,
    builtAt: stamp.builtAt,
    builtFromCommit: stamp.builtFromCommit,
    tour: { all: tourSummary, level: tourByLevel },
    coverage: { pinnacleEndByLevel: pinnacleEnd, bet365ArchiveEndByLevel: bet365End },
    // founder ruling 2026-10-17: built from the master; the publish guard compares these two (a lag fails the upload)
    identityGate: idGate ? { stats: idGate.stats, merged: idGate.merged } : null,
    source: 'database-yield-master.json', latestMatch: stats.latest, masterLatest: master.meta.latest || null,
    // ruling 4 (founder 2026-10-22): how the master's retirements settled, and every one left without units for want of set scores
    retirements: { stands: stats.retStands, void: stats.retVoid, noSets: stats.retNoSets, noSetsRows },
    players: index,
  }, null, 1));

  log(`master rows ${stats.rows} (${master.meta.counts ? JSON.stringify(master.meta.counts) : ''}), ${stats.retired} retired (Pinnacle rules: ${stats.retStands} stand, ${stats.retVoid} void, ${stats.retNoSets} no set scores; ${stats.retFromCareer || 0} first sets read from the players' own career rows), ${stats.team} team-event matches left out`);
  if (noSetsRows.length) log(`ruling 4 · retired with no set scores (no units): ${noSetsRows.join(' · ')}`);
  log(`player-sides ${stats.sides}, joined to a profile ${stats.joined}, exact price ties ${stats.ties}, latest match ${stats.latest} (master ${master.meta.latest})`);
  log(`tour baseline (${PRICE_BASIS}): ${tourSummary.n} priced sides, yield ${tourSummary.yield}%, `
    + `book mix ${tourSummary.book.pinnacle} Pinnacle / ${tourSummary.book.bet365} Bet365-archive`);
  log(`shards written: ${shipped}`);
  log(`shards emptied (no master row this run): ${stats.emptied}`);
  if (qPath) console.log(`market-edge: ${stats.quarantined} player-side(s) left out by the publish quarantine (${qz.length} match(es), ${qPath})`);
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { DB_BOOK, careerFirstSet, firstSetLookup, makeResolver, rosterProfiles, pickBook, pickSide, capPair, summarise, isRetiredComment, PRICE_BANDS, bandFor, PRICE_BASIS, GATE_FULL, GATE_SMALL, emptyAgg, addTo };
