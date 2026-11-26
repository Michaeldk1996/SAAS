// Head to Head round 7 — the final design (design_handoff_stennisfy_final, founder 2026-11-26) and the founder's six
// fixes of the same day. Every check EXECUTES the shipped window.H2HPage module (tools/h2h-test-harness.js); TEN402_HTML
// overrides the page for tools/test-h2h-r7-mutants.js, where each check has a mutant that must turn it red.
//
// Run: node --test test-h2h-r7.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const html = readFileSync(process.env.TEN402_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const HX = require(join(HERE, 'tools/h2h-test-harness.js'));
const text = h => String(h).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const ZV = { key: '1980', full: 'A. Zverev', short: 'A. Zverev', mono: 'AZ' }, SN = { key: '2072', full: 'J. Sinner', short: 'J. Sinner', mono: 'JS' };

// the pair estimate as the page reads it (pair-prices/<key>.json): Zverev v Sinner, the live cells of 26 Nov 2026
function modelPage(cells) {
  const h = HX.load({ html });
  h.X.__eval('_pairPx')['1980'] = { st: 'ready', at: Date.now(), d: { margin: 0.0339, marginN: 442, generatedAt: '2026-11-26T01:27:22Z', opp: { 2072: cells } } };
  h.X.__eval('_pairPx')['2072'] = { st: 'ready', at: Date.now(), d: { margin: 0.0339, marginN: 442, opp: {} } };
  return h;
}
const LIVE = { A3: [1600, 2400, 8], A5: [1610, 2400, 9], H3: [1500, 2353, 9], H5: [1509, 2353, 10], C3: [2345, 2881, 9], G3: [2106, 2749, 9] };

test('fix 1: the likely opening price is a range from the Elo-only price to the full model price, low – high', () => {
  const h = modelPage(LIVE);
  const m = h.call(h.modelVals, ZV, SN, { ctxSurface: 'Hard', ctxFormat: 3 });
  assert.equal(m.aRange, '4.11 – 6.45');
  assert.equal(m.bRange, '1.14 – 1.26');
  const card = h.call(h.modelCard, { a: ZV, b: SN, model: m, dna: null });
  const prices = [...card.matchAll(/data-h2h-price[^>]*>([^<]*)</g)].map(x => x[1]);
  assert.deepEqual(prices, ['4.11 – 6.45', '1.14 – 1.26']);
  assert.match(card, /The range runs from the Elo-only price \(no model layer: A\. Zverev 4\.11 · J\. Sinner 1\.26\) to the full model price \(A\. Zverev 6\.45 · J\. Sinner 1\.14\)/);
  // equal ends print one price
  const one = modelPage({ H3: [5000, 5000, 9] });
  assert.equal(one.call(one.modelVals, ZV, SN, { ctxSurface: 'Hard', ctxFormat: 3 }).aRange, '1.93');
});

test('the card opens on All surfaces and reads the estimate\'s no-surface cell (A3), never the Hard cell', () => {
  const h = modelPage(LIVE);
  assert.equal(h.state.ctxSurface, 'all');
  const m = h.call(h.modelVals, ZV, SN, h.state);
  assert.equal(m.aPrice, (1 / (0.16 * 1.0339)).toFixed(2));
  assert.equal(m.foot.surface, 'all surfaces');
});

test('fix 2: no blue flash — a filter pick repaints the prices white at once (no timer, no flash state)', () => {
  const h = modelPage(LIVE);
  h.call(h.X.__eval('setCtx'), { ctxSurface: 'Clay' });
  assert.equal(h.state.flash, undefined);
  const card = h.call(h.modelCard, { a: ZV, b: SN, model: h.call(h.modelVals, ZV, SN, h.state), dna: null });
  for (const s of card.matchAll(/<span data-h2h-price style="([^"]*)"/g)) { assert.match(s[1], /color:var\(--h2h-text\)/); assert.doesNotMatch(s[1], /h2h-blue|transition/); }
});

