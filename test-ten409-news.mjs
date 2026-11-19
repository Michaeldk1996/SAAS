// TEN-409 step 10 (founder 2026-10-09): the News page redesign. The SHIPPED News block of bsp-consult-dashboard.html is
// sliced out and executed against fixture feeds with a stub DOM; every check names the mutation that turns it red.
// Rules: .claude/rules/news.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN409_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const BLOCK = (() => {
  const a = html.indexOf('// TEN-409 step 10 (founder 2026-10-09): one feed'), b = html.indexOf('/* ---------- PLAYING STYLES ---------- */');
  assert.ok(a > 0 && b > a, 'News JS block');
  return html.slice(a, b);
})();
const CSS = readFileSync(join(HERE, 'news-page.css'), 'utf8');   // News v2: every style is in news-page.css
const MARKUP = (() => { const a = html.indexOf('<div class="tabpage" data-page="news">'); return html.slice(a, html.indexOf('<!-- TENNIS EDGE MODEL PAGE', a)); })();

function el(id) {
  return { id, innerHTML: '', value: '', _cls: new Set(), attrs: {},
    classList: { add(c) { this._o._cls.add(c); }, toggle(c, on) { if (on) this._o._cls.add(c); else this._o._cls.delete(c); }, contains(c) { return this._o._cls.has(c); } },
    setAttribute(k, v) { this.attrs[k] = v; }, querySelector: () => null, querySelectorAll: () => [] };
}
function load(opts = {}) {
  const els = {};
  const get = id => { if (!els[id]) { els[id] = el(id); els[id].classList._o = els[id]; } return els[id]; };
  const doc = { readyState: 'complete', getElementById: get, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => { let t = ''; return { set textContent(v) { t = v; }, get innerHTML() { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } }; } };
  const store = { 'stennisfy.tz': 'UTC' };
  const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const f = new Function('document', 'localStorage', 'fetch', 'opts', 'TP', `
    const playerProfiles = opts.profiles || {};
    const window = { BSP: opts.admin ? { currentUser: () => ({ uid: 'admin' }) } : null, ADMIN_CONFIG: { ADMIN_UIDS: ['admin'] }, confirm: () => true }; const BSP = window.BSP;
    const TOURNAMENT_CATALOG = ['Australian Open', 'French Open', 'Roland Garros', 'Wimbledon', 'Shanghai', 'Beijing', 'Tokyo', 'Montreal', 'Toronto'].map(name => ({ name }));
    const SF_EVENT_NAMES = { 'Australian Open': 'Australian Open', 'French Open': 'Roland Garros', 'Roland Garros': 'Roland Garros', Wimbledon: 'Wimbledon', Shanghai: 'Shanghai Masters', Beijing: 'China Open',
      Tokyo: 'Japan Open', Montreal: 'Canadian Open', Toronto: 'Canadian Open' };
    function sfEventKey(raw){ if (TOURNAMENT_CATALOG.some(t => t.name === raw)) return raw; const k = Object.keys(SF_EVENT_NAMES).find(x => SF_EVENT_NAMES[x] === raw); return k || null; }
    function tourxEventName(k){ return SF_EVENT_NAMES[k] || k; }
    function tourxConditionRegistry(){ return [{ name: 'Shanghai' }, { name: 'Wimbledon' }, { name: 'Beijing' }]; }
    function psOpenProfile(){} const tourxState = {}; let asapSignals = {};
    const tournamentProfiles = opts.tp || TP();
    const setInterval = () => 0, clearInterval = () => {};
    let playerIndex = opts.index || [];
    function escapeHtml(s){ return String(s); }
    function newsPlayerFor(){ throw new Error('the News page read a headline for a name'); }
    ${BLOCK}
    _intelNotes = opts.intel || [];
    return { set data(v) { _newsData = v; }, set state(v) { _newsState = v; }, set cats(v) { _newsCats = v; }, set tour(v) { _newsTourKey = v; },
      set ticker(v) { _newsTicker = v; }, set hours(v) { _newsRangeHours = v; }, set q(v) { _newsSearch = v; }, set view(v) { _newsView = v; },
      renderNews, newsToggleCat, newsSetView, newsWiden, newsToggleRow, newsWireItems, newsPageIntelItems, newsTickerItems, newsResetFilters, newsToggleMore,
      newsMenuToggle, newsMenuPick, intelPick, intelOnText, intelSetCat, intelStartEdit, intelCanPublish, intelPlayerHits, newsToggleComposer,
      set composerOpen(v) { _composerOpen = v; }, get hoursNow() { return _newsRangeHours; }, get cats() { return _newsCats; } };
  `);
  const api = f(doc, ls, () => Promise.reject(new Error('offline')), opts, TP);
  return { api, get: id => get(id).innerHTML, els, store };
}
const H = 3600e3;
// tournament-profiles.json stand-in: one dated edition per event. Shanghai is on now, Beijing / Tokyo ended within the last
// fortnight, Wimbledon / the Australian Open / Montreal + Toronto / Roland Garros are months away (R2 14-day window).
const iso = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const Y = new Date().getUTCFullYear();
const ed = (season, s, e) => ({ season: String(season), matches: [{ date: s }, { date: e }] });
const TP = () => ({
  Shanghai: { allEditionMatches: [ed(Y, iso(-5), iso(5))] }, Beijing: { allEditionMatches: [ed(Y, iso(-12), iso(-6))] },
  Tokyo: { allEditionMatches: [ed(Y, iso(-13), iso(-7))] }, Wimbledon: { allEditionMatches: [ed(Y, iso(-100), iso(-87))] },
  'Australian Open': { allEditionMatches: [ed(Y, iso(-260), iso(-246))] }, 'Roland Garros': { allEditionMatches: [ed(Y, iso(-130), iso(-116))] },
  Montreal: { allEditionMatches: [ed(Y, iso(-60), iso(-54))] }, Toronto: { allEditionMatches: [ed(Y, iso(-60), iso(-54))] },
});
const ts = hAgo => new Date(Date.now() - hAgo * H).toISOString().replace('T', ' ').replace('Z', '');
const GEN = new Date(Date.now() - 3 * H); GEN.setUTCSeconds(7);
const art = (k, key, hAgo, title, o = {}) => Object.assign({ news_key: String(k), player_key: key, player_name: key ? 'P. ' + key : null, published_at: ts(hAgo), title,
  content: 'One.\n\nTwo.', sources: ['ubitennis'], tournament_name: 'Shanghai' }, o);
