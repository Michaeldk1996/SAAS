// TEN-336 — Market edge on the TEN-312 design file (`Match Analysis Progression v1.dc.html`, meFor DF L3359 + template
// L1516–1598, L1801–1880) and on the shared helpers (DoD item 8). Runs the page's own renderer and data layer (sliced out
// of bsp-consult-dashboard.html by tools/ten310-harness.mjs) with the real market-edge-core.js over the frozen TEN-310
// fixtures (Sinner 2072, Alcaraz 2382). Every test names the mutation that must turn it red (tools/test-ten336-mutants.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUI, HTML, slice, constSrc } from './tools/ten310-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FX = join(HERE, 'tools/fixtures/ten310');
const rd = (f) => JSON.parse(readFileSync(join(FX, f), 'utf8'));
// TEN-376 Foundation: match-analysis-tokens.css is deleted; every colour is a token of the ONE file tokens.css.
const TOKENS = readFileSync(join(HERE, 'tokens.css'), 'utf8');
const ui = buildUI();
const M = { id: 'upcoming-x', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: 2072, p2Key: 2382, date: '2026-09-27',
  tour: 'ATP Beijing', tournamentRound: 'ATP Beijing - Final', tourBadge: 'ATP', bestOdds: { p1: { price: 1.54 }, p2: { price: 2.62 } } };
const rows = [['2072', 'J. Sinner'], ['2382', 'C. Alcaraz']].map(([k, n]) => ui.meRowsFor(rd(`career-history-${k}.json`).matches, ui.fhParseCloses(rd(`match-closes-${k}.json`)), k, n));
// The Market edge block of the page (TEN-310 header → the Tournament sub-tab).
const BLOCK = HTML.slice(HTML.indexOf('// TEN-310 · MATCH ANALYSIS → MARKET EDGE TAB'), HTML.indexOf('/* ---------- TOURNAMENT SUB-TAB ---------- */'));

