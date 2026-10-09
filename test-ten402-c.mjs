// TEN-402 (step 8 · Head to Head), builder c — Playing styles · Tournament · Market edge + the stat-card flag.
// Each test is a ruling someone can apply: the page's own functions are sliced out of bsp-consult-dashboard.html and run
// against the real MarketEdgeCore, so a regression in the shipped code (not a copy of the rule) turns this red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN402_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const core = createRequire(import.meta.url)(join(HERE, 'market-edge-core.js'));

function sliceFrom(src, start) {
  let d = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; }
  return src.slice(start, i + 1);
}
function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  return sliceFrom(html, start);
}
const constLine = name => { const m = new RegExp(`\\nconst ${name} = [^\\n]*\\n`).exec(html); assert.ok(m, name); return m[0]; };
const constObj = name => { const m = new RegExp(`\\nconst ${name} = \\{[\\s\\S]*?\\n\\};\\n`).exec(html); assert.ok(m, name); return m[0]; };

// The H2H module and the builder-c block inside it (shared bits → marketCard).
const H0 = html.indexOf('HEAD-TO-HEAD PAGE');
const C0 = html.indexOf('  // ── TEN-402 c · shared bits', H0);
const C1 = html.indexOf('  function newsCard(v) {', C0);
assert.ok(H0 > 0 && C0 > H0 && C1 > C0, 'builder-c block not found');
const block = html.slice(C0, C1);
const h2h = sliceFrom(html, html.indexOf('(function () {', H0));

// A sandbox that runs the block with the page's real shared helpers; the H2H closure (state, render, bindH) is stubbed.
// The page's Database price join and the ledger helpers the Playing styles / Tournament ledgers call (sliced, executed).
const innerConst = name => { const m = new RegExp(`\\n\\s*const ${name} = [^\\n]*\\n`).exec(html); assert.ok(m, name); return m[0]; };
function sandbox(db, careers, blk) {
  const src = `
    const window = { MarketEdgeCore: core };
    const _careerHistoryShards = careers || {};
    let _h2hDbSt = db ? 'ready' : null, _h2hDb = db || null; function h2hEnsureDb() {}
    const FH_DASH = 'var(--text-label)', FH_DASHC = '—'; let _fh = null;
    const FH_BOOK = { P: 'Pinnacle', B: 'Bet365' }, FH_SRC = { td: 'Tennis-Data', cap: 'captured' };
    function psTourMeta() { return null; }
    function fhEsc(s) { return escapeHtml(s == null ? '' : String(s)); }
    ${['H2H_PAGE_PRICE_WINDOW', 'H2H_PAGE_MATCH_WINDOW', 'H2H_PAGE_START_WINDOW', 'H2H_PAGE_ROW_WINDOW', 'H2H_TD_ROUND', 'H2H_PAGE_BEFORE_RANK', '_h2hLedPx', 'H2H_PX_NOTE'].map(innerConst).join('')}
    ${['fhIsInitial', 'fhNameKey', 'h2hRoundLabel', 'fhRoundCode', 'h2hTdIx', 'h2hTdKey', 'h2hTdSame', 'h2hTdRound', 'h2hTdEvent', 'h2hNearest', 'h2hPriceJoin', 'h2hCareerOf', 'h2hLedgerJoin', 'h2hPriceTitle', 'h2hPxNote', 'fhOdd', 'fhDDMM', 'fhSetTxt', 'fhH2hSetScores', 'fhSrcTitle', 'trPxTitle', 'trDbEnd', 'trDayWords', 'trRowData', 'trLastPlayed',
      'psRoundAbbr', 'psGroupMeetings', 'psFmtMeetDate', 'ps2SetDone', 'ps2Meeting'].map(slice).join('\n')}
    const document = undefined;
    const state = {}; let handlers = [];
    const bindH = fn => { handlers.push(fn); return handlers.length - 1; };
    const setState = () => {}; const render = () => {};
    const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const MA_GREY = 'var(--text-label)'; const MA_SMALL_NOTE = 'small sample';
    ${constObj('MA_SEG')}
    ${constLine('MA_ROW_COLS')}${constLine('MA_ROW_GAP')}
    ${constObj('ME_C')}
    ${constLine('meUC')}
    const fn = n => (n === 'sfSegHtml' ? sfSegHtml : null);
    ${['sfSegHtml', 'sectionHead', 'h2hSeg', 'escapeHtml', 'tourxSampleGate', 'maGate', 'maRate', 'maRateHtml', 'maSmallNote', 'maGateBar', 'maSeg', 'maMatchRowsHtml', 'meSg', 'fhDayNum'].map(slice).join('\n')}
    function maPct(k, n){ return Math.round(k / n * 100) + '%'; }
    function fhSurname(n){ return String(n || '').split(/\\s+/).pop(); }
    ${blk || block}
    return { cLevel, cBandOf, H2H_ME_BANDS, meSg, marketVals, marketCard, cBandsCol, curveSVG, cChartModel, cStyleBox, stylesCard, cStyleLedger, cTourPanel, cTourTile, C_BE_INSET, C_CARD, C_PANEL, C_BAR_LEAD, C_BAR_OTHER, handlers: () => handlers };`;
  return new Function('core', 'db', 'careers', src)(core, db, careers);
}
const S = sandbox();
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// ---- a synthetic player: rows in the profile's ruling-B shape, priced, dated inside the last 52 weeks ----
const today = new Date(); const day0 = Math.floor(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / 86400000);
const iso = d => new Date(d * 86400000).toISOString().slice(0, 10);
function rowsOf(list) {
  const rows = list.map(([ago, price, won], i) => ({ mid: 'r' + i, date: iso(day0 - ago), day: day0 - ago, won, price, oppPrice: 2.5, book: 'P', src: 'td', wo: false, round: 'R32' }));
  rows.win = rows;
  return rows;
}
function playerWith(rows) { return { key: 'k' + Math.random(), short: 'A. Player', full: 'A. Player', _cSt: { state: 'ready', me: 'ready', rows } }; }

