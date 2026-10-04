// TEN-314 (TEN-312 Phase 1): the Match analysis shared components — ONE helper each (handoff README §4 / §6):
// segmented control maSeg, pop-up frame maPopFrame (+ maPopEscKey), match rows maMatchRowsHtml, tooltip maTipHtml,
// motion classes. Geometry is read from the helpers' OUTPUT and compared with the design file's inline styles
// (`Match Analysis Progression v1.dc.html`), never with numbers typed into this test.
// Every check names the mutation that turns it red; tools/test-ten314-mutants.js applies each one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN314_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const DF = readFileSync(join(HERE, 'design/handoff-ten312-match-analysis/Match Analysis Progression v1.dc.html'), 'utf8').split('\n');
const README = readFileSync(join(HERE, 'design/handoff-ten312-match-analysis/README.md'), 'utf8');
function slice(name) {
  const start = html.indexOf(`\nfunction ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  const eol = html.indexOf('\n', start + 1), line = html.slice(start, eol);
  if (/\}\s*$/.test(line) && (line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  let d = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; }
  return html.slice(start, i + 1);
}
function constSrc(name) {
  const start = html.indexOf(`\nconst ${name} = `);
  assert.ok(start > 0, `const ${name} not found`);
  return html.slice(start, html.indexOf(';\n', start) + 1);
}
const S = new Function('document', `
  ${['MA_SEG', 'MA_POP', 'MA_ROW_COLS', 'MA_ROW_GAP', 'MA_ROW_CELLS', 'ME_C'].map(constSrc).join('\n')}
  ${['escapeHtml', 'fhEsc', 'maSeg', 'maPopFrame', 'maPopEscKey', 'maPopNoReplay', 'maMatchRowsHtml', 'maTipHtml', 'fhSheetSeg', 'meSegHtml', 'mePopShell'].map(slice).join('\n')}
  return { maSeg, maPopFrame, maPopEscKey, maPopNoReplay, maMatchRowsHtml, maTipHtml, fhSheetSeg, meSegHtml, mePopShell };
`);
const api = doc => S(doc || { querySelectorAll: () => [] });
const U = api();

// CSS declarations of one inline style string → { prop: value }.
const decl = style => Object.fromEntries(style.split(';').map(d => d.trim()).filter(Boolean).map(d => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]));
const styles = h => [...h.matchAll(/style="([^"]*)"/g)].map(m => decl(m[1]));
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));
// The design file's seg: the sc-for line of `list`, its track = the enclosing <div …> (same line or the line above).
function dfSeg(list) {
  const i = DF.findIndex(l => l.includes(`list="{{ ${list} }}"`));
  assert.ok(i > 0, `DF ${list}`);
  const item = decl(/<span class="seg"[^>]*style="([^"]*)"/.exec(DF[i])[1]);
  const trackLine = /<div style="([^"]*)"><sc-for/.test(DF[i]) ? DF[i] : DF[i - 1];
  const track = decl([...trackLine.matchAll(/<div style="([^"]*)"/g)].pop()[1]);
  return { track, item };
}
const TRACK = ['gap', 'padding', 'border-radius'], ITEM = ['padding', 'border-radius', 'font-size'];
const items = [{ label: 'A', on: true, onclick: 'x()' }, { label: 'B', on: false, onclick: 'y()' }, { label: 'C', disabled: true, title: 'No "stats"' }];

// Mutation: a seg geometry drifts from the file (e.g. the sheet item radius 7 → 8, the Market edge track padding 2 → 3).
test('maSeg: the file\'s seg geometries — sheet (DF L1688), pbp (DF L1724), Market edge (DF L1524/1804), README §4.1', () => {
  for (const [style, list] of [['sheet', 'analysis.form.sheet.scopeTabs'], ['pbp', 'analysis.form.sheet.pbpTabs'], ['me', 'analysis.me.linePop.scopeTabs'], ['me', 'analysis.me.viewTabs']]) {
    const want = dfSeg(list), got = styles(U.maSeg(style, items));
    assert.deepEqual(pick(got[0], TRACK), pick(want.track, TRACK), `${style} track vs ${list}`);
    assert.deepEqual(pick(got[1], ITEM), pick(want.item, ITEM), `${style} item vs ${list}`);
  }
  const r41 = README.slice(README.indexOf('### 4.1'), README.indexOf('### 4.2'));
  const got = styles(U.maSeg('readme', items));
  assert.ok(r41.includes(`gap ${got[0].gap}`) && r41.includes(`padding ${got[0].padding}`) && r41.includes(`radius ${parseInt(got[0]['border-radius'])}`), 'README §4.1 track');
  assert.ok(r41.includes(`padding ${got[1].padding}`) && r41.includes(`radius ${parseInt(got[1]['border-radius'])}`) && r41.includes(got[1]['font-size'].replace('px', 'px')), 'README §4.1 item');
});

// Mutation: the selected item loses the selected tile, the disabled item stays clickable, or the 140ms transition is dropped.
test('maSeg: selected = the selected-segment tile + primary text, 700; disabled not clickable; 140ms bg/colour/border transitions', () => {
  const h = U.maSeg('sheet', items), [, on, off, dis] = styles(h);
  // colours = TEN-376 foundation (README §5.1 "Darker track", foundation.md): track --card + 1px --edge-6,
  // selected --inner + 1px --edge-10 with white 700 text, idle --text-label on no fill
  assert.deepEqual([on['font-weight'], on.color, on.background, on.border], ['700', 'var(--text)', 'var(--inner)', '1px solid var(--edge-10)']);
  assert.deepEqual([off['font-weight'], off.color, off.background, off.border], ['600', 'var(--text-label)', 'transparent', '1px solid transparent']);
  for (const style of ['sheet', 'pbp', 'me', 'readme', 'ov']) {
    const [track, sel] = styles(U.maSeg(style, items));
    assert.deepEqual([track.background, track.border, sel.background, sel.border], ['var(--card)', '1px solid var(--edge-6)', 'var(--inner)', '1px solid var(--edge-10)'], `${style}: the darker track`);
  }
  assert.ok(/aria-disabled="true"/.test(h) && !/onclick="undefined"/.test(h) && dis.cursor === 'not-allowed');
  assert.ok(h.includes('title="No &quot;stats&quot;"'), 'the disabled tooltip is escaped');
  assert.equal((h.match(/class="(seg )?ma-seg-item"/g) || []).length, 3);
  assert.match(html, /\.ma-seg-item\{ transition:background \.14s ease, color \.14s ease, border-color \.14s ease; \}/);
});

// Mutation: fhSheetSeg / meSegHtml keep their own markup instead of the shared control, or the pbp set tabs use the scope geometry.
test('adopted: the stats sheet scope + point-by-point tabs and Market edge\'s view / scope segs are maSeg', () => {
  assert.match(U.fhSheetSeg([{ label: 'Match', on: true, onclick: 'a()' }]), /class="ma-seg" data-ma-seg="sheet" style="display:flex; width:max-content; margin:0 auto;/);
  assert.match(U.fhSheetSeg([{ label: 'Set 1', on: true, onclick: 'a()' }], 'pbp'), /data-ma-seg="pbp"/);
  assert.match(slice('fhSheetRender'), /fhSheetPbpSet\(\$\{n\},'\$\{S\.slot \|\| 'pop'\}'\)` \}\)\), 'pbp'\)/, 'the pbp set tabs ask for the pbp geometry');
  assert.match(U.meSegHtml([{ label: 'Career', on: true, onclick: 'b()' }]), /data-ma-seg="me"/);
  assert.ok(U.fhSheetSeg([{ label: '<b>', on: false, onclick: 'a()' }]).includes('&lt;b&gt;'), 'sheet labels stay escaped');
});

