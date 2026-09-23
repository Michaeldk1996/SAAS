// TEN-262 — founder rulings of 2026-09-23 on the Database tab:
//   1. the Career / Last 52 control on Ratings is ACTIVE: it switches every board
//      column and the compare panel's highlighted column between the store's
//      `career` and `last52` scopes; Elo has no last-52 value and is a dash there;
//      the control is the Lines tab's control and stays up while players are picked
//   5. seven more retired players (the file is checked against the store here)
//   6. retired players leave the Lines FIELD and its denominator
//
// Method, as test-ten260-ratings.mjs: SLICE the shipped renderer out of the page,
// EXECUTE it against the published store under a DOM shim, read what it painted.
// The Lines half RUNS build-lines-field.js end to end on fixture shards and reads the
// file it wrote. Every check re-runs against a mutant; a mutant that survives fails.
//
// Run: node --test test-ten262.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const BUILDER = readFileSync(join(HERE, 'build-lines-field.js'), 'utf8');
const STORE = join(HERE, 'surface-ratings.json');
const ELO_FILE = join(HERE, 'elo-ratings.json');
const RETIRED_FILE = join(HERE, 'retired-players.json');
const HAVE = existsSync(STORE) && existsSync(RETIRED_FILE) && existsSync(ELO_FILE);

function fnSource(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function ' + name + ' is gone — this lock points at nothing');
  const nl = src.indexOf('\n', i);
  const oneLine = src.slice(i, nl < 0 ? src.length : nl);
  if ((oneLine.match(/\{/g) || []).length === (oneLine.match(/\}/g) || []).length
      && oneLine.trimEnd().endsWith('}')) return oneLine;
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces slicing ' + name);
}
function objSource(src, name) {
  const i = src.indexOf('var ' + name + '=');
  if (i < 0) throw new Error(name + ' is gone');
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1) + ';'; }
  }
  throw new Error('unbalanced braces slicing ' + name);
}
function constOf(src, name) {
  const m = new RegExp('var\\s+' + name + '\\s*=\\s*(\\d+)\\s*;').exec(src);
  if (!m) throw new Error(name + ' is gone from the source');
  return Number(m[1]);
}
function makeDoc() {
  const mk = (tag) => ({
    tagName: tag, className: '', title: '', _text: '', _html: '', children: [], style: {}, disabled: false,
    get classList() { const n = this; return { add(c) { n.className += ' ' + c; }, toggle() {} }; },
    appendChild(c) { this.children.push(c); return c; },
    set textContent(v) { this._text = String(v); this.children = []; },
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); },
    set innerHTML(v) { this._html = String(v); this._text = String(v).replace(/<[^>]*>/g, ''); this.children = []; },
    get innerHTML() { return this._html; },
    get firstChild() { return this.children[0] || null; },
    get childNodes() { return this.children; },
    querySelectorAll(sel) {
      const cls = sel.replace(/^\./, ''); const out = [];
      const walk = (e) => { for (const c of e.children) {
        if ((c.className || '').split(/\s+/).includes(cls)) out.push(c); walk(c); } };
      walk(this); return out;
    },
  });
  return { createElement: mk };
}
const hasCls = (n, c) => (n.className || '').split(/\s+/).includes(c);

const NEED = ['el', 'esc', 'fmtInt', 'median', 'ratEloKey', 'ratLastTok', 'ratEloRec', 'ratNode',
  'ratMatches', 'ratVal', 'ratRating', 'ratN', 'ratBoardPool', 'ratPool', 'ratMedian', 'ratFmt',
  'ratSortRows', 'ratSortHead', 'ratSliceNote', 'ratInitials', 'ratAvatar', 'ratLeaderboard',
  'ratRetiredSet', 'ratRoster', 'ratRetiredOnStore', 'ratMView', 'ratRound3', 'ratMentalFor',
  'ratPP', 'ratMentalExtras', 'ratMentalExtrasAll', 'ratMViewPills', 'ratRetiredNote',
  'ratComparePanel', 'ratBoardTabs', 'ratOverview', 'pillGroup', 'renderRatings', 'renderFilters'];

