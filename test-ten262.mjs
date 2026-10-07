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
// The page's OWN sign colours (TEN-399): an injected fake would let a renderer that
// paints a raw value pass a sign-colour check.
const SIGN = (() => { const m = /POS='([^']+)', NEG='([^']+)'/.exec(SRC); if (!m) throw new Error('POS / NEG are gone from the Database tab'); return { POS: m[1], NEG: m[2] }; })();

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
    ELO_CAVEAT: '', POS: SIGN.POS, NEG: SIGN.NEG, MUT: '#8b96b5', I: {},
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
  // 1 · the compare panel's highlighted (4% white wash) column is Last 52 at EVERY scope (TEN-399 fix 5).
  compareHighlight(src) {
    for (const scope of ['career', 'last52']) {
      const { api } = build(src, { scope, board: 'overview', sel: PICKS });
      const panel = api.ratComparePanel();
      const head = panel.children[0];
      const subs = head.children.filter(c => hasCls(c, 'db-sub'));
      const liveSubs = subs.filter(c => hasCls(c, 'live')).map(c => c.textContent);
      const want = 'Last 52';
      if (liveSubs.length !== PICKS.length || liveSubs.some(t => t !== want)) return `${scope}: highlighted sub-heads ${JSON.stringify(liveSubs)}`;
      // Serve row: the highlighted cell holds that scope's figure from the store.
      const serveRow = panel.children.find(r => hasCls(r, 'db-cmpmrow') && /Serve rating/.test(r.children[0].textContent));
      const live = serveRow.children.filter(c => hasCls(c, 'live'));
      const RAT = JSON.parse(readFileSync(STORE, 'utf8'));
      const exp = RAT.players.find(p => p.name === PICKS[0]).surfaces.All.last52.serve.rating.toFixed(0);
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
  compareHighlight: s => s.replace("    var hiL52 = true;", "    var hiL52 = state.ratScope==='last52';"),
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

// 2 + 3 · the app shell, read off BOTH published pages: sidebar 252px (and the body
// offset that makes room for it), and the design's star as the Stennisfy Model icon.
// 252px is founder ruling TEN-286 (2026-09-26, the 12a design's aside), which
// SUPERSEDES TEN-262 #2's 250px — 250 is now a mutant below, not an accepted value.
const STAR = 'M10 3l1.9 3.9 4.3.6-3.1 3 .7 4.3L10 16.8 6.3 18.8l.7-4.3-3.1-3 4.3-.6z';
function checkShell(pages) {
  for (const [file, html] of Object.entries(pages)) {
    const side = /\.sf-sidebar\{\s*position:fixed;[^}]*?width:(\d+)px/.exec(html);
    const body = /body\{[^}]*?padding-left:(\d+)px/.exec(html);
    if (!side || side[1] !== '252') return `${file}: sidebar width ${side && side[1]}px`;
    if (!body || body[1] !== '252') return `${file}: body offset ${body && body[1]}px`;
    const item = /<(?:a|button)[^>]*(?:#edge|data-tab="edge")[^>]*>([\s\S]*?)Stennisfy Model<\/(?:a|button)>/.exec(html);
    if (!item) return file + ': no Stennisfy Model nav item';
    const d = [...item[1].matchAll(/<path d="([^"]+)"/g)].map(m => m[1]);
    if (d.length !== 1 || d[0] !== STAR) return `${file}: Stennisfy Model icon paths ${JSON.stringify(d)}`;
  }
  return null;
}
const SHELL = { 'bsp-consult-dashboard.html': SRC, 'account.html': readFileSync(join(HERE, 'account.html'), 'utf8') };
test('TEN-262/TEN-286 app shell · sidebar 252px + star icon on both pages', () => { assert.equal(checkShell(SHELL), null); });

// 6 · the archive date. TEN-399 D3 folds the old "Archive through … Updates pending." line
// into the header's Updated stat: the value is meta.dateRange[1] (the store's latest match),
// and past 14 days the stat carries the note "Updates pending". Painted by the real
// renderChrome (+ dbHeadStats) with a fixed clock. The Database tab's fmtDate is its own
// one-liner (the page defines fmtDate twice), so that exact one is sliced.
function paintChrome(src, latest, todayIso, books = ['Pinnacle', 'Bet365'], first = '2010-01-04') {
  const i = src.indexOf("function fmtDate(iso){ if(!iso) return '—';");
  if (i < 0) throw new Error('the Database fmtDate is gone');
  const code = src.slice(i, src.indexOf('\n', i)) + '\n' + ['fmtInt', 'dbArchiveStale', 'dbHeadStats', 'renderChrome'].map(f => fnSource(src, f)).join('\n');
  const els = { subtitle: { innerHTML: '' }, fresh: { innerHTML: '', className: '' } };
  const RealDate = globalThis.Date;
  class FixedDate extends RealDate { static now() { return RealDate.parse(todayIso + 'T12:00:00Z'); } }
  const M = { dateRange: [first, latest], books, pinnacleLastPriced: '2026-01-13', used: 40972 };
  const y0 = +first.slice(0, 4), y1 = +latest.slice(0, 4), years = [];
  for (let y = y0; y <= y1; y++) years.push(y);
  new Function('q', 'M', 'esc', 'state', 'MON', 'Date', 'DATA', 'presentYears', code + '\nrenderChrome();')(
    k => els[k] || null, M, x => String(x), { view: 'tour' },
    ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], FixedDate, { rows: [0] }, () => years);
  const stats = [...els.fresh.innerHTML.matchAll(/<div class="db-hstat"><span class="db-hstat__l">([^<]*)<\/span><span class="db-hstat__v">([^<]*)<\/span>(?:<span class="db-hstat__n">([^<]*)<\/span>)?<\/div>/g)]
    .map(m => ({ l: m[1], v: m[2], n: m[3] || null }));
  return { sub: els.subtitle.innerHTML.replace(/<[^>]*>/g, ''), stats, cls: els.fresh.className };
}
const updated = (src, latest, today) => paintChrome(src, latest, today).stats.find(s => s.l === 'Updated') || null;
const STALE = {
  fresh(src) {
    const u = updated(src, '2026-09-13', '2026-09-23');
    return u && u.v === '13 Sep 2026' && u.n === null ? null : 'at 10 days: ' + JSON.stringify(u);
  },
  boundary(src) {
    const u14 = updated(src, '2026-09-13', '2026-09-27'), u15 = updated(src, '2026-09-13', '2026-09-28');
    if (!u14 || u14.v !== '13 Sep 2026' || u14.n !== null) return 'at exactly 14 days: ' + JSON.stringify(u14);
    if (!u15 || u15.v !== '13 Sep 2026' || u15.n !== 'Updates pending') return 'at 15 days: ' + JSON.stringify(u15);
    return null;
  },
  fromData(src) {
    const u = updated(src, '2026-07-26', '2026-07-30');
    return u && u.v === '26 Jul 2026' ? null : 'the date does not follow dateRange[1]: ' + JSON.stringify(u);
  },
};
// TEN-399 item 2 + D3: the header card carries Matches · Seasons · Updated, in that order;
// Matches = meta.used (the one join, unfiltered), Seasons = the seasons the rows hold.
STALE.stats = function (src) {
  const p = paintChrome(src, '2026-09-13', '2026-09-23');
  if (p.cls !== 'db-hstats') return 'stats container class: ' + p.cls;
  const got = p.stats.map(s => s.l + '=' + s.v).join(' · ');
  if (got !== 'Matches=40,972 · Seasons=17 · Updated=13 Sep 2026') return 'header stats: ' + got;
  const p27 = paintChrome(src, '2027-03-01', '2027-03-05');
  if (p27.stats[1].v !== '18') return 'Seasons does not follow the rows: ' + JSON.stringify(p27.stats[1]);
  return null;
};
// TEN-399 item 1 (override) + D3: ONE join, stated once; the header carries no seam sentence.
STALE.header = function (src) {
  const want = 'Historical yield by odds band from our own ATP closing-line archive — Pinnacle closing, else Bet365, per match, 2010–2026.';
  const t = paintChrome(src, '2026-09-13', '2026-09-23').sub;
  if (t !== want) return 'header: ' + JSON.stringify(t);
  if (/stop on|marked on the curves|seam|2026 uses|one book|settled/.test(t)) return 'header still carries a seam / superseded sentence: ' + JSON.stringify(t);
  // The years and the book names follow the data, none is typed.
  const s27 = paintChrome(src, '2027-03-01', '2027-03-05', ['BookA', 'BookB']).sub;
  if (!/— BookA closing, else BookB, per match, 2010–2027\.$/.test(s27)) return '2027 / other books: ' + JSON.stringify(s27);
  return null;
};
// TEN-262 founder ruling (option A): the method note says "priced on", never "settled on".
// Painted by the real renderFootnote.
STALE.footnote = function (src) {
  const code = ['el', 'esc', 'fmtInt'].map(f => fnSource(src, f)).join('\n') + '\n' +
    (() => { const i = src.indexOf("function fmtDate(iso){ if(!iso) return '—';"); return src.slice(i, src.indexOf('\n', i)); })() + '\n' +
    fnSource(src, 'renderFootnote');
  // TEN-384 (option "me") figures: the published store after the per-row join.
  const M = { dateRange: ['2010-01-04', '2026-09-13'], books: ['Pinnacle', 'Bet365'], pinnacleLastPriced: '2026-01-13', used: 40972, archiveRows: 59855,
    windowStart: 2010, bookCounts: { Pinnacle: 38830, Bet365: 2142 },
    exclusions: { preWindow: 15883, noResolvingBookPrice: 498, walkover: 346, retired: 1850, exactTie: 294, edge: 8, overroundGt115: 4 } };
  const doc = makeDoc(), body = doc.createElement('div');
  new Function('document', 'M', 'MON', code + '\nrenderFootnote(arguments[3]);')(doc, M,
    ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], body);
  const t = body.textContent;
  if (!/38,830 priced on Pinnacle and 2,142 on Bet365 \(where Pinnacle has no price\)/.test(t)) return 'method note: ' + JSON.stringify(t.slice(t.indexOf('What is included'), t.indexOf('What is included') + 200));
  if (!/Each match is priced on its Pinnacle closing price, or on its Bet365 closing price where Pinnacle has none \(the source’s Pinnacle prices stop on 13 Jan 2026\)/.test(t))
    return 'method note does not state the per-row join: ' + JSON.stringify(t.slice(0, 400));
  if (!/498 with no closing price on either book/.test(t)) return 'method note: the no-price exclusion is not "neither book"';
  if (/settled on/.test(t)) return 'method note still says "settled on"';
  if (/\(2026\)|uses Bet365|never blended/.test(t)) return 'method note still states the superseded one-book-per-season rule';
  return null;
};
// Second method-note fixture: other counts and another stop date, so a hard-coded
// "38,830" or "13 Jan 2026" cannot pass.
STALE.footnote2 = function (src) {
  const code = ['el', 'esc', 'fmtInt'].map(f => fnSource(src, f)).join('\n') + '\n' +
    (() => { const i = src.indexOf("function fmtDate(iso){ if(!iso) return '—';"); return src.slice(i, src.indexOf('\n', i)); })() + '\n' +
    fnSource(src, 'renderFootnote');
  const M = { dateRange: ['2010-01-04', '2027-03-01'], books: ['Pinnacle', 'Bet365'], pinnacleLastPriced: '2027-01-10', used: 123, archiveRows: 456,
    windowStart: 2010, bookCounts: { Pinnacle: 100, Bet365: 23 },
    exclusions: { preWindow: 1, noResolvingBookPrice: 2, walkover: 3, retired: 4, exactTie: 5, edge: 6, overroundGt115: 7 } };
  const doc = makeDoc(), body = doc.createElement('div');
  new Function('document', 'M', 'MON', code + '\nrenderFootnote(arguments[3]);')(doc, M,
    ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], body);
  const t = body.textContent;
  if (!/100 priced on Pinnacle and 23 on Bet365 \(where Pinnacle has no price\)/.test(t)) return 'second fixture: ' + JSON.stringify(t.slice(0, 400));
  if (!/Pinnacle prices stop on 10 Jan 2027\)/.test(t)) return 'second fixture: the stop date is not read from the store: ' + JSON.stringify(t.slice(0, 400));
  // The archive ends ON the last Pinnacle date: no stop is claimed.
  const M2 = { ...M, pinnacleLastPriced: '2027-03-01' }, b2 = doc.createElement('div');
  new Function('document', 'M', 'MON', code + '\nrenderFootnote(arguments[3]);')(doc, M2,
    ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], b2);
  if (/stop on/.test(b2.textContent)) return 'archive within Pinnacle coverage, but the note claims a stop';
  return null;
};
// TEN-399 founder ruling (card 52bf5cc5 "split" = player-only): the per-book split paragraph is on the
// Player tab only. Paint the real bandPanel (fed by the page's own bands()/agg()) with both books in
// view: it must carry NO split line. The Player strip (playerBookSplit) keeps the wording + hard gate.
STALE.split = function (src) {
  const i = src.indexOf('function median(a){ if(!a.length)');
  const code = 'var DB_DOG_OPEN_TOP=true;\n' + ['el', 'esc', 'fmtInt', 'fmtP', 'fmtPct', 'yieldCell', 'agg', 'bands', 'dbMatchWord', 'bandTo', 'bandPanel', 'playerBookSplit'].map(f => fnSource(src, f)).join('\n') +
    '\n' + src.slice(i, src.indexOf('\n', i)) + '\nreturn { bands, bandPanel, playerBookSplit };';
  const doc = makeDoc(), mkEl = doc.createElement;
  doc.createElement = t => { const e = mkEl(t); e.style.setProperty = function (k, v) { this[k] = v; }; return e; };
  const mk = M => new Function('document', 'M', 'SOFT_GATE', 'HARD_GATE', 'baselineAllowed', code)(doc, M, 100, 30, () => false);
  const vals = [];
  for (let k = 0; k < 30; k++) vals.push({ p: 1.2 + k / 100, w: k % 3 !== 0, b: k < 25 ? 0 : 1 });
  const api = mk({ books: ['Pinnacle', 'Bet365'], pinnacleLastPriced: '2026-01-13' });
  const res = api.bands(vals);
  if (!(res.all.book && res.all.book.ps && res.all.book.b365)) return 'fixture lost one of the two books (vacuous)';
  for (const tourn of [false, true]) {
    const panel = api.bandPanel('Favourites', res, ['Short', 'Mid', 'Long'], 'fav', tourn, true);
    if (panel.querySelectorAll('db-split').length || /Split by book/.test(panel.textContent)) return 'a ' + (tourn ? 'Tournament' : 'Tour') + ' band panel paints a split-by-book line';
  }
  // Player strip: book names from the store, one convention, the hard gate (n < 30 prints no yield).
  const apiX = mk({ books: ['BookA', 'BookB'] });
  const p = apiX.playerBookSplit({ ps: { n: 90, yield: -0.01 }, b365: { n: 40, yield: 0.02 } }, null);
  if (!/^Each match is priced on its BookA closing price, else BookB\. Split by book: <b>−1\.00%<\/b> across 90 matches priced on BookA, <b>\+2\.00%<\/b> across 40 matches priced on BookB\.$/.test(p))
    return 'player split wording: ' + JSON.stringify(p);
  const g = apiX.playerBookSplit({ ps: { n: 90, yield: -0.01 }, b365: { n: 29, yield: 0.66 } }, null);
  if (/66\.00/.test(g) || !/too few matches for a yield across 29 matches priced on BookB/.test(g))
    return 'hard-gated player split: ' + JSON.stringify(g);
  // TEN-384 fx4 item 6: a count of one reads "1 match", never "1 matches".
  const one = apiX.playerBookSplit({ ps: { n: 1, yield: -0.01 }, b365: { n: 1, yield: 0.02 } }, null);
  if (/\b1 matches\b/.test(one) || !/across 1 match priced on BookA, .*across 1 match priced on BookB/.test(one))
    return 'one-match split: ' + JSON.stringify(one);
  return null;
};
STALE.splitGate = STALE.split;   // the gate mutant is judged by the split check, not by a missing key
const STALE_MUTANTS = {
  footnote2: s => s.replace("+' prices stop on '+fmtDate(M.pinnacleLastPriced)+')'", "+' prices stop on 13 Jan 2026)'"),
  split: s => s.replace("// Tour and Tournament band panels carry none.\n    return panel;", "// Tour and Tournament band panels carry none.\n    panel.appendChild(el('div','db-split','Split by book: x'));\n    return panel;"),
  splitGate: s => s.replace("var fig = s.n<HARD_GATE ?", "var fig = false ?"),
  footnote: s => s.replace("fmtInt(bc[M.books[0]])+' priced on '+esc(M.books[0])+' and '", "fmtInt(bc[M.books[0]])+' settled on '+esc(M.books[0])+' prices and '"),
  header: s => s.replace("' closing, else '+esc(M.books[1])+', per match, '", "' closing, else Bet365, per match, '"),
  stats: s => s.replace("['Seasons', fmtInt(seasons), null]", "['Seasons', fmtInt(17), null]"),
  fresh: s => s.replace("stale ? 'Updates pending' : null", "'Updates pending'"),
  boundary: s => s.replace('return (today-t)/864e5 > 14;', 'return (today-t)/864e5 >= 14;'),
  fromData: s => s.replace("['Updated', fmtDate(M.dateRange[1])", "['Updated', fmtDate('2026-09-13')"),
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
    width236: { ...SHELL, 'account.html': SHELL['account.html'].replace('width:252px;', 'width:236px;') },
    width250superseded: { ...SHELL, 'bsp-consult-dashboard.html': SRC.replace('width:252px;', 'width:250px;') },
    lineChartIcon: { ...SHELL, 'account.html': SHELL['account.html'].replace(STAR, 'M4 4v12h12"/><path d="M6.5 12.5l3-3.5 2.5 2 4-5.5') },
    bodyOffset: { ...SHELL, 'bsp-consult-dashboard.html': SRC.replace('padding-left:252px;', 'padding-left:250px;') },
  };
  for (const [name, v] of Object.entries(shellMutants)) if (checkShell(v) === null) survived.push('shell:' + name);
  assert.deepEqual(survived, [], 'mutants survived: ' + survived.join(', '));
});

