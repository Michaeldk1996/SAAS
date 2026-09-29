// TEN-333 — every check in test-ten333-news-tab.mjs must FAIL when the behaviour it locks is reverted. Each mutant is
// applied to a copy of bsp-consult-dashboard.html and the suite is run against it (TEN333_HTML); a mutant that leaves
// the suite green is a vacuous test and fails this runner.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  ['groups: oldest first', '    .sort((x, y) => y.ts - x.ts);', '    .sort((x, y) => x.ts - y.ts);'],
  ['groups: the p2 group dropped', "  const showB = _aNewsFilter !== 'p1' && bArts.length > 0;", "  const showB = false;"],
  ['attribution: the headline resolver overrides player_key', "      if (a.player_key != null && a.player_key !== '') return key != null && String(a.player_key) === String(key);\n", ''],
  ['window: the rolling-window filter dropped', '      if (!(x.ts >= since)) return false;\n', ''],
  ['N9: the empty copy reworded', '        <span class="anews-empty-title" style="font-size:15px; color:var(--text);">No recent news for ${esc(who)}.</span>', '        <span class="anews-empty-title" style="font-size:15px; color:var(--text);">No news for this match yet.</span>'],
  ['N9: View all news dropped from the empty state', '</span>\n        ${viewAll()}\n      </div>`);', '</span>\n      </div>`);'],
  ['unavailable: a feed without an articles array accepted', "    if (!d || !Array.isArray(d.articles)) throw new Error('no articles array');\n", ''],
  ['unavailable: a failed fetch falls back to an empty feed', "  } catch (_) { _aNewsState = 'unavailable'; }\n}\nfunction renderNewsSection", "  } catch (_) { _newsData = { articles: [] }; _aNewsState = 'ok'; }\n}\nfunction renderNewsSection"],
  ['no sample: the design fallback ported', 'function aNewsSetFilter(f){', "const STENNISFY_NEWS_FALLBACK = window.STENNISFY_NEWS;\nfunction aNewsSetFilter(f){"],
  ['geometry: row padding 8px 6px', 'onclick="aNewsToggle(this.dataset.anewsKey)" style="display:flex; flex-direction:column; padding:9px 6px;">', 'onclick="aNewsToggle(this.dataset.anewsKey)" style="display:flex; flex-direction:column; padding:8px 6px;">'],
  ['geometry: grid date column 96', 'grid-template-columns:104px minmax(0,1fr) 16px; gap:12px; align-items:${open', 'grid-template-columns:96px minmax(0,1fr) 16px; gap:12px; align-items:${open'],
  ['geometry: body indent 104', 'padding:8px 16px 4px 116px;', 'padding:8px 16px 4px 104px;'],
  ['geometry: group name 13px', '<span class="anews-gname" style="font-size:13.5px;', '<span class="anews-gname" style="font-size:13px;'],
  ['filter: drawn in the sheet geometry', "maSeg('me', [['all', 'All']", "maSeg('sheet', [['all', 'All']"],
  ['expand: several articles open at once', "function aNewsToggle(key){ _aNewsOpen = _aNewsOpen === key ? '' : key; renderNewsSection(); }", "function aNewsToggle(key){ _aNewsOpen = _aNewsOpen === key ? '' : _aNewsOpen + '|' + key; renderNewsSection(); }"],
  ['expand: the open title keeps the one-line ellipsis', '<span class="anews-title" style="min-width:0; font-size:13.5px; font-weight:600; color:var(--text); line-height:1.4; text-wrap:pretty;">', '<span class="anews-title" style="min-width:0; font-size:13.5px; font-weight:600; color:var(--text); line-height:1.4; text-wrap:pretty; white-space:nowrap;">'],
  ['expand: the caret does not turn', "justify-self:end;${open ? ' transform:rotate(180deg);' : ''}", "justify-self:end;"],
  ['when: a 2-digit day', "toLocaleDateString('en-US', { month:'short', day:'numeric', timeZone:newsTz() })", "toLocaleDateString('en-US', { month:'short', day:'2-digit', timeZone:newsTz() })"],
  ['colour: the old p1 periwinkle on a group name', '<span class="anews-gname" style="font-size:13.5px; font-weight:700; color:var(--text);', '<span class="anews-gname" style="font-size:13.5px; font-weight:700; color:#6a9af8;'],
  ['colour: group name in the link blue', '<span class="anews-gname" style="font-size:13.5px; font-weight:700; color:var(--text);', '<span class="anews-gname" style="font-size:13.5px; font-weight:700; color:var(--periwinkle);'],
  ['colour: the hover rule back to a literal', '#aSectionNews .anews-row:hover{ border-color:var(--ma-outline); background:var(--ma-hover); }', '#aSectionNews .anews-row:hover{ border-color:rgba(91,155,255,0.22); background:rgba(255,255,255,0.02); }'],
  ['type: the pane inherits the modal body type', " font-family:'Hanken Grotesk',sans-serif; font-size:16px; line-height:normal;\">${filters}", "\">${filters}"],
  ['count: the population tooltip dropped', '<span class="anews-gcount" tabindex="0" data-aotip="${esc(esc(pop))}" style=', '<span class="anews-gcount" style='],
  ['lazy: the builder no longer returns its load', '    return ensureNewsData().then(() => { if (_aNewsMatch === m', '    ensureNewsData().then(() => { if (_aNewsMatch === m'],
  ['lazy: a new match keeps the previous open article', "_aNewsFilter = 'all'; _aNewsOpen = '';", "_aNewsFilter = 'all';"],
  ['escaping: attributes via newsEscape', "  const esc = escapeHtml;   // quotes too: the key and tooltips sit in attributes", "  const esc = newsEscape;"],
  ['feed check: the tab builder trusts any stored feed', "    _aNewsState = (_newsData && Array.isArray(_newsData.articles)) ? 'ok' : 'load';", "    _aNewsState = _newsData ? 'ok' : 'load';"],
  ['feed check: any stored feed is ok', "function aNewsFeedOk(){ return !!(_newsData && Array.isArray(_newsData.articles)); }", "function aNewsFeedOk(){ return !!_newsData; }"],
  ['hover: View all loses !important', "#aSectionNews .anews-viewall:hover{ color:var(--ma-link-hover) !important; }", "#aSectionNews .anews-viewall:hover{ color:var(--ma-link-hover); }"],
  ['hover: caret loses !important', "#aSectionNews .anews-row:hover .anews-caret{ color:var(--text) !important; }", "#aSectionNews .anews-row:hover .anews-caret{ color:var(--text); }"],
];
const SUITES = ['test-ten333-news-tab.mjs'];
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten333-mut-'));
for (const [name, from, to] of MUTANTS) {
  if (html.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, html.replace(from, () => to));
  const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, { TEN333_HTML: file }), encoding: 'utf8' });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
