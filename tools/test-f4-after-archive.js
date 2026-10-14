#!/usr/bin/env node
// F4 (founder ruling 2026-10-14): Record per tournament's "after the Database archive's last match" hover shows on a row
// with NO date, judged by its edition. Executes the shipped dashboard functions (sliced from the source).
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'bsp-consult-dashboard.html'), 'utf8');
const fn = name => { const a = src.indexOf('\nfunction ' + name + '('); if (a < 0) throw new Error(name);
  let d = 0, i = src.indexOf('{', a); for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; } return src.slice(a, i + 1); };
const make = (spans, end) => new Function('newsEventSpans', 'sfEventKey', '_sfDbJoin',
  ['trDbEnd', 'trDayWords', 'trPxAfterTitle', 'trPxAfterOf', 'trPxAfterOfEdition'].map(fn).join('\n') + '\nreturn { trPxAfterOf, trPxAfterOfEdition };')(
  () => spans, n => n, end ? { meta: { dateRange: ['2010-01-04', end] } } : null);
let pass = 0; const eq = (a, b, m) => { assert.strictEqual(a, b, m); pass++; };
const WHY = 'After the Database archive’s last match (13 Sep 2026): no closing price on record yet';
const SH = { 2025: { s: '2025-10-01', e: '2025-10-12' } };                 // Shanghai: only 2025 dated → moved to 2026
let api = make(SH, '2026-09-13');
eq(api.trPxAfterOfEdition('Shanghai', 2026), WHY, 'Shanghai 2026 (dateless Zhou row) → the reason');
eq(api.trPxAfterOfEdition('Shanghai', 2025), null, 'an earlier season → no reason');
eq(api.trPxAfterOfEdition('Shanghai', 2027), WHY, 'a later year needs no dates');
api = make({ 2026: { s: '2026-03-04', e: '2026-03-15' } }, '2026-09-13');
eq(api.trPxAfterOfEdition('Indian Wells', 2026), null, 'an edition inside the archive → no reason (never a guess)');
api = make({ 2026: { s: '2026-09-13', e: '2026-09-20' } }, '2026-09-13');
eq(api.trPxAfterOfEdition('X', 2026), null, 'an edition starting ON the last day → no reason');
api = make(null, '2026-09-13');
eq(api.trPxAfterOfEdition('Shanghai', 2026), null, 'store not loaded → no reason');
api = make(SH, null);
eq(api.trPxAfterOfEdition('Shanghai', 2026), null, 'join not answered → no reason');
// the module asks by edition only when the row has no date
const mod = fs.readFileSync(path.join(__dirname, '..', 'player-profile-v2.js'), 'utf8');
assert.ok(/var why = m\.date \? \(typeof window\.trPxAfterOf === 'function' \? window\.trPxAfterOf\(m\.date\) : null\)\s*: \(t && typeof window\.trPxAfterOfEdition === 'function' \? window\.trPxAfterOfEdition\(t\.name, m\.year\) : null\);/.test(mod)); pass++;
assert.strictEqual((mod.match(/pxAfterHtml\(m, t\) \|\|/g) || []).length, 2, 'both H and A cells pass the tournament'); pass++;
console.log(`test-f4-after-archive: ${pass} checks passed`);