// ── TEN-399 item 7 · the Ratings re-skin (founder step-6 ticket, 2026-10-07) ────
// Read off the page's own stylesheet (the rule that paints each element, merged in
// cascade order) and off the real renderers, painted against the published store.
//   · card no outline; board tabs = Darker track (track --card + --edge-6, selected
//     --inner + --edge-10 white 700, idle --text-label)
//   · compare panel = --card + 1px --edge-6; the scope column is a 4% white wash
//     (--wash-4), never blue; Δ in the sign colour
//   · avatars = initials on --inner, white, no gradient, no blue
//   · sortable heads --text-label idle / white active; the arrow white (not blue)
//   · field-median row = 2.5% white wash; names white at rest and on hover
function cssRule(src, sel) {
  const css = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = {}; let found = false;
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].split(',').map(x => x.trim()).includes(sel)) continue;
    found = true;
    for (const d of m[2].split(';')) { const k = d.indexOf(':'); if (k > 0) out[d.slice(0, k).trim()] = d.slice(k + 1).trim(); }
  }
  return found ? out : null;
}
const BLUE = /--(link|bar|bar-2|viz-lead|viz-second|hot-dot|pro|open-card)\b/;
const RAT_CSS = {
  card(src) {
    const r = cssRule(src, '.db-rcard'); if (!r) return 'no .db-rcard rule';
    if (r.background !== 'var(--card)' || r['box-shadow'] !== 'var(--top-light)') return `card ${r.background} / ${r['box-shadow']}`;
    if (!/transparent|none/.test(r.border || 'none')) return 'card has an outline: ' + r.border;
    return null;
  },
  boardTabs(src) {
    const t = cssRule(src, '.db-btabs'), b = cssRule(src, '.db-btabs button'), a = cssRule(src, '.db-btabs button.active');
    if (!t || !b || !a) return 'board tab rules missing';
    if (t.background !== 'var(--card)' || t.border !== '1px solid var(--edge-6)') return `track ${t.background} / ${t.border}`;
    if (b.color !== 'var(--text-label)') return 'idle tab ink ' + b.color;
    if (a.background !== 'var(--inner)' || a['border-color'] !== 'var(--edge-10)' || a.color !== 'var(--text)' || a['font-weight'] !== '700') return 'selected tab ' + JSON.stringify(a);
    return null;
  },
  comparePanel(src) {
    const p = cssRule(src, '.db-cmp'); if (!p) return 'no .db-cmp rule';
    if (p.background !== 'var(--card)' || p.border !== '1px solid var(--edge-6)') return `compare panel ${p.background} / ${p.border}`;
    for (const sel of ['.db-sub.live', '.db-cmpcell.live']) {
      const r = cssRule(src, sel); if (!r) return 'no ' + sel + ' rule';
      if (r.background !== 'var(--wash-4)') return `${sel} wash ${r.background}, want var(--wash-4)`;
      if (Object.values(r).some(v => BLUE.test(v))) return sel + ' carries a blue token';
      if (r['box-shadow']) return sel + ' outlines each cell (' + r['box-shadow'] + ') - the column is one wash';
    }
    return null;
  },
  avatar(src) {
    const r = cssRule(src, '.db-av'); if (!r) return 'no .db-av rule';
    if (r.background !== 'var(--inner)' || r.color !== 'var(--text)') return `avatar ${r.background} / ${r.color}`;
    for (const sel of ['.db-av', '.db-av26', '.db-lnav']) {
      const x = cssRule(src, sel) || {};
      if (Object.values(x).some(v => /gradient/.test(v) || BLUE.test(v))) return sel + ' carries a gradient or a blue token';
    }
    if (/style=|gradient/.test(fnSource(src, 'ratAvatar'))) return 'ratAvatar paints its own style';
    return null;
  },
  sortHeads(src) {
    const idle = cssRule(src, '.db-rh.sortable'), on = cssRule(src, '.db-rh.sortable.on'), i = cssRule(src, '.db-rh.sortable i');
    if (!idle || !on || !i) return 'sortable head rules missing';
    if (idle.color !== 'var(--text-label)') return 'idle head ' + idle.color;
    if (on.color !== 'var(--text)') return 'active head ' + on.color;
    if (i.color !== 'var(--text)') return 'sort arrow ' + i.color;
    return null;
  },
  medianRow(src) {
    const r = cssRule(src, '.db-rmed'); if (!r) return 'no .db-rmed rule';
    return r.background === 'color-mix(in srgb, var(--text) 2.5%, transparent)' ? null : 'field-median wash ' + r.background;
  },
  names(src) {
    for (const sel of ['.db-rname', '.db-rname:hover', '.db-cmpname', '.db-cmpname:hover']) {
      const r = cssRule(src, sel); if (!r) return 'no ' + sel + ' rule';
      if (r.color !== 'var(--text)') return `${sel} ${r.color}`;
    }
    return null;
  },
};
for (const [name, fn] of Object.entries(RAT_CSS)) test('TEN-399 Ratings · ' + name, () => { const e = fn(SRC); assert.equal(e, null, e); });

