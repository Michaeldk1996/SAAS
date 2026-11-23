// TEN-333 → Match analysis rebuild 2026-11-23: the modal News tab is maNewsV2 (match-analysis-v2.js), built from the
// LOCKED 2026-11-21 News tab design (player tiles, category track with counts, Reading / Compact — Compact default — day
// groups, Compact rows, the opened row). Its data = the News page's own items (newsWireItems: outlet articles keyed by
// player_key; newsTickerItems: our match reports, quotes, status notes), scoped to the two players by key, inside the
// feed's 5-day window. The SHIPPED code is executed: the dashboard's news data layer is sliced out of
// bsp-consult-dashboard.html (tools/ten334-overview-vm.mjs `closure`) and match-analysis-v2.js is run in the same scope.
// Rules: .claude/rules/modal-news.md, news.md, CLAUDE.md. Every check names the mutation that turns it red;
// tools/test-ten333-mutants.js applies each one. A check tagged [GAP] (via gap()) would lock a still-valid rule the
// rebuild does not meet yet; TEN333_SKIP_GAPS=1 leaves such checks out (the mutant runner does). None are open now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closure, lineSrc } from './tools/ten334-overview-vm.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN333_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const V2 = readFileSync(process.env.TEN333_V2 || join(HERE, 'match-analysis-v2.js'), 'utf8');
const NEWS_V2 = V2.slice(V2.indexOf('// ---------------------------------------------------------------- News'), V2.indexOf('// ---------------------------------------------------------------- Key factors'));
const gap = process.env.TEN333_SKIP_GAPS ? test.skip : test;

const SLICE = closure(html, ['buildNewsSection', 'ensureNewsData', 'renderNewsSection', 'newsWireItems', 'newsTickerItems', 'newsAddedLabel',
  'newsFmtTime', 'newsFmtDateKey', 'newsFigFmt', 'aNewsStoryKey', 'aNewsArticlesFor', 'escapeHtml', 'newsTz', 'maGate'],
['document', 'window', 'fetch', 'localStorage', 'newsArticleEvent', 'playerProfiles', 'renderNews', 'loadNewsTicker', 'aAvatarHtml']);
const NOW = Date.parse('2026-09-28T12:00:00Z');
function load(opts = {}) {
  const win = {};
  const f = new Function('document', 'window', 'fetch', 'Date', 'localStorage', 'playerProfiles', 'newsArticleEvent', 'aAvatarHtml', `
    ${SLICE}
    ${lineSrc('let _aNewsFilter', html)}
    ${lineSrc('let _aNewsOpen', html)}
    ${V2}
    const maNewsV2 = window.maNewsV2;   // the page reads it off window
    return { set feed(v) { _newsData = v; }, get feed() { return _newsData; }, set ticker(v) { _newsTicker = v; },
      set state(v) { _aNewsState = v; }, get state() { return _aNewsState; },
      set filter(v) { _aNewsFilter = v; }, get filter() { return _aNewsFilter; }, set open(v) { _aNewsOpen = v; }, get open() { return _aNewsOpen; },
      buildNewsSection, ensureNewsData, A_NEWS_WINDOW_DAYS };`);
  class D extends Date { constructor(...a) { if (a.length) super(...a); else super(NOW); } static now() { return NOW; } }
  const doc = { getElementById: () => null };
  const api = f(doc, win, opts.fetch || (() => Promise.reject(new Error('offline'))), D, { getItem: () => opts.tz || 'UTC' }, {},
    () => null, (n, k) => `<i data-av="${k}"></i>`);
  return Object.assign(api, { win });
}
const ts = (hAgo) => new Date(NOW - hAgo * 3600e3).toISOString().replace('T', ' ').replace('Z', '');
const M = { id: 'm1', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: 2072, p2Key: 2382 };
const art = (key, hAgo, title, content = 'First para.\n\nSecond para.') => ({ news_key: 'k' + key + '-' + hAgo, player_key: key,
  player_name: key === 2072 ? 'J. Sinner' : key === 2382 ? 'C. Alcaraz' : 'N. Djokovic', published_at: ts(hAgo), title, content });
const FEED = { articles: [
  art(2072, 30, 'Sinner injury: older piece'), art(2072, 2, 'Sinner injury: newest piece'), art(2072, 10, 'Sinner injury: middle piece'),
  art(2382, 5, 'Alcaraz injury piece'), art(1905, 1, 'Djokovic injury unrelated'),
] };
const REPORT = [{ id: 'r1', type: 'report', text: 'Alcaraz won in straight sets.', player: 'C. Alcaraz', playerId: 2382, opponent: 'C. Ruud', opponentId: 999,
  tournament: 'Tokyo', timestamp: new Date(NOW - 4 * 3600e3).toISOString(), fields: { score: '6-3, 6-4' } }];
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const ok = (feed = FEED, ticker = []) => { const N = load(); N.feed = feed; N.ticker = ticker; N.state = 'ok'; return N; };
// the Compact rows' titles, in list order
const titles = h => [...h.matchAll(/<span title="Added to feed[^"]*" style="font-size:14px; font-weight:500;[^"]*">([^<]*)</g)].map(m => m[1]);

