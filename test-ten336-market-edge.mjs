// TEN-336 — Market edge, now on the Match analysis rebuild (design_handoff_match_analysis_2026-11-23, founder lock
// 2026-11-22 / 23): the tab renderer is match-analysis-v2.js (maMarketEdgeV2, maMeBandPopV2, maMeLinePopV2) over the
// page's unchanged data layer (meStateFor / meModels / the D2 gate, sliced out of bsp-consult-dashboard.html by
// tools/ten310-harness.mjs) and the real market-edge-core.js, on the frozen TEN-310 fixtures (Sinner 2072, Alcaraz 2382).
// Every test names the mutation that must turn it red (tools/test-ten336-mutants.js). The rebuild replaced the TEN-380
// markup, the ME_C palette, the CLOSING ODDS pill and the maMatchRowsHtml pop-up rows (STEP1 report: items 7–8, g); what
// those tests guarded as a RULE is checked here on the new renderer. A test named "RENDERER GAP" (none today) would check a
// standing rule the new renderer does not meet yet: red until the renderer is fixed (the mutant runner skips it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUI, HTML, V2, slice, constSrc } from './tools/ten310-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FX = join(HERE, 'tools/fixtures/ten310');
const rd = (f) => JSON.parse(readFileSync(join(FX, f), 'utf8'));
const TOKENS = readFileSync(join(HERE, 'tokens.css'), 'utf8');
const ui = buildUI();
const M = { id: 'upcoming-x', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: 2072, p2Key: 2382, date: '2026-09-27',
  tour: 'ATP Beijing', tournamentRound: 'ATP Beijing - Final', tourBadge: 'ATP', bestOdds: { p1: { price: 1.54 }, p2: { price: 2.62 } } };
const rows = [['2072', 'J. Sinner'], ['2382', 'C. Alcaraz']].map(([k, n]) => ui.meRowsFor(rd(`career-history-${k}.json`).matches, ui.fhParseCloses(rd(`match-closes-${k}.json`)), k, n));
// The Market edge block of match-analysis-v2.js (its header comment → the Form tab).
const BLOCK = V2.slice(V2.indexOf('// MARKET EDGE (LOCKED'), V2.indexOf('// FORM (LOCKED'));
const txt = (h) => h.replace(/<[^>]*>/g, '\u0001').split('\u0001').map((s) => s.trim()).filter(Boolean);
const rowOf = (h, attr, key) => { const i = h.indexOf(`${attr}="${key}"`); const j = h.indexOf(`${attr}="`, i + 10); return h.slice(h.lastIndexOf('<div', i), j < 0 ? undefined : h.lastIndexOf('<div', j)); };
const openTag = (r) => r.slice(0, r.indexOf('>'));
const unesc = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const helps = (h) => [...h.matchAll(/<span title="([^"]*)" style="width:16px; height:16px;/g)].map((m) => unesc(m[1]));
const tileRe = (l) => new RegExp(`>${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</span><span style="([^"]*)">([^<]*)</span><span style="[^"]*">([^<]*)</span>`);
const tile = (h, l) => { const m = tileRe(l).exec(h); return m ? { style: m[1], fig: m[2], sub: m[3] } : null; };
const sg = (e, d, u) => (Math.round(Math.abs(e) * 10 ** d + 1e-7) ? (e > 0 ? '+' : '−') : '±') + (Math.round(Math.abs(e) * 10 ** d + 1e-7) / 10 ** d).toFixed(d) + u;
const BANDS = ui.core.BANDS;

