#!/usr/bin/env node
'use strict';
// TEN-206 · the hold/break heatmap rebuilt to the EXPORT's shape.
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
  mod.state.hbSurf = o.surf || 'all';
  mod.state.hbMode = o.mode || 'hold';
  return mod.renderHeatSheet(o.player || SUBJECT);
}

console.log('\nhold/break heatmap — the export\'s shape\n');
console.log(`  subject: key ${SUBJECT.key} — cells by tier: ` +
  `${SUBJECT.tiers.full} full · ${SUBJECT.tiers.muted} muted · ${SUBJECT.tiers.raw} raw`);
// Refuse to report the tint checks as passes over a grid that has no such cells.
assert.ok(SUBJECT.tiers.full > 0 && SUBJECT.tiers.raw > 0,
  'no subject in the rollup renders both a full and a sub-five cell — the tint checks would be vacuous');
console.log('');

// ════════════════════════════════════════════════════════════════════════════
// ITEM 1 · ONE grid, not two. Hold|Break toggle, Hold default.
// ════════════════════════════════════════════════════════════════════════════
check('item 1 · exactly ONE grid renders, and the two stacked panels are gone', () => {
  const html = sheet(I);
  const grids = (html.match(/class="pp2-hb-grid"/g) || []).length;
  assert.strictEqual(grids, 1, `${grids} grids rendered; the export has one`);
  assert.ok(!/Service holds/.test(html) && !/Return breaks/.test(html),
    'the old stacked "Service holds" / "Return breaks" panels are still rendering');
});

check('item 1 · Hold|Break is a segmented control and Hold is the default', () => {
  const html = sheet(I);
  assert.ok(/data-pp2="hb-mode" data-v="hold"/.test(html), 'no Hold segment');
  assert.ok(/data-pp2="hb-mode" data-v="break"/.test(html), 'no Break segment');
  // :1379-1382 — the selected segment is 700 / #e7e9ee on rgba(91,155,255,0.16)
  // with a rgba(91,155,255,0.4) border; the other is 600 / #5b6880 on nothing.
  const hold = html.slice(html.indexOf('data-pp2="hb-mode" data-v="hold"'));
  const seg = hold.slice(0, hold.indexOf('</button>'));
  assert.ok(/font-weight:700/.test(seg) && /#0b1c4e/.test(seg),
    'Hold is not the selected segment by default');
});

check('item 1 · the toggle sits next to the close button, not in the body', () => {
  const html = sheet(I);
  const modeAt = html.indexOf('data-pp2="hb-mode"');
  const closeAt = html.indexOf('data-pp2="heat-close"');
  const gridAt = html.indexOf('class="pp2-hb-grid"');
  assert.ok(modeAt > -1 && closeAt > -1 && gridAt > -1, 'a hook is missing');
  assert.ok(modeAt < closeAt, 'the toggle must precede the close button');
  assert.ok(closeAt < gridAt, 'both must sit in the header, above the grid');
});

check('item 1 · the toggle actually re-derives the grid, it does not just restyle', () => {
  const hold = sheet(I, { mode: 'hold' });
  const brk = sheet(I, { mode: 'break' });
  assert.notStrictEqual(hold, brk, 'Hold and Break rendered identical markup');
  // The engine's own two models must be what those two renders carry.
  const hl = ENGINE.heatFor(HB, SUBJECT.key, 'HOLD', I.HB_BEST_OF, 'all').globalLabel;
  const bl = ENGINE.heatFor(HB, SUBJECT.key, 'BREAK', I.HB_BEST_OF, 'all').globalLabel;
  assert.ok(hold.includes(hl), `hold view should carry "${hl}"`);
  assert.ok(brk.includes(bl), `break view should carry "${bl}"`);
  assert.ok(!hold.includes(bl), 'the hold view is carrying the break figure too');
});

