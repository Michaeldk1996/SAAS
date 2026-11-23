// TEN-333 — every check in test-ten333-news-tab.mjs must FAIL when the behaviour it locks is reverted. Each mutant is
// applied to a copy of match-analysis-v2.js (the rebuilt tab, maNewsV2; TEN333_V2) or bsp-consult-dashboard.html (the
// news data layer it reads; TEN333_HTML) and the suite is run against it; a mutant that leaves the suite green is a
// vacuous test and fails this runner. The suite's [GAP] checks (rules the rebuild does not meet yet) are run once on the
// unmutated code and reported; the mutants are judged with them skipped (TEN333_SKIP_GAPS), against a green baseline.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const SRC = { v2: fs.readFileSync(path.join(ROOT, 'match-analysis-v2.js'), 'utf8'), html: fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8') };
const ENV = { v2: 'TEN333_V2', html: 'TEN333_HTML' };
const MUTANTS = [
  ['v2', 'scope: oldest first', '.filter(x => x.hasA || x.hasB).sort((a, b) => b.ts - a.ts)', '.filter(x => x.hasA || x.hasB).sort((a, b) => a.ts - b.ts)'],
  ['v2', 'scope: player B\'s items dropped', 'hasB: m.p2Key != null && x.players.some(p => String(p.key) === kb)', 'hasB: false'],
  ['v2', 'attribution: the key ignored for player A', 'hasA: m.p1Key != null && x.players.some(p => String(p.key) === ka)', 'hasA: true'],
  ['v2', 'window: the rolling-window filter dropped', "isFinite(x.ts) && x.ts >= since)", 'isFinite(x.ts))'],
  ['v2', 'one story: the dedupe dropped', "if (seen.has(k)) return false;", ''],
  ['v2', 'Tour News back on the tab', "all.filter(x => x.cat !== 'Tour News' && ", 'all.filter(x => '],
  ['v2', 'N9: the empty copy names both players under a one-player filter', "whoN = filt === 'p1' ? m.p1 : filt === 'p2' ? m.p2 : m.p1 + ' or ' + m.p2", "whoN = m.p1 + ' or ' + m.p2"],
  ['v2', 'N9: the empty copy reworded', "'No recent news for ' + whoN + '.'", "'No news for this match yet.'"],
  ['v2', 'Q19: the player filter dropped when unavailable', "if (st === 'unavailable' && !items.length) body = nBox(", "if (st === 'unavailable' && !items.length) return wrap(nBox("],
  ['v2', 'unavailable: no Last checked line', "'Last checked <span style=\"' + MONO + '\">'", "'<span style=\"' + MONO + '\">'"],
  ['v2', 'no sample: the design fallback ported', "const NCATS = ['Match Reports'", "const STENNISFY_NEWS_FALLBACK = root.STENNISFY_NEWS;\n  const NCATS = ['Match Reports'"],
  ['v2', 'no time: an outlet Compact row shows its age', "const ago = x.kind === 'wire' ? '' : nAgo(x.ts);", 'const ago = nAgo(x.ts);'],
  ['v2', 'no time: the Reading line shows an outlet\'s HH:MM', "const nTime = x => x.kind === 'wire' ? '' : nHM(x.ts);", 'const nTime = x => nHM(x.ts);'],
  ['v2', 'no time: the hover drops "Added to feed"', "'<span title=\"' + esc(newsAddedLabel(x)) + '\" style=\"font-size:14px; font-weight:500;", "'<span style=\"font-size:14px; font-weight:500;"],
  ['v2', 'default view: Reading', "NW.id = m.id; NW.view = 'compact';", "NW.id = m.id; NW.view = 'reading';"],
  ['v2', 'expand: several rows open at once', "root.ma2NewsRow = id => { _aNewsOpen = _aNewsOpen === id ? '' : id; nRe(); };", "root.ma2NewsRow = id => { _aNewsOpen = _aNewsOpen === id ? '' : _aNewsOpen || id; nRe(); };"],
  ['v2', 'expand: the open row shows no body', "const inner = mo.paras.map(", 'const inner = [].map('],
  ['v2', 'tiles: the player tile does not filter', "root.ma2NewsPlayer = f => { _aNewsFilter = _aNewsFilter === f ? 'all' : f;", "root.ma2NewsPlayer = f => { _aNewsFilter = 'all';"],
  ['v2', 'tiles: the picked tile keeps the idle edge', "border:1px solid ' + (on ? W(22) : W(6)) + '; border-radius:16px; padding:16px 20px;", "border:1px solid ' + W(6) + '; border-radius:16px; padding:16px 20px;"],
  ['v2', 'categories: the counts ignore the category', "n: pool.filter(x => x.cat === c).length", 'n: pool.length'],
  ['v2', 'categories: the pick does not filter', "const feed = pool.filter(x => !NW.cat || x.cat === NW.cat)", 'const feed = pool'],
  ['v2', 'tiles: the injury note dropped', "injx = list.find(x => x.cat === 'Withdrawals & Injuries')", 'injx = null'],
  ['v2', 'colour: a literal colour on a player name', '<span class="mnname" style="font-size:13.5px; font-weight:700; color:var(--ma2-text);', '<span class="mnname" style="font-size:13.5px; font-weight:700; color:#6a9af8;'],
  ['v2', 'colour: a player name in the blue token', '<span class="mnname" style="font-size:13.5px; font-weight:700; color:var(--ma2-text);', '<span class="mnname" style="font-size:13.5px; font-weight:700; color:var(--ma2-blue);'],
  ['v2', 'type: the pane inherits the modal body type', " font-family:\\'Hanken Grotesk\\',sans-serif; font-size:16px; line-height:normal;\">' + inner", "\">' + inner"],
  ['v2', 'count: the tile count loses its population tooltip', "<span title=\"' + esc(list.length + ' of ' + tot + ' articles in the news feed, last ' + A_NEWS_WINDOW_DAYS + ' days') + '\" style=", "<span style="],
  ['v2', 'count: the denominator is the player\'s own n', "esc(list.length + ' of ' + tot + ' articles", "esc(list.length + ' of ' + list.length + ' articles"],
  ['v2', 'escaping: the row id unescaped', "const attrs = ' data-id=\"' + esc(x.id) + '\"", "const attrs = ' data-id=\"' + x.id + '\""],
  ['html', 'lazy: the builder no longer returns its load', '    return Promise.all([ensureNewsData(), (_newsTicker && _newsTicker.length) ? null : loadNewsTicker()]).then(() => { if (_aNewsMatch === m', '    Promise.all([ensureNewsData(), (_newsTicker && _newsTicker.length) ? null : loadNewsTicker()]).then(() => { if (_aNewsMatch === m'],
  ['html', 'lazy: a new match keeps the previous open row', "_aNewsFilter = 'all'; _aNewsOpen = '';", "_aNewsFilter = 'all';"],
  ['html', 'unavailable: a feed without an articles array accepted', "    if (!d || !Array.isArray(d.articles)) throw new Error('no articles array');\n", ''],
  ['html', 'unavailable: a failed fetch falls back to an empty feed', "  } catch (_) { _aNewsState = 'unavailable'; }\n}\nfunction renderNewsSection", "  } catch (_) { _newsData = { articles: [] }; _aNewsState = 'ok'; }\n}\nfunction renderNewsSection"],
  ['html', 'feed check: the tab builder trusts any stored feed', "    _aNewsState = (_newsData && Array.isArray(_newsData.articles)) ? 'ok' : 'load';", "    _aNewsState = _newsData ? 'ok' : 'load';"],
  ['html', 'feed check: any stored feed is ok', "function aNewsFeedOk(){ return !!(_newsData && Array.isArray(_newsData.articles)); }", "function aNewsFeedOk(){ return !!_newsData; }"],
  ['html', 'window: A_NEWS_WINDOW_DAYS widened', 'const A_NEWS_WINDOW_DAYS = 5;', 'const A_NEWS_WINDOW_DAYS = 7;'],
  ['html', 'no sample: the design fallback ported into the page', 'function aNewsFeedOk(){', 'const SAMPLE_NEWS = window.STENNISFY_NEWS;\nfunction aNewsFeedOk(){'],
];
const SUITE = path.join(ROOT, 'test-ten333-news-tab.mjs');
const run = env => spawnSync(process.execPath, ['--test', SUITE], { env: Object.assign({}, process.env, env), encoding: 'utf8' });
const gaps = run({});
const gapFails = [...new Set(gaps.stdout.match(/✖ \[GAP\][^\n(]*/g) || [])];
gapFails.forEach(g => console.error('✖ renderer gap (still fails on the unmutated code): ' + g.slice(2).trim()));
const base = run({ TEN333_SKIP_GAPS: '1' });
if (base.status !== 0) { console.error('✖ baseline red: the suite fails on the unmutated code (gaps skipped), so no mutant can be judged.\n' + base.stdout.slice(-3000)); process.exit(1); }
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten333-mut-'));
for (const [which, name, from, to] of MUTANTS) {
  if (SRC[which].split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, which === 'v2' ? 'm.js' : 'm.html');
  fs.writeFileSync(file, SRC[which].replace(from, () => to));
  const r = run({ TEN333_SKIP_GAPS: '1', [ENV[which]]: file });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived; renderer gaps: ${gapFails.length}`);
process.exit(survived || gapFails.length ? 1 : 0);