// Mutation: a pop-up frame value drifts from the file (radius, padding, ✕ size, title type, z-index), or mePopShell keeps its own frame.
test('maPopFrame: README §4.4 / DF L1509–1512 geometry; Market edge pop-ups are drawn by it', () => {
  const at = DF.findIndex(l => l.includes('analysis.me.linePop.onClose }}" style="position:fixed'));
  const dOver = decl(/style="([^"]*)"/.exec(DF[at])[1]), dBox = decl(/style="([^"]*)"/.exec(DF[at + 1])[1]);
  const dTitle = decl(/<span style="(font-size:17px[^"]*)"/.exec(DF[at + 3])[1]), dSub = decl(/<span style="(font-family[^"]*)"/.exec(DF[at + 3])[1]);
  const dX = decl(/<span class="seg"[^>]*style="([^"]*)"/.exec(DF[at + 4])[1]);
  const h = U.maPopFrame({ title: 'J. Sinner · Wins set 1', sub: 'All priced matches', body: '<i>b</i>', foot: 'f', maxWidth: 860, onClose: 'close()' });
  const [o, box, , , , title, sub, x] = styles(h);   // overlay, box, header row, title column, title line, title, sub, ✕
  assert.deepEqual(pick(o, ['position', 'z-index', 'display', 'align-items', 'justify-content', 'padding', 'overflow-y']),
    pick(dOver, ['position', 'z-index', 'display', 'align-items', 'justify-content', 'padding', 'overflow-y']));
  // the file's inset:0, starting at the sidebar's edge so the sidebar is never dimmed (founder R6.5, TEN-376)
  assert.equal(o.inset, '0 0 0 var(--sf-side, 0px)');
  // TEN-376 U5: overlays dim with --backdrop (rgba(9,11,18,0.65), measured on OFFICIAL VERSION 1) + blur(3px)
  assert.deepEqual([o.background, o['backdrop-filter']], ['var(--backdrop)', 'blur(3px)'], 'the one scrim');
  assert.deepEqual(pick(box, ['position', 'width', 'max-width', 'border-radius', 'padding', 'display', 'flex-direction', 'gap']),
    pick(dBox, ['position', 'width', 'max-width', 'border-radius', 'padding', 'display', 'flex-direction', 'gap']));
  assert.deepEqual(pick(title, ['font-size', 'font-weight', 'letter-spacing']), pick(dTitle, ['font-size', 'font-weight', 'letter-spacing']));
  assert.equal(sub['font-size'], dSub['font-size']);
  assert.deepEqual(pick(x, ['width', 'height', 'flex', 'border-radius', 'font-size']), pick(dX, ['width', 'height', 'flex', 'border-radius', 'font-size']));
  const me = U.mePopShell('T', '', 's', '<i></i>', 'f', "meSet({meBand:null})");
  assert.ok(/class="ma-pop-overlay ma-fade me-pop-overlay"/.test(me) && /class="ma-pop ma-sigin me-pop"/.test(me) && /class="seg ma-pop-x me-x"/.test(me));
  // DF L1518 box, re-coloured by TEN-376: the pop-up is --card on a 1px edge (all borders 1px — no 1.25px)
  assert.ok(me.includes('max-width:860px') && /background:var\(--card\); border:1px solid var\(--(?:line|edge-\d+)\);/.test(me), "Market edge's spec values");
});

