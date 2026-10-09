// TEN-402 r4, builder N (founder post-live fixes, comment 276cbc50) — every check in test-ten402-r4n.mjs must FAIL when
// its rule is reverted or bent. Each mutant is applied to a copy of bsp-consult-dashboard.html (TEN402_HTML) and the
// suite runs against it; a mutant that leaves it green is a vacuous test and fails this runner. Anchors occur exactly once.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const BAND = "  #h2hRoot .h2h-page::before{ content:''; display:block; position:sticky; top:0; z-index:29; height:30px; margin:-30px -40px 0; background:var(--page); }";
const SCORE = '  #h2hRoot .h2hc-led .ma-row-score{ min-width:0; white-space:normal; overflow:visible; }';
const MEET = "            sets: r.pS == null || r.ret ? '—' : r.pS + '–' + r.oS,";
const STYLE = "          sets: m.ret ? '—' : m.pS + m.oS ? m.pS + '–' + m.oS : m.sets, scores:";
const TR = "    sets: r.wo || r.pS == null ? FH_DASHC : r.pS + '–' + r.oS, setsColor: r.wo || r.pS == null ? FH_DASH : null,\n    scores: fhH2hSetScores(r), scoresTitle: r.sets ? fhH2hSetScores(r) : 'No set scores on record for this match',";
const EMPTY = "        + '<div class=\"el-empty__t\">No lists loaded for ' + weekRangeHtml(activeWeek) + '</div>'";
const MUTANTS = [
  // ---- fix 1 · the strip above the sticky header
  ['fix 1: the band removed (cards show above the header again)', BAND + '\n', ''],
  ['fix 1: the band scrolls away (not sticky)', BAND, BAND.replace('position:sticky;', 'position:relative;')],
  ['fix 1: the band sticks below the top', BAND, BAND.replace('top:0;', 'top:30px;')],
  ['fix 1: the band shorter than the gap', BAND, BAND.replace('height:30px; margin:-30px', 'height:20px; margin:-20px')],
  ['fix 1: the band transparent', BAND, BAND.replace('background:var(--page);', 'background:transparent;')],
  ['fix 1: the band over the header card', BAND, BAND.replace('z-index:29;', 'z-index:31;')],
  ['fix 1: the band only as wide as the content (side padding shows through)', BAND, BAND.replace('margin:-30px -40px 0;', 'margin:-30px 0 0;')],
  ['fix 1: the band pushes the page down (layout shift)', BAND, BAND.replace('margin:-30px -40px 0;', 'margin:0 -40px;')],
  // ---- fix 2 · set scores never cut
  ['fix 2: the score cell back on one ellipsised line (R1)', SCORE, '  #h2hRoot .h2hc-led .ma-row-score{ min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }'],
  ['fix 2: the score cell clipped', SCORE, '  #h2hRoot .h2hc-led .ma-row-score{ min-width:0; white-space:normal; overflow:hidden; }'],
  ['fix 2: the shared row loses its break points between sets',
    ".map((x, i, A) => `<span style=\"white-space:nowrap;\">${esc(x)}${i < A.length - 1 ? ',' : ''}</span>`).join(' ')}</span>`",
    ".map((x, i, A) => `<span style=\"white-space:nowrap;\">${esc(x)}${i < A.length - 1 ? ',' : ''}</span>`).join('')}</span>`"],
  // ---- fix 3 · Sets "pS–oS"
  ['fix 3: the Meetings ledger back to "0 - 2"', MEET, "            sets: r.pS == null || r.ret ? '—' : r.pS + ' - ' + r.oS,"],
  ['fix 3: the Meetings ledger hyphen without spaces ("0-2")', MEET, "            sets: r.pS == null || r.ret ? '—' : r.pS + '-' + r.oS,"],
  ['fix 3: a Meetings retirement shows its sets', MEET, "            sets: r.pS == null ? '—' : r.pS + '–' + r.oS,"],
  ['fix 3: the Playing styles ledger back on ps2Meeting\'s "1 - 3"', STYLE, "          sets: m.ret ? '—' : m.sets, scores:"],
  ['fix 3: a Playing styles retirement shows its sets', STYLE, "          sets: m.pS + m.oS ? m.pS + '–' + m.oS : m.sets, scores:"],
  ['fix 3: the Tournament rows back to "3 - 1"', TR, TR.replace("r.pS + '–' + r.oS", "r.pS + ' - ' + r.oS")],
  ['fix 3: the Tournament rows spaced en dash ("3 – 1")', TR, TR.replace("r.pS + '–' + r.oS", "r.pS + ' – ' + r.oS")],
  ['fix 3: a walkover gets "0–0"', TR, TR.replace('sets: r.wo || r.pS == null ? FH_DASHC', 'sets: r.pS == null ? FH_DASHC')],
  // ---- fix 5 · Entry list empty state
  ['fix 5: the title back to "this week"', EMPTY, "        + '<div class=\"el-empty__t\">No lists loaded for this week</div>'"],
  ['fix 5: the title names the current week, not the selected one', EMPTY, "        + '<div class=\"el-empty__t\">No lists loaded for ' + weekRangeHtml(pickDefaultWeek()) + '</div>'"],
  ['fix 5: the title\'s dash back in Hanken (plain label)', EMPTY, "        + '<div class=\"el-empty__t\">No lists loaded for ' + weekRangeLabel(activeWeek) + '</div>'"],
];
const SUITES = ['test-ten402-r4n.mjs'];
const run = env => spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, env), encoding: 'utf8' });
// Control: the unmutated file must pass, or every "caught" below means nothing.
if (run({}).status !== 0) { console.error('✖ the suite is red on the unmutated file — mutants are meaningless'); process.exit(1); }
console.log('✔ control: the unmutated file passes');
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten402r4n-mut-'));
for (const [name, from, to] of MUTANTS) {
  if (src.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, src.replace(from, to));
  if (run({ TEN402_HTML: file }).status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
