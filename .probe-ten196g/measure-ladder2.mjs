import fs from 'fs';
const DATA = JSON.parse(fs.readFileSync('database-yield.json', 'utf8'));
const NAMES = JSON.parse(fs.readFileSync('database-yield-players.json', 'utf8'));
const rows = DATA.rows, nm = NAMES.names;
const PSTEPS_NOW = [1, 2, 5, 10, 20, 25, 50, 100];
const SPEC = [10, 25, 50, 100, 250, 500, 1000, 2500];
const EXT  = [1, 2, 5, 10, 20, 25, 50, 100, 250, 500, 1000, 2500];

function axis(ladder, rawHi, rawLo) {
  let dHi = rawHi, dLo = rawLo;
  if (dHi < 0) dHi = 0; if (dLo > 0) dLo = 0;
  let step, rnd, hi, lo;
  for (let i = 0; i < ladder.length; i++) {
    step = ladder[i];
    if (i < ladder.length - 1 && (dHi - dLo) / step > 10) continue;
    rnd = Math.max(1, step / 5);
    hi = Math.ceil(dHi / rnd) * rnd; lo = Math.floor(dLo / rnd) * rnd;
    if (hi === lo) hi = lo + rnd;
    if (Math.floor(hi / step) - Math.ceil(lo / step) + 1 <= 10) break;
  }
  const g = [];
  for (let v = Math.floor(hi / step) * step; v >= lo; v -= step) g.push(v);
  return { step, hi, lo, grid: g, n: g.length, onlyZero: g.length === 1 && g[0] === 0 };
}

const idx = new Map();
for (let i = 0; i < rows.length; i++) {
  const r = rows[i], w = nm[i][0], l = nm[i][1], fw = r[7];
  const push = (n, rec) => { if (!n) return; if (!idx.has(n)) idx.set(n, []); idx.get(n).push(rec); };
  push(w, { p: fw ? r[5] : r[6], w: 1, d: r[0], fav: fw === 1 });
  push(l, { p: fw ? r[6] : r[5], w: 0, d: r[0], fav: fw === 0 });
}
const out = [];
for (const [name, recs] of idx) {
  let all = [];
  for (const s of [recs, recs.filter(v => v.fav), recs.filter(v => !v.fav)]) {
    const ord = s.slice().sort((a, b) => a.d - b.d); let c = 0;
    for (const v of ord) { c += v.w ? (v.p - 1) : -1; all.push(c); }
  }
  if (!all.length) continue;
  const rawHi = Math.max(...all), rawLo = Math.min(...all);
  out.push({ name, n: recs.length, rawHi, rawLo,
             now: axis(PSTEPS_NOW, rawHi, rawLo), spec: axis(SPEC, rawHi, rawLo), ext: axis(EXT, rawHi, rawLo) });
}

const bands = [[0, 1e9, 'all players'], [30, 1e9, 'n>=30 (above the thin-sample floor)'],
               [100, 1e9, 'n>=100'], [300, 1e9, 'n>=300 (tour regulars)']];
console.log('LADDER            band                                    panels   only "0"   <=2 lines   median lines');
for (const key of ['now', 'spec', 'ext']) {
  for (const [lo, hi, label] of bands) {
    const sub = out.filter(p => p.n >= lo && p.n < hi);
    const oz = sub.filter(p => p[key].onlyZero).length;
    const le2 = sub.filter(p => p[key].n <= 2).length;
    const med = sub.map(p => p[key].n).sort((a, b) => a - b)[Math.floor(sub.length / 2)];
    console.log(`${key.padEnd(6)} ${label.padEnd(46)} ${String(sub.length).padStart(5)} ${String(oz).padStart(9)} ${String(le2).padStart(11)} ${String(med).padStart(12)}`);
  }
  console.log('');
}
// does EXT change Tour/Tournaments? it only prepends smaller steps, which the
// <=10 rule reaches first only when the span is small enough to need them.
const spanTour = (() => { let cf = 0, cd = 0, hi = -1e9, lo = 1e9;
  for (const r of rows) { cf += r[7] ? r[5] - 1 : -1; cd += r[7] ? -1 : r[6] - 1;
    hi = Math.max(hi, cf, cd); lo = Math.min(lo, cf, cd); } return hi - lo; })();
console.log(`Tour unfiltered span ${spanTour.toFixed(1)}u -> under EXT the <=10 rule skips every step below ${Math.ceil(spanTour / 10)}u, so 250 is still first to fit.`);

// worked examples for the write-up
for (const who of ['Khachanov K.', 'Sinner J.', 'Alcaraz C.', 'Djokovic N.', 'Nadal R.']) {
  const p = out.find(x => x.name === who); if (!p) continue;
  console.log(`${who.padEnd(14)} n=${String(p.n).padStart(4)} raw ${p.rawLo.toFixed(1)}..${p.rawHi.toFixed(1)}u | shipped step ${String(p.now.step).padStart(3)} ${p.now.n} lines | §8 step ${p.spec.step} ${p.spec.n} lines [${p.spec.grid.join(', ')}] | ext step ${String(p.ext.step).padStart(3)} ${p.ext.n} lines`);
}
