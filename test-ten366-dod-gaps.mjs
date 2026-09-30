// TEN-366 (TEN-312 DoD item 1 inventory): three elements the design file draws that no tab built, now built.
//   · Playing style #30 — the meeting row whose match sheet is open carries the selected wash (DF L3642 rowBg, blue 0.1).
//   · Progression #13 — the road card whose match sheet is open is selected (DF L4058/L4066 `sel`: border white 0.16, #131623).
//   · Frame #5 — the file's scrollbars (DF L24: 10px, thumb white 0.08, radius 6) inside the modal.
// (Overview #18, the ▾ on an open season row, is checked in test-ten334-overview.mjs.)
// The shared opener is EXECUTED: maRowOnclick → maOpenRowSheet → fhOpenSheet → fhMarkRow are sliced out of
// bsp-consult-dashboard.html and run against a stub DOM. Each check names the mutation it catches; the last test applies
// every mutant and fails if any survives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnSrc } from './tools/ten334-overview-vm.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');

// A minimal element: classList + isConnected, found by the stub document's querySelectorAll.
function el(connected = true) {
  const set = new Set();
  return { isConnected: connected, style: {}, getAttribute: () => null,
    classList: { add: c => set.add(c), remove: (...c) => c.forEach(x => set.delete(x)), contains: c => set.has(c) } };
}
function vm(src) {
  const rows = [el(), el()], sheet = { innerHTML: '' }, modal = { classList: { contains: c => c === 'open' } };
  const document = {
    getElementById: id => (id === 'fhSheet' ? sheet : id === 'analysisModal' ? modal : null),
    querySelectorAll: sel => (sel === '#analysisModal .ma-row-open' ? rows.filter(r => r.classList.contains('ma-row-open')) : []),
  };
  const api = new Function('document', `
    let _maRowSeq = 0; const _maRowReg = {}; let _maRowReq = 0; let _aM = { id: 'm' };
    const _fh = { sheetMap: {}, sheet: null };
    const loadCareerHistory = () => Promise.resolve([]), fhLoadCloses = () => Promise.resolve(null);
    const fhNameKey = s => String(s || '').toLowerCase(), fhSafeId = s => s, fhFinishRow = () => {}, fhStateFor = () => _fh;
    const fhS = (k, f) => 'var(--ma-s-' + k + ', var(' + f + '))';
    function fhOpenSheet(mid){ document.getElementById('fhSheet').innerHTML = 'sheet ' + mid; _fh.sheet = mid; fhMarkRow(mid); }
    function fhCloseSheet(){ document.getElementById('fhSheet').innerHTML = ''; _fh.sheet = null; fhMarkRow(null); }
    ${['maRowOnclick', 'maSameOpp', 'maOpenRowSheet', 'fhMarkRow'].map(f => fnSrc(f, src)).join('\n')}
    return { maRowOnclick, maOpenRowSheet, fhCloseSheet, get reg(){ return _maRowReg; } };`)(document);
  return Object.assign(api, { rows, sheet });
}
const flush = () => new Promise(r => setTimeout(r, 0));
const open = async (V, i) => {
  const attr = V.maRowOnclick({ key: '1', name: 'A. Alpha', opp: 'B. Bravo', date: '2026-05-0' + (i + 1), fallback: {} });
  const m = /maOpenRowSheet\('([^']+)', this\)/.exec(attr);
  assert.ok(m, 'the row opener hands the clicked row to maOpenRowSheet: ' + attr);
  V.maOpenRowSheet(m[1], V.rows[i]); await flush(); await flush();
};
const isOpen = (V, i) => V.rows[i].classList.contains('ma-row-open');
const cssRule = (src, sel) => { const i = src.indexOf('\n  ' + sel + '{'); return i < 0 ? null : src.slice(i + 3 + sel.length, src.indexOf('}', i)); };

const CHECKS = {
  // Mutations: the opener drops `this`; maOpenRowSheet never marks the row; fhMarkRow never clears the mark.
  async 'the clicked row carries .ma-row-open while its sheet is open; one row at a time; cleared on close'(src) {
    const V = vm(src);
    await open(V, 0);
    assert.ok(isOpen(V, 0), 'the opened row is marked');
    await open(V, 1);
    assert.ok(!isOpen(V, 0) && isOpen(V, 1), 'opening another row moves the mark');
    V.fhCloseSheet();
    assert.ok(!isOpen(V, 0) && !isOpen(V, 1), 'closing the sheet clears it');
  },
  // Mutation: the Playing style rule is dropped, or takes another shade than the design's blue 0.1.
  'Playing style: the open meeting row takes the design selected wash (DF L3642, blue 0.1)'(src) {
    const r = cssRule(src, '#aSectionStyle .ma-row.ma-row-open');
    assert.ok(r, 'rule present'); assert.match(r, /background:var\(--ma-s-5b9bff-100\) !important;/);
  },
  // Mutation: the Progression rule is dropped, or loses the design's border 0.16 / #131623.
  'Progression: the open road card is the design selected card (DF L4058/L4066)'(src) {
    const r = cssRule(src, '#aSectionProgression .pg-cell.ma-row-open');
    assert.ok(r, 'rule present');
    assert.match(r, /background:var\(--ma-s-131623\) !important;/); assert.match(r, /border-color:var\(--ma-s-ffffff-160\) !important;/);
  },
  // Mutation: the scrollbar rules are dropped, or the thumb loses its shade token / radius.
  'frame: the design scrollbars inside the modal (DF L24: 10px, thumb white 0.08, radius 6)'(src) {
    assert.match(cssRule(src, '#analysisModal ::-webkit-scrollbar') || '', /width:10px; height:10px;/);
    assert.match(cssRule(src, '#analysisModal ::-webkit-scrollbar-thumb') || '', /background:var\(--ma-s-ffffff-080, var\(--line\)\); border-radius:6px;/);
  },
};
for (const [name, fn] of Object.entries(CHECKS)) test(name, () => fn(HTML));

const MUTANTS = [
  ['opener drops the row', "maOpenRowSheet('${id}', this)", "maOpenRowSheet('${id}')"],
  ['row never marked', "el.classList.add('ma-row-open');", 'void el;'],
  ['mark never cleared', "document.querySelectorAll('#analysisModal .ma-row-open').forEach(el => el.classList.remove('ma-row-open')); ", ''],
  ['Playing style rule dropped', '  #aSectionStyle .ma-row.ma-row-open{ background:var(--ma-s-5b9bff-100) !important; }\n', ''],
  ['Progression card on the wrong border', 'border-color:var(--ma-s-ffffff-160) !important; }', 'border-color:var(--ma-s-ffffff-050) !important; }'],
  ['scrollbar thumb unstyled', '  #analysisModal ::-webkit-scrollbar-thumb{ background:var(--ma-s-ffffff-080, var(--line)); border-radius:6px; }\n', ''],
];
test(`mutants: ${MUTANTS.length} applied, every one caught`, async () => {
  const survived = [];
  for (const [label, from, to] of MUTANTS) {
    assert.equal(HTML.split(from).length, 2, `mutant anchor for "${label}" must occur exactly once`);
    const mutant = HTML.replace(from, to);
    let caught = false;
    for (const fn of Object.values(CHECKS)) { try { await fn(mutant); } catch (e) { if (e instanceof assert.AssertionError) { caught = true; break; } throw e; } }
    if (!caught) survived.push(label);
  }
  assert.deepEqual(survived, [], 'mutants that survived');
});
