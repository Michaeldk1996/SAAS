// TEN-314 (TEN-312 D1, founder 2026-09-28): the Match analysis modal is coloured ONLY through
// match-analysis-tokens.css — Night 24b / Day 26f from the handoff README §3 plus the approved U1–U24 mappings.
// Every check names the mutation that turns it red; tools/test-ten314-mutants.js applies each one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(process.env.TEN314_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const CSS = readFileSync(process.env.TEN314_CSS || join(HERE, 'match-analysis-tokens.css'), 'utf8');
const README = readFileSync(join(HERE, 'design/handoff-ten312-match-analysis/README.md'), 'utf8');
const YML = readFileSync(join(HERE, '.github/workflows/pipeline.yml'), 'utf8');

// The declarations of one CSS block (selector text exactly as written), as a map.
function block(sel) {
  const at = CSS.indexOf(sel + '{'); assert.ok(at >= 0, `block ${sel}`);
  const body = CSS.slice(at + sel.length + 1, CSS.indexOf('\n}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
  const out = {};
  for (const d of body.split(';')) { const k = d.slice(0, d.indexOf(':')).trim(); if (k.startsWith('--')) out[k] = d.slice(d.indexOf(':') + 1).trim(); }
  return out;
}
const NIGHT = block('.ma-theme'), DAY = block('.ma-theme[data-ma-theme="day"]');

// Mutation: change any README §3 value in the token file (e.g. --ma-card #14151D → #14151E), or swap Night and Day.
test('the token file carries the README §3 table: Night 24b by default, Day 26f on data-ma-theme=day', () => {
  const rows = {};   // role → [night, day] from README §3's table
  for (const l of README.slice(README.indexOf('## 3 · Theme'), README.indexOf('Rules: blue is structure')).split('\n')) {
    const c = l.split('|').map(x => x.trim()); if (c.length < 5) continue;
    rows[c[1]] = [c[3].replace(/`/g, ''), c[4].replace(/`/g, '')];
  }
  const want = { '--ma-page': 'Page', '--ma-card': 'Card / header / stat box', '--ma-inner': 'Inner box (nested in a card)',
    '--ma-raised': 'Raised / pop-up surface', '--ma-hover': 'Hover fill', '--ma-t1': 'Text primary', '--ma-t2': 'Text secondary',
    '--ma-t3': 'Labels / captions / dim', '--ma-fill': 'Bars, fills, chart lines, today dot', '--ma-link': 'Links, accent text, current-set, TODAY tag',
    '--ma-pos': 'Positive / W / live dot', '--ma-neg': 'Negative / L', '--ma-cta': 'Pro / CTA button' };
  for (const [tok, role] of Object.entries(want)) {
    assert.ok(rows[role], `README row ${role}`);
    const [n, d] = rows[role];
    assert.equal(NIGHT[tok].toUpperCase(), n.toUpperCase(), `${tok} Night`);
    const dv = /^same/i.test(d) ? n : d;
    assert.equal((DAY[tok] || NIGHT[tok]).toUpperCase(), dv.toUpperCase(), `${tok} Day`);
  }
  assert.equal(NIGHT['--ma-sel'].toUpperCase(), '#222431'); assert.equal(DAY['--ma-sel'].toUpperCase(), '#292B3A');   // "+ white text" rows
  assert.equal(NIGHT['--ma-hair'], 'rgba(255,255,255,0.05)'); assert.equal(NIGHT['--ma-hair-soft'], 'rgba(255,255,255,0.035)');
  assert.equal(NIGHT['--ma-hair-strong'], 'rgba(255,255,255,0.10)'); assert.equal(NIGHT['--ma-outline'], 'rgba(157,179,242,0.30)');
  assert.equal(NIGHT['--ma-amber'].toUpperCase(), '#E8A84E');
  assert.match(CSS, /@media \(prefers-color-scheme: light\)\{\s*\.ma-theme\[data-ma-theme="auto"\]\{[^}]*--ma-page:#1E202B/, 'Auto follows the OS');
});

// Mutation: change a U-value (e.g. --ma-link-hover) — the approved provisional mapping (TEN-314 phase1-token-mappings).
test('the unmapped source values use the approved U1–U24 mappings', () => {
  const U = { '--ma-link-hover': '#B5C6F5', '--ma-on-fill': '#06070A', '--ma-t-dis': 'rgba(163,170,190,0.55)', '--ma-focus': 'rgba(157,179,242,0.35)',
    '--ma-hair-hover': 'rgba(255,255,255,0.20)', '--ma-pb-fill': 'rgba(255,255,255,0.70)', '--ma-track': 'rgba(255,255,255,0.08)',
    '--ma-track-loss': 'rgba(255,255,255,0.25)', '--ma-scrim': 'rgba(4,5,8,0.72)', '--ma-chart-zero': 'rgba(255,255,255,0.40)',
    '--ma-chart-grid': 'rgba(255,255,255,0.055)', '--ma-zebra': 'rgba(255,255,255,0.022)' };
  for (const [k, v] of Object.entries(U)) assert.equal(NIGHT[k], v, k);
});

// ---- the modal's code: every declaration reachable from the modal's entry points ----
function modalCode() {
  const lines = HTML.split('\n'), starts = [];
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
const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
function literalsIn(name, src) {
  const out = [];
  for (const m of src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1').matchAll(COLOUR)) {
    const pre = src[m.index - 1] || '';
    if (m[0][0] === '#' && /[\w&-]/.test(pre)) continue;           // ids, entities, anchors
    out.push(name + ': ' + m[0]);
  }
  return out;
}

// Mutation: a literal back in a modal builder (e.g. `'#ebf1f2'` in fhSheetRowHtml, `#6AAEFF` in AODDS_C).
test('no literal colour in any declaration the modal reaches (JS)', () => {
  const code = modalCode();
  assert.ok(code.length > 300, `walked the modal (${code.length} declarations)`);
  const hits = code.flatMap(([n, s]) => literalsIn(n, s));
  assert.deepEqual(hits, []);
});

// The modal's CSS: every rule whose selector targets the modal.
const MODAL_SEL = /\.modal-analysis|#analysisModal|#aSection|#fhSheet|#mePop|#aoddsTip|\.aox-|\.wx-|\.fh-|\.me-|\.akb|\.aks-|\.akf-|\.akw-|\.psv|\.atourn|\.yr-drill|\.ms-|\.anews|\.tprogress/;
function modalCss() {
  const css = [...HTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (MODAL_SEL.test(m[1])) rules.push([m[1].trim(), m[2]]);
  return rules;
}
// Mutation: a hex in a modal CSS rule (e.g. `.modal-analysis .alivebar{ background:#3A2015 }` left as is).
test('no literal colour in any CSS rule that targets the modal', () => {
  const rules = modalCss();
  assert.ok(rules.length > 50, `found the modal's rules (${rules.length})`);
  const hits = rules.flatMap(([sel, body]) => (body.match(COLOUR) || []).map(v => sel.slice(0, 60) + ' → ' + v));
  assert.deepEqual(hits, []);
  assert.ok(!HTML.includes('id="design-verbatim-analysis"'), 'the TEN-303 verbatim block is gone');
});

// Mutation: drop a 12a re-point from the token file (e.g. `--label:var(--ma-t3);`) — every var(--label) in the
// modal would then keep the 12a grey instead of the 24b/26f token.
test('every colour variable the modal reads resolves through the token file', () => {
  const code = modalCode().map(([, s]) => s).join('\n') + modalCss().map(([, b]) => b).join('\n');
  const used = new Set([...code.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]));
  const NOT_COLOUR = new Set(['--mx-font-ui', '--mx-font-mono', '--radius', '--sf-font-mono', '--sf-font-ui']);
  const missing = [...used].filter(v => !NOT_COLOUR.has(v) && !(v in NIGHT));
  assert.deepEqual(missing, []);
  for (const [k, v] of Object.entries(NIGHT)) if (!k.startsWith('--ma-')) assert.match(v, /^var\(--ma-[\w-]+\)$/, `${k} re-points to a token`);
});

// Mutation: maApplyTheme stops writing the attribute, or maSetTheme writes a different storage key than TEN-315 reads.
test('the Night / Day / Auto switch re-themes every .ma-theme element live, from ONE storage key', () => {
  const slice = n => { const s = HTML.indexOf(`\nfunction ${n}(`); let d = 0, i = HTML.indexOf('{', s); for (; i < HTML.length; i++) { if (HTML[i] === '{') d++; else if (HTML[i] === '}' && --d === 0) break; } return HTML.slice(s, i + 1); };
  const store = {}, els = [{ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }, { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }];
  const api = new Function('localStorage', 'document', `${HTML.slice(HTML.indexOf('\nconst MA_THEME_KEY'), HTML.indexOf('\n', HTML.indexOf('\nconst MA_THEME_KEY') + 1))}
    ${slice('maThemeMode')} ${slice('maApplyTheme')} ${slice('maSetTheme')} return { maSetTheme, maThemeMode, MA_THEME_KEY };`)(
    { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } }, { querySelectorAll: s => (s === '.ma-theme' ? els : []) });
  assert.equal(api.MA_THEME_KEY, 'stennisfy-theme');
  assert.equal(api.maThemeMode(), 'night', 'Night until the site-wide switch ships');
  api.maSetTheme('day'); assert.deepEqual(els.map(e => e.attrs['data-ma-theme']), ['day', 'day']);
  api.maSetTheme('auto'); assert.deepEqual(els.map(e => e.attrs['data-ma-theme']), ['auto', 'auto']);
  api.maSetTheme('bogus'); assert.equal(store['stennisfy-theme'], 'night');
  assert.match(HTML, /<div class="modal-overlay ma-theme" id="analysisModal" data-ma-theme="night">/);
  assert.match(slice('openAnalysisModal'), /maApplyTheme\(\);/);
});

// Mutation: drop the <link>, the pipeline cp, or its completeness assert (a new file left out of the literal cp list
// 404s live while every test passes).
test('the token file ships: linked from the page, copied and asserted by the deploy', () => {
  assert.match(HTML, /<link rel="stylesheet" href="\.\/match-analysis-tokens\.css">/);
  assert.match(YML, /\n\s+cp match-analysis-tokens\.css _site\/\n/);
  assert.match(YML, /series\.js series\.css match-analysis-tokens\.css \\\n/);
});
