// TEN-402 r4 (founder post-live fixes on baa9101b, comment 276cbc50), builder N. Each test is a rule someone can apply,
// run against the shipped code sliced out of bsp-consult-dashboard.html (TEN402_HTML overrides it for
// tools/test-ten402-r4n-mutants.js); each carries a control so a pass cannot be vacuous.
//   fix 1  nothing shows above the sticky Head to Head header: the gap above it is page tone at every scroll position.
//   fix 2  set scores in this page's ledgers are never cut: they wrap between sets, the row grows.
//   fix 3  Sets = "pS–oS" (en dash, no spaces) in the Meetings, Playing styles and Tournament ledgers (+ the Match
//          analysis Tournament tab, which shares trRowData); a retirement keeps "—".
//   fix 5  the Entry list empty state names the SELECTED week by its chip's range ("No lists loaded for 2–8 Nov").
//
// Run: node --test test-ten402-r4n.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN402_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');

function sliceFrom(start, label) {
  assert.ok(start >= 0, `${label} not found`);
  let depth = 0, i = html.indexOf('{', start);
  const open = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  assert.ok(i > open, `${label} braces did not balance`);
  return html.slice(start, i + 1);
}
const fnSrc = name => sliceFrom(html.indexOf(`\nfunction ${name}(`) + 1, name);
const text = h => String(h).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
// One CSS rule's declarations, as a map (the rule must exist exactly once).
function rule(sel) {
  const re = new RegExp('\\n\\s*' + sel.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&') + '\\{([^}]*)\\}', 'g');
  const all = [...html.matchAll(re)];
  assert.equal(all.length, 1, `rule ${sel} found ${all.length}×`);
  return Object.fromEntries(all[0][1].split(';').map(d => d.trim()).filter(Boolean).map(d => { const k = d.indexOf(':'); return [d.slice(0, k).trim(), d.slice(k + 1).trim()]; }));
}
const px = v => { const m = /^(-?\d+(?:\.\d+)?)px$/.exec(String(v || '').trim()); return m ? +m[1] : (String(v).trim() === '0' ? 0 : NaN); };
const box = v => { const p = String(v).trim().split(/\s+/).map(px); return { t: p[0], r: p[1] ?? p[0], b: p[2] ?? p[0], l: p[3] ?? p[1] ?? p[0] }; };

// The rebuilt page (design_handoff_head_to_head, founder 2026-11-16), EXECUTED: tools/h2h-test-harness.js runs the shipped
// window.H2HPage module and slices the page helpers it reaches. TEN402_CSS overrides h2h-page.css for the mutants.
const HX = createRequire(import.meta.url)(join(HERE, 'tools/h2h-test-harness.js'));
const H2H = sliceFrom(html.indexOf('(function () {', html.indexOf('HEAD-TO-HEAD PAGE')), 'H2HPage module');
const CSS = readFileSync(process.env.TEN402_CSS || join(HERE, 'h2h-page.css'), 'utf8');
const A = { key: '1', short: 'J. Sinner', full: 'J. Sinner', mono: 'JS', ctry: 'Italy', rankTxt: '#2', eloTxt: '—' }, B = { key: '2', short: 'C. Alcaraz', full: 'C. Alcaraz', mono: 'CA', ctry: 'Spain', rankTxt: '#1', eloTxt: '—' };
const decl = st => Object.fromEntries(st.split(';').map(d => d.trim()).filter(Boolean).map(d => { const k = d.indexOf(':'); return [d.slice(0, k).trim(), d.slice(k + 1).trim()]; }));

