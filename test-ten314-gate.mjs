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
     'ANALYSIS_P1_COLOR', 'ANALYSIS_P2_COLOR', 'ANALYSIS_P2_FILL', 'ANALYSIS_P1_RGBA', 'ANALYSIS_P2_RGBA', '_psvSides', ...GATE_CONSTS, 'meRateBox'].map(constSrc).join('\n')}
  const FH_H2H_RET_COUNTS = true;
  ${[...GATE, 'escapeHtml', 'fhEsc', 'fhHexA', 'meSg', 'psEsc', 'psShortName', 'akSurname', 'akHead', 'akCard', 'akSeasonOf', 'akFormBlock',
     'fhRecLevelMix', 'fhH2hRecCard', 'meBandsCol', 'atournPlayerColumn', 'seasonSurfaceTierViewHtml', 'styleNoteHtml', 'styleVsArchetypeCard',
     'stylePersonalCard'].map(slice).join('\n')}
  function psvShowText(){ return ''; } function psvListHtml(){ return ''; } function atournYearRowHtml(){ return ''; }
  let psMatrixData = null; const PS_ARCHETYPES = []; function styleKey(n){ return n; } function psCellFor(){ return null; } function psArchIndex(){ return 0; }
  return { maGate, maRate, maRateHtml, maGateBar, maSmallChip, akFormBlock, fhH2hRecCard, meBandsCol, atournPlayerColumn,
    seasonSurfaceTierViewHtml, styleVsArchetypeCard, stylePersonalCard, meRateBox, set psMatrix(v){ psMatrixData = v; } };
