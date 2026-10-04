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
//   · TEN-349 (founder ruling Q6, 2026-09-29): MP on every match point — a tiebreak point or a normal game's game point
//     that would win the match — and SP for a set point that would not; no tag where the log can't decide
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
  function aAvatarHtml(n){ return '<i>' + n + '</i>'; } function _mcCardCloseOf(m, w){ return m.closingOdds ? m.closingOdds[w] : null; } function _mcCloseOf(m, w){ return m.closingOdds ? m.closingOdds[w] : null; }
  const HouseRatings = (function(){ const window = {}; ${HOUSE_RATINGS_SRC}; return window.HouseRatings; })();
  ${PS_TOUR_META_SRC}
  ${['escapeHtml', 'surnameFirstName', 'psShortName', 'formIni', 'ppCleanTournamentName', 'psNormTour', 'psTourMeta', 'psRoundAbbr', 'h2hRoundLabel', 'maRoundName', 'eventKeyOfMatch',
     'pbpParseScore', 'pbpSplitSet'].map(slice).join('\n')}
  ${block()}
  ${consts(/const MA_MS_NOT_PLAYED = [^\n]*\n/)}${consts(/const MA_MS_NOT_PLAYED_SUB = [^\n]*\n/)}
  ${['maMsNotPlayedHtml', 'maMsSheetEntry', 'maMsSheetHtml', 'buildMatchStatsSection'].map(slice).join('\n')}
  return { fhSheetModel, fhSheetKeyModel, fhSheetStatsHtml, fhGateCell, fhPbpSetModel, fhPbpMatchCtx, fhSheetPbpHtml, fhSheetHeadHtml, maMsSheetEntry, buildMatchStatsSection };
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
  const M10 = S.fhPbpSetModel(tbSet(3, HOLDS, tb10.concat([['p1', 'p1']])), { a: 1, b: 1, need: 3 });   // Bo5 set 3 at 1–1: set points, not match points
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
  const mtb = S.fhPbpSetModel(tbSet(3, [], mw.map((w, i) => [i % 2 ? 'p2' : 'p1', w])), { a: 1, b: 1, need: 3 });
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
  assert.match(slice('fhSheetRender'), /fhSheetPbpHtml\(fhPbpSetModel\(st, fhPbpMatchCtx\(sh, S\.bo\)\[st\.set\]\)\)/, 'the sheet\'s point log is the file-shaped renderer');
});

// TEN-349 fixtures: a set from its games ([server, winner, point scores?]) and, optionally, tiebreak point winners.
function logSet(set, games, tbWin) {
  const g = []; let a = 0, b = 0, n = 0;
  for (const [srv, win, pts] of games) { if (win === 'p1') a++; else b++; g.push({ g: ++n, server: srv, winner: win, score: a + ' - ' + b, points: (pts || ['15 - 0', '30 - 0']).map((s, i) => ({ n: i + 1, s })) }); }
  let x = 0, y = 0;
  for (const w of tbWin || []) { if (w === 'p1') x++; else y++; g.push({ g: ++n, server: 'p1', winner: w, score: x + ' - ' + y, points: [] }); }
  return { set, games: g };
}
const srv = i => i % 2 ? 'p2' : 'p1';
// games from a winners string ("AB…"), servers alternating from A; `pts` = { gameIndex: [point scores] }
const G = (ws, pts = {}) => [...ws].map((c, i) => [srv(i), c === 'A' ? 'p1' : 'p2', pts[i]]);
const S63A = G('ABABABAAA'), S63B = G('ABABABBBB');   // A 6-3 (break at 7th), B 6-3
const tags = M => ({
  games: M.games.flatMap(g => g.points.filter(p => p.mp).map(p => p.txt)),
  mp: M.tb ? M.tb.pts.filter(p => p.mpA || p.mpB).map(p => p.a + '-' + p.b + (p.mpA ? 'A' : 'B')) : [],
  sp: M.tb ? M.tb.pts.filter(p => p.spA || p.spB).map(p => p.a + '-' + p.b + (p.spA ? 'A' : 'B')) : [] });