// ════════════════════════════════════════════════════════════════════════════
// ITEM 2/3 · GLOBAL first, hairline gap, S1..S5 heads
// ════════════════════════════════════════════════════════════════════════════
check('item 2 · the grid tracks are the export\'s, GLOBAL first', () => {
  const html = sheet(I);
  // :1147 — grid-template-columns:126px 78px 10px repeat(5,minmax(0,1fr))
  assert.ok(/grid-template-columns:126px 78px 10px repeat\(5,minmax\(0,1fr\)\)/.test(html),
    'the grid tracks are not the export\'s 126/78/10/repeat(5)');
  assert.ok(/gap:8px 7px/.test(html), 'the grid gap is not the export\'s 8px 7px');
});

check('item 2 · GLOBAL precedes the hairline, which precedes S1 — in DOM order', () => {
  const html = sheet(I);
  const grid = html.slice(html.indexOf('class="pp2-hb-grid"'));
  const firstGlobal = grid.indexOf('background:#0f131c');
  const firstRule = grid.indexOf('width:1px;height:34px');
  const firstCell = grid.indexOf('data-pp2="hb-cell"');
  assert.ok(firstGlobal > -1, 'no GLOBAL cell rendered');
  assert.ok(firstRule > -1, 'no hairline divider rendered');
  assert.ok(firstGlobal < firstRule && firstRule < firstCell,
    'order is not GLOBAL -> hairline -> set cells (the old build put ALL last)');
});

check('item 3 · column heads are Global and S1-S5, not "Set 1" and "All"', () => {
  const html = sheet(I);
  ['Global', 'S1', 'S2', 'S3', 'S4', 'S5'].forEach((h) => {
    assert.ok(html.includes('>' + h + '</span>'), `column head "${h}" is missing`);
  });
  // Scoped to the HEAD ROW, which runs from the grid's open tag to the first
  // row label. An unscoped scan fails on a correct page: the engine's own cell
  // tooltips read "Game 1-2 · Set 1", and those are a hover affordance the
  // export does not have an opinion about — banning the string everywhere would
  // have deleted them to satisfy a check about column headings.
  const grid = html.slice(html.indexOf('class="pp2-hb-grid"'));
  const head = grid.slice(0, grid.indexOf('font-size:13.5px;font-weight:700;color:var\(--text\)'));
  assert.ok(head.length > 100, 'the head row slice is too short to be real');
  assert.ok(!/Set 1|Set 2|Set 3/.test(head), 'the old "Set N" heads are still rendering');
  assert.ok(!/>All</.test(head), 'the old trailing "All" head is still rendering');
});

// ════════════════════════════════════════════════════════════════════════════
// ITEM 4/5/6 · the note moves to the bottom; one context chip; subject row
// ════════════════════════════════════════════════════════════════════════════
check('item 4 · the legend note is BELOW the grid, at the export\'s size and colour', () => {
  const html = sheet(I);
  const gridAt = html.indexOf('class="pp2-hb-grid"');
  const noteAt = html.indexOf('font-size:11.5px;color:var\(--label\);line-height:1.6');
  assert.ok(noteAt > -1, 'the note is not at the export\'s 11.5px/label/1.6 (:1174)');
  assert.ok(noteAt > gridAt, 'the note is above the grid; the export puts it below');
  // Both sample thresholds, stated exactly as the design does (:1394).
  assert.ok(/cells on five to nine games are muted/.test(html), 'the 5-9 threshold is not stated');
  assert.ok(/cells under five show the raw count instead of a rate/.test(html),
    'the under-five threshold is not stated');
});

check('item 4 · the header carries the title and the controls, and no paragraph', () => {
  const html = sheet(I);
  const header = html.slice(0, html.indexOf('class="pp2-hb-grid"'));
  assert.ok(/Hold \/ break heatmap/.test(header), 'the title is missing from the header');
  // The long descriptive sentence must have LEFT the header.
  assert.ok(!/How often he (held|broke) serve/.test(header),
    'the descriptive paragraph is still in the header — the export puts it at the bottom');
});

