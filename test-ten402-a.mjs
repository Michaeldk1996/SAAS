// TEN-402 step 8 (group a) — Head to Head: header card, pickers + menus, empty state (Suggested matchups), thin-data
// caveat, Stennisfy Model, Playing style DNA, Latest news, the shared section head and the darker-track control.
//
// Drives the REAL code: every function under test is sliced out of the shipped bsp-consult-dashboard.html (the H2H
// module, window.H2HPage) and executed with stubbed inputs — never a copy of the rule. Each data ruling has a control
// so a pass cannot be vacuous. Night only (founder f49da477): no day assertions.
//
// Run: node --test test-ten402-a.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN402_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const H2H_AT = html.indexOf('HEAD-TO-HEAD PAGE  (ported from design_handoff_head_to_head');
assert.ok(H2H_AT > 0, 'H2H module marker not found');

// Slice `function name(...) {...}` — inside the H2H module when `inH2H`, else the first one in the page.
function slice(name, inH2H = true) {
  const start = html.indexOf(`function ${name}(`, inH2H ? H2H_AT : 0);
  assert.ok(start > 0, `${name} not found`);
  let depth = 0, i = html.indexOf('{', start);
  const open = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  assert.ok(i > open, `${name} braces did not balance`);
  return html.slice(start, i + 1);
}
function sliceConst(name) {
  const m = new RegExp(`\\n  const ${name} = [^\\n]*\\n`).exec(html.slice(H2H_AT));
  assert.ok(m, `const ${name} not found in the H2H module`);
  return m[0];
}
// The page's stylesheet (the rebuild moved the hover states into h2h-page.css; every other value is inline in the
// templates, read off the reference markup). TEN402_CSS overrides it for the mutants.
const CSS = readFileSync(process.env.TEN402_CSS || join(HERE, 'h2h-page.css'), 'utf8');
// The rebuilt renderers, EXECUTED: tools/h2h-test-harness.js runs the shipped module and slices the page helpers it reaches.
const HX = createRequire(import.meta.url)(join(HERE, 'tools/h2h-test-harness.js'));
const page = g => HX.load({ html, globals: g || {} });
const text = h => String(h).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
// the design's values (reference/Head to Head.dc.html), read through the page's --h2h-* tokens
const W = n => `color-mix(in srgb, var(--h2h-white) ${n}%, transparent)`;
const CAP = "font-family:'Hanken Grotesk',sans-serif; font-size:11.5px; font-weight:600; color:var(--h2h-grey);";   // 20 Nov §8: normal case, no tracking
const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── Data 7 / L-default H5: Suggested matchups = real pairs from this week's draws ──────────────────────────────────
const NOW = Date.UTC(2026, 9, 8, 12);   // Thu 8 Oct 2026 → week Mon 5 – Sun 11 Oct
// TEN-402 r1 fix 6: the event must be one of this week's events by the Entry list's rule — the page's own
// tourxThisWeekEvents() result is injected here (its rule is executed by test-ten401-b.mjs r1.4); default = Shanghai week.
function suggest(matches, P, week = [{ name: 'Shanghai', city: null, hasList: false }], el) {
  const src = sliceConst('H2H_SUGGEST_MAX') + slice('suggestionPairs');
  const globals = { tourxThisWeekEvents: () => week, EntryListsTab: el || null };
  return new Function('DV', 'P', 'fn', 'G', 'render', src + '\nreturn suggestionPairs;')(n => (n === 'matches' ? matches : null), P,
    n => (typeof globals[n] === 'function' ? globals[n] : null), n => globals[n], () => {});
}
const PL = { 1: { rank: 1 }, 2: { rank: 2 }, 3: { rank: 3 }, 9: { rank: 9 }, 40: { rank: 40 }, 77: { rank: null } };
const M = (k1, k2, date, extra) => Object.assign({ p1Key: k1, p2Key: k2, date, tour: 'ATP Shanghai', tournamentRound: 'ATP Shanghai - 1/16-finals' }, extra || {});

test('H5: suggested matchups = this week\'s ATP main-draw pairs, best combined rank first, top 3, A = better ranked', () => {
  const ms = [
    M(9, 2, '2026-10-06', { tour: 'ATP Beijing', tournamentRound: 'ATP Beijing - Final' }),   // 11
    M(40, 3, '2026-10-10'),                                                                   // 43
    M(1, 3, '2026-10-04'),                                                                    // last week (Sun 4 Oct)
    M(1, 2, '2026-10-08', { tournamentRound: 'ATP Shanghai - Qualification Final' }),         // qualifying
    M(1, 40, '2026-10-12'),                                                                   // next week
    M(2, 1, '2026-10-07', { tour: 'Challenger Ningbo' }),                                     // not an ATP main draw
    M(3, 9, '2026-10-08'),                                                                    // 12
    M(9, 3, '2026-10-09'),                                                                    // same pair again
    M(1, 777, '2026-10-08'),                                                                  // not on the roster
    M(77, 1, '2026-10-08'),                                                                   // a rank missing → last
  ];
  // fix 6: the Beijing final (Mon 5 Oct, this calendar week) is NOT one of this week's events (Shanghai) → no chip
  const got = suggest(ms, PL)(NOW);
  assert.deepEqual(got, [['3', '9', 'Shanghai'], ['3', '40', 'Shanghai'], ['1', '77', 'Shanghai']]);
  // control: had Beijing been one of this week's events (as on 30 Sep), its final would lead the chips
  assert.deepEqual(suggest(ms, PL, [{ name: 'Shanghai' }, { name: 'China Open', city: 'Beijing' }])(NOW),
    [['2', '9', 'Beijing'], ['3', '9', 'Shanghai'], ['3', '40', 'Shanghai']]);
  // control: the qualifying pair (best combined rank 3) would top the list if the rule did not drop it
  const q = suggest([M(1, 2, '2026-10-08')], PL)(NOW);
  assert.deepEqual(q, [['1', '2', 'Shanghai']]);
  // a pair with a missing rank still shows, after every fully-ranked pair
  assert.deepEqual(suggest([M(77, 1, '2026-10-08'), M(40, 9, '2026-10-08')], PL)(NOW).map(r => r.slice(0, 2)), [['9', '40'], ['1', '77']]);
});
test('fix 6: the week set comes from tourxThisWeekEvents(); not live yet → no chips + ONE Entry-list load, never a guess', () => {
  const src = slice('suggestionPairs');
  assert.match(src, /fn\('tourxThisWeekEvents'\)/, 'suggestionPairs calls the Entry list rule');
  let loads = 0;
  const el = { load: () => { loads++; return Promise.resolve(true); } };
  const f = suggest([M(3, 9, '2026-10-08')], PL, null, el);
  assert.deepEqual(f(NOW), []);
  assert.deepEqual(f(NOW), []);
  assert.equal(loads, 1, 'the shards are loaded once');
  // an event matched on the shard row's CITY (the board writes "ATP Beijing", the shard "China Open")
  assert.deepEqual(suggest([M(3, 9, '2026-10-08', { tour: 'ATP Beijing' })], PL, [{ name: 'China Open', city: 'Beijing' }])(NOW), [['3', '9', 'Beijing']]);
});
test('H5: no fixture this week → no suggestions (the chips row is not drawn)', () => {
  assert.deepEqual(suggest([M(1, 2, '2026-09-30')], PL)(NOW), []);
  assert.deepEqual(suggest([], PL)(NOW), []);
  const h = page();
  const none = h.call(h.emptyState, { emptyTitle: 'Pick two players to compare', suggestions: [] });
  assert.ok(!/Suggested matchups/.test(none), 'no pair → no chips row');
  const one = h.call(h.emptyState, { emptyTitle: 'Pick two players to compare', suggestions: [{ label: 'J. Sinner vs C. Alcaraz', event: 'Shanghai Masters', hid: 3 }] });
  assert.match(one, /Suggested matchups/);
  assert.match(one, /<span class="seg x-sugg" data-hid="3" title="Shanghai Masters" style="font-size:12\.5px; font-weight:600; color:var\(--h2h-grey\); background:var\(--h2h-layer\); border:1px solid color-mix\(in srgb, var\(--h2h-white\) 6%, transparent\); border-radius:9px; padding:8px 13px;">J\. Sinner vs C\. Alcaraz<\/span>/, 'the design chip, the event on its hover');
});

