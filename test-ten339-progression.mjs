// TEN-339 (TEN-312 Progression tab, founder brief 2026-09-28 / DoD item 8 2026-09-29) — the Progression tab rebuilt on the
// design file. Every check drives the page's REAL code (the TEN-263 block + the TEN-339 block sliced out of
// bsp-consult-dashboard.html and executed) and names the mutation that turns it red; tools/test-ten339-mutants.js applies
// each one to a copy of the page (TEN339_HTML).
//   · house formulas: the 6-part Serve rating (aces − double faults), Return 4-term, every rate from its count
//   · the road = career-history rows at this event before this match: main draw only, this match and other events out;
//     set scores from career-history `sets`, player-oriented
//   · DRAW avg = tournament-progression.json (active events only): both players of every match at that round; "—" otherwise;
//     its Pressure points are "—" on every round, 50% by construction (founder Q7, TEN-312 6c9a9e55)
//   · the D2 gate on every rate: n 1–4 → the count, 5–9 grey + note + footnote; AVG pooled over the summed counts
//   · the R1 empty state (the tab is listed, not hidden) · a bye only at the draw's first round · a walkover counted nowhere
//   · DoD 8: no tab-local row or tooltip renderer; every match cell opens the shared sheet · no seeded numbers
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN339_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const HOUSE_RATINGS_SRC = readFileSync(join(HERE, 'house-ratings.js'), 'utf8');
// Match analysis rebuild (2026-11-23): the tab renderer is maProgressionV2 in match-analysis-v2.js (TEN339_MA2 = a mutated copy)
const MA2_SRC = readFileSync(process.env.TEN339_MA2 || join(HERE, 'match-analysis-v2.js'), 'utf8');
globalThis.MarketEdgeCore = createRequire(import.meta.url)(join(HERE, 'market-edge-core.js'));
function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let d = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; }
  return html.slice(start, i + 1);
}
function between(a, b) { const i = html.indexOf(a), j = html.indexOf(b, i); assert.ok(i > 0 && j > i, 'block not found: ' + a.slice(0, 40)); return html.slice(i, j); }
const TEN263 = between('/* =====================================================================\n   TEN-263 ', '/* ---------- TOURNAMENT SUB-TAB ---------- */');
const PG = between('// TEN-339 · MATCH ANALYSIS → PROGRESSION TAB.', 'function showTournamentProfile(key){');
const PG_START = html.indexOf('// TEN-339 · MATCH ANALYSIS → PROGRESSION TAB.');
const PS_TOUR_META_SRC = /const PS_TOUR_META = \(\(\) => \{[\s\S]*?\n\}\)\(\);/.exec(html)[0];
const S = new Function(`
  const document = { addEventListener(){}, getElementById(){ return null; }, querySelector(){ return null; }, querySelectorAll(){ return []; },
    head: { appendChild(){} }, createElement(){ return { set textContent(v){} }; } };
  const playerProfiles = {};
  let tournamentProgression = { tournaments: {} }, playerStyles = { byKey: { x: 1 } };
  const STY = {};
  function ppStyleFor(n){ return STY[n] ? { archetype_label: STY[n] } : null; }
  function formPanelHtml(){ return ''; } function ensureFormPanelTabs(){}
  function ensureFormRows(m){ return Promise.resolve(m); } function loadCareerHistory(){ return Promise.resolve([]); }
  function ensureStyleMeetings(m){ return Promise.resolve(m); } function ensurePsMatrix(){ return Promise.resolve(); }
  function psArchFor(){ return null; } function styleMeetRowsFor(){ return []; }
  function openPlayerProfileFromMatch(){} function aGoTab(){}
  function loadMatchStatsIndex(){ return Promise.resolve(new Set()); } function loadSetStatsShard(){ return Promise.resolve(null); } const _setStatsShards = {};
  function loadPlayerStyles(){ return Promise.resolve(); } const _tpLoad = null; const _careerHistoryShards = {};
  function aHeaderOdds(m){ return m.__ho || { p1: '—', p2: '—' }; } function initAOddsTips(){}
  let _aM = null; const _aBuilt = new Set(); function aBuilt(){ return false; } function aPaint(){}
  const HouseRatings = (function(){ const window = {}; ${HOUSE_RATINGS_SRC}; return window.HouseRatings; })();
  ${PS_TOUR_META_SRC}
  ${['escapeHtml', 'surnameFirstName', 'psShortName', 'formIni', 'ppCleanTournamentName', 'psNormTour', 'psTourMeta', 'psRoundAbbr', 'h2hRoundLabel', 'maRoundName', 'eventKeyOfMatch',
     'matchStatsFromShard', 'progressionRoundRecordCount', 'progressionByesCredible'].map(slice).join('\n')}
  ${TEN263}
  ${PG}
  const __MA2 = (function(){ const window = {}; ${MA2_SRC}; return window; })();
  const maProgressionV2 = __MA2.maProgressionV2;
  return { pgBoxMetrics, pgPool, pgFig, pgSide, pgModel, pgTpMetrics, pgDrawFor, buildMatchProgressionSection, maRowOnclick, _maRowReg,
    HouseRatings, STY, CH: _careerHistoryShards, setTp(t){ tournamentProgression = { tournaments: t }; }, get pg(){ return _pg; } };
`)();
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
// 2026-11-23 design: one metric box per measure (data-pgcard="metric"), titled by the measure's name; its last grid row is
// "Draw average". A hover is the cell's title (the design's native hover, STEP1 #8).
const metCard = (h, name) => h.split('data-pgcard="metric"').slice(1).find(c => c.includes('color:var(--ma2-text);">' + name + '</span>')) || '';
const drawRowOf = card => card.slice(card.indexOf('>Draw average</span>'));
const tipOf = s => (/(?:data-aotip|title)="([^"]*)"/.exec(s) || [])[1];
const facingOf = h => { const i = h.indexOf('>Facing</span>'); return i < 0 ? '' : h.slice(i, h.indexOf('</div>', i) + 6); };
const facingSegs = f => [...f.matchAll(/<span class="seg ma2-seg"[^>]*style="([^"]*)">([^<]*)<\/span>/g)].map(x => [x[1], x[2]]);
const unesc = t => String(t).replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&');

