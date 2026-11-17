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
  ['DNA: the since-2024 window labelled "Career"', "since: { label: 'Since Mar 2024', scope: 'sinceBase'", "since: { label: 'Career', scope: 'sinceBase'"],
  // ---- the design rebuild (founder 2026-11-16)
  ["H6: an empty news card loses its sentence (a blank card)", "        ${!list.length ? `<div style=\"padding:16px 0; text-align:center; font-size:12.5px; color:${G};\">${E(emptyTxt)}</div>` : ''}", ""],
  ["H6: an ASAP item filed as an article", "    if (n.kind === 'asap') return 'quotes';\n", ""],
  ["ruling 1: the better-figure emphasis off", "const H2H_FTF_LEAD_EMPHASIS = true;", "const H2H_FTF_LEAD_EMPHASIS = false;"],
  ["ruling 1: the better figure white 700 (not 800)", "const aW = em ? (ld > 0 ? 800 : 500) : 500, bW = em ? (ld < 0 ? 800 : 500) : 500;", "const aW = em ? (ld > 0 ? 700 : 500) : 500, bW = em ? (ld < 0 ? 700 : 500) : 500;"],
  ["ruling 1: a tie marked as a lead", "const ld = !both || xn === yn ? 0 : xn > yn ? 1 : -1", "const ld = !both ? 0 : xn >= yn ? 1 : -1"],
  ["radar: player one's polygon white", "stroke=\"var(--h2h-blue)\" stroke-width=\"1.75\" stroke-linejoin=\"round\"></polygon>", "stroke=\"var(--h2h-text)\" stroke-width=\"1.75\" stroke-linejoin=\"round\"></polygon>"],
  ["radar: player two dashed again", "stroke=\"var(--h2h-text)\" stroke-width=\"1.75\" stroke-linejoin=\"round\"></polygon>", "stroke=\"var(--h2h-text)\" stroke-width=\"1.75\" stroke-dasharray=\"4 3\" stroke-linejoin=\"round\"></polygon>"],
  ["avatar: player two's ring blue", "const ring = side === 'b' ? 'var(--h2h-text)' : 'var(--h2h-blue)';", "const ring = side === 'b' ? 'var(--h2h-blue)' : 'var(--h2h-blue)';"],
  ["menu: radius 10 and no 10% edge", "border:1px solid color-mix(in srgb, var(--h2h-white) 10%, transparent); border-radius:12px; padding:6px; z-index:40; max-height:280px;", "border:1px solid transparent; border-radius:10px; padding:6px; z-index:40; max-height:280px;"],
  ["the sticky picker scrolls away", "<div class=\"x-stick\" style=\"position:sticky; top:0;", "<div class=\"x-stick\" style=\"position:relative; top:0;"],
  ["the sticky shadow gone", "padding:16px 18px; box-shadow:var(--h2h-shadow-sticky);\">", "padding:16px 18px;\">"],
  ["a caps line back above the title", "          <h1 style=\"margin:0; font-size:29px;", "          <div style=\"font-size:10.5px; text-transform:uppercase;\">ATP tour</div><h1 style=\"margin:0; font-size:29px;"],
  ["the title back at 24px (the 35b header)", "<h1 style=\"margin:0; font-size:29px; font-weight:800;", "<h1 style=\"margin:0; font-size:24px; font-weight:800;"],
  ["section cards on a 16% edge", "const X_SEC = 'background:var(--h2h-card); border:1.25px solid color-mix(in srgb, var(--h2h-white) 6%, transparent);", "const X_SEC = 'background:var(--h2h-card); border:1.25px solid color-mix(in srgb, var(--h2h-white) 16%, transparent);"],
  ["the selected pill back on a blue fill", "color:${it.on ? 'var(--h2h-text)' : 'var(--h2h-grey)'}; background:${it.on ? 'var(--h2h-raised)' : 'transparent'}; border:1px solid ${it.on ?", "color:${it.on ? 'var(--h2h-text)' : 'var(--h2h-grey)'}; background:${it.on ? 'var(--h2h-blue)' : 'transparent'}; border:1px solid ${it.on ?"],
  ["the Model price never flashes (Surface / Format)", "color:${state.flash ? 'var(--h2h-blue)' : 'var(--h2h-text)'};", "color:var(--h2h-text);"],
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
