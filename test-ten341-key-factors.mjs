// TEN-341 (TEN-312 Key factors tab, founder brief 2026-09-28 / DoD item 8 2026-09-29) — the Key factors tab rebuilt on the
// design file (`keyFactorsFor`, variant `v.o` only). Every check drives the page's REAL code — the TEN-263 block (Form + H2H
// models, the gate, the tooltip), the DNA + Playing style blocks, the Odds tab's row model, the Weather model, the
// Tournament helpers and the Key factors block, sliced out of bsp-consult-dashboard.html and executed — and names the
// mutation that turns it red; tools/test-ten341-mutants.js applies each one to a copy of the page (TEN341_HTML).
//   · every card reads the tab it links to (never the file's internal samples): Playing style = ps2Edge, Recent form = the
//     Form tab's rows (fhFormPlayer) + the Overview season row, Head to head = the H2H tab's meetings, Dimension edge = the
//     five-axis DNA (N10, never style-radar.json), Tournament = the Tournament tab's editions, Odds = ONE book from the Odds
//     tab's rows, Weather = the Weather tab's model, Model = the value snapshot (empty state without one)
//   · walkovers count nowhere (N2); every rate through the one gate (D2); the hold rate is never a count-less %
//   · DoD 8: no tab-local row or tooltip renderer, no native title, the old renderers deleted; no SAMPLE chip / variants
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slice as sliceFrom, constSrc, FNS as ODDS_FNS } from './tools/ten303-odds-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN341_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const slice = n => sliceFrom(n, html);
function between(a, b) { const i = html.indexOf(a), j = html.indexOf(b, i); assert.ok(i > 0 && j > i, 'block not found: ' + a.slice(0, 40)); return html.slice(i, j); }
const KF = between('/* ---------- KEY FACTORS TAB ---------- */', '/* ---------- PLAYING STYLE TAB ---------- */');
const TEN263 = between('/* =====================================================================\n   TEN-263 ', '/* ---------- TOURNAMENT SUB-TAB ---------- */');
const PS2 = between('// PLAYING STYLE — TEN-340', "// The modal header's two price pills");
const MDNA = between('const MDNA_AXES = [', '// =====================================================================\n// PLAYING STYLE — TEN-340');
const WX = between('const WX_CONFIG = {', 'function buildWeatherSection(');
const PS_TOUR_META_SRC = /const PS_TOUR_META = \(\(\) => \{[\s\S]*?\n\}\)\(\);/.exec(html)[0];
const PS_ARCH_SRC = /const PS_ARCHETYPES = \[[\s\S]*?\n\];/.exec(html)[0];
// the Odds tab's row model (the shared harness list) minus the Key factors functions the KF block itself declares
const ODDS = ODDS_FNS.filter(n => !/^kf|^fhS$/.test(n));
const ODDS_CONSTS = ['ANALYSIS_P2_FILL', 'AODDS_STALE_MS', 'AODDS_LEGACY_BET365', 'AODDS_ORDER', 'AODDS_ALIAS', 'AODDS_AT_CLOCK', 'AODDS_CONFIG',
  'AODDS_BOOKS', 'AODDS_MARKET_TILES', 'AODDS_STEAM', 'AODDS_LINE_SHAPE', 'AODDS_DASH', 'AODDS_C', 'AODDS_RECV', 'AODDS_CHECKED'];