const card = (h, id) => { const i = h.indexOf(`data-id="${id}"`); const e = h.indexOf('</article>', i); return h.slice(i, e > 0 ? e : undefined); };
// tournament_name is deliberately wrong on every row: the page must never read it (R1 tournament rule).
const FEED = () => ({ generatedAt: GEN.toISOString(), articles: [
  art(1, '2382', 2, 'Alcaraz eases through in straight sets in Shanghai', { tournament_name: 'Wimbledon' }),
  art(2, '2072', 5, 'Sinner withdraws with a knee injury', { tournament_name: 'US Open', content: 'He was due to play his opener in Beijing on Tuesday.\n\nTwo.' }),
  art(3, null, 1, 'Djokovic wins the title in Beijing'),                                   // tournament / headline only — never shown
  art(4, '1905', 100, 'Djokovic draw released for Beijing', { tournament_name: 'Halle', content: 'Body mentions Monaco.' }),
] });
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
function page(opts = {}, set = {}) {
  const P = load(opts); P.api.data = 'feed' in opts ? opts.feed : FEED(); P.api.state = opts.state || 'ok';
  Object.assign(P.api, set); P.api.renderNews(); return P;
}
const stats = P => [...P.get('newsHeaderStats').matchAll(/<span class="nx-stat-v">([^<]*)<\/span><span class="nx-stat-l">([^<]+)</g)].map(m => [m[2], m[1]]);


// Data 2 — mutation: restore `|| newsPlayerFor(a.title)` / drop the player_key filter in newsWireItems.
test('Data 2: only player-attributed articles show; the page never reads a headline for a name', () => {
  const list = text(page().get('newsList'));
  assert.ok(/Alcaraz eases/.test(list) && /Sinner withdraws/.test(list) && /Djokovic draw/.test(list));
  assert.ok(!/Djokovic wins the title/.test(list), 'a tournament-only article came back');
});

// Data 3 — mutation: any "Sample" text in the page code or markup.
test('Data 3: no sample article anywhere in the News page code or markup', () => {
  assert.ok(!/Sample/.test(BLOCK) && !/Sample/.test(MARKUP) && !/SAMPLE_NEWS|STENNISFY_NEWS/.test(BLOCK));
  const P = page({ feed: { generatedAt: GEN.toISOString(), articles: [] } });
  assert.match(text(P.get('newsList')), /^No articles available\. Last updated \d\d:\d\d:07 ?\.$/);
});

