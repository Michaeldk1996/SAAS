// TEN-314 (TEN-312 D1, founder 2026-09-28) → TEN-376 Foundation (founder, locked 2026-10-03): the Match analysis modal
// is coloured ONLY through the site's one token file, tokens.css (.claude/rules/foundation.md). The modal's own file
// (match-analysis-tokens.css, Night 24b / Day 26f + the U1–U24 mappings) was deleted by design; this suite reads
// tokens.css directly (the shared tools/ten303-tokens.mjs still reads the deleted file).
// Locks:
//   0. a grep of the modal's builders and CSS finds no literal hex / rgba (mutant: a literal back in a builder);
//   0b. every token the Odds tab uses is set by tokens.css; Night = the foundation.md values, Day re-tones ONLY the
//      surfaces (replaces the README §3 Night / Day 26f table — superseded);
//   1. every Odds-tab colour (AODDS_C) is the var() of the foundation token its ROLE maps to — the Odds Tab - Spec.md
//      table row by row (mutants: text back to a literal, player A back to the link blue, the BOOKS tag on the fill blue);
//   2. the RENDERED chrome (the last rule the cascade applies): nav-selected = --selected, modal box = --page, …, and
//      Day changes the surfaces (mutant: an old verbatim literal re-appended after the chrome block);
//   3. the 12a engine has no design-verbatim zone left and changes nothing in the three former zones (mutant: a
//      literal put back into AODDS_C is re-toned by the engine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, constSrc } from './tools/ten303-odds-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(process.env.TEN303_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');   // mutant runner: a mutated copy
const SPEC = readFileSync(join(HERE, 'design/handoff-15-odds-tab/Odds Tab - Spec.md'), 'utf8');
const TOKEN_CSS = readFileSync(process.env.TEN303_TOKENS || join(HERE, 'tokens.css'), 'utf8');
const RULES = readFileSync(join(HERE, '.claude/rules/foundation.md'), 'utf8');

