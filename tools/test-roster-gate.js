#!/usr/bin/env node
/**
 * TEN-206 Q2(c) — fail-closed roster gate on the PUBLISHED player-profiles.json.
 *
 * Founder ruling (2026-09-16, Q2c): "Never publish a profile missing careerByYear
 * (the career spine). The roster gate asserts 0 shells, not <10%."
 *
 * The <10% form is what the rejected `ten-206-roster-union` branch shipped, and it
 * passed at 12.7%-adjacent numbers while every one of the 61 profiles it "restored"
 * was a shell. This gate replaces it.
 *
 * WHY THERE ARE THREE ASSERTIONS, NOT ONE.
 * "0 shells" alone is satisfiable by publishing nothing, and the pipeline satisfies
 * it by DROPPING shells — so a gate that only counts shells is measuring its own
 * fix and would stay green while the roster silently emptied. So:
 *
 *   A. zero shells                — the ruling itself
 *   B. roster floor               — the drop cannot be the way to pass
 *   C. every publishable cache
 *      entry actually published   — the drop removed shells and nothing else
 *
 * Run: node tools/test-roster-gate.js [path/to/player-profiles.json]
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const PROFILES = process.argv[2] || path.join(REPO, 'player-profiles.json');
const CACHE = process.argv[3] || path.join(REPO, 'player-profiles-cache.json');

// The floor is deliberately NOT "whatever we published last time" — that ratchets
// down one quiet Monday at a time, which is the 137-vs-428 failure mode. It is a
// fixed number below the smallest healthy roster we have measured (428 committed,
// 470 in the cache) and above the largest board-only roster we have measured (137).
const ROSTER_FLOOR = 300;

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function run() {
  if (!fs.existsSync(PROFILES)) {
    console.error(`FAIL  player-profiles.json not found at ${PROFILES}`);
    process.exit(1);
  }
  const published = readJson(PROFILES).players || {};
  const keys = Object.keys(published);

  // ---- A. zero shells (the ruling) ----------------------------------------
  const shells = keys.filter(k => !published[k] || !published[k].careerByYear);
  check(shells.length === 0,
    'Q2c: zero published profiles missing careerByYear',
    `${shells.length} shell(s) of ${keys.length} published`
      + (shells.length ? ` — e.g. ${shells.slice(0, 5).join(', ')}` : ''));

  // ---- B. the roster did not collapse -------------------------------------
  check(keys.length >= ROSTER_FLOOR,
    `roster floor: ${ROSTER_FLOOR}+ players published`,
    `${keys.length} published`);

  // ---- C. everything publishable was published ----------------------------
  // Guards the other direction: the pipeline must not satisfy A by dropping
  // players that were perfectly good. Anything in the cache at the current schema
  // version, within TTL, carrying a careerByYear, must appear in the output.
  //
  // It only means anything when the two files come from the SAME run, which is why
  // this gate's CI home is after the pipeline step and before "Assemble site". Run
  // it by hand against a published file older than the cache and it compares a July
  // snapshot with a cache rebuilt this morning: the 7 "missing" players are simply
  // ones the cache learned about later. Skew that large is reported and skipped
  // rather than failed — a false red teaches people to ignore the gate.
  if (fs.existsSync(CACHE)) {
    const pipeline = require(path.join(REPO, 'bsp-pipeline.js'));
    const { PROFILE_SCHEMA_VERSION, OPPONENT_PROFILE_MAX_AGE_MS } = pipeline;
    const cacheFile = readJson(CACHE);
    const cached = cacheFile.players || {};
    const now = Date.now();
    const pubAt = Date.parse(readJson(PROFILES).fetchedAt || '');
    const cacheAt = Date.parse(cacheFile.fetchedAt || '');
    const SAME_RUN_MS = 60 * 60 * 1000; // one hour: far longer than a run, far shorter than a day
    const skewed = Number.isFinite(pubAt) && Number.isFinite(cacheAt)
      && Math.abs(cacheAt - pubAt) > SAME_RUN_MS;
    if (skewed) {
      console.log('SKIP  cache cross-check — published and cache are from different runs '
        + `(${Math.round(Math.abs(cacheAt - pubAt) / 3600000)}h apart); this check is in-run only`);
      console.log(`\nRoster gate: ${failures === 0 ? 'GREEN' : `RED (${failures} failure(s))`} `
        + `· ${keys.length} players · ${shells.length} shells`);
      process.exit(failures === 0 ? 0 : 1);
    }
    const publishable = Object.keys(cached).filter((k) => {
      const e = cached[k];
      return e && e.profile && e.profile.careerByYear && e.builtAt
        && e.v === PROFILE_SCHEMA_VERSION
        && (now - new Date(e.builtAt).getTime() < OPPONENT_PROFILE_MAX_AGE_MS);
    });
    const missing = publishable.filter(k => !published[k]);
    check(missing.length === 0,
      'every current-schema, in-TTL, career-bearing cache entry is published',
      `${publishable.length} publishable, ${missing.length} missing`
        + (missing.length ? ` — e.g. ${missing.slice(0, 5).join(', ')}` : ''));
  } else {
    console.log('SKIP  cache cross-check — no player-profiles-cache.json on disk');
  }

  console.log(`\nRoster gate: ${failures === 0 ? 'GREEN' : `RED (${failures} failure(s))`} `
    + `· ${keys.length} players · ${shells.length} shells`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