const S = new Function(`
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
  function openPlayerProfileFromMatch(){} function aGoTab(){}
  function loadMatchStatsIndex(){ return Promise.resolve(new Set()); } function loadSetStatsShard(){ return Promise.resolve(null); } const _setStatsShards = {};
  function loadPlayerStyles(){ return Promise.resolve(); } const _careerHistoryShards = {};
  function aHeaderOdds(m){ return { p1: '—', p2: '—' }; }
  let _aM = null; const _aBuilt = new Set(); function aBuilt(){ return false; } function aPaint(){}
  function ppEloForSurface(p, s){ return ELO[p.name] != null ? { rating: ELO[p.name] } : null; } const ELO = {};
  const TOURNAMENT_CATALOG = [{ name: 'Basel', category: 'ATP 500' }];
  function tourxBounce(){ return 'true'; } function tourxConditionsProse(s, c, v){ return 'PROSE ' + c + ' ' + v; }
  function newsTz(){ return 'UTC'; } function wxBoard(){ return []; }
  let _aOdds = { m:null, novig:false, market:'Match Winner', mv:null }; let _aoTipTimer = null, _aoTipFor = null;
  const _ocsOf = m => null; const buildOddsReduced = () => ''; const psEsc = x => String(x);
  const _ovProfileSettled = new Set(); const ovSeasonYear = () => '2026';
  let _trHoldData, _trHoldP = null;
  ${PS_TOUR_META_SRC}
  ${PS_ARCH_SRC}
  ${ODDS_CONSTS.map(n => constSrc(n, html)).join('\n')}
  ${['escapeHtml', 'psShortName', 'psCellFor', 'psMirrorN', 'psSurfaceCellFor', 'psArchIndex', 'psArchFor', 'psFmtMeetDate', 'psRoundAbbr', 'psNormTour', 'psTourMeta',
     'psGroupMeetings', 'styleMeetRowsFor', 'ppCleanTournamentName', 'surnameFirstName', 'formIni', 'eventKeyOfMatch', 'cellForTier', 'ovCareerByYear',
     'apiStartMs', 'h2hRoundLabel', 'trEditionsOf', 'trRoundWords', 'trClean', 'trIsRG', 'trSpeedNote', 'trHoldOf', 'trHoldTip', 'trHoldHtml',
     'trHeaderHtml'].map(slice).join('\n')}
  ${['TR_RG_NOTE', 'TR_NO_SPEED', 'TR_RESULT', 'TR_MONO'].map(n => constSrc(n, html)).join('\n')}
  ${ODDS.map(slice).join('\n')}
  ${WX}
  ${TEN263}
  ${MDNA}
  ${PS2}
  ${KF}
  return { buildKeyFactorsSection, kfStyleCard, kfFormCard, kfH2HCard, kfDimCard, kfTourCard, kfOddsCard, kfOddsMove, kfWeatherStrip, kfModelCard, trRoundWords,
    trHeaderHtml, fhFormPlayer, fhStateFor,
    STY, ELO, playerProfiles, _ovProfileSettled, set matrix(v){ psMatrixData = v; }, set dna(v){ _mdna = v; }, set hold(v){ _trHoldData = v; } };
`)();
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const vis = h => text(h.replace(/<span class="elotip-pop"[\s\S]*?<\/span><\/span>/g, ''));   // what shows without hovering
const CP = 'Counterpuncher', AB = 'Attacking Baseliner';
function matrix(){ return { minSampleN: 20, matrix: { [CP]: { [AB]: { pct: 43, n: 3100 } }, [AB]: { [CP]: { pct: 57, n: 3100 } }, [CP + 'x']: {} } }; }
function match(over){ return Object.assign({ id: 'past-777', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: '1', p2Key: '2', surface: 'hard', date: '2026-09-20', tour: 'ATP Basel' }, over || {}); }
function setup(){ S.matrix = matrix(); S.dna = { byKey: {}, meta: {} }; S.hold = undefined; for (const o of [S.STY, S.ELO, S.playerProfiles]) for (const k of Object.keys(o)) delete o[k]; S._ovProfileSettled.clear(); }
// Form-shard rows (newest first): results "2 - 0" / "0 - 2", every level, from 2026-09-19 back one day each.
function formRows(wins, n, extra){
  const out = [];
  for (let i = 0; i < n; i++) out.push({ date: '2026-09-' + String(19 - i).padStart(2, '0'), opponent: 'Opp ' + i, tournament: 'Ev ' + i, round: 'R32', surface: 'Hard',
    result: i < wins ? '2 - 0' : '0 - 2', won: i < wins, sets: null, retired: false, walkover: false, eventKey: 500 + i });
  return (extra || []).concat(out);
}
function formMatch(a, b, over){ return match(Object.assign({ _fhFormData: true, _fhFormRows: [a, b], _fhFormSrc: ['form', 'form'], _fhCloses: [null, null], _fhElo: null }, over || {})); }
const side = (h, s) => { const i = h.indexOf(`<div class="kf-form-side" data-kf-side="${s}"`), j = h.indexOf('<div class="kf-form-side"', i + 1); return h.slice(i, j > i ? j : undefined); };

