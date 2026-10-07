// TEN-399 (step 6 · Database redesign), group a: frame + Tour + charts.
//
// Rulings locked here, each as a test someone can apply:
//   SELECT    no native <select> anywhere in the Database bar, the year range included:
//             the Tour bar, rendered with each menu open in turn, creates no <select> and
//             never calls the site sfDd; the year ends are the bar's own triggers.
//   CARET     the five Tour drop-downs (Level · Surface · Round · year from · year to) share
//             ONE ▼: each trigger ends with the same DB_CARET element, the bar paints exactly
//             five carets, and exactly one CSS rule styles .db-caret.
//   BANDS     Tour, on the published archive: the three band counts sum to the All row on
//             each side; All yield = total profit / matches (match-weighted, 2 dp); All median
//             = the pooled median; All From / To filled (Favourites 1.01 / <Slight Fav To>,
//             Underdogs <Slight Dog From> / <same>+); Super Dog To = "<its From>+" (D1); no
//             "Back the shorter / longer price" copy.
//   SEAM      the profit chart draws no book seam (no seam line, no Bet365 pill, no
//             "book artefact" footnote), no area fill, no loss wash, no vertical gridline;
//             guides dotted 2 6, break-even 1.25px, lead 2.4px / second 2px; plot 340px.
//   CSS       Reset white; triggers --inner, no edge; menus = compact site menu; pill groups
//             = darker track, disabled 40% grey; column heads on a 10% rule; All row on a
//             14% 2px rule; band panels card + 6% edge; no blue-dot book line on Tour.
//
// Method (as test-ten262.mjs): SLICE the shipped functions out of the page and EXECUTE them
// under a small DOM shim; every check is re-run against a mutant that must fail it.
//
// Run: node --test test-ten399-database-frame.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const STORE = join(HERE, 'database-yield.json');
const HAVE = existsSync(STORE);

function fnSource(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function ' + name + ' is gone — this lock points at nothing');
  const nl = src.indexOf('\n', i);
  const oneLine = src.slice(i, nl < 0 ? src.length : nl);
  if ((oneLine.match(/\{/g) || []).length === (oneLine.match(/\}/g) || []).length && oneLine.trimEnd().endsWith('}')) return oneLine;
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces slicing ' + name);
}
// `var NAME=...;` on one line (the module's constants).
function varLine(src, name) {
  const m = new RegExp('\\n\\s*(var ' + name + '\\s*=[^\\n]*;)').exec(src);
  if (!m) throw new Error('var ' + name + ' is gone');
  return m[1];
}
// One CSS rule body by its exact selector text (first match).
function cssRule(src, sel) {
  const i = src.indexOf('\n  ' + sel + '{');
  if (i < 0) return null;
  return src.slice(src.indexOf('{', i) + 1, src.indexOf('}', i));
}