// Mutation: the outside-click guard dropped (every inner click closes), or the ✕ loses its close handler.
test('maPopFrame: outside click closes, an inner click does not; ✕ closes', () => {
  let closed = 0; const close = () => { closed++; };
  const h = U.maPopFrame({ title: 't', sub: 's', body: '', onClose: 'close()' });
  const over = new Function('event', 'close', /class="ma-pop-overlay[^"]*" onclick="([^"]*)"/.exec(h)[1]);
  const el = {};
  over.call(el, { target: el }, close); assert.equal(closed, 1, 'a click on the scrim closes');
  over.call(el, { target: {} }, close); assert.equal(closed, 1, 'a click inside the box does not');
  new Function('close', /class="seg ma-pop-x"[^>]*onclick="([^"]*)"/.exec(h)[1])(close); assert.equal(closed, 2, '✕ closes');
});

// Mutation: maPopEscKey closes the first frame instead of the topmost, ignores Escape, or the listener is never registered.
test('Esc closes the topmost frame through its ✕; other keys do nothing; one listener, bubble phase', () => {
  const log = [];
  const frame = id => ({ querySelector: s => (s === '.ma-pop-x' ? { click: () => log.push(id) } : null) });
  const E = api({ querySelectorAll: s => (s === '.ma-pop-overlay' ? [frame('under'), frame('top')] : []) });
  E.maPopEscKey({ key: 'Enter' }); assert.deepEqual(log, []);
  E.maPopEscKey({ key: 'Escape' }); assert.deepEqual(log, ['top']);
  api({ querySelectorAll: () => [] }).maPopEscKey({ key: 'Escape' });   // nothing open: no throw
  assert.match(html, /\ndocument\.addEventListener\('keydown', maPopEscKey\);\n/);
  assert.ok(!/_me\.S\.meBand \|\| _me\.S\.meLine\)\) return;\n  meSet\(\{ meBand: null, meLine: null \}\);/.test(html), 'Market edge has no second Esc listener');
});

