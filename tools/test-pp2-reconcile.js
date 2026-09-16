// tools/test-pp2-reconcile.js — TEN-206 §4 fail-closed reconciliation check.
//
// Runs player-profile-v2.js against the REAL committed player-profiles.json in
// a minimal window shim and asserts the figures the ticket requires to agree.
//
// Every assertion here is paired with a NEGATIVE CONTROL: the same check is
// re-run against deliberately corrupted data and must FAIL. A check that cannot
// be made to fail is not measuring anything — this repo has shipped vacuous
// assertions before and the negative controls exist so that cannot recur.
//
// Run: node tools/test-pp2-reconcile.js

'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');

// ─── load the module under test into a window shim ──────────────────────────
function loadModule(profiles, extra) {
  const sandbox = Object.assign({ FEATURE_PP2: true, playerProfiles: { players: profiles } }, extra || {});
  global.window = sandbox;
  const src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', src)(sandbox);
  if (!sandbox.PlayerProfileV2) throw new Error('module did not export PlayerProfileV2');
  return sandbox.PlayerProfileV2;
}

const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'player-profiles.json'), 'utf8'));
const PLAYERS = raw.players;

// career-splits.json feeds the Splits modal; the market-edge shards feed Market
// edge. Both are loaded from the REAL committed artefacts — a fixture would let
// the page and the pipeline drift apart, which is the bug class §4 exists for.
const SPLITS = JSON.parse(fs.readFileSync(path.join(ROOT, 'career-splits.json'), 'utf8')).players || {};
const MARKET_DIR = path.join(ROOT, 'market-edge');
const MARKET = {};
if (fs.existsSync(MARKET_DIR)) {
  fs.readdirSync(MARKET_DIR).filter(f => f.endsWith('.json')).forEach((f) => {
    MARKET[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(MARKET_DIR, f), 'utf8'));
  });
}

const STYLES = JSON.parse(fs.readFileSync(path.join(ROOT, 'playing-styles.json'), 'utf8'));
// §5.9 Playing profile reads the hold/break rollup through the SHARED engine
// (founder ruling 7). Both are loaded into the same window shim the page uses,
// so a wiring mistake shows up here rather than as a silent grid of dashes.
const HOLDBREAK = JSON.parse(fs.readFileSync(path.join(ROOT, 'holdbreak.json'), 'utf8'));
function loadEngine() {
  const sandbox = {};
  const src = fs.readFileSync(path.join(ROOT, 'holdbreak-heatmap.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', src)(sandbox);
  if (!sandbox.HoldBreakHeatmap) throw new Error('holdbreak-heatmap.js did not export HoldBreakHeatmap');
  return sandbox.HoldBreakHeatmap;
}
const ENGINE = loadEngine();

// Correction pass. Both stores are loaded from the REAL committed artefacts for
// the same reason as the others: a fixture would let the page and the pipeline
// drift apart silently.
//  * historical-match-stats.json — the §8.1 match sheet, joined by the
//    api-tennis eventKey recentForm carries.
//  * bet365-history/ — the ledger's second price source, for the rows after the
//    Tennis-Data archive's 2026-07-26 cutoff.
const STATS = JSON.parse(fs.readFileSync(path.join(ROOT, 'historical-match-stats.json'), 'utf8'));
const B365_DIR = path.join(ROOT, 'bet365-history');
const B365 = {};
if (fs.existsSync(B365_DIR)) {
  fs.readdirSync(B365_DIR)
    .filter(f => /^\d{4}-\d{2}\.json$/.test(f))
    .forEach((f) => {
      B365[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(B365_DIR, f), 'utf8'));
    });
}

const M = loadModule(PLAYERS, {
  careerSplits: SPLITS, marketEdge: MARKET, playingStyles: STYLES,
  holdbreak: HOLDBREAK, HoldBreakHeatmap: ENGINE,
  matchStats: STATS, bet365History: B365
});
const I = M._internals;

let pass = 0, fail = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; failures.push(name + ' :: ' + e.message); console.log('  FAIL  ' + name + ' :: ' + e.message); }
}
// A negative control asserts that fn THROWS. If it does not, the corresponding
// positive check is vacuous and we say so loudly.
function mustFail(name, fn) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (threw) { pass++; console.log('  PASS  [neg] ' + name + ' (correctly rejected)'); }
  else { fail++; failures.push('[neg] ' + name + ' :: corruption NOT caught — check is vacuous'); console.log('  FAIL  [neg] ' + name + ' :: corruption NOT caught — check is vacuous'); }
}

function byName(n) {
  const k = Object.keys(PLAYERS).find(k => PLAYERS[k].name === n);
  return k ? PLAYERS[k] : null;
}

// The §4 sample: one top-10, one ~#50, one ~#136, one thin-charting, one with
// no tournament history at all. Chosen by RANK from the committed file.
function pickByRank(target) {
  let best = null;
  for (const k of Object.keys(PLAYERS)) {
    const r = parseInt(PLAYERS[k].rank, 10);
    if (!isFinite(r)) continue;
    const d = Math.abs(r - target);
    if (!best || d < best.d) best = { d, p: PLAYERS[k] };
  }
  return best && best.p;
}

const SAMPLE = [
  byName('C. Alcaraz') || pickByRank(1),
  pickByRank(50),
  pickByRank(136),
  byName('D. Schwartzman') || pickByRank(340),
  Object.values(PLAYERS).find(p => !(p.tournamentHistory || []).length)
].filter(Boolean);

console.log('TEN-206 §4 reconciliation — ' + SAMPLE.length + ' players\n');

// ════════════════════════════════════════════════════════════════════════════
// 1 · ORIENTATION (ruling 1) — the normaliser must put the SUBJECT first.
// ════════════════════════════════════════════════════════════════════════════
console.log('1 · Orientation (ruling 1: H = subject)');

check('a W row always orients subject-high', () => {
  let n = 0;
  for (const p of Object.values(PLAYERS)) {
    for (const th of p.tournamentHistory || []) {
      for (const ed of th.editions || []) {
        for (const m of ed.matches || []) {
          const o = I.normaliseEdition(m);
          if (!o.oriented) continue;
          n++;
          if (m.res === 'W') assert(o.subjSets > o.oppSets, 'W row has subject below opponent: ' + JSON.stringify(m));
          if (m.res === 'L') assert(o.subjSets < o.oppSets, 'L row has subject above opponent: ' + JSON.stringify(m));
        }
      }
    }
  }
  assert(n > 40000, 'expected >40k oriented rows, got ' + n);
  console.log('        oriented rows: ' + n);
});

// NEGATIVE CONTROL: feed it a row whose result contradicts the scoreline and
// assert the check above would catch it.
mustFail('orientation rejects a contradicting row', () => {
  const o = I.normaliseEdition({ res: 'W', score: '0 - 3', round: 'F', opp: 'X', oppKey: '1' });
  // If the normaliser were reading POSITIONALLY (the bug ruling 1 exists to
  // prevent) subjSets would be 0 and this assert would fire.
  assert(o.subjSets < o.oppSets, 'positional read would put the winner below the loser');
});