// ── Data 6 / L-default H6: Latest news = the News page's feed, attributed the News page's way ───────────────────────
function newsHarness(articles, extra) {
  const playerProfiles = { 2072: { name: 'J. Sinner' }, 2382: { name: 'C. Alcaraz' }, 1980: { name: 'A. Zverev' } };
  const globals = new Function('playerProfiles', slice('newsProfileRoster', false).replace('function newsProfileRoster', 'let _newsProfileRoster = null;\nfunction newsProfileRoster')
    + '\n' + slice('newsPlayerFor', false) + '\n' + slice('newsParseTs', false) + '\n' + slice('newsSourceLabel', false)
    + '\nreturn { newsPlayerFor, newsParseTs, newsSourceLabel };')(playerProfiles);
  const fns = Object.assign({}, globals, extra || {});
  const src = sliceConst('H2H_NEWS_HOURS') + slice('ageStr') + '\n' + slice('newsFor');
  return new Function('DV', 'fn', src + '\nreturn newsFor;')(n => (n === '_newsData' ? { articles } : null), n => fns[n] || null);
}
const SIN = { key: '2072', full: 'J. Sinner', short: 'J. Sinner' }, ALC = { key: '2382', full: 'C. Alcaraz', short: 'C. Alcaraz' };
const ts = h => new Date(NOW - h * 3600e3).toISOString().replace('T', ' ').replace('Z', '');

test('H6: an item is chipped with the player the News page attributes it to — a Sinner story never chips as Alcaraz', () => {
  const arts = [
    { title: 'Sinner cruises past Cerundolo, sets up Alcaraz quarter-final', player_key: '2072', player_name: 'J. Sinner', published_at: ts(2), sources: ['ATP Tour'], content: 'Body.' },
    { title: 'Alcaraz survives Paul in two tight sets', published_at: ts(4), sources: ['ATP Tour'] },          // no key → title matcher
    { title: 'Ferrero on coaching Sinner and Alcaraz', published_at: ts(5) },                                  // two surnames → unattributed
    { title: 'Zverev closes on No 1 as Sinner sits out', player_key: '1980', player_name: 'A. Zverev', published_at: ts(6) },
    { title: 'Sinner withdraws from Shanghai', player_key: '2072', player_name: 'J. Sinner', published_at: ts(24 * 8) },  // outside 7 days
  ];
  const newsFor = newsHarness(arts);
  const s = newsFor(SIN, NOW), a = newsFor(ALC, NOW);
  assert.deepEqual(s.map(x => x.title), ['Sinner cruises past Cerundolo, sets up Alcaraz quarter-final']);
  assert.deepEqual(a.map(x => x.title), ['Alcaraz survives Paul in two tight sets']);
  assert.ok(s.every(x => x.who === 'J. Sinner' && x.whoKey === '2072') && a.every(x => x.who === 'C. Alcaraz'));
  // control: the retired rule (surname anywhere in title or body) would have put the Sinner story under Alcaraz
  assert.ok(/\bAlcaraz\b/i.test(arts[0].title), 'control: the Sinner headline does name Alcaraz');
  assert.equal(a.some(x => /Cerundolo/.test(x.title)), false);
  assert.match(s[0].meta, /^ATP Tour · /);   // source · age (ageStr reads the real clock)
});
test('founder 2026-11-19: a medical time-out (mto-matches.json) is an Injury item for the player who called it — joined on surname + initial, the score from his side', () => {
  const newsFor = (() => { const src = sliceConst('H2H_NEWS_HOURS') + slice('ageStr') + '\n' + slice('xSurOf') + '\n' + slice('newsFor');
    return new Function('DV', 'fn', 'window', src + '\nreturn newsFor;')(() => null, () => null, { pp2MtoMatches: { matches: { 12179700: [
      { calledAt: new Date(NOW - 30 * 3600e3).toISOString(), player: 'Rafael Jodar', opponent: 'Arthur Fils', playerSide: 1, games: [[6, 1], [4, 4]], durationSeconds: 58, finalResult: '6–4, 2–6, 2–6', retired: false },
      { calledAt: new Date(NOW - 30 * 3600e3).toISOString(), player: null, opponent: null, playerSide: null, games: [[6, 1], [4, 4]] }] } } }); })();
  const J1 = { key: '50323', full: 'R. Jodar', short: 'R. Jodar' }, F1 = { key: '1', full: 'A. Fils', short: 'A. Fils' };
  const j = newsFor(J1, NOW);
  assert.equal(j.length, 1, 'one item: the unnamed duplicate row is never his');
  assert.equal(j[0].kind, 'mto');
  assert.equal(j[0].title, 'Jodar took a medical time-out against Fils');
  assert.equal(j[0].body, 'Jodar called a medical time-out at 6–4, 1–4 in the second set against Fils, and it took under a minute. He lost 6–4, 2–6, 2–6.');
  assert.deepEqual(newsFor(F1, NOW), [], 'never under the opponent');
  const xc = new Function(slice('xNewsCat') + '\nreturn xNewsCat;')();
  assert.equal(xc(j[0]), 'injuries', 'it sits under the Injuries filter');
});
test('H6: BSP Intel / ASAP items join under their own key; nothing for either player → the design\'s one grey sentence, never a sample', () => {
  const intel = () => [{ kind: 'intel', intelId: 'n1', ts: NOW - 3600e3, player: 'C. Alcaraz', playerKey: '2382', title: 'Intel on Alcaraz', bodyParas: ['x'], srcRaw: 'BSP Consult Intel' }];
  const newsFor = newsHarness([], { newsIntelItems: intel });
  assert.deepEqual(newsFor(ALC, NOW).map(x => x.title), ['Intel on Alcaraz']);
  assert.deepEqual(newsFor(SIN, NOW), []);
  // README §7 "Empty filter: one centred grey sentence" (replaces h2h.md's "none → card hidden")
  const h = page();
  const v = { a: SIN, b: ALC, news: { empty: true, feed: [] } };
  const card = h.call(h.newsCard, v);
  assert.match(text(card), /^Latest news Both players · newest first All Match reports Quotes Injuries Articles No news for J\. Sinner or C\. Alcaraz in the last 7 days\.$/);
  assert.ok(!/data-h2h-news=/.test(card), 'no row');
  // a filter with nothing: the sentence names the filter; the category comes from the site's own fields
  h.state.newsCat = 'quotes';
  const v2 = { a: SIN, b: ALC, news: { feed: [{ id: 'x', side: 'a', cat: 'articles', title: 'T', who: 'J. Sinner', whoKey: '2072', hOpen: 1 }] } };
  assert.match(text(h.call(h.newsCard, v2)), /Nothing under quotes for either player\./, "round 7 (HEAD_TO_HEAD.md): an empty category names it");
  assert.equal(h.call(h.xNewsCat, { kind: 'asap' }), 'quotes');
  assert.equal(h.call(h.xNewsCat, { kind: 'intel' }), 'articles');
  assert.equal(h.call(h.xNewsCat, { kind: 'feed', title: 'Sinner withdraws from Paris with a back injury', body: '' }), 'injuries', 'the News page\'s mapping (newsClassify)');
});
test('H6: the card interleaves A, B, A, B … and shows at most H2H_NEWS_MAX rows', () => {
  const state = { newsOpen: null };
  const nv = new Function('newsFor', 'state', 'bindH', 'setState', 'let _xTickerKick = true;\n' + sliceConst('H2H_NEWS_MAX') + slice('xNewsCat') + slice('newsVals') + '\nreturn newsVals;')(
    p => [1, 2, 3, 4, 5].map(i => ({ id: p.key + i, who: p.short })), state, () => 0, () => {});
  const v = nv({ key: 'a', short: 'A' }, { key: 'b', short: 'B' });
  assert.deepEqual(v.feed.map(x => x.id), ['a1', 'b1', 'a2', 'b2', 'a3', 'b3']);
});