// ---------- Playing style ----------
// Mutation: the matrix cell read in p2's direction (43 / 57 swap), or the gradient bar back.
test('Playing style: the matrix cell in p1\'s direction, the Playing style tab\'s words, a flat split bar', () => {
  setup(); S.STY['J. Sinner'] = { archetype_label: CP }; S.STY['C. Alcaraz'] = { archetype_label: AB };
  const h = S.kfStyleCard(match());
  assert.match(text(h), /Sinner Alcaraz CTR · Counterpuncher ATB · Attacking Baseliner 43% Style edge 57%/);
  assert.match(text(h), /Attacking Baseliners beat Counterpunchers 57% of the time across 3,100 tour meetings — Alcaraz has the style edge\./);
  assert.match(h, /class="kf-edge-bar"[^>]*><span style="width:43%;/, 'the bar = p1\'s share');
  assert.doesNotMatch(h, /gradient/, 'no gradient (flat colour only)');
});
// Mutation: the mirror falls through to the thin branch, or an unclassified player gets a %.
test('Playing style: a mirror is 50 / 50 "no archetype edge"; unclassified and below-floor pairings dash', () => {
  setup(); S.STY['J. Sinner'] = { archetype_label: CP }; S.STY['C. Alcaraz'] = { archetype_label: CP };
  assert.match(text(S.kfStyleCard(match())), /50% Style edge 50% Both are Counterpunchers — no archetype edge either way\./);
  delete S.STY['C. Alcaraz'];
  const u = text(S.kfStyleCard(match()));
  assert.match(u, /Not yet classified — Style edge — Alcaraz is not yet classified — no style edge\./);
  S.STY['C. Alcaraz'] = { archetype_label: 'Big Server' };   // a pairing with no rated cell
  assert.match(text(S.kfStyleCard(match())), /— Style edge — Counterpunchers v Big Servers: 0 tour meetings, below the 20-meeting floor — no win rate quoted\./);
});

// ---------- Recent form ----------
// Mutation: kfFormSide reads the raw rows instead of the Form tab's (P.shown) — a walkover becomes a pill.
test('Recent form: the Form tab\'s rows — a walkover is no pill and no count (N2), the analysed match is not its own form', () => {
  setup();
  const wo = { date: '2026-09-19', opponent: 'W/O opp', tournament: 'Ev', round: 'R16', surface: 'Hard', result: '0 - 0', won: true, walkover: true, eventKey: 499 };
  const own = { date: '2026-09-20', opponent: 'C. Alcaraz', tournament: 'Basel', round: 'QF', surface: 'Hard', result: '2 - 0', won: true, eventKey: 777 };
  const h = S.kfFormCard(formMatch(formRows(3, 12, [own, wo]), formRows(5, 5)));
  const a = side(h, 'a');
  assert.equal((a.match(/class="kf-pill"/g) || []).length, 5);
  assert.match(text(a), /^Sinner W W W L L Last 10 30%/, 'pills + Last 10 over played matches only (3 of 10)');
  assert.doesNotMatch(a, /W\/O opp|Alcaraz/);
});
// Mutation: the Last N rate bypasses the gate (a bare Math.round), or n = 0 prints "0%".
test('Recent form "Last N": 3 → the W–L, 7 → greyed + small sample, 12 → the last 10 full, 0 → "—" (D2)', () => {
  setup();
  const last = n => { const h = side(S.kfFormCard(formMatch(formRows({ 3: 2, 7: 4, 12: 9, 0: 0 }[n], n), [])), 'a'); return h.slice(h.indexOf('Last '), h.indexOf('kf-season')); };
  assert.match(last(3), /Last 3<\/span><span class="kf-last"[^>]*><span class="ma-rate" data-ma-gate="nopct"[^>]*>2–1<\/span>/);
  assert.ok(!/%/.test(text(last(3))), 'n = 3: no %');
  assert.match(last(7), /data-ma-gate="small"[^>]*>57%<\/span><span class="ma-small-note"/);
  assert.match(last(12), /Last 10<\/span>.*data-ma-gate="full"[^>]*>90%</);
  assert.match(last(0), /data-ma-gate="none"[^>]*>—</); assert.doesNotMatch(text(last(0)), /(^|[^\d.])0%/);
  assert.match(last(7), /data-aotip="[^"]*Last 7: 4–3 over the 7 latest matches on Hard at every level, walkovers excluded/, 'the count carries its population');
});
// Founder Q16 (2026-09-30): the card reads the Form tab's DEFAULT view — today's surface (N1) — so its W–L is the rows the
// Form tab opens on. Mutation: the card counts all surfaces again ({ surf: 'all' }).
test('Q16: Recent form = the Form tab\'s default rows (today\'s surface), not every surface', () => {
  setup();
  const mix = [];
  for (let i = 0; i < 12; i++) mix.push({ date: '2026-09-' + String(19 - i).padStart(2, '0'), opponent: 'Opp ' + i, tournament: 'Ev ' + i, round: 'R32',
    surface: i % 2 ? 'Clay' : 'Hard', result: i % 2 ? '2 - 0' : (i < 6 ? '2 - 0' : '0 - 2'), won: i % 2 ? true : i < 6, sets: null, retired: false, walkover: false, eventKey: 600 + i });
  const m = formMatch(mix, []);
  const h = side(S.kfFormCard(m), 'a');
  const P = S.fhFormPlayer(m, 0, Object.assign({}, S.fhStateFor(m).form, { role: 'all', wmode: 'n', n: 10 }));
  assert.equal(S.fhStateFor(m).form.surf, 'Hard', 'the Form tab opens on today\'s surface (N1)');
  assert.equal(P.n, 6); assert.equal(P.wins, 3);
  assert.match(text(h), /Last 6 3–3|Last 6 50%/, 'the 6 hard rows (3–3), not the 10 latest of every surface');
  assert.match(h, /Last 6: 3–3 over the 6 latest matches on Hard/);
  assert.match(text(h), /^Sinner W W W L L Last 6/, 'the pills are the hard rows too (all surfaces would read W W W W W)');
});
// Mutation: the season record read from the form rows (capped at 40) instead of the Overview's season row.
test('Recent form "{Surface} {season}": the Overview tab\'s season row (careerByYear), "—" when that surface has no match', () => {
  setup();
  S.playerProfiles['1'] = { careerByYear: [{ year: 2026, hard: { won: 21, lost: 6 }, clay: { won: 0, lost: 0 } }, { year: 2025, hard: { won: 40, lost: 9 } }] };
  S.playerProfiles['2'] = { careerByYear: [{ year: 2025, hard: { won: 3, lost: 3 } }] };
  const h = S.kfFormCard(formMatch(formRows(3, 12), formRows(1, 2)));
  assert.match(text(side(h, 'a')), /Hard 2026 21–6$/, '21–6: every 2026 hard match, beyond the 12 form rows');
  assert.match(side(h, 'a'), /Hard 2026: 27 matches at every level \(ATP, Challenger, ITF\), walkovers excluded/);
  assert.match(text(side(h, 'b')), /Hard 2026 —$/, 'no 2026 row: a dash, never 0–0');
  assert.match(text(side(S.kfFormCard(formMatch(formRows(3, 12), [], { surface: 'clay' })), 'a')), /Clay 2026 —$/, 'a 0–0 surface reads "—" as on the Overview');
  assert.match(text(S.kfFormCard(match({ _fhFormData: false }))), /Loading recent matches…/);
});

