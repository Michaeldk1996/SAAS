// TEN-260 Part B/C — the Lines tab: two-player compare, the pipeline field file,
// and the pixel-pass rules that carry numbers (highlight threshold, sign colour).
//
// EXECUTES the shipped code, never greps it:
//   · build-lines-field.js's own loadLineLogic() slices the line functions out of
//     the page exactly as the pipeline does, and builds a field from fixture rows;
//   · lnPaint() is sliced out of the page and painted under a DOM shim against that
//     field, and every figure is read back off the painted cells.
// Fixture rows, not the career-history store: that store is gitignored and CI-built,
// so a test that needed it would skip in the one place it has to run.
//
// Run: node --test test-ten260-lines.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const require = createRequire(import.meta.url);
const { loadLineLogic, fnSource, varSource } = require('./build-lines-field.js');

function makeDoc() {
  const mk = (tag) => ({
    tagName: tag, className: '', title: '', _text: '', _html: '', children: [], style: {},
    get classList() { const n = this; return { add(c) { n.className += ' ' + c; } }; },
    appendChild(c) { this.children.push(c); return c; },
    set textContent(v) { this._text = String(v); this.children = []; },
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); },
    set innerHTML(v) { this._html = String(v); this._text = String(v).replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); this.children = []; },
    get innerHTML() { return this._html; },
    querySelectorAll(sel) {
      const cls = sel.replace(/^\./, ''); const out = [];
      const walk = (e) => { for (const c of e.children) {
        if ((c.className || '').split(/\s+/).includes(cls)) out.push(c); walk(c); } };
      walk(this); return out;
    },
  });
  return { createElement: mk };
}

// ── fixtures ────────────────────────────────────────────────────────────────
// Deterministic best-of-three matches. `won` of `n` matches are 2-0 wins with
// 6-3 6-4 (player +5 games), the rest 0-2 losses 4-6 3-6 (−5 games).
function rows(won, n, surface = 'Hard') {
  const out = [];
  for (let i = 0; i < n; i++) {
    const w = i < won;
    out.push({ date: '2025-0' + (1 + (i % 9)) + '-10', surface, sets: w ? [{ p: 6, o: 3 }, { p: 6, o: 4 }] : [{ p: 4, o: 6 }, { p: 3, o: 6 }] });
  }
  return out;
}
// A field of 7 players with distinct records on every line.
const FIELD = { A: rows(18, 20), B: rows(14, 20), C: rows(12, 20), D: rows(10, 20), E: rows(8, 20), F: rows(5, 20), G: rows(3, 4) };

function buildField(src) {
  const L = loadLineLogic(src, '2025-01-01');
  const slices = {};
  const key = 'bo3|All|career', sl = {};
  for (const grp of L.LN_GROUPS) for (const spec of L.LN_LADDERS.bo3[grp]) {
    const rates = [];
    for (const nm of Object.keys(FIELD)) {
      const r = L.lnRate(L.lnLine(L.lnPools(FIELD[nm], 'All', 'career').byFmt.bo3, spec[1], spec[2]));
      if (r != null) rates.push(L.lnRound3(r));
    }
    sl[spec[0]] = rates.sort((a, b) => a - b);
  }
  slices[key] = sl;
  return { l52Cutoff: '2025-01-01', minN: 5, source: { rosterSize: 8, resolved: 7, unresolved: ['Z. Nobody'] }, slices };
}

// NOT `median`: the page defines it twice, and the first `function median(` in the
// file is a different, global one. The Database tab uses the IIFE's own one-liner,
// so that exact one is taken below.
const IIFE_MEDIAN = (() => { const i = SRC.indexOf('function median(a){ if(!a.length)'); if (i < 0) throw new Error('the Database median is gone'); return SRC.slice(i, SRC.indexOf('\n', i)); })();
const NEED_FN = ['el', 'esc', 'fmtInt', 'fmtDate', 'lnCutoff', 'lnPartition', 'lnFormat', 'lnHit', 'lnLine', 'lnPools',
  'lnRate', 'lnRound3', 'lnFieldStats', 'lnSgn', 'lnSgnCol', 'lnPaint', 'lnFoot'];