// Mutation: put a tab-local row or tooltip renderer back (meRowsHtml / meTableHead / meCommonCells, a data-aotip or a
// native title on a pop-up cell), or render the pop-up rows outside maMatchRowsHtml.
test('DoD 8: no tab-local row or tooltip renderer — pop-up rows are maMatchRowsHtml rows, tooltips maTipHtml', () => {
  assert.ok(BLOCK.length > 20000, 'block found');
  for (const fn of ['meRowsHtml', 'meTableHead', 'meCommonCells', 'mePillTip']) assert.ok(!new RegExp(`function ${fn}\\(`).test(BLOCK), `${fn} is deleted`);
  assert.ok(!/data-aotip|aOddsTipHtml|initAOddsTips|aOddsTipHide/.test(BLOCK), 'no TEN-303 tooltip in the tab');
  assert.ok(!/ title="/.test(BLOCK.replace(/\/\/.*$/gm, '')), 'no native title written by the tab itself');
  const R = ui.render(M, { meView: 'winner' }, rows);
  const pop = R.band('a2');
  const n = (pop.match(/data-me-row="/g) || []).length;
  assert.ok(n > 10, 'pop-up rows');
  assert.equal((pop.match(/class="seg ma-row"/g) || []).length, n, 'every pop-up row is a shared ma-row');
  assert.equal((pop.match(/onclick="meOpenRow\('/g) || []).length, n, 'every row opens the shared sheet');
  assert.equal((pop.match(/class="elotip ma-row-tip"/g) || []).length, n, 'every price carries the shared tooltip');
  assert.match(pop, /<span class="elotip-pop" role="tooltip"[^>]*><span style="font-family:'IBM Plex Mono',monospace; font-size:11px;">Pinnacle close · /);
  assert.ok(!/ title="/.test(pop), 'no native browser tooltip in the rendered pop-up (the file draws none)');
  const line = R.line('a|0', 'all');
  assert.equal((line.match(/class="seg ma-row"/g) || []).length, (line.match(/data-me-row="/g) || []).length, 'line pop-up rows too');
  assert.ok(!/ title="/.test(line), 'nor in the line pop-up');
});

// Mutation: default meView back to 'lines' (the design file's own default, DF L3374).
test('D3: a fresh modal opens Market edge on Match winner (the Price sensitivity card first)', () => {
  const R = ui.render(Object.assign({}, M, { id: 'fresh' }), {}, rows);
  assert.equal(R.E.S.meView, 'winner');
  assert.ok(R.html.indexOf('Price sensitivity') > 0 && !R.html.includes('Derived lines at today'), 'Match winner cards only');
});

// Mutation: any ME_C value back on a modal token (var(--ma-t1) …), a raw colour, or a token tokens.css doesn't define.
// TEN-376 Foundation supersedes the TEN-336 "design shade token" palette (fhS('<hex>') → --ma-s-<hex>): every ME_C colour is
// now a tokens.css token, or a color-mix of one with transparent.
test('palette: every Market edge colour is a foundation token that tokens.css defines', () => {
  const src = constSrc('ME_C');
  const C = new Function(`${src}\nreturn ME_C;`)();
  // cardLine is 'transparent': the top-level tab card has no outline, top-light only (founder R5, TEN-376)
  assert.equal(C.cardLine, 'transparent', 'top-level Market edge card: no outline');
  const colours = Object.entries(C).filter(([k]) => k !== 'hw' && k !== 'cardLine');
  assert.ok(colours.length >= 24, 'every ME_C colour role is still there');
  // README §5.8 / R6.3 "Dotted guides": no area fill, no loss wash, no vertical tick lines
  for (const k of ['aFill', 'bFill', 'loss', 'tick']) assert.ok(!(k in C), `ME_C.${k} is gone (no area fill / wash / vertical gridlines)`);
  assert.deepEqual([C.grid, C.zero, C.panelLine], ['var(--viz-guide)', 'var(--viz-rule)', 'var(--edge-6)']);
  assert.ok(!/fhS\(|--ma-|#[0-9a-f]{3,8}\b|rgba?\(/i.test(src), 'no deleted helper, modal token or raw colour left in ME_C');
  for (const [k, v] of colours) {
    assert.match(v, /^(var\(--[a-z0-9-]+\)|color-mix\(in srgb, var\(--[a-z0-9-]+\) [\d.]+%, transparent\))$/, `ME_C.${k} = a token or token + opacity: ${v}`);
    const t = /var\((--[a-z0-9-]+)\)/.exec(v)[1];
    assert.ok(new RegExp(`^\\s*${t}:`, 'm').test(TOKENS), `ME_C.${k}: ${t} defined in tokens.css`);
  }
  // players neutral: A primary white, B the label grey; up/down green / red on signed values; "blue" accent TEXT is white
  // (blue is a fill, never text — foundation.md)
  assert.equal(C.text, 'var(--text)'); assert.equal(C.b, 'var(--text-label)');
  assert.deepEqual([C.up, C.dn], ['var(--pos)', 'var(--neg)']); assert.equal(C.blue, 'var(--text)');
  assert.equal(C.hw, '1px', 'all borders 1px (no 0.33px hairline)');
});

// Mutation: the card back on 1.25px, a 0.33px hairline back, the pane padding back, the column-head rule back to the row rule.
// TEN-376 Foundation: "All edges 1px solid (no 0.33px, no 1.25px)" supersedes the file's 1.25px card / 0.33px rules.
test('geometry: card without an outline (top-light only, R5), no pane padding, column heads on the --line rule (DF L1817, L1802)', () => {
  const R = ui.render(M, { meView: 'winner' }, rows);
  assert.match(R.html, /class="me-card me-price" style="background:var\(--card\); border:1px solid transparent; box-shadow:var\(--top-light\);/);
  assert.match(R.html, /<div class="me-pane" style="font-family:/);
  assert.match(R.html, /padding:0 8px 7px; border-bottom:1px solid var\(--line\);/);
  assert.ok(!/0\.33px|1\.25px/.test(R.html + R.band('a2') + R.line('a|0', 'all')), 'no 0.33px / 1.25px edge anywhere in the tab');
});

// Mutation: the wash only on today's band (drop `|| on`).
test('band rows: the open band takes the today wash too, the ring stays on today only (DF L3443)', () => {
  const R = ui.render(M, { meView: 'winner', meBand: 'a0' }, rows);
  const row = (k) => { const i = R.html.indexOf(`data-me-band="${k}"`); return R.html.slice(R.html.lastIndexOf('<div', i), R.html.indexOf('>', i)); };
  assert.match(row('a0'), /background:var\(--selected\); box-shadow:inset 0 0 0 1px transparent;/);   // TEN-376: the wash = --selected (selection is lift, never blue)
  assert.match(row('a1'), /background:transparent;/);
});

// Mutation: the pill loses its tooltip, or the tooltip is not the shared one.
test('pill: CLOSING ODDS, its book split through the shared tooltip', () => {
  const R = ui.render(M, { meView: 'winner' }, rows);
  assert.ok(!/sample data/i.test(R.html), 'no SAMPLE DATA chip');
  const i = R.html.indexOf('class="me-pill"'); assert.ok(i > 0);
  const wrap = R.html.slice(R.html.lastIndexOf('<span class="elotip"', i), R.html.indexOf('</span></span></span></span>', i));
  assert.ok(wrap.startsWith('<span class="elotip"'), 'wrapped by maTipHtml');
  assert.match(wrap, /Closing odds<\/span>/); assert.match(wrap, />Pinnacle<\/span><span[^>]*>\d+</); assert.match(wrap, />Latest match<\/span>/);
});

// Mutation: the helper's table variant keeps a group header for a titleless group, loses the right alignment of the
// price columns, or drops the row hairline; or the default path changes. TEN-376 re-pinned the byte hashes: the only
// change from origin/main's (390b2855…/ec347dae…/a4bd83e4…/dc50321a…) is inside style="" — colours → tokens.css, edges
// 1px, caps labels Hanken 10.5/700 — proven by the style-stripped hashes, which are origin/main's output unchanged.
test('maMatchRowsHtml: the pop-up table variant is a parameter; the default rows are unchanged but for TEN-376 styling', () => {
  const make = new Function(`${constSrc('MA_ROW_COLS')}\n${constSrc('MA_ROW_CELLS')}\n${['escapeHtml', 'maTipHtml', 'maMatchRowsHtml'].map((n) => slice(n)).join('\n')}\nreturn maMatchRowsHtml;`);
  const rowsFn = make();
  const groups = [{ title: 'Washington', meta: 'Hard · ATP 500', metaTitle: 'tip', cls: 'g1', rows: [
    { date: '18.07', won: true, opp: 'A. Rinderknech', oppTitle: 'Arthur', rd: 'R16', sets: '2–0', scores: '6-4 6-3', h: '1.30', a: '—', click: ` onclick="x('1')"`, attrs: ' data-k="1"', cls: 'c', wrapCls: 'w', hMark: 'P', selected: true },
    { date: '17.07', won: false, opp: 'B. Shelton', rd: 'R32', sets: '1–2', scores: '6-4 3-6 6-7', h: '—', a: '2.10', setsColor: 'red' }] },
    { title: 'Cincinnati', divBefore: true, rows: [{ date: '01.08', won: null, opp: 'X', rd: 'F', sets: '—', scores: '', h: '—', a: '—' }] }];
  const opts = [{}, { headPad: '8px 14px 7px', groupPad: '11px 14px 5px', inset: 8, divider: '<hr>' },
    { labels: ['Date', '', 'Opponent', 'Rd', 'Sets', 'Set scores', 'Home', 'Away'], headPad: '8px 14px 7px', groupPad: '11px 14px 5px', inset: 8, rowPad: '0 8px 2px' }, { empty: 'Nothing' }];
  const h = (o) => createHash('sha256').update(rowsFn(groups, o) + '\u0000' + rowsFn([], o)).digest('hex').slice(0, 16);
  const hs = (o) => createHash('sha256').update((rowsFn(groups, o) + '\u0000' + rowsFn([], o)).replace(/ style="[^"]*"/g, '')).digest('hex').slice(0, 16);
  assert.deepEqual(opts.map(hs), ['dc7da0cbed9fc1e7', '15f8d3cc27dc6054', 'c02943b2aa8da0f7', 'd8623a4a6ddd9e34'], 'Form / H2H / Tournament rows: markup and text = origin/main');
  assert.deepEqual(opts.map(h), ['871918641aaa28b9', 'f30d922a1fb9b22a', '080f9262f93128fa', '59179e6b29ee2f1c'], 'Form / H2H / Tournament rows unchanged (TEN-376 styling)');
  const t = rowsFn([{ title: null, rows: [{ date: '05.09.25', won: false, opp: 'J. Draper', event: 'US Open', rd: 'QF', score: '4-6 3-6', price: '1.55', priceTip: 'Pinnacle close · Tennis-Data', oppPrice: '2.60', pnl: '−1.00u' }] }],
    { cols: ['date', 'sq', 'opp', 'event', 'rd', 'score', 'price', 'oppPrice', 'pnl'], grid: '64px 10px 1fr', labels: ['Date', '', 'Opponent', 'Event', 'Rd', 'Score', 'Price', 'Opp', 'P&L'], inset: 22 });
  assert.ok(!t.includes('ma-rows-group'), 'a titleless group draws no group header');
  assert.ok(!rowsFn([{ title: null, rows: groups[0].rows }], {}).includes('ma-rows-group'), 'nor on the default rows');
  assert.match(t, /padding:7px 28px 6px; border-top:1px solid var\(--line\); border-bottom:1px solid var\(--line\);/);
  assert.equal((t.match(/text-transform:uppercase; font-weight:700; color:var\(--text-label\); text-align:right;/g) || []).length, 3, 'Price / Opp / P&L heads right-aligned');
  assert.match(t, /<div class="" style="padding:0 22px;"><div class="seg ma-row"/);
  assert.match(t, /cursor:pointer; border-bottom:1px solid color-mix\(in srgb, var\(--text\) 3%, transparent\);/);
  assert.match(t, /P&amp;L/); assert.match(t, /color:var\(--neg\);">−1\.00u</);
  assert.ok(!t.includes('position:sticky'), 'the pop-up table head does not stick');
});

// Mutation: the best-of override leaves the Slam-name retirement guess in place (the pre-TEN-336 line), leaves the
// deciding-set flag from the guess, or lets a walkover read as retired.
test('data: a best-of-3 recorded at a Slam-named event is a complete match, in the Derived lines', () => {
  const x = { date: '2025-09-05', level: 'atp', tournament: 'US Open', round: 'Quarter-finals', opponent: 'J. Draper', result: '2 - 0', won: true,
    eventKey: 1, src: 'fixtures', bestOf: 3, sets: [{ p: 6, o: 4 }, { p: 6, o: 3 }] };
  const [r] = ui.meRowsFor([x], null, '9', 'A. Test');
  assert.deepEqual([r.bo, r.ret, r.complete, r.decider], [3, false, true, false]);
  const three = ui.meRowsFor([Object.assign({}, x, { result: '2 - 1', sets: [{ p: 6, o: 4 }, { p: 3, o: 6 }, { p: 6, o: 3 }] })], null, '9', 'A. Test')[0];
  assert.deepEqual([three.ret, three.complete, three.decider], [false, true, true], 'a third set decides a best-of-3');
  const wo = ui.meRowsFor([Object.assign({}, x, { result: '0 - 0', sets: [], walkover: true, retired: true })], null, '9', 'A. Test')[0];
  assert.equal(wo.ret, false, 'a walkover is never a retirement');
  const five = ui.meRowsFor([Object.assign({}, x, { bestOf: 5, tournament: 'Washington' })], null, '9', 'A. Test')[0];
  assert.deepEqual([five.bo, five.ret, five.complete], [5, true, false], 'a Bo5 winner short of three sets still stopped');
  const ret = ui.meRowsFor([Object.assign({}, x, { retired: true })], null, '9', 'A. Test')[0];
  assert.equal(ret.ret, true, 'the feed flag still stands');
});

// Mutation: the shared pop-up frame's foot back on the deleted 12a var(--label).
// TEN-376: the file's #4B5672 foot shade (--ma-s-4b5672) is now the foundation label grey --text-label.
test('pop-up foot on the label grey --text-label (DF L1512 / L1543 #4B5672 → foundation)', () => {
  const R = ui.render(M, { meView: 'winner' }, rows);
  assert.match(R.band('a2'), /<span class="ma-pop-foot" style="font-size:11px; color:var\(--text-label\);">Every match/);
});
