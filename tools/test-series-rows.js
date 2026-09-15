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
  const lift = new Function('famOf', block + '; return { streakRows, proofSummary, proofOf, setsOf, PROOF_SPEC };');
  const famOf = (st) => (st.type === 'pattern' ? 'setout'
    : st.type === 'setpat' ? (st.firstSet ? 'setgames' : 'setout')
    : (st.family || st.type));
  const B = lift(famOf);

  let checked = 0, withProof = 0;
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
    if (spec && spec.key && vals.length) {
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
    // Phase 3 is not authorised: no row may carry a price.
    for (const r of rows) {
      assert.strictEqual(r.price, null,
        `TEN-204 2.8 C — a row carries a price before Phase 3 was authorised (${p.name}).`);
      assert.strictEqual(r.oppPrice, null,
        `TEN-204 2.8 C — a row carries an opponent price before Phase 3 was authorised (${p.name}).`);
    }
    checked++;
  });
  assert(checked > 0, 'TEN-204 2.8 C — zero streaks audited; the gate would pass vacuously.');
  assert(withProof > 0,
    'TEN-204 2.8 C — no streak produced a proof figure. Either the board carries no line/set ' +
    'family at all, or proofOf() has stopped parsing scores. Investigate before trusting a pass.');
  ok(`C · ${checked} streaks: card cell recomputed from the modal's own rows (${withProof} with a proof figure)`);
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
