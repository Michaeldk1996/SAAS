// TEN-334 (TEN-312 · Overview tab), ported to the Match analysis rebuild (2026-11-23): the tab is maOverviewV2 / maOvPopV2
// in match-analysis-v2.js; the data model (ovPopModel, ovOpenCell, ovOpenRow, ovStateFor, the real pricing chain
// meRowFromCareer → sfDbPxRows, the D2 gate maGate) stays in bsp-consult-dashboard.html. Both are EXECUTED together against
// a fixture: the dashboard closure (tools/ten334-overview-vm.mjs `closure`) and match-analysis-v2.js run in one scope, so
// the v2 code's free identifiers resolve to the sliced dashboard. Each check names the mutation it catches; the last test
// applies every one and fails if any survives. Rules: .claude/rules/modal-overview.md, modal-analysis.md (N2, N3, item 3,
// D2, DoD item 8, retirements in price figures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closure, fnSrc, profileWindow } from './tools/ten334-overview-vm.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const V2 = readFileSync(join(HERE, 'match-analysis-v2.js'), 'utf8');
const CORE = readFileSync(join(HERE, 'market-edge-core.js'), 'utf8');
const RET = /const RET_SETTLE_NOTE = '([^']*)';/.exec(CORE)[1];
const YEAR = String(new Date().getFullYear());
const wl = (won, lost) => ({ won, lost });
const split = (t, c, h, g) => ({ total: t, clay: c, hard: h, grass: g, indoor: null });
// Player 1: this season (all tiers) 5-3 on clay = ATP 3-2 + Challenger 2-1; one walkover in the history; 2019 an exact
// ATP-only row; 2018 an all-tier aggregate (no split). Player 2: no career rows at all.
const CBY = [
  { year: YEAR, allTier: true, ...split(wl(5, 3), wl(5, 3), null, null), atp: split(wl(3, 2), wl(3, 2), null, null), chitf: split(wl(2, 1), wl(2, 1), null, null) },
  { year: '2019', allTier: false, ...split(wl(2, 1), null, wl(2, 1), null), atp: split(wl(2, 1), null, wl(2, 1), null), chitf: null },
  { year: '2018', allTier: false, ...split(wl(9, 4), null, wl(9, 4), null), atp: null, chitf: null },
];
const d = (m, day) => `${YEAR}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const H = (date, opp, won, level, extra = {}) => Object.assign({ year: date.slice(0, 4), surface: 'clay', level, date, tournament: level === 'atp' ? 'Madrid' : 'Braga CH',
  round: '1/16-finals', opponent: opp, result: won ? '2 - 0' : '0 - 2', won, eventKey: 7000 + Number(date.slice(5, 7)) * 40 + Number(date.slice(8)), src: 'fixtures', bestOf: 3,
  sets: won ? [{ p: 6, o: 3 }, { p: 6, o: 4 }] : [{ p: 3, o: 6 }, { p: 4, o: 6 }] }, extra);
const HIST = [
  H(d(5, 9), 'A. Alpha', true, 'atp'), H(d(5, 7), 'B. Bravo', false, 'atp'), H(d(5, 5), 'C. Charlie', true, 'atp'),
  H(d(5, 3), 'D. Delta', true, 'atp', { result: '1 - 0', sets: [{ p: 6, o: 2 }, { p: 2, o: 1 }], retired: true }),   // a retirement: counts, "ret."
  H(d(5, 1), 'E. Echo', false, 'atp', { result: '0 - 1', sets: [{ p: 4, o: 6 }, { p: 0, o: 2 }], retired: true }),     // he retired: "ret." in loss red
  H(d(4, 20), 'F. Fox', true, 'chitf'), H(d(4, 18), 'G. Golf', true, 'chitf'), H(d(4, 16), 'H. Hotel', false, 'chitf'),
  H(d(4, 14), 'W. Walker', true, 'atp', { result: '', sets: [], walkover: true }),                                     // N2: never counted
  H('2019-06-10', 'K. Kilo', true, 'atp', { surface: 'hard', src: 'archive' }), H('2019-06-12', 'L. Lima', true, 'atp', { surface: 'hard', src: 'archive' }),
  H('2019-06-14', 'M. Mike', false, 'atp', { surface: 'hard', src: 'archive' }),
];
// closes: Pinnacle (Tennis-Data) for four ATP matches; the Challenger match "F. Fox" carries one too (N8: never shown).
const CL = { rows: [
  { date: d(5, 9), opp: 'Alpha A.', won: true, P: [1.5, 2.6], B: [1.45, 2.7], ret: false, oppKey: null },
  { date: d(5, 7), opp: 'Bravo B.', won: false, P: [1.8, 2.0], B: null, ret: false, oppKey: null },
  { date: d(5, 5), opp: 'Charlie C.', won: true, P: [2.2, 1.7], B: null, ret: false, oppKey: null },
  { date: d(5, 3), opp: 'Delta D.', won: true, P: [1.4, 3.0], B: null, ret: true, oppKey: null },
  { date: d(4, 20), opp: 'Fox F.', won: true, P: [1.3, 3.5], B: null, ret: false, oppKey: null },
], cap: [] };

// Founder ruling 2026-10-17 (ruling 3): an ATP row is priced by the master's join only. This harness's join = the
// fixture's own MASTER rows (the four ATP matches at Pinnacle), answering as sfDbPxRows does; the closes shard (CL) still
// carries a Challenger close, which must never show (N8), and a Bet365 price for Alpha, which must never win.
const MASTER = { [d(5, 9) + '|A. Alpha']: [1.52, 2.55], [d(5, 7) + '|B. Bravo']: [1.8, 2.0], [d(5, 5) + '|C. Charlie']: [2.2, 1.7], [d(5, 3) + '|D. Delta']: [1.4, 3.0] };
const MASTER_STUB = (key, name, views) => views.map(v => { const p = MASTER[v.date + '|' + v.opp]; return p ? { price: p[0], oppPrice: p[1], book: 'P', src: 'td' } : null; });
// Test-only hook: expose the v2 column builder (ovCol is private to the IIFE) — mutants are applied to the text before it.
const OV_EXPORT = 'root.maOvPopV2 = maOvPopV2;';
function vm(src, v2 = V2) {
  if (v2.split(OV_EXPORT).length !== 2) throw new Error('v2 export anchor not found exactly once');
  const body = closure(src, ['ovPopModel', 'ovPopHtml', 'buildYearlyTables', 'ovOpenRow', 'ovOpenCell', 'ovStateFor', 'careerRecordCountedRows',
    'maGate', 'fhSourceNote', 'fhSrcTitle', 'fhOdd', 'fhDDMM', 'ovCareerByYear', 'alignYearlyPair', 'ovRecApi', 'ovListable', 'setOverviewTier',
    'OV_TIERS', 'OV_NO_KEY', 'OV_NO_LIST', 'OV_NO_SPLIT', '_ovProfileSettled'],
    ['document', 'window', 'aPaint', 'aBuilt', 'loadCareerHistory', 'loadCareerRecord', 'fhLoadCloses', 'fhOpenSheet', 'ovRenderPop', 'playerProfiles', 'ensurePlayerProfile', 'matches', 'state', 'wl', 'sfDbPxRows', 'loadPp2CareerHistory', 'ovPaint']);
  const opened = [], painted = {};
  const PROFILES = { 1: { key: '1', name: 'Z. Zulu', careerByYear: CBY }, 2: { key: '2', name: 'Y. Yankee', careerByYear: null } };
  const win = profileWindow(PROFILES, { MarketEdgeCore: { RET_SETTLE_NOTE: RET }, careerHistory: { 1: HIST }, careerRecord: { 1: null } });
  const api = new Function('document', 'window', 'aPaint', 'aBuilt', 'loadCareerHistory', 'loadCareerRecord', 'fhLoadCloses', 'fhOpenSheet', 'ovRenderPop', 'playerProfiles', 'ensurePlayerProfile', 'sfDbPxRows', 'loadPp2CareerHistory', 'ovPaint', `
    ${body}
    const maOverviewV2 = (...a) => window.maOverviewV2(...a), maOvPopV2 = (...a) => window.maOvPopV2(...a);
    ${v2.replace(OV_EXPORT, OV_EXPORT + ' root.__ovCol = ovCol;')}
    _careerHistoryShards['1'] = ${JSON.stringify(HIST)}; _fhCl['1'] = ${JSON.stringify(CL)};
    _careerRecordLayers['1'] = null;   // TEN-449: answered, not joined to Tennis Explorer — his record is these rows
    _ovProfileSettled.add('1'); _ovProfileSettled.add('2');
    const ovCol = (i, n, pk, rows, real, tier) => window.__ovCol(i, n, pk, rows, real, tier, ovRecApi());   // the builder's own api argument
    return { ovPopModel, ovPopHtml, ovCol, buildYearlyTables, ovOpenRow, ovOpenCell, ovStateFor, get _ov(){ return _ov; }, get _fh(){ return _fh; } };`)(
    { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null }, win,
    (id, h) => { painted[id] = h; }, () => true, () => Promise.resolve([]), () => Promise.resolve(true), () => Promise.resolve(null), (mid) => opened.push(mid), () => {},
    PROFILES, () => Promise.resolve(true), MASTER_STUB, () => Promise.resolve(), () => {});
  return Object.assign(api, { opened, painted });
}
const M = { id: 'x', p1: 'Z. Zulu', p2: 'Y. Yankee', p1Key: '1', p2Key: '2' };
function pop(src, cell, tier = 'all', v2 = V2) {
  const V = vm(src, v2); V.ovStateFor(M); V._ov.tier = tier; V._ov.cell = cell;
  const Mo = V.ovPopModel(), html = V.ovPopHtml(Mo);
  assert.equal(typeof html, 'string', 'the pop-up renders markup'); return { V, Mo, html };
}
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
// a v2 tile (MA2.tile): its label, the figure, the note under it, and the figure's colour
const tileOf = (h, l) => { const m = new RegExp(`>${l}</span><span style="[^"]*color:([^;]+);">([^<]*)</span><span[^>]*>([^<]*)</span>`).exec(h); assert.ok(m, 'tile ' + l); return { col: m[1], fig: m[2], note: m[3] }; };
const rowsOf = h => [...h.matchAll(/onclick="ovOpenRow\('([^']+)'\)"/g)].map(x => x[1]);
// the pop-up row for one opponent (from its row start to the next)
const rowOf = (h, opp) => { const i = h.indexOf('>' + opp + '<'), a = h.lastIndexOf('<div', h.lastIndexOf('padding:8px 18px', i)); return h.slice(a, h.indexOf('</div>', i)); };
const OV_SECTION = v2 => v2.slice(v2.indexOf('// OVERVIEW (LOCKED'), v2.indexOf('root.maOvPopV2 = maOvPopV2;'));
// the v2 surface list's bar for one surface label: [first = career card, second = this season]
const barsOf = (h, l) => [...h.matchAll(new RegExp(`>${l}</span><span style="position:relative[^"]*"><span style="[^"]*background:([^;]+);`, 'g'))].map(x => x[1]);