// ── fix 1 · nothing shows above the sticky header ──────────────────────────────────────────────────────────────────
// Apply: scroll anywhere; every pixel between the viewport top and the picker card is page tone. The rebuild (DF L45)
// sticks the picker's wrapper at top 0 and paints its own top padding (and 78% of its height) in the page tone, so a
// section scrolling under it never shows above the card.
test('r4 fix 1: the sticky picker sits at the viewport top on a page-tone band (its own padding), the card inside it, over the sections', () => {
  const h = HX.load({ html });
  const bar = h.call(h.selectorBar, { aPicked: true, bPicked: true, a: A, b: B, hAChange: 1, hBChange: 2, hSwap: 3, ctxShow: false });
  const wrap = decl(/^<div class="x-stick" style="([^"]+)">/.exec(bar)[1]);
  assert.equal(wrap.position, 'sticky', 'the header sticks');
  assert.equal(wrap.top, '0', 'at the viewport top: no gap above it for a card to show through');
  assert.ok(+wrap['z-index'] >= 30, 'over the sections (they carry no z-index)');
  const pad = box(wrap.padding);
  assert.ok(pad.t > 0, 'a band above the card');
  assert.match(wrap.background, /^linear-gradient\(var\(--h2h-page\) 78%, /, 'the band is the page tone (opaque over its top 78%)');
  assert.ok(pad.t / (pad.t + 60 + pad.b) < 0.78, 'the top padding lies inside the opaque 78% for any card ≥ 60px tall');
  assert.match(bar, /<div id="h2h-sticky" style="background:var\(--h2h-card\);/, 'the card inside the band');
  // the stylesheet carries the same band (the inline style and the class agree)
  assert.match(CSS, /#h2hRoot \.x-stick \{ position: sticky; top: 0; z-index: 30; padding: 10px 40px 14px;\s*background: linear-gradient\(var\(--h2h-page\) 78%, color-mix\(in srgb, var\(--h2h-page\) 0%, transparent\)\); \}/);
  assert.match(CSS, /\.tabpage\[data-page="h2h"\] \{ background: var\(--h2h-page\); \}/, 'the page behind it is the same tone');
});

// ── fix 2 · set scores never cut ────────────────────────────────────────────────────────────────────────────────────
// Apply: open the meetings box, a career-match ledger, a Tournament ledger, a hot line's meetings: a five-set score reads
// whole, wrapped between sets; no ellipsis, no clipping on any score cell.
const FIVE = [[6, 7], [7, 6], [6, 4], [3, 6], [7, 6]];
test('r4 fix 2: every score cell on the page wraps (white-space normal) and is never cut — meetings box, career-match ledger, Tournament ledger', () => {
  const h = HX.load({ html, globals: { loadSetStatsIndex: () => Promise.resolve(new Set()), _careerHistoryShards: {}, _sfDbJoinSt: 'loading', _sfDbJoinP: new Promise(() => {}) } });
  const r = { mid: 'm1', date: '2025-09-07', won: true, tourn: 'US Open', surface: 'Hard', round: 'F', sets: FIVE, pS: 3, oS: 2, price: null, oppPrice: null, opp: 'C. Alcaraz', wo: false, ret: false };
  h.state.h2hBox = true;
  const cells = [];
  const box = h.call(h.h2hBoxHTML, { a: A, b: B, h2h: { F: [r], all: [r], surf: 'all', aS: 'Sinner', bS: 'Alcaraz', aName: 'J. Sinner', bName: 'C. Alcaraz' } });
  cells.push(...[...box.matchAll(/<span style="([^"]*)">(6-7, 7-6, 6-4, 3-6, 7-6)<\/span>/g)].map(m => ['box', m[1]]));
  const sv = { a: A, b: B, styles: { sides: [{ p: A, R: { state: 'ready', oppLab: 'X', avg: 50, rows: [{ won: true, opponent: 'Carlos Alcaraz', surface: 'hard', tournament: 'US Open', result: '6-7 7-6 6-4 3-6 7-6', date: '2025-08-24', round: 'F' }] } }, { p: B, R: { state: 'ready', oppLab: 'X', avg: 50, rows: [] } }], arch: ['x', 'y'] } };
  const st = h.call(h.stylesCard, sv);
  cells.push(...[...st.matchAll(/<span title="[^"]*" style="([^"]*)">(6-7, 7-6, 6-4, 3-6, 7-6)<\/span>/g)].map(m => ['styles', m[1]]));
  const agg = h.call(h.xTrAgg, [{ ev: { name: 'US Open', surface: 'Hard', speed: null }, P: { eds: [{ year: '2025', rows: [r] }] } }], null, false);
  const tc = h.call(h.tourneyCard, { a: A, b: B, tourney: { empty: false, query: '', listOpen: false, options: [], info: { name: 'US Open', initial: 'U', meta: [] }, grp: false, gLbl: 'courts', TW: 'career', filters: [],
    cols: [{ p: A, agg, state: 'ready' }, { p: B, agg: null, state: 'none' }] } });
  cells.push(...[...tc.matchAll(/<span title="[^"]*" style="([^"]*)">([^<]*6-7[^<]*)<\/span>/g)].map(m => ['tournament', m[1]]));
  assert.deepEqual(cells.map(c => c[0]), ['box', 'styles', 'tournament'], 'one score cell from each ledger');
  for (const [w, st2] of cells) {
    const d = decl(st2);
    assert.equal(d['white-space'], 'normal', w + ': the cell wraps');
    assert.ok(!d['text-overflow'] && !d.overflow, w + ': no ellipsis, nothing clipped');
  }
  // (each cell above matched the WHOLE five-set score — nothing dropped, no ellipsis character)
  // the page's stylesheet never cuts a score either (no score rule at all)
  assert.ok(!/score[^{]*\{[^}]*(text-overflow:\s*ellipsis|overflow:\s*hidden)/.test(CSS));
});

// ── fix 3 · Sets "pS–oS" ────────────────────────────────────────────────────────────────────────────────────────────
// Apply: every Sets cell on Head to Head (meetings box, career-match ledger, Tournament ledger) and in Match analysis →
// Tournament reads "0–2" (U+2013, no spaces); a retirement reads "—"; a walkover "—".
test('r4 fix 3: the meetings box — Sets "pS–oS", a retirement "—"', () => {
  const h = HX.load({ html, globals: { loadSetStatsIndex: () => Promise.resolve(new Set()) } });
  const mk = (pS, oS, o) => Object.assign({ mid: 'm' + pS + oS, date: '2025-0' + (pS + 1) + '-0' + (oS + 1), won: pS > oS, tourn: 'Basel', surface: 'Hard', round: 'F', sets: [[6, 4]], pS, oS, price: null, oppPrice: null }, o || {});
  const F = [mk(0, 2), mk(3, 1), mk(1, 0, { ret: true }), mk(null, null)];
  h.state.h2hBox = true;
  const box = h.call(h.h2hBoxHTML, { a: A, b: B, h2h: { F, all: F, surf: 'all', aS: 'Sinner', bS: 'Alcaraz', aName: 'J. Sinner', bName: 'C. Alcaraz' } });
  const sets = [...box.matchAll(/<span style="font-family:'IBM Plex Mono',monospace; font-size:11\.5px; font-weight:700; color:[^;]+;">([^<]*)<\/span>/g)].map(m => m[1]);
  assert.deepEqual(sets.sort(), ['0–2', '3–1', '—', '—'].sort());
  assert.ok(!sets.some(x => / |-/.test(x)), 'no space, no hyphen');
});
test('r4 fix 3: the career-match ledger — "pS–oS" from the real ps2Meeting, a retirement "—"', () => {
  const ps2 = new Function([fnSrc('ps2SetDone'), "const FH_DASHC = '—';", fnSrc('ps2Meeting'), 'return ps2Meeting;'].join('\n'))();
  const h = HX.load({ html, globals: { _careerHistoryShards: {}, _sfDbJoinSt: 'loading', _sfDbJoinP: new Promise(() => {}) } });
  const rows = ['2-6 6-3 1-6 4-6', '7-6(4) 7-5', '6-4 3-1 RET'].map((result, i) => ({ won: i !== 0, opponent: 'Carlos Alcaraz', surface: 'hard', tournament: 'Basel', result, date: '2025-0' + (i + 1) + '-10', round: 'F' }));
  const card = h.call(h.stylesCard, { a: A, b: B, styles: { sides: [{ p: A, R: { state: 'ready', oppLab: 'X', avg: 50, rows } }, { p: B, R: { state: 'ready', oppLab: 'X', avg: 50, rows: [] } }], arch: ['x', 'y'] } });
  const sets = [...card.matchAll(/justify-self:center; font-family:'IBM Plex Mono',monospace; font-size:11\.5px; font-weight:700; color:[^;]+; background:[^;]+; border-radius:999px; padding:2px 9px; white-space:nowrap;">([^<]*)</g)].map(m => m[1]);
  assert.deepEqual(sets, ['—', '2–0', '1–3'], 'newest first: the retirement (a set already won) "—", then "2–0", "1–3"');
  // control: ps2Meeting itself still says "1 - 3" for its other hosts (Match analysis → Playing style) — the en dash is
  // this ledger's, so the test above is not passing on an unchanged helper.
  assert.equal(ps2({ result: '2-6 6-3 1-6 4-6' }).sets, '1 - 3');
});
test('r4 fix 3: the shared Tournament row (H2H Tournament ledger + Match analysis Tournament tab) — "pS–oS"', () => {
  const tr = new Function([
    "const FH_DASHC = '—', FH_DASH = 'var(--text-label)';",
    'function fhDDMM(d){ return String(d).slice(8, 10) + "." + String(d).slice(5, 7); }',
    'function fhH2hSetScores(r){ return "6-3, 6-4"; } function fhOdd(x){ return x.toFixed(2); } function trPxTitle(){ return ""; } function fhPxMark(){ return ""; }',
    'function fhEsc(s){ return String(s == null ? "" : s); } const _fh = null;',
    fnSrc('trRowData'), 'return trRowData;'].join('\n'))();
  assert.equal(tr({ date: '2025-09-07', won: true, opp: 'J. Sinner', round: 'F', pS: 3, oS: 1, sets: [[6, 2]] }).sets, '3–1');
  assert.equal(tr({ date: '2025-09-07', won: false, opp: 'X', round: 'R32', pS: 0, oS: 2, sets: [[3, 6]] }).sets, '0–2');
  assert.equal(tr({ date: '2025-09-07', wo: true, opp: 'X', round: 'R32', pS: 0, oS: 0 }).sets, '—', 'a walkover has no sets');
  // the H2H Tournament ledger prints trRowData's Sets (executed)
  const h = HX.load({ html });
  const r = { mid: 'm', date: '2025-09-07', won: true, opp: 'C. Alcaraz', round: 'F', pS: 3, oS: 1, sets: [[6, 2], [3, 6], [6, 3], [6, 4]], price: null, oppPrice: null, wo: false, ret: false };
  const agg = h.call(h.xTrAgg, [{ ev: { name: 'US Open', surface: 'Hard', speed: null }, P: { eds: [{ year: '2025', rows: [r] }] } }], null, false);
  const tc = h.call(h.tourneyCard, { a: A, b: B, tourney: { empty: false, query: '', listOpen: false, options: [], info: { name: 'US Open', initial: 'U', meta: [] }, grp: false, gLbl: 'courts', TW: 'career', filters: [],
    cols: [{ p: A, agg, state: 'ready' }, { p: B, agg: null, state: 'none' }] } });
  assert.match(tc, /padding:2px 9px; white-space:nowrap;">3–1<\/span>/);
});
test('r4 fix 3: no Sets value on Head to Head (or in trRowData) is built with " - "', () => {
  const builders = [H2H.slice(H2H.indexOf('==== H2H REBUILD')), fnSrc('trRowData')].join('\n');
  const hy = [...builders.matchAll(/\bsets = [^\n]*?' - '|\bsets: [^\n]*?' - '/g)].map(m => m[0].slice(0, 80));
  assert.deepEqual(hy, [], 'a hyphen sets builder is left');
  // control: the sweep can see one — the Match analysis H2H tab (outside this fix) still builds " - "
  assert.ok(/\bsets: [^\n]*?' - '/.test(fnSrc('fhH2hRowData')), 'control: the sweep regex finds a hyphen builder');
});

// ── fix 5 (Entry list "No lists loaded for {week range}") RETIRED 2026-11-15: the Tournaments tab rebuild draws the export's
// empty state ("No lists loaded for this week" + "…events in {week label}…", founder ruling 1) — tools/test-tt-entry.mjs.