function paint(src, subjects, { lnf = buildField(src), fmt = 'bo3' } = {}) {
  let code = '';
  for (const v of ['LN_LADDERS', 'LN_GROUPS', 'LN_MIN_N']) code += varSource(src, v) + '\n';
  for (const f of NEED_FN) code += fnSource(src, f) + '\n';
  code += (src === SRC ? IIFE_MEDIAN : (() => { const i = src.indexOf('function median(a){ if(!a.length)'); return src.slice(i, src.indexOf('\n', i)); })()) + '\n';
  const sandbox = { document: makeDoc(), MON: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    state: { lnSurf: 'All', lnScope: 'career', lnFmt: fmt, lnCat: null, lnSel: subjects.map(s => s.nm) }, LNF: lnf, console };
  const api = new Function(...Object.keys(sandbox), code + '\nreturn {lnPaint};')(...Object.values(sandbox));
  const host = sandbox.document.createElement('div'), brow = sandbox.document.createElement('div');
  api.lnPaint(host, subjects, brow);
  const rowsOut = host.querySelectorAll('db-lnrow').map(r => ({
    label: r.children[0].textContent,
    cells: r.children.slice(1).map(c => ({ text: c.textContent, color: c.style.color || '', cls: c.className,
      pill: (c.children[0] && c.children[0].className) || '' })),
  }));
  return { host, brow, rows: rowsOut, text: host.textContent };
}
const median = a => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sgn = v => { const x = Math.round(v * 10) / 10; return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(1); };

