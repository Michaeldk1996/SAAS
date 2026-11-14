#!/usr/bin/env node
'use strict';
// TEN-206 · the hold/break heatmap rebuilt to the EXPORT's shape.
// TEN-384 · re-pinned to the step-4 REFERENCE and founder Q6 / U3.
// Profile v4 (handoff 2026-11-14, CHANGES §9) · re-pinned to the v4 heatmap box (see the v4 block below).
//
// Founder, 2026-09-19: "the export is ONE grid toggled Hold|Break with a GLOBAL
// column FIRST; we ship two stacked grids with ALL last. Build the export's
// shape." Ten structural and density items followed. This file locks all ten
// against the RENDERED MARKUP, because every one of them is a claim about what
// the reader sees and a source grep passes on a string that never reaches the
// DOM.
//
// Every expected value is quoted from `Player Stat Boxes.dc.html` — the overlay
// markup at :1125-1177 and the `holdBreak()` data model at :1326-1395 — and is
// cited inline. The capture is used to CONFIRM those values, never to replace
// them: its card measures 684.0 CSS at DPR 2, which is 760.0 at the 0.9 browser
// zoom the frame was taken at, i.e. the export's `max-width` exactly.
//
// Every check has a mutant at the bottom of this file, applied to a copy of the
// source and reverted. A check no mutant can break is not testing anything.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const failures = [];
function check(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; failures.push(name); }
}

// ── the engine, loaded exactly as the page loads it ─────────────────────────
// holdbreak.json is gitignored and nightly-built. ABSENT is a skip, never a
// silent pass: the whole file measures a grid drawn from that store.
const HB_PATH = path.join(ROOT, 'holdbreak.json');
if (!fs.existsSync(HB_PATH)) {
  console.log('\nheatmap shape — SKIPPED');
  console.log('  holdbreak.json is absent (gitignored, nightly-built), so there is no');
  console.log('  grid to measure. This is a SKIP, not a pass and not a fail.\n');
  process.exit(0);
}
const HB = JSON.parse(fs.readFileSync(HB_PATH, 'utf8'));
const ectx = { window: {}, console };
ectx.self = ectx.window;
vm.createContext(ectx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'holdbreak-heatmap.js'), 'utf8'), ectx);
const ENGINE = ectx.window.HoldBreakHeatmap;

// A subject who IS in the rollup. Picked for DENSITY, not by index: the tint and
// sample-tier checks need a grid that actually contains a full cell, a muted
// 5-9 cell and a sub-five raw cell. A sparse subject would pass every tint
// check while rendering none of them.
const SUBJECT = (function () {
  let best = null, bestScore = -1;
  for (const k of Object.keys(HB.players)) {
    const m = ENGINE.heatFor(HB, k, 'HOLD', 5, 'all');
    let full = 0, muted = 0, raw = 0;
    for (const r of m.rows) for (const c of r.cells) {
      if (!c.frac) continue;
      if (c.frac === 'raw') { raw++; continue; }
      const n = parseInt(String(c.frac).split('/')[1], 10);
      if (n < 10) muted++; else full++;
    }
    // every tier present, then most cells
    const score = (full && muted && raw) ? 1000 + full + muted + raw : full + muted + raw;
    if (score > bestScore) { bestScore = score; best = { key: Number(k), name: 'T. Subject', tiers: { full, muted, raw } }; }
  }
  return best;
})();
let ABSENT_KEY = 9000001;
while (HB.players[String(ABSENT_KEY)]) ABSENT_KEY++;
const ABSENT = { key: ABSENT_KEY, name: 'N. Obody' };

function loadFrom(src) {
  const sandbox = {
    FEATURE_PP2: true,
    playerProfiles: { players: [SUBJECT, ABSENT] },
    holdbreak: HB,
    HoldBreakHeatmap: ENGINE
  };
  global.window = sandbox;
  // eslint-disable-next-line no-new-func
  new Function('window', src)(sandbox);
  return sandbox.PlayerProfileV2._internals;
}
const SRC = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
const I = loadFrom(SRC);

function sheet(mod, opts) {
  const o = opts || {};
  mod.state.heat = true;
  mod.state.ltSurf = o.surf || 'all';
  mod.state.ltWin = o.win || 'm24';
  mod.state.ltRole = o.role || 'all';
  mod.state.hbMode = o.mode || 'hold';
  return mod.renderHeatSheet(o.player || SUBJECT);
}

