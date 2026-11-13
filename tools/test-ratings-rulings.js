#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// FOUNDER RULINGS 2026-09-19 — §5.9 Ratings.
//
// 1 · ACE / DOUBLE FAULT are per-match COUNTS, not rates.
//   Profile v2 (founder 2026-11-09) supersedes it: aces / double faults PER SERVICE GAME (2 dp), from the builder's
//   own service-game counts (dna-apitennis-ratings.js acesPerSG / dfPerSG) — still no %.
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

// ── RULING 1 (founder 2026-11-13 — "we have the service games, so count it") ──
// Aces and double faults per SERVICE GAME (the builder's acesPerSG / dfPerSG = window aces ÷ service games), 2 dp.
check('RULING 1: the count tiles are "Aces per service game" / "Double faults per service game", 2 dp, no unit', () => {
  const { M } = load();
  const serve = M._internals.DNA_TILES.serve;
  assert.deepStrictEqual(serve.map(t => t.f), ['firstInPct', 'firstWonPct', 'secondWonPct', 'holdPct', 'acesPerSG', 'dfPerSG'],
    'the Serve boxes are not the four rates + the two per-service-game counts');
  const ace = serve.find(t => t.f === 'acesPerSG'), df = serve.find(t => t.f === 'dfPerSG');
  assert.strictEqual(ace.label, 'Aces per service game'); assert.strictEqual(df.label, 'Double faults per service game');
  assert.strictEqual(ace.dp, 2); assert.strictEqual(df.dp, 2);
  assert.ok(!ace.unit && !df.unit, 'a count carries a unit');
  assert.ok(df.lower === true, 'double faults are not lower-is-better');
});
check('RULING 1: the per-service-game counts are the per-match counts over the service games (a count, not a guess)', () => {
  let n = 0;
  for (const r of ROWS) {
    const s = r.surfaces && r.surfaces.All && r.surfaces.All.last52 && r.surfaces.All.last52.serve;
    if (!s || s.acesPerSG == null || s.acesPerMatch == null || !s.acesPerSG) continue;
    // service games per match = acesPerMatch / acesPerSG; a tour player serves 8–16 games a best-of-3 match, up to ~25 with five-setters
    const sgPerMatch = s.acesPerMatch / s.acesPerSG;
    assert.ok(sgPerMatch > 6 && sgPerMatch < 26, `${r.name}: ${sgPerMatch.toFixed(1)} service games a match`);
    n++;
  }
  assert.ok(n > 50, `only ${n} players compared — vacuous`);
});
check('RULING 1: the rendered panel prints no % beside either count', () => {
  const html = ratingsHtml();
  for (const label of ['Aces per service game', 'Double faults per service game']) {
    assert.ok(html.includes(label), `panel never prints "${label}"`);
    const printed = html.replace(/color-mix\(in srgb, var\(--[\w-]+\) [\d.]+%, transparent\)/g, 'color-mix()');
    const i = printed.indexOf(label);
    const tile = printed.slice(Math.max(0, i - 700), i + 400);
    // the box reads value · Δ · label · "ATP average X" — only the neighbouring boxes may carry a %
    const own = tile.slice(tile.lastIndexOf('data-pp2-dnabox'), tile.indexOf('</div></div>', tile.lastIndexOf('data-pp2-dnabox')));
    assert.ok(!/\d%/.test(own), `a % appears inside the "${label}" box`);
  }
});

check('CONTROL: the percentage tiles DO still carry their %', () => {
  const { M } = load();
  const t = M._internals.DNA_TILES.serve.find(x => x.f === 'firstInPct');
  assert.strictEqual(t.unit, '%', 'First serve in lost its %');
});

