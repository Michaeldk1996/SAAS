// TEN-196 round 7 — measure the cost of applying CHARTS.md §8's ladder literally.
// Imports nothing from the page. Reads the two deployed artefacts directly.
import fs from 'fs';

const DATA = JSON.parse(fs.readFileSync('database-yield.json', 'utf8'));
const NAMES = JSON.parse(fs.readFileSync('database-yield-players.json', 'utf8'));
const rows = DATA.rows, nm = NAMES.names;

const PSTEPS_NOW = [1, 2, 5, 10, 20, 25, 50, 100];          // as shipped, Players
const STEPS_NOW  = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000]; // as shipped, Tour/Tournaments
const SPEC       = [10, 25, 50, 100, 250, 500, 1000, 2500]; // CHARTS.md §8, literal

// ---- Players path, transcribed from bsp-consult-dashboard.html:24857-24866 ----
function playerAxis(ladder, rawHi, rawLo, rndFn) {
  let dHi = rawHi, dLo = rawLo;
  if (dHi < 0) dHi = 0;            // PLAYER_ZERO_IN_DOMAIN
  if (dLo > 0) dLo = 0;
  let step, rnd, hi, lo;
  for (let i = 0; i < ladder.length; i++) {
    step = ladder[i];
    if (i < ladder.length - 1 && (dHi - dLo) / step > 10) continue;
    rnd = rndFn(step);
    hi = Math.ceil(dHi / rnd) * rnd; lo = Math.floor(dLo / rnd) * rnd;
    if (hi === lo) { hi = lo + rnd; }
    if (Math.floor(hi / step) - Math.ceil(lo / step) + 1 <= 10) break;
  }
  const grid = [];
  for (let v = Math.floor(hi / step) * step; v >= lo; v -= step) grid.push(v);
  return { step, hi, lo, n: grid.length };
}
const RND_PLAYER = s => Math.max(1, s / 5);
const RND_TOUR   = s => Math.max(10, s / 10);

// ---- build the player index exactly as buildPlayerIndex does ----
const idx = new Map();
for (let i = 0; i < rows.length; i++) {
  const r = rows[i], w = nm[i][0], l = nm[i][1], favWon = r[7];
  const push = (n, rec) => { if (!n) return; if (!idx.has(n)) idx.set(n, []); idx.get(n).push(rec); };
  push(w, { p: favWon ? r[5] : r[6], w: 1, d: r[0], fav: favWon === 1 });
  push(l, { p: favWon ? r[6] : r[5], w: 0, d: r[0], fav: favWon === 0 });
}

// ---- per-player domain: all three series concatenated (line 24804) ----
const out = [];
for (const [name, recs] of idx) {
  const series = [recs, recs.filter(v => v.fav), recs.filter(v => !v.fav)];
  let all = [];
  for (const s of series) {
    const ord = s.slice().sort((a, b) => a.d - b.d);
    let c = 0;
    for (const v of ord) { c += v.w ? (v.p - 1) : -1; all.push(c); }
  }
  if (!all.length) continue;
  const rawHi = Math.max(...all), rawLo = Math.min(...all);
  const now  = playerAxis(PSTEPS_NOW, rawHi, rawLo, RND_PLAYER);
  const spec = playerAxis(SPEC,       rawHi, rawLo, RND_PLAYER);
  const specTourRnd = playerAxis(SPEC, rawHi, rawLo, RND_TOUR);
  out.push({ name, n: recs.length, rawHi, rawLo, now, spec, specTourRnd });
}

const pct = (o, rawHi, rawLo) => ((rawHi - rawLo) / (o.hi - o.lo)) * 100;

console.log(`players measured: ${out.length}`);
const hist = (key) => {
  const h = {};
  for (const p of out) h[p[key].n] = (h[p[key].n] || 0) + 1;
  return Object.keys(h).sort((a, b) => a - b).map(k => `${k}:${h[k]}`).join('  ');
};
console.log('gridline count, as shipped :', hist('now'));
console.log('gridline count, §8 literal :', hist('spec'));

const stepHist = (key) => {
  const h = {};
  for (const p of out) h[p[key].step] = (h[p[key].step] || 0) + 1;
  return Object.keys(h).sort((a, b) => a - b).map(k => `step ${k}: ${h[k]}`).join('   ');
};
console.log('step chosen, as shipped    :', stepHist('now'));
console.log('step chosen, §8 literal    :', stepHist('spec'));