// ── Stennisfy Model (founder 2026-11-16): the pair's likely opening price from pair-prices/<key>.json ───────────────
// Drives the shipped pairPxFor + modelVals + modelCard with a stubbed fetch; every check has its control.
async function modelHarness(files, { now = 0 } = {}) {
  const calls = [];
  const fetch = url => { calls.push(url); const f = files[url];
    if (f === 'fail') return Promise.reject(new Error('net'));
    if (f === undefined) return Promise.resolve({ status: 404, ok: false, json: async () => null });
    return Promise.resolve({ status: 200, ok: true, json: async () => JSON.parse(JSON.stringify(f)) }); };
  const state = { aSel: '10', bSel: '20' };
  let renders = 0;
  const src = sliceConst('H2H_PAIR_RETRY_MS') + sliceConst('H2H_PAIR_LAYERS') + sliceConst('_pairPx') + sliceConst('X_CAP')
    + slice('pairPxFor') + slice('pairClock') + slice('modelVals') + slice('xHelp') + 'function xPhotoOver() { return \'\'; }\n' + slice('modelCard')
    // round 7: the card head = xBoxHead + the box's chips (xChips); handlers are inert here
    + sliceConst('X_ALLT') + sliceConst('X_SURFS') + sliceConst('X_WINS') + sliceConst('X_FMTS') + slice('xChips') + slice('xBoxHead')
    + 'function bindH() { return 0; } function setState() {} function setCtx() {}\n';
  const mod = new Function('fetch', 'state', 'built', 'render', 'fn', 'E', 'Date',
    src + '\nreturn { modelVals, modelCard, pairPxFor };')(fetch, state, true, () => { renders++; }, () => null, E,
    Object.assign(function () { return new globalThis.Date(...arguments); }, { now: () => now, parse: globalThis.Date.parse }));
  const settle = () => new Promise(r => setTimeout(r, 0));
  return Object.assign(mod, { calls, settle, renders: () => renders });
}
const A = { key: '10', full: 'A. One', short: 'A. One', mono: 'AO' }, B = { key: '20', full: 'B. Two', short: 'B. Two', mono: 'BT' };
// A at 33.40% on hard best of 3 (Elo base 34.65%, 6 layers); B's shard is the mirror.
const SH_A = { v: 1, generatedAt: '2026-11-16T07:19:32Z', margin: 0.0339, marginN: 442, key: '10',
  opp: { 20: { H3: [3340, 3465, 6], C5: [3828, 3938, 7] } } };
const SH_B = { v: 1, generatedAt: '2026-11-16T07:19:32Z', margin: 0.0339, marginN: 442, key: '20',
  opp: { 10: { H3: [6660, 6535, 6], C5: [6172, 6062, 7] } } };
const FILES = { 'pair-prices/10.json': SH_A, 'pair-prices/20.json': SH_B };

