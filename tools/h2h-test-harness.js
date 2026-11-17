// Head to Head rebuild (design_handoff_head_to_head, founder 2026-11-16) — the test harness the TEN-402 / TEN-437 suites
// share. It runs the REAL window.H2HPage module (sliced out of the shipped bsp-consult-dashboard.html, never a copy) in a
// vm context and hands back its internals (h2hCard, h2hBoxHTML, stylesCard, tourneyCard, marketCard, …) so a suite can
// execute the renderers on a fixture. A page-level helper the module calls (fhH2hSetScores, ps2Meeting, maGate, …) is
// sliced from the same page the first time the module reaches it (a ReferenceError names it), so every rule under test
// is the shipped one. Stubs are only for I/O (fetch, the DOM, the loaders) and for what a suite passes in.
//
// Not a suite (named outside the test-* pattern on purpose, tools/test-every-suite-is-wired.js): it is required by the
// suites test-ten402-a/b/c/lead/r1x/r1y/r2n/r4n.mjs, test-ten437-h2h.mjs and test-ten403-header.mjs.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const MARK = 'HEAD-TO-HEAD PAGE  (ported from design_handoff_head_to_head';

// the internals a suite may call (all are names declared inside the module)
const EXPORTS = ['state', 'setState', 'bindH', 'E', 'xAv', 'xHelp', 'xSw', 'xHead', 'pageHTML', 'pickedCard', 'selectorBar', 'emptyState',
  'loadingState', 'modelCard', 'dnaCard', 'dnaExtraFor', 'h2hCard', 'xHotHTML', 'h2hBoxHTML', 'xPointsFor', 'stylesCard', 'xStyleFilter',
  'xStyleSpeedOf', 'xSurOf', 'tourneyCard', 'xTourDefault', 'xTrEvent', 'xTrCut', 'xTrAgg', 'marketVals', 'marketCard', 'xBandName', 'xSmooth', 'newsCard', 'xNewsCat',
  'bodyHTML', 'renderVals', 'h2hViewFor', 'h2hPairFor', 'h2hPriceTitle', 'h2hLedgerJoin', 'h2hOpenMeeting', 'h2hRetryPair', 'xReadHandover',
  'xResolvePick', 'xKeepPairInUrl', 'applyPendingPair', 'ensureInit', 'triggerLoads', 'tourneyVals', 'stylesVals', 'dnaVals', 'newsVals',
  'modelVals', 'cLevel', 'cTourInfo', 'cChartModel', 'cStoresFor', 'h2hIoc', 'monoOf', 'suggestionPairs', 'h2hRoundOf'];
const CONSTS = ['H2H_FTF_LEAD_EMPHASIS', 'H2H_HOT_MIN_MEETINGS', 'H2H_HOT_MIN_LINE', 'H2H_HOT_MIN_RATE', 'H2H_STYLE_FLOOR', 'H2H_STYLE_SHOWN',
  'X_SEC', 'X_CAP', 'H2H_BAND_NAMES', 'H2H_CHART_SMOOTH'];

function balanced(src, start) {
  let depth = 0, i = src.indexOf('{', start);
  const open = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (i <= open) throw new Error('braces did not balance at ' + start);
  return i + 1;
}

