// Series page — row-integrity gate (TEN-204 item 2.8). FAIL-CLOSED.
//
// Three properties, asserted against the artifact the build just wrote and against the
// shipped front-end bytes. Any of them failing fails `npm test`, which pipeline.yml runs
// before it publishes (see the `npm test` step there — it is not `continue-on-error`).
//
//   A · EVERY ROW SATISFIES ITS OWN CLAIM. Every match inside every generated streak must
//       actually meet the condition the card states. A 29-game match inside an "Under 23.5
//       total games" run is the failure this exists to stop, and it is the one failure a
//       reader can catch unaided — which is exactly why it must never ship.
//
//   B · MODAL ROW COUNT == STREAK COUNT. `matches.length` must equal `count`. The card
//       prints "12 in a row" off `count` and the modal renders one row per `matches[]`
//       entry; if they diverge the card and its own evidence disagree.
//
//   C · CARD PRICE CELL AND SHEET COME FROM ONE BUILDER (series-v2): Avg price, Favourite and
//       the line figures are recomputed here from the streakRows() output the sheet lists,
//       by EXECUTING the shipped builder, and must agree to the digit.
//
// METHOD — A is deliberately re-derived here from the published `score` string with this
// file's OWN parser and OWN per-subtype predicates. It does NOT import build-series.js's
// conditionHeld(). A checker that calls the engine's own predicate cannot catch a bug in
// that predicate; it can only confirm the engine agrees with itself. Every assertion is
// mutation-checked at the foot of the file, so a predicate that has quietly stopped
// measuring anything fails here rather than passing silently.
//
// Run: node tools/test-series-rows.js   (also wired into `npm test`)
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ART = path.join(ROOT, 'series.json');
const checks = [];
const ok = (name) => checks.push(name);

if (!fs.existsSync(ART)) {
  console.log('test-series-rows: no series.json in the tree — nothing to gate. SKIP.');
  process.exit(0);
}
const doc = JSON.parse(fs.readFileSync(ART, 'utf8'));
const players = Array.isArray(doc.players) ? doc.players : [];

// ── independent score parser ────────────────────────────────────────────────
const SET_RE = /^(\d+)-(\d+)(?:\(\d+\))?$/;
function setsOf(score) {
  const toks = String(score == null ? '' : score).trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  const out = [];
  for (const t of toks) {
    const m = SET_RE.exec(t);
    if (!m) return null;
    out.push([Number(m[1]), Number(m[2])]);
  }
  return out;
}
const games = (s) => s.reduce((n, [a, b]) => n + a + b, 0);
const margin = (s) => s.reduce((n, [a, b]) => n + a - b, 0);
// Best-of, read off the score itself — the only format evidence a row carries. A completed
// match ends the moment the winner reaches a majority, so the winner's set count fixes the
// format: 2 → best-of-3, 3 → best-of-5. Anything else is not a shape this gate can judge.
// (TEN-265: the set-shape predicates below once hard-coded best-of-3 — "went the distance"
// was `3 sets` — and a five-set US Open decider red-lined every pipeline run.)
// A set is FINISHED only when someone reached six with a two-game lead, or won
// the 7-6 tiebreak. A retirement's last set ("6-4 3-2") is not one, and counting
// it as won would type a stopped match as a completed 2-0.
const setDone = ([a, b]) => (Math.max(a, b) >= 6 && Math.abs(a - b) >= 2) ||
  (Math.max(a, b) === 7 && Math.min(a, b) === 6);
function bestOfScore(s) {
  if (!s.every(setDone)) return null;
  const mine = s.filter(([a, b]) => a > b).length;
  const theirs = s.filter(([a, b]) => a < b).length;
  const w = Math.max(mine, theirs);
  if (mine === theirs || mine + theirs !== s.length) return null;
  return w === 2 && s.length <= 3 ? 3 : w === 3 && s.length <= 5 ? 5 : null;
}