// One side of a whole-match box score (the shard shape, matchStatsFromShard → { own, opp }).
function side(o) {
  const wt = (w, t) => ({ won: w, total: t });
  return { 'Service:Aces': o.aces, 'Service:Double Faults': o.dfs, 'Points:Winners': o.win || 0, 'Points:Unforced errors': o.ue || 0,
    raw: { 'Service:1st serve points won': wt(o.f1[0], o.f1[1]), 'Service:2nd serve points won': wt(o.f2[0], o.f2[1]), 'Games:Service games won': wt(o.sg[0], o.sg[1]),
      'Return:1st return points won': wt(o.r1[0], o.r1[1]), 'Return:2nd return points won': wt(o.r2[0], o.r2[1]), 'Games:Return games won': wt(o.rg[0], o.rg[1]),
      'Return:Break Points Converted': wt(o.bpc[0], o.bpc[1]), 'Service:Break Points Saved': wt(o.bps[0], o.bps[1]),
      'Points:Service Points Won': wt(o.f1[0] + o.f2[0], o.f1[1] + o.f2[1]), 'Points:Return Points Won': wt(o.r1[0] + o.r2[0], o.r1[1] + o.r2[1]),
      'Points:Total Points Won': wt(o.f1[0] + o.f2[0] + o.r1[0] + o.r2[0], o.f1[1] + o.f2[1] + o.r1[1] + o.r2[1]) } };
}
const BOX_A = { aces: 9, dfs: 2, f1: [33, 40], f2: [12, 20], sg: [10, 10], r1: [12, 38], r2: [11, 22], rg: [2, 10], bpc: [2, 5], bps: [3, 3], win: 0, ue: 0 };
const BOX_B = { aces: 4, dfs: 3, f1: [26, 38], f2: [11, 22], sg: [8, 10], r1: [7, 40], r2: [8, 20], rg: [0, 10], bpc: [0, 3], bps: [3, 5], win: 0, ue: 0 };
const joined = (a, b) => ({ own: side(a), opp: side(b) });

// A match at an event: facing `rd`, both players' career-history rows at the event (round names as the feed writes them).
const ROUND = { R1: '1/16-finals', R2: '1/8-finals', QF: 'Quarter-finals', SF: 'Semi-finals', F: 'Final' };
function row(date, rd, opp, sets, extra) { return Object.assign({ year: '2026', surface: 'hard', level: 'atp', date, tournament: 'Chengdu', round: ROUND[rd] || rd, opponent: opp,
  result: sets.filter(s => s.p > s.o).length + ' - ' + sets.filter(s => s.o > s.p).length, won: sets.filter(s => s.p > s.o).length > sets.filter(s => s.o > s.p).length,
  eventKey: 'ek-' + opp.replace(/\W/g, '') + rd, src: 'fixtures', sets }, extra || {}); }
