#!/usr/bin/env node
// TEN-320 (founder N6, 2026-09-28, .claude/rules/modal-analysis.md): tournament edition lists
// show ONLY editions the player actually entered. No header is synthesised from a gap year —
// the old fill minted a 0-0 "Withdrawal" row for every year between a player's first and last
// edition, including editions never held (Tsitsipas at Tokyo 2020/2021; Tokyo was cancelled).
// Drives the REAL builders (bsp-pipeline.js buildTournamentHistory, career-backfill.js
// buildEmbeddedHistory) and the modal Tournament tab renderer sliced out of the shipped HTML.
const assert = require('assert');
const fs = require('fs'), path = require('path'), vm = require('vm');
const P = require('../bsp-pipeline.js');
const { _internal } = require('../career-backfill.js');

let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); } };
const yearsOf = (h) => h.years.map((y) => y.year);

// ── The Tsitsipas Tokyo case: entered 2019, 2022, 2024; W/O given 2023; Tokyo not held 2020/21 ──
const tk = (o) => Object.assign({ p1: 'S. Tsitsipas', p1Key: '1011', p2: 'X', p2Key: '9', result: '2 - 0' }, o);
{
  const h = P.buildTournamentHistory([
    tk({ date: '2019-10-01', season: '2019', winner: 'First Player', round: 'ATP Tokyo - 1/16-finals' }),
    tk({ date: '2019-10-03', season: '2019', winner: 'Second Player', round: 'ATP Tokyo - 1/8-finals', result: '1 - 2' }),
    tk({ date: '2022-10-04', season: '2022', winner: 'Second Player', round: 'ATP Tokyo - 1/16-finals', result: '0 - 2' }),
    tk({ date: '2023-10-17', season: '2023', winner: 'Second Player', round: 'ATP Tokyo - 1/16-finals', walkover: true, result: '0 - 0' }),
    tk({ date: '2024-09-25', season: '2024', winner: 'First Player', round: 'ATP Tokyo - 1/16-finals' }),
  ], '1011');
  // Mutation: restore the "Fill in any year strictly between…" loop in buildTournamentHistory
  // → 2020, 2021 (never held) and 2023 (W/O given only) come back as Withdrawal rows.
  check('Tsitsipas Tokyo: only the editions entered — 2024, 2022, 2019; no 2020/2021 header', () => {
    assert.deepStrictEqual(yearsOf(h), ['2024', '2022', '2019']);
  });
  check('Tsitsipas Tokyo: no row carries withdrew / "Withdrawal"', () => {
    assert.ok(!h.years.some((y) => y.withdrew || y.roundReached === 'Withdrawal'));
  });
  // Mutation: editionsPlayed: years.length + 1 (or counting a gap row) → 4.
  check('Tsitsipas Tokyo: "editions played" counts the three entered (a W/O given is not one)', () => {
    assert.strictEqual(h.editionsPlayed, 3);
    assert.deepStrictEqual([h.totalWon, h.totalLost], [2, 2]);
  });
}

// ── Gap-year fixture through the TML backfill (the pre-2021 half) ─────────────────────
{
  const existing = P.buildTournamentHistory([
    tk({ date: '2023-05-01', season: '2023', winner: 'First Player', round: 'ATP Madrid - 1/32-finals' }),
  ], '1011');
  const { history, added } = _internal.buildEmbeddedHistory(existing, [
    { year: 2017, round: 'R64', oppName: 'A', won: false, score: '6-3 6-4' },
  ]);
  // Mutation: restore the gap loop in career-backfill finalizeEmbedded → 2018…2022 rows appear.
  check('gap-year fixture (TML merge): 2023 + 2017 only, no 2018-2022 header', () => {
    assert.strictEqual(added, 1);
    assert.deepStrictEqual(yearsOf(history), ['2023', '2017']);
    assert.strictEqual(history.editionsPlayed, 2);
  });
  // Mutation: drop `if (y.withdrew) continue;` in buildEmbeddedHistory → the stale 2020 row survives.
  check('a store cached before TEN-320 loses its synthesised gap rows on the next merge', () => {
    const stale = { years: [
      { year: '2023', matchCount: 1, won: 1, lost: 0, roundReached: '1/32-finals', matches: [] },
      { year: '2020', matchCount: 0, won: 0, lost: 0, roundReached: 'Withdrawal', matches: [], withdrew: true }] };
    const { history: h2 } = _internal.buildEmbeddedHistory(stale, [{ year: 2017, round: 'R64', oppName: 'A', won: true, score: '6-3 6-4' }]);
    assert.deepStrictEqual(yearsOf(h2), ['2023', '2017']);
  });
}

// ── The modal Tournament tab (TEN-332 rebuild): the renderer drops a stale store's gap rows. Its behaviour is driven end to
//    end in test-ten332-tournament.mjs ("N6: only editions entered", mutant in tools/test-ten332-mutants.js); here the
//    guard's presence in the shipped page is checked so this suite still names the ruling it owns. ──
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'bsp-consult-dashboard.html'), 'utf8');
  check('renderer: the Tournament tab filters a stale store\'s synthesised gap rows (`withdrew`)', () => {
    // TEN-341 moved the filter into trEditionsOf, shared by the Tournament tab (trModelFor) and Key factors' Tournament card
    assert.ok(html.includes("function trEditionsOf(hist){ return ((hist && hist.years) || []).filter(y => !y.withdrew); }"));
    assert.ok(html.includes("  const years = trEditionsOf(hist);"), 'the Tournament tab reads its editions through it');
  });
}

console.log(`\nTEN-320 no-gap-editions: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