test('Model and playing style is ONE card: the playing style block sits inside #h2h-model, under a hairline, with no head of its own', () => {
  const h = modelPage(LIVE);
  const v = { a: ZV, b: SN, model: h.call(h.modelVals, ZV, SN, h.state), dna: null };
  h.X.__eval('_dna = { byKey: {}, meta: {} }');
  v.dna = h.call(h.dnaVals, ZV, SN);
  const card = h.call(h.modelCard, v);
  assert.match(card, /^<div id="h2h-model"/);
  assert.match(card, /<div id="h2h-dna"[^>]*border-top:1px solid/);
  const pre = card.slice(0, card.indexOf('<div id="h2h-dna"'));
  assert.ok((pre.match(/<div\b/g) || []).length - (pre.match(/<\/div>/g) || []).length >= 1, 'the block opens inside the model card');
  assert.match(text(card), /^Model and playing style \?/);
  assert.doesNotMatch(text(card), /Stennisfy Model|Playing style Hard/);
  // its chips: Surface · Format · Window, the values only
  const chips = [...card.matchAll(/data-frchip="([^"]+)"[^>]*>(?:<span>([^<]*)<\/span>)/g)].map(x => x[1] + '=' + x[2]);
  assert.deepEqual(chips, ['Surface=All surfaces', 'Format=Best of 3', 'Window=Last 52 weeks']);
});

