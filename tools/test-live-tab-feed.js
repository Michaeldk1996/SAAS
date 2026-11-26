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

console.log('=== source guard: the locked Live page (founder brief 2026-11-25) ===');

// The 2026-11-25 design draws "Pressure points won on serve / on return": the feed has no such stat, so both rows are a
// dash — never a figure synthesised from the point log (the 2026-09-11 reason for dropping the row still holds).
check(/twoSided\('Pressure points won on serve', null, null\)/.test(LIVE) && /twoSided\('Pressure points won on return', null, null\)/.test(LIVE),
  'Pressure points rows are a dash (no feed stat; nothing synthesised)');

check(!/Math\.max\(\s*12\s*,/.test(LIVE),
  'the 12-game floor is gone (ruled "delete" — it fabricated games never played)');

check(/\/atp\/i\.test\(t\)\s*&&\s*\/single\/i\.test\(t\)/.test(LIVEJS) && /\/\^challenger men singles\$\/i/.test(LIVEJS) && /all\.filter\(isLiveTour\)/.test(LIVEJS),
  'the grid gate is ATP + Challenger men\'s singles (brief 2026-11-25), never ITF / WTA / doubles');

console.log('=== source guard: no placeholder data ships ===');

check(!/randomuser\.me/.test(LIVE), 'the randomuser.me avatar generator is not shipped');
check(!/sample data for design review/.test(LIVE), 'the prototype\'s sample-data footnote is not shipped');
check(!/\bSEED\(/.test(LIVE) && !/\bsim\(/.test(LIVE) && !/const\s+LIVE\s*=\s*\[/.test(LIVE), 'no generator, seeded random or sample match list');
check(!/heatFormat|inPlayPrices/.test(LIVE), 'the design-only switches are not shipped');
check(/hbData\(\)/.test(LIVE) && /holdbreak\(\)/.test(LIVE), 'the heat grid reads the holdbreak.json rollup');

console.log('=== source guard: never fabricate ===');

// A game row opens with every field null; read naively it is a game won by player 2. Only DECIDED games are results.
check(/const decided = g => g\.serve_winner != null \|\| g\.serve_lost != null;/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'live-moments.js'), 'utf8')),
  'only DECIDED games count as results (serve_winner / serve_lost stamped)');
check(/const ratio = c => c && c\[1\] > 0 \? pc\(c\[0\], c\[1\]\) : null;/.test(LIVE),
  'a rate over zero attempts dashes rather than printing 0%');
check(/\(\\d\+\)\\s\*\\\/\\s\*\(\\d\+\)/.test(LIVE),
  'stat_value "X/Y" is parsed when stat_won/stat_total are null (Number(null) is 0)');
check(/ready \? String\(ip\) : D/.test(LIVE) && /if \(!FEED\.ready\) return skeletonHtml\(\);/.test(LIVE),
  'before the first snapshot the header dashes and the grid shows the loading skeleton, never "Nothing in play"');
// founder 2026-11-26: the in-play price is Bet105's (kibl_live_ml, pushed), never the pre-match price passed off as live
check(/rpc\/live_ml_state/.test(LIVE) && /table: 'kibl_live_ml'/.test(LIVE) && /px\(m\.lp\.v\[s\]\)/.test(LIVE) && !/px\(m\.pre\.v\[s\]\)[^\n]*Bet105 in-play/.test(LIVE),
  'the live price is Bet105 in-play (live_ml_state + kibl_live_ml push), a separate slot from Pre');

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
