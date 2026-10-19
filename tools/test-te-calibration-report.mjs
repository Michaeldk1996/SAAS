#!/usr/bin/env node
// tools/te-calibration-report.mjs on a fixed batch file: every figure recomputed by hand, plus controls.
import assert from 'node:assert/strict';
import { report, text, compare, GATE_N } from './te-calibration-report.mjs';
let ok = 0; const t = (n, f) => { f(); ok++; console.log('  PASS ', n); };
const C = (p1, p2, startTs = '2026-10-04T10:00:00Z') => ({ p1, p2, startTs });
const J = (level, pin, close) => ({ status: 'joined', level, a: 'A.', b: 'B.', date: '2026-10-04', pin, close });
const pin = (p1, p2, ts, open) => ({ p1, p2, p1Ts: ts, p2Ts: null, open: open || { p1, p2 } });
const doc = { batch: 'calib-01', complete: true, targets: 7, rows: [
  J('ch', pin(1.5, 2.6, '2026-10-04T09:50:00Z', { p1: 1.6, p2: 2.4 }), C(1.5, 2.6)),              // exact; lead 10
  J('ch', pin(1.51, 2.6, '2026-10-04T09:00:00Z', { p1: 1.5, p2: 2.6 }), C(1.5, 2.6)),             // within 0.01; lead 60; opened at the close
  J('ch-q', pin(1.54, 2.5, null), C(1.5, 2.6)),                                                    // 0.10 off on side 2: outside 0.05; no change recorded
  J('ch-q', null, C(1.5, 2.6)),                                                                     // joined, no Pinnacle
  { status: 'ambiguous', level: 'atp-q', candidates: ['1', '2'] },
  { status: 'not found', level: 'atp-q' },
  { status: 'page disagrees', level: 'ch' },
] };
const R = report(doc);
t('join counts with their denominators, per level and overall', () => {
  assert.deepEqual([R.all.targets, R.all.joined, R.all.ambiguous, R.all.notFound, R.all.pageDisagrees, R.all.pinnacle], [7, 4, 1, 1, 1, 3]);
  assert.deepEqual([R.ch.targets, R.ch.joined, R.ch.pinnacle, R['ch-q'].joined, R['ch-q'].pinnacle, R['atp-q'].joined], [3, 2, 2, 2, 1, 0]);
});
t('accuracy of the last price: exact / within 0.01 / within 0.05 on the larger side difference', () => {
  assert.deepEqual([R.all.last.n, R.all.last.exact, R.all.last.w01, R.all.last.w05], [3, 1, 2, 2]);
});
t('the no-vig gap: median and p90 recomputed by hand', () => {
  const g = [compare(1.5, 2.6, C(1.5, 2.6)).gap, compare(1.51, 2.6, C(1.5, 2.6)).gap, compare(1.54, 2.5, C(1.5, 2.6)).gap].sort((a, b) => a - b);
  assert.equal(R.all.last.median, g[1]); assert.equal(R.all.last.p90, g[2]); assert.equal(g[0], 0);
});
t('the opening price is measured separately (a missing open side falls back to the last price: TE shows no move)', () => {
  assert.equal(R.all.open.n, 3); assert.equal(R.all.open.exact, 1); assert.equal(R.all.open.w05, 1);
});
t('lead: last change → our start, a side with no change is counted as such, never given a time', () => {
  assert.deepEqual([R.all.lead.n, R.all.lead.median, R.all.lead.within10, R.all.lead.noChange], [2, 35, 1, 1]);
});
t('gate: needs n >= 30 — a perfect small sample is NOT MET, and says so', () => {
  assert.equal(R.gate.pass, false); assert.match(text(doc, R), /NOT MET/); assert.match(text(doc, R), /⚑ n < 30/);
});
t('gate: 30 matches with a 0.20pp median pass; the same at 0.40pp do not (control)', () => {
  const mk = (p1) => ({ batch: 'calib-01', complete: true, targets: GATE_N, rows: Array.from({ length: GATE_N }, () => J('ch', pin(p1, 2.0, null), C(2.0, 2.0))) });
  const a = report(mk(1.984)), b = report(mk(1.968));
  assert(a.all.last.median > 0.19 && a.all.last.median < 0.21 && a.gate.pass);
  assert(b.all.last.median > 0.39 && !b.gate.pass);
});
t('a missing price is no comparison (a dash), never a zero gap', () => {
  assert.equal(compare(null, 2, C(1.5, 2.6)), null); assert.equal(compare(1.5, 2.6, null), null);
});
t('--no-prices keeps names and gaps, drops the prices', () => {
  const s = text(doc, R, { prices: false }); assert(!/TE 1\.54/.test(s) && /A\. v B\./.test(s)); assert(/TE 1\.54/.test(text(doc, R)));
});
console.log(`\ntest-te-calibration-report: ${ok} passed, 0 failed`);
