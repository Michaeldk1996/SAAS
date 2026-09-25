#!/usr/bin/env node
'use strict';
// BUILD ITEM 3 · the Situational panel, asserted against RENDERED MARKUP.
//
// The ruling this locks: "The rows render ONLY where that player's shard carries
// the data. Where a player has none, omit the whole group — no block of dashes,
// no empty table." Reported correction, measured on the deployed store: it is the
// POINT-BY-POINT rows that 260 of 575 players have none of, and the per-set rows
// that all 575 carry — so the conditionality is attached to the pbp rows. These
// checks assert the omission behaviour whichever source is missing.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const DASH = '—';

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
}

// ── a roster built by construction, so no check can pass by luck ────────────
function match(sets, won, extra) {
  return Object.assign({ sets: sets, won: won, tournament: 'Somewhere', tier: 'atp' }, extra || {});
}
// 12 matches: won set 1 in 8 of them, won the match in 9.
function makeForm(n, winFirst) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const first = i < winFirst;
    out.push(first
      ? match([{ p: 6, o: 4 }, { p: 6, o: 3 }], true)
      : match([{ p: 4, o: 6 }, { p: 6, o: 3 }, { p: 4, o: 6 }], false));
  }
  return { pct: 0, matches: out };
}

// 24 matches, 14 won from the front and 10 from behind, so ALL SIX set rows
// clear n>=10: winSet3 and lostS1WonS2 are the two that only the come-from-
// behind matches feed, and at 12/8 they landed on n=4 and dashed honestly —
// which would have made check 1 read a real thin sample as a failed omission.
const SUBJECT = { key: 1, name: 'A. Subject', recentForm: makeForm(24, 14) };
const PEER = { key: 2, name: 'B. Peer', recentForm: makeForm(20, 10) };
const THIN = { key: 3, name: 'C. Thin', recentForm: makeForm(3, 2) };
const NOFORM = { key: 4, name: 'D. Noform', recentForm: { pct: 0, matches: [] } };

const PBP_STORE = {
  meta: { players: 2, windowMonths: 24 },
  tour: {
    brokenFirstSvc: { pct: 20 }, firstBreak: { pct: 50 }, brokenBack: { pct: 30 },
    breakBack: { pct: 40 }, lostS1FirstBreakS2: { pct: 33 }, holdWinSet: { pct: 80 },
    holdStaySet: { pct: 77 }, breakOppServing: { pct: null },
  },
  players: {
    1: {
      matches: 40,
      rows: {
        brokenFirstSvc: { w: 8, l: 32 }, firstBreak: { w: 21, l: 13 },
        brokenBack: { w: 3, l: 9 }, breakBack: { w: 18, l: 26 },
        lostS1FirstBreakS2: { w: 7, l: 10 }, holdWinSet: { w: 17, l: 5 },
        holdStaySet: { w: 14, l: 6 }, breakOppServing: { w: 6, l: 14 },
      },
    },
  },
};

