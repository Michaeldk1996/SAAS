// TEN-340 — every check in test-ten340-playing-style.mjs must FAIL when the behaviour it locks is reverted. Each mutant is
// applied to a copy of bsp-consult-dashboard.html (TEN340_HTML) — or of tools/build-matchup-matrix.js (TEN340_BUILDER) —
// and the suite is run against it; a mutant that leaves the suite green is a vacuous test and fails this runner. Anchors
// must occur exactly once in their file.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const FILES = { page: ['bsp-consult-dashboard.html', 'TEN340_HTML'], builder: [path.join('tools', 'build-matchup-matrix.js'), 'TEN340_BUILDER'] };
const MUTANTS = [
  ['mirror: the diagonal read as a below-floor cell (no 50/50 copy)', "if (i1 === i2) return { kind: 'mirror', a: 50, b: 50, n: psMirrorN(i1), l1, l2, i1, i2 };",
    "if (i1 === i2) return { kind: 'thin', n: psMirrorN(i1), l1, l2, i1, i2 };"],
  ['matchup: the cell read in p2\'s direction', "return { kind: 'cell', a: c.pct, b: 100 - c.pct,", "return { kind: 'cell', a: 100 - c.pct, b: c.pct,"],
  ['lean: a 1-point cell "leans" (the coin-flip threshold dropped)', "pts < 2 ? 'Effectively a coin-flip", "pts < 1 ? 'Effectively a coin-flip"],
  ['surface tiles: the pooled cell on every surface', "const c = psSurfaceCellFor(sf.toLowerCase(), E.i1, E.i2), on = sf === today;", "const c = psCellFor(E.i1, E.i2), on = sf === today;"],
  ['N2: a walkover counted in the personal record and listed', "const rows = raw.filter(r => !ps2IsWalkover(r));", "const rows = raw;"],
  ['D2: a rate printed on n 1–4', "const rate = ready && n ? maRateHtml(R.w, n, { nopct: ''", "const rate = ready && n ? maRateHtml(R.w, n, { nopct: Math.round(R.w / n * 100) + '%'"],
  ['D2: the tug and the deviation off the gate', "const g = maGate(n).mode, shown = g === 'full' || g === 'small', small = g === 'small';", "const g = n ? 'full' : 'none', shown = g === 'full' || g === 'small', small = g === 'small';"],
  ['mirror: no matrix avg on a mirror (the diagonal\'s 50% dropped)', "const c = i === j ? { pct: 50 } : psCellFor(i, j);", "const c = psCellFor(i, j);"],
  ['N2: a retirement\'s unfinished set counted', "sets.forEach(s => { if (!ps2SetDone(s.a, s.b, s.mtb, s.tb)) return; if", "sets.forEach(s => { if"],
  ['DoD 8: a meeting row stops opening the shared sheet', "        click: maRowOnclick({ key, name: R.name", "        click: '', _was: ({ key, name: R.name"],
  ['meetings: every row listed, no 8-row head and no G18 control', "list = more ? all : all.slice(0, PS2_ROWS_SHOWN);", "list = all;"],
  ['DNA: a Δ (±0) on the since-Mar-2024 view', "delta: has && W.scope === 'last52' && d.deltas", "delta: has && d.deltas"],
  ['DNA: the tooltip without its population and n', "const popTxt = pop ? `Rank among ${pop.n} ${pop.words}.`", "const popTxt = false ? `Rank among ${pop.n} ${pop.words}.`"],
  ['DNA: the since view stops reading the live (current) Elo', "const d = mdnaRadarFor(key, surface, W.scope, name);", "const d = mdnaRadarFor(key, surface, W.scope, W.scope === 'last52' ? name : null);"],
  ['Q14: the since view falls back to the career scope (Under pressure prints a number)', "const ps2UpDashed = (W, ax) => W.scope === 'sinceBase' && ax.key === 'underPressure';", "const ps2UpDashed = (W, ax) => false;"],
  ['DNA: a player under the floor still draws a shape', "const poly = s => (s.d.ok ?", "const poly = s => (true ?"],
  ['DNA: the window labelled "Career" again', "since: { scope: 'sinceBase', label: 'Since Mar 2024', lc: 'since Mar 2024' }", "since: { scope: 'sinceBase', label: 'Career', lc: 'career' }"],
  ['profile: the leader\'s bar toned brighter (highlighting the better stat)', "<span class=\"ps2-bar-a\" style=\"width:${w(a)}%; background:${C.A};", "<span class=\"ps2-bar-a\" style=\"width:${w(a)}%; background:${w(a) >= w(b) ? C.A : C.bDim};"],
  ['D4: player A\'s radar line in the link blue', "fill=\"${C.aFill}\" stroke=\"${C.A}\" stroke-width=\"1.75\"", "fill=\"${C.aFill}\" stroke=\"${C.link}\" stroke-width=\"1.75\""],
  ['loading: archetypes read before they load ("not yet classified" for everyone)', "if (!m._ps2Loaded && !Object.keys(", "if (false && !m._ps2Loaded && !Object.keys("],
  ['DoD 4: the design\'s SAMPLE chip back', "<span style=\"${PS2_CAP}\">Style matchup</span></div>", "<span style=\"${PS2_CAP}\">Style matchup</span><span>SAMPLE</span></div>"],
  ['DoD 8: a native title for the percentile tooltip', "<span tabindex=\"0\" data-aotip=\"${escapeHtml(ps2AxisTip(D, i))}\"", "<span tabindex=\"0\" title=\"${escapeHtml(ps2AxisTip(D, i))}\""],
  ['DoD 8: a tab-local row renderer back', "function buildStyleSection(m){", "function psvListHtml(side){ return ''; }\nfunction buildStyleSection(m){"],
  ['matrix avg: p2\'s box read in p1\'s direction', "if (i >= 0 && j >= 0){ const c = i === j ? { pct: 50 } : psCellFor(i, j);", "if (i >= 0 && j >= 0){ const c = i === j ? { pct: 50 } : psCellFor(j, i);"],
  ['surface: an unknown surface tagged as Hard', "/hard|indoor/.test(sk) ? 'Hard' : null;", "'Hard';"],
  ['sets: a final-set tiebreak at 12-12 read as unfinished', " || (tb && hi >= 7 && d === 1); }", "; }"],
  ['meetings: the card sub-line rate off the gate', "const rate = maRateHtml(R.w, R.n, { nopct: '', note: false });", "const rate = R.n ? Math.round(R.w / R.n * 100) + '%' : '';"],
  ['unclassified: the player\'s own box claims no meetings', "  if (!oppLab || !ownLab) return { state: 'unclassified'", "  if (!oppLab) return { state: 'unclassified'"],
  ['builder N2: a TML walkover no longer dedups its api copy', "        if (wpk && wd) (tmlPairDates.get(wpk) || tmlPairDates.set(wpk, []).get(wpk)).push(wd);\n", '', 'builder'],
  ['builder N2: a TML walkover counted in the matrix, the records and the shards', "      if (/\\bW\\/O\\b/i.test(c[ix.score] || '')) {\n        tmlWalkover++;", "      if (false) {\n        tmlWalkover++;", 'builder'],
];
const SUITES = ['test-ten340-playing-style.mjs'];
const run = env => spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, env || {}), encoding: 'utf8' });
// Control: the unmutated files must pass, or every "caught" below means nothing.
{ const r = run(); if (r.status !== 0) { console.error('✖ the suite is red on the unmutated files — mutants are meaningless'); process.exit(1); }
  console.log('✔ control: the unmutated files pass'); }
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten340-mut-'));
for (const [name, from, to, which] of MUTANTS) {
  const [rel, envKey] = FILES[which || 'page'];
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  if (src.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, path.basename(rel));
  fs.writeFileSync(file, src.replace(from, to));
  const r = run({ [envKey]: file });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