// ---- tokens.css, read the way the browser reads it ----
function props(css, sel) {
  const at = css.indexOf(sel + ' {'); if (at < 0) throw new Error('token block missing: ' + sel);
  const body = css.slice(at + sel.length + 2, css.indexOf('\n}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
  const out = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
function tokens(theme = 'night', css = TOKEN_CSS) {
  const night = Object.assign({}, props(css, ':root,\n[data-theme="night"]'), props(css, '\n:root'));
  return theme === 'day' ? Object.assign({}, night, props(css, '[data-theme="day"]')) : night;
}
const up = s => String(s).replace(/\s+/g, '').toUpperCase();
function rgba(v) {           // '#RGB' | '#RRGGBB' | 'rgba(r,g,b,a)' -> [r,g,b,a]
  let s = up(v);
  if (/^#[0-9A-F]{3}$/.test(s)) s = '#' + [...s.slice(1)].map(c => c + c).join('');
  let m = /^#([0-9A-F]{6})$/.exec(s);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^RGBA?\(([\d.]+),([\d.]+),([\d.]+)(?:,([\d.]+))?\)$/.exec(s);
  if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]];
  return null;
}
function fmt(c) {
  if (c[3] === 1) return '#' + c.slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `RGBA(${c[0]},${c[1]},${c[2]},${+c[3].toFixed(4)})`;
}
// A value as the page paints it: var() chains and `color-mix(in srgb, <c> p%, transparent)` → #RRGGBB / RGBA(…).
function resolve(value, theme = 'night', T = tokens(theme), depth = 0) {
  if (depth > 20) throw new Error('var() cycle at ' + value);
  let v = String(value).trim();
  v = v.replace(/var\(--([\w-]+)\)/g, (_, n) => {
    if (!(n in T)) throw new Error(`--${n} is not set by tokens.css`);
    return resolve(T[n], theme, T, depth + 1);
  });
  v = v.replace(/color-mix\(in srgb,\s*([^%]+?)\s+([\d.]+)%\s*,\s*transparent\)/g, (all, c, p) => {
    const x = rgba(c); if (!x) throw new Error('color-mix of a non-colour: ' + all);
    return fmt([x[0], x[1], x[2], x[3] * p / 100]);
  });
  const c = rgba(v);
  return c ? fmt(c) : v;
}

// ---- the grep: no literal colour in the modal's code (the reach walk of TEN-314 phase 1 + the modal's CSS rules) ----
const COL = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
const ROOTS = ['openAnalysisModal', 'A_TAB_BUILD', 'A_TAB_REVISIT', 'aShowTab', 'aBuildForReport', 'printAnalysisReport'];
const EXITS = ['openPlayerProfileFromMatch', 'showPlayerProfile', 'openEdgeModelFromMatch', 'openEdgeModel', 'render',
  'loadPointsAtRisk', 'renderNews', 'loadAsapSignals', '_mcNowPair'];
function modalDecls(html) {
  const lines = html.split('\n'), starts = [];
  let inScript = false;
  lines.forEach((l, i) => {
    if (/<script(?![^>]*src)[^>]*>/.test(l)) inScript = true;
    if (l.includes('</script>')) inScript = false;
    const m = inScript && /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(l);
    if (m) starts.push([m[1] || m[2], i + 1]);
  });
  const by = new Map();
  starts.forEach(([n, s], k) => { const e = k + 1 < starts.length ? starts[k + 1][1] - 1 : lines.length; if (!by.has(n)) by.set(n, []); by.get(n).push([n, s, e]); });
  const body = d => lines.slice(d[1] - 1, d[2]).join('\n');
  const seen = new Set(ROOTS), q = [...ROOTS];
  while (q.length) {
    const n = q.shift();
    for (const d of by.get(n) || []) for (const tok of new Set(body(d).match(/[A-Za-z_$][\w$]*/g))) {
      if (by.has(tok) && !seen.has(tok) && !EXITS.includes(tok)) { seen.add(tok); q.push(tok); }
    }
  }
  return { lines, decls: [...seen].flatMap(n => by.get(n) || []) };
}
const MODAL_SEL = /\.modal-analysis|#analysisModal|#aSection|#fhSheet|#mePop|#aoddsTip|\.aox-|\.wx-|\.me-|\.atourn|\.yr-|\.tprogress|\.aodds|\.akeycard|\.arr-badge|\.psx-|\.alivebar/;
function modalLiterals(html) {
  const out = [];
  const { lines, decls } = modalDecls(html);
  for (const d of decls) for (let ln = d[1]; ln <= d[2]; ln++) {
    const L = lines[ln - 1];
    for (const m of L.matchAll(COL)) {
      if (m[0][0] === '#' && /[\w&-]/.test(L[m.index - 1] || '')) continue;   // an id / entity, not a colour
      out.push({ where: d[0], line: ln, lit: m[0] });
    }
  }
  for (const sm of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const css = sm[1].replace(/\/\*[\s\S]*?\*\//g, c => ' '.repeat(c.length));
    for (const r of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = r[1].trim();
      if (!MODAL_SEL.test(sel)) continue;
      for (const m of r[2].matchAll(COL)) out.push({ where: sel.slice(0, 80), line: html.slice(0, sm.index).split('\n').length, lit: m[0] });
    }
  }
  return out;
}

// foundation.md's quoted values (`--text` #FFF, `--text-soft` #DDE0EA, `--text-label` #A3AABE, `--link` #6A9AF8, `--backdrop` …)
const FOUNDATION = Object.fromEntries([...RULES.matchAll(/`--([\w-]+)`\s+(#[0-9A-Fa-f]{3,6}\b|rgba\([^)]*\))/g)].map(m => [m[1], fmt(rgba(m[2]))]));
const SURFACES = /Only surfaces change\*\* between themes \(([^)]*)\)/.exec(RULES.replace(/\s+/g, ' '))[1].match(/--([\w-]+)/g).map(s => s.slice(2));
const tokenOf = v => (/^var\(--([\w-]+)\)$/.exec(String(v).trim()) || [])[1] || null;

test('0: the modal\'s builders and CSS hold no literal colour (every colour is a tokens.css token)', () => {
  assert.deepEqual(modalLiterals(HTML).map(x => `${x.where} L${x.line} ${x.lit}`), []);
  // mutant: one literal back in a shared builder (the Form bar; TEN-331 deleted the W/L chip) — the grep sees it
  const m = HTML.replace("const c = r.won ? 'var(--pos)' : 'var(--neg)';", "const c = r.won ? '#3ed68c' : 'var(--neg)';");
  assert.notEqual(m, HTML, 'mutant anchor');
  assert.equal(modalLiterals(m).length, 1, 'mutant survived: a literal in the Form bar');
});

test('0b: every Odds-tab token is set by tokens.css; Night = foundation.md, Day re-tones only the surfaces', () => {
  assert.ok(Object.keys(FOUNDATION).length >= 5, 'read foundation.md\'s values');
  for (const [k, v] of Object.entries(FOUNDATION)) assert.equal(resolve(`var(--${k})`), v, `Night --${k}`);
  const used = [...new Set(Object.values(build().AODDS_C).map(tokenOf).filter(Boolean))];
  assert.ok(used.length > 10, `AODDS_C reads tokens (${used.length})`);
  for (const k of used) {
    const n = resolve(`var(--${k})`), d = resolve(`var(--${k})`, 'day');
    if (SURFACES.includes(k)) assert.notEqual(d, n, `--${k} (a surface) changes with the setting`);
    else assert.equal(d, n, `--${k} is identical in Night and Day`);
  }
  for (const k of SURFACES) assert.notEqual(resolve(`var(--${k})`, 'day'), resolve(`var(--${k})`), `--${k} changes with the setting`);
  // mutant: a drifted token value in the token file
  const drift = TOKEN_CSS.replace('--text-soft:   #DDE0EA;', '--text-soft:   #DDE0EB;');
  assert.notEqual(drift, TOKEN_CSS, 'mutant anchor');
  assert.notEqual(resolve('var(--text-soft)', 'night', tokens('night', drift)), FOUNDATION['text-soft'], 'mutant survived: drifted --text-soft');
});

// Spec table row -> the AODDS_C key(s) that carry it, and the foundation token its ROLE maps to (foundation.md):
// names white (player A), the second player's line --text-soft; signed values --pos / --neg; reading text --text-soft,
// labels / captions / column heads --text-label; blue is a fill, never text (the BOOKS tag and the SHARP heading are
// white text); row / tile / pop-up / segmented track = --card, tile hover --tile-hover.
const SPEC_ROLE = { 'Player A': [['a'], 'text'], 'Player B': [['b'], 'text-soft'], 'Up': [['up'], 'pos'], 'Down': [['dn'], 'neg'],
  'Text': [['text'], 'text'], 'Muted 1': [['sub', 'soft'], 'text-soft'], 'Muted 2': [['label'], 'text-label'], 'Muted 3': [['label3'], 'text-label'],
  'Header caps': [['caps'], 'text-label'], 'Blue': [['blue'], 'text'], 'Sharp heading': [['sharp'], 'text'], 'Row / tile bg': [['row'], 'card'],
  'Row hover bg': [['rowHover'], 'tile-hover'], 'Pop-up bg': [['pop'], 'card'], 'Segmented bg': [['segTrack'], 'card'] };
// the spec's prose values (§1–§6) by role: the darker track (README §5.1), clickable tiles (--edge-7 / hover --edge-16 /
// selected --edge-24), the STEAM badge (--selected + --edge-16, white caps), hairlines, the one scrim, the shadows, charts.
const PROSE_ROLE = { bFill: 'bar-2', blueFill: 'selected', steamInk: 'text', segOnBg: 'inner', segOnBd: 'edge-10', segTrackBd: 'edge-6',
  tileBd: 'edge-7', tileHoverBd: 'edge-16', tileOnBg: 'card', tileOnBd: 'edge-24', booksBd: 'edge-16', hdrBd: 'line',
  nameRule: 'line', groupRule: 'line', rowBd: 'line', rowHoverBd: 'edge-16', popBd: 'line', panelBd: 'line',
  closeBd: 'edge-10', closeHoverBd: 'edge-16', tabBd: 'edge-10', tabOnBg: 'inner', tabOnBd: 'edge-10', tipBd: 'line',
  backdrop: 'backdrop', popShadow: 'shadow-pop', tipShadow: 'shadow-menu', grid: 'viz-guide', axis: 'edge-10' };

test('1: every Odds-tab colour is the var() of the foundation token its role maps to', () => {
  const sec = SPEC.slice(SPEC.indexOf('## Colour tokens used on this tab'), SPEC.indexOf('## Layout'));
  const rows = [...sec.matchAll(/^\| ([^|]+?) \| (#[0-9A-Fa-f]{6}) \|/gm)].map(m => m[1].trim());
  assert.deepEqual(rows.slice().sort(), Object.keys(SPEC_ROLE).sort(), 'every spec table row has a role');
  const C = build().AODDS_C;
  for (const name of rows) for (const k of SPEC_ROLE[name][0]) {
    assert.equal(tokenOf(C[k]), SPEC_ROLE[name][1], `${name} (${k}) = var(--${SPEC_ROLE[name][1]})`);
    if (FOUNDATION[SPEC_ROLE[name][1]]) assert.equal(resolve(C[k]), FOUNDATION[SPEC_ROLE[name][1]], `${name} resolves (Night)`);
  }
  for (const [k, t] of Object.entries(PROSE_ROLE)) assert.equal(tokenOf(C[k]), t, `${k} = var(--${t})`);
  // every colour key is covered by a role above (widths are the spec's)
  const covered = new Set([...Object.values(SPEC_ROLE).flatMap(r => r[0]), ...Object.keys(PROSE_ROLE)]);
  assert.deepEqual(Object.keys(C).filter(k => !covered.has(k)).sort(), ['hw1', 'hw125']);
  // TEN-376: all borders 1px — the spec's 1.25px borders are 1px now (the key name is the spec's)
  assert.equal(C.hw1, '1px'); assert.equal(C.hw125, '1px', 'no 1.25px border (founder TEN-376: all edges 1px)');
  // D4 + foundation: no player colour is the link token or the fill blue as text
  for (const k of ['a', 'b']) assert.ok(!['link', 'bar', 'hot-dot', 'viz-lead'].includes(tokenOf(C[k])), `player ${k} is neutral`);
  for (const k of ['blue', 'sharp', 'caps', 'text', 'sub', 'label', 'label3', 'steamInk']) assert.notEqual(tokenOf(C[k]), 'bar', `${k}: blue is a fill, never text`);
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
  // foundation roles: the selected nav item is lift (--selected, white), idle items --text-label, hover --inner; the modal
  // box --page with --shadow-modal over the one scrim; hairlines --line; clickable rows hover --tile-hover + --edge-16
  const want = [
    ['.modal-analysis .asidenav-item.active', 'background', 'selected'], ['.modal-analysis .asidenav-item.active', 'color', 'text'],
    ['.modal-analysis', 'background', 'card'], ['.modal-analysis', 'box-shadow', 'shadow-modal'], ['#analysisModal', 'background', 'backdrop'],
    ['.modal-analysis .asidenav-item', 'color', 'text-label'], ['.modal-analysis .asidenav-item:hover', 'background', 'inner'],
    ['#aSectionOdds', 'color', 'text'], ['.modal-analysis .ahead2 .close', 'color', 'text-label'], ['.modal-analysis .asidenav-download', 'border-top-color', 'line'],
    ['.modal-analysis .asidenav-download', 'color', 'link'], ['.modal-analysis .apname', 'color', 'text'], ['.modal-analysis .apname.b', 'color', 'text-soft'],
    ['.aox-row:not(.aox-nodata):hover', 'background', 'tile-hover'], ['.aox-row:not(.aox-nodata):hover', 'border-color', 'edge-16'],
  ];
  for (const [sel, prop, t] of want) assert.equal(tokenOf(applied(HTML, sel, prop)), t, `${sel} ${prop}`);
  assert.equal(applied(HTML, '#analysisModal', 'backdrop-filter'), 'blur(3px)', 'the scrim blurs (U5)');
  const T = tokens('night'), D = tokens('day');
  assert.equal(resolve(applied(HTML, '.modal-analysis .asidenav-item.active', 'background')), fmt(rgba(T.selected)));
  assert.equal(resolve(applied(HTML, '.modal-analysis .asidenav-item.active', 'background'), 'day'), fmt(rgba(D.selected)), 'Day re-tones the selected tab');
  assert.notEqual(fmt(rgba(D.selected)), fmt(rgba(T.selected)));
  assert.equal(resolve(applied(HTML, '.modal-analysis', 'background')), fmt(rgba(T.card)));   // OFFICIAL VERSION 1: modal box = --card
  assert.equal(resolve(applied(HTML, '.modal-analysis', 'background'), 'day'), fmt(rgba(D.card)), 'Day re-tones the modal box');
  assert.equal(resolve(applied(HTML, '#aSectionOdds', 'color'), 'day'), resolve(applied(HTML, '#aSectionOdds', 'color')), 'text does not change with the theme');
  // the extract's type base, so the tab's boxes are the design's height (the modal inherits 14px / 1.5)
  assert.equal(applied(HTML, '#aSectionOdds', 'line-height'), 'normal');
  assert.equal(applied(HTML, '#aSectionOdds', 'font-size'), '16px');
  assert.ok(!HTML.includes('<style id="design-verbatim-analysis">'), 'the verbatim block is gone');
  // mutant: the old verbatim rule re-appended after the chrome block wins the cascade again
  const m = HTML.replace('</body>', '<style>.modal-analysis .asidenav-item.active{ background:#171D2F; }</style></body>');
  assert.notEqual(resolve(applied(m, '.modal-analysis .asidenav-item.active', 'background')), fmt(rgba(T.selected)), 'control');
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
  const mut = HTML.replace("  text: 'var(--text)',      // Text", "  text: '#E7E9EE',      // Text");
  assert.notEqual(mut, HTML, 'mutant anchor');
  assert.notEqual(constSrc('AODDS_C', text(mut)), constSrc('AODDS_C', mut), 'mutant survived: the engine left a literal AODDS_C alone');
});
