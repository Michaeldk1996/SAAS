// TEN-402 round 2, builder N (founder card 7bc622d5, 2026-10-09: "Yes — rename the Tournaments page too (follow-up
// commit)"). The Tournaments page prints the ONE event name sfEventName prints on Head to Head, Match analysis and every
// sheet; the registry key (the city) stays the data key. Every check EXECUTES the shipped code sliced out of
// bsp-consult-dashboard.html (TEN402_HTML overrides it for tools/test-ten402-r2n-mutants.js); TournamentIdentity is the
// real tournament-identity.js. Each rule carries a control so a pass cannot be vacuous.
//
// The rule, as a test someone can apply: pick any event on the Tournaments page (rail row, hero title, Compare all row,
// What players say / ROI overlay title, Reports picker chip + monogram, match-stats sheet header, an ATP-tour Entry list
// row, the H2H suggestion chip). The words printed are sfEventName(key) — plus " · {city}" only when two registry events
// share that name (Montreal / Toronto). Search finds it by that name AND by the city. Every number is unchanged.
//
// Run: node --test test-ten402-r2n.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN402_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const TI = createRequire(import.meta.url)(join(HERE, 'tournament-identity.js'));

function sliceFrom(start, label) {
  assert.ok(start >= 0, `${label} not found`);
  let depth = 0, i = html.indexOf('{', start);
  const open = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  assert.ok(i > open, `${label} braces did not balance`);
  return html.slice(start, i + 1);
}
const fnSrc = name => sliceFrom(html.indexOf(`\nfunction ${name}(`) + 1, name);
const innerFn = name => sliceFrom(html.indexOf(`\n  function ${name}(`) + 1, name);   // a function inside window.EntryListsTab
const objSrc = name => sliceFrom(html.indexOf(`\nconst ${name} = {`) + 1, name) + ';';
const arrSrc = name => { const a = html.indexOf(`\nconst ${name} = [`) + 1; assert.ok(a > 0, name); return html.slice(a, html.indexOf('\n];', a) + 3); };
const lineSrc = start => { const a = html.indexOf('\n' + start) + 1; assert.ok(a > 0, start); return html.slice(a, html.indexOf('\n', a)); };
// The block of the r2 helpers: the suffix constant through tourxEventSearchText.
const helperSrc = () => {
  const a = html.indexOf('\nconst TOURX_EVENT_CITY_SUFFIX') + 1;
  assert.ok(a > 0, 'TOURX_EVENT_CITY_SUFFIX not found');
  const b = sliceFrom(html.indexOf('\nfunction tourxEventSearchText(') + 1, 'tourxEventSearchText');
  return html.slice(a, html.indexOf(b) + b.length);
};

// The registry, the one-name table and the page helpers, as shipped.
const BASE = [arrSrc('TOURNAMENT_CATALOG'), objSrc('COURT_CONDITIONS'), fnSrc('courtSpeedCategory'), fnSrc('tourxConditionRegistry'),
  objSrc('SF_EVENT_NAMES'), objSrc('SF_EVENT_ALIAS'), objSrc('SF_EVENT_LITERAL'), 'let _sfEventIx = null;', fnSrc('ppCleanTournamentName'), fnSrc('fhTournClean'),
  fnSrc('sfEventKey'), fnSrc('sfEventName'), helperSrc()].join('\n');
const make = (extra, ret, env) => new Function('window', ...Object.keys(env || {}), BASE + '\n' + (extra || '') + '\nreturn ' + ret + ';')({ TournamentIdentity: TI }, ...Object.values(env || {}));
const P = make('', '{ tourxEventName, tourxEventSearchText, sfEventName, sfEventKey, reg: tourxConditionRegistry(), SF_EVENT_NAMES }');

// ── 1 · the printed name ─────────────────────────────────────────────────────────────────────────────────────────────
test('r2.1 every registry event prints sfEventName\'s name — the founder\'s list, an ATP 250 keeps its key', () => {
  const want = { Turin: 'ATP Finals', Cincinnati: 'Cincinnati Open', Beijing: 'China Open', 'Monte Carlo': 'Monte-Carlo Masters', Shanghai: 'Shanghai Masters',
    Tokyo: 'Japan Open', Vienna: 'Vienna Open', Basel: 'Swiss Indoors', Rome: 'Italian Open', London: "Queen's Club Championships", Hamburg: 'Hamburg Open',
    'Roland Garros': 'Roland Garros', Wimbledon: 'Wimbledon', Antwerp: 'Antwerp', Chengdu: 'Chengdu', Doha: 'Doha',
    Montreal: 'Canadian Open · Montreal', Toronto: 'Canadian Open · Toronto' };
  for (const [k, v] of Object.entries(want)) assert.equal(P.tourxEventName(k), v, k);
  // the ONE name site-wide: on every registry event the page's name starts with exactly what sfEventName prints elsewhere
  for (const t of P.reg) {
    const one = P.sfEventName(t.name), shown = P.tourxEventName(t.name);
    assert.ok(shown === one || shown === one + ' · ' + t.name, `${t.name}: page "${shown}" vs site "${one}"`);
    if (t.category === 'ATP 250') assert.equal(shown, t.name, `${t.name} (ATP 250) keeps the registry name`);
  }
  // control: the renamed set is real — 24 of the 64 rated events print a name that is not their key
  assert.equal(P.reg.length, 64);
  assert.equal(P.reg.filter(t => P.tourxEventName(t.name) !== t.name).length, 24);
});

