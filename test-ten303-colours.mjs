// TEN-314 (TEN-312 D1, founder 2026-09-28) — the Match analysis modal is coloured ONLY through its token file,
// match-analysis-tokens.css (Night 24b default, Day 26f, README §3 + the U1–U24 mappings). The TEN-303 design-verbatim
// exception (AODDS_C / WX_C / <style id="design-verbatim-analysis"> holding the export's hex) ended with this change.
// Locks:
//   0. a grep of the modal's builders and CSS finds no literal hex / rgba (mutant: a literal back in a builder);
//   1. every Odds-tab colour (AODDS_C) is the var() of the token its ROLE maps to — the Odds Tab - Spec.md table row
//      by row — and the token file resolves that token (Night) to the README §3 / U value (mutants: text back to the
//      spec hex, player A back to the link blue, a token value drifted in the token file);
//   2. the RENDERED chrome (the last rule the cascade applies): nav-selected = --ma-sel, modal box = --ma-page, …, and
//      Day changes the surfaces (mutant: the old verbatim #171D2F re-appended after the chrome block);
//   3. the 12a engine has no design-verbatim zone left and changes nothing in the three former zones (mutant: a
//      literal put back into AODDS_C is re-toned by the engine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, constSrc } from './tools/ten303-odds-harness.mjs';
import { tokens, resolve, modalLiterals, TOKEN_CSS } from './tools/ten303-tokens.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(process.env.TEN303_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');   // mutant runner: a mutated copy
const SPEC = readFileSync(join(HERE, 'design/handoff-15-odds-tab/Odds Tab - Spec.md'), 'utf8');

// README §3 (Night 24b) and the U-mappings (phase1-token-mappings §2): the values the token file must carry.
const NIGHT = { 'ma-page': '#191B24', 'ma-card': '#14151D', 'ma-inner': '#181922', 'ma-raised': '#1B1C27', 'ma-hover': '#20222E',
  'ma-sel': '#222431', 'ma-hair': 'RGBA(255,255,255,0.05)', 'ma-hair-soft': 'RGBA(255,255,255,0.035)', 'ma-hair-strong': 'RGBA(255,255,255,0.1)',
  'ma-hair-hover': 'RGBA(255,255,255,0.2)', 'ma-outline': 'RGBA(157,179,242,0.3)', 'ma-t1': '#FFFFFF', 'ma-t2': '#DDE0EA', 'ma-t3': '#A3AABE',
  'ma-fill': '#5B82E8', 'ma-link': '#9DB3F2', 'ma-on-fill': '#06070A', 'ma-pos': '#5CCB84', 'ma-neg': '#E06266', 'ma-amber': '#E8A84E',
  'ma-pb-fill': 'RGBA(255,255,255,0.7)', 'ma-track': 'RGBA(255,255,255,0.08)', 'ma-scrim': 'RGBA(4,5,8,0.72)', 'ma-chart-grid': 'RGBA(255,255,255,0.055)' };
const DAY_SURFACES = { 'ma-page': '#1E202B', 'ma-card': '#181922', 'ma-inner': '#1C1E28', 'ma-raised': '#20222E', 'ma-hover': '#262836', 'ma-sel': '#292B3A' };
const tokenOf = v => (/^var\(--([\w-]+)\)$/.exec(String(v).trim()) || [])[1] || null;

test('0: the modal\'s builders and CSS hold no literal colour (every colour is a token of match-analysis-tokens.css)', () => {
  assert.deepEqual(modalLiterals(HTML).map(x => `${x.where} L${x.line} ${x.lit}`), []);
  // mutant: one literal back in a shared builder (the W/L chip) — the grep sees it
  const m = HTML.replace("const c = won ? 'var(--positive)' : 'var(--negative)';", "const c = won ? '#3ed68c' : 'var(--negative)';");
  assert.notEqual(m, HTML, 'mutant anchor');
  assert.equal(modalLiterals(m).length, 1, 'mutant survived: a literal in fhWlChip');
});

test('0b: the token file carries the README §3 Night values, and Day re-tones every surface', () => {
  for (const [k, v] of Object.entries(NIGHT)) assert.equal(resolve(`var(--${k})`), v, `Night --${k}`);
  for (const [k, v] of Object.entries(DAY_SURFACES)) {
    assert.equal(resolve(`var(--${k})`, 'day'), v, `Day --${k}`);
    assert.notEqual(resolve(`var(--${k})`, 'day'), resolve(`var(--${k})`), `--${k} changes with the setting`);
  }
  // mutant: a drifted token value in the token file
  const drift = TOKEN_CSS.replace('--ma-t2:#DDE0EA;', '--ma-t2:#DDE0EB;');
  assert.notEqual(drift, TOKEN_CSS, 'mutant anchor');
  assert.notEqual(resolve('var(--ma-t2)', 'night', tokens('night', drift)), NIGHT['ma-t2'], 'mutant survived: drifted --ma-t2');
});