test('H1: the Serve / Return / Under pressure and Holds & breaks cards hide behind one constant, off by default', () => {
  assert.match(h2h, /const H2H_SHOW_STAT_CARDS = false;/);
  const body = sliceFrom(h2h, h2h.indexOf('function bodyHTML('));
  assert.match(body, /\$\{H2H_SHOW_STAT_CARDS \? holdbreakCard\(v\) : ''\}/);
  assert.match(body, /\$\{H2H_SHOW_STAT_CARDS \? v\.statBlocks\.map\(statCard\)\.join\(''\) : ''\}/);
  // the ticket's order for this builder's blocks: Playing styles → Tournament → Market edge → news
  const at = s => body.indexOf(s);
  assert.ok(at('stylesCard(v)') < at('tourneyCard(v)') && at('tourneyCard(v)') < at('marketCard(v)') && at('marketCard(v)') < at('newsCard(v)'));
  // code stays: both renderers still exist
  assert.match(h2h, /function holdbreakCard\(v\)/); assert.match(h2h, /function statCard\(blk\)/);
});

test('surfaces: top-level card = --card + --top-light, no outline; nested panel = --card + 1px --edge-6', () => {
  assert.match(S.C_CARD, /background:var\(--card\); border:1px solid transparent; box-shadow:var\(--top-light\)/);
  assert.match(S.C_PANEL, /background:var\(--card\); border:1px solid var\(--edge-6\)/);
});

test('H8 (override): Market edge bars are white — lead --viz-white-lead, the other 70% — on --viz-track, never blue', () => {
  assert.equal(S.C_BAR_LEAD, 'var(--viz-white-lead)');
  assert.equal(S.C_BAR_OTHER, 'color-mix(in srgb, var(--viz-white-lead) 70%, transparent)');
  for (const bad of [/var\(--bar\)/, /var\(--viz-lead\)/, /var\(--viz-second\)/, /var\(--link\)/]) assert.ok(!bad.test(block), `builder-c block uses ${bad}`);
  // A wins 10 of 10 at 1.10, B 5 of 10: A's bar leads, B's is the 70% bar
  const A = playerWith(rowsOf(Array.from({ length: 10 }, (_, i) => [10 + i, 1.10, true])));
  const B = playerWith(rowsOf(Array.from({ length: 10 }, (_, i) => [10 + i, 1.10, i < 5])));
  const m = S.marketVals(A, B, { mScope: 'l52' });
  const fillOf = h => /data-fill="1" style="[^"]*background:([^;]+);/.exec(h)[1];
  const a0 = /data-h2hc-band="a0"[\s\S]*?<\/div>/.exec(S.cBandsCol(m, 0))[0], b0 = /data-h2hc-band="b0"[\s\S]*?<\/div>/.exec(S.cBandsCol(m, 1))[0];
  assert.equal(fillOf(a0), 'var(--viz-white-lead)');
  assert.equal(fillOf(b0), 'color-mix(in srgb, var(--viz-white-lead) 70%, transparent)');
  assert.match(a0, /background:var\(--viz-track\)/);
});

test('Market edge = the Match analysis maths: MarketEdgeCore bands, Needs = n / Σ price, the n < 5 gate dashes Won, Edge and 1u together', () => {
  // 1.10 ×2 (won both) + one loss at 1.30 in the same band → Needs = 3 / 3.50
  const A = playerWith(rowsOf([[20, 1.10, true], [21, 1.10, true], [22, 1.18, false], [23, 2.2, true]]));
  const m = S.marketVals(A, A, { mScope: 'l52' });
  const col = text(S.cBandsCol(m, 0));
  const M = core.playerModel(A._cSt.rows, { scope: 'l52', refDay: day0, winnerRows: A._cSt.rows.win });
  assert.equal(M.bands[0].n, 3);
  assert.match(col, new RegExp('1.01–1.20 2–1 · needs ' + Math.round(M.bands[0].needs * 100) + '% — — —'));
  assert.match(col, /2\.00–2\.50 1–0 · needs 45% — — —/, 'a 1–0 band prints "—" for Won, Edge and 1u (ruling: n < 5)');
  // a full band prints Won, Edge (pp, 1 dp, signed) and 1u (signed, 1 dp)
  const F = playerWith(rowsOf(Array.from({ length: 10 }, (_, i) => [10 + i, 1.5, i < 8])));
  const mf = S.marketVals(F, F, { mScope: 'l52' });
  const MF = core.playerModel(F._cSt.rows, { scope: 'l52', refDay: day0, winnerRows: F._cSt.rows.win });
  const b = MF.bands[core.bandOf(1.5)];
  const t = text(S.cBandsCol(mf, 0));
  assert.ok(t.includes('80%'), t);
  assert.ok(t.includes((b.won - b.needs) * 100 >= 0 ? '+' + ((b.won - b.needs) * 100).toFixed(1) + 'pp' : '−' + Math.abs((b.won - b.needs) * 100).toFixed(1) + 'pp'), t);
  assert.ok(t.includes('+2.0u'), t);   // 8 wins × 0.5 − 2 losses
  assert.match(t, /10 priced/);
});

