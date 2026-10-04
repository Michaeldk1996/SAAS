// TEN-332 (TEN-312 Tournament tab, founder 2026-09-28 / 2026-09-29) — the Tournament tab rebuilt on the design file.
// Every check drives the page's REAL code (the TEN-263 … Tournament blocks sliced out of bsp-consult-dashboard.html and
// executed) and names the mutation that turns it red; tools/test-ten332-mutants.js applies each one to a copy of the page
// (TEN332_HTML).
//   · N6 only editions entered · N7 main draw (the history's own rows) · N2 walkovers in no count
//   · D2 one gate on every rate (W–L %, sets won, vs market) — never "0%" · D6 "+Y.Ypt vs market" at n >= 5
//   · N5 Backing at the R8 close (Pinnacle, then Bet365) · TEN-325 retirements settle at the close, note from the core
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
  function ensureFormRows(m){ return Promise.resolve(m); } function loadCareerHistory(){ return Promise.resolve([]); }
  function ensureStyleMeetings(m){ return Promise.resolve(m); } function ensurePsMatrix(){ return Promise.resolve(); }
  function ppStyleFor(){ return null; } function psArchFor(){ return null; } function styleMeetRowsFor(){ return []; }
  function openPlayerProfileFromMatch(){} function aGoTab(){}
  let _aM = null; const _aBuilt = new Set(); function aBuilt(){ return false; } function aPaint(){}
  const _careerHistoryShards = {};
  let tourxMarketData = null; function tourxFetchMarket(){ return Promise.resolve(tourxMarketData); }
  const HouseRatings = (function(){ const window = {}; ${HOUSE_RATINGS_SRC}; return window.HouseRatings; })();
  ${PS_TOUR_META_SRC}
  ${constSrc('TOURNAMENT_CATALOG')}
  ${constSrc('COURT_CONDITIONS')}
  const TOURX_KNOB_PAD = 0.08;
  ${['escapeHtml', 'surnameFirstName', 'psShortName', 'formIni', 'ppCleanTournamentName', 'psNormTour', 'psTourMeta', 'psRoundAbbr', 'h2hRoundLabel',
     'eventKeyOfMatch', 'courtSpeedCategory', 'tourxKnobPct', 'tourxConditionRegistry'].map(slice).join('\n')}
  ${between('/* =====================================================================\n   TEN-263 ', '// Extra stats tab REMOVED (TEN-8 Item 5)')}
  return { buildTournamentSection, trModelFor, trStateFor, trMarketHtml, trHeaderHtml, trRowOf, fhStateFor, maMatchRowsHtml, trProfileBacking,
    chShards: _careerHistoryShards, fhCl: _fhCl, profiles: playerProfiles, profileFail: _trProfileFail, set hold(v){ _trHoldData = v; },
    get tr(){ return _tr; }, get fh(){ return _fh; }, set market(v){ tourxMarketData = v; }, TR_RG_NOTE, TR_NO_SPEED };
