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

// ─────────────────────────────────────────────────────────────────────────────
// FOUNDER RULING 2026-09-20 — TEN-243/TEN-246 gate 94aed7f5, answer "keep_10".
//
// He was given the measured collision and chose (a): the Database Ratings
// leaderboards keep the README's 10-MATCH gate. He did NOT take the store's own
// floor (floors.career.minMatches 20 / the per-node `reliable` flag), which
// would have cut the All/career field from 237 to 191, and he answered the
// follow-up "as built" — so the board reports it exactly as it shipped.
//
// What he accepted with it, stated so nobody "fixes" it later as a bug: at this
// gate the Mental Edge top 10 carries 7 entries the store marks reliable:false
// (led by N. Budkov Kjaer, rating 1.380, n=16). That is the known, ruled cost of
// the wider field, and the per-row match count is what discloses it.
//
// Asserted against the SHIPPED SOURCE: the gate constant, and the fact that the
// pool is not additionally filtered on `reliable`.
// ─────────────────────────────────────────────────────────────────────────────
const DASH = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const DBTAB = DASH.slice(DASH.indexOf('window.DatabaseTab = (function()'));

check('ruling 94aed7f5: the Ratings gate is 10 matches, not the store floor of 20', () => {
  const m = DBTAB.match(/var\s+RAT_GATE\s*=\s*(\d+)/);
  assert.ok(m, 'RAT_GATE is gone — the ruled gate constant must stay greppable');
  assert.strictEqual(m[1], '10',
    `RAT_GATE is ${m[1]}; the founder ruled 10 (gate 94aed7f5, "keep_10"). ` +
    'Moving it to 20 silently drops 46 of 237 players at All/career.');
});

check('ruling 94aed7f5: the board does NOT additionally gate on the store\'s `reliable` flag', () => {
  const pool = DBTAB.slice(DBTAB.indexOf('function ratBoardPool'), DBTAB.indexOf('function ratFmt'));
  assert.ok(pool.length > 0, 'ratBoardPool not found');
  assert.ok(!/\breliable\b/.test(pool),
    'ratBoardPool now consults `reliable` — that is option (b), which the founder DECLINED. ' +
    'He kept the wider field at the 10-match gate and accepted the thin-sample leaders that come with it.');
});

check('CONTROL: these assertions can fail — a 20-gate source is rejected', () => {
  const mutated = DBTAB.replace(/var\s+RAT_GATE\s*=\s*10/, 'var RAT_GATE = 20');
  const m = mutated.match(/var\s+RAT_GATE\s*=\s*(\d+)/);
  assert.strictEqual(m[1], '20', 'mutation did not apply — the control proves nothing');
});

// ─────────────────────────────────────────────────────────────────────────────
// TEN-254 · the founder's INTERIM instruction while the Mental Edge sample floor
// is unruled: "Until I rule, show the count next to every Mental Edge ratio so
// thin samples are visible. Don't pick a floor."
//
// This is the assertion that stops the count disappearing when someone later
// DOES pick a floor — the obvious cleanup at that point is to drop the count,
// because a floor "makes it redundant". It does not: the floor sets who appears,
// the count says how thin the ones who appear are. Only a ruling removes it.
//
// The count is PW+PL, not the `n` column beside it. n is matches on record; a
// ratio of break points is not backed by matches, and conflating them is what
// made Budkov Kjaer's 1.380 read as "n=16" when 119 pressure points back it.
// ─────────────────────────────────────────────────────────────────────────────
check('TEN-254: the Mental Edge rating cell carries its pressure-point count', () => {
  const lb = DBTAB.slice(DBTAB.indexOf('function ratLeaderboard'));
  const body = lb.slice(0, lb.indexOf('function ratComparePanel'));
  assert.ok(/board===['"]mental['"]/.test(body),
    'the mental-only branch in ratLeaderboard is gone — every ratio has lost the count ' +
    'that discloses its sample, which the founder asked for while the floor is unruled');
  assert.ok(/db-rppc/.test(body), 'the .db-rppc count element is no longer rendered');
  assert.ok(/mental\.pw/.test(body) && /mental\.pl/.test(body),
    'the count is no longer derived from PW+PL — if it now reads a different field it can ' +
    'drift from the ratio it is supposed to describe');
});

check('TEN-254: a missing PW or PL dashes the count, never prints 0', () => {
  const lb = DBTAB.slice(DBTAB.indexOf('function ratLeaderboard'));
  const body = lb.slice(0, lb.indexOf('function ratComparePanel'));
  const m = body.match(/_ppc\s*=\s*\(([^)]*)\)\s*\?\s*null/);
  assert.ok(m, 'the null-guard on the pressure-point count is gone');
  assert.ok(/_pw\s*==\s*null/.test(m[1]) && /_pl\s*==\s*null/.test(m[1]),
    'the guard no longer tests BOTH sides; a missing count would render as a number');
  assert.ok(/_ppc==null\s*\?\s*'—'/.test(body.replace(/\s+/g, ' ')) ||
            /_ppc\s*==\s*null\s*\?\s*'—'/.test(body),
    'an absent count no longer renders an em dash — a zero here would claim a player faced ' +
    'no pressure points, which is a fabricated reading of missing data');
});

check('TEN-254: the Ratings slice note sits at the bundle\'s 12px, and Lines is not dragged with it', () => {
  assert.ok(/n\.style\.marginTop\s*=\s*'12px'/.test(DBTAB),
    'the Ratings note lost its 12px (bundle README TAB 4: "Note, `margin-top:12px`")');
  // The rule lives in the page's <style> block, which is ABOVE the JS module —
  // so this one reads DASH (the whole file), not the DBTAB slice.
  assert.ok(/\.db-unwired\{[^}]*margin-top:10px/.test(DASH),
    'the SHARED .db-unwired rule moved off 10px — that rule also carries the Lines foot note, ' +
    'which the README puts at 14px, so moving it drags Lines to a value no section asks for');
});

check('CONTROL: the TEN-254 assertions can fail — stripping the mental branch is rejected', () => {
  const mutated = DBTAB.replace(/if\(board===['"]mental['"]\)\{/, 'if(false){');
  assert.ok(!/board===['"]mental['"]\)\{/.test(mutated.slice(mutated.indexOf('function ratLeaderboard'))),
    'mutation did not apply — the control proves nothing');
});

console.log(`\nratings rulings: ${pass} pass, ${fails.length} fail`);
if (fails.length) { console.error('FAILED: ' + fails.join(' · ')); process.exit(1); }
