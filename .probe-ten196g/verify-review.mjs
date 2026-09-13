// Check the clean-context review's data claims against my own parser.
import fs from 'fs';
const D = JSON.parse(fs.readFileSync('database-yield.json', 'utf8'));
const N = JSON.parse(fs.readFileSync('database-yield-players.json', 'utf8'));
const rows = D.rows, nm = N.names, meta = D.meta;
const OLD_P = [1, 2, 5, 10, 20, 25, 50, 100];
const SPEC = [10, 25, 50, 100, 250, 500, 1000, 2500];
const EXT = [1, 2, 5, 10, 20, 25, 50, 100, 250, 500, 1000, 2500];

function pAxis(ladder, rawHi, rawLo, rndFn) {
  let dHi = rawHi, dLo = rawLo;
  if (dHi < 0) dHi = 0; if (dLo > 0) dLo = 0;
  let step, rnd, hi, lo;
  for (let i = 0; i < ladder.length; i++) {
    step = ladder[i];
    if (i < ladder.length - 1 && (dHi - dLo) / step > 10) continue;
    rnd = rndFn(step);
    hi = Math.ceil(dHi / rnd) * rnd; lo = Math.floor(dLo / rnd) * rnd;
    if (hi === lo) hi = lo + rnd;
    if (Math.floor(hi / step) - Math.ceil(lo / step) + 1 <= 10) break;
  }
  const g = []; for (let v = Math.floor(hi / step) * step; v >= lo; v -= step) g.push(v);
  return { step, hi, lo, grid: g, rawHi, rawLo, zeroExcluded: !(0 <= rawHi && 0 >= rawLo) };
}
const RP = s => Math.max(1, s / 5), RT = s => Math.max(10, s / 10);

const idx = new Map();
for (let i = 0; i < rows.length; i++) {
  const r = rows[i], w = nm[i][0], l = nm[i][1], fw = r[7];
  const p = (n, rec) => { if (!n) return; if (!idx.has(n)) idx.set(n, []); idx.get(n).push(rec); };
  p(w, { p: fw ? r[5] : r[6], w: 1, d: r[0], fav: fw === 1 });
  p(l, { p: fw ? r[6] : r[5], w: 0, d: r[0], fav: fw === 0 });
}
const P = [];
for (const [name, recs] of idx) {
  let all = [];
  for (const s of [recs, recs.filter(v => v.fav), recs.filter(v => !v.fav)]) {
    const o = s.slice().sort((a, b) => a.d - b.d); let c = 0;
    for (const v of o) { c += v.w ? v.p - 1 : -1; all.push(c); }
  }
  P.push({ name, n: recs.length, rawHi: Math.max(...all), rawLo: Math.min(...all) });
}

// R1 — "672 of 1,129 render at least one positive gridline" is now ___
const posOld = P.filter(p => pAxis(OLD_P, p.rawHi, p.rawLo, RP).grid.some(v => v > 0)).length;
const posNew = P.filter(p => pAxis(SPEC, p.rawHi, p.rawLo, RP).grid.some(v => v > 0)).length;
console.log(`R1  positive gridline: OLD ladder ${posOld}  NEW ladder ${posNew}   (comment says 672)`);

// R2 — force-zero rescue count: 204 under old, ? under new
const resc = (L, R) => P.filter(p => p.zeroExcluded).length;
const zeroExcl = P.filter(p => p.zeroExcluded).length;
console.log(`R2  panels whose RAW range excludes zero (force-zero rescues): ${zeroExcl}   (comment says 204)`);

// R3 — Prado on the BUILT state
for (const who of ['Prado Angelo J.C.']) {
  const p = P.find(x => x.name === who); if (!p) { console.log('R3  not found'); continue; }
  const f = (ax) => ((p.rawHi - p.rawLo) / (ax.hi - ax.lo) * 100).toFixed(1);
  console.log(`R3  ${who} n=${p.n}: live(old+RP) ${f(pAxis(OLD_P, p.rawHi, p.rawLo, RP))}%  built(SPEC+RP) ${f(pAxis(SPEC, p.rawHi, p.rawLo, RP))}%  SPEC+RT ${f(pAxis(SPEC, p.rawHi, p.rawLo, RT))}%`);
}

