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
// The CSS block group a owns (between its header comment and the next top-level comment).
const CSS = (() => {
  const a = html.indexOf('/* TEN-402 step 8 (group a)');
  const b = html.indexOf('\n  /* Playing styles */', a);
  assert.ok(a > 0 && b > a, 'TEN-402 (a) CSS block not found');
  return html.slice(a, b);
})();
const rule = sel => {
  const i = CSS.indexOf(sel + '{');
  assert.ok(i >= 0, `CSS rule ${sel} not found`);
  return CSS.slice(i, CSS.indexOf('}', i) + 1);
};
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
  assert.match(slice('emptyState'), /\$\{v\.suggestions\.length \? `<div class="h2h-sugg">/, 'the row is drawn only when there is a pair');
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
test('H6: BSP Intel / ASAP items join under their own key; nothing for either player → no card', () => {
  const intel = () => [{ kind: 'intel', intelId: 'n1', ts: NOW - 3600e3, player: 'C. Alcaraz', playerKey: '2382', title: 'Intel on Alcaraz', bodyParas: ['x'], srcRaw: 'BSP Consult Intel' }];
  const newsFor = newsHarness([], { newsIntelItems: intel });
  assert.deepEqual(newsFor(ALC, NOW).map(x => x.title), ['Intel on Alcaraz']);
  assert.deepEqual(newsFor(SIN, NOW), []);
  assert.match(slice('newsCard'), /if \(!n \|\| n\.empty\) return '';/, 'an empty feed draws no card');
});
test('H6: the card interleaves A, B, A, B … and shows at most H2H_NEWS_MAX rows', () => {
  const state = { newsOpen: null };
  const nv = new Function('newsFor', 'state', 'bindH', 'setState', sliceConst('H2H_NEWS_MAX') + slice('newsVals') + '\nreturn newsVals;')(
    p => [1, 2, 3, 4, 5].map(i => ({ id: p.key + i, who: p.short })), state, () => 0, () => {});
  const v = nv({ key: 'a', short: 'A' }, { key: 'b', short: 'B' });
  assert.deepEqual(v.feed.map(x => x.id), ['a1', 'b1', 'a2', 'b2', 'a3', 'b3']);
});

// ── Data 3 / L-default H4: Stennisfy Model = the Model page's output; Elo = the weekly Elo ───────────────────────────
function model({ out, matches, startMs, elo }) {
  const src = slice('weeklyElo') + slice('modelOutputFor') + slice('modelGate') + slice('modelVals');
  return new Function('modelOutput', 'aOddsStartMs', 'DV', 'fn', src + '\nreturn modelVals;')(
    { matches: out }, m => startMs[m.id], n => (n === 'matches' ? matches : null),
    n => (n === 'tourxRating' ? (full => (elo[full] != null ? String(elo[full]) : null)) : null));
}
const A = { key: '10', full: 'A. One', short: 'A. One', mono: 'AO' }, B = { key: '20', full: 'B. Two', short: 'B. Two', mono: 'BT' };
const OUT = st => ({ ok: true, stage1: { baseState: { state: st } }, stage3: { fair: { p1: { prob: 0.6, odds: 1.67 }, p2: { prob: 0.4, odds: 2.5 } } } });
const nowPlus = h => Date.now() + h * 3600e3;

test('H4: the price is the Model page\'s own fair odd (point price), oriented to A, under the Model page\'s display gate', () => {
  const matches = [{ id: 'm1', p1Key: 20, p2Key: 10 }];                       // A is the match's p2
  const v = model({ out: { m1: OUT(2) }, matches, startMs: { m1: nowPlus(5) }, elo: { 'A. One': 2000, 'B. Two': 2100 } })(A, B);
  assert.equal(v.priced, true);
  assert.equal(v.aPrice, '2.50'); assert.equal(v.bPrice, '1.67');
  // Elo line: weekly Elo gap 100 → 1/(1+10^(-100/400)) = 64% for B; the model has B at 60%
  assert.deepEqual(v.foot, { gap: '100', pct: '64', fav: 'B. Two', model: '60' });
});
test('H4: no runnable / no confirmed / started / no board match → the empty line, never a price of our own', () => {
  const matches = [{ id: 'm1', p1Key: 10, p2Key: 20 }];
  const elo = { 'A. One': 2000, 'B. Two': 2100 };
  const cases = [
    [{ m1: OUT(3) }, nowPlus(5), /confirmed market line/],                        // no Pinnacle line (state 3)
    [{ m1: OUT(2) }, nowPlus(31), /confirmed market line/],                       // outside 30 h
    [{ m1: OUT(2) }, nowPlus(-1), /has started/],                                 // in play
    [{ m1: { ok: false } }, nowPlus(5), /hasn’t produced a price/],               // model could not run
  ];
  for (const [out, st, re] of cases) {
    const v = model({ out, matches, startMs: { m1: st }, elo })(A, B);
    assert.equal(v.priced, false); assert.equal(v.aPrice, '—'); assert.equal(v.bPrice, '—'); assert.match(v.emptyText, re);
    assert.equal(v.foot.model, null, 'no model % without a model price');
  }
  const none = model({ out: {}, matches: [], startMs: {}, elo })(A, B);
  assert.equal(none.priced, false); assert.match(none.emptyText, /no price for this pairing/);
  // no weekly Elo for one player → no Elo line (never an estimate)
  assert.equal(model({ out: {}, matches: [], startMs: {}, elo: { 'A. One': 2000 } })(A, B).foot, null);
  // the retired page-side Elo blend is gone: the model card computes no price itself
  assert.doesNotMatch(slice('modelVals'), /Math\.pow\(10, -\(be/);
  assert.doesNotMatch(html.slice(H2H_AT, H2H_AT + 200000), /MODEL_ELO_W/);
});
test('Data 3: the header Elo is the weekly Elo Database → Ratings shows (tourxRating), "—" when not held', () => {
  const rv = slice('renderVals');
  assert.match(rv, /eloTxt: weeklyElo\(p\.full\) \|\| '—'/);
  assert.match(slice('weeklyElo'), /fn\('tourxRating'\)/);
});

// ── Playing style DNA (Data 4) ────────────────────────────────────────────────────────────────────────────────────
test('DNA: the windows are the file\'s two scopes, labelled by the data ("Since Mar 2024", never "Career")', () => {
  const m = /const DNA_WIN = \{ w52: \{ scope: 'last52', label: 'Last 52 weeks'[^\n]*\n\s*since: \{ label: '([^']+)', scope: 'sinceBase'/.exec(html);
  assert.ok(m, 'DNA_WIN not found');
  assert.equal(m[1], 'Since Mar 2024');
  assert.notEqual(m[1], 'Career');
  // Under pressure has no since-Mar-2024 figure (founder Q14); Δ only on the last-52-weeks view
  const dv = slice('dnaVals');
  assert.match(dv, /const upSince = W\.scope === 'sinceBase' && ax\.key === 'underPressure';/);
  assert.match(dv, /delta: \(has && W\.scope === 'last52' && d\.deltas\)/);
});
test('DNA (item 6 + H8): radar A solid white + 12% fill, B white 85% dashed; profile bars white lead / 70% second', () => {
  const card = slice('dnaCard');
  assert.match(card, /class="h2h-poly-a" points="\$\{aP\}" fill="color-mix\(in srgb, var\(--text\) 12%, transparent\)" stroke="var\(--text\)" stroke-width="1\.75"/);
  assert.match(card, /class="h2h-poly-b" points="\$\{bP\}" fill="none" stroke="color-mix\(in srgb, var\(--text\) 85%, transparent\)" stroke-width="1\.5" stroke-dasharray="4 3"/);
  assert.doesNotMatch(card, /var\(--bar\)|var\(--viz-lead\)/, 'no blue on the radar');
  assert.match(rule('#h2hRoot .h2h-prow__bar'), /background:var\(--viz-white-lead\)/);
  assert.match(rule('#h2hRoot .h2h-prow__bar.lo'), /background:color-mix\(in srgb, var\(--viz-white-lead\) 70%, transparent\)/);
  assert.match(rule('#h2hRoot .h2h-prow__trk'), /background:var\(--viz-track\)/);
  // a below-floor player draws no shape
  assert.match(card, /const poly = s => \(!s\.d\.ok \? '' :/);
});

// ── item 4: the darker track (h2hSeg = the site helper sfSegHtml) ─────────────────────────────────────────────────
test('item 4: h2hSeg renders the site darker track — selected --inner + --edge-10 white 700, idle grey, no blue', () => {
  const sfSegHtml = new Function(slice('sfSegHtml', false) + '\nreturn sfSegHtml;')();
  const h2hSeg = new Function('E', 'fn', slice('h2hSeg') + '\nreturn h2hSeg;')(E, n => (n === 'sfSegHtml' ? sfSegHtml : null));
  const out = h2hSeg([{ label: 'Last 52 weeks', on: true, hid: 4 }, { label: 'All', n: 13, hid: 5 }], 'md', 'DNA window');
  assert.match(out, /^<div class="sf-seg h2h-seg h2h-seg--md" role="tablist" aria-label="DNA window">/);
  assert.match(out, /class="sf-seg__opt on" aria-selected="true" data-hid="4">Last 52 weeks<\/button>/);
  assert.match(out, /class="sf-seg__opt" aria-selected="false" data-hid="5">All <span class="h2h-seg__n">13<\/span><\/button>/);
  const site = html.slice(html.indexOf('\n.sf-seg{'), html.indexOf('\n.sf-seg--mono .sf-seg__opt{'));
  assert.match(site, /\.sf-seg\{[^}]*background:var\(--card\); border:1px solid var\(--edge-6\)/);
  assert.match(site, /\.sf-seg__opt\.on\{ background:var\(--inner\); border-color:var\(--edge-10\); color:var\(--text\); font-weight:700; \}/);
  assert.match(site, /\.sf-seg__opt\{[^}]*color:var\(--text-label\)/);
  // page sizes measured on the reference: header 11px 5×11 r7 (track r9), tabs 12px 5×12 r6 (track r8)
  assert.match(rule('#h2hRoot .h2h-seg--sm .sf-seg__opt'), /font-size:11px; padding:5px 11px; border-radius:7px;/);
  assert.match(rule('#h2hRoot .h2h-seg--md .sf-seg__opt'), /font-size:12px; padding:5px 12px; border-radius:6px;/);
});

// ── items 1, 2, 3, 9, 10, 11: surfaces and type (CSS, the rule someone applies) ───────────────────────────────────
// TEN-403 (founder shell refresh) overrides step 8 item 1's header values (29 / 22×26 / caps line): the card is the
// shared 35b header, controls variant — its values are locked in test-ten403-header.mjs; this page keeps sticky + shadow.
test('item 1 (TEN-403): the header card is the 35b .sfh--ctl card, sticky with its shadow; pickers under the row', () => {
  assert.match(rule('#h2hRoot .h2h-stick'), /position:sticky; top:30px; z-index:30;/);
  const head = rule('#h2hRoot .h2h-head');
  assert.match(head, /box-shadow:var\(--top-light\), 0 12px 28px /);
  assert.doesNotMatch(head, /padding|font-size|border-radius|background/, 'the page restyles the 35b card');
  const bar = slice('selectorBar');
  assert.match(bar, /<div class="sfh sfh--ctl h2h-head">\s*<div class="sfh__row"><div class="sfh__text">\s*<h1 class="sfh__title">Head to Head<\/h1>/);
  assert.ok(bar.indexOf('class="h2h-pick"') > bar.indexOf('</div></div>'), 'the pickers sit under the row');
  // pickers: search control = --inner, no edge; a picked player = panel (--card + 1px --edge-6); "Change" grey → white on hover
  assert.match(rule('#h2hRoot .h2hin.h2h-search'), /background:var\(--inner\); border:1px solid transparent;/);
  assert.match(rule('#h2hRoot .h2h-pcard'), /background:var\(--card\); border:1px solid var\(--edge-6\);/);
  assert.match(rule('#h2hRoot .h2h-change'), /font-size:10\.5px; font-weight:700; letter-spacing:0\.10em; text-transform:uppercase;[\s\S]*color:var\(--text-label\)/);
  assert.match(CSS, /#h2hRoot \.h2h-change:hover, #h2hRoot \.h2h-change:focus-visible\{ color:var\(--text\);/);
});
test('item 1 (TEN-403): no caps label line above the title (the 35b header drops it)', () => {
  assert.doesNotMatch(html, /H2H_EYEBROW|h2h-eyebrow/);
  const bar = slice('selectorBar');
  assert.doesNotMatch(bar.slice(0, bar.indexOf('<h1 class="sfh__title">')), /h2h-cap/);
});
test('item 2: section cards are card tone with no outline; section titles = caps grey on a 6% hairline (sectionHead)', () => {
  assert.match(rule('#h2hRoot .h2h-card'), /background:var\(--card\); border:1px solid transparent; box-shadow:var\(--top-light\);/);
  assert.match(rule('#h2hRoot .h2h-shead__rule.on'), /background:var\(--edge-6\);/);
  assert.match(rule('#h2hRoot .h2h-cap'), /font-size:10\.5px; font-weight:700; letter-spacing:0\.10em; text-transform:uppercase; color:var\(--text-label\);/);
  const sh = new Function('E', slice('sectionHead') + '\nreturn sectionHead;')(E);
  assert.match(sh('Latest news'), /<span class="h2h-cap">Latest news<\/span><\/span>\s*<span class="h2h-shead__rule on"><\/span>/);
  assert.match(sh('DNA', { html: '<i>x</i>' }, { rule: false }), /<span class="h2h-shead__rule"><\/span><span class="h2h-shead__r h2h-shead__r--html"><i>x<\/i><\/span>/);
  assert.match(sh('X', '17 meetings'), /<span class="h2h-shead__r">17 meetings<\/span>/);
  // the caveat and the Model are section cards too (no amber banner, no blue gradient)
  assert.match(slice('bodyHTML'), /<div class="h2h-card h2h-caveat">\s*\$\{sectionHead\('Thin data coverage'\)\}/);
  assert.match(slice('modelCard'), /<div class="h2h-card h2h-model"/);
});
test('item 3 + 7: Model boxes are panels (--card + 1px --edge-6); prices mono white', () => {
  assert.match(rule('#h2hRoot .h2h-model__box'), /background:var\(--card\); border:1px solid var\(--edge-6\);/);
  assert.match(rule('#h2hRoot .h2h-model__price'), /font-family:var\(--font-nums\); font-size:28px; font-weight:800;[^}]*color:var\(--text\);/);
});
test('item 9: player menus are the compact site menu — card + 10% edge, radius 10, ~6 rows, --inner hover, white tick', () => {
  const menu = rule('#h2hRoot .h2h-menu');
  assert.match(menu, /max-height:280px; overflow-y:auto; padding:4px;/);
  assert.match(menu, /background:var\(--card\); border:1px solid var\(--edge-10\); border-radius:10px; box-shadow:var\(--shadow-menu\);/);
  assert.match(rule('#h2hRoot .h2h-mrow:hover'), /background:var\(--inner\);/);
  assert.match(rule('#h2hRoot .h2h-mrow.sel'), /background:var\(--selected\);/);
  assert.match(rule('#h2hRoot .h2h-mtick'), /color:var\(--text\);/);
  assert.match(slice('dropdown'), /\$\{r\.sel \? '<span class="h2h-mtick">✓<\/span>' : ''\}/);
});
test('item 10 + 11: toggle words and the news caret are white; no blue, amber or surface colour in group a\'s CSS', () => {
  assert.match(rule('#h2hRoot .h2h-toggle'), /color:var\(--text\);/);
  assert.match(rule('#h2hRoot .h2h-news-car'), /color:var\(--text\);/);
  for (const bad of ['--bar', '--bar-2', '--viz-lead', '--viz-second', '--link', '--hot-dot', '--amber', '--viz-amber', '--viz-hard', '--viz-clay', '--viz-grass', '--open-card']) {
    assert.equal(CSS.includes('var(' + bad + ')'), false, `${bad} used in the TEN-402 (a) CSS`);
  }
  for (const w of CSS.matchAll(/font-weight:(\d+)/g)) assert.ok(['400', '500', '600', '700', '800'].includes(w[1]), 'weight ' + w[1]);
  // the empty state's suggestion chips are clickable tiles (7% → hover --tile-hover + 16%)
  assert.match(rule('#h2hRoot .h2h-chip'), /background:var\(--card\);\s*border:1px solid var\(--edge-7\);/);
  assert.match(CSS, /#h2hRoot \.h2h-chip:hover, #h2hRoot \.h2h-chip:focus-visible\{ background:var\(--tile-hover\); border-color:var\(--edge-16\);/);
});