function load(opts) {
  const o = opts || {};
  const html = o.html != null ? o.html : fs.readFileSync(process.env.TEN402_HTML || path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
  const at = html.indexOf(MARK);
  if (at < 0) throw new Error('H2H module marker not found');
  const modStart = html.indexOf('(function () {', at);
  const expAt = html.indexOf('  window.H2HPage = {', modStart);
  const modEnd = html.indexOf('\n})();', expAt);
  if (modStart < 0 || expAt < 0 || modEnd < 0) throw new Error('H2H module bounds not found');
  const inject = '  window.__h2hX = { ' + EXPORTS.map(n => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`).join(', ')
    + ', consts: { ' + CONSTS.map(n => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`).join(', ') + ' }'
    + ', handlers: () => handlers, __eval: s => eval(s) };\n';
  const modSrc = html.slice(modStart, expAt) + inject + html.slice(expAt, modEnd) + '\n})();';
  const outside = html.slice(0, modStart) + '\n' + html.slice(modEnd);

  // ---- the vm context: a window-ish global with I/O stubbed ----
  const sb = {};
  const ctx = vm.createContext(sb);
  vm.runInContext(`var window = globalThis, self = globalThis;
    var location = { search: '', href: 'https://x.test/index.html', hash: '' };
    var history = { state: null, replaceState(s, t, u) { location.href = u; const q = u.indexOf('?'); location.search = q >= 0 ? u.slice(q).replace(/#.*$/, '') : ''; } };
    var __ss = {}; var sessionStorage = { getItem: k => (k in __ss ? __ss[k] : null), setItem: (k, v) => { __ss[k] = String(v); }, removeItem: k => { delete __ss[k]; } };
    var document = { readyState: 'complete', addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {}, toggle() {} }, appendChild() {}, setAttribute() {} }), body: { appendChild() {} } };
    var fetch = () => Promise.reject(new Error('no network in tests'));`, ctx);
  for (const k of ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'console', 'URL', 'URLSearchParams', 'Promise']) sb[k] = globalThis[k];
  // the page's own script files the module reads as globals (loaded beside the dashboard in the real page)
  sb.TournamentIdentity = require(path.join(ROOT, 'tournament-identity.js'));
  sb.MarketEdgeCore = require(path.join(ROOT, 'market-edge-core.js'));
  sb.H2HCore = require(path.join(ROOT, 'h2h-core.js'));
  // a suite's own globals (stubs and fixtures) go in before the module runs
  Object.assign(sb, o.globals || {});
  vm.runInContext(modSrc, ctx, { filename: 'h2h-module.js' });
  const X = sb.__h2hX;

  // lazily slice a top-level page declaration the module calls
  const tried = {};
  function need(name) {
    tried[name] = (tried[name] || 0) + 1;
    if (tried[name] > 4) throw new Error('could not resolve ' + name);
    let m = new RegExp(`\\n(?:async )?function ${name}\\(`).exec(outside);
    if (m) { const s = m.index + 1; vm.runInContext(outside.slice(s, balanced(outside, s)), ctx, { filename: name + '.js' }); return; }
    m = new RegExp(`\\n(const|let|var) ${name}\\b`).exec(outside);
    if (m) {
      const s = m.index + 1; let depth = 0, i = s;
      for (; i < outside.length; i++) {
        const c = outside[i];
        if (c === '{' || c === '[' || c === '(') depth++;
        else if (c === '}' || c === ']' || c === ')') depth--;
        else if (c === ';' && depth === 0) break;
      }
      vm.runInContext(outside.slice(s, i + 1).replace(/^(const|let) /, 'var '), ctx, { filename: name + '.js' });
      return;
    }
    // an indented helper (inside another page module, e.g. DatabaseTab's dbPriceJoinRows): self-contained functions only
    m = new RegExp(`\\n[ \\t]+function ${name}\\(`).exec(outside);
    if (m) { const s = outside.indexOf('function', m.index); vm.runInContext(outside.slice(s, balanced(outside, s)), ctx, { filename: name + '.js' }); return; }
    throw new Error(`${name} is not a top-level declaration of the page`);
  }
  // call `f(...)`, slicing any page helper it reaches; returns its result
  function call(f, ...args) {
    for (let k = 0; k < 300; k++) {
      try { return f(...args); } catch (e) {
        const mm = e && e.name === 'ReferenceError' && /^(\w+) is not defined/.exec(e.message);
        if (!mm) throw e;
        need(mm[1]);
      }
    }
    throw new Error('too many unresolved names');
  }
  // preload page helpers whose absence a typeof guard would hide (so the rule under test is the shipped one)
  // (tables a lazily built index reads go first: a ReferenceError half-way through building one would leave it partial)
  const DEFAULT_PRELOAD = ['TOURNAMENT_CATALOG', 'SF_EVENT_ALIAS', 'SF_EVENT_NAMES', 'SF_EVENT_LITERAL', 'ppCleanTournamentName', 'fhTournClean', 'sfEventName', 'sfEventKey', 'fhSurname', 'fhPxMark', 'fhB365Approx', 'maSameOpp', 'newsClassify'];
  for (const n of DEFAULT_PRELOAD.concat(o.preload || [])) { if (!(n in sb)) call(() => need(n)); }
  return Object.assign({}, X, { X, ctx, sb, call, need, html, run: s => vm.runInContext(s, ctx) });
}

// One rendered page as text (inline styles included); a regex helper for reading an element's style by a marker.
function styleOf(htmlText, marker) {
  const i = htmlText.indexOf(marker);
  if (i < 0) return null;
  const tagStart = htmlText.lastIndexOf('<', i);
  const tagEnd = htmlText.indexOf('>', i);
  const tag = htmlText.slice(tagStart, tagEnd + 1);
  const m = /style="([^"]*)"/.exec(tag);
  return m ? m[1] : '';
}

module.exports = { load, styleOf, ROOT };
