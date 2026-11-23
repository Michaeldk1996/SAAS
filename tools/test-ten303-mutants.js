// TEN-303 — every check in test-ten303-odds-tab.mjs / test-ten303-colours.mjs must FAIL when the behaviour it locks is
// reverted. Each mutant is applied to a copy of bsp-consult-dashboard.html (TEN303_HTML: the data model, the AODDS_* config,
// the chart / tooltip helpers) or, marked 'v2', of match-analysis-v2.js (TEN303_V2: the Match analysis rebuild's Odds
// renderer, design 2026-11-23), and both suites run against it; a mutant that leaves them green is a vacuous test.
// Tests named "renderer gap: …" lock a rule the rebuild does not meet yet: they are left out of the baseline and the
// mutant runs, then run on their own — while any of them fails, this runner fails and names it.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
// TEN303_MUT_BASE: run the mutants on another copy of the page (e.g. a candidate fix) instead of the working tree's.
const BASE = process.env.TEN303_MUT_BASE || path.join(ROOT, 'bsp-consult-dashboard.html');
const BASE_V2 = process.env.TEN303_MUT_BASE_V2 || path.join(ROOT, 'match-analysis-v2.js');
const html = fs.readFileSync(BASE, 'utf8'), v2 = fs.readFileSync(BASE_V2, 'utf8');
const SUITES = ['test-ten303-odds-tab.mjs', 'test-ten303-colours.mjs'].map(f => path.join(ROOT, f));
const GAP = '^renderer gap';
const MUTANTS = [  ['review 2: a finished match\'s table row keeps its last tick (not the card close)', "m.finalScore ? { p1: o.p1.close, p2: o.p2.close } : null;", "null;"],
  ['review 2: Key factors Fair from another tick', "nv: { a: [[0, card.now[0] * ov]], b: [[0, card.now[1] * ov]] } });", "});"],
  ['review item 4: the card stream left off the card book\'s table row', "    if (cr){\n      const ov = 1 / sp.p1 + 1 / sp.p2;", "    if (false){\n      const ov = 1 / sp.p1 + 1 / sp.p2;"],
  ['review item 4: Key factors back on its own book order', "  if (card && card.now[0] != null && card.now[1] != null){", "  if (false){"],
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
  ["TEN-380: the Move read on the raw prices", "const o = +aOddsFmt(+open), n = +aOddsFmt(+now);", "const o = +open, n = +now;"],
  ['Q10: the price floor dropped from the tile', "const ok = v => (v != null && Number.isFinite(+v) && +v >= 1.01 ? +v : null);", "const ok = v => (v != null && Number.isFinite(+v) ? +v : null);"],
  ['Q2: pop-up player B line back on --bar-2', "  bFill: 'var(--white-bar)',", "  bFill: 'var(--bar-2)',"],
  ['Q2: pop-up guides dashed 4 4', "style=\"stroke:' + C.grid + '\" stroke-dasharray=\"2 6\"/>'", "style=\"stroke:' + C.grid + '\" stroke-dasharray=\"4 4\"/>'"],
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
  ['follow-up 1c: ALSO keeps the source key', 'const feed = (r.altMeta && r.altMeta.source) || aOddsSrcTitle(r.alt);', 'const feed = aOddsSrcTitle(r.alt);'],
  // TEN-314 (TEN-312 D1) → TEN-376: the tab reads tokens.css — a wrong-role token or a literal in place of the role token is caught
  ['D1: the Odds-tab text on the wrong role token (the reading grey)', "  text: 'var(--text)',      // Text", "  text: 'var(--text-soft)',      // Text"],
  ['D1: the Odds-tab text back to the spec literal', "  text: 'var(--text)',      // Text", "  text: '#E7E9EE',      // Text"],
  ['D1: the nav-selected bg back to the 12a navy literal', '.modal-analysis .asidenav-item.active{ background:var(--inner);', '.modal-analysis .asidenav-item.active{ background:#0B1C4E;'],
  ['D1: the modal surface back to the 12a pop-up', '.modal-analysis{ background:var(--card);', '.modal-analysis{ background:var(--popup);'],
  ['D1: the modal scrim back to a literal', '  #analysisModal{ background:var(--backdrop); backdrop-filter:blur(3px); }', '  #analysisModal{ background:rgba(4,5,8,0.72); backdrop-filter:blur(3px); }'],
  ['D4: Odds player A back to the link blue', "  a: 'var(--text)',         // Player A", "  a: 'var(--link)',         // Player A"],
  ['U3 / TEN-380: the book-row hover on the selected token', "  rowHover: 'color-mix(in srgb, var(--text) 3%, transparent)',", "  rowHover: 'var(--selected)',"],
  ['TEN-380: the book-row hover CSS back on an edge', "  .aox-row:not(.aox-nodata):not(.aox-on):hover{ background:color-mix(in srgb, var(--text) 3%, transparent) !important; }", "  .aox-row:not(.aox-nodata):not(.aox-on):hover{ background:color-mix(in srgb, var(--text) 3%, transparent) !important; border-color:var(--edge-16) !important; }"],
  ['TEN-376: an Odds border back to the old 1.25px', "  hw1: '1px',                // spec 1px borders", "  hw1: '1.25px',                // spec 1px borders"],
  ['review: the Odds tab inherits the modal text (its own rule dropped)', '  #aSectionOdds{ color:var(--text); }\n', ''],
  ['deployed measure: the tab inherits the modal line-height', '  #aSectionOdds{ font-size:16px; line-height:normal; }', '  #aSectionOdds{ font-size:16px; }'],
  ['deployed measure: the tab inherits the modal font-size', '  #aSectionOdds{ font-size:16px; line-height:normal; }', '  #aSectionOdds{ line-height:normal; }'],
  // founder card 9e0ac649 chose between two blue HEXES; TEN-376: blue is a fill, never text — the BOOKS tag is white text,
  // the STEAM chip the badge lift (--selected), so the lock is the role split
  ['role: the BOOKS tag text on the fill blue (blue is never text)', "  blue: 'var(--text)',", "  blue: 'var(--bar)',"],
  ['role: the STEAM chip fill on the link token', "  blueFill: 'var(--selected)',", "  blueFill: 'var(--link)',"],
  ['founder card 9e0ac649: a pulled book stops at "not in feed since"', 'end: endOf(key, last.t),', 'end: aOddsPulledAt(mt) != null ? Math.max(last.t, aOddsPulledAt(mt)) : endOf(key, last.t),'],
  ['§6.5 the shipped shape is a curve', "const AODDS_LINE_SHAPE = 'step';", "const AODDS_LINE_SHAPE = 'monotone';"],
  // ---- match-analysis-v2.js (the rebuild's Odds renderer, design 2026-11-23 / Odds LOCKED 2026-11-22) ----
  ['v2 §6.1 the STEAM chip loses its sentence', "    const steam = D.steam ? chip(D.steam.text, ", "    const steam = D.steam ? chip('STEAM', ", 'v2'],
  ['v2 §6.1 the stale margin line no longer says so', "r.stale ? 'No recent data'", "r.stale ? 'Margin ' + DASH", 'v2'],
  ['v2 the Move sign swapped', "mp.sign > 0 ? '+' : '−'", "mp.sign > 0 ? '−' : '+'", 'v2'],
  ['v2 the Move colour swapped', "mp.sign > 0 ? 'var(--ma2-green)' : 'var(--ma2-red)' };", "mp.sign > 0 ? 'var(--ma2-red)' : 'var(--ma2-green)' };", 'v2'],
  ['v2 the per-row sparkline back', "+ '<span class=\"ma2-margin\"", "+ '<svg class=\"aox-spark\"></svg><span class=\"ma2-margin\"", 'v2'],
  ['v2 the no-data filter dropped (dash rows back)', "const rows = D.rows.filter(r => !r.noData);", "const rows = D.rows;", 'v2'],
  ['v2 the best price read over stale books too', "const live = rows.filter(r => !r.stale);", "const live = rows;", 'v2'],
  ['v2 the best price box no longer lifted', "best: !!r[x + 'Best']", "best: false", 'v2'],
  ['v2 the picked row always marked', "const on = A.mv === r.name;", "const on = true;", 'v2'],
  ['v2 the loading line gone', "(loading ? 'Loading bookmaker odds…' : ", "(false ? 'Loading bookmaker odds…' : ", 'v2'],
  ['v2 the row source on a native title', "onclick=\"aOddsOpenMv(this.dataset.book)\" data-aotip=\"' + esc(aOddsBookTip(r, D)) + '\"'", "onclick=\"aOddsOpenMv(this.dataset.book)\" title=\"' + esc(aOddsBookTip(r, D)) + '\"'", 'v2'],
  ['v2 Q10: the Match Winner row shows the best price across books', "const px = i => mw && cardT && cardT.now[i] != null ? cardT.now[i].toFixed(2) : DASH;", "const px = i => { const v = Math.max.apply(null, live.map(r => r[('ab')[i] + 'Now']).filter(v => v != null)); return isFinite(v) ? v.toFixed(2) : DASH; };", 'v2'],
  ['v2 Q10: the row move against another book (the table\'s first open)', "const mv = i => mw && cardT && !cardT.closed ? oddsMove(cardT.open[i], cardT.now[i])", "const mv = i => mw && cardT && !cardT.closed ? oddsMove(live[0] && live[0][('ab')[i] + 'Open'], cardT.now[i])", 'v2'],
  ['v2 Q10: the unrecorded markets shown again', ".filter(t => t.recorded).map(t => {", ".map(t => {", 'v2'],
  ['v2 Q2: pop-up player A line on the text token', "aOddsMvChart(s, i ? 'var(--ma2-text)' : 'var(--ma2-blue)'", "aOddsMvChart(s, 'var(--ma2-text)'", 'v2'],
  ['v2 pop-up tiles read raw prices', "    aOddsDispSeries(s).forEach(p => { if (!hi || p[1] > hi[1]) hi = p;", "    s.forEach(p => { if (!hi || p[1] > hi[1]) hi = p;", 'v2'],
  ['v2 review 2: pop-up Move on raw prices', "oddsMove(r[x + 'Open'] != null ? r[x + 'Open'] : open && open[1], r[x + 'Now'])", "((o, n) => { const v = (n - o) / o * 100; return { t: (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%', c: 'var(--ma2-grey)' }; })(r[x + 'Open'], r[x + 'Now'])", 'v2'],
  ['v2 the pop-up no longer closes on an outside click', "onclick=\"if(event.target===this){' + o.onClose + '}\"", "onclick=\"\"", 'v2'],
  ['v2 1b: the missing-price mark is an en dash', "const DASH = '—';", "const DASH = '–';", 'v2'],
  ['v2 D1: a literal back in the Odds move colour', "mp.sign > 0 ? 'var(--ma2-green)' : 'var(--ma2-red)' };", "mp.sign > 0 ? '#3ed68c' : 'var(--ma2-red)' };", 'v2'],
];
const run = (env, pattern) => spawnSync(process.execPath, ['--test', pattern, ...SUITES],
  { env: Object.assign({}, process.env, { TEN303_HTML: BASE, TEN303_V2: BASE_V2 }, env), encoding: 'utf8' });