// ── Profile v4 (handoff 2026-11-14, CHANGES §9) · the heatmap box ─────────────────────────────────────
// Reference: Player Stat Boxes.dc.html, the `modal.lt.heatOpen` block + liveTrading() `hb`. Kept intents: ONE grid,
// a real Hold | Break toggle, All sets first, no amber, the all-sets cell never tinted, the engine's gap band decides
// a set cell's colour (founder TEN-417: neutral within ±3, green from +4, red from −4). v4 rules:
//   · every cell = rate over "n of m"; under PP4.HB_MIN games = the count only ("4 of 5"), no rate, no colour;
//   · Set 4 / Set 5 heads say "best of 5 only"; the gap sits in the hover title;
//   · the box reads the drawer's band: Window + Surface + Filters. Honoured at Last 24 months, no filter, on All
//     surfaces / Clay / Grass (the store's nodes); any other scope says so instead of drawing another population.
const HB_MIN = 10;
const SET_CELL_RE = /<span data-pp2="hb-cell" data-tier="(\w+)"(?: data-tag="(\w+)")? title="([^"]*)" style="([^"]*)">([\s\S]*?)<\/span><\/span>/g;
function cellsOf(html) {
  const out = []; let m; SET_CELL_RE.lastIndex = 0;
  while ((m = SET_CELL_RE.exec(html))) out.push({ tier: m[1], tag: m[2] || null, title: m[3], style: m[4], inner: m[5].replace(/<[^>]+>/g, '|') });
  return out;
}
function storeCells(mode, surf) {
  const side = HB.players[String(SUBJECT.key)][mode === 'break' ? 'return' : 'serve'][surf || 'all'];
  const out = [];
  for (let b = 1; b <= 6; b++) for (let s = 1; s <= 5; s++) { const c = side[String(s)] && side[String(s)][String(b)]; out.push({ w: c ? c.won || 0 : 0, n: c ? c.n || 0 : 0 }); }
  return out;
}
function engineCells(mode, surf) {
  const m = ENGINE.heatFor(HB, SUBJECT.key, mode === 'break' ? 'BREAK' : 'HOLD', 5, surf || 'all');
  const out = []; m.rows.forEach(r => r.cells.forEach(c => out.push(c))); return out;
}
const AMBER_RE = /--amber|--viz-mid|amber/i;

function scoreAgainst(mod) {
  const hold = sheet(mod, { mode: 'hold' }), brk = sheet(mod, { mode: 'break' });
  if ((hold.match(/class="pp2-hb-grid"/g) || []).length !== 1) throw new Error('not exactly one grid');
  if (hold === brk) throw new Error('Hold and Break rendered identical markup');
  if (!/data-pp2="hb-mode" data-v="hold"/.test(hold) || !/data-pp2="hb-mode" data-v="break"/.test(hold)) throw new Error('the Hold | Break toggle is missing');
  if (!/grid-template-columns:150px repeat\(6,minmax\(0,1fr\)\);gap:6px;/.test(hold)) throw new Error('the grid tracks are not the reference 150px + 6');
  const heads = [...hold.matchAll(/<span style="display:flex;flex-direction:column;align-items:center;gap:2px;padding-bottom:4px;"><span[^>]*>([^<]*)<\/span><span[^>]*>([^<]*)<\/span>/g)].map(m => m[1] + '|' + m[2]);
  if (heads.join(',') !== 'All sets|,Set 1|,Set 2|,Set 3|,Set 4|best of 5 only,Set 5|best of 5 only') throw new Error('heads are not All sets · Set 1–5 with "best of 5 only" on Set 4/5: ' + heads.join(','));
  if (!/>Game 1–2</.test(hold)) throw new Error('the row label is not "Game 1–2" with an en dash');
  if (!/data-hb="strip"/.test(hold)) throw new Error('the strip is gone');
  const allCells = [...hold.matchAll(/<span data-hb="all" style="([^"]*)"/g)];
  if (allCells.length !== 6) throw new Error('expected 6 all-sets cells');
  if (allCells.some(m => /--pos|--neg|--viz-up|--viz-down/.test(m[1]))) throw new Error('an all-sets cell is tinted');
  const cells = cellsOf(hold), st = storeCells('hold'), eng = engineCells('hold');
  if (cells.length !== 30) throw new Error('expected 30 set cells, got ' + cells.length);
  let full = 0, count = 0, none = 0;
  cells.forEach((c, i) => {
    const k = st[i];
    if (!k.n) { none++; if (c.tier !== 'none' || !/—/.test(c.inner)) throw new Error(`cell ${i}: n=0 is not a dash`); return; }
    if (k.n < HB_MIN) {
      count++;
      if (c.tier !== 'count') throw new Error(`cell ${i}: under ${HB_MIN} games is not count-only`);
      if (/%/.test(c.inner)) throw new Error(`cell ${i}: under ${HB_MIN} games prints a rate`);
      if (!c.inner.includes(k.w + ' of ' + k.n)) throw new Error(`cell ${i}: count is not "${k.w} of ${k.n}"`);
      if (/--pos|--neg/.test(c.style)) throw new Error(`cell ${i}: under ${HB_MIN} games is coloured`);
      return;
    }
    full++;
    if (c.tier !== 'full') throw new Error(`cell ${i}: a full cell is not drawn full`);
    if (!c.inner.includes(Math.round(100 * k.w / k.n) + '%') || !c.inner.includes(k.w + ' of ' + k.n)) throw new Error(`cell ${i}: not rate over "n of m"`);
    const want = eng[i].tag === 'up' ? 'color-mix(in srgb, var(--pos) 16%' : eng[i].tag === 'down' ? 'color-mix(in srgb, var(--neg) 16%' : 'color-mix(in srgb, var(--text) 3%';
    if (!c.style.includes(want)) throw new Error(`cell ${i}: not painted by its engine gap tag (${eng[i].tag})`);
    if (!c.title.includes(ENGINE.gapText(eng[i].gap))) throw new Error(`cell ${i}: the gap is not in the hover title`);
  });
  if (!full || !count) throw new Error(`the subject exercises full ${full} / count-only ${count} — vacuous`);
  if (AMBER_RE.test(hold)) throw new Error('amber is painted');
  // the drawer's scope: Clay re-derives; Indoor and a filter say why instead of drawing another population
  const clay = sheet(mod, { surf: 'clay' });
  if (clay === hold) throw new Error('the clay scope rendered the all-surfaces grid');
  if (!/data-hb="eyebrow"[^>]*>Last 24 months · Clay/.test(clay)) throw new Error('the clay eyebrow does not name its scope');
  const indoor = sheet(mod, { surf: 'indoor' }), fav = sheet(mod, { role: 'fav' }), career = sheet(mod, { win: 'career' });
  [indoor, fav, career].forEach((h, i) => {
    if (/class="pp2-hb-grid"/.test(h)) throw new Error('an unheld scope drew a grid (#' + i + ')');
    if (!/held for the last 24 months only/.test(h)) throw new Error('an unheld scope does not say why (#' + i + ')');
  });
  mod.state.ltRole = 'all'; mod.state.ltSurf = 'all'; mod.state.ltWin = 'm24';
}

console.log('\nheatmap box — Profile v4 (CHANGES §9)\n');
check('v4 · one grid, a real Hold | Break toggle, the reference tracks and heads', () => scoreAgainst(I));
check('v4 · the box only renders while open, with its own scrim and close', () => {
  I.state.heat = false;
  assert.strictEqual(I.renderHeatSheet(SUBJECT), '');
  const open = sheet(I, {});
  assert(/data-pp2="heat-scrim"/.test(open) && /data-pp2="heat-close"/.test(open));
  assert(/z-index:70;/.test(open), 'the box is not the z 70 overlay');
  I.state.heat = false;
});
check('v4 · a player outside the rollup gets words, never a grid', () => {
  const h = sheet(I, { player: ABSENT });
  assert(/no point-by-point data on record/.test(h));
  assert(!/class="pp2-hb-grid"/.test(h));
  I.state.heat = false;
});

const mutants = [
  ['the toggle stops re-deriving', "var mode = state.hbMode === 'break' ? 'break' : 'hold';\n    var M = ltModel(p)", "var mode = 'hold';\n    var M = ltModel(p)", /identical markup/],
  ['count-only cells print a rate', "w + ' of ' + n + '</span></span>';\n          var hue", "Math.round(100 * w / n) + '% ' + w + ' of ' + n + '</span></span>';\n          var hue", /prints a rate/],
  ['the floor ignores PP4.HB_MIN', "var sn = shortName(p), MIN = PP4.HB_MIN;", "var sn = shortName(p), MIN = 5;", /count-only|coloured|not drawn full/],
  ['colour by value instead of the engine tag', "var hue = c.tag === 'up' ? 'var(--pos)' : c.tag === 'down' ? 'var(--neg)' : null;",
    "var hue = 100 * w / n >= 85 ? 'var(--pos)' : 'var(--neg)';", /engine gap tag/],
  ['Set 4 / 5 lose "best of 5 only"', "['Set 4', 'best of 5 only'], ['Set 5', 'best of 5 only']", "['Set 4', ''], ['Set 5', '']", /best of 5 only/],
  ['the gap leaves the hover title', "' ' + MIDDOT + ' ' + gapTxt + ' vs this pair across all sets'", "''", /hover title/],
  ['the scope is ignored (every scope draws all surfaces)', "var M = ltModel(p), S = M.S, node = M.hbNode;", "var M = ltModel(p), S = M.S, node = 'all';", /clay scope|unheld scope/],
];
console.log('\n  mutation controls\n');
let caught = 0, survived = 0;
mutants.forEach(([name, from, to, expect]) => {
  if (SRC.indexOf(from) < 0) { console.log(`  SURVIVED  ${name}\n            the mutation target is not in the source`); survived++; return; }
  let threw = null;
  try { scoreAgainst(loadFrom(SRC.replace(from, to))); } catch (e) { threw = e; }
  if (threw && expect.test(threw.message)) { console.log(`  caught    ${name}`); caught++; }
  else { console.log(`  SURVIVED  ${name}` + (threw ? `\n            (threw something else: ${threw.message})` : '')); survived++; }
});
console.log('\n' + '='.repeat(64));
console.log(`PASS ${pass}   FAIL ${fail}   mutants ${caught} caught / ${survived} survived`);
if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail || survived ? 1 : 0);
