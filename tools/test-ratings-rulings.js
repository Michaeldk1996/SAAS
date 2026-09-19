#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// FOUNDER RULINGS 2026-09-19 — §5.9 Ratings.
//
// 1 · ACE / DOUBLE FAULT are per-match COUNTS, not rates.
//     "Relabel as what the store actually holds … 'Aces per match' and 'Double
//      faults per match'. No % sign anywhere. Do not synthesise a service-point
//      denominator to make the export's label true."
//     This is a DELIBERATE deviation from the export, whose own tile labels are
//     "Ace rate" and "Double fault rate" with a %. Recorded in
//     .ten206-design/RULED-DECISIONS.md.
//
// 2 · TOUR AVERAGE is the mean of the players WE RATE, and the page says so.
//     "Compute it over the … rated players and SAY SO on the page, in the
//      footnote, in plain words: the average of the N players we rate, not the
//      ATP field. State the real N at render time, not … hardcoded."
//
// These are asserted against RENDERED MARKUP, not against the spec tables. A
// label can be right in DNA_TILES and wrong on the page (the unit is applied at
// render), and the whole point of ruling 2 is what a member reads.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0; const fails = [];
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fails.push(name); console.error(`  FAIL ${name}\n       ${e.message}`); }
}

const RAW = JSON.parse(fs.readFileSync(path.join(ROOT, 'dna-apitennis-ratings.json'), 'utf8'));
const ROWS = RAW.players || [];
// The page's shape, not the file's — see the note in test-pp2-reconcile.js.
const DNA = {
  byKey: Object.fromEntries(ROWS.map(r => [String(r.playerKey), r])),
  players: ROWS,
  meta: RAW._meta || {}
};
// A real rated subject, so the tiles carry values rather than dashes.
const SUBJECT_KEY = String((ROWS.find(r => r && r.surfaces && r.surfaces.All
  && r.surfaces.All.last52 && r.surfaces.All.last52.serve) || ROWS[0]).playerKey);

function load(extra) {
  const players = { [SUBJECT_KEY]: { key: SUBJECT_KEY, name: 'T. Subject', rank: 1 } };
  const sandbox = Object.assign(
    { FEATURE_PP2: true, playerProfiles: { players }, courtSpeedMap: {}, dnaRatings: DNA },
    extra || {});
  global.window = sandbox;
  const src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  new Function('window', src)(sandbox);   // eslint-disable-line no-new-func
  return { M: sandbox.PlayerProfileV2, player: players[SUBJECT_KEY] };
}

// Render the Ratings panel and hand back its markup.
function ratingsHtml() {
  const { M, player } = load();
  const I = M._internals;
  const m = I.dnaModel(player);
  assert.ok(m && Array.isArray(m.axes), `dnaModel returned no axes (state: ${m && m.state})`);
  assert.ok(m.axes.some(a => a && a.rating != null),
    'the subject resolved no rating — the fixture is vacuous, not the code');
  const html = I.renderRatingsPanel(player);
  assert.ok(html && html.length > 200, 'Ratings panel rendered nothing');
  return html;
}

// ── RULING 1 ────────────────────────────────────────────────────────────────
check('RULING 1: the tiles are labelled "Aces per match" / "Double faults per match"', () => {
  const { M } = load();
  const serve = M._internals.DNA_TILES.serve;
  const ace = serve.find(t => t.f === 'acesPerMatch');
  const df = serve.find(t => t.f === 'dfPerMatch');
  assert.ok(ace, 'no acesPerMatch tile');
  assert.ok(df, 'no dfPerMatch tile');
  assert.strictEqual(ace.label, 'Aces per match', `ace label is "${ace.label}"`);
  assert.strictEqual(df.label, 'Double faults per match', `df label is "${df.label}"`);
});