// ---------- Head to head ----------
function h2hMatch(rows){ return match({ _fhH2hData: true, _fhCh: [[], []], _fhCloses: [null, null], _fhElo: null, h2h: { matches: rows } }); }
const mt = (date, won, extra) => Object.assign({ date, tournament: 'Ev', round: 'R16', surface: 'Hard', p1Won: won, result: won ? '2 - 1' : '1 - 2', level: 'ATP', eventKey: null }, extra || {});
// Mutation: the walkover filter dropped (a w/o counts and becomes the "last meeting"), or the last meeting = the oldest.
test('Head to head: the H2H tab\'s record — walkovers out (N2), a retirement counts, the last meeting = the latest played', () => {
  setup();
  const h = S.kfH2HCard(h2hMatch([mt('2023-03-01', true), mt('2024-05-10', false, { tournament: 'Munich', level: 'CH' }), mt('2025-01-20', true, { result: '0 - 0', tournament: 'Ghost' }),
    mt('2024-11-02', true, { result: '1 - 0', tournament: 'Paris' })]));
  const t = text(h);
  assert.match(t, /Head to head › 2 – 1 /, '3 played: the walkover ("0 - 0") is no meeting');
  assert.match(t, /Last meeting Nov ’24 · Paris · 1–0 ret\. 3 career meetings · incl\. 1 CH/);
  assert.doesNotMatch(t, /Ghost/);
  // founder Q18 (2026-09-30): the card, "Last meeting" included, goes to the H2H tab — the last meeting opens no sheet of its own
  assert.match(h, /^<div class="seg kf-card" data-kf="h2h" role="button" tabindex="0" onclick="aGoTab\('h2h'\)"/);
  assert.equal((h.match(/onclick=/g) || []).length, 1, 'one target: the H2H tab');
});
test('Head to head: never met → "0 – 0" and "No meeting on record"; loading → a dash and the loading line', () => {
  setup();
  assert.match(text(S.kfH2HCard(h2hMatch([]))), /0 – 0 No meeting on record/);
  assert.match(text(S.kfH2HCard(match())), /— Loading head-to-head…/);
});

// ---------- Dimension edge (N10) ----------
function dnaSide(p, n){ const AX = ['serve', 'return', 'underPressure', 'dominanceRatio'], last52 = { sample: { matches: n } };
  AX.forEach((ax, i) => { last52[ax] = p[i] == null ? null : { rating: [300, 40.1, 55.2, 1.23][i] + i, pct: p[i] }; });
  return { surfaces: { Hard: { last52, sinceBase: { sample: { matches: n } }, elo: p[4] == null ? null : { rating: 2000, pct: p[4] } } } }; }
