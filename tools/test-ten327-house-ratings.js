#!/usr/bin/env node
'use strict';
// TEN-327 — one formula per stat name (founder 2026-09-28; .claude/rules/modal-analysis.md
// "One formula per stat name"). The house Serve / Return ratings live in house-ratings.js and every
// display surface computes them through it: the Match stats sheet (fhSheetModel), the Tournament
// Report (tourxDerivedMetrics), the Live tab (live-tab.js serveRating / returnRating) and the Player
// Profile match sheet (sheetValue). Each check drives the SHIPPED code — sliced out of the real
// files — on the three box scores the `formula-unification` doc measured
// (tools/fixtures/ten327-boxscores.json), and every check is proved non-vacuous by a MUTANT of the
// shipped source that must turn it red (listed at the bottom, run by this file).
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SRC = {
  hr: read('house-ratings.js'),
  dash: read('bsp-consult-dashboard.html'),
  live: read('live-tab.js'),
  pp: read('player-profile-v2.js'),
  adj: read('h2h-model/adjustments.js'),
  cfg: read('h2h-model/config.js'),
};
const FIX = JSON.parse(read('tools/fixtures/ten327-boxscores.json')).matches;

function between(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i + 1);
  if (i < 0 || j < 0) throw new Error(`anchor not found: ${i < 0 ? a : b}`);
  return src.slice(i, j);
}
function sliceFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

// ── loaders: each returns the surface's real functions, built from (possibly mutated) source ──
function loadHR(src) {
  const w = {};
  new Function('window', 'module', src)(w, undefined);
  return w.HouseRatings;
}
function loadDash(src, HR) {
  const code = `const FH_DASHC = '—';\n` +
    between(src, 'const FH_BAR_FLOOR', 'function fhSheetRowHtml(') + '\n' +
    sliceFn(src, 'tourxDerivedMetrics') + '\nreturn { fhSheetModel, tourxDerivedMetrics };';
  return new Function('HouseRatings', code)(HR);
}
function loadLive(src, HR) {
  const code = between(src, '    const num = (s) =>', '    // ── diverging bar') +
    '\nreturn { indexStats, serveRating, returnRating };';
  return new Function('window', code)({ HouseRatings: HR });
}
function loadPP(src, HR) {
  const sandbox = { FEATURE_PP2: true, playerProfiles: { players: [] }, matchStats: {}, HouseRatings: HR };
  const prev = global.window; global.window = sandbox;
  try { new Function('window', src)(sandbox); } finally { global.window = prev; }
  return sandbox.PlayerProfileV2._internals;
}

// The model's value layers, compiled from (possibly mutated) adjustments.js / config.js source with
// the repo's real sibling modules, so a mutant of either file is what the checks run against.
function loadModel(adjSrc, cfgSrc) {
  const Module = require('module');
  const dir = path.join(ROOT, 'h2h-model');
  const compile = (file, src) => {
    const m = new Module(path.join(dir, file), module);
    m.filename = path.join(dir, file); m.paths = Module._nodeModulePaths(dir);
    m._compile(src, m.filename);
    return m;
  };
  const cfgPath = require.resolve(path.join(dir, 'config.js'));
  const saved = require.cache[cfgPath];
  const cfg = compile('config.js', cfgSrc);
  require.cache[cfgPath] = cfg;
  try { return { adj: compile('adjustments.js', adjSrc).exports, config: cfg.exports }; }
  finally { if (saved) require.cache[cfgPath] = saved; else delete require.cache[cfgPath]; }
}

// ── the fixture, reshaped into each surface's own input ──
function sides(ek) {
  const f = FIX[ek], mine = String(f.p1Key) === String(f.subjectKey) ? 'p1' : 'p2';
  return { own: f.match[mine], opp: f.match[mine === 'p1' ? 'p2' : 'p1'], key: f.subjectKey };
}
// tournament-progression.json `metrics` shape (bsp-pipeline.js): the feed's rates, counts for games/BP.
function toProg(o) {
  const raw = o.raw || {};
  return {
    firstServePct: o['Service:1st serve percentage'], firstServeWonPct: o['Service:1st serve points won'],
    secondServeWonPct: o['Service:2nd serve points won'], svHold: raw['Games:Service games won'],
    aces: o['Service:Aces'], dfs: o['Service:Double Faults'],
    ret1: raw['Return:1st return points won'], ret2: raw['Return:2nd return points won'],
    retGames: raw['Games:Return games won'], bpConv: raw['Return:Break Points Converted'] || null,
  };
}
// api-tennis live `statistics[]` rows (what the Live tab indexes).
function toLive(pk, o) {
  const rows = [];
  for (const [k, v] of Object.entries(o)) {
    if (k === 'raw') continue;
    const [type, name] = k.split(':');
    const rw = (o.raw || {})[k];
    const count = /Aces|Double|Winners|Unforced/.test(name);
    rows.push({ player_key: pk, stat_period: 'match', stat_type: type, stat_name: name,
      stat_value: count ? String(v) : v + '%', stat_won: rw ? rw.won : null, stat_total: rw ? rw.total : null });
  }
  return rows;
}