// Mutation: the list sorted oldest first, or player B's items dropped, or another player's article let in.
test('scope: the two players\' items only, newest first, joined on player_key', () => {
  const h = ok().buildNewsSection(M);
  assert.deepEqual(titles(h), ['Sinner injury: newest piece', 'Alcaraz injury piece', 'Sinner injury: middle piece', 'Sinner injury: older piece']);
  assert.ok(!h.includes('Djokovic'), 'an article keyed to another player never shows');
  assert.ok(text(h).includes('J. Sinner 3 articles') && text(h).includes('C. Alcaraz 1 article'), 'tile counts');
});

// The key is the join (modal-news.md "Attribution is data"): a headline naming Sinner but keyed to 1905 never shows for
// him. A row without a player_key is not a News item (news.md "Player-attributed articles only"; the tab now reads the
// News page's items, so the modal's interim headline resolver went with the old data path).
// Mutation: the player match ignores the key.
test('attribution: player_key wins; a headline never re-attributes a keyed row; an unkeyed row is not an item', () => {
  const h = ok({ articles: [art(1905, 1, 'Sinner injury scare, says Djokovic'), { news_key: 'x', player_key: null, published_at: ts(3), title: 'Alcaraz injury: eyes Beijing' }] }).buildNewsSection(M);
  assert.ok(!h.includes('Sinner injury scare'), 'keyed to 1905 → not Sinner, whatever the headline says');
  assert.ok(!h.includes('eyes Beijing'), 'no key → not an item');
  assert.ok(text(h).includes('No recent news for J. Sinner or C. Alcaraz.'));
});

// Mutation: the rolling-window filter dropped (a stale feed would show week-old news as "recent").
test('window: only items from the last 5 days show (the feed\'s own window)', () => {
  const N = ok({ articles: [art(2072, 24 * 4, 'Sinner injury four days'), art(2072, 24 * 6, 'Sinner injury six days')] });
  assert.equal(N.A_NEWS_WINDOW_DAYS, 5);
  const h = N.buildNewsSection(M);
  assert.ok(h.includes('Sinner injury four days') && !h.includes('Sinner injury six days'));
});

// TEN-380 review (founder 2026-10-04): two headlines whose first five words match are one story; only the newest shows.
// Mutation: the one-story filter dropped.
test('one story, one line: a re-written headline shows once, the newest', () => {
  const h = ok({ articles: [art(2382, 3, 'Alcaraz Withdraws From Paris With Knee Injury'), art(2382, 9, 'alcaraz withdraws from paris with knee, again')] }).buildNewsSection(M);
  assert.deepEqual(titles(h), ['Alcaraz Withdraws From Paris With Knee Injury']);
});

// Design 2026-11-21: Tour News is not shown on the tab. Mutation: the Tour News filter dropped.
test('Tour News is not on the tab', () => {
  assert.ok(!ok({ articles: [art(2072, 3, 'Sinner attends gala dinner')] }).buildNewsSection(M).includes('gala dinner'));
});

// N9 (no sample) + Q20 (a one-player filter names only that player); copy = the locked 2026-11-21 design's empty box.
// Mutation: the empty copy names both players under a one-player filter, or the copy is reworded.
test('N9 empty state: "No recent news for {A} or {B}."; a one-player filter names that player only; no sample', () => {
  const h = ok({ articles: [] }).buildNewsSection(M);
  assert.ok(text(h).includes('No recent news for J. Sinner or C. Alcaraz. Only articles about the two players of this match are shown here.'), text(h));
  assert.ok(!/sample/i.test(h));
  const F = ok({ articles: [art(2382, 5, 'Alcaraz injury piece')] }); F.filter = 'p1';
  assert.ok(text(F.buildNewsSection(M)).includes('No recent news for J. Sinner.'));
});