// Mutation: a row stops opening the shared sheet (meOpenRow), or a price loses its source hover (fhSrcTitle).
// DoD 8 rebuilt: the 2026-11-23 design draws its own opened-box rows (no maMatchRowsHtml) and its "?" / price hovers are the
// native title (STEP1 report item 8); the rule kept is one sheet for every row and the one price-source hover.
test('DoD 8 (rebuild): every opened-box row opens the shared sheet; every price carries the one price-source hover', () => {
  const R = ui.render(M, { meView: 'winner' }, rows);
  const pop = R.band('a2'), b = R.MM[0].bands[2];
  const n = (pop.match(/data-me-row="/g) || []).length;
  assert.ok(n > 10 && n === b.n, `pop-up rows = band n (${n} / ${b.n})`);
  assert.equal((pop.match(/onclick="meOpenRow\('[^']+'\)"/g) || []).length, n, 'every row opens the shared sheet');
  assert.equal(Object.keys(R.E.rowMap).length, n, 'every row registered for the sheet hand-off (meOpenRow reads E.rowMap)');
  const titles = [...pop.matchAll(/<span title="([^"]*)" style="font-family:'IBM Plex Mono',monospace; font-size:12px; font-weight:700; text-align:right;/g)].map((m) => unesc(m[1]));
  assert.equal(titles.length, n, 'every price carries the hover');
  assert.ok(titles.every((t) => /^(Pinnacle|Bet365)/.test(t)), 'the price-source hover (fhSrcTitle)');
  assert.ok(!/data-aotip|aOddsTipHtml/.test(BLOCK), 'no TEN-303 tooltip in the tab');
  for (const fn of ['meRowsHtml', 'meTableHead', 'meCommonCells', 'mePillTip', 'meBandPopHtml', 'meLinePopHtml']) assert.ok(!new RegExp(`function ${fn}\\(`).test(HTML), `${fn} is deleted from the page`);
  const line = R.line('a|0', 'all');
  const ln = (line.match(/data-me-row="/g) || []).length;
  assert.ok(ln > 10 && (line.match(/onclick="meOpenRow\('/g) || []).length === ln, 'line pop-up rows open the sheet too');
});

// Mutation: default meView back to 'lines' (the design file's own default, DF L3374).
test('D3: a fresh modal opens Market edge on Match winner (the Price sensitivity card first)', () => {
  const R = ui.render(Object.assign({}, M, { id: 'fresh' }), {}, rows);
  assert.equal(R.E.S.meView, 'winner');
  assert.ok(R.html.indexOf('Price sensitivity') > 0 && !R.html.includes('Derived lines at today'), 'Match winner cards only');
});

// Mutation: a raw colour back in the block, or a token tokens.css doesn't define. The foundation rule (one colour file) holds;
// the TEN-376 ME_C palette is replaced by the rebuild's --ma2-* tokens (foundation.md / notes: "Colours = the --ma2-* tokens").
test('palette: every Market edge colour is a tokens.css token (the --ma2-* set) or one at an opacity; no raw colour', () => {
  assert.ok(BLOCK.length > 15000, 'block found');
  const code = BLOCK.replace(/\/\/.*$/gm, '');
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(code), 'no raw colour');
  const used = [...new Set([...code.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))];
  assert.ok(used.length >= 8, 'tokens read');
  for (const t of used) assert.ok(new RegExp(`^\\s*${t}:`, 'm').test(TOKENS), `${t} defined in tokens.css`);
  // players: A blue, B white (STEP1 item 7: the design's identity colours replace ruling 8 inside the box); green / red on signed values only
  assert.match(code, /const col = \['var\(--ma2-blue\)', 'var\(--ma2-text\)'\];/);
  assert.match(code, /const meUc = \(v, dp\) => \{[^}]*\? meGrey : v > 0 \? 'var\(--ma2-green\)' : 'var\(--ma2-red\)'; \};/, 'sign colour: grey at a rounded 0, green above, red below');
});

// Mutation: a 0.33px / 1.25px edge back anywhere in the tab.
test('geometry: all edges 1px (no 0.33px, no 1.25px) in the tab and both opened boxes', () => {
  const R = ui.render(M, { meView: 'winner' }, rows), RL = ui.render(M, { meView: 'lines' }, rows);
  const all = R.html + R.band('a2') + RL.html + RL.line('a|0', 'all');
  assert.ok(!/0\.33px|1\.25px/.test(all), 'no 0.33px / 1.25px edge anywhere in the tab');
  assert.ok((all.match(/border:1px solid/g) || []).length > 10, 'the edges are drawn');
});

// Mutation: today's band unmarked, or another band marked.
// The 2026-11-23 design marks today's band as a selection (lifted + 14% edge: foundation "selection is lift, never blue");
// founder Q2's "--wash-5, no ring" and DF L3443 "the open band takes the wash" are TEN-380 styling the rebuild replaced
// (the band now opens as a box over the tab).
test('band rows: today\'s band (and only it) is lifted and titled "Today’s price band"', () => {
  const R = ui.render(M, { meView: 'winner' }, rows);
  R.MM.forEach((Mi, i) => {
    const k = i ? 'b' : 'a';
    assert.ok(Mi.tb >= 0, 'fixture: a today band');
    BANDS.forEach((b, bi) => {
      const o = openTag(rowOf(R.html, 'data-me-band', k + bi)), today = bi === Mi.tb;
      assert.equal(/background:var\(--ma2-lifted\); box-shadow:inset 0 0 0 1px color-mix\(in srgb, var\(--ma2-white\) 14%, transparent\);/.test(o), today, `${k}${bi}: lifted iff today`);
      assert.equal(/title="Today’s price band"/.test(o), today);
      if (!today) assert.match(o, /background:transparent; box-shadow:inset 0 0 0 1px transparent;/);
    });
  });
});

// Mutation: the book split dropped from the Price sensitivity help, or its counts not the model's.
// The CLOSING ODDS pill is not in the 2026-11-23 design; its disclosure (closing prices, book split, never "sample data")
// is the card's "?" help.
test('closing prices: the Price sensitivity help names the book split, summed over both players; no "sample data"', () => {
  const R = ui.render(M, { meView: 'winner' }, rows);
  assert.ok(!/sample data/i.test(R.html + R.band('a2')), 'no SAMPLE DATA chip');
  const h = helps(R.html.slice(0, R.html.indexOf('class="me-card me-chart"')));
  const P = R.MM.reduce((s, m) => s + m.book.P, 0), B = R.MM.reduce((s, m) => s + m.book.B, 0);
  assert.ok(P > 0 && B > 0, 'fixture: both books');
  assert.ok(h.some((t) => t.includes(`Closing prices: Pinnacle ${P}`) && t.includes(`Bet365 ${B} (no Pinnacle close)`)), 'the split = the model');
});

// Mutation: the latest-match date dropped from the help, or not the latest priced match.
// modal-market-edge.md "Pill = CLOSING ODDS, hover = Pinnacle / Bet365 split + latest match date in scope": the pill is not
// in the 2026-11-23 design; the split and the date are in the Price sensitivity "?" help.
test('closing prices: the help names the latest priced match in scope ("Latest match: DD Mon YYYY")', () => {
  const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (const scope of ['l52', 'career']) {   // career last: the harness keeps one modal state per match, as the page does
    const R = ui.render(M, { meView: 'winner', meScope: scope }, rows);
    const last = R.MM.flatMap((m) => m.priced.map((r) => r.date)).sort().pop();
    const [y, mo, d] = last.split('-');
    const h = helps(R.html.slice(0, R.html.indexOf('class="me-card me-chart"'))).join(' ');
    assert.ok(h.includes(`Latest match: ${d} ${MONS[+mo - 1]} ${y}.`), `${scope}: the latest priced match (${last}) is named next to the book split`);
  }
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
  const woX = Object.assign({}, x, { result: '0 - 0', sets: [], walkover: true, retired: true });
  // founder 2026-10-22: a walkover row is listed elsewhere and is in no Market edge population; built, it is no retirement
  assert.equal(ui.meRowsFor([woX], null, '9', 'A. Test').length, 0, 'a walkover is in no Market edge population');
  assert.equal(ui.meRowFromCareer(woX, null, '9', 'A. Test', 0).ret, false, 'a walkover is never a retirement');
  const five = ui.meRowsFor([Object.assign({}, x, { bestOf: 5, tournament: 'Washington' })], null, '9', 'A. Test')[0];
  assert.deepEqual([five.bo, five.ret, five.complete], [5, true, false], 'a Bo5 winner short of three sets still stopped');
  const ret = ui.meRowsFor([Object.assign({}, x, { retired: true })], null, '9', 'A. Test')[0];
  assert.equal(ret.ret, true, 'the feed flag still stands');
});


// Mutation: the band box's help loses its "every match … newest first" text or the retirement note.
// TEN-376's foot line ("Every match …" on --text-label) moved into the opened box's "?" help in the 2026-11-23 design.
test('band box: its help says what the list is and how retirements settle', () => {
  const R = ui.render(M, { meView: 'winner' }, rows);
  const h = helps(R.band('a2'));
  assert.ok(h.some((t) => t.startsWith('Every match with a closing price in this band, newest first.') && t.includes(ui.core.RET_SETTLE_NOTE)));
  assert.ok(helps(R.line('a|0', 'all')).some((t) => t.includes('Click a match for its stats')), 'line box: click a match for its stats');
});

// Mutation: the Bet365 share dropped from the sub-line, the Today price not the header's, the Edge read as Won alone, the
// tick off Needs, the fill not Won.
test('price sensitivity: "N priced matches · k of N on Bet365" (founder 2026-10-30), Today = the header price; bar = Won, tick = Needs, Edge = Won − Needs', () => {
  const R = ui.render(M, { meView: 'winner' }, rows);
  const box = (k) => { const i = R.html.lastIndexOf('<div', R.html.indexOf(`class="me-pbox" data-side="${k}"`)); return R.html.slice(i, k === 'a' ? R.html.indexOf('class="me-pbox" data-side="b"') : undefined); };
  ['a', 'b'].forEach((k, i) => {
    const Mi = R.MM[i], t = txt(box(k)), nP = Mi.priced.length, nB = Mi.priced.filter((r) => r.book === 'B').length;
    assert.ok(nB > 0, 'fixture: Bet365 rows');
    assert.equal(t[0], [M.p1, M.p2][i]);
    assert.equal(t[1], `${nP} priced matches · ${nB} of ${nP} on Bet365`, 'the Bet365 share = the model');
    assert.deepEqual(t.slice(2, 4), ['Today', ['1.54', '2.62'][i]], 'Today = the header price');
    assert.deepEqual(t.slice(4, 9), ['Price band', 'Won against needed', 'Won', 'Edge', '1% stake']);
    for (const b of Mi.bands.filter((x) => x.n >= 10)) {
      const r = rowOf(R.html, 'data-me-band', k + b.i);
      assert.ok(!r.includes(`>${b.w}–${b.l}<`), 'no W–L text in the row (the Record tile carries it)');
      assert.match(r, new RegExp(`<span style="position:absolute; left:0; top:0; bottom:0; width:${(b.w / b.n * 100).toFixed(1)}%; background:var\\(--ma2-text\\);`), 'the fill = Won');
      assert.match(r, new RegExp(`class="me-tick" style="position:absolute; left:${(b.needs * 100).toFixed(1)}%;`), 'the tick = Needs');
      const want = sg((b.won - b.needs) * 100, 1, 'pp');
      assert.ok(new RegExp(`class="me-edge"[^>]*><span class="ma-rate" data-ma-gate="full" style="color:var\\(--ma2-(green|red)\\);">${want.replace('+', '\\+')}<`).test(r) || (want.startsWith('±') && r.includes(`>${want}<`)), `${b.label}: Edge ${want}`);
    }
  });
  const h = helps(R.html.slice(0, R.html.indexOf('class="me-card me-chart"'))).join(' ');
  assert.ok(h.includes('The bar is his win rate in the band, the grey tick is the win rate needed to break even'), 'the help names the bar and the tick');
});

// Mutation: the series colours swapped, the legend count off the model, the chart footnote's retirement note dropped.
test('profit chart: A blue / B white (STEP1 item 7), legend swatches match, legend n = the model, "Break even" on the rule', () => {
  const R = ui.render(M, { meView: 'winner' }, rows);
  const chart = R.html.slice(R.html.indexOf('class="me-card me-chart"'));
  assert.match(chart, /data-me-series="a" points="[^"]*" fill="none" style="stroke:var\(--ma2-blue\)" stroke-width="2\.2"/);
  assert.match(chart, /data-me-series="b" points="[^"]*" fill="none" style="stroke:var\(--ma2-text\)" stroke-width="2\.2"/);
  assert.equal((chart.match(/width:16px; height:3px; border-radius:2px; background:var\(--ma2-blue\);/g) || []).length, 1, 'A swatch');
  assert.equal((chart.match(/width:16px; height:3px; border-radius:2px; background:var\(--ma2-text\);/g) || []).length, 1, 'B swatch');
  const ns = [...chart.matchAll(/>([\d,]+) priced</g)].map((m) => +m[1].replace(/,/g, ''));
  assert.deepEqual(ns, R.MM.map((m) => m.priced.length));
  assert.ok(txt(chart).includes('Break even'));
  assert.ok(!/<polygon|<path[^>]*fill="(?!none)/.test(chart), 'no area fill under a line');
});

// Mutation: a raw colour on the chart, a vertical guide drawn dotted, the break-even rule dropped, the wash off break even.
// The 2026-11-23 design draws a 1.4% white loss wash under break even and a solid 4.5% line at each x tick; both are on the
// founder conflict list (foundation.md "Charts": horizontal guides only, no loss wash) and the design is kept meanwhile.
// Held here: horizontal guides dotted (2 6), the break-even rule solid, every colour a white token at an opacity.
test('profit chart: dotted horizontal guides, a solid break-even rule, the design\'s loss wash and tick lines; no raw colour', () => {
  const R = ui.render(M, { meView: 'winner' }, rows);
  const svg = /<svg class="me-chart-svg"[\s\S]*?<\/svg>/.exec(R.html)[0];
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(svg), 'no raw colour in the chart');
  const lines = [...svg.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" style="stroke:([^"]+)"([^>]*)>/g)];
  const horiz = lines.filter((m) => m[2] === m[4]), vert = lines.filter((m) => m[1] === m[3]);
  const zero = horiz.filter((m) => !/stroke-dasharray/.test(m[6]));
  assert.equal(zero.length, 1, 'one solid horizontal rule: break even');
  assert.equal(zero[0][5], 'color-mix(in srgb, var(--ma2-white) 40%, transparent)');
  const guides = horiz.filter((m) => /stroke-dasharray="2 6"/.test(m[6]));
  assert.ok(guides.length >= 3 && guides.length === horiz.length - 1, 'every other horizontal line is a dotted 2 6 guide');
  assert.ok(vert.length >= 3 && vert.every((m) => m[5] === 'color-mix(in srgb, var(--ma2-white) 4.5%, transparent)' && !/dasharray/.test(m[6])), 'the design\'s x-tick lines: solid, white 4.5%');
  const wash = /<rect x="0" y="([\d.]+)" width="1000" height="([\d.]+)" style="fill:([^"]+)"/.exec(svg);
  assert.ok(wash, 'the design\'s loss wash');
  assert.equal(+wash[1], +zero[0][2], 'the wash starts at break even');
  assert.equal(wash[3], 'color-mix(in srgb, var(--ma2-white) 1.4%, transparent)');
});

// Mutation: the lines box's sub-line or Today's band off the model; the cover card after the lines card.
// TEN-380's "--wash-4 top-two In band cells" and "In band head --link" are the replaced TEN-380 styling.
test('derived lines: per player "N in today’s band · M priced matches" and Today’s band = the model; cover card first', () => {
  const R = ui.render(M, { meView: 'lines' }, rows);
  const card = R.html.slice(R.html.indexOf('me-card me-lines'));
  const subs = [...card.matchAll(/>(\d+) in today’s band · (\d+) priced matches<\/span><\/span><span[^>]*><span[^>]*>Today’s band<\/span><span[^>]*>([^<]*)</g)].map((m) => [+m[1], +m[2], m[3]]);
  assert.deepEqual(subs, R.MM.map((m) => [m.lines.inBand.length, m.lines.all.length, BANDS[m.lines.tb].label]));
  assert.ok(R.html.indexOf('me-card me-cover') > 0 && R.html.indexOf('me-card me-cover') < R.html.indexOf('me-card me-lines'), 'Cover rate by price band comes first');
  const L = R.MM[0].lines, r0 = L.rows[0], row = rowOf(card, 'data-me-line', 'a|0');
  assert.match(openTag(row), new RegExp(`title="${r0.label}: in band ${r0.bC} of ${r0.bN}, all ${r0.aC} of ${r0.aN}`), 'the row hover carries the counts');
});

// Mutation: the cover rate counted over the Match winner rows, the tick dropped, today's row unmarked, an empty band clickable.
test('cover rate by price band: per band the Bo3 cover share, the all-matches tick, today lifted, empty bands inert', () => {
  for (const [j, li] of [[0, 0], [2, 3], [4, 5]]) {
    const R = ui.render(M, { meView: 'lines', meCov: j }, rows);
    const card = R.html.slice(R.html.indexOf('me-card me-cover'), R.html.indexOf('me-card me-lines'));
    const segAt = card.indexOf('<div class="ma2-track"', card.indexOf('<div class="ma2-track"') + 1);   // the first track is the window
    assert.deepEqual(txt(card.slice(segAt, card.indexOf('</div>', segAt))),
      ['Wins match', 'Wins set 1', '−3.5 games', 'Over 22.5 games', 'Tiebreak in match'], 'the five lines, surname stripped');
    let checked = 0;
    R.MM.forEach((Mi, i) => {
      const k = i ? 'b' : 'a', L = Mi.lines, def = L.rows[li], all = L.all, allC = all.filter(def.fn).length;
      const box = card.slice(card.lastIndexOf('<div', card.indexOf(`class="me-pbox" data-side="${k}"`)));
      assert.equal(txt(box)[1], def.label, `${k}: the sub names the player's own line`);
      BANDS.forEach((b, bi) => {
        const rs = all.filter((r) => ui.core.bandOf(r.price) === bi), n = rs.length, c = rs.filter(def.fn).length;
        const r = rowOf(card, 'data-me-cov', k + bi), o = openTag(r);
        assert.ok(txt(r).includes(n ? `${c}/${n}` : '—'), `${k}${bi} count ${c}/${n}`);
        if (n >= 10) { assert.ok(txt(r).includes(Math.round(c / n * 100) + '%'), `${k}${bi} rate`); checked++; }
        if (n) assert.match(r, new RegExp(`class="me-tick" style="position:absolute; left:${(allC / all.length * 100).toFixed(1)}%;`), 'tick = all matches');
        assert.equal(/class="me-row-empty"/.test(o), !(n > 0 && Mi.bands[bi].n > 0), 'an empty band is inert');
        assert.equal(/onclick="meSet\(\{meBand:/.test(o), n > 0 && Mi.bands[bi].n > 0, 'clickable only with matches');
        assert.equal(/background:var\(--ma2-lifted\)/.test(o), bi === L.tb, 'today lifted');
      });
    });
    assert.ok(checked >= 4, 'rates checked');
  }
});

// Mutation: the band box's Edge sub-line dropped or its Edge not Won − Needs.
test('band box: four tiles — Record / n priced, Won / needs, Edge / Won − needs, At flat 1% stake / yield', () => {
  const R = ui.render(M, { meView: 'winner' }, rows);
  const b = R.MM[0].bands[2], P = R.band('a2');
  const T = ['Record', 'Won', 'Edge', 'At flat 1% stake'].map((l) => tile(P, l));
  assert.ok(T.every(Boolean), 'four tiles');
  assert.deepEqual([T[0].fig, T[0].sub], [`${b.w}–${b.l}`, `${b.n.toLocaleString('en-US')} priced`]);
  assert.equal(T[1].sub, 'needs ' + (Math.round(b.needs * 1000) / 10).toFixed(1) + '%');
  assert.equal(T[2].sub, 'Won − needs');
  assert.equal(T[2].fig, sg((b.won - b.needs) * 100, 1, 'pp'));
  assert.match(T[3].sub, /^yield [+−±]\d+\.\d%$/);
  assert.match(P, /class="ma2-pop"[^>]*border:1px solid color-mix\(in srgb, var\(--ma2-white\) 8%, transparent\);/, 'the opened-box shell');
});

// Mutation: "Against all" printed on All matches, or not in-band − all.
test('line box: segment, then Matches · Covered · Rate · Against all (in band − all, pp)', () => {
  const R = ui.render(M, { meView: 'lines' }, rows);
  const L = R.MM[0].lines, row = L.rows[0];
  const T = (h) => ['Matches', 'Covered', 'Rate', 'Against all'].map((l) => { const t = tile(h, l); return [l, t.fig, t.sub]; });
  const all = T(R.line('a|0', 'all')), band = T(R.line('a|0', 'band'));
  const aC = L.all.filter(row.fn).length, aN = L.all.length, bC = L.inBand.filter(row.fn).length, bN = L.inBand.length;
  assert.deepEqual(all, [['Matches', String(aN), 'All priced'], ['Covered', `${aC} of ${aN}`, `${aN - aC} not covered`], ['Rate', Math.round(aC / aN * 100) + '%', 'This line'], ['Against all', '—', 'In band − all']]);
  const vs = Math.round(bC / bN * 100) - Math.round(aC / aN * 100);
  assert.deepEqual(band[0], ['Matches', String(bN), 'Priced in band']);
  assert.deepEqual(band[2], ['Rate', Math.round(bC / bN * 100) + '%', 'All matches ' + Math.round(aC / aN * 100) + '%']);
  assert.equal(band[3][1], sg(vs, 0, 'pp'));
  assert.ok(txt(R.line('a|0', 'all')).includes('All matches') && txt(R.line('a|0', 'all')).includes('In today’s band'), 'the All / In today’s band segment');
});

// Mutation: the identity-unverified line dropped (section or opened box). odds.md "Archive identity": "N rows hidden: identity
// unverified" on the profile's Market edge line and the Market edge tab.
test('identity unverified: the tab and the band box say how many rows the identity gate hid', () => {
  const rr = rows.map((r) => Object.assign(r.slice(), r, { idHidden: 0 }));
  rr[0].idHidden = 3; rr[1].idHidden = 1;
  const R = ui.render(M, { meView: 'winner' }, rr);
  const i = R.html.indexOf('class="me-id-hidden"');
  assert.ok(i > 0);
  assert.equal(txt(R.html.slice(R.html.lastIndexOf('<', i))).join(' '), 'J. Sinner: 3 rows hidden: identity unverified · C. Alcaraz: 1 row hidden: identity unverified');
  assert.ok(txt(R.band('a2')).some((t) => t.endsWith('3 rows hidden: identity unverified')), 'the band box sub-line');
  assert.ok(!ui.render(M, { meView: 'winner' }, rows).html.includes('me-id-hidden'), 'control: no line without hidden rows');
});
