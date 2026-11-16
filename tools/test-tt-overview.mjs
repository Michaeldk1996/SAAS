#!/usr/bin/env node
// Tournaments tab rebuild — Overview (tournaments-overview.js, window.TTOverview), founder 2026-11-15 "Design wins".
// Executes the SHIPPED module on a real-data fixture (tools/fixtures/tt-overview/: the deployed tournament-market.json,
// database-yield.json, event-hold.json, how-it-plays.json and a quotes subset, fetched 2026-11-15) beside the
// dashboard's own catalog, court-conditions sheet and quote rules (sliced from bsp-consult-dashboard.html), and checks:
//   1. the year window recomputes from database-yield.json rows through settlement.js — every all-years event equals
//      tournament-market.json (so the window is the builder's population, never an offset);
//   2. a window recomputes the event, the tour baseline and the rank over the SAME years;
//   3. TT_SPEED_SOURCE 'ta' (default, founder 2026-11-16) = Tennis Abstract, credited on hover; 'own' = every figure a dash;
//   4. Service hold = event-hold.json held / games; 1st serve = how-it-plays.json num / den; n in the hover title;
//   5. ROI coloured by its gap to the tour (design wins); reliability rank of N; dashes, never 0;
//   6. structure: rail groups, quotes card (traceable count / dash), overlays, page-scoped CSS.
// Every check is re-run against mutants of the module source; each mutant must turn a check red.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FX = path.join(ROOT, 'tools/fixtures/tt-overview');
const require = createRequire(import.meta.url);
const DASH_SRC = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MOD_SRC = fs.readFileSync(path.join(ROOT, 'tournaments-overview.js'), 'utf8');
const J = f => JSON.parse(fs.readFileSync(path.join(FX, f), 'utf8'));
const MKT = J('tournament-market.json'), HOLD = J('event-hold.json'), HIP = J('how-it-plays.json'), QUOTES = J('tournament-quotes.json').tournaments;
const DB = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FX, 'database-yield.json.gz'))));
const Settlement = require(path.join(ROOT, 'settlement.js'));

