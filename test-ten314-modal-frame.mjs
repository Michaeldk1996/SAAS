// TEN-314 (TEN-312 Phase 1): the Match analysis modal's frame, header and left menu as the design FILE draws
// them, the founder's D5 ruling, the Download report print, per-tab lazy building, and "no fixture code in the deployed bundle".
// Every check names the mutation that turns it red; tools/test-ten314-mutants.js applies each one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(process.env.TEN314_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const DF = readFileSync(join(HERE, 'design/handoff-ten312-match-analysis/Match Analysis Progression v1.dc.html'), 'utf8');

// ---- helpers ----
function slice(name, src = HTML) {
  const start = src.indexOf(`\nfunction ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let d = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; }
  return src.slice(start, i + 1);
}
function objSrc(decl, src = HTML) {                  // a `const X = { … };` object literal, brace-matched
  const start = src.indexOf(`\n${decl} = {`);
  assert.ok(start > 0, `${decl} not found`);
  let d = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; }
  return src.slice(start, i + 2);
}
// The declarations EVERY rule with exactly this selector sets, merged in document order (later wins — the cascade
// for equal specificity), so an override further down the file is seen. Rules inside @media print are skipped.
function rule(sel, src = HTML) {
  const out = {}; let at = -1, n = 0;
  const printAt = src.indexOf('@media print{'), printEnd = src.indexOf('\n  }', printAt);
  while ((at = src.indexOf(`\n  ${sel}{`, at + 1)) > 0) {
    if (at > printAt && at < printEnd) continue;
    n++;
    const body = src.slice(src.indexOf('{', at) + 1, src.indexOf('}', at));
    body.split(';').forEach(d => { const k = d.slice(0, d.indexOf(':')).trim(); if (k) out[k] = d.slice(d.indexOf(':') + 1).trim(); });
  }
  assert.ok(n > 0, `rule ${sel} not found`);
  return out;
}
// The inline style of the DF element whose opening tag starts at `anchor` (first match).
function dfStyle(anchor) {
  const at = DF.indexOf(anchor); assert.ok(at > 0, `DF anchor ${anchor}`);
  const tag = DF.slice(at, DF.indexOf('>', at)); const m = tag.match(/style="([^"]*)"/); const out = {};
  m[1].split(';').forEach(d => { const k = d.slice(0, d.indexOf(':')).trim(); if (k) out[k] = d.slice(d.indexOf(':') + 1).trim(); });
  return out;
}

// Mutation: `max-width:1500px` → 1200px, `height:88vh` → max-height, radius 20 → 12, nav 238 → 196, blur dropped,
// z 80 → 100, padding 32 → 24 (each one alone turns this red).
test('frame: overlay, modal, header, body grid and menu carry the design FILE values (DF L85–123), not README §2', () => {
  const ov = dfStyle('<div style="position:fixed; inset:0; z-index:80;');
  const md = dfStyle('<div style="width:100%; max-width:1500px;');
  const hd = dfStyle('<div style="display:grid; grid-template-columns:1fr auto 1fr;');
  const bd = dfStyle('<div style="flex:1; min-height:0; display:grid; grid-template-columns:238px 1fr;');
  const nv = dfStyle('<div style="border-right:1px solid rgba(255,255,255,0.07); padding:16px 14px;');
  const o = rule('#analysisModal'), m = rule('.modal-analysis'), h = rule('.modal-analysis .ahead2'), b = rule('.modal-analysis .aanalysis-body-wrap'), n = rule('.modal-analysis .asidenav');
  assert.equal(o['z-index'], ov['z-index']); assert.equal(o.padding, ov.padding); assert.equal(o['backdrop-filter'], ov['backdrop-filter']);
  assert.equal(m['max-width'], md['max-width']); assert.equal(m.height, md.height); assert.equal(m['border-radius'], md['border-radius']);
  assert.ok(!('max-height' in m), 'the height is fixed, not a max');
  assert.equal(h['grid-template-columns'], hd['grid-template-columns']); assert.equal(h.gap, hd.gap); assert.equal(h.padding, hd.padding);
  assert.equal(b['grid-template-columns'], bd['grid-template-columns']);
  assert.equal(n.padding, nv.padding); assert.equal(n.gap, nv.gap);
  // colours of the frame (the transition exception keeps the design's source values until the token layer lands)
  const verbatim = HTML.slice(HTML.indexOf('<style id="design-verbatim-analysis">'));
  assert.ok(verbatim.includes('#analysisModal{ background:rgba(4,5,8,0.72); }'));
  assert.ok(verbatim.includes('box-shadow:0 40px 120px rgba(0,0,0,0.6)'));
});

// Mutation: reorder two menu items, or put back the old stroke-2 feather icons.
test('left menu: the 12 tabs in the file\'s order with the file\'s icon paths (TABS, DF L5306)', () => {
  const tabsSrc = DF.slice(DF.indexOf('  const TABS = ['), DF.indexOf('];', DF.indexOf('  const TABS = [')));
  const df = [...tabsSrc.matchAll(/\['([^']+)', '([^']+)'\]/g)].map(x => [x[1], x[2]]);
  assert.equal(df.length, 12);
  const rail = HTML.slice(HTML.indexOf('<div class="asidenav" id="aTabs">'), HTML.indexOf('asidenav-download', HTML.indexOf('<div class="asidenav" id="aTabs">')));
  const ours = [...rail.matchAll(/<path d="([^"]+)" stroke="currentColor" stroke-width="1\.7"[^>]*><\/path><\/svg><\/span>([^<]+)<\/div>/g)].map(x => [x[2], x[1]]);
  assert.deepEqual(ours, df);
});

// Mutation: drop the item's onclick, or drop `window.print()` from printAnalysisReport (founder 2026-09-28: D7 reversed —
// the item keeps the print, in the design's menu style).
test('Download report: the design\'s menu item calls printAnalysisReport, which prints', () => {
  const at = HTML.indexOf('<span class="asidenav-download"');
  assert.ok(at > 0, 'rendered');
  const tag = HTML.slice(at, HTML.indexOf('</span>', at));
  assert.ok(tag.includes('onclick="printAnalysisReport()"'), 'the item calls the report');
  assert.ok(tag.includes('<path d="M12 4v10m0 0l-4-4m4 4l4-4M5 19h14"'), 'the file\'s icon (DF L119)');
  assert.ok(/\n    window\.print\(\);\n/.test(slice('printAnalysisReport')), 'the report prints');
});

// Mutation: aBuildForReport skips unopened tabs (the report prints empty sections), or builds Market edge.
test('Download report: every unopened tab except Market edge is built first; opened ones are not rebuilt', async () => {
  const { api, log } = modalVM();
  api.openAnalysisModal('a'); api.aShowTab('form'); await flush();
  log.length = 0;
  await api.aBuildForReport();
  assert.deepEqual(api.built().sort(), ['form', 'h2h', 'key', 'matchstats', 'news', 'odds', 'overview', 'progression', 'style', 'tournament', 'weather']);
  assert.ok(!log.includes('build:form'), 'an opened tab is not rebuilt');   // (key repaints when Style's shards land — a repaint, not a build)
  assert.ok(!log.includes('load:marketedge'));
});

// Mutation: `const built = null;` in printAnalysisReport, or drop `built` from its Promise.all (the report prints
// before the unopened tabs have built and loaded — review 2026-09-28).
test('Download report: printing waits for the unopened tabs to build and load', async () => {
  const log = []; let release;
  const modal = { classList: { add: c => log.push('add:' + c), remove() {} } };
  const doc = { querySelector: () => modal, getElementById: () => null };
  const print = new Function('document', 'window', 'openWeatherTab', 'setTimeout', '_aWx', '_aWxMatch', 'buildWeatherSection', 'aBuildForReport',
    `${slice('printAnalysisReport')}; return printAnalysisReport;`)(
    doc, { addEventListener() {}, print: () => log.push('print') }, () => Promise.resolve(), () => {}, { ready: true }, null, () => '',
    () => new Promise(r => { release = r; }));
  const p = print();
  await flush(); await flush();
  assert.ok(!log.includes('print'), 'not printed while tabs load');
  release(); await p;
  assert.deepEqual(log, ['add:printing', 'print']);
});

// Mutation: drop `return` from a builder (the report stops waiting for that tab's load), or let a throwing builder escape.
test('Download report: aBuildForReport settles only after every tab load, and survives a throwing builder', async () => {
  const { api, pending } = modalVM({ hold: true });
  api.openAnalysisModal('a');
  while (pending.length) pending.shift()();                    // Key factors' own loads (built at open)
  let done = false; api.aBuildForReport().then(() => { done = true; });
  await flush();
  // release every held load except the Odds shard: the report must still be waiting on it
  for (const f of pending.splice(0).filter(f => { if (f.n === 'load:odds-shard') return true; f(); return false; })) pending.push(f);
  await flush(); await flush();
  assert.ok(!done, 'still waiting on the Odds shard');
  while (pending.length) pending.shift()(); await flush(); await flush();
  assert.ok(done);
  const t = modalVM({ throwOn: 'h2h' }); t.api.openAnalysisModal('a');
  await t.api.aBuildForReport();   // no throw
  assert.ok(t.api.built().includes('tournament'), 'tabs after the thrower still build');
});

// ---- D5: avatars ----
function avatar() {
  return new Function('playerInitials', 'profileLinkAttrs', 'atpPhotoFor', 'escapeHtml', 'photoCandidatesFor',
    `${slice('aAvatarHtml')}; return aAvatarHtml;`)(
    n => n.split(/\s+/).map(w => w[0]).join('').toUpperCase(), () => '',
    k => ({ 206173: 'https://www.atptour.com/-/media/alias/player-headshot/S0AG' })[k] || null,
    s => String(s), () => ['https://api.api-tennis.com/logo-tennis/x.jpg']);
}
// Mutation: aAvatarHtml reads photoCandidatesFor (the board's chain: ATP → Wikimedia → api-tennis) instead of atpPhotoFor.
test('D5: an aliased player renders the ATP headshot; a player without an alias renders the monogram, never another source', () => {
  const a = avatar();
  const withAlias = a('J. Sinner', 206173), none = a('C. Alcaraz', 999);
  assert.ok(/^<img [^>]*src="https:\/\/www\.atptour\.com\/-\/media\/alias\/player-headshot\/S0AG"/.test(withAlias));
  assert.ok(withAlias.includes(`onerror="avatarFallback(this,'JS')"`), 'a failed headshot degrades to the monogram');
  assert.equal(none, '<div class="avatar-fallback">CA</div>');
  assert.ok(!/api-tennis|wikimedia/i.test(withAlias + none));
  assert.ok(slice('openAnalysisModal').includes("aAvatarHtml(m.p1, m.p1Key)") && slice('openAnalysisModal').includes("aAvatarHtml(m.p2, m.p2Key)"));
});

// ---- per-tab lazy build ----
function modalVM(opts = {}) {
  const log = [], pending = [];
  const el = () => ({ innerHTML: '', style: {}, dataset: {}, classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } }, set textContent(v) { this._t = v; }, get textContent() { return this._t; } });
  const TABS = ['key', 'news', 'style', 'form', 'h2h', 'matchstats', 'progression', 'overview', 'tournament', 'weather', 'odds', 'marketedge'];
  const nav = Object.fromEntries(TABS.map(t => [t, Object.assign(el(), { dataset: { atab: t } })]));
  const sec = Object.fromEntries(TABS.map(t => [t, Object.assign(el(), { dataset: { asection: t } })]));
  const byId = {}; const get = id => (byId[id] = byId[id] || el());
  const document = {
    getElementById: get,
    querySelector: s => { let m = s.match(/data-atab="(\w+)"/); if (m) return nav[m[1]]; m = s.match(/data-asection="(\w+)"/); if (m) return sec[m[1]]; if (s.includes('.abody')) return get('abody'); return null; },
    querySelectorAll: s => s.includes('asidenav-item') ? Object.values(nav) : s.includes('asection') ? Object.values(sec) : [],
  };
  // opts.hold: loaders return promises the test settles (pending[]), to model a shard landing after a reopen
  const rec = n => (...a) => { log.push(n); if (!opts.hold) return Promise.resolve(a[0]); return new Promise(r => { const f = () => r(a[0]); f.n = n; pending.push(f); }); };
  const stubs = {
    buildKeyFactorsSection: m => { log.push('build:key'); log.push('paint:key:' + m.id); return 'K'; }, renderStyleSection: () => log.push('build:style'),
    buildFormSection: () => { log.push('build:form'); return 'F'; }, buildH2HSection: () => { log.push('build:h2h'); if (opts.throwOn === 'h2h') throw new Error('x'); return 'H'; },
    buildMatchStatsSection: () => { log.push('build:matchstats'); return ''; }, maMsSheetInit: () => {}, buildMatchProgressionSection: () => { log.push('build:progression'); return ''; },
    buildYearlyTables: () => { log.push('build:overview'); return ''; }, buildTournamentSection: () => { log.push('build:tournament'); return ''; },
    renderWeatherSection: () => log.push('build:weather'), openWeatherTab: rec('load:weather'), openMarketEdgeTab: () => log.push('load:marketedge'),
    buildOddsSection: () => { log.push('build:odds'); return ''; }, renderOddsSection: () => {}, renderNewsSection: () => log.push('build:news'),
    ensureFormRows: rec('load:form-shards'), ensureOddsMovement: rec('load:odds-shard'), loadStyleRadar: rec('load:style-radar'), ensurePsMatrix: rec('load:matrix'),
    ensureStyleMeetings: rec('load:style-meetings'), ensureMatchDna: rec('load:dna'), ensureNewsData: rec('load:news'),
    syncAnalysisLiveBar: () => {}, fhCloseSheet: () => {}, aHeaderOdds: () => ({ p1: '1.54', p2: '2.62' }), aAvatarHtml: () => '', profileLinkAttrs: () => '', openPlayerProfileFromMatch: () => {},
    h2hRoundLabel: () => 'Quarter-finals', aContextLine: () => 'ATP Washington · Quarter-finals', formatLiveScore: () => '', progressionRoundState: () => ({ state: 'shown' }),
    teTrack: undefined,
  };
  const names = Object.keys(stubs);
  const body = `
    let _aStyleMatch, _aPbpMatch, _aFormMatch, _aWxMatch, _aNewsMatch, _aNewsFilter, _me, _aOdds = { m: null }, _aLiveBarOn, _aMsInsetBanner, _aNewsState, _newsData = null, _maMsSheet = null; const _maRowReg = {};
    ${HTML.slice(HTML.indexOf('\nlet _aM = null;'), HTML.indexOf('\nconst A_TAB_BUILD = {'))}
    ${objSrc('const A_TAB_BUILD')}
    ${objSrc('const A_TAB_REVISIT')}
    ${slice('aBuildForReport')}
    ${slice('aShowTab')}
    ${slice('openAnalysisModal')}
    return { openAnalysisModal, aShowTab, aBuildForReport, built: () => [..._aBuilt] };`;
  const api = new Function('document', 'matches', ...names, body)(document, [{ id: 'a', p1: 'J. Sinner', p2: 'C. Alcaraz' }, { id: 'b', p1: 'X', p2: 'Y' }], ...names.map(n => stubs[n]));
  return { api, log, nav, pending };
}
const flush = () => new Promise(r => setTimeout(r, 0));

// Mutation: openAnalysisModal builds every tab (the pre-TEN-314 behaviour), or Key factors pre-loads the DNA / news files.
test('lazy: opening the modal builds and loads Key factors only; every other tab builds on its first open, once', async () => {
  const { api, log } = modalVM();
  const built = () => [...new Set(log.filter(x => x.startsWith('build:')))];   // a repaint after a shard lands is not a build
  api.openAnalysisModal('a'); await flush();
  assert.deepEqual(built(), ['build:key']);
  assert.deepEqual(log.filter(x => x.startsWith('load:')).sort(), ['load:form-shards', 'load:matrix', 'load:odds-shard', 'load:style-radar']);
  log.length = 0;
  api.aShowTab('style'); await flush();
  assert.deepEqual(log.filter(x => x.startsWith('load:')).sort(), ['load:dna', 'load:matrix', 'load:style-meetings', 'load:style-radar']);
  log.length = 0;
  api.aShowTab('news'); await flush();
  assert.deepEqual(built(), ['build:news']);
  log.length = 0;
  api.aShowTab('key'); api.aShowTab('news'); api.aShowTab('style'); await flush();
  assert.deepEqual(log, [], 'a revisit never rebuilds or refetches');
});

// Mutation: drop `_aBuilt.clear()` from openAnalysisModal (a second match would show the first match's tabs).
test('lazy: a new match starts with nothing built; it reopens on the last-used tab (design §6)', async () => {
  const { api, log, nav } = modalVM();
  api.openAnalysisModal('a'); api.aShowTab('form'); await flush();
  log.length = 0;
  api.openAnalysisModal('b'); await flush();
  assert.deepEqual([...new Set(log.filter(x => x.startsWith('build:')))], ['build:form'], 'the last-used tab, rebuilt for the new match');
  assert.deepEqual(api.built(), ['form']);
  assert.ok(nav.form.classList.contains('active') && !nav.key.classList.contains('active'));
});

// Mutation: drop the `_aM === m` half of aBuilt (a late shard of the previous match repaints the new one).
test('lazy: a shard that lands after the modal was reopened on another match never repaints it', async () => {
  const { api, log, pending } = modalVM({ hold: true });
  api.openAnalysisModal('a'); api.openAnalysisModal('b');
  log.length = 0;
  pending.forEach(f => f()); await flush(); await flush();
  assert.deepEqual(log.filter(x => x.startsWith('paint:key')), ['paint:key:b'], 'only the open match repaints');
});

// Mutation: drop A_TAB_REVISIT (Weather keeps a stale forecast and Market edge never retries until the modal reopens).
test('revisit: Weather re-reads and Market edge retries on every visit; other tabs do nothing', async () => {
  const { api, log } = modalVM();
  api.openAnalysisModal('a'); api.aShowTab('weather'); api.aShowTab('marketedge'); api.aShowTab('form'); await flush();
  log.length = 0;
  api.aShowTab('weather'); api.aShowTab('marketedge'); api.aShowTab('form'); await flush();
  assert.deepEqual(log, ['load:weather', 'load:marketedge']);
});

// Mutation: mxOpenCardStats back to openAnalysisModal(id) + aGoTab('matchstats') (Key factors built and fetched first).
test('a named tab opens directly: nothing else is built first', async () => {
  const { api, log } = modalVM();
  api.openAnalysisModal('a', 'matchstats'); await flush();
  assert.deepEqual([...new Set(log.filter(x => x.startsWith('build:')))], ['build:matchstats']);
  assert.ok(slice('mxOpenCardStats').includes("openAnalysisModal(id, 'matchstats');") && !slice('mxOpenCardStats').includes('aGoTab('));
});

// ---- nothing test-only ships ----
// The deploy step's literal `cp … _site/` list (pipeline.yml) is the deployed bundle.
function deployedFiles() {
  const yml = readFileSync(join(HERE, '.github/workflows/pipeline.yml'), 'utf8');
  const files = new Set();
  for (const line of yml.split('\n')) {
    const m = line.match(/^\s*cp (?:-r )?(.+?) _site(?:\/\S*)?(?:\s|$)/); if (!m) continue;
    m[1].split(/\s+/).filter(t => t && !t.startsWith('-') && !t.includes('*') && !t.includes('$')).forEach(t => files.add(t));
  }
  return [...files].filter(f => existsSync(join(HERE, f)) && statSync(join(HERE, f)).isFile());
}
const FIXTURE_MARKERS = [/\bmkPr\b/, /\bSAMPLE_NEWS\b/, /\bdemoMatch\b/, /TEN312_FIXTURE/, /ten312-(design|build)-capture/, /handoff-ten312-match-analysis/];
// Mutation: add `function mkPr(){}` (or a SAMPLE_NEWS table, or the fixture flag) to bsp-consult-dashboard.html.
test('the deployed allowlist carries no fixture mode, no mkPr, no sample tables, no SAMPLE_NEWS', () => {
  const files = deployedFiles();
  assert.ok(files.includes('bsp-consult-dashboard.html') && files.length > 20, `parsed the allowlist (${files.length} files)`);
  assert.ok(!files.some(f => f.startsWith('design/') || f.startsWith('tools/')), 'no design bundle or test tool is copied');
  const hits = [];
  for (const f of files) {
    if (statSync(join(HERE, f)).size > 40e6) continue;
    const s = f === 'bsp-consult-dashboard.html' ? HTML : readFileSync(join(HERE, f), 'utf8');   // the mutant runner's copy
    FIXTURE_MARKERS.forEach(re => { if (re.test(s)) hits.push(`${f}: ${re}`); });
  }
  assert.deepEqual(hits, []);
});