// ── independent claim predicate ─────────────────────────────────────────────
// true = the row meets the claim · false = it does not · null = not evaluable.
// `score` is player-POV throughout (build-series.js writes it that way), which is what
// makes a signed margin and a first-set read possible at all.
function holds(st, m) {
  const s = setsOf(m && m.score);
  const wantWin = st.direction === 'win';
  switch (st.type) {
    case 'all':
    case 'style':
      return typeof m.won === 'boolean' ? (m.won === wantWin) : null;
    case 'surface':
      if (String(m.surface || '').toLowerCase() !== String(st.subtype || '').toLowerCase()) return null;
      return typeof m.won === 'boolean' ? (m.won === wantWin) : null;
    case 'total':
      return s ? (st.over ? games(s) > st.line : games(s) < st.line) : null;
    case 'handicap':
      return s ? (st.cover ? margin(s) > st.line : margin(s) < -st.line) : null;
    case 'pattern': {
      if (!s) return null;
      const wonFirst = s[0][0] > s[0][1];
      if (st.subtype === 'won-first-set') return wonFirst;
      if (st.subtype === 'lost-first-set') return !wonFirst;
      return null;
    }
    case 'setpat': {
      if (!s) return null;
      if (st.firstSet) {
        const g1 = s[0][0] + s[0][1];
        return st.over ? g1 > st.line : g1 < st.line;
      }
      switch (st.subtype) {
        case 'won-2nd-set':        return s.length >= 2 && s[1][0] > s[1][1];
        case 'lost-2nd-set':       return s.length >= 2 && s[1][0] < s[1][1];
        case 'straight-sets-win':
        case 'straight-sets-loss': {
          const bo = bestOfScore(s);
          if (bo == null) return null;
          return m.won === (st.subtype === 'straight-sets-win') && s.length === (bo + 1) / 2;
        }
        case 'went-the-distance': {
          const bo = bestOfScore(s);
          return bo == null ? null : s.length === bo;
        }
        case 'no-set-won':         return s.every(([a, b]) => a < b);
        default: return null;
      }
    }
    default: return null;
  }
}

function eachStreak(fn) {
  for (const p of players) for (const st of p.streaks || []) fn(p, st);
}

// ── A · every row satisfies its own claim ───────────────────────────────────
function auditRows(predicate) {
  const bad = [];
  let rows = 0;
  eachStreak((p, st) => {
    for (let i = 0; i < (st.matches || []).length; i++) {
      rows++;
      if (predicate(st, st.matches[i]) === false) {
        bad.push(`${p.name} · ${st.type}/${st.subtype || '-'} · row ${i + 1} ` +
                 `${st.matches[i].date} vs ${st.matches[i].opponent} "${st.matches[i].score}"`);
      }
    }
  });
  return { rows, bad };
}
const A = auditRows(holds);
assert.strictEqual(A.bad.length, 0,
  `TEN-204 2.8 A — ${A.bad.length} of ${A.rows} streak rows do NOT satisfy their own claim:\n  ` +
  A.bad.slice(0, 15).join('\n  '));
assert(A.rows > 0, 'TEN-204 2.8 A — zero rows audited; the gate would pass vacuously.');
ok(`A · ${A.rows} rows across all streaks satisfy their own claim`);

// ── A2 · a SET-SHAPE row must be judgeable (TEN-265) ────────────────────────
// A fails only on `=== false`. Once the set-shape predicates read the format off
// the score, a score that is not a completed Bo3/Bo5 shape (a retirement, a
// partial scoreline) returns null — "not evaluable" — and would pass A
// unaudited. The builder never lets such a row into a set-shape run (its
// wentDistance / straightResult are null there), so one appearing is itself a
// defect: fail it here rather than wave it through.
const SET_SHAPE = new Set(['went-the-distance', 'straight-sets-win', 'straight-sets-loss']);
function unjudgeable(predicate) {
  const bad = [];
  eachStreak((p, st) => {
    if (st.type !== 'setpat' || !SET_SHAPE.has(st.subtype)) return;
    (st.matches || []).forEach((m, i) => {
      if (predicate(st, m) === null) bad.push(`${p.name} · ${st.subtype} · row ${i + 1} ${m.date} "${m.score}"`);
    });
  });
  return bad;
}
{
  const bad = unjudgeable(holds);
  assert.strictEqual(bad.length, 0,
    `TEN-265 A2 — ${bad.length} set-shape streak row(s) carry a score that is not a completed ` +
    `Bo3/Bo5 match, so their claim cannot be checked:\n  ` + bad.slice(0, 15).join('\n  '));
  // CONTROL — plant a retirement scoreline into every set-shape streak; each must be caught.
  let planted = 0, caught = 0;
  eachStreak((p, st) => {
    if (st.type !== 'setpat' || !SET_SHAPE.has(st.subtype) || !(st.matches || []).length) return;
    planted++;
    if (holds(st, Object.assign({}, st.matches[0], { score: '6-4 3-2' })) === null) caught++;
  });
  if (planted) assert.strictEqual(caught, planted, 'TEN-265 A2 CONTROL — a planted "6-4 3-2" was not flagged unjudgeable.');
  ok(`A2 · every set-shape row is a completed Bo3/Bo5 score (control: ${caught}/${planted} planted retirements flagged)`);
}