const CHECKS = {
  // Field / Vs field / Ranking are the file's median, delta and rank - recomputed
  // here from the raw fixture records, not read back from the file.
  field(src) {
    const { rows: R } = paint(src, [{ nm: 'C', rows: FIELD.C }]);
    const row = R.find(r => r.label === '+1.5 sets'); if (!row) return 'no +1.5 sets row';
    // +1.5 sets lands on a 2-0 win only (a 0-2 loss is −2+1.5 < 0): rate = won/n
    const rates = ['A', 'B', 'C', 'D', 'E', 'F'].map(k => FIELD[k].slice(0).filter((_, i) => i < { A: 18, B: 14, C: 12, D: 10, E: 8, F: 5 }[k]).length / FIELD[k].length * 100);
    const own = 12 / 20 * 100, med = median(rates);
    const [matches, record, rate, field, vs, rank] = row.cells.map(c => c.text);
    if (!rate.startsWith(own.toFixed(1) + '%')) return `rate ${rate}, expected ${own.toFixed(1)}%`;
    if (!field.startsWith(med.toFixed(1) + '%')) return `field ${field}, expected ${med.toFixed(1)}% (median of ${rates.length}; G has 4 matches and is out)`;
    // TEN-399 R2: Vs field = displayed Rate − displayed Field (both 1 dp)
    const dvs = sgn(Number(own.toFixed(1)) - Number(med.toFixed(1)));
    if (vs !== dvs + 'pp') return `vs field ${vs}, expected ${dvs}pp`;
    const expRank = 1 + rates.filter(r => r > own).length;
    if (rank !== expRank + '/' + rates.length) return `ranking ${rank}, expected ${expRank}/${rates.length}`;
    // A subject the file does not contain (a stale file, one tick behind his
    // shard) must not be ranked into it - that is how "8/7" gets printed.
    const out = paint(src, [{ nm: 'New', rows: rows(19, 20) }]).rows.find(r => r.label === '+1.5 sets');
    if (out.cells[5].text !== '—') return `a player absent from the field file was ranked ${out.cells[5].text}`;
    return null;
  },
  // Rate does NOT wait for the field: with no file the rate is filled and the
  // three field columns are dashes, and the note says why.
  noField(src) {
    const { rows: R, text } = paint(src, [{ nm: 'C', rows: FIELD.C }], { lnf: null });
    const row = R.find(r => r.label === '+1.5 sets');
    const [, , rate, field, vs, rank] = row.cells.map(c => c.text);
    if (!/^\d/.test(rate)) return `rate dashed without the field file: ${rate}`;
    if (field !== '—' || vs !== '—' || rank !== '—') return `field columns not dashed without the file: ${field} ${vs} ${rank}`;
    if (!/not published yet/.test(text)) return 'no note saying the field file is not published';
    if (/\.json|pipeline/.test(text)) return 'a Lines note names a file or the pipeline (TEN-399 fix 4)';
    return null;
  },
  // Two players side by side (TEN-399 founder fix 3 + R2 item 4): one shared Field cell, then per player Rate · Vs field · Record,
  // with Vs field in the three-way sign colour like the single table.
  compare(src) {
    const { rows: R, host } = paint(src, [{ nm: 'C', rows: FIELD.C }, { nm: 'A', rows: FIELD.A }]);
    const names = host.querySelectorAll('db-lnnm').map(n => n.textContent);
    if (names.join('|') !== 'C|A') return `compare name band reads ${names.join('|')}`;
    const row = R.find(r => r.label === '+1.5 sets');
    if (!row || row.cells.length !== 7) return `compare row has ${row && row.cells.length} cells, expected 7 (Field + (Rate, Vs field, Record) × 2)`;
    if (!/^\d+\.\d%(field \d+)?$/.test(row.cells[0].text)) return `compare Field cell reads ${row.cells[0].text}`;
    if (!/^\d+–\d+$/.test(row.cells[3].text) || !/^\d+–\d+$/.test(row.cells[6].text)) return `compare records ${row.cells[3].text} / ${row.cells[6].text}`;
    if (!row.cells[1].text.startsWith('60.0%') || !row.cells[4].text.startsWith('90.0%')) return `compare rates ${row.cells[1].text} / ${row.cells[4].text}`;
    if (!/pp$/.test(row.cells[2].text) || !/pp$/.test(row.cells[5].text)) return 'compare vs-field cells are not filled';
    for (const c of [row.cells[2], row.cells[5]])
      if (!/^var\(--(pos|neg)\)$/.test(c.color || '') && !/^0\.0pp$/.test(c.text)) return `compare vs field ${c.text} painted ${c.color || 'uncoloured'}`;
    return null;
  },
  // An unresolved name dashes with the reason; a failed load says so.
  unresolved(src) {
    const { rows: R, text } = paint(src, [{ nm: 'C', rows: FIELD.C }, { nm: 'Z. Nobody', rows: null }]);
    const row = R.find(r => r.label === '+1.5 sets');
    if (row.cells[4].text !== '—' || row.cells[5].text !== '—' || row.cells[6].text !== '—') return 'unresolved player shows figures';
    if (!/does not resolve to a profile key/.test(text)) return 'no reason for the unresolved player';
    // rows PRESENT but the load flagged failed (the shard cache was not written):
    // the cells must still dash - a partial or stale array is not an answer.
    const f = paint(src, [{ nm: 'C', rows: FIELD.C, failed: true }]);
    const fr = f.rows.find(r => r.label === '+1.5 sets');
    if (fr.cells[2].text !== '—') return `a failed load still painted a rate: ${fr.cells[2].text}`;
    if (!/could not be loaded/.test(f.text)) return 'a failed load is not reported as a failed load';
    if (/No matches on record/.test(f.text)) return 'a failed load reads as "no matches on record"';
    return null;
  },
  // "LINE COVERAGE · N LINES" counts the format on screen.
  eyebrow(src) {
    const a = paint(src, [{ nm: 'C', rows: FIELD.C }], { fmt: 'bo3' });
    const b = paint(src, [{ nm: 'C', rows: FIELD.C }], { fmt: 'bo5' });
    if (a.brow.textContent !== 'Line coverage · 14 lines') return `bo3 eyebrow "${a.brow.textContent}"`;
    if (b.brow.textContent !== 'Line coverage · 15 lines') return `bo5 eyebrow "${b.brow.textContent}"`;
    return null;
  },
  // The highlight is a FULL-SAMPLE (n >= 10) rate at 65% or better (README TAB 5; its colours re-ruled by TEN-399, see lines.md).
  highlight(src) {
    const mk = (won, n) => paint(src, [{ nm: 'X', rows: rows(won, n) }]).rows.find(r => r.label === '+1.5 sets').cells[2].pill;
    if (!/strong/.test(mk(13, 20))) return '65.0% at n=20 is not highlighted';
    if (/strong/.test(mk(129, 200))) return '64.5% at n=200 is highlighted';
    if (/strong/.test(mk(9, 9))) return '100% at n=9 wears the full-sample highlight';
    if (!/low/.test(mk(9, 9))) return 'n=9 is not in the small-sample ink';
    return null;
  },
  // README TAB 5: Vs field and Avg margin in the three-way sign colour (TEN-376: --pos / --neg tokens).
  colour(src) {
    const { rows: R } = paint(src, [{ nm: 'A', rows: FIELD.A }]);
    const row = R.find(r => r.label === '+1.5 sets');
    const vs = row.cells[4], avg = row.cells[6];
    if (vs.color !== 'var(--pos)') return `positive vs field painted ${vs.color || 'uncoloured'}`;
    if (avg.color !== 'var(--pos)') return `positive avg margin painted ${avg.color || 'uncoloured'}`;
    const { rows: R2 } = paint(src, [{ nm: 'F', rows: FIELD.F }]);
    const r2 = R2.find(r => r.label === '+1.5 sets');
    if (r2.cells[4].color !== 'var(--neg)') return `negative vs field painted ${r2.cells[4].color || 'uncoloured'}`;
    return null;
  },
};

