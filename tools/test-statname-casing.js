#!/usr/bin/env node
'use strict';
// TEN-206 — api-tennis `stat_name` must never be read raw.
//
// Founder ruling 2026-09-18: "lowercase every stat_name at read time everywhere,
// not just in bsp-pipeline.js. Add an assertion that fails if any reader compares
// a raw stat_name."
//
// WHY THIS EXISTS — measured, not theoretical. Over all 12,115 finished ATP
// singles 2024-01 → 2026-09-18 (33 get_fixtures month pages, event_type_key=265)
// the feed emits the SAME stat under two different casings depending on season:
//
//     2024 + 2025            2026
//     "1st Serve Percentage" "1st serve percentage"
//     "Service Games Won"    "Service games won"
//     "Return Games Won"     "Return games won"
//     "Unforced Errors"      "Unforced errors"
//     "Net Points Won"       "Net points won"
//
// and the flip is NOT clean: 84 finished 2026 fixtures (Brisbane, Hong Kong,
// ATP United Cup, 2026-01-02..01-08) still carry the old casing. Other names
// (Aces, Double Faults, Break Points Saved/Converted, Total Points Won,
// Service/Return Points Won) have not drifted — which is luck, not a guarantee,
// so they get the same treatment.
//
// The cost of getting this wrong is a SILENT BLANK, not an error: live-tab.js
// keyed its stat index by the raw name and looked rows up with lowercase-only
// literals, so serveRating()/returnRating() returned {rating:null} on every
// Title-Case fixture — the whole 2024+2025 corpus and that first week of 2026 —
// and a null rating renders exactly like "the feed hasn't published it yet".
// The audit's own first pass reported 2024 and 2025 as 0.0% coverage for
// Winners/UE/Net points for the identical reason.
//
// This is a SOURCE guard in the same spirit as tools/test-live-tab-feed.js: it
// reads the shipped files and fails if any line touches `stat_name` without
// case-folding it. It cannot prove a reader is correct; it can prove no reader
// is comparing raw, which is the class of bug that actually happened twice.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Every shipped file that touches the feed's statistics rows. Listed explicitly
// rather than globbed: a glob would quietly stop covering a file that gets
// renamed, and this guard's whole job is to not be quietly incomplete. A new
// stat_name reader that is not in this list is caught by the sweep below.
const FILES = [
  'match-stat-placeholders.js',          // TEN-263: untracked W/UE placeholder rule
  'tools/test-ten263-pipeline.js',
  'bsp-pipeline.js',
  'live-tab.js',
  'build-trading-splits.js',
  'styles-apitennis-supplement.js',
  'clutch-apitennis-supplement.js',
  'surface-ratings-chall-apitennis.js',
  'dna-apitennis-ratings.js',
  'tools/harvest-wue-store.mjs',
  'tools/build-atp-entry-wue.js',
  'verify_dna_python.py',
];

// A line is SAFE when it case-folds the name on the read side, either by
// lowercasing it or by matching it with a case-insensitive regex.
const CASE_FOLDED = /\.toLowerCase\s*\(\)|\.toUpperCase\s*\(\)|\/i[^A-Za-z]|localeCompare|\.lower\s*\(\)/;

// Lines that only NAME the field in prose. Kept narrow on purpose: a bare
// "contains the word stat_name" skip would let a real comparison hide behind a
// trailing comment.
const isCommentLine = line => /^\s*(\/\/|\*|\/\*|#)/.test(line.trim());

const offenders = [];
const scanned = [];
const missing = [];

for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { missing.push(rel); continue; }
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  let hits = 0;
  lines.forEach((line, i) => {
    if (!line.includes('stat_name')) return;
    if (isCommentLine(line)) return;
    hits++;
    if (!CASE_FOLDED.test(line)) {
      offenders.push({ file: rel, line: i + 1, text: line.trim() });
    }
  });
  scanned.push({ rel, hits });
}

// Sweep: any OTHER tracked source that reads stat_name must be added to FILES
// above (and therefore checked). This is what stops the guard rotting as the
// codebase grows a new reader.
let unlisted = [];
try {
  const tracked = require('child_process')
    .execSync('git ls-files -- "*.js" "*.mjs" "*.py" "*.html"', { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  // This guard is itself a tracked file full of the string it hunts for, so it
  // matches its own sweep the moment it is committed (it passed pre-commit and
  // went red on the first run after — caught by re-running the suite rather than
  // trusting the earlier green). Exempt it explicitly; nothing else is exempt.
  const listed = new Set([...FILES, 'tools/test-statname-casing.js']);
  for (const f of tracked) {
    if (listed.has(f)) continue;
    const abs = path.join(ROOT, f);
    let src;
    try { src = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    if (!src.includes('stat_name')) continue;
    // Prose-only mentions (docs, comments in unrelated files) are not readers.
    const real = src.split('\n').some(l => l.includes('stat_name') && !isCommentLine(l));
    if (real) unlisted.push(f);
  }
} catch (e) {
  console.log(`  (git ls-files sweep skipped: ${e.message})`);
}

console.log('stat_name casing guard — files scanned:');
for (const s of scanned) console.log(`  ${s.rel} — ${s.hits} stat_name read line(s)`);
if (missing.length) console.log(`  not present (skipped): ${missing.join(', ')}`);

let failed = false;

if (offenders.length) {
  failed = true;
  console.error('\nFAIL: raw stat_name comparison(s) — the feed changes casing by season:');
  for (const o of offenders) console.error(`  ${o.file}:${o.line}  ${o.text}`);
  console.error('\nFix: compare String(s.stat_name).toLowerCase() against a lowercase literal,');
  console.error('or key any lookup index by the lowercased name on BOTH write and read.');
}

if (unlisted.length) {
  failed = true;
  console.error('\nFAIL: file(s) read stat_name but are not covered by this guard:');
  for (const f of unlisted) console.error(`  ${f}`);
  console.error('\nFix: add them to FILES in tools/test-statname-casing.js so they are checked.');
}

// A guard that passes because it looked at nothing is worse than no guard. The
// floor is the readers we know exist today; it rises, never silently falls.
const MIN_EXPECTED_READ_LINES = 12;
const totalHits = scanned.reduce((a, s) => a + s.hits, 0);
if (totalHits < MIN_EXPECTED_READ_LINES) {
  failed = true;
  console.error(`\nFAIL: only ${totalHits} stat_name read line(s) found, expected >= ${MIN_EXPECTED_READ_LINES}.`);
  console.error('The guard is no longer looking at the code it was written to protect.');
}

if (failed) process.exit(1);
console.log(`\nPASS: ${totalHits} stat_name read line(s) across ${scanned.length} file(s), all case-folded.`);
