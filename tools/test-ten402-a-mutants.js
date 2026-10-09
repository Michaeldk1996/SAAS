// TEN-402 (group a) — every check in test-ten402-a.mjs must FAIL when the behaviour it locks is reverted. Each mutant is
// applied to a copy of bsp-consult-dashboard.html and the suite is run against it (TEN402_HTML); a mutant that leaves
// the suite green is a vacuous test and fails this runner. Anchors must occur exactly once in the page.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  ['H5: a qualifying round suggested', "      if (/qualif/i.test(String(m.tournamentRound || '') + ' ' + String(m.round || ''))) return;\n", ''],
  ['H5: the worse-ranked player put on side A', 'const aFirst = rb == null || (ra != null && ra <= rb);', 'const aFirst = true;'],
  ['H5: last week\'s draws suggested', "      if (!(d >= lo && d <= hi)) return;\n", ''],
  ['H6: back to the surname-anywhere filter (a Sinner story chipped as Alcaraz)', '      if (!name || !mine(x.player_key != null ? x.player_key : null, name)) return;', "      if (!new RegExp(full.split(' ').pop(), 'i').test((x.title || '') + ' ' + (x.content || ''))) return;"],
  ['H6: A and B no longer interleaved', '[fa[i], fb[i]].forEach(', '[fa[i]].forEach('],
  ['H6: an empty feed still draws the card', "    if (!n || n.empty) return '';\n", ''],
  ['H4: the Model page\'s display gate dropped', 'return { ok: st === 2 && h != null && h > 0 && h <= 30, started: h != null && h <= 0 };', 'return { ok: true, started: false };'],
  ['H4: the price not oriented to A', 'const fa = fair && (hit.aIsP1 ? fair.p1 : fair.p2), fb = fair && (hit.aIsP1 ? fair.p2 : fair.p1);', 'const fa = fair && fair.p1, fb = fair && fair.p2;'],
  ['DNA: the since-2024 window labelled "Career"', "since: { label: 'Since Mar 2024', scope: 'sinceBase'", "since: { label: 'Career', scope: 'sinceBase'"],
  ['H8: the second profile bar back at 45%', '  #h2hRoot .h2h-prow__bar.lo{ background:color-mix(in srgb, var(--viz-white-lead) 70%, transparent); }', '  #h2hRoot .h2h-prow__bar.lo{ background:var(--white-bar-2); }'],
  ['item 6: radar A back on blue', 'fill="color-mix(in srgb, var(--text) 12%, transparent)" stroke="var(--text)" stroke-width="1.75"', 'fill="color-mix(in srgb, var(--bar) 18%, transparent)" stroke="var(--bar)" stroke-width="1.75"'],
  ['item 9: menu radius 12 and no menu shadow', 'border:1px solid var(--edge-10); border-radius:10px; box-shadow:var(--shadow-menu); }\n  #h2hRoot .h2h-mrow{', 'border:1px solid var(--edge-10); border-radius:12px; }\n  #h2hRoot .h2h-mrow{'],
  ['item 1: header no longer sticky', '  #h2hRoot .h2h-stick{ position:sticky; top:30px; z-index:30;', '  #h2hRoot .h2h-stick{ position:relative; top:30px; z-index:30;'],
  ['item 1: the caps label line dropped', "  const H2H_EYEBROW = 'ATP tour · all-level head to head';", "  const H2H_EYEBROW = '';"],
  ['item 2: section cards outlined again', '  #h2hRoot .h2h-card{ display:flex; flex-direction:column; gap:14px; min-width:0; padding:20px 22px; border-radius:16px; background:var(--card); border:1px solid transparent;', '  #h2hRoot .h2h-card{ display:flex; flex-direction:column; gap:14px; min-width:0; padding:20px 22px; border-radius:16px; background:var(--card); border:1px solid var(--edge-6);'],
  ['item 4: the selected tab back on a blue fill', "    const opts = { cls: 'h2h-seg h2h-seg--' + (size || 'md'), label: ariaLabel || '' };", "    const opts = { cls: 'h2h-seg h2h-seg--' + (size || 'md') + '\" style=\"background:var(--bar)', label: ariaLabel || '' };"],
  ['item 10: toggle words back to grey', '    font-family:var(--font-words); font-size:12.5px; font-weight:600; color:var(--text); }\n  #h2hRoot .h2h-toggle .car', '    font-family:var(--font-words); font-size:12.5px; font-weight:600; color:var(--text-label); }\n  #h2hRoot .h2h-toggle .car'],
];
const SUITES = ['test-ten402-a.mjs'];
// Control: the unmutated page must pass, or every "caught" below means nothing.
{ const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('✖ the suite is red on the unmutated page — mutants are meaningless'); process.exit(1); }
  console.log('✔ control: the unmutated page passes'); }
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten402a-mut-'));
for (const [name, from, to] of MUTANTS) {
  if (html.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, html.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, { TEN402_HTML: file }), encoding: 'utf8' });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