test('Model: any pair gets a price — p from the engine file, plus the margin: 1 / (p × (1 + m)), oriented to A', async () => {
  const h = await modelHarness(FILES);
  assert.equal(h.modelVals(A, B, { ctxSurface: 'Hard', ctxFormat: 3 }).loading, true, 'loading first, never a price');
  await h.settle();
  const v = h.modelVals(A, B, { ctxSurface: 'Hard', ctxFormat: 3 });
  assert.equal(v.priced, true);
  assert.equal(v.aPrice, (1 / (0.334 * 1.0339)).toFixed(2)); assert.equal(v.aPrice, '2.90');
  assert.equal(v.bPrice, (1 / (0.666 * 1.0339)).toFixed(2)); assert.equal(v.bPrice, '1.45');
  assert.equal(v.foot.aPct, '33'); assert.equal(v.foot.bPct, '67'); assert.equal(v.foot.basePct, '35');
  assert.equal(v.foot.layers, '6'); assert.equal(v.foot.of, '10'); assert.equal(v.foot.margin, '3.4'); assert.equal(v.foot.marginN, '442');
  // control: the toggles pick the context — clay best of 5 is another cell
  const c = h.modelVals(A, B, { ctxSurface: 'Clay', ctxFormat: 5 });
  assert.equal(c.aPrice, (1 / (0.3828 * 1.0339)).toFixed(2)); assert.notEqual(c.aPrice, v.aPrice);
  // swapping the players swaps the prices (B's own shard read)
  const s = h.modelVals(B, A, { ctxSurface: 'Hard', ctxFormat: 3 });
  assert.equal(s.aPrice, '1.45'); assert.equal(s.bPrice, '2.90');
  assert.equal(h.calls.length, 2, 'one fetch per player per session');
  // the card draws both boxes; the explanation lives in the head's "?" (founder ruling 7, 2026-11-18), never the body
  const html2 = h.modelCard({ model: v });
  assert.match(html2, /data-h2h-model="priced"/);
  // the design's box (DF §1): caps "Likely opening price" over the price, mono 800 clamp(20px,2.2vw,28px), white
  // founder fix 1 (2026-11-26): the price is a RANGE, Elo-only price (cell[1]) → full model price (cell[0]), low – high, white
  assert.match(html2, /Likely opening price<\/span><span data-h2h-price style="font-family:'IBM Plex Mono',monospace; font-size:clamp\(20px,calc\(2\.2vw \/ var\(--sf-z, 1\)\),28px\); font-weight:800; color:var\(--h2h-text\);[^"]*">2\.79 – 2\.90</);
  assert.match(html2, /data-h2h-price [^>]*>1\.45 – 1\.48</, 'B: model 1.45, Elo only 1.48 → low – high');
  const tip = (/<span class="x-help" title="([^"]*)"/.exec(html2) || [])[1] || '';
  assert.match(tip, /^Win chance A\. One 33% · B\. Two 67% · Hard, best of 3\nElo base 35% for A\. One, moved by 6 of 10 model layers · plus Pinnacle’s typical opening margin, 3\.4% \(n=442\) · model run \d\d:\d\d\nThe range runs from the Elo-only price \(no model layer: A\. One 2\.79 · B\. Two 1\.48\) to the full model price \(A\. One 2\.90 · B\. Two 1\.45\)\.$/, 'the help names both ends of the range (founder fix 1, 2026-11-26)');
  assert.equal((1 / (0.3465 * 1.0339)).toFixed(2), '2.79', 'Elo alone = the engine base (cell[1]) on the same margin');
  const body = html2.replace(/title="[^"]*"/g, '');
  assert.doesNotMatch(body, /Win chance|Elo base|model layers|Elo only|Elo alone|Elo-only/, 'no explanation line in the card body (founder 2026-11-20)');
});
test('Model: a context the engine could not price, a player outside the file, a failed load — a reason, never a price', async () => {
  const h = await modelHarness(FILES); h.modelVals(A, B, {}); await h.settle();
  const g = h.modelVals(A, B, { ctxSurface: 'Grass', ctxFormat: 3 });
  assert.equal(g.priced, false); assert.equal(g.aPrice, '—'); assert.match(g.emptyText, /could not price this pair on grass, best of 3/);
  // B not covered (404)
  const h2 = await modelHarness({ 'pair-prices/10.json': SH_A }); h2.modelVals(A, B, {}); await h2.settle();
  const n = h2.modelVals(A, B, { ctxSurface: 'Hard', ctxFormat: 3 });
  assert.equal(n.priced, false); assert.match(n.emptyText, /top 200 with a weekly Elo, and B\. Two is not among them/);
  assert.equal(n.foot, null);
  // failed load → the retry line; after H2H_PAIR_RETRY_MS it is asked again
  const h3 = await modelHarness({ 'pair-prices/10.json': 'fail', 'pair-prices/20.json': SH_B }); h3.modelVals(A, B, {}); await h3.settle();
  const f = h3.modelVals(A, B, { ctxSurface: 'Hard', ctxFormat: 3 });
  assert.equal(f.priced, false); assert.match(f.emptyText, /couldn’t load/);
  assert.equal(h3.calls.filter(u => u === 'pair-prices/10.json').length, 1, 'no refetch inside the retry window');
  // a file with no margin prints no price (never an unmargined price passed off as an opening line)
  const h4 = await modelHarness({ 'pair-prices/10.json': Object.assign({}, SH_A, { margin: undefined }), 'pair-prices/20.json': SH_B });
  h4.modelVals(A, B, {}); await h4.settle();
  assert.equal(h4.modelVals(A, B, { ctxSurface: 'Hard', ctxFormat: 3 }).priced, false);
  // the page never reads model-output.json or a board match for this card
  assert.doesNotMatch(slice('modelVals'), /modelOutput|DV\('matches'\)/);
});
test('Data 3: the header Elo is the weekly Elo Database → Ratings shows (tourxRating), "—" when not held', () => {
  const rv = slice('renderVals');
  assert.match(rv, /eloTxt: weeklyElo\(p\.full\) \|\| '—'/);
  assert.match(slice('weeklyElo'), /fn\('tourxRating'\)/);
});