// Mutation: the gaps ranked by the raw rating gap, not the percentile gap; or the MCP radar's six axes back.
test('Dimension edge: the five-axis DNA (five spokes), the three widest percentile gaps as raw ratings, each with the axis note', () => {
  setup(); S.dna = { byKey: { 1: dnaSide([90, 50, 60, 30, 70], 30), 2: dnaSide([20, 45, 40, 80, 67], 30) },
    meta: { percentiles: { last52: { Hard: { serve: { n: 212, population: 'ATP players, 10+ hard matches' } } } } } };
  const h = S.kfDimCard(match());
  assert.equal((h.match(/<line /g) || []).length, 5, 'five spokes');
  assert.match(h, />Serve<.*>Return<.*>Under pressure<.*>Dominance ratio<.*>Surface Elo</s);
  assert.ok(h.includes('class="kf-poly-a"') && h.includes('class="kf-poly-b"'));
  const gaps = [...h.matchAll(/data-kf-axis="(\w+)"/g)].map(x => x[1]);
  assert.deepEqual(gaps, ['serve', 'dominanceRatio', 'underPressure'], 'serve 70, DR 50, UP 20 — not return (5) or Elo (3)');
  assert.match(text(h), /300 SERVE|300 Serve/i);
  assert.match(h, /data-aotip="[^"]*Rank among 212 ATP players, 10\+ hard matches/, 'the axis note: the population and its n');
});
// Mutation: the floor dropped (a 6-match player draws a shape and his axes enter the gaps).
test('Dimension edge: below the 10-match floor no shape — only Surface Elo (current, no floor) compares; none at all → the reason; never style-radar.json (N10)', () => {
  setup(); S.dna = { byKey: { 1: dnaSide([90, 50, 60, 30, 70], 6), 2: dnaSide([20, 45, 55, 80, 65], 6) }, meta: {} };
  const h = S.kfDimCard(match());
  assert.ok(!h.includes('kf-poly-a') && !h.includes('kf-poly-b'), 'no shape under the floor');
  assert.match(text(h), /No shape at the 10-match floor/);
  assert.deepEqual([...h.matchAll(/data-kf-axis="(\w+)"/g)].map(x => x[1]), ['elo'], 'the floor keeps serve / return / UP / DR out; Elo carries, as on the Playing style tab');
  S.dna = { byKey: { 1: dnaSide([90, 50, 60, 30, null], 6), 2: dnaSide([20, 45, 55, 80, null], 12) }, meta: {} };
  assert.match(text(S.kfDimCard(match())), /Sinner: 6 Hard matches in the last 52 weeks, below the 10-match floor\./);
  assert.doesNotMatch(html, /fetch\([^)]*style-radar/, 'no fetch of the MCP radar anywhere in the page');
  assert.doesNotMatch(html, /function (loadStyleRadar|styleRadarFor|styleRadarSvg)\(/);
});

// ---------- Tournament ----------
// Mutation: a synthesised (withdrew) edition counted (N6), or the Q25 wording reverted ("no record on file").
test('Tournament: "City · TIER", the round in the Tournament tab\'s words, main-draw W–L from the editions, "first appearance" (Q25), the hold rate never a count-less %', () => {
  setup();
  const hist = { years: [{ year: 2025, won: 4, lost: 1 }, { year: 2024, won: 0, lost: 0, withdrew: true }, { year: 2023, won: 1, lost: 1 }] };
  const h = S.kfTourCard(match({ tournamentRound: 'ATP Basel - 1/16-finals', p1TournamentHistory: hist, p2TournamentHistory: null,
    courtSpeed: { abstractSpeed: 1.4, altitude: 260, serviceHold: 82, category: 'Fast' } }));
  const t = text(h);
  assert.match(t, /^Basel · ATP 500 Tournament · Round of 32 › Sinner 5–2 Alcaraz first appearance/, 'founder Q25: the file\'s "first appearance"');
  assert.doesNotMatch(t, /no record on file/);
  assert.match(h, /data-aotip="[^"]*5–2 in 7 main-draw matches over 2 editions at Basel, walkovers excluded/);
  // no event-hold file yet: the hold cell is loading, a dash — never the court-conditions sheet's count-less 82
  assert.match(vis(h), /1\.40 court speed Fast 260 m altitude above sea level — hold rate at this event PROSE Fast 1\.4/);
  assert.doesNotMatch(h, /82/, 'the count-less % is not shown');
  assert.equal(S.trRoundWords({ tournamentRound: 'ATP Basel - Quarter-finals' }), 'Quarter-finals');
  // an unknown event: the name alone, never a fabricated tier; no court row: every condition a dash with the Tournament tab's note
  const u = vis(S.kfTourCard(match({ tour: 'ATP Nowhere', courtSpeed: null })));
  assert.match(u, /^Nowhere Tournament ›/);
  assert.match(u, /— court speed — — altitude above sea level — hold rate at this event/);
});

// Founder Q9 (2026-09-30): the event hold rate — our box scores over every edition on file, n = service games — replaces
// the court-conditions sheet's count-less figure; Key factors prints the Tournament tab's own cell. Mutations
// (tools/test-ten341-mutants.js): Key factors back on the count-less dash (MA_HOLD_NO_N); the tooltip loses n.
const HOLD = { events: { 1706: { name: 'Basel', names: ['Basel', 'ATP Basel'], held: 1600, games: 2012, matches: 86, years: ['2024', '2025'] } }, byName: { basel: '1706' } };
const holdCell = (h, cls) => { const i = h.indexOf(`class="${cls}"`); assert.ok(i > 0, cls); const a = h.lastIndexOf('<span class="elotip"', i);
  return h.slice(a, h.indexOf('</span></span>', h.indexOf('class="elotip-pop"', i)) + 14).replace(cls, 'CELL'); };
test('Q9: Key factors\' hold rate is the Tournament tab\'s cell — our box scores, every edition, n in the tooltip, no gate', () => {
  setup(); S.hold = HOLD;
  const m = match({ courtSpeed: { abstractSpeed: 1.4, altitude: 260, serviceHold: 82, category: 'Fast' } });
  const kf = S.kfTourCard(m), tab = S.trHeaderHtml(m);
  assert.match(vis(kf), /260 m altitude above sea level 80% hold rate at this event/, '1,600 / 2,012 = 79.5% → 80% (the file prints whole %)');
  assert.equal(holdCell(kf, 'kf-hold'), holdCell(tab, 'tr-hold'), 'the same cell on both tabs');
  assert.match(text(tab), /Hold rate 80%/);
  const tip = text(holdCell(kf, 'kf-hold'));
  assert.match(tip, /Service hold at Basel: 1,600 of 2,012 service games held \(n = 2,012\), both players, in 86 matches with a box score over 2 editions on file \(2024–2025\), qualifying included\./);
  assert.doesNotMatch(kf, /n not published|82%/, 'the court-conditions figure and its dash are gone');
  // an event with no box score: a dash with the reason, never a %; the file not loaded yet: a dash, loading
  const none = S.kfTourCard(match({ tour: 'ATP Nowhere' }));
  assert.match(vis(none), /— hold rate at this event/); assert.match(none, /No box score on file for Nowhere, so no hold rate is shown\./);
  S.hold = null; assert.match(S.kfTourCard(m), /The event hold rate did not load/);
  S.hold = undefined; assert.match(S.kfTourCard(m), /Loading the event hold rate/);
  // no gate: a two-match event still prints its % with its n (founder 2026-09-28: ungated, n in the tooltip)
  S.hold = { events: { 9: { name: 'Basel', names: ['Basel'], held: 18, games: 20, matches: 2, years: ['2025'] } }, byName: { basel: '9' } };
  assert.match(text(holdCell(S.kfTourCard(m), 'kf-hold')), /^90% .*n = 20/);
});