test('no page-level filters: the sticky bar holds the pickers and the section nav only; the nav marks the section in view', () => {
  const h = HX.load({ html });
  const bar = h.call(h.selectorBar, { aPicked: false, bPicked: false, aSearching: true, bSearching: true, aListOpen: false, bListOpen: false, aQuery: '', bQuery: '', hAInput: 0, hBInput: 0, hAFocus: 0, hBFocus: 0, hSwap: 0, ctxShow: true,
    nav: [['h2h-model', 'Model'], ['h2h-rec', 'Meetings']].map(x => ({ id: x[0], label: x[1] })) });
  assert.doesNotMatch(bar, /Best of 3|>Surface<|x-sw--lg/);
  assert.match(bar, /data-h2h-jump="h2h-model" data-navon="1"/);
  assert.match(bar, /data-h2h-jump="h2h-rec" data-navon="0"/);
  assert.match(readFileSync(process.env.TEN402_CSS || join(HERE, 'h2h-page.css'), 'utf8'), /#h2hRoot \.x-nav\[data-navon="1"\] \{ font-weight: 700; color: var\(--h2h-text\); background: var\(--h2h-raised\)/);
});

test('chips: one menu open at a time, a pick closes it; a fixed chip is grey, has no caret and no handler', () => {
  const h = HX.load({ html });
  let picked = null;
  const groups = [{ label: 'Surface', cur: 'all', opts: [['all', 'All'], ['Hard', 'Hard']], pick: x => { picked = x; } },
    { label: 'Court speed', cur: 'Fast', fixed: true, opts: [['all', 'All'], ['Fast', 'Fast']], pick: () => {} }];
  let out = h.call(h.xChips, 'tour', groups);
  assert.doesNotMatch(out, /data-frmenu/);
  h.state.frOpen = 'tour:Surface';
  out = h.call(h.xChips, 'tour', groups);
  assert.equal((out.match(/data-frmenu=/g) || []).length, 1);
  const opt = /data-frmopt="Hard"[^>]*data-hid="(\d+)"/.exec(out);
  h.X.handlers()[+opt[1]]();
  assert.equal(picked, 'Hard'); assert.equal(h.state.frOpen, null);
  const fixed = /<span data-frchip="Court speed"([^>]*)>(.*?)<\/span><\/div>/.exec(out);
  assert.doesNotMatch(fixed[1], /data-hid/);
  assert.match(fixed[1], /title="Court speed · set by the tournament"/);
  assert.match(fixed[1], /color:var\(--h2h-grey\)/);
  assert.doesNotMatch(fixed[2], /rotate\(45deg\)/);
  // a fixed chip never opens, even when frOpen names it
  h.state.frOpen = 'tour:Court speed';
  assert.doesNotMatch(h.call(h.xChips, 'tour', groups), /data-frmenu/);
});

// ── the record box: Indoor carved out of the surface, the filters, the tiles ──
async function pairPage(meetings) {
  const ch = { 1980: [], 2072: [] };
  meetings.forEach((m, i) => {
    const sets = m.sets.map(s => ({ p: s[0], o: s[1] }));
    const pS = m.sets.filter(s => s[0] > s[1]).length, oS = m.sets.length - pS;
    const base = { date: m.date, tournament: m.t, round: m.round || 'F', level: 'atp', eventKey: 500 + i, surface: m.surface || 'hard' };
    if ('indoor' in m) base.indoor = m.indoor;
    ch[1980].push(Object.assign({}, base, { opponent: SN.short, oppKey: 2072, won: m.won, sets, result: pS + ' - ' + oS, retired: false }));
    ch[2072].push(Object.assign({}, base, { opponent: ZV.short, oppKey: 1980, won: !m.won, sets: sets.map(s => ({ p: s.o, o: s.p })), result: oS + ' - ' + pS, retired: false }));
  });
  const h = HX.load({ html, globals: { loadCareerHistory: k => Promise.resolve(ch[k]), careerHistoryAnswered: () => true, fhLoadCloses: () => Promise.resolve(null),
    sfH2hNkCount: () => ({}), careerHistoryIdOf: () => null, _sfDbJoinSt: 'ready', _sfDbJoin: { rows: [], names: [], meta: { rounds: [] } },
    loadSetStatsIndex: () => Promise.resolve(new Set()), loadSetStatsShard: () => Promise.resolve(null), matchStatsFromShard: sh => sh,
    fhStateFor: () => ({ sheetMap: {} }), fhOpenSheet: () => {}, playerPhotoImg: k => `<img class="sf-ph" data-k="${k}">` } });
  h.call(h.h2hPairFor, ZV, SN);
  await new Promise(r => setTimeout(r, 5));
  h.call(h.h2hPairFor, ZV, SN);
  h.view = () => ({ a: ZV, b: SN, h2h: h.call(h.h2hViewFor, ZV, SN) });
  return h;
}
const MEET = [
  { date: '2025-10-26', t: 'Vienna', won: false, sets: [[6, 3], [3, 6], [5, 7]], indoor: true },
  { date: '2025-11-01', t: 'Paris', round: '1/2-finals', won: false, sets: [[0, 6], [1, 6]] },          // no flag: the catalog says indoor
  { date: '2025-09-05', t: 'US Open', round: '1/8-finals', won: true, sets: [[6, 4], [3, 6], [6, 2], [4, 6], [6, 3]], indoor: false },
  { date: '2026-04-11', t: 'Monte Carlo', round: '1/2-finals', surface: 'clay', won: false, sets: [[1, 6], [4, 6]], indoor: false },
];

test('fix 5: Indoor is its own surface in the record box — carved out of Hard, from career-history\'s flag else the catalog', async () => {
  const h = await pairPage(MEET);
  const rows = h.view().h2h.every;
  assert.equal(rows.find(r => /Vienna/.test(r.tournRaw || r.tourn)).indoor, true);
  assert.equal(rows.find(r => /Paris/.test(r.tournRaw || r.tourn)).indoor, true);   // catalog fallback
  h.state.frOpen = 'rec:Surface';
  const card = h.call(h.h2hCard, h.view());
  const cnt = k => +new RegExp(`data-frmopt="${k}"[\\s\\S]*?<span>[^<]*</span><span[^>]*>(\\d+)<`).exec(card)[1];
  assert.equal(cnt('Indoor'), 2); assert.equal(cnt('Hard'), 1); assert.equal(cnt('Clay'), 1); assert.equal(cnt('all'), 4);
  assert.match(card, /data-frmopt="Grass"[^>]*title="Nothing to show for this option"/);   // none = greyed, not clickable
  h.state.frOpen = null; h.state.h2hSurf = 'Indoor';
  assert.deepEqual(h.view().h2h.F.map(r => r.tournRaw || r.tourn).sort(), ['Paris', 'Vienna']);
  assert.match(text(h.call(h.h2hCard, h.view())), /Indoor 0 – 2/);
  h.state.h2hSurf = 'Grass';
  assert.match(text(h.call(h.h2hCard, h.view())), /No meetings on grass · 4 meetings on other surfaces/);
});

test('record box filters: Window, Format and Court speed cut the meetings the record and the Surface counts read', async () => {
  const h = await pairPage(MEET);
  h.state.hrFmt = 5;
  assert.deepEqual(h.view().h2h.F.map(r => r.tournRaw || r.tourn), ['US Open']);
  h.state.hrFmt = 'all'; h.state.hrWin = 'w52';
  assert.ok(h.view().h2h.F.every(r => r.date >= h.call(h.xTrCut, 'w52')));
});

test('hot lines: a Last 5 · All track, a basis label under every count, the Bo5 lines', async () => {
  const h = await pairPage(MEET);
  const card = h.call(h.h2hCard, h.view());
  assert.match(card, /data-hotwin/);
  assert.match(text(card), /Best line per family · all meetings · 4 meetings/);
  const basis = [...card.matchAll(/data-hotbasis[^>]*>([^<]*)</g)].map(x => x[1]);
  assert.ok(basis.length > 0 && basis.every(b => /^(Bo3 only|Bo5 only|all 4 meetings)$/.test(b)), basis.join(','));
  assert.ok(basis.includes('Bo5 only'));
  assert.match(text(card), /Over 3\.5 sets/);
  assert.match(card, /grid-template-columns:minmax\(150px,0\.8fr\) 56px 112px/);
});

test('the record box: four tiles in the design\'s order, the head avatars are photos, "Meetings ?" and two-line events', async () => {
  const h = await pairPage(MEET);
  h.state.h2hBox = true;
  const box = h.call(h.h2hBoxHTML, h.view());
  const t = text(box);
  const order = ['Total points won', 'Went to a deciding set', 'Sets and tiebreaks', 'Favourite won'].map(k => t.indexOf(k));
  assert.ok(order.every((x, i) => x > 0 && (!i || x > order[i - 1])), order.join(','));
  assert.doesNotMatch(t, /On hard|On clay/);
  assert.match(t, /Sets and tiebreaks Sets 4–8 No tiebreak played · Zverev first/);
  assert.equal((box.match(/class="sf-ph" data-k="1980"/g) || []).length >= 1, true);
  assert.equal((box.match(/class="sf-ph" data-k="2072"/g) || []).length >= 1, true);
  assert.match(t, /Meetings \? 4 on record/);
  assert.match(box, /grid-template-columns:48px 12px minmax\(0,1\.8fr\) 36px 40px minmax\(0,1\.1fr\) 46px 46px/);
});

test('fix 4: a player under the 10-match floor in the last 52 weeks reads the same file\'s since-March-2024 window, labelled in the "?"', () => {
  const node = (m, ok) => ({ inPool: true, ok, matches: m, ratings: [300, 140, 250, 1.3, 2100], pcts: [80, 70, 60, 75, 90], deltas: [0, 0, 0, 0, null] });
  const h = HX.load({ html });
  h.sb.__radar = (k, s, scope) => k === '2072' ? (scope === 'sinceBase' ? node(24, true) : node(7, false)) : node(11, true);
  h.X.__eval('_dna = { byKey: {}, meta: {} }; dnaRadarFor = (k, s, sc) => globalThis.__radar(k, s, sc); dnaExtraFor = () => [null, null, null, null, null]');
  h.state.ctxSurface = 'Grass';
  const D = h.call(h.dnaVals, ZV, SN);
  assert.equal(D.b.d.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(D.b.wide)), { m52: 7, m: 24 });
  assert.notEqual(D.b.vals[0].raw, null);
  assert.equal(D.b.vals[2].raw, null);   // Under pressure: no since-2024 figure
  assert.match(h.call(h.dnaHelp, { dna: D }), /J\. Sinner: 7 matches on grass in the last 52 weeks, under the 10-match floor, so his figures are since March 2024 \(24 matches\)/);
});

