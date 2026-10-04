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
import { overviewVM } from './tools/ten334-overview-vm.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN314_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
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
  ${['FH_MONO', 'FH_DASHC', 'FH_AC', 'ME_C', 'ME_BCOLS', 'ME_COLH', 'ME_NOPRICE_MSG', 'mePct0', 'mePct1', 'meUC', 'meNoHist', 'meLoadingRow', 'meStatBox',
     'ANALYSIS_P1_COLOR', 'ANALYSIS_P2_COLOR', 'ANALYSIS_P2_FILL', 'ANALYSIS_P1_RGBA', 'ANALYSIS_P2_RGBA', ...GATE_CONSTS, 'meRateBox'].map(constSrc).join('\n')}
  const FH_H2H_RET_COUNTS = true;
  ${[...GATE, 'escapeHtml', 'fhEsc', 'fhHexA', 'meSg', 'psEsc', 'psShortName',
     'fhRecLevelMix', 'fhH2hRecCard', 'meBarHtml', 'meLeadFill', 'meBandsCol'].map(slice).join('\n')}
  let psMatrixData = null; const PS_ARCHETYPES = []; function styleKey(n){ return n; } function psCellFor(){ return null; } function psArchIndex(){ return 0; }
  return { maGate, maRate, maRateHtml, maGateBar, maSmallChip, fhH2hRecCard, meBandsCol,
    meRateBox, set psMatrix(v){ psMatrixData = v; } };
