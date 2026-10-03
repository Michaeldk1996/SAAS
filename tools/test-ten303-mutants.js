// TEN-303 — every §6 test must FAIL when the behaviour it locks is reverted. Each mutant below is applied
// to a copy of bsp-consult-dashboard.html and test-ten303-odds-tab.mjs is run against it (TEN303_HTML);
// a mutant that leaves the suite green is a vacuous test and fails this runner.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
// TEN303_MUT_BASE: run the mutants on another copy of the page (e.g. a candidate fix) instead of the working tree's.
const BASE = process.env.TEN303_MUT_BASE || path.join(ROOT, 'bsp-consult-dashboard.html');
const html = fs.readFileSync(BASE, 'utf8');
const SUITES = ['test-ten303-odds-tab.mjs', 'test-ten303-colours.mjs'].map(f => path.join(ROOT, f));
const MUTANTS = [
  ['Q23: a native title on the price-mode hints', "const seg = (on, label, t, v) => '<span class=\"aox-seg\" role=\"button\" tabindex=\"0\"' + tip(t) +", "const seg = (on, label, t, v) => '<span class=\"aox-seg\" role=\"button\" tabindex=\"0\" title=\"' + t + '\"' +"],
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
  ['review: STEAM read on the displayed (no-vig) prices', "const nw = num(r[x + 'QNow']), op = num(r[x + 'QOpen']);", "const nw = num(r[x + 'Now']), op = num(r[x + 'Open']);"],
  ['review: the pop-up x axis by tick index', 'const X = t => PL + (t - t0) / tspan * (Wd - PL - PR), Y = v => TT', 'const X = t => PL + (s.filter(p => p[0] < t).length) / Math.max(1, s.length - 1) * (Wd - PL - PR), Y = v => TT'],
  ['review: a legacy "<Book> (Oddspapi)" key as its own row', 'if (bk) bk.sources.push(k);', 'if (false) bk.sources.push(k);'],
  ['ruling fdf4bb3f: the STEAM minimum move per book dropped', 'return f(nw, op) && bigMove(nw, op); }).length;', 'return f(nw, op); }).length;'],
  ['founder pick 09-27: the shipped minimum move back to 3%', 'const AODDS_STEAM = { minBooks: 3, minShareOfN: 0, minMovePct: 5 };', 'const AODDS_STEAM = { minBooks: 3, minShareOfN: 0, minMovePct: 3 };'],
  ['founder pick 09-27: STEAM read on raw feed prices, not the displayed ones', "const nw = num(r[x + 'QNow']), op = num(r[x + 'QOpen']);", "const nw = +r[x + 'QNow'], op = +r[x + 'QOpen'];"],
  ['follow-up 1a: the flat run is interpolated (a slope to the next price)', "run.forEach((q, k) => { d += ' H' + f(X(q[1])); if (k + 1 < run.length) d += ' V' + f(Y(run[k + 1][2])); });",
    "run.forEach((q, k) => { if (k + 1 < run.length) d += ' L' + f(X(run[k + 1][0])) + ',' + f(Y(run[k + 1][2])); else d += ' H' + f(X(q[1])); });"],
  ['follow-up 1a: the line breaks between prices (a gap)', "run.forEach((q, k) => { d += ' H' + f(X(q[1])); if (k + 1 < run.length) d += ' V' + f(Y(run[k + 1][2])); });",
    "run.forEach((q, k) => { d += ' H' + f(X(q[1])); if (k + 1 < run.length) d += ' M' + f(X(run[k + 1][0])) + ',' + f(Y(run[k + 1][2])); });"],
  ['follow-up 1a: the raw (unrounded) price is plotted', 'const v = +aOddsFmt(p[1]); if (!Number.isFinite(v)) return;', 'const v = p[1]; if (!Number.isFinite(v)) return;'],
  ['follow-up 1b: the missing-price mark is an en dash', "const AODDS_DASH = '\\u2014';", "const AODDS_DASH = '\\u2013';"],
  // TEN-335: the pop-up is a shared frame (Esc through maPopEscKey) with the entrance motion only when it opens
  ['TEN-366: the pop-up builds its own frame, not maPopFrame', "return maPopFrame({ variant: 'mv', cls: 'aox-mv',", "return ((o) => '<div class=\"aox-mv-overlay\">' + o.body + '</div>')({ variant: 'mv', cls: 'aox-mv',"],
  ['TEN-335: the close button is not the frame\'s ma-pop-x', "    xCls: 'ma-pop-x', x: 'width:32px;", "    xCls: '', x: 'width:32px;"],
  ['TEN-366: the mv variant falls back to the std frame geometry', "const G = MA_POP[o.variant] || MA_POP.std,", "const G = MA_POP.std,"],
  ['TEN-335: the entrance never plays', '_aOdds.mvIn = !_aOdds.mv;', '_aOdds.mvIn = false;'],
  ['TEN-335: the entrance replays on a book-tab switch', '_aOdds.mvIn = !_aOdds.mv;', '_aOdds.mvIn = true;'],
  ['TEN-335: the open flag never cleared (a re-render replays)', 'try { renderOddsSection(); } finally { _aOdds.mvIn = false; } }', 'renderOddsSection(); }'],
  ['follow-up 1c: ALSO keeps the source key', 'const feed = (r.altMeta && r.altMeta.source) || aOddsSrcTitle(r.alt);', 'const feed = aOddsSrcTitle(r.alt);'],
  // TEN-314 (TEN-312 D1) → TEN-376: the tab reads tokens.css — a wrong-role token or a literal in place of the role token is caught
  ['D1: the Odds-tab text on the wrong role token (the reading grey)', "  text: 'var(--text)',      // Text", "  text: 'var(--text-soft)',      // Text"],
  ['D1: the Odds-tab text back to the spec literal', "  text: 'var(--text)',      // Text", "  text: '#E7E9EE',      // Text"],
  ['D1: the nav-selected bg back to the 12a navy literal', '.modal-analysis .asidenav-item.active{ background:var(--selected);', '.modal-analysis .asidenav-item.active{ background:#0B1C4E;'],
  ['D1: the modal surface back to the 12a pop-up', '.modal-analysis{ background:var(--card);', '.modal-analysis{ background:var(--popup);'],
  ['D1: a literal back in a shared builder (the Form bar)', "const c = r.won ? 'var(--pos)' : 'var(--neg)';", "const c = r.won ? '#3ed68c' : 'var(--neg)';"],
  ['D1: the modal scrim back to a literal', '  #analysisModal{ background:var(--backdrop); backdrop-filter:blur(3px); }', '  #analysisModal{ background:rgba(4,5,8,0.72); backdrop-filter:blur(3px); }'],
  ['D4: Odds player A back to the link blue', "  a: 'var(--text)',         // Player A", "  a: 'var(--link)',         // Player A"],
  ['U3: the book-strip hover on the selected token', "  rowHover: 'var(--tile-hover)',", "  rowHover: 'var(--selected)',"],
  ['TEN-376: an Odds border back to the old 1.25px', "  hw1: '1px',                // spec 1px borders", "  hw1: '1.25px',                // spec 1px borders"],
  ['review: stat boxes read raw prices', '    aOddsDispSeries(s).forEach(p => { if (!hi || p[1] > hi[1]) hi = p;', '    s.forEach(p => { if (!hi || p[1] > hi[1]) hi = p;'],
  ['review: the Odds tab inherits the modal text (its own rule dropped)', '  #aSectionOdds{ color:var(--text); }\n', ''],
  ['deployed measure: the tab inherits the modal line-height', '  #aSectionOdds{ font-size:16px; line-height:normal; }', '  #aSectionOdds{ font-size:16px; }'],
  ['deployed measure: the tab inherits the modal font-size', '  #aSectionOdds{ font-size:16px; line-height:normal; }', '  #aSectionOdds{ line-height:normal; }'],
  // founder card 9e0ac649 chose between two blue HEXES; TEN-376: blue is a fill, never text — the BOOKS tag is white text,
  // the STEAM chip the badge lift (--selected), so the lock is the role split
  ['role: the BOOKS tag text on the fill blue (blue is never text)', "  blue: 'var(--text)',", "  blue: 'var(--bar)',"],
  ['role: the STEAM chip fill on the link token', "  blueFill: 'var(--selected)',", "  blueFill: 'var(--link)',"],
  ['founder card 9e0ac649: a pulled book stops at "not in feed since"', 'end: endOf(key, last.t),', 'end: aOddsPulledAt(mt) != null ? Math.max(last.t, aOddsPulledAt(mt)) : endOf(key, last.t),'],
  ['§6.5 the shipped shape is a curve', "const AODDS_LINE_SHAPE = 'step';", "const AODDS_LINE_SHAPE = 'monotone';"],
];
// A mutant is only meaningful against a GREEN baseline: on a red suite every mutant would read as "caught".
const base = spawnSync(process.execPath, ['--test', ...SUITES], { env: Object.assign({}, process.env, { TEN303_HTML: BASE }), encoding: 'utf8' });
if (base.status !== 0) {
  console.error('✖ baseline red: the suites fail on the unmutated page, so no mutant can be judged. Fix the suite first.');
  console.error((base.stdout || '').split('\n').filter(l => /^\s*(not ok|✖)/.test(l)).join('\n'));
  process.exit(1);
}
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten303-mut-'));
for (const [name, from, to] of MUTANTS) {
  if (html.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, html.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', ...SUITES], { env: Object.assign({}, process.env, { TEN303_HTML: file }), encoding: 'utf8' });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
