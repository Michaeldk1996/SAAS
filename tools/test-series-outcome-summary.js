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

// ── TEN-427 (founder step 14, 2026-10-10): the hidden summary and the per-card Continued / Broken tags are DELETED.
// The ruling (hide — a streak graded on a match already inside it reads 99.9% "held" by construction) now holds
// because no code can paint either: the 2b card has no tag row and the page carries no summary block. Asserted on
// the comment-stripped source, with a planted control so the scan cannot go vacuous.
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const offends = (t) => /sr-outsum|outcomesSummaryHtml|\.outcome\b|'Continued'|'Broken'|>Continued<|>Broken</.test(code(t));
{
  assert(!offends(src), 'series.js paints the circular continued / broken outcome again (summary or per-card tag)');
  ok('A · no continued / broken summary and no per-card outcome tag in the shipped page');
}
{
  assert(offends(src + "\n var x = '<div class=\"sr-outsum\">';"), 'NEGATIVE CONTROL FAILED: the scan does not see a planted summary');
  assert(offends(src + "\n var y = st.outcome && st.outcome.held;"), 'NEGATIVE CONTROL FAILED: the scan does not see a planted outcome read');
  ok('NEG · a planted summary node or outcome read is caught (check A is not vacuous)');
}

console.log('test-series-outcome-summary: ' + checks.length + ' checks passed');
checks.forEach((c) => console.log('  ✓ ' + c));