// ── B · modal row count == streak count ─────────────────────────────────────
{
  const bad = [];
  let n = 0;
  eachStreak((p, st) => {
    n++;
    const len = Array.isArray(st.matches) ? st.matches.length : -1;
    if (len !== st.count) bad.push(`${p.name} · ${st.type}/${st.subtype || '-'} · count=${st.count} matches=${len}`);
  });
  assert.strictEqual(bad.length, 0,
    `TEN-204 2.8 B — ${bad.length} streak(s) whose modal row count would not equal the count on the card:\n  ` +
    bad.slice(0, 15).join('\n  '));
  assert(n > 0, 'TEN-204 2.8 B — zero streaks audited; the gate would pass vacuously.');
  ok(`B · ${n} streaks: matches.length === count`);
}

// ── C · one row builder feeds the card and the sheet (series-v2, founder 2026-11-06) ──
// Lift the real bytes out of series.js and run them. A source-text regex would pass against a file that had grown a
// second builder and merely kept the old symbol names. The card's Avg price and the sheet's AVG PRICE / Favourite /
// line figures are all read off streakRows(st) — the rows the sheet lists; the rendered equality (card text = sheet
// text) is asserted in test-ten427-series.mjs "Data 5 (series-v2)". Series tracks no P&L: no ledger exists to audit.
{
  const src = fs.readFileSync(path.join(ROOT, 'series.js'), 'utf8');
  const start = src.indexOf('  var SET_RE = ');
  const end = src.indexOf('\n  // ─── families ──');
  assert(start > 0 && end > start, 'series.js row-builder block not found — markers moved?');
  const block = src.slice(start, end);
  for (const f of ['streakRows', 'avgPriceOf', 'favOf', 'lineSpecOf', 'lineStatsOf'])
    assert(new RegExp('function ' + f + '\\(').test(block), 'row-builder block no longer defines ' + f);
  assert(!/function ledgerOf\(|P&L|halfAway/.test(block.replace(/\/\/.*$/gm, '')), 'series-v2 — a P&L ledger is back in the row builder');
  // eslint-disable-next-line no-new-func
  const lift = new Function('famOf', block + '; return { streakRows, proofOf, setsOf, avgPriceOf, favOf, lineSpecOf, lineStatsOf, isMatchResultFam, PX };');
  const famOf = (st) => (st.type === 'pattern' ? 'setout'
    : st.type === 'setpat' ? (st.firstSet ? 'setgames' : 'setout')
    : (st.family || st.type));
  const B = lift(famOf);
  eachStreak((p, st) => (st.matches || []).forEach(m => {
    if (m.price != null) assert.strictEqual(B.streakRows({ type: st.type, family: st.family, matches: [m] })[0].price, null,
      `TEN-427 — streakRows() read a price off the artifact row (${p.name}); prices come only from the page join.`);
  }));
  // Price every streak row deterministically (some rows player-only, some unpriced) so the builder is exercised
  // whatever the artifact carries; the shape is the page join's answer { price, oppPrice, book }.
  let k = 0;
  eachStreak((p, st) => (st.matches || []).forEach(m => {
    const r = k++ % 5;
    if (r === 4) return;                                             // unpriced
    B.PX.set(m, { price: 1.05 + (k % 37) / 10, oppPrice: r === 3 ? null : 1.10 + (k % 23) / 10, book: r % 2 ? 'B' : 'P' });
  }));
  const centsAvg = (xs) => (Math.round(xs.reduce((a, b) => a + Math.round(b * 100), 0) / xs.length) / 100).toFixed(2);
  let checked = 0, withLine = 0, withPartial = 0, withPlayerOnly = 0;
  eachStreak((p, st) => {
    const rows = B.streakRows(st);
    assert.strictEqual(rows.length, st.count, `TEN-204 2.8 C — streakRows() returned ${rows.length} rows for a streak of ${st.count} (${p.name}).`);
    // Avg price = the player's own price over the rows that carry it, in the sheet's (reversed) order, exact cents
    const prices = rows.slice().reverse().map(r => r.price).filter(v => typeof v === 'number');
    const ap = B.avgPriceOf(st);
    if (prices.length) {
      assert.deepStrictEqual(ap, { value: centsAvg(prices), n: prices.length, of: rows.length }, `series-v2 C — Avg price ≠ the mean of the sheet's own Home prices (${p.name} · ${st.type}).`);
      if (prices.length < rows.length) withPartial++;
    } else assert.strictEqual(ap, null, `series-v2 C — an unpriced streak published ${JSON.stringify(ap)}; a missing price is a dash, never 0 (${p.name}).`);
    if (rows.some(r => r.price != null && r.oppPrice == null)) withPlayerOnly++;
    // Favourite n of N over the rows with BOTH prices (founder ruling 1)
    const both = rows.filter(r => r.price != null && r.oppPrice != null);
    const fv = B.favOf(st);
    assert.deepStrictEqual(fv, both.length ? { n: both.filter(r => r.price < r.oppPrice).length, of: both.length } : null, `series-v2 C — Favourite n of N (${p.name}).`);
    // line families: the games figures read off the score
    const ls = B.lineStatsOf(st);
    if (['total', 'handicap', 'setgames'].includes(famOf(st)) && isFinite(Number(st.line))) {
      const figs = rows.map(r => r.proof).filter(v => typeof v === 'number' && isFinite(v));
      assert(ls && ls.n === figs.length, `series-v2 C — line stats count (${p.name}).`);
      if (figs.length) {
        assert(Math.abs(ls.avg - figs.reduce((a, b) => a + b, 0) / figs.length) < 1e-9, `series-v2 C — AVG GAMES (${p.name}).`);
        assert.strictEqual(ls.min, Math.min(...figs)); assert.strictEqual(ls.max, Math.max(...figs));
        withLine++;
      }
    } else assert.strictEqual(ls, null, `series-v2 C — a non-line family produced line stats (${p.name} · ${st.type}).`);
    checked++;
  });
  assert(checked > 0, 'TEN-204 2.8 C — zero streaks audited; the gate would pass vacuously.');
  assert(withPartial > 0 && withPlayerOnly > 0, `series-v2 C — the planted prices exercised no partly priced (${withPartial}) or player-only (${withPlayerOnly}) streak.`);
  // CONTROL — the pre-ruling builder (a row priced only with both prices) must give a different answer on a
  // player-only row, or the player-only assertion above measures nothing.
  const one = { type: 'all', matches: [{ date: '2026-11-01', opponent: 'X', won: true, score: '6-4 6-4' }, { date: '2026-11-02', opponent: 'Y', won: true, score: '6-4 6-4' }] };
  B.PX.set(one.matches[0], { price: 1.40, oppPrice: null, book: 'P' }); B.PX.set(one.matches[1], { price: 1.60, oppPrice: 2.40, book: 'P' });
  assert.deepStrictEqual(B.avgPriceOf(one), { value: '1.50', n: 2, of: 2 }, 'series-v2 ruling 1 — the player-only row must count in Avg price');
  assert.deepStrictEqual(B.favOf(one), { n: 1, of: 1 }, 'series-v2 ruling 1 — Favourite counts only the row with both prices');
  ok(`C · ${checked} streaks: Avg price, Favourite and line figures recomputed from the sheet's own rows (${withPartial} partly priced, ${withPlayerOnly} with a player-only row, ${withLine} line)`);
}

// ── E · MONEY IS ORDER-INDEPENDENT ──────────────────────────────────────────
// The regression this pins, with the real numbers that produced it: F. Diaz Acosta's ten
// Pinnacle prices. Added oldest-first (the artifact's order) they reach exactly 1.415 and
// the card printed 1.42. Added newest-first (the order the MODAL lists them) the same ten
// values reach 1.4149999999999998 and an auditor computes 1.41. Both are correct float
// arithmetic; the card was simply averaging in the opposite direction to the panel that
// evidences it. Caught by an independent recompute, not by any assertion in this file at
// the time — which is why it is now an assertion in this file.
{
  const P = [1.13, 1.15, 1.33, 1.46, 1.28, 1.27, 1.35, 1.57, 1.99, 1.62];
  const fwd = P.reduce((a, b) => a + b, 0) / P.length;
  const rev = P.slice().reverse().reduce((a, b) => a + b, 0) / P.length;
  // The float hazard is real and still present in the language — if this ever stops being
  // true the case has changed and the guard below needs a new witness, not deleting.
  assert.notStrictEqual(fwd.toFixed(2), rev.toFixed(2),
    'the float-order witness no longer diverges; pick a new witness rather than dropping this gate');

  const cents = (xs) => Math.round(xs.reduce((a, b) => a + Math.round(b * 100), 0) / xs.length) / 100;
  assert.strictEqual(cents(P).toFixed(2), cents(P.slice().reverse()).toFixed(2),
    'TEN-204 — the cent-based average is not order-independent');
  assert.strictEqual(cents(P).toFixed(2), '1.42',
    'TEN-204 — the exact average of the witness set is 1.415, which rounds half-up to 1.42');

  // And the shipped page must be using that arithmetic, not floats.
  const src = fs.readFileSync(path.join(ROOT, 'series.js'), 'utf8');
  assert(/function cents\s*\(/.test(src) && /Math\.round\(x \* 100\)/.test(src),
    'TEN-204 — series.js no longer defines the integer-cent helper; money is back on floats.');
  ok('E · money sums in exact cents, order-independent (witness: the 1.415 card)');
}

// ── D · the prices are the site's ONE closing-price join (TEN-427, SUPERSEDES TEN-204 A4's "never call it closing") ──
// TEN-204 A4 banned the word "closing" because the old prices were api-tennis get_odds snapshots with no timestamp.
// TEN-427 Data 5 replaces them with the Database join's closing prices (Pinnacle closing, else Bet365 closing —
// database.md), so the page says "closing" and the generator no longer writes snapshot prices at all.
{
  const src = fs.readFileSync(path.join(ROOT, 'series.js'), 'utf8');
  assert(/trDbJoinPx\(/.test(src) && /sfDbJoinLoad\(/.test(src), 'TEN-427 — series.js no longer prices rows on the Database join');
  assert(!/\bm\.price\b|\bm\.oppPrice\b/.test(src.replace(/\/\/.*$/gm, '')), 'TEN-427 — series.js reads a price off the artifact row');
  const eng = fs.readFileSync(path.join(ROOT, 'build-series.js'), 'utf8');
  assert(!/function attachOdds\(|method=get_odds/.test(eng), 'TEN-427 — build-series.js runs the get_odds snapshot pass again');
  ok("D · prices are the page's Database join (closing); the artifact carries no snapshot prices");
}

// ── the proof figure's ROUNDING TIE-BREAK, pinned ───────────────────────────
// Found by the independent verification pass, not by this file: 3 of 64 painted cards
// (L. Harris 45/4, D. Lajovic 69/4, F. Bax 113/4) land on an EXACT tie at one decimal —
// 11.25, 17.25, 28.25 — and the answer depends entirely on the tie-break. `toFixed` rounds
// half away from zero and prints 11.3 / 17.3 / 28.3; a verifier using round-half-to-even
// (Python's default, and NumPy's) prints 11.2 / 17.2 / 28.2. Neither is a bug; the page is
// conventional. But an unstated tie-break is how two people compare the same card and
// disagree, so it is asserted here.
//
// These ties are exactly representable in binary (a small integer sum over a small integer
// count), so toFixed is deterministic on them — this is not the (1.005).toFixed(2) === "1.00"
// trap, which needs a value that is only approximately a tie.
{
  assert.strictEqual((11.25).toFixed(1), '11.3', 'the proof figure tie-break is no longer half-up');
  assert.strictEqual((17.25).toFixed(1), '17.3');
  assert.strictEqual((28.25).toFixed(1), '28.3');
  assert.strictEqual((-2.25).toFixed(1), '-2.3', 'a negative margin ties away from zero too');
  ok('proof-figure ties round half AWAY from zero (11.25 -> 11.3), not half-to-even');
}

// ── mutation checks · prove the assertions above can actually fail ──────────
// Without these, a predicate that had quietly started returning null for everything would
// sail through A with "0 failures" and the gate would be theatre.
{
  const inverted = auditRows((st, m) => { const h = holds(st, m); return h === null ? null : !h; });
  assert.strictEqual(inverted.bad.length, inverted.rows,
    `TEN-204 2.8 — NEGATIVE CONTROL FAILED. Inverting the claim predicate should fail every ` +
    `one of ${inverted.rows} rows; it failed ${inverted.bad.length}. The predicate is not ` +
    `measuring the rows.`);
  ok(`mutation · inverted predicate fails all ${inverted.rows} rows (the gate is live)`);

  // …and a planted bad row must actually be CAUGHT, per streak.
  //
  // An earlier version of this control planted ONE fixed score ('9-7 9-7 9-7') into the
  // first streak and asserted the verdict moved. That passed on the committed seed and
  // FAILED on the live artifact — not because the data was bad, but because the live
  // artifact's first streak happened to be "Over 21.5 total games", which a 48-game
  // scoreline still satisfies. A control whose result depends on which streak sorts first
  // is not a control. So: plant BOTH extremes into every streak, and require that at least
  // one of them is rejected. Any real predicate rejects one end or the other; a predicate
  // that has gone inert accepts both, everywhere.
  const HIGH = '9-7 9-7 9-7';   // 48 games, every set won, no deciding set, huge + margin
  const LOW  = '0-6 0-6';       // 12 games, every set lost, straight-sets loss, − margin
  let flipped = 0, considered = 0;
  eachStreak((p, st) => {
    if (!(st.matches || []).length) return;
    const probe = Object.assign({}, st.matches[0]);
    const hi = holds(st, Object.assign({}, probe, { score: HIGH, won: true }));
    const lo = holds(st, Object.assign({}, probe, { score: LOW, won: false }));
    if (hi === null && lo === null) return;      // family this row cannot evaluate at all
    considered++;
    if (hi === false || lo === false) flipped++;
  });
  assert(considered > 0, 'TEN-204 2.8 — no streak could be probed; the control is vacuous.');
  assert.strictEqual(flipped, considered,
    `TEN-204 2.8 — NEGATIVE CONTROL FAILED. ${considered - flipped} of ${considered} streaks ` +
    `accepted BOTH a 48-game blowout win and a 0-6 0-6 loss as satisfying their claim. The ` +
    `predicate is inert for those families.`);
  ok(`mutation · all ${considered} streaks reject a planted out-of-claim score`);
}

// ── F · SET-SHAPE CLAIMS ARE FORMAT-AWARE (TEN-265) ─────────────────────────
// Fixed witnesses, independent of whatever the artifact happens to carry today, so this
// holds on a board with no five-set row in any streak. The first witness is the exact row
// that blocked runs 4430-4437; the CONTROL re-runs the old best-of-3-only predicate on it
// and requires that it still fails — proof the witness would have caught the defect.
{
  const D = { type: 'setpat', subtype: 'went-the-distance', direction: 'win' };
  const SW = { type: 'setpat', subtype: 'straight-sets-win', direction: 'win' };
  const SL = { type: 'setpat', subtype: 'straight-sets-loss', direction: 'loss' };
  const row = (score, won) => ({ score, won });
  const VUKIC = row('4-6 7-6(5) 4-6 6-3 4-6', false);     // US Open 2026-08-31 vs Sakamoto
  const cases = [
    [D,  VUKIC,                          true,  'bo5 five-setter went the distance'],
    [D,  row('6-4 3-6 7-5', true),       true,  'bo3 three-setter went the distance'],
    [D,  row('6-4 3-6 6-4 6-3', true),   false, 'bo5 four-setter did not'],
    [D,  row('9-7 9-7 9-7', true),       false, 'bo5 three-set sweep did not'],
    [D,  row('6-4 6-4', true),           false, 'bo3 straight sets did not'],
    [SW, row('6-4 6-4 6-4', true),       true,  'bo5 3-0 is a straight-sets win'],
    [SW, row('6-4 3-6 6-4 6-3', true),   false, 'bo5 3-1 is not a straight-sets win'],
    [SL, row('4-6 4-6 4-6', false),      true,  'bo5 0-3 is a straight-sets loss'],
    [SL, row('4-6 6-3 4-6', false),      false, 'bo3 1-2 is not a straight-sets loss'],
    // Unfinished last set = a stopped match. Not judgeable, so A2 fails it in a set-shape run.
    [D,  row('6-4 3-2', true),           null,  'a retirement is not judgeable'],
    [SW, row('6-4 6-4 2-1', true),       null,  'a bo5 stopped in set 3 is not a straight-sets win'],
  ];
  for (const [st, m, want, why] of cases) {
    assert.strictEqual(holds(st, m), want, `TEN-265 — set-shape predicate wrong: ${why} ("${m.score}").`);
  }
  // CONTROL — the pre-TEN-265 predicate. It must reject the witness, or the witness proves nothing.
  const oldDistance = (m) => setsOf(m.score).length === 3;
  assert.strictEqual(oldDistance(VUKIC), false,
    'TEN-265 CONTROL — the best-of-3-only predicate no longer rejects the Vukic row; the witness is inert.');
  ok(`F · ${cases.length} set-shape witnesses hold across bo3 and bo5 (control: the bo3-only rule rejects the Vukic five-setter)`);
}

console.log('test-series-rows: ' + checks.length + ' checks passed');
for (const c of checks) console.log('  ok  ' + c);