// Rate must NOT wait for the field file: renderLines paints as soon as the rows
// are in, even while the field fetch never settles (review finding, TEN-260).
CHECKS.rateFirst = async function (src) {
  let code = '';
  for (const v of ['LN_LADDERS', 'LN_GROUPS', 'LN_MIN_N']) code += varSource(src, v) + '\n';
  for (const f of [...NEED_FN, 'renderLines', 'lnHead', 'lnInitials', 'lnRankOf']) code += fnSource(src, f) + '\n';
  const i = src.indexOf('function median(a){ if(!a.length)'); code += src.slice(i, src.indexOf('\n', i)) + '\n';
  const doc = makeDoc();
  const inst = {};
  const sandbox = { document: doc, MON: [], LNF: null, I: inst, RAT: { players: [] }, console,
    state: { view: 'lines', lnSurf: 'All', lnScope: 'career', lnFmt: 'bo3', lnCat: null, lnSel: ['C'] },
    _careerHistoryShards: { k1: FIELD.C },
    lnKeyForName: () => 'k1', loadCareerHistory: () => Promise.resolve(FIELD.C),
    loadLinesField: () => new Promise(() => {}),          // never settles
    loadRatings: () => Promise.resolve(), use() {}, q() { return null; }, ratOpenPlayer() {} };
  const api = new Function(...Object.keys(sandbox), code + '\nreturn {renderLines};')(...Object.values(sandbox));
  const body = doc.createElement('div');
  api.renderLines(body);
  for (let k = 0; k < 5; k++) await new Promise(r => setImmediate(r));
  const rowsPainted = body.querySelectorAll('db-lnrow');
  if (!rowsPainted.length) return 'the table did not paint while the field file was still loading';
  const rate = rowsPainted.find(r => r.children[0].textContent === '+1.5 sets').children[3].textContent;
  if (!rate.startsWith('60.0%')) return `rate while the field loads: ${rate}`;
  return null;
};
for (const [name, fn] of Object.entries(CHECKS)) {
  test('TEN-260 Lines · ' + name, async () => { const e = await fn(SRC); assert.equal(e, null, e); });
}

