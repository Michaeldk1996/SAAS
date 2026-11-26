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
  ['Model: the opening margin dropped (a fair price shown as the opening line)', "    out.aPrice = (1 / (pA * (1 + m))).toFixed(2);", "    out.aPrice = (1 / pA).toFixed(2);"],
  ['Model: the Surface / Format toggles ignored', "    const cell = row && row[surface[0] + bestOf];", "    const cell = row && row.H3;"],
  ['Model: B\'s price from A\'s probability', "    const pA = cell[0] / 1e4, pB = 1 - pA;", "    const pA = cell[0] / 1e4, pB = pA;"],
  ['Model: a failed load reads as not covered', "    if (sa.st === 'failed' || sb.st === 'failed') { out.emptyText = 'The estimate couldn’t load. It will try again.'; return out; }\n", ""],
  ['Model: a file with no margin still priced', "    if (!(m >= 0 && m < 0.2)) { out.emptyText = 'The estimate file carries no margin, so no price is shown.'; return out; }\n", "    if (!(m >= 0 && m < 0.2)) { }\n"],
  ['Model: a refetch on every render', "    if (c && (c.st !== 'failed' || Date.now() - c.at < H2H_PAIR_RETRY_MS)) return c;", "    if (c && c.st === 'ready') return c;"],
  ['DNA (ruling 8 re-ruled): Last 24 months back as a third window', "    career: { scope: 'career', label: 'Career', lc: 'career', career: true } };", "    m24: { scope: 'sinceBase', label: 'Last 24 months', lc: 'last 24 months' },\n    career: { scope: 'career', label: 'Career', lc: 'career', career: true } };"],
  // ---- the design rebuild (founder 2026-11-16)
  ["H6: an empty news card loses its sentence (a blank card)", "        ${!list.length ? `<div style=\"padding:16px 0; text-align:center; font-size:12.5px; color:${G};\">${E(emptyTxt)}</div>` : ''}", ""],
  ["H6: an ASAP item filed as an article", "    if (n.kind === 'asap') return 'quotes';\n", ""],
  ["ruling 1: the better-figure emphasis off", "const H2H_FTF_LEAD_EMPHASIS = true;", "const H2H_FTF_LEAD_EMPHASIS = false;"],
  ["ruling 1: the better figure white 700 (not 800)", "const aW = em ? (ld > 0 ? 800 : 500) : 500, bW = em ? (ld < 0 ? 800 : 500) : 500;", "const aW = em ? (ld > 0 ? 700 : 500) : 500, bW = em ? (ld < 0 ? 700 : 500) : 500;"],
  ["ruling 1: a tie marked as a lead", "const ld = !both || xn === yn ? 0 : xn > yn ? 1 : -1", "const ld = !both ? 0 : xn >= yn ? 1 : -1"],
  ["radar: player one's polygon white", "stroke=\"var(--h2h-blue)\" stroke-width=\"2\" stroke-linejoin=\"round\"></polygon>", "stroke=\"var(--h2h-text)\" stroke-width=\"2\" stroke-linejoin=\"round\"></polygon>"],
  ["radar: player two dashed again", "stroke=\"var(--h2h-text)\" stroke-width=\"1.5\" stroke-linejoin=\"round\"></polygon>", "stroke=\"var(--h2h-text)\" stroke-width=\"1.5\" stroke-dasharray=\"4 3\" stroke-linejoin=\"round\"></polygon>"],
  ["radar: player two's dots solid (20 Nov §3: B hollow)", "r=\"3.5\" fill=\"var(--h2h-card)\" stroke=\"var(--h2h-text)\" stroke-width=\"1.5\">", "r=\"3.5\" fill=\"var(--h2h-text)\" stroke=\"var(--h2h-text)\" stroke-width=\"1.5\">"],
  ["radar: the dotted inner rings back to solid (20 Nov §3)", "stroke-width=\"1\" stroke-dasharray=\"2 4\"></circle>", "stroke-width=\"1\"></circle>"],
  ["radar: the old 0 0 420 300 viewBox (20 Nov §3)", "<svg viewBox=\"55 0 310 270\"", "<svg viewBox=\"0 0 420 300\""],
  ["the comparison list: Break points converted back (20 Nov §1)", "['', 'Service games held', ex.a[3], ex.b[3], 3], ['Return', 'Return games won', ex.a[4], ex.b[4], 3],", "['', 'Service games held', ex.a[3], ex.b[3], 3], ['Return', 'Return games won', ex.a[4], ex.b[4], 3], ['', 'Break points converted', ex.a[4], ex.b[4], 3],"],
  ["the comparison list: Dominance ratio back after Under pressure (20 Nov §1)", "['', 'Dominance ratio', raw(D.a, 'dominanceRatio'), raw(D.b, 'dominanceRatio'), 2],\n      ['', 'Serve rating', raw(D.a, 'serve'), raw(D.b, 'serve'), 0], ['', 'Return rating', raw(D.a, 'return'), raw(D.b, 'return'), 1],\n      ['', 'Under pressure', raw(D.a, 'underPressure'), raw(D.b, 'underPressure'), 1],", "\n      ['', 'Serve rating', raw(D.a, 'serve'), raw(D.b, 'serve'), 0], ['', 'Return rating', raw(D.a, 'return'), raw(D.b, 'return'), 1],\n      ['', 'Under pressure', raw(D.a, 'underPressure'), raw(D.b, 'underPressure'), 1], ['', 'Dominance ratio', raw(D.a, 'dominanceRatio'), raw(D.b, 'dominanceRatio'), 2],"],
  ["Model: the Elo-alone line dropped from the help (founder 2026-11-20)", "if (help && m.aBase && m.bBase) help += ", "if (false) help += "],
  ["Model: the help loses its model line (the 20 Nov ASI cut)", "+ '\\n'\n      + 'Elo base '", "+ '\\n';\n      0 + 'Elo base '"],
  ["avatar: player two's ring blue", "const ring = side === 'b' ? 'var(--h2h-text)' : 'var(--h2h-blue)';\n    const key = p && p.key", "const ring = side === 'b' ? 'var(--h2h-blue)' : 'var(--h2h-blue)';\n    const key = p && p.key"],
  ["menu: radius 10 and no 10% edge", "border:1px solid color-mix(in srgb, var(--h2h-white) 10%, transparent); border-radius:12px; padding:6px; z-index:40; max-height:280px;", "border:1px solid transparent; border-radius:10px; padding:6px; z-index:40; max-height:280px;"],
  ["the sticky picker scrolls away", "<div class=\"x-stick\" style=\"position:sticky; top:0;", "<div class=\"x-stick\" style=\"position:relative; top:0;"],
  ["the sticky shadow gone", "padding:16px 18px; box-shadow:var(--h2h-shadow-sticky);\">", "padding:16px 18px;\">"],
  ["a caps line back above the title", "<div style=\"display:flex; align-items:center; gap:10px;\"><h1 style=\"margin:0; font-size:24px;", "<div style=\"font-size:10.5px; text-transform:uppercase;\">ATP tour</div><div style=\"display:flex; align-items:center; gap:10px;\"><h1 style=\"margin:0; font-size:24px;"],
  ["the title back at 29px (the plain head of 17 Nov)", "<h1 style=\"margin:0; font-size:24px; font-weight:800;", "<h1 style=\"margin:0; font-size:29px; font-weight:800;"],
  ["section cards on a 16% edge", "const X_SEC = 'background:var(--h2h-card); border:1px solid color-mix(in srgb, var(--h2h-white) 6%, transparent);", "const X_SEC = 'background:var(--h2h-card); border:1px solid color-mix(in srgb, var(--h2h-white) 16%, transparent);"],
  ["the caps label back to 10.5/700 uppercase (20 Nov §8)", "const X_CAP = \"font-family:'Hanken Grotesk',sans-serif; font-size:11.5px; font-weight:600; color:var(--h2h-grey);\";", "const X_CAP = \"font-family:'Hanken Grotesk',sans-serif; font-size:10.5px; font-weight:700; letter-spacing:0.10em; text-transform:uppercase; color:var(--h2h-grey);\";"],
  ["the pill track back on --h2h-inner (20 Nov §8)", "return `<div class=\"x-sw\" style=\"display:${r8 ? 'inline-flex' : 'flex'}; gap:3px; background:var(--h2h-track);", "return `<div class=\"x-sw\" style=\"display:${r8 ? 'inline-flex' : 'flex'}; gap:3px; background:var(--h2h-inner);"],
  ["the selected pill back on a blue fill", "color:${it.on ? 'var(--h2h-text)' : 'var(--h2h-grey)'}; background:${it.on ? 'var(--h2h-raised)' : 'transparent'}; border:1px solid ${it.on ?", "color:${it.on ? 'var(--h2h-text)' : 'var(--h2h-grey)'}; background:${it.on ? 'var(--h2h-blue)' : 'transparent'}; border:1px solid ${it.on ?"],
  // founder fix 2 (2026-11-26) removed the blue flash: the mutant now brings it back
  ["the Model price flashes blue again (founder fix 2)", "font-weight:800; color:var(--h2h-text); line-height:1.05; white-space:nowrap;\">${E(price)}", "font-weight:800; color:${state.flash ? 'var(--h2h-blue)' : 'var(--h2h-text)'}; transition:color 260ms ease; line-height:1.05; white-space:nowrap;\">${E(price)}"],
  ["the 520 ms flash timer back in setCtx (founder fix 2)", "  function setCtx(patch) { setState(patch); }", "  function setCtx(patch) { clearTimeout(F); Object.assign(state, { flash: true }, patch); render(); F = setTimeout(() => setState({ flash: false }), 520); }"],
  ["Model: the price range dropped (founder fix 1)", "${box(v.a, 'a', m.aName, m.aRange || m.aPrice, m.aBase)}", "${box(v.a, 'a', m.aName, m.aPrice, m.aBase)}"],
  ["Model: the card opens on Hard again (round 7: All surfaces)", "    ctxSurface: 'all', ctxRound: 'QF',", "    ctxSurface: 'Hard', ctxRound: 'QF',"],
  ["the section nav never marks the section in view", "data-navon=\"${n.id === (state.navAt || 'h2h-model') ? 1 : 0}\"", "data-navon=\"0\""],
  ["the jump links lose data-h2h-jump", "<span class=\"seg x-nav\" data-h2h-jump=\"${n.id}\"", "<span class=\"seg x-nav\""],
  ["Ring blue back in the rebuild (the lean bar)", "const leadC = ld > 0 ? 'var(--h2h-blue)'", "const leadC = ld > 0 ? 'var(--bar)'"],
];
// Mutants applied to h2h-page.css (TEN402_CSS): the hover states and the band the rebuild keeps in the stylesheet.
const CSS_SRC = fs.readFileSync(path.join(ROOT, 'h2h-page.css'), 'utf8');
const CSS_MUTANTS = [
  ["CSS: the picker's band not sticky", "#h2hRoot .x-stick { position: sticky; top: 0;", "#h2hRoot .x-stick { position: relative; top: 0;"],
  ["CSS: the Change hover state dropped", "#h2hRoot .x-change:hover { color: var(--h2h-text) !important;", "#h2hRoot .x-change:focus { color: var(--h2h-text) !important;"],
  ["CSS: Ring blue in the stylesheet", "#h2hRoot .x-chev, .h2hx-pop .x-chev { color: var(--h2h-blue);", "#h2hRoot .x-chev, .h2hx-pop .x-chev { color: var(--bar);"],
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
for (const [name, from, to] of CSS_MUTANTS) {
  if (CSS_SRC.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.css');
  fs.writeFileSync(file, CSS_SRC.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, { TEN402_CSS: file }), encoding: 'utf8' });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length + CSS_MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
