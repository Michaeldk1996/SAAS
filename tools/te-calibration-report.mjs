#!/usr/bin/env node
// The Tennis Explorer calibration report (founder 2026-10-19): reads ONE te-odds batch file (stennisfy-ops
// tools/te-odds-batch.mjs; private store stennisfy-te-store/te-odds/calib-01.json) and prints, per level and overall:
//   join     targets · joined · ambiguous · not found · page disagrees (each of the targets)
//   coverage Pinnacle on the page, of the joined matches
//   accuracy TE's LAST and OPENING Pinnacle price against our verified close (the target's close): exact · within 0.01 ·
//            within 0.05 (the larger of the two sides' differences) · median and p90 no-vig gap (pp) · the largest gaps
//   lead     Pinnacle's last change (the later side) → the real start (our close's startTs), minutes
//   gate     the batch tool's own: median no-vig gap of the LAST price < 0.30pp on n >= 30
// Every count carries its denominator; n < 30 is flagged. A missing value is a dash. Reads the file only: no request.
// Run: node tools/te-calibration-report.mjs <calib-01.json> [--no-prices]   (--no-prices: largest gaps without prices)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const GATE_PP = 0.30, GATE_N = 30;
export const LEVELS = { 'atp-q': 'ATP qualifying', ch: 'Challenger', 'ch-q': 'Challenger qualifying', 'atp-x': 'ATP events Tennis-Data lacks' };
const novig = (a, b) => (1 / a) / (1 / a + 1 / b);
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

// one price pair against the close: null when either side is missing
export function compare(p1, p2, c) {
  if (!(p1 >= 1.01 && p2 >= 1.01 && c && c.p1 >= 1.01 && c.p2 >= 1.01)) return null;
  const d = Math.max(Math.abs(p1 - c.p1), Math.abs(p2 - c.p2));
  return { d, gap: Math.abs(novig(p1, p2) - novig(c.p1, c.p2)) * 100 };
}
export function accuracy(rows, pick) {
  const xs = [];
  for (const r of rows) { const pr = pick(r); if (!pr) continue; const c = compare(pr[0], pr[1], r.close); if (c) xs.push({ ...c, r, pr }); }
  const g = xs.map((x) => x.gap);
  return { n: xs.length, exact: xs.filter((x) => x.d < 0.005).length, w01: xs.filter((x) => x.d <= 0.01 + 1e-9).length,
    w05: xs.filter((x) => x.d <= 0.05 + 1e-9).length, median: med(g), p90: q(g, 0.9),
    largest: [...xs].sort((a, b) => b.gap - a.gap).slice(0, 5) };
}
export function lead(rows) {
  const m = [];
  for (const r of rows) {
    const t = [r.pin && r.pin.p1Ts, r.pin && r.pin.p2Ts].filter(Boolean).sort().pop();
    if (t && r.close && r.close.startTs) m.push((Date.parse(r.close.startTs) - Date.parse(t)) / 60000);
  }
  const noChange = rows.filter((r) => r.pin && r.close && !r.pin.p1Ts && !r.pin.p2Ts).length;
  return { n: m.length, noChange, median: med(m), p10: q(m, 0.1), p90: q(m, 0.9), min: m.length ? Math.min(...m) : null, max: m.length ? Math.max(...m) : null,
    within10: m.filter((x) => x >= 0 && x <= 10).length, within30: m.filter((x) => x >= 0 && x <= 30).length, afterStart: m.filter((x) => x < 0).length };
}
export function report(doc) {
  const groups = { all: doc.rows };
  for (const r of doc.rows) (groups[r.level] = groups[r.level] || []).push(r);
  const out = {};
  for (const [k, rows] of Object.entries(groups)) {
    const n = (s) => rows.filter((r) => r.status === s).length;
    const joined = rows.filter((r) => r.status === 'joined');
    const withPin = joined.filter((r) => r.pin);
    out[k] = { targets: rows.length, joined: joined.length, ambiguous: n('ambiguous'), notFound: n('not found'), pageDisagrees: n('page disagrees'),
      pinnacle: withPin.length, last: accuracy(withPin, (r) => [r.pin.p1, r.pin.p2]),
      open: accuracy(withPin, (r) => r.pin.open && [r.pin.open.p1 ?? r.pin.p1, r.pin.open.p2 ?? r.pin.p2]), lead: lead(withPin) };
  }
  const a = out.all.last;
  out.gate = { pass: a.n >= GATE_N && a.median != null && a.median < GATE_PP, n: a.n, median: a.median };
  return out;
}

