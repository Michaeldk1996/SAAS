// TEN-333 (TEN-312 tab: News): the Match analysis News tab rebuilt on the design file (`Match Analysis Progression
// v1.dc.html` newsFor DF L2317–2400, template DF L2202–2248) and wired to the real rolling 5-day feed (news-feed.json).
// The SHIPPED builders are sliced out of bsp-consult-dashboard.html and executed on a fixture feed; geometry is compared
// with the design file's own inline styles, never with numbers typed into this test.
// Every check names the mutation that turns it red; tools/test-ten333-mutants.js applies each one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN333_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const DF = readFileSync(join(HERE, 'design/handoff-ten312-match-analysis/Match Analysis Progression v1.dc.html'), 'utf8');
function slice(name, kw = 'function') {
  const start = html.indexOf(`\n${kw} ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let d = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; }
  return html.slice(start, i + 1);
}
function constSrc(name) {
  const start = html.indexOf(`\nconst ${name} = `);
  assert.ok(start > 0, `const ${name} not found`);
  return html.slice(start, html.indexOf(';\n', start) + 1);
}
// the News block, from its header comment to the next section (the tab's own state lives there)
const BLOCK = (() => {
  const a = html.indexOf('/* ---------- Match Analysis modal: News tab'), b = html.indexOf('// The board match as a sheet entry: header from');   // TEN-338 deleted the §2 score header that followed
  assert.ok(a > 0 && b > a, 'News block');
  return html.slice(a, b);
})();
const NOW = Date.parse('2026-09-28T12:00:00Z');
const escDoc = { getElementById: () => null, createElement: () => { let t = ''; return { set textContent(v) { t = v; }, get innerHTML() { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } }; } };
function load(opts = {}) {
  const f = new Function('document', 'fetch', 'Date', 'localStorage', 'closeAnalysisModal', `
    let _newsData = null;
    function newsProfileRoster(){ return { surnameToKeys: new Map(${JSON.stringify(opts.roster || [])}.map(([s, k]) => [s, new Set([k])])), keyToName: new Map(${JSON.stringify((opts.roster || []).map(([s, k, n]) => [k, n]))}) }; }
    ${constSrc('MA_SEG')}
    ${['escapeHtml', 'maSeg', 'newsTz', 'newsFmtTime', 'newsFmtDateTime', 'newsParseTs', 'newsEscape', 'newsSplitParas', 'newsPlayerFor'].map(n => slice(n)).join('\n')}
    ${BLOCK}
    return { set feed(v) { _newsData = v; }, get feed() { return _newsData; }, set state(v) { _aNewsState = v; }, get state() { return _aNewsState; },
      set filter(v) { _aNewsFilter = v; }, set open(v) { _aNewsOpen = v; }, get open() { return _aNewsOpen; },
      buildNewsSection, ensureNewsData, aNewsArticlesFor, aNewsWhen, aNewsToggle, A_NEWS_WINDOW_DAYS };
  `);
  class D extends Date { constructor(...a) { if (a.length) super(...a); else super(NOW); } static now() { return NOW; } }
  const ls = { getItem: () => opts.tz || 'UTC' };
  return f(escDoc, opts.fetch || (() => Promise.reject(new Error('offline'))), D, ls, () => {});
}
const ts = (hAgo) => { const d = new Date(NOW - hAgo * 3600e3); return d.toISOString().replace('T', ' ').replace('Z', ''); };
const M = { p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: 2072, p2Key: 2382 };
const art = (key, hAgo, title, content = 'First para.\n\nSecond para.') => ({ news_key: 'k' + key + '-' + hAgo, player_key: key, published_at: ts(hAgo), title, content });
const FEED = { articles: [
  art(2072, 30, 'Sinner older piece'), art(2072, 2, 'Sinner newest piece'), art(2072, 10, 'Sinner middle piece'),
  art(2382, 5, 'Alcaraz piece'), art(1905, 1, 'Djokovic unrelated'),
] };
const decl = style => Object.fromEntries(style.split(';').map(d => d.trim()).filter(Boolean).map(d => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]));
const styleOf = (h, cls) => { const m = new RegExp(`class="${cls}"[^>]*style="([^"]*)"`).exec(h) || new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"[^>]*style="([^"]*)"`).exec(h); assert.ok(m, cls); return decl(m[1]); };
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const dfStyle = (re) => { const m = re.exec(DF); assert.ok(m, String(re)); return decl(m[1]); };
const ok = () => { const N = load(); N.feed = FEED; N.state = 'ok'; return N; };