test('L-c1: the price bands are the reference\'s six (1.01–1.20 / 1.21–1.50 / 1.51–1.99 | 2.00–2.50 / 2.51–3.50 / 3.51+), half-open in thousandths, 2.00 underdog', () => {
  assert.match(block, /const H2H_ME_BAND_SET = 'reference';/);
  assert.deepEqual(S.H2H_ME_BANDS.map(b => b.label.replace(/\s/g, '')), ['1.01–1.20', '1.21–1.50', '1.51–1.99', '2.00–2.50', '2.51–3.50', '3.51+']);
  assert.deepEqual(S.H2H_ME_BANDS.map(b => b.gk), ['fav', 'fav', 'fav', 'dog', 'dog', 'dog']);
  const at = p => S.cBandOf(core, p);
  assert.deepEqual([1.01, 1.205, 1.21, 1.50, 1.505, 1.51, 1.99, 2.00, 2.50, 2.505, 2.51, 3.50, 3.51, 12].map(at), [0, 0, 1, 1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 5]);
  assert.equal(at(1.0), -1); assert.equal(at(null), -1);
  // same maths: every priced row lands in exactly one band and the band sums equal playerModel's own totals
  const A = playerWith(rowsOf([[20, 1.10, true], [21, 1.5, false], [22, 1.51, true], [23, 2.0, true], [24, 2.51, false], [25, 4.0, true]]));
  const m = S.marketVals(A, A, { mScope: 'l52' }), M = m.MM[0];
  assert.equal(M.bands.length, 6);
  assert.equal(M.bands.reduce((s2, b) => s2 + b.n, 0), M.priced.length);
  assert.equal(Math.round(M.bands.reduce((s2, b) => s2 + b.plCents, 0)), Math.round(M.units * 100));
  assert.deepEqual(M.bands.map(b => b.n), [1, 1, 1, 1, 1, 1]);
});