const model = (log, n, bo) => S.fhPbpSetModel(log.sets[n - 1], S.fhPbpMatchCtx(log, bo)[n]);
// Games alternate serve from A and are holds unless the string says otherwise, so game 10 (index 9) is B serving at 4-5.
// Bo3, A wins 7-6 3-6 7-6. Set 1: A's game point on B's serve at 5-4 (a set point: games carry no SP, so no tag) and
// A at 6-5 in the tiebreak (SP). Set 3: A's break/match points at 5-4 on B's serve (40:15, 40:30; B saves, and 40:A is
// B's game point for 5-5, no tag), A's 40:0 at 5-5 (6-5 is not the set, no tag), then a tiebreak with B at match point
// 5-6 before A wins 8-6.
const TB1 = ['p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p1'];    // … 5-5, 6-5, 7-5
const TB3 = ['p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p2', 'p1', 'p1', 'p1'];   // … 5-5, 5-6, 6-6, 7-6, 8-6
const BO3 = { p1: 'A', p2: 'B', sets: [
  logSet(1, G('ABABABABABAB', { 9: ['0 - 15', '15 - 15', '30 - 15', '40 - 15'] }), TB1),
  logSet(2, S63B),
  logSet(3, G('ABABABABABAB', { 9: ['0 - 15', '15 - 15', '30 - 15', '40 - 15', '40 - 30', '40 - 40', '40 - A'], 10: ['15 - 0', '30 - 0', '40 - 0'] }), TB3),
] };
// Bo5, A leads 2–1 into set 4: at 5-4 A reaches advantage on B's serve (A:40 → MP; 15:40 is B's game point for 5-5, no
// tag), B holds; in the tiebreak B's 5-6 is a set point for the trailing player (it would square the match: SP), A's 7-6
// is a match point.
const BO5 = { p1: 'A', p2: 'B', sets: [
  logSet(1, S63A), logSet(2, S63B), logSet(3, S63A),
  logSet(4, G('ABABABABABAB', { 9: ['15 - 0', '15 - 15', '15 - 30', '15 - 40', '30 - 40', '40 - 40', 'A - 40', '40 - 40', '40 - A'], 10: ['15 - 0', '30 - 0', '40 - 0'] }),
    ['p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p2', 'p1', 'p1', 'p1']),   // … 5-5, 5-6 (B SP), 6-6, 7-6 (A MP), 8-6
] };

