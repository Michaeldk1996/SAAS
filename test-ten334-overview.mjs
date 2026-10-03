// TEN-334 (TEN-312 · Overview tab): the tab as the design file draws it, on the shared helpers, from real data.
// The builder, the pop-up and everything they call (the real pricing chain meRowFromCareer → fhCloseFor → fhPickBook, the
// D2 gate, maSeg / maPopFrame / maMatchRowsHtml / maTipHtml) are sliced out of bsp-consult-dashboard.html and EXECUTED
// against a fixture (tools/ten334-overview-vm.mjs `closure`). Each check names the mutation it catches; the last test
// applies every one and fails if any survives. Rules: .claude/rules/modal-overview.md, modal-analysis.md (N2, N3, N8, D2,
// D4, DoD item 8, retirements in price figures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closure, fnSrc } from './tools/ten334-overview-vm.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
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

function vm(src) {
  const body = closure(src, ['ovPopModel', 'ovPopHtml', 'ovColumnHtml', 'buildYearlyTables', 'ovOpenRow', 'ovOpenCell', 'ovFlatBox'],
    ['document', 'window', 'aPaint', 'aBuilt', 'loadCareerHistory', 'fhLoadCloses', 'fhOpenSheet', 'ovRenderPop', 'playerProfiles', 'ensurePlayerProfile', 'matches', 'state', 'wl']);
  const opened = [], painted = {};
  const api = new Function('document', 'window', 'aPaint', 'aBuilt', 'loadCareerHistory', 'fhLoadCloses', 'fhOpenSheet', 'ovRenderPop', 'playerProfiles', 'ensurePlayerProfile', `
    ${body}
    _careerHistoryShards['1'] = ${JSON.stringify(HIST)}; _fhCl['1'] = ${JSON.stringify(CL)};
    return { ovPopModel, ovPopHtml, ovColumnHtml, buildYearlyTables, ovOpenRow, ovOpenCell, ovStateFor, get _ov(){ return _ov; }, get _fh(){ return _fh; } };`)(
    { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null }, { MarketEdgeCore: { RET_SETTLE_NOTE: RET } },
    (id, h) => { painted[id] = h; }, () => true, () => Promise.resolve([]), () => Promise.resolve(null), (mid) => opened.push(mid), () => {},
    { 1: { careerByYear: CBY }, 2: { careerByYear: null } }, () => Promise.resolve(true));
  return Object.assign(api, { opened, painted });
}
const M = { id: 'x', p1: 'Z. Zulu', p2: 'Y. Yankee', p1Key: '1', p2Key: '2' };
function pop(src, cell, tier = 'all') {
  const V = vm(src); V.ovStateFor(M); V._ov.tier = tier; V._ov.cell = cell;
  const Mo = V.ovPopModel(); return { V, Mo, html: V.ovPopHtml(Mo) };
}
const text = h => h.replace(/<span class="elotip-pop"[\s\S]*?<\/span><\/span>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const stat = (h, l) => { const i = h.indexOf(`data-me-stat="${l}"`); return text('<x ' + h.slice(i, h.indexOf('</div>', i))).replace(/^.*?>\s*/, ''); };
const rowsOf = h => [...h.matchAll(/data-ov-mid="([^"]+)"/g)].map(x => x[1]);

const CHECKS = {
  // Mutation: the pop-up keeps walkovers (drop `if (r.wo) return;` — flagged and score-inferred walkovers alike).
  'N2: a walkover is not a row, a win or a price in the pop-up'(src) {
    const { Mo, html } = pop(src, `0|season|clay`);
    assert.equal(Mo.rows.length, 8, '5 ATP + 3 Challenger matches, the walkover out');
    assert.ok(!/W\. Walker/.test(html));
    assert.equal(stat(html, 'Record'), '5–3');
  },
  // Mutation: N8 dropped (a Challenger / ITF row keeps the price its closes shard carries).
  'N8: Challenger / ITF rows show no price; Avg price and 1u run over the priced ATP rows only'(src) {
    const { Mo, html } = pop(src, `0|season|clay`);
    const fox = Mo.rows.find(r => r.opp === 'F. Fox');
    assert.equal(fox.price, null, 'the Challenger close is never shown');
    assert.match(html, /4 of 8 priced/, 'the sub-line carries the priced count and the population');
    assert.equal(stat(html, 'Avg price'), ((1.5 + 1.8 + 2.2 + 1.4) / 4).toFixed(2));
  },
  // Mutation: the pop-up prices from Bet365 before Pinnacle (FH_BOOK_ORDER reversed) — the R8 order is the shared picker's.
  'prices follow the R8 order through the shared picker: Pinnacle before Bet365'(src) {
    const { Mo } = pop(src, `0|season|clay`);
    const a = Mo.rows.find(r => r.opp === 'A. Alpha');
    assert.deepEqual([a.price, a.oppPrice, a.book], [1.5, 2.6, 'P']);
  },
  // Mutation: the Win rate / 1u skip the gate (a % at n 1–4), or n = 0 prints "0%".
  'D2 on the pop-up: 1u needs 5 priced (4 → "—"), Win rate at n 3 → "—", n 8 → greyed'(src) {
    const { html } = pop(src, `0|season|clay`);
    assert.equal(stat(html, 'At 1u flat'), '—', '4 priced matches: no 1u');
    assert.match(html, /data-me-stat="Win rate"[^>]*>63%/, 'n 8: the rate shows');
    assert.match(html, /data-me-stat="Win rate"[^<]*>63%<\/span><span class="ma-small-note"[^>]*>small sample/, 'n 8: greyed + small sample');
    const atp = pop(src, `0|season|clay`, 'chitf').html;
    assert.equal(stat(atp, 'Win rate'), '—', 'n 3: no rate');
    assert.equal(stat(atp, 'Record'), '2–1');
  },
  // Mutation: the retirement note is dropped from the 1u figure (TEN-325: every profit surface names the settlement).
  'the 1u figure carries the retirement settlement note from the one constant'(src) {
    const { html } = pop(src, `0|season|clay`);
    const i = html.indexOf('data-me-stat="At 1u flat"');
    assert.ok(i > 0 && html.slice(i, i + 1500).includes(RET), 'RET_SETTLE_NOTE in the 1u tooltip');
    assert.match(fnSrc('ovFlatBox', src), /core\.RET_SETTLE_NOTE/, 'read from MarketEdgeCore, not spelled out');
  },
  // Mutation: the retirement row loses its "ret.", stops counting, or the retiree's "ret." loses the loss red.
  'a retirement counts in the record and is marked "ret." (loss red only on his own retirement)'(src) {
    const { Mo, html } = pop(src, `0|season|clay`);
    assert.ok(Mo.rows.find(r => r.opp === 'D. Delta').won);
    assert.match(html, /6-2, 2-1<span class="ma-ret" style="font-weight:400; color:var\(--text-soft\); margin-left:5px;">ret\./, 'the opponent retired: neutral');
    assert.match(html, /4-6, 0-2<span class="ma-ret" style="font-weight:400; color:var\(--neg\); margin-left:5px;">ret\./, 'he retired: loss red');
  },
  // Mutation: a dash with no tier split, or a count with no player key, says nothing about why.
  'a count or dash that opens nothing says why on hover'(src) {
    const V = vm(src);
    assert.match(V.ovColumnHtml(0, 'Z. Zulu', '1', CBY, CBY, 'chitf'), /data-ov-cell="0\|2019\|hard" title="No tier split for this season/);
    assert.match(V.ovColumnHtml(0, 'Z. Zulu', null, CBY, CBY, 'all'), /data-ov-cell="0\|2019\|hard" title="Match list not on file: this player has no id/);
  },
  // Mutation: a reopen keeps the last tier / pop-up (openAnalysisModal no longer resets _ov).
  'every modal open starts the Overview from its defaults'(src) {
    const f = fnSrc('openAnalysisModal', src);
    assert.match(f, /ovPopEl\.innerHTML = ''; _ov = \{ m: null, tier: 'all', cell: null, sel: null, rows: \{\} \};/);
  },
  // Mutation: rows unsorted / oldest first, or the tier filter ignored.
  'rows: newest first; the tier filter applies'(src) {
    const { Mo } = pop(src, `0|season|clay`);
    assert.deepEqual(Mo.rows.map(r => r.date), [...Mo.rows.map(r => r.date)].sort().reverse());
    assert.deepEqual(pop(src, `0|season|clay`, 'atp').Mo.rows.map(r => r.opp), ['A. Alpha', 'B. Bravo', 'C. Charlie', 'D. Delta', 'E. Echo']);
  },
  // Mutation: the pop-up draws its own rows (not maMatchRowsHtml), or a row stops opening the shared sheet.
  'DoD item 8: pop-up rows are maMatchRowsHtml rows and every row opens the one sheet'(src) {
    const { V, html } = pop(src, `0|season|clay`);
    assert.match(html, /class="ma-rows ma-rows-table"/, 'the shared table variant');
    assert.equal((html.match(/class="seg ma-row"/g) || []).length, 8);
    const mids = rowsOf(html);
    assert.equal(mids.length, 8);
    for (const mid of mids) assert.match(html, new RegExp(`onclick="ovOpenRow\\('${mid}'\\)"`));
    V.ovOpenRow(mids[0]);
    assert.deepEqual(V.opened, [mids[0]], 'fhOpenSheet(mid)');
    const e = V._fh.sheetMap[mids[0]];
    assert.equal(e.aName, 'Z. Zulu'); assert.equal(e.r.opp, 'A. Alpha');
    assert.match(fnSrc('ovPopHtml', src), /maPopFrame\(/, 'the shared frame');
  },
  // Mutation: a pre-2021 aggregate cell opens (its count includes matches no archive lists), or an exact-ATP one does not.
  'pre-2021: an aggregate count opens nothing (and says why); an exact ATP-only count opens its matches'(src) {
    const V = vm(src);
    const h = V.ovColumnHtml(0, 'Z. Zulu', '1', CBY, CBY, 'all');
    assert.match(h, /data-ov-cell="0\|2019\|hard" onclick="ovOpenCell\('0\|2019\|hard'\)"/);
    assert.match(h, /data-ov-cell="0\|2018\|hard" title="Match list not on file/);
    assert.ok(!/onclick="ovOpenCell\('0\|2018/.test(h));
  },
  // Mutation: the year-table / season / card rates skip the gate (n 0 → "0%").
  'D2 on the tab: never "0%" at n = 0; a player with no career rows reads dashes'(src) {
    const V = vm(src);
    const h = V.ovColumnHtml(1, 'Y. Yankee', '2', [], [], 'all');
    assert.ok(!/(^|[^\d.])0%/.test(text(h)), 'no 0%');
    assert.match(h, /class="ov-career-rec"[^>]*>—</);
    assert.match(h, /No career record on file/);
  },
  // Mutation: the career bars / season accents take the design's surface blues or a value colour (D4: identity by name order).
  'D4: bars and season accents carry player identity by name order, never surface or value'(src) {
    const V = vm(src);
    const a = V.ovColumnHtml(0, 'Z. Zulu', '1', CBY, CBY, 'all'), b = V.ovColumnHtml(1, 'Y. Yankee', '1', CBY, CBY, 'all');
    // hard: n 16 (full); clay n 8 is greyed by the gate, whoever's bar it is
    assert.match(a, /data-ov-bar="hard" style="width:\d+%; height:100%; background:var\(--fh-pa\);/);
    assert.match(b, /data-ov-bar="hard" style="width:\d+%; height:100%; background:var\(--fh-pb-fill\);/);
    assert.match(a, /data-ov-bar="clay" style="width:\d+%; height:100%; background:var\(--text-label\);/);
    assert.equal((a.match(/border-left:3px solid var\(--fh-pa\)/g) || []).length, 3);
    assert.equal((b.match(/border-left:3px solid var\(--fh-pb-fill\)/g) || []).length, 3);
  },
  // Mutation: the tier control is a tab-local segmented control (not maSeg's 'ov' geometry), or a review switcher is built.
  'the tier control is maSeg (ov geometry, DF L1954) inside each card; no review switcher'(src) {
    const V = vm(src);
    const h = V.ovColumnHtml(0, 'Z. Zulu', '1', CBY, CBY, 'all');
    assert.match(h, /class="ma-seg" data-ma-seg="ov"/);
    for (const l of ['Under the title', 'Navy glow', 'Soft ink', 'Initials + profile link', 'sample data']) assert.ok(!src.includes(`'${l}'`) || !fnSrc('ovColumnHtml', src).includes(l), l);
  },
  // TEN-366 (DoD item 1 inventory, Overview #18). Mutation: the season row's chevron stays › while its pop-up is open.
  'DF L3106: a season row shows ▾ while its pop-up is open, › otherwise'(src) {
    const V = vm(src); V.ovStateFor(M);
    const chev = () => /data-ov-cell="0\|season\|clay"[\s\S]*?margin-left:auto;[^>]*>([^<]*)<\/span>/.exec(V.ovColumnHtml(0, 'Z. Zulu', '1', CBY, CBY, 'all'))[1];
    assert.equal(chev(), '›', 'closed');
    V._ov.cell = '0|season|clay'; assert.equal(chev(), '▾', 'open');
    V._ov.cell = '0|' + YEAR + '|clay'; assert.equal(chev(), '›', 'another cell open');
  },
};
for (const [name, fn] of Object.entries(CHECKS)) test(name, () => fn(HTML));

// DoD item 8 (grep): no tab-local row or tooltip renderer is left for the Overview.
test('DoD item 8: the old Overview row / drill / tooltip renderers are deleted', () => {
  for (const f of ['showOverviewMatches', 'buildYearlyTable', 'seasonSurfaceTierViewHtml', 'seasonSurfaceBlockHtml', 'yrSurfCell', 'currentSeasonSummary'])
    assert.ok(!HTML.includes(`function ${f}(`), f);
  const ov = ['ovColumnHtml', 'ovCellHtml', 'ovPopHtml', 'ovFlatBox', 'buildYearlyTables'].map(f => fnSrc(f, HTML)).join('\n');
  assert.ok(!/class="elotip-pop|yr-drill-row|grid-template-columns:50px 10px[^']*'[^)]*\$\{/.test(ov.replace(/grid: '50px 10px[^']*'/, '')), 'no own tooltip or row markup');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(ov), 'no literal colour');
});

const MUTANTS = [
  ['walkovers kept', "    if (r.wo) return;                                         // N2: a walkover is not a match played\n", ''],
  ['N8 dropped', "    if (x.level !== 'atp') { r.price = null; r.oppPrice = null; r.book = null; r.src = null; }   // N8\n", ''],
  ['book order reversed', "const FH_BOOK_ORDER = ['Pcap', 'Ptd', 'Btd', 'Bcap'];", "const FH_BOOK_ORDER = ['Btd', 'Bcap', 'Pcap', 'Ptd'];"],
  ['1u ungated', "  const R = maRate(0, np, { text: fhSigned(pl, 1, 'u').replace(/^(?=\\d)/, '±'), nopct: '—' });", "  const R = { mode: 'full', txt: fhSigned(pl, 1, 'u') };"],
  ['win rate ungated', "    + meRateBox('Win rate', w, n, null, OV_C.text, true)", "    + meStatBox('Win rate', n ? Math.round(w / n * 100) + '%' : '0%', OV_C.text, true)"],
  ['retirement note dropped', " ${core ? core.RET_SETTLE_NOTE : ''}`;", '`;'],
  ['ret. marker dropped', " ret: !!r.ret,", ''],
  ['ret. always red', "color:${r.won ? 'var(--text-soft)' : 'var(--neg)'}; margin-left:5px;", "color:var(--neg); margin-left:5px;"],
  ['no split reason', "    : !n && tier !== 'all' && r.allTier === false && !r[tier] ? ` title=\"${fhEsc(OV_NO_SPLIT)}\"` : '';", "    : '';"],
  ['no key reason', "  const why = n > 0 && pk == null ? ` title=\"${fhEsc(OV_NO_KEY)}\"` : n > 0", "  const why = n > 0"],
  ['reopen keeps the tab state', "ovPopEl.innerHTML = ''; _ov = { m: null, tier: 'all', cell: null, sel: null, rows: {} };", "ovPopEl.innerHTML = '';"],
  ['rows unsorted', "  M.rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));", "  M.rows.reverse();"],
  ['tier filter ignored', "    if (tier !== 'all' && x.level !== tier) return;", ''],
  ['row opens nothing', "    selected: _ov.sel === r.mid, click: ` onclick=\"ovOpenRow('${r.mid}')\"`,", "    selected: _ov.sel === r.mid, click: '',"],
  ['sheet not opened', "  ovRenderPop();\n  fhOpenSheet(mid);\n}", "  ovRenderPop();\n}"],
  ['aggregate row opens', "function ovListable(r){ return !!r && (r.allTier === true || (r.allTier === false && !!r.atp)); }", "function ovListable(r){ return !!r; }"],
  ['exact ATP row closed', "function ovListable(r){ return !!r && (r.allTier === true || (r.allTier === false && !!r.atp)); }", "function ovListable(r){ return !!r && r.allTier === true; }"],
  ['career rec 0-0', "function ovRec(c){ return c && (c.won + c.lost) ? `${c.won}-${c.lost}` : '—'; }", "function ovRec(c){ return c ? `${c.won}-${c.lost}` : '0-0'; }"],
  ['bars by surface', "  const accent = i ? OV_C.pb : OV_C.pa;", "  const accent = OV_C.chev;"],
  ['own tier control', "  const seg = maSeg('ov', OV_TIERS", "  const seg = maSeg('readme', OV_TIERS"],
  ['open season row keeps ›', "${can ? (_ov.cell === cid ? '▾' : '›') : ''}", "${can ? '›' : ''}"],
];
test(`mutants: ${MUTANTS.length} applied, every one caught`, () => {
  const survived = [];
  for (const [label, from, to] of MUTANTS) {
    assert.equal(HTML.split(from).length, 2, `mutant anchor for "${label}" must occur exactly once`);
    const mutant = HTML.replace(from, to);
    let caught = false;
    for (const fn of Object.values(CHECKS)) { try { fn(mutant); } catch (e) { if (e instanceof assert.AssertionError) { caught = true; break; } throw e; } }
    if (!caught) survived.push(label);
  }
  assert.deepEqual(survived, [], 'mutants that survived');
});