// v2 §2 — mutation: Updated from `new Date()`; Players counted per article; a zero for an unsourced value.
test('Header pills: Articles after every filter, Players distinct, Updated = the feed refresh, never the clock', () => {
  const P = page(), hm = GEN.toISOString().slice(11, 16);
  assert.deepEqual(stats(P), [['Articles', '3'], ['Players', '3'], ['Updated', hm]]);
  const now = new Date().toISOString().slice(11, 16);
  if (now !== hm) assert.notEqual(stats(P)[2][1], now, 'Updated reads the clock');
  assert.deepEqual(stats(page({}, { cats: ['Withdrawals & Injuries'] })).slice(0, 2).map(s => s[1]), ['1', '1']);
  assert.deepEqual(stats(page({ feed: { articles: FEED().articles } }))[2], ['Updated', '—']);
  const U = page({ feed: null, state: 'unavailable' });
  assert.deepEqual(stats(U).map(s => s[1]), ['—', '—', '—']);
  assert.match(text(U.get('newsList')), /^News feed unavailable\. Last checked \d\d:\d\d:\d\d ?\.$/);
});

// v2 §7 empty state — mutation: always offer "Try a wider date range." / offer Clear search without a search.
test('Empty state: names the filter, widens only when a wider window has results, Clear search only with a search', () => {
  const fw = FEED(); fw.articles[0].title = 'Alcaraz beats Rune in Shanghai';   // the only Tour News left is the 100 h-old draw article
  const W = page({ feed: fw }, { hours: 6, cats: ['Tour News'] });
  assert.equal(text(W.get('newsList')), 'No articles match these filters. No Tour News articles in the last 6 hours. Try a wider date range.');
  W.api.newsWiden(); assert.equal(W.api.hoursNow, 168, 'widen jumps to the first window with results');
  const Q = page({ feed: fw }, { hours: 6, q: 'draw released' });
  assert.equal(text(Q.get('newsList')), 'No articles match these filters. No results for “draw released” in the last 6 hours. Try a wider date range. Clear search');
  const N = page({}, { hours: 6, cats: ['Match Reports'], q: 'zzz' });
  assert.equal(text(N.get('newsList')), 'No articles match these filters. No results for “zzz”. Clear search');
  assert.match(page({}, { hours: 6, cats: ['Match Reports'] }).get('newsList'), /class="nx-card nx-empty"/, 'the empty state is a section card');
});

// v2 §2 categories — mutation: multi-select back; Draws & Schedules back; a click on the active one not returning to All.
test('Four categories, single select; Draws & Schedules arrives as Tour News', () => {
  const P = page();
  assert.deepEqual([...P.get('newsChips').matchAll(/>([^<]+)<\/button>/g)].map(m => m[1].replace('&amp;', '&')), ['All', 'Match Reports', 'Quotes', 'Withdrawals & Injuries', 'Tour News']);
  P.api.newsToggleCat('Withdrawals & Injuries'); P.api.newsToggleCat('Tour News');
  assert.deepEqual(P.api.cats, ['Tour News'], 'a click replaces the category');
  assert.equal((P.get('newsChips').match(/nx-tab nx-seg on/g) || []).length, 1);
  P.api.newsToggleCat('Tour News'); assert.deepEqual(P.api.cats, [], 'a click on the active one returns to All');
  assert.match(card(P.get('newsList'), 'w4'), /Tour News/, 'a draw article reads Tour News');
  assert.ok(!/Draws &amp; Schedules|Draws & Schedules/.test(P.get('newsList') + P.get('newsChips')));
});

// v2 §2 menus + Reset — mutation: every event listed; Reset shown with no filter on; Reset not clearing.
test('Tournament menu lists events in the window; filters combine; Reset filters clears them all', () => {
  const P = page({}, { hours: 24 });
  assert.deepEqual([...P.get('newsTourFilter').matchAll(/data-v="[^"]*" onclick="[^"]*">([^<]+)<span/g)].map(m => m[1]), ['All tournaments', 'China Open', 'Shanghai Masters']);
  assert.match(P.get('newsTourFilter'), /class="nx-trig nx-seg"[^>]*>All tournaments<span class="nx-chev"/);
  assert.match(P.get('newsResetHost'), /Reset filters/, 'a window other than 7 days shows Reset');
  assert.equal(page().get('newsResetHost'), '', 'no filter: no Reset');
  const C = page({}, { tour: 'china-open', cats: ['Withdrawals & Injuries'], q: 'knee' });
  assert.equal(stats(C)[0][1], '1');
  C.api.newsResetFilters(); assert.equal(stats(C)[0][1], '3'); assert.equal(C.get('newsResetHost'), '');
  assert.match(P.get('newsRange'), /Last 7 days|Last 24h/);
});