const W = [{ p: 6, o: 4 }, { p: 6, o: 3 }];
function match(facing, hA, hB, extra) {
  const m = Object.assign({ id: 'upcoming-99999999', p1: 'H. Hurkacz', p2: 'A. Davidovich Fokina', p1Key: '1', p2Key: '2', date: '2026-09-29',
    tour: 'ATP Chengdu', tournamentRound: 'ATP Chengdu - ' + (ROUND[facing] || facing) }, extra || {});
  // a history the loader answered is in its cache (a failed load is not: loadCareerHistory answers [] and caches nothing)
  if (hA) S.CH[m.p1Key] = hA; if (hB) S.CH[m.p2Key] = hB;
  m._pg = { sides: [S.pgSide(m, 0, hA, null), S.pgSide(m, 1, hB, null)] };
  m._pgP = Promise.resolve();
  return m;
}
const setBox = (m, k, i, a, b) => { m._pg.sides[k].rows[i].pg = S.pgBoxMetrics(joined(a, b)); };

// Mutation 'Serve rating: the Tournament Report 4-term (no aces / double faults)'
test('house formulas: the 6-part Serve rating and the 4-term Return rating, every rate from its count', () => {
  const x = S.pgBoxMetrics(joined(BOX_A, BOX_B));
  const firstIn = 40 / 60 * 100, sr = firstIn + 33 / 40 * 100 + 12 / 20 * 100 + 100 + 9 - 2;
  assert.ok(Math.abs(x.serveRating.v - sr) < 1e-9, 'serve = 1st-in + 1st-won + 2nd-won + hold + aces − DF');
  const rr = 12 / 38 * 100 + 11 / 22 * 100 + 2 / 10 * 100 + 2 / 5 * 100;
  assert.ok(Math.abs(x.returnRating.v - rr) < 1e-9);
  assert.deepEqual([x.firstServe.won, x.firstServe.total], [40, 60], '1st serve % rebuilt from the counts');
  // Pressure = (BP saved + converted) ÷ all BPs played: (3 + 2) / (3 + 5)
  assert.deepEqual([x.pressure.won, x.pressure.total], [5, 8]);
  // Dominance = RPW% ÷ (100 − SPW%)
  assert.ok(Math.abs(x.dominance.v - (23 / 60) / (1 - 45 / 60)) < 1e-9);
  // the feed sent no winners / UE (all four 0): dashes, never 0
  assert.equal(x.winners.v, null); assert.equal(x.wue.v, null);
});

// Mutation 'road: the analysed match itself on the road'
// Mutation 'road: qualifying rows on the road (N7)'
test('road: career-history rows at this event before this match — main draw only, this match and other events out', () => {
  const hA = [row('2026-09-24', 'R1', 'A. Shevchenko', W), row('2026-09-26', 'R2', 'M. Damm', W), row('2026-09-22', 'R1', 'X. Qual', W, { qualifying: true }),
    row('2026-09-29', 'F', 'A. Davidovich Fokina', W, { eventKey: 99999999 }), row('2026-08-10', 'R2', 'Z. Elsewhere', W, { tournament: 'Cincinnati' })];
  const m = match('QF', hA, []);
  const opps = m._pg.sides[0].rows.map(r => r.opp);
  assert.deepEqual(opps.sort(), ['A. Shevchenko', 'M. Damm']);
});

// Mutation 'set scores: the feed-order resultDisplay (not player-oriented)'
test('set scores come from career-history `sets`, player-oriented; " ret." kept', () => {
  const hA = [row('2026-09-24', 'R1', 'A. Shevchenko', [{ p: 3, o: 6 }, { p: 6, o: 3 }, { p: 7, o: 5 }])];
  const m = match('R2', hA, [row('2026-09-24', 'R1', 'Q. Other', [{ p: 6, o: 2 }, { p: 3, o: 1 }])]);
  const h = S.buildMatchProgressionSection(m);
  assert.ok(text(h).includes('3-6, 6-3, 7-5'), 'own games first');
  assert.ok(text(h).includes('6-2, 3-1 ret.'), 'a retirement keeps its marker');
});