// Spec table row -> the AODDS_C key(s) that carry it, and the token its ROLE maps to (README §3; D4 players neutral;
// Blue / Sharp heading are accent TEXT → link; Row hover U3; Segmented bg = a seg track → inner box).
const SPEC_ROLE = { 'Player A': [['a'], 'ma-t1'], 'Player B': [['b'], 'ma-t2'], 'Up': [['up'], 'ma-pos'], 'Down': [['dn'], 'ma-neg'],
  'Text': [['text'], 'ma-t1'], 'Muted 1': [['sub', 'soft'], 'ma-t2'], 'Muted 2': [['label'], 'ma-t3'], 'Muted 3': [['label3'], 'ma-t3'],
  'Header caps': [['caps'], 'ma-t2'], 'Blue': [['blue'], 'ma-link'], 'Sharp heading': [['sharp'], 'ma-link'], 'Row / tile bg': [['row'], 'ma-card'],
  'Row hover bg': [['rowHover'], 'ma-hover'], 'Pop-up bg': [['pop'], 'ma-raised'], 'Segmented bg': [['segTrack'], 'ma-inner'] };
// the spec's prose values (§1–§6) by role
const PROSE_ROLE = { bFill: 'ma-pb-fill', blueFill: 'ma-fill', steamInk: 'ma-on-fill', segOnBg: 'ma-sel', segOnBd: 'ma-outline', segTrackBd: 'ma-hair',
  tileBd: 'ma-hair-strong', tileHoverBd: 'ma-outline', tileOnBg: 'ma-sel', tileOnBd: 'ma-outline', booksBd: 'ma-outline', hdrBd: 'ma-hair',
  nameRule: 'ma-hair', groupRule: 'ma-hair', rowBd: 'ma-hair-soft', rowHoverBd: 'ma-outline', popBd: 'ma-hair', panelBd: 'ma-hair-soft',
  closeBd: 'ma-hair-strong', closeHoverBd: 'ma-hair-hover', tabBd: 'ma-hair-strong', tabOnBg: 'ma-sel', tabOnBd: 'ma-outline', tipBd: 'ma-hair',
  backdrop: 'ma-scrim', popShadow: 'ma-shadow-pop', tipShadow: 'ma-shadow-tip', grid: 'ma-chart-grid', axis: 'ma-hair-strong' };