`)();
const OV = overviewVM(html);
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
  const card = n => S.fhH2hRecCard('Overall', Array.from({ length: n }, (_, i) => ({ won: i % 3 !== 0, level: 'ATP' })), null, 'A. One', 'B. Two', 'One', 'Two');
  for (const n of [1, 3, 9]) assert.ok(card(n).includes(`Small sample · n=${n}`), `H2H card n=${n}`);
  for (const n of [0, 10]) assert.ok(!card(n).includes('Small sample'), `H2H card n=${n}`);
  assert.match(S.maSmallChip(3), /font-size:10px; color:var\(--text-soft\); border:1px solid var\(--edge-10\); border-radius:999px; padding:2px 9px;/,
    'DF L1234 geometry, neutral colours (never the amber warn token)');
  assert.ok(!/amber/.test(S.maSmallChip(3)), 'TEN-376: amber is Model + Trading Report only');
});

// Key factors' "Last N" gate check lives in test-ten341-key-factors.mjs (TEN-341 rebuilt the card on the Form tab's rows).

// Mutation: the Won cell back to the bare mePct0(b.won), or the win bar drawn at any n ≥ 1 (`b.w / n * 100`).
test('Market edge band row: Won + win bar through the gate — 0 / 3 dash + neutral track, 7 greyed (hover note), 12 full', () => {
  const band = n => ({ i: 0, gk: 'fav', label: '1.01 – 1.20', n, w: WINS[n], l: n - WINS[n], won: n >= 5 ? WINS[n] / n : null, needs: n ? 0.8 : null, units: n ? 1.2 : 0 });
  const row = n => S.meBandsCol({ m: { p1: 'J. Sinner', p2: 'C. Alcaraz' }, S: {} }, 0, { state: 'ready', tb: -1, bands: [band(n)] });
  const won = h => { const m = /text-align:right;">(<span class="ma-rate[^>]*>[^<]*<\/span>)<\/span>/.exec(h); return m && m[1]; };
  const barW = h => /<span style="width:([\d.]+)%; background:([^;]*);/.exec(h).slice(1);
  // TEN-380: ONE bar per band (no loss share): the white fill = Won through the gate, the grey tick = Needs at any n > 0
  const tick = h => /class="me-tick"/.test(h);
  assert.match(won(row(0)), /data-ma-gate="none"[^>]*>—</); assert.deepEqual(barW(row(0)), ['0.0', 'transparent']);
  assert.ok(!tick(row(0)), 'n = 0: no Needs tick');
  assert.match(won(row(3)), /data-ma-gate="nopct"[^>]*>—</, 'ME_THIN_FLOOR keeps its dash');
  assert.deepEqual(barW(row(3)), ['0.0', 'transparent'], 'no win share drawn under 5');
  assert.ok(tick(row(3)), 'Needs is a property of the prices: its tick shows at any n > 0');
  assert.ok(!/border-radius:0 3px 3px 0;/.test(row(12)), 'no loss share: one track');
  assert.match(won(row(7)), /data-ma-gate="small" title="small sample · n=7" style="color:var\(--text-label\);">57%</);
  assert.deepEqual(barW(row(7)), ['57.1', 'var(--text-label)']);
  assert.match(won(row(12)), /data-ma-gate="full"[^>]*>75%</);
  assert.deepEqual(barW(row(12)), ['75.0', 'var(--white-bar)']);   // README §4 / TEN-380: the white bar (ME_C.wbar)
  // the Edge cell is a rate too: dashed under 5, greyed 5–9, signed colour at 10+
  const edge = h => { const m = /class="me-edge"[^>]*>(<span class="ma-rate[^>]*>[^<]*<\/span>)/.exec(h); return m && m[1]; };
  assert.match(edge(row(3)), /data-ma-gate="nopct"[^>]*>—</);
  assert.match(edge(row(7)), /data-ma-gate="small"[^>]*color:var\(--text-label\);">−22\.9pp</);
  assert.match(edge(row(12)), /data-ma-gate="full"[^>]*color:var\(--neg\);">−5\.0pp</);
  // the band pop-up's Won / Yield boxes: greyed + a visible note at 5–9
  const box = S.meRateBox('Won', 4, 7, '57.1%', 'var(--text)', true);
  assert.ok(/color:var\(--text-label\); white-space:nowrap;">57\.1%<\/span><span class="ma-small-note"/.test(box));
  assert.ok(!S.meRateBox('Won', 9, 12, '75.0%', 'var(--text)', true).includes('small sample'));
  assert.ok(/color:var\(--text\); white-space:nowrap;">75\.0%</.test(S.meRateBox('Won', 9, 12, '75.0%', 'var(--text)', true)), 'full: the caller\'s colour');
});

// The Tournament tab's rates (W–L %, sets won, vs market) go through the same gate: test-ten332-tournament.mjs (TEN-332).

// Mutation: the Overview season rate back to `${Math.round(c.won / n * 100)}%` (TEN-334: the season rows of ovColumnHtml).
test('Overview this season by surface: 0 "—", 3 W–L only, 7 greyed (hover note), 12 full', () => {
  const rec = n => (n ? { won: WINS[n], lost: n - WINS[n] } : null);
  const yr = String(new Date().getFullYear());
  const season = (clay, hard, grass) => { const r = { year: yr, allTier: true, total: null, clay: rec(clay), hard: rec(hard), grass: rec(grass), atp: null, chitf: null };
    const h = OV.ovColumnHtml(0, 'A. One', 7, [r], [r], 'all'); return h.split('data-ov-cell="0|season|').slice(1).map(x => x.slice(0, x.indexOf('</div></div>'))); };
  const rows = season(0, 3, 7);
  assert.ok(text('<' + rows[0]).includes('—') && !NEVER.test(text('<' + rows[0])), 'n = 0');
  assert.ok(!/%/.test(text('<' + rows[1])) && text('<' + rows[1]).includes('2-1'), 'n = 3: W–L only');
  assert.match(rows[2], /class="ma-rate" data-ma-gate="small" title="small sample · n=7"[^>]*>57%/);
  assert.match(season(12, 0, 0)[0], /class="ma-rate" data-ma-gate="full"[^>]*>75%/);
});

// Playing style (TEN-340): the tab's record, rate, tug and meetings header run through this gate; the checks (n 0 / 3 / 7 / 12)
// live in test-ten340-playing-style.mjs, with the rebuilt tab.