// Mutation: the sigIn keyframes / .ma-sigin / .ma-fade values drift from README §6, or the frame loses its motion classes.
test('motion: sigIn (opacity 0→1, translateY −6→0, 200ms cubic-bezier(.2,.7,.3,1)), overlay fade 120ms; no replay on re-render', () => {
  const df = DF.join('\n');
  const dfKey = /@keyframes sigIn\{[^\n]*\}\s*\}/.exec(df)[0].replace(/\s+/g, '');
  const ours = /@keyframes sigIn\{[^\n]*\}\s*\}/.exec(html);
  assert.ok(ours, 'sigIn keyframes in the page'); assert.equal(ours[0].replace(/\s+/g, ''), dfKey);
  assert.match(html, /\.ma-sigin\{ animation:sigIn \.2s cubic-bezier\(\.2,\.7,\.3,1\); \}/);
  assert.match(html, /\.ma-fade\{ animation:maFade \.12s ease; \}/);
  assert.match(html, /@keyframes maFade\{ from\{ opacity:0; \} to\{ opacity:1; \} \}/);
  const h = U.maPopFrame({ title: 't', sub: 's', onClose: 'c()' });
  assert.ok(/class="ma-pop-overlay ma-fade"/.test(h) && /class="ma-pop ma-sigin"/.test(h));
  const removed = [], el = { classList: { remove: (...c) => removed.push(...c) } };
  U.maPopNoReplay({ querySelectorAll: () => [el] }); assert.deepEqual(removed, ['ma-sigin', 'ma-fade']);
  assert.match(slice('meRenderPop'), /if \(popKey && popKey === E\._popKey\) maPopNoReplay\(host\);/);
});

