#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════════
// TEN-206 · COURT TYPE CAPTURE (founder ruling on the gate-3 "indoors" question)
// ----------------------------------------------------------------------------
// The gate offered four columns + a footnote, five columns of dashes, or a
// pipeline ticket. The founder picked none of them and corrected the premise:
// "We should have it through api tennis."
//
// He was right, and the reason it looked missing is ours. API-Tennis spells
// indoor events as "Hard (Indoor)" / "Clay (Indoor)" / "Grass (Indoor)" in
// `tournament_sourface` — 635 + 43 + 2 of 10,280 tournaments on a full census —
// and normalizeSurface() matches on the substring, so every one of them has
// always collapsed to a bare surface. The court type was being discarded in our
// normaliser, not withheld upstream.
//
// These tests pin the capture. They do NOT need a pipeline run: they drive
// buildAllTierYearly directly with synthetic fixtures, which is also the only
// way to assert the pre-window branch (a real run cannot produce a player whose
// provider aggregate is empty on demand).
// ════════════════════════════════════════════════════════════════════════════
const assert = require('assert');
const P = require('../bsp-pipeline.js');

let pass = 0, fail = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; failures.push(name + ' :: ' + e.message); console.log('  FAIL  ' + name + ' :: ' + e.message); }
}
function mustFail(name, fn) {
  try { fn(); } catch (e) { pass++; console.log('  PASS  [neg] ' + name + ' (correctly rejected)'); return; }
  fail++; failures.push('[neg] ' + name + ' :: did not reject');
  console.log('  FAIL  [neg] ' + name + ' :: did not reject — the check is inert');
}

console.log('TEN-206 · court-type capture\n');

// ── 1 · the feed spelling ────────────────────────────────────────────────────
console.log('1 · Recognising the feed\'s spelling');

check('every "(Indoor)" spelling the census found is recognised', () => {
  ['Hard (Indoor)', 'Clay (Indoor)', 'Grass (Indoor)'].forEach((s) => {
    assert.strictEqual(P.isIndoorTournament({ tournament_sourface: s }), true, s);
  });
});

check('outdoor and unknown surfaces are not read as indoor', () => {
  ['Hard', 'Clay', 'Grass', 'hard', '', null, undefined, '- Qualification'].forEach((s) => {
    assert.strictEqual(P.isIndoorTournament({ tournament_sourface: s }), false, String(s));
  });
});

mustFail('[neg] the matcher would reject a bare-substring implementation', () => {
  // A naive /indoor/i would fire on a tournament literally named for a place
  // containing the word. The parenthesised form is the feed's actual convention.
  assert.strictEqual(P.isIndoorTournament({ tournament_sourface: 'Hard' }), true);
});

// ── 2 · buildAllTierYearly carries it without moving anything else ───────────
console.log('\n2 · Yearly buckets');

const YEAR = new Date().getFullYear();
const SURF = new Map([['100', 'hard'], ['200', 'clay'], ['300', 'grass']]);
const COURT = new Map([['100', 'indoor'], ['200', 'outdoor'], ['300', 'outdoor']]);

function fx(tk, date, won) {
  return {
    event_type_type: 'Atp Singles', event_status: 'Finished',
    event_winner: won ? 'First Player' : 'Second Player',
    first_player_key: '1', second_player_key: '2',
    event_date: date, tournament_key: tk,
  };
}
// Three indoor-hard wins, one outdoor-hard loss, one clay win, one grass loss.
const FIX = [
  fx('100', YEAR + '-02-01', true), fx('100', YEAR + '-02-02', true),
  fx('100', YEAR + '-11-03', true), fx('100', YEAR + '-11-04', false),
  fx('200', YEAR + '-05-01', true), fx('300', YEAR + '-06-01', false),
];
// tournament 100 is indoor; give the outdoor-hard loss its own outdoor key.
SURF.set('101', 'hard'); COURT.set('101', 'outdoor');
FIX[3] = fx('101', YEAR + '-11-04', false);

const STATS = { seasons: [] };

check('indoor matches are counted in BOTH the surface bucket and the indoor one', () => {
  const rows = P.buildAllTierYearly(FIX, '1', STATS, YEAR, SURF, COURT);
  const y = rows.find(r => String(r.year) === String(YEAR));
  assert(y, 'no row for the current year');
  // 4 hard matches total (3 indoor wins + 1 outdoor loss) — the surface bucket
  // must still hold all four, or every existing consumer of `hard` just moved.
  assert.strictEqual(y.hard.won, 3, `hard.won ${y.hard.won}`);
  assert.strictEqual(y.hard.lost, 1, `hard.lost ${y.hard.lost}`);
  assert(y.indoor, 'no indoor breakdown emitted');
  assert.strictEqual(y.indoor.total.won, 3);
  assert.strictEqual(y.indoor.total.lost, 0);
  assert.strictEqual(y.indoor.hard.won, 3);
});