check('item 5 · ONE context chip, in the export\'s shape', () => {
  const html = sheet(I);
  // :1132 — mono 9.5/600, 0.14em, uppercase, #5b6880 on #06070a, radius 9, pad 8/14
  assert.ok(/font-size:9\.5px;font-weight:600;letter-spacing:0\.14em;text-transform:uppercase;color:var\(--label\);background:var\(--surface-inner\)/.test(html),
    'the scope chip is not the export\'s chrome');
  assert.ok(/All surfaces/.test(html), 'the scope chip does not name the surface scope');
  // The old HOLD/BREAK pill pair plus a trailing "all surfaces" must be gone.
  assert.ok(!/>all surfaces<\/span>/.test(html), 'the old trailing "all surfaces" label is still rendering');
  const pills = (html.match(/border-radius:7px;background:rgba\(255,255,255,0\.04\)/g) || []).length;
  assert.strictEqual(pills, 0, 'the old HOLD/BREAK pill pair is still rendering');
});

check('item 6 · subject name in the blue accent, overall pill right-aligned', () => {
  const html = sheet(I);
  // :1144 — 15px/700 #5b9bff
  assert.ok(/font-size:15px;font-weight:700;color:var\(--periwinkle\)/.test(html),
    'the subject name is not 15px/700 in the blue accent');
  // :1145 — the pill
  assert.ok(/font-size:12px;font-weight:700;letter-spacing:0\.1em;text-transform:uppercase;color:var\(--text\)/.test(html),
    'the overall pill is not the export\'s chrome');
  const label = ENGINE.heatFor(HB, SUBJECT.key, 'HOLD', I.HB_BEST_OF, 'all').globalLabel;
  assert.ok(html.includes(label), `the pill should carry the engine's "${label}" verbatim`);
  assert.ok(!/71\.5\s*%/.test(html), 'the mock\'s 71.5% is hardcoded somewhere');
});

// ════════════════════════════════════════════════════════════════════════════
// ITEM 7/8/9/10 · density
// ════════════════════════════════════════════════════════════════════════════
check('item 7 · set cells carry NO border; only GLOBAL keeps a neutral hairline', () => {
  const html = sheet(I);
  const grid = html.slice(html.indexOf('class="pp2-hb-grid"'));
  // Every set cell is a data-pp2="hb-cell" span. None may declare a border.
  const cells = grid.split('data-pp2="hb-cell"').slice(1)
    .map(s => s.slice(0, s.indexOf('</span></span>')));
  assert.ok(cells.length >= 25, `only ${cells.length} set cells found`);
  cells.forEach((c, i) => {
    assert.ok(!/border:/.test(c.slice(0, c.indexOf('>'))),
      `set cell ${i} still declares a border — the export gives the tint alone`);
  });
  // The engine's coloured borders must not survive anywhere in the grid.
  ['rgba(45,226,145,0.48)', 'rgba(255,164,43,0.46)', 'rgba(255,90,106,0.46)'].forEach((bd) => {
    assert.ok(!grid.includes(bd), `the engine's coloured border ${bd} is still painted`);
  });
  // :1160 — GLOBAL keeps 1px solid rgba(255,255,255,0.08)
  assert.ok(/background:#0f131c;border:1px solid rgba\(255,255,255,0\.08\)/.test(grid),
    'the GLOBAL cell lost the export\'s neutral hairline');
});