// ---------- Odds ----------
const H = 3600e3, T0 = Date.parse('2026-09-19T08:00:00Z');
const ser = (a, b, n) => [...Array(n || 6)].map((_, i) => [new Date(T0 + i * H).toISOString(), +(a + (b - a) * i / ((n || 6) - 1)).toFixed(2)]);
function oddsMatch(books, meta, over){ return match(Object.assign({ id: 'past-9', finalScore: '6-4 6-4', startTs: new Date(T0 + 8 * H).toISOString(), oddsMovement: { market: 'Match Winner', capturedAt: new Date(T0 + 7 * H).toISOString(),
  chart: { books, meta } } }, over || {})); }
const cm = (group, extra) => Object.assign({ source: 'test', group, checkedAt: new Date(T0 + 7 * H).toISOString(), gaps: [] }, extra || {});
// Mutation: the book preference dropped (the Odds tab's first live row — Betfair Exchange — wins over Bet365).
test('Odds: ONE book for the whole card — Pinnacle, else Bet365, else the Odds tab\'s order; its price, its vig split, its own movement', () => {
  setup();
  const both = { 'Betfair Exchange (recorded by us)': { p1: ser(1.9, 1.7), p2: ser(2.0, 2.3) }, 'bet365 (api-tennis)': { p1: ser(1.8, 1.6), p2: ser(2.1, 2.4) } };
  const m = oddsMatch(both, { 'Betfair Exchange (recorded by us)': cm('sharp'), 'bet365 (api-tennis)': cm('soft') }, { bestOdds: { p1: { price: 9.9 }, p2: { price: 9.9 } } });
  const h = S.kfOddsCard(m), t = text(h);
  assert.match(t, /^Odds › 1\.60 2\.40 Sinner Alcaraz 60% vig removed 40% Implied win probability · bet365/, 'Bet365 before the exchange; never bestOdds');
  // the split is the latest MATCHED pair (the Odds tab's No-vig): a later quote carries the other side forward (61.5 / 38.5),
  // but one inside a feed gap pairs with nothing — the price moves, the split stays on the last pair (60 / 40)
  const lone = { 'bet365 (api-tennis)': { p1: ser(1.8, 1.6).concat([[new Date(T0 + 6 * H).toISOString(), 1.5]]), p2: ser(2.1, 2.4) } };
  assert.match(text(S.kfOddsCard(oddsMatch(lone, { 'bet365 (api-tennis)': cm('soft') }))), /^Odds › 1\.50 2\.40 Sinner Alcaraz 61\.5% vig removed 38\.5%/);
  const gap = [[new Date(T0 + 5.5 * H).toISOString(), new Date(T0 + 7.5 * H).toISOString()]];
  assert.match(text(S.kfOddsCard(oddsMatch(lone, { 'bet365 (api-tennis)': cm('soft', { gaps: gap }) }))), /^Odds › 1\.50 2\.40 Sinner Alcaraz 60% vig removed 40%/);
  assert.match(t, /Odds movement bet365 1\.80 1\.60 2\.10 2\.40 Opening odd Current odd/, 'the same book\'s series, cut at the start; the file\'s "Current odd" after the start too (founder Q25)');
  const withPin = Object.assign({ 'Pinnacle (api-tennis)': { p1: ser(1.75, 1.55), p2: ser(2.2, 2.5) } }, both);
  assert.match(text(S.kfOddsCard(oddsMatch(withPin, { 'Pinnacle (api-tennis)': cm('sharp'), 'Betfair Exchange (recorded by us)': cm('sharp'), 'bet365 (api-tennis)': cm('soft') }))),
    /1\.55 2\.50 .* Implied win probability · Pinnacle/, 'Pinnacle first');
});
// Mutation: the gap rule dropped (a gapped book's line joins the missing hours).
test('Odds: a book with a feed gap is not drawn as a line (the card says so); no book → the empty line; loading', () => {
  setup();
  const g = oddsMatch({ 'bet365 (api-tennis)': { p1: ser(1.8, 1.6), p2: ser(2.1, 2.4) } },
    { 'bet365 (api-tennis)': cm('soft', { gaps: [[new Date(T0 + 2 * H).toISOString(), new Date(T0 + 3 * H).toISOString()]] }) });
  const x = S.kfOddsMove(g);
  assert.equal(x.mini.svg, ''); assert.match(x.mini.note, /left the feed for a while/);
  assert.doesNotMatch(S.kfOddsCard(g), /<polyline/);
  assert.match(text(S.kfOddsCard(oddsMatch({}, {}))), /No prices in the feed for this match yet\./);
  // upcoming, every book last checked 5 h ago: the Odds tab greys them ("no recent data") — never "no prices in the feed"
  const stale = oddsMatch({ 'bet365 (api-tennis)': { p1: ser(1.8, 1.6), p2: ser(2.1, 2.4) } }, { 'bet365 (api-tennis)': cm('soft', { checkedAt: new Date(Date.now() - 5 * H).toISOString() }) },
    { finalScore: null, startTs: new Date(Date.now() + 5 * H).toISOString() });
  assert.match(text(S.kfOddsCard(stale)), /No recent prices: every book on file was last checked over an hour ago\./);
  assert.match(text(S.kfOddsCard(match())), /Loading bookmaker odds…/);
});

