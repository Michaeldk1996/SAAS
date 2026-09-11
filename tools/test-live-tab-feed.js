#!/usr/bin/env node
'use strict';
// TEN-190 source guard — the Live tab is feed-driven, and stays that way.
//
// This is a SOURCE guard, not a behavioural test: it reads the shipped files and
// asserts that the founder's rulings and the standing "never fabricate" rule are
// still encoded in them. It exists because the Live tab has already regressed
// once in a way nothing caught — commit 12936d6 deleted the container
// live-tab.js rendered into, and `if (!g) return;` turned every render into a
// silent no-op that looked exactly like "no matches live right now".
//
// Founder rulings encoded here (2026-09-11):
//   • Pressure points row DROPPED — no feed stat, and synthesising one would
//     print an invented metric beside real ones.
//   • Live stays ATP singles only.
//   • The "a displayed set renders at least 12 games" floor DELETED — against a
//     real feed it padded a short set with games nobody played.
//
// Standing rule: missing data is a dash, never a zero. A zero in a tennis score
// means zero points, so this matters more here than anywhere else on the site.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const LIVEJS = fs.readFileSync(path.join(ROOT, 'live-tab.js'), 'utf8');

// The Live tab's renderer is the LAST <script> block in the dashboard.
const blockStart = HTML.lastIndexOf('<script>');
const RAW_LIVE = HTML.slice(blockStart, HTML.indexOf('</script>', blockStart));
if (!/lvTab/.test(RAW_LIVE)) {
  console.error('FATAL: could not locate the #lvTab renderer block — this guard is not looking at the Live tab.');
  process.exit(1);
}

// Strip whole-line comments before asserting on absence. The comments in this
// block deliberately NAME the things that were removed and why ("the 12-game
// floor is DELETED"), so a bare text search would match the explanation and
// report the removal as a regression. Only full-line comments are dropped —
// never a trailing one — so no code line is ever altered.
const decomment = (src) => src
  .split('\n')
  .filter(l => !l.trimStart().startsWith('//'))
  .join('\n');
const LIVE = decomment(RAW_LIVE);
const LIVEJS_CODE = decomment(LIVEJS);

let pass = 0, fail = 0;
const ok   = (m) => { console.log('  ✓ ' + m); pass++; };
const bad  = (m) => { console.log('  ✗ ' + m); fail++; };
const check = (cond, m) => cond ? ok(m) : bad(m);

console.log('=== source guard: founder rulings (TEN-190, 2026-09-11) ===');

check(!/Pressure points/i.test(LIVE),
  'Pressure points row is gone (no feed stat; ruled "drop")');

check(!/Math\.max\(\s*12\s*,/.test(LIVE),
  'the 12-game floor is gone (ruled "delete" — it fabricated games never played)');

check(/\/atp\/i\.test\(t\)\s*&&\s*\/single\/i\.test\(t\)/.test(LIVEJS),
  'the ATP-singles gate is intact (ruled "stay ATP-singles-only")');

console.log('=== source guard: no placeholder data ships ===');

check(!/randomuser\.me/.test(LIVE),
  'the randomuser.me avatar generator is gone — avatars come from the feed');

check(!/placeholder data for design review/.test(LIVE),
  'the "placeholder data for design review" disclaimer is gone');

check(!/const\s+LIVE_DATA\s*=/.test(LIVE) && !/const\s+NAMES_DATA\s*=/.test(LIVE),
  'the hardcoded LIVE_DATA / NAMES_DATA match list is gone');

check(!/globalRate\s*=\s*metric\s*===?\s*'HOLD'\s*\?\s*0\.88/.test(LIVE),
  'the hardcoded 0.88 / 0.24 hold-break constant is gone (pill is the real rate)');

check(/holdbreak\(\)/.test(LIVE),
  'the heat grid reads the holdbreak.json rollup');

console.log('=== source guard: never fabricate ===');

// The point log opens a game row the INSTANT a game starts, with score,
// player_served, serve_winner and serve_lost ALL null. Read naively that reads
// as a completed game won by player 2 (server "not A", "not broken"), which
// draws a momentum swing for a game nobody has won. Caught in build.
check(/serve_winner\s*!=\s*null\s*\|\|\s*gm\.serve_lost\s*!=\s*null/.test(LIVE),
  'momentum plots only DECIDED games (serve_winner/serve_lost stamped)');

check(/hasSubstance/.test(LIVE),
  'the Points tab skips an empty placeholder game row (needs a score or a point)');

// A rate over zero attempts does not exist — 0 break points faced is not a 0%
// save rate. It must dash.
check(/if\s*\(\s*c\.total\s*<=\s*0\s*\)\s*return null/.test(LIVE),
  'a rate over zero attempts dashes rather than printing 0%');

// api-tennis nulls stat_won/stat_total on some rows and carries the pair only in
// stat_value as "X/Y". Number(null) is 0, which silently turns missing into zero.
check(/\\s\*\\\/\\s\*\(\\d\+\)/.test(LIVE) || /\(\\d\+\)\\s\*\\\/\\s\*\(\\d\+\)/.test(LIVE),
  'stat_value "X/Y" is parsed when stat_won/stat_total are null (Number(null) is 0)');

check(/FEED\.ready/.test(LIVE) && /inPlayCount:DASH/.test(LIVE),
  'before the first snapshot the header dashes rather than claiming 0 in play');

console.log('=== source guard: live-tab.js is the data layer, not a renderer ===');

// The exact failure that made this tab die silently. Nothing in this module may
// write into the old container again.
check(!/getElementById\(['"]liveGrid['"]\)/.test(LIVEJS_CODE),
  'live-tab.js no longer reads #liveGrid (the container that was deleted)');

check(!/\bfunction cardHtml\b/.test(LIVEJS_CODE),
  'the orphaned board renderer (cardHtml) is removed, not left to be re-wired');

check(/window\.LiveFeed\s*=/.test(LIVEJS) && /subscribe\(fn\)/.test(LIVEJS),
  'live-tab.js publishes through window.LiveFeed.subscribe()');

// The renderer is an INLINE script and therefore parses BEFORE this deferred
// module runs. It cannot call subscribe() directly; it queues and we drain.
check(/__LV_SUBS/.test(LIVEJS) && /__LV_SUBS/.test(LIVE),
  'the inline-renderer / deferred-module handshake (__LV_SUBS) is on both sides');

check(/serveRating:\s*Detail\.serveRating/.test(LIVEJS),
  'the Live tab imports the model’s own rating formulas (one definition, no drift)');

console.log('');
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
