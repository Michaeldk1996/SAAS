// TEN-340 — every check in test-ten340-playing-style.mjs must FAIL when the behaviour it locks is reverted. Each mutant is
// applied to a copy of bsp-consult-dashboard.html (TEN340_HTML) — or of tools/build-matchup-matrix.js (TEN340_BUILDER) —
// and the suite is run against it; a mutant that leaves the suite green is a vacuous test and fails this runner. Anchors
// must occur exactly once in their file.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const FILES = { page: ['bsp-consult-dashboard.html', 'TEN340_HTML'], builder: [path.join('tools', 'build-matchup-matrix.js'), 'TEN340_BUILDER'],
  ma2: ['match-analysis-v2.js', 'TEN340_MA2'] };
// Match analysis rebuild (2026-11-23): the renderer is maStyleV2 in match-analysis-v2.js (mutants tagged 'ma2'). Dropped with
// the rebuild: the Style matchup mutants (mirror, p2 direction, lean, surface tiles, matrix avg — the card is gone: a
// renderer gap, red in the suite), the Δ-on-since, DoD-8 native-title and shared-row mutants, and the TEN-380 styling /
// layout mutants (matchup collapsed, --line cards, white / --link toggles, ruling-8 bars, top-aligned columns).
const MUTANTS = [
  ['N2: a walkover counted in the personal record', "const rows = raw.filter(r => !ps2IsWalkover(r));", "const rows = raw;"],
  ['D2: a rate printed on n 1–4', "rate = g === 'nopct' ? DASH : Math.round(w / n * 100) + '%';", "rate = Math.round(w / n * 100) + '%';", 'ma2'],
  ['D2: a 5–9 rate printed full', "rateC = g === 'full' ? 'var(--ma2-white)' : 'var(--ma2-grey)';", "rateC = 'var(--ma2-white)';", 'ma2'],
  ['N2: a retirement\'s unfinished set counted', "sets.forEach(s => { if (!ps2SetDone(s.a, s.b, s.mtb, s.tb)) return; if", "sets.forEach(s => { if"],
  ['a meeting row stops opening the shared sheet', "const click = wo ? '' : maRowOnclick({ key, name, ek: null,", "const click = wo ? '' : '' && maRowOnclick({ key, name, ek: null,", 'ma2'],
  ['meetings: every row listed, no 6-row head', "vis = more ? rows : rows.slice(0, PS2_ROWS_SHOWN)", "vis = rows", 'ma2'],
  ['show more: both lists read one shared expanded flag', "more = !!S[i ? 'moreB' : 'moreA']", "more = !!(S.moreA || S.moreB)", 'ma2'],
  ['DNA: the hover without its population and n', "const popTxt = pop ? `Rank among ${pop.n} ${pop.words}.`", "const popTxt = false ? `Rank among ${pop.n} ${pop.words}.`"],
  ['DNA: the since view stops reading the live (current) Elo', "const d = mdnaRadarFor(key, surface, W.scope, name);", "const d = mdnaRadarFor(key, surface, W.scope, W.scope === 'last52' ? name : null);"],
  ['Q14: the since view falls back to the career scope (Under pressure prints a number)', "const ps2UpDashed = (W, ax) => W.scope === 'sinceBase' && ax.key === 'underPressure';", "const ps2UpDashed = (W, ax) => false;"],
  ['DNA: a player under the floor still draws a shape', "const shapeA = D.a.d.ok, shapeB = D.b.d.ok;", "const shapeA = true, shapeB = true;", 'ma2'],
  ['DNA: the window labelled "Career" again', "since: { scope: 'sinceBase', label: 'Since Mar 2024', lc: 'since Mar 2024' }", "since: { scope: 'sinceBase', label: 'Career', lc: 'career' }"],
  ['colours: player one\'s radar line in the link blue', 'stroke="var(--ma2-blue)" stroke-width="2"', 'stroke="var(--link)" stroke-width="2"', 'ma2'],
  ['loading: archetypes read before they load ("not classified" for everyone)', "if (!m._ps2Loaded && !Object.keys(", "if (false && !m._ps2Loaded && !Object.keys(", 'ma2'],
  ['DoD 4: a SAMPLE chip back', ">Record against each style</span>", ">Record against each style</span><span>SAMPLE</span>", 'ma2'],
  ['DoD 8: an old row renderer back', "function buildStyleSection(m){", "function psvListHtml(side){ return ''; }\nfunction buildStyleSection(m){"],
  ['sets: a final-set tiebreak at 12-12 read as unfinished', " || (tb && hi >= 7 && d === 1); }", "; }"],
  ['order: the record card above the DNA card', "psDnaCard(m, S) + psRecordCard(m, S)", "psRecordCard(m, S) + psDnaCard(m, S)", 'ma2'],
  ['Vs other styles: the signed colour dropped', "oc = dd > 0 ? 'var(--ma2-green)'", "oc = dd > 0 ? 'var(--ma2-text)'", 'ma2'],
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
