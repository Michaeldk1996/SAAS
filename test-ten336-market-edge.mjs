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
  // hiBd is 'transparent' too: the top-2 In band cells are --wash-4 with no edge (TEN-380, decisions §1)
  assert.equal(C.hiBd, 'transparent'); assert.equal(C.hiBg, 'var(--wash-4)');
  // ring is 'transparent': today's band has no ring (founder Q2, 2026-10-03: a neutral --wash-5 wash only)
  assert.equal(C.ring, 'transparent'); assert.equal(C.wash, 'var(--wash-5)');
  const colours = Object.entries(C).filter(([k]) => k !== 'hw' && k !== 'cardLine' && k !== 'hiBd' && k !== 'ring');
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
  assert.match(row('a0'), /background:var\(--wash-5\); box-shadow:inset 0 0 0 1px transparent;/);   // founder Q2 (2026-10-03): the neutral --wash-5 wash
  const t = R.MM[0].tb;
  assert.match(row('a' + t), /background:var\(--wash-5\); box-shadow:inset 0 0 0 1px transparent;/, 'today: the same neutral wash, no ring, no blue');
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
// price columns, or drops the row hairline; or the default path changes. TEN-376 re-pinned the byte hashes (TEN-380 again, below): the only
// change from origin/main's (390b2855…/ec347dae…/a4bd83e4…/dc50321a…) is inside style="" — colours → tokens.css, edges
// 1px, caps labels Hanken 10.5/700 — proven by the style-stripped hashes, which are origin/main's output unchanged.
test('maMatchRowsHtml: the pop-up table variant is a parameter; the default rows are unchanged but for TEN-376 styling', () => {
  const make = new Function(`${constSrc('MA_ROW_COLS')}\n${constSrc('MA_ROW_GAP')}\n${constSrc('MA_ROW_CELLS')}\n${['escapeHtml', 'maTipHtml', 'maMatchRowsHtml'].map((n) => slice(n)).join('\n')}\nreturn maMatchRowsHtml;`);
  const rowsFn = make();
  const groups = [{ title: 'Washington', meta: 'Hard · ATP 500', metaTitle: 'tip', cls: 'g1', rows: [
    { date: '18.07', won: true, opp: 'A. Rinderknech', oppTitle: 'Arthur', rd: 'R16', sets: '2–0', scores: '6-4 6-3', h: '1.30', a: '—', click: ` onclick="x('1')"`, attrs: ' data-k="1"', cls: 'c', wrapCls: 'w', hMark: 'P', selected: true },
    { date: '17.07', won: false, opp: 'B. Shelton', rd: 'R32', sets: '1–2', scores: '6-4 3-6 6-7', h: '—', a: '2.10', setsColor: 'red' }] },
    { title: 'Cincinnati', divBefore: true, rows: [{ date: '01.08', won: null, opp: 'X', rd: 'F', sets: '—', scores: '', h: '—', a: '—' }] }];
  const opts = [{}, { headPad: '8px 14px 7px', groupPad: '11px 14px 5px', inset: 8, divider: '<hr>' },
    { labels: ['Date', '', 'Opponent', 'Rd', 'Sets', 'Set scores', 'Home', 'Away'], headPad: '8px 14px 7px', groupPad: '11px 14px 5px', inset: 8, rowPad: '0 8px 2px' }, { empty: 'Nothing' }];
  const h = (o) => createHash('sha256').update(rowsFn(groups, o) + '\u0000' + rowsFn([], o)).digest('hex').slice(0, 16);
  const hs = (o) => createHash('sha256').update((rowsFn(groups, o) + '\u0000' + rowsFn([], o)).replace(/ style="[^"]*"/g, '')).digest('hex').slice(0, 16);
  // TEN-380 (README §5) re-pinned both: the default label is "Score" (was "Set scores") and the score cell carries
  // class="ma-row-score" — the only markup / text change (diffed style-stripped against TEN-376's output); styles = the
  // README §5 grid, the --card head, the Score / H shades.
  // TEN-380 review (founder 2026-10-04) re-pinned both: the score cell's sets are whole-set nowrap spans (wrap only between
  // sets, never cut) and the Opponent / Score columns get equal shares with a 96 px Opponent floor (review 2) — diffed style-stripped against the previous output, the
  // score spans are the only markup change.
  assert.deepEqual(opts.map(hs), ['2c4c21d9a025ba0b', '379f513882cccd30', '1daa8048eea65de6', '28ca5fff8679b866'], 'Form / H2H / Tournament rows: markup and text = TEN-380 review');
  assert.deepEqual(opts.map(h), ['c2f9a2e936d1ffbc', 'f2b9079981c94f45', 'febb3d1e6c2c6c95', '197c818f09ea8988'], 'Form / H2H / Tournament rows unchanged since the TEN-380 review');
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

// ──────────────── TEN-380 (founder's locked reference, OFFICIAL VERSION 1, measured 2026-10-03) ────────────────
const txt = (h) => h.replace(/<[^>]*>/g, '\u0001').split('\u0001').map((s) => s.trim()).filter(Boolean);
const rowOf = (h, attr, key) => { const i = h.indexOf(`${attr}="${key}"`); const j = h.indexOf(`${attr}="`, i + 10); return h.slice(h.lastIndexOf('<div', i), j < 0 ? undefined : h.lastIndexOf('<div', j)); };

// Mutation: the Needs / W–L columns back, the bar back on --text, the tick colour off --viz-tick, the Edge not won − needs.
test('TEN-380 price sensitivity: "today X · N priced" on a rule; one white bar + grey Needs tick; Edge (pp) = Won − Needs', () => {
  const R = ui.render(M, { meView: 'winner' }, rows);
  const heads = [...R.html.matchAll(/class="me-phead"[^>]*border-bottom:1px solid var\(--line\);"><span[^>]*>([^<]*)<\/span><span class="me-pmeta"[^>]*>today <span[^>]*>([^<]*)<\/span> · (\d+) priced</g)].map((m) => [m[1], m[2], +m[3]]);
  assert.deepEqual(heads.map((h) => h.slice(0, 2)), [['J. Sinner', '1.54'], ['C. Alcaraz', '2.62']], 'the header price per player');
  assert.deepEqual(heads.map((h) => h[2]), R.MM.map((m) => m.priced.length), 'N priced = the model');
  const head = R.html.slice(R.html.lastIndexOf('<span', R.html.indexOf('>Price<')), R.html.indexOf('>1u stake<') + 16);
  assert.deepEqual(txt(head), ['Price', 'Won · needs', 'Won', 'Edge', '1u stake']);
  const M0 = R.MM[0];
  for (const b of M0.bands.filter((x) => x.n >= 10)) {
    const r = rowOf(R.html, 'data-me-band', 'a' + b.i);
    assert.ok(!r.includes(`>${b.w}–${b.l}<`), 'no W–L text in the row');
    const ob = R.MM[1].bands[b.i], lead = ob.won == null || b.won >= ob.won - 1e-9;
    assert.match(r, new RegExp(`<span style="width:${(b.w / b.n * 100).toFixed(1)}%; background:var\\(--white-bar${lead ? '' : '-2'}\\);`), 'the fill = Won, white (Q3: trailer 45%)');
    assert.match(r, new RegExp(`class="me-tick" style="position:absolute; left:calc\\(${(b.needs * 100).toFixed(1)}% - 1px\\);[^"]*background:var\\(--viz-tick\\);`), 'the tick = Needs, --viz-tick');
    const e = (b.won - b.needs) * 100, want = (e > 0 ? '+' : e < 0 ? '−' : '±') + (Math.round(Math.abs(e) * 10 + 1e-7) / 10).toFixed(1) + 'pp';
    assert.ok(new RegExp(`class="me-edge"[^>]*><span class="ma-rate"[^>]*color:var\\(--(pos|neg|text-soft)\\);">${want.replace('+', '\\+')}<`).test(r), `${b.label}: Edge ${want}`);
  }
  assert.ok(!/#aSectionMarketEdge\{ --viz-tick/.test(HTML), 'no tab override re-points the grey tick (decisions §1: --viz-tick)');
  assert.ok(R.html.includes('Bar = win rate at closing odds in the band; grey tick = break-even win rate'), 'the footnote names the bar and the tick');
});

// Mutation: the profit lines back on --text / the B grey, or the 2.6px lead width.
test('TEN-380 profit chart: lead --white-bar 2.4px, other --white-bar-2 2px; swatches match; labels --text-label', () => {
  const R = ui.render(M, { meView: 'winner' }, rows);
  assert.match(R.html, /data-me-series="a" points="[^"]*" fill="none" style="stroke:var\(--white-bar\)" stroke-width="2\.4"/);
  assert.match(R.html, /data-me-series="b" points="[^"]*" fill="none" style="stroke:var\(--white-bar-2\)" stroke-width="2"/);
  const chart = R.html.slice(R.html.indexOf('me-card me-chart'));
  assert.equal((chart.match(/width:16px; height:3px; border-radius:2px; background:var\(--white-bar(-2)?\);/g) || []).length, 2, 'legend swatches');
  assert.match(chart, /color:var\(--text-label\);">Break even</);
  assert.ok(!/font-weight:500; color:var\(--text-soft\)/.test(chart), 'y labels on --text-label');
});

// Mutation: the highlighted In band cells back on --inner + an edge, the In band head off --link, the meta off its rule.
test('TEN-380 derived lines: highlighted cells --wash-4 with no edge, "In band" head --link, meta "in band X · n=N" on a rule', () => {
  const R = ui.render(M, { meView: 'lines' }, rows);
  const card = R.html.slice(R.html.indexOf('me-card me-lines'));
  const hi = card.match(/background:var\(--wash-4\); border:1px solid transparent;/g) || [];
  assert.equal(hi.length, 4, 'two highlighted cells per player');
  assert.ok(!/background:var\(--inner\); border:1px solid var\(--edge-10\); border-radius:6px; padding:3px 8px/.test(card));
  assert.equal((card.match(/color:var\(--link\);">In band</g) || []).length, 2);
  const metas = [...card.matchAll(/class="me-pmeta"[^>]*>in band <span[^>]*>([^<]*)<\/span> · n=(\d+)</g)].map((m) => [m[1], +m[2]]);
  assert.deepEqual(metas, R.MM.map((m) => [window_BANDS[m.lines.tb].label, m.lines.inBand.length]));
  assert.ok(R.html.indexOf('me-card me-cover') < R.html.indexOf('me-card me-lines'), 'Cover rate by price band comes first');
});
const window_BANDS = ui.core.BANDS;

// Mutation: the cover rate counted over the Match winner rows, the tick dropped, today's row unmarked, an empty band clickable.
test('TEN-380 cover rate by price band: per band the Bo3 cover share, the all-matches tick, today lifted, empty bands inert', () => {
  for (const [j, li] of [[0, 0], [2, 3], [4, 5]]) {
    const R = ui.render(M, { meView: 'lines', meCov: j }, rows);
    const card = R.html.slice(R.html.indexOf('me-card me-cover'), R.html.indexOf('me-card me-lines'));
    const segAt = card.indexOf('<div class="ma-seg"');
    assert.deepEqual(txt(card.slice(segAt, card.indexOf('</div>', segAt))),
      ['Wins match', 'Wins set 1', '−3.5 games', 'Over 22.5 games', 'Tiebreak in match'], 'the five lines, surname stripped');
    R.MM.forEach((Mi, i) => {
      const k = i ? 'b' : 'a', L = Mi.lines, def = L.rows[li], all = L.all;
      const aPct = Math.round(all.filter(def.fn).length / all.length * 100);
      assert.ok(card.includes(`${def.label} · all matches <span class="ma-rate"`), `${k}: the meta names the player's own line`);
      window_BANDS.forEach((b, bi) => {
        const rs = all.filter((r) => ui.core.bandOf(r.price) === bi), n = rs.length, c = rs.filter(def.fn).length;
        const r = rowOf(card, 'data-me-cov', k + bi);
        assert.ok(txt(r).includes(n ? `${c}/${n}` : '—'), `${k}${bi} count ${c}/${n}`);
        if (n >= 10) assert.ok(txt(r).includes(Math.round(c / n * 100) + '%'), `${k}${bi} rate`);
        if (n) assert.match(r, new RegExp(`class="me-tick" style="position:absolute; left:calc\\(${(all.filter(def.fn).length / all.length * 100).toFixed(1)}% - 1px\\)`), 'tick = all matches');
        assert.equal(/opacity:0\.45/.test(r.slice(0, r.indexOf('>'))), !n, 'an empty band at 45%');
        assert.equal(/onclick="meSet\(\{meBand:/.test(r.slice(0, r.indexOf('>'))), n > 0 && Mi.bands[bi].n > 0, 'clickable only with matches');
        if (bi === L.tb) assert.match(r.slice(0, r.indexOf('>')), /background:var\(--wash-5\); cursor/, 'today: the neutral wash (Q2)');
        // Q3: leader solid, trailer 45% — the other player's gated rate in the same band
        const O = R.MM[1 - i].lines, od = O.rows[li], ors = O.all.filter((x) => ui.core.bandOf(x.price) === bi);
        const oRate = ors.length >= 5 ? ors.filter(od.fn).length / ors.length : null, own = n >= 5 ? c / n : null;
        if (n >= 10) assert.match(r, new RegExp(`background:var\\(--white-bar${own == null || oRate == null || own >= oRate - 1e-9 ? '' : '-2'}\\);`), `${k}${bi} leader / trailer`);
      });
      assert.ok(aPct >= 0);
    });
  }
});

// Mutation: the band pop-up back to five tiles without sub-lines, or its Edge not won − needs.
test('TEN-380 band pop-up: four tiles with sub-lines — Record / n priced, Won / needs, Edge / won − needs, At 1u flat / yield', () => {
  const R = ui.render(M, { meView: 'winner' }, rows);
  const b = R.MM[0].bands[2], P = R.band('a2');
  const tiles = [...P.matchAll(/class="me-tile"[^>]*><span[^>]*>([^<]*)<\/span><span class="me-stat"[^>]*color:([^;]+);[^>]*>([^<]*)<\/span><span class="me-tile-sub"[^>]*>([^<]*)</g)].map((m) => [m[1], m[3], m[4]]);
  assert.deepEqual(tiles.map((t) => t[0]), ['Record', 'Won', 'Edge', 'At 1u flat']);
  assert.deepEqual(tiles[0].slice(1), [`W${b.w}–L${b.l}`, `${b.n.toLocaleString('en-US')} priced`]);
  assert.equal(tiles[1][2], 'needs ' + (Math.round(b.needs * 1000) / 10).toFixed(1) + '%');
  assert.equal(tiles[2][2], 'won − needs');
  const e = (b.won - b.needs) * 100;
  assert.equal(tiles[2][1], (e > 0 ? '+' : '−') + (Math.round(Math.abs(e) * 10 + 1e-7) / 10).toFixed(1) + 'pp');
  assert.match(tiles[3][2], /^yield [+−±]\d+\.\d%$/);
  assert.match(P, /class="me-tile" style="background:var\(--card\); border:1px solid var\(--edge-6\);/, 'tiles are panels');
  assert.match(P, /class="ma-pop ma-sigin me-pop"[^>]*border:1px solid var\(--edge-10\);/, 'the sheet edge --edge-10');
});

// Mutation: the line pop-up back to three inline boxes, "Vs all" printed on All matches, or Vs all not in-band − all.
test('TEN-380 line pop-up: segment + hint, then Matches · Covered · Rate · Vs all (in band − all, pp; --inner, no edge)', () => {
  const R = ui.render(M, { meView: 'lines' }, rows);
  const L = R.MM[0].lines, row = L.rows[0];
  const tiles = (h) => [...h.matchAll(/class="me-tile"[^>]*><span[^>]*>([^<]*)<\/span><span class="me-stat"[^>]*>([^<]*)<\/span><span class="me-tile-sub"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2], m[3]]);
  const all = tiles(R.line('a|0', 'all')), band = tiles(R.line('a|0', 'band'));
  const aC = L.all.filter(row.fn).length, aN = L.all.length, bC = L.inBand.filter(row.fn).length, bN = L.inBand.length;
  assert.deepEqual(all, [['Matches', String(aN), 'all priced'], ['Covered', `${aC} of ${aN}`, `${aN - aC} not covered`], ['Rate', Math.round(aC / aN * 100) + '%', 'this line'], ['Vs all', '—', 'in band − all']]);
  const vs = Math.round(bC / bN * 100) - Math.round(aC / aN * 100);
  assert.deepEqual(band[0], ['Matches', String(bN), 'priced in band']);
  assert.deepEqual(band[2], ['Rate', Math.round(bC / bN * 100) + '%', 'all matches ' + Math.round(aC / aN * 100) + '%']);
  assert.equal(band[3][1], (vs > 0 ? '+' : vs < 0 ? '−' : '±') + Math.abs(vs) + 'pp');
  assert.match(R.line('a|0', 'all'), /Click a match for its stats/);
  assert.match(R.line('a|0', 'all'), /class="me-tile" style="background:var\(--inner\); border:1px solid transparent;[^>]*><span[^>]*>Vs all</);
});

// Founder Q3 (ruling 8, 2026-10-03): Market edge bars keep the leader / trailer split per band — the higher rate solid
// (--white-bar), the other 45% (--white-bar-2); figures stay white for both. Mutations: no split; the trailer solid.
test('Q3: price-sensitivity bars — per band the leader solid, the trailer --white-bar-2; both Won figures white', () => {
  const R = ui.render(M, { meView: 'winner' }, rows);
  let split = 0;
  R.MM[0].bands.forEach((b, bi) => {
    const o = R.MM[1].bands[bi];
    if (b.won == null || o.won == null || b.won === o.won) return;
    const ra = rowOf(R.html, 'data-me-band', 'a' + bi), rb = rowOf(R.html, 'data-me-band', 'b' + bi);
    const fill = (r) => /<span style="width:[\d.]+%; background:([^;]+);/.exec(r)[1];
    const [lead, trail] = b.won > o.won ? [ra, rb] : [rb, ra];
    const [ln, tn] = b.won > o.won ? [b.n, o.n] : [o.n, b.n];
    if (ln >= 10) assert.equal(fill(lead), 'var(--white-bar)');
    if (tn >= 10) { assert.equal(fill(trail), 'var(--white-bar-2)'); split++; }
    for (const r of [lead, trail]) assert.ok(!/class="ma-rate" data-ma-gate="full" style="color:var\(--text-(soft|label)\);">\d+%/.test(r), 'Won figures never greyed for trailing');
  });
  assert.ok(split >= 3, `bands compared: ${split}`);
});
