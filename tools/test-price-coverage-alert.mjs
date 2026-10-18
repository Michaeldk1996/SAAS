#!/usr/bin/env node
// Founder ruling 2026-10-18 (item 5): the coverage alert fires on a drop per level and on a join miss — and only then.
import { compare } from './price-coverage-alert.mjs';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const T = (p, n = 100) => ({ n, priced: p, walkover: 0, one: 0, nobook: 0, none: n - p });
const base = { totals: { 'ATP main draw': T(90), 'Challenger main draw': T(40) } };
ok(compare({ totals: { 'ATP main draw': T(90), 'Challenger main draw': T(41) }, joinMiss: 0 }, base).length === 0, 'more or equal coverage, no join miss → no alert');
const d = compare({ totals: { 'ATP main draw': T(88), 'Challenger main draw': T(40) }, joinMiss: 0 }, base);
ok(d.length === 1 && /ATP main draw: priced 90 → 88 of 100/.test(d[0]), 'a drop on one level → one alert line naming it with its denominator');
ok(compare({ totals: { 'ATP main draw': T(90) }, joinMiss: 0 }, base).some(l => /Challenger main draw: priced 40 → none/.test(l)), 'a level gone from the report → an alert');
const j = compare({ totals: base.totals, joinMiss: 2, joinMissEx: [{ player: 'Z. Bergs', opp: 'P. Herbert', event: 'Aix', date: '2026-04-30', level: 'Challenger main draw', cause: 'round' }] }, base);
ok(j.length === 2 && /2 match\(es\) read "No source found yet"/.test(j[0]) && /Bergs v P. Herbert/.test(j[1]), 'a join miss → an alert with the match');
ok(compare({ totals: base.totals, joinMiss: 0 }, null).length === 0, 'no published baseline (the first publish) → no drop alert');
console.log(`\ntest-price-coverage-alert: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