// ---------- Weather ----------
// A real Weather-tab model: one venue file, the match 14:00Z inside its hourly rows (upcoming at the test clock).
function wxFile(nowMs){
  const t0 = Date.parse(new Date(nowMs).toISOString().slice(0, 10) + 'T00:00:00Z') + 86400e3;   // tomorrow 00:00Z
  const time = [...Array(24)].map((_, i) => new Date(t0 + i * H).toISOString());
  const k = v => time.map(() => v);
  return { v: 2, tz: 'UTC', source: 'Open-Meteo', fetchedAt: new Date(nowMs - H).toISOString(),
    hourly: { time, temp: k(23), humidity: k(71), wind: k(9), gusts: k(20), feels: k(24), rainChance: k(35), rainMm: k(0.2) },
    daily: { date: [new Date(t0).toISOString().slice(0, 10)], hi: [25], lo: [15], code: [2] }, _t0: t0 };
}
// Mutation: the strip reads its own fields (m.weather) instead of the Weather tab's model at match time.
test('Weather: the Weather tab\'s model at match time — temp + the file\'s mood word, wind, humidity, rain chance, the tab\'s verdict', () => {
  setup();
  const f = wxFile(Date.now());
  const m = match({ id: 'upcoming-5', date: new Date(f._t0).toISOString().slice(0, 10), startTs: new Date(f._t0 + 14 * H).toISOString(), weather: { temperature: 99 },
    _kfWx: { entry: { file: 'weather/x.json', tz: 'UTC' }, file: f, arch: null } });
  const t = text(S.kfWeatherStrip(m));
  assert.match(t, /^Weather · match day › 23°C Warm 9 km\/h wind 71% humidity 35% rain /);
  assert.doesNotMatch(t, /99/);
  assert.match(text(S.kfWeatherStrip(match({ _kfWx: { entry: { indoor: true }, file: null, arch: null } }))), /— — km\/h wind — humidity — rain Indoor event — weather not a factor\./);
  assert.match(text(S.kfWeatherStrip(match())), /— — km\/h wind — humidity — rain Loading forecast…/);
});

// ---------- Stennisfy Model ----------
// Mutation: the soft book's "vs fair" computed again (fairP − 1/softPx), or the empty state dropping the link.
test('Model: fair odds + SHARP/NO VALUE from the Pinnacle edge; exactly two "pp vs fair" (Pinnacle), soft books "● —"; no snapshot → the empty state, still a link', () => {
  setup();
  const m = match({ id: 'up-3', valueSnapshot: { fairP1: 1 / 1.59, fairP2: 1 / 2.70, edgeVsPinnacleP1: 0.021, edgeVsPinnacleP2: -0.011 },
    pinnacleOpen: { p1: 1.63, p2: 2.49 }, bestOdds: { p1: { price: 1.66, bookmaker: 'Bet365' }, p2: { price: 2.67, bookmaker: 'Unibet' } } });
  const h = S.kfModelCard(m), t = text(h);
  assert.match(t, /Sinner Adjusted fair odd 1\.59 SHARP VALUE Pinnacle 1\.63 Opened 1\.63 ● \+2\.1pp vs fair Best soft book 1\.66 Bet365 ● —/);
  assert.match(t, /Alcaraz Adjusted fair odd 2\.70 NO VALUE .* ● −1\.1pp vs fair Best soft book 2\.67 Unibet ● —/);
  assert.equal((t.match(/pp vs fair/g) || []).length, 2);
  assert.match(h, /role="button" tabindex="0" onclick="openEdgeModelFromMatch\('up-3'\)"/);
  const e = S.kfModelCard(match({ id: 'up-4' }));
  assert.match(text(e), /Stennisfy Model .* The model has not published an adjusted fair price for this match yet\./);
  assert.match(e, /onclick="openEdgeModelFromMatch\('up-4'\)"/, 'the empty state links too');
});