check('RULING 1: neither count carries a unit — no % anywhere on them', () => {
  const { M } = load();
  const serve = M._internals.DNA_TILES.serve;
  for (const f of ['acesPerMatch', 'dfPerMatch']) {
    const t = serve.find(x => x.f === f);
    assert.ok(!t.unit, `${f} carries unit "${t.unit}" — the ruling forbids a % on a per-match count`);
    assert.ok(!/%/.test(t.label), `${f} label carries a %: "${t.label}"`);
  }
});

check('RULING 1: the rendered panel prints no % beside either count', () => {
  const html = ratingsHtml();
  for (const label of ['Aces per match', 'Double faults per match']) {
    assert.ok(html.includes(label), `panel never prints "${label}"`);
    // the tile body runs value · delta · label · tour line; take a window around
    // the label and require no % in it.
    const i = html.indexOf(label);
    const tile = html.slice(Math.max(0, i - 700), i + 400);
    assert.ok(!/\d%/.test(tile),
      `a % appears inside the "${label}" tile — the store holds a per-match count, not a rate`);
  }
});

check('CONTROL: the percentage tiles DO still carry their %', () => {
  const { M } = load();
  const t = M._internals.DNA_TILES.serve.find(x => x.f === 'firstInPct');
  assert.strictEqual(t.unit, '%',
    'First serve in lost its % — the ruling drops the unit from the two COUNTS only');
});

// ── RULING 2 ────────────────────────────────────────────────────────────────
check('RULING 2: the panel no longer claims the ATP field', () => {
  const html = ratingsHtml();
  assert.ok(!/percentile vs the ATP field/.test(html),
    'the panel still reads "percentile vs the ATP field" — the pool is the rated players, not the tour');
});

check('RULING 2: it says in plain words that tour = the N players we rate', () => {
  const html = ratingsHtml();
  assert.ok(/not the ATP field/.test(html),
    'the panel never says "not the ATP field" — the ruling asks for it in plain words');
  assert.ok(/players we (rate|hold a rating)/.test(html),
    'the panel never names the pool as the players we rate');
});

check('RULING 2: the N printed is the real count, read from the store', () => {
  const { M } = load();
  const I = M._internals;
  const stats = I.dnaTourStats('last52');
  assert.ok(stats && stats.serve && stats.serve.n > 0, 'no tour stats computed');
  const n = stats.serve.n;
  // Recompute independently of the module: count rows carrying a serve rating.
  const expect = ROWS.filter(r => {
    const s = r.surfaces && r.surfaces.All && r.surfaces.All.last52;
    return s && s.serve && s.serve.rating != null;
  }).length;
  assert.strictEqual(n, expect,
    `tour N is ${n} but an independent count of the store says ${expect}`);
  const html = ratingsHtml();
  assert.ok(new RegExp('\\b' + n + '\\b').test(html),
    `the panel never prints the real N (${n})`);
});

check('CONTROL: N is not a constant — it tracks the store it is given', () => {
  const half = ROWS.slice(0, Math.max(2, Math.floor(ROWS.length / 2)));
  const players = { [SUBJECT_KEY]: { key: SUBJECT_KEY, name: 'T. Subject', rank: 1 } };
  const sandbox = {
    FEATURE_PP2: true, playerProfiles: { players }, courtSpeedMap: {},
    dnaRatings: {
      byKey: Object.fromEntries(half.map(r => [String(r.playerKey), r])),
      players: half, meta: RAW._meta || {}
    }
  };
  global.window = sandbox;
  new Function('window', fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8'))(sandbox); // eslint-disable-line no-new-func
  const small = sandbox.PlayerProfileV2._internals.dnaTourStats('last52');
  const full = load().M._internals.dnaTourStats('last52');
  assert.ok(small.serve.n < full.serve.n,
    `halving the store left N unchanged (${small.serve.n} vs ${full.serve.n}) — it is hardcoded somewhere`);
});

console.log(`\nratings rulings: ${pass} pass, ${fails.length} fail`);
if (fails.length) { console.error('FAILED: ' + fails.join(' · ')); process.exit(1); }