// Mutation: the match-row grid drifts from README §5 (TEN-380 step-3 handoff: `40px 10px minmax(78px,1.1fr) 28px 34px
// minmax(86px,1.3fr) 38px 38px; gap 0 6px`, header and rows — the handoff is not in the repo, so the README's string is
// quoted here), the header stops being sticky, or a row loses its sheet opener. Position, padding and the group header
// still read the file's Tournament-tab rows (DF L302 / L312).
const README5_GRID = '40px 10px minmax(78px,1.1fr) 28px 34px minmax(86px,1.3fr) 38px 38px', README5_GAP = '0 6px';
test('maMatchRowsHtml: README §5 grid (TEN-380) — sticky --card header, grouped by event, every row opens the sheet', () => {
  const at = DF.findIndex(l => l.includes('position:sticky; top:0; z-index:5; display:grid; grid-template-columns:48px'));
  const dHead = decl(/style="([^"]*)"/.exec(DF[at])[1]);
  const dRow = decl(/<div class="seg" onClick="\{\{ r\.onClick \}\}" style="([^"]*)"/.exec(DF.slice(at, at + 20).join('\n'))[1]);
  const dGroup = decl(/<div style="(display:flex; align-items:center; gap:10px; padding:11px[^"]*)"/.exec(DF.slice(at, at + 20).join('\n'))[1]);
  const h = U.maMatchRowsHtml([{ title: 'Washington 2025', meta: 'Won · 5–0', rows: [
    { date: '02.08.', won: true, opp: 'A. Rublev', rd: 'F', sets: '2 - 0', scores: '6-4, 6-3', h: '1.40', a: '3.10', click: ` onclick="fhOpenSheet('m1')"` },
    { date: '01.08.', won: false, opp: 'T. Paul', rd: 'SF', sets: '1 - 2', scores: '6-7(5), 6-3, 4-6', h: '1.55', a: '2.50', click: ` onclick="fhOpenSheet('m2')"`, selected: true }] }]);
  const st = styles(h);
  const head = st.find(s => s.position === 'sticky');
  assert.deepEqual(pick(head, ['position', 'top', 'z-index', 'display', 'padding']), pick(dHead, ['position', 'top', 'z-index', 'display', 'padding']));
  assert.deepEqual([head['grid-template-columns'], head.gap, head.background, head['border-bottom']], [README5_GRID, README5_GAP, 'var(--card)', '1px solid var(--line)'],
    'README §5 grid; the head --card on a 1px --line rule (decisions §1: the reference measures 5%)');
  const rows = st.filter(s => s['grid-template-columns'] && s.position !== 'sticky');
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.deepEqual(pick(r, ['display', 'align-items', 'padding', 'border-radius']), pick(dRow, ['display', 'align-items', 'padding', 'border-radius']));
    assert.deepEqual([r['grid-template-columns'], r.gap], [README5_GRID, README5_GAP], 'header and rows share the README §5 grid');
  }
  assert.match(h, />Score</, 'the column is "Score" (README §5, was "Set scores")');
  assert.match(h, /<span class="ma-row-score" style="[^"]*color:var\(--text-label\);/, 'Score its own --text-label cell');
  assert.deepEqual(pick(st.find(s => s.padding === dGroup.padding), ['display', 'gap', 'padding']), pick(dGroup, ['display', 'gap', 'padding']));
  assert.ok(h.includes(`class="seg ma-row" onclick="fhOpenSheet('m1')"`) && h.includes(`onclick="fhOpenSheet('m2')"`), 'every row opens the sheet');
  // TEN-376: selection is lift (tone), never blue — the selected row (its sheet open) takes --selected
  assert.ok(h.includes('background:var(--selected)'), 'the selected row (its sheet open) = --selected');
  assert.equal((h.match(/background:var\(--selected\)/g) || []).length, 1, 'only the selected row is lifted');
  assert.ok(h.includes('>Washington 2025<') && h.includes('>Won · 5–0<'));
  assert.match(html, /\.ma-row:hover\{ background:color-mix\(in srgb, var\(--text\) 3%, transparent\) !important; \}/, 'hover wash = DF style-hover white 0.03 as a token + opacity');
});

// Mutation: the tooltip's 120ms opacity / raised surface / mono 11px drift, or maTipHtml stops emitting the class pair.
test('tooltip: .elotip-pop — 120ms opacity, raised surface, strong hairline, mono 11px (README §6)', () => {
  const css = /\.elotip-pop\{([^}]*)\}/.exec(html);
  assert.ok(css, '.elotip-pop rule');
  const c = decl(css[1].replace(/\s+/g, ' '));
  assert.equal(c.transition, 'opacity .12s ease');
  assert.deepEqual([c.opacity, c.visibility], ['0', 'hidden']);
  // TEN-376: a floating layer is --card on a 1px --edge-10 with the menu shadow (DF L950's raised #11151f / white 0.14 re-mapped)
  assert.equal(c.background, 'var(--card)');
  assert.equal(c.border, '1px solid var(--edge-10)');
  assert.equal(c['box-shadow'], 'var(--shadow-menu)');
  // DF L950: the pop takes the UI font (its markup sets mono spans itself); a plain-text body gets README §6's mono 11px
  assert.deepEqual([c['font-family'], c['font-size']], ["'Hanken Grotesk',sans-serif", '11px']);
  assert.match(U.maTipHtml('x', 'plain words'), /<span style="font-family:'IBM Plex Mono',monospace; font-size:11px;">plain words<\/span>/);
  assert.match(html, /\.elotip:hover \.elotip-pop, \.elotip:focus-within \.elotip-pop\{ opacity:1; visibility:visible; \}/);
  assert.match(U.maTipHtml('<b>x</b>', 'tip'), /^<span class="elotip"[^>]*><b>x<\/b><span class="elotip-pop" role="tooltip"[^>]*><span style="[^"]*">tip<\/span><\/span><\/span>$/);
});

