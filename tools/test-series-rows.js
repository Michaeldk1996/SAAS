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
//   C · CARD PRICE CELL AND MODAL COME FROM ONE BUILDER. The export's rule, kept verbatim:
//       "AVG PRICE must be computed from the same rows the modal lists ... keep that
//       single-source rule in production." Asserted by EXECUTING the shipped builder, not
//       by reading the source: the card's proofSummary() is recomputed from the same
//       streakRows() output the modal's detailTableHtml() consumes, and the two must agree
//       to the digit.
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
        case 'straight-sets-win':  return m.won === true && s.length === 2;
        case 'straight-sets-loss': return m.won === false && s.length === 2;
        case 'went-the-distance':  return s.length === 3;
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

// ── C · one row builder feeds both the card cell and the modal ──────────────
// Lift the real bytes out of series.js and run them. A source-text regex would pass against
// a file that had grown a second builder and merely kept the old symbol names — that lesson
// is already recorded in tools/test-series-reference.js and it applies here for the same
// reason.
{
  const src = fs.readFileSync(path.join(ROOT, 'series.js'), 'utf8');
  const start = src.indexOf('  var SET_RE = ');
  const end = src.indexOf('\n  // ─── item 5 · the run reference sub-line');
  assert(start > 0 && end > start, 'series.js row-builder block not found — markers moved?');
  const block = src.slice(start, end);
  assert(/function streakRows\(/.test(block) && /function proofSummary\(/.test(block),
    'row-builder block no longer defines streakRows/proofSummary');

  // famOf lives further down the file; supply the same mapping so the lifted block runs.
  // eslint-disable-next-line no-new-func
  const lift = new Function('famOf', block + '; return { streakRows, proofSummary, proofOf, setsOf, PROOF_SPEC, ledgerOf, avgPriceOf, isMatchResultFam };');
  const famOf = (st) => (st.type === 'pattern' ? 'setout'
    : st.type === 'setpat' ? (st.firstSet ? 'setgames' : 'setout')
    : (st.family || st.type));
  const B = lift(famOf);

  let checked = 0, withProof = 0, withPrice = 0, withLedger = 0, sawPricedLine = 0;
  eachStreak((p, st) => {
    const rows = B.streakRows(st);
    // the modal renders exactly these rows
    assert.strictEqual(rows.length, st.count,
      `TEN-204 2.8 C — streakRows() returned ${rows.length} rows for a streak of ${st.count} (${p.name}).`);
    // the card cell is the mean of THESE rows' proof values — recomputed here from the
    // builder's own output, so a card that started reading anything else diverges.
    const vals = rows.map(r => r.proof).filter(v => typeof v === 'number' && isFinite(v));
    const summary = B.proofSummary(st);
    const spec = B.PROOF_SPEC[famOf(st)];
    if (B.isMatchResultFam(st)) {
      // TEN-204 Phase 3 · a match-result card publishes AVG PRICE over the SAME rows the
      // modal lists. Recomputed here from the builder's own output, to 2dp.
      const prices = rows.map(r => r.price).filter(v => typeof v === 'number' && isFinite(v));
      if (prices.length) {
        // Recomputed in exact cents AND in the modal's display order (reversed), so the
        // assertion only holds if the average is genuinely order-independent. Summing
        // floats here instead would reproduce the very bug this is guarding.
        const cents = prices.slice().reverse().reduce((a, b) => a + Math.round(b * 100), 0);
        const want = (Math.round(cents / prices.length) / 100).toFixed(2);
        assert.strictEqual(summary.value, want,
          `TEN-204 2.8 C — card AVG PRICE "${summary.value}" != mean of the modal's own priced rows ` +
          `"${want}" (${p.name} · ${st.type}).`);
        withPrice++;
      } else {
        assert.strictEqual(summary.value, null,
          `TEN-204 2.8 C — an unpriced match-result streak published "${summary.value}" instead of a ` +
          `dash (${p.name} · ${st.type}). A missing price is a dash, never a zero.`);
      }
    } else if (spec && spec.key && vals.length) {
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      let want = mean.toFixed(spec.dp);
      if (spec.signed && mean > 0) want = '+' + want;
      assert.strictEqual(summary.value, want,
        `TEN-204 2.8 C — card cell "${summary.value}" != mean of the modal's own rows "${want}" ` +
        `(${p.name} · ${st.type}/${st.subtype || '-'}).`);
      withProof++;
    } else {
      assert.strictEqual(summary.value, null,
        `TEN-204 2.8 C — a family with no proof figure published "${summary.value}" instead of a dash ` +
        `(${p.name} · ${st.type}).`);
    }

    // ── TEN-204 Phase 3 · price + ledger integrity ────────────────────────────
    for (const r of rows) {
      // A price is only ever a PAIR from ONE book. A half-priced row would let the modal
      // print a player price against a dash and still feed the ledger.
      if (r.price != null) {
        assert(r.oppPrice != null && r.book,
          `TEN-204 Phase 3 — a row carries a price with no opponent price or no book (${p.name}).`);
        assert(r.price > 1 && r.oppPrice > 1,
          `TEN-204 Phase 3 — a decimal price must exceed 1.0 (${p.name}: ${r.price}/${r.oppPrice}).`);
        assert(r.book === 'Pinnacle' || r.book === 'bet365',
          `TEN-204 Phase 3 — row priced by an unruled book "${r.book}" (${p.name}). The founder's ` +
          `2026-09-15 ruling names Pinnacle, filled by bet365, and nothing else.`);
      }
      // A LINE/SET family MAY carry a match-winner price — founder A1 asks for it in the
      // modal, under a header naming the market. What it may never do is let that price
      // reach the CARD cell (B3) or a P&L (A3); both are asserted below, per streak.
    }

    // The ledger is the modal's own rows, re-summed here with the ruled rounding:
    // each row rounded to 2dp FIRST, total = sum of the rounded rows, yield = total ÷ priced.
    const L = B.ledgerOf(st);
    if (B.isMatchResultFam(st)) {
      assert(L, `TEN-204 Phase 3 — a match-result streak produced no ledger (${p.name}).`);
      // Same discipline as the average: integer cents, accumulated in the REVERSED order,
      // so an order-dependent ledger fails here instead of shipping a cent adrift.
      let wantC = 0, priced = 0;
      for (const r of rows.slice().reverse()) {
        if (r.price == null || r.won == null) continue;
        priced++;
        wantC += r.won ? (Math.round(r.price * 100) - 100) : -100;
      }
      const want = wantC / 100;
      assert.strictEqual(L.priced, priced,
        `TEN-204 Phase 3 — ledger counted ${L.priced} priced rows, the modal lists ${priced} (${p.name}).`);
      assert.strictEqual(L.of, rows.length,
        `TEN-204 Phase 3 — ledger denominator ${L.of} != modal row count ${rows.length} (${p.name}).`);
      if (priced) {
        assert.strictEqual(L.total, want,
          `TEN-204 Phase 3 — ledger total ${L.total}u != sum of the modal's own rounded rows ` +
          `${want}u (${p.name}).`);
        assert.strictEqual(L.yield, Math.round(1000 * wantC / priced / 100) / 10,
          `TEN-204 Phase 3 — yield is not total ÷ priced count (${p.name}).`);
        withLedger++;
      } else {
        assert.strictEqual(L.total, null,
          `TEN-204 Phase 3 — an unpriced ledger published a total instead of a dash (${p.name}).`);
      }
    } else {
      assert.strictEqual(L, null,
        `TEN-204 Phase 3 — a LINE/SET family produced a P&L ledger (${p.name} · ${st.type}). ` +
        `Founder A3: no P&L column, no unit total, no yield on line families.`);
      // Founder B3: "No odds of any kind shown under a line claim on the card." The modal
      // may show the match-odds tracks; the CARD cell must stay the proof figure. If a
      // priced line streak ever published a price-looking cell, that is the substitution.
      const cell = B.proofSummary(st);
      const spec2 = B.PROOF_SPEC[famOf(st)];
      const priced = rows.filter(r => r.price != null);
      if (priced.length) {
        sawPricedLine++;
        if (spec2 && spec2.key) {
          const vals2 = rows.map(r => r.proof).filter(v => typeof v === 'number' && isFinite(v));
          if (vals2.length) {
            const mean2 = vals2.reduce((a, b) => a + b, 0) / vals2.length;
            let want2 = mean2.toFixed(spec2.dp);
            if (spec2.signed && mean2 > 0) want2 = '+' + want2;
            assert.strictEqual(cell.value, want2,
              `TEN-204 B3 — a priced LINE family's card cell is "${cell.value}", not its proof ` +
              `figure "${want2}" (${p.name} · ${st.type}). A price must never reach a line card.`);
          }
        }
        assert(!/price/i.test(String(cell.label)),
          `TEN-204 B3 — a LINE family's card cell is labelled "${cell.label}" (${p.name}).`);
      }
    }
    checked++;
  });
  assert(checked > 0, 'TEN-204 2.8 C — zero streaks audited; the gate would pass vacuously.');
  assert(withProof > 0,
    'TEN-204 2.8 C — no streak produced a proof figure. Either the board carries no line/set ' +
    'family at all, or proofOf() has stopped parsing scores. Investigate before trusting a pass.');
  // Without these the price assertions above are all vacuously true on an unpriced artifact —
  // exactly the state this file was in before Phase 3, when it passed while measuring nothing.
  //
  // Scoped to artifacts that CLAIM to carry odds. pipeline.yml runs `npm test` BEFORE
  // build-series.js, so there this file audits the committed seed; a seed written by a
  // pre-Phase-3 builder has no odds block and must not red the pipeline for lacking prices
  // it was never built with. The moment an artifact carries `odds`, the vacuity guard is
  // mandatory again — so the post-build gate (which audits what actually ships) is strict.
  if (doc.odds) {
    assert(withPrice > 0,
      'TEN-204 Phase 3 — series.json carries an odds block but not one match-result streak ' +
      'was priced. The odds pass is failing silently and the price gate is measuring nothing.');
    assert(withLedger > 0,
      'TEN-204 Phase 3 — series.json carries an odds block but no ledger was computed.');
    // Founder A1 asks for match odds on EVERY family. If no line family ever carried a
    // price, the B3 card-protection assertions above never ran and are vacuous.
    assert(sawPricedLine > 0,
      'TEN-204 A1 — not one LINE/SET streak carried a match price, so the modal is not ' +
      'showing odds on all families and the B3 card guard is measuring nothing.');
    // A collapse to a handful of rows is the failure mode that would otherwise read as
    // "working": the census records what the build itself saw, so compare against it.
    const c = doc.odds.census || {};
    if (typeof c.priced === 'number' && typeof c.priceableRows === 'number' && c.priceableRows > 0) {
      const pct = 100 * c.priced / c.priceableRows;
      assert(pct >= 40,
        `TEN-204 Phase 3 — odds coverage collapsed to ${pct.toFixed(1)}% of priceable rows ` +
        `(${c.priced}/${c.priceableRows}). It ran 83-89% when the pass was built; this is a ` +
        `feed or join failure, not a quiet day.`);
    }
  } else {
    console.log('test-series-rows: artifact predates the Phase 3 odds pass — price checks not applicable.');
  }
  ok(`C · ${checked} streaks: card cell recomputed from the modal's own rows (${withProof} with a proof figure, ${withPrice} with AVG PRICE, ${withLedger} ledgers)`);
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

// ── D · NOTHING ON THIS PAGE MAY BE CALLED A CLOSING PRICE ──────────────────
// Founder A4: "Label prices 'pre-match' everywhere, not 'closing', unless the row comes
// from a source confirmed as a true close." No such source exists for this board —
// api-tennis get_odds carries no time field of any kind, so every price here is a snapshot
// of unknown age. The word is therefore banned from the page's user-visible strings, and
// the artifact must keep saying it has no timestamps.
//
// Scanned against STRING LITERALS ONLY, so the explanatory comments (which must be free to
// use the word to explain why it is wrong) cannot trip it and, more importantly, cannot
// mask it: a comment mentioning "closing" is not what a reader sees.
{
  const src = fs.readFileSync(path.join(ROOT, 'series.js'), 'utf8');
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/(^|[^:'"])\/\/.*$/, '$1')).join('\n');
  const literals = stripped.match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g) || [];
  // "Close" the verb is legitimate and everywhere — the modal's ✕ button, its aria-label
  // and its class name. What is banned is the CLAIM: calling a price a close. So the
  // pattern is "closing" in any form, plus "close" only when it sits next to a price word.
  const CLOSE_CLAIM = /\bclosing\b|\bclos(e|ed)\s+(price|odds|line|quote)|\b(price|odds|line|quote)s?\s+at\s+close\b/i;
  const offenders = literals.filter(s => CLOSE_CLAIM.test(s));
  assert.deepStrictEqual(offenders, [],
    `TEN-204 A4 — series.js ships a user-visible string calling a price a close: ${offenders.join(' | ')}. ` +
    `No source timestamps these prices, so none of them is a closing price.`);

  // NEGATIVE CONTROL. The filter above must actually be able to see a literal — if the
  // comment-stripper or the literal regex silently matched nothing, the assertion would
  // pass on any file at all.
  assert(literals.length > 50,
    `TEN-204 A4 — only ${literals.length} string literals extracted from series.js; the scanner ` +
    `is not reading the file and the ban is vacuous.`);
  const planted = ["'closing price'", "'the closing odds'", "'Closing'", "'closed price'"]
    .filter(s => CLOSE_CLAIM.test(s));
  assert.strictEqual(planted.length, 4, 'the close-claim detector no longer detects a close claim');
  // …and must NOT fire on the legitimate verb, or the gate becomes noise and gets loosened.
  const benign = ["'Close'", "'.sr-ov-close'", "'close the panel'"].filter(s => CLOSE_CLAIM.test(s));
  assert.deepStrictEqual(benign, [], 'the close-claim detector is firing on the verb "close"');

  // And the artifact must not quietly start claiming a timestamp it does not have.
  if (doc.odds) {
    assert(/^none\b/.test(String(doc.odds.timestamps || '')),
      `TEN-204 A4 — series.json now claims odds timestamps ("${doc.odds.timestamps}"). If a real ` +
      `timestamped source has been wired, this gate and the "pre-match" labels must be revisited ` +
      `deliberately, not drift.`);
    assert.strictEqual(doc.odds.label, 'pre-match',
      `TEN-204 A4 — series.json labels its odds "${doc.odds.label}" rather than "pre-match".`);
  }
  ok(`D · no user-visible string calls a price a close (${literals.length} literals scanned)`);
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

console.log('test-series-rows: ' + checks.length + ' checks passed');
for (const c of checks) console.log('  ok  ' + c);