test('Search covers title, players, tournament and body (not the source)', () => {
  assert.equal(stats(page({}, { q: 'monaco' }))[0][1], '1');
  assert.equal(stats(page({}, { q: 'shanghai masters' }))[0][1], '1');
  assert.equal(stats(page({}, { q: 'P. 2072' }))[0][1], '1');
  assert.equal(stats(page({}, { q: 'ubitennis' }))[0][1], '0');
});

test('Reading / Compact persists to stennisfy.newsView; Compact = one card per day of rows', () => {
  const P = page(); P.api.newsSetView('compact');
  assert.equal(P.store['stennisfy.newsView'], 'compact');
  assert.match(P.get('newsList'), /class="nx-card nx-cl"><div class="nx-wr"/);
  assert.match(P.get('newsViewSw'), /class="nx-tab nx-seg on"[^>]*>Compact</);
});

// v2 §3 — mutation: a kind pill, a source or a translation note back in Reading; the wire time back (R2 card 28bd8fc2).
test('Reading card: one head line (avatars · names · sub line), no source in Reading, no time on a feed article', () => {
  const f = FEED(); f.articles[0].sources = ['espn-tennis']; f.articles[0].title = 'Alcaraz didn&#039;t drop a set in Shanghai';
  const h = page({ feed: f }).get('newsList'), c = card(h, 'w1');
  assert.match(c, /^data-id="w1"><div class="nx-ahead"><span class="nx-avs"><span class="nx-av">P<\/span><\/span><div class="nx-names"><span class="nx-nl">P\. 2382<\/span><span class="nx-sl">Tour News · Shanghai Masters<\/span>/);
  assert.ok(!/ESPN|espn/.test(c), 'no source on a Reading card');
  assert.match(c, /didn't drop a set/, 'HTML codes decoded');
  assert.match(c, /class="nx-title" data-news-tip="Added to feed \d\d [A-Z][a-z]{2} \d\d:\d\d">/);
  const day = h.slice(0, h.indexOf('<article'));
  assert.match(day, /<span class="nx-day-l">\d\d [A-Z]{3} \d{4}<\/span><span class="nx-day-n">\d+ articles?<\/span>/);
});

// v2 §3b — mutation: show 2 paragraphs; Read more under 6 paragraphs.
test('Read more: above 5 paragraphs the card shows 4', () => {
  const f = FEED(); f.articles[0].content = Array.from({ length: 6 }, (_, i) => 'Para ' + i).join('\n\n'); f.articles[1].content = Array.from({ length: 5 }, (_, i) => 'Line ' + i).join('\n\n');
  const P = page({ feed: f }), h = P.get('newsList');
  assert.equal((card(h, 'w1').match(/Para \d/g) || []).length, 4);
  assert.match(card(h, 'w1'), /class="nx-more nx-seg"[^>]*>Read more</);
  assert.equal((card(h, 'w2').match(/Line \d/g) || []).length, 5, 'five paragraphs show whole');
  assert.ok(!/nx-more/.test(card(h, 'w2')));
  P.api.newsToggleMore('w1'); assert.equal((card(P.get('newsList'), 'w1').match(/Para \d/g) || []).length, 6);
});

// v2 §3a — mutation: a headline on a quote card; "quotes" instead of topics; quote marks back; more than 3 shown.
const QCARD = (n) => Array.from({ length: n }, (_, i) => ({ id: 'q' + i, type: 'quote', playerId: '2382', player: 'C. Alcaraz', opponentId: '1093', tournament: 'Finals - Turin', tournamentKey: '2794',
  eventKey: '77', timestamp: new Date(Date.now() - H).toISOString(), context: 'after beating D. Medvedev', text: ['I served well today and won.', 'The crowd here carried me through.', 'My thigh felt tight after the break.', 'Medvedev returns everything back deep.', 'Next I play Cobolli on Friday.'][i], topic: 'on topic ' + i }));
test('Quotes card: no headline, topic over quote, 3 shown, "n topics", the digest replaces the raw quotes', () => {
  const P = page({}, { ticker: QCARD(5) }), c = card(P.get('newsList'), 'tq0');
  assert.match(c, /<span class="nx-sl">\d\d:\d\d · 5 topics · Finals - Turin<\/span>/);
  assert.ok(!/nx-title/.test(c), 'a headline on a quote card');
  assert.equal((c.match(/class="nx-qt"/g) || []).length, 3);
  assert.match(c, /<span class="nx-qt">On topic 0<\/span><div class="nx-qx">I served well today and won\.<\/div>/);
  assert.match(c, />Show 2 more topics</);
  assert.ok(!/[“”]/.test(c), 'quote marks');
  const D = QCARD(5).concat([{ id: 'digest-x', type: 'digest', playerId: '2382', eventKey: '77', timestamp: new Date().toISOString(), blocks: [
    { label: 'after his win over Medvedev', text: 'I didn&#039;t want to push.', from: ['q0'] }, { label: 'on his thigh', text: 'Minor.', from: ['q1'] }] }]);
  const d = card(page({}, { ticker: D }).get('newsList'), 'tq0');
  assert.match(d, /2 topics/); assert.match(d, /<span class="nx-qt">After his win over Medvedev<\/span><div class="nx-qx">I didn't want to push\.<\/div>/);
  assert.ok(!/tdigest/.test(page({}, { ticker: D }).get('newsList')), 'a digest is never a card of its own');
});

// v2 §4 — the stats box. Mutations: the box without both figures; the leader by the higher figure on unforced errors;
// the bar width off the formula; a dash or zero for a missing figure; the box with no rows; the closing lines kept with it.
const REPORT = (rows, o = {}) => [Object.assign({ id: 'report-9', type: 'report', playerId: '2846', opponentId: '372', player: 'F. Tiafoe', opponent: 'F. Cobolli', tournament: 'Finals - Turin',
  timestamp: new Date(Date.now() - H).toISOString(), text: 'Tiafoe beat Cobolli.\n\nSecond.\n\nTiafoe: performance rating 8.1 | W: 20 / UE: 19 | DR: 1.64',
  rating: ['Tiafoe: performance rating 8.1 | W: 20 / UE: 19 | DR: 1.64'], fields: { score: '7-6, 6-0' },
  ms: rows ? { a: 'F. Tiafoe', b: 'F. Cobolli', sets: [[7, 6], [6, 0]], rows } : undefined }, o)];
test('Match report: text | divider | stats box from the rows held; row maths; missing data', () => {
  const rows = [['Dominance ratio', 1.64, 0.61, 'dr'], ['1st serve in', 59, 61, '%'], ['Winners', 20, 17, '0'], ['Unforced errors', 19, 29, '0', 1], ['Winners / points', 0.16, 0.14, '2']];
  const c = card(page({}, { ticker: REPORT(rows) }).get('newsList'), 'treport-9');
  assert.match(c, /<span class="nx-sl">\d\d:\d\d · Match Reports · 7-6 6-0 · Finals - Turin<\/span>/);
  assert.match(c, /<div class="nx-title"[^>]*>F\. Tiafoe beat F\. Cobolli, 7-6, 6-0<\/div>/);
  assert.match(c, /<div class="nx-col ms">/); assert.match(c, /<span class="nx-div"><\/span><div class="nx-box">/);
  assert.ok(!/performance rating/.test(c), 'the closing lines leave the text when the box carries the numbers');
  assert.match(c, /<span class="nx-bs"><span>7<i>-6<\/i><\/span><span>6<i>-0<\/i><\/span><\/span>/);
  assert.match(c, /<span class="nx-won">Won<\/span>/);
  assert.match(c, /<div class="nx-r full"><div class="nx-rf"><span class="nx-fa up lead">1\.64<\/span><span class="nx-lab">Dominance ratio<\/span><span class="nx-fb down ">0\.61<\/span>/);
  assert.match(c, /<span class="nx-fa ">59%<\/span><span class="nx-lab">1st serve in<\/span><span class="nx-fb lead">61%<\/span>[\s\S]*?<span class="nx-chip">2 pts<\/span>/);
  assert.match(c, /<span class="nx-fa lead">19<\/span><span class="nx-lab">Unforced errors<\/span><span class="nx-fb ">29<\/span>/, 'the lower figure leads on unforced errors');
  // bar = 12 + |a-b| / max × 88: winners 20 v 17 → 12 + 3/20×88 = 25.2%, on A's side
  assert.match(c, /<span class="nx-tr a"><span class="nx-bar" style="width:25\.2%"><\/span><\/span><span class="nx-chip">3<\/span><span class="nx-tr b"><span class="nx-bar" style="width:0%">/);
  // 4 rows other than DR is even → the last row does not span; 3 others → it does
  assert.match(c, /<div class="nx-r"><div class="nx-rf"><span class="nx-fa lead">0\.16/);
  const odd = card(page({}, { ticker: REPORT(rows.slice(0, 4)) }).get('newsList'), 'treport-9');
  assert.match(odd, /<div class="nx-r full"><div class="nx-rf"><span class="nx-fa lead">19/, 'an odd last row spans both columns');
  assert.match(card(page({}, { ticker: REPORT([['Winners', 20, 20, '0']]) }).get('newsList'), 'treport-9'), /<span class="nx-fa ">20<\/span>[\s\S]*<span class="nx-chip">Level<\/span>/);
  const none = card(page({}, { ticker: REPORT(null) }).get('newsList'), 'treport-9');
  assert.ok(!/nx-box|nx-div/.test(none) && /<div class="nx-col">/.test(none) && /performance rating/.test(none), 'no rows: a plain text article');
  // Read more: above 7 paragraphs with more than 6 rows, else above 5
  const long = REPORT(rows.concat([['Serve quality', 8.1, 7.7, '1'], ['Return quality', 7.2, 5.1, '1']]), { text: Array.from({ length: 7 }, (_, i) => 'P' + i).join('\n\n') });
  assert.ok(!/nx-more/.test(card(page({}, { ticker: long }).get('newsList'), 'treport-9')), '7 paragraphs with 7 rows show whole');
});

// v2 §5 — mutation: a Close link; the opened report losing its box; the 184px indent kept beside the box.
test('Compact: the opened row = card colour + ring, no Close link; an opened report carries the same box at full width', () => {
  const P = page({}, { ticker: REPORT([['Winners', 20, 17, '0']]), view: 'compact' });
  assert.match(P.get('newsList'), /<div class="nx-wc"><span class="nx-wn"><span class="nx-avs"><span class="nx-av s">FT<\/span><\/span><b>F\. Tiafoe<\/b><\/span><span class="nx-wh"[^>]*>F\. Tiafoe beat F\. Cobolli, 7-6, 6-0<\/span><span class="nx-wk">Match Reports · 7-6 6-0<\/span><span class="nx-car" aria-hidden="true">›<\/span>/);
  P.api.newsToggleRow('treport-9');
  const o = P.get('newsList');
  assert.match(o, /<div class="nx-wr open"/); assert.ok(!/>Close</.test(o));
  assert.match(o, /<div class="nx-wline ms"><\/div><div class="nx-wbody ms"><div class="nx-wcol">/);
  assert.match(o, /<span class="nx-div"><\/span><div class="nx-box c">/);
  assert.match(o, /<span class="nx-pill">Match Reports<\/span><span class="nx-wsub">Stennisfy · Finals - Turin<\/span>/);
  assert.match(CSS, /\.nx-wr\.open, \.nx-wr\.open:hover \{ background: var\(--news-card\);[^}]*box-shadow: inset 0 0 0 1px var\(--nx-e12\)/);
  assert.match(CSS, /\.nx-box \{ flex: 2 1 340px; max-width: 560px;/); assert.match(CSS, /\.nx-box\.c \{ flex: 1\.6 1 320px; max-width: 540px; \}/);
  assert.match(CSS, /\.nx-col \{ flex: 1 1 300px;/); assert.match(CSS, /\.nx-wcol \{ flex: 1 1 280px;/);
});

// v2 §6 — the composer. Mutations: publish without a player; free-typed names; Draws & Schedules in the group;
// Edit not restoring player and group; a sixth post.
test('Post intel: player from the search required, group = category, destination sentence, max 5, Edit restores', () => {
  const idx = [{ key: '2382', name: 'Carlos Alcaraz', rank: 1 }, { key: '2072', name: 'Jannik Sinner', rank: 2 }];
  const P = page({ admin: true, index: idx }, { ticker: QCARD(1) });
  P.api.newsToggleComposer();
  let c = P.get('newsComposer');
  assert.match(P.get('newsPostIntelHost'), /class="nx-post nx-seg open"[^>]*>Post intel <span class="nx-post-n">0\/5<\/span>/);
  assert.match(c, /placeholder="Search a player…"/); assert.match(c, /Pick a player to publish\./);
  assert.deepEqual([...c.matchAll(/intelSetCat\('([^']+)'\)/g)].map(m => m[1].replace("\\'", "'")), ['Match Reports', 'Quotes', 'Withdrawals & Injuries', 'Tour News']);
  assert.match(c, /class="nx-tab nx-seg on"[^>]*>Tour News</, 'Tour News by default');
  assert.deepEqual(P.api.intelPlayerHits('alca').map(h => [h.key, h.tour]), [['2382', 'Finals - Turin']], 'the real player list, with his tournament');
  P.api.intelOnText('Practised fully. Looked sharp.');
  assert.equal(P.api.intelCanPublish(), false, 'no player: no publish');
  P.api.intelPick('2382', 'C. Alcaraz', 'Finals - Turin'); P.api.intelSetCat('Withdrawals & Injuries');
  c = P.get('newsComposer');
  assert.match(c, /<span class="nx-dot on"><\/span>Goes to the top of today in<b>Withdrawals &amp; Injuries · C\. Alcaraz · Finals - Turin<\/b>/);
  assert.match(c, /class="nx-pub nx-seg ready"/);
  const five = Array.from({ length: 5 }, (_, i) => ({ id: 'n' + i, text: 'Note ' + i + '.', player: 'C. Alcaraz', playerKey: '2382', cat: 'Quotes', tour: 'Finals - Turin', createdAtMs: Date.now() - i * H }));
  const F5 = page({ admin: true, index: idx, intel: five });
  F5.api.newsToggleComposer(); F5.api.intelPick('2382', 'C. Alcaraz', ''); F5.api.intelOnText('x.');
  assert.equal(F5.api.intelCanPublish(), false); assert.match(F5.get('newsComposer'), /Five posts are active\. Delete one to publish in/);
  assert.match(card(F5.get('newsList'), 'in0'), /<span class="nx-sl">\d\d:\d\d · Quotes · Finals - Turin<\/span>/, 'the post carries its group and tournament');
  F5.api.intelStartEdit('n0');
  assert.ok(!/data-id="in0"/.test(F5.get('newsList')), 'the post leaves the feed while it is edited');
  assert.match(F5.get('newsComposer'), /<b>C\. Alcaraz<\/b>/); assert.match(F5.get('newsComposer'), /class="nx-tab nx-seg on"[^>]*>Quotes</);
  assert.match(F5.get('newsComposer'), />Note 0\.<\/textarea>/);
  assert.equal(page({ admin: false }).get('newsPostIntelHost'), '', 'members get no composer');
});

// v2 colours — mutation: a raw colour; a foundation token where the export names its own.
test('Colour: only the export\'s own tokens (--news-*), no raw colour', () => {
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(CSS), 'raw colour in news-page.css');
  assert.ok(!/var\(--(card|inner|selected|text|text-soft|text-label|link|bar|pos|neg)\)/.test(CSS), 'a foundation token on the News page');
  assert.match(CSS, /\.nx-bar \{ background: var\(--news-blue\); \}/);
});

// R1 + R2 tournament rule (founder cards 91aec78c / 28bd8fc2) — mutations: read tournament_name; the 14-day window dropped.
test('Tournament: exactly one event named in the title (in play), else in the first paragraph (in play), else none', () => {
  const h = page().get('newsList');
  assert.match(card(h, 'w1'), /Shanghai Masters/, 'title event (the feed says Wimbledon)');
  assert.match(card(h, 'w2'), /China Open/, 'first-paragraph event (the feed says US Open)');
  assert.ok(!/Halle|US Open/.test(h), 'the feed field reached the page');
  const w = FEED(); w.articles[0].title = 'Sinner confirmed for One Point Slam in Melbourne'; w.articles[0].content = 'One.\n\nTwo.';
  assert.ok(!/Australian Open/.test(card(page({ feed: w }).get('newsList'), 'w1')), 'Melbourne in October = no tag');
  assert.ok(!/Shanghai Masters|China Open/.test(page({ tp: {} }).get('newsList')), 'no event dates on record: no tournament');
});