// Mutations (tools/test-ten338-mutants.js, "MP: …"): games never tagged → no MP at 5-4 of the decider; every set point
// read as MP (no sets-needed check) → set 1's SP becomes MP; the tiebreak MP drawn as SP → the html loses its MP chips;
// "two clear" dropped from the game's set point → A's 40-0 at 5-5 tagged.
test('TEN-349 Bo3: MP in the decider (a game point on the opponent\'s serve and inside the tiebreak, either player); set 1 stays SP', () => {
  const s1 = model(BO3, 1, 3), s3 = model(BO3, 3, 3);
  assert.deepEqual(tags(s1), { games: [], mp: [], sp: ['6-5A'] }, 'set 1: a set point, never a match point; a game point is not tagged');
  assert.deepEqual([s3.games[9].serverB, s3.games[9].gA, s3.games[9].gB], [true, 5, 5], 'fixture: B serves game 10 at 5-4 and holds');
  assert.deepEqual(tags(s3), { games: ['40:15', '40:30'], mp: ['5-6B', '7-6A'], sp: [] }, 'set 3 (1–1): every set point wins the match');
  const h = S.fhSheetPbpHtml(s3);
  assert.equal((h.match(/>MP</g) || []).length, 4); assert.ok(!/>SP</.test(h));
  assert.equal((S.fhSheetPbpHtml(s1).match(/>SP</g) || []).length, 1);
});
// Mutations: sets won read off the wrong side → A's 2–1 lead counted as 1 (no MP at 5-4 / 7-6) and B's 6-5 turns MP;
// need fixed at 2 (a Bo5 read as Bo3) → the trailing player's SP becomes MP.
test('TEN-349 Bo5: A leading 2–1 has match points in set 4 (game and tiebreak); B\'s set point there stays SP', () => {
  const s4 = model(BO5, 4, 5);
  assert.deepEqual(tags(s4), { games: ['A:40'], mp: ['7-6A'], sp: ['5-6B'] });
  assert.deepEqual(S.fhPbpMatchCtx(BO5, 5)[4], { a: 2, b: 1, need: 3 });
  const h = S.fhSheetPbpHtml(s4);
  assert.equal((h.match(/>MP</g) || []).length, 2); assert.equal((h.match(/>SP</g) || []).length, 1);
});
// Mutations: an unknown format guessed as Bo3 → set 3 of a format-less 3-set log tags MP; a set whose winner can't be read
// still counted → the sets after it get a 0–0 count instead of none.
test('TEN-349: no tag where the log cannot decide — format unknown, or an earlier set with no winner', () => {
  assert.equal(S.fhPbpMatchCtx(BO3, null)[3].need, null, 'three sets, nobody on three: Bo3 or Bo5 is not in the log');
  assert.equal(S.fhPbpMatchCtx(BO5, null)[4].need, 3, 'four sets: the log itself says Bo5');
  assert.deepEqual(tags(model(BO3, 3, null)), { games: [], mp: [], sp: [] }, 'could be MP or SP: no tag');
  assert.deepEqual(tags(model(BO3, 1, null)), { games: [], mp: [], sp: ['6-5A'] }, 'set 1 is 0–0 whatever the format');
  const cut = { sets: [logSet(1, G('ABABABABABAB'), ['p1', 'p2', 'p1']), BO3.sets[1], BO3.sets[2]] };   // set 1's tiebreak stops at 2-1
  const c = S.fhPbpMatchCtx(cut, 3);
  assert.deepEqual([c[2].a, c[3].a], [null, null], 'no winner for set 1: nothing after it is counted');
  assert.deepEqual(tags(S.fhPbpSetModel(cut.sets[2], c[3])), { games: [], mp: [], sp: [] });
  assert.match(slice('fhSheetInit'), /bo: r\.bo \|\| fhBestOf\(r\),/, 'the sheet keeps the row\'s format, else the Form rows\' rule (the tab\'s rows have none)');
});

// Review fixes (clean-context review, 2026-09-29). Mutations: a Bo5 fifth-set tiebreak read as 7 points → a close Slam decider
// tags MP at 6-5, 7-6, 8-7; the set winner read off T → a repeated tiebreak point (read as a 10-pointer) loses set 1 and
// every later set goes untagged.
test('TEN-349: a Bo5 fifth-set tiebreak is 10 points; a repeated tiebreak point does not lose the set', () => {
  const five = { sets: [BO5.sets[0], BO5.sets[1], BO5.sets[2], logSet(4, S63B), logSet(5, G('ABABABABABAB'), ['p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1', 'p1'])] };   // …8-8, 9-8, 10-8
  const s5 = model(five, 5, 5);
  assert.deepEqual(tags(s5), { games: [], mp: ['9-8A'], sp: [] }, 'at 2–2 only 9-8 is a match point in a 10-point decider');
  assert.equal(s5.label, 'SET 5 · 7-6');
  const dup = JSON.parse(JSON.stringify(BO3)); const g1 = dup.sets[0].games; g1.splice(g1.length - 1, 0, JSON.parse(JSON.stringify(g1[g1.length - 1])));   // 7-5 twice
  assert.deepEqual(S.fhPbpMatchCtx(dup, 3)[3], { a: 1, b: 1, need: 2 }, 'set 1 still counted for A');
  assert.deepEqual(tags(model(dup, 3, 3)).mp, ['5-6B', '7-6A']);
});