function build(src, { scope = 'career', board = 'overview', sel = [] } = {}) {
  let code = objSource(src, 'RAT_BOARDS') + '\n';
  for (const f of NEED) code += fnSource(src, f) + '\n';
  const RAT = JSON.parse(readFileSync(STORE, 'utf8'));
  const ELO = JSON.parse(readFileSync(ELO_FILE, 'utf8'));
  const retired = Object.fromEntries(JSON.parse(readFileSync(RETIRED_FILE, 'utf8')).retired.map(r => [r.name, true]));
  const doc = makeDoc();
  const bar = doc.createElement('div');
  const sandbox = {
    document: doc, RAT, ELO, RETIRED: null,
    RAT_GATE: constOf(src, 'RAT_GATE'), ME_RANK_MIN: constOf(src, 'ME_RANK_MIN'),
    ELO_CAVEAT: '', POS: '#3dd68c', NEG: '#e0616f', MUT: '#8b96b5', I: {},
    state: { ratSurf: 'All', ratScope: scope, ratBoard: board, ratSortKey: board === 'overview' ? 'elo' : 'rtg',
             ratSortDir: 'desc', ratSel: sel, ratQ: '', ratMView: 'both', view: 'ratings' },
    render() {}, ratOpenPlayer() {}, q(id) { return id === 'filters' ? bar : null; }, use() {}, loadRatings() {},
    chipSearch() { return doc.createElement('div'); }, resetFilters() {}, console,
  };
  const keys = [...Object.keys(sandbox), 'ARG_RETIRED'];
  const api = new Function(...keys, code +
    '\nRETIRED = ARG_RETIRED;' +
    '\nreturn {ratLeaderboard, ratBoardPool, ratPool, ratOverview, ratComparePanel, renderRatings, renderFilters, ratNode, state, RAT};')(
    ...Object.values(sandbox), retired);
  return { api, bar, doc, RAT, ELO };
}

// Paint a board's grid and return its data rows: [{name, cells:[text...]}].
function boardRows(src, board, scope) {
  const { api } = build(src, { scope, board });
  const pool = board === 'overview' ? api.ratPool() : api.ratBoardPool(board);
  const wrap = board === 'overview' ? api.ratOverview(pool) : api.ratLeaderboard(pool, board);
  const grid = wrap.children[0].children[0];
  const ncol = grid.children.filter(c => hasCls(c, 'db-rhead')).length;
  const cells = grid.children.filter(c => hasCls(c, 'db-rrow'));
  if (!ncol || cells.length % ncol) throw new Error(`grid of ${cells.length} cells does not divide into ${ncol} columns`);
  const out = [];
  out.eloIdx = grid.children.filter(c => hasCls(c, 'db-rhead')).findIndex(h => /^Elo/.test(h.textContent.trim()));
  for (let i = 0; i < cells.length; i += ncol) {
    const r = cells.slice(i, i + ncol);
    out.push({ name: (r[1].querySelectorAll('db-rname')[0] || {}).textContent, cells: r.map(c => c.textContent) });
  }
  return out;
}

