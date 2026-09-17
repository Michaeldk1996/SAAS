#!/usr/bin/env node
/**
 * TEN-227 — render betsapi-out/semantics.json into the board's Phase 2 addendum
 * tables. Pure reader: no network, no token, no writes outside stdout.
 *
 * The board asked four things the Phase 2 sample could not answer, all of which
 * need rows rather than counts:
 *   - is 13_3 total GAMES or total SETS, proved against five final scores
 *   - is 13_2 a games handicap or a set handicap, same proof
 *   - main line only, or several lines per match
 *   - the exact target lines, as a share of matches
 *
 * "Proved against the final score" is the whole point, so the test is stated
 * explicitly rather than eyeballed: a total-games line sits within a few games
 * of the match's game count and cannot sit at 2.5 in a best-of-three, and a
 * games handicap is quoted in whole/half games against the game margin. Both
 * verdicts are derived here, from the run's own rows, and print alongside the
 * evidence so they can be checked rather than taken on trust.
 */

import { readFileSync } from 'node:fs';

const path = process.argv[2] || 'betsapi-out/semantics.json';
const d = JSON.parse(readFileSync(path, 'utf8'));

const med = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (v, dp = 1) => (v == null ? '—' : Number(v).toFixed(dp));

console.log(`ran_at            ${d.ran_at}`);
console.log(`requests used     ${d.requests_used ?? '—'}`);
console.log(`entitlement       recent ${d.entitlement?.recent?.http}/${d.entitlement?.recent?.success} n=${d.entitlement?.recent?.n}  ·  2017 ${d.entitlement?.historical_2017?.http}/${d.entitlement?.historical_2017?.success} n=${d.entitlement?.historical_2017?.n}`);
console.log(`events summarised ${d.summarised ?? '—'} (known ids ${d.scanned?.known_ids ?? 0} + widened ${d.scanned?.extra ?? 0})`);
console.log(`book-hits with a non-null 13_2/13_3: ${d.hits?.length ?? 0}`);

const byBook = {};
for (const h of d.hits || []) byBook[h.book] = (byBook[h.book] || 0) + 1;
console.log(`  by book: ${Object.entries(byBook).map(([b, n]) => `${b}×${n}`).join('  ') || '—'}`);

console.log(`\nrecent tennis /v2/event/odds market keys: ${JSON.stringify(d.recent_series_markets?.markets || {})}`);
console.log(`  n=${d.recent_series_markets?.n ?? 0}  with 13_2=${d.recent_series_markets?.with_2 ?? 0}  with 13_3=${d.recent_series_markets?.with_3 ?? 0}`);

for (const m of ['13_2', '13_3']) {
  const lines = Object.entries(d.lines?.[m] || {}).sort((a, b) => b[1] - a[1]);
  const perMatch = d.lines_per_match?.[m] || [];
  console.log(`\n=== ${m} ===`);
  console.log(`rows returned across sampled series: ${d.market_rows?.[m] ?? 0}`);
  console.log(`matches with a pre-start quote: ${perMatch.length}${perMatch.length < 30 ? '  ⚠️ n < 30' : ''}`);
  console.log(`distinct lines (× matches): ${lines.length ? lines.map(([l, c]) => `${l}×${c}`).join('  ') : '—'}`);
  console.log(`lines per match: median ${fmt(med(perMatch))}  range ${perMatch.length ? `${Math.min(...perMatch)}–${Math.max(...perMatch)}` : '—'}`);

  const ex = d.examples?.[m] || [];
  if (!ex.length) { console.log('example rows: — (no pre-start row carried a line)'); continue; }
  console.log('\nexample rows — line vs final score:');
  for (const e of ex) {
    const line = e.closing_row?.handicap ?? '—';
    console.log(`  ${e.match} · ${e.league}`);
    console.log(`     final ${e.final_ss} = ${e.total_games} games, margin ${e.game_margin}, sets ${e.set_score} (${e.sets_played} played)`);
    console.log(`     line ${line}  home ${e.closing_row?.home_od ?? e.closing_row?.over_od ?? '—'} / away ${e.closing_row?.away_od ?? e.closing_row?.under_od ?? '—'}  add_time ${e.closing_row?.add_time}`);
    console.log(`     all pre-start lines on this match: ${e.distinct_pre_lines.join(', ') || '—'}`);
  }

  // The verdict, derived rather than asserted. A total-games line has to live in
  // the same numeric world as the match's game count; a sets line cannot.
  const nums = ex.map((e) => Number(e.closing_row?.handicap)).filter((x) => Number.isFinite(x));
  const games = ex.map((e) => e.total_games).filter((x) => Number.isFinite(x));
  if (nums.length && games.length) {
    const absMed = med(nums.map(Math.abs));
    const gMed = med(games);
    console.log(`\n  median |line| ${fmt(absMed)} vs median total games ${fmt(gMed)} vs median sets played ${fmt(med(ex.map((e) => e.sets_played).filter(Boolean)))}`);
    if (m === '13_3') {
      console.log(`  verdict: ${absMed >= 10 ? 'TOTAL GAMES — the line lives in the same range as the game count, an order of magnitude above the set count'
        : absMed <= 5 ? 'TOTAL SETS — the line sits at set scale, not game scale'
          : 'AMBIGUOUS — line scale sits between sets and games; do not rule either way on this n'}`);
    } else {
      console.log(`  verdict: ${absMed >= 1.5 && absMed <= 9 ? 'GAMES HANDICAP — half-game lines quoted against a game margin'
        : absMed <= 1.5 ? 'POSSIBLE SET HANDICAP — ±1.5 scale; check the set score column before ruling'
          : 'AMBIGUOUS on this n'}`);
    }
  }
}

// (f) the target lines, as a share of the matches that carried any quote.
const TARGETS = { '13_2': ['-2.5', '+2.5', '-3.5', '+3.5', '-4.5', '+4.5', '-1.5', '+1.5'], '13_3': ['20.5', '22.5', '21.5', '23.5'] };
console.log('\n=== (f) target lines ===');
for (const m of ['13_2', '13_3']) {
  const denom = (d.lines_per_match?.[m] || []).length;
  for (const t of TARGETS[m]) {
    const hit = d.lines?.[m]?.[t] ?? d.lines?.[m]?.[t.replace('+', '')] ?? 0;
    console.log(`  ${m} ${t.padEnd(6)} ${hit}/${denom || 0} ${denom ? `(${((100 * hit) / denom).toFixed(1)}%)` : '(—)'}`);
  }
}