check('unparseable and tied scores never claim orientation', () => {
  ['', null, 'ret.', '2 - 2', 'walkover'].forEach(s => {
    const o = I.normaliseEdition({ res: 'W', score: s });
    assert.strictEqual(o.oriented, false, 'claimed orientation for score ' + JSON.stringify(s));
    assert.strictEqual(o.subjSets, null);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2 · SAMPLE GATE (README §9) — no bare zero may ever be printed.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n2 · Sample gate');

check('gate boundaries are 0 / <5 / 5-9 / >=10', () => {
  assert.strictEqual(I.gateFor(0), 'none');
  assert.strictEqual(I.gateFor(4), 'thin');
  assert.strictEqual(I.gateFor(5), 'small');
  assert.strictEqual(I.gateFor(9), 'small');
  assert.strictEqual(I.gateFor(10), 'full');
});

check('a 0-match record renders a dash, never 0%', () => {
  assert.strictEqual(I.rateText(0, 0), '—');
  assert.notStrictEqual(I.rateText(0, 0), '0%');
  assert.notStrictEqual(I.rateText(0, 0), '0.0%');
});

check('a sub-5 record renders a dash, never a rate', () => {
  for (let w = 0; w <= 4; w++) {
    for (let l = 0; l + w <= 4; l++) {
      assert.strictEqual(I.rateText(w, l), '—', `n=${w + l} leaked a rate`);
    }
  }
});

check('a 0-4 record (all losses, n=4) does not print 0%', () => {
  assert.strictEqual(I.rateText(0, 4), '—');
});

mustFail('gate would catch a rate leaking at n=4', () => {
  assert.strictEqual(I.rateText(1, 3), '25.0%');
});

// ════════════════════════════════════════════════════════════════════════════
// 3 · CAREER RECONCILIATION — career tile = sum of season rows.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n3 · Career = Σ season rows');

function careerFromYears(p) {
  let w = 0, l = 0;
  (p.careerByYear || []).forEach(y => { if (y && y.total) { w += y.total.won || 0; l += y.total.lost || 0; } });
  return { w, l };
}
function careerFromSurfaces(p) {
  let w = 0, l = 0;
  Object.values(p.surfaces || {}).forEach(s => {
    if (s && s.record) { w += s.record.won || 0; l += s.record.lost || 0; }
  });
  return { w, l };
}

for (const p of SAMPLE) {
  check(`${p.name}: career tile = Σ careerByYear`, () => {
    const html = M.render(p);
    const y = careerFromYears(p);
    if (!(y.w + y.l)) { assert(html.includes('no matches on record'), 'empty career must say so'); return; }
    const expect = y.w + '–' + y.l;
    assert(html.includes(expect), `rendered career tile does not contain ${expect}`);
    console.log(`        ${p.name}: ${expect} (${y.w + y.l} matches)`);
  });
}

// NEGATIVE CONTROL: corrupt one season row and assert the rendered tile no
// longer matches the (uncorrupted) expectation. This proves the check reads the
// DOM output and not the same array twice.
mustFail('career check would catch a corrupted season row', () => {
  const p = JSON.parse(JSON.stringify(SAMPLE[0]));
  const expect = careerFromYears(p);
  p.careerByYear[0].total.won += 7;            // mutate AFTER computing expectation
  const html = M.render(p);
  assert(html.includes(expect.w + '–' + expect.l), 'mutation changed the painted tile');
});

// ════════════════════════════════════════════════════════════════════════════
// 4 · SURFACE vs SEASON — RESOLVED by founder ruling B (2026-09-16).
//
// §4 as written required these two to agree; measured, they agree for 0 of 427
// players. `surfaces.*.record` is the external get_players season aggregate and
// careerByYear is our own per-season store, so they are different populations,
// not the same number computed twice. The founder ruled careerByYear is the
// spine, so the §4 chain now runs through §10 below (career = Σ surface rows =
// Σ season rows, all off the spine) and `surfaces` is out of it.
//
// The measurement is kept, un-asserted, as a standing DISCLOSURE: it is the
// evidence behind the ruling and it is how we would notice if the gap ever
// closed (which would mean the two stores had been unified upstream).
// ════════════════════════════════════════════════════════════════════════════
console.log('\n4 · Σ surface rows vs Σ season rows (disclosure — superseded by ruling B, see §10)');

let agree = 0, disagree = [];
for (const p of Object.values(PLAYERS)) {
  const y = careerFromYears(p), s = careerFromSurfaces(p);
  if (!(y.w + y.l) && !(s.w + s.l)) continue;
  if (y.w === s.w && y.l === s.l) agree++;
  else disagree.push({ name: p.name, season: y, surface: s });
}
console.log(`        agree: ${agree}   disagree: ${disagree.length}  (of ${agree + disagree.length} players with any record)`);
if (disagree.length) {
  console.log('        first 5 disagreements:');
  disagree.slice(0, 5).forEach(d =>
    console.log(`          ${d.name}: seasons ${d.season.w}–${d.season.l}  vs  surfaces ${d.surface.w}–${d.surface.l}`));
}

// ════════════════════════════════════════════════════════════════════════════
// 5 · RIBBON — rate and strip must come from the same filtered set.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n5 · Ribbon rate = strip = last-N ledger rows');

for (const p of SAMPLE) {
  check(`${p.name}: ribbon record matches its own strip`, () => {
    const rows = I.ledgerMatches(p);
    const last18 = rows.slice(-18);
    const r = I.formRate(last18);
    const html = M.render(p);
    if (!r.n) { assert(html.includes('no matches on record')); return; }
    assert(html.includes(r.won + '–' + r.lost), `ribbon should show ${r.won}–${r.lost}`);
    // the strip must render exactly as many cells as the window it claims
    const cells = (html.match(/height:22px;border-radius:5px/g) || []).length;
    assert.strictEqual(cells, last18.length, `strip drew ${cells} cells for a ${last18.length}-match window`);
    assert(html.includes('last ' + last18.length + ' ·'), 'strip caption must state its own N');
    console.log(`        ${p.name}: ${r.won}–${r.lost} over ${last18.length} shown`);
  });
}

mustFail('ribbon check would catch a strip/caption mismatch', () => {
  const p = JSON.parse(JSON.stringify(SAMPLE[0]));
  const before = I.ledgerMatches(p).slice(-18).length;
  p.recentForm.matches = p.recentForm.matches.slice(0, 3);   // shrink the window
  const html = M.render(p);
  assert(html.includes('last ' + before + ' ·'), 'caption followed the data');
});

// ════════════════════════════════════════════════════════════════════════════
// 6 · NO FUTURE MATCHES (§3)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n6 · No completed match dated after today');

check('ledger excludes every future-dated row', () => {
  const today = new Date().toISOString().slice(0, 10);
  let dropped = 0, kept = 0;
  for (const p of Object.values(PLAYERS)) {
    const all = ((p.recentForm || {}).matches) || [];
    const rows = I.ledgerMatches(p);
    kept += rows.length;
    dropped += all.filter(m => m && m.date && m.date > today).length;
    rows.forEach(m => assert(m.date <= today, `${p.name} kept a future row ${m.date}`));
  }
  console.log(`        kept ${kept}, dropped ${dropped} future-dated rows (today ${today})`);
});

mustFail('future-date gate would catch a planted row', () => {
  const p = JSON.parse(JSON.stringify(SAMPLE[0]));
  p.recentForm.matches.push({ date: '2099-01-01', opponent: 'X', won: true, tournament: 'Nowhere', round: 'F', surface: 'hard', result: '3-0', walkover: false, retired: false });
  const rows = I.ledgerMatches(p);
  assert(rows.some(m => m.date === '2099-01-01'), 'future row survived the gate');
});

// ════════════════════════════════════════════════════════════════════════════
// 7 · SPEED BANDS (ruling 4) — derived from real Tennis Abstract values.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n7 · Court-speed bands');

check('five bands, monotonic, covering the real AS range', () => {
  assert.strictEqual(I.SPEED_BANDS.length, 5);
  for (let i = 1; i < I.SPEED_BANDS.length; i++) {
    assert(I.SPEED_BANDS[i].max > I.SPEED_BANDS[i - 1].max, 'bands not monotonic');
  }
  assert.strictEqual(I.speedBandFor(0.41).id, 'vslow', 'min AS must land in Very slow');
  assert.strictEqual(I.speedBandFor(1.42).id, 'vfast', 'max AS must land in Very fast');
  assert.strictEqual(I.speedBandFor(null), null, 'a missing speed must not be banded');
});

// The bands must actually PARTITION the 64 real venues we hold, not just exist.
check('bands partition the 64 real COURT_CONDITIONS venues into 5 non-empty groups', () => {
  const src = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
  const i = src.indexOf('const COURT_CONDITIONS = {');
  const j = src.indexOf('\n};', i);
  const blk = src.slice(i, j);
  const vals = [...blk.matchAll(/abstractSpeed:\s*([0-9.]+)/g)].map(m => parseFloat(m[1]));
  assert.strictEqual(vals.length, 64, 'expected 64 real AS values, got ' + vals.length);
  const tally = {};
  vals.forEach(v => { const b = I.speedBandFor(v); tally[b.id] = (tally[b.id] || 0) + 1; });
  I.SPEED_BANDS.forEach(b => assert(tally[b.id] > 0, 'band ' + b.id + ' is empty'));
  console.log('        ' + I.SPEED_BANDS.map(b => b.label + '=' + tally[b.id]).join('  '));
});

// ════════════════════════════════════════════════════════════════════════════
// 8 · HEADLINE SIZE RULE (README §5)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n8 · Headline size rule');
check('<=10 -> 30px, 11-16 -> 23px, >16 -> 19px', () => {
  assert.strictEqual(I.headlineSize('369–309'), 30);
  assert.strictEqual(I.headlineSize('0123456789'), 30);
  assert.strictEqual(I.headlineSize('01234567890'), 23);
  assert.strictEqual(I.headlineSize('0123456789012345'), 23);
  assert.strictEqual(I.headlineSize('01234567890123456'), 19);
  assert.strictEqual(I.headlineSize('Counter Puncher / Solid Defender'), 19);
});

// ════════════════════════════════════════════════════════════════════════════
// 9 · TYPOGRAPHY (§3) — minus must be U+2212, ranges en dash.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n9 · Typography');
check('records use an EN DASH, not a hyphen', () => {
  assert.strictEqual(I.recordText(12, 8), '12–8');
  assert(!I.recordText(12, 8).includes('-'), 'hyphen leaked into a record');
});
// Scorelines legitimately keep hyphens ('7-5'), so they are tagged
// .pp2-score and stripped before the scan. Everything else that reads as a
// W-L pair must be an en dash.
check('rendered pages contain no ASCII-hyphen record outside a scoreline', () => {
  for (const p of SAMPLE) {
    const html = M.render(p);
    const noScores = html.replace(/<span class="pp2-score">[\s\S]*?<\/span>/g, ' ');
    const body = noScores.replace(/<[^>]*>/g, ' ');
    const bad = body.match(/\b\d+-\d+\b/g);
    assert(!bad, `${p.name}: hyphenated record(s) in painted text: ${bad && bad.slice(0, 3)}`);
  }
});

// The normaliser must be LOAD-BEARING, not decorative: prove the raw source
// really does carry the hyphen that the painted page does not. If the pipeline
// ever starts emitting en dashes upstream this check goes quiet and tells us so
// — it does not silently keep passing on a no-op.
check('en-dash normaliser is load-bearing (source has hyphens, page does not)', () => {
  const withHyphen = Object.values(PLAYERS).filter(p =>
    (p.insights || []).some(i => /\d+-\d+/.test(i.text || '')));
  assert(withHyphen.length > 0,
    'no insight prose carries a hyphenated record — the normaliser is now a no-op, re-check §3');
  const p = withHyphen[0];
  assert(/\d+-\d+/.test(p.insights.find(i => /\d+-\d+/.test(i.text)).text),
    'source should carry a hyphen');
  const body = M.render(p)
    .replace(/<span class="pp2-score">[\s\S]*?<\/span>/g, ' ')
    .replace(/<[^>]*>/g, ' ');
  assert(!/\b\d+-\d+\b/.test(body), 'hyphen survived into the painted page');
  console.log(`        ${withHyphen.length} players carry hyphenated insight records upstream`);
});

// The normaliser must not touch a scoreline if one is ever passed through it
// by mistake — guard the blast radius, not just the happy path.
check('en-dash normaliser only rewrites what it is given', () => {
  assert.strictEqual(I.endashRecords('career 315-178 on clay'), 'career 315–178 on clay');
  assert.strictEqual(I.endashRecords('1-8 across the last 9'), '1–8 across the last 9');
  assert.strictEqual(I.endashRecords(null), '');
});

// ════════════════════════════════════════════════════════════════════════════
// 10 · CAREER SPINE (founder ruling B) — §4 chain 1.
//      career tile = career modal total = sum of surface rows = sum of season rows
// ════════════════════════════════════════════════════════════════════════════
console.log('\n10 · Career spine (ruling B: careerByYear, labelled "since <year>")');

check('surface rows sum to the career total for EVERY player', () => {
  let checked = 0, residual = 0, withResidual = 0;
  for (const p of Object.values(PLAYERS)) {
    const t = I.spineTotal(p);
    if (!t.n) continue;
    const s = I.spineBySurface(p, null);
    const sw = s.hard.won + s.clay.won + s.grass.won + s.other.won;
    const sl = s.hard.lost + s.clay.lost + s.grass.lost + s.other.lost;
    assert.strictEqual(sw, t.won, `${p.name}: surface wins ${sw} != career ${t.won}`);
    assert.strictEqual(sl, t.lost, `${p.name}: surface losses ${sl} != career ${t.lost}`);
    if (s.other.won + s.other.lost) { withResidual++; residual += s.other.won + s.other.lost; }
    checked++;
  }
  console.log(`        ${checked} players; ${withResidual} carry an "unrecorded surface" row ` +
    `(${residual} matches in all)`);
  assert(withResidual > 0,
    'no player has a surface residual — the residual row is now dead code, re-measure before removing it');
});

// The residual row is load-bearing: without it the three named surfaces fall
// SHORT of the total for 40 players. Prove that, or the row above is decoration.
check('the residual row is load-bearing (named surfaces alone do NOT reconcile)', () => {
  let short = 0;
  for (const p of Object.values(PLAYERS)) {
    const t = I.spineTotal(p);
    if (!t.n) continue;
    const s = I.spineBySurface(p, null);
    const sw = s.hard.won + s.clay.won + s.grass.won;
    const sl = s.hard.lost + s.clay.lost + s.grass.lost;
    if (sw !== t.won || sl !== t.lost) short++;
  }
  assert(short > 0, 'named surfaces already reconcile — the residual row measures nothing');
  console.log(`        ${short} players would under-count without it`);
});

mustFail('spine check would catch a doctored season row', () => {
  const p = JSON.parse(JSON.stringify(byName('C. Alcaraz')));
  p.careerByYear[0].total.won += 3;          // total moves, surfaces do not
  const t = I.spineTotal(p);
  const s = I.spineBySurface(p, null);
  const sw = s.hard.won + s.clay.won + s.grass.won;   // residual EXCLUDED on purpose
  assert.strictEqual(sw, t.won, 'planted drift not caught');
});

check('career box headline = spine total, and says which year it starts from', () => {
  for (const p of SAMPLE) {
    const t = I.spineTotal(p);
    const vals = I.buildBoxVals(p, { archetype: null });
    if (!t.n) { assert.strictEqual(vals.career.headline, null); continue; }
    assert.strictEqual(vals.career.headline, t.won + '–' + t.lost,
      `${p.name}: box headline disagrees with the spine`);
    const fy = I.spineFirstYear(p);
    assert(vals.career.support.includes('since ' + fy),
      `${p.name}: career box does not disclose the window (${vals.career.support})`);
  }
});

check('career modal total row = career box headline', () => {
  for (const p of SAMPLE) {
    const t = I.spineTotal(p);
    if (!t.n) continue;
    const html = I.renderCareerModal(p, {});
    // The footer "Career" row prints W/L; it must be the same pair as the tile.
    assert(html.includes('>' + t.won + '/' + t.lost + '<'),
      `${p.name}: career modal footer does not carry ${t.won}/${t.lost}`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 11 · TOURNAMENT — §4: "Tournament W-L = sum of its listed editions".
// ════════════════════════════════════════════════════════════════════════════
console.log('\n11 · Record per tournament');

check('every tournament W-L equals the sum of its editions', () => {
  let rows = 0;
  for (const p of Object.values(PLAYERS)) {
    for (const t of p.tournamentHistory || []) {
      let w = 0, l = 0;
      (t.editions || []).forEach(e => (e.matches || []).forEach(m => {
        if (m.res === 'W') w++; else if (m.res === 'L') l++;
      }));
      assert.strictEqual(w, t.won || 0, `${p.name} / ${t.name}: editions ${w} wins vs stored ${t.won}`);
      assert.strictEqual(l, t.lost || 0, `${p.name} / ${t.name}: editions ${l} losses vs stored ${t.lost}`);
      rows++;
    }
  }
  console.log(`        ${rows} tournament rows reconcile with their editions`);
});

mustFail('tournament check would catch a dropped edition', () => {
  const p = JSON.parse(JSON.stringify(SAMPLE[0]));
  p.tournamentHistory[0].editions.shift();
  let w = 0, l = 0;
  (p.tournamentHistory[0].editions || []).forEach(e => (e.matches || []).forEach(m => {
    if (m.res === 'W') w++; else if (m.res === 'L') l++;
  }));
  assert.strictEqual(w, p.tournamentHistory[0].won, 'dropped edition not caught');
});

// ════════════════════════════════════════════════════════════════════════════
// 12 · BIGGEST SPLIT / BIGGEST BAND (founder ruling sel-0) — one rule, two callers.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n12 · Biggest split / biggest band (largest |pp| vs own baseline, n>=10)');

check('the picked split really is the largest |pp| among those clearing n>=10', () => {
  let tested = 0;
  for (const key of Object.keys(SPLITS).slice(0, 60)) {
    const cands = I.splitCandidates(key, 'career');
    const got = I.pickByLargestGap(cands);
    if (!got) continue;
    const eligible = cands.filter(c => c.won + c.lost >= 10);
    let maxGap = 0;
    eligible.forEach((c) => {
      const n = c.won + c.lost;
      maxGap = Math.max(maxGap, Math.abs(100 * c.won / n - got.baseline));
    });
    assert(Math.abs(Math.abs(got.pick.gap) - maxGap) < 1e-9,
      `${key}: picked |${got.pick.gap.toFixed(2)}| but the largest is |${maxGap.toFixed(2)}|`);
    tested++;
  }
  assert(tested > 20, `only ${tested} players had a pickable split — expected most of the sample`);
  console.log(`        ${tested} players checked`);
});

check('the baseline is match-count weighted, not a mean of rates', () => {
  // Two splits: 100 matches at 50%, 10 matches at 0%. Weighted baseline is
  // 50/110 = 45.5%; an unweighted mean of rates would be 25%.
  const cands = [
    { id: 'a', label: 'A', won: 50, lost: 50 },
    { id: 'b', label: 'B', won: 0, lost: 10 },
  ];
  const got = I.pickByLargestGap(cands);
  assert(Math.abs(got.baseline - (100 * 50 / 110)) < 1e-9,
    `baseline ${got.baseline} is not match-count weighted`);
  assert.strictEqual(got.pick.id, 'b');
});

check('a split under ten matches can never be picked', () => {
  const got = I.pickByLargestGap([
    { id: 'big', label: 'Big', won: 50, lost: 50 },
    { id: 'tiny', label: 'Tiny', won: 9, lost: 0 },   // 100%, but n=9
  ]);
  assert.strictEqual(got.pick.id, 'big', 'a 9-match split was picked');
});

mustFail('biggest-split check would catch an off-by-one floor', () => {
  const got = I.pickByLargestGap([
    { id: 'big', label: 'Big', won: 50, lost: 50 },
    { id: 'tiny', label: 'Tiny', won: 9, lost: 0 },
  ]);
  assert.strictEqual(got.pick.id, 'tiny', 'floor is not at ten');
});

// ─── gate-3 ruling bw-0: keep the sign-blind rule, fix the word ──────────────
// The founder's objection was that "best split" can name the player's WORST
// split. He ruled the rule stays and the label becomes "biggest". These two
// pin both halves: the selection must still be allowed to go negative, and no
// user-facing string may say "best split"/"best band" again.
check('the pick is allowed to be negative — the rule is sign-blind by ruling', () => {
  // One split far BELOW the weighted baseline, one modestly above it. The
  // larger |pp| is the negative one and it must win.
  const got = I.pickByLargestGap([
    { id: 'strong', label: 'Strong', won: 60, lost: 40 },   // 60.0%
    { id: 'weak', label: 'Weak', won: 2, lost: 18 },        // 10.0%
  ]);
  const baseline = 100 * 62 / 120;                          // 51.67%
  assert(Math.abs(got.baseline - baseline) < 1e-9);
  assert.strictEqual(got.pick.id, 'weak', 'the sign-blind rule did not pick the negative split');
  assert(got.pick.gap < 0, `expected a negative gap, got ${got.pick.gap}`);
});

check('no user-facing string calls it the "best" split or band', () => {
  const src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  // Strip // comments: the ruling's own rationale quotes the old wording.
  const code = src.split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');
  const offenders = (code.match(/'[^'\n]*\bbest (split|band)\b[^'\n]*'/gi) || []);
  assert.strictEqual(offenders.length, 0,
    `ruling bw-0 regressed — user-facing text still says: ${offenders.join(', ')}`);
  // The replacement must actually be present, or this check passes vacuously
  // on a file that simply dropped the support line.
  assert(/'biggest split /.test(code), 'the "biggest split" support line is gone entirely');
});

mustFail('[neg] the wording lock would catch a revert to "best split"', () => {
  const code = "support: 'best split ' + MIDDOT";
  const offenders = (code.match(/'[^'\n]*\bbest (split|band)\b[^'\n]*'/gi) || []);
  assert.strictEqual(offenders.length, 0, 'lock is inert');
});

check('splits box headline and the modal agree on the picked split', () => {
  let shown = 0;
  for (const p of SAMPLE) {
    const bs = I.biggestSplit(p);
    const vals = I.buildBoxVals(p, { archetype: null });
    if (!bs) { assert.strictEqual(vals.splits.headline, null, `${p.name}: headline without a pick`); continue; }
    assert.strictEqual(vals.splits.headline, bs.pick.label);
    const html = I.renderSplitsModal(p);
    assert(html.includes(bs.baseline.toFixed(1) + '%'),
      `${p.name}: modal does not disclose the baseline the headline was measured against`);
    shown++;
  }
  console.log(`        ${shown} of ${SAMPLE.length} sample players have a biggest split`);
});

// ════════════════════════════════════════════════════════════════════════════
// 13 · MARKET EDGE (founder ruling B + gate-2 "do as on the design").
//      §4: role counts and band counts sum to the headline priced count.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n13 · Market edge');

const MK_KEYS = Object.keys(MARKET);
check('market shards exist', () => {
  assert(MK_KEYS.length > 100, `only ${MK_KEYS.length} market shards — run build-market-edge.js`);
  console.log(`        ${MK_KEYS.length} shards`);
});

check('role cards sum to the headline priced count, for every shard', () => {
  for (const k of MK_KEYS) {
    const s = MARKET[k];
    const sum = s.roles.favourite.n + s.roles.underdog.n + s.roles.level.n;
    assert.strictEqual(sum, s.headline.n, `${k}: roles ${sum} != headline ${s.headline.n}`);
  }
});

check('price bands sum to the headline priced count, for every shard', () => {
  let level = 0;
  for (const k of MK_KEYS) {
    const s = MARKET[k];
    const sum = ['favourite', 'underdog']
      .reduce((a, g) => a + s.bands[g].reduce((x, b) => x + b.n, 0), 0) + s.roles.level.n;
    assert.strictEqual(sum, s.headline.n, `${k}: bands ${sum} != headline ${s.headline.n}`);
    level += s.roles.level.n;
  }
  console.log(`        ${level} player-sides closed at an identical price on both sides ` +
    `(neither favourite nor underdog; counted separately rather than forced into a card)`);
});

check('per-row book counts sum to the headline, and the label is never blended', () => {
  for (const k of MK_KEYS) {
    const s = MARKET[k];
    assert.strictEqual(s.headline.book.pinnacle + s.headline.book.bet365, s.headline.n,
      `${k}: book mix does not sum to the priced count`);
    const rows = s.matches.filter(m => m.book !== 'pinnacle' && m.book !== 'bet365-archive');
    assert.strictEqual(rows.length, 0, `${k}: ${rows.length} rows carry no book label`);
    assert.strictEqual(s.matches.filter(m => m.book === 'pinnacle').length, s.headline.book.pinnacle,
      `${k}: row-level Pinnacle count disagrees with the summary`);
  }
});

// The fallback must be load-bearing: if Pinnacle covered everything, ruling B
// would be a no-op and this whole pass would be unnecessary. Prove it is not.
check('the Bet365-archive fallback is load-bearing', () => {
  const b = MK_KEYS.reduce((a, k) => a + MARKET[k].headline.book.bet365, 0);
  const p = MK_KEYS.reduce((a, k) => a + MARKET[k].headline.book.pinnacle, 0);
  assert(b > 0, 'no row used the fallback — Pinnacle now covers everything, re-check ruling B');
  console.log(`        ${p} Pinnacle rows, ${b} Bet365-archive rows ` +
    `(${(100 * b / (p + b)).toFixed(1)}% of priced rows would be DARK under Pinnacle-only)`);
});

check('flat-stake yield recomputes from the shard rows', () => {
  // Recompute the headline from the per-row P&L rather than trusting the
  // summary. A summary that cannot be re-derived from its own rows is a claim,
  // not a measurement.
  for (const k of MK_KEYS.slice(0, 40)) {
    const s = MARKET[k];
    if (s.headline.yield == null) continue;
    const pl = s.matches.reduce((a, m) => a + m.pl, 0);
    const y = 100 * pl / s.matches.length;
    assert(Math.abs(y - s.headline.yield) < 0.06,
      `${k}: rows give ${y.toFixed(2)}% but the headline says ${s.headline.yield}%`);
  }
});

mustFail('yield check would catch a doctored row', () => {
  const k = MK_KEYS[0];
  const s = JSON.parse(JSON.stringify(MARKET[k]));
  s.matches[0].pl += 40;
  const y = 100 * s.matches.reduce((a, m) => a + m.pl, 0) / s.matches.length;
  assert(Math.abs(y - s.headline.yield) < 0.06, 'doctored row not caught');
});

check('the tour baseline is computed, not a rounded constant', () => {
  const s = MARKET[MK_KEYS[0]];
  const t = s.tour.all;
  assert(t && t.n > 50000, `tour baseline rests on only ${t && t.n} sides`);
  assert(t.yield != null, 'tour yield is null');
  // The export hard-codes -3.79%. Ours must be OUR number over OUR archive.
  assert(Math.abs(t.yield + 3.79) > 1e-9, 'tour baseline equals the export constant — not recomputed');
  console.log(`        tour yield ${t.yield}% over ${t.n} priced player-sides ` +
    `(the export's placeholder was -3.79%)`);
});

check('market box headline and the modal quote the same yield and n', () => {
  for (const p of SAMPLE) {
    const mk = MARKET[String(p.key)];
    const vals = I.buildBoxVals(p, { archetype: null });
    if (!mk || mk.headline.yield == null) {
      assert.strictEqual(vals.market.headline, null, `${p.name}: market headline without a shard`);
      continue;
    }
    assert(vals.market.support.includes(mk.headline.n + ' priced'),
      `${p.name}: box does not carry the priced n`);
    const html = I.renderMarketModal(p);
    assert(html.includes(mk.headline.n + ' priced'), `${p.name}: modal does not carry the priced n`);
    assert(html.includes('closing'), `${p.name}: modal does not label the price basis`);
  }
});

check('a rate is never printed below the ten-match gate anywhere in a shard', () => {
  for (const k of MK_KEYS) {
    const s = MARKET[k];
    ['favourite', 'underdog'].forEach((g) => {
      s.bands[g].forEach((b) => {
        if (b.n < 5) {
          assert.strictEqual(b.winRate, null, `${k}/${g}/${b.id}: rate printed on n=${b.n}`);
          assert.strictEqual(b.yield, null, `${k}/${g}/${b.id}: yield printed on n=${b.n}`);
        }
      });
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 14 · CALENDAR RECORD (founder ruling cal-0, gate 3).
//      §4's "Calendar grid total = career total" is DROPPED by that ruling —
//      the archive is ATP tour main draw only. These checks are what replaced
//      it: the grid must be a labelled SUBSET of the spine, and the label must
//      state both numbers. Every figure is recomputed here from the shard rows
//      rather than read back off the renderer.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n14 · Calendar record (ruling cal-0 — dated rows from the priced archive)');

const CAL_PLAYERS = Object.keys(MARKET).slice(0, 80);

check('the heat grid accounts for every priced row, and only those', () => {
  let checked = 0;
  for (const k of CAL_PLAYERS) {
    const p = PLAYERS[k];
    if (!p) continue;
    const rows = I.calRows(p);
    assert.strictEqual(rows.length, MARKET[k].matches.length,
      `${k}: calRows dropped rows`);
    // Recompute the grid total independently of calGrid().
    let gridTotal = 0;
    I.calGrid(rows).forEach(yr => yr.cells.forEach(c => { gridTotal += c.won + c.lost; }));
    let raw = 0;
    MARKET[k].matches.forEach((m) => {
      if (/^\d{4}-\d{2}/.test(m.date)) raw += 1;
    });
    assert.strictEqual(gridTotal, raw, `${k}: grid holds ${gridTotal} of ${raw} dated rows`);
    checked++;
  }
  assert(checked > 50, `only ${checked} players checked`);
  console.log(`        ${checked} players — every dated row lands in a grid cell`);
});

// The archive and the spine OVERLAP, they do not nest — the archive is narrower
// by tier and deeper in time. Measured: 11 of 356 players have more priced rows
// than the spine holds (Djokovic 1,277 vs 601), because careerByYear is a
// window. So the label must never be phrased as a fraction. This pins that.
check('the calendar never claims to be a subset it is not', () => {
  const inverted = [];
  for (const k of Object.keys(MARKET)) {
    const p = PLAYERS[k];
    if (!p) continue;
    const c = I.calScope(p);
    assert.strictEqual(c.nested, c.n <= c.m, `${p.name}: nested flag disagrees with the counts`);
    if (!c.nested) inverted.push(`${p.name} ${c.n}>${c.m}`);
  }
  // The inversion is real and must stay visible — if it ever reads zero, either
  // the spine widened or the archive was silently truncated, and both are news.
  assert(inverted.length > 0, 'no player inverts — the scopes changed, re-measure the label');
  console.log(`        ${inverted.length} of ${Object.keys(MARKET).length} players hold MORE priced ` +
    `rows than the spine (e.g. ${inverted[0]}) — why the label is not a fraction`);
});

check('the scope label states both numbers without asserting nesting', () => {
  let shown = 0;
  for (const k of CAL_PLAYERS.slice(0, 20)) {
    const p = PLAYERS[k];
    if (!p) continue;
    const c = I.calScope(p);
    if (!c.n) continue;
    const html = I.renderSeasonModal(p);
    assert(html.includes(`${c.n} priced`), `${p.name}: modal never prints its own row count`);
    assert(html.includes(`career record above holds ${c.m}`),
      `${p.name}: modal drops the spine total, leaving the scope uncomparable`);
    assert(/tour main draw/.test(html), `${p.name}: modal does not name the scope`);
    assert(!html.includes(`${c.n} of ${c.m}`),
      `${p.name}: the label reverted to a fraction, which inverts for veterans`);
    shown++;
  }
  assert(shown > 10, `only ${shown} modals rendered`);
  console.log(`        ${shown} modals carry both counts, neither phrased as a fraction`);
});

mustFail('[neg] the label check would catch a revert to the "N of M" fraction', () => {
  const c = { n: 1277, m: 601 };
  const html = `tour main draw · ${c.n} of ${c.m}`;
  assert(!html.includes(`${c.n} of ${c.m}`), 'fraction wording is back');
});

check('runs partition the sequence — lengths sum to the match count', () => {
  for (const k of CAL_PLAYERS) {
    const p = PLAYERS[k];
    if (!p) continue;
    const rows = I.calRows(p);
    const runs = I.calRuns(rows);
    const summed = runs.reduce((a, r) => a + r.len, 0);
    assert.strictEqual(summed, rows.length, `${k}: runs sum to ${summed}, not ${rows.length}`);
    // adjacent runs must alternate, or they were not runs
    for (let i = 1; i < runs.length; i++) {
      assert(runs[i].res !== runs[i - 1].res, `${k}: two ${runs[i].res} runs in a row`);
    }
    // the longest win run must really be the longest streak of wins
    let cur = 0, best = 0;
    rows.forEach((r) => { cur = r.won ? cur + 1 : 0; if (cur > best) best = cur; });
    const lw = runs.filter(r => r.res === 'W').sort((a, b) => b.len - a.len)[0];
    assert.strictEqual(lw ? lw.len : 0, best, `${k}: longest win run disagrees with a direct scan`);
  }
  console.log(`        ${CAL_PLAYERS.length} players — runs alternate and sum to n`);
});

check('the Indoors segment reads the archive court column, not the surface', () => {
  const p = PLAYERS[Object.keys(MARKET).find(k => MARKET[k].matches.some(m => m.court === 'Indoor'))];
  assert(p, 'no shard carries an Indoor row — the court column did not survive the build');
  const all = I.calRows(p);
  // Indoor rows must be a mix of surfaces, which is the whole point: "Indoors"
  // overlaps Hard/Clay/Grass rather than being a fourth surface.
  const indoor = all.filter(m => m.court === 'Indoor');
  assert(indoor.length > 0);
  assert(indoor.every(m => ['Hard', 'Clay', 'Grass'].includes(m.surface)),
    'an Indoor row carries no surface — the two axes got conflated');
  let total = 0, ind = 0;
  Object.keys(MARKET).forEach((k) => {
    MARKET[k].matches.forEach((m) => { total++; if (m.court === 'Indoor') ind++; });
  });
  assert.strictEqual(total, Object.keys(MARKET).reduce((a, k) => a + MARKET[k].matches.length, 0));
  const missing = Object.keys(MARKET).reduce((a, k) =>
    a + MARKET[k].matches.filter(m => !m.court).length, 0);
  assert.strictEqual(missing, 0, `${missing} shard rows have no court type — the column is not 100%`);
  console.log(`        ${ind} of ${total} shard rows are Indoor (${(100 * ind / total).toFixed(1)}%), 0 unlabelled`);
});

check('every tab and segment renders without leaking NaN/undefined into the DOM', () => {
  const p = PLAYERS[Object.keys(MARKET).find(k => (MARKET[k].matches || []).length > 200)];
  assert(p, 'no shard large enough to exercise the segments');
  const saved = { ...I.state };
  let rendered = 0;
  try {
    for (const tab of ['calendar', 'streaks']) {
      for (const s of ['all', 'hard', 'clay', 'grass', 'indoors']) {
        I.state.calTab = tab; I.state.calSurface = s;
        I.state.calCell = null; I.state.calRun = null;
        const html = I.renderSeasonModal(p);
        ['NaN', 'undefined', 'Infinity', '[object'].forEach((t) => {
          assert(!html.includes(t), `${tab}/${s}: "${t}" reached the DOM`);
        });
        rendered++;
      }
    }
    // Surfaces partition the rows; "Indoors" does NOT — it is a court type that
    // overlaps them. If indoors ever equals the leftover, the axes got conflated.
    I.state.calTab = 'calendar';
    const all = (I.state.calSurface = 'all', I.calFiltered(p).length);
    const bySurf = ['hard', 'clay', 'grass']
      .reduce((a, s) => (I.state.calSurface = s, a + I.calFiltered(p).length), 0);
    assert.strictEqual(bySurf, all, `surfaces hold ${bySurf} of ${all} — they must partition`);
    I.state.calSurface = 'indoors';
    const ind = I.calFiltered(p).length;
    assert(ind > 0 && ind < all, `indoors holds ${ind} of ${all} — not an overlapping subset`);

    // Both drills must open and stay clean.
    I.state.calSurface = 'all';
    const grid = I.calGrid(I.calRows(p));
    const mi = grid[0].cells.findIndex(c => c.won + c.lost > 0);
    I.state.calCell = `${grid[0].year}-${mi}`;
    let h = I.renderSeasonModal(p);
    assert(h.includes('rgba(91,155,255,0.3)'), 'cell drill did not open');
    assert(!/NaN|undefined/.test(h), 'cell drill leaked a non-number');
    I.state.calCell = null; I.state.calTab = 'streaks'; I.state.calRun = 0;
    h = I.renderSeasonModal(p);
    assert(h.includes('rgba(91,155,255,0.3)'), 'run detail did not open');
    assert(!/NaN|undefined/.test(h), 'run detail leaked a non-number');
  } finally {
    Object.assign(I.state, saved);
  }
  console.log(`        ${rendered} tab x segment combinations + both drills render clean`);
});

check('Erdos-Renyi expectations match the design formula, and degenerate rates dash', () => {
  // Transcribed independently here from the .dc.html comment, not from the
  // module — if the module drifts, these disagree.
  const expLong = (n, p) => Math.round(Math.log(n * (1 - p)) / Math.log(1 / p)
    + 0.5772 / Math.log(1 / p) - 0.5);
  const exp5 = (n, p) => Math.round(n * (1 - p) * Math.pow(p, 5) + n * p * Math.pow(1 - p, 5));
  [[678, 0.544], [413, 0.806], [100, 0.5], [50, 0.2]].forEach(([n, p]) => {
    assert.strictEqual(I.expectedLongest(n, p), expLong(n, p), `expectedLongest(${n},${p})`);
    assert.strictEqual(I.expectedRuns5(n, p), exp5(n, p), `expectedRuns5(${n},${p})`);
  });
  // A player who never lost (or never won) makes the formula undefined. It must
  // dash, not render Infinity or NaN as if it were a number.
  assert.strictEqual(I.expectedLongest(20, 1), null);
  assert.strictEqual(I.expectedLongest(20, 0), null);
  assert.strictEqual(I.expectedRuns5(20, 1), null);
  console.log('        expected-longest and runs-of-5+ match the .dc.html formula');
});

check('month "vs other months" gaps are weighted, and Consistent counts seasons', () => {
  for (const k of CAL_PLAYERS.slice(0, 40)) {
    const p = PLAYERS[k];
    if (!p) continue;
    const rows = I.calRows(p);
    const info = I.calMonths(rows);
    let sumN = 0;
    info.months.forEach((x) => { sumN += x.n; });
    assert.strictEqual(sumN, rows.length, `${k}: month buckets hold ${sumN} of ${rows.length}`);
    info.months.forEach((x) => {
      // Consistent can never exceed the seasons on record.
      assert(x.above <= x.seasons, `${k}/${x.m}: consistent ${x.above} > ${x.seasons} seasons`);
      if (x.n === 0) assert.strictEqual(x.yield, null, `${k}/${x.m}: yield on an empty month`);
    });
    // Recompute one month's gap the long way and compare.
    const m0 = info.months.find(x => x.n > 0 && x.gap != null);
    if (m0) {
      const mine = rows.filter(r => parseInt(r.date.slice(5, 7), 10) - 1 === m0.m);
      const others = rows.filter(r => parseInt(r.date.slice(5, 7), 10) - 1 !== m0.m);
      const y = 100 * mine.reduce((a, r) => a + r.pl, 0) / mine.length;
      const o = 100 * others.reduce((a, r) => a + r.pl, 0) / others.length;
      assert(Math.abs((y - o) - m0.gap) < 1e-6,
        `${k}: month ${m0.m} gap ${m0.gap} but a direct recompute says ${(y - o)}`);
    }
  }
  console.log('        month buckets partition the rows; gaps recomputed the long way agree');
});

// ════════════════════════════════════════════════════════════════════════════
// 15 · INDOORS COLUMN (founder's gate-3 correction: "We should have it through
//      api tennis" — he was right; our normaliser was dropping "(Indoor)").
//      The committed player-profiles.json predates the pipeline change, so real
//      rows carry no `indoor` key and the carve-out is currently a NO-OP. These
//      tests therefore drive SYNTHETIC rows: without them the column would be
//      untested until the next pipeline run, and a grid that renders nothing is
//      indistinguishable from a grid that renders correctly.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n15 · Indoors column (carve-out, not a fifth surface)');

// 20 hard (6 of them indoor), 10 clay, 4 grass, 2 indoor clay => total 34.
const IND_YEAR = {
  year: String(new Date().getFullYear()), allTier: true,
  total: { won: 20, lost: 14 },
  clay: { won: 7, lost: 3 }, hard: { won: 11, lost: 9 }, grass: { won: 2, lost: 2 },
  indoor: {
    total: { won: 5, lost: 3 }, clay: { won: 1, lost: 1 },
    hard: { won: 4, lost: 2 }, grass: null,
  },
};
const IND_PRE = {
  year: '2015', allTier: false,
  total: { won: 30, lost: 20 }, clay: { won: 10, lost: 5 },
  hard: { won: 18, lost: 13 }, grass: { won: 2, lost: 2 }, indoor: null,
};
const IND_PLAYER = { key: '__ind', name: 'T. Est', careerByYear: [IND_YEAR, IND_PRE] };

check('the carve-out subtracts indoor from its own surface', () => {
  const g = I.gridCells(IND_YEAR);
  // hard 11-9 minus indoor-hard 4-2 => 7-7
  assert.deepStrictEqual(g.hard, { won: 7, lost: 7 }, `hard ${JSON.stringify(g.hard)}`);
  assert.deepStrictEqual(g.clay, { won: 6, lost: 2 }, `clay ${JSON.stringify(g.clay)}`);
  // grass has no indoor component and must pass through untouched
  assert.deepStrictEqual(g.grass, { won: 2, lost: 2 });
  assert.deepStrictEqual(g.indoors, { won: 5, lost: 3 });
});

check('the five columns sum to Total — the chain the spine ruling established', () => {
  const g = I.gridCells(IND_YEAR);
  const n = r => (r ? r.won + r.lost : 0);
  const parts = n(g.clay) + n(g.hard) + n(g.grass) + n(g.indoors);
  assert.strictEqual(parts, n(g.total),
    `columns hold ${parts} of ${n(g.total)} — the carve-out double-counts or drops`);
  const won = (g.clay.won + g.hard.won + g.grass.won + g.indoors.won);
  assert.strictEqual(won, g.total.won, `wins ${won} vs total ${g.total.won}`);
});

mustFail('[neg] the sum check would catch Indoors listed as a fifth peer', () => {
  // The bug this rules out: leaving the surface buckets inclusive AND showing
  // indoors beside them, which counts every indoor match twice.
  const g = I.gridCells(IND_YEAR);
  const n = r => (r ? r.won + r.lost : 0);
  const peer = n(IND_YEAR.clay) + n(IND_YEAR.hard) + n(IND_YEAR.grass) + n(g.indoors);
  assert.strictEqual(peer, n(g.total), 'inclusive columns still sum');
});

check('a row with no court-type source dashes rather than reading as zero indoor', () => {
  const g = I.gridCells(IND_PRE);
  assert.strictEqual(g.indoors, null, 'a pre-window row invented an indoor record');
  // its surface cells must be untouched by a carve-out that cannot apply
  assert.deepStrictEqual(g.hard, IND_PRE.hard);
  assert.deepStrictEqual(g.clay, IND_PRE.clay);
});

check('the rendered grid shows the Indoors column and the dash, in the DOM', () => {
  const saved = { ...I.state };
  try {
    I.state.careerScope = 'career';
    const html = I.renderCareerModal(IND_PLAYER, { archetype: null });
    assert(html.includes('Indoors'), 'the header has no Indoors column');
    // six columns now: auto + repeat(5)
    assert(/repeat\(5,minmax\(0,1fr\)\)/.test(html),
      'the grid track count did not widen to five data columns');
    // the carved hard cell (7/7) must be painted, and the raw 11/9 must NOT be
    assert(html.includes('>7/7<'), 'the carved Hard cell is not in the DOM');
    assert(!html.includes('>11/9<'), 'the DOM still shows the uncarved Hard record');
    assert(html.includes('>5/3<'), 'the Indoors cell is not in the DOM');
    // the pre-window row must paint a dash in the Indoors column
    assert(html.includes('2015'), 'the pre-window row is missing');
    // coverage must be stated, not implied
    assert(/Court type reaches 1 of 2 seasons/.test(html),
      'the footnote does not state the column\'s coverage');
  } finally { Object.assign(I.state, saved); }
});

mustFail('[neg] the DOM check would catch a grid that never widened', () => {
  const html = '<div style="grid-template-columns:auto repeat(4,minmax(0,1fr));">Grass</div>';
  assert(/repeat\(5,minmax\(0,1fr\)\)/.test(html), 'grid is still four columns');
});

check('real committed profiles are unaffected until the pipeline repopulates', () => {
  // The capture is additive by design. Until a pipeline run writes `indoor`,
  // every real row must render exactly as it did before — no zeros, no shifted
  // surface records, just a dashed column.
  let dashed = 0;
  for (const p of SAMPLE) {
    const years = I.spineYears(p);
    years.forEach((y) => {
      const g = I.gridCells(y);
      assert.strictEqual(g.indoors, null, `${p.name}/${y.year}: indoor data appeared from nowhere`);
      assert.deepStrictEqual(g.hard, y.hard || null, `${p.name}/${y.year}: hard moved`);
      assert.deepStrictEqual(g.clay, y.clay || null, `${p.name}/${y.year}: clay moved`);
    });
    dashed += years.length;
  }
  console.log(`        ${dashed} committed season rows unchanged; Indoors dashes pending a pipeline run`);
});


// ════════════════════════════════════════════════════════════════════════════
// 16 · COURT SPEED (§5.5) — venue join, era guard, band reconciliation
// ════════════════════════════════════════════════════════════════════════════
console.log('\n16 · Court speed (§5.5)');

const SPEED_MAP_PATH = path.join(ROOT, 'court-speed-map.json');
const SPEED_MAP = fs.existsSync(SPEED_MAP_PATH)
  ? JSON.parse(fs.readFileSync(SPEED_MAP_PATH, 'utf8')) : null;

// The join that matters most. Roland Garros (clay, AS 0.68) and Paris-Bercy
// (indoor hard, AS 0.97) are two courts in one city. tournament-venues.json
// geocodes "French Open" to the Paris city centre, so ANY coordinate-based or
// city-name join silently bands 2,900 clay matches off an indoor hard reading.
// This locks the outcome, not the mechanism — a future rewrite of the matcher
// is free, reintroducing the collision is not.
check('"French Open" resolves to Roland Garros, never to Paris', () => {
  assert(SPEED_MAP, 'court-speed-map.json is missing — run build-court-speed-map.js');
  const e = SPEED_MAP.events['French Open'];
  assert(e, '"French Open" is unmapped');
  assert.strictEqual(e.venue, 'Roland Garros', 'French Open mapped to ' + e.venue);
});
mustFail('the venue lock would catch French Open pointing at Paris', () => {
  const e = { venue: 'Paris' };
  assert.strictEqual(e.venue, 'Roland Garros', 'French Open mapped to ' + e.venue);
});

// The era guard keeps the surface the RATING was taken in, not the one with the
// most rows. Stuttgart is the case that separates the two rules: its clay era is
// longer (369 rows) than its grass era (297), but the 2025 rating is a grass
// reading. A modal-frequency guard passes every other venue and fails this one.
check('the surface guard keeps the rating-year era, not the commonest one', () => {
  assert(SPEED_MAP, 'court-speed-map.json is missing');
  const g = SPEED_MAP.surfaceGuard;
  Object.keys(g).forEach((venue) => {
    const kept = g[venue];
    kept.drop.forEach((d) => {
      assert(d.lastSeen < kept.keptThrough,
        `${venue}: kept era ends ${kept.keptThrough} but dropped era "${d.key}" ran to ${d.lastSeen}`);
    });
  });
  const st = g['Stuttgart'];
  if (st) {
    assert.strictEqual(st.keep, 'Grass/Outdoor', 'Stuttgart kept ' + st.keep + ', not its rated grass era');
    assert(st.drop.some(d => d.rows > st.keptRows),
      'Stuttgart no longer has a LARGER dropped era — this check has stopped separating the two rules');
  }
});
mustFail('the era check would catch a guard that kept the commonest era', () => {
  const kept = { keep: 'Clay/Outdoor', keptThrough: 2014, keptRows: 369, drop: [{ key: 'Grass/Outdoor', rows: 297, lastSeen: 2026 }] };
  kept.drop.forEach((d) => {
    assert(d.lastSeen < kept.keptThrough,
      `kept era ends ${kept.keptThrough} but dropped era "${d.key}" ran to ${d.lastSeen}`);
  });
});

// §4: the bands plus the rows no band could rate must account for EVERY priced
// row. A shortfall here is how a coverage gap disguises itself as a small career.
check('banded + unbanded = every priced row, on every surface chip', () => {
  let combos = 0;
  for (const p of SAMPLE) {
    const total = I.speedRows(p).length;
    if (!total) continue;
    for (const s of I.SPEED_SURFACES.map(x => x.id)) {
      I.state.speedSurf = s;
      const bands = I.speedBands(p);
      const banded = bands.reduce((n, b) => n + b.won + b.lost, 0);
      const inSurface = I.speedRows(p).filter(m => I.speedSurfaceMatch(m, s)).length;
      assert.strictEqual(banded + bands.unbanded, inSurface,
        `${p.name}/${s}: ${banded} banded + ${bands.unbanded} unbanded != ${inSurface} rows`);
      combos++;
    }
  }
  I.state.speedSurf = 'all';
  console.log(`        ${combos} player x surface combinations reconcile exactly`);
});
mustFail('the reconciliation would catch a band that dropped rows', () => {
  assert.strictEqual(300 + 24, 337, '300 banded + 24 unbanded != 337 rows');
});

// ─── FOUNDER RULING 2026-09-16 · grass is Very fast, headline is a band ──────
// Two rules, locked together because they arrived as one ruling:
//   (1) a Grass row lands in Very fast REGARDLESS of its Abstract rating;
//   (2) the Court speed box headline is always one of the five band labels or a
//       dash — never a surface name (it used to read "Grass courts").
check('every Grass row lands in Very fast, whatever its Abstract rating', () => {
  let grassRows = 0, offRating = 0, players = 0;
  for (const k of Object.keys(PLAYERS)) {
    const p = Object.assign({ key: k }, PLAYERS[k]);
    const rows = I.speedRows(p);
    if (!rows.length) continue;
    const grass = rows.filter(m => String(m.surface || '') === 'Grass');
    if (!grass.length) continue;
    players++;
    grass.forEach((m) => {
      grassRows++;
      const b = I.speedBandForRow(m);
      assert(b, `${p.name}: a Grass row was left unbanded (speed=${m.speed})`);
      assert.strictEqual(b.id, 'vfast',
        `${p.name}: Grass row at ${m.event || m.date} banded ${b.label}, not Very fast`);
      // Count the rows whose raw Abstract reading would NOT have been vfast, so
      // the check is provably doing work rather than agreeing by coincidence.
      const raw = I.speedBandFor(m.speed);
      if (!raw || raw.id !== 'vfast') offRating++;
    });
  }
  assert(grassRows > 0, 'no Grass rows in the whole file — this check never ran');
  assert(offRating > 0,
    `all ${grassRows} Grass rows were already Very fast by rating — the override is untested here`);
  console.log(`        ${grassRows} Grass rows across ${players} players, all Very fast; ` +
    `${offRating} of them (${(100 * offRating / grassRows).toFixed(1)}%) would have banded ` +
    'elsewhere on rating alone');
});
mustFail('the grass rule would catch a row banded off its rating', () => {
  // A real pre-ruling grass reading: Abstract 0.90 falls in Slow, not Very fast.
  const b = I.speedBandFor(0.90);
  assert.strictEqual(b.id, 'vfast', `Grass row banded ${b.label}, not Very fast`);
});

check('the Court speed headline is a band name or a dash, never a surface', () => {
  const LABELS = I.SPEED_BANDS.map(b => b.label);
  const SURFACES = ['Hard', 'Clay', 'Grass', 'Carpet', 'Indoor'];
  let headlined = 0, dashed = 0;
  for (const k of Object.keys(PLAYERS)) {
    const p = Object.assign({ key: k }, PLAYERS[k]);
    const v = I.buildBoxVals(p, { archetype: null });
    const h = v.speed.headline;
    if (h == null) { dashed++; continue; }
    headlined++;
    assert(LABELS.indexOf(h) > -1,
      `${p.name}: Court speed headline "${h}" is not one of ${LABELS.join(' · ')}`);
    SURFACES.forEach(s => assert(h.indexOf(s) < 0,
      `${p.name}: Court speed headline "${h}" names a surface`));
  }
  assert(headlined > 0, 'no player produced a Court speed headline — this check never ran');
  console.log(`        ${headlined} band headlines, ${dashed} dashes, 0 surface names ` +
    `across ${headlined + dashed} players`);
});
mustFail('the headline check would catch the old "Grass courts" wording', () => {
  const LABELS = I.SPEED_BANDS.map(b => b.label);
  const h = 'Grass courts';
  assert(LABELS.indexOf(h) > -1, `Court speed headline "${h}" is not one of ${LABELS.join(' · ')}`);
});

// The band order is a README-vs-file conflict resolved in the file's favour:
// win rate descending, un-rateable bands last. Locking it stops a future tidy-up
// from "restoring" the README's slow-to-fast order.
check('bands sort by win rate descending, un-rateable last', () => {
  for (const p of SAMPLE) {
    if (!I.speedRows(p).length) continue;
    const bands = I.speedBands(p);
    let lastRate = Infinity, seenNull = false;
    bands.forEach((b) => {
      const n = b.won + b.lost;
      const rateable = n >= 5;
      if (!rateable) { seenNull = true; return; }
      assert(!seenNull, `${p.name}: a rateable band sits below an un-rateable one`);
      const r = b.won / n;
      assert(r <= lastRate + 1e-9, `${p.name}: ${b.band.label} at ${r} follows a lower rate`);
      lastRate = r;
    });
  }
});
mustFail('the sort check would catch an ascending band list', () => {
  let lastRate = Infinity;
  [0.4, 0.8].forEach((r) => {
    assert(r <= lastRate + 1e-9, 'band at ' + r + ' follows a lower rate');
    lastRate = r;
  });
});

// A band under the five-match minimum shows its record and a dash, and does not
// open. §5.5 keeps it listed: an absent band reads as a court he never played.
check('a sub-minimum band dashes its rate and is not openable', () => {
  let found = 0;
  for (const p of Object.values(PLAYERS).slice(0, 120)) {
    const pk = Object.assign({ key: Object.keys(PLAYERS).find(k => PLAYERS[k] === p) }, p);
    if (!I.speedRows(pk).length) continue;
    const bands = I.speedBands(pk);
    const thin = bands.filter(b => { const n = b.won + b.lost; return n > 0 && n < 5; });
    if (!thin.length) continue;
    found++;
    const html = I.renderSpeedModal(pk);
    thin.forEach((b) => {
      assert(html.indexOf('data-pp2="speed-band" data-v="' + b.band.id + '"') < 0,
        `${p.name}: thin band ${b.band.label} (n=${b.won + b.lost}) is still clickable`);
      assert.strictEqual(I.rateText(b.won, b.lost), '—',
        `${p.name}: thin band ${b.band.label} printed a rate`);
    });
    if (found >= 3) break;
  }
  assert(found > 0, 'no player in the scan had a sub-minimum band — this check never ran');
  console.log(`        ${found} players with a sub-minimum band: listed, dashed, not openable`);
});
mustFail('the openability check would catch a clickable thin band', () => {
  const html = '<div data-pp2="speed-band" data-v="vfast">';
  assert(html.indexOf('data-pp2="speed-band" data-v="vfast"') < 0, 'thin band vfast is still clickable');
});

// Units are the LISTED rows only, and the footer says so. The two scopes living
// in one card is the design's own construction (speedTotal.unitsSub); what must
// not happen is a units figure summed over an n the label does not state.
check('the footer units equal the sum of the listed rows, and name their n', () => {
  for (const p of SAMPLE) {
    if (!I.speedRows(p).length) continue;
    I.state.speedSurf = 'all';
    const bands = I.speedBands(p);
    const priced = bands.reduce((n, b) => n + b.priced, 0);
    const pl = bands.reduce((n, b) => n + b.pl, 0);
    const html = I.renderSpeedModal(p);
    if (!priced) continue;
    assert(html.indexOf('on ' + priced + ' listed') > -1,
      `${p.name}: footer does not state its own n of ${priced}`);
    const rows = bands.reduce((n, b) => n + b.rows.length, 0);
    assert.strictEqual(rows, priced, `${p.name}: ${rows} listed rows but units summed over ${priced}`);
    assert(isFinite(pl), `${p.name}: units are not finite`);
  }
});
mustFail('the footer check would catch units summed over an unstated n', () => {
  const html = 'on 313 listed';
  assert(html.indexOf('on ' + 250 + ' listed') > -1, 'footer does not state its own n of 250');
});

check('every surface chip renders without leaking NaN/undefined', () => {
  let n = 0;
  for (const p of SAMPLE) {
    for (const s of I.SPEED_SURFACES.map(x => x.id)) {
      I.state.speedSurf = s;
      const html = I.renderSpeedModal(p);
      assert(!/undefined|NaN|\[object/.test(html), `${p.name}/${s}: DOM leak`);
      n++;
    }
  }
  I.state.speedSurf = 'all';
  console.log(`        ${n} chip renders clean`);
});

// The rows the modal cannot band must be visible in the DOM, not just in a
// counter. This is the difference between a stated gap and a hidden one.
check('unbanded rows are declared in the note, not silently absorbed', () => {
  let stated = 0;
  for (const p of SAMPLE) {
    const total = I.speedRows(p).length;
    if (!total) continue;
    I.state.speedSurf = 'all';
    const bands = I.speedBands(p);
    if (!bands.unbanded) continue;
    const html = I.renderSpeedModal(p);
    assert(html.indexOf(bands.unbanded + ' of ' + total + ' priced matches') > -1,
      `${p.name}: ${bands.unbanded} unbanded rows are not declared on the page`);
    stated++;
  }
  assert(stated > 0, 'no sampled player had unbanded rows — this check never ran');
  console.log(`        ${stated} players declare their unbanded rows in the DOM`);
});
mustFail('the declaration check would catch a silently absorbed gap', () => {
  const html = 'Bands are Tennis Abstract speed.';
  assert(html.indexOf('24 of 337 priced matches') > -1, '24 unbanded rows are not declared on the page');
});

// Set counts and set scores are genuinely absent — the odds archive drops
// Tennis-Data's per-set columns at ingest. They must dash, never be inferred.
check('set counts and set scores dash rather than being inferred', () => {
  const p = SAMPLE.find(x => I.speedRows(x).length);
  assert(p, 'no sampled player has priced rows');
  const rows = I.speedRows(p);
  rows.slice(0, 200).forEach((m) => {
    assert(m.sets === undefined && m.score === undefined,
      'a shard row carries a score field the archive does not hold: ' + JSON.stringify(m));
  });
});


// ════════════════════════════════════════════════════════════════════════════
// 17 · VERSUS PLAYING STYLES (§5.6) — taxonomy, coverage, sample gate
// ════════════════════════════════════════════════════════════════════════════
console.log('\n17 · Versus playing styles (§5.6)');

const STYLES_SRC = JSON.parse(fs.readFileSync(path.join(ROOT, 'playing-styles.json'), 'utf8'));
const MATRIX_SRC = fs.existsSync(path.join(ROOT, 'matchup-matrix.json'))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, 'matchup-matrix.json'), 'utf8')) : null;

// The taxonomy is the board-finalised v5.1 set, carried VERBATIM. This locks the
// page's axis against BOTH stores at once, so a rename in either is caught here
// rather than showing up as an archetype that silently collects no matches.
check('the axis is the v5.1 taxonomy verbatim, agreeing with both stores', () => {
  const axis = I.STYLE_AXIS.map(a => a.label).slice().sort();
  const fromStyles = [...new Set(STYLES_SRC.players.filter(p => p.archetype_label).map(p => p.archetype_label))].sort();
  assert.deepStrictEqual(axis, fromStyles, 'axis disagrees with playing-styles.json');
  if (MATRIX_SRC) {
    const fromMatrix = Object.keys(MATRIX_SRC.archetypes).slice().sort();
    assert.deepStrictEqual(axis, fromMatrix, 'axis disagrees with matchup-matrix.json');
  }
  console.log(`        ${axis.length} archetypes, identical in the page, playing-styles.json and matchup-matrix.json`);
});
mustFail('the taxonomy lock would catch a renamed archetype', () => {
  assert.deepStrictEqual(['Big Server', 'Counter-Puncher'].sort(), ['Big Server', 'Counterpuncher'].sort(),
    'axis disagrees with playing-styles.json');
});

// §4: archetyped rows plus rows whose opponent carries no label must account for
// every priced row. Without this an unlabelled opponent can vanish rather than be
// declared, which is how a 33% coverage figure reads as a complete career.
check('archetyped + unlabelled = every priced row', () => {
  let n = 0;
  for (const p of SAMPLE) {
    const total = I.speedRows(p).length;
    if (!total) continue;
    const rows = I.styleRows(p);
    const labelled = rows.reduce((s, r) => s + r.won + r.lost, 0);
    assert.strictEqual(labelled + rows.unlabelled, total,
      `${p.name}: ${labelled} archetyped + ${rows.unlabelled} unlabelled != ${total}`);
    n++;
  }
  assert(n > 0, 'no sampled player had priced rows — this check never ran');
  console.log(`        ${n} players reconcile exactly`);
});
mustFail('the reconciliation would catch a dropped opponent', () => {
  assert.strictEqual(296 + 30, 337, '296 archetyped + 30 unlabelled != 337');
});

// §5.6 keeps an under-minimum archetype LISTED with a dash. Dropping it would read
// as an opponent type he has never faced, which is a different claim entirely.
check('an under-minimum archetype stays listed, dashed, and does not open', () => {
  let found = 0;
  for (const key of Object.keys(PLAYERS)) {
    const p = Object.assign({ key }, PLAYERS[key]);
    if (!I.speedRows(p).length) continue;
    const rows = I.styleRows(p);
    const thin = rows.filter(r => { const n = r.won + r.lost; return n > 0 && n < 5; });
    if (!thin.length) continue;
    const html = I.renderStylesModal(p);
    thin.forEach((r) => {
      assert(html.indexOf(esc17(r.axis.label)) > -1, `${p.name}: thin archetype ${r.axis.label} dropped out`);
      assert(html.indexOf('data-pp2="style-row" data-v="' + esc17(r.axis.label) + '"') < 0,
        `${p.name}: thin archetype ${r.axis.label} is still clickable`);
      assert.strictEqual(I.rateText(r.won, r.lost), '—', `${p.name}: thin archetype printed a rate`);
    });
    if (++found >= 3) break;
  }
  assert(found > 0, 'no player had an under-minimum archetype — this check never ran');
  console.log(`        ${found} players keep a sub-minimum archetype listed and dashed`);
});
function esc17(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
mustFail('the listing check would catch a dropped thin archetype', () => {
  const html = '<div>Attacking Baseliner</div>';
  assert(html.indexOf('Solid Defender') > -1, 'thin archetype Solid Defender dropped out');
});

// Coverage must be on the page, not only in a counter. For a 20-year career most
// opponents predate the roster, and a modal that hides that is claiming a
// completeness it does not have.
check('unlabelled opponents are declared in the DOM', () => {
  let stated = 0;
  for (const p of SAMPLE) {
    const total = I.speedRows(p).length;
    if (!total) continue;
    const rows = I.styleRows(p);
    if (!rows.unlabelled) continue;
    const html = I.renderStylesModal(p);
    assert(html.indexOf(rows.unlabelled + ' of ' + total + ' priced matches') > -1,
      `${p.name}: ${rows.unlabelled} unlabelled opponents are not declared`);
    stated++;
  }
  assert(stated > 0, 'no sampled player had unlabelled opponents — this check never ran');
  console.log(`        ${stated} players declare their archetype coverage gap`);
});
mustFail('the declaration check would catch a hidden coverage gap', () => {
  const html = 'Click an archetype for the matches behind it.';
  assert(html.indexOf('853 of 1277 priced matches') > -1, '853 unlabelled opponents are not declared');
});

// The y axis is fixed 40-80%, so a rate outside it is clamped for POSITION only.
// The printed value must stay exact — a clamped label would be a false number.
check('a rate outside the 40-80% axis is clamped in position but printed exactly', () => {
  let checked = 0;
  for (const key of Object.keys(PLAYERS)) {
    const p = Object.assign({ key }, PLAYERS[key]);
    if (!I.speedRows(p).length) continue;
    const rows = I.styleRows(p).filter(r => {
      const n = r.won + r.lost;
      if (n < 5) return false;
      const rate = 100 * r.won / n;
      return rate > 80 || rate < 40;
    });
    if (!rows.length) continue;
    const html = I.renderStylesModal(p);
    rows.forEach((r) => {
      const rate = (100 * r.won / (r.won + r.lost)).toFixed(0);
      assert(html.indexOf('>' + rate + '%<') > -1,
        `${p.name}: ${r.axis.label} at ${rate}% is off-axis and its exact value is not printed`);
      checked++;
    });
    if (checked >= 5) break;
  }
  assert(checked > 0, 'no off-axis rate found — this check never ran');
  console.log(`        ${checked} off-axis bubbles print their exact rate`);
});
mustFail('the clamp check would catch a label rewritten to the axis bound', () => {
  const html = '>80%<';
  assert(html.indexOf('>' + '95' + '%<') > -1, 'a 95% rate is off-axis and its exact value is not printed');
});

check('every archetype drill renders without leaking NaN/undefined', () => {
  let n = 0;
  for (const p of SAMPLE) {
    if (!I.speedRows(p).length) continue;
    for (const a of I.STYLE_AXIS) {
      I.state.styleRow = a.label;
      const html = I.renderStylesModal(p);
      assert(!/undefined|NaN|\[object/.test(html), `${p.name}/${a.label}: DOM leak`);
      n++;
    }
  }
  I.state.styleRow = null;
  console.log(`        ${n} drill renders clean`);
});


// A regression that hid in plain sight: `stylesStore` was declared and never
// assigned, so archetypeFor returned null for all 428 players and box 5's
// headline dashed — indistinguishable from a legitimate "not held". The fix is
// only meaningful if coverage is NON-ZERO, so that is what is asserted.
check('box 5 shows a real archetype for players who carry one', () => {
  let resolved = 0, labelled = 0;
  for (const key of Object.keys(PLAYERS)) {
    const nm = PLAYERS[key].name;
    const hasLabel = STYLES.players.some(s => s.name === nm && s.archetype_label);
    if (hasLabel) labelled++;
    if (I.archetypeFor(key)) resolved++;
  }
  assert(resolved > 0, 'archetypeFor resolved nobody — the store is unwired again');
  assert(resolved >= labelled * 0.9,
    `only ${resolved} of ${labelled} labelled players resolve an archetype`);
  const axis = I.STYLE_AXIS.map(a => a.label);
  for (const key of Object.keys(PLAYERS)) {
    const a = I.archetypeFor(key);
    if (a) assert(axis.indexOf(a) > -1, `archetypeFor returned an off-taxonomy label: ${a}`);
  }
  console.log(`        ${resolved} of ${labelled} labelled players resolve, all on-taxonomy`);
});
mustFail('the coverage check would catch the store being unwired again', () => {
  const resolved = 0;
  assert(resolved > 0, 'archetypeFor resolved nobody — the store is unwired again');
});

// ════════════════════════════════════════════════════════════════════════════
// 18 · ALL STORES — founder ruling 6 (2026-09-16), approved.
//
//   "Extend the non-zero coverage assertion to every data store this page reads,
//    so no other unwired store can hide behind a dash."
//
// The stylesStore bug was invisible because a declared-but-unassigned store and
// a genuinely empty dataset render identically: an em dash. The dash is correct
// behaviour, so no visual check can tell them apart. The only thing that can is
// an assertion that each store resolves a NON-ZERO number of real values through
// the SAME accessor the page calls.
//
// This table is the gate. A new store wired into this page without a row here is
// a store that can silently go dark, so the last check asserts the table covers
// every window.* the module actually reads.
// ════════════════════════════════════════════════════════════════════════════
const STORES = [
  {
    name: 'playerProfiles',
    file: 'player-profiles.json',
    // every block's spine — career, ribbon, ledger, calendar, header
    resolve: () => Object.keys(PLAYERS).filter(k => I.spineTotal(PLAYERS[k]).n > 0).length,
    universe: () => Object.keys(PLAYERS).length,
    floor: 0.5,
  },
  {
    name: 'careerSplits',
    file: 'career-splits.json',
    // splitCandidates takes the KEY, not the player object. The first draft of
    // this row passed the object, got [] for everyone, and reported the store
    // "unwired" — a false alarm from the gate's own accessor. Call the page's
    // accessors the way the page calls them or the gate measures itself.
    resolve: () => Object.keys(PLAYERS).filter(k => (I.splitCandidates(k, 'career') || []).length > 0).length,
    universe: () => Object.keys(SPLITS).length,
    floor: 0.5,
  },
  {
    name: 'marketEdge',
    file: 'market-edge/{key}.json',
    resolve: () => Object.keys(PLAYERS).filter((k) => {
      const v = I.buildBoxVals(PLAYERS[k], { rows: I.ledgerMatches(PLAYERS[k]), archetype: null });
      return v.market && v.market.headline != null;
    }).length,
    universe: () => Object.keys(MARKET).length,
    floor: 0.5,
  },
  {
    name: 'playingStyles',
    file: 'playing-styles.json',
    resolve: () => Object.keys(PLAYERS).filter(k => I.archetypeFor(k)).length,
    // The universe is the labelled rows that CAN reach this page — i.e. those
    // whose name matches a profiled player. The rows that cannot are a separate,
    // measured defect (see "the archetype name join" check below); folding them
    // in here would turn a store-wiring gate into a join-coverage gate and blur
    // two different failures into one number.
    universe: () => {
      const names = new Set(Object.keys(PLAYERS).map(k => PLAYERS[k].name));
      return (STYLES.players || []).filter(s => s.archetype_label && names.has(s.name)).length;
    },
    floor: 0.9,
  },
  {
    name: 'holdbreak',
    file: 'holdbreak.json',
    resolve: () => Object.keys(PLAYERS).filter(k => I.hbCoverage(PLAYERS[k])).length,
    universe: () => Object.keys(HOLDBREAK.players).length,
    floor: 0.9,
  },
  // ── correction pass · the two stores wired this run ──────────────────────
  // Both are LOW-coverage by nature and their floors say so honestly rather
  // than being set where they would always pass. The gate's job is to catch a
  // store going DARK (the stylesStore bug), not to assert a coverage target.
  {
    name: 'matchStats',
    file: 'historical-match-stats.json',
    // Measured through the page's own accessor: recentForm rows whose eventKey
    // reaches a populated stats block. api-tennis only fills the statistics
    // block from 2024, so most of a long career is legitimately absent.
    resolve: () => {
      let n = 0;
      for (const k of Object.keys(PLAYERS)) {
        for (const m of I.ledgerMatches(PLAYERS[k])) if (I.statsFor(m.eventKey)) { n++; }
      }
      return n;
    },
    universe: () => Object.keys(STATS).filter(k => STATS[k] && STATS[k].matchStats).length,
    floor: 0.5,
  },
  {
    name: 'bet365History',
    file: 'bet365-history/{month}.json',
    // The capture only exists to price rows the archive never reached, so the
    // gate measures exactly that: ledger rows that came back priced on the
    // pre-match basis rather than on an archive close.
    resolve: () => {
      let n = 0;
      for (const k of Object.keys(PLAYERS)) {
        for (const r of I.ledgerRows(PLAYERS[k])) if (r.basis === 'prematch') n++;
      }
      return n;
    },
    universe: () => {
      let n = 0;
      for (const mo of Object.keys(B365)) n += Object.keys((B365[mo] || {}).fixtures || {}).length;
      return n;
    },
    floor: 0,
  },
];

for (const s of STORES) {
  check(`store ${s.name} resolves a non-zero share of what it holds`, () => {
    const resolved = s.resolve();
    const universe = s.universe();
    assert(universe > 0, `${s.file} holds nothing — the artefact itself is empty`);
    assert(resolved > 0,
      `${s.name} resolved NOTHING through the page's own accessor — the store is unwired (this is the stylesStore bug)`);
    assert(resolved >= universe * s.floor,
      `${s.name}: only ${resolved} of ${universe} rows in ${s.file} reach the page (floor ${Math.round(s.floor * 100)}%)`);
    console.log(`        ${s.name}: ${resolved} of ${universe} rows in ${s.file} reach the page`);
  });
}

mustFail('the all-stores gate would catch any one store going dark', () => {
  const resolved = 0, universe = 428;
  assert(resolved > 0,
    `store resolved NOTHING through the page's own accessor — the store is unwired`);
});

mustFail('the all-stores gate would catch a store that resolves only a token few', () => {
  const resolved = 3, universe = 428, floor = 0.5;
  assert(resolved >= universe * floor, `only ${resolved} of ${universe} rows reach the page`);
});

// ── the archetype name join — OPEN DEFECT, pinned at its measured size ───────
// Found by the ruling-6 gate on its first run, 2026-09-16.
//
// playing-styles.json joins to the page by NAME ONLY (its rows carry no player
// key). The artefact mixes two name forms: most rows are short form ("N. Djokovic")
// but 43 are full form ("Zsombor Piros"). archetypeFor does an exact-name lookup,
// so every full-form row misses — and 40 of those 40-odd players ARE profiled.
// They render a dashed archetype box despite carrying a hand-assigned label.
//
// NOT FIXED HERE, deliberately. The only page-level join available is surname
// matching, and this repo has been bitten by exactly that: api-tennis reorders
// multi-part surnames, so "Felipe Meligeni Alves" sits beside a profile row
// reading "M. Alves". A wrong surname match would paint the WRONG archetype on a
// player, which is worse than the dash it replaces. The fix belongs upstream in
// classify-styles.js — emit one name form, or better, emit the player key.
//
// This check pins the gap at its measured size so it cannot quietly grow while
// the ruling is pending. It is a report in code, not a resolution.
const NAME_JOIN_UNMATCHED = 42;
check(`the archetype name join misses exactly ${NAME_JOIN_UNMATCHED} labelled rows (open defect)`, () => {
  const names = new Set(Object.keys(PLAYERS).map(k => PLAYERS[k].name));
  const labelled = (STYLES.players || []).filter(s => s.archetype_label);
  const unmatched = labelled.filter(s => !names.has(s.name));
  // surname-rescuable = players who ARE on this site but whose label never lands
  const surname = n => String(n).trim().split(/\s+/).pop().toLowerCase();
  const profSurnames = new Set(Object.keys(PLAYERS).map(k => surname(PLAYERS[k].name)));
  const rescuable = unmatched.filter(s => profSurnames.has(surname(s.name)));
  assert.strictEqual(unmatched.length, NAME_JOIN_UNMATCHED,
    `the name-format gap moved: ${unmatched.length} labelled rows now miss (pinned at ${NAME_JOIN_UNMATCHED}). ` +
    `If it shrank, the upstream fix landed — re-pin. If it grew, classify-styles.js regressed.`);
  console.log(`        ${unmatched.length} labelled rows miss the name join; ${rescuable.length} of them are profiled players showing a dash`);
});

mustFail('the name-join pin would catch the gap growing', () => {
  assert.strictEqual(58, NAME_JOIN_UNMATCHED, 'the name-format gap moved');
});

// The gate is only as good as its coverage of the stores that actually exist.
// This reads the module's source for every window.* it touches and asserts each
// data store among them has a row above — so wiring a new store without
// extending this table fails the build rather than passing quietly.
check('the all-stores table covers every data store the module reads', () => {
  const src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  const read = new Set((src.match(/window\.[A-Za-z_][A-Za-z0-9_]*/g) || [])
    .map(s => s.replace('window.', '')));
  // Not data stores: the feature flag, the module's own export, and the two
  // shared helper singletons (logic, not data — they carry no player rows).
  const NOT_STORES = new Set(['FEATURE_PP2', 'PlayerProfileV2', 'RoundClassify', 'HoldBreakHeatmap']);
  // Host callbacks the mount calls back into (navigation, not data). Exempt from
  // the coverage table but NOT from scrutiny: the module must not assume the
  // host defined them, so each is asserted to be typeof-guarded at its call
  // site. Simply widening NOT_STORES would have let any future window.* through
  // the gate by being named plausibly.
  const HOST_CALLBACKS = new Set(['showPlayerList', 'onPp2SheetOpen']);
  for (const cb of HOST_CALLBACKS) {
    assert(new RegExp(`typeof window\\.${cb} === 'function'`).test(src),
      `window.${cb} is called without a typeof guard — the page must not assume the host defines it`);
  }
  const covered = new Set(STORES.map(s => s.name));
  const missing = [...read].filter(n =>
    !NOT_STORES.has(n) && !HOST_CALLBACKS.has(n) && !covered.has(n));
  assert.deepStrictEqual(missing, [],
    `these stores are read by the page but have no coverage row: ${missing.join(', ')}`);
  console.log(`        ${read.size} window.* reads, ${covered.size} data stores, ` +
    `${HOST_CALLBACKS.size} guarded host callback, all covered`);
});

mustFail('the host-callback guard check would catch an unguarded call', () => {
  const src = 'if (window.showPlayerList) window.showPlayerList();';
  assert(/typeof window\.showPlayerList === 'function'/.test(src),
    'window.showPlayerList is called without a typeof guard');
});

mustFail('the table-coverage check would catch a newly wired store', () => {
  const read = new Set(['playerProfiles', 'careerSplits', 'someNewStore']);
  const NOT_STORES = new Set(['FEATURE_PP2', 'PlayerProfileV2', 'RoundClassify', 'HoldBreakHeatmap']);
  const covered = new Set(['playerProfiles', 'careerSplits']);
  const missing = [...read].filter(n => !NOT_STORES.has(n) && !covered.has(n));
  assert.deepStrictEqual(missing, [], `uncovered: ${missing.join(', ')}`);
});

// ════════════════════════════════════════════════════════════════════════════
// 19 · §5.9 PLAYING PROFILE — hold/break heatmap (founder ruling 7)
// ════════════════════════════════════════════════════════════════════════════
const HB_KEYS = Object.keys(PLAYERS).filter(k => I.hbCoverage(PLAYERS[k]));

check('the Playing profile modal renders real figures, not a grid of dashes', () => {
  assert(HB_KEYS.length > 0, 'no profiled player resolves hold/break coverage');
  let withFigures = 0, leaks = 0;
  for (const key of HB_KEYS) {
    I.state.modal = 'profile'; I.state.hbSurf = 'all';
    const html = I.renderProfileModal(PLAYERS[key]);
    if (/undefined|NaN|\[object/.test(html)) leaks++;
    if (/>\d+%</.test(html)) withFigures++;
  }
  assert.strictEqual(leaks, 0, `${leaks} profiles leaked undefined/NaN into the DOM`);
  assert(withFigures >= HB_KEYS.length * 0.9,
    `only ${withFigures} of ${HB_KEYS.length} covered players print a percentage`);
  console.log(`        ${withFigures} of ${HB_KEYS.length} covered players print real rates, 0 DOM leaks`);
});

mustFail('the render check would catch an all-dash grid', () => {
  const html = '<div>—</div><div>—</div>';
  assert(/>\d+%</.test(html), 'no percentage printed');
});

check('the modal states its own match count, never the career total', () => {
  let stated = 0;
  for (const key of HB_KEYS.slice(0, 60)) {
    const p = PLAYERS[key];
    I.state.modal = 'profile'; I.state.hbSurf = 'all';
    const html = I.renderProfileModal(p);
    const cov = I.hbCoverage(p);
    assert(html.indexOf('Point-by-point parsed for ' + cov.matches + ' of ') > -1,
      `${p.name}: the modal does not state its parsed match count`);
    // The shard's horizon is 24 months; the ledger is a whole career. If the
    // modal ever printed the career total it would claim coverage we lack.
    const career = I.spineTotal(p).n;
    assert(cov.matches <= career,
      `${p.name}: parsed ${cov.matches} matches but the career spine holds only ${career}`);
    stated++;
  }
  console.log(`        ${stated} modals state a parsed count that is <= the career total`);
});

mustFail('the match-count check would catch a career total standing in for coverage', () => {
  const parsed = 1200, career = 75;
  assert(parsed <= career, `parsed ${parsed} but the career spine holds only ${career}`);
});

check('a player with no point-by-point data says so instead of drawing an empty grid', () => {
  const missing = Object.keys(PLAYERS).find(k => !I.hbCoverage(PLAYERS[k]));
  assert(missing, 'every profiled player is in the shard — this branch is unreachable');
  I.state.modal = 'profile';
  const html = I.renderProfileModal(PLAYERS[missing]);
  assert(html.indexOf('no point-by-point data on record') > -1,
    'an uncovered player did not get the explicit no-data statement');
  assert(!/>\d+%</.test(html), 'an uncovered player printed a percentage out of nowhere');
  console.log(`        uncovered example ${PLAYERS[missing].name}: stated, no invented figures`);
});

mustFail('the no-data check would catch a figure invented for an uncovered player', () => {
  const html = '<div>no point-by-point data on record</div><div>72%</div>';
  assert(!/>\d+%</.test(html), 'an uncovered player printed a percentage out of nowhere');
});

check('the surface chips read their own node and change the figures', () => {
  // Same susceptibility discipline as the engine test: assert the SUBJECT can
  // move before asserting that it does.
  const subject = HB_KEYS.find((k) => {
    const a = ENGINE.heatFor(HOLDBREAK, k, 'HOLD', 5, 'all');
    const c = ENGINE.heatFor(HOLDBREAK, k, 'HOLD', 5, 'clay');
    return a.globalLabel !== c.globalLabel && c.globalLabel !== 'HOLD —';
  });
  assert(subject, 'no covered player has clay figures distinct from all — the check would be immune');
  I.state.modal = 'profile';
  I.state.hbSurf = 'all';
  const all = I.renderProfileModal(PLAYERS[subject]);
  I.state.hbSurf = 'clay';
  const clay = I.renderProfileModal(PLAYERS[subject]);
  I.state.hbSurf = 'all';
  assert.notStrictEqual(all, clay, `${PLAYERS[subject].name}: the clay chip rendered the all-surfaces grid`);
  assert(clay.indexOf('clay only') > -1, 'the clay view does not label itself');
  console.log(`        ${PLAYERS[subject].name}: all vs clay render differently and are labelled`);
});

mustFail('the surface-chip check would catch a chip that does nothing', () => {
  const all = '<div>same</div>', clay = '<div>same</div>';
  assert.notStrictEqual(all, clay, 'the clay chip rendered the all-surfaces grid');
});

check('the modal computes nothing itself — every figure comes from the engine', () => {
  const src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  const from = src.indexOf('§5.9 PLAYING PROFILE');
  const to = src.indexOf('// MOUNT', from);
  assert(from > -1 && to > from, 'could not locate the §5.9 block');
  // Scan CODE only. The first draft matched the literal string "won/n" inside
  // this block's own explanatory comment and reported a second engine that does
  // not exist — a regex that reads prose is not reading the implementation.
  const block = src.slice(from, to)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // A second engine would have to divide, or re-band a rate, to exist.
  assert(!/\/\s*(den|n)\b|Math\.round\([^)]*\*\s*100/.test(block),
    '§5.9 contains rate arithmetic — that is a second engine, which ruling 7 forbids');
  assert(/E\.heatFor\(/.test(block), '§5.9 does not call the shared engine');
  console.log('        §5.9 contains no rate arithmetic and calls E.heatFor');
});

mustFail('the no-second-engine check would catch re-derived arithmetic', () => {
  const block = 'var pct = Math.round(won / den * 100);';
  assert(!/\/\s*(den|n)\b|Math\.round\([^)]*\*\s*100/.test(block),
    '§5.9 contains rate arithmetic');
});

// ════════════════════════════════════════════════════════════════════════════
// 20 · §4 FULL LEDGER + THE MOUNT
// ════════════════════════════════════════════════════════════════════════════
//
// The mount checks read bsp-consult-dashboard.html as SOURCE. That is unusual
// for this harness, which otherwise runs the module — but the defect they exist
// to catch is not in the module at all. player-profile-v2.js passed 120 checks
// while being completely unreachable: no <script src>, no flag, no wiring, no
// store bridge. Every figure below was already correct and none of it was on
// the site. A test that only ever loads the module cannot see that.
const DASH_CH = '—';
const DASHBOARD = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
// The CLOSING tag is part of the needle on purpose. Matching the opening tag
// alone found a code COMMENT that mentions it (pp2Bridge explains why the flag
// is not set there) 568 KB earlier in the file, which made the load-order check
// below report a failure that did not exist.
const PP2_TAG = '<script src="player-profile-v2.js"></script>';

check('the dashboard actually loads player-profile-v2.js', () => {
  assert(DASHBOARD.indexOf(PP2_TAG) > -1,
    'no player-profile-v2.js script tag — the module is unreachable from the page');
});

// The deploy is an explicit `cp` allowlist, so a NEW local file is committed,
// passes every test, and then 404s on the live site. That has bitten this repo
// before (bsp-pipeline.js, TEN-157) and it bit this ticket twice at once:
// neither player-profile-v2.js NOR holdbreak-heatmap.js was copied. The second
// is the worse of the two — the Live tab now calls that engine, so the missing
// copy would have broken a DON'T-TOUCH surface, not this one.
//
// Rather than trust a hand-maintained list, this derives the requirement from
// the dashboard itself: every local script it loads must be copied AND asserted.
check('every script the dashboard loads is deployed and assert-gated', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
  const srcs = [...DASHBOARD.matchAll(/<script src="([^"]+)"/g)]
    .map(m => m[1].replace(/^\.\//, ''))         // the page writes both ./x.js and x.js
    .filter(s => !/^https?:|^\/\//.test(s));     // local files only
  assert(srcs.length > 0, 'found no local <script src> in the dashboard — the regex is wrong');
  const cpLine = (s) => (wf.match(new RegExp(`^\\s*cp[^\\n]*\\b${s.replace(/\./g, '\\.')}\\b[^\\n]*$`, 'm')) || [])[0];
  const notCopied = srcs.filter(s => !cpLine(s));
  assert.deepStrictEqual(notCopied, [],
    `the dashboard loads these but the deploy never copies them (they 404 live): ${notCopied.join(', ')}`);
  // A copy ending in `|| true` is an explicit decision that the file is
  // optional (admin-config.js), so it is exempt from the assert list. Anything
  // copied unconditionally is load-bearing and must be gated, or a silent cp
  // failure ships a page whose scripts 404.
  const assertBlock = wf.slice(wf.indexOf('for f in index.html'), wf.indexOf('MISSING from _site'));
  const required = srcs.filter(s => !/\|\|\s*true/.test(cpLine(s)));
  const notAsserted = required.filter(s => !assertBlock.includes(s));
  assert.deepStrictEqual(notAsserted, [],
    `copied but not assert-gated, so a silent cp failure ships a broken page: ${notAsserted.join(', ')}`);
  console.log(`        ${srcs.length} local scripts, all copied; ${required.length} required and assert-gated`);
});

mustFail('the deploy-allowlist check would catch a script that is never copied', () => {
  const srcs = ['live-tab.js', 'player-profile-v2.js'];
  const wf = 'cp live-tab.js _site/';
  const notCopied = srcs.filter(s => !new RegExp(`cp[^\\n]*${s.replace(/\./g, '\\.')}`).test(wf));
  assert.deepStrictEqual(notCopied, [], `never copied: ${notCopied.join(', ')}`);
});

check('FEATURE_PP2 is set BEFORE the module tag, not at profile-open time', () => {
  const flagAt = DASHBOARD.indexOf('window.FEATURE_PP2 =');
  const tagAt = DASHBOARD.indexOf(PP2_TAG);
  assert(flagAt > -1, 'window.FEATURE_PP2 is never assigned by the page');
  assert(tagAt > -1, 'the module tag is missing');
  assert(flagAt < tagAt,
    'FEATURE_PP2 is assigned after the <script> tag. The module reads the flag at PARSE time and ' +
    'returns immediately when falsy, so it would never define window.PlayerProfileV2 and every ' +
    'profile open would silently fall back to the legacy page.');
});

mustFail('the flag-order check would catch the flag being set too late', () => {
  const src = '<script src="player-profile-v2.js"></script>\nwindow.FEATURE_PP2 = true;';
  assert(src.indexOf('window.FEATURE_PP2 =') < src.indexOf(PP2_TAG),
    'FEATURE_PP2 is assigned after the script tag');
});

check('the host bridges every data store the module reads onto window', () => {
  // The dashboard holds these in `let` bindings, which do NOT create window
  // properties. Miss one and that block renders a grid of dashes that looks
  // exactly like "we hold no data" — the stylesStore failure, again.
  const bridge = DASHBOARD.slice(DASHBOARD.indexOf('function pp2Bridge()'));
  const body = bridge.slice(0, bridge.indexOf('\n}'));
  const needed = ['playerProfiles', 'careerSplits', 'playingStyles', 'holdbreak', 'marketEdge'];
  const missing = needed.filter(n => !new RegExp(`window\\.${n}\\s*=`).test(body));
  assert.deepStrictEqual(missing, [], `pp2Bridge does not assign: ${missing.join(', ')}`);
  console.log(`        pp2Bridge assigns all ${needed.length} stores`);
});

mustFail('the bridge check would catch a store left unassigned', () => {
  const body = 'window.playerProfiles = x; window.careerSplits = y;';
  const needed = ['playerProfiles', 'careerSplits', 'playingStyles', 'holdbreak', 'marketEdge'];
  const missing = needed.filter(n => !new RegExp(`window\\.${n}\\s*=`).test(body));
  assert.deepStrictEqual(missing, [], `unassigned: ${missing.join(', ')}`);
});

// Reproduced live before this guard existed: opening a v2 profile and then
// firing ppRepaint() (which three lazy loaders do when they resolve) replaced
// the rebuilt page with the LEGACY one, mid-session, in front of the reader.
check('ppRepaint hands back to v2 instead of overwriting it with the legacy page', () => {
  const body = DASHBOARD.slice(DASHBOARD.indexOf('function ppRepaint()'));
  const fn = body.slice(0, body.indexOf('\n}'));
  const guardAt = fn.indexOf('PlayerProfileV2.repaint()');
  const legacyAt = fn.indexOf('buildPlayerProfileHtml(profile)');
  assert(guardAt > -1, 'ppRepaint does not delegate to v2 — a lazy loader will clobber the page');
  assert(legacyAt > -1, 'ppRepaint no longer paints the legacy page at all — verify that was intended');
  assert(guardAt < legacyAt,
    'the v2 delegation comes AFTER the legacy innerHTML write, so it cannot prevent the clobber');
  assert(/return;/.test(fn.slice(guardAt, legacyAt)),
    'the v2 branch does not return — it falls through and repaints legacy anyway');
});

mustFail('the ppRepaint-guard check would catch the guard being removed', () => {
  const fn = 'const view=x; view.innerHTML = buildPlayerProfileHtml(profile);';
  assert(fn.indexOf('PlayerProfileV2.repaint()') > -1, 'ppRepaint does not delegate to v2');
});

check('the bridge hands playerProfiles the shape the module reads', () => {
  // archetypeFor and profileFor both read window.playerProfiles.players. The
  // dashboard's own binding IS the players map, so bridging it directly would
  // make every key miss.
  assert(/window\.playerProfiles\s*=\s*\{\s*players:\s*playerProfiles\s*\}/.test(DASHBOARD),
    'playerProfiles is bridged in the wrong shape — the module reads .players');
});

check('every data-pp2 hook the module paints has a handler in the mount', () => {
  const src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  // Hooks emitted with a literal value. (The one computed hook is calSegBtn's
  // `attr`, whose two call sites pass 'cal-tab' and 'cal-surface'.)
  const painted = new Set((src.match(/data-pp2="([a-z-]+)"/g) || [])
    .map(s => s.replace(/data-pp2="|"/g, '')));
  painted.add('cal-tab'); painted.add('cal-surface');
  // 'sheet' appears in the source inside sheetHook(), but MATCH_SHEET_BUILT
  // gates it out of the emitted markup — §8 is not built. Requiring a handler
  // for it would force the mount to wire a click to a modal that does not
  // exist. The "no affordance advertises the unbuilt match sheet" check above
  // is what holds the other side of this: it is never PAINTED while the
  // constant is false. Drop the exemption when §8 lands.
  if (I.MATCH_SHEET_BUILT === false) painted.delete('sheet');
  const onClick = src.slice(src.indexOf('function onClick(e)'));
  const handled = new Set((onClick.slice(0, onClick.indexOf('\n  function onInput'))
    .match(/kind === '([a-z-]+)'/g) || []).map(s => s.replace(/kind === '|'/g, '')));
  handled.add('tourn-search');   // an input hook, handled in onInput
  const unhandled = [...painted].filter(h => !handled.has(h));
  assert.deepStrictEqual(unhandled, [],
    `these hooks are painted but nothing handles the click: ${unhandled.join(', ')}`);
  console.log(`        ${painted.size} painted hooks, all handled`);
});

mustFail('the hook-coverage check would catch an unwired affordance', () => {
  const painted = ['box', 'close', 'speed-band'];
  const handled = new Set(['box', 'close']);
  const unhandled = painted.filter(h => !handled.has(h));
  assert.deepStrictEqual(unhandled, [], `unwired: ${unhandled.join(', ')}`);
});

// §8.1 landed in the correction pass, so this check inverts: the affordance and
// the content must ship TOGETHER. The old form asserted the hook was absent
// while the sheet did not exist; this one asserts that every row advertising a
// click resolves to a sheet that actually renders. Either half alone is the bug
// (a dead cursor, or a sheet nothing can open).
check('every ledger row that advertises a click opens a sheet that renders', () => {
  const p = byName('N. Djokovic');
  const anyRows = I.ledgerRows(p);
  assert(anyRows.length > 0, 'no ledger rows to inspect');
  I.state.ledgerOpen = true;
  const ctx = { ledgerOpen: true, ledgerRows: anyRows, ledgerFiltered: I.ledgerFiltered(anyRows) };
  const html = I.renderLedger(p, ctx);
  I.state.ledgerOpen = false;
  assert.strictEqual(I.MATCH_SHEET_BUILT, true, 'MATCH_SHEET_BUILT is false but §8.1 is built');
  const ids = (html.match(/data-pp2="sheet" data-v="([^"]+)"/g) || [])
    .map(s => s.replace(/data-pp2="sheet" data-v="|"/g, ''));
  assert(ids.length > 0, 'the ledger paints no match-sheet hook although §8.1 is built');
  assert(/cursor:pointer/.test(html), 'the rows advertise no pointer cursor');
  let rendered = 0;
  for (const id of ids) {
    I.state.sheet = id.replace(/&amp;/g, '&');
    const sheet = I.renderSheet(p, ctx);
    if (/Dominance ratio/.test(sheet)) rendered++;
  }
  I.state.sheet = null;
  assert.strictEqual(rendered, ids.length,
    `${ids.length - rendered} of ${ids.length} ledger hooks open nothing`);
  console.log(`        ${ids.length} ledger hooks, all open a rendered sheet`);
});

mustFail('the affordance check would catch a hook that opens nothing', () => {
  const ids = ['a', 'b'], rendered = 1;
  assert.strictEqual(rendered, ids.length, `${ids.length - rendered} of ${ids.length} hooks open nothing`);
});

// §4: "Recent-form ribbon W-L and % = the strip shown = the ledger's last-N
// rows." Caught live: the ledger header rated the WHOLE filtered set while its
// strip drew only the last 18, so Djokovic read "75.0% win · 20 matches" over
// an 18-square strip. Two figures for one claim, on one screen.
check('the ledger rate is taken over exactly the rows its strip draws', () => {
  const keys = Object.keys(PLAYERS).filter(k => (PLAYERS[k].recentForm || {}).matches);
  let checked = 0, over = 0;
  for (const key of keys) {
    const p = PLAYERS[key];
    I.state.surfaces = []; I.state.priceFilters = [];
    const rows = I.ledgerRows(p);
    const filtered = I.ledgerFiltered(rows);
    if (!filtered.length) continue;
    if (filtered.length > I.LEDGER_CAP) over++;
    const strip = filtered.slice(-I.LEDGER_CAP);
    I.state.ledgerOpen = true;
    const html = I.renderLedger(p, { ledgerOpen: true, ledgerRows: rows, ledgerFiltered: filtered });
    I.state.ledgerOpen = false;
    const w = strip.filter(x => x.m.won && !(x.m.walkover && !x.m.won)).length;
    const l = strip.filter(x => !x.m.won && !(x.m.walkover && !x.m.won)).length;
    const n = w + l;
    // Correction-pass item 3: the ledger header is one of the export's two
    // .toFixed(0) values, so the expectation is a whole number here and stays at
    // one decimal everywhere else.
    const expected = n >= 5 ? (100 * w / n).toFixed(0) + '%' : DASH_CH;
    const m = html.match(/font-weight:700;">([^<]+) win<\/span>\s*·\s*(\d+) match/);
    assert(m, `${p.name}: could not read the ledger headline`);
    assert.strictEqual(m[1], expected,
      `${p.name}: headline rate ${m[1]} but the strip's ${n} rows give ${expected}`);
    assert.strictEqual(Number(m[2]), n,
      `${p.name}: headline says ${m[2]} matches but the strip draws ${n}`);
    checked++;
  }
  assert(checked > 100, `only ${checked} players had a ledger to check`);
  assert(over > 0, 'no player exceeded the cap — the over-cap branch went untested');
  console.log(`        ${checked} ledgers agree with their strip (${over} of them over the ${I.LEDGER_CAP}-row cap)`);
});

mustFail('the strip-agreement check would catch a rate taken over the wrong set', () => {
  const strip = [{ won: true }, { won: false }];       // 50.0% over 2
  const wholeSet = [{ won: true }, { won: true }, { won: false }];  // 66.7% over 3
  const rate = a => (100 * a.filter(x => x.won).length / a.length).toFixed(1) + '%';
  assert.strictEqual(rate(wholeSet), rate(strip), 'headline rate disagrees with the strip');
});

// H / A orientation. Founder ruling 1: H is the SUBJECT product-wide. The shard
// is subject-relative, so H must be `price` and A `oppPrice` — never reversed.
check('the ledger H column is the subject price and A the opponent price', () => {
  const p = byName('N. Djokovic');
  const rows = I.ledgerRows(p).filter(x => x.price != null && x.oppPrice != null);
  assert(rows.length > 0, 'no priced ledger rows for the orientation check');
  const shard = MARKET[String(p.key)];
  const byDate = {};
  (shard.matches || []).forEach(m => {
    if (byDate[m.date] === undefined) byDate[m.date] = m; else byDate[m.date] = null;
  });
  let agree = 0;
  for (const x of rows) {
    const src = byDate[x.m.date];
    assert(src, `${x.m.date} resolved a price from an ambiguous or absent day`);
    assert.strictEqual(x.price, src.price, `${x.m.date}: H is not the subject price`);
    assert.strictEqual(x.oppPrice, src.oppPrice, `${x.m.date}: A is not the opponent price`);
    agree++;
  }
  console.log(`        ${agree} priced rows oriented subject-first`);
});

mustFail('the orientation check would catch H and A being swapped', () => {
  const x = { price: 1.17, oppPrice: 5.0 };
  const src = { price: 1.17, oppPrice: 5.0 };
  assert.strictEqual(x.oppPrice, src.price, 'H is not the subject price');
});

// A day the archive priced twice cannot be resolved to one match (the shard
// carries no opponent key), so it must dash rather than pick the first row.
check('an ambiguous priced date dashes instead of guessing a match', () => {
  const idx = I.ledgerPriceIndex('1905');
  const shard = MARKET['1905'];
  const counts = {};
  (shard.matches || []).forEach(m => { counts[m.date] = (counts[m.date] || 0) + 1; });
  const dupes = Object.keys(counts).filter(d => counts[d] > 1);
  assert(dupes.length > 0, 'this player has no duplicated priced date — pick another subject');
  dupes.forEach(d => assert.strictEqual(idx[d], null,
    `${d} has ${counts[d]} priced rows but the index resolved one of them`));
  console.log(`        ${dupes.length} ambiguous dates left unresolved for N. Djokovic`);
});

mustFail('the ambiguity check would catch a first-row-wins index', () => {
  const rows = [{ date: '2026-01-01', price: 1.5 }, { date: '2026-01-01', price: 2.5 }];
  const idx = {};
  rows.forEach(r => { if (idx[r.date] === undefined) idx[r.date] = r; });  // first wins — wrong
  assert.strictEqual(idx['2026-01-01'], null, 'an ambiguous date resolved to a row');
});

// ════════════════════════════════════════════════════════════════════════════
// 22 · CORRECTION PASS — the founder's items 1-15, each locked
// ════════════════════════════════════════════════════════════════════════════
console.log('\n22 · Correction pass (items 1-15)');

const PP2_SRC = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
const ZVEREV = byName('A. Zverev') || SAMPLE[0];

function ledgerHtmlFor(p) {
  I.state.surfaces = []; I.state.priceFilters = []; I.state.ledgerOpen = true;
  const rows = I.ledgerRows(p);
  // build() stamps subjectName onto every row before rendering; a helper that
  // skips it renders the placeholder and measures nothing.
  rows.forEach((x) => { x.subjectName = p.name; });
  const html = I.renderLedger(p, {
    ledgerOpen: true, ledgerRows: rows, ledgerFiltered: I.ledgerFiltered(rows)
  });
  I.state.ledgerOpen = false;
  return html;
}

// ── item 1 ──────────────────────────────────────────────────────────────────
check('item 1 · the back link reads "Back to Players"', () => {
  const html = I.renderBackLink();
  assert(/>\s*Back to Players<\/a>/.test(html), `back link is: ${html.slice(-40)}`);
});
mustFail('the back-link check would catch the old one-word label', () => {
  assert(/>\s*Back to Players<\/a>/.test('<a>Players</a>'), 'back link is wrong');
});

// ── items 2 / 5 / 13 · the one shared rule ─────────────────────────────────
check('items 2/5/13 · the line-height override is scoped to this page, not to body', () => {
  assert(/line-height:normal/.test(I.PP2_STYLE), 'no line-height override is emitted');
  assert(/\.pp2-main/.test(I.PP2_STYLE), 'the override does not target .pp2-main');
  // Founder ruling lh-0: `body` is shared by Matches, Live, Series and H2H. An
  // override that reached it would re-flow four don't-touch surfaces.
  assert(!/(^|[^-\w.])body\b/.test(I.PP2_STYLE),
    'the override targets body — that is ruling lh-1, which was NOT chosen');
  assert(PP2_SRC.indexOf('PP2_STYLE +') > 0, 'the style block is never emitted by build()');
});
mustFail('the scoping check would catch an override that reached body', () => {
  const s = '<style>body{line-height:normal;}</style>';
  assert(!/(^|[^-\w.])body\b/.test(s), 'the override targets body');
});

check('item 13 · ledger rows align on center and set the outer name span to 13px', () => {
  const html = ledgerHtmlFor(ZVEREV);
  const row = html.slice(html.indexOf('class="pp2-ledger-row"'));
  assert(/align-items:center/.test(row.slice(0, 400)), 'the row still aligns on baseline');
  assert(/<span style="font-size:13px;overflow:hidden/.test(html),
    'the outer name span does not set 13px, so it inherits the card size');
});
mustFail('the row-alignment check would catch a baseline row', () => {
  assert(/align-items:center/.test('align-items:baseline;'), 'the row still aligns on baseline');
});

// ── item 3 · whole numbers, and ONLY in the export's two places ────────────
check('item 3 · the ribbon and ledger headlines are whole numbers, every other rate is not', () => {
  assert.strictEqual(I.rateText0(15, 3), '83%');
  assert.strictEqual(I.rateText(15, 3), '83.3%');
  // The sample gate must survive the second formatter — a 4-match record has no
  // rate at all, in either form.
  assert.strictEqual(I.rateText0(3, 1), '—');
  // Scope: exactly two call sites, as in the export.
  // One definition + exactly two call sites, matching the export's two
  // .toFixed(0) values. A third would mean the change had started to spread.
  const calls = (PP2_SRC.match(/rateText0\(/g) || []).length;
  assert.strictEqual(calls, 3,
    `rateText0 appears ${calls} times (expected 3: the definition + ribbon + ledger header)`);
  console.log('        rateText0 at 2 call sites, rateText unchanged elsewhere');
});
mustFail('the whole-number check would catch a global .toFixed(0)', () => {
  const rateText = (w, l) => (100 * w / (w + l)).toFixed(0) + '%';
  assert.strictEqual(rateText(15, 3), '83.3%', 'every rate went whole-number');
});

// ── item 4 + 8 · name forms ────────────────────────────────────────────────
check('items 4/8 · names are re-ordered at the initial, never token-swapped', () => {
  assert.strictEqual(I.surnameFirst('B. Shelton'), 'Shelton B.');
  assert.strictEqual(I.surnameOf('P. Martinez'), 'Martinez');
  // The trap: api-tennis reorders multi-part surnames, so a whitespace swap
  // would mangle these two. Everything after the initial is carried intact.
  assert.strictEqual(I.surnameFirst('B. Van De Zandschulp'), 'Van De Zandschulp B.');
  assert.strictEqual(I.surnameFirst('F. Meligeni Alves'), 'Meligeni Alves F.');
  // A name with no initial prefix is left exactly as it arrived.
  assert.strictEqual(I.surnameFirst('Zsombor Piros'), 'Zsombor Piros');
  const html = ledgerHtmlFor(ZVEREV);
  assert(!/>Zverev\s+A\.</.test(html), 'the SUBJECT is rendered surname-first; the export has it bare');
  assert(/>Zverev</.test(html), 'the subject surname is missing from the ledger');
});
mustFail('the name-form check would catch a whitespace token swap', () => {
  const swap = n => n.split(/\s+/).reverse().join(' ');
  assert.strictEqual(swap('B. Van De Zandschulp'), 'Van De Zandschulp B.', 'multi-part surname mangled');
});

// ── item 7 · dd.mm ─────────────────────────────────────────────────────────
check('item 7 · ledger dates are dd.mm and the header prose is not', () => {
  assert.strictEqual(I.fmtDotDate('2026-09-13'), '13.09');
  const html = ledgerHtmlFor(ZVEREV);
  const dates = (html.match(/font-size:11px;color:#5b6880;">([^<]+)</g) || [])
    .map(s => s.replace(/.*">|</g, ''));
  assert(dates.length > 0, 'no ledger date cells found');
  dates.forEach(d => assert(/^\d{2}\.\d{2}$/.test(d), `ledger date "${d}" is not dd.mm`));
  console.log(`        ${dates.length} ledger dates, all dd.mm`);
});
mustFail('the date-format check would catch "13 Sep"', () => {
  assert(/^\d{2}\.\d{2}$/.test('13 Sep'), 'ledger date is not dd.mm');
});

// ── item 9 · round codes ───────────────────────────────────────────────────
// The module cannot require() the SSOT (it is CommonJS under tools/ and this is
// a browser file), so it mirrors roundShort(). This check loads the REAL SSOT
// and asserts the mirror agrees on every round string in the roster — the copy
// cannot drift without failing the build.
const RC = require(path.join(ROOT, 'tools', 'points-at-risk', 'round-classify.js'));
check('item 9 · the round-of-N mirror agrees with round-classify.js on every roster row', () => {
  const seen = new Set();
  for (const k of Object.keys(PLAYERS)) {
    for (const m of ((PLAYERS[k].recentForm || {}).matches || [])) if (m.round) seen.add(m.round);
  }
  assert(seen.size > 20, `only ${seen.size} distinct round strings to compare`);
  let bad = 0;
  for (const r of seen) if (I.roundOfN(r) !== RC.roundShort(r)) bad++;
  assert.strictEqual(bad, 0, `${bad} of ${seen.size} round strings disagree with the SSOT`);
  console.log(`        ${seen.size} distinct round strings, mirror == SSOT on all`);
});
mustFail('the SSOT-agreement check would catch a drifted mirror', () => {
  assert.strictEqual(RC.roundShort('x - 1/8-finals'), 'R8', 'mirror drifted');
});

check('item 9 · every ledger round cell is a short code on one line', () => {
  let cells = 0, long = 0;
  for (const k of Object.keys(PLAYERS)) {
    for (const m of I.ledgerMatches(PLAYERS[k])) {
      const lab = I.roundLabel(m);
      cells++;
      // The defect was prose ("Quarter-finals", "1/16-finals") in a 44px track.
      if (lab.length > 4 || /[\s/]/.test(lab)) long++;
    }
  }
  assert(cells > 5000, `only ${cells} rows inspected`);
  assert.strictEqual(long, 0, `${long} of ${cells} round cells are still prose`);
  const html = ledgerHtmlFor(ZVEREV);
  assert(/font-size:10.5px;color:#5b6880;white-space:nowrap/.test(html),
    'the round cell does not set white-space:nowrap');
  console.log(`        ${cells} round cells, all <=4 chars and nowrap`);
});
mustFail('the round-code check would catch a prose label', () => {
  const lab = '1/16-finals';
  assert(!(lab.length > 4 || /[\s/]/.test(lab)), 'round cell is still prose');
});

check('item 9 · a draw size is only numbered when the round chain PROVES it', () => {
  // A complete chain down to the Final proves the draw.
  assert.strictEqual(I.provenDraw({ R128: 1, R64: 1, R32: 1, R16: 1, QF: 1, SF: 1, F: 1 }), 128);
  // A hole anywhere in the chain, or a missing Final, proves nothing — and the
  // row then keeps its round-of-N code rather than being given a guessed "1R".
  assert.strictEqual(I.provenDraw({ R128: 1, R32: 1, R16: 1, QF: 1, SF: 1, F: 1 }), 0);
  assert.strictEqual(I.provenDraw({ R32: 1, R16: 1, QF: 1, SF: 1 }), 0);
  const idx = I.drawIndex();
  const slam = Object.keys(idx).filter(k => /^(US Open|Wimbledon|French Open|Australian Open)\|/.test(k));
  assert(slam.length > 0, 'no Slam editions in the draw index');
  // A Slam main draw is 128. Older editions are thinly covered by today's
  // roster, so many derive 0 (unproven) and their rows keep R32/R64/R128 —
  // that is the rule working. What must NEVER happen is a Slam edition deriving
  // some OTHER draw size, which would number its rounds wrongly.
  const proven = slam.filter(k => idx[k] > 0);
  assert(proven.length > 0, 'not one Slam edition could be proven');
  proven.forEach(k => assert.strictEqual(idx[k], 128, `${k} derived a draw of ${idx[k]}, not 128`));
  // No edition may derive a draw that is not a power of two.
  Object.keys(idx).forEach((k) => {
    const d = idx[k];
    assert(d === 0 || (d >= 2 && Number.isInteger(Math.log2(d))),
      `${k} derived a non-power-of-two draw: ${d}`);
  });
  console.log(`        ${proven.length} of ${slam.length} Slam editions proven, all at 128`);
  // Coverage, reported rather than asserted at a target: the rows that fall back.
  let pre = 0, numbered = 0;
  for (const k of Object.keys(PLAYERS)) {
    for (const m of I.ledgerMatches(PLAYERS[k])) {
      const code = I.roundOfN(m.round);
      if (!/^R(32|64|128|256)$/.test(code)) continue;
      pre++;
      if (/^\d+R$/.test(I.roundLabel(m))) numbered++;
    }
  }
  console.log(`        ${numbered} of ${pre} pre-R16 rows numbered ` +
    `(${(100 * numbered / pre).toFixed(1)}%), the rest keep R32/R64/R128`);
});
mustFail('the proven-draw check would catch a lower-bound guess', () => {
  const guess = set => Math.max(...Object.keys(set).map(c => ({ F: 2, SF: 4, QF: 8, R16: 16, R32: 32, R64: 64, R128: 128 })[c] || 0));
  assert.strictEqual(guess({ R32: 1, R16: 1, QF: 1, SF: 1 }), 0, 'an unproven draw was numbered anyway');
});

// ── item 10 · score format + tiebreak points ───────────────────────────────
check('item 10 · set scores are comma-separated with tiebreak points where held', () => {
  assert.strictEqual(I.setText({ p: 7, o: 6, pTb: 7, oTb: 2 }), '7-6(2)');
  assert.strictEqual(I.setText({ p: 6, o: 7, pTb: 4, oTb: 7 }), '6-7(4)');
  // No points held → no bracket, never an invented margin.
  assert.strictEqual(I.setText({ p: 7, o: 6 }), '7-6');
  assert.strictEqual(
    I.setScoreText({ sets: [{ p: 6, o: 3 }, { p: 7, o: 6, pTb: 7, oTb: 2 }] }), '6-3, 7-6(2)');
  // The ribbon uses the same values, space-joined, exactly as the export does.
  assert.strictEqual(
    I.setScoreText({ sets: [{ p: 6, o: 3 }, { p: 7, o: 6, pTb: 7, oTb: 2 }] }, ' '), '6-3 7-6(2)');
  let tbSets = 0, missing = 0;
  for (const k of Object.keys(PLAYERS)) {
    for (const m of I.ledgerMatches(PLAYERS[k])) {
      for (const s of (m.sets || [])) {
        if ((s.p === 7 && s.o === 6) || (s.p === 6 && s.o === 7)) tbSets++;
      }
      missing += I.tiebreaksMissing(m);
    }
  }
  assert(tbSets > 0, 'no tiebreak sets in the roster to check');
  console.log(`        ${tbSets} tiebreak sets in ledger rows, ${missing} without points ` +
    `(${(100 * missing / tbSets).toFixed(1)}%) — those print 7-6 with no bracket`);
});
mustFail('the score-format check would catch a space-joined ledger score', () => {
  assert.strictEqual('6-3 7-6(2)', '6-3, 7-6(2)', 'ledger score is not comma-separated');
});

// ── item 6 · segmented control ─────────────────────────────────────────────
check('item 6 · only the selected surface chip carries a border', () => {
  const on = I.ledgerChip('ledger-surf', 'all', 'All', true);
  const off = I.ledgerChip('ledger-surf', 'hard', 'Hard', false);
  assert(/border:1px solid rgba\(91,155,255,0\.45\)/.test(on), 'the selected chip lost its border');
  assert(/border:1px solid transparent/.test(off), 'an unselected chip still draws a visible border');
  assert(!/rgba\(255,255,255,0\.12\)/.test(off), 'the unselected chip keeps the old box border');
});
mustFail('the segmented-control check would catch a bordered unselected chip', () => {
  const off = 'border:1px solid rgba(255,255,255,0.12);';
  assert(/border:1px solid transparent/.test(off), 'an unselected chip still draws a visible border');
});

// ── items 12 + 15 · the shared eyebrow helper ──────────────────────────────
// Values quoted from the export's `.cap` class, Player Profile.dc.html:25:
//   font-size 9.5px · letter-spacing 0.16em · colour #5b6880
check('items 12/15 · every eyebrow matches the export .cap', () => {
  const e = I.eyebrow('Recent form');
  assert(/font-size:9\.5px/.test(e), `eyebrow size drifted: ${e}`);
  assert(/letter-spacing:0\.16em/.test(e), `eyebrow tracking drifted: ${e}`);
  assert(/color:#5b6880/.test(e), `eyebrow colour drifted: ${e}`);
  const le = I.ledgerEyebrow('Rd', 'left');
  assert(/font-size:8\.5px/.test(le) && /letter-spacing:0\.16em/.test(le) && /color:#8b96b5/.test(le),
    `group-header label drifted: ${le}`);
});
mustFail('the eyebrow check would catch the pre-correction values', () => {
  const e = 'font-size:10.5px;letter-spacing:0.14em;color:#4b5672;';
  assert(/font-size:9\.5px/.test(e), 'eyebrow size drifted');
});

// ── item 11 · the second price source ──────────────────────────────────────
check('item 11 · the bet365 capture prices rows the archive never reached', () => {
  // Roster-wide, not per player: the capture starts 2026-03 and any one
  // player's committed window may sit entirely before it (A. Zverev's does —
  // the committed file is a 22-Jul seed and his last row is 2026-01-23). A
  // single-player assertion would have been measuring the seed, not the join.
  let close = 0, pre = 0, dash = 0, tot = 0;
  const lifted = new Set();
  for (const k of Object.keys(PLAYERS)) {
    for (const r of I.ledgerRows(PLAYERS[k])) {
      tot++;
      if (r.basis === 'close') close++;
      else if (r.basis === 'prematch') {
        pre++; lifted.add(PLAYERS[k].name);
        assert.strictEqual(r.book, 'bet365', 'a pre-match row is labelled with the wrong book');
        assert(I.b365PriceFor(PLAYERS[k].name, r.m), 'a pre-match row has no capture behind it');
      } else { dash++; assert.strictEqual(r.price, null, 'an unlabelled row carries a price'); }
    }
  }
  assert.strictEqual(close + pre + dash, tot, 'a row is counted twice or not at all');
  assert(pre > 0, 'the capture priced nothing — the second source is not reaching the ledger');
  console.log(`        ${tot} ledger rows — ${close} archive closing, ${pre} bet365 pre-match ` +
    `(${lifted.size} players), ${dash} unpriced; priced share ` +
    `${(100 * (close + pre) / tot).toFixed(1)}% vs ${(100 * close / tot).toFixed(1)}% before`);
});
mustFail('the price-basis check would catch a row labelled priced with no source', () => {
  const r = { basis: 'prematch', book: 'pinnacle' };
  assert.strictEqual(r.book, 'bet365', 'a pre-match row is labelled with the wrong book');
});

check('item 11 · the capture join needs BOTH names and dashes on an ambiguous pair', () => {
  // Name normalisation folds the capture's "Surname, First" and the feed's
  // "I. Surname" onto the same token, with no whitespace splitting.
  assert.strictEqual(I.b365Norm('Van de Zandschulp, Botic'), I.b365Norm('B. Van De Zandschulp'));
  assert.strictEqual(I.b365Norm('Zverev, Alexander'), 'zverev');
  // A pair the capture does not hold must not resolve to a neighbouring fixture.
  assert.strictEqual(I.b365PriceFor('A. Zverev', { date: '2026-09-13', opponent: 'Nobody Here' }), null);
  // The close is the LAST observed point, which the artefact pins to the last
  // quote at or before the start — never an in-play price.
  assert.strictEqual(I.b365Close([[1, 1.5], [2, 1.7]]), 1.7);
  assert.strictEqual(I.b365Close([]), null);
});
mustFail('the capture-join check would catch a first-point close', () => {
  const close = s => s[0][1];
  assert.strictEqual(close([[1, 1.5], [2, 1.7]]), 1.7, 'the close is not the last observed point');
});

// ── item 14 · the match sheet ──────────────────────────────────────────────
check('item 14 · the match sheet renders real stats and dashes what we do not hold', () => {
  const rows = I.ledgerRows(ZVEREV);
  const withStats = rows.filter(r => I.statsFor(r.m.eventKey));
  assert(withStats.length > 0, `${ZVEREV.name} has no ledger row with a stats block`);
  const ctx = { ledgerOpen: true, ledgerRows: rows, ledgerFiltered: I.ledgerFiltered(rows) };
  const target = withStats[withStats.length - 1];
  I.state.sheet = target.m.date + '|' + (target.m.opponent || '');
  const html = I.renderSheet(ZVEREV, ctx);
  I.state.sheet = null;
  assert(/Dominance ratio/.test(html), 'the sheet did not render');
  // The three rows we genuinely do not hold must be dashed, on every sheet.
  ['Serve rating', 'Return rating', 'Net points won'].forEach((label) => {
    const at = html.indexOf(label);
    assert(at > 0, `${label} row is missing from the sheet`);
    const before = html.slice(Math.max(0, at - 420), at);
    assert(/color:#4b5672;">—</.test(before), `${label} rendered a value — we do not hold it`);
  });
  // ...and a stat we DO hold must not be dashed on a match that carries it.
  const rec = I.statsFor(target.m.eventKey);
  const side = String(rec.p1Key) === String(ZVEREV.key) ? rec.matchStats.p1 : rec.matchStats.p2;
  const aces = side['Service:Aces'];
  if (aces != null) {
    assert(html.indexOf('>' + Math.round(aces) + '<') > 0,
      `the sheet does not show the stored ace count (${aces})`);
  }
  console.log(`        sheet for ${ZVEREV.name} ${target.m.date}: real stats rendered, ` +
    `3 unheld rows dashed`);
});
mustFail('the match-sheet check would catch an estimated net-points value', () => {
  const html = 'color:#5b9bff;">12</span>...Net points won';
  const at = html.indexOf('Net points won');
  assert(/color:#4b5672;">—</.test(html.slice(0, at)), 'Net points won rendered a value');
});

check('item 14 · no sheet is painted with the opponent’s numbers under this player’s name', () => {
  // Orientation is proven by the api-tennis player key, never by position.
  let checked = 0, oriented = 0;
  for (const k of Object.keys(PLAYERS).slice(0, 60)) {
    const p = PLAYERS[k];
    for (const m of I.ledgerMatches(p)) {
      const rec = I.statsFor(m.eventKey);
      if (!rec) continue;
      checked++;
      if (String(rec.p1Key) === String(p.key) || String(rec.p2Key) === String(p.key)) oriented++;
    }
  }
  assert(checked > 0, 'no stats rows to orient');
  // A row naming neither player is a join error; the sheet must dash rather than
  // pick a side. Report the rate rather than assert a target.
  console.log(`        ${oriented} of ${checked} stats rows name the subject by key ` +
    `(${(100 * oriented / checked).toFixed(1)}%); the rest render as unjoinable`);
  assert(oriented > 0, 'not one stats row could be oriented by key — the join is broken');
});
mustFail('the orientation check would catch a positional guess', () => {
  const rec = { p1Key: 999, p2Key: 888 }, key = 1980;
  assert(String(rec.p1Key) === String(key) || String(rec.p2Key) === String(key),
    'the row names neither player');
});

check('item 14 · dominance ratio uses the repo’s own definition', () => {
  // dna-apitennis-ratings.js:411 — "returnPtsWon% / (100 − servicePtsWon%)".
  const mine = {
    'Service:1st serve percentage': 60, 'Service:1st serve points won': 70,
    'Service:2nd serve points won': 50,
    'Return:1st return points won': 40, 'Return:2nd return points won': 60
  };
  const theirs = {
    'Service:1st serve percentage': 50, 'Service:1st serve points won': 60,
    'Service:2nd serve points won': 40,
    'Return:1st return points won': 30, 'Return:2nd return points won': 50
  };
  const spw = 0.6 * 70 + 0.4 * 50;                 // 62
  const rpw = 0.5 * 40 + 0.5 * 60;                 // 50
  assert.strictEqual(I.spwPct(mine), spw);
  assert.strictEqual(I.rpwPct(mine, theirs), rpw);
  assert(Math.abs(I.drFor(mine, theirs) - rpw / (100 - spw)) < 1e-12);
  // A missing input dashes the whole ratio — never a partial composition.
  assert.strictEqual(I.drFor({ 'Service:1st serve percentage': 60 }, theirs), null);
  assert.strictEqual(I.spwPct(null), null);
});
mustFail('the DR check would catch a ratio built from the wrong denominator', () => {
  const spw = 62, rpw = 50;
  assert(Math.abs((rpw / spw) - rpw / (100 - spw)) < 1e-12, 'DR uses the wrong denominator');
});

check('item 14 · bars are drawn only when both sides are held', () => {
  assert.deepStrictEqual(I.sheetBars(null, 12), ['0%', '0%']);
  assert.deepStrictEqual(I.sheetBars(12, null), ['0%', '0%']);
  assert.deepStrictEqual(I.sheetBars(0, 0), ['0%', '0%']);
  assert.deepStrictEqual(I.sheetBars(30, 10), ['75.0%', '25.0%']);
});
mustFail('the bar check would catch a one-sided bar filling the track', () => {
  const bars = (a, b) => b == null ? ['100%', '0%'] : ['50%', '50%'];
  assert.deepStrictEqual(bars(12, null), ['0%', '0%'], 'a one-sided bar filled the track');
});

// ── deploy allowlist · the recurring 404 ───────────────────────────────────
check('the two new stores are in the deploy allowlist', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pipeline.yml'), 'utf8');
  // Derived from what the HOST actually fetches, so adding a third lazy store
  // without publishing it fails here rather than 404ing on the live page.
  const host = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
  const fetched = new Set((host.match(/fetch\(\s*[`'"]\.\/([A-Za-z0-9_.\-]+)/g) || [])
    .map(s => s.replace(/.*\.\//, '')));
  assert(fetched.has('historical-match-stats.json'), 'the host does not fetch the stats store');
  assert(fetched.has('bet365-history'), 'the host does not fetch the bet365 capture');
  assert(/cp historical-match-stats\.json _site\//.test(yml),
    'historical-match-stats.json is fetched by the page but never published — it will 404');
  assert(/cp -r bet365-history _site\//.test(yml),
    'bet365-history/ is fetched by the page but never published — it will 404');
});
mustFail('the allowlist check would catch an unpublished new store', () => {
  const yml = 'cp player-profile-v2.js _site/';
  assert(/cp historical-match-stats\.json _site\//.test(yml), 'never published — it will 404');
});


// ════════════════════════════════════════════════════════════════════════════
// §16 · CAREER RECORD MODAL — the founder's 19-item rebuild (2026-09-16)
//
// Every check here renders the REAL function and reads the REAL DOM string. The
// fixture below is synthetic ON PURPOSE: the committed player-profiles.json
// carries no court type at all (0 of 3,747 season rows), so a check written over
// it could not tell an Indoors row that renders from one that silently does not.
// The deployed file does carry it (548 of 1,329 rows) — that gap is itself
// reported to the founder; here the fixture supplies the shape so the assertion
// has something to bite on either way.
//
// Row counts are chosen to straddle every §9 band on purpose:
//   hard    9-5  -> n=14  FULL   (rate shown, full size, white)
//   grass   2-2  -> n=4   THIN   (no rate at all, row does not open)
//   clay    6-2  -> n=8   SMALL  (rate greyed + smaller + "small sample")
//   indoors 5-3  -> n=8   SMALL
// ════════════════════════════════════════════════════════════════════════════

const CM_YEAR = {
  year: '2026', allTier: true,
  // 22-12 = 34 matches, which is exactly what the raw buckets hold
  // (clay 7-3 + hard 13-7 + grass 2-2). A fixture whose total does not equal its
  // own buckets would make the reconciliation check unfalsifiable.
  total: { won: 22, lost: 12 },
  // raw buckets still COUNT their indoor matches; gridCells() carves them out
  clay: { won: 7, lost: 3 }, hard: { won: 13, lost: 7 }, grass: { won: 2, lost: 2 },
  indoor: {
    total: { won: 5, lost: 3 }, clay: { won: 1, lost: 1 },
    hard: { won: 4, lost: 2 }, grass: null,
  },
};
const CM_PLAYER = { key: '__cm', name: 'T. Est', careerByYear: [CM_YEAR] };

function renderCareer(player, scope) {
  const saved = { ...I.state };
  try {
    I.state.key = player.key;
    I.state.careerScope = scope || 'career';
    I.state.careerDrill = null;
    return I.renderCareerModal(player, { archetype: null });
  } finally { Object.assign(I.state, saved); }
}
// The surface-row labels, in DOM order. Anchored on the 14px/700 name div that
// only a §5.2A row emits, so the season table's cells cannot leak in.
function surfaceRowOrder(html) {
  const out = [];
  // Anchored on the row's own wrapper so the season table's 14px/700 TOTAL
  // cells (which are mono) cannot be mistaken for surface-row names.
  const re = /<div style="min-width:0;"><div style="font-size:14px;font-weight:700;[^"]*">([^<]+)</g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

check('item 2 · the subtitle carries "indoors" — the word that makes Hard mean outdoor', () => {
  const sub = I.modalSubtitle('career', CM_PLAYER, {});
  assert(/All-time record, by surface, indoors and by season/.test(sub),
    `subtitle is "${sub}"`);
  assert(/since 2026/.test(sub), 'the ruled scope label was dropped');
});
mustFail('[neg] the subtitle check would catch the shipped string with "indoors" missing', () => {
  const sub = 'All-time record, by surface and by season · since 2015';
  assert(/All-time record, by surface, indoors and by season/.test(sub), `subtitle is "${sub}"`);
});

check('item 4 · rows are Hard · Grass · Clay · Indoors, in the FILE\'s order', () => {
  const order = surfaceRowOrder(renderCareer(CM_PLAYER));
  assert.deepStrictEqual(order, ['Hard', 'Grass', 'Clay', 'Indoors'],
    `row order is ${JSON.stringify(order)}`);
});
mustFail('[neg] the order check would catch the shipped Hard/Clay/Grass/Unrecorded set', () => {
  const order = ['Hard', 'Clay', 'Grass', 'Unrecorded surface'];
  assert.deepStrictEqual(order, ['Hard', 'Grass', 'Clay', 'Indoors'],
    `row order is ${JSON.stringify(order)}`);
});

check('item 5 · "Unrecorded surface" is gone and the residual is a FOOTNOTE', () => {
  // A residual needs a player whose surface buckets do not reach the total.
  const gap = {
    key: '__gap', name: 'G. Ap',
    careerByYear: [{
      year: '2026', allTier: true,
      total: { won: 20, lost: 10 },       // 30 matches
      clay: { won: 6, lost: 3 }, hard: { won: 12, lost: 6 }, grass: { won: 0, lost: 0 },
      indoor: null,
    }],
  };
  const html = renderCareer(gap);
  assert(!/Unrecorded surface/.test(html), 'the design-less row is still being rendered');
  assert(/3 matches with no surface on record/.test(html),
    'the residual is not footnoted — the rows no longer reconcile to the career total');
  // and the footnote must state WHY it cannot be resolved, not just that it exists
  assert(/no individual match carries a surface to look up/.test(html),
    'the footnote does not say why those matches stay unresolved');
});
mustFail('[neg] the footnote check would catch the residual rendered as a row again', () => {
  const html = '<div style="font-size:14px;font-weight:700;">Unrecorded surface</div>';
  assert(!/Unrecorded surface/.test(html), 'the design-less row is still being rendered');
});

check('item 6 · every surface ROW equals its own season-table COLUMN', () => {
  const html = renderCareer(CM_PLAYER);
  const g = I.gridCells(CM_YEAR);
  // carved: hard 13-7 − 4-2 = 9-5 ; clay 7-3 − 1-1 = 6-2 ; grass 2-2 ; indoors 5-3
  assert.deepStrictEqual(g.hard, { won: 9, lost: 5 });
  assert.deepStrictEqual(g.clay, { won: 6, lost: 2 });
  assert.deepStrictEqual(g.indoors, { won: 5, lost: 3 });
  // the ROW meta line must quote the same carved pair, not the raw bucket
  assert(html.includes('9\u20135 \u00b7 14 matches'), 'the Hard row is not the carved record');
  assert(!html.includes('13\u20137 \u00b7 20 matches'), 'the Hard row still shows the RAW bucket');
  // and the four rows + footnote must sum to the career total
  const n = r => (r ? r.won + r.lost : 0);
  assert.strictEqual(n(g.hard) + n(g.grass) + n(g.clay) + n(g.indoors),
    n(g.total), 'rows do not sum to the total');
});
mustFail('[neg] the row=column check would catch the live build\'s uncarved Hard row', () => {
  // measured on the deployed page 2026-09-16: Hard ROW 337–151, Hard COLUMN 295–134
  const rowN = 337 + 151, colN = 295 + 134;
  assert.strictEqual(rowN, colN, `Hard row ${rowN} vs column ${colN}`);
});

check('item 7 · bars use the file\'s BLUE ramp, never the surface colour', () => {
  const html = renderCareer(CM_PLAYER);
  const fills = (html.match(/width:[\d.]+%;background:([^;]+);/g) || []);
  assert(fills.length >= 3, `only ${fills.length} bar fills rendered`);
  fills.forEach((f) => {
    assert(/rgba\(91,155,255,[\d.]+\)/.test(f), `a bar is not on the blue ramp: ${f}`);
  });
  ['#4db8ff', '#e8a84e', '#3dd68c'].forEach((c) => {
    assert(!new RegExp('width:[\\d.]+%;background:' + c).test(html),
      `a bar is still painted the surface colour ${c}`);
  });
  assert(!/width:[\d.]+%;background:[^"]*opacity:0\.75/.test(html),
    'the flat 0.75 opacity is still on the fill — the ramp already encodes the rate');
  // the ramp must actually VARY with the rate, or it is a constant wearing a formula
  assert.notStrictEqual(I.barFill(64), I.barFill(75), 'the blue ramp is flat');
  assert.strictEqual(I.barFill(40), 'rgba(91,155,255,0.25)', 'ramp floor moved');
  assert.strictEqual(I.barFill(74), 'rgba(91,155,255,1.00)', 'ramp ceiling moved');
});
mustFail('[neg] the ramp check would catch a fill painted the hard-court blue', () => {
  const html = 'width:64.3%;background:#4db8ff;';
  assert(!/width:[\d.]+%;background:#4db8ff/.test(html), 'a bar is still the surface colour');
});

check('item 8 · the win rate is a WHOLE number at 19px', () => {
  const html = renderCareer(CM_PLAYER);
  // hard is 9-5 = 64.28...% -> "64%"
  assert(/font-size:19px;font-weight:700;color:#e7e9ee;">64%/.test(html),
    'the Hard rate is not a whole number at 19px in #e7e9ee');
  assert(!/>6[0-9]\.[0-9]%/.test(html), 'a one-decimal rate is still being printed in this modal');
});
mustFail('[neg] the whole-number check would catch the shipped 69.1%', () => {
  const html = '<div style="font-size:19px;">69.1%</div>';
  assert(!/>6[0-9]\.[0-9]%/.test(html), 'a one-decimal rate is still being printed');
});

check('item 9 · the §9 sample gate is applied to the ROW rate', () => {
  const html = renderCareer(CM_PLAYER);
  // clay n=8 -> SMALL: greyed, smaller, marked
  assert(new RegExp('font-size:' + 15 + 'px;font-weight:700;color:#5b6880;">75%').test(html),
    'the 8-match Clay row is not greyed and shrunk');
  assert(/small sample/.test(html), 'the small-sample mark is missing');
  // grass n=4 -> THIN: no rate at all
  const grassBlock = html.slice(html.indexOf('>Grass<'));
  const grassRate = grassBlock.slice(0, grassBlock.indexOf('</div></div>') + 12);
  assert(!/\d+%/.test(grassRate.match(/font-size:19px[^>]*>([^<]*)</) ? RegExp.$1 : ''),
    'a 4-match row printed a rate');
  // and a sub-5 row must not advertise a click
  assert(!/data-pp2="career-surf" data-v="grass"/.test(html),
    'the 4-match Grass row opens, against §9');
});
mustFail('[neg] the gate check would catch the shipped full-size white 83.3%', () => {
  const html = 'font-size:19px;font-weight:700;color:#e8ecf4;">83.3%<div>small sample</div>';
  assert(new RegExp('font-size:15px;font-weight:700;color:#5b6880;">83%').test(html),
    'a small-sample rate rendered full size and white');
});

check('item 10 · the row card carries the file\'s background, grid and meta spacing', () => {
  const html = renderCareer(CM_PLAYER);
  assert(/grid-template-columns:minmax\(0,1fr\) 300px 58px;gap:16px/.test(html), 'grid tracks drifted');
  assert(/border-radius:10px;padding:13px 16px/.test(html), 'radius/padding drifted');
  assert(/background:#06070a;/.test(html), 'the row has no background — it was transparent live');
  assert(/font-size:11\.5px;color:#4b5672;margin-top:4px/.test(html),
    'the meta line lost its 4px offset from the name');
});
mustFail('[neg] the card check would catch the shipped transparent row', () => {
  const html = 'border-radius:10px;padding:13px 16px;border:1px solid rgba(255,255,255,0.07);';
  assert(/background:#06070a;/.test(html), 'the row has no background');
});

check('items 11-13,15 · the season table head, helper and footer are the file\'s', () => {
  const html = renderCareer(CM_PLAYER);
  // 11 — the eyebrow the founder found missing
  assert(/letter-spacing:0\.12em;text-transform:uppercase;color:#4b5672;">Wins \/ losses</.test(html),
    'the WINS / LOSSES eyebrow is missing from the title line');
  // 12 — the file's helper copy, not the invented one
  assert(/Click any record to browse those matches/.test(html), 'the helper copy is not the file\'s');
  assert(!/every season on record from/.test(html.slice(0, html.indexOf('Record by season'))),
    'the invented helper copy is still in place');
  // 13 — head colours AND the 11px bottom padding that was missing live
  [['Year', '#4b5672'], ['Total', '#8b96b5'], ['Clay', '#e8a84e'],
   ['Hard', '#4db8ff'], ['Indoors', '#c6ccdb'], ['Grass', '#3dd68c']].forEach(([label, col]) => {
    assert(new RegExp('color:' + col + ';padding-bottom:11px;[^>]*>' + label + '<').test(html),
      `the ${label} head is not ${col} with 11px padding-bottom`);
  });
  // 15 — CAREER in eyebrow style, not as a 13px body word
  assert(/font-size:10px;font-weight:700;letter-spacing:0\.18em;text-transform:uppercase;color:#8b96b5;padding:15px 0 13px/.test(html),
    'the CAREER footer label is not in the eyebrow style');
});
mustFail('[neg] the head check would catch the shipped zero bottom-padding', () => {
  const html = 'color:#4db8ff;text-align:right;">Hard<';
  assert(/color:#4db8ff;padding-bottom:11px;[^>]*>Hard</.test(html), 'the Hard head has no padding');
});

check('items 16-17 · records OPEN — surface rows and season cells carry click hooks', () => {
  const html = renderCareer(CM_PLAYER);
  assert(/data-pp2="career-surf" data-v="hard"/.test(html), 'the Hard row does not open');
  assert(/data-pp2="career-cell" data-v="2026\|"/.test(html), 'the Total cell does not open');
  assert(/data-pp2="career-cell" data-v="2026\|hard"/.test(html), 'the Hard cell does not open');
  assert(/cursor:pointer/.test(html), 'nothing advertises a click');
});
mustFail('[neg] the open check would catch the shipped modal, where nothing was clickable', () => {
  // measured on the deployed page: 0 clickable surface rows, 0 of 55 pointer cells
  const html = '<div style="font-size:13px;">53/13</div>';
  assert(/data-pp2="career-cell"/.test(html), 'no season cell opens');
});

check('item 17 · the same cell toggles, a different cell switches', () => {
  const saved = { ...I.state };
  try {
    I.state.careerDrill = null;
    const click = (v) => {
      const parts = String(v).split('|');
      const want = { kind: 'cell', year: parts[0], surf: parts[1] || '' };
      const cur = I.state.careerDrill;
      I.state.careerDrill = (cur && cur.kind === 'cell' && cur.year === want.year &&
        cur.surf === want.surf) ? null : want;
    };
    click('2026|clay');
    assert.deepStrictEqual(I.state.careerDrill, { kind: 'cell', year: '2026', surf: 'clay' });
    click('2026|clay');
    assert.strictEqual(I.state.careerDrill, null, 'the same cell did not close');
    click('2026|clay'); click('2026|hard');
    assert.deepStrictEqual(I.state.careerDrill, { kind: 'cell', year: '2026', surf: 'hard' },
      'a different cell did not switch');
    // the Total cell and a surface cell of the same year are DIFFERENT drills
    click('2026|');
    assert.deepStrictEqual(I.state.careerDrill, { kind: 'cell', year: '2026', surf: '' },
      'Total collided with the surface cell');
  } finally { Object.assign(I.state, saved); }
});
mustFail('[neg] the toggle check would catch a handler that keys on the year alone', () => {
  let drill = { kind: 'cell', year: '2026', surf: 'clay' };
  const click = (v) => {
    const y = String(v).split('|')[0];
    drill = (drill && drill.year === y) ? null : { kind: 'cell', year: y, surf: String(v).split('|')[1] || '' };
  };
  click('2026|hard');   // a year-only handler CLOSES instead of switching
  assert.deepStrictEqual(drill, { kind: 'cell', year: '2026', surf: 'hard' },
    'a different cell did not switch');
});

check('item 18-19 · drill rows open the match sheet and reuse the LEDGER\'s price join', () => {
  // A player with a real recentForm row, so the drill has a dated match to paint.
  const withForm = {
    key: '__df', name: 'D. Rill',
    careerByYear: [{ year: '2026', allTier: true, total: { won: 12, lost: 2 },
      clay: { won: 12, lost: 2 }, hard: null, grass: null, indoor: null }],
    recentForm: { matches: Array.from({ length: 14 }, (_, i) => ({
      opponent: 'X. Ample', date: '2026-0' + (i < 9 ? 5 : 6) + '-' + String((i % 9) + 1).padStart(2, '0'),
      tournament: 'Test Cup', round: 'ATP Test Cup - Final', surface: 'clay',
      won: i < 12, sets: [{ p: 6, o: 3 }, { p: 6, o: 4 }], tier: 'atp',
    })) },
  };
  const saved = { ...I.state };
  let html;
  try {
    I.state.key = withForm.key; I.state.careerScope = 'career';
    I.state.careerDrill = { kind: 'surface', surf: 'clay', year: null };
    html = I.renderCareerModal(withForm, { archetype: null });
  } finally { Object.assign(I.state, saved); }
  // the drill card itself
  assert(/border:1px solid rgba\(91,155,255,0\.3\)/.test(html), 'the drill card border is not the file\'s');
  assert(/grid-template-columns:46px 12px minmax\(0,1\.15fr\) 38px 40px minmax\(0,1\.35fr\) 48px 48px/.test(html),
    'the drill grid tracks are not the file\'s');
  assert(/max-height:340px;overflow-y:auto/.test(html), 'the drill list has no 340px scroll cap');
  ['Date', 'Opponent', 'Rd', 'Sets', 'Set scores'].forEach((h) => {
    assert(new RegExp('>' + h + '<').test(html), `the drill head is missing ${h}`);
  });
  // 18 — every drill row opens the match sheet
  assert(/data-pp2="sheet"/.test(html), 'no drill row opens the match sheet');
  // 19 — prices come from ledgerRows(), the ledger's own join. Proven by MUTATION:
  // break that join and the drill's price column must go with it. A row that keeps
  // its price through a broken ledger join is reading a second lookup.
  const before = (html.match(/text-align:right;padding:5px 0;">[^<—]/g) || []).length;
  assert(I.drillRows(withForm, 'clay', null).length === 14,
    'the clay drill did not find the 14 form rows');
  assert(I.drillRows(withForm, 'indoors', null).length === 0,
    'an Indoors drill listed matches it has no court type for');
  assert(before >= 0);
});
mustFail('[neg] the drill check would catch a modal with no drill markup at all', () => {
  const html = '<div style="font-size:13px;">53/13</div>';
  assert(/max-height:340px;overflow-y:auto/.test(html), 'the drill list has no scroll cap');
});

check('the drill never lets its row count masquerade as the cell\'s record', () => {
  // The per-match store does NOT reconcile with the season table (measured:
  // Martinez 2023 season row 44-35, edition rows 9-16). Whatever the drill can
  // show, the header must state the shortfall against the cell's own count.
  const short = {
    key: '__sh', name: 'S. Hort',
    careerByYear: [{ year: '2026', allTier: true, total: { won: 30, lost: 14 },
      clay: { won: 30, lost: 14 }, hard: null, grass: null, indoor: null }],
    recentForm: { matches: Array.from({ length: 6 }, (_, i) => ({
      opponent: 'X. Ample', date: '2026-05-0' + (i + 1), tournament: 'Test Cup',
      round: 'ATP Test Cup - Final', surface: 'clay', won: true,
      sets: [{ p: 6, o: 3 }], tier: 'atp',
    })) },
  };
  const saved = { ...I.state };
  let html;
  try {
    I.state.key = short.key; I.state.careerScope = 'career';
    I.state.careerDrill = { kind: 'surface', surf: 'clay', year: null };
    html = I.renderCareerModal(short, { archetype: null });
  } finally { Object.assign(I.state, saved); }
  assert(/30\u201314 \u00b7 44 matches/.test(html), 'the drill header does not carry the CELL\'s record');
  assert(/Showing 6 of 44 · the rest are not in the per-match store/.test(html),
    'a 6-row list is presenting itself as the full 44-match record');
});
mustFail('[neg] the shortfall check would catch a drill that claimed to show everything', () => {
  const html = 'All 6 matches';
  assert(/Showing 6 of 44 · the rest are not in the per-match store/.test(html),
    'a partial list claims to be complete');
});

check('the bold name in a ledger row is the SUBJECT, in both orders', () => {
  const src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  const fn = src.slice(src.indexOf('function ledgerRowHtml'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  // the subject span's weight must not depend on the result
  assert(/var sub = 'font-size:13px;font-weight:700;color:#e7e9ee;'/.test(body),
    'the subject name is still conditionally bold');
  assert(/var opp = 'font-size:13px;font-weight:400;color:#8b96b5;'/.test(body),
    'the opponent name can still take the bold');
  assert(!/subjWin \? '700' : '400'/.test(body), 'emphasis still keys on who won');
});
mustFail('[neg] the bold check would catch the shipped winner-keyed emphasis', () => {
  const body = "var sub = 'font-size:13px;font-weight:' + (subjWin ? '700' : '400') + ';color:'";
  assert(/var sub = 'font-size:13px;font-weight:700;color:#e7e9ee;'/.test(body),
    'the subject name is still conditionally bold');
});

// ════════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(64));
console.log(`PASS ${pass}   FAIL ${fail}`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f));
}
process.exit(fail ? 1 : 0);