// Mutation 'DRAW avg: an event off the board still gets a draw row'
// Mutation 'DRAW avg: winners only, not both players of every match'
test('DRAW avg: active events only (both players of every match at that round); "—" with the reason otherwise', () => {
  const hA = [row('2026-09-24', 'R1', 'A. Shevchenko', W)], hB = [row('2026-09-24', 'R1', 'M. Kouame', W)];
  S.setTp({});
  const off = S.buildMatchProgressionSection(match('R2', hA, hB));
  const offRow = drawRowOf(metCard(off, 'Serve rating'));
  assert.ok(/(?:data-aotip|title)="Draw average: only for events on this week/.test(offRow), 'the no-draw reason is the draw row\'s hover');
  assert.ok(!/\d/.test(text(offRow).replace(/Draw average/, '')), 'no number in the draw row');
  // two R1 matches: A beat B, C beat D — the Serve rating draw avg is the mean of all four player-rounds
  const pr = (svG, aces) => ({ firstServePct: 60, firstServeWonPct: 70, secondServeWonPct: 50, svHold: { won: svG, total: 10 }, aces, dfs: 1,
    ret1: { won: 10, total: 40 }, ret2: { won: 10, total: 20 }, retGames: { won: 1, total: 10 }, bpConv: { won: 1, total: 4 } });
  const P = (name, key, opp, mm, elim) => ({ name, playerKey: key, eliminated: !!elim, rounds: [{ round: 'R1', opponent: opp, resultDisplay: '2 - 0', metrics: mm }] });
  const t = { rounds: ['R1'], players: [P('A. Aa', '11', 'B. Bb', pr(10, 8)), P('B. Bb', '12', 'A. Aa', pr(9, 2), true), P('C. Cc', '13', 'D. Dd', pr(8, 5)), P('D. Dd', '14', 'C. Cc', pr(7, 1), true)] };
  const d = S.pgDrawFor(t, ['R1'])[0];
  const sv = (h, a) => 60 + 70 + 50 + h * 10 + a - 1;
  assert.ok(Math.abs(d.serveRating.v - (sv(10, 8) + sv(9, 2) + sv(8, 5) + sv(7, 1)) / 4) < 1e-9, 'mean of all four player-rounds');
  assert.equal(d.serveRating.n, 4);
  S.setTp({ Chengdu: t });
  const on = S.buildMatchProgressionSection(match('R2', hA, hB));
  assert.ok(!/only for events on this week/.test(on), 'an active event draws its row');
  assert.ok(/\d/.test(text(drawRowOf(metCard(on, 'Serve rating'))).replace(/Draw average/, '')), 'the draw row prints its mean');
  S.setTp({});
});

// Founder Q7 (TEN-312 6c9a9e55). Mutation 'Q7: the DRAW avg of Pressure points computed again (50.0%)'
test('DRAW avg of Pressure points is "—" on every round and the AVG, with the founder\'s tooltip', () => {
  const TIP = "Always 50% by construction: the two players' shares of a match's break points add up to 100%.";
  const hA = [row('2026-09-24', 'R1', 'A. Shevchenko', W), row('2026-09-26', 'R2', 'M. Damm', W)];
  const hB = [row('2026-09-24', 'R1', 'M. Kouame', W), row('2026-09-26', 'R2', 'X. Two', W)];
  // four matches in R1 and three in R2 (8 and 6 player-rounds, above the n = 5 dash), uneven break-point counts: the shares still sum to 1
  const pr = (w, t) => ({ firstServePct: 60, firstServeWonPct: 70, secondServeWonPct: 50, svHold: { won: 8, total: 10 }, aces: 3, dfs: 1,
    ret1: { won: 10, total: 40 }, ret2: { won: 10, total: 20 }, retGames: { won: 1, total: 10 }, bpConv: { won: w, total: t } });
  const P = (name, key, rounds) => ({ name, playerKey: key, rounds: rounds.map(([round, opponent, mm]) => ({ round, opponent, resultDisplay: '2 - 0', metrics: mm })) });
  const t = { rounds: ['R1', 'R2'], players: [
    P('A. Aa', '11', [['R1', 'B. Bb', pr(3, 7)], ['R2', 'C. Cc', pr(1, 2)]]), P('B. Bb', '12', [['R1', 'A. Aa', pr(0, 4)]]),
    P('C. Cc', '13', [['R1', 'D. Dd', pr(2, 3)], ['R2', 'A. Aa', pr(4, 9)]]), P('D. Dd', '14', [['R1', 'C. Cc', pr(5, 11)]]),
    P('E. Ee', '15', [['R1', 'F. Ff', pr(1, 6)], ['R2', 'G. Gg', pr(2, 2)]]), P('F. Ff', '16', [['R1', 'E. Ee', pr(3, 3)]]),
    P('G. Gg', '17', [['R1', 'H. Hh', pr(4, 5)], ['R2', 'E. Ee', pr(0, 1)]]), P('H. Hh', '18', [['R1', 'G. Gg', pr(2, 8)]]),
    P('I. Ii', '19', [['R2', 'J. Jj', pr(3, 4)]]), P('J. Jj', '20', [['R2', 'I. Ii', pr(1, 5)]])] };
  S.setTp({ Chengdu: t });
  const h = S.buildMatchProgressionSection(match('QF', hA, hB));
  S.setTp({});
  const drawRow = drawRowOf(metCard(h, 'Pressure points'));
  const cells = [...drawRow.matchAll(/<span (?:data-aotip|title)="([^"]*)"[^>]*>([^<]*)<\/span>/g)].map(x => [unesc(x[1]), x[2]]);
  assert.equal(cells.length, 3, 'R1, R2 and the AVG');
  for (const [tip, v] of cells) { assert.equal(v, '—'); assert.equal(tip, TIP); }
  assert.ok(!/50\.0%/.test(drawRow), 'no 50.0% in the draw row');
  // every other metric still draws its mean on an active event
  const serve = [...drawRowOf(metCard(h, 'Serve rating')).matchAll(/<span title="[^"]*"[^>]*>([^<]*)<\/span>/g)].map(x => x[1]);
  assert.equal(serve.length, 3);
  assert.ok(serve.every(v => /^\d/.test(v)), 'the Serve rating draw row prints its means: ' + serve.join(' | '));
});

// Mutation 'gate: a rate on n 1–4 printed as a %'
// Mutation 'AVG: the mean of the round rates, not the summed counts'
test('D2 gate on every rate: n 1–4 → the count, 5–9 grey + note + footnote; AVG over the summed counts', () => {
  const hA = [row('2026-09-24', 'R1', 'A. Shevchenko', W), row('2026-09-26', 'R2', 'M. Damm', W)];
  const m = match('QF', hA, [row('2026-09-24', 'R1', 'X. One', W), row('2026-09-26', 'R2', 'X. Two', W)]);
  setBox(m, 0, 0, Object.assign({}, BOX_A, { bpc: [1, 2], bps: [1, 2] }), BOX_B);       // pressure 2/4 → count only
  setBox(m, 0, 1, Object.assign({}, BOX_A, { bpc: [3, 4], bps: [2, 3] }), BOX_B);       // pressure 5/7 → grey
  const h = S.buildMatchProgressionSection(m);
  const card = metCard(h, 'Pressure points');
  assert.ok(/>2\/4</.test(card), 'n = 4: the count, not a %');
  assert.ok(!/>50\.0%</.test(card), 'no 50.0% at n = 4');
  assert.ok(/title="small sample[^"]*"[^>]*color:var\(--ma2-grey\);[^>]*>71\.4%/.test(card), 'n = 7: greyed, "small sample" on hover');
  // modal-progression.md (D2, G15): the footnote "Grey = small sample (5–9)" under the cards
  assert.ok(/Grey = small sample/.test(h), 'the footnote');
  // AVG = (2 + 5) / (4 + 7) = 63.6%, not the mean of 50.0% and 71.4% (60.7%)
  assert.ok(text(card).includes('63.6%'), 'pooled over the counts');
  assert.ok(!text(card).includes('60.7%'));
});

// Mutation 'R1: the tab hidden in the first round again'
test('the R1 empty state follows the design, and the tab is listed in every round', () => {
  const m = match('R1', [], []);
  const h = S.buildMatchProgressionSection(m);
  assert.ok(text(h).includes('No progression yet'));
  assert.ok(text(h).includes('first match at Chengdu'), 'the empty state names the event');
  assert.ok(!/progressionRoundState\(m\)\.state === 'hidden'/.test(html.slice(html.indexOf('function openAnalysisModal('), html.indexOf('function openAnalysisModal(') + 6000)), 'openAnalysisModal no longer hides the tab');
});

// Mutation 'bye: any missing round called a bye'
test('a bye only at the draw\'s first round; any other hole says "no record", never a guessed opponent', () => {
  const hA = [row('2026-09-24', 'R1', 'A. Shevchenko', W), row('2026-09-26', 'R2', 'M. Damm', W), row('2026-09-27', 'QF', 'L. Harris', W)];
  const hB = [row('2026-09-26', 'R2', 'J. M. Cerundolo', W)];   // no R1 (a seed's bye), no QF row (a hole)
  const P = S.pgModel(match('SF', hA, hB));
  const cells = P.roads[1].cells;
  assert.equal(cells[0].bye, true);
  assert.equal(cells[2].bye, false); assert.equal(cells[2].missing, true);
  const h = S.buildMatchProgressionSection(match('SF', hA, hB));
  assert.ok(/no record of this round/i.test(text(h)));
  assert.ok(text(h).includes('(bye)'), 'the sub names the bye');
});

// Mutation 'N2: a walkover counted in the W–L and sets'
test('N2: a walkover is listed "w/o" and counted nowhere', () => {
  const hA = [row('2026-09-24', 'R1', 'A. Shevchenko', [], { result: '0 - 0', walkover: true, won: true }), row('2026-09-26', 'R2', 'M. Damm', W)];
  const P = S.pgModel(match('QF', hA, []));
  assert.equal(P.roads[0].rec, '1–0 · sets 2–0');
  const h = S.buildMatchProgressionSection(match('QF', hA, []));
  assert.ok(/w\/o/.test(text(h)));
});

// Mutation 'DoD 8: a road cell stops opening the shared sheet'
// Mutation 'DoD 8: a tab-local tooltip renderer'
test('DoD 8: every match cell opens the shared sheet; no tab-local row or tooltip renderer', () => {
  const hA = [row('2026-09-24', 'R1', 'A. Shevchenko', W), row('2026-09-26', 'R2', 'M. Damm', W)];
  const m = match('QF', hA, [row('2026-09-24', 'R1', 'X. One', W), row('2026-09-26', 'R2', 'X. Two', W)]);
  setBox(m, 0, 0, BOX_A, BOX_B);
  const h = S.buildMatchProgressionSection(m);
  const played = h.split('class="seg ma2-row"').slice(1).filter(c => /^[^>]*title="R\d · (beat|lost to) /.test(c));
  assert.equal(played.length, 4, 'four played road rows');
  assert.ok(played.every(c => /^ onclick="event\.stopPropagation\(\); maOpenRowSheet\('mr\d+', this\)"/.test(c)), 'each opens the shared sheet');
  const id = /maOpenRowSheet\('(mr\d+)', this\)/.exec(played[0])[1];
  assert.equal(S._maRowReg[id].round, 'R1', 'the sheet gets the draw\'s round label');
  assert.ok(/class="seg ma2-fbar" onclick="event\.stopPropagation\(\); maOpenRowSheet/.test(h), 'a round-by-round figure opens it too');
  const code = PG;
  assert.ok(!/elotip-pop|pg-tip|function pg\w*(Row|Tip)\w*\(/.test(code), 'no tab-local row / tooltip renderer');
  assert.ok(!/PROGRESSION_TABLE_METRICS|\.tpg-|buildProgressionAiSummary|progressionPlot\(/.test(html), 'the old table renderer is deleted, not hidden');
});

// Mutation 'seeded numbers back in the unplayed-round placeholder'
// 2026-11-23 design: unplayed rounds are not drawn at all (no blurred placeholder); the road ends at "This match".
test('no seeded data: no unplayed round is drawn, no sample chip', () => {
  const h = S.buildMatchProgressionSection(match('QF', [row('2026-09-24', 'R1', 'A. Shevchenko', W)], []));
  assert.ok(!/filter:blur/.test(h), 'no blurred placeholder');
  assert.ok(!/>(SF|F)</.test(h), 'no future round: ' + (h.match(/>(SF|F)</g) || []).join(' '));
  assert.ok(!/SAMPLE DATA|Sample data|>Sample</.test(h), 'no sample chip');
});

// Mutation 'this match: dropped by surname even when both carry an event key'
test('this match is found by event key; an earlier round against a namesake stays on the road', () => {
  const hB = [row('2026-09-24', 'R1', 'J. M. Cerundolo', W), row('2026-09-29', 'F', 'F. Cerundolo', W, { eventKey: 99999999 })];
  const m = match('R2', [row('2026-09-24', 'R1', 'X. One', W)], hB, { p1: 'F. Cerundolo' });
  assert.deepEqual(m._pg.sides[1].rows.map(r => r.opp), ['J. M. Cerundolo']);
  // a live card's hash id carries no event key: the opponent's name on the same day finds this match
  const h2 = [row('2026-09-24', 'R1', 'M. Kouame', W), row('2026-09-29', 'R2', 'H. Hurkacz', W)];
  const m2 = match('R2', [], h2, { id: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4' });
  assert.deepEqual(m2._pg.sides[1].rows.map(r => r.opp), ['M. Kouame']);
});

// Mutation 'failed load: a history that failed to load reads as an empty one (a made-up bye)'
test('a history that failed to load is not an empty history: no bye is claimed', () => {
  const m = { id: 'upcoming-99999998', p1: 'H. Hurkacz', p2: 'Q. Failed', p1Key: '1', p2Key: '777', date: '2026-09-29', tour: 'ATP Chengdu', tournamentRound: 'ATP Chengdu - 1/8-finals' };
  S.CH['1'] = [row('2026-09-24', 'R1', 'A. Shevchenko', W)]; delete S.CH['777'];
  m._pg = { sides: [S.pgSide(m, 0, S.CH['1'], null), S.pgSide(m, 1, [], null)] }; m._pgP = Promise.resolve();
  const P = S.pgModel(m);
  assert.equal(P.roads[1].cells[0].bye, false);
  assert.equal(P.roads[1].cells[0].missing, true);
});

// Mutation 'Slam: numbered from the first round a history shows (a 128 draw read as 32)'
test('a Slam is a 128 draw: R2 with no history is not the first round', () => {
  const m = { id: 'upcoming-99999997', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: '31', p2Key: '32', date: '2026-07-02', tour: 'Wimbledon', tournamentRound: 'Wimbledon - 1/32-finals' };
  S.CH['31'] = []; S.CH['32'] = [];
  m._pg = { sides: [S.pgSide(m, 0, [], null), S.pgSide(m, 1, [], null)] }; m._pgP = Promise.resolve();
  const P = S.pgModel(m);
  assert.equal(P.isEmpty, false);
  assert.equal(P.facing, 'R2');
});

// 2026-11-23 design (founder lock, replaces the TEN-380 tile / chip / heat-card styling): per player a road box — one
// clickable row per played round, then THIS MATCH lifted (--ma2-lifted + 14% edge); "Round by round" with one metric box
// per measure (nine), the better figure lifted. Superseded by the lock: --edge-7 tiles, the 20/800 "Metrics" title, the
// one-row chip strip, --edge-6 heat cards, the white-7% better cell, "no --text-soft on the tab".
test('2026-11-23 design: road rows, THIS MATCH lifted, Round by round with nine metric boxes, the better figure lifted', () => {
  const hA = [row('2026-09-24', 'R1', 'A. Shevchenko', W), row('2026-09-26', 'R2', 'M. Damm', W)];
  const m = match('QF', hA, [row('2026-09-24', 'R1', 'X. One', W), row('2026-09-26', 'R2', 'X. Two', W)]);
  setBox(m, 0, 0, BOX_A, BOX_B);
  const h = S.buildMatchProgressionSection(m);
  assert.equal((h.match(/class="seg ma2-row" onclick="event\.stopPropagation\(\); maOpenRowSheet/g) || []).length, 4, 'every played round is a clickable row');
  assert.equal((h.match(/data-pgnow="true"[^>]*background:var\(--ma2-lifted\); border:1px solid color-mix\(in srgb, var\(--ma2-white\) 14%, transparent\);/g) || []).length, 2, 'THIS MATCH lifted, once per player');
  assert.ok(/>Road to the quarter-final</.test(h) && />Round by round</.test(h), 'the two cards');
  assert.equal((h.match(/data-pgcard="metric"/g) || []).length, 9, 'nine metric boxes');
  assert.ok(/class="seg ma2-fbar"[^>]*background:var\(--ma2-lifted\)/.test(h), 'the better figure is lifted');
});

// Founder Q7 / ruling 12 (TEN-380): the Facing row on a Darker track — only the rounds already played, each with both
// players' opponents from their results at this event; this match's round selected; no future round, no projected
// opponent; never "Bye" (the feed lists none). Mutations: a future round on the track; the current round not selected;
// a bye written from inference; the row missing on a first-round match.
test('Q7: Facing row — played rounds with their opponents, this match selected, nothing projected', () => {
  const hA = [row('2026-09-24', 'R1', 'A. Shevchenko', W), row('2026-09-26', 'R2', 'M. Damm', W)];
  const hB = [row('2026-09-24', 'R1', 'X. One', W), row('2026-09-26', 'R2', 'X. Two', W)];
  const h = S.buildMatchProgressionSection(match('QF', hA, hB));
  const f = facingOf(h);
  assert.ok(f.length > 50 && h.indexOf('>Facing</span>') < h.indexOf('>Road to the'), 'the row sits above the road');
  assert.match(f, /class="ma2-track" style="display:inline-flex; flex-wrap:wrap; gap:3px; background:var\(--ma2-track\);/, 'the switch track');
  const segs = facingSegs(f);
  assert.deepEqual(segs.map(x => x[1]), ['R1 · Shevchenko / One', 'R2 · Damm / Two', 'QF'], 'played rounds with opponents, then this match; no SF / F');
  assert.match(segs[2][0], /font-weight:700; color:var\(--ma2-text\); background:var\(--ma2-lifted\);/, 'this match = the selected segment');
  assert.match(segs[0][0], /font-weight:600; color:var\(--ma2-grey\); background:transparent;/, 'idle segment');
  assert.ok(!/bye/i.test(f.replace(/title="[^"]*"/g, '')), 'no bye on the track');
  // a seed with no first-round row: the cell is inferred, so the track prints a dash, never "Bye"
  const h2 = S.buildMatchProgressionSection(match('QF', [row('2026-09-26', 'R2', 'M. Damm', W)], hB));
  const f2 = facingOf(h2);
  assert.ok(!/bye/i.test(f2.replace(/title="[^"]*"/g, '')), 'no "Bye" written from inference');
  // first round: the current segment alone, above the empty state
  const h1 = S.buildMatchProgressionSection(match('R1', [], []));
  assert.deepEqual(facingSegs(facingOf(h1)).map(x => x[1]), ['R1']);
  assert.match(h1, /No progression yet/);
});

// TEN-380 review F5: a highlighted played round is the selected segment of the Facing row (this match's round goes idle and
// clicking it clears the highlight). Mutation: pgFacingHtml ignores `hi` (the row never marks the highlighted round).
test('F5: the highlighted round is the Facing row\'s selected segment', () => {
  const hA = [row('2026-09-24', 'R1', 'A. Shevchenko', W), row('2026-09-26', 'R2', 'M. Damm', W)];
  const hB = [row('2026-09-24', 'R1', 'X. One', W), row('2026-09-26', 'R2', 'X. Two', W)];
  const m = match('QF', hA, hB);
  S.buildMatchProgressionSection(m); S.pg.hi = 0;
  const h = S.buildMatchProgressionSection(m);
  const segs = facingSegs(facingOf(h));
  assert.deepEqual(segs.map(x => /font-weight:700/.test(x[0])), [true, false, false], 'R1 selected, QF idle');
  assert.match(facingOf(h), /onclick="ma2PgPick\(null\)"[^>]*>QF</, 'the idle current round clears the highlight');
});

// Founder 2026-11-24: Progression reads a round-robin event. The ATP Finals 2026 final, Zverev v Alcaraz (past-12181958), on
// the real career-history rows: the three group matches carry no round (api-tennis sends '') and the event as "Finals -
// Turin", while the board's knockout rows say "ATP Finals". Before: no row matched, the tab read "No progression yet".
test('a round-robin event (ATP Finals): group matches numbered RR1–RR3 by date, then SF, facing the F', () => {
  const fr = (date, rd, opp, won, ek) => ({ year: '2026', surface: 'hard', level: 'atp', date, tournament: 'Finals - Turin', round: rd, opponent: opp,
    result: won ? '2 - 0' : '0 - 2', won, eventKey: ek, src: 'fixtures', sets: won ? W : [{ p: 4, o: 6 }, { p: 3, o: 6 }] });
  const zv = [fr('2026-11-22', 'Final', 'C. Alcaraz', false, 12181958), fr('2026-11-21', 'Semi-finals', 'D. Medvedev', true, 12181753),
    fr('2026-11-19', '', 'A. Fils', true, 12179706), fr('2026-11-17', '', 'B. Shelton', true, 12179705), fr('2026-11-15', '', 'R. Jodar', true, 12179707),
    fr('2025-11-14', '', 'F. Auger-Aliassime', false, 12086402)];   // last year's group: out of the 20-day window
  const ca = [fr('2026-11-21', 'Semi-finals', 'B. Shelton', true, 12181584), fr('2026-11-20', '', 'F. Cobolli', true, 12179697),
    fr('2026-11-18', '', 'D. Medvedev', true, 12179696), fr('2026-11-16', '', 'F. Tiafoe', true, 12179698)];
  const m = match('F', zv, ca, { id: 'past-12181958', p1: 'A. Zverev', p2: 'C. Alcaraz', p1Key: '1980', p2Key: '2382', date: '2026-11-22',
    tour: 'ATP Finals', tournamentRound: 'ATP Finals - Turin - Final' });
  const P = S.pgModel(m);
  assert.equal(P.isEmpty, false);
  assert.deepEqual(P.labels, ['RR1', 'RR2', 'RR3', 'SF']);
  assert.equal(P.facing, 'F');
  assert.deepEqual(P.roads[0].cells.map(c => c.r && c.r.opp), ['R. Jodar', 'B. Shelton', 'A. Fils', 'D. Medvedev'], 'by date, this match out');
  assert.deepEqual(P.roads[1].cells.map(c => c.r && c.r.opp), ['F. Tiafoe', 'D. Medvedev', 'F. Cobolli', 'B. Shelton']);
  assert.ok(P.roads.every(p => p.cells.every(c => !c.bye)), 'no bye at a round-robin event');
  // a group match faces the next group slot: Zverev v Fils (his third) after two group rows
  const g = match('', zv.slice(3), [], { id: 'past-12179706', p1: 'A. Zverev', p2: 'A. Fils', p1Key: '1980', p2Key: '9', date: '2026-11-19',
    tour: 'ATP Finals - Turin', tournamentRound: null });
  const G = S.pgModel(g);
  assert.equal(G.facing, 'RR3'); assert.deepEqual(G.labels, ['RR1', 'RR2']);
});