// ---- DOM shim ------------------------------------------------------------
function makeDoc() {
  const made = [];
  const mk = (tag) => {
    const n = {
      tagName: String(tag).toUpperCase(), className: '', title: '', type: '', value: '', placeholder: '', disabled: false,
      _html: '', children: [], attrs: {}, style: { setProperty(k, v) { this[k] = v; } },
      get classList() { const e = this; return {
        add(c) { if (!e.className.split(/\s+/).includes(c)) e.className = (e.className + ' ' + c).trim(); },
        remove(c) { e.className = e.className.split(/\s+/).filter(x => x !== c).join(' '); },
        contains(c) { return e.className.split(/\s+/).includes(c); },
        toggle(c, on) { if (on) this.add(c); else this.remove(c); } }; },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      appendChild(c) { this.children.push(c); return c; },
      set innerHTML(v) { this._html = String(v); this.children = []; }, get innerHTML() { return this._html; },
      set textContent(v) { this._html = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;'); this.children = []; },
      get textContent() { return this._html.replace(/<[^>]*>/g, '') + this.children.map(c => c.textContent).join(''); },
      get childNodes() { return this.children; },
      querySelector() { return null; },
      all() { const out = []; const w = e => { for (const c of e.children) { out.push(c); w(c); } }; w(this); return out; },
      html() { return this._html + this.children.map(c => c.html()).join(''); },
    };
    made.push(n); return n;
  };
  return { createElement: mk, made };
}
const has = (n, c) => (n.className || '').split(/\s+/).includes(c);

// ---- the Tour control bar, executed --------------------------------------
const BAR_FNS = ['el', 'esc', 'yr', 'trigger', 'foldedOpts', 'allOpts', 'tourLevelOpts', 'roundOpts', 'orderedOpts',
  'multiMenu', 'singleMenu', 'presentYears', 'yearControl', 'countOf', 'resetFilters', 'renderFilters'];
const BAR_VARS = ['DB_CARET', 'ROUND_ORDER', 'LEVELS_EXPECTED', 'FOLDED_LEVELS', 'ROUNDS_EXPECTED', 'FOLDED_ROUNDS'];
function renderTourBar(src, menu) {
  const code = BAR_VARS.map(v => varLine(src, v)).join('\n') + '\nvar _foldWarned={}; var lastTotal=0;\n' +
    BAR_FNS.map(f => fnSource(src, f)).join('\n') + '\nrenderFilters();';
  const doc = makeDoc(), bar = doc.createElement('div');
  const M = { levels: ['Grand Slam', 'Masters 1000', 'ATP 500', 'ATP 250', 'Finals'], surfaces: ['Hard', 'Clay', 'Grass'],
    rounds: ['1st Round', '2nd Round', 'Quarterfinals', 'Semifinals', 'The Final', '3rd Round', '4th Round', 'Round Robin'] };
  const DATA = { rows: [[20100104], [20180601], [20260913]] };
  const state = { view: 'tour', levels: null, surfaces: null, rounds: null, yearMin: null, yearMax: null, menu, menuQ: '' };
  let sfDd = 0;
  new Function('document', 'q', 'qsel', 'state', 'M', 'DATA', 'I', 'render', 'setTimeout', 'sfDdRender', 'console', code)(
    doc, k => (k === 'filters' ? bar : null), () => null, state, M, DATA, {}, () => {}, () => {}, () => { sfDd++; }, { warn() {} });
  return { bar, doc, sfDd };
}

const CHECKS = {};
const MUTANTS = {};

CHECKS.select = (src) => {
  for (const menu of [null, 'level', 'surface', 'round', 'y0', 'y1']) {
    const { doc, sfDd, bar } = renderTourBar(src, menu);
    const sel = doc.made.filter(n => n.tagName === 'SELECT');
    if (sel.length) return `menu ${menu}: ${sel.length} native <select> created`;
    if (/<select/i.test(bar.html())) return `menu ${menu}: <select> markup in the bar`;
    if (sfDd) return `menu ${menu}: the year range still renders through the site sfDd`;
    if (menu === 'y0' || menu === 'y1') {
      const m = bar.all().find(n => has(n, 'db-menu'));
      if (!m || !has(m, 'year')) return `menu ${menu}: no custom year menu opened`;
      const rows = m.all().filter(n => has(n, 'db-mrow'));
      if (rows.map(r => r.textContent.replace('✓', '')).join(',') !== '2010,2018,2026') return `menu ${menu}: year rows ${rows.map(r => r.textContent)}`;
    }
  }
  return null;
};
MUTANTS.select = s => s.replace("    function end(key, val, onPick){\n", "    function end(key, val, onPick){ document.createElement('select');\n");

CHECKS.caret = (src) => {
  const caret = (/var DB_CARET='([^']*)';/.exec(src) || [])[1];
  if (!caret || (caret.match(/▼/g) || []).length !== 1) return 'DB_CARET is not one ▼ element: ' + caret;
  const { bar } = renderTourBar(src, null);
  const trigs = bar.all().filter(n => n.tagName === 'BUTTON' && has(n, 'db-trig'));
  if (trigs.length !== 5) return `the Tour bar has ${trigs.length} drop-down triggers, not 5`;
  const bad = trigs.filter(t => !t.innerHTML.endsWith(caret));
  if (bad.length) return `${bad.length} trigger(s) do not end with the shared caret: ${bad.map(t => t.innerHTML).join(' | ')}`;
  const n = (bar.html().match(/▼/g) || []).length;
  if (n !== 5) return `the bar paints ${n} ▼, not 5`;
  // one CSS rule styles the caret: no per-trigger size / colour override
  const rules = [...src.matchAll(/\n\s*([^{}\n]*db-caret[^{}\n]*)\{/g)].map(m => m[1].trim());
  if (rules.length !== 1 || rules[0] !== '.db-caret') return 'the caret is styled by more than one rule: ' + JSON.stringify(rules);
  if (!/font-size:9px/.test(cssRule(src, '.db-caret')) || !/color:var\(--text-label\)/.test(cssRule(src, '.db-caret'))) return 'caret is not 9px --text-label';
  return null;
};
// the pre-TEN-399 year range: its own chevron (the sfDd glyph), not the bar's caret
MUTANTS.caret = s => s.replace("      (clear && active ? '<span class=\"db-clear\" title=\"Clear\">×</span>' : '')+DB_CARET;",
  "      (clear && active ? '<span class=\"db-clear\" title=\"Clear\">×</span>' : '')+(label ? DB_CARET : '<span class=\"sf-dd-chev\">▼</span>');");

// ---- Tour bands, executed on the published archive -------------------------
function paintTour(src) {
  const j = JSON.parse(readFileSync(STORE, 'utf8'));
  const code = 'var DB_DOG_OPEN_TOP=true; var SOFT_GATE=100, HARD_GATE=30; var POS="P", NEG="N";\n' +
    ['el', 'esc', 'fmtInt', 'fmtP', 'fmtPct', 'signCol', 'median', 'yieldCell', 'agg', 'bands', 'dbMatchWord', 'bandTo', 'bandPanel']
      .map(f => fnSource(src, f)).join('\n') + '\nreturn { bands, bandPanel };';
  const doc = makeDoc();
  const api = new Function('document', 'M', 'baselineAllowed', code)(doc, j.meta, () => false);
  const rows = j.rows;
  const fav = api.bands(rows.map(r => ({ p: r[5], w: r[7], b: r[8] })));
  const dog = api.bands(rows.map(r => ({ p: r[6], w: r[7] ? 0 : 1, b: r[8] })));
  const read = (panel) => {
    const lines = panel.all().filter(n => has(n, 'db-gr') || has(n, 'db-ga'));
    return { all: panel.textContent, rows: lines.map(l => ({ all: has(l, 'db-ga'), cells: l.children.map(c => c.textContent) })) };
  };
  return { rows, fav: read(api.bandPanel('Favourites', fav, ['Heavy favourite', 'Firm favourite', 'Narrow favourite'], 'fav', false, true)),
    dog: read(api.bandPanel('Underdogs', dog, ['Narrow underdog', 'Mid underdog', 'Long shot'], 'dog', false, true)) };
}
const pct = v => (v >= 0 ? '+' : '\u2212') + Math.abs(v * 100).toFixed(2) + '%';   // true minus (TEN-399)
const med = a => { const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
CHECKS.bands = (src) => {
  const t = paintTour(src);
  const n = t.rows.length;
  for (const [side, P, profitOf, price] of [
    ['fav', t.fav, r => r[7] ? r[5] - 1 : -1, r => r[5]],
    ['dog', t.dog, r => r[7] ? -1 : r[6] - 1, r => r[6]]]) {
    const bandRows = P.rows.filter(r => !r.all), all = P.rows.find(r => r.all);
    if (bandRows.length !== 3 || !all) return `${side}: ${bandRows.length} band rows / All row ${!!all}`;
    const sum = bandRows.reduce((s, r) => s + +r.cells[4].replace(/,/g, ''), 0);
    if (sum !== +all.cells[4].replace(/,/g, '') || sum !== n) return `${side}: bands sum ${sum}, All ${all.cells[4]}, archive ${n}`;
    // match-weighted All yield and pooled median, recomputed independently from the rows
    const y = t.rows.reduce((s, r) => s + profitOf(r), 0) / n;
    if (all.cells[5] !== pct(y)) return `${side}: All yield ${all.cells[5]} != match-weighted ${pct(y)}`;
    if (all.cells[3] !== med(t.rows.map(price)).toFixed(2)) return `${side}: All median ${all.cells[3]} is not the pooled median`;
    if (!all.cells[1] || !all.cells[2] || all.cells[1] === '—') return `${side}: All From / To empty: ${JSON.stringify(all.cells)}`;
    if (all.cells[1] !== bandRows[0].cells[1]) return `${side}: All From ${all.cells[1]} != first band From ${bandRows[0].cells[1]}`;
    if (side === 'fav' && all.cells[2] !== bandRows[2].cells[2]) return `fav: All To ${all.cells[2]} != Slight Fav To ${bandRows[2].cells[2]}`;
    if (side === 'dog') {
      if (all.cells[2] !== bandRows[0].cells[1] + '+') return `dog: All To ${all.cells[2]} != Slight Dog From + "+"`;
      if (bandRows[2].cells[2] !== bandRows[2].cells[1] + '+') return `dog: Super Dog To ${bandRows[2].cells[2]} != its From + "+"`;
    }
    // From / To are five mono characters at most, so one 45px track holds them all
    const long = P.rows.flatMap(r => [r.cells[1], r.cells[2]]).filter(c => c.length > 5);
    if (long.length) return `${side}: From / To wider than five characters: ${long}`;
    if (/Back the (shorter|longer) price/i.test(P.all)) return `${side}: "Back the … price" copy still painted`;
  }
  if (t.fav.rows.find(r => r.all).cells[1] !== '1.01') return 'Favourites All From is not 1.01 on the published archive';
  return null;
};
MUTANTS.bands = s => s.replace("    arow.appendChild(el('div','db-gft',fmtP(a.lo)));", "    arow.appendChild(el('div','db-gft',''));");
const MUTANTS_BANDS2 = s => s.replace("  function bandTo(sideKey, lo, hi){ return (DB_DOG_OPEN_TOP && sideKey==='dog') ? fmtP(lo)+'+' : fmtP(hi); }",
  "  function bandTo(sideKey, lo, hi){ return fmtP(hi); }");

// ---- the profit chart, executed --------------------------------------------
function paintCurve(src) {
  const j = JSON.parse(readFileSync(STORE, 'utf8'));
  const code = ['DB_PLOT_H', 'N_TOUR', 'N_TOURN', 'SMOOTH_MODE', 'COL_FAV'].map(v => v === 'N_TOUR' || v === 'N_TOURN' ? '' : varLine(src, v)).join('\n') +
    '\nvar N_TOUR=260, N_TOURN=240;\n' +
    ['el', 'esc', 'yr', 'fmtInt', 'fmtU', 'smoothVals', 'sampleKeep', 'paintSeries', 'poly', 'seasonIndexTicks',
      'dbGuide', 'dbBreakEven', 'dbSeries', 'dbLegend', 'dbEndDot', 'renderCurveCard'].map(f => fnSource(src, f)).join('\n') +
    '\nreturn renderCurveCard(ROWS, false);';
  const doc = makeDoc();
  const card = new Function('document', 'M', 'ROWS', code)(doc, j.meta, j.rows);
  return { card, doc, html: card.html() };
}
CHECKS.seam = (src) => {
  const { card, html } = paintCurve(src);
  const all = card.all();
  if (all.some(n => /seam/.test(n.className))) return 'a seam element is painted: ' + all.filter(n => /seam/.test(n.className)).map(n => n.className);
  if (/book artefact|Book change|BET365|>Bet365</i.test(html)) return 'the chart still names the book change';
  const svg = (/<svg[\s\S]*<\/svg>/.exec(html) || [''])[0];
  if (/<path|<rect|<polygon/.test(svg)) return 'an area fill / loss wash is drawn';
  const lines = [...svg.matchAll(/<line [^>]*>/g)].map(m => m[0]);
  if (lines.some(l => !/x1="0"[^>]*x2="1000"/.test(l))) return 'a vertical line is drawn: ' + lines.find(l => !/x2="1000"/.test(l));
  const guides = lines.filter(l => /stroke="var\(--viz-guide\)"/.test(l)), rule = lines.filter(l => /stroke="var\(--viz-rule\)"/.test(l));
  if (!guides.length || guides.some(l => !/stroke-dasharray="2 6"/.test(l))) return 'guides are not dotted 2 6';
  if (rule.length !== 1 || !/stroke-width="1.25"/.test(rule[0])) return 'break-even is not one 1.25px --viz-rule line';
  if (guides.length + rule.length !== lines.length) return 'an unexpected line is drawn';
  const pl = [...svg.matchAll(/<polyline [^>]*>/g)].map(m => m[0]);
  if (pl.length !== 2) return `${pl.length} series`;
  if (!/stroke="var\(--viz-lead\)" stroke-width="2.4"/.test(pl[1])) return 'lead series is not --viz-lead 2.4px: ' + pl[1].slice(-200);
  if (!/stroke="color-mix\(in srgb, var\(--viz-white-lead\) 45%, transparent\)" stroke-width="2"/.test(pl[0])) return 'second series is not white 45% 2px';
  const dots = all.filter(n => has(n, 'db-enddot')).map(n => n.style.background);
  if (dots.join('|') !== 'var(--viz-lead)|color-mix(in srgb, var(--viz-white-lead) 45%, transparent)') return 'end dots do not match their series: ' + dots;
  if (!/var DB_PLOT_H=340;/.test(src)) return 'plot height constant is not 340';
  for (const sel of ['.db-yaxis', '.db-plotarea', '.db-endcol']) if (!/height:340px/.test(cssRule(src, sel) || '')) return sel + ' is not 340px tall';
  return null;
};
MUTANTS.seam = s => s.replace("    s+=dbBreakEven(zeroY);\n", "    s+=dbBreakEven(zeroY);\n    s+='<line x1=\"500\" y1=\"0\" x2=\"500\" y2=\"300\" stroke=\"var(--text-label)\" stroke-dasharray=\"4 4\"/>';\n");

// ---- CSS + source rulings --------------------------------------------------
CHECKS.css = (src) => {
  const want = [
    ['.db-reset', /color:var\(--text\)/, 'Reset is not white'],
    ['.db-trig', /background:var\(--inner\); border:1px solid transparent/, 'trigger is not --inner, no edge'],
    ['.db-menu', /background:var\(--card\); border:1px solid var\(--edge-10\); border-radius:10px; padding:4px; box-shadow:var\(--shadow-menu\)/, 'menu is not the compact site menu'],
    ['.db-menu', /max-height:252px/, 'filter menu is not 252px'],
    ['.db-menu.has-search', /max-height:212px/, 'search menu is not 212px'],
    ['.db-pop', /max-height:212px/, 'search list is not 212px'],
    ['.db-mrow', /padding:6px 9px; border-radius:7px; font-family:var\(--db-ui\); font-size:12.5px/, 'menu rows are not 12.5px 6x9'],
    ['.db-mrow:hover', /background:var\(--inner\)/, 'row hover is not --inner'],
    ['.db-mrow.on', /background:var\(--selected\)/, 'selected row is not the selected tone'],
    ['.db-mrow.on .db-box', /background:var\(--text\)/, 'ticks are not white'],
    ['.db-msearch input', /height:32px; box-sizing:border-box; background:var\(--inner\); border:1px solid transparent/, 'in-menu search is not 32px --inner, no edge'],
    ['.db-chipin', /background:var\(--inner\); border:1px solid transparent/, 'chips box is not --inner, no edge'],
    ['.db-chip span', /color:var\(--text\)/, 'chip text is not white'],
    ['.db-chip button', /color:var\(--text-label\)/, 'chip × is not grey'],
    ['.db-capnote', /color:var\(--text-label\)/, 'cap note is not grey'],
    ['.db-seg', /background:var\(--card\); border:1px solid var\(--edge-6\)/, 'tab track is not card + 6%'],
    ['.db-seg button.active', /background:var\(--inner\); border-color:var\(--edge-10\); color:var\(--text\); font-weight:700/, 'selected tab is not inner + 10% white 700'],
    ['.db-pills', /background:var\(--card\); border:1px solid var\(--edge-6\)/, 'pill track is not card + 6%'],
    ['.db-pills button.active', /background:var\(--inner\); border-color:var\(--edge-10\); color:var\(--text\); font-weight:700/, 'selected pill is not inner + 10% white 700'],
    ['.db-pills button[disabled], .db-pills button[disabled].active', /color:color-mix\(in srgb, var\(--text-label\) 40%, transparent\);[^}]*background:transparent/, 'disabled pill is not 40% grey, no fill'],
    ['.db-gh', /border-bottom:1px solid var\(--edge-10\)/, 'column heads are not on a 10% rule'],
    ['.db-ga', /border-top:2px solid color-mix\(in srgb, var\(--text\) 14%, transparent\)/, 'All row is not on a 14% 2px rule'],
    ['.db-bandpanel', /background:var\(--card\); border:1px solid var\(--edge-6\)/, 'band panel is not card + 6% edge'],
    ['.db-ctl', /border:1px solid transparent; box-shadow:var\(--top-light\)/, 'the control bar is not a top-level card'],
  ];
  for (const [sel, re, why] of want) { const r = cssRule(src, sel); if (r === null) return sel + ' rule is gone'; if (!re.test(r)) return why + ' (' + sel + '{' + r + '})'; }
  if (/db-bookline/.test(fnSource(src, 'renderBandView'))) return 'the Tour / Tournament view still paints the blue-dot book line';
  if (/book line above each table/.test(fnSource(src, 'renderFootnote'))) return 'the footnote still points at the book line';
  if (/'Back the (shorter|longer) price'|>Back the (shorter|longer) price</.test(src)) return '"Back the … price" copy in the page';
  return null;
};
MUTANTS.css = s => s.replace("color:var(--text); background:none; border:none; cursor:pointer; padding:0; }   /* TEN-399 item 3: Reset is white, not blue */",
  "color:var(--link); background:none; border:none; cursor:pointer; padding:0; }   /* TEN-399 item 3: Reset is white, not blue */");

for (const [name, fn] of Object.entries(CHECKS)) {
  const needs = name === 'bands' || name === 'seam';
  test('TEN-399 a · ' + name, { skip: needs && !HAVE && 'database-yield.json absent' }, () => { assert.equal(fn(SRC), null); });
}
test('CONTROL: every TEN-399 a mutant is caught', { skip: !HAVE && 'database-yield.json absent' }, () => {
  const survived = [];
  const all = Object.entries(MUTANTS).concat([['bands', MUTANTS_BANDS2]]);
  for (const [name, mut] of all) {
    const m = mut(SRC);
    if (m === SRC) { survived.push(name + ' (mutation did not apply)'); continue; }
    let r; try { r = CHECKS[name](m); } catch (e) { r = 'threw: ' + e.message; }
    if (r === null) survived.push(name);
  }
  assert.deepEqual(survived, []);
});