test('r2.1 Montreal / Toronto: one official name, two rows — the city tells them apart; no two registry rows print alike', () => {
  const shown = P.reg.map(t => P.tourxEventName(t.name));
  assert.equal(new Set(shown).size, shown.length, 'two rail / Compare all rows print the same words');
  // control: with the suffix off ('' — the flip) the two Canadian rows collide
  const off = new Function('window', BASE.replace("const TOURX_EVENT_CITY_SUFFIX = ' · ';", "const TOURX_EVENT_CITY_SUFFIX = '';")
    + '\nreturn tourxConditionRegistry().map(t => tourxEventName(t.name));')({ TournamentIdentity: TI });
  assert.equal(off.filter(x => x === 'Canadian Open').length, 2, 'control: without the suffix Montreal and Toronto print the same row');
  // Roland Garros / French Open: two catalog entries, ONE event. Only Roland Garros is rated (in the registry); both print
  // "Roland Garros", so the page shows it once.
  assert.equal(P.sfEventName('French Open'), 'Roland Garros');
  assert.deepEqual(P.reg.filter(t => /Roland|French/.test(t.name)).map(t => t.name), ['Roland Garros']);
});

// ── 2 · the rail: rows, search, keys ─────────────────────────────────────────────────────────────────────────────────
const railFor = (q, week) => make([lineSrc('const TOURX_TIER_CODE'), fnSrc('tourxTierCode'), lineSrc('const TOURX_TIER_CHIP_MONO_ALL'),
  fnSrc('tourxEsc'), fnSrc('tourxOverviewListHtml')].join('\n'), 'tourxOverviewListHtml()',
  { tourxState: { tsQ: q, tsSel: 'Turin' }, tourxActiveWeekNames: () => new Set(week || ['Shanghai']) });