check('item 8 · tints are the export\'s alphas, not the engine\'s saturated ones', () => {
  const html = sheet(I);
  const grid = html.slice(html.indexOf('class="pp2-hb-grid"'));
  // :1355 band() — full cells at 0.16 of the export's own three colours.
  const FULL = ['rgba(61,214,140,0.16)', 'rgba(232,168,78,0.16)', 'rgba(224,97,111,0.16)'];
  assert.ok(FULL.some(f => grid.includes(f)),
    'no full-sample cell carries one of the export\'s 0.16 band tints');
  // The engine's own heavier alphas must be gone.
  ['rgba(45,226,145,0.20)', 'rgba(255,164,43,0.18)', 'rgba(255,90,106,0.18)'].forEach((bg) => {
    assert.ok(!grid.includes(bg), `the engine's saturated ${bg} is still painted`);
  });
});

check('item 9 · 5-9 muted at 0.07, under five plain with a raw label, n=0 a dash', () => {
  const html = sheet(I, { mode: 'hold' });
  const grid = html.slice(html.indexOf('class="pp2-hb-grid"'));
  // :1357 — soft cells replace 0.16 with 0.07 and grey the ink.
  if (SUBJECT.tiers.muted > 0) {
    const MUTED = ['rgba(61,214,140,0.07)', 'rgba(232,168,78,0.07)', 'rgba(224,97,111,0.07)'];
    assert.ok(MUTED.some(m => grid.includes(m)),
      'the subject has 5-9 cells but none renders at the muted 0.07');
  }
  // :1353 — under five: bg rgba(255,255,255,0.03) and the literal word "raw".
  assert.ok(grid.includes('rgba(255,255,255,0.03)'), 'no sub-five cell at the export\'s 0.03');
  assert.ok(/>raw<\/span>/.test(grid), 'a sub-five cell does not print the "raw" label');
  // And it prints the COUNT, never a rate.
  const rawIdx = grid.lastIndexOf('rgba(255,255,255,0.03)', grid.indexOf('>raw</span>'));  // line-soft shares this value (TEN-285)
  const rawCell = grid.slice(rawIdx, rawIdx + 400);
  assert.ok(/>\d+\/\d+</.test(rawCell), 'the sub-five cell does not print a raw count');
});

check('item 9 · no cell anywhere prints a bare zero in place of missing data', () => {
  ['hold', 'break'].forEach((mode) => {
    const html = sheet(I, { mode });
    const grid = html.slice(html.indexOf('class="pp2-hb-grid"'));
    const cells = grid.split('data-pp2="hb-cell"').slice(1)
      .map(s => s.slice(0, s.indexOf('</span></span>')));
    cells.forEach((c) => {
      // A dead cell must be the em dash on the faint ink, never 0 or 0%.
      if (c.includes('rgba(255,255,255,0.02)')) {
        assert.ok(c.includes('—'), `${mode}: a dead cell is not an em dash`);
        assert.ok(!/>0%</.test(c), `${mode}: a dead cell printed 0%`);
      }
    });
  });
});

check('item 10 · row sub-labels are the blue accent, not grey', () => {
  const html = sheet(I);
  // :1158 — mono 9.5px #5b9bff
  assert.ok(/font-size:9\.5px;color:var\(--periwinkle\)/.test(html),
    'the row sub-label is not mono 9.5px in the blue accent');
  assert.ok(/1st svc game/.test(html), 'the row sub-labels are missing');
  // the old grey
  assert.ok(!/font-size:9px;color:#4b5672;">1st svc game/.test(html),
    'the sub-label is still rendering in the old grey');
});

// ════════════════════════════════════════════════════════════════════════════
// KEEP · the surface filter survives, in the same segmented chrome
// ════════════════════════════════════════════════════════════════════════════
check('KEEP · the surface filter is still a working control', () => {
  const html = sheet(I);
  ['all', 'hard', 'clay', 'grass'].forEach((s) => {
    assert.ok(html.includes(`data-pp2="hb-surf" data-v="${s}"`), `the "${s}" surface control is gone`);
  });
});

