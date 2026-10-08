// TEN-401 (step 7 · Tournaments) group b — header card, the darker-track segmented helper, the Entry list tab and the
// step-6 Database carry-over. Every behavioural assertion EXECUTES the page's own functions (sliced out of
// bsp-consult-dashboard.html); CSS rulings read the shipped rule text. Each ruling has a mutant control that must go red.
//
//   1. Header (item 1): caps line, title 29/800, sub 13.5 --text-soft, Today's Matches card (12 / --top-light); stats
//      Events · This week · Updated only when all three are live (L4), otherwise the block is empty.
//   2. Darker track (item 2): sfSegHtml + .sf-seg — track --card + --edge-6, selected --inner + --edge-10 white 700,
//      idle --text-label, no blue; the page tabs and the Entry list week chips render through it.
//   3. Entry list (item 8): 6% row hairlines + --inner hover, tier chip --inner grey no edge, caret --inner grey ▾ /
//      white ▴ open, expanded panel --inner, tier heads on a 10% rule, table and empty state = card; names title-cased.
//   4. Database (step-6 carry-over): in a table with gated cells the All-row yield keeps its sign colour (Hangzhou Open,
//      50 matches: every band hard-gated, the All rows +1.54% / −3.04% in --pos / --neg).
//
// Round 1 founder fixes (TEN-401 r1, b):
//   r1.1 All row From / To span the side on BOTH sides: From = lowest band From, To = the top band's To as printed
//        (Hangzhou Open: Favourites 1.20 / 1.85, Underdogs 2.04 / 3.05+).
//   r1.2 band names never wrap (nowrap on the band cell); the band track's minimum holds "Narrow underdog" and the
//        Tournament row still fits the ROI overlay's band panel at 1512 (499px of content).
//   r1.4 "This week" = tourxThisWeekEvents() for the header AND the Entry list eyebrow; the current week is always the
//        first week chip (empty state when the shards hold nothing for it).
//   r1.5 every player row carries a rank: the list's own, else the current ATP standings (player-index), else a grey —.
//   r1.6 full names: a cut source name ("CERUNDOLO, Juan M…") is completed from the roster; unresolved = surname first so
//        the ellipsis sits at the end; the name cell ellipsises at the end only.
//   r1.7 no "published {date}" on an event row (neither shard holds the list's publication date).
//   r1.8 en dash in week ranges; empty state "…{n} events in the week of 2–8 Nov…".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const DATA = JSON.parse(readFileSync(join(HERE, 'database-yield.json'), 'utf8'));

function sliceFrom(src, sig, from = 0) {
  const i = src.indexOf(sig, from);
  if (i < 0) throw new Error(sig + ' is gone — this lock points at nothing');
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces slicing ' + sig);
}
const top = (src, name) => sliceFrom(src, '\nfunction ' + name + '(').slice(1);
const inEntry = (src, name) => sliceFrom(src, 'function ' + name + '(', src.indexOf('window.EntryListsTab = (function(){'));
const inDb = (src, name) => sliceFrom(src, 'function ' + name + '(', src.indexOf('window.DatabaseTab = (function(){'));
function cssRule(src, sel) {
  const i = src.indexOf('\n' + sel + '{');
  const j = i < 0 ? src.indexOf('  ' + sel + '{') : i;
  if (j < 0) throw new Error('CSS rule ' + sel + ' is gone');
  return src.slice(src.indexOf('{', j) + 1, src.indexOf('}', j));
}

