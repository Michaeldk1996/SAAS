// TEN-341 → TEN-380 → the 2026-11-23 rebuild (design_handoff_match_analysis_2026-11-23, Key factors block kf3For): the
// Key factors tab is ONE wrapping flex row of eleven clickable boxes, built by match-analysis-v2.js (maKeyFactorsV2,
// kf*Box). Every check drives the REAL code: match-analysis-v2.js executed in one scope with the page's data models sliced
// out of bsp-consult-dashboard.html (the TEN-263 block — Form + H2H + Market edge models, the gate —, the DNA + Playing
// style blocks, the Odds tab's row model, the Weather model, the Tournament and Progression helpers, the Model page's
// verdict / book rules and the Key factors data helpers left in the page) — and names the mutation that turns it red;
// tools/test-ten341-mutants.js applies each one to a copy of the page (TEN341_HTML) or of match-analysis-v2.js (TEN341_MA2).
//   · every box reads the tab it opens (never the design's sample figures); nothing inside a box opens anything else (Q18)
//   · walkovers count nowhere (N2); every rate through the one gate (D2); absent = "—", a genuine zero = 0
//   · .claude/rules/modal-key-factors.md: the Model box = the Model page's own run and rules (brief 2026-11-23 item a),
//     the Tournament box's one name + tier, no Soft avg in Odds (Q12, kept pending STEP1 Q3), the hold rate with n (Q9)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { slice as sliceFrom, constSrc } from './tools/ten303-odds-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CORE = require('./market-edge-core.js');
// TEN-437: the H2H box's meetings are H2HCore.joinMeetings (h2h-core.js; window.H2HCore in the page).
globalThis.H2HCore = require('./h2h-core.js');
const html = readFileSync(process.env.TEN341_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const MA2 = readFileSync(process.env.TEN341_MA2 || join(HERE, 'match-analysis-v2.js'), 'utf8');
const slice = n => sliceFrom(n, html);
function between(a, b) { const i = html.indexOf(a), j = html.indexOf(b, i); assert.ok(i > 0 && j > i, 'block not found: ' + a.slice(0, 40)); return html.slice(i, j); }
const KF = between('/* ---------- KEY FACTORS TAB ---------- */', '/* ---------- PLAYING STYLE TAB ---------- */');
const TEN263 = between('/* =====================================================================\n   TEN-263 ', '/* ---------- TOURNAMENT SUB-TAB ---------- */');
const PS2 = between('// PLAYING STYLE — TEN-340', "// The modal header's two price pills");
const MDNA = between('const MDNA_AXES = [', '// =====================================================================\n// PLAYING STYLE — TEN-340');
const WX = between('const WX_CONFIG = {', 'function buildWeatherSection(');
const PG = between('const PG_RDS = [', 'function pgState(m)');
const EDGE = between('\nconst EDGE_SHARP = ', "\n// The model's Pinnacle anchor");
const PRED = /\nconst EDGE_PRED_EDGE = [\s\S]*?\nfunction edgeVerdicts\(e, m\)\{[\s\S]*?\n\}\n/.exec(html)[0];
const PS_TOUR_META_SRC = /const PS_TOUR_META = \(\(\) => \{[\s\S]*?\n\}\)\(\);/.exec(html)[0];
const PS_ARCH_SRC = /const PS_ARCHETYPES = \[[\s\S]*?\n\];/.exec(html)[0];
const ODDS = ['acctTzOffsetMin', 'cardStartMs', 'aOddsStartMs', 'aOddsStep', 'aOddsBooksOf', 'aOddsHasSeries', 'aOddsPulledAt', 'aOddsHM', 'aOddsDM',
  'aOddsStamp', 'aOddsWhen', 'aOddsFmt', 'aOddsMovePct', 'aOddsSrcTitle', 'aOddsGapsMs', 'aOddsInGap', 'aOddsPairTicks', 'aOddsNoVig', 'aOddsRowsOf',
  'aOddsMonotone', 'aOddsDispSeries', 'aOddsStatusOf', 'aOddsCardTile', 'initAOddsTips'];
const ODDS_CONSTS = ['ANALYSIS_P2_FILL', 'AODDS_STALE_MS', 'AODDS_LEGACY_BET365', 'AODDS_ORDER', 'AODDS_ALIAS', 'AODDS_AT_CLOCK', 'AODDS_CONFIG',
  'AODDS_BOOKS', 'AODDS_MARKET_TILES', 'AODDS_STEAM', 'AODDS_LINE_SHAPE', 'AODDS_DASH', 'AODDS_C', 'AODDS_RECV', 'AODDS_CHECKED', 'MX_BOOK_LABELS'];
const S = new Function('CORE', `
  const window = { MarketEdgeCore: CORE };
  const document = { addEventListener(){}, getElementById(){ return null; }, querySelector(){ return null; }, querySelectorAll(){ return []; },
    head: { appendChild(){} }, createElement(){ return { set textContent(v){} }; } };
  const console = { warn(){}, log(){} };
  const playerProfiles = {};
  let playerStyles = { byKey: { x: 1 } }, psMatrixData = null;
  const STY = {};
  function styleKey(n){ return n; }
  function ppStyleFor(n){ return STY[n] || null; }
  function formPanelHtml(){ return ''; } function ensureFormPanelTabs(){}
  function ensureFormRows(m){ return Promise.resolve(m); } function loadCareerHistory(){ return Promise.resolve([]); } function careerHistoryIdOf(){ return null; }   // TEN-437 D3: no shard id in these fixtures
  function openPlayerProfileFromMatch(){}
  function loadMatchStatsIndex(){ return Promise.resolve(new Set()); } function loadSetStatsShard(){ return Promise.resolve(null); } const _setStatsShards = {};
  function loadPlayerStyles(){ return Promise.resolve(); } const _careerHistoryShards = {};
  function aHeaderOdds(m){ const b = m.bestOdds || {}; return { p1: b.p1 && b.p1.price ? b.p1.price.toFixed(2) : '', p2: b.p2 && b.p2.price ? b.p2.price.toFixed(2) : '' }; }
  let _aM = null; const _aBuilt = new Set(); function aBuilt(){ return false; } function aPaint(){}
  function aAvatarHtml(name){ return '<span class="ini">' + escapeHtml(String(name || '')) + '</span>'; }
  function ppEloForSurface(p, s){ return null; }
  const TOURNAMENT_CATALOG = [{ name: 'Basel', category: 'ATP 500' }];
  const COURT_CONDITIONS = {};
  let tourxMarketData = null, tourxMarketFailed = false;
  function newsTz(){ return 'UTC'; } function wxBoard(){ return []; } function newsPlayerFor(){ return null; }
  let _newsData = null, WIRE = [], TICK = [];
  function newsWireItems(){ return WIRE; } function newsTickerItems(){ return TICK; }
  let _aOdds = { m:null, novig:false, market:'Match Winner', mv:null }; let _aoTipTimer = null, _aoTipFor = null;
  const _ocsOf = m => null; const buildOddsReduced = () => ''; const psEsc = x => String(x);
  let _trHoldData, _trHoldP = null;
  let tournamentProgression = { tournaments: {} };
  let modelOutput = { matches: {} }, _drawMatchStore = null;
  let mktLive = { byEvent: {}, beatAt: NaN };
  function mcSigSurKey(s){ const w = String(s || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(' '); return w[w.length - 1] || ''; }
  function meRender(){}
  ${PS_TOUR_META_SRC}
  ${PS_ARCH_SRC}
  ${ODDS_CONSTS.map(n => constSrc(n, html)).join('\n')}
  ${['escapeHtml', 'psShortName', 'psCellFor', 'psMirrorN', 'psSurfaceCellFor', 'psArchIndex', 'psArchFor', 'psFmtMeetDate', 'psRoundAbbr', 'psNormTour', 'psTourMeta',
     'psGroupMeetings', 'styleMeetRowsFor', 'ppCleanTournamentName', 'surnameFirstName', 'formIni', 'eventKeyOfMatch',
     'apiStartMs', 'h2hRoundLabel', 'maRoundName', 'trEditionsOf', 'trRoundWords', 'trClean', 'trName', 'trIsRG', 'trSpeedNote', 'trHoldOf', 'trHoldTip', 'trHoldHtml',
     'trKeyOf', 'trMarketFor', 'trArchiveNames', 'trSameEvent', 'trRowOf', 'trModelOf', 'newsParseTs', 'aNewsFeedOk', 'aNewsArticlesFor', 'aNewsStoryKey',
     'progressionByesCredible', 'mxBookLabel', 'mxOddsTxt', 'edgePredOf', 'edgeNoVig', 'edgeGapOf', 'openEdgeModelFromMatch'].map(slice).join('\n')}
  ${['TR_RG_NOTE', 'TR_NO_SPEED', 'TR_RESULT', 'TR_MONO', 'TR_BEST_RANK'].map(n => constSrc(n, html)).join('\n')}
  ${/const A_NEWS_WINDOW_DAYS = \d+;/.exec(html)[0]}
  ${ODDS.map(slice).join('\n')}
  ${EDGE}
  ${PRED}
  ${WX}
  ${TEN263}
  ${MDNA}
  ${PS2}
  ${PG}
  ${KF}
  ${MA2}
  const maKeyFactorsV2 = window.maKeyFactorsV2;
  return { buildKeyFactorsSection, fhFormPlayer, fhStateFor, meStateFor, trHoldHtml, STY, playerProfiles,
    set matrix(v){ psMatrixData = v; }, set dna(v){ _mdna = v; }, set hold(v){ _trHoldData = v; },
    set market(v){ tourxMarketData = v; }, set news(v){ _newsData = v; }, set wire(v){ WIRE = v; }, set tick(v){ TICK = v; },
    set model(v){ modelOutput = v; }, set store(v){ _drawMatchStore = v; }, set mkt(v){ mktLive = v; }, reset(){ _me = null; } };
`)(CORE);
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const CP = 'Counterpuncher', AB = 'Attacking Baseliner';
function matrix(){ return { minSampleN: 20, matrix: { [CP]: { [AB]: { pct: 43, n: 3100 } }, [AB]: { [CP]: { pct: 57, n: 3100 } }, [CP + 'x']: {} } }; }
function match(over){ return Object.assign({ id: 'past-777', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: '1', p2Key: '2', surface: 'hard', date: '2026-09-20', tour: 'ATP Basel', tourBadge: 'ATP' }, over || {}); }
function setup(){ S.matrix = matrix(); S.dna = { byKey: {}, meta: {} }; S.hold = undefined; S.market = null; S.news = null; S.wire = []; S.tick = [];
  S.model = { matches: {} }; S.store = null; S.mkt = { byEvent: {}, beatAt: NaN }; S.reset();
  for (const o of [S.STY, S.playerProfiles]) for (const k of Object.keys(o)) delete o[k]; }
// One box of the tab, by its data-kf key (the whole tab is rendered, as the modal does).
const BOX_START = '<div class="seg ma2-tile kf2-box"';
function box(m, key){ const h = S.buildKeyFactorsSection(m), i = h.indexOf(BOX_START + ' data-kf="' + key + '"'); assert.ok(i >= 0, 'box ' + key);
  const j = h.indexOf(BOX_START, i + 1); return j > i ? h.slice(i, j) : h.slice(i, h.lastIndexOf('</div></div>')); }
// a box's head: title + scope (the first column of its head row)
const head = h => text(h.slice(0, h.indexOf('›</span></div>') + 1));


// ---------- fixtures (the Form / H2H / Odds / Market edge / Weather shapes the tabs read) ----------
const meet = (date, opp, won, result) => ({ date, opponent: opp, won, result });
function styleMatch(a, b){ return match({ _styleMeetLoaded: true, p1StyleMeetings: { [AB]: a }, p2StyleMeetings: { [CP]: b } }); }
const L = i => 'Opp ' + String.fromCharCode(65 + i);
function formRows(wins, n, extra){
  const out = [];
  for (let i = 0; i < n; i++) out.push({ date: '2026-09-' + String(19 - i).padStart(2, '0'), opponent: L(i), tournament: 'Ev ' + i, round: 'R32', surface: 'Hard',
    result: i < wins ? '2 - 0' : '0 - 2', won: i < wins, sets: i < wins ? [{ p: 6, o: 3 }, { p: 6, o: 4 }] : [{ p: 3, o: 6 }, { p: 4, o: 6 }], retired: false, walkover: false, eventKey: 500 + i });
  return (extra || []).concat(out);
}
function formMatch(a, b, over){ return match(Object.assign({ _fhFormData: true, _fhFormRows: [a, b], _fhFormSrc: ['form', 'form'], _fhCloses: [null, null], _fhElo: null }, over || {})); }
const closes = (rows, price, oppPrice) => ({ rows: rows.map(r => ({ date: r.date, opp: r.opponent, oppKey: null, won: r.won, P: [price, oppPrice], B: null })), cap: [] });
const HOLD = { events: { 1706: { name: 'Basel', names: ['Basel', 'ATP Basel'], held: 1600, games: 2012, matches: 86, years: ['2024', '2025'] } }, byName: { basel: '1706' } };
const H = 3600e3, T0 = Date.parse('2026-09-19T08:00:00Z');
const ser = (a, b, n) => [...Array(n || 6)].map((_, i) => [new Date(T0 + i * H).toISOString(), +(a + (b - a) * i / ((n || 6) - 1)).toFixed(2)]);
function oddsMatch(books, meta, over){ return match(Object.assign({ id: 'past-9', finalScore: '6-4 6-4', startTs: new Date(T0 + 8 * H).toISOString(), oddsMovement: { market: 'Match Winner', capturedAt: new Date(T0 + 7 * H).toISOString(),
  chart: { books, meta } } }, over || {})); }
const cm = (group, extra) => Object.assign({ source: 'test', group, checkedAt: new Date(T0 + 7 * H).toISOString(), gaps: [] }, extra || {});
function dnaSide(p, n){ const AX = ['serve', 'return', 'underPressure', 'dominanceRatio'], last52 = { sample: { matches: n } };
  AX.forEach((ax, i) => { last52[ax] = p[i] == null ? null : { rating: [300, 40.1, 55.2, 1.23][i] + i, pct: p[i] }; });
  return { surfaces: { Hard: { last52, sinceBase: { sample: { matches: n } }, elo: p[4] == null ? null : { rating: 2000, pct: p[4] } } } }; }
function h2hMatch(rows, over){
  const extra = new Map(((over && over._fhCh && over._fhCh[0]) || []).filter(x => x.eventKey != null).map(x => [x.eventKey, x]));
  const ch = rows.map(r => Object.assign({ date: r.date, tournament: r.tournament, round: r.round, surface: r.surface, opponent: 'C. Alcaraz', won: r.p1Won,
    result: r.result, level: r.level === 'ATP' ? 'atp' : 'chitf', eventKey: r.eventKey, ...(r.walkover ? { walkover: true } : {}) }, extra.get(r.eventKey) || {}));
  return match(Object.assign({ _fhH2hData: true, _fhCloses: [null, null], _fhElo: null }, over || {}, { _fhCh: [ch, []] }));
}
const mt = (date, won, extra) => Object.assign({ date, tournament: 'Ev', round: 'R16', surface: 'Hard', p1Won: won, result: won ? '2 - 1' : '1 - 2', level: 'ATP', eventKey: null }, extra || {});
const pgRow = (ri, won, pS, oS, pg) => ({ ri, won, pS, oS, wo: false, pg });
const pgm = o => ({ dominance: { v: o.dr, rp: { won: 40, total: 100 }, sp: { won: 70, total: 100 } }, serveRating: { v: o.sv }, returnRating: { v: 150 },
  firstServe: { v: 70, won: 70, total: 100 }, firstServeWon: { v: 80, won: 56, total: 70 }, secondServeWon: { v: 60, won: 18, total: 30 },
  wue: { v: 2, w: 20, u: 10 }, winners: { v: 20, won: 20, total: 100 }, pressure: { v: 55, won: 11, total: 20 } });
function meRows(price, wins, n){
  return [...Array(n)].map((_, i) => ({ day: 20000 + i, date: '2024-01-01', price, oppPrice: 2.5, book: 'P', won: i < wins, bo: 3, setsOk: true, complete: true,
    sets: i < wins ? [[6, 4], [6, 4]] : [[4, 6], [4, 6]], round: 'R32' }));
}
function wxFile(nowMs){
  const t0 = Date.parse(new Date(nowMs).toISOString().slice(0, 10) + 'T00:00:00Z') + 86400e3;   // tomorrow 00:00Z
  const time = [...Array(24)].map((_, i) => new Date(t0 + i * H).toISOString());
  const k = v => time.map(() => v);
  return { v: 2, tz: 'UTC', source: 'Open-Meteo', fetchedAt: new Date(nowMs - H).toISOString(),
    hourly: { time, temp: k(23), humidity: k(71), wind: k(9), gusts: k(20), feels: k(24), rainChance: k(35), rainMm: k(0.2) },
    daily: { date: [new Date(t0).toISOString().slice(0, 10)], hi: [25], lo: [15], code: [2] }, _t0: t0 };
}
// the two player columns of a two-column box: player two starts at his avatar (the white ring, RING_B)
const RING2 = '--ring:1.5px solid var(--ma2-text)';
const sideA = h => h.slice(0, h.indexOf(RING2)), sideB = h => h.slice(h.indexOf(RING2));
const COL = { text: 'var(--ma2-text)', grey: 'var(--ma2-grey)', quiet: 'var(--ma2-quiet)', green: 'var(--ma2-green)', red: 'var(--ma2-red)' };

// ---------- Playing style ----------
// Each player's record vs the OPPONENT's archetype (the Playing style tab's ps2Record): Sinner (CP) vs Attacking
// Baseliners, Alcaraz (AB) vs Counterpunchers. Mutation: a walkover counted, the gate dropped, or the tug on the losses side.
test('Playing style: each player\'s record vs the opponent\'s style — pct, W–L, tug, "+N wins"; walkovers out (N2); the D2 gate', () => {
  setup(); S.STY['J. Sinner'] = { archetype_label: CP }; S.STY['C. Alcaraz'] = { archetype_label: AB };
  const a = [...Array(8)].map((_, i) => meet('2025-0' + (i + 1) + '-10', 'Opp ' + i, i < 5, i < 5 ? '6-4 6-3' : '3-6 4-6')).concat([meet('2025-09-01', 'Ghost', true, 'W/O')]);
  const b = [meet('2024-01-01', 'X', false, '4-6 4-6'), meet('2024-02-01', 'Y', true, '6-4 3-6 6-2')];
  const h = box(styleMatch(a, b), 'style'), t = text(h);
  assert.match(head(h), /^Playing style Record against the opponent's style ›$/);
  assert.match(t, /J\. Sinner vs Attacking Baseliners 63% 5–3 Won \+2 wins Lost/, '8 played: the w/o is out');
  assert.match(t, /C\. Alcaraz vs Counterpunchers — 1–1 Won Level Lost/, 'n = 2 is below the gate: the count, no %');
  assert.doesNotMatch(t, /Ghost/);
  assert.match(h, /Sinner vs Attacking Baseliners: 5–3 in 8 career meetings on record, walkovers excluded\./, 'the count carries its population');
  assert.match(sideA(h), /right:50%; top:0; bottom:0; width:12\.5%; background:var\(--ma2-green\)/, 'the wins part from the centre, (5−3)/8 × 50%');
  assert.match(sideA(h), /font-size:22px; font-weight:700; line-height:1\.1; color:var\(--ma2-grey\);">63%/, 'n = 8 → the small-sample grey (5–9)');
  assert.doesNotMatch(t, /\b0%/);
});
// Mutation: the three latest replaced by the three oldest.
test('Playing style: "Last 3 against this style" = his three latest meetings with that style, sets from his side', () => {
  setup(); S.STY['J. Sinner'] = { archetype_label: CP }; S.STY['C. Alcaraz'] = { archetype_label: AB };
  const a = [meet('2023-01-01', 'Oldest', true, '6-4 6-4'), meet('2025-06-01', 'Newest', false, '6-7(5) 6-4 3-6'), meet('2024-06-01', 'Middle', true, '7-6(3) 6-2'), meet('2024-01-01', 'Third', true, '6-1 6-1')];
  const t = text(box(styleMatch(a, []), 'style'));
  assert.match(t, /Last 3 against this style Newest 1–2 Middle 2–0 Third 2–0 C\. Alcaraz/);
  assert.doesNotMatch(t, /Oldest/);
  assert.match(t, /Last 3 against this style No career meeting$/);
});
// Mutation: an unclassified player gets a record (or "no meetings" instead of "not classified").
test('Playing style: unclassified and loading states dash, never a 0%', () => {
  setup(); S.STY['J. Sinner'] = { archetype_label: CP };
  const t = text(box(match({ _styleMeetLoaded: true }), 'style'));
  assert.match(t, /J\. Sinner Style not classified — Won — Lost Last 3 against this style Not classified C\. Alcaraz C\. Alcaraz vs Counterpunchers — Won — Lost/, 'the opponent has no style: no record, a dash');
  assert.doesNotMatch(t, /\b0%/);
  S.STY['C. Alcaraz'] = { archetype_label: AB };
  assert.match(text(box(match(), 'style')), /Loading…/);
});

// ---------- Recent form ----------
const bars = h => [...h.matchAll(/<div (?:title="(Won|Lost)[^"]*" )?style="flex:1; height:6px;/g)].map(x => x[1] === 'Won' ? 'W' : x[1] === 'Lost' ? 'L' : '_').join('');
// Mutation: the bars read the raw rows (a walkover and the match itself become bars).
test('Recent form: the Form tab\'s rows — ten bars oldest → newest, a walkover is no bar (N2), the analysed match is not its own form', () => {
  setup();
  const wo = { date: '2026-09-19', opponent: 'W/O opp', tournament: 'Ev', round: 'R16', surface: 'Hard', result: '0 - 0', won: true, walkover: true, eventKey: 499 };
  const own = { date: '2026-09-20', opponent: 'C. Alcaraz', tournament: 'Basel', round: 'QF', surface: 'Hard', result: '2 - 0', won: true, eventKey: 777 };
  const h = box(formMatch(formRows(3, 12, [own, wo]), formRows(5, 5)), 'form');
  assert.equal(bars(sideA(h)), 'LLLLLLLWWW', 'the last 10 played, oldest first');
  assert.equal(bars(sideB(h)), '_____WWWWW', 'five played: five empty slots, never a fake bar');
  assert.match(text(sideA(h)), /J\. Sinner Record 3–7 Against market — Expected wins —/);
  assert.doesNotMatch(sideA(h), /W\/O opp|v C\. Alcaraz/);
});
// Founder Q16 / Q13: the box reads the Form tab's DEFAULT view — today's surface — and says so in its scope line.
// Mutation: the box counts all surfaces again ({ surf: 'all' }).
test('Q13 / Q16: Recent form = the Form tab\'s default rows (today\'s surface), scope "Last 10 · hard"', () => {
  setup();
  const mix = [];
  for (let i = 0; i < 12; i++) mix.push({ date: '2026-09-' + String(19 - i).padStart(2, '0'), opponent: L(i), tournament: 'Ev ' + i, round: 'R32',
    surface: i % 2 ? 'Clay' : 'Hard', result: i % 2 ? '2 - 0' : (i < 6 ? '2 - 0' : '0 - 2'), won: i % 2 ? true : i < 6, sets: null, retired: false, walkover: false, eventKey: 600 + i });
  const m = formMatch(mix, []);
  const h = box(m, 'form');
  assert.equal(S.fhStateFor(m).form.surf, 'Hard', 'the Form tab opens on today\'s surface (N1)');
  assert.match(head(h), /^Recent form Last 10 · hard ›$/);
  assert.match(text(sideA(h)), /Record 3–3/, 'the 6 hard rows (3–3), not the 10 latest of every surface');
  assert.equal(bars(sideA(h)), '____LLLWWW');
  assert.match(head(box(formMatch([], [], { surface: null }), 'form')), /^Recent form Last 10 ›$/);
  assert.match(text(box(match({ _fhFormData: false }), 'form')), /Loading recent matches…/);
});
// Mutation: against-market printed below the Form tab's FH_THIN priced floor, or its sign not coloured.
test('Recent form: against market + expected wins = the Form tab\'s market figures, gated on the priced sample (FH_THIN)', () => {
  setup();
  const rows = formRows(8, 10);
  const m = formMatch(rows, formRows(2, 3), { _fhCloses: [closes(rows, 1.5, 2.6), null] });
  const h = box(m, 'form');
  const P = S.fhFormPlayer(m, 0, Object.assign({}, S.fhStateFor(m).form, { surf: 'Hard', role: 'all', wmode: 'n', n: 10 }));
  assert.ok(P.mktOk && P.np === 10, 'ten priced');
  const esc = v => v.replace('.', '\\.');
  assert.match(text(sideA(h)), new RegExp(`Record 8–2 Against market \\+${esc((P.winsP - P.expW).toFixed(1))} Expected wins ${esc(P.expW.toFixed(1))}`));
  assert.match(sideA(h), new RegExp(`color:var\\(--ma2-green\\);">\\+${esc((P.winsP - P.expW).toFixed(1))}<`), 'a positive figure is green (signed value)');
  assert.match(sideA(h), /title="Against the market and expected wins on 10 of 10 priced \(closing odds\)\."/, 'the priced count');
  assert.match(text(sideB(h)), /Record 2–1 Against market — Expected wins —/, 'unpriced: dashes, never 0.0');
});
// Mutation: more than one line per family, or the rate printed past the gate.
test('Recent form: hot lines = the Form tab\'s collapsed table — the best line of each family, his name dropped, rate through the gate', () => {
  setup();
  const m = formMatch(formRows(7, 10), formRows(2, 3));
  const h = box(m, 'form'), a = sideA(h);
  const P = S.fhFormPlayer(m, 0, Object.assign({}, S.fhStateFor(m).form, { surf: 'Hard', role: 'all', wmode: 'n', n: 10 }));
  const fams = ['hc', 'tot', 'st'].map(f => P.hot.sc.scored.find(x => (x.L.g === 'gh' || x.L.g === 'sh' ? 'hc' : x.L.g) === f)).filter(Boolean);
  const lines = [...a.matchAll(/<div title="([^"]+): (\d+) of (\d+)/g)];
  assert.equal(lines.length, fams.length, 'one row per family');
  const x = fams[0], nm = x.name.replace(/^Sinner /, '');
  assert.match(text(a), new RegExp('Hot lines ' + (nm.charAt(0).toUpperCase() + nm.slice(1)).replace(/[.+]/g, c => '\\' + c) + ' ' + Math.round(x.c / x.n * 100) + '%'));
  assert.match(text(sideB(h)), /Hot lines .*2\/3/, 'n = 3: the count, no %');
  assert.doesNotMatch(text(sideB(h)), /\d%/);
});

// ---------- Tournament ----------
// Mutation: a synthesised (withdrew) edition counted (N6), the Q25 wording reverted, or a fabricated tier.
test('Tournament: "Name · TIER" (one name), the record here from the Tournament tab\'s model, "first appearance" (Q25)', () => {
  setup();
  const ed = (year, rows) => ({ year, won: rows.filter(r => r.won).length, lost: rows.filter(r => !r.won).length, matches: rows });
  const r = (round, won, result) => ({ round, won, result, opponent: 'X', date: null });
  const hist = { years: [ed(2025, [r('Final', true, '2 - 1'), r('Semi-finals', true, '2 - 0'), r('Quarter-finals', true, '2 - 0'), r('1/8-finals', true, '2 - 1')]),
    { year: 2024, won: 0, lost: 0, withdrew: true, matches: [] }, ed(2023, [r('Quarter-finals', false, '0 - 2'), r('1/8-finals', true, '2 - 0')])] };
  const h = box(match({ tournamentRound: 'ATP Basel - 1/16-finals', p1TournamentHistory: hist, p2TournamentHistory: null,
    courtSpeed: { abstractSpeed: 1.4, speed: 98, altitude: 260, category: 'Fast' } }), 'tournament');
  const t = text(h);
  assert.match(t, /^Tournament Swiss Indoors · ATP 500 · Hard · hold /);   // TEN-402 r3: the one event name; the tier from the catalog's data name
  assert.match(t, /5–1 Record — Won 2025 Best — .* Sets — Alcaraz · first appearance$/, 'N6: the withdrawal is no edition; Q25');
  assert.doesNotMatch(t, /no record on file|ATP 250/);
  const u = text(box(match({ tour: 'ATP Nowhere', courtSpeed: null }), 'tournament'));
  assert.match(u, /^Tournament Nowhere · Hard · hold /, 'an unknown event: the name alone, never a fabricated tier');
  assert.match(u, /— Court speed — Slow Fast/, 'no court reading: dashes');
  const f = text(box(match({ tour: 'ATP Nowhere', venue: { category: 'Nowhere' } }), 'tournament'));
  assert.match(f, /^Tournament Nowhere · Hard/, 'the tier is left out when it equals the name ("ATP Finals" never reads "ATP Finals · ATP Finals")');
});
// Founder Q9: the event hold rate is the Tournament tab's own cell (trHoldHtml): our box scores, every edition, n in the tooltip,
// no gate. Mutation: Key factors back on a count-less figure.
test('Q9: Key factors\' hold rate is the Tournament tab\'s cell — our box scores, every edition, n in the tooltip, no gate', () => {
  setup(); S.hold = HOLD;
  const m = match({ courtSpeed: { abstractSpeed: 1.4, speed: 98, altitude: 260, serviceHold: 82, category: 'Fast' } });
  const h = box(m, 'tournament');
  assert.ok(h.includes(S.trHoldHtml(m, 'kf-hold')), 'the same cell the Tournament tab prints');
  assert.match(text(h), /Hard · hold 80% Service hold at Swiss Indoors: 1,600 of 2,012 service games held \(n = 2,012\)/, '1,600 / 2,012 = 79.5% → 80%, n in the tooltip');
  assert.doesNotMatch(h, /n not published|82%/);
  assert.match(box(match({ tour: 'ATP Nowhere' }), 'tournament'), /No box score on file for Nowhere, so no hold rate is shown\./);
  S.hold = null; assert.match(box(m, 'tournament'), /The event hold rate did not load/);
  S.hold = undefined; assert.match(box(m, 'tournament'), /Loading the event hold rate/);
});
// Mutation: the ROI rows ungated, or coloured by the delta instead of the sign (tournaments.md: yield colour = sign).
test('Tournament: favourites win / return on favourites / on underdogs = tournament-market.json, gated on n, the gap to the tour', () => {
  setup();
  S.market = { baseline: { roiFav: -3, roiDog: -5, favRel: 66 }, tournaments: { Basel: { n: 120, roiFav: -2.2, roiDog: 1.04, favRel: 69, nRel: 124, archiveNames: ['Swiss Indoors'] } } };
  const h = box(match({ courtSpeed: null }), 'tournament');
  assert.match(text(h), /Favourites win 69% Return on favourites in line with tour −2\.2% Return on underdogs \+6\.0pp tour \+1\.0%/);
  assert.match(h, /title="Favourites win 69% of matches here \(n = 124\) versus 66% across the tour\."/, 'Fav wins carries its own n (nRel)');
  assert.match(h, /color:var\(--ma2-red\);">−2\.2%/, 'a negative return is red');
  assert.match(h, /color:var\(--ma2-green\);">\+1\.0%/, 'a positive return is green (by its sign, not its +6.0pp gap)');
  S.market = { baseline: { roiFav: -3, roiDog: -5, favRel: 66 }, tournaments: { Basel: { n: 3, roiFav: 9, roiDog: 9, favRel: 90, nRel: 3 } } };
  assert.match(text(box(match(), 'tournament')), /Favourites win — Return on favourites Too few settled — Return on underdogs Too few settled —/, 'n = 3: no rate');
});
// Q14 + N4: court speed from the one source (ma2CourtSpeed), never "usual". Mutation: "usual" back.
test('Q14: court speed — the reading at 2 dp, its 3-band label, the knob on the 0–100 index; no "usual"', () => {
  setup();
  const h = box(match({ courtSpeed: { abstractSpeed: 1.18, speed: 76, category: 'Fast' } }), 'tournament');
  assert.doesNotMatch(h, /usual/);
  assert.match(text(h), /^Tournament .* › 1\.18 Court speed Fast Slow Fast/, 'the reading at 2 dp and the 3-band label (N4), not re-banded');
  assert.match(h, /<span style="position:absolute; top:50%; left:76%;/, 'the knob on the 0–100 index');
  assert.doesNotMatch(box(match({ courtSpeed: { abstractSpeed: 1.18, category: 'Fast' } }), 'tournament'), /position:absolute; top:50%; left:/, 'no index: no knob, never a guess');
});

// ---------- Odds ----------
// Founder Q17: ONE book, never the max price. Mutation: the preference dropped (the Odds tab's first live row wins).
test('Odds: ONE book for the whole box — Pinnacle, else Bet365, else the Odds tab\'s order; its open, now and vig-free Fair; no Soft avg (Q12)', () => {
  setup();
  const both = { 'Betfair Exchange (recorded by us)': { p1: ser(1.9, 1.7), p2: ser(2.0, 2.3) }, 'bet365 (api-tennis)': { p1: ser(1.8, 1.6), p2: ser(2.1, 2.4) } };
  const m = oddsMatch(both, { 'Betfair Exchange (recorded by us)': cm('sharp'), 'bet365 (api-tennis)': cm('soft') }, { bestOdds: { p1: { price: 9.9 }, p2: { price: 9.9 } } });
  const h = box(m, 'odds'), t = text(h);
  assert.match(head(h), /^Odds Match winner · bet365 price, 2 bookmakers compared ›$/);
  assert.match(t, /Player Open Now Fair J\. Sinner J\. Sinner 1\.80 1\.60 1\.67 C\. Alcaraz C\. Alcaraz 2\.10 2\.40 2\.50/, 'Bet365 before the exchange; never bestOdds; Fair = its latest matched pair, vig removed');
  assert.doesNotMatch(t, /Soft avg|9\.90/);
  assert.equal((h.match(/<polyline /g) || []).length, 2, 'its own series, one sparkline per player');
  assert.doesNotMatch(h, /<polygon|fill:(?!none)/, 'line only, no area fill');
  const withPin = Object.assign({ 'Pinnacle (api-tennis)': { p1: ser(1.75, 1.55), p2: ser(2.2, 2.5) } }, both);
  assert.match(head(box(oddsMatch(withPin, { 'Pinnacle (api-tennis)': cm('sharp'), 'Betfair Exchange (recorded by us)': cm('sharp'), 'bet365 (api-tennis)': cm('soft') }), 'odds')),
    /Pinnacle price, 3 bookmakers compared/, 'Pinnacle first');
});
// Mutation: the gap rule dropped (a gapped book's line joins the missing hours); the empty states.
test('Odds: a book with a feed gap draws no line; Fair = the latest matched pair; no book → dashes + the Odds tab\'s words; loading', () => {
  setup();
  const g = oddsMatch({ 'bet365 (api-tennis)': { p1: ser(1.8, 1.6), p2: ser(2.1, 2.4) } },
    { 'bet365 (api-tennis)': cm('soft', { gaps: [[new Date(T0 + 2 * H).toISOString(), new Date(T0 + 3 * H).toISOString()]] }) });
  assert.doesNotMatch(box(g, 'odds'), /<polyline/);
  // a later lone quote inside a feed gap pairs with nothing — the price moves, Fair stays on the last pair (1.60 / 2.40 → 1.67)
  const lone = { 'bet365 (api-tennis)': { p1: ser(1.8, 1.6).concat([[new Date(T0 + 6 * H).toISOString(), 1.5]]), p2: ser(2.1, 2.4) } };
  const gap = [[new Date(T0 + 5.5 * H).toISOString(), new Date(T0 + 7.5 * H).toISOString()]];
  assert.match(text(box(oddsMatch(lone, { 'bet365 (api-tennis)': cm('soft', { gaps: gap }) }), 'odds')), /J\. Sinner J\. Sinner 1\.80 1\.50 1\.67/);
  assert.match(text(box(oddsMatch({}, {}), 'odds')), /no prices › Player Open Now Fair J\. Sinner J\. Sinner — — — C\. Alcaraz C\. Alcaraz — — — No prices in the feed for this match yet\./);
  const stale = oddsMatch({ 'bet365 (api-tennis)': { p1: ser(1.8, 1.6), p2: ser(2.1, 2.4) } }, { 'bet365 (api-tennis)': cm('soft', { checkedAt: new Date(Date.now() - 5 * H).toISOString() }) },
    { finalScore: null, startTs: new Date(Date.now() + 5 * H).toISOString() });
  assert.match(text(box(stale, 'odds')), /No recent prices: every book on file was last checked over an hour ago\./);
  assert.match(text(box(match(), 'odds')), /Loading bookmaker odds…/);
});

// ---------- Playing style DNA (N10) ----------
// Mutation: the raw rating printed instead of the percentile; the axis note dropped; the floor dropped.
test('DNA: five mirrored percentile rows (last 52 weeks), "X leads N of 5 axes", the axis note with its population and n; opens Playing style', () => {
  setup(); S.dna = { byKey: { 1: dnaSide([58, 71, 44, 56, 74], 30), 2: dnaSide([62, 72, 80, 52, 48], 30) },
    meta: { percentiles: { last52: { Hard: { serve: { n: 212, population: 'ATP players, 10+ hard matches' } } } } } };
  const h = box(match(), 'dna');
  assert.match(head(h), /^Playing style DNA \? Alcaraz leads 3 of 5 axes · last 52 weeks ›$/);
  assert.match(text(h), /58 Serve 62 71 Return 72 44 Under pressure 80 56 Dominance ratio 52 74 Surface Elo 48$/);
  const fills = [...h.matchAll(/<div style="width:(\d+)%; height:6px; border-radius:3px; background:([^;"]+);/g)].map(x => x[1] + ':' + x[2]);
  assert.deepEqual(fills, ['58:var(--ma2-blue)', '62:var(--ma2-text)', '71:var(--ma2-blue)', '72:var(--ma2-text)', '44:var(--ma2-blue)', '80:var(--ma2-text)',
    '56:var(--ma2-blue)', '52:var(--ma2-text)', '74:var(--ma2-blue)', '48:var(--ma2-text)'], 'the percentile as the bar (design: player one blue, player two white — STEP1 item 7)');
  assert.match(h, /title="Serve · Hard · last 52 weeks[^"]*Rank among 212 ATP players, 10\+ hard matches\."/, 'the axis note: the population and its n');
  assert.match(h, /data-kf="dna"[^>]*onclick="aGoTab\('style'\)"/, 'the box opens the Playing style tab');
});
test('DNA: below the 10-match floor an axis is a dash, never a 0; only Surface Elo (no floor) compares; never style-radar.json (N10)', () => {
  setup(); S.dna = { byKey: { 1: dnaSide([90, 50, 60, 30, 70], 6), 2: dnaSide([20, 45, 55, 80, 65], 6) }, meta: {} };
  const h = box(match(), 'dna');
  assert.match(text(h), /— Serve — — Return — — Under pressure — — Dominance ratio — 70 Surface Elo 65$/);
  assert.match(head(h), /Sinner leads 1 of 1 axes/);
  S.dna = { byKey: { 1: dnaSide([90, 50, 60, 30, null], 6), 2: dnaSide([20, 45, 55, 80, null], 12) }, meta: {} };
  assert.match(text(box(match(), 'dna')), /Sinner: 6 Hard matches in the last 52 weeks, below the 10-match floor\./);
  assert.doesNotMatch(html + MA2, /fetch\([^)]*style-radar/, 'no fetch of the MCP radar anywhere');
});

// ---------- Head to head ----------
// TEN-437: a meeting is a row in p1's career history naming C. Alcaraz (the box reads H2HCore.joinMeetings via fhMeetings).
// Mutation: the walkover filter dropped, a retirement dropped; Challengers back in the population (ATP rule).
test('Head to head: the H2H tab\'s record — walkovers out (N2), a retirement counts, Challengers out (ATP rule); one split bar; opens the H2H tab only (Q18)', () => {
  setup();
  const h = box(h2hMatch([mt('2023-03-01', true), mt('2024-05-10', false, { tournament: 'Munich' }), mt('2025-01-20', true, { result: '0 - 0', tournament: 'Ghost', walkover: true }),
    mt('2024-11-02', true, { result: '1 - 0', tournament: 'Paris', surface: 'Clay' }), mt('2022-06-01', false, { tournament: 'Heilbronn', level: 'CH' })]), 'h2h');
  assert.match(head(h), /^Head to head 3 meetings · ATP-official count ›$/);
  assert.doesNotMatch(text(h), /Heilbronn|Ghost/, 'the Challenger meeting and the walkover are not in the record');
  assert.match(text(h), /J\. Sinner C\. Alcaraz C\. Alcaraz 2 \+1 Sinner 1 /, '3 played: 2–1, the retirement counts');
  assert.match(h, /<span style="width:66\.7%; background:var\(--ma2-blue\);"><\/span><span style="flex:1; background:var\(--ma2-text\);">/, 'the record bar at 2 / 3');
  assert.match(text(h), /4 Sets won 3 — Tiebreaks — 1 Deciding sets 1 1 On hard 1/, 'sets from the scores (the retirement\'s 1–0 counts), no set scores = no tiebreak count, today\'s surface = the two hard meetings');
  assert.match(h, /^<div class="seg ma2-tile kf2-box" data-kf="h2h" role="button" tabindex="0" onclick="aGoTab\('h2h'\)"/);
  assert.equal((h.match(/onclick=/g) || []).length, 1, 'one target: the H2H tab');
});
// Mutation: the tallies counted per meeting instead of per set.
test('Head to head: Sets won / Tiebreaks / Deciding sets = the H2H tab\'s tallies; hot lines = its best line per family', () => {
  setup();
  const rows = [mt('2022-01-01', true, { result: '2 - 1' }), mt('2023-01-01', false, { result: '0 - 2' }), mt('2024-01-01', true, { result: '2 - 0' })];
  const sets = [[{ p: 7, o: 6, pTb: 7, oTb: 5 }, { p: 3, o: 6 }, { p: 6, o: 4 }], [{ p: 4, o: 6 }, { p: 6, o: 7, pTb: 4, oTb: 7 }], [{ p: 6, o: 3 }, { p: 6, o: 2 }]];
  rows.forEach((r, i) => { r.eventKey = 900 + i; });
  const ch = rows.map((r, i) => ({ eventKey: 900 + i, sets: sets[i], retired: false, walkover: false }));
  const h = box(h2hMatch(rows, { _fhCh: [ch, []] }), 'h2h');
  assert.match(text(h), /4 Sets won 3 1 Tiebreaks 1 1 Deciding sets 0 2 On hard 1/);
  const hot = text(h.slice(h.indexOf('>Hot lines<') + 1));
  assert.match(hot, /^Hot lines Covered Alcaraz −1\.5 sets 1 of 3 Sinner wins set 1 2 of 3$/, 'the best line per family, each with c of n');
  assert.doesNotMatch(hot, /\d%/, 'n = 3 is under the gate: no rate (D2)');
});
// Founder 2026-10-26 · Hot lines from ONE comparable meeting: counts, never a rate; only Bo5 meetings → "No best-of-3 meetings".
test('Head to head: 1 comparable meeting → each line "c of 1", no %; only Bo5 meetings → "No best-of-3 meetings"', () => {
  setup();
  const one = [mt('2024-01-01', true, { result: '2 - 0' })]; one[0].eventKey = 950;
  const h = box(h2hMatch(one, { _fhCh: [[{ eventKey: 950, sets: [{ p: 6, o: 3 }, { p: 6, o: 2 }], retired: false, walkover: false }], []] }), 'h2h');
  const hot = text(h.slice(h.indexOf('>Hot lines<') + 1));
  assert.match(hot, /1 of 1/, 'a line reads 1 of 1: ' + hot.slice(0, 160));
  assert.doesNotMatch(hot, /\d%/, 'no percentage');
  const b5 = [mt('2024-07-01', true, { result: '3 - 0', tournament: 'Wimbledon' })]; b5[0].eventKey = 951;
  const t5 = text(box(h2hMatch(b5, { _fhCh: [[{ eventKey: 951, sets: [{ p: 6, o: 3 }, { p: 6, o: 2 }, { p: 6, o: 4 }], retired: false, walkover: false }], []] }), 'h2h'));
  assert.match(t5, /Hot lines Covered No best-of-3 meetings$/);
});
// The empty state: 0 meetings is a genuine zero; every tally is absent ("—"). Mutation: the dashes replaced by 0s.
test('Head to head: 0 meetings → 0 and 0, every tally "—"; loading → the loading line', () => {
  setup();
  const t = text(box(h2hMatch([]), 'h2h'));
  assert.match(t, /^Head to head No meeting on record › J\. Sinner J\. Sinner C\. Alcaraz C\. Alcaraz 0 No meeting on record 0 — Sets won — — Tiebreaks — — Deciding sets — — On hard — Hot lines Covered No meetings$/);
  assert.match(text(box(match(), 'h2h')), /Loading head-to-head…/);
});

// ---------- Progression ----------
// Mutation: the figure read from one round instead of pooled, or Pressure points given a draw average (founder Q7).
test('Progression: the Progression tab\'s model — each road\'s record, nine pooled metrics, Pressure points kept (Q8) with no draw average (Q7)', () => {
  setup();
  const m = match({ tournamentRound: 'ATP Basel - Quarter-finals', _pg: { sides: [
    { key: '1', name: 'J. Sinner', loaded: true, rows: [pgRow(2, true, 2, 0, pgm({ dr: 1.5, sv: 300 })), pgRow(3, true, 2, 1, pgm({ dr: 1.7, sv: 310 }))] },
    { key: '2', name: 'C. Alcaraz', loaded: true, rows: [pgRow(2, true, 2, 1, pgm({ dr: 1.2, sv: 280 })), pgRow(3, true, 2, 0, pgm({ dr: 1.3, sv: 290 }))] }] } });
  const h = box(m, 'progression'), t = text(h);
  assert.match(head(h), /^Progression This tournament · average of R1–R2 ›$/);
  assert.match(t, /J\. Sinner J\. Sinner 2 wins · sets 4–1 C\. Alcaraz C\. Alcaraz 2 wins · sets 4–1/);
  assert.match(t, /305 Serve rating 285/, 'the mean of his two rounds, not one round');
  assert.match(t, /55\.0% Pressure points 55\.0%$/);
  assert.match(h, /title="Draw average —"[^>]*>Pressure points</, 'Q7: no draw average for Pressure points');
  assert.equal((h.match(/<div style="display:grid; grid-template-columns:1fr auto 1fr;/g) || []).length, 9, 'nine metrics');
  const e = text(box(match({ tournamentRound: 'ATP Basel - 1/16-finals', _pg: { sides: [{ key: '1', rows: [], loaded: true }, { key: '2', rows: [], loaded: true }] } }), 'progression'));
  assert.match(e, /No rounds played yet\. The figures start after the first round\.$/, 'no round: no figure');
  assert.doesNotMatch(e, /\d%/);
  assert.match(text(box(match(), 'progression')), /Loading tournament progression…/);
});

// ---------- News ----------
const H_ = 3600e3;
const wire = (id, keys, title, hoursAgo, cat) => ({ kind: 'wire', id, ts: Date.now() - hoursAgo * H_, cat: cat || 'Withdrawals & Injuries', title,
  players: keys.map(k => ({ key: k, name: k === '1' ? 'J. Sinner' : k === '2' ? 'C. Alcaraz' : 'X' })) });
// Mutation: an article outside the 5-day window counted, not newest first, or Tour News shown.
test('News: the News tab\'s items for either player in the 5-day window, newest first; an item on both players reads Both', () => {
  setup(); S.news = { articles: [] };
  S.wire = [wire('c', ['1', '2'], 'Both set for final', 4), wire('d', ['1'], 'Old news', 24 * 7), wire('b', ['2'], 'Alcaraz racquet', 3),
    wire('e', ['9'], 'Someone else', 1), wire('a', ['1'], 'Sinner fit', 2), wire('f', ['1'], 'Tour wrap', 1, 'Tour News')];   // fed out of order
  const h = box(match(), 'news'), t = text(h);
  assert.match(head(h), /^News 3 articles · last 5 days ›$/);
  assert.match(t, /J\. Sinner (Today|Yesterday) Sinner fit C\. Alcaraz (Today |Yesterday )?Alcaraz racquet Both (Today |Yesterday )?Both set for final$/);
  assert.doesNotMatch(t, /Old news|Someone else|Tour wrap/);
  assert.ok(!/border-radius:50%/.test(h), 'no dot on a news item (2026-10-04)');
  S.wire = [];
  assert.match(text(box(match(), 'news')), /0 articles · last 5 days › No recent news for J\. Sinner or C\. Alcaraz\./);
  S.news = null;
  assert.match(text(box(match(), 'news')), /Loading news…/);
  assert.match(text(box(match({ _kfNews: 'unavailable' }), 'news')), /News feed unavailable\./);
});
// TEN-380 review (founder 2026-10-04, "remove duplicates"): two outlet headlines on one player whose first five words match are
// one story — only the newest shows. Mutation: the story filter dropped.
test('News: one story, one line (same first five words → the newest only); distinct stories stay', () => {
  setup(); S.news = { articles: [] };
  S.wire = [wire('11', ['2'], 'Alcaraz Defends Best-of-Five Format at Grand Slams', 30), wire('12', ['2'], 'Alcaraz Defends Best-of-Five Format, Calls Instead for Calendar Reform', 40),
    wire('13', ['2'], 'Alcaraz Welcomes Ferrero\'s Expected Return to Coaching Circuit', 35)];
  const t = text(box(match(), 'news'));
  assert.match(t, /^News 2 articles · last 5 days ›/);
  assert.match(t, /Best-of-Five Format at Grand Slams/); assert.doesNotMatch(t, /Calendar Reform/, 'the older re-write of the same story is hidden');
  assert.match(t, /Ferrero/, 'a different story stays');
});

// ---------- Stennisfy Model ----------
// Founder brief 2026-11-23 item a (replaces the frozen valueSnapshot, the 0.5pp flag and Q11's dashed soft gap): the box is the
// Model page's own run and rules — model-output.json (else the draw store's copy), its adjusted fair odd, the page's verdict
// (edgeVerdicts), best soft (edgeBestSoft: never Pinnacle, the sharp tile's book or an exchange), sharp tile (edgeSharp) with
// open → now and the move, every gap edgeGapOf in pp. Mutations: the store fallback dropped; Pinnacle / an exchange as best
// soft; a gap off the soft price; the box stops linking to the Model page; the net adjustment ignored.
const RUN = { ok: true, stage2: { totalDeltaP1: -0.027 }, stage3: { fair: { p1: { prob: 0.629, odds: 1.59 }, p2: { prob: 0.371, odds: 2.70 } }, flags: [{ side: 'p1', type: 'Sharp Value' }] } };
const BOOKS = { bookNow: { Pncl: { p1: 1.55, p2: 2.60 }, bet365: { p1: 1.62, p2: 2.55 }, Unibet: { p1: 1.66, p2: 2.50 }, 'Betfair Exchange': { p1: 1.80, p2: 2.90 } },
  bookOpens: { Pncl: { p1: 1.63, p2: 2.49 } } };
test('Model: the Model page\'s fair odd + probability, its verdict, best soft (never Pinnacle or an exchange), Pinnacle open → now, both gaps, the net adjustment', () => {
  setup(); S.model = { matches: { 'up-3': RUN } };
  const h = box(match(Object.assign({ id: 'up-3' }, BOOKS)), 'model'), t = text(h);
  assert.match(head(h), /^Stennisfy Model \? Adjusted model price against the market · Hard · net adjustment \+2\.7pp toward C\. Alcaraz ›$/);
  assert.match(t, /J\. Sinner J\. Sinner Sharp value Adjusted fair odd · 62\.9% 1\.59 Best soft book \+2\.7pp 1\.66 At Unibet Pinnacle −1\.6pp 1\.55 Open 1\.63 · −4\.9%/,
    '62.9 − 100/1.66 = +2.7pp; 62.9 − 100/1.55 = −1.6pp; the move on the printed prices');
  assert.match(t, /C\. Alcaraz C\. Alcaraz Market side Adjusted fair odd · 37\.1% 2\.70 Best soft book −2\.1pp 2\.55 At Bet365 Pinnacle −1\.4pp 2\.60 Open 2\.49 · \+4\.4%$/,
    'Bet365 is a soft book when Pinnacle holds the sharp tile; the exchange\'s 2.90 never');
  assert.doesNotMatch(t, /1\.80|2\.90|SHARP VALUE|NO VALUE/);
  assert.match(h, /color:var\(--ma2-green\);[^>]*>Sharp value</, 'a value flag is green');
  assert.match(h, /^<div class="seg ma2-tile kf2-box" data-kf="model" role="button" tabindex="0" onclick="openEdgeModelFromMatch\('up-3'\)"/, 'the box opens the Model page for this match');
  assert.equal((h.match(/onclick=/g) || []).length, 1, 'nothing inside the box opens anything else (Q18)');
});
// Founder 2026-11-21 ("Also prediction markets!"): no bookmaker flag, the prediction market 3pp under the fair → its own verdict.
test('Model: a prediction-market value reads "Prediction market value"; no flag and no market → "No value"', () => {
  setup();
  const run = { ok: true, stage2: { totalDeltaP1: 0 }, stage3: { fair: { p1: { prob: 0.6, odds: 1.67 }, p2: { prob: 0.4, odds: 2.5 } }, flags: [], sharp: { edge: { p1: 0.01, p2: -0.01 } } } };
  S.model = { matches: { 'upcoming-555': run } };
  const oc = (a, b) => [{ name: 'Jannik Sinner', ask: a }, { name: 'Carlos Alcaraz', ask: b }];
  S.mkt = { byEvent: { '555|polymarket': { outcomes: oc(0.5, 0.5) } }, beatAt: NaN };
  const m = match({ id: 'upcoming-555' });
  assert.match(text(box(m, 'model')), /J\. Sinner J\. Sinner Prediction market value .* C\. Alcaraz C\. Alcaraz Market side/);
  assert.match(head(box(m, 'model')), /net adjustment 0\.0pp ›$/, 'a zero net adjustment names no player');
  S.mkt = { byEvent: {}, beatAt: NaN };
  assert.match(text(box(m, 'model')), /J\. Sinner J\. Sinner No value .* C\. Alcaraz C\. Alcaraz No value/);
});
test('Model: the draw store\'s copy when model-output.json no longer holds the match; no ok run → the note, still a link', () => {
  setup(); S.store = { matches: { 'past-31': { model: RUN } } };
  assert.match(text(box(match(Object.assign({ id: 'past-31' }, BOOKS)), 'model')), /Sharp value Adjusted fair odd · 62\.9% 1\.59/);
  const e = box(match({ id: 'up-4' }), 'model');
  assert.match(text(e), /› The model has not published an adjusted fair price for this match yet\.$/);
  assert.doesNotMatch(text(e), /value/i);
  assert.match(e, /onclick="openEdgeModelFromMatch\('up-4'\)"/, 'the empty state links too');
  S.model = { matches: { 'up-5': { ok: false } } };
  assert.match(text(box(match({ id: 'up-5' }), 'model')), /The model has not published an adjusted fair price for this match yet\./, 'a failed run is no price');
});
// openEdgeModelFromMatch closes the overlay first, then opens the Model page for that id (founder 2026-08-02).
test('Model: openEdgeModelFromMatch closes the modal first, then opens the Model page for that exact id', () => {
  const calls = [];
  new Function('calls', `const SfNav = { push: t => calls.push('nav:' + t) }, globalThis = { SfNav };
    function closeAnalysisModal(){ calls.push('close'); } function openEdgeModel(id){ calls.push('open:' + id); }
    ${slice('openEdgeModelFromMatch')} openEdgeModelFromMatch('up-3');`)(calls);
  assert.deepEqual(calls, ['nav:edge', 'close', 'open:up-3']);
});

// ---------- Market edge ----------
// Mutation: the tiles read another band than today's; the gate dropped.
test('Market edge: today\'s price (the header\'s) and its band; the band\'s record / won vs needs / edge / flat stake; the derived lines; the tab\'s gate', () => {
  setup();
  const m = match({ id: 'up-20', bestOdds: { p1: { price: 1.45 }, p2: { price: 2.62 } }, tourBadge: 'ATP' });   // 1.45 shares 1.36 – 1.50 with the 1.50 rows
  const E = S.meStateFor(m);
  E.state = ['ready', 'none']; E.data = [meRows(1.5, 7, 10), null];
  const h = box(m, 'marketedge'), t = text(h);
  assert.match(head(h), /^Market edge \? His record in today's price band · Career · closing odds ›$/);
  assert.match(t, /J\. Sinner J\. Sinner Price band 1\.36 – 1\.50 Today 1\.45 Record 7–3 10 priced Won 70\.0% Needs 66\.7% Edge \+3\.3pp Won − needs At flat 1% stake \+0\.5% Yield \+5\.0% Derived line All In band Diff Wins match 70% 70% ±0/);
  assert.match(t, /C\. Alcaraz C\. Alcaraz Price band — Today 2\.62 Record — Won — Needs — Edge — Won − needs At flat 1% stake — Yield — No history on file for this player\.$/);
  assert.match(h, /Retirements settle on Pinnacle rules for all rows\./, 'the help names the retirement rule (RET_SETTLE_NOTE)');
  assert.match(h, /data-kf="marketedge"[^>]*onclick="aGoTab\('marketedge'\)"/);
  assert.match(text(box(match({ id: 'up-21', tourBadge: 'ATP' }), 'marketedge')), /Today — .* Derived lines need today’s price\./);
  // the gate (TEN-380 review item 6): under n = 5 Won, Edge and the stake dash together; the record still shows
  const m3 = match({ id: 'up-22', bestOdds: { p1: { price: 1.45 }, p2: { price: 2.62 } }, tourBadge: 'ATP' });
  const E3 = S.meStateFor(m3); E3.state = ['ready', 'none']; E3.data = [meRows(1.5, 2, 3), null];
  assert.match(text(box(m3, 'marketedge')), /Record 2–1 3 priced Won — Needs [\d.]+% Edge — Won − needs At flat 1% stake — Yield/);
});

// ---------- Weather ----------
// Mutation: the box reads the card's own field (m.weather) instead of the Weather tab's model at match time; "usual" back (Q14).
test('Weather: the Weather tab\'s model at match time — temp, sky, the verdict, the factor boxes + court speed; indoor; loading', () => {
  setup();
  const f = wxFile(Date.now());
  const m = match({ id: 'upcoming-5', date: new Date(f._t0).toISOString().slice(0, 10), startTs: new Date(f._t0 + 14 * H).toISOString(), weather: { temperature: 99 },
    courtSpeed: { abstractSpeed: 0.98, speed: 58, category: 'Medium' }, _kfWx: { entry: { file: 'weather/x.json', tz: 'UTC' }, file: f, arch: null } });
  const t = text(box(m, 'weather'));
  assert.match(t, /^Weather at match time \w{3} \w{3} \d+ · 14:00 › 23° Cloudy .+ Rain Watch 35% chance .+ Wind No concern 20 km\/h gusts .+ Heat No concern 24° feels like .+ Court speed .+ 0\.98 Medium/);
  assert.doesNotMatch(t, /99|usual/);
  assert.doesNotMatch(t, /Forecast updated/i, 'a fresh forecast prints no freshness line (modal-weather.md, TEN-380)');
  assert.match(text(box(match({ _kfWx: { entry: { indoor: true }, file: null, arch: null } }), 'weather')), /^Weather at match time Indoor event › — Indoor event — weather not a factor\. Indoor event, weather is not a factor\.$/);
  assert.match(text(box(match(), 'weather')), /Loading the forecast…/);
});

// Mutation: a feed string interpolated raw.
test('escaping: feed strings with markup render as text in every box', () => {
  setup();
  const x = '<img src=x onerror=alert(1)>';
  assert.doesNotMatch(box(match({ tour: 'ATP ' + x }), 'tournament'), /<img/);
  assert.doesNotMatch(box(h2hMatch([mt('2025-01-01', true, { tournament: x })]), 'h2h'), /<img/);
  S.news = { articles: [] }; S.wire = [wire('x', ['1'], x, 1)];
  assert.doesNotMatch(box(match(), 'news'), /<img/);
});

// A player name (feed data) renders as text in every box (kfDnaBox's "why" scope line once leaked it raw; fixed 391b54fa3).
// Mutation: the DNA scope unescaped.
test('escaping — a player name with markup renders as text in every box', () => {
  setup();
  const x = '<img src=x onerror=alert(1)>';
  const leaks = ['model', 'odds', 'dna', 'marketedge', 'form', 'style', 'tournament', 'h2h', 'progression', 'news', 'weather'].filter(k => /<img/.test(box(match({ p1: x }), k)));
  assert.deepEqual(leaks, [], 'boxes that print a player name unescaped');
});

// ---------- the tab ----------
// .claude/rules/modal-key-factors.md "Build" (design 2026-11-23; replaces TEN-380's 6-column grid): one wrapping flex row, gap
// 14, max 1240; the boxes in the tab order, decision weight first, sized full / half / small; each opens its tab, the Model box
// the Model page. Mutation: a box routed nowhere, the order changed, a size changed.
test('the tab: one wrapping flex row (gap 14, max 1240) — eleven boxes in the design order and sizes, each opening its tab; the Model its page', () => {
  setup();
  const h = S.buildKeyFactorsSection(match());
  assert.match(h, /^<div class="kf2" style="max-width:1240px; margin:0 auto;[^"]*"><div style="display:flex; flex-wrap:wrap; gap:14px; align-items:stretch;">/);
  const B = { '100%': 'f', 'min(100%,440px)': 'h', 'min(100%,304px)': 's' };
  const got = [...h.matchAll(/<div class="seg ma2-tile kf2-box" data-kf="(\w+)" role="button" tabindex="0" onclick="([^"]+)"[^>]*style="order:(\d+); flex:1 1 ([^;]+);/g)]
    .map(x => [+x[3], x[1] + ':' + x[2] + ':' + B[x[4]]]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  assert.deepEqual(got, ["model:openEdgeModelFromMatch('past-777'):f", "odds:aGoTab('odds'):h", "dna:aGoTab('style'):h", "marketedge:aGoTab('marketedge'):f",
    "form:aGoTab('form'):s", "style:aGoTab('style'):s", "tournament:aGoTab('tournament'):s", "h2h:aGoTab('h2h'):s", "progression:aGoTab('progression'):s",
    "news:aGoTab('news'):s", "weather:aGoTab('weather'):f"]);
  assert.equal((h.match(/class="seg ma2-tile kf2-box"/g) || []).length, 11, 'eleven boxes');
  assert.equal((h.match(/class="seg ma2-tile kf2-box"[^>]*style="[^"]*background:var\(--ma2-card\); border:1px solid color-mix\(in srgb, var\(--ma2-white\) 6%, transparent\); border-radius:16px; padding:24px;/g) || []).length, 11,
    'every box one clickable card: --ma2-card, 1px 6% edge, r16, pad 24');
  assert.match(readFileSync(join(HERE, 'match-analysis-v2.css'), 'utf8'), /#analysisModal \.ma2-tile:hover\{ border-color:color-mix\(in srgb, var\(--ma2-white\) 22%, transparent\) !important; \}/, 'hover: the 22% edge');
  assert.match(h, /onkeydown="if\(event\.key==='Enter'\|\|event\.key===' '\)\{event\.preventDefault\(\);aGoTab\('odds'\)\}"/, 'a keyboard opens the box too');
  assert.doesNotMatch(h, /SAMPLE|Sample data/i, 'no review chip, no sample');
  assert.match(slice('buildKeyFactorsSection'), /return maKeyFactorsV2\(m\);/, 'the page delegates to the one builder');
});
// Founder Q18: nothing inside a box opens anything else — one onclick per box (the H2H Retry, which stops the box's click, aside).
test('Q18: every box has one click target, its own', () => {
  setup(); S.news = { articles: [] }; S.wire = [wire('a', ['1'], 'Sinner fit', 2)];
  const m = h2hMatch([mt('2023-03-01', true)], { _fhFormData: true, _fhFormRows: [formRows(6, 10), formRows(4, 10)], _fhFormSrc: ['form', 'form'] });
  for (const k of ['model', 'odds', 'dna', 'marketedge', 'form', 'style', 'tournament', 'h2h', 'progression', 'news', 'weather'])
    assert.equal((box(m, k).match(/onclick=/g) || []).length, 1, k);
});
// Mutation: an old renderer back (hidden, not deleted).
test('DoD 8: the old Key factors renderers are deleted, not hidden; the box draws no match-row list and no sheet of its own', () => {
  for (const f of ['kfLink', 'kfCard', 'kfHead', 'kfName', 'kfSignCol', 'kfVsRow', 'kfStyleCard', 'kfFormCard', 'kfTourCard', 'kfOddsMini', 'kfOddsMove', 'kfOddsCard',
    'kfDnaCard', 'kfH2HCard', 'kfProgCard', 'kfNewsItems', 'kfNewsCard', 'kfModelCard', 'kfMeCol', 'kfMeCard', 'kfWeatherCard',
    'buildKeyFactorsCards', 'buildKeyPanels', 'recentResultRowHtml', 'buildRecentResultsSection', 'keyCardHtml', 'unavailableKeyCardHtml',
    'akStyleBlock', 'akFormBlock', 'akH2HBlock', 'akDimEdgeBlock', 'akTournamentBlock', 'akOddsBlock', 'akOddsMoveSvg', 'akWeatherBlock', 'akModelBlock',
    'akProgressionBlock', 'akReadBlock', 'akCard', 'akSurname', 'altitudeLabel', 'kfDimCard', 'kfWeatherStrip', 'kfSeasonRec', 'kfStyleSentence'])
    assert.ok(!html.includes('function ' + f + '(') && !MA2.includes('function ' + f + '('), f + ' deleted');
  for (const c of ['KF_C', 'KF_CAP', 'KF_ONE', 'KF_PANEL', 'KF_NEWS_SHOWN']) assert.ok(!new RegExp('\\bconst ' + c + ' =').test(html), c + ' deleted');
  assert.doesNotMatch(html, /\.akeycard|\.akbento|\.arr-row|\.akm-|\.kf-card|#aSectionKey \.kf-/, 'their CSS deleted');
  const KFS = MA2.slice(MA2.indexOf('// ---------------------------------------------------------------- Key factors'), MA2.indexOf('root.maKeyFactorsV2'));
  assert.doesNotMatch(KFS + KF, /maMatchRowsHtml|fhOpenSheet|maRowOnclick/, 'no match-row list and no sheet: every box opens its tab');
});
// Mutation: a literal colour in the Key factors code (tokens.css is the only palette, D1 / TEN-376).
test('colours: the Key factors code writes tokens only — no literal hex or rgba (D1)', () => {
  const KFS = MA2.slice(MA2.indexOf('// ---------------------------------------------------------------- Key factors'), MA2.indexOf('root.maKeyFactorsV2'));
  for (const src of [KF, KFS]) {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, 'no literal colour');
  }
});
// CLAUDE.md non-negotiable: "Never highlight the better stat between two players with colour — both players' figures and text
// are the same colour" (bars excepted, ruling 8; Live's sheet excepted, TEN-417). Only the gate's grey and the quiet dash
// may differ. Mutation: the larger figure white, the other grey (as first rebuilt, fixed 391b54fa3).
test('neutral figures — both players\' figures in the DNA, Head to head and Progression boxes are the same colour', () => {
  setup(); S.dna = { byKey: { 1: dnaSide([58, 71, 44, 56, 74], 30), 2: dnaSide([62, 72, 80, 52, 48], 30) }, meta: {} };
  const figCols = (h, re) => [...h.matchAll(re)].map(x => x[1]);
  const dna = figCols(box(match(), 'dna'), /font-size:12\.5px; font-weight:700; color:([^;]+); min-width:22px;/g);
  const h2h = figCols(box(h2hMatch([mt('2023-03-01', true), mt('2024-05-10', true), mt('2025-05-10', false)]), 'h2h'), /font-size:26px; font-weight:700; line-height:1\.1; color:([^;]+);/g);
  const pm = match({ tournamentRound: 'ATP Basel - Quarter-finals', _pg: { sides: [
    { key: '1', name: 'J. Sinner', loaded: true, rows: [pgRow(2, true, 2, 0, pgm({ dr: 1.5, sv: 300 }))] },
    { key: '2', name: 'C. Alcaraz', loaded: true, rows: [pgRow(2, true, 2, 1, pgm({ dr: 1.2, sv: 280 }))] }] } });
  const pg = figCols(box(pm, 'progression'), /font-size:13px; font-weight:700; color:([^;]+);/g);
  // figures come in pairs (player one, player two) on one row; both players carry the same sample sizes here, so the gate's
  // grey cannot differ between them — a pair in two colours is the comparison highlight
  const split = c => c.filter((_, i) => i % 2 === 0).some((x, i) => x !== c[2 * i + 1]);
  assert.ok(dna.length === 10 && h2h.length === 2 && pg.length === 18, 'every figure found');
  const bad = Object.entries({ dna, h2h, pg }).filter(([, c]) => split(c)).map(([k]) => k);
  assert.deepEqual(bad, [], 'boxes that grey the trailing player\'s figure: ' + bad.join(', '));
});

// TEN-380 review F1: Key factors' Market edge prefetch never swaps the shared Market edge state to a match the modal no
// longer shows. Mutation: the `_aM === m` guard dropped.
test('F1: a late Key factors Market edge load never loads a match the modal no longer shows', async () => {
  const calls = [];
  const run = (m, shown) => new Function('m', 'calls', `
    let _aM = ${shown ? 'm' : "{ id: 'b' }"}; const loadCareerHistory = () => Promise.resolve(), fhLoadCloses = () => Promise.resolve(), meLoadProfileShard = () => Promise.resolve();
    const meLoad = x => calls.push(x.id);
    ${slice('kfEnsureMarketEdge')}
    return kfEnsureMarketEdge(m);`)(m, calls);
  const a = { id: 'a', p1Key: 1, p2Key: 2 };
  await run(a, false);
  assert.deepEqual(calls, [], 'the modal moved on to b: no Market edge load for a');
  await run(a, true);
  assert.deepEqual(calls, ['a'], 'control: the shown match loads');
  assert.match(slice('meRender'), /E\.m !== _aM\) return;/, 'meRender never paints another match');
});