const CHECKS = {
  // Founder 2026-10-22: the walkover is LISTED (WO under the date, no price, no sheet) and is not a match: not in Mo.rows,
  // not in the record, not priced. Mutation: the walkover dropped from the list.
  'N2 + 2026-10-22: a walkover is listed in the pop-up, never a match, a win or a price'(src, v2) {
    const { Mo, html } = pop(src, `0|season|clay`, 'all', v2);
    assert.equal(Mo.rows.length, 8, '5 ATP + 3 Challenger matches, the walkover not one of them');
    const wo = rowOf(html, 'W. Walker');
    assert.match(wo, />WO<\/span>/, 'WO under the date');
    assert.ok(!/ovOpenRow/.test(wo), 'the walkover row opens no sheet');
    assert.equal(tileOf(html, 'Record').fig, '5–3');
  },
  // Founder ruling 2026-10-18 (item 3; supersedes N8): a Challenger / ITF row takes the master join's price only.
  'item 3 (was N8): a Challenger row the join does not hold shows no price; Avg price and stake run over the priced rows only'(src, v2) {
    const { Mo, html } = pop(src, `0|season|clay`, 'all', v2);
    assert.equal(Mo.rows.find(r => r.opp === 'F. Fox').price, null, 'the Challenger close is never shown');
    assert.equal(tileOf(html, 'Average price').note, '4 of 8 priced', 'the priced count and the population');
    assert.equal(tileOf(html, 'Average price').fig, ((1.52 + 1.8 + 2.2 + 1.4) / 4).toFixed(2));
  },
  // Mutation: an ATP row back on the closes shard — the master's price wins.
  'an ATP row reads the master join only: Alpha 1.52 / 2.55, never the closes shard\'s 1.50 / 2.60'(src, v2) {
    const { Mo, html } = pop(src, `0|season|clay`, 'all', v2);
    const a = Mo.rows.find(r => r.opp === 'A. Alpha');
    assert.deepEqual([a.price, a.oppPrice, a.book], [1.52, 2.55, 'P']);
    assert.match(rowOf(html, 'A. Alpha'), />1\.52<\/span>[\s\S]*>2\.55<\/span>/, 'the row prints the master pair');
  },
  // Mutation: the Win rate / stake skip the gate (a % at n 1–4), or n = 0 prints "0%".
  'D2 on the pop-up: stake needs 5 priced (4 → "—"), Win rate at n 3 → "—", n 8 → greyed + small sample'(src, v2) {
    const { html } = pop(src, `0|season|clay`, 'all', v2);
    assert.equal(tileOf(html, 'At flat 1% stake').fig, '—', '4 priced matches: no stake figure');
    const w = tileOf(html, 'Win rate');
    assert.deepEqual([w.fig, w.col, w.note], ['62.5%', 'var(--ma2-grey)', 'small sample · n=8'], 'n 8: the rate shows, greyed, with the note');
    const ch = pop(src, `0|season|clay`, 'chitf', v2).html;
    assert.equal(tileOf(ch, 'Win rate').fig, '—', 'n 3: no rate');
    assert.equal(tileOf(ch, 'Record').fig, '2–1');
  },
  // Mutation: the retirement note is dropped from the stake figure (TEN-325: every profit surface names the settlement).
  'the stake figure carries the retirement settlement note from the one constant'(src, v2) {
    const { html } = pop(src, `0|season|clay`, 'all', v2);
    const i = html.indexOf('>At flat 1% stake<'), t = html.lastIndexOf('<span title="', i);
    assert.ok(t > 0 && html.slice(t, i).includes(RET), 'RET_SETTLE_NOTE in the stake tooltip');
    assert.match(fnSrc('maOvPopV2', '\n' + OV_SECTION(v2).replace(/\n  function /g, '\nfunction ')), /C4\.RET_SETTLE_NOTE/, 'read from MarketEdgeCore, not spelled out');
  },
  // Mutation: the retirement row loses its "ret." or stops counting.
  'a retirement counts in the record and is marked "ret." after its set scores'(src, v2) {
    const { Mo, html } = pop(src, `0|season|clay`, 'all', v2);
    assert.ok(Mo.rows.find(r => r.opp === 'D. Delta').won);
    assert.match(rowOf(html, 'D. Delta'), /6-2, 2-1 ret\./);
    assert.match(rowOf(html, 'E. Echo'), /4-6, 0-2 ret\./);
  },
  // Mutation: a dash with no tier split, or a count with no player key, says nothing about why.
  'a count or dash that opens nothing says why on hover'(src, v2) {
    const V = vm(src, v2);
    assert.match(V.ovCol(0, 'Z. Zulu', '1', CBY, CBY, 'chitf'), /title="No tier split for this season/);
    const nk = V.ovCol(0, 'Z. Zulu', null, CBY, CBY, 'all');
    assert.match(nk, /title="Match list not on file: this player has no id/);
    assert.ok(!/ovOpenCell/.test(nk), 'no key: nothing opens');
  },
  // Mutation: a reopen keeps the last tier / pop-up (openAnalysisModal no longer resets _ov).
  'every modal open starts the Overview from its defaults'(src) {
    const f = fnSrc('openAnalysisModal', src);
    assert.match(f, /ovPopEl\.innerHTML = ''; _ov = \{ m: null, tier: 'all', cell: null, sel: null, rows: \{\} \};/);
  },
  // Mutation: rows unsorted / oldest first, or the tier filter ignored.
  'rows: newest first; the tier filter applies'(src, v2) {
    const { Mo } = pop(src, `0|season|clay`, 'all', v2);
    assert.deepEqual(Mo.rows.map(r => r.date), [...Mo.rows.map(r => r.date)].sort().reverse());
    assert.deepEqual(pop(src, `0|season|clay`, 'atp', v2).Mo.rows.map(r => r.opp), ['A. Alpha', 'B. Bravo', 'C. Charlie', 'D. Delta', 'E. Echo']);
  },
  // Mutation: a row stops opening the shared sheet, or the pop-up leaves the shared shell. (Re-pointed: the 2026-11-23
  // rebuild draws its rows in maOvPopV2 inside MA2.popShell; maMatchRowsHtml / maPopFrame are no longer the Overview's.)
  'DoD item 8: every pop-up row opens the one sheet; the pop-up is the shared opened-box shell'(src, v2) {
    const { V, html } = pop(src, `0|season|clay`, 'all', v2);
    assert.match(html, /class="ma2-pop-ov"/, 'the shared shell');
    assert.equal((html.match(/class="seg ma2-row"/g) || []).length, 8, '8 matches; the listed walkover is not a row button');
    const mids = rowsOf(html);
    assert.equal(mids.length, 8, 'every match opens the sheet; the walkover row carries no sheet');
    V.ovOpenRow(mids[0]);
    assert.deepEqual(V.opened, [mids[0]], 'fhOpenSheet(mid)');
    const e = V._fh.sheetMap[mids[0]];
    assert.equal(e.aName, 'Z. Zulu'); assert.equal(e.r.opp, 'A. Alpha');
    assert.match(OV_SECTION(v2), /function maOvPopV2[\s\S]*return popShell\(/, 'the shared frame');
  },
  // Mutation: a pre-2021 aggregate cell opens (its count includes matches no archive lists), or an exact-ATP one does not.
  'pre-2021: an aggregate count opens nothing (and says why); an exact ATP-only count opens its matches'(src, v2) {
    const h = vm(src, v2).ovCol(0, 'Z. Zulu', '1', CBY, CBY, 'all');
    assert.match(h, /onclick="ovOpenCell\('0\|2019\|hard'\)"/);
    assert.match(h, /title="Match list not on file: before 2021/);
    assert.ok(!/onclick="ovOpenCell\('0\|2018/.test(h));
  },
  // Mutation: the year-table / season / card rates skip the gate (n 0 → "0%"), or an empty record reads 0–0.
  'D2 on the tab: never "0%" at n = 0; a player with no career rows reads dashes'(src, v2) {
    const h = vm(src, v2).ovCol(1, 'Y. Yankee', '2', [], [], 'all');
    assert.ok(!/(^|[^\d.])0(\.0)?%/.test(text(h)), 'no 0%');
    assert.ok(!/0–0/.test(h), 'no 0–0 record');
    assert.match(h, /font-size:26px; font-weight:700; line-height:1; color:var\(--ma2-quiet\); white-space:nowrap;">—</, 'career record dash');
    assert.match(h, /No career record on file/);
  },
  // modal-overview.md item 1 (identity is the column, never a hue): a player's surface bars take one colour whatever the
  // surface or value; the D2 gate greys a 5–9 bar; % 700 white. Re-pointed: the 2026-11-23 design draws player A
  // --ma2-blue and player B --ma2-text (the per-player ring colours) in place of TEN-380's --bar for both.
  'surface bars: one identity colour per player whatever the surface / value, grey at 5–9; % 700 white'(src, v2) {
    const V = vm(src, v2);
    [[0, 'var(--ma2-blue)'], [1, 'var(--ma2-text)']].forEach(([i, col]) => {
      const h = V.ovCol(i, i ? 'Y. Yankee' : 'Z. Zulu', '1', CBY, CBY, 'all');
      assert.equal(barsOf(h, 'Hard')[0], col, 'hard n 16: the identity colour');
      assert.equal(barsOf(h, 'Clay')[0], 'var(--ma2-grey)', 'clay n 8: greyed by the gate');
      assert.match(h, /font-weight:700; color:var\(--ma2-text\); text-align:right;">68\.8%</, 'hard 11–5 = 68.8%, 700 white');
    });
  },
  // Mutation: the tier control loses its setOverviewTier hooks. Re-pointed: maSeg('ov') → the shared MA2 track (2026-11-23).
  'the tier control is the shared track over OV_TIERS, wired to setOverviewTier'(src, v2) {
    const V = vm(src, v2), m = { id: 'y', p1: 'Z. Zulu', p2: 'Z. Zulu', p1Key: '1', p2Key: '1' };
    V.ovStateFor(m); V._ov.tier = 'atp';
    const h = V.buildYearlyTables(m);
    assert.match(h, /class="ma2-track"/);
    for (const t of ['all', 'atp', 'chitf']) assert.match(h, new RegExp(`onclick="setOverviewTier\\('${t}'\\)" style="[^"]*font-weight:${t === 'atp' ? 700 : 600};`), t);
  },
  // Mutation: the open season row is not marked. Re-pointed from DF L3106's ▾: the 2026-11-23 design lifts the open row.
  'the open season row is lifted (--ma2-lifted), the others are not'(src, v2) {
    const V = vm(src, v2); V.ovStateFor(M);
    const bg = () => /onclick="ovOpenCell\('0\|season\|clay'\)"[^>]*?background:([^;]+);/.exec(V.ovCol(0, 'Z. Zulu', '1', CBY, CBY, 'all'))[1];
    assert.equal(bg(), 'transparent', 'closed');
    V._ov.cell = '0|season|clay'; assert.equal(bg(), 'var(--ma2-lifted)', 'open');
    V._ov.cell = '0|' + YEAR + '|clay'; assert.equal(bg(), 'transparent', 'another cell open');
  },
};
// RENDERER GAP (modal-overview.md item 2, DF L1997): "ret." carries the loss red when HE retired, neutral when his opponent
// did. maOvPopV2 prints " ret." inside the score in --ma2-soft for both. Kept failing; out of the mutant pass.
const GAPS = {
  'renderer gap: "ret." in loss red only on his own retirement'(src, v2) {
    const { html } = pop(src, `0|season|clay`, 'all', v2);
    assert.match(rowOf(html, 'E. Echo'), /<span[^>]*color:var\(--ma2-red\)[^>]*>\s*ret\./, 'he retired: "ret." in loss red');
    assert.ok(!/<span[^>]*color:var\(--ma2-red\)[^>]*>\s*ret\./.test(rowOf(html, 'D. Delta')), 'the opponent retired: neutral');
  },
};
for (const [name, fn] of Object.entries({ ...CHECKS, ...GAPS })) test(name, () => fn(HTML, V2));

// DoD item 8 (grep): the old Overview renderers are deleted; no literal colour in the v2 Overview.
test('DoD item 8: the old Overview row / drill / tooltip renderers are deleted; the v2 Overview uses tokens only', () => {
  for (const f of ['showOverviewMatches', 'buildYearlyTable', 'seasonSurfaceTierViewHtml', 'seasonSurfaceBlockHtml', 'yrSurfCell', 'currentSeasonSummary', 'ovColumnHtml', 'ovCellHtml', 'ovFlatBox'])
    assert.ok(!HTML.includes(`function ${f}(`), f);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(OV_SECTION(V2)), 'no literal colour');
});

// [label, 'html' | 'v2', from, to]
const MUTANTS = [
  ['walkover dropped from the pop-up list (2026-10-22)', 'html', "{ M.listed.push(d); return; }", '{ return; }'],
  ['ATP row back on the closes shard', 'html', "  if (!r.wo && typeof sfDbPxRows === 'function'){   // founder ruling 2026-10-18 (item 3): every level, qualifying included", "  if (false){"],
  ['stake ungated', 'v2', "np && gp !== 'nopct' ? signed(pl, 1) + '%' : DASH", "np ? signed(pl, 1) + '%' : DASH"],
  ['win rate ungated', 'v2', "n && g !== 'nopct' ? (w / n * 100).toFixed(1) + '%' : DASH", "n ? (w / n * 100).toFixed(1) + '%' : '0%'"],
  ['win rate small sample not greyed', 'v2', "color: g === 'small' ? 'var(--ma2-grey)' : null })", "color: null })"],
  ['retirement note dropped', 'v2', "' ' + (C4 ? C4.RET_SETTLE_NOTE : ''))", "'')"],
  ['ret. marker dropped', 'v2', "r.sets.map(q => q[0] + '-' + q[1]).join(', ') + (r.ret ? ' ret.' : '')", "r.sets.map(q => q[0] + '-' + q[1]).join(', ')"],
  ['priced count dropped', 'v2', "np + ' of ' + n + ' priced'", "n + ' matches'"],
  ['no split reason', 'v2', ": !n && tier !== 'all' && r.allTier === false && !r[tier] ? OV_NO_SPLIT : ''", ": ''"],
  ['no key reason', 'v2', "const why = n > 0 && pk == null ? OV_NO_KEY : n > 0", "const why = n > 0"],
  ['reopen keeps the tab state', 'html', "ovPopEl.innerHTML = ''; _ov = { m: null, tier: 'all', cell: null, sel: null, rows: {} };", "ovPopEl.innerHTML = '';"],
  ['rows unsorted', 'html', "  M.rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));", "  M.rows.reverse();"],
  ['tier filter ignored', 'html', "api.drillScope(prof, year, null, tier)", "api.drillScope(prof, year, null, 'all')"],
  ['row opens nothing', 'v2', "onclick=\"ovOpenRow(\\'' + r.mid + '\\')\"", "data-x=\"' + r.mid + '\""],
  ['sheet not opened', 'html', "  ovRenderPop();\n  fhOpenSheet(mid);\n}", "  ovRenderPop();\n}"],
  ['aggregate row opens', 'html', "function ovListable(r){ return !!r && (r.allTier === true || (r.allTier === false && !!r.atp)); }", "function ovListable(r){ return !!r; }"],
  ['exact ATP row closed', 'html', "function ovListable(r){ return !!r && (r.allTier === true || (r.allTier === false && !!r.atp)); }", "function ovListable(r){ return !!r && r.allTier === true; }"],
  ['career rec 0–0', 'v2', "const enRec = c => c && (c.won + c.lost) ? c.won + '–' + c.lost : DASH;", "const enRec = c => c ? c.won + '–' + c.lost : '0–0';"],
  ['bars take a surface hue', 'v2', "(g === 'small' ? 'var(--ma2-grey)' : barC)", "(g === 'small' ? 'var(--ma2-grey)' : k === 'hard' ? 'var(--ma2-green)' : barC)"],
  ['small-sample bar not greyed', 'v2', "(g === 'small' ? 'var(--ma2-grey)' : barC)", "barC"],
  ['tier control unwired', 'v2', "onclick: \"setOverviewTier('\" + t + \"')\"", "onclick: ''"],
  ['open season row not lifted', 'v2', "(can && _ov.cell === cid ? 'var(--ma2-lifted)' : 'transparent')", "'transparent'"],
  ['pop-up leaves the shared shell', 'v2', "return popShell({ onClose: 'ovCloseCell()', title, help: helpT, sub: tierLbl + ' · '", "return ({ onClose: 'ovCloseCell()', title, help: helpT, sub: tierLbl + ' · '"],
];
test(`mutants: ${MUTANTS.length} applied, every one caught`, () => {
  const survived = [];
  for (const [label, file, from, to] of MUTANTS) {
    const base = file === 'v2' ? V2 : HTML;
    assert.equal(base.split(from).length, 2, `mutant anchor for "${label}" must occur exactly once`);
    const mutant = base.replace(from, to), src = file === 'html' ? mutant : HTML, v2 = file === 'v2' ? mutant : V2;
    let caught = false;
    for (const fn of Object.values(CHECKS)) { try { fn(src, v2); } catch (e) { if (e instanceof assert.AssertionError) { caught = true; break; } throw e; } }
    if (!caught) survived.push(label);
  }
  assert.deepEqual(survived, [], 'mutants that survived');
});
