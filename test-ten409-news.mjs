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
  const a = html.indexOf('// TEN-409 step 10 (founder 2026-10-09): one feed'), b = html.indexOf('/* ---------- BSP CONSULT INTEL');
  assert.ok(a > 0 && b > a, 'News JS block');
  return html.slice(a, b);
})();
const CSS = (() => {
  const a = html.indexOf('<!-- NEWS PAGE (TEN-8 → TEN-409'), b = html.indexOf('<div class="tabpage" data-page="news">');
  assert.ok(a > 0 && b > a, 'News CSS block');
  return html.slice(a, b);
})();
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
  const f = new Function('document', 'localStorage', 'fetch', 'opts', `
    let _intelNotes = opts.intel || [], _intelEditingId = null; const INTEL_MAX = 5;
    const playerProfiles = opts.profiles || {}; const playerIndex = [];
    function isBspAdmin(){ return !!opts.admin; }
    function intelResolveNote(n){ return { label: n.player || '', key: n.playerKey != null ? String(n.playerKey) : null }; }
    const TOURNAMENT_CATALOG = ['Australian Open', 'French Open', 'Roland Garros', 'Wimbledon', 'Shanghai', 'Beijing', 'Tokyo', 'Montreal', 'Toronto'].map(name => ({ name }));
    const SF_EVENT_NAMES = { 'Australian Open': 'Australian Open', 'French Open': 'Roland Garros', 'Roland Garros': 'Roland Garros', Wimbledon: 'Wimbledon', Shanghai: 'Shanghai Masters', Beijing: 'China Open',
      Tokyo: 'Japan Open', Montreal: 'Canadian Open', Toronto: 'Canadian Open' };
    function sfEventKey(raw){ if (TOURNAMENT_CATALOG.some(t => t.name === raw)) return raw; const k = Object.keys(SF_EVENT_NAMES).find(x => SF_EVENT_NAMES[x] === raw); return k || null; }
    function tourxEventName(k){ return SF_EVENT_NAMES[k] || k; }
    function tourxConditionRegistry(){ return [{ name: 'Shanghai' }, { name: 'Wimbledon' }, { name: 'Beijing' }]; }
    function psOpenProfile(){} const tourxState = {}; let asapSignals = {};
    function newsRenderComposer(){}   // the composer lives in the intel section (founder only)
    function escapeHtml(s){ return String(s); }
    function newsPlayerFor(){ throw new Error('the News page read a headline for a name'); }
    ${BLOCK}
    return { set data(v) { _newsData = v; }, set state(v) { _newsState = v; }, set cats(v) { _newsCats = v; }, set tour(v) { _newsTourKey = v; },
      set hours(v) { _newsRangeHours = v; }, set q(v) { _newsSearch = v; }, set view(v) { _newsView = v; },
      renderNews, newsToggleCat, newsSetView, newsWiden, newsToggleRow, newsWireItems, newsPageIntelItems, get hoursNow() { return _newsRangeHours; },
      get cats() { return _newsCats; } };
  `);
  const api = f(doc, ls, () => Promise.reject(new Error('offline')), opts);
  return { api, get: id => get(id).innerHTML, els, store };
}
const H = 3600e3;
const ts = hAgo => new Date(Date.now() - hAgo * H).toISOString().replace('T', ' ').replace('Z', '');
const GEN = new Date(Date.now() - 3 * H); GEN.setUTCSeconds(7);
const art = (k, key, hAgo, title, o = {}) => Object.assign({ news_key: String(k), player_key: key, player_name: key ? 'P. ' + key : null, published_at: ts(hAgo), title,
  content: 'One.\n\nTwo.', sources: ['ubitennis'], tournament_name: 'Shanghai' }, o);
// tournament_name is deliberately wrong on every row: the page must never read it (R1 tournament rule).
const FEED = () => ({ generatedAt: GEN.toISOString(), articles: [
  art(1, '2382', 2, 'Alcaraz eases through in straight sets in Shanghai', { tournament_name: 'Wimbledon' }),
  art(2, '2072', 5, 'Sinner withdraws with a knee injury', { tournament_name: 'US Open', content: 'He was due to play his opener in Beijing on Tuesday.\n\nTwo.' }),
  art(3, null, 1, 'Djokovic wins the title in Beijing'),                                   // tournament / headline only — never shown
  art(4, '1905', 100, 'Djokovic draw released for Wimbledon', { tournament_name: 'Halle', content: 'Body mentions Monaco.' }),
] });
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
function page(opts = {}, set = {}) {
  const P = load(opts); P.api.data = 'feed' in opts ? opts.feed : FEED(); P.api.state = opts.state || 'ok';
  Object.assign(P.api, set); P.api.renderNews(); return P;
}
const stats = P => [...P.get('newsHeaderStats').matchAll(/<span class="sfh__l">([^<]+)<\/span><span class="sfh__v([^"]*)"[^>]*>([^<]*)</g)].map(m => [m[1], m[3], m[2].trim()]);