test('Market edge scope tabs = the page\'s darker track (builder a\'s h2hSeg → sfSegHtml): selected = .on (--inner + --edge-10, white 700), wired to the page event path', () => {
  const A = playerWith(rowsOf([[20, 1.10, true]]));
  const html2 = S.marketCard({ market: S.marketVals(A, A, { mScope: 'career' }) });
  const seg = /<div class="sf-seg h2h-seg h2h-seg--md"[\s\S]*?<\/div>/.exec(html2);
  assert.ok(seg, 'the Market edge head carries h2hSeg at the md size');
  assert.match(seg[0], /class="sf-seg__opt on" aria-selected="true" data-hid="\d+">Career</);
  assert.match(seg[0], /class="sf-seg__opt" aria-selected="false" data-hid="\d+">Last 52 weeks</);
  assert.ok(!/onclick=/.test(seg[0]), 'no inline onclick: the H2H data-hid path');
  assert.ok(!/maSeg\(/.test(block), 'no second segmented control in builder c');
  // the darker track itself (site CSS): selected --inner + --edge-10, white 700; no blue
  assert.match(html, /\.sf-seg__opt\.on\{ background:var\(--inner\); border-color:var\(--edge-10\); color:var\(--text\); font-weight:700; \}/);
  // every builder-c section title is the shared sectionHead
  for (const t of ['Playing styles', 'Tournament', 'Market edge']) assert.ok(block.includes("sectionHead('" + t + "'"), t);
});

test('Profit at 1u flat follows the chart rule: dotted horizontal guides only, break-even --viz-rule 1.25px, A white 2.4px, B white 45% 2px, no area', () => {
  const A = playerWith(rowsOf(Array.from({ length: 12 }, (_, i) => [30 + i * 9, 1.6, i % 3 !== 0])));
  const B = playerWith(rowsOf(Array.from({ length: 12 }, (_, i) => [25 + i * 9, 2.4, i % 2 === 0])));
  const svg = S.curveSVG(S.marketVals(A, B, { mScope: 'l52' }));
  const lines = svg.match(/<line [^>]*>/g) || [];
  assert.ok(lines.length >= 2);
  lines.forEach(l => { const y1 = /y1="([^"]+)"/.exec(l)[1], y2 = /y2="([^"]+)"/.exec(l)[1]; assert.equal(y1, y2, 'horizontal only'); });
  lines.filter(l => !/data-h2hc-zero/.test(l)).forEach(l => assert.match(l, /stroke="var\(--viz-guide\)" stroke-width="1" stroke-dasharray="2 6"/));
  assert.match(svg, /data-h2hc-zero="1"[^>]*stroke="var\(--viz-rule\)" stroke-width="1.25"/);
  assert.match(svg, /data-h2hc-series="a"[^>]*stroke="var\(--viz-white-lead\)" stroke-width="2.4"/);
  assert.match(svg, /data-h2hc-series="b"[^>]*stroke="color-mix\(in srgb, var\(--viz-white-lead\) 45%, transparent\)" stroke-width="2"/);
  assert.ok(!/<path|<polygon|fill="(?!none)/.test(svg), 'no area fill');
  // the reference's meaning: each line spans that player's own matches (never the shared date axis)
  assert.match(text(svg), /each line spans that player's own matches/);
  assert.ok(!/one date axis shared/.test(svg));
});

test('a band click filters the chart to that band (both players), the chip clears it', () => {
  const A = playerWith(rowsOf([[20, 1.10, true], [30, 1.10, true], [40, 3.0, false], [50, 3.0, true]]));
  const all = S.marketVals(A, A, { mScope: 'l52' });
  const one = S.marketVals(A, A, { mScope: 'l52', mBand: S.cBandOf(core, 3.0) });
  assert.equal(all.ser[0].length, 5);   // break-even start + 4 matches
  assert.equal(one.ser[0].length, 3);   // break-even start + the two 3.0 matches
  assert.equal(one.ser[0][2].c, 100);   // −1u then +2u
  assert.match(text(S.curveSVG(one)), /2\.51–3\.50 ✕/);
});

test('Record vs the opponent’s style: a signed bar — net wins --pos toward WINS, net losses --neg toward LOSSES, width = |W − L| / n × 50%, gated', () => {
  const base = { open: true, all: false, sur: 'Alcaraz', i: 0, hToggle: 1, hMore: 2 };
  const R = (w, l) => ({ state: 'ready', name: 'C. Alcaraz', other: 'J. Sinner', oppLab: 'Counterpuncher', w, l, n: w + l, avg: 51, rows: [] });
  const win = S.cStyleBox(Object.assign({ R: R(44, 16) }, base));
  assert.match(win, /data-tug="w" style="[^"]*width:23\.33%; background:var\(--pos\)/);
  assert.match(win, /data-tug="l" style="[^"]*width:0\.00%/);
  assert.match(text(win), /W44–L16 73% n=60 Wins \+28 wins Losses Matrix avg 51% \+22 Hide career meetings/);
  const loss = S.cStyleBox(Object.assign({ R: R(3, 9) }, base));
  assert.match(loss, /data-tug="l" style="[^"]*width:25\.00%; background:var\(--neg\)/);
  const small = S.cStyleBox(Object.assign({ R: R(4, 2) }, base));   // n = 6: grey, never green / red
  assert.match(small, /data-tug="w" style="[^"]*background:var\(--text-label\)/);
  const tiny = S.cStyleBox(Object.assign({ R: R(3, 0) }, base));    // n = 3: no fill
  assert.match(tiny, /data-tug="w" style="[^"]*width:0\.00%/);
  // the box toggles its ledger: open = --edge-24 (tile selected), closed = --edge-7 (clickable tile)
  assert.match(win, /border:1px solid var\(--edge-24\)/);
  assert.match(S.cStyleBox(Object.assign({ R: R(44, 16) }, base, { open: false })), /border:1px solid var\(--edge-7\)[\s\S]*Show career meetings \(60\)/);
});