// Mutation: sort oldest-first, or drop the p2 group / the player_key join (an unrelated player's article attributed).
test('groups: one per player with articles, newest first, joined on player_key', () => {
  const N = ok(), h = N.buildNewsSection(M);
  const names = [...h.matchAll(/class="anews-gname"[^>]*>([^<]*)</g)].map(m => m[1]);
  assert.deepEqual(names, ['J. Sinner', 'C. Alcaraz']);
  const titles = [...h.matchAll(/class="anews-title"[^>]*>([^<]*)</g)].map(m => m[1]);
  assert.deepEqual(titles, ['Sinner newest piece', 'Sinner middle piece', 'Sinner older piece', 'Alcaraz piece']);
  assert.ok(!h.includes('Djokovic'), 'an article keyed to another player never shows');
  assert.deepEqual([...h.matchAll(/class="anews-gcount"[^>]*>(\d+)</g)].map(m => +m[1]), [3, 1]);
});

// Mutation: the headline resolver runs even when the row carries a player_key (the key is the join; the resolver is only
// the fallback for rows without one).
test('attribution: player_key wins; the fail-closed headline resolver only covers rows without a key', () => {
  const N = load({ roster: [['sinner', 2072, 'J. Sinner'], ['alcaraz', 2382, 'C. Alcaraz']] });
  N.state = 'ok';
  N.feed = { articles: [art(1905, 1, 'Sinner beaten by Djokovic'), { news_key: 'x', player_key: null, published_at: ts(3), title: 'Alcaraz eyes Beijing' }] };
  const h = N.buildNewsSection(M);
  assert.ok(!h.includes('Sinner beaten'), 'keyed to 1905 → not Sinner, whatever the headline says');
  assert.ok(h.includes('Alcaraz eyes Beijing'), 'no key → the resolver attributes it');
});

// Mutation: the rolling-window filter dropped (a stale feed would show week-old news as "recent").
test('window: only articles from the last 5 days show (the feed\'s own window)', () => {
  const N = load(); N.state = 'ok';
  N.feed = { articles: [art(2072, 24 * 4, 'four days'), art(2072, 24 * 6, 'six days')] };
  const h = N.buildNewsSection(M);
  assert.equal(N.A_NEWS_WINDOW_DAYS, 5);
  assert.ok(h.includes('four days') && !h.includes('six days'));
  assert.ok(/of 1 article in the ATP news feed, last 5 days/.test(h), 'the population on the count counts the window only');
});

// Mutation: the empty copy reworded, or View all news dropped (N9: the file's copy).
test('N9 empty state: "No recent news for {A} or {B}." + "View all news →", no group, no sample', () => {
  const N = load(); N.state = 'ok'; N.feed = { articles: [] };
  const h = N.buildNewsSection(M);
  const want = /emptyTitle: 'No recent news for ' \+ AN\.aName \+ ' or ' \+ AN\.bName \+ '\.'/;
  assert.ok(want.test(DF), 'the file\'s copy');
  assert.ok(text(h).includes('No recent news for J. Sinner or C. Alcaraz.'));
  assert.ok(text(h).includes('View all news →') && h.includes('onclick="aNewsViewAll()"'));
  assert.ok(!h.includes('anews-gname') && !/sample/i.test(h));
  // a one-player filter names that player only (the file's sentence would deny the other player's articles)
  const F = ok(); F.filter = 'p1'; F.feed = { articles: [art(2382, 5, 'Alcaraz piece')] };
  assert.ok(text(F.buildNewsSection(M)).includes('No recent news for J. Sinner.'));
});