// Mutation: the sheet's Esc listener loses capture:true or stopPropagation (one Esc would close the sheet AND the
// Market edge pop-up under it — review 2026-09-28), or closing the modal leaves #mePop behind.
test('Esc closes the topmost layer only: the stats sheet (capture phase, stops the event) before any pop-up frame; closing the modal clears both', () => {
  const H = readFileSync(process.env.TEN314_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
  assert.ok(H.includes("document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && _fh && _fh.sheet){ ev.stopPropagation(); fhCloseSheet(); } }, true);"), 'sheet: capture phase + stopPropagation');
  const at = H.indexOf('\nfunction closeAnalysisModal(');
  const close = H.slice(at, H.indexOf('\n', at + 1));
  assert.ok(close.includes('fhCloseSheet()') && close.includes("const mp = document.getElementById('mePop'); if (mp) mp.innerHTML = '';"));
});

// The Key factors hold-rate check (founder Q9: the Tournament tab's box-score cell, n in the tooltip) lives in test-ten341-key-factors.mjs.

// Component diff 2026-09-29 (tools/ten312-component-diff.mjs): with no line-height of its own the rows inherited a
// host section's 21px and drifted down (Tournament instance 157 vs the design's 147 px tall).
// Mutation: drop `line-height:normal` from the .ma-rows root.
test('match rows: the root sets line-height:normal, so a host section cannot stretch the rows', () => {
  const h = U.maMatchRowsHtml([{ name: 'X', meta: 'm', rows: [{ date: '1', opp: 'o', rd: 'R', sets: '2-0', scores: '6-1', h: '1.5', a: '2.5', won: true }] }]);
  const root = /^<div class="ma-rows" style="([^"]*)"/.exec(h);
  assert.ok(root, '.ma-rows root');
  assert.equal(decl(root[1])['line-height'], 'normal');
});

// Founder 2026-09-29: Form's 14px list inset is a PARAMETER of the shared rows, not a second renderer (DF L1102–1128:
// header 8px 14px 7px, group heads 11px 14px 5px, each row in an 8px side pad; same grid, same colours). TEN-330 passes
// { headPad, groupPad, inset: 8 }. Mutation: maMatchRowsHtml ignores headPad / inset.
test('match rows: the Form geometry = options on the same renderer', () => {
  const g = [{ title: 'X', meta: 'm', rows: [{ date: '1', opp: 'o', rd: 'R', sets: '2-0', scores: '6-1', h: '1.5', a: '2.5', won: true }] }];
  const t = U.maMatchRowsHtml(g), f = U.maMatchRowsHtml(g, { headPad: '8px 14px 7px', groupPad: '11px 14px 5px', inset: 8 });
  const pad = (h, cls) => decl(new RegExp(`class="${cls}" style="([^"]*)"`).exec(h)[1]).padding;
  assert.deepEqual([pad(t, 'ma-rows-head'), pad(t, 'ma-rows-group')], ['6px 6px 7px', '11px 6px 5px']);
  const f2 = U.maMatchRowsHtml(g, { headPad: '10px 14px 8px', groupPad: '11px 14px 5px', inset: 8 });
  assert.deepEqual([pad(f2, 'ma-rows-head'), pad(f2, 'ma-rows-group')], ['10px 14px 8px', '11px 14px 5px']);
  assert.deepEqual([pad(f, 'ma-rows-head'), pad(f, 'ma-rows-group')], ['8px 14px 7px', '11px 14px 5px']);
  assert.match(f, /style="transition:opacity \.12s; padding:0 8px;"><div class="seg ma-row"/);
  assert.ok(!/padding:0 8px;/.test(t), 'the Tournament rows are not wrapped');
  assert.match(html, /maMatchRowsHtml\(groups, \{ headPad: '10px 14px 8px', groupPad: '11px 14px 5px', inset: 8,/, 'the Form tab passes the reference Form geometry (TEN-380: head 10px 14px 8px)');
});

// DF L1706: the sheet's caption strip keeps its 1px border box. TEN-380 (step 3 reference): the band is --inner with no
// edge, so the 1px border is transparent (the geometry stays); the caption is a Hanken caps label at 800.
// Mutation: drop the border (rows sit 2px higher), or the band back on a visible edge.
test('sheet caption strip: --inner band, a 1px transparent border (no edge); the caption is a Hanken caps label', () => {
  const f = /\nfunction fhSheetSectionHead\(t\)\{[^\n]*/.exec(html);
  assert.ok(f, 'fhSheetSectionHead');
  assert.match(f[0], /background:var\(--inner\); border:1px solid transparent;/);
  assert.match(f[0], /font-family:var\(--font-words\); font-size:10\.5px; font-weight:800; letter-spacing:0\.10em; text-transform:uppercase; color:var\(--text-label\);/);
});

// Review 2026-09-29 (merge onto TEN-330): the Form list's sticky header and its card are one shade, as DF L1101–1102
// draw them (#0a0d14 both). Mutation: the card back to var(--surface) (the header draws as a lighter band in Night).
test('Form list: the sticky header and its card share the design shade', () => {
  const card = /<div class="fh-fcard" style="([^"]*)"/.exec(html);
  assert.ok(card, 'the Form card');
  const head = /class="ma-rows-head" style="[^"]*background:\$\{o\.bg \|\| '([^']+)'\}/.exec(html);
  assert.ok(head, 'the rows header default');
  assert.equal(decl(card[1]).background, head[1]);
});