test('Tournament record: no Window; "Clear tournament" + fixed chips while picked; the speed chip from that season\'s reading', () => {
  const h = HX.load({ html });
  assert.equal(h.call(h.xSpeedChip, 'Paris', 2099), '');
  h.need('COURT_CONDITIONS');
  const cc = h.sb.COURT_CONDITIONS;
  const ev = Object.keys(cc).find(k => typeof cc[k].as2025 === 'number');
  const chip = h.call(h.xSpeedChip, ev, '2025');
  const d = Math.round((cc[ev].as2025 - 1) * 100) / 100;
  assert.match(chip, new RegExp('Speed ' + (d > 0 ? '\\+' : d < 0 ? '−' : '') + Math.abs(d).toFixed(2).replace('.', '\\.')));
  const src = html;
  assert.doesNotMatch(src.slice(src.indexOf('  function tourneyVals'), src.indexOf('  function xTrEvent')), /label: 'Window'/);
  assert.match(src, /data-tr-clear/);
});

test('Market edge: chips in the head, no window tabs left in the head or on the chart', () => {
  const src = html.slice(html.indexOf('  function marketCard'), html.indexOf('  function xNewsCat'));
  assert.doesNotMatch(src, /m\.tabs/);
  assert.match(src, /xBoxHead\('Market edge', bandHelp, xChips\('market', m\.chips\)\)/);
});