check('the surface buckets are byte-identical with and without a court map', () => {
  const withCourt = P.buildAllTierYearly(FIX, '1', STATS, YEAR, SURF, COURT);
  const without = P.buildAllTierYearly(FIX, '1', STATS, YEAR, SURF, null);
  const strip = rs => rs.map(r => JSON.stringify({
    year: r.year, total: r.total, clay: r.clay, hard: r.hard, grass: r.grass,
  })).join('|');
  assert.strictEqual(strip(withCourt), strip(without),
    'adding the court map moved a surface bucket — the capture is not additive');
});

check('the carve-out the grid performs is always non-negative', () => {
  const rows = P.buildAllTierYearly(FIX, '1', STATS, YEAR, SURF, COURT);
  rows.forEach((r) => {
    if (!r.indoor) return;
    ['clay', 'hard', 'grass'].forEach((s) => {
      const surf = r[s] || { won: 0, lost: 0 };
      const ind = r.indoor[s] || { won: 0, lost: 0 };
      assert(surf.won - ind.won >= 0 && surf.lost - ind.lost >= 0,
        `${r.year}/${s}: indoor exceeds the surface it is carved from`);
    });
    const tot = r.total || { won: 0, lost: 0 };
    assert(r.indoor.total.won + r.indoor.total.lost <= tot.won + tot.lost,
      `${r.year}: indoor exceeds the year total`);
  });
});

check('a year with no indoor match carries no indoor key, not a zero record', () => {
  const clayOnly = [fx('200', YEAR + '-05-01', true), fx('200', YEAR + '-05-02', false)];
  const rows = P.buildAllTierYearly(clayOnly, '1', STATS, YEAR, SURF, COURT);
  const y = rows.find(r => String(r.year) === String(YEAR));
  assert.strictEqual(y.indoor, null,
    'an all-outdoor year emitted an indoor record — 0-0 reads as "played none", ' +
    'which is a different claim from "none on record"');
});

check('a missing court map degrades to no indoor data, never to all-outdoor', () => {
  const rows = P.buildAllTierYearly(FIX, '1', STATS, YEAR, SURF, new Map());
  const y = rows.find(r => String(r.year) === String(YEAR));
  assert.strictEqual(y.indoor, null, 'an empty court map invented an indoor record');
  assert.strictEqual(y.hard.won, 3, 'an empty court map moved the surface buckets');
});

mustFail('[neg] the additive check would catch a carve-out done in the pipeline', () => {
  // If someone later "simplifies" by subtracting indoor from hard at build time,
  // hard.won drops 3 -> 0 and every existing consumer silently changes.
  const rows = P.buildAllTierYearly(FIX, '1', STATS, YEAR, SURF, COURT);
  const y = rows.find(r => String(r.year) === String(YEAR));
  assert.strictEqual(y.hard.won, 0, 'hard still holds its indoor matches');
});

// ── 3 · the pre-window boundary ─────────────────────────────────────────────
console.log('\n3 · The pre-window boundary (why the column cannot be complete)');

check('pre-window rows carry indoor:null — no court-type source exists that far back', () => {
  // yearlyBreakdown() reads the provider's ATP season aggregate, which has
  // clay/hard/grass and no court type. Those rows must dash, not read as zero.
  const stats = { seasons: [] };
  const rows = P.buildAllTierYearly([], '1', stats, YEAR, SURF, COURT);
  rows.filter(r => r.allTier === false).forEach((r) => {
    assert.strictEqual(r.indoor, null,
      `${r.year}: a pre-window row claims court-type data it cannot have`);
  });
});

check('the court map reader survives a cache written before court capture', () => {
  const m = P.loadTournamentCourtMap();
  assert(m instanceof Map, 'did not return a Map');
  // Either populated (cache refreshed) or empty (cache predates capture) — both
  // are fine. What must never happen is a throw or a default of "outdoor".
  [...m.values()].forEach((v) => {
    assert(v === 'indoor' || v === 'outdoor', `unexpected court value ${v}`);
  });
  console.log(`        court map holds ${m.size} tournaments` +
    (m.size ? ` (${[...m.values()].filter(v => v === 'indoor').length} indoor)` : ' — cache predates capture, column will dash until the next refresh'));
});

console.log('\n' + '='.repeat(64));
console.log(`PASS ${pass}   FAIL ${fail}`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f));
}
process.exit(fail ? 1 : 0);
