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

// ── The modal Tournament tab renderer (atournPlayerColumn), sliced out of the shipped HTML ──
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'bsp-consult-dashboard.html'), 'utf8');
  const slice = (start, end, from) => {
    const a = html.indexOf(start); const b = html.indexOf(end, a + (from || 0));
    assert.ok(a >= 0 && b > a, 'slice not found: ' + start);
    return html.slice(a, b);
  };
  const src = slice('function atournYearRowHtml(', '\nfunction showTournamentMore(') +
    slice('function atournPlayerColumn(', '\n// Task 11');
  const ctx = { ANALYSIS_P1_RGBA: () => '', ANALYSIS_P2_RGBA: () => '', ANALYSIS_P1_COLOR: '', ANALYSIS_P2_COLOR: '', ANALYSIS_P2_FILL: '',
    atournMatchRowHtml: () => '<i></i>' };
  vm.createContext(ctx);
  // TEN-314 D2: the one sample gate the win rate goes through (each helper sliced whole from the page)
  const fn = (n) => { const one = slice('\nfunction ' + n + '(', '\n', 1);   // a one-line helper is taken whole
    return /\}\s*$/.test(one) ? one + '\n' : slice('\nfunction ' + n + '(', '\n}\n') + '\n}\n'; };
  const gate = (html.match(/\nconst (MA_GREY|MA_SMALL_NOTE) = [^\n]*/g) || []).join('\n') + '\n'
    + ['tourxSampleGate', 'maGate', 'maPct', 'maRate', 'maRateHtml', 'maGateBar', 'maSmallNote'].map(fn).join('');
  vm.runInContext(gate + src + '\nthis.atournPlayerColumn = atournPlayerColumn;', ctx);
  const stale = { totalWon: 2, totalLost: 1, editionsPlayed: 2, longMatches: 0, longMatchesPlayed: 0, longMatchPct: 0, years: [
    { year: '2022', won: 1, lost: 1, roundReached: '1/8-finals', matches: [] },
    { year: '2021', won: 0, lost: 0, roundReached: 'Withdrawal', matches: [], withdrew: true },
    { year: '2020', won: 0, lost: 0, roundReached: 'Withdrawal', matches: [], withdrew: true },
    { year: '2019', won: 1, lost: 0, roundReached: '1/16-finals', matches: [] }] };
  const out = ctx.atournPlayerColumn('S. Tsitsipas', stale, 'p1', false);
  // Mutation: drop `.filter(y => !y.withdrew)` in atournPlayerColumn → "Withdrawal" and 2021/2020 render.
  check('renderer: a stale store\'s gap rows never render — 2022 and 2019 only', () => {
    assert.ok(!/Withdrawal/.test(out));
    const yrs = [...out.matchAll(/<span class="yr">(\d{4})/g)].map((m) => m[1]);
    assert.deepStrictEqual(yrs, ['2022', '2019']);
    assert.ok(!/earlier edition/.test(out));
  });
  check('control: a clean history renders every edition it carries', () => {
    const o = ctx.atournPlayerColumn('X', { ...stale, years: stale.years.filter((y) => !y.withdrew) }, 'p2', false);
    assert.deepStrictEqual([...o.matchAll(/<span class="yr">(\d{4})/g)].map((m) => m[1]), ['2022', '2019']);
  });
}

console.log(`\nTEN-320 no-gap-editions: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