// Data 2 — mutation: restore `|| newsPlayerFor(a.title)` / drop the player_key filter in newsWireItems.
test('Data 2: only player-attributed articles show; the page never reads a headline for a name', () => {
  const P = page();
  const list = text(P.get('newsList'));
  assert.ok(/Alcaraz eases/.test(list) && /Sinner withdraws/.test(list) && /Djokovic draw/.test(list));
  assert.ok(!/Djokovic wins the title/.test(list), 'a tournament-only article came back');
  assert.ok(/Djokovic/.test(FEED().articles[2].title), 'control: the unattributed headline does name a player');
});

// Data 3 — mutation: any "Sample" text in the page code or markup.
test('Data 3: no sample article anywhere in the News page code or markup', () => {
  assert.ok(!/Sample/.test(BLOCK) && !/Sample/.test(MARKUP) && !/SAMPLE_NEWS|STENNISFY_NEWS/.test(BLOCK));
  const P = page({ feed: { generatedAt: GEN.toISOString(), articles: [] } });
  assert.match(text(P.get('newsList')), /^No articles available\. Last updated \d\d:\d\d:07 ?\.$/);
});

// Data 6 — mutation: Updated from `new Date()`; Players counted per article; a zero for an unsourced value.
test('Data 6: Articles after every filter, Players distinct, Updated = the feed refresh (HH:MM), never the clock', () => {
  const P = page();
  const hm = GEN.toISOString().slice(11, 16);
  assert.deepEqual(stats(P), [['Articles', '3', ''], ['Players', '3', ''], ['Updated', hm, 'sfh__v--soft']]);
  const now = new Date().toISOString().slice(11, 16);
  if (now !== hm) assert.notEqual(stats(P)[2][1], now, 'Updated reads the clock');
  const Q = page({}, { cats: ['Withdrawals & Injuries'] });
  assert.deepEqual(stats(Q).slice(0, 2).map(s => s[1]), ['1', '1']);
  const N = page({ feed: { articles: FEED().articles } });   // no generatedAt
  assert.deepEqual(stats(N)[2], ['Updated', '—', 'sfh__v--none']);
  const U = page({ feed: null, state: 'unavailable' });
  assert.deepEqual(stats(U).map(s => s[1]), ['—', '—', '—']);
  assert.match(text(U.get('newsList')), /^News feed unavailable\. Last checked \d\d:\d\d:\d\d ?\.$/);
});

// Data 8 / keep-as-built — mutation: always offer "Try a wider date range." / offer Clear search without a search.
test('Empty state: names the filter, widens only when a wider window has results, Clear search only with a search', () => {
  const W = page({}, { hours: 6, cats: ['Draws & Schedules'] });          // the 100 h-old draw article exists
  assert.equal(text(W.get('newsList')), 'No articles match these filters. No Draws & Schedules articles in the last 6 hours. Try a wider date range.');
  W.api.newsWiden(); assert.equal(W.api.hoursNow, 168, 'widen jumps to the first window with results');
  const Q = page({}, { hours: 6, q: 'draw released' });   // the window, not the search, is the cause
  assert.equal(text(Q.get('newsList')), 'No articles match these filters. No results for “draw released” in the last 6 hours. Try a wider date range. Clear search');
  const S = page({ feed: Object.assign(FEED(), { articles: FEED().articles.concat([art(9, '1905', 24 * 9, 'Old draw news', { content: 'x' })]) }) }, { hours: 48, cats: ['Draws & Schedules'], q: 'old draw' });
  assert.ok(!/wider/.test(S.get('newsList')), 'an article older than 7 days does not earn the widen link');
  const N = page({}, { hours: 6, cats: ['Match Reports'], q: 'zzz' });
  assert.equal(text(N.get('newsList')), 'No articles match these filters. No results for “zzz”. Clear search');
  const X = page({}, { hours: 6, cats: ['Match Reports'] });             // "eases through" is Tour News, nothing anywhere
  assert.ok(!/wider/.test(X.get('newsList')) && !/Clear search/.test(X.get('newsList')));
  assert.equal(text(X.get('newsList')), 'No articles match these filters. No Match Reports articles in the last 6 hours.');
  const T = page({}, { hours: 6, tour: 'wimbledon' });   // a kept selection outside the window (art 4, 100 h)
  assert.equal(text(T.get('newsList')), 'No articles match these filters. No articles for Wimbledon in the last 6 hours. Try a wider date range.');
});

