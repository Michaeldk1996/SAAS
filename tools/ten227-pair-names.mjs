#!/usr/bin/env node
/**
 * TEN-227 — pair BetsAPI player names against our own roster.
 *
 *   node tools/ten227-pair-names.mjs <sample.json> <player-index.json>
 *
 * Standing rule: NFD accent strip, drop on ambiguity, report match rate and
 * dropped count. Nothing here writes to the product; it prints a table.
 *
 * Read the result with one caveat in front of it: player-index.json is TODAY's
 * ATP standings, so a 2017 fixture involving a since-retired player cannot match
 * however good the string handling is. The per-year breakdown makes that
 * roster-coverage effect visible instead of charging it to the matcher.
 */

import { readFileSync } from 'node:fs';

const [, , samplePath, indexPath] = process.argv;
if (!samplePath || !indexPath) { console.error('usage: ten227-pair-names.mjs <sample.json> <player-index.json>'); process.exit(2); }

const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')   // accent strip
  .toLowerCase()
  .replace(/[.'`’]/g, '')
  .replace(/[-_/]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const surnameKey = (full) => {
  const parts = norm(full).split(' ').filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[parts.length - 1]}|${parts[0][0]}`;   // surname + first initial
};

const index = JSON.parse(readFileSync(indexPath, 'utf8')).players;
const byFull = new Map();
const bySurname = new Map();
for (const p of index) {
  const f = norm(p.name);
  if (!byFull.has(f)) byFull.set(f, []);
  byFull.get(f).push(p);
  const sk = surnameKey(p.name);
  if (sk) {
    if (!bySurname.has(sk)) bySurname.set(sk, []);
    bySurname.get(sk).push(p);
  }
}

const stats = {};
const bump = (cell, k) => { stats[cell] ||= { players: 0, exact: 0, initial: 0, ambiguous: 0, unmatched: 0 }; stats[cell][k]++; };
const unmatchedExamples = new Map();

const sample = JSON.parse(readFileSync(samplePath, 'utf8'));
for (const [cell, events] of Object.entries(sample)) {
  for (const ev of events) {
    for (const who of [ev.home, ev.away]) {
      bump(cell, 'players');
      const f = norm(who);
      const exact = byFull.get(f);
      if (exact?.length === 1) { bump(cell, 'exact'); continue; }
      if (exact?.length > 1) { bump(cell, 'ambiguous'); continue; }
      const sk = surnameKey(who);
      const cand = sk ? bySurname.get(sk) : null;
      if (cand?.length === 1) { bump(cell, 'initial'); continue; }
      if (cand?.length > 1) { bump(cell, 'ambiguous'); continue; }
      bump(cell, 'unmatched');
      if (!unmatchedExamples.has(cell)) unmatchedExamples.set(cell, []);
      if (unmatchedExamples.get(cell).length < 6) unmatchedExamples.get(cell).push(who);
    }
  }
}

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');
console.log(`roster: ${index.length} players\n`);
console.log('cell              n   exact  initial  ambig  unmatched   matched');
console.log('-'.repeat(68));
const tot = { players: 0, exact: 0, initial: 0, ambiguous: 0, unmatched: 0 };
for (const [cell, s] of Object.entries(stats).sort()) {
  for (const k of Object.keys(tot)) tot[k] += s[k];
  const matched = s.exact + s.initial;
  console.log(`${cell.padEnd(17)}${String(s.players).padStart(4)}${String(s.exact).padStart(8)}${String(s.initial).padStart(9)}${String(s.ambiguous).padStart(7)}${String(s.unmatched).padStart(11)}   ${pct(matched, s.players)}`);
}
console.log('-'.repeat(68));
const matchedTot = tot.exact + tot.initial;
console.log(`${'TOTAL'.padEnd(17)}${String(tot.players).padStart(4)}${String(tot.exact).padStart(8)}${String(tot.initial).padStart(9)}${String(tot.ambiguous).padStart(7)}${String(tot.unmatched).padStart(11)}   ${pct(matchedTot, tot.players)}`);
console.log(`\ndropped on ambiguity: ${tot.ambiguous} (${pct(tot.ambiguous, tot.players)})`);
console.log(`dropped as unmatched: ${tot.unmatched} (${pct(tot.unmatched, tot.players)})`);
console.log('\nunmatched examples:');
for (const [cell, ex] of unmatchedExamples) console.log(`  ${cell}: ${ex.join(', ')}`);