const rows = h => [...h.matchAll(/class="tourx-ovrow[^"]*" onclick="tourxSelectCondition\('((?:[^'\\]|\\.)*)'\)"[\s\S]*?text-overflow:ellipsis;[^"]*">([^<]*)<\/span>/g)]
  .map(m => ({ key: m[1].replace(/\\'/g, "'"), name: m[2] }));

test('r2.2 the rail prints the one name on every row and keeps the KEY in its click (state = data key)', () => {
  const r = rows(railFor(''));
  assert.equal(r.length, 64);
  for (const x of r) assert.equal(x.name, P.tourxEventName(x.key), x.key);
  assert.ok(r.some(x => x.key === 'Turin' && x.name === 'ATP Finals'));
  assert.ok(r.some(x => x.key === 'Shanghai' && x.name === 'Shanghai Masters'), 'the This-week row too');
  // the two Canadian rows can never ellipsise into the same words: the name takes up to two lines, it is not cut at one
  assert.match(railFor(''), /-webkit-line-clamp:2;line-height:1\.3;">Canadian Open · Montreal<\/span>/);
  // control: no row prints the bare city of a renamed event
  for (const city of ['Turin', 'Cincinnati', 'Beijing', 'Tokyo', 'Monte Carlo', 'Vienna', 'Basel']) assert.ok(!r.some(x => x.name === city), city);
});

test('r2.2 search: "Cincinnati Open" and "Cincinnati" both find it; the city, the official name and another spelling all work', () => {
  const find = q => rows(railFor(q)).map(x => x.name);
  assert.deepEqual(find('Cincinnati Open'), ['Cincinnati Open']);
  assert.deepEqual(find('cincinnati'), ['Cincinnati Open']);
  assert.deepEqual(find('Turin'), ['ATP Finals']);
  assert.deepEqual(find('ATP Finals'), ['ATP Finals']);
  assert.deepEqual(find('china open'), ['China Open']);
  assert.deepEqual(find('Beijing'), ['China Open']);
  assert.deepEqual(find('Monte-Carlo'), ['Monte-Carlo Masters']);
  assert.deepEqual(find('Monte Carlo'), ['Monte-Carlo Masters']);
  assert.deepEqual(find('French'), ['Roland Garros'], 'the other catalog spelling of the same event');
  assert.deepEqual(find('Canadian').sort(), ['Canadian Open · Montreal', 'Canadian Open · Toronto']);
  assert.deepEqual(find('Toronto'), ['Canadian Open · Toronto']);
  assert.deepEqual(find('Antwerp'), ['Antwerp']);
  // control: a word in no name finds nothing
  assert.match(railFor('Zzyzx'), /No tournament matches/);
});

// ── 3 · hero, Compare all, overlays ──────────────────────────────────────────────────────────────────────────────────
test('r2.3 the hero title, the Compare all rows and the ROI / What players say overlay titles print the one name', () => {
  const stub = name => ({ name, category: 'ATP Finals', surface: 'hard', abstractSpeed: 1.36, altitude: 240, speedCat: 'Fast' });
  const hero = make(fnSrc('tourxConditionsPanelHtml'), 'tourxConditionsPanelHtml()', {
    tourxState: { tsSel: 'Turin' }, tourxResolveCondition: stub, tourxKnobPct: () => 50, tourxRankLineHtml: () => '', tourxCap: s => s,
    tourxConditionsProse: () => '', tourxBounce: () => '', tourxQuotesCardHtml: () => '', tourxSpeedSeriesHtml: () => '', tourxRoiPairHtml: () => '',
    tourxReliabilityHtml: () => '', tourxReportCtaHtml: () => '' });
  assert.match(hero, /letter-spacing:-0\.015em;color:var\(--text\);">ATP Finals<\/span>/);
  assert.doesNotMatch(hero, />Turin</, 'control: the key is not printed');
  const shell = fnSrc('tourxOverlayShell');
  const roi = make(shell + '\n' + fnSrc('tourxRoiPanelHtml'), 'tourxRoiPanelHtml()', { tourxState: { tsSel: 'Montreal' }, tourxResolveCondition: stub });
  assert.match(roi, /aria-label="Canadian Open · Montreal · favourites and underdogs"/);
  const qp = make(shell + '\n' + fnSrc('tourxQuotesPanelHtml'), 'tourxQuotesPanelHtml()', { tourxState: { tsSel: 'Hamburg' }, tourxResolveCondition: stub,
    tourxQuotesFor: () => [{ player: 'A. Zverev', year: 2025, text: 'x' }], tourxQuoteAttrib: () => '2025', tourxQuoteText: () => '“x”', tourxEscHtml: s => String(s) });
  assert.match(qp, /aria-label="Hamburg Open · what players say"/);
  const cmp = make([fnSrc('tourxMedian'), fnSrc('tourxEsc'), shell, fnSrc('tourxSpeedPanelHtml')].join('\n'), 'tourxSpeedPanelHtml()', { tourxState: { tsSel: 'Tokyo' } });
  const names = [...cmp.matchAll(/onclick="tourxSelectCondition\('((?:[^'\\]|\\.)*)'\)"[\s\S]*?text-overflow:ellipsis;[^"]*">([^<]*)<\/span>/g)].map(m => [m[1].replace(/\\'/g, "'"), m[2]]);
  assert.equal(names.length, 64);
  for (const [k, n] of names) assert.equal(n, P.tourxEventName(k), k);
  assert.ok(names.some(([k, n]) => k === 'Tokyo' && n === 'Japan Open'));
});

test('r2.3 the ROI overlay joins on the archive names, never on the printed name (Hamburg 565 / Antwerp 260 unchanged)', () => {
  const ro = fnSrc('tourxRenderOverlays');
  assert.match(ro, /const mkt = c && tourxMarketFor\(c\.name\);/, 'the market row is read by the registry KEY');
  assert.match(ro, /initialTournamentNames: names,/);
  assert.match(ro, /initialTournamentFilter: mkt\.archiveFilter \|\| null,/);
  assert.match(ro, /initialTournamentLabel: typeof tourxEventName === 'function' \? tourxEventName\(c\.name\) : c\.name,/, 'only the chip label is the printed name');
  for (const f of ['tourxRoiPairHtml', 'tourxReliabilityHtml']) assert.match(fnSrc(f), /const mkt = tourxMarketFor\(c\.name\);/, f);
  assert.match(fnSrc('tourxQuotesCardHtml'), /const list = tourxQuotesFor\(c\.name\);/);
});

// ── 4 · Reports ──────────────────────────────────────────────────────────────────────────────────────────────────────
test('r2.4 Reports: the tournament picker prints the one name + its monogram; the click and state keep the key', () => {
  const el = { innerHTML: '' };
  const env = { document: { getElementById: id => (id === 'tourxReports' ? el : null) }, tournamentProgression: { fetchedAt: '2026-10-09T02:00:00Z', tournaments: { Shanghai: {}, Tokyo: {}, Beijing: {} } },
    tourxState: { tour: 'Tokyo', view: 'round' }, tourxBuildTournament: n => ({ name: n }), TOURX_ROUND_LABELS: [], tourxActiveLabels: null,
    tourxPlayerViewHtml: () => '', tourxH2HViewHtml: () => '', tourxRoundViewHtml: () => '', tourxCloseMatchSheet: () => {} };
  make([fnSrc('tournamentInitials'), fnSrc('tourxRpEsc'), fnSrc('tourxEsc'), fnSrc('tourxReportYear'), fnSrc('tourxCapsLbl'), fnSrc('tourxSegItem'), fnSrc('renderTourxReports')].join('\n'), 'renderTourxReports()', env);
  const chips = [...el.innerHTML.matchAll(/<span class="tx-seg( on)?" onclick="tourxSelectTour\('([^']+)'\)"[^>]*><span[^>]*>([^<]+)<\/span>([^<]+)<span/g)].map(m => [m[2], m[3], m[4], !!m[1]]);
  assert.deepEqual(chips, [['Shanghai', 'SM', 'Shanghai Masters', false], ['Tokyo', 'JO', 'Japan Open', true], ['Beijing', 'CO', 'China Open', false]]);
  assert.equal(env.tourxState.tour, 'Tokyo', 'the state still holds the key');
});

test('r2.4 Reports: the match-stats sheet header and the empty-state lines print the one name', () => {
  const box = { TOURX_METRICS: [{ key: 'firstServePct', label: '1st serve %', kind: 'pct' }], tourxActiveLabels: ['R32', 'R16', 'QF', 'SF', 'F'],
    tournamentProgression: { fetchedAt: '2026-10-05T10:00:00Z' }, tourxTournamentCategory: () => 'ATP 500' };
  const sheet = make(['tourxFmt', 'tourxMsFmt', 'tourxSurname', 'tourxRpEsc', 'tourxReportYear', 'tourxRoundOutcome', 'tourxPlayerScore', 'tourxSetsToWin', 'tourxMatchSheetHtml'].map(fnSrc).join('\n'),
    'tourxMatchSheetHtml', box);
  const mk = (name, opp) => ({ name, opponents: [null, null, opp], results: [null, null, '2 - 0'], eliminated: false, eliminatedKnown: true, maxWonIdx: 2, drawDepth: 3,
    data: { firstServePct: [null, null, 70] } });
  const T = { name: 'Tokyo', rounds: ['R1', 'R2', 'QF'], roundLabels: ['R32', 'R16', 'QF', 'SF', 'F'], players: [mk('C. Alcaraz', 'J. Lehecka'), mk('J. Lehecka', 'C. Alcaraz')] };
  const h = sheet(T, 'C. Alcaraz', 2);
  assert.match(h, /Japan Open 2026 · QF · hard · Alcaraz won/);
  assert.doesNotMatch(h, /Tokyo 2026/, 'control: the key is not printed');
  // the "no box scores yet" / "not played yet" / progression empty lines name the event the same way
  const printed = (html.match(/\$\{typeof tourxEventName === 'function' \? tourxEventName\(T\.name\) : T\.name\}/g) || []).length;
  assert.equal(printed, 5, 'round view (3) + player progression (2) print the event through tourxEventName');
  assert.doesNotMatch(fnSrc('tourxRoundViewHtml') + fnSrc('tourxPlayerViewHtml'), /\$\{T\.name\}/, 'a raw ${T.name} is printed');
});

// ── 5 · Entry list ───────────────────────────────────────────────────────────────────────────────────────────────────
test('r2.5 Entry list: an ATP-tour row prints the one name; a Challenger / ITF row or an off-registry name keeps its own', () => {
  const render = make(['levelGroup', 'tierCode', 'countCell', 'hasList', 'renderTournament'].map(innerFn).join('\n'), 'renderTournament', { shortDate: () => '26 Oct' });
  const nameOf = t => (render(t, 0).match(/letter-spacing:-0\.005em;color:var\(--text\);[^"]*">([^<]*)<\/span>/) || [])[1];
  const row = (name, city, tier) => ({ name, city, tier, weekStart: '2026-10-26', sections: [] });
  assert.equal(nameOf(row('Basel', 'Basel', 'ATP 500')), 'Swiss Indoors');
  assert.equal(nameOf(row('Vienna', 'Vienna', 'ATP 500')), 'Vienna Open');
  assert.equal(nameOf(row('Paris', 'Paris', 'ATP 1000')), 'Paris Masters');
  assert.equal(nameOf(row('China Open', 'Beijing', 'ATP 500')), 'China Open');
  assert.equal(nameOf(row('AITO Hangzhou Open', 'Hangzhou', 'ATP 250')), 'Hangzhou', 'an ATP 250 prints the registry name');
  assert.equal(nameOf(row('Brussels', 'Brussels', 'ATP 250')), 'Brussels', 'not in the registry: the shard\'s own words');
  // control: a Challenger in a registry city is NOT the tour event
  assert.equal(nameOf(row('Rome (CH 75)', 'Rome', 'Challenger')), 'Rome (CH 75)');
  assert.equal(nameOf(row('M25 Vienna', 'Vienna', 'ITF')), 'M25 Vienna');
});

// ── 6 · H2H suggestion chips ─────────────────────────────────────────────────────────────────────────────────────────
test('r2.6 the H2H suggestion chip prints the event\'s one name ("Shanghai" → Shanghai Masters); the pair keeps the board word', () => {
  assert.match(html, /event: pr\[2\] \? \(typeof sfEventName === 'function' \? sfEventName\(pr\[2\]\) : pr\[2\]\) : '',/);
  assert.equal(P.sfEventName('Shanghai'), 'Shanghai Masters');
  assert.equal(P.sfEventName('Beijing'), 'China Open');
  // suggestionPairs still returns the board's word (test-ten402-a.mjs pins ['3', '9', 'Shanghai'])
  assert.match(html, /ev: String\(m\.tour \|\| ''\)\.replace\(\/\^ATP\\s\+\/i, ''\) \}\);/);
});

// ══ round 3 (TEN-402 follow-up review, founder 2026-10-09 fix 2: "One tournament name per event, site-wide") ══════════
// The rule, as a test someone can apply: on ANY surface that prints an event — Match analysis (modal subtitle, Tournament
// tab title / "Record at …" / edition headers / hold tip / ROI chip, Key factors' Tournament card), the Matches board (card
// head, story strip, tournament chips), Player Profile → Record per tournament (row, detail, "best event") and the Entry
// list — the words are sfEventName(the data name); the tier is never part of the name; the data name (m.tour, t.name, the
// chip's data-tournament, the hold-rate / catalog keys) is unchanged. Every number is unchanged.
const PP2 = process.env.TEN402_PP2 || join(HERE, 'player-profile-v2.js');
const req = createRequire(import.meta.url);
const tag = (h, re) => (h.match(re) || [])[1];

test('r3.1 Match analysis → Tournament tab: the title, "Record at …", the edition headers and the hold tip print the one name; the location line and the data name stay', () => {
  const env = { fhSurfName: s => s, trRoundWords: () => 'Round of 64', maTipHtml: h => h, fhEsc: s => String(s), trSpeedNote: () => '', trHoldHtml: () => '80%', TR_MONO: '' };
  const T = make([fnSrc('trClean'), fnSrc('trName'), fnSrc('trHeaderHtml')].join('\n'), '{ trClean, trName, trHeaderHtml }', env);
  const m = { tour: 'ATP Shanghai', surface: 'Hard', venue: { city: 'Shanghai', country: 'CN', category: 'ATP 1000' } };
  assert.equal(T.trName(m), 'Shanghai Masters');
  assert.equal(T.trClean(m), 'Shanghai', 'the data name is unchanged');
  assert.equal(T.trName({ tour: 'ATP Chengdu' }), 'Chengdu', 'an ATP 250 keeps its city');
  assert.equal(T.trName({ tour: 'ATP Canadian Open' }), 'Canadian Open');
  assert.equal(T.trName({}), 'Tournament');
  const head = T.trHeaderHtml(m);
  assert.equal(tag(head, /font-size:26px; font-weight:800; letter-spacing:-0\.01em;">([^<]*)</), 'Shanghai Masters');
  assert.equal(tag(head, /font-size:13px; color:var\(--text-label\); margin-top:3px;">([^<]*)</), 'Shanghai, CN', 'the location line stays a location');
  // "Record at …": the section head, executed with its cards stubbed
  const sec = make([fnSrc('trClean'), fnSrc('trName'), fnSrc('buildTournamentSection')].join('\n'), 'buildTournamentSection', Object.assign({}, env, {
    trStateFor: () => ({ S: { more: false, recMore: [false, false] } }), trModelFor: () => ({}), trHeaderHtml: () => '', trMarketHtml: () => '',
    trPlayerCardHtml: () => '', trSrcLine: () => '' }))(m);
  assert.match(sec, />Record at Shanghai Masters</);
  assert.doesNotMatch(sec, />Record at Shanghai</, 'control: the city is not printed');
  // the edition headers + the empty line: trPlayerCardHtml executed, the shared row renderer stubbed to capture its groups
  let groups = null;
  const card = make([fnSrc('trClean'), fnSrc('trName'), fnSrc('trPlayerCardHtml')].join('\n'), 'trPlayerCardHtml', Object.assign({}, env, {
    _tr: { S: { recMore: [false, false] } }, fhStateFor: () => ({ sheetMap: {} }), TR_LIM: 3, trRowData: r => r, trTilesHtml: () => '',
    maMatchRowsHtml: g => { groups = g; return 'rows'; }, fhNameLink: () => '' }));
  card(m, { eds: [{ year: 2025, result: 'QF', won: 3, lost: 1, rows: [] }, { year: 2024, result: 'R32', won: 1, lost: 1, rows: [] }], all: [], name: 'A. Rublev', summary: '' }, 0);
  assert.deepEqual(groups.map(g => g.title), ['Shanghai Masters 2025', 'Shanghai Masters 2024']);
  const empty = card(m, { eds: [], all: [], hasHist: false, name: 'X', summary: '' }, 1);
  assert.match(empty, /No main-draw record at Shanghai Masters on file\./);
  // the hold rate: READ by the data name (event-hold.json byName "shanghai"), PRINTED by the one name
  const H = make([fnSrc('trClean'), fnSrc('trName'), 'let _trHoldData = { byName: { shanghai: 0 }, events: [{ games: 200, held: 160, matches: 9, years: [2024, 2025] }] }, _trHoldP = null;',
    fnSrc('trHoldOf'), fnSrc('trHoldTip')].join('\n'), '{ trHoldOf, trHoldTip }', {});
  const h = H.trHoldOf(m);
  assert.equal(h.state, 'ok', 'the hold-rate lookup still finds the event by its data name');
  assert.match(H.trHoldTip(m, h), /^Service hold at Shanghai Masters: 160 of 200/);
  assert.match(H.trHoldTip(m, { state: 'none' }), /No box score on file for Shanghai Masters/);
});

test('r3.1 Match analysis: the modal subtitle prints the one name; Key factors\' Tournament card and the ROI chip print it, their joins read the data name', () => {
  const ctx = make([fnSrc('aContextLine')].join('\n'), 'aContextLine', { apiStartMs: () => 1, cardFmtStart: () => '12:00' });
  assert.equal(ctx({ tour: 'ATP Shanghai' }, 'R64'), 'Shanghai Masters · R64 · 12:00');
  assert.equal(ctx({ tour: 'ATP Chengdu' }, 'Quarter-finals'), 'Chengdu · Quarter-finals · 12:00', 'an ATP 250 keeps its city');
  assert.equal(ctx({ tour: 'ATP Laver Cup' }, 'RR'), 'Laver Cup · RR · 12:00', 'off the registry: the cleaned name');
  const kf = fnSrc('kfTourCard');
  assert.match(kf, /\$\{fhEsc\(tier \? `\$\{trName\(m\)\} · \$\{tier\}` : trName\(m\)\)\}/, 'the card title prints trName');
  assert.match(kf, /const catHit = TOURNAMENT_CATALOG\.find\(t => t\.name\.toLowerCase\(\) === clean\.toLowerCase\(\)\);/, 'the catalog match reads the data name');
  assert.match(kf, /const names = \[clean\]\.concat\(trArchiveNames\(mk\)\)/, 'the career join reads the data name');
  assert.match(fnSrc('trModelFor'), /const clean = trClean\(m\), mk = trMarketFor\(trKeyOf\(m\)\);/, 'the Tournament tab model joins on the data name');
  assert.match(fnSrc('trRenderRoi'), /initialTournamentNames: mkt\.archiveNames, initialTournamentFilter: mkt\.archiveFilter \|\| null, initialTournamentLabel: typeof tourxEventName === 'function' \? tourxEventName\(key\) : key,/);
  // Progression: the header, the first-round lines and the draw-average tip print the one name; the draw lookup reads the data name
  const ON = s => `typeof sfEventName === 'function' ? sfEventName(${s}) : ${s}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(html, new RegExp('color:var\\(--text-label\\);">\\$\\{fhEsc\\(' + ON('P.tourn') + '\\)\\}</span>'));
  assert.equal((html.match(new RegExp("at ' \\+ \\(" + ON('tourn') + "\\) \\+ '", 'g')) || []).length, 2, 'the two first-round lines');
  assert.match(html, new RegExp("' at ' \\+ \\(" + ON('P.tourn') + '\\) \\+ \\(F\\.small'));
  assert.match(html, /const t = \(tournamentProgression && tournamentProgression\.tournaments \|\| \{\}\)\[tourn\] \|\| null;/, 'the draw lookup reads the data name');
  // Weather: "Court speed · {tour}" prints the one name (the weather index still reads m.tour)
  assert.match(html, /const tourName = \(m && m\.tour && typeof sfEventName === 'function' \? sfEventName\(m\.tour\) : /);
  assert.match(html, /const entry = \(m && idx\.tours && idx\.tours\[m\.tour\]\) \|\| null;/);
});

test('r3.2 Player Profile → Record per tournament: each row prints sfEventName, the tier is the row\'s meta, the data name stays the key', () => {
  const L = req('./tools/ten384-figures-lib.js');
  const FX = JSON.parse(readFileSync(join(HERE, 'tools', 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
  const p = Object.assign({}, FX.profile, { tournamentHistory: TI.mergeHistory(FX.tournamentHistory) });
  const load = sf => L.loadPp2({ src: PP2, now: FX.asOf, players: { [FX.key]: p }, careerHistory: { [FX.key]: FX.careerHistory }, marketEdge: { [FX.key]: FX.marketEdge },
    bet365History: FX.bet365History, extra: Object.assign({ TournamentIdentity: TI, trProfileBacking: () => null, trProfilePriceOf: () => null, pp2DbJoinNeed: () => {} }, sf ? { sfEventName: sf } : {}) }).I;
  const I = load(P.sfEventName);
  const want = { Cincinnati: 'Cincinnati Open', Beijing: 'China Open', 'Monte Carlo': 'Monte-Carlo Masters', Rome: 'Italian Open', 'Canada Masters': 'Canadian Open',
    'Tour Finals': 'ATP Finals', Cup: 'ATP Cup', 'French Open': 'Roland Garros', Shanghai: 'Shanghai Masters', Estoril: 'Estoril', 'Davis Cup QLS R1: USA vs COL': 'Davis Cup QLS R1: USA vs COL' };
  for (const [k, v] of Object.entries(want)) { assert.equal(I.tournDisplayName(k, 'Masters 1000'), v, k); assert.equal(P.sfEventName(k), v, 'the page\'s one name: ' + k); }
  assert.equal(I.tournLevelMeta('Masters 1000'), 'Masters 1000');
  assert.equal(I.tournLevelMeta('ATP 500'), 'ATP 500');
  for (const l of ['Grand Slam', 'Tour Finals', null]) assert.equal(I.tournLevelMeta(l), '', String(l));
  // the list, rendered: S. Korda's 55 rows
  const st = I.state, saved = Object.assign({}, st);
  Object.assign(st, { key: p.key, modal: 'tourn', tournOpen: null, tournQuery: '' });
  let list; try { list = I.renderTournModal(p); } finally { Object.keys(st).forEach(k => delete st[k]); Object.assign(st, saved); }
  const rows = [...list.matchAll(/data-pp2="tourn-row" data-t="([^"]*)"[\s\S]*?min-width:0;">([^<]*)<\/span>(?:<span class="pp2-tlevel"[^>]*>([^<]*)<\/span>)?/g)]
    .map(x => ({ key: x[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&'), name: x[2].replace(/&#39;/g, "'").replace(/&amp;/g, '&'), meta: x[3] || '' }));
  assert.equal(rows.length, 55);
  const views = I.tournViews(p);
  for (const r of rows) {
    assert.equal(r.name, P.sfEventName(r.key), r.key);
    assert.doesNotMatch(r.name, /(Masters 1000|ATP 500|ATP 250)$/, 'a tier in the name: ' + r.name);
    assert.equal(r.meta, I.tournLevelMeta(views.find(v => v.name === r.key).level), 'meta of ' + r.key);
  }
  const by = k => rows.find(r => r.key === k);
  assert.deepEqual(by('Cincinnati'), { key: 'Cincinnati', name: 'Cincinnati Open', meta: 'Masters 1000' });
  assert.deepEqual(by('Canada Masters'), { key: 'Canada Masters', name: 'Canadian Open', meta: 'Masters 1000' });
  assert.equal(by('French Open').meta, '', 'a Slam has no meta');
  // the record is untouched by the name: the same W–L per data name with or without the one-name function
  const old = load(null).tournViews(p);
  assert.deepEqual(views.map(v => [v.name, v.won, v.lost, v.n]).sort(), old.map(v => [v.name, v.won, v.lost, v.n]).sort());
  // control: without the page's function the module falls back to its own map — the city names come back
  assert.equal(old.find(v => v.name === 'Cincinnati').display, 'Cincinnati');
  // search still finds a row by its data name, its one name and its tier
  const q = s => { Object.assign(st, { key: p.key, modal: 'tourn', tournOpen: null, tournQuery: s }); try { return (I.renderTournModal(p).match(/data-pp2="tourn-row"/g) || []).length; } finally { Object.keys(st).forEach(k => delete st[k]); Object.assign(st, saved); } };
  assert.equal(q('cincinnati open'), 1);
  assert.equal(q('canada'), 1);
  assert.ok(q('masters 1000') >= 5, 'the tier still filters');
});

test('r3.3 Matches board: the card head, the story strip and the chips print the one name; the filter keeps the data name', () => {
  const B = make(fnSrc('mxEventName'), 'mxEventName', {});
  assert.equal(B('ATP Shanghai'), 'Shanghai Masters');
  assert.equal(B('ATP Beijing'), 'China Open');
  assert.equal(B('ATP Tokyo'), 'Japan Open');
  assert.equal(B('ATP Chengdu'), 'Chengdu');
  assert.equal(B(''), '');
  assert.equal(B(undefined), '');
  const rm = fnSrc('renderMatches');
  assert.match(rm, /<span class="mc-tourn">\$\{mxEventName\(m\.tour\)\}<\/span>/);
  assert.doesNotMatch(rm, /tierSuffix/, 'TEN-407: no level suffix after the name ("Shanghai Masters", not "· ATP 1000")');
  assert.equal((rm.match(/\$\{bmv\.tour \? ' · ' \+ mxEventName\(bmv\.tour\) : ''\}/g) || []).length, 2);
  assert.match(rm, /\$\{sp\.tour \? ' · ' \+ mxEventName\(sp\.tour\) : ''\}/);
  assert.match(rm, /<div class="mc-story__ctx">\$\{\[\[mxEventName\(m\.tour\), roundBadgeText/);
  assert.doesNotMatch(rm, /\$\{m\.tour\}/, 'control: no raw m.tour printed in the board');
  // the chips, executed: printed name in the label, the data name in data-tournament (the filter reads it)
  const group = { innerHTML: '' };
  const state = { view: 'upcoming', day: 'd0', tournaments: new Set(['ATP Shanghai']) };
  make(fnSrc('mxEventName') + '\n' + fnSrc('buildTournamentFilters'), 'buildTournamentFilters()', {
    document: { getElementById: () => group }, state, isFinishedMatch: () => false, isUpcomingOrLive: () => true, matchDayBucket: () => 'd0',
    matches: [{ tour: 'ATP Shanghai' }, { tour: 'ATP Tokyo' }, { tour: 'ATP Chengdu' }, { tour: 'ATP Shanghai' }] });
  const chips = [...group.innerHTML.matchAll(/data-tournament="([^"]*)" aria-pressed="(true|false)">([^<]*)/g)].map(x => [x[1], x[3].trim()]);
  assert.deepEqual(chips, [['', 'All tournaments'], ['ATP Chengdu', 'Chengdu'], ['ATP Tokyo', 'Japan Open'], ['ATP Shanghai', 'Shanghai Masters']], 'ordered by the printed name');
  assert.deepEqual([...state.tournaments], ['ATP Shanghai'], 'the selection is still the data name');
});

test('r3.4 Entry list: "Canadian Open" in a Toronto year is Canadian Open · Toronto — the row\'s city breaks a shared official name', () => {
  // the index alone sends every shared spelling to ONE event (control: this is the defect the city fixes)
  for (const s of ['Canadian Open', 'National Bank Open', 'Rogers Cup', 'Canada Masters']) assert.equal(P.sfEventKey(s), 'Montreal', s);
  for (const s of ['Canadian Open', 'National Bank Open', 'Rogers Cup', 'Canada Masters']) assert.equal(P.sfEventKey(s, 'Toronto'), 'Toronto', s + ' / Toronto');
  assert.equal(P.sfEventKey('Canadian Open', 'Montréal'), 'Montreal');
  // a city never moves an event onto a DIFFERENT one
  assert.equal(P.sfEventKey('Shanghai', 'Toronto'), 'Shanghai');
  assert.equal(P.sfEventKey('Basel', 'Vienna'), 'Basel');
  assert.equal(P.sfEventKey('Nowhere Open', 'Toronto'), null);
  const render = make(['levelGroup', 'tierCode', 'countCell', 'hasList', 'renderTournament'].map(innerFn).join('\n'), 'renderTournament', { shortDate: () => '27 Jul' });
  const nameOf = t => (render(t, 0).match(/letter-spacing:-0\.005em;color:var\(--text\);[^"]*">([^<]*)<\/span>/) || [])[1];
  const row = (name, city) => ({ name, city, tier: 'ATP 1000', weekStart: '2026-07-27', sections: [] });
  assert.equal(nameOf(row('Canadian Open', 'Toronto')), 'Canadian Open · Toronto');
  assert.equal(nameOf(row('National Bank Open', 'Toronto')), 'Canadian Open · Toronto');
  assert.equal(nameOf(row('Canadian Open', 'Montreal')), 'Canadian Open · Montreal');
  assert.equal(nameOf(row('Toronto', 'Toronto')), 'Canadian Open · Toronto');
  assert.equal(nameOf(row('Shanghai', 'Shanghai')), 'Shanghai Masters');
});

test('r3.5 the ATP Cup prints "ATP Cup" (the cleaner strips "ATP " to "Cup"); other team events keep their names', () => {
  for (const s of ['Cup', 'ATP Cup', 'cup']) assert.equal(P.sfEventName(s), 'ATP Cup', s);
  for (const s of ['Davis Cup', 'Laver Cup', 'United Cup', 'ATP Laver Cup']) assert.equal(P.sfEventName(s), s.replace(/^ATP /, ''), s);
  assert.equal(P.sfEventKey('Cup'), null, 'display only: it is not a registry event');
});

test('TEN-407 review: the sheet head, favourites strip, profile Next match, Playing styles group titles and the Progression tooltip print the one name', () => {
  assert.match(html, /const meta = \[r\.tourn && \(typeof sfEventName === 'function' \? sfEventName\(r\.tourn\) : r\.tourn\), r\.surface/);
  assert.match(fnSrc('mxFavStripHtml'), /const meta = \[mxEventName\(m\.tour\), roundBadgeText/);
  assert.match(html, /const event = \(m\.tour && typeof sfEventName === 'function' \? sfEventName\(m\.tour\)/);
  assert.match(html, /return \{ title: \(typeof sfEventName === 'function' \? sfEventName\(gp\.tournament\) : gp\.tournament\), meta:/);
  assert.match(html, /'No box scores for ' \+ P\.labels\[i\] \+ ' at ' \+ \(typeof sfEventName === 'function' \? sfEventName\(P\.tourn\) : P\.tourn\);/);
});