// ── RULING 2 (v3, Ratings brief points 1 + 8 — replaces "tour = the N players we rate") ──
// "ATP average" = players with at least 10 ATP main-draw matches in the window; the (?) states each window's real N.
function withMd(rows) {
  const out = JSON.parse(JSON.stringify(rows));
  out.forEach((r, i) => ['last52', 'sinceBase'].forEach(sc => {
    const smp = r.surfaces && r.surfaces.All && r.surfaces.All[sc] && r.surfaces.All[sc].sample;
    if (smp) smp.mdMatches = i % 4 === 0 ? 3 : smp.matches;
  }));
  return out;
}
function loadRows(rows) {
  const players = { [SUBJECT_KEY]: { key: SUBJECT_KEY, name: 'T. Subject', rank: 1 } };
  const sandbox = { FEATURE_PP2: true, playerProfiles: { players }, courtSpeedMap: {},
    dnaRatings: { byKey: Object.fromEntries(rows.map(r => [String(r.playerKey), r])), players: rows, meta: RAW._meta || {} } };
  global.window = sandbox;
  new Function('window', fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8'))(sandbox); // eslint-disable-line no-new-func
  return { I: sandbox.PlayerProfileV2._internals, player: players[SUBJECT_KEY] };
}
check('RULING 2 (v3): the panel says "ATP average", never "tour" or "the players we rate"', () => {
  const html = ratingsHtml();
  assert.ok(/ATP average/.test(html) && /Δ vs ATP/.test(html), 'the panel does not name the ATP average');
  assert.ok(!/Tour average|tour average|Δ vs tour|players we rate/.test(html), 'a v2 "tour" label survived');
});
check('RULING 2 (v3): the (?) prints each window\'s real ATP-group N, counted from the store', () => {
  const rows = withMd(ROWS);
  const { I, player } = loadRows(rows);
  const count = sc => rows.filter(r => { const smp = r.surfaces && r.surfaces.All && r.surfaces.All[sc] && r.surfaces.All[sc].sample; return smp && smp.mdMatches >= 10; }).length;
  const n52 = count('last52'), nC = count('sinceBase');
  assert.ok(n52 > 10 && nC > 10, 'vacuous groups');
  I.state.info = 'cr3';
  const html = I.renderRatingsPanel(player);
  I.state.info = null;
  assert.ok(html.includes(n52 + ' players in the last 52 weeks / ' + nC + ' players across their careers'), 'the (?) does not print the real N per window');
  assert.ok(/Qualifying, Challenger and ITF matches do not count towards the 10/.test(html), 'the population is not stated');
});
check('CONTROL: N is not a constant — it tracks the store it is given', () => {
  const rows = withMd(ROWS), half = rows.slice(0, Math.max(2, Math.floor(rows.length / 2)));
  const small = loadRows(half).I.dnaTourStats('last52'), full = loadRows(rows).I.dnaTourStats('last52');
  assert.ok(small._n < full._n, `halving the store left N unchanged (${small._n} vs ${full._n}) — it is hardcoded somewhere`);
});
check('CONTROL: a store with no main-draw counts prints no N and no average (never the old rated pool)', () => {
  const { I, player } = loadRows(ROWS.map(r => JSON.parse(JSON.stringify(r, (k, v) => k === 'mdMatches' ? undefined : v))));
  assert.strictEqual(I.dnaTourStats('last52'), null);
  const html = I.renderRatingsPanel(player);
  assert.ok(/The ATP comparison group is not built yet/.test(html), 'no not-built state');
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
// ⚠️ THE TWO FEATURE ASSERTIONS THAT WERE HERE ARE GONE ON PURPOSE.
//
// They were regexes over the source text, and an independent review proved them
// vacuous: nine different ways of breaking the pressure-point count (deleting the
// appendChild, summing PW only, hard-coding fmtInt(0), leaking onto the Serve
// board, inverting the null guard) all left them GREEN, because a regex asserts
// that characters exist in a file, not that the renderer does anything.
//
// They are replaced by test-ten254-mental-count.mjs, which slices ratLeaderboard
// and ratComparePanel out of the shipped page and RUNS them, with a twelve-mutant
// matrix that fails if any mutant survives. Do not re-add a grep here and think
// the count is locked - it is locked there.
//
// What stays below is the one assertion a source read is actually the right tool
// for: the presence of a CSS rule.

check('TEN-254: the Ratings slice note sits at the bundle\'s 12px, and Lines is not dragged with it', () => {
  assert.ok(/n\.style\.marginTop\s*=\s*'12px'/.test(DBTAB),
    'the Ratings note lost its 12px (bundle README TAB 4: "Note, `margin-top:12px`")');
  // The rule lives in the page's <style> block, which is ABOVE the JS module —
  // so this one reads DASH (the whole file), not the DBTAB slice.
  assert.ok(/\.db-unwired\{[^}]*margin-top:10px/.test(DASH),
    'the SHARED .db-unwired rule moved off 10px — that rule also carries the Lines foot note, ' +
    'which the README puts at 14px, so moving it drags Lines to a value no section asks for');
});

check('CONTROL: the 12px assertion can fail — a moved shared rule is rejected', () => {
  const mutated = DASH.replace(/(\.db-unwired\{[^}]*)margin-top:10px/, '$1margin-top:14px');
  assert.ok(/\.db-unwired\{[^}]*margin-top:14px/.test(mutated),
    'mutation did not apply — the control proves nothing');
  assert.ok(!/\.db-unwired\{[^}]*margin-top:10px/.test(mutated),
    'the 10px rule survived the mutation — the assertion above could not tell the difference');
});

console.log(`\nratings rulings: ${pass} pass, ${fails.length} fail`);
if (fails.length) { console.error('FAILED: ' + fails.join(' · ')); process.exit(1); }
