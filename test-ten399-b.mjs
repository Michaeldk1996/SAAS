// TEN-399 (step 6 · Database) group b — Tournament + Compare events + Player rulings.
//
// Every assertion EXECUTES the page's own functions (sliced out of
// bsp-consult-dashboard.html) on the real published stores (database-yield.json +
// database-yield-players.json), through a minimal DOM shim — no re-implementation of a rule.
//
//   1. Player · Side flips every figure, note and curve (Backing him / Fading him).
//   2. Player · the three charts share ONE y-domain and ONE tick set (x-domain = the career
//      spine, first + last season labelled: 2013 … 2026 for Khachanov).
//   3. Player · role cards: no gap bar / legend / verdict pill; the gap row is the only
//      rendering of the gap; the tour-baseline figure is neutral.
//   4. Player · Surface = Clay: baseline recomputed (as built) or the — path under the
//      README gate (PLAYER_BASELINE_SCOPE='gate').
//   5. Tournament · the tour comparison sits on the SAME row as the event figure, and the
//      band-box header carries no event name.
//   6. Compare events · max 4 picks, series colours / widths / dash by pick order, end
//      values in the legend only (no plates, no end dots), figures = the band view's agg.
// A CONTROL test plants a mutant for each ruling and proves the suite goes red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const DATA = JSON.parse(readFileSync(join(HERE, 'database-yield.json'), 'utf8'));
const NAMES = JSON.parse(readFileSync(join(HERE, 'database-yield-players.json'), 'utf8'));

// Slice from INSIDE window.DatabaseTab: the page has other functions with the same
// names (the Players page's renderPlayers sits ~10k lines earlier).
function fnSource(src, name) {
  const i = src.indexOf('function ' + name + '(', src.indexOf('window.DatabaseTab = (function(){'));
  if (i < 0) throw new Error('function ' + name + ' is gone — this lock points at nothing');
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces slicing ' + name);
}
function varLine(src, name) {
  const m = new RegExp('\\n  var ' + name + '=[^\\n]*').exec(src);
  if (!m) throw new Error('var ' + name + ' is gone');
  return m[0].replace(/\/\/[^'\n]*$/, '');
}

function makeDoc() {
  const mk = (tag) => ({
    tagName: tag, className: '', title: '', _text: '', _html: '', children: [], disabled: false,
    style: { setProperty(k, v) { this[k] = v; } },
    get classList() { const n = this; return { add(c) { n.className += ' ' + c; }, toggle() {} }; },
    appendChild(c) { this.children.push(c); return c; },
    set textContent(v) { this._text = String(v); this.children = []; },
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); },
    set innerHTML(v) { this._html = String(v); this._text = String(v).replace(/<[^>]*>/g, ''); this.children = []; },
    get innerHTML() { return this._html; },
    get childNodes() { return this.children; },
    all(cls) {
      const out = [];
      const walk = (e) => { for (const c of e.children) { if ((c.className || '').split(/\s+/).includes(cls)) out.push(c); walk(c); } };
      walk(this); return out;
    },
    html() { return this._html + this.children.map(c => c.html()).join(''); },
  });
  return { createElement: mk };
}

const PLAYER_FNS = ['el', 'esc', 'yr', 'dnum', 'fmtP', 'fmtPct', 'fmtPP', 'fmtInt', 'fmtU', 'signCol', 'median',
  'buildPlayerIndex', 'pushPlayer', 'inPeriod', 'playerRecs', 'aggRecs', 'bookLabel', 'playerBaselines',
  'dbMatchWord', 'playerBookSplit', 'roleCard', 'renderPlayers', 'playerCharts', 'playerTicks', 'panelFor',
  'seasonIndexTicks', 'poly', 'paintSeries', 'sampleKeep', 'smoothVals'];
const PLAYER_VARS = ['COL_FAV', 'SMOOTH_MODE', 'SOFT_GATE', 'N_TOUR', 'PLAYER_TICK_GAP', 'PLAYER_BASELINE_SCOPE'];