// domain change — does keeping rnd=max(1,step/5) preserve the panel fill?
let domSame = 0, domWider = 0, worstFill = [];
for (const p of out) {
  const a = pct(p.now, p.rawHi, p.rawLo), b = pct(p.spec, p.rawHi, p.rawLo);
  if (p.now.hi === p.spec.hi && p.now.lo === p.spec.lo) domSame++; else domWider++;
  worstFill.push({ name: p.name, n: p.n, now: a, spec: b, d: b - a,
                   nowDom: [p.now.lo, p.now.hi], specDom: [p.spec.lo, p.spec.hi],
                   tourRnd: pct(p.specTourRnd, p.rawHi, p.rawLo) });
}
console.log(`\ndomain identical under §8 ladder (rnd kept): ${domSame} of ${out.length}; changed: ${domWider}`);
worstFill.sort((x, y) => x.d - y.d);
console.log('\nlargest panel-fill losses, §8 ladder with Players rnd kept:');
for (const w of worstFill.slice(0, 8))
  console.log(`  ${w.name.padEnd(18)} n=${String(w.n).padStart(4)}  fill ${w.now.toFixed(1)}% -> ${w.spec.toFixed(1)}%  dom ${JSON.stringify(w.nowDom)} -> ${JSON.stringify(w.specDom)}`);

const tourRndLoss = worstFill.slice().sort((x, y) => (x.tourRnd - x.now) - (y.tourRnd - y.now));
console.log('\n(counterfactual) same ladder but ALSO adopting the Tour rnd=max(10,step/10):');
for (const w of tourRndLoss.slice(0, 5))
  console.log(`  ${w.name.padEnd(18)} fill ${w.now.toFixed(1)}% -> ${w.tourRnd.toFixed(1)}%`);
const medFill = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
console.log(`  median fill: shipped ${medFill(worstFill.map(w => w.now)).toFixed(1)}%  §8+players-rnd ${medFill(worstFill.map(w => w.spec)).toFixed(1)}%  §8+tour-rnd ${medFill(worstFill.map(w => w.tourRnd)).toFixed(1)}%`);

// named subjects from the gate
for (const who of ['Khachanov K.', 'Sinner J.']) {
  const p = out.find(x => x.name === who);
  if (p) console.log(`\n${who}: raw ${p.rawLo.toFixed(2)}..${p.rawHi.toFixed(2)}u  shipped step ${p.now.step} (${p.now.n} lines, dom ${p.now.lo}..${p.now.hi})  §8 step ${p.spec.step} (${p.spec.n} lines, dom ${p.spec.lo}..${p.spec.hi})`);
}

// ---- does dropping 5000 from the Tour/Tournaments ladder change anything? ----
// They differ only when a view's span exceeds 25,000u (2500 x 10).
function spanFor(filter) {
  let cf = 0, cd = 0, hi = -Infinity, lo = Infinity;
  for (const r of rows) {
    if (filter && !filter(r)) continue;
    cf += r[7] ? (r[5] - 1) : -1;
    cd += r[7] ? -1 : (r[6] - 1);
    hi = Math.max(hi, cf, cd); lo = Math.min(lo, cf, cd);
  }
  return hi === -Infinity ? 0 : hi - lo;
}
let maxSpan = 0, maxWho = '';
const tourSpan = spanFor(null);
maxSpan = tourSpan; maxWho = 'Tour, unfiltered';
// every Tour filter axis the tab exposes: level, surface, round, and each season
const axes = [[1, 'level'], [2, 'surface'], [3, 'round'], [4, 'tournament']];
for (const [col, label] of axes) {
  const vals = [...new Set(rows.map(r => r[col]))];
  for (const v of vals) {
    const s = spanFor(r => r[col] === v);
    if (s > maxSpan) { maxSpan = s; maxWho = `${label}=${v}`; }
  }
}
const years = [...new Set(rows.map(r => Math.floor(r[0] / 10000)))];
for (const y of years) {
  const s = spanFor(r => Math.floor(r[0] / 10000) === y);
  if (s > maxSpan) { maxSpan = s; maxWho = `season ${y}`; }
}
console.log(`\nTour/Tournaments: widest span over every single-filter view = ${maxSpan.toFixed(1)}u (${maxWho})`);
console.log(`  5000 is reachable only above 25,000u -> ${maxSpan > 25000 ? 'REACHABLE — dropping it CHANGES a chart' : 'unreachable; dropping 5000 changes nothing today'}`);
console.log(`  headroom: the archive would have to grow ${(25000 / maxSpan).toFixed(1)}x in span before 2500 stops fitting`);