// Painted by the real renderers against the published store.
const RAT_PAINT = {
  // The arrow is a bare <i> (the stylesheet makes it white); the active head flips it.
  sortArrow(src) {
    const { api } = build(src, { board: 'serve' });
    api.state.ratSortDir = 'asc';
    const grid = api.ratLeaderboard(api.ratBoardPool('serve'), 'serve').children[0].children[0];
    const heads = grid.children.filter(c => hasCls(c, 'db-rhead')).map(h => h.children[0]);
    const on = heads.filter(h => hasCls(h, 'on'));
    if (on.length !== 1) return `${on.length} active sort heads`;
    if (!/<i>↑<\/i>$/.test(on[0].innerHTML)) return 'ascending head reads ' + on[0].innerHTML;
    if (heads.some(h => h.style.color || /style=/.test(h.innerHTML))) return 'a sort head carries an inline colour';
    return null;
  },
  // Places 1-3 of a ranked block are white 700 (.top); 4 on are not.
  topThree(src) {
    const { api } = build(src, { board: 'overview' });
    const grid = api.ratOverview(api.ratPool()).children[0].children[0];
    const nums = grid.children.flatMap(c => c.querySelectorAll('db-rnum'));
    if (nums.length < 5) return 'control: fewer than 5 ranked rows';
    const tops = nums.map(n => hasCls(n, 'top'));
    if (tops.slice(0, 3).some(t => !t) || tops.slice(3).some(Boolean)) return 'top marks ' + JSON.stringify(tops.slice(0, 6));
    return null;
  },
  // Δ = Last 52 − career in the sign colour: + --pos, − --neg, 0 / dash --text-label.
  // Picks are found in the store, so the check never goes vacuous as ratings move.
  delta(src) {
    const RAT = JSON.parse(readFileSync(STORE, 'utf8'));
    const retired = new Set(JSON.parse(readFileSync(RETIRED_FILE, 'utf8')).retired.map(r => r.name));
    const gate = constOf(src, 'RAT_GATE');
    const d = p => { const a = p.surfaces.All || {}, c = a.career && a.career.serve, l = a.last52 && a.last52.serve;
      return (c && l && c.svMatches >= gate && l.svMatches >= gate && typeof c.rating === 'number' && typeof l.rating === 'number') ? Math.round(l.rating) - Math.round(c.rating) : null; };
    const ok = RAT.players.filter(p => !retired.has(p.name) && d(p) != null);
    const up = ok.find(p => d(p) > 2), dn = ok.find(p => d(p) < -2);
    if (!up || !dn) return 'control: no player with a rising and a falling serve rating on the store';
    const { api } = build(src, { board: 'overview', sel: [up.name, dn.name] });
    const panel = api.ratComparePanel();
    const row = panel.children.find(r => hasCls(r, 'db-cmpmrow') && /Serve rating/.test(r.children[0].textContent));
    const cells = row.children.filter(c => hasCls(c, 'delta'));
    const col = t => /^\+/.test(t) ? SIGN.POS : /^−/.test(t) ? SIGN.NEG : 'var(--text-label)';
    if (cells.length !== 2) return `${cells.length} delta cells`;
    if (!/^\+/.test(cells[0].textContent) || !/^−/.test(cells[1].textContent)) return 'deltas read ' + cells.map(c => c.textContent).join(' / ');
    for (const c of cells) if (c.style.color !== col(c.textContent)) return `delta ${c.textContent} painted ${c.style.color}`;
    if (SIGN.POS !== 'var(--pos)' || SIGN.NEG !== 'var(--neg)') return `sign colours are ${SIGN.POS} / ${SIGN.NEG}, not the tokens`;
    return null;
  },
};
for (const [name, fn] of Object.entries(RAT_PAINT)) test('TEN-399 Ratings (painted) · ' + name, { skip: !HAVE && 'published stores absent' }, () => { const e = fn(SRC); assert.equal(e, null, e); });