function playerHarness(src, st) {
  const code = PLAYER_VARS.map(v => varLine(src, v)).join('\n') + '\n' +
    PLAYER_FNS.map(f => fnSource(src, f)).join('\n') +
    '\nbuildPlayerIndex();\nvar body=document.createElement("div");\nrenderPlayers(body);\nreturn body;';
  const doc = makeDoc();
  const state = Object.assign({ view: 'players', period: 'all', psurf: null, plevel: null, ptourn: null, stance: 'back' }, st);
  return new Function('document', 'DATA', 'NAMES', 'M', 'state', 'playerIndex', 'renderFootnote', 'I', code)(
    doc, DATA, NAMES, DATA.meta, state, null, () => {}, null);
}
function readPlayer(body) {
  const T = (n) => n.textContent.replace(/\s+/g, ' ').trim();
  const roles = body.all('db-role');
  return {
    all: T(body.all('db-allline')[0]),
    roles: roles.map(T),
    desc: roles.map(r => T(r.children[0])),
    yields: roles.map(r => T(r.all('yield')[0])),
    base: roles.map(r => r.all('base')[0].html()),
    gap: roles.map(r => r.all('db-gaprow')[0].html()),
    split: T(body.all('db-psplit')[0]),
    heads: body.all('db-pchead').map(T),
    axes: body.all('db-pcaxis').map(a => a.children.map(c => c.textContent + '@' + c.style.top).join(',')),
    ticks: body.all('db-pcticks').map(t => t.children.map(c => c.textContent + '@' + c.style.left)),
    polys: body.all('db-pcarea').map(a => (/<polyline points="([^"]*)"/.exec(a.html()) || [])[1]),
    deleted: ['db-bar', 'db-barleg', 'db-barfill', 'db-verdict', 'db-bookline'].map(c => body.all(c).length).reduce((a, b) => a + b, 0),
  };
}

const KH = 'Khachanov K.';

// ---------------------------------------------------------------- Player
function checkSideFlip(src) {
  const b = readPlayer(playerHarness(src, { player: KH, stance: 'back' }));
  const f = readPlayer(playerHarness(src, { player: KH, stance: 'fade' }));
  if (b.roles.length !== 2 || f.roles.length !== 2) return 'role cards missing';
  // every figure moves
  for (let i = 0; i < 2; i++) {
    if (b.yields[i] === f.yields[i]) return 'role ' + i + ' yield did not flip: ' + b.yields[i];
    if (b.gap[i] === f.gap[i]) return 'role ' + i + ' gap did not flip';
    if (b.desc[i] === f.desc[i] || !/opponent backed/.test(f.desc[i])) return 'role ' + i + ' note did not flip: ' + f.desc[i];
    const rb = /(\d+)–(\d+)/.exec(b.roles[i]), rf = /(\d+)–(\d+)/.exec(f.roles[i]);
    if (!rb || !rf || rb[1] !== rf[2] || rb[2] !== rf[1]) return 'role ' + i + ' record did not mirror';
  }
  // the crossover: fading "As Favourite" is scored against the tour UNDERDOG baseline
  if (f.base[0] !== b.base[1] || f.base[1] !== b.base[0]) return 'baselines did not cross over on the fade side';
  if (b.all === f.all) return 'all-matches line did not flip';
  if (b.split === f.split) return 'split-by-book strip did not flip';
  for (let i = 0; i < 3; i++) {
    if (b.heads[i] === f.heads[i]) return 'chart ' + i + ' head did not flip';
    if (b.polys[i] === f.polys[i]) return 'chart ' + i + ' curve did not flip';
  }
  if (!f.heads.every(h => /opponent backed/.test(h))) return 'fade chart titles do not say the opponent is backed';
  return null;
}
function checkSharedAxes(src) {
  for (const stance of ['back', 'fade']) {
    const p = readPlayer(playerHarness(src, { player: KH, stance }));
    if (p.axes.length !== 3) return 'expected three player charts, found ' + p.axes.length;
    if (new Set(p.axes).size !== 1) return 'the three charts do not share one y-domain: ' + JSON.stringify(p.axes);
    const tk = p.ticks.map(t => t.join(' '));
    if (new Set(tk).size !== 1) return 'the three charts do not carry identical ticks: ' + JSON.stringify(tk);
    const labels = p.ticks[0].map(t => t.split('@')[0]);
    if (labels[0] !== '2013' || labels[labels.length - 1] !== '2026') return 'Khachanov ticks must run 2013 … 2026: ' + labels.join(' ');
    // no two labels closer than the gap (the old "20132017")
    const xs = p.ticks[0].map(t => parseFloat(t.split('@')[1]));
    for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] < 8.5 - 1e-9) return 'tick labels collide: ' + p.ticks[0].join(' ');
  }
  return null;
}
function checkRoleCards(src) {
  const p = readPlayer(playerHarness(src, { player: KH }));
  if (p.deleted) return 'a gap bar / legend / verdict pill / blue-dot book line is still painted';
  for (let i = 0; i < 2; i++) {
    if (!/color:var\(--text-label\);font-weight:500/.test(p.base[i])) return 'tour-baseline figure is not neutral grey at weight 500 (TEN-399 R2 item 6): ' + p.base[i];
    if (!/^.*Gap vs tour baseline.*pp/.test(p.gap[i].replace(/<[^>]*>/g, ''))) return 'gap row missing';
  }
  // the gap is rendered ONCE per card
  if (p.roles.some(r => (r.match(/pp/g) || []).length !== 1)) return 'the gap appears more than once on a card';
  if (!/^Each match is priced on its Pinnacle closing price, else Bet365\. Split by book: \S+ across [\d,]+ matches priced on Pinnacle, \S+ across [\d,]+ matches priced on Bet365\./.test(p.split))
    return 'split strip is not one convention / does not state the join: ' + p.split;
  return null;
}
function checkClay(src) {
  const clay = DATA.meta.surfaces.indexOf('Clay');
  const rec = readPlayer(playerHarness(src, { player: KH, psurf: clay }));
  if (rec.base.some(b => />—</.test(b))) return 'recompute scope dashed the Clay baseline';
  const gated = readPlayer(playerHarness(src.replace("var PLAYER_BASELINE_SCOPE='recompute';", "var PLAYER_BASELINE_SCOPE='gate';"), { player: KH, psurf: clay }));
  if (!gated.base.every(b => />—</.test(b))) return 'gate scope did not take the — path on Clay';
  if (!gated.gap.every(g => />—</.test(g))) return 'gate scope printed a gap without a baseline';
  if (!/Tour — not computed for this filter/.test(gated.all)) return 'gate scope all-matches line did not dash';
  return null;
}

