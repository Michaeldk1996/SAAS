// TEN-314 (TEN-312 D2, founder 2026-09-28): ONE sample gate for every rate in the Match analysis modal —
// tourxSampleGate, through the shared helpers maGate / maRate / maRateHtml / maGateBar / maSmallChip.
//   n = 0 → "—" (never 0%, 0.0% or NaN%) · n 1–4 → no rate (the W–L / count carries it) · n 5–9 → greyed + "small sample"
//   · n ≥ 10 → full. Small-sample chip for every n 1–9.
// Every check drives the page's REAL functions (sliced out of bsp-consult-dashboard.html and executed) with fixtures at
// n = 0, 3, 7, 12, and names the mutation that turns it red; tools/test-ten314-mutants.js applies each one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { profileWindow } from './tools/ten334-overview-vm.mjs';
import { ma2VM } from './tools/ma2-frame-vm.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN314_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
// 2026-11-23 rebuild: the Market edge, H2H and Overview renderers live in match-analysis-v2.js (run on the sliced dashboard)
const v2 = readFileSync(process.env.TEN314_V2 || join(HERE, 'match-analysis-v2.js'), 'utf8');
function slice(name) {
  let start = html.indexOf(`\nfunction ${name}(`);
  if (start < 0) start = html.indexOf(`\nasync function ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  const eol = html.indexOf('\n', start + 1), line = html.slice(start, eol);
  if (/\}\s*$/.test(line) && (line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;   // one-liner
  let d = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; }
  return html.slice(start, i + 1);
}
function constSrc(name) {
  const start = html.indexOf(`\nconst ${name} = `);
  assert.ok(start > 0, `const ${name} not found`);
  return html.slice(start, html.indexOf(';\n', start) + 1);
}
const GATE = ['tourxSampleGate', 'maGate', 'maPct', 'maRate', 'maRateHtml', 'maSmallNote', 'maGateBar', 'maSmallChip'];
const GATE_CONSTS = ['MA_GREY', 'MA_SMALL_NOTE'];
// One sandbox: the gate helpers + the site builders under test + the minimum of their real neighbours.
const S = new Function(`
  const document = { addEventListener(){}, querySelectorAll(){ return []; } };
  const window = {};
  ${GATE_CONSTS.map(constSrc).join('\n')}
  ${[...GATE, 'escapeHtml'].map(slice).join('\n')}
  return { maGate, maRate, maRateHtml, maGateBar, maSmallChip };
`)();
const DOC = { addEventListener(){}, querySelectorAll(){ return []; } };
// the rebuilt tab in the v2 sandbox: the gate helpers + meSg (Market edge), the Overview's own data layer (Overview)
function v2win(profiles = {}) {
  return ma2VM(html, v2, { seeds: ['maRateHtml', 'maGateBar', 'maSmallChip', 'maRate', 'meSg', 'escapeHtml', 'ovStateFor', 'ovCareerByYear', 'ovRecApi', 'alignYearlyPair', 'ovListable'],
    stubs: ['document', 'playerProfiles', 'loadCareerHistory', 'fhLoadCloses'], params: { document: DOC, playerProfiles: profiles, loadCareerHistory(){}, fhLoadCloses(){} },
    win: Object.assign(profileWindow(profiles), { MarketEdgeCore: { RET_SETTLE_NOTE: 'x' } }), expose: ['meBandsBox'],
    extra: ['_ovProfileSettled', 'OV_TIERS', 'OV_NO_KEY', 'OV_NO_LIST', 'OV_NO_SPLIT'].map(n => html.match(new RegExp('\\n(?:const|let) ' + n + ' = [^\\n]*'))[0]).join('\n') });
}
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const NS = [0, 3, 7, 12], WINS = { 0: 0, 3: 2, 7: 4, 12: 9 };      // fixtures: k of n
const NEVER = /(^|[^\d.])(0%|0\.0%|NaN%)/;

// Mutation: the gate's nopct tier starts at 3 (`n < 5` → `n < 3`), so a 3-match rate shows a %.
test('the gate: 0 → none, 3 → nopct, 7 → small, 12 → full (tourxSampleGate is the one ladder)', () => {
  assert.deepEqual(NS.map(n => S.maGate(n).mode), ['none', 'nopct', 'small', 'full']);
  assert.deepEqual([4, 5, 9, 10].map(n => S.maGate(n).mode), ['nopct', 'small', 'small', 'full']);
  assert.equal(S.maGate(null).mode, 'none');
  assert.match(slice('maGate'), /return tourxSampleGate\(n\);/, 'maGate IS tourxSampleGate');
});

// Mutation: the small tier keeps the caller's colour (not greyed), the note is dropped, or n = 0 renders "0%".
test('maRateHtml: "—" · nothing · greyed var(--text-label) + "small sample" · full', () => {
  const H = NS.map(n => S.maRateHtml(WINS[n], n, { color: 'var(--text)' }));
  assert.match(H[0], /data-ma-gate="none"[^>]*>—</); assert.ok(!NEVER.test(text(H[0])), 'n = 0 is never a zero rate');
  assert.equal(H[1], '', 'n = 3: no rate at all');
  assert.match(H[2], /data-ma-gate="small" style="color:var\(--text-label\);">57%<\/span>/);   // TEN-376: grey = the label tone
  assert.ok(text(H[2]).endsWith('small sample'), 'n = 7 carries the note');
  assert.match(H[3], /data-ma-gate="full" style="color:var\(--text\);">75%<\/span>$/);
  assert.equal(S.maRateHtml(0, 0, { dp: 1 }).includes('0.0%'), false);
  assert.equal(S.maRate(2, 3, { nopct: '2–1' }).txt, '2–1', 'n 1–4: the caller\'s count stands in');
  assert.match(S.maRateHtml(4, 7, { note: 'title' }), /title="small sample · n=7"/, 'the table-cell form: the note on hover');
});

// Mutation: the chip back to `n === 2` only, or the chip dropped for the nopct tier (n 1–4).
test('small-sample chip: n = 1, 3, 9 show it; 0 and 10 do not — the helper and the H2H record card', () => {
  for (const n of [1, 3, 9]) assert.match(S.maSmallChip(n), new RegExp(`>Small sample · n=${n}<`), `helper n=${n}`);
  for (const n of [0, 10, 12]) assert.equal(S.maSmallChip(n), '', `helper n=${n}`);
  // 2026-11-23 rebuild: the H2H record box marks n 1–9 with " · small sample" after "n meetings" (no chip in the design;
  // notes.md H2H "Record") — the record box's own statement, executed at each n, and printed beside the meeting count
  const smallSrc = /\n    const small = ([^;\n]*);/.exec(v2.slice(v2.indexOf('\n  function maH2HV2(')));
  assert.ok(smallSrc, 'the H2H record box computes its small-sample mark');
  assert.ok(v2.includes("+ F.length + (F.length === 1 ? ' meeting' : ' meetings') + small + '"), 'the mark is printed beside the meeting count');
  const mark = n => new Function('maGate', 'F', `return ${smallSrc[1]};`)(S.maGate, Array.from({ length: n }, () => ({})));
  for (const n of [1, 3, 9]) assert.equal(mark(n), ' · small sample', `H2H record n=${n}`);
  for (const n of [0, 10]) assert.ok(!mark(n), `H2H record n=${n}`);
  assert.match(S.maSmallChip(3), /font-size:10px; color:var\(--text-soft\); border:1px solid var\(--edge-10\); border-radius:999px; padding:2px 9px;/,
    'DF L1234 geometry, neutral colours (never the amber warn token)');
  assert.ok(!/amber/.test(S.maSmallChip(3)), 'TEN-376: amber is Model + Trading Report only');
});

// Key factors' "Last N" gate check lives in test-ten341-key-factors.mjs (TEN-341 rebuilt the card on the Form tab's rows).

// Mutation: the Won cell back to the bare mePct0(b.won), or the win bar drawn at any n ≥ 1 (`b.w / n * 100`).
test('Market edge band row: Won + win bar through the gate — 0 / 3 dash + neutral track, 7 greyed (hover note), 12 full', () => {
  const band = n => ({ i: 0, gk: 'fav', label: '1.01 – 1.20', n, w: WINS[n], l: n - WINS[n], won: n >= 5 ? WINS[n] / n : null, needs: n ? 0.8 : null, units: n ? 1.2 : 0 });
  const W2 = v2win();
  const row = n => { const h = W2.__meBandsBox({ m: { p1: 'J. Sinner', p2: 'C. Alcaraz' }, S: {} }, 0, { state: 'ready', tb: -1, bands: [band(n)], priced: [] }); return h.slice(h.indexOf('data-me-band="a0"')); };
  const cells = h => [...h.matchAll(/(<span class="ma-rate[^>]*>[^<]*<\/span>)<\/span>/g)].map(x => x[1]);   // Won · Edge · 1% stake
  const won = h => cells(h)[0], edge = h => cells(h)[1], units = h => cells(h)[2];
  const barW = h => /<span style="position:absolute; left:0; top:0; bottom:0; width:([\d.]+)%; background:([^;]*);/.exec(h).slice(1);
  // TEN-380: ONE bar per band (no loss share): the fill = Won through the gate, the grey tick = Needs at any n > 0
  const tick = h => /class="me-tick"/.test(h);
  assert.match(won(row(0)), /data-ma-gate="none"[^>]*>—</); assert.deepEqual(barW(row(0)), ['0.0', 'transparent']);
  assert.ok(!tick(row(0)), 'n = 0: no Needs tick');
  assert.match(won(row(3)), /data-ma-gate="nopct"[^>]*>—</, 'ME_THIN_FLOOR keeps its dash');
  assert.deepEqual(barW(row(3)), ['0.0', 'transparent'], 'no win share drawn under 5');
  assert.ok(tick(row(3)), 'Needs is a property of the prices: its tick shows at any n > 0');
  assert.match(won(row(7)), /data-ma-gate="small" title="small sample · n=7" style="color:var\(--text-label\);">57%</);
  assert.deepEqual(barW(row(7)), ['57.1', 'var(--text-label)']);
  assert.match(won(row(12)), /data-ma-gate="full"[^>]*>75%</);
  assert.deepEqual(barW(row(12)), ['75.0', 'var(--ma2-text)']);   // README §6 white-bar exception, on the 2026-11-23 token
  // the Edge cell is a rate too: dashed under 5, greyed 5–9, signed colour at 10+
  assert.match(edge(row(3)), /data-ma-gate="nopct"[^>]*>—</);
  assert.match(edge(row(7)), /data-ma-gate="small"[^>]*color:var\(--text-label\);">−22\.9pp</);
  assert.match(edge(row(12)), /data-ma-gate="full"[^>]*color:var\(--ma2-red\);">−5\.0pp</);
  // review item 6 (founder 2026-10-04): the stake dashes with Won and Edge under 5, greys at 5–9
  assert.match(units(row(3)), /data-ma-gate="nopct"[^>]*>—</);
  assert.match(units(row(7)), /data-ma-gate="small"[^>]*color:var\(--text-label\);">\+1\.2%</);
});

// D2 (modal-analysis.md: n 5–9 greyed + a "small sample" note) on the 2026-11-23 band box (meBandPopV2): Won / Edge /
// stake greyed at 5–9 with the box's "small sample" note under the tiles; full colours and no note at 12; dashes under 5.
// Mutations: the note dropped; the note at every n; the tiles keep their colour at 5–9.
test('Market edge band box: Won / Edge / stake greyed at 5–9 with the small-sample note; full at 12, no note', () => {
  const W2 = ma2VM(html, v2, { seeds: ['maRateHtml', 'maRate', 'meSg', 'escapeHtml', 'meBookNote', 'fhOdd', 'fhSrcTitle'], stubs: ['document'], params: { document: DOC },
    win: { MarketEdgeCore: { RET_SETTLE_NOTE: 'x', plCents: () => 0 } }, expose: ['meBandPopV2'] });
  const pop = n => W2.__meBandPopV2({ m: { p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: 1, p2Key: 2 }, S: { meBand: 'a0', meScope: 'career' } },
    [{ state: 'ready', tb: -1, bands: [{ i: 0, gk: 'fav', label: '1.01 – 1.20', n, w: WINS[n], l: n - WINS[n], won: WINS[n] / n, needs: 0.8, units: 1.2, yield: 0.1, rows: [] }] }, { state: 'ready', bands: [] }]);
  const tile = (h, l) => { const i = h.indexOf('>' + l + '</span>'); return h.slice(i, h.indexOf('</div>', i)); };
  const tiles = h => h.slice(h.indexOf('>Record</span>'), h.indexOf('>Date</span>'));
  const figC = (h, l) => /color:([^;"]*)[^>]*>[^<]*<\/span>/.exec(tile(h, l).slice(tile(h, l).indexOf('</span>') + 7))[1];   // the figure, after the label
  for (const l of ['Won', 'Edge', 'At flat 1% stake']) {
    assert.equal(figC(pop(7), l), 'var(--ma2-grey)', `${l}: greyed at n 7`);
    assert.notEqual(figC(pop(12), l), 'var(--ma2-grey)', `${l}: full colour at n 12`);
  }
  assert.match(tiles(pop(7)), /small sample[^<]*n=7/, 'n 7: the small-sample note under the tiles');
  assert.ok(!/small sample/.test(tiles(pop(12))), 'n 12: no note');
  assert.ok(!/small sample/.test(tiles(pop(3))) && tile(pop(3), 'Won').includes('—'), 'n 3: no rate, no note');
});

// The Tournament tab's rates (W–L %, sets won, vs market) go through the same gate: test-ten332-tournament.mjs (TEN-332).

// Mutation: the Overview season rate back to `${Math.round(c.won / n * 100)}%` (TEN-334: the season rows of ovColumnHtml).
test('Overview this season by surface: 0 "—", 3 W–L only, 7 greyed (hover note), 12 full', () => {
  const rec = n => (n ? { won: WINS[n], lost: n - WINS[n] } : null);
  const yr = String(new Date().getFullYear());
  // 2026-11-23 rebuild (maOverviewV2): the This season card lists Clay · Hard · Indoors · Grass; n = 0 "—", 1–4 W–L only,
  // 5–9 greyed with the hover note, 10+ the full rate
  const season = (clay, hard, grass) => {
    const r = { year: yr, allTier: true, total: null, clay: rec(clay), hard: rec(hard), grass: rec(grass), atp: null, chitf: null };
    const P = { 7: { key: '7', name: 'A. One', careerByYear: [r] }, 8: { key: '8', name: 'B. Two', careerByYear: [r] } };
    const h = v2win(P).maOverviewV2({ id: 'x', p1: 'A. One', p2: 'B. Two', p1Key: '7', p2Key: '8' });
    const sec = h.slice(h.indexOf('This season'), h.indexOf('Record by season'));
    return sec.split('<div class="seg ma2-row"').slice(1); };
  const rows = season(0, 3, 7);   // clay, hard, indoors, grass
  assert.ok(text('<x' + rows[0]).includes('—') && !NEVER.test(text('<x' + rows[0])), 'n = 0');
  assert.ok(!/%/.test(text('<x' + rows[1])) && text('<x' + rows[1]).includes('2–1'), 'n = 3: W–L only');
  assert.match(rows[3], /title="small sample · n=7"/);
  assert.match(rows[3], /font-weight:700; color:var\(--ma2-grey\); text-align:right;">57\.1%</, 'n = 7: greyed');
  assert.match(season(12, 0, 0)[0], /font-weight:700; color:var\(--ma2-text\); text-align:right;">75\.0%</, 'n = 12: full');
  assert.ok(!/small sample/.test(season(12, 0, 0)[0]));
});

// Playing style (TEN-340): the tab's record, rate, tug and meetings header run through this gate; the checks (n 0 / 3 / 7 / 12)
// live in test-ten340-playing-style.mjs, with the rebuilt tab.