// R4 — THE BIG ONE: does the Tour rnd take the 699 blank axes to zero?
const blank = (L, R) => P.filter(p => { const a = pAxis(L, p.rawHi, p.rawLo, R); return a.grid.length === 1 && a.grid[0] === 0; }).length;
const le2 = (L, R) => P.filter(p => pAxis(L, p.rawHi, p.rawLo, R).grid.length <= 2).length;
const medFill = (L, R) => { const a = P.map(p => { const x = pAxis(L, p.rawHi, p.rawLo, R); return (p.rawHi - p.rawLo) / (x.hi - x.lo) * 100; }).sort((x, y) => x - y); return a[Math.floor(a.length / 2)].toFixed(1); };
console.log(`\nR4  ladder      rnd            only "0"   <=2 lines   median fill`);
for (const [ln, L] of [['OLD (live)', OLD_P], ['SPEC §8', SPEC], ['EXTEND', EXT]])
  for (const [rn, R] of [['players max(1,s/5)', RP], ['tour    max(10,s/10)', RT]])
    console.log(`    ${ln.padEnd(11)} ${rn.padEnd(22)} ${String(blank(L, R)).padStart(6)} ${String(le2(L, R)).padStart(11)} ${String(medFill(L, R)).padStart(12)}%`);

// R5 — extend-ladder: do TOURNAMENT domains change?
function tAxis(pred, ladder, isTourn) {
  let cf = 0, cd = 0, hi = -Infinity, lo = Infinity;
  for (const r of rows) { if (pred && !pred(r)) continue; cf += r[7] ? r[5] - 1 : -1; cd += r[7] ? -1 : r[6] - 1; hi = Math.max(hi, cf, cd); lo = Math.min(lo, cf, cd); }
  if (hi === -Infinity) return null;
  const sp = hi - lo; let step, rnd, H, L;
  for (let i = 0; i < ladder.length; i++) {
    step = ladder[i];
    if (i < ladder.length - 1 && sp / step > 10) continue;
    rnd = Math.max(10, step / 10);
    H = (isTourn && hi > 0) ? Math.ceil(hi / step) * step : Math.max(rnd, Math.ceil(hi / rnd) * rnd);
    L = Math.floor(lo / rnd) * rnd;
    if (H === L) H = L + rnd; if (L > 0) L = 0; if (H === L) H = L + rnd;
    if (Math.floor(H / step) - Math.ceil(L / step) + 1 <= 10) break;
  }
  return { step, H, L };
}
const OLD_T = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
let domCh = 0, stepCh = 0, trans = {};
for (let t = 0; t < meta.tournaments.length; t++) {
  const a = tAxis(r => r[4] === t, OLD_T, true), b = tAxis(r => r[4] === t, EXT, true);
  if (!a) continue;
  if (a.step !== b.step) { stepCh++; trans[`${a.step}->${b.step}`] = (trans[`${a.step}->${b.step}`] || 0) + 1; }
  if (a.H !== b.H || a.L !== b.L) domCh++;
}
console.log(`\nR5  extend-ladder on 169 events: step changes ${stepCh}, DOMAIN changes ${domCh}   transitions ${JSON.stringify(trans)}`);
let domChTour = 0;
const tv = [];
for (const [c] of [[1], [2], [3]]) for (const v of [...new Set(rows.map(r => r[c]))]) tv.push(r => r[c] === v);
for (const y of [...new Set(rows.map(r => Math.floor(r[0] / 10000)))]) tv.push(r => Math.floor(r[0] / 10000) === y);
for (const pr of tv) { const a = tAxis(pr, OLD_T, false), b = tAxis(pr, EXT, false); if (a && (a.H !== b.H || a.L !== b.L)) domChTour++; }
console.log(`    extend-ladder on 33 filtered Tour views: DOMAIN changes ${domChTour}`);

// R6 — M5 severity: off-by-one at the bottom of the player label loop
let emptied = 0, lost = 0;
for (const p of P) {
  const a = pAxis(SPEC, p.rawHi, p.rawLo, RP);
  const g2 = []; for (let v = Math.floor(a.hi / a.step) * a.step; v > a.lo; v -= a.step) g2.push(v);
  if (g2.length < a.grid.length) lost++;
  if (g2.length === 0) emptied++;
}
console.log(`\nR6  M5 off-by-one (v>=lo -> v>lo): ${lost} of ${P.length} panels lose a gridline, ${emptied} left with an EMPTY y axis`);
