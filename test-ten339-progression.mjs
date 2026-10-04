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
  ${['escapeHtml', 'surnameFirstName', 'psShortName', 'formIni', 'ppCleanTournamentName', 'psNormTour', 'psTourMeta', 'psRoundAbbr', 'h2hRoundLabel', 'eventKeyOfMatch',
     'matchStatsFromShard', 'progressionRoundRecordCount', 'progressionByesCredible'].map(slice).join('\n')}
  ${TEN263}
  ${PG}
  return { pgBoxMetrics, pgPool, pgFig, pgSide, pgModel, pgTpMetrics, pgDrawFor, buildMatchProgressionSection, maRowOnclick, _maRowReg,
    HouseRatings, STY, CH: _careerHistoryShards, setTp(t){ tournamentProgression = { tournaments: t }; }, get pg(){ return _pg; } };
`)();
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

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
  assert.ok(text(h).includes('3-6 6-3 7-5'), 'own games first');
  assert.ok(text(h).includes('6-2 3-1 ret.'), 'a retirement keeps its marker');
});

// Mutation 'DRAW avg: an event off the board still gets a draw row'
// Mutation 'DRAW avg: winners only, not both players of every match'
test('DRAW avg: active events only (both players of every match at that round); "—" with the reason otherwise', () => {
  const hA = [row('2026-09-24', 'R1', 'A. Shevchenko', W)], hB = [row('2026-09-24', 'R1', 'M. Kouame', W)];
  S.setTp({});
  const off = S.buildMatchProgressionSection(match('R2', hA, hB));
  assert.ok(/Draw average: only for events on this week/.test(off), 'the no-draw reason is on the row');
  // DoD 8 (TEN-314 f0db3de8): a hover text the file does not draw rides on the one tooltip component, never a native title
  assert.ok(/data-aotip="Draw average: only for events on this week/.test(off), 'the draw reason is on the shared tooltip');
  assert.ok(!/title="Draw average/.test(off), 'not a native title');
  const drawRow = h => h.slice(h.indexOf('>Draw</span>'), h.indexOf('</div>', h.indexOf('>Draw</span>')));
  assert.ok(!/\d/.test(text(drawRow(off)).replace(/Draw/, '')), 'no number in the draw row');
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
  const card = h.slice(h.indexOf('data-pg-metric="pressure"'));            // the last card
  const drawRow = card.slice(card.indexOf('>Draw</span>'), card.indexOf('</div></div>'));
  const cells = [...drawRow.matchAll(/<span data-aotip="([^"]*)"[^>]*>([^<]*)<\/span>/g)]
    .map(x => [x[1].replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&'), x[2]]);
  assert.equal(cells.length, 3, 'R1, R2 and the AVG');
  for (const [tip, v] of cells) { assert.equal(v, '—'); assert.equal(tip, TIP); }
  assert.ok(!/50\.0%/.test(drawRow), 'no 50.0% in the draw row');
  // every other metric still draws its mean on an active event
  const serve = h.slice(h.indexOf('data-pg-metric="serveRating"'), h.indexOf('data-pg-metric="returnRating"'));
  assert.ok(/Mean of the 8 players who played R1 at .*Mean of the 6 players who played R2 at /s.test(serve), 'the Serve rating draw row is untouched');
});

// Mutation 'gate: a rate on n 1–4 printed as a %'
// Mutation 'AVG: the mean of the round rates, not the summed counts'
test('D2 gate on every rate: n 1–4 → the count, 5–9 grey + note + footnote; AVG over the summed counts', () => {
  const hA = [row('2026-09-24', 'R1', 'A. Shevchenko', W), row('2026-09-26', 'R2', 'M. Damm', W)];
  const m = match('QF', hA, [row('2026-09-24', 'R1', 'X. One', W), row('2026-09-26', 'R2', 'X. Two', W)]);
  setBox(m, 0, 0, Object.assign({}, BOX_A, { bpc: [1, 2], bps: [1, 2] }), BOX_B);       // pressure 2/4 → count only
  setBox(m, 0, 1, Object.assign({}, BOX_A, { bpc: [3, 4], bps: [2, 3] }), BOX_B);       // pressure 5/7 → grey
  const h = S.buildMatchProgressionSection(m);
  const card = h.slice(h.indexOf('data-pg-metric="pressure"'));
  assert.ok(text(card).includes('2/4'), 'n = 4: the count, not a %');
  assert.ok(!/>50\.0%</.test(card), 'no 50.0% at n = 4');
  assert.ok(/data-ma-gate="small"[^>]*>71\.4%/.test(card), 'n = 7: greyed');
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
  assert.ok(text(h).includes('First round · neither player has a match at Chengdu yet'));
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
  assert.ok(text(h).includes('no record of this round'));
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
  const cells = h.split('class="seg pg-cell').slice(1);
  const played = cells.filter(c => /beat /.test(c.slice(0, 400)));
  assert.equal(played.length, 4, 'four played cells');
  assert.ok(played.every(c => /^[^>]*onclick="event\.stopPropagation\(\); maOpenRowSheet\('mr\d+', this\)"/.test(c)), 'each opens the shared sheet');
  const id = /maOpenRowSheet\('(mr\d+)', this\)/.exec(played[0])[1];
  assert.equal(S._maRowReg[id].round, 'R1', 'the sheet gets the draw\'s round label');
  assert.ok(/class="seg pg-hcell" onclick="event\.stopPropagation\(\); maOpenRowSheet/.test(h), 'a heat cell opens it too');
  const code = PG;
  assert.ok(!/elotip-pop|pg-tip|function pg\w*(Row|Tip)\w*\(/.test(code), 'no tab-local row / tooltip renderer');
  assert.ok(!/PROGRESSION_TABLE_METRICS|\.tpg-|buildProgressionAiSummary|progressionPlot\(/.test(html), 'the old table renderer is deleted, not hidden');
});

// Mutation 'seeded numbers back in the unplayed-round placeholder'
test('no seeded data: an unplayed round\'s blurred placeholder carries no numbers', () => {
  const h = S.buildMatchProgressionSection(match('QF', [row('2026-09-24', 'R1', 'A. Shevchenko', W)], []));
  const fut = h.split('filter:blur(3.5px)').slice(1).map(x => x.slice(0, x.indexOf('</div>')));
  assert.ok(fut.length >= 2);
  assert.ok(fut.every(f => !/\d/.test(text('<x ' + f))), 'no digits: ' + fut.map(f => text('<x ' + f)).join(' | '));
  assert.ok(!/SAMPLE DATA|Sample data/.test(h), 'no sample chip');
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

// TEN-380 (step 3 reference, README §2 tiles): road cards are clickable tiles, THIS MATCH the raised tile, the metric
// chips one sideways row, heat cards on --edge-6 with no name accent, the better cell white 7%, the DRAW row upright.
test('TEN-380: road tiles, THIS MATCH --edge-24, Metrics title, chips on one row, heat-card styling', () => {
  const hA = [row('2026-09-24', 'R1', 'A. Shevchenko', W), row('2026-09-26', 'R2', 'M. Damm', W)];
  const m = match('QF', hA, [row('2026-09-24', 'R1', 'X. One', W), row('2026-09-26', 'R2', 'X. Two', W)]);
  setBox(m, 0, 0, BOX_A, BOX_B);
  const h = S.buildMatchProgressionSection(m);
  const tiles = h.split('class="seg pg-cell pg-tile"').slice(1);
  assert.equal(tiles.length, 4, 'every played road card is a tile');
  assert.ok(tiles.every(c => /^[^>]*background:var\(--card\); border:1px solid var\(--edge-7\)/.test(c)), 'tile = --card + --edge-7');
  assert.ok(/#aSectionProgression \.pg-tile:hover\{ background:var\(--tile-hover\) !important; border-color:var\(--edge-16\) !important; \}/.test(html), 'hover = --tile-hover + --edge-16');
  const now = h.slice(h.lastIndexOf('<div', h.indexOf('THIS MATCH')));
  assert.ok(/class="seg pg-cell"[^>]*border:1px solid var\(--edge-24\)/.test(h.slice(h.lastIndexOf('class="seg pg-cell"', h.indexOf('THIS MATCH')), h.indexOf('THIS MATCH'))), 'THIS MATCH = --edge-24');
  assert.ok(now.length > 0);
  assert.ok(/class="pg-met-head"[^>]*border-top:1px solid var\(--line\)/.test(h), 'Metrics section after a --line divider');
  assert.ok(/font-size:20px; font-weight:800;[^>]*>Metrics · round by round</.test(h), 'Metrics title 20/800');
  assert.ok(/class="pg-chips" style="[^"]*flex-wrap:nowrap; overflow-x:auto;/.test(h), 'chips on one sideways-scrolling row');
  assert.ok(/onclick="pgMet\('dominance'\)" style="[^"]*background:var\(--inner\); border:1px solid var\(--edge-10\)/.test(h), 'chip = --inner + --edge-10');
  assert.ok((h.match(/class="pg-card"[^>]*border:1px solid var\(--edge-6\)/g) || []).length === 9, 'heat cards --edge-6');
  assert.ok(!/border-left:2px solid/.test(h), 'no 2px name accent');
  assert.ok(!/font-style:italic/.test(h), 'DRAW row upright');
  assert.ok(/class="seg pg-hcell"[^>]*background:color-mix\(in srgb, var\(--text\) 7%, transparent\)/.test(h), 'better cell = white 7%');
  assert.ok(!/var\(--text-soft\)/.test(h), 'no --text-soft on the tab (greys are --text-label)');
});

// Founder Q7 / ruling 12 (TEN-380): the Facing row on a Darker track — only the rounds already played, each with both
// players' opponents from their results at this event; this match's round selected; no future round, no projected
// opponent; never "Bye" (the feed lists none). Mutations: a future round on the track; the current round not selected;
// a bye written from inference; the row missing on a first-round match.
test('Q7: Facing row — played rounds with their opponents, this match selected, nothing projected', () => {
  const hA = [row('2026-09-24', 'R1', 'A. Shevchenko', W), row('2026-09-26', 'R2', 'M. Damm', W)];
  const hB = [row('2026-09-24', 'R1', 'X. One', W), row('2026-09-26', 'R2', 'X. Two', W)];
  const h = S.buildMatchProgressionSection(match('QF', hA, hB));
  const f = h.slice(h.indexOf('class="pg-facing"'), h.indexOf('</div>', h.indexOf('class="pg-face-track"')) + 6);
  assert.ok(f.length > 50 && h.indexOf('class="pg-facing"') < h.indexOf('Tournament progression'), 'the row sits above the title');
  assert.match(f, /class="pg-face-track" style="display:flex; gap:3px; padding:3px; border-radius:9px; background:var\(--card\); border:1px solid var\(--edge-6\);/, 'Darker track');
  const segs = [...f.matchAll(/<span class="(seg pg-face|pg-face-cur)"[^>]*style="([^"]*)">([^<]*)<\/span>/g)].map(x => [x[1], x[2], x[3]]);
  assert.deepEqual(segs.map(x => x[2]), ['R1 · Shevchenko / One', 'R2 · Damm / Two', 'QF'], 'played rounds with opponents, then this match; no SF / F');
  assert.equal(segs[2][0], 'pg-face-cur');
  assert.match(segs[2][1], /font-size:12px; font-weight:700; color:var\(--text\); background:var\(--inner\); border:1px solid var\(--edge-10\);/, 'selected segment');
  assert.match(segs[0][1], /font-size:12px; font-weight:600; color:var\(--text-label\); background:transparent; border:1px solid transparent;/, 'idle segment');
  assert.ok(!/bye/i.test(f), 'no bye on the track');
  // a seed with no first-round row: the cell is inferred, so the track prints a dash, never "Bye"
  const h2 = S.buildMatchProgressionSection(match('QF', [row('2026-09-26', 'R2', 'M. Damm', W)], hB));
  const f2 = h2.slice(h2.indexOf('class="pg-facing"'), h2.indexOf('</div>', h2.indexOf('class="pg-face-track"')));
  assert.ok(!/bye/i.test(f2.replace(/title="[^"]*"/g, '')), 'no "Bye" written from inference');
  // first round: the current segment alone, above the empty state
  const h1 = S.buildMatchProgressionSection(match('R1', [], []));
  const f1 = h1.slice(h1.indexOf('class="pg-facing"'), h1.indexOf('</div>', h1.indexOf('class="pg-face-track"')));
  assert.deepEqual([...f1.matchAll(/<span class="(?:seg pg-face|pg-face-cur)"[^>]*>([^<]*)<\/span>/g)].map(x => x[1]), ['R1']);
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
  const f = h.slice(h.indexOf('class="pg-facing"'), h.indexOf('</div>', h.indexOf('class="pg-face-track"')) + 6);
  const segs = [...f.matchAll(/<span class="(seg pg-face|pg-face-cur)"[^>]*>([^<]*)<\/span>/g)].map(x => [x[1], x[2]]);
  assert.deepEqual(segs.map(x => x[0]), ['pg-face-cur', 'seg pg-face', 'seg pg-face'], 'R1 selected, QF idle');
  assert.match(f, /onclick="pgHi\(0\)"[^>]*>QF</, 'the idle current round clears the highlight');
});