const pct = (k, n) => (n ? `${k} of ${n} (${Math.round((100 * k) / n)}%)` : `${k} of 0`);
const pp = (x) => (x == null ? '—' : `${x.toFixed(2)}pp`);
const mins = (x) => (x == null ? '—' : `${Math.round(x)} min`);
const flag = (n) => (n < GATE_N ? ' ⚑ n < 30' : '');
export function text(doc, R, { prices = true } = {}) {
  const L = [`Tennis Explorer calibration — ${doc.batch} (${doc.complete ? 'complete' : 'PARTIAL — figures are not final'}), ${doc.targets} targets`, ''];
  for (const k of ['all', ...Object.keys(LEVELS)]) {
    const g = R[k]; if (!g) continue;
    L.push(`${k === 'all' ? 'ALL LEVELS' : LEVELS[k]}`);
    L.push(`  join      joined ${pct(g.joined, g.targets)} · ambiguous ${g.ambiguous} · not found ${g.notFound} · page disagrees ${g.pageDisagrees} (of ${g.targets} targets)`);
    L.push(`  coverage  Pinnacle on the page ${pct(g.pinnacle, g.joined)} joined`);
    for (const [nm, A] of [['last   ', g.last], ['opening', g.open]]) {
      L.push(`  ${nm}   vs our close: n ${A.n}${flag(A.n)} · exact ${pct(A.exact, A.n)} · within 0.01 ${pct(A.w01, A.n)} · within 0.05 ${pct(A.w05, A.n)} · median no-vig gap ${pp(A.median)} · p90 ${pp(A.p90)}`);
    }
    const ld = g.lead;
    L.push(`  lead      last change → start: n ${ld.n}${flag(ld.n)} · median ${mins(ld.median)} (p10 ${mins(ld.p10)}, p90 ${mins(ld.p90)}, ${mins(ld.min)} – ${mins(ld.max)})`
      + ` · within 10 min ${pct(ld.within10, ld.n)} · within 30 min ${pct(ld.within30, ld.n)} · after the start ${ld.afterStart} · no change recorded ${ld.noChange}`);
    if (k === 'all') for (const [nm, A] of [['last', g.last], ['opening', g.open]]) {
      L.push(`  largest gaps (${nm}):`);
      for (const x of A.largest) L.push(`    ${x.gap.toFixed(2)}pp · ${x.r.a} v ${x.r.b} · ${x.r.date} · ${LEVELS[x.r.level] || x.r.level}` + (prices ? ` · TE ${x.pr[0]} / ${x.pr[1]} vs our close ${x.r.close.p1} / ${x.r.close.p2}` : ''));
    }
    L.push('');
  }
  L.push(`GATE (median no-vig gap of the last price < ${GATE_PP}pp on n >= ${GATE_N}): ${R.gate.pass ? 'PASS' : 'NOT MET'} — median ${pp(R.gate.median)} on n ${R.gate.n}`);
  return L.join('\n');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const f = process.argv[2];
  if (!f) { console.log('usage: te-calibration-report.mjs <calib-01.json> [--no-prices]'); process.exit(2); }
  const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
  console.log(text(doc, report(doc), { prices: !process.argv.includes('--no-prices') }));
}
