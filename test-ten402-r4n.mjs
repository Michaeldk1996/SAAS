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

// ── fix 1 · the strip above the sticky header ───────────────────────────────────────────────────────────────────────
// Apply: scroll the page anywhere; every pixel between the viewport top and the header card is page tone. The window
// scrolls; the header sticks `top` px down; the page's own top padding is that gap. A page-wide band in that padding
// sticks at 0, exactly as tall as the gap, in --page, under the header (its shadow paints over the band).
test('r4 fix 1: a sticky page-tone band fills the whole gap above the sticky header, under it', () => {
  const page = rule('#h2hRoot .h2h-page'), stick = rule('#h2hRoot .h2h-stick'), band = rule('#h2hRoot .h2h-page::before');
  const pad = box(page.padding), gap = px(stick.top);
  assert.equal(stick.position, 'sticky', 'the header sticks');
  assert.ok(gap > 0, 'the header sticks below the top — there IS a gap to fill');
  assert.equal(band.position, 'sticky', 'the band sticks (it must stay at the top at every scroll position)');
  assert.equal(band.content, "''");
  assert.equal(band.display, 'block');
  assert.equal(px(band.top), 0, 'the band sticks at the viewport top');
  assert.ok(px(band.height) >= gap, `the band (${band.height}) covers the whole gap above the header (${gap}px)`);
  assert.equal(px(band.height), pad.t, 'the band lives in the page\'s own top padding (no layout shift)');
  const m = box(band.margin);
  assert.equal(m.t, -pad.t, 'pulled up into the top padding');
  assert.equal(m.b, 0, 'the content below starts where it did');
  assert.ok(m.l <= -pad.l && m.r <= -pad.r, 'page-wide: the band spans the side padding too');
  assert.equal(band.background, 'var(--page)', 'page tone (the html background behind the page)');
  assert.ok(+band['z-index'] < +stick['z-index'], 'under the header: the card and its shadow paint over the band');
  // control: the header card's own rules are untouched by the fix (TEN-403 replaces that card)
  assert.ok(!/background/.test(rule('#h2hRoot .h2h-stick').background || ''), 'the stick wrapper stays transparent');
});