const PICKS = ['C. Alcaraz', 'J. Sinner'];
const CHECKS = {
  // 1 · the scope switch: the Serve board paints the store's own figure for the
  // scope on screen, and the two scopes differ for the same player.
  scopeValues(src) {
    const RAT = JSON.parse(readFileSync(STORE, 'utf8'));
    const p = RAT.players.find(x => x.name === 'C. Alcaraz');
    const want = s => p.surfaces.All[s].serve.rating.toFixed(0);   // the serve board paints 0 dp (RAT_BOARDS.serve.rtgDec)
    if (want('career') === want('last52')) return 'fixture: career and last52 serve ratings coincide';
    for (const scope of ['career', 'last52']) {
      const { api } = build(src, { scope, board: 'serve' });
      const wrap = api.ratLeaderboard(api.ratBoardPool('serve'), 'serve');
      const grid = wrap.children[0].children[0];
      const idx = grid.children.findIndex(c => (c.querySelectorAll('db-rname')[0] || {}).textContent === 'C. Alcaraz');
      if (idx < 0) return 'C. Alcaraz not painted on the serve board at ' + scope;
      const rating = grid.children[idx + 2].textContent;   // # · player · n · RATING
      if (rating !== want(scope)) return `${scope}: painted serve rating ${rating}, store says ${want(scope)}`;
    }
    return null;
  },
  // 1 · every non-Elo board is gated per scope: its painted rows are exactly the
  // players whose node AT THAT SCOPE clears the 10-match gate.
  gatePerScope(src) {
    const RAT = JSON.parse(readFileSync(STORE, 'utf8'));
    const retired = new Set(JSON.parse(readFileSync(RETIRED_FILE, 'utf8')).retired.map(r => r.name));
    const counts = {};
    for (const scope of ['career', 'last52']) {
      const { api } = build(src, { scope, board: 'return' });
      const got = api.ratBoardPool('return').map(p => p.name).sort();
      const exp = RAT.players.filter(p => {
        if (retired.has(p.name)) return false;
        const n = p.surfaces.All && p.surfaces.All[scope]; if (!n || !n.return || typeof n.return.rating !== 'number') return false;
        const m = (n.sample.matches || 0) + (n.return.inclChallenger ? (n.sample.challMatches || 0) : 0);
        return m >= 10;
      }).map(p => p.name).sort();
      if (got.join('|') !== exp.join('|')) return `${scope}: return board has ${got.length} rows, recomputed ${exp.length}`;
      counts[scope] = got.length;
    }
    if (counts.career === counts.last52) return 'fixture: the two scopes gate to the same field size';
    return null;
  },
  // 1 · Elo has no last-52 value: on Last 52 every Elo cell of the Overview is a
  // dash and the Elo board has no rows but says why; on Career they carry figures.
  eloDash(src) {
    const car = boardRows(src, 'overview', 'career'), l52 = boardRows(src, 'overview', 'last52');
    const eloCol = rows => rows.map(r => r.cells[rows.eloIdx]);
    const carNum = eloCol(car).filter(t => /^\d/.test(t)).length;
    if (carNum < 50) return `career overview: only ${carNum} numeric Elo cells`;
    const l52Num = eloCol(l52).filter(t => t !== '—');
    if (l52Num.length) return `last52 overview: ${l52Num.length} Elo cells are not a dash (e.g. ${l52Num[0]})`;
    const { api } = build(src, { scope: 'last52', board: 'elo' });
    const pool = api.ratBoardPool('elo');
    if (pool.length) return `last52 Elo board lists ${pool.length} players`;
    const wrap = api.ratLeaderboard(pool, 'elo');
    const txt = wrap.textContent;
    if (!/No Elo on the Last 52 scope/.test(txt)) return 'last52 Elo board does not say why it is empty';
    const { api: a2 } = build(src, { scope: 'career', board: 'elo' });
    if (a2.ratBoardPool('elo').length < 50) return 'career Elo board lost its rows';
    return null;
  },
  // 1 · the compare panel's highlighted (blue-wash) column follows the scope.
  compareHighlight(src) {
    for (const scope of ['career', 'last52']) {
      const { api } = build(src, { scope, board: 'overview', sel: PICKS });
      const panel = api.ratComparePanel();
      const head = panel.children[0];
      const subs = head.children.filter(c => hasCls(c, 'db-sub'));
      const liveSubs = subs.filter(c => hasCls(c, 'live')).map(c => c.textContent);
      const want = scope === 'career' ? 'Career' : 'Last 52';
      if (liveSubs.length !== PICKS.length || liveSubs.some(t => t !== want)) return `${scope}: highlighted sub-heads ${JSON.stringify(liveSubs)}`;
      // Serve row: the highlighted cell holds that scope's figure from the store.
      const serveRow = panel.children.find(r => hasCls(r, 'db-cmpmrow') && /Serve rating/.test(r.children[0].textContent));
      const live = serveRow.children.filter(c => hasCls(c, 'live'));
      const RAT = JSON.parse(readFileSync(STORE, 'utf8'));
      const exp = RAT.players.find(p => p.name === PICKS[0]).surfaces.All[scope].serve.rating.toFixed(0);
      if (live.length !== PICKS.length || live[0].textContent !== exp) return `${scope}: highlighted serve cell "${live[0] && live[0].textContent}", store ${exp}`;
    }
    return null;
  },
  // 1 · the control: Lines-style pills labelled Career / Last 52, present and
  // enabled with players picked, and a click moves the scope.
  control(src) {
    for (const sel of [[], PICKS]) {
      const { api, bar } = build(src, { scope: 'career', sel });
      api.renderFilters();
      const groups = bar.querySelectorAll('db-pills').filter(g => g.children.some(b => b.textContent === 'Career'));
      if (groups.length !== 1) return `${sel.length} picked: ${groups.length} Career/Last 52 controls`;
      const g = groups[0];
      if (!hasCls(g, 'lines')) return 'the control is not the Lines-style pill group';
      const labels = g.children.map(b => b.textContent).join('|');
      if (labels !== 'Career|Last 52') return 'labels ' + labels;
      if (g.children.some(b => b.disabled)) return `${sel.length} picked: control disabled`;
      g.children[1].onclick();
      if (api.state.ratScope !== 'last52') return 'clicking Last 52 left ratScope at ' + api.state.ratScope;
      // …and the board painted AFTER the click carries the Last 52 figure.
      const p = api.RAT.players.find(x => x.name === 'C. Alcaraz');
      const wrap = api.ratLeaderboard(api.ratBoardPool('serve'), 'serve');
      const grid = wrap.children[0].children[0];
      const idx = grid.children.findIndex(c => (c.querySelectorAll('db-rname')[0] || {}).textContent === 'C. Alcaraz');
      const painted = idx < 0 ? null : grid.children[idx + 2].textContent;
      if (painted !== p.surfaces.All.last52.serve.rating.toFixed(0)) return `after clicking Last 52 the serve board paints ${painted}, last52 is ${p.surfaces.All.last52.serve.rating.toFixed(0)}`;
    }
    return null;
  },
};