test('1: every Odds-tab colour is the var() of the token its role maps to, and resolves to the README §3 value', () => {
  const sec = SPEC.slice(SPEC.indexOf('## Colour tokens used on this tab'), SPEC.indexOf('## Layout'));
  const rows = [...sec.matchAll(/^\| ([^|]+?) \| (#[0-9A-Fa-f]{6}) \|/gm)].map(m => m[1].trim());
  assert.deepEqual(rows.slice().sort(), Object.keys(SPEC_ROLE).sort(), 'every spec table row has a role');
  const C = build().AODDS_C;
  for (const name of rows) for (const k of SPEC_ROLE[name][0]) {
    assert.equal(tokenOf(C[k]), SPEC_ROLE[name][1], `${name} (${k}) = var(--${SPEC_ROLE[name][1]})`);
    if (NIGHT[SPEC_ROLE[name][1]]) assert.equal(resolve(C[k]), NIGHT[SPEC_ROLE[name][1]], `${name} resolves (Night)`);
  }
  for (const [k, t] of Object.entries(PROSE_ROLE)) assert.equal(tokenOf(C[k]), t, `${k} = var(--${t})`);
  // every colour key is covered by a role above (widths are the spec's)
  const covered = new Set([...Object.values(SPEC_ROLE).flatMap(r => r[0]), ...Object.keys(PROSE_ROLE)]);
  assert.deepEqual(Object.keys(C).filter(k => !covered.has(k)).sort(), ['hw1', 'hw125']);
  assert.equal(C.hw1, '1px'); assert.equal(C.hw125, '1.25px');
  // D4: no player colour is the link / fill blue
  for (const k of ['a', 'b', 'bFill']) assert.ok(!['ma-link', 'ma-fill', 'periwinkle'].includes(tokenOf(C[k])), `player ${k} is neutral`);
});

// The page's stylesheet rules, in document order, as [selector, declarations].
function rules(src) {
  const out = [];
  for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const css = m[1].replace(/\/\*[\s\S]*?\*\//g, '');
    for (const r of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push([r[1].trim(), r[2]]);
  }
  return out;
}
function applied(src, selector, prop) {
  let v = null;
  for (const [sel, body] of rules(src)) {
    if (!sel.split(',').map(s => s.trim()).includes(selector)) continue;
    const d = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)').exec(body); if (d) v = d[1].trim().replace(/\s*!important$/, '');
  }
  return v;
}

test('2: the rendered chrome reads the tokens (Night and Day): nav selected, modal box, menu, close, the Odds tab text', () => {
  const want = [
    ['.modal-analysis .asidenav-item.active', 'background', 'ma-sel'], ['.modal-analysis .asidenav-item.active', 'color', 'ma-t1'],
    ['.modal-analysis', 'background', 'ma-page'], ['.modal-analysis', 'box-shadow', 'ma-shadow-modal'], ['#analysisModal', 'background', 'ma-scrim'],
    ['.modal-analysis .asidenav-item', 'color', 'ma-t3'], ['.modal-analysis .asidenav-item:hover', 'background', 'ma-hover'],
    ['#aSectionOdds', 'color', 'ma-t1'], ['.modal-analysis .ahead2 .close', 'color', 'ma-t3'], ['.modal-analysis .asidenav-download', 'border-top-color', 'ma-hair'],
    ['.modal-analysis .asidenav-download', 'color', 'ma-link'], ['.modal-analysis .apname', 'color', 'ma-t1'], ['.modal-analysis .apname.b', 'color', 'ma-t2'],
    ['.aox-row:not(.aox-nodata):hover', 'background', 'ma-hover'], ['.aox-row:not(.aox-nodata):hover', 'border-color', 'ma-outline'],
  ];
  for (const [sel, prop, t] of want) assert.equal(tokenOf(applied(HTML, sel, prop)), t, `${sel} ${prop}`);
  assert.equal(resolve(applied(HTML, '.modal-analysis .asidenav-item.active', 'background')), '#222431');
  assert.equal(resolve(applied(HTML, '.modal-analysis .asidenav-item.active', 'background'), 'day'), '#292B3A', 'Day re-tones the selected tab');
  assert.equal(resolve(applied(HTML, '.modal-analysis', 'background')), '#191B24');
  assert.equal(resolve(applied(HTML, '.modal-analysis', 'background'), 'day'), '#1E202B', 'Day re-tones the modal box');
  // the extract's type base, so the tab's boxes are the design's height (the modal inherits 14px / 1.5)
  assert.equal(applied(HTML, '#aSectionOdds', 'line-height'), 'normal');
  assert.equal(applied(HTML, '#aSectionOdds', 'font-size'), '16px');
  assert.ok(!HTML.includes('<style id="design-verbatim-analysis">'), 'the verbatim block is gone');
  // mutant: the old verbatim rule re-appended after the chrome block wins the cascade again
  const m = HTML.replace('</body>', '<style>.modal-analysis .asidenav-item.active{ background:#171D2F; }</style></body>');
  assert.notEqual(resolve(applied(m, '.modal-analysis .asidenav-item.active', 'background')), '#222431', 'control');
  assert.ok(modalLiterals(m).length > 0, 'mutant survived: a literal in the chrome');
});

test('3: the 12a engine has no design-verbatim zone left and leaves the former zones as they are', async () => {
  const src = readFileSync(join(HERE, 'tools/theme-12a/recolour.mjs'), 'utf8');
  assert.match(src, /\nconst DESIGN_ZONES = \{\};/, 'no exemption: nothing in the modal needs one');
  const { recolourFile } = await import('./tools/theme-12a/recolour.mjs');
  const text = s => { const r = recolourFile('bsp-consult-dashboard.html', s); return typeof r === 'string' ? r : (r.out != null ? r.out : r.src); };
  const out = text(HTML);
  const blk = s => s.slice(s.indexOf('<style id="match-analysis-chrome">'), s.indexOf('</style>', s.indexOf('<style id="match-analysis-chrome">')));
  assert.ok(blk(HTML).length > 100, 'the chrome block exists');
  for (const name of ['AODDS_C', 'WX_C', 'ME_C']) assert.equal(constSrc(name, out), constSrc(name, HTML), `${name} re-toned by the engine`);
  assert.equal(blk(out), blk(HTML), 'the chrome block re-toned by the engine');
  // mutant: a literal back in AODDS_C — the engine would map it (and the grep of test 0 sees it)
  const mut = HTML.replace("  text: 'var(--ma-t1)',      // Text", "  text: '#E7E9EE',      // Text");
  assert.notEqual(mut, HTML, 'mutant anchor');
  assert.notEqual(constSrc('AODDS_C', text(mut)), constSrc('AODDS_C', mut), 'mutant survived: the engine left a literal AODDS_C alone');
});
