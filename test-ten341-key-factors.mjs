// TEN-341 → TEN-380 (founder package step 3, Key factors locked 2026-10-03) — the Key factors tab rebuilt on the locked
// reference (`OFFICIAL VERSION 1.html`): ONE 6-column grid of eleven clickable tiles. Every check drives the page's REAL
// code — the TEN-263 block (Form + H2H + Market edge models, the gate, the tooltip), the DNA + Playing style blocks, the
// Odds tab's row model, the Weather model, the Tournament and Progression helpers, the News tab's article join and the
// Key factors block, sliced out of bsp-consult-dashboard.html and executed — and names the mutation that turns it red;
// tools/test-ten341-mutants.js applies each one to a copy of the page (TEN341_HTML).
//   · every box reads the tab it links to (never the reference's sample figures)
//   · walkovers count nowhere (N2); every rate through the one gate (D2); absent = "—", a genuine zero = 0
//   · founder TEN-380 rulings: Q3/ruling 8 bars leader solid / trailer 45%, figures white; Q11 Best soft pp a dash, Q12 no Soft avg, Q13 Recent form
//     on today's surface ("Last 10 · <Surface>"), Q14 court pace on the 0–100 index, no "usual"
//   · DoD 8: no tab-local match-row list or tooltip renderer, no native title, the old renderers deleted; no SAMPLE chip
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { slice as sliceFrom, constSrc, FNS as ODDS_FNS } from './tools/ten303-odds-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CORE = require('./market-edge-core.js');
const html = readFileSync(process.env.TEN341_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const slice = n => sliceFrom(n, html);
function between(a, b) { const i = html.indexOf(a), j = html.indexOf(b, i); assert.ok(i > 0 && j > i, 'block not found: ' + a.slice(0, 40)); return html.slice(i, j); }
const KF = between('/* ---------- KEY FACTORS TAB ---------- */', '/* ---------- PLAYING STYLE TAB ---------- */');
const TEN263 = between('/* =====================================================================\n   TEN-263 ', '/* ---------- TOURNAMENT SUB-TAB ---------- */');
const PS2 = between('// PLAYING STYLE — TEN-340', "// The modal header's two price pills");
const MDNA = between('const MDNA_AXES = [', '// =====================================================================\n// PLAYING STYLE — TEN-340');
const WX = between('const WX_CONFIG = {', 'function buildWeatherSection(');
const PG = between('const PG_RDS = [', 'function pgState(m)');
const PS_TOUR_META_SRC = /const PS_TOUR_META = \(\(\) => \{[\s\S]*?\n\}\)\(\);/.exec(html)[0];
const PS_ARCH_SRC = /const PS_ARCHETYPES = \[[\s\S]*?\n\];/.exec(html)[0];
// the Odds tab's row model (the shared harness list) minus the Key factors functions the KF block itself declares
const ODDS = ODDS_FNS.filter(n => !/^kf|^fhS$/.test(n));
const ODDS_CONSTS = ['ANALYSIS_P2_FILL', 'AODDS_STALE_MS', 'AODDS_LEGACY_BET365', 'AODDS_ORDER', 'AODDS_ALIAS', 'AODDS_AT_CLOCK', 'AODDS_CONFIG',
  'AODDS_BOOKS', 'AODDS_MARKET_TILES', 'AODDS_STEAM', 'AODDS_LINE_SHAPE', 'AODDS_DASH', 'AODDS_C', 'AODDS_RECV', 'AODDS_CHECKED'];
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
  function ensureFormRows(m){ return Promise.resolve(m); } function loadCareerHistory(){ return Promise.resolve([]); }
  function openPlayerProfileFromMatch(){}
  function loadMatchStatsIndex(){ return Promise.resolve(new Set()); } function loadSetStatsShard(){ return Promise.resolve(null); } const _setStatsShards = {};
  function loadPlayerStyles(){ return Promise.resolve(); } const _careerHistoryShards = {};
  function aHeaderOdds(m){ const b = m.bestOdds || {}; return { p1: b.p1 && b.p1.price ? b.p1.price.toFixed(2) : '', p2: b.p2 && b.p2.price ? b.p2.price.toFixed(2) : '' }; }
  let _aM = null; const _aBuilt = new Set(); function aBuilt(){ return false; } function aPaint(){}
  function ppEloForSurface(p, s){ return null; }
  const TOURNAMENT_CATALOG = [{ name: 'Basel', category: 'ATP 500' }];
  const COURT_CONDITIONS = {};
  let tourxMarketData = null, tourxMarketFailed = false;
  function newsTz(){ return 'UTC'; } function wxBoard(){ return []; } function newsPlayerFor(){ return null; }
  let _newsData = null;
  let _aOdds = { m:null, novig:false, market:'Match Winner', mv:null }; let _aoTipTimer = null, _aoTipFor = null;
  const _ocsOf = m => null; const buildOddsReduced = () => ''; const psEsc = x => String(x);
  let _trHoldData, _trHoldP = null;
  let tournamentProgression = { tournaments: {} };
  let modelOutput = { matches: {} };
  function meRender(){}
  ${PS_TOUR_META_SRC}
  ${PS_ARCH_SRC}
  ${ODDS_CONSTS.map(n => constSrc(n, html)).join('\n')}
  ${['escapeHtml', 'psShortName', 'psCellFor', 'psMirrorN', 'psSurfaceCellFor', 'psArchIndex', 'psArchFor', 'psFmtMeetDate', 'psRoundAbbr', 'psNormTour', 'psTourMeta',
     'psGroupMeetings', 'styleMeetRowsFor', 'ppCleanTournamentName', 'surnameFirstName', 'formIni', 'eventKeyOfMatch',
     'apiStartMs', 'h2hRoundLabel', 'maRoundName', 'trEditionsOf', 'trRoundWords', 'trClean', 'trIsRG', 'trSpeedNote', 'trHoldOf', 'trHoldTip', 'trHoldHtml',
     'trHeaderHtml', 'trKeyOf', 'trMarketFor', 'trSameEvent', 'trRowOf', 'trModelOf', 'newsParseTs', 'aNewsFeedOk', 'aNewsArticlesFor', 'aNewsStoryKey',
     'progressionByesCredible'].map(slice).join('\n')}
  ${['TR_RG_NOTE', 'TR_NO_SPEED', 'TR_RESULT', 'TR_MONO', 'TR_BEST_RANK'].map(n => constSrc(n, html)).join('\n')}
  ${/const A_NEWS_WINDOW_DAYS = \d+;/.exec(html)[0]}
  ${ODDS.map(slice).join('\n')}
  ${WX}
  ${TEN263}
  ${MDNA}
  ${PS2}
  ${PG}
  ${KF}
  return { buildKeyFactorsSection, kfStyleCard, kfFormCard, kfH2HCard, kfDnaCard, kfTourCard, kfOddsCard, kfOddsMove, kfWeatherCard, kfModelCard,
    kfProgCard, kfNewsCard, kfMeCard, trRoundWords, trHeaderHtml, fhFormPlayer, fhStateFor, meStateFor,
    STY, playerProfiles, set matrix(v){ psMatrixData = v; }, set dna(v){ _mdna = v; }, set hold(v){ _trHoldData = v; },
    set market(v){ tourxMarketData = v; }, set news(v){ _newsData = v; }, set model(v){ modelOutput = v; }, reset(){ _me = null; } };
`)(CORE);
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const vis = h => text(h.replace(/<span class="elotip-pop"[\s\S]*?<\/span><\/span>/g, ''));   // what shows without hovering
const CP = 'Counterpuncher', AB = 'Attacking Baseliner';
function matrix(){ return { minSampleN: 20, matrix: { [CP]: { [AB]: { pct: 43, n: 3100 } }, [AB]: { [CP]: { pct: 57, n: 3100 } }, [CP + 'x']: {} } }; }
function match(over){ return Object.assign({ id: 'past-777', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: '1', p2Key: '2', surface: 'hard', date: '2026-09-20', tour: 'ATP Basel' }, over || {}); }
function setup(){ S.matrix = matrix(); S.dna = { byKey: {}, meta: {} }; S.hold = undefined; S.market = null; S.news = null; S.model = { matches: {} }; S.reset();
  for (const o of [S.STY, S.playerProfiles]) for (const k of Object.keys(o)) delete o[k]; }
const head = h => text(h.slice(0, h.indexOf('</div>')));   // a box's one-line header

// ---------- Playing style ----------
// Each player's record vs the OPPONENT's archetype (the Playing style tab's ps2Record): Sinner (CP) vs Attacking
// Baseliners, Alcaraz (AB) vs Counterpunchers. Mutation: a walkover counted, or the tug drawn on the losses side.
const meet = (date, opp, won, result) => ({ date, opponent: opp, won, result });
function styleMatch(a, b){ return match({ _styleMeetLoaded: true, p1StyleMeetings: { [AB]: a }, p2StyleMeetings: { [CP]: b } }); }
test('Playing style: each player\'s record vs the opponent\'s style — pct, W–L, tug, "+N wins"; walkovers out (N2); the gate', () => {
  setup(); S.STY['J. Sinner'] = { archetype_label: CP }; S.STY['C. Alcaraz'] = { archetype_label: AB };
  const a = [...Array(8)].map((_, i) => meet('2025-0' + (i + 1) + '-10', 'Opp ' + i, i < 5, i < 5 ? '6-4 6-3' : '3-6 4-6')).concat([meet('2025-09-01', 'Ghost', true, 'W/O')]);
  const b = [meet('2024-01-01', 'X', false, '4-6 4-6'), meet('2024-02-01', 'Y', true, '6-4 3-6 6-2')];
  const h = S.kfStyleCard(styleMatch(a, b)), t = text(h);
  assert.match(head(h), /^Playing style Record vs style ›$/);
  assert.match(t, /Sinner vs Attacking Baseliners 63% 5–3 W \+2 wins L Alcaraz vs Counterpunchers — 1–1 W Level L/, '8 played (the w/o is out); n = 2 is below the gate: no %');
  assert.doesNotMatch(t, /Ghost/);
  assert.match(h, /right:50%; top:0; bottom:0; width:12\.5%; background:var\(--text-label\)/, 'the wins part from the centre, (5−3)/8 × 50%, small-sample grey');
  assert.match(h, /data-ma-gate="small"[^>]*color:var\(--text-label\)/, 'n = 8 → the small-sample grey');
});
// Mutation: the three latest replaced by the three oldest.
test('Playing style: "Recent vs this style" = his three latest meetings with that style, sets from his side', () => {
  setup(); S.STY['J. Sinner'] = { archetype_label: CP }; S.STY['C. Alcaraz'] = { archetype_label: AB };
  const a = [meet('2023-01-01', 'Oldest', true, '6-4 6-4'), meet('2025-06-01', 'Newest', false, '6-7(5) 6-4 3-6'), meet('2024-06-01', 'Middle', true, '7-6(3) 6-2'), meet('2024-01-01', 'Third', true, '6-1 6-1')];
  const h = S.kfStyleCard(styleMatch(a, []));
  assert.match(text(h), /Recent vs this style last 3 · sets L Newest 1–2 W Middle 2–0 W Third 2–0 No career meeting/);
  assert.doesNotMatch(text(h), /Oldest/);
  assert.match(h, /background:color-mix\(in srgb, var\(--neg\) 16%, transparent\);">L</, 'the W/L square: --pos / --neg at 16%');
});
// Mutation: an unclassified player gets a record (or "no meetings" instead of "not classified").
test('Playing style: unclassified and loading states dash, never a 0%', () => {
  setup(); S.STY['J. Sinner'] = { archetype_label: CP };
  const t = text(S.kfStyleCard(match({ _styleMeetLoaded: true })));
  assert.match(t, /Sinner Style not classified — W — L Alcaraz vs Counterpunchers — W — L/);
  assert.doesNotMatch(t, /\b0%/);
  S.STY['C. Alcaraz'] = { archetype_label: AB };
  assert.match(text(S.kfStyleCard(match())), /— W Loading… L .* Loading… Loading…/);
});

// ---------- Recent form ----------
// Form-shard rows (newest first), every level, from 2026-09-19 back one day each; opponents "Opp A", "Opp B" …
const L = i => 'Opp ' + String.fromCharCode(65 + i);
function formRows(wins, n, extra){
  const out = [];
  for (let i = 0; i < n; i++) out.push({ date: '2026-09-' + String(19 - i).padStart(2, '0'), opponent: L(i), tournament: 'Ev ' + i, round: 'R32', surface: 'Hard',
    result: i < wins ? '2 - 0' : '0 - 2', won: i < wins, sets: i < wins ? [{ p: 6, o: 3 }, { p: 6, o: 4 }] : [{ p: 3, o: 6 }, { p: 4, o: 6 }], retired: false, walkover: false, eventKey: 500 + i });
  return (extra || []).concat(out);
}
function formMatch(a, b, over){ return match(Object.assign({ _fhFormData: true, _fhFormRows: [a, b], _fhFormSrc: ['form', 'form'], _fhCloses: [null, null], _fhElo: null }, over || {})); }
const side = (h, s) => { const i = h.indexOf(`<div class="kf-form-side" data-kf-side="${s}"`), j = h.indexOf('<div class="kf-form-side"', i + 1); return h.slice(i, j > i ? j : undefined); };
const bars = h => [...h.matchAll(/class="kf-bar" data-won="(\d?)"/g)].map(x => x[1] === '1' ? 'W' : x[1] === '0' ? 'L' : '_').join('');
// Mutation: the bars read the raw rows (a walkover and the match itself become bars).
test('Recent form: the Form tab\'s rows — ten bars oldest → newest, a walkover is no bar (N2), the analysed match is not its own form', () => {
  setup();
  const wo = { date: '2026-09-19', opponent: 'W/O opp', tournament: 'Ev', round: 'R16', surface: 'Hard', result: '0 - 0', won: true, walkover: true, eventKey: 499 };
  const own = { date: '2026-09-20', opponent: 'C. Alcaraz', tournament: 'Basel', round: 'QF', surface: 'Hard', result: '2 - 0', won: true, eventKey: 777 };
  const h = S.kfFormCard(formMatch(formRows(3, 12, [own, wo]), formRows(5, 5)));
  assert.equal(bars(side(h, 'a')), 'LLLLLLLWWW', 'the last 10 played, oldest first');
  assert.equal(bars(side(h, 'b')), '_____WWWWW', 'five played: five empty slots, never a fake bar');
  assert.match(text(side(h, 'a')), /^J\. Sinner Record 3–7 v market — Expected wins —/);
  assert.doesNotMatch(side(h, 'a'), /W\/O opp|Alcaraz/);
  assert.match(side(h, 'a'), /data-aotip="[^"]*Last 10: 3–7 over the 10 latest matches on Hard at every level, walkovers excluded/, 'the count carries its population');
});
// Founder Q16 / parked Q13: the box reads the Form tab's DEFAULT view — today's surface — and says so in its meta.
// Mutation: the box counts all surfaces again ({ surf: 'all' }).
test('Q13 / Q16: Recent form = the Form tab\'s default rows (today\'s surface), meta "Last 10 · Hard"', () => {
  setup();
  const mix = [];
  for (let i = 0; i < 12; i++) mix.push({ date: '2026-09-' + String(19 - i).padStart(2, '0'), opponent: L(i), tournament: 'Ev ' + i, round: 'R32',
    surface: i % 2 ? 'Clay' : 'Hard', result: i % 2 ? '2 - 0' : (i < 6 ? '2 - 0' : '0 - 2'), won: i % 2 ? true : i < 6, sets: null, retired: false, walkover: false, eventKey: 600 + i });
  const m = formMatch(mix, []);
  const h = S.kfFormCard(m);
  assert.equal(S.fhStateFor(m).form.surf, 'Hard', 'the Form tab opens on today\'s surface (N1)');
  assert.match(head(h), /^Recent form Last 10 · Hard ›$/);
  assert.match(text(side(h, 'a')), /Record 3–3/, 'the 6 hard rows (3–3), not the 10 latest of every surface');
  assert.equal(bars(side(h, 'a')), '____LLLWWW');
  assert.match(head(S.kfFormCard(formMatch([], [], { surface: null }))), /^Recent form Last 10 ›$/);
  assert.match(text(S.kfFormCard(match({ _fhFormData: false }))), /Loading recent matches…/);
});
// Mutation: v market printed below the Form tab's FH_THIN priced floor, or its sign coloured backwards.
const closes = (rows, price, oppPrice) => ({ rows: rows.map(r => ({ date: r.date, opp: r.opponent, oppKey: null, won: r.won, P: [price, oppPrice], B: null })), cap: [] });
test('Recent form: v market + expected wins = the Form tab\'s market figures, gated on the priced sample (FH_THIN)', () => {
  setup();
  const rows = formRows(8, 10);
  const m = formMatch(rows, formRows(2, 3), { _fhCloses: [closes(rows, 1.5, 2.6), null] });
  const a = side(S.kfFormCard(m), 'a');
  const P = S.fhFormPlayer(m, 0, Object.assign({}, S.fhStateFor(m).form, { surf: 'Hard', role: 'all', wmode: 'n', n: 10 }));
  assert.ok(P.mktOk && P.np === 10, 'ten priced');
  const esc = v => v.replace('.', '\\.');
  assert.match(text(a), new RegExp(`Record 8–2 v market \\+${esc((P.winsP - P.expW).toFixed(1))} Expected wins ${esc(P.expW.toFixed(1))}`));
  assert.match(a, /class="kf-vm"[^>]*color:var\(--pos\)/);
  assert.match(text(side(S.kfFormCard(m), 'b')), /Record 2–1 v market — Expected wins —/, 'unpriced: dashes, never 0.0');
});
// Mutation: more than one line per family, or the rate printed past the gate.
test('Recent form: hot lines = the Form tab\'s collapsed table — the best line of each family, his name dropped, rate through the gate', () => {
  setup();
  const m = formMatch(formRows(7, 10), formRows(1, 2));
  const a = side(S.kfFormCard(m), 'a');
  const P = S.fhFormPlayer(m, 0, Object.assign({}, S.fhStateFor(m).form, { surf: 'Hard', role: 'all', wmode: 'n', n: 10 }));
  const fams = ['hc', 'tot', 'st'].map(f => P.hot.sc.scored.find(x => (x.L.g === 'gh' || x.L.g === 'sh' ? 'hc' : x.L.g) === f)).filter(Boolean);
  assert.equal((a.match(/class="kf-hot"/g) || []).length, fams.length, 'one row per family');
  const x = fams[0], nm = x.name.replace(/^Sinner /, '');
  assert.match(text(a), new RegExp('Hot lines ' + nm.replace(/[.+]/g, m => '\\' + m) + ' ' + Math.round(x.c / x.n * 100) + '%'));
  assert.match(text(side(S.kfFormCard(m), 'b')), /Hot lines Not enough matches to rank lines \(n=2\)/);
});

// ---------- Tournament ----------
// Mutation: a synthesised (withdrew) edition counted (N6), the Q25 wording reverted, or a fabricated tier.
test('Tournament: "City · TIER", the round as meta, the record here from the Tournament tab\'s model, "first appearance" (Q25)', () => {
  setup();
  const ed = (year, rows) => ({ year, won: rows.filter(r => r.won).length, lost: rows.filter(r => !r.won).length, matches: rows });
  const r = (round, won, result) => ({ round, won, result, opponent: 'X', date: null });
  const hist = { years: [ed(2025, [r('Final', true, '2 - 1'), r('Semi-finals', true, '2 - 0'), r('Quarter-finals', true, '2 - 0'), r('1/8-finals', true, '2 - 1')]),
    { year: 2024, won: 0, lost: 0, withdrew: true, matches: [] }, ed(2023, [r('Quarter-finals', false, '0 - 2'), r('1/8-finals', true, '2 - 0')])] };
  const h = S.kfTourCard(match({ tournamentRound: 'ATP Basel - 1/16-finals', p1TournamentHistory: hist, p2TournamentHistory: null,
    courtSpeed: { abstractSpeed: 1.4, speed: 98, altitude: 260, category: 'Fast' } }));
  assert.match(head(h), /^Tournament Round of 32 ›$/);
  const t = vis(h);
  assert.match(t, /Basel · ATP 500 Hard · hold —/);
  assert.match(t, /Sinner Record here Alcaraz 5–1 W–L first appearance Won 2025 Best —/, 'N6: the withdrawal is no edition');
  assert.match(h, /data-aotip="[^"]*5–1 in 6 main-draw matches over 2 editions at Basel, walkovers excluded/);
  assert.doesNotMatch(t, /no record on file/);
  const u = vis(S.kfTourCard(match({ tour: 'ATP Nowhere', courtSpeed: null })));
  assert.match(u, /^Tournament › Nowhere Hard · hold — — Court speed —/, 'an unknown event: the name alone; no court row: dashes');
});
// Parked Q14 + N4: the abstract speed and the pipeline's category; the knob on the 0–100 COURT_CONDITIONS index the
// category is cut on. Mutation: the knob placed on the abstract speed, or "usual" back.
test('Q14: court speed — abstract 2 dp, the N4 category, the knob on the 0–100 index; no "usual"', () => {
  setup();
  const h = S.kfTourCard(match({ courtSpeed: { abstractSpeed: 1.18, speed: 76, category: 'Fast' } }));
  assert.match(vis(h), /1\.18 Court speed Fast Slow Medium Fast/);
  assert.match(h, /class="kf-knob" data-idx="76" style="[^"]*left:76%/);
  assert.doesNotMatch(h, /usual/);
  assert.doesNotMatch(S.kfTourCard(match({ courtSpeed: { abstractSpeed: 1.18, category: 'Fast' } })), /kf-knob/, 'no index: no knob, never a guess');
});
// Mutation: the ROI tiles ungated, or coloured by the delta instead of the sign.
test('Tournament: ROI fav / ROI dog / Fav wins = tournament-market.json, gated on n, "±x.xpp vs tour avg" (Q14)', () => {
  setup();
  S.market = { baseline: { roiFav: -3, roiDog: -5, favRel: 66 }, tournaments: { Basel: { n: 120, roiFav: -2.2, roiDog: 1.04, favRel: 69, archiveNames: ['Swiss Indoors'] } } };
  const h = S.kfTourCard(match({ courtSpeed: null }));
  assert.match(vis(h), /−2\.2% ROI fav in line with tour avg \+1\.0% ROI dog \+6\.0pp vs tour avg 69% Fav wins/);
  assert.match(h, /class="kf-roi-fav"[\s\S]*?color:var\(--neg\)/, 'a negative ROI is red');
  assert.match(h, /class="kf-roi-dog"[\s\S]*?color:var\(--pos\)/);
  S.market = { baseline: { roiFav: -3, roiDog: -5, favRel: 66 }, tournaments: { Basel: { n: 3, roiFav: 9, roiDog: 9, favRel: 90 } } };
  assert.match(vis(S.kfTourCard(match())), /— ROI fav too few settled — ROI dog too few settled — Fav wins too few settled/, 'n = 3: no rate');
});
// Founder Q9: the event hold rate is the Tournament tab's own cell. Mutation: Key factors back on a count-less figure.
const HOLD = { events: { 1706: { name: 'Basel', names: ['Basel', 'ATP Basel'], held: 1600, games: 2012, matches: 86, years: ['2024', '2025'] } }, byName: { basel: '1706' } };
const holdCell = (h, cls) => { const i = h.indexOf(`class="${cls}"`); assert.ok(i > 0, cls); const a = h.lastIndexOf('<span class="elotip"', i);
  return h.slice(a, h.indexOf('</span></span>', h.indexOf('class="elotip-pop"', i)) + 14).replace(cls, 'CELL'); };
test('Q9: Key factors\' hold rate is the Tournament tab\'s cell — our box scores, every edition, n in the tooltip, no gate', () => {
  setup(); S.hold = HOLD;
  const m = match({ courtSpeed: { abstractSpeed: 1.4, speed: 98, altitude: 260, serviceHold: 82, category: 'Fast' } });
  const kf = S.kfTourCard(m), tab = S.trHeaderHtml(m);
  assert.match(vis(kf), /Hard · hold 80%/, '1,600 / 2,012 = 79.5% → 80%');
  assert.equal(holdCell(kf, 'kf-hold'), holdCell(tab, 'tr-hold'), 'the same cell on both tabs');
  assert.match(text(holdCell(kf, 'kf-hold')), /Service hold at Basel: 1,600 of 2,012 service games held \(n = 2,012\)/);
  assert.doesNotMatch(kf, /n not published|82%/);
  assert.match(S.kfTourCard(match({ tour: 'ATP Nowhere' })), /No box score on file for Nowhere, so no hold rate is shown\./);
  S.hold = null; assert.match(S.kfTourCard(m), /The event hold rate did not load/);
  S.hold = undefined; assert.match(S.kfTourCard(m), /Loading the event hold rate/);
});

// ---------- Odds ----------
const H = 3600e3, T0 = Date.parse('2026-09-19T08:00:00Z');
const ser = (a, b, n) => [...Array(n || 6)].map((_, i) => [new Date(T0 + i * H).toISOString(), +(a + (b - a) * i / ((n || 6) - 1)).toFixed(2)]);
function oddsMatch(books, meta, over){ return match(Object.assign({ id: 'past-9', finalScore: '6-4 6-4', startTs: new Date(T0 + 8 * H).toISOString(), oddsMovement: { market: 'Match Winner', capturedAt: new Date(T0 + 7 * H).toISOString(),
  chart: { books, meta } } }, over || {})); }
const cm = (group, extra) => Object.assign({ source: 'test', group, checkedAt: new Date(T0 + 7 * H).toISOString(), gaps: [] }, extra || {});
// Founder Q17: ONE ruled book, never the max price. Mutation: the preference dropped (the Odds tab's first live row wins).
test('Odds: ONE book for the whole box — Pinnacle, else Bet365, else the Odds tab\'s order; its open, now and vig-free Fair; no Soft avg (Q12)', () => {
  setup();
  const both = { 'Betfair Exchange (recorded by us)': { p1: ser(1.9, 1.7), p2: ser(2.0, 2.3) }, 'bet365 (api-tennis)': { p1: ser(1.8, 1.6), p2: ser(2.1, 2.4) } };
  const m = oddsMatch(both, { 'Betfair Exchange (recorded by us)': cm('sharp'), 'bet365 (api-tennis)': cm('soft') }, { bestOdds: { p1: { price: 9.9 }, p2: { price: 9.9 } } });
  const h = S.kfOddsCard(m), t = text(h);
  assert.match(head(h), /^Odds · Match winner bet365 · 2 books ›$/);
  assert.match(t, /Open Now J\. Sinner 1\.80 1\.60 Fair 1\.67 C\. Alcaraz 2\.10 2\.40 Fair 2\.50/, 'Bet365 before the exchange; never bestOdds; Fair = its latest matched pair, vig removed');
  assert.doesNotMatch(t, /Soft avg|9\.90/);
  assert.equal((h.match(/class="kf-spark"/g) || []).length, 2, 'its own series, one sparkline per player');
  assert.match(h, /<polyline points="[^"]+" style="fill:none; stroke:var\(--text\);" stroke-width="1\.5"/, 'line only, white, no fill');
  const withPin = Object.assign({ 'Pinnacle (api-tennis)': { p1: ser(1.75, 1.55), p2: ser(2.2, 2.5) } }, both);
  assert.match(head(S.kfOddsCard(oddsMatch(withPin, { 'Pinnacle (api-tennis)': cm('sharp'), 'Betfair Exchange (recorded by us)': cm('sharp'), 'bet365 (api-tennis)': cm('soft') }))),
    /Pinnacle · 3 books/, 'Pinnacle first');
});
// Mutation: the gap rule dropped (a gapped book's line joins the missing hours); the empty states.
test('Odds: a book with a feed gap draws no line (the box says so); no book → dashes + the Odds tab\'s words; loading', () => {
  setup();
  const g = oddsMatch({ 'bet365 (api-tennis)': { p1: ser(1.8, 1.6), p2: ser(2.1, 2.4) } },
    { 'bet365 (api-tennis)': cm('soft', { gaps: [[new Date(T0 + 2 * H).toISOString(), new Date(T0 + 3 * H).toISOString()]] }) });
  const x = S.kfOddsMove(g);
  assert.equal(x.mini.svg, ''); assert.match(x.mini.note, /left the feed for a while/);
  assert.doesNotMatch(S.kfOddsCard(g), /<polyline/);
  assert.match(text(S.kfOddsCard(g)), /left the feed for a while/);
  // Fair = the latest MATCHED pair (the Odds tab's No-vig): a later lone quote inside a feed gap pairs with nothing — the
  // price moves, Fair stays on the last pair (1.60 / 2.40 → 1.67)
  const lone = { 'bet365 (api-tennis)': { p1: ser(1.8, 1.6).concat([[new Date(T0 + 6 * H).toISOString(), 1.5]]), p2: ser(2.1, 2.4) } };
  const gap = [[new Date(T0 + 5.5 * H).toISOString(), new Date(T0 + 7.5 * H).toISOString()]];
  assert.match(text(S.kfOddsCard(oddsMatch(lone, { 'bet365 (api-tennis)': cm('soft', { gaps: gap }) }))), /J\. Sinner 1\.80 1\.50 Fair 1\.67/);
  assert.match(text(S.kfOddsCard(oddsMatch({}, {}))), /no prices › Open Now J\. Sinner — — Fair — C\. Alcaraz — — Fair — No prices in the feed for this match yet\./);
  const stale = oddsMatch({ 'bet365 (api-tennis)': { p1: ser(1.8, 1.6), p2: ser(2.1, 2.4) } }, { 'bet365 (api-tennis)': cm('soft', { checkedAt: new Date(Date.now() - 5 * H).toISOString() }) },
    { finalScore: null, startTs: new Date(Date.now() + 5 * H).toISOString() });
  assert.match(text(S.kfOddsCard(stale)), /No recent prices: every book on file was last checked over an hour ago\./);
  assert.match(text(S.kfOddsCard(match())), /Loading bookmaker odds…/);
});

// ---------- Playing style DNA (N10) ----------
function dnaSide(p, n){ const AX = ['serve', 'return', 'underPressure', 'dominanceRatio'], last52 = { sample: { matches: n } };
  AX.forEach((ax, i) => { last52[ax] = p[i] == null ? null : { rating: [300, 40.1, 55.2, 1.23][i] + i, pct: p[i] }; });
  return { surfaces: { Hard: { last52, sinceBase: { sample: { matches: n } }, elo: p[4] == null ? null : { rating: 2000, pct: p[4] } } } }; }
// Founder ruling 8 (TEN-380 Q3): per axis the leader's bar solid --viz-lead, the trailer's --viz-second (45%), values white.
// Mutation: the raw rating printed instead of the percentile; the bars toned per player, or the trailer solid; the DNA bars
// on --bar (white here).
test('DNA: five mirrored percentile rows, leader --viz-lead / trailer --viz-second per axis (ruling 8), "X leads N of 5 axes"', () => {
  setup(); S.dna = { byKey: { 1: dnaSide([58, 71, 44, 56, 74], 30), 2: dnaSide([62, 72, 80, 52, 48], 30) },
    meta: { percentiles: { last52: { Hard: { serve: { n: 212, population: 'ATP players, 10+ hard matches' } } } } } };
  const h = S.kfDnaCard(match());
  assert.match(head(h), /^Playing style DNA Last 52 weeks ›$/);
  assert.match(text(h), /J\. Sinner C\. Alcaraz 58 Serve 62 71 Return 72 44 Under pressure 80 56 Dominance ratio 52 74 Surface Elo 48 Percentile on tour · Alcaraz leads 3 of 5 axes/);
  assert.equal((h.match(/class="kf-dna-bar" style="width:/g) || []).length, 10);
  const fills = [...h.matchAll(/class="kf-dna-bar" style="width:(\d+)%;[^"]*background:([^;"]+);/g)].map(x => x[1] + ':' + x[2]);
  assert.deepEqual(fills, ['58:var(--viz-second)', '62:var(--viz-lead)', '71:var(--viz-second)', '72:var(--viz-lead)', '44:var(--viz-second)', '80:var(--viz-lead)',
    '56:var(--viz-lead)', '52:var(--viz-second)', '74:var(--viz-lead)', '48:var(--viz-second)'], 'blue fill (not --bar, white in #aSectionKey); the trailer at 45% on each axis');
  assert.doesNotMatch(h, /opacity/, 'the 45% is the token, not an opacity (the reference\'s 40% is not used)');
  assert.match(h, /data-aotip="[^"]*Rank among 212 ATP players, 10\+ hard matches/, 'the axis note: the population and its n');
  assert.match(h, /data-kf="dna"[^>]*onclick="aGoTab\('style'\)"/, 'the box opens the Playing style tab');
});
// Mutation: the floor dropped (a 6-match player's axes printed).
test('DNA: below the 10-match floor an axis is a dash, never a 0; only Surface Elo (no floor) compares; never style-radar.json (N10)', () => {
  setup(); S.dna = { byKey: { 1: dnaSide([90, 50, 60, 30, 70], 6), 2: dnaSide([20, 45, 55, 80, 65], 6) }, meta: {} };
  assert.match(text(S.kfDnaCard(match())), /— Serve — — Return — — Under pressure — — Dominance ratio — 70 Surface Elo 65 Percentile on tour · Sinner leads 1 of 1 axes/);
  S.dna = { byKey: { 1: dnaSide([90, 50, 60, 30, null], 6), 2: dnaSide([20, 45, 55, 80, null], 12) }, meta: {} };
  assert.match(text(S.kfDnaCard(match())), /Sinner: 6 Hard matches in the last 52 weeks, below the 10-match floor\./);
  assert.doesNotMatch(html, /fetch\([^)]*style-radar/, 'no fetch of the MCP radar anywhere in the page');
});

// ---------- Head to head ----------
function h2hMatch(rows, over){ return match(Object.assign({ _fhH2hData: true, _fhCh: [[], []], _fhCloses: [null, null], _fhElo: null, h2h: { matches: rows } }, over || {})); }
const mt = (date, won, extra) => Object.assign({ date, tournament: 'Ev', round: 'R16', surface: 'Hard', p1Won: won, result: won ? '2 - 1' : '1 - 2', level: 'ATP', eventKey: null }, extra || {});
// Mutation: the walkover filter dropped, a retirement dropped, or the tug drawn toward the trailer.
test('Head to head: the H2H tab\'s record — walkovers out (N2), a retirement counts, the tug toward the leader, the level mix in the meta', () => {
  setup();
  const h = S.kfH2HCard(h2hMatch([mt('2023-03-01', true), mt('2024-05-10', false, { tournament: 'Munich', level: 'CH' }), mt('2025-01-20', true, { result: '0 - 0', tournament: 'Ghost' }),
    mt('2024-11-02', true, { result: '1 - 0', tournament: 'Paris', surface: 'Clay' })]));
  assert.match(head(h), /^Head to head 3 meetings · incl\. 1 CH ›$/);
  assert.match(text(h), /J\. Sinner C\. Alcaraz 2 \+1 Sinner 1/, '3 played: the walkover ("0 - 0") is no meeting');
  assert.match(h, /class="kf-h2h-tug" data-lead="a" style="[^"]*right:50%; width:16\.6/);
  assert.match(text(h), /4 Sets won 3 — Tiebreaks — 1 Deciding sets 1 1 On hard 1/, 'sets from the scores (the retirement\'s 1–0 counts), no set scores = no tiebreak count, today\'s surface = the two hard meetings');
  assert.doesNotMatch(text(h), /Ghost/);
  // founder Q18: the whole box goes to the H2H tab — nothing inside it opens a sheet of its own
  assert.match(h, /^<div class="seg kf-card" data-kf="h2h" role="button" tabindex="0" onclick="aGoTab\('h2h'\)"/);
  assert.equal((h.match(/onclick=/g) || []).length, 1, 'one target: the H2H tab');
});
// Mutation: the tallies counted per meeting instead of per set, or the hot-line rows drawn on --inner.
test('Head to head: Sets won / Tiebreaks / Deciding sets = the H2H tab\'s tallies; hot lines = its best line per family, as panels', () => {
  setup();
  const rows = [mt('2022-01-01', true, { result: '2 - 1' }), mt('2023-01-01', false, { result: '0 - 2' }), mt('2024-01-01', true, { result: '2 - 0' })];
  const sets = [[{ p: 7, o: 6, pTb: 7, oTb: 5 }, { p: 3, o: 6 }, { p: 6, o: 4 }], [{ p: 4, o: 6 }, { p: 6, o: 7, pTb: 4, oTb: 7 }], [{ p: 6, o: 3 }, { p: 6, o: 2 }]];
  rows.forEach((r, i) => { r.eventKey = 900 + i; });
  const ch = rows.map((r, i) => ({ eventKey: 900 + i, sets: sets[i], retired: false, walkover: false }));
  const h = S.kfH2HCard(h2hMatch(rows, { _fhCh: [ch, []] }));
  assert.match(text(h), /4 Sets won 3 1 Tiebreaks 1 1 Deciding sets 0 2 On hard 1/);
  assert.ok((h.match(/class="kf-h2h-hot"/g) || []).length >= 1);
  assert.match(text(h), /Hot lines (Handicap|Totals|Sets & TB) /);
  assert.match(h, /class="kf-h2h-hot" style="[^"]*background:var\(--card\); border:1px solid var\(--edge-6\);/);
  assert.doesNotMatch(h, /var\(--inner\)/, 'never --inner');
});
// The empty state: 0 meetings is a genuine zero; every tally is absent ("—"). Mutation: the dashes replaced by 0s.
test('Head to head: 0 meetings → 0 and 0, every tally "—", the hot lines say why; loading → the loading line', () => {
  setup();
  const t = text(S.kfH2HCard(h2hMatch([])));
  assert.match(t, /^Head to head No meeting on record › J\. Sinner C\. Alcaraz 0 No meeting on record 0 — Sets won — — Tiebreaks — — Deciding sets — — On hard — Hot lines Not enough meetings to rank lines \(n=0\)$/);
  assert.match(text(S.kfH2HCard(match())), /Loading head-to-head…/);
});

// ---------- Progression ----------
const pgRow = (ri, won, pS, oS, pg) => ({ ri, won, pS, oS, wo: false, pg });
const pgm = o => ({ dominance: { v: o.dr, rp: { won: 40, total: 100 }, sp: { won: 70, total: 100 } }, serveRating: { v: o.sv }, returnRating: { v: 150 },
  firstServe: { v: 70, won: 70, total: 100 }, firstServeWon: { v: 80, won: 56, total: 70 }, secondServeWon: { v: 60, won: 18, total: 30 },
  wue: { v: 2, w: 20, u: 10 }, winners: { v: 20, won: 20, total: 100 }, pressure: { v: 55, won: 11, total: 20 } });
// Mutation: the figure read from one round instead of pooled, or Pressure points given a draw average (founder Q7).
test('Progression: the Progression tab\'s model — each road\'s record, nine pooled metrics, Pressure points kept (Q8) with no draw', () => {
  setup();
  const m = match({ tournamentRound: 'ATP Basel - Quarter-finals', _pg: { sides: [
    { key: '1', name: 'J. Sinner', loaded: true, rows: [pgRow(2, true, 2, 0, pgm({ dr: 1.5, sv: 300 })), pgRow(3, true, 2, 1, pgm({ dr: 1.7, sv: 310 }))] },
    { key: '2', name: 'C. Alcaraz', loaded: true, rows: [pgRow(2, true, 2, 1, pgm({ dr: 1.2, sv: 280 })), pgRow(3, true, 2, 0, pgm({ dr: 1.3, sv: 290 }))] }] } });
  const h = S.kfProgCard(m), t = text(h);
  assert.match(head(h), /^Progression avg R1–R2 ›$/);
  assert.match(t, /J\. Sinner 2 wins · sets 4–1 C\. Alcaraz 2 wins · sets 4–1/);
  assert.match(t, /305 Serve rating draw — 285/, 'the mean of his two rounds, not one round');
  assert.match(t, /55\.0% Pressure points draw — 55\.0%/);
  assert.equal((h.match(/class="kf-pg-m"/g) || []).length, 9);
  const e = text(S.kfProgCard(match({ tournamentRound: 'ATP Basel - 1/16-finals', _pg: { sides: [{ key: '1', rows: [], loaded: true }, { key: '2', rows: [], loaded: true }] } })));
  assert.match(e, /^Progression first round › J\. Sinner no round here yet C\. Alcaraz no round here yet — Dominance ratio draw — —/, 'no round: dashes');
  assert.match(text(S.kfProgCard(match())), /Loading tournament progression…/);
});

// ---------- News ----------
const art = (k, key, title, hoursAgo) => ({ news_key: k, player_key: key, title, published_at: new Date(Date.now() - hoursAgo * H).toISOString().replace('T', ' ').replace('Z', '') });
// Mutation: an article in both players' lists shown twice, or an article outside the 5-day window counted.
test('News: both players\' articles in the feed window, newest first, one shared article tagged BOTH', () => {
  setup();
  S.news = { articles: [art(1, '1', 'Sinner fit', 2), art(2, '2', 'Alcaraz racquet', 3), art(3, '1', 'Both set for final', 4), art(3, '2', 'Both set for final', 4),
    art(4, '1', 'Old news', 24 * 7), art(5, '9', 'Someone else', 1)] };
  const h = S.kfNewsCard(match()), t = text(h);
  assert.match(head(h), /^News 3 articles · last 5 days ›$/);
  assert.match(t, /(Today|Yesterday) Sinner Sinner fit (Today |Yesterday )?Alcaraz Alcaraz racquet (Today |Yesterday )?Both Both set for final$/);
  assert.doesNotMatch(t, /Old news|Someone else/);
  assert.match(h, /data-kf-news="ab"/);
  S.news = { articles: [] };
  assert.match(text(S.kfNewsCard(match())), /0 articles · last 5 days › No recent news for J\. Sinner or C\. Alcaraz\./);
  S.news = null;
  assert.match(text(S.kfNewsCard(match())), /Loading news…/);
  assert.match(text(S.kfNewsCard(match({ _kfNews: 'unavailable' }))), /News feed unavailable\./);
});

// TEN-380 review (founder 2026-10-04, "remove duplicates"; "no status dots"): two headlines in one player's feed whose first
// five words match (hyphens split words, case and punctuation ignored) are one story — only the newest shows, in the News box
// and on the News tab; a distinct story stays. The timeline is text only (no dot). Mutation: the story filter dropped, or a
// dot back on the item.
test('News: one story, one line (same first five words → the newest only); distinct stories stay; no timeline dot', () => {
  setup();
  S.news = { articles: [art(11, '2', 'Alcaraz Defends Best-of-Five Format at Grand Slams', 30), art(12, '2', 'Alcaraz Defends Best-of-Five Format, Calls Instead for Calendar Reform', 40),
    art(13, '2', 'Alcaraz Welcomes Ferrero\'s Expected Return to Coaching Circuit', 35)] };
  const h = S.kfNewsCard(match()), t = text(h);
  assert.match(head(h), /^News 2 articles · last 5 days ›$/);
  assert.match(t, /Best-of-Five Format at Grand Slams/); assert.doesNotMatch(t, /Calendar Reform/, 'the older re-write of the same story is hidden');
  assert.match(t, /Ferrero/, 'a different story stays');
  assert.ok(!/border-radius:50%/.test(h), 'no dot on a news item');
});

// ---------- Stennisfy Model ----------
// Founder 2026-08-02 + parked Q11: only Pinnacle prints a pp gap; the Best soft gap is a dash. Mutation: the soft gap
// computed (fairP − 1/softPx), the flag off another edge, or the empty state dropping the link.
test('Model: fair odd + its probability, SHARP / NO VALUE from the Pinnacle edge, Best soft first with a dashed gap (Q11), the Model page\'s net adjustment', () => {
  setup();
  const m = match({ id: 'up-3', valueSnapshot: { fairP1: 1 / 1.59, fairP2: 1 / 2.70, edgeVsPinnacleP1: 0.021, edgeVsPinnacleP2: -0.011 },
    pinnacleOpen: { p1: 1.63, p2: 2.49 }, bestOdds: { p1: { price: 1.66, bookmaker: 'Bet365' }, p2: { price: 2.67, bookmaker: 'Unibet' } } });
  const h = S.kfModelCard(m), t = text(h);
  assert.match(t, /^Stennisfy Model · adjusted model price vs the market · Hard Net adjustment — ›/);
  assert.match(t, /J\. Sinner SHARP VALUE 1\.59 Adjusted fair odd · 62\.9% Best soft — 1\.66 Bet365 Pinnacle \+2\.1pp 1\.63 1\.63/);
  assert.match(t, /C\. Alcaraz NO VALUE 2\.70 Adjusted fair odd · 37\.0% Best soft — 2\.67 Unibet Pinnacle −1\.1pp 2\.49 2\.49/);
  assert.equal((t.match(/[+−]\d+\.\dpp/g) || []).length, 2, 'exactly the two Pinnacle boxes carry a pp gap');
  assert.match(h, /class="kf-flag" style="[^"]*background:var\(--inner\); border:1px solid transparent;/, 'the flag chip is --inner, no edge');
  assert.match(h, /role="button" tabindex="0" onclick="openEdgeModelFromMatch\('up-3'\)"/);
  S.model = { matches: { 'up-3': { ok: true, stage2: { totalDeltaP1: -0.027 } } } };
  assert.match(text(S.kfModelCard(m)), /Net adjustment \+2\.7pp toward Alcaraz ›/);
  // a snapshot with no Pinnacle edge: no verdict at all (the flag reads that edge)
  assert.doesNotMatch(text(S.kfModelCard(match({ valueSnapshot: { fairP1: 0.45, fairP2: 0.55, edgeVsPinnacleP1: null, edgeVsPinnacleP2: null } }))), /VALUE/);
  // no value snapshot: the empty state with dashes, still a link (G31)
  const e = S.kfModelCard(match({ id: 'up-4' }));
  assert.match(text(e), /J\. Sinner — Adjusted fair odd Best soft — — — Pinnacle — — — .* The model has not published an adjusted fair price for this match yet\./);
  assert.doesNotMatch(text(e), /VALUE/);
  assert.match(e, /onclick="openEdgeModelFromMatch\('up-4'\)"/, 'the empty state links too');
});
// Mutation: "Now" read from the legacy books only, or the move read off unrounded prices.
test('Model: the Pinnacle box\'s now is the Odds tab\'s Pinnacle row (chart shape included); the move compares the prices as printed', () => {
  setup();
  const pin = { 'Pinnacle (api-tennis)': { p1: ser(1.63, 1.55), p2: ser(2.49, 2.60) } };
  const base = { valueSnapshot: { fairP1: 0.6, fairP2: 0.4, edgeVsPinnacleP1: 0.01, edgeVsPinnacleP2: -0.01 }, pinnacleOpen: { p1: 1.63, p2: 2.49 } };
  const t = text(S.kfModelCard(oddsMatch(pin, { 'Pinnacle (api-tennis)': cm('sharp') }, base)));
  assert.match(t, /Pinnacle \+1\.0pp 1\.55 1\.63 → 1\.55 · −4\.9%/);
  assert.match(S.kfModelCard(oddsMatch(pin, { 'Pinnacle (api-tennis)': cm('sharp') }, base)), /class="kf-move" style="color:var\(--pos\);">−4\.9%/, 'a shortening price is green (the reference)');
  assert.match(t, /Pinnacle −1\.0pp 2\.60 2\.49 → 2\.60 · \+4\.4%/);
  const flat = { 'Pinnacle (api-tennis)': { p1: ser(1.83, 1.82).concat([[new Date(T0 + 6 * H).toISOString(), 1.8137]]), p2: ser(2.2, 2.1).concat([[new Date(T0 + 6 * H).toISOString(), 2.1]]) } };
  assert.match(text(S.kfModelCard(oddsMatch(flat, { 'Pinnacle (api-tennis)': cm('sharp') }, Object.assign({}, base, { pinnacleOpen: { p1: 1.81, p2: 2.2 } })))), /1\.81 → 1\.81 · ±0\.0%/);
  const up = oddsMatch(pin, { 'Pinnacle (api-tennis)': cm('sharp', { checkedAt: new Date(Date.now() - 5 * H).toISOString() }) }, Object.assign({ id: 'up-8', finalScore: null, startTs: new Date(Date.now() + 5 * H).toISOString() }, base));
  assert.match(text(S.kfModelCard(up)), /Pinnacle \+1\.0pp 1\.63 1\.63 C\. Alcaraz/, 'a stale Pinnacle: no now');
});

// ---------- Market edge ----------
// Bo3 completed rows in the Market edge tab's shape (MarketEdgeCore.playerModel), dated before the match.
function meRows(price, wins, n){
  return [...Array(n)].map((_, i) => ({ day: 20000 + i, date: '2024-01-01', price, oppPrice: 2.5, book: 'P', won: i < wins, bo: 3, setsOk: true, complete: true,
    sets: i < wins ? [[6, 4], [6, 4]] : [[4, 6], [4, 6]], round: 'R32' }));
}
// Mutation: the tiles read another band than today's, or the top-2 lines lose their wash.
test('Market edge: today\'s price and band, the band\'s record / won / edge / 1u flat, the derived lines with the top two on --wash-4', () => {
  setup();
  const m = match({ id: 'up-20', bestOdds: { p1: { price: 1.54 }, p2: { price: 2.62 } }, tourBadge: 'ATP' });
  const E = S.meStateFor(m);
  E.state = ['ready', 'none']; E.data = [meRows(1.5, 7, 10), null];
  const h = S.kfMeCard(m), t = text(h);
  assert.match(head(h), /^Market edge · today's price band Career · closing odds ›$/);
  assert.match(t, /J\. Sinner Today 1\.54 Band 1\.41 – 1\.64 Record 7–3 10 priced Won 70\.0% needs 66\.7% Edge \+3\.3pp won − needs At 1u flat \+0\.5u yield \+5\.0%/);
  assert.match(t, /C\. Alcaraz Today 2\.62 Band — Record — Won — Edge — won − needs At 1u flat — yield — Derived lines All In band Δ No history on file for this player\./);
  assert.equal((h.match(/kf-me-line kf-me-top/g) || []).length, 2, 'the two most covered in-band lines');
  assert.match(h, /kf-me-top" style="[^"]*background:var\(--wash-4\);/);
  assert.match(h, /data-kf="marketedge"[^>]*onclick="aGoTab\('marketedge'\)"/);
  assert.match(text(S.kfMeCard(match({ id: 'up-21', tourBadge: 'ATP' }))), /Today — Band — .* Derived lines need today’s price\./);
});

// ---------- Weather ----------
function wxFile(nowMs){
  const t0 = Date.parse(new Date(nowMs).toISOString().slice(0, 10) + 'T00:00:00Z') + 86400e3;   // tomorrow 00:00Z
  const time = [...Array(24)].map((_, i) => new Date(t0 + i * H).toISOString());
  const k = v => time.map(() => v);
  return { v: 2, tz: 'UTC', source: 'Open-Meteo', fetchedAt: new Date(nowMs - H).toISOString(),
    hourly: { time, temp: k(23), humidity: k(71), wind: k(9), gusts: k(20), feels: k(24), rainChance: k(35), rainMm: k(0.2) },
    daily: { date: [new Date(t0).toISOString().slice(0, 10)], hi: [25], lo: [15], code: [2] }, _t0: t0 };
}
// Mutation: the box reads its own fields (m.weather) instead of the Weather tab's model at match time; "usual" back (Q14).
test('Weather: the Weather tab\'s model at match time — temp, sky + feels like, the verdict, four panels; court pace without "usual"', () => {
  setup();
  const f = wxFile(Date.now());
  const m = match({ id: 'upcoming-5', date: new Date(f._t0).toISOString().slice(0, 10), startTs: new Date(f._t0 + 14 * H).toISOString(), weather: { temperature: 99 },
    courtSpeed: { abstractSpeed: 0.98, speed: 58, category: 'Medium' }, _kfWx: { entry: { file: 'weather/x.json', tz: 'UTC' }, file: f, arch: null } });
  const t = text(S.kfWeatherCard(m));
  assert.match(t, /^Weather · at match time › 23° Cloudy · feels like 24° \w{3} \w{3} \d+ · 14:00 · outdoor .+ Basel · forecast updated .+? Wind 20 km\/h Heat 24° feels Rain 35% Court pace 0\.98 Medium$/);
  assert.doesNotMatch(t, /99|usual|Open-Meteo/);
  assert.match(text(S.kfWeatherCard(match({ _kfWx: { entry: { indoor: true }, file: null, arch: null } }))), /— — indoor Indoor event — weather not a factor\. Wind — km\/h Heat — feels Rain — Court pace —/);
  assert.match(text(S.kfWeatherCard(match())), /Loading forecast…/);
});

// Mutation: a feed string interpolated raw.
test('escaping: feed strings with markup render as text in every box', () => {
  setup();
  const x = '<img src=x onerror=alert(1)>';
  assert.doesNotMatch(S.kfTourCard(match({ tour: 'ATP ' + x })), /<img/);
  assert.doesNotMatch(S.kfH2HCard(h2hMatch([mt('2025-01-01', true, { tournament: x })])), /<img/);
  assert.doesNotMatch(S.kfStyleCard(match({ p1: x })), /<img/);
  S.news = { articles: [art(9, '1', x, 1)] };
  assert.doesNotMatch(S.kfNewsCard(match()), /<img/);
});

// ---------- the tab ----------
// Mutation: a box routed nowhere, the order changed, or the 6-column grid back to 3 columns.
test('the tab: one 6-column grid, gap 14 — eleven tiles in the reference\'s order and spans, each linking to its tab; the Model to its page', () => {
  setup();
  const h = S.buildKeyFactorsSection(match());
  assert.deepEqual([...h.matchAll(/data-kf="(\w+)"[^>]*onclick="([^"]+)"[^>]*style="grid-column:span (\d)/g)].map(x => x[1] + ':' + x[2] + ':' + x[3]),
    ["style:aGoTab('style'):2", "form:aGoTab('form'):2", "tournament:aGoTab('tournament'):2", "odds:aGoTab('odds'):3", "dna:aGoTab('style'):3",
     "h2h:aGoTab('h2h'):2", "progression:aGoTab('progression'):2", "news:aGoTab('news'):2", "model:openEdgeModelFromMatch('past-777'):6",
     "marketedge:aGoTab('marketedge'):6", "weather:aGoTab('weather'):6"]);
  assert.match(h, /class="kf-grid" style="display:grid; grid-template-columns:repeat\(6,minmax\(0,1fr\)\); gap:14px; align-items:stretch;"/);
  assert.doesNotMatch(h, /SAMPLE|Card grid|Matchup hero|Leans = |margin-top:18px/, 'no review chip, no variant, no extra margins');
  // every header is one line: the title never shrinks, the meta truncates, a grey ›
  const heads = [...h.matchAll(/<div class="kf-head"[^>]*>(.*?)<\/span><\/span><\/div>/g)];
  assert.equal(heads.length, 10, 'ten headers (Weather carries its title in its left column)');
  heads.forEach(x => { assert.match(x[1], /class="kf-title" style="flex:none;/); assert.match(x[1], /›$/); });
  assert.match(h, /class="kf-meta" style="[^"]*min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;/);
});
// Mutation: a native title (or a local tooltip / row renderer) back in the Key factors block.
test('DoD 8: no tab-local match-row list or tooltip renderer, no native title; the old renderers are deleted, not hidden', () => {
  assert.doesNotMatch(KF, /\stitle="/, 'no native title in the block');
  assert.doesNotMatch(KF, /elotip-pop|class="[^"]*tip-pop/, 'the one tooltip component only (maTipHtml / data-aotip)');
  assert.doesNotMatch(KF, /-row"|RowHtml|rowHtml|fhOpenSheet|maRowOnclick/, 'no match-row list and no sheet of its own: every box opens its tab');
  for (const f of ['buildKeyFactorsCards', 'buildKeyPanels', 'recentResultRowHtml', 'buildRecentResultsSection', 'keyCardHtml', 'unavailableKeyCardHtml',
    'akStyleBlock', 'akFormBlock', 'akH2HBlock', 'akDimEdgeBlock', 'akTournamentBlock', 'akOddsBlock', 'akOddsMoveSvg', 'akWeatherBlock', 'akModelBlock',
    'akProgressionBlock', 'akReadBlock', 'akCard', 'akSurname', 'altitudeLabel', 'kfDimCard', 'kfWeatherStrip', 'kfSeasonRec', 'kfStyleSentence'])
    assert.ok(!html.includes('function ' + f + '('), f + ' deleted');
  assert.doesNotMatch(html, /\.akeycard|\.akbento|\.arr-row|\.akm-/, 'their CSS deleted');
});
// Mutation: a literal colour in the Key factors block (the token file is the only palette, D1).
test('colours: the Key factors block writes tokens only — no literal hex or rgba (D1); tiles on --card + --edge-7', () => {
  const code = KF.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, 'no literal colour');
  assert.match(KF, /\n  card: 'var\(--card\)', edge: 'var\(--edge-7\)', panel: 'var\(--edge-6\)',/, 'tile = --card + --edge-7, panel edge --edge-6');
  assert.match(KF, /dna: 'var\(--viz-lead\)'/, 'the DNA fill is the blue data token, not --bar (white in #aSectionKey)');
  assert.match(html, /#aSectionKey \.kf-card:hover\{ border-color:var\(--edge-16\) !important; background:var\(--tile-hover\) !important; \}/);
});

// TEN-380 review F1: Key factors' Market edge prefetch never swaps the shared Market edge state to a match the modal no
// longer shows (opening another match while the loads were in flight painted the old match's Market edge into the new one).
// Mutation: the `_aM === m` guard dropped.
test('F1: a late Key factors Market edge load never loads a match the modal no longer shows', async () => {
  const calls = [];
  const run = (shown) => new Function('m', 'shown', 'calls', `
    let _aM = shown; const loadCareerHistory = () => Promise.resolve(), fhLoadCloses = () => Promise.resolve(), meLoadProfileShard = () => Promise.resolve();
    const meLoad = x => calls.push(x.id);
    ${slice('kfEnsureMarketEdge')}
    return kfEnsureMarketEdge(m);`)({ id: 'a', p1Key: 1, p2Key: 2 }, shown, calls);
  const a = { id: 'a', p1Key: 1, p2Key: 2 };
  await run({ id: 'b' });
  assert.deepEqual(calls, [], 'the modal moved on to b: no Market edge load for a');
  calls.length = 0;
  await new Function('m', 'calls', `let _aM = m; const loadCareerHistory = () => Promise.resolve(), fhLoadCloses = () => Promise.resolve(), meLoadProfileShard = () => Promise.resolve();
    const meLoad = x => calls.push(x.id); ${slice('kfEnsureMarketEdge')} return kfEnsureMarketEdge(m);`)(a, calls);
  assert.deepEqual(calls, ['a'], 'control: the shown match loads');
  assert.match(slice('meRender'), /E\.m !== _aM\) return;/, 'meRender never paints another match');
});
