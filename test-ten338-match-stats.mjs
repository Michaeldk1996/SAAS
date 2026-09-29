// TEN-338 (TEN-312 Match Stats tab, founder 2026-09-28 / 2026-09-29) — the tab rebuilt on the design file.
// Every check drives the page's REAL code (the TEN-263 block + the tab's own builders, sliced out of
// bsp-consult-dashboard.html and executed) and names the mutation that turns it red; tools/test-ten338-mutants.js applies
// each one to a copy of the page (TEN338_HTML).
//   · an uncompleted match draws the file's "Match not played yet" block (DF L2079); a live one the same block, honestly
//     titled (DESIGN GAP G15); a finished one THE shared sheet, inline
//   · Points won carries the file's "Winners / unforced errors" row (DF L4272), the same cell Key stats shows
//   · D2: every % in the sheet goes through tourxSampleGate on its own count (n < 5 count only, 5–9 grey + footnote)
//   · point by point is drawn as the file draws it (DF L2150–2195): "SET n · a-b", games, LOST SERVE, BP, the tiebreak
//     strip and its points with SP while the leader is one point from the set (10-point tiebreaks too)
//   · the sheet header: surface capitalised, a dash for a missing round (four parts, DF L4859)
//   · DoD 8: the tab draws no match rows and no tooltip of its own; the old stat-sheet path is deleted
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN338_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const HOUSE_RATINGS_SRC = readFileSync(join(HERE, 'house-ratings.js'), 'utf8');
globalThis.MarketEdgeCore = createRequire(import.meta.url)(join(HERE, 'market-edge-core.js'));
function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let d = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; }
  return html.slice(start, i + 1);
}
function block() {
  const a = html.indexOf('/* =====================================================================\n   TEN-263 ');
  const b = html.indexOf('/* ---------- TOURNAMENT SUB-TAB ---------- */');
  assert.ok(a > 0 && b > a, 'TEN-263 block not found');
  return html.slice(a, b);
}
const consts = (re) => { const m = re.exec(html); assert.ok(m, 'constant not found: ' + re); return m[0]; };
const PS_TOUR_META_SRC = /const PS_TOUR_META = \(\(\) => \{[\s\S]*?\n\}\)\(\);/.exec(html)[0];
const S = new Function(`
  const document = { addEventListener(){}, getElementById(){ return null; }, querySelector(){ return null; }, querySelectorAll(){ return []; },
    head: { appendChild(){} }, createElement(){ return { set textContent(v){} }; } };
  const playerProfiles = {};
  function formPanelHtml(){ return ''; } function ensureFormPanelTabs(){}
  function ensureFormRows(m){ return Promise.resolve(m); } function loadCareerHistory(){ return Promise.resolve([]); }
  function ensureStyleMeetings(m){ return Promise.resolve(m); } function ensurePsMatrix(){ return Promise.resolve(); }
  function ppStyleFor(){ return null; } function psArchFor(){ return null; } function styleMeetRowsFor(){ return []; }
  function openPlayerProfileFromMatch(){} function aGoTab(){}
  function aAvatarHtml(n){ return '<i>' + n + '</i>'; } function _mcCloseOf(m, w){ return m.closingOdds ? m.closingOdds[w] : null; }
  const HouseRatings = (function(){ const window = {}; ${HOUSE_RATINGS_SRC}; return window.HouseRatings; })();
  ${PS_TOUR_META_SRC}
  ${['escapeHtml', 'surnameFirstName', 'psShortName', 'formIni', 'ppCleanTournamentName', 'psNormTour', 'psTourMeta', 'psRoundAbbr', 'h2hRoundLabel', 'eventKeyOfMatch',
     'pbpParseScore', 'pbpSplitSet'].map(slice).join('\n')}
  ${block()}
  ${consts(/const MA_MS_NOT_PLAYED = [^\n]*\n/)}${consts(/const MA_MS_NOT_PLAYED_SUB = [^\n]*\n/)}
  ${['maMsNotPlayedHtml', 'maMsSheetEntry', 'maMsSheetHtml', 'buildMatchStatsSection'].map(slice).join('\n')}
  return { fhSheetModel, fhSheetKeyModel, fhSheetStatsHtml, fhGateCell, fhPbpSetModel, fhSheetPbpHtml, fhSheetHeadHtml, maMsSheetEntry, buildMatchStatsSection };
`)();
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// A box-score side in the api-tennis shape the sheet reads; `o` overrides counts / raw pairs.
function SIDE(o) {
  const raw = { 'Service:1st serve points won': { won: 40, total: 50 }, 'Service:2nd serve points won': { won: 15, total: 30 },
    'Service:Break Points Saved': { won: 4, total: 6 }, 'Return:1st return points won': { won: 12, total: 48 }, 'Return:2nd return points won': { won: 14, total: 28 },
    'Return:Break Points Converted': { won: 3, total: 12 }, 'Points:Total Points Won': { won: 81, total: 156 }, 'Points:Service Points Won': { won: 55, total: 80 },
    'Points:Return Points Won': { won: 26, total: 76 }, 'Games:Service games won': { won: 10, total: 12 }, 'Games:Return games won': { won: 3, total: 12 } };
  const s = { 'Service:Aces': 9, 'Service:Double Faults': 2, 'Points:Winners': 30, 'Points:Unforced errors': 20, raw };
  for (const [k, v] of Object.entries(o || {})) { if (v && typeof v === 'object') raw[k] = v; else s[k] = v; }
  return s;
}
const row = (M, label) => M.sections.flatMap(sec => sec.rows).find(r => r.label === label);