const MUTANTS = [
  ['field median replaced by mean', 'field', s => s.replace('var med=median(d), rank=null;', 'var med=d.reduce(function(a,b){return a+b;},0)/d.length, rank=null;')],
  ['rank counts ties as above', 'field', s => s.replace('if(v>r) above++;', 'if(v>=r) above++;')],
  ['field admits n<5 players', 'field', s => s.replace('var LN_MIN_N=5;', 'var LN_MIN_N=1;')],
  ['rate waits for the field', 'noField', s => s.replace('var rate = L ? lnRate(L) : null;', 'var rate = (L && LNF) ? lnRate(L) : null;')],
  ['field columns filled from nothing', 'noField', s => s.replace("if(!LNF || !LNF.slices) return null;", "if(!LNF || !LNF.slices) return {median:50,size:1,rank:1};")],
  ['compare shows one player', 'compare', s => s.replace("var cmp = subjects.length>1;", "var cmp = subjects.length>1; subjects=subjects.slice(0,1);")],
  ['compare delta neutral', 'compare', s => s.replace("var dc=fig(delta==null ? DASH : lnSgn(delta)+'pp', delta==null ? null : lnSgnCol(delta), 'cmpc');", "var dc=fig(delta==null ? DASH : lnSgn(delta)+'pp', null, 'cmpc');")],
  ['compare drops Record', 'compare', s => s.replace("\n            row.appendChild(rc);", "")],
  ['compare puts Record first', 'compare', s => s.replace("var pc=pill(rate, L ? L.n : 0, true); pc.title=title; row.appendChild(pc);", "row.appendChild(rc); var pc=pill(rate, L ? L.n : 0, true); pc.title=title; row.appendChild(pc);").replace("row.appendChild(dc);\n            row.appendChild(rc);", "row.appendChild(dc);")],
  ['unresolved reason dropped', 'unresolved', s => s.replace("this name does not resolve to a profile key", "no data")],
  ['failed load reads as zero', 'unresolved', s => s.replace("s.P = (s.rows && !s.failed) ?", "s.P = (s.rows) ?")],
  ['eyebrow counts both formats', 'eyebrow', s => s.replace("        linesShown++;\n", "        linesShown+=2;\n")],
  ['table waits for the field file', 'rateFirst', s => s.replace("    Promise.all(picks.map(function(nm){ var k=lnKeyForName(nm); return k ? loadCareerHistory(k) : Promise.resolve(null); }))\n    .then(", "    Promise.all(picks.map(function(nm){ var k=lnKeyForName(nm); return k ? loadCareerHistory(k) : Promise.resolve(null); })).then(function(x){ return loadLinesField().then(function(){ return x; }); })\n    .then(")],
  ['stale file ranks a player it does not contain', 'field', s => s.replace('if(d.indexOf(r)>=0){ var above=0;', 'if(true){ var above=0;')],
  ['highlight at 70%', 'highlight', s => s.replace('if(n>=10 && rate>=65) b.className+=', 'if(n>=10 && rate>=70) b.className+=')],
  ['highlight ignores n', 'highlight', s => s.replace('if(n>=10 && rate>=65) b.className+=', 'if(rate>=65) b.className+=')],
  ['vs field uncoloured', 'colour', s => s.replace("row.appendChild(fig(delta==null ? DASH : lnSgn(delta)+'pp', delta==null ? null : lnSgnCol(delta)));", "row.appendChild(fig(delta==null ? DASH : lnSgn(delta)+'pp', null));")],
  ['avg margin uncoloured', 'colour', s => s.replace("row.appendChild(fig(avg==null ? DASH : lnSgn(avg), avg==null ? null : lnSgnCol(avg)));", "row.appendChild(fig(avg==null ? DASH : lnSgn(avg), null));")],
];
test('CONTROL: every TEN-260 Lines mutant is caught', async () => {
  const survivors = [];
  for (const [name, which, mutate] of MUTANTS) {
    const m = mutate(SRC);
    assert.notEqual(m, SRC, `mutant "${name}" did not apply — it proves nothing`);
    let caught; try { caught = (await CHECKS[which](m)) !== null; } catch { caught = true; }
    if (!caught) survivors.push(name);
  }
  assert.deepEqual(survivors, [], `${survivors.length} of ${MUTANTS.length} mutants SURVIVED: ${survivors.join(' · ')}`);
  console.log(`  mutants: ${MUTANTS.length} caught, 0 survived`);
});