// Mutation: ensureNewsData accepts a feed without an articles array, or a failed fetch falls back to anything but the
// unavailable state.
test('unavailable: a failed or malformed feed shows the file\'s "News feed unavailable." — never a sample', async () => {
  for (const fetch of [() => Promise.resolve({ ok: false, status: 503 }), () => Promise.resolve({ ok: true, text: () => Promise.resolve('{"generatedAt":"x"}') })]) {
    const N = load({ fetch }); N.state = 'load';
    await N.ensureNewsData();
    assert.equal(N.state, 'unavailable');
    assert.equal(N.feed, null);
    const h = N.buildNewsSection(M);
    assert.ok(text(h).includes('News feed unavailable.') && /Last checked \d\d:\d\d:\d\d ?\./.test(text(h)));
    assert.ok(!/sample/i.test(h));
  }
  const G = load({ fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(FEED)) }) });
  await G.ensureNewsData();
  assert.equal(G.state, 'ok');
});

// Mutation: the design's sample fallback ported (SAMPLE_NEWS / window.STENNISFY_NEWS / "Sample:" rows in the page).
test('no sample: the design\'s sample table and its fallback are not in the page', () => {
  assert.ok(DF.includes('const SAMPLE_NEWS = ['), 'control: the file carries one');
  for (const re of [/\bSAMPLE_NEWS\b/, /STENNISFY_NEWS/, /Sample: \$\{/]) assert.ok(!re.test(html), String(re));
});

// Mutation: row / grid / group-header geometry drifts from the file (e.g. row padding 9px 6px → 8px 6px, grid 104 → 96).
test('geometry: rows, grid, group header and body read the file\'s inline values', () => {
  const N = ok(); N.open = 'p1:k2072-2';
  const h = N.buildNewsSection(M);
  const pick = (o, ks) => Object.fromEntries(ks.map(k => [k, o[k]]));
  const dfRow = dfStyle(/<div class="wirerow" onClick="\{\{ a\.onToggle \}\}" style="([^"]*)"/);
  assert.deepEqual(pick(styleOf(h, 'anews-row'), ['display', 'flex-direction', 'padding']), pick(dfRow, ['display', 'flex-direction', 'padding']));
  const dfGrid = dfStyle(/<sc-if value="\{\{ a\.closed \}\}"[^>]*>\s*<div style="([^"]*)"/);
  const closedGrid = [...h.matchAll(/class="anews-grid" style="([^"]*)"/g)].map(m => decl(m[1]));
  assert.deepEqual(pick(closedGrid[1], ['display', 'grid-template-columns', 'gap', 'align-items']), pick(dfGrid, ['display', 'grid-template-columns', 'gap', 'align-items']));
  const dfOpenGrid = dfStyle(/<sc-if value="\{\{ a\.open \}\}"[^>]*>\s*<div style="([^"]*)"/);
  assert.deepEqual(pick(closedGrid[0], ['grid-template-columns', 'gap', 'align-items']), pick(dfOpenGrid, ['grid-template-columns', 'gap', 'align-items']));
  const dfWhen = dfStyle(/<span title="\{\{ a\.absolute \}\}" style="([^"]*white-space:nowrap;)">/);
  assert.deepEqual(pick(styleOf(h, 'anews-when'), ['font-size', 'white-space']), pick(dfWhen, ['font-size', 'white-space']));
  const dfName = dfStyle(/<span style="([^"]*)">\{\{ g\.name \}\}/), dfCount = dfStyle(/<span style="([^"]*)">\{\{ g\.count \}\}/);
  assert.deepEqual(pick(styleOf(h, 'anews-gname'), ['font-size', 'font-weight', 'white-space']), pick(dfName, ['font-size', 'font-weight', 'white-space']));
  assert.deepEqual(pick(styleOf(h, 'anews-gcount'), ['font-size']), pick(dfCount, ['font-size']));
  const dfBody = dfStyle(/<div style="([^"]*)">\s*<sc-for list="\{\{ a\.paras \}\}"/), dfPara = dfStyle(/<div style="([^"]*)">\{\{ p\.t \}\}/);
  assert.deepEqual(pick(styleOf(h, 'anews-body'), ['gap', 'padding']), pick(dfBody, ['gap', 'padding']));
  assert.deepEqual(pick(styleOf(h, 'anews-para'), ['font-size', 'line-height', 'max-width']), pick(dfPara, ['font-size', 'line-height', 'max-width']));
});

