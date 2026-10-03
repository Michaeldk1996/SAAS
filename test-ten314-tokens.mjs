// TEN-314 (TEN-312 D1, founder 2026-09-28) → TEN-376 Foundation (founder, locked 2026-10-03): the Match analysis modal
// is coloured ONLY through the site's one token file, tokens.css (.claude/rules/foundation.md). The modal's own token
// file (match-analysis-tokens.css: Night 24b / Day 26f, the U1–U24 mappings, one --ma-s-<hex> token per design shade,
// data-ma-theme) was deleted by design; the checks that pinned its values are replaced by the foundation equivalents:
// the token values, "Day changes only surfaces", "the modal takes no colour except tokens.css tokens", 1px hairlines,
// the darker-track segmented control, and the ONE theme attribute (theme.js → data-theme on <html>).
// Every check names the mutation that turns it red; tools/test-ten314-mutants.js applies each one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(process.env.TEN314_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const CSS = readFileSync(process.env.TEN314_CSS || join(HERE, 'tokens.css'), 'utf8');
const THEME_JS = readFileSync(process.env.TEN314_THEME || join(HERE, 'theme.js'), 'utf8');
const RULES = readFileSync(join(HERE, '.claude/rules/foundation.md'), 'utf8');
const YML = readFileSync(join(HERE, '.github/workflows/pipeline.yml'), 'utf8');