// keep-as-built — mutation: single-select categories; "All" not clearing.
test('Categories are multi-select and All clears them', () => {
  const P = page();
  P.api.newsToggleCat('Withdrawals & Injuries'); P.api.newsToggleCat('Draws & Schedules');
  assert.deepEqual(stats(P)[0][1], '2');
  assert.deepEqual((P.get('newsChips').match(/news-segi on/g) || []).length, 2);
  P.api.newsToggleCat(''); assert.deepEqual(P.api.cats, []); assert.equal(stats(P)[0][1], '3');
});

// keep-as-built — mutation: list every event in the feed, or string-match a roster against the body.
test('Tournament drop-down lists only events with articles in the current window; filters combine', () => {
  const P = page({}, { hours: 24 });
  const menu = P.get('newsTourFilter');
  assert.deepEqual([...menu.matchAll(/data-v="([^"]*)"><span>([^<]+)</g)].map(m => m[2]), ['All tournaments', 'China Open', 'Shanghai Masters']);
  const C = page({}, { tour: 'china-open', cats: ['Withdrawals & Injuries'], q: 'knee' });
  assert.equal(stats(C)[0][1], '1');
  const D = page({}, { tour: 'china-open', cats: ['Tour News'] });
  assert.equal(stats(D)[0][1], '0');
});

// keep-as-built — mutation: search drops the body / tournament, or adds the source.
test('Search covers title, players, tournament and body (not the source)', () => {
  assert.equal(stats(page({}, { q: 'monaco' }))[0][1], '1');
  assert.equal(stats(page({}, { q: 'shanghai masters' }))[0][1], '1');
  assert.equal(stats(page({}, { q: 'P. 2072' }))[0][1], '1');
  assert.equal(stats(page({}, { q: 'ubitennis' }))[0][1], '0');
});

// keep-as-built — mutation: a different key, or no write.
test('Reading / Compact persists to stennisfy.newsView', () => {
  const P = page(); P.api.newsSetView('compact');
  assert.equal(P.store['stennisfy.newsView'], 'compact');
  assert.match(P.get('newsList'), /class="news-rows"/);
});

// Data 4 + 5 — mutation: feed spelling over the profile name; a raw tournament name; the intel player linked.
// review fix — mutation: newsEscape (quotes left raw) in an attribute.
test('Feed text in attributes is quote-escaped', () => {
  const f = FEED(); f.articles[0].player_name = 'Jo "JJ" Smith';
  const h = page({ feed: f }).get('newsList');
  assert.match(h, /title="Open Jo &quot;JJ&quot; Smith on Player Profile"/);
});

test('Names: profile name + canonical event name; feed players link, an intel player is plain text', () => {
  const P = page({ profiles: { 2382: { name: 'C. Alcaraz' } }, intel: [{ id: 'n1', text: 'Practised fully. Looked sharp.', player: 'J. Sinner', playerKey: '2072', createdAtMs: Date.now() - H }] });
  const h = P.get('newsList');
  assert.match(h, /news-entlink"[^>]*newsOpenPlayer\('2382'\)[^>]*>C\. Alcaraz</);
  assert.match(h, /data-tour="Shanghai"[^>]*>Shanghai Masters</);
  assert.match(h, /<span class="news-cat">Stennisfy Intel<\/span><span class="news-cardsource">Stennisfy<\/span><span class="news-cardsep">·<\/span><span class="news-ent">J\. Sinner<\/span>/);
  assert.match(h, /<h3 class="news-cardtitle">Practised fully<\/h3>/);
});

// What changes 8–10 — mutation: a raw colour, link blue on names, a blue ring / fill, green / red / amber on the page.
test('Colour check: tokens only, links --link, names white, no blue rings or fills, no green / red / amber', () => {
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(CSS), 'raw colour in the News CSS');
  assert.ok(!/--pos|--neg|--amber|--bar\b|--open-card|--viz-/.test(CSS));
  assert.match(CSS, /\.news-link\{[^}]*color:var\(--link\)/);
  assert.equal((CSS.match(/var\(--link\)/g) || []).length, 1, '--link only on the real links');
  assert.match(CSS, /\.news-ent\{[^}]*font-weight:600; color:var\(--text\)/);
  assert.ok(!/outline:(?!none)[^;]*;/.test(CSS.replace(/outline:none/g, '')), 'a focus ring');
  for (const m of CSS.matchAll(/:focus[^{]*\{([^}]*)\}/g)) assert.ok(!/--link|--bar/.test(m[1]));
  const f = FEED(); f.articles[0].content = Array.from({ length: 6 }, (_, i) => 'Para ' + i).join('\n\n');
  const P = page({ feed: f });
  assert.equal((P.get('newsList').match(/class="news-link news-more"/g) || []).length, 1, 'Read more only past the 2-paragraph preview');
  assert.ok(!/\[data-page="news"\][^{]*\.sf-dd-chev/.test(CSS), 'R1 fix 4: the page restyles the site chevron');
});

// R1 tournament rule (founder card 91aec78c) — mutation: read tournament_name; take a paragraph naming two events; fuzzy /
// shared phrases.
test('Tournament = the event the title names, else the one event the first paragraph names, else none', () => {
  const P = page();
  const h = P.get('newsList');
  assert.match(h, /data-id="w1"[\s\S]*?data-tour="Shanghai"[^>]*>Shanghai Masters</, 'title event (the feed says Wimbledon)');
  assert.match(h, /data-id="w2"[\s\S]*?data-tour="Beijing"[^>]*>China Open</, 'first-paragraph event (the feed says US Open)');
  assert.ok(!/Halle|US Open/.test(h), 'the feed field reached the page');
  const f = FEED();
  f.articles[1].content = 'He skipped Tokyo and Beijing this month.\n\nShanghai is next.';      // two events in paragraph 1 → none
  f.articles[0].title = 'Alcaraz picks Tokyo over Shanghai';                                    // two in the title → the first
  f.articles[3].title = 'Djokovic eyes the Canadian Open';                                      // a shared official name → none
  const Q = page({ feed: f }, { hours: 168 });
  const q = Q.get('newsList');
  assert.match(q, /data-id="w1"[\s\S]*?>Japan Open</);
  const card2 = q.slice(q.indexOf('data-id="w2"'), q.indexOf('</article>', q.indexOf('data-id="w2"')));
  assert.ok(!/data-tour|Japan Open|China Open|Shanghai Masters/.test(card2) && !/·<\/span><\/div>/.test(card2), 'no tournament and no placeholder');
  const card4 = q.slice(q.indexOf('data-id="w4"'), q.indexOf('</article>', q.indexOf('data-id="w4"')));
  assert.ok(!/data-tour/.test(card4));
  assert.deepEqual([...Q.get('newsTourFilter').matchAll(/data-v="([^"]*)"><span>([^<]+)</g)].map(m => m[2]), ['All tournaments', 'Japan Open']);
  // review fix — mutation: drop NEWS_EVENT_SAME (the catalog's two entries for one event make "Roland Garros" a shared phrase)
  const g = FEED(); g.articles[0].title = 'Alcaraz eyes Roland Garros title'; g.articles[3].title = 'Djokovic back at the French Open';
  const G = page({ feed: g }, { hours: 168 }).get('newsList');
  assert.equal((G.match(/>Roland Garros</g) || []).length, 2);
});

// R1 fixes 1, 2, 6 — mutation: a 4-paragraph preview; the open row drops the player column; a renamed source.
test('2-paragraph preview, open Compact row keeps its columns, source verbatim', () => {
  const f = FEED(); f.articles[0].content = Array.from({ length: 4 }, (_, i) => 'Para ' + i).join('\n\n'); f.articles[0].sources = ['tennis365', 'ubitennis'];
  const P = page({ feed: f });
  const card = P.get('newsList').slice(0, P.get('newsList').indexOf('</article>'));
  assert.equal((card.match(/Para \d/g) || []).length, 2);
  assert.match(card, /<span class="news-cardsource">tennis365, ubitennis<\/span>/);
  P.api.view = 'compact'; P.api.newsToggleRow('w1');
  const open = P.get('newsList').match(/<div class="news-row open"[\s\S]*?<div class="news-rbody"/);
  assert.ok(open, 'row w1 opened');
  assert.match(open[0], /<span class="news-rtime"[^>]*>[^<]+<\/span><span class="news-rplayer"><span[^>]*>P\. 2382<\/span><\/span><span class="news-rhead">/, 'the open row keeps time · player · title');
  assert.match(CSS, /\.news-rbody\{[^}]*padding:8px 16px 4px 170px/, 'the body sits under the title column');
  // founder R1 fix 1: the same 2-paragraph preview in an open Compact row, Read more / Show less
  assert.equal((open[0].match(/Para \d/g) || []).length, 0, 'control: the head holds no paragraph');
  const rowHtml = P.get('newsList').slice(P.get('newsList').indexOf('<div class="news-row open"'));
  const rb = rowHtml.slice(0, rowHtml.indexOf('</div></div>') + 12);
  assert.equal((rb.match(/Para \d/g) || []).length, 2, 'open Compact row previews 2 paragraphs');
  assert.match(rb, /news-more[^>]*>Read more</);
});
