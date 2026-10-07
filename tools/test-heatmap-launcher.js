#!/usr/bin/env node
'use strict';
// BUILD ITEM 2 · heatmap launcher + overlay.
//
// What this locks is narrow and deliberate: the launcher card must print the
// figure the ENGINE returns, and must not print the design mock's 71.5%. The
// mock card reads "Hold 71.5%"; no store we hold contains that number for the
// subject (C. Alcaraz's weighted hold is 87.8%, the roster-wide figure 79.6%),
// so reproducing it pixel-for-pixel would have been fabrication. The standing
// rule is "never fabricate or approximate", and a comment saying so is not a
// guard — this file is.
//
// It also locks the layering: the grid renders only when state.heat is set, and
// a player with no point-by-point data gets a sentence rather than an "Open ›"
// button that would open an empty grid.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
}

// ── the engine, loaded exactly as the page loads it ─────────────────────────
const HB = JSON.parse(fs.readFileSync(path.join(ROOT, 'holdbreak.json'), 'utf8'));
const ectx = { window: {}, console };
ectx.self = ectx.window;
vm.createContext(ectx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'holdbreak-heatmap.js'), 'utf8'), ectx);
const ENGINE = ectx.window.HoldBreakHeatmap;

// A subject who IS in the rollup, and one who is NOT. Picked by construction
// rather than by index: a subject with no coverage is what check 4 needs, and
// "the first player happens to lack data" is not something to leave to luck.
const HELD_KEYS = Object.keys(HB.players);
const SUBJECT = { key: Number(HELD_KEYS[0]), name: 'T. Subject' };
let ABSENT_KEY = 9000001;
while (HB.players[String(ABSENT_KEY)]) ABSENT_KEY++;
const ABSENT = { key: ABSENT_KEY, name: 'N. Obody' };

function loadModule() {
  const sandbox = {
    FEATURE_PP2: true,
    playerProfiles: { players: [SUBJECT, ABSENT] },
    holdbreak: HB,
    HoldBreakHeatmap: ENGINE
  };
  global.window = sandbox;
  const src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', src)(sandbox);
  if (!sandbox.PlayerProfileV2) throw new Error('module did not export PlayerProfileV2');
  return sandbox.PlayerProfileV2._internals;
}

const I = loadModule();
assert.ok(I && I.hbLauncherHtml, 'the module must export hbLauncherHtml — otherwise every check below is vacuous');

console.log('\nheatmap launcher + overlay (build item 2)\n');

// ── 1. the headline is the ENGINE's string, not a literal ───────────────────
check('the launcher headline is heatFor().globalLabel verbatim', () => {
  I.state.hbSurf = 'all';
  const html = I.hbLauncherHtml(SUBJECT);
  const hold = ENGINE.heatFor(HB, SUBJECT.key, 'HOLD', I.HB_BEST_OF, 'all').globalLabel;
  assert.ok(html.includes(hold), `card should carry the engine's "${hold}"`);
  // The export carries ONE figure, not two. The break figure lives on the grid.
  const brk = ENGINE.heatFor(HB, SUBJECT.key, 'BREAK', I.HB_BEST_OF, 'all').globalLabel;
  assert.ok(!html.includes(brk), 'the export\'s launcher carries hold only, no break pill');
});

// ── 2. the mock's number is NOT reproduced ──────────────────────────────────
check('the design mock\'s 71.5% appears nowhere in the card', () => {
  const html = I.hbLauncherHtml(SUBJECT);
  assert.ok(!/71\.5\s*%/.test(html),
    'the card printed 71.5% — that figure is in no store we hold and must not be hardcoded to match the mock');
});

// ── 3. the figure TRACKS the surface, so it cannot be a frozen literal ──────
// The control that makes check 1 non-vacuous: a hardcoded string would pass
// check 1 if it happened to equal the "all" figure. It cannot also move.
check('the headline moves with the surface chip (so it is not a frozen string)', () => {
  const surfaces = ['all', 'hard', 'clay', 'grass'];
  const seen = new Set();
  let susceptible = false;
  const base = ENGINE.heatFor(HB, SUBJECT.key, 'HOLD', I.HB_BEST_OF, 'all').globalLabel;
  for (const s of surfaces) {
    const lbl = ENGINE.heatFor(HB, SUBJECT.key, 'HOLD', I.HB_BEST_OF, s).globalLabel;
    if (lbl !== base) susceptible = true;
    I.state.hbSurf = s;
    const html = I.hbLauncherHtml(SUBJECT);
    assert.ok(html.includes(lbl), `surface "${s}" should render "${lbl}"`);
    seen.add(lbl);
  }
  I.state.hbSurf = 'all';
  // Assert SUSCEPTIBILITY before claiming the check caught anything: a subject
  // whose every surface figure is identical would pass this check while proving
  // nothing at all.
  assert.ok(susceptible,
    'subject is immune — every surface returns the same hold figure, so this check proves nothing');
  assert.ok(seen.size > 1, 'the rendered headline never changed across surfaces');
});