// Mutation: the uncompleted branch back to the old "Box score isn't available" line, or the live title dropped.
test('uncompleted match: the file\'s "Match not played yet" block; live: the same block titled "Match in progress" (G15); finished: the sheet', () => {
  const up = S.buildMatchStatsSection({ id: 'upcoming-1', p1: 'A', p2: 'B', live: false, finalScore: null });
  assert.match(up, /class="ma-ms-notplayed"/);
  assert.equal(text(up), 'Match not played yet Full match statistics and the point-by-point breakdown appear here once the match is completed.');
  assert.match(up, /<path d="M5 20V10M12 20V4M19 20v-7"><\/path>/, 'the file\'s chart glyph');
  const live = S.buildMatchStatsSection({ id: 'live-1', p1: 'A', p2: 'B', live: true, finalScore: null });
  assert.match(text(live), /^Match in progress /, 'a live match is not "not played"');
  assert.match(slice('maMsNotPlayedHtml') + html.slice(html.indexOf('function buildMatchStatsSection('), html.indexOf('function maMsNotPlayedHtml(')), /DESIGN GAP G15/);
  const done = S.buildMatchStatsSection({ id: 'past-5', p1: 'A', p2: 'B', finalScore: { sets: [{ p1: 6, p2: 4 }, { p1: 6, p2: 3 }], p1Sets: 2, p2Sets: 0, winner: 'p1' } });
  assert.match(done, /class="ma-ms-sheet"/); assert.match(done, /id="maMsSheetBody"/);
  assert.match(html, /\.modal-analysis #aSectionMatchStats:has\(> \.ma-ms-notplayed\)\{ height:100%; \}/, 'the block is centred in the whole pane (DF height:100%)');
});

// Mutation: the Winners / unforced errors row removed from Points won, or Key stats computing its own copy.
test('Points won carries the file\'s "Winners / unforced errors" row (DF L4272), the same cell as Key stats', () => {
  const M = S.fhSheetModel({ own: SIDE(), opp: SIDE({ 'Points:Winners': 12, 'Points:Unforced errors': 0 }) });
  const labels = M.sections[2].rows.map(r => r.label);
  assert.deepEqual(labels.slice(0, 4), ['Winners', 'Unforced errors', 'Winners / unforced errors', 'Net points won']);
  const w = row(M, 'Winners / unforced errors');
  assert.deepEqual([w.a.txt, w.a.sub, w.kind], ['1.50', '(30/20)', 'ratio']);
  assert.deepEqual([w.b.txt, w.b.title], ['—', 'No unforced errors'], '0 errors → a dash with its reason, never ∞');
  const K = S.fhSheetKeyModel({ own: SIDE(), opp: SIDE({ 'Points:Winners': 12, 'Points:Unforced errors': 0 }) }).find(r => r.label === 'Winners / unforced errors');
  assert.deepEqual([K.a, K.b], [w.a, w.b], 'Key stats reads the same cells');
  const none = S.fhSheetModel({ own: SIDE({ 'Points:Winners': 0, 'Points:Unforced errors': 0 }), opp: SIDE({ 'Points:Winners': 0, 'Points:Unforced errors': 0 }) });
  assert.equal(row(none, 'Winners / unforced errors').a.txt, '—', 'a feed that sent no winners / errors → dash');
});

// Mutation: the gate dropped from the sheet rows (fhGateCell not applied), or the footnote dropped.
test('D2: every % in the sheet goes through tourxSampleGate on its own count; n 1–4 count only, 5–9 grey + footnote, 10+ as is', () => {
  const M = S.fhSheetModel({ own: SIDE({ 'Service:Break Points Saved': { won: 2, total: 3 } }), opp: SIDE() });
  const bps = row(M, 'Break points saved');
  assert.deepEqual([bps.a.txt, bps.a.v, bps.a.sub, bps.a.gate], ['2/3', null, '', 'nopct'], 'n = 3: the count, no %');
  assert.deepEqual([bps.b.txt, bps.b.sub, bps.b.gate], ['66.7%', '(4/6)', 'small'], 'n = 6: the rate, flagged small');
  assert.match(bps.b.title, /small sample · n=6/);
  const bpc = row(M, 'Break points converted');
  assert.equal(bpc.a.gate, undefined, 'n = 12: full');
  assert.equal(row(M, 'Pressure points').a.won, 2 + 3, 'Pressure still sums the gated rows\' counts');
  assert.equal(S.fhGateCell({ v: null, txt: '—', sub: '', zero: true }).txt, '—', 'n = 0 stays a dash');
  const h = S.fhSheetStatsHtml({ own: SIDE({ 'Service:Break Points Saved': { won: 2, total: 3 } }), opp: SIDE() });
  assert.match(h, /data-ma-gate="nopct"[^>]*>2\/3</); assert.match(h, /data-ma-gate="small"/);
  assert.match(h, /class="ma-sheet-gate"[^>]*>Grey: small sample \(5–9\)\. Under 5: the count only, no %\.</);
  const full = S.fhSheetStatsHtml({ own: SIDE({ 'Service:Break Points Saved': { won: 8, total: 10 } }), opp: SIDE({ 'Service:Break Points Saved': { won: 8, total: 10 }, 'Return:Break Points Converted': { won: 3, total: 12 } }) });
  assert.ok(!/ma-sheet-gate/.test(full), 'no gated rate → no footnote');
});

// Point-by-point fixture: api-tennis shard shape, set 1 = 6-6 then a 7-point tiebreak A wins 7-5.
function tbSet(set, games, pts) {
  const g = []; let a = 0, b = 0, n = 0;
  for (const [srv, win] of games) { if (win === 'p1') a++; else b++; g.push({ g: ++n, server: srv, winner: win, score: a + ' - ' + b, points: [{ n: 1, s: '15 - 0' }, { n: 2, s: '30 - 0', bp: srv === 'p2' && win === 'p1' }] }); }
  let x = 0, y = 0;
  for (const [srv, win] of pts) { if (win === 'p1') x++; else y++; g.push({ g: ++n, server: srv, winner: win, score: x + ' - ' + y, points: [] }); }
  return { set, games: g };
}
const HOLDS = Array.from({ length: 12 }, (_, i) => [i % 2 ? 'p2' : 'p1', i % 2 ? 'p2' : 'p1']);
// Mutation: SP back to the old "max ≥ target − 1" rule (6-5 missed after a 7-7), the caption loses its score, or a lost serve read off the wrong side.
test('point by point is the file\'s shape: "SET n · a-b", games with LOST SERVE / BP, the tiebreak strip and SP while the leader is one point away', () => {
  // a 7-point tiebreak that runs long: … 5-5, 6-5, 6-6, 7-6, 7-7, 8-7, 9-7 (server: A, then two each)
  const tbW = ['p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p1'];
  const tb7 = tbW.map((w, i) => [i === 0 ? 'p1' : Math.floor((i + 1) / 2) % 2 ? 'p2' : 'p1', w]);
  const games = HOLDS.slice(); games[3] = ['p2', 'p1']; games[4] = ['p1', 'p2'];   // a break each way
  const M = S.fhPbpSetModel(tbSet(1, games, tb7));
  assert.equal(M.label, 'SET 1 · 7-6');
  assert.equal(M.games.length, 12);
  assert.deepEqual([M.games[3].bLost, M.games[3].aWon, M.games[4].aLost], [true, true, true]);
  assert.equal(M.games[3].points[1].bp, true); assert.equal(M.games[0].points[0].txt, '15:0');
  assert.equal(M.tb.label, 'Tiebreak · Set 1');
  const sp = M.tb.pts.filter(p => p.spA || p.spB).map(p => p.a + '-' + p.b);
  assert.deepEqual(sp, ['6-5', '7-6', '8-7'], 'SP whenever the leader can win the set on the next point, past 6-6 too');
  assert.ok(M.tb.pts.every((p, i) => p.aLost === (tb7[i][0] === 'p1' && tb7[i][1] === 'p2') && p.bLost === (tb7[i][0] === 'p2' && tb7[i][1] === 'p1')), 'a mini-break is a LOST SERVE');
  const h = S.fhSheetPbpHtml(M);
  assert.equal((h.match(/>LOST SERVE</g) || []).length, 2 + M.tb.pts.filter(p => p.aLost || p.bLost).length);
  assert.equal((h.match(/>SP</g) || []).length, 3); assert.ok(!/>MP</.test(h), 'the file tags SP in every set');
  assert.match(h, /class="ma-pbp-tbhead"[^>]*>Tiebreak · Set 1</);
  // a 10-point tiebreak (a score before the end already had 7+ with a 2-point lead): 6-5 is not a set point, 9-8 is
  const tb10 = []; for (let i = 0; i < 7; i++) tb10.push(['p1', 'p1']); for (let i = 0; i < 8; i++) tb10.push(['p2', 'p2']); tb10.push(['p1', 'p1'], ['p1', 'p1'], ['p2', 'p2'], ['p1', 'p1']);   // 7-0 … 7-8, 9-8, 9-9? no: 8-8, 9-8, 9-9, 10-9 → keep A two clear at the end
  const M10 = S.fhPbpSetModel(tbSet(3, HOLDS, tb10.concat([['p1', 'p1']])));
  const sp10 = M10.tb.pts.filter(p => p.spA || p.spB).map(p => p.a + '-' + p.b);
  assert.ok(!sp10.includes('6-0') && sp10.includes('9-8'), '10-point tiebreak: ' + sp10.join(' '));
  const plain = S.fhPbpSetModel({ set: 2, games: HOLDS.slice(0, 10).map((g, i) => ({ g: i + 1, server: g[0], winner: g[1], score: Math.ceil((i + 1) / 2) + ' - ' + Math.floor((i + 1) / 2), points: [{ n: 1, s: '15 - 0' }] })) });
  assert.equal(plain.tb, null); assert.equal(plain.label, 'SET 2 · 5-5');
});

// Review fixes (clean-context review, 2026-09-29). Mutation: the caption back to "7-6 whenever there is a tiebreak", a set
// with no games not read as a 10-point match tiebreak, or the feed-order note dropped.
test('point by point edge cases: a retirement inside a tiebreak, a match tiebreak, a log whose order cannot be settled (G16)', () => {
  const ret = S.fhPbpSetModel(tbSet(2, HOLDS, [['p1', 'p1'], ['p2', 'p1'], ['p2', 'p2'], ['p1', 'p2'], ['p1', 'p1']]));   // 3-2 when play stopped
  assert.equal(ret.label, 'SET 2 · 6-6', 'an unfinished tiebreak keeps the games as they stood');
  // a match tiebreak (no games) that stays close: …6-6, 7-6, 7-7, 8-7, 8-8, 9-8, 10-8
  const mw = ['p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p1'];
  const mtb = S.fhPbpSetModel(tbSet(3, [], mw.map((w, i) => [i % 2 ? 'p2' : 'p1', w])));
  assert.equal(mtb.label, 'SET 3 · 10-8', 'a match tiebreak shows its points');
  assert.deepEqual(mtb.tb.pts.filter(p => p.spA || p.spB).map(p => p.a + '-' + p.b), ['9-8'], 'only 9-8 is a set point in a 10-point tiebreak');
  const R = slice('fhSheetRender');
  assert.match(R, /fhPbpAIsFirst\(S\.pbp, S\) === null \? `<span class="ma-pbp-order"/, 'the undecided order is said under the set tabs');
  assert.match(R, /DESIGN GAP G16/);
  assert.match(html, /const MA_PBP_FEED_ORDER = \(p1, p2\) => `Point log in the feed's order: \$\{p1 \|\| 'player 1'\} left, \$\{p2 \|\| 'player 2'\} right\.`;/);
});

// Mutation: the tab's surface back to the raw feed word, or a missing round dropped from the meta.
test('sheet header: surface capitalised, a dash where the round is missing (four parts, DF L4859)', () => {
  const E = S.maMsSheetEntry({ id: 'past-9', p1: 'A. Zverev', p2: 'L. Tien', tour: 'ATP Laver Cup', surface: 'hard', tournamentRound: '', date: '2026-09-27',
    finalScore: { sets: [{ p1: 7, p2: 6 }, { p1: 6, p2: 3 }], p1Sets: 2, p2Sets: 0, winner: 'p1' } });
  assert.equal(E.r.surface, 'Hard');
  const meta = text(S.fhSheetHeadHtml(E.e, E.r, { inline: true })).split(' A. Zverev')[0];
  assert.equal(meta, 'ATP Laver Cup · Hard · — · Sep 27, 2026');
});

// Mutation: a tab-local stat sheet (buildMatchStatsSheet) or row / tooltip renderer back in the tab.
test('DoD 8: the tab draws no match rows or tooltips of its own, and the old stat-sheet path is deleted', () => {
  const src = ['buildMatchStatsSection', 'maMsSheetHtml', 'maMsSheetInit', 'maMsNotPlayedHtml'].map(slice).join('\n');
  assert.ok(!/maMatchRowsHtml|maTipHtml|elotip|<table/.test(src), 'no rows, no tooltip');
  for (const gone of ['buildMatchStatsSheet', 'msheetDerived', 'msheetRowHtml', 'buildMsScoreHead', 'switchMatchStatsTab', 'switchStatsSet', 'ensurePointByPoint'])
    assert.ok(!html.includes(`function ${gone}(`), gone + ' is deleted');
  assert.match(slice('fhSheetRender'), /fhSheetPbpHtml\(fhPbpSetModel\(st\)\)/, 'the sheet\'s point log is the file-shaped renderer');
});