function fnSource(name){
  const i = DASH_SRC.indexOf('\nfunction ' + name + '(');
  if (i < 0) throw new Error('not in the dashboard: ' + name);
  const lineEnd = DASH_SRC.indexOf('\n', i + 1), line = DASH_SRC.slice(i + 1, lineEnd);
  if (/\}\s*(\/\/.*)?$/.test(line) && (line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  const j = DASH_SRC.indexOf('\n}\n', i);
  return DASH_SRC.slice(i + 1, j + 2);
}
function constSource(name){
  const re = new RegExp('\\n(const|let) ' + name + '\\b');
  const m = re.exec(DASH_SRC); if (!m) throw new Error('not in the dashboard: ' + name);
  const i = m.index + 1, first = DASH_SRC.slice(i, DASH_SRC.indexOf('\n', i));
  if (/;\s*(\/\/.*)?$/.test(first)) return first;
  const ends = ['\n];', '\n};'].map(e => DASH_SRC.indexOf(e, i)).filter(x => x > 0);
  return DASH_SRC.slice(i, Math.min(...ends) + 3);
}
const SLICE = [constSource('TOURNAMENT_CATALOG'), constSource('COURT_CONDITIONS'), fnSource('courtSpeedCategory'),
  fnSource('tourxConditionRegistry'), fnSource('tourxOverviewEvents'), constSource('TOURX_QUOTE_RULE'), constSource('TOURX_QUOTE_EXCLUDE'),
  constSource('tourxQuoteEventNamesMemo'), fnSource('tourxQuoteEventNames'), fnSource('tourxQuoteOtherEvent'), fnSource('tourxQuoteTraceable'),
  fnSource('tourxQuotesFor'), fnSource('tourxQuoteSurname'), constSource('tourxQuoteCleanCache'), fnSource('tourxQuoteClean')].join('\n');

// One sandbox per run: the dashboard slice + the module (optionally mutated / with the 'ta' switch).
function boot(modSrc, opts = {}){
  const win = { Settlement, TT_SPEED_SOURCE: opts.speed };
  const ctx = vm.createContext({ window: win, console, Map, Set, WeakMap, Math, JSON, Number, String, Object, Array, Date, RegExp, Intl });
  vm.runInContext(SLICE + `
    const tourxState = { section: 'overview', tsSel: 'Wimbledon', tsQ: '', speedPanel: false, quotesPanel: false, roiPanel: null };
    let tourxMarketData = null, tourxMarketFailed = false, _trHoldData = undefined;
    const tourxQuotes = ${JSON.stringify(QUOTES)};
    function tourxActiveWeekNames(){ return new Set(['Turin']); }
    this.__set = (k, v) => { if (k === 'mkt') tourxMarketData = v; if (k === 'hold') _trHoldData = v; };
    this.__ts = tourxState; this.__cc = COURT_CONDITIONS;
  `, ctx);
  vm.runInContext(modSrc, ctx);
  ctx.__set('mkt', MKT); ctx.__set('hold', HOLD);
  const T = win.TTOverview, I = T._internals;
  I.state.hip = HIP; I.state.db = DB;
  return { T, I, ts: ctx.__ts, cc: ctx.__cc };
}
const text = h => h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const between = (h, cls) => { const i = h.indexOf(cls); return i < 0 ? '' : h.slice(i, h.indexOf('</span>', i)); };

// ---------------------------------------------------------------- the checks (each returns null or a failure message)
const CHECKS = {
  'window recompute = builder: every all-years event equals tournament-market.json'(B){
    const m = B.I.marketModel(DB, MKT, Settlement, null, null);
    const bad = [];
    for (const [k, t] of Object.entries(MKT.tournaments)) {
      const a = m.tours[k];
      if (!a || ['n', 'roiFav', 'roiDog', 'favRel', 'nRel'].some(f => a[f] !== t[f])) bad.push(k);
    }
    const b = m.baseline, B0 = MKT.baseline;
    if (['n', 'roiFav', 'roiDog', 'favRel', 'nRel'].some(f => b[f] !== B0[f])) bad.push('baseline');
    return bad.length ? 'differs from the builder: ' + bad.slice(0, 6).join(', ') + ` (${bad.length})` : null;
  },
  'a window recomputes event, tour baseline and rank over the same years'(B){
    const m = B.I.marketModel(DB, MKT, Settlement, 2023, 2025);
    const yrs = r => Math.floor(r[0] / 10000);
    const exp = DB.rows.filter(r => yrs(r) >= 2023 && yrs(r) <= 2025).length;
    const retStand = (DB.retRows || []).filter((r, i) => yrs(r) >= 2023 && yrs(r) <= 2025 && Settlement.betCounts({ comment: DB.retComment[i], fs: DB.retFs[i] })).length;
    if (m.baseline.n !== exp + retStand) return `baseline n ${m.baseline.n} != rows in 2023–2025 ${exp + retStand}`;
    const w = m.tours.Wimbledon;
    if (!w || w.n >= MKT.tournaments.Wimbledon.n || w.n < 30) return 'Wimbledon 2023–2025 is not its own population: ' + JSON.stringify(w);
    const r = B.I.relRank(m, 'Wimbledon');
    const exR = 1 + Object.values(m.tours).filter(a => a.n >= 30 && a.favRel > w.favRel).length;
    if (!r || r.rank !== exR || r.of !== Object.values(m.tours).filter(a => a.n >= 30).length) return 'rank not over the window: ' + JSON.stringify(r);
    return null;
  },
  'the rendered window tiles read the window model (never the all-years figure)'(B){
    B.T.setYear('from', 2024); B.T.setYear('to', 2024);
    const h = B.I.marketHtml(B.I.events().find(t => t.name === 'Wimbledon'));
    const m = B.I.marketModel(DB, MKT, Settlement, 2024, 2024), w = m.tours.Wimbledon;
    B.T.resetYears();
    if (!/2024 edition/.test(h)) return 'label is not "2024 edition"';
    if (!w || w.n < 30) return h.includes('—') ? null : 'a thin window must dash';
    const fav = (w.roiFav > 0 ? '+' : w.roiFav < 0 ? '−' : '') + Math.abs(w.roiFav).toFixed(1) + '%';
    return h.includes(fav) ? null : `fav yield ${fav} not printed for the 2024 window`;
  },
  'a window still loading prints blank tiles, never the no-data dash'(B){
    const keep = B.I.state.db; B.I.state.db = undefined; B.I.state.dbP = Promise.resolve();   // rows in flight
    B.T.setYear('from', 2023); B.T.setYear('to', 2025);
    const h = B.I.marketHtml(B.I.events().find(t => t.name === 'Wimbledon'));
    B.T.resetYears(); B.I.state.db = keep; B.I.state.dbP = null;
    const tiles = h.slice(h.indexOf('tt-ov-tiles'));
    if (!/data-tt-pending/.test(tiles)) return 'no pending marker on the loading tiles';
    return text(tiles).includes('—') ? 'a loading tile prints the em dash' : null;
  },
  "court speed 'own': every speed figure is a dash"(){
    const B = boot(MOD_SRC, { speed: 'own' });
    const c = B.I.events().find(t => t.name === 'Wimbledon');
    const card = B.I.speedCardHtml(c), rail = B.I.railHtml(), box = B.I.speedBoxHtml(), yr = B.I.speedYearsHtml(c);
    if (!between(card, 'tt-ov-fig48').endsWith('—')) return 'the 48px figure is not a dash';
    if (/\b[01]\.\d\d\b/.test(text(rail))) return 'a speed figure in the rail';
    if (/\b[01]\.\d\d\b/.test(text(box))) return 'a speed figure in the speed box';
    if (/\b[01]\.\d\d\b/.test(text(yr)) || /<polyline/.test(yr)) return 'a speed figure / line in the speed-by-year chart';
    if (/Tennis Abstract/.test(B.I.conditionsText(c))) return 'Conditions read cites Tennis Abstract under own';
    return null;
  },
  "court speed defaults to the Tennis Abstract figure, credited on hover"(B2){
    const c = B2.I.events().find(t => t.name === 'Wimbledon'), as = B2.cc.Wimbledon.abstractSpeed;
    const card = B2.I.speedCardHtml(c);
    if (!card.includes('>' + as.toFixed(2) + '<')) return 'figure is not COURT_CONDITIONS.abstractSpeed';
    if (!/title="Tennis Abstract/.test(card)) return 'no Tennis Abstract credit on hover';
    if (!new RegExp('>' + B2.I.speedLabel(as) + '<').test(card)) return 'band word is not the 4-band label';
    return null;
  },
  'service hold = event-hold.json held / games, n on hover'(B){
    const c = B.I.events().find(t => t.name === 'Wimbledon');
    const h = B.I.holdOf(c), e = Object.values(HOLD.events).find(x => (x.names || [x.name]).includes('Wimbledon'));
    if (!h || !e || Math.round(h.pct) !== Math.round(100 * e.held / e.games)) return 'hold is not held / games';
    const card = B.I.speedCardHtml(c);
    if (!card.includes(`>${Math.round(100 * e.held / e.games)}<`)) return 'hold not printed';
    if (!card.includes(`n = ${e.games.toLocaleString('en-US')}`)) return 'hold n missing from the hover';
    return null;
  },
  '1st serve won = how-it-plays.json num / den on hard; a dash on grass'(B){
    const hard = Object.values(HIP.events).find(e => e.past && e.past.metrics && e.past.metrics.firstServeWon && B.I.events().some(t => t.name === e.name));
    if (!hard) return 'no hard fixture event';
    const c = B.I.events().find(t => t.name === hard.name), f = B.I.firstServeOf(c), m = hard.past.metrics.firstServeWon;
    if (!f || Math.round(f.pct) !== Math.round(100 * m.num / m.den)) return '1st serve is not num / den for ' + hard.name;
    if (B.I.firstServeOf(B.I.events().find(t => t.name === 'Wimbledon'))) return 'grass Wimbledon has a 1st-serve figure';
    return null;
  },
  'ROI coloured by its gap to the tour; reliability rank of N'(B){
    const c = B.I.events().find(t => t.name === 'Wimbledon'), h = B.I.marketHtml(c);
    const w = MKT.tournaments.Wimbledon, b = MKT.baseline, d = w.roiFav - b.roiFav;
    const fav = h.slice(h.indexOf('data-tt-tile="fav"'), h.indexOf('data-tt-tile="dog"'));
    const want = Math.abs(d) < 1 ? 'var(--text)' : d > 0 ? 'var(--pos)' : 'var(--neg)';
    if (!fav.includes('color:' + want)) return 'fav yield colour is not its gap to the tour (' + want + ')';
    const of = Object.values(MKT.tournaments).filter(a => a.n >= 30).length, rank = 1 + Object.values(MKT.tournaments).filter(a => a.n >= 30 && a.favRel > w.favRel).length;
    const ordn = n => n + (['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
    if (!text(h).includes(`${ordn(rank)} of ${of} tournaments`)) return `rank line is not "${ordn(rank)} of ${of} tournaments"`;
    if (!h.includes('n = ' + w.n.toLocaleString('en-US'))) return 'yield n missing from the hover';
    return null;
  },
  'no market = dashes, never 0'(B){
    B.T._internals.state.yF = 2020;
    const c = { name: 'Nowhere', category: 'ATP 250', surface: 'hard' };
    const h = B.I.marketHtml(c), t = text(h);
    if (/\b0\.0%|\b0%/.test(t)) return 'a 0 where there is no data';
    return (t.match(/—/g) || []).length >= 3 ? null : 'tiles do not dash';
  },
  'rail: This week / Season heads always; search filters both'(B){
    B.ts.tsQ = 'zzz'; const e = B.I.railHtml(); B.ts.tsQ = 'ma'; const f = B.I.railHtml(); B.ts.tsQ = '';
    const all = B.I.railHtml(), rows = (all.match(/class="tt-ov-row /g) || []).length;
    if (rows !== B.I.events().length) return `rail rows ${rows} != events ${B.I.events().length}`;
    if (!(/This week/.test(e) && /Season/.test(e)) || /tt-ov-row /.test(e)) return 'empty search must keep both heads and no rows';
    if (!(/Madrid/.test(f) && !/Wimbledon/.test(f))) return 'search does not filter';
    const names = B.I.events().map(t => t.name), cat = vm.runInNewContext(constSource('TOURNAMENT_CATALOG') + ';TOURNAMENT_CATALOG').map(t => t.name);
    const ix = names.map(n => cat.indexOf(n)).filter(x => x >= 0);
    return ix.every((x, i) => i === 0 || x > ix[i - 1]) ? null : 'rail is not in catalog order';
  },
  'quotes: traceable count + lead; no quote = a dash card with no click'(B){
    const c = B.I.events().find(t => t.name === 'Wimbledon'), h = B.I.quotesCardHtml(c);
    const n = (QUOTES.Wimbledon || []).filter(q => q.player && q.year && q.playerMatch === 'entrant').length;
    const m = /Read all (\d+)/.exec(h);
    if (!m || +m[1] > n || +m[1] < 1) return 'Read all N is not the traceable count';
    const none = B.I.quotesCardHtml({ name: 'Basel' });
    if (/onclick/.test(none) || !none.includes('—')) return 'a quote-less event must show a dash card without a click';
    B.ts.quotesPanel = true; const box = B.I.quotesBoxHtml(); B.ts.quotesPanel = false;
    if (!/All years/.test(box) || !/· AS (\d\.\d\d|—)/.test(box)) return 'quotes box: year pills must carry the AS reading or a dash';
    return null;
  },
  'CSS: every selector page-scoped, the export borders kept'(B){
    const css = B.I.CSS;
    const bad = css.split('\n').filter(l => !/^@media/.test(l)).filter(l => l.split('{')[0].split(',').some(s => !s.trim().startsWith('.tabpage[data-page="tournaments"]')));
    if (bad.length) return 'unscoped: ' + bad[0].slice(0, 90);
    if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css)) return 'raw colour in the CSS';
    return /\.tt-ov-card\{[^}]*1\.25px/.test(css) ? null : 'card border is not 1.25px';
  },
};

// ---------------------------------------------------------------- mutants (each must turn at least one check red)
const MUTANTS = [
  ['settlement dropped (every retirement in the ROI)', s => s.replace("bet: Settle.betCounts({ comment: retC[i], fs: retF[i] }),", 'bet: true,')],
  ['window ignores the years', s => s.replace('return yF == null || (y >= yF && y <= yT);', 'return true;')],
  ['tour baseline kept at all years under a window', s => s.replace('return { baseline: aggRows(rows), tours };', 'return { baseline: mkt.baseline, tours };')],
  ['archiveFilter ignored (Montreal pools Toronto years)', s => s.replace("pool = pool.concat(f ? rs.filter(", 'pool = pool.concat(false ? rs.filter(')],
  ['speed switch defaults to dashes (own)', s => s.replace("(root && root.TT_SPEED_SOURCE) || 'ta'", "(root && root.TT_SPEED_SOURCE) || 'own'")],
  ['hold from the sheet (count-less)', s => s.replace('return { pct: 100 * e.held / e.games,', 'return { pct: 81,')],
  ['ROI coloured by sign', s => s.replace("const col = !ok ? '' : Math.abs(d) < 1 ? 'color:var(--text);' : d > 0 ? 'color:var(--pos);' : 'color:var(--neg);';", "const col = !ok ? '' : v > 0 ? 'color:var(--pos);' : 'color:var(--neg);';")],
  ['rank over all events (no 30-match floor)', s => s.replace('const ok = Object.values(mk.tours).filter(a => a && a.n >= MIN_MATCHES && a.favRel != null);', 'const ok = Object.values(mk.tours).filter(a => a);')],
  ['tiles show 0 when there is no data', s => s.replace("const fig = ok ? signed(v, 1) + '%' : pend ? '&nbsp;' : DASH;", "const fig = ok ? signed(v, 1) + '%' : '0.0%';")],
  ['loading tiles print the no-data dash', s => s.replace("const fig = ok ? signed(v, 1) + '%' : pend ? '&nbsp;' : DASH;", "const fig = ok ? signed(v, 1) + '%' : DASH;")],
  ['rail sorted by speed', s => s.replace('return list.slice().sort((a, b) => (ix.has(a.name)', 'return list.slice().sort((a, b) => 0 || (ix.has(a.name)').replace('function events(){', 'function events(){ return (typeof tourxOverviewEvents === "function" ? tourxOverviewEvents() : catalog()).slice().sort((a, b) => (b.abstractSpeed || 0) - (a.abstractSpeed || 0));')],
  ['empty search hides the heads', s => s.replace('<div class="tt-ov-list"><div class="tt-ov-gh">This week</div>${wk.map(row).join(\'\')}', '<div class="tt-ov-list">${wk.length ? \'<div class="tt-ov-gh">This week</div>\' : \'\'}${wk.map(row).join(\'\')}')],
  ['quote-less card clickable', s => s.replace('<div class="tt-ov-card tt-ov-qcard" data-tt-quotes="0">', '<div class="tt-ov-card tt-ov-qcard" data-tt-quotes="0" onclick="TTOverview.openQuotes()">')],
  ['unscoped CSS rule', s => s.replace("`${P}.tt-ov-cap{", "`.tt-ov-cap{")],
];

function runAll(src, label){
  const fails = [];
  for (const [name, fn] of Object.entries(CHECKS)) {
    let r; try { r = fn(boot(src)); } catch (e) { r = 'threw: ' + e.message; }
    if (r) fails.push(name + ' — ' + r);
  }
  return fails;
}
let failed = 0;
const base = runAll(MOD_SRC);
for (const name of Object.keys(CHECKS)) {
  const f = base.find(x => x.startsWith(name + ' — '));
  console.log((f ? 'FAIL ' : 'ok   ') + (f || name));
  if (f) failed++;
}
for (const [label, mut] of MUTANTS) {
  const src = mut(MOD_SRC);
  if (src === MOD_SRC) { console.log('FAIL mutant did not apply: ' + label); failed++; continue; }
  const f = runAll(src);
  console.log((f.length ? 'ok   mutant caught: ' : 'FAIL mutant survived: ') + label);
  if (!f.length) failed++;
}
console.log(`\ntest-tt-overview: ${Object.keys(CHECKS).length} checks, ${MUTANTS.length} mutants, ${failed} failed`);
process.exit(failed ? 1 : 0);
