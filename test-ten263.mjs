// TEN-263 — Match analysis Form + H2H tabs (design_handoff_match_analysis).
//
// Drives the REAL code: the client block is sliced out of the shipped
// bsp-consult-dashboard.html and executed (never a copy of the rule), and the
// match-close shards are built by the real build-match-closes.js over a
// synthetic archive written to a temp dir. Every data rule the brief set is a
// test here, with a control where a pass could be vacuous.
//
// Run: node --test test-ten263.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const html = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');

function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found in bsp-consult-dashboard.html`);
  let depth = 0, i = html.indexOf('{', start);
  const open = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  assert.ok(i > open, `${name} braces did not balance`);
  return html.slice(start, i + 1);
}
function sliceBlock() {
  const a = html.indexOf('/* =====================================================================\n   TEN-263 ');
  const b = html.indexOf('/* ---------- TOURNAMENT SUB-TAB ---------- */');
  assert.ok(a > 0 && b > a, 'TEN-263 block not found between its sentinels');
  return html.slice(a, b);
}
const PS_TOUR_META_SRC = /const PS_TOUR_META = \(\(\) => \{[\s\S]*?\n\}\)\(\);/.exec(html);
assert.ok(PS_TOUR_META_SRC, 'PS_TOUR_META not found');

const HELPERS = ['escapeHtml', 'surnameFirstName', 'psShortName', 'formIni', 'ppCleanTournamentName',
  'psNormTour', 'psTourMeta', 'psRoundAbbr', 'h2hRoundLabel', 'eventKeyOfMatch'];
function sandbox() {
  return new Function(`
    const document = { addEventListener(){}, getElementById(){ return null; }, querySelector(){ return null; },
      head: { appendChild(){} }, createElement(){ return { set textContent(v){} }; } };
    const playerProfiles = {};
    let _formPanelCalls = 0;
    function formPanelHtml(){ _formPanelCalls++; return '<div>panel</div>'; }
    function ensureFormPanelTabs(){}
    function ensureFormRows(m){ return Promise.resolve(m); }
    function loadCareerHistory(){ return Promise.resolve([]); }
    function ensureStyleMeetings(m){ return Promise.resolve(m); }
    function ensurePsMatrix(){ return Promise.resolve(); }
    function ppStyleFor(){ return null; }
    function psArchFor(){ return null; }
    function styleMeetRowsFor(){ return []; }
    function openPlayerProfileFromMatch(){}
    function aGoTab(){}
    ${PS_TOUR_META_SRC[0]}
    ${HELPERS.map(slice).join('\n')}
    ${sliceBlock()}
    function buildFormSection(m){ return fhBuildForm(m); }
    function buildH2HSection(m){ return fhBuildH2H(m); }
    return { fhCloseFor, fhFinishRow, fhRowFromForm, fhBestOf, fhMeetingList, fhMeetings, fhScoreLines,
      fhFormLineDefs, fhH2hLineDefs, fhPriceAvg, fhTodayPair, fhFormRowHtml, fhH2hRowHtml, fhBuildForm,
      fhBuildH2H, fhSetsFrom, fhRoundCode, fhStateFor, fhNameKey, fhOdd, fhH2hRecCard, fhPickBook,
      fhSrcTitle, fhAllMeetingRows, fhLevelOf, fhH2hScopeNote, fhH2hGapNote, fhEligible, fhFormDataRows,
      consts: { FH_HOT_MIN_ELIGIBLE, FH_PRICE_AVG_MARGIN_REMOVED, FH_H2H_SET1_MIRROR, FH_H2H_RET_COUNTS,
        FH_ELO_AT_TIME, FH_BOOK_ORDER, FH_SURF, FH_H2H_LEVELS } };
  `)();
}
const S = sandbox();

// ── the flagged rules are one named constant each, at their designed values ──
test('flagged rules (a)–(e) are single constants at the designed values', () => {
  assert.equal(S.consts.FH_HOT_MIN_ELIGIBLE, 3);          // (a)
  assert.equal(S.consts.FH_PRICE_AVG_MARGIN_REMOVED, true); // (b)
  assert.equal(S.consts.FH_H2H_SET1_MIRROR, true);        // (c)
  assert.equal(S.consts.FH_SURF.Grass, '#2ab8a0');        // (d) the live site's grass token
  assert.equal(S.consts.FH_H2H_RET_COUNTS, true);         // (e)
  assert.deepEqual(S.consts.FH_H2H_LEVELS, ['ATP', 'CH', 'ITF']);  // §3b: every level, one constant
});

// ── data check 4: no dated Elo → "No number" variant, no Elo in any row ──
test('No-number variant: neither row renders an Elo tag or number', () => {
  assert.equal(S.consts.FH_ELO_AT_TIME, false);
  const r = S.fhRowFromForm({ opponent: 'C. Alcaraz', opponentKey: 1, date: '2026-08-01', tournament: 'Cincinnati', round: 'ATP Cincinnati - Final',
    surface: 'hard', result: '2 - 0', won: true, sets: [{ p: 6, o: 4 }, { p: 6, o: 3 }], retired: false, walkover: false, qualifying: false, tier: 'atp', eventKey: 9 }, 5, 'J. Sinner', 0);
  for (const h of [S.fhFormRowHtml(r), S.fhH2hRowHtml(r)]) {
    assert.ok(!/ELO/.test(h), 'an ELO tag rendered');
    assert.ok(!/title="Opponent/.test(h), 'the Elo title rendered');
  }
});

// ── completeness from the score, not the flag; Bo5 incl. the "ATP " Slam prefix ──
test('retirement inferred from the score; done sets exclude the unfinished set', () => {
  const r = S.fhFinishRow({ result: '1 - 0', won: true, sets: [[6, 3, null], [2, 1, null]], ret: false, wo: false, tourn: 'Madrid', tier: 'atp' });
  assert.equal(r.ret, true);
  assert.equal(r.complete, false);
  assert.equal(r.pS, 1); assert.equal(r.oS, 0);
  const done = S.fhFinishRow({ result: '2 - 0', won: true, sets: [[6, 3, null], [6, 4, null]], ret: false, wo: false, tourn: 'Madrid', tier: 'atp' });
  assert.equal(done.ret, false, 'control: a completed match is not flagged');
});
test('best-of-five: ATP-prefixed Slam names and a 3-set tally', () => {
  assert.equal(S.fhBestOf({ pS: 2, oS: 1, tourn: 'ATP US Open', tier: 'atp', qualifying: false }), 5);
  assert.equal(S.fhBestOf({ pS: 2, oS: 1, tourn: 'US Open', tier: 'atp', qualifying: true }), 3, 'Slam qualifying is Bo3');
  assert.equal(S.fhBestOf({ pS: 3, oS: 0, tourn: 'Davis Cup', tier: 'atp' }), 5);
  assert.equal(S.fhBestOf({ pS: 2, oS: 0, tourn: 'Umag', tier: 'atp' }), 3);
});
test('qualifying rounds print as Q, never as the feed\'s "Final"', () => {
  assert.equal(S.fhRoundCode('ATP Cincinnati - Final', true), 'Q');
  assert.equal(S.fhRoundCode('ATP Cincinnati - Final', false), 'F');
  assert.equal(S.fhRoundCode('Qualifying', false), 'Q', 'career-history has no flag: its round reads "Qualifying"');
});

// ── H2H: the fixture itself is not a previous meeting ──
test('fhMeetingList drops the fixture\'s own eventKey (control: other meetings stay)', () => {
  const m = { id: 'past-777', h2h: { matches: [{ eventKey: 777, date: '2026-09-22' }, { eventKey: 12, date: '2024-01-01' }] } };
  assert.deepEqual(S.fhMeetingList(m).map(x => x.eventKey), [12]);
  assert.equal(S.fhMeetingList({ id: 'upcoming-5', h2h: m.h2h }).length, 2);
});

// ── hot lines: Bo5 and RET not eligible for games/set lines; min 3 eligible ──
test('hot lines: eligibility and the minimum-3 rule', () => {
  const mk = (sets, extra) => S.fhFinishRow(Object.assign({ mid: Math.random().toString(36), won: true, sets, ret: false, wo: false, tourn: 'Umag', tier: 'atp',
    result: sets.filter(s => s[0] > s[1]).length + ' - ' + sets.filter(s => s[1] > s[0]).length }, extra || {}));
  const rows = [mk([[6, 4, null], [6, 4, null]]), mk([[6, 4, null], [3, 6, null], [6, 3, null]]),
    mk([[7, 6, 3], [6, 4, null]]), mk([[6, 4, null], [6, 4, null], [6, 4, null]], { tourn: 'Wimbledon' }), mk([[6, 4, null], [2, 1, null]], { result: '1 - 0' })];
  const sc = S.fhScoreLines(rows, S.fhFormLineDefs('Sinner'));
  const over = sc.scored.find(x => x.name === 'Over 22.5 games');
  assert.equal(over.n, 3, 'Bo5 and the retirement are not eligible for a totals line');
  const set1 = sc.scored.find(x => x.name === 'Sinner wins set 1');
  assert.equal(set1.n, 5, 'set 1 was completed in all five, including the retirement');
  const few = S.fhScoreLines(rows.slice(0, 2), S.fhFormLineDefs('Sinner'));
  assert.equal(few.scored.length, 0, 'fewer than 3 eligible → no line');
});
test('H2H lines carry the mirror pair while the flag is on', () => {
  const names = S.fhH2hLineDefs('Sinner', 'Alcaraz').map(d => d.name);
  assert.ok(names.includes('Sinner wins set 1') && names.includes('Alcaraz wins set 1'));
});

// ── price-range average is margin-removed ──
test('Price range average removes the margin (control: margin-included differs)', () => {
  const PR = [{ price: 1.5, oppPrice: 2.7 }, { price: 2.2, oppPrice: 1.7 }];
  const pA = ((1 / 1.5) / (1 / 1.5 + 1 / 2.7) + (1 / 2.2) / (1 / 2.2 + 1 / 1.7)) / 2;
  assert.ok(Math.abs(S.fhPriceAvg(PR, true) - 1 / pA) < 1e-9);
  const incl = 1 / ((1 / 1.5 + 1 / 2.2) / 2);
  assert.ok(Math.abs(S.fhPriceAvg(PR, true) - incl) > 0.01, 'control: the two averages must differ on this input');
});

// ── rendered states off real renderers ──
function formRow(i, won, surface, date, extra) {
  return Object.assign({ opponent: 'P. Opp' + String.fromCharCode(65 + i), opponentKey: 100 + i, date, tournament: 'Umag', round: 'ATP Umag - 1/8-finals',
    surface, result: won ? '2 - 0' : '0 - 2', won, sets: won ? [{ p: 6, o: 3 }, { p: 6, o: 4 }] : [{ p: 3, o: 6 }, { p: 4, o: 6 }],
    retired: false, walkover: false, qualifying: false, tier: 'atp', eventKey: 500 + i }, extra || {});
}
// A match-closes shard as the page holds it after fhLoadCloses.
const shard = (rows, cap) => ({ rows: rows || [], cap: cap || [] });
test('Form: partial pricing shows "N of M priced"; thin window shows no ratios', () => {
  const rows = Array.from({ length: 10 }, (_, i) => formRow(i, i % 3 !== 0, 'hard', `2026-08-${String(20 - i).padStart(2, '0')}`));
  const closes = shard(rows.slice(0, 7).map((r, i) => ({ date: r.date, opp: r.opponent.replace(/^P\. (.*)$/, '$1 P.'), won: r.won,
    P: i < 5 ? [1.8, 2.0] : null, B: [1.7, 2.1], ret: false, oppKey: String(r.opponentKey) })));
  const m = { id: 'upcoming-1', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: 1, p2Key: 2, surface: 'hard', date: '2026-09-01',
    p1RecentFormMatches: rows, p2RecentFormMatches: rows.slice(0, 4), _fhFormData: true, _fhCloses: [closes, null] };
  const h = S.fhBuildForm(m);
  // Pixel pass (2026-09-24): the meta line is ONE line — "market expected X wins in N · 7 of 10 priced";
  // the book note is one shared line under both columns.
  const meta = /<span class="fh-meta"[^>]*>(.*?)<\/span>\n/.exec(h);
  assert.ok(meta && /white-space:nowrap/.test(meta[0]) && meta[1].includes('7 of 10 priced'), 'priced count on the one-line meta line');
  assert.ok(!meta[1].includes('Bet365'), 'the book note is not on the meta line');
  assert.ok(h.includes('class="fh-srcline"') && h.includes('Closing odds · Pinnacle, Bet365 where missing (Sinner 2)'), 'shared book-source line names the player and count');
  assert.ok(h.includes('4 matches with these filters'), 'thin note missing for the 4-match player');
  assert.equal((h.match(/visibility:hidden;">—<\/span>/g) || []).length, 1, 'the other column reserves the thin slot, so both form bars share a baseline');
  assert.ok(!h.includes('ELO'));
  // Form data open: the priced count is a sub-caption, never after the value; mirrored on both sides.
  S.fhStateFor(m).form.card = true;
  const d = S.fhBuildForm(m);
  assert.ok(d.includes('fh-dcell') && !/· \d+ of \d+ priced/.test(d.slice(d.indexOf('fh-dcell'))), 'no priced suffix after a data value');
  assert.ok(/class="fh-dsub"[^>]*>7 of 10 priced</.test(d), 'priced count in the sub-caption slot');
  assert.ok(/class="fh-dsub"[^>]*>4 matches</.test(d), 'thin count in the sub-caption slot');
});
test('Form pixel pass: mirrored priced count, pill tooltip only with a figure, one-line score, design line-height, Days-mode baseline', () => {
  const rows = Array.from({ length: 10 }, (_, i) => formRow(i, i % 2 === 0, 'hard', `2026-08-${String(20 - i).padStart(2, '0')}`));
  const cl = n => shard(rows.slice(0, n).map(r => ({ date: r.date, opp: r.opponent.replace(/^P\. (.*)$/, '$1 P.'), won: r.won, P: null, B: [1.7, 2.1], ret: false, oppKey: String(r.opponentKey) })));
  const m = { id: 'upcoming-7', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: 1, p2Key: 2, surface: 'hard', date: '2026-09-01',
    p1RecentFormMatches: rows, p2RecentFormMatches: rows, _fhFormData: true, _fhCloses: [cl(10), cl(8)] };
  S.fhStateFor(m).form.card = true;
  const h = S.fhBuildForm(m);
  assert.ok(/class="fh-dsub"[^>]*>10 of 10 priced</.test(h), 'the fully priced side mirrors its count when the other side is partial');
  assert.ok(/class="fh-dsub"[^>]*>8 of 10 priced</.test(h));
  assert.equal((h.match(/ title="v market on /g) || []).length, 2, 'pill tooltip names the book mix when the figure shows');
  assert.ok(h.includes('<div class="fh-fwrap" style="line-height:normal;">'), 'design line-height (rows 51px, filter bar 34px)');
  const thin = S.fhBuildForm(Object.assign({}, m, { id: 'upcoming-8', p2RecentFormMatches: rows.slice(0, 2), _fhCloses: [cl(10), cl(2)] }));
  assert.equal((thin.match(/ title="v market on /g) || []).length, 1, 'no pill tooltip on a thin side (its figure is a dash)');
  const r = S.fhRowFromForm({ opponent: 'C. Alcaraz', opponentKey: 1, date: '2026-03-15', tournament: 'US Open', round: 'ATP US Open - 1/64-finals', surface: 'hard', result: '2 - 3', won: false,
    sets: [{ p: 6, o: 2 }, { p: 3, o: 6 }, { p: 3, o: 6 }, { p: 7, o: 5 }, { p: 5, o: 7 }], retired: false, walkover: false, qualifying: false, tier: 'atp', eventKey: 9 }, 5, 'A. Shevchenko', 0);
  assert.match(S.fhFormRowHtml(r), /title="6-2  3-6  3-6  7-5  5-7" style="[^"]*white-space:nowrap; overflow:hidden; text-overflow:ellipsis;/, 'a five-set score stays on one line (full text in the tooltip)');
});
test('Form: a side with no match in a Days window keeps its bar row', () => {
  const rows = Array.from({ length: 4 }, (_, i) => formRow(i, true, 'hard', `2026-08-${String(28 - i).padStart(2, '0')}`));
  const m = { id: 'upcoming-10', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: 1, p2Key: 2, surface: 'hard', date: '2026-09-01',
    p1RecentFormMatches: rows, p2RecentFormMatches: [], _fhFormData: true, _fhCloses: [null, null] };
  Object.assign(S.fhStateFor(m).form, { wmode: 'd', days: 10 });
  const h = S.fhBuildForm(m);
  assert.equal((h.match(/aria-hidden="true" style="flex:1; position:relative; padding:5px 0; visibility:hidden;"/g) || []).length, 1, 'placeholder bar row on the empty side');
});
test('Form data grid: a sub-caption on either side reserves the slot on both; values are Plex Mono tabular', () => {
  const A = { metrics: { x: { v: 2.75, val: '2.75', aside: '', sub: '9 of 10 priced' }, y: { v: 1, val: '1', aside: '', sub: '' } } };
  const B = { metrics: { x: { v: 1.45, val: '1.45', aside: '', sub: '' }, y: { v: 2, val: '2', aside: '', sub: '' } } };
  const h = S.fhFormDataRows(A, B, [['x', 'Median odd', 'his closing odd'], ['y', 'Load', 'matches']]);
  const rows = h.split('display:grid; grid-template-columns:minmax(0,1fr) 200px minmax(0,1fr)').slice(1);
  assert.equal((rows[0].match(/class="fh-dsub"/g) || []).length, 2, 'both sides carry the slot when one side has a caption');
  assert.equal((rows[1].match(/class="fh-dsub"/g) || []).length, 0, 'control: a row without captions adds no slot (design rhythm)');
  assert.ok((h.match(/class="fh-dval"[^>]*font-variant-numeric:tabular-nums/g) || []).length === 4);
});
test('H2H states: loading skeleton until the histories land; none → "on record" empty state with its scope', () => {
  const m = { id: 'upcoming-3', p1: 'A. B', p2: 'C. D', p1Key: 1, p2Key: 2, surface: 'hard', h2h: { matches: [{ date: '2024-01-01', eventKey: 4, p1Won: true, result: '2 - 0', surface: 'hard' }] } };
  assert.ok(S.fhBuildH2H(m).includes('Loading head-to-head'), 'an api-tennis list alone is not enough to render: CH/ITF may add meetings');
  const ch = [[{ eventKey: 1, date: '2019-02-01', level: 'atp' }, { eventKey: 2, date: '2017-05-01', level: 'chitf' }],
              [{ eventKey: 3, date: '2021-02-01', level: 'atp' }, { eventKey: 4, date: '2018-05-01', level: 'chitf' }]];
  const e = S.fhBuildH2H({ id: 'upcoming-4', p1: 'A. B', p2: 'C. D', p1Key: 1, p2Key: 2, surface: 'hard', h2h: null, _styleMeetLoaded: true,
    _fhH2hData: true, _fhCh: ch, _fhCloses: [null, null], p1RecentFormMatches: [], p2RecentFormMatches: [] });
  assert.ok(e.includes('No previous meetings on record'));
  assert.ok(e.includes('Searched: ATP since 2021, Challenger and ITF since 2018, in both players'), 'scope note: the later of the two players\' first year, per level group');
  assert.ok(!e.includes('Price range'), 'sections below the empty state must be hidden');
  assert.equal(S.fhH2hScopeNote({ p1: 'A. B', p2: 'C. D', _fhCh: [ch[0], null] }), 'Match history unavailable for C. D: only ATP meetings were searched.');
});

// ── §3b H2H at every level: api-tennis (ATP) ∪ career-history eventKey intersection ──
function allLevels0() {
  const mm = { eventKey: 10, date: '2025-06-01', p1Won: true, result: '2 - 0', surface: 'clay', tournament: 'ATP Lyon', round: 'ATP Lyon - Final', qualifying: false };
  return { id: 'upcoming-99', p1: 'J. Faria', p2: 'T. Atmane', p1Key: 1, p2Key: 2, surface: 'hard', date: '2026-09-23',
    h2h: { matches: [mm] }, _fhH2hData: true, p1RecentFormMatches: [], p2RecentFormMatches: [], _fhCloses: [null, null],
    _fhCh: [[
      { eventKey: 10, date: '2025-06-01', level: 'atp', tournament: 'Lyon', round: 'Final', won: true, result: '2 - 0', surface: 'clay' },
      { eventKey: 20, date: '2026-03-09', level: 'chitf', tournament: 'Cap Cana', round: 'Qualifying', won: false, result: '1 - 2', surface: 'hard' },
      { eventKey: 30, date: '2022-07-14', level: 'chitf', tournament: 'M25 Idanha-a-Nova', round: '1/8-finals', won: false, result: '1 - 2', surface: 'hard' },
      { eventKey: 40, date: '2023-01-01', level: 'chitf', tournament: 'Elsewhere', round: 'Final', won: true, result: '2 - 0', surface: 'hard' },
      { eventKey: 99, date: '2026-09-23', level: 'atp', tournament: 'Hangzhou', round: '1/16-finals', won: true, result: '2 - 0', surface: 'hard' },
    ], []] };
}
// p2's own rows of the same matches: same day, opposite result.
const mirror = (rows, eks) => rows.filter(x => eks.includes(x.eventKey)).map(x => ({ eventKey: x.eventKey, date: x.date, won: !x.won }));
function allLevels() { const m = allLevels0(); m._fhCh[1] = mirror(m._fhCh[0], [10, 20, 30, 99]); return m; }
test('H2H meetings: every level, de-duplicated by eventKey, never the fixture, each tagged', () => {
  const m = allLevels();
  const rows = S.fhAllMeetingRows(m);
  assert.deepEqual(rows.map(x => [String(x.eventKey), x._level]), [['10', 'ATP'], ['20', 'CH'], ['30', 'ITF']],
    'ek 40 is only in p1\'s history (not a meeting); ek 99 is the fixture itself');
  assert.equal(m._fhMeetDupes, 1, 'the ATP meeting in both sources counts once');
  const ms = S.fhMeetings(m);
  assert.deepEqual(ms.map(r => [String(r.ek), r.level, r.round]), [['30', 'ITF', 'R16'], ['10', 'ATP', 'F'], ['20', 'CH', 'Q']]);
  const h = S.fhBuildH2H(m);
  assert.ok(h.includes('>CH<') && h.includes('>ITF<') && h.includes('>ATP<'), 'level tags on the rows');
  assert.ok(h.includes('0 of 3 meetings priced'));
});
test('a shared eventKey counts only when both rows are one match: same day, opposite results', () => {
  const m = allLevels();
  m._fhCh[1] = m._fhCh[1].map(y => y.eventKey === 20 ? { ...y, won: false } : y.eventKey === 30 ? { ...y, date: '2022-07-15' } : y);
  assert.deepEqual(S.fhAllMeetingRows(m).map(x => String(x.eventKey)), ['10'], 'same result on both sides, or a different day → not a meeting');
  assert.equal(m._fhMeetRejected, 2);
  const ok = allLevels(); S.fhAllMeetingRows(ok);
  assert.equal(ok._fhMeetRejected, 0, 'control: mirrored rows are not rejected');
});
test('level of a meeting: form tier first; else ATP by level, ITF by name, juniors/Slam-below-tour unclassified, else CH', () => {
  assert.equal(S.fhLevelOf('atp', 'Lyon'), 'ATP');
  assert.equal(S.fhLevelOf('chitf', 'M25 Idanha-a-Nova'), 'ITF');
  assert.equal(S.fhLevelOf('chitf', 'W15 Monastir'), 'ITF');
  assert.equal(S.fhLevelOf('chitf', 'ITF Cairo'), 'ITF');
  assert.equal(S.fhLevelOf('chitf', 'Cap Cana'), 'CH');
  assert.equal(S.fhLevelOf('chitf', 'Boys US Open'), null, 'a junior meeting is never a CH meeting');
  assert.equal(S.fhLevelOf('chitf', 'Wimbledon'), null, 'a Slam name below tour level: junior draw or qualifying, not knowable');
  assert.equal(S.fhLevelOf('chitf', 'Madrid', 'itf'), 'ITF', 'the form shard\'s own tier wins');
  assert.equal(S.fhLevelOf('chitf', 'Wimbledon', 'atp'), 'ATP', 'Slam qualifying the form shard types atp');
  assert.equal(S.fhLevelOf('chitf', 'Madrid'), 'CH', 'control: a Challenger sharing a tour city\'s name');
  assert.equal(S.fhLevelOf('chitf', 'ITF M25 Falun Men', 'challenger'), 'ITF', 'an ITF-named event the form tier calls challenger');
  assert.equal(S.fhLevelOf('chitf', 'Boys Wimbledon', 'challenger'), null, 'a junior event the form tier calls challenger');
  assert.equal(S.fhLevelOf('chitf', 'Bordeaux', 'challenger'), 'CH');
  assert.equal(S.fhLevelOf('chitf', 'US Open', 'challenger'), null, 'a bare Slam name below tour level is never CH');
});
test('unclassified meetings are left out and said so; a missing history is said under a non-empty list', () => {
  const m = allLevels();
  m._fhCh[0].push({ eventKey: 50, date: '2019-09-06', level: 'chitf', tournament: 'Boys US Open', round: '1/8-finals', won: true, result: '2 - 0', surface: 'hard' });
  m._fhCh[1].push({ eventKey: 50, date: '2019-09-06', won: false });
  m._fhCh[0].push({ eventKey: 60, date: '2024-06-24', level: 'chitf', tournament: 'Wimbledon', round: 'Qualifying', won: true, result: '2 - 1', surface: 'grass' });
  m._fhCh[1].push({ eventKey: 60, date: '2024-06-24', won: false });
  m.p2RecentFormMatches = [{ eventKey: 60, tier: 'atp', qualifying: true, date: '2024-06-24' }];
  const rows = S.fhAllMeetingRows(m);
  assert.deepEqual(rows.map(x => [String(x.eventKey), x._level]), [['10', 'ATP'], ['20', 'CH'], ['30', 'ITF'], ['60', 'ATP']],
    'the Slam qualifying meeting is kept because a form shard types it; the junior one is not');
  assert.equal(m._fhMeetUnclassified, 1);
  assert.ok(S.fhH2hScopeNote(m).endsWith(' 1 meeting at junior or unclassified events not counted.'));
  assert.ok(S.fhBuildH2H(m).includes('1 meeting at junior or unclassified events not counted.'));
  const lone = Object.assign(allLevels(), { _fhCh: [allLevels()._fhCh[0], []] });
  S.fhAllMeetingRows(lone);
  assert.equal(S.fhH2hGapNote(lone), ' Match history unavailable for T. Atmane: Challenger and ITF meetings may be missing.');
  assert.ok(S.fhBuildH2H(lone).includes('Challenger and ITF meetings may be missing'), 'the api-tennis meeting still shows, with the gap named');
  assert.equal(S.fhH2hGapNote(allLevels()), '', 'control: nothing to say when both histories loaded');
});

// ── the builder: Tennis-Data rows + captured closes, each pair only when two-sided ──
test('build-match-closes: Tennis-Data rows (both books, opponent key), one-sided dropped, walkovers skipped', () => {
  const { build } = require('./build-match-closes.js');
  const root = mkdtempSync(join(tmpdir(), 'ten263-'));
  try {
    mkdirSync(join(root, 'odds-archive'));
    const H = 'date,tournament,series,court,surface,round,bestof,winner,loser,wrank,lrank,comment,b365w,b365l,psw,psl,maxw,maxl,avgw,avgl,avgsrc';
    writeFileSync(join(root, 'odds-archive', '2025.csv'), [H,
      '2025-10-12,Shanghai Masters,Masters 1000,Outdoor,Hard,Semifinals,3,Sinner J.,Alcaraz C.,1,2,Completed,1.5,2.6,1.55,2.55,1.6,2.7,1.52,2.55,file',
      '2025-05-02,Madrid Masters,Masters 1000,Outdoor,Clay,Quarterfinals,3,Alcaraz C.,Sinner J.,2,1,Retired,1.8,2.0,1.85,2.05,1.9,2.1,1.82,2.02,file',
      '2025-06-01,Queens,ATP500,Outdoor,Grass,1st Round,3,Sinner J.,Nobody X.,1,300,Walkover,1.1,7.0,1.1,7.5,1.1,7.5,1.1,7.0,file',
      '2025-03-01,Dubai,ATP500,Outdoor,Hard,Final,3,Sinner J.,Rune H.,1,9,Completed,1.3,3.5,,,1.3,3.6,1.3,3.4,file',
      '2025-04-01,Miami,Masters 1000,Outdoor,Hard,Final,3,Sinner J.,Fritz T.,1,4,Completed,1.4,,1.42,,1.4,3.6,1.3,3.4,file'].join('\n') + '\n');
    writeFileSync(join(root, 'player-profiles.json'), JSON.stringify({ players: { 5: { name: 'J. Sinner' } } }));
    writeFileSync(join(root, 'matches.json'), JSON.stringify([{ p1: 'C. Alcaraz', p1Key: 6, p2: 'J. Sinner', p2Key: 5 }]));
    const r = build(root, join(root, 'match-closes'), join(root, 'match-closes-index.json'));
    const rows = JSON.parse(readFileSync(join(root, 'match-closes', '5.json'), 'utf8')).rows;
    assert.deepEqual(rows, [
      ['2025-03-01', 'Rune H.', 1, null, null, 1.3, 3.5, 0, null],     // no Pinnacle → Bet365 pair only; Rune not on our roster
      ['2025-05-02', 'Alcaraz C.', 0, 2.05, 1.85, 2.0, 1.8, 1, '6'],  // retirement kept + flagged, both books, opponent key
      ['2025-10-12', 'Alcaraz C.', 1, 1.55, 2.55, 1.5, 2.6, 0, '6'],
    ]);
    assert.ok(!rows.some(x => x[0] === '2025-04-01'), 'a match where every book is one-sided was priced');
    assert.ok(!rows.some(x => x[0] === '2025-06-01'), 'a walkover was priced');
    assert.equal(r.stats.walkovers, 1);
    const idx = JSON.parse(readFileSync(join(root, 'match-closes-index.json'), 'utf8'));
    assert.deepEqual(idx.players['6'], [2, 0], 'the board player resolved through matches.json');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── §2a captured closes: the last price at or before the ACTUAL start, never in-play ──
test('lastAtOrBefore never picks a tick after the cut (an in-play price); a tick AT the cut is the close', () => {
  const { lastAtOrBefore } = require('./build-match-closes.js');
  const s = [[100, 1.5], [200, 1.6], [201, 1.1], [900, 1.02]];
  assert.equal(lastAtOrBefore(s, 200), 1.6);
  assert.equal(lastAtOrBefore(s, 199), 1.5);
  assert.equal(lastAtOrBefore([[201, 1.1]], 200), null, 'only in-play ticks → no close');
});
test('build-match-closes: captured Bet365 cut at the actual start, captured Pinnacle file, drops without a start', () => {
  const { build } = require('./build-match-closes.js');
  const root = mkdtempSync(join(tmpdir(), 'ten263c-'));
  try {
    mkdirSync(join(root, 'odds-archive')); mkdirSync(join(root, 'bet365-history'));
    writeFileSync(join(root, 'odds-archive', '2025.csv'), 'date,tournament,series,court,surface,round,bestof,winner,loser,wrank,lrank,comment,b365w,b365l,psw,psl\n');
    writeFileSync(join(root, 'player-profiles.json'), JSON.stringify({ players: { 5: { name: 'J. Sinner' }, 6: { name: 'C. Alcaraz' } } }));
    writeFileSync(join(root, 'matches.json'), '[]');
    const T = Date.parse('2026-08-10T12:00:00Z') / 1000, T2 = T + 3 * 86400, T3 = T + 5 * 86400, T4 = T + 7 * 86400;
    writeFileSync(join(root, 'bet365-history', '2026-08.json'), JSON.stringify({ fixtures: {
      A: { cat: 'ATP', p1: 'Sinner, Jannik', p2: 'Alcaraz, Carlos', trueStart: T,          // in-play ticks after T must not win
           s1: [[T - 7200, 1.9], [T - 600, 1.8], [T + 60, 1.2]], s2: [[T - 7200, 1.95], [T - 600, 2.0], [T + 60, 4.5]] },
      B: { cat: 'ATP', p1: 'Sinner, Jannik', p2: 'Alcaraz, Carlos', s1: [[T2 - 600, 1.7]], s2: [[T2 - 600, 2.1]] },  // no actual start anywhere
      C: { cat: 'Challenger', p1: 'Alcaraz, Carlos', p2: 'Sinner, Jannik',                   // v1 row: the start comes from the fixture index
           s1: [[T3 - 300, 2.2]], s2: [[T3 - 300, 1.66], [T3 + 100, 1.1]] },
      D: { cat: 'ATP', p1: 'Sinner, Jannik', p2: 'Alcaraz, Carlos', trueStart: T4, s1: [[T4 - 100, 1.5]], s2: [[T4 + 100, 2.6]] },  // one side in-play only
      E: { cat: 'WTA', p1: 'Sinner, Jannik', p2: 'Alcaraz, Carlos', trueStart: T, s1: [[T - 1, 1.5]], s2: [[T - 1, 2.6]] },
      F: { cat: 'ATP', p1: 'Sinner J / Rune H', p2: 'Alcaraz C / Fritz T', trueStart: T, s1: [[T - 1, 1.5]], s2: [[T - 1, 2.6]] },
      G: { cat: 'ATP', p1: 'Sinner, Jannik', p2: 'Alcaraz, Carlos', trueStart: T4 + 86400,       // suspension marker before the off
           s1: [[T4 + 86400 - 448, 2.2], [T4 + 86400 - 254, 1.01]], s2: [[T4 + 86400 - 448, 1.615], [T4 + 86400 - 254, 1.01]] },
    } }));
    writeFileSync(join(root, '.ten225-fixture-index.json.gz'), gzipSync(JSON.stringify({ fixtures: { C: { trueStart: new Date(T3 * 1000).toISOString() } } })));
    writeFileSync(join(root, 'captured-closes-pinnacle.json'), JSON.stringify({ rows: [
      { eventKey: 777, date: '2026-08-20', p1Key: 5, p2Key: 6, p1: 1.7, p2: 2.15 },
      { eventKey: 778, date: '2026-08-21', p1Key: 5, p2Key: 6, p1: 1.7, p2: null } ] }));
    const r = build(root, join(root, 'match-closes'), join(root, 'match-closes-index.json'));
    const cap = JSON.parse(readFileSync(join(root, 'match-closes', '5.json'), 'utf8')).cap;
    assert.deepEqual(cap, [
      ['2026-08-10', '6', null, null, 1.8, 2.0, null],     // last tick before the start, not the in-play 1.2 / 4.5
      ['2026-08-15', '6', null, null, 1.66, 2.2, null],    // oriented to Sinner; the start from the fixture index
      ['2026-08-20', '6', 1.7, 2.15, null, null, '777'],   // captured Pinnacle, keyed by eventKey
      ['2026-08-18', '6', null, null, 2.2, 1.615, null],   // the 1.01/1.01 suspension tick is not the close
    ].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
    const alc = JSON.parse(readFileSync(join(root, 'match-closes', '6.json'), 'utf8')).cap;
    assert.deepEqual(alc[0], ['2026-08-10', '5', null, null, 2.0, 1.8, null], 'the opponent\'s shard carries the mirrored pair');
    assert.equal(r.stats.capNoStart, 1, 'the fixture with no actual start is dropped, never cut at a scheduled time');
    assert.equal(r.stats.capOneSided, 1, 'a side with only in-play ticks has no close');
    assert.equal(r.stats.capUnresolved, 1, 'a doubles pair never joins');
    assert.equal(r.stats.capB365, 3);
    assert.equal(r.stats.capPin, 1, 'a one-sided captured Pinnacle row is dropped');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── §2c the shared joiner: aliases, blocks, and no existing correct join moves ──
test('each alias maps to exactly one player, and only when that player is on the roster', () => {
  const { makeResolver, makeCommaResolver } = require('./build-match-closes.js');
  const { ARCHIVE_NAME_ALIASES, ARCHIVE_NAME_BLOCK } = require('./build-odds-performance.js');
  const entries = Object.entries(ARCHIVE_NAME_ALIASES);
  assert.ok(entries.length >= 8);
  for (const [name, key] of entries) {
    assert.match(key, /^\d+$/, `${name}: the alias target is one player key`);
    assert.ok(!ARCHIVE_NAME_BLOCK.has(name), `${name} is both aliased and blocked`);
    // a roster holding the target AND a decoy that shares the alias's own surname/initial
    const decoy = name.includes(',') ? name.split(',')[1].trim()[0] + '. ' + name.split(',')[0] : name.replace(/^(.*?)\s+(\S+)$/, '$2 $1');
    const roster = new Map([[key, 'Q. Target'], ['99999', decoy]]);
    const got = name.includes(',') ? makeCommaResolver(new Map([...roster].map(([k, v]) => [k, new Set([v])]))).comma(name) : makeResolver(roster).archive(name);
    assert.equal(got, key, `${name} → ${key}`);
    const without = new Map([['99999', decoy]]);
    const miss = name.includes(',') ? makeCommaResolver(new Map([['99999', new Set([decoy])]])).comma(name) : makeResolver(without).archive(name);
    assert.equal(miss, null, `${name}: alias target off the roster must resolve to nobody, never the decoy`);
  }
});
test('blocked archive names resolve to nobody (control: the right spelling still joins)', () => {
  const { makeResolver } = require('./build-match-closes.js');
  const R = makeResolver(new Map([['590', 'Z. Zhang'], ['15277', 'Daniel Milavsky']]));
  assert.equal(R.archive('Zhang Z.'), null);
  assert.equal(R.archive('Zhang Ze.'), null);
  assert.equal(R.archive('Daniel M.'), null);
  assert.equal(R.archive('Zhang Zh.'), '590', 'control: Zhizhen\'s own archive spelling');
  assert.equal(R.archive('Milavsky D.'), '15277', 'control: Milavsky\'s own archive spelling');
});
test('no existing correct join changes: every pre-§2c Tennis-Data join is unchanged except the blocked names', () => {
  const { makeResolver } = require('./build-match-closes.js');
  const { ARCHIVE_NAME_BLOCK } = require('./build-odds-performance.js');
  const snap = JSON.parse(readFileSync(join(HERE, 'tools', 'ten263-join-snapshot.json'), 'utf8'));
  const R = makeResolver(new Map(Object.entries(snap.roster)));
  const joins = Object.entries(snap.joins);
  assert.ok(joins.length >= 380, 'the snapshot must hold the full pre-change join set');
  const moved = joins.filter(([n, k]) => R.archive(n) !== (ARCHIVE_NAME_BLOCK.has(n) ? null : k));
  assert.deepEqual(moved, []);
  assert.ok(joins.some(([n]) => ARCHIVE_NAME_BLOCK.has(n)), 'control: a blocked name was in the old join set');
});
test('suspension marker: both sides at 1.01 on one tick leave both series; a lone 1.01 stays', () => {
  const { dropSuspended } = require('./build-match-closes.js');
  assert.deepEqual(dropSuspended([[1, 2.2], [2, 1.01]], [[1, 1.615], [2, 1.01]]), [[[1, 2.2]], [[1, 1.615]]]);
  assert.deepEqual(dropSuspended([[1, 1.01]], [[1, 15]]), [[[1, 1.01]], [[1, 15]]], 'control: 1.01 v 15 is a market');
});
test('two different people on one of our keys: none of their names joins (aliases exempt)', () => {
  const { makeCommaResolver } = require('./build-match-closes.js');
  const R = makeCommaResolver(new Map([['2838', new Set(['B. Nakashima'])], ['106', new Set(['A. De Minaur'])], ['396', new Set(['T. Barrios Vera'])]]));
  const got = R.resolveAll(['Nakashima, Brandon', 'Nakashima, Bryce', 'De Minaur, Alex', 'De Minaur, Alexander', 'Barrios Vera, Marcelo Tomas', 'Barrios Vera, Tomas']);
  assert.equal(got.get('Nakashima, Brandon'), null);
  assert.equal(got.get('Nakashima, Bryce'), null, 'Bryce is not Brandon');
  assert.equal(got.get('De Minaur, Alex'), '106', 'control: Alex ~ Alexander is one person');
  assert.equal(got.get('De Minaur, Alexander'), '106');
  assert.equal(got.get('Barrios Vera, Marcelo Tomas'), '396', 'a hand-checked alias is exempt');
  assert.equal(got.get('Barrios Vera, Tomas'), '396');
  assert.equal(R.comma('Nakashima, Bryce'), '2838', 'control: alone, the name would have joined');
});
test('captured (oddspapi) names: full given names disambiguate; suffixes and doubles handled', () => {
  const { makeCommaResolver } = require('./build-match-closes.js');
  const R = makeCommaResolver(new Map([
    ['1314', new Set(['D. Blanch'])], ['17463', new Set(['Dar. Blanch'])], ['1317', new Set(['M. Damm'])],
    ['32558', new Set(['J. J. Schwaerzler'])], ['7249', new Set(['Ivan Justo Guido', 'G. I. Justo'])],
    ['21', new Set(['A. Smith'])], ['22', new Set(['A. Smith'])]]));
  assert.equal(R.comma('Blanch, Darwin'), '17463', 'Darwin is Dar. Blanch, never D. Blanch');
  assert.equal(R.comma('Blanch, Dali'), '1314', 'control: Dali is D. Blanch');
  assert.equal(R.comma('Damm Jr, Martin'), '1317');
  assert.equal(R.comma('Schwaerzler, Joel'), '32558', 'ours may carry more initials than oddspapi gives');
  assert.equal(R.comma('Justo, Guido Ivan'), '7249', 'any name the key is seen under counts (profiles are order-scrambled)');
  assert.equal(R.comma('Smith, Adam'), null, 'two players fit → nobody');
  assert.equal(R.comma('Sinner J / Rune H'), null);
});

// ── ODDS SOURCE RULE (founder rulings 2026-09-23): Pinnacle TD → Pinnacle captured →
//    Bet365 TD → Bet365 captured → dash. Every test holds a case that goes wrong if
//    the order is reversed. ──
const PIN = [1.55, 2.55], PCAP = [1.6, 2.45], B365 = [1.5, 2.6], BCAP = [1.52, 2.58];
const pick = (x) => x && [x.book + ':' + x.src, x.price, x.oppPrice];
test('odds rule: the order constant', () => {
  assert.deepEqual(S.consts.FH_BOOK_ORDER, ['Ptd', 'Pcap', 'Btd', 'Bcap']);
});
test('odds rule: each step wins over every later step', () => {
  const all = { Ptd: PIN, Pcap: PCAP, Btd: B365, Bcap: BCAP };
  assert.deepEqual(pick(S.fhPickBook(all)), ['P:td', 1.55, 2.55]);
  assert.deepEqual(pick(S.fhPickBook({ ...all, Ptd: null })), ['P:cap', 1.6, 2.45], 'Pinnacle captured before Bet365 Tennis-Data');
  assert.deepEqual(pick(S.fhPickBook({ Btd: B365, Bcap: BCAP })), ['B:td', 1.5, 2.6]);
  assert.deepEqual(pick(S.fhPickBook({ Bcap: BCAP })), ['B:cap', 1.52, 2.58]);
});
test('odds rule: nothing → no price (a dash, the match is unpriced)', () => {
  assert.equal(S.fhPickBook({ Ptd: null, Pcap: null, Btd: null, Bcap: null }), null);
  assert.equal(S.fhPickBook(null), null);
  assert.equal(pick(S.fhPickBook({ Ptd: PIN, Bcap: BCAP }))[0], 'P:td', 'order control');
});
test('odds rule: a one-sided pair is missing for that match → fall through', () => {
  assert.deepEqual(pick(S.fhPickBook({ Ptd: [1.55, null], Pcap: PCAP, Bcap: BCAP })), ['P:cap', 1.6, 2.45]);
  assert.deepEqual(pick(S.fhPickBook({ Ptd: [null, 2.55], Pcap: [1.6, 1.0], Btd: B365 })), ['B:td', 1.5, 2.6], '1.00 is no price');
  assert.equal(S.fhPickBook({ Ptd: [1.55, null], Bcap: [null, 2.6] }), null);
});
test('odds rule: one book AND one source per match — never a side from each', () => {
  for (const pairs of [{ Ptd: PIN, Pcap: PCAP, Btd: B365, Bcap: BCAP }, { Ptd: [1.55, null], Pcap: [null, 2.45], Btd: B365 },
    { Pcap: PCAP, Btd: B365 }, { Btd: [null, 2.6], Bcap: BCAP }]) {
    const x = S.fhPickBook(pairs);
    assert.deepEqual([x.price, x.oppPrice], pairs[x.book + x.src], 'both sides must come from the chosen slot');
  }
  assert.deepEqual(pick(S.fhPickBook({ Pcap: PCAP, Btd: B365 })), ['P:cap', 1.6, 2.45], 'order control');
});
test('closing join: TD by opponent key (name only when the key is unknown), captured by eventKey, then the picker', () => {
  const sh = shard([
    { date: '2025-10-12', opp: 'Alcaraz C.', won: true, P: PIN, B: B365, ret: false, oppKey: '6' },
    { date: '2026-03-15', opp: 'Alcaraz C.', won: false, P: null, B: [2.1, 1.75], ret: false, oppKey: '6' },
    { date: '2024-05-01', opp: 'Nobody X.', won: true, P: [1.2, 4.5], B: null, ret: false, oppKey: null },
  ], [
    { date: '2026-03-15', oppKey: '6', P: [2.05, 1.8], B: null, ek: null },
    { date: '2026-08-10', oppKey: '6', P: null, B: [1.8, 2.0], ek: null },
    { date: '2026-08-20', oppKey: '6', P: [1.7, 2.15], B: null, ek: '777' },
  ]);
  const c = (...a) => pick(S.fhCloseFor(sh, ...a));
  assert.deepEqual(c('2025-10-13', 'C. Alcaraz', true, 6, 1), ['P:td', 1.55, 2.55]);
  assert.deepEqual(c('2026-03-15', 'C. Alcaraz', false, 6, 2), ['P:cap', 2.05, 1.8], 'Pinnacle captured beats Bet365 Tennis-Data');
  assert.deepEqual(c('2026-08-10', 'C. Alcaraz', true, 6, 3), ['B:cap', 1.8, 2.0]);
  assert.deepEqual(c('2026-08-25', 'C. Alcaraz', true, 6, 777), ['P:cap', 1.7, 2.15], 'the eventKey joins the capture, not the date');
  assert.deepEqual(c('2024-05-01', 'X. Nobody', true, 55, 4), ['P:td', 1.2, 4.5], 'a TD row with no opponent key joins by name');
  assert.equal(c('2025-10-12', 'C. Alcaraz', true, 99, 5), null, 'a keyed TD row never joins a different opponent key by name');
  assert.equal(c('2025-10-15', 'C. Alcaraz', true, 6, 6), null, '3 days off must not join');
  assert.equal(c('2025-10-12', 'C. Alcaraz', false, 6, 7), null, 'a result disagreement must not join');
  const both = shard([], [{ date: '2026-08-20', oppKey: '6', P: [1.7, 2.15], B: null, ek: '900' }, { date: '2026-08-20', oppKey: '6', P: null, B: [1.8, 2.0], ek: null }]);
  assert.deepEqual(pick(S.fhCloseFor(both, '2026-08-20', 'C. Alcaraz', true, 6, null)), ['P:cap', 1.7, 2.15], 'a Pinnacle and a Bet365 capture of one match are two rows, not two candidates');
  assert.deepEqual(pick(S.fhCloseFor(both, '2026-08-20', 'C. Alcaraz', true, 6, 901)), ['B:cap', 1.8, 2.0], 'a capture naming a DIFFERENT match is not joined by date');
  const dup = shard(sh.rows.concat([{ date: '2025-10-13', opp: 'Alcaraz C.', won: true, P: PIN, B: null, oppKey: '6' }]), []);
  assert.equal(S.fhCloseFor(dup, '2025-10-12', 'C. Alcaraz', true, 6, 8), null, 'two candidates = no join');
});
test("Today's price: Pinnacle current, else Bet365 current, else none — never bestOdds", () => {
  const best = { p1: { price: 9.9, bookmaker: 'Betfair' }, p2: { price: 9.9, bookmaker: 'Sbo' } };
  assert.deepEqual(pick(S.fhTodayPair({ bookNow: { Pncl: { p1: 1.7, p2: 2.2 }, bet365: { p1: 1.8, p2: 2.0 } }, bet365Now: { p1: 1.75, p2: 2.05 }, bestOdds: best })),
    ['P:cap', 1.7, 2.2]);
  assert.deepEqual(pick(S.fhTodayPair({ bookNow: { Pncl: { p1: 1.7 } }, bet365Now: { p1: 1.75, p2: 2.05 }, bestOdds: best })),
    ['B:cap', 1.75, 2.05], 'one-sided Pinnacle falls through to Bet365');
  assert.equal(S.fhTodayPair({ bestOdds: best }), null, 'bestOdds alone is never a price here');
  assert.equal(S.fhTodayPair({ finalScore: '2-0', bookNow: { Pncl: { p1: 1.7, p2: 2.2 } } }), null, 'no Today after the match');
  const block = html.slice(html.indexOf('TEN-263 '), html.indexOf('/* ---------- TOURNAMENT SUB-TAB'));
  assert.ok(!/bestOdds\s*[.[]/.test(block.replace(/\/\/.*$/gm, '')), 'the block reads m.bestOdds');
  assert.ok(!/\|\|\s*1\.54|\|\|\s*2\.62/.test(block), 'the sample price fallback is in the shipped block');
});
test('B365 tag, and every price names its book and source', () => {
  const r = S.fhRowFromForm({ opponent: 'C. Alcaraz', opponentKey: 1, date: '2026-03-15', tournament: 'Indian Wells', round: 'ATP Indian Wells - Final',
    surface: 'hard', result: '0 - 2', won: false, sets: [{ p: 4, o: 6 }, { p: 4, o: 6 }], retired: false, walkover: false, qualifying: false, tier: 'atp', eventKey: 9 }, 5, 'J. Sinner', 0);
  r.price = 2.1; r.oppPrice = 1.75; r.book = 'B'; r.src = 'td';
  // Pixel pass (2026-09-24): the Form row's name slot carries no bookmaker badge; the book shows as a
  // small marker in the H price cell + the tooltip. The H2H row keeps its B365 tag.
  assert.ok(!S.fhFormRowHtml(r).includes('>B365<') && S.fhH2hRowHtml(r).includes('>B365<'));
  assert.equal((S.fhFormRowHtml(r).match(/class="fh-bmark"[^>]*>B</g) || []).length, 1, 'one B marker, in the H cell');
  assert.ok(S.fhFormRowHtml(r).includes('title="Bet365 close · Tennis-Data"'));
  r.book = 'P'; r.src = 'cap';
  assert.ok(!S.fhFormRowHtml(r).includes('fh-bmark') && !S.fhH2hRowHtml(r).includes('B365'), 'Pinnacle rows carry no marker or tag');
  assert.ok(S.fhFormRowHtml(r).includes('title="Pinnacle close · captured"') && S.fhH2hRowHtml(r).includes('title="Pinnacle close · captured"'));
  assert.equal(S.fhSrcTitle({ book: 'P', src: 'td' }), 'Pinnacle close · Tennis-Data');
  assert.equal(S.fhSrcTitle(null), 'No Pinnacle or Bet365 close on record');
});
test('H2H price header names the Bet365 fallback count; 0 priced reads the empty copy', () => {
  const mm = (date, p1Won, ek) => ({ date, tournament: 'Umag', round: 'ATP Umag - Final', surface: 'clay', p1Won, result: p1Won ? '2 - 0' : '0 - 2', qualifying: false, eventKey: ek });
  const base = { id: 'upcoming-9', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: 1, p2Key: 2, surface: 'clay', date: '2026-09-01',
    h2h: { matches: [mm('2026-07-26', true, 10), mm('2024-07-28', true, 11), mm('2023-07-30', false, 12), mm('2022-07-31', false, 13)] },
    p1RecentFormMatches: [], p2RecentFormMatches: [], _fhH2hData: true, _fhCh: [[], []] };
  const rows = [{ date: '2026-07-26', opp: 'Alcaraz C.', won: true, P: null, B: [1.8, 2.0], oppKey: '2' },
    { date: '2024-07-28', opp: 'Alcaraz C.', won: true, P: [1.9, 1.95], B: [1.85, 1.95], oppKey: '2' },
    { date: '2023-07-30', opp: 'Alcaraz C.', won: false, P: [2.3, 1.62], B: null, oppKey: '2' }];
  const h = S.fhBuildH2H(Object.assign({}, base, { _fhCloses: [shard(rows), null] }));
  assert.ok(h.includes('3 of 4 meetings priced'), 'N of M = either book');
  assert.ok(h.includes('Closing odds · Pinnacle, Bet365 where missing (1)'));
  assert.ok(h.includes('>B365<'));
  const pinOnly = S.fhBuildH2H(Object.assign({}, base, { _fhCloses: [shard(rows.slice(1)), null] }));
  assert.ok(pinOnly.includes('Closing odds · Pinnacle<'), 'all-Pinnacle header');
  const fromP2 = S.fhBuildH2H(Object.assign({}, base, { _fhCloses: [null, shard([{ date: '2024-07-28', opp: 'Sinner J.', won: false, P: [1.95, 1.9], B: null, oppKey: '1' }])] }));
  assert.ok(fromP2.includes('1 of 4 meetings priced') && fromP2.includes('>1.90<'), 'p2\'s shard is read and mirrored to p1\'s side');
  const none = S.fhBuildH2H(Object.assign({}, base, { _fhCloses: [null, null] }));
  assert.ok(none.includes('0 of 4 meetings priced') && none.includes('No closing odds on record for these meetings'));
  assert.ok(!/Closing odds · Pinnacle/.test(none), 'no source is named for zero priced meetings');
  assert.ok(!none.includes('>0.00<'), 'unpriced rendered as zero');
});

// ── Founder rulings 2026-09-24 (comment dfc099be) ──
// 5 · the pipeline's H2H covers all of men's singles; every meeting row carries its level.
const PIPE = readFileSync(join(HERE, 'bsp-pipeline.js'), 'utf8');
function slicePipe(name) {
  const st = PIPE.indexOf(`function ${name}(`); assert.ok(st > 0, name + ' not in bsp-pipeline.js');
  let d = 0, i = PIPE.indexOf('{', st); for (; i < PIPE.length; i++) { if (PIPE[i] === '{') d++; else if (PIPE[i] === '}') { d--; if (!d) break; } }
  return PIPE.slice(st, i + 1);
}
const TYPES_SRC = /const H2H_EVENT_TYPES = new Set\(\[[^\]]*\]\);/.exec(PIPE);
test('pipeline H2H: ATP, Challenger and ITF singles count; exhibitions, doubles and women do not', () => {
  assert.ok(TYPES_SRC, 'H2H_EVENT_TYPES not found');
  const T = new Function(`${TYPES_SRC[0]}\nreturn H2H_EVENT_TYPES;`)();
  for (const t of ['Atp Singles', 'Challenger Men Singles', 'Itf Men Singles']) assert.ok(T.has(t), t);
  for (const t of ['Exhibition Men', 'Atp Doubles', 'Wta Singles', 'Itf Women Singles', 'Boys Singles']) assert.ok(!T.has(t), t);
  assert.match(slicePipe('fetchH2H'), /\.filter\(m => H2H_EVENT_TYPES\.has\(m\.event_type_type\)\)/, 'fetchH2H filters on the set');
});
test('pipeline H2H: every meeting row carries its level (ATP / CH / ITF)', () => {
  const P = new Function(`${slicePipe('h2hP1WasFirst')}\n${slicePipe('h2hLevelOf')}\n${slicePipe('buildH2HMatchList')}\nreturn { buildH2HMatchList };`)();
  const raw = (ek, type) => ({ event_key: ek, event_type_type: type, event_date: '2026-01-0' + ek, tournament_name: 'X', tournament_key: 1,
    event_first_player: 'J. Sinner', first_player_key: 1, event_second_player: 'C. Alcaraz', second_player_key: 2,
    event_winner: 'First Player', event_final_result: '2 - 0', event_qualification: 'False' });
  const rows = P.buildH2HMatchList([raw(1, 'Atp Singles'), raw(2, 'Challenger Men Singles'), raw(3, 'Itf Men Singles')], 1, new Map());
  assert.deepEqual(rows.map(r => [r.eventKey, r.level]).sort((a, b) => a[0] - b[0]), [[1, 'ATP'], [2, 'CH'], [3, 'ITF']]);
});
// ── Founder rulings 2026-09-24 (comment eece3eda) ──
// 5 · who won a meeting is decided by player key, never surname.
const PK = () => new Function(`${slicePipe('lastName')}\n${slicePipe('h2hP1WasFirst')}\n${slicePipe('h2hLevelOf')}\n${slicePipe('summarizeH2H')}\n${slicePipe('buildH2HMatchList')}\nreturn { summarizeH2H, buildH2HMatchList, h2hP1WasFirst };`)();
test('pipeline H2H: two same-surname players (Zhizhen Zhang 590, Ze Zhang 36963) orient by player key', () => {
  const P = PK();
  // Zhizhen (590) v Ze (36963). Both print as "Z. Zhang": a surname rule reads every row as p1 = first player.
  const row = (ek, firstKey, winner) => ({ event_key: ek, event_date: '2025-0' + ek + '-01', event_type_type: 'Challenger Men Singles', tournament_name: 'X', tournament_key: 1,
    event_first_player: 'Z. Zhang', first_player_key: firstKey, event_second_player: 'Z. Zhang', second_player_key: firstKey === 590 ? 36963 : 590,
    event_winner: winner, event_final_result: '2 - 1', event_qualification: 'False' });
  // Meeting 1: Ze Zhang listed first and won. Meeting 2: Zhizhen listed first and won. Meeting 3: Ze first, Zhizhen won.
  const raw = [row(1, 36963, 'First Player'), row(2, 590, 'First Player'), row(3, 36963, 'Second Player')];
  const s = P.summarizeH2H(raw, 590);
  assert.equal(s.record, '2-1', 'Zhizhen (p1) won meetings 2 and 3');
  assert.equal(P.summarizeH2H(raw, 36963).record, '1-2', 'mirror: Ze Zhang as p1');
  const list = P.buildH2HMatchList(raw, 590, new Map());
  assert.deepEqual(list.map(r => [r.eventKey, r.p1Won]).sort((a, b) => a[0] - b[0]), [[1, false], [2, true], [3, true]]);
  assert.equal(list.find(r => r.eventKey === 1).result, '1 - 2', 'score re-ordered p1-first by key');
  // Control: the old surname rule reads p1 as the first player on every row of this pair, so it
  // gets meetings 1 and 3 backwards. The key rule must not agree with it.
  const lastName = n => (n || '').trim().split(/\s+/).pop().toLowerCase();
  const bySurname = raw.map(m => (lastName(m.event_first_player) === lastName('Z. Zhang')) === (m.event_winner === 'First Player'));
  assert.deepEqual(bySurname, [true, true, false], 'control: the surname rule');
  assert.notDeepEqual(list.sort((a, b) => a.eventKey - b.eventKey).map(r => r.p1Won), bySurname, 'key orientation differs from surname orientation');
  assert.equal(P.h2hP1WasFirst({ first_player_key: 1, second_player_key: 2 }, 3), null, 'a row without p1 is not oriented');
  assert.equal(P.summarizeH2H([{ first_player_key: 1, second_player_key: 2, event_winner: 'First Player' }], 3).record, '0-0', '… and not counted');
  for (const name of ['summarizeH2H', 'buildH2HMatchList']) assert.doesNotMatch(slicePipe(name), /lastName\(/, name + ' must not orient by surname');
});
// 3 · a match never counts in its own H2H (cards, model, H2H page all read m.h2h).
test('pipeline H2H: a finished board match never appears in its own H2H record', () => {
  const X = new Function(`${slicePipe('eventKeyOf')}\n${slicePipe('h2hExcludeOwn')}\n${slicePipe('stripOwnFixtureFromH2H')}\nreturn { h2hExcludeOwn, stripOwnFixtureFromH2H };`)();
  const raw = [{ event_key: 12164701 }, { event_key: 11000001 }];
  assert.deepEqual(X.h2hExcludeOwn(raw, 12164701).map(r => r.event_key), [11000001], 'build step drops the fixture itself');
  assert.equal(X.h2hExcludeOwn(raw, null).length, 2, 'no own key: nothing dropped');
  // Final pass over the board: Vukic v Jacquet shape — today's finished result sits in its own h2h.
  const board = [
    { id: 'past-12164701', finalScore: '6-4 6-4', h2h: { p1Wins: 1, p2Wins: 1, record: '1-1', matches: [{ eventKey: 12164701, p1Won: false }, { eventKey: 11000001, p1Won: true }] } },
    { id: 'upcoming-12164702', h2h: { p1Wins: 0, p2Wins: 1, record: '0-1', matches: [{ eventKey: 11000002, p1Won: false }] } },
    { id: 'past-12164703', h2h: null },
  ];
  assert.equal(X.stripOwnFixtureFromH2H(board), 1);
  for (const m of board) {
    const own = m.id.slice(m.id.indexOf('-') + 1);
    assert.ok(!(m.h2h && m.h2h.matches.some(r => String(r.eventKey) === own)), m.id + ' appears in its own H2H');
  }
  assert.deepEqual([board[0].h2h.p1Wins, board[0].h2h.p2Wins, board[0].h2h.record], [1, 0, '1-0'], 'record recomputed without it');
  assert.equal(board[1].h2h.record, '0-1', 'control: a record without its own fixture is untouched');
  // Every build site excludes the fixture, and the final pass runs before matches.json is written (the model reads that file).
  assert.equal((PIPE.match(/const h2hRows = h2hExcludeOwn\(h2hData\.headToHead, fixture\.event_key\);/g) || []).length, 3, 'all three H2H build sites');
  assert.equal((PIPE.match(/match\.h2h = summarizeH2H\(h2hRows, p1Key\);\n\s*match\.h2h\.matches = buildH2HMatchList\(h2hRows, p1Key, surfaceMap\);/g) || []).length, 3, 'record and list both read the filtered rows, by key');
  assert.doesNotMatch(PIPE, /summarizeH2H\(h2hData\.headToHead|buildH2HMatchList\(h2hData\.headToHead/, 'no site feeds the unfiltered list');
  const pass = PIPE.indexOf('stripOwnFixtureFromH2H(matches);'), write = PIPE.indexOf("writeJsonAtomic('matches.json', matches);");
  assert.ok(pass > 0 && write > pass, 'final pass runs before the first matches.json write');
  assert.ok(PIPE.indexOf('buildModelOutput(matches)') > pass, 'and before the model');
});
test('H2H page: meetings are keyed and won by player key, never short name (ruling 2026-09-24)', () => {
  assert.match(html, /H2H2\[ka \+ '\|' \+ kb\] = \{/, 'today\'s meetings keyed by the two player keys');
  assert.match(html, /mt\.p1Won \? ka : kb,/, 'fixture meeting winner stored as a key');
  assert.match(html, /String\(aWon \? a\.key : b\.key\),/, 'history meeting winner stored as a key');
  assert.match(html, /const key = \[a\.key, b\.key\]\.join\('\|'\), rkey = \[b\.key, a\.key\]\.join\('\|'\);/, 'lookup by key pair');
  assert.match(html, /if \(r\[5\] === aK\) aw\+\+; else if \(r\[5\] === bK\) bw\+\+;/, 'record counted by key');
  assert.doesNotMatch(html, /r\[5\] === a\.short|m\[5\] === a\.short|H2H2\[sa \+/, 'control: no short-name winner or key remains');
});
test('H2H page: the career-history blend drops a finished board match between the pair (never in its own H2H), executed', () => {
  const src = slice('h2hFromHist');
  const run = (board, histA) => new Function('DV', 'H2H_ROUND', src + '\nreturn h2hFromHist;')(k => (k === 'matches' ? board : null), {})(
    { key: '1', short: 'A. One', full: 'Al One', tourHist: histA }, { key: '2', short: 'B. Two', full: 'Bo Two', tourHist: [] });
  const ed = (name, year, round, res) => ({ name, editions: [{ year, matches: [{ oppKey: '2', opp: 'B. Two', res, round, score: '2 - 0' }] }] });
  const hist = [ed('Chengdu', 2026, 'R32', 'W'), ed('Davis Cup WG2 R1: THA vs DEN', 2026, 'RR', 'L'), ed('Belgrade', 2021, 'R16', 'W'), ed('Chengdu', 2024, 'QF', 'L')];
  const fin = (tour, date, p1Key = 1, p2Key = 2) => ({ id: 'past-9', finalScore: '6-4 6-4', p1Key, p2Key, tour, date });
  // Nothing finished on the board: all four history meetings count.
  assert.equal(run([], hist).meetings.flatMap(y => y[1]).length, 4);
  // Today's finished Chengdu match (either orientation) is dropped; the 2024 Chengdu meeting survives.
  for (const b of [[fin('ATP Chengdu', '2026-09-23')], [fin('ATP Chengdu', '2026-09-23', 2, 1)]]) {
    const r = run(b, hist); const rows = r.meetings.flatMap(y => y[1]);
    assert.equal(rows.length, 3); assert.ok(!r.meetings.some(y => y[0] === '2026' && y[1].some(x => x[1] === 'Chengdu')), 'today\'s Chengdu row gone');
    assert.ok(r.meetings.some(y => y[0] === '2024'), 'the earlier Chengdu meeting survives');
  }
  // A Davis Cup tie: board and history name the stage differently.
  assert.equal(run([fin('ATP ATP Davis Cup - World Group II', '2026-09-20')], hist).meetings.flatMap(y => y[1]).length, 3, 'Davis Cup tie dropped');
  // Controls: a finished match between OTHER keys, an unfinished board match, and "Belgrade 2" v a Belgrade meeting drop nothing.
  assert.equal(run([fin('ATP Chengdu', '2026-09-23', 1, 3)], hist).meetings.flatMap(y => y[1]).length, 4, 'other pair');
  assert.equal(run([Object.assign(fin('ATP Chengdu', '2026-09-23'), { finalScore: null })], hist).meetings.flatMap(y => y[1]).length, 4, 'not finished');
  assert.equal(run([fin('ATP Belgrade 2', '2021-05-25')], hist).meetings.flatMap(y => y[1]).length, 4, 'Belgrade 2 is not Belgrade');
});
test('card / Key factors: a record with Challenger or ITF meetings says so; an all-ATP record says nothing', () => {
  const H = new Function(`${slice('h2hLevelMix')}\nreturn h2hLevelMix;`)();
  assert.equal(H({ matches: [{ level: 'ATP' }, { level: 'CH' }, { level: 'ITF' }, { level: 'ITF' }] }), ' · incl. 1 CH, 2 ITF');
  assert.equal(H({ matches: [{ level: 'ATP' }, {}] }), '', 'control: ATP-only (and pre-ruling rows) add nothing');
  assert.equal(H(null), '');
  assert.match(html, /· H2H \$\{m\.h2h\.record\}\$\{h2hLevelMix\(m\.h2h\)\}/, 'the match card shows the mix');
});
test('Key factors H2H block (the live one) shows the level mix: executed, not grepped', () => {
  const K = new Function(`
    const ANALYSIS_P1_COLOR = '#5b9bff', ANALYSIS_P2_COLOR = '#e7e9ee';
    const akHead = t => '<h>' + t + '</h>', akCard = (k, h) => h;
    const psEsc = x => String(x), psShortName = x => String(x);
    ${slice('h2hLevelMix')}\n${slice('akH2HBlock')}\nreturn akH2HBlock;`)();
  const mk = (level, won) => ({ date: '2024-01-0' + (won ? 1 : 2), tournament: 'X', result: '2 - 0', p1Won: won, level });
  const m = (rows) => ({ p1: 'A', p2: 'B', h2h: { p1Wins: rows.filter(r => r.p1Won).length, p2Wins: rows.filter(r => !r.p1Won).length, matches: rows } });
  assert.match(K(m([mk('ATP', true), mk('ITF', true), mk('CH', false)])), /3 career meetings · incl\. 1 CH, 1 ITF/);
  assert.doesNotMatch(K(m([mk('ATP', true), mk('ATP', false)])), /incl\./, 'control: an ATP-only record adds nothing');
});
test('H2H page: the record lines carry the level mix; each meeting row keeps its level', () => {
  assert.match(html, /meetingsLine: tot \+ ' meetings on record' \+ lvMix,/);
  assert.match(html, /Math\.min\(aw, bw\)\) \+ lvMix,/);
  assert.match(html, /mt\.level \|\| 'ATP',\n\s*\]\);/);
});
test('model H2H layer: the detail text names the level mix; the math is unchanged', () => {
  const { h2h } = require('./h2h-model/adjustments.js');
  const rows = [{ date: '2025-06-01', surface: 'hard', p1Won: true, result: '2 - 0', level: 'ATP' },
                { date: '2025-07-01', surface: 'hard', p1Won: true, result: '2 - 1', level: 'CH' }];
  const ctx = (rs) => ({ match: { date: '2026-09-24', h2h: { matches: rs } }, surface: 'hard' });
  const withLv = h2h(ctx(rows)), noLv = h2h(ctx(rows.map(({ level, ...r }) => r)));
  assert.match(withLv.detail, /H2H 2-0 \(2 meetings, incl\. 1 CH;/);
  assert.equal(withLv.deltaP1, noLv.deltaP1, 'the level changes the text, never the number');
  assert.doesNotMatch(noLv.detail, /incl\./);
});
test('the Form/H2H tab takes each api-tennis meeting\'s own level (pre-ruling rows stay ATP)', () => {
  const m = allLevels();
  m.h2h.matches = m.h2h.matches.concat([{ eventKey: 20, date: '2026-03-09', p1Won: false, result: '1 - 2', surface: 'hard', tournament: 'Cap Cana', round: 'Qualifying', level: 'CH' }]);
  const rows = S.fhAllMeetingRows(m);
  assert.deepEqual(rows.map(x => [String(x.eventKey), x._level]), [['10', 'ATP'], ['20', 'CH'], ['30', 'ITF']]);
  assert.equal(m._fhMeetDupes, 2, 'the CH meeting in both sources counts once');
});
// c · the set-1 mirror pair never counts one meeting twice.
test('set-1 mirror pair: the two lines are complements over the same meetings', () => {
  const mk = (s1) => S.fhFinishRow({ mid: Math.random().toString(36), won: s1[0] > s1[1], sets: [s1, [6, 3, null]], ret: false, wo: false, tourn: 'Umag', tier: 'atp', result: '2 - 0' });
  const rows = [mk([6, 4, null]), mk([4, 6, null]), mk([7, 6, 5]), mk([3, 6, null])];
  const d = S.fhH2hLineDefs('Sinner', 'Alcaraz'); const A = d.find(x => x.name === 'Sinner wins set 1'), B = d.find(x => x.name === 'Alcaraz wins set 1');
  assert.ok(A && B && S.consts.FH_H2H_SET1_MIRROR === true);
  const el = rows.filter(r => S.fhEligible(r, A));
  assert.equal(el.filter(A.cov).length + el.filter(B.cov).length, el.length);
  assert.equal(el.filter(r => A.cov(r) && B.cov(r)).length, 0);
});
test('market-edge per run: a player already published but off the board roster is rebuilt, not left stale', () => {
  const { execFileSync } = require('node:child_process');
  const root = mkdtempSync(join(tmpdir(), 'ten263me-'));
  try {
    for (const f of ['build-market-edge.js', 'build-odds-performance.js']) writeFileSync(join(root, f), readFileSync(join(HERE, f)));
    mkdirSync(join(root, 'odds-archive')); mkdirSync(join(root, 'market-edge'));
    const H = 'date,tournament,series,court,surface,round,bestof,winner,loser,wrank,lrank,comment,b365w,b365l,psw,psl,maxw,maxl,avgw,avgl,avgsrc';
    writeFileSync(join(root, 'odds-archive', '2025.csv'), [H,
      '2025-10-12,Shanghai Masters,Masters 1000,Outdoor,Hard,Semifinals,3,Sinner J.,Alcaraz C.,1,2,Completed,1.5,2.6,1.55,2.55,1.6,2.7,1.52,2.55,file',
      '2025-05-02,Madrid Masters,Masters 1000,Outdoor,Clay,Quarterfinals,3,Alcaraz C.,Sinner J.,2,1,Completed,1.8,2.0,1.85,2.05,1.9,2.1,1.82,2.02,file'].join('\n') + '\n');
    writeFileSync(join(root, 'player-profiles.json'), JSON.stringify({ players: { 5: { name: 'J. Sinner' } } }));
    writeFileSync(join(root, 'market-edge', '6.json'), JSON.stringify({ name: 'C. Alcaraz', stale: true, matches: [] }));
    execFileSync(process.execPath, ['build-market-edge.js', '--quiet'], { cwd: root });
    const alc = JSON.parse(readFileSync(join(root, 'market-edge', '6.json'), 'utf8'));
    assert.ok(!alc.stale, 'the off-roster shard was rewritten');
    assert.equal(alc.matches.length, 2, 'both archive matches joined to the published player');
    const idx = JSON.parse(readFileSync(join(root, 'market-edge-index.json'), 'utf8'));
    assert.deepEqual(Object.keys(idx.players).sort(), ['5', '6']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
