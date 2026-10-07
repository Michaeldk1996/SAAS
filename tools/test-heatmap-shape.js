#!/usr/bin/env node
'use strict';
// TEN-206 · the hold/break heatmap rebuilt to the EXPORT's shape.
// TEN-384 · re-pinned to the step-4 REFERENCE and founder Q6 / U3 (see the TEN-384 block below).
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

// ── TEN-384 · the pop-up rebuilt to the REFERENCE (OFFICIAL VERSION 1) ─────────
// The TEN-206 export shape this file used to lock (Global / S1–S5 heads, an absolute
// 85/70 band, a legend note, a scope chip and a subject row) is superseded by the
// step-4 reference and the founder's rulings:
//   · Q6 (2026-10-05): Hold | Break only, on a Darker track; NO surface control on
//     screen (the path behind it is kept and still re-derives the grid).
//   · TEN-376 U3: a set cell is coloured by its GAP to the pair's own all-sets rate
//     (green from +3 pts, red from −3, neutral within), muted 8%/16% on n 5–9,
//     16%/36% on n ≥ 10; the all-sets cell is never tinted.
// Every item keeps its old INTENT — one grid, a real toggle, the reference's tracks
// and order, the sample tiers, no amber, real coverage counts — re-pinned to the
// reference's measured values (inventory C rows 54–63).
const TOK = {
  allCell: 'data-hb="all" style="display:flex;flex-direction:column;align-items:center;gap:1px;border-radius:9px;padding:10px 0;' +
    'background:color-mix(in srgb, var(--text) 3%, transparent);border:1px solid var(--line);',
  seg: 'gap:3px;background:var(--card);border:1px solid var(--edge-6);border-radius:9px;padding:3px;',
  tracks: 'grid-template-columns:132px 78px 10px repeat(5,minmax(0,1fr));gap:8px 7px;',
  rule: 'width:1px;height:34px;background:var(--edge-10);',
  strip: 'data-hb="strip" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));' +
    'background:var(--card);border:1px solid var(--edge-6);border-radius:12px;overflow:hidden;',
  tint: (hue, f, e) => `background:color-mix(in srgb, var(--${hue}) ${f}%, transparent);` +
    `border:1px solid color-mix(in srgb, var(--${hue}) ${e}%, transparent);`,
  neutral: 'background:color-mix(in srgb, var(--text) 3%, transparent);border:1px solid var(--line);',
  mutedNeutral: 'background:color-mix(in srgb, var(--text) 2%, transparent);border:1px solid var(--line);',
  dead: 'background:color-mix(in srgb, var(--text) 2%, transparent);border:1px solid var(--line);',
};
// U3: amber is not allowed anywhere on the heatmap.
const AMBER_RE = /var\(--(?:viz-)?amber\)/;

console.log('\nhold/break heatmap — the reference\'s shape (TEN-384)\n');
console.log(`  subject: key ${SUBJECT.key} — cells by tier: ` +
  `${SUBJECT.tiers.full} full · ${SUBJECT.tiers.muted} muted · ${SUBJECT.tiers.raw} raw`);
assert.ok(SUBJECT.tiers.full > 0 && SUBJECT.tiers.raw > 0,
  'no subject in the rollup renders both a full and a sub-five cell — the tint checks would be vacuous');
console.log('');