check('KEEP · surfaces use the SAME segmented chrome as Hold|Break', () => {
  const html = sheet(I);
  const seg = 'background:var(--surface-inner);border:0.33px solid var(--line);border-radius:9px;padding:3px;';
  const n = (html.split(seg).length - 1);
  assert.strictEqual(n, 2, `expected two segmented controls in the same chrome, found ${n}`);
  // The old four loud pills carried their own border on the unselected state.
  assert.ok(!/data-pp2="hb-surf"[^>]*border:1px solid rgba\(255,255,255,0\.08\)/.test(html),
    'the surface chips still carry the old loud unselected border');
});

check('KEEP · the surface control re-derives the grid', () => {
  const a = sheet(I, { surf: 'all' });
  const surfaces = ['hard', 'clay', 'grass'];
  let moved = false;
  for (const s of surfaces) {
    const lbl = ENGINE.heatFor(HB, SUBJECT.key, 'HOLD', I.HB_BEST_OF, s).globalLabel;
    const base = ENGINE.heatFor(HB, SUBJECT.key, 'HOLD', I.HB_BEST_OF, 'all').globalLabel;
    if (lbl !== base) { moved = true; assert.ok(sheet(I, { surf: s }).includes(lbl)); }
  }
  assert.ok(moved, 'subject is immune — every surface returns the same figure, so this proves nothing');
  assert.ok(a.includes(ENGINE.heatFor(HB, SUBJECT.key, 'HOLD', I.HB_BEST_OF, 'all').globalLabel));
});

// ════════════════════════════════════════════════════════════════════════════
// The note's band thresholds are MODE-AWARE — a reported deviation.
// ════════════════════════════════════════════════════════════════════════════
check('the note states the thresholds that are actually live for the mode', () => {
  const hold = sheet(I, { mode: 'hold' });
  const brk = sheet(I, { mode: 'break' });
  assert.ok(/Green from 85%, amber from 70%/.test(hold), 'hold note does not state 85/70');
  // The engine bands BREAK at 30/18; printing 85/70 over that grid would be false.
  assert.ok(/Green from 30%, amber from 18%/.test(brk),
    'break note states the hold thresholds — the engine bands break at 30/18');
  assert.ok(/held serve in each service-game pair/.test(hold), 'hold lead sentence missing');
  assert.ok(/broke serve in each return-game pair/.test(brk), 'break lead sentence missing');
});

check('the note carries our real coverage counts, never the career total', () => {
  const html = sheet(I);
  const cov = ENGINE.coverageFor(HB, SUBJECT.key);
  assert.ok(html.includes(String(cov.matches)), 'the parsed match count is not stated');
  assert.ok(html.includes(String(cov.svcGames)), 'the service-game count is not stated');
});

