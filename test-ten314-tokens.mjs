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
// review 2026-09-29: + .aform- (formPanelHtml), .yr- (buildYearlyTables / seasonSurfaceTierViewHtml), .fsm- (fmtTournament)
const MODAL_SEL = /\.modal-analysis|#analysisModal|#aSection|#fhSheet|#mePop|#aoddsTip|\.aox-|\.wx-|\.fh-|\.me-|\.akb|\.aks-|\.akf-|\.akw-|\.psv|\.atourn|\.yr-(?:drill|table|tiertoggle|surfrec)|\.aform-tabs|\.fsm-q\b|\.ms-|\.anews|\.tprogress/;
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
  // `var(--ma-s-${…})` = a shade key filled in at runtime (MA_SEG, maMatchRowsHtml); those keys are checked below.
  const missing = [...used].filter(v => !NOT_COLOUR.has(v) && v !== '--ma-s-' && !(v in NIGHT));
  assert.deepEqual(missing, []);
  for (const [k, v] of Object.entries(NIGHT)) if (!k.startsWith('--ma-')) assert.match(v, /^var\(--ma-[\w-]+\)$/, `${k} re-points to a token`);
});

// Founder 2026-09-28: the modal's hairlines are the design's 1px, set in the token file. The modal writes
// var(--ma-hw,0.33px), so the shared builders keep the site's 0.33px outside .ma-theme (player profile).
// Mutation: --ma-hw back to 0.33px in the token file, or a bare `border:0.33px` back in a modal builder / modal CSS rule.
test('hairline width: --ma-hw is 1px, and no bare 0.33px in the modal code or CSS', () => {
  assert.equal(NIGHT['--ma-hw'], '1px');
  const bare = s => (s.replace(/var\(--ma-hw,0\.33px\)/g, '').match(/0\.33px/g) || []).length;
  const js = modalCode().filter(([, s]) => bare(s)).map(([n, s]) => n + ' ×' + bare(s));
  const css = modalCss().filter(([, b]) => bare(b)).map(([sel]) => sel.slice(0, 60));
  assert.deepEqual([...js, ...css], []);
  assert.ok(modalCode().some(([, s]) => s.includes('var(--ma-hw,0.33px)')), 'the modal reads the token');
});

// Founder 2026-09-29 (TEN-314 comment 1641c7ce): every design shade is its own token. The token NAME is the source
// value (--ma-s-<hex>[-<alpha x1000>][-fill|-ink]), so the fixture's source palette is read from the names.
// Mutation: delete one --ma-s-* line from the token file (e.g. --ma-s-06070a), or drop its Day override.
const DF = readFileSync(join(HERE, 'design/handoff-ten312-match-analysis/Match Analysis Progression v1.dc.html'), 'utf8');
function dfShades() {
  const out = new Set();
  for (const m of DF.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
    const pre = DF[m.index - 1] || '';
    let v = m[0].replace(/\s+/g, '').toLowerCase();
    if (v[0] === '#' && /[\w&-]/.test(pre)) continue;                          // ids, entities, anchors
    if (v[0] === '#') {
      let h = v.slice(1); if (h.length === 3) h = [...h].map(c => c + c).join(''); if (h.length !== 6) continue;
      out.add(h);
    } else {
      const p = /^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/.exec(v); if (!p) continue;  // template expressions
      const h = [p[1], p[2], p[3]].map(n => (+n).toString(16).padStart(2, '0')).join('');
      out.add(p[4] == null || +p[4] === 1 ? h : h + '-' + String(Math.round(+p[4] * 1000)).padStart(3, '0'));
    }
  }
  return out;
}
test('every design shade is its own token, with a Night value (and Day where it differs)', () => {
  const shades = dfShades();
  assert.ok(shades.size > 150, `read the design file's shades (${shades.size})`);
  const missing = [...shades].filter(k => !(('--ma-s-' + k) in NIGHT));
  assert.deepEqual(missing, [], 'a design shade without its own token');
  const surfaces = ['0a0d14', '0e1019', '0c0e16', '131623', '06070a'];
  for (const k of surfaces) assert.ok(('--ma-s-' + k) in DAY, `--ma-s-${k} re-tones in Day`);
  // role variants the README needs from one source value
  for (const v of ['--ma-s-5b9bff-fill', '--ma-s-6aaeff-fill', '--ma-s-06070a-ink']) assert.ok(v in NIGHT, v);
});

// The source diff re-points every --ma-s-* to its own name, so it cannot see a Night value. README §3 maps by ROLE:
// a shade drawn as a border, a fill or a surface keeps the approved Night of that role (review 2026-09-29).
// Mutation: MA_SEG me.sl back to '5b9bff-220' (the selected outline vanishes into the #222431 fill in Night), or
// --ma-s-11151f back to its offset value #20232E (README §6: the tooltip is the raised surface).
test('Night values follow the role README §3 gives the shade (border / fill / surface)', () => {
  const N = k => NIGHT['--ma-s-' + k];
  assert.equal(N('5b9bff-220-line'), 'rgba(157,179,242,0.30)', 'blue 0.22 as a border = the §3 outline');
  assert.notEqual(N('5b9bff-220-line'), N('5b9bff-160'), 'a selected border never equals its fill');
  assert.equal(N('ffffff-060-fill'), '#20222E', 'white 0.06 as a hover fill = §3 hover');
  assert.equal(N('ffffff-050-fill'), '#181922', 'white 0.05 as a fill = §3 inner box');
  assert.equal(N('11151f'), '#1B1C27', 'the tooltip = §3 raised surface');
  // the approved chrome Night values did not move
  assert.deepEqual([N('0a0d14'), N('5b9bff-120'), N('ffffff-040'), N('5b6880'), N('5b9bff')], ['#191B24', '#222431', '#20222E', '#A3AABE', '#9DB3F2']);
  const seg = HTML.slice(HTML.indexOf('\nconst MA_SEG = {'), HTML.indexOf('\n};', HTML.indexOf('\nconst MA_SEG = {')));
  for (const m of seg.matchAll(/\bsl: '([\w-]+)'/g)) assert.notEqual(N(m[1]), '#222431', `MA_SEG selected border ${m[1]} must not resolve to the fill`);
});

// The runtime shade keys (MA_SEG's track / selected colours, maMatchRowsHtml's S('…')) are real tokens.
// Mutation: a typo in a key (e.g. MA_SEG sheet tb '06070b').
test('every runtime shade key in the shared helpers names a token', () => {
  const seg = HTML.slice(HTML.indexOf('\nconst MA_SEG = {'), HTML.indexOf('\n};', HTML.indexOf('\nconst MA_SEG = {')));
  const keys = [...seg.matchAll(/\b(?:tb|tl|sb|sl): '([\w-]+)'/g)].map(m => m[1]);
  assert.equal(keys.length, 16, 'four geometries × track fill/line + selected fill/line');
  const rows = HTML.slice(HTML.indexOf('\nfunction maMatchRowsHtml('), HTML.indexOf('\n}\n', HTML.indexOf('\nfunction maMatchRowsHtml(')));
  const rk = [...rows.matchAll(/\bS\('([\w-]+)'/g)].map(m => m[1]);
  assert.ok(rk.length >= 10, 'the rows read their shades');
  const bad = [...keys, ...rk].filter(k => !(('--ma-s-' + k) in NIGHT));
  assert.deepEqual(bad, []);
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
