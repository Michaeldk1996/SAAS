#!/usr/bin/env node
// TEN-196 round 7 — the "0 of 203" and "13 / 120" figures in CLAUDE.md, reproducible.
// Walks every Tour/Tournament view the tab can produce and compares the axis the
// old ladder picks against §8's literal ladder and against the rejected extend-ladder.
import fs from 'node:fs';
const D = JSON.parse(fs.readFileSync(new URL('../database-yield.json', import.meta.url), 'utf8'));
const rows = D.rows, meta = D.meta;
const OLD  = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const SPEC = [10, 25, 50, 100, 250, 500, 1000, 2500];
const EXT  = [1, 2, 5, 10, 20, 25, 50, 100, 250, 500, 1000, 2500];

function axis(pred, ladder, isTourn) {
  let cf = 0, cd = 0, hi = -Infinity, lo = Infinity;
  for (const r of rows) {
    if (pred && !pred(r)) continue;
    cf += r[7] ? r[5] - 1 : -1;
    cd += r[7] ? -1 : r[6] - 1;
    hi = Math.max(hi, cf, cd); lo = Math.min(lo, cf, cd);
  }
  if (hi === -Infinity) return null;
  const sp = hi - lo;
  let step, rnd, H, L;
  for (let i = 0; i < ladder.length; i++) {
    step = ladder[i];
    if (i < ladder.length - 1 && sp / step > 10) continue;
    rnd = Math.max(10, step / 10);
    H = (isTourn && hi > 0) ? Math.ceil(hi / step) * step : Math.max(rnd, Math.ceil(hi / rnd) * rnd);
    L = Math.floor(lo / rnd) * rnd;
    if (H === L) H = L + rnd;
    if (L > 0) L = 0;
    if (H === L) H = L + rnd;
    if (Math.floor(H / step) - Math.ceil(L / step) + 1 <= 10) break;
  }
  let n = 0;
  for (let v = Math.floor(H / step) * step; v > 0; v -= step) n++;
  for (let v = 0; v >= L; v -= step) n++;
  return [step, H, L, n];
}

const views = [['Tour unfiltered', null, false]];
for (const [c, l] of [[1, 'level'], [2, 'surface'], [3, 'round']])
  for (const v of [...new Set(rows.map((r) => r[c]))]) views.push([`${l}=${v}`, (r) => r[c] === v, false]);
for (const y of [...new Set(rows.map((r) => Math.floor(r[0] / 10000)))])
  views.push([`season ${y}`, (r) => Math.floor(r[0] / 10000) === y, false]);
for (let t = 0; t < meta.tournaments.length; t++) views.push([meta.tournaments[t], (r) => r[4] === t, true]);

let nS = 0, nE = 0, tot = 0, maxLines = 0, moreE = 0, fewerE = 0;
for (const [, pred, isT] of views) {
  const a = axis(pred, OLD, isT); if (!a) continue; tot++;
  const s = axis(pred, SPEC, isT), e = axis(pred, EXT, isT);
  maxLines = Math.max(maxLines, s[3]);
  if (JSON.stringify(s) !== JSON.stringify(a)) nS++;
  if (JSON.stringify(e) !== JSON.stringify(a)) { nE++; if (e[3] > a[3]) moreE++; else if (e[3] < a[3]) fewerE++; }
}
console.log(`views walked                  : ${tot}`);
console.log(`changed by §8's ladder        : ${nS}`);
console.log(`changed by extend-ladder      : ${nE}  (more gridlines ${moreE}, fewer ${fewerE})`);
console.log(`max gridlines under §8        : ${maxLines}  (§8 caps at 10)`);