`)(globalThis);
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

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
  return m;
}
const W2 = [[6, 3], [6, 4]], L2 = [[3, 6], [4, 6]];
const nMatches = (n, wonFn, price) => ed(2024, Array.from({ length: n }, (_, i) => ['2024-07-' + String(10 + i).padStart(2, '0'), 'P. Opp' + String.fromCharCode(97 + i), 'Round ' + i, wonFn(i), wonFn(i) ? W2 : L2, price ? { p: price(i) } : null]));
const card0 = h => h.slice(h.indexOf('class="tr-card"'), h.indexOf('class="tr-card"', h.indexOf('class="tr-card"') + 5));
const tile = (h, cap) => { const c = card0(h), i = c.indexOf('>' + cap + '<'); assert.ok(i > 0, cap); const a = c.lastIndexOf('<div class="tr-tile"', i), b = c.indexOf('<div class="tr-tile"', i);
  return c.slice(a, b > 0 ? b : c.indexOf('</div>', c.indexOf('tr-tile-sub', i)) + 6); };

// Mutation 'N6: a synthesised Withdrawal edition renders' (drop `.filter(y => !y.withdrew)`)
test('N6: only editions entered — a stale store\'s gap year never renders', () => {
  const m = fixture([ed(2025, [['2025-07-22', 'A. B', 'Final', true, W2]]), ed(2021, [], { withdrew: true, roundReached: 'Withdrawal' }), ed(2019, [['2019-07-22', 'C. D', '1/8-finals', false, L2]])]);
  const h = S.buildTournamentSection(m);
  assert.ok(!/Withdrawal|2021/.test(text(card0(h))));
  assert.deepEqual([...card0(h).matchAll(/>Washington (\d{4})</g)].map(x => x[1]), ['2025', '2019']);
});

// Mutations 'result: won final not "Won"', 'result: in-progress edition labelled by its last round', 'rows: group meta loses W–L'
test('edition headers: "Washington YYYY" + result · W–L — Won / the round lost / In progress (DESIGN GAP G17)', () => {
  // this year's edition stays "In progress" whether or not the analysed match itself is finished (never "· w/o")
  const done = fixture([ed(2026, [['2026-07-18', 'E. F', '1/8-finals', true, W2]])], { m: { finalScore: { winner: 'p1' } } });
  assert.ok(text(card0(S.buildTournamentSection(done))).includes('Washington 2026 In progress · 1–0'));
  const m = fixture([ed(2026, [['2026-07-18', 'E. F', '1/8-finals', true, W2]]), ed(2025, [['2025-07-20', 'A. B', 'Final', true, W2], ['2025-07-19', 'G. H', 'Semi-finals', true, W2]]),
    ed(2024, [['2024-07-19', 'C. D', 'Quarter-finals', false, L2], ['2024-07-17', 'I. J', '1/8-finals', true, W2]])]);
  const g = [...card0(S.buildTournamentSection(m)).matchAll(/<div class="ma-rows-group"[\s\S]*?<\/div>/g)].map(x => text(x[0]));
  assert.deepEqual(g, ['Washington 2026 In progress · 1–0', 'Washington 2025 Won · 2–0', 'Washington 2024 Quarter-final · 1–1']);
});

// Mutation 'gate: W–L % printed below n 5' / 'gate: n 0 prints 0%'
test('W–L record tile: n 0 "—" (never 0%), 3 count only, 7 greyed + hover note, 12 full', () => {
  const at = n => tile(S.buildTournamentSection(fixture(n ? [nMatches(n, i => i % 3 !== 2)] : [])), 'W–L record');
  assert.ok(text(at(0)).includes('—') && !/0%/.test(text(at(0))));
  assert.ok(!/%/.test(text(at(3))) && text(at(3)).includes('2–1'));
  assert.match(at(7), /data-ma-gate="small" title="small sample · n=7"[^>]*>71%</);
  assert.match(at(12), /data-ma-gate="full"[^>]*>67%</);
});

// Mutation 'sets: a retirement\'s unfinished set counted'
test('Sets won: finished sets only — a retirement\'s unfinished set is not a set (rule e)', () => {
  const m = fixture([ed(2024, [['2024-07-20', 'A. B', 'Final', true, [[6, 3], [2, 1]], { ret: true }], ['2024-07-18', 'C. D', 'Semi-finals', true, W2],
    ['2024-07-17', 'E. F', 'Quarter-finals', true, W2], ['2024-07-16', 'G. H', '1/8-finals', true, [[6, 3], [4, 6], [6, 2]]], ['2024-07-15', 'I. J', '1/16-finals', true, W2]])]);
  const t = text(tile(S.buildTournamentSection(m), 'Sets won'));
  assert.ok(t.includes('90%') && t.includes('9 of 10 sets'), t);   // 1 of the retirement's 2 sets + 6 + 2 of 3
});

// Mutation 'best: an in-progress edition counts as a result'
test('Best result: Won beats a final; an edition still being played is no result; the year under it', () => {
  const m = fixture([ed(2026, [['2026-07-19', 'E. F', 'Semi-finals', true, W2]]), ed(2024, [['2024-07-20', 'A. B', 'Final', false, L2]]), ed(2022, [['2022-07-20', 'A. B', 'Quarter-finals', false, L2]])]);
  assert.equal(text(tile(S.buildTournamentSection(m), 'Best result')), 'Best result F 2024');
  const m2 = fixture([ed(2026, [['2026-07-19', 'E. F', 'Semi-finals', true, W2]])]);
  assert.equal(text(tile(S.buildTournamentSection(m2), 'Best result')), 'Best result — no finished edition');
});

// Mutations 'backing: Pinnacle only (Bet365 fallback dropped)', 'backing: a retirement not settled', 'vm: shown below n 5',
// 'vm: implied rate not de-vigged', 'backing: RET note spelled out / dropped'
test('Backing (N5 + D6 + TEN-325): R8 closes, retirements settle at the close, vs market at n >= 5 de-vigged, note from the core', () => {
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
  assert.match(t, /−0\.0u|\+0\.0u|±0\.0u/);
  assert.match(t, /data-ma-gate="small"[^>]*>[+−]\d+\.\dpt vs market</);
  assert.ok(t.includes('>' + globalThis.MarketEdgeCore.RET_SETTLE_NOTE + '<') && t.includes('data-ret-note="tournament"'));
  // n 4 priced: the units show, no vs market
  const m4 = fixture([nMatches(4, i => i < 3, () => [1.5, 2.6])]);
  const t4 = text(tile(S.buildTournamentSection(m4), 'Backing'));
  assert.ok(t4.includes('+0.5u') && t4.includes('4 priced') && !/vs market/.test(t4.replace('vs market needs', '')), t4);
});

// Mutation 'N2: a set-less history row read as a walkover' (the pipeline history carries no walkovers — TEN-313 drops
// them — so a "0 - 0" row with no set is a match stopped in set 1: a retirement, played, settled at the close)
test('N2 + TEN-325: a set-less "0 - 0" history row is a first-set retirement — counted and settled at its close', () => {
  const m = fixture([ed(2024, [['2024-07-20', 'A. B', 'Final', true, W2, { p: [1.5, 2.6] }]])]);
  S.tr.data[0].ch[0].sets = []; S.tr.data[0].ch[0].result = '0 - 0'; m.p1TournamentHistory.years[0].matches[0].result = '0 - 0';
  const P = S.trModelFor(m, 0);
  assert.equal(P.priced.length, 1);
  assert.ok(P.all[0].ret && !P.all[0].wo);
  assert.equal(Math.round(P.units * 100), 50);
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
  S.market = { baseline: { roiFav: 0, roiDog: 0, favRel: 70 }, tournaments: { Washington: { n: 50, roiFav: 1, roiDog: 1, favRel: 70, archiveNames: ['Citi Open'] } } };
  P = S.trModelFor(m, 0);
  assert.ok(P.all[0].sets && P.all[0].sets.length === 2, 'the archive name joins');
  S.market = null;
});

// Mutations 'N4: the design\'s AS cut-offs back', 'TEN-321: Roland Garros speed printed from another key'
test('N4 + TEN-321: the header prints the pipeline\'s 3-band label; Roland Garros dashes its speed with the note', () => {
  // 1.17 is "Fast" on the design's retired AS cut-offs (< 1.15) and "Medium" on the pipeline index (66 <= 68)
  const m = fixture([], { m: { courtSpeed: { speed: 66, abstractSpeed: 1.17, altitude: 20, category: 'Medium' } } });
  assert.ok(text(S.trHeaderHtml(m)).includes('1.17 · Medium'), 'label from courtSpeed.category, never re-banded here');
  const rg = fixture([], { m: { tour: 'ATP French Open', courtSpeed: null, venue: { city: 'Paris', country: 'FR', category: 'Grand Slam' } } });
  const h = S.trHeaderHtml(rg);
  assert.match(h, /data-tr="speed-dash"[^>]*>—</);
  assert.ok(h.includes(S.TR_RG_NOTE));
  assert.ok(!h.includes(S.TR_NO_SPEED));
});

// Founder Q11 (2026-09-30): the reading paragraph is dropped — no node, no heading, no reserved space.
// Mutations 'the reading paragraph back (placeholder copy)', 'Q11: an empty block reserving its space'
test('Q11: the reading paragraph is dropped — no node, no heading, no reserved space; the header card ends at its meta grid', () => {
  const m = fixture([nMatches(2, () => true)]);
  const h = S.buildTournamentSection(m), head = S.trHeaderHtml(m);
  assert.ok(!/Read the records below|plays fast and low|true, medium-paced/.test(h));
  assert.ok(!/SURFACE_CONDITIONS/.test(html));
  assert.ok(!/<p[\s>]|tr-reading|About this event/i.test(h), 'no paragraph node or heading');
  assert.ok(h.includes(head + '<div style="display:flex; justify-content:center; margin-top:14px;"><span class="seg tr-more-toggle"'),
    'nothing between the header card and the toggle');
  assert.match(head, /class="tr-meta"[^]*<\/div>\s*<\/div>\s*<\/div>$/, 'the header card closes right after its meta grid');
});

// Founder Q9 (2026-09-30): the event hold rate — our box scores, every edition on file, n = service games — in a fifth
// header meta cell (DESIGN GAP G43), no gate, n always in the tooltip. Mutation 'Q9 (tab): the hold cell dropped'.
test('Q9: the header carries the event hold rate with its n; a dash with the reason when no box score is on file', () => {
  S.hold = { events: { 1532: { name: 'Washington', names: ['Washington'], held: 3252, games: 4034, matches: 178, years: ['2024', '2025', '2026'] } }, byName: { washington: '1532' } };
  const head = S.trHeaderHtml(fixture([nMatches(2, () => true)]));
  assert.match(head, /grid-template-columns:repeat\(5,1fr\)/);
  assert.match(text(head), /Court speed 1\.02 · Medium Altitude 20 m Hold rate 81% Service hold at Washington: 3,252 of 4,034 service games held \(n = 4,034\)/);
  assert.match(text(head), /178 matches with a box score over 3 editions on file \(2024–2026\)/);
  const none = S.trHeaderHtml(fixture([nMatches(2, () => true)], { m: { tour: 'ATP Nowhere' } }));
  assert.match(text(none), /Hold rate — No box score on file for Nowhere, so no hold rate is shown\./);
  S.hold = undefined;
});

// Mutations 'trend: a missing season interpolated', 'trend: header span claims 7 years'
test('seven-season trend: 2020–2026 on the axis, dots only where the sheet holds a value, the rest dashed', () => {
  const m = fixture([], { m: { courtSpeed: { speed: 66, abstractSpeed: 1.02, altitude: 20, as2023: 0.98, as2024: null, as2025: 1.02, category: 'Medium' } } });
  S.market = null;
  const h = S.trMarketHtml(m);
  const v = [...h.matchAll(/class="tr-sp-v"[^>]*>([^<]*)</g)].map(x => x[1]);
  assert.deepEqual(v, ['—', '—', '—', '0.98', '—', '1.02', '—']);
  assert.equal((h.match(/<polyline/g) || []).length, 0, 'a hole in 2024 breaks the line: no segment of 2+ adjacent seasons');
  assert.ok(text(h).includes('Trending faster +0.04 over 2 yrs'));
  assert.ok(text(h).includes('Abstract court speed · 2020–2026'));
});

// Mutations 'ROI: a card clickable with no archive names', 'ROI: a small-n yield in full colour'
test('ROI + reliability: tournament-market.json figures, dashed when absent, greyed at n 5–9, open only with archive names', () => {
  const m = fixture([]);
  S.market = null;
  let h = S.trMarketHtml(m);
  assert.ok(!/onclick="trSet\(\{roi/.test(h) && text(h).includes('ROI backing favourites — flat-stake yield'));
  S.market = { baseline: { roiFav: -1.8, roiDog: -6.9, favRel: 70 }, tournaments: { Washington: { n: 120, roiFav: 2.5, roiDog: -9, favRel: 74, archiveNames: ['Citi Open'] } } };
  h = S.trMarketHtml(m);
  assert.ok(text(h).includes('+2.5% flat-stake yield +4.3pp vs tour avg'));
  assert.ok(/data-tr="roi-fav" onclick="trSet\(\{roi:'fav'\}\)"/.test(h));
  assert.ok(text(h).includes('74% Reliable'));
  S.market = { baseline: { roiFav: -1.8, roiDog: -6.9, favRel: 70 }, tournaments: { Washington: { n: 7, roiFav: 2.5, roiDog: -9, favRel: 74 } } };
  h = S.trMarketHtml(m);
  assert.ok(text(h).includes('small sample') && !/data-tr="roi-fav" onclick/.test(h));
  assert.match(h, /color:var\(--text-label\);">\+2\.5%</, 'a 5–9 yield is greyed');
  S.market = null;
});

// Mutations 'DoD 8: a row stops opening the sheet', 'DoD 8: a tab-local row renderer again', 'more: the singular plural'
test('DoD 8: maMatchRowsHtml rows, every row registered in the one sheet map and opening it; the old renderers are gone', () => {
  const m = fixture([ed(2025, [['2025-07-22', 'A. B', 'Final', true, W2]]), ed(2024, [['2024-07-22', 'A. B', 'Final', true, W2]]), ed(2023, [['2023-07-22', 'A. B', 'Final', true, W2]]), ed(2022, [['2022-07-22', 'A. B', 'Final', true, W2]])]);
  const h = card0(S.buildTournamentSection(m));
  const rows = [...h.matchAll(/class="seg ma-row tr-row" data-fh-mid="([^"]+)" onclick="fhOpenSheet\('([^']+)'\)"/g)];
  assert.equal(rows.length, 3, 'three editions shown before "Show 1 earlier edition"');
  rows.forEach(r => { assert.equal(r[1], r[2]); assert.ok(S.fh.sheetMap[r[1]], 'registered in the one sheet map'); });
  assert.ok(text(h).includes('Show 1 earlier edition') && !text(h).includes('Show 1 earlier editions'));
  for (const f of ['atournMatchRowHtml', 'atournYearRowHtml', 'atournPlayerColumn', 'upgradeTournamentRows', 'toggleTournamentYear', 'showTournamentMore'])
    assert.ok(!html.includes('function ' + f + '('), f + ' deleted');
  assert.ok(!/\.atourn-/.test(html), 'the tab\'s own CSS is deleted');
});

// Founder Q8 (2026-09-30): the player-profile per-event Backing (column + "Backing him here" tile) is THIS tab's row-level
// join — the editions' main-draw matches joined to career-history and the closes shard, R8, retirements at the close —
// through the page's trProfileBacking, never the market-edge shard's own attribution. The profile module runs for real
// (player-profile-v2.js, TEN332_PP2) against the page's real join. Mutation 'Q8: the profile reads the market-edge shard'.
const PPW = { FEATURE_PP2: true, playerProfiles: { players: {} }, marketEdge: {}, careerHistory: {}, MarketEdgeCore: globalThis.MarketEdgeCore,
  get trProfileBacking(){ return globalThis.trProfileBacking; } };
new Function('window', pp2)(PPW);
test('Q8: the profile prints the tab\'s Backing — the same units and "vs market" from the same rows, never the market-edge shard', () => {
  const games = [['2024-07-21', 'A. B', 'Final', true, W2, { p: [1.5, 2.6] }], ['2024-07-20', 'C. D', 'Semi-finals', false, L2, { p: [2.0, 1.85] }],
    ['2024-07-19', 'E. F', 'Quarter-finals', true, W2, { p: [1.8, 2.05] }], ['2024-07-18', 'G. H', '1/8-finals', true, W2, { b: [1.4, 2.9] }],
    ['2024-07-17', 'I. J', '1/16-finals', true, W2, { p: [1.3, 3.5] }], ['2024-07-16', 'K. L', '1/32-finals', true, W2, { p: [2.5, 1.55] }]];
  const m = fixture([ed(2024, games)]);
  const d = S.tr.data[0];
  S.chShards['1'] = d.ch; S.fhCl['1'] = d.cl;
  const tb = tile(S.buildTournamentSection(m), 'Backing');
  const tabU = /class="tr-tile-v"[^>]*>([^<]+)</.exec(tb)[1], tabVm = />([+−]\d+\.\dpt vs market)</.exec(tb)[1];
  assert.equal(tabU, '+2.5u');
  // the profile's own store: draw order, a qualifying round and a walkover the tab's history never carries (N7, N2)
  const R = { 'Final': 'F', 'Semi-finals': 'SF', 'Quarter-finals': 'QF', '1/8-finals': 'R16', '1/16-finals': 'R32', '1/32-finals': 'R64' };
  const matches = games.slice().reverse().map(g => ({ res: g[3] ? 'W' : 'L', round: R[g[2]], opp: g[1], oppKey: null, score: g[3] ? '2 - 0' : '0 - 2' }));
  const prof = { key: '1', name: 'J. Sinner', tournamentHistory: [{ name: 'Washington', won: 5, lost: 1, titles: 1, bestResult: 'Winner', bestYears: [2024],
    editions: [{ year: 2024, finish: 'Winner', matches: [{ res: 'W', round: 'Q1', opp: 'Q. Qual', oppKey: null, score: '2 - 0' },
      { res: 'W', round: 'R128', opp: 'W. Over', oppKey: null, score: '0 - 0', walkover: true }].concat(matches) }] }] };
  PPW.playerProfiles.players['1'] = prof;
  // the market-edge shard attributes other P&L to the same matches (+5u each) — the retired source must not reach the tile
  PPW.marketEdge['1'] = { matches: games.map(g => ({ date: g[0], opp: g[1], event: 'Washington', inBasis: true, pl: 5, book: 'pinnacle', surface: 'hard' })) };
  const I = PPW.PlayerProfileV2._internals;
  const v = I.tournViews(prof).find(x => x.name === 'Washington');
  assert.equal(v.pinN, 6, 'the six priced main-draw rows — the qualifier and the walkover are not rows');
  assert.equal(v.pinTxt, tabU); assert.equal(v.vmTxt, tabVm);
  const det = text(I.renderTournDetail(prof, v));
  assert.ok(det.includes('Backing him here ' + tabU + ' ' + tabVm), det.slice(det.indexOf('Backing him here'), det.indexOf('Backing him here') + 60));
  assert.ok(text(I.renderTournModal(prof)).includes(tabU), 'the Record per tournament column prints the same units');
  // before the closes answer: a dash and "loading prices" — never the market shard's +30.0u
  delete S.fhCl['1'];
  const w = I.tournViews(prof).find(x => x.name === 'Washington');
  assert.equal(w.pinPl, null); assert.ok(w.backingPending);
  assert.ok(text(I.renderTournDetail(prof, w)).includes('Backing him here — loading prices'));
  // a failed load: the tab's words, "prices unavailable" — never "loading" forever
  S.profileFail.add('1');
  assert.ok(text(I.renderTournDetail(prof, I.tournViews(prof).find(x => x.name === 'Washington'))).includes('Backing him here — prices unavailable'));
  S.profileFail.delete('1');
  delete S.chShards['1'];
});

// Q8, the edges a join without event keys meets (review of TEN-368): the profile's edition rows carry no event key and no
// date, so each is resolved to its career-history row first. Mutations 'Q8: two meetings in one edition left unresolved',
// 'Q8: the voted event-name aliases dropped'.
test('Q8: two meetings with one opponent in an edition resolve by round; a profile event name the store spells differently joins by vote', () => {
  const games = [['2024-11-17', 'A. B', 'Final', true, W2, { p: [2.5, 1.55] }], ['2024-11-15', 'C. D', 'Semi-finals', true, W2, { p: [1.5, 2.6] }],
    ['2024-11-12', 'A. B', 'Quarter-finals', true, W2, { p: [1.8, 2.05] }], ['2024-11-10', 'E. F', '1/8-finals', false, L2, { p: [1.3, 3.5] }],
    ['2024-11-09', 'G. H', '1/16-finals', true, W2, { b: [1.4, 2.9] }]];
  const m = fixture([ed(2024, games)]);
  const d = S.tr.data[0];
  S.chShards['1'] = d.ch; S.fhCl['1'] = d.cl;
  const tb = tile(S.buildTournamentSection(m), 'Backing');
  const tabU = /class="tr-tile-v"[^>]*>([^<]+)</.exec(tb)[1], tabVm = />([+−]\d+\.\dpt vs market)</.exec(tb)[1];
  assert.equal(tabU, '+2.2u', 'A. B twice (QF and F): both priced by the tab, by event key (1.5 + 0.5 + 0.8 − 1 + 0.4)');
  const R = { 'Final': 'F', 'Semi-finals': 'SF', 'Quarter-finals': 'QF', '1/8-finals': 'R16', '1/16-finals': 'R32' };
  const row = g => ({ res: g[3] ? 'W' : 'L', round: R[g[2]], opp: g[1], oppKey: null, score: g[3] ? '2 - 0' : '0 - 2' });
  // the profile's store names the event "Citi DC Open"; career-history says "Washington" — the unambiguous rows vote the alias
  const prof = { key: '1', name: 'J. Sinner', tournamentHistory: [{ name: 'Citi DC Open', won: 4, lost: 1, editions: [{ year: 2024, matches: games.slice().reverse().map(row) }] }] };
  PPW.playerProfiles.players['1'] = prof; S.profiles['1'] = prof; PPW.marketEdge['1'] = { matches: [] };
  const v = PPW.PlayerProfileV2._internals.tournViews(prof)[0];
  assert.equal(v.pinN, 5, 'every row resolved: the two A. B meetings by round, the renamed event by the voted alias');
  assert.equal(v.pinTxt, tabU); assert.equal(v.vmTxt, tabVm);
  delete S.chShards['1']; delete S.fhCl['1']; delete S.profiles['1'];
});

// TEN-380 (step 3 reference): the two bugs and the foundation styling.
// Bug 1: a −3.7% yield that beats a −6.9% tour average was drawn green (its colour followed the gap, not the value).
// Bug 2: the Backing tile's hidden 280px pop, centred on the row's last tile, ran past the column → a horizontal scrollbar.
test('TEN-380: ROI values --text (never green on a negative yield); Backing pop opens leftwards; panels, chip, toggle, bar', () => {
  const m = fixture([nMatches(6, i => i % 2 === 0, null)]);
  S.market = { baseline: { roiFav: -1.8, roiDog: -6.9, favRel: 70 }, tournaments: { Washington: { n: 120, roiFav: 2.5, roiDog: -3.7, favRel: 74, archiveNames: ['Citi Open'] } } };
  const h = S.trMarketHtml(m);
  const val = side => new RegExp(`data-tr="roi-${side}"[^]*?font-size:26px;[^"]*color:([^;"]+);">([^<]*)<`).exec(h);
  assert.equal(val('dog')[2], '−3.7%'); assert.equal(val('dog')[1], 'var(--text)', 'a negative yield is not green');
  assert.equal(val('fav')[1], 'var(--text)');
  assert.ok(!/var\(--pos\)|var\(--neg\)/.test(h), 'no signed colour on the panel');
  assert.ok(text(h).includes('+3.2pp vs tour avg'), 'Q14: the sub-line keeps "±x.xpp vs tour avg"');
  assert.match(h, /background:var\(--track\); overflow:hidden; margin-top:11px;"><span style="display:block; height:100%; width:74%; background:var\(--bar\);/, 'reliability bar --bar on --track');
  assert.ok(!/var\(--page\)|var\(--text-soft\)/.test(h), 'panels on --card, greys --text-label');
  assert.equal((h.match(/border:1px solid var\(--edge-6\)/g) || []).length, 4, 'speed card, two ROI cards, reliability: --edge-6');
  // founder Q2 (TEN-380, README §11): the court-speed bar is flat --white-bar with a white knob — no gradient, no blue
  assert.match(h, /class="tr-speed-bar" style="position:relative; height:8px; border-radius:5px; background:var\(--white-bar\);/);
  assert.match(h, /class="tr-speed-knob" style="[^"]*background:var\(--text\); border:3px solid var\(--card\); box-shadow:0 0 0 1px var\(--edge-16\);/);
  assert.ok(!/linear-gradient|var\(--bar\) 50%/.test(h), 'no gradient, no blue ring');
  // the trend: line only, dotted horizontal guides, no area fill or gradient, no vertical tick
  assert.equal((h.match(/class="tr-sp-guide" x1="0" x2="360" y1="(\d+)" y2="\1" stroke="var\(--viz-guide\)" stroke-width="1" stroke-dasharray="2 6"/g) || []).length, 3);
  assert.ok(!/<path|<linearGradient|<rect|fill="url/.test(h), 'no area fill');
  assert.ok(!/<line[^>]*x1="([\d.]+)"[^>]*x2="\1"/.test(h), 'no vertical tick');
  const head = S.trHeaderHtml(m);
  assert.match(head, /class="tr-head" style="border:1px solid var\(--edge-6\); border-radius:16px; background:var\(--card\);/, 'header card = panel');
  assert.match(head, /class="tr-surf" style="[^"]*background:var\(--selected\); border:1px solid var\(--line\); border-radius:8px;[^"]*">Hard court</, 'surface chip');
  assert.match(head, /class="tr-meta tr-meta-cur" style="background:var\(--inner\);/, 'the current meta cell (Round) on --inner');
  assert.equal((head.match(/class="tr-meta" style="background:var\(--card\); padding:15px 16px; box-shadow:inset 0 0 0 1px var\(--edge-6\);/g) || []).length, 4);
  assert.equal((head.match(/<div style="font-family:'IBM Plex Mono',monospace; font-size:16px; font-weight:700; white-space:nowrap;">/g) || []).length, 5, 'meta values in Plex');
  const all = S.buildTournamentSection(m);
  assert.match(all, /class="seg tr-more-toggle"[^>]*style="display:inline-flex; align-items:center; gap:8px; padding:6px 4px; font-size:12\.5px; font-weight:600; color:var\(--text\); cursor:pointer;">/, 'the toggle is plain text, white words, no box');
  assert.match(all, /class="tr-card" style="background:var\(--card\); border:1px solid var\(--edge-6\);/);
  assert.ok(!/class="tr-tile"[^>]*var\(--line\)/.test(all), 'tiles --edge-6');
  assert.match(all, /class="elotip-pop" role="tooltip" style="bottom:calc\(100% \+ 8px\); left:auto; right:0; transform:none; white-space:normal; width:280px;"/, 'the Backing pop is right-anchored');
  assert.match(all, /font-size:11px; color:var\(--text-label\);">\d+ match/, 'count meta --text-label');
  S.market = null;
});