// A mutant is only meaningful against a GREEN baseline: on a red suite every mutant would read as "caught".
const base = run({}, '--test-skip-pattern=' + GAP);
if (base.status !== 0) {
  console.error('✖ baseline red: the suites fail on the unmutated page, so no mutant can be judged. Fix the suite first.');
  console.error((base.stdout || '').split('\n').filter(l => /^\s*(not ok|✖)/.test(l)).join('\n'));
  process.exit(1);
}
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten303-mut-'));
for (const [name, from, to, where] of MUTANTS) {
  const src = where === 'v2' ? v2 : html;
  if (src.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, where === 'v2' ? 'm.js' : 'm.html');
  fs.writeFileSync(file, src.replace(from, to));
  const r = run(where === 'v2' ? { TEN303_V2: file } : { TEN303_HTML: file }, '--test-skip-pattern=' + GAP);
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
const gaps = run({}, '--test-name-pattern=' + GAP);
const open = (gaps.stdout || '').split('\n').filter(l => /^✖ renderer gap/.test(l));
if (gaps.status !== 0) { console.error(`✖ ${new Set(open).size} renderer gap(s) still open:`); [...new Set(open)].forEach(l => console.error('  ' + l)); }
process.exit(survived || gaps.status !== 0 ? 1 : 0);