function load(players, situational) {
  const map = {};
  players.forEach((p) => { map[String(p.key)] = p; });
  const sandbox = { FEATURE_PP2: true, playerProfiles: { players: map } };
  if (situational) sandbox.situational = situational;
  global.window = sandbox;
  new Function('window', fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8'))(sandbox);
  return sandbox.PlayerProfileV2._internals;
}

const ROSTER = [SUBJECT, PEER, THIN, NOFORM];

console.log('\nsituational panel (build item 3)\n');

// ── 1. no pbp store: those groups are GONE, not dashed ──────────────────────
check('with no point-by-point store the pbp groups are omitted, not dashed', () => {
  const I = load(ROSTER);
  const html = I.renderSituational(SUBJECT);
  assert.ok(!/Break of serve/.test(html), 'the all-pbp group "Break of serve" still rendered');
  assert.ok(!/Serving for the set/.test(html), 'the all-pbp group "Serving for the set" still rendered');
  assert.ok(/Set outcomes/.test(html), 'the set group should render');
  assert.ok(/After set one/.test(html), 'the mixed group should render its set rows');
  assert.ok(!/first break in set 2/.test(html), 'the pbp row inside a mixed group should be dropped');
  // Every set row clears n>=10 for this subject, so there is no honest thin
  // sample to dash: any dash here is a pbp row that was rendered instead of
  // omitted.
  const dashes = (html.match(new RegExp(DASH, 'g')) || []).length;
  assert.strictEqual(dashes, 0, `an omitted group must leave no dashes behind, found ${dashes}`);
});

// ── 2. with the store, all four groups and all fourteen rows ────────────────
check('with the store present all 4 groups and all 14 rows render', () => {
  const I = load(ROSTER, PBP_STORE);
  const html = I.renderSituational(SUBJECT);
  const groups = (html.match(/data-pp2="sit-toggle"/g) || []).length;
  assert.strictEqual(groups, 4, `expected 4 groups, got ${groups}`);
  let rows = 0;
  I.SIT_GROUPS.forEach(([, rs]) => rs.forEach(([, label]) => {
    if (html.includes(label.replace(/&/g, '&amp;'))) rows++;
  }));
  assert.strictEqual(rows, 14, `expected 14 labelled rows, got ${rows}`);
});

// ── 3. a missing tour figure dashes BOTH tour columns ───────────────────────
check('a row with no tour comparison dashes BOTH tour columns, never 0, never blank', () => {
  const I = load(ROSTER, PBP_STORE);
  // breakOppServing carries pct:null in the store above.
  const row = I.sitRowHtml('Break opp. serving for set', { w: 6, l: 14 }, null);
  const txt = [];
  const re = /text-align:right[^"]*"[^>]*>([^<]*)</g;
  let m;
  while ((m = re.exec(row)) !== null) txt.push(m[1]);
  assert.strictEqual(txt.length, 4, `expected 4 numeric cells, got ${txt.length}: ${JSON.stringify(txt)}`);
  assert.strictEqual(txt[2], DASH, `TOUR should be a dash, got "${txt[2]}"`);
  assert.strictEqual(txt[3], DASH, `VS TOUR should be a dash, got "${txt[3]}"`);
  assert.ok(!/0%|0\.0pp/.test(txt[2] + txt[3]), 'a missing tour figure rendered as a zero');
  assert.ok(txt[0].length > 0 && txt[1].length > 0, 'record and rate must still render');
});

// ── 4. the sample ladder ────────────────────────────────────────────────────
check('under 5 shows the record and dashes the rate; 5-9 is marked a small sample', () => {
  const I = load(ROSTER, PBP_STORE);
  const hard = I.sitRowHtml('x', { w: 2, l: 2 }, 50);
  assert.ok(hard.includes('2' + '–' + '2'), 'a thin row must still show its record');
  assert.ok(hard.includes(DASH), 'a thin row must dash the rate');
  assert.ok(!/%\s*<\/div>/.test(hard.replace(/50%/, '')), 'a thin row must not print a rate');
  const soft = I.sitRowHtml('x', { w: 4, l: 3 }, 50);
  assert.ok(/small sample/.test(soft), 'a 5-9 row must be marked a small sample');
  const full = I.sitRowHtml('x', { w: 8, l: 4 }, 50);
  assert.ok(!/small sample/.test(full), 'a 10+ row must NOT be marked a small sample');
  assert.ok(/66\.7%/.test(full), 'a full row must print its rate');
});

// ── 5. the tour population is read at RENDER time ───────────────────────────
// The control that stops "tour" being a hardcoded number: halve the roster and
// the stated population must fall with it.
check('the stated tour population is read from the roster at render time', () => {
  const big = load(ROSTER).renderSituational(SUBJECT);
  const small = load([SUBJECT, PEER]).renderSituational(SUBJECT);
  const nBig = /average of the (\d+) players/.exec(big);
  const nSmall = /average of the (\d+) players/.exec(small);
  assert.ok(nBig && nSmall, 'the footnote must state the population');
  assert.ok(Number(nBig[1]) > Number(nSmall[1]),
    `population did not fall with the roster: ${nBig[1]} vs ${nSmall[1]}`);
  assert.ok(!/\b575\b/.test(small), 'the population looks hardcoded');
});

// ── 6. the founder's footnote wording is carried verbatim ───────────────────
check('the footnote keeps the ruled wording', () => {
  const I = load(ROSTER, PBP_STORE);
  const html = I.renderSituational(SUBJECT);
  assert.ok(/not the full career figure shown in Career record/.test(html),
    'the footnote must say the rows are not the career figure');
  assert.ok(/counted per match, so a match can appear in several rows/.test(html),
    'the footnote must say situations are counted per match');
  assert.ok(/matches with set-by-set data/.test(html), 'the footnote must state the set-by-set N');
});

// ── 7. a player with nothing gets words, not an empty table ─────────────────
check('a player with no data at all gets a sentence, not an empty table', () => {
  const I = load(ROSTER);
  const html = I.renderSituational(NOFORM);
  assert.ok(!/data-pp2="sit-toggle"/.test(html), 'rendered a group for a player with no data');
  assert.ok(/no set-by-set or point-by-point data on record/.test(html),
    'should say in words why there is nothing');
});

// ── 8. walkovers are out of the denominator ─────────────────────────────────
check('a walkover is excluded from the set counts', () => {
  const I = load(ROSTER);
  const base = I.sitSetCounts(SUBJECT).n;
  const withWo = {
    key: 9, name: 'E. Wo',
    recentForm: { pct: 0, matches: SUBJECT.recentForm.matches.concat([
      match([{ p: 6, o: 0 }], true, { walkover: true })]) },
  };
  assert.strictEqual(I.sitSetCounts(withWo).n, base,
    'a walkover was counted as a match with set-by-set data');
});

// ── 9. closing a group hides its rows ───────────────────────────────────────
check('a closed group hides its rows but keeps its header', () => {
  const I = load(ROSTER, PBP_STORE);
  I.state.sitOpen = { 'Set outcomes': false };
  const html = I.renderSituational(SUBJECT);
  I.state.sitOpen = null;
  assert.ok(/Set outcomes/.test(html), 'the closed group must keep its header');
  assert.ok(!/Win first set/.test(html), 'a closed group must not render its rows');
  assert.ok(/Break of serve/.test(html), 'closing one group must not close the others');
});

// ── the export's own geometry (Player Stat Boxes.dc.html:919 head, :933 rows) ──
// Measured against the founder's screenshot before this was written: our build
// had `1fr 62px 74px 62px 72px` at `gap:10px`, which put RATE 12px, TOUR 14px and
// VS TOUR 10px wider than the design and shifted every numeric column. The
// screenshot's own column right-edges (916.0 / 983.5 / 1037.0 / 1104.5 CSS at a
// 1680-wide viewport rendered at 90%) reproduce from 62/62/48/62 and do not
// reproduce from 62/74/62/72.
const TRACKS = 'grid-template-columns:minmax(0,1fr) 62px 62px 48px 62px;gap:0 12px;';

check('rows and head use the export\'s grid tracks', () => {
  const I = load(ROSTER, PBP_STORE);
  const html = I.renderSituational(SUBJECT);
  const n = html.split(TRACKS).length - 1;
  // 1 head + one grid PER ROW (14). The export nests each group's cells in a
  // single per-group grid; we emit a grid per row. With identical tracks and no
  // row gap the two lay out the same, because every row resolves minmax(0,1fr)
  // against the same container width — so this is a structural difference with
  // no geometric one, and the per-row form is what keeps a row's five cells
  // together when a group is collapsed.
  assert.strictEqual(n, 15, `expected 15 grids on the export tracks (1 head + 14 rows), found ${n}`);
  assert.ok(!/62px 74px 62px 72px/.test(html), 'the pre-export track widths are still being emitted');
  assert.ok(!/gap:10px/.test(html.split('Situational')[1] || ''), 'the 10px gap is still being emitted');
});

check('the head row renders ONCE, not once per group', () => {
  const I = load(ROSTER, PBP_STORE);
  const html = I.renderSituational(SUBJECT);
  const heads = html.split('border-bottom:0.33px solid rgba(255,255,255,0.03)').length - 1;
  assert.strictEqual(heads, 1, `the column head renders ${heads} times; the export renders it once`);
  const recs = html.split('>Record<').length - 1;
  assert.strictEqual(recs, 1, `"Record" appears ${recs} times in the head`);
});

check('the panel carries the export\'s "Situational" title', () => {
  const I = load(ROSTER, PBP_STORE);
  const html = I.renderSituational(SUBJECT);
  assert.ok(/font-size:20px;font-weight:800;">Situational</.test(html),
    'the 20px/800 "Situational" title is missing — the export puts it above the launcher');
});

console.log(`\nsituational panel: ${pass} pass, ${fail} fail`);
if (fail) { console.error(`FAILED: ${fail} check(s)`); process.exit(1); }