const RAT_MUTANTS = [
  ['card outline back', RAT_CSS.card, s => s.replace('.db-rcard{ background:var(--card); border:1px solid transparent;', '.db-rcard{ background:var(--card); border:1px solid var(--edge-6);')],
  ['selected board tab blue', RAT_CSS.boardTabs, s => s.replace('.db-btabs button.active{ background:var(--inner); border-color:var(--edge-10); color:var(--text);', '.db-btabs button.active{ background:var(--bar); border-color:var(--edge-10); color:var(--text);')],
  ['compare panel back to --inner + 10% edge', RAT_CSS.comparePanel, s => s.replace('background:var(--card); border:1px solid var(--edge-6); border-radius:12px; padding:18px 20px; }', 'background:var(--db-strip); border:1px solid var(--edge-10); border-radius:12px; padding:18px 20px; }')],
  ['scope column back to --inner', RAT_CSS.comparePanel, s => s.replace('.db-sub.live{ color:var(--text); background:var(--wash-4);', '.db-sub.live{ color:var(--text); background:var(--inner);')],
  ['scope cells washed blue', RAT_CSS.comparePanel, s => s.replace('color:var(--db-txt); background:var(--wash-4); border-left:1px solid var(--edge-10);', 'color:var(--db-txt); background:color-mix(in srgb, var(--bar) 10%, transparent); border-left:1px solid var(--edge-10);')],
  ['avatar gradient', RAT_CSS.avatar, s => s.replace('background:var(--inner); background-image:none; border:1px solid var(--edge-10);', 'background:var(--inner); background-image:linear-gradient(var(--bar), var(--inner)); border:1px solid var(--edge-10);')],
  ['avatar blue ink', RAT_CSS.avatar, s => s.replace("font-family:var(--db-mono); font-size:10px; font-weight:700; color:var(--text); }", "font-family:var(--db-mono); font-size:10px; font-weight:700; color:var(--link); }")],
  ['sort arrow blue', RAT_CSS.sortHeads, s => s.replace('.db-rh.sortable i{ font-style:normal; color:var(--text); }', '.db-rh.sortable i{ font-style:normal; color:var(--link); }')],
  ['active head grey', RAT_CSS.sortHeads, s => s.replace('.db-rh.sortable.on{ color:var(--text); }', '.db-rh.sortable.on{ color:var(--text-label); }')],
  ['median row back to --inner', RAT_CSS.medianRow, s => s.replace('.db-rmed{ padding:10px 6px; background:color-mix(in srgb, var(--text) 2.5%, transparent);', '.db-rmed{ padding:10px 6px; background:var(--inner);')],
  ['name hover blue', RAT_CSS.names, s => s.replace('.db-rname:hover{ color:var(--text); }', '.db-rname:hover{ color:var(--link); }')],
  ['arrow painted inline', RAT_PAINT.sortArrow, s => s.replace("(on?(' <i>'+(state.ratSortDir==='desc'?'↓':'↑')+'</i>'):''));", "(on?(' <i style=\"color:var(--link)\">'+(state.ratSortDir==='desc'?'↓':'↑')+'</i>'):''));")],
  ['top four marked', RAT_PAINT.topThree, s => s.replace("el('div','db-rnum'+(i<3?' top':''),String(i+1))", "el('div','db-rnum'+(i<4?' top':''),String(i+1))")],
  ['delta uncoloured', RAT_PAINT.delta, s => s.replace("d.style.color = r===0 ? 'var(--text-label)' : diff>0 ? POS : NEG;", "d.style.color = 'var(--text-label)';")],
];
test('CONTROL: every TEN-399 Ratings mutant is caught', { skip: !HAVE && 'published stores absent' }, () => {
  const survivors = [];
  for (const [name, check, mutate] of RAT_MUTANTS) {
    const m = mutate(SRC);
    assert.notEqual(m, SRC, `mutant "${name}" did not apply — it proves nothing`);
    let caught; try { caught = check(m) !== null; } catch { caught = true; }
    if (!caught) survivors.push(name);
  }
  assert.deepEqual(survivors, [], `${survivors.length} of ${RAT_MUTANTS.length} mutants SURVIVED: ${survivors.join(' · ')}`);
  console.log(`  TEN-399 Ratings mutants: ${RAT_MUTANTS.length} caught, 0 survived`);
});