`)();
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
test('maRateHtml: "—" · nothing · greyed var(--ma-t3) + "small sample" · full', () => {
  const H = NS.map(n => S.maRateHtml(WINS[n], n, { color: 'var(--text)' }));
  assert.match(H[0], /data-ma-gate="none"[^>]*>—</); assert.ok(!NEVER.test(text(H[0])), 'n = 0 is never a zero rate');
  assert.equal(H[1], '', 'n = 3: no rate at all');
  assert.match(H[2], /data-ma-gate="small" style="color:var\(--ma-t3, var\(--label\)\);">57%<\/span>/);
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
  const card = n => S.fhH2hRecCard('Overall', Array.from({ length: n }, (_, i) => ({ won: i % 3 !== 0, level: 'ATP' })), '', null, null, 'A. One', 'B. Two', 'One', 'Two');
  for (const n of [1, 3, 9]) assert.ok(card(n).includes(`Small sample · n=${n}`), `H2H card n=${n}`);
  for (const n of [0, 10]) assert.ok(!card(n).includes('Small sample'), `H2H card n=${n}`);
  assert.match(S.maSmallChip(3), /font-size:10px; color:var\(--ma-t2, var\(--text-soft\)\); border:1px solid var\(--ma-hair-strong, var\(--line-open\)\); border-radius:999px; padding:2px 9px;/,
    'DF L1234 geometry, neutral colours (never the amber warn token)');
});

// Mutation: akFormBlock's "Last N" back to the bare `Math.round(w10 / last10.length * 100)%`.
test('Key factors · Recent form "Last N": 3 → W–L, 7 → greyed + note, 12 → full', () => {
  const rows = n => Array.from({ length: n }, (_, i) => ({ won: i < WINS[n], surface: 'hard', date: '2026-08-' + String(28 - i).padStart(2, '0') }));
  const last = n => { const h = S.akFormBlock({ _formLoaded: true, p1: 'J. Sinner', p2: 'C. Alcaraz', surface: 'hard', date: '2026-09-01',
    p1RecentFormMatches: rows(n), p2RecentFormMatches: rows(12) }); const i = h.lastIndexOf('<', h.indexOf('akf-stat top')); return h.slice(i, h.indexOf('</div>', i)); };
  assert.match(last(3), /Last 3<\/span><b><span class="ma-rate" data-ma-gate="nopct"[^>]*>2–1<\/span><\/b>/, 'n = 3: the W–L, no %');
  assert.ok(!/%/.test(text(last(3))));
  assert.match(last(7), /Last 7<\/span><b><span class="ma-rate" data-ma-gate="small"[^>]*>57%<\/span><span class="ma-small-note"/);
  assert.match(last(12), /Last 10<\/span><b><span class="ma-rate" data-ma-gate="full"[^>]*>90%<\/span><\/b>/, 'n = 12 → the last 10, full');
  const none = S.akFormBlock({ _formLoaded: true, p1: 'A', p2: 'B', surface: 'hard', p1RecentFormMatches: [], p2RecentFormMatches: [] });
  assert.ok(!NEVER.test(text(none)), 'n = 0: no zero rate');
});

// Mutation: the Won cell back to the bare mePct0(b.won), or the win bar drawn at any n ≥ 1 (`b.w / n * 100`).
test('Market edge band row: Won + win bar through the gate — 0 / 3 dash + neutral track, 7 greyed (hover note), 12 full', () => {
  const band = n => ({ i: 0, gk: 'fav', label: '1.01 – 1.20', n, w: WINS[n], l: n - WINS[n], won: n >= 5 ? WINS[n] / n : null, needs: n ? 0.8 : null, units: n ? 1.2 : 0 });
  const row = n => S.meBandsCol({ m: { p1: 'J. Sinner', p2: 'C. Alcaraz' } }, 0, { state: 'ready', tb: -1, bands: [band(n)] });
  const won = h => { const m = /text-align:right;">(<span class="ma-rate[^>]*>[^<]*<\/span>)<\/span>/.exec(h); return m && m[1]; };
  const barW = h => /<span style="width:([\d.]+)%; background:([^;]*);/.exec(h).slice(1);
  assert.match(won(row(0)), /data-ma-gate="none"[^>]*>—</); assert.deepEqual(barW(row(0)), ['0.0', 'transparent']);
  assert.match(won(row(3)), /data-ma-gate="nopct"[^>]*>—</, 'ME_THIN_FLOOR keeps its dash');
  assert.deepEqual(barW(row(3)), ['0.0', 'transparent'], 'no win share drawn under 5');
  assert.ok(row(3).includes('background:var(--ma-track); border-radius:0 3px 3px 0;'), 'a neutral track, not a full "loss" bar');
  assert.match(won(row(7)), /data-ma-gate="small" title="small sample · n=7" style="color:var\(--ma-t3, var\(--label\)\);">57%</);
  assert.deepEqual(barW(row(7)), ['57.1', 'var(--ma-t3, var(--label))']);
  assert.match(won(row(12)), /data-ma-gate="full"[^>]*>75%</);
  assert.deepEqual(barW(row(12)), ['75.0', 'var(--ma-t1)']);
  // the band pop-up's Won / Yield boxes: greyed + a visible note at 5–9
  const box = S.meRateBox('Won', 4, 7, '57.1%', 'var(--ma-t1)', true);
  assert.ok(/color:var\(--ma-t3, var\(--label\)\); white-space:nowrap;">57\.1%<\/span><span class="ma-small-note"/.test(box));
  assert.ok(!S.meRateBox('Won', 9, 12, '75.0%', 'var(--ma-t1)', true).includes('small sample'));
});

// Mutation: the Tournament win rate back to `total > 0 ? Math.round(...) : 0` + "%" — n = 0 renders "0%".
test('Tournament win rate: 0 → "—" (never 0%), 3 → W–L only, 7 → greyed + note, 12 → full; the bar follows', () => {
  const col = n => S.atournPlayerColumn('J. Sinner', { totalWon: WINS[n], totalLost: n - WINS[n], editionsPlayed: 2, longMatches: 0, longMatchesPlayed: 0, longMatchPct: 0, years: [] }, 'p1', false);
  const card = n => { const h = col(n); return h.slice(h.lastIndexOf('<', h.indexOf('atourn-card')), h.lastIndexOf('<', h.indexOf('atourn-yearhead'))); };
  assert.ok(!NEVER.test(text(card(0))), 'n = 0: no "0%"');
  assert.match(card(0), /data-ma-gate="none"[^>]*>—</);
  assert.ok(!/%/.test(text(card(3))) && text(card(3)).includes('2-1'), 'n = 3: the record, no rate');
  assert.match(card(3), /class="track"><div style="width:0%;background:transparent;/);
  assert.match(card(7), /class="ma-rate pct" data-ma-gate="small"[^>]*>57%<\/span>[\s\S]*win rate<\/span><span class="ma-small-note"/);
  assert.match(card(7), /width:57\.14[\d]*%;background:var\(--ma-t3, var\(--label\)\);/);
  assert.match(card(12), /class="ma-rate pct" data-ma-gate="full" style="color:var\(--text\);">75%/);
});

// Mutation: the Overview season rate back to `${Math.round(rec.won / n * 100)}%`.
test('Overview this season by surface: 0 "—", 3 W–L only, 7 greyed (hover note), 12 full', () => {
  const rec = n => ({ won: WINS[n], lost: n - WINS[n], matches: [] });
  const h = S.seasonSurfaceTierViewHtml({ clay: rec(0), hard: rec(3), grass: rec(7) }, 'all', 'p1', 2026, null);
  const rows = h.split('yr-surfrec').slice(1);
  assert.ok(text(rows[0]).includes('—') && !NEVER.test(text(rows[0])), 'n = 0');
  assert.ok(!/%/.test(text(rows[1])), 'n = 3: W–L only');
  assert.match(rows[2], /class="ma-rate rpct" data-ma-gate="small" title="small sample · n=7"[^>]*>57%/);
  const full = S.seasonSurfaceTierViewHtml({ clay: rec(12), hard: rec(0), grass: rec(0) }, 'all', 'p1', 2026, null);
  assert.match(full, /class="ma-rate rpct" data-ma-gate="full"[^>]*>75%/);
});

// Mutation: the Playing style header back to `${Math.round(w / n * 100)}%` for every n.
test('Playing style "vs this style" header: 3 → W–L + count, 7 → greyed + note, 12 → full', () => {
  const arch = { name: 'Counterpuncher' }, tint = () => 'var(--line)';
  const agg = n => { const h = S.styleVsArchetypeCard('J. Sinner', Array.from({ length: n }, (_, i) => ({ won: i < WINS[n] })), arch, 'var(--text)', tint, 'x', 'p1');
    const i = h.indexOf('<span class="psvhdr-agg'); return i < 0 ? h : h.slice(i, h.indexOf('</div>', i)); };
  assert.ok(!NEVER.test(text(agg(0))) && text(agg(0)).includes('no tour meetings'));
  assert.equal(text(agg(3)), '2–1 · 3 matches');
  assert.match(agg(7), /4–3 · <span class="ma-rate" data-ma-gate="small"[^>]*>57%<\/span><span class="ma-small-note"[^>]*>small sample<\/span> · 7 matches/);
  assert.match(agg(12), /9–3 · <span class="ma-rate" data-ma-gate="full"[^>]*>75%<\/span> · 12 matches/);
});

// Mutation: stylePersonalCard keeps its own ladder (e.g. `n < 3` for the W–L-only tier) instead of the shared gate.
test('Playing style personal record: the shared gate — 0 "—", 3 W–L + n, 7 greyed + note, 12 full', () => {
  const card = n => { S.psMatrix = { byPlayer: { 'J. Sinner': { vs: { lab: { w: WINS[n], l: n - WINS[n] } } } } };
    return S.stylePersonalCard('J. Sinner', { id: 'a' }, { id: 'a', name: 'Counterpuncher' }, 'lab', 'var(--text)', () => 'var(--line)'); };
  assert.ok(text(card(0)).includes('— no tour meetings'));
  assert.match(card(3), /W2–L1<\/span> <span class="psv-pct">n=3<\/span>/);
  assert.match(card(7), /data-ma-gate="small"[^>]*>57% · n=7<\/span><span class="ma-small-note"/);
  assert.match(card(12), /data-ma-gate="full"[^>]*>75% · n=12</);
});