const MUTANTS = {
  scopeValues: s => s.replace("return s ? (s[state.ratScope]||null) : null;", "return s ? (s['career']||null) : null;"),
  gatePerScope: s => s.replace("return s ? (s[state.ratScope]||null) : null;", "return s ? (s['last52']||null) : null;"),
  eloDash: s => s.split("state.ratScope!=='career') return null;").join("false) return null;"),
  compareHighlight: s => s.replace("var hiL52 = state.ratScope==='last52';", "var hiL52 = true;"),
  control: s => s.replace("state.ratScope, function(v){ state.ratScope=v; }, false, 'lines'));", "state.ratScope, function(v){ state.ratScope=v; }, state.ratSel.length>0));"),
};

// ── Lines field: run the real builder on fixture shards ─────────────────────────
function rows(won, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const w = i < won;
    out.push({ date: '2025-0' + (1 + (i % 9)) + '-10', surface: 'Hard', sets: w ? [{ p: 6, o: 3 }, { p: 6, o: 4 }] : [{ p: 4, o: 6 }, { p: 3, o: 6 }] });
  }
  return out;
}
const LF_PLAYERS = { 'A. Active': rows(15, 20), 'B. Active': rows(10, 20), 'C. Active': rows(5, 20), 'R. Retired': rows(19, 20) };
function runBuilder(builderSrc, { retired = ['R. Retired'], writeRetired = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ten262-lf-'));
  try {
    const names = Object.keys(LF_PLAYERS);
    writeFileSync(join(dir, 'surface-ratings.json'), JSON.stringify({ players: names.map(n => ({ name: n })) }));
    writeFileSync(join(dir, 'player-profiles.json'), JSON.stringify({ players: Object.fromEntries(names.map((n, i) => ['k' + i, { name: n }])) }));
    writeFileSync(join(dir, 'career-history-index.json'), JSON.stringify({ players: Object.fromEntries(names.map((n, i) => ['k' + i, {}])) }));
    mkdirSync(join(dir, 'career-history'));
    names.forEach((n, i) => writeFileSync(join(dir, 'career-history', 'k' + i + '.json'), JSON.stringify({ matches: LF_PLAYERS[n] })));
    if (writeRetired) writeFileSync(join(dir, 'retired-players.json'), JSON.stringify({ retired: retired.map(n => ({ name: n })) }));
    writeFileSync(join(dir, 'builder.js'), builderSrc);
    const r = spawnSync(process.execPath, ['builder.js', '--html', join(HERE, 'bsp-consult-dashboard.html'), '--cutoff', '2024-01-01'], { cwd: dir, encoding: 'utf8' });
    const out = existsSync(join(dir, 'lines-field.json')) ? JSON.parse(readFileSync(join(dir, 'lines-field.json'), 'utf8')) : null;
    return { status: r.status, out, stderr: r.stderr };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const LF_CHECKS = {
  // 6 · the retired player is in NO field array, every "of M" is 3 not 4, and the
  // file names who was removed.
  fieldExcludesRetired(b) {
    const { status, out, stderr } = runBuilder(b);
    if (status !== 0 || !out) return 'builder failed: ' + stderr;
    const sl = out.slices['bo3|All|career'];
    const line = sl['+1.5 sets'];
    if (!Array.isArray(line)) return 'no +1.5 sets line';
    // +1.5 sets lands on a 2-0 win only, so each rate is won/n — recomputed here.
    const exp = [15, 10, 5].map(w => w / 20 * 100).sort((a, b) => a - b);
    if (JSON.stringify(line) !== JSON.stringify(exp)) return `+1.5 sets field ${JSON.stringify(line)}, expected ${JSON.stringify(exp)} (95 = the retired player)`;
    const sizes = Object.values(sl).map(a => a.length);
    if (sizes.some(n => n > 3)) return 'a field has ' + Math.max(...sizes) + ' entries with 3 active players';
    if (out.source.rosterSize !== 3) return 'rosterSize ' + out.source.rosterSize;
    if (JSON.stringify(out.source.retiredExcluded) !== '["R. Retired"]') return 'retiredExcluded ' + JSON.stringify(out.source.retiredExcluded);
    return null;
  },
  // A missing list must fail the build, never be read as "nobody retired".
  missingListFails(b) {
    const { status, out } = runBuilder(b, { writeRetired: false });
    if (status === 0 || out) return 'the builder published a field with no retired list';
    return null;
  },
};
// Paint the Lines rows with the page's own lnPaint, fed the field file the real
// builder wrote. A retired subject whose rate EQUALS an active player's must still
// not be ranked - he is not in the field.
function linesRank(src, lnf, nm, subjRows) {
  const vs = n => { const m = new RegExp('var\\s+' + n + '\\s*=\\s*').exec(src); const o = m.index + m[0].length, oc = src[o], cc = oc === '{' ? '}' : oc === '[' ? ']' : null;
    if (!cc) return src.slice(m.index, src.indexOf(';', o) + 1);
    let d = 0; for (let k = o; k < src.length; k++) { if (src[k] === oc) d++; else if (src[k] === cc) { d--; if (!d) return src.slice(m.index, k + 1) + ';'; } } };
  let code = '';
  for (const v of ['LN_LADDERS', 'LN_GROUPS', 'LN_MIN_N']) code += vs(v) + '\n';
  for (const f of ['el', 'esc', 'fmtInt', 'fmtDate', 'lnCutoff', 'lnPartition', 'lnFormat', 'lnHit', 'lnLine', 'lnPools',
    'lnRate', 'lnRound3', 'lnFieldStats', 'lnSgn', 'lnSgnCol', 'lnPaint', 'lnFoot']) code += fnSource(src, f) + '\n';
  const mi = src.indexOf('function median(a){ if(!a.length)'); code += src.slice(mi, src.indexOf('\n', mi)) + '\n';
  const doc = makeDoc();
  const sb = { document: doc, MON: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    state: { lnSurf: 'All', lnScope: 'career', lnFmt: 'bo3', lnCat: null, lnSel: [nm] }, LNF: lnf, console };
  const api = new Function(...Object.keys(sb), code + '\nreturn {lnPaint, lnPools};')(...Object.values(sb));
  const host = doc.createElement('div');
  api.lnPaint(host, [{ nm, rows: subjRows, P: api.lnPools(subjRows, 'All', 'career') }], doc.createElement('div'));
  const row = host.querySelectorAll('db-lnrow').find(r => r.children[0].textContent === '+1.5 sets');
  return row ? row.children.slice(1).map(c => c.textContent) : null;
}
LF_CHECKS.retiredNeverRanked = function (b, src = SRC) {
  const { out } = runBuilder(b);
  if (!out) return 'builder wrote no file';
  // 15 of 20 = 75%, exactly A. Active's rate on +1.5 sets.
  const ret = linesRank(src, out, 'R. Retired', rows(15, 20));
  const act = linesRank(src, out, 'A. Active', rows(15, 20));
  if (!ret || !act) return 'no +1.5 sets row painted';
  if (act[5] !== '1/3') return 'control: A. Active ranked ' + JSON.stringify(act) + ', expected 1/3';
  if (ret[5] !== '—') return 'retired subject ranked ' + JSON.stringify(ret) + ' in a field he is not in';
  return null;
};
const LF_MUTANTS = {
  retiredNeverRanked: null,   // mutates the PAGE, see below
  fieldExcludesRetired: s => s.replace("const roster = ratings.players.map(p => p.name).filter(nm => !retiredSet.has(nm));", "const roster = ratings.players.map(p => p.name);"),
  missingListFails: s => s.replace("if (!retiredFile || !Array.isArray(retiredFile.retired)) throw new Error(", "if (!retiredFile || !Array.isArray(retiredFile.retired)) console.warn(").replace("const retiredSet = new Set(retiredFile.retired", "const retiredSet = new Set(((retiredFile||{}).retired||[])"),
};

// 5 · the published list: every entry names a player on the store exactly, carries a
// source, and the seven founder-confirmed names are there; Kyrgios is not.
function checkRetiredFile(j = JSON.parse(readFileSync(RETIRED_FILE, 'utf8'))) {
  const store = new Set(JSON.parse(readFileSync(STORE, 'utf8')).players.map(p => p.name));
  const names = j.retired.map(r => r.name);
  const miss = names.filter(n => !store.has(n));
  if (miss.length) return 'retired entries matching nobody on the store: ' + miss.join(', ');
  if (j.retired.some(r => !r.source || !String(r.source).trim())) return 'an entry has no source';
  for (const n of ['G. Monfils', 'S. Wawrinka', 'C. Lestienne', 'B. Balleret', 'R. Bautista-Agut', 'P. Carreno-Busta', 'N. Basilashvili'])
    if (!names.includes(n)) return n + ' is not on the retired list';
  if (names.includes('N. Kyrgios')) return 'Kyrgios is on the retired list — he is injured, not retired';
  const cands = Object.keys(j._candidates_for_review || {}).join(' | ');
  if (/Monfils|Wawrinka|Lestienne|Balleret|Bautista|Carreno|Basilashvili/.test(cands)) return 'a confirmed player is still a candidate: ' + cands;
  return null;
}

// 2 + 3 · the app shell, read off BOTH published pages: sidebar 250px (and the body
// offset that makes room for it), and the design's star as the Stennisfy Model icon.
const STAR = 'M10 3l1.9 3.9 4.3.6-3.1 3 .7 4.3L10 16.8 6.3 18.8l.7-4.3-3.1-3 4.3-.6z';
function checkShell(pages) {
  for (const [file, html] of Object.entries(pages)) {
    const side = /\.sf-sidebar\{\s*position:fixed;[^}]*?width:(\d+)px/.exec(html);
    const body = /body\{[^}]*?padding-left:(\d+)px/.exec(html);
    if (!side || side[1] !== '250') return `${file}: sidebar width ${side && side[1]}px`;
    if (!body || body[1] !== '250') return `${file}: body offset ${body && body[1]}px`;
    const item = /<(?:a|button)[^>]*(?:#edge|data-tab="edge")[^>]*>([\s\S]*?)Stennisfy Model<\/(?:a|button)>/.exec(html);
    if (!item) return file + ': no Stennisfy Model nav item';
    const d = [...item[1].matchAll(/<path d="([^"]+)"/g)].map(m => m[1]);
    if (d.length !== 1 || d[0] !== STAR) return `${file}: Stennisfy Model icon paths ${JSON.stringify(d)}`;
  }
  return null;
}
const SHELL = { 'bsp-consult-dashboard.html': SRC, 'account.html': readFileSync(join(HERE, 'account.html'), 'utf8') };
test('TEN-262 app shell · sidebar 250px + star icon on both pages', () => { assert.equal(checkShell(SHELL), null); });

// 6 · the "Archive through" line: the date is meta.dateRange[1] (the store's latest
// match), and past 14 days it adds ". Updates pending." Painted by the real renderChrome
// with a fixed clock. The Database tab's fmtDate is its own one-liner (the page defines
// fmtDate twice), so that exact one is sliced.
function paintFresh(src, latest, todayIso, pinLast = '2026-01-13', which = 'fresh', seam = 2026) {
  const i = src.indexOf("function fmtDate(iso){ if(!iso) return '—';");
  if (i < 0) throw new Error('the Database fmtDate is gone');
  const code = src.slice(i, src.indexOf('\n', i)) + '\n' + fnSource(src, 'dbArchiveStale') + '\n' + fnSource(src, 'renderChrome');
  const els = { subtitle: { innerHTML: '' }, fresh: { textContent: '' } };
  const RealDate = globalThis.Date;
  class FixedDate extends RealDate { static now() { return RealDate.parse(todayIso + 'T12:00:00Z'); } }
  const M = { dateRange: ['2010-01-04', latest], books: ['Pinnacle', 'Bet365'], seamSeason: seam, pinnacleLastPriced: pinLast };
  new Function('q', 'M', 'esc', 'state', 'MON', 'Date', code + '\nrenderChrome();')(
    k => els[k] || null, M, x => String(x), { view: 'tour' },
    ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], FixedDate);
  return which === 'subtitle' ? els.subtitle.innerHTML.replace(/<[^>]*>/g, '') : els.fresh.textContent;
}
const STALE = {
  fresh(src) {
    const t = paintFresh(src, '2026-09-13', '2026-09-23');
    return t === 'Archive through 13 Sep 2026' ? null : 'at 10 days: ' + JSON.stringify(t);
  },
  boundary(src) {
    const t14 = paintFresh(src, '2026-09-13', '2026-09-27'), t15 = paintFresh(src, '2026-09-13', '2026-09-28');
    if (t14 !== 'Archive through 13 Sep 2026') return 'at exactly 14 days: ' + JSON.stringify(t14);
    if (t15 !== 'Archive through 13 Sep 2026. Updates pending.') return 'at 15 days: ' + JSON.stringify(t15);
    return null;
  },
  fromData(src) {
    const t = paintFresh(src, '2026-07-26', '2026-07-30');
    return t === 'Archive through 26 Jul 2026' ? null : 'the date does not follow dateRange[1]: ' + JSON.stringify(t);
  },
};
// TEN-262 founder ruling on the header: Pinnacle covers the seasons BEFORE the seam, and
// where the source's Pinnacle prices stop is read from meta.pinnacleLastPriced.
STALE.header = function (src) {
  const want = 'Historical yield by odds band from our own ATP closing-line archive — Pinnacle closing prices, 2010–2025; 2026 settled on Bet365 (the source’s Pinnacle prices stop on 13 Jan 2026), seam-marked on the curves.';
  const t = paintFresh(src, '2026-09-13', '2026-09-23', '2026-01-13', 'subtitle');
  if (t !== want) return 'header: ' + JSON.stringify(t);
  const none = paintFresh(src, '2026-09-13', '2026-09-23', null, 'subtitle');
  if (/stop on/.test(none)) return 'no Pinnacle date in the store, but the header printed one: ' + JSON.stringify(none);
  if (!/2010–2025; 2026 settled on Bet365, seam-marked/.test(none)) return 'header without the date: ' + JSON.stringify(none);
  // A different stop date must move the text - a typed "13 Jan 2026" cannot pass this.
  const other = paintFresh(src, '2026-09-13', '2026-09-23', '2026-02-03', 'subtitle');
  if (!/prices stop on 3 Feb 2026\)/.test(other)) return 'stop date not read from the store: ' + JSON.stringify(other);
  // An archive that ends BEFORE the seam season: one book, its own last year, no Bet365 clause.
  const pre = paintFresh(src, '2025-11-16', '2025-11-20', '2025-11-16', 'subtitle');
  if (!/Pinnacle closing prices, 2010–2025, seam-marked/.test(pre) || /Bet365/.test(pre)) return 'pre-seam archive: ' + JSON.stringify(pre);
  // The seam moves: every year in the sentence follows seamSeason, none is typed.
  const s27 = paintFresh(src, '2027-03-01', '2027-03-05', '2027-01-10', 'subtitle', 2027);
  if (!/2010–2026; 2027 settled on Bet365 \(the source’s Pinnacle prices stop on 10 Jan 2027\)/.test(s27)) return 'seam 2027: ' + JSON.stringify(s27);
  // A Pinnacle date outside the seam season says nothing about where it stops in the seam season.
  const off = paintFresh(src, '2026-09-13', '2026-09-23', '2025-11-16', 'subtitle');
  if (/stop on/.test(off)) return 'a pre-seam Pinnacle date was printed as the seam-season stop: ' + JSON.stringify(off);
  return null;
};
const STALE_MUTANTS = {
  header: s => s.replace("pEnd=(+y1>=seam) ? (seam-1) : y1", "pEnd=y1"),
  fresh: s => s.replace("(dbArchiveStale(M.dateRange[1], Date.now()) ? '. Updates pending.' : '')", "'. Updates pending.'"),
  boundary: s => s.replace('return (today-t)/864e5 > 14;', 'return (today-t)/864e5 >= 14;'),
  fromData: s => s.replace("'Archive through '+fmtDate(M.dateRange[1])", "'Archive through '+fmtDate('2026-09-13')"),
};
for (const [name, fn] of Object.entries(STALE)) test('TEN-262 archive stamp · ' + name, () => { assert.equal(fn(SRC), null); });
test('CONTROL: every archive-stamp mutant is caught', () => {
  const survived = [];
  for (const [name, mut] of Object.entries(STALE_MUTANTS)) {
    const m = mut(SRC);
    if (m === SRC) { survived.push(name + ' (mutation did not apply)'); continue; }
    let r; try { r = STALE[name](m); } catch (e) { r = 'threw ' + e.message; }
    if (r === null) survived.push(name);
  }
  assert.deepEqual(survived, []);
});

for (const [name, fn] of Object.entries(CHECKS)) {
  test('TEN-262 Ratings · ' + name, { skip: !HAVE && 'published stores absent' }, () => { assert.equal(fn(SRC), null); });
}
for (const [name, fn] of Object.entries(LF_CHECKS)) {
  test('TEN-262 Lines field · ' + name, () => { assert.equal(fn(BUILDER), null); });
}
test('TEN-262 retired-players.json', { skip: !HAVE && 'published stores absent' }, () => { assert.equal(checkRetiredFile(), null); });

test('CONTROL: every TEN-262 mutant is caught', { skip: !HAVE && 'published stores absent' }, () => {
  const survived = [];
  for (const [name, mut] of Object.entries(MUTANTS)) {
    const m = mut(SRC);
    if (m === SRC) { survived.push(name + ' (mutation did not apply)'); continue; }
    let res; try { res = CHECKS[name](m); } catch (e) { res = 'threw: ' + e.message; }
    if (res === null) survived.push(name);
  }
  {
    const m = SRC.replace("var out = name!=null && LNF.source", "var out = false && LNF.source");
    if (m === SRC) survived.push('retiredNeverRanked (mutation did not apply)');
    else if (LF_CHECKS.retiredNeverRanked(BUILDER, m) === null) survived.push('retiredNeverRanked');
  }
  for (const [name, mut] of Object.entries(LF_MUTANTS)) {
    if (!mut) continue;
    const m = mut(BUILDER);
    if (m === BUILDER) { survived.push(name + ' (mutation did not apply)'); continue; }
    let res; try { res = LF_CHECKS[name](m); } catch (e) { res = 'threw: ' + e.message; }
    if (res === null) survived.push(name);
  }
  // The published list: drop one founder-confirmed name, add Kyrgios, add a typo.
  const J = JSON.parse(readFileSync(RETIRED_FILE, 'utf8'));
  const variants = {
    dropBasilashvili: { ...J, retired: J.retired.filter(r => r.name !== 'N. Basilashvili') },
    addKyrgios: { ...J, retired: J.retired.concat([{ name: 'N. Kyrgios', source: 'x' }]) },
    typo: { ...J, retired: J.retired.concat([{ name: 'R. Bautista Agut', source: 'x' }]) },
    noSource: { ...J, retired: J.retired.map((r, i) => i ? r : { ...r, source: '' }) },
  };
  for (const [name, v] of Object.entries(variants)) if (checkRetiredFile(v) === null) survived.push('retired:' + name);
  const shellMutants = {
    width236: { ...SHELL, 'account.html': SHELL['account.html'].replace('width:250px;', 'width:236px;') },
    lineChartIcon: { ...SHELL, 'account.html': SHELL['account.html'].replace(STAR, 'M4 4v12h12"/><path d="M6.5 12.5l3-3.5 2.5 2 4-5.5') },
    bodyOffset: { ...SHELL, 'bsp-consult-dashboard.html': SRC.replace('padding-left:250px;', 'padding-left:236px;') },
  };
  for (const [name, v] of Object.entries(shellMutants)) if (checkShell(v) === null) survived.push('shell:' + name);
  assert.deepEqual(survived, [], 'mutants survived: ' + survived.join(', '));
});