// Mutation: ensureNewsData accepts a feed without an articles array, a failed fetch falls back to anything but the
// unavailable state, or the player filter (tiles) is dropped from the unavailable state (founder Q19).
test('unavailable: a failed or malformed feed shows "News feed unavailable." + Last checked — never a sample; the filter stays', async () => {
  for (const fetch of [() => Promise.resolve({ ok: false, status: 503 }), () => Promise.resolve({ ok: true, text: () => Promise.resolve('{"generatedAt":"x"}') })]) {
    const N = load({ fetch }); N.state = 'load'; N.ticker = [];
    await N.ensureNewsData();
    assert.equal(N.state, 'unavailable');
    assert.equal(N.feed, null);
    const h = N.buildNewsSection(M);
    assert.match(text(h), /News feed unavailable\. Last checked \d\d:\d\d:\d\d ?\./);
    assert.ok(!/sample/i.test(h));
    const tile = h.indexOf('onclick="ma2NewsPlayer(\'p1\')"'), un = h.indexOf('News feed unavailable.');
    assert.ok(tile > 0 && tile < un && h.includes('onclick="ma2NewsPlayer(\'p2\')"'), 'Q19: the player filter above the unavailable block');
  }
  const G = load({ fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(FEED)) }) });
  await G.ensureNewsData();
  assert.equal(G.state, 'ok');
});

// Mutation: the design's sample fallback ported (SAMPLE_NEWS / window.STENNISFY_NEWS) into the page or the tab.
test('no sample: no sample table or fallback in the page or the tab', () => {
  for (const re of [/\bSAMPLE_NEWS\b/, /STENNISFY_NEWS/]) { assert.ok(!re.test(html), String(re)); assert.ok(!re.test(V2), String(re)); }
});

// news.md "No time on an article": an outlet article carries the feed's batch stamp, never shown as its time; its hover
// says "Added to feed …". Our own items (match reports) carry their real time.
// Mutation: the Compact row shows an "ago" for an outlet article, or the Reading line shows its HH:MM.
test('no time on an outlet article; our report keeps its time; the hover says "Added to feed"', () => {
  const N = ok({ articles: [art(2072, 2, 'Sinner injury: newest piece')] }, REPORT);
  const h = N.buildNewsSection(M);
  const i = h.indexOf('>Sinner injury: newest piece<'), row = h.slice(i, h.indexOf('</div></div>', i));
  assert.match(row, /white-space:nowrap;"><\/span>/, 'outlet row: the time column is empty');
  assert.ok(/title="Added to feed 28 Sept? 10:00"/.test(h), 'outlet hover');
  assert.match(h.slice(h.indexOf('C. Alcaraz beat C. Ruud')), /white-space:nowrap;">4h ago</, 'our report shows its age');
  N.win.ma2NewsView('reading');
  const r = N.buildNewsSection(M), sub = /<span title="Added to feed 28 Sept? 10:00" style="font-size:12px;[^"]*">([^<]*)</.exec(r);
  assert.ok(sub && !/\d\d:\d\d/.test(sub[1]), 'Reading: no time on the outlet line: ' + (sub && sub[1]));
  assert.match(r, /title="Added to feed 28 Sept? 08:00" style="font-size:12px;[^"]*">08:00 · Match Reports/, 'Reading: our report\'s time');
});

// Design 2026-11-21: Compact is the default view; a new match resets it. Mutation: the default view back to Reading.
test('Compact is the default view; Reading on the switch', () => {
  const N = ok(), h = N.buildNewsSection(M);
  assert.ok(/class="mnrow"/.test(h) && !/font-size:18px; font-weight:800; letter-spacing:-0\.005em/.test(h), 'compact rows');
  N.win.ma2NewsView('reading');
  assert.ok(/font-size:18px; font-weight:800; letter-spacing:-0\.005em[^>]*>Sinner injury: newest piece</.test(N.buildNewsSection(M)), 'reading cards');
  assert.ok(/class="mnrow"/.test(N.buildNewsSection(Object.assign({}, M, { id: 'm2' }))), 'a new match opens on Compact');
});

// Mutation: several rows open at once, or the open row shows no body.
test('expand: one Compact row open at a time; the open row wraps its title and shows the body', () => {
  const N = ok();
  N.win.ma2NewsRow('wk2072-2'); N.win.ma2NewsRow('wk2382-5');
  assert.equal(N.open, 'wk2382-5');
  const h = N.buildNewsSection(M);
  assert.equal((h.match(/class="mnrow mnopen"/g) || []).length, 1);
  const o = h.slice(h.indexOf('class="mnrow mnopen"'));
  assert.match(o, /line-height:1\.4; text-wrap:pretty; padding-top:2px;">Alcaraz injury piece</);
  assert.ok(o.includes('First para.') && o.includes('Second para.'));
  N.win.ma2NewsRow('wk2382-5'); assert.equal(N.open, '');
});

// Mutation: the player tile does not filter, or a picked tile keeps the idle edge.
test('player tiles filter the list (one player, then both again); the picked tile is lifted, never blue', () => {
  const N = ok();
  N.win.ma2NewsPlayer('p2');
  const h = N.buildNewsSection(M);
  assert.ok(!h.includes('Sinner injury: newest piece') && h.includes('Alcaraz injury piece'));
  assert.match(h, /onclick="ma2NewsPlayer\('p2'\)" title="Show both players" style="[^"]*border:1px solid color-mix\(in srgb, var\(--ma2-white\) 22%, transparent\)/);
  N.win.ma2NewsPlayer('p2'); assert.equal(N.filter, 'all');
});

// Mutation: the category counts or the category filter stop reading the item category, or the tile loses its injury note.
test('categories: All / Match Reports / Quotes / Withdrawals & Injuries with counts; a pick filters', () => {
  const N = ok(FEED, REPORT), h = N.buildNewsSection(M);
  assert.match(text(h), /All 5 Match Reports 1 Quotes 0 Withdrawals & Injuries 4/);
  assert.match(text(h), /J\. Sinner 3 articles Injury note/, 'the player tile carries the injury note');
  N.win.ma2NewsCat('Match Reports');
  const f = N.buildNewsSection(M);
  assert.ok(f.includes('C. Alcaraz beat C. Ruud') && !f.includes('Sinner injury: newest piece'));
});

// Mutation: a literal colour in the tab, or text in the blue token anywhere but the "Read more" link.
test('colour: tokens only; blue text only on the Read more link', () => {
  const code = NEWS_V2.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  assert.ok(code.length > 5000, 'the News section of match-analysis-v2.js');
  assert.deepEqual(code.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || [], []);
  assert.equal([...code.matchAll(/[^-]color:var\(--ma2-blue\)/g)].length, 1, 'one blue text colour');
  assert.match(code, /class="seg ma2-ulink"[^\n]*?color:var\(--ma2-blue\)/, '… on the ma2-ulink Read more / Show less');
});

// Mutation: the pane inherits the modal body's type.
test('type: the News pane is 16px / line-height normal / "Hanken Grotesk", sans-serif', () => {
  const s = /class="ma2-news" style="([^"]*)"/.exec(ok().buildNewsSection(M))[1];
  assert.ok(s.includes("font-family:'Hanken Grotesk',sans-serif; font-size:16px; line-height:normal;"), s);
});