// ── Playing style DNA (Data 4) ────────────────────────────────────────────────────────────────────────────────────
test('DNA (founder ruling 8, re-ruled 2026-11-18): the windows are Last 52 weeks · Career only — 52 weeks = the DNA file, Career = surface-ratings career + the Elo peak; no Last 24 months, no dashed state', () => {
  const m = /const DNA_WIN = \{ w52: \{ scope: 'last52', label: 'Last 52 weeks'[^\n]*\n\s*career: \{ scope: 'career', label: 'Career'[^\n]*career: true \} \};/.exec(html);
  assert.ok(m, 'DNA_WIN = the two windows');
  assert.doesNotMatch(html.slice(H2H_AT), /Since Mar 2024'|DNA_NO_M24|W\.none/, 'no since-Mar-2024 tab, no Last 24 months dashed state');
  const dv = slice('dnaVals');
  assert.match(dv, /if \(W\.career\) \{\n\s*const c = dnaCareerFor\(p, surface\);/);
  assert.match(dv, /delta: \(has && scope === 'last52' && d\.deltas\)/, 'Δ only on the last-52-weeks view (the scope actually read)');
  // founder fix 4 (2026-11-26): a player under the floor in the last 52 weeks reads the same file's since-March-2024 scope
  assert.match(dv, /if \(d && d\.inPool && !d\.ok && W\.scope === 'last52'\) \{\n\s*const d2 = dnaRadarFor\(p\.key, surface, 'sinceBase', p\.full\);/);
  const dc = slice('dnaCareerFor');
  assert.match(dc, /rec\.surfaces\[surface\]\.career/);
  assert.match(dc, /const ratings = \[g\(nd\.serve, 'rating'\), g\(nd\.return, 'rating'\), g\(nd\.underPressure, 'rating'\), g\(nd\.dominance, 'rating'\), peak\];/, 'founder 2026-11-19: the career dominance ratio');
  assert.match(dc, /const pcts = \[g\(nd\.serve, 'index'\), g\(nd\.return, 'index'\), g\(nd\.underPressure, 'index'\), g\(nd\.dominance, 'index'\), dnaEloPeakPct\(peak\)\];/, 'every career axis carries a shape point');
  assert.match(slice('dnaEloPeak'), /rec\.peak \? rec\.peak\.rating/);
});
// ── Playing style (design §2, DF L253–290): the radar and the ten face-to-face rows, executed ─────────────────────
const SIN2 = { key: '2072', short: 'J. Sinner', full: 'J. Sinner', mono: 'JS' }, ALC2 = { key: '2382', short: 'C. Alcaraz', full: 'C. Alcaraz', mono: 'CA' };
function dnaView(o) {
  const opt = o || {};
  const side = (name, raws, pcts, ok, extra) => ({ d: { ok, inPool: true, matches: ok ? 30 : 4 }, vals: raws.map((r, i) => ({ raw: r, pct: pcts[i] })), name, extra });
  const A = side('J. Sinner', [310, 152.4, 1.2, 1.31, 2150], [96, 88, 70, 95, 99], opt.okA !== false, [64.0, 78.4, 57.0, 90.1, 27.5]);
  const B = side('C. Alcaraz', [298, 160.1, 1.2, 1.25, 2190], [90, 95, 70, 88, 100], opt.okB !== false, [61.2, 74.2, 57.0, 86.3, 31.9]);
  return { a: SIN2, b: ALC2, dna: { W: { label: 'Last 52 weeks' }, surface: 'Hard', a: A, b: B, extra: { a: A.extra, b: B.extra }, loading: false, tabs: [{ label: 'Last 52 weeks', on: true, hid: 1 }, { label: 'Since Mar 2024', on: false, hid: 2 }] } };
}
const ftfRows = c => [...c.matchAll(/<div style="display:grid; grid-template-columns:66px minmax\(0,1fr\) 66px;[^>]*>\s*<span style="font-family:'IBM Plex Mono',monospace; font-size:16px; font-weight:(\d+); color:([^;]+);">([^<]*)<\/span>[\s\S]*?<span style="font-size:12\.5px; color:var\(--h2h-soft\); white-space:nowrap;">([^<]*)<\/span>[\s\S]*?background:([^;]+);"><\/span><span style="[^"]*">([^<]*)<\/span>[\s\S]*?<span style="text-align:right; font-family:'IBM Plex Mono',monospace; font-size:16px; font-weight:(\d+); color:([^;]+);">([^<]*)<\/span>/g)]
  .map(m => ({ label: m[4], a: [m[3], +m[1], m[2]], b: [m[9], +m[7], m[8]], lean: m[5], gap: m[6] }));
test('Playing style radar (20 Nov §3, design 1a): round rings + 6% spokes on viewBox 55 0 310 270; player two white (7% fill, 1.5) under player one blue (16% fill, 2); a dot on every value (B hollow, A solid, A last); a below-floor player draws no shape', () => {
  const h = page();
  const c = h.call(h.dnaBlock, dnaView());
  const svg = c.slice(c.indexOf('<svg'), c.indexOf('</svg>'));
  assert.match(svg, /^<svg viewBox="55 0 310 270"/);
  const circ = [...svg.matchAll(/<circle cx="210" cy="150" r="([\d.]+)" fill="([^"]+)" stroke="([^"]+)" stroke-width="1"( stroke-dasharray="2 4")?><\/circle>/g)].map(m => [m[1], m[2], m[3], !!m[4]]);
  assert.deepEqual(circ, [['105', W(1.5), W(10), false], ['78.75', 'none', W(6), true], ['52.5', 'none', W(6), true], ['26.25', 'none', W(6), true]], 'the outer ring + three dotted inner rings');
  assert.equal((svg.match(new RegExp(`<line x1="210" y1="150" [^>]*stroke="${esc(W(6))}" stroke-width="1"><\\/line>`, 'g')) || []).length, 5, 'five 6% spokes');
  const polys = [...svg.matchAll(/<polygon points="[^"]+" fill="([^"]+)" stroke="([^"]+)" stroke-width="([\d.]+)" stroke-linejoin="round"><\/polygon>/g)].map(m => [m[1], m[2], m[3]]);
  assert.deepEqual(polys, [['color-mix(in srgb, var(--h2h-text) 7%, transparent)', 'var(--h2h-text)', '1.5'], ['color-mix(in srgb, var(--h2h-blue) 16%, transparent)', 'var(--h2h-blue)', '2']], 'B first (under), A on top');
  const dots = [...svg.matchAll(/<circle cx="[\d.]+" cy="[\d.]+" r="3\.5" ([^>]*)><\/circle>/g)].map(m => m[1]);
  assert.equal(dots.length, 10, 'a dot on every value of both players');
  assert.deepEqual(dots.slice(0, 5), Array(5).fill('fill="var(--h2h-card)" stroke="var(--h2h-text)" stroke-width="1.5"'), 'B hollow first');
  assert.deepEqual(dots.slice(5), Array(5).fill('fill="var(--h2h-blue)"'), 'A solid, drawn last');
  assert.ok(svg.indexOf('r="3.5"') > svg.lastIndexOf('<polygon'), 'the dots sit over both shapes');
  // axis labels: the name 11.5/600 grey normal case, A's raw value blue · B's white; Return / Surface Elo in the top corners
  assert.match(c, /data-h2h-axis="serve"[^>]*><span style="font-family:'Hanken Grotesk',sans-serif; font-size:11\.5px; font-weight:600; color:var\(--h2h-grey\); white-space:nowrap;">Serve<\/span>[\s\S]*?<span style="color:var\(--h2h-blue\);">310<\/span>[\s\S]*?<span style="color:var\(--h2h-text\);">298<\/span>/);
  const pos = k => (new RegExp(`data-h2h-axis="${k}" style="position:absolute; left:([\\d.]+)%; top:([\\d.]+)%;`).exec(c) || []).slice(1).map(Number);
  assert.deepEqual(pos('return'), [100, +(52 / 270 * 100).toFixed(2)], 'Return top right (x 365, y 52)');
  assert.deepEqual(pos('elo'), [0, +(52 / 270 * 100).toFixed(2)], 'Surface Elo top left (x 55, y 52)');
  assert.ok(!/text-transform:uppercase/.test(c), 'no uppercase label anywhere in the card');
  // a player under the floor: no shape and no dots for him (one polygon, five dots)
  const lo = h.call(h.dnaBlock, dnaView({ okB: false }));
  assert.equal((lo.match(/<\/polygon>/g) || []).length, 1);
  assert.equal((lo.match(/r="3\.5"/g) || []).length, 5);
  // round 7 (final design 2026-11-26): the block sits INSIDE the Model card under a 6% hairline — no head of its own, no
  // window switch (the card's Window chip drives it); its explanation is the card's "?" (dnaHelp)
  assert.ok(c.startsWith(`<div id="h2h-dna" data-h2h-style="Hard" style="display:flex; flex-direction:column; gap:16px; border-top:1px solid ${W(6)}; padding-top:18px;">`));
  assert.doesNotMatch(text(c), /Playing style|Since Mar 2024|x-sw|\?/);
  assert.doesNotMatch(c, /class="x-sw|x-help/);
  assert.match(h.call(h.dnaHelp, dnaView()), /^Playing style · Hard · Last 52 weeks\. Blue line and blue ring: J\. Sinner\. White line and white ring: C\. Alcaraz\./);
  assert.deepEqual([...c.matchAll(/class="x-av"[^>]*box-shadow:0 0 0 2px ([^;]+);/g)].map(m => m[1]), ['var(--h2h-blue)', 'var(--h2h-text)'], 'A ring blue, B ring white');
});
test('founder ruling 1 (2026-11-16) + 20 Nov §1 order: the face-to-face rows print the better figure white 800 and the other grey 500 (H2H_FTF_LEAD_EMPHASIS); a tie and a dash mark neither; the lean bar goes toward the better player', () => {
  const h = page();
  assert.equal(h.consts.H2H_FTF_LEAD_EMPHASIS, true);
  const rows = ftfRows(h.call(h.dnaBlock, dnaView()));
  assert.deepEqual(rows.map(r => r.label), ['Elo on hard', 'Dominance ratio', 'Serve rating', 'Return rating', 'Under pressure', '1st serve in', '1st serve points won', '2nd serve points won', 'Service games held', 'Return games won'], 'the ten rows in the 20 Nov order, no Break points converted');
  assert.ok(!/Break points converted/.test(h.call(h.dnaBlock, dnaView())));
  assert.deepEqual([rows[5].a[0], rows[5].b[0]], ['64.0%', '61.2%'], '1st serve in = extra[0]');
  const serve = rows.find(r => r.label === 'Serve rating');
  assert.deepEqual([serve.a, serve.b], [['310', 800, 'var(--h2h-text)'], ['298', 500, 'var(--h2h-grey)']], 'A better: A white (--h2h-text, CHANGES 2026-11-17 §7) 800, B grey 500');
  assert.deepEqual([serve.lean, serve.gap], ['var(--h2h-blue)', '12'], 'the bar leans to A in his colour, the chip = the difference');
  const ret = rows.find(r => r.label === 'Return rating');
  assert.deepEqual([ret.a, ret.b], [['152.4', 500, 'var(--h2h-grey)'], ['160.1', 800, 'var(--h2h-text)']], 'B better: B white 800');
  assert.equal(ret.lean, 'var(--h2h-text)', 'leans to B in white');
  const tie = rows.find(r => r.label === 'Under pressure');
  assert.deepEqual([tie.a[1], tie.b[1], tie.gap, tie.lean], [500, 500, 'Level', 'var(--h2h-grey)'], 'a tie on the printed figures marks neither');
  const pct = rows.find(r => r.label === '2nd serve points won');
  assert.deepEqual([pct.a[0], pct.b[0], pct.gap], ['57.0%', '57.0%', 'Level']);
  assert.equal(rows.find(r => r.label === 'Dominance ratio').gap, '0.06', 'two decimals on the ratio');
  // a figure the file lacks: "—" in grey, no lean, no chip number
  const v = dnaView(); v.dna.extra.b[4] = null;
  const bp = ftfRows(h.call(h.dnaBlock, v)).find(r => r.label === 'Return games won');
  assert.deepEqual([bp.a[0], bp.a[1], bp.b[0], bp.b[2], bp.gap], ['27.5%', 500, '—', 'var(--h2h-grey)', '—']);
});
test('founder ruling 1 control: with H2H_FTF_LEAD_EMPHASIS off both figures are white 500 (the CLAUDE.md neutral display)', () => {
  const off = html.replace('const H2H_FTF_LEAD_EMPHASIS = true;', 'const H2H_FTF_LEAD_EMPHASIS = false;');
  assert.notEqual(off, html, 'the switch is one line in the page');
  const h = HX.load({ html: off });
  const serve = ftfRows(h.call(h.dnaBlock, dnaView())).find(r => r.label === 'Serve rating');
  assert.deepEqual([serve.a, serve.b], [['310', 500, 'var(--h2h-text)'], ['298', 500, 'var(--h2h-text)']]);
});

// ── the design's pill switch (xSw, DF L140–142 / L255 / L651 / L725) ─────────────────────────────────────────────
test('the pill switch (20 Nov §8): track --h2h-track + 10% edge, pad 2, gap 3; on = raised + 14% ring, 700 white; idle 600 grey; no blue', () => {
  const h = page();
  const out = h.call(h.xSw, [{ label: 'Last 52 weeks', on: true, hid: 4 }, { label: 'Career', hid: 5 }], 'r8');
  assert.match(out, new RegExp(`^<div class="x-sw" style="display:inline-flex; gap:3px; background:var\\(--h2h-track\\); border:1px solid ${esc(W(10))}; border-radius:8px; padding:2px;">`));
  assert.match(out, new RegExp(`<span class="seg x-sw__o on" data-hid="4" style="white-space:nowrap; padding:5px 12px; border-radius:6px; font-size:12px; font-weight:700; color:var\\(--h2h-text\\); background:var\\(--h2h-raised\\); border:1px solid ${esc(W(14))}; cursor:pointer;">Last 52 weeks</span>`));
  assert.match(out, /<span class="seg x-sw__o" data-hid="5" style="white-space:nowrap; padding:5px 12px; border-radius:6px; font-size:12px; font-weight:600; color:var\(--h2h-grey\); background:transparent; border:1px solid transparent; cursor:pointer;">Career<\/span>/);
  const ctx = h.call(h.xSw, [{ label: 'Hard', on: true, hid: 1 }], 'ctx');
  assert.match(ctx, /border-radius:9px; padding:2px;"><span class="seg x-sw__o on" data-hid="1" style="white-space:nowrap; padding:5px 11px; border-radius:7px; font-size:11px;/, 'the context switch: r9, 5/11, 11px');
  assert.ok(!/--h2h-blue|--bar|--link/.test(out + ctx), 'no blue');
});

// ── the page head, the sticky picker, the picked player (DF L25–200) ──────────────────────────────────────────────
function pageV(o) {
  return Object.assign({ coverageLine: 'a dash means not covered', aPicked: true, bPicked: true, aSearching: false, bSearching: false, aListOpen: false, bListOpen: false,
    a: { key: '2072', full: 'Jannik Sinner', short: 'J. Sinner', mono: 'JS', ctry: 'Italy', rankTxt: '#2', eloTxt: '2210' },
    b: { key: '2382', full: 'Carlos Alcaraz', short: 'C. Alcaraz', mono: 'CA', ctry: 'Spain', rankTxt: '#1', eloTxt: '2250' },
    hAChange: 1, hBChange: 2, hSwap: 3, ctxShow: true, nav: [{ id: 'h2h-model', label: 'Model' }, { id: 'h2h-rec', label: 'Meetings' }],
    showEmpty: false, showLoading: false, showBody: false, aResults: [], bResults: [] }, o || {});
}
test('the page head (CHANGES 2026-11-18 §2, DF L34–41): the header card — card tone, 1px 6% edge (20 Nov §8), r12, 18/26; title 24/800, one sentence 13 grey, the coverage note on the "?" — no caps line above the title', () => {
  const h = page({ SfCountryIoc: { of: c => ({ Italy: 'ITA', Spain: 'ESP' })[c] || null } });
  const c = h.call(h.pageHTML, pageV());
  const head = c.slice(0, c.indexOf('x-stick'));
  assert.match(head, /<div style="padding:30px 40px 6px;">\s*<div class="x-hcard" style="display:flex; align-items:center; justify-content:space-between; gap:16px; background:var\(--h2h-card\); border:1px solid color-mix\(in srgb, var\(--h2h-white\) 6%, transparent\); border-radius:12px; padding:18px 26px;">/);
  assert.match(head, /<h1 style="margin:0; font-size:24px; font-weight:800; letter-spacing:-0\.015em; line-height:1\.15;">Head to Head<\/h1>/);
  assert.match(head, /<div style="font-size:13px; color:var\(--h2h-grey\); text-wrap:pretty;">Two players, side by side on every measure\.<\/div>/);
  assert.match(head, /<span class="x-help" title="a dash means not covered" style="flex:none; width:16px; height:16px; border-radius:50%; border:1px solid color-mix\(in srgb, var\(--h2h-white\) 22%, transparent\);[^"]*font-family:'IBM Plex Mono',monospace; font-size:10px; font-weight:700;/, 'the "?" (20 Nov §8: 16px, 22% edge, Plex Mono 10/700) carries the coverage line (TEN-403 R1 nit wording)');
  assert.ok(!/text-transform:uppercase/.test(head.slice(0, head.indexOf('<h1'))), 'no caps line above the title');
  assert.ok(!/H2H_EYEBROW|h2h-eyebrow/.test(html));
});
test('the sticky picker (DF L45–200): sticky at top 0 on a page-tone band, card --h2h-card + 6% edge r14 16/18 with the sticky shadow; pickers 1fr 54px 1fr; jump links under a hairline, the section in view marked; no page-level filters (round 7)', () => {
  const h = page({ SfCountryIoc: { of: c => ({ Italy: 'ITA', Spain: 'ESP' })[c] || null } });
  const c = h.call(h.selectorBar, pageV());
  // the band = the website's page tone fading out (founder ruling 4, 2026-11-18; CHANGES 2026-11-18 §1), never --h2h-page
  assert.match(c, /^<div class="x-stick" style="position:sticky; top:0; z-index:30; padding:10px 40px 14px; background:radial-gradient\(ellipse 1500px 640px at var\(--x-gx, 720px\) var\(--x-gy, -120px\), var\(--glow\) 0%, color-mix\(in srgb, var\(--glow\) 0%, transparent\) 100%\) 0 0 \/ 100% 78% no-repeat, linear-gradient\(var\(--page\) 78%, color-mix\(in srgb, var\(--page\) 0%, transparent\)\);">/, 'the page tone + the page glow, so the band never cuts the glow (founder 2026-11-19)');
  assert.match(c, new RegExp(`<div id="h2h-sticky" style="background:var\\(--h2h-card\\); border:1px solid ${esc(W(6))}; border-radius:14px; padding:16px 18px; box-shadow:var\\(--h2h-shadow-sticky\\);">`));
  assert.match(c, /<div class="x-pick" style="display:grid; grid-template-columns:minmax\(0,1fr\) 54px minmax\(0,1fr\); gap:12px; align-items:start;">/);
  assert.equal(text(c), 'Change ITA Jannik Sinner RANK #2 ELO 2210 JS VS Change CA Carlos Alcaraz ESP RANK #1 ELO 2250 Model Meetings', 'A right-aligned (Change · country · name, avatar last), B mirrored');
  // the picked box (CHANGES 2026-11-17 §1; 20 Nov §8 edge 9% → 6%): --h2h-card + 6% edge r12 11/14; avatar 44, no ring (founder 2026-11-19); "Change" caps on a 10% border
  assert.match(c, new RegExp(`<div style="display:flex; align-items:center; gap:13px; background:var\\(--h2h-card\\); border:1px solid ${esc(W(6))}; border-radius:12px; padding:11px 14px; min-width:0;">`));
  // founder 2026-11-19: no blue / white ring in the picker (rings only where stats compare)
  assert.deepEqual([...c.matchAll(/class="x-av"[^>]*width:44px; height:44px;[^>]*box-shadow:([^;]+);/g)].map(m => m[1]), ['none', 'none']);
  assert.match(c, new RegExp(`<span class="seg x-change" data-hid="1" style="${esc(CAP)} border:1px solid ${esc(W(10))}; border-radius:7px; padding:5px 9px;">Change</span>`));
  // the jump links (data-h2h-jump) and the global switches, under a 6% hairline
  assert.match(c, new RegExp(`margin-top:14px; padding-top:12px; border-top:1px solid ${esc(W(6))};`));
  // round 7 (final design 2026-11-26): no page-level filters in the bar — each box carries its own chips
  assert.doesNotMatch(c, /class="x-sw|data-frchip|>Surface<|>Format</, 'no Surface / Format switch in the sticky bar');
  assert.doesNotMatch(slice('renderVals'), /ctxGroups/);
  // the section nav: the section in view carries data-navon="1" (default the Model card), the rest "0"; padding 6/10
  assert.match(c, /<span class="seg x-nav" data-h2h-jump="h2h-model" data-navon="1" style="white-space:nowrap; padding:6px 10px; border-radius:7px; font-size:12\.5px;">Model<\/span>/);
  assert.match(c, /<span class="seg x-nav" data-h2h-jump="h2h-rec" data-navon="0" style="white-space:nowrap; padding:6px 10px; border-radius:7px; font-size:12\.5px;">Meetings<\/span>/);
  h.state.navAt = 'h2h-rec';
  assert.deepEqual([...h.call(h.selectorBar, pageV()).matchAll(/data-h2h-jump="([^"]+)" data-navon="(\d)"/g)].map(m => m[1] + ':' + m[2]), ['h2h-model:0', 'h2h-rec:1'], 'the mark follows state.navAt');
  assert.match(CSS, /#h2hRoot \.x-nav\[data-navon="1"\] \{ font-weight: 700; color: var\(--h2h-text\); background: var\(--h2h-raised\);/, 'the marked section = a picked choice');
  // the stylesheet keeps the same stick + its hover states (the reference's style-hover)
  assert.match(CSS, /#h2hRoot \.x-stick \{ position: sticky; top: 0; z-index: 30; padding: 10px 40px 14px;\s*background: linear-gradient\(var\(--page\) 78%/);
  assert.match(CSS, /#h2hRoot \.x-change:hover \{ color: var\(--h2h-text\) !important;/);
});
test('the player menu (DF L81): raised, 10% edge, radius 12, padding 6, max-height 280; rows 28px initials · name 13.5/600 · "CTRY · rank"; empty = "No player matches that search."', () => {
  const h = page();
  const v = pageV({ aPicked: false, aSearching: true, aListOpen: true, aQuery: 'sin', aResults: [{ full: 'Jannik Sinner', mono: 'JS', tag: 'ITA · #2', sel: true, hid: 9 }], aNoResults: false });
  const c = h.call(h.selectorBar, v);
  assert.match(c, /<input class="h2hin" id="h2h-input-a" value="sin"[^>]*placeholder="Search player A…"[^>]*style="width:100%; box-sizing:border-box; background:var\(--h2h-inner\);[^"]*border-radius:12px; padding:22px 14px;[^"]*font-size:15px; font-weight:600;/);
  assert.match(c, new RegExp(`<div role="listbox" aria-label="Players" style="position:absolute; left:0; right:0; top:calc\\(100% \\+ 6px\\); background:var\\(--h2h-raised\\); border:1px solid ${esc(W(10))}; border-radius:12px; padding:6px; z-index:40; max-height:280px; overflow:auto;">`));
  assert.match(c, /role="option" aria-selected="true" data-hid="9"/, 'the current pick is the selected option');
  assert.match(text(c), /JS Jannik Sinner ITA · #2/);
  const none = h.call(h.selectorBar, pageV({ aPicked: false, aSearching: true, aListOpen: true, aResults: [], aNoResults: true }));
  assert.match(text(none), /No player matches that search\./);
});
test('section cards (20 Nov §8): --h2h-card, 1px 6% edge, r16, padding 24; head = title 18/800 + scope 12.5 grey; the Model boxes --h2h-inner r12 with the price mono 800', () => {
  const h = page();
  assert.equal(h.consts.X_SEC, `background:var(--h2h-card); border:1px solid ${W(6)}; border-radius:16px; padding:24px; display:flex; flex-direction:column;`);
  const head = h.call(h.xHead, 'Latest news', 'Both players · newest first', null);
  assert.equal(head, '<div style="display:flex; align-items:center; flex-wrap:wrap; gap:6px 12px;"><span style="font-size:18px; font-weight:800; letter-spacing:-0.01em; color:var(--h2h-text);">Latest news</span><span style="font-size:12.5px; color:var(--h2h-grey);">Both players · newest first</span></div>');
  const m = { priced: true, aMono: 'JS', bMono: 'CA', aName: 'J. Sinner', bName: 'C. Alcaraz', aPrice: '2.90', bPrice: '1.45', foot: null };
  const card = h.call(h.modelCard, { model: m, a: {}, b: {} });
  assert.ok(card.startsWith(`<div id="h2h-model" class="x-sec" data-h2h-model="priced" style="background:var(--h2h-card); border:1px solid ${W(6)}; border-radius:16px; padding:24px; display:flex; flex-direction:column; gap:16px;">`), '20 Nov §8: every section card 1px 6%, r16, padding 24, gap 16');
  assert.equal((card.match(new RegExp(`border:1px solid ${esc(W(6))}; background:var\\(--h2h-card\\); border-radius:12px; padding:18px 20px;`, 'g')) || []).length, 2, 'two card-tone boxes (CHANGES 2026-11-17 §1; the Model cards keep the 6% edge)');
  // round 7: ONE card "Model and playing style" — title 18/800 (h2), the box's chips at the right, no subtitle
  assert.match(card, /<h2 style="margin:0; font-size:18px; font-weight:800; letter-spacing:-0\.01em; color:var\(--h2h-text\);">Model and playing style<\/h2><\/div><div data-frow="model"/);
  assert.deepEqual([...card.matchAll(/data-frchip="([^"]+)"[^>]*><span>([^<]+)<\/span>/g)].map(x => x[1] + ':' + x[2]), ['Surface:All surfaces', 'Format:Best of 3', 'Window:Last 52 weeks'], 'chips Surface · Format · Window, defaults All surfaces · Best of 3 · Last 52 weeks');
  assert.doesNotMatch(card, /Where the model expects/, 'no grey subtitle under the title');
  // founder fix 2 (2026-11-26): a Surface / Format pick never flashes the prices blue — white always, no transition, no timer
  h.state.flash = true;
  const after = h.call(h.modelCard, { model: m, a: {}, b: {} });
  assert.match(after, /data-h2h-price style="[^"]*font-weight:800; color:var\(--h2h-text\);/);
  assert.doesNotMatch(after, /--h2h-blue|transition:color/);
  assert.doesNotMatch(slice('setCtx'), /setTimeout|flash|520/, 'setCtx repaints at once');
  // the thin-data caveat is a section-tone card, never an amber banner
  assert.match(slice('bodyHTML'), /\$\{v\.hasCaveat \? `<div style="display:flex; align-items:flex-start; gap:12px; background:var\(--h2h-card\); border:1px solid color-mix\(in srgb, var\(--h2h-white\) 6%, transparent\); border-radius:12px;/);
});
test('colour and type (foundation): the rebuilt page reads only --h2h-* tokens — no Ring blue, link blue, amber or surface colours; every weight in {400, 500, 600, 700, 800}', () => {
  const rebuilt = html.slice(html.indexOf('==== H2H REBUILD'), html.indexOf('window.H2HPage = {', html.indexOf('==== H2H REBUILD')));
  for (const bad of ['--bar', '--bar-2', '--viz-lead', '--viz-second', '--link', '--hot-dot', '--amber', '--viz-amber', '--viz-hard', '--viz-clay', '--viz-grass', '--open-card', '--viz-white-lead', '--white-bar']) {
    assert.equal(rebuilt.includes('var(' + bad + ')'), false, `${bad} used in the rebuilt renderers`);
    assert.equal(CSS.includes('var(' + bad + ')'), false, `${bad} used in h2h-page.css`);
  }
  for (const w of (rebuilt + CSS).matchAll(/font-weight:\s*(\d+)/g)) assert.ok(['400', '500', '600', '700', '800'].includes(w[1]), 'weight ' + w[1]);
  assert.doesNotMatch(rebuilt + CSS, /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?=[;\s)"'])|rgba?\(/, 'no raw colour (tools/lint-raw-colours.mjs covers it too)');
});
