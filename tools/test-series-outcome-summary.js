// Series page — continued/broken summary must stay HIDDEN. FAIL-CLOSED.
//
// Founder ruling 2026-09-15 (TEN-204, interaction d6a15334, question `tracker`,
// option `hide`): "Hide the continued/broken summary now, fix it properly later."
//
// WHY. The figure was circular. A streak is defined by the outcomes of the rows in
// it, and the engine graded a match that is already inside the streak's own row
// list — so a winning run could only ever grade "continued". Measured over the
// whole outcome ledger it read 993 continued · 1 broken · 47 not evaluable
// (99.9% held), with six of seven families at exactly 100%. The deployed page was
// telling a reader "1 continued · 0 broken · 100% held" as though that were
// evidence the streak means something. It is a restatement of the definition.
//
// The proper fix — a separate ticket — is to grade the NEXT match, the one AFTER
// the run ends, which is a genuine out-of-sample test. That fix changes WHICH match
// is graded; it does not change this markup. So the hidden body is left intact and
// re-enabling is deleting one line.
//
// METHOD. This does not regex the source. A source check would pass against a file
// that kept the constant and grew a second call site, and it would pass against a
// constant that no longer gated anything. Instead the real bytes are lifted out of
// series.js and EXECUTED against a view that would unambiguously produce a summary
// (played cards, evaluable outcomes, day filter on 'played'). Assertion: empty
// string out.
//
// NEGATIVE CONTROL. The same block is re-executed with the constant forced false.
// It must then produce the summary node. Without that control this file would still
// pass if outcomesSummaryHtml had been gutted to `return ''` for some unrelated
// reason, or if the synthetic view had drifted out of shape and stopped reaching
// the summary path at all — a test that cannot fail measures nothing.
//
// Run: node tools/test-series-outcome-summary.js   (also wired into `npm test`)
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'series.js'), 'utf8');
const checks = [];
const ok = (name) => checks.push(name);

// ── lift the summary block out of the browser IIFE ──────────────────────────
const START = '  var OUTCOME_SUMMARY_HIDDEN =';
const END = '\n  // Two honest empty states.';
const start = src.indexOf(START);
const end = src.indexOf(END);
assert(start > 0 && end > start,
  'series.js outcome-summary block not found — markers moved? (expected "' + START.trim() + '")');
const block = src.slice(start, end);
assert(/function outcomesSummaryHtml\(/.test(block),
  'outcome-summary block no longer defines outcomesSummaryHtml');

// `_filters` is module state further up the file; supply it so the block runs.
function lift(source) {
  // eslint-disable-next-line no-new-func
  return new Function('_filters', source + '\n return outcomesSummaryHtml;');
}

// A view that WOULD produce a summary: played cards, evaluable outcomes, mixed
// held/broken so the percentage line is reached too.
const VIEW = [
  { player: { upcoming: { played: true } }, streak: { outcome: { held: true } } },
  { player: { upcoming: { played: true } }, streak: { outcome: { held: true } } },
  { player: { upcoming: { played: true } }, streak: { outcome: { held: false } } },
  { player: { upcoming: { played: true } }, streak: { outcome: { evaluable: false } } },
];
const FILTERS = { day: 'played' };

// ── A · shipped bytes render nothing ────────────────────────────────────────
{
  const html = lift(block)(FILTERS)(VIEW);
  assert.strictEqual(html, '',
    'continued/broken summary is rendering again — founder ruling 2026-09-15 was HIDE.\n' +
    'Got: ' + JSON.stringify(html).slice(0, 300));
  ok('A · outcomesSummaryHtml returns empty on a view that would otherwise summarise');
}

// ── B · and the call site renders nothing either ────────────────────────────
// A returns '' from the function; B proves nothing downstream re-introduces the
// node from its own markup.
{
  assert(!/sr-outsum/.test(src.slice(end)),
    'an sr-outsum node appears OUTSIDE the hidden block — the summary has a second call site');
  ok('B · no sr-outsum markup outside the hidden block');
}

// ── NEGATIVE CONTROL · flipping the constant must bring it back ─────────────
{
  const unhidden = block.replace(/var OUTCOME_SUMMARY_HIDDEN = true;/,
                                 'var OUTCOME_SUMMARY_HIDDEN = false;');
  assert(unhidden !== block, 'negative control could not flip OUTCOME_SUMMARY_HIDDEN — constant renamed?');
  const html = lift(unhidden)(FILTERS)(VIEW);
  assert(/sr-outsum/.test(html) && /continued/.test(html) && /broken/.test(html),
    'NEGATIVE CONTROL FAILED: with the flag off the summary still does not render, so ' +
    'check A above proves nothing. Either the synthetic view no longer reaches the summary ' +
    'path or the function was gutted independently of the ruling.\nGot: ' + JSON.stringify(html).slice(0, 300));
  ok('NEG · with the flag forced false the summary does render (so check A is not vacuous)');
}

console.log('test-series-outcome-summary: ' + checks.length + ' checks passed');
checks.forEach((c) => console.log('  ✓ ' + c));
