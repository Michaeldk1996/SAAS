// TEN-303 — every §6 test must FAIL when the behaviour it locks is reverted. Each mutant below is applied
// to a copy of bsp-consult-dashboard.html and test-ten303-odds-tab.mjs is run against it (TEN303_HTML);
// a mutant that leaves the suite green is a vacuous test and fails this runner.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  ['§6.1 a stale book keeps its last price as NOW', "row[x + 'Now'] = row.stale ? null : novig", "row[x + 'Now'] = novig"],
  ['§6.1 the 60-min staleness rule dropped', 'return !Number.isFinite(ck) || nowMs - ck > AODDS_STALE_MS;\n  };\n  const mapped', 'return false;\n  };\n  const mapped'],
  ['§6.2 a row splices every source of its book', "const s1 = preMatch(src.books[key].p1), s2 = preMatch(src.books[key].p2);",
    "const s1 = preMatch([].concat(...bk.sources.map(k => (src.books[k] || {}).p1 || []))), s2 = preMatch([].concat(...bk.sources.map(k => (src.books[k] || {}).p2 || [])));"],
  ['§6.2 the fallback wins over a primary with data', 'const key = bk.sources.find(has) || null;', 'const key = bk.sources.slice().reverse().find(has) || null;'],
  ['§6.3 no-vig without the normalisation', 'function aOddsNoVig(a, b){ const s = 1 / a + 1 / b; return [a * s, b * s]; }', 'function aOddsNoVig(a, b){ return [a, b]; }'],
  ['§6.3 a pair only on one shared timestamp', 'return { t, a, b, pair: a != null && b != null && !aOddsInGap(t, G) };',
    'return { t, a, b, pair: s1.some(p => p[0] === t) && s2.some(p => p[0] === t) };'],
  ['§6.4 an unrecorded market can be selected', 'if (!t || !t.recorded) return; _aOdds.market = name;', 'if (!t) return; _aOdds.market = name;'],
  ['§6.5 Catmull-Rom tangents (the spec curve, overshoots)', 'for (let i = 1; i < n - 1; i++) m[i] = (sl[i - 1] * sl[i] <= 0) ? 0 : (sl[i - 1] + sl[i]) / 2;\n  for (let i = 0; i < n - 1; i++){\n    if (!sl[i]){ m[i] = 0; m[i + 1] = 0; continue; }',
    'for (let i = 1; i < n - 1; i++) m[i] = (P[i + 1][1] - P[i - 1][1]) / (P[i + 1][0] - P[i - 1][0]);\n  for (let i = 0; i < n - 1; i++){\n    if (false){ continue; }'],
  ['review: the last pair reused as a no-vig NOW', "novig ? (last.pair ? nv[x][nv[x].length - 1][1] : null)", "novig ? (nv[x].length ? nv[x][nv[x].length - 1][1] : null)"],
  ['review: pairing without the gap check', 'pair: a != null && b != null && !aOddsInGap(t, G) };', 'pair: a != null && b != null };'],
  ['review: only the first tied book is green', "rows.forEach(r => { r[x + 'Best'] = best != null && !r.noData && !r.stale && num(r[x + 'Now']) === best; });",
    "let won = false; rows.forEach(r => { r[x + 'Best'] = !won && best != null && !r.noData && !r.stale && num(r[x + 'Now']) === best; if (r[x + 'Best']) won = true; });"],
  ['review: a negative net with U+2212', "(d >= 0 ? '+' : '-') + Math.abs(d).toFixed(2)", "(d >= 0 ? '+' : '\\u2212') + Math.abs(d).toFixed(2)"],
  ['review: the STEAM threshold ignored', '.filter(c => c.n >= AODDS_STEAM.minBooks && c.n >= AODDS_STEAM.minShareOfN * N)', '.filter(c => c.n >= 1)'],
  ['review: STEAM read on the displayed (no-vig) prices', "const cnt = (x, f) => moving.filter(r => f(num(r[x + 'QNow']), num(r[x + 'QOpen']))).length;", "const cnt = (x, f) => moving.filter(r => f(num(r[x + 'Now']), num(r[x + 'Open']))).length;"],
  ['review: the pop-up x axis by tick index', 'const X = t => PL + (t - t0) / tspan * (Wd - PL - PR), Y = v => TT', 'const X = t => PL + (s.filter(p => p[0] < t).length) / Math.max(1, s.length - 1) * (Wd - PL - PR), Y = v => TT'],
  ['review: a legacy "<Book> (Oddspapi)" key as its own row', 'if (bk) bk.sources.push(k);', 'if (false) bk.sources.push(k);'],
  ['§6.5 the shipped shape is a curve', "const AODDS_LINE_SHAPE = 'step';", "const AODDS_LINE_SHAPE = 'monotone';"],
];
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten303-mut-'));
for (const [name, from, to] of MUTANTS) {
  if (html.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, html.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', path.join(ROOT, 'test-ten303-odds-tab.mjs')], { env: Object.assign({}, process.env, { TEN303_HTML: file }), encoding: 'utf8' });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