// ── 4. no coverage → a sentence, never an Open button ───────────────────────
check('a player with no point-by-point data gets words, not an "Open" button', () => {
  const html = I.hbLauncherHtml(ABSENT);
  assert.ok(!/data-pp2="heat"/.test(html),
    'offered the heatmap control to a player with no data — it would open an empty grid');
  assert.ok(/no point-by-point data on record/.test(html),
    'should state in words why there is nothing to open');
  assert.ok(!/\d+%/.test(html), 'printed a percentage for a player we hold nothing for');
});

// ── 5. the overlay is gated on state.heat ───────────────────────────────────
check('the grid renders only when state.heat is set', () => {
  I.state.heat = false;
  assert.strictEqual(I.renderHeatSheet(SUBJECT), '', 'the layer rendered while closed');
  I.state.heat = true;
  const open = I.renderHeatSheet(SUBJECT);
  I.state.heat = false;
  assert.ok(open.length > 0, 'the layer rendered nothing while open');
  assert.ok(/data-pp2="heat-scrim"/.test(open), 'the layer must carry its own scrim hook');
  assert.ok(/data-pp2="heat-close"/.test(open), 'the layer must carry a close button');
});

// ── 6. the layer really contains the grid, not a second copy of the card ────
check('the layer carries the full grid body', () => {
  // REPOINTED 2026-09-19. The export's rebuild folded `hbBodyHtml` into
  // `renderHeatSheet` and replaced the two stacked panels (`pp2-hb-grids`,
  // plural) with ONE grid (`pp2-hb-grid`). What this check exists to prove is
  // unchanged and is still worth locking: the layer contains the grid, and the
  // surface filter lives inside the layer rather than behind it. The old
  // vacuity guard — "the body itself still has a grid container" — is replaced
  // by a stronger one: there must be EXACTLY one, which is the export's shape
  // and which the two-panel build would fail.
  I.state.heat = true;
  I.state.hbSurf = 'all';
  const open = I.renderHeatSheet(SUBJECT);
  I.state.heat = false;
  const grids = (open.match(/class="pp2-hb-grid"/g) || []).length;
  assert.strictEqual(grids, 1, `the layer rendered ${grids} grids; the export has one`);
  assert.ok(!/pp2-hb-grids/.test(open), 'the old two-panel container is still rendering');
  // TEN-384 founder Q6: the pop-up renders Hold | Break ONLY — the surface control is not on
  // screen (its state path is kept; tools/test-heatmap-shape.js proves it still re-derives).
  assert.ok(!/data-pp2="hb-surf"/.test(open), 'founder Q6: a surface control is still rendered in the layer');
  assert.ok(/data-pp2="hb-mode"/.test(open), 'the Hold|Break toggle must live inside the layer');
});

// ── 7. the modal body launches the layer rather than inlining the grid ──────
check('the Live trading modal body is the launcher, not the inlined grid', () => {
  const body = I.renderProfileModal(SUBJECT);
  assert.ok(/data-pp2="heat"/.test(body), 'the modal body carries no launcher');
  assert.ok(!/pp2-hb-grids/.test(body),
    'the modal body still inlines the grid — item 2 moves it behind the launcher');
});

// ── the reference's entry tile (TEN-384, inventory C row 47) ────────────────
// A clickable tile (--card + --edge-7, radius 12, pad 13/15; hover lives in the
// .pp2-atile rule), a 30px icon tile on --selected with a --line edge, title
// 13.5/700, a Hanken 11.5 sentence, and ONE mono figure "Hold 87.1%" — no
// "Open ›", no caps pill.
check('the launcher matches the reference\'s entry tile', () => {
  I.state.hbSurf = 'all';
  const html = I.hbLauncherHtml(SUBJECT);
  const want = [
    ['class="pp2-atile"', 'clickable-tile class (hover rule)'],
    ['background:var(--card);border:1px solid var(--edge-7);border-radius:12px;padding:13px 15px;', 'tile chrome'],
    ['width:30px;height:30px;border-radius:9px;box-sizing:border-box;background:var(--selected);border:1px solid var(--line);', 'icon tile'],
    ['font-size:13.5px;font-weight:700;color:var(--text);">Hold / break heatmap<', 'title 13.5/700, spaced slash'],
    ['font-size:11.5px;color:var(--text-label);">Hold and break rate by service-game pair, set by set<', 'the reference sentence'],
    ["font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:700;color:var(--text);\">Hold ", 'one mono figure'],
    ['.pp2-atile:not(.on):hover{background:var(--tile-hover)!important;border-color:var(--edge-16)!important;}', 'hover = --tile-hover + --edge-16'],
  ];
  for (const [needle, what] of want) {
    assert.ok(html.includes(needle), `${what} is off the reference: missing ${needle}`);
  }
  assert.ok(!/Open ›|>HOLD</.test(html), 'the old "Open ›" / caps pill is still on the tile');
  const fig = /(\d+(?:\.\d+)?%)$/.exec(ENGINE.heatFor(HB, SUBJECT.key, 'HOLD', I.HB_BEST_OF, 'all').globalLabel)[1];
  assert.ok(html.includes('>Hold ' + fig + '<'), `the tile figure is not the engine's hold rate ${fig}`);
});

console.log(`\nheatmap launcher: ${pass} pass, ${fail} fail`);
if (fail) { console.error(`FAILED: ${fail} check(s)`); process.exit(1); }