// ── TEN-399 item 8 · the Lines re-skin (founder step-6 ticket, 2026-10-07) ─────
// Each ruling is read off the page's OWN stylesheet (the rule that paints it, merged
// in cascade order the way the browser does) and, where the renderer decides the
// state, off the painted cells. Every check has a mutant that puts the superseded
// value back.
//   · card = top-level card: --card + --top-light, no outline
//   · state chips = --inner, no edge, grey caps
//   · group headings = Hanken 10.5 / 700 / 0.10em caps in BOTH views
//   · rate pill highlight (n >= 10 and >= 65%) = --pos text on a 12% --pos wash, no border
//   · small-sample marks + n < 10 rates = --text-label; no amber anywhere on the tab
//   · compare name bands on a 14% white rule
function cssRule(src, sel) {
  const css = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = {}; let found = false;
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].split(',').map(x => x.trim()).includes(sel)) continue;
    found = true;
    for (const d of m[2].split(';')) { const k = d.indexOf(':'); if (k > 0) out[d.slice(0, k).trim()] = d.slice(k + 1).trim(); }
  }
  return found ? out : null;
}
// The page aliases (--db-sec etc.) resolved to the foundation token they stand for.
function tok(src, v) {
  const m = /^var\((--db-[\w-]+)\)$/.exec(v || '');
  if (!m) return v;
  return (cssRule(src, '[data-page="database"]') || {})[m[1]] || v;
}
const LN_CSS = {
  card(src) {
    const r = cssRule(src, '.db-rcard'); if (!r) return 'no .db-rcard rule';
    if (tok(src, r.background) !== 'var(--card)') return 'card background ' + r.background;
    if (r['box-shadow'] !== 'var(--top-light)') return 'card shadow ' + r['box-shadow'];
    if (!/transparent|none/.test(r.border || 'none')) return 'card has an outline: ' + r.border;
    return null;
  },
  chips(src) {
    const r = cssRule(src, '.db-lnchip'); if (!r) return 'no .db-lnchip rule';
    if (r.background !== 'var(--inner)') return 'chip background ' + r.background;
    if (!/transparent|none/.test(r.border || 'none')) return 'chip has an edge: ' + r.border;
    if (tok(src, r.color) !== 'var(--text-label)') return 'chip ink ' + r.color;
    if (r['text-transform'] !== 'uppercase' || r['font-size'] !== '10.5px' || r['font-weight'] !== '700') return 'chip is not a caps label';
    return null;
  },
  groups(src) {
    const r = cssRule(src, '.db-lngrp'), c = cssRule(src, '.db-lngrp.cmp') || {};
    if (!r) return 'no .db-lngrp rule';
    const want = { 'font-family': 'var(--font-words)', 'font-size': '10.5px', 'font-weight': '700', 'letter-spacing': '0.10em', 'text-transform': 'uppercase', color: 'var(--text-label)' };
    for (const [k, v] of Object.entries(want)) {
      if (r[k] !== v) return `group heading ${k} ${r[k]}, want ${v}`;
      if (k in c && tok(src, c[k]) !== v) return `compare group heading overrides ${k} to ${c[k]}`;
    }
    return null;
  },
  pill(src) {
    const base = cssRule(src, '.db-lnpill'), s = cssRule(src, '.db-lnpill.strong');
    if (!base || !s) return 'no rate pill rules';
    if (s.color !== 'var(--pos)') return 'highlight ink ' + s.color;
    if (s.background !== 'color-mix(in srgb, var(--pos) 12%, transparent)') return 'highlight wash ' + s.background;
    const bc = s['border-color'] || (/solid\s+(.+)$/.exec(base.border || '') || [])[1];
    if (bc !== 'transparent') return 'highlight carries a border: ' + bc;
    // and the renderer still decides who wears it: n >= 10 and >= 65% only
    const mk = (won, n) => paint(src, [{ nm: 'X', rows: rows(won, n) }]).rows.find(r => r.label === '+1.5 sets').cells[2].pill;
    if (!/strong/.test(mk(13, 20)) || /strong/.test(mk(9, 9))) return 'the highlight state moved off n >= 10 and >= 65%';
    return null;
  },
  smallSample(src) {
    for (const sel of ['.db-lnsmall', '.db-lnpill.low']) {
      const r = cssRule(src, sel); if (!r) return 'no ' + sel + ' rule';
      if (tok(src, r.color) !== 'var(--text-label)') return `${sel} ink ${r.color}, want var(--text-label)`;
    }
    // the painted marks carry no inline colour of their own (the stylesheet decides)
    const p = paint(src, [{ nm: 'X', rows: rows(2, 4) }]);
    const marks = p.host.querySelectorAll('db-lnsmall');
    if (!marks.length) return 'control: an n < 5 slice painted no small-sample mark';
    if (marks.some(m => m.style.color)) return 'a small-sample mark carries an inline colour';
    // no amber anywhere on the tab: its rules and its renderers
    const css = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (/\.db-ln|\.db-rcard/.test(m[1]) && /amber/i.test(m[2])) return 'amber in ' + m[1].trim();
    for (const f of ['lnPaint', 'lnHead', 'lnFoot', 'renderLines']) if (/amber/i.test(fnSource(src, f))) return 'amber in ' + f;
    return null;
  },
  nameBand(src) {
    const r = cssRule(src, '.db-lnnm'); if (!r) return 'no .db-lnnm rule';
    if (r['border-bottom'] !== '1px solid color-mix(in srgb, var(--text) 14%, transparent)') return 'name band rule ' + r['border-bottom'];
    if (r.color !== 'var(--text)') return 'name band ink ' + r.color;
    return null;
  },
};
for (const [name, fn] of Object.entries(LN_CSS)) test('TEN-399 Lines · ' + name, () => { const e = fn(SRC); assert.equal(e, null, e); });
const LN_CSS_MUTANTS = [
  ['card outline back', 'card', s => s.replace('.db-rcard{ background:var(--card); border:1px solid transparent;', '.db-rcard{ background:var(--card); border:1px solid var(--edge-6);')],
  ['chip edge back', 'chips', s => s.replace('background:var(--inner); border:1px solid transparent; border-radius:7px; padding:5px 10px; }   /* TEN-399 item 8', 'background:var(--inner); border:1px solid var(--edge-6); border-radius:7px; padding:5px 10px; }   /* TEN-399 item 8')],
  ['compare group headings back to 9px / 600', 'groups', s => s.replace('.db-lngrp.cmp{ padding:15px 6px 5px; }', '.db-lngrp.cmp{ font-size:9px; font-weight:600; letter-spacing:0.15em; padding:15px 6px 5px; }')],
  ['highlight wash back to 15%', 'pill', s => s.replace('background:color-mix(in srgb, var(--pos) 12%, transparent); border-color:transparent; }', 'background:color-mix(in srgb, var(--pos) 15%, transparent); border-color:transparent; }')],
  ['highlight border back', 'pill', s => s.replace('background:color-mix(in srgb, var(--pos) 12%, transparent); border-color:transparent; }', 'background:color-mix(in srgb, var(--pos) 12%, transparent); border-color:color-mix(in srgb, var(--pos) 34%, transparent); }')],
  ['small-sample mark in amber', 'smallSample', s => s.replace(".db-lnsmall{font-family:var(--font-words); font-style:normal; margin-left:6px; font-size:10.5px; letter-spacing:0; text-transform:none; font-weight:700; color:var(--text-label); }", ".db-lnsmall{font-family:var(--font-words); font-style:normal; margin-left:6px; font-size:10.5px; letter-spacing:0; text-transform:none; font-weight:700; color:var(--amber); }")],
  ['n < 10 rate in amber', 'smallSample', s => s.replace('.db-lnpill.low{ color:var(--text-label); }', '.db-lnpill.low{ color:var(--amber); }')],
  ['name band rule back to the 5% hairline', 'nameBand', s => s.replace('padding-bottom:9px; border-bottom:1px solid color-mix(in srgb, var(--text) 14%, transparent);', 'padding-bottom:9px; border-bottom:1px solid var(--line);')],
];
test('CONTROL: every TEN-399 Lines mutant is caught', () => {
  const survivors = [];
  for (const [name, which, mutate] of LN_CSS_MUTANTS) {
    const m = mutate(SRC);
    assert.notEqual(m, SRC, `mutant "${name}" did not apply — it proves nothing`);
    let caught; try { caught = LN_CSS[which](m) !== null; } catch { caught = true; }
    if (!caught) survivors.push(name);
  }
  assert.deepEqual(survivors, [], `${survivors.length} of ${LN_CSS_MUTANTS.length} mutants SURVIVED: ${survivors.join(' · ')}`);
  console.log(`  TEN-399 Lines mutants: ${LN_CSS_MUTANTS.length} caught, 0 survived`);
});