// Mutation: "Now" read from the legacy oddsMovement.books only (a chart-shape Pinnacle series never shows its Now).
test('Model: the Pinnacle box\'s "Now" is the Odds tab\'s Pinnacle row (chart shape included); a stale Pinnacle shows no Now', () => {
  setup();
  const pin = { 'Pinnacle (api-tennis)': { p1: ser(1.63, 1.55), p2: ser(2.49, 2.60) } };
  const base = { valueSnapshot: { fairP1: 0.6, fairP2: 0.4, edgeVsPinnacleP1: 0.01, edgeVsPinnacleP2: -0.01 }, pinnacleOpen: { p1: 1.63, p2: 2.49 } };
  assert.match(text(S.kfModelCard(oddsMatch(pin, { 'Pinnacle (api-tennis)': cm('sharp') }, base))), /Pinnacle 1\.55 Opened 1\.63 → Now 1\.55 ↓ .* Pinnacle 2\.60 Opened 2\.49 → Now 2\.60 ↑/);
  // a move smaller than the printed precision is no move: 1.8137 against an opener of 1.81 reads "→", never "↑"
  const flat = { 'Pinnacle (api-tennis)': { p1: ser(1.83, 1.82).concat([[new Date(T0 + 6 * H).toISOString(), 1.8137]]), p2: ser(2.2, 2.1).concat([[new Date(T0 + 6 * H).toISOString(), 2.1]]) } };
  assert.match(text(S.kfModelCard(oddsMatch(flat, { 'Pinnacle (api-tennis)': cm('sharp') }, Object.assign({}, base, { pinnacleOpen: { p1: 1.81, p2: 2.2 } })))), /Opened 1\.81 → Now 1\.81 → /);
  // upcoming and not checked for over an hour: the Odds tab calls it stale — no Now here either
  const up = oddsMatch(pin, { 'Pinnacle (api-tennis)': cm('sharp', { checkedAt: new Date(Date.now() - 5 * H).toISOString() }) }, Object.assign({ id: 'up-8', finalScore: null, startTs: new Date(Date.now() + 5 * H).toISOString() }, base));
  assert.match(text(S.kfModelCard(up)), /Pinnacle 1\.63 Opened 1\.63 ● /);
});

// Mutation: a feed string interpolated raw (the tournament title or the H2H event unescaped).
test('escaping: feed strings with markup render as text on every card', () => {
  setup();
  const x = '<img src=x onerror=alert(1)>';
  assert.doesNotMatch(S.kfTourCard(match({ tour: 'ATP ' + x })), /<img/);
  assert.doesNotMatch(S.kfH2HCard(h2hMatch([mt('2025-01-01', true, { tournament: x })])), /<img/);
  assert.doesNotMatch(S.kfStyleCard(match({ p1: x })), /<img/);
});

// ---------- the tab ----------
// Mutation: a card routed nowhere (the whole card loses its aGoTab link), or the order changed.
test('the tab: v.o only — six cards in the file\'s order, each linking to its tab, then Weather and the Model; no SAMPLE chip, no variants', () => {
  setup();
  const h = S.buildKeyFactorsSection(match());
  assert.deepEqual([...h.matchAll(/data-kf="(\w+)"[^>]*onclick="([^"]+)"/g)].map(x => x[1] + ':' + x[2]),
    ["style:aGoTab('style')", "form:aGoTab('form')", "h2h:aGoTab('h2h')", "style:aGoTab('style')", "tournament:aGoTab('tournament')", "odds:aGoTab('odds')",
     "weather:aGoTab('weather')", "model:openEdgeModelFromMatch('past-777')"]);
  assert.match(h, /class="kf-grid" style="display:grid; grid-template-columns:repeat\(3,minmax\(0,1fr\)\); gap:18px; align-items:stretch;"/, 'DF L345');
  assert.doesNotMatch(h, /SAMPLE|Card grid|Matchup hero|Leans = /, 'no review chip, no variant rendered');
});
// Mutation: a native title (or a local tooltip / row renderer) back in the Key factors block.
test('DoD 8: no tab-local row or tooltip renderer, no native title; the old renderers are deleted, not hidden', () => {
  assert.doesNotMatch(KF, /\stitle="/, 'no native title in the block');
  assert.doesNotMatch(KF, /elotip-pop|class="[^"]*tip-pop/, 'the one tooltip component only (maTipHtml / data-aotip)');
  assert.doesNotMatch(KF, /-row"|RowHtml|rowHtml/, 'no match rows drawn by this tab');
  for (const f of ['buildKeyFactorsCards', 'buildKeyPanels', 'recentResultRowHtml', 'buildRecentResultsSection', 'keyCardHtml', 'unavailableKeyCardHtml',
    'akStyleBlock', 'akFormBlock', 'akH2HBlock', 'akDimEdgeBlock', 'akTournamentBlock', 'akOddsBlock', 'akOddsMoveSvg', 'akWeatherBlock', 'akModelBlock',
    'akProgressionBlock', 'akReadBlock', 'akCard', 'akSurname', 'altitudeLabel'])
    assert.ok(!html.includes('function ' + f + '('), f + ' deleted');
  assert.doesNotMatch(html, /\.akeycard|\.akbento|\.arr-row|\.akm-/, 'their CSS deleted');
});
// Mutation: a literal colour in the Key factors block (the token file is the only palette, D1).
test('colours: the Key factors block writes tokens only — no literal hex or rgba (D1)', () => {
  const code = KF.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');   // comments may name a DF line, never a colour
  assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, 'no literal colour');
  assert.match(KF, /\n  card: 'var\(--page\)', line: 'var\(--line\)',/, 'the card surface is a token (foundation: the design shade 0a0d14 = --page)');
});
