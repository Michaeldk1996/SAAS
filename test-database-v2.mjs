// Database v2 (handoff design_handoff_database_v2, founder 2026-11-16 "follow the design"). Each rule below is a test
// against the shipped page source, and each has a mutant that must turn it red (CONTROL at the foot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./bsp-consult-dashboard.html', import.meta.url), 'utf8');
const TOKENS = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

// one-line or brace-matched function source, as the other Database suites slice it
function fnSource(src, name) {
  const i = src.indexOf('  function ' + name + '(');
  if (i < 0) throw new Error('function ' + name + ' is gone');
  const open = src.indexOf('{', i); let d = 0;
  for (let k = open; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } }
  throw new Error('unbalanced ' + name);
}
// a `var NAME = …;` literal, the way build-lines-field.js slices LN_LADDERS (brace-matched object / array, else to ';')
function varSource(src, name) {
  const i = src.indexOf('  var ' + name);
  if (i < 0) throw new Error('var ' + name + ' is gone');
  const eq = src.indexOf('=', i); let k = eq + 1; while (src[k] === ' ') k++;
  const oc = src[k] === '{' ? ['{', '}'] : src[k] === '[' ? ['[', ']'] : null;
  if (!oc) return src.slice(i, src.indexOf(';', i) + 1);
  let d = 0;
  for (let j = k; j < src.length; j++) { if (src[j] === oc[0]) d++; else if (src[j] === oc[1]) { d--; if (!d) return src.slice(i, j + 1) + ';'; } }
  throw new Error('unbalanced ' + name);
}

