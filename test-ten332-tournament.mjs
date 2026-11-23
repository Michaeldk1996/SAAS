// TEN-332 (TEN-312 Tournament tab, founder 2026-09-28 / 2026-09-29) — the Tournament tab rebuilt on the design file.
// Every check drives the page's REAL code (the TEN-263 … Tournament blocks sliced out of bsp-consult-dashboard.html and
// executed) and names the mutation that turns it red; tools/test-ten332-mutants.js applies each one to a copy of the page
// (TEN332_HTML).
//   · N6 only editions entered · N7 main draw (the history's own rows) · N2 walkovers in no count
//   · D2 one gate on every rate (W–L %, sets won, vs market) — never "0%" · D6 "+Y.Ypt vs market" at n >= 5
//   · N5 Backing at the closing price (Pinnacle, then Bet365) on the ONE Database join (TEN-402 r2, founder 2026-10-09)
//   · TEN-325 retirements settle on the ATP result, note from the core
//   · N4 the court-speed label is the pipeline's 3-band (m.courtSpeed.category) · Roland Garros speed dashed (TEN-321)
//   · the reading paragraph is not drawn · the seven-season trend dashes every season the sheet does not hold
//   · DoD 8: maMatchRowsHtml rows, every row opens the shared sheet; the old renderers are deleted
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN332_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const pp2 = readFileSync(process.env.TEN332_PP2 || join(HERE, 'player-profile-v2.js'), 'utf8');
const HOUSE_RATINGS_SRC = readFileSync(join(HERE, 'house-ratings.js'), 'utf8');
// Match analysis rebuild (2026-11-23): the tab renderer is maTournamentV2 in match-analysis-v2.js (TEN332_MA2 = a mutated copy)
const MA2_SRC = readFileSync(process.env.TEN332_MA2 || join(HERE, 'match-analysis-v2.js'), 'utf8');
globalThis.MarketEdgeCore = createRequire(import.meta.url)(join(HERE, 'market-edge-core.js'));
function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let d = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; }
  return html.slice(start, i + 1);
}
function between(a, b) {
  const x = html.indexOf(a), y = html.indexOf(b, x);
  assert.ok(x > 0 && y > x, 'block not found: ' + a);
  return html.slice(x, y);
}
const constSrc = (name) => { const m = new RegExp(`\\nconst ${name} = [\\s\\S]*?\\n(?:\\};|\\];)\\n`).exec(html); assert.ok(m, name); return m[0]; };
const PS_TOUR_META_SRC = /const PS_TOUR_META = \(\(\) => \{[\s\S]*?\n\}\)\(\);/.exec(html)[0];
const S = new Function('window', `
  const document = { addEventListener(){}, getElementById(){ return null; }, querySelector(){ return null; }, querySelectorAll(){ return []; },
    head: { appendChild(){} }, createElement(){ return { set textContent(v){} }; } };
  const playerProfiles = {};
  const MarketEdgeCore = window.MarketEdgeCore;
  function formPanelHtml(){ return ''; } function ensureFormPanelTabs(){}
  function ensureFormRows(m){ return Promise.resolve(m); } function loadCareerHistory(k){ return Promise.resolve(_careerHistoryShards[String(k)] || []); }
  function ensureStyleMeetings(m){ return Promise.resolve(m); } function ensurePsMatrix(){ return Promise.resolve(); }
  function ppStyleFor(){ return null; } function psArchFor(){ return null; } function styleMeetRowsFor(){ return []; }
  function openPlayerProfileFromMatch(){} function aGoTab(){}
  let _aM = null; const _aBuilt = new Set(); function aBuilt(){ return false; } function aPaint(){}
  const _careerHistoryShards = {};
  const _careerRecordLayers = {};
  function loadCareerRecord(k){ const s = String(k); if (globalThis.__recFail) return Promise.resolve(false);
    if (!(s in _careerRecordLayers)) _careerRecordLayers[s] = (globalThis.__recSrc || {})[s] || null; return Promise.resolve(true); }
  const _tourHistShards = {};
  let tourxMarketData = null; function tourxFetchMarket(){ return Promise.resolve(tourxMarketData); }
  const HouseRatings = (function(){ const window = {}; ${HOUSE_RATINGS_SRC}; return window.HouseRatings; })();
  ${PS_TOUR_META_SRC}
  ${constSrc('TOURNAMENT_CATALOG')}
  ${constSrc('COURT_CONDITIONS')}
  const TOURX_KNOB_PAD = 0.08;
  ${constSrc('SURFACE_CLAUSE')}
  ${constSrc('SPEED_CLAUSE')}
  ${['escapeHtml', 'surnameFirstName', 'psShortName', 'formIni', 'ppCleanTournamentName', 'psNormTour', 'psTourMeta', 'psRoundAbbr', 'h2hRoundLabel', 'maRoundName',
     'eventKeyOfMatch', 'courtSpeedCategory', 'tourxKnobPct', 'tourxConditionRegistry', 'speedDescription'].map(slice).join('\n')}
  ${between('/* =====================================================================\n   TEN-263 ', '// Extra stats tab REMOVED (TEN-8 Item 5)')}
  const __MA2 = (function(){ const window = globalThis; const fetch = () => Promise.resolve({ ok: false }); ${MA2_SRC}; return window; })();
  const maTournamentV2 = __MA2.maTournamentV2;
  return { recLayers: _careerRecordLayers, recordFixOf, recordFixRow, fhEnsureFormData, fhFormPlayer, trModelOf,
    meRowFromCareer, sfDbPxRows, buildTournamentSection, trModelFor, trStateFor, trProfileModel, trLoad, trRowOf, fhStateFor, maMatchRowsHtml, trProfileBacking,
    chShards: _careerHistoryShards, thShards: _tourHistShards, fhCl: _fhCl, profiles: playerProfiles, profileFail: _trProfileFail, set hold(v){ _trHoldData = v; },
    get tr(){ return _tr; }, get fh(){ return _fh; }, set market(v){ tourxMarketData = v; }, TR_RG_NOTE, TR_NO_SPEED,
    // TEN-402 (founder 2026-10-08): the page-wide Database join rows (sfDbJoinLoad's state), set by the tests
    set dbJoin(v){ _sfDbJoin = v; _sfDbJoinSt = v ? 'ready' : null; _sfDbJoinP = null; }, set dbJoinSt(v){ _sfDbJoinSt = v; } };
`)(globalThis);
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// TEN-402 r2 (founder card 7bc622d5, 2026-10-09): the tab prices on the ONE Database join too, so every fixture's prices
// reach it as a Database store (dbStore below), never as a closes shard.
// THE join, sliced from the Head to Head page (as test-ten402-b runs it) and published where the page publishes it
const JOIN_CONSTS = ['H2H_PAGE_PRICE_WINDOW', 'H2H_PAGE_MATCH_WINDOW', 'H2H_PAGE_START_WINDOW', 'H2H_PAGE_ROW_WINDOW', 'H2H_TD_ROUND', 'H2H_PAGE_BEFORE_RANK']
  .map(n => { const x = new RegExp(`^\\s*const ${n} = [^\\n]*$`, 'm').exec(html); assert.ok(x, n); return x[0].replace(/\/\/[^'\n]*$/, ''); }).join('\n');
globalThis.H2HPage = { priceJoin: new Function(`const FH_DASHC = '—';\n${JOIN_CONSTS}\n${['fhDayNum', 'fhIsInitial', 'fhNameKey', 'psRoundAbbr', 'h2hRoundLabel', 'fhRoundCode', 'h2hTdIx', 'h2hTdKey', 'h2hTdSame', 'h2hTdRound', 'h2hTdEvent', 'h2hNearest', 'h2hPriceJoin'].map(slice).join('\n')}\nreturn h2hPriceJoin;`)() };
const dbPriceJoinRows = new Function(`${slice('dbPriceJoinRows')}\nreturn dbPriceJoinRows;`)();
// The Database store for one fixture: games → [date, lvl, surf, rnd, tour, fav, dog, favWon, book] + archive names
// ("Surname I."), each at the price given (px: [own, opp], book 0 = Pinnacle / 1 = Bet365); ret → the flagged retRows.
const TD_RD = { 'Final': 'The Final', 'Semi-finals': 'Semifinals', 'Quarter-finals': 'Quarterfinals', '1/8-finals': '3rd Round', '1/16-finals': '2nd Round', '1/32-finals': '1st Round' };
function dbStore(games, priceOf) {
  const rounds = [...new Set(Object.values(TD_RD))], base = { meta: { rounds, tournaments: ['Washington'] }, rows: [], retRows: [] }, nm = { names: [], retNames: [] };
  const arch = n => { const [i, ...sur] = String(n).split(' '); return sur.join(' ') + ' ' + i; };
  games.forEach(g => { const q = priceOf(g); if (!q) return;
    const own = q.px[0], opp = q.px[1], favWon = (g[3] ? own : opp) < (g[3] ? opp : own) ? 1 : 0;
    const row = [+g[0].replace(/-/g, ''), 0, 0, rounds.indexOf(TD_RD[g[2]]), 0, Math.min(own, opp), Math.max(own, opp), favWon, q.book || 0];
    const names = g[3] ? ['Sinner J.', arch(g[1])] : [arch(g[1]), 'Sinner J.'];
    if (q.ret) { base.retRows.push(row); nm.retNames.push(names); } else { base.rows.push(row); nm.names.push(names); } });
  return { base, nm };
}

// ---- fixtures: history editions (the pipeline's shape), career rows (set scores) and closes (prices) for p1 ----
let EK = 90000;
// ed(year, [[date, opp, roundLabel, won, sets, extra]...], extra) — sets = [[own, opp], ...]
function ed(year, ms, x) {
  const matches = ms.map(([date, opp, round, won, sets, o]) => {
    const done = (sets || []).filter(s => Math.max(s[0], s[1]) >= 6 && (Math.abs(s[0] - s[1]) >= 2 || Math.max(s[0], s[1]) === 7));
    const pS = done.filter(s => s[0] > s[1]).length, oS = done.length - pS;
    return { date, opponent: opp, round, won, result: pS + ' - ' + oS, eventKey: ++EK, _sets: sets, _o: o || {} };
  }).sort((a, b) => (a.date < b.date ? 1 : -1));
  const won = matches.filter(m => m.won).length;
  return Object.assign({ year: String(year), matchCount: matches.length, won, lost: matches.length - won, roundReached: matches[0] ? matches[0].round : 'Final', matches }, x || {});
}
function fixture(eds, o) {
  o = o || {};
  const ch = [], rows = [];
  eds.forEach(e => e.matches.forEach(x => {
    ch.push({ date: x.date, year: x.date.slice(0, 4), opponent: x.opponent, round: x.round, won: x.won, result: x.result, eventKey: x.eventKey,
      tournament: 'Washington', surface: 'hard', level: 'atp', retired: !!x._o.ret, sets: (x._sets || []).map(s => ({ p: s[0], o: s[1] })) });
    if (x._o.p) rows.push({ date: x.date, opp: x.opponent, won: x.won, P: x._o.p, B: null, ret: !!x._o.ret, oppKey: null });
    if (x._o.b) rows.push({ date: x.date, opp: x.opponent, won: x.won, P: null, B: x._o.b, ret: false, oppKey: null });
  }));
  const hist = eds.length ? { editionsPlayed: eds.length, totalWon: 0, totalLost: 0, years: eds } : null;
  const m = Object.assign({ id: 'fx-tr-' + (++EK), tour: 'ATP Washington', surface: 'hard', date: '2026-07-20', tournamentRound: 'ATP Washington - Quarter-finals',
    p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: '1', p2Key: '2', p1TournamentHistory: hist, p2TournamentHistory: null,
    venue: { city: 'Washington', country: 'US', category: 'ATP 500', indoor: false },
    courtSpeed: { speed: 66, altitude: 20, abstractSpeed: 1.02, as2023: 0.98, as2024: 1.01, as2025: 1.02, category: 'Medium' } }, o.m || {});
  const E = S.trStateFor(m);
  E.data = [{ ch, cl: { rows, cap: [] } }, { ch: [], cl: { rows: [], cap: [] } }]; E.state = ['ready', 'ready'];
  // the same prices as Database rows (Pinnacle p / Bet365 b; a priced retirement behind the store's flag)
  const games = eds.flatMap(e => e.matches.map(x => [x.date, x.opponent, x.round, x.won, x._sets, x._o]));
  const st = dbStore(games, g => (g[5].p ? { px: g[5].p, ret: !!g[5].ret } : g[5].b ? { px: g[5].b, book: 1 } : null));
  S.dbJoin = o.noDb ? null : dbPriceJoinRows(st.base, st.nm);
  return m;
}
const W2 = [[6, 3], [6, 4]], L2 = [[3, 6], [4, 6]];
const nMatches = (n, wonFn, price) => ed(2024, Array.from({ length: n }, (_, i) => ['2024-07-' + String(10 + i).padStart(2, '0'), 'P. Opp' + String.fromCharCode(97 + i), 'Round ' + i, wonFn(i), wonFn(i) ? W2 : L2, price ? { p: price(i) } : null]));
// 2026-11-23 design (maTournamentV2): head card → (Show court speed & market) speed card + ROI + reliability → record card,
// one box per player: header W–L + "x% of n won", four tiles (Best result · Sets won · Last played · Backing), edition rows.
const BOX = 'background:var(--ma2-inner); border:1px solid color-mix(in srgb, var(--ma2-white) 6%, transparent); border-radius:12px; display:flex; flex-direction:column; min-width:0; overflow:hidden;';
const card0 = h => { const a = h.indexOf(BOX), b = h.indexOf(BOX, a + 5); return a < 0 ? '' : h.slice(a, b > 0 ? b : h.length); };
const TILE = '<div style="background:var(--ma2-card); border:1px solid color-mix(in srgb, var(--ma2-white) 6%, transparent); border-radius:11px; padding:13px 6px 12px;';
const tile = (h, cap) => { const c = card0(h), i = c.indexOf('>' + cap + '</span>'); assert.ok(i > 0, cap); const a = c.lastIndexOf(TILE, i), b = c.indexOf(TILE, i), e = c.indexOf('font-size:11.5px; font-weight:600; color:var(--ma2-grey);"><span>Date', i);
  return c.slice(a, b > 0 ? b : e > 0 ? e : c.length); };
const tileV = t => (/font-size:17px; font-weight:700; line-height:1; color:([^;]+); white-space:nowrap;">([^<]*)</.exec(t) || []).slice(1);
const groups = h => [...card0(h).matchAll(/padding:14px 8px 7px;[^"]*">\s*<span[^>]*>([^<]*)<\/span><span[^>]*>([^<]*)<\/span>/g)].map(x => x[1] + ' ' + x[2]);
const wlHead = h => (/font-size:24px; font-weight:700; line-height:1; color:[^;]+;">([^<]*)<\/span><span( title="[^"]*")?[^>]*>([^<]*)</.exec(card0(h)) || []).slice(1);
const trRows = h => [...card0(h).matchAll(/title="([^"]*)" style="font-size:13px; font-weight:600;[^>]*>[^<]*<\/span>[\s\S]*?<span title="([^"]*)" style="position:relative;[^>]*>([^<]*)(?:<span aria-hidden="true"[^>]*>([BE])<\/span>)?<\/span><span title="[^"]*"[^>]*>([^<]*)<\/span>/g)]
  .map(x => ({ opp: x[1], tip: x[2], h: x[3], mark: x[4] || '', a: x[5] }));
const headOf = m => { S.trStateFor(m).S.more = false; const h = S.buildTournamentSection(m); return h.slice(0, h.search(/>Record (at|on similar)/)); };
const marketOf = m => { S.trStateFor(m).S.more = true; const h = S.buildTournamentSection(m); S.trStateFor(m).S.more = false; return h.slice(h.indexOf('abstract court speed'), h.search(/>Record (at|on similar)/)); };

// Mutation 'N6: a synthesised Withdrawal edition renders' (drop `.filter(y => !y.withdrew)`)
test('N6: only editions entered — a stale store\'s gap year never renders', () => {
  const m = fixture([ed(2025, [['2025-07-22', 'A. B', 'Final', true, W2]]), ed(2021, [], { withdrew: true, roundReached: 'Withdrawal' }), ed(2019, [['2019-07-22', 'C. D', '1/8-finals', false, L2]])]);
  const h = S.buildTournamentSection(m);
  assert.ok(!/Withdrawal|2021/.test(text(card0(h))));
  assert.deepEqual(groups(h).map(g => g.slice(16, 20)), ['2025', '2019']);
});

// Mutations 'result: won final not "Won"', 'result: in-progress edition labelled by its last round', 'rows: group meta loses W–L'
test('edition headers: "Washington Open YYYY" (the one event name, TEN-402 r3) + result · W–L — Won / the round lost / In progress (DESIGN GAP G17)', () => {
  // this year's edition stays "In progress" whether or not the analysed match itself is finished (never "· w/o")
  const done = fixture([ed(2026, [['2026-07-18', 'E. F', '1/8-finals', true, W2]])], { m: { finalScore: { winner: 'p1' } } });
  assert.deepEqual(groups(S.buildTournamentSection(done)), ['Washington Open 2026 In progress · 1–0']);
  const m = fixture([ed(2026, [['2026-07-18', 'E. F', '1/8-finals', true, W2]]), ed(2025, [['2025-07-20', 'A. B', 'Final', true, W2], ['2025-07-19', 'G. H', 'Semi-finals', true, W2]]),
    ed(2024, [['2024-07-19', 'C. D', 'Quarter-finals', false, L2], ['2024-07-17', 'I. J', '1/8-finals', true, W2]])]);
  assert.deepEqual(groups(S.buildTournamentSection(m)), ['Washington Open 2026 In progress · 1–0', 'Washington Open 2025 Won · 2–0', 'Washington Open 2024 Quarter-final · 1–1']);
});

// Mutation 'gate: W–L % printed below n 5' / 'gate: n 0 prints 0%'
// 2026-11-23 design: the W–L sits in the box header over "x% of n won" (the old W–L record tile).
test('W–L record: n 0 "—" (never 0%), 3 count only, 7 + "small sample" hover, 12 full', () => {
  const at = n => wlHead(S.buildTournamentSection(fixture(n ? [nMatches(n, i => i % 3 !== 2)] : [])));
  assert.equal(at(0)[0], '—'); assert.ok(!/0%/.test(at(0)[2]));
  assert.deepEqual([at(3)[0], at(3)[2]], ['2–1', '3 matches'], 'n 3: the count, no %');
  assert.deepEqual([at(7)[1], at(7)[2]], [' title="small sample · n=7"', '71% of 7 won']);
  assert.deepEqual([at(12)[1], at(12)[2]], [undefined, '67% of 12 won']);
});

// Mutation 'sets: a retirement\'s unfinished set counted'
test('Sets won: finished sets only — a retirement\'s unfinished set is not a set (rule e)', () => {
  const m = fixture([ed(2024, [['2024-07-20', 'A. B', 'Final', true, [[6, 3], [2, 1]], { ret: true }], ['2024-07-18', 'C. D', 'Semi-finals', true, W2],
    ['2024-07-17', 'E. F', 'Quarter-finals', true, W2], ['2024-07-16', 'G. H', '1/8-finals', true, [[6, 3], [4, 6], [6, 2]]], ['2024-07-15', 'I. J', '1/16-finals', true, W2]])]);
  const t = text(tile(S.buildTournamentSection(m), 'Sets won'));
  assert.ok(t.includes('9–1') && t.includes('90% of sets'), t);   // 1 of the retirement's 2 sets + 6 + 2 of 3
});

// Mutation 'best: an in-progress edition counts as a result'
test('Best result: Won beats a final; an edition still being played is no result; the year under it', () => {
  const m = fixture([ed(2026, [['2026-07-19', 'E. F', 'Semi-finals', true, W2]]), ed(2024, [['2024-07-20', 'A. B', 'Final', false, L2]]), ed(2022, [['2022-07-20', 'A. B', 'Quarter-finals', false, L2]])]);
  assert.equal(text(tile(S.buildTournamentSection(m), 'Best result')), 'Best result F 2024');
  const m2 = fixture([ed(2026, [['2026-07-19', 'E. F', 'Semi-finals', true, W2]])]);
  assert.equal(text(tile(S.buildTournamentSection(m2), 'Best result')), 'Best result — no finished edition');
});

// h2h.md fix 1: Last played = the newest edition WITH a row and that edition's own top row (trLastPlayed). Mutation 'fix 1:
// Last played back on the newest edition, rows or not'.
test('Last played: the newest edition with a row, never an empty newer edition', () => {
  const m = fixture([ed(2026, []), ed(2025, [['2025-07-20', 'A. Bee', 'Final', false, L2]]), ed(2024, [['2024-07-20', 'C. Dee', 'Final', true, W2]])]);
  assert.equal(text(tile(S.buildTournamentSection(m), 'Last played')), 'Last played 2025 lost F v Bee');
});

// Mutations 'backing: Pinnacle only (Bet365 fallback dropped)', 'backing: a retirement not settled', 'vm: shown below n 5',
// 'vm: implied rate not de-vigged', 'backing: RET note spelled out / dropped'
test('Backing (N5 + D6 + TEN-325): the Database join\'s closes, retirements settled on the ATP result, vs market at n >= 5 de-vigged, note from the core', () => {
  // 6 matches: 4 Pinnacle, 1 Bet365 only, 1 a retirement win at the close
  const m = fixture([ed(2024, [
    ['2024-07-21', 'A. B', 'Final', true, [[6, 3], [2, 1]], { p: [1.5, 2.6], ret: true }],
    ['2024-07-20', 'C. D', 'Semi-finals', false, L2, { p: [2.0, 1.85] }],
    ['2024-07-19', 'E. F', 'Quarter-finals', true, W2, { p: [1.8, 2.05] }],
    ['2024-07-18', 'G. H', '1/8-finals', true, W2, { b: [1.4, 2.9] }],
    ['2024-07-17', 'I. J', '1/16-finals', true, W2, { p: [1.3, 3.5] }],
    ['2024-07-16', 'K. L', '1/32-finals', false, L2, { p: [1.6, 2.4] }]])]);
  const P = S.trModelFor(m, 0);
  assert.equal(P.priced.length, 6);
  assert.equal(P.priced.filter(r => r.book === 'B').length, 1);
  assert.equal(Math.round(P.units * 100), 50 - 100 + 80 + 40 + 30 - 100);
  const pairs = [[1.5, 2.6], [2.0, 1.85], [1.8, 2.05], [1.4, 2.9], [1.3, 3.5], [1.6, 2.4]];
  const exp = pairs.reduce((s, [a, b]) => s + (1 / a) / (1 / a + 1 / b), 0) / 6;
  assert.ok(Math.abs(P.vm - (4 / 6 - exp) * 100) < 1e-9);
  const t = tile(S.buildTournamentSection(m), 'Backing');
  assert.match(tileV(t)[1], /^[+−]?0\.0u$/);
  assert.ok(text(t).includes(globalThis.MarketEdgeCore.RET_SETTLE_NOTE), 'the retirement note in the tile\'s hover');
  // n 4 priced: the units show, no vs market
  const m4 = fixture([nMatches(4, i => i < 3, () => [1.5, 2.6])]);
  const t4 = text(tile(S.buildTournamentSection(m4), 'Backing'));
  assert.ok(t4.includes('+0.5u') && /4 (priced|bets)/.test(t4) && !/vs market/.test(t4.replace('vs market needs', '')), t4);
  // RENDERER GAP (modal-analysis.md D6 + Tournament tab "Backing … 'vs market'"): the rebuilt tile drops "+Y.Ypt vs market"
  // (n >= 5 priced, 5–9 greyed); the old trTiles drew it under the units.
  assert.match(t, /[+−]\d+\.\dpt vs market/, 'vs market at n >= 5 (D6)');
});

// Founder 2026-10-22 · the pipeline history now LISTS walkovers (flagged). Mutation 'trRowOf: a flagged walkover is a
// retirement again' → the row reads ret, is priced and counted.
test('2026-10-22: a flagged walkover history row is listed as a walkover — never a retirement, a price or a count', () => {
  const m = fixture([ed(2024, [['2024-07-20', 'A. B', 'Final', true, W2, { p: [1.5, 2.6] }]])]);
  S.tr.data[0].ch[0].sets = []; S.tr.data[0].ch[0].result = '-'; S.tr.data[0].ch[0].walkover = true;
  Object.assign(m.p1TournamentHistory.years[0].matches[0], { result: null, walkover: true });
  m.p1TournamentHistory.years[0].won = 0; m.p1TournamentHistory.years[0].lost = 0; m.p1TournamentHistory.years[0].matchCount = 0;
  const P = S.trModelFor(m, 0);
  assert.ok(P.all[0].wo && !P.all[0].ret && !P.all[0].retSettle, 'a walkover, not a retirement');
  assert.equal(P.all[0].price, null, 'no price');
  assert.equal(P.priced.length, 0); assert.equal(P.W + P.L, 0);
  assert.equal(P.played.length, 0, 'an edition left only by a walkover is listed, not played');
});
// (the pipeline history used to carry no walkovers — TEN-313 dropped them — so a "0 - 0" row with no set is a match stopped
// in set 1: a retirement, played, settled at the close)
// Ruling 4 (founder 2026-10-22): a retirement with no stored set scores carries no units — its price stays on the row,
// it leaves the priced figures; never guessed. (An unflagged empty score is never a walkover: ruling 3.)
test('N2 + ruling 4: a set-less "0 - 0" history row is a retirement with no set scores — listed, priced, no units', () => {
  const m = fixture([ed(2024, [['2024-07-20', 'A. B', 'Final', true, W2, { p: [1.5, 2.6] }]])]);
  S.tr.data[0].ch[0].sets = []; S.tr.data[0].ch[0].result = '0 - 0'; m.p1TournamentHistory.years[0].matches[0].result = '0 - 0';
  const P = S.trModelFor(m, 0);
  assert.ok(P.all[0].ret && !P.all[0].wo);
  assert.equal(P.all[0].price, 1.5, 'its price is shown');
  assert.equal(P.priced.length, 0, 'no units: no first set on record');
  assert.equal(Math.round(P.units * 100), 0);
});

// Mutation 'join: the season + opponent fallback takes another event's row'
test('the season + opponent fallback joins only a row of this event (name or archive name), never a different match key', () => {
  const m = fixture([ed(2019, [['2019-07-22', 'C. Dee', 'Final', true, W2, { p: [1.5, 2.6] }]])]);
  const E = S.tr, x = m.p1TournamentHistory.years[0].matches[0];
  delete x.eventKey; x.date = '';
  E.data[0].ch[0].eventKey = null; E.data[0].ch[0].tournament = 'Toronto';                 // the same opponent, another event
  let P = S.trModelFor(m, 0);
  assert.equal(P.all[0].sets, null, 'a Toronto row never joins a Washington edition');
  E.data[0].ch[0].tournament = 'Citi Open';                                                 // an archive name of this event
  S.market = { baseline: { roiFav: 0, roiDog: 0, favRel: 70 }, tournaments: { Washington: { n: 50, roiFav: 1, roiDog: 1, favRel: 70, nRel: 52, archiveNames: ['Citi Open'] } } };
  P = S.trModelFor(m, 0);
  assert.ok(P.all[0].sets && P.all[0].sets.length === 2, 'the archive name joins');
  S.market = null;
});

// Mutations 'N4: the design\'s AS cut-offs back', 'TEN-321: Roland Garros speed printed from another key'
test('N4 + TEN-321: the header prints the pipeline\'s 3-band label; Roland Garros dashes its speed with the note', () => {
  // 1.17 is "Fast" on the design's retired AS cut-offs (< 1.15) and "Medium" on the pipeline index (66 <= 68)
  const m = fixture([], { m: { courtSpeed: { speed: 66, abstractSpeed: 1.17, altitude: 20, category: 'Medium' } } });
  // an event with no court-conditions row reads the match's pipeline copy: its category, never re-banded from the AS
  const nr = fixture([], { m: { tour: 'ATP Nowhere', courtSpeed: { speed: 66, abstractSpeed: 1.17, altitude: 20, category: 'Medium' } } });
  assert.ok(text(headOf(nr)).includes('Court speed 1.17 · Medium'), 'label from courtSpeed.category, never re-banded here');
  // a keyed event reads the Tournaments page's court-conditions row, banded by the pipeline's 3-band (N4)
  const wcc = new Function(`${constSrc('COURT_CONDITIONS')}; ${slice('courtSpeedCategory')}; return [COURT_CONDITIONS.Washington, courtSpeedCategory(COURT_CONDITIONS.Washington.speed)];`)();
  assert.ok(text(headOf(m)).includes('Court speed ' + wcc[0].abstractSpeed.toFixed(2) + ' · ' + wcc[1]), 'Washington: the page row, banded by courtSpeedCategory');
  const rg = fixture([], { m: { tour: 'ATP French Open', courtSpeed: null, venue: { city: 'Paris', country: 'FR', category: 'Grand Slam' } } });
  const h = headOf(rg);
  assert.match(h, new RegExp('<span title="' + S.TR_RG_NOTE.replace(/[.()]/g, '\\$&') + '"[^>]*>—<'), 'RG speed dashed with the TEN-321 note');
  assert.ok(!h.includes(S.TR_NO_SPEED));
});

// Founder Q11 (2026-09-30): the reading paragraph is dropped — no node, no heading, no reserved space.
// Mutations 'the reading paragraph back (placeholder copy)', 'Q11: an empty block reserving its space'
// Q11 (2026-09-30) held the reading paragraph back "until the founder sends copy"; the founder's 2026-11-23 design supplies
// it: the court read is speedDescription(category, surface), the Tournaments page's copy. Placeholder copy never returns.
test('Q11: the head card\'s court read is the design\'s copy (speedDescription), never placeholder text', () => {
  const m = fixture([nMatches(2, () => true)]);
  const h = S.buildTournamentSection(m), head = headOf(m);
  assert.ok(!/Read the records below|plays fast and low|true, medium-paced/.test(h));
  assert.ok(!/SURFACE_CONDITIONS/.test(html));
  assert.ok(!/<p[\s>]|tr-reading|About this event/i.test(h), 'no paragraph node or heading');
  const want = new Function(`${constSrc('COURT_CONDITIONS')}; ${constSrc('SURFACE_CLAUSE')}; ${constSrc('SPEED_CLAUSE')}; ${slice('courtSpeedCategory')}; ${slice('speedDescription')};
    return speedDescription(courtSpeedCategory(COURT_CONDITIONS.Washington.speed), 'hard');`)();
  assert.ok(want && text(head).includes(want), 'the read = speedDescription: ' + want);
});

// Founder Q9 (2026-09-30): the event hold rate — our box scores, every edition on file, n = service games — in a fifth
// header meta cell (DESIGN GAP G43), no gate, n always in the tooltip. Mutation 'Q9 (tab): the hold cell dropped'.
test('Q9: the header carries the event hold rate with its n; a dash with the reason when no box score is on file', () => {
  S.hold = { events: { 1532: { name: 'Washington', names: ['Washington'], held: 3252, games: 4034, matches: 178, years: ['2024', '2025', '2026'] } }, byName: { washington: '1532' } };
  const head = headOf(fixture([nMatches(2, () => true)]));
  assert.match(text(head), /Hold rate 81% Service hold at Washington Open: 3,252 of 4,034 service games held \(n = 4,034\)/);
  assert.match(text(head), /178 matches with a box score over 3 editions on file \(2024–2026\)/);
  const none = headOf(fixture([nMatches(2, () => true)], { m: { tour: 'ATP Nowhere' } }));
  assert.match(text(none), /Hold rate — No box score on file for Nowhere, so no hold rate is shown\./);
  S.hold = undefined;
});

// Defect brief 2026-10-24 items 4 + 5. Mutations: the card's tournamentKey ignored (name lookup first) → Lyon 2026 reads the
// clay Lyon 2024; the tooltip back on "qualifying included".
test('event hold: a card with its own tournamentKey reads that event or nothing — never a name twin; main draw only', () => {
  S.hold = { events: { 2752: { name: 'Lyon', names: ['Lyon'], held: 418, games: 554, matches: 25, years: ['2024'] } }, byName: { lyon: '2752' } };
  const lyon26 = text(headOf(fixture([nMatches(2, () => true)], { m: { tour: 'ATP Lyon', tournamentKey: '14763' } })));
  assert.match(lyon26, /Hold rate — No box score on file for Lyon/, 'Lyon 2026 (key 14763) never shows the clay Lyon 2024 figure');
  const clay = text(headOf(fixture([nMatches(2, () => true)], { m: { tour: 'ATP Lyon', tournamentKey: '2752' } })));
  assert.match(clay, /Hold rate 75% Service hold at [^:]+: 418 of 554 service games held/);
  assert.match(clay, /main draw only\. Our own box scores\./);
  assert.doesNotMatch(clay, /qualifying included/);
  const legacy = text(headOf(fixture([nMatches(2, () => true)], { m: { tour: 'ATP Lyon' } })));
  assert.match(legacy, /Hold rate 75%/, 'a card published before the key falls back to the cleaned name');
  S.hold = undefined;
});

// Defect brief 2026-10-24 item 6: no axis slot that can never carry a value; the delta states the real span. The rebuild
// reads the Tournaments page's yearly readings (court-speed-history.json, 2020–2026, only years with a reading; notes.md),
// else the sheet's seasons that hold a value. Mutation 'trend: an empty season on the axis'.
test('court-speed trend: only seasons with a value on the axis; the delta states the real span', () => {
  const m = fixture([], { m: { tour: 'ATP Nowhere', courtSpeed: { speed: 66, abstractSpeed: 1.02, altitude: 20, as2023: 0.98, as2024: null, as2025: 1.02, category: 'Medium' } } });
  S.market = null;
  const h = marketOf(m);
  assert.deepEqual([...h.matchAll(/bottom:0; transform:translateX\(-50%\);[^"]*">(\d{4})</g)].map(x => x[1]), ['2023', '2025'], 'no empty 2024 slot, no 2020–22 or 2026 slot');
  assert.ok(text(h).includes('Trending faster +0.04 over 2 yrs'));
  assert.ok(text(h).includes('Abstract court speed · 2023–2025'));
});
// Defect brief 2026-10-24 item 6: "a hole breaks the line". (The design's area wash under the trend is kept meanwhile — a
// founder conflict on the STEP1 list — so no area-fill check.)
test('court-speed trend: a season with no reading breaks the line', () => {
  const m = fixture([], { m: { tour: 'ATP Nowhere', courtSpeed: { speed: 66, abstractSpeed: 1.02, altitude: 20, as2023: 0.98, as2024: null, as2025: 1.02, category: 'Medium' } } });
  assert.equal((marketOf(m).match(/<polyline/g) || []).length, 0, 'no segment drawn across the 2024 hole');
});
// Mutations 'ROI: a card clickable with no archive names', 'ROI: a small-n yield in full colour'
test('ROI + reliability: tournament-market.json figures, dashed when absent, greyed at n 5–9, open only with archive names', () => {
  const m = fixture([]);
  S.market = null;
  let h = marketOf(m);
  assert.ok(!/onclick="trSet\(\{roi/.test(h) && /ROI backing favourites — flat-stake yield/.test(text(h)), text(h).slice(0, 300));
  S.market = { baseline: { roiFav: -1.8, roiDog: -6.9, favRel: 70 }, tournaments: { Washington: { n: 120, roiFav: 2.5, roiDog: -9, favRel: 74, nRel: 123, archiveNames: ['Citi Open'] } } };
  h = marketOf(m);
  assert.ok(text(h).includes('+2.5% flat-stake yield +4.3pp vs tour avg'));
  assert.ok(/data-tr="roi-fav" role="button" tabindex="0" onclick="trSet\(\{roi:'fav'\}\)"/.test(h));
  assert.match(text(h), /74%/, 'favourite reliability');
  S.market = { baseline: { roiFav: -1.8, roiDog: -6.9, favRel: 70 }, tournaments: { Washington: { n: 7, roiFav: 2.5, roiDog: -9, favRel: 74, nRel: 7 } } };
  h = marketOf(m);
  assert.ok(text(h).includes('small sample') && !/data-tr="roi-fav"[^>]*onclick/.test(h));
  assert.match(h, /color:var\(--ma2-grey\);">\+2\.5%</, 'a 5–9 yield is greyed');
  S.market = null;
});

// Mutations 'DoD 8: a row stops opening the sheet', 'DoD 8: a tab-local row renderer again', 'more: the singular plural'
// (the 2026-11-23 lock draws the design's own rows — "rows through maMatchRowsHtml" is superseded; every row still opens the one sheet)
test('DoD 8: every row registered in the one sheet map and opening it; the old renderers are gone', () => {
  const m = fixture([ed(2025, [['2025-07-22', 'A. B', 'Final', true, W2]]), ed(2024, [['2024-07-22', 'A. B', 'Final', true, W2]]), ed(2023, [['2023-07-22', 'A. B', 'Final', true, W2]]), ed(2022, [['2022-07-22', 'A. B', 'Final', true, W2]])]);
  const h = card0(S.buildTournamentSection(m));
  const rows = [...h.matchAll(/class="seg ma2-row" onclick="fhOpenSheet\('([^']+)'\)"/g)];
  assert.equal(rows.length, 3, 'three editions shown before "Show 1 earlier edition"');
  rows.forEach(r => { assert.ok(S.fh.sheetMap[r[1]], 'registered in the one sheet map'); });
  assert.ok(text(h).includes('Show 1 earlier edition') && !text(h).includes('Show 1 earlier editions'));
  for (const f of ['atournMatchRowHtml', 'atournYearRowHtml', 'atournPlayerColumn', 'upgradeTournamentRows', 'toggleTournamentYear', 'showTournamentMore'])
    assert.ok(!html.includes('function ' + f + '('), f + ' deleted');
  assert.ok(!/\.atourn-/.test(html), 'the tab\'s own CSS is deleted');
});

// TEN-402 · founder ruling 2026-10-08 (card 01102d24; supersedes Q8's closes join for the profile): the player-profile
// per-event Backing (column + "Backing him here" tile) and its rows' H / A are the DATABASE join — database-yield.json rows
// plus the retirements behind its flag, Pinnacle closing, else Bet365 closing, per match, through the Head to Head page's
// own h2hPriceJoin (H2HPage.priceJoin, sliced and executed here), a retirement settled on the official ATP result — never
// the closes shard (the Match analysis tab keeps those) and never the market-edge shard. The profile module runs for real
// (player-profile-v2.js, TEN332_PP2) against the page's real model. Mutations: 'Q8: the profile reads the market-edge
// shard', 'TEN-402: the profile back on the closes join', 'TEN-402: the flagged retirements dropped'.
const PPW = { FEATURE_PP2: true, playerProfiles: { players: {} }, marketEdge: {}, careerHistory: {}, MarketEdgeCore: globalThis.MarketEdgeCore,
  get trProfileBacking(){ return globalThis.trProfileBacking; }, get trProfilePriceOf(){ return globalThis.trProfilePriceOf; } };
new Function('window', pp2)(PPW);
test('ruling 2026-10-08: the profile\'s per-event Backing and H / A are the Database join (retirements settled on the ATP result) — never the closes shard, never the market-edge shard', () => {
  const games = [['2024-07-21', 'A. B', 'Final', true, W2, { p: [1.5, 2.6] }], ['2024-07-20', 'C. D', 'Semi-finals', false, L2, { p: [2.0, 1.85] }],
    ['2024-07-19', 'E. F', 'Quarter-finals', true, W2, { p: [1.8, 2.05] }], ['2024-07-18', 'G. H', '1/8-finals', true, W2, { b: [1.4, 2.9] }],
    ['2024-07-17', 'I. J', '1/16-finals', true, W2, { p: [1.3, 3.5] }], ['2024-07-16', 'K. L', '1/32-finals', true, W2, { p: [2.5, 1.55] }],
    // founder ruling 2026-10-17 (item 1): a match the closes shard prices and the Database does not hold — on the Database
    // join it is a dash; the closes path would print 1.70 / 2.10 (the mutant 'the profile back on the closes join')
    ['2024-07-15', 'M. N', '1/64-finals', true, W2, { p: [1.7, 2.1] }]];
  // the closes shard (+2.5u) is loaded for the player — and read by nothing (TEN-402 r2: the tab left it too)
  const m = fixture([ed(2024, games)], { noDb: true });
  const d = S.tr.data[0];
  S.chShards['1'] = d.ch; S.fhCl['1'] = d.cl;
  // the Database prices differ from the closes: F 1.60, QF 1.90, R16 1.50 (Bet365), R32 1.30 a RETIREMENT (flagged), R64 2.40
  const DBPX = { 'A. B': { px: [1.6, 2.4] }, 'C. D': { px: [2.1, 1.75] }, 'E. F': { px: [1.9, 1.95] }, 'G. H': { px: [1.5, 2.7], book: 1 },
    'I. J': { px: [1.3, 3.5], ret: true }, 'K. L': { px: [2.4, 1.6] } };
  const st = dbStore(games, g => DBPX[g[1]]);
  S.dbJoin = dbPriceJoinRows(st.base, st.nm);
  // the profile's own store: draw order, a qualifying round and a walkover the tab's history never carries (N7, N2)
  const R = { 'Final': 'F', 'Semi-finals': 'SF', 'Quarter-finals': 'QF', '1/8-finals': 'R16', '1/16-finals': 'R32', '1/32-finals': 'R64', '1/64-finals': 'R128' };
  const matches = games.slice().reverse().map(g => ({ res: g[3] ? 'W' : 'L', round: R[g[2]], opp: g[1], oppKey: null, score: g[3] ? '2 - 0' : '0 - 2' }));
  const prof = { key: '1', name: 'J. Sinner', tournamentHistory: [{ name: 'Washington', won: 5, lost: 1, titles: 1, bestResult: 'Winner', bestYears: [2024],
    editions: [{ year: 2024, finish: 'Winner', matches: [{ res: 'W', round: 'Q1', opp: 'Q. Qual', oppKey: null, score: '2 - 0' },
      { res: 'W', round: 'R128', opp: 'W. Over', oppKey: null, score: '0 - 0', walkover: true }].concat(matches) }] }] };
  PPW.playerProfiles.players['1'] = prof;
  // the market-edge shard attributes other P&L to the same matches (+5u each) — the retired source must not reach the tile
  PPW.marketEdge['1'] = { matches: games.map(g => ({ date: g[0], opp: g[1], event: 'Washington', inBasis: true, pl: 5, price: 9.99, oppPrice: 1.01, book: 'pinnacle', surface: 'hard' })) };
  const I = PPW.PlayerProfileV2._internals;
  const v = I.tournViews(prof).find(x => x.name === 'Washington');
  // flat 1u: +0.60 −1 +0.90 +0.50 +0.30 (the retirement, won → settled at 1.30) +1.40 = +2.70u over 6 priced
  assert.equal(v.pinN, 6, 'the six main-draw rows, the flagged retirement included — the qualifier and the walkover are not rows');
  assert.equal(v.pinTxt, '+2.7u');
  const det = text(I.renderTournDetail(prof, v));
  assert.ok(det.includes('Backing him here +2.7u'), det.slice(det.indexOf('Backing him here'), det.indexOf('Backing him here') + 60));
  assert.ok(text(I.renderTournModal(prof)).includes('+2.7u'), 'the Record per tournament column prints the same units');
  // the rows' H / A are the same join: the final at 1.60 / 2.40, the retirement 1.30 / 3.50, R16 the Bet365 1.50 / 2.70
  const hx = (h, o) => { const x = new RegExp(o.replace('.', '\\.') + ' (?:F|SF|QF|R16|R32|R64|R128) \\d - \\d — (\\d+\\.\\d\\d) (\\d+\\.\\d\\d)').exec(h); return x ? x[1] + ' / ' + x[2] : '—'; };
  assert.deepEqual(['A. B', 'I. J', 'G. H', 'K. L', 'Q. Qual', 'M. N'].map(o => hx(det, o)), ['1.60 / 2.40', '1.30 / 3.50', '1.50 / 2.70', '2.40 / 1.60', '—', '—'],
    'the detail rows\' H / A = the Database join (the retirement too); the qualifier has none');
  // TEN-402 r2 (founder card 7bc622d5, 2026-10-09): the Match analysis Tournament tab prints the SAME figures — its tile, its
  // rows' H / A and B mark — from the same join; never the closes' +2.5u
  const tabH = S.buildTournamentSection(m), tb = tile(tabH, 'Backing');
  assert.equal(tileV(tb)[1], '+2.7u', 'the tab = the profile (+2.7u), not the closes (+2.5u)');
  assert.ok(text(tb).includes('6 of 7 matches priced'), text(tb));
  const tabPx = o => { const x = trRows(tabH).find(r => r.opp === o); return x ? x.h + ' / ' + x.a + (x.mark ? ' ' + x.mark : '') : null; };
  assert.deepEqual(['A. B', 'I. J', 'G. H', 'K. L'].map(tabPx), ['1.60 / 2.40', '1.30 / 3.50', '1.50 / 2.70 B', '2.40 / 1.60'], 'the tab rows = the profile rows');
  // one model: row for row, the tab's prices are the profile model's (trProfileModel), and so are the units and n
  const PT = S.trModelFor(m, 0), PP = S.trProfileModel('1', 'J. Sinner', prof.tournamentHistory[0]);
  const px = P => P.all.map(r => [r.date, r.opp, r.won, r.price, r.oppPrice, r.book].join('|')).sort();
  assert.deepEqual(px(PT), px(PP), 'the tab and the profile price every row identically');
  assert.deepEqual([PT.priced.length, Math.round(PT.units * 100), PT.vm], [PP.priced.length, Math.round(PP.units * 100), PP.vm]);
  // control: the Database rows alone (the retirement voided) → 5 priced, +2.4u; the flag is what settles it
  S.dbJoin = dbPriceJoinRows(Object.assign({}, st.base, { retRows: [] }), Object.assign({}, st.nm, { retNames: [] }));
  const c = I.tournViews(prof).find(x => x.name === 'Washington');
  assert.deepEqual([c.pinN, c.pinTxt], [5, '+2.4u']);
  // before the Database rows answer: a blank figure and "loading prices" (TEN-402 R2, founder card 7bc622d5: a neutral
  // loading state, never 0 and never "—", which is a failed load) — never the closes' +2.5u nor the market shard's +30.0u
  const savedTab = globalThis.DatabaseTab;
  globalThis.DatabaseTab = { priceRows: () => new Promise(() => {}) };
  S.dbJoin = null;
  const w = I.tournViews(prof).find(x => x.name === 'Washington');
  assert.equal(w.pinPl, null); assert.ok(w.backingPending);
  assert.ok(text(I.renderTournDetail(prof, w).replace(/&nbsp;/g, ' ')).includes('Backing him here loading prices'));
  assert.ok(I.renderTournDetail(prof, w).includes('data-pp2-pending="backing"'));
  const wd = text(I.renderTournDetail(prof, w));
  assert.ok(!/9\.99|1\.50 2\.60|2\.40 1\.60/.test(wd), 'no closes / shard price while pending');
  // the tab while the Database rows load: "loading prices", the price cells empty (claim nothing) — never a closes price
  const pend = S.buildTournamentSection(m);
  assert.ok(text(tile(pend, 'Backing')).includes('— loading prices'), text(tile(pend, 'Backing')));
  assert.ok(!/1\.50|2\.60|1\.85/.test(text(card0(pend))), 'no closes price on the tab while pending');
  assert.deepEqual(trRows(pend).map(r => [r.tip, r.h]), Array(7).fill(['Loading prices', '']), 'seven empty H cells (every row, the one the Database does not hold included)');
  // a failed load: the tab's words, "prices unavailable" — never "loading" forever
  S.dbJoinSt = 'failed';
  assert.ok(text(I.renderTournDetail(prof, I.tournViews(prof).find(x => x.name === 'Washington'))).includes('Backing him here — prices unavailable'));
  assert.ok(text(tile(S.buildTournamentSection(m), 'Backing')).includes('— prices unavailable'), 'the tab: the same words');
  globalThis.DatabaseTab = savedTab;
  S.dbJoin = null;
  delete S.chShards['1']; delete S.fhCl['1'];
});

// Q8, the edges a join without event keys meets (review of TEN-368): the profile's edition rows carry no event key and no
// date, so each is resolved to its career-history row first, then priced on the Database join. Mutations 'Q8: two
// meetings in one edition left unresolved', 'Q8: the voted event-name aliases dropped'.
test('Q8: two meetings with one opponent in an edition resolve by round; a profile event name the store spells differently joins by vote', () => {
  const games = [['2024-11-17', 'A. B', 'Final', true, W2, { p: [2.5, 1.55] }], ['2024-11-15', 'C. D', 'Semi-finals', true, W2, { p: [1.5, 2.6] }],
    ['2024-11-12', 'A. B', 'Quarter-finals', true, W2, { p: [1.8, 2.05] }], ['2024-11-10', 'E. F', '1/8-finals', false, L2, { p: [1.3, 3.5] }],
    ['2024-11-09', 'G. H', '1/16-finals', true, W2, { b: [1.4, 2.9] }]];
  const m = fixture([ed(2024, games)]);
  const d = S.tr.data[0];
  S.chShards['1'] = d.ch; S.fhCl['1'] = d.cl;
  // the Database carries the same closes here, so the profile prints the tab's figure: 1.5 + 0.5 + 0.8 − 1 + 0.4
  const st = dbStore(games, g => (g[5].p ? { px: g[5].p } : { px: g[5].b, book: 1 }));
  S.dbJoin = dbPriceJoinRows(st.base, st.nm);
  const tb = tile(S.buildTournamentSection(m), 'Backing');
  const tabU = tileV(tb)[1];
  assert.equal(tabU, '+2.2u', 'A. B twice (QF and F): both priced by the tab, by event key (1.5 + 0.5 + 0.8 − 1 + 0.4)');
  const R = { 'Final': 'F', 'Semi-finals': 'SF', 'Quarter-finals': 'QF', '1/8-finals': 'R16', '1/16-finals': 'R32' };
  const row = g => ({ res: g[3] ? 'W' : 'L', round: R[g[2]], opp: g[1], oppKey: null, score: g[3] ? '2 - 0' : '0 - 2' });
  // the profile's store names the event "Citi DC Open"; career-history says "Washington" — the unambiguous rows vote the alias
  const prof = { key: '1', name: 'J. Sinner', tournamentHistory: [{ name: 'Citi DC Open', won: 4, lost: 1, editions: [{ year: 2024, matches: games.slice().reverse().map(row) }] }] };
  // TEN-402: the Head to Head page holds the list in the tournament-history shard cache, not on the profile record —
  // the vote reads it there too (Zverev, Roland Garros 2016–2021 resolved on the profile but not on the H2H card)
  PPW.playerProfiles.players['1'] = prof; S.thShards['1'] = prof.tournamentHistory; PPW.marketEdge['1'] = { matches: [] };
  const v0 = PPW.PlayerProfileV2._internals.tournViews(prof)[0];
  assert.equal(v0.pinN, 5, 'the shard cache alone: the renamed event still joins by the voted alias');
  delete S.thShards['1']; S.profiles['1'] = prof;
  const v = PPW.PlayerProfileV2._internals.tournViews(prof)[0];
  assert.equal(v.pinN, 5, 'every row resolved: the two A. B meetings by round, the renamed event by the voted alias');
  assert.equal(v.pinTxt, tabU);
  S.dbJoin = null;
  delete S.chShards['1']; delete S.fhCl['1']; delete S.profiles['1'];
});

// TEN-380 (step 3 reference): the two bugs, kept on the 2026-11-23 design. Bug 1: a −3.7% yield that beats a −6.9% tour
// average was drawn green (its colour followed the gap, not the value). Bug 2: the Backing tile's 280px pop, centred on the
// row's last tile, ran past the column. The founder Q2 court-speed bar stays flat with a white knob. (Superseded by the
// 2026-11-23 lock: the --card / --edge-6 panels, the surface chip, the --inner current meta cell, the plain-text toggle,
// --bar on --track for reliability — now the design's --ma2-* tokens.)
test('TEN-380: ROI values white (never green on a negative yield); the court-speed bar flat; Backing pop opens leftwards', () => {
  const m = fixture([nMatches(6, i => i % 2 === 0, null)]);
  S.market = { baseline: { roiFav: -1.8, roiDog: -6.9, favRel: 70 }, tournaments: { Washington: { n: 120, roiFav: 2.5, roiDog: -3.7, favRel: 74, nRel: 123, archiveNames: ['Citi Open'] } } };
  const h = marketOf(m);
  const val = side => new RegExp(`data-tr="roi-${side}"[^]*?font-size:26px;[^"]*color:([^;"]+);">([^<]*)<`).exec(h);
  assert.equal(val('dog')[2], '−3.7%'); assert.equal(val('dog')[1], 'var(--ma2-text)', 'a negative yield is not green');
  assert.equal(val('fav')[1], 'var(--ma2-text)');
  assert.ok(!/var\(--(ma2-)?(pos|neg|green|red)\)/.test(h), 'no signed colour on the panel');
  assert.ok(text(h).includes('+3.2pp vs tour avg'), 'Q14: the sub-line keeps "±x.xpp vs tour avg"');
  const bi = h.indexOf('<span>Slow</span>'), bar = h.slice(h.lastIndexOf('<div style="position:relative; height:6px;', bi), bi);
  assert.ok(bar.length > 0 && !/gradient/.test(bar), 'the court-speed bar is flat');
  assert.match(bar, /border-radius:50%; background:var\(--ma2-text\);/, 'a white knob');
  const all = S.buildTournamentSection(m);
  assert.match(all, /class="elotip-pop" role="tooltip" style="bottom:calc\(100% \+ 8px\); left:auto; right:0; transform:none; white-space:normal; width:280px;"/, 'the Backing pop is right-anchored');
  S.market = null;
});

// TEN-380 review (founder 2026-10-04): the "B" beside a Tournament price (Bet365 filling a missing Pinnacle close) is said in
// words under the records, as Form says it; no B on the page → no line. Mutation: the line dropped from the section.
// RENDERER GAP (modal-analysis.md Tournament tab → Prices: "the 'Closing odds · Pinnacle, Bet365 where missing (N)' line";
// TEN-380 review: the B explained in words under the records): the rebuilt tab draws the B mark on the row but no line,
// and the Backing hover names no book split (the old trSrcLine + the tile's "Bet365 where missing (N)").
test('review: a B price is explained under the records ("Closing odds · Pinnacle, Bet365 where missing (N) · B = Bet365")', () => {
  const m = fixture([ed(2024, [['2024-07-20', 'C. D', 'Final', true, W2, { b: [1.4, 2.9] }], ['2024-07-19', 'E. F', 'Semi-finals', true, W2, { p: [1.8, 2.05] }]])]);
  const h = S.buildTournamentSection(m);
  assert.deepEqual(trRows(h).map(r => r.mark), ['B', ''], 'the B mark on the Bet365 row');
  assert.match(text(h), /Closing odds · Pinnacle, Bet365 where missing \(1\) · B = Bet365/, 'the line under the records');
  assert.match(text(tile(h, 'Backing')), /Bet365 where missing \(1\)/, 'the book split in the Backing hover');
});

// TEN-402 r2 (founder card 7bc622d5, 2026-10-09; card2 "recent": no fallback after the archive's last date): a match of the
// live edition is after the Database archive's last match, so it has no price on the one join — its H / A are "—" with the
// reason, never a closes price, and the Backing tooltip counts it. TEN-406 adds the captured closes after that date to the
// archive (same rule). Mutations 'TEN-402 r2: the tab off the Database join', 'TEN-402 r2: the after-archive reason dropped'.
test('TEN-402 r2: a live-edition match after the archive\'s last date is "—" with the reason — never the closes price', () => {
  const m = fixture([ed(2026, [['2026-10-08', 'L. Live', '1/16-finals', true, W2, { p: [1.4, 3.0] }]]), ed(2025, [['2025-10-05', 'A. B', 'Final', true, W2, { p: [1.5, 2.6] }]])],
    { m: { date: '2026-10-10' } });
  // the archive ends 13 Sep 2026 (meta.dateRange): the 2026 row is not in it — drop it from the store, as the real one lacks it
  const games = [['2025-10-05', 'A. B', 'Final', true]];
  const st = dbStore(games, () => ({ px: [1.5, 2.6] }));
  st.base.meta.dateRange = ['2010-01-04', '2026-09-13'];
  S.dbJoin = dbPriceJoinRows(st.base, st.nm);
  const h = S.buildTournamentSection(m), c = card0(h);
  assert.deepEqual(trRows(h).filter(r => r.opp === 'L. Live').map(r => [r.tip, r.h]), [['After the Database archive’s last match (13 Sep 2026): no closing price on record yet', '—']], 'the live row: "—" with the reason');
  assert.ok(!/1\.40|3\.00/.test(text(c)), 'never the closes shard\'s price for the live match');
  assert.ok(text(c).includes('1.50') && text(c).includes('2.60'), 'the archived edition keeps its Database price');
  const tb = text(tile(h, 'Backing'));
  assert.ok(tb.includes('+0.5u') && tb.includes('1 of 2 matches priced'), tb);
  // RENDERER GAP (modal-analysis.md Tournament tab → Prices: "the Backing tooltip counts them ('N after its last match …
  // not priced yet')"): the rebuilt hover does not count the after-archive rows.
  assert.ok(tb.includes('1 after its last match (13 Sep 2026) not priced yet'), 'the Backing hover counts the after-archive row: ' + tb);
});

// TEN-402 r2: the tab reads the Database rows through the ONE session loader (sfDbJoinLoad → DatabaseTab.priceRows), shared with
// the profile and Head to Head: one load per session however often the tab opens; the closes shard is never fetched; the
// rows paint before the prices land. Mutations 'TEN-402 r2: the tab never loads the Database rows', 'TEN-402 r2: the tab
// waits on nothing (state ignores the Database rows)'.
test('TEN-402 r2: the tab loads the Database rows once per session (the shared loader), never the closes shard', async () => {
  const m = fixture([nMatches(2, () => true, () => [1.5, 2.6])], { noDb: true });
  const E = S.tr; E.state = ['idle', 'idle']; E.data = [null, null];
  S.chShards['1'] = [];
  const games = m.p1TournamentHistory.years[0].matches.map(x => [x.date, x.opponent, x.round, x.won]);
  const st = dbStore(games, () => ({ px: [1.5, 2.6] }));
  let calls = 0, release;
  const gate = new Promise(r => { release = r; });
  const savedTab = globalThis.DatabaseTab, savedFetch = globalThis.fetch, fetched = [];
  globalThis.DatabaseTab = { priceRows: () => { calls++; return gate.then(() => dbPriceJoinRows(st.base, st.nm)); } };
  globalThis.fetch = u => { fetched.push(String(u)); return Promise.reject(new Error('offline')); };
  try {
    const done = S.trLoad(m);
    await new Promise(r => setTimeout(r, 0));
    // the rows are there, the prices pending: "loading prices", never 0 / "none priced"
    const mid = tile(S.buildTournamentSection(m), 'Backing');
    assert.ok(text(mid).includes('— loading prices') && !/none priced|0\.0u/.test(text(mid)), text(mid));
    release();
    await done;
    assert.equal(calls, 1, 'one Database load');
    assert.ok(text(tile(S.buildTournamentSection(m), 'Backing')).includes('+1.0u'));
    E.state = ['idle', 'idle'];
    await S.trLoad(m);
    assert.equal(calls, 1, 'the tab opened again: the session cache, no second load');
    assert.ok(!fetched.some(u => /match-closes/.test(u)), 'the closes shard is never fetched: ' + fetched.join(', '));
  } finally { globalThis.DatabaseTab = savedTab; globalThis.fetch = savedFetch; S.dbJoin = null; delete S.chShards['1']; }
});

// TEN-402 r2: a pre-2021 career row is dated at the tournament START while the pipeline history carries the match day; the
// join meets the joined career row on its own date (as the profile hands it on), so the tab prices what the profile prices
// (live: Zverev, Shanghai 2019 F / SF / QF were "—" on the tab and priced on the profile until this). Mutation 'TEN-402 r2: a
// joined row meets the join on the history's match day'.
test('TEN-402 r2: a start-dated career row meets the Database join on its own date — the tab prices what the profile prices', () => {
  const games = [['2019-10-13', 'D. Med', 'Final', false, L2, { p: [2.59, 1.58] }], ['2019-10-12', 'M. Ber', 'Semi-finals', true, W2, { p: [1.65, 2.43] }],
    ['2019-10-11', 'R. Fed', 'Quarter-finals', true, W2, { p: [3.04, 1.45] }], ['2019-10-10', 'A. Rub', '1/8-finals', true, W2, { p: [1.58, 2.59] }],
    ['2019-10-09', 'J. Cha', '1/16-finals', true, W2, { p: [1.27, 4.23] }]];
  const m = fixture([ed(2019, games)]);
  S.tr.data[0].ch.forEach(c => { c.date = '2019-10-07'; c.eventKey = null; c.src = 'archive'; });   // start-dated, no event key
  const P = S.trModelFor(m, 0);
  assert.deepEqual(P.all.map(r => r.price), [2.59, 1.65, 3.04, 1.58, 1.27], 'every row priced, the final included');
  assert.equal(Math.round(P.units * 100), -100 + 65 + 204 + 58 + 27);
  S.dbJoin = null;
});

// Founder ruling 2026-10-17 (item 1): ONE price per match on every page. The closes-shard tabs — Overview, Progression and
// Market edge's derived lines (meRowFromCareer), Form and H2H (the same sfDbPxRows call) — show the Database's own price,
// book and source wherever its join holds the match: here a start − 10 Pinnacle (approx.) snapshot (book 5) the closes
// shard prices as a Tennis-Data Pinnacle close. A match the Database does not hold keeps the closes price (reported by
// tools/price-consistency.mjs, pending a ruling). Controls: before the join answers, the closes price; the tab sources
// call the shared function (no tab prices on its own once the join holds the match).
test('founder ruling 2026-10-17 (item 1): the closes-shard tabs show the Database\'s own price, book and source wherever its join holds the match', () => {
  const games = [['2026-07-26', 'A. B', 'Final', true, W2, { p: [1.5, 2.6] }], ['2026-07-23', 'C. D', '1/8-finals', false, L2, { p: [2.0, 1.85] }]];
  fixture([ed(2026, games)], { noDb: true });
  const d = S.tr.data[0];
  S.chShards['1'] = d.ch;
  const st = dbStore(games, g => (g[1] === 'A. B' ? { px: [1.55, 2.45], book: 5 } : null));
  S.dbJoin = dbPriceJoinRows(st.base, st.nm);
  const row = o => { const i = d.ch.findIndex(x => x.opponent === o); return S.meRowFromCareer(d.ch[i], d.cl, '1', 'J. Sinner', i); };
  const pk = r => [r.price, r.oppPrice, r.book, r.src];
  assert.deepEqual(pk(row('A. B')), [1.55, 2.45, 'A', 'od10'], 'the Database\'s start − 10 snapshot, never the closes 1.50 / 2.60');
  // founder ruling 2026-10-17 (ruling 3): an ATP tour-level match is the master's class — a dash where the join holds
  // none, and a dash before the join answers (never the closes price); the closes shard prices Challenger / ITF only
  assert.deepEqual(pk(row('C. D')), [null, null, null, null], 'an ATP match the Database does not hold: a dash, never the closes price');
  S.dbJoin = null;
  assert.deepEqual(pk(row('A. B')), [null, null, null, null], 'before the join answers: a dash, never the closes price');
  const ci = d.ch.findIndex(x => x.opponent === 'C. D'), chx = Object.assign({}, d.ch[ci], { level: 'chitf' });
  // founder ruling 2026-10-18 (item 3): Challenger, qualifying and ITF are in the master too — a Challenger row the join
  // does not hold is a dash, never its closes price (the tabs' own path is gone for every level)
  assert.deepEqual(pk(S.meRowFromCareer(chx, d.cl, '1', 'J. Sinner', ci)).slice(0, 2), [null, null], 'a Challenger row the join does not hold: a dash, never the closes 2.00 / 1.85');
  // every closes tab hands its rows to the ONE shared function
  for (const f of ['fhFormPlayer', 'fhMeetings', 'meRowFromCareer']) assert.ok(/sfDbPxRows\(/.test(slice(f)), f + ' prices through sfDbPxRows');
});

// ---- Option A (founder 2026-10-21): Form and Tournament keep the feed's matches (TEN-449: the record is its own population)
// and show each one as the career record counts it — the result, and on Form the surface. Mutants: tools/test-ten332-mutants.js.
const recReset = (src) => { for (const k of Object.keys(S.recLayers)) delete S.recLayers[k]; globalThis.__recSrc = src || {}; globalThis.__recFail = false; };
// offline, and the Database rows answered (empty) — never a join promise an earlier test left pending
const offline = async (fn) => { const f = globalThis.fetch, D = globalThis.DatabaseTab; globalThis.fetch = () => Promise.reject(new Error('offline'));
  globalThis.DatabaseTab = { priceRows: () => Promise.resolve(null) }; try { return await fn(); } finally { globalThis.fetch = f; globalThis.DatabaseTab = D; } };
function flipFixture() {
  // newest first: A. Flip (SF, a feed win the record counts as a loss), B. Keep (QF, a win), C. Loss (R16, a loss)
  const m = fixture([ed(2025, [['2025-07-25', 'A. Flip', 'Semi-finals', true, W2], ['2025-07-24', 'B. Keep', 'Quarter-finals', true, W2], ['2025-07-23', 'C. Loss', '1/8-finals', false, L2]])]);
  return { m, E: S.trStateFor(m), ch: S.trStateFor(m).data[0].ch };
}

test('option A · Tournament: the record\'s result is the one shown, and the edition W–L moves with it', () => {
  const { m, E, ch } = flipFixture();
  assert.equal(ch[0].opponent, 'A. Flip');
  E.data[0].fix = S.recordFixOf(ch, { over: [[0, { won: false }]] });
  const P = S.trModelFor(m, 0);
  assert.equal(P.eds[0].rows[0].won, false, 'A. Flip reads as the record counts it');
  assert.equal(m.p1TournamentHistory.years[0].matches[0].won, true, 'the feed row is untouched');
  assert.deepEqual([P.eds[0].won, P.eds[0].lost, P.W, P.L], [1, 2, 1, 2], 'edition and tile W–L: 1–2, not the feed\'s 2–1');
  assert.ok(text(S.buildTournamentSection(m)).includes('1–2'), 'the edition header prints 1–2');
});

test('option A · a feed row whose result disagrees with its career row (the name-order scramble) takes no correction', () => {
  const { m, E, ch } = flipFixture();
  ch[0] = Object.assign({}, ch[0], { won: false });   // the career row says lost, the history won: not the same match
  E.data[0].fix = S.recordFixOf(ch, { over: [[0, { won: false }]] });   // differs from the history's win: the guard is what keeps it
  assert.equal(S.trModelFor(m, 0).eds[0].rows[0].won, true);
});

test('option A · Key factors "Record here": the record\'s results by event key, with no career join', () => {
  const { m, ch } = flipFixture();
  const T = S.trModelOf(m.p1TournamentHistory, { ch: null, cl: null, fix: S.recordFixOf(ch, { over: [[0, { won: false }]] }) }, '1', 'J. Sinner', 'Washington', ['Washington'], '2026', 'idle');
  assert.deepEqual([T.W, T.L], [1, 2]);
  assert.match(MA2_SRC, /trModelOf\(i \? m\.p2TournamentHistory : m\.p1TournamentHistory, \{ ch: null, cl: null, fix: recordFixFor\(i \? m\.p2Key : m\.p1Key\) \}/, 'kfTourBox passes the record');
});

test('option A · the Tournament tab loads the record with the history; a record that does not answer fails the side', { timeout: 15000 }, async () => {
  const { m, E, ch } = flipFixture();
  S.chShards['1'] = ch;
  recReset({ 1: { over: [[0, { won: false }]] } });
  E.state = ['idle', 'idle']; E.data = [null, null];
  await offline(() => S.trLoad(m));
  assert.equal(E.state[0], 'ready');
  assert.deepEqual([S.trModelFor(m, 0).W, S.trModelFor(m, 0).L], [1, 2], 'the loaded record corrects the tab');
  recReset(); globalThis.__recFail = true;
  E.state = ['idle', 'idle']; E.data = [null, null];
  await offline(() => S.trLoad(m));
  assert.equal(E.state[0], 'failed', 'never the feed rows uncorrected as if checked');
  recReset(); delete S.chShards['1'];
});

test('option A · Form: rows read as the record counts them (result, surface), from the form shard and the career fallback', { timeout: 15000 }, async () => {
  S.dbJoin = null;   // a fresh join state: fhEnsureFormData loads it (offline answers it)
  // p1 from his form shard (joined by event key); p2 from his career history (joined by index: these rows carry no key)
  const fr = (ek, date, opp, won, surface) => ({ eventKey: ek, date, opponent: opp, opponentKey: null, tournament: 'ATP Washington', round: '1/8-finals', surface, won, result: won ? '2 - 0' : '0 - 2', sets: won ? [{ p: 6, o: 3 }, { p: 6, o: 4 }] : [{ p: 3, o: 6 }, { p: 4, o: 6 }], tier: 'atp' });
  const cr = (ek, date, opp, won, surface) => ({ eventKey: ek, date, year: date.slice(0, 4), opponent: opp, tournament: 'ATP Washington', round: '1/8-finals', surface, won, level: 'atp', result: won ? '2 - 0' : '0 - 2', sets: won ? [{ p: 6, o: 3 }, { p: 6, o: 4 }] : [{ p: 3, o: 6 }, { p: 4, o: 6 }] });
  S.chShards['7'] = [cr(701, '2026-08-03', 'R. Flip', true, 'hard'), cr(702, '2026-08-02', 'S. Surf', true, 'hard'), cr(703, '2026-08-01', 'T. Scram', false, 'hard')];
  S.chShards['8'] = [cr(null, '2026-08-03', 'U. Flip', true, 'clay'), cr(null, '2026-08-02', 'V. Keep', false, 'clay')];
  recReset({ 7: { over: [[0, { won: false }], [1, { surface: 'grass' }], [2, { won: false }]] }, 8: { over: [[0, { won: false, surface: 'grass' }]] } });
  const shard = [fr(701, '2026-08-03', 'R. Flip', true, 'hard'), fr(702, '2026-08-02', 'S. Surf', true, 'hard'), fr(703, '2026-08-01', 'T. Scram', true, 'hard')];
  const m = { id: 'fx-optA', p1: 'A. One', p2: 'B. Two', p1Key: '7', p2Key: '8', date: '2026-10-20', surface: 'Hard', tour: 'ATP Somewhere', p1RecentFormMatches: shard, p2RecentFormMatches: null };
  await offline(() => S.fhEnsureFormData(m));
  const rows = i => { const F = S.fhStateFor(m); return S.fhFormPlayer(m, i, Object.assign(F.form, { surf: 'all' })).shown; };
  const by = (i, opp) => rows(i).find(r => r.opp === opp);
  assert.equal(by(0, 'R. Flip').won, false, 'form shard: the record\'s result');
  assert.equal(by(0, 'S. Surf').surface, 'Grass', 'form shard: the record\'s surface');
  assert.equal(by(0, 'T. Scram').won, true, 'a disagreeing career row (scramble) corrects nothing');
  assert.equal(by(1, 'U. Flip').won, false, 'career fallback: corrected by its career index');
  assert.equal(by(1, 'U. Flip').surface, 'Grass');
  assert.equal(shard[0].won, true, 'the feed rows are untouched');
  assert.equal(m._fhFormRetry, false);
  // a side whose record did not answer is shown uncorrected this time and retried
  recReset(); globalThis.__recFail = true;
  const m2 = Object.assign({}, m, { id: 'fx-optA2', _fhFormData: false, _fhFormRows: null, p1RecentFormMatches: shard.map(x => Object.assign({}, x)) });
  S.dbJoin = null;
  await offline(() => S.fhEnsureFormData(m2));
  assert.equal(m2._fhFormRetry, true, 'the next open retries the record');
  recReset(); delete S.chShards['7']; delete S.chShards['8'];
});
