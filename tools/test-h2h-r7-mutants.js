// Head to Head round 7 (final design 2026-11-26 + the founder's six fixes) — every check in test-h2h-r7.mjs must FAIL
// when its rule is reverted or bent. Each mutant is applied to a copy of bsp-consult-dashboard.html (TEN402_HTML) or
// h2h-page.css (TEN402_CSS) and the suite runs against it; a mutant that leaves it green is a vacuous test.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const CSS_SRC = fs.readFileSync(path.join(ROOT, 'h2h-page.css'), 'utf8');
const MUTANTS = [
  ['fix 1: the model price alone, no range', "out.aRange = rng(out.aPrice, out.aBase); out.bRange = rng(out.bPrice, out.bBase);", "out.aRange = out.aPrice; out.bRange = out.bPrice;"],
  ['fix 1: the range high – low', "const lo = Math.min(+x, +y), hi = Math.max(+x, +y);", "const hi = Math.min(+x, +y), lo = Math.max(+x, +y);"],
  ['2026-11-27: no price floor on the range', "return +v < 1.01 ? '—' : v; };", "return v; };"],
  ['fix 2: the blue flash back', "function setCtx(patch) { setState(patch); }", "function setCtx(patch) { setState(Object.assign({ flash: true }, patch)); }"],
  ['fix 2: a blue price', `<span data-h2h-price style="font-family:'IBM Plex Mono',monospace; font-size:clamp(20px,calc(2.2vw / var(--sf-z, 1)),28px); font-weight:800; color:var(--h2h-text);`, `<span data-h2h-price style="font-family:'IBM Plex Mono',monospace; font-size:clamp(20px,calc(2.2vw / var(--sf-z, 1)),28px); font-weight:800; color:var(--h2h-blue);`],
  ['the card opens on Hard', "ctxSurface: 'all', ctxRound: 'QF',", "ctxSurface: 'Hard', ctxRound: 'QF',"],
  ['the playing style block outside the model card', "      ${D ? dnaBlock(v) : ''}\n    </div>`;", "    </div>${D ? dnaBlock(v) : ''}`;"],
  ['two menus open at once', "const id = box + ':' + g.label, fixed = !!g.fixed, open = !fixed && state.frOpen === id;", "const id = box + ':' + g.label, fixed = !!g.fixed, open = !fixed && !!state.frOpen;"],
  ['a pick leaves the menu open', "data-hid=\"${bindH(() => { state.frOpen = null; g.pick(o[0]); })}\"", "data-hid=\"${bindH(() => { g.pick(o[0]); })}\""],
  ['a fixed chip opens', "const id = box + ':' + g.label, fixed = !!g.fixed, open = !fixed && state.frOpen === id;", "const id = box + ':' + g.label, fixed = false, open = state.frOpen === id;"],
  ['fix 5: no catalog fallback for indoor', "    return cat && typeof cat.indoor === 'boolean' ? cat.indoor : null;", "    return null;"],
  ['fix 5: Indoor not carved out of Hard', "  function h2hSurfOf(r) { return r.indoor ? 'Indoor' : r.surface; }", "  function h2hSurfOf(r) { return r.surface; }"],
  ['record box: the Format filter ignored', "&& (fmt === 'all' || r.bo === fmt)", ""],
  ['hot lines: no basis label', "const basis = xHotBasis(L, HW, F.length);", "const basis = '';"],
  ['hot lines: no Bo5 lines', "fhH2hLineDefs(h.aS, h.bS).concat(H2H_BO5_LINES)", "fhH2hLineDefs(h.aS, h.bS)"],
  ['record box: initials back in the head', "${xAv(v.a, 'a', 52, { fs: 16, eager: true })}", "${xIni(v.a, 'a', 52, 16)}"],
  ['record box: the On <surface> tile back first', "    const tiles = [ptsTile,\n      { k: 'Went to a deciding set',", "    const tiles = [ptsTile, { k: 'On hard', v: '0–0', sub: '' },\n      { k: 'Went to a deciding set',"],
  ['fix 4: no wider window under the floor', "if (d && d.inPool && !d.ok && W.scope === 'last52') {", "if (false) {"],
  ['the speed chip from the current reading', "const y = year != null ? cc['as' + String(year).slice(0, 4)] : null, v = typeof y === 'number' ? y : null;", "const v = typeof cc.abstractSpeed === 'number' ? cc.abstractSpeed : null;"],
  ['Market edge window tabs back in the head', "    const head = xBoxHead('Market edge', bandHelp, xChips('market', m.chips));", "    const head = xBoxHead('Market edge', bandHelp, xSw(m.tabs || [], 'lg'));"],
];
const CSS_MUTANTS = [
  ['the section in view not marked', '#h2hRoot .x-nav[data-navon="1"] { font-weight: 700; color: var(--h2h-text); background: var(--h2h-raised);', '#h2hRoot .x-nav[data-navon="1"] { font-weight: 600; color: var(--h2h-grey); background: transparent;'],
];
const SUITES = ['test-h2h-r7.mjs'];
const run = env => spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, env), encoding: 'utf8' });
if (run({}).status !== 0) { console.error('✖ the suite is red on the unmutated file — mutants are meaningless'); process.exit(1); }
console.log('✔ control: the unmutated file passes');
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h2hr7-mut-'));
for (const [name, from, to] of MUTANTS) {
  if (src.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, src.replace(from, to));
  if (run({ TEN402_HTML: file }).status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
for (const [name, from, to] of CSS_MUTANTS) {
  if (CSS_SRC.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.css');
  fs.writeFileSync(file, CSS_SRC.replace(from, to));
  if (run({ TEN402_CSS: file }).status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length + CSS_MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