// The custom properties of one tokens.css block (selector text exactly as written, up to its `{`), as a map.
function block(sel) {
  const at = CSS.indexOf(sel + ' {'); assert.ok(at >= 0, `block ${sel}`);
  const body = CSS.slice(at + sel.length + 2, CSS.indexOf('\n}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const NIGHT_SURF = block(':root,\n[data-theme="night"]'), DAY = block('[data-theme="day"]'), SHARED = block('\n:root');
const NIGHT = Object.assign({}, NIGHT_SURF, SHARED);
const TOKENS = new Set(Object.keys(NIGHT));
const norm = v => { let s = String(v).replace(/\s+/g, '').toUpperCase(); if (/^#[0-9A-F]{3}$/.test(s)) s = '#' + [...s.slice(1)].map(c => c + c).join(''); return s; };

// Mutation: drift a foundation value in tokens.css (e.g. --text-soft #DDE0EA → #DDE0EB), or move a text / meaning token
// into the Day block (founder Q2: only surfaces change between themes).
test('tokens.css: the foundation values; Night is the default, Day re-tones ONLY the surfaces', () => {
  // the values foundation.md quotes for a token (`--text` #FFF, `--text-soft` #DDE0EA, `--link` #6A9AF8, `--backdrop` rgba(3,5,9,0.72) …)
  const quoted = [...RULES.matchAll(/`(--[\w-]+)`\s+(#[0-9A-Fa-f]{3,6}\b|rgba\([^)]*\))/g)].map(m => [m[1], m[2]]);
  assert.ok(quoted.length >= 5, `read the rule file's token values (${quoted.length})`);
  for (const [k, v] of quoted) assert.equal(norm(NIGHT[k]), norm(v), `${k} = foundation.md ${v}`);
  // "Blue `#007AFF` is a fill, never text" — the one fill blue is --bar (and the lead data-viz series)
  const blue = /Blue `(#[0-9A-Fa-f]{6})` is a fill/.exec(RULES); assert.ok(blue, 'foundation.md names the fill blue');
  assert.equal(norm(NIGHT['--bar']), norm(blue[1])); assert.equal(norm(NIGHT['--viz-lead']), norm(blue[1]));
  assert.notEqual(norm(NIGHT['--link']), norm(blue[1]), 'link text is not the fill blue');
  // Day: exactly the surface tokens foundation.md lists, each a different tone from Night
  const surf = /Only surfaces change\*\* between themes \(([^)]*)\)/.exec(RULES.replace(/\s+/g, ' '));
  assert.ok(surf, 'foundation.md lists the surface tokens');
  const want = surf[1].match(/--[\w-]+/g);
  assert.deepEqual(Object.keys(DAY).sort(), want.slice().sort(), 'the Day block sets the surfaces and nothing else');
  assert.deepEqual(Object.keys(NIGHT_SURF).sort(), want.slice().sort(), 'the Night surface block holds the same names');
  for (const k of want) assert.notEqual(norm(DAY[k]), norm(NIGHT_SURF[k]), `${k} changes with the theme`);
  for (const k of Object.keys(SHARED)) assert.ok(!(k in DAY), `${k} is identical in Night and Day`);
  // layer rule: page < card < inner < selected (each surface lighter than the one under it), in both themes
  const lum = v => { const h = norm(v); return parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16); };
  for (const T of [NIGHT_SURF, DAY]) {
    const L = ['--page', '--card', '--inner', '--selected'].map(k => lum(T[k]));
    assert.ok(L.every((x, i) => !i || x > L[i - 1]), `page < card < inner < selected (${L})`);
  }
});

// ---- the modal's code: every declaration reachable from the modal's entry points ----
function modalCode(src = HTML) {
  const lines = src.split('\n'), starts = [];
  let inScript = false;
  lines.forEach((l, i) => {
    if (/<script(?![^>]*src)[^>]*>/.test(l)) inScript = true;
    if (l.includes('</script>')) inScript = false;
    const m = inScript && /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(l);
    if (m) starts.push([m[1] || m[2], i]);
  });
  const by = new Map();
  starts.forEach(([n, s], k) => { const e = k + 1 < starts.length ? starts[k + 1][1] : lines.length; if (!by.has(n)) by.set(n, []); by.get(n).push(lines.slice(s, e).join('\n')); });
  // Not the modal: other surfaces it can open (player profile, Edge Model, the embedded Database) and shared loaders.
  const EXCL = new Set(['openPlayerProfileFromMatch', 'showPlayerProfile', 'openEdgeModelFromMatch', 'openEdgeModel', 'render',
    'loadPointsAtRisk', 'renderNews', 'loadAsapSignals', '_mcNowPair']);
  const seen = new Set(['openAnalysisModal', 'A_TAB_BUILD', 'A_TAB_REVISIT', 'aShowTab', 'aBuildForReport', 'printAnalysisReport']), q = [...seen];
  while (q.length) {
    const n = q.shift();
    for (const b of by.get(n) || []) for (const t of new Set(b.match(/[A-Za-z_$][\w$]*/g) || [])) if (by.has(t) && !seen.has(t) && !EXCL.has(t)) { seen.add(t); q.push(t); }
  }
  return [...seen].map(n => [n, (by.get(n) || []).join('\n')]);
}
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
function literalsIn(name, src) {
  const s = stripComments(src), out = [];
  for (const m of s.matchAll(COLOUR)) {
    if (m[0][0] === '#' && /[\w&-]/.test(s[m.index - 1] || '')) continue;           // ids, entities, anchors
    out.push(name + ': ' + m[0]);
  }
  return out;
}

// Mutation: a literal back in a modal builder (e.g. MA_GREY = '#A3AABE', `#6AAEFF` in AODDS_C).
test('no literal colour in any declaration the modal reaches (JS)', () => {
  const code = modalCode();
  assert.ok(code.length > 300, `walked the modal (${code.length} declarations)`);
  const hits = code.flatMap(([n, s]) => literalsIn(n, s));
  assert.deepEqual(hits, []);
});

// The modal's CSS: every rule whose selector targets the modal.
// review 2026-09-29: + .aform- (formPanelHtml), .yr-drill (the player profile's career drill; TEN-334 rebuilt the Overview inline, #aSectionOverview / #ovPop), .fsm- (fmtTournament)
const MODAL_SEL = /\.modal-analysis|#analysisModal|#aSection|#fhSheet|#mePop|#aoddsTip|\.aox-|\.wx-|\.fh-|\.me-|\.akb|\.aks-|\.akf-|\.akw-|\.psv|\.atourn|\.yr-drill|#ovPop|\.aform-tabs|\.fsm-q\b|\.ms-|\.anews|\.tprogress/;
const pageCss = () => [...HTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
function modalCss() {
  const rules = [];
  for (const m of pageCss().matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (MODAL_SEL.test(m[1])) rules.push([m[1].trim(), m[2]]);
  return rules;
}
// Mutation: a hex in a modal CSS rule (e.g. `.modal-analysis .apname{ color:#FFFFFF; }`).
test('no literal colour in any CSS rule that targets the modal', () => {
  const rules = modalCss();
  assert.ok(rules.length > 50, `found the modal's rules (${rules.length})`);
  const hits = rules.flatMap(([sel, body]) => (body.match(COLOUR) || []).map(v => sel.slice(0, 60) + ' → ' + v));
  assert.deepEqual(hits, []);
  assert.ok(!HTML.includes('id="design-verbatim-analysis"'), 'the TEN-303 verbatim block is gone');
});

// Replaces "every --ma-* variable resolves through match-analysis-tokens.css": the modal reads tokens.css tokens, or a
// page alias (`--fh-pa: var(--text)`) that is itself only tokens. Mutation: a var() the token file does not set
// (e.g. `.modal-analysis .apname{ color:var(--periwinkle); }`), or an --ma-* name back in the page.
test('every colour variable the modal reads is a tokens.css token (directly or through a token-only page alias)', () => {
  const code = modalCode().map(([, s]) => s).join('\n') + modalCss().map(([, b]) => b).join('\n');
  const used = new Set([...code.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]));
  assert.ok(used.size > 20, `the modal reads tokens (${used.size})`);
  const NOT_COLOUR = new Set(['--mx-font-ui', '--mx-font-mono', '--radius', '--sf-font-mono', '--sf-font-ui']);
  const defs = {};
  for (const m of pageCss().matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) (defs[m[1]] ||= new Set()).add(m[2].trim());
  const resolves = (v, depth = 0) => {
    if (TOKENS.has(v)) return true;
    if (depth > 8 || !defs[v]) return false;
    return [...defs[v]].every(d => !d.match(COLOUR) && /var\(\s*--/.test(d)
      && [...d.matchAll(/var\(\s*(--[\w-]+)/g)].every(x => resolves(x[1], depth + 1)));
  };
  const missing = [...used].filter(v => !NOT_COLOUR.has(v) && !resolves(v));
  assert.deepEqual(missing, []);
  assert.deepEqual([...new Set(stripComments(HTML).match(/--ma-[\w-]+/g) || [])], [], 'no --ma-* token left in the page');
  assert.ok(!/data-ma-theme/.test(HTML), 'the modal\'s own theme attribute is gone');
});

// Founder TEN-376: all borders 1px — no 0.33px hairline (the old --ma-hw / 12a width) and no 1.25px (the design file's
// card border). Mutation: a bare 0.33px or 1.25px back in a modal builder / modal CSS rule.
test('hairline width: no 0.33px and no 1.25px in the modal code or CSS (all borders 1px)', () => {
  const bad = s => (stripComments(s).match(/\b0\.33px|\b1\.25px/g) || []).length;
  const js = modalCode().filter(([, s]) => bad(s)).map(([n, s]) => n + ' ×' + bad(s));
  const css = modalCss().filter(([, b]) => bad(b)).map(([sel]) => sel.slice(0, 60));
  assert.deepEqual([...js, ...css], []);
  assert.ok(modalCode().some(([, s]) => /border:1px solid var\(--/.test(s)), 'the modal draws 1px token borders');
});

// Replaces the per-geometry design-shade checks (MA_SEG's --ma-s-<hex> keys): every segmented control is the foundation
// darker track (README §5.1): track --card + --edge-6, selected --inner + --edge-10. The intent of the old "a selected
// border never equals its fill" check stays. Mutation: MA_SEG's selected border folded into its fill, or a track key
// typo'd to a token tokens.css does not set.
test('MA_SEG: every geometry is the darker track, and the selected edge never equals the selected fill', () => {
  const seg = HTML.slice(HTML.indexOf('\nconst MA_SEG = {'), HTML.indexOf('\n};', HTML.indexOf('\nconst MA_SEG = {')));
  const geo = [...seg.matchAll(/\n  (\w+): \{[^\n]*\btb: '([^']+)', tl: '([^']+)', sb: '([^']+)', sl: '([^']+)'/g)];
  assert.equal(geo.length, 5, 'five geometries (TEN-334: + ov)');
  for (const [, g, tb, tl, sb, sl] of geo) {
    assert.deepEqual([tb, tl, sb, sl], ['var(--card)', 'var(--edge-6)', 'var(--inner)', 'var(--edge-10)'], `${g}: track --card/--edge-6, selected --inner/--edge-10`);
    assert.notEqual(sl, sb, `${g}: the selected border must not resolve to the fill`);
  }
  const rows = HTML.slice(HTML.indexOf('\nfunction maMatchRowsHtml('), HTML.indexOf('\n}\n', HTML.indexOf('\nfunction maMatchRowsHtml(')));
  const rk = [...rows.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]);
  assert.ok(rk.length >= 10, 'the rows read their tokens');
  assert.deepEqual(rk.filter(k => !TOKENS.has(k)), [], 'every match-row colour is a tokens.css token');
});

// Replaces the modal's own Night / Day / Auto switch (data-ma-theme on .ma-theme): the modal follows the ONE site theme.
// theme.js is executed with a fake document / storage / OS; the modal's maSetTheme / maThemeMode / maApplyTheme are sliced
// from the page and must drive it. Mutation: maSetTheme stops delegating to window.sfTheme, or theme.js writes another key.
test('the Night / Day / Auto switch: the modal delegates to theme.js — one attribute on <html>, one storage key', () => {
  const slice = n => { const s = HTML.indexOf(`\nfunction ${n}(`); assert.ok(s > 0, n); return HTML.slice(s, HTML.indexOf('\n', s + 1)); };
  const store = {}, attrs = {};
  let osLight = false;
  const mq = { get matches() { return osLight; }, addEventListener() {} };
  const window = { matchMedia: () => mq, addEventListener() {}, dispatchEvent() {} };
  const document = { documentElement: { getAttribute: k => attrs[k] ?? null, setAttribute: (k, v) => { attrs[k] = v; } },
    readyState: 'complete', querySelectorAll: () => [], addEventListener() {} };
  const localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  new Function('window', 'document', 'localStorage', 'CustomEvent', THEME_JS)(window, document, localStorage, function () {});
  const api = new Function('window', `${slice('maThemeMode')}\n${slice('maApplyTheme')}\n${slice('maSetTheme')}\nreturn { maSetTheme, maThemeMode, maApplyTheme };`)(window);
  assert.equal(attrs['data-theme'], 'night', 'Night is the default, set before first paint');
  assert.equal(api.maThemeMode(), 'night');
  api.maSetTheme('day'); assert.deepEqual([attrs['data-theme'], store['stennisfy-theme'], api.maThemeMode()], ['day', 'day', 'day']);
  osLight = false; api.maSetTheme('auto'); assert.deepEqual([attrs['data-theme'], store['stennisfy-theme']], ['night', 'auto'], 'Auto + dark OS = night');
  osLight = true; api.maApplyTheme(); assert.equal(attrs['data-theme'], 'day', 'Auto + light OS = day');
  api.maSetTheme('bogus'); assert.deepEqual([store['stennisfy-theme'], attrs['data-theme']], ['night', 'night']);
  assert.deepEqual(Object.keys(store), ['stennisfy-theme'], 'one storage key');
  assert.match(HTML, /<div class="modal-overlay ma-theme" id="analysisModal">/);
  const open = HTML.slice(HTML.indexOf('\nfunction openAnalysisModal('), HTML.indexOf('\n}\n', HTML.indexOf('\nfunction openAnalysisModal(')));
  assert.match(open, /maApplyTheme\(\);/);
});

// Mutation: drop the <link> / the theme.js <script> (or put them after other stylesheets), or the pipeline cp / its
// completeness list (a new file left out of the literal cp list 404s live while every test passes).
test('the token file ships: theme.js then tokens.css first in <head>, copied and asserted by the deploy', () => {
  const head = HTML.slice(0, HTML.indexOf('</head>'));
  const js = head.indexOf('<script src="./theme.js"></script>'), css = head.indexOf('<link rel="stylesheet" href="./tokens.css">');
  assert.ok(js > 0 && css > js, 'theme.js, then tokens.css');
  const firstOther = head.search(/<link rel="stylesheet" href="(?!\.\/tokens\.css)|<style/);
  assert.ok(firstOther < 0 || css < firstOther, 'tokens.css before any other stylesheet');
  assert.match(YML, /\n\s+cp tokens\.css theme\.js _site\/\n/);
  assert.match(YML, /series\.js series\.css tokens\.css theme\.js \\\n/);
});