// ------------------------------------------------------------------ 1. header card
function headerApi(src, env) {
  const code = 'const TOURX_HEAD_STATS = true;\n' + ['tourxThisWeekEvents', 'tourxHeadStatValues', 'tourxHeadStamp', 'tourxRenderHeadStats'].map(n => top(src, n)).join('\n')
    + '\nreturn { tourxHeadStatValues, tourxHeadStamp, tourxRenderHeadStats };';
  const win = { EntryListsTab: { currentWeekRows: () => (env.rows || []) } };
  return new Function('document', 'tourxConditionRegistry', 'tourxActiveWeekNames', 'tournamentProgression', 'tourxMarketData', 'newsTz', 'window', code)(
    env.document, env.reg, env.week, env.prog, env.mkt, () => 'UTC', win);
}
function checkHeader(src) {
  const head = /<div class="tourx-head">([\s\S]*?)<div class="tourx-sectiontabs"/.exec(src);
  if (!head) return 'header card markup is gone';
  if (!/<div class="tourx-headcap">[^<]+<\/div>\s*<h1>Tournaments<\/h1>/.test(head[1])) return 'no caps label line above the title';
  if (!/id="tourxHeadStats"/.test(head[1])) return 'no stats block';
  const card = cssRule(src, '#tourListView .tourx-head');
  if (!/background:var\(--card\); border:1px solid transparent; box-shadow:var\(--top-light\); border-radius:12px; padding:22px 26px/.test(card)) return 'header is not the Today\'s Matches card';
  if (!/font-size:29px; font-weight:800/.test(cssRule(src, '#tourListView .tourx-head h1'))) return 'title is not 29/800';
  if (!/font-size:13\.5px;[^}]*color:var\(--text-soft\)/.test(cssRule(src, '#tourListView .tourx-head p'))) return 'sub is not 13.5 --text-soft';
  if (!/font-size:10\.5px; font-weight:700; letter-spacing:0\.10em; text-transform:uppercase; color:var\(--text-label\)/.test(cssRule(src, '#tourListView .tourx-headcap'))) return 'caps line is not the site caps label';
  if (!/font-family:var\(--font-nums\); font-size:17px; font-weight:700; color:var\(--text\)/.test(cssRule(src, '#tourListView .tourx-hstat__v'))) return 'stat value is not mono 17/700 white';

  const host = { innerHTML: 'stale' };
  const document = { getElementById: () => host };
  const reg = () => [{ name: 'Shanghai' }, { name: 'Basel' }, { name: 'Wimbledon' }];
  const week = () => new Set(['Shanghai', 'Somewhere off-registry']);
  const live = headerApi(src, { document, reg, week, prog: { fetchedAt: '2026-10-08T01:05:00Z' }, mkt: { builtAt: '2026-10-08T03:30:00Z' } });
  live.tourxRenderHeadStats();
  const stats = [...host.innerHTML.matchAll(/tourx-hstat__l">([^<]*)<\/span><span class="tourx-hstat__v">([^<]*)</g)].map(m => m[1] + '=' + m[2]);
  if (stats.length !== 3 || stats[0] !== 'Events=3' || stats[1] !== 'This week=1') return 'live stats wrong: ' + stats.join(', ');
  const v = live.tourxHeadStatValues();
  // Updated = the progression feed's fetchedAt, never the market file's rebuild time (lead review fix).
  if (v.updated !== Date.parse('2026-10-08T01:05:00Z')) return 'Updated is not tournament-progression.json fetchedAt';
  if (live.tourxHeadStamp(v.updated, Date.parse('2026-10-08T12:00:00Z')) !== '01:05') return 'a same-day stamp is not HH:MM';
  if (live.tourxHeadStamp(v.updated, Date.parse('2026-10-10T12:00:00Z')) !== '8 Oct') return 'an older stamp is not "8 Oct"';
  // L4: any one not live → none
  const noStamp = headerApi(src, { document, reg, week, prog: { tournaments: {} }, mkt: null });
  host.innerHTML = 'stale'; noStamp.tourxRenderHeadStats();
  if (host.innerHTML !== '') return 'stats render with no live Updated stamp';
  const noReg = headerApi(src, { document, reg: () => [], week, prog: { fetchedAt: '2026-10-08T01:05:00Z' }, mkt: null });
  host.innerHTML = 'stale'; noReg.tourxRenderHeadStats();
  if (host.innerHTML !== '') return 'stats render with an empty registry';
  return null;
}

// ------------------------------------------------------------------ 2. darker track
function checkSeg(src) {
  const sfSegHtml = new Function(top(src, 'sfSegHtml') + '\nreturn sfSegHtml;')();
  const html = sfSegHtml([{ label: 'Overview', on: true, onclick: "go('o')" }, { label: 'Reports', onclick: "go('r')" }, { label: 'Off', disabled: true, onclick: 'x()' }],
    { label: 'Sections', mono: true });
  if (!/^<div class="sf-seg sf-seg--mono" role="tablist" aria-label="Sections">/.test(html)) return 'track markup: ' + html.slice(0, 80);
  if (!/<button type="button" role="tab" class="sf-seg__opt on" aria-selected="true" onclick="go\('o'\)">Overview<\/button>/.test(html)) return 'selected option markup';
  if (!/class="sf-seg__opt" aria-selected="false" onclick="go\('r'\)">Reports/.test(html)) return 'idle option markup';
  if (!/aria-selected="false" disabled>Off/.test(html)) return 'a disabled option still carries its handler';
  const track = cssRule(src, '.sf-seg'), opt = cssRule(src, '.sf-seg__opt'), on = cssRule(src, '.sf-seg__opt.on');
  if (!/background:var\(--card\); border:1px solid var\(--edge-6\); border-radius:10px/.test(track) || !/gap:3px; padding:3px/.test(track)) return 'track is not --card + --edge-6';
  if (!/font-size:12\.5px; font-weight:600;[^]*color:var\(--text-label\)/.test(opt) || !/border-radius:8px; padding:6px 16px/.test(opt)) return 'idle option is not 12.5/600 grey';
  if (!/background:var\(--inner\); border-color:var\(--edge-10\); color:var\(--text\); font-weight:700/.test(on)) return 'selected option is not --inner + --edge-10 white 700';
  const all = [...src.matchAll(/\n\.sf-seg[^{]*\{[^}]*\}/g)].map(m => m[0]).join('\n');
  if (/--bar|--link|--pro\b|--open-card/.test(all)) return 'a blue token in the darker track';
  if (/\.sf-seg__opt:hover/.test(src)) return 'the darker track grew a hover tint (the reference has none)';
  const tabs = top(src, 'renderTournamentsTab');
  if (!/tabs\.innerHTML = sfSegHtml\(/.test(tabs)) return 'the page tabs are not the darker track';
  if (!/rail\.innerHTML = sfSegHtml\(/.test(inEntry(src, 'renderWeekTabs'))) return 'the week chips are not the darker track';
  return null;
}

// ------------------------------------------------------------------ 3. Entry list
function entryRow(src, t) {
  const sandbox = ['const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];',
    'function hasList(t){ return !!(t.sections && t.sections.length); }', 'function renderPlayers(){ return ""; }',
    inEntry(src, 'tierCode'), inEntry(src, 'shortDate'), inEntry(src, 'countCell'), inEntry(src, 'renderTournament'), 'return renderTournament;'].join('\n');
  return new Function(sandbox)()(t, 0);
}
function checkEntry(src) {
  const sec = [{ title: 'Main Draw', players: [] }];
  const r500 = entryRow(src, { name: 'China Open', tier: 'ATP 500', surface: 'Hard', counts: { MD: 31, Q: 15, ALT: 1 }, sections: sec, startDate: '2026-09-30' });
  const rCh = entryRow(src, { name: 'Bari', tier: 'Challenger 50', surface: 'Clay', counts: { MD: 21, Q: null, ALT: 10 }, sections: sec, startDate: '2026-09-28' });
  if (!/<span class="el-tierchip el-tierchip--fig">500<\/span>/.test(r500)) return 'a figure tier chip is not Plex (el-tierchip--fig)';
  if (!/<span class="el-tierchip el-tierchip--code">CH<\/span>/.test(rCh)) return 'a letter tier chip is not the caps label (el-tierchip--code)';
  if (!/<span class="el-caret" aria-hidden="true">▾<\/span>/.test(r500)) return 'caret carries inline colour / edge';
  if (/border:1px solid var\(--edge|var\(--line\)|--bar|--link/.test(r500)) return 'an event row still paints an inline edge / 5% line / blue';
  if (!/color:var\(--text-label\);">—<\/span>/.test(rCh)) return 'a missing count is not a grey —';
  const R = s => cssRule(src, '[data-page="entry-lists"] ' + s);
  if (!/border-top:1px solid var\(--edge-6\)/.test(R('.elrow'))) return 'row hairline is not 6%';
  if (!/background:var\(--inner\)/.test(R('.elrow:hover'))) return 'row hover is not --inner';
  if (!/background:var\(--inner\); border:none; color:var\(--text-label\)/.test(R('.el-tierchip'))) return 'tier chip is not --inner grey, no edge';
  if (!/color:var\(--text-label\); background:var\(--inner\); border:none/.test(R('.el-caret'))) return 'caret is not an --inner control, grey';
  if (!/color:var\(--text\)/.test(R('.el-card.open .el-caret'))) return 'open caret is not white';
  if (!/background:var\(--inner\)/.test(R('.el-body'))) return 'expanded panel is not --inner';
  if (!/background:var\(--line-strong\)/.test(R('.el-levelhead__rule'))) return 'tier head rule is not 10%';
  if (!/font-size:10\.5px; font-weight:700; letter-spacing:0\.10em; text-transform:uppercase; color:var\(--text-label\)/.test(R('.el-levelhead__t'))) return 'tier head is not the caps label';
  if (!/background:var\(--card\); border:1px solid var\(--edge-6\); border-radius:12px/.test(R('.el-table'))) return 'table is not a card';
  if (!/background:var\(--card\); border:1px solid var\(--edge-6\)/.test(R('.el-empty'))) return 'empty state is not a card';
  if (!/background:var\(--inner\); border-color:var\(--edge-10\)/.test(cssRule(src, '.sf-seg__opt.on'))) return 'selected week is not --inner + --edge-10';
  if (/var\(--(pos|neg)\)/.test(src.slice(src.indexOf('<!-- ENTRY LISTS TAB'), src.indexOf('window.EntryListsTab')))) return 'green / red on the Entry list (status colour)';
  const fmtName = new Function(inEntry(src, 'fmtName') + '\nreturn fmtName;')();
  const got = ['SHANG, Juncheng', 'CARRENO BUSTA, Pablo', 'de MINAUR, Alex', 'Kolář, Zdeněk'].map(n => fmtName({ name: n }));
  if (got.join('|') !== 'Juncheng Shang|Pablo Carreno Busta|Alex de Minaur|Zdeněk Kolář') return 'names: ' + got.join('|');
  return null;
}

// ------------------------------------------------------------------ 4. Database All row
function makeDoc() {
  const mk = (tag) => ({
    tagName: tag, className: '', _text: '', _html: '', children: [], style: { setProperty() {} },
    appendChild(c) { this.children.push(c); return c; },
    set textContent(v) { this._text = String(v); this.children = []; },
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); },
    set innerHTML(v) { this._html = String(v); this._text = String(v).replace(/<[^>]*>/g, ''); this.children = []; },
    get innerHTML() { return this._html; },
    all(cls) { const out = []; const walk = (e) => { for (const c of e.children) { if ((c.className || '').split(/\s+/).includes(cls)) out.push(c); walk(c); } }; walk(this); return out; },
  });
  return { createElement: mk };
}
function checkAllRow(src) {
  const openTop = (src.match(/var DB_DOG_OPEN_TOP=(true|false);/) || [])[0];
  const code = openTop + '\n' + ['el', 'esc', 'fmtInt', 'fmtP', 'fmtPct', 'signCol', 'median', 'yieldCell', 'agg', 'bands', 'dbMatchWord', 'bandTo', 'bandPanel']
    .map(f => inDb(src, f)).join('\n') + '\nreturn { bands, bandPanel };';
  const api = new Function('document', 'M', 'SOFT_GATE', 'HARD_GATE', 'POS', 'NEG', 'baselineAllowed', 'baseRange', 'baseAll', code)(
    makeDoc(), DATA.meta, 100, 30, 'var(--pos)', 'var(--neg)', () => true, () => ({ n: 9, yield: -0.01 }), () => ({ n: 9, yield: -0.02 }));
  const ti = DATA.meta.tournaments.indexOf('Hangzhou Open');
  const rows = DATA.rows.filter(r => r[4] === ti);
  if (rows.length < 30 || rows.length >= 100) return 'Hangzhou Open is no longer a gated-table fixture (' + rows.length + ' matches) — pick another';
  for (const [side, vals] of [['fav', rows.map(r => ({ p: r[5], w: r[7], b: r[8] }))], ['dog', rows.map(r => ({ p: r[6], w: r[7] ? 0 : 1, b: r[8] }))]]) {
    const res = api.bands(vals);
    const panel = api.bandPanel(side === 'fav' ? 'Favourites' : 'Underdogs', res, ['a', 'b', 'c'], side, true, false);
    const bandCells = panel.all('db-gr').map(r => r.children[5].innerHTML);
    if (!bandCells.some(h => /db-yieldcell hard/.test(h))) return side + ': no gated band cell — the fixture no longer exercises the rule';
    const all = panel.all('db-ga')[0].children[5].innerHTML;
    const want = res.all.yield >= 0 ? 'var(--pos)' : 'var(--neg)';
    if (!new RegExp('<span class="db-yieldcell" style="color:' + want.replace(/[()]/g, '\\$&') + '">').test(all)) return side + ': All-row yield lost its sign colour: ' + all;
  }
  return null;
}

// ------------------------------------------------------------------ r1.1 All-row From / To
function bandApi(src, setProp) {
  const openTop = (src.match(/var DB_DOG_OPEN_TOP=(true|false);/) || [])[0];
  const code = openTop + '\n' + ['el', 'esc', 'fmtInt', 'fmtP', 'fmtPct', 'signCol', 'median', 'yieldCell', 'agg', 'bands', 'dbMatchWord', 'bandTo', 'bandPanel']
    .map(f => inDb(src, f)).join('\n') + '\nreturn { bands, bandPanel };';
  const doc = makeDoc();
  if (setProp) { const mk = doc.createElement; doc.createElement = (t) => { const e = mk(t); e.style = { setProperty: setProp }; return e; }; }
  return new Function('document', 'M', 'SOFT_GATE', 'HARD_GATE', 'POS', 'NEG', 'baselineAllowed', 'baseRange', 'baseAll', code)(
    doc, DATA.meta, 100, 30, 'var(--pos)', 'var(--neg)', () => true, () => ({ n: 9, yield: -0.01 }), () => ({ n: 9, yield: -0.02 }));
}
function hangzhouPanels(src, setProp) {
  const api = bandApi(src, setProp);
  const ti = DATA.meta.tournaments.indexOf('Hangzhou Open');
  const rows = DATA.rows.filter(r => r[4] === ti);
  const out = {};
  for (const [side, vals] of [['fav', rows.map(r => ({ p: r[5], w: r[7], b: r[8] }))], ['dog', rows.map(r => ({ p: r[6], w: r[7] ? 0 : 1, b: r[8] }))]]) {
    const panel = api.bandPanel(side === 'fav' ? 'Favourites' : 'Underdogs', api.bands(vals), ['a', 'b', 'c'], side, true, false);
    const cells = r => r.children.map(c => c.textContent);
    out[side] = { bands: panel.all('db-gr').map(cells), all: cells(panel.all('db-ga')[0]) };
  }
  return out;
}
function checkAllSpan(src) {
  const p = hangzhouPanels(src);
  const got = ['fav', 'dog'].map(s => s + ' ' + p[s].all[1] + '/' + p[s].all[2]).join(', ');
  if (got !== 'fav 1.20/1.85, dog 2.04/3.05+') return 'Hangzhou All From/To: ' + got + ' (want fav 1.20/1.85, dog 2.04/3.05+)';
  for (const s of ['fav', 'dog']) {
    const b = p[s].bands;
    if (p[s].all[1] !== b[0][1]) return s + ': All From is not the lowest band From';
    if (p[s].all[2] !== b[b.length - 1][2]) return s + ': All To is not the top band To';
  }
  return null;
}

// ------------------------------------------------------------------ r1.2 band cells never wrap
const OVERLAY_GRID_1512 = 499;   // measured: ROI overlay band panel content width at 1512 (541 - 2 x 20 padding)
const BAND_NAME_MAX = 107;       // measured: "Narrow underdog", Hanken 13.5 / 600, nowrap
function checkBandNoWrap(src) {
  if (!/white-space:nowrap/.test(cssRule(src, '.db-gr > div:first-child'))) return 'band cell does not carry white-space:nowrap';
  let cols = null;
  hangzhouPanels(src, (k, v) => { if (k === '--dbcols') cols = v; });
  if (!cols) return 'bandPanel set no --dbcols';
  const m = /^minmax\((\d+)px,1fr\) ((?:\d+px ?)+)$/.exec(cols);
  if (!m) return 'unexpected --dbcols: ' + cols;
  const fixed = m[2].trim().split(' ').map(x => parseInt(x, 10));
  const gap = parseInt((/gap:0 (\d+)px/.exec(cssRule(src, '.db-gh, .db-gr, .db-ga')) || [])[1], 10);
  if (+m[1] < BAND_NAME_MAX) return 'band track minimum ' + m[1] + 'px < the widest band name ' + BAND_NAME_MAX + 'px';
  const need = +m[1] + fixed.reduce((a, b) => a + b, 0) + gap * fixed.length;
  if (need > OVERLAY_GRID_1512) return 'Tournament row needs ' + need + 'px > the overlay band panel ' + OVERLAY_GRID_1512 + 'px at 1512';
  return null;
}

// ------------------------------------------------------------------ Entry list module slices (r1.4 – r1.8)
const ENTRY_VARS = "var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];\n"
  + "var GROUP_ORDER = ['Grand Slam','ATP 250','ATP 500','Masters','Challenger','ITF'];\nvar rosterSrc = null, rosterByKey = null, rosterByToks = null;\n";
function entryFns(src, names, tail, params, args) {
  const code = ENTRY_VARS + names.map(n => inEntry(src, n)).join('\n') + '\n' + tail;
  return new Function(...params, code)(...args);
}
function fixedDate(iso) {
  const RD = Date, FIX = new RD(iso).getTime();
  function D(...a) { return a.length ? new RD(...a) : new RD(FIX); }
  D.prototype = RD.prototype; D.now = () => FIX; D.UTC = RD.UTC; D.parse = RD.parse;
  return D;
}

// ------------------------------------------------------------------ r1.4 one "This week" set; current week first
// The shared set is EXECUTED on the real shards (entry_lists*.json, merged by the page's own mergeShards) under a fixed
// clock: header "This week" = eyebrow events = current chip; eyebrow lists <= events.
const SHARDS = (() => { try { return [JSON.parse(readFileSync(join(HERE, 'entry_lists_advance.json'), 'utf8')), JSON.parse(readFileSync(join(HERE, 'entry_lists.json'), 'utf8'))]; } catch (e) { return null; } })();
function thisWeekFigures(src, clockIso, inPlay, tourns) {
  const D = fixedDate(clockIso);
  const reg = () => [{ name: 'Shanghai' }, { name: 'Tokyo' }, { name: 'Beijing' }, { name: 'Basel' }, { name: 'Vienna' }];
  const week = () => new Set(inPlay);
  const hostE = { innerHTML: '' }, hostH = { innerHTML: '' };
  const data = { tournaments: tourns || (SHARDS ? entryFns(src, ['norm', 'cityKey', 'mergeShards'], 'return mergeShards;', [], [])(SHARDS[0], SHARDS[1]) : []) };
  const el = entryFns(src, ['isoMonday', 'fmtKey', 'keyToDate', 'weekRangeLabel', 'norm', 'hasList', 'renderHead', 'weekEventCount', 'currentWeekRows'],
    'return { renderHead, weekEventCount, currentWeekRows, isoMonday, fmtKey };',
    ['document', 'Date', 'data', 'activeWeek', 'advMeta', 'loaded', 'tourxThisWeekEvents'],
    [{ getElementById: () => hostE }, D, data, '2026-11-02', null, true, () => shared()]);
  const win = { EntryListsTab: { currentWeekRows: el.currentWeekRows } };
  const shared = new Function('tourxConditionRegistry', 'tourxActiveWeekNames', 'window', top(src, 'tourxThisWeekEvents') + '\nreturn tourxThisWeekEvents;')(reg, week, win);
  const hdr = new Function('document', 'tourxConditionRegistry', 'tourxActiveWeekNames', 'tournamentProgression', 'newsTz', 'tourxThisWeekEvents',
    'const TOURX_HEAD_STATS = true;\n' + ['tourxHeadStatValues', 'tourxHeadStamp', 'tourxRenderHeadStats'].map(n => top(src, n)).join('\n') + '\nreturn tourxRenderHeadStats;')(
    { getElementById: () => hostH }, reg, week, { fetchedAt: '2026-09-30T08:00:00Z' }, () => 'UTC', shared);
  hdr(); el.renderHead();
  const e = /> ?(\d+) events? · (\d+) lists? loaded</.exec(hostE.innerHTML) || [];
  const cur = el.fmtKey(el.isoMonday(new D()));
  return { header: +((/This week<\/span><span class="tourx-hstat__v">(\d+)</.exec(hostH.innerHTML) || [])[1]),
    events: +e[1], lists: +e[2], chip: el.weekEventCount(cur), set: shared() };
}
function checkThisWeek(src) {
  if (!/const wk = tourxThisWeekEvents\(\);/.test(top(src, 'tourxHeadStatValues'))) return 'header This week does not read tourxThisWeekEvents()';
  const head = inEntry(src, 'renderHead');
  if (!/tourxThisWeekEvents\(\)/.test(head) || /activeWeek/.test(head)) return 'Entry list eyebrow does not read the shared set (or follows the chip)';
  const ok = f => f.header === f.events && f.events === f.chip && f.lists <= f.events;
  // synthetic: shard rows of this week (one with a list) ∪ in-play registry events, de-duplicated on city
  const syn = thisWeekFigures(src, '2026-09-30T10:00:00Z', ['Shanghai', 'Tokyo', 'Beijing'], [
    { tour: 'ATP', name: 'China Open', city: 'Beijing', weekStart: '2026-09-28', sections: [{ players: [] }] },
    { tour: 'ATP', name: 'Bari (CH 50)', city: 'Bari', weekStart: '2026-09-28', sections: [] },
    { tour: 'ATP', name: 'Vienna', city: 'Vienna', weekStart: '2026-10-26', sections: [{ players: [] }] }]);
  if (!ok(syn) || syn.events !== 4 || syn.lists !== 1) return 'synthetic week: ' + JSON.stringify({ ...syn, set: undefined }) + ' (want 4 / 4 / 4, lists 1)';
  // real shards, two clocks
  if (SHARDS) {
    for (const [clock, inPlay] of [['2026-10-08T10:00:00Z', ['Shanghai']], ['2026-10-13T10:00:00Z', ['Shanghai', 'Tokyo', 'Beijing']]]) {
      const f = thisWeekFigures(src, clock, inPlay);
      if (!ok(f)) return 'real shards @ ' + clock + ': ' + JSON.stringify({ ...f, set: undefined });
    }
  }
  // the current week is the first chip even when no shard row sits in it
  const weeks = entryFns(src, ['isoMonday', 'fmtKey', 'deriveWeeks'], 'return deriveWeeks;', ['Date'], [fixedDate('2026-10-08T10:00:00Z')])(
    [{ weekStart: '2026-10-12' }, { weekStart: '2026-11-02' }, { weekStart: '2026-09-28' }]);
  if (weeks.join(',') !== '2026-10-05,2026-10-12,2026-11-02') return 'week chips: ' + weeks.join(',') + ' (want the current week 2026-10-05 first)';
  return null;
}

// ------------------------------------------------------------------ r1.5 / r1.6 ranks + full names
const ROSTER = [
  { key: '1852', name: 'Valentin Vacherot', rank: 14 },
  { key: '388', name: 'Manuel Cerundolo Juan', rank: 55 },     // api-tennis name-order scramble
  { key: '1104', name: 'Francisco Cerundolo', rank: 20 },
  { key: '434', name: 'Pablo Carreno-Busta', rank: 65 },
  { key: '2842', name: 'Alejandro Davidovich Fokina', rank: 29 },
  { key: '1206', name: 'Calvin Hemery', rank: 309 },
  { key: '2227', name: 'Coleman Wong Chak Lam', rank: 101 },
];
function playersHtml(src, players, roster) {
  return entryFns(src, ['fmtStatus', 'fmtName', 'norm', 'nameToks', 'namesAgree', 'rosterIndex', 'rosterFor', 'displayName', 'rankOf', 'renderPlayers'],
    'return renderPlayers;', ['playerIndex'], [roster])(players);
}
function playerRows(html) {
  return [...html.matchAll(/<span class="el-pname"[^>]*>(.*?)<\/span><span class="el-pcountry" style="text-align:right[^>]*>[^<]*<\/span><span class="el-prank" style="([^"]*)"[^>]*>([^<]*)<\/span>/g)]
    .map(m => ({ name: m[1].replace(/<[^>]*>/g, '').trim(), style: m[2], rank: m[3] }));
}
function checkRanksNames(src) {
  const players = [
    { name: 'VACHEROT, Valentin', rank: 19, status: 'SEED', playerKey: '1852', country: 'MON' },   // list rank wins (19, not 14)
    { name: 'DAVIDOVICH FOKINA, Alej…', rank: null, status: 'DA', playerKey: '2842' },          // key join + completion
    { name: 'CERUNDOLO, Juan M…', rank: null, status: 'DA', playerKey: null },                   // name join (scrambled) + completion
    { name: 'CARRENO BUSTA, Pablo', rank: null, status: 'Q', playerKey: null },                  // hyphen join
    { name: 'NOBODY, Known', rank: null, status: 'DA', playerKey: null },                        // unknown → —
    { name: 'SMITH, Jo…', rank: null, status: 'DA', playerKey: null },                           // unresolved cut name
    { name: 'Bye', rank: null, status: 'BYE', playerKey: null },
    { name: 'Clement Hemery', rank: null, status: 'ALT', playerKey: '1206' },                  // key of ANOTHER player (Calvin)
    { name: 'WONG, Coleman', rank: null, status: 'DA', playerKey: '2227' },                     // key + roster carries extra words
  ];
  const html = playersHtml(src, players, ROSTER);
  const rows = playerRows(html);
  if (rows.length !== 9) return 'expected 9 player rows, read ' + rows.length;
  const ranks = rows.map(r => r.rank).join(' ');
  if (ranks !== '#19 #29 #55 #65 — —  — #101') return 'ranks: "' + ranks + '" (want "#19 #29 #55 #65 — —  — #101": Hemery is not Calvin Hemery)';
  if (/showPlayerProfile\('1206'\)/.test(html)) return 'Clement Hemery still links to Calvin Hemery\'s profile';
  if (!/showPlayerProfile\('2227'\)/.test(html)) return 'a key whose name agrees lost its profile link';
  if (rows.some(r => !/font-family:'IBM Plex Mono'[^;]*;[^"]*color:var\(--text-label\)/.test(r.style))) return 'a rank cell is not grey mono';
  const names = rows.map(r => r.name).slice(0, 6);
  const want = ['Valentin Vacherot SEED', 'Alejandro Davidovich Fokina', 'Juan Manuel Cerundolo', 'Pablo Carreno Busta Q', 'Known Nobody', 'Smith, Jo…'];
  for (let i = 0; i < want.length; i++) if (names[i] !== want[i]) return 'name ' + i + ': "' + names[i] + '" (want "' + want[i] + '")';
  if (names.some(n => /…\s\S/.test(n))) return 'a name is cut in the middle';
  // a second, ambiguous candidate kills the name join (never a guess)
  const amb = playerRows(playersHtml(src, [players[3]], ROSTER.concat([{ key: '9', name: 'Busta Pablo Carreno', rank: 900 }])));
  if (amb[0].rank !== '—') return 'an ambiguous name join still printed a rank';
  // the cell ellipsises at the end only
  if (!/white-space:nowrap;overflow:hidden;text-overflow:ellipsis;/.test(inEntry(src, 'renderPlayers'))) return 'name cell lost its end-ellipsis';
  return null;
}

// ------------------------------------------------------------------ r1.7 no "published"
function checkNoPublished(src) {
  const sec = [{ title: 'Main Draw', players: [] }];
  for (const t of [{ name: 'China Open', tier: 'ATP 500', surface: 'Hard', counts: { MD: 31, Q: 15, ALT: 1 }, sections: sec, startDate: '2026-09-30', regime: 'draw', sourcePublished: '2026-10-06T13:01:56Z' },
    { name: 'Jinan (CH 125)', tier: 'Challenger', surface: 'Hard', counts: { MD: 21, Q: 20, ALT: 1 }, sections: sec, startDate: '2026-10-12', regime: 'advance', sourcePublished: '2026-10-06T12:55:00Z' }]) {
    const html = entryRow(src, t);
    if (/publish/i.test(html)) return t.name + ': the row still prints a publish date';
    if (/6 Oct/.test(html)) return t.name + ': the fetch / re-post date is on the row';
  }
  if (!/30 Sep · hard · official draw/.test(entryRow(src, { name: 'X', tier: 'ATP 500', surface: 'Hard', sections: sec, startDate: '2026-09-30', regime: 'draw' }))) return 'meta line is not "{date} · {surface} · official draw"';
  return null;
}

// ------------------------------------------------------------------ r1.8 en dash + empty-state copy
function checkEmptyCopy(src) {
  const lbl = entryFns(src, ['keyToDate', 'weekRangeLabel'], 'return weekRangeLabel;', [], []);
  if (lbl('2026-11-02') !== '2\u20138 Nov' || lbl('2026-10-12') !== '12\u201318 Oct') return 'week range is not an en dash: ' + lbl('2026-11-02') + ' / ' + lbl('2026-10-12');
  const body = { innerHTML: '' };
  const tourns = Array.from({ length: 21 }, (_, i) => ({ tour: 'ATP', name: 'E' + i, city: 'C' + i, weekStart: '2026-11-02', sections: [] }));
  const render = entryFns(src, ['isoMonday', 'fmtKey', 'keyToDate', 'weekRangeLabel', 'weekRangeHtml', 'norm', 'hasList', 'weekEventCount', 'levelGroup', 'deriveWeeks', 'pickDefaultWeek', 'render'],
    'function renderWeekTabs(){} function renderHead(){} function staleBannerHtml(){ return ""; } function renderFreshness(){}\nreturn render;',
    ['document', 'Date', 'data', 'activeWeek', 'weeks', 'weekPicked', 'tourxThisWeekEvents'],
    [{ getElementById: () => body }, fixedDate('2026-10-08T10:00:00Z'), { tournaments: tourns }, '2026-11-02', [], true, () => null]);
  render();
  // TEN-401 f1 item 3: the range's dash is wrapped in .el-ndash (Plex) — read the copy as text
  if (!/The ATP has 21 events in the week of 2\u20138 Nov\. Their acceptance lists are not in the build yet/.test(body.innerHTML.replace(/<span class="el-ndash">(\u2013)<\/span>/g, '$1'))) return 'empty state: ' + body.innerHTML.replace(/<[^>]*>/g, ' ').trim();
  return null;
}

test('header card: Today\'s Matches pattern, stats only when all three are live (L4)', () => assert.equal(checkHeader(SRC), null));
test('darker track: one helper, card + 6% track, inner + 10% selected, no blue; tabs + week chips use it', () => assert.equal(checkSeg(SRC), null));
test('Entry list: hairlines, chips, caret, panel, tier heads, card table / empty state, names', () => assert.equal(checkEntry(SRC), null));
test('Database: in a table with gated cells the All-row yield keeps its sign colour (Hangzhou Open)', () => assert.equal(checkAllRow(SRC), null));

test('r1.1 All row From / To span the side on both sides (Hangzhou Open 1.20 / 1.85 · 2.04 / 3.05+)', () => assert.equal(checkAllSpan(SRC), null));
test('r1.2 band cells never wrap; the Tournament row fits the ROI overlay at 1512', () => assert.equal(checkBandNoWrap(SRC), null));
test('r1.4 one "This week" source for header + Entry list eyebrow; the current week is the first chip', () => assert.equal(checkThisWeek(SRC), null));
test('r1.5 / r1.6 every player row has a rank (list, else ATP standings, else —) and a full name', () => assert.equal(checkRanksNames(SRC), null));
test('r1.7 event rows print no "published" date', () => assert.equal(checkNoPublished(SRC), null));
test('r1.8 en dash week ranges; empty state "…21 events in the week of 2–8 Nov…"', () => assert.equal(checkEmptyCopy(SRC), null));

test('CONTROL: each ruling goes red on its mutant', () => {
  const m = (a, b) => { assert.ok(SRC.split(a).length === 2, 'mutant anchor not found exactly once: ' + a.slice(0, 60)); return SRC.replace(a, b); };
  const red = (check, src) => { try { return check(src) !== null; } catch (e) { return true; } };   // a throw is red too
  assert.ok(red(checkHeader, m('<div class="tourx-headcap">ATP tour · Season calendar</div>', '')), 'caps line removed');
  assert.ok(red(checkHeader, m("if (!stamps.length) return null;", '')), 'stats without a live stamp');
  assert.ok(red(checkSeg, m('.sf-seg__opt.on{ background:var(--inner); border-color:var(--edge-10);', '.sf-seg__opt.on{ background:var(--bar); border-color:var(--edge-10);')), 'blue selected');
  assert.notEqual(checkSeg(m("tabs.innerHTML = sfSegHtml(", "tabs.innerHTML = String(")), null, 'tabs off the helper');
  assert.ok(red(checkEntry, m('[data-page="entry-lists"] .elrow:hover{ background:var(--inner); }', '[data-page="entry-lists"] .elrow:hover{ background:var(--tile-hover); }')), 'darker hover');
  assert.ok(red(checkEntry, m("[data-page=\"entry-lists\"] .el-card.open .el-caret{ color:var(--text);", "[data-page=\"entry-lists\"] .el-card.open .el-caret{ color:var(--bar);")), 'blue caret');
  assert.ok(red(checkEntry, m("    return tc(giv) + ' ' + tc(sur);", "    return giv + ' ' + sur;")), 'raw names');
  assert.notEqual(checkAllRow(m("arow.appendChild(el('div',null,yieldCell(a, true)));", "arow.appendChild(el('div',null,yieldCell(a)));")), null, 'All row muted');
  // round 1
  assert.ok(red(checkAllSpan, m("    arow.appendChild(el('div','db-gft', topTo!=null ? topTo : fmtP(a.hi)));", "    arow.appendChild(el('div','db-gft',bandTo(sideKey, a.lo, a.hi)));")), 'r1.1 lowest price + "+"');
  assert.ok(red(checkBandNoWrap, m("color:var(--text-soft); white-space:nowrap; }", "color:var(--text-soft); }")), 'r1.2 band cell wraps');
  assert.ok(red(checkBandNoWrap, m("      ? 'minmax(108px,1fr) 45px 45px 52px 58px 62px 62px'", "      ? 'minmax(72px,1fr) 45px 45px 52px 58px 74px 74px'")), 'r1.2 old tracks');
  assert.ok(red(checkThisWeek, m("    set[cur] = 1;\n", "")), 'r1.4 current week dropped when empty');
  assert.ok(red(checkThisWeek, m("    var nWeek = wk ? wk.length : null;", "    var nWeek = (data.tournaments||[]).filter(function(t){ return t.weekStart === activeWeek; }).length;")), 'r1.4 eyebrow follows the chip');
  assert.ok(red(checkThisWeek, m("      if(wk) return wk.length;", "")), 'r1.4 chip counts shard rows only');
  assert.ok(red(checkThisWeek, m("  rows.forEach(t => { const k = key(t.city || t.name); if (seen.has(k)) return; seen.add(k);", "  [].forEach(t => { const k = key(t.city || t.name); if (seen.has(k)) return; seen.add(k);")), 'r1.4 header = registry only');
  assert.ok(red(checkThisWeek, m("    var loaded = wk ? wk.filter(function(e){ return e.hasList; }).length : 0;", "    var loaded = 99;")), 'r1.4 lists beyond the set');
  assert.ok(red(checkRanksNames, m("    if(byKey && namesAgree(p.name, byKey.name, true)) return byKey;", "    if(byKey) return byKey;")), 'r1.5 key trusted over a disagreeing name');
  assert.ok(red(checkRanksNames, m("    return (Number.isFinite(m) && m > 0) ? { rank: m, src: 'atp' } : null;", "    return null;")), 'r1.5 seeds-only ranks');
  assert.ok(red(checkRanksNames, m("(isBye ? '' : (rk ? '#'+rk.rank : '—'))", "(isBye ? '' : (rk ? '#'+rk.rank : ''))")), 'r1.5 blank unknown rank');
  assert.ok(red(checkRanksNames, m("      var nm = displayName(p);", "      var nm = fmtName(p);")), 'r1.6 cut names printed as the source cut them');
  assert.ok(red(checkRanksNames, m("    return fmtName(p, true);", "    return fmtName(p);")), 'r1.6 unresolved cut mid-name');
  assert.ok(red(checkNoPublished, m("    if(t.regime === 'draw') bits.push('official draw');", "    bits.push('published '+shortDate(t.sourcePublished));\n    if(t.regime === 'draw') bits.push('official draw');")), 'r1.7 published back');
  assert.ok(red(checkEmptyCopy, m("' in the week of ' + weekRangeHtml(activeWeek)", "' in ' + weekRangeHtml(activeWeek)")), 'r1.8 old copy');
  assert.ok(red(checkEmptyCopy, m("      return mon.getDate() + '–' + sun.getDate() + ' ' + MON[mon.getMonth()];", "      return mon.getDate() + '-' + sun.getDate() + ' ' + MON[mon.getMonth()];")), 'r1.8 hyphen');
});