// ── fix 2 · set scores never cut ────────────────────────────────────────────────────────────────────────────────────
// Apply: on Head to Head open a Tournament / Playing styles ledger with a five-set row ("6-7(7), 7-6(2), 6-4, …"): the
// whole score reads, wrapped between sets onto a second line; no ellipsis anywhere on a score.
const rowsHtml = (() => {
  const src = [fnSrc('escapeHtml'), "const MA_ROW_COLS = '1fr', MA_ROW_GAP = '0';", fnSrc('maMatchRowsHtml'), 'return maMatchRowsHtml;'].join('\n');
  return new Function(src)();
})();
test('r4 fix 2: the page rule lets the score cell wrap; the shared row gives it a break point between every set', () => {
  const r = rule('#h2hRoot .h2hc-led .ma-row-score');
  assert.equal(r['white-space'], 'normal', 'the cell wraps');
  assert.ok(!r['text-overflow'] || r['text-overflow'] === 'clip', 'no ellipsis');
  assert.ok(!r.overflow || r.overflow === 'visible', 'nothing clipped');
  // no other rule on the site cuts a score cell
  assert.ok(!/ma-row-score[^{]*\{[^}]*(text-overflow:\s*ellipsis|white-space:\s*nowrap|overflow:\s*hidden)/.test(html), 'a score cell is cut somewhere');
  const score = '6-7(7), 7-6(2), 6-4, 3-6, 7-6(10-8)';
  const h = rowsHtml([{ title: null, rows: [{ date: '01.07.', won: true, opp: 'X', rd: 'F', sets: '3–2', scores: score, scoresTitle: score, h: '1.50', a: '2.60' }] }], {});
  const cell = /<span class="ma-row-score"[^>]*>([\s\S]*?<\/span>)<\/span>/.exec(h);
  assert.ok(cell, 'score cell rendered');
  const parts = [...cell[1].matchAll(/<span style="white-space:nowrap;">([^<]*)<\/span>/g)].map(m => m[1]);
  assert.deepEqual(parts, ['6-7(7),', '7-6(2),', '6-4,', '3-6,', '7-6(10-8)'], 'each set its own unbreakable piece');
  assert.equal(text(cell[1]), score, 'the full score, joined by spaces (the break points)');
  assert.ok(!/…/.test(h), 'no ellipsis character');
});

// ── fix 3 · Sets "pS–oS" ────────────────────────────────────────────────────────────────────────────────────────────
// Apply: every Sets cell on Head to Head (Meetings, Playing styles, Tournament) and in Match analysis → Tournament reads
// "0–2" (U+2013, no spaces, never wrapped); a retirement reads "—" in Meetings / Playing styles; a walkover "—".
const H0 = html.indexOf('HEAD-TO-HEAD PAGE');
const H2H = sliceFrom(html.indexOf('(function () {', H0), 'H2HPage module');
const exprAfter = (src, lead, stop) => {
  const a = src.indexOf(lead); assert.ok(a >= 0, lead); assert.equal(src.indexOf(lead, a + 1), -1, `${lead} occurs once`);
  const b = src.indexOf(stop, a); assert.ok(b > a, stop);
  return src.slice(a + lead.length, b);
};
test('r4 fix 3: the Meetings ledger row — "pS–oS", a retirement "—"', () => {
  const lead = '            sets: r.pS == null || r.ret ? ';
  const sets = new Function('r', 'return r.pS == null || r.ret ? ' + exprAfter(H2H, lead, ', setsColor:') + ';');
  assert.equal(sets({ pS: 0, oS: 2 }), '0–2');
  assert.equal(sets({ pS: 3, oS: 1 }), '3–1');
  assert.equal(sets({ pS: 1, oS: 0, ret: true }), '—', 'a retirement keeps the dash');
  assert.equal(sets({ pS: null, oS: null }), '—');
  assert.ok(!/ |-/.test(sets({ pS: 2, oS: 1 })), 'no space, no hyphen');
});
test('r4 fix 3: the Playing styles ledger row — "pS–oS" from the real ps2Meeting, a retirement "—"', () => {
  const ps2 = new Function([fnSrc('ps2SetDone'), "const FH_DASHC = '—';", fnSrc('ps2Meeting'), 'return ps2Meeting;'].join('\n'))();
  const block = sliceFrom(html.indexOf('\n  function cStyleLedger(', H0) + 1, 'cStyleLedger');
  const sets = new Function('m', 'return m.ret ? ' + exprAfter(block, "          sets: m.ret ? ", ', scores:') + ';');
  assert.equal(sets(ps2({ result: '2-6 6-3 1-6 4-6' })), '1–3');
  assert.equal(sets(ps2({ result: '7-6(4) 7-5' })), '2–0');
  assert.equal(sets(ps2({ result: '0-5 RET' })), '—', 'a retirement keeps the dash');
  // control: ps2Meeting itself still says "1 - 3" for its other hosts (Match analysis → Playing style) — the en dash is
  // this ledger's, so the test above is not passing on an unchanged helper.
  assert.equal(ps2({ result: '2-6 6-3 1-6 4-6' }).sets, '1 - 3');
});
test('r4 fix 3: the shared Tournament row (H2H Tournament ledger + Match analysis Tournament tab) — "pS–oS"', () => {
  const tr = new Function([
    "const FH_DASHC = '—', FH_DASH = 'var(--text-label)';",
    'function fhDDMM(d){ return String(d).slice(8, 10) + "." + String(d).slice(5, 7); }',
    'function fhH2hSetScores(r){ return "6-3, 6-4"; } function fhOdd(x){ return x.toFixed(2); } function trPxTitle(){ return ""; }',
    'function fhEsc(s){ return String(s == null ? "" : s); } const _fh = null;',
    fnSrc('trRowData'), 'return trRowData;'].join('\n'))();
  assert.equal(tr({ date: '2025-09-07', won: true, opp: 'J. Sinner', round: 'F', pS: 3, oS: 1, sets: [[6, 2]] }).sets, '3–1');
  assert.equal(tr({ date: '2025-09-07', won: false, opp: 'X', round: 'R32', pS: 0, oS: 2, sets: [[3, 6]] }).sets, '0–2');
  assert.equal(tr({ date: '2025-09-07', wo: true, opp: 'X', round: 'R32', pS: 0, oS: 0 }).sets, '—', 'a walkover has no sets');
});
test('r4 fix 3: no Sets value on Head to Head (or in trRowData) is built with " - "', () => {
  const builders = [H2H, fnSrc('trRowData')].join('\n');
  const hy = [...builders.matchAll(/\bsets: [^\n]*?' - '/g)].map(m => m[0].slice(0, 80));
  assert.deepEqual(hy, [], 'a hyphen sets builder is left');
  // control: the sweep can see one — the Match analysis H2H tab (outside this fix) still builds " - "
  assert.ok(/\bsets: [^\n]*?' - '/.test(fnSrc('fhH2hRowData')), 'control: the sweep regex finds a hyphen builder');
});

// ── fix 5 · Entry list empty state names the selected week ──────────────────────────────────────────────────────────
// Apply: Tournaments → Entry list, pick a week with no list loaded (2–8 Nov): the title reads "No lists loaded for 2–8 Nov"
// — the same range as that week's chip (U+2013 in Plex). The current week reads its range too.
const EL0 = html.indexOf('window.EntryListsTab = (function(){');
const elFn = name => sliceFrom(html.indexOf(`\n  function ${name}(`, EL0) + 1, name);
const MONL = (() => { const a = html.indexOf('\n  var MON = [', EL0) + 1; assert.ok(a > 0, 'MON'); return html.slice(a, html.indexOf('\n', a)); })();
test('r4 fix 5: "No lists loaded for {selected week}" — the chip\'s own range, never "this week"', () => {
  const lab = new Function('sel', [MONL, elFn('keyToDate'), elFn('weekRangeLabel'), 'return weekRangeLabel(sel);'].join('\n'));
  for (const [wk, want] of [['2026-11-02', 'No lists loaded for 2–8 Nov'], ['2026-10-26', 'No lists loaded for 26 Oct – 1 Nov'], ['2026-10-05', 'No lists loaded for 5–11 Oct']]) {
    const body = { innerHTML: '' };
    const src = [MONL, elFn('keyToDate'), elFn('weekRangeLabel'), elFn('weekRangeHtml'),
      'var weeks = [], weekPicked = true, activeWeek = sel, data = { tournaments: [] };', elFn('render'), 'render(); return host.innerHTML;'].join('\n');
    const out = new Function('sel', 'host', 'document', 'deriveWeeks', 'pickDefaultWeek', 'renderWeekTabs', 'renderHead', 'staleBannerHtml', 'hasList',
      'weekEventCount', 'renderFreshness', src)(wk, body, { getElementById: () => body }, () => ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'],
      () => '2026-10-05', () => {}, () => {}, () => '', () => false, () => 21, () => {});
    const t = /<div class="el-empty__t">([\s\S]*?)<\/div>/.exec(out);
    assert.ok(t, `${wk}: the empty state rendered`);
    assert.equal(text(t[1]), want, `${wk}`);
    assert.ok(text(t[1]).endsWith(lab(wk)), `${wk}: the title's range = the chip's range`);
    assert.match(t[1], /<span class="el-ndash">–<\/span>/, `${wk}: the dash is set in Plex like the chips`);
    assert.ok(!/this week/i.test(t[1]));
    // control: the body sentence still names the same week, so the title and the sentence agree
    assert.ok(text(out).includes('in the week of ' + lab(wk)), `${wk}: body names the week`);
  }
});