const CHECKS = {
  // Fixed price bands, half-open (the profile's MK_BANDS edges): every price lands in exactly one band per side.
  bands(src) {
    const code = varSource(src, 'DB2_BANDS') + '\n' + fnSource(src, 'db2InBand') + '\nreturn {DB2_BANDS, db2InBand};';
    const { DB2_BANDS, db2InBand } = new Function(code)();
    const want = { fav: ['Heavy favourite', 'Clear favourite', 'Favourite', 'Slight favourite', 'Near coin-flip'],
      dog: ['Near coin-flip', 'Slight underdog', 'Underdog', 'Big underdog', 'Long underdog', 'Longshot'] };
    for (const sd of ['fav', 'dog']) {
      const names = DB2_BANDS[sd].map(b => b[0]);
      if (names.join('|') !== want[sd].join('|')) return sd + ' bands are ' + names.join(', ');
    }
    for (const p of [1.01, 1.2, 1.205, 1.21, 1.357, 1.5, 1.509, 1.7, 1.71, 1.999]) {
      const n = DB2_BANDS.fav.filter(b => db2InBand(b, p)).length;
      if (n !== 1) return `favourite price ${p} lands in ${n} bands`;
    }
    for (const p of [1.71, 1.99, 2, 2.49, 2.5, 2.999, 3, 3.99, 4, 5.99, 6, 26]) {
      const n = DB2_BANDS.dog.filter(b => db2InBand(b, p)).length;
      if (n !== 1) return `underdog price ${p} lands in ${n} bands`;
    }
    if (!db2InBand(DB2_BANDS.fav[1], 1.357) && !db2InBand(DB2_BANDS.fav[2], 1.357)) return '1.357 is in no band';
    if (!db2InBand(DB2_BANDS.fav[1], 1.21)) return '1.21 is not a Clear favourite';
    return null;
  },
  // The cumulative charts run on real match dates; season ticks sit on 1 January.
  dates(src) {
    const { db2Ms, db2SeasonTicks } = new Function(fnSource(src, 'db2Ms') + '\n' + fnSource(src, 'db2SeasonTicks') + '\nreturn {db2Ms, db2SeasonTicks};')();
    if (db2Ms(20240101) !== Date.UTC(2024, 0, 1)) return 'db2Ms does not read yyyymmdd as UTC';
    const t0 = Date.UTC(2010, 0, 1), t1 = Date.UTC(2026, 10, 14);
    const ticks = db2SeasonTicks(2010, 2026, 4, t0, t1);
    if (ticks.map(t => t.label).join(',') !== '2010,2014,2018,2022,2026') return 'ticks ' + ticks.map(t => t.label);
    const x22 = ticks.find(t => t.label === '2022').x, want = (Date.UTC(2022, 0, 1) - t0) / (t1 - t0);
    if (Math.abs(x22 - want) > 1e-12) return '2022 tick is not at 1 Jan 2022';
    if (!/xs\.push\(db2DateX\(r\[0\]\)\)/.test(fnSource(src, 'renderCurveCard'))) return 'the Tour chart x is not the match date';
    return null;
  },
  // LN_LADDERS stays a literal (build-lines-field.js slices it) and carries the design's ladders.
  ladders(src) {
    const L = new Function(varSource(src, 'LN_LADDERS') + '\n' + varSource(src, 'LN_GROUPS') + '\nreturn {LN_LADDERS, LN_GROUPS};')();
    if (L.LN_GROUPS.join('|') !== 'Games handicap|Set handicap|Total games') return 'families ' + L.LN_GROUPS;
    const n = f => Object.fromEntries(Object.entries(L.LN_LADDERS[f]).map(([k, v]) => [k, v.length]));
    if (JSON.stringify(n('bo3')) !== JSON.stringify({ 'Games handicap': 20, 'Set handicap': 2, 'Total games': 20 })) return 'bo3 ladder ' + JSON.stringify(n('bo3'));
    if (JSON.stringify(n('bo5')) !== JSON.stringify({ 'Games handicap': 12, 'Set handicap': 2, 'Total games': 6 })) return 'bo5 ladder ' + JSON.stringify(n('bo5'));
    const lab = L.LN_LADDERS.bo3['Games handicap'].map(x => x[0]);
    if (lab[0] !== '−1 games' || lab[10] !== '+1 games') return 'bo3 game handicap labels ' + lab.slice(0, 2);
    return null;
  },
  // Cover is worked out from the score; a push (margin exactly 0 on a whole line) is not covered.
  push(src) {
    const lnHit = new Function(fnSource(src, 'lnHit') + '\nreturn lnHit;')();
    const r = { sets: [{ p: 6, o: 4 }, { p: 4, o: 6 }, { p: 6, o: 3 }] };   // won by 3 games
    if (lnHit(r, 'gm', -3).hit !== false) return 'a push on -3 counts as covered';
    if (lnHit(r, 'gm', -2.5).hit !== true) return '-2.5 is not covered by a 3-game win';
    if (lnHit(r, 'ov', 29).hit !== false) return 'a push on over 29 counts as covered';
    return null;
  },
  // Field = the field file's median at the format · surface · period slice only; any other filter is a dash.
  field(src) {
    const f = new Function('state', fnSource(src, 'db2LnFieldOK') + '\nreturn db2LnFieldOK;');
    const ok = s => f(Object.assign({ lnSide: 'all', lnBand: null, lnArch: null, lnLevel: null }, s))();
    if (!ok({})) return 'no field on the base slice';
    for (const s of [{ lnSide: 'fav' }, { lnBand: 'fav|0' }, { lnArch: 'Big Server' }, { lnLevel: 'ATP 500' }]) if (ok(s)) return 'a field under ' + JSON.stringify(s);
    if (!/var fm = fs \? fs\.median : null;/.test(fnSource(src, 'db2LnMetric'))) return 'Field is not the field file median';
    return null;
  },
  // Ratings: one period, Last 52 weeks first and the default; no Mental Edge board.
  ratings(src) {
    if (!/ratSurf:'All', ratScope:'last52', ratBoard:'overview'/.test(src)) return 'Ratings does not open on Last 52 weeks';
    const B = new Function(varSource(src, 'DB2_RBOARDS') + '\nreturn DB2_RBOARDS;')();
    if (B.map(b => b[1]).join('|') !== 'Overview|Elo|Serve|Return|Under pressure') return 'boards ' + B.map(b => b[1]);
    if (!/pillGroup\(\[\['last52','Last 52 weeks'\],\['career','Career'\]\]/.test(src)) return 'the period control is not Last 52 weeks · Career';
    return null;
  },
  // The compare page's "All matches" counts each match once: (favourite + underdog) / 2.
  compareOnce(src) {
    const tcProfit = new Function(fnSource(src, 'tcProfit') + '\nreturn tcProfit;')();
    const r = [0, 0, 0, 0, 0, 1.5, 3, 1];   // favourite at 1.50 won
    if (Math.abs(tcProfit(r, 'all') - (0.5 + -1) / 2) > 1e-12) return 'All matches is not (fav + dog) / 2';
    return null;
  },
  // The view switch: Tour · Tournament · Player · Lines · Ratings.
  tabs(src) {
    const m = [...src.matchAll(/<button(?: class="active")? data-dbview="(\w+)">([^<]+)<\/button>/g)].slice(0, 5).map(x => x[2]);
    if (m.join('|') !== 'Tour|Tournament|Player|Lines|Ratings') return 'tabs ' + m.join(', ');
    return null;
  },
  // The design's own colours, read through tokens.css (identical colours).
  tokens(src) {
    const want = { card: '#0E1019', inset: '#0C0E16', raised: '#131623', ink: '#E7E9EE', 'ink-2': '#C6CCDB', muted: '#8B96B5', blue: '#5B9BFF', green: '#3DD68C', red: '#E0616F' };
    for (const [k, v] of Object.entries(want)) if (!new RegExp('--db2-' + k + ':\\s*' + v + ';').test(TOKENS)) return '--db2-' + k + ' is not ' + v;
    if (!/\[data-db-root\]\{ --card:var\(--db2-card\);/.test(src)) return 'the Database does not read the --db2 palette';
    return null;
  },
};

const MUTANTS = [
  ['band edges inclusive', 'bands', s => s.replace("function db2InBand(B, p){ return p>=B[3]-1e-9 && p<B[4]-1e-9; }", "function db2InBand(B, p){ return p>=B[3]-1e-9 && p<=B[4]+1e-9; }")],
  ['terciles back', 'bands', s => s.replace("['Clear favourite','1.21','1.35',1.21,1.36]", "['Firm favourite','1.21','1.35',1.21,1.36]")],
  ['match index back', 'dates', s => s.replace("favV.push(cf); dogV.push(cd); xs.push(db2DateX(r[0]));", "favV.push(cf); dogV.push(cd); xs.push(i/(nPts-1));")],
  ['ticks off 1 January', 'dates', s => s.replace("var x=(Date.UTC(y,0,1)-t0)/(t1-t0);", "var x=(Date.UTC(y,6,1)-t0)/(t1-t0);")],
  ['ladder computed', 'ladders', s => s.replace("  var LN_LADDERS = {", "  var LN_LADDERS = (function(){ return {").replace("  var LN_GROUPS = ['Games", "  var LN_GROUPS_X = 1; var LN_GROUPS = ['Games")],
  ['match shape back', 'ladders', s => s.replace("var LN_GROUPS = ['Games handicap','Set handicap','Total games'];", "var LN_GROUPS = ['Games handicap','Set handicap','Total games','Match shape'];")],
  ['push covered', 'push', s => s.replace("if(kind==='gm'){ var gm=(pg-og)+arg; return { hit: gm>0, margin: gm }; }", "if(kind==='gm'){ var gm=(pg-og)+arg; return { hit: gm>=0, margin: gm }; }")],
  ['field under a filter', 'field', s => s.replace("function db2LnFieldOK(){ return state.lnSide==='all' && state.lnBand==null && !state.lnArch && !state.lnLevel; }", "function db2LnFieldOK(){ return true; }")],
  ['ratings open on Career', 'ratings', s => s.replace("ratSurf:'All', ratScope:'last52', ratBoard:'overview'", "ratSurf:'All', ratScope:'career', ratBoard:'overview'")],
  ['mental edge back', 'ratings', s => s.replace("['up','Under pressure']];", "['up','Under pressure'],['mental','Mental Edge']];")],
  ['all matches counted twice', 'compareOnce', s => s.replace("return side==='fav' ? f : side==='dog' ? d : (f+d)/2;", "return side==='fav' ? f : side==='dog' ? d : f+d;")],
  ['tab order', 'tabs', s => s.replace('          <button data-dbview="lines">Lines</button>\n          <button data-dbview="ratings">Ratings</button>', '          <button data-dbview="ratings">Ratings</button>\n          <button data-dbview="lines">Lines</button>')],
  ['palette not mapped', 'tokens', s => s.replace("[data-db-root]{ --card:var(--db2-card);", "[data-db-root]{ --cardx:var(--db2-card);")],
];

for (const [name, fn] of Object.entries(CHECKS)) test('Database v2 · ' + name, () => { const e = fn(SRC); assert.equal(e, null, e); });
test('CONTROL: every Database v2 mutant is caught', () => {
  const survived = [];
  for (const [name, which, mut] of MUTANTS) {
    const m = mut(SRC);
    if (m === SRC) { survived.push(name + ' (did not apply)'); continue; }
    let r; try { r = CHECKS[which](m); } catch (e) { r = 'threw: ' + e.message; }
    if (r === null) survived.push(name);
  }
  assert.deepEqual(survived, []);
  console.log(`  mutants: ${MUTANTS.length} caught, 0 survived`);
});