// TEN-380 (step 3 reference, README §10): sheet --card + --edge-6; both players --text; row labels --text-label; bars
// --bar (A) / --bar-2 (B) on a --track half, 6px, outer radius 3, gap 2; DR and W/UE stay numbers only (Q6 parked).
// Mutation: player B's values back to grey, or a fill back on the white bars / --inner track.
test('TEN-380: sheet frame, neutral values, labels --text-label, bars --bar / --bar-2 on --track (6px, r3, gap 2)', () => {
  const h = S.fhSheetStatsHtml({ own: SIDE(), opp: SIDE({ 'Points:Winners': 12 }) });
  const pairs = [...h.matchAll(/<div style="display:grid; grid-template-columns:1fr 1fr; gap:2px;">\s*<span class="fh-shalf" style="display:flex; justify-content:flex-end; height:6px; background:var\(--track\); border-radius:3px 0 0 3px; overflow:hidden;">(?:<span class="fh-sbar" style="height:6px; width:([\d.]+)%; background:([^;]+);"><\/span>)?<\/span>\s*<span class="fh-shalf" style="display:flex; height:6px; background:var\(--track\); border-radius:0 3px 3px 0; overflow:hidden;">(?:<span class="fh-sbar" style="height:6px; width:([\d.]+)%; background:([^;]+);"><\/span>)?<\/span>/g)];
  assert.ok(pairs.length > 5, 'every row draws the 6px --track halves');
  // founder Q3 (ruling 8): leader solid --bar, trailer --bar-2 (45%); a tie or a lone bar is solid
  // the same rows with the players swapped, so player A trails somewhere: the trailer is 45% whichever side it is on
  const h2 = S.fhSheetStatsHtml({ own: SIDE({ 'Points:Winners': 12 }), opp: SIDE() });
  const pairs2 = [...h2.matchAll(/<span class="fh-sbar" style="height:6px; width:([\d.]+)%; background:([^;]+);"><\/span><\/span>\s*<span class="fh-shalf"[^>]*>(?:<span class="fh-sbar" style="height:6px; width:([\d.]+)%; background:([^;]+);"><\/span>)/g)];
  const both = pairs.filter(p => p[1] && p[3]).concat(pairs2);
  assert.ok(both.some(p => +p[1] > +p[3]) && both.some(p => +p[1] < +p[3]), 'a row where A leads and one where A trails');
  for (const p of both) {
    const [aw, ac, bw, bc] = [+p[1], p[2], +p[3], p[4]];
    if (p[2] === 'var(--text-label)' || p[4] === 'var(--text-label)') continue;   // a 5–9 small sample is grey (D2)
    assert.equal(ac, aw < bw ? 'var(--bar-2)' : 'var(--bar)', 'A: ' + p[0].slice(0, 0));
    assert.equal(bc, bw < aw ? 'var(--bar-2)' : 'var(--bar)');
  }
  assert.ok(!/var\(--fh-pb\)|var\(--fh-pa\)|70%, transparent|var\(--text-soft\)/.test(h), 'no grey player B, no white bars, no --text-soft');
  assert.ok([...h.matchAll(/class="fh-slabel" style="([^"]*)"/g)].every(x => /color:var\(--text-label\)/.test(x[1])), 'row labels --text-label');
  const K = S.fhSheetKeyModel({ own: SIDE(), opp: SIDE() });
  assert.deepEqual(K.filter(r => r.kind === 'ratio').map(r => r.label), ['Dominance ratio', 'Winners / unforced errors'], 'Q6: DR and W/UE stay numbers only');
  const done = S.buildMatchStatsSection({ id: 'past-1', p1: 'A. Zverev', p2: 'B. C', p1Key: 1, p2Key: 2, finalScore: { sets: [{ p1: 6, p2: 4 }] }, date: '2026-07-18', tour: 'ATP Washington' });
  assert.match(done, /class="ma-ms-sheet" style="max-width:760px; margin:0 auto; background:var\(--card\); border:1px solid var\(--edge-6\);/);
});