// DoD item 8 (founder 2026-09-29): the modal draws ONE tooltip component, the design's `.elotip-pop` (DF L950). The
// positioned mode (data-aotip: Odds, Weather, Market edge, News counts) creates the same class and carries no styling
// of its own; News's group count uses it instead of a native title.
// Mutations: aOddsTipEl styles its own box again (inline background/border), or the News count goes back to title=.
test('one tooltip component: the positioned mode is the shared .elotip-pop, and News uses it', () => {
  const el = /\nfunction aOddsTipEl\(\)\{[\s\S]*?\n\}\n/.exec(html);
  assert.ok(el, 'aOddsTipEl');
  assert.match(el[0], /t\.className = 'elotip-pop ma-tip-float';/);
  assert.ok(!/cssText|background:|border:/.test(el[0]), 'no tooltip styling outside the shared .elotip-pop rule');
  assert.equal((html.match(/\n  \.elotip-pop\{/g) || []).length, 1, 'one CSS source');
  // review: the positioned mode must be VISIBLE (the base .elotip-pop is opacity 0 / hidden until :hover) — mutation:
  // drop `opacity:1; visibility:visible;` from the float rule (every Odds / Weather / News tooltip invisible)
  const fl = /\.elotip-pop\.ma-tip-float\{([^}]*)\}/.exec(html);
  assert.ok(fl, 'the float rule');
  assert.deepEqual([decl(fl[1]).position, decl(fl[1]).opacity, decl(fl[1]).visibility], ['fixed', '1', 'visible']);
  // a plain-text body gets the same mono 11px as maTipHtml — mutation: drop the wrap in aOddsTipShow
  assert.match(slice('aOddsTipShow'), /\/\^\\s\*<\/\.test\(body\) \? body : `<span style="font-family:'IBM Plex Mono',monospace; font-size:11px;">\$\{body\}<\/span>`/);
  // News arms the shared listener itself (only News opened) — mutation: drop the call from A_TAB_BUILD.news
  assert.match(html, /  news\(m\)\{[\s\S]{0,400}?if \(typeof initAOddsTips === 'function'\) initAOddsTips\(\);/);
  assert.match(html, /<span class="anews-gcount" tabindex="0" data-aotip="/);
  assert.ok(!/class="anews-gcount" title=/.test(html));
});