// ════════════════════════════════════════════════════════════════════════════
// MUTATION CONTROLS
// ════════════════════════════════════════════════════════════════════════════
// Each mutant is applied to a COPY of the source, the scoring block is re-run
// against the mutated module, and a mutant that does NOT break it is reported as
// a survivor. A mutant that throws something other than the expected assertion
// is also a survivor: usually the module failed to load, which proves nothing.
function scoreAgainst(M) {
  const html = sheet(M);
  const grid = html.slice(html.indexOf('class="pp2-hb-grid"'));
  const brk = sheet(M, { mode: 'break' });

  if ((html.match(/class="pp2-hb-grid"/g) || []).length !== 1) throw new Error('not exactly one grid');
  if (!/data-pp2="hb-mode" data-v="break"/.test(html)) throw new Error('no Break segment');
  if (html === brk) throw new Error('Hold and Break rendered identical markup');
  if (!/grid-template-columns:126px 78px 10px repeat\(5,minmax\(0,1fr\)\)/.test(html))
    throw new Error("the grid tracks are not the export's");
  {
    const g = grid.indexOf('background:#0f131c'), r = grid.indexOf('width:1px;height:34px'),
      c = grid.indexOf('data-pp2="hb-cell"');
    if (!(g > -1 && r > -1 && g < r && r < c)) throw new Error('order is not GLOBAL -> hairline -> set cells');
  }
  ['Global', 'S1', 'S5'].forEach((h) => {
    if (!html.includes('>' + h + '</span>')) throw new Error(`column head "${h}" is missing`);
  });
  {
    const head = grid.slice(0, grid.indexOf('font-size:13.5px;font-weight:700;color:var(--text)'));
    if (/Set 1|Set 2/.test(head)) throw new Error('the old "Set N" heads are still rendering');
  }
  {
    const gridAt = html.indexOf('class="pp2-hb-grid"');
    const noteAt = html.indexOf('font-size:11.5px;color:var(--label);line-height:1.6');
    if (noteAt < 0) throw new Error("the note is not at the export's 11.5px/label/1.6");
    if (noteAt < gridAt) throw new Error('the note is above the grid');
    if (!/cells on five to nine games are muted/.test(html)) throw new Error('the 5-9 threshold is not stated');
  }
  if (!/font-size:15px;font-weight:700;color:var\(--periwinkle\)/.test(html))
    throw new Error('the subject name is not 15px/700 in the blue accent');
  {
    const cells = grid.split('data-pp2="hb-cell"').slice(1)
      .map(s => s.slice(0, s.indexOf('</span></span>')));
    cells.forEach((c, i) => {
      if (/border:/.test(c.slice(0, c.indexOf('>')))) throw new Error(`set cell ${i} still declares a border`);
    });
    if (!/background:#0f131c;border:1px solid rgba\(255,255,255,0\.08\)/.test(grid))
      throw new Error("the GLOBAL cell lost the export's neutral hairline");
  }
  {
    const FULL = ['rgba(61,214,140,0.16)', 'rgba(232,168,78,0.16)', 'rgba(224,97,111,0.16)'];
    if (!FULL.some(f => grid.includes(f))) throw new Error("no cell carries the export's 0.16 band tint");
    ['rgba(45,226,145,0.20)', 'rgba(255,164,43,0.18)', 'rgba(255,90,106,0.18)'].forEach((bg) => {
      if (grid.includes(bg)) throw new Error(`the engine's saturated ${bg} is still painted`);
    });
  }
  if (!grid.includes('rgba(255,255,255,0.03)')) throw new Error("no sub-five cell at the export's 0.03");
  if (!/>raw<\/span>/.test(grid)) throw new Error('a sub-five cell does not print the "raw" label');
  if (!/font-size:9\.5px;color:var\(--periwinkle\)/.test(html))
    throw new Error('the row sub-label is not in the blue accent');
  ['all', 'hard', 'clay', 'grass'].forEach((s) => {
    if (!html.includes(`data-pp2="hb-surf" data-v="${s}"`)) throw new Error(`the "${s}" surface control is gone`);
  });
  {
    const seg = 'background:var(--surface-inner);border:0.33px solid var(--line);border-radius:9px;padding:3px;';
    if ((html.split(seg).length - 1) !== 2) throw new Error('the two segmented controls do not share chrome');
  }
  if (!/Green from 30%, amber from 18%/.test(brk)) throw new Error('break note states the hold thresholds');
}

const mutants = [
  ['item 1 · the two stacked grids restored',
   "body = hbGridHtml(model) + hbNoteHtml(mode, cov, sn);",
   "body = hbGridHtml(model) + hbGridHtml(model) + hbNoteHtml(mode, cov, sn);",
   /not exactly one grid/],
  ['item 1 · the mode toggle stops re-deriving',
   "var mode = state.hbMode === 'break' ? 'break' : 'hold';",
   "var mode = 'hold';",
   /identical markup|break note states/],
  ['item 2 · GLOBAL moved back to last',
   "hbGlobalCellHtml(r) + divider + r.cells.map(hbCellHtml).join('')",
   "r.cells.map(hbCellHtml).join('') + divider + hbGlobalCellHtml(r)",
   /GLOBAL -> hairline/],
  ['item 2 · the export tracks replaced',
   "'grid-template-columns:126px 78px 10px repeat(5,minmax(0,1fr));gap:8px 7px;'",
   "'grid-template-columns:126px repeat(6,minmax(0,1fr));gap:8px 7px;'",
   /tracks are not the export/],
  ['item 3 · heads reverted to "Set N"',
   "var HEAD = ['Global', 'S1', 'S2', 'S3', 'S4', 'S5'];",
   "var HEAD = ['All', 'Set 1', 'Set 2', 'Set 3', 'Set 4', 'Set 5'];",
   /column head "Global" is missing|column head "S1" is missing/],
  ['item 4 · the note moved back into the header',
   "body = hbGridHtml(model) + hbNoteHtml(mode, cov, sn);",
   "body = hbNoteHtml(mode, cov, sn) + hbGridHtml(model);",
   /note is above the grid/],
  ['item 7 · a border put back on every set cell',
   "'background:' + bg + ';border-radius:9px;padding:10px 0;\">'",
   "'background:' + bg + ';border:1px solid ' + ink + ';border-radius:9px;padding:10px 0;\">'",
   /still declares a border/],
  ['item 7 · the GLOBAL hairline removed',
   "'background:#0f131c;border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:10px 0;\">'",
   "'background:#0f131c;border-radius:9px;padding:10px 0;\">'",
   /GLOBAL cell lost the export/],
  ['item 8 · the engine\'s saturated tints passed through',
   "bg = band ? 'rgba(' + band.rgb + ',' + (muted ? '0.07' : '0.16') + ')'",
   "bg = band ? c.bg",
   /saturated|0\.16 band tint/],
  ['item 9 · the raw label dropped',
   "bg = 'rgba(255,255,255,0.03)'; ink = '#8b96b5'; fracInk = '#4b5672'; sub = 'raw';",
   "bg = 'rgba(255,255,255,0.03)'; ink = '#8b96b5'; fracInk = '#4b5672'; sub = '';",
   /does not print the "raw" label/],
  ['item 10 · sub-labels back to grey',
   "'<span style=\"font-family:\\'IBM Plex Mono\\',monospace;font-size:9.5px;color:var(--periwinkle);\">' +\n            esc(r.sub)",
   "'<span style=\"font-family:\\'IBM Plex Mono\\',monospace;font-size:9.5px;color:#4b5672;\">' +\n            esc(r.sub)",
   /sub-label is not in the blue accent/],
  ['KEEP · the surface filter deleted',
   "hbSegHtml('hb-surf', HB_SURFACES, surf) +",
   "'' +",
   /surface control is gone|do not share chrome/],
  ['the break note states the hold thresholds',
   "var T = mode === 'break' ? ['30%', '18%'] : ['85%', '70%'];",
   "var T = ['85%', '70%'];",
   /break note states the hold thresholds/],
];

console.log('\n  mutation controls\n');
check('control · the scoring block PASSES on the unmutated module', () => scoreAgainst(I));

let caught = 0, survived = 0;
mutants.forEach(([name, from, to, expect]) => {
  if (SRC.indexOf(from) < 0) {
    console.log(`  SURVIVED  ${name}\n            the mutation target is not in the source`);
    survived++; return;
  }
  const mutated = SRC.replace(from, to);
  let threw = null;
  try { scoreAgainst(loadFrom(mutated)); } catch (e) { threw = e; }
  if (threw && expect.test(threw.message)) { console.log(`  caught    ${name}`); caught++; }
  else if (threw) {
    console.log(`  SURVIVED  ${name}\n            (threw something else: ${threw.message})`);
    survived++;
  } else { console.log(`  SURVIVED  ${name}`); survived++; }
});

console.log('\n' + '='.repeat(64));
console.log(`PASS ${pass}   FAIL ${fail}   mutants ${caught} caught / ${survived} survived`);
if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail || survived ? 1 : 0);