// The headline numbers of the formula-unification doc (§2a), rounded once, as displayed.
const EXPECT = {
  12145144: { who: 'Sinner', serve: 323, ret: 118, trServe: 323 },
  12166089: { who: 'Alcaraz', serve: 256, ret: 156, trServe: 257 },   // TR holds the feed's whole-number 1st-in %
  12166157: { who: 'Medvedev', serve: 299, ret: 138, trServe: 299 },
};

function suite(src) {
  const HR = loadHR(src.hr), D = loadDash(src.dash, HR), L = loadLive(src.live, HR), P = loadPP(src.pp, HR);
  const MOD = loadModel(src.adj, src.cfg);
  const R = (v) => (v == null ? null : Math.round(v));
  const out = [];
  const check = (name, fn) => out.push([name, fn]);

  check('helper: serve is the 6-part sum, double faults subtracted, unrounded', () => {
    const s = HR.serve({ firstIn: 60.4, firstWon: 75.4, secondWon: 50.4, svGames: 80.4, aces: 10, dfs: 3 });
    assert.ok(Math.abs(s.v - 273.6) < 1e-9, `serve ${s.v}`);
  });
  check('helper: return is the 4-part sum, unrounded', () => {
    const r = HR.ret({ ret1: 30.4, ret2: 50.4, retGames: 20.4, bpConv: 40.4 });
    assert.ok(Math.abs(r.v - 141.6) < 1e-9, `return ${r.v}`);
  });
  check('helper: a missing component is no rating (never 0), and names what is missing', () => {
    const s = HR.serve({ firstIn: 60, firstWon: 75, secondWon: 50, svGames: 80, aces: null, dfs: 3 });
    assert.strictEqual(s.v, null); assert.deepStrictEqual(s.missing, ['aces']);
    const r = HR.ret({ ret1: 30, ret2: 50, retGames: 20, bpConv: HR.pct({ won: 0, total: 0 }) });
    assert.strictEqual(r.v, null, '0 break-point chances must dash, not count as 0%');
    assert.strictEqual(HR.pct({ won: 0, total: 5 }), 0, 'a real 0 of 5 is 0%');
  });

  for (const ek of Object.keys(EXPECT)) {
    const e = EXPECT[ek], { own, opp, key } = sides(ek);
    check(`${e.who}: Match stats sheet reads ${e.serve} / ${e.ret}`, () => {
      const M = D.fhSheetModel({ own, opp });
      assert.strictEqual(R(M.sections[0].rows[0].a.v), e.serve);
      assert.strictEqual(R(M.sections[1].rows[0].a.v), e.ret);
    });
    check(`${e.who}: Tournament Report serve ${e.trServe} (6-part, unrounded) / return ${e.ret}`, () => {
      const t = D.tourxDerivedMetrics(toProg(own), toProg(opp));
      assert.strictEqual(R(t.serveRating), e.trServe);
      assert.strictEqual(R(t.returnRating), e.ret);
    });
    check(`${e.who}: Live tab reads ${e.serve} / ${e.ret} (aces/DF as counts, 4-part return)`, () => {
      const idx = L.indexStats({ statistics: toLive(key, own).concat(toLive(999999, opp)) }).idx;
      assert.strictEqual(R(L.serveRating(idx, key, 'match').rating), e.serve);
      assert.strictEqual(R(L.returnRating(idx, key, 'match').rating), e.ret);
    });
    check(`${e.who}: Player Profile sheet reads ${e.serve} / ${e.ret} (was always a dash)`, () => {
      const rows = P.SHEET_SECTIONS.flatMap((s) => s.rows);
      const sv = rows.find((r) => r.label === 'Serve rating'), rt = rows.find((r) => r.label === 'Return rating');
      assert.strictEqual(R(P.sheetValue(sv, own, opp)), e.serve);
      assert.strictEqual(R(P.sheetValue(rt, own, opp)), e.ret);
    });
  }

  check('Live tab: no warm-up floor — 4 service points still rate; a missing count is a dash, not 0', () => {
    const rows = (over) => [
      ['1st serve points won', 3, 3], ['2nd serve points won', 0, 1], ['Service games won', 1, 1],
      ['1st return points won', 1, 4], ['2nd return points won', 0, 0], ['Return games won', 0, 1],
      ['Break Points Converted', null, null], ['Aces', null, null, '1'], ['Double Faults', null, null, '0'],
    ].filter(([n]) => !(over || []).includes(n)).map(([n, w, t, v]) => ({ player_key: 7, stat_period: 'match',
      stat_name: n, stat_value: v != null ? v : (t ? Math.round(w / t * 100) + '%' : '0%'), stat_won: w, stat_total: t }));
    const idx = L.indexStats({ statistics: rows() }).idx;
    const s = L.serveRating(idx, 7, 'match').rating;
    assert.ok(Math.abs(s - (75 + 100 + 0 + 100 + 1 - 0)) < 1e-9, `4-point serve rating ${s}`);
    assert.strictEqual(L.returnRating(idx, 7, 'match').rating, null, '0 BP chances and 0 2nd-serve returns dash');
    const idx2 = L.indexStats({ statistics: rows(['Aces']) }).idx;
    assert.strictEqual(L.serveRating(idx2, 7, 'match').rating, null, 'no aces row must dash, not count as 0');
  });

  // ── Edge model value layers #9 / #10 (STAGED: founder 2026-09-28, "don't flip the layer") ──
  check('model: both layers ship on the LEGACY formula — the house re-fit is staged, not live', () => {
    assert.strictEqual(MOD.config.adjustments.serve.ratingFormula, 'legacy', 'layer #9 flipped to house without the founder');
    assert.strictEqual(MOD.config.adjustments.returnPressure.ratingFormula, 'legacy', 'layer #10 flipped to house without the founder');
    assert.deepStrictEqual(MOD.config.adjustments.returnPressure.signalDivisor, { legacy: 15, house: 16.9 });
  });
  const ROW = { firstInPct: 64.8, firstWonPct: 71.6, secondWonPct: 50.8, hldPct: 79.9, aPct: 7.2, dfPct: 3.3, acesPM: 6.08, dfPM: 2.75,
    rpwPct: 35, brkPct: 17, bpConvPct: 36, ret1WonPct: 26.1, ret2WonPct: 49.4 };   // N. Borges, career Hard
  const withFormula = (f, fn) => {
    const c = MOD.config.adjustments, was = [c.serve.ratingFormula, c.returnPressure.ratingFormula];
    c.serve.ratingFormula = f; c.returnPressure.ratingFormula = f;
    try { return fn(); } finally { [c.serve.ratingFormula, c.returnPressure.ratingFormula] = was; }
  };
  check('model legacy: serve with ace%/DF% of service points, return = RPW% + break% + BP-conv% (unchanged)', () => {
    withFormula('legacy', () => {
      assert.ok(Math.abs(MOD.adj.serveRatingRow(ROW) - (64.8 + 71.6 + 50.8 + 79.9 + 7.2 - 3.3)) < 1e-9);
      assert.ok(Math.abs(MOD.adj.returnRatingRow(ROW) - (35 + 17 + 36)) < 1e-9);
    });
  });
  check('model house: the shared helper — aces/DFs per match, the 4-part return, a missing term is no rating', () => {
    withFormula('house', () => {
      assert.ok(Math.abs(MOD.adj.serveRatingRow(ROW) - (64.8 + 71.6 + 50.8 + 79.9 + 6.08 - 2.75)) < 1e-9);
      assert.ok(Math.abs(MOD.adj.returnRatingRow(ROW) - (26.1 + 49.4 + 17 + 36)) < 1e-9);
      assert.strictEqual(MOD.adj.serveRatingRow(Object.assign({}, ROW, { acesPM: undefined })), null, 'house serve without acesPM must abstain');
      assert.strictEqual(MOD.adj.returnRatingRow(Object.assign({}, ROW, { ret2WonPct: null })), null, 'house return with a missing term must abstain');
    });
  });

  check('one implementation: no second Serve / Return rating formula left in the shipped files', () => {
    assert.ok(!/MSHEET_SERVE_RATING_KEYS|function msheetRatingSum|function scale10|function trajectory/.test(src.dash + src.live),
      'a dead 4-part / 0-10 / trajectory rating implementation is back');
    assert.ok(!/aPct|dfPct|RETURN_FLOOR_PTS|SERVE_FLOOR_PTS/.test(src.live), 'live-tab.js carries its own rating arithmetic again');
    assert.ok(!/Math\.round\(m\.firstServePct\)/.test(src.dash), 'the Tournament Report rounds per term again');
    assert.ok(/<script src="\.\/house-ratings\.js"><\/script>/.test(src.dash), 'the page no longer loads the helper');
  });
  check('Database Return board: RGW% is return GAMES won (the rating\'s 3rd term)', () => {
    assert.ok(/\{h:'RGW%', full:'% return games won', k:'return\.breakPct'/.test(src.dash), 'RGW% column no longer reads breakPct');
    assert.ok(!/k:'return\.rptWonPct'/.test(src.dash), 'a Return board column reads return POINTS won again');
  });
  check('deploy: house-ratings.js is copied and asserted (a miss dashes every rating live)', () => {
    const yml = read('.github/workflows/pipeline.yml');
    assert.ok(/^\s*cp house-ratings\.js _site\/\s*$/m.test(yml), 'no cp line');
    assert.ok(/for f in [^;]*house-ratings\.js/.test(yml.replace(/\\\n/g, ' ')), 'not in the fail-closed assert list');
  });
  return out;
}

function run(src) {
  const fails = [];
  let checks;
  try { checks = suite(src); } catch (e) { return [`load: ${e.message}`]; }
  for (const [name, fn] of checks) {
    try { fn(); } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`); }
  }
  return fails;
}

// ── 1. the shipped files pass ──
const base = run(SRC);
const n = suite(SRC).length;
if (base.length) { console.error('FAIL\n  ' + base.join('\n  ')); process.exit(1); }
console.log(`ten327 house ratings: ${n} checks pass on the shipped files`);

// ── 2. every mutant of the shipped source turns the suite red ──
const MUTANTS = [
  ['helper: DF added instead of subtracted', 'hr', "SERVE_TERMS, [0, 0, 0, 0, 0, 1]", "SERVE_TERMS, [0, 0, 0, 0, 0, 0]"],
  ['helper: a missing component counts as 0', 'hr', 'if (x == null) { missing.push(names[i]); continue; }', 'if (x == null) { continue; }'],
  ['helper: 0/0 BP converted read as 0%', 'hr', 'return w != null && t != null && t > 0 ? w / t * 100 : null;', 'return w != null && t != null ? (t > 0 ? w / t * 100 : 0) : null;'],
  ['helper: 1st-in from the feed\'s whole-number %', 'hr', "firstIn: ft != null && st != null && ft + st > 0 ? ft / (ft + st) * 100 : null,", "firstIn: side ? fin(side['Service:1st serve percentage']) : null,"],
  ['helper: return drops return games won (3-part)', 'hr', 'return sum([p.ret1, p.ret2, p.retGames, p.bpConv], RETURN_TERMS, [0, 0, 0, 0]);', 'return sum([p.ret1, p.ret2, 0, p.bpConv], RETURN_TERMS, [0, 0, 0, 0]);'],
  ['TR: back to the 4-part serve (no aces − DF)', 'dash', 'svGames: HouseRatings.pct(m.svHold), aces: m.aces, dfs: m.dfs }).v;', 'svGames: HouseRatings.pct(m.svHold), aces: 0, dfs: 0 }).v;'],
  ['TR: per-term rounding', 'dash', 'out.serveRating = HouseRatings.serve({ firstIn: m.firstServePct, firstWon: m.firstServeWonPct, secondWon: m.secondServeWonPct,', 'out.serveRating = HouseRatings.serve({ firstIn: Math.round(m.firstServePct), firstWon: Math.round(m.firstServeWonPct), secondWon: Math.round(m.secondServeWonPct),'],
  ['sheet: ratings no longer from the helper', 'dash', 'const HR = [A, B].map(s => HouseRatings.fromBoxSide(s));', 'const HR = [A, B].map(s => ({ serve: { v: null, missing: [] }, ret: { v: null, missing: [] } }));'],
  ['Live: return from combined RPW (old 3-part)', 'live', "      return { rating: H ? H.fromBoxSide(boxSide(idx, pkey, per)).ret.v : null };", "      const rp = num(g(idx, pkey, per, 'Return Points Won')?.value); return { rating: rp };"],
  ['Live: aces as % of service points', 'live', "        'Service:Aces': n('Aces'),", "        'Service:Aces': n('Aces') / 1.5,"],
  ['Live: the 10-point warm-up floor back', 'live', "      return { rating: H ? H.fromBoxSide(boxSide(idx, pkey, per)).serve.v : null };", "      const sp = g(idx, pkey, per, '1st serve points won'); if (sp && sp.total < 10) return { rating: null, warming: true };\n      return { rating: H ? H.fromBoxSide(boxSide(idx, pkey, per)).serve.v : null };"],
  ['Live: missing aces read as 0', 'live', "      const n = (name) => { const r = g(idx, pkey, per, name); return r ? num(r.value) : null; };", "      const n = (name) => { const r = g(idx, pkey, per, name); return r ? num(r.value) : 0; };"],
  ['PP: Serve rating declared unheld again', 'pp', "{ label: 'Serve rating', derived: 'serveRating', kind: 'rating' },", "{ label: 'Serve rating', held: false, why: 'rating formula needs hold%' },"],
  ['PP: Return rating from the wrong side', 'pp', "return row.derived === 'serveRating' ? hr.serve.v : hr.ret.v;", "return row.derived === 'serveRating' ? hr.serve.v : H.fromBoxSide(theirs).ret.v;"],
  ['DB: RGW% reads return points won again', 'dash', "{h:'RGW%', full:'% return games won', k:'return.breakPct',", "{h:'RGW%', full:'% return points won', k:'return.rptWonPct',"],
  ['page: the helper script tag dropped', 'dash', '<script src="./house-ratings.js"></script>', ''],
  ['dead code: msheetRatingSum back', 'dash', 'function msheetHouseRatings(a, b){', 'function msheetRatingSum(p, keys){ return 0; }\nfunction msheetHouseRatings(a, b){'],
];
  MUTANTS.push(
  ['model: layer #10 flipped live', 'cfg', "that calibration.\n                      ratingFormula: 'legacy',", "that calibration.\n                      ratingFormula: 'house',"],
  ['model: layer #9 flipped live', 'cfg', "on TEN-327.\n                      ratingFormula: 'legacy',", "on TEN-327.\n                      ratingFormula: 'house',"],
  ['model: house return 3-part (combined RPW)', 'adj', 'return HouseRatings.ret({ ret1: num(row.ret1WonPct), ret2: num(row.ret2WonPct), retGames: num(row.brkPct), bpConv: num(row.bpConvPct) }).v;', 'return num(row.rpwPct) + num(row.brkPct) + num(row.bpConvPct);'],
  ['model: house serve on ace% not aces/match', 'adj', 'svGames: num(row.hldPct), aces: num(row.acesPM), dfs: num(row.dfPM) }).v;', 'svGames: num(row.hldPct), aces: num(row.aPct), dfs: num(row.dfPct) }).v;'],
  ['model: re-fit divisor dropped', 'cfg', 'signalDivisor: { legacy: 15, house: 16.9 },', 'signalDivisor: { legacy: 15, house: 15 },'],
);
const survivors = [];
for (const [name, file, from, to] of MUTANTS) {
  const at = SRC[file].indexOf(from);
  if (at < 0 || SRC[file].indexOf(from, at + 1) >= 0) { survivors.push(`${name}: anchor not unique in ${file}`); continue; }
  const m = Object.assign({}, SRC, { [file]: SRC[file].replace(from, to) });
  if (!run(m).length) survivors.push(`${name}: suite stayed green`);
}
if (survivors.length) { console.error('MUTANT SURVIVED (vacuous check)\n  ' + survivors.join('\n  ')); process.exit(1); }
console.log(`ten327 house ratings: ${MUTANTS.length} of ${MUTANTS.length} mutants turn the suite red`);