// ---------------------------------------------------------------- Tournament band rows
function checkTournRow(src) {
  const openTop = (src.match(/var DB_DOG_OPEN_TOP=(true|false);/) || [])[0];
  if (!openTop) throw new Error('var DB_DOG_OPEN_TOP not found');
  const code = openTop + '\n' + ['el', 'esc', 'fmtInt', 'fmtP', 'fmtPct', 'signCol', 'median', 'yieldCell', 'agg', 'bands', 'dbMatchWord', 'bandTo', 'bandPanel']
    .map(f => fnSource(src, f)).join('\n') + '\nreturn { bands, bandPanel };';
  const api = new Function('document', 'M', 'SOFT_GATE', 'HARD_GATE', 'POS', 'NEG', 'baselineAllowed', 'baseRange', 'baseAll', code)(
    makeDoc(), DATA.meta, 100, 30, 'var(--pos)', 'var(--neg)', () => true, () => ({ n: 9, yield: -0.01 }), () => ({ n: 9, yield: -0.02 }));
  const ao = DATA.meta.tournaments.indexOf('Australian Open');
  const rows = DATA.rows.filter(r => r[4] === ao);
  const res = api.bands(rows.map(r => ({ p: r[5], w: r[7], b: r[8] })));
  const panel = api.bandPanel('Favourites', res, ['Heavy favourite', 'Firm favourite', 'Narrow favourite'], 'fav', true, false);
  const head = panel.all('db-ph')[0];
  if (!head || head.textContent.replace(/\s+/g, ' ').trim() !== 'Favourites') return 'band-box header carries more than the side title: ' + (head && head.textContent);
  const data = panel.all('db-gr').concat(panel.all('db-ga'));
  if (data.length !== 4) return 'expected 3 bands + All';
  for (const r of data) {
    const n = r.children.length, last = r.children[n - 1];
    if (n !== 7) return 'a Tournament row is not one 7-cell line (' + n + ' cells)';
    if (!/db-tourcell/.test(last.className)) return 'the tour figure is not on the same row as the event figure';
    if (!/db-yieldcell/.test(r.children[n - 2].innerHTML)) return 'the event figure is not beside the tour figure';
  }
  // the subject lives in the chips-and-search box (one control-bar row), never in the panel
  const br = fnSource(src, 'renderFilters');
  if (!/state\.view==='tournaments' && !\(I && I\.lockSubject\)\)\{[\s\S]{0,900}chipSearch\(\{[\s\S]{0,200}cap:4, capNote:'Four events maximum'/.test(br))
    return 'the Tournament subject is not the chips-and-search box (cap 4)';
  return null;
}

// ---------------------------------------------------------------- Compare events
const CMP_FNS = ['el', 'esc', 'yr', 'fmtP', 'fmtPct', 'fmtInt', 'median', 'agg', 'bands', 'filteredRows',
  'catalogEntryForNames', 'tournPicks', 'addTournPick', 'removeTournPick', 'tournCompareOn',
  'tcSignCol', 'tcYield', 'tcUnits', 'tcProfit', 'renderCompare', 'poly', 'paintSeries', 'sampleKeep', 'smoothVals', 'tournLabelOf'];
function cmpHarness(src, picks, st = {}) {
  const T = DATA.meta.tournaments;
  const catalog = picks.map(n => ({ label: n, names: [n] }));
  const code = ['TC_MAX', 'SMOOTH_MODE', 'N_TOUR'].map(v => varLine(src, v)).join('\n') + '\n' +
    /\n  var TC_SERIES=\[[\s\S]*?\];/.exec(src)[0] + '\n' +
    CMP_FNS.map(f => fnSource(src, f)).join('\n') +
    '\nreturn { addTournPick, removeTournPick, tournPicks, tournCompareOn, renderCompare, filteredRows, bands, state: function(){ return state; } };';
  const state = Object.assign({ view: 'tournaments', tournament: null, tournLabel: null, tcmp: [], tcSide: 'all',
    rounds: null, yearMin: null, yearMax: null }, st);
  const doc = makeDoc();
  const api = new Function('document', 'DATA', 'M', 'state', 'I', 'POS', 'NEG', 'SOFT_GATE', 'HARD_GATE', 'N_TOURN',
    'tournCatalog', 'catalogSurface', 'tournLabel', 'pillGroup', 'renderFootnote', code)(
    doc, DATA, DATA.meta, state, st.I || null, 'var(--pos)', 'var(--neg)', 100, 30, 240,
    () => catalog, () => 'Hard', (i) => T[i], (opts) => { const g = doc.createElement('div'); g.className = 'db-pills'; g._opts = opts; return g; }, () => {});
  for (const n of picks) api.addTournPick({ label: n, names: [n] });
  api.doc = doc;
  return api;
}
function checkCompare(src) {
  const five = ['Australian Open', 'French Open', 'Wimbledon', 'US Open', 'Masters Cup'];   // archive strings
  const api = cmpHarness(src, five);
  if (api.tournPicks().length !== 4) return 'more than four events can be picked: ' + api.tournPicks().length;
  if (!api.tournCompareOn()) return 'compare is not on with four picks';
  const body = api.doc.createElement('div');
  api.renderCompare(body);
  const card = body.all('db-tcmp')[0];
  if (!card) return 'no compare panel';
  const svg = card.all('db-plotarea')[0].innerHTML;
  const lines = [...svg.matchAll(/<polyline data-series="(\d)"[^>]*stroke="([^"]+)" stroke-width="([\d.]+)"( stroke-dasharray="([^"]+)")?/g)]
    .map(m => ({ k: +m[1], stroke: m[2], w: m[3], dash: m[5] || null })).sort((a, b) => a.k - b.k);
  const want = [['var(--viz-lead)', '2.4', null], ['var(--viz-white-lead)', '2', null], ['var(--viz-tick)', '2', null], ['var(--viz-white-lead)', '2', '6 5']];
  if (lines.length !== 4) return 'expected 4 series, painted ' + lines.length;
  for (let i = 0; i < 4; i++) {
    const [s, w, d] = want[i];
    if (lines[i].stroke !== s || lines[i].w !== w || lines[i].dash !== d) return 'series ' + (i + 1) + ' is ' + JSON.stringify(lines[i]);
  }
  if (/fill="(?!none)/.test(svg.replace(/<svg[^>]*>/, ''))) return 'an area fill is painted';
  if (/viz-(amber|up|down|hard|clay|grass|indoor)|--bar\b/.test(svg)) return 'a categorical hue is used';
  if (svg.indexOf('data-series="1"') < svg.indexOf('data-series="4"')) return 'the lead series is not painted on top';
  if (card.all('db-plate').length || card.all('db-enddot').length || card.all('db-endcol').length) return 'plates / end dots are painted';
  const leg = card.all('db-tcleg')[0];
  if (!leg || leg.children.length !== 4) return 'legend does not carry one entry per event';
  for (const e of leg.children) if (!/<b style="color:[^"]+">(−|\+)?[\d,]+u<\/b>/.test(e.innerHTML)) return 'legend end value missing / not true minus: ' + e.innerHTML;
  // figures = the band view's own aggregation
  const t = card.all('db-tcr').map(r => r.children.map(c => c.textContent));
  const ao = api.filteredRows(['Australian Open']);
  const fav = api.bands(ao.map(r => ({ p: r[5], w: r[7], b: r[8] }))).all;
  const matches = t.find(r => r[0] === 'Matches'), fy = t.find(r => r[0] === 'Favourite yield');
  if (matches[1] !== ao.length.toLocaleString('en-GB')) return 'Matches cell ' + matches[1] + ' != ' + ao.length;
  if (fy[1] !== ((fav.yield >= 0 ? '+' : '') + (fav.yield * 100).toFixed(2) + '%')) return 'Favourite yield cell does not match the band-view agg';
  // removing pick 1 promotes pick 2, order kept
  api.removeTournPick('Australian Open');
  if (api.tournPicks().map(p => p.label).join('|') !== 'French Open|Wimbledon|US Open') return 'remove did not promote: ' + api.tournPicks().map(p => p.label).join('|');
  // the locked ROI embed never compares
  const locked = cmpHarness(src, five.slice(0, 2), { I: { lockSubject: true } });
  if (locked.tournCompareOn()) return 'the locked embed turned compare on';
  return null;
}

const RULES = { checkSideFlip, checkSharedAxes, checkRoleCards, checkClay, checkTournRow, checkCompare };
test('TEN-399 b · Player: Side flips every figure, note and curve', () => assert.equal(checkSideFlip(SRC), null));
test('TEN-399 b · Player: three charts share one y-domain and one tick set, 2013 … 2026', () => assert.equal(checkSharedAxes(SRC), null));
test('TEN-399 b · Player: role cards — gap row only, neutral baseline, split one convention', () => assert.equal(checkRoleCards(SRC), null));
test('TEN-399 b · Player: Surface = Clay — recompute (as built) and the — path under the gate', () => assert.equal(checkClay(SRC), null));
test('TEN-399 b · Tournament: tour comparison inline, no event name in the band header', () => assert.equal(checkTournRow(SRC), null));
test('TEN-399 b · Compare events: max 4, series colours by pick order, legend end values only', () => assert.equal(checkCompare(SRC), null));

const MUTANTS = {
  checkSideFlip: s => s.replace("price=fading?v.op:v.p, won=fading?(v.w?0:1):v.w;", "price=v.p, won=v.w;"),
  checkSharedAxes: s => s.replace("pair.appendChild(panelFor(series[1], grid, Y, PH, tAll, 230, false, geo));",
    "pair.appendChild(panelFor(series[1], grid, Y, PH, seasonIndexTicks(spine, spineX, [4,2,1], dOf), 230, false, geo));"),
  checkRoleCards: s => s.replace("'<b style=\"color:var(--text-label);font-weight:500\">'+(known?fmtPct(base):'—')", "'<b style=\"color:var(--text-label)\">'+(known?fmtPct(base):'—')"),
  checkClay: s => s.replace("if(PLAYER_BASELINE_SCOPE==='gate' && ", "if(false && "),
  checkTournRow: s => s.replace("row.appendChild(el('div','db-tourcell'+(bs?'':' none'), bs?fmtPct(bs.yield):'—'));",
    "row.appendChild(el('div',null,'')); g.appendChild(row); row=el('div','db-gr'); row.appendChild(el('div','db-tourcell'+(bs?'':' none'), bs?fmtPct(bs.yield):'—'));"),
  checkCompare: s => s.replace("{ stroke:'var(--viz-tick)',       w:2,   dash:null },", "{ stroke:'var(--viz-amber)',      w:2,   dash:null },"),
};
test('CONTROL: every TEN-399 b ruling goes red on its mutant', () => {
  for (const [rule, mut] of Object.entries(MUTANTS)) {
    const m = mut(SRC);
    assert.notEqual(m, SRC, rule + ': mutant anchor not found');
    let out;
    try { out = RULES[rule](m); } catch (e) { out = 'threw: ' + e.message; }
    assert.notEqual(out, null, rule + ' stayed green on its mutant');
  }
});
