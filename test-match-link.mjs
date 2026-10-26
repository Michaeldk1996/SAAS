// Brief 2026-10-26 item 4 — per-match links: #match/<id>[/<tab>] opens that match card; opening a card writes its link.
//   a pasted link opens its match (and tab)                 (mutant NO_OPEN: maApplyLink returns before opening)
//   an id the board does not hold opens nothing             (mutant ANY_ID: no matchById check)
//   an unknown tab falls back to the default open          (mutant ANY_TAB: the tab passed through unchecked)
//   opening writes the link; closing restores the page hash (mutant NO_RESTORE: maClearLink leaves the link)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.MLT_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
function slice(name) {
  const start = html.indexOf(`\nfunction ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let d = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; }
  return html.slice(start, i + 1);
}
const re = /\nconst MA_LINK_RE = [^\n]*\n/.exec(html)[0];
function env(hash, board) {
  const calls = [], loc = { hash, pathname: '/SAAS/', search: '' };
  const history = { replaceState: (_s, _t, u) => { loc.hash = u.replace(/^[^#]*/, ''); } };
  const body = [
    "const A_TAB_BUILD = { key: 1, h2h: 1, odds: 1, marketedge: 1 }; let _aM = null; let _maLinkPrev = null;",
    "const document = { getElementById: () => ({ classList: { contains: () => false } }) };",
    "function matchById(id) { return board.includes(id) ? { id } : null; }",
    "function openAnalysisModal(id, tab) { calls.push([id, tab]); _aM = { id }; maWriteLink(id, tab || 'odds'); }",
    re].concat(['maLinkOf', 'maWriteLink', 'maClearLink', 'maApplyLink'].map(slice))
    .concat(['return { maApplyLink, maWriteLink, maClearLink, maLinkOf };']).join('\n');
  const api = new Function('location', 'history', 'calls', 'board', body)(loc, history, calls, board);
  return { api, calls, loc };
}

test('a pasted #match/<id>[/<tab>] opens that match card; nothing else does', () => {
  let t = env('#match/upcoming-12173981/h2h', ['upcoming-12173981']);
  assert.equal(t.api.maApplyLink(), true);
  assert.deepEqual(t.calls, [['upcoming-12173981', 'h2h']], 'opens the match on its tab');
  t = env('#match/upcoming-12173981', ['upcoming-12173981']);
  t.api.maApplyLink();
  assert.deepEqual(t.calls, [['upcoming-12173981', undefined]], 'no tab: the default open');
  t = env('#match/upcoming-12173981/bogus', ['upcoming-12173981']);
  t.api.maApplyLink();
  assert.deepEqual(t.calls, [['upcoming-12173981', undefined]], 'an unknown tab is never passed on');
  t = env('#match/past-1', []);
  assert.equal(t.api.maApplyLink(), false); assert.deepEqual(t.calls, [], 'an id the board does not hold opens nothing');
  t = env('#Results', ['past-1']);
  assert.equal(t.api.maApplyLink(), false, '#Results is not a match link');
  assert.equal(env('', []).api.maLinkOf('past-12174011', 'odds'), '#match/past-12174011/odds');
});

test('opening writes the link (copyable), the tab follows, closing restores the page hash', () => {
  const t = env('#Results', ['past-12174011']);
  t.api.maWriteLink('past-12174011', 'odds');
  assert.equal(t.loc.hash, '#match/past-12174011/odds');
  t.api.maWriteLink('past-12174011', 'h2h');
  assert.equal(t.loc.hash, '#match/past-12174011/h2h', 'a tab switch rewrites the link');
  t.api.maClearLink();
  assert.equal(t.loc.hash, '#Results', 'closing gives the page its own hash back (mutant NO_RESTORE)');
});