test('Tournament: the record is the profile\'s per-event model (trProfileModel shared with trProfileBacking), priced on the Database join', () => {
  const pm = slice('trProfileModel'), pb = slice('trProfileBacking'), px = slice('trDbJoinPx');
  // founder ruling 2026-10-08: no closes shard (cl: null); every row priced by the page's one join (H2HPage.priceJoin)
  assert.match(pm, /const P = trModelOf\(hist, \{ ch, cl: null, px: trDbJoinPx\(name, ch\) \}, k, name, clean, names, '', 'ready'\);/);
  assert.match(px, /const J = typeof window !== 'undefined' && window\.H2HPage && window\.H2HPage\.priceJoin;/);
  assert.match(px, /J\(js, \{ full: name \}, null, _sfDbJoin, null, ch\);/);
  assert.ok(!/_fhCl/.test(pm + pb), 'the closes shard prices nothing here');
  assert.match(html, /\n    priceJoin: h2hPriceJoin,\n/, 'the Head to Head page exports THE join');
  assert.match(pm, /y\.won = y\.matches\.filter\(x => x\.won\)\.length; y\.lost = y\.matches\.length - y\.won;/);
  assert.match(pb, /const P = trProfileModel\(k, name, t\);/);
  assert.ok(!/trModelOf\(/.test(pb), 'one join: trProfileBacking no longer builds its own');
  assert.match(block, /trProfileModel\(p\.key, p\.full, t\)/);
  // tiles: Best result · Sets won · Last played · Backing (flat 1u, signed colour)
  assert.match(text(S.cTourTile('Backing', '−0.4u', 'var(--neg)', 'flat 1u · 6 priced')), /Backing −0\.4u flat 1u · 6 priced/);
  for (const cap of ["'Best result'", "'Sets won'", "'Last played'", "'Backing'"]) assert.ok(block.includes('cTourTile(' + cap), cap);
});

test('menus: the tournament picker is a search input on the compact site menu (--card + --edge-10, radius 10, --shadow-menu, scrolls after ~6 rows), no <select>', () => {
  const tc = sliceFrom(block, block.indexOf('function tourneyCard('));
  assert.match(tc, /<input class="h2hin" id="h2h-input-tour"[^>]*background:var\(--inner\); color:var\(--text\); border:1px solid transparent; border-radius:10px;/);
  assert.match(tc, /class="h2hc-menu"[^>]*max-height:212px; overflow-y:auto; background:var\(--card\); border:1px solid var\(--edge-10\); border-radius:10px; padding:4px; box-shadow:var\(--shadow-menu\)/);
  assert.match(tc, /background:\$\{o\.selected \? 'var\(--selected\)' : 'transparent'\}/);
  assert.match(tc, /\$\{o\.selected \? '✓' : ''\}/);
  assert.ok(!/<select/i.test(block));
  assert.match(html, /#h2hRoot \.h2hc-opt:hover\{ background:var\(--inner\) !important; \}/);
  assert.match(html, /#h2hRoot \.h2hc-led \.ma-row:hover\{ background:var\(--inner\) !important; \}/);
});

test('formatting: true minus and explicit sign on yields, en dash in records', () => {
  assert.equal(S.meSg(-0.4, 1, 'u'), '−0.4u');
  assert.equal(S.meSg(2, 1, 'u'), '+2.0u');
  assert.ok(block.includes("'W' + R.w + '–L' + R.l"));
  assert.ok(block.includes("P.W + '–' + P.L"));
  assert.ok(!/'-' \+ |\+ '-'/.test(block.replace(/' - '/g, '')), 'no hyphen-minus built into a figure');
});

test('Tournament levels read as the ledgers and the reference write them: the catalog\'s ATP 1000 = "Masters 1000"', () => {
  assert.equal(S.cLevel({ category: 'ATP 1000' }), 'Masters 1000');
  assert.equal(S.cLevel({ category: 'Grand Slam' }), 'Grand Slam');
  assert.equal(S.cLevel({ category: 'ATP 500' }), 'ATP 500');
  assert.equal(S.cLevel(null), null);
});

// ---------------------------------------------------------------- review fixes (TEN-402 lead, 2026-10-08)
const rowsOfLedger = h => [...h.matchAll(/<div class="seg ma-row[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map(m => text(m[1]));

// Fix 4 · the profit chart: each line spans that player's own matches (the reference).
test('fix 4: profit chart x = each player\'s own match index — both lines span the full width; dates follow the longer series; caption says so', () => {
  const A = playerWith(rowsOf([[300, 1.6, true], [200, 1.6, false], [20, 1.6, true]]));                       // 3 matches, far apart in time
  const B = playerWith(rowsOf(Array.from({ length: 10 }, (_, i) => [330 - i * 33, 2.4, i % 2 === 0])));        // 10 matches
  const m = S.marketVals(A, B, { mScope: 'career' }), C = m.chart;
  assert.deepEqual(C.a.pts.map(p => Math.round(p[0])), [0, 333, 667, 1000], 'A: break even + 3 matches, evenly across the plot');
  assert.equal(C.b.pts.length, 11); assert.equal(C.b.pts[0][0], 0); assert.equal(C.b.pts[10][0], 1000);
  // a long gap between two of A's matches is NOT a long flat run: consecutive matches are consecutive x steps
  assert.equal(Math.round(C.a.pts[2][0] - C.a.pts[1][0]), Math.round(C.a.pts[3][0] - C.a.pts[2][0]));
  // y is MarketEdgeCore.chartModel's own range rule
  const ref = core.chartModel(m.ser[0], m.ser[1], 'career');
  assert.deepEqual([C.lo, C.hi, C.zeroY, C.grid.length], [ref.lo, ref.hi, ref.zeroY, ref.grid.length]);
  // control: the old shared date axis would put A's middle match far from the middle (dates 300 / 200 / 20 days back)
  assert.notEqual(Math.round(ref.a.pts[2][0]), Math.round(C.a.pts[2][0]));
  // the dates under the axis follow the longer series (B), read at its matches
  assert.equal(C.dateOf, 1);
  assert.equal(C.ticks[0].label, String(new Date(m.ser[1][0].day * 86400000).getUTCFullYear()));
  const svg = S.curveSVG(m);
  assert.match(text(svg), new RegExp("each line spans that player's own matches \\(the dates follow " + B.short.replace('.', '\\.') + '’s\\)'));
});
test('fix 4: "Break even" sits on the rule at the left, card-tone backing, and the lines start right of it (never under it)', () => {
  const A = playerWith(rowsOf([[30, 1.6, true], [20, 1.6, false]]));
  const svg = S.curveSVG(S.marketVals(A, A, { mScope: 'l52' }));
  assert.match(svg, /class="h2hc-be" style="position:absolute; left:8px; top:[\d.]+%; transform:translateY\(-50%\); padding:2px 7px; border-radius:5px; background:var\(--card\);/);
  assert.ok(S.C_BE_INSET >= 96, 'the inset clears the label (8px + ~87px)');
  assert.match(svg, new RegExp(`<div class="h2hc-lines" style="position:absolute; top:0; bottom:0; left:${S.C_BE_INSET}px; right:0;"><svg class="h2hc-chart"`), 'the series svg + end dots start after the label');
  assert.match(svg, new RegExp(`class="h2hc-xlabels" style="margin:-6px 0 0 ${64 + S.C_BE_INSET}px;`), 'the date labels sit under the lines');
  const grid = /<svg class="h2hc-chart-grid"[\s\S]*?<\/svg>/.exec(svg)[0];
  assert.match(grid, /data-h2hc-zero="1" x1="0"[^>]*x2="1000"/, 'the rule (and the guides) run the full width under the label');
  assert.ok(!/<polyline/.test(grid));
});

// Fix 2 · Data 2: the Playing styles and Tournament ledgers' prices come from the Database join.
// The page's join rows (founder ruling 2026-10-08): the Database rows + the retirements behind the store's flag, merged by
// the page's own DatabaseTab helper (sliced); DB_ONLY = the Database page's rows alone (the control).
const DB_BASE = JSON.parse(readFileSync(join(HERE, 'database-yield.json'), 'utf8'));
const DB_NAMES = JSON.parse(readFileSync(join(HERE, 'database-yield-players.json'), 'utf8'));
const DB = new Function(`${slice('dbPriceJoinRows')}\nreturn dbPriceJoinRows;`)()(DB_BASE, DB_NAMES);
const DB_ONLY = { rows: DB_BASE.rows, names: DB_NAMES.names, meta: DB_BASE.meta };
// The Playing styles rows are a SYNTHETIC fixture in the style-meetings shard's shape (review 2, item 5: the committed
// style-meetings/*.json is rewritten by the daily Styles bot, so a test must never pin its values). The rows below are
// frozen copies of Sinner's 2025 finals v Alcaraz as the shard carried them on 2026-10-01 (edition-start dates, the
// shard's own oddsSelf / oddsOpp = the defect's input); the Database rows are the committed database-yield.json.
const STYLE_ROWS = [
  { won: true, opponent: 'Carlos Alcaraz', surface: 'hard', tournament: 'ATP Finals', result: '7-6(4) 7-5', date: '2025-11-10', round: 'F', oddsSelf: 1.5, oddsOpp: 2.8 },
  { won: false, opponent: 'Carlos Alcaraz', surface: 'hard', tournament: 'US Open', result: '2-6 6-3 1-6 4-6', date: '2025-08-24', round: 'F', oddsSelf: 1.53, oddsOpp: 2.71 },
  { won: false, opponent: 'Carlos Alcaraz', surface: 'hard', tournament: 'Cincinnati Masters', result: '0-5 RET', date: '2025-08-07', round: 'F', oddsSelf: 1.53, oddsOpp: 2.71 },
  { won: true, opponent: 'Carlos Alcaraz', surface: 'grass', tournament: 'Wimbledon', result: '4-6 6-4 6-4 6-4', date: '2025-06-30', round: 'F', oddsSelf: 1.85, oddsOpp: 2.07 },
  { won: false, opponent: 'Carlos Alcaraz', surface: 'clay', tournament: 'Roland Garros', result: '6-4 7-6(4) 4-6 6-7(3) 6-7(2)', date: '2025-05-26', round: 'F', oddsSelf: 1.63, oddsOpp: 2.43 },
  { won: false, opponent: 'Carlos Alcaraz', surface: 'clay', tournament: 'Rome Masters', result: '6-7(5) 1-6', date: '2025-05-05', round: 'F', oddsSelf: 1.63, oddsOpp: 2.43 }];
test('fix 2: the Playing styles ledger prices Sinner\'s meetings from the Database — US Open 2025 F 1.81 / 2.12, Roland Garros 2025 F 1.88 / 2.03 (synthetic shard rows)', () => {
  const S2 = sandbox(DB);
  const rows = STYLE_ROWS.map(r => Object.assign({}, r));
  const led = rowsOfLedger(S2.cStyleLedger({ p: { key: '2072', full: 'J. Sinner' }, R: { rows, oppLab: 'All Court Elite' }, all: true, sur: 'Sinner', i: 0, hMore: 1 }));
  const at = (d, sc) => led.find(t => t.startsWith(d) && t.includes(sc));
  assert.match(at('24.08.', '2-6, 6-3, 1-6, 4-6'), /F 1–3 2-6, 6-3, 1-6, 4-6 1\.81 2\.12$/, 'US Open 2025 F = the archive (psw/psl 2.12 / 1.81), not the shard\'s 1.53 / 2.71');
  assert.match(at('26.05.', '6-7(2)'), / 1\.88 2\.03$/, 'Roland Garros 2025 F = the archive, not Rome\'s 1.63 / 2.43');
  assert.match(at('05.05.', '6-7(5), 1-6'), / 1\.63 2\.43$/, 'Rome 2025 F keeps its own price');
  assert.match(at('07.08.', '0–5'), / 1\.53 2\.71$/, 'Cincinnati 2025 F: the retirement priced on the join (ruling 2026-10-08), settled on the ATP result');
  const ledDb = rowsOfLedger(sandbox(DB_ONLY).cStyleLedger({ p: { key: '2072', full: 'J. Sinner' }, R: { rows: STYLE_ROWS.map(r => Object.assign({}, r)), oppLab: 'All Court Elite' }, all: true, sur: 'Sinner', i: 0, hMore: 1 }));
  assert.match(ledDb.find(t => t.startsWith('07.08.')), / — —$/, 'control: the Database rows alone void it → dash');
  // control: before the Database answers every price is a dash — never the shard's
  const S0 = sandbox(null);
  const led0 = rowsOfLedger(S0.cStyleLedger({ p: { key: '2072', full: 'J. Sinner' }, R: { rows, oppLab: 'All Court Elite' }, all: true, sur: 'Sinner', i: 0, hMore: 1 }));
  assert.ok(led0.every(t => / — —$/.test(t)), 'no Database → dashes');
});
// Review 2 (c, d) through the real ledger path (cStyleLedger → h2hLedgerJoin → h2hCareerOf → h2hPriceJoin): the shard's
// edition-start date joins through the player's loaded career-history row, and the result is the Head-to-head ledger's.
test('review 2 (c): the Playing styles ledger joins through the career-history date — Djokovic v Vacherot, Shanghai 2025 SF (shard 24.09) = 1.14 / 6.68', () => {
  const rows = [{ won: false, opponent: 'Valentin Vacherot', surface: 'hard', tournament: 'Shanghai Masters', result: '3-6 4-6', date: '2025-09-24', round: 'Semi-finals' }];
  const career = { 1905: [{ date: '2025-10-11', tournament: 'Shanghai', round: 'Semi-finals', opponent: 'V. Vacherot', won: false, eventKey: 12160001, level: 'atp' }] };
  const led = x => rowsOfLedger(sandbox(DB, x).cStyleLedger({ p: { key: '1905', full: 'N. Djokovic' }, R: { rows, oppLab: 'Big Server' }, all: true, sur: 'Djokovic', i: 0, hMore: 1 }));
  assert.match(led(career)[0], / 1\.14 6\.68$/);
  assert.match(led({})[0], / — —$/, 'control: no career store → 17 days past the window, a dash');
});
// Review 3 (1): a style row is dated at the edition START, so its match is on or after that date. The week before's
// event (same opponent, round and winner) must not win on a smaller unsigned distance. Alcaraz v Lajovic 2023: Buenos
// Aires QF (18.02, 1.17 / 6.20) and Rio QF (24.02, 1.15 / 6.61); the shard dates them 13.02 / 20.02.
const LAJ_DB = { meta: { rounds: ['Quarterfinals'] }, rows: [[20230217, 0, 1, 0, 0, 1.17, 6.20, 1, 0], [20230224, 0, 1, 0, 0, 1.15, 6.61, 1, 0]],
  names: [['Alcaraz C.', 'Lajovic D.'], ['Alcaraz C.', 'Lajovic D.']] };
const LAJ_ROWS = () => [{ won: true, opponent: 'Dusan Lajovic', surface: 'clay', tournament: 'Rio De Janeiro', result: '6-4 6-4', date: '2023-02-20', round: 'Quarter-finals' },
  { won: true, opponent: 'Dusan Lajovic', surface: 'clay', tournament: 'Buenos Aires', result: '6-4 6-2', date: '2023-02-13', round: 'Quarter-finals' }];
const LAJ_CAREER = { 2382: [{ date: '2023-02-18', tournament: 'Buenos Aires', round: 'Quarter-finals', opponent: 'D. Lajovic', won: true, eventKey: 1, level: 'atp' },
  { date: '2023-02-24', tournament: 'Rio de Janeiro', round: 'Quarter-finals', opponent: 'D. Lajovic', won: true, eventKey: 2, level: 'atp' }] };
const lajLedger = () => rowsOfLedger(sandbox(LAJ_DB, LAJ_CAREER).cStyleLedger({ p: { key: '2382', full: 'C. Alcaraz' }, R: { rows: LAJ_ROWS(), oppLab: 'Solid Baseliner' }, all: true, sur: 'Alcaraz', i: 0, hMore: 1 }));
test('review 3: a start-dated style row takes its own week, never the week before — Alcaraz v Lajovic, Rio 2023 = 1.15 / 6.61, Buenos Aires = 1.17 / 6.20', () => {
  const led = lajLedger();
  assert.match(led.find(t => t.startsWith('20.02.')), / 1\.15 6\.61$/, 'Rio');
  assert.match(led.find(t => t.startsWith('13.02.')), / 1\.17 6\.20$/, 'Buenos Aires');
});
// Review 3 (2): the archive's "O Connell C." (two words) is our "C. O'Connell" (one word) — the opponent index files a
// name under its words AND the words joined (h2hTdIx), so the row is offered to h2hTdSame at all.
test("review 3: the archive's \"O Connell C.\" joins our C. O'Connell (Sinner, Miami 2024 R16 = 1.06 / 13.39)", () => {
  const db = { meta: { rounds: ['Quarterfinals'] }, rows: [[20240326, 0, 0, 0, 0, 1.06, 13.39, 1, 0]], names: [['Sinner J.', 'O Connell C.']] };
  const career = { 2072: [{ date: '2024-03-26', tournament: 'Miami', round: 'Quarter-finals', opponent: "C. O'Connell", won: true, eventKey: 3, level: 'atp' }] };
  const rows = () => [{ won: true, opponent: "Christopher O'Connell", surface: 'hard', tournament: 'Miami Masters', result: '6-4 6-3', date: '2024-03-20', round: 'Quarter-finals' }];
  const led = rowsOfLedger(sandbox(db, career).cStyleLedger({ p: { key: '2072', full: 'J. Sinner' }, R: { rows: rows(), oppLab: 'Big Server' }, all: true, sur: 'Sinner', i: 0, hMore: 1 }));
  assert.match(led[0], / 1\.06 13\.39$/);
});
test('ruling 2026-10-08: the Tournament panel draws ONE model — the ledger shows P.all\'s Database prices and Backing = flat 1u over exactly those priced rows (tile N = the ledger\'s priced rows)', () => {
  const mk = (o) => Object.assign({ wo: false, ret: false, sets: [[6, 4], [6, 4], [6, 4]], pS: 3, oS: 0, src: 'td' }, o);
  // P as trProfileModel hands it over: rows already priced on the Database join (book P / B), one the join lacks (null)
  const f = mk({ mid: 'm1', date: '2025-09-07', won: false, round: 'F', opp: 'C. Alcaraz', sets: [[2, 6], [6, 3], [1, 6], [4, 6]], pS: 1, oS: 3, price: 1.81, oppPrice: 2.12, book: 'P' });
  const sf = mk({ mid: 'm2', date: '2025-09-05', won: true, round: 'SF', opp: 'F. Auger-Aliassime', price: 1.50, oppPrice: 2.60, book: 'B' });
  const qf = mk({ mid: 'm3', date: '2025-09-03', won: true, round: 'QF', opp: 'L. Musetti', price: null, oppPrice: null, book: null, src: null });
  // a retirement the store keeps behind its flag: priced, settled on the ATP result (a win at 1.20)
  const r4 = mk({ mid: 'm4', date: '2025-09-01', won: true, round: 'R16', opp: 'X. Retiree', ret: true, retSettle: true, price: 1.20, oppPrice: 4.5, book: 'P', pS: 1, oS: 0, sets: [[6, 2], [2, 1]] });
  const all = [f, sf, qf, r4], priced = all.filter(core.inWinner);
  const units = priced.reduce((t, r) => t + core.plCents(r), 0) / 100;   // −1 + 0.50 + 0.20 = −0.30
  const P = { eds: [{ year: '2025', won: 3, lost: 1, rows: all }], all, n: 4, W: 3, L: 1, best: null, sT: 9, sW: 8, played: [{ year: '2025', rows: all }], priced, units };
  const c = { p: { key: '2072', full: 'J. Sinner', short: 'J. Sinner' }, t: { name: 'US Open' }, state: 'ready', P, more: false, hMore: 1 };
  const h = sandbox(null).cTourPanel(c, 0);   // no Database rows in the sandbox: the panel never re-joins, it shows P's prices
  const led = rowsOfLedger(h);
  assert.match(led[0], / 1\.81 2\.12$/, 'the final: the model row\'s Database price');
  assert.match(led[1], / 1\.50 2\.60$/, 'the semi-final: Bet365, unmarked (founder r1 fix 3: one footnote under the ledger)');
  assert.match(led[2], / — —$/, 'a row the join lacks → dash');
  assert.match(led[3], / 1\.20 4\.50$/, 'the retirement is priced');
  const back = x => text(/data-h2hc-backing="1"[\s\S]*?<\/div>/.exec(x)[0]);
  assert.match(back(h), /−0\.3u flat 1u · 3 priced/);
  const pricedRows = led.filter(t => !/ — —$/.test(t)).length;
  assert.equal(pricedRows, 3, 'tile "3 priced" = the ledger\'s priced rows');
  // the dead option is gone: no second Backing source, no second join call in the panel
  assert.ok(!/H2H_BACKING_SOURCE|dbBack/.test(html), 'H2H_BACKING_SOURCE deleted (one rule)');
  const tp = sliceFrom(block, block.indexOf('function cTourPanel('));
  assert.ok(!/h2hLedgerJoin\(/.test(tp), 'the panel does not price the rows a second time');
  assert.match(tp, /const np = P\.priced\.length, units = P\.units;/);
  // control: a panel that summed only the completed rows (the retirement voided) would read −0.5u · 2 priced
  const voided = Object.assign({}, P, { priced: priced.filter(r => !r.ret), units: -0.5 });
  assert.match(back(sandbox(null).cTourPanel(Object.assign({}, c, { P: voided }), 0)), /−0\.5u flat 1u · 2 priced/);
});

// Fix 3 (R1) → r4 fix 2 (founder, 2026-10-09: "NEVER an ellipsis on scores"): this page's ledgers wrap set scores between
// sets and the row grows — the R1 one-line ellipsis rule is reversed. Page-scoped; other pages unchanged.
test('r4 fix 2: the Playing styles + Tournament ledgers never cut set scores — they wrap between sets (#h2hRoot only)', () => {
  assert.match(html, /\n  #h2hRoot \.h2hc-led \.ma-row-score\{ min-width:0; white-space:normal; overflow:visible; \}/);
  assert.ok(!/ma-row-score\{[^}]*(text-overflow:ellipsis|white-space:nowrap|overflow:hidden)/.test(html), 'no score cell is cut or held on one line');
  assert.ok(!/(^|[\s}])\.ma-row-score\s*\{/m.test(html.replace(/#h2hRoot \.h2hc-led \.ma-row-score/g, '')), 'no unscoped rule: Form / Tournaments / profile rows unchanged');
  // both ledgers carry the class the rule targets
  assert.match(block, /<div class="h2hc-led" style="\$\{C_PANEL\} flex:1;/);
  assert.match(block, /<div class="h2hc-led h2hc-tled"/);
  assert.match(html, /<span class="ma-row-score"\$\{t\(r\.scoresTitle\)\}/);
});