// modal-news.md: the count's tooltip states its denominator and population. The shipped wording is "n of N articles in
// the news feed, last 5 days" (the rules file says "in the ATP news feed"); N = every in-window item on the tab's
// population (Tour News out), Djokovic's included. Mutation: the tile count's tooltip dropped, or N = the player's own n.
test('count: the player tile\'s article count carries its denominator and population on a tooltip', () => {
  const h = ok().buildNewsSection(M);
  assert.match(h, /<span title="3 of 5 articles in the news feed, last 5 days"[^>]*>3 articles</, 'Sinner: 3 of the 5 in-window items');
  assert.match(h, /<span title="1 of 5 articles in the news feed, last 5 days"[^>]*>1 article</, 'Alcaraz: 1 of 5');
});

// Mutation: the tab builder no longer returns its load, or a new match keeps the previous open row.
test('lazy: the News builder returns the feed load, so Download report waits for it', () => {
  const b = /\n  news\(m\)\{[\s\S]*?\n  \},/.exec(html);
  assert.ok(b, 'A_TAB_BUILD.news');
  assert.ok(/\n    return Promise\.all\(\[ensureNewsData\(\)/.test(b[0]));
  assert.ok(html.includes("_aNewsFilter = 'all'; _aNewsOpen = '';"), 'a new match opens with nothing expanded');
});

// Mutation: the row id written into its attribute unescaped (a quote in a feed key breaks out).
test('escaping: a feed key with quotes cannot break out of the row attribute', () => {
  const h = ok({ articles: [Object.assign(art(2072, 1, 'Sinner injury: "ready"'), { news_key: 'x" onmouseover="alert(1)' })] }).buildNewsSection(M);
  assert.ok(!/onmouseover="alert/.test(h), 'no injected attribute');
  assert.ok(/data-id="wx&quot; onmouseover=&quot;alert\(1\)"/.test(h));
});

// Mutation: a stored feed without an articles array reads as ok (silent empty, review finding 2).
test('feed check: a stored feed without an articles array is not "ok" — the tab refetches or shows unavailable', async () => {
  const N = load({ fetch: () => Promise.resolve({ ok: false, status: 503 }) });
  N.feed = { generatedAt: 'x' };
  await N.ensureNewsData();
  assert.equal(N.state, 'unavailable');
  assert.ok(html.includes("    _aNewsState = (_newsData && Array.isArray(_newsData.articles)) ? 'ok' : 'load';   // = aNewsFeedOk()"), 'the tab builder uses the same check');
});