/** The set cells of a rendered sheet: [{attrs, tier, style, fig, sub}] in DOM order. */
function cellsOf(html) {
  const out = [];
  const re = /<span data-pp2="hb-cell" data-tier="([a-z]+)" title="[^"]*" style="([^"]*)"><span style="[^"]*">([^<]*)<\/span><span style="([^"]*)">([^<]*)<\/span><\/span>/g;
  let m;
  while ((m = re.exec(html))) out.push({ tier: m[1], style: m[2], fig: m[3], subStyle: m[4], sub: m[5] });
  return out;
}
/** The engine's set cells for the subject, in the same order the grid prints them. */
function engineCells(mode, surf) {
  const md = ENGINE.heatFor(HB, SUBJECT.key, mode === 'break' ? 'BREAK' : 'HOLD', I.HB_BEST_OF, surf || 'all');
  return [].concat(...md.rows.map(r => r.cells));
}

// ════════════════════════════════════════════════════════════════════════════
// ITEM 1 · ONE grid, Hold|Break on a Darker track, Hold default, a real toggle
// ════════════════════════════════════════════════════════════════════════════
check('item 1 · exactly ONE grid renders, and the two stacked panels are gone', () => {
  const html = sheet(I);
  const grids = (html.match(/class="pp2-hb-grid"/g) || []).length;
  assert.strictEqual(grids, 1, `${grids} grids rendered; the reference has one`);
  assert.ok(!/Service holds/.test(html) && !/Return breaks/.test(html),
    'the old stacked "Service holds" / "Return breaks" panels are still rendering');
});

check('item 1 · Hold|Break is a Darker-track segment and Hold is the default (Q4.2)', () => {
  const html = sheet(I);
  assert.ok(html.includes('data-pp2-seg="hb-mode" style="display:inline-flex;' + TOK.seg),
    'Hold | Break is not on the Darker track (--card + --edge-6, radius 9, pad 3, gap 3)');
  const hold = html.slice(html.indexOf('data-pp2="hb-mode" data-v="hold"'));
  const seg = hold.slice(0, hold.indexOf('</button>'));
  assert.ok(/font-family:var\(--font-words\);font-size:11\.5px;/.test(seg), 'the segment is not Hanken 11.5 (the reference)');
  assert.ok(/font-weight:700/.test(seg) && /color:var\(--text\);/.test(seg) &&
    /background:var\(--inner\)/.test(seg) && /border:1px solid var\(--edge-10\)/.test(seg),
    'Hold is not the selected segment by default');
  const brk = html.slice(html.indexOf('data-pp2="hb-mode" data-v="break"'));
  const bseg = brk.slice(0, brk.indexOf('</button>'));
  assert.ok(/font-weight:600/.test(bseg) && /color:var\(--text-label\)/.test(bseg) &&
    /background:transparent/.test(bseg) && /border:1px solid transparent/.test(bseg),
    'Break is not the idle segment by default');
});

check('item 1 · the toggle sits next to the close button, above the strip and grid', () => {
  const html = sheet(I);
  const modeAt = html.indexOf('data-pp2="hb-mode"');
  const closeAt = html.indexOf('data-pp2="heat-close"');
  const stripAt = html.indexOf('data-hb="strip"');
  const gridAt = html.indexOf('class="pp2-hb-grid"');
  assert.ok(modeAt > -1 && closeAt > -1 && stripAt > -1 && gridAt > -1, 'a hook is missing');
  assert.ok(modeAt < closeAt && closeAt < stripAt && stripAt < gridAt,
    'order is not toggle → close → strip → grid');
});

check('item 1 · the toggle actually re-derives the grid, it does not just restyle', () => {
  const hold = sheet(I, { mode: 'hold' });
  const brk = sheet(I, { mode: 'break' });
  assert.notStrictEqual(hold, brk, 'Hold and Break rendered identical markup');
  // The strip's "rate · all" is the engine's own weighted global for that mode.
  const fig = (l) => /(\d+(?:\.\d+)?%)$/.exec(l)[1];
  const hl = fig(ENGINE.heatFor(HB, SUBJECT.key, 'HOLD', I.HB_BEST_OF, 'all').globalLabel);
  const bl = fig(ENGINE.heatFor(HB, SUBJECT.key, 'BREAK', I.HB_BEST_OF, 'all').globalLabel);
  assert.ok(hold.includes('>' + hl + '<'), `hold view should carry the engine's hold rate ${hl}`);
  assert.ok(brk.includes('>' + bl + '<'), `break view should carry the engine's break rate ${bl}`);
  assert.ok(/>Hold rate · all</.test(hold) && />Break rate · all</.test(brk), 'the strip caption does not follow the mode');
  assert.deepStrictEqual(cellsOf(brk).map(c => c.fig), engineCells('break').map(c => c.pct === '' ? '—' : c.pct),
    'the break grid does not print the engine\'s break cells');
});

// ════════════════════════════════════════════════════════════════════════════
// ITEM 2/3 · ALL SETS first, hairline, Set 1–5; "Game pair · All sets · Set 1–Set 5"
// ════════════════════════════════════════════════════════════════════════════
check('item 2 · the grid tracks are the reference\'s, ALL SETS first', () => {
  const html = sheet(I);
  assert.ok(html.includes(TOK.tracks), 'the grid tracks are not 132/78/10/repeat(5) at gap 8/7');
});

check('item 2 · ALL SETS precedes the hairline, which precedes Set 1 — in DOM order', () => {
  const html = sheet(I);
  const grid = html.slice(html.indexOf('class="pp2-hb-grid"'));
  const a = grid.indexOf('data-hb="all"'), r = grid.indexOf(TOK.rule), c = grid.indexOf('data-pp2="hb-cell"');
  assert.ok(a > -1, 'no ALL SETS cell rendered');
  assert.ok(r > -1, 'no hairline divider rendered');
  assert.ok(a < r && r < c, 'order is not ALL SETS -> hairline -> set cells');
});

check('item 3 · column heads are "Game pair · All sets · Set 1–Set 5" (inventory C row 58)', () => {
  const html = sheet(I);
  const grid = html.slice(html.indexOf('class="pp2-hb-grid"'));
  const head = grid.slice(0, grid.indexOf('data-hb="pair"'));
  const heads = [...head.matchAll(/>([^<>]+)<\/span>/g)].map(m => m[1]);
  assert.deepStrictEqual(heads, ['Game pair', 'All sets', 'Set 1', 'Set 2', 'Set 3', 'Set 4', 'Set 5'],
    `heads read ${JSON.stringify(heads)}`);
  assert.ok(!/>Global<|>S1</.test(head), 'the old Global / S1 heads are still rendering');
});

check('item 3 · row labels read "Game 1–2" with an EN DASH, 13/600, sub Plex 10.5 label', () => {
  const hold = sheet(I, { mode: 'hold' });
  const brk = sheet(I, { mode: 'break' });
  const labels = [...hold.matchAll(/data-hb="pair"[^>]*><span style="([^"]*)">([^<]*)<\/span><span style="([^"]*)">([^<]*)</g)];
  assert.strictEqual(labels.length, 6, `${labels.length} row labels; six game pairs expected`);
  labels.forEach((m) => {
    assert.ok(/^Game \d+–\d+\+?$/.test(m[2]), `row label "${m[2]}" is not "Game a–b" with an en dash`);
    assert.ok(/font-size:13px;font-weight:600;color:var\(--text\)/.test(m[1]), `"${m[2]}" is not 13/600 white`);
    assert.ok(/IBM Plex Mono.*font-size:10\.5px;color:var\(--text-label\)/.test(m[3]), `"${m[2]}" sub is not Plex 10.5 label`);
  });
  assert.ok(/>1st svc game</.test(hold) && />1st return game</.test(brk),
    'the sub does not say service game on Hold and return game on Break');
});

// ════════════════════════════════════════════════════════════════════════════
// ITEM 4/5 · header: caps eyebrow, 18/800 title, sub line; no legend footnote
// ════════════════════════════════════════════════════════════════════════════
check('item 4 · eyebrow + 18/800 title + sub line, and NO legend footnote (row 63)', () => {
  const html = sheet(I);
  const eb = /<span data-hb="eyebrow"[^>]* style="([^"]*)">([^<]*)<\/span>/.exec(html);
  assert.ok(eb, 'no eyebrow');
  assert.ok(/font-family:var\(--font-words\);font-size:10\.5px;font-weight:700;letter-spacing:0\.10em;text-transform:uppercase;color:var\(--text-label\);/.test(eb[1]),
    'the eyebrow is not the foundation caps label');
  assert.ok(/^All surfaces · last \d+ months · [\d,]+ service games$/.test(eb[2]), `eyebrow reads "${eb[2]}"`);
  assert.ok(/font-size:18px;font-weight:800;[^"]*">Hold \/ break heatmap</.test(html), 'the title is not 18/800');
  assert.ok(/font-size:12\.5px;color:var\(--text-label\);">[^<]+ · how often he held serve in each game pair, overall and by set</.test(html),
    'the sub line is missing');
  assert.ok(!/Green from|neutral down to|red below/.test(html), 'the old threshold legend is still printed');
});

check('item 5 · the 3-up strip: Hold rate · all / Best pair / Weakest pair (row 57)', () => {
  const html = sheet(I);
  assert.ok(html.includes(TOK.strip), 'the strip is not a --card + --edge-6 radius-12 panel');
  ['Hold rate · all', 'Best pair', 'Weakest pair'].forEach((c) => {
    assert.ok(html.includes('>' + c + '<'), `strip caption "${c}" is missing`);
  });
  const st = I.hbStripModel(ENGINE.heatFor(HB, SUBJECT.key, 'HOLD', I.HB_BEST_OF, 'all'));
  assert.ok(st.best && st.worst, 'the subject has no pair on 10+ games — the strip check is vacuous');
  assert.ok(html.includes('>' + st.best.pct + '%<') && html.includes('>' + st.worst.pct + '%<'),
    'the strip does not print the best / weakest pair rates');
  // best/weakest are the engine's own printed all-sets figures — never re-derived
  const allSets = [...html.matchAll(/data-hb="all"[^>]*><span style="[^"]*">(\d+)%</g)].map(m => +m[1]);
  assert.ok(allSets.includes(st.best.pct) && allSets.includes(st.worst.pct), 'best / weakest are not printed all-sets figures');
});

// ════════════════════════════════════════════════════════════════════════════
// ITEM 6/7/8 · the GAP rule (U3), true minus, the all-sets cell never tinted
// ════════════════════════════════════════════════════════════════════════════
check('item 6 · every set cell is painted by the engine\'s gap tag, at the tier\'s strength', () => {
  for (const mode of ['hold', 'break']) {
    const html = sheet(I, { mode });
    const cells = cellsOf(html), eng = engineCells(mode);
    assert.strictEqual(cells.length, eng.length, `${mode}: ${cells.length} cells rendered for ${eng.length} engine cells`);
    let up = 0, down = 0;
    cells.forEach((c, i) => {
      const e = eng[i];
      if (c.tier === 'full' || c.tier === 'muted') {
        const f = c.tier === 'muted' ? [8, 16] : [16, 36];
        const want = e.tag === 'up' ? TOK.tint('viz-up', f[0], f[1]) : e.tag === 'down' ? TOK.tint('viz-down', f[0], f[1])
          : (c.tier === 'muted' ? TOK.mutedNeutral : TOK.neutral);
        assert.ok(c.style.includes(want), `${mode} cell ${i} (${e.tag}, ${c.tier}) is not painted ${want}`);
        if (e.tag === 'up') up++; if (e.tag === 'down') down++;
      }
    });
    assert.ok(up > 0 && down > 0, `${mode}: the grid paints no up or no down cell — the tint check is vacuous`);
  }
});

check('item 7 · the sub is the gap in pts with a TRUE minus; full figure 14/700 in the gap colour', () => {
  const html = sheet(I);
  const cells = cellsOf(html), eng = engineCells('hold');
  let seen = 0;
  cells.forEach((c, i) => {
    if (c.tier !== 'full' && c.tier !== 'muted') return;
    assert.strictEqual(c.sub, ENGINE.gapText(eng[i].gap), `cell ${i}: sub "${c.sub}" is not the gap`);
    assert.ok(!/-\d/.test(c.sub), `cell ${i}: "${c.sub}" uses a hyphen, not U+2212`);
    if (eng[i].gap < 0) seen++;
  });
  assert.ok(seen > 0, 'no negative gap rendered — the minus check is vacuous');
  assert.ok(/font-size:14px;font-weight:700;color:var\(--viz-up\);">\d+%</.test(html), 'no full up cell at Plex 14/700 --viz-up');
  assert.ok(/font-size:14px;font-weight:700;color:var\(--viz-down\);">\d+%</.test(html), 'no full down cell at Plex 14/700 --viz-down');
});

check('item 8 · the ALL SETS cell is never tinted, and no amber anywhere (U3)', () => {
  for (const mode of ['hold', 'break']) {
    const html = sheet(I, { mode });
    const all = html.split('data-hb="all"').length - 1;
    assert.strictEqual(all, 6, `${mode}: ${all} all-sets cells`);
    assert.strictEqual(html.split(TOK.allCell).length - 1, 6, `${mode}: an all-sets cell is tinted or lost its hairline`);
    assert.ok(!AMBER_RE.test(html), `${mode}: amber is painted on the heatmap`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ITEM 9 · sample tiers: n 5–9 muted, n < 5 raw "k/n" over "raw", none a dash
// ════════════════════════════════════════════════════════════════════════════
check('item 9 · 5-9 muted (Plex 14/500 label, sub at 70%), under five raw, n=0 a dash', () => {
  const html = sheet(I);
  const cells = cellsOf(html);
  const muted = cells.filter(c => c.tier === 'muted'), raw = cells.filter(c => c.tier === 'raw');
  assert.ok(muted.length > 0, 'the subject has no muted cell — vacuous');
  assert.ok(raw.length > 0, 'the subject has no raw cell — vacuous');
  assert.ok(/data-tier="muted"[^>]*><span style="[^"]*font-weight:500;color:var\(--text-label\);">\d+%</.test(html),
    'a muted cell is not Plex 14/500 in --text-label');
  muted.forEach(c => assert.ok(c.subStyle.includes('color:color-mix(in srgb, var(--text-label) 70%, transparent)'), 'a muted sub is not label at 70%'));
  raw.forEach(c => {
    assert.ok(/^\d+\/\d+$/.test(c.fig) && c.sub === 'raw', `a raw cell reads "${c.fig}" / "${c.sub}"`);
    assert.ok(c.style.includes(TOK.neutral), 'a raw cell is tinted');
  });
  cells.filter(c => c.tier === 'none').forEach(c => assert.strictEqual(c.fig, '—', 'an empty cell is not a dash'));
});

check('item 9 · no cell anywhere prints a bare zero in place of missing data', () => {
  for (const key of Object.keys(HB.players).slice(0, 60)) {
    const html = sheet(I, { player: { key: Number(key), name: 'T. Subject' } });
    assert.ok(!/>0%<\/span><span[^>]*>raw</.test(html), `${key}: a raw cell prints 0%`);
    assert.ok(!/undefined|NaN/.test(html), `${key}: DOM leak`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Q6 · no surface control on screen; the path behind it is KEPT and still works
// ════════════════════════════════════════════════════════════════════════════
check('Q6 · no surface control is rendered (Hold | Break only)', () => {
  const html = sheet(I);
  assert.ok(!/data-pp2="hb-surf"/.test(html), 'a surface control is still on screen');
  assert.strictEqual((html.match(/data-pp2-seg="/g) || []).length, 1, 'more than one segmented control in the pop-up');
  assert.ok(Array.isArray(I.HB_SURFACES) && I.HB_SURFACES.length === 4, 'the surface vocabulary (kept code path) is gone');
});

check('Q6 · KEEP · the surface path still re-derives the grid and names itself', () => {
  const subj = Object.keys(HB.players).find((k) => {
    const a = ENGINE.heatFor(HB, k, 'HOLD', 5, 'all'), c = ENGINE.heatFor(HB, k, 'HOLD', 5, 'clay');
    return a.globalLabel !== c.globalLabel && !/—/.test(c.globalLabel);
  });
  assert.ok(subj, 'no player has distinct clay figures — the check would be immune');
  const p = { key: Number(subj), name: 'T. Subject' };
  const all = sheet(I, { player: p }), clay = sheet(I, { player: p, surf: 'clay' });
  assert.notStrictEqual(all, clay, 'state.hbSurf no longer re-derives the grid');
  assert.ok(/data-hb="eyebrow"[^>]*>Clay ·/.test(clay), 'the clay view does not say it is the clay view');
});

check('the parse coverage counts stay reachable, never the career total', () => {
  const html = sheet(I);
  const cov = ENGINE.coverageFor(HB, SUBJECT.key);
  const tip = (/data-hb="eyebrow" title="([^"]*)"/.exec(html) || [])[1] || '';
  assert.ok(tip.includes(String(cov.matches)), 'the parsed match count is not stated');
  assert.ok(tip.includes(String(cov.svcGames)), 'the service-game count is not stated');
});

// ════════════════════════════════════════════════════════════════════════════
// MUTATION CONTROLS
// ════════════════════════════════════════════════════════════════════════════
function scoreAgainst(M) {
  const html = sheet(M);
  const brk = sheet(M, { mode: 'break' });
  const grid = html.slice(html.indexOf('class="pp2-hb-grid"'));
  if ((html.match(/class="pp2-hb-grid"/g) || []).length !== 1) throw new Error('not exactly one grid');
  if (!/data-pp2="hb-mode" data-v="break"/.test(html)) throw new Error('no Break segment');
  if (html === brk) throw new Error('Hold and Break rendered identical markup');
  if (!html.includes(TOK.tracks)) throw new Error("the grid tracks are not the reference's");
  {
    const a = grid.indexOf('data-hb="all"'), r = grid.indexOf(TOK.rule), c = grid.indexOf('data-pp2="hb-cell"');
    if (!(a > -1 && r > -1 && a < r && r < c)) throw new Error('order is not ALL SETS -> hairline -> set cells');
  }
  {
    const head = grid.slice(0, grid.indexOf('data-hb="pair"'));
    if (!/>All sets</.test(head) || !/>Set 1</.test(head) || !/>Game pair</.test(head)) throw new Error('the heads are not Game pair · All sets · Set 1–5');
  }
  if (!/>Game 1–2</.test(html)) throw new Error('the row label is not "Game 1–2" with an en dash');
  if (!html.includes(TOK.strip)) throw new Error('the 3-up strip is gone');
  if (html.split(TOK.allCell).length - 1 !== 6) throw new Error('an all-sets cell is tinted');
  {
    const cells = cellsOf(html), eng = engineCells('hold');
    cells.forEach((c, i) => {
      if (c.tier !== 'full') return;
      const want = eng[i].tag === 'up' ? TOK.tint('viz-up', 16, 36) : eng[i].tag === 'down' ? TOK.tint('viz-down', 16, 36) : TOK.neutral;
      if (!c.style.includes(want)) throw new Error(`full cell ${i} is not painted by its gap tag`);
      if (c.sub !== ENGINE.gapText(eng[i].gap)) throw new Error(`full cell ${i} sub is not the gap`);
    });
    cells.forEach((c, i) => {
      if (c.tier !== 'muted') return;
      const want = eng[i].tag === 'up' ? TOK.tint('viz-up', 8, 16) : eng[i].tag === 'down' ? TOK.tint('viz-down', 8, 16) : TOK.mutedNeutral;
      if (!c.style.includes(want)) throw new Error(`muted cell ${i} is not the 8/16 wash`);
    });
    if (!cells.some(c => c.tier === 'raw' && c.sub === 'raw')) throw new Error('a sub-five cell does not print the "raw" label');
  }
  if (AMBER_RE.test(html)) throw new Error('amber is painted');
  if (/data-pp2="hb-surf"/.test(html)) throw new Error('a surface control is on screen');
  if (/Green from/.test(html)) throw new Error('the legend footnote is back');
}

const mutants = [
  ['item 1 · the grid rendered twice',
   "body = hbStripHtml(model, mode) + hbGridHtml(model, mode);",
   "body = hbStripHtml(model, mode) + hbGridHtml(model, mode) + hbGridHtml(model, mode);",
   /not exactly one grid/],
  ['item 1 · the mode toggle stops re-deriving',
   "var mode = state.hbMode === 'break' ? 'break' : 'hold';",
   "var mode = 'hold';",
   /identical markup/],
  ['item 2 · ALL SETS moved back to last',
   "hbGlobalCellHtml(r) + divider + r.cells.map(hbCellHtml).join('')",
   "r.cells.map(hbCellHtml).join('') + divider + hbGlobalCellHtml(r)",
   /ALL SETS -> hairline/],
  ['item 2 · the reference tracks replaced',
   "'grid-template-columns:132px 78px 10px repeat(5,minmax(0,1fr));gap:8px 7px;'",
   "'grid-template-columns:126px 78px 10px repeat(5,minmax(0,1fr));gap:8px 7px;'",
   /tracks are not the reference/],
  ['item 3 · heads reverted to Global / S1-S5',
   "var HEAD = ['All sets', 'Set 1', 'Set 2', 'Set 3', 'Set 4', 'Set 5'];",
   "var HEAD = ['Global', 'S1', 'S2', 'S3', 'S4', 'S5'];",
   /heads are not/],
  ['item 3 · the row label keeps the engine\'s hyphen',
   "function hbPairLabel(bucket) { return String(bucket || '').replace('-', ENDASH); }",
   "function hbPairLabel(bucket) { return String(bucket || ''); }",
   /en dash/],
  ['item 5 · the strip dropped',
   "body = hbStripHtml(model, mode) + hbGridHtml(model, mode);",
   "body = hbGridHtml(model, mode);",
   /strip is gone/],
  ['item 6 · the full tint weakened to the muted wash',
   "var t = hbTint(c.tag, muted ? 8 : 16, muted ? 16 : 36);",
   "var t = hbTint(c.tag, 8, 16);",
   /not painted by its gap tag/],
  ['item 6 · the muted wash painted at full strength',
   "var t = hbTint(c.tag, muted ? 8 : 16, muted ? 16 : 36);",
   "var t = hbTint(c.tag, 16, 36);",
   /not the 8\/16 wash/],
  ['item 7 · the gap sub dropped',
   "sub = hbEngine() ? hbEngine().gapText(c.gap) : '';",
   "sub = c.frac;",
   /sub is not the gap/],
  ['item 8 · the all-sets cell tinted by its own rate',
   "'<span data-hb=\"all\" style=\"' + HB_CELL + 'background:' + (dead ? HB_DEAD_BG : HB_NEUTRAL_BG) + ';' +",
   "'<span data-hb=\"all\" style=\"' + HB_CELL + 'background:' + (dead ? HB_DEAD_BG : 'color-mix(in srgb, var(--viz-up) 16%, transparent)') + ';' +",
   /all-sets cell is tinted/],
  ['item 9 · the raw label dropped',
   "bg = HB_NEUTRAL_BG; bd = 'var(--line)'; fig = c.pct; sub = 'raw';",
   "bg = HB_NEUTRAL_BG; bd = 'var(--line)'; fig = c.pct; sub = '';",
   /does not print the "raw" label/],
  ['Q6 · the surface control put back on screen',
   "var HB_SHOW_SURF = false;",
   "var HB_SHOW_SURF = true;",
   /surface control is on screen/],
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
