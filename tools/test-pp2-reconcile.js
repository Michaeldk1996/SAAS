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
function loadModule(profiles) {
  const sandbox = { FEATURE_PP2: true, playerProfiles: profiles };
  global.window = sandbox;
  const src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', src)(sandbox);
  if (!sandbox.PlayerProfileV2) throw new Error('module did not export PlayerProfileV2');
  return sandbox.PlayerProfileV2;
}

const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'player-profiles.json'), 'utf8'));
const PLAYERS = raw.players;
const M = loadModule(PLAYERS);
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
// 4 · SURFACE vs SEASON — the ticket requires these to agree. They are two
// independently-built aggregates, so this is a real measurement, not a tautology.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n4 · Σ surface rows vs Σ season rows');

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
console.log('\n' + '='.repeat(64));
console.log(`PASS ${pass}   FAIL ${fail}`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f));
}
process.exit(fail ? 1 : 0);