// Mutation: the filter drawn in another seg geometry (e.g. maSeg('sheet') — track padding 3, radius 9, 11px items).
test('filter: the file\'s segmented control (DF L2204 = the Market edge geometry), All / A / B, selected = the tile', () => {
  const N = ok(); N.filter = 'p2';
  const h = N.buildNewsSection(M);
  const m = /<div class="ma-seg"[^>]*style="([^"]*)">(.*?)<\/div>/.exec(h);
  const track = decl(m[1]), items = [...m[2].matchAll(/style="([^"]*)">([^<]*)</g)].map(x => [decl(x[1]), x[2]]);
  const df = /<div style="([^"]*)"><sc-for list="\{\{ analysis\.news\.filters \}\}"[^>]*><span class="seg"[^>]*style="([^"]*)"/.exec(DF);
  const dt = decl(df[1]), di = decl(df[2]);
  for (const k of ['gap', 'padding', 'border-radius']) assert.equal(track[k], dt[k], 'track ' + k);
  for (const k of ['padding', 'border-radius', 'font-size']) assert.equal(items[0][0][k], di[k], 'item ' + k);
  assert.deepEqual(items.map(i => i[1]), ['All', 'J. Sinner', 'C. Alcaraz']);
  assert.deepEqual(items.map(i => i[0]['font-weight']), ['600', '600', '700']);
  assert.ok(!text(h).includes('Sinner newest piece') && text(h).includes('Alcaraz piece'), 'p2 filter shows p2 only');
});

// Mutation: several articles open at once, or an open row keeps the one-line ellipsis title / unrotated caret.
test('expand: one article open at a time (DF maNewsOpen); open = wrapped title, turned caret, body paragraphs', () => {
  const N = ok();
  N.aNewsToggle('p1:k2072-2'); N.aNewsToggle('p2:k2382-5');
  assert.equal(N.open, 'p2:k2382-5');
  const h = N.buildNewsSection(M);
  assert.equal((h.match(/class="anews-row open"/g) || []).length, 1);
  assert.equal((h.match(/class="anews-body"/g) || []).length, 1, 'closed rows render no body');
  const openRow = h.slice(h.indexOf('class="anews-row open"'));
  const t = styleOf(openRow, 'anews-title'), c = styleOf(openRow, 'anews-caret');
  assert.ok(!('white-space' in t) && t['line-height'] === '1.4' && t['text-wrap'] === 'pretty');
  assert.equal(c.transform, 'rotate(180deg)');
  assert.deepEqual([...openRow.matchAll(/class="anews-para"[^>]*>([^<]*)</g)].map(m => m[1]), ['First para.', 'Second para.']);
  N.aNewsToggle('p2:k2382-5'); assert.equal(N.open, '');
});

// Mutation: the date drawn with a 2-digit day ("Sep 08") or a 12-hour clock.
test('when: the file\'s "Sep 8 · 07:37" (en-US short month + numeric day, en-GB 24 h), in the member\'s zone', () => {
  assert.ok(/toLocaleDateString\('en-US', this\.newsTzOpt\(\{ month: 'short', day: 'numeric' \}\)\)/.test(DF), 'control: the file');
  const N = load({ tz: 'UTC' });
  assert.equal(N.aNewsWhen(Date.parse('2026-09-08T19:37:00Z')), 'Sep 8 · 19:37');
  assert.equal(N.aNewsWhen(NaN), '—');
});

// Mutation: a literal colour in the News block (e.g. the old p1 periwinkle `#6a9af8` on a group name), or a player's group
// name in the link blue (D4: both players neutral).
test('colour: tokens only; both group names primary text; blue only on View all and the selected tile', () => {
  const code = BLOCK.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  assert.deepEqual(code.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || [], []);
  const h = ok().buildNewsSection(M);
  for (const s of [...h.matchAll(/class="anews-gname" style="([^"]*)"/g)].map(m => decl(m[1]))) assert.equal(s.color, 'var(--text)');
  assert.equal(styleOf(h, 'seg anews-viewall').color, 'var(--periwinkle)');
  const css = html.slice(html.indexOf('/* News tab (TEN-333)'), html.indexOf('.modal-analysis .asection.active'));
  assert.ok(css.includes('#aSectionNews .anews-row:hover{ border-color:var(--ma-outline); background:var(--ma-hover); }'), 'the file\'s .wirerow hover, tokens');
  assert.deepEqual(css.match(/#[0-9a-fA-F]{3,8}\b(?![\w-])(?<!#aSectionNews)/g)?.filter(x => x !== '#aSectionNews') || [], []);
});

// Mutation: the pane inherits the modal body's 14px / 1.5 / system-ui (every row 2.25 px taller, the caret glyph from
// another font — the pixel diff's first divergence).
test('type: the News pane is 16px / line-height normal / "Hanken Grotesk", sans-serif like the file\'s content column', () => {
  const s = styleOf(ok().buildNewsSection(M), 'anews');
  assert.deepEqual([s['font-size'], s['line-height'], s['font-family']], ['16px', 'normal', "'Hanken Grotesk',sans-serif"]);
});

// Mutation: the count's population tooltip dropped (every count carries its denominator and population).
test('count: the group count carries its denominator and population on the tooltip', () => {
  const h = ok().buildNewsSection(M);
  assert.ok(h.includes('data-aotip="3 of 5 articles in the ATP news feed, last 5 days"'), 'Sinner: 3 of the 5 in-window articles, on the shared tooltip');
});

// Mutation: the tab builder no longer returns its load (Download report would print the loading line).
test('lazy: the News builder returns the feed load, so Download report waits for it', () => {
  const b = /\n  news\(m\)\{[\s\S]*?\n  \},/.exec(html);
  assert.ok(b, 'A_TAB_BUILD.news');
  assert.ok(/\n    return ensureNewsData\(\)\.then\(/.test(b[0]));
  assert.ok(html.includes("_aNewsFilter = 'all'; _aNewsOpen = '';"), 'a new match opens with nothing expanded');
});

// Mutation: attributes escaped with newsEscape (no quotes) — an unkeyed headline with a quote breaks the row key or
// injects an attribute (review finding 1).
test('escaping: a headline with quotes cannot break out of the row key or the tooltip', () => {
  const N = load({ roster: [['sinner', 2072, 'J. Sinner']] }); N.state = 'ok';
  N.feed = { articles: [{ player_key: null, published_at: ts(1), title: 'Sinner: "I\'m ready" x" onmouseover="alert(1)', content: '' }] };
  const h = N.buildNewsSection(M);
  assert.ok(!/onmouseover="alert/.test(h), 'no injected attribute');
  const key = /data-anews-key="([^"]*)"/.exec(h)[1];
  assert.ok(key.includes('&quot;') && key.includes('&#39;'), key);
});

// Mutation: a feed the News page stored without an articles array reads as ok (silent empty, review finding 2).
test('feed check: a stored feed without an articles array is not "ok" — the tab refetches or shows unavailable', async () => {
  const N = load({ fetch: () => Promise.resolve({ ok: false, status: 503 }) });
  N.feed = { generatedAt: 'x' };
  await N.ensureNewsData();
  assert.equal(N.state, 'unavailable');
  assert.ok(html.includes("    _aNewsState = (_newsData && Array.isArray(_newsData.articles)) ? 'ok' : 'load';   // = aNewsFeedOk()"), 'the tab builder uses the same check');
});

// Mutation: a hover rule without !important — the inline colour wins and the design's style-hover never shows (finding 3).
test('hover: View all and the caret hover rules beat their inline colours', () => {
  const css = html.slice(html.indexOf('/* News tab (TEN-333)'), html.indexOf('.modal-analysis .asection.active'));
  assert.ok(/#aSectionNews \.anews-viewall:hover\{ color:var\(--ma-link-hover\) !important; \}/.test(css));
  assert.ok(/#aSectionNews \.anews-row:hover \.anews-caret\{ color:var\(--text\) !important; \}/.test(css));
});
